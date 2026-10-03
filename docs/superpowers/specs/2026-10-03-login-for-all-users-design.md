# Login for all users — design

> Date: 2026-10-03. Scope: require the existing account login for the chat side and its APIs, and send the account's email to Dify as the end-user id. Fork-only; step 1 of the end-user identity work. Departs from upstream's dual-auth model described in [2026-05-13-web-dual-auth-design.md](./2026-05-13-web-dual-auth-design.md).

## Goal

Every page and every `/api/client/*` route requires a signed-in account (the `users` table, NextAuth credentials login, unchanged). The `user` value sent to Dify is the signed-in account's email, set by the server. No roles, no LDAP, no account tags: every account can reach every page. Later steps build on this.

## Decisions taken

| Question | Decision |
| --- | --- |
| Dify `user` value | The account email, set server-side; the browser's value is ignored. |
| Landing page after login | `/apps`. The admin pages stay reachable by URL and from the existing links. |
| Fingerprint page `/auth` and the `x-user-id` header | Left untouched (vestigial) to keep upstream files unchanged. Nothing routes to `/auth` any more. |
| Enforcement | Middleware (`proxy.ts`) for pages and `/api/client/*`, plus a session check in each route that forwards a user to Dify. |

## 1. Access rule

Implemented in `proxy.ts` (Next.js 16 proxy, formerly middleware) using next-auth's `getToken`, as upstream already does for the admin pages.

| Path | Without a session |
| --- | --- |
| `/login`, `/forgot-password`, `/reset-password`, `/init` and below | Allowed |
| `/api/auth/*`, `/api/init/*`, `/api/health` | Allowed |
| `/_next/*`, `/favicon.ico` | Allowed |
| `/api/client/*` | `401` JSON `{ "error": "Unauthorized" }` |
| Other `/api/*` (`/api/users`) | Not handled here; those routes keep their own `getServerSession` checks |
| Any other page | Redirect to `/login?callbackUrl=<pathname + search>` |

Upstream's "redirect to `/init` until the system is set up" logic stays as it is, after the session check.

The classification lives in a fork-owned module `lib/access.ts`:

```ts
export const isPublicPath = (pathname: string): boolean
export const isClientApiPath = (pathname: string): boolean
export const getSafeCallbackUrl = (value: string | null | undefined): string
```

`getSafeCallbackUrl` returns the value when it is a same-site path (`/...` but not `//...`), otherwise `/`.

## 2. Login page and landing

`app/login/page.tsx` already calls `signIn('credentials', { redirect: false })`. After success it navigates to `getSafeCallbackUrl(searchParams.get('callbackUrl'))` instead of `/`.

`app/page.tsx` sends an authenticated user to `/apps` instead of `/app-management`. Unauthenticated users never reach it (the middleware redirects them), but the existing fallback to `/apps` stays.

## 3. Identity in the browser

`hooks/use-auth.ts` reads the next-auth session (`useSession`) instead of localStorage:

```ts
export const useAuth = () => ({
	isAuthorized: status === 'authenticated',
	isLoading: status === 'loading',
	userId: session?.user?.email ?? null,
	goAuthorize: () => router.push('/login'),
})
```

Consumers (`hooks/useX`, `chat-layout-wrapper.tsx`, `chatbox-wrapper.tsx`) keep using `userId` unchanged; it now carries the email. The browser still sends it to the proxy routes, where it is overwritten.

`app/(user)/layout.tsx`: while `isLoading`, render a centred `Spin` instead of the page, so the chat hooks never run with a null user; when `!isAuthorized`, `router.replace('/login')` (a safety net behind the middleware). The `/auth` redirect is removed.

## 4. Identity on the server

`getUserIdFromRequest` in `lib/api-utils.ts` becomes:

```ts
export async function getUserIdFromRequest(): Promise<string | null> {
	const session = await getServerSession(authOptions)
	return session?.user?.email ?? null
}
```

Every route under `app/api/client/dify/[appId]/` that forwards a `user` to Dify does, at the top of the handler:

```ts
const userId = await getUserIdFromRequest()
if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

and then sets the forwarded value from `userId`, replacing whatever the browser sent, in the place that route uses:

| Route                                    | Where the user travels                 |
| ---------------------------------------- | -------------------------------------- | --- | -------- |
| `audio2text`                             | form field `user`                      |
| `chat-messages`                          | JSON body `user`                       |
| `chat-messages/[taskId]/stop`            | JSON body `user`                       |
| `completion-messages`                    | JSON body `user`                       |
| `conversation/[conversationId]` (delete) | JSON body `user`                       |
| `conversation/[conversationId]/messages` | query `user`                           |
| `conversation/[conversationId]/name`     | JSON body `user`                       |
| `conversations`                          | query `user`                           |
| `feedback`                               | JSON body `user`                       |
| `files/upload`                           | form field `user`                      |
| `form/human_input/[formToken]`           | JSON body `user` (no longer `body.user |     | userId`) |
| `messages/[messageId]/feedbacks`         | JSON body `user`                       |
| `messages/[messageId]/suggested`         | query `user`                           |
| `text2audio`                             | JSON body `user`                       |
| `workflow/[taskId]/events`               | query `user`                           |
| `workflows/run`                          | JSON body `user`                       |

Routes that forward no user (`apps`, `apps/[id]`, `annotations`, `info`, `meta`, `parameters`, `site`, `files/[fileId]/preview`) are protected by the middleware's 401 only.

The implementation plan verifies this table against the code before editing; any route found to forward `user` in a way not listed here is handled the same way.

## 5. Logout on the chat side

The chat header's settings menu (`components/chat/chat-layout.tsx`) and the app discovery page (`app/(user)/apps/page.tsx`) get an account section: a disabled line "Signed in as {{email}}" and a "Log out" item. Log out uses the same flow as the admin header (`signOut({ redirect: false })`, then `router.push('/login')`), extracted into a fork-owned `components/auth/logout-menu-items.ts` helper that returns the menu items, so both places share it.

New translation key in `en`, `zh`, `ar`: `auth.signed_in_as` = "Signed in as {{email}}" / "当前登录：{{email}}" / "مسجّل الدخول باسم {{email}}".

## 6. Effects and risks

- Dify's "End User" column and Langfuse's `user_id` show the email from the first message after deployment. Conversations created under fingerprint ids are no longer listed for anyone. Fine for test instances; worth announcing before a production rollout.
- Emails are sent to the Dify server and, through it, to Langfuse. Both are company-internal in this deployment.
- Open redirect after login is prevented by `getSafeCallbackUrl`.
- Password reset still signs the account out everywhere through upstream's `sessionVersion` check in the JWT callback; nothing here changes session lifetime (30 days by default).
- Every account can open the admin pages. That is the agreed step-1 behaviour; roles come later.

## 7. Verification

Unit tests (Vitest, node environment):

- `lib/access.ts`: public paths, client API paths, callback URL safety (relative path kept; absolute URL, `//evil`, empty and null fall back to `/`).
- `getUserIdFromRequest`: returns the email when `getServerSession` resolves a session, `null` otherwise (`vi.mock('next-auth/next')`).
- `logout-menu-items`: the items carry the signed-in email and a logout action.

Static checks: `pnpm exec tsc --noEmit`, `pnpm exec oxlint`, `pnpm build`.

Manual, by the user (per `AGENTS.md`): opening `/apps` signed out redirects to `/login` and returns there after login; `curl /api/client/apps` without a cookie returns 401; logout from the chat header works; a chat message shows the email as the end user in Dify's logs.

## 8. Merge notes

Documented in `docs/auth-gate.md`:

- After merging upstream, any new route under `app/api/client/` that forwards a `user` must call `getUserIdFromRequest` and use its value; `git grep -n "user" app/api/client` after a merge lists candidates.
- `/auth` and the `x-user-id` header are vestigial; leave them alone unless the fork stops tracking upstream's chat identity.
- Expected conflicts: `proxy.ts` (keep the fork's rule and re-apply upstream's additions inside it), `hooks/use-auth.ts` (keep the fork's version).

## Out of scope

Roles and permissions, LDAP, local/LDAP account tags, automatic deactivation, session lifetime changes, removing the fingerprint dependency, renaming `getUserIdFromRequest`.
