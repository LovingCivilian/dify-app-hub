# Login for All Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page and every `/api/client/*` route requires the existing account login, and the server sends the signed-in account's email to Dify as the end-user id.

**Architecture:** `proxy.ts` enforces the gate for pages (redirect to `/login?callbackUrl=`) and `/api/client/*` (401), using path rules in a fork-owned `lib/access.ts`. A fork-owned `lib/session-user.ts` reads the email from the next-auth session; each of the 16 proxy routes that forward a `user` to Dify calls it and overwrites the browser's value. The browser side swaps the localStorage fingerprint for the session in `hooks/use-auth.ts`, and a fork-owned `AccountMenu` adds "signed in as" + "log out" to the chat and app-list headers.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), next-auth 4.24 (`getToken`, `getServerSession`, `useSession`, `signOut`), Ant Design 6, i18next, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-03-login-for-all-users-design.md`

## Global Constraints

- Fork-only; edits to upstream files are line-level. New behaviour lives in new files where possible.
- Do not touch `app/(user)/auth/page.tsx`, the `x-user-id` header in `lib/dify-client.ts`, or `getUserIdFromRequest` in `lib/api-utils.ts` (vestigial by decision).
- No roles, no LDAP, no schema changes, no `drizzle-kit push`, no dependency changes.
- Dify `user` = `session.user.email`, set only on the server.
- UI text goes through `t()` with keys present in `locales/en`, `locales/zh`, `locales/ar`.
- Commit messages end with the attribution lines used on this branch.
- Do not start the dev server; the user verifies in the browser.

## Review Focus

1. A signed-out request to `/chat/<appId>?x=1` must come back to that exact URL after login (callbackUrl carries path and query). Pinned by Task 1's `isPublicPath`/`getSafeCallbackUrl` tests and Task 2's login change.
2. `callbackUrl=https://evil.example` or `//evil.example` must land on `/`, never leave the site. Pinned in Task 1's `getSafeCallbackUrl` tests.
3. A fresh install (no users) visiting `/login` must still be redirected to `/init`; the gate must not run before upstream's init check for public pages. Pinned by Task 1's ordering in `proxy.ts` and the `isPublicPath('/init/anything')` test.
4. A `/api/client/...` request with a valid cookie but a body `user` of someone else's email must reach Dify with the session's email. Pinned by Task 5/6 edits; no unit test covers the routes, so the reviewer checks each diff for a remaining use of the browser's value.
5. The chat page must not fire requests with `user: null` while the session is still loading. Pinned by Task 3's loading gate in `app/(user)/layout.tsx`.

---

### Task 1: Path rules and the gate in `proxy.ts`

**Files:**

- Create: `lib/access.ts`
- Create: `__tests__/access.test.ts`
- Modify: `proxy.ts`

**Interfaces:**

- Produces: `isPublicPath(pathname: string): boolean`, `isClientApiPath(pathname: string): boolean`, `getSafeCallbackUrl(value: string | null | undefined): string` from `@/lib/access`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/access.test.ts
import { describe, expect, it } from 'vitest'

import { getSafeCallbackUrl, isClientApiPath, isPublicPath } from '@/lib/access'

describe('isPublicPath', () => {
	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/init',
		'/init/anything',
		'/api/auth/signin',
		'/api/auth/callback/credentials',
		'/api/init/status',
		'/api/health',
		'/_next/static/chunk.js',
		'/favicon.ico',
	])('allows %s without a session', pathname => {
		expect(isPublicPath(pathname)).toBe(true)
	})

	it.each([
		'/',
		'/apps',
		'/chat/abc',
		'/app-management',
		'/user-management',
		'/loginx',
		'/api/client/apps',
		'/api/users',
	])('requires a session for %s', pathname => {
		expect(isPublicPath(pathname)).toBe(false)
	})
})

describe('isClientApiPath', () => {
	it('matches the chat-side proxy routes only', () => {
		expect(isClientApiPath('/api/client/apps')).toBe(true)
		expect(isClientApiPath('/api/client/dify/abc/chat-messages')).toBe(true)
		expect(isClientApiPath('/api/users')).toBe(false)
		expect(isClientApiPath('/api/clientele')).toBe(false)
		expect(isClientApiPath('/apps')).toBe(false)
	})
})

describe('getSafeCallbackUrl', () => {
	it('keeps a same-site path with its query', () => {
		expect(getSafeCallbackUrl('/chat/abc?x=1')).toBe('/chat/abc?x=1')
	})

	it.each([
		null,
		undefined,
		'',
		'https://evil.example/',
		'//evil.example',
		'/\\evil.example',
		'chat',
	])('falls back to / for %s', value => {
		expect(getSafeCallbackUrl(value)).toBe('/')
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run __tests__/access.test.ts` Expected: FAIL with `Cannot find package '@/lib/access'`

- [ ] **Step 3: Write `lib/access.ts`**

```ts
// Pages and APIs reachable without a session. Everything else needs one
// (enforced in proxy.ts); /api/* routes outside /api/client check themselves.
const PUBLIC_PREFIXES = [
	'/login',
	'/forgot-password',
	'/reset-password',
	'/init',
	'/api/auth',
	'/api/init',
	'/api/health',
	'/_next',
	'/favicon.ico',
]

const startsWithSegment = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(`${prefix}/`)

export const isPublicPath = (pathname: string): boolean =>
	PUBLIC_PREFIXES.some(prefix => startsWithSegment(pathname, prefix))

export const isClientApiPath = (pathname: string): boolean =>
	startsWithSegment(pathname, '/api/client')

/**
 * The callbackUrl the login page may navigate to: a same-site path, else "/".
 */
export const getSafeCallbackUrl = (value: string | null | undefined): string => {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return '/'
	}
	return value
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run __tests__/access.test.ts` Expected: PASS, 22 tests

- [ ] **Step 5: Edit `proxy.ts`**

Replace the body of `proxy` and the matcher. Final file:

```ts
// @ts-expect-error next-auth v4 jwt type resolution
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isClientApiPath, isPublicPath } from '@/lib/access'

export async function proxy(request: NextRequest) {
	const { pathname, origin } = request.nextUrl

	// 跳过 API 和静态资源
	if (pathname.startsWith('/api') && !isClientApiPath(pathname)) return NextResponse.next()
	if (pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next()

	// 允许访问初始化页面本身
	if (pathname.startsWith('/init')) return NextResponse.next()

	// 全站鉴权：公开页面以外都需要登录
	if (!isPublicPath(pathname)) {
		const token = await getToken({ req: request })
		if (!token) {
			if (isClientApiPath(pathname)) {
				return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
			}
			const loginUrl = new URL('/login', request.url)
			loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search)
			return NextResponse.redirect(loginUrl)
		}
		if (isClientApiPath(pathname)) return NextResponse.next()
	}

	try {
		const res = await fetch(`${origin}/api/init/status`, { cache: 'no-store' })
		const data = await res.json()
		const isInitialized = !!data.initialized

		if (!isInitialized) {
			const url = new URL('/init', request.url)
			return NextResponse.redirect(url)
		}
	} catch (error) {
		console.error('初始化状态检查失败:', error)
		// 状态检查失败时不阻断访问，允许后续页面处理
	}

	return NextResponse.next()
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

Notes for the implementer: the old matcher excluded every `/api` path, so the proxy never ran for them; the new matcher lets `/api/client/*` through to the gate while the first line still skips every other `/api` route. Public pages (`/login` etc.) skip the token check but still go through upstream's init-status redirect, as before.

- [ ] **Step 6: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint proxy.ts lib/access.ts __tests__/access.test.ts` Expected: no output from either (clean)

- [ ] **Step 7: Commit**

```bash
pnpm exec oxfmt --write proxy.ts lib/access.ts __tests__/access.test.ts
git add proxy.ts lib/access.ts __tests__/access.test.ts
git commit -m "feat(auth): require a session for every page and /api/client route"
```

---

### Task 2: Login returns to `callbackUrl`; `/` lands on `/apps`

**Files:**

- Modify: `app/login/page.tsx:22-41`
- Modify: `app/page.tsx:14`

**Interfaces:**

- Consumes: `getSafeCallbackUrl` from Task 1.

- [ ] **Step 1: Edit the login page**

Add the import:

```ts
import { getSafeCallbackUrl } from '@/lib/access'
```

Change the success branch from `router.push('/')` to:

```ts
router.push(getSafeCallbackUrl(searchParams.get('callbackUrl')))
```

- [ ] **Step 2: Edit the root page**

In `app/page.tsx`, change `router.replace('/app-management')` to `router.replace('/apps')`.

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit` Expected: clean

- [ ] **Step 4: Commit**

```bash
pnpm exec oxfmt --write app/login/page.tsx app/page.tsx
git add app/login/page.tsx app/page.tsx
git commit -m "feat(auth): return to the requested page after login, land on /apps"
```

---

### Task 3: Browser identity from the session

**Files:**

- Modify: `hooks/use-auth.ts` (whole file)
- Modify: `app/(user)/layout.tsx:18-41`

**Interfaces:**

- Produces: `useAuth(): { isAuthorized: boolean; isLoading: boolean; userId: string | null; goAuthorize: () => void }`. Consumers (`hooks/useX/index.ts`, `components/chat/chat-layout-wrapper.tsx`, `components/chat/chatbox-wrapper.tsx`) already guard on `userId` and need no change.

- [ ] **Step 1: Rewrite `hooks/use-auth.ts`**

```ts
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

/**
 * Chat-side identity: the signed-in account. `userId` is the account email,
 * which the server also uses as the Dify end-user id.
 */
export const useAuth = () => {
	const router = useRouter()
	const { data: session, status } = useSession()

	return {
		isAuthorized: status === 'authenticated',
		isLoading: status === 'loading',
		goAuthorize: () => router.push('/login'),
		userId: session?.user?.email ?? null,
	}
}
```

- [ ] **Step 2: Edit `app/(user)/layout.tsx`**

Replace the `UserLayoutInner` body so it waits for the session and falls back to `/login`:

```tsx
function UserLayoutInner({ children }: { children: React.ReactNode }) {
	const { isAuthorized, isLoading } = useAuth()
	const router = useRouter()
	const { i18n } = useTranslation()
	const { isDark } = useThemeContext()

	useEffect(() => {
		if (!isLoading && !isAuthorized) {
			router.replace('/login')
		}
	}, [isAuthorized, isLoading, router])

	return (
		<ConfigProvider
			locale={getAntdLocale(i18n.resolvedLanguage)}
			theme={{
				algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
			}}
		>
			<App>
				{isLoading ? (
					<div className="flex min-h-screen items-center justify-center">
						<Spin spinning />
					</div>
				) : (
					children
				)}
			</App>
		</ConfigProvider>
	)
}
```

Update the imports: add `Spin` to the `antd` import, remove `usePathname` from the `next/navigation` import (no longer used).

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint hooks/use-auth.ts "app/(user)/layout.tsx"` Expected: clean

- [ ] **Step 4: Commit**

```bash
pnpm exec oxfmt --write hooks/use-auth.ts "app/(user)/layout.tsx"
git add hooks/use-auth.ts "app/(user)/layout.tsx"
git commit -m "feat(auth): chat side takes its identity from the signed-in session"
```

---

### Task 4: Server identity helper

**Files:**

- Create: `lib/session-user.ts`
- Create: `__tests__/session-user.test.ts`

**Interfaces:**

- Produces: `getSessionUserId(): Promise<string | null>` and `unauthorizedResponse(): NextResponse` from `@/lib/session-user`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/session-user.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: { marker: true } }))

import { getSessionUserId, unauthorizedResponse } from '@/lib/session-user'

describe('getSessionUserId', () => {
	beforeEach(() => getServerSession.mockReset())

	it('returns the signed-in account email', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await expect(getSessionUserId()).resolves.toBe('jane@example.com')
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})

	it('returns null without a session', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(getSessionUserId()).resolves.toBeNull()
	})

	it('returns null when the session has no email', async () => {
		getServerSession.mockResolvedValue({ user: {} })
		await expect(getSessionUserId()).resolves.toBeNull()
	})
})

describe('unauthorizedResponse', () => {
	it('is a 401 JSON error', async () => {
		const response = unauthorizedResponse()
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run __tests__/session-user.test.ts` Expected: FAIL with `Cannot find package '@/lib/session-user'`

- [ ] **Step 3: Write `lib/session-user.ts`**

```ts
import { getServerSession } from 'next-auth/next'
import { NextResponse } from 'next/server'

import { authOptions } from '@/lib/auth'

/**
 * The signed-in account's email, used as the Dify end-user id. Null without a session.
 * Route handlers must use this, never the browser-supplied `user` value.
 */
export async function getSessionUserId(): Promise<string | null> {
	const session = await getServerSession(authOptions)
	return session?.user?.email ?? null
}

export function unauthorizedResponse() {
	return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run __tests__/session-user.test.ts` Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
pnpm exec oxfmt --write lib/session-user.ts __tests__/session-user.test.ts
git add lib/session-user.ts __tests__/session-user.test.ts
git commit -m "feat(auth): session-based end-user id for the Dify proxy routes"
```

---

### Task 5: Routes that used `getUserIdFromRequest` (9 routes)

**Files (all under `app/api/client/dify/[appId]/`):**

- Modify: `audio2text/route.ts`, `chat-messages/[taskId]/stop/route.ts`, `completion-messages/route.ts`, `conversation/[conversationId]/route.ts`, `conversation/[conversationId]/name/route.ts`, `feedback/route.ts`, `form/human_input/[formToken]/route.ts`, `text2audio/route.ts`, `workflows/run/route.ts`

**Interfaces:**

- Consumes: `getSessionUserId`, `unauthorizedResponse` from Task 4.

- [ ] **Step 1: In each of the 9 files, swap the helper**

Remove `getUserIdFromRequest` from the `@/lib/api-utils` import (keep the other named imports; delete the import line entirely if it becomes empty) and add:

```ts
import { getSessionUserId, unauthorizedResponse } from '@/lib/session-user'
```

Replace the line

```ts
const userId = getUserIdFromRequest(request)
```

with

```ts
const userId = await getSessionUserId()
if (!userId) return unauthorizedResponse()
```

Two files need one more change:

- `audio2text/route.ts`: the browser's form data may already carry `user`, so change `proxyFormData.append('user', userId)` to `proxyFormData.set('user', userId)`.
- `form/human_input/[formToken]/route.ts`: change `user: body.user || userId,` to `user: userId,`.

- [ ] **Step 2: Confirm no route still calls the old helper**

Run: `git grep -n "getUserIdFromRequest" -- app` Expected: no output

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint app/api/client` Expected: clean. (`request` may become an unused parameter in some handlers; that is allowed by the project's lint config. If oxlint reports it, rename the parameter to `_request`.)

- [ ] **Step 4: Commit**

```bash
pnpm exec oxfmt --write app/api/client
git add app/api/client
git commit -m "feat(auth): proxy routes take the Dify user from the session"
```

---

### Task 6: Routes that read `user` from body, form or query (7 routes)

**Files (all under `app/api/client/dify/[appId]/`):**

- Modify: `chat-messages/route.ts:28`, `conversation/[conversationId]/messages/route.ts:33-40`, `conversations/route.ts:32-45`, `files/upload/route.ts:25`, `messages/[messageId]/feedbacks/route.ts:24-34`, `messages/[messageId]/suggested/route.ts:25-31`, `workflow/[taskId]/events/route.ts:23-32`

**Interfaces:**

- Consumes: `getSessionUserId`, `unauthorizedResponse` from Task 4.

- [ ] **Step 1: Add the import to all 7 files**

```ts
import { getSessionUserId, unauthorizedResponse } from '@/lib/session-user'
```

- [ ] **Step 2: Add the session check right after `await params` in each handler**

```ts
const userId = await getSessionUserId()
if (!userId) return unauthorizedResponse()
```

- [ ] **Step 3: Replace the browser's value in each file**

- `chat-messages/route.ts`: `const data = await request.json()` → `const data = { ...(await request.json()), user: userId }`
- `conversation/[conversationId]/messages/route.ts`: delete the `const user = request.nextUrl.searchParams.get('user')` line and the `if (!user) { ... 404 ... }` block; change `fullSearchParams.append('user', user)` to `fullSearchParams.append('user', userId)`
- `conversations/route.ts`: delete `const user = searchParams.get('user')`; replace the `if (user) { fullSearchParams.append('user', user) }` block with `fullSearchParams.append('user', userId)`
- `files/upload/route.ts`: after `const proxyFormData = await createFormDataProxy(request)` add `proxyFormData.set('user', userId)`
- `messages/[messageId]/feedbacks/route.ts`: `const { rating, content, user } = await request.json()` → `const { rating, content } = await request.json()`; in the body, `user,` → `user: userId,`
- `messages/[messageId]/suggested/route.ts`: delete `const user = request.nextUrl.searchParams.get('user')`; in the endpoint string use `` `/messages/${messageId}/suggested?user=${encodeURIComponent(userId)}` ``
- `workflow/[taskId]/events/route.ts`: delete `const user = searchParams.get('user')` (and `const { searchParams } = new URL(request.url)` if nothing else uses it); build the URL as `` `${app.requestConfig.apiBase}/workflow/${taskId}/events?user=${encodeURIComponent(userId)}` ``

- [ ] **Step 4: Confirm no proxy route still forwards a browser-supplied user**

Run: `git grep -nE "searchParams.get\('user'\)|body\.user|\buser,$|\buser\b\s*\}" -- app/api/client` Expected: no output

- [ ] **Step 5: Type-check, lint, full test suite**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint app/api/client && pnpm vitest run` Expected: tsc and oxlint clean; all tests pass (the suite from Task 4 plus earlier files)

- [ ] **Step 6: Commit**

```bash
pnpm exec oxfmt --write app/api/client
git add app/api/client
git commit -m "feat(auth): ignore the browser-supplied Dify user in every proxy route"
```

---

### Task 7: Account menu with "signed in as" and "log out"

**Files:**

- Create: `components/auth/account-menu.tsx`
- Create: `__tests__/account-menu.test.ts`
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (area `auth`)
- Modify: `components/chat/chat-layout.tsx:296-351` (mobile menu) and `:427-441` (desktop right icons)
- Modify: `components/chat/common-layout.tsx:22`
- Modify: `app/(user)/apps/page.tsx:28-35`

**Interfaces:**

- Produces: `getAccountMenuItems({ email, t, onLogout })` (`t: TFunction` from i18next), `useLogout()` and default export `AccountMenu` from `@/components/auth/account-menu`.

- [ ] **Step 1: Add the translation key to all three locales, under `auth`, after `logout`**

```json
"signed_in_as": "Signed in as {{email}}"
```

```json
"signed_in_as": "当前登录：{{email}}"
```

```json
"signed_in_as": "مسجّل الدخول باسم {{email}}"
```

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/account-menu.test.ts
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { getAccountMenuItems } from '@/components/auth/account-menu'

// A stand-in for i18next's t that makes the key and options visible in the output.
const t = ((key: string, options?: Record<string, string>) =>
	options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction

describe('getAccountMenuItems', () => {
	it('shows the signed-in email as a disabled line and a logout action', () => {
		const onLogout = vi.fn()
		const items = getAccountMenuItems({ email: 'jane@example.com', t, onLogout })

		expect(items).toHaveLength(2)
		expect(items[0]).toMatchObject({
			key: 'account',
			disabled: true,
			label: 'auth.signed_in_as:{"email":"jane@example.com"}',
		})
		expect(items[1]).toMatchObject({ key: 'logout', label: 'auth.logout' })
		;(items[1] as { onClick: () => void }).onClick()
		expect(onLogout).toHaveBeenCalledTimes(1)
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run __tests__/account-menu.test.ts` Expected: FAIL with `Cannot find package '@/components/auth/account-menu'`

- [ ] **Step 4: Write `components/auth/account-menu.tsx`**

```tsx
'use client'

import { LogoutOutlined } from '@ant-design/icons'
import { Dropdown, GetProp } from 'antd'
import type { TFunction } from 'i18next'
import { signOut, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import LucideIcon from '@/components/shared/lucide-icon'

type MenuItems = NonNullable<GetProp<typeof Dropdown, 'menu'>['items']>

interface IAccountMenuItemsOptions {
	email: string
	t: TFunction
	onLogout: () => void
}

/**
 * Menu entries shared by the desktop dropdown and the chat page's mobile menu.
 */
export const getAccountMenuItems = ({
	email,
	t,
	onLogout,
}: IAccountMenuItemsOptions): MenuItems => [
	{
		key: 'account',
		label: t('auth.signed_in_as', { email }),
		disabled: true,
	},
	{
		key: 'logout',
		icon: <LogoutOutlined />,
		label: t('auth.logout'),
		onClick: onLogout,
	},
]

/**
 * Same sign-out flow as the admin header.
 */
export const useLogout = () => {
	const router = useRouter()
	return async () => {
		await signOut({ redirect: false })
		router.push('/login')
	}
}

/**
 * Account dropdown for the chat-side headers.
 */
export default function AccountMenu() {
	const { t } = useTranslation()
	const { data: session } = useSession()
	const logout = useLogout()
	const email = session?.user?.email

	if (!email) return null

	return (
		<Dropdown
			arrow
			placement="bottomRight"
			menu={{ items: getAccountMenuItems({ email, t, onLogout: logout }) }}
		>
			<div className="flex cursor-pointer items-center">
				<LucideIcon
					name="circle-user"
					size={20}
				/>
			</div>
		</Dropdown>
	)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run __tests__/account-menu.test.ts` Expected: PASS, 1 test

- [ ] **Step 6: Wire the chat page (`components/chat/chat-layout.tsx`)**

Add imports:

```ts
import { useSession } from 'next-auth/react'
import AccountMenu, { getAccountMenuItems, useLogout } from '@/components/auth/account-menu'
```

Inside the component, next to the other hooks, add:

```ts
const { data: session } = useSession()
const logout = useLogout()
```

In the `mobileMenuItems` function, after the `conversationListMenus` definition and before the `if (isTempId(currentConversationId))` line, add:

```ts
const accountMenus: GetProp<typeof Dropdown, 'menu'>['items'] = session?.user?.email
	? [
			{ type: 'divider' },
			...getAccountMenuItems({ email: session.user.email, t, onLogout: logout }),
		]
	: []
```

and change the two return statements to append it:

```ts
if (isTempId(currentConversationId)) {
	return [...conversationListMenus, ...accountMenus]
}

return [...actionMenus, ...i18nLanguageMenus, ...conversationListMenus, ...accountMenus]
```

In the desktop `renderRightIcons` callback, add `<AccountMenu />` after `{github}`:

```tsx
{
	theme
}
{
	github
}
;<AccountMenu />
```

- [ ] **Step 7: Wire the workflow layout (`components/chat/common-layout.tsx`)**

Add the import `import AccountMenu from '@/components/auth/account-menu'` and change the header line to:

```tsx
<HeaderLayout
	title={renderCenterTitle?.(currentApp?.config?.info)}
	renderRightIcons={({ theme, github }) => (
		<div className="flex items-center gap-4">
			{theme}
			{github}
			<AccountMenu />
		</div>
	)}
/>
```

- [ ] **Step 8: Wire the app list (`app/(user)/apps/page.tsx`)**

Add the import `import AccountMenu from '@/components/auth/account-menu'` and change the top bar to push the menu to the right:

```tsx
<div className="flex items-center px-3 py-2">
	<LucideIcon
		name="layout-grid"
		size={16}
		className="mr-1"
	/>
	{t('app.list')}
	<div className="ml-auto">
		<AccountMenu />
	</div>
</div>
```

- [ ] **Step 9: Type-check, lint, full suite, i18n lint**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint && pnpm vitest run && pnpm i18n:lint; true` Expected: tsc and oxlint clean; all tests pass (locale parity now includes the new key); `i18n:lint` reports the same 9 pre-existing upstream findings and nothing in the new or edited files.

- [ ] **Step 10: Commit**

```bash
pnpm exec oxfmt --write components/auth/account-menu.tsx __tests__/account-menu.test.ts components/chat/chat-layout.tsx components/chat/common-layout.tsx "app/(user)/apps/page.tsx" locales
git add components/auth/account-menu.tsx __tests__/account-menu.test.ts components/chat/chat-layout.tsx components/chat/common-layout.tsx "app/(user)/apps/page.tsx" locales
git commit -m "feat(auth): account menu with sign-out on the chat side"
```

---

### Task 8: Maintenance notes and final build

**Files:**

- Create: `docs/auth-gate.md`
- Modify: `docs/i18n-maintenance.md` (one line in "Lines the git grep is expected to print" is unaffected; no change needed unless the grep output changes)

- [ ] **Step 1: Write `docs/auth-gate.md`**

````markdown
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
````

Expected: no output. For any hit, add `const userId = await getSessionUserId(); if (!userId) return unauthorizedResponse()` and use `userId`. 2. New routes under `app/api/client/` are gated by the middleware automatically; new pages too. New public pages (if upstream adds any) go into `PUBLIC_PREFIXES` in `lib/access.ts`. 3. Expected conflicts: `proxy.ts` (keep the fork's gate, re-apply upstream's additions inside it), `hooks/use-auth.ts` (keep the fork's version), `app/(user)/layout.tsx` (keep the loading gate).

## Known limits (step 1)

- No roles: every account can open the admin pages.
- Conversations created before the gate (fingerprint ids) are not listed.
- Sessions last 30 days (next-auth default); password reset signs out everywhere.

````

- [ ] **Step 2: Production build**

Run: `pnpm build 2>&1 | tail -5`
Expected: `✓ Compiled successfully` and the route table; no errors

- [ ] **Step 3: CII assessment check**

Open `.cii-assessment.md` and confirm no item's pass/fail status changes (tests and docs items were already ✅). Expected: no edit.

- [ ] **Step 4: Commit**

```bash
pnpm exec oxfmt --write docs/auth-gate.md
git add docs/auth-gate.md
git commit -m "docs(auth): maintenance notes for the login gate"
````
