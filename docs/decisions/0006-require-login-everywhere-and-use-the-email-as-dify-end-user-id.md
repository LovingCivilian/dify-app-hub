---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Require the app's own login for every page and API, and use the signed-in email as the Dify end-user id

## Context and Problem Statement

Upstream gates only the admin pages; the chat and app list are public and identify users by a browser fingerprint sent from the client as `user`. The owner wants per-person attribution in Dify and Langfuse and no anonymous access. Upstream proposed a "dual auth" design (`docs/superpowers/specs/2026-05-13-web-dual-auth-design.md`, inherited) that the fork did not adopt.

## Decision

- Every page and every `/api/*` route requires the app's NextAuth credentials session; deny by default. Public: `/login`, `/forgot-password`, `/reset-password`, `/init`, `/api/auth`, `/api/init`, `/api/health`. Classification lives in `lib/access.ts`, enforcement in `proxy.ts`, plus a session check inside every `app/api/client/*` handler.
- The Dify end-user id is the signed-in account's **email**, set **server-side** by `getSessionUserId()` (`lib/session-user.ts`); the browser-supplied `user` is ignored everywhere. This replaces the fingerprint identity.
- Landing page after login is `/apps`. Log out lives in the account menu (now `components/shell/account-dropdown.tsx`).
- Signed-in visitors are redirected from `/login` and `/forgot-password` to `/apps` by per-page server layouts (`redirectSignedInUser()`); `/reset-password` stays reachable while signed in because the emailed link is the only way a non-admin changes their password.
- No LDAP, no roles or permissions yet; those are later steps on this base.

Non-goals: SSO, roles, per-app permissions, a "change password" entry in the account menu.

## Consequences

- Good, because conversations in Dify/Langfuse carry a real identity and the app no longer trusts client-supplied ids.
- Good, because the gate is one proxy plus one classifier, testable in isolation (`__tests__/proxy.test.ts`, `access.test.ts`).
- Bad (known limits): a revoked JWT passes the page gate until it expires while the Dify routes reject it; upstream's `/api/users/*` checks only `!session`; the layout redirect cannot honour `?callbackUrl=`; the client gates (`AuthGuard`, `useAuth`) redirect without `callbackUrl` when a session expires mid-navigation.
- Bad, because conversations created before the gate (fingerprint ids) are not listed for anyone.
- Left in place on purpose, unused: the `x-user-id` header in `lib/dify-client.ts`, `getUserIdFromRequest` in `lib/api-utils.ts`. The fingerprint page `app/(user)/auth/page.tsx` was deleted in the overhaul (PR #12).

## Implementation Plan

- **Affected paths**: `lib/access.ts`, `proxy.ts`, `lib/session-user.ts`, `app/api/client/**`, `app/(auth)/login/layout.tsx`, `app/(auth)/forgot-password/layout.tsx`, `components/auth/auth-guard.tsx`, `hooks/use-auth.ts`, `docs/auth-gate.md` (maintenance and expected upstream conflicts).
- **Dependencies**: `next-auth` (credentials provider), `bcryptjs`.
- **Patterns to follow**: new API routes under `app/api/client/*` call the session check first; new pages are gated by path (route groups do not change paths, so no change to `lib/access.ts` is needed when moving pages); the end-user id always comes from `getSessionUserId()`.
- **Patterns to avoid**: reading `user` from the request body; adding public paths without updating `lib/access.ts` and its tests.

### Verification

- [x] `__tests__/proxy.test.ts`, `access.test.ts`, `session-user.test.ts`, `auth-page-layouts.test.ts` pass.
- [x] e2e `smoke.spec.ts`: signed-out `/app-management` → `/login?callbackUrl=%2Fapp-management`; `/api/client/apps` signed out → 401 (Docker curl check).
- [ ] Close the `/api/users/*` revoked-session gap (two `!session?.user?.id` edits) — open follow-up.

## Alternatives Considered

- Upstream's dual auth (fingerprint plus optional login): rejected; keeps anonymous access and client-supplied identity.
- Hash of email as the Dify user id: rejected; the owner wants the readable email in Dify/Langfuse.

## More Information

Sources: spec `docs/superpowers/specs/2026-10-03-login-for-all-users-design.md`, plan `docs/superpowers/plans/2026-10-03-login-for-all-users.md`, PR #3 (gate), PR #5 (signed-in redirect), `CLAUDE.md` "Login for everyone", `docs/auth-gate.md`. Related: [ADR-0011](0011-bound-the-shells-to-the-viewport.md) (client gates and the shells).

Note, 2026-10-06 (copy on `fork/main`): this record was copied to the line-level product when the fork split into two lines ([ADR-0019](0019-keep-two-product-lines.md)). Its text is kept as written on `fork/overhaul`; references to ADR-0008–ADR-0014, ADR-0016–ADR-0018, the frontend overhaul, its shells and its Playwright e2e harness concern `fork/overhaul` only and have no file on this line (ADR-0016–ADR-0018 are on PR #15's branch until it merges into `fork/overhaul`). On this line pages are gated by the proxy's `getToken` check (with `callbackUrl`) plus the client gates (`AuthGuard`, `useAuth`) described above; the server-side layout gate of ADR-0018 belongs to the overhaul (PR #15's branch until it merges). Paths differ here: log out is in `components/auth/account-menu.tsx` (not `components/shell/account-dropdown.tsx`); the signed-in redirects are `app/login/layout.tsx` and `app/forgot-password/layout.tsx` (no `(auth)` route group); the fingerprint page `app/(user)/auth/page.tsx` still exists on this line, left unused on purpose (`docs/auth-gate.md`, "Vestigial upstream pieces"). The `/api/users/*` gap is four `!session` checks in two files (`app/api/users/route.ts`, `app/api/users/[id]/route.ts`), not two.
