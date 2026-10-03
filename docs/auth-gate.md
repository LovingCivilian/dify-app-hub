# Login gate (fork)

Every page and every `/api/client/*` route requires the account login. The Dify end-user id is the signed-in account's email, set on the server. This departs from upstream's dual-auth model (`docs/superpowers/specs/2026-05-13-web-dual-auth-design.md`); design: `docs/superpowers/specs/2026-10-03-login-for-all-users-design.md`.

## Where it lives

- `proxy.ts` + `lib/access.ts`: public paths, redirect to `/login?callbackUrl=`, 401 for `/api/client/*`.
- `lib/session-user.ts`: `getSessionUserId()` (email or null) and `unauthorizedResponse()`.
- `hooks/use-auth.ts`: chat-side identity from `useSession`.
- `components/auth/account-menu.tsx`: "signed in as" + log out.

## Vestigial upstream pieces (left untouched on purpose)

- `app/(user)/auth/page.tsx` (fingerprint page): nothing routes to it.
- `x-user-id` header in `lib/dify-client.ts`: ignored by the server.
- `getUserIdFromRequest` in `lib/api-utils.ts`: trusts that header; no route calls it. Never reintroduce it.

## After merging upstream

1. List routes that forward a user to Dify and check each uses the session value:

   ```bash
   git grep -nE "getUserIdFromRequest|searchParams.get\('user'\)|body\.user|x-user-id" -- app/api/client
   ```

   Expected: no output. For any hit, add `const userId = await getSessionUserId(); if (!userId) return unauthorizedResponse()` and use `userId`.

2. New routes under `app/api/client/` are gated by the middleware automatically; new pages too. New public pages (if upstream adds any) go into `PUBLIC_PREFIXES` in `lib/access.ts`.
3. Expected conflicts: `proxy.ts` (keep the fork's gate, re-apply upstream's additions inside it), `hooks/use-auth.ts` (keep the fork's version), `app/(user)/layout.tsx` (keep the loading gate).

## Known limits (step 1)

- No roles: every account can open the admin pages.
- Conversations created before the gate (fingerprint ids) are not listed.
- Sessions last 30 days (next-auth default); password reset signs out everywhere.
