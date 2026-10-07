# Backend rework B1 — the Dify layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inherited Dify proxy with one Route Handler per Dify Service API operation (Dify 1.17.1), a typed server client, a pass-through error contract, a server-only Data Access Layer for apps with the icon stored on the row, the chat page's server-side app lookup, and the chat, apps and admin code on the new contract — with the recorded follow-ups (workflow and completion stop routes, the human-input form GET, the audio part forwarded as recorded) implemented and the old `lib/api`, `lib/core`, `repository/`, `services/`, `app/api/client/**` deleted.

**Architecture:** `app/api/dify/[appId]/<Dify path>/route.ts` handlers verify the session, load the app's credentials through `lib/data/apps.ts`, validate the input with a zod schema from `lib/dify/schemas.ts`, call one function of the `server-only` client `lib/dify/client.ts` and return Dify's status and body verbatim (streams and binaries as the upstream `Response`); the app's own refusals use Dify's `{ code, message, status }` envelope. The browser talks to those routes through one typed client, `lib/dify/browser.ts`, that throws `DifyRequestError` on a non-OK answer, so the chat keeps one error parser. The server pages read the DAL directly; the admin writes are thin Server Actions returning `ActionResult`. The session helpers move to `lib/auth/` (typed through next-auth's module augmentation), the server environment is parsed once in `lib/env.ts`. The icon is fetched at create and sync time and served by `GET /api/apps/[appId]/icon`; file links go through the preview and remote-file routes, so neither the Dify host nor the key reaches the browser.

**Tech Stack:** Next 16.3 (Route Handlers with `RouteContext`, `PageProps`, Server Actions with `refresh()`, `server-only`), next-auth 4.24, Drizzle ORM 1.0.0-rc.3 on MySQL 8.4 (`drizzle-kit generate`/`migrate`), zod 4 (new), React 19.2, antd 6.6, Ant Design X 2.9 / x-sdk, vitest 4 (node), Playwright 1.63 with the stub Dify API (`e2e/fixtures/stub/`).

**Spec:** `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` — read §2 (decisions), §4.1 to §4.6 and §5 (B1 row) first; every task cites its sections. The endpoint map it implements is `docs/dify-service-api-1.17.1.md` (paths, `user` placement, shapes, statuses, SSE events). The consumer map `.superpowers/sdd/2026-10-07-backend-rework/frontend-consumer-map.md` lists, per route, the frontend callers and the e2e specs that pin them.

**Two deviations from the charter text, both deliberate (record them in ADR-0023, Task 18):**

1. §4.2 says every DAL function "verifies the caller itself through `verifySession()`". Next's docs state that request memoization does not apply in Route Handlers ("they are not part of the React component tree", `04-functions/fetch.md`, `04-glossary.md`), so a DAL that re-verified inside every handler would run `getServerSession` (a JWT decode plus the `sessionVersion` query) twice per chat request. The DAL therefore takes the verified `actor: SessionUser` as its first parameter: the entry point (route, action, page) verifies once, and a DAL function cannot be called without a verified user, which keeps the guide's guarantee with one session read.
2. §4.3 places the browser client at `components/chat/provider/dify-api.ts`. The admin annotations panel needs the same client, so it lives at `lib/dify/browser.ts` (client-safe, no `server-only` import); `components/chat/provider/dify-fetch.ts` keeps only x-sdk's `fetch` option on top of it.

## Global Constraints

- Documented approaches only (ADR-0002): Next APIs from `node_modules/next/dist/docs/01-app/` (Route Handlers: `03-api-reference/03-file-conventions/route.md`; Server Actions: `02-guides/server-actions.md`, `02-guides/data-security.md`; `refresh`: `03-api-reference/04-functions/refresh.md`; typegen: `03-api-reference/06-cli/next.md`); next-auth v4 from Context7 `/websites/next-auth_js`; Drizzle from Context7 `/drizzle-team/drizzle-orm-docs` and the installed `node_modules/drizzle-orm/mysql-core`; zod 4 from Context7 (`zod`, current major); Dify from `docs/dify-service-api-1.17.1.md`. Name the source of every non-obvious API decision in the task report. No private imports, no `@ts-nocheck`, a `@ts-expect-error` only with its reason on the line.
- Versions: `next` 16.3.4, `next-auth` 4.24, `drizzle-orm` and `drizzle-kit` 1.0.0-rc.3, `zod` ^4 (the one new dependency, Task 1), `react` 19.2, `antd` 6.6.5. Nothing else is added.
- The Dify contract (charter §4.1, §4.5): routes are `app/api/dify/[appId]/<Dify path>/route.ts` with Dify's path and verb; the handler order is session → app → validation → client → answer; Dify's status and body pass through verbatim; the app's own refusals are `{ code, message, status }` with `unauthorized` (401), `app_not_found` (404), `app_disabled` (403), `invalid_param` (400), `upstream_error` (Dify's status), `upstream_unreachable` (502). No `{ code, data }` wrapper anywhere. `user` is always the session email, set after validation; the schemas strip unknown keys.
- Server-only code imports `server-only` (built into Next; vitest maps it to Next's empty module, Task 1). `process.env` is read only in `lib/env.ts` (plus `drizzle.config.ts` and `db/migrate.ts`, which run outside Next). Browser-facing types come only from `lib/dify/types` and the DAL's DTO types; no DTO carries `apiKey`; the chat DTO carries no `apiBase`.
- Database (ADR-0004, AGENTS.md): schema changes through `db/schema/*.ts` + `pnpm db:generate` + a hand review of the SQL; never `drizzle-kit push`; the one B1 migration carries the `is_enabled` backfill (Task 6). The dev loop applies it with `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate`.
- Language: no Chinese string remains in the files this plan touches; logs are English; nothing user-facing is a message, only a code the frontend translates. New UI text goes through i18next keys present in `locales/en`, `locales/zh` and `locales/ar` (`pnpm test` checks parity; never run `i18next-cli extract/sync`; Arabic is Modern Standard Arabic, ADR-0005).
- Frontend rules stay (charter §4.3 of the frontend overhaul, `docs/frontend-conventions.md`): antd components first, token-only CSS Modules, `App.useApp()` for messages, one `XProvider`; the chat's data layer stays provider-centred (ADR-0017).
- Unit tests: vitest in `__tests__/` (node, no DOM). Server modules are tested by mocking their imports with `vi.hoisted` + `vi.mock` (the pattern of `__tests__/group-layouts.test.ts`); `fetch` is stubbed with `vi.stubGlobal('fetch', vi.fn())` and restored with `vi.unstubAllGlobals()` (the pattern of `__tests__/dify-fetch.test.ts`). Route handlers are called directly: `GET(new NextRequest(url), { params: Promise.resolve({ appId }) })`.
- e2e: Playwright specs in `e2e/` (web-first assertions, role and name locators, never `networkidle`). Three projects run one after another on a database that survives between runs, so every row a spec creates carries the project name and is deleted in `finally`/`afterEach`. Run a task's specs with `pnpm exec playwright test e2e/<file>.spec.ts` (the `setup` project runs first by itself); `pnpm dev` must be stopped (one `next dev` per checkout). The full suite runs once at the end (Task 18), before the whole-branch review.
- Before every commit: `pnpm exec next typegen && pnpm exec tsc --noEmit` (`RouteContext` and `PageProps` are generated types), `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --write <changed files>`, `pnpm test`.
- Commits: conventional (`feat|fix|test|docs|chore(scope): …`), English, both trailer lines in ONE `-m` argument (separate `-m` flags leave only the last line parsed as a trailer); `git add <paths>` (never `-A`); no push until Task 18 asks the owner.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn
```

- Memory on this machine (~5 GB): never run the Docker build and `pnpm test:e2e` at the same time; take the old app container down before a build; run the build in the foreground; never restart a build Claude Code's memory reaper killed. `AGENTS.md` stays byte-identical to upstream.

## Review Focus

Five conditions the charter implies but no feature flow pins on its own; each has its test in the task named.

1. **Dify answers something that is not JSON on a JSON operation** (a reverse proxy's HTML 502 page, an empty 200 body, a truncated answer): the server client answers `upstream_error` with Dify's status and the handler returns that envelope, never a `SyntaxError` turned into a 500. Unit tests in Task 4 (`client.test.ts`, "non-JSON body") and Task 7 (route passthrough).
2. **A multipart request with no `file` part, an empty part, a part without a filename, or a second file part**: the upload and audio routes answer `400 invalid_param` before anything is forwarded. Unit tests in Task 5 (`schemas.test.ts`, the form-part schema) and Task 10.
3. **Query parameters outside the map's ranges** (`limit` 0 or 101, an unknown `sort_by`, `first_id` or `conversation_id` that is not a UUID, `as_attachment=yes`): `400 invalid_param`, with the parameter named. Unit tests in Task 5.
4. **The icon sync meets an image that is too large or not an image** (a 3 MB PNG, an HTML error page at the signed URL, a network failure): the stored icon is kept, the sync result says `partial: true`, nothing else of the sync is lost. Unit tests in Task 6 (`readIconBytes`, `syncApp`).
5. **A remote file URL that points elsewhere** (`https://evil.example/x`, a `javascript:` URL, a relative path that escapes `/files/`): the remote-file route refuses with `400 invalid_param` and never fetches; only URLs on the app's own Dify origin under `/files/` pass. Unit tests in Task 10 (`remote-file.test.ts`).

---

## File structure

```
lib/env.ts                              server environment, parsed once (zod)                          (Task 1)
db/index.ts, lib/mail.ts, next.config.ts, vitest.config.ts   cleanups on env, no CORS, server-only alias      (Task 1)
types/next-auth.d.ts                    module augmentation (id on Session.user, JWT claims)            (Task 2)
lib/auth/options.ts, password.ts, session.ts   typed NextAuthOptions, bcrypt + reset-token helpers, verifySession/requireUser/requireActor/AuthError  (Task 2)
lib/session-user.ts                     temporary shim over lib/auth/session for the old routes, deleted in Task 17   (Task 2)
lib/dify/types/{app,chat,files,workflow,human-input,annotations,events,index}.ts   contracts from the endpoint map  (Task 3)
lib/dify/errors.ts                      DifyError, envelope helpers, difyErrorResponse, errorResponseFrom   (Task 3)
lib/action-result.ts                    ActionResult, ok/fail, toActionFailure                          (Task 3)
lib/dify/client.ts                      the server-only typed client (27 operations + remote file)      (Task 4)
lib/dify/schemas.ts                     zod schemas per operation; query, body and form-part parsers    (Task 5)
db/schema/apps.ts, db/migrations/<new>/ boolean is_enabled (backfilled), icon columns, $onUpdate        (Task 6)
lib/data/apps.ts                        DAL: list/get/getChatApp/getAppAccess/create/update/delete/sync/getAppIcon, DTOs   (Task 6)
lib/dify/route.ts                       resolveDifyRoute (session → app → credentials), handleDifyError   (Task 7)
app/api/dify/[appId]/{info,parameters,site,meta}/route.ts                                               (Task 7)
app/api/dify/[appId]/{chat-messages,chat-messages/[taskId]/stop,messages,messages/[messageId]/suggested,messages/[messageId]/feedbacks,conversations,conversations/[conversationId],conversations/[conversationId]/name}/route.ts   (Task 8)
app/api/dify/[appId]/{completion-messages,completion-messages/[taskId]/stop,workflows/run,workflows/tasks/[taskId]/stop,workflow/[workflowRunId]/events,form/human_input/[formToken]}/route.ts   (Task 9)
app/api/dify/[appId]/{files/upload,files/[fileId]/preview,files/remote,audio-to-text,text-to-audio,apps/annotations,apps/annotations/[annotationId]}/route.ts, app/api/apps/[appId]/icon/route.ts   (Task 10)
lib/dify/browser.ts                     the browser client (DifyRequestError, createDifyApi)            (Task 11)
components/chat/provider/dify-fetch.ts  x-sdk fetch option on the browser client                        (Task 11)
app/(user)/chat/[appId]/page.tsx, components/chat/app-unavailable.tsx, chat-workspace.tsx, app-context.tsx, app-answers.ts, the app-field consumers   (Task 12)
components/chat/hooks/*, chat-view/{chat-view,annotation-drawer}.tsx   on the new contract              (Task 13)
components/chat/hooks/use-workflow-run.ts, message/human-input-form.tsx   stops, form GET               (Task 14)
components/chat/message/message-files.tsx, chat-view/file-upload.tsx, conversation-sidebar.tsx, utils-index.ts   files through the proxy   (Task 15)
components/apps/*, components/admin/apps/*, app/(admin)/app-management/{actions,schemas}.ts, app/(user)/{apps,chat}/page.tsx   DTO, actions, annotations through routes   (Task 16)
deletions (lib/dify-client.ts, lib/api/, lib/api-utils.ts, lib/core/, lib/db/types.ts, lib/session-user.ts, lib/helpers/{base-request,vars}.ts, repository/, services/, types/index.ts, app/api/apps.ts, app/api/client/**, app/(admin)/app-management/utils.ts, instrumentation.ts, db/seed.ts)   (Task 17)
docs/decisions/0022, 0023, 0025 + notes on 0006, 0017, 0020; CLAUDE.md; docs/frontend-conventions.md; docs/auth-gate.md; .cii-assessment.md   (Task 18)
```

---

### Task 1: Foundation — zod, `lib/env.ts`, database handle, config cleanup

Charter §4.3 "Config cleanup", §4.5 "Environment", §2 "Validation".

**Files:**
- Modify: `package.json` (add `zod`)
- Create: `lib/env.ts`
- Modify: `db/index.ts`, `lib/mail.ts`, `next.config.ts`, `vitest.config.ts`
- Delete: `lib/is-next-build.ts`
- Test: `__tests__/env.test.ts`

**Interfaces:**
- Produces: `env(): ServerEnv` with `{ nodeEnv, databaseUrl, nextAuthSecret, smtp: SmtpConfig | null }`; `parseEnv(source)` (pure, for tests); `EnvError` (`keys: string[]`). `getDb(): Db` and `type Db`. `isMailConfigured(): boolean` unchanged in name.

- [ ] **Step 1: Branch and add zod**

```bash
git checkout fork/overhaul && git pull --ff-only origin fork/overhaul
git checkout -b feat/backend-b1-dify-layer
# The approved charter, the committed endpoint map and this plan are untracked on the checkout: first commit.
git add docs/superpowers/specs/2026-10-07-backend-rework-charter.md docs/dify-service-api-1.17.1.md docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md
git commit -m "docs(backend): rework charter, Dify 1.17.1 endpoint map, B1 plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
pnpm add zod
pnpm why zod   # one copy, ^4.x
```

- [ ] **Step 2: Write the failing env test**

Create `__tests__/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { EnvError, parseEnv } from '@/lib/env'

const base = {
	DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db',
	NEXTAUTH_SECRET: 'not-a-secret',
}

describe('parseEnv', () => {
	it('parses the minimal environment with no mail', () => {
		expect(parseEnv(base)).toEqual({
			nodeEnv: 'development',
			databaseUrl: base.DATABASE_URL,
			nextAuthSecret: base.NEXTAUTH_SECRET,
			smtp: null,
		})
	})

	it('names the missing variables', () => {
		const error = (() => {
			try {
				parseEnv({ NEXTAUTH_SECRET: 'x' })
			} catch (e) {
				return e
			}
		})()
		expect(error).toBeInstanceOf(EnvError)
		expect((error as EnvError).keys).toEqual(['DATABASE_URL'])
		expect((error as Error).message).toContain('DATABASE_URL')
	})

	it('ignores partial SMTP values while SMTP_ENABLED is not true', () => {
		expect(parseEnv({ ...base, SMTP_ENABLED: 'false', SMTP_SERVER: 'smtp.example' }).smtp).toBeNull()
	})

	it('requires the whole SMTP block once SMTP_ENABLED is true', () => {
		let keys: string[] = []
		try {
			parseEnv({ ...base, SMTP_ENABLED: 'true', SMTP_SERVER: 'smtp.example' })
		} catch (e) {
			keys = (e as EnvError).keys
		}
		expect(keys.sort()).toEqual(
			['APP_URL', 'MAIL_DEFAULT_SEND_FROM', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_USERNAME'].sort(),
		)
	})

	it('parses a full SMTP block, the port as a number', () => {
		const env = parseEnv({
			...base,
			NODE_ENV: 'production',
			SMTP_ENABLED: 'true',
			SMTP_SERVER: 'smtp.example',
			SMTP_PORT: '465',
			SMTP_USERNAME: 'mailer',
			SMTP_PASSWORD: 'pw',
			SMTP_USE_TLS: 'true',
			MAIL_DEFAULT_SEND_FROM: 'hub@example.com',
			APP_URL: 'https://hub.example.com/',
		})
		expect(env.nodeEnv).toBe('production')
		expect(env.smtp).toEqual({
			host: 'smtp.example',
			port: 465,
			username: 'mailer',
			password: 'pw',
			useTls: true,
			from: 'hub@example.com',
			appUrl: 'https://hub.example.com',
		})
	})

	it('rejects an APP_URL that is not a URL', () => {
		expect(() =>
			parseEnv({
				...base,
				SMTP_ENABLED: 'true',
				SMTP_SERVER: 'smtp.example',
				SMTP_PORT: '25',
				SMTP_USERNAME: 'm',
				SMTP_PASSWORD: 'p',
				MAIL_DEFAULT_SEND_FROM: 'a@b.c',
				APP_URL: 'not a url',
			}),
		).toThrow(EnvError)
	})
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/env.test.ts`
Expected: FAIL, `Cannot find module '@/lib/env'`.

- [ ] **Step 4: Map `server-only` for vitest**

Next ships its own `server-only` module (`node_modules/next/dist/compiled/server-only/`, with `empty.js`); the Jest guide maps the import to an empty module (`02-guides/testing/jest.md`, `moduleNameMapper`). The vitest equivalent is a resolve alias. Edit `vitest.config.ts`:

```ts
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		// Playwright specs under e2e/ run with `pnpm test:e2e`, not vitest.
		exclude: [...configDefaults.exclude, 'e2e/**'],
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname),
			// Next's `server-only` guard (the Jest guide maps it to an empty module; vitest does the same here).
			'server-only': path.resolve(__dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
		},
	},
})
```

- [ ] **Step 5: Write `lib/env.ts`**

```ts
import 'server-only'

import * as z from 'zod'

const flag = z.enum(['true', 'false'])

const baseSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	DATABASE_URL: z.string().min(1),
	NEXTAUTH_SECRET: z.string().min(1),
	SMTP_ENABLED: flag.default('false'),
})

/** Required together once SMTP_ENABLED is true (charter §4.5: an all-or-nothing block). */
const smtpSchema = z.object({
	SMTP_SERVER: z.string().min(1),
	SMTP_PORT: z.coerce.number().int().positive(),
	SMTP_USERNAME: z.string().min(1),
	SMTP_PASSWORD: z.string().min(1),
	SMTP_USE_TLS: flag.default('true'),
	MAIL_DEFAULT_SEND_FROM: z.string().min(1),
	APP_URL: z.url(),
})

export interface SmtpConfig {
	host: string
	port: number
	username: string
	password: string
	useTls: boolean
	from: string
	/** Without a trailing slash: the reset link is `${appUrl}/reset-password?token=…`. */
	appUrl: string
}

export interface ServerEnv {
	nodeEnv: 'development' | 'test' | 'production'
	databaseUrl: string
	nextAuthSecret: string
	smtp: SmtpConfig | null
}

export class EnvError extends Error {
	constructor(public readonly keys: string[]) {
		super(`Missing or invalid environment variables: ${keys.join(', ')}`)
		this.name = 'EnvError'
	}
}

const keysOf = (error: z.ZodError) => Object.keys(z.flattenError(error).fieldErrors)

/** Pure: the environment as the app reads it, or an EnvError naming every missing or invalid variable. */
export const parseEnv = (source: Record<string, string | undefined>): ServerEnv => {
	const base = baseSchema.safeParse(source)
	if (!base.success) throw new EnvError(keysOf(base.error))
	let smtp: SmtpConfig | null = null
	if (base.data.SMTP_ENABLED === 'true') {
		const parsed = smtpSchema.safeParse(source)
		if (!parsed.success) throw new EnvError(keysOf(parsed.error))
		smtp = {
			host: parsed.data.SMTP_SERVER,
			port: parsed.data.SMTP_PORT,
			username: parsed.data.SMTP_USERNAME,
			password: parsed.data.SMTP_PASSWORD,
			useTls: parsed.data.SMTP_USE_TLS === 'true',
			from: parsed.data.MAIL_DEFAULT_SEND_FROM,
			appUrl: parsed.data.APP_URL.replace(/\/$/, ''),
		}
	}
	return {
		nodeEnv: base.data.NODE_ENV,
		databaseUrl: base.data.DATABASE_URL,
		nextAuthSecret: base.data.NEXTAUTH_SECRET,
		smtp,
	}
}

let cached: ServerEnv | undefined

/**
 * The server environment, parsed on first use and kept for the process. Nothing calls it at module load, so
 * `next build` (which has no DATABASE_URL in the image build) never trips it; the first request does, with the
 * variable's name in the error. The only place in lib/ that reads process.env (charter §4.3 rules).
 */
export const env = (): ServerEnv => (cached ??= parseEnv(process.env))
```

- [ ] **Step 6: Run the env test**

Run: `pnpm exec vitest run __tests__/env.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: `db/index.ts` on the environment, without the build-time proxy**

Replace the file with:

```ts
import { drizzle } from 'drizzle-orm/mysql2'

import { env } from '@/lib/env'

// drizzle-orm 1.0.0-rc.3: the mysql2 driver takes a connection string; its config has no `schema` option (the
// relational API is typed over defineRelations), and the DAL uses the query builder with explicit columns.
const createDb = () => drizzle(env().databaseUrl, { logger: env().nodeEnv === 'development' })

export type Db = ReturnType<typeof createDb>

// One pool per process. In development the module is re-evaluated on edits, so the instance lives on globalThis
// (the pattern Drizzle's Next.js guides use for hot reload); in production the module loads once anyway.
const globalForDb = globalThis as unknown as { difyAppHubDb?: Db }

export const getDb = (): Db => (globalForDb.difyAppHubDb ??= createDb())
```

Delete `lib/is-next-build.ts` (its only importer was the proxy that is gone):

```bash
git rm lib/is-next-build.ts
```

- [ ] **Step 8: `lib/mail.ts` on the environment, in English**

Replace the file with:

```ts
import 'server-only'

import nodemailer from 'nodemailer'

import { env } from '@/lib/env'

function maskEmail(email: string) {
	const [localPart, domain] = email.split('@')
	if (!localPart || !domain) return '[invalid-email]'
	return `${localPart.slice(0, 2)}***@${domain}`
}

/** The SMTP block of the environment parsed (charter §4.5): the forgot-password page offers the form only then. */
export function isMailConfigured() {
	return env().smtp !== null
}

export async function sendPasswordResetEmail(email: string, token: string) {
	const smtp = env().smtp
	if (!smtp) throw new Error('Mail is not configured')

	const secure = smtp.useTls && smtp.port === 465
	const transport = nodemailer.createTransport({
		host: smtp.host,
		port: smtp.port,
		secure,
		requireTLS: smtp.useTls && smtp.port !== 465,
		tls: { minVersion: 'TLSv1.2' },
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 30_000,
		auth: { user: smtp.username, pass: smtp.password },
	})

	try {
		const result = await transport.sendMail({
			from: smtp.from,
			to: email,
			subject: 'Reset your password',
			text: `Open this link within 15 minutes to reset your password:\n${smtp.appUrl}/reset-password?token=${token}`,
		})
		console.info('Password reset email accepted by SMTP', {
			to: maskEmail(email),
			messageId: result.messageId,
			accepted: result.accepted.length,
			rejected: result.rejected.length,
			response: result.response,
		})
	} catch (error) {
		console.error('SMTP failed to send the password reset email', {
			to: maskEmail(email),
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
```

The previous code treated `SMTP_USE_TLS` unset as "true for 465, requireTLS only when explicitly true"; the schema's default `'true'` keeps `secure` on 465 and turns `requireTLS` on for other ports, which is nodemailer's documented STARTTLS setting. Say so in the commit body.

- [ ] **Step 9: Drop the wildcard CORS headers**

Replace `next.config.ts` with:

```ts
import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	output: 'standalone',
	turbopack: {
		root: path.resolve(__dirname),
	},
}

export default nextConfig
```

(The removed block set `Access-Control-Allow-Origin: *` beside `Allow-Credentials: true` on every path, which browsers reject together; a same-origin app needs no CORS, and a route that ever needs it sets its own headers, `route.md` "CORS".)

- [ ] **Step 10: Type-check, lint, test**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint lib/env.ts db/index.ts lib/mail.ts next.config.ts vitest.config.ts && pnpm exec oxfmt --write lib/env.ts db/index.ts lib/mail.ts next.config.ts vitest.config.ts __tests__/env.test.ts && pnpm test`
Expected: all green. If `tsc` complains that `db.$client` is used anywhere, that is `db/seed.ts`, which Task 6 removes; delete it now instead (`git rm db/seed.ts` and drop the `db:seed` script from `package.json`) and say so in the commit.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml lib/env.ts __tests__/env.test.ts db/index.ts lib/mail.ts next.config.ts vitest.config.ts
git commit -m "chore(backend): zod, lib/env.ts, database handle without the build-time proxy, no wildcard CORS

The server environment is parsed once in lib/env.ts (zod 4, charter §4.5); db/index.ts drops the throwing proxy and the as-any cast (drizzle rc.3's mysql2 driver takes no schema option); lib/mail.ts reads the parsed SMTP block and sends English text; next.config.ts no longer sets Access-Control-Allow-Origin: * on every path; vitest maps server-only to Next's empty module as the Jest guide does.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 2: `lib/auth/` — typed next-auth options, password helpers, session helpers, the proxy's envelope

Charter §4.2 "Session", §4.3 (`lib/auth/`), §4.1 (the 401 envelope).

**Files:**
- Modify: `types/next-auth.d.ts`
- Create: `lib/auth/options.ts`, `lib/auth/password.ts`, `lib/auth/session.ts`
- Modify: `lib/session-user.ts` (becomes a shim), `proxy.ts`, `app/layout.tsx`, `app/(user)/layout.tsx`, `app/(admin)/layout.tsx`, `app/(admin)/user-management/page.tsx`, `app/(auth)/login/layout.tsx`, `app/(auth)/forgot-password/layout.tsx`, `app/api/auth/[...nextauth]/route.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/auth/reset-password/route.ts`, `app/api/init/route.ts`
- Delete: `lib/auth.ts`, `lib/password-reset.ts`, `__tests__/session-user.test.ts`
- Test: `__tests__/auth-session.test.ts`, `__tests__/auth-options.test.ts`, `__tests__/proxy.test.ts` (three expectations), `__tests__/group-layouts.test.ts`, the page tests that mock `@/lib/session-user`

**Interfaces:**
- Produces: `SessionUser = { id: string; email: string; name: string | null }`; `verifySession(): Promise<SessionUser | null>`; `requireUser(): Promise<SessionUser>` (redirects to `/login`); `requireActor(): Promise<SessionUser>` (throws `AuthError('unauthorized')`); `redirectSignedInUser(to?)`; `getCachedServerSession()`; `class AuthError extends Error { code: 'unauthorized' | 'forbidden' }`; `authOptions: NextAuthOptions`; `hashPassword`, `verifyPassword`, `createPasswordResetToken`, `hashPasswordResetToken`, `PASSWORD_RESET_TOKEN_TTL_MS`.
- The shim `lib/session-user.ts` keeps `getSessionUserId`, `unauthorizedResponse`, `requireSessionUser`, `redirectSignedInUser`, `getCachedServerSession` for the old `app/api/client/**` routes until Task 17 deletes both.

- [ ] **Step 1: Write the failing session test**

Create `__tests__/auth-session.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mocks are created with vi.hoisted.
const { getServerSession, redirect } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn((to: string) => {
		throw new Error(`NEXT_REDIRECT:${to}`)
	}),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/options', () => ({ authOptions: { marker: true } }))

import {
	AuthError,
	getCachedServerSession,
	redirectSignedInUser,
	requireActor,
	requireUser,
	verifySession,
} from '@/lib/auth/session'

const live = { user: { id: 'u1', email: 'jane@example.com', name: 'Jane' } }
// A revoked JWT (sessionVersion mismatch) still yields a session, but the session callback leaves user.id out.
const revoked = { user: { email: 'jane@example.com' } }

beforeEach(() => {
	getServerSession.mockReset()
	redirect.mockClear()
})

describe('verifySession', () => {
	it('returns the signed-in account', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(verifySession()).resolves.toEqual({ id: 'u1', email: 'jane@example.com', name: 'Jane' })
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
	it('gives null for a name-less account a null name', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await expect(verifySession()).resolves.toEqual({ id: 'u1', email: 'jane@example.com', name: null })
	})
	it('returns null for a revoked session, no session, or a session without an email', async () => {
		getServerSession.mockResolvedValue(revoked)
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue(null)
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue({ user: { id: 'u1' } })
		await expect(verifySession()).resolves.toBeNull()
	})
})

describe('requireUser', () => {
	it('returns the account for a live session', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireUser()).resolves.toMatchObject({ id: 'u1' })
		expect(redirect).not.toHaveBeenCalled()
	})
	it('redirects a visitor without a session, and a revoked one, to /login', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login')
		getServerSession.mockResolvedValue(revoked)
		await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login')
	})
})

describe('requireActor', () => {
	it('returns the account for a live session', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireActor()).resolves.toMatchObject({ email: 'jane@example.com' })
	})
	it('throws AuthError(unauthorized) without a live session', async () => {
		getServerSession.mockResolvedValue(revoked)
		const error = await requireActor().catch(e => e)
		expect(error).toBeInstanceOf(AuthError)
		expect(error).toMatchObject({ name: 'AuthError', code: 'unauthorized' })
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('redirectSignedInUser', () => {
	it('sends a signed-in visitor to /apps, or to the given path', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(redirectSignedInUser()).rejects.toThrow('NEXT_REDIRECT:/apps')
		await expect(redirectSignedInUser('/app-management')).rejects.toThrow(
			'NEXT_REDIRECT:/app-management',
		)
	})
	it('leaves a visitor without a session, or with a revoked one, on the page', async () => {
		getServerSession.mockResolvedValue(null)
		await redirectSignedInUser()
		getServerSession.mockResolvedValue(revoked)
		await redirectSignedInUser()
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('getCachedServerSession', () => {
	it('delegates to getServerSession with the auth options', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(getCachedServerSession()).resolves.toEqual(live)
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
})
```

- [ ] **Step 2: Write the failing options test**

Create `__tests__/auth-options.test.ts` (the callbacks are plain functions on `authOptions`; the database is mocked at `getDb`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rows, limit } = vi.hoisted(() => {
	const limit = vi.fn()
	return { rows: { value: [] as unknown[] }, limit }
})
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	verifyPassword: (password: string, hash: string) => Promise.resolve(hash === `hash:${password}`),
}))

import type { JWT } from 'next-auth/jwt'

import { authOptions } from '@/lib/auth/options'

type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>
type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>
const jwt = authOptions.callbacks!.jwt as JwtCallback
const session = authOptions.callbacks!.session as SessionCallback

beforeEach(() => {
	limit.mockReset()
	limit.mockImplementation(() => Promise.resolve(rows.value))
})

describe('authOptions', () => {
	it('uses the JWT strategy and the app login page', () => {
		expect(authOptions.session).toEqual({ strategy: 'jwt' })
		expect(authOptions.pages).toEqual({ signIn: '/login' })
	})

	it('copies id and sessionVersion into the token at sign-in', async () => {
		const token = await jwt({
			token: {} as JWT,
			user: { id: 'u1', email: 'j@e.com', name: null, sessionVersion: 3 },
			account: null,
		} as never)
		expect(token).toMatchObject({ id: 'u1', sessionVersion: 3 })
	})

	it('keeps a token whose sessionVersion still matches the row', async () => {
		rows.value = [{ sessionVersion: 3 }]
		const token = await jwt({ token: { id: 'u1', sessionVersion: 3 } as JWT } as never)
		expect(token).toMatchObject({ id: 'u1', sessionVersion: 3 })
	})

	// ADR-0018's revocation rule: a password reset bumps sessionVersion; the token loses its id and the session
	// callback then sets none, which verifySession reads as "no live session".
	it('strips id and sessionVersion from a token whose version no longer matches, or whose user is gone', async () => {
		rows.value = [{ sessionVersion: 4 }]
		expect(await jwt({ token: { id: 'u1', sessionVersion: 3 } as JWT } as never)).toEqual({})
		rows.value = []
		expect(await jwt({ token: { id: 'u1', sessionVersion: 3 } as JWT } as never)).toEqual({})
	})

	it('sets session.user.id only from a token that has one', async () => {
		const withId = await session({
			session: { user: { email: 'j@e.com' }, expires: '' },
			token: { id: 'u1' } as JWT,
		} as never)
		expect(withId.user).toMatchObject({ id: 'u1', email: 'j@e.com' })
		const without = await session({
			session: { user: { email: 'j@e.com' }, expires: '' },
			token: {} as JWT,
		} as never)
		expect(without.user).not.toHaveProperty('id')
	})
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm exec vitest run __tests__/auth-session.test.ts __tests__/auth-options.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: The module augmentation**

Replace `types/next-auth.d.ts` with (the import makes the file a module, so the declarations augment next-auth's types instead of replacing them; next-auth v4 docs "TypeScript → Module Augmentation"):

```ts
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
	/** What `authorize` returns and the `jwt` callback receives at sign-in. */
	interface User {
		id: string
		sessionVersion: number
	}

	interface Session {
		user: {
			/** Absent for a revoked JWT: the token lost its id (lib/auth/options.ts jwt callback, ADR-0018). */
			id?: string
		} & DefaultSession['user']
	}
}

declare module 'next-auth/jwt' {
	interface JWT {
		id?: string
		sessionVersion?: number
	}
}
```

- [ ] **Step 5: `lib/auth/password.ts`**

```ts
import 'server-only'

import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'

const HASH_ROUNDS = 12

export const hashPassword = (password: string) => bcrypt.hash(password, HASH_ROUNDS)

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

export const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000

/** A random token for the emailed link; only its SHA-256 is stored (password_reset_tokens.token_hash). */
export function createPasswordResetToken() {
	const token = randomBytes(32).toString('hex')
	return {
		token,
		tokenHash: createHash('sha256').update(token).digest('hex'),
		expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
	}
}

export function hashPasswordResetToken(token: string) {
	return createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 6: `lib/auth/options.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

import { getDb } from '@/db'
import { users } from '@/db/schema'

import { verifyPassword } from './password'

/**
 * next-auth v4 with the credentials provider and the JWT strategy (ADR-0006). The jwt callback re-checks the
 * account's sessionVersion on every call: a mismatch (a password reset or change bumped it) strips `id` and
 * `sessionVersion` from the token, the session callback then sets no `user.id`, and verifySession() treats
 * that as "no live session" (ADR-0018). Returning a token without the claims keeps the callback within its
 * documented return type instead of returning null.
 */
export const authOptions: NextAuthOptions = {
	providers: [
		CredentialsProvider({
			name: 'credentials',
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' },
			},
			async authorize(credentials) {
				if (!credentials?.email || !credentials?.password) return null
				const [user] = await getDb()
					.select({
						id: users.id,
						email: users.email,
						name: users.name,
						password: users.password,
						sessionVersion: users.sessionVersion,
					})
					.from(users)
					.where(eq(users.email, credentials.email))
					.limit(1)
				if (!user) return null
				if (!(await verifyPassword(credentials.password, user.password))) return null
				return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion }
			},
		}),
	],
	session: { strategy: 'jwt' },
	pages: { signIn: '/login' },
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.id = user.id
				token.sessionVersion = user.sessionVersion
				return token
			}
			if (token.id) {
				const [row] = await getDb()
					.select({ sessionVersion: users.sessionVersion })
					.from(users)
					.where(eq(users.id, token.id))
					.limit(1)
				if (!row || row.sessionVersion !== token.sessionVersion) {
					const { id: _id, sessionVersion: _version, ...rest } = token
					return rest
				}
			}
			return token
		},
		session({ session, token }) {
			if (token.id) session.user.id = token.id
			return session
		},
	},
}
```

- [ ] **Step 7: `lib/auth/session.ts`**

```ts
import 'server-only'

import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { authOptions } from './options'

/** The signed-in account as the server code sees it; `email` is the Dify end-user id (ADR-0006). */
export interface SessionUser {
	id: string
	email: string
	name: string | null
}

export type AuthErrorCode = 'unauthorized' | 'forbidden'

/** Thrown by requireActor (and, from B2 on, requireAdmin); actions map it to their result code. */
export class AuthError extends Error {
	constructor(public readonly code: AuthErrorCode) {
		super(code)
		this.name = 'AuthError'
	}
}

/**
 * One getServerSession per server render: the root layout (SessionProvider) and a group layout or page share
 * it (React cache dedupes within a render pass; it does not dedupe inside Route Handlers, which call it once).
 */
export const getCachedServerSession = cache(() => getServerSession(authOptions))

/**
 * The signed-in account, or null: no session, or a revoked JWT, which decodes but carries no user.id
 * (lib/auth/options.ts jwt callback; ADR-0018).
 */
export async function verifySession(): Promise<SessionUser | null> {
	const session = await getCachedServerSession()
	const user = session?.user
	if (!user?.id || !user.email) return null
	return { id: user.id, email: user.email, name: user.name ?? null }
}

/**
 * For layouts and pages: the account, or a redirect to /login. The proxy already redirects signed-out page
 * requests with a callbackUrl (a layout cannot read the pathname); this catches revoked JWTs. Call it outside
 * any try/catch, since redirect() works by throwing (ADR-0018).
 */
export async function requireUser(): Promise<SessionUser> {
	const user = await verifySession()
	if (!user) redirect('/login')
	return user
}

/** For Server Actions and the DAL's callers: the account, or AuthError('unauthorized') (charter §4.2). */
export async function requireActor(): Promise<SessionUser> {
	const user = await verifySession()
	if (!user) throw new AuthError('unauthorized')
	return user
}

/** For the login-adjacent pages: a visitor with a live session is sent on instead of seeing the form. */
export async function redirectSignedInUser(to = '/apps'): Promise<void> {
	if (await verifySession()) redirect(to)
}
```

- [ ] **Step 8: The shim for the old routes**

Replace `lib/session-user.ts` with (deleted in Task 17 together with `app/api/client/**`):

```ts
// Temporary: the old app/api/client/** routes use these names until Task 17 deletes both. New code imports lib/auth/session.
import { NextResponse } from 'next/server'

import { requireUser, verifySession } from '@/lib/auth/session'

export { getCachedServerSession, redirectSignedInUser } from '@/lib/auth/session'

export async function getSessionUserId(): Promise<string | null> {
	return (await verifySession())?.email ?? null
}

export function unauthorizedResponse() {
	return NextResponse.json(
		{ code: 'unauthorized', message: 'Sign in required.', status: 401 },
		{ status: 401 },
	)
}

export async function requireSessionUser(): Promise<void> {
	await requireUser()
}
```

- [ ] **Step 9: Move the importers**

Apply these edits exactly:

- `app/layout.tsx`: `import { getCachedServerSession } from '@/lib/session-user'` → `import { getCachedServerSession } from '@/lib/auth/session'`.
- `app/(user)/layout.tsx` and `app/(admin)/layout.tsx`: `import { requireSessionUser } from '@/lib/session-user'` → `import { requireUser } from '@/lib/auth/session'`, and `await requireSessionUser()` → `await requireUser()`.
- `app/(user)/apps/page.tsx` and `app/(admin)/app-management/page.tsx`: the same two replacements (these pages are rewritten in Task 16; only the import changes here).
- `app/(admin)/user-management/page.tsx`:

```tsx
import UserManagement from '@/components/admin/users/user-management'
import { toUserRows } from '@/components/admin/users/user-row'
import { requireUser } from '@/lib/auth/session'
import { listUsers } from '@/lib/data/users'

/** Spec §6 of sub-project 3: the signed-in user's database id hides their own Delete. */
export default async function UserManagementPage() {
	const user = await requireUser()
	const users = await listUsers()
	return (
		<UserManagement
			users={toUserRows(users)}
			currentUserId={user.id}
		/>
	)
}
```

- `app/(auth)/login/layout.tsx` and `app/(auth)/forgot-password/layout.tsx`: `from '@/lib/session-user'` → `from '@/lib/auth/session'`.
- `app/api/auth/[...nextauth]/route.ts`: `from '@/lib/auth'` → `from '@/lib/auth/options'`.
- `app/api/users/route.ts`, `app/api/users/[id]/route.ts`: `import { authOptions } from '@/lib/auth'` → `import { authOptions } from '@/lib/auth/options'`; `import bcrypt from 'bcryptjs'` → `import { hashPassword } from '@/lib/auth/password'` and each `await bcrypt.hash(password, 12)` → `await hashPassword(password)`.
- `app/api/init/route.ts`: the same bcrypt replacement.
- `app/api/auth/forgot-password/route.ts`: `import { createPasswordResetToken } from '@/lib/password-reset'` → `import { createPasswordResetToken } from '@/lib/auth/password'`.
- `app/api/auth/reset-password/route.ts`: `import { hashPasswordResetToken } from '@/lib/password-reset'` → `import { hashPasswordResetToken } from '@/lib/auth/password'`; `import bcrypt from 'bcryptjs'` → `import { hashPassword } from '@/lib/auth/password'` (one import line for both) and `await bcrypt.hash(password, 12)` → `await hashPassword(password)`.

Then delete the old modules and the old test:

```bash
git rm lib/auth.ts lib/password-reset.ts __tests__/session-user.test.ts
```

- [ ] **Step 10: The proxy's 401 envelope**

In `proxy.ts` replace the API refusal:

```ts
			if (isApiPath(decoded)) {
				return NextResponse.json(
					{ code: 'unauthorized', message: 'Sign in required.', status: 401 },
					{ status: 401 },
				)
			}
```

Replace the Chinese comments in the file with English ones (`// Classify by the decoded path (Next matches routes on the decoded path too)`, `// Site-wide gate: every page but the public ones needs a session; APIs are denied by default`, `console.error('Init status check failed:', error)`, `// A failed check must not block the page; the pages handle it`). Try removing the `// @ts-expect-error next-auth v4 jwt type resolution` line above `import { getToken } from 'next-auth/jwt'`; run `pnpm exec tsc --noEmit`; if the import then errors, restore the directive with the error's wording as its reason (charter §4.5).

In `__tests__/proxy.test.ts` change the three `toEqual({ error: 'Unauthorized' })` to `toEqual({ code: 'unauthorized', message: 'Sign in required.', status: 401 })`.

- [ ] **Step 11: Update the tests that mock `@/lib/session-user`**

`grep -ln "lib/session-user" __tests__` lists them (`group-layouts.test.ts`, `apps-page.test.ts`, `app-management-page.test.ts`, `user-management-page.test.ts`, `auth-page-layouts.test.ts`, `root-page.test.ts`, …). In each, change the mock path to `@/lib/auth/session` and the mocked name `requireSessionUser` to `requireUser` (and `redirectSignedInUser` stays); where a test asserted `getCachedServerSession` for the user-management page, it now asserts `requireUser` resolving `{ id: 'u1', … }` and the prop `currentUserId: 'u1'`. Run `pnpm test` and fix each until green; the behaviour under test is unchanged.

- [ ] **Step 12: Verify and commit**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint lib/auth proxy.ts app && pnpm exec oxfmt --write lib/auth types/next-auth.d.ts proxy.ts lib/session-user.ts __tests__/auth-session.test.ts __tests__/auth-options.test.ts && pnpm test`
Expected: green. Then `pnpm exec playwright test e2e/auth.spec.ts e2e/ssr-first-paint.spec.ts` (the proxy, the layouts and the reset flow): green on all three projects.

```bash
git add types/next-auth.d.ts lib/auth lib/session-user.ts proxy.ts app __tests__
git commit -m "feat(auth): typed next-auth options and session helpers under lib/auth, the 401 envelope

types/next-auth.d.ts becomes a module augmentation; lib/auth/options.ts is a typed NextAuthOptions whose jwt callback strips the claims of a revoked token instead of returning null; lib/auth/session.ts holds verifySession, requireUser (redirect), requireActor (AuthError) and redirectSignedInUser; lib/auth/password.ts the bcrypt and reset-token helpers. lib/session-user.ts is a shim for the old proxy routes until Task 17. The proxy answers APIs with Dify's envelope (charter §4.1).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 3: Dify contracts, the error envelope, the action result

Charter §4.1 "Server client" (types from the endpoint map), §4.1 "Contract to the browser", §4.5 "Action results". Source of every shape: `docs/dify-service-api-1.17.1.md` §1 to §4.

**Files:**
- Create: `lib/dify/types/app.ts`, `lib/dify/types/files.ts`, `lib/dify/types/chat.ts`, `lib/dify/types/workflow.ts`, `lib/dify/types/human-input.ts`, `lib/dify/types/annotations.ts`, `lib/dify/types/events.ts`, `lib/dify/types/index.ts`
- Create: `lib/dify/errors.ts`, `lib/action-result.ts`, `lib/action-failure.ts`
- Test: `__tests__/dify-errors.test.ts`, `__tests__/action-failure.test.ts`

**Interfaces:**
- Produces (types): `AppMode`, `APP_MODES`, `isAppMode`, `CHAT_MODES`, `RUN_MODES`, `AppInfo`, `AppParameters`, `UserInputFormItem`, `UserInputControlType`, `UserInputFieldConfig`, `SiteSettings`, `AppMeta`, `FileType`, `TransferMethod`, `FileInput`, `FileUploadResponse`, `ChatMessageRequest`, `ResponseMode`, `RetrieverResource`, `AgentThought`, `ConversationItem`, `ConversationsPage`, `ConversationsQuery`, `RenameConversationRequest`, `MessagesQuery`, `MessageFileItem`, `MessageListItem`, `MessagesPage`, `SuggestedQuestionsResponse`, `FeedbackRating`, `FeedbackRequest`, `StopResponse`, `CompletionRequest`, `WorkflowRunRequest`, `WorkflowEventsQuery`, `TextToAudioRequest`, `HumanInputField`, `HumanInputAction`, `HumanInputForm`, `HumanInputSubmission`, `HumanInputFileMapping`, `HumanInputFormDefinition`, `HumanInputFormSubmission`, `HumanInputContent`, `AnnotationItem`, `AnnotationsQuery`, `AnnotationsPage`, `AnnotationInput`, `STREAM_EVENTS`, `StreamEventName`, `StreamEventBase`, `StreamErrorEvent`.
- Produces (errors): `DifyErrorBody`, `class DifyError extends Error { status: number; code: string; toBody() }`, `isDifyErrorBody(value)`, `difyErrorResponse(code, message, status): Response`, `difyErrorFromResponse(response): Promise<DifyError>`, `errorResponseFrom(error, context): Response`.
- Produces (actions): `ActionErrorCode`, `ActionFailure`, `ActionResult<T>`, `ok(data)`, `fail(code, fieldErrors?)`, `toActionFailure(error, context): ActionFailure`.

- [ ] **Step 1: Write the failing error tests**

Create `__tests__/dify-errors.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '@/lib/auth/session'
import {
	DifyError,
	difyErrorFromResponse,
	difyErrorResponse,
	errorResponseFrom,
	isDifyErrorBody,
} from '@/lib/dify/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('isDifyErrorBody', () => {
	it('accepts Dify’s envelope and nothing else', () => {
		expect(isDifyErrorBody({ code: 'not_found', message: 'Nope', status: 404 })).toBe(true)
		expect(isDifyErrorBody({ code: 'not_found', message: 'Nope' })).toBe(false)
		expect(isDifyErrorBody({ error: 'x' })).toBe(false)
		expect(isDifyErrorBody('nope')).toBe(false)
		expect(isDifyErrorBody(null)).toBe(false)
	})
})

describe('difyErrorFromResponse', () => {
	it("keeps Dify's code and message, with the HTTP status", async () => {
		const error = await difyErrorFromResponse(
			jsonResponse(412, { code: 'human_input_form_expired', message: 'Expired.', status: 412 }),
		)
		expect(error).toBeInstanceOf(DifyError)
		expect(error).toMatchObject({ status: 412, code: 'human_input_form_expired', message: 'Expired.' })
	})
	// Review Focus 1: a reverse proxy's HTML page, an empty body, a JSON body that is not the envelope.
	it('maps a non-JSON or non-envelope body to upstream_error with the status', async () => {
		const html = await difyErrorFromResponse(
			new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
		)
		expect(html).toMatchObject({ status: 502, code: 'upstream_error', message: 'Dify answered 502' })
		const empty = await difyErrorFromResponse(new Response(null, { status: 500 }))
		expect(empty).toMatchObject({ status: 500, code: 'upstream_error' })
		const other = await difyErrorFromResponse(jsonResponse(400, { message: 'Just text' }))
		expect(other).toMatchObject({ status: 400, code: 'upstream_error', message: 'Just text' })
	})
})

describe('difyErrorResponse and errorResponseFrom', () => {
	it('answers the envelope with the status', async () => {
		const response = difyErrorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({ code: 'app_not_found', message: 'No such app.', status: 404 })
	})
	it('turns a DifyError into its envelope', async () => {
		const response = errorResponseFrom(new DifyError(429, 'too_many_requests', 'Slow down'), 'test')
		expect(response.status).toBe(429)
		await expect(response.json()).resolves.toEqual({ code: 'too_many_requests', message: 'Slow down', status: 429 })
	})
	it('turns an AuthError into 401 or 403', async () => {
		expect(errorResponseFrom(new AuthError('unauthorized'), 'test').status).toBe(401)
		expect(errorResponseFrom(new AuthError('forbidden'), 'test').status).toBe(403)
	})
	it('logs anything else and answers 500 internal_error without the message', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const response = errorResponseFrom(new Error('secret detail'), 'POST chat')
		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(spy).toHaveBeenCalledWith('POST chat:', expect.any(Error))
		spy.mockRestore()
	})
})
```

Create `__tests__/action-failure.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { fail, ok } from '@/lib/action-result'
import { toActionFailure } from '@/lib/action-failure'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

describe('ActionResult helpers', () => {
	it('builds results', () => {
		expect(ok({ id: '1' })).toEqual({ ok: true, data: { id: '1' } })
		expect(fail('not_found')).toEqual({ ok: false, code: 'not_found' })
		expect(fail('invalid_input', { apiBase: ['Required'] })).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { apiBase: ['Required'] },
		})
	})
})

describe('toActionFailure', () => {
	it('maps AuthError to its code', () => {
		expect(toActionFailure(new AuthError('forbidden'), 'x')).toEqual({ ok: false, code: 'forbidden' })
	})
	it('maps any DifyError to dify_unreachable (the admin cannot fix Dify’s wording)', () => {
		expect(toActionFailure(new DifyError(401, 'unauthorized', 'bad key'), 'x')).toEqual({
			ok: false,
			code: 'dify_unreachable',
		})
	})
	it('logs and maps anything else to operation_failed', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(toActionFailure(new Error('db down'), 'createApp')).toEqual({ ok: false, code: 'operation_failed' })
		expect(spy).toHaveBeenCalledWith('createApp:', expect.any(Error))
		spy.mockRestore()
	})
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/dify-errors.test.ts __tests__/action-failure.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: The contract types**

`lib/dify/types/files.ts`:

```ts
/** Dify's file categories (endpoint map §2.1, §2.2). */
export type FileType = 'document' | 'image' | 'audio' | 'video' | 'custom'

export type TransferMethod = 'remote_url' | 'local_file'

export interface RemoteFileInput {
	type: FileType
	transfer_method: 'remote_url'
	url?: string
	/** legacy alias of url */
	remote_url?: string
	/** accepted beside remote_url for persisted references */
	upload_file_id?: string
}

export interface LocalFileInput {
	type: FileType
	transfer_method: 'local_file'
	upload_file_id: string
}

/** A `files[]` item of chat, completion and workflow requests (endpoint map §2.2). */
export type FileInput = RemoteFileInput | LocalFileInput

/** POST /files/upload, 201 (endpoint map §1.6). */
export interface FileUploadResponse {
	id: string
	name: string
	size: number
	extension: string | null
	mime_type: string
	created_by: string | null
	created_at: number
	preview_url?: string | null
	source_url?: string | null
	original_url?: string | null
	conversation_id?: string | null
}
```

`lib/dify/types/app.ts`:

```ts
import type { FileType, TransferMethod } from './files'

/** Dify 1.17.1 app modes served by the Service API (endpoint map, Conventions). `agent` is the new Agent app, SSE only. */
export const APP_MODES = ['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion', 'agent'] as const
export type AppMode = (typeof APP_MODES)[number]

export const isAppMode = (value: unknown): value is AppMode =>
	typeof value === 'string' && (APP_MODES as readonly string[]).includes(value)

/** The chat family of /chat-messages (source gate `not_chat_app`). */
export const CHAT_MODES: readonly AppMode[] = ['chat', 'agent-chat', 'advanced-chat', 'agent']
/** The run family of /workflows/run and /completion-messages. */
export const RUN_MODES: readonly AppMode[] = ['workflow', 'completion']

/** GET /info (endpoint map §1.1). */
export interface AppInfo {
	name: string
	description: string
	tags: string[]
	mode: AppMode
	author_name?: string | null
}

/** The nine control types of `user_input_form` (endpoint map §2.1). */
export type UserInputControlType =
	| 'text-input'
	| 'paragraph'
	| 'select'
	| 'number'
	| 'external_data_tool'
	| 'file'
	| 'file-list'
	| 'checkbox'
	| 'json_object'

export interface UserInputFieldConfig {
	variable: string
	label: string
	description?: string | null
	required?: boolean
	hide?: boolean
	default?: unknown
	type?: string
	max_length?: number | null
	options?: string[]
	allowed_file_types?: FileType[]
	allowed_file_extensions?: string[]
	allowed_file_upload_methods?: TransferMethod[]
	json_schema?: unknown
	config?: unknown
}

/** One `user_input_form` item: a single-key object keyed by its control type. */
export type UserInputFormItem = Partial<Record<UserInputControlType, UserInputFieldConfig>>

export interface FileUploadConfig {
	enabled?: boolean
	number_limits?: number
	allowed_file_types?: FileType[]
	allowed_file_extensions?: string[]
	allowed_file_upload_methods?: TransferMethod[]
	/** legacy image block, still sent */
	image?: {
		enabled?: boolean
		number_limits?: number
		detail?: string
		transfer_methods?: TransferMethod[]
	}
}

/** GET /parameters (endpoint map §1.1, §2.1). */
export interface AppParameters {
	opening_statement?: string | null
	suggested_questions?: string[]
	suggested_questions_after_answer?: { enabled: boolean }
	speech_to_text?: { enabled: boolean }
	text_to_speech?: { enabled: boolean; voice?: string; language?: string; autoPlay?: 'enabled' | 'disabled' }
	retriever_resource?: { enabled: boolean }
	annotation_reply?: { enabled: boolean }
	more_like_this?: { enabled: boolean }
	user_input_form: UserInputFormItem[]
	sensitive_word_avoidance?: { enabled: boolean }
	file_upload?: FileUploadConfig
	system_parameters?: {
		image_file_size_limit?: number
		video_file_size_limit?: number
		audio_file_size_limit?: number
		file_size_limit?: number
		workflow_file_upload_limit?: number
	}
}

/** GET /site (endpoint map §1.1). `icon_url` for an image icon is a signed link that expires (charter §4.4). */
export interface SiteSettings {
	title: string
	chat_color_theme?: string | null
	chat_color_theme_inverted?: boolean
	icon_type?: 'emoji' | 'image' | null
	icon?: string | null
	icon_background?: string | null
	icon_url?: string | null
	description?: string | null
	copyright?: string | null
	privacy_policy?: string | null
	input_placeholder?: string | null
	custom_disclaimer?: string | null
	default_language?: string | null
	show_workflow_steps?: boolean
	use_icon_as_answer_icon?: boolean
}

/** GET /meta. */
export interface AppMeta {
	tool_icons: Record<string, string | { background: string; content: string }>
}
```

`lib/dify/types/human-input.ts`:

```ts
import type { FileType, TransferMethod } from './files'

export interface HumanInputDefault {
	type: 'constant' | 'variable' | string
	selector?: string[]
	value?: string
}

/** A form input; the select options and file restrictions are documented on GET /form/human_input (map §1.5). */
export interface HumanInputField {
	type: 'paragraph' | 'select' | 'file' | 'file-list' | string
	output_variable_name: string
	default?: HumanInputDefault | null
	option_source?: { type: string; value?: string[]; selector?: string[] }
	allowed_file_types?: FileType[]
	allowed_file_extensions?: string[]
	allowed_file_upload_methods?: TransferMethod[]
	number_limits?: number
}

export interface HumanInputAction {
	id: string
	title: string
	button_style: 'primary' | 'default' | 'accent' | 'ghost' | string
}

/** GET /form/human_input/{form_token}. */
export interface HumanInputForm {
	form_content: string
	inputs: HumanInputField[]
	resolved_default_values: Record<string, string>
	user_actions: HumanInputAction[]
	/** unix seconds */
	expiration_time: number
}

export type HumanInputFileMapping =
	| { transfer_method: 'local_file'; upload_file_id: string; type?: FileType }
	| { transfer_method: 'remote_url'; url?: string; remote_url?: string; type?: FileType }

/** POST /form/human_input/{form_token} body, without `user` (set by the route). */
export interface HumanInputSubmission {
	inputs: Record<string, string | HumanInputFileMapping | HumanInputFileMapping[]>
	action: string
}

/** `form_definition` of a history `extra_contents` item (OpenAPI HumanInputFormDefinition). */
export interface HumanInputFormDefinition {
	form_id?: string
	node_id?: string
	node_title?: string
	form_content?: string
	inputs?: HumanInputField[]
	actions?: HumanInputAction[]
	display_in_ui?: boolean
	form_token?: string | null
	resolved_default_values?: Record<string, string>
	expiration_time?: number
}

export interface HumanInputFormSubmission {
	node_id?: string
	node_title?: string
	rendered_content?: string
	action_id?: string
	action_text?: string
}

/** An `extra_contents` item of GET /messages (OpenAPI HumanInputContent). */
export interface HumanInputContent {
	type: string
	workflow_run_id?: string
	submitted?: boolean
	form_definition?: HumanInputFormDefinition | null
	form_submission_data?: HumanInputFormSubmission | null
}
```

`lib/dify/types/chat.ts`:

```ts
import type { FileInput } from './files'
import type { HumanInputContent } from './human-input'

export type ResponseMode = 'streaming' | 'blocking'

/** POST /chat-messages body without `user` (endpoint map §1.2). */
export interface ChatMessageRequest {
	query: string
	inputs: Record<string, unknown>
	files?: FileInput[]
	response_mode?: ResponseMode
	conversation_id?: string
	auto_generate_name?: boolean
	/** advanced-chat only: run a published version */
	workflow_id?: string
}

export interface RetrieverResource {
	id?: string
	message_id?: string
	position: number
	dataset_id: string
	dataset_name: string
	document_id: string
	document_name: string
	data_source_type?: string
	segment_id: string
	score: number
	hit_count?: number
	word_count?: number
	segment_position?: number
	index_node_hash?: string
	content: string
	created_at?: number
}

/** An `agent_thought` event payload, and an `agent_thoughts[]` item of GET /messages (the history adds chain_id and files). */
export interface AgentThought {
	id: string
	message_id: string
	task_id?: string
	conversation_id?: string
	position: number
	thought: string
	tool: string
	tool_labels?: Record<string, unknown> | null
	tool_input: string
	observation: string
	message_files?: string[]
	files?: string[]
	chain_id?: string | null
	created_at: number
}

export interface ConversationItem {
	id: string
	name: string
	inputs: Record<string, unknown>
	status: string
	introduction: string
	created_at: number
	updated_at: number
}

export interface ConversationsQuery {
	last_id?: string
	limit?: number
	sort_by?: 'created_at' | '-created_at' | 'updated_at' | '-updated_at'
}

export interface ConversationsPage {
	limit: number
	has_more: boolean
	data: ConversationItem[]
}

export interface RenameConversationRequest {
	name?: string
	auto_generate?: boolean
}

export interface MessagesQuery {
	conversation_id: string
	first_id?: string
	limit?: number
}

/** A `message_files[]` item of GET /messages (OpenAPI MessageFileItem). */
export interface MessageFileItem {
	id: string
	type: string
	url: string | null
	belongs_to: string | null
	filename: string
	mime_type: string | null
	size: number | null
	transfer_method: string
	upload_file_id: string | null
}

/** One item of GET /messages (endpoint map §1.2). */
export interface MessageListItem {
	id: string
	conversation_id: string
	parent_message_id?: string | null
	inputs: Record<string, unknown>
	query: string
	answer: string
	feedback?: { rating: 'like' | 'dislike' } | null
	retriever_resources?: RetrieverResource[]
	created_at: number
	agent_thoughts?: AgentThought[]
	message_files?: MessageFileItem[]
	message_tokens?: number
	answer_tokens?: number
	total_tokens?: number
	provider_response_latency?: number
	total_price?: string
	currency?: string
	/** `normal`, or `error` when generation failed */
	status: string
	error?: string | null
	extra_contents?: HumanInputContent[]
}

export interface MessagesPage {
	limit: number
	has_more: boolean
	data: MessageListItem[]
}

export interface SuggestedQuestionsResponse {
	result: 'success'
	data: string[]
}

export type FeedbackRating = 'like' | 'dislike' | null

export interface FeedbackRequest {
	rating: FeedbackRating
	content?: string
}

/** The three stop endpoints and message feedback answer this (endpoint map §1.2, §6). */
export interface StopResponse {
	result: 'success'
}
```

`lib/dify/types/workflow.ts`:

```ts
import type { ResponseMode } from './chat'
import type { FileInput } from './files'

/** POST /completion-messages body without `user` (endpoint map §1.3). */
export interface CompletionRequest {
	inputs: Record<string, unknown>
	query?: string
	files?: FileInput[]
	response_mode?: ResponseMode
}

/** POST /workflows/run body without `user` (endpoint map §1.4). */
export interface WorkflowRunRequest {
	inputs: Record<string, unknown>
	files?: FileInput[]
	response_mode?: ResponseMode
}

/** GET /workflow/{workflow_run_id}/events query without `user`. */
export interface WorkflowEventsQuery {
	include_state_snapshot?: boolean
	continue_on_pause?: boolean
}

/** POST /text-to-audio body without `user` (endpoint map §1.6). */
export interface TextToAudioRequest {
	message_id?: string
	text?: string
	voice?: string
}
```

`lib/dify/types/annotations.ts`:

```ts
export interface AnnotationItem {
	id: string
	question: string
	answer: string
	hit_count: number
	created_at: number
}

export interface AnnotationsQuery {
	page?: number
	limit?: number
	keyword?: string
}

export interface AnnotationsPage {
	data: AnnotationItem[]
	has_more: boolean
	limit: number
	total: number
	page: number
}

export interface AnnotationInput {
	question: string
	answer: string
}
```

`lib/dify/types/events.ts`:

```ts
/** The 29 stream event names of Dify 1.17.1 (`StreamEvent` enum; endpoint map §3). */
export const STREAM_EVENTS = [
	'ping', 'error', 'message', 'message_end', 'tts_message', 'tts_message_end', 'message_file',
	'message_replace', 'agent_thought', 'agent_message', 'workflow_started', 'workflow_paused',
	'workflow_finished', 'node_started', 'node_finished', 'node_retry', 'iteration_started',
	'iteration_next', 'iteration_completed', 'loop_started', 'loop_next', 'loop_completed', 'text_chunk',
	'text_replace', 'reasoning_chunk', 'agent_log', 'human_input_required', 'human_input_form_filled',
	'human_input_form_timeout',
] as const
export type StreamEventName = (typeof STREAM_EVENTS)[number]

/** Fields every `data:` payload may carry; the rest is per event (the chat's DifyStreamEvent widens this). */
export interface StreamEventBase {
	event: StreamEventName | string
	task_id?: string
	message_id?: string
	conversation_id?: string
	created_at?: number
	workflow_run_id?: string
}

/** A mid-stream failure; the HTTP status stays 200 (endpoint map §4). */
export interface StreamErrorEvent extends StreamEventBase {
	event: 'error'
	status: number
	code: string
	message: string
}
```

`lib/dify/types/index.ts`:

```ts
export * from './annotations'
export * from './app'
export * from './chat'
export * from './events'
export * from './files'
export * from './human-input'
export * from './workflow'
```

- [ ] **Step 4: `lib/dify/errors.ts`**

```ts
import 'server-only'

import { AuthError } from '@/lib/auth/session'

/** Dify's error envelope (endpoint map §4), also the app's own refusal shape (charter §4.1). */
export interface DifyErrorBody {
	code: string
	message: string
	status: number
}

export class DifyError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message)
		this.name = 'DifyError'
	}

	toBody(): DifyErrorBody {
		return { code: this.code, message: this.message, status: this.status }
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const isDifyErrorBody = (value: unknown): value is DifyErrorBody =>
	isRecord(value) &&
	typeof value.code === 'string' &&
	typeof value.message === 'string' &&
	typeof value.status === 'number'

/** The app's own refusal in Dify's envelope. */
export const difyErrorResponse = (code: string, message: string, status: number): Response =>
	Response.json({ code, message, status } satisfies DifyErrorBody, { status })

/**
 * A non-OK upstream answer as a DifyError: Dify's code and message when the body is its envelope (the HTTP
 * status is authoritative), `upstream_error` with the status otherwise — an HTML page from a reverse proxy, an
 * empty body, a JSON body of another shape (Review Focus 1).
 */
export const difyErrorFromResponse = async (response: Response): Promise<DifyError> => {
	let body: unknown = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	if (isDifyErrorBody(body)) return new DifyError(response.status, body.code, body.message)
	const message =
		isRecord(body) && typeof body.message === 'string'
			? body.message
			: `Dify answered ${response.status}`
	return new DifyError(response.status, 'upstream_error', message)
}

/**
 * What a route answers for an exception: a DifyError's envelope (Dify's, or the client's upstream_unreachable),
 * an AuthError's 401/403, else a logged 500 whose body carries no detail (Backend for Frontend guide: no
 * sensitive information in error messages).
 */
export const errorResponseFrom = (error: unknown, context: string): Response => {
	if (error instanceof DifyError) return difyErrorResponse(error.code, error.message, error.status)
	if (error instanceof AuthError) {
		return error.code === 'forbidden'
			? difyErrorResponse('forbidden', 'Not allowed.', 403)
			: difyErrorResponse('unauthorized', 'Sign in required.', 401)
	}
	console.error(`${context}:`, error)
	return difyErrorResponse('internal_error', 'Internal Server Error', 500)
}
```

- [ ] **Step 5: `lib/action-result.ts` (client-safe) and `lib/action-failure.ts` (server)**

`lib/action-result.ts`:

```ts
/** The codes a Server Action can answer with; the client maps each to a translation key (charter §4.5). */
export type ActionErrorCode =
	| 'unauthorized'
	| 'forbidden'
	| 'invalid_input'
	| 'email_in_use'
	| 'last_admin'
	| 'cannot_delete_self'
	| 'not_found'
	| 'dify_unreachable'
	| 'operation_failed'

export interface ActionFailure {
	ok: false
	code: ActionErrorCode
	/** `invalid_input` only: zod's flattened field errors, keyed by field path. */
	fieldErrors?: Record<string, string[]>
}

export type ActionResult<T = undefined> = { ok: true; data: T } | ActionFailure

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data })

export const fail = (code: ActionErrorCode, fieldErrors?: Record<string, string[]>): ActionFailure =>
	fieldErrors ? { ok: false, code, fieldErrors } : { ok: false, code }
```

`lib/action-failure.ts`:

```ts
import 'server-only'

import { fail, type ActionFailure } from '@/lib/action-result'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

/**
 * An exception inside an action as its failure result (charter §4.5: two vocabularies on purpose — a DifyError
 * becomes dify_unreachable, never a raw envelope). Unexpected errors are logged with their context.
 */
export const toActionFailure = (error: unknown, context: string): ActionFailure => {
	if (error instanceof AuthError) return fail(error.code)
	if (error instanceof DifyError) return fail('dify_unreachable')
	console.error(`${context}:`, error)
	return fail('operation_failed')
}
```

- [ ] **Step 6: Run the tests, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-errors.test.ts __tests__/action-failure.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint lib/dify lib/action-result.ts lib/action-failure.ts && pnpm exec oxfmt --write lib/dify lib/action-result.ts lib/action-failure.ts __tests__/dify-errors.test.ts __tests__/action-failure.test.ts`
Expected: green.

```bash
git add lib/dify lib/action-result.ts lib/action-failure.ts __tests__/dify-errors.test.ts __tests__/action-failure.test.ts
git commit -m "feat(dify): contract types from the 1.17.1 endpoint map, the error envelope, the action result

lib/dify/types holds every request, response and event shape the routes and the browser share (docs/dify-service-api-1.17.1.md); lib/dify/errors.ts maps upstream answers to DifyError and answers the app's own refusals in Dify's envelope; lib/action-result.ts and lib/action-failure.ts are the Server Action result contract (charter §4.1, §4.5).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 4: The server client `lib/dify/client.ts`

Charter §4.1 "Server client". Source: `docs/dify-service-api-1.17.1.md` §1 (paths, verbs, `user` column), §4.

**Files:**
- Create: `lib/dify/client.ts`
- Test: `__tests__/dify-client.test.ts`

**Interfaces:**
- Produces: `interface DifyCredentials { apiBase: string; apiKey: string }`; `difyClient(credentials): DifyClient`; `type DifyClient`; `passthrough(upstream: Response): Response`. Method list and signatures in Step 3; every JSON method resolves the typed body and rejects with `DifyError`; `chatMessages`, `completionMessages`, `runWorkflow`, `workflowEvents`, `filePreview`, `textToAudio`, `fetchRemoteFile` resolve the upstream `Response` (OK only; a non-OK answer rejects with `DifyError`).

- [ ] **Step 1: Write the failing client tests**

Create `__tests__/dify-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { DifyError } from '@/lib/dify/errors'
import { difyClient, passthrough } from '@/lib/dify/client'

const credentials = { apiBase: 'http://dify.local/v1/', apiKey: 'app-key' }
const USER = 'jane@example.com'
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
	return { url, init, headers: new Headers(init?.headers) }
}

describe('difyClient: addressing and authentication', () => {
	it('trims the base slash, appends the path and sends the bearer header', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { name: 'A', mode: 'chat', description: '', tags: [] }))
		await expect(difyClient(credentials).getInfo()).resolves.toMatchObject({ name: 'A' })
		const { url, headers } = lastCall()
		expect(url).toBe('http://dify.local/v1/info')
		expect(headers.get('authorization')).toBe('Bearer app-key')
	})
})

describe('difyClient: where `user` goes (endpoint map §1, the `user` column)', () => {
	it('JSON body: chat, stops, feedback, rename, delete, human input, text-to-audio', async () => {
		const client = difyClient(credentials)
		fetchMock.mockResolvedValue(jsonResponse(200, {}, { 'content-type': 'text/event-stream' }))
		await client.chatMessages({ query: 'hi', inputs: {}, response_mode: 'streaming' }, USER)
		expect(JSON.parse(String(lastCall().init.body))).toEqual({
			query: 'hi',
			inputs: {},
			response_mode: 'streaming',
			user: USER,
		})
		expect(lastCall().headers.get('content-type')).toBe('application/json')

		fetchMock.mockResolvedValue(jsonResponse(200, { result: 'success' }))
		await client.stopChat('task-1', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/chat-messages/task-1/stop')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ user: USER })
		await client.stopCompletion('task-2', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/completion-messages/task-2/stop')
		await client.stopWorkflow('task-3', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/workflows/tasks/task-3/stop')
		await client.createFeedback('m1', { rating: 'like', content: '' }, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/messages/m1/feedbacks')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ rating: 'like', content: '', user: USER })

		fetchMock.mockResolvedValue(jsonResponse(200, { id: 'c1', name: 'New' }))
		await client.renameConversation('c1', { auto_generate: true }, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/conversations/c1/name')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ auto_generate: true, user: USER })

		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		await expect(client.deleteConversation('c1', USER)).resolves.toBeUndefined()
		expect(lastCall().init.method).toBe('DELETE')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ user: USER })

		fetchMock.mockResolvedValue(jsonResponse(200, {}))
		await expect(
			client.submitHumanInput('tok', { inputs: { feedback: 'ok' }, action: 'approve' }, USER),
		).resolves.toEqual({})
		expect(lastCall().url).toBe('http://dify.local/v1/form/human_input/tok')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({
			inputs: { feedback: 'ok' },
			action: 'approve',
			user: USER,
		})

		fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/wav' } }))
		await client.textToAudio({ text: 'hello' }, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/text-to-audio')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ text: 'hello', user: USER })
	})

	it('query string: messages, suggested, conversations, workflow events, file preview', async () => {
		const client = difyClient(credentials)
		fetchMock.mockResolvedValue(jsonResponse(200, { data: [], has_more: false, limit: 20 }))
		await client.listMessages({ conversation_id: 'c1', first_id: 'm0', limit: 20 }, USER)
		expect(lastCall().url).toBe(
			'http://dify.local/v1/messages?conversation_id=c1&first_id=m0&limit=20&user=jane%40example.com',
		)
		expect(lastCall().init.method ?? 'GET').toBe('GET')
		await client.listConversations({ limit: 100, sort_by: '-updated_at' }, USER)
		expect(lastCall().url).toBe(
			'http://dify.local/v1/conversations?limit=100&sort_by=-updated_at&user=jane%40example.com',
		)
		fetchMock.mockResolvedValue(jsonResponse(200, { result: 'success', data: ['a'] }))
		await client.getSuggested('m1', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/messages/m1/suggested?user=jane%40example.com')
		fetchMock.mockResolvedValue(jsonResponse(200, {}, { 'content-type': 'text/event-stream' }))
		await client.workflowEvents('run-1', USER, {})
		expect(lastCall().url).toBe('http://dify.local/v1/workflow/run-1/events?user=jane%40example.com')
		fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }))
		await client.filePreview('f1', true, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/files/f1/preview?as_attachment=true&user=jane%40example.com')
	})

	it('multipart: upload and audio-to-text carry `file` and `user` parts', async () => {
		const client = difyClient(credentials)
		fetchMock.mockResolvedValue(jsonResponse(201, { id: 'f1', name: 'a.txt' }))
		const file = new File(['hello'], 'a.txt', { type: 'text/plain' })
		await expect(client.uploadFile(file, USER)).resolves.toMatchObject({ id: 'f1' })
		const form = lastCall().init.body as FormData
		expect(form).toBeInstanceOf(FormData)
		expect((form.get('file') as File).name).toBe('a.txt')
		expect(form.get('user')).toBe(USER)
		expect(lastCall().headers.get('content-type')).toBeNull()
		fetchMock.mockResolvedValue(jsonResponse(200, { text: 'hi' }))
		await expect(client.audioToText(new File(['x'], 'speech.webm', { type: 'audio/webm' }), USER)).resolves.toEqual({ text: 'hi' })
		expect(lastCall().url).toBe('http://dify.local/v1/audio-to-text')
	})

	it('no user: info, parameters, site, meta, human-input form, annotations', async () => {
		const client = difyClient(credentials)
		fetchMock.mockResolvedValue(jsonResponse(200, { user_input_form: [] }))
		await client.getParameters()
		expect(lastCall().url).toBe('http://dify.local/v1/parameters')
		fetchMock.mockResolvedValue(jsonResponse(200, { form_content: '', inputs: [], user_actions: [], resolved_default_values: {}, expiration_time: 0 }))
		await client.getHumanInputForm('tok')
		expect(lastCall().url).toBe('http://dify.local/v1/form/human_input/tok')
		fetchMock.mockResolvedValue(jsonResponse(200, { data: [], has_more: false, limit: 10, total: 0, page: 1 }))
		await client.listAnnotations({ page: 2, limit: 10, keyword: 'tea' })
		expect(lastCall().url).toBe('http://dify.local/v1/apps/annotations?page=2&limit=10&keyword=tea')
		fetchMock.mockResolvedValue(jsonResponse(201, { id: 'a1' }))
		await client.createAnnotation({ question: 'q', answer: 'a' })
		expect(lastCall().init.method).toBe('POST')
		await client.updateAnnotation('a1', { question: 'q', answer: 'b' })
		expect(lastCall().url).toBe('http://dify.local/v1/apps/annotations/a1')
		expect(lastCall().init.method).toBe('PUT')
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		await expect(client.deleteAnnotation('a1')).resolves.toBeUndefined()
	})
})

describe('difyClient: errors', () => {
	it("rejects with Dify's envelope on a non-OK answer", async () => {
		fetchMock.mockResolvedValue(jsonResponse(404, { code: 'not_found', message: 'Conversation Not Exists.', status: 404 }))
		const error = await difyClient(credentials).listMessages({ conversation_id: 'x' }, USER).catch(e => e)
		expect(error).toBeInstanceOf(DifyError)
		expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Conversation Not Exists.' })
	})
	// Review Focus 1
	it('rejects with upstream_error when an OK answer is not JSON on a JSON operation', async () => {
		fetchMock.mockResolvedValue(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
		await expect(difyClient(credentials).getInfo()).rejects.toMatchObject({ status: 200, code: 'upstream_error' })
	})
	it('rejects with upstream_unreachable (502) when fetch fails', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'))
		await expect(difyClient(credentials).getInfo()).rejects.toMatchObject({ status: 502, code: 'upstream_unreachable' })
	})
	it('passes a stream through with its status and meaningful headers only', async () => {
		const upstream = new Response('data: {}\n\n', {
			status: 200,
			headers: { 'content-type': 'text/event-stream', 'x-version': '1.17.1', 'set-cookie': 'a=b' },
		})
		const out = passthrough(upstream)
		expect(out.status).toBe(200)
		expect(out.headers.get('content-type')).toBe('text/event-stream')
		expect(out.headers.get('x-version')).toBeNull()
		expect(out.headers.get('set-cookie')).toBeNull()
		await expect(out.text()).resolves.toBe('data: {}\n\n')
	})
	it('fetches a remote file on the given URL with the bearer', async () => {
		fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '1' } }))
		const response = await difyClient(credentials).fetchRemoteFile(new URL('http://dify.local/files/tools/x.png?sign=1'))
		expect(lastCall().url).toBe('http://dify.local/files/tools/x.png?sign=1')
		expect(lastCall().headers.get('authorization')).toBe('Bearer app-key')
		expect(response.headers.get('content-type')).toBe('image/png')
	})
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/dify-client.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `lib/dify/client.ts`**

```ts
import 'server-only'

import { DifyError, difyErrorFromResponse } from './errors'
import type {
	AnnotationInput,
	AnnotationItem,
	AnnotationsPage,
	AnnotationsQuery,
	AppInfo,
	AppMeta,
	AppParameters,
	ChatMessageRequest,
	CompletionRequest,
	ConversationItem,
	ConversationsPage,
	ConversationsQuery,
	FeedbackRequest,
	FileUploadResponse,
	HumanInputForm,
	HumanInputSubmission,
	MessagesPage,
	MessagesQuery,
	RenameConversationRequest,
	SiteSettings,
	StopResponse,
	SuggestedQuestionsResponse,
	TextToAudioRequest,
	WorkflowEventsQuery,
	WorkflowRunRequest,
} from './types'

export interface DifyCredentials {
	/** The app's API base as Dify shows it, e.g. `https://host/v1`. */
	apiBase: string
	apiKey: string
}

/** The upstream headers a passthrough answer keeps (charter §4.1); everything else (cookies, X-Version) stays behind. */
const PASSTHROUGH_HEADERS = [
	'content-type',
	'content-disposition',
	'content-length',
	'accept-ranges',
	'cache-control',
] as const

type QueryValue = string | number | boolean | undefined

const queryString = (params: Record<string, QueryValue>) => {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) search.set(key, String(value))
	}
	const text = search.toString()
	return text ? `?${text}` : ''
}

const segment = (value: string) => encodeURIComponent(value)

const jsonInit = (method: 'POST' | 'PUT' | 'DELETE', body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
})

/**
 * The upstream Response as the route answers it: Dify's status, the body as it is (a stream stays a stream),
 * and the headers that carry meaning. No re-pumping through a hand-written ReadableStream (Backend for
 * Frontend guide, "Proxying to a backend").
 */
export const passthrough = (upstream: Response): Response => {
	const headers = new Headers()
	for (const name of PASSTHROUGH_HEADERS) {
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}
	return new Response(upstream.body, { status: upstream.status, headers })
}

export const difyClient = (credentials: DifyCredentials) => {
	const base = credentials.apiBase.replace(/\/+$/, '')

	/** One upstream call: the bearer header, a network failure as upstream_unreachable, a non-OK answer as DifyError. */
	const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
		let response: Response
		try {
			response = await fetch(url, {
				...init,
				headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${credentials.apiKey}` },
			})
		} catch (error) {
			throw new DifyError(502, 'upstream_unreachable', error instanceof Error ? error.message : 'Dify is unreachable')
		}
		if (!response.ok) throw await difyErrorFromResponse(response)
		return response
	}

	const send = (path: string, init?: RequestInit) => request(`${base}${path}`, init)

	/** A JSON body, or upstream_error when an OK answer is not JSON (Review Focus 1). */
	const json = async <T>(response: Response): Promise<T> => {
		try {
			return (await response.json()) as T
		} catch {
			throw new DifyError(response.status, 'upstream_error', 'Dify answered a body that is not JSON')
		}
	}

	const multipart = (file: File, user: string) => {
		const form = new FormData()
		form.append('file', file, file.name)
		form.append('user', user)
		// No Content-Type header: fetch sets the multipart boundary itself.
		return { method: 'POST', body: form } satisfies RequestInit
	}

	return {
		// Application metadata (endpoint map §1.1): no end-user context.
		getInfo: () => send('/info').then(json<AppInfo>),
		getParameters: () => send('/parameters').then(json<AppParameters>),
		getSite: () => send('/site').then(json<SiteSettings>),
		getMeta: () => send('/meta').then(json<AppMeta>),

		// Chat family (§1.2): `user` in the JSON body, or the query string on GETs.
		chatMessages: (body: ChatMessageRequest, user: string, signal?: AbortSignal) =>
			send('/chat-messages', { ...jsonInit('POST', { ...body, user }), signal }),
		stopChat: (taskId: string, user: string) =>
			send(`/chat-messages/${segment(taskId)}/stop`, jsonInit('POST', { user })).then(json<StopResponse>),
		listMessages: (query: MessagesQuery, user: string) =>
			send(`/messages${queryString({ ...query, user })}`).then(json<MessagesPage>),
		getSuggested: (messageId: string, user: string) =>
			send(`/messages/${segment(messageId)}/suggested${queryString({ user })}`).then(json<SuggestedQuestionsResponse>),
		createFeedback: (messageId: string, body: FeedbackRequest, user: string) =>
			send(`/messages/${segment(messageId)}/feedbacks`, jsonInit('POST', { ...body, user })).then(json<StopResponse>),
		listConversations: (query: ConversationsQuery, user: string) =>
			send(`/conversations${queryString({ ...query, user })}`).then(json<ConversationsPage>),
		/** 204: resolves with nothing. */
		deleteConversation: async (conversationId: string, user: string): Promise<void> => {
			await send(`/conversations/${segment(conversationId)}`, jsonInit('DELETE', { user }))
		},
		renameConversation: (conversationId: string, body: RenameConversationRequest, user: string) =>
			send(`/conversations/${segment(conversationId)}/name`, jsonInit('POST', { ...body, user })).then(json<ConversationItem>),

		// Completion and workflow (§1.3, §1.4): streams pass through.
		completionMessages: (body: CompletionRequest, user: string, signal?: AbortSignal) =>
			send('/completion-messages', { ...jsonInit('POST', { ...body, user }), signal }),
		stopCompletion: (taskId: string, user: string) =>
			send(`/completion-messages/${segment(taskId)}/stop`, jsonInit('POST', { user })).then(json<StopResponse>),
		runWorkflow: (body: WorkflowRunRequest, user: string, signal?: AbortSignal) =>
			send('/workflows/run', { ...jsonInit('POST', { ...body, user }), signal }),
		stopWorkflow: (taskId: string, user: string) =>
			send(`/workflows/tasks/${segment(taskId)}/stop`, jsonInit('POST', { user })).then(json<StopResponse>),
		/** Dify's singular `workflow` path; `user` must equal the run's creator (404 otherwise). */
		workflowEvents: (workflowRunId: string, user: string, query: WorkflowEventsQuery, signal?: AbortSignal) =>
			send(`/workflow/${segment(workflowRunId)}/events${queryString({ user, ...query })}`, { signal }),

		// Human input (§1.5).
		getHumanInputForm: (formToken: string) =>
			send(`/form/human_input/${segment(formToken)}`).then(json<HumanInputForm>),
		submitHumanInput: (formToken: string, body: HumanInputSubmission, user: string) =>
			send(`/form/human_input/${segment(formToken)}`, jsonInit('POST', { ...body, user })).then(json<Record<string, never>>),

		// Files and audio (§1.6).
		uploadFile: (file: File, user: string) => send('/files/upload', multipart(file, user)).then(json<FileUploadResponse>),
		filePreview: (fileId: string, asAttachment: boolean, user: string) =>
			send(`/files/${segment(fileId)}/preview${queryString({ as_attachment: asAttachment || undefined, user })}`),
		/** A file link Dify handed out (message files, generated images, icons): the route checks the origin first. */
		fetchRemoteFile: (url: URL) => request(url.toString()),
		audioToText: (file: File, user: string) => send('/audio-to-text', multipart(file, user)).then(json<{ text: string }>),
		textToAudio: (body: TextToAudioRequest, user: string) => send('/text-to-audio', jsonInit('POST', { ...body, user })),

		// Annotations (§1.7): no end-user context.
		listAnnotations: (query: AnnotationsQuery) => send(`/apps/annotations${queryString(query)}`).then(json<AnnotationsPage>),
		createAnnotation: (body: AnnotationInput) => send('/apps/annotations', jsonInit('POST', body)).then(json<AnnotationItem>),
		updateAnnotation: (annotationId: string, body: AnnotationInput) =>
			send(`/apps/annotations/${segment(annotationId)}`, jsonInit('PUT', body)).then(json<AnnotationItem>),
		/** 204: resolves with nothing. */
		deleteAnnotation: async (annotationId: string): Promise<void> => {
			await send(`/apps/annotations/${segment(annotationId)}`, { method: 'DELETE' })
		},
	}
}

export type DifyClient = ReturnType<typeof difyClient>
```

- [ ] **Step 4: Run the tests, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-client.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint lib/dify/client.ts && pnpm exec oxfmt --write lib/dify/client.ts __tests__/dify-client.test.ts`
Expected: green. If `URLSearchParams` orders keys differently from the expected strings, fix the test's expectation to the actual order after confirming every key is present (the order of a query string carries no meaning).

```bash
git add lib/dify/client.ts __tests__/dify-client.test.ts
git commit -m "feat(dify): the server-only typed client for the 27 operations and remote files

One function per Service API operation (docs/dify-service-api-1.17.1.md), user placed as the map says (body, query or multipart), the bearer from the app row, DifyError on a non-OK or non-JSON answer, upstream_unreachable on a network failure, streams and binaries passed through with their status and meaningful headers (charter §4.1).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 5: Request schemas `lib/dify/schemas.ts`

Charter §4.5 "Dify route input" (per-operation allowlists, unknown keys stripped, `400 invalid_param` naming the parameter). Review Focus 2 and 3.

**Files:**
- Create: `lib/dify/schemas.ts`
- Test: `__tests__/dify-schemas.test.ts`

**Interfaces:**
- Produces: `type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }`; `parseJsonBody(request, schema)`, `parseQuery(searchParams, schema)`, `parseFilePart(request)` (exactly one non-empty `file` part with a name); the schemas `chatMessagesBody`, `messagesQuery`, `conversationsQuery`, `renameConversationBody`, `feedbackBody`, `completionBody`, `workflowRunBody`, `workflowEventsQuery`, `humanInputBody`, `filePreviewQuery`, `textToAudioBody`, `annotationsQuery`, `annotationBody`, `remoteFileQuery`, and their inferred types.

- [ ] **Step 1: Write the failing schema tests**

Create `__tests__/dify-schemas.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import {
	annotationsQuery,
	chatMessagesBody,
	conversationsQuery,
	feedbackBody,
	humanInputBody,
	messagesQuery,
	parseFilePart,
	parseJsonBody,
	parseQuery,
	renameConversationBody,
	textToAudioBody,
	workflowEventsQuery,
} from '@/lib/dify/schemas'

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const jsonRequest = (body: unknown) =>
	new Request('http://app/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const query = (text: string) => new URLSearchParams(text)

describe('parseJsonBody with chatMessagesBody', () => {
	it('keeps the documented fields and strips the rest (user, trace ids)', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({ query: 'hi', inputs: { a: 1 }, response_mode: 'streaming', user: 'evil', trace_id: 'x', auto_generate_name: false }),
			chatMessagesBody,
		)
		expect(parsed).toEqual({
			ok: true,
			data: { query: 'hi', inputs: { a: 1 }, response_mode: 'streaming', auto_generate_name: false },
		})
	})
	it('accepts files in both transfer methods and an empty conversation_id', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({
				query: 'q',
				inputs: {},
				conversation_id: '',
				files: [
					{ type: 'document', transfer_method: 'local_file', upload_file_id: UUID },
					{ type: 'image', transfer_method: 'remote_url', url: 'https://x.example/a.png' },
				],
			}),
			chatMessagesBody,
		)
		expect(parsed.ok).toBe(true)
	})
	it('answers 400 invalid_param naming the fields for a bad body', async () => {
		const parsed = await parseJsonBody(jsonRequest({ inputs: 'nope', files: [{ type: 'pdf' }] }), chatMessagesBody)
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.response.status).toBe(400)
		const body = await parsed.response.json()
		expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
		expect(body.message).toContain('query')
		expect(body.message).toContain('inputs')
		expect(body.message).toContain('files')
	})
	it('answers 400 invalid_param for a body that is not JSON', async () => {
		const parsed = await parseJsonBody(new Request('http://app/x', { method: 'POST', body: '{nope' }), chatMessagesBody)
		expect(parsed.ok).toBe(false)
		if (!parsed.ok) await expect(parsed.response.json()).resolves.toMatchObject({ code: 'invalid_param' })
	})
})

// Review Focus 3
describe('query schemas', () => {
	it('messagesQuery needs a UUID conversation_id and bounds limit to 1..100', () => {
		expect(parseQuery(query(`conversation_id=${UUID}&limit=20`), messagesQuery)).toEqual({
			ok: true,
			data: { conversation_id: UUID, limit: 20 },
		})
		expect(parseQuery(query(`conversation_id=${UUID}`), messagesQuery).ok).toBe(true)
		expect(parseQuery(query('conversation_id=abc'), messagesQuery).ok).toBe(false)
		expect(parseQuery(query(`conversation_id=${UUID}&limit=0`), messagesQuery).ok).toBe(false)
		expect(parseQuery(query(`conversation_id=${UUID}&limit=101`), messagesQuery).ok).toBe(false)
		expect(parseQuery(query(`conversation_id=${UUID}&first_id=nope`), messagesQuery).ok).toBe(false)
	})
	it('conversationsQuery takes the four sort orders only, and names the parameter', async () => {
		expect(parseQuery(query('limit=100&sort_by=-updated_at'), conversationsQuery).ok).toBe(true)
		const bad = parseQuery(query('sort_by=name'), conversationsQuery)
		expect(bad.ok).toBe(false)
		if (!bad.ok) expect((await bad.response.json()).message).toContain('sort_by')
	})
	it('workflowEventsQuery turns the flags into booleans', () => {
		expect(parseQuery(query('continue_on_pause=true'), workflowEventsQuery)).toEqual({
			ok: true,
			data: { continue_on_pause: true },
		})
		expect(parseQuery(query('include_state_snapshot=yes'), workflowEventsQuery).ok).toBe(false)
	})
	it('annotationsQuery: page ≥ 1, limit 1..100, keyword free text', () => {
		expect(parseQuery(query('page=2&limit=10&keyword=tea'), annotationsQuery)).toEqual({
			ok: true,
			data: { page: 2, limit: 10, keyword: 'tea' },
		})
		expect(parseQuery(query('page=0'), annotationsQuery).ok).toBe(false)
	})
})

describe('body schemas', () => {
	it('renameConversationBody needs a name or auto_generate', async () => {
		expect((await parseJsonBody(jsonRequest({ name: ' Tea ' }), renameConversationBody))).toEqual({ ok: true, data: { name: 'Tea' } })
		expect((await parseJsonBody(jsonRequest({ auto_generate: true }), renameConversationBody)).ok).toBe(true)
		expect((await parseJsonBody(jsonRequest({}), renameConversationBody)).ok).toBe(false)
		expect((await parseJsonBody(jsonRequest({ name: '   ' }), renameConversationBody)).ok).toBe(false)
	})
	it('feedbackBody takes like, dislike or null', async () => {
		expect((await parseJsonBody(jsonRequest({ rating: null, content: '' }), feedbackBody)).ok).toBe(true)
		expect((await parseJsonBody(jsonRequest({ rating: 'meh' }), feedbackBody)).ok).toBe(false)
	})
	it('humanInputBody takes strings and file mappings, and strips user', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({
				inputs: { feedback: 'ok', doc: { transfer_method: 'local_file', upload_file_id: UUID, type: 'document' }, docs: [] },
				action: 'approve',
				user: 'evil',
			}),
			humanInputBody,
		)
		expect(parsed).toEqual({
			ok: true,
			data: { inputs: { feedback: 'ok', doc: { transfer_method: 'local_file', upload_file_id: UUID, type: 'document' }, docs: [] }, action: 'approve' },
		})
		expect((await parseJsonBody(jsonRequest({ inputs: {}, action: '' }), humanInputBody)).ok).toBe(false)
	})
	it('textToAudioBody needs message_id or text', async () => {
		expect((await parseJsonBody(jsonRequest({ text: 'hello' }), textToAudioBody)).ok).toBe(true)
		expect((await parseJsonBody(jsonRequest({ message_id: UUID }), textToAudioBody)).ok).toBe(true)
		expect((await parseJsonBody(jsonRequest({ voice: 'x' }), textToAudioBody)).ok).toBe(false)
	})
})

// Review Focus 2
describe('parseFilePart', () => {
	const multipart = (parts: Array<[string, File | string]>) => {
		const form = new FormData()
		for (const [name, value] of parts) form.append(name, value)
		return new Request('http://app/x', { method: 'POST', body: form })
	}
	it('returns the one file part', async () => {
		const parsed = await parseFilePart(multipart([['file', new File(['x'], 'a.txt', { type: 'text/plain' })], ['user', 'evil']]))
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	it('refuses no file part, an empty file, a second file part, or a non-multipart body', async () => {
		for (const request of [
			multipart([['user', 'x']]),
			multipart([['file', new File([], 'empty.txt')]]),
			multipart([['file', new File(['a'], 'a.txt')], ['file', new File(['b'], 'b.txt')]]),
			new Request('http://app/x', { method: 'POST', body: 'plain' }),
		]) {
			const parsed = await parseFilePart(request)
			expect(parsed.ok).toBe(false)
			if (!parsed.ok) {
				expect(parsed.response.status).toBe(400)
				await expect(parsed.response.json()).resolves.toMatchObject({ code: 'invalid_param' })
			}
		}
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/dify-schemas.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `lib/dify/schemas.ts`**

```ts
import 'server-only'

import * as z from 'zod'

import { difyErrorResponse } from './errors'

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }

/** `400 invalid_param` naming the paths that failed (charter §4.5), in Dify's own code and envelope. */
const invalid = (issues: z.core.$ZodIssue[]): Parsed<never> => {
	const paths = [...new Set(issues.map(issue => issue.path.map(String).join('.') || 'body'))]
	return { ok: false, response: difyErrorResponse('invalid_param', `Invalid request: ${paths.join(', ')}`, 400) }
}

const uuid = z.uuid()
const limit = z.coerce.number().int().min(1).max(100)
/** A query flag: Dify's booleans arrive as the strings true/false. */
const flag = z.enum(['true', 'false']).transform(value => value === 'true')
const inputs = z.record(z.string(), z.unknown())
const fileType = z.enum(['document', 'image', 'audio', 'video', 'custom'])
const responseMode = z.enum(['streaming', 'blocking'])

/** A `files[]` item (endpoint map §2.2): type required, local files by id, remote ones by URL. */
const fileInput = z.discriminatedUnion('transfer_method', [
	z.object({ type: fileType, transfer_method: z.literal('local_file'), upload_file_id: z.string().min(1) }),
	z.object({
		type: fileType,
		transfer_method: z.literal('remote_url'),
		url: z.url().optional(),
		remote_url: z.url().optional(),
		upload_file_id: z.string().min(1).optional(),
	}),
])

/** A human-input file mapping (endpoint map §1.5): `type` is optional there. */
const fileMapping = z.discriminatedUnion('transfer_method', [
	z.object({ transfer_method: z.literal('local_file'), upload_file_id: z.string().min(1), type: fileType.optional() }),
	z.object({ transfer_method: z.literal('remote_url'), url: z.url().optional(), remote_url: z.url().optional(), type: fileType.optional() }),
])

// z.object strips unknown keys (zod 4), which is what keeps `user` and the tracing fields out.

export const chatMessagesBody = z.object({
	query: z.string(),
	inputs,
	files: z.array(fileInput).optional(),
	response_mode: responseMode.optional(),
	conversation_id: z.union([uuid, z.literal('')]).optional(),
	auto_generate_name: z.boolean().optional(),
	workflow_id: uuid.optional(),
})

export const messagesQuery = z.object({
	conversation_id: uuid,
	first_id: uuid.optional(),
	limit: limit.optional(),
})

export const conversationsQuery = z.object({
	last_id: uuid.optional(),
	limit: limit.optional(),
	sort_by: z.enum(['created_at', '-created_at', 'updated_at', '-updated_at']).optional(),
})

export const renameConversationBody = z
	.object({ name: z.string().trim().min(1).optional(), auto_generate: z.boolean().optional() })
	.refine(body => body.name !== undefined || body.auto_generate === true, {
		error: 'name or auto_generate is required',
		path: ['name'],
	})

export const feedbackBody = z.object({
	rating: z.enum(['like', 'dislike']).nullable(),
	content: z.string().optional(),
})

export const completionBody = z.object({
	inputs,
	query: z.string().optional(),
	files: z.array(fileInput).optional(),
	response_mode: responseMode.optional(),
})

export const workflowRunBody = z.object({
	inputs,
	files: z.array(fileInput).optional(),
	response_mode: responseMode.optional(),
})

export const workflowEventsQuery = z.object({
	include_state_snapshot: flag.optional(),
	continue_on_pause: flag.optional(),
})

export const humanInputBody = z.object({
	inputs: z.record(z.string(), z.union([z.string(), fileMapping, z.array(fileMapping)])),
	action: z.string().min(1),
})

export const filePreviewQuery = z.object({ as_attachment: flag.optional() })

export const textToAudioBody = z
	.object({ message_id: uuid.optional(), text: z.string().optional(), voice: z.string().optional() })
	.refine(body => Boolean(body.message_id || body.text), { error: 'message_id or text is required', path: ['text'] })

export const annotationsQuery = z.object({
	page: z.coerce.number().int().min(1).optional(),
	limit: limit.optional(),
	keyword: z.string().optional(),
})

export const annotationBody = z.object({
	question: z.string().trim().min(1),
	answer: z.string().trim().min(1),
})

export const remoteFileQuery = z.object({ url: z.string().min(1) })

export type ChatMessagesBody = z.infer<typeof chatMessagesBody>
export type MessagesQueryInput = z.infer<typeof messagesQuery>
export type ConversationsQueryInput = z.infer<typeof conversationsQuery>
export type RenameConversationBody = z.infer<typeof renameConversationBody>
export type FeedbackBody = z.infer<typeof feedbackBody>
export type CompletionBody = z.infer<typeof completionBody>
export type WorkflowRunBody = z.infer<typeof workflowRunBody>
export type WorkflowEventsQueryInput = z.infer<typeof workflowEventsQuery>
export type HumanInputBody = z.infer<typeof humanInputBody>
export type TextToAudioBody = z.infer<typeof textToAudioBody>
export type AnnotationsQueryInput = z.infer<typeof annotationsQuery>
export type AnnotationBody = z.infer<typeof annotationBody>

/** The JSON body against a schema; a body that is not JSON is `invalid_param` too. */
export const parseJsonBody = async <S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<z.infer<S>>> => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return { ok: false, response: difyErrorResponse('invalid_param', 'Request body is not valid JSON.', 400) }
	}
	const result = schema.safeParse(raw)
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
}

/** The query string against a schema (every value arrives as a string; the schemas coerce). */
export const parseQuery = <S extends z.ZodType>(searchParams: URLSearchParams, schema: S): Parsed<z.infer<S>> => {
	const result = schema.safeParse(Object.fromEntries(searchParams))
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
}

/**
 * Exactly one non-empty `file` part with a name (Dify: one part, filename required; Review Focus 2). Other
 * parts (a client-sent `user`) are dropped: the route builds its own form for Dify.
 */
export const parseFilePart = async (request: Request): Promise<Parsed<File>> => {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return { ok: false, response: difyErrorResponse('invalid_param', 'Expected a multipart body with one file part.', 400) }
	}
	const files = form.getAll('file')
	const file = files[0]
	if (files.length !== 1 || !(file instanceof File) || !file.name || file.size === 0) {
		return { ok: false, response: difyErrorResponse('invalid_param', 'Expected exactly one non-empty file part named file.', 400) }
	}
	return { ok: true, data: file }
}
```

If `z.core.$ZodIssue` is not the exported issue type in the installed zod 4 minor, use `z.ZodError['issues']` as the parameter type (`issues: z.ZodError['issues']`); either is documented, the second never drifts.

- [ ] **Step 4: Run the tests, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-schemas.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint lib/dify/schemas.ts && pnpm exec oxfmt --write lib/dify/schemas.ts __tests__/dify-schemas.test.ts`
Expected: green.

```bash
git add lib/dify/schemas.ts __tests__/dify-schemas.test.ts
git commit -m "feat(dify): zod schemas for every route's body, query and file part

Per-operation allowlists from the endpoint map; unknown keys stripped so a client cannot smuggle user or trace fields; 400 invalid_param naming the failing paths; exactly one non-empty file part (charter §4.5).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 6: The apps Data Access Layer and the `dify_apps` migration

Charter §4.2 "Data Access Layer" (with the actor-parameter deviation of the header), §4.4 "`dify_apps` (B1)", §4.1 "App data for the browser". Review Focus 4.

**Files:**
- Modify: `db/schema/apps.ts`
- Create: `db/migrations/<timestamp>_b1-apps-enabled-icon/` (generated, then hand-edited), `lib/data/apps.ts`
- Delete: `db/seed.ts` (and the `db:seed` script) if Task 1 did not already
- Test: `__tests__/data-apps.test.ts`

**Interfaces:**
- Produces: `AppSettings`, `AppIcon`, `AppDto`, `ChatAppDto`, `AppAccess`, `AppInput`, `SyncResult`, `ICON_MAX_BYTES`; pure `parseTags`, `iconOf`, `settingsOf`, `toAppDto`, `toChatAppDto`, `readIconBytes`, `iconColumnsFrom`; `listApps(actor)`, `getApp(actor, id)`, `getChatApp(actor, id)`, `getAppAccess(actor, id)`, `getAppIcon(actor, id)`, `createApp(actor, input)`, `updateApp(actor, id, input)`, `deleteApp(actor, id)`, `syncApp(actor, id)`. The actor is `SessionUser` from `lib/auth/session` (unused in B1, named `_actor`; B2 reads its role).
- Consumes: `difyClient` (Task 4), `isAppMode`, `AppInfo`, `SiteSettings` (Task 3).

- [ ] **Step 1: Write the failing DAL tests (pure parts)**

Create `__tests__/data-apps.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({ getDb: () => { throw new Error('not used by the pure tests') } }))

import {
	ICON_MAX_BYTES,
	iconColumnsFrom,
	iconOf,
	parseTags,
	readIconBytes,
	settingsOf,
	toAppDto,
	toChatAppDto,
} from '@/lib/data/apps'

const row = {
	id: 'a1',
	createdAt: new Date('2026-10-07T10:00:00Z'),
	updatedAt: new Date('2026-10-07T11:00:00Z'),
	name: 'Tea',
	mode: 'advanced-chat',
	description: 'desc',
	tags: '["a","b"]',
	isEnabled: true,
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
	enableAnswerForm: true,
	answerFormFeedbackText: 'Thanks',
	enableUpdateInputAfterStarts: false,
	openingStatementDisplayMode: 'always',
	enableAnnotation: true,
	iconType: 'emoji',
	icon: '🍵',
	iconBackground: '#FFEAD5',
	iconImage: null,
	iconMime: null,
}

describe('parseTags', () => {
	it('reads a JSON array of strings and tolerates anything else', () => {
		expect(parseTags('["a","b"]')).toEqual(['a', 'b'])
		expect(parseTags('["a",1]')).toEqual(['a'])
		expect(parseTags('nope')).toEqual([])
		expect(parseTags(null)).toEqual([])
	})
})

describe('iconOf and settingsOf', () => {
	it('maps an emoji icon, an image icon and no icon', () => {
		expect(iconOf(row)).toEqual({ kind: 'emoji', emoji: '🍵', background: '#FFEAD5' })
		expect(iconOf({ ...row, iconType: 'image', iconImage: Buffer.from([1]) })).toEqual({ kind: 'image' })
		expect(iconOf({ ...row, iconType: 'image', iconImage: null })).toBeNull()
		expect(iconOf({ ...row, iconType: null, icon: null })).toBeNull()
	})
	it('maps the settings with defaults for missing values', () => {
		expect(settingsOf(row)).toEqual({
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'always',
			annotationEnabled: true,
		})
		expect(settingsOf({ ...row, answerFormFeedbackText: null, openingStatementDisplayMode: null })).toMatchObject({
			answerForm: { enabled: true, feedbackText: '' },
			openingStatementDisplayMode: 'default',
		})
	})
})

describe('DTOs', () => {
	it('the admin DTO carries the base but never the key; an unknown mode becomes null', () => {
		const dto = toAppDto(row)
		expect(dto).toEqual({
			id: 'a1',
			name: 'Tea',
			mode: 'advanced-chat',
			description: 'desc',
			tags: ['a', 'b'],
			enabled: true,
			icon: { kind: 'emoji', emoji: '🍵', background: '#FFEAD5' },
			settings: settingsOf(row),
			apiBase: 'https://dify.example/v1',
			createdAt: '2026-10-07T10:00:00.000Z',
			updatedAt: '2026-10-07T11:00:00.000Z',
		})
		expect(JSON.stringify(dto)).not.toContain('app-secret')
		expect(toAppDto({ ...row, mode: 'rag-pipeline' }).mode).toBeNull()
	})
	it('the chat DTO carries neither the key nor the base', () => {
		const dto = toChatAppDto(row)
		expect(dto).toEqual({
			id: 'a1',
			name: 'Tea',
			mode: 'advanced-chat',
			description: 'desc',
			enabled: true,
			icon: { kind: 'emoji', emoji: '🍵', background: '#FFEAD5' },
			settings: settingsOf(row),
		})
		expect(JSON.stringify(dto)).not.toContain('dify.example')
	})
})

// Review Focus 4
describe('readIconBytes', () => {
	const image = (bytes: number, type = 'image/png', length?: string) =>
		new Response(new Uint8Array(bytes), {
			status: 200,
			headers: { 'content-type': type, ...(length !== undefined && { 'content-length': length }) },
		})
	it('reads an image within the cap', async () => {
		const result = await readIconBytes(image(10, 'image/png; charset=binary'), 100)
		expect(result).toEqual({ bytes: Buffer.alloc(10), mime: 'image/png' })
	})
	it('refuses a non-image, a declared size over the cap, and an actual size over the cap', async () => {
		expect(await readIconBytes(image(10, 'text/html'), 100)).toBeNull()
		expect(await readIconBytes(image(10, 'image/png', '200'), 100)).toBeNull()
		expect(await readIconBytes(image(150, 'image/png'), 100)).toBeNull()
		expect(ICON_MAX_BYTES).toBe(1024 * 1024)
	})
})

describe('iconColumnsFrom', () => {
	const site = { title: 'T', icon_type: 'image' as const, icon: 'file-id', icon_background: null, icon_url: 'https://dify.example/files/x?sign=1' }
	it('stores an emoji icon without fetching', async () => {
		const fetchImage = vi.fn()
		await expect(
			iconColumnsFrom({ title: 'T', icon_type: 'emoji', icon: '🍵', icon_background: '#FFF' }, fetchImage),
		).resolves.toEqual({
			columns: { iconType: 'emoji', icon: '🍵', iconBackground: '#FFF', iconImage: null, iconMime: null },
			partial: false,
		})
		expect(fetchImage).not.toHaveBeenCalled()
	})
	it('stores the fetched bytes of an image icon', async () => {
		const fetchImage = vi.fn().mockResolvedValue({ bytes: Buffer.from([1, 2]), mime: 'image/png' })
		await expect(iconColumnsFrom(site, fetchImage)).resolves.toEqual({
			columns: { iconType: 'image', icon: 'file-id', iconBackground: null, iconImage: Buffer.from([1, 2]), iconMime: 'image/png' },
			partial: false,
		})
		expect(fetchImage).toHaveBeenCalledWith('https://dify.example/files/x?sign=1')
	})
	it('keeps the previous icon (no columns) and reports partial when the image cannot be stored', async () => {
		await expect(iconColumnsFrom(site, vi.fn().mockResolvedValue(null))).resolves.toEqual({ columns: undefined, partial: true })
		await expect(iconColumnsFrom(site, vi.fn().mockRejectedValue(new Error('net')))).resolves.toEqual({ columns: undefined, partial: true })
	})
	it('clears the icon when the site has none', async () => {
		await expect(iconColumnsFrom(null, vi.fn())).resolves.toEqual({
			columns: { iconType: null, icon: null, iconBackground: null, iconImage: null, iconMime: null },
			partial: false,
		})
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/data-apps.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: The schema change**

Replace `db/schema/apps.ts` with:

```ts
import { sql } from 'drizzle-orm'
import { boolean, datetime, mediumblob, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core'

import { generateUuidV4 } from '@/lib/helpers'

export const difyApps = mysqlTable('dify_apps', {
	id: varchar({ length: 36 })
		.primaryKey()
		.$defaultFn(() => generateUuidV4()),
	createdAt: datetime('created_at', { fsp: 3 })
		.default(sql`CURRENT_TIMESTAMP(3)`)
		.notNull(),
	updatedAt: datetime('updated_at', { fsp: 3 })
		.default(sql`CURRENT_TIMESTAMP(3)`)
		.notNull()
		.$onUpdate(() => new Date()),
	name: varchar({ length: 255 }).notNull(),
	/** A Dify app mode (lib/dify/types APP_MODES); kept free so a future mode does not break the row (charter §4.4). */
	mode: varchar({ length: 255 }),
	description: text(),
	/** JSON array of strings. */
	tags: text(),
	isEnabled: boolean('is_enabled').default(true).notNull(),
	apiBase: varchar('api_base', { length: 500 }).notNull(),
	apiKey: varchar('api_key', { length: 255 }).notNull(),
	enableAnswerForm: boolean('enable_answer_form').default(false).notNull(),
	answerFormFeedbackText: text('answer_form_feedback_text'),
	enableUpdateInputAfterStarts: boolean('enable_update_input_after_starts').default(false).notNull(),
	openingStatementDisplayMode: varchar('opening_statement_display_mode', { length: 20 }),
	enableAnnotation: boolean('enable_annotation').default(false).notNull(),
	// The Dify site icon, stored at create and sync time (charter §4.4): Dify's icon_url for an image expires.
	iconType: varchar('icon_type', { length: 16 }),
	icon: text('icon'),
	iconBackground: varchar('icon_background', { length: 32 }),
	iconImage: mediumblob('icon_image', { mode: 'buffer' }),
	iconMime: varchar('icon_mime', { length: 64 }),
})
```

- [ ] **Step 4: Generate the migration and add the backfill**

```bash
pnpm db:generate --name b1-apps-enabled-icon
```

Open the new `db/migrations/<timestamp>_b1-apps-enabled-icon/migration.sql`. It should hold a `MODIFY COLUMN \`is_enabled\`` statement and five `ADD` statements. Insert the backfill as the first statement, so the integers (`1` enabled, `2` disabled, `NULL` enabled) become booleans before the type changes, and make sure the file reads exactly:

```sql
UPDATE `dify_apps` SET `is_enabled` = CASE WHEN `is_enabled` = 2 THEN 0 ELSE 1 END;--> statement-breakpoint
ALTER TABLE `dify_apps` MODIFY COLUMN `is_enabled` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_type` varchar(16);--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_background` varchar(32);--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_image` mediumblob;--> statement-breakpoint
ALTER TABLE `dify_apps` ADD `icon_mime` varchar(64);
```

(Keep drizzle-kit's wording of the generated statements if it differs in casing or ordering; only the `UPDATE` is hand-added, and it must come first. If drizzle-kit instead generated a DROP plus ADD for `is_enabled`, answer its prompt with "column changed, not renamed" and regenerate.) Keep the generated `snapshot.json` as is. If `db/seed.ts` still exists: `git rm db/seed.ts` and remove the `db:seed` line from `package.json`.

- [ ] **Step 5: Verify the migration on real rows**

The repo uses drizzle-kit's folder-per-migration layout (no `meta/_journal.json`): the migrator reads the folders under `db/migrations/`, so a folder moved aside is a migration not applied. On the throwaway e2e MySQL, apply every migration but the new one, seed the three `is_enabled` cases, then apply the new one:

```bash
docker compose -f docker-compose.e2e.yml down && docker compose -f docker-compose.e2e.yml up -d --wait
NEW=$(ls -d db/migrations/*_b1-apps-enabled-icon)
mv "$NEW" /tmp/claude-1000/b1-migration
DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker exec -i dify-app-hub-e2e-mysql mysql -ue2e -pe2e e2e -e "INSERT INTO dify_apps (id,name,mode,api_base,api_key,is_enabled) VALUES ('m1','on','chat','http://x/v1','k',1),('m2','off','chat','http://x/v1','k',2),('m3','null','chat','http://x/v1','k',NULL);"
mv /tmp/claude-1000/b1-migration "$NEW"
DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker exec -i dify-app-hub-e2e-mysql mysql -ue2e -pe2e e2e -e "SELECT id, is_enabled, icon_type FROM dify_apps ORDER BY id;"
docker compose -f docker-compose.e2e.yml down
```

Expected: `m1 1 NULL`, `m2 0 NULL`, `m3 1 NULL`, and the new migration applied without error. Record the output in the task report. (The owner's local volume is migrated by the Docker gate in Task 18; the dev loop applies it with `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate` when the owner says so.)

- [ ] **Step 6: Write `lib/data/apps.ts`**

```ts
import 'server-only'

import { desc, eq } from 'drizzle-orm'

import { getDb } from '@/db'
import { difyApps } from '@/db/schema'
import type { SessionUser } from '@/lib/auth/session'
import { difyClient, type DifyCredentials } from '@/lib/dify/client'
import { DifyError } from '@/lib/dify/errors'
import { isAppMode, type AppInfo, type AppMode, type SiteSettings } from '@/lib/dify/types'

/*
 * The apps Data Access Layer (charter §4.2). Every function takes the verified actor first: the entry point
 * (route, action, page) verifies the session once, and nothing here can be called without a SessionUser. B1
 * has no roles, so `_actor` is not read yet; B2 reads its role here.
 */

type AppRow = typeof difyApps.$inferSelect
type IconColumns = Pick<AppRow, 'iconType' | 'icon' | 'iconBackground' | 'iconImage' | 'iconMime'>

export type OpeningStatementDisplayMode = 'default' | 'always'

export interface AppSettings {
	answerForm: { enabled: boolean; feedbackText: string }
	enableUpdateAfterConversationStarts: boolean
	openingStatementDisplayMode: OpeningStatementDisplayMode
	annotationEnabled: boolean
}

/** What the browser needs to draw the icon (charter §4.1): the image itself comes from GET /api/apps/[appId]/icon. */
export type AppIcon =
	| { kind: 'emoji'; emoji: string; background: string | null }
	| { kind: 'image' }
	| null

/** The admin's view: everything but the key (the edit form never shows the stored key). */
export interface AppDto {
	id: string
	name: string
	mode: AppMode | null
	description: string
	tags: string[]
	enabled: boolean
	icon: AppIcon
	settings: AppSettings
	apiBase: string
	createdAt: string
	updatedAt: string
}

/** The chat's view: no key, no base (file links go through the proxy). */
export interface ChatAppDto {
	id: string
	name: string
	mode: AppMode | null
	description: string
	enabled: boolean
	icon: AppIcon
	settings: AppSettings
}

/** What a Dify route needs: whether the app may be used, and how to reach Dify. */
export interface AppAccess {
	id: string
	enabled: boolean
	credentials: DifyCredentials
}

/** What the admin form sends (validated by the action's schema). `apiKey` is required on create, optional on update. */
export interface AppInput {
	apiBase: string
	apiKey?: string
	mode: AppMode
	enabled: boolean
	settings: AppSettings
}

export interface SyncResult {
	id: string
	/** The Dify info was stored but the icon image could not be (kept the previous one). */
	partial: boolean
}

export const ICON_MAX_BYTES = 1024 * 1024

export const parseTags = (text: string | null): string[] => {
	try {
		const value: unknown = JSON.parse(text ?? '[]')
		return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []
	} catch {
		return []
	}
}

export const iconOf = (row: Pick<AppRow, 'iconType' | 'icon' | 'iconBackground' | 'iconImage'>): AppIcon => {
	if (row.iconType === 'emoji' && row.icon) {
		return { kind: 'emoji', emoji: row.icon, background: row.iconBackground ?? null }
	}
	if (row.iconType === 'image' && row.iconImage) return { kind: 'image' }
	return null
}

export const settingsOf = (
	row: Pick<
		AppRow,
		'enableAnswerForm' | 'answerFormFeedbackText' | 'enableUpdateInputAfterStarts' | 'openingStatementDisplayMode' | 'enableAnnotation'
	>,
): AppSettings => ({
	answerForm: { enabled: row.enableAnswerForm, feedbackText: row.answerFormFeedbackText ?? '' },
	enableUpdateAfterConversationStarts: row.enableUpdateInputAfterStarts,
	openingStatementDisplayMode: row.openingStatementDisplayMode === 'always' ? 'always' : 'default',
	annotationEnabled: row.enableAnnotation,
})

const modeOf = (mode: string | null): AppMode | null => (isAppMode(mode) ? mode : null)

export const toAppDto = (row: AppRow): AppDto => ({
	id: row.id,
	name: row.name,
	mode: modeOf(row.mode),
	description: row.description ?? '',
	tags: parseTags(row.tags),
	enabled: row.isEnabled,
	icon: iconOf(row),
	settings: settingsOf(row),
	apiBase: row.apiBase,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

export const toChatAppDto = (row: AppRow): ChatAppDto => ({
	id: row.id,
	name: row.name,
	mode: modeOf(row.mode),
	description: row.description ?? '',
	enabled: row.isEnabled,
	icon: iconOf(row),
	settings: settingsOf(row),
})

/**
 * The bytes of an image answer within the cap, else null: a non-image type, a declared or actual size over
 * the cap, or a body that cannot be read (Review Focus 4).
 */
export const readIconBytes = async (
	response: Response,
	cap = ICON_MAX_BYTES,
): Promise<{ bytes: Buffer; mime: string } | null> => {
	const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim()
	if (!mime.startsWith('image/')) return null
	const declared = Number(response.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > cap) return null
	try {
		const bytes = Buffer.from(await response.arrayBuffer())
		return bytes.length > cap ? null : { bytes, mime }
	} catch {
		return null
	}
}

/**
 * The icon columns for a site answer. An image icon's bytes are fetched through Dify's signed url by the given
 * function; when that fails the columns are left undefined (the row keeps its previous icon) and `partial` says so.
 */
export const iconColumnsFrom = async (
	site: SiteSettings | null,
	fetchImage: (url: string) => Promise<{ bytes: Buffer; mime: string } | null>,
): Promise<{ columns: IconColumns | undefined; partial: boolean }> => {
	const none: IconColumns = { iconType: null, icon: null, iconBackground: null, iconImage: null, iconMime: null }
	if (!site?.icon_type || !site.icon) return { columns: none, partial: false }
	if (site.icon_type === 'emoji') {
		return {
			columns: { iconType: 'emoji', icon: site.icon, iconBackground: site.icon_background ?? null, iconImage: null, iconMime: null },
			partial: false,
		}
	}
	if (site.icon_type === 'image' && site.icon_url) {
		try {
			const image = await fetchImage(site.icon_url)
			if (image) {
				return {
					columns: { iconType: 'image', icon: site.icon, iconBackground: site.icon_background ?? null, iconImage: image.bytes, iconMime: image.mime },
					partial: false,
				}
			}
		} catch {
			// fall through: keep the previous icon
		}
		return { columns: undefined, partial: true }
	}
	return { columns: none, partial: false }
}

/** Dify's view of the app for the given credentials: info is required (a DifyError propagates), the site and its icon are best effort. */
const fetchDifyProfile = async (credentials: DifyCredentials) => {
	const client = difyClient(credentials)
	const info = await client.getInfo()
	let site: SiteSettings | null = null
	try {
		site = await client.getSite()
	} catch (error) {
		// 403 forbidden: the app has no site (endpoint map §1.1). Anything else is best effort too.
		if (!(error instanceof DifyError)) throw error
	}
	const { columns, partial } = await iconColumnsFrom(site, async url =>
		readIconBytes(await client.fetchRemoteFile(new URL(url))),
	)
	return { info, iconColumns: columns, partial }
}

const infoColumns = (info: AppInfo) => ({
	name: info.name,
	mode: info.mode,
	description: info.description ?? null,
	tags: info.tags?.length ? JSON.stringify(info.tags) : null,
})

const settingsColumns = (settings: AppSettings) => ({
	enableAnswerForm: settings.answerForm.enabled,
	answerFormFeedbackText: settings.answerForm.feedbackText || null,
	enableUpdateInputAfterStarts: settings.enableUpdateAfterConversationStarts,
	openingStatementDisplayMode: settings.openingStatementDisplayMode,
	enableAnnotation: settings.annotationEnabled,
})

const selectRow = async (id: string): Promise<AppRow | undefined> => {
	const [row] = await getDb().select().from(difyApps).where(eq(difyApps.id, id)).limit(1)
	return row
}

export async function listApps(_actor: SessionUser): Promise<AppDto[]> {
	const rows = await getDb().select().from(difyApps).orderBy(desc(difyApps.createdAt))
	return rows.map(toAppDto)
}

export async function getApp(_actor: SessionUser, id: string): Promise<AppDto | null> {
	const row = await selectRow(id)
	return row ? toAppDto(row) : null
}

export async function getChatApp(_actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const row = await selectRow(id)
	return row ? toChatAppDto(row) : null
}

/** For the Dify routes: the credentials never leave the server. */
export async function getAppAccess(_actor: SessionUser, id: string): Promise<AppAccess | null> {
	const [row] = await getDb()
		.select({ id: difyApps.id, isEnabled: difyApps.isEnabled, apiBase: difyApps.apiBase, apiKey: difyApps.apiKey })
		.from(difyApps)
		.where(eq(difyApps.id, id))
		.limit(1)
	return row ? { id: row.id, enabled: row.isEnabled, credentials: { apiBase: row.apiBase, apiKey: row.apiKey } } : null
}

export async function getAppIcon(_actor: SessionUser, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
	const [row] = await getDb()
		.select({ iconImage: difyApps.iconImage, iconMime: difyApps.iconMime })
		.from(difyApps)
		.where(eq(difyApps.id, id))
		.limit(1)
	return row?.iconImage && row.iconMime ? { bytes: row.iconImage, mime: row.iconMime } : null
}

/** Creates the row from Dify's own info for the given credentials; rejects with DifyError when Dify refuses them. */
export async function createApp(_actor: SessionUser, input: AppInput & { apiKey: string }): Promise<SyncResult> {
	const credentials = { apiBase: input.apiBase, apiKey: input.apiKey }
	const { info, iconColumns, partial } = await fetchDifyProfile(credentials)
	const id = crypto.randomUUID()
	await getDb().insert(difyApps).values({
		id,
		...infoColumns(info),
		// Dify reports the mode; the form's choice only decides when Dify reports none.
		mode: info.mode || input.mode,
		isEnabled: input.enabled,
		apiBase: input.apiBase,
		apiKey: input.apiKey,
		...settingsColumns(input.settings),
		...(iconColumns ?? {}),
	})
	return { id, partial }
}

/** Re-reads Dify with the effective credentials (a new key when given, else the stored one); null when the app is gone. */
export async function updateApp(_actor: SessionUser, id: string, input: AppInput): Promise<SyncResult | null> {
	const current = await selectRow(id)
	if (!current) return null
	const credentials = { apiBase: input.apiBase, apiKey: input.apiKey || current.apiKey }
	const { info, iconColumns, partial } = await fetchDifyProfile(credentials)
	await getDb()
		.update(difyApps)
		.set({
			...infoColumns(info),
			mode: info.mode || input.mode,
			isEnabled: input.enabled,
			apiBase: credentials.apiBase,
			apiKey: credentials.apiKey,
			...settingsColumns(input.settings),
			...(iconColumns ?? {}),
		})
		.where(eq(difyApps.id, id))
	return { id, partial }
}

export async function deleteApp(_actor: SessionUser, id: string): Promise<boolean> {
	const [result] = await getDb().delete(difyApps).where(eq(difyApps.id, id))
	return result.affectedRows > 0
}

/** Refreshes name, mode, description, tags and the icon from Dify; null when the app is gone. */
export async function syncApp(_actor: SessionUser, id: string): Promise<SyncResult | null> {
	const current = await selectRow(id)
	if (!current) return null
	const { info, iconColumns, partial } = await fetchDifyProfile({ apiBase: current.apiBase, apiKey: current.apiKey })
	await getDb()
		.update(difyApps)
		.set({ ...infoColumns(info), ...(iconColumns ?? {}) })
		.where(eq(difyApps.id, id))
	return { id, partial }
}
```

`crypto.randomUUID()` is Node's global Web Crypto (Node 22); it replaces `generateUuidV4` here because the schema's `$defaultFn` is not used when the id is needed for the answer. If `tsc` reports `result.affectedRows` on the delete, type the result as the mysql2 driver documents (`const [result] = await …; (result as { affectedRows: number }).affectedRows`), keeping the cast local.

- [ ] **Step 7: Run the tests, type-check, commit**

Run: `pnpm exec vitest run __tests__/data-apps.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint lib/data/apps.ts db/schema/apps.ts && pnpm exec oxfmt --write lib/data/apps.ts db/schema/apps.ts __tests__/data-apps.test.ts`
Expected: green. `tsc` will also flag `lib/db/types.ts`, `repository/app.ts` and the e2e seed on `isEnabled` typed boolean now: fix `lib/db/types.ts` minimally (`isEnabled: dbApp.isEnabled ? 1 : 2` on read, `isEnabled: appItem.isEnabled !== 2` on write) so the old code keeps working until Task 16 and 17 remove it; the e2e seed is updated in Task 16.

```bash
git add db/schema/apps.ts db/migrations lib/data/apps.ts lib/db/types.ts __tests__/data-apps.test.ts package.json
git commit -m "feat(data): apps Data Access Layer, boolean is_enabled with its backfill, the stored icon

lib/data/apps.ts: server-only reads and writes taking the verified actor, DTOs without the key (and without the base for the chat), create/update/sync reading Dify's info and site and storing the icon bytes within a 1 MB cap (charter §4.2, §4.4). Migration: is_enabled 1/2 → boolean with the UPDATE before MODIFY, five icon columns, updated_at on update.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 7: Route foundation and the app metadata routes

Charter §4.1 "Routes" (the five-step handler), the coverage table's first row. Every route task shares the pattern below; later route tasks repeat it in full.

**Files:**
- Create: `lib/dify/route.ts`, `app/api/dify/[appId]/info/route.ts`, `app/api/dify/[appId]/parameters/route.ts`, `app/api/dify/[appId]/site/route.ts`, `app/api/dify/[appId]/meta/route.ts`
- Test: `__tests__/dify-route.test.ts`, `__tests__/dify-routes-app.test.ts`

**Interfaces:**
- Produces: `resolveDifyRoute(params: Promise<{ appId: string }>): Promise<{ ok: true; ctx: DifyRouteContext } | { ok: false; response: Response }>` with `DifyRouteContext = { user: string; actor: SessionUser; appId: string; apiBase: string; dify: DifyClient }`; re-exports `errorResponseFrom`.
- Consumes: `verifySession` (Task 2), `getAppAccess` (Task 6), `difyClient` (Task 4), `difyErrorResponse`/`errorResponseFrom` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dify-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, difyClient } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	difyClient: vi.fn(() => ({ marker: 'client' })),
}))
vi.mock('@/lib/auth/session', () => ({ verifySession, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', () => ({ difyClient }))

import { resolveDifyRoute } from '@/lib/dify/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const params = Promise.resolve({ appId: 'app-1' })

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	difyClient.mockClear()
})

describe('resolveDifyRoute', () => {
	it('answers 401 in the envelope before looking at the app', async () => {
		verifySession.mockResolvedValue(null)
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(false)
		if (resolved.ok) return
		expect(resolved.response.status).toBe(401)
		await expect(resolved.response.json()).resolves.toEqual({ code: 'unauthorized', message: 'Sign in required.', status: 401 })
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	it('answers 404 app_not_found and 403 app_disabled', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		const missing = await resolveDifyRoute(params)
		expect(missing.ok ? null : missing.response.status).toBe(404)
		getAppAccess.mockResolvedValue({ id: 'app-1', enabled: false, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } })
		const disabled = await resolveDifyRoute(params)
		expect(disabled.ok ? null : disabled.response.status).toBe(403)
		if (!disabled.ok) await expect(disabled.response.json()).resolves.toMatchObject({ code: 'app_disabled' })
	})
	it('builds the context with the session email as the Dify user and a client for the app', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({ id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } })
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(true)
		if (!resolved.ok) return
		expect(resolved.ctx).toMatchObject({ user: 'jane@example.com', appId: 'app-1', apiBase: 'http://d/v1', dify: { marker: 'client' } })
		expect(getAppAccess).toHaveBeenCalledWith(actor, 'app-1')
		expect(difyClient).toHaveBeenCalledWith({ apiBase: 'http://d/v1', apiKey: 'k' })
	})
})
```

Create `__tests__/dify-routes-app.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: { getInfo: vi.fn(), getParameters: vi.fn(), getSite: vi.fn(), getMeta: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({ verifySession, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', () => ({ difyClient: () => client, passthrough: (r: Response) => r }))

import { DifyError } from '@/lib/dify/errors'
import { GET as info } from '@/app/api/dify/[appId]/info/route'
import { GET as meta } from '@/app/api/dify/[appId]/meta/route'
import { GET as parameters } from '@/app/api/dify/[appId]/parameters/route'
import { GET as site } from '@/app/api/dify/[appId]/site/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const ctx = { params: Promise.resolve({ appId: 'app-1' }) }
const get = (path: string) => new NextRequest(`http://app/api/dify/app-1/${path}`)

const routes = [
	['info', info, client.getInfo, { name: 'A', mode: 'chat', description: '', tags: [] }],
	['parameters', parameters, client.getParameters, { user_input_form: [] }],
	['site', site, client.getSite, { title: 'A' }],
	['meta', meta, client.getMeta, { tool_icons: {} }],
] as const

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	for (const fn of Object.values(client)) fn.mockReset()
})

describe.each(routes)('GET /api/dify/[appId]/%s', (path, handler, method, answer) => {
	it('refuses without a session, for an unknown app and for a disabled app, in the envelope', async () => {
		verifySession.mockResolvedValue(null)
		expect((await handler(get(path), ctx)).status).toBe(401)
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		expect((await handler(get(path), ctx)).status).toBe(404)
		getAppAccess.mockResolvedValue({ ...access, enabled: false })
		expect((await handler(get(path), ctx)).status).toBe(403)
		expect(method).not.toHaveBeenCalled()
	})
	it("answers Dify's JSON", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(access)
		method.mockResolvedValue(answer)
		const response = await handler(get(path), ctx)
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual(answer)
	})
	it("answers Dify's error envelope with its status", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(access)
		method.mockRejectedValue(new DifyError(403, 'forbidden', 'Site not found.'))
		const response = await handler(get(path), ctx)
		expect(response.status).toBe(403)
		await expect(response.json()).resolves.toEqual({ code: 'forbidden', message: 'Site not found.', status: 403 })
	})
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/dify-route.test.ts __tests__/dify-routes-app.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `lib/dify/route.ts`**

```ts
import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'

import { difyClient, type DifyClient } from './client'
import { difyErrorResponse } from './errors'

export { errorResponseFrom } from './errors'

export interface DifyRouteContext {
	/** The Dify end-user id: the signed-in email (ADR-0006). */
	user: string
	actor: SessionUser
	appId: string
	apiBase: string
	dify: DifyClient
}

export type ResolvedDifyRoute = { ok: true; ctx: DifyRouteContext } | { ok: false; response: Response }

/**
 * The first three steps of every Dify handler (charter §4.1): the session first, so a revoked token learns nothing
 * about apps; then the app; then its credentials, which never leave the server. Each refusal is the envelope.
 */
export const resolveDifyRoute = async (params: Promise<{ appId: string }>): Promise<ResolvedDifyRoute> => {
	const actor = await verifySession()
	if (!actor) return { ok: false, response: difyErrorResponse('unauthorized', 'Sign in required.', 401) }
	const { appId } = await params
	const app = await getAppAccess(actor, appId)
	if (!app) return { ok: false, response: difyErrorResponse('app_not_found', 'No such app.', 404) }
	if (!app.enabled) return { ok: false, response: difyErrorResponse('app_disabled', 'This app is disabled.', 403) }
	return {
		ok: true,
		ctx: { user: actor.email, actor, appId, apiBase: app.credentials.apiBase, dify: difyClient(app.credentials) },
	}
}
```

- [ ] **Step 4: The four metadata routes**

`app/api/dify/[appId]/info/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** GET /info (docs/dify-service-api-1.17.1.md §1.1). */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/info'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		return Response.json(await resolved.ctx.dify.getInfo())
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/info')
	}
}
```

`parameters/route.ts`, `site/route.ts` and `meta/route.ts` are the same file with `getParameters`, `getSite`, `getMeta`, the route literal and the context string changed (`'/api/dify/[appId]/parameters'`, …). Write each in full.

- [ ] **Step 5: Run the tests, typegen, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-route.test.ts __tests__/dify-routes-app.test.ts && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint lib/dify/route.ts app/api/dify && pnpm exec oxfmt --write lib/dify/route.ts app/api/dify __tests__/dify-route.test.ts __tests__/dify-routes-app.test.ts`
Expected: green. (`RouteContext` is global after `next typegen`; if `tsc` cannot find it, check that `tsconfig.json` includes `.next/types/**/*.ts`, which it does.)

```bash
git add lib/dify/route.ts app/api/dify __tests__/dify-route.test.ts __tests__/dify-routes-app.test.ts
git commit -m "feat(dify): route foundation and the info, parameters, site and meta routes

resolveDifyRoute does session → app → credentials with each refusal in Dify's envelope; the four metadata routes answer Dify's JSON or its error as it came (charter §4.1).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 8: The chat-family routes

Charter §4.1 coverage rows 2 to 4; endpoint map §1.2.

**Files:**
- Create: `app/api/dify/[appId]/chat-messages/route.ts`, `app/api/dify/[appId]/chat-messages/[taskId]/stop/route.ts`, `app/api/dify/[appId]/messages/route.ts`, `app/api/dify/[appId]/messages/[messageId]/suggested/route.ts`, `app/api/dify/[appId]/messages/[messageId]/feedbacks/route.ts`, `app/api/dify/[appId]/conversations/route.ts`, `app/api/dify/[appId]/conversations/[conversationId]/route.ts`, `app/api/dify/[appId]/conversations/[conversationId]/name/route.ts`
- Test: `__tests__/dify-routes-chat.test.ts`

**Interfaces:**
- Consumes: `resolveDifyRoute`, `errorResponseFrom` (Task 7), `passthrough` and the client methods `chatMessages`, `stopChat`, `listMessages`, `getSuggested`, `createFeedback`, `listConversations`, `deleteConversation`, `renameConversation` (Task 4), the schemas `chatMessagesBody`, `messagesQuery`, `feedbackBody`, `conversationsQuery`, `renameConversationBody` and `parseJsonBody`/`parseQuery` (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dify-routes-chat.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: {
		chatMessages: vi.fn(),
		stopChat: vi.fn(),
		listMessages: vi.fn(),
		getSuggested: vi.fn(),
		createFeedback: vi.fn(),
		listConversations: vi.fn(),
		deleteConversation: vi.fn(),
		renameConversation: vi.fn(),
	},
}))
vi.mock('@/lib/auth/session', () => ({ verifySession, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/dify/client')>()),
	difyClient: () => client,
}))

import { POST as chatMessages } from '@/app/api/dify/[appId]/chat-messages/route'
import { POST as stopChat } from '@/app/api/dify/[appId]/chat-messages/[taskId]/stop/route'
import { DELETE as deleteConversation } from '@/app/api/dify/[appId]/conversations/[conversationId]/route'
import { POST as renameConversation } from '@/app/api/dify/[appId]/conversations/[conversationId]/name/route'
import { GET as listConversations } from '@/app/api/dify/[appId]/conversations/route'
import { POST as feedback } from '@/app/api/dify/[appId]/messages/[messageId]/feedbacks/route'
import { GET as suggested } from '@/app/api/dify/[appId]/messages/[messageId]/suggested/route'
import { GET as listMessages } from '@/app/api/dify/[appId]/messages/route'
import { DifyError } from '@/lib/dify/errors'

const USER = 'jane@example.com'
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = { id: 'u1', email: USER, name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const base = 'http://app/api/dify/app-1'
const json = (path: string, method: string, body: unknown) =>
	new NextRequest(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (path: string) => new NextRequest(`${base}${path}`)
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ appId: 'app-1', ...extra }) })

beforeEach(() => {
	verifySession.mockReset()
	verifySession.mockResolvedValue(actor)
	getAppAccess.mockReset()
	getAppAccess.mockResolvedValue(access)
	for (const fn of Object.values(client)) fn.mockReset()
})

describe('POST chat-messages', () => {
	it('validates, sets the user and passes the stream through', async () => {
		const upstream = new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
		client.chatMessages.mockResolvedValue(upstream)
		const request = json('/chat-messages', 'POST', { query: 'hi', inputs: {}, response_mode: 'streaming', user: 'evil' })
		const response = await chatMessages(request, params())
		expect(client.chatMessages).toHaveBeenCalledWith(
			{ query: 'hi', inputs: {}, response_mode: 'streaming' },
			USER,
			expect.any(AbortSignal),
		)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		await expect(response.text()).resolves.toBe('data: {}\n\n')
	})
	it('answers 400 invalid_param for a bad body without calling Dify', async () => {
		const response = await chatMessages(json('/chat-messages', 'POST', { inputs: {} }), params())
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param' })
		expect(client.chatMessages).not.toHaveBeenCalled()
	})
	it('refuses without a session before reading the body', async () => {
		verifySession.mockResolvedValue(null)
		expect((await chatMessages(json('/chat-messages', 'POST', {}), params())).status).toBe(401)
	})
	it("answers Dify's envelope for a refused request", async () => {
		client.chatMessages.mockRejectedValue(new DifyError(400, 'not_chat_app', 'Please check your app mode.'))
		const response = await chatMessages(json('/chat-messages', 'POST', { query: 'q', inputs: {} }), params())
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({ code: 'not_chat_app', message: 'Please check your app mode.', status: 400 })
	})
})

describe('POST chat-messages/[taskId]/stop', () => {
	it("stops the task for the session user and answers Dify's body", async () => {
		client.stopChat.mockResolvedValue({ result: 'success' })
		const response = await stopChat(json('/chat-messages/t1/stop', 'POST', { user: 'evil' }), params({ taskId: 't1' }))
		expect(client.stopChat).toHaveBeenCalledWith('t1', USER)
		await expect(response.json()).resolves.toEqual({ result: 'success' })
	})
})

describe('GET messages', () => {
	it('validates the query, adds the user and answers the page', async () => {
		client.listMessages.mockResolvedValue({ limit: 20, has_more: false, data: [] })
		const response = await listMessages(get(`/messages?conversation_id=${UUID}&limit=20&user=evil`), params())
		expect(client.listMessages).toHaveBeenCalledWith({ conversation_id: UUID, limit: 20 }, USER)
		await expect(response.json()).resolves.toEqual({ limit: 20, has_more: false, data: [] })
	})
	it('answers 400 for a missing conversation_id', async () => {
		expect((await listMessages(get('/messages'), params())).status).toBe(400)
		expect(client.listMessages).not.toHaveBeenCalled()
	})
})

describe('GET messages/[messageId]/suggested and POST feedbacks', () => {
	it('passes the message id and the user', async () => {
		client.getSuggested.mockResolvedValue({ result: 'success', data: ['a'] })
		await expect((await suggested(get('/messages/m1/suggested'), params({ messageId: 'm1' }))).json()).resolves.toEqual({ result: 'success', data: ['a'] })
		expect(client.getSuggested).toHaveBeenCalledWith('m1', USER)
		client.createFeedback.mockResolvedValue({ result: 'success' })
		const response = await feedback(json('/messages/m1/feedbacks', 'POST', { rating: 'like', content: '', user: 'evil' }), params({ messageId: 'm1' }))
		expect(client.createFeedback).toHaveBeenCalledWith('m1', { rating: 'like', content: '' }, USER)
		await expect(response.json()).resolves.toEqual({ result: 'success' })
	})
	it('refuses a rating outside like, dislike, null', async () => {
		expect((await feedback(json('/messages/m1/feedbacks', 'POST', { rating: 'meh' }), params({ messageId: 'm1' }))).status).toBe(400)
	})
})

describe('conversations', () => {
	it('lists with the validated query and the user', async () => {
		client.listConversations.mockResolvedValue({ limit: 100, has_more: false, data: [] })
		await listConversations(get('/conversations?limit=100&sort_by=-updated_at'), params())
		expect(client.listConversations).toHaveBeenCalledWith({ limit: 100, sort_by: '-updated_at' }, USER)
	})
	it('deletes with 204 and no body', async () => {
		client.deleteConversation.mockResolvedValue(undefined)
		const response = await deleteConversation(new NextRequest(`${base}/conversations/${UUID}`, { method: 'DELETE' }), params({ conversationId: UUID }))
		expect(client.deleteConversation).toHaveBeenCalledWith(UUID, USER)
		expect(response.status).toBe(204)
		expect(response.body).toBeNull()
	})
	it("renames and answers Dify's conversation; refuses an empty body", async () => {
		client.renameConversation.mockResolvedValue({ id: UUID, name: 'Tea' })
		const response = await renameConversation(json(`/conversations/${UUID}/name`, 'POST', { name: 'Tea' }), params({ conversationId: UUID }))
		expect(client.renameConversation).toHaveBeenCalledWith(UUID, { name: 'Tea' }, USER)
		await expect(response.json()).resolves.toEqual({ id: UUID, name: 'Tea' })
		expect((await renameConversation(json(`/conversations/${UUID}/name`, 'POST', {}), params({ conversationId: UUID }))).status).toBe(400)
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/dify-routes-chat.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the eight routes**

`app/api/dify/[appId]/chat-messages/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { chatMessagesBody, parseJsonBody } from '@/lib/dify/schemas'

/** POST /chat-messages (endpoint map §1.2): the stream passes through; a blocking answer is JSON and passes through too. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/chat-messages'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, chatMessagesBody)
	if (!body.ok) return body.response
	try {
		const { dify, user } = resolved.ctx
		// The client's abort (a stopped reply) cancels the upstream fetch through the request's signal.
		return passthrough(await dify.chatMessages(body.data, user, request.signal))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/chat-messages')
	}
}
```

`app/api/dify/[appId]/chat-messages/[taskId]/stop/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** POST /chat-messages/{task_id}/stop: the body carries only `user`, which the route sets. */
export async function POST(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/chat-messages/[taskId]/stop'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { taskId } = await ctx.params
		return Response.json(await resolved.ctx.dify.stopChat(taskId, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/chat-messages/[taskId]/stop')
	}
}
```

`app/api/dify/[appId]/messages/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { messagesQuery, parseQuery } from '@/lib/dify/schemas'

/** GET /messages?conversation_id=&first_id=&limit= (endpoint map §1.2). */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/messages'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, messagesQuery)
	if (!query.ok) return query.response
	try {
		return Response.json(await resolved.ctx.dify.listMessages(query.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/messages')
	}
}
```

`app/api/dify/[appId]/messages/[messageId]/suggested/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** GET /messages/{message_id}/suggested. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/messages/[messageId]/suggested'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { messageId } = await ctx.params
		return Response.json(await resolved.ctx.dify.getSuggested(messageId, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/messages/[messageId]/suggested')
	}
}
```

`app/api/dify/[appId]/messages/[messageId]/feedbacks/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { feedbackBody, parseJsonBody } from '@/lib/dify/schemas'

/** POST /messages/{message_id}/feedbacks: `{ rating, content }`, user set here; answers `{ result: "success" }`. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/messages/[messageId]/feedbacks'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, feedbackBody)
	if (!body.ok) return body.response
	try {
		const { messageId } = await ctx.params
		return Response.json(await resolved.ctx.dify.createFeedback(messageId, body.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/messages/[messageId]/feedbacks')
	}
}
```

`app/api/dify/[appId]/conversations/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { conversationsQuery, parseQuery } from '@/lib/dify/schemas'

/** GET /conversations?last_id=&limit=&sort_by= (endpoint map §1.2). */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/conversations'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, conversationsQuery)
	if (!query.ok) return query.response
	try {
		return Response.json(await resolved.ctx.dify.listConversations(query.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/conversations')
	}
}
```

`app/api/dify/[appId]/conversations/[conversationId]/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** DELETE /conversations/{conversation_id}: Dify answers 204, and so does this route. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/conversations/[conversationId]'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { conversationId } = await ctx.params
		await resolved.ctx.dify.deleteConversation(conversationId, resolved.ctx.user)
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(error, 'DELETE /api/dify/[appId]/conversations/[conversationId]')
	}
}
```

`app/api/dify/[appId]/conversations/[conversationId]/name/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseJsonBody, renameConversationBody } from '@/lib/dify/schemas'

/** POST /conversations/{conversation_id}/name: `{ name }` or `{ auto_generate: true }`; answers the conversation. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/conversations/[conversationId]/name'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, renameConversationBody)
	if (!body.ok) return body.response
	try {
		const { conversationId } = await ctx.params
		return Response.json(await resolved.ctx.dify.renameConversation(conversationId, body.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/conversations/[conversationId]/name')
	}
}
```

- [ ] **Step 4: Run the tests, typegen, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-routes-chat.test.ts && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint app/api/dify && pnpm exec oxfmt --write app/api/dify __tests__/dify-routes-chat.test.ts`
Expected: green.

```bash
git add app/api/dify __tests__/dify-routes-chat.test.ts
git commit -m "feat(dify): chat-family routes on Dify's paths

chat-messages (stream passthrough, abort through the request signal), its stop, messages, suggested, feedbacks, conversations list, delete (204) and rename, each validating with its schema and setting the session user (endpoint map §1.2).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 9: Completion, workflow, events and human-input routes

Charter §4.1 coverage rows 5 to 8 (the two stops and the form GET are the recorded follow-ups); endpoint map §1.3 to §1.5.

**Files:**
- Create: `app/api/dify/[appId]/completion-messages/route.ts`, `app/api/dify/[appId]/completion-messages/[taskId]/stop/route.ts`, `app/api/dify/[appId]/workflows/run/route.ts`, `app/api/dify/[appId]/workflows/tasks/[taskId]/stop/route.ts`, `app/api/dify/[appId]/workflow/[workflowRunId]/events/route.ts`, `app/api/dify/[appId]/form/human_input/[formToken]/route.ts`
- Test: `__tests__/dify-routes-run.test.ts`

**Interfaces:**
- Consumes: Task 7's `resolveDifyRoute`/`errorResponseFrom`, Task 4's `passthrough`, `completionMessages`, `stopCompletion`, `runWorkflow`, `stopWorkflow`, `workflowEvents`, `getHumanInputForm`, `submitHumanInput`, Task 5's `completionBody`, `workflowRunBody`, `workflowEventsQuery`, `humanInputBody`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dify-routes-run.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: {
		completionMessages: vi.fn(),
		stopCompletion: vi.fn(),
		runWorkflow: vi.fn(),
		stopWorkflow: vi.fn(),
		workflowEvents: vi.fn(),
		getHumanInputForm: vi.fn(),
		submitHumanInput: vi.fn(),
	},
}))
vi.mock('@/lib/auth/session', () => ({ verifySession, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/dify/client')>()),
	difyClient: () => client,
}))

import { POST as completion } from '@/app/api/dify/[appId]/completion-messages/route'
import { POST as stopCompletion } from '@/app/api/dify/[appId]/completion-messages/[taskId]/stop/route'
import { GET as getForm, POST as submitForm } from '@/app/api/dify/[appId]/form/human_input/[formToken]/route'
import { GET as events } from '@/app/api/dify/[appId]/workflow/[workflowRunId]/events/route'
import { POST as runWorkflow } from '@/app/api/dify/[appId]/workflows/run/route'
import { POST as stopWorkflow } from '@/app/api/dify/[appId]/workflows/tasks/[taskId]/stop/route'
import { DifyError } from '@/lib/dify/errors'

const USER = 'jane@example.com'
const actor = { id: 'u1', email: USER, name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const base = 'http://app/api/dify/app-1'
const json = (path: string, body: unknown) =>
	new NextRequest(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (path: string) => new NextRequest(`${base}${path}`)
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ appId: 'app-1', ...extra }) })
const stream = () => new Response('event: ping\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })

beforeEach(() => {
	verifySession.mockReset()
	verifySession.mockResolvedValue(actor)
	getAppAccess.mockReset()
	getAppAccess.mockResolvedValue(access)
	for (const fn of Object.values(client)) fn.mockReset()
})

describe('runs', () => {
	it('completion-messages validates, sets the user and passes the stream through', async () => {
		client.completionMessages.mockResolvedValue(stream())
		const response = await completion(json('/completion-messages', { inputs: { topic: 'tea' }, response_mode: 'streaming', user: 'evil' }), params())
		expect(client.completionMessages).toHaveBeenCalledWith({ inputs: { topic: 'tea' }, response_mode: 'streaming' }, USER, expect.any(AbortSignal))
		expect(response.headers.get('content-type')).toBe('text/event-stream')
	})
	it('workflows/run does the same', async () => {
		client.runWorkflow.mockResolvedValue(stream())
		await runWorkflow(json('/workflows/run', { inputs: { topic: 'tea' }, response_mode: 'streaming' }), params())
		expect(client.runWorkflow).toHaveBeenCalledWith({ inputs: { topic: 'tea' }, response_mode: 'streaming' }, USER, expect.any(AbortSignal))
	})
	it("passes Dify's refusal through before any stream", async () => {
		client.runWorkflow.mockRejectedValue(new DifyError(400, 'invalid_param', 'topic is not valid.'))
		const response = await runWorkflow(json('/workflows/run', { inputs: { topic: 'invalid' } }), params())
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({ code: 'invalid_param', message: 'topic is not valid.', status: 400 })
	})
	it('the two stops post the task id with the session user', async () => {
		client.stopCompletion.mockResolvedValue({ result: 'success' })
		client.stopWorkflow.mockResolvedValue({ result: 'success' })
		await stopCompletion(json('/completion-messages/t1/stop', {}), params({ taskId: 't1' }))
		expect(client.stopCompletion).toHaveBeenCalledWith('t1', USER)
		const response = await stopWorkflow(json('/workflows/tasks/t2/stop', {}), params({ taskId: 't2' }))
		expect(client.stopWorkflow).toHaveBeenCalledWith('t2', USER)
		await expect(response.json()).resolves.toEqual({ result: 'success' })
	})
})

describe('workflow events', () => {
	it('validates the flags, sets the user and passes the stream through', async () => {
		client.workflowEvents.mockResolvedValue(stream())
		const response = await events(get('/workflow/run-1/events?continue_on_pause=true&user=evil'), params({ workflowRunId: 'run-1' }))
		expect(client.workflowEvents).toHaveBeenCalledWith('run-1', USER, { continue_on_pause: true }, expect.any(AbortSignal))
		expect(response.headers.get('content-type')).toBe('text/event-stream')
	})
	it('refuses a flag that is not true/false', async () => {
		expect((await events(get('/workflow/run-1/events?continue_on_pause=yes'), params({ workflowRunId: 'run-1' }))).status).toBe(400)
	})
})

describe('human input form', () => {
	it('GET answers the definition', async () => {
		const form = { form_content: 'Review', inputs: [], resolved_default_values: {}, user_actions: [], expiration_time: 1 }
		client.getHumanInputForm.mockResolvedValue(form)
		const response = await getForm(get('/form/human_input/tok'), params({ formToken: 'tok' }))
		expect(client.getHumanInputForm).toHaveBeenCalledWith('tok')
		await expect(response.json()).resolves.toEqual(form)
	})
	it('POST validates, sets the user, answers {} and passes 412 through', async () => {
		client.submitHumanInput.mockResolvedValue({})
		const response = await submitForm(json('/form/human_input/tok', { inputs: { feedback: 'ok' }, action: 'approve', user: 'evil' }), params({ formToken: 'tok' }))
		expect(client.submitHumanInput).toHaveBeenCalledWith('tok', { inputs: { feedback: 'ok' }, action: 'approve' }, USER)
		await expect(response.json()).resolves.toEqual({})
		client.submitHumanInput.mockRejectedValue(new DifyError(412, 'human_input_form_expired', 'This form has expired.'))
		const refused = await submitForm(json('/form/human_input/tok', { inputs: {}, action: 'approve' }), params({ formToken: 'tok' }))
		expect(refused.status).toBe(412)
		await expect(refused.json()).resolves.toEqual({ code: 'human_input_form_expired', message: 'This form has expired.', status: 412 })
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/dify-routes-run.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the six routes**

`app/api/dify/[appId]/completion-messages/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { completionBody, parseJsonBody } from '@/lib/dify/schemas'

/** POST /completion-messages (endpoint map §1.3). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/completion-messages'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, completionBody)
	if (!body.ok) return body.response
	try {
		return passthrough(await resolved.ctx.dify.completionMessages(body.data, resolved.ctx.user, request.signal))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/completion-messages')
	}
}
```

`app/api/dify/[appId]/completion-messages/[taskId]/stop/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** POST /completion-messages/{task_id}/stop (a recorded follow-up of ADR-0017). */
export async function POST(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/completion-messages/[taskId]/stop'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { taskId } = await ctx.params
		return Response.json(await resolved.ctx.dify.stopCompletion(taskId, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/completion-messages/[taskId]/stop')
	}
}
```

`app/api/dify/[appId]/workflows/run/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseJsonBody, workflowRunBody } from '@/lib/dify/schemas'

/** POST /workflows/run (endpoint map §1.4). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/workflows/run'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, workflowRunBody)
	if (!body.ok) return body.response
	try {
		return passthrough(await resolved.ctx.dify.runWorkflow(body.data, resolved.ctx.user, request.signal))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/workflows/run')
	}
}
```

`app/api/dify/[appId]/workflows/tasks/[taskId]/stop/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'

/** POST /workflows/tasks/{task_id}/stop (a recorded follow-up of ADR-0017). */
export async function POST(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/workflows/tasks/[taskId]/stop'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { taskId } = await ctx.params
		return Response.json(await resolved.ctx.dify.stopWorkflow(taskId, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/workflows/tasks/[taskId]/stop')
	}
}
```

`app/api/dify/[appId]/workflow/[workflowRunId]/events/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseQuery, workflowEventsQuery } from '@/lib/dify/schemas'

/** GET /workflow/{workflow_run_id}/events (Dify's singular path; endpoint map §1.4): the resumed run's stream. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/workflow/[workflowRunId]/events'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, workflowEventsQuery)
	if (!query.ok) return query.response
	try {
		const { workflowRunId } = await ctx.params
		return passthrough(await resolved.ctx.dify.workflowEvents(workflowRunId, resolved.ctx.user, query.data, request.signal))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/workflow/[workflowRunId]/events')
	}
}
```

`app/api/dify/[appId]/form/human_input/[formToken]/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { humanInputBody, parseJsonBody } from '@/lib/dify/schemas'

/** GET /form/human_input/{form_token}: the form definition (a recorded follow-up of ADR-0017). */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/form/human_input/[formToken]'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { formToken } = await ctx.params
		return Response.json(await resolved.ctx.dify.getHumanInputForm(formToken))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/form/human_input/[formToken]')
	}
}

/** POST /form/human_input/{form_token}: `{ inputs, action }`, user set here; Dify answers `{}`, or 412 for a used or expired form. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/form/human_input/[formToken]'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, humanInputBody)
	if (!body.ok) return body.response
	try {
		const { formToken } = await ctx.params
		return Response.json(await resolved.ctx.dify.submitHumanInput(formToken, body.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/form/human_input/[formToken]')
	}
}
```

- [ ] **Step 4: Run the tests, typegen, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-routes-run.test.ts && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint app/api/dify && pnpm exec oxfmt --write app/api/dify __tests__/dify-routes-run.test.ts`
Expected: green.

```bash
git add app/api/dify __tests__/dify-routes-run.test.ts
git commit -m "feat(dify): completion, workflow, events and human-input routes, with both stops and the form GET

completion-messages and workflows/run pass their streams through; the completion and workflow stops and GET /form/human_input are the follow-ups ADR-0017 recorded; the events route keeps Dify's singular path (endpoint map §1.3 to §1.5).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 10: Files, audio, annotations and the app icon route

Charter §4.1 coverage rows 9 to 11 and "Audio", §4.4 (the icon route), §4.1 "App data for the browser" (the remote-file route for links Dify hands out). Review Focus 2 and 5.

**Files:**
- Create: `lib/dify/remote-file.ts`, `app/api/dify/[appId]/files/upload/route.ts`, `app/api/dify/[appId]/files/[fileId]/preview/route.ts`, `app/api/dify/[appId]/files/remote/route.ts`, `app/api/dify/[appId]/audio-to-text/route.ts`, `app/api/dify/[appId]/text-to-audio/route.ts`, `app/api/dify/[appId]/apps/annotations/route.ts`, `app/api/dify/[appId]/apps/annotations/[annotationId]/route.ts`, `app/api/apps/[appId]/icon/route.ts`
- Test: `__tests__/dify-remote-file.test.ts`, `__tests__/dify-routes-files.test.ts`, `__tests__/app-icon-route.test.ts`

**Interfaces:**
- Produces: `resolveRemoteFileUrl(raw: string, apiBase: string): URL | null` (pure).
- Consumes: Task 7's helpers, Task 4's `uploadFile`, `filePreview`, `fetchRemoteFile`, `audioToText`, `textToAudio`, `listAnnotations`, `createAnnotation`, `updateAnnotation`, `deleteAnnotation`, `passthrough`; Task 5's `parseFilePart`, `filePreviewQuery`, `remoteFileQuery`, `textToAudioBody`, `annotationsQuery`, `annotationBody`; Task 6's `getAppIcon`; Task 2's `verifySession`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dify-remote-file.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { resolveRemoteFileUrl } from '@/lib/dify/remote-file'

const BASE = 'https://dify.example/v1'

// Review Focus 5
describe('resolveRemoteFileUrl', () => {
	it('accepts an absolute URL on the Dify origin under /files/', () => {
		expect(resolveRemoteFileUrl('https://dify.example/files/tools/x.png?sign=1', BASE)?.toString()).toBe('https://dify.example/files/tools/x.png?sign=1')
		expect(resolveRemoteFileUrl('https://dify.example/v1/files/abc/preview', BASE)?.toString()).toBe('https://dify.example/v1/files/abc/preview')
	})
	it('resolves a relative link against the Dify origin', () => {
		expect(resolveRemoteFileUrl('/files/upload/x.png', BASE)?.toString()).toBe('https://dify.example/files/upload/x.png')
	})
	it('refuses other origins, other schemes, other paths and traversal', () => {
		expect(resolveRemoteFileUrl('https://evil.example/files/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('http://dify.example/files/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('javascript:alert(1)', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('https://dify.example/console/api/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('/files/../console/x', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('not a url at all', BASE)).toBeNull()
		expect(resolveRemoteFileUrl('', BASE)).toBeNull()
	})
})
```

Create `__tests__/dify-routes-files.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, client } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	client: {
		uploadFile: vi.fn(),
		filePreview: vi.fn(),
		fetchRemoteFile: vi.fn(),
		audioToText: vi.fn(),
		textToAudio: vi.fn(),
		listAnnotations: vi.fn(),
		createAnnotation: vi.fn(),
		updateAnnotation: vi.fn(),
		deleteAnnotation: vi.fn(),
	},
}))
vi.mock('@/lib/auth/session', () => ({ verifySession, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/dify/client', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/dify/client')>()),
	difyClient: () => client,
}))

import { DELETE as deleteAnnotation, PUT as updateAnnotation } from '@/app/api/dify/[appId]/apps/annotations/[annotationId]/route'
import { GET as listAnnotations, POST as createAnnotation } from '@/app/api/dify/[appId]/apps/annotations/route'
import { POST as audioToText } from '@/app/api/dify/[appId]/audio-to-text/route'
import { GET as preview } from '@/app/api/dify/[appId]/files/[fileId]/preview/route'
import { GET as remote } from '@/app/api/dify/[appId]/files/remote/route'
import { POST as upload } from '@/app/api/dify/[appId]/files/upload/route'
import { POST as textToAudio } from '@/app/api/dify/[appId]/text-to-audio/route'

const USER = 'jane@example.com'
const actor = { id: 'u1', email: USER, name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'https://dify.example/v1', apiKey: 'k' } }
const base = 'http://app/api/dify/app-1'
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ appId: 'app-1', ...extra }) })
const multipart = (parts: Array<[string, File | string]>) => {
	const form = new FormData()
	for (const [name, value] of parts) form.append(name, value)
	return new NextRequest(`${base}/x`, { method: 'POST', body: form })
}
const json = (path: string, method: string, body: unknown) =>
	new NextRequest(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const binary = (type: string, extra: Record<string, string> = {}) =>
	new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': type, ...extra } })

beforeEach(() => {
	verifySession.mockReset()
	verifySession.mockResolvedValue(actor)
	getAppAccess.mockReset()
	getAppAccess.mockResolvedValue(access)
	for (const fn of Object.values(client)) fn.mockReset()
})

describe('files', () => {
	it('upload forwards the one file part with the session user and answers 201', async () => {
		client.uploadFile.mockResolvedValue({ id: 'f1', name: 'a.txt' })
		const response = await upload(multipart([['file', new File(['x'], 'a.txt', { type: 'text/plain' })], ['user', 'evil']]), params())
		expect(client.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt' }), USER)
		expect(response.status).toBe(201)
		await expect(response.json()).resolves.toEqual({ id: 'f1', name: 'a.txt' })
	})
	// Review Focus 2
	it('upload refuses a body without a file part', async () => {
		const response = await upload(multipart([['user', 'x']]), params())
		expect(response.status).toBe(400)
		expect(client.uploadFile).not.toHaveBeenCalled()
	})
	it('preview passes the binary through with its disposition', async () => {
		client.filePreview.mockResolvedValue(binary('image/png', { 'content-disposition': 'attachment; filename="a.png"', 'x-version': '1' }))
		const response = await preview(new NextRequest(`${base}/files/f1/preview?as_attachment=true`), params({ fileId: 'f1' }))
		expect(client.filePreview).toHaveBeenCalledWith('f1', true, USER)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="a.png"')
		expect(response.headers.get('x-version')).toBeNull()
	})
	it('remote fetches a link on the Dify origin and refuses any other (Review Focus 5)', async () => {
		client.fetchRemoteFile.mockResolvedValue(binary('image/png'))
		const ok = await remote(new NextRequest(`${base}/files/remote?url=${encodeURIComponent('https://dify.example/files/tools/x.png?sign=1')}`), params())
		expect(client.fetchRemoteFile).toHaveBeenCalledWith(new URL('https://dify.example/files/tools/x.png?sign=1'))
		expect(ok.headers.get('content-type')).toBe('image/png')
		const bad = await remote(new NextRequest(`${base}/files/remote?url=${encodeURIComponent('https://evil.example/files/x.png')}`), params())
		expect(bad.status).toBe(400)
		expect(client.fetchRemoteFile).toHaveBeenCalledTimes(1)
	})
})

describe('audio', () => {
	it('audio-to-text forwards the recording under its own type and name', async () => {
		client.audioToText.mockResolvedValue({ text: 'hello' })
		const file = new File(['x'], 'speech.webm', { type: 'audio/webm;codecs=opus' })
		const response = await audioToText(multipart([['file', file]]), params())
		const sent = client.audioToText.mock.calls[0][0] as File
		expect(sent.name).toBe('speech.webm')
		expect(sent.type).toBe('audio/webm;codecs=opus')
		await expect(response.json()).resolves.toEqual({ text: 'hello' })
	})
	it('text-to-audio validates and passes the audio through', async () => {
		client.textToAudio.mockResolvedValue(binary('audio/wav'))
		const response = await textToAudio(json('/text-to-audio', 'POST', { text: 'hi', user: 'evil' }), params())
		expect(client.textToAudio).toHaveBeenCalledWith({ text: 'hi' }, USER)
		expect(response.headers.get('content-type')).toBe('audio/wav')
		expect((await textToAudio(json('/text-to-audio', 'POST', { voice: 'x' }), params())).status).toBe(400)
	})
})

describe('annotations', () => {
	it('lists with the validated query', async () => {
		client.listAnnotations.mockResolvedValue({ data: [], has_more: false, limit: 10, total: 0, page: 1 })
		await listAnnotations(new NextRequest(`${base}/apps/annotations?page=1&limit=10&keyword=tea`), params())
		expect(client.listAnnotations).toHaveBeenCalledWith({ page: 1, limit: 10, keyword: 'tea' })
	})
	it('creates with 201, updates, deletes with 204', async () => {
		client.createAnnotation.mockResolvedValue({ id: 'a1', question: 'q', answer: 'a', hit_count: 0, created_at: 1 })
		const created = await createAnnotation(json('/apps/annotations', 'POST', { question: 'q', answer: 'a' }), params())
		expect(created.status).toBe(201)
		client.updateAnnotation.mockResolvedValue({ id: 'a1', question: 'q', answer: 'b', hit_count: 0, created_at: 1 })
		const updated = await updateAnnotation(json('/apps/annotations/a1', 'PUT', { question: 'q', answer: 'b' }), params({ annotationId: 'a1' }))
		expect(client.updateAnnotation).toHaveBeenCalledWith('a1', { question: 'q', answer: 'b' })
		expect(updated.status).toBe(200)
		client.deleteAnnotation.mockResolvedValue(undefined)
		const deleted = await deleteAnnotation(new NextRequest(`${base}/apps/annotations/a1`, { method: 'DELETE' }), params({ annotationId: 'a1' }))
		expect(deleted.status).toBe(204)
	})
	it('refuses a blank question', async () => {
		expect((await createAnnotation(json('/apps/annotations', 'POST', { question: '  ', answer: 'a' }), params())).status).toBe(400)
	})
})
```

Create `__tests__/app-icon-route.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppIcon } = vi.hoisted(() => ({ verifySession: vi.fn(), getAppIcon: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ verifySession, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/data/apps', () => ({ getAppIcon }))

import { GET } from '@/app/api/apps/[appId]/icon/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const ctx = { params: Promise.resolve({ appId: 'app-1' }) }
const get = (headers: Record<string, string> = {}) => new NextRequest('http://app/api/apps/app-1/icon', { headers })

beforeEach(() => {
	verifySession.mockReset()
	getAppIcon.mockReset()
})

describe('GET /api/apps/[appId]/icon', () => {
	it('refuses without a session', async () => {
		verifySession.mockResolvedValue(null)
		expect((await GET(get(), ctx)).status).toBe(401)
	})
	it('answers 404 when the app has no stored image', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue(null)
		expect((await GET(get(), ctx)).status).toBe(404)
	})
	it('serves the bytes with their type, an ETag and a private cache header, and 304 on a matching ETag', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), mime: 'image/png' })
		const response = await GET(get(), ctx)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
		const etag = response.headers.get('etag')
		expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
		const cached = await GET(get({ 'if-none-match': etag! }), ctx)
		expect(cached.status).toBe(304)
		expect(cached.headers.get('etag')).toBe(etag)
	})
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/dify-remote-file.test.ts __tests__/dify-routes-files.test.ts __tests__/app-icon-route.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `lib/dify/remote-file.ts`**

```ts
/**
 * A file link Dify handed out (a message file's `url`, a generated image, a `source_url`) as a URL the app may
 * fetch on the user's behalf: the Dify origin only (scheme, host and port of the app's API base), under `/files/`
 * or `<base path>/files/`, with no traversal (the URL parser normalises `..`, so the check runs on the final
 * path). Anything else is null and the route answers 400 (Review Focus 5).
 */
export const resolveRemoteFileUrl = (raw: string, apiBase: string): URL | null => {
	if (!raw) return null
	let base: URL
	let url: URL
	try {
		base = new URL(apiBase)
		url = new URL(raw, base.origin)
	} catch {
		return null
	}
	if (url.origin !== base.origin) return null
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
	const basePath = base.pathname.replace(/\/+$/, '')
	const allowed = url.pathname.startsWith('/files/') || url.pathname.startsWith(`${basePath}/files/`)
	return allowed ? url : null
}
```

- [ ] **Step 4: The seven Dify routes**

`app/api/dify/[appId]/files/upload/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseFilePart } from '@/lib/dify/schemas'

/** POST /files/upload (endpoint map §1.6): one file part, user set here; Dify answers 201 with the file. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/files/upload'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const part = await parseFilePart(request)
	if (!part.ok) return part.response
	try {
		return Response.json(await resolved.ctx.dify.uploadFile(part.data, resolved.ctx.user), { status: 201 })
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/files/upload')
	}
}
```

`app/api/dify/[appId]/files/[fileId]/preview/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { filePreviewQuery, parseQuery } from '@/lib/dify/schemas'

/** GET /files/{file_id}/preview?as_attachment= : the binary with its type and disposition (endpoint map §1.6). */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/files/[fileId]/preview'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, filePreviewQuery)
	if (!query.ok) return query.response
	try {
		const { fileId } = await ctx.params
		return passthrough(await resolved.ctx.dify.filePreview(fileId, query.data.as_attachment ?? false, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/files/[fileId]/preview')
	}
}
```

`app/api/dify/[appId]/files/remote/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { difyErrorResponse } from '@/lib/dify/errors'
import { resolveRemoteFileUrl } from '@/lib/dify/remote-file'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseQuery, remoteFileQuery } from '@/lib/dify/schemas'

/**
 * GET /files/remote?url= : a link Dify handed out (message files, generated images), fetched on the user's behalf so
 * the Dify host never reaches the browser (charter §4.1). Only the app's Dify origin under /files/ is allowed.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/files/remote'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, remoteFileQuery)
	if (!query.ok) return query.response
	const target = resolveRemoteFileUrl(query.data.url, resolved.ctx.apiBase)
	if (!target) return difyErrorResponse('invalid_param', 'url must be a file link on the app’s Dify server.', 400)
	try {
		return passthrough(await resolved.ctx.dify.fetchRemoteFile(target))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/files/remote')
	}
}
```

`app/api/dify/[appId]/audio-to-text/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseFilePart } from '@/lib/dify/schemas'

/**
 * POST /audio-to-text: the recording goes to Dify under its real type and name (charter §4.1 "Audio": no
 * relabelling; whether the owner's Dify accepts WebM is verified against it, and recorded in the task report).
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/audio-to-text'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const part = await parseFilePart(request)
	if (!part.ok) return part.response
	try {
		return Response.json(await resolved.ctx.dify.audioToText(part.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/audio-to-text')
	}
}
```

`app/api/dify/[appId]/text-to-audio/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { passthrough } from '@/lib/dify/client'
import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { parseJsonBody, textToAudioBody } from '@/lib/dify/schemas'

/** POST /text-to-audio: `{ message_id | text, voice }`, user set here; the audio passes through. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/text-to-audio'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, textToAudioBody)
	if (!body.ok) return body.response
	try {
		return passthrough(await resolved.ctx.dify.textToAudio(body.data, resolved.ctx.user))
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/text-to-audio')
	}
}
```

`app/api/dify/[appId]/apps/annotations/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { annotationBody, annotationsQuery, parseJsonBody, parseQuery } from '@/lib/dify/schemas'

/** GET /apps/annotations?page=&limit=&keyword= (endpoint map §1.7). Admin-only from B2 on (charter §4.1). */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/apps/annotations'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, annotationsQuery)
	if (!query.ok) return query.response
	try {
		return Response.json(await resolved.ctx.dify.listAnnotations(query.data))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/dify/[appId]/apps/annotations')
	}
}

/** POST /apps/annotations: any signed-in user may annotate when the app enables it; Dify answers 201. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/apps/annotations'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, annotationBody)
	if (!body.ok) return body.response
	try {
		return Response.json(await resolved.ctx.dify.createAnnotation(body.data), { status: 201 })
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/dify/[appId]/apps/annotations')
	}
}
```

`app/api/dify/[appId]/apps/annotations/[annotationId]/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom, resolveDifyRoute } from '@/lib/dify/route'
import { annotationBody, parseJsonBody } from '@/lib/dify/schemas'

/** PUT /apps/annotations/{annotation_id}. Admin-only from B2 on. */
export async function PUT(request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/apps/annotations/[annotationId]'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, annotationBody)
	if (!body.ok) return body.response
	try {
		const { annotationId } = await ctx.params
		return Response.json(await resolved.ctx.dify.updateAnnotation(annotationId, body.data))
	} catch (error) {
		return errorResponseFrom(error, 'PUT /api/dify/[appId]/apps/annotations/[annotationId]')
	}
}

/** DELETE /apps/annotations/{annotation_id}: 204. Admin-only from B2 on. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/dify/[appId]/apps/annotations/[annotationId]'>) {
	const resolved = await resolveDifyRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { annotationId } = await ctx.params
		await resolved.ctx.dify.deleteAnnotation(annotationId)
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(error, 'DELETE /api/dify/[appId]/apps/annotations/[annotationId]')
	}
}
```

- [ ] **Step 5: The icon route**

`app/api/apps/[appId]/icon/route.ts`:

```ts
import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'

import { verifySession } from '@/lib/auth/session'
import { getAppIcon } from '@/lib/data/apps'
import { difyErrorResponse, errorResponseFrom } from '@/lib/dify/errors'

/**
 * The app's stored Dify icon image (charter §4.4): signed-in callers only (an <img> on a gated page sends the
 * cookie), an ETag from the bytes so a reload costs 304, cached privately for a day.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/apps/[appId]/icon'>) {
	const actor = await verifySession()
	if (!actor) return difyErrorResponse('unauthorized', 'Sign in required.', 401)
	try {
		const { appId } = await ctx.params
		const icon = await getAppIcon(actor, appId)
		if (!icon) return difyErrorResponse('icon_not_found', 'This app has no stored icon image.', 404)
		const etag = `"${createHash('sha256').update(icon.bytes).digest('hex').slice(0, 32)}"`
		const headers = { etag, 'cache-control': 'private, max-age=86400' }
		if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
		return new Response(new Uint8Array(icon.bytes), {
			headers: { ...headers, 'content-type': icon.mime, 'content-length': String(icon.bytes.length) },
		})
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/icon')
	}
}
```

- [ ] **Step 6: Run the tests, typegen, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-remote-file.test.ts __tests__/dify-routes-files.test.ts __tests__/app-icon-route.test.ts && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint app/api lib/dify && pnpm exec oxfmt --write app/api lib/dify/remote-file.ts __tests__/dify-remote-file.test.ts __tests__/dify-routes-files.test.ts __tests__/app-icon-route.test.ts`
Expected: green. All 24 Dify route files plus the icon route now exist beside the old `app/api/client/**` tree, which Task 17 deletes.

```bash
git add app/api lib/dify/remote-file.ts __tests__/dify-remote-file.test.ts __tests__/dify-routes-files.test.ts __tests__/app-icon-route.test.ts
git commit -m "feat(dify): files, audio, annotations, the remote-file route and the stored app icon route

Upload (201), preview and remote files pass binaries through; the remote-file route accepts links on the app's Dify origin under /files/ only; audio-to-text forwards the recording as recorded; annotations on Dify's plural path with 201 and 204; GET /api/apps/[appId]/icon serves the stored image with an ETag (charter §4.1, §4.4).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 11: The browser client `lib/dify/browser.ts` and x-sdk's fetch option

Charter §4.1 "Contract to the browser" (one parser, `DifyRequestError`), header deviation 2.

**Files:**
- Create: `lib/dify/browser.ts`
- Modify: `components/chat/provider/dify-fetch.ts`
- Test: `__tests__/dify-browser.test.ts`, `__tests__/dify-fetch.test.ts`

**Interfaces:**
- Produces: `class DifyRequestError extends Error { status: number; code: string | undefined }`; `readDifyError(response): Promise<DifyRequestError>`; `createDifyApi(appId): DifyApi`; `interface DifyApi` with `getParameters`, `getSite`, `listConversations(query)`, `renameConversation(id, body)`, `deleteConversation(id)`, `listMessages(query)`, `getSuggested(messageId)`, `createFeedback(messageId, body)`, `stopChat(taskId)`, `stopCompletion(taskId)`, `stopWorkflow(taskId)`, `completion(body, signal?)`, `runWorkflow(body, signal?)` (both resolve the OK `Response`), `getHumanInputForm(token)`, `submitHumanInput(token, body)`, `uploadFile(file)`, `filePreview(fileId, { asAttachment? })` (OK `Response`), `audioToText(file)`, `textToAudio(body)` (OK `Response`), `listAnnotations(query)`, `createAnnotation(body)`, `updateAnnotation(id, body)`, `deleteAnnotation(id)`, `remoteFileUrl(url): string`, `chatMessagesUrl: string`, `workflowEventsUrl(runId): string`. Every JSON method resolves the typed body and rejects with `DifyRequestError` on a non-OK answer.
- `components/chat/provider/dify-fetch.ts` re-exports `DifyRequestError` and `readDifyError` (its importers keep working) and `createDifyFetch(appId)` posts to `chatMessagesUrl` or reads `workflowEventsUrl`.

- [ ] **Step 1: Write the failing browser-client test and update the fetch-option test**

Create `__tests__/dify-browser.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDifyApi, DifyRequestError } from '@/lib/dify/browser'

const jsonResponse = (status: number, body: unknown, type = 'application/json') =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined]
	return { url, init: init ?? {}, headers: new Headers(init?.headers) }
}
const api = createDifyApi('app 1')

describe('createDifyApi: paths on the app route tree, Dify’s verbs', () => {
	it('GETs the metadata and the lists with their queries', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { user_input_form: [] }))
		await expect(api.getParameters()).resolves.toEqual({ user_input_form: [] })
		expect(lastCall().url).toBe('/api/dify/app%201/parameters')
		fetchMock.mockResolvedValue(jsonResponse(200, { data: [], has_more: false, limit: 100 }))
		await api.listConversations({ limit: 100, sort_by: '-updated_at' })
		expect(lastCall().url).toBe('/api/dify/app%201/conversations?limit=100&sort_by=-updated_at')
		await api.listMessages({ conversation_id: 'c1', first_id: 'm0', limit: 20 })
		expect(lastCall().url).toBe('/api/dify/app%201/messages?conversation_id=c1&first_id=m0&limit=20')
		await api.listAnnotations({ page: 1, limit: 10, keyword: '' })
		expect(lastCall().url).toBe('/api/dify/app%201/apps/annotations?page=1&limit=10&keyword=')
	})
	it('POSTs JSON bodies, never a user', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { id: 'c1', name: 'Tea' }))
		await api.renameConversation('c1', { name: 'Tea' })
		expect(lastCall().url).toBe('/api/dify/app%201/conversations/c1/name')
		expect(lastCall().init.method).toBe('POST')
		expect(lastCall().headers.get('content-type')).toBe('application/json')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ name: 'Tea' })
		fetchMock.mockResolvedValue(jsonResponse(200, { result: 'success' }))
		await api.createFeedback('m1', { rating: null, content: '' })
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ rating: null, content: '' })
		await api.stopChat('t1')
		expect(lastCall().url).toBe('/api/dify/app%201/chat-messages/t1/stop')
		await api.stopCompletion('t2')
		expect(lastCall().url).toBe('/api/dify/app%201/completion-messages/t2/stop')
		await api.stopWorkflow('t3')
		expect(lastCall().url).toBe('/api/dify/app%201/workflows/tasks/t3/stop')
		fetchMock.mockResolvedValue(jsonResponse(200, {}))
		await expect(api.submitHumanInput('tok', { inputs: { a: 'b' }, action: 'approve' })).resolves.toEqual({})
		expect(lastCall().url).toBe('/api/dify/app%201/form/human_input/tok')
	})
	it('DELETEs resolve on 204', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		await expect(api.deleteConversation('c1')).resolves.toBeUndefined()
		expect(lastCall().init.method).toBe('DELETE')
		await expect(api.deleteAnnotation('a1')).resolves.toBeUndefined()
		expect(lastCall().url).toBe('/api/dify/app%201/apps/annotations/a1')
	})
	it('uploads and transcribes with one file part', async () => {
		fetchMock.mockResolvedValue(jsonResponse(201, { id: 'f1' }))
		await expect(api.uploadFile(new File(['x'], 'a.txt'))).resolves.toEqual({ id: 'f1' })
		expect((lastCall().init.body as FormData).get('file')).toBeInstanceOf(File)
		expect((lastCall().init.body as FormData).has('user')).toBe(false)
		fetchMock.mockResolvedValue(jsonResponse(200, { text: 'hi' }))
		await expect(api.audioToText(new File(['x'], 'speech.webm'))).resolves.toEqual({ text: 'hi' })
		expect(lastCall().url).toBe('/api/dify/app%201/audio-to-text')
	})
	it('hands streams and binaries back as the Response', async () => {
		const stream = jsonResponse(200, {}, 'text/event-stream')
		fetchMock.mockResolvedValue(stream)
		const controller = new AbortController()
		await expect(api.runWorkflow({ inputs: {}, response_mode: 'streaming' }, controller.signal)).resolves.toBe(stream)
		expect(lastCall().init.signal).toBe(controller.signal)
		await expect(api.completion({ inputs: {}, response_mode: 'streaming' })).resolves.toBe(stream)
		expect(lastCall().url).toBe('/api/dify/app%201/completion-messages')
		const audio = new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } })
		fetchMock.mockResolvedValue(audio)
		await expect(api.textToAudio({ text: 'hi' })).resolves.toBe(audio)
		await expect(api.filePreview('f1', { asAttachment: true })).resolves.toBe(audio)
		expect(lastCall().url).toBe('/api/dify/app%201/files/f1/preview?as_attachment=true')
	})
	it('builds the remote-file, chat and events URLs', () => {
		expect(api.remoteFileUrl('https://dify.example/files/x.png?sign=1')).toBe(
			'/api/dify/app%201/files/remote?url=https%3A%2F%2Fdify.example%2Ffiles%2Fx.png%3Fsign%3D1',
		)
		expect(api.chatMessagesUrl).toBe('/api/dify/app%201/chat-messages')
		expect(api.workflowEventsUrl('run/1')).toBe('/api/dify/app%201/workflow/run%2F1/events')
	})
})

describe('createDifyApi: errors', () => {
	it("rejects with DifyRequestError carrying Dify's code and message", async () => {
		fetchMock.mockResolvedValue(jsonResponse(412, { code: 'human_input_form_expired', message: 'Expired.', status: 412 }))
		const error = await api.submitHumanInput('tok', { inputs: {}, action: 'a' }).catch(e => e)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({ status: 412, code: 'human_input_form_expired', message: 'Expired.' })
	})
	it('falls back to the status text for a body that is not the envelope', async () => {
		fetchMock.mockResolvedValue(new Response('boom', { status: 502, statusText: 'Bad Gateway' }))
		await expect(api.getParameters()).rejects.toMatchObject({ status: 502, code: undefined, message: 'Bad Gateway' })
	})
})
```

In `__tests__/dify-fetch.test.ts` change the two expected URLs to `/api/dify/${APP}/chat-messages` and `/api/dify/${APP}/workflow/run-9/events`, and replace the test "uses the proxy's error field when the body has no Dify message" (the proxy no longer answers `{ error }`) with:

```ts
	it('keeps the status text when the body is not the envelope', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"x"}', { status: 404, statusText: 'Not Found', headers: { 'content-type': 'application/json' } })))
		const error = await createDifyFetch(APP)('ignored', { body: '{}' } as never).catch(e => e)
		expect(error).toMatchObject({ status: 404, code: undefined, message: 'Not Found' })
	})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/dify-browser.test.ts __tests__/dify-fetch.test.ts`
Expected: FAIL (module not found; the old URLs).

- [ ] **Step 3: Write `lib/dify/browser.ts`**

```ts
// Client-safe: no server-only import. The browser's one way to the Dify routes (charter §4.1): every JSON
// method resolves the typed body and rejects with DifyRequestError on a non-OK answer, so the chat keeps one parser.
import type {
	AnnotationInput,
	AnnotationItem,
	AnnotationsPage,
	AnnotationsQuery,
	AppParameters,
	CompletionRequest,
	ConversationItem,
	ConversationsPage,
	ConversationsQuery,
	FeedbackRequest,
	FileUploadResponse,
	HumanInputForm,
	HumanInputSubmission,
	MessagesPage,
	MessagesQuery,
	RenameConversationRequest,
	SiteSettings,
	StopResponse,
	SuggestedQuestionsResponse,
	TextToAudioRequest,
	WorkflowRunRequest,
} from './types'

/** Dify's error body (`{ code, message, status }`) as a thrown error; `code` is undefined for a body of another shape. */
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
	let body: { code?: unknown; message?: unknown } | null = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return new DifyRequestError(
		response.status,
		typeof body?.code === 'string' ? body.code : undefined,
		typeof body?.message === 'string' ? body.message : response.statusText,
	)
}

type QueryValue = string | number | boolean | undefined
const queryString = (params: Record<string, QueryValue>) => {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
	const text = search.toString()
	return text ? `?${text}` : ''
}
const segment = (value: string) => encodeURIComponent(value)
const jsonInit = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
})
const filePart = (file: File): RequestInit => {
	const form = new FormData()
	form.append('file', file, file.name)
	return { method: 'POST', body: form }
}

export const createDifyApi = (appId: string) => {
	const base = `/api/dify/${segment(appId)}`
	const request = async (path: string, init?: RequestInit): Promise<Response> => {
		const response = await fetch(`${base}${path}`, init)
		if (!response.ok) throw await readDifyError(response)
		return response
	}
	const json = <T>(response: Response) => response.json() as Promise<T>

	return {
		getParameters: () => request('/parameters').then(json<AppParameters>),
		getSite: () => request('/site').then(json<SiteSettings>),

		listConversations: (query: ConversationsQuery) => request(`/conversations${queryString(query)}`).then(json<ConversationsPage>),
		renameConversation: (conversationId: string, body: RenameConversationRequest) =>
			request(`/conversations/${segment(conversationId)}/name`, jsonInit('POST', body)).then(json<ConversationItem>),
		deleteConversation: async (conversationId: string): Promise<void> => {
			await request(`/conversations/${segment(conversationId)}`, { method: 'DELETE' })
		},
		listMessages: (query: MessagesQuery) => request(`/messages${queryString(query)}`).then(json<MessagesPage>),
		getSuggested: (messageId: string) => request(`/messages/${segment(messageId)}/suggested`).then(json<SuggestedQuestionsResponse>),
		createFeedback: (messageId: string, body: FeedbackRequest) =>
			request(`/messages/${segment(messageId)}/feedbacks`, jsonInit('POST', body)).then(json<StopResponse>),
		stopChat: (taskId: string) => request(`/chat-messages/${segment(taskId)}/stop`, { method: 'POST' }).then(json<StopResponse>),
		stopCompletion: (taskId: string) => request(`/completion-messages/${segment(taskId)}/stop`, { method: 'POST' }).then(json<StopResponse>),
		stopWorkflow: (taskId: string) => request(`/workflows/tasks/${segment(taskId)}/stop`, { method: 'POST' }).then(json<StopResponse>),

		/** The run's Response (a stream, or JSON when blocking); the caller reads it. */
		completion: (body: CompletionRequest, signal?: AbortSignal) => request('/completion-messages', { ...jsonInit('POST', body), signal }),
		runWorkflow: (body: WorkflowRunRequest, signal?: AbortSignal) => request('/workflows/run', { ...jsonInit('POST', body), signal }),

		getHumanInputForm: (formToken: string) => request(`/form/human_input/${segment(formToken)}`).then(json<HumanInputForm>),
		submitHumanInput: (formToken: string, body: HumanInputSubmission) =>
			request(`/form/human_input/${segment(formToken)}`, jsonInit('POST', body)).then(json<Record<string, never>>),

		uploadFile: (file: File) => request('/files/upload', filePart(file)).then(json<FileUploadResponse>),
		/** The file's Response (binary with its disposition); the caller reads it. */
		filePreview: (fileId: string, options: { asAttachment?: boolean } = {}) =>
			request(`/files/${segment(fileId)}/preview${queryString({ as_attachment: options.asAttachment || undefined })}`),
		audioToText: (file: File) => request('/audio-to-text', filePart(file)).then(json<{ text: string }>),
		/** The audio's Response; the caller reads it. */
		textToAudio: (body: TextToAudioRequest) => request('/text-to-audio', jsonInit('POST', body)),

		listAnnotations: (query: AnnotationsQuery) => request(`/apps/annotations${queryString(query)}`).then(json<AnnotationsPage>),
		createAnnotation: (body: AnnotationInput) => request('/apps/annotations', jsonInit('POST', body)).then(json<AnnotationItem>),
		updateAnnotation: (annotationId: string, body: AnnotationInput) =>
			request(`/apps/annotations/${segment(annotationId)}`, jsonInit('PUT', body)).then(json<AnnotationItem>),
		deleteAnnotation: async (annotationId: string): Promise<void> => {
			await request(`/apps/annotations/${segment(annotationId)}`, { method: 'DELETE' })
		},

		/** The app's URL for a file link Dify handed out (message files, generated images), fetched by the server. */
		remoteFileUrl: (url: string) => `${base}/files/remote?url=${encodeURIComponent(url)}`,
		/** For x-sdk's XRequest (components/chat/provider/dify-fetch.ts). */
		chatMessagesUrl: `${base}/chat-messages`,
		workflowEventsUrl: (workflowRunId: string) => `${base}/workflow/${segment(workflowRunId)}/events`,
	}
}

export type DifyApi = ReturnType<typeof createDifyApi>
```

- [ ] **Step 4: `components/chat/provider/dify-fetch.ts` on the browser client**

Replace the file with:

```ts
import type { SSEOutput, XRequestOptions } from '@ant-design/x-sdk'

import { createDifyApi, readDifyError } from '@/lib/dify/browser'

import type { DifyChatInput, DifyChatMessage } from './message'

// The chat's importers keep these names; the classes live with the browser client (lib/dify/browser.ts).
export { DifyRequestError, readDifyError } from '@/lib/dify/browser'

/**
 * The documented XRequest `fetch` option (x-request skill). XRequest hands us its RequestInit (JSON body,
 * abort signal); we route by payload: a `resume` request reads the workflow events route (HITL
 * continuation, ADR-0017), everything else posts to chat-messages. Non-OK answers become DifyRequestError
 * because XRequest's own JSON handler only recognises `success === false`.
 */
export const createDifyFetch =
	(appId: string): NonNullable<XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>['fetch']> =>
	async (_baseURL, options) => {
		const api = createDifyApi(appId)
		const init = (options ?? {}) as RequestInit & { body?: string }
		const body = init.body ? (JSON.parse(init.body) as DifyChatInput) : ({} as DifyChatInput)
		const response = body.resume
			? await fetch(api.workflowEventsUrl(body.resume.workflowRunId), { method: 'GET', signal: init.signal ?? undefined })
			: await fetch(api.chatMessagesUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: init.body,
					signal: init.signal ?? undefined,
				})
		if (!response.ok) throw await readDifyError(response)
		return response
	}
```

Also in `components/chat/hooks/use-dify-chat.ts` change the XRequest base URL literal `` `/api/client/dify/${appId}/chat-messages` `` to `` `/api/dify/${encodeURIComponent(appId)}/chat-messages` `` (XRequest only passes it to our fetch, which ignores it; the literal should still be the real path).

- [ ] **Step 5: Run the tests, type-check, commit**

Run: `pnpm exec vitest run __tests__/dify-browser.test.ts __tests__/dify-fetch.test.ts && pnpm exec tsc --noEmit && pnpm exec oxlint lib/dify/browser.ts components/chat/provider/dify-fetch.ts && pnpm exec oxfmt --write lib/dify/browser.ts components/chat/provider/dify-fetch.ts __tests__/dify-browser.test.ts __tests__/dify-fetch.test.ts`
Expected: green.

```bash
git add lib/dify/browser.ts components/chat/provider/dify-fetch.ts components/chat/hooks/use-dify-chat.ts __tests__/dify-browser.test.ts __tests__/dify-fetch.test.ts
git commit -m "feat(dify): the browser client on the new routes, x-sdk's fetch option on top of it

lib/dify/browser.ts: one typed client per app id, DifyRequestError on any non-OK answer, URL builders for the stream routes and remote files (charter §4.1). dify-fetch.ts keeps its exports and posts to the new paths.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 12: The chat page loads its app on the server; the chat reads the DTO

Charter §4.1 "App data for the browser", §4.3 (`app/(user)/chat/[appId]/page.tsx`), ADR-0020's stated exception closed. The chat's data calls still go through the old `DifyApi` until Task 13; this task changes the app's shape and how it arrives.

**Files:**
- Modify: `app/(user)/chat/[appId]/page.tsx`, `app/(user)/chat/page.tsx`, `components/chat/chat-workspace.tsx`, `components/chat/app-context.tsx`, `components/chat/app-answers.ts`, `components/chat/utils-index.ts`, `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/inputs-collapse.tsx`, `components/chat/chat-view/user-content.tsx`, `components/chat/chat-view/welcome-panel.tsx`, `components/chat/chat-view/conversation-sidebar.tsx`, `components/chat/chat-view/message-footer.tsx`, `components/chat/chat-view/inputs-values.ts`, `components/chat/hooks/use-workflow-run.ts`, `components/chat/workflow-view/workflow-view.tsx`, `components/chat/message/message-files.tsx`, `components/chat/chat-view/file-upload.tsx`, `locales/{en,zh,ar}/translation.json`
- Create: `components/chat/app-unavailable.tsx`
- Test: `__tests__/chat-page.test.ts`, `__tests__/chat-app-answers.test.ts` (shrinks), `e2e/chat.spec.ts` (one new case)

**Interfaces:**
- Produces: `AppContextValue = { app: ChatAppDto; parameters: AppParameters; site: SiteSettings; difyApi: DifyApi }` (the old `DifyApi` from `lib/dify-client` until Task 13 swaps it; `userId` is gone); `DEFAULT_SITE_SETTINGS`; `isChatLikeApp(mode)`, `isWorkflowLikeApp(mode)` on `AppMode | null`.
- Consumes: `requireUser` (Task 2), `getChatApp`, `ChatAppDto` (Task 6), `AppParameters`, `SiteSettings`, `CHAT_MODES`, `RUN_MODES` (Task 3), `createDifyApi` for parameters and site (Task 11).

- [ ] **Step 1: Write the failing page test**

Create `__tests__/chat-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, getChatApp, ChatWorkspace, AppUnavailable, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	getChatApp: vi.fn(),
	ChatWorkspace: () => null,
	AppUnavailable: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/apps', () => ({ getChatApp }))
vi.mock('@/components/chat/chat-workspace', () => ({ default: ChatWorkspace }))
vi.mock('@/components/chat/app-unavailable', () => ({ default: AppUnavailable }))

import AppChatPage from '@/app/(user)/chat/[appId]/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const app = {
	id: 'a1', name: 'Tea', mode: 'chat', description: '', enabled: true, icon: null,
	settings: { answerForm: { enabled: false, feedbackText: '' }, enableUpdateAfterConversationStarts: false, openingStatementDisplayMode: 'default', annotationEnabled: false },
}
const props = { params: Promise.resolve({ appId: 'a1' }), searchParams: Promise.resolve({}) }

beforeEach(() => {
	requireUser.mockReset()
	getChatApp.mockReset()
})

describe('/chat/[appId] page', () => {
	it('checks the session before it reads the app', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(AppChatPage(props as never)).rejects.toBe(redirectSignal)
		expect(getChatApp).not.toHaveBeenCalled()
	})
	it('hands the workspace the chat DTO, keyed by the app', async () => {
		requireUser.mockResolvedValue(actor)
		getChatApp.mockResolvedValue(app)
		const page = await AppChatPage(props as never)
		expect(getChatApp).toHaveBeenCalledWith(actor, 'a1')
		expect(page).toMatchObject({ type: ChatWorkspace, key: 'a1', props: { app } })
		expect(JSON.stringify(page.props)).not.toContain('apiBase')
	})
	it('renders the missing and the disabled states instead of the workspace', async () => {
		requireUser.mockResolvedValue(actor)
		getChatApp.mockResolvedValue(null)
		expect(await AppChatPage(props as never)).toMatchObject({ type: AppUnavailable, props: { reason: 'missing' } })
		getChatApp.mockResolvedValue({ ...app, enabled: false })
		expect(await AppChatPage(props as never)).toMatchObject({ type: AppUnavailable, props: { reason: 'disabled' } })
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/chat-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: The page, the index page and the unavailable state**

`app/(user)/chat/[appId]/page.tsx`:

```tsx
import AppUnavailable from '@/components/chat/app-unavailable'
import ChatWorkspace from '@/components/chat/chat-workspace'
import { requireUser } from '@/lib/auth/session'
import { getChatApp } from '@/lib/data/apps'

/**
 * The app is loaded on the server (ADR-0020's pattern; charter §4.1) and handed to the workspace as a DTO
 * without the API base or the key. A missing or disabled app renders its state instead of the workspace.
 */
export default async function AppChatPage({ params }: PageProps<'/chat/[appId]'>) {
	const actor = await requireUser()
	const { appId } = await params
	const app = await getChatApp(actor, appId)
	if (!app) return <AppUnavailable reason="missing" />
	if (!app.enabled) return <AppUnavailable reason="disabled" />
	// Keyed by the app: another app starts from a fresh workspace (React: resetting state with a key).
	return (
		<ChatWorkspace
			key={appId}
			app={app}
		/>
	)
}
```

`app/(user)/chat/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

export const dynamic = 'force-dynamic'

/** `/chat` opens the first enabled app, or the app list when there is none. */
export default async function ChatIndexPage() {
	const actor = await requireUser()
	const first = (await listApps(actor)).find(app => app.enabled)
	// redirect() works by throwing (Next `redirect` reference), so it stays outside any try/catch.
	redirect(first ? `/chat/${first.id}` : '/apps')
}
```

`components/chat/app-unavailable.tsx`:

```tsx
'use client'

import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'

/** The chat page of an app that does not exist or is disabled (charter §4.1): a Result with the way back to the list. */
export default function AppUnavailable({ reason }: { reason: 'missing' | 'disabled' }) {
	const { t } = useTranslation()
	return (
		<UserShell>
			<Result
				status={reason === 'missing' ? '404' : 'warning'}
				title={t(reason === 'missing' ? 'app.no_config_default_text' : 'app.disabled')}
				extra={
					<Button
						type="primary"
						href="/apps"
					>
						{t('app.back_to_apps')}
					</Button>
				}
			/>
		</UserShell>
	)
}
```

Add to `locales/en/translation.json` under `app`: `"disabled": "This app is disabled"`, `"back_to_apps": "Back to the app list"`; to `locales/zh`: `"disabled": "此应用已停用"`, `"back_to_apps": "返回应用列表"`; to `locales/ar`: `"disabled": "هذا التطبيق معطّل"`, `"back_to_apps": "العودة إلى قائمة التطبيقات"`.

- [ ] **Step 4: The workspace, context and answers on the DTO**

Replace `components/chat/app-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

import type { ChatAppDto } from '@/lib/data/apps'
import type { DifyApi } from '@/lib/dify-client'
import type { AppParameters, SiteSettings } from '@/lib/dify/types'

/** The open app and what was loaded for it: one value per page, provided by ChatWorkspace. */
export interface AppContextValue {
	app: ChatAppDto
	parameters: AppParameters
	site: SiteSettings
	difyApi: DifyApi
}

export const AppContext = createContext<AppContextValue | null>(null)

export const useAppContext = (): AppContextValue => {
	const value = useContext(AppContext)
	if (!value) throw new Error('useAppContext must be used inside ChatWorkspace')
	return value
}
```

(`import type { ChatAppDto } from '@/lib/data/apps'` is a type-only import of a `server-only` module: allowed, since `import type` is erased and never bundles the module; Next's `server-only` guard fires on a value import. The `DifyApi` type still comes from `lib/dify-client` until Task 13.)

Replace `components/chat/app-answers.ts`:

```ts
import type { SiteSettings } from '@/lib/dify/types'

/** The site settings used when GET /site fails (Dify's 403 for an app without a site, or a Dify before 1.4). */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
	title: '',
	chat_color_theme: '',
	chat_color_theme_inverted: false,
	icon_type: 'emoji',
	icon: '🤖',
	icon_background: '#1C64F2',
	icon_url: null,
	description: '',
	copyright: '',
	privacy_policy: '',
	custom_disclaimer: '',
	default_language: 'en-US',
	show_workflow_steps: false,
	use_icon_as_answer_icon: false,
}
```

Delete `__tests__/chat-app-answers.test.ts` (its two functions are gone: the browser client types the answers and throws on errors).

Replace `components/chat/chat-workspace.tsx`:

```tsx
'use client'

import { Button, Flex, Result, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'
import type { ChatAppDto } from '@/lib/data/apps'
import { createDifyApiInstance, type DifyApi } from '@/lib/dify-client'
import { createDifyApi } from '@/lib/dify/browser'

import { DEFAULT_SITE_SETTINGS } from './app-answers'
import { AppContext, type AppContextValue } from './app-context'
import { toDifyError } from './hooks/dify-errors'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
import { isChatLikeApp, isWorkflowLikeApp } from './utils-index'
import WorkflowView from './workflow-view/workflow-view'

type State =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; value: AppContextValue }

/** Loads the app's parameters and site settings, provides AppContext and picks the view by mode. The app itself arrives from the server page. */
export default function ChatWorkspace({ app }: { app: ChatAppDto }) {
	const { t } = useTranslation()
	const [state, setState] = useState<State>({ status: 'loading' })

	useEffect(() => {
		let cancelled = false
		const api = createDifyApi(app.id)
		;(async () => {
			try {
				const [parameters, site] = await Promise.all([
					api.getParameters(),
					api.getSite().catch(() => DEFAULT_SITE_SETTINGS),
				])
				// Until Task 13 the hooks still use the old DifyApi; its base and key are unused by the proxy.
				const difyApi = createDifyApiInstance({ appId: app.id, user: '', apiBase: '', apiKey: '' }) as DifyApi
				if (!cancelled) setState({ status: 'ready', value: { app, parameters, site, difyApi } })
			} catch (error) {
				// Dify's text, or '' for anything else (the Result then shows the generic key).
				if (!cancelled) setState({ status: 'error', message: toDifyError(error).message })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [app])

	if (state.status === 'loading') {
		return (
			<UserShell>
				<Flex className={styles.fill} align="center" justify="center">
					<Spin size="large" description={t('app.loading')} />
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
					subTitle={state.message || t('common.request_failed_retry')}
					extra={
						<Button type="primary" onClick={() => window.location.reload()}>
							{t('app.reload_page')}
						</Button>
					}
				/>
			</UserShell>
		)
	}
	const mode = state.value.app.mode
	return (
		<AppContext.Provider value={state.value}>
			{isChatLikeApp(mode) ? <ChatView /> : isWorkflowLikeApp(mode) ? <WorkflowView /> : (
				<UserShell>
					<Result status="warning" title={t('common.unsupported_app_type')} />
				</UserShell>
			)}
		</AppContext.Provider>
	)
}
```

Task 13 replaces the `createDifyApiInstance` line with the browser client; the `createDifyApi` import above is already the one it keeps. Note `toDifyError` works on `DifyRequestError`, which the browser client throws (Task 11 re-export), so the error state shows Dify's message for a failed `/parameters`.

In `components/chat/utils-index.ts` replace the two mode helpers and the import:

```ts
import { CHAT_MODES, RUN_MODES, type AppMode } from '@/lib/dify/types'
…
/** Chat-like apps (chat, agent-chat, advanced-chat, agent): the conversation view. */
export const isChatLikeApp = (mode: AppMode | null) => mode !== null && CHAT_MODES.includes(mode)

/** Run-like apps (workflow, completion): the runner view. */
export const isWorkflowLikeApp = (mode: AppMode | null) => mode !== null && RUN_MODES.includes(mode)
```

(`completeFileUrl` stays in the file until Task 15; drop the `AppModeEnums` import.)

- [ ] **Step 5: Every reader of the old app shape**

Apply these edits exactly (line numbers as of `fork/overhaul` at `a70d3902`):

- `components/chat/chat-view/chat-view.tsx`:
  - line 76: `const { app, site, parameters, difyApi, userId } = useAppContext()` → `const { app, site, parameters, difyApi } = useAppContext()`
  - line 117: `const allowUpdate = Boolean(app.inputParams?.enableUpdateAfterCvstStarts)` → `const allowUpdate = app.settings.enableUpdateAfterConversationStarts`
  - lines 316–320: the `submitHumanInput` call drops its `user: userId` line (the route sets the user), and line 331's dependency list drops `userId`.
  - line 465: `(app.extConfig?.conversation?.openingStatement?.displayMode === 'always' ||` → `(app.settings.openingStatementDisplayMode === 'always' ||`
  - line 532: `{site.title || app.info.name}` → `{site.title || app.name}`
  - line 696: `{app.extConfig?.annotation?.enabled && (` → `{app.settings.annotationEnabled && (`
- `components/chat/chat-view/inputs-collapse.tsx` line 59: `{!app.inputParams?.enableUpdateAfterCvstStarts && (` → `{!app.settings.enableUpdateAfterConversationStarts && (`
- `components/chat/chat-view/user-content.tsx` line 36: `displayText(message.content, app.answerForm?.feedbackText, app.answerForm?.enabled)` → `displayText(message.content, app.settings.answerForm.feedbackText, app.settings.answerForm.enabled)`
- `components/chat/chat-view/welcome-panel.tsx` line 21: `app.info.name` → `app.name`
- `components/chat/chat-view/conversation-sidebar.tsx` lines 43, 57, 58: `app.info.name` → `app.name`, `app.info.description` → `app.description`
- `components/chat/chat-view/message-footer.tsx` line 79: `annotation: Boolean(app.extConfig?.annotation?.enabled),` → `annotation: app.settings.annotationEnabled,`
- `components/chat/hooks/use-workflow-run.ts`: line 8 `import { AppModeEnums } from '@/lib/core'` is removed; line 31 `const mode = app.info.mode` → `const mode = app.mode`; line 61 `mode === AppModeEnums.WORKFLOW` → `mode === 'workflow'`
- `components/chat/workflow-view/workflow-view.tsx`: line 9's `AppModeEnums` import removed; line 81 `app.info.name` → `app.name`; line 126 `workflowApp={app.info.mode === AppModeEnums.WORKFLOW}` → `workflowApp={app.mode === 'workflow'}`
- `components/chat/message/message-files.tsx` line 53 and `components/chat/chat-view/file-upload.tsx` line 91 read `app.requestConfig.apiBase`, which the DTO no longer has: replace both with `const apiBase = ''` for now (links of stored files then stay relative until Task 15 routes them through the proxy; say so in the commit).
- `components/chat/chat-view/inputs-values.ts` lines 1–5: replace the three `@/lib/core` types with `import type { UserInputControlType, UserInputFieldConfig, UserInputFormItem } from '@/lib/dify/types'` and rename their uses (`IUserInputForm` → `UserInputFormItem`, `IUserInputFormItemType` → `UserInputControlType`, `IUserInputFormItemValueBase` → `UserInputFieldConfig`). Run `tsc`: where the code indexes a form item and the new `Partial<Record>` yields `| undefined`, guard with `if (!field) continue` (or `?.`), never a cast.

Run `pnpm exec tsc --noEmit` and fix every remaining reference to `app.info`, `app.extConfig`, `app.inputParams`, `app.answerForm`, `app.requestConfig` or `AppModeEnums` inside `components/chat/`; `git grep -n "app\.info\|extConfig\|inputParams\|answerForm?\.\|AppModeEnums" components/chat` must print nothing.

- [ ] **Step 6: The e2e case for a disabled app**

Append to `e2e/chat.spec.ts` (outside the signed-in `describe` that sends messages, with the imports it needs: `DISABLED_APP` from `./fixtures/constants`):

```ts
test("a disabled app's chat page shows the disabled state and the way back", async ({ page }) => {
	await page.goto(`/chat/${DISABLED_APP.id}`)
	await expect(page.getByText('This app is disabled', { exact: true })).toBeVisible()
	await page.getByRole('link', { name: 'Back to the app list' }).click()
	await expect(page).toHaveURL(/\/apps$/)
})
```

(antd's `Button href` renders an `<a>`, hence the link role.)

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint app components/chat && pnpm exec oxfmt --write 'app/(user)/chat' components/chat __tests__/chat-page.test.ts e2e/chat.spec.ts locales`
Expected: green. Then `pnpm exec playwright test e2e/smoke.spec.ts e2e/chat.spec.ts e2e/chat-chatflow.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts` on the three projects: green (the hooks still call the old proxy routes, which still exist).

```bash
git add 'app/(user)/chat' components/chat locales __tests__/chat-page.test.ts __tests__/chat-app-answers.test.ts e2e/chat.spec.ts
git commit -m "feat(chat): the chat page loads its app on the server and hands the workspace a DTO

getChatApp through the DAL, a missing or disabled app rendered as its own state, the workspace fetching parameters and site through the browser client; every reader of the old app shape moved to the DTO's fields (charter §4.1; ADR-0020's exception closed). Stored file links stay relative until the proxy routes land (Task 15).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 13: The chat hooks on the new contract

Charter §4.1 "Contract to the browser" (the thirteen shape checks go; one parser), §4.3 (`lib/dify/types` as the only source of browser-facing types).

**Files:**
- Modify: `components/chat/hooks/dify-errors.ts`, `components/chat/hooks/use-dify-chat.ts`, `components/chat/hooks/use-conversations.ts`, `components/chat/hooks/use-suggestions.ts`, `components/chat/hooks/use-dify-upload.ts`, `components/chat/hooks/use-speech-to-text.ts`, `components/chat/hooks/use-tts.ts`, `components/chat/chat-view/chat-view.tsx`, `components/chat/chat-view/annotation-drawer.tsx`, `components/chat/message/message-files.tsx`, `components/chat/chat-workspace.tsx`, `components/chat/app-context.tsx`, `components/chat/provider/message.ts`, `components/chat/provider/history.ts`, `components/chat/provider/conversations.ts`, and the files whose `@/lib/api` type imports move (Step 4)
- Test: `__tests__/chat-dify-errors.test.ts` (rewritten), `__tests__/chat-citations.test.ts` (import), `e2e/chat-files.spec.ts`, `e2e/chat-hitl.spec.ts`, `e2e/chat-feedback.spec.ts`

**Interfaces:**
- Consumes: `createDifyApi`, `DifyApi`, `DifyRequestError` (Task 11); the contract types (Task 3).
- Produces: `dify-errors.ts` keeps `toDifyError(error): DifyRequestError` and `humanInputFailureText(error, accepted, t)` only. `AppContextValue.difyApi` is the browser `DifyApi`.

- [ ] **Step 1: Rewrite the error-helper test**

Replace `__tests__/chat-dify-errors.test.ts` with:

```ts
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { humanInputFailureText, toDifyError } from '@/components/chat/hooks/dify-errors'
import { DifyRequestError } from '@/components/chat/provider/dify-fetch'

const t = ((key: string, options?: Record<string, unknown>) =>
	options?.error ? `${key}:${String(options.error)}` : key) as unknown as TFunction

describe('toDifyError', () => {
	it('passes a DifyRequestError through', () => {
		const error = new DifyRequestError(412, 'human_input_form_expired', 'Expired.')
		expect(toDifyError(error)).toBe(error)
	})
	it('turns any other failure into an empty-message DifyRequestError that keeps the cause', () => {
		const cause = new TypeError('fetch failed')
		const error = toDifyError(cause)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({ status: 0, code: undefined, message: '' })
		expect(error.cause).toBe(cause)
	})
})

describe('humanInputFailureText', () => {
	it("gives Dify's reason for a refused form, or the generic text without one", () => {
		expect(humanInputFailureText(new DifyRequestError(412, 'x', 'Expired.'), false, t)).toBe('hitl.submit_failed_reason:Expired.')
		expect(humanInputFailureText(new TypeError('net'), false, t)).toBe('hitl.submit_failed')
	})
	it('says the answer was sent when only the continuation failed', () => {
		expect(humanInputFailureText(new Error('x'), true, t)).toBe('hitl.resume_failed')
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/chat-dify-errors.test.ts`
Expected: PASS already (both functions exist); it stays as the guard for the rewrite below. The removed exports are what the next steps delete.

- [ ] **Step 3: `dify-errors.ts` shrinks to the two helpers**

Replace the file with:

```ts
import type { TFunction } from 'i18next'

import { DifyRequestError } from '../provider/dify-fetch'

/**
 * Any failure as the error the chat hooks report: the browser client's DifyRequestError as it is (Dify's code
 * and message, or the status text); a network failure or the like keeps no text (the view then shows its
 * i18n text) and is kept as `cause`. Hooks never make up English text of their own.
 */
export const toDifyError = (error: unknown): DifyRequestError => {
	if (error instanceof DifyRequestError) return error
	const wrapped = new DifyRequestError(0, undefined, '')
	wrapped.cause = error
	return wrapped
}

/**
 * The toast for a human input form that could not go on (ADR-0017). Once Dify has accepted the form only the
 * continuation failed (x-sdk's onReload throws for a message the store does not hold) and a second submission
 * would be refused (412), so the text says the answer was sent; otherwise Dify's reason, or the generic text.
 */
export const humanInputFailureText = (error: unknown, accepted: boolean, t: TFunction): string => {
	if (accepted) return t('hitl.resume_failed')
	const { message } = toDifyError(error)
	return message ? t('hitl.submit_failed_reason', { error: message }) : t('hitl.submit_failed')
}
```

- [ ] **Step 4: The type imports move to `lib/dify/types`**

```bash
git grep -l "from '@/lib/api'" components __tests__ | xargs sed -i "s#from '@/lib/api'#from '@/lib/dify/types'#"
git grep -l -E "\bI(AgentThought|RetrieverResource|FileType|File|ConversationItem)\b" components __tests__ \
  | xargs sed -i -E "s/\bIAgentThought\b/AgentThought/g; s/\bIRetrieverResource\b/RetrieverResource/g; s/\bIFileType\b/FileType/g; s/\bIFile\b/FileInput/g; s/\bIConversationItem\b/ConversationItem/g"
git grep -n -E "\bI(AgentThought|RetrieverResource|FileType|File|ConversationItem)\b|@/lib/api'" components __tests__
```

The last command must print nothing. Then in `components/chat/provider/message.ts` replace the local `HumanInputField` and `HumanInputAction` interfaces with re-exports of the contract's (same fields): delete both interface blocks and add `export type { HumanInputAction, HumanInputField } from '@/lib/dify/types'` after the imports. In `components/chat/provider/history.ts` replace the six local interfaces (`HistoryFile`, `HistoryThought`, `HistoryFormDefinition`, `HistoryFormSubmission`, `HistoryHumanInputContent`, `HistoryMessage`) with aliases of the contract's:

```ts
import type {
	AgentThought,
	HumanInputContent,
	HumanInputFormDefinition,
	HumanInputFormSubmission,
	MessageFileItem,
	MessageListItem,
	RetrieverResource,
} from '@/lib/dify/types'

/** The GET /messages shapes as the mapper reads them: the contract's types under the mapper's names. */
export type HistoryFile = MessageFileItem
export type HistoryThought = AgentThought
export type HistoryFormDefinition = HumanInputFormDefinition
export type HistoryFormSubmission = HumanInputFormSubmission
export type HistoryHumanInputContent = HumanInputContent
export type HistoryMessage = MessageListItem
```

Run `pnpm exec tsc --noEmit`. Where the mapper reads a field the contract types differently, align the contract type in `lib/dify/types` when the endpoint map documents the field (say which in the commit), and the mapper otherwise; never widen the mapper with a cast. Expected mismatches: none for the fields the mapper reads (`id`, `conversation_id`, `inputs`, `query`, `answer`, `message_files`, `feedback.rating`, `status`, `error`, `agent_thoughts`, `retriever_resources`, `extra_contents`, `created_at`).

- [ ] **Step 5: The hooks and views on `DifyApi`**

Apply these edits exactly:

- `components/chat/app-context.tsx`: `import type { DifyApi } from '@/lib/dify-client'` → `import type { DifyApi } from '@/lib/dify/browser'`.
- `components/chat/chat-workspace.tsx`: remove `import { createDifyApiInstance, type DifyApi } from '@/lib/dify-client'`; replace `const api = createDifyApi(app.id)` and the `createDifyApiInstance(...)` line with one `const difyApi = createDifyApi(app.id)` at the top of the effect, used for both the loads and the context value; remove the "Until Task 13" comment.
- `components/chat/hooks/use-dify-chat.ts`:
  - `import type { DifyApi } from '@/lib/dify-client'` → `import type { DifyApi } from '@/lib/dify/browser'`; drop `envelopeError` from the `./dify-errors` import; delete the `MessagesAnswer` interface.
  - `fetchPage` becomes:

```ts
/** One page of GET /messages; the browser client rejects with DifyRequestError on an HTTP error. */
const fetchPage = (difyApi: DifyApi, difyId: string, firstId?: string) =>
	difyApi.listMessages({ conversation_id: difyId, first_id: firstId, limit: HISTORY_PAGE })
```

  - in `stop`: `if (taskId) await api.stopTask(taskId).catch(() => undefined)` → `if (taskId) await api.stopChat(taskId).catch(() => undefined)`.
- `components/chat/hooks/use-conversations.ts`:
  - imports: `import type { ConversationItem as DifyConversationItem } from '@/lib/dify/types'` (the sed renamed `IConversationItem`; alias it, since the hook's own `ConversationItem` is the sidebar item), `import type { DifyApi } from '@/lib/dify/browser'`; the `./dify-errors` import keeps `toDifyError` only; delete the `ConversationsAnswer` interface.
  - `refresh`: 

```ts
			const answer = await latest.current.difyApi.listConversations({ limit: LIST_LIMIT, sort_by: '-updated_at' })
			// An answer for an app the page has since left changes nothing.
			if (latest.current.appId !== appId) return null
			const now = Date.now()
			const server = answer.data.map((item: DifyConversationItem) => toConversationItem(appId, item, now))
```

  - `rename`: the try block becomes `await latest.current.difyApi.renameConversation(difyId, { name })` (the client rejects on refusal); keep `catch (e) { throw toDifyError(e) }`.
  - `generateName`: `const answer = await latest.current.difyApi.renameConversation(difyId, { auto_generate: true })`; delete the `renameError` check; `const name = answer.name`.
  - `remove`: `await latest.current.difyApi.deleteConversation(difyId)` (no `response.ok` check).
- `components/chat/provider/conversations.ts`: the sed made it `ConversationItem` from `@/lib/dify/types`, which collides with its own `ConversationItem` export: import it as `import type { ConversationItem as DifyConversationItem } from '@/lib/dify/types'` and use `DifyConversationItem` in `toConversationItem`'s parameter.
- `components/chat/hooks/use-suggestions.ts`: `import type { DifyApi } from '@/lib/dify/browser'`; the effect body:

```ts
		difyApi
			.getSuggested(messageId)
			.then(result => setLoaded({ messageId, items: result.data.filter(item => typeof item === 'string') }))
			// A refused request (Dify's 400 when suggestions are off, a 404) means none.
			.catch(() => setLoaded(null))
```

- `components/chat/hooks/use-dify-upload.ts`: drop `uploadAnswerError` from the import; `customRequest` becomes:

```ts
		difyApi.uploadFile(file as File).then(answer => onSuccess?.(answer), fail)
```

  and the doc comment's last clause reads "the browser client rejects with Dify's text".
- `components/chat/hooks/use-speech-to-text.ts`: drop `transcriptionError`; in `transcribe`: `const { text } = await api.audioToText(file)` (delete the `answer`/`refused` lines); the doc comment names `POST /audio-to-text`.
- `components/chat/hooks/use-tts.ts`: `import type { DifyApi } from '@/lib/dify/browser'`; drop `audioAnswerError`; in `toggle`: `const response = await difyApi.textToAudio({ text })` (delete the `failed` lines; the comment says the client rejects on a non-OK answer).
- `components/chat/chat-view/chat-view.tsx`: the `../hooks/dify-errors` import keeps `humanInputFailureText` and `toDifyError`; add `import type { HumanInputSubmission } from '@/lib/dify/types'`; in `submitHumanInput`:

```ts
				await difyApi.submitHumanInput(form.formToken, {
					inputs: inputs as HumanInputSubmission['inputs'],
					action: actionId,
				})
				accepted = true
```

  and in the feedback callback: `await difyApi.createFeedback(messageId, { rating, content: reason ?? '' })` (delete the `answer`/`refused` lines; the catch keeps the rollback).
- `components/chat/chat-view/annotation-drawer.tsx`: the import keeps `toDifyError`; `save` becomes `await difyApi.createAnnotation(values)` followed by the success toast (delete the `saved`/`failed` lines).
- `components/chat/message/message-files.tsx`: `const response = await difyApi.filePreview(file.uploadFileId, { asAttachment: true })` (delete the `response.ok` check; the client rejects).
- `components/chat/chat-view/message-footer.tsx`: nothing (it passes `difyApi` to `useTts`).

Run `pnpm exec tsc --noEmit`; `git grep -n "lib/dify-client\|envelopeError\|renameError\|feedbackError\|annotationError\|audioAnswerError\|uploadAnswerError\|transcriptionError\|humanInputSubmitError" components` must print nothing.

- [ ] **Step 6: The e2e specs on the new shapes**

- `e2e/chat-files.spec.ts`: lines 32 and 60, `((await (await uploaded).json()) as { data: { id: string } }).data.id` → `((await (await uploaded).json()) as { id: string }).id`; lines 82–92, the mocked refusal becomes Dify's envelope:

```ts
		// Dify's refusal as the route passes it through: the envelope with its status.
		await page.route('**/files/upload', route =>
			route.fulfill({
				status: 415,
				contentType: 'application/json',
				body: JSON.stringify({ code: 'unsupported_file_type', message: 'File type not allowed.', status: 415 }),
			}),
		)
```

- `e2e/chat-hitl.spec.ts` lines 179–195: the mocked 412 becomes the envelope `JSON.stringify({ code: 'human_input_form_expired', message: 'This form has expired.', status: 412 })` with the comment "Dify refuses the form (OpenAPI: 412); the route passes the envelope through."
- `e2e/chat-feedback.spec.ts` line 246: `pathname.endsWith('/text2audio')` → `pathname.endsWith('/text-to-audio')`.
- `e2e/chat-errors.spec.ts`, `chat.spec.ts`, `chat-race.spec.ts`: no change (their path suffixes `/chat-messages`, `/stop`, `/messages`, `/conversations`, `/name` are the same under `/api/dify/`).

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm exec oxfmt --write components/chat __tests__/chat-dify-errors.test.ts __tests__/chat-citations.test.ts e2e/chat-files.spec.ts e2e/chat-hitl.spec.ts e2e/chat-feedback.spec.ts`
Expected: green. Then the specs the consumer map names for the touched routes: `pnpm exec playwright test e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/chat-feedback.spec.ts e2e/chat-hitl.spec.ts e2e/chat-errors.spec.ts e2e/chat-race.spec.ts e2e/chat-agent.spec.ts e2e/chat-chatflow.spec.ts` on the three projects: green.

```bash
git add components/chat __tests__ e2e/chat-files.spec.ts e2e/chat-hitl.spec.ts e2e/chat-feedback.spec.ts lib/dify/types
git commit -m "refactor(chat): the hooks and views on the browser client and the contract types

Every chat call goes through lib/dify/browser.ts, which rejects with DifyRequestError, so dify-errors.ts keeps one parser and the envelope checks go; the chat's Dify types come from lib/dify/types (charter §4.1, §4.3).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 14: Workflow and completion stops; the human-input form by GET

Charter §4.1 coverage rows 5 to 8 (the follow-ups of ADR-0017), §4.6 "New e2e cases" (the stop POSTs, the form GET on arrival and on reopening).

**Files:**
- Modify: `components/chat/hooks/use-workflow-run.ts`, `components/chat/message/human-input-form.tsx`, `components/chat/chat-view/chat-view.tsx`, `locales/{en,zh,ar}/translation.json`
- Test: `__tests__/human-input-definition.test.ts`, `e2e/workflow.spec.ts`, `e2e/completion.spec.ts`, `e2e/chat-hitl.spec.ts`

**Interfaces:**
- Produces: `applyFormDefinition(humanInput: HumanInputState, form: HumanInputForm): HumanInputState` (pure, `components/chat/message/human-input-definition.ts`); `HumanInputFormProps.loadForm?: () => Promise<HumanInputForm>`; `useWorkflowRun().stop` posts the stop for the run's `taskId`.
- Consumes: `DifyApi.stopWorkflow`, `stopCompletion`, `getHumanInputForm` (Task 11); `HumanInputForm` (Task 3); `RunState.taskId` (`run-reducer.ts`, already recorded from the events).

- [ ] **Step 1: Write the failing unit test for the definition merge**

Create `__tests__/human-input-definition.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { applyFormDefinition } from '@/components/chat/message/human-input-definition'
import type { HumanInputState } from '@/components/chat/provider/message'

const fromStream: HumanInputState = {
	state: 'pending',
	formToken: 'tok',
	formContent: 'Review the draft',
	inputs: [{ type: 'select', output_variable_name: 'priority' }],
	actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
	defaults: {},
	expiresAt: 100,
	workflowRunId: 'run-1',
	nodeId: 'n1',
}

describe('applyFormDefinition', () => {
	it('takes the documented fields of GET /form/human_input over the stream’s', () => {
		const next = applyFormDefinition(fromStream, {
			form_content: 'Review the draft, please',
			inputs: [{ type: 'select', output_variable_name: 'priority', option_source: { type: 'constant', value: ['low', 'high'] } }],
			resolved_default_values: { priority: 'low' },
			user_actions: [
				{ id: 'approve', title: 'Approve', button_style: 'primary' },
				{ id: 'reject', title: 'Request changes', button_style: 'default' },
			],
			expiration_time: 200,
		})
		expect(next).toEqual({
			...fromStream,
			formContent: 'Review the draft, please',
			inputs: [{ type: 'select', output_variable_name: 'priority', option_source: { type: 'constant', value: ['low', 'high'] } }],
			actions: [
				{ id: 'approve', title: 'Approve', button_style: 'primary' },
				{ id: 'reject', title: 'Request changes', button_style: 'default' },
			],
			defaults: { priority: 'low' },
			expiresAt: 200,
		})
	})
	it('keeps the token, the run and the node', () => {
		const next = applyFormDefinition(fromStream, { form_content: '', inputs: [], resolved_default_values: {}, user_actions: [], expiration_time: 0 })
		expect(next).toMatchObject({ formToken: 'tok', workflowRunId: 'run-1', nodeId: 'n1', state: 'pending' })
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/human-input-definition.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: The merge helper and the form that loads its definition**

Create `components/chat/message/human-input-definition.ts`:

```ts
import type { HumanInputForm } from '@/lib/dify/types'

import type { HumanInputState } from '../provider/message'

/**
 * The form as GET /form/human_input/{form_token} defines it (endpoint map §1.5), over what the stream or the
 * history carried: the select options, file restrictions and defaults are documented only there (ADR-0017
 * note of 2026-10-05). Token, run and node stay the message's.
 */
export const applyFormDefinition = (humanInput: HumanInputState, form: HumanInputForm): HumanInputState => ({
	...humanInput,
	formContent: form.form_content,
	inputs: form.inputs,
	actions: form.user_actions,
	defaults: form.resolved_default_values,
	expiresAt: form.expiration_time,
})
```

In `components/chat/message/human-input-form.tsx`:

- Add to the imports: `Skeleton` from `antd`, `useEffect` from `react`, `import type { HumanInputForm as HumanInputFormDefinition } from '@/lib/dify/types'`, `import { DifyRequestError } from '../provider/dify-fetch'`, `import { applyFormDefinition } from './human-input-definition'`.
- Add to `HumanInputFormProps`:

```ts
	/**
	 * Reads the form's definition (GET /form/human_input/{form_token}); given for a pending form with a token. Until
	 * it answers the form shows a skeleton; a 412 means the form was submitted or expired meanwhile; any other
	 * failure keeps the stream's fields (the documented fallback).
	 */
	loadForm?: () => Promise<HumanInputFormDefinition>
```

- Rename the prop `humanInput` inside the component to `given` and derive the one used: after the hooks that exist, add

```ts
	const [definition, setDefinition] = useState<
		{ status: 'loading' } | { status: 'ready'; humanInput: HumanInputState } | { status: 'submitted' }
	>(() => (loadForm && given.state === 'pending' && given.formToken ? { status: 'loading' } : { status: 'ready', humanInput: given }))
	useEffect(() => {
		if (!loadForm || given.state !== 'pending' || !given.formToken) return
		let ignore = false
		loadForm().then(
			form => {
				if (!ignore) setDefinition({ status: 'ready', humanInput: applyFormDefinition(given, form) })
			},
			(error: unknown) => {
				if (ignore) return
				if (error instanceof DifyRequestError && error.code === 'human_input_form_expired') setExpiredNow(true)
				if (error instanceof DifyRequestError && error.code === 'human_input_form_submitted') setDefinition({ status: 'submitted' })
				else setDefinition({ status: 'ready', humanInput: given })
			},
		)
		return () => {
			ignore = true
		}
	}, [given, loadForm])
	if (definition.status === 'loading') return <Skeleton active paragraph={{ rows: 3 }} />
	if (definition.status === 'submitted') {
		return (
			<Alert type="info" showIcon title={t('hitl.title')} description={t('hitl.already_submitted')} />
		)
	}
	const humanInput = definition.humanInput
```

  The `initialValues` state and the `phase` must be computed from this `humanInput`, so move the `const [initialValues] = useState(() => humanInputInitialValues(…))` line below it and key the inner `<Form>` on the definition (`key={definition.status}`) so antd reads the loaded defaults once. React's rules: hooks stay above the early returns; the `useState`/`useEffect` for the definition go right after `const inFlight = useRef(false)`, the early returns after every hook.

- Add the key `hitl.already_submitted` to the three locale files: en `"This form was already submitted."`, zh `"此表单已提交。"`, ar `"تم إرسال هذا النموذج بالفعل."`.

In `components/chat/chat-view/chat-view.tsx`, where `HumanInputForm` is rendered (around line 346), add the prop:

```tsx
								loadForm={
									form.formToken ? () => difyApi.getHumanInputForm(form.formToken) : undefined
								}
```

and `difyApi` to that `useCallback`'s dependency list.

- [ ] **Step 4: The run stops**

In `components/chat/hooks/use-workflow-run.ts` replace `stop` and the doc comment's last sentence ("The Dify run itself goes on …" becomes "stop() also posts Dify's stop for the run's task, so the run ends on the server too (charter §4.1)."):

```ts
	/** Cancels the response body, marks the run stopped, and tells Dify to stop the task (its answer is not needed). */
	const stop = useCallback(() => {
		const current = controller.current
		if (!current || current.signal.aborted) return
		current.abort()
		setState(s => {
			if (s.status !== 'running') return s
			if (s.taskId) {
				const stopOnDify = mode === 'workflow' ? difyApi.stopWorkflow(s.taskId) : difyApi.stopCompletion(s.taskId)
				void stopOnDify.catch(() => undefined)
			}
			return { ...s, status: 'stopped' }
		})
	}, [difyApi, mode])
```

A run that has not yet received its first event has no `taskId`, so nothing is posted (nothing to stop on Dify yet).

- [ ] **Step 5: The e2e cases**

In `e2e/workflow.spec.ts`, inside the test "stopping a run cancels its stream, keeps what arrived and marks it stopped", before clicking Stop add:

```ts
		// Charter §4.1: the stop also reaches Dify for the run's task.
		const stopped = page.waitForRequest(
			request =>
				request.method() === 'POST' && /\/workflows\/tasks\/[^/]+\/stop$/.test(new URL(request.url()).pathname),
		)
```

and after `await cancelled` add `await stopped`. In `e2e/completion.spec.ts` do the same in "stopping keeps the text so far and marks it stopped" with the pattern `/\/completion-messages\/[^/]+\/stop$/`.

In `e2e/chat-hitl.spec.ts` add to the `human input` describe:

```ts
	test('the form definition is read from Dify when the form arrives and when it is reopened', async ({
		page,
	}, testInfo) => {
		const forms = page.waitForRequest(
			request => request.method() === 'GET' && /\/form\/human_input\/[^/]+$/.test(new URL(request.url()).pathname),
		)
		await pauseRun(page, `please hitl definition ${unique(testInfo)}`)
		await forms
		// The stub's definition lists the select options; the form shows them.
		await lastAnswer(page).getByLabel('priority').click()
		await expect(page.getByTitle('high', { exact: true })).toBeVisible()
		await page.keyboard.press('Escape')
		// Reopened from the history: read again.
		const again = page.waitForRequest(
			request => request.method() === 'GET' && /\/form\/human_input\/[^/]+$/.test(new URL(request.url()).pathname),
		)
		await page.reload()
		await again
		await expect(lastAnswer(page).getByRole('button', { name: 'Approve' })).toBeVisible()
	})
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm exec oxfmt --write components/chat __tests__/human-input-definition.test.ts e2e/workflow.spec.ts e2e/completion.spec.ts e2e/chat-hitl.spec.ts locales`
Then: `pnpm exec playwright test e2e/workflow.spec.ts e2e/completion.spec.ts e2e/chat-hitl.spec.ts` on the three projects: green.

```bash
git add components/chat locales __tests__/human-input-definition.test.ts e2e/workflow.spec.ts e2e/completion.spec.ts e2e/chat-hitl.spec.ts
git commit -m "feat(chat): stop workflow and completion runs on Dify; read the human-input form by GET

stop() posts the run's task to the new stop routes; HumanInputForm loads its definition from GET /form/human_input (select options, file rules, defaults, expiry) with a skeleton meanwhile and the stream's fields as the fallback (charter §4.1; ADR-0017 follow-ups).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 15: File links through the proxy; the sidebar icon from the DTO

Charter §4.1 "App data for the browser" (no Dify host in the browser), §4.4 (the icon route).

**Files:**
- Modify: `components/chat/message/message-files.tsx`, `components/chat/chat-view/file-upload.tsx`, `components/chat/chat-view/conversation-sidebar.tsx`, `components/chat/utils-index.ts`
- Test: `__tests__/chat-file-links.test.ts`, `e2e/chat-files.spec.ts`

**Interfaces:**
- Produces: `fileLink(url: string, difyApi: Pick<DifyApi, 'remoteFileUrl'>): string` in `components/chat/message/file-link.ts` (pure): '' for '', the app's remote-file URL for anything else (absolute or relative); `completeFileUrl` is deleted.
- Consumes: `DifyApi.remoteFileUrl` (Task 11), `ChatAppDto.icon` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `__tests__/chat-file-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { fileLink } from '@/components/chat/message/file-link'

const api = { remoteFileUrl: (url: string) => `/api/dify/a1/files/remote?url=${encodeURIComponent(url)}` }

describe('fileLink', () => {
	it('routes relative and absolute Dify links through the remote-file route', () => {
		expect(fileLink('/files/tools/x.png?sign=1', api)).toBe('/api/dify/a1/files/remote?url=%2Ffiles%2Ftools%2Fx.png%3Fsign%3D1')
		expect(fileLink('https://dify.example/files/x.png', api)).toBe('/api/dify/a1/files/remote?url=https%3A%2F%2Fdify.example%2Ffiles%2Fx.png')
	})
	it('keeps an empty link empty', () => {
		expect(fileLink('', api)).toBe('')
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run __tests__/chat-file-links.test.ts`
Expected: FAIL.

- [ ] **Step 3: The helper and its callers**

Create `components/chat/message/file-link.ts`:

```ts
import type { DifyApi } from '@/lib/dify/browser'

/**
 * A file link Dify handed out (a message file's url, a generated image) as the browser may load it: through the
 * app's remote-file route, which fetches it on the user's behalf (charter §4.1: the Dify host never reaches the
 * browser, and need not be reachable from it). An empty link stays empty.
 */
export const fileLink = (url: string, difyApi: Pick<DifyApi, 'remoteFileUrl'>): string =>
	url ? difyApi.remoteFileUrl(url) : ''
```

- `components/chat/message/message-files.tsx`: replace `import { completeFileUrl } from '../utils-index'` with `import { fileLink } from './file-link'`; delete the `const apiBase = …` line; `url: completeFileUrl(file.url, apiBase)` → `url: fileLink(file.url, difyApi)`; the `useMemo` dependency `apiBase` → `difyApi`; the `useAppContext()` destructuring drops `app`.
- `components/chat/chat-view/file-upload.tsx`: the same replacement (`import { fileLink } from '../message/file-link'`; `const { difyApi } = useAppContext()`; `url: fileLink(item.url || '', difyApi) || undefined`; dependency `difyApi`).
- `components/chat/utils-index.ts`: delete `completeFileUrl`.
- `components/chat/chat-view/conversation-sidebar.tsx`, `AppAvatar`: render the DTO's icon instead of the site's URL:

```tsx
/** The app's icon: the stored Dify icon (emoji, or the image through the icon route), else the first letter of its name. */
export function AppAvatar() {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	const icon = app.icon
	return (
		<Avatar
			shape="square"
			src={icon?.kind === 'image' ? `/api/apps/${encodeURIComponent(app.id)}/icon` : undefined}
			style={icon?.kind === 'emoji' && icon.background ? { backgroundColor: icon.background } : undefined}
		>
			{icon?.kind === 'emoji' ? icon.emoji : name.slice(0, 1)}
		</Avatar>
	)
}
```

Run `git grep -n "completeFileUrl\|apiBase" components/chat`: nothing.

- [ ] **Step 4: The e2e proof**

In `e2e/chat-files.spec.ts`, in the test that shows a generated image (the `files` scenario; find the assertion on `getByRole('img', …)` for `stub-image.png`), add that the image is served by the app, not the stub:

```ts
	// Charter §4.1: the browser loads Dify's file through the app's remote-file route, never from the Dify host.
	await expect(image).toHaveAttribute('src', /\/api\/dify\/[^/]+\/files\/remote\?url=/)
```

where `image` is that locator. If no spec shows a generated image yet, add one to `e2e/chat-files.spec.ts`: send `show me files <unique>` on the agent chat (the stub's `files` scenario answers a `message_file` image), then assert the `img` inside `lastAnswer(page)` has that `src` and is loaded (`expect.poll(() => image.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)`).

- [ ] **Step 5: Verify and commit**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat && pnpm exec oxfmt --write components/chat __tests__/chat-file-links.test.ts e2e/chat-files.spec.ts`, then `pnpm exec playwright test e2e/chat-files.spec.ts e2e/chat.spec.ts` on the three projects: green.

```bash
git add components/chat __tests__/chat-file-links.test.ts e2e/chat-files.spec.ts
git commit -m "feat(chat): file links through the remote-file route, the sidebar icon from the DTO

Message files and stored file inputs load through /api/dify/[appId]/files/remote; the sidebar avatar draws the stored icon (charter §4.1, §4.4). completeFileUrl and the apiBase in the browser are gone.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 16: The app gallery and the admin on the DTO, Server Actions and the annotation routes

Charter §4.2 "Actions" (the apps actions on the DAL, `ActionResult`, `refresh()`), §4.4 (the icon on the row; the admin never sees the stored key), §4.1 (annotations through the routes; no browser-side Dify call), §4.5 "Action results".

**Files:**
- Create: `components/apps/app-modes.ts`, `components/admin/apps/app-errors.ts`, `components/admin/apps/use-action-transition.ts`, `app/(admin)/app-management/schemas.ts`
- Modify: `components/apps/app-summary.ts`, `components/apps/app-icon.tsx`, `components/apps/app-card.tsx`, `components/apps/app-gallery.tsx`, `app/(user)/apps/page.tsx`, `app/(admin)/app-management/page.tsx`, `app/(admin)/app-management/actions.ts`, `components/admin/apps/admin-app-row.ts`, `components/admin/apps/app-form-values.ts`, `components/admin/apps/app-settings-fields.tsx`, `components/admin/apps/app-form-drawer.tsx`, `components/admin/apps/app-actions.tsx`, `components/admin/apps/annotations-panel.tsx`, `components/admin/apps/annotations-drawer.tsx`, `components/admin/apps/app-management.tsx`, `e2e/fixtures/stub/apps.ts`, `e2e/auth.setup.ts`, `e2e/admin-apps.spec.ts`, `locales/{en,zh,ar}/translation.json`
- Delete: `components/apps/app-icon-kind.ts`, `components/admin/apps/use-app-record.ts`, `components/admin/apps/app-record.ts`, `app/(admin)/app-management/utils.ts`, `__tests__/app-icon-kind.test.ts`, `__tests__/app-record.test.ts`
- Test: `__tests__/apps-page.test.ts`, `__tests__/app-management-page.test.ts`, `__tests__/app-summary.test.ts`, `__tests__/admin-app-row.test.ts`, `__tests__/app-form-values.test.ts`, `__tests__/app-management-schemas.test.ts`, `__tests__/app-management-actions.test.ts`, `__tests__/app-errors.test.ts`

**Interfaces:**
- Produces: `APP_MODE_NAME_KEYS`, `APP_MODE_OPTION_KEYS`, `APP_MODE_OPTIONS` (`components/apps/app-modes.ts`); `AppSummary = { id, name, description, mode, tags, icon }`, `toAppSummaries(apps: AppDto[])`; `AppIcon` props `{ appId, icon: AppIcon (DTO), mode, size? }` and `appIconUrl(appId)`; `AdminAppRow = AppDto`, `supportsAnnotations(mode)`; `appInputSchema`, `createAppInputSchema`, `AppFormInput`; `createAppAction(input)`, `updateAppAction(id, input)`, `deleteAppAction(id)`, `syncAppAction(id)` returning `ActionResult`; `appErrorKey(code, action)`; `useActionTransition()`; `AppFormValues = AppFormInput`, `DEFAULT_APP_FORM_VALUES`, `toAppFormValues(app)`.
- Consumes: `listApps`, `createApp`, `updateApp`, `deleteApp`, `syncApp`, `AppDto`, `AppIcon`, `SyncResult` (Task 6); `requireUser`, `requireActor` (Task 2); `ActionResult`, `ok`, `fail`, `toActionFailure` (Task 3); `createDifyApi`, `DifyRequestError` (Task 11); `APP_MODES`, `AppMode` (Task 3); `refresh` from `next/cache`.

- [ ] **Step 1: Write the failing tests**

Replace `__tests__/apps-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, listApps, UserShell, AppGallery, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	listApps: vi.fn(),
	UserShell: () => null,
	AppGallery: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/apps', () => ({ listApps }))
vi.mock('@/components/shell/user-shell', () => ({ default: UserShell }))
vi.mock('@/components/apps/app-gallery', () => ({ default: AppGallery }))

import AppListPage from '@/app/(user)/apps/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const settings = { answerForm: { enabled: false, feedbackText: '' }, enableUpdateAfterConversationStarts: false, openingStatementDisplayMode: 'default', annotationEnabled: false }
const app = (id: string, enabled: boolean) => ({
	id, name: `App ${id}`, mode: 'chat', description: '', tags: [], enabled, icon: null, settings,
	apiBase: 'https://dify.example/v1', createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z',
})

describe('/apps page', () => {
	beforeEach(() => {
		requireUser.mockReset()
		listApps.mockReset()
	})
	it('checks the session before it reads the apps', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(AppListPage()).rejects.toBe(redirectSignal)
		expect(listApps).not.toHaveBeenCalled()
	})
	it('hands the gallery the enabled apps, trimmed', async () => {
		requireUser.mockResolvedValue(actor)
		listApps.mockResolvedValue([app('a1', true), app('a2', false)])
		const page = await AppListPage()
		expect(listApps).toHaveBeenCalledWith(actor)
		expect(page).toMatchObject({ type: UserShell, props: { children: { type: AppGallery, props: { apps: [{ id: 'a1', name: 'App a1', icon: null }] } } } })
		expect(JSON.stringify(page.props.children.props)).not.toContain('dify.example')
	})
})
```

Replace `__tests__/app-management-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUser, listApps, AppManagement, redirectSignal } = vi.hoisted(() => ({
	requireUser: vi.fn(),
	listApps: vi.fn(),
	AppManagement: () => null,
	redirectSignal: new Error('NEXT_REDIRECT'),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser }))
vi.mock('@/lib/data/apps', () => ({ listApps }))
vi.mock('@/components/admin/apps/app-management', () => ({ default: AppManagement }))

import AppManagementPage from '@/app/(admin)/app-management/page'

const actor = { id: 'u1', email: 'jane@example.com', name: null }

describe('/app-management page', () => {
	beforeEach(() => {
		requireUser.mockReset()
		listApps.mockReset()
	})
	it('checks the session before it lists the apps', async () => {
		requireUser.mockRejectedValue(redirectSignal)
		await expect(AppManagementPage()).rejects.toBe(redirectSignal)
		expect(listApps).not.toHaveBeenCalled()
	})
	it('hands the table the DTOs as they come (no key in them by construction)', async () => {
		requireUser.mockResolvedValue(actor)
		const rows = [{ id: 'a1', name: 'Alpha', enabled: false, apiBase: 'https://dify.example/v1' }]
		listApps.mockResolvedValue(rows)
		const page = await AppManagementPage()
		expect(listApps).toHaveBeenCalledWith(actor)
		expect(page).toMatchObject({ type: AppManagement, props: { apps: rows } })
	})
})
```

Replace `__tests__/app-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { toAppSummaries } from '@/components/apps/app-summary'
import type { AppDto } from '@/lib/data/apps'

const settings = { answerForm: { enabled: false, feedbackText: '' }, enableUpdateAfterConversationStarts: false, openingStatementDisplayMode: 'default' as const, annotationEnabled: false }
const app = (over: Partial<AppDto> = {}): AppDto => ({
	id: 'a1', name: 'Alpha', mode: 'chat', description: 'First app', tags: ['support'], enabled: true,
	icon: { kind: 'emoji', emoji: '🍵', background: null }, settings, apiBase: 'https://dify.example/v1',
	createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', ...over,
})

describe('toAppSummaries', () => {
	it('keeps enabled apps and drops disabled ones, as /chat does', () => {
		expect(toAppSummaries([app(), app({ id: 'a2', enabled: false })]).map(a => a.id)).toEqual(['a1'])
	})
	it('trims each app to what a card shows, the icon included, the base left out', () => {
		expect(toAppSummaries([app()])).toEqual([
			{ id: 'a1', name: 'Alpha', description: 'First app', mode: 'chat', tags: ['support'], icon: { kind: 'emoji', emoji: '🍵', background: null } },
		])
		expect(JSON.stringify(toAppSummaries([app()]))).not.toContain('dify.example')
	})
})
```

Replace `__tests__/admin-app-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { supportsAnnotations } from '@/components/admin/apps/admin-app-row'

describe('supportsAnnotations', () => {
	it('is true for the modes Dify documents annotations for', () => {
		expect(supportsAnnotations('chat')).toBe(true)
		expect(supportsAnnotations('advanced-chat')).toBe(true)
		expect(supportsAnnotations('agent-chat')).toBe(true)
	})
	it('is false for workflow, completion, the new agent app and no mode', () => {
		expect(supportsAnnotations('workflow')).toBe(false)
		expect(supportsAnnotations('completion')).toBe(false)
		expect(supportsAnnotations('agent')).toBe(false)
		expect(supportsAnnotations(null)).toBe(false)
	})
})
```

Replace `__tests__/app-form-values.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { DEFAULT_APP_FORM_VALUES, toAppFormValues } from '@/components/admin/apps/app-form-values'
import type { AppDto } from '@/lib/data/apps'

const settings = { answerForm: { enabled: true, feedbackText: 'Thanks' }, enableUpdateAfterConversationStarts: true, openingStatementDisplayMode: 'always' as const, annotationEnabled: true }
const app: AppDto = {
	id: 'a1', name: 'Alpha', mode: 'advanced-chat', description: '', tags: [], enabled: false, icon: null, settings,
	apiBase: 'https://dify.example/v1', createdAt: '', updatedAt: '',
}

describe('toAppFormValues', () => {
	it('fills the form from a saved app, with the key left blank (blank keeps it)', () => {
		expect(toAppFormValues(app)).toEqual({ apiBase: 'https://dify.example/v1', apiKey: '', mode: 'advanced-chat', enabled: false, settings })
	})
	it('falls back to chat for an app without a known mode', () => {
		expect(toAppFormValues({ ...app, mode: null }).mode).toBe('chat')
	})
	it('starts a new app enabled, as a chatbot, with every setting off', () => {
		expect(DEFAULT_APP_FORM_VALUES).toEqual({
			apiBase: '', apiKey: '', mode: 'chat', enabled: true,
			settings: { answerForm: { enabled: false, feedbackText: '' }, enableUpdateAfterConversationStarts: false, openingStatementDisplayMode: 'default', annotationEnabled: false },
		})
	})
})
```

Create `__tests__/app-management-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { appInputSchema, createAppInputSchema } from '@/app/(admin)/app-management/schemas'

const valid = {
	apiBase: 'https://dify.example/v1', apiKey: 'app-abc', mode: 'chat', enabled: true,
	settings: { answerForm: { enabled: false, feedbackText: '' }, enableUpdateAfterConversationStarts: false, openingStatementDisplayMode: 'default', annotationEnabled: false },
}

describe('app input schemas', () => {
	it('accepts a full input and strips unknown keys', () => {
		const parsed = createAppInputSchema.safeParse({ ...valid, extra: 'x' })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data).toEqual(valid)
	})
	it('requires the key on create and lets it be blank on update', () => {
		expect(createAppInputSchema.safeParse({ ...valid, apiKey: '' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, apiKey: '' }).success).toBe(true)
		expect(appInputSchema.safeParse({ ...valid, apiKey: undefined }).success).toBe(true)
	})
	it('refuses a non-http base, an unknown mode and a bad display mode', () => {
		expect(appInputSchema.safeParse({ ...valid, apiBase: 'ftp://x/v1' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, apiBase: 'not a url' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, mode: 'rag-pipeline' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, settings: { ...valid.settings, openingStatementDisplayMode: 'never' } }).success).toBe(false)
	})
	it('accepts every Dify mode, the new agent app included', () => {
		for (const mode of ['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion', 'agent']) {
			expect(appInputSchema.safeParse({ ...valid, mode }).success).toBe(true)
		}
	})
})
```

Create `__tests__/app-management-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireActor, createApp, updateApp, deleteApp, syncApp, refresh } = vi.hoisted(() => ({
	requireActor: vi.fn(),
	createApp: vi.fn(),
	updateApp: vi.fn(),
	deleteApp: vi.fn(),
	syncApp: vi.fn(),
	refresh: vi.fn(),
}))
vi.mock('@/lib/auth/session', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/auth/session')>()),
	requireActor,
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ createApp, updateApp, deleteApp, syncApp }))
vi.mock('next/cache', () => ({ refresh }))

import { createAppAction, deleteAppAction, syncAppAction, updateAppAction } from '@/app/(admin)/app-management/actions'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const input = {
	apiBase: 'https://dify.example/v1', apiKey: 'app-abc', mode: 'chat', enabled: true,
	settings: { answerForm: { enabled: false, feedbackText: '' }, enableUpdateAfterConversationStarts: false, openingStatementDisplayMode: 'default', annotationEnabled: false },
}

beforeEach(() => {
	for (const fn of [requireActor, createApp, updateApp, deleteApp, syncApp, refresh]) fn.mockReset()
	requireActor.mockResolvedValue(actor)
})

describe('app actions', () => {
	it('answers unauthorized without a live session and touches nothing', async () => {
		requireActor.mockRejectedValue(new AuthError('unauthorized'))
		expect(await createAppAction(input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(createApp).not.toHaveBeenCalled()
	})
	it('answers invalid_input with field errors for a bad input', async () => {
		const result = await createAppAction({ ...input, apiBase: 'nope', apiKey: '' })
		expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
		if (!result.ok) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['apiBase', 'apiKey'])
	})
	it('creates through the DAL, refreshes the route and answers the result', async () => {
		createApp.mockResolvedValue({ id: UUID, partial: false })
		expect(await createAppAction(input)).toEqual({ ok: true, data: { id: UUID, partial: false } })
		expect(createApp).toHaveBeenCalledWith(actor, input)
		expect(refresh).toHaveBeenCalled()
	})
	it("maps Dify's refusal of the credentials to dify_unreachable", async () => {
		createApp.mockRejectedValue(new DifyError(401, 'unauthorized', 'bad key'))
		expect(await createAppAction(input)).toEqual({ ok: false, code: 'dify_unreachable' })
		expect(refresh).not.toHaveBeenCalled()
	})
	it('updates with a blank key meaning "keep", and answers not_found for a gone app', async () => {
		updateApp.mockResolvedValue({ id: UUID, partial: true })
		expect(await updateAppAction(UUID, { ...input, apiKey: '' })).toEqual({ ok: true, data: { id: UUID, partial: true } })
		expect(updateApp).toHaveBeenCalledWith(actor, UUID, { ...input, apiKey: undefined })
		updateApp.mockResolvedValue(null)
		expect(await updateAppAction(UUID, input)).toEqual({ ok: false, code: 'not_found' })
		expect(await updateAppAction('not-a-uuid', input)).toEqual({ ok: false, code: 'not_found' })
	})
	it('deletes and syncs, answering not_found when the row is gone', async () => {
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		deleteApp.mockResolvedValue(false)
		expect(await deleteAppAction(UUID)).toEqual({ ok: false, code: 'not_found' })
		syncApp.mockResolvedValue({ id: UUID, partial: false })
		expect(await syncAppAction(UUID)).toEqual({ ok: true, data: { id: UUID, partial: false } })
		expect(refresh).toHaveBeenCalledTimes(2)
	})
})
```

Create `__tests__/app-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { appErrorKey } from '@/components/admin/apps/app-errors'

describe('appErrorKey', () => {
	it('maps the codes to translation keys, per action for the generic failure', () => {
		expect(appErrorKey('unauthorized', 'save')).toBe('common.session_expired')
		expect(appErrorKey('forbidden', 'sync')).toBe('common.session_expired')
		expect(appErrorKey('not_found', 'delete')).toBe('admin_apps.not_found')
		expect(appErrorKey('dify_unreachable', 'save')).toBe('admin_apps.dify_unreachable')
		expect(appErrorKey('invalid_input', 'save')).toBe('admin_apps.invalid_input')
		expect(appErrorKey('operation_failed', 'save')).toBe('admin_apps.save_failed')
		expect(appErrorKey('operation_failed', 'sync')).toBe('admin_apps.sync_failed')
		expect(appErrorKey('operation_failed', 'delete')).toBe('common.delete_failed')
	})
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run __tests__/apps-page.test.ts __tests__/app-management-page.test.ts __tests__/app-summary.test.ts __tests__/admin-app-row.test.ts __tests__/app-form-values.test.ts __tests__/app-management-schemas.test.ts __tests__/app-management-actions.test.ts __tests__/app-errors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modes, summaries, the icon, the gallery, the pages**

`components/apps/app-modes.ts`:

```ts
import type { AppMode } from '@/lib/dify/types'

/** Translation keys per Dify app mode: the short name (labels, filters) and the admin form's option text. */
export const APP_MODE_NAME_KEYS: Record<AppMode, string> = {
	chat: 'app_mode.name.chatbot',
	'agent-chat': 'app_mode.name.agent',
	'advanced-chat': 'app_mode.name.chatflow',
	workflow: 'app_mode.name.workflow',
	completion: 'app_mode.name.text_generator',
	agent: 'app_mode.name.agent_app',
}

export const APP_MODE_OPTION_KEYS: Record<AppMode, string> = {
	chat: 'app_mode.option.chatbot',
	'agent-chat': 'app_mode.option.agent',
	'advanced-chat': 'app_mode.option.chatflow',
	workflow: 'app_mode.option.workflow',
	completion: 'app_mode.option.text_generator',
	agent: 'app_mode.option.agent_app',
}

/** The admin form's choices, in the order of Dify's console. */
export const APP_MODE_OPTIONS: readonly AppMode[] = ['chat', 'agent', 'advanced-chat', 'agent-chat', 'workflow', 'completion']
```

Add to the locales under `app_mode.name`: `"agent_app": "Agent app"` (zh `"智能体应用"`, ar `"تطبيق وكيل"`) and under `app_mode.option`: `"agent_app": "Agent app (the new Agent, streaming only)"` (zh `"智能体应用（新版 Agent，仅流式）"`, ar `"تطبيق وكيل (الوكيل الجديد، بثّ فقط)"`).

`components/apps/app-summary.ts`:

```ts
import type { AppDto, AppIcon } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

/** What an app card shows: the DTO minus the base and the settings. */
export interface AppSummary {
	id: string
	name: string
	description: string
	mode: AppMode | null
	tags: string[]
	icon: AppIcon
}

/** Enabled apps only, trimmed for the client. */
export const toAppSummaries = (apps: AppDto[]): AppSummary[] =>
	apps.filter(app => app.enabled).map(({ id, name, description, mode, tags, icon }) => ({ id, name, description, mode, tags, icon }))
```

Replace `components/apps/app-icon.tsx`:

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
import { Avatar } from 'antd'

import type { AppIcon as AppIconData } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

const MODE_ICONS: Record<AppMode, React.ReactNode> = {
	chat: <MessageOutlined />,
	'agent-chat': <RobotOutlined />,
	'advanced-chat': <ApartmentOutlined />,
	workflow: <DeploymentUnitOutlined />,
	completion: <FileTextOutlined />,
	agent: <RobotOutlined />,
}

/** The stored icon image's URL (charter §4.4). */
export const appIconUrl = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/icon`

/** The app's stored Dify icon (an emoji, or the image through the icon route), or its mode icon when it has none. */
export default function AppIcon({
	appId,
	icon,
	mode,
	size = 'large',
}: {
	appId: string
	icon: AppIconData
	mode: AppMode | null
	size?: 'large' | 'small'
}) {
	if (icon?.kind === 'emoji') {
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
	if (icon?.kind === 'image') {
		return (
			<Avatar
				shape="square"
				size={size}
				src={appIconUrl(appId)}
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

Delete `components/apps/app-icon-kind.ts` and `__tests__/app-icon-kind.test.ts` (`git rm`).

`components/apps/app-card.tsx`: remove the `app.missingInfo` branch and its `Typography.Text` import if unused; `import { AppModeNames } from '@/lib/core'` → `import { APP_MODE_NAME_KEYS } from './app-modes'`; `<AppIcon appId={app.id} mode={app.mode} />` → `<AppIcon appId={app.id} icon={app.icon} mode={app.mode} />`; `description={app.mode ? t(AppModeNames[app.mode]) : undefined}` → `description={app.mode ? t(APP_MODE_NAME_KEYS[app.mode]) : undefined}`.
`components/apps/app-gallery.tsx`: `const shown = apps.filter(app => matchesQuery([app.name, app.description, ...app.tags], query))` (the `missingInfo` clause goes).

`app/(user)/apps/page.tsx`:

```tsx
import AppGallery from '@/components/apps/app-gallery'
import { toAppSummaries } from '@/components/apps/app-summary'
import UserShell from '@/components/shell/user-shell'
import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

/** The server page checks the session, reads the DAL, trims and hands plain props to the client gallery (ADR-0020). */
export default async function AppListPage() {
	const actor = await requireUser()
	const apps = toAppSummaries(await listApps(actor))
	return (
		<UserShell>
			<AppGallery apps={apps} />
		</UserShell>
	)
}
```

`app/(admin)/app-management/page.tsx`:

```tsx
import AppManagement from '@/components/admin/apps/app-management'
import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

/** The DTO carries no key (charter §4.4), so the rows go to the table as they come. */
export default async function AppManagementPage() {
	const actor = await requireUser()
	return <AppManagement apps={await listApps(actor)} />
}
```

- [ ] **Step 4: The schemas and the actions**

`app/(admin)/app-management/schemas.ts`:

```ts
import * as z from 'zod'

import { APP_MODES } from '@/lib/dify/types'

const appSettingsSchema = z.object({
	answerForm: z.object({ enabled: z.boolean(), feedbackText: z.string().max(255).default('') }),
	enableUpdateAfterConversationStarts: z.boolean(),
	openingStatementDisplayMode: z.enum(['default', 'always']),
	annotationEnabled: z.boolean(),
})

/** The admin form's input (charter §4.5): on update a blank key means "keep the stored one". */
export const appInputSchema = z.object({
	apiBase: z.url({ protocol: /^https?$/ }).max(500),
	apiKey: z.string().trim().max(255).optional(),
	mode: z.enum(APP_MODES),
	enabled: z.boolean(),
	settings: appSettingsSchema,
})

export const createAppInputSchema = appInputSchema.extend({ apiKey: z.string().trim().min(1).max(255) })

export type AppFormInput = z.infer<typeof appInputSchema>
```

Replace `app/(admin)/app-management/actions.ts`:

```ts
'use server'

import { refresh } from 'next/cache'
import * as z from 'zod'

import { toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireActor } from '@/lib/auth/session'
import { createApp, deleteApp, syncApp, updateApp, type SyncResult } from '@/lib/data/apps'

import { appInputSchema, createAppInputSchema } from './schemas'

/*
 * Thin Server Actions (charter §4.2): verify, validate, call the DAL, refresh the route (next/cache `refresh`:
 * the page reads the database directly, so the current route's RSC payload is refetched in the same round
 * trip), answer a plain ActionResult. Every expected failure is a result, never a throw.
 */

const invalid = (error: z.ZodError) =>
	fail('invalid_input', z.flattenError(error).fieldErrors as Record<string, string[]>)

const isId = (id: string) => z.uuid().safeParse(id).success

export async function createAppAction(input: unknown): Promise<ActionResult<SyncResult>> {
	try {
		const actor = await requireActor()
		const parsed = createAppInputSchema.safeParse(input)
		if (!parsed.success) return invalid(parsed.error)
		const result = await createApp(actor, parsed.data)
		refresh()
		return ok(result)
	} catch (error) {
		return toActionFailure(error, 'createAppAction')
	}
}

export async function updateAppAction(id: string, input: unknown): Promise<ActionResult<SyncResult>> {
	try {
		const actor = await requireActor()
		if (!isId(id)) return fail('not_found')
		const parsed = appInputSchema.safeParse(input)
		if (!parsed.success) return invalid(parsed.error)
		const result = await updateApp(actor, id, { ...parsed.data, apiKey: parsed.data.apiKey || undefined })
		if (!result) return fail('not_found')
		refresh()
		return ok(result)
	} catch (error) {
		return toActionFailure(error, 'updateAppAction')
	}
}

export async function deleteAppAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		if (!isId(id) || !(await deleteApp(actor, id))) return fail('not_found')
		refresh()
		return ok(undefined)
	} catch (error) {
		return toActionFailure(error, 'deleteAppAction')
	}
}

export async function syncAppAction(id: string): Promise<ActionResult<SyncResult>> {
	try {
		const actor = await requireActor()
		if (!isId(id)) return fail('not_found')
		const result = await syncApp(actor, id)
		if (!result) return fail('not_found')
		refresh()
		return ok(result)
	} catch (error) {
		return toActionFailure(error, 'syncAppAction')
	}
}
```

Delete `app/(admin)/app-management/utils.ts` (`git rm`).

- [ ] **Step 5: The admin components**

`components/admin/apps/app-errors.ts`:

```ts
import type { ActionErrorCode } from '@/lib/action-result'

export type AppAction = 'save' | 'sync' | 'delete'

/** An action's failure code as the message the admin reads (charter §4.5: codes, never a route's text). */
export const appErrorKey = (code: ActionErrorCode, action: AppAction) => {
	switch (code) {
		case 'unauthorized':
		case 'forbidden':
			return 'common.session_expired' as const
		case 'not_found':
			return 'admin_apps.not_found' as const
		case 'dify_unreachable':
			return 'admin_apps.dify_unreachable' as const
		case 'invalid_input':
			return 'admin_apps.invalid_input' as const
		default:
			return action === 'sync'
				? ('admin_apps.sync_failed' as const)
				: action === 'delete'
					? ('common.delete_failed' as const)
					: ('admin_apps.save_failed' as const)
	}
}
```

Add to the locales under `admin_apps`: `"invalid_input": "Check the highlighted fields"` (zh `"请检查标出的字段"`, ar `"تحقّق من الحقول المحدّدة"`), `"icon_not_stored": "Saved, but the app's icon image could not be stored"` (zh `"已保存，但无法保存应用图标图片"`, ar `"تم الحفظ، لكن تعذّر تخزين صورة أيقونة التطبيق"`); under `app_setting`: `"api_secret_keep": "Leave blank to keep the current API Secret"` (zh `"留空则保留当前的 API Secret"`, ar `"اتركه فارغًا للإبقاء على مفتاح API الحالي"`).

`components/admin/apps/use-action-transition.ts`:

```ts
'use client'

import { startTransition, useTransition } from 'react'

/**
 * Runs a Server Action from an event handler inside a transition (Next, Server Actions: invoke from an event
 * handler wrapped in startTransition), so the action's refresh() lands and `pending` covers the round trip.
 * `run` resolves once the work is done, which lets a Modal's onOk keep its loading state.
 */
export const useActionTransition = () => {
	const [pending, start] = useTransition()
	const run = (work: () => Promise<void>) =>
		new Promise<void>(resolve => {
			start(async () => {
				await work()
				resolve()
			})
		})
	return { pending, run }
}

export { startTransition }
```

`components/admin/apps/admin-app-row.ts`:

```ts
import type { AppDto } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

/** The admin table's row is the DTO itself: it carries no key (charter §4.4), so nothing needs trimming. */
export type AdminAppRow = AppDto

/** Dify documents GET /apps/annotations for chatbot, chatflow and the legacy agent apps. */
export const supportsAnnotations = (mode: AppMode | null) =>
	mode === 'chat' || mode === 'advanced-chat' || mode === 'agent-chat'
```

`components/admin/apps/app-form-values.ts`:

```ts
import type { AppFormInput } from '@/app/(admin)/app-management/schemas'
import type { AppDto } from '@/lib/data/apps'

/** The drawer's values are the action's input: field names are paths in AppFormInput. */
export type AppFormValues = AppFormInput

export const DEFAULT_APP_FORM_VALUES: AppFormValues = {
	apiBase: '',
	apiKey: '',
	mode: 'chat',
	enabled: true,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	},
}

/** A saved app as the form's initial values. The stored key is never shown: a blank key keeps it (updateApp). */
export const toAppFormValues = (app: AppDto): AppFormValues => ({
	apiBase: app.apiBase,
	apiKey: '',
	mode: app.mode ?? 'chat',
	enabled: app.enabled,
	settings: app.settings,
})
```

`components/admin/apps/app-settings-fields.tsx`: replace the imports and every field path:

```tsx
'use client'

import { Descriptions, Divider, Flex, Form, Input, Select, Switch, Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { APP_MODE_OPTION_KEYS, APP_MODE_OPTIONS } from '@/components/apps/app-modes'
import type { AppDto } from '@/lib/data/apps'

/** The settings form's fields; `record` shows the app's Dify info above them when editing. */
export default function AppSettingsFields({ record }: { record?: AppDto }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const replyOn = Form.useWatch(['settings', 'answerForm', 'enabled'], form)

	return (
		<>
			{record && (
				<Descriptions
					column={1}
					size="small"
					items={[
						{ key: 'name', label: t('app_setting.name'), children: record.name },
						{ key: 'description', label: t('app_setting.description'), children: record.description || t('common.none') },
						{
							key: 'tags',
							label: t('app_setting.tags'),
							children: record.tags.length ? (
								<Flex wrap gap="small">
									{record.tags.map(tag => (
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
				name="apiBase"
				tooltip={t('app_setting.api_base_tooltip')}
				rules={[{ required: true, message: t('app_setting.api_base_required') }]}
			>
				<Input placeholder={t('app_setting.api_base_placeholder')} />
			</Form.Item>
			<Form.Item
				label="API Secret"
				name="apiKey"
				tooltip={t('app_setting.api_secret_tooltip')}
				// The stored key is never sent back to the browser: on edit a blank field keeps it (charter §4.4).
				extra={record ? t('app_setting.api_secret_keep') : undefined}
				rules={record ? [] : [{ required: true, message: t('app_setting.api_secret_required') }]}
			>
				<Input.Password autoComplete="new-password" placeholder={t('app_setting.api_secret_placeholder')} />
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_basic')}</Divider>
			<Form.Item
				label={t('app_setting.type')}
				name="mode"
				tooltip={t('app_setting.type_tooltip')}
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					placeholder={t('app_setting.type_placeholder')}
					options={APP_MODE_OPTIONS.map(mode => ({ value: mode, label: t(APP_MODE_OPTION_KEYS[mode]) }))}
				/>
			</Form.Item>
			<Form.Item label={t('app_setting.status')} name="enabled" tooltip={t('app_setting.status_tooltip')} valuePropName="checked">
				<Switch />
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.update_inputs')}
				name={['settings', 'enableUpdateAfterConversationStarts']}
				tooltip={t('app_setting.update_inputs_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.opening_display')}
				name={['settings', 'openingStatementDisplayMode']}
				tooltip={t('app_setting.opening_display_tooltip')}
			>
				<Select
					options={[
						{ value: 'default', label: t('app_setting.opening_display_default') },
						{ value: 'always', label: t('app_setting.opening_display_always') },
					]}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_more')}</Divider>
			<Form.Item
				label={t('app_setting.allow_annotation')}
				name={['settings', 'annotationEnabled']}
				tooltip={t('app_setting.allow_annotation_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.form_reply')}
				name={['settings', 'answerForm', 'enabled']}
				tooltip={t('app_setting.form_reply_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			{replyOn && (
				<Form.Item
					label={t('app_setting.submit_text')}
					name={['settings', 'answerForm', 'feedbackText']}
					tooltip={t('app_setting.submit_text_tooltip')}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			)}
		</>
	)
}
```

`components/admin/apps/app-form-drawer.tsx`: props become `{ open: boolean; record?: AppDto; onClose: () => void; onClosed: () => void }` (`record` present means edit; the name comes from it, so `mode` and `name` go); remove `useRouter`, `DifyApi`, `isAppInfo`, `isFailedUpdate`, `loading`; the save:

```ts
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = (values: AppFormValues) =>
		void run(async () => {
			const result = record ? await updateAppAction(record.id, values) : await createAppAction(values)
			if (!result.ok) {
				// A refused key, an error body or an unreachable base keeps the drawer open.
				message.error(t(appErrorKey(result.code, 'save')))
				return
			}
			message.success(t(record ? 'admin_apps.edit_success' : 'admin_apps.create_success'))
			if (result.data.partial) message.warning(t('admin_apps.icon_not_stored'))
			onClose()
		})
```

with the imports `import { createAppAction, updateAppAction } from '@/app/(admin)/app-management/actions'`, `import type { AppDto } from '@/lib/data/apps'`, `import { appErrorKey } from './app-errors'`, `import { useActionTransition } from './use-action-transition'`; the submit button `loading={pending}` (drop `disabled={loading}`); the Drawer drops `loading`; the title `record ? t('admin_apps.edit_title', { name: record.name }) : t('admin_apps.create_title')`; the `<Form>` keeps `key={record?.id ?? 'create'}` and `initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}` and `onFinish={save}`. The doc comment's sentence about the Drawer's `loading` prop goes (the record is in the row now).

`components/admin/apps/app-actions.tsx`: imports `import { deleteAppAction, syncAppAction } from '@/app/(admin)/app-management/actions'`, `import { appErrorKey } from './app-errors'`, `import { useActionTransition } from './use-action-transition'`; remove `useRouter`, `DifyApi`, `isAppInfo`, `isFailedUpdate`;

```ts
	const { run } = useActionTransition()

	const sync = () =>
		void run(async () => {
			const result = await syncAppAction(app.id)
			if (!result.ok) {
				message.error(t(appErrorKey(result.code, 'sync')))
				return
			}
			message.success(t('admin_apps.sync_success'))
			if (result.data.partial) message.warning(t('admin_apps.icon_not_stored'))
		})

	const confirmDelete = () =>
		modal.confirm({
			title: t('admin_apps.delete_confirm_title'),
			content: t('admin_apps.delete_confirm_description'),
			okText: t('common.delete'),
			okButtonProps: { danger: true },
			cancelText: t('common.cancel'),
			// The dialog stays open with a loading OK button until the transition settles (Modal hooks, onOk).
			onOk: () =>
				run(async () => {
					const result = await deleteAppAction(app.id)
					if (result.ok) message.success(t('admin_apps.delete_success'))
					else message.error(t(appErrorKey(result.code, 'delete')))
				}),
		})
```

and `if (key === 'sync') sync()`.

`components/admin/apps/annotations-panel.tsx`: props `{ appId: string }`; `import { createDifyApi, DifyRequestError } from '@/lib/dify/browser'` and `import type { AnnotationItem } from '@/lib/dify/types'` replace the `@/lib/api` and `@/lib/core` imports; `const difyApi = useMemo(() => createDifyApi(appId), [appId])`; the effect's `.then(page => { if (ignore) return; setLoaded({ status: 'ready', items: page.data, total: page.total }) })` (no `isAnnotationPage`); `save` becomes

```ts
	const failureText = (error: unknown) =>
		error instanceof DifyRequestError && error.message ? error.message : t('common.operation_failed')

	const save = async (values: AnnotationFormValues) => {
		try {
			if (editing?.item) await difyApi.updateAnnotation(editing.item.id, values)
			else await difyApi.createAnnotation(values)
			message.success(editing?.item ? t('common.update_success') : t('common.create_success'))
			setEditing(null)
			reload()
		} catch (error) {
			console.error('Failed to save the annotation', error)
			message.error(failureText(error))
		}
	}

	const remove = async (id: string) => {
		try {
			await difyApi.deleteAnnotation(id)
			message.success(t('common.delete_success'))
			reload()
		} catch (error) {
			console.error('Failed to delete the annotation', error)
			message.error(t('common.delete_failed'))
		}
	}
```

and the list query passes `keyword: query.keyword || undefined`; the doc comments no longer mention the key reaching the browser (it does not).

`components/admin/apps/annotations-drawer.tsx`: props `{ open: boolean; appId?: string; onClose; onClosed }`; the Drawer drops `loading`; renders `{appId && <AnnotationsPanel key={appId} appId={appId} />}`; the `IDifyAppItem` import goes.

`components/admin/apps/app-management.tsx`: remove `useAppRecord`, `AppModeNames`, `AppModeOptions`, `EIsEnabled`; add `import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from '@/components/apps/app-modes'`; the state:

```ts
	// What a drawer shows stays until its close animation has ended (afterOpenChange(false)); `open` follows the admin's action.
	const [editor, setEditor] = useState<{ open: boolean; record?: AdminAppRow }>({ open: false })
	const [annotations, setAnnotations] = useState<{ open: boolean; appId?: string }>({ open: false })
	const openCreate = () => setEditor({ open: true })
	const openEdit = (app: AdminAppRow) => setEditor({ open: true, record: app })
	const openAnnotations = (appId: string) => setAnnotations({ open: true, appId })
```

the columns: the icon `<AppIcon appId={app.id} icon={app.icon} mode={app.mode} size="small" />`; the type filter `APP_MODE_OPTIONS.map(mode => ({ text: t(APP_MODE_NAME_KEYS[mode]), value: mode }))` with `render: (_, app) => (app.mode ? t(APP_MODE_NAME_KEYS[app.mode]) : t('common.none'))`; the status filter `[{ text: t('admin_apps.status_enabled'), value: true }, { text: t('admin_apps.status_disabled'), value: false }]`, `onFilter: (value, app) => app.enabled === value`, `render: (_, app) => app.enabled ? <Tag color="success">…enabled</Tag> : <Tag>…disabled</Tag>`; the drawers:

```tsx
			<AppFormDrawer
				open={editor.open}
				record={editor.record}
				onClose={() => setEditor(current => ({ ...current, open: false }))}
				onClosed={() => setEditor({ open: false })}
			/>
			<AnnotationsDrawer
				open={annotations.open}
				appId={annotations.appId}
				onClose={() => setAnnotations(current => ({ ...current, open: false }))}
				onClosed={() => setAnnotations({ open: false })}
			/>
```

Delete `components/admin/apps/use-app-record.ts`, `components/admin/apps/app-record.ts`, `__tests__/app-record.test.ts` (`git rm`). Run `pnpm exec tsc --noEmit` and `git grep -n "lib/core\|lib/api'\|isAppInfo\|useAppRecord\|EIsEnabled\|AppModeEnums" components app`: nothing in the touched trees (the chat finished this in Task 12/13; the users area never used them).

- [ ] **Step 6: The stub apps, the seed and the e2e specs**

- `e2e/fixtures/stub/apps.ts`: `isEnabled?: 1 | 2` → `/** Seeded into dify_apps.is_enabled; true when absent. */ enabled?: false`, and `DISABLED_APP`'s `isEnabled: 2` → `enabled: false`.
- `e2e/auth.setup.ts`: the seed carries the boolean and the emoji icon the stub's `/site` answers (the DAL stores it at create and sync; a seeded row needs it set):

```ts
		await db.execute(
			'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, enable_annotation, is_enabled, icon_type, icon, icon_background) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE opening_statement_display_mode = ?, enable_annotation = ?, is_enabled = ?, icon_type = ?, icon = ?, icon_background = ?',
			[
				app.id, app.name, app.mode, 'Seeded for the e2e suite', `${stubApiBase}${app.prefix}`, 'app-e2e',
				app.openingStatementDisplayMode, app.enableAnnotation, app.enabled === false ? 0 : 1,
				...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
				app.openingStatementDisplayMode, app.enableAnnotation, app.enabled === false ? 0 : 1,
				...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
			],
		)
```

- `e2e/admin-apps.spec.ts`: line 498, `await expect(row.locator('img')).toHaveAttribute('src', /stub-image\.png/)` → `await expect(row.locator('img')).toHaveAttribute('src', /\/api\/apps\/[^/]+\/icon$/)` followed by `await expect.poll(() => row.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)` (the route served bytes the browser could decode), with the comment "The created app's stub site names an image icon; the DAL stored its bytes at create time and the icon route serves them (charter §4.4)."; the test "a Dify error body instead of app info keeps the drawer open with a translated error" keeps its assertions (the action answers `dify_unreachable`, the same message); in the "each opening of the drawer starts from its own app" test, add after the first drawer's API Base assertion: `await expect(first.getByLabel('API Secret')).toHaveValue('')` and `await expect(first.getByText('Leave blank to keep the current API Secret')).toBeVisible()` (the key never comes back). The annotations tests stay as they are (they assert the UI; the calls now go through `/api/dify/<id>/apps/annotations`).
- `e2e/apps.spec.ts`: no change (the emoji now comes from the seeded icon columns; the no-site app has none, so its mode icon shows).
- `e2e/ssr-first-paint.spec.ts`: no change (`app-e2e` is still absent from both pages' HTML; the base is allowed in the admin HTML).

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint app components && pnpm exec oxfmt --write app components __tests__ e2e/fixtures/stub/apps.ts e2e/auth.setup.ts e2e/admin-apps.spec.ts locales`
Then: `pnpm exec playwright test e2e/apps.spec.ts e2e/admin-apps.spec.ts e2e/ssr-first-paint.spec.ts e2e/screenshots.spec.ts` on the three projects: green (the screenshots spec draws the admin and apps pages).

```bash
git add app components lib __tests__ e2e/fixtures/stub/apps.ts e2e/auth.setup.ts e2e/admin-apps.spec.ts locales
git commit -m "feat(admin): apps on the DTO, Server Actions with ActionResult, annotations through the routes

The gallery and the admin table take the DAL's DTOs (icon on the row, no key), the drawer saves through createAppAction/updateAppAction (a blank key keeps the stored one), sync and delete are actions that refresh the route, and the annotations panel calls the app's routes through the browser client; the browser-side Dify calls and the key fetch are gone (charter §4.1, §4.2, §4.4, §4.5).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 17: Delete the inherited backend and the shims; the grep gates

Charter §4.3 "Deleted" and "Rules". Every deletion is preceded by a grep proving no importer is left.

**Files:**
- Delete: `lib/dify-client.ts`, `lib/api/` (whole folder), `lib/api-utils.ts`, `lib/core/` (whole folder), `lib/db/types.ts`, `lib/session-user.ts`, `lib/helpers/base-request.ts`, `lib/helpers/vars.ts`, `repository/`, `services/`, `types/index.ts`, `app/api/apps.ts`, `app/api/client/` (whole tree), `instrumentation.ts`, `__tests__/api-utils.test.ts`, `__tests__/audio2text-remap.test.ts`
- Modify: `lib/helpers/index.ts`, `__tests__/proxy.test.ts`, `__tests__/access.test.ts` (example paths), any e2e spec that still names `/api/client`

- [ ] **Step 1: Prove the importers are gone, then delete**

```bash
git grep -n -E "from '@/(lib/dify-client|lib/api|lib/api-utils|lib/core|lib/db/types|lib/session-user|repository|services|types)'" -- app components hooks lib db e2e __tests__ proxy.ts
git grep -n -E "lib/helpers/(base-request|vars)|DIFY_INFO|from '@/lib/helpers'" -- app components hooks lib db e2e __tests__
```

The first command must print nothing. The second lists the `@/lib/helpers` importers (`db/schema/*.ts` for `generateUuidV4`, `components/chat/provider/keys.ts`, `components/chat/chat-view/inputs-values.ts` for `unParseGzipString`, `lib/theme/theme-context.tsx` for the localStorage helpers); none may name `base-request` or `DIFY_INFO`. Then:

```bash
git rm -r lib/dify-client.ts lib/api lib/api-utils.ts lib/core lib/db/types.ts lib/session-user.ts lib/helpers/base-request.ts lib/helpers/vars.ts repository services types/index.ts app/api/apps.ts app/api/client instrumentation.ts __tests__/api-utils.test.ts __tests__/audio2text-remap.test.ts
rmdir lib/db 2>/dev/null; true
# hooks/use-auth.ts lost its only importer in Task 12 (the workspace takes the app from the server); delete it when the grep agrees.
git grep -n "use-auth" -- app components hooks || git rm hooks/use-auth.ts
```

`lib/helpers/index.ts` becomes:

```ts
export * from './gzip'
export * from './id'
export * from './localstorage'
```

(`indexeddb-storage.ts` is imported by its path from `components/chat/persistence/`, as before.)

- [ ] **Step 2: Rename the example paths in the proxy and access tests**

In `__tests__/proxy.test.ts` and `__tests__/access.test.ts` replace every `/api/client/apps` with `/api/dify/app-1/parameters` and `/api/client/%E0%A4%A` with `/api/dify/%E0%A4%A`, and the test names "answers /api/client …", "lets /api/client through …", "… an encoded /api/client …" with "/api/dify". The classifier's behaviour is unchanged (any `/api/*` path but the ungated ones needs a session).

`git grep -n "api/client" -- app components hooks lib e2e __tests__` must print nothing. (`docs/` and `CLAUDE.md` are Task 18's.)

- [ ] **Step 3: Type-check, lint, the full unit suite, and the Chinese-string gate**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint app lib components hooks db e2e __tests__ proxy.ts && pnpm test`
Expected: green. Then the language gate of the charter (§4.5): `git grep -n -P "[\x{4e00}-\x{9fff}]" -- app lib db proxy.ts e2e/fixtures` must print nothing (the locales and the users area's upstream routes, which B2 rewrites, are outside this gate: `app/api/users`, `app/api/init`, `app/api/auth/*password*` may still print lines; list them in the task report as B2's). Also `git grep -n "process\.env\." -- app lib components hooks` must print `lib/env.ts` lines only, and `git grep -n "@ts-nocheck" -- app lib components hooks db e2e` nothing.

- [ ] **Step 4: The e2e specs that assert on backend behaviour**

Run: `pnpm exec playwright test e2e/smoke.spec.ts e2e/harness.spec.ts e2e/auth.spec.ts e2e/admin-users.spec.ts e2e/ssr-first-paint.spec.ts` on the three projects: green (the user routes B2 rewrites are untouched; the deleted tree had no spec of its own).

- [ ] **Step 5: Commit**

```bash
git add -u
git add lib/helpers/index.ts __tests__/proxy.test.ts __tests__/access.test.ts
git commit -m "chore(backend): delete the inherited Dify proxy, clients, core types and the session shim

app/api/client/**, lib/dify-client.ts, lib/api/, lib/api-utils.ts, lib/core/, lib/db/types.ts, repository/, services/, types/index.ts, the never-routed app/api/apps.ts, the start-up log and the request/version helpers are gone; nothing imported them any more (charter §4.3).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

(`git add -u` stages the deletions the `git rm` already recorded plus the edited files; nothing new is created in this task.)

---

### Task 18: Records, documentation, the full gates, the PR

Charter §6 "Records" and "Documents", §4.6 "Gates", §5 B1 "Done when".

**Files:**
- Create: `docs/decisions/0022-treat-the-overhaul-line-as-fully-fork-owned.md`, `docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md`, `docs/decisions/0025-validate-with-zod.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/0009-treat-the-frontend-as-fork-owned.md` (status), `docs/decisions/0006-…md`, `docs/decisions/0017-…md`, `docs/decisions/0020-…md` (dated notes), `CLAUDE.md`, `docs/frontend-conventions.md`, `docs/auth-gate.md`, `.cii-assessment.md` (own commit)

(ADR-0024, the DAL with Server Actions and roles, is B2's: its B1 half, the apps DAL and actions, is recorded in ADR-0023's "More Information" so B2 can refer to it.)

- [ ] **Step 1: ADR-0022, superseding ADR-0009 for this line**

Create `docs/decisions/0022-treat-the-overhaul-line-as-fully-fork-owned.md`:

```markdown
---
status: proposed
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (backend rework brainstorm and B1)
---

# Treat the `fork/overhaul` line as fully fork-owned; upstream is a cherry-pick source only

## Context and Problem Statement

[ADR-0009](0009-treat-the-frontend-as-fork-owned.md) made the frontend fork-owned and kept the backend upstream-shaped (line-level edits, paths never moved) so that upstream syncs stayed cheap. [ADR-0019](0019-keep-two-product-lines.md) then split the product into two lines and ruled that `fork/overhaul` takes no routine merges: upstream commits reach it by `git cherry-pick -x` only. The merge-friendly backend rule therefore protected nothing on this line any more, while it held back the recorded follow-ups (the stop routes, the human-input form GET, the audio part, the icon on the app row, the chat's server lookup, the envelope mess, the untyped session). On 2026-10-07 the owner asked for a total backend rework of this line, compliant with the Dify Service API, Next 16, next-auth and Drizzle as their documentation prescribes (`docs/superpowers/specs/2026-10-07-backend-rework-charter.md`). Which files does the fork own on this line, and how does upstream's work reach it?

## Decision Drivers

- The line's backend must follow the current documentation of its stack ([ADR-0002](0002-use-documented-library-approaches-only.md)), not upstream's shape.
- Upstream's value (Dify API tracking, security fixes) must still be reachable.
- One rule for the whole line, so a session does not have to ask which files it may reshape.

## Considered Options

- The whole line is fork-owned; upstream commits are cherry-picked when wanted and re-implemented where the structure differs.
- Keep the backend upstream-shaped and do the follow-ups as line-level patches (the brief of 2026-10-05).
- Keep routine merges from `main` for the backend only.

## Decision Outcome

Chosen option: the whole `fork/overhaul` line is fork-owned. Files and folders are shaped as the docs and the surveyed reference projects recommend; nothing is kept only because upstream had it. Upstream is a source of cherry-picks (`git cherry-pick -x`): a backend commit that still applies is picked, one that touches a reshaped area is re-implemented in this line's structure and the origin commit named in the message. `AGENTS.md` stays byte-identical to upstream; `CLAUDE.md` says which of its paragraphs do not apply here.

### Consequences

- Good, because the backend can follow its stack's documentation ([ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)) and the follow-ups stop being "known limits".
- Bad, because an upstream backend change is a reading and re-implementation task, never an automatic merge; `fork/main` keeps the cheap path (ADR-0019).
- Neutral, because ADR-0009's frontend half was already this rule.

## Implementation Plan

- **Affected paths**: everything on `fork/overhaul`; the rule lives in `CLAUDE.md` "Branch model" and "How to work here".
- **Patterns to follow**: before picking an upstream commit, `git show --stat <sha>` and map each touched upstream path to this line's structure (`CLAUDE.md` "Where things are"); re-implement with tests when the path no longer exists.
- **Patterns to avoid**: merging `main` or `fork/main` into this line; keeping an upstream-shaped file beside its fork-owned replacement.

### Verification

- [x] B1 (`docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md`) deleted `app/api/client/**`, `lib/api/`, `lib/core/`, `repository/`, `services/` and reshaped `lib/` without a merge conflict to consider.
- [ ] The first upstream cherry-pick after B1 records its mapping in the commit message.

## Alternatives Considered

- Line-level patches on the upstream-shaped backend: rejected by the owner on 2026-10-07 ("not what I want any more"); it would keep three response shapes, two clients and the untyped session.
- Routine backend merges: rejected by ADR-0019 already.

## More Information

Supersedes [ADR-0009](0009-treat-the-frontend-as-fork-owned.md) on this line (on `fork/main` ADR-0009 still governs). Charter: `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §1, §2. Related: [ADR-0019](0019-keep-two-product-lines.md), [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md).
```

- [ ] **Step 2: ADR-0023, the Dify layer**

Create `docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md`:

```markdown
---
status: proposed
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (backend rework brainstorm and B1)
---

# Build the Dify layer as one Route Handler per Service API operation, a typed server client and a pass-through contract

## Context and Problem Statement

The inherited proxy (`app/api/client/dify/[appId]/**`) answered three shapes (`{ code, data }`, bare JSON, raw streams), re-pumped streams through hand-written `ReadableStream`s, relabelled audio parts, had no stop routes for workflow and completion runs and no `GET /form/human_input`, and its two clients (`lib/dify-client.ts` under `@ts-nocheck`, `lib/api/client.ts` calling Dify from the browser with the app's key) resolved Dify's error bodies as values, so the chat kept thirteen shape-specific parsers. Dify 1.17.1's Service API was mapped from the docs' OpenAPI and the controllers (`docs/dify-service-api-1.17.1.md`: 36 operations on 32 paths, the docs and the source agreeing). How should the app front that API?

## Decision Drivers

- Each route forwards exactly what the API defines; Dify's status and error bodies reach the browser unchanged; the end-user id is set on the server ([ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md)).
- Documented Next.js shapes only ([ADR-0002](0002-use-documented-library-approaches-only.md)): the Backend for Frontend guide (Route Handlers as the public API layer; Server Actions for mutations, dispatched sequentially; proxying with validation first).
- Neither the Dify host nor the key reaches the browser.
- One parser on the frontend.

## Considered Options

- One Route Handler per Dify operation under `app/api/dify/[appId]/<Dify path>`, a fork-owned `server-only` typed client, Dify's envelope passed through, the app's own refusals in the same envelope.
- One catch-all handler with an allowlist table.
- Route Handlers for streams and reads, Server Actions for Dify's mutations.
- The official `dify-client` package (3.1.0) as the server client.

## Decision Outcome

Chosen option: one route per operation with a typed client (owner's choice, 2026-10-07).

- Routes: `app/api/dify/[appId]/<Dify path>/route.ts`, Dify's paths and verbs (singular `workflow/{id}/events`, plural `apps/annotations`), 24 files for the 27 operations a screen uses or a recorded follow-up needed; the deferred operations are listed in the charter §4.1. Each handler: session (401) → app (404, 403 when disabled) → validation (`lib/dify/schemas.ts`, zod, unknown keys stripped, `400 invalid_param` naming the paths) → one client call → the answer. `RouteContext` types the params; no segment config (`GET` handlers are not cached since Next 15).
- Client: `lib/dify/client.ts`, one function per operation typed from the map (`lib/dify/types`), `user` placed where Dify reads it, the bearer from the app row, `DifyError` on a non-OK or non-JSON answer, `upstream_unreachable` (502) on a network failure, streams and binaries returned as the upstream `Response` with its status and the meaningful headers.
- Contract: Dify's status and body verbatim (201 upload, 204 delete, `{"result":"success"}` stops, `{}` form submit, 412 form states, SSE, audio); the app's own refusals as `{ code, message, status }` with `unauthorized`, `app_not_found`, `app_disabled`, `invalid_param`, `upstream_error`, `upstream_unreachable`, `internal_error`. The proxy's 401 uses the same envelope.
- Browser: `lib/dify/browser.ts`, one client that rejects with `DifyRequestError` on a non-OK answer; x-sdk's `fetch` option sits on top of it. File links Dify hands out load through `GET …/files/remote?url=` (the app's Dify origin under `/files/` only); the stored app icon through `GET /api/apps/[appId]/icon`.
- Data: `lib/data/apps.ts` is the `server-only` Data Access Layer for apps. Its functions take the verified `actor: SessionUser` as their first parameter (the entry point verifies once; React cache does not dedupe inside Route Handlers, so an in-DAL re-verification would double the session read per chat request), return DTOs without the key (the chat's without the base), and store the Dify icon at create and sync time: `/site`'s `icon_url` for an image is a signed link that expires (`FILES_ACCESS_TIMEOUT`, default 300 s), so the bytes are fetched once, capped at 1 MB, and kept on the row. The admin writes are thin Server Actions (`createAppAction`, `updateAppAction`, `deleteAppAction`, `syncAppAction`) returning `ActionResult` and ending in `refresh()`; a blank key on update keeps the stored one, which never returns to the browser.

### Consequences

- Good, because the route tree is the allowlist and the contract, each route has a vitest suite, and the frontend keeps one error parser (`components/chat/hooks/dify-errors.ts` shrank to two helpers).
- Good, because the recorded follow-ups landed: the workflow and completion stops reach Dify, the human-input form is read by GET, the audio part is forwarded as recorded, the icon lives on the row, the chat page loads its app on the server ([ADR-0020](0020-load-page-data-on-the-server.md)'s exception closed).
- Bad, because 24 small files replace 22; a new operation is a new file plus a client function, a schema and a test.
- Bad, because the audio format is decided by the owner's Dify: a WebM recording is forwarded as such; if 1.17.1 refuses it, the recording format changes on the frontend (recorded in this ADR's notes once verified).
- Neutral, because the deferred operations (run by version id, run detail, logs, conversation variables, app feedbacks, end users, annotation-reply settings, the version root) have the map as their reference and no route.

## Implementation Plan

- **Affected paths**: `app/api/dify/**`, `app/api/apps/[appId]/icon/route.ts`, `lib/dify/{client,errors,schemas,route,remote-file,browser}.ts`, `lib/dify/types/`, `lib/data/apps.ts`, `lib/auth/`, `lib/env.ts`, `lib/action-result.ts`, `lib/action-failure.ts`, `app/(admin)/app-management/{actions,schemas}.ts`, `app/(user)/chat/[appId]/page.tsx`, `components/chat/**`, `components/apps/**`, `components/admin/apps/**`, `db/schema/apps.ts` and its migration, `e2e/fixtures/stub/apps.ts`, `e2e/auth.setup.ts`, the specs.
- **Dependencies**: `zod` ([ADR-0025](0025-validate-with-zod.md)).
- **Patterns to follow**: a new Dify operation = a type in `lib/dify/types`, a client function, a schema, a route file with the five steps, a browser-client method, a test per layer; entry points verify the session once and pass the actor to the DAL; errors are codes, never a route's text.
- **Patterns to avoid**: a `{ code, data }` wrapper; reading `user` from the client; calling Dify from the browser; a DAL function without an actor; `process.env` outside `lib/env.ts`.

### Verification

- [x] `__tests__/dify-*.test.ts`, `data-apps.test.ts`, `app-icon-route.test.ts`, `app-management-actions.test.ts`: the five-step order, the envelope, the `user` placement, the stream passthrough, the icon cap, the remote-file origin check.
- [x] The e2e suite on the three projects, with the new cases (both stops, the form GET, the icon route, the disabled app page, the remote-file image).
- [ ] The Docker gate of `CLAUDE.md` with the new curl checks; the owner's browser check against Dify 1.17.1, audio included.

## Pros and Cons of the Options

### One route per operation with a typed client

- Good, because it is the shape of the Backend for Frontend guide's public endpoints and of Dify's own Next.js template (`langgenius/webapp-conversation`: one Route Handler per endpoint).
- Bad, because of the file count.

### A catch-all handler with an allowlist table

- Good, because one file.
- Bad, because the table becomes a hand-written router carrying the per-operation `user` placement, mode gates and shapes, apart from the types.

### Server Actions for Dify's mutations

- Good, because it follows the mutation guidance literally.
- Bad, because the chat would use two transports, actions run one at a time per client, and these mutations revalidate nothing of the app's own data.

### The official `dify-client` 3.1.0

- Good, because it is maintained by Dify.
- Bad, because its answers are untyped `JsonObject`s and it has no human-input form, events stream or logs; it would need wrapping anyway.

## More Information

Sources: `docs/dify-service-api-1.17.1.md` (built from the dify-docs OpenAPI at `7801fc28` and the 1.17.1 controllers at `8387590a`); Next 16.3 bundled docs `02-guides/backend-for-frontend.md`, `02-guides/data-security.md`, `02-guides/authentication.md`, `02-guides/server-actions.md`, `03-api-reference/03-file-conventions/route.md`, `04-functions/fetch.md` ("Memoization does not apply in Route Handlers"), `04-functions/refresh.md`, `02-guides/upgrading/version-15.md`; Dify 1.17.1 `controllers/common/fields.py` (`Site.icon_url` through `graphon.file.helpers.get_signed_file_url`) and `configs/feature/__init__.py` (`FILES_ACCESS_TIMEOUT`); the reference survey `.superpowers/sdd/2026-10-07-backend-rework/reference-projects.md` (`nextjs/saas-starter`, `create-t3-app`, `vercel/platforms`, `langgenius/webapp-conversation`, documenso). Charter: `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §4.1 to §4.5; plan: `docs/superpowers/plans/2026-10-07-backend-b1-dify-layer.md`. Related: [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md), [ADR-0017](0017-build-the-chat-on-ant-design-x.md), [ADR-0018](0018-gate-route-groups-on-the-server.md), [ADR-0020](0020-load-page-data-on-the-server.md), [ADR-0022](0022-treat-the-overhaul-line-as-fully-fork-owned.md).
```

- [ ] **Step 3: ADR-0025, zod**

Create `docs/decisions/0025-validate-with-zod.md`:

```markdown
---
status: proposed
date: 2026-10-07
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (backend rework brainstorm and B1)
---

# Validate request bodies, action inputs and the environment with zod

## Context and Problem Statement

The backend rework needs per-operation allowlists for the Dify routes (unknown keys stripped, `400 invalid_param` naming the fields), validated Server Action inputs with field errors for `useActionState`, and a parsed server environment. The repo had no validation library; the inherited handlers destructured request bodies and trusted them. [ADR-0015](0015-record-decisions-as-adrs-and-session-handoffs.md) asks for an ADR when a dependency is added.

## Decision Drivers

- Next's forms, authentication and Server Actions guides validate action input with zod.
- One library for routes, actions and the environment; typed schemas (`z.infer`).
- A current major with a documented API ([ADR-0002](0002-use-documented-library-approaches-only.md)).

## Considered Options

- zod 4.
- Hand-written type guards (the inherited `isRecord`/`isAppInfo` style).
- valibot or another schema library.

## Decision Outcome

Chosen option: zod 4 (`import * as z from 'zod'`; `z.object` strips unknown keys, `z.strictObject` refuses them; `safeParse`; `z.flattenError` for field errors; `{ error }` messages; `z.url()`, `z.uuid()`, `z.coerce`, `z.discriminatedUnion`). Schemas live in `lib/dify/schemas.ts` (routes), beside each `actions.ts` (actions) and in `lib/env.ts` (environment). Next's guide snippets show zod 3 syntax (`invalid_type_error`, `.flatten()`); this line follows the v4 API.

### Consequences

- Good, because a route's or action's input is one readable schema, tested on its own, and the types follow from it.
- Bad, because zod runs in the browser bundle wherever a schema is imported by value from a client component; the admin form imports only the inferred type (`import type`), so the bundle is unaffected.
- Neutral, because the frontend's own form validation stays antd `Form` rules; zod validates on the server.

## Implementation Plan

- **Affected paths**: `package.json` (`zod` ^4), `lib/dify/schemas.ts`, `lib/env.ts`, `app/(admin)/app-management/schemas.ts`, their tests.
- **Patterns to follow**: `safeParse` and a result, never a thrown ZodError across a boundary; name the failing paths in the refusal; `z.object` for input (strip), `z.strictObject` only where unknown keys must be refused.
- **Patterns to avoid**: zod 3 idioms (`invalid_type_error`, `.strict()`, `error.flatten()`); schemas imported by value into client components.

### Verification

- [x] `__tests__/dify-schemas.test.ts`, `env.test.ts`, `app-management-schemas.test.ts` pass.
- [x] `pnpm why zod` shows one copy.

## Alternatives Considered

- Hand-written guards: rejected; they are what the inherited code had, untyped and untested at the edges.
- valibot: rejected; Next's guides and the surveyed projects use zod.

## More Information

Sources: zod 4 docs (Context7 `zod`, current major); Next 16.3 bundled docs `02-guides/forms.md`, `02-guides/authentication.md`, `02-guides/server-actions.md`; the reference survey (`nextjs/saas-starter` `validatedAction`). Related: [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md).
```

- [ ] **Step 4: The index, the supersession and the dated notes**

In `docs/decisions/README.md` change ADR-0009's row to `superseded by [ADR-0022](0022-treat-the-overhaul-line-as-fully-fork-owned.md)` and append the rows:

```markdown
| [0022](0022-treat-the-overhaul-line-as-fully-fork-owned.md) | Treat the `fork/overhaul` line as fully fork-owned; upstream is a cherry-pick source only | proposed | 2026-10-07 |
| [0023](0023-build-the-dify-layer-as-one-route-per-operation.md) | Build the Dify layer as one Route Handler per Service API operation, a typed server client and a pass-through contract | proposed | 2026-10-07 |
| [0025](0025-validate-with-zod.md) | Validate request bodies, action inputs and the environment with zod | proposed | 2026-10-07 |
```

(0024 is reserved for B2's Data Access Layer, Server Actions and roles; say so in a one-line note under the table.) In `docs/decisions/0009-…md` set the front matter `status: superseded by [ADR-0022](0022-treat-the-overhaul-line-as-fully-fork-owned.md)` and add at the end: `Note, 2026-10-07: superseded on fork/overhaul by ADR-0022 (the whole line is fork-owned). On fork/main this record still governs.`

Append dated notes:

- `docs/decisions/0006-…md`: `Note, 2026-10-07 (backend rework B1): the Dify handlers now live under app/api/dify/[appId]/<Dify path> (ADR-0023); each verifies the session first and sets user from it; the app's own refusals and the proxy's API 401 use Dify's envelope. The /api/users/* gap stays open until B2 deletes those handlers. The vestigial x-user-id header and getUserIdFromRequest are gone with lib/dify-client.ts and lib/api-utils.ts.`
- `docs/decisions/0017-…md`: `Note, 2026-10-07 (backend rework B1): the chat's data calls go through lib/dify/browser.ts, which rejects with DifyRequestError on any non-OK answer (Dify's envelope passed through by the routes, ADR-0023), so dify-errors.ts keeps toDifyError and humanInputFailureText only. The workflow and completion runners post Dify's stop for the run's task_id (spec §4.8's limit closed). The human-input form reads its definition from GET /form/human_input/{form_token} when it arrives and when it is reopened (the note of 2026-10-05 is resolved); a 412 shows the submitted or expired state. The audio part is forwarded under its recorded type and name; the owner's check against Dify 1.17.1 (Task 18, Step 9) is written here as either "WebM accepted" or "WebM refused: the recording format changes in phase 2". Message files and generated images load through …/files/remote; the chat DTO carries no apiBase.`
- `docs/decisions/0020-…md`: `Note, 2026-10-07 (backend rework B1): the chat page loads its app on the server (getChatApp, a DTO without the base or the key) and renders a missing or disabled app as its own state, so the stated exception is closed; the Dify icon is stored on the app row at create and sync time and served by GET /api/apps/[appId]/icon, so the per-card /site request is gone. The pages read lib/data/apps.ts (the Data Access Layer, ADR-0023) and the admin writes are Server Actions returning ActionResult and ending in refresh(); the users area keeps its handlers until B2.`

- [ ] **Step 5: `CLAUDE.md`, `docs/frontend-conventions.md`, `docs/auth-gate.md`**

`CLAUDE.md`:

- "How to work here", the bullet starting "Backend files stay upstream-shaped …": replace with `- The whole line is fork-owned (ADR-0022): backend and frontend follow their stack's current documentation; upstream commits reach this line by \`git cherry-pick -x\` or re-implementation. Backend conventions: ADR-0023 (one route per Dify operation, the typed client, the envelope, the Data Access Layer with the verified actor, Server Actions returning \`ActionResult\`), ADR-0025 (zod). The endpoint map the routes implement is \`docs/dify-service-api-1.17.1.md\`.`
- "Decisions": change ADR-0009's line to `(superseded by ADR-0022)` and add `- ADR-0022 The overhaul line is fully fork-owned; upstream is a cherry-pick source only.`, `- ADR-0023 The Dify layer: \`app/api/dify/[appId]/<Dify path>\` routes, \`lib/dify/\` (types, server client, schemas, browser client), Dify's envelope passed through, \`lib/data/apps.ts\` with the actor parameter, the icon stored on the row, the chat page's server lookup.`, `- ADR-0025 zod for route bodies, action inputs and \`lib/env.ts\`.`
- "Where things are": add a backend bullet before "App list, admin and auth pages": `- Backend (B1, ADR-0023): \`lib/env.ts\` (the environment, parsed once), \`lib/auth/{options,session,password}.ts\` (typed next-auth, \`verifySession\`/\`requireUser\`/\`requireActor\`), \`lib/dify/\` (\`types/\`, \`client.ts\` server-only, \`schemas.ts\`, \`route.ts\`, \`errors.ts\`, \`remote-file.ts\`, \`browser.ts\`), \`lib/data/apps.ts\` (the apps DAL and DTOs), \`lib/action-result.ts\` + \`lib/action-failure.ts\`, \`app/api/dify/[appId]/<Dify path>/route.ts\` (24 files), \`app/api/apps/[appId]/icon/route.ts\`, \`app/(admin)/app-management/{actions,schemas}.ts\`. Still upstream-shaped until B2: \`app/api/users/**\`, \`app/api/init/**\`, \`app/api/auth/{forgot,reset}-password/\`, \`lib/data/users.ts\`.`; in the chat bullet replace "`provider/` (`DifyChatProvider`, message model, history mapper, keys, fetch)" with "`provider/` (`DifyChatProvider`, message model, history mapper, keys, x-sdk's fetch on `lib/dify/browser.ts`)"; in the sub-project 3 bullet drop "`AppIcon`" from the `/site` wording (it reads the DTO now).
- "Docker stack": the curl checks become `(\`/api/health\` 200, \`/apps\` signed out → 307 \`/login?callbackUrl=%2Fapps\`, \`/api/dify/<an app id>/parameters\` signed out → 401 with \`{"code":"unauthorized",…}\`, \`/api/client/apps\` → 404, and \`curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'\` → 1)`.
- "Next step" paragraph: `Next: B2 (accounts and admin) from the charter \`docs/superpowers/specs/2026-10-07-backend-rework-charter.md\` §4.2 and §5, with its own plan; then B3 (its own brainstorm), then frontend phase 2.`
- "Open follow-ups": remove "chat: a workflow app that pauses for human input shows "Paused" without a form" only if Task 14 made the runner show it (it did not: that is phase 2; keep it); remove "sub-project 3 (spec §12): the chat's app lookup moves to its server page, the Dify icon stored on the app row …" (done); under Auth add `role gates and the account-menu password change (B2)`; replace the "After sub-project 4, last" bullet with `- B2 and B3 of the backend rework (charter §5); then frontend phase 2 (the \`agent\` mode in the chat, a paused workflow run showing its form, the rest of the list above).`; add `- Audio: whether Dify 1.17.1 accepts a WebM recording on /audio-to-text is recorded in ADR-0017's note of 2026-10-07; if it refuses, the recording format changes in \`components/chat/hooks/speech-recording.ts\` (phase 2).`

`docs/frontend-conventions.md`, Status: append `- Backend rework B1 (2026-10-07, branch \`feat/backend-b1-dify-layer\`): the Dify layer per ADR-0023 (24 routes under \`app/api/dify/[appId]\`, \`lib/dify/\`, the apps DAL, the chat page's server lookup, the icon on the row, both run stops, the human-input form by GET, file links through the proxy, the admin on Server Actions with \`ActionResult\`); the inherited \`app/api/client/**\`, \`lib/api/\`, \`lib/core/\`, \`lib/dify-client.ts\`, \`repository/\`, \`services/\` are gone. The chat's Dify types come from \`lib/dify/types\`.`

`docs/auth-gate.md`: `lib/session-user.ts` → `lib/auth/session.ts` with the new names (`verifySession()`, `requireUser()`, `requireActor()`, `redirectSignedInUser()`, `getCachedServerSession()`); "every `/api/client/*` route" → "every `/api/dify/*` route"; the grep in step 1 runs on `app/api/dify` and expects nothing; step 2's sentence becomes "Every handler under `app/api/dify/` resolves the session first through `resolveDifyRoute` (`lib/dify/route.ts`) and sets `user` from it; new routes copy that."; the "Vestigial upstream pieces" section is deleted (both pieces are gone).

- [ ] **Step 6: Commit the records and docs**

```bash
pnpm test   # the i18n parity and every suite once more
git add docs CLAUDE.md
git commit -m "docs(backend): ADR-0022, 0023, 0025; notes on 0006, 0017, 0020; CLAUDE.md, conventions and the auth gate on B1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

- [ ] **Step 7: The CII assessment, its own commit**

Read `.cii-assessment.md` and re-check each item against the branch (AGENTS.md's rule): items about tests, documentation and dependency hygiene may change (vitest suites added, a new ADR set). Update any changed row and append a line to the change-log table (`| 2026-10-07 | v0.8.1 | <n>/35 | Backend rework B1: Dify layer per ADR-0023, zod, route and DAL tests |`). Commit it alone:

```bash
git add .cii-assessment.md
git commit -m "docs: update CII assessment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

If nothing changed, say so in the task report and make no commit.

- [ ] **Step 8: The full e2e suite**

Stop `pnpm dev` if it runs. Run `pnpm test:e2e` (the three projects; a cold run compiles every route, allow 20 minutes on this machine). Expected: every spec green, the new cases included. Record the summary line (passed / skipped) in the task report; attach `e2e/screenshots/` paths of the admin and apps screenshots for the owner.

- [ ] **Step 9: The Docker gate**

In the foreground, after taking the old app container down (CLAUDE.md "Docker stack"):

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app
```

Wait for the health check, then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health                       # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:5300/apps              # 307 http://localhost:5300/login?callbackUrl=%2Fapps
curl -s -w '\n%{http_code}\n' localhost:5300/api/dify/any/parameters                      # {"code":"unauthorized","message":"Sign in required.","status":401} then 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/client/apps                   # 404
curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'                                # 1
docker compose -f docker-compose.local.yml logs app | grep -i -E "migrat|b1-apps" | tail -5   # the migration applied
docker compose -f docker-compose.local.yml exec mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT id, is_enabled, icon_type FROM dify_apps;"'
```

The last command shows the owner's rows with `is_enabled` 0/1 and `icon_type` NULL until the owner syncs each app from the admin page (the icon lands at sync time). Record every output in the task report; never print `.env` values. The owner then verifies in the browser against Dify 1.17.1: create an app from its base and key (the icon appears), chat, stop a workflow run, a human-input form, speech to text (the audio format question), text to speech, annotations; and reports the audio outcome for ADR-0017's note.

- [ ] **Step 10: The PR text (no push until the owner says so)**

Write `/tmp/claude-1000/b1-pr.md` following `.github/PULL_REQUEST_TEMPLATE.md` (Overview, Changes table, Testing, Related Issue), in English, naming ADR-0022, ADR-0023 and ADR-0025, the charter and this plan, the deleted trees, the new routes, the migration and its backfill, the e2e summary line and the Docker gate outputs, ending with the attribution block of the session reminder. Then stop and ask the owner: push the branch and open the PR against `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul --title "Backend rework B1: the Dify layer" --body-file /tmp/claude-1000/b1-pr.md`), after the whole-branch review on the most capable model (`superpowers:requesting-code-review`, then `superpowers:receiving-code-review`) has been done and its findings addressed.
