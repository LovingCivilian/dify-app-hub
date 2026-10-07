---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (chat sub-project, Task 2)
---

# Gate route groups on the server and let the proxy gate navigations

## Context and Problem Statement

The `(user)` and `(admin)` route groups were guarded on the client: the `(user)` layout and `AuthGuard` (admin) were Client Components that read `useSession()`, showed a Spin while the session loaded, then rendered the shell or pushed to `/login`. Nothing of the shell (header, account button) was in the server HTML, every hard load started on a blank canvas, and the guard redirected without a `callbackUrl`. [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md) already gates every page request in the proxy, but the proxy's `getToken` accepts a revoked JWT (a password reset bumps `sessionVersion`) until the cookie expires, so a revoked visitor reached the pages until the client guard noticed.

Next.js documents two limits on layout checks (bundled docs, `01-app/02-guides/authentication.md` "Layouts and auth checks"; `01-app/03-api-reference/03-file-conventions/layout.md` "Pathname"): a layout does not re-render on navigation, so a check there does not run on every route change, and a layout cannot read the current pathname, so it cannot build a `callbackUrl`. How should the groups be gated so the shells render on the server for everyone who stays, without a documented-API gap?

## Decision Drivers

- The shells and the account button must be in the first HTML ([ADR-0016](0016-store-the-theme-preference-in-cookies.md) made the theme server-renderable; the gate was the remaining blocker).
- A revoked JWT must be turned away on page loads, not only on API calls.
- `callbackUrl` handling stays where it works: the proxy sees the full URL.
- Documented Next.js and next-auth APIs only ([ADR-0002](0002-use-documented-library-approaches-only.md)); no new dependency; backend files untouched.
- Data stays protected where it is served: the route handlers, not the layouts.

## Considered Options

- Async group layouts call `requireSessionUser()` (`getServerSession` + `redirect('/login')`); the proxy stays the navigation gate and the only place that adds `callbackUrl`; the root layout hands the same session to `SessionProvider`; the client gates are deleted.
- Render the gate inside each shell component.
- Keep the client gates.
- Check the session in every page (the data access layer pattern of the Next guide).

## Decision Outcome

Chosen option: server-side group layouts. `lib/session-user.ts` gains `getCachedServerSession()` (React `cache()` around `getServerSession(authOptions)`, so the root layout and a group layout share one lookup per request) and `requireSessionUser()` (redirects to `/login` when there is no `user.id`; a revoked JWT decodes but the session callback in `lib/auth.ts` leaves `user.id` out). `app/(user)/layout.tsx` and `app/(admin)/layout.tsx` are async Server Components that await it before rendering; the admin layout renders `AdminShell` around the children and the user layout returns them. `app/layout.tsx` awaits `getCachedServerSession()` next to `cookies()` and passes the session to `AppProviders`, which passes it to `SessionProvider` (next-auth: a session supplied by the server avoids the loading state on first load). `AuthGuard` is deleted and `useAuth()` shrinks to `{ userId }`.

The proxy keeps redirecting signed-out page requests to `/login?callbackUrl=…`. The layout redirect therefore only fires for sessions the proxy let through, in practice revoked JWTs, and carries no `callbackUrl`.

### Consequences

- Good, because the shell and the account button are in the server HTML for a signed-in visitor (`e2e/ssr-first-paint.spec.ts`), so no fullscreen Spin and no white canvas while the session resolves.
- Good, because a revoked JWT is redirected to `/login` on every hard load and whenever navigation enters a group, closing the page half of the gap recorded in ADR-0006 and `docs/auth-gate.md`.
- Good, because `getCachedServerSession()` costs one `getServerSession` per server render even though two layouts need it (its `jwt` callback runs one `sessionVersion` query per call, `lib/auth.ts`). React invalidates the memoised result on every server request (React `cache` reference), so a session never leaks into another request, and the route handlers that call `getSessionUserId()` keep their per-call semantics.
- Bad, because the layout check runs when the layout renders: a hard load or a full RSC fetch of the group, not on every client-side route change (Next guide, "Layouts and auth checks"). A JWT revoked mid-session is turned away at the next hard load; until then the pages stay on screen but every `/api/*` call is rejected (`getSessionUserId()` in the handlers), because the data gate is the handlers, not this layout.
- Bad, because passing a server session to `SessionProvider` removes the on-mount `/api/auth/session` fetch: with an initial `session` prop the provider's first `_getSession()` returns early (next-auth `react/index.js`; the docs describe the prop as avoiding redundant checks and the loading state). `getServerSession` in a Server Component cannot write cookies, so the session JWT's 30-day expiry is no longer slid forward on every page load, and a revoked cookie is no longer cleared on load. Both now happen only when the tab regains focus (`refetchOnWindowFocus`, on by default), at a `refetchInterval` (none is set) or at sign-in; a tab that is loaded and never leaves the foreground does not renew. Revocation itself is unaffected: the layouts and the handlers reject a revoked JWT regardless of the cookie.
- Bad, because the layout redirect carries no `callbackUrl` (a layout cannot read the pathname); only the proxy adds it.
- Bad, because `app/layout.tsx` now awaits the session on every render, public pages included (`/login`, `/forgot-password`, `/reset-password`), and a top-level await in a layout delays the first streamed chunk (Next guide, "Auth and streaming"). One cached lookup was accepted for server-rendered shells; moving the await into a Suspense-wrapped component is a later option.
- Neutral, because routes were already per-request: the root layout reads `cookies()` ([ADR-0016](0016-store-the-theme-preference-in-cookies.md) lists which routes moved), and `getServerSession` itself reads `cookies()` and `headers()` (next-auth `next/index.js`). The group layouts' own session read and their `export const dynamic = 'force-dynamic'` change no route's rendering mode; they state the intent and match `(auth)/login/layout.tsx`.
- Neutral, because the Server Actions in `app/(admin)/app-management/actions.ts` (upstream's) run no session check of their own; the Next guide asks for one per action. That predates this decision and is unchanged here; it belongs with the roles work.

## Implementation Plan

- **Affected paths**: `lib/session-user.ts`, `app/(user)/layout.tsx`, `app/(admin)/layout.tsx`, `app/layout.tsx`, `components/providers/app-providers.tsx`, `hooks/use-auth.ts`, `components/auth/auth-guard.tsx` (deleted), `docs/auth-gate.md`, `__tests__/session-user.test.ts`, `__tests__/group-layouts.test.ts`, `e2e/ssr-first-paint.spec.ts`.
- **Dependencies**: none.
- **Patterns to follow**: a new route group that needs a login calls `requireSessionUser()` in its server layout, outside any `try/catch` (`redirect()` throws); new server code that needs the session calls `getCachedServerSession()`; the account email on the client comes from `useAuth()`.
- **Patterns to avoid**: client-side guards that hide the shell until `useSession()` resolves; reading `useSession().status` to decide access; building a `callbackUrl` in a layout; treating the layout as the data gate (handlers keep their own `getSessionUserId()` check).
- **Configuration**: none.

### Verification

- [x] `__tests__/session-user.test.ts` and `__tests__/group-layouts.test.ts`: both layouts render for a live session and redirect to `/login` for no session and for a revoked session without `user.id`.
- [x] `e2e/ssr-first-paint.spec.ts`: the server HTML of `/app-management` contains the header and the account button for the signed-in admin; a signed-out request for `/apps` still gets the proxy's 307 with `callbackUrl=%2Fapps`. All three Playwright projects.
- [x] The full e2e suite (`smoke.spec.ts`, screenshots, theme and shell specs) passes against the server gate.
- [ ] Production build: the six curl checks of Task 20 (Docker stack) still hold, including `/apps` signed out redirecting with `callbackUrl`.

## Pros and Cons of the Options

### Async group layouts with `requireSessionUser()`

- Good, because the shells render on the server and the revoked-JWT case is closed for page loads with documented APIs only (`getServerSession`, `redirect`, `cache`).
- Bad, because of the layout limits listed above; the proxy and the handlers carry the rest.

### Gate inside each shell component

- Good, because the check sits next to what it protects.
- Bad, because the shells are Client Components, so the check would stay on the client or need a server wrapper; and `UserShell` is rendered by each user page, so the check would be repeated per page.

### Keep the client gates

- Good, because nothing changes.
- Bad, because the shells never reach the server HTML, the first paint is a Spin, and the `callbackUrl` is lost whenever the client guard redirects.

### Check the session in every page

- Good, because it is the pattern the Next guide recommends for data access.
- Bad, because every page under both groups is a Client Component that talks to gated handlers; it would need a server wrapper per page for the same redirect the layout gives once.

## More Information

Sources: Next 16.3.4 bundled docs (`01-app/02-guides/authentication.md` "Layouts and auth checks" and "Auth and streaming"; `01-app/03-api-reference/03-file-conventions/layout.md` "Pathname"; `01-app/03-api-reference/04-functions/redirect.md`), next-auth v4 docs (`getServerSession` in Server Components; `SessionProvider` `session` prop and `refetchOnWindowFocus`, https://next-auth.js.org/getting-started/client), React `cache` reference, chat sub-project spec `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md` §2 "Gate design" and §3.1–3.2. The `AppProviders` session prop is typed through `SessionProviderProps` because `Session` imported from `next-auth` resolves to the ambient declaration in `types/next-auth.d.ts` (a script file, so it declares the module rather than augmenting it) and lacks `expires`. Related: [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md), [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), [ADR-0016](0016-store-the-theme-preference-in-cookies.md).

Note, 2026-10-07 (backend rework B1): the session helpers moved to `lib/auth/session.ts`: `getCachedServerSession()`, `verifySession()` (the account `{ id, email, name }` or null), `requireUser()` (the former `requireSessionUser()`, still called by the `(user)` and `(admin)` layouts), `requireActor()` (Server Actions: throws `AuthError`) and `redirectSignedInUser()`; `lib/session-user.ts`, `lib/auth.ts` and `hooks/use-auth.ts` are gone, and the account menu reads `useSession()`. The revoked cookie: on a `sessionVersion` mismatch the `jwt` callback (`lib/auth/options.ts`) now returns the token stripped of `id` and `sessionVersion` (within its documented return type, `Awaitable<JWT>`), so next-auth re-issues the cookie at the next session refresh instead of clearing it; the old `null` return cleared it only by accident (the `null` token made next-auth's session route throw, and its error path, `JWT_SESSION_ERROR`, clears the cookie). Every gate treats a token without `id` as signed out: `proxy.ts` (`!token?.id`) answers the 401 envelope on `/api/*` and redirects a page to `/login?callbackUrl=…`, and `verifySession()` returns null. Where the Consequences above say a revoked cookie is cleared (when the tab regains focus, at a `refetchInterval` or at sign-in), read: it is re-issued without `id` at those moments, and from then on the proxy turns it away too. The Neutral line on the Server Actions is closed for the apps: every action in `app/(admin)/app-management/actions.ts` calls `requireActor()` first ([ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)); the users area keeps its route handlers until B2.
