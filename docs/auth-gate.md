# Login gate (fork)

Every page and every `/api/client/*` route requires the account login. The Dify end-user id is the signed-in account's email, set on the server. This departs from upstream's dual-auth model (`docs/superpowers/specs/2026-05-13-web-dual-auth-design.md`); design: `docs/superpowers/specs/2026-10-03-login-for-all-users-design.md`.

## Where it lives

- `proxy.ts` + `lib/access.ts`: classify the decoded pathname; public paths, redirect to `/login?callbackUrl=`, 401 for every other `/api/*` path (deny by default).
- `lib/session-user.ts`: `getSessionUserId()` (email or null), `unauthorizedResponse()` and `redirectSignedInUser()`.
- `app/(auth)/login/layout.tsx`, `app/(auth)/forgot-password/layout.tsx`: server layouts that call `redirectSignedInUser()`, so a signed-in visitor goes to `/apps` instead of seeing the form (next-auth's custom-sign-in-page pattern, done with `getServerSession` + `redirect()`). A revoked session has no `user.id` and is not redirected. `/reset-password` stays reachable while signed in on purpose: the emailed link is the only way a non-admin changes their password. Add a layout there once the account menu offers a password change. A layout cannot read `?callbackUrl=`, so a signed-in visitor always lands on `/apps`.
- `hooks/use-auth.ts`: chat-side identity from `useSession`.
- `components/shell/account-dropdown.tsx`: "signed in as" + log out.

## Vestigial upstream pieces (left untouched on purpose)

- `x-user-id` header in `lib/dify-client.ts`: ignored by the server.
- `getUserIdFromRequest` in `lib/api-utils.ts`: trusts that header; no route calls it. Never reintroduce it.

The fingerprint page `app/(user)/auth/page.tsx` used to be in this list; it was deleted in the frontend overhaul (sub-project 1).

## After merging upstream

1. List routes that forward a user to Dify and check each uses the session value:

   ```bash
   git grep -nE "getUserIdFromRequest|searchParams.get\('user'\)|body\.user|x-user-id" -- app/api/client
   ```

   Expected: no output. For any hit, add `const userId = await getSessionUserId(); if (!userId) return unauthorizedResponse()` and use `userId`.

2. New pages and new `/api/*` routes are gated by the middleware automatically. Every handler under `app/api/client/` also checks `getSessionUserId()` itself; give new ones the same check (`if (!(await getSessionUserId())) return unauthorizedResponse()` when they forward no user). New public pages (if upstream adds any) go into `PUBLIC_PAGES` in `lib/access.ts`, new public APIs into `UNGATED_PREFIXES`.
3. Expected conflicts: `proxy.ts` (keep the fork's gate, re-apply upstream's additions inside it), `hooks/use-auth.ts` (keep the fork's version), `app/(user)/layout.tsx` (keep the loading gate).

## Known limits (step 1)

- No roles: every account can open the admin pages.
- Conversations created before the gate (fingerprint ids) are not listed.
- Sessions last 30 days (next-auth default).
- Password reset revokes existing JWTs only in part. Every Dify proxy route rejects a revoked JWT: next-auth still builds a session from it, but without `user.id`, so `getSessionUserId()` returns null. The proxy's `getToken` still accepts it for pages until it expires. The browser's own cookie is cleared on its next session refresh.
