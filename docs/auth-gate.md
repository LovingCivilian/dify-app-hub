# Login gate (fork)

Every page and every `/api/dify/*` route requires the account login. The Dify end-user id is the signed-in account's email, set on the server. This departs from upstream's dual-auth model (`docs/superpowers/specs/2026-05-13-web-dual-auth-design.md`); design: `docs/superpowers/specs/2026-10-03-login-for-all-users-design.md`.

## Where it lives

- `proxy.ts` + `lib/access.ts`: classify the decoded pathname; public paths, redirect to `/login?callbackUrl=`, the 401 envelope (`{ code: 'unauthorized', message, status }`) for every other `/api/*` path (deny by default). A token without `id` counts as signed out (ADR-0018's note of 2026-10-07).
- `lib/auth/session.ts`: `getCachedServerSession()` (React `cache` around `getServerSession`, one lookup per server render), `verifySession()` (the account `{ id, email, name }` or null), `requireUser()` (pages and layouts: the account or a redirect to `/login`), `requireActor()` (Server Actions: the account or `AuthError('unauthorized')`) and `redirectSignedInUser()`. `lib/auth/options.ts` holds next-auth's options; its `jwt` callback re-checks `sessionVersion` on every call and strips `id` and `sessionVersion` from a revoked token.
- `lib/dify/route.ts`: `resolveDifyRoute()`, the first step of every `/api/dify/*` handler: `verifySession()` (401 envelope), then the app (404, 403 when disabled); `user` for Dify is the session's email. `app/api/apps/[appId]/icon/route.ts` calls `verifySession()` itself.
- `app/(user)/layout.tsx`, `app/(admin)/layout.tsx`: async server layouts that call `requireUser()` (ADR-0018). A visitor without a live session, a revoked JWT included, goes to `/login`; everyone who stays gets the shells in the server HTML. The proxy stays the navigation gate and the only place that adds `?callbackUrl=` (a layout cannot read the pathname), so the layout redirect carries none. A layout does not re-render on client-side route changes, so the data gate stays in the handlers (`resolveDifyRoute`) and the actions (`requireActor()`).
- `app/(auth)/login/layout.tsx`, `app/(auth)/forgot-password/layout.tsx`: server layouts that call `redirectSignedInUser()`, so a signed-in visitor goes to `/apps` instead of seeing the form (next-auth's custom-sign-in-page pattern, done with `getServerSession` + `redirect()`). A revoked session has no `user.id` and is not redirected. `/reset-password` stays reachable while signed in on purpose: the emailed link is the only way a non-admin changes their password. Add a layout there once the account menu offers a password change. A layout cannot read `?callbackUrl=`, so a signed-in visitor always lands on `/apps`.
- `app/layout.tsx` → `components/providers/app-providers.tsx`: the root layout passes the cached server session to `SessionProvider`, so `useSession` has the session on first render (the account button is in the first HTML).
- `components/shell/account-dropdown.tsx`: "signed in as" (from `useSession`) + log out.

## After picking upstream commits

This line takes upstream's work by cherry-pick or re-implementation only (ADR-0022).

1. List routes that forward a user to Dify and check each uses the session value:

   ```bash
   git grep -nE "getUserIdFromRequest|searchParams.get\('user'\)|body\.user|x-user-id" -- app/api/dify
   ```

   Expected: no output. For any hit, take `user` from `resolveDifyRoute` (`resolved.ctx.user`) instead.

2. New pages and new `/api/*` routes are gated by the proxy automatically. Every handler under `app/api/dify/` resolves the session first through `resolveDifyRoute` (`lib/dify/route.ts`) and sets `user` from it; new routes copy that. New public pages (if upstream adds any) go into `PUBLIC_PAGES` in `lib/access.ts`, new public APIs into `UNGATED_PREFIXES`.
3. Expected conflicts: `proxy.ts` (keep the fork's gate, re-apply upstream's additions inside it), `app/(user)/layout.tsx` (keep the fork's server gate); upstream's `app/api/client/**`, `lib/session-user.ts` and `lib/dify-client.ts` no longer exist here, so a change to them is re-implemented in `app/api/dify/**` and `lib/dify/`.

## Known limits (step 1)

- No roles: every account can open the admin pages (B2).
- Conversations created before the gate (fingerprint ids) are not listed.
- Sessions last 30 days (next-auth default). The root layout hands the server session to `SessionProvider`, which therefore skips its on-mount `/api/auth/session` fetch: the cookie's expiry is no longer slid forward on every page load. Renewal happens when the tab regains focus (`refetchOnWindowFocus`, default on) or at sign-in (ADR-0018).
- Password reset revokes existing JWTs, and the gates differ in when they notice. Every `/api/dify/*` route rejects a revoked JWT at once: next-auth still builds a session from it, but without `user.id`, so `verifySession()` returns null. Every page under `(user)` and `(admin)` redirects it to `/login` too (`requireUser()`), on a hard load or when navigation enters a group. The browser's cookie is not cleared: the `jwt` callback strips `id` and `sessionVersion`, and next-auth re-issues the cookie without them at the next session refresh (tab focus, sign-in). Until then the proxy's `getToken` still sees the old token and lets requests through to the layouts and handlers, which turn it away; afterwards the proxy treats it as signed out as well (401 envelope on `/api/*`, `/login?callbackUrl=` on pages). Client-side route changes inside a group reuse the layout, so a token revoked mid-session is caught at the next hard load; its Dify calls fail at once. The `/api/users/*` handlers check only `!session` and accept a revoked token until its cookie is re-issued (ADR-0006, closed by B2's removal of those handlers).
