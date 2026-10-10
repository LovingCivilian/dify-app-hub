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

Note, 2026-10-05 (chat sub-project, [ADR-0018](0018-gate-route-groups-on-the-server.md)): pages now redirect a revoked session as well. The `(user)` and `(admin)` route group layouts call `requireSessionUser()` (`lib/session-user.ts`: the cached `getServerSession`, then `redirect('/login')` when the session has no `user.id`, which is how a revoked JWT arrives), so the Consequences limit "a revoked JWT passes the page gate until it expires" is closed for page loads: the proxy still accepts the token, and the first request after a revocation reaches a layout, which redirects. Client-side route changes inside a group reuse the layout, so a token revoked mid-session is caught at the next hard load. The client gates (`components/auth/auth-guard.tsx`, `useAuth`'s `isAuthorized`/`goAuthorize`) are deleted, and with them the limit that they redirected without `callbackUrl`; the layout redirect carries no `callbackUrl` either (a layout cannot read the pathname), while the proxy keeps adding it in the normal signed-out case. `hooks/use-auth.ts` keeps only `userId`. The `/api/users/*` gap stays open (its verification item is unchanged; backend rework brief item 2). Maintenance: `docs/auth-gate.md`.

Note, 2026-10-07 (backend rework B1): the Dify handlers now live under `app/api/dify/[appId]/<Dify path>` ([ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)); each verifies the session first (`resolveDifyRoute` in `lib/dify/route.ts`, through `verifySession()` in `lib/auth/session.ts`, which replaced `lib/session-user.ts` and `getSessionUserId()`) and sets `user` from it; the app's own refusals and the proxy's API 401 use Dify's envelope (`{ code, message, status }`). The `/api/users/*` gap stays open until B2 deletes those handlers: they still check only `!session`, so a revoked token reaches them until its cookie is re-issued without `id` at the next session refresh, after which the proxy answers 401 ([ADR-0018](0018-gate-route-groups-on-the-server.md)'s note of 2026-10-07). The vestigial `x-user-id` header and `getUserIdFromRequest` are gone with `lib/dify-client.ts` and `lib/api-utils.ts`.

Note, 2026-10-08 (backend rework B2, [ADR-0024](0024-keep-the-apps-own-data-behind-a-data-access-layer-with-server-actions-and-gate-the-admin-surface-by-role.md)): the `/api/users/*` revoked-session gap is closed by removal. `app/api/users/**` and `app/api/init/**` are deleted, the users admin and first run run on Server Actions over the Data Access Layer, and `/api/init` is no longer a public path (`lib/access.ts` keeps one `PUBLIC_PREFIXES` list); the open verification item above is settled by that removal. Roles exist: `owner`, `admin` and `user` (`users.role`). The first account is the owner, created through `/init`; on upgrade the oldest existing account became the owner and the others admins. The owner manages admins and users, an admin manages users, and nobody manages their own rank. Two of the non-goals are done in B2: roles, and a "change password" entry in the account menu, which asks for the current password and signs every session out; SSO and per-app permissions wait for B3 (LDAP, groups, per-app access). The Dify `user` follows the account row's email, because the `jwt` callback refreshes email, name and role from the row on every request: when an admin edits a user's email, that user's conversations stay under the old email in Dify and drop out of their chat list from the next request (before B2, at their next sign-in). `/reset-password` stays reachable while signed in, although the emailed link is no longer the only way to change a password; the signed-in redirect there waits for the reset flow's follow-up (ADR-0024).

Note, 2026-10-08 ([ADR-0026](0026-use-the-accounts-permanent-id-as-the-dify-end-user.md)): the Decision's second bullet, the email as the Dify end-user id, is superseded. The Dify `user` is the account's permanent id (`users.id`), set on the server by `resolveDifyRoute` (`lib/dify/route.ts`); the browser-supplied `user` stays ignored. An email edit, a reused email or a directory `mail` change therefore no longer moves or leaks Dify history, and the B2 note's sentence above on the Dify `user` following the row's email no longer holds. The alternative "Hash of email as the Dify user id: rejected; the owner wants the readable email in Dify/Langfuse" is reversed there: the readable mapping lives on the users page ("Dify user ID"). The login rules stand: every page and API behind the account login, deny by default, the public paths, the landing page and the signed-in redirects.

Note, 2026-10-10 ([ADR-0029](0029-sign-directory-accounts-in-over-ldap-and-keep-them-in-step-with-a-scheduled-sync.md)): directory accounts sign in on the login page's 'Directory account' tab through next-auth's `/api/auth/callback/ldap`, under the public `/api/auth` prefix; deny by default is unchanged.
