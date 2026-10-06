# Chat on Ant Design X — Implementation Plan (frontend overhaul, sub-project 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/chat/[appId]` page for every Dify app mode on Ant Design X 2 and antd 6, with a server-side session gate, cookie-backed theme, the full stub Dify event catalogue and an end-to-end suite that covers every stream type.

**Architecture:** One `DifyChatProvider` (an x-sdk `AbstractChatProvider`) turns every Dify stream event into a typed `DifyChatMessage`; `useXChat` runs with `conversationKey`, async `defaultMessages` and `queueRequest` so history and live replies share one store; X components render through `contentRender`; the three kept-custom pieces (workflow logs, HITL form, file list) are antd primitives styled from tokens. Route group layouts check the session on the server, the root layout reads the theme from cookies, and the stub Dify API serves five apps by path prefix with events built from Dify's OpenAPI document.

**Tech Stack:** Next 16.3 (App Router), React 19, antd 6.6, `@ant-design/x` 2.9, `@ant-design/x-sdk` 2.9, `@ant-design/x-markdown` 2.9, next-auth 4.24, react-i18next, Playwright 1.63 with the stub Dify API, vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md` — read it first; every task below cites its section.

## Global Constraints

- Documented library approaches only (ADR-0002): every antd/X/x-sdk/Next/next-auth API used must appear in `.claude/skills/*` references, Next's bundled docs under `node_modules/next/dist/docs/`, next-auth's docs, or the installed `.d.ts`; implementers name the source in their task report. No private imports (`antd/es/...` internals), no `!important`, no patched packages.
- Versions: `antd` 6.6.5, `@ant-design/x` 2.9.0, `@ant-design/x-sdk` 2.9.0, `@ant-design/x-markdown` 2.9.0, `next` 16.3.4, `next-auth` 4.24. No new dependency. Removals only in Task 19.
- Styling (charter §4.3): antd component first; static styles in a colocated `*.module.css` with `var(--ant-*)` values only; runtime values through `theme.useToken()` and the `style` prop; `@media` queries written with antd's screen token values and a comment naming the token (`767px /* screenSMMax */`, `768px /* screenMD */`); no hex/rgb literals, Tailwind classes, Lucide icons, `--theme-*` or shadcn classes anywhere under `components/chat/`.
- Exactly one `XProvider` + `App` at the root (`components/providers/app-providers.tsx`); nothing in the chat mounts a `ConfigProvider`/`XProvider`. The providers e2e test must stay green.
- All UI text through i18next keys present in `locales/en`, `locales/zh` and `locales/ar` (typed; `pnpm test` checks parity). Icon-only buttons carry `aria-label` and `title` from keys (ADR-0014); product names are the only literal labels.
- `'use client'` only on interactive leaves and providers; `app/` is routing only; URLs never change.
- Backend untouched: nothing under `app/api/**`, `db/**`, `services/`, `repository/`, `lib/auth.ts`, `lib/dify-client.ts`, `proxy.ts`. The only non-frontend file edited is the fork-owned `lib/session-user.ts` (Task 2).
- Tests: vitest in `__tests__/` (node environment, no DOM tests; mock modules with `vi.hoisted` + `vi.mock` as `__tests__/session-user.test.ts` does); Playwright specs in `e2e/` (web-first assertions, role and name locators, `test.skip(condition, reason)` for project-specific cases, never `networkidle`).
- Before every commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --write <changed files>` (lint-staged re-runs them), `pnpm test`. Playwright runs (`pnpm test:e2e`) need `pnpm dev` stopped (one `next dev` per checkout; ports 5301/3307/5399).
- Commits: conventional (`feat|fix|docs|test|chore(scope): …`), English, each ending with the two trailers below. Commit only the task's files (`git add <paths>`, never `git add -A`).

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3
```

## Review Focus

Five conditions the spec implies but no feature flow exercises on its own; each has its pinning test in the task named.

1. **A stream chunk that is not JSON, or is `[DONE]`** — the provider must return the message unchanged, never throw and never blank the answer. Test in Task 6 (`applyEvent` / `transformMessage` with junk data).
2. **Theme cookies with junk or missing values** (`theme=purple`, only one of the two cookies set) — the server must fall back to `system` + `light` and still render. Test in Task 1.
3. **A history message with `status: 'error'` and an empty answer** — it must render as an error bubble, not as the "empty answer" state, and its user turn must still show. Test in Task 7.
4. **Switching conversation while a reply is still streaming** — the stream must keep updating the conversation it belongs to, `isRequesting` must be true only for that key, and switching back must show the finished reply. Pinned by the provider-cache unit test in Task 8 and the e2e flow "switching away during a reply does not lose it" in Task 9's `chat.spec.ts` (Task 16's `chat-mobile.spec.ts` switches conversations on mobile).
5. **A HITL form whose `expiration_time` is already in the past when it arrives** — the form renders in the expired state with disabled controls instead of a negative countdown. Test in Task 13.

---

## File structure

New and changed files, grouped by responsibility (deleted files are listed in Task 19):

```
lib/theme/theme-cookie.ts                 cookie names, readThemeCookies(), themeCookieStrings()           (Task 1)
lib/theme/theme-context.tsx               initialTheme prop, writes cookies, legacy migration             (Task 1)
components/providers/app-providers.tsx    session + initialTheme props                                    (Tasks 1–2)
app/layout.tsx                            reads cookies + session, body class                             (Tasks 1–2)
lib/session-user.ts                       getCachedServerSession(), requireSessionUser()                  (Task 2)
app/(user)/layout.tsx, app/(admin)/layout.tsx   async server gates                                        (Task 2)
hooks/use-auth.ts                         userId only                                                     (Task 2)
components/shell/app-header.tsx(.module.css)    both breakpoint variants, CSS switch                     (Task 3)
components/shell/shell.module.css         100vh → 100dvh                                                  (Task 3)
components/chat/message/message-markdown.tsx    the one Markdown entry point                             (Task 4)
components/chat/message/markdown/*        code-block, think-block, answer-form, answer-button,
                                          markdown-image, echarts-block, svg-block, dompurify-config,
                                          components (stable map), send-context                            (Task 4)
e2e/fixtures/markdown-samples.ts          recorded Dify payloads (spike + stub)                           (Task 4)
e2e/fixtures/stub/*                       server, router, store, events, scenarios, apps                  (Task 5)
components/chat/provider/message.ts       DifyChatMessage, DifyChatInput, event types                     (Task 6)
components/chat/provider/keys.ts          conversation keys                                               (Task 6)
components/chat/provider/dify-fetch.ts    DifyRequestError, createDifyFetch()                             (Task 6)
components/chat/provider/dify-chat-provider.ts  applyEvent(), DifyChatProvider                           (Task 6)
components/chat/persistence/*             workflow-data-storage, think-time-storage (moved)               (Task 6)
components/chat/provider/history.ts       mapHistoryPage()                                                (Task 7)
components/chat/provider/conversations.ts toConversationItems(), groupFor()                               (Task 7)
components/chat/provider/provider-cache.ts, hooks/use-dify-chat.ts, hooks/use-conversations.ts,
components/chat/hooks/bubble-items.ts     the x-sdk wiring                                                (Task 8)
components/chat/app-context.tsx, chat-workspace.tsx, chat-view/* (view, sidebar, list, sender, css)
app/(user)/chat/page.tsx, app/(user)/chat/[appId]/page.tsx                                              (Task 9)
components/chat/chat-view/welcome-panel.tsx, inputs-form.tsx, inputs-collapse.tsx,
components/chat/hooks/use-suggestions.ts                                                                (Task 10)
components/chat/message/reasoning.tsx, agent-thoughts.tsx, message-sources.tsx, message-files.tsx,
components/chat/chat-view/assistant-content.tsx, user-content.tsx                                        (Task 11)
components/chat/message/workflow-logs.tsx, workflow-node-icon.tsx                                        (Task 12)
components/chat/message/human-input-form.tsx                                                            (Task 13)
components/chat/chat-view/message-footer.tsx, dislike-popover.tsx, annotation-drawer.tsx,
components/chat/hooks/use-tts.ts                                                                        (Task 14)
components/chat/chat-view/chat-sender.tsx (full), file-types.ts, components/chat/hooks/use-speech-to-text.ts (Task 15)
components/chat/chat-view/conversation-drawer.tsx, conversation-menu.ts                                  (Task 16)
components/chat/hooks/use-workflow-run.ts, workflow-view/*, completion-view/*                            (Task 17)
libs/x-locale.ts, libs/x-locale-ar.ts                                                                   (Task 18)
docs/decisions/0016, 0017, 0018 + dated notes; docs/*.md; CLAUDE.md                                    (Tasks 1, 2, 4, 19)
```

---

### Task 1: Theme preference in cookies, server-rendered colour scheme

**Spec:** §3.2, §2 "Dark first paint". ADR-0016.

**Files:**
- Create: `lib/theme/theme-cookie.ts`, `__tests__/theme-cookie.test.ts`, `e2e/ssr-first-paint.spec.ts`, `docs/decisions/0016-store-the-theme-preference-in-cookies.md` (via the ADR script)
- Modify: `lib/theme/theme-context.tsx`, `components/providers/app-providers.tsx`, `app/layout.tsx`, `docs/decisions/README.md` (index, by the script)

**Interfaces:**
- Produces: `readThemeCookies(get: (name: string) => string | undefined): InitialTheme`, `themeCookieStrings(mode: ThemeModeEnum, resolved: ThemeEnum, secure: boolean): string[]`, `THEME_COOKIE = 'theme'`, `THEME_MODE_COOKIE = 'theme-mode'`, `type InitialTheme = { mode: ThemeModeEnum; resolved: ThemeEnum }`, `DEFAULT_INITIAL_THEME`.
- `ThemeContextProvider({ initialTheme?: InitialTheme, children })`; `AppProviders({ initialTheme: InitialTheme, children })` (Task 2 adds `session`).

- [ ] **Step 1: Write the failing unit tests**

`__tests__/theme-cookie.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { ThemeEnum, ThemeModeEnum } from '@/lib/theme/constants'
import {
	DEFAULT_INITIAL_THEME,
	readThemeCookies,
	THEME_COOKIE,
	THEME_MODE_COOKIE,
	themeCookieStrings,
} from '@/lib/theme/theme-cookie'

const store = (values: Record<string, string>) => (name: string) => values[name]

describe('readThemeCookies', () => {
	it('defaults to system mode and the light scheme without cookies', () => {
		expect(readThemeCookies(store({}))).toEqual(DEFAULT_INITIAL_THEME)
		expect(DEFAULT_INITIAL_THEME).toEqual({ mode: ThemeModeEnum.SYSTEM, resolved: ThemeEnum.LIGHT })
	})

	it('reads an explicit dark mode and resolves it to dark whatever the resolved cookie says', () => {
		expect(readThemeCookies(store({ [THEME_MODE_COOKIE]: 'dark', [THEME_COOKIE]: 'light' }))).toEqual({
			mode: ThemeModeEnum.DARK,
			resolved: ThemeEnum.DARK,
		})
	})

	it('keeps the last resolved scheme for system mode', () => {
		expect(readThemeCookies(store({ [THEME_MODE_COOKIE]: 'system', [THEME_COOKIE]: 'dark' }))).toEqual({
			mode: ThemeModeEnum.SYSTEM,
			resolved: ThemeEnum.DARK,
		})
	})

	// Review Focus 2: junk or partial cookies never break the server render.
	it('falls back per cookie on junk values', () => {
		expect(readThemeCookies(store({ [THEME_MODE_COOKIE]: 'purple', [THEME_COOKIE]: 'dark' }))).toEqual({
			mode: ThemeModeEnum.SYSTEM,
			resolved: ThemeEnum.DARK,
		})
		expect(readThemeCookies(store({ [THEME_MODE_COOKIE]: 'light' }))).toEqual({
			mode: ThemeModeEnum.LIGHT,
			resolved: ThemeEnum.LIGHT,
		})
		expect(readThemeCookies(store({ [THEME_COOKIE]: 'neon' }))).toEqual(DEFAULT_INITIAL_THEME)
	})
})

describe('themeCookieStrings', () => {
	it('produces two one-year, lax, path-wide cookies', () => {
		expect(themeCookieStrings(ThemeModeEnum.DARK, ThemeEnum.DARK, false)).toEqual([
			'theme-mode=dark; Path=/; Max-Age=31536000; SameSite=Lax',
			'theme=dark; Path=/; Max-Age=31536000; SameSite=Lax',
		])
	})

	it('adds Secure when the page is served over https', () => {
		for (const cookie of themeCookieStrings(ThemeModeEnum.SYSTEM, ThemeEnum.LIGHT, true)) {
			expect(cookie.endsWith('; Secure')).toBe(true)
		}
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run __tests__/theme-cookie.test.ts`
Expected: FAIL — `Cannot find module '@/lib/theme/theme-cookie'`.

- [ ] **Step 3: Implement `lib/theme/theme-cookie.ts`**

```ts
// ADR-0016: theme preference in cookies so the server renders the right scheme — docs/decisions/0016-store-the-theme-preference-in-cookies.md
import { ThemeEnum, ThemeModeEnum } from './constants'

export const THEME_MODE_COOKIE = 'theme-mode'
export const THEME_COOKIE = 'theme'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export interface InitialTheme {
	mode: ThemeModeEnum
	resolved: ThemeEnum
}

export const DEFAULT_INITIAL_THEME: InitialTheme = {
	mode: ThemeModeEnum.SYSTEM,
	resolved: ThemeEnum.LIGHT,
}

const isMode = (value: unknown): value is ThemeModeEnum =>
	value === ThemeModeEnum.SYSTEM || value === ThemeModeEnum.LIGHT || value === ThemeModeEnum.DARK
const isScheme = (value: unknown): value is ThemeEnum =>
	value === ThemeEnum.LIGHT || value === ThemeEnum.DARK

/**
 * The initial theme for a server render, read through any `get(name) => value` accessor
 * (Next's `cookies()` store in app/layout.tsx). Junk or missing values fall back per cookie.
 * An explicit light/dark mode decides the scheme; system mode keeps the last resolved scheme
 * the client stored, because the server cannot see prefers-color-scheme.
 */
export const readThemeCookies = (get: (name: string) => string | undefined): InitialTheme => {
	const mode = get(THEME_MODE_COOKIE)
	const resolved = get(THEME_COOKIE)
	const safeMode = isMode(mode) ? mode : DEFAULT_INITIAL_THEME.mode
	if (safeMode === ThemeModeEnum.DARK) return { mode: safeMode, resolved: ThemeEnum.DARK }
	if (safeMode === ThemeModeEnum.LIGHT) return { mode: safeMode, resolved: ThemeEnum.LIGHT }
	return { mode: safeMode, resolved: isScheme(resolved) ? resolved : DEFAULT_INITIAL_THEME.resolved }
}

/**
 * The two cookie strings the client assigns to document.cookie whenever the mode or the
 * resolved scheme changes. One year, whole site, Lax; Secure on https.
 */
export const themeCookieStrings = (
	mode: ThemeModeEnum,
	resolved: ThemeEnum,
	secure: boolean,
): string[] => {
	const attributes = `Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`
	return [`${THEME_MODE_COOKIE}=${mode}; ${attributes}`, `${THEME_COOKIE}=${resolved}; ${attributes}`]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run __tests__/theme-cookie.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Make the theme context start from the server value and write cookies**

Replace `lib/theme/theme-context.tsx` with:

```tsx
import React, { useCallback, useEffect, useState } from 'react'

import { LocalStorageKeys, LocalStorageStore } from '@/lib/helpers'

import { ThemeEnum, ThemeModeEnum } from './constants'
import { DEFAULT_INITIAL_THEME, InitialTheme, THEME_MODE_COOKIE, themeCookieStrings } from './theme-cookie'

export type IThemeMode = 'light' | 'dark' | 'system'
export type ICurrentTheme = 'light' | 'dark'

export interface IThemeContext {
	theme: ThemeEnum
	themeMode: ThemeModeEnum
	setThemeMode: (theme: ThemeModeEnum) => void
}

export const ThemeContext = React.createContext<IThemeContext>({
	theme: ThemeEnum.LIGHT,
	setThemeMode: () => {},
	themeMode: ThemeModeEnum.SYSTEM,
})

/** Class the dark scheme puts on <body>; app/layout.tsx renders it on the server from the cookie. */
export const DARK_CLASS_NAME = 'dark'

/**
 * Theme mode (system / light / dark) and the resolved scheme. The initial value comes from the
 * server (cookies read in app/layout.tsx), so the first render matches the first HTML on both sides;
 * every change is written back to the two cookies (ADR-0016). System mode follows
 * prefers-color-scheme live.
 */
export const ThemeContextProvider = ({
	initialTheme = DEFAULT_INITIAL_THEME,
	children,
}: {
	initialTheme?: InitialTheme
	children: React.ReactNode
}) => {
	const [themeMode, setThemeMode] = useState<ThemeModeEnum>(initialTheme.mode)
	const [themeState, setThemeState] = useState<ThemeEnum>(initialTheme.resolved)

	// One-time migration from the localStorage keys the fork used before ADR-0016.
	useEffect(() => {
		if (document.cookie.includes(`${THEME_MODE_COOKIE}=`)) return
		const legacy = LocalStorageStore.get(LocalStorageKeys.THEME_MODE) as ThemeModeEnum | null
		if (legacy && Object.values(ThemeModeEnum).includes(legacy)) setThemeMode(legacy)
	}, [])

	const applyScheme = useCallback((dark: boolean) => {
		setThemeState(dark ? ThemeEnum.DARK : ThemeEnum.LIGHT)
		document.body.classList.toggle(DARK_CLASS_NAME, dark)
	}, [])

	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
		if (themeMode !== ThemeModeEnum.SYSTEM) {
			applyScheme(themeMode === ThemeModeEnum.DARK)
			return
		}
		const onChange = (event: MediaQueryList | MediaQueryListEvent) => applyScheme(event.matches)
		onChange(mediaQuery)
		mediaQuery.addEventListener('change', onChange)
		return () => mediaQuery.removeEventListener('change', onChange)
	}, [themeMode, applyScheme])

	useEffect(() => {
		const secure = window.location.protocol === 'https:'
		for (const cookie of themeCookieStrings(themeMode, themeState, secure)) {
			document.cookie = cookie
		}
	}, [themeMode, themeState])

	return (
		<ThemeContext.Provider value={{ theme: themeState, themeMode, setThemeMode }}>
			{children}
		</ThemeContext.Provider>
	)
}

export const useThemeContext = () => {
	const context = React.useContext(ThemeContext)
	return {
		...context,
		isDark: context.theme === ThemeEnum.DARK,
		isLight: context.theme === ThemeEnum.LIGHT,
		isSystemMode: context.themeMode === ThemeModeEnum.SYSTEM,
	}
}
```

`MediaQueryList.addEventListener('change')` is the standard API (MDN); the old `addListener` branch goes.

- [ ] **Step 6: Thread the initial theme through the providers and the root layout**

`components/providers/app-providers.tsx` — change the outer component:

```tsx
import type { InitialTheme } from '@/lib/theme/theme-cookie'

export default function AppProviders({
	initialTheme,
	children,
}: {
	initialTheme: InitialTheme
	children: React.ReactNode
}) {
	return (
		<SessionProvider>
			<ThemeContextProvider initialTheme={initialTheme}>
				<AntdProviders>{children}</AntdProviders>
			</ThemeContextProvider>
		</SessionProvider>
	)
}
```

`app/layout.tsx` (server component; `cookies()` is documented in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` and opts the route into dynamic rendering, which every page already is behind the proxy):

```tsx
import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import AppProviders from '@/components/providers/app-providers'
import { ThemeEnum } from '@/lib/theme/constants'
import { readThemeCookies } from '@/lib/theme/theme-cookie'

import './globals.css'

export const metadata: Metadata = {
	title: 'Dify App Hub',
	description: 'A Dify web app that fits your business',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const cookieStore = await cookies()
	const initialTheme = readThemeCookies(name => cookieStore.get(name)?.value)
	const bodyClass = initialTheme.resolved === ThemeEnum.DARK ? 'antialiased dark' : 'antialiased'
	return (
		<html
			lang="en"
			suppressHydrationWarning
		>
			<body className={bodyClass}>
				<AntdRegistry>
					<AppProviders initialTheme={initialTheme}>{children}</AppProviders>
				</AntdRegistry>
			</body>
		</html>
	)
}
```

Import only `lib/theme/constants` and `lib/theme/theme-cookie` here (no React context code in a server component).

- [ ] **Step 7: Type-check, lint, run the unit suite**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint lib/theme app/layout.tsx components/providers && pnpm test`
Expected: clean; vitest all green (the existing `use-html-lang` and locale tests are unaffected).

- [ ] **Step 8: Write the first-paint e2e spec**

`e2e/ssr-first-paint.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { baseURL } from './fixtures/env'

/**
 * The server HTML is read with the API request context (shares the page's cookies, Playwright docs:
 * "page.request"), so these assertions see exactly what the browser gets before hydration.
 */
test('the first HTML carries the dark scheme when the theme cookies say so', async ({ page }) => {
	await page.context().addCookies([
		{ name: 'theme-mode', value: 'dark', url: baseURL },
		{ name: 'theme', value: 'dark', url: baseURL },
	])
	const response = await page.request.get('/apps')
	expect(response.ok()).toBe(true)
	const html = await response.text()
	expect(html).toContain('class="antialiased dark"')
	// The inlined antd <style> is asserted on the production build (Task 20 curl check): next dev may inject it on
	// hydration. In the browser the first observed token value must already be the dark one (#000000, see providers.spec.ts).
	await page.goto('/apps')
	await expect(page.locator('.ant-app').first()).toHaveCSS('--ant-color-bg-layout', '#000000')
})

test('junk theme cookies still render the light default', async ({ page }) => {
	await page.context().addCookies([{ name: 'theme-mode', value: 'purple', url: baseURL }])
	const html = await (await page.request.get('/apps')).text()
	expect(html).toContain('class="antialiased"')
	expect(html).not.toContain('class="antialiased dark"')
})
```

- [ ] **Step 9: Run the e2e suite**

Stop `pnpm dev` if it is running. Run: `pnpm test:e2e`
Expected: the two new tests pass on all three projects; `screenshots.spec.ts` dark captures still wait for `body.dark` and pass (the client sets the class from `prefers-color-scheme` under system mode); everything else unchanged.

- [ ] **Step 10: Record ADR-0016 (proposed)**

Run: `node .claude/skills/adr-skill/scripts/new_adr.js --dir docs/decisions --title "Store the theme preference in cookies so the server renders the right scheme" --status proposed --update-index`

Fill the generated file in the MADR shape the other ADRs use. Context: localStorage is invisible to the server, so server-rendered shells (ADR-0018) painted light for dark-mode users. Decision: `theme-mode` and `theme` cookies (one year, Lax, path-wide), read with `cookies()` in the root layout, passed as `initialTheme`, written by the client on every change; system mode keeps following `prefers-color-scheme`. Consequences: no light-to-dark flash on hard loads; every route is dynamic (already the case); one corrected paint remains when the OS scheme changed since the last visit under system mode; localStorage keys migrated once. Alternatives: accept the flash; inline pre-hydration script (cannot switch antd's algorithm). Verification: `__tests__/theme-cookie.test.ts`, `e2e/ssr-first-paint.spec.ts`, the Docker curl check in Task 20.

- [ ] **Step 11: Commit**

```bash
pnpm exec oxfmt --write lib/theme app/layout.tsx components/providers/app-providers.tsx e2e/ssr-first-paint.spec.ts __tests__/theme-cookie.test.ts
git add lib/theme app/layout.tsx components/providers/app-providers.tsx e2e/ssr-first-paint.spec.ts __tests__/theme-cookie.test.ts docs/decisions
git commit -m "feat(theme): read the theme preference from cookies so the server renders the right scheme" -m "ADR-0016. The theme mode and the last resolved scheme live in two cookies; app/layout.tsx reads them with cookies() and passes the initial theme to the providers, so the first HTML already carries the dark algorithm and the dark body class. The client writes the cookies on every change and migrates the old localStorage keys once." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 2: Server-side session gate for the route groups

**Spec:** §3.1, §3.2 (session), §2 "Gate design". ADR-0018.

**Files:**
- Modify: `lib/session-user.ts`, `__tests__/session-user.test.ts`, `app/(user)/layout.tsx`, `app/(admin)/layout.tsx`, `app/layout.tsx`, `components/providers/app-providers.tsx`, `hooks/use-auth.ts`, `e2e/ssr-first-paint.spec.ts`, `e2e/screenshots.spec.ts`, `docs/auth-gate.md`
- Create: `__tests__/group-layouts.test.ts`, `docs/decisions/0018-gate-route-groups-on-the-server.md`
- Delete: `components/auth/auth-guard.tsx`

**Interfaces:**
- Produces: `getCachedServerSession(): Promise<Session | null>` (React `cache` around `getServerSession(authOptions)`), `requireSessionUser(): Promise<void>` (redirects to `/login` without `user.id`).
- `AppProviders({ session: Session | null, initialTheme, children })`.
- `useAuth(): { userId: string | undefined }` (the chat's identity hook; `isAuthorized`, `isLoading`, `goAuthorize` are removed).

- [ ] **Step 1: Write the failing unit tests**

Append to `__tests__/session-user.test.ts` (same hoisted mocks as the file already has):

```ts
import { getCachedServerSession, requireSessionUser } from '@/lib/session-user'

describe('requireSessionUser', () => {
	beforeEach(() => {
		getServerSession.mockReset()
		redirect.mockReset()
	})

	it('lets a live session through', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await requireSessionUser()
		expect(redirect).not.toHaveBeenCalled()
	})

	it('sends a visitor without a session to the login page', async () => {
		getServerSession.mockResolvedValue(null)
		await requireSessionUser()
		expect(redirect).toHaveBeenCalledWith('/login')
	})

	// A revoked JWT still yields a session object but no user.id (lib/auth.ts session callback).
	it('sends a revoked session to the login page', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await requireSessionUser()
		expect(redirect).toHaveBeenCalledWith('/login')
	})
})

describe('getCachedServerSession', () => {
	it('delegates to getServerSession with the auth options', async () => {
		getServerSession.mockReset()
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await expect(getCachedServerSession()).resolves.toEqual({
			user: { id: 'u1', email: 'jane@example.com' },
		})
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
})
```

Create `__tests__/group-layouts.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getServerSession, redirect } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
// AdminShell is a client component tree; the layout test only cares about the gate.
vi.mock('@/components/shell/admin-shell', () => ({ default: () => null }))

import AdminLayout from '@/app/(admin)/layout'
import UserLayout from '@/app/(user)/layout'

describe.each([
	['(user)', UserLayout],
	['(admin)', AdminLayout],
] as const)('%s layout', (_group, Layout) => {
	beforeEach(() => {
		getServerSession.mockReset()
		redirect.mockReset()
	})

	it('renders for a live session', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await Layout({ children: 'page' })
		expect(redirect).not.toHaveBeenCalled()
	})

	it('redirects a visitor without a session to /login', async () => {
		getServerSession.mockResolvedValue(null)
		await Layout({ children: 'page' })
		expect(redirect).toHaveBeenCalledWith('/login')
	})

	it('redirects a revoked session (no user.id) to /login', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await Layout({ children: 'page' })
		expect(redirect).toHaveBeenCalledWith('/login')
	})
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/session-user.test.ts __tests__/group-layouts.test.ts`
Expected: FAIL — `requireSessionUser` is not exported; the layouts are client components that do not call `getServerSession`.

- [ ] **Step 3: Add the two functions to `lib/session-user.ts`**

```ts
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { cache } from 'react'

import { authOptions } from '@/lib/auth'

/**
 * One getServerSession per request: the root layout (SessionProvider) and a group layout
 * (requireSessionUser) both need it. React's cache() dedupes within a server render.
 */
export const getCachedServerSession = cache(() => getServerSession(authOptions))

export async function getSessionUserId(): Promise<string | null> {
	const session = await getCachedServerSession()
	if (!session?.user?.id) return null
	return session.user.email ?? null
}

export function unauthorizedResponse() {
	return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function redirectSignedInUser(to = '/apps'): Promise<void> {
	const session = await getCachedServerSession()
	if (session?.user?.id) redirect(to)
}

// ADR-0018: route groups gate on the server; the proxy gates navigations — docs/decisions/0018-gate-route-groups-on-the-server.md
/**
 * For the (user) and (admin) group layouts: a visitor without a live session goes to the login
 * page, so the shells render on the server for everyone who stays. The proxy already redirects
 * signed-out page requests with a callbackUrl (a layout cannot read the pathname, Next docs:
 * layout.md "Pathname"); this catches revoked JWTs, which decode but carry no user.id, and
 * replaces the client-side gates. Call it outside any try/catch, since redirect() throws.
 */
export async function requireSessionUser(): Promise<void> {
	const session = await getCachedServerSession()
	if (!session?.user?.id) redirect('/login')
}
```

Keep the existing doc comments on `getSessionUserId` and `redirectSignedInUser`.

- [ ] **Step 4: Turn the group layouts into server gates**

`app/(user)/layout.tsx`:

```tsx
import { requireSessionUser } from '@/lib/session-user'

export const dynamic = 'force-dynamic'

export default async function UserLayout({ children }: { children: React.ReactNode }) {
	await requireSessionUser()
	return children
}
```

`app/(admin)/layout.tsx`:

```tsx
import AdminShell from '@/components/shell/admin-shell'
import { requireSessionUser } from '@/lib/session-user'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	await requireSessionUser()
	return <AdminShell>{children}</AdminShell>
}
```

Delete `components/auth/auth-guard.tsx` (`git rm`). Run `git grep -n "AuthGuard\|isAuthorized\|goAuthorize\|isLoading } = useAuth"` and expect no hits outside the files you are editing.

- [ ] **Step 5: Pass the session to `SessionProvider` and shrink `useAuth`**

`components/providers/app-providers.tsx`:

```tsx
import type { Session } from 'next-auth'

export default function AppProviders({
	session,
	initialTheme,
	children,
}: {
	session: Session | null
	initialTheme: InitialTheme
	children: React.ReactNode
}) {
	return (
		// next-auth: a session passed from the server avoids the loading state on first load.
		<SessionProvider session={session}>
			<ThemeContextProvider initialTheme={initialTheme}>
				<AntdProviders>{children}</AntdProviders>
			</ThemeContextProvider>
		</SessionProvider>
	)
}
```

`app/layout.tsx`: add `import { getCachedServerSession } from '@/lib/session-user'`, then in the component:

```tsx
	const [session, cookieStore] = await Promise.all([getCachedServerSession(), cookies()])
	…
	<AppProviders session={session} initialTheme={initialTheme}>{children}</AppProviders>
```

`hooks/use-auth.ts`:

```ts
import { useSession } from 'next-auth/react'

/**
 * Chat-side identity: the signed-in account's email, which the server also uses as the Dify
 * end-user id. The route group layouts gate access on the server (ADR-0018), so this hook no
 * longer reports loading or authorised states.
 */
export const useAuth = () => {
	const { data: session } = useSession()
	return { userId: session?.user?.email ?? undefined }
}
```

- [ ] **Step 6: Run the unit tests, type-check and lint**

Run: `pnpm exec vitest run __tests__/session-user.test.ts __tests__/group-layouts.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint lib/session-user.ts app hooks components/providers`
Expected: PASS; tsc clean (the old chat still compiles: it only used `userId`).

- [ ] **Step 7: Extend the first-paint spec and relax the screenshot readiness**

Append to `e2e/ssr-first-paint.spec.ts`:

```ts
test('the shell and the account button are in the server HTML for a signed-in visitor', async ({
	page,
}) => {
	const html = await (await page.request.get('/app-management')).text()
	expect(html).toContain('class="ant-layout-header')
	expect(html).toContain('aria-label="Signed in as admin@e2e.local"')
})

test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('a signed-out request for a user page is redirected by the proxy with a callback', async ({
		page,
	}) => {
		const response = await page.request.get('/apps', { maxRedirects: 0 })
		expect(response.status()).toBe(307)
		expect(response.headers()['location']).toMatch(/\/login\?callbackUrl=%2Fapps$/)
	})
})
```

In `e2e/screenshots.spec.ts`, update the `noSpinner` doc comment: the `(user)` layout no longer renders a fullscreen Spin (the gate is server-side); keep both `toHaveCount(0)` assertions, they are still correct.

- [ ] **Step 8: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: all green, including `smoke.spec.ts`'s signed-out test (the proxy still adds `callbackUrl`) and the new first-paint tests.

- [ ] **Step 9: Update `docs/auth-gate.md` and record ADR-0018**

In `docs/auth-gate.md` → "Where it lives": add `requireSessionUser()` and the two group layouts; in "After merging upstream" expected conflicts change `app/(user)/layout.tsx` to "keep the fork's server gate"; in "Known limits" rewrite the password-reset bullet: every page under `(user)`/`(admin)` now redirects a revoked JWT (the proxy still accepts it until expiry, so the first request after revocation reaches the layout, which redirects).

Run: `node .claude/skills/adr-skill/scripts/new_adr.js --dir docs/decisions --title "Gate route groups on the server and let the proxy gate navigations" --status proposed --update-index`

Content: Context (client gates hid the shells until the session resolved, white canvas, no server render; Next documents that layouts do not re-render on navigation and cannot read the pathname). Decision (async group layouts call `requireSessionUser()`; the proxy remains the navigation gate and the only place that adds `callbackUrl`; `SessionProvider` receives the server session; client gates deleted). Consequences (shells in the first HTML; revoked tokens redirected on pages; a layout redirect carries no callbackUrl; one `sessionVersion` query per server render, deduped with React `cache`). Alternatives (render the gate inside the shell; keep client gates). Verification (`__tests__/group-layouts.test.ts`, `e2e/ssr-first-paint.spec.ts`).

- [ ] **Step 10: Commit**

```bash
pnpm exec oxfmt --write lib/session-user.ts "app/(user)/layout.tsx" "app/(admin)/layout.tsx" app/layout.tsx components/providers/app-providers.tsx hooks/use-auth.ts e2e/ssr-first-paint.spec.ts e2e/screenshots.spec.ts __tests__/session-user.test.ts __tests__/group-layouts.test.ts
git add lib/session-user.ts "app/(user)/layout.tsx" "app/(admin)/layout.tsx" app/layout.tsx components/providers/app-providers.tsx hooks/use-auth.ts components/auth e2e/ssr-first-paint.spec.ts e2e/screenshots.spec.ts __tests__/session-user.test.ts __tests__/group-layouts.test.ts docs/auth-gate.md docs/decisions
git commit -m "feat(auth): gate the user and admin route groups on the server" -m "ADR-0018. requireSessionUser() (getServerSession + redirect, cached per request) replaces AuthGuard and the useAuth gate, so the shells render on the server and a revoked JWT is redirected on every page. The proxy keeps gating navigations and adding callbackUrl. SessionProvider receives the server session so the account button is in the first HTML." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 3: Header by CSS breakpoints; 100dvh

**Spec:** §3.3, §3.4. ADR-0011 note.

**Files:**
- Modify: `components/shell/app-header.tsx`, `components/shell/app-header.module.css`, `components/shell/shell.module.css`, `docs/decisions/0011-bound-the-shells-to-the-viewport.md`, `e2e/ssr-first-paint.spec.ts`

**Interfaces:**
- `AppHeaderProps` unchanged (`nav`, `navSelectedKey`, `title`, `extra`, `mobileMenu`). Behaviour change: both breakpoint variants are rendered and CSS shows one; `Grid.useBreakpoint()` is no longer used in the header.

- [ ] **Step 1: Write the failing e2e assertion**

Append to `e2e/ssr-first-paint.spec.ts`:

```ts
test('the server HTML holds both breakpoint variants of the header, so no branch is chosen before hydration', async ({
	page,
}) => {
	const html = await (await page.request.get('/app-management')).text()
	// Desktop navigation (horizontal Menu) and the mobile trigger (named through system.menu) both exist;
	// CSS media queries at antd's screen tokens decide which one shows (spec §3.3).
	expect(html).toContain('ant-menu-horizontal')
	expect(html).toContain('aria-label="Menu"')
})
```

Run: `pnpm exec playwright test e2e/ssr-first-paint.spec.ts --project desktop-light`
Expected: FAIL — the server HTML has the mobile branch only (`useBreakpoint()` returns `{}` on the server), so `ant-menu-horizontal` is missing.

- [ ] **Step 2: Rewrite `components/shell/app-header.tsx`**

```tsx
'use client'

import { GithubOutlined, MenuOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { Button, Drawer, Flex, Layout, Menu, Space, Typography, theme } from 'antd'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import LogoIcon from '@/assets/images/logo.png'

import AccountDropdown from './account-dropdown'
import styles from './app-header.module.css'
import LanguageDropdown from './language-dropdown'
import ThemeDropdown from './theme-dropdown'

export interface AppHeaderProps {
	/** Area navigation (admin). A horizontal Menu from md up, inside a Drawer below. */
	nav?: MenuProps['items']
	navSelectedKey?: string
	/** Centre content (chat: the app title); the centre region is rendered only when this is set. */
	title?: React.ReactNode
	/** Controls placed before the standard dropdowns (chat: the width toggle). */
	extra?: React.ReactNode
	/** Below md this replaces the standard dropdowns (chat: the conversation drawer trigger). */
	mobileMenu?: React.ReactNode
}

const GITHUB_URL = 'https://github.com/lexmin0412/dify-app-hub'

// ADR-0014: click-triggered, i18n-named header controls — docs/decisions/0014-header-controls-click-triggered-named-through-i18next.md
// Breakpoint variants are both rendered and switched by CSS (spec 2026-10-04 chat §3.3): Grid.useBreakpoint()
// returns {} on the server, so a hook-chosen branch would paint the mobile header on desktop first.
export default function AppHeader({ nav, navSelectedKey, title, extra, mobileMenu }: AppHeaderProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [navOpen, setNavOpen] = useState(false)
	const selectedKeys = navSelectedKey ? [navSelectedKey] : []

	const dropdowns = (
		<Space size={token.marginXXS}>
			<LanguageDropdown />
			<ThemeDropdown />
			<Button
				type="text"
				icon={<GithubOutlined />}
				href={GITHUB_URL}
				target="_blank"
				rel="noreferrer"
				aria-label="GitHub"
				title="GitHub"
			/>
			<AccountDropdown />
		</Space>
	)

	return (
		<Layout.Header
			className={styles.header}
			style={{
				background: token.colorBgContainer,
				borderBottom: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
				paddingInline: token.paddingLG,
			}}
		>
			<Flex
				align="center"
				gap={token.marginSM}
				className={styles.side}
			>
				{nav && (
					<span className={styles.mobileOnly}>
						<Button
							type="text"
							icon={<MenuOutlined />}
							aria-label={t('system.menu')}
							title={t('system.menu')}
							onClick={() => setNavOpen(true)}
						/>
					</span>
				)}
				<Link
					href="/apps"
					className={styles.logo}
					aria-label="Dify App Hub"
				>
					<Image
						src={LogoIcon}
						width={28}
						loading="eager"
						alt=""
					/>
					<Typography.Text
						strong
						className={styles.title}
					>
						Dify App Hub
					</Typography.Text>
				</Link>
				{nav && (
					<span className={`${styles.desktopOnly} ${styles.nav}`}>
						<Menu
							mode="horizontal"
							items={nav}
							selectedKeys={selectedKeys}
							className={styles.nav}
							style={{ borderBottom: 0 }}
						/>
					</span>
				)}
			</Flex>
			{title && <div className={styles.center}>{title}</div>}
			<Flex
				align="center"
				justify="flex-end"
				gap={token.marginSM}
				className={styles.side}
			>
				{extra}
				{mobileMenu ? (
					<>
						<span className={styles.desktopOnly}>{dropdowns}</span>
						<span className={styles.mobileOnly}>{mobileMenu}</span>
					</>
				) : (
					dropdowns
				)}
			</Flex>
			{nav && (
				<Drawer
					open={navOpen}
					onClose={() => setNavOpen(false)}
					placement="left"
					title={t('system.menu')}
				>
					<Menu
						mode="inline"
						items={nav}
						selectedKeys={selectedKeys}
						onClick={() => setNavOpen(false)}
						style={{ borderInlineEnd: 0 }}
					/>
				</Drawer>
			)}
		</Layout.Header>
	)
}
```

- [ ] **Step 3: Add the breakpoint classes to `components/shell/app-header.module.css`**

Append:

```css
/* Both breakpoint variants are in the DOM; these two classes pick one. display: contents keeps the
   visible variant a direct flex child of the header region. screenSMMax = 767, screenMD = 768 (antd). */
.desktopOnly,
.mobileOnly {
	display: contents;
}
@media (max-width: 767px) {
	.desktopOnly {
		display: none;
	}
}
@media (min-width: 768px) {
	.mobileOnly {
		display: none;
	}
}
```

- [ ] **Step 4: Decide the viewport unit in `components/shell/shell.module.css`**

```css
/* ADR-0011: viewport-bound shells, the content region scrolls — docs/decisions/0011-bound-the-shells-to-the-viewport.md
   100dvh follows the visible viewport on mobile browsers while the URL bar shows; the 100vh line before it
   is the fallback for browsers without dvh (cascade: the last supported declaration wins). */
.root {
	height: 100vh;
	height: 100dvh;
}
.content {
	overflow: auto;
}
```

- [ ] **Step 5: Type-check, lint, run the header and first-paint specs**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/shell && pnpm exec playwright test e2e/ssr-first-paint.spec.ts e2e/shell.spec.ts e2e/chat-header.spec.ts e2e/smoke.spec.ts`
Expected: all green on the three projects. `shell.spec.ts` "on mobile the admin navigation opens from the menu button" passes because Playwright's role locators ignore `display: none` elements, so the hidden desktop Menu never matches `getByRole('menuitem')` and the visible trigger is unique.

- [ ] **Step 6: Note the decision in ADR-0011**

Append under "## More Information" of `docs/decisions/0011-bound-the-shells-to-the-viewport.md`:

```markdown
2026-10-04 (sub-project 2): `100dvh` adopted with `100vh` as the cascade fallback (`components/shell/shell.module.css`); see the chat design spec §3.4. The "Sub-project 2: decide `100dvh`" verification item is done.
```

and tick that checkbox.

- [ ] **Step 7: Commit**

```bash
pnpm exec oxfmt --write components/shell/app-header.tsx components/shell/app-header.module.css components/shell/shell.module.css e2e/ssr-first-paint.spec.ts
git add components/shell/app-header.tsx components/shell/app-header.module.css components/shell/shell.module.css e2e/ssr-first-paint.spec.ts docs/decisions/0011-bound-the-shells-to-the-viewport.md
git commit -m "feat(shell): render both header breakpoint variants and switch them in CSS; 100dvh shells" -m "Grid.useBreakpoint() returns {} on the server and the first client render, so a hook-chosen branch painted the mobile header on desktop now that the shells server-render. The horizontal Menu and the mobile trigger are both in the DOM and media queries at antd's screen tokens show one (spec §3.3). shell.module.css uses 100dvh with a 100vh fallback (ADR-0011 note)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---
### Task 4: Markdown spike — `MessageMarkdown` on `XMarkdown`, verdict in ADR-0017

**Spec:** §6 (nine criteria, verdict rule), §5.2 "Assistant content" (Markdown entry point), charter §2 "Markdown". ADR-0017 (created here as proposed; later tasks append to it).

**Files:**
- Create: `components/chat/message/message-markdown.tsx`, `components/chat/message/markdown/{send-context.tsx,dompurify-config.ts,components.tsx,code-block.tsx,echarts-block.tsx,svg-block.tsx,think-block.tsx,answer-form.tsx,answer-button.tsx,markdown-image.tsx,video-block.tsx,markdown.module.css}`, `components/chat/persistence/think-time-storage.ts` (git mv from `hooks/useX/think-time-storage.ts`), `e2e/fixtures/markdown-samples.ts`, `__tests__/markdown-dompurify.test.ts`, `__tests__/markdown-samples.test.ts`, `docs/decisions/0017-build-the-chat-on-ant-design-x.md`
- Temporary (deleted at the end of this task): `app/(user)/chat/spike/page.tsx`, `e2e/markdown-spike.spec.ts`

**Interfaces:**
- Produces: `MessageMarkdown({ content: string; streaming?: boolean; messageId?: string; onSend?: (text: string) => void })` — the only Markdown renderer every later task calls. `MarkdownSendContext` / `useMarkdownSend()` for post-back blocks. `MARKDOWN_SAMPLES: Record<SampleName, string>` shared with the stub (Task 5).
- Consumes: `useThemeContext()` (Task 1 kept its shape), `getThinkTime`/`setThinkTime` from the moved think-time store.

- [ ] **Step 1: Record the Dify samples**

`e2e/fixtures/markdown-samples.ts` — plain exported strings, one per criterion; the stub streams them and the spike page renders them. Keep them in this file (not `.md` files) so both `tsx` and Next import them without loaders:

```ts
/** Recorded-style Dify answers used by the Markdown spike and by the stub's `markdown` scenario. */
export const MARKDOWN_SAMPLES = {
	streaming: [
		'# Quarterly summary',
		'',
		'Revenue grew **12%** against the [previous quarter](https://example.com/q1) while costs stayed flat.',
		'',
		'| Region | Q1 | Q2 |',
		'| --- | ---: | ---: |',
		'| North | 120 | 134 |',
		'| South | 98 | 110 |',
		'',
		'- Hiring resumed in two teams',
		'- Two contracts renewed early',
	].join('\n'),
	code: [
		'Install it with `pnpm add antd` and render:',
		'',
		'```ts',
		'const total = rows.reduce((sum, row) => sum + row.value, 0)',
		'console.log(total)',
		'```',
		'',
		'```mermaid',
		'graph TD',
		'  A[Ask] --> B[Retrieve]',
		'  B --> C[Answer]',
		'```',
		'',
		'```echarts',
		'{"xAxis":{"type":"category","data":["Mon","Tue"]},"yAxis":{"type":"value"},"series":[{"data":[120,200],"type":"bar"}]}',
		'```',
		'',
		'```svg',
		'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" rx="6" fill="#1677ff"/></svg>',
		'```',
	].join('\n'),
	math: [
		'Inline $$E = mc^2$$ and a block:',
		'',
		'$$',
		'\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
		'$$',
		'',
		'1. First \\[ a^2 + b^2 = c^2 \\]',
		'2. Second $$\\sqrt{2}$$',
	].join('\n'),
	think: [
		'<think>',
		'The user asks for a summary. I should keep it short.',
		'</think>',
		'',
		'Here is the short summary you asked for.',
	].join('\n'),
	html: [
		'Here is the generated chart:',
		'',
		'<img src="/files/stub-image.png" alt="chart" />',
		'',
		'<video src="https://example.com/clip.mp4"></video>',
		'',
		'<form data-format="json">',
		'<label for="name">Name</label>',
		'<input type="text" name="name" value="" />',
		'<label for="notes">Notes</label>',
		'<textarea name="notes"></textarea>',
		'<button data-size="small" type="submit">Send details</button>',
		'</form>',
		'',
		'<button data-message="Tell me more">Tell me more</button>',
		'',
		'<details><summary>Raw data</summary>Hidden until opened.</details>',
	].join('\n'),
	imageFirst: '![leading image](/files/stub-image.png)\n\nText after the image.',
	links: 'See [Ant Design](https://ant.design) and <https://x.ant.design>.',
	theme: ['| Key | Value |', '| --- | --- |', '| a | 1 |', '', '```json', '{ "ok": true }', '```'].join('\n'),
	long: Array.from({ length: 300 }, (_, i) => `Chunk ${i + 1}: lorem ipsum dolor sit amet, consectetur.`).join('\n\n'),
} as const

export type SampleName = keyof typeof MARKDOWN_SAMPLES
```

`__tests__/markdown-samples.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { MARKDOWN_SAMPLES } from '@/e2e/fixtures/markdown-samples'

describe('markdown samples', () => {
	it('cover every spike criterion', () => {
		expect(Object.keys(MARKDOWN_SAMPLES).sort()).toEqual(
			['code', 'html', 'imageFirst', 'links', 'long', 'math', 'streaming', 'theme', 'think'].sort(),
		)
	})
	it('keep the html sample within the tags the sanitizer allows', () => {
		const tags = [...MARKDOWN_SAMPLES.html.matchAll(/<([a-z]+)[\s>/]/g)].map(m => m[1])
		for (const tag of tags) {
			expect(['img', 'video', 'form', 'label', 'input', 'textarea', 'button', 'details', 'summary']).toContain(tag)
		}
	})
})
```

Run: `pnpm exec vitest run __tests__/markdown-samples.test.ts` → PASS.

- [ ] **Step 2: Write the failing sanitizer test**

`__tests__/markdown-dompurify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { difyDompurifyConfig } from '@/components/chat/message/markdown/dompurify-config'

// The config extends DOMPurify's defaults (ADD_TAGS/ADD_ATTR) instead of replacing them, so KaTeX's
// MathML output and GFM task-list inputs keep rendering while Dify's custom tags are allowed.
describe('difyDompurifyConfig', () => {
	it('extends rather than replaces the default allow lists', () => {
		expect(difyDompurifyConfig).not.toHaveProperty('ALLOWED_TAGS')
		expect(difyDompurifyConfig).not.toHaveProperty('ALLOWED_ATTR')
	})
	it('allows the think tag and the attributes Dify answers rely on', () => {
		expect(difyDompurifyConfig.ADD_TAGS).toEqual(expect.arrayContaining(['think']))
		expect(difyDompurifyConfig.ADD_ATTR).toEqual(expect.arrayContaining(['target', 'controls']))
	})
})
```

Run: `pnpm exec vitest run __tests__/markdown-dompurify.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create the markdown building blocks**

`components/chat/message/markdown/dompurify-config.ts` (XMarkdown exposes `dompurifyConfig: DOMPurify.Config`; x-markdown API.md):

```ts
import type { Config } from 'dompurify'

/**
 * Minimal, explicit sanitizer extension for Dify answers (x-markdown skill: "keep dompurifyConfig explicit
 * and minimal"). Defaults stay: DOMPurify already allows img, video, form controls, details/summary and
 * data-* attributes; it strips `target` and unknown tags such as <think> unless added here.
 */
export const difyDompurifyConfig: Config = {
	ADD_TAGS: ['think'],
	ADD_ATTR: ['target', 'controls'],
}
```

If `dompurify` types are not resolvable because the package is removed in Task 19, type the object as `{ ADD_TAGS: string[]; ADD_ATTR: string[] }` instead; XMarkdown's prop accepts it.

`components/chat/message/markdown/send-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

/** Lets Dify's <form data-format> and <button data-message> blocks post a message without inline component props. */
export const MarkdownSendContext = createContext<((text: string) => void) | undefined>(undefined)

export const useMarkdownSend = () => useContext(MarkdownSendContext)
```

`components/chat/message/markdown/dom-node.ts` — `@ant-design/x-markdown` exports `ComponentProps` (`domNode`, `streamStatus`, `lang`, `block`, plus the HTML attributes); the blocks below use this structural view of it so `domNode.attribs` and `domNode.children` can be read without narrowing html-react-parser's node union, and the `components` map is cast once in `components.tsx`:

```ts
export interface DomNode {
	type: string
	name?: string
	attribs?: Record<string, string>
	children?: DomNode[]
	data?: string
}

export interface MarkdownBlockProps {
	domNode: DomNode
	streamStatus: 'loading' | 'done'
	lang?: string
	block?: boolean
	children?: React.ReactNode
	className?: string
}

export const textOf = (node?: DomNode): string =>
	(node?.children ?? []).map(child => (child.type === 'text' ? child.data ?? '' : textOf(child))).join('')
```

`components/chat/message/markdown/code-block.tsx` (X `CodeHighlighter` takes `lang` and `children`; `Mermaid` takes `children`; API.md):

```tsx
'use client'

import { CodeHighlighter, Mermaid } from '@ant-design/x'

import type { MarkdownBlockProps } from './dom-node'
import EchartsBlock from './echarts-block'
import SvgBlock from './svg-block'

const codeText = (children: React.ReactNode) => (typeof children === 'string' ? children : String(children ?? ''))

/** Fenced code routed by language; inline code falls through to a plain <code>. */
export default function CodeBlock({ lang, block, children, className }: MarkdownBlockProps) {
	if (!block) return <code className={className}>{children}</code>
	const language = (lang ?? '').trim().split(/\s+/)[0]
	const code = codeText(children).replace(/\n$/, '')
	if (language === 'mermaid') return <Mermaid>{code}</Mermaid>
	if (language === 'echarts') return <EchartsBlock code={code} />
	if (language === 'svg') return <SvgBlock code={code} />
	return <CodeHighlighter lang={language || 'text'}>{code}</CodeHighlighter>
}
```

`components/chat/message/markdown/echarts-block.tsx` — move the echarts branch of the old `CodeBlock` here: parse `code` as JSON inside `useMemo`, render `ReactEcharts` inside a small class `ErrorBoundary` (copy the one at the bottom of the old `markdown-renderer/index.tsx`), fall back to an antd `Alert type="warning" title={t('message.echarts_invalid')}` on parse failure; sizes through `style={{ minHeight: token.controlHeight * 10 }}`.

`components/chat/message/markdown/svg-block.tsx` — `git mv components/chat/markdown-renderer/blocks/svg-renderer.tsx components/chat/message/markdown/svg-block.tsx`, rename the export to `SvgBlock({ code })`, drop the Tailwind classes (none needed), keep `@svgdotjs/svg.js` + DOMPurify sanitising as it is.

`components/chat/message/markdown/think-block.tsx` (X `Think`: `title`, `loading`, `blink`, `defaultExpanded`, children; API.md):

```tsx
'use client'

import { Think } from '@ant-design/x'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getThinkTime, setThinkTime } from '@/components/chat/persistence/think-time-storage'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownMessageId } from './message-context'

/** <think> blocks (inline reasoning) and the reasoning_chunk stream both render through this. */
export default function ThinkBlock({ children, streamStatus }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const messageId = useMarkdownMessageId()
	const storageKey = messageId ? `${messageId}_think` : ''
	const startedAt = useRef(Date.now())
	const [elapsed, setElapsed] = useState(() => (storageKey ? getThinkTime(storageKey) : undefined))
	const loading = streamStatus === 'loading'

	useEffect(() => {
		if (!loading) {
			if (storageKey && elapsed === undefined) {
				const seconds = Math.round((Date.now() - startedAt.current) / 100) / 10
				setThinkTime(storageKey, seconds)
				setElapsed(seconds)
			}
			return
		}
		const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 100) / 10), 100)
		return () => clearInterval(timer)
	}, [loading, storageKey, elapsed])

	const title = loading
		? t('message.think.in_progress', { seconds: (elapsed ?? 0).toFixed(1) })
		: elapsed !== undefined
			? t('message.think.done_with_time', { seconds: elapsed.toFixed(1) })
			: t('message.think.done')

	return (
		<Think
			title={title}
			loading={loading}
			blink={loading}
			defaultExpanded={loading}
		>
			{children}
		</Think>
	)
}
```

`components/chat/message/markdown/message-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

/** The Dify message id a Markdown tree belongs to (think timers are stored per message). */
export const MarkdownMessageContext = createContext<string | undefined>(undefined)
export const useMarkdownMessageId = () => useContext(MarkdownMessageContext)
```

`components/chat/message/markdown/answer-button.tsx`:

```tsx
'use client'

import { Button } from 'antd'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownSend } from './send-context'

/** <button data-message="…">: Dify answers that offer a follow-up to send. */
export default function AnswerButton({ domNode, children }: MarkdownBlockProps) {
	const send = useMarkdownSend()
	const message = domNode.attribs?.['data-message']
	return (
		<Button
			size="small"
			onClick={() => message && send?.(message)}
		>
			{children}
		</Button>
	)
}
```

`components/chat/message/markdown/answer-form.tsx` — port of `markdown-renderer/blocks/form.tsx` reading `domNode.children` (`name`, `attribs`) instead of hast `properties`:

```tsx
'use client'

import { Button, DatePicker, Form, Input, Select } from 'antd'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import type { DomNode, MarkdownBlockProps } from './dom-node'
import { textOf } from './dom-node'
import { useMarkdownSend } from './send-context'

const FIELD_TAGS = new Set(['input', 'textarea', 'select'])

const fields = (node: DomNode) => (node.children ?? []).filter(c => c.type === 'tag' && c.name)

/** <form data-format="text|json"> inside an answer: labelled fields and a submit that posts back a message. */
export default function AnswerForm({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const send = useMarkdownSend()
	const [form] = Form.useForm<Record<string, string>>()
	const format = domNode.attribs?.['data-format'] === 'json' ? 'json' : 'text'

	const submit = (values: Record<string, string>) => {
		if (format === 'json') {
			send?.(JSON.stringify({ ...values, isFormSubmit: true }))
			return
		}
		send?.(
			Object.entries(values)
				.map(([key, value]) => `${key}: ${value ?? ''}`)
				.join('\n'),
		)
	}

	return (
		<Form
			form={form}
			layout="vertical"
			size="small"
			onFinish={submit}
			autoComplete="off"
		>
			{fields(domNode).map((child, index) => {
				const name = child.attribs?.name ?? `field_${index}`
				if (child.name === 'label') return null
				if (!FIELD_TAGS.has(child.name!) && child.name !== 'button') return null
				if (child.name === 'button') {
					return (
						<Form.Item key={`button-${index}`}>
							<Button
								type="primary"
								size="small"
								htmlType="submit"
							>
								{textOf(child) || t('common.confirm')}
							</Button>
						</Form.Item>
					)
				}
				const label = fields(domNode).find(l => l.name === 'label' && l.attribs?.for === name)
				const type = child.attribs?.type ?? 'text'
				const control =
					child.name === 'textarea' ? (
						<Input.TextArea rows={3} />
					) : type === 'date' || type === 'datetime' ? (
						<DatePicker showTime={type === 'datetime'} />
					) : type === 'select' ? (
						<Select
							options={(() => {
								try {
									return (JSON.parse(child.attribs?.['data-options'] ?? '[]') as string[]).map(v => ({ value: v, label: v }))
								} catch {
									return []
								}
							})()}
						/>
					) : type === 'hidden' ? (
						<Input type="hidden" />
					) : (
						<Input type={type} />
					)
				return (
					<Form.Item
						key={name}
						name={name}
						label={label ? textOf(label) : undefined}
						hidden={type === 'hidden'}
						initialValue={child.attribs?.value}
						getValueFromEvent={type === 'date' || type === 'datetime' ? (d: dayjs.Dayjs | null) => (d ? d.format(type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss') : '') : undefined}
					>
						{control}
					</Form.Item>
				)
			})}
		</Form>
	)
}
```

`components/chat/message/markdown/markdown-image.tsx` (antd `Image` with preview, documented at antd `components/image`):

```tsx
'use client'

import { Image } from 'antd'
import { useTranslation } from 'react-i18next'

import type { MarkdownBlockProps } from './dom-node'
import styles from './markdown.module.css'

export default function MarkdownImage({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const { src = '', alt } = domNode.attribs ?? {}
	if (!src) return null
	return (
		<Image
			src={src}
			alt={alt || t('message.image_load_failed')}
			className={styles.media}
			preview={{ mask: null }}
		/>
	)
}
```

`components/chat/message/markdown/video-block.tsx`:

```tsx
'use client'

import type { MarkdownBlockProps } from './dom-node'
import styles from './markdown.module.css'

export default function VideoBlock({ domNode }: MarkdownBlockProps) {
	const src = domNode.attribs?.src
	if (!src) return null
	return (
		<video
			className={styles.media}
			src={src}
			controls
		/>
	)
}
```

`components/chat/message/markdown/markdown.module.css`:

```css
/* Media inside answers: never wider than the bubble, rounded with the large token radius. */
.media {
	display: block;
	max-width: 100%;
	border-radius: var(--ant-border-radius-lg);
	margin-block-start: var(--ant-margin-xs);
}
```

`components/chat/message/markdown/components.tsx` — the stable map (x-markdown rule: never inline):

```tsx
import type { XMarkdownProps } from '@ant-design/x-markdown'

import AnswerButton from './answer-button'
import AnswerForm from './answer-form'
import CodeBlock from './code-block'
import MarkdownImage from './markdown-image'
import ThinkBlock from './think-block'
import VideoBlock from './video-block'

export const markdownComponents = {
	code: CodeBlock,
	think: ThinkBlock,
	form: AnswerForm,
	button: AnswerButton,
	img: MarkdownImage,
	video: VideoBlock,
} as unknown as NonNullable<XMarkdownProps['components']>
```

Move the think-time store: `git mv hooks/useX/think-time-storage.ts components/chat/persistence/think-time-storage.ts` and update the one old import in `components/chat/markdown-renderer/blocks/think-block.tsx` to the new path (one line; the old renderer stays until Task 19).

- [ ] **Step 4: Create `MessageMarkdown`**

`components/chat/message/message-markdown.tsx`:

```tsx
'use client'

import { XMarkdown } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import '@ant-design/x-markdown/themes/dark.css'
import '@ant-design/x-markdown/themes/light.css'

import { useThemeContext } from '@/lib/theme'

import { markdownComponents } from './markdown/components'
import { difyDompurifyConfig } from './markdown/dompurify-config'
import { MarkdownMessageContext } from './markdown/message-context'
import { MarkdownSendContext } from './markdown/send-context'

export interface MessageMarkdownProps {
	content: string
	/** true while the chunk stream is still open (XMarkdown `streaming.hasNextChunk`). */
	streaming?: boolean
	/** Dify message id; think timers are remembered per message. */
	messageId?: string
	/** Posts a message back (Dify answer forms and buttons). */
	onSend?: (text: string) => void
}

// Plugin instance and components map are module constants (x-markdown skill: keep them stable).
const latex = Latex()

/** The single Markdown entry point for bubbles, the welcome panel and workflow results (spec §5.2, §6). */
export default function MessageMarkdown({ content, streaming = false, messageId, onSend }: MessageMarkdownProps) {
	const { isDark } = useThemeContext()
	return (
		<MarkdownSendContext.Provider value={onSend}>
			<MarkdownMessageContext.Provider value={messageId}>
				<XMarkdown
					className={isDark ? 'x-markdown-dark' : 'x-markdown-light'}
					content={content}
					components={markdownComponents}
					config={{ extensions: latex }}
					streaming={{ hasNextChunk: streaming, enableAnimation: true }}
					openLinksInNewTab
					dompurifyConfig={difyDompurifyConfig}
				/>
			</MarkdownMessageContext.Provider>
		</MarkdownSendContext.Provider>
	)
}
```

Run: `pnpm exec vitest run __tests__/markdown-dompurify.test.ts && pnpm exec tsc --noEmit`
Expected: PASS; tsc clean (adjust the `components` cast or the `Config` import if the compiler objects, and note the adjustment in the task report).

Add the one new key used above to the three locale files under `message`: `echarts_invalid` — en "The chart definition is not valid JSON." · zh "图表定义不是有效的 JSON。" · ar "تعريف المخطط ليس بصيغة JSON صالحة.".

- [ ] **Step 5: Build the temporary spike page**

`app/(user)/chat/spike/page.tsx` (temporary; signed-in users only, deleted in Step 8):

```tsx
'use client'

import { Button, Flex, Typography } from 'antd'
import { useEffect, useState } from 'react'

import MessageMarkdown from '@/components/chat/message/message-markdown'
import { MARKDOWN_SAMPLES, type SampleName } from '@/e2e/fixtures/markdown-samples'

function Sample({ name, text }: { name: SampleName; text: string }) {
	const [shown, setShown] = useState(text)
	const [streaming, setStreaming] = useState(false)
	const [sent, setSent] = useState('')

	useEffect(() => {
		if (!streaming) return
		let i = 0
		const timer = setInterval(() => {
			i += 20
			setShown(text.slice(0, i))
			if (i >= text.length) {
				clearInterval(timer)
				setStreaming(false)
			}
		}, 30)
		return () => clearInterval(timer)
	}, [streaming, text])

	return (
		<section data-sample={name}>
			<Flex gap={8} align="center">
				<Typography.Title level={5}>{name}</Typography.Title>
				<Button size="small" onClick={() => { setShown(''); setStreaming(true) }} aria-label={`stream ${name}`}>
					Stream
				</Button>
				{sent && <Typography.Text data-sent={name}>sent: {sent}</Typography.Text>}
			</Flex>
			<MessageMarkdown content={shown} streaming={streaming} messageId={`spike-${name}`} onSend={setSent} />
		</section>
	)
}

export default function MarkdownSpikePage() {
	return (
		<Flex vertical gap={24} style={{ padding: 24 }}>
			{(Object.keys(MARKDOWN_SAMPLES) as SampleName[]).map(name => (
				<Sample key={name} name={name} text={MARKDOWN_SAMPLES[name]} />
			))}
		</Flex>
	)
}
```

- [ ] **Step 6: Write the temporary spike spec and run it**

`e2e/markdown-spike.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const sample = (page: import('@playwright/test').Page, name: string) => page.locator(`[data-sample="${name}"]`)

test.describe('XMarkdown against Dify content (spike)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/chat/spike')
		await expect(sample(page, 'streaming')).toBeVisible()
	})

	test('1 streaming: a chunked table and link settle into complete markup', async ({ page }) => {
		await page.getByRole('button', { name: 'stream streaming' }).click()
		await expect(sample(page, 'streaming').locator('table')).toBeVisible()
		await expect(sample(page, 'streaming').getByRole('link', { name: 'previous quarter' })).toHaveAttribute('href', 'https://example.com/q1')
		await expect(sample(page, 'streaming').locator('td')).toHaveCount(4)
	})

	test('2 fenced code: highlighter, mermaid, echarts and svg each render', async ({ page }) => {
		const s = sample(page, 'code')
		await expect(s.locator('.ant-code-highlighter, [class*="code-highlighter"]').first()).toBeVisible()
		await expect(s.locator('svg').first()).toBeVisible()
		await expect(s.locator('canvas, [_echarts_instance_]').first()).toBeVisible()
		await expect(s.locator('code').filter({ hasText: 'pnpm add antd' })).toBeVisible()
	})

	test('3 math: inline and block formulas render through the Latex plugin', async ({ page }) => {
		await expect(sample(page, 'math').locator('.katex').first()).toBeVisible()
		await expect(sample(page, 'math').locator('.katex')).toHaveCount(4)
	})

	test('4 think: the block collapses when the stream ends and shows the elapsed label', async ({ page }) => {
		const s = sample(page, 'think')
		await expect(s.getByText(/Finished thinking/)).toBeVisible()
		await page.getByRole('button', { name: 'stream think' }).click()
		await expect(s.getByText(/Thinking\.\.\./)).toBeVisible()
		await expect(s.getByText(/Finished thinking/)).toBeVisible()
	})

	test('5 html: img, video, form and button survive sanitising and post back', async ({ page }) => {
		const s = sample(page, 'html')
		await expect(s.locator('.ant-image img')).toBeVisible()
		await expect(s.locator('video')).toHaveCount(1)
		await s.getByRole('button', { name: 'Tell me more' }).click()
		await expect(s.locator('[data-sent="html"]')).toHaveText('sent: Tell me more')
		await s.getByLabel('Name').fill('Jane')
		await s.getByRole('button', { name: 'Send details' }).click()
		await expect(s.locator('[data-sent="html"]')).toContainText('"name":"Jane"')
	})

	test('6 image first: content starting with an image renders it', async ({ page }) => {
		await expect(sample(page, 'imageFirst').locator('.ant-image img')).toBeVisible()
	})

	test('7 links open in a new tab', async ({ page }) => {
		await expect(sample(page, 'links').getByRole('link', { name: 'Ant Design' })).toHaveAttribute('target', '_blank')
	})

	test('8 theme: the root follows the colour scheme', async ({ page }, testInfo) => {
		const root = sample(page, 'theme').locator('.x-markdown-light, .x-markdown-dark').first()
		await expect(root).toHaveClass(testInfo.project.use.colorScheme === 'dark' ? /x-markdown-dark/ : /x-markdown-light/)
	})

	test('9 performance: 300 chunks stream without a React update-depth error', async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', e => errors.push(e.message))
		await page.getByRole('button', { name: 'stream long' }).click()
		await expect(sample(page, 'long').getByText('Chunk 300')).toBeVisible({ timeout: 60_000 })
		expect(errors.filter(e => /Maximum update depth/.test(e))).toEqual([])
	})
})
```

Run: `pnpm exec playwright test e2e/markdown-spike.spec.ts`
Expected: each test passes or fails on its own; record every result. Adjust selectors to the DOM X actually renders (inspect with `--debug` or a screenshot) but never the criterion. If a criterion fails, consult the x-markdown skill references for a documented fix first (e.g. `paragraphTag` for block children, `dompurifyConfig` additions); a fix that needs a private API or a patched package is a failure (ADR-0002).

- [ ] **Step 7: Record the verdict in ADR-0017**

Run: `node .claude/skills/adr-skill/scripts/new_adr.js --dir docs/decisions --title "Build the chat on Ant Design X with a provider-centred data layer" --status proposed --update-index`

Write the Context (charter §4.4, spec §2) and Decision sections from the spec (one provider, `conversationKey` + `defaultMessages` + `queueRequest`, client keys with a Dify id field, `onReload` for HITL continuation, regenerate as a new turn; the later tasks implement them). Add a "## Markdown verdict (spike, 2026-10-04)" section with the nine criteria as a table (criterion · sample · result · note) and the conclusion:

- all nine passed → "XMarkdown adopted; the react-markdown pipeline and its packages are removed in Task 19";
- otherwise → "react-markdown kept and restyled; failing criteria: …; retest at the next `@ant-design/x-markdown` release". In that case also do the fallback now: `git mv components/chat/markdown-renderer components/chat/message/markdown/legacy`, make `MessageMarkdown` render `<legacy/MarkdownRenderer markdownText={content} onSubmit={text => onSend?.(text)} />`, replace every Tailwind class and hex value in `legacy/index.css` and the block files with `var(--ant-*)` tokens, keep the `__tests__/markdown-dompurify.test.ts` file but mark it `describe.skip` with the reason, and keep the XMarkdown files out of the tree (delete them) so no dead path ships.

- [ ] **Step 8: Remove the temporary page and spec, run the gates**

```bash
git rm -q "app/(user)/chat/spike/page.tsx" e2e/markdown-spike.spec.ts 2>/dev/null || rm -f "app/(user)/chat/spike/page.tsx" e2e/markdown-spike.spec.ts
pnpm exec tsc --noEmit && pnpm exec oxlint components/chat/message && pnpm test
```

Expected: clean. The spike's spec results live in the ADR and in the task report; the chat specs from Task 9 on re-verify the criteria in situ (the stub's `markdown` scenario streams `MARKDOWN_SAMPLES.streaming`).

- [ ] **Step 9: Commit**

```bash
pnpm exec oxfmt --write components/chat/message components/chat/persistence e2e/fixtures/markdown-samples.ts __tests__/markdown-dompurify.test.ts __tests__/markdown-samples.test.ts locales
git add components/chat/message components/chat/persistence components/chat/markdown-renderer/blocks/think-block.tsx hooks/useX e2e/fixtures/markdown-samples.ts __tests__/markdown-dompurify.test.ts __tests__/markdown-samples.test.ts locales docs/decisions
git commit -m "feat(chat): MessageMarkdown on XMarkdown after the Dify content spike" -m "Nine criteria from the chat spec §6 run against recorded Dify samples (streaming, fenced code incl. mermaid/echarts/svg, Latex, <think>, injected HTML with an explicit DOMPurify extension, leading images, new-tab links, light/dark themes, 300-chunk streams). Verdict and per-criterion results in ADR-0017. The spike page and spec were removed after recording." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 5: Stub Dify API — five apps, the full event catalogue, per-user state

**Spec:** §8.1. ADR-0010 note (catalogue complete) is written in Task 19.

**Files:**
- Create: `e2e/fixtures/stub/{apps.ts,store.ts,events.ts,scenarios.ts,router.ts,server.ts,assets.ts}`, `__tests__/stub-events.test.ts`
- Modify: `e2e/fixtures/constants.ts`, `e2e/auth.setup.ts`, `playwright.config.ts`
- Delete: `e2e/fixtures/dify-stub.ts`

**Interfaces:**
- Produces: `STUB_APPS: StubApp[]` (id, name, mode, prefix) and `APP_IDS: Record<StubMode, string>` for specs; the stub answers on `http://127.0.0.1:5399/v1` (chat) and `/v1/agent`, `/v1/chatflow`, `/v1/workflow`, `/v1/completion`; `POST /__e2e/reset` is kept until Task 9 removes it.
- Pure, unit-tested: `modeFromPath(pathname)`, the event builders in `events.ts`, `chatScenario(mode, query, ctx)` and `runScenario(mode, inputs, ctx)` in `scenarios.ts`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/stub-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { APP_ID } from '@/e2e/fixtures/constants'
import { modeFromPath, STUB_APPS } from '@/e2e/fixtures/stub/apps'
import { chatScenario, runScenario } from '@/e2e/fixtures/stub/scenarios'

const ctx = {
	base: { task_id: 't1', message_id: 'm1', conversation_id: 'c1', created_at: 1_700_000_000 },
	runId: 'run-1',
	formToken: 'ft-1',
	fileUrl: 'http://127.0.0.1:5399/files/stub-image.png',
}

describe('modeFromPath', () => {
	it('maps the unprefixed /v1 to the chat app and the four prefixes to their modes', () => {
		expect(modeFromPath('/v1/parameters')).toEqual({ mode: 'chat', path: '/parameters' })
		expect(modeFromPath('/v1/agent/chat-messages')).toEqual({ mode: 'agent-chat', path: '/chat-messages' })
		expect(modeFromPath('/v1/chatflow/messages')).toEqual({ mode: 'advanced-chat', path: '/messages' })
		expect(modeFromPath('/v1/workflow/workflows/run')).toEqual({ mode: 'workflow', path: '/workflows/run' })
		expect(modeFromPath('/v1/completion/completion-messages')).toEqual({ mode: 'completion', path: '/completion-messages' })
	})
	it('keeps the seeded chat app id and name', () => {
		expect(STUB_APPS[0]).toMatchObject({ id: APP_ID, name: 'Stub app', mode: 'chat', prefix: '' })
		expect(STUB_APPS).toHaveLength(5)
	})
})

describe('chatScenario', () => {
	it('gives every event the StreamEventBase fields', () => {
		for (const mode of ['chat', 'agent-chat', 'advanced-chat'] as const) {
			for (const event of chatScenario(mode, 'hello', ctx)) {
				expect(event).toMatchObject({ task_id: 't1', message_id: 'm1', conversation_id: 'c1', created_at: 1_700_000_000 })
				expect(typeof event.event).toBe('string')
			}
		}
	})
	it('echoes the query in a plain chat and ends with message_end', () => {
		const events = chatScenario('chat', 'hello', ctx)
		expect(events.map(e => e.event)).toEqual(['message', 'message', 'message_end'])
		expect(events.map(e => (e as { answer?: string }).answer ?? '').join('')).toBe('Echo: hello')
	})
	it('streams agent thoughts (one with a tool) and agent messages for agent apps', () => {
		const types = chatScenario('agent-chat', 'hello', ctx).map(e => e.event)
		expect(types.filter(t => t === 'agent_thought')).toHaveLength(2)
		expect(types).toContain('agent_message')
		expect(types.at(-1)).toBe('message_end')
	})
	it('streams a chatflow run: workflow_started, nodes, reasoning with is_final, text, message_end, workflow_finished', () => {
		const events = chatScenario('advanced-chat', 'hello', ctx)
		const types = events.map(e => e.event)
		expect(types[0]).toBe('workflow_started')
		expect(types).toEqual(expect.arrayContaining(['node_started', 'node_finished', 'reasoning_chunk', 'message', 'message_end']))
		expect(types.at(-1)).toBe('workflow_finished')
		const finals = events.filter(e => e.event === 'reasoning_chunk').map(e => (e as { data: { is_final: boolean } }).data.is_final)
		expect(finals.at(-1)).toBe(true)
	})
	it('pauses for human input on the hitl query and ends the stream', () => {
		const types = chatScenario('advanced-chat', 'please hitl this', ctx).map(e => e.event)
		expect(types.slice(-2)).toEqual(['human_input_required', 'workflow_paused'])
	})
	it('emits an error event on the error query and a message_file on the files query', () => {
		expect(chatScenario('chat', 'cause an error', ctx).map(e => e.event)).toEqual(['message', 'error'])
		expect(chatScenario('chat', 'send files', ctx).map(e => e.event)).toContain('message_file')
	})
	it('retries a node on the retry query', () => {
		expect(chatScenario('advanced-chat', 'retry once', ctx).map(e => e.event)).toContain('node_retry')
	})
})

describe('runScenario', () => {
	it('streams text chunks and finishes with outputs for workflow apps', () => {
		const events = runScenario('workflow', { topic: 'tea' }, ctx)
		expect(events.map(e => e.event)[0]).toBe('workflow_started')
		expect(events.map(e => e.event)).toContain('text_chunk')
		const finished = events.at(-1) as { event: string; data: { outputs: Record<string, unknown> } }
		expect(finished.event).toBe('workflow_finished')
		expect(finished.data.outputs).toMatchObject({ text: expect.stringContaining('tea') })
	})
	it('streams message chunks and message_end for completion apps', () => {
		expect(runScenario('completion', { topic: 'tea' }, ctx).map(e => e.event)).toEqual(['message', 'message', 'message_end'])
	})
})
```

Run: `pnpm exec vitest run __tests__/stub-events.test.ts` → FAIL (modules missing).

- [ ] **Step 2: Apps, constants and the mode router**

`e2e/fixtures/stub/apps.ts`:

```ts
export type StubMode = 'chat' | 'agent-chat' | 'advanced-chat' | 'workflow' | 'completion'
export type StubPrefix = '' | '/agent' | '/chatflow' | '/workflow' | '/completion'

export interface StubApp {
	id: string
	name: string
	mode: StubMode
	prefix: StubPrefix
}

/** The five seeded apps. The first keeps the foundation's id and name so older specs keep their locators. */
export const STUB_APPS: StubApp[] = [
	{ id: 'e2e00000-0000-4000-8000-000000000001', name: 'Stub app', mode: 'chat', prefix: '' },
	{ id: 'e2e00000-0000-4000-8000-000000000002', name: 'Stub agent', mode: 'agent-chat', prefix: '/agent' },
	{ id: 'e2e00000-0000-4000-8000-000000000003', name: 'Stub chatflow', mode: 'advanced-chat', prefix: '/chatflow' },
	{ id: 'e2e00000-0000-4000-8000-000000000004', name: 'Stub workflow', mode: 'workflow', prefix: '/workflow' },
	{ id: 'e2e00000-0000-4000-8000-000000000005', name: 'Stub completion', mode: 'completion', prefix: '/completion' },
]

export const APP_IDS = Object.fromEntries(STUB_APPS.map(app => [app.mode, app.id])) as Record<StubMode, string>

/** `/v1/<prefix>/<dify path>` → the app mode and the Dify path. Unprefixed `/v1/...` is the chat app. */
export const modeFromPath = (pathname: string): { mode: StubMode; path: string } => {
	const stripped = pathname.replace(/^\/v1/, '')
	for (const app of STUB_APPS) {
		if (app.prefix && (stripped === app.prefix || stripped.startsWith(`${app.prefix}/`))) {
			return { mode: app.mode, path: stripped.slice(app.prefix.length) || '/' }
		}
	}
	return { mode: 'chat', path: stripped || '/' }
}
```

`e2e/fixtures/constants.ts`:

```ts
/** Seeded app id (36 chars, fits dify_apps.id) and the signed-in storage state file. */
export const APP_ID = 'e2e00000-0000-4000-8000-000000000001'
export const ADMIN_STATE = 'e2e/.auth/admin.json'
export { APP_IDS, STUB_APPS } from './stub/apps'
```

- [ ] **Step 3: Store and assets**

`e2e/fixtures/stub/store.ts`:

```ts
export interface StoredMessage {
	id: string
	conversation_id: string
	query: string
	answer: string
	created_at: number
	feedback: { rating: 'like' | 'dislike' } | null
	inputs: Record<string, unknown>
	message_files: unknown[]
	agent_thoughts: unknown[]
	retriever_resources: unknown[]
	status: 'normal' | 'error'
	error: string | null
}

export interface StoredConversation {
	id: string
	name: string
	created_at: number
	updated_at: number
	inputs: Record<string, unknown>
}

export interface PendingForm {
	formToken: string
	workflowRunId: string
	user: string
	conversationId: string
	messageId: string
	taskId: string
	submitted?: { inputs: Record<string, string>; action: string }
}

class UserStore {
	conversations = new Map<string, StoredConversation>()
	messages: StoredMessage[] = []
}

const users = new Map<string, UserStore>()
/** Conversations and messages are scoped per Dify end-user id (the proxy sets it from the session). */
export const forUser = (user: string): UserStore => {
	let store = users.get(user)
	if (!store) {
		store = new UserStore()
		users.set(user, store)
	}
	return store
}

export const pendingForms = new Map<string, PendingForm>()

export const resetAll = () => {
	users.clear()
	pendingForms.clear()
}

export const now = () => Math.floor(Date.now() / 1000)
```

`e2e/fixtures/stub/assets.ts`:

```ts
/** 1×1 transparent PNG and a 44-byte silent WAV header: enough for <img>, Image preview and <audio>. */
export const STUB_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
)

export const STUB_WAV = (() => {
	const header = Buffer.alloc(44)
	header.write('RIFF', 0)
	header.writeUInt32LE(36, 4)
	header.write('WAVE', 8)
	header.write('fmt ', 12)
	header.writeUInt32LE(16, 16)
	header.writeUInt16LE(1, 20)
	header.writeUInt16LE(1, 22)
	header.writeUInt32LE(8000, 24)
	header.writeUInt32LE(8000, 28)
	header.writeUInt16LE(1, 32)
	header.writeUInt16LE(8, 34)
	header.write('data', 36)
	header.writeUInt32LE(0, 40)
	return header
})()
```

- [ ] **Step 4: Event builders (shapes from `openapi_service.json`)**

`e2e/fixtures/stub/events.ts`:

```ts
/**
 * Stream events shaped after Dify's OpenAPI document (langgenius/dify-docs → en/api-reference/openapi_service.json):
 * ChunkChatEvent / ChunkWorkflowEvent unions, StreamEventBase (task_id, message_id, conversation_id, created_at).
 */
export interface StreamBase {
	task_id: string
	message_id: string
	conversation_id: string
	created_at: number
}

export type StreamEvent = StreamBase & { event: string } & Record<string, unknown>

export interface StubNode {
	id: string
	nodeId: string
	type: string
	title: string
	index: number
}

const withBase = (base: StreamBase, event: string, fields: Record<string, unknown>): StreamEvent => ({
	event,
	...base,
	...fields,
})

export const message = (base: StreamBase, answer: string) => withBase(base, 'message', { answer })
export const agentMessage = (base: StreamBase, answer: string) => withBase(base, 'agent_message', { answer })
export const messageReplace = (base: StreamBase, answer: string) => withBase(base, 'message_replace', { answer })
export const messageEnd = (base: StreamBase, retrieverResources: unknown[] = []) =>
	withBase(base, 'message_end', {
		id: base.message_id,
		metadata: {
			usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, total_price: '0.0001', currency: 'USD', latency: 0.42 },
			retriever_resources: retrieverResources,
		},
	})
export const messageFile = (base: StreamBase, url: string) =>
	withBase(base, 'message_file', { id: `file-${base.message_id}`, type: 'image', belongs_to: 'assistant', url })
export const errorEvent = (base: StreamBase, code: string, text: string, status: number) =>
	withBase(base, 'error', { code, message: text, status })
export const agentThought = (
	base: StreamBase,
	position: number,
	fields: { thought: string; tool?: string; tool_input?: string; observation?: string },
) =>
	withBase(base, 'agent_thought', {
		id: `thought-${base.message_id}-${position}`,
		position,
		thought: fields.thought,
		tool: fields.tool ?? '',
		tool_input: fields.tool_input ?? '',
		observation: fields.observation ?? '',
		message_files: [],
	})
export const reasoningChunk = (base: StreamBase, reasoning: string, isFinal = false) =>
	withBase(base, 'reasoning_chunk', {
		data: { reasoning, is_final: isFinal, message_id: base.message_id, node_id: 'llm-1' },
	})
export const workflowStarted = (base: StreamBase, runId: string, reason: 'initial' | 'resumption' = 'initial') =>
	withBase(base, 'workflow_started', {
		workflow_run_id: runId,
		data: { id: runId, workflow_id: 'wf-1', inputs: {}, created_at: base.created_at, reason },
	})
export const nodeStarted = (base: StreamBase, runId: string, node: StubNode) =>
	withBase(base, 'node_started', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			inputs: null,
			created_at: base.created_at,
			extras: {},
			iteration_id: null,
			loop_id: null,
		},
	})
export const nodeFinished = (
	base: StreamBase,
	runId: string,
	node: StubNode,
	outputs: Record<string, unknown>,
	status: 'succeeded' | 'failed' = 'succeeded',
	error: string | null = null,
) =>
	withBase(base, 'node_finished', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			status,
			inputs: { query: 'hello' },
			process_data: { prompt: 'system' },
			outputs,
			elapsed_time: 0.42,
			execution_metadata: { total_tokens: 12, total_price: 0.0001, currency: 'USD' },
			error,
			files: null,
			created_at: base.created_at,
			finished_at: base.created_at + 1,
		},
	})
export const nodeRetry = (base: StreamBase, runId: string, node: StubNode, attempt: number) =>
	withBase(base, 'node_retry', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			retry_index: attempt,
			status: 'retry',
			error: 'upstream timeout',
			elapsed_time: 0.2,
			execution_metadata: null,
			files: null,
			inputs: null,
			created_at: base.created_at,
			finished_at: base.created_at,
		},
	})
export const workflowFinished = (
	base: StreamBase,
	runId: string,
	outputs: Record<string, unknown> | null,
	files: unknown[] | null = null,
	error: string | null = null,
) =>
	withBase(base, 'workflow_finished', {
		workflow_run_id: runId,
		data: {
			id: runId,
			workflow_id: 'wf-1',
			status: error ? 'failed' : 'succeeded',
			outputs,
			error,
			elapsed_time: 1.2,
			total_tokens: 30,
			total_steps: 2,
			exceptions_count: 0,
			files,
			created_at: base.created_at,
			finished_at: base.created_at + 1,
		},
	})
export const workflowPaused = (base: StreamBase, runId: string, pausedNodes: string[]) =>
	withBase(base, 'workflow_paused', {
		workflow_run_id: runId,
		data: {
			workflow_run_id: runId,
			status: 'paused',
			paused_nodes: pausedNodes,
			reasons: [{ type: 'human_input' }],
			outputs: {},
			elapsed_time: 0.8,
			total_tokens: 12,
			total_steps: 1,
			created_at: base.created_at,
		},
	})
export const humanInputRequired = (base: StreamBase, runId: string, formToken: string, nodeId: string, expiresAt: number) =>
	withBase(base, 'human_input_required', {
		workflow_run_id: runId,
		data: {
			form_token: formToken,
			form_content: 'Please review the draft and approve it or request changes.',
			inputs: [
				{ type: 'paragraph', output_variable_name: 'feedback', default: { type: 'constant', value: '', selector: [] } },
				{
					type: 'select',
					output_variable_name: 'priority',
					default: { type: 'constant', value: 'medium', selector: [] },
					option_source: { type: 'constant', value: ['low', 'medium', 'high'], selector: [] },
				},
			],
			actions: [
				{ id: 'approve', title: 'Approve', button_style: 'primary' },
				{ id: 'reject', title: 'Request changes', button_style: 'default' },
			],
			resolved_default_values: { feedback: '', priority: 'medium' },
			expiration_time: expiresAt,
			display_in_ui: true,
			node_id: nodeId,
			node_title: 'Review',
		},
	})
export const humanInputFormFilled = (base: StreamBase, runId: string, nodeId: string, action: string, inputs: Record<string, string>) =>
	withBase(base, 'human_input_form_filled', {
		workflow_run_id: runId,
		data: {
			node_id: nodeId,
			node_title: 'Review',
			action_id: action,
			action_text: action === 'approve' ? 'Approve' : 'Request changes',
			rendered_content: `Review: ${inputs.feedback ?? ''} (${inputs.priority ?? ''})`,
			submitted_data: inputs,
		},
	})
export const humanInputFormTimeout = (base: StreamBase, runId: string, nodeId: string, expiresAt: number) =>
	withBase(base, 'human_input_form_timeout', {
		workflow_run_id: runId,
		data: { node_id: nodeId, node_title: 'Review', expiration_time: expiresAt },
	})
export const textChunk = (base: StreamBase, runId: string, text: string) =>
	withBase(base, 'text_chunk', { workflow_run_id: runId, data: { text, from_variable_selector: null } })
export const ping = (base: StreamBase) => withBase(base, 'ping', {})

export const retrieverResource = (base: StreamBase, position: number, content: string) => ({
	id: `rr-${base.message_id}-${position}`,
	message_id: base.message_id,
	position,
	dataset_id: 'ds-1',
	dataset_name: 'Handbook',
	document_id: `doc-${position}`,
	document_name: `handbook-${position}.md`,
	data_source_type: 'upload_file',
	segment_id: `seg-${position}`,
	score: 0.9 - position / 10,
	hit_count: 3,
	word_count: content.length,
	segment_position: position,
	index_node_hash: 'abcdef1234567890',
	content,
	created_at: base.created_at,
})
```

- [ ] **Step 5: Scenarios**

`e2e/fixtures/stub/scenarios.ts`:

```ts
import { MARKDOWN_SAMPLES } from '../markdown-samples'
import type { StubMode } from './apps'
import * as ev from './events'
import type { StreamBase, StreamEvent, StubNode } from './events'

export interface ScenarioContext {
	base: StreamBase
	runId: string
	formToken: string
	fileUrl: string
}

const NODES: StubNode[] = [
	{ id: 'exec-start', nodeId: 'start', type: 'start', title: 'Start', index: 1 },
	{ id: 'exec-llm', nodeId: 'llm-1', type: 'llm', title: 'Answer', index: 2 },
]
export const REVIEW_NODE: StubNode = { id: 'exec-review', nodeId: 'review', type: 'human-input', title: 'Review', index: 2 }

export const answerFor = (query: string) => `Echo: ${query}`
export const has = (query: string, word: string) => query.toLowerCase().includes(word)

const chunks = (text: string, size = 24) => {
	const out: string[] = []
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
	return out.length ? out : ['']
}

/** Chat-like apps: the stream for POST /chat-messages, chosen by the query text. */
export const chatScenario = (mode: StubMode, query: string, ctx: ScenarioContext): StreamEvent[] => {
	const { base, runId, formToken, fileUrl } = ctx
	const answer = answerFor(query)
	if (has(query, 'error')) return [ev.message(base, 'Echo: '), ev.errorEvent(base, 'completion_request_error', 'The model is unavailable.', 500)]
	if (has(query, 'markdown')) return [...chunks(MARKDOWN_SAMPLES.streaming, 40).map(c => ev.message(base, c)), ev.messageEnd(base)]
	if (has(query, 'slow')) return [...Array.from({ length: 40 }, (_, i) => ev.message(base, `${i} `)), ev.messageEnd(base)]
	if (has(query, 'files')) return [ev.message(base, answer), ev.messageFile(base, fileUrl), ev.messageEnd(base)]
	if (has(query, 'cite')) {
		return [ev.message(base, answer), ev.messageEnd(base, [ev.retrieverResource(base, 1, 'Tea is brewed at 80 °C.'), ev.retrieverResource(base, 2, 'Steep for three minutes.')])]
	}
	if (mode === 'agent-chat') {
		return [
			ev.agentThought(base, 1, { thought: 'I should look this up.' }),
			ev.agentThought(base, 2, { thought: '', tool: 'web_search', tool_input: '{"q":"hello"}', observation: '{"results":["one","two"]}' }),
			ev.agentMessage(base, 'Echo: '),
			ev.agentMessage(base, query),
			ev.messageEnd(base),
		]
	}
	if (mode === 'advanced-chat') {
		if (has(query, 'hitl')) {
			return [
				ev.workflowStarted(base, runId),
				ev.nodeStarted(base, runId, NODES[0]),
				ev.nodeFinished(base, runId, NODES[0], { query }),
				ev.nodeStarted(base, runId, REVIEW_NODE),
				ev.humanInputRequired(base, runId, formToken, REVIEW_NODE.nodeId, base.created_at + 3600),
				ev.workflowPaused(base, runId, [REVIEW_NODE.nodeId]),
			]
		}
		const retry = has(query, 'retry') ? [ev.nodeRetry(base, runId, NODES[1], 1)] : []
		return [
			ev.workflowStarted(base, runId),
			ev.nodeStarted(base, runId, NODES[0]),
			ev.nodeFinished(base, runId, NODES[0], { query }),
			ev.nodeStarted(base, runId, NODES[1]),
			...retry,
			ev.reasoningChunk(base, 'The user greets me. '),
			ev.reasoningChunk(base, 'A short reply is enough.', true),
			ev.message(base, 'Echo: '),
			ev.message(base, query),
			ev.nodeFinished(base, runId, NODES[1], { text: answer }),
			ev.messageEnd(base),
			ev.workflowFinished(base, runId, { answer }),
		]
	}
	return [ev.message(base, 'Echo: '), ev.message(base, query), ev.messageEnd(base)]
}

/** The resumed stream for GET /workflow/{run_id}/events after a HITL submission. */
export const resumeScenario = (ctx: ScenarioContext, action: string, inputs: Record<string, string>): StreamEvent[] => {
	const { base, runId } = ctx
	const text = action === 'approve' ? `Approved: ${inputs.feedback ?? ''}`.trim() : `Changes requested: ${inputs.feedback ?? ''}`.trim()
	return [
		ev.workflowStarted(base, runId, 'resumption'),
		ev.humanInputFormFilled(base, runId, REVIEW_NODE.nodeId, action, inputs),
		ev.nodeFinished(base, runId, REVIEW_NODE, inputs),
		ev.nodeStarted(base, runId, NODES[1]),
		...chunks(text, 12).map(c => ev.message(base, c)),
		ev.nodeFinished(base, runId, NODES[1], { text }),
		ev.messageEnd(base),
		ev.workflowFinished(base, runId, { answer: text }),
	]
}

/** Workflow and completion apps: the stream for POST /workflows/run and POST /completion-messages. */
export const runScenario = (mode: StubMode, inputs: Record<string, unknown>, ctx: ScenarioContext): StreamEvent[] => {
	const { base, runId } = ctx
	const topic = String(inputs.topic ?? Object.values(inputs)[0] ?? 'nothing')
	const text = `A short note about ${topic}.`
	if (mode === 'completion') return [ev.message(base, 'A short note '), ev.message(base, `about ${topic}.`), ev.messageEnd(base)]
	return [
		ev.workflowStarted(base, runId),
		ev.nodeStarted(base, runId, NODES[0]),
		ev.nodeFinished(base, runId, NODES[0], inputs),
		ev.nodeStarted(base, runId, NODES[1]),
		...chunks(text, 10).map(c => ev.textChunk(base, runId, c)),
		ev.nodeFinished(base, runId, NODES[1], { text }),
		ev.workflowFinished(base, runId, { text }),
	]
}

/** Parameters per mode (GET /parameters). The agent and chatflow apps turn the optional features on. */
export const parametersFor = (mode: StubMode) => {
	const rich = mode === 'agent-chat' || mode === 'advanced-chat'
	return {
		opening_statement: mode === 'chat' ? 'Hello from the stub' : `Hello from the stub ${mode}`,
		suggested_questions: ['What can you do?', 'Tell me a joke'],
		suggested_questions_after_answer: { enabled: rich },
		speech_to_text: { enabled: rich },
		text_to_speech: { enabled: rich, autoPlay: 'disabled', language: 'en-US', voice: 'alloy' },
		retriever_resource: { enabled: rich },
		annotation_reply: { enabled: false },
		user_input_form:
			mode === 'workflow' || mode === 'completion'
				? [{ 'text-input': { label: 'Topic', variable: 'topic', required: true, default: '', max_length: 48 } }]
				: [],
		file_upload: {
			enabled: rich,
			allowed_file_types: ['image', 'document'],
			allowed_file_extensions: ['.png', '.jpg', '.pdf', '.txt'],
			allowed_file_upload_methods: ['local_file'],
			number_limits: 3,
			fileUploadConfig: { file_size_limit: 15, batch_count_limit: 5, image_file_size_limit: 10, video_file_size_limit: 100, audio_file_size_limit: 50, workflow_file_upload_limit: 10 },
			image: { enabled: rich, number_limits: 3, transfer_methods: ['local_file'] },
		},
		system_parameters: { file_size_limit: 15, image_file_size_limit: 10, audio_file_size_limit: 50, video_file_size_limit: 100 },
	}
}
```

Run: `pnpm exec vitest run __tests__/stub-events.test.ts` → PASS.

- [ ] **Step 6: The router and the server**

`e2e/fixtures/stub/router.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { modeFromPath, STUB_APPS, type StubMode } from './apps'
import { STUB_PNG, STUB_WAV } from './assets'
import type { StreamEvent } from './events'
import { answerFor, chatScenario, has, parametersFor, resumeScenario, runScenario } from './scenarios'
import { forUser, now, pendingForms, resetAll, type StoredMessage } from './store'

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}
const difyError = (res: ServerResponse, status: number, code: string, message: string) => json(res, status, { code, message, status })

const readBody = (req: IncomingMessage) =>
	new Promise<string>(resolve => {
		let data = ''
		req.on('data', chunk => (data += chunk))
		req.on('end', () => resolve(data))
	})

/** Dify-shaped 400 on unparsable JSON instead of a crash. */
const parseJson = async (req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> => {
	const raw = await readBody(req)
	if (!raw) return {}
	try {
		return JSON.parse(raw) as Record<string, unknown>
	} catch {
		difyError(res, 400, 'invalid_param', 'Request body is not valid JSON.')
		return null
	}
}

const sse = (res: ServerResponse, events: StreamEvent[], delayMs: number, onDone?: () => void) => {
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
	let i = 0
	const tick = () => {
		if (res.destroyed) return
		if (i === events.length) {
			onDone?.()
			return res.end()
		}
		res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
		setTimeout(tick, delayMs)
	}
	tick()
}

const userOf = (url: URL, body: Record<string, unknown> | null) => String(body?.user ?? url.searchParams.get('user') ?? 'anonymous')

const appFor = (mode: StubMode) => STUB_APPS.find(a => a.mode === mode)!

export const handle = async (req: IncomingMessage, res: ServerResponse, port: number) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
	const method = req.method ?? 'GET'

	// e2e control endpoint (removed with the race fix in the chat sub-project): forget every user's state.
	if (method === 'POST' && url.pathname === '/__e2e/reset') {
		resetAll()
		return json(res, 200, { result: 'success' })
	}
	if (method === 'GET' && url.pathname === '/files/stub-image.png') {
		res.writeHead(200, { 'content-type': 'image/png' })
		return res.end(STUB_PNG)
	}

	const { mode, path } = modeFromPath(url.pathname)
	const app = appFor(mode)
	const fileUrl = `http://127.0.0.1:${port}/files/stub-image.png`

	if (method === 'GET' && path === '/parameters') return json(res, 200, parametersFor(mode))
	if (method === 'GET' && path === '/meta') return json(res, 200, { tool_icons: {} })
	if (method === 'GET' && path === '/info') return json(res, 200, { name: app.name, description: 'e2e', tags: [], mode, author_name: 'e2e' })
	if (method === 'GET' && path === '/site') {
		return json(res, 200, {
			title: app.name, icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5', description: 'e2e', default_language: 'en-US',
			chat_color_theme: '', show_workflow_steps: true, use_icon_as_answer_icon: false, custom_disclaimer: 'Answers come from the stub.',
		})
	}

	if (method === 'GET' && path === '/conversations') {
		const store = forUser(userOf(url, null))
		const data = [...store.conversations.values()]
			.sort((a, b) => b.updated_at - a.updated_at)
			.map(c => ({ ...c, status: 'normal', introduction: '' }))
		return json(res, 200, { data, has_more: false, limit: Number(url.searchParams.get('limit') ?? 20) })
	}
	if (method === 'GET' && path === '/messages') {
		const store = forUser(userOf(url, null))
		const cid = url.searchParams.get('conversation_id')
		const limit = Number(url.searchParams.get('limit') ?? 20)
		const firstId = url.searchParams.get('first_id')
		let list = store.messages.filter(m => m.conversation_id === cid).sort((a, b) => b.created_at - a.created_at)
		if (firstId) {
			const idx = list.findIndex(m => m.id === firstId)
			list = idx >= 0 ? list.slice(idx + 1) : []
		}
		const page = list.slice(0, limit)
		const respond = () => json(res, 200, { data: page, has_more: list.length > limit, limit })
		// Reopening a conversation whose first query asked for a slow history: the race test sends during this wait.
		const slow = store.conversations.get(cid ?? '')?.name.toLowerCase().includes('slowhistory')
		return slow ? void setTimeout(respond, 1500) : respond()
	}
	if (method === 'GET' && /^\/messages\/[^/]+\/suggested$/.test(path)) {
		return json(res, 200, { result: 'success', data: parametersFor(mode).suggested_questions_after_answer.enabled ? ['Why is that?', 'Can you give an example?'] : [] })
	}
	if (method === 'POST' && /^\/messages\/[^/]+\/feedbacks$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		const msg = forUser(userOf(url, body)).messages.find(m => m.id === path.split('/')[2])
		if (!msg) return difyError(res, 404, 'message_not_exists', 'Message Not Exists.')
		msg.feedback = body.rating ? { rating: body.rating as 'like' | 'dislike' } : null
		return json(res, 200, { result: 'success' })
	}
	if (method === 'POST' && /^\/conversations\/[^/]+\/name$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		const c = forUser(userOf(url, body)).conversations.get(path.split('/')[2])
		if (c && typeof body.name === 'string') c.name = body.name
		return json(res, 200, c ?? {})
	}
	if (method === 'DELETE' && /^\/conversations\/[^/]+$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		forUser(userOf(url, body)).conversations.delete(path.split('/')[2])
		return json(res, 200, { result: 'success' })
	}
	if (method === 'POST' && /^\/(chat-messages|completion-messages|workflows\/tasks)\/[^/]+\/stop$/.test(path)) return json(res, 200, { result: 'success' })

	if (method === 'POST' && path === '/files/upload') {
		await readBody(req)
		return json(res, 200, { id: randomUUID(), name: 'upload.txt', size: 12, extension: 'txt', mime_type: 'text/plain', created_by: 1, created_at: now() })
	}
	if (method === 'GET' && /^\/files\/[^/]+\/preview$/.test(path)) {
		res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="stub-image.png"' })
		return res.end(STUB_PNG)
	}
	if (method === 'POST' && path === '/text-to-audio') {
		await readBody(req)
		res.writeHead(200, { 'content-type': 'audio/wav' })
		return res.end(STUB_WAV)
	}
	if (method === 'POST' && path === '/audio-to-text') {
		await readBody(req)
		return json(res, 200, { text: 'transcribed from the stub' })
	}
	if (method === 'POST' && path === '/annotations') {
		const body = await parseJson(req, res)
		if (!body) return
		return json(res, 200, { id: randomUUID(), question: body.question, answer: body.answer, hit_count: 0, created_at: now() })
	}

	if (method === 'GET' && /^\/form\/human_input\/[^/]+$/.test(path)) {
		const form = pendingForms.get(path.split('/')[3])
		if (!form) return difyError(res, 404, 'form_not_found', 'Form not found.')
		const required = chatScenario('advanced-chat', 'hitl', { base: { task_id: form.taskId, message_id: form.messageId, conversation_id: form.conversationId, created_at: now() }, runId: form.workflowRunId, formToken: form.formToken, fileUrl })
			.find(e => e.event === 'human_input_required') as { data: Record<string, unknown> }
		const { form_content, inputs, resolved_default_values, actions, expiration_time } = required.data as Record<string, unknown>
		return json(res, 200, { form_content, inputs, resolved_default_values, user_actions: actions, expiration_time })
	}
	if (method === 'POST' && /^\/form\/human_input\/[^/]+$/.test(path)) {
		const body = await parseJson(req, res)
		if (!body) return
		const form = pendingForms.get(path.split('/')[3])
		if (!form) return difyError(res, 404, 'form_not_found', 'Form not found.')
		form.submitted = { inputs: (body.inputs as Record<string, string>) ?? {}, action: String(body.action ?? 'approve') }
		return json(res, 200, { result: 'success' })
	}
	if (method === 'GET' && /^\/workflow\/[^/]+\/events$/.test(path)) {
		const runId = path.split('/')[2]
		const form = [...pendingForms.values()].find(f => f.workflowRunId === runId)
		const base = { task_id: form?.taskId ?? randomUUID(), message_id: form?.messageId ?? randomUUID(), conversation_id: form?.conversationId ?? '', created_at: now() }
		if (!form?.submitted) return sse(res, [{ event: 'workflow_finished', ...base, workflow_run_id: runId, data: { id: runId, status: 'succeeded', outputs: {} } }], 20)
		const events = resumeScenario({ base, runId, formToken: form.formToken, fileUrl }, form.submitted.action, form.submitted.inputs)
		return sse(res, events, 20, () => {
			const store = forUser(form.user)
			const msg = store.messages.find(m => m.id === form.messageId)
			if (msg) msg.answer = events.filter(e => e.event === 'message').map(e => String((e as { answer?: string }).answer ?? '')).join('')
			pendingForms.delete(form.formToken)
		})
	}

	if (method === 'POST' && path === '/chat-messages') {
		const body = await parseJson(req, res)
		if (!body) return
		if (!body.user) return difyError(res, 400, 'invalid_param', 'user is required')
		if (typeof body.query !== 'string' || !body.query) return difyError(res, 400, 'invalid_param', 'query is required')
		const user = String(body.user)
		const store = forUser(user)
		const query = body.query
		const conversation_id = (body.conversation_id as string) || randomUUID()
		if (!store.conversations.has(conversation_id)) {
			store.conversations.set(conversation_id, { id: conversation_id, name: query.slice(0, 40), created_at: now(), updated_at: now(), inputs: (body.inputs as Record<string, unknown>) ?? {} })
		} else {
			store.conversations.get(conversation_id)!.updated_at = now()
		}
		const base = { task_id: randomUUID(), message_id: randomUUID(), conversation_id, created_at: now() }
		const runId = randomUUID()
		const formToken = `ft-${randomUUID()}`
		const events = chatScenario(mode, query, { base, runId, formToken, fileUrl })
		const isError = events.some(e => e.event === 'error')
		const answer = events.filter(e => e.event === 'message' || e.event === 'agent_message').map(e => String((e as { answer?: string }).answer ?? '')).join('')
		const stored: StoredMessage = {
			id: base.message_id, conversation_id, query, answer, created_at: base.created_at, feedback: null,
			inputs: (body.inputs as Record<string, unknown>) ?? {}, message_files: [], retriever_resources: [],
			agent_thoughts: events.filter(e => e.event === 'agent_thought'),
			status: isError ? 'error' : 'normal', error: isError ? 'The model is unavailable.' : null,
		}
		if (has(query, 'history40')) {
			for (let i = 0; i < 40; i++) {
				store.messages.push({ ...stored, id: randomUUID(), query: `earlier ${i + 1}`, answer: `Echo: earlier ${i + 1}`, created_at: base.created_at - 100 + i, agent_thoughts: [], status: 'normal', error: null })
			}
		}
		store.messages.push(stored)
		if (events.some(e => e.event === 'human_input_required')) {
			pendingForms.set(formToken, { formToken, workflowRunId: runId, user, conversationId: conversation_id, messageId: base.message_id, taskId: base.task_id })
		}
		return sse(res, events, has(query, 'slow') ? 100 : 20)
	}

	if (method === 'POST' && (path === '/workflows/run' || path === '/completion-messages')) {
		const body = await parseJson(req, res)
		if (!body) return
		if (!body.user) return difyError(res, 400, 'invalid_param', 'user is required')
		const base = { task_id: randomUUID(), message_id: randomUUID(), conversation_id: '', created_at: now() }
		return sse(res, runScenario(mode, (body.inputs as Record<string, unknown>) ?? {}, { base, runId: randomUUID(), formToken: '', fileUrl }), 20)
	}

	difyError(res, 404, 'not_found', `stub has no route for ${method} ${url.pathname}`)
}
```

`e2e/fixtures/stub/server.ts`:

```ts
import { createServer } from 'node:http'

import { handle } from './router'

const port = Number(process.env.E2E_DIFY_STUB_PORT ?? 5399)

createServer((req, res) => {
	handle(req, res, port).catch(error => {
		console.error('stub error', error)
		if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ code: 'internal_error', message: String(error), status: 500 }))
	})
}).listen(port, '127.0.0.1', () => console.log(`dify stub listening on http://127.0.0.1:${port}/v1 (+ /agent, /chatflow, /workflow, /completion)`))
```

Delete the old file: `git rm e2e/fixtures/dify-stub.ts`. In `playwright.config.ts` change the stub `command` to `'pnpm exec tsx e2e/fixtures/stub/server.ts'` (the readiness URL `/v1/parameters` stays valid).

- [ ] **Step 7: Seed the five apps**

`e2e/auth.setup.ts` — replace the single `INSERT IGNORE` with a loop:

```ts
import { ADMIN_STATE, STUB_APPS } from './fixtures/constants'
…
	const db = await mysql.createConnection(e2eEnv.DATABASE_URL)
	for (const app of STUB_APPS) {
		await db.execute(
			'INSERT IGNORE INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[app.id, app.name, app.mode, 'Seeded for the e2e suite', `${stubApiBase}${app.prefix}`, 'app-e2e', 'default'],
		)
	}
	await db.end()
```

- [ ] **Step 8: Run the whole suite**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint e2e __tests__/stub-events.test.ts && pnpm test && pnpm test:e2e`
Expected: unit green; e2e green — the existing specs target the chat app at `/v1`, the apps page now lists five apps (`screenshots.spec.ts`'s `stubApp(page).first()` still finds "Stub app"), the `/api/health` harness check passes. If `smoke.spec.ts`'s app-list click opens the wrong app because five cards exist, change its locator to `page.getByText('Stub app', { exact: true })`.

- [ ] **Step 9: Commit**

```bash
pnpm exec oxfmt --write e2e __tests__/stub-events.test.ts playwright.config.ts
git add e2e playwright.config.ts __tests__/stub-events.test.ts
git commit -m "test(e2e): stub Dify API serves five apps by path prefix with the full event catalogue" -m "One stub process; /v1 stays the chat app and /agent, /chatflow, /workflow, /completion select the other modes. Events are built from Dify's OpenAPI schemas (agent thoughts, chatflow nodes with reasoning_chunk and node_retry, human_input_required/workflow_paused and the resumed stream, error, message_file, text_chunk). Conversations and messages are stored per user, bodies are parsed into Dify's 400 shape, and the five apps are seeded by auth.setup.ts." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---
### Task 6: Message model, conversation keys, Dify fetch and the provider

**Spec:** §4.1, §4.2, §4.3 (fetch and keys), §4.10 (persistence move). ADR-0017.

**Files:**
- Create: `components/chat/provider/message.ts`, `components/chat/provider/keys.ts`, `components/chat/provider/dify-fetch.ts`, `components/chat/provider/dify-chat-provider.ts`, `__tests__/chat-keys.test.ts`, `__tests__/dify-fetch.test.ts`, `__tests__/dify-chat-provider.test.ts`
- Move: `hooks/useX/workflow-data-storage.ts` → `components/chat/persistence/workflow-data-storage.ts` (update the two old imports in `hooks/useX/x-provider.ts` and `components/chat/chatbox-wrapper.tsx` to the new path; they are deleted in Task 19)

**Interfaces:**
- Produces (used by every later task):
  - `DifyChatMessage`, `DifyChatInput`, `WorkflowState`, `WorkflowNode`, `MessageFile`, `HumanInputState`, `MessageError`, `emptyAssistant()`, `DifyStreamEvent`.
  - `conversationKeyFor(appId, difyId)`, `newTempConversationKey(appId)`, `parseConversationKey(key): { appId: string; difyId?: string; temp: boolean }`.
  - `DifyRequestError` (`status`, `code`, `message`), `createDifyFetch(appId): XRequestOptions['fetch']`.
  - `applyEvent(origin: DifyChatMessage, event: DifyStreamEvent): DifyChatMessage` (pure), `DifyChatProvider` with constructor options `{ request, getDifyConversationId: () => string | undefined, onWorkflowUpdate?: (message) => void }`.
- Consumes: `IFile`, `IAgentThought`, `IRetrieverResource` from `@/lib/api`; `generateUuidV4` from `@/lib/helpers`; `AbstractChatProvider`, `XRequestOptions`, `SSEOutput`, `TransformMessage` from `@ant-design/x-sdk`.

- [ ] **Step 1: Write the failing key tests**

`__tests__/chat-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { conversationKeyFor, newTempConversationKey, parseConversationKey } from '@/components/chat/provider/keys'

const APP = 'e2e00000-0000-4000-8000-000000000001'

describe('conversation keys', () => {
	it('prefixes server conversations with the app id', () => {
		expect(conversationKeyFor(APP, 'conv-1')).toBe(`${APP}:conv-1`)
		expect(parseConversationKey(`${APP}:conv-1`)).toEqual({ appId: APP, difyId: 'conv-1', temp: false })
	})
	it('marks a new chat as temporary until the server assigns an id', () => {
		const key = newTempConversationKey(APP)
		expect(key.startsWith(`${APP}:temp:`)).toBe(true)
		expect(parseConversationKey(key)).toEqual({ appId: APP, difyId: undefined, temp: true })
	})
	it('never produces the same temporary key twice', () => {
		expect(newTempConversationKey(APP)).not.toBe(newTempConversationKey(APP))
	})
})
```

- [ ] **Step 2: Implement `keys.ts`**

```ts
import { generateUuidV4 } from '@/lib/helpers'

/**
 * useXChat keys (spec §4.3). The x-sdk keeps one message store per key in a module-global map,
 * so keys carry the app id; a new chat gets a temporary key that never changes during the page
 * session — the Dify id it receives is stored on the conversation item instead.
 */
const TEMP = 'temp'

export const conversationKeyFor = (appId: string, difyId: string) => `${appId}:${difyId}`

export const newTempConversationKey = (appId: string) => `${appId}:${TEMP}:${generateUuidV4()}`

export const parseConversationKey = (key: string): { appId: string; difyId?: string; temp: boolean } => {
	const [appId, second] = key.split(':')
	if (second === TEMP) return { appId, difyId: undefined, temp: true }
	return { appId, difyId: second, temp: false }
}
```

Run: `pnpm exec vitest run __tests__/chat-keys.test.ts` → PASS.

- [ ] **Step 3: Write the message model**

`components/chat/provider/message.ts`:

```ts
import type { IAgentThought, IFile, IRetrieverResource } from '@/lib/api'

export type DifyRole = 'user' | 'assistant'

export interface WorkflowNode {
	/** node execution id (data.id) */
	id: string
	nodeId: string
	type: string
	title: string
	index?: number
	status: 'running' | 'retrying' | 'success' | 'error'
	inputs?: Record<string, unknown> | null
	outputs?: Record<string, unknown> | null
	processData?: Record<string, unknown> | null
	elapsedTime?: number
	totalTokens?: number
	error?: string | null
	retries?: number
}

export interface WorkflowState {
	runId?: string
	status: 'running' | 'paused' | 'finished' | 'failed'
	nodes: WorkflowNode[]
}

export interface MessageFile {
	id: string
	type: string
	url: string
	belongsTo: 'user' | 'assistant'
	filename?: string
	size?: number
	mimeType?: string
	uploadFileId?: string
}

export interface HumanInputField {
	type: 'paragraph' | 'select' | 'file' | 'file-list' | string
	output_variable_name: string
	default?: { type: string; value?: string; selector?: string[] } | null
	option_source?: { type: string; value?: string[]; selector?: string[] }
}

export interface HumanInputAction {
	id: string
	title: string
	button_style: 'primary' | 'default' | 'accent' | 'ghost' | string
}

export interface HumanInputState {
	state: 'pending' | 'filled' | 'expired'
	formToken: string
	formContent: string
	inputs: HumanInputField[]
	actions: HumanInputAction[]
	defaults: Record<string, string>
	/** unix seconds */
	expiresAt: number
	workflowRunId: string
	nodeId?: string
	renderedContent?: string
	actionText?: string
}

export interface MessageError {
	code?: string
	message: string
	status?: number
}

/** One bubble's worth of state, built by applyEvent() from Dify's stream or by the history mapper. */
export interface DifyChatMessage {
	role: DifyRole
	content: string
	reasoning?: string
	reasoningDone?: boolean
	thoughts?: IAgentThought[]
	workflow?: WorkflowState
	files?: MessageFile[]
	citations?: IRetrieverResource[]
	humanInput?: HumanInputState
	error?: MessageError
	ids: { messageId?: string; conversationId?: string; taskId?: string }
	/** unix seconds, from StreamEventBase.created_at or the history record */
	createdAt?: number
	feedback?: 'like' | 'dislike' | null
	/** user message: the inputs it was sent with */
	inputs?: Record<string, unknown>
	/** set by requestFallback when the user stopped the reply */
	aborted?: boolean
}

/** onRequest params. `resume` turns the request into a HITL continuation (spec §4.6). */
export interface DifyChatInput {
	query: string
	inputs: Record<string, unknown>
	files: IFile[]
	conversation_id?: string
	user?: string
	response_mode: 'streaming'
	resume?: { workflowRunId: string; message: DifyChatMessage }
}

/** A parsed SSE `data:` payload. Dify's events share StreamEventBase; the rest is per event. */
export interface DifyStreamEvent {
	event: string
	task_id?: string
	message_id?: string
	conversation_id?: string
	created_at?: number
	workflow_run_id?: string
	answer?: string
	[key: string]: unknown
}

export const emptyAssistant = (): DifyChatMessage => ({ role: 'assistant', content: '', ids: {} })
```

- [ ] **Step 4: Write the failing fetch tests**

`__tests__/dify-fetch.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDifyFetch, DifyRequestError } from '@/components/chat/provider/dify-fetch'

const APP = 'app-1'
const jsonResponse = (status: number, body: unknown, type = 'application/json') =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })

describe('createDifyFetch', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('posts chat requests to the app proxy with the body and the abort signal', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}, 'text/event-stream'))
		vi.stubGlobal('fetch', fetchMock)
		const controller = new AbortController()
		const body = JSON.stringify({ query: 'hi', inputs: {}, files: [], response_mode: 'streaming' })
		await createDifyFetch(APP)('ignored', { body, signal: controller.signal } as never)
		expect(fetchMock).toHaveBeenCalledWith(`/api/client/dify/${APP}/chat-messages`, expect.objectContaining({
			method: 'POST',
			body,
			signal: controller.signal,
			headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
		}))
	})

	it('routes a resume request to the workflow events proxy as a GET without the resume payload', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}, 'text/event-stream'))
		vi.stubGlobal('fetch', fetchMock)
		const body = JSON.stringify({ resume: { workflowRunId: 'run-9', message: { role: 'assistant', content: 'x', ids: {} } } })
		await createDifyFetch(APP)('ignored', { body } as never)
		expect(fetchMock).toHaveBeenCalledWith(`/api/client/dify/${APP}/workflow/run-9/events`, expect.objectContaining({ method: 'GET' }))
	})

	it('throws a DifyRequestError carrying Dify code, message and status on a non-OK response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { code: 'invalid_param', message: 'query is required', status: 400 })))
		const error = await createDifyFetch(APP)('ignored', { body: '{}' } as never).catch(e => e)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({ name: 'DifyRequestError', status: 400, code: 'invalid_param', message: 'query is required' })
	})

	it('falls back to the status text when the error body is not JSON', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502, statusText: 'Bad Gateway' })))
		const error = await createDifyFetch(APP)('ignored', { body: '{}' } as never).catch(e => e)
		expect(error).toMatchObject({ status: 502, message: 'Bad Gateway' })
	})
})
```

Run: `pnpm exec vitest run __tests__/dify-fetch.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement `dify-fetch.ts`**

```ts
import type { SSEOutput, XRequestOptions } from '@ant-design/x-sdk'

import type { DifyChatInput, DifyChatMessage } from './message'

/** Dify's error body ({ code, message, status }) as a thrown error, so XRequest's catch → onError → requestFallback. */
export class DifyRequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | undefined,
		message: string,
	) {
		super(message)
		this.name = 'DifyRequestError'
	}
}

export const readDifyError = async (response: Response): Promise<DifyRequestError> => {
	let body: { code?: string; message?: string; error?: string } | null = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return new DifyRequestError(response.status, body?.code, body?.message ?? body?.error ?? response.statusText)
}

/**
 * The documented XRequest `fetch` option (x-request skill). XRequest hands us its RequestInit
 * (JSON body, abort signal); we route by payload: a `resume` request reads the workflow events
 * endpoint (HITL continuation, spec §4.6), everything else posts to chat-messages. Non-OK answers
 * become DifyRequestError because XRequest's own JSON handler only recognises `success === false`.
 */
export const createDifyFetch =
	(appId: string): NonNullable<XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>['fetch']> =>
	async (_baseURL, options) => {
		const init = (options ?? {}) as RequestInit & { body?: string }
		const body = init.body ? (JSON.parse(init.body) as DifyChatInput) : ({} as DifyChatInput)
		const response = body.resume
			? await fetch(`/api/client/dify/${appId}/workflow/${encodeURIComponent(body.resume.workflowRunId)}/events`, {
					method: 'GET',
					signal: init.signal ?? undefined,
				})
			: await fetch(`/api/client/dify/${appId}/chat-messages`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: init.body,
					signal: init.signal ?? undefined,
				})
		if (!response.ok) throw await readDifyError(response)
		return response
	}
```

Run: `pnpm exec vitest run __tests__/dify-fetch.test.ts` → PASS.

- [ ] **Step 6: Write the failing provider tests**

`__tests__/dify-chat-provider.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { applyEvent, DifyChatProvider } from '@/components/chat/provider/dify-chat-provider'
import { emptyAssistant, type DifyChatMessage, type DifyStreamEvent } from '@/components/chat/provider/message'

const base = { task_id: 'task-1', message_id: 'msg-1', conversation_id: 'conv-1', created_at: 1_700_000_000 }
const ev = (event: string, extra: Record<string, unknown> = {}): DifyStreamEvent => ({ event, ...base, ...extra })
const chunk = (event: DifyStreamEvent) => ({ data: JSON.stringify(event) })

const feed = (provider: DifyChatProvider, events: DifyStreamEvent[], origin?: DifyChatMessage) => {
	let message = origin
	for (const event of events) {
		message = provider.transformMessage({ originMessage: message, chunk: chunk(event), chunks: [], status: 'updating', responseHeaders: new Headers() })
	}
	return message!
}

const makeProvider = (overrides: Partial<ConstructorParameters<typeof DifyChatProvider>[0]> = {}) =>
	new DifyChatProvider({
		// AbstractChatProvider only checks `manual`; no network is involved in these tests.
		request: { manual: true, options: { params: {} } } as never,
		getDifyConversationId: () => 'conv-1',
		...overrides,
	})

describe('applyEvent', () => {
	it('accumulates answer text and records the ids and creation time', () => {
		const m = applyEvent(applyEvent(emptyAssistant(), ev('message', { answer: 'Hel' })), ev('message', { answer: 'lo' }))
		expect(m.content).toBe('Hello')
		expect(m.ids).toEqual({ messageId: 'msg-1', conversationId: 'conv-1', taskId: 'task-1' })
		expect(m.createdAt).toBe(1_700_000_000)
	})
	it('treats agent_message like message and replaces on message_replace', () => {
		const m = applyEvent(applyEvent(emptyAssistant(), ev('agent_message', { answer: 'draft' })), ev('message_replace', { answer: 'final' }))
		expect(m.content).toBe('final')
	})
	it('joins reasoning chunks and marks the final one', () => {
		const m = applyEvent(applyEvent(emptyAssistant(), ev('reasoning_chunk', { data: { reasoning: 'Think ', is_final: false } })), ev('reasoning_chunk', { data: { reasoning: 'done.', is_final: true } }))
		expect(m.reasoning).toBe('Think done.')
		expect(m.reasoningDone).toBe(true)
	})
	it('upserts agent thoughts by position', () => {
		const first = ev('agent_thought', { id: 't1', position: 1, thought: 'a', tool: '', tool_input: '', observation: '', message_files: [] })
		const update = ev('agent_thought', { id: 't1', position: 1, thought: 'a', tool: 'search', tool_input: '{}', observation: 'ok', message_files: [] })
		const m = applyEvent(applyEvent(emptyAssistant(), first), update)
		expect(m.thoughts).toHaveLength(1)
		expect(m.thoughts?.[0]).toMatchObject({ tool: 'search', observation: 'ok' })
	})
	it('builds the workflow state from started, node and finished events', () => {
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		const m = applyEvent(
			applyEvent(applyEvent(emptyAssistant(), ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1', reason: 'initial' } })), ev('node_started', { workflow_run_id: 'run-1', data: node })),
			ev('node_finished', { workflow_run_id: 'run-1', data: { ...node, status: 'succeeded', outputs: { text: 'x' }, inputs: { q: 1 }, process_data: null, elapsed_time: 0.5, execution_metadata: { total_tokens: 7 }, error: null } }),
		)
		expect(m.workflow).toMatchObject({ runId: 'run-1', status: 'running', nodes: [{ id: 'exec-1', status: 'success', elapsedTime: 0.5, totalTokens: 7, outputs: { text: 'x' } }] })
		const done = applyEvent(m, ev('workflow_finished', { workflow_run_id: 'run-1', data: { id: 'run-1', status: 'succeeded', outputs: {}, error: null } }))
		expect(done.workflow?.status).toBe('finished')
	})
	it('keeps the nodes when a workflow resumes after a pause and marks retries', () => {
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		let m = applyEvent(applyEvent(emptyAssistant(), ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1', reason: 'initial' } })), ev('node_started', { workflow_run_id: 'run-1', data: node }))
		m = applyEvent(m, ev('node_retry', { workflow_run_id: 'run-1', data: { ...node, retry_index: 1, error: 'timeout' } }))
		expect(m.workflow?.nodes[0]).toMatchObject({ status: 'retrying', retries: 1, error: 'timeout' })
		m = applyEvent(m, ev('workflow_paused', { workflow_run_id: 'run-1', data: { status: 'paused' } }))
		expect(m.workflow?.status).toBe('paused')
		m = applyEvent(m, ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1', reason: 'resumption' } }))
		expect(m.workflow?.nodes).toHaveLength(1)
		expect(m.workflow?.status).toBe('running')
	})
	it('collects files and citations', () => {
		const m = applyEvent(applyEvent(emptyAssistant(), ev('message_file', { id: 'f1', type: 'image', belongs_to: 'assistant', url: 'http://x/f.png' })), ev('message_end', { metadata: { retriever_resources: [{ id: 'rr1', document_name: 'doc', content: 'c' }] } }))
		expect(m.files).toEqual([{ id: 'f1', type: 'image', url: 'http://x/f.png', belongsTo: 'assistant' }])
		expect(m.citations).toHaveLength(1)
	})
	it('stores a stream error on the message', () => {
		const m = applyEvent(emptyAssistant(), ev('error', { code: 'completion_request_error', message: 'The model is unavailable.', status: 500 }))
		expect(m.error).toEqual({ code: 'completion_request_error', message: 'The model is unavailable.', status: 500 })
	})
	it('records a human input request, then its filled and expired states', () => {
		const data = { form_token: 'ft', form_content: 'Review', inputs: [], actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }], resolved_default_values: {}, expiration_time: 1_700_003_600, node_id: 'review' }
		let m = applyEvent(emptyAssistant(), ev('human_input_required', { workflow_run_id: 'run-1', data }))
		expect(m.humanInput).toMatchObject({ state: 'pending', formToken: 'ft', workflowRunId: 'run-1', expiresAt: 1_700_003_600, nodeId: 'review' })
		m = applyEvent(m, ev('human_input_form_filled', { workflow_run_id: 'run-1', data: { node_id: 'review', action_id: 'approve', action_text: 'Approve', rendered_content: 'Review: ok' } }))
		expect(m.humanInput).toMatchObject({ state: 'filled', actionText: 'Approve', renderedContent: 'Review: ok' })
		const expired = applyEvent(applyEvent(emptyAssistant(), ev('human_input_required', { workflow_run_id: 'run-1', data })), ev('human_input_form_timeout', { workflow_run_id: 'run-1', data: { node_id: 'review' } }))
		expect(expired.humanInput?.state).toBe('expired')
	})
	it('ignores ping, tts and iteration events', () => {
		const m = emptyAssistant()
		for (const name of ['ping', 'tts_message', 'tts_message_end', 'iteration_started', 'loop_next', 'agent_log', 'text_chunk']) {
			expect(applyEvent(m, ev(name, { data: {} }))).toEqual(expect.objectContaining({ content: '' }))
		}
	})
})

describe('DifyChatProvider', () => {
	// Review Focus 1: junk chunks never throw or blank the message.
	it('returns the origin unchanged for [DONE], empty and non-JSON chunks', () => {
		const provider = makeProvider()
		const origin = { ...emptyAssistant(), content: 'kept' }
		for (const data of ['[DONE]', '', 'not json {']) {
			expect(provider.transformMessage({ originMessage: origin, chunk: { data }, chunks: [], status: 'updating', responseHeaders: new Headers() })).toBe(origin)
		}
	})
	it('sends the conversation id from the getter and the streaming defaults', () => {
		const provider = makeProvider()
		const params = provider.transformParams({ query: 'hi', inputs: { a: 1 }, files: [] }, { params: { user: 'jane@example.com' } } as never)
		expect(params).toEqual({ user: 'jane@example.com', query: 'hi', inputs: { a: 1 }, files: [], response_mode: 'streaming', conversation_id: 'conv-1' })
	})
	it('omits the conversation id for a new chat', () => {
		const provider = makeProvider({ getDifyConversationId: () => undefined })
		expect(provider.transformParams({ query: 'hi' }, { params: {} } as never).conversation_id).toBe('')
	})
	it('renders the local user bubble from the query and files, and none for a resume', () => {
		const provider = makeProvider()
		expect(provider.transformLocalMessage({ query: 'hi', files: [], inputs: { a: 1 } })).toMatchObject({ role: 'user', content: 'hi', inputs: { a: 1 } })
		expect(provider.transformLocalMessage({ resume: { workflowRunId: 'run-1', message: emptyAssistant() } })).toEqual([])
	})
	it('continues the paused message on a resume even though the SDK passes no originMessage on the first chunk', () => {
		const provider = makeProvider()
		const paused: DifyChatMessage = { ...emptyAssistant(), content: 'Before the pause. ', workflow: { runId: 'run-1', status: 'paused', nodes: [{ id: 'n1', nodeId: 'a', type: 'start', title: 'Start', status: 'success' }] } }
		provider.transformParams({ resume: { workflowRunId: 'run-1', message: paused } }, { params: {} } as never)
		const m = feed(provider, [ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1', reason: 'resumption' } }), ev('message', { answer: 'After.' })])
		expect(m.content).toBe('Before the pause. After.')
		expect(m.workflow?.nodes).toHaveLength(1)
	})
	it('forgets the resume base on the next normal send', () => {
		const provider = makeProvider()
		provider.transformParams({ resume: { workflowRunId: 'run-1', message: { ...emptyAssistant(), content: 'old' } } }, { params: {} } as never)
		provider.transformParams({ query: 'new' }, { params: {} } as never)
		expect(feed(provider, [ev('message', { answer: 'fresh' })]).content).toBe('fresh')
	})
	it('reports workflow updates so the hook can persist node data', () => {
		const onWorkflowUpdate = vi.fn()
		const provider = makeProvider({ onWorkflowUpdate })
		feed(provider, [ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1' } }), ev('message', { answer: 'x' })])
		expect(onWorkflowUpdate).toHaveBeenCalledTimes(1)
	})
})
```

Run: `pnpm exec vitest run __tests__/dify-chat-provider.test.ts` → FAIL (module missing).

- [ ] **Step 7: Implement `dify-chat-provider.ts`**

```ts
import { AbstractChatProvider } from '@ant-design/x-sdk'
import type { ChatProviderConfig, SSEOutput, TransformMessage, XRequestOptions } from '@ant-design/x-sdk'

import type { IAgentThought, IRetrieverResource } from '@/lib/api'

import {
	emptyAssistant,
	type DifyChatInput,
	type DifyChatMessage,
	type DifyStreamEvent,
	type HumanInputAction,
	type HumanInputField,
	type WorkflowNode,
	type WorkflowState,
} from './message'

type NodeData = {
	id: string
	node_id?: string
	node_type?: string
	title?: string
	index?: number
	status?: string
	inputs?: Record<string, unknown> | null
	outputs?: Record<string, unknown> | null
	process_data?: Record<string, unknown> | null
	elapsed_time?: number
	execution_metadata?: { total_tokens?: number } | null
	error?: string | null
	retry_index?: number
}

const WORKFLOW_EVENTS = new Set(['workflow_started', 'node_started', 'node_finished', 'node_retry', 'workflow_finished', 'workflow_paused'])

const withIds = (message: DifyChatMessage, event: DifyStreamEvent): DifyChatMessage => ({
	...message,
	ids: {
		messageId: event.message_id ?? message.ids.messageId,
		conversationId: event.conversation_id ?? message.ids.conversationId,
		taskId: event.task_id ?? message.ids.taskId,
	},
	createdAt: message.createdAt ?? event.created_at,
})

const nodeFrom = (data: NodeData, status: WorkflowNode['status']): WorkflowNode => ({
	id: data.id,
	nodeId: data.node_id ?? data.id,
	type: data.node_type ?? 'unknown',
	title: data.title ?? data.node_id ?? data.id,
	index: data.index,
	status,
})

const workflowOf = (message: DifyChatMessage): WorkflowState => message.workflow ?? { status: 'running', nodes: [] }

const updateNode = (workflow: WorkflowState, data: NodeData, patch: (node: WorkflowNode) => WorkflowNode): WorkflowState => {
	const exists = workflow.nodes.some(n => n.id === data.id)
	const nodes = exists ? workflow.nodes.map(n => (n.id === data.id ? patch(n) : n)) : [...workflow.nodes, patch(nodeFrom(data, 'running'))]
	return { ...workflow, nodes }
}

/**
 * Folds one Dify stream event into the message (spec §4.2 table). Pure: the provider and the
 * unit tests both call it. Unknown and ignored events return the input unchanged (ids refreshed).
 */
export const applyEvent = (origin: DifyChatMessage, event: DifyStreamEvent): DifyChatMessage => {
	const message = withIds(origin, event)
	const data = (event.data ?? {}) as Record<string, unknown>
	switch (event.event) {
		case 'message':
		case 'agent_message':
			return { ...message, content: message.content + (event.answer ?? '') }
		case 'message_replace':
			return { ...message, content: event.answer ?? '' }
		case 'reasoning_chunk':
			return {
				...message,
				reasoning: (message.reasoning ?? '') + String(data.reasoning ?? ''),
				reasoningDone: Boolean(data.is_final) || message.reasoningDone,
			}
		case 'agent_thought': {
			const thought = { ...event } as unknown as IAgentThought
			const thoughts = [...(message.thoughts ?? [])]
			const index = thoughts.findIndex(t => t.position === thought.position)
			if (index === -1) thoughts.push(thought)
			else thoughts[index] = thought
			return { ...message, thoughts }
		}
		case 'message_file':
			return {
				...message,
				files: [
					...(message.files ?? []),
					{ id: String(event.id), type: String(event.type ?? 'custom'), url: String(event.url ?? ''), belongsTo: event.belongs_to === 'user' ? 'user' : 'assistant' },
				],
			}
		case 'message_end': {
			const metadata = (event.metadata ?? {}) as { retriever_resources?: IRetrieverResource[] }
			return metadata.retriever_resources?.length ? { ...message, citations: metadata.retriever_resources } : message
		}
		case 'workflow_started': {
			const workflow = workflowOf(message)
			const resumption = data.reason === 'resumption'
			return { ...message, workflow: { runId: event.workflow_run_id ?? String(data.id ?? workflow.runId ?? ''), status: 'running', nodes: resumption ? workflow.nodes : [] } }
		}
		case 'node_started':
			return { ...message, workflow: updateNode(workflowOf(message), data as NodeData, node => ({ ...node, status: node.status === 'retrying' ? 'retrying' : 'running' })) }
		case 'node_finished': {
			const d = data as NodeData
			return {
				...message,
				workflow: updateNode(workflowOf(message), d, node => ({
					...node,
					status: d.status === 'succeeded' ? 'success' : 'error',
					inputs: d.inputs ?? null,
					outputs: d.outputs ?? null,
					processData: d.process_data ?? null,
					elapsedTime: d.elapsed_time,
					totalTokens: d.execution_metadata?.total_tokens,
					error: d.error ?? null,
				})),
			}
		}
		case 'node_retry': {
			const d = data as NodeData
			return { ...message, workflow: updateNode(workflowOf(message), d, node => ({ ...node, status: 'retrying', retries: d.retry_index ?? (node.retries ?? 0) + 1, error: d.error ?? null })) }
		}
		case 'workflow_finished':
			return { ...message, workflow: { ...workflowOf(message), status: data.error ? 'failed' : 'finished' } }
		case 'workflow_paused':
			return { ...message, workflow: { ...workflowOf(message), status: 'paused' } }
		case 'human_input_required':
			return {
				...message,
				humanInput: {
					state: 'pending',
					formToken: String(data.form_token ?? ''),
					formContent: String(data.form_content ?? ''),
					inputs: (data.inputs as HumanInputField[]) ?? [],
					actions: (data.actions as HumanInputAction[]) ?? [],
					defaults: (data.resolved_default_values as Record<string, string>) ?? {},
					expiresAt: Number(data.expiration_time ?? 0),
					workflowRunId: event.workflow_run_id ?? '',
					nodeId: data.node_id as string | undefined,
				},
			}
		case 'human_input_form_filled':
			return message.humanInput
				? { ...message, humanInput: { ...message.humanInput, state: 'filled', renderedContent: data.rendered_content as string | undefined, actionText: data.action_text as string | undefined } }
				: message
		case 'human_input_form_timeout':
			return message.humanInput ? { ...message, humanInput: { ...message.humanInput, state: 'expired' } } : message
		case 'error':
			return { ...message, error: { code: event.code as string | undefined, message: String(event.message ?? 'error'), status: event.status as number | undefined } }
		default:
			// ping, tts_message*, agent_log, iteration_*, loop_*, text_chunk: nothing to show in a chat bubble.
			return message
	}
}

export interface DifyChatProviderOptions {
	request: ChatProviderConfig<DifyChatInput, SSEOutput, DifyChatMessage>['request']
	/** The server conversation id of this provider's conversation, if it has one yet (spec §4.3). */
	getDifyConversationId: () => string | undefined
	/** Called after every workflow event so the hook can persist node data (GET /messages has none). */
	onWorkflowUpdate?: (message: DifyChatMessage) => void
}

// ADR-0017: the one Dify provider; only the three AbstractChatProvider transforms — docs/decisions/0017-build-the-chat-on-ant-design-x.md
export class DifyChatProvider extends AbstractChatProvider<DifyChatMessage, DifyChatInput, SSEOutput> {
	private resumeBase: DifyChatMessage | null = null
	private readonly getDifyConversationId: () => string | undefined
	private readonly onWorkflowUpdate?: (message: DifyChatMessage) => void

	constructor({ request, getDifyConversationId, onWorkflowUpdate }: DifyChatProviderOptions) {
		super({ request })
		this.getDifyConversationId = getDifyConversationId
		this.onWorkflowUpdate = onWorkflowUpdate
	}

	transformParams(requestParams: Partial<DifyChatInput>, options: XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>): DifyChatInput {
		const base = { ...(options?.params ?? {}) } as Partial<DifyChatInput>
		if (requestParams.resume) {
			// The SDK passes no originMessage on a reload's first chunk; keep the paused message to extend it.
			this.resumeBase = requestParams.resume.message
			return { ...base, query: '', inputs: {}, files: [], response_mode: 'streaming', resume: requestParams.resume } as DifyChatInput
		}
		this.resumeBase = null
		return {
			...base,
			query: requestParams.query ?? '',
			inputs: requestParams.inputs ?? {},
			files: requestParams.files ?? [],
			response_mode: 'streaming',
			conversation_id: this.getDifyConversationId() ?? '',
		} as DifyChatInput
	}

	transformLocalMessage(requestParams: Partial<DifyChatInput>): DifyChatMessage | DifyChatMessage[] {
		if (requestParams.resume) return []
		return {
			role: 'user',
			content: requestParams.query ?? '',
			files: (requestParams.files ?? []).map((file, index) => ({
				id: ('upload_file_id' in file && file.upload_file_id) || `local-${index}`,
				type: file.type,
				url: ('url' in file && file.url) || '',
				belongsTo: 'user' as const,
				uploadFileId: 'upload_file_id' in file ? file.upload_file_id : undefined,
			})),
			inputs: requestParams.inputs,
			ids: {},
		}
	}

	transformMessage(info: TransformMessage<DifyChatMessage, SSEOutput>): DifyChatMessage {
		const origin = info.originMessage ?? this.resumeBase ?? emptyAssistant()
		const data = info.chunk?.data
		if (typeof data !== 'string' || !data || data.includes('[DONE]')) return origin
		let event: DifyStreamEvent
		try {
			event = JSON.parse(data) as DifyStreamEvent
		} catch {
			return origin
		}
		const next = applyEvent(origin, event)
		if (WORKFLOW_EVENTS.has(event.event)) this.onWorkflowUpdate?.(next)
		return next
	}
}
```

Move the workflow store: `git mv hooks/useX/workflow-data-storage.ts components/chat/persistence/workflow-data-storage.ts`; update the import lines in `hooks/useX/x-provider.ts`, `components/chat/chatbox-wrapper.tsx` and `__tests__/x-provider-conversation-id.test.ts` (`vi.mock('@/components/chat/persistence/workflow-data-storage', …)`).

- [ ] **Step 8: Run the tests, tsc and lint**

Run: `pnpm exec vitest run __tests__/dify-chat-provider.test.ts __tests__/dify-fetch.test.ts __tests__/chat-keys.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat/provider components/chat/persistence`
Expected: PASS; tsc clean (if `AbstractChatProvider`'s constructor type rejects the `{ request }` object, pass `config` through as `super(config as ChatProviderConfig<…>)` and note it).

- [ ] **Step 9: Commit**

```bash
pnpm exec oxfmt --write components/chat/provider components/chat/persistence __tests__/chat-keys.test.ts __tests__/dify-fetch.test.ts __tests__/dify-chat-provider.test.ts hooks/useX/x-provider.ts components/chat/chatbox-wrapper.tsx __tests__/x-provider-conversation-id.test.ts
git add components/chat/provider components/chat/persistence hooks/useX components/chat/chatbox-wrapper.tsx __tests__/chat-keys.test.ts __tests__/dify-fetch.test.ts __tests__/dify-chat-provider.test.ts __tests__/x-provider-conversation-id.test.ts
git commit -m "feat(chat): DifyChatProvider, message model, conversation keys and the Dify fetch router" -m "One AbstractChatProvider with the three documented transforms. applyEvent() folds every event of Dify's ChunkChatEvent union into a typed DifyChatMessage (answer, reasoning, agent thoughts, workflow nodes incl. retry and resumption, files, citations, human input states, errors, ids and created_at). The XRequest fetch option routes HITL resumes to the workflow events proxy and turns non-OK proxy answers into DifyRequestError. Keys are app-prefixed; new chats keep a temporary key (spec §4.3)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 7: History mapper and conversation list mapping

**Spec:** §4.1 (history), §4.4 (conversation items, groups, merge by Dify id).

**Files:**
- Create: `components/chat/provider/history.ts`, `components/chat/provider/conversations.ts`, `__tests__/chat-history.test.ts`, `__tests__/chat-conversations.test.ts`

**Interfaces:**
- Produces: `HistoryMessage` (Dify `GET /messages` item), `mapHistoryPage(items, ctx): Promise<DefaultMessageInfo<DifyChatMessage>[]>` with `ctx = { loadWorkflow: (messageId: string) => Promise<WorkflowState | undefined> }`; `historyIds(messageId)` → `{ user: '<id>:q', assistant: '<id>:a' }`.
- `ConversationItem` (`key`, `label`, `difyId?`, `updatedAt`, `inputs`, `group`), `ConversationGroup = 'today' | 'yesterday' | 'week' | 'older'`, `groupFor(updatedAtSeconds, nowMs)`, `toConversationItem(appId, dify, nowMs)`, `mergeServerList(current, server)`.

- [ ] **Step 1: Write the failing tests**

`__tests__/chat-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { historyIds, mapHistoryPage, type HistoryMessage } from '@/components/chat/provider/history'

const item = (overrides: Partial<HistoryMessage> = {}): HistoryMessage => ({
	id: 'm1',
	conversation_id: 'c1',
	inputs: { topic: 'tea' },
	query: 'How is tea brewed?',
	answer: 'At 80 °C.',
	message_files: [],
	feedback: null,
	status: 'normal',
	error: null,
	agent_thoughts: [],
	retriever_resources: [],
	created_at: 1_700_000_000,
	...overrides,
})
const ctx = { loadWorkflow: async () => undefined }

describe('mapHistoryPage', () => {
	it('turns one Dify message into a user and an assistant message, oldest first', async () => {
		const page = await mapHistoryPage([item({ id: 'm2', created_at: 1_700_000_100 }), item({ id: 'm1' })], ctx)
		expect(page.map(m => m.id)).toEqual(['m1:q', 'm1:a', 'm2:q', 'm2:a'])
		expect(page[0]).toMatchObject({ status: 'success', message: { role: 'user', content: 'How is tea brewed?', inputs: { topic: 'tea' }, ids: { messageId: 'm1', conversationId: 'c1' } } })
		expect(page[1]).toMatchObject({ status: 'success', message: { role: 'assistant', content: 'At 80 °C.', createdAt: 1_700_000_000 } })
	})
	it('splits files by owner and keeps feedback, thoughts and citations', async () => {
		const [user, assistant] = await mapHistoryPage(
			[item({ feedback: { rating: 'like' }, message_files: [{ id: 'f1', filename: 'a.png', type: 'image', url: '/a.png', mime_type: 'image/png', size: 1, transfer_method: 'local_file', belongs_to: 'user', upload_file_id: 'u1' }, { id: 'f2', filename: 'b.png', type: 'image', url: '/b.png', mime_type: 'image/png', size: 1, transfer_method: 'remote_url', belongs_to: 'assistant' }], agent_thoughts: [{ id: 't1', position: 1 } as never], retriever_resources: [{ id: 'rr1' } as never] })],
			ctx,
		)
		expect(user.message.files?.map(f => f.id)).toEqual(['f1'])
		expect(assistant.message.files?.map(f => f.id)).toEqual(['f2'])
		expect(assistant.message).toMatchObject({ feedback: 'like', thoughts: [{ id: 't1' }], citations: [{ id: 'rr1' }] })
	})
	// Review Focus 3: a failed history turn is an error bubble, never the "empty answer" state.
	it('maps an errored message to an error on the assistant bubble and keeps the user turn', async () => {
		const [user, assistant] = await mapHistoryPage([item({ answer: '', status: 'error', error: 'Rate limited' })], ctx)
		expect(user.message.content).toBe('How is tea brewed?')
		expect(assistant.message.error).toEqual({ message: 'Rate limited' })
	})
	it('attaches persisted workflow nodes to the assistant message', async () => {
		const workflow = { status: 'finished' as const, nodes: [{ id: 'n1', nodeId: 'a', type: 'llm', title: 'Answer', status: 'success' as const }] }
		const [, assistant] = await mapHistoryPage([item()], { loadWorkflow: async id => (id === 'm1' ? workflow : undefined) })
		expect(assistant.message.workflow).toEqual(workflow)
	})
	it('derives stable ids', () => {
		expect(historyIds('m9')).toEqual({ user: 'm9:q', assistant: 'm9:a' })
	})
})
```

`__tests__/chat-conversations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { groupFor, mergeServerList, toConversationItem, type ConversationItem } from '@/components/chat/provider/conversations'

const APP = 'app-1'
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0) // 2026-10-04 12:00 UTC
const seconds = (date: number) => Math.floor(date / 1000)

describe('groupFor', () => {
	it('buckets by calendar distance from today', () => {
		expect(groupFor(seconds(NOW - 3600_000), NOW)).toBe('today')
		expect(groupFor(seconds(Date.UTC(2026, 9, 3, 23, 0, 0)), NOW)).toBe('yesterday')
		expect(groupFor(seconds(Date.UTC(2026, 9, 1, 9, 0, 0)), NOW)).toBe('week')
		expect(groupFor(seconds(Date.UTC(2026, 8, 1, 9, 0, 0)), NOW)).toBe('older')
	})
})

describe('toConversationItem', () => {
	it('keys the item by app and Dify id and carries name, inputs and group', () => {
		const item = toConversationItem(APP, { id: 'c1', name: 'Tea', created_at: seconds(NOW) - 10, updated_at: seconds(NOW) - 5, inputs: { topic: 'tea' }, introduction: '', status: 'normal' }, NOW)
		expect(item).toEqual({ key: `${APP}:c1`, label: 'Tea', difyId: 'c1', updatedAt: seconds(NOW) - 5, inputs: { topic: 'tea' }, group: 'today' })
	})
})

describe('mergeServerList', () => {
	const temp: ConversationItem = { key: `${APP}:temp:1`, label: 'New conversation', updatedAt: seconds(NOW), inputs: {}, group: 'today' }
	const sentTemp: ConversationItem = { ...temp, key: `${APP}:temp:2`, difyId: 'c9' }
	const server = (id: string, label: string): ConversationItem => ({ key: `${APP}:${id}`, label, difyId: id, updatedAt: seconds(NOW) - 1, inputs: {}, group: 'today' })

	it('keeps an unsent temporary conversation at the top', () => {
		expect(mergeServerList([temp], [server('c1', 'One')]).map(c => c.key)).toEqual([temp.key, `${APP}:c1`])
	})
	it('keeps the client key of a conversation the server now knows and takes the server label', () => {
		const merged = mergeServerList([sentTemp], [server('c9', 'Server name'), server('c1', 'One')])
		expect(merged.map(c => c.key)).toEqual([`${APP}:temp:2`, `${APP}:c1`])
		expect(merged[0]).toMatchObject({ difyId: 'c9', label: 'Server name' })
	})
	it('drops client items the server no longer has', () => {
		expect(mergeServerList([server('gone', 'Gone')], [server('c1', 'One')]).map(c => c.difyId)).toEqual(['c1'])
	})
})
```

Run: `pnpm exec vitest run __tests__/chat-history.test.ts __tests__/chat-conversations.test.ts` → FAIL (modules missing).

- [ ] **Step 2: Implement `history.ts`**

```ts
import type { DefaultMessageInfo } from '@ant-design/x-sdk'

import type { IAgentThought, IMessageFileItem, IRetrieverResource } from '@/lib/api'

import type { DifyChatMessage, MessageFile, WorkflowState } from './message'

/** One item of Dify's GET /messages (openapi_service.json → getConversationHistory). */
export interface HistoryMessage {
	id: string
	conversation_id: string
	inputs: Record<string, unknown>
	query: string
	answer: string
	message_files?: IMessageFileItem[]
	feedback?: { rating: 'like' | 'dislike' } | null
	status: 'normal' | 'error'
	error: string | null
	agent_thoughts?: IAgentThought[]
	retriever_resources?: IRetrieverResource[]
	created_at: number
}

export interface HistoryContext {
	/** Workflow nodes are not part of GET /messages; they come from the IndexedDB store (spec §4.10). */
	loadWorkflow: (messageId: string) => Promise<WorkflowState | undefined>
}

export const historyIds = (messageId: string) => ({ user: `${messageId}:q`, assistant: `${messageId}:a` })

const toFile = (file: IMessageFileItem): MessageFile => ({
	id: file.id,
	type: file.type,
	url: file.url,
	belongsTo: file.belongs_to === 'user' ? 'user' : 'assistant',
	filename: file.filename,
	size: file.size,
	mimeType: file.mime_type,
	uploadFileId: file.upload_file_id,
})

/**
 * Dify returns history newest first; useXChat's defaultMessages wants oldest first, two bubbles per
 * Dify message, each already `success` (DefaultMessageInfo, use-x-chat skill "Async Default Messages").
 */
export const mapHistoryPage = async (items: HistoryMessage[], ctx: HistoryContext): Promise<DefaultMessageInfo<DifyChatMessage>[]> => {
	const ordered = [...items].sort((a, b) => a.created_at - b.created_at)
	const result: DefaultMessageInfo<DifyChatMessage>[] = []
	for (const item of ordered) {
		const ids = historyIds(item.id)
		const files = (item.message_files ?? []).map(toFile)
		const common = { ids: { messageId: item.id, conversationId: item.conversation_id }, createdAt: item.created_at }
		result.push({
			id: ids.user,
			status: 'success',
			message: { role: 'user', content: item.query, inputs: item.inputs, files: files.filter(f => f.belongsTo === 'user'), ...common },
		})
		result.push({
			id: ids.assistant,
			status: 'success',
			message: {
				role: 'assistant',
				content: item.answer,
				files: files.filter(f => f.belongsTo === 'assistant'),
				feedback: item.feedback?.rating ?? null,
				thoughts: item.agent_thoughts ?? [],
				citations: item.retriever_resources ?? [],
				workflow: await ctx.loadWorkflow(item.id),
				error: item.status === 'error' ? { message: item.error ?? 'error' } : undefined,
				...common,
			},
		})
	}
	return result
}
```

- [ ] **Step 3: Implement `conversations.ts`**

```ts
import type { ConversationData } from '@ant-design/x-sdk'

import type { IConversationItem } from '@/lib/api'

import { conversationKeyFor, parseConversationKey } from './keys'

export type ConversationGroup = 'today' | 'yesterday' | 'week' | 'older'

/** A sidebar item: a client key plus the Dify id once the server has one (spec §4.4). */
export interface ConversationItem extends ConversationData {
	key: string
	label: string
	difyId?: string
	/** unix seconds */
	updatedAt: number
	inputs: Record<string, unknown>
	group: ConversationGroup
}

const DAY_MS = 24 * 60 * 60 * 1000
const startOfDay = (ms: number) => {
	const d = new Date(ms)
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export const groupFor = (updatedAtSeconds: number, nowMs: number): ConversationGroup => {
	const days = Math.floor((startOfDay(nowMs) - startOfDay(updatedAtSeconds * 1000)) / DAY_MS)
	if (days <= 0) return 'today'
	if (days === 1) return 'yesterday'
	if (days < 7) return 'week'
	return 'older'
}

export const toConversationItem = (appId: string, dify: IConversationItem, nowMs: number): ConversationItem => ({
	key: conversationKeyFor(appId, dify.id),
	label: dify.name,
	difyId: dify.id,
	updatedAt: dify.updated_at,
	inputs: dify.inputs ?? {},
	group: groupFor(dify.updated_at, nowMs),
})

/**
 * Refresh from the server without changing client keys: a temporary conversation that already has
 * its Dify id keeps its key (the x-sdk store is bound to it) and takes the server's name; unsent
 * temporaries stay on top; conversations the server dropped disappear.
 */
export const mergeServerList = (current: ConversationItem[], server: ConversationItem[]): ConversationItem[] => {
	const unsentTemps = current.filter(c => parseConversationKey(c.key).temp && !c.difyId)
	const byDifyId = new Map(current.filter(c => c.difyId).map(c => [c.difyId!, c]))
	const merged = server.map(item => {
		const known = byDifyId.get(item.difyId!)
		return known ? { ...item, key: known.key } : item
	})
	return [...unsentTemps, ...merged]
}
```

`IConversationItem` comes from `@/lib/api` (`lib/api/client.ts` exports it with `id`, `name`, `inputs`, `created_at`, `updated_at`); if `lib/api/index.ts` does not re-export it, import from `@/lib/api/client`.

- [ ] **Step 4: Run tests, tsc, lint; commit**

Run: `pnpm exec vitest run __tests__/chat-history.test.ts __tests__/chat-conversations.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat/provider`
Expected: PASS, clean.

```bash
pnpm exec oxfmt --write components/chat/provider __tests__/chat-history.test.ts __tests__/chat-conversations.test.ts
git add components/chat/provider __tests__/chat-history.test.ts __tests__/chat-conversations.test.ts
git commit -m "feat(chat): map Dify history to default messages and conversations to keyed sidebar items" -m "GET /messages pages (newest first) become oldest-first user/assistant DefaultMessageInfo pairs with files split by owner, feedback, thoughts, citations, persisted workflow nodes and error state. Conversation items carry a client key, the Dify id and a date group; mergeServerList keeps client keys across refreshes." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 8: The x-sdk wiring — provider cache, `useDifyChat`, `useConversations`, bubble items

**Spec:** §4.3, §4.4, §4.5 (requestFallback), §4.7 (load earlier, suggestions hook later).

**Files:**
- Create: `components/chat/provider/provider-cache.ts`, `components/chat/hooks/bubble-items.ts`, `components/chat/hooks/use-dify-chat.ts`, `components/chat/hooks/use-conversations.ts`, `__tests__/chat-provider-cache.test.ts`, `__tests__/chat-bubble-items.test.ts`

**Interfaces:**
- Produces:
  - `getProvider(key: string, create: () => DifyChatProvider): DifyChatProvider`, `clearProviders()`.
  - `toBubbleItems(messages: MessageInfo<DifyChatMessage>[]): BubbleItemType[]` — `key: id`, `role: message.role`, `content: message` (the whole object; `contentRender` renders it), `loading: status === 'loading'`, `streaming: status === 'updating'`, `status`.
  - `useDifyChat({ appId, conversationKey, getDifyConversationId, difyApi, t })` → `{ messages, isRequesting, isDefaultMessagesRequesting, send(params: SendParams), abort, stop(): Promise<void>, resume(assistantId, workflowRunId, message), loadEarlier(): Promise<void>, hasMore, setMessage, setMessages }` where `SendParams = { query: string; inputs: Record<string, unknown>; files: IFile[] }`.
  - `useConversations({ appId, difyApi, startNew })` → `{ conversations, activeKey, setActiveKey, loading, createTemp(): string, markDifyId(key, difyId), rename(key, name), remove(key), refresh(), getDifyId(key), hasEmptyTemp }`.
- Consumes: Task 6 and 7 modules; `DifyApi` from `@/lib/dify-client`; `useXChat`, `useXConversations`, `XRequest` from `@ant-design/x-sdk`; `workflowDataStorage` from `components/chat/persistence/workflow-data-storage`.

- [ ] **Step 1: Write the failing tests for the pure parts**

`__tests__/chat-provider-cache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearProviders, getProvider } from '@/components/chat/provider/provider-cache'

// Review Focus 4: a stream stays bound to the provider (and so the store) of the conversation it started in.
describe('provider cache', () => {
	beforeEach(() => clearProviders())

	it('returns the same instance for the same key and a different one per key', () => {
		const create = vi.fn(() => ({ marker: Math.random() }) as never)
		const a1 = getProvider('app:a', create)
		const a2 = getProvider('app:a', create)
		const b = getProvider('app:b', create)
		expect(a1).toBe(a2)
		expect(a1).not.toBe(b)
		expect(create).toHaveBeenCalledTimes(2)
	})
})
```

`__tests__/chat-bubble-items.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { toBubbleItems } from '@/components/chat/hooks/bubble-items'
import { emptyAssistant } from '@/components/chat/provider/message'

describe('toBubbleItems', () => {
	it('maps SDK message infos to Bubble.List items with streaming and loading flags', () => {
		const items = toBubbleItems([
			{ id: 'u1', status: 'local', message: { role: 'user', content: 'hi', ids: {} } },
			{ id: 'a1', status: 'loading', message: emptyAssistant() },
			{ id: 'a2', status: 'updating', message: { ...emptyAssistant(), content: 'He' } },
			{ id: 'a3', status: 'success', message: { ...emptyAssistant(), content: 'Hello' } },
		])
		expect(items.map(i => [i.key, i.role, i.loading, i.streaming])).toEqual([
			['u1', 'user', false, false],
			['a1', 'assistant', true, false],
			['a2', 'assistant', false, true],
			['a3', 'assistant', false, false],
		])
		expect(items[3].content).toMatchObject({ content: 'Hello' })
	})
})
```

Run: `pnpm exec vitest run __tests__/chat-provider-cache.test.ts __tests__/chat-bubble-items.test.ts` → FAIL.

- [ ] **Step 2: Implement the pure parts**

`components/chat/provider/provider-cache.ts`:

```ts
import type { DifyChatProvider } from './dify-chat-provider'

/** One provider per conversation key (use-x-chat skill: "each conversation must have its own Provider instance"). */
const providers = new Map<string, DifyChatProvider>()

export const getProvider = (key: string, create: () => DifyChatProvider): DifyChatProvider => {
	let provider = providers.get(key)
	if (!provider) {
		provider = create()
		providers.set(key, provider)
	}
	return provider
}

export const clearProviders = () => providers.clear()
```

`components/chat/hooks/bubble-items.ts`:

```ts
import type { BubbleItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'

import type { DifyChatMessage } from '../provider/message'

/** x-components Pattern 3: streaming only while updating, loading only for the placeholder. */
export const toBubbleItems = (messages: MessageInfo<DifyChatMessage>[]): BubbleItemType[] =>
	messages.map(({ id, message, status }) => ({
		key: id,
		role: message.role,
		content: message,
		loading: status === 'loading',
		streaming: status === 'updating',
		status,
	}))
```

Run the two tests → PASS.

- [ ] **Step 3: Implement `useDifyChat`**

`components/chat/hooks/use-dify-chat.ts`:

```ts
'use client'

import { useXChat, XRequest, type SSEOutput } from '@ant-design/x-sdk'
import type { TFunction } from 'i18next'
import { useCallback, useRef } from 'react'

import type { IFile } from '@/lib/api'
import type { DifyApi } from '@/lib/dify-client'

import workflowDataStorage from '../persistence/workflow-data-storage'
import { DifyChatProvider } from '../provider/dify-chat-provider'
import { createDifyFetch, DifyRequestError } from '../provider/dify-fetch'
import { mapHistoryPage, type HistoryMessage } from '../provider/history'
import { parseConversationKey } from '../provider/keys'
import { emptyAssistant, type DifyChatInput, type DifyChatMessage, type WorkflowState } from '../provider/message'
import { getProvider } from '../provider/provider-cache'

export const HISTORY_PAGE = 20

export interface SendParams {
	query: string
	inputs: Record<string, unknown>
	files: IFile[]
}

interface Options {
	appId: string
	conversationKey: string
	getDifyConversationId: () => string | undefined
	difyApi: DifyApi
	t: TFunction
}

const toMessageError = (error: Error, t: TFunction) =>
	error instanceof DifyRequestError
		? { code: error.code, message: error.message, status: error.status }
		: { message: t('common.request_failed_retry') }

/**
 * useXChat for one Dify conversation (spec §4.3): the key is the client conversation key, the
 * history is the SDK's async defaultMessages, a send during that load is queued (queueRequest),
 * and the per-key provider keeps a stream bound to the conversation it started in.
 */
export const useDifyChat = ({ appId, conversationKey, getDifyConversationId, difyApi, t }: Options) => {
	const paging = useRef<{ hasMore: boolean; oldestId?: string }>({ hasMore: false })
	const getDifyIdRef = useRef(getDifyConversationId)
	getDifyIdRef.current = getDifyConversationId

	const provider = getProvider(
		conversationKey,
		() =>
			new DifyChatProvider({
				request: XRequest<DifyChatInput, SSEOutput, DifyChatMessage>(`/api/client/dify/${appId}/chat-messages`, {
					manual: true,
					fetch: createDifyFetch(appId),
					params: { response_mode: 'streaming' },
				}),
				getDifyConversationId: () => getDifyIdRef.current(),
				onWorkflowUpdate: message => {
					if (message.ids.conversationId && message.ids.messageId && message.workflow) {
						void workflowDataStorage.set({ appId, conversationId: message.ids.conversationId, messageId: message.ids.messageId, key: 'workflows', value: message.workflow })
					}
				},
			}),
	)

	const loadWorkflow = useCallback(
		async (difyConversationId: string, messageId: string) =>
			(await workflowDataStorage.get({ appId, conversationId: difyConversationId, messageId, key: 'workflows' })) as WorkflowState | undefined,
		[appId],
	)

	const chat = useXChat<DifyChatMessage, DifyChatMessage, DifyChatInput, SSEOutput>({
		provider,
		conversationKey,
		defaultMessages: async ({ conversationKey: key }) => {
			const parsed = parseConversationKey(key ?? conversationKey)
			if (parsed.temp || !parsed.difyId) return []
			const page = await difyApi.listMessages(parsed.difyId, { limit: HISTORY_PAGE })
			const items = (page?.data ?? []) as HistoryMessage[]
			paging.current = { hasMore: Boolean(page?.has_more), oldestId: items.at(-1)?.id }
			return mapHistoryPage(items, { loadWorkflow: id => loadWorkflow(parsed.difyId!, id) })
		},
		// A resume keeps the paused message visible while the continuation connects (spec §4.6).
		requestPlaceholder: params => (params.resume ? params.resume.message : emptyAssistant()),
		requestFallback: (_params, { error, messageInfo }) => {
			if (error.name === 'AbortError') return { ...(messageInfo?.message ?? emptyAssistant()), aborted: true }
			return { ...emptyAssistant(), error: toMessageError(error, t) }
		},
	})

	const send = useCallback(
		(params: SendParams) => {
			const request: Partial<DifyChatInput> = { query: params.query, inputs: params.inputs, files: params.files }
			if (chat.isDefaultMessagesRequesting) chat.queueRequest(conversationKey, request)
			else chat.onRequest(request)
		},
		[chat, conversationKey],
	)

	/** Abort the stream and tell Dify to stop the task (spec §4.5). */
	const stop = useCallback(async () => {
		const last = [...chat.messages].reverse().find(m => m.message.role === 'assistant')
		chat.abort()
		const taskId = last?.message.ids.taskId
		if (taskId) await difyApi.stopTask(taskId).catch(() => undefined)
	}, [chat, difyApi])

	const resume = useCallback(
		(assistantId: string | number, workflowRunId: string, message: DifyChatMessage) =>
			chat.onReload(assistantId, { resume: { workflowRunId, message } }),
		[chat],
	)

	const loadEarlier = useCallback(async () => {
		const parsed = parseConversationKey(conversationKey)
		if (!parsed.difyId || !paging.current.hasMore) return
		const page = await difyApi.listMessages(parsed.difyId, { first_id: paging.current.oldestId, limit: HISTORY_PAGE })
		const items = (page?.data ?? []) as HistoryMessage[]
		paging.current = { hasMore: Boolean(page?.has_more), oldestId: items.at(-1)?.id ?? paging.current.oldestId }
		const older = await mapHistoryPage(items, { loadWorkflow: id => loadWorkflow(parsed.difyId!, id) })
		chat.setMessages(prev => [...older.map((m, i) => ({ id: m.id ?? `older_${i}`, status: 'success' as const, ...m })), ...prev])
	}, [chat, conversationKey, difyApi, loadWorkflow])

	return {
		messages: chat.messages,
		isRequesting: chat.isRequesting,
		isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
		setMessage: chat.setMessage,
		setMessages: chat.setMessages,
		abort: chat.abort,
		send,
		stop,
		resume,
		loadEarlier,
		get hasMore() {
			return paging.current.hasMore
		},
	}
}
```

Notes for the implementer: `useXChat`'s `defaultMessages` runs when the SDK first creates the store for a key and never again for that key (read in `x-sdk/es/x-chat/store.js`), which is the caching the spec relies on; `setMessages` accepts an updater function (`index.d.ts`). `difyApi.listMessages` is the `@ts-nocheck` client in `lib/dify-client.ts`; its return is typed loosely, hence the casts.

- [ ] **Step 4: Implement `useConversations`**

`components/chat/hooks/use-conversations.ts`:

```ts
'use client'

import { useXConversations } from '@ant-design/x-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IConversationItem } from '@/lib/api'
import type { DifyApi } from '@/lib/dify-client'

import { mergeServerList, toConversationItem, type ConversationItem } from '../provider/conversations'
import { newTempConversationKey, parseConversationKey } from '../provider/keys'

interface Options {
	appId: string
	difyApi: DifyApi
	/** `?isNewCvst=1`: start on a new conversation instead of the latest one. */
	startNew?: boolean
}

/** The sidebar list and the active key on useXConversations (x-sdk), fed from Dify's /conversations (spec §4.4). */
export const useConversations = ({ appId, difyApi, startNew = false }: Options) => {
	const { t } = useTranslation()
	const store = useXConversations({ defaultConversations: [], defaultActiveConversationKey: '' })
	const conversations = store.conversations as ConversationItem[]
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const conversationsRef = useRef(conversations)
	conversationsRef.current = conversations

	const createTemp = useCallback(() => {
		const key = newTempConversationKey(appId)
		const item: ConversationItem = { key, label: t('chat.default_conversation_name'), updatedAt: Math.floor(Date.now() / 1000), inputs: {}, group: 'today' }
		store.addConversation(item, 'prepend')
		store.setActiveConversationKey(key)
		return key
	}, [appId, store, t])

	const refresh = useCallback(async () => {
		const result = (await difyApi.listConversations({ limit: 100, sort_by: '-updated_at' })) as { data: IConversationItem[] }
		const now = Date.now()
		const server = (result?.data ?? []).map(item => toConversationItem(appId, item, now))
		const merged = mergeServerList(conversationsRef.current, server)
		store.setConversations(merged)
		return merged
	}, [appId, difyApi, store])

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		refresh()
			.then(items => {
				if (cancelled) return
				if (startNew || items.length === 0) createTemp()
				else store.setActiveConversationKey(items[0].key)
			})
			.catch(e => !cancelled && setError(e as Error))
			.finally(() => !cancelled && setLoading(false))
		return () => {
			cancelled = true
		}
		// The list is loaded once per app; refresh() is called explicitly afterwards.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [appId])

	const getDifyId = useCallback((key: string) => (store.getConversation(key) as ConversationItem | undefined)?.difyId, [store])

	const markDifyId = useCallback((key: string, difyId: string) => store.setConversation(key, { difyId } as Partial<ConversationItem>), [store])

	const rename = useCallback(
		async (key: string, name: string) => {
			const difyId = getDifyId(key)
			if (difyId) await difyApi.renameConversation({ conversation_id: difyId, name })
			store.setConversation(key, { label: name } as Partial<ConversationItem>)
		},
		[difyApi, getDifyId, store],
	)

	const remove = useCallback(
		async (key: string) => {
			const difyId = getDifyId(key)
			if (difyId) await difyApi.deleteConversation(difyId)
			store.removeConversation(key)
			if (store.activeConversationKey === key) {
				const rest = conversationsRef.current.filter(c => c.key !== key)
				if (rest.length) store.setActiveConversationKey(rest[0].key)
				else createTemp()
			}
		},
		[createTemp, difyApi, getDifyId, store],
	)

	const hasEmptyTemp = conversations.some(c => parseConversationKey(c.key).temp && !c.difyId)

	return {
		conversations,
		activeKey: store.activeConversationKey,
		setActiveKey: store.setActiveConversationKey,
		loading,
		error,
		createTemp,
		markDifyId,
		rename,
		remove,
		refresh,
		getDifyId,
		hasEmptyTemp,
	}
}
```

- [ ] **Step 5: Type-check, lint, unit tests; commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat/hooks components/chat/provider && pnpm test`
Expected: clean and green. (`useXConversations` returns `setActiveConversationKey: (key) => boolean`; the hook exposes it as is.)

```bash
pnpm exec oxfmt --write components/chat/hooks components/chat/provider __tests__/chat-provider-cache.test.ts __tests__/chat-bubble-items.test.ts
git add components/chat/hooks components/chat/provider __tests__/chat-provider-cache.test.ts __tests__/chat-bubble-items.test.ts
git commit -m "feat(chat): useDifyChat and useConversations on the x-sdk hooks" -m "useXChat with the client conversation key, async defaultMessages (history page mapped oldest first), queueRequest while the history loads, a resume placeholder for HITL continuations, requestFallback for Dify and abort errors, load-earlier paging and stop (abort + Dify stop task). useXConversations holds the sidebar list; refresh merges the server list without changing client keys." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---
### Task 9: App context, workspace, routes and the chat view skeleton; the race fixed, the stub reset retired

**Spec:** §3.5, §4.9, §5.1, §5.2 (list, sender, load earlier), §8.1 (reset removal), §2 "Late-history race".

**Files:**
- Create: `components/chat/app-context.tsx`, `components/chat/chat-workspace.tsx`, `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/chat-view.module.css`, `components/chat/chat-view/conversation-sidebar.tsx`, `components/chat/chat-view/conversation-drawer.tsx`, `components/chat/chat-view/message-list.tsx`, `components/chat/chat-view/chat-sender.tsx`, `components/chat/chat-view/width-toggle.tsx`, `e2e/chat.spec.ts`, `e2e/chat-race.spec.ts`
- Modify: `app/(user)/chat/[appId]/page.tsx`, `app/(user)/chat/page.tsx`, `e2e/smoke.spec.ts`, `e2e/fixtures/stub/router.ts`, `e2e/fixtures/stub/store.ts`, `locales/{en,zh,ar}/translation.json`

**Interfaces:**
- Produces: `AppContext` / `useAppContext(): { app: IDifyAppItem; parameters: IDifyAppParameters; site: IDifyAppSiteSetting; difyApi: DifyApi; userId: string }`; `ChatWorkspace({ appId })`; `ChatView()`; `MessageList({ chat, conversationKey, renderAssistant?, renderFooter? })`; `ChatSender({ onSend, onStop, loading, disabled, senderRef })`; `ConversationSidebar({ … })`; `ConversationDrawer({ open, onClose, children })`; `WidthToggle({ wide, onChange })`.
- Later tasks plug into `MessageList`'s `renderAssistant(message, info)` (Task 12) and `renderFooter(message, info)` (Task 14) slots and extend `ChatSender` (Task 15) and the drawer (Task 16).
- Non-chat modes keep rendering the old `ChatLayoutWrapper` until Task 17 replaces it.

- [ ] **Step 1: New i18n keys (all three files)**

Add under `chat`:

| key | en | zh | ar |
| --- | --- | --- | --- |
| `group_today` | Today | 今天 | اليوم |
| `group_yesterday` | Yesterday | 昨天 | أمس |
| `group_week` | Last 7 days | 最近 7 天 | آخر 7 أيام |
| `group_older` | Older | 更早 | أقدم |
| `load_earlier` | Load earlier messages | 加载更早的消息 | تحميل الرسائل السابقة |
| `stopped` | Stopped | 已停止 | تم الإيقاف |
| `send_placeholder` | Type a message | 输入消息 | اكتب رسالة |
| `conversations_menu` | Conversations menu | 会话菜单 | قائمة المحادثات |

Run `pnpm test` → the parity test passes.

- [ ] **Step 2: App context and workspace**

`components/chat/app-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

import type { IDifyAppParameters, IDifyAppSiteSetting } from '@/lib/core'
import type { DifyApi } from '@/lib/dify-client'
import type { IDifyAppItem } from '@/types'

export interface AppContextValue {
	app: IDifyAppItem
	parameters: IDifyAppParameters
	site: IDifyAppSiteSetting
	difyApi: DifyApi
	userId: string
}

export const AppContext = createContext<AppContextValue | null>(null)

export const useAppContext = (): AppContextValue => {
	const value = useContext(AppContext)
	if (!value) throw new Error('useAppContext must be used inside ChatWorkspace')
	return value
}
```

`components/chat/chat-workspace.tsx`:

```tsx
'use client'

import { Button, Empty, Flex, Result, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChatLayoutWrapper from '@/components/chat/chat-layout-wrapper'
import UserShell from '@/components/shell/user-shell'
import { useAuth } from '@/hooks/use-auth'
import { AppModeEnums, DEFAULT_APP_SITE_SETTING } from '@/lib/core'
import { createDifyApiInstance, type DifyApi } from '@/lib/dify-client'
import appService from '@/services/app'

import { AppContext, type AppContextValue } from './app-context'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
import { isChatLikeApp } from './utils-index'

type State =
	| { status: 'loading' }
	| { status: 'missing' }
	| { status: 'error'; message: string }
	| { status: 'ready'; value: AppContextValue }

/** Loads the app, its parameters and site settings, provides AppContext and picks the view by mode (spec §4.9). */
export default function ChatWorkspace({ appId }: { appId: string }) {
	const { t } = useTranslation()
	const { userId } = useAuth()
	const [state, setState] = useState<State>({ status: 'loading' })

	useEffect(() => {
		if (!userId) return
		let cancelled = false
		;(async () => {
			try {
				const app = await appService.getAppByID(appId)
				if (!app) {
					if (!cancelled) setState({ status: 'missing' })
					return
				}
				const difyApi = createDifyApiInstance({ appId: app.id, user: userId, ...app.requestConfig }) as DifyApi
				const [parameters, site] = await Promise.all([
					difyApi.getAppParameters(),
					difyApi.getAppSiteSetting().catch(() => DEFAULT_APP_SITE_SETTING),
				])
				if (!cancelled) setState({ status: 'ready', value: { app, parameters, site, difyApi, userId } })
			} catch (error) {
				if (!cancelled) setState({ status: 'error', message: (error as Error).message })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [appId, userId])

	if (state.status === 'loading') {
		return (
			<UserShell>
				<Flex className={styles.fill} align="center" justify="center">
					<Spin size="large" description={t('app.loading')} />
				</Flex>
			</UserShell>
		)
	}
	if (state.status === 'missing') {
		return (
			<UserShell>
				<Flex className={styles.fill} align="center" justify="center">
					<Empty description={t('app.no_config_default_text')} />
				</Flex>
			</UserShell>
		)
	}
	if (state.status === 'error') {
		return (
			<UserShell>
				<Result
					status="500"
					title={t('app.load_failed')}
					subTitle={state.message}
					extra={
						<Button type="primary" onClick={() => window.location.reload()}>
							{t('app.reload_page')}
						</Button>
					}
				/>
			</UserShell>
		)
	}
	const mode = state.value.app.info.mode ?? AppModeEnums.CHATBOT
	if (!isChatLikeApp(mode)) return <ChatLayoutWrapper />
	return (
		<AppContext.Provider value={state.value}>
			<ChatView />
		</AppContext.Provider>
	)
}
```

- [ ] **Step 3: Routes**

`app/(user)/chat/[appId]/page.tsx`:

```tsx
import ChatWorkspace from '@/components/chat/chat-workspace'

export default async function AppChatPage({ params }: { params: Promise<{ appId: string }> }) {
	const { appId } = await params
	return <ChatWorkspace appId={appId} />
}
```

`app/(user)/chat/page.tsx` (server; redirects to the first enabled app or to the list — `redirect` works by throwing, keep it outside try/catch):

```tsx
import { redirect } from 'next/navigation'

import { EIsEnabled } from '@/lib/core'
import { getAppList } from '@/repository/app'

export const dynamic = 'force-dynamic'

export default async function ChatIndexPage() {
	const apps = await getAppList()
	const first = apps.find(app => app.isEnabled !== EIsEnabled.disabled) ?? apps[0]
	redirect(first ? `/chat/${first.id}` : '/apps')
}
```

- [ ] **Step 4: The chat view skeleton**

`components/chat/chat-view/chat-view.module.css`:

```css
/* The chat fills the shell's content region (ADR-0011) and splits into a sider and a column. */
.fill {
	height: 100%;
}
.layout {
	height: 100%;
}
.sider {
	border-inline-end: var(--ant-line-width) var(--ant-line-type) var(--ant-color-border-secondary);
}
.siderInner {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
}
.siderList {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding-inline: var(--ant-padding-xs);
}
.column {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	width: 100%;
	max-width: 768px; /* screenMD */
	margin-inline: auto;
	padding-inline: var(--ant-padding);
}
.columnWide {
	max-width: none;
}
.list {
	flex: 1;
	min-height: 0;
}
.composer {
	padding-block: var(--ant-padding-sm);
}
.disclaimer {
	text-align: center;
	display: block;
	padding-block-end: var(--ant-padding-xs);
}
.loadEarlier {
	display: flex;
	justify-content: center;
	padding-block: var(--ant-padding-xs);
}
/* screenSMMax = 767: the sider is replaced by the header's drawer trigger */
@media (max-width: 767px) {
	.sider {
		display: none;
	}
}
```

`components/chat/chat-view/width-toggle.tsx`:

```tsx
'use client'

import { ColumnWidthOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

export default function WidthToggle({ wide, onChange }: { wide: boolean; onChange: (wide: boolean) => void }) {
	const { t } = useTranslation()
	const label = wide ? t('chat.switch_narrow') : t('chat.switch_wide')
	return (
		<Button
			type="text"
			icon={<ColumnWidthOutlined />}
			aria-label={label}
			title={label}
			onClick={() => onChange(!wide)}
		/>
	)
}
```

`components/chat/chat-view/conversation-sidebar.tsx` (X `Conversations`: `items`, `activeKey`, `onActiveChange`, `groupable` with a `label` render, `creation`; per-item `menu` arrives in Task 16):

```tsx
'use client'

import { Conversations, type ConversationsProps } from '@ant-design/x'
import { Avatar, Flex, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import type { ConversationGroup, ConversationItem } from '../provider/conversations'
import styles from './chat-view.module.css'

export interface ConversationSidebarProps {
	items: ConversationItem[]
	activeKey: string
	onActiveChange: (key: string) => void
	onCreate: () => void
	createDisabled: boolean
	menu?: ConversationsProps['menu']
}

export function AppInfoBlock() {
	const { app, site } = useAppContext()
	const name = site.title || app.info.name
	const description = site.description || app.info.description
	return (
		<Flex gap="small" align="center" style={{ padding: 'var(--ant-padding-sm)' }}>
			<Avatar shape="square" src={site.icon_type === 'image' ? site.icon_url || site.icon : undefined}>
				{site.icon_type === 'emoji' ? site.icon : name.slice(0, 1)}
			</Avatar>
			<Flex vertical style={{ minWidth: 0 }}>
				<Typography.Text strong ellipsis>
					{name}
				</Typography.Text>
				{description && (
					<Typography.Text type="secondary" ellipsis title={description}>
						{description}
					</Typography.Text>
				)}
			</Flex>
		</Flex>
	)
}

export default function ConversationSidebar({ items, activeKey, onActiveChange, onCreate, createDisabled, menu }: ConversationSidebarProps) {
	const { t } = useTranslation()
	const groupLabel = (group: string) => t(`chat.group_${group as ConversationGroup}`)
	return (
		<div className={styles.siderInner}>
			<AppInfoBlock />
			<div className={styles.siderList}>
				<Conversations
					items={items.map(item => ({ key: item.key, label: item.label, group: item.group }))}
					activeKey={activeKey}
					onActiveChange={onActiveChange}
					groupable={{ label: groupLabel }}
					creation={{ label: t('chat.new_chat'), disabled: createDisabled, onClick: onCreate }}
					menu={menu}
				/>
			</div>
		</div>
	)
}
```

Check `creation`'s accepted fields in `node_modules/@ant-design/x/es/conversations/interface.d.ts` (`CreationProps`); if `disabled` is not among them, keep the button enabled and make `onCreate` a no-op while `createDisabled` is true, and say so in the task report.

`components/chat/chat-view/conversation-drawer.tsx` (antd `Drawer`; content mounts on first open):

```tsx
'use client'

import { Drawer } from 'antd'
import { useTranslation } from 'react-i18next'

export default function ConversationDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
	const { t } = useTranslation()
	return (
		<Drawer open={open} onClose={onClose} placement="left" title={t('chat.conversations_menu')} styles={{ body: { padding: 0 } }}>
			{children}
		</Drawer>
	)
}
```

`components/chat/chat-view/message-list.tsx` (X `Bubble.List`: `items`, `role`, `autoScroll`, ref `scrollTo`):

```tsx
'use client'

import { RobotOutlined, UserOutlined } from '@ant-design/icons'
import { Bubble, type BubbleListProps } from '@ant-design/x'
import type { BubbleListRef } from '@ant-design/x/es/bubble/interface'
import { Avatar, Button, Skeleton } from 'antd'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import { toBubbleItems } from '../hooks/bubble-items'
import type { useDifyChat } from '../hooks/use-dify-chat'
import type { DifyChatMessage } from '../provider/message'
import MessageMarkdown from '../message/message-markdown'
import styles from './chat-view.module.css'

type Info = { status?: string; key?: string | number }

export interface MessageListProps {
	chat: ReturnType<typeof useDifyChat>
	renderAssistant?: (message: DifyChatMessage, info: Info) => React.ReactNode
	renderFooter?: (message: DifyChatMessage, info: Info) => React.ReactNode
	onSend: (text: string) => void
}

export default function MessageList({ chat, renderAssistant, renderFooter, onSend }: MessageListProps) {
	const { t } = useTranslation()
	const { site } = useAppContext()
	const listRef = useRef<BubbleListRef>(null)

	// Stable role map (x-components: "keep roles stable"); avatar follows the site setting.
	const role = useMemo<BubbleListProps['role']>(
		() => ({
			assistant: {
				placement: 'start',
				avatar: site.use_icon_as_answer_icon ? (
					<Avatar shape="square" src={site.icon_type === 'image' ? site.icon_url || site.icon : undefined}>
						{site.icon_type === 'emoji' ? site.icon : null}
					</Avatar>
				) : (
					<Avatar icon={<RobotOutlined />} />
				),
				variant: 'borderless',
				contentRender: (content, info) =>
					renderAssistant ? renderAssistant(content as DifyChatMessage, info) : <MessageMarkdown content={(content as DifyChatMessage).content} streaming={info.status === 'updating'} messageId={(content as DifyChatMessage).ids.messageId} onSend={onSend} />,
				footer: renderFooter ? (content, info) => renderFooter(content as DifyChatMessage, info) : undefined,
			},
			user: {
				placement: 'end',
				avatar: <Avatar icon={<UserOutlined />} />,
				contentRender: content => (content as DifyChatMessage).content,
			},
		}),
		[site, renderAssistant, renderFooter, onSend],
	)

	const items = useMemo(() => toBubbleItems(chat.messages), [chat.messages])

	const loadEarlier = async () => {
		const firstKey = items[0]?.key
		await chat.loadEarlier()
		if (firstKey !== undefined) listRef.current?.scrollTo({ key: firstKey, block: 'start' })
	}

	if (chat.isDefaultMessagesRequesting && items.length === 0) {
		return <Skeleton active paragraph={{ rows: 4 }} className={styles.list} />
	}
	return (
		<div className={styles.list}>
			{chat.hasMore && (
				<div className={styles.loadEarlier}>
					<Button type="link" onClick={loadEarlier}>
						{t('chat.load_earlier')}
					</Button>
				</div>
			)}
			<Bubble.List ref={listRef} items={items} role={role} autoScroll className={styles.fill} />
		</div>
	)
}
```

`components/chat/chat-view/chat-sender.tsx` (basic; attachments and speech arrive in Task 15):

```tsx
'use client'

import { Sender, type SenderProps } from '@ant-design/x'
import type { GetRef } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SenderRef = GetRef<typeof Sender>

export interface ChatSenderProps {
	loading: boolean
	disabled?: boolean
	initialValue?: string
	senderRef: React.RefObject<SenderRef | null>
	onSend: (text: string) => Promise<boolean> | boolean
	onStop: () => void
	header?: SenderProps['header']
	prefix?: SenderProps['prefix']
	allowSpeech?: SenderProps['allowSpeech']
	onPasteFile?: SenderProps['onPasteFile']
}

export default function ChatSender({ loading, disabled, initialValue = '', senderRef, onSend, onStop, header, prefix, allowSpeech, onPasteFile }: ChatSenderProps) {
	const { t } = useTranslation()
	const [value, setValue] = useState(initialValue)
	return (
		<Sender
			ref={senderRef}
			value={value}
			onChange={setValue}
			placeholder={t('chat.send_placeholder')}
			loading={loading}
			disabled={disabled}
			header={header}
			prefix={prefix}
			allowSpeech={allowSpeech}
			onPasteFile={onPasteFile}
			autoSize={{ minRows: 1, maxRows: 8 }}
			onSubmit={async text => {
				if (!text.trim()) return
				if (await onSend(text)) setValue('')
			}}
			onCancel={onStop}
		/>
	)
}
```

`components/chat/chat-view/chat-view.tsx`:

```tsx
'use client'

import { MenuOutlined } from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import { App, Button, Layout, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import type { IFile } from '@/lib/api'

import { useAppContext } from '../app-context'
import { useConversations } from '../hooks/use-conversations'
import { useDifyChat, type SendParams } from '../hooks/use-dify-chat'
import ChatSender, { type SenderRef } from './chat-sender'
import styles from './chat-view.module.css'
import ConversationDrawer from './conversation-drawer'
import ConversationSidebar from './conversation-sidebar'
import MessageList from './message-list'
import WidthToggle from './width-toggle'

/** The one literal width in the chat (X's full-page pattern uses a literal sider width too). */
const SIDEBAR_WIDTH = 280

export default function ChatView() {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message: toast } = App.useApp()
	const { app, site, difyApi, userId } = useAppContext()
	const searchParams = useSearchParams()
	const senderRef = useRef<SenderRef>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [wide, setWide] = useLocalStorageState('dify-app-hub-wide-screen', { defaultValue: false })

	const list = useConversations({ appId: app.id, difyApi, startNew: searchParams.get('isNewCvst') === '1' })
	const activeKey = list.activeKey || `${app.id}:temp:pending`
	const chat = useDifyChat({ appId: app.id, conversationKey: activeKey, getDifyConversationId: () => list.getDifyId(activeKey), difyApi, t })

	// A temporary conversation learns its Dify id from the first assistant message; the list then takes the server name.
	const lastAssistant = [...chat.messages].reverse().find(m => m.message.role === 'assistant')
	const serverId = lastAssistant?.message.ids.conversationId
	useEffect(() => {
		if (serverId && list.activeKey && !list.getDifyId(list.activeKey)) list.markDifyId(list.activeKey, serverId)
	}, [serverId, list])
	const wasRequesting = useRef(false)
	useEffect(() => {
		if (wasRequesting.current && !chat.isRequesting) void list.refresh()
		wasRequesting.current = chat.isRequesting
	}, [chat.isRequesting, list])

	useEffect(() => {
		senderRef.current?.focus()
	}, [activeKey])

	useEffect(() => {
		if (list.error) toast.error(t('chat.fetch_list_failed', { error: list.error.message }))
	}, [list.error, t, toast])

	const send = useCallback(
		async (text: string, extra: Partial<SendParams> = {}) => {
			chat.send({ query: text, inputs: extra.inputs ?? {}, files: (extra.files ?? []) as IFile[] })
			return true
		},
		[chat],
	)

	const sidebar = (
		<ConversationSidebar
			items={list.conversations}
			activeKey={list.activeKey}
			onActiveChange={key => {
				list.setActiveKey(key)
				setDrawerOpen(false)
			}}
			onCreate={() => {
				list.createTemp()
				setDrawerOpen(false)
			}}
			createDisabled={list.hasEmptyTemp}
		/>
	)

	return (
		<UserShell
			title={<Typography.Text strong ellipsis>{site.title || app.info.name}</Typography.Text>}
			extra={<WidthToggle wide={Boolean(wide)} onChange={setWide} />}
			mobileMenu={<Button type="text" icon={<MenuOutlined />} aria-label={t('system.menu')} title={t('system.menu')} onClick={() => setDrawerOpen(true)} />}
		>
			<Layout className={styles.layout} hasSider>
				<Layout.Sider width={SIDEBAR_WIDTH} className={styles.sider} style={{ background: token.colorBgContainer }}>
					{sidebar}
				</Layout.Sider>
				<Layout.Content>
					<div className={`${styles.column} ${wide ? styles.columnWide : ''}`}>
						<MessageList chat={chat} onSend={text => void send(text)} />
						<div className={styles.composer}>
							<ChatSender loading={chat.isRequesting} senderRef={senderRef} onSend={text => send(text)} onStop={() => void chat.stop()} />
						</div>
						<Typography.Text type="secondary" className={styles.disclaimer}>
							{site.custom_disclaimer || t('system.default_disclaimer_content')}
						</Typography.Text>
					</div>
				</Layout.Content>
			</Layout>
			<ConversationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
				{sidebar}
			</ConversationDrawer>
		</UserShell>
	)
}
```

`userId` is read from the context so that later tasks (HITL submit, annotation) have it; leave the unused-variable lint clean by removing it from the destructuring until Task 13 uses it.

- [ ] **Step 5: Type-check and lint, then run the old suite once**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat app && pnpm exec playwright test e2e/smoke.spec.ts e2e/chat-header.spec.ts e2e/providers.spec.ts e2e/screenshots.spec.ts`
Expected: tsc clean; the smoke chat flow (Echo) passes on the new view, `chat-header.spec.ts` finds the title, the width toggle and the account menu on desktop and the "Menu" button on mobile, `providers.spec.ts` still counts one `css-var-*` class, screenshots render.

- [ ] **Step 6: Write the chat spec and the race spec**

`e2e/chat.spec.ts` (first version; later tasks append):

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

test.describe('chat', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_ID}`)
		await expect(page.getByRole('textbox').first()).toBeVisible()
	})

	test('streams an answer and renders Markdown from the stub', async ({ page }, testInfo) => {
		const text = `markdown table ${testInfo.project.name}`
		await page.getByRole('textbox').first().fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText('Quarterly summary')).toBeVisible()
		await expect(page.locator('.ant-bubble table')).toBeVisible()
		await expect(page.getByRole('link', { name: 'previous quarter' })).toHaveAttribute('target', '_blank')
	})

	test('a new conversation appears at the top and becomes active', async ({ page }) => {
		await page.getByRole('textbox').first().fill('first turn')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: first turn')).toBeVisible()
		await page.getByRole('button', { name: 'New conversation' }).first().click()
		await expect(page.getByText('Echo: first turn')).toHaveCount(0)
		await expect(page.locator('.ant-conversations-item').first()).toContainText('New conversation')
	})

	test('switching away during a reply does not lose it', async ({ page }) => {
		await page.getByRole('textbox').first().fill('hello one')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: hello one')).toBeVisible()
		await page.getByRole('button', { name: 'New conversation' }).first().click()
		await page.getByRole('textbox').first().fill('slow second')
		await page.keyboard.press('Enter')
		// Switch back to the first conversation while the second streams (40 chunks at 100 ms).
		await page.locator('.ant-conversations-item').filter({ hasText: 'hello one' }).click()
		await expect(page.getByText('Echo: hello one')).toBeVisible()
		await page.locator('.ant-conversations-item').filter({ hasText: 'slow second' }).click()
		await expect(page.getByText(/^0 1 2 3/)).toBeVisible({ timeout: 30_000 })
	})

	test('earlier messages load on request and keep the list position', async ({ page }) => {
		// The stub stores 40 earlier turns for a conversation whose first query contains "history40".
		await page.getByRole('textbox').first().fill('history40 start')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: history40 start')).toBeVisible()
		await page.reload()
		await expect(page.getByText('Echo: history40 start')).toBeVisible()
		await expect(page.getByText('Echo: earlier 40')).toBeVisible()
		await expect(page.getByText('Echo: earlier 1')).toHaveCount(0)
		await page.getByRole('button', { name: 'Load earlier messages' }).click()
		await expect(page.getByText('Echo: earlier 1')).toBeVisible()
		await expect(page.getByText('Echo: earlier 40')).toBeInViewport()
	})
})
```

`e2e/chat-race.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

// The late-history race: a message sent while a reopened conversation's history is loading used to be
// wiped when the history arrived. The stub delays /messages by 1.5 s for conversations whose first
// query contains "slowhistory"; the send is queued by useXChat (queueRequest) until the history lands.
test('a message sent while the history loads is kept next to the history', async ({ page }, testInfo) => {
	const first = `slowhistory ${testInfo.project.name}`
	await page.goto(`/chat/${APP_ID}`)
	await page.getByRole('textbox').first().fill(first)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${first}`)).toBeVisible()

	await page.reload()
	await page.getByRole('textbox').first().fill('sent at once')
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
	await expect(page.getByText('Echo: sent at once')).toBeVisible()
	await expect(page.getByText('sent at once', { exact: true })).toBeVisible()
})
```

- [ ] **Step 7: Retire the stub reset**

Remove the `/__e2e/reset` branch and `resetAll` from `e2e/fixtures/stub/router.ts` and `store.ts`, and the `test.beforeEach` block (with its comment) from `e2e/smoke.spec.ts`. Tests that need a fresh conversation click "New conversation" instead.

- [ ] **Step 8: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: all green across the three projects, including `chat-race.spec.ts`. If the race test is flaky because history returns before the send on a fast machine, raise the stub's delay to 2500 ms (it only affects `slowhistory` conversations).

- [ ] **Step 9: Commit**

```bash
pnpm exec oxfmt --write components/chat app e2e locales
git add components/chat app "app/(user)/chat" e2e locales
git commit -m "feat(chat): ChatWorkspace, routes and the chat view on Bubble.List, Conversations and Sender; the late-history race is gone" -m "Server pages render ChatWorkspace, which loads the app, parameters and site settings into AppContext and picks the view by mode (non-chat modes keep the old layout until the workflow view lands). The chat view is an antd Layout with a Sider (Conversations, grouped by date) and a column with Bubble.List and Sender; a Drawer holds the list on mobile. History loads through useXChat's defaultMessages and sends during the load are queued, pinned by chat-race.spec.ts, so the stub's POST /__e2e/reset and the smoke spec's beforeEach are removed." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 10: Welcome panel, input-parameter form, next-question suggestions

**Spec:** §5.2 (Empty state, Input parameters, Next suggestions), §4.7 (suggested questions, deep links), §4.9 (URL parameters).

**Files:**
- Create: `components/chat/chat-view/welcome-panel.tsx`, `components/chat/chat-view/inputs-form.tsx`, `components/chat/chat-view/inputs-collapse.tsx`, `components/chat/chat-view/inputs-values.ts`, `components/chat/hooks/use-suggestions.ts`, `__tests__/chat-inputs-values.test.ts`
- Modify: `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/message-list.tsx` (welcome slot), `e2e/chat.spec.ts`, `locales/*`

**Interfaces:**
- Produces: `WelcomePanel({ visible, onPrompt })`; `InputsCollapse({ form, conversationKey, disabled, onValuesChange })`; `resolveInitialInputs({ form, searchParams, globalParams, conversationInputs, isTemp, allowUpdate })` (pure, tested); `useSuggestions({ enabled, difyApi, lastMessageId, isRequesting })` → `{ suggestions, clear }`.
- `ChatView` keeps `inputsForm = Form.useForm()` and validates it before sending (`validateFields`); `send` passes `form.getFieldsValue()` as `inputs`.

- [ ] **Step 1: New keys**

Under `chat`: `inputs_required` — en "Fill in the conversation parameters first." · zh "请先填写对话参数。" · ar "يرجى تعبئة معاملات المحادثة أولاً."

- [ ] **Step 2: Write the failing test for the input value resolution**

`__tests__/chat-inputs-values.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveInitialInputs } from '@/components/chat/chat-view/inputs-values'

const form = [
	{ 'text-input': { label: 'Topic', variable: 'topic', required: true, default: 'tea', type: 'text-input' as const } },
	{ select: { label: 'Tone', variable: 'tone', required: false, default: '', options: ['warm', 'cool'], type: 'select' as const } },
]

describe('resolveInitialInputs', () => {
	it('uses the defaults for a new conversation without URL or stored values', () => {
		expect(resolveInitialInputs({ form, urlValues: {}, globalParams: {}, conversationInputs: {}, isTemp: true, allowUpdate: false })).toEqual({ topic: 'tea', tone: undefined })
	})
	it('prefers URL values on a new conversation', () => {
		expect(resolveInitialInputs({ form, urlValues: { topic: 'coffee' }, globalParams: { tone: 'cool' }, conversationInputs: {}, isTemp: true, allowUpdate: false })).toEqual({ topic: 'coffee', tone: 'cool' })
	})
	it('uses the conversation inputs for an existing conversation unless updates are allowed', () => {
		expect(resolveInitialInputs({ form, urlValues: { topic: 'coffee' }, globalParams: {}, conversationInputs: { topic: 'mate', tone: 'warm' }, isTemp: false, allowUpdate: false })).toEqual({ topic: 'mate', tone: 'warm' })
		expect(resolveInitialInputs({ form, urlValues: { topic: 'coffee' }, globalParams: {}, conversationInputs: { topic: 'mate' }, isTemp: false, allowUpdate: true })).toEqual({ topic: 'coffee', tone: undefined })
	})
})
```

Run → FAIL.

- [ ] **Step 3: Implement the value resolution**

`components/chat/chat-view/inputs-values.ts`:

```ts
import type { IUserInputForm } from '@/lib/core'

export interface ResolveArgs {
	form: IUserInputForm[]
	/** Decoded `?var=` values (gzip-decoded by the caller with unParseGzipString). */
	urlValues: Record<string, unknown>
	/** `?isKeepAll=true` values kept across navigations. */
	globalParams: Record<string, unknown>
	conversationInputs: Record<string, unknown>
	isTemp: boolean
	allowUpdate: boolean
}

/** Field definitions flattened from Dify's `{ [controlType]: field }` list. */
export const inputFields = (form: IUserInputForm[]) =>
	form.map(item => {
		const [type, field] = Object.entries(item)[0]
		return { ...field, type: field.type ?? (type as typeof field.type) }
	})

/** Which value each input starts with (today's rules, spec §4.9): URL/global on a new chat or when updates are allowed, else the conversation's stored inputs, else the default. */
export const resolveInitialInputs = ({ form, urlValues, globalParams, conversationInputs, isTemp, allowUpdate }: ResolveArgs): Record<string, unknown> =>
	Object.fromEntries(
		inputFields(form).map(field => {
			const external = urlValues[field.variable] ?? globalParams[field.variable]
			if (external !== undefined && (isTemp || allowUpdate)) return [field.variable, external]
			if (!isTemp && conversationInputs[field.variable] !== undefined) return [field.variable, conversationInputs[field.variable]]
			return [field.variable, field.default || undefined]
		}),
	)
```

Run → PASS.

- [ ] **Step 4: The form, the collapse and the welcome panel**

`components/chat/chat-view/inputs-form.tsx` (antd `Form`; the file control is the existing one, moved here in Task 15 — import it from its current path for now):

```tsx
'use client'

import { Form, Input, InputNumber, Select, type FormInstance } from 'antd'
import { useTranslation } from 'react-i18next'

import FileUpload from '@/components/chat/chatbox/form-controls/file-upload'
import type { IUserInputForm } from '@/lib/core'

import { inputFields } from './inputs-values'

export interface InputsFormProps {
	form: FormInstance<Record<string, unknown>>
	definition: IUserInputForm[]
	disabled?: boolean
	onValuesChange?: (values: Record<string, unknown>) => void
}

export default function InputsForm({ form, definition, disabled, onValuesChange }: InputsFormProps) {
	const { t } = useTranslation()
	return (
		<Form form={form} layout="vertical" onValuesChange={(_changed, all) => onValuesChange?.(all)}>
			{inputFields(definition).map(field => (
				<Form.Item
					key={field.variable}
					name={field.variable}
					label={field.label}
					hidden={field.hide}
					rules={field.required ? [{ required: true, message: t('form.field_required', { label: field.label }) }] : []}
				>
					{field.type === 'select' ? (
						<Select disabled={disabled} placeholder={t('form.select_placeholder')} options={(field.options ?? []).map(o => ({ value: o, label: o }))} />
					) : field.type === 'paragraph' ? (
						<Input.TextArea disabled={disabled} placeholder={t('form.input_placeholder')} maxLength={field.max_length} />
					) : field.type === 'number' ? (
						<InputNumber disabled={disabled} placeholder={t('form.input_placeholder')} style={{ width: '100%' }} />
					) : field.type === 'file' ? (
						<FileUpload mode="single" disabled={disabled} allowed_file_types={field.allowed_file_types ?? []} />
					) : field.type === 'file-list' ? (
						<FileUpload disabled={disabled} maxCount={field.max_length} allowed_file_types={field.allowed_file_types ?? []} />
					) : (
						<Input disabled={disabled} placeholder={t('form.input_placeholder')} maxLength={field.max_length} />
					)}
				</Form.Item>
			))}
		</Form>
	)
}
```

The old `FileUpload` reads the zustand store for the Dify client; Task 15 rewrites it on `useAppContext()`. Until then it works because the old store is still populated by nothing — so in this task change its two store reads (`useDifyChatStore().difyApi`, `currentApp`) to `useAppContext()` (`difyApi`, `app.requestConfig.apiBase`); this is the only edit to an old file.

`components/chat/chat-view/inputs-collapse.tsx`:

```tsx
'use client'

import { Collapse, Typography, type FormInstance } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import InputsForm from './inputs-form'

export interface InputsCollapseProps {
	form: FormInstance<Record<string, unknown>>
	conversationKey: string
	disabled: boolean
	onValuesChange: (values: Record<string, unknown>) => void
}

const KEY = 'inputs'

/** Conversation parameters above the messages; opens on every conversation switch so the form mounts and holds values. */
export default function InputsCollapse({ form, conversationKey, disabled, onValuesChange }: InputsCollapseProps) {
	const { t } = useTranslation()
	const { parameters, app } = useAppContext()
	const [active, setActive] = useState<string[]>([KEY])
	useEffect(() => setActive([KEY]), [conversationKey])
	const visible = parameters.user_input_form?.filter(item => !Object.values(item)[0]?.hide).length ?? 0
	if (!visible) return null
	return (
		<Collapse
			size="small"
			activeKey={active}
			onChange={keys => setActive(keys as string[])}
			items={[
				{
					key: KEY,
					label: (
						<>
							<Typography.Text strong>{t('chat.input_params_setting')}</Typography.Text>
							{!app.inputParams?.enableUpdateAfterCvstStarts && (
								<Typography.Text type="secondary"> {t('chat.input_disabled_between_chats')}</Typography.Text>
							)}
						</>
					),
					children: <InputsForm form={form} definition={parameters.user_input_form} disabled={disabled} onValuesChange={onValuesChange} />,
				},
			]}
		/>
	)
}
```

`components/chat/chat-view/welcome-panel.tsx` (X `Welcome` + `Prompts`, COMPONENTS.md "Welcome + Prompts"):

```tsx
'use client'

import { Prompts, Welcome } from '@ant-design/x'
import { Avatar, Flex } from 'antd'

import { useAppContext } from '../app-context'
import MessageMarkdown from '../message/message-markdown'

export default function WelcomePanel({ visible, onPrompt }: { visible: boolean; onPrompt: (text: string) => void }) {
	const { app, site, parameters } = useAppContext()
	if (!visible) return null
	const name = site.title || app.info.name
	return (
		<Flex vertical gap="middle" style={{ paddingBlock: 'var(--ant-padding)' }}>
			<Welcome
				variant="borderless"
				icon={
					<Avatar size="large" shape="square" src={site.icon_type === 'image' ? site.icon_url || site.icon : undefined}>
						{site.icon_type === 'emoji' ? site.icon : name.slice(0, 1)}
					</Avatar>
				}
				title={name}
				description={parameters.opening_statement ? <MessageMarkdown content={parameters.opening_statement} /> : undefined}
			/>
			{parameters.suggested_questions?.length ? (
				<Prompts
					wrap
					items={parameters.suggested_questions.map((q, i) => ({ key: String(i), label: q }))}
					onItemClick={info => onPrompt(String(info.data.label))}
				/>
			) : null}
		</Flex>
	)
}
```

`components/chat/hooks/use-suggestions.ts`:

```ts
'use client'

import { useEffect, useRef, useState } from 'react'

import type { DifyApi } from '@/lib/dify-client'

/** Next-question suggestions after a reply ends (GET /messages/{id}/suggested), when the app enables them (spec §4.7). */
export const useSuggestions = ({ enabled, difyApi, lastMessageId, isRequesting }: { enabled: boolean; difyApi: DifyApi; lastMessageId?: string; isRequesting: boolean }) => {
	const [suggestions, setSuggestions] = useState<string[]>([])
	const fetchedFor = useRef<string | undefined>(undefined)
	useEffect(() => {
		if (!enabled || isRequesting || !lastMessageId || fetchedFor.current === lastMessageId) return
		fetchedFor.current = lastMessageId
		difyApi
			.getNextSuggestions({ message_id: lastMessageId })
			.then((result: { data?: string[] }) => setSuggestions(result?.data ?? []))
			.catch(() => setSuggestions([]))
	}, [enabled, difyApi, lastMessageId, isRequesting])
	return { suggestions, clear: () => setSuggestions([]) }
}
```

- [ ] **Step 5: Wire them into `ChatView`**

In `chat-view.tsx`:

- `const [inputsForm] = Form.useForm<Record<string, unknown>>()` (import `Form` from antd).
- Initial values whenever `activeKey` or the conversation changes: decode URL values with `unParseGzipString` from `@/lib/helpers` for each `?var=` the form knows (`searchParams.get(variable)`), keep `?isKeepAll=true` values in a `useRef` map, then `inputsForm.setFieldsValue(resolveInitialInputs({ form: parameters.user_input_form, urlValues, globalParams, conversationInputs: list.conversations.find(c => c.key === activeKey)?.inputs ?? {}, isTemp: parseConversationKey(activeKey).temp, allowUpdate: Boolean(app.inputParams?.enableUpdateAfterCvstStarts) }))`.
- `send` becomes: `try { await inputsForm.validateFields() } catch { toast.error(t('chat.inputs_required')); return false }` then `chat.send({ query, inputs: inputsForm.getFieldsValue(true), files })`, then `suggestions.clear()`.
- Render order inside the column: `<WelcomePanel visible={showWelcome} onPrompt={text => void send(text)} />`, `<InputsCollapse form={inputsForm} conversationKey={activeKey} disabled={!parseConversationKey(activeKey).temp && !app.inputParams?.enableUpdateAfterCvstStarts} onValuesChange={values => list.setInputs(activeKey, values)} />` (add `setInputs(key, inputs)` to `useConversations`: `store.setConversation(key, { inputs })`), then `MessageList`, then `{suggestions.suggestions.length > 0 && !chat.isRequesting && <Prompts items={…} onItemClick={info => void send(String(info.data.label))} />}` above the sender.
- `showWelcome = app.extConfig?.conversation?.openingStatement?.displayMode === 'always' || chat.messages.length === 0`.
- `useSuggestions({ enabled: Boolean(parameters.suggested_questions_after_answer?.enabled), difyApi, lastMessageId: lastAssistant?.message.ids.messageId, isRequesting: chat.isRequesting })`.
- Prefill: `initialValue={searchParams.get('sender_text') ? decodeURIComponent(searchParams.get('sender_text')!) : ''}` on `ChatSender`.

- [ ] **Step 6: Extend `e2e/chat.spec.ts`**

```ts
	test('shows the opening statement and the suggested questions before the first message', async ({ page }) => {
		await page.getByRole('button', { name: 'New conversation' }).first().click()
		await expect(page.getByText('Hello from the stub')).toBeVisible()
		await page.getByText('What can you do?').click()
		await expect(page.getByText('Echo: What can you do?')).toBeVisible()
		await expect(page.getByText('Hello from the stub')).toHaveCount(0)
	})

	test('offers next-question suggestions after a reply when the app enables them', async ({ page }) => {
		await page.goto(`/chat/${APP_IDS['agent-chat']}`)
		await page.getByRole('textbox').first().fill('hello agent')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: hello agent')).toBeVisible()
		await page.getByText('Why is that?').click()
		await expect(page.getByText('Echo: Why is that?')).toBeVisible()
	})
```

and a required-input flow in a new describe against the workflow app's chat-like sibling is not possible (workflow apps are not chat); instead seed the check through the stub's chat parameters: add to `parametersFor('chat')` nothing — the required-inputs check is covered by the workflow view spec in Task 17 (same `InputsForm`). Note this in the task report.

Import `APP_IDS` from `./fixtures/constants` at the top of the spec.

- [ ] **Step 7: Run, then commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm test && pnpm exec playwright test e2e/chat.spec.ts e2e/chat-race.spec.ts e2e/smoke.spec.ts`
Expected: green.

```bash
pnpm exec oxfmt --write components/chat e2e/chat.spec.ts __tests__/chat-inputs-values.test.ts locales
git add components/chat e2e/chat.spec.ts __tests__/chat-inputs-values.test.ts locales
git commit -m "feat(chat): welcome panel with prompts, conversation parameter form and next-question suggestions" -m "X Welcome and Prompts show the opening statement and suggested questions on an empty conversation (or always, per the app's display mode). The parameter form is antd Form inside a Collapse with the previous value rules (URL and isKeepAll values, stored conversation inputs, defaults) extracted to a tested resolver; sends validate it first. Suggestions are fetched once per finished reply." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---
### Task 11: `WorkflowLogs` and `WorkflowNodeIcon` on antd primitives

**Spec:** §5.3 (WorkflowLogs). Charter: kept custom, token-styled.

**Files:**
- Create: `components/chat/message/workflow-summary.ts`, `components/chat/message/workflow-logs.tsx`, `components/chat/message/workflow-logs.module.css`, `components/chat/message/workflow-node-icon.tsx`, `__tests__/workflow-summary.test.ts`
- Modify: `locales/*` (keys below)

**Interfaces:**
- Produces: `WorkflowLogs({ workflow?: WorkflowState; defaultOpen?: boolean })` (renders nothing without nodes), `WorkflowNodeIcon({ type: string })`, `runSummary(workflow): { nodes: number; seconds: number; tokens: number }`, `formatSeconds(seconds?: number): string`.
- Consumes: `WorkflowState`, `WorkflowNode` (Task 6).

- [ ] **Step 1: Keys**

Under `workflow`: `summary` — en "{{nodes}} nodes · {{seconds}} s · {{tokens}} tokens" · zh "{{nodes}} 个节点 · {{seconds}} 秒 · {{tokens}} tokens" · ar "{{nodes}} عقد · {{seconds}} ث · {{tokens}} رمز"; `retries` — en "Retried {{times}}×" · zh "已重试 {{times}} 次" · ar "أُعيدت المحاولة {{times}} مرة"; `error` — en "Error" · zh "错误" · ar "خطأ". (Never name a placeholder `count`, see `docs/i18n-maintenance.md`.)

- [ ] **Step 2: Failing test for the summary helpers**

`__tests__/workflow-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatSeconds, runSummary } from '@/components/chat/message/workflow-summary'

describe('runSummary', () => {
	it('sums elapsed time and tokens over the nodes', () => {
		expect(
			runSummary({
				status: 'finished',
				nodes: [
					{ id: '1', nodeId: 'a', type: 'start', title: 'Start', status: 'success', elapsedTime: 0.25, totalTokens: 0 },
					{ id: '2', nodeId: 'b', type: 'llm', title: 'Answer', status: 'success', elapsedTime: 1.5, totalTokens: 42 },
					{ id: '3', nodeId: 'c', type: 'end', title: 'End', status: 'running' },
				],
			}),
		).toEqual({ nodes: 3, seconds: 1.75, tokens: 42 })
	})
})

describe('formatSeconds', () => {
	it('renders three decimals and nothing for a missing value', () => {
		expect(formatSeconds(0.4219)).toBe('0.422 s')
		expect(formatSeconds(undefined)).toBe('')
	})
})
```

Run → FAIL.

- [ ] **Step 3: Implement**

`components/chat/message/workflow-summary.ts`:

```ts
import type { WorkflowState } from '../provider/message'

export const runSummary = (workflow: WorkflowState) => ({
	nodes: workflow.nodes.length,
	seconds: Math.round(workflow.nodes.reduce((sum, n) => sum + (n.elapsedTime ?? 0), 0) * 1000) / 1000,
	tokens: workflow.nodes.reduce((sum, n) => sum + (n.totalTokens ?? 0), 0),
})

export const formatSeconds = (seconds?: number) => (seconds === undefined ? '' : `${seconds.toFixed(3)} s`)
```

`components/chat/message/workflow-node-icon.tsx`:

```tsx
import {
	ApiOutlined,
	AppstoreOutlined,
	BranchesOutlined,
	CodeOutlined,
	DatabaseOutlined,
	FlagOutlined,
	ForkOutlined,
	MergeCellsOutlined,
	MessageOutlined,
	PlayCircleOutlined,
	RetweetOutlined,
	RobotOutlined,
	ToolOutlined,
	UserOutlined,
} from '@ant-design/icons'

const ICONS: Record<string, React.ReactNode> = {
	start: <PlayCircleOutlined />,
	end: <FlagOutlined />,
	answer: <MessageOutlined />,
	llm: <RobotOutlined />,
	'knowledge-retrieval': <DatabaseOutlined />,
	'question-classifier': <BranchesOutlined />,
	'if-else': <ForkOutlined />,
	code: <CodeOutlined />,
	'http-request': <ApiOutlined />,
	tool: <ToolOutlined />,
	'human-input': <UserOutlined />,
	'variable-aggregator': <MergeCellsOutlined />,
	iteration: <RetweetOutlined />,
	loop: <RetweetOutlined />,
}

/** Dify node type → antd icon; unknown types get the generic app icon. */
export default function WorkflowNodeIcon({ type }: { type: string }) {
	return <>{ICONS[type] ?? <AppstoreOutlined />}</>
}
```

`components/chat/message/workflow-logs.module.css`:

```css
.root {
	margin-block: var(--ant-margin-xs);
}
.code {
	margin: 0;
	max-height: calc(var(--ant-control-height) * 8);
	overflow: auto;
	font-family: var(--ant-font-family-code);
	font-size: var(--ant-font-size-sm);
	background: var(--ant-color-fill-quaternary);
	padding: var(--ant-padding-xs);
	border-radius: var(--ant-border-radius);
	white-space: pre-wrap;
	word-break: break-word;
}
```

`components/chat/message/workflow-logs.tsx`:

```tsx
'use client'

import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, PauseCircleFilled, ReloadOutlined } from '@ant-design/icons'
import { Collapse, Descriptions, Flex, Tag, Typography, theme } from 'antd'
import { useTranslation } from 'react-i18next'

import type { WorkflowNode, WorkflowState } from '../provider/message'
import styles from './workflow-logs.module.css'
import WorkflowNodeIcon from './workflow-node-icon'
import { formatSeconds, runSummary } from './workflow-summary'

function StatusIcon({ status }: { status: WorkflowNode['status'] | WorkflowState['status'] }) {
	const { token } = theme.useToken()
	switch (status) {
		case 'running':
			return <LoadingOutlined spin />
		case 'retrying':
			return <ReloadOutlined spin style={{ color: token.colorWarning }} />
		case 'paused':
			return <PauseCircleFilled style={{ color: token.colorWarning }} />
		case 'success':
		case 'finished':
			return <CheckCircleFilled style={{ color: token.colorSuccess }} />
		case 'error':
		case 'failed':
			return <CloseCircleFilled style={{ color: token.colorError }} />
		default:
			return null
	}
}

const Json = ({ value }: { value: unknown }) => (
	<pre className={styles.code}>{typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}</pre>
)

/** Chatflow and workflow node logs: antd Collapse → Collapse → Descriptions, token-styled (spec §5.3). */
export default function WorkflowLogs({ workflow, defaultOpen = false }: { workflow?: WorkflowState; defaultOpen?: boolean }) {
	const { t } = useTranslation()
	if (!workflow?.nodes.length) return null
	const summary = runSummary(workflow)
	return (
		<Collapse
			size="small"
			className={styles.root}
			defaultActiveKey={defaultOpen || workflow.status === 'running' ? ['run'] : []}
			items={[
				{
					key: 'run',
					label: (
						<Flex gap="small" align="center" wrap>
							<StatusIcon status={workflow.status} />
							<Typography.Text strong>{t('workflow.title')}</Typography.Text>
							<Typography.Text type="secondary">
								{t('workflow.summary', { nodes: summary.nodes, seconds: summary.seconds.toFixed(2), tokens: summary.tokens })}
							</Typography.Text>
						</Flex>
					),
					children: (
						<Collapse
							size="small"
							ghost
							items={workflow.nodes.map(node => ({
								key: node.id,
								label: (
									<Flex gap="small" align="center" justify="space-between">
										<Flex gap="small" align="center" style={{ minWidth: 0 }}>
											<StatusIcon status={node.status} />
											<WorkflowNodeIcon type={node.type} />
											<Typography.Text ellipsis>{node.title}</Typography.Text>
											{node.retries ? <Tag>{t('workflow.retries', { times: node.retries })}</Tag> : null}
										</Flex>
										{node.status === 'success' && (
											<Typography.Text type="secondary">
												{formatSeconds(node.elapsedTime)}
												{node.totalTokens ? ` · ${node.totalTokens} tokens` : ''}
											</Typography.Text>
										)}
									</Flex>
								),
								children: (
									<Descriptions
										size="small"
										column={1}
										items={[
											{ key: 'input', label: t('workflow.input'), children: <Json value={node.inputs} /> },
											{ key: 'process', label: t('workflow.process'), children: <Json value={node.processData} /> },
											{ key: 'output', label: t('workflow.output'), children: <Json value={node.outputs} /> },
											...(node.error ? [{ key: 'error', label: t('workflow.error'), children: <Typography.Text type="danger">{node.error}</Typography.Text> }] : []),
										]}
									/>
								),
							}))}
						/>
					),
				},
			]}
		/>
	)
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run __tests__/workflow-summary.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat/message && pnpm test`
Expected: green (the component is exercised by the chatflow e2e in Task 12).

```bash
pnpm exec oxfmt --write components/chat/message __tests__/workflow-summary.test.ts locales
git add components/chat/message __tests__/workflow-summary.test.ts locales
git commit -m "feat(chat): WorkflowLogs on antd Collapse and Descriptions with token-coloured status icons" -m "Run header with status, node count, seconds and tokens; one collapsible panel per node with inputs, process data, outputs and error; retry count as a Tag; node type icons from @ant-design/icons. Replaces the Radix tree view and Lucide icons of the old logs." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 12: Assistant and user content — reasoning, agent thoughts, logs, files, citations, errors

**Spec:** §5.2 (Assistant content, User content, Error / aborted), §5.3 (MessageFiles).

**Files:**
- Create: `components/chat/message/use-think-timer.ts`, `components/chat/message/reasoning.tsx`, `components/chat/message/agent-thoughts.tsx`, `components/chat/message/message-sources.tsx`, `components/chat/message/message-files.tsx`, `components/chat/message/message-files.module.css`, `components/chat/chat-view/assistant-content.tsx`, `components/chat/chat-view/user-content.tsx`, `e2e/chat-agent.spec.ts`, `e2e/chat-chatflow.spec.ts`, `e2e/chat-errors.spec.ts`, `e2e/chat-files.spec.ts`
- Modify: `components/chat/message/markdown/think-block.tsx` (use the shared timer), `components/chat/chat-view/message-list.tsx` (user `contentRender`), `components/chat/chat-view/chat-view.tsx` (pass `renderAssistant`), `e2e/chat.spec.ts`, `locales/*`

**Interfaces:**
- Produces: `AssistantContent({ message, info, onSend, onResume? })` (`onResume` is wired in Task 13), `UserContent({ message })`, `Reasoning({ reasoning, done, streaming, messageId })`, `AgentThoughts({ thoughts, streaming })`, `MessageSources({ citations })`, `MessageFiles({ files })`, `useThinkTimer(storageKey, loading): number | undefined`.
- Consumes: `MessageMarkdown` (Task 4), `WorkflowLogs` (Task 11), `DifyChatMessage` (Task 6), `useAppContext()` (Task 9).

- [ ] **Step 1: Keys**

Under `message`: `image_alt` — en "Image from the answer" · zh "回答中的图片" · ar "صورة من الإجابة"; `files_title` — en "Files" · zh "文件" · ar "الملفات"; `reasoning_title` — en "Reasoning" · zh "推理过程" · ar "التفكير".

- [ ] **Step 2: Shared think timer and `Reasoning`**

`components/chat/message/use-think-timer.ts`:

```ts
'use client'

import { useEffect, useRef, useState } from 'react'

import { getThinkTime, setThinkTime } from '@/components/chat/persistence/think-time-storage'

/** Seconds a reasoning block has been (or was) open; persisted per storage key so reloads keep the final value. */
export const useThinkTimer = (storageKey: string, loading: boolean): number | undefined => {
	const startedAt = useRef(Date.now())
	const [elapsed, setElapsed] = useState<number | undefined>(() => (storageKey ? getThinkTime(storageKey) : undefined))
	useEffect(() => {
		if (!loading) {
			if (storageKey && getThinkTime(storageKey) === undefined) {
				const seconds = Math.round((Date.now() - startedAt.current) / 100) / 10
				setThinkTime(storageKey, seconds)
				setElapsed(seconds)
			}
			return
		}
		const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 100) / 10), 100)
		return () => clearInterval(timer)
	}, [loading, storageKey])
	return elapsed
}
```

Refactor `markdown/think-block.tsx` to call `useThinkTimer(storageKey, loading)` instead of its inline timer (same title logic).

`components/chat/message/reasoning.tsx` (X `Think`):

```tsx
'use client'

import { Think } from '@ant-design/x'
import { useTranslation } from 'react-i18next'

import { useThinkTimer } from './use-think-timer'

export default function Reasoning({ reasoning, done, streaming, messageId }: { reasoning: string; done: boolean; streaming: boolean; messageId?: string }) {
	const { t } = useTranslation()
	const loading = streaming && !done
	const elapsed = useThinkTimer(messageId ? `${messageId}_reasoning` : '', loading)
	const title = loading
		? t('message.think.in_progress', { seconds: (elapsed ?? 0).toFixed(1) })
		: elapsed !== undefined
			? t('message.think.done_with_time', { seconds: elapsed.toFixed(1) })
			: t('message.think.done')
	return (
		<Think title={title} loading={loading} blink={loading} defaultExpanded={loading}>
			{reasoning}
		</Think>
	)
}
```

- [ ] **Step 3: Agent thoughts, sources, files**

`components/chat/message/agent-thoughts.tsx` (X `ThoughtChain` items: `key`, `title`, `status`, `collapsible`, `content`, `blink`):

```tsx
'use client'

import { ThoughtChain } from '@ant-design/x'
import { Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import type { IAgentThought } from '@/lib/api'
import styles from './workflow-logs.module.css'

export default function AgentThoughts({ thoughts, streaming }: { thoughts?: IAgentThought[]; streaming: boolean }) {
	const { t } = useTranslation()
	const tools = (thoughts ?? []).filter(th => th.tool)
	if (!tools.length) return null
	return (
		<ThoughtChain
			items={tools.map((th, index) => {
				const last = index === tools.length - 1
				const running = streaming && last && !th.observation
				return {
					key: th.id ?? String(th.position),
					title: `${t('message.tool.title_prefix')} ${th.tool}`,
					status: running ? 'loading' : 'success',
					blink: running,
					collapsible: true,
					content: (
						<>
							<Typography.Text type="secondary">{t('message.tool.request')}</Typography.Text>
							<pre className={styles.code}>{th.tool_input}</pre>
							<Typography.Text type="secondary">{t('message.tool.response')}</Typography.Text>
							<pre className={styles.code}>{th.observation}</pre>
						</>
					),
				}
			})}
		/>
	)
}
```

`components/chat/message/message-sources.tsx` (X `Sources`):

```tsx
'use client'

import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'
import { Sources } from '@ant-design/x'
import { Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import type { IRetrieverResource } from '@/lib/api'

export default function MessageSources({ citations }: { citations?: IRetrieverResource[] }) {
	const { t } = useTranslation()
	if (!citations?.length) return null
	return (
		<Sources
			title={t('message.reference.title')}
			defaultExpanded={false}
			items={citations.map(c => ({
				key: c.id,
				icon: c.data_source_type === 'website_crawl' ? <GlobalOutlined /> : <FileTextOutlined />,
				title: `#${c.segment_position} ${c.document_name}`,
				description: (
					<>
						<Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{c.content}</Typography.Paragraph>
						<Space size={4} wrap>
							{c.score ? <Tag>{t('message.reference.score', { value: c.score.toFixed(2) })}</Tag> : null}
							{c.hit_count ? <Tag>{t('message.reference.hit_count', { value: c.hit_count })}</Tag> : null}
							{c.word_count ? <Tag>{t('message.reference.word_count', { value: c.word_count })}</Tag> : null}
						</Space>
					</>
				),
			}))}
		/>
	)
}
```

`components/chat/message/message-files.module.css`:

```css
.images {
	display: flex;
	flex-wrap: wrap;
	gap: var(--ant-margin-xs);
}
.image {
	width: calc(var(--ant-control-height) * 3);
	height: calc(var(--ant-control-height) * 3);
	object-fit: cover;
	border-radius: var(--ant-border-radius-lg);
}
```

`components/chat/message/message-files.tsx` (antd `Image.PreviewGroup`; X `FileCard` with `name`, `byte`, `type`, `src`, `onClick`):

```tsx
'use client'

import { FileCard } from '@ant-design/x'
import { Flex, Image } from 'antd'
import { useTranslation } from 'react-i18next'

import { completeFileUrl } from '@/components/chat/utils-index'

import { useAppContext } from '../app-context'
import type { MessageFile } from '../provider/message'
import styles from './message-files.module.css'

const filenameFromDisposition = (header: string | null, fallback: string) => {
	const match = header?.match(/filename\*=UTF-8''([^;\n]+)|filename="?([^";\n]+)"?/i)
	try {
		return match?.[1] ? decodeURIComponent(match[1]) : match?.[2] || fallback
	} catch {
		return fallback
	}
}

const saveBlob = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

export default function MessageFiles({ files }: { files?: MessageFile[] }) {
	const { t } = useTranslation()
	const { app, difyApi } = useAppContext()
	if (!files?.length) return null
	const withUrls = files.map(f => ({ ...f, url: completeFileUrl(f.url, app.requestConfig.apiBase) }))
	const images = withUrls.filter(f => f.type === 'image' && f.url)
	const others = withUrls.filter(f => !(f.type === 'image' && f.url))

	const download = async (file: MessageFile) => {
		if (file.belongsTo === 'assistant' || !file.uploadFileId) {
			window.open(file.url, '_blank', 'noreferrer')
			return
		}
		const response = (await difyApi.filePreview({ file_id: file.uploadFileId, as_attachment: true })) as Response
		saveBlob(await response.blob(), filenameFromDisposition(response.headers.get('content-disposition'), file.filename ?? 'download'))
	}

	return (
		<Flex vertical gap="small">
			{images.length > 0 && (
				<Image.PreviewGroup>
					<div className={styles.images}>
						{images.map(img => (
							<Image key={img.id} src={img.url} alt={img.filename || t('message.image_alt')} className={styles.image} />
						))}
					</div>
				</Image.PreviewGroup>
			)}
			{others.map(file => (
				<FileCard key={file.id} name={file.filename ?? file.id} byte={file.size} type={file.type} src={file.url} onClick={() => void download(file)} />
			))}
		</Flex>
	)
}
```

- [ ] **Step 4: Compose the bubbles**

`components/chat/chat-view/assistant-content.tsx`:

```tsx
'use client'

import { Alert, Flex, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import AgentThoughts from '../message/agent-thoughts'
import MessageFiles from '../message/message-files'
import MessageMarkdown from '../message/message-markdown'
import MessageSources from '../message/message-sources'
import Reasoning from '../message/reasoning'
import WorkflowLogs from '../message/workflow-logs'
import type { DifyChatMessage } from '../provider/message'

export interface BubbleInfo {
	status?: string
	key?: string | number
}

export interface AssistantContentProps {
	message: DifyChatMessage
	info: BubbleInfo
	onSend: (text: string) => void
	/** Rendered between the answer and the files (Task 13: the HITL form). */
	extra?: React.ReactNode
}

const hasNothingToShow = (m: DifyChatMessage) =>
	!m.content && !m.reasoning && !m.thoughts?.length && !m.workflow?.nodes.length && !m.files?.length && !m.citations?.length && !m.humanInput

/** Spec §5.2 "Assistant content": reasoning, tool calls, logs, Markdown, form, files, citations, in that order. */
export default function AssistantContent({ message, info, onSend, extra }: AssistantContentProps) {
	const { t } = useTranslation()
	const streaming = info.status === 'updating'
	if (message.error && !message.content) {
		return <Alert type="error" showIcon title={message.error.message} description={message.error.code} />
	}
	return (
		<Flex vertical gap="small">
			{message.reasoning && <Reasoning reasoning={message.reasoning} done={Boolean(message.reasoningDone) || !streaming} streaming={streaming} messageId={message.ids.messageId} />}
			<AgentThoughts thoughts={message.thoughts} streaming={streaming} />
			<WorkflowLogs workflow={message.workflow} />
			{message.content && <MessageMarkdown content={message.content} streaming={streaming} messageId={message.ids.messageId} onSend={onSend} />}
			{extra}
			{message.error && message.content && <Alert type="error" showIcon title={message.error.message} />}
			{message.aborted && <Typography.Text type="secondary">{t('chat.stopped')}</Typography.Text>}
			<MessageFiles files={message.files?.filter(f => f.belongsTo === 'assistant')} />
			<MessageSources citations={message.citations} />
			{info.status === 'success' && hasNothingToShow(message) && (
				<Alert type="warning" showIcon title={t('message.empty_content')} description={t('message.empty_content_hint')} />
			)}
		</Flex>
	)
}
```

`components/chat/chat-view/user-content.tsx`:

```tsx
'use client'

import { Flex, Typography } from 'antd'

import { useAppContext } from '../app-context'
import MessageFiles from '../message/message-files'
import type { DifyChatMessage } from '../provider/message'

/** A submitted answer form posts JSON; show the configured feedback text instead of the raw payload. */
const displayText = (content: string, feedbackText?: string, enabled?: boolean) => {
	if (!enabled || !feedbackText || !content.startsWith('{')) return content
	try {
		return (JSON.parse(content) as { isFormSubmit?: boolean }).isFormSubmit ? feedbackText : content
	} catch {
		return content
	}
}

export default function UserContent({ message }: { message: DifyChatMessage }) {
	const { app } = useAppContext()
	return (
		<Flex vertical gap="small">
			<MessageFiles files={message.files?.filter(f => f.belongsTo === 'user')} />
			<Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
				{displayText(message.content, app.answerForm?.feedbackText, app.answerForm?.enabled)}
			</Typography.Paragraph>
		</Flex>
	)
}
```

In `message-list.tsx`: user `contentRender: content => <UserContent message={content as DifyChatMessage} />`; in `chat-view.tsx` pass `renderAssistant={(message, info) => <AssistantContent message={message} info={info} onSend={text => void send(text)} />}`.

- [ ] **Step 5: Specs**

`e2e/chat-agent.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

test('an agent reply shows its tool call as a thought chain and the answer below', async ({ page }) => {
	await page.goto(`/chat/${APP_IDS['agent-chat']}`)
	await page.getByRole('textbox').first().fill('hello agent')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Echo: hello agent')).toBeVisible()
	const step = page.getByText('Used web_search')
	await expect(step).toBeVisible()
	await step.click()
	await expect(page.getByText('{"results":["one","two"]}')).toBeVisible()
})
```

`e2e/chat-chatflow.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

test.describe('chatflow', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_IDS['advanced-chat']}`)
		await expect(page.getByRole('textbox').first()).toBeVisible()
	})

	test('shows the workflow nodes, the reasoning block and the answer', async ({ page }) => {
		await page.getByRole('textbox').first().fill('hello flow')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: hello flow')).toBeVisible()
		await expect(page.getByText(/Finished thinking/)).toBeVisible()
		await page.getByText('Workflow', { exact: true }).click()
		await expect(page.getByText('Start', { exact: true })).toBeVisible()
		await expect(page.getByText('Answer', { exact: true })).toBeVisible()
		await page.getByText('Answer', { exact: true }).click()
		await expect(page.getByText('Output')).toBeVisible()
	})

	test('marks a retried node', async ({ page }) => {
		await page.getByRole('textbox').first().fill('retry once please')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: retry once please')).toBeVisible()
		await page.getByText('Workflow', { exact: true }).click()
		await expect(page.getByText('Retried 1×')).toBeVisible()
	})
})
```

`e2e/chat-errors.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

test.describe('errors and stopping', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_ID}`)
		await page.getByRole('button', { name: 'New conversation' }).first().click()
	})

	test('a stream error becomes an error bubble', async ({ page }) => {
		await page.getByRole('textbox').first().fill('cause an error')
		await page.keyboard.press('Enter')
		await expect(page.locator('.ant-alert-error').getByText('The model is unavailable.')).toBeVisible()
	})

	test('stopping keeps the partial answer and marks it stopped', async ({ page }) => {
		await page.getByRole('textbox').first().fill('slow reply')
		await page.keyboard.press('Enter')
		await expect(page.getByText(/^0 1 2/)).toBeVisible()
		// X Sender's loading button is named through the X locale (Sender.stopLoading).
		await page.getByRole('button', { name: 'Stop loading' }).click()
		await expect(page.getByText('Stopped')).toBeVisible()
		await expect(page.getByText('39')).toHaveCount(0)
	})
})
```

`e2e/chat-files.spec.ts` (first part; the upload flow is appended in Task 15):

```ts
import { expect, test } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

test('an image the assistant produced renders with a preview', async ({ page }) => {
	await page.goto(`/chat/${APP_IDS['agent-chat']}`)
	await page.getByRole('textbox').first().fill('send files please')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Echo: send files please')).toBeVisible()
	const image = page.locator('.ant-bubble .ant-image img').first()
	await expect(image).toBeVisible()
	await image.click()
	await expect(page.locator('.ant-image-preview-img')).toBeVisible()
	await page.keyboard.press('Escape')
})
```

Append to `e2e/chat.spec.ts`:

```ts
	test('citations are listed under the answer', async ({ page }) => {
		await page.getByRole('textbox').first().fill('cite the handbook')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: cite the handbook')).toBeVisible()
		await page.getByText('Citations').click()
		await expect(page.getByText('handbook-1.md')).toBeVisible()
		await expect(page.getByText('Tea is brewed at 80 °C.')).toBeVisible()
	})
```

- [ ] **Step 6: Run and commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm test && pnpm exec playwright test e2e/chat.spec.ts e2e/chat-agent.spec.ts e2e/chat-chatflow.spec.ts e2e/chat-errors.spec.ts e2e/chat-files.spec.ts`
Expected: green on the three projects. Adjust text locators to X's rendered DOM if a title is split across elements, never the behaviour.

```bash
pnpm exec oxfmt --write components/chat e2e locales
git add components/chat e2e locales
git commit -m "feat(chat): assistant content on Think, ThoughtChain, WorkflowLogs, Sources and FileCard; user bubbles with files" -m "contentRender composes reasoning (reasoning_chunk and <think> share one timer), agent tool calls, node logs, Markdown, files (antd Image preview, X FileCard with proxy download) and citations; stream errors and stopped replies render inside the bubble. Specs cover agent, chatflow (incl. retry), errors, abort and assistant images." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 13: Human-in-the-loop form and continuation

**Spec:** §4.6, §5.3 (HumanInputForm), Review Focus 5.

**Files:**
- Create: `components/chat/message/human-input-phase.ts`, `components/chat/message/human-input-form.tsx`, `__tests__/human-input-phase.test.ts`, `e2e/chat-hitl.spec.ts`
- Modify: `components/chat/chat-view/assistant-content.tsx` (renders the form via `extra`), `components/chat/chat-view/chat-view.tsx` (submit + resume), `locales/*`

**Interfaces:**
- Produces: `humanInputPhase(humanInput, nowSeconds): 'pending' | 'filled' | 'expired'`; `HumanInputForm({ humanInput, submitting, onSubmit(inputs, actionId) })`.
- Consumes: `useDifyChat().resume(assistantId, workflowRunId, message)` (Task 8), `difyApi.submitHumanInput(formToken, { inputs, action, user })` (existing client), `userId` from `useAppContext()`.

- [ ] **Step 1: Keys**

Under `hitl`: `submitted` — en "Submitted: {{action}}" · zh "已提交：{{action}}" · ar "تم الإرسال: {{action}}"; `expired_hint` — en "This form can no longer be submitted." · zh "此表单已无法提交。" · ar "لم يعد بالإمكان إرسال هذا النموذج."; `field_required` — en "Required" · zh "必填" · ar "مطلوب".

- [ ] **Step 2: Failing phase test (Review Focus 5)**

`__tests__/human-input-phase.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { humanInputPhase } from '@/components/chat/message/human-input-phase'
import type { HumanInputState } from '@/components/chat/provider/message'

const base: HumanInputState = { state: 'pending', formToken: 'ft', formContent: 'Review', inputs: [], actions: [], defaults: {}, expiresAt: 2_000, workflowRunId: 'run' }

describe('humanInputPhase', () => {
	it('is pending before expiry', () => expect(humanInputPhase(base, 1_000)).toBe('pending'))
	it('is expired once the expiry time has passed, even if the event still says pending', () => expect(humanInputPhase(base, 2_001)).toBe('expired'))
	it('is filled or expired when the stream said so, whatever the clock says', () => {
		expect(humanInputPhase({ ...base, state: 'filled' }, 9_999)).toBe('filled')
		expect(humanInputPhase({ ...base, state: 'expired' }, 0)).toBe('expired')
	})
})
```

Run → FAIL.

- [ ] **Step 3: Implement**

`components/chat/message/human-input-phase.ts`:

```ts
import type { HumanInputState } from '../provider/message'

/** The form's effective state: the stream's word wins; otherwise the clock decides (spec §4.6 step 5). */
export const humanInputPhase = (humanInput: HumanInputState, nowSeconds: number): HumanInputState['state'] => {
	if (humanInput.state !== 'pending') return humanInput.state
	return humanInput.expiresAt > 0 && nowSeconds >= humanInput.expiresAt ? 'expired' : 'pending'
}
```

`components/chat/message/human-input-form.tsx` (antd `Form`, `Statistic.Timer` — antd 6 deprecates `Statistic.Countdown` in favour of `Statistic.Timer`; confirm its props with `antd info Statistic --format json` before writing):

```tsx
'use client'

import { Alert, Button, Flex, Form, Input, Select, Statistic, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import FileUpload from '@/components/chat/chatbox/form-controls/file-upload'

import type { HumanInputState } from '../provider/message'
import { humanInputPhase } from './human-input-phase'
import MessageMarkdown from './message-markdown'

export interface HumanInputFormProps {
	humanInput: HumanInputState
	submitting: boolean
	onSubmit: (inputs: Record<string, string>, actionId: string) => Promise<void>
}

/** Dify's Human Input node form inside the bubble flow, on antd primitives (spec §5.3). */
export default function HumanInputForm({ humanInput, submitting, onSubmit }: HumanInputFormProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [form] = Form.useForm<Record<string, string>>()
	const [expiredNow, setExpiredNow] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const phase = expiredNow ? 'expired' : humanInputPhase(humanInput, Math.floor(Date.now() / 1000))
	const disabled = phase !== 'pending' || submitting

	const submit = async (actionId: string) => {
		try {
			const values = await form.validateFields()
			setError(null)
			await onSubmit(values, actionId)
		} catch (e) {
			if ((e as { errorFields?: unknown }).errorFields) return
			setError((e as Error).message || t('hitl.submit_failed'))
		}
	}

	return (
		<Flex
			vertical
			gap="small"
			style={{ border: `${token.lineWidth}px ${token.lineType} ${token.colorWarningBorder}`, background: token.colorWarningBg, borderRadius: token.borderRadiusLG, padding: token.padding }}
		>
			<Flex justify="space-between" align="center" wrap gap="small">
				<Typography.Text strong>{t('hitl.title')}</Typography.Text>
				{phase === 'pending' && (
					<Statistic.Timer type="countdown" value={humanInput.expiresAt * 1000} format="HH:mm:ss" valueStyle={{ fontSize: token.fontSize }} onFinish={() => setExpiredNow(true)} />
				)}
			</Flex>
			{phase === 'filled' ? (
				<>
					<MessageMarkdown content={humanInput.renderedContent ?? humanInput.formContent} />
					<Typography.Text type="secondary">{t('hitl.submitted', { action: humanInput.actionText ?? '' })}</Typography.Text>
				</>
			) : (
				<>
					<MessageMarkdown content={humanInput.formContent} />
					<Form form={form} layout="vertical" size="small" initialValues={humanInput.defaults} disabled={disabled}>
						{humanInput.inputs.map(field => (
							<Form.Item key={field.output_variable_name} name={field.output_variable_name} label={field.output_variable_name} rules={[{ required: true, message: t('hitl.field_required') }]}>
								{field.type === 'select' ? (
									<Select options={(field.option_source?.value ?? []).map(v => ({ value: v, label: v }))} />
								) : field.type === 'file' ? (
									<FileUpload mode="single" allowed_file_types={[]} />
								) : field.type === 'file-list' ? (
									<FileUpload allowed_file_types={[]} />
								) : (
									<Input.TextArea rows={3} />
								)}
							</Form.Item>
						))}
					</Form>
					{phase === 'expired' && <Alert type="warning" showIcon title={t('hitl.expired')} description={t('hitl.expired_hint')} />}
					{error && <Alert type="error" showIcon title={error} />}
					<Flex gap="small" wrap>
						{humanInput.actions.map(action => (
							<Button key={action.id} type={action.button_style === 'primary' ? 'primary' : 'default'} loading={submitting} disabled={disabled} onClick={() => void submit(action.id)}>
								{action.title}
							</Button>
						))}
					</Flex>
				</>
			)}
		</Flex>
	)
}
```

Wire it: in `chat-view.tsx`, `const [hitlSubmitting, setHitlSubmitting] = useState(false)` and

```tsx
const submitHumanInput = async (key: string | number, message: DifyChatMessage, inputs: Record<string, string>, actionId: string) => {
	if (!message.humanInput) return
	setHitlSubmitting(true)
	try {
		await difyApi.submitHumanInput(message.humanInput.formToken, { inputs, action: actionId, user: userId })
		chat.resume(key, message.humanInput.workflowRunId, message)
	} finally {
		setHitlSubmitting(false)
	}
}
```

and pass to `AssistantContent` as `extra={message.humanInput ? <HumanInputForm humanInput={message.humanInput} submitting={hitlSubmitting} onSubmit={(inputs, action) => submitHumanInput(info.key!, message, inputs, action)} /> : undefined}`. Toast failures with `App.useApp().message.error(t('hitl.submit_failed'))`.

- [ ] **Step 4: Spec**

`e2e/chat-hitl.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

test('a paused chatflow shows the human input form; submitting it continues the answer in the same bubble', async ({ page }) => {
	await page.goto(`/chat/${APP_IDS['advanced-chat']}`)
	await page.getByRole('textbox').first().fill('please hitl this one')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Please review the draft and approve it or request changes.')).toBeVisible()
	await page.getByLabel('feedback').fill('Looks good')
	await page.getByRole('button', { name: 'Approve' }).click()
	await expect(page.getByText('Approved: Looks good')).toBeVisible()
	await expect(page.getByText('Submitted: Approve')).toBeVisible()
	await expect(page.locator('.ant-bubble').filter({ hasText: 'Approved: Looks good' })).toHaveCount(1)
})
```

Run: `pnpm exec vitest run __tests__/human-input-phase.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm exec playwright test e2e/chat-hitl.spec.ts e2e/chat-chatflow.spec.ts`
Expected: green. The last assertion proves the continuation extended the paused message instead of adding a second assistant bubble.

- [ ] **Step 5: Commit**

```bash
pnpm exec oxfmt --write components/chat e2e/chat-hitl.spec.ts __tests__/human-input-phase.test.ts locales
git add components/chat e2e/chat-hitl.spec.ts __tests__/human-input-phase.test.ts locales
git commit -m "feat(chat): human-in-the-loop form on antd Form with countdown, and the continuation through onReload" -m "The form renders from human_input_required (paragraph, select, file, file-list), shows a Statistic.Timer countdown, the expired and filled states, and the action buttons by style. Submitting posts to the existing proxy route and resumes the stream with useXChat's onReload; the provider extends the paused message, so live and history views match." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 14: Message footer — copy, regenerate, feedback, annotation, text-to-speech

**Spec:** §5.2 (Footer), §4.7 (feedback, annotation, TTS, regenerate), §10 (PR #7/#8 requirements).

**Files:**
- Create: `components/chat/chat-view/message-footer.tsx`, `components/chat/chat-view/dislike-popover.tsx`, `components/chat/chat-view/annotation-drawer.tsx`, `components/chat/hooks/use-tts.ts`, `e2e/chat-feedback.spec.ts`
- Modify: `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/message-list.tsx`, `e2e/chat.spec.ts`, `locales/*`

**Interfaces:**
- Produces: `MessageFooter({ message, info, previousUser?, onRegenerate(previousUser), onFeedback(rating, reason?), onAnnotate() })`, `useTts(difyApi)` → `{ status: 'default' | 'loading' | 'running' | 'error', toggle(text) }`, `DislikePopover({ open, onSubmit(reason), onCancel, children })`, `AnnotationDrawer({ open, question, answer, onClose })`.
- Consumes: `chat.setMessage` (feedback optimistic update), `send` (regenerate), `difyApi.createMessageFeedback`, `difyApi.text2Audio`, `difyApi.createAnnotation`, `formatDateTime` from `@/libs/format-date`.

- [ ] **Step 1: Keys**

Under `message`: `dislike_reason` — en "What was wrong? (optional)" · zh "哪里不对？（可选）" · ar "ما الخطأ؟ (اختياري)"; `send_feedback` — en "Send feedback" · zh "发送反馈" · ar "إرسال الملاحظات".

- [ ] **Step 2: TTS hook**

`components/chat/hooks/use-tts.ts`:

```ts
'use client'

import { useCallback, useRef, useState } from 'react'

import type { DifyApi } from '@/lib/dify-client'

export type TtsStatus = 'default' | 'loading' | 'running' | 'error'

/** Text-to-speech through POST /text2audio; status feeds X's Actions.Audio (spec §4.7). */
export const useTts = (difyApi: DifyApi) => {
	const [status, setStatus] = useState<TtsStatus>('default')
	const audio = useRef<HTMLAudioElement | null>(null)
	const toggle = useCallback(
		async (text: string) => {
			if (status === 'running') {
				audio.current?.pause()
				setStatus('default')
				return
			}
			setStatus('loading')
			try {
				const response = (await difyApi.text2Audio({ text })) as Response
				const url = URL.createObjectURL(await response.blob())
				const element = new Audio(url)
				audio.current = element
				element.onended = () => {
					URL.revokeObjectURL(url)
					setStatus('default')
				}
				await element.play()
				setStatus('running')
			} catch {
				setStatus('error')
			}
		},
		[difyApi, status],
	)
	return { status, toggle }
}
```

- [ ] **Step 3: Popover, drawer and footer**

`components/chat/chat-view/dislike-popover.tsx`:

```tsx
'use client'

import { Button, Flex, Input, Popover } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function DislikePopover({ open, onSubmit, onCancel, children }: { open: boolean; onSubmit: (reason: string) => void; onCancel: () => void; children: React.ReactNode }) {
	const { t } = useTranslation()
	const [reason, setReason] = useState('')
	return (
		<Popover
			open={open}
			trigger={[]}
			onOpenChange={visible => !visible && onCancel()}
			content={
				<Flex vertical gap="small">
					<Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('message.dislike_reason')} aria-label={t('message.dislike_reason')} />
					<Flex gap="small" justify="flex-end">
						<Button size="small" onClick={onCancel}>
							{t('common.cancel')}
						</Button>
						<Button size="small" type="primary" onClick={() => onSubmit(reason)}>
							{t('message.send_feedback')}
						</Button>
					</Flex>
				</Flex>
			}
		>
			{children}
		</Popover>
	)
}
```

`components/chat/chat-view/annotation-drawer.tsx`:

```tsx
'use client'

import { App, Button, Drawer, Form, Input, Space } from 'antd'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'

export default function AnnotationDrawer({ open, question, answer, onClose }: { open: boolean; question: string; answer: string; onClose: () => void }) {
	const { t } = useTranslation()
	const { difyApi } = useAppContext()
	const { message } = App.useApp()
	const [form] = Form.useForm<{ question: string; answer: string }>()
	const save = async () => {
		const values = await form.validateFields()
		await difyApi.createAnnotation(values)
		message.success(t('annotation.create_success'))
		onClose()
	}
	return (
		<Drawer
			open={open}
			onClose={onClose}
			title={t('annotation.create_title')}
			destroyOnHidden
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button type="primary" onClick={() => void save()}>
						{t('common.confirm')}
					</Button>
				</Space>
			}
		>
			<Form form={form} layout="vertical" initialValues={{ question, answer }}>
				<Form.Item name="question" label={t('annotation.question')} rules={[{ required: true, message: t('annotation.question_required') }]}>
					<Input.TextArea rows={4} />
				</Form.Item>
				<Form.Item name="answer" label={t('annotation.answer')} rules={[{ required: true, message: t('annotation.answer_required') }]}>
					<Input.TextArea rows={10} />
				</Form.Item>
			</Form>
		</Drawer>
	)
}
```

`components/chat/chat-view/message-footer.tsx` (X `Actions` with `Actions.Copy`, `Actions.Feedback` (`styles.liked`), `Actions.Audio`; custom items through `actionRender` so every icon button has an i18n name, ADR-0014):

```tsx
'use client'

import { EditOutlined, RedoOutlined } from '@ant-design/icons'
import { Actions } from '@ant-design/x'
import { Button, Flex, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '@/libs/format-date'

import { useAppContext } from '../app-context'
import { useTts } from '../hooks/use-tts'
import type { DifyChatMessage } from '../provider/message'
import AnnotationDrawer from './annotation-drawer'
import type { BubbleInfo } from './assistant-content'
import DislikePopover from './dislike-popover'

export interface MessageFooterProps {
	message: DifyChatMessage
	info: BubbleInfo
	/** The user turn this answer replies to (regenerate re-sends it). */
	previousUser?: DifyChatMessage
	onRegenerate: (previousUser: DifyChatMessage) => void
	onFeedback: (rating: 'like' | 'dislike' | null, reason?: string) => Promise<void>
}

export default function MessageFooter({ message, info, previousUser, onRegenerate, onFeedback }: MessageFooterProps) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { app, parameters, difyApi } = useAppContext()
	const tts = useTts(difyApi)
	const [dislikeOpen, setDislikeOpen] = useState(false)
	const [annotating, setAnnotating] = useState(false)
	if (message.role !== 'assistant' || info.status === 'loading' || info.status === 'updating') return null
	const canFeedback = Boolean(message.ids.messageId) && !message.error
	const feedbackValue = message.feedback ?? 'default'

	const items = [
		...(previousUser
			? [{ key: 'regenerate', actionRender: () => <Button type="text" size="small" icon={<RedoOutlined />} aria-label={t('message.action_regenerate')} title={t('message.action_regenerate')} onClick={() => onRegenerate(previousUser)} /> }]
			: []),
		{ key: 'copy', actionRender: () => <Actions.Copy text={message.content} /> },
		...(app.extConfig?.annotation?.enabled
			? [{ key: 'annotate', actionRender: () => <Button type="text" size="small" icon={<EditOutlined />} aria-label={t('message.annotation')} title={t('message.annotation')} onClick={() => setAnnotating(true)} /> }]
			: []),
		...(canFeedback
			? [
					{
						key: 'feedback',
						actionRender: () => (
							<DislikePopover open={dislikeOpen} onCancel={() => setDislikeOpen(false)} onSubmit={reason => { setDislikeOpen(false); void onFeedback('dislike', reason) }}>
								<Actions.Feedback
									value={feedbackValue}
									styles={{ liked: { color: token.colorSuccess } }}
									onChange={value => {
										if (value === 'dislike') setDislikeOpen(true)
										else void onFeedback(value === 'like' ? 'like' : null)
									}}
								/>
							</DislikePopover>
						),
					},
				]
			: []),
		...(parameters.text_to_speech?.enabled ? [{ key: 'tts', actionRender: () => <Actions.Audio status={tts.status} />, onItemClick: () => void tts.toggle(message.content) }] : []),
	]

	return (
		<Flex align="center" gap="small" wrap>
			<Actions items={items} variant="borderless" />
			{message.createdAt && (
				<Typography.Text type="secondary">
					{t('message.response_time')} {formatDateTime(message.createdAt * 1000, i18n.resolvedLanguage)}
				</Typography.Text>
			)}
			<AnnotationDrawer open={annotating} question={previousUser?.content ?? ''} answer={message.content} onClose={() => setAnnotating(false)} />
		</Flex>
	)
}
```

If `Actions` does not forward `onItemClick` to an `actionRender` item, wrap `Actions.Audio` in a `Button type="text" size="small" aria-label={t('message.tts')} onClick` instead and note it. Check `formatDateTime`'s signature in `libs/format-date.ts` before use.

Wire in `chat-view.tsx`:

```tsx
const feedback = async (key: string | number, message: DifyChatMessage, rating: 'like' | 'dislike' | null, reason?: string) => {
	await difyApi.createMessageFeedback({ messageId: message.ids.messageId!, rating, content: reason ?? '' })
	chat.setMessage(key, prev => ({ message: { ...prev.message, feedback: rating } }))
	toast.success(t('common.operation_success'))
}
const previousUserOf = (key: string | number) => {
	const index = chat.messages.findIndex(m => m.id === key)
	return [...chat.messages.slice(0, index)].reverse().find(m => m.message.role === 'user')?.message
}
…
<MessageList … renderFooter={(message, info) => (
	<MessageFooter message={message} info={info} previousUser={previousUserOf(info.key!)} onRegenerate={prev => void send(prev.content, { inputs: prev.inputs ?? {}, files: prev.files?.map(f => ({ type: f.type, transfer_method: 'local_file', upload_file_id: f.uploadFileId })) as IFile[] })} onFeedback={(rating, reason) => feedback(info.key!, message, rating, reason)} />
)} />
```

- [ ] **Step 4: Specs**

`e2e/chat-feedback.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

// antd tokens: colorSuccess #52c41a (light) / #49aa19 (dark); colorError #ff4d4f (light) / #dc4446 (dark).
const success = (dark: boolean) => (dark ? 'rgb(73, 170, 25)' : 'rgb(82, 196, 26)')
const error = (dark: boolean) => (dark ? 'rgb(220, 68, 70)' : 'rgb(255, 77, 79)')

test.describe('feedback', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_ID}`)
		await page.getByRole('button', { name: 'New conversation' }).first().click()
		await page.getByRole('textbox').first().fill('rate me')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: rate me')).toBeVisible()
	})

	test('a like turns green and survives a reload', async ({ page }, testInfo) => {
		const dark = testInfo.project.use.colorScheme === 'dark'
		await page.getByRole('button', { name: 'Like' }).click()
		await expect(page.locator('.ant-actions-feedback-liked, [class*="feedback-liked"]').first()).toHaveCSS('color', success(dark))
		await page.reload()
		await expect(page.getByText('Echo: rate me')).toBeVisible()
		await expect(page.locator('.ant-actions-feedback-liked, [class*="feedback-liked"]').first()).toHaveCSS('color', success(dark))
	})

	test('a dislike asks for a reason and turns red', async ({ page }, testInfo) => {
		const dark = testInfo.project.use.colorScheme === 'dark'
		await page.getByRole('button', { name: 'Dislike' }).click()
		await page.getByLabel('What was wrong? (optional)').fill('Too short')
		await page.getByRole('button', { name: 'Send feedback' }).click()
		await expect(page.locator('.ant-actions-feedback-disliked, [class*="feedback-disliked"]').first()).toHaveCSS('color', error(dark))
	})

	test('no actions show while a reply is still streaming', async ({ page }) => {
		await page.getByRole('textbox').first().fill('slow one')
		await page.keyboard.press('Enter')
		await expect(page.getByText(/^0 1 2/)).toBeVisible()
		await expect(page.locator('.ant-bubble').last().locator('.ant-actions')).toHaveCount(0)
	})
})
```

Append to `e2e/chat.spec.ts`:

```ts
	test('regenerate re-sends the question as a new turn and copy puts the answer on the clipboard', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		await page.getByRole('textbox').first().fill('again please')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: again please')).toBeVisible()
		await page.getByRole('button', { name: 'Regenerate' }).last().click()
		await expect(page.getByText('Echo: again please')).toHaveCount(2)
		await page.locator('.ant-bubble').last().getByRole('button', { name: 'Copy' }).click()
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Echo: again please')
	})
```

The names "Like", "Dislike", "Copy" come from X's `en_US` locale (`Actions.feedbackLike`, `Actions.feedbackDislike`; `Actions.Copy` uses antd's `Typography.copy` text); "Regenerate" is the fork's `message.action_regenerate`. Confirm the exact rendered names with a trace once and adjust the regex, never the behaviour.

- [ ] **Step 5: Run and commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm test && pnpm exec playwright test e2e/chat.spec.ts e2e/chat-feedback.spec.ts`
Expected: green.

```bash
pnpm exec oxfmt --write components/chat e2e locales
git add components/chat e2e locales
git commit -m "feat(chat): message actions with X Actions — copy, regenerate, feedback with reason, annotation, text-to-speech" -m "Actions.Copy, Actions.Feedback (like coloured with colorSuccess through the liked slot, dislike opens a reason popover) and Actions.Audio for TTS, plus regenerate and annotate as named icon buttons, and the creation time from StreamEventBase. Feedback posts the Dify message id and is hidden without one; the footer is hidden while a reply streams. Carries the behaviour of PRs #7 and #8." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---
### Task 15: Sender attachments, paste, speech to text

**Spec:** §5.2 (Sender), §4.7 (files in, speech to text).

**Files:**
- Move: `components/chat/message-sender/utils.ts` → `components/chat/chat-view/file-types.ts`; `components/chat/chatbox/form-controls/file-upload.tsx` → `components/chat/chat-view/file-upload.tsx`
- Create: `components/chat/hooks/use-speech-to-text.ts`, `components/chat/chat-view/sender-attachments.tsx`
- Modify: `components/chat/chat-view/chat-sender.tsx`, `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/inputs-form.tsx`, `components/chat/message/human-input-form.tsx` (import paths), `e2e/chat-files.spec.ts`, `locales/*`

**Interfaces:**
- Produces: `useSenderAttachments({ enabled })` → `{ header, prefix, onPasteFile, files: IFile[], ready: boolean, reset() }` (the `Sender.Header` with `Attachments`, the prefix button, the paste handler and the uploaded files mapped to Dify's `IFile[]`); `useSpeechToText({ enabled, onText })` → `SenderProps['allowSpeech']`.
- `FileUpload` keeps its props but reads `useAppContext()` for the Dify client and the API base.

- [ ] **Step 1: Keys**

Under `sender`: `attach` — en "Attach files" · zh "添加附件" · ar "إرفاق ملفات"; `too_many_files` — en "At most {{limit}} files" · zh "最多 {{limit}} 个文件" · ar "بحد أقصى {{limit}} ملفات".

- [ ] **Step 2: Move and adapt the file helpers**

`git mv components/chat/message-sender/utils.ts components/chat/chat-view/file-types.ts` and `git mv components/chat/chatbox/form-controls/file-upload.tsx components/chat/chat-view/file-upload.tsx`. In `file-upload.tsx`: replace the two store reads with `const { difyApi, app } = useAppContext()` (API base `app.requestConfig.apiBase`), fix the import of the helpers to `./file-types`, replace the Tailwind class on the `Upload` button with nothing (antd `Button` is styled already). Update the imports in `inputs-form.tsx` and `human-input-form.tsx`. Leave the old `message-sender/index.tsx` importing `'./utils'` broken? No: update its import to `'../chat-view/file-types'` so the tree compiles until Task 19 deletes it.

- [ ] **Step 3: Attachments hook (X `Sender.Header` + `Attachments`; antd `Upload.customRequest`)**

`components/chat/chat-view/sender-attachments.tsx`:

```tsx
'use client'

import { CloudUploadOutlined, LinkOutlined } from '@ant-design/icons'
import { Attachments, Sender, type AttachmentsProps } from '@ant-design/x'
import { App, Badge, Button, type GetProp, type GetRef } from 'antd'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IFile } from '@/lib/api'

import { useAppContext } from '../app-context'
import { FileTypeMap, getDifyFileType, getFileExtByName } from './file-types'

type Item = GetProp<AttachmentsProps, 'items'>[number] & { response?: { id: string } }

/** Files for the next message: upload through the Dify proxy, list in Sender.Header, map to IFile[] on send (spec §4.7). */
export const useSenderAttachments = ({ enabled }: { enabled: boolean }) => {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { difyApi, parameters } = useAppContext()
	const [open, setOpen] = useState(false)
	const [items, setItems] = useState<Item[]>([])
	const ref = useRef<GetRef<typeof Attachments>>(null)
	const limit = parameters.file_upload?.number_limits ?? 1

	const allowedExtensions = useMemo(() => {
		const fromTypes = (parameters.file_upload?.allowed_file_types ?? []).flatMap(type => FileTypeMap.get(type) ?? [])
		const fromList = (parameters.file_upload?.allowed_file_extensions ?? []).map(ext => ext.replace(/^\./, '').toLowerCase())
		return new Set([...fromTypes, ...fromList])
	}, [parameters.file_upload])

	const beforeUpload: AttachmentsProps['beforeUpload'] = file => {
		const ext = (getFileExtByName(file.name) ?? '').toLowerCase()
		if (allowedExtensions.size && !allowedExtensions.has(ext)) {
			message.error(t('common.unsupported_file_type', { ext }))
			return Attachments.LIST_IGNORE ?? false
		}
		if (items.length >= limit) {
			message.error(t('sender.too_many_files', { limit }))
			return false
		}
		return true
	}

	// antd Upload's customRequest: we upload ourselves and report success/error back to the list.
	const customRequest: AttachmentsProps['customRequest'] = async ({ file, onSuccess, onError }) => {
		try {
			const result = await difyApi.uploadFile(file as File)
			onSuccess?.(result)
		} catch (error) {
			onError?.(error as Error)
		}
	}

	const header = enabled ? (
		<Sender.Header title={t('sender.upload_file')} open={open} onOpenChange={setOpen} styles={{ content: { padding: 0 } }}>
			<Attachments
				ref={ref}
				items={items}
				maxCount={limit}
				beforeUpload={beforeUpload}
				customRequest={customRequest}
				onChange={({ fileList }) => setItems(fileList as Item[])}
				placeholder={type => (type === 'drop' ? { title: t('sender.upload_hint') } : { icon: <CloudUploadOutlined />, title: t('sender.upload_hint'), description: t('sender.supported_types', { types: [...allowedExtensions].join(', ') }) })}
			/>
		</Sender.Header>
	) : undefined

	const prefix = enabled ? (
		<Badge dot={items.length > 0 && !open}>
			<Button type="text" icon={<LinkOutlined />} aria-label={t('sender.attach')} title={t('sender.attach')} onClick={() => setOpen(v => !v)} />
		</Badge>
	) : undefined

	const onPasteFile = useCallback(
		(files: FileList) => {
			if (!enabled) return
			setOpen(true)
			for (const file of Array.from(files)) ref.current?.upload(file)
		},
		[enabled],
	)

	const files: IFile[] = items
		.filter(item => item.status === 'done' && item.response?.id)
		.map(item => ({ type: getDifyFileType(item.name, parameters.file_upload?.allowed_file_types ?? []), transfer_method: 'local_file', upload_file_id: item.response!.id }))

	return {
		header,
		prefix,
		onPasteFile,
		files,
		ready: items.every(item => item.status === 'done'),
		reset: () => {
			setItems([])
			setOpen(false)
		},
	}
}
```

`Attachments.LIST_IGNORE` is antd `Upload.LIST_IGNORE` re-exported; if X does not expose it, use `Upload.LIST_IGNORE` from antd.

- [ ] **Step 4: Speech-to-text hook (X `Sender.allowSpeech` as `SpeechConfig`)**

`components/chat/hooks/use-speech-to-text.ts`:

```ts
'use client'

import type { SenderProps } from '@ant-design/x'
import { App } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'

/** Record with MediaRecorder, transcribe through POST /audio2text, hand the text to the sender (spec §4.7). */
export const useSpeechToText = ({ enabled, onText }: { enabled: boolean; onText: (text: string) => void }): SenderProps['allowSpeech'] => {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { difyApi } = useAppContext()
	const [recording, setRecording] = useState(false)
	const recorder = useRef<MediaRecorder | null>(null)
	const chunks = useRef<Blob[]>([])
	if (!enabled) return false
	return {
		recording,
		onRecordingChange: async next => {
			if (next) {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
					recorder.current = new MediaRecorder(stream)
					chunks.current = []
					recorder.current.ondataavailable = e => e.data.size && chunks.current.push(e.data)
					recorder.current.onstop = async () => {
						stream.getTracks().forEach(track => track.stop())
						try {
							const result = (await difyApi.audio2Text(new File(chunks.current, 'speech.webm', { type: 'audio/webm' }))) as { text: string }
							onText(result.text)
						} catch (error) {
							message.error(t('sender.speech_to_text_error', { error }))
						}
					}
					recorder.current.start()
					setRecording(true)
				} catch (error) {
					message.error(t('sender.speech_to_text_error', { error }))
				}
			} else {
				recorder.current?.stop()
				setRecording(false)
			}
		},
	}
}
```

- [ ] **Step 5: Wire into the sender and the view**

`ChatSender` gets `allowSpeech`, `header`, `prefix`, `onPasteFile` from the view and an `onValueInsert` ref (`senderRef.current?.insert(text)` is X's documented ref method for inserting text, used for the transcription). In `chat-view.tsx`:

```tsx
const attachments = useSenderAttachments({ enabled: Boolean(parameters.file_upload?.enabled) })
const allowSpeech = useSpeechToText({ enabled: Boolean(parameters.speech_to_text?.enabled), onText: text => senderRef.current?.insert(text) })
…
const send = async (text: string, extra: Partial<SendParams> = {}) => {
	if (!attachments.ready) { toast.error(t('sender.wait_for_uploads')); return false }
	try { await inputsForm.validateFields() } catch { toast.error(t('chat.inputs_required')); return false }
	chat.send({ query: text, inputs: inputsForm.getFieldsValue(true), files: extra.files ?? attachments.files })
	attachments.reset()
	suggestions.clear()
	return true
}
…
<ChatSender … header={attachments.header} prefix={attachments.prefix} onPasteFile={attachments.onPasteFile} allowSpeech={allowSpeech} />
```

- [ ] **Step 6: Upload flow spec**

Append to `e2e/chat-files.spec.ts`:

```ts
test('a user can attach a file and it is listed on the sent message', async ({ page }) => {
	await page.goto(`/chat/${APP_IDS['agent-chat']}`)
	await page.getByRole('button', { name: 'Attach files' }).click()
	await page.locator('input[type="file"]').first().setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello stub') })
	await expect(page.getByText('note.txt')).toBeVisible()
	await page.getByRole('textbox').first().fill('with a file')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Echo: with a file')).toBeVisible()
	await expect(page.locator('.ant-bubble').filter({ hasText: 'with a file' }).getByText('note.txt')).toBeVisible()
})
```

The user bubble's file list shows the local file name because `transformLocalMessage` carries `files` without names; extend it to keep `filename` from the `Attachments` item (`IFile` has no name, so `SendParams.files` becomes `Array<IFile & { filename?: string }>` and `transformLocalMessage` copies `filename`). Add this to `message.ts` (`DifyChatInput.files: Array<IFile & { filename?: string }>`) and to the provider test "renders the local user bubble".

- [ ] **Step 7: Run and commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm test && pnpm exec playwright test e2e/chat-files.spec.ts e2e/chat.spec.ts`
Expected: green.

```bash
pnpm exec oxfmt --write components/chat e2e/chat-files.spec.ts locales __tests__/dify-chat-provider.test.ts
git add components/chat e2e/chat-files.spec.ts locales __tests__/dify-chat-provider.test.ts
git commit -m "feat(chat): attachments in Sender.Header with proxy uploads, paste-to-attach and speech to text" -m "X Attachments inside Sender.Header uploads through antd Upload's customRequest to the Dify upload proxy, enforces the app's type, extension and count limits, accepts pasted files, and maps uploads to Dify's local_file references on send. Speech input uses Sender's SpeechConfig with MediaRecorder and the audio-to-text proxy. The file controls move next to the chat view and read AppContext." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 16: Sidebar collapse, conversation menu (rename, delete), the mobile drawer completed

**Spec:** §5.1, §5.2 (Conversation list menu), §4.4 (rename/delete through `App.useApp().modal`), ADR-0014 verification item.

**Files:**
- Create: `components/chat/chat-view/use-conversation-menu.tsx`, `components/chat/chat-view/sider-collapsed.tsx`, `e2e/chat-mobile.spec.ts`
- Modify: `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/conversation-sidebar.tsx`, `components/chat/chat-view/conversation-drawer.tsx`, `components/chat/chat-view/chat-view.module.css`, `e2e/chat.spec.ts`, `docs/decisions/0014-header-controls-click-triggered-named-through-i18next.md`, `locales/*`

**Interfaces:**
- Produces: `useConversationMenu({ rename, remove })` → `ConversationsProps['menu']` (a function of the item); `SiderCollapsed({ onCreate, createDisabled, list })`.
- `ConversationDrawer` renders `children` plus a footer with `LanguageDropdown`, `ThemeDropdown`, `AccountDropdown`.

- [ ] **Step 1: Keys**

Under `chat`: `menu_for` — en "Conversation actions" · zh "会话操作" · ar "إجراءات المحادثة".

- [ ] **Step 2: The item menu (antd `Menu` items, `App.useApp().modal.confirm`, never the static `Modal`)**

`components/chat/chat-view/use-conversation-menu.tsx`:

```tsx
'use client'

import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { ConversationsProps } from '@ant-design/x'
import { App, Form, Input } from 'antd'
import { useTranslation } from 'react-i18next'

export const useConversationMenu = ({ rename, remove }: { rename: (key: string, name: string) => Promise<void>; remove: (key: string) => Promise<void> }): ConversationsProps['menu'] => {
	const { t } = useTranslation()
	const { modal, message } = App.useApp()
	const [form] = Form.useForm<{ name: string }>()
	return conversation => ({
		items: [
			{ key: 'rename', label: t('chat.rename'), icon: <EditOutlined /> },
			{ key: 'delete', label: t('chat.delete'), icon: <DeleteOutlined />, danger: true },
		],
		onClick: ({ key, domEvent }) => {
			domEvent.stopPropagation()
			if (key === 'rename') {
				form.setFieldsValue({ name: String(conversation.label ?? '') })
				modal.confirm({
					title: t('chat.rename'),
					content: (
						<Form form={form} layout="vertical">
							<Form.Item name="name" rules={[{ required: true, message: t('chat.rename_placeholder') }]}>
								<Input placeholder={t('chat.rename_placeholder')} aria-label={t('chat.rename_placeholder')} />
							</Form.Item>
						</Form>
					),
					onOk: async () => {
						const { name } = await form.validateFields()
						await rename(conversation.key, name)
						message.success(t('chat.rename_success'))
					},
				})
			}
			if (key === 'delete') {
				modal.confirm({
					title: t('chat.delete_confirm_title'),
					content: t('chat.delete_confirm_content'),
					okText: t('common.delete'),
					okButtonProps: { danger: true },
					cancelText: t('common.cancel'),
					onOk: async () => {
						await remove(conversation.key)
						message.success(t('chat.delete_success'))
					},
				})
			}
		},
	})
}
```

Pass `menu={useConversationMenu({ rename: list.rename, remove: list.remove })}` to both `ConversationSidebar` instances (sider and drawer). A temporary conversation without a Dify id gets `items: [{ key: 'delete', … }]` only (rename needs a server id): branch on `conversation.key.includes(':temp:')`.

- [ ] **Step 3: Collapsed sider and the toggle**

`components/chat/chat-view/sider-collapsed.tsx`:

```tsx
'use client'

import { MenuOutlined, PlusCircleOutlined } from '@ant-design/icons'
import { Avatar, Button, Flex, Popover } from 'antd'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'

export default function SiderCollapsed({ onCreate, createDisabled, list }: { onCreate: () => void; createDisabled: boolean; list: React.ReactNode }) {
	const { t } = useTranslation()
	const { site, app } = useAppContext()
	return (
		<Flex vertical align="center" gap="small" style={{ paddingBlock: 'var(--ant-padding-sm)' }}>
			<Avatar shape="square" src={site.icon_type === 'image' ? site.icon_url || site.icon : undefined}>
				{site.icon_type === 'emoji' ? site.icon : (site.title || app.info.name).slice(0, 1)}
			</Avatar>
			<Button type="text" icon={<PlusCircleOutlined />} aria-label={t('chat.new_chat')} title={t('chat.new_chat')} disabled={createDisabled} onClick={onCreate} />
			<Popover trigger={['click']} placement="rightTop" title={t('chat.chat_list')} content={<div style={{ maxHeight: '50vh', overflow: 'auto' }}>{list}</div>}>
				<Button type="text" icon={<MenuOutlined />} aria-label={t('chat.chat_list')} title={t('chat.chat_list')} />
			</Popover>
		</Flex>
	)
}
```

In `chat-view.tsx`: `const [collapsed, setCollapsed] = useState(false)`; `<Layout.Sider width={SIDEBAR_WIDTH} collapsible collapsed={collapsed} collapsedWidth={token.controlHeightLG * 2} trigger={null} …>` rendering `collapsed ? <SiderCollapsed … list={sidebarList} /> : sidebar` and, at the bottom of the sider (inside `siderInner`, after the list), a toggle `Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} aria-label={collapsed ? t('chat.sidebar_open') : t('chat.sidebar_close')} title={…} onClick={() => setCollapsed(v => !v)}`. `sidebarList` is the `Conversations` element alone (without the app info), reused by the Popover.

- [ ] **Step 4: Complete the drawer**

`conversation-drawer.tsx` adds a footer with the three dropdowns, so the header's hidden controls stay reachable on mobile (spec §5.1):

```tsx
import AccountDropdown from '@/components/shell/account-dropdown'
import LanguageDropdown from '@/components/shell/language-dropdown'
import ThemeDropdown from '@/components/shell/theme-dropdown'
…
<Drawer open={open} onClose={onClose} placement="left" title={t('chat.conversations_menu')} styles={{ body: { padding: 0 } }}
	footer={<Flex gap="small" justify="flex-end"><LanguageDropdown /><ThemeDropdown /><AccountDropdown /></Flex>}>
	{children}
</Drawer>
```

- [ ] **Step 5: Specs**

`e2e/chat-mobile.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

test.describe('mobile chat', () => {
	test.skip(({ isMobile }) => !isMobile, 'the drawer replaces the sider only below md')

	test('the menu button opens the conversation drawer, which switches conversations and holds the account menu', async ({ page }) => {
		await page.goto(`/chat/${APP_ID}`)
		await page.getByRole('textbox').first().fill('mobile one')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: mobile one')).toBeVisible()
		await page.getByRole('button', { name: 'Menu' }).click()
		const drawer = page.getByRole('dialog', { name: 'Conversations menu' })
		await expect(drawer).toBeVisible()
		await drawer.getByRole('button', { name: 'New conversation' }).click()
		await expect(drawer).toBeHidden()
		await expect(page.getByText('Echo: mobile one')).toHaveCount(0)
		await page.getByRole('button', { name: 'Menu' }).click()
		await drawer.locator('.ant-conversations-item').filter({ hasText: 'mobile one' }).click()
		await expect(page.getByText('Echo: mobile one')).toBeVisible()
		await page.getByRole('button', { name: 'Menu' }).click()
		await drawer.getByRole('button', { name: /signed in as/i }).click()
		await expect(page.getByRole('menuitem', { name: /log out/i })).toBeVisible()
	})
})
```

Append to `e2e/chat.spec.ts` (desktop only):

```ts
	test('a conversation can be renamed and deleted from its menu', async ({ page, isMobile }) => {
		test.skip(isMobile, 'the item menu is exercised on desktop; mobile uses the drawer spec')
		await page.getByRole('textbox').first().fill('rename me')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: rename me')).toBeVisible()
		const item = page.locator('.ant-conversations-item').filter({ hasText: 'rename me' })
		await item.hover()
		await item.locator('.ant-conversations-menu-icon, [class*="menu-icon"]').click()
		await page.getByRole('menuitem', { name: 'Rename' }).click()
		await page.getByLabel('Enter a conversation name').fill('Renamed chat')
		await page.getByRole('button', { name: 'OK' }).click()
		await expect(page.locator('.ant-conversations-item').filter({ hasText: 'Renamed chat' })).toBeVisible()
		const renamed = page.locator('.ant-conversations-item').filter({ hasText: 'Renamed chat' })
		await renamed.hover()
		await renamed.locator('.ant-conversations-menu-icon, [class*="menu-icon"]').click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).click()
		await expect(renamed).toHaveCount(0)
	})

	test('the sider collapses to icons and expands again', async ({ page, isMobile }) => {
		test.skip(isMobile, 'no sider below md')
		await page.getByRole('button', { name: 'Collapse sidebar' }).click()
		await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
		await page.getByRole('button', { name: 'Conversations' }).click()
		await expect(page.locator('.ant-popover .ant-conversations')).toBeVisible()
		await page.keyboard.press('Escape')
		await page.getByRole('button', { name: 'Expand sidebar' }).click()
		await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
	})
```

- [ ] **Step 6: ADR-0014 note, run, commit**

Append under "More Information" of ADR-0014: "2026-10-04 (sub-project 2): the chat's mobile menu is a Drawer trigger named `system.menu`; `e2e/chat-mobile.spec.ts` opens it and switches a conversation (verification item done)." Tick the box.

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm test && pnpm exec playwright test e2e/chat.spec.ts e2e/chat-mobile.spec.ts e2e/chat-header.spec.ts`
Expected: green.

```bash
pnpm exec oxfmt --write components/chat e2e locales
git add components/chat e2e locales docs/decisions/0014-header-controls-click-triggered-named-through-i18next.md
git commit -m "feat(chat): collapsible sider, conversation rename and delete, and the mobile drawer with the header controls" -m "Conversations get a per-item menu whose rename and delete run through App.useApp().modal; the Layout.Sider collapses to the app icon, a new-chat button and a Popover list; the mobile Drawer carries the list plus the language, theme and account dropdowns so nothing the header hides below md is lost (ADR-0014 verification done)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 17: Workflow and completion views on `XStream`

**Spec:** §4.8, §5.4.

**Files:**
- Create: `components/chat/hooks/run-reducer.ts`, `components/chat/hooks/use-workflow-run.ts`, `components/chat/workflow-view/workflow-view.tsx`, `components/chat/workflow-view/workflow-view.module.css`, `components/chat/workflow-view/run-result.tsx`, `__tests__/run-reducer.test.ts`, `e2e/workflow.spec.ts`, `e2e/completion.spec.ts`
- Modify: `components/chat/chat-workspace.tsx` (route non-chat modes here; drop the old wrapper import), `locales/*`

**Interfaces:**
- Produces: `RunState = { status: 'idle' | 'running' | 'finished' | 'failed' | 'stopped'; runId?: string; taskId?: string; workflow?: WorkflowState; text: string; outputs?: Record<string, unknown>; files?: MessageFile[]; error?: string }`, `reduceRunEvent(state, event): RunState` (pure), `useWorkflowRun()` → `{ state, run(inputs), stop(), reset() }`, `WorkflowView()` (handles both `workflow` and `completion` modes).
- Consumes: `difyApi.runWorkflow` / `difyApi.completion` (return a `Response`), `XStream` from `@ant-design/x-sdk`, `applyEvent` for node bookkeeping, `InputsForm`, `WorkflowLogs`, `MessageMarkdown`, `MessageFiles`.

- [ ] **Step 1: Keys**

Under `workflow`: `stop` — en "Stop" · zh "停止" · ar "إيقاف"; `failed` — en "The run failed" · zh "运行失败" · ar "فشل التشغيل"; `stopped` — en "Stopped" · zh "已停止" · ar "تم الإيقاف".

- [ ] **Step 2: Failing reducer test**

`__tests__/run-reducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { initialRunState, reduceRunEvent } from '@/components/chat/hooks/run-reducer'

const base = { task_id: 't', message_id: 'm', conversation_id: '', created_at: 1 }

describe('reduceRunEvent', () => {
	it('tracks nodes, appends text chunks and finishes with outputs', () => {
		let s = reduceRunEvent(initialRunState, { event: 'workflow_started', workflow_run_id: 'run-1', data: { id: 'run-1' }, ...base })
		s = reduceRunEvent(s, { event: 'node_started', workflow_run_id: 'run-1', data: { id: 'n1', node_id: 'llm', node_type: 'llm', title: 'Answer' }, ...base })
		s = reduceRunEvent(s, { event: 'text_chunk', workflow_run_id: 'run-1', data: { text: 'A short ' }, ...base })
		s = reduceRunEvent(s, { event: 'text_chunk', workflow_run_id: 'run-1', data: { text: 'note.' }, ...base })
		s = reduceRunEvent(s, { event: 'workflow_finished', workflow_run_id: 'run-1', data: { id: 'run-1', status: 'succeeded', outputs: { text: 'A short note.' }, files: null, error: null }, ...base })
		expect(s).toMatchObject({ status: 'finished', runId: 'run-1', taskId: 't', text: 'A short note.', outputs: { text: 'A short note.' } })
		expect(s.workflow?.nodes).toHaveLength(1)
	})
	it('handles completion apps through message and message_end', () => {
		let s = reduceRunEvent(initialRunState, { event: 'message', answer: 'Hel', ...base })
		s = reduceRunEvent(s, { event: 'message', answer: 'lo', ...base })
		s = reduceRunEvent(s, { event: 'message_end', ...base })
		expect(s).toMatchObject({ status: 'finished', text: 'Hello' })
	})
	it('records a failed run and a stream error', () => {
		expect(reduceRunEvent(initialRunState, { event: 'workflow_finished', workflow_run_id: 'r', data: { id: 'r', status: 'failed', outputs: null, error: 'boom' }, ...base })).toMatchObject({ status: 'failed', error: 'boom' })
		expect(reduceRunEvent(initialRunState, { event: 'error', code: 'x', message: 'bad', status: 500, ...base })).toMatchObject({ status: 'failed', error: 'bad' })
	})
})
```

Run → FAIL.

- [ ] **Step 3: Implement the reducer and the hook**

`components/chat/hooks/run-reducer.ts`:

```ts
import { applyEvent } from '../provider/dify-chat-provider'
import { emptyAssistant, type DifyStreamEvent, type MessageFile, type WorkflowState } from '../provider/message'

export interface RunState {
	status: 'idle' | 'running' | 'finished' | 'failed' | 'stopped'
	runId?: string
	taskId?: string
	workflow?: WorkflowState
	text: string
	outputs?: Record<string, unknown>
	files?: MessageFile[]
	error?: string
}

export const initialRunState: RunState = { status: 'idle', text: '' }

/** ChunkWorkflowEvent and completion events → one run state (spec §4.8). Node bookkeeping reuses applyEvent. */
export const reduceRunEvent = (state: RunState, event: DifyStreamEvent): RunState => {
	const data = (event.data ?? {}) as Record<string, unknown>
	const taskId = event.task_id ?? state.taskId
	switch (event.event) {
		case 'workflow_started':
		case 'node_started':
		case 'node_finished':
		case 'node_retry': {
			const workflow = applyEvent({ ...emptyAssistant(), workflow: state.workflow }, event).workflow
			return { ...state, status: 'running', taskId, runId: event.workflow_run_id ?? state.runId, workflow }
		}
		case 'text_chunk':
			return { ...state, status: 'running', taskId, text: state.text + String(data.text ?? '') }
		case 'message':
			return { ...state, status: 'running', taskId, text: state.text + (event.answer ?? '') }
		case 'message_end':
			return { ...state, status: 'finished', taskId }
		case 'workflow_finished': {
			const outputs = (data.outputs as Record<string, unknown> | null) ?? undefined
			const files = ((data.files as Array<Record<string, unknown>> | null) ?? []).map((f, i) => ({ id: String(f.id ?? i), type: String(f.type ?? 'custom'), url: String(f.url ?? ''), belongsTo: 'assistant' as const, filename: f.filename as string | undefined, size: f.size as number | undefined }))
			const workflow = applyEvent({ ...emptyAssistant(), workflow: state.workflow }, event).workflow
			const single = outputs && Object.keys(outputs).length === 1 ? Object.values(outputs)[0] : undefined
			return { ...state, status: data.error ? 'failed' : 'finished', taskId, workflow, outputs, files, error: (data.error as string | null) ?? undefined, text: state.text || (typeof single === 'string' ? single : '') }
		}
		case 'error':
			return { ...state, status: 'failed', taskId, error: String(event.message ?? 'error') }
		default:
			return state
	}
}
```

`components/chat/hooks/use-workflow-run.ts`:

```ts
'use client'

import { XStream } from '@ant-design/x-sdk'
import { useCallback, useRef, useState } from 'react'

import { AppModeEnums } from '@/lib/core'

import { useAppContext } from '../app-context'
import type { DifyStreamEvent } from '../provider/message'
import { initialRunState, reduceRunEvent, type RunState } from './run-reducer'

/** Runs a workflow or completion app and folds its SSE stream with XStream (x-sdk's documented reader). */
export const useWorkflowRun = () => {
	const { app, difyApi } = useAppContext()
	const [state, setState] = useState<RunState>(initialRunState)
	const reader = useRef<ReadableStreamDefaultReader | null>(null)

	const run = useCallback(
		async (inputs: Record<string, unknown>) => {
			setState({ ...initialRunState, status: 'running' })
			try {
				const response = (app.info.mode === AppModeEnums.WORKFLOW ? await difyApi.runWorkflow({ inputs }) : await difyApi.completion({ inputs })) as Response
				if (!response.ok) {
					const body = await response.json().catch(() => ({}))
					setState(s => ({ ...s, status: 'failed', error: body.message ?? response.statusText }))
					return
				}
				const stream = XStream({ readableStream: response.body as ReadableStream<Uint8Array> })
				reader.current = stream.getReader()
				for (;;) {
					const { value, done } = await reader.current.read()
					if (done) break
					if (!value?.data) continue
					try {
						const event = JSON.parse(value.data) as DifyStreamEvent
						setState(s => reduceRunEvent(s, event))
					} catch {
						// a non-JSON chunk is skipped, like the chat provider does
					}
				}
				setState(s => (s.status === 'running' ? { ...s, status: 'finished' } : s))
			} catch (error) {
				setState(s => (s.status === 'stopped' ? s : { ...s, status: 'failed', error: (error as Error).message }))
			} finally {
				reader.current = null
			}
		},
		[app.info.mode, difyApi],
	)

	/** Cancels the response body; the Dify run itself continues (no proxy route for the run stop endpoints, spec §4.8). */
	const stop = useCallback(() => {
		void reader.current?.cancel()
		setState(s => ({ ...s, status: 'stopped' }))
	}, [])

	return { state, run, stop, reset: () => setState(initialRunState) }
}
```

- [ ] **Step 4: The view**

`components/chat/workflow-view/workflow-view.module.css`:

```css
.fill {
	height: 100%;
	overflow: auto;
	padding: var(--ant-padding);
}
.pane {
	padding: var(--ant-padding);
	background: var(--ant-color-bg-container);
	border-radius: var(--ant-border-radius-lg);
	min-height: 100%;
}
.code {
	margin: 0;
	font-family: var(--ant-font-family-code);
	font-size: var(--ant-font-size-sm);
	background: var(--ant-color-fill-quaternary);
	padding: var(--ant-padding-xs);
	border-radius: var(--ant-border-radius);
	overflow: auto;
	white-space: pre-wrap;
}
```

`components/chat/workflow-view/run-result.tsx`:

```tsx
'use client'

import { Actions } from '@ant-design/x'
import { Empty, Flex, Result, Tabs, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import type { RunState } from '../hooks/run-reducer'
import MessageFiles from '../message/message-files'
import MessageMarkdown from '../message/message-markdown'
import WorkflowLogs from '../message/workflow-logs'
import styles from './workflow-view.module.css'

export default function RunResult({ state, showLogs }: { state: RunState; showLogs: boolean }) {
	const { t } = useTranslation()
	if (state.status === 'idle') return <Empty description={t('workflow.empty_hint')} />
	if (state.status === 'failed') return <Result status="error" title={t('workflow.failed')} subTitle={state.error} />
	const detail = state.outputs ? JSON.stringify(state.outputs, null, 2) : ''
	return (
		<Flex vertical gap="middle">
			{showLogs && <WorkflowLogs workflow={state.workflow} defaultOpen />}
			{state.status === 'stopped' && <Typography.Text type="secondary">{t('workflow.stopped')}</Typography.Text>}
			<Tabs
				items={[
					...(state.text || state.files?.length
						? [{ key: 'result', label: t('workflow.result'), children: (<Flex vertical gap="small"><Actions items={[{ key: 'copy', actionRender: () => <Actions.Copy text={state.text} /> }]} />{state.text && <MessageMarkdown content={state.text} streaming={state.status === 'running'} />}<MessageFiles files={state.files} /></Flex>) }]
						: []),
					...(detail ? [{ key: 'detail', label: t('workflow.detail'), children: (<Flex vertical gap="small"><Actions items={[{ key: 'copy', actionRender: () => <Actions.Copy text={detail} /> }]} /><pre className={styles.code}>{detail}</pre></Flex>) }] : []),
				]}
			/>
		</Flex>
	)
}
```

`components/chat/workflow-view/workflow-view.tsx`:

```tsx
'use client'

import { Button, Col, Flex, Form, Row, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import { AppModeEnums } from '@/lib/core'

import { useAppContext } from '../app-context'
import { AppInfoBlock } from '../chat-view/conversation-sidebar'
import InputsForm from '../chat-view/inputs-form'
import { useWorkflowRun } from '../hooks/use-workflow-run'
import RunResult from './run-result'
import styles from './workflow-view.module.css'

/** Workflow and completion apps: inputs on the left, the run on the right (spec §5.4). */
export default function WorkflowView() {
	const { t } = useTranslation()
	const { app, site, parameters } = useAppContext()
	const [form] = Form.useForm<Record<string, unknown>>()
	const { state, run, stop } = useWorkflowRun()
	const running = state.status === 'running'
	const start = async () => {
		const values = await form.validateFields()
		void run(values)
	}
	return (
		<UserShell title={<Typography.Text strong ellipsis>{site.title || app.info.name}</Typography.Text>}>
			<div className={styles.fill}>
				<Row gutter={[16, 16]}>
					<Col xs={24} md={10}>
						<Flex vertical gap="middle" className={styles.pane}>
							<AppInfoBlock />
							<InputsForm form={form} definition={parameters.user_input_form ?? []} disabled={running} />
							<Flex gap="small" justify="flex-end">
								{running && <Button onClick={stop}>{t('workflow.stop')}</Button>}
								<Button type="primary" loading={running} onClick={() => void start()}>
									{t('workflow.run')}
								</Button>
							</Flex>
						</Flex>
					</Col>
					<Col xs={24} md={14}>
						<div className={styles.pane}>
							<RunResult state={state} showLogs={app.info.mode === AppModeEnums.WORKFLOW} />
						</div>
					</Col>
				</Row>
			</div>
		</UserShell>
	)
}
```

In `chat-workspace.tsx`: replace `if (!isChatLikeApp(mode)) return <ChatLayoutWrapper />` with rendering `<WorkflowView />` inside the `AppContext.Provider` when `isWorkflowLikeApp(mode)`, else a `Result status="warning" title={t('common.unsupported_app_type')}`; remove the `ChatLayoutWrapper` import. `AppInfoBlock` is exported from `conversation-sidebar.tsx` (Task 9).

- [ ] **Step 5: Specs**

`e2e/workflow.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

test.describe('workflow app', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_IDS.workflow}`)
		await expect(page.getByRole('button', { name: 'Run' })).toBeVisible()
	})

	test('a required input blocks the run until filled, then logs and result appear', async ({ page }) => {
		await page.getByRole('button', { name: 'Run' }).click()
		await expect(page.getByText('Topic is required')).toBeVisible()
		await page.getByLabel('Topic').fill('tea')
		await page.getByRole('button', { name: 'Run' }).click()
		await expect(page.getByText('A short note about tea.')).toBeVisible()
		await expect(page.getByText('Start', { exact: true })).toBeVisible()
		await expect(page.getByText('Answer', { exact: true })).toBeVisible()
		await page.getByRole('tab', { name: 'Details' }).click()
		await expect(page.getByText('"text": "A short note about tea."')).toBeVisible()
	})
})
```

`e2e/completion.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

test('a completion app renders the generated text with a copy action', async ({ page }) => {
	await page.goto(`/chat/${APP_IDS.completion}`)
	await page.getByLabel('Topic').fill('coffee')
	await page.getByRole('button', { name: 'Run' }).click()
	await expect(page.getByText('A short note about coffee.')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
	await expect(page.getByText('Workflow', { exact: true })).toHaveCount(0)
})
```

The required message text comes from `form.field_required` ("{{label}} is required" in the English file; check the exact wording in `locales/en/translation.json` and match it).

- [ ] **Step 6: Run and commit**

Run: `pnpm exec vitest run __tests__/run-reducer.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm test && pnpm exec playwright test e2e/workflow.spec.ts e2e/completion.spec.ts e2e/smoke.spec.ts`
Expected: green.

```bash
pnpm exec oxfmt --write components/chat e2e locales __tests__/run-reducer.test.ts
git add components/chat e2e locales __tests__/run-reducer.test.ts
git commit -m "feat(chat): workflow and completion views on XStream with the shared inputs form, logs and result tabs" -m "useWorkflowRun reads the run stream with XStream and folds it into a run state (nodes through applyEvent, text chunks, outputs, files, errors); the view is an antd Row/Col with the inputs form and run/stop on the left and logs, result and detail tabs on the right. ChatWorkspace routes workflow and completion apps here; the old layout is no longer referenced." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 18: Ant Design X locale, including Arabic

**Spec:** §7.

**Files:**
- Create: `libs/x-locale.ts`, `libs/x-locale-ar.ts`, `__tests__/x-locale.test.ts`
- Modify: `components/providers/app-providers.tsx`, `docs/i18n-maintenance.md`

**Interfaces:**
- Produces: `getXLocale(language?: string): xLocale` (English fallback); `arEG_X: xLocale`.

- [ ] **Step 1: Failing test**

`__tests__/x-locale.test.ts`:

```ts
import enUS from '@ant-design/x/locale/en_US'
import { describe, expect, it } from 'vitest'

import { getXLocale } from '@/libs/x-locale'

const keysOf = (value: unknown, prefix = ''): string[] =>
	Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'object' && v ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

describe('getXLocale', () => {
	it.each(['en', 'zh', 'ar'])('has the same keys as the English pack for %s', language => {
		expect(keysOf(getXLocale(language)).sort()).toEqual(keysOf(enUS).sort())
	})
	it('marks the Arabic pack as ar and translates every string', () => {
		const ar = getXLocale('ar')
		expect(ar.locale).toBe('ar')
		for (const key of keysOf(ar).filter(k => k !== 'locale')) {
			const value = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], ar) as string
			expect(value, key).toMatch(/[؀-ۿ]/)
		}
	})
	it('falls back to English for an unknown language', () => {
		expect(getXLocale('fr').locale).toBe('en')
		expect(getXLocale(undefined).locale).toBe('en')
	})
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

`libs/x-locale-ar.ts` (Modern Standard Arabic, the same 20 strings as X's `en_US`; shape from `@ant-design/x/es/locale/index.d.ts`):

```ts
import type { xLocale } from '@ant-design/x/es/locale'

/** Ant Design X ships only en_US and zh_CN; this is the fork's Arabic pack (ADR-0005 wording rules). */
const arEG_X: xLocale = {
	locale: 'ar',
	Conversations: { create: 'محادثة جديدة' },
	Sender: { stopLoading: 'إيقاف التحميل', speechRecording: 'تسجيل صوتي' },
	Actions: {
		feedbackLike: 'إعجاب',
		feedbackDislike: 'عدم إعجاب',
		audio: 'تشغيل الصوت',
		audioRunning: 'الصوت قيد التشغيل',
		audioError: 'خطأ في التشغيل',
		audioLoading: 'جارٍ تحميل الصوت',
	},
	Bubble: { editableOk: 'موافق', editableCancel: 'إلغاء' },
	Mermaid: { zoomIn: 'تكبير', zoomOut: 'تصغير', zoomReset: 'إعادة تعيين', download: 'تنزيل', code: 'الشيفرة', image: 'صورة' },
	Folder: {
		selectFile: 'يرجى اختيار ملف',
		loadError: 'تعذّر تحميل الملف',
		noService: 'خدمة محتوى الملفات غير مُهيّأة',
		loadFailed: 'فشل تحميل الملف',
	},
}

export default arEG_X
```

If `@ant-design/x/es/locale` is not an allowed import path for types in this project (deep import), declare the type locally as `typeof enUS` instead: `import enUS from '@ant-design/x/locale/en_US'; type XLocale = typeof enUS`.

`libs/x-locale.ts`:

```ts
import enUS from '@ant-design/x/locale/en_US'
import zhCN from '@ant-design/x/locale/zh_CN'

import arEG_X from './x-locale-ar'

const FALLBACK = 'en'
const packs: Record<string, typeof enUS> = { en: enUS, zh: zhCN, ar: arEG_X }

/** The Ant Design X strings for an i18next language, merged into the XProvider locale next to antd's (X docs: XProvider). */
export const getXLocale = (language?: string): typeof enUS => packs[language ?? FALLBACK] ?? packs[FALLBACK]
```

`components/providers/app-providers.tsx`: `locale={{ ...getAntdLocale(i18n.resolvedLanguage), ...getXLocale(i18n.resolvedLanguage) }}`.

- [ ] **Step 3: Docs, run, commit**

`docs/i18n-maintenance.md` → "Adding a language": add step 6 "Add the language's Ant Design X strings to `libs/x-locale.ts` (a pack like `libs/x-locale-ar.ts`) and a case to `__tests__/x-locale.test.ts`"; in "Lines the git grep is expected to print" drop the `components/chat/chat-layout.tsx` language radio (gone) and add `libs/x-locale-ar.ts`? (no Chinese there; nothing to add).

Run: `pnpm exec vitest run __tests__/x-locale.test.ts && pnpm exec tsc --noEmit && pnpm test && pnpm exec playwright test e2e/shell.spec.ts e2e/chat-errors.spec.ts`
Expected: green; after switching to Arabic the Sender's stop button is named "إيقاف التحميل".

```bash
pnpm exec oxfmt --write libs components/providers/app-providers.tsx __tests__/x-locale.test.ts
git add libs components/providers/app-providers.tsx __tests__/x-locale.test.ts docs/i18n-maintenance.md
git commit -m "feat(i18n): Ant Design X locale for English, Chinese and a fork Arabic pack" -m "X ships en_US and zh_CN only; the fork adds an Arabic xLocale object with the same 20 strings and merges the X pack into the single XProvider next to antd's locale, as the XProvider docs show." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

---

### Task 19: Remove the old chat, drop dependencies, screenshots, docs and ADR status

**Spec:** §5.5, §9, §11, §14 (grep gates, lint baseline).

**Files:**
- Delete: `components/chat/chat-layout.tsx`, `chat-layout-wrapper.tsx`, `chatbox-wrapper.tsx`, `common-layout.tsx`, `main-layout.tsx`, `workflow-layout.tsx`, `params-config-editor.tsx`, `storage.ts`, `constants-index.ts`, `enums-index.ts`, `components/chat/conversation-list/`, `components/chat/message-sender/`, `components/chat/chatbox/`, `components/chat/hitl-form/`, `components/chat/markdown-renderer/` (only if the spike passed; otherwise it already moved to `message/markdown/legacy`), `hooks/useX/`, `lib/core/store.ts`, `components/ui/tree-view*`, `components/shared/lucide-icon.tsx` if nothing else imports it, `__tests__/x-provider-conversation-id.test.ts`
- Modify: `lib/core/index.ts` (drop the store exports), `package.json` (removals), `e2e/screenshots.spec.ts`, `docs/frontend-conventions.md`, `docs/auth-gate.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-04-frontend-foundation-design.md` (drift note), `docs/decisions/{0006,0008,0010}` (dated notes), `docs/decisions/{0016,0017,0018}` (status)

- [ ] **Step 1: Delete and fix the fallout**

```bash
git rm -r components/chat/chat-layout.tsx components/chat/chat-layout-wrapper.tsx components/chat/chatbox-wrapper.tsx components/chat/common-layout.tsx components/chat/main-layout.tsx components/chat/workflow-layout.tsx components/chat/params-config-editor.tsx components/chat/storage.ts components/chat/constants-index.ts components/chat/enums-index.ts components/chat/conversation-list components/chat/message-sender components/chat/chatbox components/chat/hitl-form hooks/useX lib/core/store.ts __tests__/x-provider-conversation-id.test.ts
git rm -r components/chat/markdown-renderer   # only when ADR-0017 says XMarkdown was adopted
pnpm exec tsc --noEmit
```

Fix every error tsc reports by removing the dead import (expected: `lib/core/index.ts` store exports; `components/chat/utils-index.ts` is kept; any admin page importing `useDifyChatStore` is replaced by a local `useState` — check with `git grep -n useDifyChatStore`). Then `git grep -n "lucide-react\|components/ui/tree-view\|react-photo-view\|react-infinite-scroll-component\|pure-react-router"` → remove each remaining consumer under `components/chat` and delete `components/ui/tree-view*` and `components/shared/lucide-icon.tsx` when no importer is left (the apps and admin pages may still import `LucideIcon`; if so it stays until sub-project 3 and you note it).

- [ ] **Step 2: Remove dependencies that have no importer left**

For each candidate run `git grep -n "from '<pkg>'"` and remove it only when the grep is empty:

```bash
pnpm remove react-infinite-scroll-component react-photo-view pure-react-router
# only on a passed spike:
pnpm remove react-markdown remark-gfm remark-math remark-breaks rehype-katex rehype-raw react-syntax-highlighter katex hast
pnpm why @radix-ui/react-collapsible @radix-ui/react-accordion   # remove if only the deleted tree view used them
pnpm exec tsc --noEmit && pnpm test
```

Keep `dompurify` if `components/chat/message/markdown/svg-block.tsx` still imports it.

- [ ] **Step 3: Screenshots and the grep gates**

In `e2e/screenshots.spec.ts` add to `signedInPages`:

```ts
	'chat-agent': { path: `/chat/${APP_IDS['agent-chat']}`, ready: async page => { await noSpinner(page); await expect(page.getByRole('textbox').first()).toBeVisible(); await page.getByRole('textbox').first().fill('hello agent'); await page.keyboard.press('Enter'); await expect(page.getByText('Echo: hello agent')).toBeVisible() } },
	'chat-hitl': { path: `/chat/${APP_IDS['advanced-chat']}`, ready: async page => { await noSpinner(page); await page.getByRole('textbox').first().fill('please hitl'); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible() } },
	workflow: { path: `/chat/${APP_IDS.workflow}`, ready: async page => { await noSpinner(page); await page.getByLabel('Topic').fill('tea'); await page.getByRole('button', { name: 'Run' }).click(); await expect(page.getByText('A short note about tea.')).toBeVisible() } },
	completion: { path: `/chat/${APP_IDS.completion}`, ready: async page => { await noSpinner(page); await page.getByLabel('Topic').fill('coffee'); await page.getByRole('button', { name: 'Run' }).click(); await expect(page.getByText('A short note about coffee.')).toBeVisible() } },
```

(import `APP_IDS`). Then the gates:

```bash
git grep -nE "lucide-react|className=\"[^\"]*(flex |text-|bg-|border-|p-[0-9]|m-[0-9])" components/chat   # expect: nothing
git grep -n -- "--theme-" components/chat                                                            # expect: nothing
git grep -nE "#[0-9a-fA-F]{3,8}\b" components/chat -- ':!*.test.*'                                     # expect: nothing
npx -y @ant-design/cli lint ./ > "$CLAUDE_JOB_DIR/tmp/antd-lint.txt"; grep -c '✗' "$CLAUDE_JOB_DIR/tmp/antd-lint.txt"; grep -c '⚠' "$CLAUDE_JOB_DIR/tmp/antd-lint.txt"
```

Expected: errors ≤ 1 and warnings well below 74 (the chat's 50-odd static `message.*` calls are gone). Record the new numbers in `docs/frontend-conventions.md` → "Lint re-check".

- [ ] **Step 4: Docs and ADRs**

- `docs/frontend-conventions.md`: Status → sub-project 2 done (what shipped, the stub catalogue now matches §4.6, the reset is gone); add the CSS-breakpoint rule under §4.3 (spec §3.3); lint re-check numbers.
- `docs/auth-gate.md`: already updated in Task 2; re-read for stale mentions of `useAuth` gates.
- `CLAUDE.md`: decision lines for ADR-0016, 0017, 0018; "Where things are" → `components/chat/` layout (`chat-workspace`, `chat-view/`, `message/`, `provider/`, `hooks/`, `workflow-view/`), the stub under `e2e/fixtures/stub/`; "Next frontend step" → sub-project 3; "Open follow-ups" → drop the late-history race, the stub streams, the gate design, `100vh` vs `100dvh`, `goAuthorize`; keep the rest. Stay under 200 lines.
- `docs/superpowers/specs/2026-10-04-frontend-foundation-design.md`: add a dated "Spec drift (resolved 2026-10-04)" paragraph listing the five points from the handoff and where each landed.
- Dated notes under "More Information": ADR-0010 (stub catalogue complete, `/__e2e/reset` removed, tick the box), ADR-0006 (pages redirect revoked sessions through `requireSessionUser`; the `/api/users/*` gap stays open), ADR-0008 (tick "Sub-project 2 (chat)").
- `node .claude/skills/adr-skill/scripts/set_adr_status.js docs/decisions/0016-….md --status accepted` and the same for 0017 and 0018 (the owner approved the spec and plan on 2026-10-04; the PR merge is the acceptance act), then `node .claude/skills/adr-skill/scripts/new_adr.js --dir docs/decisions --update-index` only if the index does not refresh on status change (check the README table).

- [ ] **Step 5: Full verification, commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint . && pnpm exec oxfmt --check . && pnpm test && pnpm test:e2e`
Expected: all green; screenshots for every page and mode in `e2e/screenshots/` (report them in chat).

```bash
git add -A components/chat components/ui components/shared hooks lib/core e2e package.json pnpm-lock.yaml docs CLAUDE.md
git commit -m "chore(chat): remove the old chat code and its dependencies; docs, screenshots and ADR status for sub-project 2" -m "Deletes the Tailwind/Lucide/Radix chat tree, hooks/useX and the zustand chat store, removes the packages nothing imports any more, adds agent, HITL, workflow and completion screenshots, updates frontend-conventions (CSS-breakpoint rule, lint re-check), auth-gate, i18n-maintenance, CLAUDE.md and the foundation spec's drift note, dates ADR-0006/0008/0010 and accepts ADR-0016/0017/0018." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01RaL8KWES4BNuKBeqmvJ6T3"
```

(`git add -A` is scoped to the listed paths here because the task is a deletion sweep; check `git status` before committing.)

---

### Task 20: Docker gate, PR, and the two superseded PRs

**Spec:** §14. CLAUDE.md "Docker stack (the real check before merging)".

- [ ] **Step 1: Rebuild the image from the branch and run the curl checks**

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app      # ~2 min; do not run alongside pnpm test:e2e on the 5 GB machine
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5300/api/health                      # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:5300/apps            # 307 http://localhost:5300/login?callbackUrl=%2Fapps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5300/api/client/apps                 # 401
curl -s http://localhost:5300/login | grep -c 'id="antd-cssinjs"'                             # 1
curl -s -H 'Cookie: theme=dark; theme-mode=dark' http://localhost:5300/login | grep -c 'class="antialiased dark"'   # 1
curl -s -H 'Cookie: theme=dark; theme-mode=dark' http://localhost:5300/login | grep -c -- '--ant-color-bg-layout:#000000'  # 1
```

If the build is killed for memory, stop and report; do not restart it unprompted (CLAUDE.md).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/chat-on-ant-design-x
gh pr create -R LovingCivilian/dify-app-hub --base fork/main --title "feat(chat): rebuild the chat on Ant Design X (frontend overhaul, sub-project 2)" --body-file "$CLAUDE_JOB_DIR/tmp/pr-body.md"
```

Write `$CLAUDE_JOB_DIR/tmp/pr-body.md` following `.github/PULL_REQUEST_TEMPLATE.md`: Overview (one paragraph: the chat on X for every app mode, server gate, cookie theme, stub catalogue, race fixed), Changes table (one row per area: gate, theme, header, markdown, stub, provider/data layer, chat view, HITL, footer, sender, mobile, workflow/completion, X locale, cleanup/docs), Testing (the vitest count, `pnpm test:e2e` totals per project, antd lint numbers, the six curl checks, what the owner still verifies in the browser against a real Dify server), Related Issue (none; "Implements ADR-0016, ADR-0017, ADR-0018; notes ADR-0006, 0008, 0010, 0011, 0014; supersedes #7 and #8"), then the two attribution lines from the session (`🤖 Generated with [Claude Code](https://claude.com/claude-code)` and the session URL).

- [ ] **Step 3: Close #7 and #8 as superseded — after the owner says so in chat**

Prepare the comments (do not post until the owner confirms):

```bash
gh pr comment 7 -R LovingCivilian/dify-app-hub --body "Superseded by the chat rebuild (sub-project 2 PR): live assistant messages carry the Dify message id and created_at from StreamEventBase, feedback posts that id and is hidden without one. Closing."
gh pr comment 8 -R LovingCivilian/dify-app-hub --body "Superseded by the chat rebuild (sub-project 2 PR): a selected like is coloured with antd's colorSuccess through Actions.Feedback's liked slot and a dislike with colorError, in both schemes, without Tailwind classes. Closing."
gh pr close 7 -R LovingCivilian/dify-app-hub && gh pr close 8 -R LovingCivilian/dify-app-hub
```

- [ ] **Step 4: Report**

Report to the owner: the PR link, the verification numbers, the screenshots to look at, what to check in the browser against a real Dify server (each app mode, HITL, files, TTS/STT, dark-mode first paint, mobile), and that the handoff document is the next step (user-level `handoff` skill, `docs/superpowers/handoffs/2026-10-04-chat-on-ant-design-x.md`).

---

## Execution notes

- **Order and dependencies.** Tasks 1 → 2 → 3 are sequential (each edits the root layout or header). Task 4 (spike) and Task 5 (stub) are independent of each other and of 1–3; run them after Task 3 so every e2e run exercises the server gate. Tasks 6 → 7 → 8 build the data layer and have no UI; 9 wires the page and must come after 5 and 8. Tasks 10–16 extend the view in any order except 12 after 11 and 13 after 12; 17 needs 10 and 11; 18 is independent; 19 and 20 are last.
- **e2e cost.** `pnpm test:e2e` takes several minutes on the owner's machine (cold Turbopack compiles). Per task run only the specs the task touches (the commands above name them); run the full suite at Tasks 1, 2, 5, 9, 17 and 19. Never run `pnpm dev`, a second `next dev`, or the Docker build while the suite runs.
- **Reviews.** Every task gets a fresh reviewer who checks: the docs source for each library API used (ADR-0002), token-only styling, i18n keys in all three files, accessible names on icon-only buttons, no second provider, no backend file touched, tests written before code. The whole-branch review at the end runs on the most capable model and re-reads the spec.
- **Reporting.** Each task report names the doc source per API decision, every deviation from this plan with its reason (the docs win over the plan, ADR-0002), the e2e counts per project, and screenshots paths when they changed.
- **Handoff.** The session ends with the handoff document (user-level `handoff` skill) under `docs/superpowers/handoffs/`, naming what merged, what the owner still verifies in the browser, and the sub-project 3 inputs (admin, apps and auth pages; the `LucideIcon` and store leftovers outside `components/chat/`).
