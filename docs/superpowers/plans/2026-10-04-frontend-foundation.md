# Frontend Foundation (sub-projects 0 + 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the frontend's final skeleton in place — root providers with a single `XProvider`, route groups with their own layouts, antd shells and header — plus the tooling every later sub-project relies on (official antd/X skills, a Playwright e2e harness with a stub Dify API, an antd lint baseline), while every existing page keeps working inside the new shells.

**Architecture:** `app/` becomes routing only; `components/providers/app-providers.tsx` is the one client provider stack (session → theme mode → i18n → `XProvider` → `App`); `components/shell/` holds the header, the admin/user shells and the auth card built from antd `Layout`/`Flex`/`Menu`/`Dropdown` and token-only CSS Modules; route groups `(auth)`, `(admin)`, `(user)` own their layouts; the old `--theme-*`/shadcn variables become aliases of `--ant-*` tokens declared on `.ant-app` so untouched page bodies keep their colours. Verification is a Playwright suite against `next dev` with a throwaway MySQL and a stub Dify API.

**Tech Stack:** Next.js 16 (App Router), React 19, antd 6, `@ant-design/x` 2 (+ `x-sdk`, `x-markdown`), `@ant-design/icons`, `@playwright/test`, vitest, Drizzle/MySQL, `mysql2`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-04-frontend-foundation-design.md` (its charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md`, §4 conventions are binding).

## Global Constraints

- Exactly one `XProvider` in the app, at the root; no `ConfigProvider`/`XProvider` anywhere else (charter §4.2).
- New code: antd components first; static styles in a colocated `*.module.css` using only `var(--ant-…)` values; runtime values via `theme.useToken()`; responsive logic via `Grid.useBreakpoint()`; no hex/rgb/oklch literals, no magic pixel numbers, no Tailwind classes, no `!important`, no Lucide (charter §4.3). Old page bodies keep their existing classes until sub-projects 2–3.
- Icons: `@ant-design/icons` only in new code.
- Backend untouched: nothing under `app/api/**`, `db/**`, `lib/auth*`, `proxy.ts`, `lib/access.ts`, `services/`, `lib/dify-client.ts` changes.
- URLs do not change; route groups only. `proxy.ts`/`lib/access.ts` keep gating by path.
- Before every commit: `pnpm exec tsc --noEmit`, `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --check <changed files>`, `pnpm test`; for tasks that touch UI also `pnpm test:e2e` once the harness exists (Task 3). Re-check `.cii-assessment.md` per `AGENTS.md`; commit it separately if it changes.
- e2e never touches the developer's `.env` database or a real Dify server: the suite's env comes from `.env.e2e` (test-only values), MySQL from `docker-compose.e2e.yml` (tmpfs, port 3307), Dify from `e2e/fixtures/dify-stub.ts`.
- Commits: conventional messages, one task per commit (or as the task says), trailers as the session supplies.
- Dependency versions: bump only within the current majors; record before/after in the commit body.

## Review Focus

1. A signed-out visitor opening `/app-management` must land on `/login?callbackUrl=%2Fapp-management`, not on an empty admin shell (pinned in Task 4's smoke spec).
2. Switching to dark mode must recolour the shell background and old-page text, not only antd widgets (pinned in Task 11's spec: `.ant-layout` background and a `text-theme-desc` element in the dark project).
3. At 390 px the admin navigation must still be reachable (Task 12 mobile spec: menu button → drawer → "User management").
4. Switching the language to Arabic must set `<html lang="ar">` and keep the page usable (Task 12 spec).
5. The chat page must keep its centre title, width toggle and mobile conversation menu after the header swap (Task 10 spec).
6. The production build must inline antd's styles so the first paint is not unstyled (Task 12 production check).

## File map

| Path | Responsibility |
| --- | --- |
| `.claude/skills/{x-components,use-x-chat,x-chat-provider,x-request,x-markdown,antd}/` | Official agent skills (Task 1) |
| `docs/frontend-conventions.md` | Charter §4 as the working reference + lint baseline + status (Tasks 1, 5, 12) |
| `docker-compose.e2e.yml`, `.env.e2e` | Throwaway MySQL and test-only env (Task 3) |
| `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/fixtures/{env,constants,dify-stub}.ts`, `e2e/auth.setup.ts` | Harness (Tasks 3–4) |
| `e2e/smoke.spec.ts`, `e2e/providers.spec.ts`, `e2e/chat-header.spec.ts`, `e2e/theme-aliases.spec.ts`, `e2e/shell.spec.ts`, `e2e/screenshots.spec.ts` | Flows per task |
| `components/providers/app-providers.tsx` | The single provider stack (Task 6) |
| `components/shell/{app-header,language-dropdown,theme-dropdown,account-dropdown,admin-shell,user-shell,auth-card}.tsx` + `app-header.module.css`, `shell.module.css` | Header and shells (Tasks 7–10) |
| `app/layout.tsx`, `app/(auth)/layout.tsx`, `app/(admin)/layout.tsx`, `app/(user)/layout.tsx` | Root and group layouts (Tasks 6, 8–10) |
| `app/globals.css` | Alias block replacing the hard-coded theme variables (Task 11) |

---

### Task 1: Official skills and the conventions document

**Files:**

- Create: `.claude/skills/x-components/`, `.claude/skills/use-x-chat/`, `.claude/skills/x-chat-provider/`, `.claude/skills/x-request/`, `.claude/skills/x-markdown/` (copied), `.claude/skills/antd/` (generated), `docs/frontend-conventions.md`
- Modify: `CLAUDE.md` (block appended by the antd CLI + one pointer line)

**Interfaces:**

- Produces: `docs/frontend-conventions.md` sections `## Conventions`, `## Lint baseline` (filled by Task 5), `## Status` (updated by Task 12).

- [ ] **Step 1: Copy the Ant Design X skills from the npm package** (its marketplace manifest lacks the `owner` field Claude Code requires, so the package README's manual install applies)

```bash
rm -rf /tmp/x-skill-pkg && mkdir -p /tmp/x-skill-pkg && cd /tmp/x-skill-pkg \
  && npm pack @ant-design/x-skill@2.9.0 >/dev/null && tar -xzf ant-design-x-skill-2.9.0.tgz && cd - \
  && mkdir -p .claude/skills \
  && for s in x-components use-x-chat x-chat-provider x-request x-markdown; do rm -rf ".claude/skills/$s"; cp -r "/tmp/x-skill-pkg/package/skills/$s" .claude/skills/; done \
  && ls .claude/skills
```

Expected: the five directories, each with `SKILL.md` and `reference/`.

- [ ] **Step 2: Generate the antd skill with the official CLI**

Run: `npx -y @ant-design/cli setup --client claude --mode skill`

Expected: output names `.claude/skills/antd` and `CLAUDE.md`. Then run `git status --short` — if a `.mcp.json` appeared (the CLI has written it even on dry runs), delete it: `rm -f .mcp.json`.

- [ ] **Step 3: Review the `CLAUDE.md` change**

Run: `git diff CLAUDE.md`

Expected: an appended block about the antd skill/CLI. Keep it. Add this line at the end of the "How to work here" list in `CLAUDE.md`:

```markdown
- Frontend work follows `docs/frontend-conventions.md` (charter: `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md`). Before touching a component, read the matching skill in `.claude/skills/` (`antd`, `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`).
```

- [ ] **Step 4: Write `docs/frontend-conventions.md`**

Copy charter §4 ("Conventions", all of 4.1–4.6) verbatim under `## Conventions`, then append:

```markdown
## Lint baseline

Recorded by sub-project 0 (see the plan's Task 5).

## Status

- Sub-project 0 (tooling): in progress.
- Sub-project 1 (foundation and shells): not started.
```

- [ ] **Step 5: Format and commit**

Run: `pnpm exec oxfmt --check docs/frontend-conventions.md CLAUDE.md` (fix with `pnpm exec oxfmt <file>` if needed)

```bash
git add .claude/skills docs/frontend-conventions.md CLAUDE.md
git commit -m "chore(frontend): add the official antd and Ant Design X agent skills and the conventions doc"
```

---

### Task 2: Dependencies

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Record current versions**

Run: `pnpm ls antd @ant-design/x @ant-design/x-sdk @ant-design/icons --depth 0`

Expected: antd 6.4.x, x 2.7.x, x-sdk 2.7.x, icons 5.6.x. Note them for the commit body.

- [ ] **Step 2: Bump within majors and add the new packages**

```bash
pnpm update antd @ant-design/x @ant-design/x-sdk @ant-design/icons
pnpm add @ant-design/x-markdown
pnpm add -D @playwright/test
pnpm ls antd @ant-design/x @ant-design/x-sdk @ant-design/icons @ant-design/x-markdown @playwright/test --depth 0
```

Expected: no major changes; `@ant-design/x-markdown` and `@playwright/test` listed. If `pnpm` warns that antd's peer `@ant-design/icons` range is not satisfied, run `pnpm add @ant-design/icons@latest` and record it as a ruling in the ledger.

- [ ] **Step 3: Make sure the browser build Playwright wants is present**

Run: `pnpm exec playwright install chromium`

Expected: either "already installed" or a download into `~/.cache/ms-playwright/`.

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm exec tsc --noEmit && pnpm test`

Expected: tsc exit 0; vitest 136+ tests passing.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): bump antd/x within majors, add @ant-design/x-markdown and @playwright/test"
```

Put the before/after version table in the commit body.

---

### Task 3: e2e harness — throwaway MySQL, stub Dify, Playwright config

**Files:**

- Create: `docker-compose.e2e.yml`, `.env.e2e`, `e2e/fixtures/env.ts`, `e2e/fixtures/constants.ts`, `e2e/fixtures/dify-stub.ts`, `e2e/global-setup.ts`, `playwright.config.ts`, `e2e/harness.spec.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**

- Produces: `e2eEnv`, `baseURL`, `stubPort`, `stubApiBase` from `e2e/fixtures/env.ts`; `APP_ID`, `ADMIN_STATE` from `e2e/fixtures/constants.ts`; the stub's HTTP contract below; scripts `test:e2e`, `test:e2e:report`.

- [ ] **Step 1: Throwaway database**

`docker-compose.e2e.yml`:

```yaml
# Throwaway MySQL for the Playwright suite: tmpfs storage, published on 127.0.0.1:3307 only.
# Started by e2e/global-setup.ts; stop it with: docker compose -f docker-compose.e2e.yml down
name: dify-app-hub-e2e

services:
  mysql:
    image: mysql:8.4
    container_name: dify-app-hub-e2e-mysql
    environment:
      MYSQL_DATABASE: e2e
      MYSQL_USER: e2e
      MYSQL_PASSWORD: e2e
      MYSQL_ROOT_PASSWORD: e2e
    ports:
      - '127.0.0.1:3307:3306'
    tmpfs:
      - /var/lib/mysql
    healthcheck:
      test: ['CMD-SHELL', 'mysqladmin ping -h 127.0.0.1 -u root -pe2e --silent']
      interval: 2s
      timeout: 5s
      retries: 30
      start_period: 10s
```

`.env.e2e` (committed on purpose: test-only values, never real secrets; `.dockerignore` already excludes `.env*`):

```
# Environment for the Playwright suite only. Loaded by playwright.config.ts into both web servers.
PORT=5301
NEXTAUTH_URL=http://localhost:5301
NEXTAUTH_SECRET=e2e-not-a-secret
DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e
SMTP_ENABLED=false
E2E_ADMIN_EMAIL=admin@e2e.local
E2E_ADMIN_PASSWORD=E2e-password-1
E2E_DIFY_STUB_PORT=5399
```

- [ ] **Step 2: Env and constants helpers**

`e2e/fixtures/env.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Key/value pairs of .env.e2e (comments and blank lines skipped). */
export const e2eEnv: Record<string, string> = Object.fromEntries(
	readFileSync(path.resolve(process.cwd(), '.env.e2e'), 'utf8')
		.split('\n')
		.filter(line => line.trim() && !line.trimStart().startsWith('#'))
		.map(line => {
			const i = line.indexOf('=')
			return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
		}),
)

export const baseURL = e2eEnv.NEXTAUTH_URL
export const stubPort = Number(e2eEnv.E2E_DIFY_STUB_PORT)
export const stubApiBase = `http://127.0.0.1:${stubPort}/v1`
```

`e2e/fixtures/constants.ts`:

```ts
/** Seeded app id (36 chars, fits dify_apps.id) and the signed-in storage state file. */
export const APP_ID = 'e2e00000-0000-4000-8000-000000000001'
export const ADMIN_STATE = 'e2e/.auth/admin.json'
```

- [ ] **Step 3: The stub Dify API**

`e2e/fixtures/dify-stub.ts` — a minimal Dify Service API. Shapes follow Dify's OpenAPI spec: every stream event carries `task_id`, `message_id`, `conversation_id`, `created_at`.

```ts
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const port = Number(process.env.E2E_DIFY_STUB_PORT ?? 5399)

interface StoredMessage {
	id: string
	conversation_id: string
	query: string
	answer: string
	created_at: number
	feedback: { rating: 'like' | 'dislike' } | null
}
const messages: StoredMessage[] = []
const conversations = new Map<string, { id: string; name: string; created_at: number }>()

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage) =>
	new Promise<string>(resolve => {
		let data = ''
		req.on('data', chunk => (data += chunk))
		req.on('end', () => resolve(data))
	})

const sse = (res: ServerResponse, events: Record<string, unknown>[]) => {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive',
	})
	let i = 0
	const tick = () => {
		if (i === events.length) return res.end()
		res.write(`data: ${JSON.stringify(events[i++])}\n\n`)
		setTimeout(tick, 20)
	}
	tick()
}

const parameters = {
	opening_statement: 'Hello from the stub',
	suggested_questions: ['What can you do?'],
	suggested_questions_after_answer: { enabled: false },
	speech_to_text: { enabled: false },
	text_to_speech: { enabled: false },
	retriever_resource: { enabled: false },
	annotation_reply: { enabled: false },
	user_input_form: [],
	file_upload: { enabled: false, image: { enabled: false } },
	system_parameters: {
		file_size_limit: 15,
		image_file_size_limit: 10,
		audio_file_size_limit: 50,
		video_file_size_limit: 100,
	},
}

createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
	const p = url.pathname.replace(/^\/v1/, '')
	const m = req.method

	if (m === 'GET' && p === '/parameters') return json(res, 200, parameters)
	if (m === 'GET' && p === '/meta') return json(res, 200, { tool_icons: {} })
	if (m === 'GET' && p === '/info')
		return json(res, 200, {
			name: 'Stub app',
			description: 'e2e',
			tags: [],
			mode: 'chat',
			author_name: 'e2e',
		})
	if (m === 'GET' && p === '/site')
		return json(res, 200, {
			title: 'Stub app',
			icon_type: 'emoji',
			icon: '🤖',
			icon_background: '#FFEAD5',
			description: 'e2e',
			default_language: 'en-US',
			chat_color_theme: '',
			show_workflow_steps: false,
			use_icon_as_answer_icon: false,
		})
	if (m === 'GET' && p === '/conversations')
		return json(res, 200, {
			data: [...conversations.values()].map(c => ({
				...c,
				inputs: {},
				status: 'normal',
				introduction: '',
				updated_at: c.created_at,
			})),
			has_more: false,
			limit: 20,
		})
	if (m === 'GET' && p === '/messages') {
		const cid = url.searchParams.get('conversation_id')
		const data = messages
			.filter(x => x.conversation_id === cid)
			.map(x => ({
				...x,
				inputs: {},
				message_files: [],
				agent_thoughts: [],
				retriever_resources: [],
				status: 'normal',
				error: null,
			}))
		return json(res, 200, { data, has_more: false, limit: 20 })
	}
	if (m === 'GET' && /^\/messages\/[^/]+\/suggested$/.test(p))
		return json(res, 200, { result: 'success', data: [] })
	if (m === 'POST' && /^\/messages\/[^/]+\/feedbacks$/.test(p)) {
		const id = p.split('/')[2]
		const body = JSON.parse((await readBody(req)) || '{}')
		const msg = messages.find(x => x.id === id)
		if (!msg)
			return json(res, 404, {
				code: 'message_not_exists',
				message: 'Message Not Exists.',
				status: 404,
			})
		msg.feedback = body.rating ? { rating: body.rating } : null
		return json(res, 200, { result: 'success' })
	}
	if (m === 'POST' && /^\/conversation\/[^/]+\/name$/.test(p)) {
		const c = conversations.get(p.split('/')[2])
		const body = JSON.parse((await readBody(req)) || '{}')
		if (c && body.name) c.name = body.name
		return json(res, 200, c ?? {})
	}
	if (m === 'DELETE' && /^\/conversation\/[^/]+$/.test(p)) {
		conversations.delete(p.split('/')[2])
		return json(res, 200, { result: 'success' })
	}
	if (m === 'POST' && /^\/chat-messages\/[^/]+\/stop$/.test(p))
		return json(res, 200, { result: 'success' })
	if (m === 'POST' && p === '/chat-messages') {
		const body = JSON.parse((await readBody(req)) || '{}')
		if (!body.user)
			return json(res, 400, { code: 'invalid_param', message: 'user is required', status: 400 })
		const conversation_id: string = body.conversation_id || randomUUID()
		if (!conversations.has(conversation_id))
			conversations.set(conversation_id, {
				id: conversation_id,
				name: String(body.query).slice(0, 20),
				created_at: Math.floor(Date.now() / 1000),
			})
		const message_id = randomUUID()
		const base = {
			task_id: randomUUID(),
			message_id,
			conversation_id,
			created_at: Math.floor(Date.now() / 1000),
		}
		const answer = `Echo: ${body.query}`
		messages.push({
			id: message_id,
			conversation_id,
			query: body.query,
			answer,
			created_at: base.created_at,
			feedback: null,
		})
		return sse(res, [
			{ event: 'message', answer: 'Echo: ', ...base },
			{ event: 'message', answer: String(body.query), ...base },
			{
				event: 'message_end',
				id: message_id,
				metadata: { usage: { total_tokens: 3, latency: 0.1 }, retriever_resources: [] },
				...base,
			},
		])
	}
	json(res, 404, { code: 'not_found', message: `stub has no route for ${m} ${p}`, status: 404 })
}).listen(port, '127.0.0.1', () =>
	console.log(`dify stub listening on http://127.0.0.1:${port}/v1`),
)
```

- [ ] **Step 4: Global setup and Playwright config** (per Next's bundled `02-guides/testing/playwright.md`: `webServer` starts the app; two servers are allowed)

`e2e/global-setup.ts`:

```ts
import { execSync } from 'node:child_process'

import { e2eEnv } from './fixtures/env'

/** Fresh tmpfs MySQL + migrations. Admin and app seeding happen in e2e/auth.setup.ts (they need the app server). */
export default async function globalSetup() {
	execSync('docker compose -f docker-compose.e2e.yml up -d --wait', { stdio: 'inherit' })
	execSync('pnpm exec drizzle-kit migrate', {
		stdio: 'inherit',
		env: { ...process.env, DATABASE_URL: e2eEnv.DATABASE_URL },
	})
}
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

import { ADMIN_STATE } from './e2e/fixtures/constants'
import { baseURL, e2eEnv, stubPort } from './e2e/fixtures/env'

const signedIn = { storageState: ADMIN_STATE }

export default defineConfig({
	testDir: './e2e',
	globalSetup: './e2e/global-setup.ts',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
	use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	webServer: [
		{
			command: 'pnpm exec tsx e2e/fixtures/dify-stub.ts',
			url: `http://127.0.0.1:${stubPort}/v1/parameters`,
			reuseExistingServer: true,
			env: e2eEnv,
		},
		{
			command: 'pnpm exec next dev -p 5301',
			url: `${baseURL}/api/health`,
			reuseExistingServer: true,
			timeout: 120_000,
			env: e2eEnv,
		},
	],
	projects: [
		{ name: 'setup', testMatch: /.*\.setup\.ts/ },
		{
			name: 'desktop-light',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
				colorScheme: 'light',
				...signedIn,
			},
			dependencies: ['setup'],
		},
		{
			name: 'desktop-dark',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
				colorScheme: 'dark',
				...signedIn,
			},
			dependencies: ['setup'],
		},
		{
			name: 'mobile-light',
			use: { ...devices['Pixel 7'], colorScheme: 'light', ...signedIn },
			dependencies: ['setup'],
		},
	],
})
```

Why `env: e2eEnv` matters: Next's documented load order puts `process.env` above every `.env*` file, so the suite's `DATABASE_URL`/`NEXTAUTH_*` win over the developer's `.env` and `.env.development.local`.

- [ ] **Step 5: Scripts and ignores**

In `package.json` scripts add:

```json
"test:e2e": "playwright test",
"test:e2e:report": "playwright show-report e2e/report"
```

Append to `.gitignore`:

```
# playwright
e2e/.auth/
e2e/report/
e2e/screenshots/
test-results/
```

- [ ] **Step 6: A minimal setup project** (Task 4 replaces it with the real sign-in; it exists so the signed-in projects can load their storage state)

`e2e/auth.setup.ts`:

```ts
import { test as setup } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'

setup(
	'placeholder storage state until Task 4 seeds the database and signs in',
	async ({ page }) => {
		await page.goto('/login')
		await page.context().storageState({ path: ADMIN_STATE })
	},
)
```

- [ ] **Step 7: Write the harness test**

`e2e/harness.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { stubApiBase } from './fixtures/env'

test('the stub Dify API and the app under test answer', async ({ request }) => {
	const stub = await request.get(`${stubApiBase}/parameters`)
	expect(stub.ok()).toBe(true)
	expect(await stub.json()).toMatchObject({ opening_statement: 'Hello from the stub' })

	const health = await request.get('/api/health')
	expect(health.status()).toBe(200)
})
```

- [ ] **Step 8: Run it**

Run: `pnpm test:e2e --project=desktop-light e2e/harness.spec.ts`

Expected: the compose MySQL starts and reports healthy, migrations run, the stub and `next dev` start (Playwright prints both `webServer` URLs as reachable), `setup` passes, 1 test passed. Anything else is a harness defect to fix in this task — that is its purpose.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.e2e.yml .env.e2e e2e playwright.config.ts package.json .gitignore
git commit -m "test(e2e): Playwright harness with a throwaway MySQL and a stub Dify API"
```

---

### Task 4: e2e setup project and smoke flows

**Files:**

- Modify: `e2e/auth.setup.ts` (replace the placeholder), `e2e/harness.spec.ts` (remove the `test.use` line)
- Create: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `APP_ID`, `ADMIN_STATE` (`e2e/fixtures/constants.ts`); `e2eEnv`, `stubApiBase` (`e2e/fixtures/env.ts`).
- Produces: a signed-in storage state at `ADMIN_STATE`; the seeded app at `/chat/${APP_ID}`.

- [ ] **Step 1: Write the smoke spec first**

`e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

test('a signed-out visitor is sent to the login page with a callback', async ({ browser }) => {
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
	const page = await context.newPage()
	await page.goto('/app-management')
	await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fapp-management$/)
	await context.close()
})

test('the app list shows the seeded app and its chat answers from the stub', async ({ page }) => {
	await page.goto('/apps')
	await page.getByText('Stub app').first().click()
	await expect(page).toHaveURL(new RegExp(`/chat/${APP_ID}`))
	await page.getByRole('textbox').first().fill('hello')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Echo: hello')).toBeVisible()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e --project=desktop-light e2e/smoke.spec.ts`

Expected: FAIL — no storage state / no seeded app (placeholder setup).

- [ ] **Step 3: Replace the placeholder setup**

`e2e/auth.setup.ts`:

```ts
import { expect, test as setup } from '@playwright/test'
import mysql from 'mysql2/promise'

import { ADMIN_STATE, APP_ID } from './fixtures/constants'
import { e2eEnv, stubApiBase } from './fixtures/env'

setup('initialise the admin, seed the stub app, sign in', async ({ page, request }) => {
	// POST /api/init creates the first admin; 400 means the database already has one (server reused).
	const init = await request.post('/api/init', {
		data: { name: 'E2E Admin', email: e2eEnv.E2E_ADMIN_EMAIL, password: e2eEnv.E2E_ADMIN_PASSWORD },
	})
	expect([200, 201, 400]).toContain(init.status())

	const db = await mysql.createConnection(e2eEnv.DATABASE_URL)
	await db.execute(
		'INSERT IGNORE INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[APP_ID, 'Stub app', 'chat', 'Seeded for the e2e suite', stubApiBase, 'app-e2e', 'default'],
	)
	await db.end()

	await page.goto('/login')
	await page.getByLabel('Email').fill(e2eEnv.E2E_ADMIN_EMAIL)
	await page.getByLabel('Password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page).toHaveURL(/\/apps$/)
	await page.context().storageState({ path: ADMIN_STATE })
})
```

The login form's labels are `t('auth.email')` = "Email", `t('auth.password')` = "Password" and the submit button `t('auth.login')` = "Log in" (`locales/en/translation.json`). The browser's language is English in Playwright's default context, so the English strings apply. If a label is not associated with its input (`getByLabel` fails), use `page.locator('#email')`/`#password` — antd `Form.Item name` sets those ids — and record the ruling.

Remove the `test.use({ storageState … })` line from `e2e/harness.spec.ts` (it now runs signed in like everything else; the stub check does not care).

- [ ] **Step 4: Run the suite**

Run: `pnpm test:e2e`

Expected: `setup` passes, then `harness` and `smoke` pass in all three projects (6 tests + 1 setup). The chat page already works, so "Echo: hello" appears. If the mobile project cannot click the app card (card hidden under the header), note the ruling and use `page.goto(`/chat/${APP_ID}`)` in the mobile case only.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(e2e): seed an admin and a stub app, sign in once, smoke the login gate and a chat reply"
```

---

### Task 5: antd lint baseline

**Files:**

- Modify: `docs/frontend-conventions.md` (`## Lint baseline`)

- [ ] **Step 1: Run the official lint**

Run: `npx -y @ant-design/cli lint ./ 2>&1 | tee /tmp/antd-lint.txt | tail -40`

Expected: a findings list with a summary (counts by severity/rule).

- [ ] **Step 2: Record the baseline**

Replace the `## Lint baseline` section body with: the date, the command, the summary counts, and the top five rules by count (copy the lines from `/tmp/antd-lint.txt`). State: "Sub-projects 2–4 drive this to zero; no task may increase the error count."

- [ ] **Step 3: Commit**

```bash
git add docs/frontend-conventions.md
git commit -m "docs(frontend): record the antd lint baseline"
```

---

### Task 6: One provider stack at the root

**Files:**

- Create: `components/providers/app-providers.tsx`, `e2e/providers.spec.ts`
- Modify: `app/layout.tsx`, `components/layout/page-layout-wrapper.tsx`, `app/(user)/layout.tsx`, `components/chat/main-layout.tsx`
- Delete: `components/auth/session-provider.tsx`

**Interfaces:**

- Consumes: `ThemeContextProvider`, `useThemeContext` (`lib/theme`), `getAntdLocale` (`libs/antd-locale.ts`), `useHtmlLang` (`hooks/use-html-lang.ts`), `initResponsiveConfig` (`lib/helpers`).
- Produces: `AppProviders({ children })` default export — the only place `XProvider`/`App` are rendered.

- [ ] **Step 1: Write the failing e2e spec**

`e2e/providers.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

// antd 6 publishes its tokens as --ant-* variables on the class it puts on <App>'s root (measured 2026-10-04:
// light color-bg-layout #f5f5f5, dark #000000). One App root means one provider stack.
test('exactly one antd App root exists and its tokens follow the colour scheme', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	const roots = page.locator('.ant-app')
	await expect(roots).toHaveCount(1)
	const bgLayout = await roots
		.first()
		.evaluate(el => getComputedStyle(el).getPropertyValue('--ant-color-bg-layout').trim())
	expect(bgLayout).toBe(testInfo.project.use.colorScheme === 'dark' ? '#000000' : '#f5f5f5')
})

test('no page nests a second XProvider or ConfigProvider', async ({ page }) => {
	await page.goto('/app-management')
	// Every ConfigProvider/XProvider instance registers its own CSS-variable class; one stack = one class name.
	const classes = await page
		.locator('[class*="css-var-"]')
		.evaluateAll(
			els =>
				new Set(els.flatMap(el => [...el.classList].filter(c => c.startsWith('css-var-')))).size,
		)
	expect(classes).toBe(1)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e --project=desktop-light --project=desktop-dark e2e/providers.spec.ts`

Expected: FAIL — today two `ConfigProvider`s plus the chat `XProvider` exist, so the class count is > 1 (and `/apps` has its own `.ant-app`).

- [ ] **Step 3: Create the provider stack**

`components/providers/app-providers.tsx`:

```tsx
'use client'

import { XProvider } from '@ant-design/x'
import { App, theme } from 'antd'
import { SessionProvider } from 'next-auth/react'
import { useTranslation } from 'react-i18next'

import { useHtmlLang } from '@/hooks/use-html-lang'
import { initResponsiveConfig } from '@/lib/helpers'
import { ThemeContextProvider, useThemeContext } from '@/lib/theme'
import { getAntdLocale } from '@/libs/antd-locale'

import '@/libs/i18n'

initResponsiveConfig()

/**
 * antd / Ant Design X configuration for the whole app: the only XProvider (it supersedes ConfigProvider)
 * and the App context that backs App.useApp(). Theme algorithm from the theme-mode switch, locale from i18next.
 */
function AntdProviders({ children }: { children: React.ReactNode }) {
	const { isDark } = useThemeContext()
	const { i18n } = useTranslation()
	useHtmlLang()

	return (
		<XProvider
			locale={getAntdLocale(i18n.resolvedLanguage)}
			theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}
		>
			<App>{children}</App>
		</XProvider>
	)
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
	return (
		<SessionProvider>
			<ThemeContextProvider>
				<AntdProviders>{children}</AntdProviders>
			</ThemeContextProvider>
		</SessionProvider>
	)
}
```

- [ ] **Step 4: Use it from the root layout (keep the page wrapper for now; Task 8 removes it)**

`app/layout.tsx`:

```tsx
import { AntdRegistry } from '@ant-design/nextjs-registry'
import type { Metadata } from 'next'

import PageLayoutWrapper from '@/components/layout/page-layout-wrapper'
import AppProviders from '@/components/providers/app-providers'

import './globals.css'

export const metadata: Metadata = {
	title: 'Dify App Hub',
	description: 'A Dify web app that fits your business',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
		>
			<body className="antialiased">
				<AntdRegistry>
					<AppProviders>
						<PageLayoutWrapper>{children}</PageLayoutWrapper>
					</AppProviders>
				</AntdRegistry>
			</body>
		</html>
	)
}
```

Delete `components/auth/session-provider.tsx` (its only consumer was the root layout).

- [ ] **Step 5: Strip the nested providers**

`components/layout/page-layout-wrapper.tsx` becomes a pure router between the admin layout and plain children:

```tsx
'use client'

import { usePathname } from 'next/navigation'
import React from 'react'

import AuthGuard from '../auth/auth-guard'
import AdminPageLayout from './admin-page-layout'

/** Temporary (until the route groups land): admin pages get the admin layout, everything else renders as is. */
export default function PageLayoutWrapper({ children }: { children: React.ReactNode }) {
	const pathname = usePathname()
	const isPublicPage =
		pathname === '/login' ||
		pathname === '/forgot-password' ||
		pathname === '/reset-password' ||
		pathname?.startsWith('/init') ||
		pathname?.startsWith('/chat') ||
		pathname?.startsWith('/apps') ||
		pathname?.startsWith('/auth')

	return isPublicPage ? (
		children
	) : (
		<AuthGuard>
			<AdminPageLayout>{children}</AdminPageLayout>
		</AuthGuard>
	)
}
```

`app/(user)/layout.tsx` keeps only the gate (the `ConfigProvider`/`App`/`ThemeContextProvider`/i18n import go):

```tsx
'use client'

import { Spin } from 'antd'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuth } from '@/hooks/use-auth'

export default function UserLayout({ children }: { children: React.ReactNode }) {
	const { isAuthorized, isLoading } = useAuth()
	const router = useRouter()

	useEffect(() => {
		if (!isLoading && !isAuthorized) {
			router.replace('/login')
		}
	}, [isAuthorized, isLoading, router])

	if (isLoading || !isAuthorized) {
		return <Spin fullscreen />
	}
	return children
}
```

`components/chat/main-layout.tsx`: remove the `XProvider` import and wrapper (render the chosen layout directly) and the `colors` import if it becomes unused.

- [ ] **Step 6: Run the e2e spec and the suite**

Run: `pnpm test:e2e --project=desktop-light --project=desktop-dark e2e/providers.spec.ts && pnpm test:e2e`

Expected: PASS; smoke still green.

- [ ] **Step 7: Checks and commit**

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components app && pnpm test`

```bash
git add app/layout.tsx components/providers/app-providers.tsx components/layout/page-layout-wrapper.tsx "app/(user)/layout.tsx" components/chat/main-layout.tsx e2e/providers.spec.ts
git rm components/auth/session-provider.tsx
git commit -m "refactor(providers): one XProvider/App stack at the root; nested ConfigProviders removed"
```

---

### Task 7: Header dropdowns and the AppHeader

**Files:**

- Create: `components/shell/language-dropdown.tsx`, `components/shell/theme-dropdown.tsx`, `components/shell/account-dropdown.tsx`, `components/shell/app-header.tsx`, `components/shell/app-header.module.css`
- Modify: `__tests__/account-menu.test.ts` (import path only)

**Interfaces:**

- Produces: `AppHeader(props: AppHeaderProps)` with `AppHeaderProps = { nav?: MenuProps['items']; navSelectedKey?: string; title?: ReactNode; extra?: ReactNode; mobileMenu?: ReactNode }`; `getAccountMenuItems({ email, t, onLogout })` and `useLogout()` from `components/shell/account-dropdown.tsx` (same signatures as today's `components/auth/account-menu.tsx`).

- [ ] **Step 1: Move the account menu logic test-first**

Change the import in `__tests__/account-menu.test.ts` from `@/components/auth/account-menu` to `@/components/shell/account-dropdown`. Run `pnpm test __tests__/account-menu.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Create the three dropdowns**

`components/shell/account-dropdown.tsx` — copy `getAccountMenuItems` and `useLogout` from `components/auth/account-menu.tsx` unchanged, and replace the default component with:

```tsx
export default function AccountDropdown() {
	const { data: session } = useSession()
	const { t } = useTranslation()
	const logout = useLogout()
	const email = session?.user?.email
	if (!email) return null
	return (
		<Dropdown
			menu={{ items: getAccountMenuItems({ email, t, onLogout: logout }) }}
			placement="bottomRight"
		>
			<Button
				type="text"
				icon={<UserOutlined />}
				aria-label={t('auth.signed_in_as', { email })}
			/>
		</Dropdown>
	)
}
```

(imports: `UserOutlined` from `@ant-design/icons`, `Button`, `Dropdown` from `antd`; keep the existing `LogoutOutlined` in the items.)

`components/shell/language-dropdown.tsx`:

```tsx
'use client'

import { GlobalOutlined } from '@ant-design/icons'
import { Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'

const languages = { en: 'English', zh: '中文', ar: 'العربية' } as const

export default function LanguageDropdown() {
	const { t, i18n } = useTranslation()
	return (
		<Dropdown
			placement="bottomRight"
			menu={{
				selectedKeys: i18n.resolvedLanguage ? [i18n.resolvedLanguage] : [],
				items: Object.entries(languages).map(([key, label]) => ({ key, label })),
				onClick: ({ key }) => void i18n.changeLanguage(key),
			}}
		>
			<Button
				type="text"
				icon={<GlobalOutlined />}
				aria-label={t('system.language')}
				title={t('system.language')}
			/>
		</Dropdown>
	)
}
```

`components/shell/theme-dropdown.tsx`:

```tsx
'use client'

import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'

import { ThemeModeEnum, ThemeModeLabelEnum, useThemeContext } from '@/lib/theme'

const icons = {
	[ThemeModeEnum.SYSTEM]: <DesktopOutlined />,
	[ThemeModeEnum.LIGHT]: <SunOutlined />,
	[ThemeModeEnum.DARK]: <MoonOutlined />,
}

export default function ThemeDropdown() {
	const { t } = useTranslation()
	const { themeMode, setThemeMode } = useThemeContext()
	return (
		<Dropdown
			placement="bottomRight"
			menu={{
				selectedKeys: [themeMode],
				items: [
					{
						key: ThemeModeEnum.SYSTEM,
						icon: icons[ThemeModeEnum.SYSTEM],
						label: t(ThemeModeLabelEnum.SYSTEM),
					},
					{
						key: ThemeModeEnum.LIGHT,
						icon: icons[ThemeModeEnum.LIGHT],
						label: t(ThemeModeLabelEnum.LIGHT),
					},
					{
						key: ThemeModeEnum.DARK,
						icon: icons[ThemeModeEnum.DARK],
						label: t(ThemeModeLabelEnum.DARK),
					},
				],
				onClick: ({ key }) => setThemeMode(key as ThemeModeEnum),
			}}
		>
			<Button
				type="text"
				icon={icons[themeMode]}
				aria-label={t('system.theme_mode_system')}
			/>
		</Dropdown>
	)
}
```

Run `pnpm test __tests__/account-menu.test.ts` — Expected: PASS.

- [ ] **Step 3: The header**

`components/shell/app-header.module.css`:

```css
/* Layout.Header already sizes and colours itself from tokens; this only arranges the three regions. */
.header {
	display: flex;
	align-items: center;
	line-height: normal;
}
.side {
	flex: 1;
	min-width: 0;
}
.center {
	flex: 2;
	min-width: 0;
	display: flex;
	align-items: center;
	justify-content: center;
}
.logo {
	display: inline-flex;
	align-items: center;
	gap: var(--ant-margin-xs);
	color: inherit;
}
.title {
	white-space: nowrap;
}
.nav {
	flex: 1;
	min-width: 0;
	border-bottom: 0;
	background: transparent;
}
/* screenMDMin is 768 (antd screen tokens); below it the title text makes way for the controls */
@media (max-width: 767px) {
	.title {
		display: none;
	}
}
```

`components/shell/app-header.tsx`:

```tsx
'use client'

import { GithubOutlined, MenuOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { Button, Drawer, Flex, Grid, Layout, Menu, Space, Typography, theme } from 'antd'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import LogoIcon from '@/assets/images/logo.png'

import AccountDropdown from './account-dropdown'
import styles from './app-header.module.css'
import LanguageDropdown from './language-dropdown'
import ThemeDropdown from './theme-dropdown'

export interface AppHeaderProps {
	/** Area navigation (admin). A horizontal Menu on desktop, inside a Drawer on mobile. */
	nav?: MenuProps['items']
	navSelectedKey?: string
	/** Centre content (chat: the app title). */
	title?: React.ReactNode
	/** Controls placed before the standard dropdowns (chat: the width toggle). */
	extra?: React.ReactNode
	/** Mobile-only trigger that replaces the standard dropdowns (chat: the conversation menu). */
	mobileMenu?: React.ReactNode
}

const GITHUB_URL = 'https://github.com/lexmin0412/dify-app-hub'

export default function AppHeader({
	nav,
	navSelectedKey,
	title,
	extra,
	mobileMenu,
}: AppHeaderProps) {
	const { token } = theme.useToken()
	const screens = Grid.useBreakpoint()
	const isMobile = !screens.md
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
			/>
			<AccountDropdown />
		</Space>
	)

	return (
		<Layout.Header
			className={styles.header}
			style={{
				background: token.colorBgContainer,
				borderBottom: `1px solid ${token.colorBorderSecondary}`,
				paddingInline: token.paddingLG,
			}}
		>
			<Flex
				align="center"
				gap={token.marginSM}
				className={styles.side}
			>
				{isMobile && nav && (
					<Button
						type="text"
						icon={<MenuOutlined />}
						aria-label="Menu"
						onClick={() => setNavOpen(true)}
					/>
				)}
				<Link
					href="/apps"
					className={styles.logo}
				>
					<Image
						src={LogoIcon}
						width={28}
						height={28}
						alt=""
					/>
					<Typography.Text
						strong
						className={styles.title}
					>
						Dify App Hub
					</Typography.Text>
				</Link>
				{!isMobile && nav && (
					<Menu
						mode="horizontal"
						items={nav}
						selectedKeys={selectedKeys}
						className={styles.nav}
					/>
				)}
			</Flex>
			<div className={styles.center}>{title}</div>
			<Flex
				align="center"
				justify="flex-end"
				gap={token.marginSM}
				className={styles.side}
			>
				{extra}
				{isMobile && mobileMenu ? mobileMenu : dropdowns}
			</Flex>
			{nav && (
				<Drawer
					open={navOpen}
					onClose={() => setNavOpen(false)}
					placement="left"
				>
					<Menu
						mode="inline"
						items={nav}
						selectedKeys={selectedKeys}
						onClick={() => setNavOpen(false)}
					/>
				</Drawer>
			)}
		</Layout.Header>
	)
}
```

`width={28}` on `Image` is an intrinsic image size, not a layout magic number; keep it.

- [ ] **Step 4: Checks and commit** (nothing renders the header yet; Tasks 8–10 mount it)

Run: `pnpm exec tsc --noEmit && pnpm exec oxlint components/shell __tests__/account-menu.test.ts && pnpm exec oxfmt --check components/shell && pnpm test`

```bash
git add components/shell __tests__/account-menu.test.ts
git commit -m "feat(shell): AppHeader with language, theme and account dropdowns built from antd"
```

---

### Task 8: Admin shell and the `(admin)` route group

**Files:**

- Create: `components/shell/admin-shell.tsx`, `components/shell/shell.module.css`, `app/(admin)/layout.tsx`
- Move: `app/app-management/` → `app/(admin)/app-management/`, `app/user-management/` → `app/(admin)/user-management/`
- Modify: `app/layout.tsx` (drop `PageLayoutWrapper`)
- Delete: `components/layout/page-layout-wrapper.tsx`, `components/layout/page-layout.tsx`, `components/layout/admin-page-layout.tsx`, `components/layout/admin-header-title.tsx`

**Interfaces:**

- Consumes: `AppHeader` (Task 7), `AuthGuard` (`components/auth/auth-guard.tsx`).
- Produces: `AdminShell({ children })`; `styles.root`/`styles.content` in `shell.module.css` reused by Task 10.

- [ ] **Step 1: Extend the smoke spec first**

Append to `e2e/smoke.spec.ts`:

```ts
test('the admin area renders inside the antd shell with its navigation', async ({ page }) => {
	await page.goto('/app-management')
	await expect(page.locator('header.ant-layout-header')).toHaveCount(1)
	const nav = page.getByRole('menu').first()
	await expect(nav.getByRole('menuitem', { name: 'User management' })).toBeVisible()
	await expect(page.locator('.ant-table')).toBeVisible()
})
```

Run: `pnpm test:e2e --project=desktop-light e2e/smoke.spec.ts` —

Expected: FAIL (no `ant-layout-header` yet; today's header is a plain div).

- [ ] **Step 2: Shell styles and the admin shell**

`components/shell/shell.module.css`:

```css
.root {
	min-height: 100vh;
}
.content {
	overflow: auto;
}
```

`components/shell/admin-shell.tsx`:

```tsx
'use client'

import { AppstoreOutlined, TeamOutlined } from '@ant-design/icons'
import { Layout, theme } from 'antd'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import AppHeader from './app-header'
import styles from './shell.module.css'

const ADMIN_NAV = [
	{ key: '/app-management', icon: <AppstoreOutlined />, label: 'admin.menu_apps' },
	{ key: '/user-management', icon: <TeamOutlined />, label: 'admin.menu_users' },
] as const

export default function AdminShell({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const pathname = usePathname()
	const { token } = theme.useToken()
	const nav = ADMIN_NAV.map(item => ({
		key: item.key,
		icon: item.icon,
		label: <Link href={item.key}>{t(item.label)}</Link>,
	}))
	const selected = ADMIN_NAV.find(item => pathname.startsWith(item.key))?.key

	return (
		<Layout
			className={styles.root}
			style={{ background: token.colorBgLayout }}
		>
			<AppHeader
				nav={nav}
				navSelectedKey={selected}
			/>
			<Layout.Content
				className={styles.content}
				style={{ padding: token.paddingLG }}
			>
				{children}
			</Layout.Content>
		</Layout>
	)
}
```

- [ ] **Step 3: Route group**

```bash
mkdir -p "app/(admin)" && git mv app/app-management "app/(admin)/app-management" && git mv app/user-management "app/(admin)/user-management"
```

`app/(admin)/layout.tsx`:

```tsx
'use client'

import AuthGuard from '@/components/auth/auth-guard'
import AdminShell from '@/components/shell/admin-shell'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	return (
		<AuthGuard>
			<AdminShell>{children}</AdminShell>
		</AuthGuard>
	)
}
```

In `app/layout.tsx` remove the `PageLayoutWrapper` import and wrapper (children go straight into `AppProviders`). Delete the four files under `components/layout/` and `components/layout/` itself if empty. Run `git grep -n "components/layout\|PageLayoutWrapper\|AdminPageLayout\|AdminHeaderTitle"` — Expected: no hits.

The admin pages' own outer wrappers (padding/background classes from Tailwind) stay as they are for now; only their shell changed.

- [ ] **Step 4: Run and commit**

Run: `pnpm test:e2e` (all projects) then `pnpm exec tsc --noEmit && pnpm exec oxlint app components && pnpm test`

Expected: smoke incl. the new admin test green in desktop projects; mobile project: the admin test's `getByRole('menu')` finds the Drawer menu only after opening — adjust the test to `test.skip(testInfo.project.name.startsWith('mobile'))` for the nav assertion (mobile nav is pinned in Task 12).

```bash
git add -A app components/shell e2e/smoke.spec.ts
git commit -m "feat(shell): admin route group with an antd Layout shell; URL-sniffing page wrapper removed"
```

---

### Task 9: Auth card and the `(auth)` route group

**Files:**

- Create: `components/shell/auth-card.tsx`, `app/(auth)/layout.tsx`
- Move: `app/login/` → `app/(auth)/login/`, `app/forgot-password/` → `app/(auth)/forgot-password/`, `app/reset-password/` → `app/(auth)/reset-password/`
- Modify: `__tests__/auth-page-layouts.test.ts` (import paths), `app/(auth)/login/page.tsx`, `app/(auth)/forgot-password/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/init/page.tsx` (outer chrome only)

**Interfaces:**

- Produces: `AuthCard({ title?, children })`.

- [ ] **Step 1: Update the unit test paths first**

In `__tests__/auth-page-layouts.test.ts` change `@/app/login/layout` → `@/app/(auth)/login/layout` and `@/app/forgot-password/layout` → `@/app/(auth)/forgot-password/layout`. Run `pnpm test __tests__/auth-page-layouts.test.ts` — Expected: FAIL (modules not found).

- [ ] **Step 2: Move the routes**

```bash
mkdir -p "app/(auth)" && git mv app/login "app/(auth)/login" && git mv app/forgot-password "app/(auth)/forgot-password" && git mv app/reset-password "app/(auth)/reset-password"
```

Run `pnpm test __tests__/auth-page-layouts.test.ts` — Expected: PASS (the per-page `layout.tsx` files with `redirectSignedInUser()` moved along; `/reset-password` still has none).

- [ ] **Step 3: The card and the group layout**

`components/shell/auth-card.tsx`:

```tsx
'use client'

import { Card, Col, Row, theme } from 'antd'

/** Centred card on the layout surface for login, password reset and first-run setup. */
export default function AuthCard({
	title,
	children,
}: {
	title?: React.ReactNode
	children: React.ReactNode
}) {
	const { token } = theme.useToken()
	return (
		<Row
			align="middle"
			justify="center"
			style={{ minHeight: '100vh', background: token.colorBgLayout, padding: token.paddingLG }}
		>
			<Col
				xs={24}
				sm={16}
				md={12}
				lg={8}
				xl={6}
			>
				<Card title={title}>{children}</Card>
			</Col>
		</Row>
	)
}
```

`app/(auth)/layout.tsx`:

```tsx
import AuthCard from '@/components/shell/auth-card'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return <AuthCard>{children}</AuthCard>
}
```

- [ ] **Step 4: Remove the pages' own chrome**

In each of the three auth pages and `app/init/page.tsx`: delete the outermost full-height centring wrapper and the card box (the `div`s carrying `min-h-screen`/`flex`/`items-center`/`justify-center` and the white/rounded/shadow card) so the page returns its heading and `Form` directly. For `app/init/page.tsx` wrap that result in `<AuthCard>` (it is not in the group). Keep every `Form`, handler and `t()` string exactly as is.

- [ ] **Step 5: Verify**

Run: `pnpm test:e2e` —

Expected: setup (login) and smoke green: the login form still submits. Open `http://localhost:5301/login`, `/forgot-password`, `/reset-password?token=x`, `/init` while the suite's server is up and confirm each shows one card. `pnpm exec tsc --noEmit && pnpm test` green.

- [ ] **Step 6: Commit**

```bash
git add -A app __tests__/auth-page-layouts.test.ts components/shell/auth-card.tsx
git commit -m "feat(shell): auth route group with a shared antd card layout"
```

---

### Task 10: User shell, `(user)` cleanup and the chat header swap

**Files:**

- Create: `components/shell/user-shell.tsx`, `e2e/chat-header.spec.ts`
- Modify: `app/(user)/apps/page.tsx`, `components/chat/chat-layout.tsx`, `components/chat/common-layout.tsx`, `components/shared/index.ts`, `docs/auth-gate.md`
- Delete: `app/(user)/auth/page.tsx`, `components/shared/header-layout.tsx`, `components/shared/center-title-wrapper.tsx`, `components/shared/logo.tsx` (if `git grep` shows no other importer), `components/chat/i18n-switcher/index.tsx`, `components/auth/account-menu.tsx`, `lib/theme/theme-selector.tsx` (+ its export in `lib/theme/index.ts`)

**Interfaces:**

- Consumes: `AppHeader`/`AppHeaderProps` (Task 7), `shell.module.css` (Task 8).
- Produces: `UserShell(props: AppHeaderProps & { children })`.

- [ ] **Step 1: Pin the chat header behaviour first**

`e2e/chat-header.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

test('the chat keeps its title, width toggle and account menu in the shell header', async ({
	page,
}, testInfo) => {
	await page.goto(`/chat/${APP_ID}`)
	const header = page.locator('header.ant-layout-header')
	await expect(header).toHaveCount(1)
	await expect(header.getByText('Stub app')).toBeVisible()
	if (testInfo.project.name.startsWith('mobile')) {
		await expect(header.getByRole('button', { name: 'Menu' })).toBeVisible()
	} else {
		await expect(header.getByRole('button', { name: /wide|narrow/i })).toBeVisible()
		await header.getByRole('button', { name: /signed in as/i }).click()
		await expect(page.getByRole('menuitem', { name: /log out/i })).toBeVisible()
	}
})
```

Run: `pnpm test:e2e e2e/chat-header.spec.ts` —

Expected: FAIL (no `ant-layout-header` on the chat page).

- [ ] **Step 2: User shell**

`components/shell/user-shell.tsx`:

```tsx
'use client'

import { Layout, theme } from 'antd'

import AppHeader, { type AppHeaderProps } from './app-header'
import styles from './shell.module.css'

/** Shell for the user area: the shared header plus a content region; pages pass header slots through. */
export default function UserShell({
	children,
	...header
}: AppHeaderProps & { children: React.ReactNode }) {
	const { token } = theme.useToken()
	return (
		<Layout
			className={styles.root}
			style={{ background: token.colorBgLayout }}
		>
			<AppHeader {...header} />
			<Layout.Content className={styles.content}>{children}</Layout.Content>
		</Layout>
	)
}
```

- [ ] **Step 3: Apps page**

In `app/(user)/apps/page.tsx`: wrap the returned tree in `<UserShell>`, delete the header row (`LucideIcon layout-grid` + `t('app.list')` + the `ml-auto` box with `I18nSwitcher`/`AccountMenu`) and render the title as `<Typography.Title level={4}>{t('app.list')}</Typography.Title>` above the grid; remove the now-unused imports.

- [ ] **Step 4: Chat layouts**

`components/chat/chat-layout.tsx`: replace the `HeaderLayout` element with `UserShell` wrapping the main area. Map the old props: `title` → `title={renderCenterTitle?.(currentApp?.config?.info)}`; the desktop `renderRightIcons` content becomes `extra={<Button type="text" icon={<ColumnWidthOutlined />} aria-label={isWideScreen ? t('chat.switch_narrow') : t('chat.switch_wide')} title={…same…} onClick={() => setIsWideScreen(!isWideScreen)} />}` (the theme/GitHub/account pieces are now the header's own); the mobile `rightIcon` `Dropdown` with `MenuOutlined` becomes `mobileMenu={…that Dropdown with aria-label="Menu" on its trigger…}`. Remove the `I18nSwitcher`, `AccountMenu`, `getAccountMenuItems`, `useLogout` imports; the mobile menu's account items now import `getAccountMenuItems`/`useLogout` from `@/components/shell/account-dropdown`. `components/chat/common-layout.tsx`: same swap with `title` only. `main-layout.tsx` already renders these without a provider.

- [ ] **Step 5: Delete what the shells replaced**

```bash
git rm "app/(user)/auth/page.tsx" components/shared/header-layout.tsx components/shared/center-title-wrapper.tsx components/chat/i18n-switcher/index.tsx components/auth/account-menu.tsx lib/theme/theme-selector.tsx
git grep -n "components/shared/logo\|GithubIcon\|LogoIcon\b" -- app components   # delete components/shared/logo.tsx too if this prints nothing
```

Update `components/shared/index.ts` (keep `LucideIcon` — chat internals still use it until sub-project 4) and `lib/theme/index.ts` (drop the `ThemeSelector` export). In `docs/auth-gate.md` replace the fingerprint-page bullet with "`app/(user)/auth/page.tsx` was deleted in the frontend overhaul (sub-project 1)". Run `git grep -n "HeaderLayout\|CenterTitleWrapper\|I18nSwitcher\|AccountMenu\b\|ThemeSelector\|theme-selector"` — Expected: no hits outside docs.

- [ ] **Step 6: Run everything**

Run: `pnpm test:e2e && pnpm exec tsc --noEmit && pnpm exec oxlint app components lib && pnpm test`

Expected: all green, including `chat-header.spec.ts` in all projects (mobile: Menu button; desktop: width toggle + account menu).

- [ ] **Step 7: Commit**

```bash
git add -A app components lib docs/auth-gate.md e2e/chat-header.spec.ts
git commit -m "feat(shell): user shell for the app list and chat; old header, switcher and account menu removed"
```

---

### Task 11: Theme variables become antd token aliases

**Files:**

- Modify: `app/globals.css`
- Create: `e2e/theme-aliases.spec.ts`

- [ ] **Step 1: Write the failing spec**

`e2e/theme-aliases.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

// Old page bodies still use the text-theme-* classes; after this task those resolve to antd tokens.
test('the legacy theme classes follow antd tokens in both colour schemes', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	const el = page.locator('.text-theme-desc').first()
	await expect(el).toBeVisible()
	const color = await el.evaluate(node => getComputedStyle(node).color)
	// antd's colorTextSecondary: rgba(0,0,0,0.65) under defaultAlgorithm, rgba(255,255,255,0.65) under darkAlgorithm.
	expect(color).toBe(
		testInfo.project.use.colorScheme === 'dark'
			? 'rgba(255, 255, 255, 0.65)'
			: 'rgba(0, 0, 0, 0.65)',
	)
})
```

(The app card description on `/apps` uses `text-theme-desc`; the seeded app has a description.) Run: `pnpm test:e2e --project=desktop-light --project=desktop-dark e2e/theme-aliases.spec.ts` — Expected: FAIL — today `--theme-desc-color` is the hard-coded `#898989` / `#aaa`.

- [ ] **Step 2: Replace the hard-coded theme blocks**

In `app/globals.css`: delete the `:root { --theme-text-color … }` block, the `.dark { --theme-text-color … }` block, the shadcn `:root { --radius … --sidebar-ring }` and `.dark { --background … --sidebar-ring }` blocks, and the `body { background-color: var(--background); color: var(--foreground); }` rule (the shells paint `color-bg-layout`; body is outside antd's variable scope). Keep `@import 'tailwindcss'`, the `@theme inline` block, the `.text-theme-*`/`.bg-theme-*`/`.border-theme*` utility classes and the antd/X override rules. Add, where the deleted `:root` theme block was:

```css
/* Fork theme aliases. Every --theme-* and shadcn-style variable the old page bodies still use now points at an
   antd token, so colours come from the single antd theme and flip with darkAlgorithm. Declared on .ant-app —
   antd's CSS-variable scope — because a var() alias only resolves where the --ant-* variables exist, not at :root.
   Removed in overhaul sub-project 4 together with their last consumers. */
.ant-app {
	--theme-text-color: var(--ant-color-text);
	--theme-desc-color: var(--ant-color-text-secondary);
	--theme-bg-color: var(--ant-color-bg-layout);
	--theme-btn-bg-color: var(--ant-color-bg-container);
	--theme-main-bg-color: var(--ant-color-bg-container);
	--theme-border-color: var(--ant-color-border-secondary);
	--theme-splitter-color: var(--ant-color-split);
	--theme-button-border-color: var(--ant-color-border);
	--theme-primary-color: var(--ant-color-primary);
	--theme-success-color: var(--ant-color-success);
	--theme-warning-color: var(--ant-color-warning);
	--theme-danger-color: var(--ant-color-error);
	--theme-bubble-bg-color: var(--ant-color-fill-secondary);
	--theme-code-block-bg-color: var(--ant-color-bg-container);
	--background: var(--ant-color-bg-container);
	--foreground: var(--ant-color-text);
	--card: var(--ant-color-bg-container);
	--card-foreground: var(--ant-color-text);
	--popover: var(--ant-color-bg-elevated);
	--popover-foreground: var(--ant-color-text);
	--primary: var(--ant-color-primary);
	--primary-foreground: var(--ant-color-white);
	--secondary: var(--ant-color-fill-secondary);
	--secondary-foreground: var(--ant-color-text);
	--muted: var(--ant-color-fill-tertiary);
	--muted-foreground: var(--ant-color-text-secondary);
	--accent: var(--ant-color-fill-secondary);
	--accent-foreground: var(--ant-color-text);
	--destructive: var(--ant-color-error);
	--border: var(--ant-color-border);
	--input: var(--ant-color-border);
	--ring: var(--ant-color-primary);
	--radius: var(--ant-border-radius-lg);
}
```

Also delete `components/chat/theme-config.ts` if `git grep -n "theme-config" -- app components lib` prints nothing after Task 6 (its `colors.primary` consumer was the chat `XProvider`); otherwise leave it for sub-project 4 and record the ruling.

- [ ] **Step 3: Run the spec, then the whole suite**

Run: `pnpm test:e2e --project=desktop-light --project=desktop-dark e2e/theme-aliases.spec.ts && pnpm test:e2e`

Expected: PASS. Then look at `/apps`, `/chat/<APP_ID>`, `/app-management` in both schemes on the suite's server (`localhost:5301`): no element lost its colour (an invalid alias shows as black text or a white box in dark mode) — fix the alias, not the page.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css e2e/theme-aliases.spec.ts
git commit -m "style(theme): legacy theme variables aliased to antd tokens on the App root"
```

---

### Task 12: Shell flows, screenshots, production check, docs

**Files:**

- Create: `e2e/shell.spec.ts`, `e2e/screenshots.spec.ts`
- Modify: `docs/frontend-conventions.md` (`## Status`, production-check result), `CLAUDE.md` (structure + status), `.cii-assessment.md` (only if a criterion changed — commit separately)

- [ ] **Step 1: Shell flows (write, run, expect green — the behaviour exists after Tasks 7–11; a failure is a finding)**

`e2e/shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('the language dropdown switches the UI and the html lang', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'Language' }).click()
	await page.getByRole('menuitem', { name: 'العربية' }).click()
	await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
	await page.getByRole('button', { name: /اللغة/ }).click()
	await page.getByRole('menuitem', { name: 'English' }).click()
	await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('the theme dropdown switches to dark and the shell surface follows', async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.use.colorScheme === 'dark', 'starts dark already')
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'System' }).click()
	await page.getByRole('menuitem', { name: 'Dark' }).click()
	await expect
		.poll(() =>
			page
				.locator('.ant-layout')
				.first()
				.evaluate(el => getComputedStyle(el).backgroundColor),
		)
		.toBe('rgb(0, 0, 0)')
})

test('the account dropdown shows the email and logs out', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('button', { name: /signed in as/i }).click()
	await expect(page.getByRole('menuitem', { name: /admin@e2e\.local/ })).toBeVisible()
	await page.getByRole('menuitem', { name: /log out/i }).click()
	await expect(page).toHaveURL(/\/login/)
})

test('on mobile the admin navigation opens from the menu button', async ({ page }, testInfo) => {
	test.skip(!testInfo.project.name.startsWith('mobile'), 'desktop shows the menu inline')
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'Menu' }).click()
	await page.getByRole('menuitem', { name: 'User management' }).click()
	await expect(page).toHaveURL(/\/user-management$/)
})
```

Button names: the theme trigger's accessible name is `t('system.theme_mode_system')` ("System" in English); the language trigger's is `t('system.language')` ("Language"; "اللغة" after switching). Check `locales/en/translation.json` for the exact strings if a locator fails, and prefer fixing the `aria-label` over a looser locator.

Run: `pnpm test:e2e e2e/shell.spec.ts` —

Expected: PASS in all projects.

- [ ] **Step 2: Screenshots for review**

`e2e/screenshots.spec.ts`:

```ts
import { test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

const pages = {
	login: '/login',
	apps: '/apps',
	admin: '/app-management',
	users: '/user-management',
	chat: `/chat/${APP_ID}`,
}

for (const [name, path] of Object.entries(pages)) {
	test(`screenshot ${name}`, async ({ page }, testInfo) => {
		await page.goto(path)
		await page.waitForLoadState('networkidle')
		await page.screenshot({
			path: `e2e/screenshots/${name}-${testInfo.project.name}.png`,
			fullPage: true,
		})
	})
}
```

Run: `pnpm test:e2e e2e/screenshots.spec.ts` —

Expected: 15 PNGs under `e2e/screenshots/` (git-ignored). Attach them to the task report for the user's review.

- [ ] **Step 3: Production first-paint check**

```bash
pnpm build && (pnpm exec next start -p 5302 > /tmp/next-start.log 2>&1 &) && sleep 8 \
  && curl -s http://localhost:5302/login | grep -o '<style' | wc -l \
  && curl -s http://localhost:5302/login | grep -c -- '--ant-color-primary' ; pkill -f "next start -p 5302"
```

Expected: both counts > 0 (antd styles and the token block are inlined by `AntdRegistry`). If the second count is 0, add fallback values to the alias block in `app/globals.css` for the ten colour variables (`var(--ant-color-text, rgba(0, 0, 0, 0.88))` for light; dark fallbacks under `.dark .ant-app` using antd's dark values from `theme.getDesignToken({ algorithm: theme.darkAlgorithm })`) and record the finding in `docs/frontend-conventions.md`. Write the result (counts, date) into the conventions doc's `## Status`.

- [ ] **Step 4: Lint non-regression and docs**

Run: `npx -y @ant-design/cli lint ./ 2>&1 | tail -5` —

Expected: error count ≤ the Task 5 baseline. Update `docs/frontend-conventions.md` `## Status` (sub-project 0 done, 1 done, next: 2 chat) and `CLAUDE.md`: in "Decisions taken" add a "Frontend overhaul" subsection pointing at the charter, the conventions doc and the next sub-project; describe the new structure in one paragraph (`components/providers`, `components/shell`, route groups). Re-check `.cii-assessment.md` per `AGENTS.md`; if the e2e suite changes an assessment row, update it and commit that file separately.

- [ ] **Step 5: Commit**

```bash
git add e2e/shell.spec.ts e2e/screenshots.spec.ts docs/frontend-conventions.md CLAUDE.md
git commit -m "test(e2e): shell flows and review screenshots; docs updated for the new skeleton"
```

---

## Execution notes

- Models: Tasks 1, 2, 5 are mechanical (cheapest tier); Tasks 3, 4, 12 are harness work (mid tier); Tasks 6–11 touch many files and the running app (standard tier, Opus); every task reviewer mid tier or above; the final whole-branch review on the most capable model.
- The dev server for the user's own testing runs on port 5300 from the branch; the suite uses 5301/3307/5399 and never the user's `.env` database.
- Rulings are recorded in the SDD ledger; the login-form locators (Task 4) and the mobile card click (Task 4) are the two places most likely to need one.
