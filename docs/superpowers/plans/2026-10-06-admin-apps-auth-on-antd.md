# App list, admin and auth pages on antd — Implementation Plan (frontend overhaul, sub-project 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/apps`, `/app-management`, `/user-management`, `/login`, `/forgot-password`, `/reset-password`, `/init` and `/` on antd 6 and Next 16 conventions — server pages load the first paint, client components interact — with the owner's polish (load/error states, search and filter, Dify app icons), no lost feature, the known defects fixed, and e2e flows for app CRUD, user CRUD and login/reset.

**Architecture:** Each route's server `page.tsx` checks the session where it reads data, loads through existing server code (`repository/app.ts`, `actions.ts`, the new `lib/data/users.ts`, `lib/mail.ts`, `searchParams`), trims the data to plain props and renders one client component under `components/apps|admin|auth/`. Writes keep their endpoints and actions and end in `router.refresh()`; messages come from `App.useApp()`; `loading.tsx`/`error.tsx` (Next's `retry()`) give the load and error states. The admin pages keep calling Dify from the browser with the app's key (fetched with `getApp(id)` only when needed); the stub Dify API gains CORS, annotations and site variants so that path is testable.

**Tech Stack:** Next 16.3.4 (App Router, Cache Components off), React 19.2, antd 6.6.5, next-auth 4.24, react-i18next, drizzle (MySQL), Playwright 1.63 with the stub Dify API, vitest (node).

**Spec:** `docs/superpowers/specs/2026-10-06-admin-apps-auth-on-antd-design.md` — read it first; every task cites its sections.

## Global Constraints

- Documented approaches only (ADR-0002). Before using an antd API run `npx -y @ant-design/cli doc <Component>` (or `demo`, `info`; `.claude/skills/antd/SKILL.md`); Next APIs from `node_modules/next/dist/docs/`; React from Context7 `/websites/react_dev`. Name the source of every API decision in the task report. No `antd/es/...` imports, no `!important`, no patched packages.
- Versions: `antd` 6.6.5, `next` 16.3.4, `react` 19.2, `next-auth` 4.24. **No new dependency** (spec §11; `server-only` only if Task 7's fallback step applies).
- Styling (charter §4.3): antd component first; static styles in a colocated `*.module.css` with `var(--ant-*)` values only; runtime values through `theme.useToken()`; breakpoint differences by one mobile-first `@media (min-width: 768px /* screenMD */)` query; no hex/rgb/oklch literals, magic pixel numbers, Tailwind classes, `--theme-*`/shadcn classes, Lucide icons; Drawer sizes by name (`size="large"` or the default), never pixels; `Flex` for layout.
- Exactly one `XProvider` + `App` at the root. Messages and confirms through `App.useApp()`; no static `message.*`/`Modal.*` call remains in the touched files.
- All UI text through i18next keys present in `locales/en`, `locales/zh` and `locales/ar` (typed; `pnpm test` checks key and placeholder parity; no `count` interpolation name; never run `i18next-cli extract/sync`). Arabic is Modern Standard Arabic with Arabic-Indic digits (ADR-0005). Product terms ("Dify App Hub", "API Base", "API Secret") are the only literal labels. Icon-only buttons carry `aria-label` and `title` from keys (ADR-0014).
- `app/` is routing only; server components by default; `'use client'` on components that use hooks or handle events; URLs never change.
- Backend untouched: nothing under `app/api/**`, `db/**`, `repository/`, `services/`, `lib/auth*`, `lib/dify-client.ts`, `proxy.ts`, `app/(admin)/app-management/actions.ts`, `app/(admin)/app-management/utils.ts`. Allowed outside the pages: line-level edits to `lib/api/client.ts` (Task 6) and `lib/api/base-request.ts` (Task 4); new fork-owned `lib/data/users.ts` (Task 7), `lib/match-query.ts` (Task 3), `lib/search-params.ts` (Task 8). The chat (`components/chat/**`, `app/(user)/chat/**`) is not touched.
- Unit tests: vitest in `__tests__/` (node environment, no DOM tests). Server pages are async functions called directly with their modules mocked through `vi.hoisted` + `vi.mock`, as `__tests__/group-layouts.test.ts` does.
- e2e: Playwright specs in `e2e/` (web-first assertions, role and name locators, `test.skip(condition, reason)` for project-specific cases, never `networkidle`). The suite runs three projects one after another on a database that survives between runs, so every row or user a spec creates carries the project name and is deleted in `finally`/`afterEach`. Run a task's specs with `pnpm exec playwright test e2e/<file>.spec.ts` (the `setup` project runs first by itself); `pnpm dev` must be stopped (one `next dev` per checkout).
- Before every commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --write <changed files>` (lint-staged re-runs them), `pnpm test`.
- Commits: conventional (`feat|fix|test|docs|chore(scope): …`), English, ending with the trailer below; `git add <paths>` (never `-A`); no push until Task 11 asks the owner.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- Memory on this machine (~5 GB): never run the Docker build and `pnpm test:e2e` at the same time.
- After a successful write call `router.refresh()` plainly (spec §3.5). Wrapping it in `startTransition` for a pending state is allowed only if `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` documents it in this version (spec §13); check before adding it, and leave it out otherwise.

## Review Focus

Five conditions the spec implies but no feature flow pins on its own; each has its test in the task named.

1. **Dify answers with an error body instead of app info** (wrong key → 401, an unknown path → a JSON error): create and sync must show the translated error and never save an app without a name. `lib/api` resolves any JSON answer as a value. Unit test for `isAppInfo` in Task 4; e2e "a bad API base keeps the drawer open" in Task 5.
2. **Search text with surrounding spaces or another case** (`"  STUB "`, an all-space query): it must match case-insensitively, ignore the spaces, and an empty query shows everything. Unit tests for `matchesQuery` in Task 3.
3. **Closing the edit drawer before its record arrives, or opening another app meanwhile**: the late answer must not reopen the drawer or fill it with the wrong app. Unit test for `acceptRecord` in Task 5.
4. **A browser time zone other than the server's** (the container runs UTC): user dates show in the browser's zone with no hydration warning. e2e with `timezoneId: 'Pacific/Kiritimati'` in Task 7.
5. **A phone-width viewport** (390 px): `/apps` and `/app-management` never scroll sideways as a page; the admin table scrolls inside its own container. e2e on `mobile-light` in Tasks 3 and 4.

---

## File structure

```
e2e/fixtures/stub/apps.ts, router.ts, store.ts   CORS, annotations, site variants, extra apps          (Task 1)
e2e/fixtures/constants.ts, db.ts                 extra app constants, withDb()                          (Task 1)
e2e/auth.setup.ts                                seeds the disabled and no-site apps                    (Task 1)
components/apps/app-icon-kind.ts, app-icon.tsx   Dify site → icon; the icon component                    (Task 2)
lib/match-query.ts                               case-insensitive multi-field search                     (Task 3)
components/apps/app-summary.ts                   AppSummary, toAppSummaries (enabled only, trimmed)      (Task 3)
components/apps/app-gallery.tsx, app-card.tsx, app-gallery-skeleton.tsx, app-gallery.module.css      (Task 3)
components/shell/route-error.tsx                 Result + Retry for every error.tsx                      (Task 3)
app/(user)/apps/page.tsx, loading.tsx, error.tsx                                                         (Task 3)
components/admin/admin-page-header.tsx(.module.css)  title, subtitle, primary action                     (Task 4)
components/shell/admin-shell.tsx, shell.module.css   content padding by CSS                              (Task 4)
components/admin/apps/admin-app-row.ts           AdminAppRow, toAdminAppRows, supportsAnnotations        (Task 4)
components/admin/apps/app-record.ts              isAppInfo, isFailedUpdate, isAnnotationPage             (Tasks 4, 6)
components/admin/apps/app-management.tsx(.module.css), app-actions.tsx                                   (Tasks 4–6)
app/(admin)/loading.tsx, error.tsx, app-management/page.tsx                                              (Task 4)
lib/api/base-request.ts                          401 without the static message                          (Task 4)
components/admin/apps/app-form-values.ts         form ↔ item conversion, status Switch props             (Task 5)
components/admin/apps/use-app-record.ts          getApp loader with acceptRecord                         (Task 5)
components/admin/apps/app-settings-fields.tsx, app-form-drawer.tsx                                       (Task 5)
lib/api/client.ts                                getAnnotationList keyword                               (Task 6)
components/admin/apps/annotations-drawer.tsx, annotation-form-modal.tsx                                  (Task 6)
lib/data/users.ts                                listUsers, hasUsers (server-only)                       (Task 7)
components/admin/users/user-row.ts, user-errors.ts, user-management.tsx, user-form-drawer.tsx            (Task 7)
components/admin/client-date-time.tsx                                                                    (Task 7)
app/(admin)/user-management/page.tsx                                                                     (Task 7)
lib/search-params.ts                             firstParam                                              (Task 8)
components/shell/auth-card.tsx(.module.css)      CSS Module, brand header                                (Task 8)
components/auth/login-form.tsx(.module.css)                                                              (Task 8)
app/page.tsx, app/(auth)/error.tsx, app/(auth)/login/page.tsx                                            (Task 8)
components/auth/forgot-password-form.tsx, reset-password-form.tsx                                       (Task 9)
app/(auth)/forgot-password/page.tsx, app/(auth)/reset-password/page.tsx                                  (Task 9)
components/auth/init-form.tsx, init-failure.ts; app/init/page.tsx, error.tsx                             (Task 10)
e2e/apps.spec.ts, admin-apps.spec.ts, admin-users.spec.ts, auth.spec.ts                                  (Tasks 3–10)
e2e/theme-aliases.spec.ts, ssr-first-paint.spec.ts, screenshots.spec.ts                                  (Tasks 3, 4, 7, 11)
docs/decisions/0020-…md, README.md; docs/frontend-conventions.md; CLAUDE.md; .cii-assessment.md          (Task 11)
```

Deleted: `components/shared/` (Task 3); `app/(admin)/app-management/components/`, `app/(admin)/app-management/enums.ts` (Task 4); `app/(admin)/user-management/components/` (Task 7).

---
### Task 1: Stub Dify API and seed for the admin pages

The admin pages call Dify from the browser, so the stub needs Dify's CORS behaviour, the annotation list/update/delete endpoints, per-app `/site` variants and two extra seeded apps (spec §9.3). Test-only files; no product code.

**Files:**
- Modify: `e2e/fixtures/stub/apps.ts` (prefix type, optional fields, extra apps, `appFromPath`)
- Modify: `e2e/fixtures/stub/store.ts` (annotations per app)
- Modify: `e2e/fixtures/stub/router.ts` (CORS, `/info`, `/site`, annotations)
- Modify: `e2e/fixtures/constants.ts`; Create: `e2e/fixtures/db.ts`
- Modify: `e2e/auth.setup.ts` (seed loop)
- Test: `__tests__/stub-router.test.ts`, `__tests__/stub-events.test.ts`

**Interfaces:**
- Produces: `DISABLED_APP`, `NO_SITE_APP`, `CREATED_APP`, `SEEDED_EXTRA_APPS` (from `e2e/fixtures/constants.ts`), each a `StubApp` with `id`, `name`, `mode`, `prefix`; `withDb<T>(fn: (db: Connection) => Promise<T>): Promise<T>` (from `e2e/fixtures/db.ts`). Names: `'Stub disabled'` (chat, `/disabled`, `isEnabled: 2`), `'Stub no-site'` (workflow, `/nosite`, `site: 'none'`), `'Created app'` (chat, `/created`, `site: 'image'`, not seeded). None of the names contains the text "Stub app", so `getByText('Stub app')` in older specs stays unambiguous.

- [ ] **Step 1: Write the failing stub tests**

Append to `__tests__/stub-events.test.ts` inside `describe('modeFromPath', …)`:

```ts
	it('knows the sub-project 3 prefixes and tells which app a path belongs to', () => {
		expect(modeFromPath('/v1/nosite/parameters')).toEqual({ mode: 'workflow', path: '/parameters' })
		expect(modeFromPath('/v1/created/info')).toEqual({ mode: 'chat', path: '/info' })
		expect(appFromPath('/v1/disabled/site').name).toBe('Stub disabled')
		expect(appFromPath('/v1/info').name).toBe('Stub app')
	})
```

and add `appFromPath` to that file's import from `@/e2e/fixtures/stub/apps`.

Append to `__tests__/stub-router.test.ts`:

```ts
describe('stub router for the admin pages (sub-project 3)', () => {
	it("answers a CORS preflight and puts the CORS headers on every answer, as Dify's service API does", async () => {
		const preflight = await fetch(`${base}/v1/info`, { method: 'OPTIONS' })
		expect(preflight.status).toBe(200)
		expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
		expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
		expect(preflight.headers.get('access-control-allow-methods')).toContain('DELETE')
		const info = await fetch(`${base}/v1/info`)
		expect(info.headers.get('access-control-allow-origin')).toBe('*')
	})

	it('names the app behind each prefix in /info', async () => {
		expect(await (await fetch(`${base}/v1/info`)).json()).toMatchObject({ name: 'Stub app', mode: 'chat' })
		expect(await (await fetch(`${base}/v1/created/info`)).json()).toMatchObject({
			name: 'Created app',
			mode: 'chat',
		})
		expect(await (await fetch(`${base}/v1/nosite/info`)).json()).toMatchObject({
			name: 'Stub no-site',
			mode: 'workflow',
		})
	})

	it("serves an emoji site by default, an image site for the created app and Dify's 403 without a site", async () => {
		expect(await (await fetch(`${base}/v1/site`)).json()).toMatchObject({
			icon_type: 'emoji',
			icon: '🤖',
		})
		expect(await (await fetch(`${base}/v1/created/site`)).json()).toMatchObject({
			icon_type: 'image',
			icon_url: expect.stringContaining('/files/stub-image.png'),
		})
		const none = await fetch(`${base}/v1/nosite/site`)
		expect(none.status).toBe(403)
		expect(await none.json()).toMatchObject({ code: 'forbidden', status: 403 })
	})

	it('keeps annotations per app: create, newest-first paging, keyword, update, delete', async () => {
		type Page = { data: { id: string; question: string; answer: string }[] } & Record<string, unknown>
		const list = async (query: string) =>
			(await (await fetch(`${base}/v1/chatflow/apps/annotations${query}`)).json()) as Page
		for (const question of ['first question', 'second question', 'third thing']) {
			const created = await post('/v1/chatflow/apps/annotations', {
				question,
				answer: `answer to ${question}`,
			})
			expect(created.status).toBe(201)
		}
		const first = await list('?page=1&limit=2')
		expect(first).toMatchObject({ total: 3, has_more: true, page: 1, limit: 2 })
		expect(first.data.map(a => a.question)).toEqual(['third thing', 'second question'])
		expect((await list('?keyword=QUESTION')).data.map(a => a.question)).toEqual([
			'second question',
			'first question',
		])
		// Another app's annotations are its own.
		expect((await (await fetch(`${base}/v1/apps/annotations`)).json()).total).toBe(0)

		const target = first.data[0]
		const updated = await fetch(`${base}/v1/chatflow/apps/annotations/${target.id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ question: 'third thing', answer: 'changed' }),
		})
		expect(updated.status).toBe(200)
		expect(await updated.json()).toMatchObject({ id: target.id, answer: 'changed' })

		const removed = await fetch(`${base}/v1/chatflow/apps/annotations/${target.id}`, {
			method: 'DELETE',
		})
		expect(removed.status).toBe(204)
		expect((await list('')).total).toBe(2)
		const again = await fetch(`${base}/v1/chatflow/apps/annotations/${target.id}`, {
			method: 'DELETE',
		})
		expect(again.status).toBe(404)
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/stub-router.test.ts __tests__/stub-events.test.ts`
Expected: FAIL (`appFromPath` is not exported; no CORS header; `/v1/created/info` answers 404; no annotation list).

- [ ] **Step 3: Extend `e2e/fixtures/stub/apps.ts`**

Replace the `StubPrefix` line and the `StubApp` interface:

```ts
export type StubPrefix =
	| ''
	| '/agent'
	| '/chatflow'
	| '/workflow'
	| '/completion'
	| '/disabled'
	| '/nosite'
	| '/created'

export interface StubApp {
	id: string
	name: string
	mode: StubMode
	prefix: StubPrefix
	/** Seeded into `dify_apps.opening_statement_display_mode`: 'always' keeps the welcome panel after the first reply. */
	openingStatementDisplayMode: 'default' | 'always'
	/** Seeded into `dify_apps.enable_annotation` (the app's `extConfig.annotation.enabled`): the footer offers "Annotation". */
	enableAnnotation: boolean
	/** GET /site: an emoji icon (default), an image icon, or Dify's 403 for an app without a site. */
	site?: 'emoji' | 'image' | 'none'
	/** Seeded into `dify_apps.is_enabled` (1 enabled, 2 disabled); 1 when absent. */
	isEnabled?: 1 | 2
}
```

After `APP_IDS`, add the extra apps, and replace `modeFromPath` with the shared matcher:

```ts
/**
 * Sub-project 3 fixtures, kept out of STUB_APPS so APP_IDS keeps one id per mode for the chat specs.
 * The disabled and no-site apps are seeded by e2e/auth.setup.ts; the created app is not — the admin
 * spec creates it through the form, and its /info answers a name of its own and its /site an image icon.
 */
export const DISABLED_APP: StubApp = {
	id: 'e2e00000-0000-4000-8000-000000000006',
	name: 'Stub disabled',
	mode: 'chat',
	prefix: '/disabled',
	openingStatementDisplayMode: 'default',
	enableAnnotation: false,
	isEnabled: 2,
}
export const NO_SITE_APP: StubApp = {
	id: 'e2e00000-0000-4000-8000-000000000007',
	name: 'Stub no-site',
	mode: 'workflow',
	prefix: '/nosite',
	openingStatementDisplayMode: 'default',
	enableAnnotation: false,
	site: 'none',
}
export const CREATED_APP: StubApp = {
	id: 'e2e00000-0000-4000-8000-000000000008',
	name: 'Created app',
	mode: 'chat',
	prefix: '/created',
	openingStatementDisplayMode: 'default',
	enableAnnotation: false,
	site: 'image',
}
export const SEEDED_EXTRA_APPS: StubApp[] = [DISABLED_APP, NO_SITE_APP]
const ALL_STUB_APPS = [...STUB_APPS, ...SEEDED_EXTRA_APPS, CREATED_APP]

const matchPrefix = (pathname: string): { app: StubApp; path: string } => {
	const stripped = pathname.replace(/^\/v1/, '')
	for (const app of ALL_STUB_APPS) {
		if (app.prefix && (stripped === app.prefix || stripped.startsWith(`${app.prefix}/`))) {
			return { app, path: stripped.slice(app.prefix.length) || '/' }
		}
	}
	return { app: STUB_APPS[0], path: stripped || '/' }
}

/** `/v1/<prefix>/<dify path>` → the app mode and the Dify path. Unprefixed `/v1/...` is the chat app. */
export const modeFromPath = (pathname: string): { mode: StubMode; path: string } => {
	const { app, path } = matchPrefix(pathname)
	return { mode: app.mode, path }
}

/** The app a stub path belongs to (its name, site variant and annotation store). */
export const appFromPath = (pathname: string): StubApp => matchPrefix(pathname).app
```

- [ ] **Step 4: Annotations in `e2e/fixtures/stub/store.ts`**

Append:

```ts
/** One item of GET /apps/annotations (OpenAPI: AnnotationItem), as the stub stores it. */
export interface StoredAnnotation {
	id: string
	question: string
	answer: string
	hit_count: number
	created_at: number
}

const annotations = new Map<string, StoredAnnotation[]>()
/** Dify keeps annotations per app; the stub keys them by the stub app's id. Newest first. */
export const annotationsFor = (appId: string): StoredAnnotation[] => {
	let list = annotations.get(appId)
	if (!list) {
		list = []
		annotations.set(appId, list)
	}
	return list
}
```

- [ ] **Step 5: Router — CORS, `/info`, `/site`, annotations**

In `e2e/fixtures/stub/router.ts`:

1. Import `appFromPath` next to `modeFromPath`, and `annotationsFor` from `./store`.
2. Below the `difyError` helper add:

```ts
/**
 * Dify's service API answers cross-origin calls: flask-cors defaults on the service_api blueprint (any origin,
 * no credentials; api/extensions/ext_blueprints.py). The admin pages call it from the browser with the app's key.
 */
const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': 'Content-Type, X-App-Code, X-App-Passport, Authorization',
	'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS, PATCH',
	'access-control-expose-headers': 'X-Version, X-Env, X-Trace-Id, X-Dify-Catalog',
}
```

3. First lines of `handle`, right after `const method = …`:

```ts
	// setHeader values are merged into every later writeHead (Node http), so each answer carries them.
	for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
	if (method === 'OPTIONS') {
		res.writeHead(200)
		return res.end()
	}
```

4. Below `const { mode, path } = modeFromPath(url.pathname)` add `const matched = appFromPath(url.pathname)`.
5. Replace the `/info` and `/site` blocks:

```ts
	if (method === 'GET' && path === '/info') {
		return json(res, 200, {
			name: matched.name,
			description: 'e2e',
			tags: [],
			mode: matched.mode,
			author_name: 'e2e',
		})
	}
	if (method === 'GET' && path === '/site') {
		// Dify answers 403 forbidden when the app has no site (OpenAPI getChatWebAppSettings).
		if (matched.site === 'none') return difyError(res, 403, 'forbidden', 'Site not found.')
		const icon =
			matched.site === 'image'
				? { icon_type: 'image', icon: 'stub-icon-file', icon_url: fileUrl, icon_background: null }
				: { icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5', icon_url: null }
		return json(res, 200, {
			title: matched.name,
			...icon,
			description: 'e2e',
			default_language: 'en-US',
			chat_color_theme: '',
			show_workflow_steps: true,
			use_icon_as_answer_icon: false,
			custom_disclaimer: 'Answers come from the stub.',
		})
	}
```

6. Replace the existing `if (method === 'POST' && path === '/apps/annotations') { … }` block with:

```ts
	if (path === '/apps/annotations' || path.startsWith('/apps/annotations/')) {
		const annotations = annotationsFor(matched.id)
		const invalid = () => difyError(res, 400, 'invalid_param', 'question and answer are required.')
		if (method === 'GET' && path === '/apps/annotations') {
			// Newest first; `keyword` filters question or answer; `limit` ≤ 100 (OpenAPI GET /apps/annotations).
			const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase()
			const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
			const limit = limitOf(url)
			const found = keyword
				? annotations.filter(
						a =>
							a.question.toLowerCase().includes(keyword) ||
							a.answer.toLowerCase().includes(keyword),
					)
				: annotations
			return json(res, 200, {
				data: found.slice((page - 1) * limit, page * limit),
				has_more: page * limit < found.length,
				limit,
				total: found.length,
				page,
			})
		}
		if (method === 'POST' && path === '/apps/annotations') {
			const body = await parseJson(req, res)
			if (!body) return
			if (typeof body.question !== 'string' || typeof body.answer !== 'string') return invalid()
			const item = {
				id: randomUUID(),
				question: body.question,
				answer: body.answer,
				hit_count: 0,
				created_at: now(),
			}
			annotations.unshift(item)
			return json(res, 201, item)
		}
		const index = annotations.findIndex(a => a.id === idAt(path, 3))
		if (method === 'PUT') {
			const body = await parseJson(req, res)
			if (!body) return
			if (typeof body.question !== 'string' || typeof body.answer !== 'string') return invalid()
			if (index < 0) return difyError(res, 404, 'not_found', 'Annotation not found.')
			annotations[index] = { ...annotations[index], question: body.question, answer: body.answer }
			return json(res, 200, annotations[index])
		}
		if (method === 'DELETE') {
			if (index < 0) return difyError(res, 404, 'not_found', 'Annotation not found.')
			annotations.splice(index, 1)
			res.writeHead(204)
			return res.end()
		}
	}
```

- [ ] **Step 6: Run the stub tests**

Run: `pnpm exec vitest run __tests__/stub-router.test.ts __tests__/stub-events.test.ts`
Expected: PASS (the older cases too).

- [ ] **Step 7: Constants, the db helper and the seed**

`e2e/fixtures/constants.ts` — replace the re-export line:

```ts
export {
	APP_IDS,
	CREATED_APP,
	DISABLED_APP,
	NO_SITE_APP,
	SEEDED_EXTRA_APPS,
	STUB_APPS,
} from './stub/apps'
```

Create `e2e/fixtures/db.ts`:

```ts
import mysql from 'mysql2/promise'

import { e2eEnv } from './env'

/**
 * One connection to the e2e MySQL for a spec's own rows. The suite's database survives between runs, so a
 * spec deletes what it created in `finally`.
 */
export const withDb = async <T>(fn: (db: mysql.Connection) => Promise<T>): Promise<T> => {
	const db = await mysql.createConnection(e2eEnv.DATABASE_URL)
	try {
		return await fn(db)
	} finally {
		await db.end()
	}
}
```

`e2e/auth.setup.ts` — import `SEEDED_EXTRA_APPS` next to `STUB_APPS`, loop over both and seed `is_enabled`:

```ts
	for (const app of [...STUB_APPS, ...SEEDED_EXTRA_APPS]) {
		// A database that survives between runs keeps its rows: the display mode, the annotation switch and the
		// status are refreshed on them.
		await db.execute(
			'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, enable_annotation, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE opening_statement_display_mode = ?, enable_annotation = ?, is_enabled = ?',
			[
				app.id,
				app.name,
				app.mode,
				'Seeded for the e2e suite',
				`${stubApiBase}${app.prefix}`,
				'app-e2e',
				app.openingStatementDisplayMode,
				app.enableAnnotation,
				app.isEnabled ?? 1,
				app.openingStatementDisplayMode,
				app.enableAnnotation,
				app.isEnabled ?? 1,
			],
		)
	}
```

- [ ] **Step 8: Run the setup and the harness against the new seed**

Run: `pnpm exec playwright test e2e/harness.spec.ts e2e/smoke.spec.ts`
Expected: PASS on all three projects (the setup seeds seven apps; the old app list still renders them).

- [ ] **Step 9: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint e2e __tests__/stub-router.test.ts __tests__/stub-events.test.ts && pnpm exec oxfmt --write e2e/fixtures e2e/auth.setup.ts __tests__/stub-router.test.ts __tests__/stub-events.test.ts && pnpm test
git add e2e/fixtures e2e/auth.setup.ts __tests__/stub-router.test.ts __tests__/stub-events.test.ts
git commit -m "test(e2e): stub CORS, annotations and site variants; seed a disabled and a no-site app

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The app icon

A Dify site's icon on an app card and in the admin table, or the mode icon when the app has none (spec §4.3). The pure decision is unit-tested; the component is exercised by Task 3's e2e.

**Files:**
- Create: `components/apps/app-icon-kind.ts`, `components/apps/app-icon.tsx`
- Test: `__tests__/app-icon-kind.test.ts`

**Interfaces:**
- Produces: `type AppIconKind = { kind: 'emoji'; emoji: string; background?: string } | { kind: 'image'; src: string } | { kind: 'mode' }`; `toAppIconKind(answer: unknown): AppIconKind`; default export `AppIcon({ appId: string; mode?: AppModeEnums; size?: 'large' | 'small' })` (client component).

- [ ] **Step 1: Write the failing test**

`__tests__/app-icon-kind.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { toAppIconKind } from '@/components/apps/app-icon-kind'

// The proxy answers `{ code, data }`: Dify's site on success, Dify's error body on failure (lib/api-utils.ts).
const site = (data: unknown) => ({ code: 200, data })

describe('toAppIconKind', () => {
	it('reads an emoji icon with its background', () => {
		expect(toAppIconKind(site({ icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5' }))).toEqual({
			kind: 'emoji',
			emoji: '🤖',
			background: '#FFEAD5',
		})
	})

	it('reads an emoji icon without a background', () => {
		expect(toAppIconKind(site({ icon_type: 'emoji', icon: '🧠', icon_background: null }))).toEqual({
			kind: 'emoji',
			emoji: '🧠',
			background: undefined,
		})
	})

	it('reads an image icon from icon_url, and a link icon from icon', () => {
		expect(toAppIconKind(site({ icon_type: 'image', icon: 'file-id', icon_url: 'https://x/i.png' }))).toEqual({
			kind: 'image',
			src: 'https://x/i.png',
		})
		expect(toAppIconKind(site({ icon_type: 'link', icon: 'https://x/l.png', icon_url: null }))).toEqual({
			kind: 'image',
			src: 'https://x/l.png',
		})
	})

	it('falls back to the mode icon for anything else', () => {
		// Dify's 403 for an app without a site, passed through by the proxy.
		expect(toAppIconKind({ code: 403, data: { code: 'forbidden', message: 'x', status: 403 } })).toEqual({
			kind: 'mode',
		})
		expect(toAppIconKind(site({ icon_type: 'image', icon: 'file-id', icon_url: null }))).toEqual({ kind: 'mode' })
		expect(toAppIconKind(site({ icon_type: 'emoji', icon: '' }))).toEqual({ kind: 'mode' })
		expect(toAppIconKind(site({ icon_type: 'sticker', icon: 'x' }))).toEqual({ kind: 'mode' })
		expect(toAppIconKind({ error: 'fetch failed' })).toEqual({ kind: 'mode' })
		expect(toAppIconKind(null)).toEqual({ kind: 'mode' })
		expect(toAppIconKind('<html>')).toEqual({ kind: 'mode' })
	})
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run __tests__/app-icon-kind.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `components/apps/app-icon-kind.ts`**

```ts
export type AppIconKind =
	| { kind: 'emoji'; emoji: string; background?: string }
	| { kind: 'image'; src: string }
	| { kind: 'mode' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * The icon an app's Dify site names (GET /api/client/dify/{id}/site answers `{ code, data }`).
 * Dify's IconType is image | emoji | link (api/models/model.py); `icon_url` is set only for image
 * (api/controllers/common/fields.py). Anything else — Dify's 403 without a site, an error body, an older Dify —
 * is the mode icon (spec §4.3).
 */
export const toAppIconKind = (answer: unknown): AppIconKind => {
	const site = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined
	if (!site) return { kind: 'mode' }
	if (site.icon_type === 'emoji' && filled(site.icon)) {
		return {
			kind: 'emoji',
			emoji: site.icon,
			background: filled(site.icon_background) ? site.icon_background : undefined,
		}
	}
	if (site.icon_type === 'image' && filled(site.icon_url)) return { kind: 'image', src: site.icon_url }
	if (site.icon_type === 'link' && filled(site.icon)) return { kind: 'image', src: site.icon }
	return { kind: 'mode' }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run __tests__/app-icon-kind.test.ts`
Expected: PASS.

- [ ] **Step 5: The component `components/apps/app-icon.tsx`**

Check first: `npx -y @ant-design/cli doc Avatar` (`shape`, `size`, `src`, `icon`, `alt`) and `npx -y @ant-design/cli doc Skeleton` (`Skeleton.Avatar`).

```tsx
'use client'

import {
	ApartmentOutlined,
	AppstoreOutlined,
	DeploymentUnitOutlined,
	FileTextOutlined,
	MessageOutlined,
	RobotOutlined,
} from '@ant-design/icons'
import { Avatar, Skeleton } from 'antd'
import { useEffect, useState } from 'react'

import { AppModeEnums } from '@/lib/core'

import { type AppIconKind, toAppIconKind } from './app-icon-kind'

const MODE_ICONS: Record<AppModeEnums, React.ReactNode> = {
	[AppModeEnums.CHATBOT]: <MessageOutlined />,
	[AppModeEnums.AGENT]: <RobotOutlined />,
	[AppModeEnums.CHATFLOW]: <ApartmentOutlined />,
	[AppModeEnums.WORKFLOW]: <DeploymentUnitOutlined />,
	[AppModeEnums.TEXT_GENERATOR]: <FileTextOutlined />,
}

/**
 * The app's Dify icon from its site settings through the existing proxy route, or its mode icon when the app
 * has none (spec §4.3). One request per rendered icon (spec §12 records the sync-time alternative).
 */
export default function AppIcon({
	appId,
	mode,
	size = 'large',
}: {
	appId: string
	mode?: AppModeEnums
	size?: 'large' | 'small'
}) {
	const [icon, setIcon] = useState<AppIconKind>()

	useEffect(() => {
		const controller = new AbortController()
		fetch(`/api/client/dify/${appId}/site`, { signal: controller.signal })
			.then(response => response.json())
			.then(answer => setIcon(toAppIconKind(answer)))
			.catch(() => {
				if (!controller.signal.aborted) setIcon({ kind: 'mode' })
			})
		return () => controller.abort()
	}, [appId])

	if (!icon) {
		return (
			<Skeleton.Avatar
				active
				shape="square"
				size={size}
			/>
		)
	}
	if (icon.kind === 'emoji') {
		// icon_background is Dify data (the colour the admin picked), passed through style, not a literal here.
		return (
			<Avatar
				shape="square"
				size={size}
				style={icon.background ? { backgroundColor: icon.background } : undefined}
			>
				{icon.emoji}
			</Avatar>
		)
	}
	if (icon.kind === 'image') {
		return (
			<Avatar
				shape="square"
				size={size}
				src={icon.src}
				alt=""
			/>
		)
	}
	return (
		<Avatar
			shape="square"
			size={size}
			icon={mode ? MODE_ICONS[mode] : <AppstoreOutlined />}
		/>
	)
}
```

- [ ] **Step 6: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint components/apps __tests__/app-icon-kind.test.ts && pnpm exec oxfmt --write components/apps __tests__/app-icon-kind.test.ts && pnpm test
git add components/apps/app-icon-kind.ts components/apps/app-icon.tsx __tests__/app-icon-kind.test.ts
git commit -m "feat(apps): app icon from the Dify site, with the mode icon as fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: `/apps` — server page, gallery, search, load and error states

Spec §3.1, §3.3, §4. The first server page of the pattern (ADR-0020 is written in Task 11; cite the spec until then).

**Files:**
- Create: `lib/match-query.ts`, `components/apps/app-summary.ts`, `components/apps/app-gallery.tsx`, `components/apps/app-card.tsx`, `components/apps/app-gallery-skeleton.tsx`, `components/apps/app-gallery.module.css`, `components/shell/route-error.tsx`, `app/(user)/apps/loading.tsx`, `app/(user)/apps/error.tsx`
- Replace: `app/(user)/apps/page.tsx`
- Modify: `locales/{en,zh,ar}/translation.json`, `e2e/theme-aliases.spec.ts`, `e2e/ssr-first-paint.spec.ts`
- Delete: `components/shared/index.ts`, `components/shared/lucide-icon.tsx`
- Test: `__tests__/match-query.test.ts`, `__tests__/app-summary.test.ts`, `__tests__/apps-page.test.ts`, `e2e/apps.spec.ts`

**Interfaces:**
- Consumes: `AppIcon` (Task 2); `DISABLED_APP`, `NO_SITE_APP` (Task 1).
- Produces: `matchesQuery(fields: ReadonlyArray<string | null | undefined>, query: string): boolean`; `type AppSummary = { id: string; missingInfo: false; name: string; description: string; mode?: AppModeEnums; tags: string[] } | { id: string; missingInfo: true }`; `toAppSummaries(items: IDifyAppItem[]): AppSummary[]`; default export `RouteError({ retry }: { retry: () => void })`; i18n keys `common.retry`, `common.load_failed`, `app.search_placeholder`, `app.no_match`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/match-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { matchesQuery } from '@/lib/match-query'

describe('matchesQuery', () => {
	it('matches any field case-insensitively and ignores surrounding spaces', () => {
		expect(matchesQuery(['Stub agent', 'Seeded'], '  STUB ')).toBe(true)
		expect(matchesQuery(['Alpha', undefined, null, 'support'], 'PORT')).toBe(true)
	})

	it('lets everything through for an empty or all-space query', () => {
		expect(matchesQuery(['Alpha'], '')).toBe(true)
		expect(matchesQuery(['Alpha'], '   ')).toBe(true)
	})

	it('rejects a query that no field contains', () => {
		expect(matchesQuery(['Alpha', 'Beta'], 'gamma')).toBe(false)
		expect(matchesQuery([undefined, null], 'a')).toBe(false)
	})

	it('matches Arabic and Chinese text', () => {
		expect(matchesQuery(['تطبيق المحادثة'], 'المحادثة')).toBe(true)
		expect(matchesQuery(['客服助手'], '助手')).toBe(true)
	})
})
```

`__tests__/app-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { toAppSummaries } from '@/components/apps/app-summary'
import { AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

const item = (over: Partial<IDifyAppItem> = {}): IDifyAppItem => ({
	id: 'a1',
	info: { name: 'Alpha', mode: AppModeEnums.CHATBOT, description: 'First app', tags: ['support'] },
	isEnabled: EIsEnabled.enabled,
	requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-secret' },
	...over,
})

describe('toAppSummaries', () => {
	it('keeps enabled apps and drops disabled ones, as /chat does', () => {
		const result = toAppSummaries([item(), item({ id: 'a2', isEnabled: EIsEnabled.disabled })])
		expect(result.map(app => app.id)).toEqual(['a1'])
	})

	it('trims each app to what a card shows', () => {
		expect(toAppSummaries([item()])).toEqual([
			{
				id: 'a1',
				missingInfo: false,
				name: 'Alpha',
				description: 'First app',
				mode: AppModeEnums.CHATBOT,
				tags: ['support'],
			},
		])
		expect(JSON.stringify(toAppSummaries([item()]))).not.toMatch(/app-secret|dify\.example/)
	})

	it('marks a row without info and defaults a missing description and tags', () => {
		expect(toAppSummaries([item({ info: undefined as unknown as IDifyAppItem['info'] })])).toEqual([
			{ id: 'a1', missingInfo: true },
		])
		const bare = item({
			info: { name: 'Bare' } as unknown as IDifyAppItem['info'],
		})
		expect(toAppSummaries([bare])[0]).toMatchObject({ description: '', tags: [] })
	})
})
```

`__tests__/apps-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppModeEnums, EIsEnabled } from '@/lib/core'

// vi.mock factories are hoisted above imports, so the mocks must be created with vi.hoisted.
const { requireSessionUser, getAppList, UserShell, AppGallery, redirectSignal } = vi.hoisted(() => ({
	requireSessionUser: vi.fn(),
	getAppList: vi.fn(),
	// Client component trees; the page test only checks the props it hands them.
	UserShell: () => null,
	AppGallery: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/session-user', () => ({ requireSessionUser }))
vi.mock('@/repository/app', () => ({ getAppList }))
vi.mock('@/components/shell/user-shell', () => ({ default: UserShell }))
vi.mock('@/components/apps/app-gallery', () => ({ default: AppGallery }))

import AppListPage from '@/app/(user)/apps/page'

const app = (id: string, isEnabled: EIsEnabled) => ({
	id,
	info: { name: `App ${id}`, mode: AppModeEnums.CHATBOT, description: '', tags: [] },
	isEnabled,
	requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-secret' },
})

describe('/apps page', () => {
	beforeEach(() => {
		requireSessionUser.mockReset()
		getAppList.mockReset()
	})

	it('checks the session before it reads the apps', async () => {
		requireSessionUser.mockRejectedValue(redirectSignal)
		await expect(AppListPage()).rejects.toBe(redirectSignal)
		expect(getAppList).not.toHaveBeenCalled()
	})

	it('hands the gallery the enabled apps, without their request config', async () => {
		requireSessionUser.mockResolvedValue(undefined)
		getAppList.mockResolvedValue([app('a1', EIsEnabled.enabled), app('a2', EIsEnabled.disabled)])
		const page = await AppListPage()
		expect(page).toMatchObject({
			type: UserShell,
			props: { children: { type: AppGallery, props: { apps: [{ id: 'a1', name: 'App a1' }] } } },
		})
		expect(page.props.children.props.apps).toHaveLength(1)
		expect(JSON.stringify(page.props.children.props)).not.toContain('app-secret')
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/match-query.test.ts __tests__/app-summary.test.ts __tests__/apps-page.test.ts`
Expected: FAIL (modules not found; the old page is a client component that renders `UserShell` with hooks).

- [ ] **Step 3: `lib/match-query.ts` and `components/apps/app-summary.ts`**

```ts
// lib/match-query.ts
/**
 * The search boxes of the app list and the admin tables (spec §4.4): true when any field contains the query,
 * case-insensitive, surrounding spaces ignored; an empty query lets everything through.
 */
export const matchesQuery = (fields: ReadonlyArray<string | null | undefined>, query: string): boolean => {
	const needle = query.trim().toLocaleLowerCase()
	if (!needle) return true
	return fields.some(field => field?.toLocaleLowerCase().includes(needle))
}
```

```ts
// components/apps/app-summary.ts
import { type AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

/** What an app card shows (spec §4.1) — nothing from requestConfig reaches the client. */
export type AppSummary =
	| {
			id: string
			missingInfo: false
			name: string
			description: string
			mode?: AppModeEnums
			tags: string[]
	  }
	| { id: string; missingInfo: true }

/** Enabled apps only, decided as `/chat`'s index does (`isEnabled !== EIsEnabled.disabled`), trimmed for the client. */
export const toAppSummaries = (items: IDifyAppItem[]): AppSummary[] =>
	items
		.filter(item => item.isEnabled !== EIsEnabled.disabled)
		.map(item =>
			item.info
				? {
						id: item.id,
						missingInfo: false,
						name: item.info.name,
						description: item.info.description ?? '',
						mode: item.info.mode,
						tags: item.info.tags ?? [],
					}
				: { id: item.id, missingInfo: true },
		)
```

- [ ] **Step 4: Locale keys (all three files)**

Add to the `common` object — en: `"retry": "Try again"`, `"load_failed": "This page could not be loaded"`; zh: `"retry": "重试"`, `"load_failed": "页面加载失败"`; ar: `"retry": "إعادة المحاولة"`, `"load_failed": "تعذّر تحميل هذه الصفحة"`.
Add to the `app` object — en: `"search_placeholder": "Search apps"`, `"no_match": "No apps match your search"`; zh: `"search_placeholder": "搜索应用"`, `"no_match": "没有符合搜索条件的应用"`; ar: `"search_placeholder": "البحث في التطبيقات"`, `"no_match": "لا توجد تطبيقات تطابق بحثك"`.

- [ ] **Step 5: `components/shell/route-error.tsx`**

Check: `npx -y @ant-design/cli doc Result` (`status`, `title`, `extra`); `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` (`retry`).

```tsx
'use client'

import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'

/**
 * The error screen of a route segment (spec §3.3), rendered by the error.tsx files. Translated text only: in
 * production a server error's message is replaced by a digest. `retry()` re-fetches and re-renders the segment
 * (Next 16.3, error.md).
 */
export default function RouteError({ retry }: { retry: () => void }) {
	const { t } = useTranslation()
	return (
		<Result
			status="error"
			title={t('common.load_failed')}
			extra={
				<Button
					type="primary"
					onClick={() => retry()}
				>
					{t('common.retry')}
				</Button>
			}
		/>
	)
}
```

- [ ] **Step 6: The gallery, the card and the skeleton**

Check: `npx -y @ant-design/cli doc Card` (`hoverable`, `Card.Meta`, `loading`), `doc Typography` (`Paragraph ellipsis`), `doc Input` (`allowClear`, `prefix`), `doc Empty` (`PRESENTED_IMAGE_SIMPLE`), `doc Grid` (`Row gutter`, `Col xs…xl`).

`components/apps/app-gallery.module.css`:

```css
/* The user shell's content region has no padding (the chat fills it edge to edge), so the app list frames itself
   (spec §3.4): mobile first, one query at antd's screenMD (docs/frontend-conventions.md §4.3.4). */
.page {
	padding: var(--ant-padding);
}
.title {
	margin: 0;
}
/* The link fills its column so every card in a row is as tall as the tallest. */
.cardLink {
	display: block;
	height: 100%;
	color: inherit;
}
.card {
	height: 100%;
}
.description {
	margin-block: var(--ant-margin-sm) 0;
}
.tags {
	margin-top: var(--ant-margin-sm);
}
@media (min-width: 768px /* screenMD */) {
	.page {
		padding: var(--ant-padding-lg);
	}
}
```

`components/apps/app-card.tsx`:

```tsx
'use client'

import { Card, Flex, Tag, Typography } from 'antd'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

import { AppModeNames } from '@/lib/core'

import styles from './app-gallery.module.css'
import AppIcon from './app-icon'
import type { AppSummary } from './app-summary'

/**
 * One app (spec §4.2): a real link around a hoverable Card, so the keyboard and "open in new tab" work. antd
 * documents no whole-card link pattern; this is plain HTML semantics. A row without info is not a link.
 */
export default function AppCard({ app }: { app: AppSummary }) {
	const { t } = useTranslation()
	if (app.missingInfo) {
		return (
			<Card className={styles.card}>
				<Typography.Text type="secondary">{t('app.info_missing')}</Typography.Text>
			</Card>
		)
	}
	return (
		<Link
			href={`/chat/${app.id}`}
			className={styles.cardLink}
		>
			<Card
				hoverable
				className={styles.card}
			>
				<Card.Meta
					avatar={
						<AppIcon
							appId={app.id}
							mode={app.mode}
						/>
					}
					title={app.name}
					description={app.mode ? t(AppModeNames[app.mode]) : undefined}
				/>
				<Typography.Paragraph
					type="secondary"
					ellipsis={{ rows: 2 }}
					className={styles.description}
				>
					{app.description || t('app.no_description_user')}
				</Typography.Paragraph>
				{app.tags.length > 0 && (
					<Flex
						wrap
						gap="small"
						className={styles.tags}
					>
						{app.tags.map(tag => (
							<Tag key={tag}>{tag}</Tag>
						))}
					</Flex>
				)}
			</Card>
		</Link>
	)
}
```

`components/apps/app-gallery.tsx`:

```tsx
'use client'

import { SearchOutlined } from '@ant-design/icons'
import { Col, Empty, Flex, Input, Row, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { matchesQuery } from '@/lib/match-query'

import AppCard from './app-card'
import styles from './app-gallery.module.css'
import type { AppSummary } from './app-summary'

/** The app list (spec §4.2, §4.4): title, search, a responsive card grid and the two empty states. */
export default function AppGallery({ apps }: { apps: AppSummary[] }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [query, setQuery] = useState('')
	// A row without info has nothing to search, so it shows only while the query is empty.
	const shown = apps.filter(app =>
		app.missingInfo
			? !query.trim()
			: matchesQuery([app.name, app.description, ...app.tags], query),
	)

	return (
		<Flex
			vertical
			gap={token.margin}
			className={styles.page}
		>
			<Typography.Title
				level={4}
				className={styles.title}
			>
				{t('app.list')}
			</Typography.Title>
			{apps.length === 0 ? (
				<Empty description={t('app.empty_contact_admin')} />
			) : (
				<>
					<Row>
						<Col
							xs={24}
							md={12}
							lg={8}
						>
							<Input
								allowClear
								prefix={<SearchOutlined />}
								placeholder={t('app.search_placeholder')}
								aria-label={t('app.search_placeholder')}
								value={query}
								onChange={event => setQuery(event.target.value)}
							/>
						</Col>
					</Row>
					{shown.length === 0 ? (
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={t('app.no_match')}
						/>
					) : (
						<Row gutter={[token.margin, token.margin]}>
							{shown.map(app => (
								<Col
									key={app.id}
									xs={24}
									sm={12}
									lg={8}
									xl={6}
								>
									<AppCard app={app} />
								</Col>
							))}
						</Row>
					)}
				</>
			)}
		</Flex>
	)
}
```

`components/apps/app-gallery-skeleton.tsx`:

```tsx
'use client'

import { Card, Col, Flex, Row, Skeleton, theme } from 'antd'

import styles from './app-gallery.module.css'

const PLACEHOLDER_CARDS = 4

/** The app list while its server page loads (app/(user)/apps/loading.tsx). */
export default function AppGallerySkeleton() {
	const { token } = theme.useToken()
	return (
		<Flex
			vertical
			gap={token.margin}
			className={styles.page}
		>
			<Skeleton
				active
				title
				paragraph={false}
			/>
			<Row gutter={[token.margin, token.margin]}>
				{Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
					<Col
						key={index}
						xs={24}
						sm={12}
						lg={8}
						xl={6}
					>
						<Card loading />
					</Col>
				))}
			</Row>
		</Flex>
	)
}
```

- [ ] **Step 7: The route files**

`app/(user)/apps/page.tsx` (replace the whole file):

```tsx
import AppGallery from '@/components/apps/app-gallery'
import { toAppSummaries } from '@/components/apps/app-summary'
import UserShell from '@/components/shell/user-shell'
import { requireSessionUser } from '@/lib/session-user'
import { getAppList } from '@/repository/app'

/**
 * Spec §3.1: the server page checks the session where it reads data (Next authentication guide, "Layouts and
 * auth checks"), loads, trims and hands plain props to the client gallery.
 */
export default async function AppListPage() {
	await requireSessionUser()
	const apps = toAppSummaries(await getAppList())
	return (
		<UserShell>
			<AppGallery apps={apps} />
		</UserShell>
	)
}
```

`app/(user)/apps/loading.tsx`:

```tsx
import AppGallerySkeleton from '@/components/apps/app-gallery-skeleton'
import UserShell from '@/components/shell/user-shell'

// The page renders its own shell (the chat passes header slots), so the loading state does too (spec §3.3).
export default function AppListLoading() {
	return (
		<UserShell>
			<AppGallerySkeleton />
		</UserShell>
	)
}
```

`app/(user)/apps/error.tsx`:

```tsx
'use client'

import RouteError from '@/components/shell/route-error'
import UserShell from '@/components/shell/user-shell'

// Error boundaries must be client components; Next 16.3 passes error, reset and retry (error.md).
export default function AppListError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return (
		<UserShell>
			<RouteError retry={retry} />
		</UserShell>
	)
}
```

Delete `components/shared/index.ts` and `components/shared/lucide-icon.tsx` (their only importer was the old page).

- [ ] **Step 8: Run the unit tests**

Run: `pnpm exec vitest run __tests__/match-query.test.ts __tests__/app-summary.test.ts __tests__/apps-page.test.ts __tests__/i18n-locales.test.ts`
Expected: PASS.

- [ ] **Step 9: e2e — the new spec and the two changed ones**

`e2e/apps.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID, DISABLED_APP, NO_SITE_APP } from './fixtures/constants'

const card = (name: string) => ({ name: new RegExp(name) })

test('the app list shows enabled apps as links to their chat and hides disabled ones', async ({
	page,
}) => {
	await page.goto('/apps')
	await expect(page.getByRole('link', card('Stub app'))).toHaveAttribute('href', `/chat/${APP_ID}`)
	await expect(page.getByRole('link', card(NO_SITE_APP.name))).toBeVisible()
	await expect(page.getByText(DISABLED_APP.name)).toHaveCount(0)
})

test('a card shows the Dify emoji icon, or the mode icon when the app has no site', async ({ page }) => {
	await page.goto('/apps')
	await expect(page.getByRole('link', card('Stub app')).getByText('🤖')).toBeVisible()
	// antd icons render role="img" named after the icon; the no-site app is a workflow app.
	await expect(
		page.getByRole('link', card(NO_SITE_APP.name)).getByRole('img', { name: 'deployment-unit' }),
	).toBeVisible()
})

test('search narrows the list case-insensitively and a miss says so', async ({ page }) => {
	await page.goto('/apps')
	const search = page.getByRole('textbox', { name: 'Search apps' })
	await search.fill('  AGENT ')
	await expect(page.getByRole('link', card('Stub agent'))).toBeVisible()
	await expect(page.getByRole('link', card('Stub app'))).toHaveCount(0)
	await search.fill('no such app')
	await expect(page.getByText('No apps match your search')).toBeVisible()
})

test('on a phone the app list never scrolls sideways', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'a phone-width check')
	await page.goto('/apps')
	await expect(page.getByRole('link', card('Stub app'))).toBeVisible()
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
	).toBe(true)
})
```

`e2e/theme-aliases.spec.ts` — replace the test body's first two lines (`page.goto` and the `.text-theme-desc` locator) with a probe the test adds itself, and update the comment:

```ts
// No page uses the text-theme-* classes since sub-project 3, but the alias block lives on .ant-app until
// sub-project 4 (ADR-0012). The test adds its own element inside the App root instead of a product-code test
// switch (ADR-0010).
test('the legacy theme classes follow antd tokens in both colour schemes', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	await page
		.locator('.ant-app')
		.first()
		.evaluate(root => {
			const probe = document.createElement('span')
			probe.className = 'text-theme-desc'
			probe.dataset.testid = 'alias-probe'
			probe.textContent = 'alias probe'
			root.append(probe)
		})
	const el = page.getByTestId('alias-probe')
	await expect(el).toBeVisible()
```

(the `toHaveCSS` assertion below stays as it is).

`e2e/ssr-first-paint.spec.ts` — append:

```ts
test('the app list arrives with its apps in the first HTML and no API key (spec §3.1)', async ({
	page,
}) => {
	const html = await (await page.request.get('/apps')).text()
	expect(html).toContain('Stub app')
	expect(html).not.toContain('Stub disabled')
	// The seeded apps' key; the trimmed props carry nothing from requestConfig.
	expect(html).not.toContain('app-e2e')
})
```

Run: `pnpm exec playwright test e2e/apps.spec.ts e2e/theme-aliases.spec.ts e2e/ssr-first-paint.spec.ts e2e/smoke.spec.ts e2e/providers.spec.ts`
Expected: PASS on all projects (the phone test runs on `mobile-light` only).

- [ ] **Step 10: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint lib/match-query.ts components/apps components/shell/route-error.tsx "app/(user)/apps" e2e __tests__ && pnpm exec oxfmt --write lib/match-query.ts components/apps components/shell/route-error.tsx "app/(user)/apps" e2e/apps.spec.ts e2e/theme-aliases.spec.ts e2e/ssr-first-paint.spec.ts __tests__/match-query.test.ts __tests__/app-summary.test.ts __tests__/apps-page.test.ts locales && pnpm test
git add lib/match-query.ts components/apps components/shell/route-error.tsx "app/(user)/apps" locales e2e/apps.spec.ts e2e/theme-aliases.spec.ts e2e/ssr-first-paint.spec.ts __tests__/match-query.test.ts __tests__/app-summary.test.ts __tests__/apps-page.test.ts
git rm -q components/shared/index.ts components/shared/lucide-icon.tsx
git commit -m "feat(apps): server-rendered app list with search, Dify icons and load/error states

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: Admin frame and the app table — server page, filters, search, user view, sync, delete

Spec §3.3–§3.5, §5.1–§5.3. Create/edit arrive in Task 5 and annotations in Task 6; this task removes the old drawers with the old page.

**Files:**
- Create: `components/admin/admin-page-header.tsx`, `components/admin/admin-page-header.module.css`, `components/admin/apps/admin-app-row.ts`, `components/admin/apps/app-record.ts`, `components/admin/apps/app-management.tsx`, `components/admin/apps/app-management.module.css`, `components/admin/apps/app-actions.tsx`, `app/(admin)/loading.tsx`, `app/(admin)/error.tsx`
- Replace: `app/(admin)/app-management/page.tsx`
- Modify: `components/shell/admin-shell.tsx`, `components/shell/shell.module.css`, `lib/api/base-request.ts`, `locales/{en,zh,ar}/translation.json`, `e2e/ssr-first-paint.spec.ts`
- Delete: `app/(admin)/app-management/components/annotation-manager-drawer.tsx`, `app-edit-drawer.tsx`, `app-setting-form.tsx`, `app/(admin)/app-management/enums.ts`
- Test: `__tests__/admin-app-row.test.ts`, `__tests__/app-record.test.ts`, `__tests__/app-management-page.test.ts`, `e2e/admin-apps.spec.ts`

**Interfaces:**
- Consumes: `AppIcon` (Task 2); `matchesQuery`, `RouteError` (Task 3); `withDb`, `CREATED_APP` (Task 1).
- Produces: `interface AdminAppRow { id: string; name: string; mode?: AppModeEnums; description: string; tags: string[]; isEnabled: EIsEnabled }`; `toAdminAppRows(items: Pick<IDifyAppItem, 'id' | 'info' | 'isEnabled'>[]): AdminAppRow[]`; `supportsAnnotations(mode?: AppModeEnums): boolean`; `isAppInfo(value: unknown): value is IGetAppInfoResponse`; `isFailedUpdate(result: unknown): boolean`; default export `AdminPageHeader({ title: ReactNode; subtitle?: ReactNode; action?: ReactNode })`; default export `AppManagement({ apps: AdminAppRow[] })`; default export `AppActions({ app: AdminAppRow })` (Task 5 adds `onEdit`, Task 6 `onAnnotations`); key `admin_apps.more_actions`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/admin-app-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { supportsAnnotations, toAdminAppRows } from '@/components/admin/apps/admin-app-row'
import { AppModeEnums, EIsEnabled } from '@/lib/core'

describe('toAdminAppRows', () => {
	it('trims each app to the table columns and keeps its status', () => {
		const rows = toAdminAppRows([
			{
				id: 'a1',
				info: { name: 'Alpha', mode: AppModeEnums.WORKFLOW, description: 'Runs', tags: ['ops'] },
				isEnabled: EIsEnabled.disabled,
				requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-***' },
			} as never,
		])
		expect(rows).toEqual([
			{
				id: 'a1',
				name: 'Alpha',
				mode: AppModeEnums.WORKFLOW,
				description: 'Runs',
				tags: ['ops'],
				isEnabled: EIsEnabled.disabled,
			},
		])
	})

	it('gives a row without info empty fields', () => {
		expect(
			toAdminAppRows([{ id: 'a2', info: undefined as never, isEnabled: EIsEnabled.enabled }]),
		).toEqual([{ id: 'a2', name: '', mode: undefined, description: '', tags: [], isEnabled: 1 }])
	})
})

describe('supportsAnnotations', () => {
	it('is true for the modes Dify documents annotations for', () => {
		expect(supportsAnnotations(AppModeEnums.CHATBOT)).toBe(true)
		expect(supportsAnnotations(AppModeEnums.CHATFLOW)).toBe(true)
		expect(supportsAnnotations(AppModeEnums.AGENT)).toBe(true)
	})

	it('is false for workflow, completion and an unknown mode', () => {
		expect(supportsAnnotations(AppModeEnums.WORKFLOW)).toBe(false)
		expect(supportsAnnotations(AppModeEnums.TEXT_GENERATOR)).toBe(false)
		expect(supportsAnnotations(undefined)).toBe(false)
	})
})
```

`__tests__/app-record.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isAppInfo, isFailedUpdate } from '@/components/admin/apps/app-record'

describe('isAppInfo', () => {
	it('accepts Dify app info', () => {
		expect(isAppInfo({ name: 'Stub app', description: '', tags: [], mode: 'chat' })).toBe(true)
	})

	it('rejects Dify error bodies and anything else', () => {
		// lib/api parses any JSON answer, so a refused key arrives as a value, not a rejection.
		expect(isAppInfo({ code: 'unauthorized', message: 'Access token is invalid', status: 401 })).toBe(false)
		expect(isAppInfo({ name: 3 })).toBe(false)
		expect(isAppInfo(undefined)).toBe(false)
		expect(isAppInfo('<html>')).toBe(false)
	})
})

describe('isFailedUpdate', () => {
	it('spots the { success: false } that actions.ts updateApp resolves on failure', () => {
		expect(isFailedUpdate({ success: false, message: '更新应用配置失败' })).toBe(true)
	})

	it('treats anything else as done', () => {
		expect(isFailedUpdate(undefined)).toBe(false)
		expect(isFailedUpdate(null)).toBe(false)
		expect(isFailedUpdate({ id: 'a1' })).toBe(false)
	})
})
```

`__tests__/app-management-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppModeEnums, EIsEnabled } from '@/lib/core'

const { requireSessionUser, listApp, AppManagement, redirectSignal } = vi.hoisted(() => ({
	requireSessionUser: vi.fn(),
	listApp: vi.fn(),
	AppManagement: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/session-user', () => ({ requireSessionUser }))
vi.mock('@/app/(admin)/app-management/actions', () => ({ listApp }))
vi.mock('@/components/admin/apps/app-management', () => ({ default: AppManagement }))

import AppManagementPage from '@/app/(admin)/app-management/page'

describe('/app-management page', () => {
	beforeEach(() => {
		requireSessionUser.mockReset()
		listApp.mockReset()
	})

	it('checks the session before it lists the apps', async () => {
		requireSessionUser.mockRejectedValue(redirectSignal)
		await expect(AppManagementPage()).rejects.toBe(redirectSignal)
		expect(listApp).not.toHaveBeenCalled()
	})

	it('lists with masked keys and hands the table rows without requestConfig', async () => {
		requireSessionUser.mockResolvedValue(undefined)
		listApp.mockResolvedValue([
			{
				id: 'a1',
				info: { name: 'Alpha', mode: AppModeEnums.CHATBOT, description: '', tags: [] },
				isEnabled: EIsEnabled.disabled,
				requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-***' },
			},
		])
		const page = await AppManagementPage()
		expect(listApp).toHaveBeenCalledWith({ isMask: true })
		expect(page).toMatchObject({
			type: AppManagement,
			props: { apps: [{ id: 'a1', name: 'Alpha', isEnabled: EIsEnabled.disabled }] },
		})
		expect(JSON.stringify(page.props)).not.toMatch(/app-\*\*\*|dify\.example/)
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/admin-app-row.test.ts __tests__/app-record.test.ts __tests__/app-management-page.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: The pure modules**

`components/admin/apps/admin-app-row.ts`:

```ts
import { AppModeEnums, type EIsEnabled, type IDifyAppItem } from '@/lib/core'

/**
 * One row of the admin app table (spec §5.1). No requestConfig: edit, sync and annotations fetch the full
 * record with getApp(id) when the admin opens them. A row without info shows empty fields.
 */
export interface AdminAppRow {
	id: string
	name: string
	mode?: AppModeEnums
	description: string
	tags: string[]
	isEnabled: EIsEnabled
}

export const toAdminAppRows = (
	items: Pick<IDifyAppItem, 'id' | 'info' | 'isEnabled'>[],
): AdminAppRow[] =>
	items.map(item => ({
		id: item.id,
		name: item.info?.name ?? '',
		mode: item.info?.mode,
		description: item.info?.description ?? '',
		tags: item.info?.tags ?? [],
		isEnabled: item.isEnabled,
	}))

/** Dify documents GET /apps/annotations for chatbot, chatflow and the legacy agent apps. */
export const supportsAnnotations = (mode?: AppModeEnums) =>
	mode === AppModeEnums.CHATBOT || mode === AppModeEnums.CHATFLOW || mode === AppModeEnums.AGENT
```

`components/admin/apps/app-record.ts`:

```ts
import type { IGetAppInfoResponse } from '@/lib/api'

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * lib/api parses any JSON answer (base-request.ts `jsonRequest`), so Dify's error body for a refused key or a
 * wrong path arrives as a value. App info is recognised by its string name before anything is saved.
 */
export const isAppInfo = (value: unknown): value is IGetAppInfoResponse =>
	isRecord(value) && typeof value.name === 'string'

/** actions.ts `updateApp` (upstream's) resolves `{ success: false, message }` instead of throwing. */
export const isFailedUpdate = (result: unknown) => isRecord(result) && result.success === false
```

- [ ] **Step 4: Run the unit tests for the pure modules**

Run: `pnpm exec vitest run __tests__/admin-app-row.test.ts __tests__/app-record.test.ts`
Expected: PASS.

- [ ] **Step 5: Admin frame — shell padding, header, loading, error**

`components/shell/shell.module.css` — append:

```css
/* The admin pages' frame (spec §3.4): mobile first, one query at antd's screenMD; pages add no padding. */
.adminContent {
	padding: var(--ant-padding);
}
@media (min-width: 768px /* screenMD */) {
	.adminContent {
		padding: var(--ant-padding-lg);
	}
}
```

`components/shell/admin-shell.tsx` — drop `theme` from the antd import and the `token` line, and render the content with both classes:

```tsx
			<Layout.Content className={`${styles.content} ${styles.adminContent}`}>{children}</Layout.Content>
```

`components/admin/admin-page-header.module.css`:

```css
.title {
	margin: 0;
}
```

`components/admin/admin-page-header.tsx`:

```tsx
'use client'

import { Flex, Typography } from 'antd'

import styles from './admin-page-header.module.css'

/** Title, optional subtitle and the page's primary action; wraps on narrow screens (spec §3.4). */
export default function AdminPageHeader({
	title,
	subtitle,
	action,
}: {
	title: React.ReactNode
	subtitle?: React.ReactNode
	action?: React.ReactNode
}) {
	return (
		<Flex
			wrap
			justify="space-between"
			align="center"
			gap="small"
		>
			<div>
				<Typography.Title
					level={4}
					className={styles.title}
				>
					{title}
				</Typography.Title>
				{subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
			</div>
			{action}
		</Flex>
	)
}
```

`app/(admin)/loading.tsx` (antd ships `"use client"` in its components, so a server file may render them with serialisable props):

```tsx
import { Skeleton } from 'antd'

// Inside AdminShell: the admin layout renders the shell, loading.tsx wraps the page only (loading.md).
export default function AdminLoading() {
	return (
		<Skeleton
			active
			paragraph={{ rows: 8 }}
		/>
	)
}
```

`app/(admin)/error.tsx`:

```tsx
'use client'

import RouteError from '@/components/shell/route-error'

// Rendered inside AdminShell (an error.tsx does not wrap its own segment's layout, error.md).
export default function AdminError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return <RouteError retry={retry} />
}
```

- [ ] **Step 6: `lib/api/base-request.ts` — no static message on 401**

Replace the 401 branch and remove the now unused `message` (antd) and `i18next` imports:

```ts
		if (result.status === 401) {
			// The admin pages show the translated error through App.useApp() (spec §11); no static antd message here.
			throw new UnauthorizedError('Unauthorized')
		}
```

- [ ] **Step 7: Locale key**

Add to `admin_apps` — en `"more_actions": "More actions"`, zh `"more_actions": "更多操作"`, ar `"more_actions": "إجراءات أخرى"`.

- [ ] **Step 8: The table and its actions**

Check: `npx -y @ant-design/cli doc Table` (`columns`, `filters`, `onFilter`, `scroll`, `rowKey`), `doc Dropdown` (`menu`, `trigger`; a menu item `label` may be an `<a>`), `doc App` (`useApp`), `doc Modal` (hooks `confirm`, `onOk` Promise).

`components/admin/apps/app-management.module.css`:

```css
/* A reading measure, not a pixel size: Typography's two-line ellipsis needs a bounded width, and the table sizes
   its columns from their content (scroll.x: 'max-content'). */
.description {
	max-width: 40ch;
	margin: 0;
}
```

`components/admin/apps/app-actions.tsx`:

```tsx
'use client'

import { EllipsisOutlined } from '@ant-design/icons'
import { App, Button, Dropdown, type MenuProps } from 'antd'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import { deleteApp, getApp, updateApp } from '@/app/(admin)/app-management/actions'
import { DifyApi } from '@/lib/api'

import type { AdminAppRow } from './admin-app-row'
import { isAppInfo, isFailedUpdate } from './app-record'

/** A row's actions (spec §5.3). Every outcome is a translated message; success refreshes the server page. */
export default function AppActions({ app }: { app: AdminAppRow }) {
	const { t } = useTranslation()
	const { message, modal } = App.useApp()
	const router = useRouter()

	const sync = async () => {
		try {
			const record = await getApp(app.id)
			if (!record) {
				message.error(t('admin_apps.not_found'))
				return
			}
			const info = await new DifyApi({ ...record.requestConfig, user: '' }).getAppInfo()
			if (!isAppInfo(info)) throw new Error('Dify answered without app info')
			const { info: current, ...rest } = record
			if (isFailedUpdate(await updateApp({ ...rest, info: { ...current, ...info } }))) {
				throw new Error('updateApp failed')
			}
			message.success(t('admin_apps.sync_success'))
			router.refresh()
		} catch (error) {
			console.error('Failed to sync app info', error)
			message.error(t('admin_apps.sync_failed'))
		}
	}

	const confirmDelete = () =>
		modal.confirm({
			title: t('admin_apps.delete_confirm_title'),
			content: t('admin_apps.delete_confirm_description'),
			okText: t('common.delete'),
			okButtonProps: { danger: true },
			cancelText: t('common.cancel'),
			// The dialog stays open with a loading OK button until this settles (Modal hooks, onOk).
			onOk: async () => {
				try {
					await deleteApp(app.id)
					message.success(t('admin_apps.delete_success'))
					router.refresh()
				} catch (error) {
					console.error('Failed to delete app', error)
					message.error(t('common.delete_failed'))
				}
			},
		})

	const items: MenuProps['items'] = [
		{
			key: 'view',
			label: (
				<a
					href={`/chat/${app.id}`}
					target="_blank"
					rel="noreferrer"
				>
					{t('admin_apps.user_view')}
				</a>
			),
		},
		{ key: 'sync', label: t('admin_apps.sync_info') },
		{ type: 'divider' },
		{ key: 'delete', label: t('common.delete'), danger: true },
	]
	const onClick: MenuProps['onClick'] = ({ key }) => {
		if (key === 'sync') void sync()
		if (key === 'delete') confirmDelete()
	}

	return (
		<Dropdown
			trigger={['click']}
			menu={{ items, onClick }}
		>
			<Button
				type="text"
				icon={<EllipsisOutlined />}
				aria-label={t('admin_apps.more_actions')}
				title={t('admin_apps.more_actions')}
			/>
		</Dropdown>
	)
}
```

`components/admin/apps/app-management.tsx`:

```tsx
'use client'

import { SearchOutlined } from '@ant-design/icons'
import { Col, Flex, Input, Row, Table, type TableProps, Tag, Typography, theme } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AdminPageHeader from '@/components/admin/admin-page-header'
import AppIcon from '@/components/apps/app-icon'
import { AppModeNames, AppModeOptions, EIsEnabled } from '@/lib/core'
import { matchesQuery } from '@/lib/match-query'

import type { AdminAppRow } from './admin-app-row'
import AppActions from './app-actions'
import styles from './app-management.module.css'

/**
 * The app table (spec §5.2): search above, documented column filters for type and status, horizontal scroll
 * inside the table on narrow screens and no fixed or `responsive` columns (responsive columns are added only
 * after hydration, es/table/InternalTable.js).
 */
export default function AppManagement({ apps }: { apps: AdminAppRow[] }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [query, setQuery] = useState('')
	const shown = apps.filter(app => matchesQuery([app.name, app.description, ...app.tags], query))

	const columns: TableProps<AdminAppRow>['columns'] = [
		{
			title: t('admin_apps.column_name'),
			key: 'name',
			render: (_, app) => (
				<Flex
					align="center"
					gap="small"
				>
					<AppIcon
						appId={app.id}
						mode={app.mode}
						size="small"
					/>
					<span>{app.name || t('common.none')}</span>
				</Flex>
			),
		},
		{
			title: t('admin_apps.column_type'),
			key: 'mode',
			filters: AppModeOptions.map(option => ({ text: t(option.label), value: option.value })),
			onFilter: (value, app) => app.mode === value,
			render: (_, app) => (app.mode ? t(AppModeNames[app.mode]) : t('common.none')),
		},
		{
			title: t('admin_apps.column_description'),
			key: 'description',
			render: (_, app) => (
				<Typography.Paragraph
					className={styles.description}
					ellipsis={{ rows: 2, tooltip: app.description }}
				>
					{app.description || t('app.no_description')}
				</Typography.Paragraph>
			),
		},
		{
			title: t('admin_apps.column_tags'),
			key: 'tags',
			render: (_, app) =>
				app.tags.length > 0 ? (
					<Flex
						wrap
						gap="small"
					>
						{app.tags.map(tag => (
							<Tag key={tag}>{tag}</Tag>
						))}
					</Flex>
				) : null,
		},
		{
			title: t('common.status'),
			key: 'status',
			filters: [
				{ text: t('admin_apps.status_enabled'), value: EIsEnabled.enabled },
				{ text: t('admin_apps.status_disabled'), value: EIsEnabled.disabled },
			],
			onFilter: (value, app) => app.isEnabled === value,
			render: (_, app) =>
				app.isEnabled === EIsEnabled.disabled ? (
					<Tag>{t('admin_apps.status_disabled')}</Tag>
				) : (
					<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
				),
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, app) => <AppActions app={app} />,
		},
	]

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<AdminPageHeader title={t('admin_apps.title')} />
			<Row>
				<Col
					xs={24}
					md={12}
					lg={8}
				>
					<Input
						allowClear
						prefix={<SearchOutlined />}
						placeholder={t('app.search_placeholder')}
						aria-label={t('app.search_placeholder')}
						value={query}
						onChange={event => setQuery(event.target.value)}
					/>
				</Col>
			</Row>
			<Table
				rowKey="id"
				columns={columns}
				dataSource={shown}
				scroll={{ x: 'max-content' }}
			/>
		</Flex>
	)
}
```

`app/(admin)/app-management/page.tsx` (replace the whole file):

```tsx
import { toAdminAppRows } from '@/components/admin/apps/admin-app-row'
import AppManagement from '@/components/admin/apps/app-management'
import { requireSessionUser } from '@/lib/session-user'

import { listApp } from './actions'

/** Spec §5.1: masked list, trimmed rows; the real key is fetched with getApp(id) only when an action needs it. */
export default async function AppManagementPage() {
	await requireSessionUser()
	const apps = toAdminAppRows(await listApp({ isMask: true }))
	return <AppManagement apps={apps} />
}
```

Delete `app/(admin)/app-management/components/annotation-manager-drawer.tsx`, `app-edit-drawer.tsx`, `app-setting-form.tsx` and `app/(admin)/app-management/enums.ts`.

- [ ] **Step 9: Run the unit tests**

Run: `pnpm exec vitest run __tests__/app-management-page.test.ts __tests__/admin-app-row.test.ts __tests__/app-record.test.ts __tests__/i18n-locales.test.ts`
Expected: PASS.

- [ ] **Step 10: e2e**

`e2e/admin-apps.spec.ts`:

```ts
import { expect, type Page, test, type TestInfo } from '@playwright/test'

import { APP_ID, CREATED_APP } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { stubApiBase } from './fixtures/env'

const PROJECTS = ['desktop-light', 'desktop-dark', 'mobile-light']
/** A dify_apps id (36 characters) of the spec's own, distinct per project: the three projects run one after another. */
const ownId = (base: number, testInfo: TestInfo) =>
	`e2e00000-0000-4000-8000-${String(base + PROJECTS.indexOf(testInfo.project.name) + 1).padStart(12, '0')}`
const seedApp = (id: string, name: string, apiBase: string) =>
	withDb(db =>
		db.execute(
			'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, api_base = ?',
			[id, name, 'chat', 'e2e', apiBase, 'app-e2e', name, apiBase],
		),
	)
const dropApp = (id: string) => withDb(db => db.execute('DELETE FROM dify_apps WHERE id = ?', [id]))
// antd's Table sets data-row-key from rowKey on each body row.
const rowById = (page: Page, id: string) => page.locator(`tr[data-row-key="${id}"]`)
const moreActions = (page: Page, id: string) =>
	rowById(page, id).getByRole('button', { name: 'More actions' })

test('the table shows every app with its status, and the type filter narrows it', async ({ page }) => {
	await page.goto('/app-management')
	await expect(page.getByRole('row', { name: /Stub disabled/ }).getByText('Disabled')).toBeVisible()
	await page.getByRole('columnheader', { name: 'Type' }).getByRole('button').click()
	// The filter dropdown lists the modes as checkable menu items (antd Table filters).
	await page.getByRole('menuitem', { name: 'Workflow' }).click()
	await page.getByRole('button', { name: 'OK' }).click()
	await expect(page.getByRole('row', { name: /Stub workflow/ })).toBeVisible()
	await expect(page.getByRole('row', { name: /Stub no-site/ })).toBeVisible()
	await expect(page.getByRole('row', { name: /Stub agent/ })).toHaveCount(0)
})

test('search narrows the table', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('textbox', { name: 'Search apps' }).fill('chatflow')
	await expect(page.getByRole('row', { name: /Stub chatflow/ })).toBeVisible()
	await expect(rowById(page, APP_ID)).toHaveCount(0)
})

test('user view is a link that opens the chat in a new tab', async ({ page }) => {
	await page.goto('/app-management')
	await moreActions(page, APP_ID).click()
	const link = page.getByRole('menuitem', { name: 'User view' }).getByRole('link')
	await expect(link).toHaveAttribute('href', `/chat/${APP_ID}`)
	await expect(link).toHaveAttribute('target', '_blank')
})

test('sync info refreshes the app from Dify', async ({ page }, testInfo) => {
	const id = ownId(200, testInfo)
	await seedApp(id, `Sync me ${testInfo.project.name}`, `${stubApiBase}${CREATED_APP.prefix}`)
	try {
		await page.goto('/app-management')
		await moreActions(page, id).click()
		await page.getByRole('menuitem', { name: 'Sync app info' }).click()
		// The stub's /info for this prefix answers the created app's name; router.refresh() shows it.
		await expect(rowById(page, id)).toContainText(CREATED_APP.name)
	} finally {
		await dropApp(id)
	}
})

test('delete asks for confirmation and removes the app', async ({ page }, testInfo) => {
	const id = ownId(100, testInfo)
	await seedApp(id, `Delete me ${testInfo.project.name}`, stubApiBase)
	try {
		await page.goto('/app-management')
		await moreActions(page, id).click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
		await expect(rowById(page, id)).toHaveCount(0)
	} finally {
		await dropApp(id)
	}
})

test('on a phone the table scrolls inside its container and More stays reachable', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'a phone-width check')
	await page.goto('/app-management')
	const fits = (selector: string) =>
		page.evaluate(sel => {
			const el = document.querySelector(sel)
			return !!el && el.scrollWidth <= el.clientWidth
		}, selector)
	expect(await fits('html')).toBe(true)
	expect(await fits('main.ant-layout-content')).toBe(true)
	const more = moreActions(page, APP_ID)
	await more.scrollIntoViewIfNeeded()
	await expect(more).toBeInViewport()
	await more.click()
	await expect(page.getByRole('menuitem', { name: 'Sync app info' })).toBeVisible()
})
```

If the filter dropdown's items expose another role than `menuitem` in antd 6.6.5 (check the Playwright trace), use that role (`menuitemcheckbox` or the inner `checkbox`), keeping a role locator.

`e2e/ssr-first-paint.spec.ts` — append:

```ts
test('the app table arrives with its rows in the first HTML and no API key (spec §5.1)', async ({
	page,
}) => {
	const html = await (await page.request.get('/app-management')).text()
	expect(html).toContain('Stub app')
	expect(html).toContain('Stub disabled')
	expect(html).not.toContain('app-e2e')
})
```

Run: `pnpm exec playwright test e2e/admin-apps.spec.ts e2e/ssr-first-paint.spec.ts e2e/smoke.spec.ts e2e/shell.spec.ts`
Expected: PASS (the phone test runs on `mobile-light` only).

- [ ] **Step 11: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint components/admin components/shell "app/(admin)" lib/api/base-request.ts e2e __tests__ && pnpm exec oxfmt --write components/admin components/shell "app/(admin)" lib/api/base-request.ts e2e/admin-apps.spec.ts e2e/ssr-first-paint.spec.ts __tests__/admin-app-row.test.ts __tests__/app-record.test.ts __tests__/app-management-page.test.ts locales && pnpm test
git add components/admin components/shell/admin-shell.tsx components/shell/shell.module.css "app/(admin)/loading.tsx" "app/(admin)/error.tsx" "app/(admin)/app-management/page.tsx" lib/api/base-request.ts locales e2e/admin-apps.spec.ts e2e/ssr-first-paint.spec.ts __tests__/admin-app-row.test.ts __tests__/app-record.test.ts __tests__/app-management-page.test.ts
git rm -q "app/(admin)/app-management/components/annotation-manager-drawer.tsx" "app/(admin)/app-management/components/app-edit-drawer.tsx" "app/(admin)/app-management/components/app-setting-form.tsx" "app/(admin)/app-management/enums.ts"
git commit -m "feat(admin): server-rendered app table with filters, search, sync and confirmed delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: Create and edit an app — the form drawer

Spec §5.4. The full record is loaded with `getApp(id)` only for edit; a late answer after close or after opening another app is dropped (Review Focus 3).

**Files:**
- Create: `components/admin/apps/app-form-values.ts`, `components/admin/apps/use-app-record.ts`, `components/admin/apps/app-settings-fields.tsx`, `components/admin/apps/app-form-drawer.tsx`
- Modify: `components/admin/apps/app-record.ts` (`RecordState`, `acceptRecord`, `dropRecord`), `components/admin/apps/app-management.tsx`, `components/admin/apps/app-actions.tsx`, `locales/{en,zh,ar}/translation.json`, `e2e/admin-apps.spec.ts`
- Test: `__tests__/app-form-values.test.ts`, `__tests__/app-record.test.ts`

**Interfaces:**
- Consumes: `isAppInfo`, `isFailedUpdate`, `AppManagement`, `AppActions` (Task 4); `CREATED_APP`, `withDb` (Task 1).
- Produces: `interface AppFormValues`, `DEFAULT_APP_FORM_VALUES`, `toAppFormValues(item: IDifyAppItem): AppFormValues`, `fromAppFormValues(values: AppFormValues, info: IGetAppInfoResponse): Omit<IDifyAppItem, 'id'>`, `statusSwitchProps: { getValueProps(value?: EIsEnabled): { checked: boolean }; normalize(checked: boolean): EIsEnabled }`; `type RecordState = { appId: string; record?: IDifyAppItem } | null`, `acceptRecord(current: RecordState, appId: string, record: IDifyAppItem): RecordState`, `dropRecord(current: RecordState, appId: string): RecordState`; `useAppRecord(): { state: RecordState; open(appId: string): Promise<void>; close(): void }` (Task 6 reuses it); `AppActions` gains `onEdit: () => void`; key `admin_apps.dify_unreachable`; `admin_apps.save_failed` loses its `{{error}}` placeholder.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/app-form-values.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	DEFAULT_APP_FORM_VALUES,
	fromAppFormValues,
	statusSwitchProps,
	toAppFormValues,
} from '@/components/admin/apps/app-form-values'
import { AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

const saved: IDifyAppItem = {
	id: 'a1',
	info: { name: 'Alpha', mode: AppModeEnums.CHATFLOW, description: 'd', tags: ['t'] },
	isEnabled: EIsEnabled.disabled,
	requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-real' },
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	inputParams: { enableUpdateAfterCvstStarts: true },
	extConfig: {
		conversation: { openingStatement: { displayMode: 'always' } },
		annotation: { enabled: true },
	},
}

describe('toAppFormValues', () => {
	it('fills the form from a saved app', () => {
		expect(toAppFormValues(saved)).toEqual({
			requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-real' },
			info: { mode: AppModeEnums.CHATFLOW },
			isEnabled: EIsEnabled.disabled,
			inputParams: { enableUpdateAfterCvstStarts: true },
			extConfig: {
				conversation: { openingStatement: { displayMode: 'always' } },
				annotation: { enabled: true },
			},
			answerForm: { enabled: true, feedbackText: 'Thanks' },
		})
	})

	it('fills missing settings with the create defaults', () => {
		const bare = {
			id: 'a2',
			info: { name: 'Bare', description: '', tags: [] },
			isEnabled: EIsEnabled.enabled,
			requestConfig: { apiBase: 'https://b/v1', apiKey: 'app-b' },
		} as IDifyAppItem
		expect(toAppFormValues(bare)).toEqual({
			...DEFAULT_APP_FORM_VALUES,
			requestConfig: { apiBase: 'https://b/v1', apiKey: 'app-b' },
		})
	})
})

describe('fromAppFormValues', () => {
	const info = { name: 'From Dify', description: 'desc', tags: ['x'], mode: AppModeEnums.AGENT }

	it("builds the item from the form and Dify's app info, keeping Dify's mode", () => {
		expect(fromAppFormValues(toAppFormValues(saved), info)).toEqual({
			info,
			isEnabled: EIsEnabled.disabled,
			requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-real' },
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			inputParams: { enableUpdateAfterCvstStarts: true },
			extConfig: {
				conversation: { openingStatement: { displayMode: 'always' } },
				annotation: { enabled: true },
			},
		})
	})

	it("falls back to the form's mode when Dify reports none", () => {
		const withoutMode = { name: info.name, description: info.description, tags: info.tags }
		expect(fromAppFormValues(toAppFormValues(saved), withoutMode).info.mode).toBe(AppModeEnums.CHATFLOW)
	})

	it('keeps an empty feedback text when the form reply field is not rendered', () => {
		const values = { ...DEFAULT_APP_FORM_VALUES, answerForm: { enabled: false } }
		expect(fromAppFormValues(values, info).answerForm).toEqual({ enabled: false, feedbackText: '' })
	})
})

describe('statusSwitchProps', () => {
	it('shows enabled and a missing status as on, disabled as off', () => {
		expect(statusSwitchProps.getValueProps(EIsEnabled.enabled)).toEqual({ checked: true })
		expect(statusSwitchProps.getValueProps(undefined)).toEqual({ checked: true })
		expect(statusSwitchProps.getValueProps(EIsEnabled.disabled)).toEqual({ checked: false })
	})

	it('stores on as 1 and off as 2', () => {
		expect(statusSwitchProps.normalize(true)).toBe(EIsEnabled.enabled)
		expect(statusSwitchProps.normalize(false)).toBe(EIsEnabled.disabled)
	})
})
```

Append to `__tests__/app-record.test.ts` (and add `acceptRecord`, `dropRecord` to its import):

```ts
describe('acceptRecord and dropRecord', () => {
	const record = { id: 'a1' } as never

	it('fills the drawer that is still open for the app', () => {
		expect(acceptRecord({ appId: 'a1' }, 'a1', record)).toEqual({ appId: 'a1', record })
	})

	it('ignores an answer after the drawer closed or another app was opened', () => {
		expect(acceptRecord(null, 'a1', record)).toBeNull()
		expect(acceptRecord({ appId: 'a2' }, 'a1', record)).toEqual({ appId: 'a2' })
	})

	it('closes only the drawer that waited for the failed app', () => {
		expect(dropRecord({ appId: 'a1' }, 'a1')).toBeNull()
		expect(dropRecord({ appId: 'a2' }, 'a1')).toEqual({ appId: 'a2' })
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/app-form-values.test.ts __tests__/app-record.test.ts`
Expected: FAIL (module and exports not found).

- [ ] **Step 3: The pure parts**

`components/admin/apps/app-form-values.ts`:

```ts
import type { IGetAppInfoResponse } from '@/lib/api'
import { AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

/**
 * The drawer's values (spec §5.4). Field names are array paths in IDifyAppItem's shape, so the values are a
 * partial item already; antd treats a dotted string as one key (`getNamePath = toArray(path)`), which is why the
 * old drawer rebuilt the object by hand. `feedbackText` is absent while the form-reply field is not rendered.
 */
export interface AppFormValues {
	requestConfig: { apiBase: string; apiKey: string }
	info: { mode: AppModeEnums }
	isEnabled: EIsEnabled
	inputParams: { enableUpdateAfterCvstStarts: boolean }
	extConfig: {
		conversation: { openingStatement: { displayMode: 'default' | 'always' } }
		annotation: { enabled: boolean }
	}
	answerForm: { enabled: boolean; feedbackText?: string }
}

export const DEFAULT_APP_FORM_VALUES: AppFormValues = {
	requestConfig: { apiBase: '', apiKey: '' },
	info: { mode: AppModeEnums.CHATBOT },
	isEnabled: EIsEnabled.enabled,
	inputParams: { enableUpdateAfterCvstStarts: false },
	extConfig: {
		conversation: { openingStatement: { displayMode: 'default' } },
		annotation: { enabled: false },
	},
	answerForm: { enabled: false, feedbackText: '' },
}

/** A saved app as the form's initial values; settings it lacks take the create defaults. */
export const toAppFormValues = (item: IDifyAppItem): AppFormValues => ({
	requestConfig: { apiBase: item.requestConfig.apiBase, apiKey: item.requestConfig.apiKey },
	info: { mode: item.info.mode ?? DEFAULT_APP_FORM_VALUES.info.mode },
	isEnabled: item.isEnabled ?? DEFAULT_APP_FORM_VALUES.isEnabled,
	inputParams: {
		enableUpdateAfterCvstStarts: item.inputParams?.enableUpdateAfterCvstStarts ?? false,
	},
	extConfig: {
		conversation: {
			openingStatement: {
				displayMode: item.extConfig?.conversation?.openingStatement?.displayMode ?? 'default',
			},
		},
		annotation: { enabled: item.extConfig?.annotation?.enabled ?? false },
	},
	answerForm: {
		enabled: item.answerForm?.enabled ?? false,
		feedbackText: item.answerForm?.feedbackText ?? '',
	},
})

/** The item to save: Dify's app info (its mode when it reports one, else the form's) plus the form's settings. */
export const fromAppFormValues = (
	values: AppFormValues,
	info: IGetAppInfoResponse,
): Omit<IDifyAppItem, 'id'> => ({
	info: { ...info, mode: info.mode || values.info.mode },
	isEnabled: values.isEnabled,
	requestConfig: { apiBase: values.requestConfig.apiBase, apiKey: values.requestConfig.apiKey },
	answerForm: {
		enabled: values.answerForm.enabled,
		feedbackText: values.answerForm.feedbackText ?? '',
	},
	inputParams: {
		enableUpdateAfterCvstStarts: values.inputParams.enableUpdateAfterCvstStarts,
	},
	extConfig: {
		conversation: {
			openingStatement: { displayMode: values.extConfig.conversation.openingStatement.displayMode },
		},
		annotation: { enabled: values.extConfig.annotation.enabled },
	},
})

/**
 * The 1/2 status on a Switch: Form.Item `getValueProps` + `normalize` (antd Form API; `valuePropName` is
 * ignored once `getValueProps` is set). A missing status counts as enabled, as dbAppToAppItem does.
 */
export const statusSwitchProps = {
	getValueProps: (value?: EIsEnabled) => ({ checked: value !== EIsEnabled.disabled }),
	normalize: (checked: boolean) => (checked ? EIsEnabled.enabled : EIsEnabled.disabled),
}
```

Append to `components/admin/apps/app-record.ts` (add `import type { IDifyAppItem } from '@/lib/core'` at the top):

```ts
/** A drawer that needs the full app: the id it was opened for, and the record once getApp answered. */
export type RecordState = { appId: string; record?: IDifyAppItem } | null

/** A getApp answer fills the drawer only if it is still open for that app. */
export const acceptRecord = (
	current: RecordState,
	appId: string,
	record: IDifyAppItem,
): RecordState => (current?.appId === appId ? { appId, record } : current)

/** A failed getApp closes the drawer only if it still waits for that app. */
export const dropRecord = (current: RecordState, appId: string): RecordState =>
	current?.appId === appId ? null : current
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm exec vitest run __tests__/app-form-values.test.ts __tests__/app-record.test.ts`
Expected: PASS.

- [ ] **Step 5: Locale keys**

Add to `admin_apps` — en `"dify_unreachable": "Could not reach the Dify app. Check the API Base and API Secret."`, zh `"dify_unreachable": "无法连接到 Dify 应用，请检查 API Base 和 API Secret。"`, ar `"dify_unreachable": "تعذّر الوصول إلى تطبيق Dify. تحقّق من API Base وAPI Secret."`.
Change `admin_apps.save_failed` (the Error object no longer goes into the text) — en `"Failed to save app configuration"`, zh `"保存应用配置失败"`, ar `"فشل حفظ إعدادات التطبيق"`.

- [ ] **Step 6: The loader hook**

`components/admin/apps/use-app-record.ts`:

```ts
'use client'

import { App } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApp } from '@/app/(admin)/app-management/actions'

import { acceptRecord, dropRecord, type RecordState } from './app-record'

/**
 * The full app (with its real key) for a drawer that needs it — edit and annotations (spec §5.1). The list
 * carries no requestConfig; this is the only place the key reaches the browser.
 */
export function useAppRecord() {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [state, setState] = useState<RecordState>(null)

	const open = async (appId: string) => {
		setState({ appId })
		try {
			const record = await getApp(appId)
			if (!record) throw new Error(`App ${appId} not found`)
			setState(current => acceptRecord(current, appId, record))
		} catch (error) {
			console.error('Failed to load the app', error)
			message.error(t('admin_apps.not_found'))
			setState(current => dropRecord(current, appId))
		}
	}

	return { state, open, close: () => setState(null) }
}
```

- [ ] **Step 7: The fields and the drawer**

Check: `npx -y @ant-design/cli doc Form` (`name` path arrays, `valuePropName`, `getValueProps`, `normalize`, `useWatch`, `useFormInstance`, `tooltip`), `doc Divider` (`titlePlacement`), `doc Switch`, `doc Descriptions` (`items`), `doc Drawer` (`size`, `destroyOnHidden`, `extra`) and `npx -y @ant-design/cli demo Drawer form-in-drawer`.

`components/admin/apps/app-settings-fields.tsx`:

```tsx
'use client'

import { Descriptions, Divider, Flex, Form, Input, Select, Switch, Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { AppModeOptions, type IDifyAppItem, OpeningStatementDisplayModeOptions } from '@/lib/core'

import { statusSwitchProps } from './app-form-values'

/** The settings form's fields (spec §5.4); `record` shows the app's Dify info above them when editing. */
export default function AppSettingsFields({ record }: { record?: IDifyAppItem }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const replyOn = Form.useWatch(['answerForm', 'enabled'], form)

	return (
		<>
			{record && (
				<Descriptions
					column={1}
					size="small"
					items={[
						{ key: 'name', label: t('app_setting.name'), children: record.info.name },
						{
							key: 'description',
							label: t('app_setting.description'),
							children: record.info.description || t('common.none'),
						},
						{
							key: 'tags',
							label: t('app_setting.tags'),
							children: record.info.tags?.length ? (
								<Flex
									wrap
									gap="small"
								>
									{record.info.tags.map(tag => (
										<Tag key={tag}>{tag}</Tag>
									))}
								</Flex>
							) : (
								t('common.none')
							),
						},
					]}
				/>
			)}

			<Divider titlePlacement="start">{t('app_setting.section_request')}</Divider>
			<Form.Item
				label="API Base"
				name={['requestConfig', 'apiBase']}
				tooltip={t('app_setting.api_base_tooltip')}
				rules={[{ required: true, message: t('app_setting.api_base_required') }]}
			>
				<Input placeholder={t('app_setting.api_base_placeholder')} />
			</Form.Item>
			<Form.Item
				label="API Secret"
				name={['requestConfig', 'apiKey']}
				tooltip={t('app_setting.api_secret_tooltip')}
				rules={[{ required: true, message: t('app_setting.api_secret_required') }]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t('app_setting.api_secret_placeholder')}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_basic')}</Divider>
			<Form.Item
				label={t('app_setting.type')}
				name={['info', 'mode']}
				tooltip={t('app_setting.type_tooltip')}
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					placeholder={t('app_setting.type_placeholder')}
					options={AppModeOptions.map(option => ({ value: option.value, label: t(option.label) }))}
				/>
			</Form.Item>
			<Form.Item
				label={t('app_setting.status')}
				name="isEnabled"
				tooltip={t('app_setting.status_tooltip')}
				{...statusSwitchProps}
			>
				<Switch />
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.update_inputs')}
				name={['inputParams', 'enableUpdateAfterCvstStarts']}
				tooltip={t('app_setting.update_inputs_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.opening_display')}
				name={['extConfig', 'conversation', 'openingStatement', 'displayMode']}
				tooltip={t('app_setting.opening_display_tooltip')}
			>
				<Select
					options={OpeningStatementDisplayModeOptions.map(option => ({
						value: option.value,
						label: t(option.label),
					}))}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_more')}</Divider>
			<Form.Item
				label={t('app_setting.allow_annotation')}
				name={['extConfig', 'annotation', 'enabled']}
				tooltip={t('app_setting.allow_annotation_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.form_reply')}
				name={['answerForm', 'enabled']}
				tooltip={t('app_setting.form_reply_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			{replyOn && (
				<Form.Item
					label={t('app_setting.submit_text')}
					name={['answerForm', 'feedbackText']}
					tooltip={t('app_setting.submit_text_tooltip')}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			)}
		</>
	)
}
```

`components/admin/apps/app-form-drawer.tsx`:

```tsx
'use client'

import { App, Button, Drawer, Form, Skeleton, Space } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createApp, updateApp } from '@/app/(admin)/app-management/actions'
import { DifyApi } from '@/lib/api'
import type { IDifyAppItem } from '@/lib/core'

import {
	type AppFormValues,
	DEFAULT_APP_FORM_VALUES,
	fromAppFormValues,
	toAppFormValues,
} from './app-form-values'
import { isAppInfo, isFailedUpdate } from './app-record'
import AppSettingsFields from './app-settings-fields'

export interface AppFormDrawerProps {
	open: boolean
	/** 'edit' shows a skeleton until `record` arrives (getApp, spec §5.4). */
	mode: 'create' | 'edit'
	record?: IDifyAppItem
	onClose: () => void
}

/**
 * Create or edit an app (spec §5.4): antd's form-in-drawer layout with the actions in `extra`; `destroyOnHidden`
 * mounts a fresh form with its initial values on every opening, and the form instance is used only while open.
 */
export default function AppFormDrawer({ open, mode, record, onClose }: AppFormDrawerProps) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [form] = Form.useForm<AppFormValues>()
	const [saving, setSaving] = useState(false)
	const loading = mode === 'edit' && !record

	const save = async (values: AppFormValues) => {
		setSaving(true)
		try {
			// The browser asks Dify with the entered base and key, as before; a refused key, an error body or an
			// unreachable base keeps the drawer open (Review Focus 1).
			const info = await new DifyApi({
				user: '',
				apiBase: values.requestConfig.apiBase,
				apiKey: values.requestConfig.apiKey,
			})
				.getAppInfo()
				.catch(() => undefined)
			if (!isAppInfo(info)) {
				message.error(t('admin_apps.dify_unreachable'))
				return
			}
			const item = fromAppFormValues(values, info)
			if (record) {
				if (isFailedUpdate(await updateApp({ id: record.id, ...item }))) {
					throw new Error('updateApp failed')
				}
				message.success(t('admin_apps.edit_success'))
			} else {
				await createApp(item)
				message.success(t('admin_apps.create_success'))
			}
			onClose()
			router.refresh()
		} catch (error) {
			console.error('Failed to save the app', error)
			message.error(t('admin_apps.save_failed'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			size="large"
			destroyOnHidden
			title={
				mode === 'edit'
					? t('admin_apps.edit_title', { name: record?.info.name ?? '' })
					: t('admin_apps.create_title')
			}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={saving}
						disabled={loading}
						onClick={() => form.submit()}
					>
						{mode === 'edit' ? t('common.update') : t('common.ok')}
					</Button>
				</Space>
			}
		>
			{loading ? (
				<Skeleton
					active
					paragraph={{ rows: 10 }}
				/>
			) : (
				<Form
					form={form}
					layout="vertical"
					autoComplete="off"
					initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}
					onFinish={save}
				>
					<AppSettingsFields record={record} />
				</Form>
			)}
		</Drawer>
	)
}
```

- [ ] **Step 8: Wire New and Edit**

`components/admin/apps/app-actions.tsx` — the props become `{ app: AdminAppRow; onEdit: () => void }`; add `Flex` to the antd import; return an Edit link button beside the dropdown:

```tsx
	return (
		<Flex
			align="center"
			gap="small"
		>
			<Button
				type="link"
				onClick={onEdit}
			>
				{t('common.edit')}
			</Button>
			<Dropdown
				trigger={['click']}
				menu={{ items, onClick }}
			>
				<Button
					type="text"
					icon={<EllipsisOutlined />}
					aria-label={t('admin_apps.more_actions')}
					title={t('admin_apps.more_actions')}
				/>
			</Dropdown>
		</Flex>
	)
```

`components/admin/apps/app-management.tsx`:
- add `PlusOutlined` to the icons import and `Button` to the antd import; import `AppFormDrawer from './app-form-drawer'` and `{ useAppRecord } from './use-app-record'`;
- inside the component:

```tsx
	const editor = useAppRecord()
	const [creating, setCreating] = useState(false)
	const closeDrawer = () => {
		setCreating(false)
		editor.close()
	}
```

- the header and the actions column:

```tsx
			<AdminPageHeader
				title={t('admin_apps.title')}
				action={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setCreating(true)}
					>
						{t('common.new')}
					</Button>
				}
			/>
```

```tsx
			render: (_, app) => (
				<AppActions
					app={app}
					onEdit={() => void editor.open(app.id)}
				/>
			),
```

- after the `Table`:

```tsx
			<AppFormDrawer
				open={creating || editor.state !== null}
				mode={creating ? 'create' : 'edit'}
				record={editor.state?.record}
				onClose={closeDrawer}
			/>
```

- [ ] **Step 9: e2e — create, edit, an error body from Dify**

Append to `e2e/admin-apps.spec.ts`:

```ts
test.describe('create and edit', () => {
	// One project runs at a time, so the created app is removed by name after each test.
	test.afterEach(async () => {
		await withDb(db => db.execute('DELETE FROM dify_apps WHERE name = ?', [CREATED_APP.name]))
	})

	test('an admin creates an app from its Dify API base and key, then disables it', async ({ page }) => {
		await page.goto('/app-management')
		await page.getByRole('button', { name: 'New' }).click()
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await create.getByLabel('API Base').fill(`${stubApiBase}${CREATED_APP.prefix}`)
		await create.getByLabel('API Secret').fill('app-e2e')
		await create.getByRole('button', { name: 'OK' }).click()

		const row = page.getByRole('row', { name: new RegExp(CREATED_APP.name) })
		await expect(row).toBeVisible()
		// The created app's stub site names an image icon (Task 1).
		await expect(row.locator('img')).toHaveAttribute('src', /stub-image\.png/)

		await row.getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: `Edit app configuration - ${CREATED_APP.name}` })
		await edit.getByRole('switch', { name: 'App status' }).click()
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row.getByText('Disabled')).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		await expect(
			page
				.getByRole('dialog')
				.filter({ hasText: `Edit app configuration - ${CREATED_APP.name}` })
				.getByRole('switch', { name: 'App status' }),
		).not.toBeChecked()
	})

	test('a Dify error body instead of app info keeps the drawer open with a translated error', async ({
		page,
	}) => {
		await page.goto('/app-management')
		await page.getByRole('button', { name: 'New' }).click()
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		// An unknown stub path answers Dify's 404 JSON body, which lib/api resolves as a value (Review Focus 1).
		await create.getByLabel('API Base').fill(`${stubApiBase}/nope`)
		await create.getByLabel('API Secret').fill('app-e2e')
		await create.getByRole('button', { name: 'OK' }).click()
		await expect(
			page.getByText('Could not reach the Dify app. Check the API Base and API Secret.'),
		).toBeVisible()
		await expect(create).toBeVisible()
		await expect(page.getByRole('row', { name: /nope/ })).toHaveCount(0)
	})
})
```

Run: `pnpm exec playwright test e2e/admin-apps.spec.ts`
Expected: PASS on all projects.

- [ ] **Step 10: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint components/admin e2e/admin-apps.spec.ts __tests__ && pnpm exec oxfmt --write components/admin e2e/admin-apps.spec.ts __tests__/app-form-values.test.ts __tests__/app-record.test.ts locales && pnpm test
git add components/admin locales e2e/admin-apps.spec.ts __tests__/app-form-values.test.ts __tests__/app-record.test.ts
git commit -m "feat(admin): create and edit apps in an antd form drawer with switches and array name paths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: Annotations — drawer, keyword search, add/edit modal, delete

Spec §5.5. The browser calls Dify with the app's key (loaded through `useAppRecord`), as today; the stub from Task 1 serves the endpoints.

**Files:**
- Modify: `lib/api/client.ts` (`IGetAnnotationListRequest.keyword`, `getAnnotationList`), `components/admin/apps/app-record.ts` (`isAnnotationPage`), `components/admin/apps/app-actions.tsx`, `components/admin/apps/app-management.tsx`, `locales/{en,zh,ar}/translation.json`, `e2e/admin-apps.spec.ts`
- Create: `components/admin/apps/annotations-drawer.tsx`, `components/admin/apps/annotation-form-modal.tsx`
- Test: `__tests__/app-record.test.ts`

**Interfaces:**
- Consumes: `useAppRecord`, `AppActions`, `AppManagement` (Tasks 4–5); `supportsAnnotations` (Task 4); `APP_IDS` (existing).
- Produces: `isAnnotationPage(value: unknown): value is IGetAnnotationListResponse`; default export `AnnotationsDrawer({ open: boolean; record?: IDifyAppItem; onClose: () => void })`; default export `AnnotationFormModal({ open: boolean; initial?: Pick<IAnnotationItem, 'question' | 'answer'>; onSubmit: (values: { question: string; answer: string }) => Promise<void>; onCancel: () => void })`; `AppActions` gains `onAnnotations?: () => void`; keys `annotation.search_placeholder`, `annotation.load_failed`.

- [ ] **Step 1: Write the failing unit test**

Append to `__tests__/app-record.test.ts` (add `isAnnotationPage` to the import):

```ts
describe('isAnnotationPage', () => {
	it('accepts a Dify annotation page', () => {
		expect(isAnnotationPage({ data: [], has_more: false, limit: 10, total: 0, page: 1 })).toBe(true)
	})

	it('rejects Dify error bodies, which lib/api resolves as values', () => {
		expect(isAnnotationPage({ code: 'unauthorized', message: 'x', status: 401 })).toBe(false)
		expect(isAnnotationPage({ data: 'nope', total: 0 })).toBe(false)
		expect(isAnnotationPage(undefined)).toBe(false)
	})
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run __tests__/app-record.test.ts`
Expected: FAIL (`isAnnotationPage` is not exported).

- [ ] **Step 3: The pure part and the client's `keyword`**

Append to `components/admin/apps/app-record.ts` (add `IGetAnnotationListResponse` to the `@/lib/api` type import):

```ts
/** GET /apps/annotations answered a page (data array + total), not an error body. */
export const isAnnotationPage = (value: unknown): value is IGetAnnotationListResponse =>
	isRecord(value) && Array.isArray(value.data) && typeof value.total === 'number'
```

`lib/api/client.ts` — line-level edits (spec §11):

```ts
export interface IGetAnnotationListRequest {
	page?: number
	limit?: number
	/** Filters by question or answer content (OpenAPI GET /apps/annotations). */
	keyword?: string
}
```

```ts
	getAnnotationList = async (params?: IGetAnnotationListRequest) => {
		return this.baseRequest.get('/apps/annotations', {
			page: (params?.page || 1).toString(),
			limit: (params?.limit || 20).toString(),
			...(params?.keyword ? { keyword: params.keyword } : {}),
		}) as Promise<IGetAnnotationListResponse>
	}
```

- [ ] **Step 4: Run the unit test**

Run: `pnpm exec vitest run __tests__/app-record.test.ts`
Expected: PASS.

- [ ] **Step 5: Locale keys**

Add to `annotation` — en `"search_placeholder": "Search annotations"`, `"load_failed": "Annotations could not be loaded"`; zh `"search_placeholder": "搜索标注"`, `"load_failed": "标注加载失败"`; ar `"search_placeholder": "البحث في التعليقات التوضيحية"`, `"load_failed": "تعذّر تحميل التعليقات التوضيحية"`.

- [ ] **Step 6: The modal**

Check: `npx -y @ant-design/cli demo Form form-in-modal` (Modal `destroyOnHidden`, `modalRender` with `Form clearOnDestroy`, `okButtonProps={{ htmlType: 'submit' }}`), `doc Modal` (`confirmLoading`).

`components/admin/apps/annotation-form-modal.tsx`:

```tsx
'use client'

import { Form, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IAnnotationItem } from '@/lib/api'

export interface AnnotationFormValues {
	question: string
	answer: string
}

/**
 * Add or edit an annotation (spec §5.5) in antd's form-in-modal shape: the Form wraps the modal's content through
 * `modalRender`, the OK button submits it, and `destroyOnHidden` + `clearOnDestroy` reset it on close.
 */
export default function AnnotationFormModal({
	open,
	initial,
	onSubmit,
	onCancel,
}: {
	open: boolean
	initial?: Pick<IAnnotationItem, 'question' | 'answer'>
	onSubmit: (values: AnnotationFormValues) => Promise<void>
	onCancel: () => void
}) {
	const { t } = useTranslation()
	const [form] = Form.useForm<AnnotationFormValues>()
	const [saving, setSaving] = useState(false)

	const submit = async (values: AnnotationFormValues) => {
		setSaving(true)
		try {
			await onSubmit(values)
		} finally {
			setSaving(false)
		}
	}

	return (
		<Modal
			open={open}
			title={initial ? t('annotation.edit') : t('annotation.add')}
			okText={t('common.ok')}
			cancelText={t('common.cancel')}
			okButtonProps={{ htmlType: 'submit' }}
			confirmLoading={saving}
			onCancel={onCancel}
			destroyOnHidden
			modalRender={dom => (
				<Form
					form={form}
					layout="vertical"
					clearOnDestroy
					initialValues={initial}
					onFinish={submit}
				>
					{dom}
				</Form>
			)}
		>
			<Form.Item
				name="question"
				label={t('annotation.question')}
				rules={[{ required: true, message: t('annotation.question_required') }]}
			>
				<Input.TextArea rows={3} />
			</Form.Item>
			<Form.Item
				name="answer"
				label={t('annotation.answer')}
				rules={[{ required: true, message: t('annotation.answer_required') }]}
			>
				<Input.TextArea autoSize={{ minRows: 3, maxRows: 15 }} />
			</Form.Item>
		</Modal>
	)
}
```

- [ ] **Step 7: The drawer**

Check: `doc Input` (`Input.Search` `onSearch`, `allowClear`), `doc Popconfirm` (`onConfirm` returning a Promise), `doc Table` (`pagination` controlled: `current`, `pageSize`, `total`, `onChange`, `showSizeChanger`, `showTotal`), `doc Typography` (`Paragraph ellipsis.expandable`).

`components/admin/apps/annotations-drawer.tsx`:

```tsx
'use client'

import { PlusOutlined } from '@ant-design/icons'
import {
	App,
	Button,
	Drawer,
	Flex,
	Input,
	Popconfirm,
	Result,
	Skeleton,
	Space,
	Table,
	type TableProps,
	Typography,
	theme,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DifyApi, type IAnnotationItem } from '@/lib/api'
import type { IDifyAppItem } from '@/lib/core'
import { formatDateTime } from '@/libs/format-date'

import AnnotationFormModal, { type AnnotationFormValues } from './annotation-form-modal'
import { isAnnotationPage } from './app-record'

const DEFAULT_PAGE_SIZE = 10

type Query = { page: number; limit: number; keyword: string }
type Loaded =
	| { status: 'loading' }
	| { status: 'error' }
	| { status: 'ready'; items: IAnnotationItem[]; total: number }

/** An app's Dify annotations (spec §5.5): server paging, keyword search, add/edit in a modal, confirmed delete. */
export default function AnnotationsDrawer({
	open,
	record,
	onClose,
}: {
	open: boolean
	record?: IDifyAppItem
	onClose: () => void
}) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [query, setQuery] = useState<Query>({ page: 1, limit: DEFAULT_PAGE_SIZE, keyword: '' })
	const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
	const [editing, setEditing] = useState<{ item?: IAnnotationItem } | null>(null)
	// The browser calls Dify with the app's key, as the old drawer did; the key arrives through getApp (spec §5.1).
	const difyApi = useMemo(
		() => (record ? new DifyApi({ ...record.requestConfig, user: '' }) : undefined),
		[record],
	)

	const load = useCallback(async () => {
		if (!difyApi) return
		setLoaded({ status: 'loading' })
		try {
			const page = await difyApi.getAnnotationList(query)
			if (!isAnnotationPage(page)) throw new Error('Dify answered without an annotation page')
			setLoaded({ status: 'ready', items: page.data, total: page.total })
		} catch (error) {
			console.error('Failed to load annotations', error)
			setLoaded({ status: 'error' })
		}
	}, [difyApi, query])

	useEffect(() => {
		if (open) void load()
	}, [open, load])

	const save = async (values: AnnotationFormValues) => {
		if (!difyApi) return
		try {
			if (editing?.item) {
				await difyApi.updateAnnotation(editing.item.id, values)
				message.success(t('common.update_success'))
			} else {
				await difyApi.createAnnotation(values)
				message.success(t('common.create_success'))
			}
			setEditing(null)
			await load()
		} catch (error) {
			console.error('Failed to save the annotation', error)
			message.error(t('common.operation_failed'))
		}
	}

	const remove = async (id: string) => {
		if (!difyApi) return
		try {
			await difyApi.deleteAnnotation(id)
			message.success(t('common.delete_success'))
			await load()
		} catch (error) {
			console.error('Failed to delete the annotation', error)
			message.error(t('common.delete_failed'))
		}
	}

	const text = (value: string) => (
		<Typography.Paragraph
			ellipsis={{ rows: 3, expandable: true }}
			style={{ marginBottom: 0 }}
		>
			{value}
		</Typography.Paragraph>
	)
	const columns: TableProps<IAnnotationItem>['columns'] = [
		{ title: t('annotation.question'), dataIndex: 'question', render: text },
		{ title: t('annotation.answer'), dataIndex: 'answer', render: text },
		{ title: t('annotation.hit_count'), dataIndex: 'hit_count' },
		{
			title: t('common.created_at'),
			dataIndex: 'created_at',
			render: (value: number) => formatDateTime(value * 1000, i18n.resolvedLanguage),
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, item) => (
				<Space>
					<Button
						type="link"
						onClick={() => setEditing({ item })}
					>
						{t('common.edit')}
					</Button>
					<Popconfirm
						title={t('annotation.delete_confirm')}
						okText={t('common.delete')}
						okButtonProps={{ danger: true }}
						cancelText={t('common.cancel')}
						// A Promise keeps the OK button loading until the delete settles (antd Popconfirm, promise demo).
						onConfirm={() => remove(item.id)}
					>
						<Button
							type="link"
							danger
						>
							{t('common.delete')}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	]

	return (
		<Drawer
			open={open}
			onClose={onClose}
			size="large"
			destroyOnHidden
			title={t('admin_apps.annotations')}
			extra={
				<Button
					type="primary"
					icon={<PlusOutlined />}
					disabled={!record}
					onClick={() => setEditing({})}
				>
					{t('annotation.add')}
				</Button>
			}
		>
			{!record ? (
				<Skeleton
					active
					paragraph={{ rows: 6 }}
				/>
			) : (
				<Flex
					vertical
					gap={token.margin}
				>
					<Input.Search
						allowClear
						placeholder={t('annotation.search_placeholder')}
						aria-label={t('annotation.search_placeholder')}
						onSearch={value => setQuery(current => ({ ...current, page: 1, keyword: value.trim() }))}
					/>
					{loaded.status === 'error' ? (
						<Result
							status="error"
							title={t('annotation.load_failed')}
							extra={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
						/>
					) : (
						<Table
							rowKey="id"
							columns={columns}
							loading={loaded.status === 'loading'}
							dataSource={loaded.status === 'ready' ? loaded.items : []}
							scroll={{ x: 'max-content' }}
							pagination={{
								current: query.page,
								pageSize: query.limit,
								total: loaded.status === 'ready' ? loaded.total : 0,
								showSizeChanger: true,
								showTotal: total => t('common.total_items', { total }),
								onChange: (page, limit) => setQuery(current => ({ ...current, page, limit })),
							}}
						/>
					)}
				</Flex>
			)}
			<AnnotationFormModal
				open={editing !== null}
				initial={editing?.item}
				onSubmit={save}
				onCancel={() => setEditing(null)}
			/>
		</Drawer>
	)
}
```

- [ ] **Step 8: Wire the menu item and the second record loader**

`components/admin/apps/app-actions.tsx` — props become `{ app: AdminAppRow; onEdit: () => void; onAnnotations?: () => void }`; the menu items gain, between sync and the divider:

```tsx
		...(onAnnotations ? [{ key: 'annotations', label: t('admin_apps.annotations') }] : []),
```

and `onClick` handles it: `if (key === 'annotations') onAnnotations?.()`.

`components/admin/apps/app-management.tsx` — import `AnnotationsDrawer from './annotations-drawer'` and `{ supportsAnnotations } from './admin-app-row'`; add `const annotator = useAppRecord()`; the actions column:

```tsx
			render: (_, app) => (
				<AppActions
					app={app}
					onEdit={() => void editor.open(app.id)}
					onAnnotations={
						supportsAnnotations(app.mode) ? () => void annotator.open(app.id) : undefined
					}
				/>
			),
```

and after `AppFormDrawer`:

```tsx
			<AnnotationsDrawer
				open={annotator.state !== null}
				record={annotator.state?.record}
				onClose={annotator.close}
			/>
```

- [ ] **Step 9: e2e**

Append to `e2e/admin-apps.spec.ts` (add `APP_IDS` to the constants import):

```ts
test.describe('annotations', () => {
	const chatflow = APP_IDS['advanced-chat']

	test('the menu offers annotations for chat apps only', async ({ page }) => {
		await page.goto('/app-management')
		await moreActions(page, APP_IDS.workflow).click()
		await expect(page.getByRole('menuitem', { name: 'Sync app info' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Annotations' })).toHaveCount(0)
		await page.keyboard.press('Escape')
		await moreActions(page, chatflow).click()
		await expect(page.getByRole('menuitem', { name: 'Annotations' })).toBeVisible()
	})

	test('an admin adds, finds, edits and deletes an annotation', async ({ page }, testInfo) => {
		const question = `How do I reset? ${testInfo.project.name}`
		await page.goto('/app-management')
		await moreActions(page, chatflow).click()
		await page.getByRole('menuitem', { name: 'Annotations' }).click()
		const drawer = page.getByRole('dialog').filter({ hasText: 'Annotations' })
		await expect(drawer.getByRole('table')).toBeVisible()

		await drawer.getByRole('button', { name: 'New annotation' }).click()
		const modal = page.getByRole('dialog').filter({ hasText: 'New annotation' })
		await modal.getByLabel('Question').fill(question)
		await modal.getByLabel('Answer').fill('Open the account menu.')
		await modal.getByRole('button', { name: 'OK' }).click()
		const row = drawer.getByRole('row', { name: new RegExp(testInfo.project.name) })
		await expect(row).toBeVisible()

		// Keyword search goes to Dify (the stub filters question or answer).
		await drawer.getByRole('searchbox', { name: 'Search annotations' }).fill('no such text')
		await page.keyboard.press('Enter')
		await expect(row).toHaveCount(0)
		await drawer.getByRole('searchbox', { name: 'Search annotations' }).fill(testInfo.project.name)
		await page.keyboard.press('Enter')
		await expect(row).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit annotation' })
		await edit.getByLabel('Answer').fill('Open the account menu, then Reset.')
		await edit.getByRole('button', { name: 'OK' }).click()
		await expect(row).toContainText('then Reset')

		await row.getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).last().click()
		await expect(row).toHaveCount(0)
	})
})
```

If `Input.Search`'s textbox has no `searchbox` role in antd 6.6.5 (check the trace), locate it with `getByRole('textbox', { name: 'Search annotations' })`.

Run: `pnpm exec playwright test e2e/admin-apps.spec.ts`
Expected: PASS on all projects.

- [ ] **Step 10: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint components/admin lib/api/client.ts e2e/admin-apps.spec.ts __tests__/app-record.test.ts && pnpm exec oxfmt --write components/admin lib/api/client.ts e2e/admin-apps.spec.ts __tests__/app-record.test.ts locales && pnpm test
git add components/admin lib/api/client.ts locales e2e/admin-apps.spec.ts __tests__/app-record.test.ts
git commit -m "feat(admin): annotations drawer with Dify keyword search, form modal and confirmed delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: `/user-management` — server page, table, drawer, dates in the browser's zone

Spec §3.2, §3.6, §6. The user query only exists inside the route handler today, so the page gets a fork-owned `server-only` read module; writes keep `/api/users`.

**Files:**
- Create: `lib/data/users.ts`, `components/admin/users/user-row.ts`, `components/admin/users/user-errors.ts`, `components/admin/client-date-time.tsx`, `components/admin/users/user-management.tsx`, `components/admin/users/user-form-drawer.tsx`
- Replace: `app/(admin)/user-management/page.tsx`
- Delete: `app/(admin)/user-management/components/user-edit-drawer.tsx`
- Modify: `locales/{en,zh,ar}/translation.json`, `e2e/ssr-first-paint.spec.ts`
- Test: `__tests__/user-row.test.ts`, `__tests__/user-errors.test.ts`, `__tests__/user-management-page.test.ts`, `e2e/admin-users.spec.ts`

**Interfaces:**
- Consumes: `AdminPageHeader` (Task 4); `matchesQuery` (Task 3); `withDb` (Task 1).
- Produces: `listUsers(): Promise<{ id: string; name: string | null; email: string; createdAt: Date; updatedAt: Date }[]>`, `hasUsers(): Promise<boolean>` (Task 10 uses it); `interface UserRow { id: string; name: string | null; email: string; createdAt: string; updatedAt: string }`, `toUserRows(users): UserRow[]`; `userErrorKey(status: number, action: 'create' | 'update' | 'delete')`; default export `ClientDateTime({ value: string })`; keys `admin_users.search_placeholder`, `admin_users.email_in_use`, `admin_users.not_found`, `admin_users.cannot_delete_self`, `common.session_expired`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/user-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { toUserRows } from '@/components/admin/users/user-row'

describe('toUserRows', () => {
	it('passes dates to the client as ISO strings, so the browser formats them in its own zone', () => {
		const created = new Date('2026-01-15T09:05:00.000Z')
		expect(
			toUserRows([{ id: 'u1', name: null, email: 'a@b.c', createdAt: created, updatedAt: created }]),
		).toEqual([
			{
				id: 'u1',
				name: null,
				email: 'a@b.c',
				createdAt: '2026-01-15T09:05:00.000Z',
				updatedAt: '2026-01-15T09:05:00.000Z',
			},
		])
	})
})
```

`__tests__/user-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { userErrorKey } from '@/components/admin/users/user-errors'

// The /api/users routes answer in Chinese (spec §3.6); the client maps the status instead of printing the text.
describe('userErrorKey', () => {
	it('maps the documented statuses of each action', () => {
		expect(userErrorKey(400, 'create')).toBe('admin_users.email_in_use')
		expect(userErrorKey(400, 'update')).toBe('admin_users.email_in_use')
		expect(userErrorKey(400, 'delete')).toBe('admin_users.cannot_delete_self')
		expect(userErrorKey(404, 'update')).toBe('admin_users.not_found')
		expect(userErrorKey(404, 'delete')).toBe('admin_users.not_found')
		expect(userErrorKey(401, 'create')).toBe('common.session_expired')
	})

	it('falls back to the generic failure', () => {
		expect(userErrorKey(500, 'create')).toBe('common.operation_failed')
		expect(userErrorKey(418, 'delete')).toBe('common.operation_failed')
	})
})
```

`__tests__/user-management-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireSessionUser, getCachedServerSession, listUsers, UserManagement, redirectSignal } =
	vi.hoisted(() => ({
		requireSessionUser: vi.fn(),
		getCachedServerSession: vi.fn(),
		listUsers: vi.fn(),
		UserManagement: () => null,
		redirectSignal: new Error('NEXT_REDIRECT'),
	}))
vi.mock('@/lib/session-user', () => ({ requireSessionUser, getCachedServerSession }))
vi.mock('@/lib/data/users', () => ({ listUsers }))
vi.mock('@/components/admin/users/user-management', () => ({ default: UserManagement }))

import UserManagementPage from '@/app/(admin)/user-management/page'

describe('/user-management page', () => {
	beforeEach(() => {
		requireSessionUser.mockReset()
		getCachedServerSession.mockReset()
		listUsers.mockReset()
	})

	it('checks the session before it lists the users', async () => {
		requireSessionUser.mockRejectedValue(redirectSignal)
		await expect(UserManagementPage()).rejects.toBe(redirectSignal)
		expect(listUsers).not.toHaveBeenCalled()
	})

	it('hands the table the rows and the signed-in user id', async () => {
		requireSessionUser.mockResolvedValue(undefined)
		getCachedServerSession.mockResolvedValue({ user: { id: 'u1', email: 'admin@e2e.local' } })
		const at = new Date('2026-01-15T09:05:00.000Z')
		listUsers.mockResolvedValue([
			{ id: 'u1', name: 'Admin', email: 'admin@e2e.local', createdAt: at, updatedAt: at },
		])
		expect(await UserManagementPage()).toMatchObject({
			type: UserManagement,
			props: {
				currentUserId: 'u1',
				users: [{ id: 'u1', email: 'admin@e2e.local', createdAt: '2026-01-15T09:05:00.000Z' }],
			},
		})
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/user-row.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts`
Expected: FAIL (modules not found; the old page is a client component).

- [ ] **Step 3: The data module and the pure parts**

`lib/data/users.ts` (spec §3.2; `server-only` is handled by Next itself, data-security guide — the npm package is not installed):

```ts
import 'server-only'

import { count, desc } from 'drizzle-orm'

import { getDb } from '@/db'
import { users } from '@/db/schema'

/**
 * Reads for the server pages (spec §3.2). Not a 'use server' module, so nothing here is an endpoint; the
 * route handlers keep their own copies of these queries until the backend rework folds them together.
 */
export async function listUsers() {
	return getDb()
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt,
		})
		.from(users)
		.orderBy(desc(users.createdAt))
}

/** Whether the first admin exists (the /init page's check; the same count as /api/init/status). */
export async function hasUsers() {
	const [row] = await getDb().select({ count: count() }).from(users)
	return (row?.count ?? 0) > 0
}
```

If `pnpm exec tsc --noEmit` or `next build` reports `Cannot find module 'server-only'`, run `pnpm add server-only` (the guide allows it) and note the dependency in the task report and in Task 11's ADR.

`components/admin/users/user-row.ts`:

```ts
/** One row of the user table (spec §6). Dates travel as ISO strings and are formatted in the browser. */
export interface UserRow {
	id: string
	name: string | null
	email: string
	createdAt: string
	updatedAt: string
}

export const toUserRows = (
	users: { id: string; name: string | null; email: string; createdAt: Date; updatedAt: Date }[],
): UserRow[] =>
	users.map(user => ({
		id: user.id,
		name: user.name,
		email: user.email,
		createdAt: user.createdAt.toISOString(),
		updatedAt: user.updatedAt.toISOString(),
	}))
```

`components/admin/users/user-errors.ts`:

```ts
export type UserAction = 'create' | 'update' | 'delete'

/**
 * Spec §3.6: /api/users answers 400 for a taken email (create, update) or a self-delete, 404 for a missing user,
 * 401 without a live session. The form already guarantees the required fields, so 400 has one meaning per action.
 */
export const userErrorKey = (status: number, action: UserAction) => {
	if (status === 401) return 'common.session_expired' as const
	if (status === 404) return 'admin_users.not_found' as const
	if (status === 400) {
		return action === 'delete'
			? ('admin_users.cannot_delete_self' as const)
			: ('admin_users.email_in_use' as const)
	}
	return 'common.operation_failed' as const
}
```

- [ ] **Step 4: Locale keys**

Add to `admin_users` — en `"search_placeholder": "Search users"`, `"email_in_use": "This email is already in use"`, `"not_found": "User not found"`, `"cannot_delete_self": "You cannot delete your own account"`; zh `"search_placeholder": "搜索用户"`, `"email_in_use": "该邮箱已被使用"`, `"not_found": "用户不存在"`, `"cannot_delete_self": "不能删除自己的账户"`; ar `"search_placeholder": "البحث في المستخدمين"`, `"email_in_use": "هذا البريد الإلكتروني مستخدم بالفعل"`, `"not_found": "المستخدم غير موجود"`, `"cannot_delete_self": "لا يمكنك حذف حسابك الخاص"`.
Add to `common` — en `"session_expired": "Your session has expired. Sign in again."`, zh `"session_expired": "登录已过期，请重新登录。"`, ar `"session_expired": "انتهت صلاحية جلستك. سجّل الدخول مرة أخرى."`.

- [ ] **Step 5: `components/admin/client-date-time.tsx`**

React documents the two-pass pattern (react.dev, "Two-pass rendering with isClient"): the server and the first client render agree on a placeholder, the browser's zone appears after mount; `suppressHydrationWarning` would only hide the mismatch and leave the server text in place.

```tsx
'use client'

import { Skeleton } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '@/libs/format-date'

/** A timestamp formatted in the browser's time zone and the UI language, after hydration (spec §6). */
export default function ClientDateTime({ value }: { value: string }) {
	const { i18n } = useTranslation()
	const [mounted, setMounted] = useState(false)
	useEffect(() => {
		setMounted(true)
	}, [])
	return (
		<time dateTime={value}>
			{mounted ? (
				formatDateTime(value, i18n.resolvedLanguage)
			) : (
				<Skeleton.Input
					active
					size="small"
				/>
			)}
		</time>
	)
}
```

- [ ] **Step 6: The drawer and the table**

Check: `npx -y @ant-design/cli doc Drawer` (default `size`), `doc Form` (`rules` `min`, `help`), `doc Popconfirm`, `doc Table` (`pagination.showQuickJumper`, `showTotal`), `doc Avatar` (`icon`).

`components/admin/users/user-form-drawer.tsx`:

```tsx
'use client'

import { App, Button, Drawer, Form, Input, Space } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { userErrorKey } from './user-errors'
import type { UserRow } from './user-row'

const PASSWORD_MIN = 8

interface UserFormValues {
	name: string
	email: string
	password?: string
}

/** Add or edit a user (spec §6): /api/users keeps its contract; 8-character minimum everywhere (owner decision). */
export default function UserFormDrawer({
	open,
	user,
	onClose,
}: {
	open: boolean
	/** The user to edit; absent when adding. */
	user?: UserRow
	onClose: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [form] = Form.useForm<UserFormValues>()
	const [saving, setSaving] = useState(false)

	const save = async (values: UserFormValues) => {
		setSaving(true)
		try {
			const response = await fetch(user ? `/api/users/${user.id}` : '/api/users', {
				method: user ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			if (!response.ok) {
				message.error(t(userErrorKey(response.status, user ? 'update' : 'create')))
				return
			}
			message.success(user ? t('admin_users.update_success') : t('admin_users.add_success'))
			onClose()
			router.refresh()
		} catch (error) {
			console.error('Failed to save the user', error)
			message.error(t('common.operation_error'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			destroyOnHidden
			title={user ? t('admin_users.edit_user') : t('admin_users.add_user')}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={saving}
						onClick={() => form.submit()}
					>
						{user ? t('common.update') : t('common.add')}
					</Button>
				</Space>
			}
		>
			<Form
				form={form}
				layout="vertical"
				initialValues={user ? { name: user.name ?? '', email: user.email } : undefined}
				onFinish={save}
			>
				<Form.Item
					name="name"
					label={t('admin_users.name')}
					rules={[{ required: true, message: t('admin_users.name_required') }]}
				>
					<Input placeholder={t('admin_users.name_placeholder')} />
				</Form.Item>
				<Form.Item
					name="email"
					label={t('auth.email')}
					rules={[
						{ required: true, message: t('admin_users.email_required') },
						{ type: 'email', message: t('auth.email_invalid') },
					]}
				>
					<Input placeholder={t('admin_users.email_placeholder')} />
				</Form.Item>
				<Form.Item
					name="password"
					label={user ? t('auth.new_password') : t('auth.password')}
					help={user ? t('admin_users.password_keep_hint') : undefined}
					rules={[
						...(user ? [] : [{ required: true, message: t('admin_users.password_required') }]),
						{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
					]}
				>
					<Input.Password autoComplete="new-password" />
				</Form.Item>
			</Form>
		</Drawer>
	)
}
```

`components/admin/users/user-management.tsx`:

```tsx
'use client'

import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import {
	App,
	Avatar,
	Button,
	Col,
	Flex,
	Input,
	Popconfirm,
	Row,
	Space,
	Table,
	type TableProps,
	Tag,
	Typography,
	theme,
} from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AdminPageHeader from '@/components/admin/admin-page-header'
import ClientDateTime from '@/components/admin/client-date-time'
import { matchesQuery } from '@/lib/match-query'

import { userErrorKey } from './user-errors'
import UserFormDrawer from './user-form-drawer'
import type { UserRow } from './user-row'

type Drawer = { mode: 'create' } | { mode: 'edit'; user: UserRow } | null

/** The user table (spec §6). The "Active" tag is kept as it was (owner decision); dates format in the browser. */
export default function UserManagement({
	users,
	currentUserId,
}: {
	users: UserRow[]
	currentUserId: string
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const router = useRouter()
	const [query, setQuery] = useState('')
	const [drawer, setDrawer] = useState<Drawer>(null)
	const shown = users.filter(user => matchesQuery([user.name, user.email], query))

	const remove = async (user: UserRow) => {
		try {
			const response = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
			if (!response.ok) {
				message.error(t(userErrorKey(response.status, 'delete')))
				return
			}
			message.success(t('admin_users.delete_success'))
			router.refresh()
		} catch (error) {
			console.error('Failed to delete the user', error)
			message.error(t('admin_users.delete_error'))
		}
	}

	const columns: TableProps<UserRow>['columns'] = [
		{
			title: t('admin_users.column_user'),
			key: 'user',
			render: (_, user) => (
				<Space>
					<Avatar icon={<UserOutlined />} />
					<div>
						<div>{user.name || t('admin_users.name_not_set')}</div>
						<Typography.Text type="secondary">{user.email}</Typography.Text>
					</div>
				</Space>
			),
		},
		{
			title: t('common.status'),
			key: 'status',
			render: () => <Tag color="green">{t('admin_users.status_active')}</Tag>,
		},
		{
			title: t('common.created_at'),
			key: 'createdAt',
			render: (_, user) => <ClientDateTime value={user.createdAt} />,
		},
		{
			title: t('admin_users.column_updated_at'),
			key: 'updatedAt',
			render: (_, user) => <ClientDateTime value={user.updatedAt} />,
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, user) => (
				<Space>
					<Button
						type="text"
						icon={<EditOutlined />}
						onClick={() => setDrawer({ mode: 'edit', user })}
					>
						{t('common.edit')}
					</Button>
					{user.id !== currentUserId && (
						<Popconfirm
							title={t('admin_users.delete_confirm_title')}
							description={t('admin_users.delete_confirm_description')}
							okText={t('common.delete')}
							okButtonProps={{ danger: true }}
							cancelText={t('common.cancel')}
							onConfirm={() => remove(user)}
						>
							<Button
								type="text"
								danger
								icon={<DeleteOutlined />}
							>
								{t('common.delete')}
							</Button>
						</Popconfirm>
					)}
				</Space>
			),
		},
	]

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<AdminPageHeader
				title={t('admin.menu_users')}
				subtitle={t('admin_users.subtitle')}
				action={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => setDrawer({ mode: 'create' })}
					>
						{t('admin_users.add_user')}
					</Button>
				}
			/>
			<Row>
				<Col
					xs={24}
					md={12}
					lg={8}
				>
					<Input
						allowClear
						prefix={<SearchOutlined />}
						placeholder={t('admin_users.search_placeholder')}
						aria-label={t('admin_users.search_placeholder')}
						value={query}
						onChange={event => setQuery(event.target.value)}
					/>
				</Col>
			</Row>
			<Table
				rowKey="id"
				columns={columns}
				dataSource={shown}
				scroll={{ x: 'max-content' }}
				pagination={{
					showSizeChanger: true,
					showQuickJumper: true,
					showTotal: total => t('admin_users.total', { total }),
				}}
			/>
			<UserFormDrawer
				open={drawer !== null}
				user={drawer?.mode === 'edit' ? drawer.user : undefined}
				onClose={() => setDrawer(null)}
			/>
		</Flex>
	)
}
```

`app/(admin)/user-management/page.tsx` (replace the whole file):

```tsx
import UserManagement from '@/components/admin/users/user-management'
import { toUserRows } from '@/components/admin/users/user-row'
import { listUsers } from '@/lib/data/users'
import { getCachedServerSession, requireSessionUser } from '@/lib/session-user'

/** Spec §6: the signed-in user's database id (session.user.id; getSessionUserId() is the email) hides their Delete. */
export default async function UserManagementPage() {
	await requireSessionUser()
	const [session, users] = await Promise.all([getCachedServerSession(), listUsers()])
	return (
		<UserManagement
			users={toUserRows(users)}
			currentUserId={session?.user?.id ?? ''}
		/>
	)
}
```

Delete `app/(admin)/user-management/components/user-edit-drawer.tsx`.

- [ ] **Step 7: Run the unit tests**

Run: `pnpm exec vitest run __tests__/user-row.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts __tests__/i18n-locales.test.ts`
Expected: PASS.

- [ ] **Step 8: e2e**

`e2e/admin-users.spec.ts`:

```ts
import { expect, type Page, test } from '@playwright/test'

import { withDb } from './fixtures/db'
import { e2eEnv } from './fixtures/env'

const row = (page: Page, email: string) => page.getByRole('row', { name: new RegExp(email) })

test.describe('user CRUD', () => {
	// Spec users carry the project name and are removed after each test (the database survives between runs).
	test.afterEach(async ({}, testInfo) => {
		await withDb(db =>
			db.execute('DELETE FROM users WHERE email LIKE ?', [`user-${testInfo.project.name}%`]),
		)
	})

	test('an admin adds a user (8-character minimum), edits it, cannot reuse its email, and deletes it', async ({
		page,
	}, testInfo) => {
		const email = `user-${testInfo.project.name}@e2e.local`
		await page.goto('/user-management')

		await page.getByRole('button', { name: 'Add user' }).click()
		const add = page.getByRole('dialog').filter({ hasText: 'Add user' })
		await add.getByLabel('Name').fill('Spec user')
		await add.getByLabel('Email').fill(email)
		await add.getByLabel('Password').fill('1234567')
		await add.getByRole('button', { name: 'Add' }).click()
		await expect(add.getByText('Password must be at least 8 characters')).toBeVisible()
		await add.getByLabel('Password').fill('12345678')
		await add.getByRole('button', { name: 'Add' }).click()
		await expect(row(page, email)).toBeVisible()

		await row(page, email).getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
		await edit.getByLabel('Name').fill('Spec user renamed')
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row(page, email)).toContainText('Spec user renamed')

		await page.getByRole('button', { name: 'Add user' }).click()
		const again = page.getByRole('dialog').filter({ hasText: 'Add user' })
		await again.getByLabel('Name').fill('Twin')
		await again.getByLabel('Email').fill(email)
		await again.getByLabel('Password').fill('12345678')
		await again.getByRole('button', { name: 'Add' }).click()
		await expect(page.getByText('This email is already in use')).toBeVisible()
		await again.getByRole('button', { name: 'Cancel' }).click()

		await row(page, email).getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).last().click()
		await expect(row(page, email)).toHaveCount(0)
	})

	test('search narrows the table, and the signed-in admin has no Delete', async ({ page }, testInfo) => {
		const email = `user-${testInfo.project.name}-search@e2e.local`
		await page.request.post('/api/users', { data: { name: 'Needle', email, password: '12345678' } })
		await page.goto('/user-management')
		await expect(row(page, email)).toBeVisible()
		await page.getByRole('textbox', { name: 'Search users' }).fill('needle')
		await expect(row(page, email)).toBeVisible()
		await expect(row(page, e2eEnv.E2E_ADMIN_EMAIL)).toHaveCount(0)
		await page.getByRole('textbox', { name: 'Search users' }).fill('')
		const own = row(page, e2eEnv.E2E_ADMIN_EMAIL)
		await expect(own.getByRole('button', { name: 'Edit' })).toBeVisible()
		await expect(own.getByRole('button', { name: 'Delete' })).toHaveCount(0)
	})
})

test.describe('dates in the browser zone', () => {
	// Far from the server's UTC (Review Focus 4): the text must be the browser's, with no hydration complaint.
	test.use({ timezoneId: 'Pacific/Kiritimati' })

	test('user dates render in the browser time zone without a hydration mismatch', async ({ page }) => {
		const complaints: string[] = []
		page.on('console', message => {
			if (/hydrat/i.test(message.text())) complaints.push(message.text())
		})
		await page.goto('/user-management')
		const time = page.getByRole('row', { name: /admin@e2e\.local/ }).locator('time').first()
		await expect(time).not.toContainText(/^\s*$/)
		const { text, local, utc } = await time.evaluate(el => {
			const at = new Date(el.getAttribute('datetime') ?? '')
			return {
				text: el.textContent,
				local: at.toLocaleString('en-US'),
				utc: at.toLocaleString('en-US', { timeZone: 'UTC' }),
			}
		})
		expect(text).toBe(local)
		expect(text).not.toBe(utc)
		expect(complaints).toEqual([])
	})
})
```

`e2e/ssr-first-paint.spec.ts` — append:

```ts
test('the user table arrives with its rows in the first HTML (spec §6)', async ({ page }) => {
	const html = await (await page.request.get('/user-management')).text()
	expect(html).toContain('admin@e2e.local')
})
```

Run: `pnpm exec playwright test e2e/admin-users.spec.ts e2e/ssr-first-paint.spec.ts e2e/shell.spec.ts`
Expected: PASS on all projects.

- [ ] **Step 9: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint lib/data components/admin "app/(admin)/user-management" e2e/admin-users.spec.ts __tests__ && pnpm exec oxfmt --write lib/data components/admin "app/(admin)/user-management" e2e/admin-users.spec.ts e2e/ssr-first-paint.spec.ts __tests__/user-row.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts locales && pnpm test
git add lib/data components/admin "app/(admin)/user-management/page.tsx" locales e2e/admin-users.spec.ts e2e/ssr-first-paint.spec.ts __tests__/user-row.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts
git rm -q "app/(admin)/user-management/components/user-edit-drawer.tsx"
git commit -m "feat(admin): server-rendered user table with search, 8-character passwords and browser-zone dates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: The auth frame, `/login` and `/`

Spec §7.1, §7.2, §7.6. `AuthCard` becomes the branded frame for every auth page and `/init`; the login page reads `searchParams` on the server; `/` is a server redirect.

**Files:**
- Create: `lib/search-params.ts`, `components/shell/auth-card.module.css`, `components/auth/login-form.tsx`, `components/auth/login-form.module.css`, `app/(auth)/error.tsx`
- Replace: `components/shell/auth-card.tsx`, `app/(auth)/login/page.tsx`, `app/page.tsx`
- Test: `__tests__/search-params.test.ts`, `__tests__/login-page.test.ts`, `__tests__/root-page.test.ts`, `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `RouteError` (Task 3); `getSafeCallbackUrl` (`lib/access.ts`), `redirectSignedInUser` (existing login layout, unchanged).
- Produces: `firstParam(value: string | string[] | undefined): string | undefined`; `type SearchParams = Promise<Record<string, string | string[] | undefined>>`; default export `AuthCard({ children })` (the `title` prop goes; the brand header is built in); default export `LoginForm({ callbackUrl?: string; email?: string })`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/search-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { firstParam } from '@/lib/search-params'

// Next hands a page `searchParams` as string | string[] | undefined per key (page.md).
describe('firstParam', () => {
	it('returns a single value as is and the first of a repeated key', () => {
		expect(firstParam('abc')).toBe('abc')
		expect(firstParam(['first', 'second'])).toBe('first')
	})

	it('returns undefined for a missing key, an empty list or an empty string', () => {
		expect(firstParam(undefined)).toBeUndefined()
		expect(firstParam([])).toBeUndefined()
		expect(firstParam('')).toBeUndefined()
	})
})
```

`__tests__/login-page.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const { LoginForm } = vi.hoisted(() => ({ LoginForm: () => null }))
vi.mock('@/components/auth/login-form', () => ({ default: LoginForm }))

import LoginPage from '@/app/(auth)/login/page'

describe('/login page', () => {
	it('hands the form the callbackUrl and the email from the query', async () => {
		const page = await LoginPage({
			searchParams: Promise.resolve({ callbackUrl: '/app-management', email: 'jane@example.com' }),
		})
		expect(page).toMatchObject({
			type: LoginForm,
			props: { callbackUrl: '/app-management', email: 'jane@example.com' },
		})
	})

	it('passes nothing for a bare /login', async () => {
		const page = await LoginPage({ searchParams: Promise.resolve({}) })
		expect(page).toMatchObject({ type: LoginForm, props: { callbackUrl: undefined, email: undefined } })
	})
})
```

`__tests__/root-page.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const { redirect, redirectSignal } = vi.hoisted(() => ({
	redirect: vi.fn(),
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('next/navigation', () => ({ redirect }))

import Home from '@/app/page'

describe('/ page', () => {
	it('redirects to /apps on the server (the proxy already sends signed-out visitors to /login)', () => {
		redirect.mockImplementation(() => {
			throw redirectSignal
		})
		expect(() => Home()).toThrow(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/apps')
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/search-params.test.ts __tests__/login-page.test.ts __tests__/root-page.test.ts`
Expected: FAIL (module not found; the old pages are client components).

- [ ] **Step 3: `lib/search-params.ts` and `app/page.tsx`**

```ts
// lib/search-params.ts
/** The `searchParams` a Next page receives (page.md): a Promise of string | string[] | undefined per key. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** The first value of a query key, or undefined when it is missing or empty. */
export const firstParam = (value: string | string[] | undefined): string | undefined => {
	const first = Array.isArray(value) ? value[0] : value
	return first ? first : undefined
}
```

`app/page.tsx` (replace the whole file):

```tsx
import { redirect } from 'next/navigation'

// Spec §7.6: a server redirect replaces the client spinner. Signed out, the proxy already sends `/` to
// /login?callbackUrl=%2F; redirect() throws, so nothing may wrap it in try/catch (Next redirect reference).
export default function Home() {
	redirect('/apps')
}
```

- [ ] **Step 4: The frame**

`components/shell/auth-card.module.css`:

```css
/* The auth pages' surface (spec §7.1): the layout background, centred, viewport-high (ADR-0011's 100dvh with the
   100vh fallback before it). */
.surface {
	min-height: 100vh;
	min-height: 100dvh;
	background: var(--ant-color-bg-layout);
	padding: var(--ant-padding-lg);
}
.brand {
	margin-bottom: var(--ant-margin-lg);
}
.brandTitle {
	margin: 0;
}
```

`components/shell/auth-card.tsx` (replace the whole file):

```tsx
'use client'

import { Card, Col, Flex, Row, Typography } from 'antd'
import Image from 'next/image'

import LogoIcon from '@/assets/images/logo.png'

import styles from './auth-card.module.css'

/**
 * Centred card with the brand header for login, password reset and first-run setup (spec §7.1). The logo keeps
 * its own 81×83 proportions: `width` only, and next/image derives the height from the static import.
 */
export default function AuthCard({ children }: { children: React.ReactNode }) {
	return (
		<Row
			align="middle"
			justify="center"
			className={styles.surface}
		>
			<Col
				xs={24}
				sm={16}
				md={12}
				lg={10}
				xl={8}
			>
				<Card>
					<Flex
						vertical
						align="center"
						gap="small"
						className={styles.brand}
					>
						<Image
							src={LogoIcon}
							width={64}
							alt=""
							priority
						/>
						<Typography.Title
							level={3}
							className={styles.brandTitle}
						>
							Dify App Hub
						</Typography.Title>
					</Flex>
					{children}
				</Card>
			</Col>
		</Row>
	)
}
```

`app/(auth)/error.tsx`:

```tsx
'use client'

import RouteError from '@/components/shell/route-error'

// Rendered inside the (auth) layout's AuthCard (an error.tsx does not wrap its own segment's layout, error.md).
export default function AuthError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return <RouteError retry={retry} />
}
```

- [ ] **Step 5: The login form and page**

`components/auth/login-form.module.css`:

```css
.subtitle {
	text-align: center;
	margin-bottom: var(--ant-margin-lg);
}
.forgot {
	text-align: end;
}
```

`components/auth/login-form.tsx`:

```tsx
'use client'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { App, Button, Form, Input, Typography } from 'antd'
import { getSession, signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSafeCallbackUrl } from '@/lib/access'

import styles from './login-form.module.css'

interface LoginValues {
	email: string
	password: string
}

/** Spec §7.2: labels on, placeholders and the flow kept (`signIn` without redirect, then the safe callback). */
export default function LoginForm({ callbackUrl, email }: { callbackUrl?: string; email?: string }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	const login = async (values: LoginValues) => {
		setLoading(true)
		try {
			const result = await signIn('credentials', { ...values, redirect: false })
			if (result?.error) {
				message.error(t('auth.login_failed'))
				return
			}
			message.success(t('auth.login_success'))
			if (await getSession()) router.push(getSafeCallbackUrl(callbackUrl ?? null))
		} catch (error) {
			console.error('Error during login', error)
			message.error(t('auth.login_error'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<Typography.Paragraph className={styles.subtitle}>{t('auth.login_subtitle')}</Typography.Paragraph>
			<Form
				name="login"
				layout="vertical"
				size="large"
				autoComplete="off"
				initialValues={email ? { email } : undefined}
				onFinish={login}
			>
				<Form.Item
					name="email"
					label={t('auth.email')}
					rules={[
						{ required: true, message: t('auth.email_required') },
						{ type: 'email', message: t('auth.email_invalid') },
					]}
				>
					<Input
						prefix={<UserOutlined />}
						placeholder={t('auth.email_placeholder')}
					/>
				</Form.Item>
				<Form.Item
					name="password"
					label={t('auth.password')}
					rules={[{ required: true, message: t('auth.password_required') }]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t('auth.password')}
					/>
				</Form.Item>
				<Form.Item>
					<Button
						type="primary"
						htmlType="submit"
						block
						loading={loading}
					>
						{t('auth.login')}
					</Button>
				</Form.Item>
				<div className={styles.forgot}>
					<Link href="/forgot-password">{t('auth.forgot_password_link')}</Link>
				</div>
			</Form>
		</>
	)
}
```

Check `getSafeCallbackUrl`'s parameter type in `lib/access.ts` (it takes the raw `searchParams.get()` value, `string | null`) and adjust the `?? null` if the signature differs.

`app/(auth)/login/page.tsx` (replace the whole file):

```tsx
import LoginForm from '@/components/auth/login-form'
import { firstParam, type SearchParams } from '@/lib/search-params'

/** Spec §7.2: the server page reads the query; the login layout keeps redirectSignedInUser(). */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams
	return (
		<LoginForm
			callbackUrl={firstParam(params.callbackUrl)}
			email={firstParam(params.email)}
		/>
	)
}
```

`app/init/page.tsx` still passes no `title` to `AuthCard`, so nothing else changes until Task 10.

- [ ] **Step 6: Run the unit tests**

Run: `pnpm exec vitest run __tests__/search-params.test.ts __tests__/login-page.test.ts __tests__/root-page.test.ts __tests__/auth-page-layouts.test.ts`
Expected: PASS.

- [ ] **Step 7: e2e**

`e2e/auth.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { e2eEnv } from './fixtures/env'

test('/ sends a signed-in visitor straight to /apps', async ({ page }) => {
	await page.goto('/')
	await expect(page).toHaveURL(/\/apps$/)
})

test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('a wrong password shows the login error and stays on the page', async ({ page }) => {
		await page.goto('/login')
		await page.getByLabel('Email').fill(e2eEnv.E2E_ADMIN_EMAIL)
		await page.getByLabel('Password').fill('not-the-password')
		await page.getByRole('button', { name: 'Log in' }).click()
		await expect(page.getByText('Login failed. Check your email and password.')).toBeVisible()
		await expect(page).toHaveURL(/\/login/)
	})

	test('signing in honours the callbackUrl the proxy added', async ({ page }) => {
		await page.goto('/user-management')
		await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fuser-management$/)
		await page.getByLabel('Email').fill(e2eEnv.E2E_ADMIN_EMAIL)
		await page.getByLabel('Password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
		await page.getByRole('button', { name: 'Log in' }).click()
		await expect(page).toHaveURL(/\/user-management$/)
	})

	test('the login page shows the brand header and a forgot-password link', async ({ page }) => {
		await page.goto('/login')
		await expect(page.getByRole('heading', { name: 'Dify App Hub' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
			'href',
			'/forgot-password',
		)
	})
})
```

Run: `pnpm exec playwright test e2e/auth.spec.ts e2e/smoke.spec.ts e2e/ssr-first-paint.spec.ts`
Expected: PASS (the setup project still signs in through the placeholders).

- [ ] **Step 8: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint lib/search-params.ts components/shell components/auth "app/(auth)" app/page.tsx e2e/auth.spec.ts __tests__ && pnpm exec oxfmt --write lib/search-params.ts components/shell/auth-card.tsx components/auth "app/(auth)" app/page.tsx e2e/auth.spec.ts __tests__/search-params.test.ts __tests__/login-page.test.ts __tests__/root-page.test.ts && pnpm test
git add lib/search-params.ts components/shell/auth-card.tsx components/shell/auth-card.module.css components/auth "app/(auth)/error.tsx" "app/(auth)/login/page.tsx" app/page.tsx e2e/auth.spec.ts __tests__/search-params.test.ts __tests__/login-page.test.ts __tests__/root-page.test.ts
git commit -m "feat(auth): branded auth frame, server-rendered login page and a server redirect for /

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Forgot password and reset password

Spec §3.6, §7.3, §7.4.

**Files:**
- Create: `components/auth/auth-failure.ts`, `components/auth/forgot-password-form.tsx`, `components/auth/reset-password-form.tsx`
- Replace: `app/(auth)/forgot-password/page.tsx`, `app/(auth)/reset-password/page.tsx`
- Modify: `locales/{en,zh,ar}/translation.json`, `e2e/auth.spec.ts`
- Test: `__tests__/auth-failure.test.ts`, `__tests__/forgot-password-page.test.ts`, `__tests__/reset-password-page.test.ts`

**Interfaces:**
- Consumes: `firstParam`, `SearchParams` (Task 8); `isMailConfigured` (`lib/mail.ts`); `withDb` (Task 1); `hashPasswordResetToken` (`lib/password-reset.ts`).
- Produces: `resetFailureKey(status: number)`; default exports `ForgotPasswordForm({ mailConfigured: boolean })`, `ResetPasswordForm({ token?: string })`; keys `auth.reset_link_expired`, `auth.request_new_link`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/auth-failure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resetFailureKey } from '@/components/auth/auth-failure'

// /api/auth/reset-password answers 400 for a bad, used or expired token (the form already checks length and match).
describe('resetFailureKey', () => {
	it('maps 400 to the expired-link text and anything else to retry', () => {
		expect(resetFailureKey(400)).toBe('auth.reset_link_expired')
		expect(resetFailureKey(500)).toBe('auth.reset_failed_retry')
		expect(resetFailureKey(0)).toBe('auth.reset_failed_retry')
	})
})
```

`__tests__/forgot-password-page.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const { isMailConfigured, ForgotPasswordForm } = vi.hoisted(() => ({
	isMailConfigured: vi.fn(),
	ForgotPasswordForm: () => null,
}))
vi.mock('@/lib/mail', () => ({ isMailConfigured }))
vi.mock('@/components/auth/forgot-password-form', () => ({ default: ForgotPasswordForm }))

import ForgotPasswordPage from '@/app/(auth)/forgot-password/page'

describe('/forgot-password page', () => {
	it('tells the form on the server whether mail is configured, so the first HTML is final', async () => {
		isMailConfigured.mockReturnValue(false)
		expect(await ForgotPasswordPage()).toMatchObject({
			type: ForgotPasswordForm,
			props: { mailConfigured: false },
		})
		isMailConfigured.mockReturnValue(true)
		expect(await ForgotPasswordPage()).toMatchObject({ props: { mailConfigured: true } })
	})
})
```

`__tests__/reset-password-page.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const { ResetPasswordForm } = vi.hoisted(() => ({ ResetPasswordForm: () => null }))
vi.mock('@/components/auth/reset-password-form', () => ({ default: ResetPasswordForm }))

import ResetPasswordPage from '@/app/(auth)/reset-password/page'

describe('/reset-password page', () => {
	it('reads the token on the server', async () => {
		expect(await ResetPasswordPage({ searchParams: Promise.resolve({ token: 'abc' }) })).toMatchObject({
			type: ResetPasswordForm,
			props: { token: 'abc' },
		})
		expect(await ResetPasswordPage({ searchParams: Promise.resolve({}) })).toMatchObject({
			props: { token: undefined },
		})
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/auth-failure.test.ts __tests__/forgot-password-page.test.ts __tests__/reset-password-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Keys and the pure part**

Add to `auth` — en `"reset_link_expired": "This reset link is invalid or has expired."`, `"request_new_link": "Request a new link"`; zh `"reset_link_expired": "重置链接无效或已过期。"`, `"request_new_link": "重新获取链接"`; ar `"reset_link_expired": "رابط إعادة التعيين هذا غير صالح أو انتهت صلاحيته."`, `"request_new_link": "طلب رابط جديد"`.

`components/auth/auth-failure.ts`:

```ts
/** Spec §3.6: the auth routes answer in Chinese; the client maps the status. */
export const resetFailureKey = (status: number) =>
	status === 400 ? ('auth.reset_link_expired' as const) : ('auth.reset_failed_retry' as const)
```

- [ ] **Step 4: Run the unit test for the pure part**

Run: `pnpm exec vitest run __tests__/auth-failure.test.ts`
Expected: PASS.

- [ ] **Step 5: The forms and pages**

Check: `npx -y @ant-design/cli doc Alert` (`title`, `type`, `showIcon`), `doc Form` (`dependencies`, validator rules), `doc Result`.

`components/auth/forgot-password-form.tsx`:

```tsx
'use client'

import { Alert, App, Button, Form, Input, Typography } from 'antd'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Spec §7.3: the server page already knows whether mail is configured, so there is no form-then-warning flash. */
export default function ForgotPasswordForm({ mailConfigured }: { mailConfigured: boolean }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [loading, setLoading] = useState(false)
	const [sent, setSent] = useState(false)

	const send = async ({ email }: { email: string }) => {
		setLoading(true)
		try {
			const response = await fetch('/api/auth/forgot-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email }),
			})
			if (!response.ok) {
				message.error(t('common.request_failed_retry'))
				return
			}
			setSent(true)
		} catch {
			message.error(t('common.request_failed_retry'))
		} finally {
			setLoading(false)
		}
	}

	const backToLogin = (
		<Link href="/login">
			<Button block>{t('auth.back_to_login')}</Button>
		</Link>
	)

	if (!mailConfigured) {
		return (
			<>
				<Alert
					type="warning"
					showIcon
					title={t('auth.mail_not_configured')}
					style={{ marginBottom: 'var(--ant-margin-lg)' }}
				/>
				{backToLogin}
			</>
		)
	}
	if (sent) {
		return (
			<>
				<Typography.Paragraph>{t('auth.reset_link_sent')}</Typography.Paragraph>
				{backToLogin}
			</>
		)
	}
	return (
		<Form
			layout="vertical"
			size="large"
			onFinish={send}
		>
			<Typography.Title level={4}>{t('auth.forgot_title')}</Typography.Title>
			<Form.Item
				name="email"
				label={t('auth.email')}
				rules={[
					{ required: true, message: t('auth.email_required') },
					{ type: 'email', message: t('auth.email_invalid') },
				]}
			>
				<Input placeholder={t('auth.email_placeholder')} />
			</Form.Item>
			<Button
				type="primary"
				htmlType="submit"
				block
				loading={loading}
			>
				{t('auth.send_reset_link')}
			</Button>
		</Form>
	)
}
```

(`style={{ marginBottom: 'var(--ant-margin-lg)' }}` is a token value; a CSS Module line is equally fine — pick one and keep it token-only.)

`components/auth/reset-password-form.tsx`:

```tsx
'use client'

import { App, Button, Form, Input, Result, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { resetFailureKey } from './auth-failure'

const PASSWORD_MIN = 8

interface ResetValues {
	password: string
	confirmPassword: string
}

/** Spec §7.4: no token → the invalid-link Result; otherwise the form; 400 → "invalid or expired" with a way out. */
export default function ResetPasswordForm({ token }: { token?: string }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const [expired, setExpired] = useState(false)

	if (!token) {
		return (
			<Result
				status="error"
				title={t('auth.reset_link_invalid')}
				extra={
					<Link href="/login">
						<Button type="primary">{t('auth.back_to_login')}</Button>
					</Link>
				}
			/>
		)
	}

	const reset = async (values: ResetValues) => {
		setLoading(true)
		try {
			const response = await fetch('/api/auth/reset-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, ...values }),
			})
			if (!response.ok) {
				if (response.status === 400) setExpired(true)
				message.error(t(resetFailureKey(response.status)))
				return
			}
			message.success(t('auth.reset_success'))
			router.replace('/login')
		} catch {
			message.error(t('auth.reset_failed_retry'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<Form
			layout="vertical"
			size="large"
			onFinish={reset}
		>
			<Typography.Title level={4}>{t('auth.reset_title')}</Typography.Title>
			<Form.Item
				name="password"
				label={t('auth.new_password')}
				rules={[
					{ required: true, message: t('auth.password_required') },
					{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
			<Form.Item
				name="confirmPassword"
				label={t('auth.confirm_password')}
				dependencies={['password']}
				rules={[
					{ required: true, message: t('auth.password_required') },
					({ getFieldValue }) => ({
						validator: (_, value) =>
							value === getFieldValue('password')
								? Promise.resolve()
								: Promise.reject(new Error(t('auth.password_mismatch'))),
					}),
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
			<Button
				type="primary"
				htmlType="submit"
				block
				loading={loading}
			>
				{t('auth.reset_password')}
			</Button>
			{expired && (
				<Typography.Paragraph style={{ marginTop: 'var(--ant-margin)' }}>
					<Link href="/forgot-password">{t('auth.request_new_link')}</Link>
				</Typography.Paragraph>
			)}
		</Form>
	)
}
```

`app/(auth)/forgot-password/page.tsx` (replace):

```tsx
import ForgotPasswordForm from '@/components/auth/forgot-password-form'
import { isMailConfigured } from '@/lib/mail'

// Reads env on the server; the forgot-password layout (redirectSignedInUser) stays as it is.
export default async function ForgotPasswordPage() {
	return <ForgotPasswordForm mailConfigured={isMailConfigured()} />
}
```

`app/(auth)/reset-password/page.tsx` (replace):

```tsx
import ResetPasswordForm from '@/components/auth/reset-password-form'
import { firstParam, type SearchParams } from '@/lib/search-params'

/** Spec §7.4: the token is read on the server; the Suspense wrapper of the client page goes. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams
	return <ResetPasswordForm token={firstParam(params.token)} />
}
```

- [ ] **Step 6: Run the unit tests**

Run: `pnpm exec vitest run __tests__/forgot-password-page.test.ts __tests__/reset-password-page.test.ts __tests__/i18n-locales.test.ts`
Expected: PASS.

- [ ] **Step 7: e2e**

Append to `e2e/auth.spec.ts` (add `import { randomUUID } from 'node:crypto'`, `import { withDb } from './fixtures/db'` and `import { hashPasswordResetToken } from '../lib/password-reset'`):

```ts
test.describe('password reset', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('/forgot-password renders its final state in the first paint', async ({ page }) => {
		await page.goto('/forgot-password')
		// .env.e2e decides which: the warning when mail is off, the form when it is on. Exactly one shows.
		const warning = page.getByText('Email service is not configured. Contact your administrator.')
		const form = page.getByLabel('Email')
		await expect(warning.or(form)).toBeVisible()
		expect((await warning.count()) + (await form.count())).toBe(1)
	})

	test('/reset-password without a token shows the invalid-link result', async ({ page }) => {
		await page.goto('/reset-password')
		await expect(page.getByText('This reset link is invalid')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Back to login' })).toBeVisible()
	})

	test('a valid token sets a new password once; reusing it says the link expired', async ({
		page,
		request,
		browser,
	}, testInfo) => {
		const email = `reset-${testInfo.project.name}@e2e.local`
		const token = randomUUID().replaceAll('-', '')
		// A throwaway user through the signed-in API (admin storage state), then the token row as the route
		// would store it (lib/password-reset.ts: sha-256 hash, 15-minute expiry).
		const admin = await browser.newContext({ storageState: 'e2e/.auth/admin.json' })
		await admin.request.post('/api/users', {
			data: { name: 'Reset me', email, password: 'old-password-1' },
		})
		await admin.close()
		const userId = await withDb(async db => {
			const [rows] = await db.execute('SELECT id FROM users WHERE email = ?', [email])
			const id = (rows as { id: string }[])[0].id
			await db.execute(
				'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL 15 MINUTE), NOW(3))',
				[randomUUID(), id, hashPasswordResetToken(token)],
			)
			return id
		})
		try {
			await page.goto(`/reset-password?token=${token}`)
			await page.getByLabel('New password').fill('new-password-1')
			await page.getByLabel('Confirm password').fill('new-password-1')
			await page.getByRole('button', { name: 'Reset password' }).click()
			await expect(page).toHaveURL(/\/login$/)

			await page.getByLabel('Email').fill(email)
			await page.getByLabel('Password').fill('new-password-1')
			await page.getByRole('button', { name: 'Log in' }).click()
			await expect(page).toHaveURL(/\/apps$/)

			const reuse = await request.post('/api/auth/reset-password', {
				data: { token, password: 'another-pass-1', confirmPassword: 'another-pass-1' },
			})
			expect(reuse.status()).toBe(400)
			await page.context().clearCookies()
			await page.goto(`/reset-password?token=${token}`)
			await page.getByLabel('New password').fill('another-pass-1')
			await page.getByLabel('Confirm password').fill('another-pass-1')
			await page.getByRole('button', { name: 'Reset password' }).click()
			await expect(page.getByText('This reset link is invalid or has expired.')).toBeVisible()
			await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible()
		} finally {
			await withDb(async db => {
				await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId])
				await db.execute('DELETE FROM users WHERE id = ?', [userId])
			})
		}
	})
})
```

Run: `pnpm exec playwright test e2e/auth.spec.ts`
Expected: PASS on all projects.

- [ ] **Step 8: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint components/auth "app/(auth)" e2e/auth.spec.ts __tests__ && pnpm exec oxfmt --write components/auth "app/(auth)" e2e/auth.spec.ts __tests__/auth-failure.test.ts __tests__/forgot-password-page.test.ts __tests__/reset-password-page.test.ts locales && pnpm test
git add components/auth "app/(auth)/forgot-password/page.tsx" "app/(auth)/reset-password/page.tsx" locales e2e/auth.spec.ts __tests__/auth-failure.test.ts __tests__/forgot-password-page.test.ts __tests__/reset-password-page.test.ts
git commit -m "feat(auth): server-rendered forgot and reset password pages with status-mapped errors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `/init`

Spec §7.5.

**Files:**
- Create: `components/auth/init-form.tsx`, `app/init/error.tsx`
- Replace: `app/init/page.tsx`
- Modify: `components/auth/auth-failure.ts`, `e2e/auth.spec.ts`
- Test: `__tests__/auth-failure.test.ts`, `__tests__/init-page.test.ts`

**Interfaces:**
- Consumes: `hasUsers` (Task 7); `AuthCard` (Task 8); `RouteError` (Task 3).
- Produces: `initFailureKey(status: number)`; default export `InitForm()`.

- [ ] **Step 1: Write the failing unit tests**

Append to `__tests__/auth-failure.test.ts` (add `initFailureKey` to the import):

```ts
// /api/init answers 400 when an admin already exists (the form guarantees the fields).
describe('initFailureKey', () => {
	it('maps 400 to "already set up" and anything else to the generic failure', () => {
		expect(initFailureKey(400)).toBe('init.already_initialized')
		expect(initFailureKey(500)).toBe('init.failed')
	})
})
```

`__tests__/init-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hasUsers, redirect, redirectSignal, AuthCard, InitForm } = vi.hoisted(() => ({
	hasUsers: vi.fn(),
	redirect: vi.fn(),
	redirectSignal: new Error('NEXT_REDIRECT'),
	AuthCard: () => null,
	InitForm: () => null,
}))
vi.mock('@/lib/data/users', () => ({ hasUsers }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/components/shell/auth-card', () => ({ default: AuthCard }))
vi.mock('@/components/auth/init-form', () => ({ default: InitForm }))

import InitPage from '@/app/init/page'

describe('/init page', () => {
	beforeEach(() => {
		hasUsers.mockReset()
		redirect.mockReset()
		redirect.mockImplementation(() => {
			throw redirectSignal
		})
	})

	it('redirects to /login once an admin exists, before any form renders', async () => {
		hasUsers.mockResolvedValue(true)
		await expect(InitPage()).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/login')
	})

	it('renders the setup form inside the auth card on an empty database', async () => {
		hasUsers.mockResolvedValue(false)
		expect(await InitPage()).toMatchObject({ type: AuthCard, props: { children: { type: InitForm } } })
		expect(redirect).not.toHaveBeenCalled()
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run __tests__/auth-failure.test.ts __tests__/init-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `components/auth/auth-failure.ts`:

```ts
export const initFailureKey = (status: number) =>
	status === 400 ? ('init.already_initialized' as const) : ('init.failed' as const)
```

`components/auth/init-form.tsx`:

```tsx
'use client'

import { Alert, App, Button, Form, Input, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { initFailureKey } from './auth-failure'

const PASSWORD_MIN = 8

interface InitValues {
	name: string
	email: string
	password: string
	confirmPassword: string
}

/** Spec §7.5: first-run setup; the match check runs while typing (dependencies), not on submit. */
export default function InitForm() {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	const create = async ({ name, email, password }: InitValues) => {
		setLoading(true)
		try {
			const response = await fetch('/api/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, password }),
			})
			if (response.ok) {
				message.success(t('init.admin_created'))
				router.replace(`/login?email=${encodeURIComponent(email)}`)
				return
			}
			message.error(t(initFailureKey(response.status)))
			if (response.status === 400) router.replace('/login')
		} catch (error) {
			console.error('Init failed', error)
			message.error(t('common.network_error_retry'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<Typography.Title level={4}>{t('init.title')}</Typography.Title>
			<Typography.Paragraph>{t('init.description')}</Typography.Paragraph>
			<Alert
				type="info"
				showIcon
				title={t('init.not_initialized')}
				style={{ marginBottom: 'var(--ant-margin-lg)' }}
			/>
			<Form
				layout="vertical"
				onFinish={create}
			>
				<Form.Item
					name="name"
					label={t('init.admin_name')}
					rules={[{ required: true, message: t('init.admin_name_required') }]}
				>
					<Input placeholder={t('init.admin_name_placeholder')} />
				</Form.Item>
				<Form.Item
					name="email"
					label={t('init.admin_email')}
					rules={[
						{ required: true, message: t('init.admin_email_required') },
						{ type: 'email', message: t('init.email_invalid') },
					]}
				>
					<Input placeholder={t('init.admin_email_placeholder')} />
				</Form.Item>
				<Form.Item
					name="password"
					label={t('init.admin_password')}
					rules={[
						{ required: true, message: t('auth.password_required') },
						{ min: PASSWORD_MIN, message: t('init.password_min_8') },
					]}
				>
					<Input.Password
						autoComplete="new-password"
						placeholder={t('init.password_placeholder')}
					/>
				</Form.Item>
				<Form.Item
					name="confirmPassword"
					label={t('auth.confirm_password')}
					dependencies={['password']}
					rules={[
						{ required: true, message: t('init.confirm_password_required') },
						({ getFieldValue }) => ({
							validator: (_, value) =>
								value === getFieldValue('password')
									? Promise.resolve()
									: Promise.reject(new Error(t('auth.password_mismatch'))),
						}),
					]}
				>
					<Input.Password
						autoComplete="new-password"
						placeholder={t('init.confirm_password_placeholder')}
					/>
				</Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					block
					loading={loading}
				>
					{t('init.submit')}
				</Button>
			</Form>
		</>
	)
}
```

`app/init/page.tsx` (replace):

```tsx
import { redirect } from 'next/navigation'

import InitForm from '@/components/auth/init-form'
import AuthCard from '@/components/shell/auth-card'
import { hasUsers } from '@/lib/data/users'

export const dynamic = 'force-dynamic'

/** Spec §7.5: on an initialised instance the server redirects before any form renders (redirect() throws). */
export default async function InitPage() {
	if (await hasUsers()) redirect('/login')
	return (
		<AuthCard>
			<InitForm />
		</AuthCard>
	)
}
```

`app/init/error.tsx`:

```tsx
'use client'

import RouteError from '@/components/shell/route-error'
import AuthCard from '@/components/shell/auth-card'

export default function InitError({
	retry,
}: {
	error: Error & { digest?: string }
	retry: () => void
}) {
	return (
		<AuthCard>
			<RouteError retry={retry} />
		</AuthCard>
	)
}
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm exec vitest run __tests__/auth-failure.test.ts __tests__/init-page.test.ts`
Expected: PASS.

- [ ] **Step 5: e2e**

Append to `e2e/auth.spec.ts` inside the first `signed out` describe:

```ts
	test('/init on an initialised instance goes straight to /login', async ({ page }) => {
		// The suite's database holds the admin, so the form never shows (spec §9.6 states the form gap).
		await page.goto('/init')
		await expect(page).toHaveURL(/\/login$/)
	})
```

Run: `pnpm exec playwright test e2e/auth.spec.ts`
Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint components/auth app/init e2e/auth.spec.ts __tests__ && pnpm exec oxfmt --write components/auth app/init e2e/auth.spec.ts __tests__/auth-failure.test.ts __tests__/init-page.test.ts && pnpm test
git add components/auth app/init e2e/auth.spec.ts __tests__/auth-failure.test.ts __tests__/init-page.test.ts
git commit -m "feat(init): server-side initialised check and the setup form in the auth frame

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 11: Screenshots, unused keys, lint to zero, ADR-0020, docs, CII, full gates, PR

Spec §8, §9.2, §9.5, §11. Nothing is pushed until the owner says so.

**Files:**
- Modify: `e2e/screenshots.spec.ts`, `locales/{en,zh,ar}/translation.json`, `docs/frontend-conventions.md`, `CLAUDE.md`, `docs/decisions/README.md`, `.cii-assessment.md`
- Create: `docs/decisions/0020-load-page-data-on-the-server.md`

- [ ] **Step 1: Screenshots**

In `e2e/screenshots.spec.ts` add, next to the existing `signed out` describe, screenshots for the two auth pages:

```ts
	test('screenshot forgot-password', async ({ page }, testInfo) => {
		await page.goto('/forgot-password')
		await expect(page.locator('.ant-card')).toBeVisible()
		await capture(page, 'forgot-password', testInfo)
	})

	test('screenshot reset-password', async ({ page }, testInfo) => {
		await page.goto('/reset-password?token=screenshot')
		await expect(page.getByLabel('New password')).toBeVisible()
		await capture(page, 'reset-password', testInfo)
	})

	test('screenshot reset-password-invalid', async ({ page }, testInfo) => {
		await page.goto('/reset-password')
		await expect(page.getByText('This reset link is invalid')).toBeVisible()
		await capture(page, 'reset-password-invalid', testInfo)
	})
```

and, after the signed-in loop, the three drawers:

```ts
test('screenshot app-drawer', async ({ page }, testInfo) => {
	await page.goto('/app-management')
	await page.locator(`tr[data-row-key="${APP_ID}"]`).getByRole('button', { name: 'Edit' }).click()
	await expect(page.getByRole('dialog').getByLabel('API Base')).toHaveValue(/5399/)
	await capture(page, 'app-drawer', testInfo)
})

test('screenshot annotations-drawer', async ({ page }, testInfo) => {
	await page.goto('/app-management')
	await page
		.locator(`tr[data-row-key="${APP_IDS['advanced-chat']}"]`)
		.getByRole('button', { name: 'More actions' })
		.click()
	await page.getByRole('menuitem', { name: 'Annotations' }).click()
	await expect(page.getByRole('dialog').getByRole('table')).toBeVisible()
	await noSpinner(page)
	await capture(page, 'annotations-drawer', testInfo)
})

test('screenshot user-drawer', async ({ page }, testInfo) => {
	await page.goto('/user-management')
	await page.getByRole('button', { name: 'Add user' }).click()
	await expect(page.getByRole('dialog').getByLabel('Name')).toBeVisible()
	await capture(page, 'user-drawer', testInfo)
})
```

Run: `pnpm exec playwright test e2e/screenshots.spec.ts` → PASS; the PNGs land in `e2e/screenshots/` (git-ignored) for review in chat.

- [ ] **Step 2: Remove the keys that lost their last user**

For each candidate, confirm it has no user, then delete it from all three locale files:

```bash
for key in admin_users.password_min_6 admin_users.fetch_failed admin_users.fetch_error app.fetch_list_failed init.status_check_failed init.password_mismatch common.unauthorized; do
  printf '%s: ' "$key"; grep -rn --include=*.ts --include=*.tsx "'$key'" app components hooks lib libs services | wc -l
done
```

Every line must print `0` before the key is removed (a `1` or more means a user remains — keep that key). Then `pnpm test` (parity) and `pnpm exec tsc --noEmit` (no typed reference left). Also run `pnpm i18n:lint` and fix any hard-coded JSX text it reports in the touched files.

- [ ] **Step 3: antd lint and the grep gates**

```bash
npx -y @ant-design/cli lint ./ | tail -5
```

Expected: 0 findings. Then the grep gates over the rebuilt areas (each must print nothing):

```bash
grep -rnE "className=\"[^\"]*\b(flex|mb-|mt-|px-|py-|text-|w-full|h-full|rounded|border|bg-)" app/\(admin\) app/\(auth\) app/\(user\)/apps app/init app/page.tsx components/admin components/apps components/auth components/shell
grep -rn -- "--theme-" app/\(admin\) app/\(auth\) app/\(user\)/apps app/init components/admin components/apps components/auth components/shell
grep -rni "lucide" app components lib
grep -rnE "#[0-9a-f]{3,8}\b|rgba?\(|oklch\(" components/admin components/apps components/auth components/shell app/\(admin\) app/\(auth\) app/\(user\)/apps app/init
grep -rnE "\b(message|Modal)\.(error|success|info|warning|confirm)\(" app/\(admin\) app/\(auth\) app/\(user\)/apps app/init components/admin components/apps components/auth lib/api
grep -rn "antd/es/" app components lib
```

- [ ] **Step 4: ADR-0020**

The adr-skill scripts crash under `"type": "module"` (handoff ruling); write the file by hand in the shape of `docs/decisions/0018-gate-route-groups-on-the-server.md` (front matter `status: accepted`, `date: 2026-10-06`, `decision-makers: LovingCivilian (fork owner)`, `consulted: Claude Code session (sub-project 3)`; sections Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome with Consequences, Pros and Cons of the Options, Confirmation, More Information). Content, from the spec:

- **Title:** Load a page's first paint on the server and hand trimmed props to client components.
- **Context:** the pages in scope fetched on the client after hydration (spinner, second round trip, Chinese error text printed); charter §4.1 asks for server components by default and `loading.tsx` where a page fetches; Next's auth guide asks for checks close to the data.
- **Decision:** server `page.tsx` checks the session (`requireSessionUser()`, cached), loads from server code (`repository/app.ts`, `actions.ts`, `lib/data/*` with `server-only`, `lib/mail.ts`, `searchParams`), trims to plain props (no `requestConfig`, dates as ISO strings), renders one client component under `components/<feature>/`; writes keep their endpoints and end in `router.refresh()`; `loading.tsx`/`error.tsx` with `retry()`; `App.useApp()` for feedback; the chat keeps its client-side loading (its data is interactive by nature) — the exception stated; `/user-management` duplicates two short queries until the backend rework.
- **Options considered:** client pages as today (rebuilt); server pages everywhere (chosen); hybrid (`/apps` only).
- **Consequences:** one pattern; first HTML carries the data (e2e `ssr-first-paint` proves it); the layouts' session read means the skeleton covers the page's data only (Cache Components off); icons cost one `/site` request per card (sync-time storage noted as a follow-up); the admin list no longer carries API keys.
- **Confirmation:** the unit tests of each page (`__tests__/*-page.test.ts`), `e2e/ssr-first-paint.spec.ts`, the grep gate for `useRequest`/`fetch` in `app/**/page.tsx` (none).
- **More Information:** links to the spec, the charter, ADR-0018, Next docs paths (`loading.md`, `error.md`, `use-router.md`, `authentication.md`, `data-security.md`), react.dev two-pass rendering.

Add the README row after 0019: `| [0020](0020-load-page-data-on-the-server.md) | Load a page's first paint on the server and hand trimmed props to client components | accepted | 2026-10-06 |`.

- [ ] **Step 5: Conventions, CLAUDE.md**

`docs/frontend-conventions.md`: in "Status" add a sub-project 3 paragraph (what landed: server pages + client components per area, `components/apps|admin|auth`, `lib/data`, `lib/match-query`, `lib/search-params`, the polish, the fixed defects, the e2e specs, the stub additions, ADR-0020) and a lint re-check line (`npx -y @ant-design/cli lint ./`: N files, 0 findings, 0 errors; baseline 75 → ratchet 0). Change the sentence "Sub-projects 2–4 drive this to zero. No task may increase the total (75) or the `✗` error count (1)." to state the new ceiling: "Sub-project 3 reached zero; no task may add a finding." Replace the "Next:" bullet with sub-project 4 (removal of Tailwind, Lucide, Radix, `components/ui/`, the alias block and `lib/helpers/responsive.ts`; `e2e/theme-aliases.spec.ts` goes with the block).

`CLAUDE.md`: in "Decisions" add `- ADR-0020 Server pages load the first paint and hand trimmed props to client components (\`components/apps|admin|auth\`, \`lib/data\` server-only reads); the chat keeps its client-side loading.`; in "Where things are" add the new folders and the spec/plan paths; in "Next frontend step" replace the sub-project 3 paragraph with sub-project 4; keep the file under 200 lines (trim the sub-project 3 input sentences that are now done). Commit these with Step 4's ADR:

```bash
git add docs/decisions docs/frontend-conventions.md CLAUDE.md locales e2e/screenshots.spec.ts
git commit -m "docs(sub-project 3): ADR-0020, conventions status, CLAUDE.md pointers, screenshots and key cleanup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Full verification (never together with the Docker build)**

```bash
pnpm exec tsc --noEmit && pnpm exec oxlint . && pnpm exec oxfmt --check . && pnpm test && pnpm i18n:lint
pnpm test:e2e
```

Expected: every gate green; the e2e run reports 0 failed (record the passed/skipped counts per project in the handoff). Fix and re-run until green; fixes are their own `fix(...)` commits.

- [ ] **Step 7: CII assessment (its own commit, AGENTS.md)**

Update `.cii-assessment.md` #19's evidence (the vitest count from `pnpm test`'s summary and the new e2e specs: app CRUD, user CRUD, login/reset) and add a dated row to the change log table; nothing else changes. Commit it alone:

```bash
git add .cii-assessment.md
git commit -m "docs: update CII assessment for the sub-project 3 test suites

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: Docker gate**

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app
```

Then the curl checks from `CLAUDE.md`: `/api/health` → 200; `/apps` signed out → 307 `/login?callbackUrl=%2Fapps`; `/api/client/apps` → 401; `curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'` → 1; plus `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' localhost:5300/` → 307 to `/login?callbackUrl=%2F` and `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' localhost:5300/init` → 307 to `/login`. The owner verifies the pages in the browser.

- [ ] **Step 9: Stop and ask**

Report the numbers (unit, e2e per project, antd lint, Docker checks) and the screenshot paths, then ask the owner for the go-ahead to push `feat/admin-apps-auth-on-antd` and open the PR against `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul`), with the description following `.github/PULL_REQUEST_TEMPLATE.md` (Overview / Changes table / Testing / Related Issue), naming the spec, the plan and ADR-0020, the owner's browser checklist (icons against a real Dify, annotations on a real app, the forgot-password mail path, Arabic wording of the new keys), and ending with the attribution line the session supplies. Then write the session handoff under `docs/superpowers/handoffs/` with the user-level `handoff` skill.
