# Part 2a: The AG-UI Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AG-UI agents become the hub's second provider: an admin adds one with Test connection, and a user chats with it in the hub's own chat (streamed text, reasoning and tool cards in one turn, run errors, Stop that stops the agent, history restored on reload, rename and delete), backed by a hub-side conversation store.

**Architecture:** `'agui'` joins the provider registry (ADR-0032's checklist) with zod documents (`agentUrl`, `audience`; secret `jwtSecret`), a per-request HS256 JWT (`jose`) as the only auth header, and a spec-derived Test connection. Three new tables (`conversations`, `conversation_runs`, `conversation_messages`) hold AG-UI messages one row each, written by the server while a run streams. One Route Handler per operation under `app/api/apps/[appId]/` runs a turn through the provider's `chat` adapter (AG-UI's wraps `@ag-ui/client`'s `HttpAgent.runAgent()` on the server), re-encodes the events for the browser with `@ag-ui/encoder` (deltas folded into snapshots, `hub:run` first, a hub-side stop that closes the run as cancelled), and serves the conversation list and history; rename and delete are Server Actions. The browser chat (`components/shared-chat/`) is `useXChat` with an `AgUiChatProvider` whose pure reducer (`lib/chat/turn.ts`) folds events into one X message per turn; the server groups stored messages into the same turns.

**Tech Stack:** Next.js 16.3 (App Router Route Handlers streaming a `ReadableStream`, Server Actions), React 19.2, antd 6.6.5 and Ant Design X 2.9 (`useXChat`, `AbstractChatProvider`, `XRequest`, `Bubble`, `Think`, `ThoughtChain`, `CodeHighlighter`, `Welcome`, `Sender`, `Actions`, `Conversations`), `@ag-ui/client`, `@ag-ui/core` and `@ag-ui/encoder` 1.0.2, `jose` 6.2.12, zod 4.6.5, Drizzle ORM and drizzle-kit 1.0.0-rc.4 on PostgreSQL 18, croner 10.0.1, Vitest 4 (projects `unit`, `db`; node environment), Playwright 1.63 (three projects; the stub on 5399 gains an AG-UI 1.0 producer).

**Spec:** `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` (owner-approved 2026-10-14, decision 56), slice 2a: §2–§5 and §8–§12. Read its §0 first. Running record: `docs/superpowers/research/2026-10-11-provider-hub/README.md`, decisions 40–57. Spike: `…/agui-spike.md` (Appendix A is a scripted Pydantic AI agent for local runs; Appendix D is the reducer this plan's `applyAgUiEvent` grows from). Research: `…/part2-proxy-stop-identity.md` (server side), `…/part2-x-mapping.md` (browser side), `…/part2-store-and-logs.md` (store). Charter: `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`.

## Global Constraints

- **Branches.** This plan merges on its own `docs/` PR first (spec §0, decision 33). The build then runs on `feat/agui-core`, branched from `fork/overhaul` after that merge, in `~/repos/dify-app-hub` itself (no worktree; owner, 2026-10-12). `nvm use` first (Node 22). Nothing is pushed until a task or the owner says so; the PR targets `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`).
- **Commits.** Conventional (`feat|fix|refactor|test|docs|chore(scope): …`), English, `git add <paths>`, never `-A`. Each message ends, after a blank line inside the same `-m`, with `Co-Authored-By: <the implementer's model> <noreply@anthropic.com>` (the plan's commands show `Claude Opus 5.5`; an implementer on another model writes its own name: the owner keeps the mixed per-model trailers, 2026-10-12).
- **ADR-0002.** Documented approaches only, a source per non-obvious choice in a comment, as the surrounding code does. Before using an API, check it against every source AGENTS.md names: the repo's docs, Next's bundled docs (`node_modules/next/dist/docs/`), the library's own skill or CLI (`antd` CLI, the X skills), Context7, crawl4ai. `@ag-ui/*` and `jose` typings are in `node_modules` once Task 1 lands; the research notes cite the source files read for every behaviour this plan relies on.
- **Gates before each commit (AGENTS.md):** `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --check <changed files>`, `pnpm test`. A task that touches `db/` or `lib/data/` also runs `pnpm test:db`. A task that names e2e specs runs them. UI tasks keep `npx -y @ant-design/cli lint ./` at its current finding count or lower.
- **One heavy process at a time** (~5 GB RAM): one `next dev` per checkout (stop `pnpm dev` before `pnpm test:e2e`); `pnpm test:db` and `pnpm test:e2e` share the e2e PostgreSQL on 127.0.0.1:5433 and never run together. The owner's local stack (`ai-app-hub-local`, port 5300) is touched only by Task 19's Docker gate.
- **Migrations (ADR-0031):** `pnpm db:generate --name <name>` only, the generated SQL read before it is committed; never `drizzle-kit push`.
- **Dependencies (spec §9):** `@ag-ui/client@1.0.2`, `@ag-ui/core@1.0.2`, `@ag-ui/encoder@1.0.2`, `jose@6.2.12`, exact versions (`--save-exact`). The browser bundle carries none of `@ag-ui/client`'s or `@ag-ui/encoder`'s runtime: client code imports `@ag-ui/core` **types only** (`import type`), never `EventType` or `@ag-ui/core/schemas`.
- **The agent contract (spec §2.3, decision 45):** `POST <agentUrl>`, body the `RunAgentInput` that `HttpAgent` builds, headers `Content-Type: application/json`, `Accept: text/event-stream` and exactly one auth header, `Authorization: Bearer <JWT>`; no browser header is forwarded; the NextAuth token never leaves the hub.
- **The JWT (spec §2.3):** `jose` `SignJWT`, header `{ alg: 'HS256', typ: 'JWT' }`, key = the app's `jwtSecret` (trimmed, 32–512 characters) as UTF-8 bytes (`TextEncoder`); claims `sub` (account id, ADR-0026), `iat` (now), `exp` (now + 60 s), `iss` (`AGENT_JWT_ISSUER`, default `nextjs-bff`), `aud` (`settings.audience`), `auth_source` (`local` | `ldap`), `roles` (`[role]`); no `name`, no `email`. Minted fresh for every upstream request: each run and each Test connection.
- **Test connection (spec §2.4):** `POST agentUrl` with body `{}` and a fresh JWT whose `sub` is the admin running it, `AbortSignal.timeout(10_000)`. 422 or 400 → reachable; 401 or 403 → `key_refused`; 404 → `agent_not_found`; 415 or another 4xx → `upstream_error`; refused connection, timeout or 5xx → `unreachable`; a 2xx event stream → body cancelled at once, reachable with warning `ran_on_invalid_input`. No error body is read or echoed.
- **Error codes and statuses (spec §8, 2a's rows):** `conversation_not_found` 404, `run_in_progress` 409, `answer_pending` 409, `answers_invalid` 400, `agent_auth_failed` 502 (agent 401/403), `agent_not_found` 502 (agent 404), `agent_rejected_input` 502 (agent 415/422), `provider_unreachable` 503 (no answer), `upstream_error` 502 (any other refusal before the stream; plan call P5). Every one has an i18n key in en, zh and ar. The agent's `RUN_ERROR` codes `usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error` get titles, any other code a generic title.
- **The store (spec §3.1):** exactly the three tables, columns, CHECKs and indexes of §3.1, in `db/schema/conversations.ts`; `seq` is `bigint GENERATED ALWAYS AS IDENTITY`; one active run per conversation (`active_run_id`); soft delete (`deleted_at`); a daily purge of conversations deleted more than 30 days ago.
- **Writing while a run streams (spec §3.2):** upsert by `message_id` when a message starts, ends, its tool result arrives, and at most every 2 s while text streams; rows come from the agent's message list (`onMessagesChanged`), not `newMessages`. On stop, failure or truncation, open messages become `incomplete` and every tool call left without a result gets a `tool` message with `error: 'stopped'`.
- **The stream to the browser (spec §4.4):** `ReadableStream` Route Handler response, `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; `EventEncoder.encodeSSE` per event; `: keep-alive` after 15 s of silence; first event `CUSTOM { name: 'hub:run', value: { conversationId, runId, title } }`; `STATE_DELTA`/`STATE_SNAPSHOT` sent as `STATE_SNAPSHOT` of the applied state, `ACTIVITY_DELTA` as `ACTIVITY_SNAPSHOT`; never sent: `RAW`, `REASONING_ENCRYPTED_VALUE`, `MESSAGES_SNAPSHOT`, and `HttpAgent`'s own `RUN_ERROR { code: 'abort' }`; `RUN_ERROR` from the agent passes through; Stop closes open messages, tool calls and reasoning toward the browser and ends with `RUN_FINISHED { outcome: { type: 'cancelled' } }`. Log lines carry `{ appId, runId, code }` only, never content.
- **Request bodies (spec §4.2):** `POST runs`: `{ conversationId?: uuid, message?: { text: 1–32,000 characters }, answers?: { resume?: [{ interruptId, status: 'resolved' | 'cancelled', payload?: object }], toolResults?: [{ toolCallId, content ≤ 32,000 }] } }`, exactly one of `message` and `answers`, `answers` needs `conversationId`. 2a has no `attachmentIds` (2c adds them).
- **Secrets and DTOs:** `jwtSecret`, `agentUrl` and `audience` reach no DTO, action result, stream or log line; the admin DTO carries `secretsSet: { jwtSecret: boolean }`; a blank secret on Edit keeps the stored one (ADR-0032).
- **Every id from outside passes `z.uuid()`** (`lib/ids.ts`) before a query; a conversation must belong to the actor, match the app and not be deleted, else 404 `conversation_not_found`.
- **Browser (spec §5):** `components/shared-chat/` only; `components/chat/**` stays the Dify chat and behaves exactly as before (its e2e specs stay green); keys follow ADR-0017 (a new chat is `<appId>:temp:<uuid>` for the page session); X status (transport) and the turn's run outcome are separate layers.
- **i18n (ADR-0005):** every new text is a key in `locales/{en,zh,ar}/translation.json` (Arabic in Modern Standard Arabic); icon-only buttons are named by keys, which the e2e locators use; when a string changes, `e2e/` is searched for the old text; `i18next-cli extract`/`sync` are never run.
- **Tests:** unit tests run in Vitest's node environment (no DOM); browser behaviour is proven by the e2e suite on `desktop-light`, `desktop-dark` and `mobile-light`; every Dify spec stays green.
- **Never** read or print `.env` or `.env*.local`; never send an email address to any service other than this app.
- Line numbers are those of `faebc118` unless a step says "as of Task N"; the quoted text decides. A step that says "replace the whole of" a file gives its complete new content. The plan file is formatted by oxfmt (lint-staged), which formats its code blocks too and can strip the leading tabs of a fragment quoted from inside a function: find each "replace" fragment by its text and keep the indentation of the lines it replaces.

**User decisions (already made):**

- The plans are written one part (here: one slice) at a time, each against the code as it stands then (record decision 33; decision 51: "One spec, three PRs").
- Part 2's scope is the core chat plus approvals, ask-user, a shared-state panel and attachments (owner, 2026-10-14, all four picked; decision 41); 2a is the core (decision 51).
- Admins can read every conversation, audited, with a notice, and deleted conversations kept 30 days (owner, 2026-10-14: "Admins can read", "Audited, notice, soft delete"; decisions 42, 49) — 2a builds the soft delete and the purge; the Logs are 2c.
- Every choice is backed by docs, best practice and reference projects (owner, 2026-10-14: "follow docs, best oractiers, and refrense other projetcs"; decision 43).
- Identity is a per-request signed JWT as the only auth header (owner, 2026-10-14, "Bearer + signed user JWT", with the agent service's contract; decision 45; memory `agent-service-contract`).
- An open approval, question or interrupt blocks the composer (owner, 2026-10-14: "Block until answered"; decision 50).
- The browser contract is AG-UI; no admin-defined "HTTP template" provider (owner, 2026-10-14: "Record it, continue"; decision 52).
- Part 2 stays resumable across sessions through spec §0, the running record and the pushed branch (owner, 2026-10-14: "keep facts and progres durable"; decisions 55, 57).
- Feature branches run in `~/repos/dify-app-hub` itself, no worktree (owner, 2026-10-12: "remove the worktree and use the branch as you did originally").
- Commits keep the mixed per-model `Co-Authored-By` trailers (owner, 2026-10-12).

## Plan calls (where the spec is silent; for the owner's review of this plan)

- **P1. The account's source comes from the session, as next-auth documents it.** The `session` callback already copies `token.source` (refreshed from the row on every request by the `jwt` callback) onto `session.user.source` (`lib/auth/options.ts`, `types/next-auth.d.ts`; next-auth v4 "Callbacks": "If you want to make something available you added to the token … you have to explicitly forward it here to make it available to the client"). `SessionUser` gains `source: AccountSource`, and `verifySession()` returns it, treating a session without a known source like one without a known role (no session). The test fixtures that build a `SessionUser` gain `source: 'local'` (Task 2). A `SessionUser` satisfies `ProviderCaller` structurally, so the actor itself is the caller.
- **P2. Test connection gains a third argument, the caller.** `ProviderDefinition.testConnection(settings, secrets, caller)`; Dify ignores it. The action passes the verified admin (P1).
- **P3. 2a implements the server side of answers, not the cards.** Spec §10 puts "the answers check" in 2a: `POST runs` accepts `answers`, checks coverage, unknown and expired ids (§4.3 step 1), passes `resume[]` to the agent, writes `toolResults` as tool messages and stores the answers on the run. Until 2b ships the cards, a conversation whose last run ended on an interrupt disables the Sender with the hint `shared_chat.answer_pending_hint` ("This conversation waits for an answer this chat cannot show yet. Start a new conversation to go on.") and the server refuses a message with 409 `answer_pending` (decision 50's block). 2b replaces the hint's text and adds the way out.
- **P4. 2a advertises no tools** (`tools: []`): `ask_user` is 2b. A call to a tool the hub never advertised and that has no result is answered with an error `tool` message ("This tool is not available here.") when the next run starts (spec §6.2's last bullet applies from 2a, since any such call would otherwise make the next history invalid).
- **P5. Other refusals before the stream** (400, 5xx, any status §4.3 step 4 does not name) answer 502 `upstream_error`, the hub's existing code.
- **P6. A stream that ends without a terminal event, or breaks with a non-abort error,** stores the run `failed` with `{ code: 'upstream_error' }` and sends the browser `RUN_ERROR { code: 'upstream_error' }`; `truncated` stays for the browser leaving (§4.5) and a crash (§3.2 step 5).
- **P7. Tool messages go after their owner when the input is built.** Rows stay in `seq` order; `threadForAgent()` drops `activity` messages and moves each `tool` message right after the assistant message that issued its call, as `@ag-ui/client` 1.0.2 places a `TOOL_CALL_RESULT` (`src/apply/default.ts`, `TOOL_CALL_RESULT`: "an assistant tool_call is immediately followed by its tool result").
- **P8. History pages by turns.** `GET conversations/[conversationId]` answers the latest 20 user turns and what follows them; the cursor is the `seq` of the oldest user message shown. The list answers the newest 100 conversations (Dify's sidebar limit), keyset on `(updated_at, id)`.
- **P9. Turn ids.** A history user turn's id is its message id; an assistant turn's is `turn-<its first run id>`. Live turns keep X's ids for the page session.
- **P10. Tool part status.** `running` until its result; `done` with a result, or at a run's success or interrupt end without one; `error` for a tool message with another `error`; `stopped` for `error: 'stopped'`, a cancelled run or a `RUN_ERROR`. History and the live reducer agree on every stub scenario.
- **P11. A few small browser modules are the shared chat's own** (keys, the provider cache, the bubble items, the turn list): the Dify ones are typed to Dify's message and go with the Dify chat in Part 3. Reused without copying, as spec §5.1 lists: `UserShell`, `AppSider`, `ConversationDrawer`, `WidthToggle`, `SiderCollapsed`, `ConversationSidebar`/`ConversationList`, `useConversationMenu`, `ChatSender`, `MessageMarkdown` and its blocks, `Reasoning`, `prependOlder`, `groupFor`, the chat column's CSS Module. Two contexts make the Dify-bound pieces neutral (Task 14): `MarkdownLinkContext` (the Dify file-link rewrite, spec §5.1's one refactor) and `ChatAppInfoContext` (the app's name, description and icon for `AppAvatar` and `AppInfoBlock`).
- **P12. Until Task 16, `ProviderChat`'s `'agui'` case renders `AppUnavailable reason="missing"`** (inside the branch only).
- **P13. The purge runs daily at 03:00 in the server's zone** (`'0 3 * * *'`, croner `protect`, `unref`), registered beside the directory schedule in `instrumentation.ts`.
- **P14. The e2e AG-UI stub lives on the existing stub server** under `/agui/agents/<name>`, with a test-only `GET /agui/_slow` that reports whether the last slow stream was closed early (the Stop check); the seed adds two AG-UI apps (a working agent and one whose agent answers 404).

## File map

Each task's **Files** section is authoritative; this is the overview.

| Task | Creates | Changes most |
| --- | --- | --- |
| 1 Dependencies | — | `package.json`, `pnpm-lock.yaml` |
| 2 Caller, documents and JWT | `lib/providers/caller.ts`, `lib/providers/agui/{schema,jwt}.ts`, `__tests__/agui-{schema,jwt}.test.ts` | `lib/auth/{session,account-source}.ts`, `lib/env.ts`, `.env.template`, `__tests__/{auth-session,env}.test.ts`, the 21 test files whose `SessionUser` fixtures gain `source` |
| 3 Test connection | `lib/providers/agui/test-connection.ts`, `__tests__/agui-test-connection.test.ts` | `lib/providers/connection.ts`, `lib/action-result.ts`, `app/(admin)/app-management/actions.ts`, `components/admin/apps/connection-outcome.ts`, locales, `__tests__/connection-outcome.test.ts` |
| 4 Second provider | `lib/providers/agui/provider.ts`, `components/provider-ui/agui/form-section.tsx`, migration `*_agui_provider` | `lib/providers/{ids,schemas,registry}.ts`, `lib/providers/dify/provider.ts`, `lib/data/apps.ts`, `app/(admin)/app-management/{schemas,actions}.ts`, `components/provider-ui/{registry,provider-chat,provider-form-section}.tsx`, `components/admin/apps/{app-management.tsx,app-form-values.ts}`, locales, ten test files |
| 5 Store tables | `lib/chat/statuses.ts`, `db/schema/conversations.ts`, migration `*_conversations`, `__tests__/db/conversations-schema.db.test.ts` | `db/schema/index.ts`, `__tests__/db/schema.db.test.ts`, `__tests__/db-apps-migrations.test.ts` |
| 6 Run writes | `lib/chat/thread.ts`, `lib/data/conversations.ts`, `__tests__/chat-thread.test.ts`, `__tests__/db/conversations-run.db.test.ts` | — |
| 7 Reads, rename, delete, purge | `__tests__/db/conversations-read.db.test.ts` | `lib/data/conversations.ts` |
| 8 Turns | `lib/chat/turn.ts`, `__tests__/chat-turn.test.ts` | — |
| 9 Chat adapter | `lib/chat/adapter.ts`, `lib/providers/agui/chat.ts`, `__tests__/agui-chat.test.ts` | `lib/providers/registry.ts`, `lib/providers/agui/provider.ts`, `__tests__/provider-registry.test.ts` |
| 10 Run session | `lib/chat/{active-runs,stream,session}.ts`, `__tests__/chat-{stream,session}.test.ts` | — |
| 11 Chat routes | `lib/chat/{schemas,answers,route,run}.ts`, four Route Handlers under `app/api/apps/[appId]/`, `__tests__/chat-{schemas,answers,route,run,routes}.test.ts` | `__tests__/api-routes.test.ts` |
| 12 Actions and purge | `app/(user)/chat/actions.ts`, `lib/chat/purge.ts`, `__tests__/chat-{actions,purge}.test.ts` | `instrumentation.ts`, `__tests__/instrumentation.test.ts` |
| 13 AG-UI stub | `e2e/fixtures/stub/{agui,agui-apps}.ts`, `__tests__/stub-agui.test.ts` | `e2e/fixtures/stub/{router,server}.ts`, `e2e/fixtures/constants.ts`, `e2e/auth.setup.ts`, `.env.e2e` |
| 14 Neutral Dify pieces | `components/chat/message/markdown/link-context.tsx`, `components/chat/chat-view/app-info-context.tsx`, `components/chat/dify-chat-contexts.ts`, `__tests__/dify-chat-contexts.test.ts` | four markdown blocks, `conversation-sidebar.tsx`, `use-conversation-menu.tsx`, `chat-view.tsx`, `chat-workspace.tsx` |
| 15 Browser data layer | `components/shared-chat/{keys,provider-cache,api,hub-fetch,conversations}.ts`, `components/shared-chat/provider/ag-ui-chat-provider.ts`, `components/shared-chat/hooks/{chat-helpers,use-shared-chat,use-shared-conversations}.ts`, four `__tests__/shared-chat-*.test.ts` | — |
| 16 Shared chat view | `components/shared-chat/{run-error,turn-parts,bubble-items}.ts`, `components/shared-chat/{tool-chain,user-turn,assistant-turn,turn-footer,turn-list,shared-welcome,shared-chat}.tsx`, `__tests__/shared-chat-view.test.ts` | `components/provider-ui/provider-chat.tsx`, locales |
| 17 e2e specs | `e2e/agui-admin.spec.ts`, `e2e/agui-chat.spec.ts` | `e2e/screenshots.spec.ts` |
| 18 Records | `docs/decisions/0033-…`, `docs/decisions/0034-…`, `docs/agui-agents.md` | ADR index and notes (0017, 0023, 0026, 0032), `AGENTS.md`, `docs/frontend-conventions.md`, spec §0, running record |
| 19 Gates | — | — (the Docker gate on the owner's local stack) |

## Shared contracts

These names, types and signatures are binding across tasks: a task that defines one writes it exactly as here; a task that uses one imports it from here. Comments in the real files follow the surrounding code's style; the comments below say what each piece is for.

### Provider side (Tasks 2–4, 9)

```ts
// lib/providers/caller.ts (Task 2) — client-safe
import type { AccountSource } from '@/lib/auth/account-source'
import type { Role } from '@/lib/auth/roles'

/** Who a provider call acts for (Part 2 spec §2.3, §2.4): the account's permanent id (ADR-0026), its source and its role. */
export interface ProviderCaller {
	id: string
	source: AccountSource
	role: Role
}

// lib/providers/agui/schema.ts (Task 2) — client-safe
export const agentUrlSchema = z.url({ protocol: /^https?$/ }).max(500)
export const aguiSettingsSchema = z.object({
	agentUrl: agentUrlSchema,
	audience: z.string().trim().min(1).max(255),
})
export type AguiSettings = z.infer<typeof aguiSettingsSchema>
export const aguiSecretsSchema = z.object({ jwtSecret: z.string().trim().min(32).max(512) })
export type AguiSecrets = z.infer<typeof aguiSecretsSchema>
export const aguiSecretsUpdateSchema = z.object({
	jwtSecret: z
		.string()
		.trim()
		.max(512)
		.optional()
		.transform(value => value || undefined),
})
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
}
export const AGUI_DEFAULT_SECRETS: Record<keyof AguiSecrets, string> = { jwtSecret: '' }

// lib/providers/agui/jwt.ts (Task 2) — server-only
export const AGENT_JWT_LIFETIME_SECONDS = 60
export const mintAgentToken: (args: {
	caller: ProviderCaller
	secret: string
	audience: string
	issuer: string
	now?: Date
}) => Promise<string>

// lib/env.ts (Task 2): ServerEnv gains
agentJwtIssuer: string // AGENT_JWT_ISSUER, blank = absent, default 'nextjs-bff', 1–255 characters

// lib/providers/connection.ts (Task 3)
export type ConnectionTestResult =
	| {
			ok: true
			warning?: { code: 'type_mismatch'; reported: string } | { code: 'ran_on_invalid_input' }
	  }
	| { ok: false; code: 'key_refused' | 'unreachable' | 'upstream_error' | 'agent_not_found' }

// lib/providers/agui/test-connection.ts (Task 3) — server-only
export const AGUI_TEST_TIMEOUT_MS = 10_000
export const testAguiConnection: (
	settings: AguiSettings,
	secrets: AguiSecrets,
	caller: ProviderCaller,
) => Promise<ConnectionTestResult>

// lib/auth/session.ts (Task 2): SessionUser gains `source: AccountSource`; verifySession() reads session.user.source
// (lib/auth/account-source.ts gains `isAccountSource(value): value is AccountSource`, the shape of lib/auth/roles.ts isRole)

// lib/action-result.ts (Task 3, with the result type it widens): ActionErrorCode gains 'provider_agent_not_found'
// app/(admin)/app-management/actions.ts (Task 3; Task 4 passes the caller)
export type ConnectionTestOutcome =
	| { outcome: 'reachable' }
	| { outcome: 'type_mismatch'; reported: string }
	| { outcome: 'ran_on_invalid_input' }

// lib/providers/registry.ts (Task 4; `chat` and chatAdapterOf added by Task 9)
export type ProviderSecretsSet<P extends ProviderId> = Record<keyof ProviderSecrets<P>, boolean>
export interface ProviderDefinition<P extends ProviderId> {
	id: P
	testConnection: (
		settings: ProviderSettings<P>,
		secrets: ProviderSecrets<P>,
		caller: ProviderCaller,
	) => Promise<ConnectionTestResult>
	chatFields: (settings: ProviderSettings<P>) => ProviderChatFields<P>
	summaryFields: (settings: ProviderSettings<P>) => ProviderSummaryFields<P>
	secretsSet: (secrets: ProviderSecrets<P>) => ProviderSecretsSet<P>
	/** Spec §4.1: the hub keeps this provider's conversations (the shared chat's store; 2c's Logs read it). */
	hubHistory: boolean
	/** Spec §4.1: runs one chat turn; only a provider on the shared chat has one (Task 9). */
	chat?: ChatAdapter<P>
}
interface ProviderChatFieldsMap {
	dify: DifyChatFields
	agui: AguiChatFields
}
interface ProviderSummaryFieldsMap {
	dify: DifySummaryFields
	agui: AguiSummaryFields
}
export type ProviderChatFields<P extends ProviderId> = ProviderChatFieldsMap[P]
export type ProviderSummaryFields<P extends ProviderId> = ProviderSummaryFieldsMap[P]
/**
 * A provider's definition for an id that is a type parameter (TypeScript 4.6 "Indexed Access Inference Improvements",
 * microsoft/TypeScript#47109): `PROVIDERS[provider].method(settings)` does not type-check for a union `provider` once
 * there are two providers, so neutral code calls a provider through this.
 */
export const providerDefinition: <P extends ProviderId>(id: P) => ProviderDefinition<P>
/** Task 9: the provider's chat adapter, or undefined for one not on the shared chat (Dify until Part 3). */
export const chatAdapterOf: (provider: ProviderId) => ChatAdapter<ProviderId> | undefined

// lib/providers/schemas.ts (Task 4): StoredSettings<P = ProviderId> and StoredDocuments<P = ProviderId> become generic
// (still the union over every provider by default); secretsSchemaOf<P>(provider: P): z.ZodType<ProviderSecrets<P>>.
// lib/data/apps.ts (Task 4): AppRecord<P>, ChatAppDto<P>, AppSummary<P>, AdminAppDto<P> generic with the same default;
// AdminAppDto's invalid member carries an optional `settings` (M5). A generic DTO is built from two separately typed
// values and returned as `{ ...common, ...fields }` (an object literal spreading a generic value does not type-check).

// lib/providers/dify/provider.ts (Task 4): exports DifyChatFields, DifySummaryFields; difyProvider gains hubHistory: false
// lib/providers/agui/provider.ts (Task 4)
export type AguiChatFields = Record<never, never> // 2b adds askUser, 2c the attachment kinds
export type AguiSummaryFields = Record<never, never>
export const aguiProvider // { id: 'agui', ...PROVIDER_SCHEMAS.agui, testConnection: testAguiConnection, chatFields, summaryFields,
//                            secretsSet: s => ({ jwtSecret: s.jwtSecret.length > 0 }), hubHistory: true, chat: aguiChat (Task 9) }
```

### Chat adapter (Task 9) — `lib/chat/adapter.ts`, server-only

```ts
import type { BaseEvent, Message, ResumeEntry, Tool } from '@ag-ui/core'

/** What a provider's chat adapter is given for one turn (spec §4.1, §4.3 step 3). */
export interface ChatTurnInput {
	/** The conversation id: the AG-UI threadId (spec §3.1). */
	threadId: string
	/** Minted by the hub, never reused (spec §3.1). */
	runId: string
	/** The stored thread as threadForAgent() built it (Task 6): seq order, no activity messages. */
	messages: Message[]
	state: unknown
	/** 2a: always [] (plan call P4). */
	tools: Tool[]
	resume?: ResumeEntry[]
	caller: ProviderCaller
	/** Owned by the run session (Task 10); aborting it closes the upstream request. */
	abortController: AbortController
}

/** Where an adapter reports the run (Task 10's session implements it). */
export interface ChatTurnSink {
	/** Each event after the client's compatibility boundary, enforcement and verification, before it is applied. */
	event(event: BaseEvent): void
	/** The thread's whole message list after an event changed it. */
	messages(messages: readonly Message[]): void
	/** The thread's state after an event changed it. */
	state(state: unknown): void
}

export type UpstreamErrorCode =
	| 'agent_auth_failed'
	| 'agent_not_found'
	| 'agent_rejected_input'
	| 'provider_unreachable'
	| 'upstream_error'

/** Spec §4.3 step 4 and plan call P5: each code's HTTP status toward the browser. */
export const UPSTREAM_STATUS: Record<UpstreamErrorCode, number> = {
	agent_auth_failed: 502,
	agent_not_found: 502,
	agent_rejected_input: 502,
	provider_unreachable: 503,
	upstream_error: 502,
}

export type ChatTurnOpened = { ok: true } | { ok: false; code: UpstreamErrorCode }

export interface ChatTurnHandle {
	/** Settles once the agent answered: with a stream (ok), or with why not (spec §4.3 step 4). Never rejects. */
	opened: Promise<ChatTurnOpened>
	/** Settles when the run is over, however it ended. `failed` when the stream broke with an error that is not an abort. Never rejects. */
	finished: Promise<{ failed: boolean }>
}

export interface ChatAdapter<P extends ProviderId> {
	runTurn(
		app: { settings: ProviderSettings<P>; secrets: ProviderSecrets<P> },
		input: ChatTurnInput,
		sink: ChatTurnSink,
	): ChatTurnHandle
}
// lib/providers/agui/chat.ts (Task 9)
export const upstreamCodeFor: (status: number) => UpstreamErrorCode
export const aguiChat: ChatAdapter<'agui'>
```

### Store (Tasks 5–7)

```ts
// lib/chat/statuses.ts (Task 5) — client-safe; db/schema/conversations.ts builds its CHECKs from these
export const RUN_STATUSES = [
	'running',
	'succeeded',
	'interrupted',
	'cancelled',
	'failed',
	'truncated',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const MESSAGE_STATUSES = ['streaming', 'complete', 'incomplete'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]
export const MESSAGE_ROLES = [
	'developer',
	'system',
	'assistant',
	'user',
	'tool',
	'activity',
	'reasoning',
] as const
export type MessageRole = (typeof MESSAGE_ROLES)[number]
/** Spec §3.1: the first user message, trimmed to 80 characters (code points), until renamed. */
export const TITLE_MAX_LENGTH = 80
/** Spec §3.4: a deleted conversation is purged after 30 days. */
export const PURGE_AFTER_DAYS = 30
/** The tool messages the hub writes itself (here, client-safe, because the browser's reducer reads the first). */
export const STOPPED_TOOL_ERROR = 'stopped'
export const STOPPED_TOOL_CONTENT = 'The run was stopped before this tool returned a result.'
export const UNAVAILABLE_TOOL_ERROR = 'not_available' // plan call P4
export const UNAVAILABLE_TOOL_CONTENT = 'This tool is not available here.'

// db/schema/conversations.ts (Task 5): tables `conversations`, `conversationRuns`, `conversationMessages`
// (SQL names conversations, conversation_runs, conversation_messages), columns exactly as spec §3.1, camelCase in TS:
// conversations: id, appId, userId, title, state, activeRunId, createdAt, updatedAt, deletedAt
// conversationRuns: id, conversationId, status, outcome, resume, error, usage, custom, startedAt, finishedAt
// conversationMessages: seq (bigint, mode 'number', generatedAlwaysAsIdentity), conversationId, runId, messageId, role, body, status, createdAt, updatedAt

// lib/data/conversations.ts (Tasks 6–7) — server-only, the DAL (ADR-0024)
export interface RunError {
	code?: string
	message: string
}
export interface CustomRecord {
	name: string
	value: unknown
}
export interface ConversationRecord {
	id: string
	appId: string
	title: string
	state: unknown
	activeRunId: string | null
	updatedAt: Date
}
export interface StoredRun {
	id: string
	status: RunStatus
	outcome: unknown // RUN_FINISHED.outcome as received
	error: RunError | null
	custom: CustomRecord[]
	startedAt: Date
	finishedAt: Date | null
}
export interface StoredMessage {
	seq: number
	messageId: string
	runId: string | null
	role: MessageRole
	body: Message // @ag-ui/core, checked with MessageSchema on write and read
	status: MessageStatus
}
/** The handle startRun gives back; the run's later writes are keyed by it (the actor was verified at the start). */
export interface RunKey {
	conversationId: string
	runId: string
}

// Task 6 (writes and the run's reads)
export async function findConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<ConversationRecord | null>
export async function lastRun(conversationId: string): Promise<StoredRun | null>
export async function loadThread(conversationId: string): Promise<StoredMessage[]> // every row, seq order
export interface StartRunInput {
	appId: string
	/** An existing conversation (already found for this actor), or a new one with the hub's id and the message's title. */
	conversation: { id: string } | { id: string; title: string; isNew: true }
	runId: string
	/** Inserted with run_id = runId, status complete, in this order: the answers' or the hub's tool messages, then the user message. */
	messages: Message[]
	resume?: unknown
}
export type StartRunResult =
	| { ok: true; key: RunKey }
	| { ok: false; code: 'run_in_progress' | 'conversation_not_found' }
export async function startRun(actor: SessionUser, input: StartRunInput): Promise<StartRunResult>
export async function saveMessages(
	key: RunKey,
	rows: { message: Message; status: MessageStatus }[],
): Promise<void>
export async function saveState(key: RunKey, state: unknown): Promise<void>
export interface RunEnd {
	status: Exclude<RunStatus, 'running'>
	outcome?: unknown
	error?: RunError
	usage?: unknown
	custom: CustomRecord[]
	/** Stop, failure or truncation (spec §3.2 step 4): rows to mark incomplete, and the tool messages that answer cut-off calls. */
	close?: { messageIds: string[]; toolMessages: Message[] }
}
export async function finishRun(key: RunKey, end: RunEnd): Promise<void>
/** Spec §3.2 step 5: a run stored as running that no process holds becomes truncated. */
export async function truncateStaleRun(key: RunKey): Promise<void>

// Task 7 (the browser's reads, rename, delete, purge)
export const LIST_PAGE_MAX = 100 // plan call P8
export const THREAD_PAGE_TURNS = 20 // plan call P8
/** The list's keyset cursor, opaque to the browser (base64url JSON of updatedAt and id). */
export const encodeListCursor: (updatedAt: Date, id: string) => string
export const decodeListCursor: (value: string) => { updatedAt: Date; id: string } | null
export interface ConversationListItem {
	id: string
	title: string
	updatedAt: string /* ISO */
}
export async function listConversations(
	actor: SessionUser,
	appId: string,
	page: { cursor?: string; limit: number },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }>
export interface ThreadPage {
	conversation: ConversationRecord
	rows: StoredMessage[]
	runs: StoredRun[]
	/** The seq of the oldest user message shown, as a string; null when nothing is older (plan call P8). */
	cursor: string | null
}
export async function readThreadPage(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	page: { before?: number; turns: number },
): Promise<ThreadPage | null>
export async function renameConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	title: string,
): Promise<boolean>
export async function softDeleteConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<boolean>
/** The daily job (spec §3.4): no actor; deletes conversations deleted more than PURGE_AFTER_DAYS ago, answers the count. */
export async function purgeDeletedConversations(now?: Date): Promise<number>

// lib/chat/thread.ts (Task 6) — server-only; re-exports the four tool-message constants from statuses.ts
/** Plan call P7: the next RunAgentInput's messages: seq order, no activity, each tool message right after its owner. */
export const threadForAgent: (rows: readonly StoredMessage[]) => Message[]
/** Calls without a tool message (spec §3.2 step 4, §6.2; plan call P4). */
export const unansweredToolCalls: (
	messages: readonly Message[],
) => { toolCallId: string; name: string }[]
export const errorToolMessage: (toolCallId: string, error: string, content: string) => Message
export const titleFrom: (text: string) => string // trimmed, at most TITLE_MAX_LENGTH code points
```

### Turns (Task 8) — `lib/chat/turn.ts`, client-safe, `import type` only from `@ag-ui/core`

```ts
export type ToolStatus = 'running' | 'done' | 'error' | 'stopped' // plan call P10
export type TurnPart =
	| { kind: 'text'; messageId: string; text: string }
	| { kind: 'reasoning'; messageId: string; text: string }
	| {
			kind: 'tool'
			toolCallId: string
			name: string
			args: string
			status: ToolStatus
			result?: string
			error?: string
	  }
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }
export type RunOutcome = 'running' | 'success' | 'interrupt' | 'cancelled' | 'error' | 'truncated'
export interface TurnRun {
	runId: string
	outcome: RunOutcome
	error?: { code?: string; message: string }
	/** CUSTOM run_cancelled's reason, e.g. 'run_timeout' (spec §2.3). */
	cancelledReason?: string
}
/** One X message: a user message, or everything the agent answered to it across the runs that continued it (spec §5.2). */
export interface Turn {
	role: 'user' | 'assistant'
	parts: TurnPart[]
	runs: TurnRun[]
	/** The last run's open interrupts (spec §3.3); 2b renders them. */
	interrupts: Interrupt[]
}
export const HUB_RUN_EVENT = 'hub:run'
export interface HubRunValue {
	conversationId: string
	runId: string
	title: string
}
export const emptyAssistantTurn: () => Turn
export const userTurn: (messageId: string, text: string) => Turn
/** The pure reducer the browser runs per event (spec §5.2). */
export const applyAgUiEvent: (turn: Turn, event: BaseEvent) => Turn
export const runOutcomeOf: (status: RunStatus) => RunOutcome
export interface HistoryTurn {
	id: string
	turn: Turn
}
/** The server's grouping of stored rows into turns (spec §3.3; plan call P9). */
export interface TurnMessageRow {
	messageId: string
	runId: string | null
	role: MessageRole
	body: Message
	status: MessageStatus
}
export interface TurnRunRow {
	id: string
	status: RunStatus
	outcome: unknown
	error: { code?: string; message: string } | null
	custom: { name: string; value: unknown }[]
	startedAt: Date
}
/**
 * The server's grouping of stored rows into turns (spec §3.3; plan call P9). A run no row names (an answers run refused
 * before its stream) joins the assistant turn of the latest user message whose run started before it, so its error shows.
 */
export const turnsFromMessages: (
	rows: readonly TurnMessageRow[],
	runs: readonly TurnRunRow[],
) => HistoryTurn[]
export const RUN_CANCELLED_EVENT = 'run_cancelled' // the agent's time limit (spec §2.3)
/** A message's content as text (a string, or the text parts of a content array). */
export const contentText: (content: unknown) => string
/** Text parts joined by a blank line: what Copy copies. */
export const turnText: (turn: Turn) => string
```

`lib/chat/turn.ts` imports nothing from server-only modules: its value sets come from `lib/chat/statuses.ts`, and it declares its own row shapes (`TurnMessageRow`, `TurnRunRow`), which `StoredMessage` and `StoredRun` satisfy.

### Run session and routes (Tasks 10–11)

```ts
// lib/chat/active-runs.ts (Task 10) — server-only; one map per process on globalThis (lib/directory/schedule.ts's guard)
export type StopReason = 'stop' | 'disconnect'
export const activeRuns: {
	register(runId: string, entry: { conversationId: string; controller: AbortController }): void
	/** Aborts the run's upstream request with the reason; false when this process holds no such run. */
	stop(runId: string, conversationId: string, reason: StopReason): boolean
	reasonOf(runId: string): StopReason | undefined
	has(runId: string): boolean
	release(runId: string): void
}

// lib/chat/stream.ts (Task 10) — server-only
export const KEEP_ALIVE_MS = 15_000
export const SSE_HEADERS: Record<string, string> // text/event-stream; no-cache, no-transform; X-Accel-Buffering: no
/** A Route Handler body: write() encodes one event with EventEncoder.encodeSSE; a ": keep-alive" comment after 15 s of silence. */
export const createEventStream: () => {
	stream: ReadableStream<Uint8Array>
	write(event: BaseEvent): void
	close(): void
}

// lib/chat/session.ts (Task 10) — server-only
/** Receives the adapter's reports, persists them (spec §3.2) and forwards the browser's events (spec §4.4). */
export class RunSession implements ChatTurnSink {
	constructor(args: {
		key: RunKey
		appId: string
		title: string
		out: { write(event: BaseEvent): void }
		/** The thread the agent was given (the same array Task 11 hands the adapter): seeds the write memory, so history is never rewritten. */
		history: readonly Message[]
		now?: () => number
	})
	start(): void // writes hub:run
	event(event: BaseEvent): void
	messages(messages: readonly Message[]): void
	state(state: unknown): void
	/** After `finished`: decides the status, closes what is open, writes the end, emits the browser's last events. */
	finish(args: { failed: boolean; stopReason?: StopReason }): Promise<RunEnd>
}
export const SAVE_INTERVAL_MS = 2_000 // spec §3.2 step 2
export const BROKEN_STREAM_TEXT: string // the hub's RUN_ERROR message for plan call P6

// lib/chat/route.ts (Task 11) — server-only
export type ResolvedChatRoute =
	| {
			ok: true
			actor: SessionUser
			app: ProviderAppAccess<ProviderId>
			chat: ChatAdapter<ProviderId>
	  } // chat from chatAdapterOf
	| { ok: false; response: Response }
export const conversationNotFound: () => Response // 404 conversation_not_found
export const resolveChatRoute: (params: Promise<{ appId: string }>) => Promise<ResolvedChatRoute>
export const resolveConversation: (
	actor: SessionUser,
	appId: string,
	conversationId: string,
) => Promise<{ ok: true; conversation: ConversationRecord } | { ok: false; response: Response }>

// lib/chat/schemas.ts (Task 11) — zod (ADR-0025)
export const runBodySchema // spec §4.2's POST runs body (Global Constraints)
export type RunBody = z.infer<typeof runBodySchema>
export const conversationsQuerySchema // { cursor?: string }
export const threadQuerySchema // { before?: positive integer as string }

// lib/chat/answers.ts (Task 11)
export type OpenItems = { interrupts: Interrupt[] } // 2b adds the hub's own pending tool calls
export const openItemsOf: (run: StoredRun | null) => OpenItems
export const checkAnswers: (
	open: OpenItems,
	answers: NonNullable<RunBody['answers']>,
	now?: Date,
) => { ok: true; resume: ResumeEntry[]; toolMessages: Message[] } | { ok: false }

// lib/chat/run.ts (Task 11)
export const runTurn: (args: {
	request: Request
	actor: SessionUser
	app: ProviderAppAccess<ProviderId>
	chat: ChatAdapter<ProviderId>
	body: RunBody
}) => Promise<Response>
/** Spec §3.2 step 5: truncates the conversation's active run when this process does not hold it (the GET route calls it too). */
export const reconcileStaleRun: (conversation: ConversationRecord) => Promise<void>
export const UPSTREAM_MESSAGES: Record<UpstreamErrorCode, string> // the envelopes' English messages (the browser shows its own keys)
```

Routes (Task 11), each `export async function <METHOD>(request: NextRequest, ctx: RouteContext<'…'>)`:

| File | Method | Answers |
| --- | --- | --- |
| `app/api/apps/[appId]/runs/route.ts` | POST | the run's event stream, or an envelope (400/404/409/502/503) |
| `app/api/apps/[appId]/conversations/route.ts` | GET | `{ items: ConversationListItem[], nextCursor }` |
| `app/api/apps/[appId]/conversations/[conversationId]/route.ts` | GET | `{ id, title, state, turns: HistoryTurn[], cursor }` |
| `app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts` | POST | 204 |

### Browser (Tasks 15–16)

```ts
// components/shared-chat/keys.ts
export const conversationKeyFor: (appId: string, conversationId: string) => string // `${appId}:${conversationId}`
export const newTempConversationKey: (appId: string) => string // `${appId}:temp:<uuid>`
export const parseConversationKey: (key: string) => {
	appId: string
	conversationId?: string
	temp: boolean
}

// components/shared-chat/provider/ag-ui-chat-provider.ts
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
	answers?: { resume?: ResumeEntry[]; toolResults?: { toolCallId: string; content: string }[] }
	/** Client-only, never sent: the turn answers continue (2b), kept for a reload's first chunk. */
	continues?: Turn
}
export class AgUiChatProvider extends AbstractChatProvider<Turn, SharedChatInput, SSEOutput> {
	constructor(args: {
		request: XRequestClass<SharedChatInput, SSEOutput, Turn> // XRequest(..., { manual: true, fetch: createHubFetch(appId) })
		getConversationId: () => string | undefined
		onRun: (value: HubRunValue) => void
		onState: (state: unknown) => void
	})
	/** The run the stream on screen belongs to (for Stop), from hub:run. */
	get runId(): string | undefined
}

// components/shared-chat/api.ts — the browser client of Task 11's GET and stop routes; rejects with lib/http/browser's RequestError
export const createSharedChatApi: (appId: string) => {
	listConversations(): Promise<{ items: ConversationListItem[]; nextCursor: string | null }>
	getConversation(
		conversationId: string,
		before?: string,
	): Promise<{
		id: string
		title: string
		state: unknown
		turns: HistoryTurn[]
		cursor: string | null
	}>
	stopRun(conversationId: string, runId: string): Promise<void>
}
```

`ConversationListItem` and `HistoryTurn` are imported into client code with `import type` (from `lib/data/conversations.ts` and `lib/chat/turn.ts`). Task 15 also adds `components/shared-chat/conversations.ts` (the sidebar items: `SharedConversationItem`, `toConversationItem`, `regroup`, `isUnsentTemp`, `mergeConversations`) and `components/shared-chat/hooks/chat-helpers.ts` (`sendDecision`, `toRequestError`, `toMessageInfo`, `fallbackTurn`, `prependLatestTurns`, `openInterruptsOf`); `useSharedConversations` answers `markConversation(key, conversationId, title)`, `getConversationId` and a stable `canRename`.

### Shared pieces of the Dify chat (Task 14) and the e2e fixtures (Task 13)

```ts
// components/chat/message/markdown/link-context.tsx — default: links load as written
export type MarkdownLinkRewrite = (url: string | undefined) => string | undefined
export const MarkdownLinkContext: React.Context<MarkdownLinkRewrite>
export const useMarkdownLink: () => MarkdownLinkRewrite
// components/chat/chat-view/app-info-context.tsx — default null; the hook throws outside a provider
export interface ChatAppInfo {
	id: string
	name: string
	description: string
	hasIcon: boolean
}
export const ChatAppInfoContext: React.Context<ChatAppInfo | null>
export const useChatAppInfo: () => ChatAppInfo
// components/chat/chat-view/conversation-sidebar.tsx
export interface ConversationListItem {
	key: string
	label: string
	group: ConversationGroup
}
// components/chat/chat-view/use-conversation-menu.tsx — both callbacks stable (useCallback)
useConversationMenu({
	rename,
	remove,
	canRename: (key: string) => boolean,
	describeFailure: (error: unknown) => string,
})
// app/(user)/chat/actions.ts (Task 12)
export async function renameConversationAction(
	appId: string,
	conversationId: string,
	title: string,
): Promise<ActionResult>
export async function deleteConversationAction(
	appId: string,
	conversationId: string,
): Promise<ActionResult>

// e2e/fixtures/stub/agui-apps.ts (Task 13), re-exported from e2e/fixtures/constants.ts
export interface StubAguiApp {
	id: string
	name: string
	agent: string
}
export const AGUI_APP: StubAguiApp // { id: 'e2e00000-0000-4000-8000-0000000000a1', name: 'Stub AG-UI agent', agent: 'assistant' }
export const AGUI_MISSING_APP: StubAguiApp // { id: 'e2e00000-0000-4000-8000-0000000000a2', name: 'Stub AG-UI missing', agent: 'missing' }
export const STUB_AGUI_APPS: StubAguiApp[]
export const STUB_AGUI_AGENT = 'assistant'
export const STUB_AGUI_AUDIENCE = 'assistant'
export const aguiAgentUrl: (port: number, agent: string) => string // http://127.0.0.1:<port>/agui/agents/<agent>
// The stub on 5399: POST /agui/agents/<name>; GET /agui/_slow → { closedEarly, words }; GET /agui/_caller → the last
// verified run's { sub, auth_source, roles }. .env.e2e: E2E_AGUI_JWT_SECRET (test-only, 32+ characters).
```

Both new contexts are rendered in React 19's form, `<SomeContext value={…}>` (react.dev `createContext`: `SomeContext.Provider` is the legacy form); the existing `AppContext.Provider` stays as it is.

## Tasks

### Task 1: Dependencies

**Goal:** The hub depends on `@ag-ui/client`, `@ag-ui/core` and `@ag-ui/encoder` 1.0.2 and `jose` 6.2.12 at exact versions, with every gate still green.

Spec §9 names the four packages and their versions; ADR-0033 and ADR-0034 (Task 18) record them. `@ag-ui/client` brings `rxjs` 7.8.1, `fast-json-patch`, `untruncate-json`, `uuid`, `compare-versions` and a second zod (3.25.76, also through `@ag-ui/proto`) beside the hub's zod 4.6.5; `@ag-ui/core` takes zod as an optional peer, which resolves to the hub's zod 4 (its `schemas` entry imports `zod/v4`); `jose` has no dependencies (`npm view jose@6.2.12 dependencies` prints nothing). Nothing imports them yet: Tasks 2, 9, 10 and 13 do. All four were published at least nine days before this plan (`npm view <name> time`: `@ag-ui/*` 1.0.2 on 2026-10-05, `jose` 6.2.12 on 2026-09-05), and none has an install script.

**Files:**

- Modify: `package.json` (four lines in `dependencies`, by pnpm)
- Modify: `pnpm-lock.yaml` (by pnpm)

**Acceptance Criteria:**

- [ ] `package.json` `dependencies` hold `"@ag-ui/client": "1.0.2"`, `"@ag-ui/core": "1.0.2"`, `"@ag-ui/encoder": "1.0.2"` and `"jose": "6.2.12"`, with no `^` or `~`.
- [ ] `pnpm why jose` prints `jose@6.2.12` as a dependency of `ai-app-hub`; `pnpm why @ag-ui/client` prints `@ag-ui/client@1.0.2`.
- [ ] `pnpm why zod` lists `zod@4.6.5` (the hub's) and `zod@3.25.76` (through `@ag-ui/client` and `@ag-ui/proto`), as spec §9 expects.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0 and `pnpm test` reports 0 failed.

**Verify:** `pnpm why jose && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` → `jose@6.2.12`, tsc exit 0, vitest "0 failed"

**Steps:**

- [ ] **Step 1: Branch and Node**

The plan's own PR has merged (Global Constraints). Run:

```bash
cd ~/repos/dify-app-hub
git switch fork/overhaul && git pull --ff-only
git switch -c feat/agui-core
nvm use
```

Expected: `Switched to a new branch 'feat/agui-core'`; `nvm use` prints Node v22.

- [ ] **Step 2: Add the four packages at exact versions**

pnpm's `--save-exact` (`-E`) writes the version without a range ("Saved dependencies will be configured with an exact version rather than using the default semver range operator", `pnpm add --help`). Run:

```bash
pnpm add --save-exact @ag-ui/client@1.0.2 @ag-ui/core@1.0.2 @ag-ui/encoder@1.0.2 jose@6.2.12
```

Expected: pnpm reports `+ @ag-ui/client 1.0.2`, `+ @ag-ui/core 1.0.2`, `+ @ag-ui/encoder 1.0.2`, `+ jose 6.2.12`; no "Ignored build scripts" line for any of them.

- [ ] **Step 3: Read what changed**

Run: `git diff package.json`

Expected: four added lines in `dependencies`, in alphabetical order, each a bare version:

```json
		"@ag-ui/client": "1.0.2",
		"@ag-ui/core": "1.0.2",
		"@ag-ui/encoder": "1.0.2",
```

and, between `"idb-keyval"` and `"ldapts"`:

```json
		"jose": "6.2.12",
```

If pnpm wrote `^1.0.2` or `^6.2.12`, edit the four lines to the bare versions above and run `pnpm install` once.

- [ ] **Step 4: Check the tree**

Run:

```bash
pnpm why jose
pnpm why @ag-ui/client
pnpm why zod
```

Expected: `jose@6.2.12` and `@ag-ui/client@1.0.2` under `ai-app-hub`; `zod` shows two versions, `4.6.5` (the hub's, and the peer of `@ag-ui/core`) and `3.25.76` (dependents `@ag-ui/client`, `@ag-ui/proto`). A third zod version means a range resolved differently: stop and report it.

- [ ] **Step 5: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm test
```

Expected: tsc exits 0; vitest prints "Test Files … passed" with 0 failed. oxlint and oxfmt have no changed source files to check (`package.json` is formatted by pnpm; `pnpm exec oxfmt --check package.json` → "All matched files use the correct format").

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add @ag-ui/client, @ag-ui/core and @ag-ui/encoder 1.0.2 and jose 6.2.12

Part 2 spec §9: the AG-UI client, core types and encoder for the hub's server, and jose for the per-request JWT,
at exact versions. The client brings a second zod (3.25.76) beside the hub's zod 4.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the two files; lint-staged has nothing to run on them.

```json:metadata
{"files": ["package.json", "pnpm-lock.yaml"], "verifyCommand": "pnpm why jose && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test", "acceptanceCriteria": ["package.json dependencies hold \"@ag-ui/client\": \"1.0.2\", \"@ag-ui/core\": \"1.0.2\", \"@ag-ui/encoder\": \"1.0.2\" and \"jose\": \"6.2.12\" with no range operator", "pnpm why jose prints jose@6.2.12 and pnpm why @ag-ui/client prints @ag-ui/client@1.0.2", "pnpm why zod lists zod@4.6.5 and zod@3.25.76 only", "tsc exits 0 and pnpm test reports 0 failed"], "modelTier": "mechanical"}
```

---

### Task 2: Caller, documents and JWT

**Goal:** The session carries the account's source, an AG-UI app has zod documents (`agentUrl`, `audience`; secret `jwtSecret`), the hub can mint the agent contract's HS256 JWT for a caller, and `AGENT_JWT_ISSUER` is read from the environment.

Spec §2.2 (documents), §2.3 (the JWT), plan call P1 (the source from the session: the `jwt` callback already refreshes `token.source` from the row on every request and the `session` callback copies it to `session.user.source`, `lib/auth/options.ts` lines 125–167; next-auth v4 "Callbacks", session callback: "If you want to make something available you added to the token … you have to explicitly forward it here"). jose: `SignJWT` HMAC example and `jwtVerify` (Context7 `/panva/jose`, `docs/jwt/sign/classes/SignJWT.md`, `docs/jwt/verify/functions/jwtVerify.md`; `setIssuedAt`/`setExpirationTime` take Unix seconds, `JWTVerifyOptions.currentDate`, `requiredClaims`, `algorithms`: the 6.2.12 typings in `node_modules/jose/dist/types/types.d.ts`). zod 4: `z.url({ protocol })`, `.trim()`, `.default()` (Context7 `/colinhacks/zod`, as `lib/providers/dify/schema.ts` and `lib/env.ts` use them). Nothing registers AG-UI yet (Task 4).

**Files:**

- Create: `lib/providers/caller.ts`, `lib/providers/agui/schema.ts`, `lib/providers/agui/jwt.ts`
- Create: `__tests__/agui-schema.test.ts`, `__tests__/agui-jwt.test.ts`
- Modify: `lib/auth/account-source.ts` (add `isAccountSource`), `lib/auth/session.ts` (`SessionUser.source`, `verifySession`)
- Modify: `lib/env.ts` (`AGENT_JWT_ISSUER` → `agentJwtIssuer`), `.env.template` (the commented variable)
- Test: `__tests__/auth-session.test.ts`, `__tests__/env.test.ts`
- Modify (fixtures that build a `SessionUser`, `source: 'local'` added by Step 6's script): `__tests__/{account-actions,app-management-actions,auth-page-layouts,branding-actions,data-apps-access,data-apps-reads,data-apps,data-groups,data-settings,data-users-password,data-users-writes,data-users,directory-admin,directory-groups-route,group-layouts,group-management-actions,settings-branding,user-management-actions,user-management-rank}.test.ts`, `__tests__/db/apps.db.test.ts`, `__tests__/db/email.db.test.ts`

**Acceptance Criteria:**

- [ ] `verifySession()` answers `{ id, email, name, role, source }` for a session whose `user.source` is `local` or `ldap`, and `null` for a session without a known source (`auth-session.test.ts` "returns the account’s source, and treats a session without a known source as no session" passes).
- [ ] `aguiSettingsSchema` takes `{ agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }` and refuses a non-http(s) or 501-character URL and an empty or 256-character audience; `aguiSecretsSchema` takes 32–512 characters after trimming; `aguiSecretsUpdateSchema` reads `'   '` as `{ jwtSecret: undefined }` (`agui-schema.test.ts`: 14 passed).
- [ ] `mintAgentToken` signs `{ alg: 'HS256', typ: 'JWT' }` with exactly the claims `sub`, `iat`, `exp` (= `iat` + 60), `iss`, `aud`, `auth_source`, `roles`; `jwtVerify` refuses it 61 s later with `JWTExpired` and with another secret, issuer or audience (`agui-jwt.test.ts`: 5 passed).
- [ ] `parseEnv(base).agentJwtIssuer` is `'nextjs-bff'`; `AGENT_JWT_ISSUER=' hub-prod '` gives `'hub-prod'`; 256 characters fail with `EnvError` keys `['AGENT_JWT_ISSUER']`.
- [ ] `pnpm exec tsc --noEmit` exits 0, `pnpm test` reports 0 failed, and `pnpm test:db` reports 0 failed (two db fixtures changed).

**Verify:** `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/agui-jwt.test.ts __tests__/auth-session.test.ts __tests__/env.test.ts && pnpm exec tsc --noEmit && pnpm test` → 4 files passed, tsc exit 0, vitest 0 failed

**Steps:**

- [ ] **Step 1: Write the failing schema and JWT tests**

Create `__tests__/agui-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	AGUI_DEFAULT_SECRETS,
	AGUI_DEFAULT_SETTINGS,
	aguiSecretsSchema,
	aguiSecretsUpdateSchema,
	aguiSettingsSchema,
} from '@/lib/providers/agui/schema'

const settings = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
const secret = 'k'.repeat(32)

describe("AG-UI's settings (Part 2 spec §2.2)", () => {
	it('reads a valid document and drops keys it does not know', () => {
		expect(aguiSettingsSchema.parse({ ...settings, askUser: true })).toEqual(settings)
	})
	it('takes a Docker service name and an https URL as the agent URL', () => {
		expect(aguiSettingsSchema.safeParse(settings).success).toBe(true)
		expect(
			aguiSettingsSchema.safeParse({ ...settings, agentUrl: 'https://agents.example/agents/a' })
				.success,
		).toBe(true)
	})
	it('trims the audience', () => {
		expect(aguiSettingsSchema.parse({ ...settings, audience: '  assistant ' }).audience).toBe(
			'assistant',
		)
	})
	it.each([
		['an agent URL that is not http(s)', { agentUrl: 'ftp://agents/a' }],
		['an agent URL that is not a URL', { agentUrl: 'agents' }],
		['a 501-character agent URL', { agentUrl: `http://a/${'x'.repeat(492)}` }],
		['an empty audience', { audience: '   ' }],
		['a 256-character audience', { audience: 'a'.repeat(256) }],
	])('refuses %s', (_label, over) => {
		expect(aguiSettingsSchema.safeParse({ ...settings, ...over }).success).toBe(false)
	})
})

describe("AG-UI's secret (spec §2.2; decision 45)", () => {
	it('takes 32 to 512 characters after trimming', () => {
		expect(aguiSecretsSchema.parse({ jwtSecret: ` ${secret} ` })).toEqual({ jwtSecret: secret })
		expect(aguiSecretsSchema.safeParse({ jwtSecret: 'k'.repeat(512) }).success).toBe(true)
	})
	it.each([
		['31 characters', 'k'.repeat(31)],
		['31 characters padded with blanks', ` ${'k'.repeat(31)} `],
		['513 characters', 'k'.repeat(513)],
	])('refuses %s', (_label, jwtSecret) => {
		expect(aguiSecretsSchema.safeParse({ jwtSecret }).success).toBe(false)
	})
	// ADR-0032: a blank secret on Edit keeps the stored one.
	it('reads a blank or missing secret on an edit as not given', () => {
		expect(aguiSecretsUpdateSchema.parse({ jwtSecret: '   ' })).toEqual({ jwtSecret: undefined })
		expect(aguiSecretsUpdateSchema.parse({})).toEqual({ jwtSecret: undefined })
		expect(aguiSecretsUpdateSchema.parse({ jwtSecret: secret })).toEqual({ jwtSecret: secret })
	})
})

describe('the form’s defaults', () => {
	it('start with empty fields, which the schemas refuse until filled', () => {
		expect(AGUI_DEFAULT_SETTINGS).toEqual({ agentUrl: '', audience: '' })
		expect(AGUI_DEFAULT_SECRETS).toEqual({ jwtSecret: '' })
		expect(aguiSettingsSchema.safeParse(AGUI_DEFAULT_SETTINGS).success).toBe(false)
		expect(aguiSecretsSchema.safeParse(AGUI_DEFAULT_SECRETS).success).toBe(false)
	})
})
```

Create `__tests__/agui-jwt.test.ts`. jose's `jwtVerify` with `currentDate` checks `exp` at a fixed time (JWTClaimVerificationOptions `currentDate`, 6.2.12 typings), so the test needs no fake timers:

```ts
import { decodeProtectedHeader, errors, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { AGENT_JWT_LIFETIME_SECONDS, mintAgentToken } from '@/lib/providers/agui/jwt'

const secret = 'an-app-secret-of-at-least-32-chars!'
const key = new TextEncoder().encode(secret)
const now = new Date('2026-10-14T12:00:00Z')
const issuedAt = now.getTime() / 1000
const caller = {
	id: 'b6f1c2d4-0000-4000-8000-000000000001',
	source: 'ldap' as const,
	role: 'user' as const,
}
const mint = () =>
	mintAgentToken({ caller, secret, audience: 'assistant', issuer: 'nextjs-bff', now })

// The checks the owner's agent service runs (decision 45): HS256 with the app's secret, `iss`, `aud`, `exp`, `sub`.
const verify = (token: string, at: Date) =>
	jwtVerify(token, key, {
		algorithms: ['HS256'],
		issuer: 'nextjs-bff',
		audience: 'assistant',
		requiredClaims: ['sub', 'iat', 'exp'],
		currentDate: at,
	})

describe('mintAgentToken (Part 2 spec §2.3)', () => {
	it('signs HS256 with the JWT type in the header', async () => {
		expect(decodeProtectedHeader(await mint())).toEqual({ alg: 'HS256', typ: 'JWT' })
	})
	it('carries exactly the agent contract’s claims, with no name or email', async () => {
		const { payload } = await verify(await mint(), now)
		expect(payload).toEqual({
			sub: caller.id,
			iat: issuedAt,
			exp: issuedAt + 60,
			iss: 'nextjs-bff',
			aud: 'assistant',
			auth_source: 'ldap',
			roles: ['user'],
		})
		expect(AGENT_JWT_LIFETIME_SECONDS).toBe(60)
	})
	it('expires after 60 seconds', async () => {
		const token = await mint()
		await expect(verify(token, new Date(now.getTime() + 59_000))).resolves.toBeDefined()
		await expect(verify(token, new Date(now.getTime() + 61_000))).rejects.toBeInstanceOf(
			errors.JWTExpired,
		)
	})
	it('fails verification with another secret, issuer or audience', async () => {
		const token = await mint()
		await expect(
			jwtVerify(token, new TextEncoder().encode(`${secret}-other`), { currentDate: now }),
		).rejects.toBeInstanceOf(errors.JWSSignatureVerificationFailed)
		await expect(
			jwtVerify(token, key, { issuer: 'someone-else', currentDate: now }),
		).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed)
		await expect(
			jwtVerify(token, key, { audience: 'another-agent', currentDate: now }),
		).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed)
	})
	it('mints a fresh token per call', async () => {
		const later = await mintAgentToken({
			caller,
			secret,
			audience: 'assistant',
			issuer: 'nextjs-bff',
			now: new Date(now.getTime() + 1000),
		})
		expect(later).not.toBe(await mint())
	})
})
```

- [ ] **Step 2: Write the failing env and session tests**

In `__tests__/env.test.ts`, the minimal environment's expectation gains the issuer. Replace:

```ts
			ldap: null,
			branding: { mode: 'disabled', values: null },
		})
	})
```

with:

```ts
			ldap: null,
			branding: { mode: 'disabled', values: null },
			agentJwtIssuer: 'nextjs-bff',
		})
	})
```

and append at the end of the file:

```ts
describe('AGENT_JWT_ISSUER (Part 2 spec §2.3)', () => {
	it('defaults to the agent contract’s issuer when unset or blank', () => {
		expect(parseEnv(base).agentJwtIssuer).toBe('nextjs-bff')
		expect(parseEnv({ ...base, AGENT_JWT_ISSUER: '  ' }).agentJwtIssuer).toBe('nextjs-bff')
	})
	it('takes another issuer, trimmed', () => {
		expect(parseEnv({ ...base, AGENT_JWT_ISSUER: ' hub-prod ' }).agentJwtIssuer).toBe('hub-prod')
	})
	it('refuses an issuer over 255 characters, naming the variable', () => {
		expect(failedKeys({ AGENT_JWT_ISSUER: 'a'.repeat(256) })).toEqual(['AGENT_JWT_ISSUER'])
	})
})
```

In `__tests__/auth-session.test.ts`, make these replacements.

Replace the three session fixtures:

```ts
const live = { user: { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'admin' } }
const member = { user: { id: 'u2', email: 'joe@example.com', name: null, role: 'user' } }
const owner = { user: { id: 'u0', email: 'owner@example.com', name: 'Owner', role: 'owner' } }
```

with:

```ts
const live = {
	user: { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'admin', source: 'local' },
}
const member = {
	user: { id: 'u2', email: 'joe@example.com', name: null, role: 'user', source: 'ldap' },
}
const owner = {
	user: { id: 'u0', email: 'owner@example.com', name: 'Owner', role: 'owner', source: 'local' },
}
```

In 'returns the signed-in account', replace:

```ts
			name: 'Jane',
			role: 'admin',
		})
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
	it('gives null for a name-less account a null name', async () => {
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'admin' },
		})
		await expect(verifySession()).resolves.toEqual({
			id: 'u1',
			email: 'jane@example.com',
			name: null,
			role: 'admin',
		})
```

with:

```ts
			name: 'Jane',
			role: 'admin',
			source: 'local',
		})
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})
	it('gives null for a name-less account a null name', async () => {
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'admin', source: 'local' },
		})
		await expect(verifySession()).resolves.toEqual({
			id: 'u1',
			email: 'jane@example.com',
			name: null,
			role: 'admin',
			source: 'local',
		})
```

In 'treats a session without a known role as no session', replace:

```ts
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'superuser' },
		})
		await expect(verifySession()).resolves.toBeNull()
	})
})
```

with:

```ts
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'superuser', source: 'local' },
		})
		await expect(verifySession()).resolves.toBeNull()
	})
	// Part 2 plan call P1: the source reaches the session through the session callback (lib/auth/options.ts), as the
	// role does; a session without a known one is no session.
	it('returns the account’s source, and treats a session without a known source as no session', async () => {
		getServerSession.mockResolvedValue(member)
		await expect(verifySession()).resolves.toMatchObject({ id: 'u2', source: 'ldap' })
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'admin' },
		})
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'admin', source: 'saml' },
		})
		await expect(verifySession()).resolves.toBeNull()
	})
})
```

Then replace each of the three `assertAdmin({ … })` literals so it carries `source: 'local'`:

```ts
			assertAdmin({ id: 'u0', email: 'owner@example.com', name: null, role: 'owner' }),
```

→

```ts
			assertAdmin({
				id: 'u0',
				email: 'owner@example.com',
				name: null,
				role: 'owner',
				source: 'local',
			}),
```

```ts
			assertAdmin({ id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }),
```

→

```ts
			assertAdmin({
				id: 'u1',
				email: 'jane@example.com',
				name: null,
				role: 'admin',
				source: 'local',
			}),
```

```ts
			assertAdmin({ id: 'u2', email: 'joe@example.com', name: null, role: 'user' }),
```

→

```ts
			assertAdmin({
				id: 'u2',
				email: 'joe@example.com',
				name: null,
				role: 'user',
				source: 'local',
			}),
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/agui-jwt.test.ts __tests__/auth-session.test.ts __tests__/env.test.ts`

Expected: FAIL. The two new files fail to import (`Failed to resolve import "@/lib/providers/agui/schema"` and `…/agui/jwt`); `auth-session.test.ts` fails 'returns the signed-in account' and 'gives null for a name-less account a null name' (no `source` in the answer) and the new case (`source: 'ldap'` missing); `env.test.ts` fails 'parses the minimal environment with no mail' and the three `AGENT_JWT_ISSUER` cases.

- [ ] **Step 4: The caller and the session's source**

Create `lib/providers/caller.ts`:

```ts
import type { AccountSource } from '@/lib/auth/account-source'
import type { Role } from '@/lib/auth/roles'

/**
 * Who a provider call acts for (Part 2 spec §2.3, §2.4): the account's permanent id (ADR-0026), where its identity lives
 * and its role, the three things the AG-UI provider's JWT carries (`sub`, `auth_source`, `roles`). A verified
 * SessionUser has all three, so the actor itself is the caller (plan call P1). Client-safe: types only.
 */
export interface ProviderCaller {
	id: string
	source: AccountSource
	role: Role
}
```

In `lib/auth/account-source.ts`, append (the shape of `isRole` in `lib/auth/roles.ts`):

```ts
export const isAccountSource = (value: unknown): value is AccountSource =>
	typeof value === 'string' && (ACCOUNT_SOURCES as readonly string[]).includes(value)
```

In `lib/auth/session.ts`, replace:

```ts
import { authOptions } from './options'
import { hasAdminRights, isRole, type Role } from './roles'

/** The signed-in account as the server code sees it; `id` is the Dify end-user id (ADR-0026). */
export interface SessionUser {
	id: string
	email: string
	name: string | null
	role: Role
}
```

with:

```ts
import { isAccountSource, type AccountSource } from './account-source'
import { authOptions } from './options'
import { hasAdminRights, isRole, type Role } from './roles'

/**
 * The signed-in account as the server code sees it: `id` is the account's permanent id, the Dify end user and the AG-UI
 * token's `sub` (ADR-0026); `source` is where its identity lives (ADR-0029), the AG-UI token's `auth_source`.
 */
export interface SessionUser {
	id: string
	email: string
	name: string | null
	role: Role
	source: AccountSource
}
```

and replace:

```ts
if (!user?.id || !user.email || !isRole(user.role)) return null
return { id: user.id, email: user.email, name: user.name ?? null, role: user.role }
```

with:

```ts
if (!user?.id || !user.email || !isRole(user.role) || !isAccountSource(user.source)) return null
return {
	id: user.id,
	email: user.email,
	name: user.name ?? null,
	role: user.role,
	source: user.source,
}
```

Also extend the comment above `verifySession` from "…or a session without a known role (lib/auth/roles.ts isRole)." to "…or a session without a known role (lib/auth/roles.ts isRole) or source (lib/auth/account-source.ts isAccountSource)."

- [ ] **Step 5: The documents, the JWT and the issuer**

Create `lib/providers/agui/schema.ts`:

```ts
import * as z from 'zod'

/*
 * AG-UI's documents (Part 2 spec §2.2): the settings an app row holds for an AG-UI agent, and its secret, kept apart as
 * Dify's are (decision 8). zod parses both on every write and every read (ADR-0025, ADR-0032). Client-safe on purpose:
 * the admin form validates with the same schemas. `z.object` drops keys it does not know (zod 4 "Objects": unknown keys
 * are stripped by default), so a document 2b or 2c writes with more fields still reads here, and the fields those
 * slices add carry zod defaults (zod 4 `.default()`), so a document written now reads there.
 */

/**
 * The full endpoint the hub POSTs a run to, e.g. `http://agents:8000/agents/assistant`: an http(s) URL of at most 500
 * characters, the rule of Dify's `apiBase` (zod 4 `z.url({ protocol })` checks the scheme only, so a Docker service name
 * passes).
 */
export const agentUrlSchema = z.url({ protocol: /^https?$/ }).max(500)

export const aguiSettingsSchema = z.object({
	agentUrl: agentUrlSchema,
	/** The JWT's `aud`; it must match the agent's AGENT_JWT_AUDIENCE (spec §2.3). */
	audience: z.string().trim().min(1).max(255),
})

export type AguiSettings = z.infer<typeof aguiSettingsSchema>

/**
 * The key the hub signs each request's JWT with, shared with the agent (decision 45: at least 32 random bytes, e.g.
 * `openssl rand -base64 48`, which prints 64 characters). 32–512 characters after trimming, used as their UTF-8 bytes.
 */
export const aguiSecretsSchema = z.object({ jwtSecret: z.string().trim().min(32).max(512) })

export type AguiSecrets = z.infer<typeof aguiSecretsSchema>

/** The secret as an edit sends it (ADR-0032): blank or missing reads as "not given", which keeps the stored one. */
export const aguiSecretsUpdateSchema = z.object({
	jwtSecret: z
		.string()
		.trim()
		.max(512)
		.optional()
		.transform(value => value || undefined),
})

/** What the form starts a new AG-UI app from: both fields empty, for the admin to fill. */
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
}

/** The form's secret field, blank: a new app's secret is typed, an edit's blank secret keeps the stored one. */
export const AGUI_DEFAULT_SECRETS: Record<keyof AguiSecrets, string> = { jwtSecret: '' }
```

Create `lib/providers/agui/jwt.ts`:

```ts
import 'server-only'

import { SignJWT } from 'jose'

import type { ProviderCaller } from '../caller'

/** Spec §2.3: a token lives 60 s; the agent allows 10 s of clock skew. */
export const AGENT_JWT_LIFETIME_SECONDS = 60

/**
 * The one auth header's token for an upstream AG-UI request (spec §2.3; decision 45), minted fresh for every request:
 * each run and each Test connection. jose's `SignJWT` HMAC example (README and docs/jwt/sign/classes/SignJWT.md: the
 * secret as `new TextEncoder().encode(…)`, `alg: 'HS256'`); `setIssuedAt` and `setExpirationTime` take Unix seconds
 * (jose's ProduceJWT typings), so `now` fixes both for a test. The claims are the agent contract's: `sub` the account's
 * permanent id (ADR-0026), `auth_source`, `roles`, `iss` and `aud`; no name or email (minimal disclosure, AGENTS.md).
 */
export const mintAgentToken = ({
	caller,
	secret,
	audience,
	issuer,
	now = new Date(),
}: {
	caller: ProviderCaller
	secret: string
	audience: string
	issuer: string
	now?: Date
}): Promise<string> => {
	const issuedAt = Math.floor(now.getTime() / 1000)
	return new SignJWT({ auth_source: caller.source, roles: [caller.role] })
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject(caller.id)
		.setIssuer(issuer)
		.setAudience(audience)
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + AGENT_JWT_LIFETIME_SECONDS)
		.sign(new TextEncoder().encode(secret))
}
```

In `lib/env.ts`, after `blankAsAbsent` (the block ending `inner,\n\t)`) and before the comment `/** Read leniently like \`flag\` above …`, insert:

```ts
/**
 * The AG-UI provider's JWT issuer (Part 2 spec §2.3): the `iss` of every token the hub signs for an agent, which must match
 * the agent service's AGENT_JWT_ISSUER. Blank counts as absent, so the agent contract's default applies.
 */
const agentSchema = z.object({
	AGENT_JWT_ISSUER: blankAsAbsent(z.string().trim().min(1).max(255).default('nextjs-bff')),
})
```

In `interface ServerEnv`, replace:

```ts
	branding: BrandingEnv
}

export class EnvError
```

with:

```ts
	branding: BrandingEnv
	/** AGENT_JWT_ISSUER: the `iss` of the AG-UI provider's tokens (Part 2 spec §2.3). */
	agentJwtIssuer: string
}

export class EnvError
```

In `parseEnv`, replace:

```ts
	} else branding = { mode: brandingMode.data, values: null }
	return {
```

with:

```ts
	} else branding = { mode: brandingMode.data, values: null }
	const agent = agentSchema.safeParse(source)
	if (!agent.success) throw new EnvError(keysOf(agent.error))
	return {
```

and replace the end of its return value:

```ts
		branding,
	}
}
```

with:

```ts
		branding,
		agentJwtIssuer: agent.data.AGENT_JWT_ISSUER,
	}
}
```

In `.env.template`, after the `NEXTAUTH_SECRET=xxx` line and its blank line, insert (the compose files pass `.env` whole through `env_file`, so no compose file names the variable):

```
# AG-UI agents (Part 2, docs/agui-agents.md): the `iss` of the token the hub signs for every agent request; it must
# match each agent's AGENT_JWT_ISSUER. Unset or blank: nextjs-bff.
# AGENT_JWT_ISSUER=nextjs-bff

```

- [ ] **Step 6: Give every SessionUser fixture its source**

Run `pnpm exec next typegen && pnpm exec tsc --noEmit`. Expected: about 115 errors `TS2345: Argument of type '{ id: string; email: string; name: null; role: "…"; }' is not assignable to parameter of type 'SessionUser'` in 12 test files (the fixtures passed to the data layer), and 0 errors outside `__tests__/`. The unit suite would also fail in 9 more files whose session mocks lack `source` (verifySession now answers null for them). Both are fixed by adding `source: 'local'` to every one-line literal of the shape `{ id: …, email: …, [name: …,] role: 'owner' | 'admin' | 'user' [as const] }` and to the three multi-line db fixtures. Run this script from the repository root (it was dry-run while planning: tsc then reports 0 errors and `pnpm test` 0 failed):

```bash
python3 - <<'PY'
import re
# Part 2 plan call P1: every SessionUser the unit and db tests build gains `source: 'local'`.
FILES = '''account-actions app-management-actions auth-page-layouts branding-actions data-apps-access
data-apps-reads data-apps data-groups data-settings data-users-password data-users-writes data-users
directory-admin directory-groups-route group-layouts group-management-actions settings-branding
user-management-actions user-management-rank'''.split()
ONE_LINE = re.compile(r"(\{ id: [^{}\n]*?email: [^{}\n]*?role: '(?:owner|admin|user)')( as const)?( \})")
def one_line(match):
	if 'source' in match.group(0):
		return match.group(0)
	const = match.group(2) or ''
	return f"{match.group(1)}{const}, source: 'local'{const}{match.group(3)}"
for name in FILES:
	path = f'__tests__/{name}.test.ts'
	text = open(path).read()
	text, count = ONE_LINE.subn(one_line, text)
	open(path, 'w').write(text)
	print(path, count)
MULTI = [
	('__tests__/db/email.db.test.ts', "\tname: null,\n\trole: 'owner' as const,\n}"),
	('__tests__/db/apps.db.test.ts', "\tname: null,\n\trole: 'owner' as const,\n}"),
	('__tests__/db/apps.db.test.ts', "\tname: null,\n\trole: 'user' as const,\n}"),
]
for path, old in MULTI:
	text = open(path).read()
	assert text.count(old) == 1, (path, old)
	text = text.replace(old, old[:-1] + "\tsource: 'local' as const,\n}")
	open(path, 'w').write(text)
	print(path, 1)
PY
pnpm exec oxfmt __tests__/*.test.ts __tests__/db/*.db.test.ts
```

Expected counts: account-actions 1, app-management-actions 1, auth-page-layouts 1, branding-actions 1, data-apps-access 3, data-apps-reads 2, data-apps 1, data-groups 1, data-settings 2, data-users-password 1, data-users-writes 1, data-users 10, directory-admin 1, directory-groups-route 4, group-layouts 3, group-management-actions 2, settings-branding 1, user-management-actions 1, user-management-rank 2, then `email.db.test.ts 1`, `apps.db.test.ts 1` twice. Every changed literal is an actor or a session user (`git diff --stat __tests__` lists exactly the files in **Files**); `directory-groups-route.test.ts`'s `toHaveBeenCalledWith({ … })` now expects the verified actor with its source, which is what the route passes.

- [ ] **Step 7: Run the tests to see them pass**

Run:

```bash
pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/agui-jwt.test.ts __tests__/auth-session.test.ts __tests__/env.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm test
```

Expected: the four files pass (agui-schema 14, agui-jwt 5, auth-session 16, env 39); tsc exits 0; `pnpm test` reports 0 failed.

- [ ] **Step 8: Gates**

Run:

```bash
pnpm exec oxlint lib/providers/caller.ts lib/providers/agui lib/auth lib/env.ts __tests__
pnpm exec oxfmt --check lib/providers/caller.ts lib/providers/agui lib/auth lib/env.ts __tests__
pnpm test:db
```

Expected: oxlint 0 warnings and 0 errors; oxfmt "All matched files use the correct format"; `pnpm test:db` 0 failed (its two fixtures now carry a source).

- [ ] **Step 9: Commit**

```bash
git add lib/providers/caller.ts lib/providers/agui/schema.ts lib/providers/agui/jwt.ts lib/auth/account-source.ts lib/auth/session.ts lib/env.ts .env.template __tests__/agui-schema.test.ts __tests__/agui-jwt.test.ts __tests__/auth-session.test.ts __tests__/env.test.ts __tests__/account-actions.test.ts __tests__/app-management-actions.test.ts __tests__/auth-page-layouts.test.ts __tests__/branding-actions.test.ts __tests__/data-apps-access.test.ts __tests__/data-apps-reads.test.ts __tests__/data-apps.test.ts __tests__/data-groups.test.ts __tests__/data-settings.test.ts __tests__/data-users-password.test.ts __tests__/data-users-writes.test.ts __tests__/data-users.test.ts __tests__/directory-admin.test.ts __tests__/directory-groups-route.test.ts __tests__/group-layouts.test.ts __tests__/group-management-actions.test.ts __tests__/settings-branding.test.ts __tests__/user-management-actions.test.ts __tests__/user-management-rank.test.ts __tests__/db/apps.db.test.ts __tests__/db/email.db.test.ts
git commit -m "feat(providers): add AG-UI's documents, the agent JWT and the session's account source

Part 2 spec §2.2 and §2.3: zod documents for an AG-UI app (agentUrl, audience; secret jwtSecret), the HS256 token
the hub mints per upstream request with jose (sub, iat, exp +60 s, iss AGENT_JWT_ISSUER, aud, auth_source, roles),
and SessionUser.source read from the session, as the role is (plan call P1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/providers/caller.ts", "lib/providers/agui/schema.ts", "lib/providers/agui/jwt.ts", "lib/auth/account-source.ts", "lib/auth/session.ts", "lib/env.ts", ".env.template", "__tests__/agui-schema.test.ts", "__tests__/agui-jwt.test.ts", "__tests__/auth-session.test.ts", "__tests__/env.test.ts", "__tests__/account-actions.test.ts", "__tests__/app-management-actions.test.ts", "__tests__/auth-page-layouts.test.ts", "__tests__/branding-actions.test.ts", "__tests__/data-apps-access.test.ts", "__tests__/data-apps-reads.test.ts", "__tests__/data-apps.test.ts", "__tests__/data-groups.test.ts", "__tests__/data-settings.test.ts", "__tests__/data-users-password.test.ts", "__tests__/data-users-writes.test.ts", "__tests__/data-users.test.ts", "__tests__/directory-admin.test.ts", "__tests__/directory-groups-route.test.ts", "__tests__/group-layouts.test.ts", "__tests__/group-management-actions.test.ts", "__tests__/settings-branding.test.ts", "__tests__/user-management-actions.test.ts", "__tests__/user-management-rank.test.ts", "__tests__/db/apps.db.test.ts", "__tests__/db/email.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/agui-jwt.test.ts __tests__/auth-session.test.ts __tests__/env.test.ts && pnpm exec tsc --noEmit && pnpm test", "acceptanceCriteria": ["verifySession() answers source for a session whose user.source is local or ldap, and null without a known source", "aguiSettingsSchema, aguiSecretsSchema and aguiSecretsUpdateSchema pass agui-schema.test.ts (14 passed)", "mintAgentToken signs HS256 {alg, typ: JWT} with sub, iat, exp = iat + 60, iss, aud, auth_source, roles only; jwtVerify refuses it after 61 s and with another secret, issuer or audience (agui-jwt.test.ts 5 passed)", "parseEnv(base).agentJwtIssuer is nextjs-bff; a 256-character AGENT_JWT_ISSUER fails with EnvError keys [AGENT_JWT_ISSUER]", "tsc exits 0, pnpm test and pnpm test:db report 0 failed"], "modelTier": "standard"}
```

---

### Task 3: Test connection for an AG-UI agent

**Goal:** `testAguiConnection` reaches an agent the way spec §2.4 sets out, and the admin action and the drawer's outcome know its two new results (`agent_not_found`, warning `ran_on_invalid_input`).

The probe is the hub's own convention, derived from the AG-UI spec's error rule (refused input is "an HTTP error status with no event stream", spec 1.0 HTTP + SSE "Errors"; no binding carries a capabilities exchange, spec 1.0 "Capabilities"): `part2-proxy-stop-identity.md` §5 and implication D, recorded in ADR-0034 (Task 18). MDN `AbortSignal.timeout()` bounds it at 10 s, as Dify's test (`lib/providers/dify/test-connection.ts`); MDN `ReadableStream.cancel()` lets every answer's body go unread. The connection result type changes here, so the action's mapping (`TEST_FAILURES`, the outcome) and `connectionOutcome` change in the same commit to keep tsc green; the action reaches the AG-UI test once Task 4 registers the provider.

**Files:**

- Create: `lib/providers/agui/test-connection.ts`, `__tests__/agui-test-connection.test.ts`
- Modify: `lib/providers/connection.ts`, `lib/action-result.ts` (`provider_agent_not_found`), `app/(admin)/app-management/actions.ts` (`ConnectionTestOutcome`, `TEST_FAILURES`, `testOutcome`), `components/admin/apps/connection-outcome.ts`
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (four `connection_test.*` keys)
- Test: `__tests__/connection-outcome.test.ts`

**Acceptance Criteria:**

- [ ] The test POSTs `'{}'` to `settings.agentUrl` with exactly the headers `Content-Type: application/json`, `Accept: text/event-stream` and `Authorization: Bearer <JWT>`, the JWT verifying with the app's secret, `iss` `nextjs-bff`, `aud` the audience and `sub` the admin's id, and an `AbortSignal`.
- [ ] Answers map as spec §2.4: 422 and 400 → `{ ok: true }`; 401, 403 → `key_refused`; 404 → `agent_not_found`; 415, 409 → `upstream_error`; 500, 503, a rejected fetch and a `TimeoutError` → `unreachable`; a 2xx `text/event-stream` → `{ ok: true, warning: { code: 'ran_on_invalid_input' } }`; a 2xx JSON → `upstream_error`; every body is cancelled unread (`agui-test-connection.test.ts`: 14 passed).
- [ ] `connectionOutcome` shows `connection_test.ran_on_invalid_input_*` as a warning and `connection_test.agent_not_found_*` as an error for `provider_agent_not_found`.
- [ ] The four new keys exist in en, zh and ar (`__tests__/i18n-locales.test.ts` passes); tsc exits 0; `pnpm test` 0 failed.

**Verify:** `pnpm exec vitest run --project unit __tests__/agui-test-connection.test.ts __tests__/connection-outcome.test.ts __tests__/app-management-actions.test.ts __tests__/i18n-locales.test.ts` → 4 files passed

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/agui-test-connection.test.ts`. `lib/env.ts` is mocked to the issuer's default (the test reads no environment); `fetch` is stubbed with Vitest's `vi.stubGlobal`, as `__tests__/app-management-actions.test.ts` does; each answer's body is a `ReadableStream` whose `cancel` is a spy, so the test sees it let go unread:

```ts
import { jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))

import { AGUI_TEST_TIMEOUT_MS, testAguiConnection } from '@/lib/providers/agui/test-connection'

const settings = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
const secrets = { jwtSecret: 'an-app-secret-of-at-least-32-chars!' }
const admin = {
	id: 'b6f1c2d4-0000-4000-8000-000000000002',
	source: 'local' as const,
	role: 'admin' as const,
}

/** A body whose cancel is recorded, so a test can see the agent's answer was let go unread (spec §2.4). */
const answer = (status: number, contentType = 'application/json') => {
	const cancel = vi.fn()
	const body = new ReadableStream({ cancel })
	return {
		response: new Response(body, { status, headers: { 'content-type': contentType } }),
		cancel,
	}
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
})

const sent = () => fetchMock.mock.calls[0] as [string, RequestInit]

describe('testAguiConnection (Part 2 spec §2.4)', () => {
	it('POSTs {} to the agent URL with a fresh JWT for the admin as the only auth header', async () => {
		fetchMock.mockResolvedValue(answer(422).response)
		await testAguiConnection(settings, secrets, admin)
		const [url, init] = sent()
		expect(url).toBe(settings.agentUrl)
		expect(init.method).toBe('POST')
		expect(init.body).toBe('{}')
		expect(init.signal).toBeInstanceOf(AbortSignal)
		const headers = init.headers as Record<string, string>
		expect(Object.keys(headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type'])
		expect(headers['Content-Type']).toBe('application/json')
		expect(headers.Accept).toBe('text/event-stream')
		const token = headers.Authorization.replace(/^Bearer /, '')
		const { payload } = await jwtVerify(token, new TextEncoder().encode(secrets.jwtSecret), {
			algorithms: ['HS256'],
			issuer: 'nextjs-bff',
			audience: 'assistant',
		})
		expect(payload).toMatchObject({ sub: admin.id, auth_source: 'local', roles: ['admin'] })
		expect(AGUI_TEST_TIMEOUT_MS).toBe(10_000)
	})
	it.each([
		[422, { ok: true }],
		[400, { ok: true }],
		[401, { ok: false, code: 'key_refused' }],
		[403, { ok: false, code: 'key_refused' }],
		[404, { ok: false, code: 'agent_not_found' }],
		[415, { ok: false, code: 'upstream_error' }],
		[409, { ok: false, code: 'upstream_error' }],
		[500, { ok: false, code: 'unreachable' }],
		[503, { ok: false, code: 'unreachable' }],
	])('answers %i as %o and lets the body go unread', async (status, result) => {
		const { response, cancel } = answer(status)
		fetchMock.mockResolvedValue(response)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual(result)
		expect(cancel).toHaveBeenCalled()
	})
	it('cancels a 2xx event stream at once and warns that the agent ran on invalid input', async () => {
		const { response, cancel } = answer(200, 'text/event-stream; charset=utf-8')
		fetchMock.mockResolvedValue(response)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual({
			ok: true,
			warning: { code: 'ran_on_invalid_input' },
		})
		expect(cancel).toHaveBeenCalled()
	})
	it('answers a 2xx that is not an event stream as an upstream error', async () => {
		fetchMock.mockResolvedValue(answer(200).response)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual({
			ok: false,
			code: 'upstream_error',
		})
	})
	it.each([
		['a refused connection', new TypeError('fetch failed')],
		['the timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
	])('answers %s as unreachable', async (_label, error) => {
		fetchMock.mockRejectedValue(error)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual({
			ok: false,
			code: 'unreachable',
		})
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/agui-test-connection.test.ts`

Expected: FAIL, `Failed to resolve import "@/lib/providers/agui/test-connection"`.

- [ ] **Step 3: Widen the connection result**

Replace the whole of `lib/providers/connection.ts` with:

```ts
/**
 * What a provider's connection test found (Part 1 spec §4.2; decision 18): reachable, reachable with a warning, or why
 * it failed. Every provider's `testConnection` answers this shape (lib/providers/registry.ts); a test copies and saves
 * nothing. Part 2 spec §2.4 adds AG-UI's two: an agent the URL does not name (`agent_not_found`), and an agent that
 * started a run on input it should have refused (`ran_on_invalid_input`, still reachable).
 */
export type ConnectionTestResult =
	| {
			ok: true
			warning?: { code: 'type_mismatch'; reported: string } | { code: 'ran_on_invalid_input' }
	  }
	| { ok: false; code: 'key_refused' | 'unreachable' | 'upstream_error' | 'agent_not_found' }
```

- [ ] **Step 4: Write the test connection**

Create `lib/providers/agui/test-connection.ts`:

```ts
import 'server-only'

import { env } from '@/lib/env'

import type { ProviderCaller } from '../caller'
import type { ConnectionTestResult } from '../connection'
import { mintAgentToken } from './jwt'
import type { AguiSecrets, AguiSettings } from './schema'

/** Spec §2.4: an agent that never answers is unreachable after 10 s, as Dify's test (Part 1 Plan decision f). */
export const AGUI_TEST_TIMEOUT_MS = 10_000

/**
 * Lets a body go unread: MDN `ReadableStream.cancel()`, "used when you've completely finished with the stream and don't
 * need any more data from it", which also releases the connection. The agent's text is never read, logged or echoed
 * (spec §2.4). A body already gone is no failure.
 */
const discard = async (response: Response): Promise<void> => {
	await response.body?.cancel().catch(() => undefined)
}

const isEventStream = (response: Response): boolean =>
	(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')

/**
 * Test connection for an AG-UI agent (spec §2.4): POST `{}` (valid JSON, an invalid `RunAgentInput`) to the agent URL
 * with a fresh JWT whose `sub` is the admin running the test. AG-UI defines no health route or capability exchange
 * ("No transport binding in this version carries a capabilities exchange", spec 1.0 Capabilities), and refused input
 * is "an HTTP error status with no event stream" (spec 1.0 HTTP + SSE, Errors), so a conforming agent refuses this
 * body before any run starts and no model is called: the hub's own convention, derived from that rule (ADR-0034).
 * 422 or 400 is reachable (the token passed, the body was refused); 401 or 403 a refused key; 404 an unknown agent;
 * 415 or another 4xx an upstream error; a refused connection, the timeout (MDN `AbortSignal.timeout()`) or a 5xx
 * unreachable; a 2xx event stream means the agent ran on invalid input: the body is cancelled at once and the test
 * warns. Docs silent on what a 2xx that is not a stream means: it is not an AG-UI answer, so an upstream error.
 */
export const testAguiConnection = async (
	settings: AguiSettings,
	secrets: AguiSecrets,
	caller: ProviderCaller,
): Promise<ConnectionTestResult> => {
	const token = await mintAgentToken({
		caller,
		secret: secrets.jwtSecret,
		audience: settings.audience,
		issuer: env().agentJwtIssuer,
	})
	let response: Response
	try {
		response = await fetch(settings.agentUrl, {
			method: 'POST',
			// Spec §2.3: exactly one auth header, the JWT; nothing from the browser.
			headers: {
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				Authorization: `Bearer ${token}`,
			},
			body: '{}',
			signal: AbortSignal.timeout(AGUI_TEST_TIMEOUT_MS),
		})
	} catch {
		// fetch rejects for a refused connection, a host that does not resolve, and the timeout ("TimeoutError").
		return { ok: false, code: 'unreachable' }
	}
	const { status } = response
	const stream = isEventStream(response)
	await discard(response)
	if (status >= 200 && status < 300)
		return stream
			? { ok: true, warning: { code: 'ran_on_invalid_input' } }
			: { ok: false, code: 'upstream_error' }
	if (status === 400 || status === 422) return { ok: true }
	if (status === 401 || status === 403) return { ok: false, code: 'key_refused' }
	if (status === 404) return { ok: false, code: 'agent_not_found' }
	if (status >= 500) return { ok: false, code: 'unreachable' }
	return { ok: false, code: 'upstream_error' }
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/agui-test-connection.test.ts`

Expected: PASS, 14 tests.

- [ ] **Step 6: The action's codes and outcome**

`pnpm exec tsc --noEmit` now fails in `app/(admin)/app-management/actions.ts` (`result.warning.reported` on the widened warning; `TEST_FAILURES[result.code]` has no `agent_not_found`). In `lib/action-result.ts`, replace:

```ts
	| 'provider_key_refused'
```

with:

```ts
	| 'provider_key_refused'
	| 'provider_agent_not_found'
```

In `app/(admin)/app-management/actions.ts`, add the type import after `import { isId } from '@/lib/ids'`:

```ts
import type { ConnectionTestResult } from '@/lib/providers/connection'
```

replace:

```ts
/** What a test that reached the provider found (spec §4.2): reachable, or reachable while the provider reports another type. */
export type ConnectionTestOutcome =
	| { outcome: 'reachable' }
	| { outcome: 'type_mismatch'; reported: string }

/** Plan decision g: the test's failures have codes of their own. */
const TEST_FAILURES = {
	key_refused: 'provider_key_refused',
	unreachable: 'provider_unreachable',
	upstream_error: 'provider_error',
} as const
```

with:

```ts
/**
 * What a test that reached the provider found (spec §4.2): reachable, reachable while the provider reports another type,
 * or reachable while an AG-UI agent started a run on input it should have refused (Part 2 spec §2.4).
 */
export type ConnectionTestOutcome =
	| { outcome: 'reachable' }
	| { outcome: 'type_mismatch'; reported: string }
	| { outcome: 'ran_on_invalid_input' }

/** Plan decision g: the test's failures have codes of their own (Part 2 spec §2.4 adds an agent the URL does not name). */
const TEST_FAILURES = {
	key_refused: 'provider_key_refused',
	unreachable: 'provider_unreachable',
	upstream_error: 'provider_error',
	agent_not_found: 'provider_agent_not_found',
} as const

/** The test's warning, if any, as the drawer reads it. */
const testOutcome = (
	warning: Extract<ConnectionTestResult, { ok: true }>['warning'],
): ConnectionTestOutcome => {
	if (warning?.code === 'type_mismatch')
		return { outcome: 'type_mismatch', reported: warning.reported }
	if (warning?.code === 'ran_on_invalid_input') return { outcome: 'ran_on_invalid_input' }
	return { outcome: 'reachable' }
}
```

and in `testAppConnectionAction` replace:

```ts
if (!result.ok) return fail(TEST_FAILURES[result.code])
return ok(
	result.warning
		? { outcome: 'type_mismatch', reported: result.warning.reported }
		: { outcome: 'reachable' },
)
```

with:

```ts
if (!result.ok) return fail(TEST_FAILURES[result.code])
return ok(testOutcome(result.warning))
```

(`testOutcome` is not exported: a `'use server'` file exports only async functions and types.)

- [ ] **Step 7: The drawer's words, with a failing test first**

In `__tests__/connection-outcome.test.ts`, before `it('names a type the client does not know as the provider wrote it', () => {` insert:

```ts
// Part 2 spec §2.4: an AG-UI agent that ran on the test's invalid input is reachable, with a warning.
it('is a warning when the agent ran on the test request', () => {
	expect(
		connectionOutcome(t, 'dify', { ok: true, data: { outcome: 'ran_on_invalid_input' } }),
	).toEqual({
		type: 'warning',
		title: 'connection_test.ran_on_invalid_input_title',
		description: 'connection_test.ran_on_invalid_input_description',
	})
})
```

and in the `it.each` of error codes replace:

```ts
		['provider_error', 'upstream_error'],
	] as const)
```

with:

```ts
		['provider_error', 'upstream_error'],
		['provider_agent_not_found', 'agent_not_found'],
	] as const)
```

Run: `pnpm exec vitest run --project unit __tests__/connection-outcome.test.ts` — Expected: FAIL on the two new cases (the generic `type_mismatch` warning and `connection_test.failed_title`).

In `components/admin/apps/connection-outcome.ts`, after the `reachable` branch replace:

```ts
				description: t('connection_test.reachable_description'),
			}
		return {
```

with:

```ts
				description: t('connection_test.reachable_description'),
			}
		if (result.data.outcome === 'ran_on_invalid_input')
			return {
				type: 'warning',
				title: t('connection_test.ran_on_invalid_input_title'),
				description: t('connection_test.ran_on_invalid_input_description'),
			}
		return {
```

and after the `provider_error` case replace:

```ts
				title: t('connection_test.upstream_error_title'),
				description: t('connection_test.upstream_error_description'),
			}
```

with:

```ts
				title: t('connection_test.upstream_error_title'),
				description: t('connection_test.upstream_error_description'),
			}
		case 'provider_agent_not_found':
			return {
				type: 'error',
				title: t('connection_test.agent_not_found_title'),
				description: t('connection_test.agent_not_found_description'),
			}
```

- [ ] **Step 8: The four keys in three languages**

`connection_test` is the last object of each locale file. In `locales/en/translation.json` replace `"failed_title": "The test did not run"` with:

```json
"failed_title": "The test did not run",
		"agent_not_found_title": "The agent was not found",
		"agent_not_found_description": "The service answered, but no agent lives at this URL. Check the path, e.g. /agents/<name>.",
		"ran_on_invalid_input_title": "Connected, but the agent ran on a test request",
		"ran_on_invalid_input_description": "The agent started a run for a request it should have refused. It can be used, but tell its author: an AG-UI agent refuses invalid input with an HTTP error."
```

In `locales/zh/translation.json` replace `"failed_title": "测试未运行"` with:

```json
"failed_title": "测试未运行",
		"agent_not_found_title": "未找到智能体",
		"agent_not_found_description": "服务已响应，但此地址下没有智能体。请检查路径，例如 /agents/<name>。",
		"ran_on_invalid_input_title": "已连接，但智能体对测试请求启动了运行",
		"ran_on_invalid_input_description": "智能体对一个本应拒绝的请求启动了运行。它可以使用，但请告知其作者：AG-UI 智能体应以 HTTP 错误拒绝无效输入。"
```

In `locales/ar/translation.json` replace `"failed_title": "لم يُنفَّذ الاختبار"` with:

```json
"failed_title": "لم يُنفَّذ الاختبار",
		"agent_not_found_title": "لم يُعثر على الوكيل",
		"agent_not_found_description": "استجابت الخدمة، لكن لا يوجد وكيل على هذا العنوان. تحقّق من المسار، مثل /agents/<name>.",
		"ran_on_invalid_input_title": "تم الاتصال، لكن الوكيل بدأ تشغيلًا لطلب الاختبار",
		"ran_on_invalid_input_description": "بدأ الوكيل تشغيلًا لطلب كان ينبغي أن يرفضه. يمكن استخدامه، لكن أبلغ مطوّره: يرفض وكيل AG-UI المدخلات غير الصالحة برمز خطأ HTTP."
```

The zh and ar wording joins the owner's review list (Task 18).

- [ ] **Step 9: Run the tests and the gates**

Run:

```bash
pnpm exec vitest run --project unit __tests__/agui-test-connection.test.ts __tests__/connection-outcome.test.ts __tests__/app-management-actions.test.ts __tests__/i18n-locales.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/providers lib/action-result.ts "app/(admin)/app-management/actions.ts" components/admin/apps/connection-outcome.ts __tests__/agui-test-connection.test.ts __tests__/connection-outcome.test.ts
pnpm exec oxfmt --check lib/providers lib/action-result.ts "app/(admin)/app-management/actions.ts" components/admin/apps/connection-outcome.ts __tests__/agui-test-connection.test.ts __tests__/connection-outcome.test.ts locales
pnpm test
```

Expected: the four files pass (agui-test-connection 14, connection-outcome 9); tsc exit 0; oxlint 0 findings; oxfmt clean; `pnpm test` 0 failed.

- [ ] **Step 10: Commit**

```bash
git add lib/providers/connection.ts lib/providers/agui/test-connection.ts lib/action-result.ts "app/(admin)/app-management/actions.ts" components/admin/apps/connection-outcome.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/agui-test-connection.test.ts __tests__/connection-outcome.test.ts
git commit -m "feat(providers): test an AG-UI agent with a refused run input

Part 2 spec §2.4: POST {} with a fresh JWT for the admin; 422/400 reachable, 401/403 key refused, 404 agent not
found, other 4xx upstream error, no answer or 5xx unreachable, a 2xx stream cancelled and warned. Bodies are let go
unread. The action and the drawer learn the two new results.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/providers/connection.ts", "lib/providers/agui/test-connection.ts", "lib/action-result.ts", "app/(admin)/app-management/actions.ts", "components/admin/apps/connection-outcome.ts", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/agui-test-connection.test.ts", "__tests__/connection-outcome.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/agui-test-connection.test.ts __tests__/connection-outcome.test.ts __tests__/app-management-actions.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["POSTs '{}' to agentUrl with exactly Content-Type, Accept: text/event-stream and Authorization: Bearer <JWT> whose sub is the admin, and an AbortSignal", "422/400 ok; 401/403 key_refused; 404 agent_not_found; 415/409 upstream_error; 5xx, a rejected fetch and TimeoutError unreachable; 2xx event stream ok with warning ran_on_invalid_input; 2xx JSON upstream_error; every body cancelled (agui-test-connection.test.ts 14 passed)", "connectionOutcome shows ran_on_invalid_input as a warning and provider_agent_not_found as an error with their connection_test keys", "the four keys exist in en, zh and ar; tsc exit 0; pnpm test 0 failed"], "modelTier": "standard"}
```

---

### Task 4: Register AG-UI agents as the second provider

**Goal:** `'agui'` is a provider id end to end (ADR-0032's checklist, spec §2.1): the CHECK accepts it through a generated migration, the schema map, the server registry (with the caller on Test connection and `hubHistory`), the admin form (agent URL, audience, write-only JWT secret, Test connection), the table, the gallery line "AG-UI agent" and `ProviderChat`; and the three issue #62 items of spec §2.5 are done (typed DTO fields, no cast in the client registry, M5).

Sources: ADR-0032 and `docs/frontend-conventions.md` §4.5 (the provider registry and its client half); drizzle-kit `generate --name` (Context7 `/drizzle-team/drizzle-orm-docs`, "drizzle-kit generate": "`--name` … migration file name"; AGENTS.md: read the SQL before committing it); TypeScript 4.6 release notes, "Indexed Access Inference Improvements" (the `UnionRecord`/`processRecord` pattern, microsoft/TypeScript#47109), which lets one provider's documents go to that provider's registry entry without a cast once there are two providers (with a union `provider`, `PROVIDERS[provider].chatFields(settings)` no longer type-checks); antd `Form.Item` `rules` with a `validator` returning a Promise and `Input.Password` (`npx -y @ant-design/cli info Form.Item --version 6.6.5`, as `components/provider-ui/dify/form-section.tsx` uses them); `@ant-design/icons` 6.3.4 `RobotOutlined` (spec §2.1, Part 1's E11). Measured while planning: on a copy of `faebc118` with Tasks 2–3 applied, this task's code gives tsc 0 errors and `pnpm test` 1929 passed; `pnpm db:generate --name agui_provider` wrote exactly the one statement quoted in Step 4.

**Files:**

- Create: `lib/providers/agui/provider.ts`, `components/provider-ui/agui/form-section.tsx`, `db/migrations/<timestamp>_agui_provider/{migration.sql,snapshot.json}` (by drizzle-kit)
- Modify: `lib/providers/ids.ts`, `db/schema/apps.ts` (a comment), `lib/providers/schemas.ts`, `lib/providers/registry.ts`, `lib/providers/dify/provider.ts`
- Modify: `lib/data/apps.ts` (generic DTO mappers, M5), `app/(admin)/app-management/schemas.ts` (the AG-UI variants), `app/(admin)/app-management/actions.ts` (the caller, a generic test runner)
- Modify: `components/provider-ui/registry.tsx`, `components/provider-ui/provider-chat.tsx`, `components/provider-ui/provider-form-section.tsx`, `components/admin/apps/app-management.tsx` (the filter's type names), `components/admin/apps/app-form-values.ts` (M5)
- Modify: `locales/{en,zh,ar}/translation.json` (`provider.agui`, fifteen `app_setting.*` keys)
- Test: `__tests__/provider-schemas.test.ts`, `__tests__/provider-registry.test.ts`, `__tests__/provider-ui.test.ts`, `__tests__/data-apps.test.ts`, `__tests__/app-form-values.test.ts`, `__tests__/app-management-schemas.test.ts`, `__tests__/app-management-actions.test.ts`, `__tests__/db-apps-migrations.test.ts`, `__tests__/db/schema.db.test.ts`, `__tests__/db/apps.db.test.ts`

**Acceptance Criteria:**

- [ ] `PROVIDER_IDS` is `['dify', 'agui']`; the new migration's SQL is exactly `ALTER TABLE "apps" DROP CONSTRAINT "apps_provider_check", ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify', 'agui'));` and both migration-name pins end with `'agui_provider'`.
- [ ] On the live database, an `apps` row with provider `'agui'` is stored and one with `'openai'` is refused with 23514 `apps_provider_check` (`pnpm test:db`).
- [ ] `checkDocuments('agui', …)` reads `{ agentUrl, audience }` and `{ jwtSecret }`; `PROVIDERS.agui` has `hubHistory: true`, `chatFields()` and `summaryFields()` `{}`, `secretsSet` `{ jwtSecret: true }`; `PROVIDERS.dify.hubHistory` is `false`.
- [ ] An admin DTO whose secrets fail but whose settings read carries `invalid: true` and the stored `settings` (M5), and the form opens on them; one whose settings fail carries no settings.
- [ ] `testAppConnectionAction({ provider: 'agui', … })` POSTs to the agent URL with a JWT whose `sub`, `auth_source` and `roles` are the admin's, reads a blank secret from the stored app, and answers `provider_agent_not_found` for a 404.
- [ ] The client registry gives AG-UI `RobotOutlined`, the line `provider.agui` with no type, and no type names; `typeName` uses no cast; the admin form shows an AG-UI app's Connection section with Test connection; `ProviderChat` renders `AppUnavailable` for an AG-UI app (P12).
- [ ] tsc 0 errors, `pnpm test` 0 failed, `pnpm test:db` 0 failed, `e2e/admin-apps.spec.ts` on `desktop-light` 0 failed (Dify's admin flows unchanged).

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm test:db` → tsc exit 0, both suites 0 failed

**Steps:**

- [ ] **Step 1: Write the failing tests**

These fail until the steps below land; tsc fails too until Step 9 (an `'agui'` literal where `ProviderId` is `'dify'`).

In `__tests__/provider-schemas.test.ts`, replace:

```ts
it('are Dify only in Part 1', () => {
	expect(PROVIDER_IDS).toEqual(['dify'])
	expect(isProviderId('dify')).toBe(true)
	expect(isProviderId('agui')).toBe(false)
	expect(isProviderId(undefined)).toBe(false)
})
```

with:

```ts
it('are Dify and, since Part 2, AG-UI agents (Part 2 spec §2.1)', () => {
	expect(PROVIDER_IDS).toEqual(['dify', 'agui'])
	expect(isProviderId('dify')).toBe(true)
	expect(isProviderId('agui')).toBe(true)
	expect(isProviderId('openai')).toBe(false)
	expect(isProviderId(undefined)).toBe(false)
})
```

replace:

```ts
		expect(checkDocuments('agui', settings, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'unknown_provider',
		})
	})
```

with:

```ts
		expect(checkDocuments('openai', settings, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'unknown_provider',
		})
	})
	// Part 2 spec §2.2: an AG-UI app's documents go through the same reads.
	it('reads an AG-UI app’s documents with its own schemas', () => {
		const agui = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
		const jwtSecret = 'k'.repeat(32)
		expect(checkDocuments('agui', agui, { jwtSecret })).toEqual({
			ok: true,
			documents: { provider: 'agui', settings: agui, secrets: { jwtSecret } },
		})
		expect(checkDocuments('agui', settings, { jwtSecret })).toEqual({
			ok: false,
			code: 'invalid_settings',
		})
		expect(checkDocuments('agui', agui, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'invalid_secrets',
		})
	})
```

and replace `expect(checkSettings('agui', settings)).toEqual({ ok: false, code: 'unknown_provider' })` with `expect(checkSettings('openai', settings)).toEqual({ ok: false, code: 'unknown_provider' })`.

In `__tests__/provider-registry.test.ts`, replace:

```ts
		expect(PROVIDERS.dify.id).toBe('dify')
	})
})
```

with:

```ts
		expect(PROVIDERS.dify.id).toBe('dify')
		expect(PROVIDERS.agui.id).toBe('agui')
	})
	// Part 2 spec §4.1: the hub keeps AG-UI conversations; Dify's stay in Dify until Part 3.
	it('says which providers the hub keeps the history of', () => {
		expect(PROVIDERS.dify.hubHistory).toBe(false)
		expect(PROVIDERS.agui.hubHistory).toBe(true)
	})
})

// Part 2 spec §2.2: what each DTO may carry of an AG-UI app's documents.
describe("AG-UI's DTO fields", () => {
	it('give the chat and the gallery nothing of the agent URL or the audience', () => {
		expect(PROVIDERS.agui.chatFields()).toEqual({})
		expect(PROVIDERS.agui.summaryFields()).toEqual({})
	})
	it('say whether the secret is set, never its value', () => {
		const set = PROVIDERS.agui.secretsSet({ jwtSecret: 'k'.repeat(32) })
		expect(set).toEqual({ jwtSecret: true })
		expect(JSON.stringify(set)).not.toContain('kkkk')
	})
})
```

In `__tests__/provider-ui.test.ts`, replace the first import line with `import { ApartmentOutlined, AppstoreOutlined, RobotOutlined } from '@ant-design/icons'`, replace:

```ts
// E11: Dify's fallback icon, and the generic one for a provider the browser does not know.
it('gives each provider its fallback icon, and an unknown one the generic icon', () => {
	expect(providerIcon('dify')).toBe(ApartmentOutlined)
	expect(providerIcon('agui')).toBe(AppstoreOutlined)
})
```

with:

```ts
// E11: each provider's fallback icon (Part 2 spec §2.1: RobotOutlined for AG-UI), and the generic one for a provider
// the browser does not know.
it('gives each provider its fallback icon, and an unknown one the generic icon', () => {
	expect(providerIcon('dify')).toBe(ApartmentOutlined)
	expect(providerIcon('agui')).toBe(RobotOutlined)
	expect(providerIcon('openai')).toBe(AppstoreOutlined)
})
// Part 2 spec §2.2: "AG-UI agent", with no app types.
it('names an AG-UI app by its provider alone', () => {
	expect(providerLine(t, 'agui')).toBe('provider.agui')
	expect(providerLine(t, 'agui', 'chat')).toBe('provider.agui')
	expect(typeName(t, 'agui', 'chat')).toBe('chat')
	expect(PROVIDER_UI.agui.types).toEqual([])
})
```

and replace `		expect(adminAppType({ ...common, invalid: true })).toBeUndefined()` with:

```ts
expect(adminAppType({ ...common, invalid: true })).toBeUndefined()
expect(
	adminAppType({
		...common,
		provider: 'agui',
		invalid: false,
		settings: { agentUrl: 'http://agents:8000/agents/a', audience: 'a' },
		secretsSet: { jwtSecret: true },
	}),
).toBeUndefined()
```

In `__tests__/data-apps.test.ts`: replace `['an unknown provider', 'agui', settings, { apiKey: 'app-secret' }, 'unknown_provider'],` with `['an unknown provider', 'openai', settings, { apiKey: 'app-secret' }, 'unknown_provider'],`, and `expect(toAdminAppDto({ ...row, provider: 'agui' }, [], [])).toBeNull()` with `expect(toAdminAppDto({ ...row, provider: 'openai' }, [], [])).toBeNull()`. Replace:

```ts
it('marks a row whose documents fail invalid, with no settings and no secrets flags', () => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	const dto = toAdminAppDto({ ...row, secrets: { apiKey: '' } }, [], [])
	expect(dto).toMatchObject({ id: 'a1', provider: 'dify', invalid: true })
	expect(dto).not.toHaveProperty('settings')
	expect(dto).not.toHaveProperty('secretsSet')
})
```

with:

```ts
// Part 2 spec §2.5 (issue #62's M5): the form opens on settings that still read, so only the secret is retyped.
it('marks a row whose secrets fail invalid, keeping its settings and no secrets flags', () => {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
	const dto = toAdminAppDto({ ...row, secrets: { apiKey: '' } }, [], [])
	expect(dto).toMatchObject({ id: 'a1', provider: 'dify', invalid: true, settings })
	expect(dto).not.toHaveProperty('secretsSet')
	expect(spy).toHaveBeenCalledTimes(1)
	expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
		appId: 'a1',
		code: 'invalid_secrets',
	})
})
it('marks a row whose settings fail invalid, with no settings and no secrets flags', () => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	const dto = toAdminAppDto({ ...row, settings: { ...settings, appType: null } }, [], [])
	expect(dto).toMatchObject({ id: 'a1', provider: 'dify', invalid: true })
	expect(dto).not.toHaveProperty('settings')
	expect(dto).not.toHaveProperty('secretsSet')
})
it('carries an AG-UI app’s settings and whether its secret is set, never the secret', () => {
	const agui = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
	const jwtSecret = 'an-app-secret-of-at-least-32-chars!'
	const dto = toAdminAppDto(
		{ ...row, provider: 'agui', settings: agui, secrets: { jwtSecret } },
		[],
		[],
	)
	expect(dto).toMatchObject({
		provider: 'agui',
		invalid: false,
		settings: agui,
		secretsSet: { jwtSecret: true },
	})
	expect(JSON.stringify(dto)).not.toContain(jwtSecret)
})
```

and before `	it('the gallery card carries the provider and the type, never the base or the switches', () => {` insert:

```ts
// Part 2 spec §2.2: in 2a an AG-UI app's chat DTO and card carry nothing of its documents.
it('an AG-UI app’s chat DTO and card carry no agent URL, audience or provider fields', () => {
	const agui = {
		...record,
		provider: 'agui' as const,
		settings: { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' },
	}
	expect(toChatAppDto(agui)).toEqual({
		id: 'a1',
		provider: 'agui',
		name: 'Tea',
		description: 'desc',
		enabled: true,
		hasIcon: true,
	})
	expect(toAppSummary(agui)).toEqual({
		id: 'a1',
		provider: 'agui',
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		hasIcon: true,
	})
})
```

In `__tests__/app-form-values.test.ts`, after the test 'open an invalid app on its provider’s defaults' insert:

```ts
// Part 2 spec §2.5 (issue #62's M5): an invalid app whose settings still read opens on them, the secret blank.
it('open an invalid app on its stored settings when they still read', () => {
	expect(toAppFormValues({ ...common, invalid: true, settings })).toMatchObject({
		settings,
		secrets: { apiKey: '' },
	})
})
```

In `__tests__/app-management-schemas.test.ts`, replace `		['an unknown provider', { provider: 'agui' }],` with:

```ts
		['an unknown provider', { provider: 'openai' }],
		['Dify settings under the AG-UI provider', { provider: 'agui' }],
```

and before `// The drawer marks a refused field by its path` insert:

```ts
// Part 2 spec §2.2: an AG-UI app is read by AG-UI's schemas, its secret write-only like Dify's key.
describe('the AG-UI variants', () => {
	const agui = {
		...values,
		provider: 'agui',
		settings: { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' },
		secrets: { jwtSecret: 'k'.repeat(32) },
	}
	const aguiForm = (over: Record<string, unknown> = {}) => ({
		values: JSON.stringify({ ...agui, ...over }),
		iconIntent: 'keep',
	})
	it('create an AG-UI app with its settings and secret', () => {
		const parsed = createAppFormSchema.parse(aguiForm())
		expect(parsed.provider).toBe('agui')
		expect(parsed.settings).toEqual(agui.settings)
		expect(parsed.secrets).toEqual(agui.secrets)
	})
	it('refuse a new AG-UI app without a 32-character secret', () => {
		expect(
			createAppFormSchema.safeParse(aguiForm({ secrets: { jwtSecret: 'short' } })).success,
		).toBe(false)
	})
	it('read a blank secret on an edit, and on a test, as not given', () => {
		expect(updateAppFormSchema.parse(aguiForm({ secrets: { jwtSecret: '' } })).secrets).toEqual({
			jwtSecret: undefined,
		})
		expect(
			connectionTestSchema.parse({
				provider: 'agui',
				settings: agui.settings,
				secrets: { jwtSecret: '' },
			}),
		).toEqual({ provider: 'agui', settings: agui.settings, secrets: { jwtSecret: undefined } })
	})
})
```

In `__tests__/app-management-actions.test.ts`: after `vi.mock('next/cache', () => ({ refresh }))` add:

```ts
// Part 2 spec §2.3: the AG-UI test signs with AGENT_JWT_ISSUER (lib/env.ts), here its default.
vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))
```

before `import {\n\tcreateAppAction,` add `import { decodeJwt } from 'jose'` and a blank line, and append at the end of the file:

```ts
// Part 2 spec §2.4 and plan call P2: an AG-UI app's test reaches its agent as the admin running it.
describe('testAppConnectionAction for an AG-UI app', () => {
	const agui = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
	const jwtSecret = 'an-app-secret-of-at-least-32-chars!'
	const bearer = () =>
		new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers)
			.get('authorization')!
			.replace(/^Bearer /, '')

	it('tests with the typed secret and a token for the admin, and answers reachable on 422', async () => {
		fetchMock.mockResolvedValue(new Response('{}', { status: 422 }))
		expect(
			await testAppConnectionAction({ provider: 'agui', settings: agui, secrets: { jwtSecret } }),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(fetchMock.mock.calls[0]![0]).toBe(agui.agentUrl)
		expect(decodeJwt(bearer())).toMatchObject({
			sub: actor.id,
			auth_source: 'local',
			roles: ['admin'],
			aud: 'assistant',
			iss: 'nextjs-bff',
		})
		expect(getStoredSecrets).not.toHaveBeenCalled()
	})
	it('reads the stored secret on the server when the field is blank and the app exists', async () => {
		getStoredSecrets.mockResolvedValue({ secrets: { jwtSecret } })
		fetchMock.mockResolvedValue(new Response(null, { status: 422 }))
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'agui',
				settings: agui,
				secrets: { jwtSecret: '' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(getStoredSecrets).toHaveBeenCalledWith(actor, UUID, 'agui')
	})
	it.each([
		[404, { ok: false, code: 'provider_agent_not_found' }],
		[401, { ok: false, code: 'provider_key_refused' }],
	])('answers %i with its own code', async (status, result) => {
		fetchMock.mockResolvedValue(new Response(null, { status }))
		expect(
			await testAppConnectionAction({ provider: 'agui', settings: agui, secrets: { jwtSecret } }),
		).toEqual(result)
	})
	it('answers an agent that ran on the test request as reachable with a warning', async () => {
		fetchMock.mockResolvedValue(
			new Response('data: {}\n\n', {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			}),
		)
		expect(
			await testAppConnectionAction({ provider: 'agui', settings: agui, secrets: { jwtSecret } }),
		).toEqual({ ok: true, data: { outcome: 'ran_on_invalid_input' } })
	})
	it('answers invalid_input on the secret when a new app’s secret is short, and calls nothing', async () => {
		expect(
			await testAppConnectionAction({
				provider: 'agui',
				settings: agui,
				secrets: { jwtSecret: 'short' },
			}),
		).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.jwtSecret': ['too_small'] },
		})
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
```

In `__tests__/db-apps-migrations.test.ts`, replace:

```ts
// Part 1 spec §2.4 and Plan decision b: expand (generated), data (custom), contract (generated), in that order.
describe("Part 1's migrations", () => {
	it('follow the baseline as expand, data and contract', () => {
		expect(folders.map(name => name.replace(/^\d{14}_/, ''))).toEqual([
			'baseline',
			'apps_expand',
			'apps_data',
			'apps_contract',
		])
	})
```

with:

```ts
// Part 1 spec §2.4 and Plan decision b: expand (generated), data (custom), contract (generated), in that order; Part 2
// adds the provider migration after them.
describe("Part 1's migrations", () => {
	it('follow the baseline as expand, data and contract, then Part 2’s provider migration', () => {
		expect(folders.map(name => name.replace(/^\d{14}_/, ''))).toEqual([
			'baseline',
			'apps_expand',
			'apps_data',
			'apps_contract',
			'agui_provider',
		])
	})
```

and append at the end of the file:

```ts
// Part 2 spec §2.1: AG-UI joins the CHECK through PROVIDER_IDS, in one generated statement that replaces the constraint.
describe("Part 2's provider migration", () => {
	it('replaces apps_provider_check with one that lists dify and agui', () => {
		expect(sqlOf('agui_provider').trim()).toBe(
			`ALTER TABLE "apps" DROP CONSTRAINT "apps_provider_check", ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify', 'agui'));`,
		)
	})
})
```

In `__tests__/db/schema.db.test.ts` (the live pin of the migration log; Task 5 appends `'conversations'` after this), replace:

```ts
	it('was applied with Part 1’s three migrations, through the log the runtime migrator shares with drizzle-kit (DV 1c)', async () => {
```

with:

```ts
	it('was applied with Part 1’s three migrations and Part 2’s provider migration, through the log the runtime migrator shares with drizzle-kit (DV 1c)', async () => {
```

replace:

```ts
			'apps_contract',
		])
	})
```

with:

```ts
			'apps_contract',
			'agui_provider',
		])
	})
```

and replace the CHECK test:

```ts
it('refuses a provider the CHECK does not list', async () => {
	expect(
		await refusal(
			pool.query(
				"INSERT INTO apps (id, provider, name, settings, secrets) VALUES ($1, 'agui', 'x', '{}', '{}')",
				[crypto.randomUUID()],
			),
		),
	).toEqual({ code: '23514', constraint: 'apps_provider_check' })
})
```

with:

```ts
it('refuses a provider the CHECK does not list', async () => {
	expect(
		await refusal(
			pool.query(
				"INSERT INTO apps (id, provider, name, settings, secrets) VALUES ($1, 'openai', 'x', '{}', '{}')",
				[crypto.randomUUID()],
			),
		),
	).toEqual({ code: '23514', constraint: 'apps_provider_check' })
})

// Part 2 spec §2.1: the agui_provider migration lists AG-UI in the CHECK.
it('takes an AG-UI app', async () => {
	const row = app({
		provider: 'agui',
		settings: { agentUrl: 'http://agents:8000/agents/a', audience: 'a' },
		secrets: { jwtSecret: 'k'.repeat(32) },
	})
	await testDb.insert(apps).values(row)
	const [stored] = await testDb
		.select({ provider: apps.provider })
		.from(apps)
		.where(eq(apps.id, row.id))
	expect(stored!.provider).toBe('agui')
})
```

In `__tests__/db/apps.db.test.ts`, replace:

```ts
	// Spec §2.3: the provider is fixed; an input that names another is never read (the CHECK would refuse 'agui').
	it('keeps the stored provider whatever the input says', async () => {
		const id = await createdId()
		expect(await update(id, { provider: 'agui' })).toEqual({ ok: true, data: undefined })
```

with:

```ts
	// Spec §2.3: the provider is fixed; an input that names another is never read (the CHECK would refuse 'openai').
	it('keeps the stored provider whatever the input says', async () => {
		const id = await createdId()
		expect(await update(id, { provider: 'openai' })).toEqual({ ok: true, data: undefined })
```

and after the test 'mark a broken row invalid for the admin, with no settings, and hide it from users' (it ends with `code: 'invalid_settings',\n\t\t})\n\t})`) insert:

```ts
// Part 2 spec §2.5 (issue #62's M5): settings that still read go back to the admin beside secrets that do not.
it('keep the stored settings of a row whose secrets fail, for the admin’s repair', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	const id = await createdId()
	await testDb
		.update(apps)
		.set({ secrets: { apiKey: '' } })
		.where(eq(apps.id, id))
	const [dto] = await listAdminApps(owner)
	expect(dto).toMatchObject({ id, invalid: true, settings })
	expect(dto).not.toHaveProperty('secretsSet')
	expect(await getAppAccess(member, id)).toBeNull()
})
```

Run: `pnpm exec vitest run --project unit __tests__/provider-schemas.test.ts __tests__/provider-registry.test.ts __tests__/provider-ui.test.ts __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/app-management-schemas.test.ts __tests__/app-management-actions.test.ts __tests__/db-apps-migrations.test.ts`

Expected: FAIL in all eight files (no `agui` id, no `PROVIDERS.agui`, no `PROVIDER_UI.agui`, no `agui_provider` folder, M5 not done, the AG-UI action cases answer `invalid_input`).

- [ ] **Step 2: The id and the schema map**

In `lib/providers/ids.ts`, replace:

```ts
/**
 * The providers the hub knows (Part 1 spec §3; decision 24: a `text` column with a CHECK listing these ids, plus this
 * check in code). Part 2 adds `'agui'` here and to the CHECK in `db/schema/apps.ts`. Client-safe: the schema, the forms
 * and both registries read it.
 */
export const PROVIDER_IDS = ['dify'] as const
```

with:

```ts
/**
 * The providers the hub knows (Part 1 spec §3; decision 24: a `text` column with a CHECK listing these ids, plus this
 * check in code): Dify, and AG-UI agents since Part 2 (spec §2.1). `db/schema/apps.ts` builds its CHECK from this list,
 * so a new id comes with a generated migration. Client-safe: the schema, the forms and both registries read it.
 */
export const PROVIDER_IDS = ['dify', 'agui'] as const
```

In `db/schema/apps.ts`, replace the comment line `		// never input, so they are written into the SQL as literals (sql.raw). Part 2 adds 'agui' through PROVIDER_IDS.` with:

```ts
// never input, so they are written into the SQL as literals (sql.raw); a new id is a generated migration that
// replaces the constraint (Part 2 spec §2.1).
```

In `lib/providers/schemas.ts`, add the import above the Dify one:

```ts
import {
	AGUI_DEFAULT_SECRETS,
	AGUI_DEFAULT_SETTINGS,
	aguiSecretsSchema,
	aguiSecretsUpdateSchema,
	aguiSettingsSchema,
} from './agui/schema'
```

and in `PROVIDER_SCHEMAS`, after the `dify` entry's closing `},` insert:

```ts
	agui: {
		settingsSchema: aguiSettingsSchema,
		secretsSchema: aguiSecretsSchema,
		secretsUpdateSchema: aguiSecretsUpdateSchema,
		defaultSettings: AGUI_DEFAULT_SETTINGS,
		defaultSecrets: AGUI_DEFAULT_SECRETS,
	},
```

- [ ] **Step 3: The typed reads (generic over the provider)**

With two providers, `PROVIDER_SCHEMAS[provider].settingsSchema.safeParse(…)` and `{ provider, settings }` no longer correlate (tsc: `… is not assignable to type 'StoredSettings'`). In `lib/providers/schemas.ts`, replace:

```ts
/** An app's settings once its provider's schema has read them: the only typed form of `settings`. */
export type StoredSettings = {
	[P in ProviderId]: { provider: P; settings: ProviderSettings<P> }
}[ProviderId]

/** An app's documents once its provider's schemas have read them: the only typed form of `settings` and `secrets`. */
export type StoredDocuments = {
	[P in ProviderId]: { provider: P; settings: ProviderSettings<P>; secrets: ProviderSecrets<P> }
}[ProviderId]
```

with:

```ts
/**
 * An app's settings once its provider's schema has read them: the only typed form of `settings`. A union keyed by
 * provider, written as a mapped type indexed by a type parameter that defaults to every provider: the pattern of the
 * TypeScript 4.6 release notes' "Indexed Access Inference Improvements" (`UnionRecord`, `processRecord`; "indexed access
 * types which immediately index into a mapped object type", microsoft/TypeScript#47109). Inside a function generic over
 * P, one provider's settings then go with that provider's schema or registry entry without a cast (`record.f(record.v)`
 * in the example), whatever the number of providers.
 */
export type StoredSettings<P extends ProviderId = ProviderId> = {
	[K in P]: { provider: K; settings: ProviderSettings<K> }
}[P]

/** An app's documents once its provider's schemas have read them: the only typed form of `settings` and `secrets`. */
export type StoredDocuments<P extends ProviderId = ProviderId> = {
	[K in P]: { provider: K; settings: ProviderSettings<K>; secrets: ProviderSecrets<K> }
}[P]

/** The two document schemas of each provider, through the mapped type the generic reads below index (see StoredSettings). */
const DOCUMENT_SCHEMAS: {
	[P in ProviderId]: {
		settingsSchema: z.ZodType<ProviderSettings<P>>
		secretsSchema: z.ZodType<ProviderSecrets<P>>
	}
} = PROVIDER_SCHEMAS

/** A provider's secrets schema, typed by its id (the edit's merge is parsed with it: spec §2.3). */
export const secretsSchemaOf = <P extends ProviderId>(provider: P): z.ZodType<ProviderSecrets<P>> =>
	DOCUMENT_SCHEMAS[provider].secretsSchema

const parseSettings = <P extends ProviderId>(
	provider: P,
	settings: unknown,
): StoredSettings<P> | null => {
	const parsed = DOCUMENT_SCHEMAS[provider].settingsSchema.safeParse(settings)
	return parsed.success ? { provider, settings: parsed.data } : null
}

const parseSecrets = <P extends ProviderId>(
	documents: StoredSettings<P>,
	secrets: unknown,
): StoredDocuments<P> | null => {
	const parsed = DOCUMENT_SCHEMAS[documents.provider].secretsSchema.safeParse(secrets)
	return parsed.success ? { ...documents, secrets: parsed.data } : null
}
```

and in `checkSettings` and `checkDocuments` replace:

```ts
const parsed = PROVIDER_SCHEMAS[provider].settingsSchema.safeParse(settings)
return parsed.success
	? { ok: true, documents: { provider, settings: parsed.data } }
	: { ok: false, code: 'invalid_settings' }
```

with:

```ts
const documents = parseSettings(provider, settings)
return documents ? { ok: true, documents } : { ok: false, code: 'invalid_settings' }
```

and:

```ts
const parsedSecrets = PROVIDER_SCHEMAS[checked.documents.provider].secretsSchema.safeParse(secrets)
return parsedSecrets.success
	? { ok: true, documents: { ...checked.documents, secrets: parsedSecrets.data } }
	: { ok: false, code: 'invalid_secrets' }
```

with:

```ts
const documents = parseSecrets(checked.documents, secrets)
return documents ? { ok: true, documents } : { ok: false, code: 'invalid_secrets' }
```

- [ ] **Step 4: The migration**

Run: `pnpm db:generate --name agui_provider`

Expected: `[✓] Your SQL migration ➜ db/migrations/<timestamp>_agui_provider/migration.sql`. Read it (AGENTS.md): it must hold exactly

```sql
ALTER TABLE "apps" DROP CONSTRAINT "apps_provider_check", ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify', 'agui'));
```

one `ALTER TABLE` with both actions, so the table is never without the constraint (PostgreSQL 18 "ALTER TABLE": "Multiple subcommands … are applied together"). Anything more (a table, a column, a type) means the schema differs from `fork/overhaul`: stop and report. `snapshot.json` beside it is drizzle-kit's and is committed unread.

- [ ] **Step 5: The registry and the two providers**

Replace the whole of `lib/providers/dify/provider.ts` with:

```ts
import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import type { DifySecrets, DifySettings } from './schema'
import { testDifyConnection } from './test-connection'

/** What the chat DTO carries of Dify's settings (spec §2.3): the type and the three chat switches. */
export type DifyChatFields = {
	appType: DifySettings['appType']
	settings: Pick<
		DifySettings,
		'answerForm' | 'enableUpdateAfterConversationStarts' | 'openingStatementDisplayMode'
	>
}

/** What a gallery card carries of Dify's settings (E10): the type. */
export type DifySummaryFields = { appType: DifySettings['appType'] }

/**
 * Dify as the server registry holds it (Part 1 spec §3): its schemas, its connection test, and what of its documents each
 * DTO carries (spec §2.3): the chat gets the type and the three chat switches, never the base or the key; the gallery
 * the type; the admin which secrets are set, never their values (DV 10, OWASP ASVS 14.2.6). The hub keeps no history of
 * a Dify conversation until Part 3 moves Dify onto the shared chat (Part 2 spec §4.1).
 */
export const difyProvider = {
	id: 'dify',
	...PROVIDER_SCHEMAS.dify,
	testConnection: testDifyConnection,
	chatFields: (settings: DifySettings): DifyChatFields => ({
		appType: settings.appType,
		settings: {
			answerForm: settings.answerForm,
			enableUpdateAfterConversationStarts: settings.enableUpdateAfterConversationStarts,
			openingStatementDisplayMode: settings.openingStatementDisplayMode,
		},
	}),
	summaryFields: (settings: DifySettings): DifySummaryFields => ({ appType: settings.appType }),
	secretsSet: (secrets: DifySecrets) => ({ apiKey: secrets.apiKey.length > 0 }),
	hubHistory: false,
} as const
```

Create `lib/providers/agui/provider.ts`:

```ts
import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import type { AguiSecrets } from './schema'
import { testAguiConnection } from './test-connection'

/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): nothing in 2a; 2b adds `askUser` and 2c the
 * allowed attachment kinds. Never the agent URL, the audience or the secret.
 */
export type AguiChatFields = Record<never, never>

/** What a gallery card carries (spec §2.2): nothing beyond the provider's name, "AG-UI agent" (AG-UI has no app types). */
export type AguiSummaryFields = Record<never, never>

/**
 * AG-UI agents as the server registry holds them (Part 2 spec §2.1, ADR-0032's checklist): their schemas, their
 * connection test (spec §2.4), what each DTO carries, which secret is set (never its value), and that the hub keeps their
 * conversations (spec §4.1). The chat adapter joins in Task 9.
 */
export const aguiProvider = {
	id: 'agui',
	...PROVIDER_SCHEMAS.agui,
	testConnection: testAguiConnection,
	chatFields: (): AguiChatFields => ({}),
	summaryFields: (): AguiSummaryFields => ({}),
	secretsSet: (secrets: AguiSecrets) => ({ jwtSecret: secrets.jwtSecret.length > 0 }),
	hubHistory: true,
} as const
```

Replace the whole of `lib/providers/registry.ts` with (Task 9 adds `chat?: ChatAdapter<P>` to `ProviderDefinition` and `chat: aguiChat` to `aguiProvider`):

```ts
import 'server-only'

import { aguiProvider, type AguiChatFields, type AguiSummaryFields } from './agui/provider'
import type { ProviderCaller } from './caller'
import type { ConnectionTestResult } from './connection'
import { difyProvider, type DifyChatFields, type DifySummaryFields } from './dify/provider'
import type { ProviderId } from './ids'
import type { ProviderSecrets, ProviderSettings } from './schemas'

/** What the chat DTO carries of each provider's settings (Part 2 spec §2.5, issue #62: typed per provider). */
interface ProviderChatFieldsMap {
	dify: DifyChatFields
	agui: AguiChatFields
}

/** What a gallery card carries of each provider's settings (spec §2.5, issue #62). */
interface ProviderSummaryFieldsMap {
	dify: DifySummaryFields
	agui: AguiSummaryFields
}

export type ProviderChatFields<P extends ProviderId> = ProviderChatFieldsMap[P]
export type ProviderSummaryFields<P extends ProviderId> = ProviderSummaryFieldsMap[P]
/** Which of a provider's secrets are set, never their values (DV 10): one flag per secret field. */
export type ProviderSecretsSet<P extends ProviderId> = Record<keyof ProviderSecrets<P>, boolean>

/**
 * What the server knows of each provider (Part 1 spec §3): the schemas (lib/providers/schemas.ts), the connection test,
 * and the DTO fields its settings give (Plan decision e). The neutral data layer, the route guard and the actions reach a
 * provider only through here (spec §11). Server-only (DV 9a: the registry, testConnection and the clients). Part 2 adds
 * the caller to the test (an AG-UI token names the admin running it, spec §2.4) and `hubHistory` (spec §4.1).
 */
export interface ProviderDefinition<P extends ProviderId> {
	id: P
	testConnection: (
		settings: ProviderSettings<P>,
		secrets: ProviderSecrets<P>,
		caller: ProviderCaller,
	) => Promise<ConnectionTestResult>
	chatFields: (settings: ProviderSettings<P>) => ProviderChatFields<P>
	summaryFields: (settings: ProviderSettings<P>) => ProviderSummaryFields<P>
	secretsSet: (secrets: ProviderSecrets<P>) => ProviderSecretsSet<P>
	/** Spec §4.1: the hub keeps this provider's conversations (the shared chat's store; 2c's Logs read it). */
	hubHistory: boolean
}

/**
 * One definition per provider id: `satisfies` over the mapped type makes the map exhaustive (DV 11), as LobeHub's
 * `providerRuntimeMap` and LibreChat's `providerConfigMap` are maps from type to adapter; unlike LobeHub's
 * `runtimeMap[provider] ?? LobeOpenAI`, an unknown id has no fallback here (neutral code narrows with `isProviderId` first).
 */
export const PROVIDERS = {
	dify: difyProvider,
	agui: aguiProvider,
} satisfies { [P in ProviderId]: ProviderDefinition<P> }

/**
 * A provider's definition for an id that is a type parameter. Through a map annotated with the mapped type, `REGISTRY[id]`
 * reads as `ProviderDefinition<P>` (TypeScript 4.6 release notes, "Indexed Access Inference Improvements", and
 * microsoft/TypeScript#47109), so a call with that provider's documents type-checks for every provider at once; a call
 * on `PROVIDERS[provider]` with a union `provider` would need the intersection of all the providers' settings.
 */
const REGISTRY: { [P in ProviderId]: ProviderDefinition<P> } = PROVIDERS

export const providerDefinition = <P extends ProviderId>(id: P): ProviderDefinition<P> =>
	REGISTRY[id]
```

- [ ] **Step 6: The apps data layer, generic, with M5**

In `lib/data/apps.ts`, replace `	PROVIDERS,` in the registry import with `	providerDefinition,`. Replace the `AppRecord` type:

```ts
/** An app as a user's DTOs see it: its neutral fields and its settings as its provider's schema reads them. */
export type AppRecord = {
	id: string
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
} & StoredSettings
```

with:

```ts
/**
 * An app as a user's DTOs see it: its neutral fields and its settings as its provider's schema reads them. Generic over
 * the provider like StoredSettings (lib/providers/schemas.ts), so the DTO mappers below hand one provider's settings to
 * that provider's registry entry for every provider at once.
 */
export type AppRecord<P extends ProviderId = ProviderId> = {
	id: string
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
} & StoredSettings<P>
```

Replace everything from `/** The chat's view (spec §2.3): a union keyed by provider; …` down to the end of `toAppSummary` (the line `})` before `/* ----- The admin's DTO (spec §2.3, §4.5) ----- */`) with:

```ts
/** The chat's view (spec §2.3): a union keyed by provider; never the base URL or the secrets (file links go through the proxy). */
export type ChatAppDto<P extends ProviderId = ProviderId> = {
	[K in P]: ChatAppCommon & { provider: K } & ProviderChatFields<K>
}[P]

type SummaryCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'tags' | 'hasIcon'>

/** What a gallery card shows (spec §2.3, E10): the provider's own fields are its summary fields (for Dify, the type). */
export type AppSummary<P extends ProviderId = ProviderId> = {
	[K in P]: SummaryCommon & { provider: K } & ProviderSummaryFields<K>
}[P]

/*
 * The two mappers spread two values typed apart: a spread of an object literal with a generic value is typed as an
 * intersection TypeScript does not match to the mapped type above, while a spread of two typed values is exactly
 * `ChatAppCommon & { provider: P } & ProviderChatFields<P>`, which it does.
 */
export const toChatAppDto = <P extends ProviderId>(record: AppRecord<P>): ChatAppDto<P> => {
	const common: ChatAppCommon & { provider: P } = {
		id: record.id,
		provider: record.provider,
		name: record.name,
		description: record.description,
		enabled: record.enabled,
		hasIcon: record.hasIcon,
	}
	const fields: ProviderChatFields<P> = providerDefinition(record.provider).chatFields(
		record.settings,
	)
	return { ...common, ...fields }
}

export const toAppSummary = <P extends ProviderId>(record: AppRecord<P>): AppSummary<P> => {
	const common: SummaryCommon & { provider: P } = {
		id: record.id,
		provider: record.provider,
		name: record.name,
		description: record.description,
		tags: record.tags,
		hasIcon: record.hasIcon,
	}
	const fields: ProviderSummaryFields<P> = providerDefinition(record.provider).summaryFields(
		record.settings,
	)
	return { ...common, ...fields }
}
```

Replace the `AdminAppDto` type and its comment:

```ts
/**
 * The admin's view: every app with its access, its settings and which secrets are set, never their values (spec §2.3;
 * DV 10, OWASP ASVS 14.2.6). A row whose documents fail carries `invalid: true` and no settings: the table marks it and
 * the form opens on the provider's defaults so the admin can repair it.
 */
export type AdminAppDto =
	| {
			[P in ProviderId]: AdminAppCommon & {
				provider: P
				invalid: false
				settings: ProviderSettings<P>
				secretsSet: ProviderSecretsSet<P>
			}
	  }[ProviderId]
	| (AdminAppCommon & { invalid: true })
```

with:

```ts
/**
 * The admin's view: every app with its access, its settings and which secrets are set, never their values (spec §2.3;
 * DV 10, OWASP ASVS 14.2.6). A row whose documents fail carries `invalid: true` and no secrets flags: the table marks it
 * and the form opens on its stored settings when they still read, else on the provider's defaults, so the admin repairs
 * only what broke (Part 2 spec §2.5, issue #62's M5).
 */
export type AdminAppDto<P extends ProviderId = ProviderId> =
	| {
			[K in P]: AdminAppCommon & {
				provider: K
				invalid: false
				settings: ProviderSettings<K>
				secretsSet: ProviderSecretsSet<K>
			}
	  }[P]
	| {
			[K in P]: AdminAppCommon & { provider: K; invalid: true; settings?: ProviderSettings<K> }
	  }[P]
```

Before `/**\n * One app with its access; only the grants of this app count, …` (the comment of `toAdminAppDto`) insert:

```ts
/** A row whose documents read, as the admin sees it: generic over the provider, so its secrets go to its own `secretsSet`. */
const validAdminDto = <P extends ProviderId>(
	common: AdminAppCommon,
	documents: StoredDocuments<P>,
): AdminAppDto<P> => ({
	...common,
	provider: documents.provider,
	invalid: false,
	settings: documents.settings,
	secretsSet: providerDefinition(documents.provider).secretsSet(documents.secrets),
})
```

and at the end of `toAdminAppDto` replace:

```ts
	const documents = readDocuments(row.id, row.provider, row.settings, row.secrets)
	if (!documents) return { ...common, invalid: true }
	return {
		...common,
		provider: documents.provider,
		invalid: false,
		settings: documents.settings,
		secretsSet: PROVIDERS[documents.provider].secretsSet(documents.secrets),
	}
}
```

with:

```ts
	const documents = readDocuments(row.id, row.provider, row.settings, row.secrets)
	if (documents) return validAdminDto(common, documents)
	// M5: the refusal is logged once (readDocuments); settings that still read go back to the form without a second line.
	const settings = checkSettings(row.provider, row.settings)
	return settings.ok
		? { ...common, ...settings.documents, invalid: true }
		: { ...common, invalid: true }
}
```

In `components/admin/apps/app-form-values.ts`, replace the comment of `toAppFormValues`:

```ts
/**
 * A saved app as the form's values. The stored secrets never come back to the browser, so their fields start blank (a
 * blank keeps them, spec §2.3); an invalid row opens on its provider's defaults so the admin can repair it.
 */
```

with:

```ts
/**
 * A saved app as the form's values. The stored secrets never come back to the browser, so their fields start blank (a
 * blank keeps them, spec §2.3). An invalid row opens on its stored settings when they still read, else on its provider's
 * defaults, so the admin repairs only what broke (Part 2 spec §2.5, issue #62's M5).
 */
```

and its last spread `	...(app.invalid ? {} : { settings: app.settings }),` with `	...(app.settings ? { settings: app.settings } : {}),`.

- [ ] **Step 7: The admin schemas and the action**

In `app/(admin)/app-management/schemas.ts`, each of the three `z.discriminatedUnion('provider', [ … ])` gains an AG-UI member after the Dify one (zod 4 `z.discriminatedUnion`, as Part 1 built them). In `createValuesSchema`, after the Dify `z.object({ … }),` insert:

```ts
	z.object({
		...commonFields,
		provider: z.literal('agui'),
		settings: PROVIDER_SCHEMAS.agui.settingsSchema,
		secrets: PROVIDER_SCHEMAS.agui.secretsSchema,
	}),
```

in `updateValuesSchema`:

```ts
	z.object({
		...commonFields,
		provider: z.literal('agui'),
		settings: PROVIDER_SCHEMAS.agui.settingsSchema,
		secrets: PROVIDER_SCHEMAS.agui.secretsUpdateSchema,
	}),
```

and in `connectionTestSchema`:

```ts
	z.object({
		appId: idSchema.optional(),
		provider: z.literal('agui'),
		settings: PROVIDER_SCHEMAS.agui.settingsSchema,
		secrets: PROVIDER_SCHEMAS.agui.secretsUpdateSchema,
	}),
```

In `app/(admin)/app-management/actions.ts`, replace the imports:

```ts
import type { ConnectionTestResult } from '@/lib/providers/connection'
import { PROVIDERS } from '@/lib/providers/registry'
import { documentFieldErrors, mergeSecrets } from '@/lib/providers/schemas'
```

with:

```ts
import type { ProviderCaller } from '@/lib/providers/caller'
import type { ConnectionTestResult } from '@/lib/providers/connection'
import type { ProviderId } from '@/lib/providers/ids'
import { providerDefinition } from '@/lib/providers/registry'
import {
	documentFieldErrors,
	mergeSecrets,
	PROVIDER_SCHEMAS,
	secretsSchemaOf,
	type StoredSettings,
} from '@/lib/providers/schemas'
```

before the comment `/**\n * Test connection (spec §4.2; decision 18): verifies the admin …` insert:

```ts
/**
 * One provider's test, generic over its id so its settings, its merged secrets and its test go together (the registry's
 * `providerDefinition`): the merged secrets are parsed first, then the provider is asked as the admin (Part 2 plan call
 * P2: an AG-UI token's `sub` is the admin running the test).
 */
const runTest = async <P extends ProviderId>(
	documents: StoredSettings<P>,
	secrets: unknown,
	caller: ProviderCaller,
): Promise<ActionResult<ConnectionTestOutcome>> => {
	const merged = secretsSchemaOf(documents.provider).safeParse(secrets)
	if (!merged.success) return fail('invalid_input', documentFieldErrors('secrets', merged.error))
	const result = await providerDefinition(documents.provider).testConnection(
		documents.settings,
		merged.data,
		caller,
	)
	if (!result.ok) return fail(TEST_FAILURES[result.code])
	return ok(testOutcome(result.warning))
}
```

and in `testAppConnectionAction` replace:

```ts
const { appId, provider, settings, secrets } = parsed.data
const definition = PROVIDERS[provider]
// Spec §4.2 step 2: the stored secrets are read only for a saved app with a secret field left blank.
const blank = Object.keys(definition.defaultSecrets).some(
	key => (secrets as Record<string, string | undefined>)[key] === undefined,
)
let stored: unknown = {}
if (appId && blank) {
	const found = await getStoredSecrets(actor, appId, provider)
	if (!found) return fail('not_found')
	stored = found.secrets
}
const merged = definition.secretsSchema.safeParse(mergeSecrets(stored, secrets))
if (!merged.success) return fail('invalid_input', documentFieldErrors('secrets', merged.error))
const result = await definition.testConnection(settings, merged.data)
if (!result.ok) return fail(TEST_FAILURES[result.code])
return ok(testOutcome(result.warning))
```

with:

```ts
const { appId, provider, secrets } = parsed.data
// Spec §4.2 step 2: the stored secrets are read only for a saved app with a secret field left blank.
const blank = Object.keys(PROVIDER_SCHEMAS[provider].defaultSecrets).some(
	key => (secrets as Record<string, string | undefined>)[key] === undefined,
)
let stored: unknown = {}
if (appId && blank) {
	const found = await getStoredSecrets(actor, appId, provider)
	if (!found) return fail('not_found')
	stored = found.secrets
}
return await runTest(parsed.data, mergeSecrets(stored, secrets), actor)
```

(`parsed.data` is one member of the discriminated union, so it is a `StoredSettings<P>` with extra fields; the actor is a `ProviderCaller`, P1.)

- [ ] **Step 8: The client registry, the form section and the switches**

Replace the whole of `components/provider-ui/registry.tsx` with (the `typeLabelKeys` map goes: Dify's lookup narrows with `isAppMode` from `lib/providers/dify/types/app.ts`, issue #62):

```tsx
'use client'

import { ApartmentOutlined, AppstoreOutlined, RobotOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import type { ComponentType } from 'react'

import type { AdminAppDto } from '@/lib/data/apps'
import { isAppMode } from '@/lib/providers/dify/types'
import { isProviderId, type ProviderId } from '@/lib/providers/ids'

import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from './dify/app-types'

/*
 * The client half of the provider registry (Part 1 spec §3): what the gallery and the admin table show of a provider,
 * its name, its fallback icon (E11) and its app types, if it has any (AG-UI has none, Part 2 spec §2.2). The chat views
 * (provider-chat.tsx) and the admin form sections (provider-form-section.tsx) live in modules of their own: once a file
 * is marked "use client", "all of its imports and the components it directly renders are included in the client bundle"
 * (Next "Server and Client Components"), and the gallery should not carry the chat. `satisfies` keeps the map exhaustive
 * over ProviderId (DV 11); `as const` keeps each key a literal, which the typed `t()` requires (types/i18next.d.ts).
 */
export const PROVIDER_UI = {
	dify: {
		labelKey: 'provider.dify',
		Icon: ApartmentOutlined,
		/** The order the table's filter lists the types in: Dify's console order (the admin form's choices). */
		types: APP_MODE_OPTIONS,
	},
	agui: {
		labelKey: 'provider.agui',
		// Part 1's E11: a fallback icon per provider; Part 2 spec §2.1 names RobotOutlined for AG-UI agents.
		Icon: RobotOutlined,
		types: [],
	},
} as const satisfies Record<
	ProviderId,
	{
		labelKey: string
		Icon: ComponentType
		types: readonly string[]
	}
>

/** E11: the icon of an app whose provider the browser does not know. */
export const GenericAppIcon = AppstoreOutlined

/** The icon an app without a stored image shows (E11): its provider's, or the generic one. */
export const providerIcon = (provider: string): ComponentType =>
	isProviderId(provider) ? PROVIDER_UI[provider].Icon : GenericAppIcon

/**
 * A type's translation key for the provider, or undefined for a type the client does not know (Part 2 spec §2.5, issue
 * #62: Dify's lookup narrows the type with its own guard, `isAppMode`, instead of casting it). AG-UI has no types.
 */
const typeLabelKey = (provider: ProviderId, type: string) => {
	switch (provider) {
		case 'dify':
			return isAppMode(type) ? APP_MODE_NAME_KEYS[type] : undefined
		case 'agui':
			return undefined
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return provider satisfies never
	}
}

/** E9 and E10: the provider's name and, when the provider has types and the app's is known, the type ("Dify · Chatflow"). */
export const providerLine = (t: TFunction, provider: ProviderId, appType?: string): string => {
	const label = t(PROVIDER_UI[provider].labelKey)
	const key = appType === undefined ? undefined : typeLabelKey(provider, appType)
	return key ? `${label} · ${t(key)}` : label
}

/** A type's name for the provider (E7's warning): the translation, or the provider's raw value for a type the client does not know. */
export const typeName = (t: TFunction, provider: ProviderId, type: string): string => {
	const key = typeLabelKey(provider, type)
	return key ? t(key) : type
}

/** The app's type as its provider's settings hold it, for the table (E9); none for an app whose documents failed. */
export const adminAppType = (app: AdminAppDto): string | undefined => {
	if (app.invalid) return undefined
	switch (app.provider) {
		case 'dify':
			return app.settings.appType
		case 'agui':
			// Part 2 spec §2.2: AG-UI agents have no app types.
			return undefined
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return app satisfies never
	}
}
```

In `components/admin/apps/app-management.tsx`, add `typeName` to the registry import (`import {\n\tadminAppType,\n\tPROVIDER_UI,\n\tproviderLine,\n\ttypeName,\n} from '@/components/provider-ui/registry'`) and in the provider filter replace `								text: t(ui.typeLabelKeys[type]),` with `								text: typeName(t, id, type),`.

Create `components/provider-ui/agui/form-section.tsx`. Each field's rule is its own zod schema, so the browser and the server agree, as Dify's API base rule does (`components/provider-ui/dify/api-base-rule.ts`); AG-UI has no app type, so `ConnectionTest` gets no `chosenType`:

```tsx
'use client'

import { Divider, Form, Input } from 'antd'
import { useTranslation } from 'react-i18next'
import type * as z from 'zod'

import ConnectionTest from '@/components/admin/apps/connection-test'
import { aguiSecretsSchema, aguiSettingsSchema } from '@/lib/providers/agui/schema'

/** The connection fields: the test is keyed by their values, so a change clears its result (E7). */
const CONNECTION_FIELDS = [
	['settings', 'agentUrl'],
	['settings', 'audience'],
	['secrets', 'jwtSecret'],
]

/**
 * A field's antd Rule `validator` (Form §Rule: "Customize validation rule. Accept Promise as return") from the field's
 * own zod schema (lib/providers/agui/schema.ts), so the browser and the server agree on every value, as Dify's API base
 * rule does. A blank value resolves: the `required` rule words that case, and a blank secret on an edit keeps the stored
 * one (ADR-0032).
 */
const schemaRule = (schema: z.ZodType, message: string) => ({
	validator: (_rule: unknown, value: unknown): Promise<void> =>
		!String(value ?? '').trim() || schema.safeParse(value).success
			? Promise.resolve()
			: Promise.reject(new Error(message)),
})

/**
 * AG-UI's section of the app form (Part 2 spec §2.1, §2.2): Connection (the agent URL, the JWT audience, the JWT secret,
 * Test connection). The secret is write-only as Dify's key is (ADR-0032): required on a new app, and on an edit blank by
 * default, which keeps the stored one. The server parses the documents again.
 */
export default function AguiFormSection({ appId, editing }: { appId?: string; editing: boolean }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const agentUrl = Form.useWatch(['settings', 'agentUrl'], form)
	const audience = Form.useWatch(['settings', 'audience'], form)
	const jwtSecret = Form.useWatch(['secrets', 'jwtSecret'], form)

	return (
		<>
			<Divider titlePlacement="start">{t('app_setting.section_connection')}</Divider>
			<Form.Item
				label={t('app_setting.agent_url')}
				name={['settings', 'agentUrl']}
				tooltip={t('app_setting.agent_url_tooltip')}
				rules={[
					{ required: true, message: t('app_setting.agent_url_required') },
					schemaRule(aguiSettingsSchema.shape.agentUrl, t('app_setting.agent_url_invalid')),
				]}
			>
				<Input placeholder={t('app_setting.agent_url_placeholder')} />
			</Form.Item>
			<Form.Item
				label={t('app_setting.audience')}
				name={['settings', 'audience']}
				tooltip={t('app_setting.audience_tooltip')}
				rules={[
					{ required: true, whitespace: true, message: t('app_setting.audience_required') },
					schemaRule(aguiSettingsSchema.shape.audience, t('app_setting.audience_invalid')),
				]}
			>
				<Input placeholder={t('app_setting.audience_placeholder')} />
			</Form.Item>
			<Form.Item
				label={t('app_setting.jwt_secret')}
				name={['secrets', 'jwtSecret']}
				tooltip={t('app_setting.jwt_secret_tooltip')}
				rules={[
					...(editing ? [] : [{ required: true, message: t('app_setting.jwt_secret_required') }]),
					schemaRule(aguiSecretsSchema.shape.jwtSecret, t('app_setting.jwt_secret_invalid')),
				]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t(
						editing ? 'app_setting.secret_keep_placeholder' : 'app_setting.jwt_secret_placeholder',
					)}
				/>
			</Form.Item>
			{/*
			 * E7: the last row of Connection, aligned with the fields (Form.Item `label={null}`, as Dify's section). AG-UI has
			 * no app type, so the test is given none.
			 */}
			<Form.Item label={null}>
				<ConnectionTest
					key={[agentUrl, audience, jwtSecret].join('\n')}
					appId={appId}
					provider="agui"
					fields={CONNECTION_FIELDS}
				/>
			</Form.Item>
		</>
	)
}
```

Replace the whole of `components/provider-ui/provider-form-section.tsx` with:

```tsx
'use client'

import type { ProviderId } from '@/lib/providers/ids'

import AguiFormSection from './agui/form-section'
import DifyFormSection from './dify/form-section'

/**
 * The admin form's half of the client registry (Part 1 spec §3): the picked provider's sections, after the shared ones.
 * A module of its own, so the gallery's registry does not carry the admin form (Next "Server and Client Components":
 * a client module's imports are all in the bundle). An exhaustive switch: a provider without a section fails tsc.
 */
export default function ProviderFormSection({
	provider,
	appId,
	editing,
}: {
	provider: ProviderId
	appId?: string
	editing: boolean
}) {
	switch (provider) {
		case 'dify':
			return (
				<DifyFormSection
					appId={appId}
					editing={editing}
				/>
			)
		case 'agui':
			return (
				<AguiFormSection
					appId={appId}
					editing={editing}
				/>
			)
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking": `provider` is `never` here; `satisfies` is the TS 4.9 operator.
			return provider satisfies never
	}
}
```

Replace the whole of `components/provider-ui/provider-chat.tsx` with (plan call P12):

```tsx
'use client'

import AppUnavailable from '@/components/chat/app-unavailable'
import ChatWorkspace from '@/components/chat/chat-workspace'
import type { ChatAppDto } from '@/lib/data/apps'

/**
 * The chat page's one client switch (Part 1 spec §3; DV 9b): the server page hands over the chat DTO, a serializable
 * prop, and the provider's chat view is chosen here, on the client (React "use client" caveats: a server module may
 * pass a client component only serializable values). The switch is exhaustive: a provider added to ProviderId without a
 * view fails tsc at `satisfies never`.
 */
export default function ProviderChat({ app }: { app: ChatAppDto }) {
	switch (app.provider) {
		case 'dify':
			return <ChatWorkspace app={app} />
		case 'agui':
			// Part 2 plan call P12: the shared chat (Task 16) replaces this inside the branch.
			return <AppUnavailable reason="missing" />
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return app satisfies never
	}
}
```

- [ ] **Step 9: The keys in three languages**

In `locales/en/translation.json`, replace `"test_connection": "Test connection"` (the last key of `app_setting`) with:

```json
"test_connection": "Test connection",
		"agent_url": "Agent URL",
		"agent_url_tooltip": "The full address the hub sends each run to, e.g. http://agents:8000/agents/assistant",
		"agent_url_placeholder": "Enter the agent URL",
		"agent_url_required": "Enter the agent URL",
		"agent_url_invalid": "Enter a URL that starts with http:// or https://, at most 500 characters",
		"audience": "Audience",
		"audience_tooltip": "The JWT audience (aud) the agent expects: its AGENT_JWT_AUDIENCE, e.g. assistant",
		"audience_placeholder": "Enter the audience",
		"audience_required": "Enter the audience",
		"audience_invalid": "At most 255 characters",
		"jwt_secret": "JWT secret",
		"jwt_secret_tooltip": "The key the hub signs each request's token with; the agent holds the same value. At least 32 random characters, e.g. from openssl rand -base64 48",
		"jwt_secret_placeholder": "Enter the JWT secret",
		"jwt_secret_required": "Enter the JWT secret",
		"jwt_secret_invalid": "Enter 32 to 512 characters"
```

and `"dify": "Dify"` (in `provider`) with:

```json
"dify": "Dify",
		"agui": "AG-UI agent"
```

In `locales/zh/translation.json`, replace `"test_connection": "测试连接"` with:

```json
"test_connection": "测试连接",
		"agent_url": "智能体地址",
		"agent_url_tooltip": "应用中心发送每次运行的完整地址，如 http://agents:8000/agents/assistant",
		"agent_url_placeholder": "请输入智能体地址",
		"agent_url_required": "请输入智能体地址",
		"agent_url_invalid": "请输入以 http:// 或 https:// 开头、不超过 500 个字符的地址",
		"audience": "受众",
		"audience_tooltip": "智能体期望的 JWT 受众（aud），即其 AGENT_JWT_AUDIENCE，如 assistant",
		"audience_placeholder": "请输入受众",
		"audience_required": "请输入受众",
		"audience_invalid": "不超过 255 个字符",
		"jwt_secret": "JWT 密钥",
		"jwt_secret_tooltip": "应用中心用来签署每次请求令牌的密钥，智能体持有相同的值。至少 32 个随机字符，例如由 openssl rand -base64 48 生成",
		"jwt_secret_placeholder": "请输入 JWT 密钥",
		"jwt_secret_required": "请输入 JWT 密钥",
		"jwt_secret_invalid": "请输入 32 到 512 个字符"
```

and `"dify": "Dify"` with:

```json
"dify": "Dify",
		"agui": "AG-UI 智能体"
```

In `locales/ar/translation.json`, replace `"test_connection": "اختبار الاتصال"` with:

```json
"test_connection": "اختبار الاتصال",
		"agent_url": "عنوان الوكيل",
		"agent_url_tooltip": "العنوان الكامل الذي ترسل إليه المنصة كل تشغيل، مثال: http://agents:8000/agents/assistant",
		"agent_url_placeholder": "أدخل عنوان الوكيل",
		"agent_url_required": "أدخل عنوان الوكيل",
		"agent_url_invalid": "أدخل عنوانًا يبدأ بـ http:// أو https:// ولا يتجاوز 500 حرف",
		"audience": "الجمهور",
		"audience_tooltip": "جمهور JWT (aud) الذي يتوقعه الوكيل، أي قيمة AGENT_JWT_AUDIENCE لديه، مثال: assistant",
		"audience_placeholder": "أدخل الجمهور",
		"audience_required": "أدخل الجمهور",
		"audience_invalid": "لا يتجاوز 255 حرفًا",
		"jwt_secret": "سر JWT",
		"jwt_secret_tooltip": "المفتاح الذي توقّع به المنصة رمز كل طلب، ويحمل الوكيل القيمة نفسها. 32 حرفًا عشوائيًا على الأقل، مثلًا من openssl rand -base64 48",
		"jwt_secret_placeholder": "أدخل سر JWT",
		"jwt_secret_required": "أدخل سر JWT",
		"jwt_secret_invalid": "أدخل من 32 إلى 512 حرفًا"
```

and `"dify": "Dify"` with:

```json
"dify": "Dify",
		"agui": "وكيل AG-UI"
```

The zh and ar wording joins the owner's review list (Task 18).

- [ ] **Step 10: Run the tests to see them pass**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec vitest run --project unit __tests__/provider-schemas.test.ts __tests__/provider-registry.test.ts __tests__/provider-ui.test.ts __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/app-management-schemas.test.ts __tests__/app-management-actions.test.ts __tests__/db-apps-migrations.test.ts __tests__/provider-boundary.test.ts __tests__/i18n-locales.test.ts
pnpm test
pnpm test:db
```

Expected: tsc exit 0; the ten files pass; `pnpm test` 0 failed (planned run: 160 files, 1929 tests); `pnpm test:db` 0 failed, including 'was applied with Part 1’s three migrations and Part 2’s provider migration…', 'takes an AG-UI app' and 'keep the stored settings of a row whose secrets fail, for the admin’s repair'.

- [ ] **Step 11: Gates and Dify's admin flows**

Run:

```bash
pnpm exec oxlint lib/providers lib/data/apps.ts db/schema/apps.ts "app/(admin)/app-management" components/provider-ui components/admin/apps __tests__
pnpm exec oxfmt --check lib/providers lib/data/apps.ts db/schema/apps.ts "app/(admin)/app-management" components/provider-ui components/admin/apps __tests__ locales
npx -y @ant-design/cli lint ./
pnpm exec playwright test e2e/admin-apps.spec.ts --project desktop-light
```

Expected: oxlint 0 findings; oxfmt clean; the antd lint's finding count no higher than before this task (note both numbers in the task's report); the admin spec 0 failed (stop `pnpm dev` first: one `next dev` per checkout; `pnpm test:db` must not run at the same time).

- [ ] **Step 12: Commit**

```bash
git add lib/providers/ids.ts db/schema/apps.ts db/migrations lib/providers/schemas.ts lib/providers/registry.ts lib/providers/dify/provider.ts lib/providers/agui/provider.ts lib/data/apps.ts "app/(admin)/app-management/schemas.ts" "app/(admin)/app-management/actions.ts" components/provider-ui/registry.tsx components/provider-ui/provider-chat.tsx components/provider-ui/provider-form-section.tsx components/provider-ui/agui/form-section.tsx components/admin/apps/app-management.tsx components/admin/apps/app-form-values.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/provider-schemas.test.ts __tests__/provider-registry.test.ts __tests__/provider-ui.test.ts __tests__/data-apps.test.ts __tests__/app-form-values.test.ts __tests__/app-management-schemas.test.ts __tests__/app-management-actions.test.ts __tests__/db-apps-migrations.test.ts __tests__/db/schema.db.test.ts __tests__/db/apps.db.test.ts
git commit -m "feat(providers): register AG-UI agents as the second provider

Part 2 spec §2.1 (ADR-0032's checklist): 'agui' in PROVIDER_IDS with a generated migration that replaces
apps_provider_check, its schemas and server definition (hubHistory true; the test gets the admin as caller), the
admin form's Connection section, RobotOutlined and 'AG-UI agent' in the client registry. Issue #62 (spec §2.5): DTO
fields typed per provider through generic reads, Dify's type lookup without a cast, and an invalid app's Edit opens
on settings that still read (M5).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/providers/ids.ts", "db/schema/apps.ts", "db/migrations/<timestamp>_agui_provider/migration.sql", "lib/providers/schemas.ts", "lib/providers/registry.ts", "lib/providers/dify/provider.ts", "lib/providers/agui/provider.ts", "lib/data/apps.ts", "app/(admin)/app-management/schemas.ts", "app/(admin)/app-management/actions.ts", "components/provider-ui/registry.tsx", "components/provider-ui/provider-chat.tsx", "components/provider-ui/provider-form-section.tsx", "components/provider-ui/agui/form-section.tsx", "components/admin/apps/app-management.tsx", "components/admin/apps/app-form-values.ts", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/provider-schemas.test.ts", "__tests__/provider-registry.test.ts", "__tests__/provider-ui.test.ts", "__tests__/data-apps.test.ts", "__tests__/app-form-values.test.ts", "__tests__/app-management-schemas.test.ts", "__tests__/app-management-actions.test.ts", "__tests__/db-apps-migrations.test.ts", "__tests__/db/schema.db.test.ts", "__tests__/db/apps.db.test.ts"], "verifyCommand": "pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm test:db", "acceptanceCriteria": ["PROVIDER_IDS is ['dify', 'agui']; the agui_provider migration SQL is exactly the one DROP CONSTRAINT/ADD CONSTRAINT statement listing 'dify', 'agui'; both migration-name pins end with 'agui_provider'", "pnpm test:db stores an 'agui' app and refuses 'openai' with 23514 apps_provider_check", "PROVIDERS.agui: hubHistory true, chatFields() and summaryFields() {}, secretsSet {jwtSecret: true}; PROVIDERS.dify.hubHistory false", "an admin DTO with failing secrets and readable settings carries invalid: true and the stored settings, and the form opens on them (M5)", "testAppConnectionAction for agui POSTs to the agent URL with a JWT whose sub, auth_source and roles are the admin's, reads a blank secret from the stored app, answers provider_agent_not_found for 404", "client registry: RobotOutlined, line provider.agui, no types, no cast in typeName; ProviderChat renders AppUnavailable for agui", "tsc 0 errors, pnpm test 0 failed, pnpm test:db 0 failed, e2e/admin-apps.spec.ts desktop-light 0 failed"], "modelTier": "standard"}
```

---

### Task 5: The conversation store tables

**Goal:** The three tables of spec §3.1 (`conversations`, `conversation_runs`, `conversation_messages`) exist in `db/schema/conversations.ts` with their CHECKs, keys and indexes, created by one generated drizzle-kit migration and pinned by a live database test.

Spec §3.1 and §3.4; ADR-0031 (generated migrations only). Messages are stored one row per AG-UI message, never as an event log (spec §3, `part2-store-and-logs.md` §7.1). The statuses and roles are client-safe constants in `lib/chat/statuses.ts`, so the schema's CHECKs, the DAL and the browser's turn reducer (Task 8) share one list, the way `db/schema/apps.ts` builds `apps_provider_check` from `PROVIDER_IDS`.

**Files:**

- Create: `lib/chat/statuses.ts`
- Create: `db/schema/conversations.ts`
- Modify: `db/schema/index.ts` (add the three exports)
- Create (generated): `db/migrations/<timestamp>_conversations/migration.sql` and `snapshot.json`
- Create: `__tests__/db/conversations-schema.db.test.ts`
- Modify: `__tests__/db/schema.db.test.ts` and `__tests__/db-apps-migrations.test.ts` (the migration-name lists, as Task 4 left them)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project db __tests__/db/conversations-schema.db.test.ts` reports 9 passed.
- [ ] `pnpm exec vitest run --project db __tests__/db/schema.db.test.ts` passes with the migration list ending `'agui_provider', 'conversations'`.
- [ ] The generated `migration.sql` holds exactly three `CREATE TABLE`, five `CREATE INDEX`, five foreign keys (four `ON DELETE CASCADE`: messages and runs to `conversations`, `conversations` to `apps` and to `users`; one `ON DELETE SET NULL`: messages' `run_id` to `conversation_runs`), one `UNIQUE("conversation_id","message_id")` and three CHECKs, and nothing that alters an existing table.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` reports no error; `pnpm test` stays green.

**Verify:** `pnpm exec vitest run --project db __tests__/db/conversations-schema.db.test.ts __tests__/db/schema.db.test.ts` → all passed, 0 failed.

**Steps:**

- [ ] **Step 1: Write the statuses module**

Create `lib/chat/statuses.ts`:

```ts
/*
 * The conversation store's value sets (Part 2 spec §3.1), client-safe: the schema builds its CHECKs from them
 * (db/schema/conversations.ts), the data layer types its rows with them (lib/data/conversations.ts), and the turn
 * reducer reads a run's status with them (lib/chat/turn.ts). Text columns with a CHECK rather than PostgreSQL enums,
 * for the reason db/schema/apps.ts gives for `provider`: a value added to an enum "cannot be used until after the
 * transaction has been committed" (PostgreSQL 18 "ALTER TYPE", Notes) while the migrator applies every pending
 * migration in one transaction.
 */

/** A run's state (spec §3.1): `running` until the run ends one of the other five ways (spec §3.2, §4.5). */
export const RUN_STATUSES = [
	'running',
	'succeeded',
	'interrupted',
	'cancelled',
	'failed',
	'truncated',
] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

/** A stored message's state (spec §3.1): open while it streams, then complete, or incomplete when the run was cut short. */
export const MESSAGE_STATUSES = ['streaming', 'complete', 'incomplete'] as const

export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

/** The seven AG-UI message roles (AG-UI 1.0 "Messages"; `@ag-ui/core` 1.0.2 `Message`). */
export const MESSAGE_ROLES = [
	'developer',
	'system',
	'assistant',
	'user',
	'tool',
	'activity',
	'reasoning',
] as const

export type MessageRole = (typeof MESSAGE_ROLES)[number]

/** Spec §3.1: the first user message, trimmed to 80 characters (code points), until renamed. */
export const TITLE_MAX_LENGTH = 80

/** Spec §3.4: a deleted conversation is purged after 30 days. */
export const PURGE_AFTER_DAYS = 30

/*
 * The tool messages the hub writes itself (lib/chat/thread.ts builds them; the turn reducer reads their `error`). Here,
 * not in thread.ts, because thread.ts is server-only and the browser's reducer (lib/chat/turn.ts) needs the first one.
 */

/** Spec §3.2 step 4: the error of a call the run never answered because it was stopped, failed or cut off. */
export const STOPPED_TOOL_ERROR = 'stopped'
export const STOPPED_TOOL_CONTENT = 'The run was stopped before this tool returned a result.'
/** Spec §6.2's last bullet (plan call P4): a call to a tool the hub never advertised. */
export const UNAVAILABLE_TOOL_ERROR = 'not_available'
export const UNAVAILABLE_TOOL_CONTENT = 'This tool is not available here.'
```

- [ ] **Step 2: Write the failing schema test**

Create `__tests__/db/conversations-schema.db.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

/** A query's refusal as the driver reported it (the helper of schema.db.test.ts: DrizzleQueryError's `cause`, or the DatabaseError itself). */
const refusal = async (query: PromiseLike<unknown>) => {
	const error: unknown = await query.then(
		() => null,
		(caught: unknown) => caught,
	)
	const fields = (value: unknown) => value as { code?: string; constraint?: string } | undefined
	const driver = error instanceof Error && error.cause ? fields(error.cause) : fields(error)
	return { code: driver?.code, constraint: driver?.constraint }
}

/** An account, an app and a conversation of that account in that app, with one run. */
const seed = async () => {
	const userId = crypto.randomUUID()
	const appId = crypto.randomUUID()
	const conversationId = crypto.randomUUID()
	const runId = crypto.randomUUID()
	await testDb
		.insert(users)
		.values({ id: userId, email: `${userId}@example.com`, password: 'hash', role: 'user' })
	await testDb.insert(apps).values({
		id: appId,
		provider: 'dify',
		name: 'Tea',
		settings: {},
		secrets: {},
	})
	await testDb.insert(conversations).values({ id: conversationId, appId, userId, title: 'Hello' })
	await testDb.insert(conversationRuns).values({ id: runId, conversationId, status: 'running' })
	return { userId, appId, conversationId, runId }
}

const message = (conversationId: string, runId: string | null, messageId: string) => ({
	conversationId,
	runId,
	messageId,
	role: 'user' as const,
	body: { id: messageId, role: 'user', content: 'hi' },
	status: 'complete' as const,
})

const countIn = async (table: 'conversations' | 'conversation_runs' | 'conversation_messages') =>
	Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n)

describe('the conversation store (Part 2 spec §3.1)', () => {
	it('gives a conversation its defaults: an empty title, an empty state and no active run', async () => {
		const userId = crypto.randomUUID()
		const appId = crypto.randomUUID()
		await testDb
			.insert(users)
			.values({ id: userId, email: `${userId}@example.com`, password: 'hash', role: 'user' })
		await testDb
			.insert(apps)
			.values({ id: appId, provider: 'dify', name: 'Tea', settings: {}, secrets: {} })
		const id = crypto.randomUUID()
		await testDb.insert(conversations).values({ id, appId, userId })
		const [row] = await testDb.select().from(conversations).where(eq(conversations.id, id))
		expect(row).toMatchObject({ title: '', state: {}, activeRunId: null, deletedAt: null })
	})

	it('numbers messages in the order they are written (seq, spec §3.1)', async () => {
		const { conversationId, runId } = await seed()
		for (const id of ['m1', 'm2', 'm3'])
			await testDb.insert(conversationMessages).values(message(conversationId, runId, id))
		const rows = await testDb
			.select({ seq: conversationMessages.seq, messageId: conversationMessages.messageId })
			.from(conversationMessages)
			.orderBy(conversationMessages.seq)
		expect(rows.map(row => row.messageId)).toEqual(['m1', 'm2', 'm3'])
		expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq)
		expect(rows[1]!.seq).toBeLessThan(rows[2]!.seq)
	})

	// PostgreSQL 18 "CREATE TABLE", GENERATED ALWAYS AS IDENTITY: a user value is taken only with OVERRIDING SYSTEM
	// VALUE; otherwise SQLSTATE 428C9 generated_always (Appendix A).
	it('refuses a seq the caller chose', async () => {
		const { conversationId } = await seed()
		expect(
			await refusal(
				pool.query(
					"INSERT INTO conversation_messages (seq, conversation_id, message_id, role, body, status) VALUES (1, $1, 'm1', 'user', '{}', 'complete')",
					[conversationId],
				),
			),
		).toEqual({ code: '428C9', constraint: undefined })
	})

	it('holds one row per message id in a conversation, and the same id in another conversation', async () => {
		const first = await seed()
		const second = await seed()
		await testDb
			.insert(conversationMessages)
			.values(message(first.conversationId, first.runId, 'm1'))
		await testDb
			.insert(conversationMessages)
			.values(message(second.conversationId, second.runId, 'm1'))
		expect(
			await refusal(
				testDb
					.insert(conversationMessages)
					.values(message(first.conversationId, first.runId, 'm1')),
			),
		).toEqual({ code: '23505', constraint: 'conversation_messages_conversation_id_message_id_key' })
	})

	it.each([
		[
			'a run status',
			(ids: Awaited<ReturnType<typeof seed>>) =>
				testDb.insert(conversationRuns).values({
					id: crypto.randomUUID(),
					conversationId: ids.conversationId,
					status: 'paused' as never,
				}),
			'conversation_runs_status_check',
		],
		[
			'a message role',
			(ids: Awaited<ReturnType<typeof seed>>) =>
				testDb
					.insert(conversationMessages)
					.values({ ...message(ids.conversationId, ids.runId, 'm9'), role: 'bot' as never }),
			'conversation_messages_role_check',
		],
		[
			'a message status',
			(ids: Awaited<ReturnType<typeof seed>>) =>
				testDb
					.insert(conversationMessages)
					.values({ ...message(ids.conversationId, ids.runId, 'm9'), status: 'draft' as never }),
			'conversation_messages_status_check',
		],
	])('refuses %s it does not know (23514)', async (_name, insert, constraint) => {
		const ids = await seed()
		expect(await refusal(insert(ids))).toEqual({ code: '23514', constraint })
	})

	// Spec §3.4: deleting an app or an account removes its conversations at once, with their runs and messages.
	it('removes an app’s conversations, runs and messages with the app', async () => {
		const { appId, conversationId, runId } = await seed()
		await testDb.insert(conversationMessages).values(message(conversationId, runId, 'm1'))
		await testDb.delete(apps).where(eq(apps.id, appId))
		expect([
			await countIn('conversations'),
			await countIn('conversation_runs'),
			await countIn('conversation_messages'),
		]).toEqual([0, 0, 0])
	})

	it('removes an account’s conversations, runs and messages with the account', async () => {
		const { userId, conversationId, runId } = await seed()
		await testDb.insert(conversationMessages).values(message(conversationId, runId, 'm1'))
		await testDb.delete(users).where(eq(users.id, userId))
		expect([
			await countIn('conversations'),
			await countIn('conversation_runs'),
			await countIn('conversation_messages'),
		]).toEqual([0, 0, 0])
	})
})
```

That is 9 cases (2 + 1 + 1 + 3 + 2).

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run --project db __tests__/db/conversations-schema.db.test.ts` Expected: FAIL — the import of `conversations` from `@/db/schema` does not exist (`SyntaxError`/"does not provide an export named 'conversations'"), or the tables are missing (`42P01 relation "conversations" does not exist`).

- [ ] **Step 4: Write the schema**

Create `db/schema/conversations.ts`:

```ts
import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { MESSAGE_ROLES, MESSAGE_STATUSES, RUN_STATUSES } from '@/lib/chat/statuses'

import { apps } from './apps'
import { timestamptz } from './columns'
import { users } from './users'

/*
 * The hub's conversation store (Part 2 spec §3.1, ADR-0033): one row per AG-UI thread, run and message, never an event
 * log (spec §3: the 1.0 spec replays history as messages; every reference hub stores messages). The value sets are the
 * code's own constants (lib/chat/statuses.ts), never input, so the CHECKs write them as literals with sql.raw, as
 * apps_provider_check does (PostgreSQL 18 "Check Constraints"; Drizzle "Indexes & Constraints", check()).
 *
 * `updated_at` is written by the data layer itself, never by `$onUpdate`: on a conversation it is the last activity
 * (spec §3.1), which a rename or a soft delete is not; and every value comes from a JS Date, so it has millisecond
 * precision and the list's keyset cursor (lib/data/conversations.ts) compares it exactly.
 */

/** The value list of a CHECK: `'a', 'b', …`. */
const listed = (values: readonly string[]) => sql.raw(values.map(value => `'${value}'`).join(', '))

/**
 * One per AG-UI thread (spec §3.1). The id is the threadId, minted by the hub (no default: lib/chat/run.ts gives it).
 * The indexes serve the user's list and, from 2c, the Logs; each foreign key's column leads one of them (PostgreSQL 18
 * "Foreign Keys": "it is often a good idea to index the referencing columns too").
 */
export const conversations = pgTable(
	'conversations',
	{
		id: uuid().primaryKey(),
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** The first user message, trimmed to 80 characters, until renamed; '' when it had no text (spec §3.1). */
		title: text().default('').notNull(),
		/** The agent's shared state after the last run (AG-UI "State"): any JSON value. */
		state: jsonb().default({}).notNull(),
		/** One active run per conversation (spec §3.2 step 1); no foreign key, the run row may be written after it. */
		activeRunId: uuid('active_run_id'),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at').defaultNow().notNull(),
		/** The soft delete (decision 49): set by the user's delete, purged after 30 days (spec §3.4). */
		deletedAt: timestamptz('deleted_at'),
	},
	table => [
		index('conversations_user_id_app_id_updated_at_idx').on(
			table.userId,
			table.appId,
			table.updatedAt,
		),
		index('conversations_app_id_updated_at_idx').on(table.appId, table.updatedAt),
	],
)

/** One per AG-UI run (spec §3.1): the id is the runId, minted by the hub and never reused. */
export const conversationRuns = pgTable(
	'conversation_runs',
	{
		id: uuid().primaryKey(),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		/** `enum` types the column in TypeScript only; the CHECK refuses other values (db/schema/apps.ts). */
		status: text({ enum: RUN_STATUSES }).notNull(),
		/** RUN_FINISHED.outcome as received (interrupts). */
		outcome: jsonb(),
		/** The answers this run was started with (spec §6), kept for the Logs. */
		resume: jsonb(),
		/** `{ code, message }` from RUN_ERROR or the hub. */
		error: jsonb(),
		/** The terminal event's usage. */
		usage: jsonb(),
		/** The run's CUSTOM events `{ name, value }` (e.g. run_cancelled), never sent back to the agent. */
		custom: jsonb().default([]).notNull(),
		startedAt: timestamptz('started_at').defaultNow().notNull(),
		finishedAt: timestamptz('finished_at'),
	},
	table => [
		index('conversation_runs_conversation_id_started_at_idx').on(
			table.conversationId,
			table.startedAt,
		),
		check('conversation_runs_status_check', sql`${table.status} IN (${listed(RUN_STATUSES)})`),
	],
)

/**
 * One per AG-UI message (spec §3.1). `seq` is the transcript's order: timestamps tie inside a transaction
 * (`part2-store-and-logs.md` §6.2), and an identity column numbers rows as they are written (PostgreSQL 18
 * "CREATE TABLE", GENERATED ALWAYS AS IDENTITY; Drizzle "PostgreSQL column types", identity columns). `bigint` in
 * `mode: 'number'`: JavaScript numbers are exact up to 2^53, far past any row count here. `run_id` is set to NULL if
 * its run row goes (spec §3.1); runs go only with their conversation, but the action still needs the referencing
 * column indexed (PostgreSQL 18 "Foreign Keys"), hence `conversation_messages_run_id_idx`, which spec §3.1 does not
 * list (plan note). The UNIQUE key is what the upsert of lib/data/conversations.ts targets (PostgreSQL 18 "INSERT",
 * ON CONFLICT), and its leading column also serves the conversation's foreign key.
 */
export const conversationMessages = pgTable(
	'conversation_messages',
	{
		seq: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		/** The run that produced it; a user message: the run it started. */
		runId: uuid('run_id').references(() => conversationRuns.id, { onDelete: 'set null' }),
		/** The AG-UI message id. */
		messageId: text('message_id').notNull(),
		role: text({ enum: MESSAGE_ROLES }).notNull(),
		/** The AG-UI message, checked with @ag-ui/core's MessageSchema on every write and read (lib/data/conversations.ts). */
		body: jsonb().notNull(),
		status: text({ enum: MESSAGE_STATUSES }).notNull(),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at').defaultNow().notNull(),
	},
	table => [
		unique('conversation_messages_conversation_id_message_id_key').on(
			table.conversationId,
			table.messageId,
		),
		index('conversation_messages_conversation_id_seq_idx').on(table.conversationId, table.seq),
		index('conversation_messages_run_id_idx').on(table.runId),
		check('conversation_messages_role_check', sql`${table.role} IN (${listed(MESSAGE_ROLES)})`),
		check(
			'conversation_messages_status_check',
			sql`${table.status} IN (${listed(MESSAGE_STATUSES)})`,
		),
	],
)
```

In `db/schema/index.ts`, add after the `apps` export (the list is alphabetical by module):

```ts
export { conversationMessages, conversationRuns, conversations } from './conversations'
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate --name conversations` Expected: `[✓] Your SQL migration ➜ db/migrations/<timestamp>_conversations/migration.sql 🚀`.

- [ ] **Step 6: Read the generated SQL before going on (ADR-0031)**

Open `db/migrations/<timestamp>_conversations/migration.sql`. It must hold only these statements (the order drizzle-kit 1.0.0-rc.4 writes, measured in a scratch copy while planning; whitespace may differ):

```sql
CREATE TABLE "conversation_messages" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversation_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"run_id" uuid,
	"message_id" text NOT NULL,
	"role" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_conversation_id_message_id_key" UNIQUE("conversation_id","message_id"),
	CONSTRAINT "conversation_messages_role_check" CHECK ("role" IN ('developer', 'system', 'assistant', 'user', 'tool', 'activity', 'reasoning')),
	CONSTRAINT "conversation_messages_status_check" CHECK ("status" IN ('streaming', 'complete', 'incomplete'))
);
--> statement-breakpoint
CREATE TABLE "conversation_runs" ( "id" uuid PRIMARY KEY, "conversation_id" uuid NOT NULL, "status" text NOT NULL, "outcome" jsonb, "resume" jsonb, "error" jsonb, "usage" jsonb, "custom" jsonb DEFAULT '[]' NOT NULL, "started_at" timestamp with time zone DEFAULT now() NOT NULL, "finished_at" timestamp with time zone, CONSTRAINT "conversation_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'interrupted', 'cancelled', 'failed', 'truncated')) );
--> statement-breakpoint
CREATE TABLE "conversations" ( "id" uuid PRIMARY KEY, "app_id" uuid NOT NULL, "user_id" uuid NOT NULL, "title" text DEFAULT '' NOT NULL, "state" jsonb DEFAULT '{}' NOT NULL, "active_run_id" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone );
--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_id_seq_idx" ON "conversation_messages" ("conversation_id","seq");
CREATE INDEX "conversation_messages_run_id_idx" ON "conversation_messages" ("run_id");
CREATE INDEX "conversation_runs_conversation_id_started_at_idx" ON "conversation_runs" ("conversation_id","started_at");
CREATE INDEX "conversations_user_id_app_id_updated_at_idx" ON "conversations" ("user_id","app_id","updated_at");
CREATE INDEX "conversations_app_id_updated_at_idx" ON "conversations" ("app_id","updated_at");
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_run_id_conversation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "conversation_runs"("id") ON DELETE SET NULL;
ALTER TABLE "conversation_runs" ADD CONSTRAINT "conversation_runs_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_app_id_apps_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
```

Check, in the file: no `ALTER TABLE "apps"` or `"users"` statement other than the two foreign keys' targets (an `apps_provider_check` change here means Task 4's migration was not generated first: stop and generate Task 4's); the three CHECK lists match `lib/chat/statuses.ts`; the identity column is `GENERATED ALWAYS`. Do not edit the generated file; a wrong statement means a wrong schema: fix the schema, delete the folder, generate again.

`__tests__/db/database.ts`'s `resetTables` needs no change: `TRUNCATE users, …, apps … CASCADE` also empties every table with a foreign key to them, and to the tables that adds (PostgreSQL 18 "TRUNCATE": CASCADE "Automatically truncate all tables that have foreign-key references to any of the named tables, or to any tables added to the group due to CASCADE"). It does not restart the `seq` sequence (no `RESTART IDENTITY`), so no test assumes a first value.

- [ ] **Step 7: Add the migration's name to the baseline test's list**

In `__tests__/db/schema.db.test.ts`, the case "was applied with Part 1’s three migrations…" lists the migration names. As Task 4 left it, the list ends with `'agui_provider'`; append `'conversations'`:

```ts
expect(rows.map(row => row.name.replace(/^\d{14}_/, ''))).toEqual([
	'baseline',
	'apps_expand',
	'apps_data',
	'apps_contract',
	'agui_provider',
	'conversations',
])
```

and rename the case to `'was applied with every migration in order, through the log the runtime migrator shares with drizzle-kit (DV 1c)'`.

The unit pin of the migration folders, `__tests__/db-apps-migrations.test.ts`, reads the folder names too. As Task 4 left it, its list ends with `'agui_provider',`; replace

```ts
			'apps_contract',
			'agui_provider',
		])
```

with

```ts
			'apps_contract',
			'agui_provider',
			'conversations',
		])
```

and its case name `'follow the baseline as expand, data and contract, then Part 2’s provider migration'` with `'follow the baseline as expand, data and contract, then Part 2’s provider and conversation migrations'`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit __tests__/db-apps-migrations.test.ts && pnpm exec vitest run --project db __tests__/db/conversations-schema.db.test.ts __tests__/db/schema.db.test.ts` Expected: PASS — the unit pin passes; 9 passed in `conversations-schema.db.test.ts`, every case of `schema.db.test.ts` passed. (The project's global setup recreates `hub_dal` and runs `drizzle-kit migrate`, so the new migration is applied first.)

- [ ] **Step 9: Run the gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/statuses.ts db/schema/conversations.ts db/schema/index.ts __tests__/db/conversations-schema.db.test.ts __tests__/db/schema.db.test.ts __tests__/db-apps-migrations.test.ts
pnpm exec oxfmt --check lib/chat/statuses.ts db/schema/conversations.ts db/schema/index.ts __tests__/db/conversations-schema.db.test.ts __tests__/db/schema.db.test.ts __tests__/db-apps-migrations.test.ts
pnpm test
pnpm test:db
```

Expected: no tsc error, no oxlint finding, oxfmt clean, `pnpm test` and `pnpm test:db` all passed.

- [ ] **Step 10: Commit**

```bash
git add lib/chat/statuses.ts db/schema/conversations.ts db/schema/index.ts db/migrations/ __tests__/db/conversations-schema.db.test.ts __tests__/db/schema.db.test.ts __tests__/db-apps-migrations.test.ts
git commit -m "feat(chat): add the conversation store tables

Conversations, runs and messages as Part 2 spec §3.1 sets them out, one row per AG-UI
message, with a generated migration and a live database test.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/statuses.ts", "db/schema/conversations.ts", "db/schema/index.ts", "db/migrations/<timestamp>_conversations/migration.sql", "db/migrations/<timestamp>_conversations/snapshot.json", "__tests__/db/conversations-schema.db.test.ts", "__tests__/db/schema.db.test.ts", "__tests__/db-apps-migrations.test.ts"], "verifyCommand": "pnpm exec vitest run --project db __tests__/db/conversations-schema.db.test.ts __tests__/db/schema.db.test.ts", "acceptanceCriteria": ["conversations-schema.db.test.ts reports 9 passed", "schema.db.test.ts passes with the migration list ending 'agui_provider', 'conversations'", "the generated migration.sql holds exactly three CREATE TABLE, five CREATE INDEX, five foreign keys (four ON DELETE CASCADE, one ON DELETE SET NULL), one UNIQUE and three CHECKs, and alters no existing table", "tsc --noEmit reports no error and pnpm test stays green"], "modelTier": "standard"}
```

---

### Task 6: Writing a run (the thread helpers and the run's DAL)

**Goal:** `lib/chat/thread.ts` builds the next `RunAgentInput`'s messages and the hub's own tool messages, and `lib/data/conversations.ts` starts a run (one active run per conversation), upserts its messages by id, stores the state, and ends it (closing what a stop, a failure or a crash left open), all proven on a live PostgreSQL.

Spec §3.2 (writing while a run streams), §3.3 (the next `RunAgentInput`), §4.3 steps 1–2; plan calls P4 and P7; ADR-0024 (the Data Access Layer takes the verified actor; the run's later writes are keyed by the `RunKey` that `startRun` gave back after it verified the actor). Every id reaching these functions is a UUID already (the routes check them with `lib/ids.ts`, Task 11), except AG-UI message ids, which are text (spec §3.1: `message_id text`).

**Files:**

- Create: `lib/chat/thread.ts`
- Create: `__tests__/chat-thread.test.ts`
- Create: `lib/data/conversations.ts` (types and the run's reads and writes; Task 7 adds the browser's reads)
- Create: `__tests__/db/conversations-run.db.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-thread.test.ts` reports 9 passed.
- [ ] `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts` reports 12 passed, including "starts one run at a time: of two at once, one is refused with run_in_progress".
- [ ] A message the AG-UI schema refuses is never stored and is logged as `Conversation message refused:` with `{ conversationId, runId }` only; a stored row it refuses is skipped on read and logged as `Stored conversation message refused:` with `{ conversationId, seq }` only.
- [ ] `finishRun` writes once: a second call for the same run changes nothing.
- [ ] tsc, oxlint, oxfmt clean; `pnpm test` and `pnpm test:db` green.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-thread.test.ts && pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts` → 9 passed, then 12 passed.

**Steps:**

- [ ] **Step 1: Write the failing unit test for the thread helpers**

Create `__tests__/chat-thread.test.ts`:

```ts
import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { errorToolMessage, threadForAgent, titleFrom, unansweredToolCalls } from '@/lib/chat/thread'
import type { StoredMessage } from '@/lib/data/conversations'

const row = (seq: number, body: Message): StoredMessage => ({
	seq,
	messageId: body.id,
	runId: null,
	role: body.role,
	body,
	status: 'complete',
})

const user: Message = { id: 'u1', role: 'user', content: 'Weather in Paris?' }
const call: Message = {
	id: 'a1',
	role: 'assistant',
	toolCalls: [
		{
			id: 'c1',
			type: 'function',
			function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
		},
		{ id: 'c2', type: 'function', function: { name: 'get_time', arguments: '{}' } },
	],
}
const text: Message = { id: 'a2', role: 'assistant', content: 'Looking it up.' }
const result1: Message = { id: 't1', role: 'tool', toolCallId: 'c1', content: '18 °C' }
const result2: Message = { id: 't2', role: 'tool', toolCallId: 'c2', content: '10:00' }
const activity: Message = {
	id: 'act1',
	role: 'activity',
	activityType: 'progress',
	content: { done: 1 },
}

describe('threadForAgent (spec §3.3, plan call P7)', () => {
	it('drops activity messages, which the next run must not carry (AG-UI "Activity")', () => {
		expect(threadForAgent([row(1, user), row(2, activity), row(3, text)]).map(m => m.id)).toEqual([
			'u1',
			'a2',
		])
	})

	it('moves a tool result right after the call it answers, past text that came in between', () => {
		expect(
			threadForAgent([row(1, user), row(2, call), row(3, text), row(4, result1)]).map(m => m.id),
		).toEqual(['u1', 'a1', 't1', 'a2'])
	})

	it('keeps several results of one call message in their order', () => {
		expect(
			threadForAgent([row(1, call), row(2, text), row(3, result2), row(4, result1)]).map(m => m.id),
		).toEqual(['a1', 't2', 't1', 'a2'])
	})

	it('leaves a tool message whose call it cannot find where it is', () => {
		const stray: Message = { id: 't9', role: 'tool', toolCallId: 'c9', content: 'x' }
		expect(threadForAgent([row(1, user), row(2, stray), row(3, text)]).map(m => m.id)).toEqual([
			'u1',
			't9',
			'a2',
		])
	})
})

describe('unansweredToolCalls (spec §3.2 step 4, §6.2)', () => {
	it('lists the calls no tool message answers, in order, with their tool names', () => {
		expect(unansweredToolCalls([user, call, result1, text])).toEqual([
			{ toolCallId: 'c2', name: 'get_time' },
		])
		expect(unansweredToolCalls([user, call, result1, result2])).toEqual([])
	})
})

describe('errorToolMessage', () => {
	it('answers a call with a tool message carrying the error (AG-UI "Tool calls": "a failure is still an answer")', () => {
		const message = errorToolMessage('c1', 'stopped', 'Stopped.')
		expect(message).toEqual({
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			role: 'tool',
			toolCallId: 'c1',
			content: 'Stopped.',
			error: 'stopped',
		})
	})
})

describe('titleFrom (spec §3.1)', () => {
	it('trims the text and folds its runs of white space into one space', () => {
		expect(titleFrom('  Plan the\n\n trip   ')).toBe('Plan the trip')
	})

	it('keeps at most 80 characters, never splitting a character made of two UTF-16 units', () => {
		const long = `${'a'.repeat(79)}😀😀`
		expect(titleFrom(long)).toBe(`${'a'.repeat(79)}😀`)
		expect(Array.from(titleFrom('b'.repeat(200)))).toHaveLength(80)
	})

	it('is empty for a message without text', () => {
		expect(titleFrom('   ')).toBe('')
	})
})
```

That is 9 cases.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --project unit __tests__/chat-thread.test.ts` Expected: FAIL — `Failed to resolve import "@/lib/chat/thread"`.

- [ ] **Step 3: Write the thread helpers**

Create `lib/chat/thread.ts`:

```ts
import 'server-only'

import type { Message, ToolMessage } from '@ag-ui/core'

import type { StoredMessage } from '@/lib/data/conversations'

import { TITLE_MAX_LENGTH } from './statuses'

/*
 * The stored thread as the next run sees it (Part 2 spec §3.3), and the tool messages the hub writes itself: a call a
 * stopped, failed or crashed run left without a result (spec §3.2 step 4) and a call to a tool the hub never advertised
 * (spec §6.2, plan call P4). AG-UI "Tool calls", frontend tools: "A thread that continues MUST answer every one of them
 * first … a failure is still an answer, as a tool message with `error` set"; for a backend call cut off by a stop the
 * spec is silent, and answering it too is what Pydantic AI's history repair and Open WebUI's "incomplete" marking do
 * (`part2-proxy-stop-identity.md` §3.2, §3.3).
 */

// The four constants live in the client-safe statuses module (Task 5), which the browser's turn reducer reads too; the
// server modules keep importing them from here.
export {
	STOPPED_TOOL_CONTENT,
	STOPPED_TOOL_ERROR,
	UNAVAILABLE_TOOL_CONTENT,
	UNAVAILABLE_TOOL_ERROR,
} from './statuses'

/**
 * The next RunAgentInput's messages (spec §3.3; plan call P7): the rows in `seq` order without `activity` messages
 * ("MUST be stripped before sending", AG-UI "Activity"; @ag-ui/client's prepareRunAgentInput drops them the same way),
 * and each tool message moved right after the assistant message whose call it answers, after any result already placed
 * there. @ag-ui/client 1.0.2 inserts a TOOL_CALL_RESULT at that place for the same reason ("the provider contract that an
 * assistant tool_call is immediately followed by its tool result", src/apply/default.ts, TOOL_CALL_RESULT), while the
 * store numbers a result after the text a run streamed before it. A tool message whose call is not in the thread keeps
 * its place.
 */
export const threadForAgent = (rows: readonly StoredMessage[]): Message[] => {
	const messages = rows.map(row => row.body).filter(message => message.role !== 'activity')
	const ownerOf = new Map<string, string>()
	for (const message of messages)
		if (message.role === 'assistant')
			for (const call of message.toolCalls ?? []) ownerOf.set(call.id, message.id)
	const placed = new Map<string, ToolMessage[]>()
	const rest: Message[] = []
	for (const message of messages) {
		const owner = message.role === 'tool' ? ownerOf.get(message.toolCallId) : undefined
		if (message.role === 'tool' && owner !== undefined) {
			placed.set(owner, [...(placed.get(owner) ?? []), message])
			continue
		}
		rest.push(message)
	}
	return rest.flatMap(message =>
		message.role === 'assistant' ? [message, ...(placed.get(message.id) ?? [])] : [message],
	)
}

/** The calls of the thread's assistant messages that no tool message answers, in order (spec §3.2 step 4, §6.2). */
export const unansweredToolCalls = (
	messages: readonly Message[],
): { toolCallId: string; name: string }[] => {
	const answered = new Set(
		messages.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : [])),
	)
	return messages.flatMap(message =>
		message.role === 'assistant'
			? (message.toolCalls ?? [])
					.filter(call => !answered.has(call.id))
					.map(call => ({ toolCallId: call.id, name: call.function.name }))
			: [],
	)
}

/** A tool message the hub writes to answer a call (AG-UI 1.0 `ToolMessage`: `content` required, `error` optional). */
export const errorToolMessage = (toolCallId: string, error: string, content: string): Message => ({
	id: crypto.randomUUID(),
	role: 'tool',
	toolCallId,
	content,
	error,
})

/**
 * A conversation's title from its first user message (spec §3.1): trimmed, its runs of white space folded into one
 * space so a title stays on one line, and cut at TITLE_MAX_LENGTH characters. A string iterates by code points
 * (MDN "String.prototype[Symbol.iterator]()"), so `Array.from` never splits a character made of a surrogate pair.
 */
export const titleFrom = (text: string): string =>
	Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, TITLE_MAX_LENGTH).join('').trimEnd()
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm exec vitest run --project unit __tests__/chat-thread.test.ts` Expected: PASS, 9 passed. Vitest does not type-check and erases `import type`, so `@/lib/data/conversations` (Step 7) is not loaded yet; tsc needs it, so the gates run after Step 8.

- [ ] **Step 5: Write the failing database test for the run's writes**

Create `__tests__/db/conversations-run.db.test.ts`:

```ts
import type { Message } from '@ag-ui/core'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})

import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'
import { errorToolMessage, STOPPED_TOOL_CONTENT, threadForAgent } from '@/lib/chat/thread'
import {
	finishRun,
	findConversation,
	lastRun,
	loadThread,
	saveMessages,
	saveState,
	startRun,
	truncateStaleRun,
	type RunKey,
} from '@/lib/data/conversations'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterEach(() => {
	vi.restoreAllMocks()
})
afterAll(() => pool.end())

const actorFor = (role: 'owner' | 'admin' | 'user' = 'user') => ({
	id: crypto.randomUUID(),
	email: `${crypto.randomUUID()}@example.com`,
	name: null,
	role,
	source: 'local' as const,
})
type Actor = ReturnType<typeof actorFor>

const insertAccount = (actor: Actor) =>
	testDb
		.insert(users)
		.values({ id: actor.id, email: actor.email, password: 'hash', role: actor.role })

const insertApp = async () => {
	const id = crypto.randomUUID()
	await testDb.insert(apps).values({ id, provider: 'dify', name: 'Tea', settings: {}, secrets: {} })
	return id
}

const userMessage = (content = 'Hello'): Message => ({
	id: crypto.randomUUID(),
	role: 'user',
	content,
})

/** A new conversation of `actor` in `appId`, started with one user message; answers its run key. */
const begin = async (actor: Actor, appId: string): Promise<RunKey> => {
	const result = await startRun(actor, {
		appId,
		conversation: { id: crypto.randomUUID(), title: 'Hello', isNew: true },
		runId: crypto.randomUUID(),
		messages: [userMessage()],
	})
	if (!result.ok) throw new Error(result.code)
	return result.key
}

/** The next run on an existing conversation. */
const next = (actor: Actor, appId: string, conversationId: string) =>
	startRun(actor, {
		appId,
		conversation: { id: conversationId },
		runId: crypto.randomUUID(),
		messages: [userMessage('Again')],
	})

const done = (key: RunKey) => finishRun(key, { status: 'succeeded', custom: [] })

describe('a run’s writes (Part 2 spec §3.2)', () => {
	let actor: Actor
	let appId: string
	beforeEach(async () => {
		actor = actorFor()
		await insertAccount(actor)
		appId = await insertApp()
	})

	it('starts a new conversation owned by the actor, with its run and the user message', async () => {
		const key = await begin(actor, appId)
		expect(await findConversation(actor, appId, key.conversationId)).toMatchObject({
			id: key.conversationId,
			appId,
			title: 'Hello',
			activeRunId: key.runId,
		})
		expect(await lastRun(key.conversationId)).toMatchObject({
			id: key.runId,
			status: 'running',
			error: null,
			custom: [],
			finishedAt: null,
		})
		expect(await loadThread(key.conversationId)).toMatchObject([
			{ runId: key.runId, role: 'user', status: 'complete', body: { content: 'Hello' } },
		])
	})

	it('refuses a conversation that is not the actor’s, of another app, or deleted', async () => {
		const key = await begin(actor, appId)
		await done(key)
		const stranger = actorFor()
		await insertAccount(stranger)
		expect(await next(stranger, appId, key.conversationId)).toEqual({
			ok: false,
			code: 'conversation_not_found',
		})
		expect(await next(actor, await insertApp(), key.conversationId)).toEqual({
			ok: false,
			code: 'conversation_not_found',
		})
		await testDb
			.update(conversations)
			.set({ deletedAt: new Date() })
			.where(eq(conversations.id, key.conversationId))
		expect(await next(actor, appId, key.conversationId)).toEqual({
			ok: false,
			code: 'conversation_not_found',
		})
	})

	it('refuses a run while one is active (run_in_progress)', async () => {
		const key = await begin(actor, appId)
		expect(await next(actor, appId, key.conversationId)).toEqual({
			ok: false,
			code: 'run_in_progress',
		})
	})

	// PostgreSQL 18 "Explicit Locking", 13.3.2: FOR UPDATE makes the second transaction wait for the first, then read the
	// active run the first one set.
	it('starts one run at a time: of two at once, one is refused with run_in_progress', async () => {
		const key = await begin(actor, appId)
		await done(key)
		const results = await Promise.all([
			next(actor, appId, key.conversationId),
			next(actor, appId, key.conversationId),
		])
		expect(results.filter(result => result.ok)).toHaveLength(1)
		expect(results.filter(result => !result.ok)).toEqual([{ ok: false, code: 'run_in_progress' }])
	})

	it('upserts a message by its id: the seq and the first run stay, the body and the status change', async () => {
		const first = await begin(actor, appId)
		const id = crypto.randomUUID()
		await saveMessages(first, [
			{ message: { id, role: 'assistant', content: 'Hel' }, status: 'streaming' },
		])
		const [before] = (await loadThread(first.conversationId)).filter(row => row.messageId === id)
		await done(first)
		const second = await next(actor, appId, first.conversationId)
		if (!second.ok) throw new Error(second.code)
		await saveMessages(second.key, [
			{ message: { id, role: 'assistant', content: 'Hello there' }, status: 'complete' },
		])
		const [after] = (await loadThread(first.conversationId)).filter(row => row.messageId === id)
		expect(after).toEqual({
			...before,
			body: { id, role: 'assistant', content: 'Hello there' },
			status: 'complete',
		})
	})

	it('never stores a message the AG-UI schema refuses, and logs only its ids', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const key = await begin(actor, appId)
		await saveMessages(key, [
			{
				message: { id: 'bad', role: 'assistant', content: 5 } as unknown as Message,
				status: 'complete',
			},
		])
		expect((await loadThread(key.conversationId)).map(row => row.messageId)).not.toContain('bad')
		expect(log).toHaveBeenCalledWith('Conversation message refused:', {
			conversationId: key.conversationId,
			runId: key.runId,
		})
	})

	it('finishes a run once: closes its open messages, answers its cut-off calls, clears the active run', async () => {
		const key = await begin(actor, appId)
		const assistantId = crypto.randomUUID()
		await saveMessages(key, [
			{
				message: {
					id: assistantId,
					role: 'assistant',
					content: 'Checking',
					toolCalls: [
						{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } },
					],
				},
				status: 'streaming',
			},
		])
		const [{ updatedAt: startedAt }] = await testDb
			.select({ updatedAt: conversations.updatedAt })
			.from(conversations)
			.where(eq(conversations.id, key.conversationId))
		const stopped = errorToolMessage('c1', 'stopped', STOPPED_TOOL_CONTENT)
		await finishRun(key, {
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }],
			close: { messageIds: [assistantId], toolMessages: [stopped] },
		})
		await finishRun(key, { status: 'failed', error: { message: 'late' }, custom: [] })
		const thread = await loadThread(key.conversationId)
		expect(thread.find(row => row.messageId === assistantId)?.status).toBe('incomplete')
		expect(thread.filter(row => row.role === 'tool')).toMatchObject([
			{ messageId: stopped.id, runId: key.runId, status: 'complete', body: stopped },
		])
		expect(await lastRun(key.conversationId)).toMatchObject({
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			error: null,
			custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }],
			finishedAt: expect.any(Date),
		})
		const conversation = await findConversation(actor, appId, key.conversationId)
		expect(conversation?.activeRunId).toBeNull()
		expect(conversation!.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt!.getTime())
	})

	// AG-UI "State": any JSON value, null included.
	it('stores the state the run left, null included', async () => {
		const key = await begin(actor, appId)
		await saveState(key, { steps: [{ description: 'Collect', status: 'pending' }] })
		expect((await findConversation(actor, appId, key.conversationId))?.state).toEqual({
			steps: [{ description: 'Collect', status: 'pending' }],
		})
		await saveState(key, null)
		expect((await findConversation(actor, appId, key.conversationId))?.state).toBeNull()
	})

	it('builds the agent’s thread from the store: no activity, each tool result after its call', async () => {
		const key = await begin(actor, appId)
		await saveMessages(key, [
			{
				message: {
					id: 'a1',
					role: 'assistant',
					toolCalls: [
						{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
					],
				},
				status: 'complete',
			},
			{ message: { id: 'a2', role: 'assistant', content: 'Done' }, status: 'complete' },
			{
				message: { id: 'act', role: 'activity', activityType: 'progress', content: { done: 1 } },
				status: 'complete',
			},
			{
				message: { id: 't1', role: 'tool', toolCallId: 'c1', content: '18 °C' },
				status: 'complete',
			},
		])
		expect(
			threadForAgent(await loadThread(key.conversationId))
				.map(m => m.id)
				.slice(1),
		).toEqual(['a1', 't1', 'a2'])
	})

	// Spec §3.2 step 5: a run stored as running that no process holds.
	it('truncates a run no process holds: its open messages, its cut-off calls, the active run', async () => {
		const key = await begin(actor, appId)
		await saveMessages(key, [
			{
				message: {
					id: 'a1',
					role: 'assistant',
					content: 'Half an ans',
					toolCalls: [
						{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } },
					],
				},
				status: 'streaming',
			},
		])
		await truncateStaleRun(key)
		const thread = await loadThread(key.conversationId)
		expect(thread.find(row => row.messageId === 'a1')?.status).toBe('incomplete')
		expect(thread.filter(row => row.role === 'tool').map(row => row.body)).toEqual([
			{
				id: expect.any(String),
				role: 'tool',
				toolCallId: 'c1',
				content: STOPPED_TOOL_CONTENT,
				error: 'stopped',
			},
		])
		expect((await lastRun(key.conversationId))?.status).toBe('truncated')
		expect((await findConversation(actor, appId, key.conversationId))?.activeRunId).toBeNull()
	})

	it('skips a stored row the AG-UI schema refuses, and logs only where it is', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const key = await begin(actor, appId)
		const { rows } = await pool.query<{ seq: string }>(
			"INSERT INTO conversation_messages (conversation_id, run_id, message_id, role, body, status) VALUES ($1, $2, 'broken', 'assistant', '{\"role\":\"assistant\"}', 'complete') RETURNING seq",
			[key.conversationId, key.runId],
		)
		expect((await loadThread(key.conversationId)).map(row => row.messageId)).not.toContain('broken')
		expect(log).toHaveBeenCalledWith('Stored conversation message refused:', {
			conversationId: key.conversationId,
			seq: Number(rows[0]!.seq),
		})
	})
})

describe('the run tables, read back as written', () => {
	it('keeps the run row and the user message under the run’s id', async () => {
		const actor = actorFor()
		await insertAccount(actor)
		const key = await begin(actor, await insertApp())
		const runs = await testDb
			.select({ id: conversationRuns.id })
			.from(conversationRuns)
			.where(eq(conversationRuns.conversationId, key.conversationId))
		const messages = await testDb
			.select({ runId: conversationMessages.runId })
			.from(conversationMessages)
			.where(eq(conversationMessages.conversationId, key.conversationId))
		expect(runs).toEqual([{ id: key.runId }])
		expect(messages).toEqual([{ runId: key.runId }])
	})
})
```

That is 12 cases (11 + 1).

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts` Expected: FAIL — `Failed to resolve import "@/lib/data/conversations"`.

- [ ] **Step 7: Write the run's half of the data layer**

Create `lib/data/conversations.ts`:

```ts
import 'server-only'

import type { Message } from '@ag-ui/core'
import { MessageSchema } from '@ag-ui/core/schemas'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import * as z from 'zod'

import { getDb } from '@/db'
import { conversationMessages, conversationRuns, conversations } from '@/db/schema'
import type { SessionUser } from '@/lib/auth/session'
import type { MessageRole, MessageStatus, RunStatus } from '@/lib/chat/statuses'
import {
	errorToolMessage,
	STOPPED_TOOL_CONTENT,
	STOPPED_TOOL_ERROR,
	unansweredToolCalls,
} from '@/lib/chat/thread'

/*
 * The conversation store's Data Access Layer (Part 2 spec §3, ADR-0024, ADR-0033). The reads and writes a user reaches
 * take the verified actor first and match only the actor's own conversation of the app, not deleted (spec §4.1:
 * otherwise 404 conversation_not_found); a run's later writes are keyed by the RunKey that startRun answered after it
 * checked the actor, and the daily purge takes no actor, as the directory sync's writes do. Every message is checked
 * with @ag-ui/core's MessageSchema on every write and every read (spec §3.1), as the apps' documents are checked with
 * their provider's schemas (decision 17): never stored, never answered half-typed. A refusal is logged by where it is,
 * never by what it holds (OWASP Logging Cheat Sheet, "Data to exclude").
 */

export interface RunError {
	code?: string
	message: string
}

export interface CustomRecord {
	name: string
	value: unknown
}

export interface ConversationRecord {
	id: string
	appId: string
	title: string
	state: unknown
	activeRunId: string | null
	updatedAt: Date
}

export interface StoredRun {
	id: string
	status: RunStatus
	/** RUN_FINISHED.outcome as received. */
	outcome: unknown
	error: RunError | null
	custom: CustomRecord[]
	startedAt: Date
	finishedAt: Date | null
}

export interface StoredMessage {
	seq: number
	messageId: string
	runId: string | null
	role: MessageRole
	body: Message
	status: MessageStatus
}

/** The handle startRun answers; the run's later writes are keyed by it (the actor was verified at the start). */
export interface RunKey {
	conversationId: string
	runId: string
}

const runErrorSchema = z.object({ code: z.string().optional(), message: z.string() })
// zod 4 "Unknown": "As object properties, their keys are required, matching `{ a: any }` in TypeScript", which is
// CustomRecord's shape; AG-UI's CUSTOM event requires `value` too ("Events", CUSTOM).
const customSchema = z.array(z.object({ name: z.string(), value: z.unknown() }))

const readRunError = (value: unknown): RunError | null => {
	const parsed = runErrorSchema.safeParse(value)
	return parsed.success ? parsed.data : null
}

const readCustom = (value: unknown): CustomRecord[] => {
	const parsed = customSchema.safeParse(value)
	return parsed.success ? parsed.data : []
}

/**
 * Whether a value is an AG-UI 1.0 message (`@ag-ui/core/schemas` MessageSchema, which keeps fields it does not know,
 * `encryptedValue` included: its objects are `z.looseObject`). The value itself is kept, typed, when it passes.
 */
const asMessage = (value: unknown): Message | null =>
	MessageSchema.safeParse(value).success ? (value as Message) : null

const conversationColumns = {
	id: conversations.id,
	appId: conversations.appId,
	title: conversations.title,
	state: conversations.state,
	activeRunId: conversations.activeRunId,
	updatedAt: conversations.updatedAt,
}

const runColumns = {
	id: conversationRuns.id,
	status: conversationRuns.status,
	outcome: conversationRuns.outcome,
	error: conversationRuns.error,
	custom: conversationRuns.custom,
	startedAt: conversationRuns.startedAt,
	finishedAt: conversationRuns.finishedAt,
}

const messageColumns = {
	seq: conversationMessages.seq,
	messageId: conversationMessages.messageId,
	runId: conversationMessages.runId,
	role: conversationMessages.role,
	body: conversationMessages.body,
	status: conversationMessages.status,
}

type RunRow = Omit<StoredRun, 'error' | 'custom'> & { error: unknown; custom: unknown }

const toStoredRun = (row: RunRow): StoredRun => ({
	...row,
	error: readRunError(row.error),
	custom: readCustom(row.custom),
})

type MessageRow = Omit<StoredMessage, 'body'> & { body: unknown }

/** The rows whose body reads as an AG-UI message; another is skipped and logged by its place (spec §3.1). */
const readMessages = (conversationId: string, rows: readonly MessageRow[]): StoredMessage[] =>
	rows.flatMap(row => {
		const body = asMessage(row.body)
		if (body) return [{ ...row, body }]
		console.error('Stored conversation message refused:', { conversationId, seq: row.seq })
		return []
	})

/** The actor's own conversation of the app, not deleted (spec §4.1): the only conversation a user's request reaches. */
const ownedBy = (actor: Pick<SessionUser, 'id'>, appId: string, conversationId: string) =>
	and(
		eq(conversations.id, conversationId),
		eq(conversations.appId, appId),
		eq(conversations.userId, actor.id),
		isNull(conversations.deletedAt),
	)

/** The actor's conversation of this app, or null when it is missing, another's, of another app, or deleted. */
export async function findConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<ConversationRecord | null> {
	const [row] = await getDb()
		.select(conversationColumns)
		.from(conversations)
		.where(ownedBy(actor, appId, conversationId))
		.limit(1)
	return row ?? null
}

/** The conversation's newest run (spec §4.3 step 1 reads its open interrupts), or null before the first. */
export async function lastRun(conversationId: string): Promise<StoredRun | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(conversationRuns)
		.where(eq(conversationRuns.conversationId, conversationId))
		.orderBy(desc(conversationRuns.startedAt), desc(conversationRuns.id))
		.limit(1)
	return row ? toStoredRun(row) : null
}

/** Every stored message of the conversation in `seq` order (spec §3.3: what the next RunAgentInput is built from). */
export async function loadThread(conversationId: string): Promise<StoredMessage[]> {
	const rows = await getDb()
		.select(messageColumns)
		.from(conversationMessages)
		.where(eq(conversationMessages.conversationId, conversationId))
		.orderBy(asc(conversationMessages.seq))
	return readMessages(conversationId, rows)
}

export interface StartRunInput {
	appId: string
	/** An existing conversation (already found for this actor), or a new one with the hub's id and the message's title. */
	conversation: { id: string } | { id: string; title: string; isNew: true }
	runId: string
	/** Inserted with run_id = runId, status complete, in this order: the answers' or the hub's tool messages, then the user message. */
	messages: Message[]
	resume?: unknown
}

export type StartRunResult =
	| { ok: true; key: RunKey }
	| { ok: false; code: 'run_in_progress' | 'conversation_not_found' }

/**
 * Spec §3.2 step 1, in one transaction: a new conversation is created owned by the actor; an existing one is locked
 * (PostgreSQL 18 "Explicit Locking", 13.3.2: FOR UPDATE "prevents them from being locked, modified or deleted by other
 * transactions until the current transaction ends"), so of two runs started at once the second reads the active run
 * the first set and is refused with run_in_progress. Then the given messages, one INSERT each in order, so their `seq`
 * follows the order given (an identity column draws from a sequence: PostgreSQL 18 "CREATE TABLE", "nextval"); the run
 * as running with the answers it was started with; the conversation's active run and last activity. A message the
 * AG-UI schema refuses is the hub's own fault here (the hub built it), so it throws before anything is written.
 */
export async function startRun(actor: SessionUser, input: StartRunInput): Promise<StartRunResult> {
	if (input.messages.some(message => !asMessage(message)))
		throw new Error('startRun: a message the hub built is not an AG-UI message')
	const conversationId = input.conversation.id
	const now = new Date()
	return getDb().transaction(async (tx): Promise<StartRunResult> => {
		if ('isNew' in input.conversation) {
			await tx.insert(conversations).values({
				id: conversationId,
				appId: input.appId,
				userId: actor.id,
				title: input.conversation.title,
				createdAt: now,
				updatedAt: now,
			})
		} else {
			const [locked] = await tx
				.select({ activeRunId: conversations.activeRunId })
				.from(conversations)
				.where(ownedBy(actor, input.appId, conversationId))
				.limit(1)
				.for('update')
			if (!locked) return { ok: false, code: 'conversation_not_found' }
			if (locked.activeRunId) return { ok: false, code: 'run_in_progress' }
		}
		await tx.insert(conversationRuns).values({
			id: input.runId,
			conversationId,
			status: 'running',
			resume: input.resume ?? null,
		})
		for (const message of input.messages)
			await tx.insert(conversationMessages).values({
				conversationId,
				runId: input.runId,
				messageId: message.id,
				role: message.role,
				body: message,
				status: 'complete',
				createdAt: now,
				updatedAt: now,
			})
		await tx
			.update(conversations)
			.set({ activeRunId: input.runId, updatedAt: now })
			.where(eq(conversations.id, conversationId))
		return { ok: true, key: { conversationId, runId: input.runId } }
	})
}

/**
 * Spec §3.2 step 2: each message upserted by its AG-UI id (PostgreSQL 18 "INSERT", ON CONFLICT … DO UPDATE, with
 * EXCLUDED for "the row proposed for insertion"; Drizzle "Upsert Query", `sql.raw(\`excluded.${column.name}\`)`). A new
 * message is numbered after the others; an existing one keeps its `seq` and the run that first wrote it, and takes the
 * new body and status. In one transaction, in the order given (the agent's message list), so one flush is all or
 * nothing. A message the AG-UI schema refuses is not written, and logged by the run's ids.
 */
export async function saveMessages(
	key: RunKey,
	rows: { message: Message; status: MessageStatus }[],
): Promise<void> {
	const accepted = rows.filter(({ message }) => {
		if (asMessage(message)) return true
		console.error('Conversation message refused:', {
			conversationId: key.conversationId,
			runId: key.runId,
		})
		return false
	})
	if (!accepted.length) return
	const now = new Date()
	await getDb().transaction(async tx => {
		for (const { message, status } of accepted)
			await tx
				.insert(conversationMessages)
				.values({
					conversationId: key.conversationId,
					runId: key.runId,
					messageId: message.id,
					role: message.role,
					body: message,
					status,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [conversationMessages.conversationId, conversationMessages.messageId],
					set: {
						body: sql.raw(`excluded.${conversationMessages.body.name}`),
						status: sql.raw(`excluded.${conversationMessages.status.name}`),
						updatedAt: sql.raw(`excluded.${conversationMessages.updatedAt.name}`),
					},
				})
	})
}

/**
 * Spec §3.2 step 2: the agent's state, written when it changes. AG-UI state is any JSON value, null included ("State");
 * Drizzle writes a JS null as SQL NULL, which the NOT NULL column refuses, so the value goes as JSON text cast to jsonb
 * (PostgreSQL 18 "JSON Types": `'null'::jsonb` is the JSON null).
 */
export async function saveState(key: RunKey, state: unknown): Promise<void> {
	await getDb()
		.update(conversations)
		.set({ state: sql`${JSON.stringify(state ?? null)}::jsonb` })
		.where(eq(conversations.id, key.conversationId))
}

export interface RunEnd {
	status: Exclude<RunStatus, 'running'>
	outcome?: unknown
	error?: RunError
	usage?: unknown
	custom: CustomRecord[]
	/** Stop, failure or truncation (spec §3.2 step 4): rows to mark incomplete, and the tool messages that answer cut-off calls. */
	close?: { messageIds: string[]; toolMessages: Message[] }
}

/**
 * Spec §3.2 steps 3 and 4, in one transaction and once: the run row is ended only while it is still running (an UPDATE
 * … WHERE status = 'running' RETURNING, so a second call, or a stale-run check racing the run's own end, writes
 * nothing); then the rows `close` names become incomplete and its tool messages are added under the run; the
 * conversation's active run is cleared where it is still this one, and its last activity is touched.
 */
export async function finishRun(key: RunKey, end: RunEnd): Promise<void> {
	const now = new Date()
	await getDb().transaction(async tx => {
		const ended = await tx
			.update(conversationRuns)
			.set({
				status: end.status,
				outcome: end.outcome ?? null,
				error: end.error ?? null,
				usage: end.usage ?? null,
				custom: end.custom,
				finishedAt: now,
			})
			.where(
				and(
					eq(conversationRuns.id, key.runId),
					eq(conversationRuns.conversationId, key.conversationId),
					eq(conversationRuns.status, 'running'),
				),
			)
			.returning({ id: conversationRuns.id })
		if (!ended.length) return
		const messageIds = end.close?.messageIds ?? []
		if (messageIds.length)
			await tx
				.update(conversationMessages)
				.set({ status: 'incomplete', updatedAt: now })
				.where(
					and(
						eq(conversationMessages.conversationId, key.conversationId),
						inArray(conversationMessages.messageId, messageIds),
					),
				)
		for (const message of end.close?.toolMessages ?? [])
			await tx.insert(conversationMessages).values({
				conversationId: key.conversationId,
				runId: key.runId,
				messageId: message.id,
				role: message.role,
				body: message,
				status: 'complete',
				createdAt: now,
				updatedAt: now,
			})
		await tx
			.update(conversations)
			.set({ activeRunId: null, updatedAt: now })
			.where(
				and(eq(conversations.id, key.conversationId), eq(conversations.activeRunId, key.runId)),
			)
	})
}

/**
 * Spec §3.2 step 5: a run stored as running that no process holds (the server stopped mid-run) becomes truncated. What
 * it left open is closed as a stop closes it (step 4): its streaming rows become incomplete, and each call of its own
 * assistant messages without a result is answered as stopped. Calls of earlier runs are not this run's to answer.
 */
export async function truncateStaleRun(key: RunKey): Promise<void> {
	const thread = await loadThread(key.conversationId)
	const own = thread.filter(row => row.runId === key.runId)
	const ownCalls = new Set(
		own.flatMap(row =>
			row.body.role === 'assistant' ? (row.body.toolCalls ?? []).map(call => call.id) : [],
		),
	)
	await finishRun(key, {
		status: 'truncated',
		custom: [],
		close: {
			messageIds: own.filter(row => row.status === 'streaming').map(row => row.messageId),
			toolMessages: unansweredToolCalls(thread.map(row => row.body))
				.filter(call => ownCalls.has(call.toolCallId))
				.map(call => errorToolMessage(call.toolCallId, STOPPED_TOOL_ERROR, STOPPED_TOOL_CONTENT)),
		},
	})
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-thread.test.ts && pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts` Expected: PASS — 9 passed, then 12 passed.

If "upserts a message by its id" fails because `after` differs from `before` in `runId`, the upsert's `set` is updating `run_id`: it must name only `body`, `status` and `updated_at`.

- [ ] **Step 9: Run the gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/thread.ts lib/data/conversations.ts __tests__/chat-thread.test.ts __tests__/db/conversations-run.db.test.ts
pnpm exec oxfmt --check lib/chat/thread.ts lib/data/conversations.ts __tests__/chat-thread.test.ts __tests__/db/conversations-run.db.test.ts
pnpm test
pnpm test:db
```

Expected: no tsc error, no oxlint finding, oxfmt clean, both suites passed. (If oxfmt reports the files, run `pnpm exec oxfmt <files>` and re-run the check.)

- [ ] **Step 10: Commit**

```bash
git add lib/chat/thread.ts lib/data/conversations.ts __tests__/chat-thread.test.ts __tests__/db/conversations-run.db.test.ts
git commit -m "feat(chat): write a run's conversation, messages and end

startRun holds one active run per conversation, saveMessages upserts AG-UI messages by
id, finishRun closes what a stop or a failure left open, once, and truncateStaleRun ends
a run no process holds (Part 2 spec §3.2). threadForAgent builds the next run's history.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/thread.ts", "lib/data/conversations.ts", "__tests__/chat-thread.test.ts", "__tests__/db/conversations-run.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-thread.test.ts && pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts", "acceptanceCriteria": ["chat-thread.test.ts reports 9 passed", "conversations-run.db.test.ts reports 12 passed, including 'starts one run at a time: of two at once, one is refused with run_in_progress'", "a refused message is never stored and is logged with { conversationId, runId } only; a refused stored row is skipped and logged with { conversationId, seq } only", "a second finishRun for the same run changes nothing", "tsc, oxlint, oxfmt clean; pnpm test and pnpm test:db green"], "modelTier": "standard"}
```

---

### Task 7: Reading, renaming, deleting and purging conversations

**Goal:** `lib/data/conversations.ts` answers the user's conversation list (newest first, keyset-paged), a page of a conversation's history by whole turns, renames and soft-deletes the actor's own conversation, and purges conversations deleted more than 30 days ago, proven on a live PostgreSQL.

Spec §3.3 (reading), §3.4 (deletion and retention), §4.2 (`GET conversations` "newest first, keyset-paged on `(updated_at, id)`, not deleted"; `GET conversations/[conversationId]` "the latest turns with a 'load earlier' cursor"); plan call P8 (20 turns a page, the cursor is the `seq` of the oldest user message shown; the list's newest 100). A rename takes the title's own limit, `TITLE_MAX_LENGTH` (80 characters): spec §3.1 sets that length for a title and is silent on a renamed one, and one rule keeps every title on one line of the sidebar (plan note; Task 12's action checks it). Every id reaching these functions is a UUID already (the routes check them, Task 11).

**Files:**

- Modify: `lib/data/conversations.ts` (the import block; new code after `truncateStaleRun`)
- Create: `__tests__/db/conversations-read.db.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts` reports 10 passed.
- [ ] The list holds only the actor's conversations of the app that are not deleted, newest first, ties by id descending; following `nextCursor` gives every conversation once and ends with `nextCursor: null`; a cursor that does not decode gives an empty page.
- [ ] A history page starts at a user message: `turns: 2` over a three-turn conversation answers the last two turns with `cursor` = the second user message's `seq`; `before: Number(cursor)` answers the first turn with `cursor: null`; its runs include a run that wrote no message.
- [ ] A rename or a soft delete leaves `updated_at` as it was; neither reaches another account's conversation, another app's, or a deleted one.
- [ ] The purge deletes only conversations deleted more than 30 days before `now`, with their runs and messages, and answers how many.
- [ ] tsc, oxlint, oxfmt clean; `pnpm test` and `pnpm test:db` green.

**Verify:** `pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts` → 10 passed.

**Steps:**

- [ ] **Step 1: Write the failing database test**

Create `__tests__/db/conversations-read.db.test.ts`:

```ts
import type { Message } from '@ag-ui/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})

import { apps, conversationMessages, conversationRuns, conversations, users } from '@/db/schema'
import {
	decodeListCursor,
	encodeListCursor,
	findConversation,
	listConversations,
	purgeDeletedConversations,
	readThreadPage,
	renameConversation,
	softDeleteConversation,
} from '@/lib/data/conversations'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

const DAY_MS = 24 * 60 * 60 * 1000

const actorFor = () => ({
	id: crypto.randomUUID(),
	email: `${crypto.randomUUID()}@example.com`,
	name: null,
	role: 'user' as const,
	source: 'local' as const,
})
type Actor = ReturnType<typeof actorFor>

const insertAccount = async (actor: Actor) => {
	await testDb
		.insert(users)
		.values({ id: actor.id, email: actor.email, password: 'hash', role: 'user' })
	return actor
}

const insertApp = async () => {
	const id = crypto.randomUUID()
	await testDb.insert(apps).values({ id, provider: 'dify', name: 'Tea', settings: {}, secrets: {} })
	return id
}

/** A conversation written as the store writes one, with the given last activity. */
const insertConversation = async (
	actor: Actor,
	appId: string,
	over: Partial<typeof conversations.$inferInsert> = {},
) => {
	const id = over.id ?? crypto.randomUUID()
	await testDb
		.insert(conversations)
		.values({ id, appId, userId: actor.id, title: 'Chat', updatedAt: new Date(), ...over })
	return id
}

const insertRun = async (conversationId: string, startedAt: Date) => {
	const id = crypto.randomUUID()
	await testDb
		.insert(conversationRuns)
		.values({ id, conversationId, status: 'succeeded', startedAt, finishedAt: startedAt })
	return id
}

const insertMessage = async (conversationId: string, runId: string, body: Message) => {
	const [row] = await testDb
		.insert(conversationMessages)
		.values({
			conversationId,
			runId,
			messageId: body.id,
			role: body.role,
			body,
			status: 'complete',
		})
		.returning({ seq: conversationMessages.seq })
	return row!.seq
}

/** One turn: a run started at `startedAt`, its user message and the assistant's answer. Answers the user message's seq. */
const insertTurn = async (conversationId: string, startedAt: Date, text: string) => {
	const runId = await insertRun(conversationId, startedAt)
	const seq = await insertMessage(conversationId, runId, {
		id: crypto.randomUUID(),
		role: 'user',
		content: text,
	})
	await insertMessage(conversationId, runId, {
		id: crypto.randomUUID(),
		role: 'assistant',
		content: `Re: ${text}`,
	})
	return { runId, seq }
}

describe('the conversation list (spec §4.2)', () => {
	it('lists the actor’s conversations of the app, newest first, without deleted ones or others’', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const otherApp = await insertApp()
		const now = Date.now()
		const old = await insertConversation(actor, appId, { updatedAt: new Date(now - 3000) })
		const recent = await insertConversation(actor, appId, { updatedAt: new Date(now - 1000) })
		await insertConversation(actor, appId, { deletedAt: new Date() })
		await insertConversation(stranger, appId)
		await insertConversation(actor, otherApp)
		const page = await listConversations(actor, appId, { limit: 100 })
		expect(page.items.map(item => item.id)).toEqual([recent, old])
		expect(page.items[0]).toEqual({
			id: recent,
			title: 'Chat',
			updatedAt: new Date(now - 1000).toISOString(),
		})
		expect(page.nextCursor).toBeNull()
	})

	// PostgreSQL 18 "Row Constructor Comparison": (a, b) < (c, d) compares left to right, so equal updated_at values are
	// ordered by id and no conversation is skipped or repeated across pages.
	it('pages with a keyset cursor on (updated_at, id): every conversation once, ties by id', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const tie = new Date(Date.now() - 5000)
		const ids = [
			await insertConversation(actor, appId, { updatedAt: tie }),
			await insertConversation(actor, appId, { updatedAt: tie }),
			await insertConversation(actor, appId, { updatedAt: new Date(tie.getTime() - 1) }),
		]
		const first = await listConversations(actor, appId, { limit: 2 })
		expect(first.nextCursor).not.toBeNull()
		const second = await listConversations(actor, appId, { cursor: first.nextCursor!, limit: 2 })
		expect(second.nextCursor).toBeNull()
		const seen = [...first.items, ...second.items].map(item => item.id)
		const tied = ids.slice(0, 2).sort().reverse()
		expect(seen).toEqual([...tied, ids[2]])
	})

	it('answers an empty page for a cursor that does not decode, and decodes its own cursors', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		await insertConversation(actor, appId)
		expect(await listConversations(actor, appId, { cursor: 'not-a-cursor', limit: 10 })).toEqual({
			items: [],
			nextCursor: null,
		})
		const at = new Date('2026-10-14T10:00:00.123Z')
		const id = crypto.randomUUID()
		expect(decodeListCursor(encodeListCursor(at, id))).toEqual({ updatedAt: at, id })
		expect(decodeListCursor(Buffer.from('["yesterday","x"]').toString('base64url'))).toBeNull()
	})
})

describe('a page of history (spec §3.3, plan call P8)', () => {
	it('answers the latest turns from a user message on, and a cursor to the older ones', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const base = Date.now() - 60_000
		const turn1 = await insertTurn(conversationId, new Date(base), 'one')
		const turn2 = await insertTurn(conversationId, new Date(base + 1000), 'two')
		// A run that wrote no message (refused before its stream) after the second turn's.
		const silent = await insertRun(conversationId, new Date(base + 1500))
		const turn3 = await insertTurn(conversationId, new Date(base + 2000), 'three')

		const latest = await readThreadPage(actor, appId, conversationId, { turns: 2 })
		expect(latest?.cursor).toBe(String(turn2.seq))
		expect(latest?.rows.map(row => row.body.role)).toEqual([
			'user',
			'assistant',
			'user',
			'assistant',
		])
		expect(latest?.rows[0]!.seq).toBe(turn2.seq)
		expect(latest?.runs.map(run => run.id)).toEqual([turn2.runId, silent, turn3.runId])
		expect(latest?.conversation.id).toBe(conversationId)

		const older = await readThreadPage(actor, appId, conversationId, {
			before: Number(latest!.cursor),
			turns: 2,
		})
		expect(older?.cursor).toBeNull()
		expect(older?.rows.map(row => row.seq)).toEqual([turn1.seq, turn1.seq + 1])
		expect(older?.runs.map(run => run.id)).toEqual([turn1.runId])
	})

	it('answers null for another account’s conversation, another app’s, or a deleted one', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		const deleted = await insertConversation(actor, appId, { deletedAt: new Date() })
		expect(await readThreadPage(stranger, appId, conversationId, { turns: 20 })).toBeNull()
		expect(await readThreadPage(actor, await insertApp(), conversationId, { turns: 20 })).toBeNull()
		expect(await readThreadPage(actor, appId, deleted, { turns: 20 })).toBeNull()
	})

	it('answers an empty page for a conversation without messages', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const conversationId = await insertConversation(actor, appId)
		expect(await readThreadPage(actor, appId, conversationId, { turns: 20 })).toMatchObject({
			rows: [],
			runs: [],
			cursor: null,
		})
	})
})

describe('rename and delete (spec §4.2, §3.4)', () => {
	it('renames the actor’s conversation, trimmed, and leaves its last activity as it was', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const updatedAt = new Date(Date.now() - 10_000)
		const id = await insertConversation(actor, appId, { updatedAt })
		expect(await renameConversation(actor, appId, id, '  Trip plans ')).toBe(true)
		expect(await findConversation(actor, appId, id)).toMatchObject({
			title: 'Trip plans',
			updatedAt,
		})
	})

	it('renames and deletes nothing of another account, another app, or already deleted', async () => {
		const actor = await insertAccount(actorFor())
		const stranger = await insertAccount(actorFor())
		const appId = await insertApp()
		const id = await insertConversation(actor, appId)
		expect(await renameConversation(stranger, appId, id, 'Mine')).toBe(false)
		expect(await softDeleteConversation(stranger, appId, id)).toBe(false)
		expect(await renameConversation(actor, await insertApp(), id, 'Mine')).toBe(false)
		expect(await softDeleteConversation(actor, appId, id)).toBe(true)
		expect(await softDeleteConversation(actor, appId, id)).toBe(false)
		expect(await renameConversation(actor, appId, id, 'Mine')).toBe(false)
	})

	it('soft-deletes: the conversation leaves the list at once, its runs and messages stay', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const updatedAt = new Date(Date.now() - 10_000)
		const id = await insertConversation(actor, appId, { updatedAt })
		await insertTurn(id, new Date(), 'hello')
		expect(await softDeleteConversation(actor, appId, id)).toBe(true)
		expect((await listConversations(actor, appId, { limit: 100 })).items).toEqual([])
		expect(await findConversation(actor, appId, id)).toBeNull()
		const [row] = await testDb
			.select({ deletedAt: conversations.deletedAt, updatedAt: conversations.updatedAt })
			.from(conversations)
			.where(eq(conversations.id, id))
		expect(row?.deletedAt).toBeInstanceOf(Date)
		expect(row?.updatedAt).toEqual(updatedAt)
		const messages = await testDb
			.select({ seq: conversationMessages.seq })
			.from(conversationMessages)
			.where(eq(conversationMessages.conversationId, id))
		expect(messages).toHaveLength(2)
	})
})

describe('the purge (spec §3.4)', () => {
	it('deletes conversations deleted more than 30 days ago, with their runs and messages, and counts them', async () => {
		const actor = await insertAccount(actorFor())
		const appId = await insertApp()
		const now = new Date('2026-11-20T03:00:00Z')
		const expired = await insertConversation(actor, appId, {
			deletedAt: new Date(now.getTime() - 31 * DAY_MS),
		})
		await insertTurn(expired, new Date(now.getTime() - 40 * DAY_MS), 'old')
		const recent = await insertConversation(actor, appId, {
			deletedAt: new Date(now.getTime() - 29 * DAY_MS),
		})
		const live = await insertConversation(actor, appId)
		expect(await purgeDeletedConversations(now)).toBe(1)
		const left = await testDb.select({ id: conversations.id }).from(conversations)
		expect(left.map(row => row.id).sort()).toEqual([recent, live].sort())
		const { rows } = await pool.query<{ runs: string; messages: string }>(
			'SELECT (SELECT count(*) FROM conversation_runs WHERE conversation_id = $1) AS runs, (SELECT count(*) FROM conversation_messages WHERE conversation_id = $1) AS messages',
			[expired],
		)
		expect(rows[0]).toEqual({ runs: '0', messages: '0' })
	})
})
```

That is 10 cases: the list 3, a page of history 3, rename and delete 3, the purge 1.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts` Expected: FAIL — `decodeListCursor`, `listConversations`, `readThreadPage`, … are not exported by `@/lib/data/conversations` (`TypeError: … is not a function`).

- [ ] **Step 3: Widen the import block**

In `lib/data/conversations.ts`, replace the `drizzle-orm` and `@/lib/chat/statuses` imports (as of Task 6) with:

```ts
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
```

```ts
import {
	PURGE_AFTER_DAYS,
	type MessageRole,
	type MessageStatus,
	type RunStatus,
} from '@/lib/chat/statuses'
```

- [ ] **Step 4: Write the browser's reads, rename, delete and the purge**

Append to `lib/data/conversations.ts`, after `truncateStaleRun`:

```ts
/* ----- The browser's reads, rename and delete (spec §3.3, §3.4, §4.2) ----- */

/** Plan call P8: the list answers at most the newest 100 conversations a page (Dify's sidebar limit). */
export const LIST_PAGE_MAX = 100

/** Plan call P8: a history page holds the latest 20 user turns and what follows each. */
export const THREAD_PAGE_TURNS = 20

export interface ConversationListItem {
	id: string
	title: string
	/** ISO 8601 (Date.prototype.toISOString). */
	updatedAt: string
}

const listCursorSchema = z.tuple([z.iso.datetime(), z.uuid()])

/**
 * The list's keyset cursor (spec §4.2: "keyset-paged on `(updated_at, id)`"): the last item's two keys as JSON, in
 * base64url so the browser carries it as one opaque query value (Node.js "Buffer", 'base64url' encoding). A conversation's
 * `updated_at` always comes from a JS Date (db/schema/conversations.ts), so the millisecond ISO string is its exact value.
 */
export const encodeListCursor = (updatedAt: Date, id: string): string =>
	Buffer.from(JSON.stringify([updatedAt.toISOString(), id])).toString('base64url')

/** The cursor's two keys, or null for anything this module did not write (zod 4 `z.iso.datetime()`, `z.uuid()`). */
export const decodeListCursor = (value: string): { updatedAt: Date; id: string } | null => {
	let raw: unknown
	try {
		raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
	} catch {
		return null
	}
	const parsed = listCursorSchema.safeParse(raw)
	return parsed.success ? { updatedAt: new Date(parsed.data[0]), id: parsed.data[1] } : null
}

/**
 * The actor's conversations of the app, not deleted, newest first (spec §4.2), on the `(user_id, app_id, updated_at)`
 * index (spec §3.1). The keyset condition is a row comparison, `(updated_at, id) < (cursor)`, which compares left to
 * right (PostgreSQL 18 "Row Constructor Comparison"), so ties on `updated_at` go by id and no row is skipped or
 * repeated; one row more than the page tells whether another page follows. A cursor that does not decode answers an
 * empty page (the route refuses one first, Task 11).
 */
export async function listConversations(
	actor: SessionUser,
	appId: string,
	page: { cursor?: string; limit: number },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(Math.trunc(page.limit), 1), LIST_PAGE_MAX)
	const after = page.cursor === undefined ? null : decodeListCursor(page.cursor)
	if (page.cursor !== undefined && !after) return { items: [], nextCursor: null }
	const rows = await getDb()
		.select({
			id: conversations.id,
			title: conversations.title,
			updatedAt: conversations.updatedAt,
		})
		.from(conversations)
		.where(
			and(
				eq(conversations.userId, actor.id),
				eq(conversations.appId, appId),
				isNull(conversations.deletedAt),
				after
					? sql`(${conversations.updatedAt}, ${conversations.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`
					: undefined,
			),
		)
		.orderBy(desc(conversations.updatedAt), desc(conversations.id))
		.limit(limit + 1)
	const items = rows.slice(0, limit)
	const last = items.at(-1)
	return {
		items: items.map(row => ({
			id: row.id,
			title: row.title,
			updatedAt: row.updatedAt.toISOString(),
		})),
		nextCursor: rows.length > limit && last ? encodeListCursor(last.updatedAt, last.id) : null,
	}
}

export interface ThreadPage {
	conversation: ConversationRecord
	rows: StoredMessage[]
	runs: StoredRun[]
	/** The seq of the oldest user message shown, as a string; null when nothing is older (plan call P8). */
	cursor: string | null
}

/**
 * A page of the actor's conversation (spec §3.3, §4.2; plan call P8): the latest `turns` user messages before `before`
 * (a `seq`), and every row from the oldest of them on, so a page holds whole turns; the cursor names that oldest user
 * message while an older one exists. The runs are the ones started from that user message's run on (and before
 * `before`'s), message-less runs included, such as one the agent refused before its stream, so each turn shows every
 * run that answered it. Null when the conversation is not the actor's of this app, or deleted.
 */
export async function readThreadPage(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	page: { before?: number; turns: number },
): Promise<ThreadPage | null> {
	const conversation = await findConversation(actor, appId, conversationId)
	if (!conversation) return null
	const db = getDb()
	const inConversation = eq(conversationMessages.conversationId, conversationId)
	const beforeCursor =
		page.before === undefined ? undefined : lt(conversationMessages.seq, page.before)
	const starts = await db
		.select({ seq: conversationMessages.seq })
		.from(conversationMessages)
		.where(and(inConversation, eq(conversationMessages.role, 'user'), beforeCursor))
		.orderBy(desc(conversationMessages.seq))
		.limit(page.turns + 1)
	const first = starts.slice(0, page.turns).at(-1)?.seq
	if (first === undefined) return { conversation, rows: [], runs: [], cursor: null }
	const rows = readMessages(
		conversationId,
		await db
			.select(messageColumns)
			.from(conversationMessages)
			.where(and(inConversation, gte(conversationMessages.seq, first), beforeCursor))
			.orderBy(asc(conversationMessages.seq)),
	)
	/** When the run of the user message at `seq` started; undefined when it has none. */
	const runStart = async (seq: number) => {
		const [row] = await db
			.select({ startedAt: conversationRuns.startedAt })
			.from(conversationMessages)
			.innerJoin(conversationRuns, eq(conversationRuns.id, conversationMessages.runId))
			.where(and(inConversation, eq(conversationMessages.seq, seq)))
			.limit(1)
		return row?.startedAt
	}
	const from = await runStart(first)
	const to = page.before === undefined ? undefined : await runStart(page.before)
	const runs = await db
		.select(runColumns)
		.from(conversationRuns)
		.where(
			and(
				eq(conversationRuns.conversationId, conversationId),
				from ? gte(conversationRuns.startedAt, from) : undefined,
				to ? lt(conversationRuns.startedAt, to) : undefined,
			),
		)
		.orderBy(asc(conversationRuns.startedAt), asc(conversationRuns.id))
	return {
		conversation,
		rows,
		runs: runs.map(toStoredRun),
		cursor: starts.length > page.turns ? String(first) : null,
	}
}

/**
 * Renames the actor's conversation (spec §4.2, a Server Action's write: Task 12 checks the title, at most
 * TITLE_MAX_LENGTH characters). Only the title: a rename is not activity, so `updated_at` stays (spec §3.1). False when
 * no such conversation is the actor's (node-postgres "Result": `rowCount` may be null).
 */
export async function renameConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
	title: string,
): Promise<boolean> {
	const result = await getDb()
		.update(conversations)
		.set({ title: title.trim() })
		.where(ownedBy(actor, appId, conversationId))
	return (result.rowCount ?? 0) > 0
}

/**
 * The user's delete (spec §3.4; decision 49): sets `deleted_at`, so the conversation leaves the user's list at once;
 * its runs and messages stay for the admins' Logs (2c) until the purge. A second delete answers false.
 */
export async function softDeleteConversation(
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<boolean> {
	const result = await getDb()
		.update(conversations)
		.set({ deletedAt: new Date() })
		.where(ownedBy(actor, appId, conversationId))
	return (result.rowCount ?? 0) > 0
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The daily job's delete (spec §3.4; lib/chat/purge.ts runs it): conversations deleted more than PURGE_AFTER_DAYS
 * before `now`; their runs and messages go with them (ON DELETE CASCADE, PostgreSQL 18 "Foreign Keys"). `deleted_at <
 * cutoff` is never true for a NULL `deleted_at` (PostgreSQL 18 "Comparison Operators": a comparison with NULL yields
 * NULL), so a conversation that was not deleted is never purged. No actor: the system runs it, as the directory sync
 * writes. Answers how many were deleted.
 */
export async function purgeDeletedConversations(now: Date = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS)
	const result = await getDb().delete(conversations).where(lt(conversations.deletedAt, cutoff))
	return result.rowCount ?? 0
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts` Expected: PASS, 10 passed.

- [ ] **Step 6: Run the gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/conversations.ts __tests__/db/conversations-read.db.test.ts
pnpm exec oxfmt --check lib/data/conversations.ts __tests__/db/conversations-read.db.test.ts
pnpm test
pnpm test:db
```

Expected: no tsc error, no oxlint finding, oxfmt clean, both suites passed.

- [ ] **Step 7: Commit**

```bash
git add lib/data/conversations.ts __tests__/db/conversations-read.db.test.ts
git commit -m "feat(chat): read, rename, delete and purge conversations

The user's list, keyset-paged on (updated_at, id); a history page of whole turns with a
cursor to older ones; rename and soft delete of the actor's own conversation, which leave
its last activity; and the purge of conversations deleted over 30 days ago (Part 2 spec
§3.3, §3.4, §4.2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/data/conversations.ts", "__tests__/db/conversations-read.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project db __tests__/db/conversations-read.db.test.ts", "acceptanceCriteria": ["conversations-read.db.test.ts reports 10 passed", "the list holds only the actor's non-deleted conversations of the app, newest first, ties by id descending; following nextCursor gives each once and ends with null; an undecodable cursor gives an empty page", "turns: 2 over three turns answers the last two with cursor = the second user message's seq; before: Number(cursor) answers the first with cursor null; runs include a run that wrote no message", "rename and soft delete leave updated_at unchanged and never reach another account's, another app's or a deleted conversation", "the purge deletes only conversations deleted over 30 days before now, with their runs and messages, and answers the count", "tsc, oxlint, oxfmt clean; pnpm test and pnpm test:db green"], "modelTier": "standard"}
```

---

### Task 8: Turns — the browser's reducer and the server's grouping

**Goal:** `lib/chat/turn.ts` folds AG-UI events into one X message per turn (`applyAgUiEvent`) and groups stored rows into the same turns (`turnsFromMessages`), and the two agree on every stub scenario.

Spec §3.3, §5.2; plan calls P9, P10; spike Appendix D (the reducer this grows from); research `part2-x-mapping.md` §1.3, §A, §C. Client-safe: the browser's provider (Task 15) and the history route (Task 11) both import it. Depends on Task 1 (`@ag-ui/*`), Task 5 (`lib/chat/statuses.ts`, with `STOPPED_TOOL_ERROR`).

**Files:**

- Create: `lib/chat/turn.ts`
- Test: `__tests__/chat-turn.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts` reports 27 passed
- [ ] `lib/chat/turn.ts` has no `import 'server-only'` and imports `@ag-ui/core` with `import type` only (`grep -n "from '@ag-ui/core'" lib/chat/turn.ts` shows a single `import type {` line)
- [ ] the five agreement cases (hello, tool, error, timeout, multi) and the stopped case pass: `turnsFromMessages` over the rows `@ag-ui/client` 1.0.2 folds equals `applyAgUiEvent` over the same events
- [ ] a run no row names joins the latest user message's assistant turn (the case 'puts a run no row names under the latest user message started before it' passes)
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm exec oxlint lib/chat/turn.ts __tests__/chat-turn.test.ts` and `pnpm exec oxfmt --check` on both report nothing

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts` → `Tests  27 passed (27)`

**Steps:**

- [ ] **Step 1: Check the docs the code leans on.** The event and message shapes: `node_modules/@ag-ui/core/dist/index.d.ts` (`TextMessageStartEvent.role` is optional, `ToolCallResultEvent.content` and `ToolMessage.content` are `string | ContentPart[]`, `ToolMessage.error?: string`, `RunFinishedEvent.outcome?: RunFinishedOutcome`, `Interrupt`); docs.ag-ui.com `spec/1.0/events/*` through Context7 (`/ag-ui-protocol/ag-ui`) for the lifecycle, tool calls and activity. The X side (one message per request): the `use-x-chat` skill and `node_modules/@ant-design/x-sdk/es/x-chat/index.js`. Nothing here is undocumented except what the comments say comes from source.

- [ ] **Step 2: Write the failing test** `__tests__/chat-turn.test.ts`. The agreement cases run the same events through `@ag-ui/client`'s `HttpAgent` on a stubbed `fetch` (its documented `fetch` option, `HttpAgentConfig.fetch` in the 1.0.2 typings) to get the message list the run session stores (spec §3.2 step 2), so history is checked against what the client really folds, not a hand-written guess:

```ts
import { HttpAgent } from '@ag-ui/client'
import type { BaseEvent, Message } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { describe, expect, it } from 'vitest'

import { STOPPED_TOOL_CONTENT, STOPPED_TOOL_ERROR } from '@/lib/chat/statuses'

import {
	applyAgUiEvent,
	contentText,
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	runOutcomeOf,
	turnsFromMessages,
	turnText,
	userTurn,
	type Turn,
	type TurnMessageRow,
	type TurnRunRow,
} from '@/lib/chat/turn'

const RUN = 'run-1'
const THREAD = 'conversation-1'

/** An AG-UI event as the wire carries it: the reducer reads `type` as a string (no EventType at run time). */
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const hubRun = (runId = RUN) =>
	ev('CUSTOM', { name: HUB_RUN_EVENT, value: { conversationId: THREAD, runId, title: 'Hi' } })
const text = (messageId: string, ...deltas: string[]) => [
	ev('TEXT_MESSAGE_START', { messageId, role: 'assistant' }),
	...deltas.map(delta => ev('TEXT_MESSAGE_CONTENT', { messageId, delta })),
	ev('TEXT_MESSAGE_END', { messageId }),
]
const reasoning = (messageId: string, delta: string) => [
	ev('REASONING_START', { messageId }),
	ev('REASONING_MESSAGE_START', { messageId, role: 'reasoning' }),
	ev('REASONING_MESSAGE_CONTENT', { messageId, delta }),
	ev('REASONING_MESSAGE_END', { messageId }),
	ev('REASONING_END', { messageId }),
]
const started = ev('RUN_STARTED', { threadId: THREAD, runId: RUN })
const finished = (outcome?: Record<string, unknown>) =>
	ev('RUN_FINISHED', { threadId: THREAD, runId: RUN, ...(outcome ? { outcome } : {}) })

/** The live turn: what the browser's provider folds (spec §5.2). */
const live = (events: BaseEvent[], from: Turn = emptyAssistantTurn()): Turn =>
	[hubRun(), ...events].reduce(applyAgUiEvent, from)

const encoder = new EventEncoder()
/**
 * The messages @ag-ui/client 1.0.2 folds the same events into: the list the run session stores (spec §3.2: the rows come
 * from the agent's message list). The stub fetch answers the events as an SSE stream (HttpAgentConfig.fetch).
 */
const storedMessages = async (events: BaseEvent[]): Promise<Message[]> => {
	const agent = new HttpAgent({
		url: 'http://agent.test/agents/assistant',
		threadId: THREAD,
		initialMessages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
		fetch: async () =>
			new Response(events.map(event => encoder.encodeSSE(event)).join(''), {
				headers: { 'content-type': 'text/event-stream' },
			}),
	})
	await agent.runAgent({ runId: RUN })
	return agent.messages
}
const rowsOf = (messages: Message[]): TurnMessageRow[] =>
	messages.map(message => ({
		messageId: message.id,
		runId: RUN,
		role: message.role,
		body: message,
		status: 'complete',
	}))
const runRow = (over: Partial<TurnRunRow> = {}): TurnRunRow => ({
	id: RUN,
	status: 'succeeded',
	outcome: { type: 'success' },
	error: null,
	custom: [],
	startedAt: new Date('2026-10-14T10:00:00Z'),
	...over,
})
/** A run started `minutes` after the first one. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 14, 10, minutes))

/* The scenarios of the e2e stub (Task 13) and the spike's multi-message run, with the run each one stores. */
const SCENARIOS: [string, BaseEvent[], Partial<TurnRunRow>][] = [
	[
		'hello: reasoning, then text',
		[
			started,
			...reasoning('rs-1', 'Thinking.'),
			...text('m-1', 'Hello ', 'there.'),
			finished({ type: 'success' }),
		],
		{},
	],
	[
		'tool: a call, its result, then text',
		[
			started,
			ev('TEXT_MESSAGE_START', { messageId: 'm-0', role: 'assistant' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-0' }),
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'get_weather',
				parentMessageId: 'm-0',
			}),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"city":"Paris"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			ev('TOOL_CALL_RESULT', {
				messageId: 'result-1',
				toolCallId: 'call-1',
				content: '{"temperature_c":18}',
			}),
			...text('m-1', 'It is 18 °C.'),
			finished(),
		],
		{},
	],
	[
		'error: a RUN_ERROR after some text',
		[
			started,
			...text('m-1', 'Partial'),
			ev('RUN_ERROR', { code: 'rate_limited', message: 'Slow down.' }),
		],
		{ status: 'failed', outcome: null, error: { code: 'rate_limited', message: 'Slow down.' } },
	],
	[
		'timeout: CUSTOM run_cancelled, then RUN_FINISHED',
		[
			started,
			...text('m-1', 'Part '),
			ev('CUSTOM', { name: 'run_cancelled', value: { reason: 'run_timeout' } }),
			finished(),
		],
		{ status: 'cancelled', custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }] },
	],
	[
		'multi: reasoning, two messages and a step (spike)',
		[
			started,
			...reasoning('rs-1', 'Two parts coming.'),
			ev('STEP_STARTED', { stepName: 'draft' }),
			...text('m-1', 'First.'),
			ev('STEP_FINISHED', { stepName: 'draft' }),
			...text('m-2', 'Second.'),
			finished({ type: 'success' }),
		],
		{},
	],
]

describe('applyAgUiEvent', () => {
	it('opens a run on hub:run, once, and leaves RUN_STARTED of that run alone', () => {
		const turn = [hubRun(), hubRun(), started].reduce(applyAgUiEvent, emptyAssistantTurn())
		expect(turn.runs).toEqual([{ runId: RUN, outcome: 'running' }])
	})
	it('opens a run on RUN_STARTED when no hub:run came', () => {
		expect(applyAgUiEvent(emptyAssistantTurn(), started).runs).toEqual([
			{ runId: RUN, outcome: 'running' },
		])
	})
	it('starts a resumed run in the same turn and clears the answered interrupts', () => {
		const interrupted = live([
			started,
			finished({ type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'tool_call' }] }),
		])
		expect(interrupted.interrupts).toEqual([{ id: 'int-1', reason: 'tool_call' }])
		const resumed = applyAgUiEvent(interrupted, hubRun('run-2'))
		expect(resumed.runs.map(run => [run.runId, run.outcome])).toEqual([
			[RUN, 'interrupt'],
			['run-2', 'running'],
		])
		expect(resumed.interrupts).toEqual([])
	})
	it('folds assistant text by message id and ignores text of other roles', () => {
		const turn = live([
			...text('m-1', 'Hello ', 'there.'),
			ev('TEXT_MESSAGE_START', { messageId: 'dev-1', role: 'developer' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'dev-1', delta: 'hidden' }),
		])
		expect(turn.parts).toEqual([{ kind: 'text', messageId: 'm-1', text: 'Hello there.' }])
	})
	it('folds reasoning by message id', () => {
		expect(live(reasoning('rs-1', 'Thinking.')).parts).toEqual([
			{ kind: 'reasoning', messageId: 'rs-1', text: 'Thinking.' },
		])
	})
	it('builds a tool part from its start and arguments, and merges its result', () => {
		const turn = live([
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'search' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"q":' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '"tea"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
		])
		expect(turn.parts).toEqual([
			{
				kind: 'tool',
				toolCallId: 'call-1',
				name: 'search',
				args: '{"q":"tea"}',
				status: 'running',
			},
		])
		const answered = applyAgUiEvent(
			turn,
			ev('TOOL_CALL_RESULT', {
				messageId: 'r-1',
				toolCallId: 'call-1',
				content: [
					{ type: 'text', text: 'Green ' },
					{ type: 'text', text: 'tea' },
				],
			}),
		)
		expect(answered.parts[0]).toMatchObject({ status: 'done', result: 'Green tea' })
	})
	it('replaces an activity snapshot in place', () => {
		const turn = live([
			ev('ACTIVITY_SNAPSHOT', { messageId: 'a-1', activityType: 'progress', content: { done: 0 } }),
			...text('m-1', 'Working.'),
			ev('ACTIVITY_SNAPSHOT', { messageId: 'a-1', activityType: 'progress', content: { done: 1 } }),
		])
		expect(turn.parts.map(part => part.kind)).toEqual(['activity', 'text'])
		expect(turn.parts[0]).toEqual({
			kind: 'activity',
			messageId: 'a-1',
			activityType: 'progress',
			content: { done: 1 },
		})
	})
	it('ends a run with its outcome, settles running tools and drops empty text (plan call P10)', () => {
		const toolRun = [
			ev('TEXT_MESSAGE_START', { messageId: 'm-0', role: 'assistant' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-0' }),
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'ask_user' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
		]
		const success = live([...toolRun, finished()])
		expect(success.runs[0].outcome).toBe('success')
		expect(success.parts).toEqual([
			{ kind: 'tool', toolCallId: 'call-1', name: 'ask_user', args: '', status: 'done' },
		])
		const interrupt = live([
			...toolRun,
			finished({
				type: 'interrupt',
				interrupts: [{ id: 'i-1', reason: 'tool_call', toolCallId: 'call-1' }],
			}),
		])
		expect(interrupt.runs[0].outcome).toBe('interrupt')
		expect(interrupt.interrupts).toEqual([{ id: 'i-1', reason: 'tool_call', toolCallId: 'call-1' }])
		const cancelled = live([...toolRun, finished({ type: 'cancelled' })])
		expect(cancelled.runs[0].outcome).toBe('cancelled')
		expect(cancelled.parts[0]).toMatchObject({ status: 'stopped' })
	})
	it('reads an agent time limit as a cancelled run with its reason (spec §2.3)', () => {
		const turn = live([
			...text('m-1', 'Part'),
			ev('CUSTOM', { name: 'run_cancelled', value: { reason: 'run_timeout' } }),
			finished(),
		])
		expect(turn.runs).toEqual([
			{ runId: RUN, outcome: 'cancelled', cancelledReason: 'run_timeout' },
		])
	})
	it('keeps a run error with its code and message, and stops running tools', () => {
		const turn = live([
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'search' }),
			ev('RUN_ERROR', { code: 'model_unavailable', message: 'The model is down.' }),
		])
		expect(turn.runs).toEqual([
			{
				runId: RUN,
				outcome: 'error',
				error: { code: 'model_unavailable', message: 'The model is down.' },
			},
		])
		expect(turn.parts[0]).toMatchObject({ status: 'stopped' })
	})
	it('returns the same turn for events it does not render', () => {
		const turn = live(text('m-1', 'Hi'))
		for (const type of [
			'STEP_STARTED',
			'STATE_SNAPSHOT',
			'RAW',
			'TEXT_MESSAGE_END',
			'REASONING_END',
		])
			expect(
				applyAgUiEvent(turn, ev(type, { messageId: 'm-1', stepName: 'x', snapshot: {} })),
			).toBe(turn)
	})
})

describe('runOutcomeOf', () => {
	it('names each stored status as the turn reads it', () => {
		expect(
			(['running', 'succeeded', 'interrupted', 'cancelled', 'failed', 'truncated'] as const).map(
				runOutcomeOf,
			),
		).toEqual(['running', 'success', 'interrupt', 'cancelled', 'error', 'truncated'])
	})
})

// Spec §3.3: a reload shows what the live view showed. The two agree for every stub scenario (spec §5.2).
describe('turnsFromMessages agrees with the live reducer', () => {
	it.each(SCENARIOS)('%s', async (_name, events, run) => {
		const history = turnsFromMessages(rowsOf(await storedMessages(events)), [runRow(run)])
		expect(history).toEqual([
			{ id: 'user-1', turn: userTurn('user-1', 'Hi') },
			{ id: `turn-${RUN}`, turn: live(events) },
		])
	})
	it('for a stopped run: the hub closes the browser side, the store answers the cut-off call', async () => {
		const agentEvents = [
			started,
			ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Partial' }),
			ev('TOOL_CALL_START', {
				toolCallId: 'call-9',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-9', delta: '{"q":' }),
		]
		// What the run session sends the browser after the hub's own Stop (spec §4.5; Task 10).
		const closings = [
			ev('TOOL_CALL_END', { toolCallId: 'call-9' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-1' }),
			finished({ type: 'cancelled' }),
		]
		// What it stores: the partial rows, and a tool message that answers the cut-off call (spec §3.2 step 4).
		const stored: Message[] = [
			...(await storedMessages(agentEvents)),
			{
				id: 'stop-1',
				role: 'tool',
				toolCallId: 'call-9',
				content: STOPPED_TOOL_CONTENT,
				error: STOPPED_TOOL_ERROR,
			},
		]
		const history = turnsFromMessages(rowsOf(stored), [
			runRow({ status: 'cancelled', outcome: { type: 'cancelled' } }),
		])
		expect(history[1].turn).toEqual(live([...agentEvents, ...closings]))
		expect(history[1].turn.parts[1]).toMatchObject({ kind: 'tool', status: 'stopped' })
	})
})

describe('turnsFromMessages', () => {
	const user = (id: string, runId: string, content: string): TurnMessageRow => ({
		messageId: id,
		runId,
		role: 'user',
		body: { id, role: 'user', content },
		status: 'complete',
	})
	const assistant = (id: string, runId: string, body: Partial<Message> = {}): TurnMessageRow => ({
		messageId: id,
		runId,
		role: 'assistant',
		body: { id, role: 'assistant', ...body } as Message,
		status: 'complete',
	})
	it('gives each user message a turn and groups what follows into one assistant turn (plan call P9)', () => {
		const turns = turnsFromMessages(
			[
				user('u-1', 'r-1', 'One'),
				assistant('a-1', 'r-1', { content: 'First answer' }),
				user('u-2', 'r-2', 'Two'),
				assistant('a-2', 'r-2', { content: 'Second answer' }),
			],
			[runRow({ id: 'r-1', startedAt: at(0) }), runRow({ id: 'r-2', startedAt: at(1) })],
		)
		expect(turns.map(({ id, turn }) => [id, turn.role, turnText(turn)])).toEqual([
			['u-1', 'user', 'One'],
			['turn-r-1', 'assistant', 'First answer'],
			['u-2', 'user', 'Two'],
			['turn-r-2', 'assistant', 'Second answer'],
		])
	})
	it('keeps the runs that resumed a turn in it, in order', () => {
		const turns = turnsFromMessages(
			[
				user('u-1', 'r-1', 'Delete it'),
				assistant('a-1', 'r-1', {
					toolCalls: [
						{ id: 'c-1', type: 'function', function: { name: 'delete_file', arguments: '{}' } },
					],
				}),
				{
					messageId: 't-1',
					runId: 'r-2',
					role: 'tool',
					body: { id: 't-1', role: 'tool', toolCallId: 'c-1', content: 'Deleted' },
					status: 'complete',
				},
				assistant('a-2', 'r-2', { content: 'Done.' }),
			],
			[
				runRow({
					id: 'r-1',
					status: 'interrupted',
					outcome: { type: 'interrupt', interrupts: [] },
					startedAt: at(0),
				}),
				runRow({ id: 'r-2', startedAt: at(1) }),
			],
		)
		expect(turns).toHaveLength(2)
		expect(turns[1].turn.runs.map(run => [run.runId, run.outcome])).toEqual([
			['r-1', 'interrupt'],
			['r-2', 'success'],
		])
		expect(turns[1].turn.parts).toEqual([
			{
				kind: 'tool',
				toolCallId: 'c-1',
				name: 'delete_file',
				args: '{}',
				status: 'done',
				result: 'Deleted',
			},
			{ kind: 'text', messageId: 'a-2', text: 'Done.' },
		])
	})
	it('shows a run that failed before any message as an assistant turn with its error', () => {
		const turns = turnsFromMessages(
			[user('u-1', 'r-1', 'Hi')],
			[
				runRow({
					id: 'r-1',
					status: 'failed',
					outcome: null,
					error: { code: 'agent_not_found', message: '' },
				}),
			],
		)
		expect(turns[1]).toEqual({
			id: 'turn-r-1',
			turn: {
				role: 'assistant',
				parts: [],
				runs: [{ runId: 'r-1', outcome: 'error', error: { code: 'agent_not_found', message: '' } }],
				interrupts: [],
			},
		})
	})
	it('carries the open interrupts on the last turn only, while its last run is interrupted (spec §3.3)', () => {
		const interrupts = [{ id: 'int-1', reason: 'input_required', message: 'Which region?' }]
		const rows = [
			user('u-1', 'r-1', 'Report'),
			assistant('a-1', 'r-1', { content: 'One detail first.' }),
		]
		const open = turnsFromMessages(rows, [
			runRow({ id: 'r-1', status: 'interrupted', outcome: { type: 'interrupt', interrupts } }),
		])
		expect(open[1].turn.interrupts).toEqual(interrupts)
		const answered = turnsFromMessages(rows, [runRow({ id: 'r-1' })])
		expect(answered[1].turn.interrupts).toEqual([])
	})
	it('shows a tool message with an error as an error, its text kept, and skips developer and system rows', () => {
		const turns = turnsFromMessages(
			[
				{
					messageId: 's-1',
					runId: 'r-1',
					role: 'system',
					body: { id: 's-1', role: 'system', content: 'Be brief.' },
					status: 'complete',
				},
				user('u-1', 'r-1', 'Ask me'),
				assistant('a-1', 'r-1', {
					toolCalls: [
						{
							id: 'c-1',
							type: 'function',
							function: { name: 'ask_user_question', arguments: '{}' },
						},
					],
				}),
				{
					messageId: 't-1',
					runId: 'r-2',
					role: 'tool',
					body: {
						id: 't-1',
						role: 'tool',
						toolCallId: 'c-1',
						content: 'This tool is not available here.',
						error: 'unavailable',
					},
					status: 'complete',
				},
			],
			[runRow({ id: 'r-1', startedAt: at(0) }), runRow({ id: 'r-2', startedAt: at(1) })],
		)
		expect(turns.map(({ turn }) => turn.role)).toEqual(['user', 'assistant'])
		expect(turns[1].turn.parts[0]).toMatchObject({
			status: 'error',
			error: 'This tool is not available here.',
		})
	})
	it('puts a run no row names under the latest user message started before it, so its error shows', () => {
		const answersRun = runRow({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: { code: 'agent_rejected_input', message: '' },
			startedAt: at(5),
		})
		// The answers run of an interrupted turn, refused before its stream: it wrote no message (Task 7's readThreadPage).
		const withRows = turnsFromMessages(
			[user('u-1', 'r-1', 'Delete it'), assistant('a-1', 'r-1', { content: 'May I?' })],
			[
				runRow({
					id: 'r-1',
					status: 'interrupted',
					outcome: { type: 'interrupt', interrupts: [] },
					startedAt: at(0),
				}),
				answersRun,
			],
		)
		expect(withRows[1].id).toBe('turn-r-1')
		expect(withRows[1].turn.runs.map(run => [run.runId, run.outcome])).toEqual([
			['r-1', 'interrupt'],
			['r-2', 'error'],
		])
		// A user message whose own run wrote nothing yet gets the assistant turn made for it.
		const withoutRows = turnsFromMessages(
			[user('u-1', 'r-1', 'Hi'), user('u-2', 'r-3', 'Again')],
			[
				runRow({ id: 'r-1', startedAt: at(0) }),
				runRow({ id: 'r-3', status: 'running', outcome: null, startedAt: at(9) }),
				answersRun,
			],
		)
		expect(withoutRows.map(({ id }) => id)).toEqual(['u-1', 'turn-r-1', 'u-2', 'turn-r-3'])
		expect(withoutRows[1].turn.runs.map(run => run.runId)).toEqual(['r-1', 'r-2'])
	})
	it('marks a call without a result by how its last run ended', () => {
		const rows = [
			user('u-1', 'r-1', 'Go'),
			assistant('a-1', 'r-1', {
				toolCalls: [{ id: 'c-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
			}),
		]
		const status = (over: Partial<TurnRunRow>) =>
			turnsFromMessages(rows, [runRow({ id: 'r-1', ...over })])[1].turn.parts[0]
		expect(status({})).toMatchObject({ status: 'done' })
		expect(status({ status: 'running' })).toMatchObject({ status: 'running' })
		expect(status({ status: 'truncated' })).toMatchObject({ status: 'stopped' })
	})
})

describe('contentText and turnText', () => {
	it('read a string or the text parts of a content list', () => {
		expect(contentText('plain')).toBe('plain')
		expect(
			contentText([
				{ type: 'text', text: 'a' },
				{ type: 'image', source: { type: 'url', value: 'https://x/y.png' } },
				{ type: 'text', text: 'b' },
			] as never),
		).toBe('ab')
		expect(contentText(undefined)).toBe('')
	})
	it('joins a turn’s non-empty text parts with a blank line', () => {
		const turn = live([
			...reasoning('rs-1', 'Hidden'),
			...text('m-1', 'One'),
			...text('m-2', 'Two'),
		])
		expect(turnText(turn)).toBe('One\n\nTwo')
	})
})
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts` Expected: FAIL — `Failed to resolve import "@/lib/chat/turn"`.

- [ ] **Step 4: Write `lib/chat/turn.ts`**

```ts
import type {
	ActivitySnapshotEvent,
	BaseEvent,
	ContentPart,
	CustomEvent,
	Interrupt,
	Message,
	ReasoningMessageContentEvent,
	ReasoningMessageStartEvent,
	RunErrorEvent,
	RunFinishedEvent,
	RunStartedEvent,
	TextMessageContentEvent,
	TextMessageStartEvent,
	ToolCallArgsEvent,
	ToolCallResultEvent,
	ToolCallStartEvent,
} from '@ag-ui/core'

import {
	type MessageRole,
	type MessageStatus,
	type RunStatus,
	STOPPED_TOOL_ERROR,
} from './statuses'

/*
 * One X message per turn (Part 2 spec §5.2; spike "Browser side"; research `part2-x-mapping.md` §A): a user message, or
 * everything the agent answered to it, across the runs that continued it, as parts in arrival order. useXChat writes one
 * message per request (x-sdk 2.9.0 `es/x-chat/index.js`: one `updatingMsgId`), and assistant-ui, TanStack AI and X's own
 * AgentProvider demo group a run's output the same way. Client-safe: the browser folds events with `applyAgUiEvent`, the
 * server groups stored rows with `turnsFromMessages`. `@ag-ui/core` is imported for its types only (spec §9: the browser
 * bundle carries none of the AG-UI runtime), so event types are compared as strings.
 */

/** Plan call P10: running until its result; done with one; error for a tool message with an error; stopped when cut off. */
export type ToolStatus = 'running' | 'done' | 'error' | 'stopped'

/** A turn's pieces, each keyed by its AG-UI id (spec §5.2): text and reasoning by message id, a tool call by its id. */
export type TurnPart =
	| { kind: 'text'; messageId: string; text: string }
	| { kind: 'reasoning'; messageId: string; text: string }
	| {
			kind: 'tool'
			toolCallId: string
			name: string
			args: string
			status: ToolStatus
			result?: string
			error?: string
	  }
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }

/** What AG-UI said of a run (spec §5.2's second layer; X's own status is the transport's). */
export type RunOutcome = 'running' | 'success' | 'interrupt' | 'cancelled' | 'error' | 'truncated'

export interface TurnRun {
	runId: string
	outcome: RunOutcome
	error?: { code?: string; message: string }
	/** CUSTOM run_cancelled's reason, e.g. 'run_timeout' (spec §2.3). */
	cancelledReason?: string
}

/** One X message: a user message, or everything the agent answered to it across the runs that continued it (spec §5.2). */
export interface Turn {
	role: 'user' | 'assistant'
	parts: TurnPart[]
	runs: TurnRun[]
	/** The last run's open interrupts (spec §3.3); 2b renders them. */
	interrupts: Interrupt[]
}

/** The hub's first event on every run stream (spec §4.4): the browser learns the conversation and the run to stop. */
export const HUB_RUN_EVENT = 'hub:run'

export interface HubRunValue {
	conversationId: string
	runId: string
	title: string
}

/** The agent's time limit (spec §2.3, the owner's agent contract): CUSTOM run_cancelled, then RUN_FINISHED. */
export const RUN_CANCELLED_EVENT = 'run_cancelled'

export const emptyAssistantTurn = (): Turn => ({
	role: 'assistant',
	parts: [],
	runs: [],
	interrupts: [],
})

export const userTurn = (messageId: string, text: string): Turn => ({
	role: 'user',
	parts: [{ kind: 'text', messageId, text }],
	runs: [],
	interrupts: [],
})

/** A user message's, a tool result's or a tool message's content as text: a string as it is, else its text parts joined. */
export const contentText = (content: string | ContentPart[] | undefined): string => {
	if (typeof content === 'string') return content
	return (content ?? []).map(part => (part.type === 'text' ? part.text : '')).join('')
}

type PartOf<K extends TurnPart['kind']> = Extract<TurnPart, { kind: K }>

const keyOf = (part: TurnPart): string =>
	part.kind === 'tool' ? `tool:${part.toolCallId}` : `${part.kind}:${part.messageId}`

const upsertPart = (parts: TurnPart[], part: TurnPart): TurnPart[] => {
	const index = parts.findIndex(p => keyOf(p) === keyOf(part))
	return index === -1 ? [...parts, part] : parts.map((p, i) => (i === index ? part : p))
}

const updatePart = <K extends TurnPart['kind']>(
	parts: TurnPart[],
	kind: K,
	key: string,
	patch: (part: PartOf<K>) => PartOf<K>,
): TurnPart[] =>
	parts.map(part =>
		part.kind === kind && keyOf(part) === `${kind}:${key}` ? patch(part as PartOf<K>) : part,
	)

const patchLastRun = (turn: Turn, patch: (run: TurnRun) => TurnRun): TurnRun[] =>
	turn.runs.map((run, index) => (index === turn.runs.length - 1 ? patch(run) : run))

const pushRun = (turn: Turn, runId: string): Turn =>
	turn.runs.some(run => run.runId === runId)
		? turn
		: { ...turn, runs: [...turn.runs, { runId, outcome: 'running' }], interrupts: [] }

/**
 * A run's end settles its parts (plan call P10): a call still running is done (success, interrupt) or stopped (cancel,
 * error), and an empty text part goes: Pydantic AI opens an empty text message before its tool calls (spike), and the
 * stored assistant message of it has no content, so the live turn and the reloaded one agree.
 */
const settleParts = (parts: TurnPart[], tools: ToolStatus): TurnPart[] =>
	parts
		.filter(part => !(part.kind === 'text' && part.text === ''))
		.map(part =>
			part.kind === 'tool' && part.status === 'running' ? { ...part, status: tools } : part,
		)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The pure reducer the browser's provider runs per event (spec §5.2), grown from the spike's (Appendix D). A turn's run
 * opens on hub:run, or on RUN_STARTED when no hub:run came; a resumed run (2b) opens in the same turn. Text is kept for
 * assistant messages only; content for a message that never started as one is dropped (the client's verification lets
 * none through otherwise: src/verify/verify.ts). Events the turn does not show leave it as it is (the same object).
 */
export const applyAgUiEvent = (turn: Turn, event: BaseEvent): Turn => {
	switch (event.type as string) {
		case 'CUSTOM': {
			const { name, value } = event as CustomEvent
			if (name === HUB_RUN_EVENT && isRecord(value) && typeof value.runId === 'string')
				return pushRun(turn, value.runId)
			if (name === RUN_CANCELLED_EVENT && turn.runs.length) {
				const reason =
					isRecord(value) && typeof value.reason === 'string' ? value.reason : 'cancelled'
				return { ...turn, runs: patchLastRun(turn, run => ({ ...run, cancelledReason: reason })) }
			}
			return turn
		}
		case 'RUN_STARTED': {
			const last = turn.runs.at(-1)
			return last?.outcome === 'running' ? turn : pushRun(turn, (event as RunStartedEvent).runId)
		}
		case 'TEXT_MESSAGE_START': {
			const { messageId, role } = event as TextMessageStartEvent
			if (role !== undefined && role !== 'assistant') return turn
			return { ...turn, parts: upsertPart(turn.parts, { kind: 'text', messageId, text: '' }) }
		}
		case 'TEXT_MESSAGE_CONTENT': {
			const { messageId, delta } = event as TextMessageContentEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'text', messageId, part => ({
					...part,
					text: part.text + delta,
				})),
			}
		}
		case 'REASONING_MESSAGE_START': {
			const { messageId } = event as ReasoningMessageStartEvent
			return { ...turn, parts: upsertPart(turn.parts, { kind: 'reasoning', messageId, text: '' }) }
		}
		case 'REASONING_MESSAGE_CONTENT': {
			const { messageId, delta } = event as ReasoningMessageContentEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'reasoning', messageId, part => ({
					...part,
					text: part.text + delta,
				})),
			}
		}
		case 'TOOL_CALL_START': {
			const { toolCallId, toolCallName } = event as ToolCallStartEvent
			return {
				...turn,
				parts: upsertPart(turn.parts, {
					kind: 'tool',
					toolCallId,
					name: toolCallName,
					args: '',
					status: 'running',
				}),
			}
		}
		case 'TOOL_CALL_ARGS': {
			const { toolCallId, delta } = event as ToolCallArgsEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'tool', toolCallId, part => ({
					...part,
					args: part.args + delta,
				})),
			}
		}
		case 'TOOL_CALL_RESULT': {
			const { toolCallId, content } = event as ToolCallResultEvent
			return {
				...turn,
				parts: updatePart(turn.parts, 'tool', toolCallId, part => ({
					...part,
					result: contentText(content),
					status: 'done',
				})),
			}
		}
		case 'ACTIVITY_SNAPSHOT': {
			const { messageId, activityType, content } = event as ActivitySnapshotEvent
			return {
				...turn,
				parts: upsertPart(turn.parts, { kind: 'activity', messageId, activityType, content }),
			}
		}
		case 'RUN_FINISHED': {
			const { outcome } = event as RunFinishedEvent
			const cancelled = outcome?.type === 'cancelled' || Boolean(turn.runs.at(-1)?.cancelledReason)
			const next: RunOutcome = cancelled
				? 'cancelled'
				: outcome?.type === 'interrupt'
					? 'interrupt'
					: 'success'
			return {
				...turn,
				parts: settleParts(turn.parts, cancelled ? 'stopped' : 'done'),
				runs: patchLastRun(turn, run => ({ ...run, outcome: next })),
				interrupts: outcome?.type === 'interrupt' ? outcome.interrupts : [],
			}
		}
		case 'RUN_ERROR': {
			const { code, message } = event as RunErrorEvent
			return {
				...turn,
				parts: settleParts(turn.parts, 'stopped'),
				runs: patchLastRun(turn, run => ({
					...run,
					outcome: 'error',
					error: code === undefined ? { message } : { code, message },
				})),
				interrupts: [],
			}
		}
		default:
			return turn
	}
}

const RUN_OUTCOMES: Record<RunStatus, RunOutcome> = {
	running: 'running',
	succeeded: 'success',
	interrupted: 'interrupt',
	cancelled: 'cancelled',
	failed: 'error',
	truncated: 'truncated',
}
/** A stored run's status (spec §3.1) as the turn reads it. */
export const runOutcomeOf = (status: RunStatus): RunOutcome => RUN_OUTCOMES[status]

/** The fields of a stored message the grouping reads (lib/data/conversations.ts `StoredMessage`). */
export interface TurnMessageRow {
	messageId: string
	runId: string | null
	role: MessageRole
	body: Message
	status: MessageStatus
}
/** The fields of a stored run the grouping reads (lib/data/conversations.ts `StoredRun`). */
export interface TurnRunRow {
	id: string
	status: RunStatus
	outcome: unknown
	error: { code?: string; message: string } | null
	custom: { name: string; value: unknown }[]
	startedAt: Date
}
/** A turn with its id (plan call P9): a user message's id, or `turn-<its first run id>`. */
export interface HistoryTurn {
	id: string
	turn: Turn
}

const cancelledReasonOf = (custom: TurnRunRow['custom']): string | undefined => {
	const record = custom.findLast(item => item.name === RUN_CANCELLED_EVENT)
	if (!record) return undefined
	return isRecord(record.value) && typeof record.value.reason === 'string'
		? record.value.reason
		: 'cancelled'
}

const toTurnRun = (run: TurnRunRow): TurnRun => {
	const reason = cancelledReasonOf(run.custom)
	return {
		runId: run.id,
		outcome: runOutcomeOf(run.status),
		...(run.error ? { error: run.error } : {}),
		...(reason ? { cancelledReason: reason } : {}),
	}
}

const interruptsOf = (outcome: unknown): Interrupt[] =>
	isRecord(outcome) && outcome.type === 'interrupt' && Array.isArray(outcome.interrupts)
		? (outcome.interrupts as Interrupt[])
		: []

const TOOL_STATUS_AT_END: Record<RunOutcome, ToolStatus> = {
	running: 'running',
	success: 'done',
	interrupt: 'done',
	cancelled: 'stopped',
	error: 'stopped',
	truncated: 'stopped',
}

/**
 * One stored row into the turn's parts. An assistant record holds its text and its tool calls in separate fields with no
 * order between them, so a reload shows the text first (assistant-ui `fromAgUiMessages` does the same; spec §3.3). A tool
 * message lands on its call: a result, a stop (the session's `STOPPED_TOOL_ERROR`), or another error with its text.
 */
const foldRow = (parts: TurnPart[], body: Message): TurnPart[] => {
	switch (body.role) {
		case 'reasoning':
			return [...parts, { kind: 'reasoning', messageId: body.id, text: body.content }]
		case 'assistant': {
			const text: TurnPart[] = body.content
				? [{ kind: 'text', messageId: body.id, text: body.content }]
				: []
			const tools: TurnPart[] = (body.toolCalls ?? []).map(call => ({
				kind: 'tool',
				toolCallId: call.id,
				name: call.function.name,
				args: call.function.arguments,
				status: 'running',
			}))
			return [...parts, ...text, ...tools]
		}
		case 'tool': {
			const { error, toolCallId } = body
			const content = contentText(body.content)
			return updatePart(parts, 'tool', toolCallId, part => {
				if (error === undefined) return { ...part, status: 'done', result: content }
				if (error === STOPPED_TOOL_ERROR) return { ...part, status: 'stopped' }
				return { ...part, status: 'error', error: content || error }
			})
		}
		case 'activity':
			return [
				...parts,
				{
					kind: 'activity',
					messageId: body.id,
					activityType: body.activityType,
					content: body.content,
				},
			]
		default:
			return parts
	}
}

/**
 * The server's grouping of stored rows into turns (spec §3.3), since "nothing on the wire carries run identity"
 * (assistant-ui; research `part2-x-mapping.md` §C): a user turn per user message, then one assistant turn holding every
 * row up to the next user message, across the runs that resumed it. The last turn carries the open interrupts while its
 * last run is interrupted, so they survive a reload.
 */
export const turnsFromMessages = (
	rows: readonly TurnMessageRow[],
	runs: readonly TurnRunRow[],
): HistoryTurn[] => {
	const runById = new Map(runs.map(run => [run.id, run]))
	const startOf = (runId: string) =>
		runById.get(runId)?.startedAt.getTime() ?? Number.NEGATIVE_INFINITY
	// Each user message, then what answered it: its run ids in the order they appear, and the parts its rows fold into.
	const groups: { user?: TurnMessageRow; firstId: string; runIds: string[]; parts: TurnPart[] }[] =
		[]
	for (const row of rows) {
		// Developer and system messages are the agent's instructions, not part of any turn.
		if (row.body.role === 'developer' || row.body.role === 'system') continue
		if (row.body.role === 'user') {
			groups.push({
				user: row,
				firstId: row.messageId,
				runIds: row.runId ? [row.runId] : [],
				parts: [],
			})
			continue
		}
		if (!groups.length) groups.push({ firstId: row.messageId, runIds: [], parts: [] })
		const group = groups[groups.length - 1]
		if (row.runId && !group.runIds.includes(row.runId)) group.runIds.push(row.runId)
		group.parts = foldRow(group.parts, row.body)
	}
	// A run no row names (an answers run the agent refused before its stream) belongs to the latest user message whose
	// run started before it, so its error shows.
	const named = new Set(groups.flatMap(group => group.runIds))
	for (const run of runs) {
		if (named.has(run.id)) continue
		const group = groups.findLast(
			candidate =>
				candidate.user?.runId && startOf(candidate.user.runId) <= run.startedAt.getTime(),
		)
		group?.runIds.push(run.id)
	}
	const turns: HistoryTurn[] = []
	for (const group of groups) {
		const user = group.user
		if (user?.body.role === 'user')
			turns.push({
				id: user.messageId,
				turn: userTurn(user.messageId, contentText(user.body.content)),
			})
		const ordered = [...group.runIds].sort((a, b) => startOf(a) - startOf(b))
		const turnRuns = ordered.flatMap(id => {
			const run = runById.get(id)
			return run ? [toTurnRun(run)] : []
		})
		if (!turnRuns.length && !group.parts.length) continue
		const atEnd = TOOL_STATUS_AT_END[turnRuns.at(-1)?.outcome ?? 'success']
		turns.push({
			id: `turn-${group.runIds[0] ?? group.firstId}`,
			turn: {
				role: 'assistant',
				parts: group.parts.map(part =>
					part.kind === 'tool' && part.status === 'running' ? { ...part, status: atEnd } : part,
				),
				runs: turnRuns,
				interrupts: [],
			},
		})
	}
	const lastTurn = turns.at(-1)
	const lastRun = lastTurn?.turn.runs.at(-1)
	if (lastTurn && lastRun?.outcome === 'interrupt')
		lastTurn.turn = {
			...lastTurn.turn,
			interrupts: interruptsOf(runById.get(lastRun.runId)?.outcome),
		}
	return turns
}

/** A turn's text parts joined by a blank line: what Copy copies (spec §5.3). */
export const turnText = (turn: Turn): string =>
	turn.parts.flatMap(part => (part.kind === 'text' && part.text ? [part.text] : [])).join('\n\n')
```

- [ ] **Step 5: Run the test and see it pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts` Expected: `Tests  27 passed (27)`.

- [ ] **Step 6: Gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint lib/chat/turn.ts __tests__/chat-turn.test.ts && pnpm exec oxfmt --check lib/chat/turn.ts __tests__/chat-turn.test.ts && pnpm test` Expected: tsc exits 0, oxlint "Found 0 warnings and 0 errors", oxfmt "All matched files use the correct format", `pnpm test` green.

- [ ] **Step 7: Commit**

```bash
git add lib/chat/turn.ts __tests__/chat-turn.test.ts
git commit -m "feat(chat): fold AG-UI events and stored messages into the same turns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/turn.ts", "__tests__/chat-turn.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-turn.test.ts", "acceptanceCriteria": ["`pnpm exec vitest run --project unit __tests__/chat-turn.test.ts` reports 27 passed", "`lib/chat/turn.ts` has no `import 'server-only'` and imports `@ag-ui/core` with `import type` only (`grep -n \"from '@ag-ui/core'\" lib/chat/turn.ts` shows a single `import type {` line)", "the five agreement cases (hello, tool, error, timeout, multi) and the stopped case pass: `turnsFromMessages` over the rows `@ag-ui/client` 1.0.2 folds equals `applyAgUiEvent` over the same events", "a run no row names joins the latest user message's assistant turn (the case 'puts a run no row names under the latest user message started before it' passes)", "`pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm exec oxlint lib/chat/turn.ts __tests__/chat-turn.test.ts` and `pnpm exec oxfmt --check` on both report nothing"], "modelTier": "standard"}
```

---

### Task 9: The chat adapter and AG-UI's `HttpAgent` adapter

**Goal:** `lib/chat/adapter.ts` defines the provider-neutral turn contract, and `lib/providers/agui/chat.ts` runs one turn through `@ag-ui/client`'s `HttpAgent.runAgent()` on the server with a fresh JWT, reporting the agent's status before any stream and every event, message list and state to a sink.

Spec §4.1, §4.3 steps 3–4, §2.3; plan call P5; research `part2-proxy-stop-identity.md` §1 (the client on a Node server) and implications A1–A4. Depends on Tasks 1, 2 (`mintAgentToken`, `env().agentJwtIssuer`, `ProviderCaller`) and 4 (the registry and `lib/providers/agui/provider.ts`).

Behaviours this task relies on, each read in `@ag-ui/client` 1.0.2's source (its `dist/index.mjs.map`) and run in a scratch harness while planning:

- a subscriber's `onEvent` runs before the event is applied, `onMessagesChanged` and `onStateChanged` after (`src/apply/default.ts`; `src/agent/agent.ts` `processApplyEvents`);
- a non-OK answer makes the client read the body and reject `runAgent` with `HTTP <status>: <body>` (`src/run/http-request.ts`), so the adapter hands it an empty body of the same status;
- an abort mid-stream yields the client's own `RUN_ERROR { code: 'abort' }` and `runAgent` resolves (`src/transform/http.ts`); an abort before the answer rejects `fetch` with an `AbortError`, which `runAgent` swallows (`onError`);
- `onRunFailed` cannot drop the error: its typed return is `Omit<AgentStateMutation, "stopPropagation">` (`index.d.ts`), so the adapter catches `runAgent`'s rejection instead, and the client logs `Agent execution failed: Error: HTTP 401: ` — the status only, since it never sees the agent's text.

**Files:**

- Create: `lib/chat/adapter.ts`, `lib/providers/agui/chat.ts`
- Modify: `lib/providers/registry.ts` (the `chat` field of `ProviderDefinition`; `chatAdapterOf`), `lib/providers/agui/provider.ts` (`chat: aguiChat`)
- Test: `__tests__/agui-chat.test.ts`, `__tests__/provider-registry.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/agui-chat.test.ts` reports 20 passed
- [ ] the request carries exactly the headers `Accept`, `Authorization`, `Content-Type`, and its JWT verifies with `jose` `jwtVerify` (HS256, `iss` `nextjs-bff`, `aud` the app's audience, `sub`, `auth_source`, `roles`, `exp - iat = 60`, no `email` or `name`)
- [ ] a 401, 404, 422 or 500 before the stream settles `opened` with `agent_auth_failed`, `agent_not_found`, `agent_rejected_input` or `upstream_error`, and the body's `pull` is never called (unread) while its `cancel` is called once
- [ ] a refused connection settles `opened` with `provider_unreachable`; an abort mid-stream finishes `{ failed: false }` and the sink's last event is `RUN_ERROR` with code `abort`
- [ ] `chatAdapterOf('agui')` is `aguiChat` and `chatAdapterOf('dify')` is `undefined` (`__tests__/provider-registry.test.ts`)
- [ ] tsc, oxlint and oxfmt pass on the changed files, and `pnpm test` is green

**Verify:** `pnpm exec vitest run --project unit __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts` → both files pass; `agui-chat.test.ts` `Tests  20 passed`

**Steps:**

- [ ] **Step 1: Check the docs.** Context7 `/ag-ui-protocol/ag-ui`: "HttpAgent" (`url`, `headers`, `abortRun`), "AbstractAgent" (`runAgent(parameters, subscriber)`, `RunAgentResult`, the `AgentSubscriber` hooks), "Run input" (`tools`, `context`, `forwardedProps`, `resume`). The typings: `node_modules/@ag-ui/client/dist/index.d.ts` (`HttpAgentConfig.fetch`, `RunHttpAgentConfig.abortController`, the return type of `AgentSubscriber.onRunFailed`). jose: Context7 `/panva/jose` (`SignJWT`, `jwtVerify` with `currentDate`). MDN: `ReadableStream.cancel()`, `AbortController.abort()`. Where the docs are silent (the `fetch` option, the abort behaviour), the comments cite the client's source as above.

- [ ] **Step 2: Write the failing tests.** Create `__tests__/agui-chat.test.ts`:

```ts
import type { BaseEvent, Message } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))

import type { ChatTurnInput } from '@/lib/chat/adapter'
import { aguiChat, upstreamCodeFor } from '@/lib/providers/agui/chat'

const SECRET = 'a-test-secret-of-at-least-32-characters'
const app = {
	settings: { agentUrl: 'http://agents.test:8000/agents/assistant', audience: 'assistant' },
	secrets: { jwtSecret: SECRET },
}
const encoder = new EventEncoder()
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const sse = (events: BaseEvent[]) =>
	new Response(events.map(event => encoder.encodeSSE(event)).join(''), {
		headers: { 'content-type': 'text/event-stream' },
	})

const input = (over: Partial<ChatTurnInput> = {}): ChatTurnInput => ({
	threadId: 'conversation-1',
	runId: 'run-1',
	messages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
	state: { steps: [] },
	tools: [],
	caller: { id: 'account-1', source: 'ldap', role: 'user' },
	abortController: new AbortController(),
	...over,
})
const recordingSink = () => {
	const events: BaseEvent[] = []
	const lists: (readonly Message[])[] = []
	const states: unknown[] = []
	return {
		events,
		lists,
		states,
		sink: {
			event: (event: BaseEvent) => void events.push(event),
			messages: (messages: readonly Message[]) => void lists.push(messages),
			state: (state: unknown) => void states.push(state),
		},
	}
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
	// @ag-ui/client logs a failed run itself ("Agent execution failed:"); the cases below assert what it logs.
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// Spec §4.3 step 4 and plan call P5.
describe('upstreamCodeFor', () => {
	it.each([
		[401, 'agent_auth_failed'],
		[403, 'agent_auth_failed'],
		[404, 'agent_not_found'],
		[415, 'agent_rejected_input'],
		[422, 'agent_rejected_input'],
		[400, 'upstream_error'],
		[429, 'upstream_error'],
		[500, 'upstream_error'],
		[503, 'upstream_error'],
	])('reads %i as %s', (status, code) => {
		expect(upstreamCodeFor(status)).toBe(code)
	})
})

describe('aguiChat.runTurn', () => {
	const finishedRun = [
		ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
		ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
		ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hello' }),
		ev('TEXT_MESSAGE_END', { messageId: 'm-1' }),
		ev('STATE_DELTA', {
			delta: [{ op: 'add', path: '/steps/-', value: { description: 'Read', status: 'pending' } }],
		}),
		ev('RUN_FINISHED', {
			threadId: 'conversation-1',
			runId: 'run-1',
			outcome: { type: 'success' },
		}),
	]

	// Spec §2.3: the request, its one auth header and its JWT.
	it('posts the RunAgentInput to the agent URL with one bearer JWT and the stream headers', async () => {
		fetchMock.mockResolvedValue(sse(finishedRun))
		const { sink } = recordingSink()
		const handle = aguiChat.runTurn(
			app,
			input({ resume: [{ interruptId: 'int-1', status: 'cancelled' }] }),
			sink,
		)
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: false })

		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://agents.test:8000/agents/assistant')
		expect(init.method).toBe('POST')
		const headers = init.headers as Record<string, string>
		expect(Object.keys(headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type'])
		expect(headers['Content-Type']).toBe('application/json')
		expect(headers.Accept).toBe('text/event-stream')

		const token = headers.Authorization.replace(/^Bearer /, '')
		const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
			issuer: 'nextjs-bff',
			audience: 'assistant',
		})
		expect(protectedHeader).toEqual({ alg: 'HS256', typ: 'JWT' })
		expect(payload).toMatchObject({ sub: 'account-1', auth_source: 'ldap', roles: ['user'] })
		expect(payload.exp! - payload.iat!).toBe(60)
		expect(payload).not.toHaveProperty('email')
		expect(payload).not.toHaveProperty('name')

		const body = JSON.parse(String(init.body))
		expect(body).toMatchObject({
			threadId: 'conversation-1',
			runId: 'run-1',
			messages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
			state: { steps: [] },
			tools: [],
			context: [],
			forwardedProps: {},
			resume: [{ interruptId: 'int-1', status: 'cancelled' }],
		})
	})

	// Spec §2.3: a token minted for each request.
	it('mints a fresh token for every run, valid for 60 s from that run', async () => {
		// Only Date is faked (Vitest `vi.useFakeTimers({ toFake })`): the stream's own timers keep running.
		vi.useFakeTimers({ toFake: ['Date'] })
		fetchMock.mockImplementation(async () => sse(finishedRun))
		const issuedAt: number[] = []
		for (const [runId, time] of [
			['run-1', '2026-10-14T10:00:00Z'],
			['run-2', '2026-10-14T10:05:00Z'],
		]) {
			vi.setSystemTime(new Date(time))
			await aguiChat.runTurn(app, input({ runId }), recordingSink().sink).finished
			const init = fetchMock.mock.calls.at(-1)![1] as RequestInit
			const token = (init.headers as Record<string, string>).Authorization.replace(/^Bearer /, '')
			const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
				issuer: 'nextjs-bff',
				audience: 'assistant',
				currentDate: new Date(time),
			})
			issuedAt.push(payload.iat!)
		}
		vi.useRealTimers()
		expect(issuedAt[1] - issuedAt[0]).toBe(300)
	})

	// Spec §3.2 step 2: the session reads the client's own message list and the applied state.
	it('reports each event before it is applied, then the message list and the state after it', async () => {
		fetchMock.mockResolvedValue(sse(finishedRun))
		const { events, lists, states, sink } = recordingSink()
		await aguiChat.runTurn(app, input(), sink).finished
		expect(events.map(event => event.type)).toEqual([
			'RUN_STARTED',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'STATE_DELTA',
			'RUN_FINISHED',
		])
		expect(lists.at(-1)).toEqual([
			{ id: 'user-1', role: 'user', content: 'Hi' },
			{ id: 'm-1', role: 'assistant', content: 'Hello' },
		])
		expect(states).toEqual([{ steps: [{ description: 'Read', status: 'pending' }] }])
	})

	// Spec §4.3 step 4 and §2.4: a refusal before the stream; the agent's error text is neither read nor logged.
	it.each([
		[401, 'agent_auth_failed'],
		[404, 'agent_not_found'],
		[422, 'agent_rejected_input'],
		[500, 'upstream_error'],
	])('settles opened with the code of a %i and never reads its body', async (status, code) => {
		const pull = vi.fn()
		const cancel = vi.fn()
		// highWaterMark 0: nothing is pulled until someone reads (MDN ReadableStream(), queuingStrategy).
		const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 })
		fetchMock.mockResolvedValue(
			new Response(body, { status, headers: { 'content-type': 'application/json' } }),
		)
		const { events, sink } = recordingSink()
		const handle = aguiChat.runTurn(app, input(), sink)
		await expect(handle.opened).resolves.toEqual({ ok: false, code })
		await expect(handle.finished).resolves.toEqual({ failed: true })
		expect(pull).not.toHaveBeenCalled()
		expect(cancel).toHaveBeenCalledOnce()
		expect(events).toEqual([])
	})

	it('reads a refused connection as provider_unreachable', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'))
		const handle = aguiChat.runTurn(app, input(), recordingSink().sink)
		await expect(handle.opened).resolves.toEqual({ ok: false, code: 'provider_unreachable' })
		await expect(handle.finished).resolves.toEqual({ failed: true })
	})

	// Spec §4.5: the hub's abort mid-stream; the client's own RUN_ERROR reaches the sink, which drops it (Task 10).
	it('ends without a failure when the hub aborts mid-stream', async () => {
		const opening = [
			ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
			ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hel' }),
		]
		fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const event of opening)
						controller.enqueue(new TextEncoder().encode(encoder.encodeSSE(event)))
					// What fetch does to a body whose request is aborted (MDN AbortController: the body's read rejects).
					init.signal!.addEventListener('abort', () =>
						controller.error(new DOMException('This operation was aborted', 'AbortError')),
					)
				},
			})
			return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
		})
		const turn = input()
		const { events, sink } = recordingSink()
		const handle = aguiChat.runTurn(app, turn, {
			...sink,
			event: event => {
				sink.event(event)
				if (event.type === 'TEXT_MESSAGE_CONTENT') turn.abortController.abort()
			},
		})
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: false })
		expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'abort' })
	})

	it('opens a run the hub aborted before the agent answered, with nothing streamed', async () => {
		// What fetch does with an aborted signal: it rejects with an AbortError, at once if the signal is already aborted
		// (MDN fetch(): "AbortError … The request was aborted due to a call to the AbortController abort() method").
		fetchMock.mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					const abort = () => reject(new DOMException('This operation was aborted', 'AbortError'))
					if (init.signal!.aborted) abort()
					else init.signal!.addEventListener('abort', abort)
				}),
		)
		const turn = input()
		const { events, sink } = recordingSink()
		const handle = aguiChat.runTurn(app, turn, sink)
		turn.abortController.abort()
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: false })
		expect(events).toEqual([])
	})

	it('fails a stream that breaks the protocol', async () => {
		// verifyEvents: content for a message that never started is fatal (src/verify/verify.ts).
		fetchMock.mockResolvedValue(
			sse([
				ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
				ev('TEXT_MESSAGE_CONTENT', { messageId: 'nowhere', delta: 'x' }),
			]),
		)
		const handle = aguiChat.runTurn(app, input(), recordingSink().sink)
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: true })
	})
})
```

In `__tests__/provider-registry.test.ts`, replace `import { PROVIDERS } from '@/lib/providers/registry'` with these two imports (oxfmt orders them):

```ts
import { aguiChat } from '@/lib/providers/agui/chat'
import { chatAdapterOf, PROVIDERS } from '@/lib/providers/registry'
```

and add at the end of the file:

```ts
// Spec §4.1: the shared chat reaches a provider's turn through the registry; Dify has none until Part 3.
describe('chatAdapterOf', () => {
	it('gives the AG-UI adapter, and none for Dify', () => {
		expect(chatAdapterOf('agui')).toBe(aguiChat)
		expect(chatAdapterOf('dify')).toBeUndefined()
	})
})
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts` Expected: FAIL — `Failed to resolve import "@/lib/providers/agui/chat"`.

- [ ] **Step 4: Write `lib/chat/adapter.ts`** (the Shared contracts' text, with its comments):

```ts
import 'server-only'

import type { BaseEvent, Message, ResumeEntry, Tool } from '@ag-ui/core'

import type { ProviderCaller } from '@/lib/providers/caller'
import type { ProviderId } from '@/lib/providers/ids'
import type { ProviderSecrets, ProviderSettings } from '@/lib/providers/schemas'

/*
 * The shared chat's seam toward a provider (Part 2 spec §4.1): the run route (lib/chat/run.ts) builds one turn's input
 * from the store, the provider's adapter runs it and reports AG-UI events to a sink, and the run session
 * (lib/chat/session.ts) stores and forwards them. AG-UI's adapter is lib/providers/agui/chat.ts; Part 3 adds Dify's
 * translating one. The browser contract stays AG-UI either way (decision 52).
 */

/** What a provider's chat adapter is given for one turn (spec §4.1, §4.3 step 3). */
export interface ChatTurnInput {
	/** The conversation id: the AG-UI threadId (spec §3.1). */
	threadId: string
	/** Minted by the hub, never reused (spec §3.1). */
	runId: string
	/** The stored thread as threadForAgent() built it (lib/chat/thread.ts): seq order, no activity messages. */
	messages: Message[]
	state: unknown
	/** 2a: always [] (plan call P4). */
	tools: Tool[]
	resume?: ResumeEntry[]
	caller: ProviderCaller
	/** Owned by the run session; aborting it closes the upstream request (spec §4.5). */
	abortController: AbortController
}

/** Where an adapter reports the run (the run session implements it). */
export interface ChatTurnSink {
	/** Each event after the client's compatibility boundary, enforcement and verification, before it is applied. */
	event(event: BaseEvent): void
	/** The thread's whole message list after an event changed it. */
	messages(messages: readonly Message[]): void
	/** The thread's state after an event changed it. */
	state(state: unknown): void
}

export type UpstreamErrorCode =
	| 'agent_auth_failed'
	| 'agent_not_found'
	| 'agent_rejected_input'
	| 'provider_unreachable'
	| 'upstream_error'

/** Spec §4.3 step 4 and plan call P5: each code's HTTP status toward the browser. */
export const UPSTREAM_STATUS: Record<UpstreamErrorCode, number> = {
	agent_auth_failed: 502,
	agent_not_found: 502,
	agent_rejected_input: 502,
	provider_unreachable: 503,
	upstream_error: 502,
}

export type ChatTurnOpened = { ok: true } | { ok: false; code: UpstreamErrorCode }

export interface ChatTurnHandle {
	/** Settles once the agent answered: with a stream (ok), or with why not (spec §4.3 step 4). Never rejects. */
	opened: Promise<ChatTurnOpened>
	/** Settles when the run is over, however it ended. `failed` when the stream broke with an error that is not an abort. Never rejects. */
	finished: Promise<{ failed: boolean }>
}

export interface ChatAdapter<P extends ProviderId> {
	runTurn(
		app: { settings: ProviderSettings<P>; secrets: ProviderSecrets<P> },
		input: ChatTurnInput,
		sink: ChatTurnSink,
	): ChatTurnHandle
}
```

- [ ] **Step 5: Write `lib/providers/agui/chat.ts`**

```ts
import 'server-only'

import { HttpAgent } from '@ag-ui/client'

import type { ChatAdapter, ChatTurnOpened, UpstreamErrorCode } from '@/lib/chat/adapter'
import { env } from '@/lib/env'

import { mintAgentToken } from './jwt'

/**
 * Part 2 spec §4.3 step 4: the agent's refusal before any stream, as the hub's code. The owner's service answers 401 for a
 * bad or expired token, 404 for an unknown agent, 415 for a body that is not JSON and 422 for an invalid one (spec §2.3;
 * Pydantic AI's `dispatch_request`: 415 and 422, `ui/_adapter.py`); 403 is a refusal of the caller too. Anything else is
 * the hub's existing `upstream_error` (plan call P5).
 */
export const upstreamCodeFor = (status: number): UpstreamErrorCode => {
	if (status === 401 || status === 403) return 'agent_auth_failed'
	if (status === 404) return 'agent_not_found'
	if (status === 415 || status === 422) return 'agent_rejected_input'
	return 'upstream_error'
}

/**
 * AG-UI's chat adapter (spec §4.3 step 3): one `HttpAgent` per run, run with `runAgent()`, the documented path that applies
 * `@ag-ui/client`'s 0.x → 1.0 compatibility boundary, enforcement and verification (docs.ag-ui.com "HttpAgent" and
 * "AbstractAgent"; research `part2-proxy-stop-identity.md` §1.2; `run()` would hand over raw events). CopilotKit's runtime
 * consumes an upstream agent the same way (`runner/in-memory.ts`: `agent.runAgent(input, { onEvent })`).
 *
 * The request (spec §2.3): `HttpAgent` posts the `RunAgentInput` with `Content-Type: application/json` and `Accept:
 * text/event-stream` (src/agent/http.ts `requestInit`); the hub adds exactly one header, `Authorization: Bearer <JWT>`,
 * minted for this request. `tools`, `context` and `forwardedProps` are always sent (Pydantic AI on protocol 0.1.22
 * requires them; spec §4.3 step 3).
 *
 * The `fetch` option (in the 1.0.2 typings, `HttpAgentConfig.fetch`; the docs page shows only `url` and `headers`) is where
 * the hub sees the agent's status before it answers the browser (spec §4.3 step 4): a refusal settles `opened` with its
 * code and hands the client an empty body of the same status, so the agent's error text is never read, logged or passed
 * on (spec §2.4: "none is echoed"); the client then fails the run with "HTTP <status>: " (src/run/http-request.ts), which
 * `runAgent` rejects with and the adapter takes as `failed`. A fetch that rejects is an agent that did not answer
 * (`provider_unreachable`), unless the hub aborted it itself: a Stop or the browser leaving before the agent answered
 * opens the run as `{ ok: true }` with nothing streamed, and the session closes it as cancelled or truncated (spec §4.5).
 *
 * The subscriber's hooks are the documented `AgentSubscriber` ones (docs.ag-ui.com "AbstractAgent", subscribers;
 * `index.d.ts` `AgentSubscriber`): `onEvent` sees each event before it is applied, `onMessagesChanged` and
 * `onStateChanged` the applied lists (src/agent/agent.ts `processApplyEvents`). An abort is not a failure: the client
 * swallows an `AbortError` and, mid-stream, emits its own `RUN_ERROR { code: 'abort' }` (src/transform/http.ts), which the
 * session drops.
 */
export const aguiChat: ChatAdapter<'agui'> = {
	runTurn({ settings, secrets }, input, sink) {
		const { signal } = input.abortController
		let open: (value: ChatTurnOpened) => void = () => undefined
		const opened = new Promise<ChatTurnOpened>(resolve => {
			open = resolve
		})
		const fetchUpstream = async (url: string, init: RequestInit): Promise<Response> => {
			let response: Response
			try {
				response = await fetch(url, init)
			} catch (error) {
				open(signal.aborted ? { ok: true } : { ok: false, code: 'provider_unreachable' })
				throw error
			}
			if (response.ok) {
				open({ ok: true })
				return response
			}
			open({ ok: false, code: upstreamCodeFor(response.status) })
			// Streams API: cancel() discards the body unread and releases the connection (MDN ReadableStream.cancel()).
			await response.body?.cancel()
			return new Response(null, { status: response.status })
		}
		const finished = (async () => {
			try {
				const token = await mintAgentToken({
					caller: input.caller,
					secret: secrets.jwtSecret,
					audience: settings.audience,
					issuer: env().agentJwtIssuer,
				})
				const agent = new HttpAgent({
					url: settings.agentUrl,
					headers: { Authorization: `Bearer ${token}` },
					threadId: input.threadId,
					initialMessages: input.messages,
					initialState: input.state,
					fetch: fetchUpstream,
				})
				await agent.runAgent(
					{
						runId: input.runId,
						tools: input.tools,
						context: [],
						forwardedProps: {},
						...(input.resume ? { resume: input.resume } : {}),
						abortController: input.abortController,
					},
					{
						onEvent: ({ event }) => {
							sink.event(event)
						},
						onMessagesChanged: ({ messages }) => {
							sink.messages(messages)
						},
						onStateChanged: ({ state }) => {
							sink.state(state)
						},
					},
				)
				return { failed: false }
			} catch {
				// A refusal, a refused connection, a stream that broke or failed verification; an abort is the hub's own.
				return { failed: !signal.aborted }
			} finally {
				// A run that ended before any request (the outgoing input refused by the client's enforcement) never opened.
				open({ ok: false, code: 'upstream_error' })
			}
		})()
		return { opened, finished }
	},
}
```

- [ ] **Step 6: Give the registry its `chat` field and lookup.** In `lib/providers/registry.ts`, add the type import beside the others:

```ts
import type { ChatAdapter } from '@/lib/chat/adapter'
```

In `ProviderDefinition<P>`, right after the `hubHistory: boolean` member Task 4 wrote, add:

```ts
	/**
	 * Part 2 spec §4.1: runs one chat turn; only a provider on the shared chat has one (AG-UI now, Dify in Part 3). A method
	 * signature in ChatAdapter, so `ChatAdapter<ProviderId>` takes each provider's adapter (TypeScript handbook, "Method
	 * Bivariance").
	 */
	chat?: ChatAdapter<P>
```

At the end of the file, after Task 4's `providerDefinition`, add:

```ts
/**
 * Spec §4.1: the provider's chat adapter, or undefined for a provider not on the shared chat (Dify until Part 3). Read
 * through `providerDefinition`, whose mapped-type view gives each provider's definition its `chat` (Task 4).
 */
export const chatAdapterOf = (provider: ProviderId): ChatAdapter<ProviderId> | undefined =>
	providerDefinition(provider).chat
```

In `lib/providers/agui/provider.ts`, import the adapter (`import { aguiChat } from './chat'`, placed by oxfmt among the relative imports) and add `chat: aguiChat,` right after the `hubHistory: true,` line.

- [ ] **Step 7: Run the tests and see them pass**

Run: `pnpm exec vitest run --project unit __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts` Expected: both files pass, `agui-chat.test.ts` with `Tests  20 passed (20)`.

- [ ] **Step 8: Gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint lib/chat/adapter.ts lib/providers/agui/chat.ts lib/providers/agui/provider.ts lib/providers/registry.ts __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts && pnpm exec oxfmt --check lib/chat/adapter.ts lib/providers/agui/chat.ts lib/providers/agui/provider.ts lib/providers/registry.ts __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts && pnpm test` Expected: all exit 0; `pnpm test` green (the boundary test still passes: nothing neutral imports `lib/providers/agui`).

- [ ] **Step 9: Commit**

```bash
git add lib/chat/adapter.ts lib/providers/agui/chat.ts lib/providers/agui/provider.ts lib/providers/registry.ts __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts
git commit -m "feat(agui): run a chat turn through HttpAgent with a fresh agent JWT

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/adapter.ts", "lib/providers/agui/chat.ts", "lib/providers/registry.ts", "lib/providers/agui/provider.ts", "__tests__/agui-chat.test.ts", "__tests__/provider-registry.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/agui-chat.test.ts __tests__/provider-registry.test.ts", "acceptanceCriteria": ["`pnpm exec vitest run --project unit __tests__/agui-chat.test.ts` reports 20 passed", "the request carries exactly the headers `Accept`, `Authorization`, `Content-Type`, and its JWT verifies with `jose` `jwtVerify` (HS256, `iss` `nextjs-bff`, `aud` the app's audience, `sub`, `auth_source`, `roles`, `exp - iat = 60`, no `email` or `name`)", "a 401, 404, 422 or 500 before the stream settles `opened` with `agent_auth_failed`, `agent_not_found`, `agent_rejected_input` or `upstream_error`, and the body's `pull` is never called (unread) while its `cancel` is called once", "a refused connection settles `opened` with `provider_unreachable`; an abort mid-stream finishes `{ failed: false }` and the sink's last event is `RUN_ERROR` with code `abort`", "`chatAdapterOf('agui')` is `aguiChat` and `chatAdapterOf('dify')` is `undefined` (`__tests__/provider-registry.test.ts`)", "tsc, oxlint and oxfmt pass on the changed files, and `pnpm test` is green"], "modelTier": "standard"}
```

---

### Task 10: The run session — storing a run and streaming it to the browser

**Goal:** `lib/chat/stream.ts` streams AG-UI events as SSE with keep-alives, `lib/chat/active-runs.ts` holds each run's AbortController, and `lib/chat/session.ts`'s `RunSession` stores a run's rows as it streams (spec §3.2), forwards what the browser reads (spec §4.4) and closes the run as succeeded, interrupted, cancelled, failed or truncated (spec §4.5).

Spec §3.2 steps 2–4, §4.4, §4.5; plan call P6; research `part2-proxy-stop-identity.md` §3 and implications B1–B4 (CopilotKit's finaliser, LibreChat's abort, Open WebUI's task stop). Depends on Task 6 (`saveMessages`, `saveState`, `finishRun`, `errorToolMessage`, `STOPPED_TOOL_ERROR`, `STOPPED_TOOL_CONTENT`), Task 8 (`HUB_RUN_EVENT`, `RUN_CANCELLED_EVENT`) and Task 9 (`ChatTurnSink`; `aguiChat` for the end-to-end case). Task 11's run route drives it: `start()`, the adapter's sink calls, then `finish({ failed, stopReason })` once, then the stream's `close()`.

Design (the parts the spec leaves to the plan):

- **Two hooks, two moments.** `event()` sees an event before the client applies it; `messages()` and `state()` see the applied list and state (Task 9). An end event (`TEXT_MESSAGE_END`, `REASONING_MESSAGE_END`, `TOOL_CALL_END`) changes no message, so the rows are written at the end event itself; a start, a tool result or an activity change is written at the next message list. Between them, text is written at most every `SAVE_INTERVAL_MS` (2 s; spec §3.2 step 2).
- **Only changed rows.** The session remembers each row's last JSON (body and status); the thread the agent was given seeds that memory, so history is never written back. A row is `streaming` while its text, its reasoning or one of its tool calls' arguments are open, else `complete`.
- **One write after another.** Writes go through one promise chain (a failed write is logged with `logActionError` and the chain goes on); `finish` awaits it before `finishRun`.
- **The end.** A terminal event from the agent decides (a `run_cancelled` CUSTOM turns a finish into `cancelled`); otherwise the stop reason (`stop` → cancelled, `disconnect` → truncated); otherwise failed `upstream_error` (P6). The `failed` flag changes nothing once a terminal event came, and without one the run failed either way. Stop, failure and truncation carry `close`: the open rows to mark incomplete and a `STOPPED_TOOL_ERROR` tool message per call this run started without a result (spec §3.2 step 4). A `finishRun` that throws is logged: the run stays `running` with no process holding it, and the next request truncates it (spec §3.2 step 5; Task 11).
- **The hub's names.** A producer's CUSTOM event named `hub:*` is neither forwarded (the browser trusts `hub:run`) nor kept among the run's custom events.

**Files:**

- Create: `lib/chat/active-runs.ts`, `lib/chat/stream.ts`, `lib/chat/session.ts`
- Test: `__tests__/chat-stream.test.ts`, `__tests__/chat-session.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-stream.test.ts __tests__/chat-session.test.ts` reports 24 passed (4 and 20)
- [ ] the stream writes one `data: <json>` line per event and `: keep-alive` after 15 s without a write; `close()` twice and a write after cancel throw nothing and leave no timer
- [ ] `RunSession` writes `hub:run` first; never forwards `RAW`, `REASONING_ENCRYPTED_VALUE`, `MESSAGES_SNAPSHOT`, `STATE_SNAPSHOT`, `STATE_DELTA`, `ACTIVITY_DELTA`, a CUSTOM `hub:*` or `RUN_ERROR` code `abort`; strips `rawEvent`; sends the applied state as `STATE_SNAPSHOT` and a delta-changed activity as `ACTIVITY_SNAPSHOT`
- [ ] rows are written when a message starts and ends and at most every 2 s between (the throttle case's writes are `m-1` streaming '', streaming 'ab', complete 'abc'), one write after another, and the thread given is never written back
- [ ] `finish` stores succeeded, interrupted, cancelled (run_timeout) and failed with the agent's code; a Stop without a terminal event sends the closings then `RUN_FINISHED` cancelled; a disconnect is truncated with nothing sent; no terminal event is failed `upstream_error` with `RUN_ERROR upstream_error` sent; a run with no events is cancelled (stop) or truncated (disconnect), never failed
- [ ] stop, failure and truncation carry `close` with the open message ids and one `STOPPED_TOOL_ERROR` tool message per cut-off call; a failure logs `'Chat run failed:', { appId, runId, code }`
- [ ] behind the real `aguiChat` on a stubbed fetch, the stored rows are the client's final messages (`m-1` with its tool call, `t-1`), both `complete`
- [ ] tsc, oxlint and oxfmt pass on the changed files, and `pnpm test` is green

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-stream.test.ts __tests__/chat-session.test.ts` → `Tests  24 passed (24)`

**Steps:**

- [ ] **Step 1: Check the docs.** Next's bundled `node_modules/next/dist/docs/01-app/02-guides/streaming.md`: "Streaming in Route Handlers" and "What can affect streaming" (`X-Accel-Buffering`). MDN: `ReadableStream()` (`start` runs at construction; `cancel`), `ReadableStreamDefaultController.enqueue()` (throws once closed), `AbortController.abort()` (the default reason is an `AbortError` DOMException). Context7 `/ag-ui-protocol/ag-ui`: the HTTP + SSE binding (comment lines, one event per `data:`), "Events" › lifecycle (cancelled versus truncated runs: the hub is the browser's producer, so it closes a stopped run in order), "Tool calls". `@ag-ui/encoder`'s `EventEncoder.encodeSSE` (`node_modules/@ag-ui/encoder/dist/index.d.ts`).

- [ ] **Step 2: Write the failing tests.** Create `__tests__/chat-stream.test.ts`:

```ts
import type { BaseEvent } from '@ag-ui/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEventStream, KEEP_ALIVE_MS, SSE_HEADERS } from '@/lib/chat/stream'

const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent

/** Everything the stream has queued so far, as text (the reader is released, so the stream stays readable). */
const drain = async (stream: ReadableStream<Uint8Array>, chunks: number) => {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	let text = ''
	for (let i = 0; i < chunks; i++) {
		const { value, done } = await reader.read()
		if (done) break
		text += decoder.decode(value)
	}
	reader.releaseLock()
	return text
}

afterEach(() => {
	vi.useRealTimers()
})

describe('createEventStream', () => {
	// AG-UI HTTP + SSE binding: one event per `data:` line, LF framing (@ag-ui/encoder encodeSSE).
	it('writes each event as one SSE data line', async () => {
		const out = createEventStream()
		out.write(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hi' }))
		out.write(ev('RUN_FINISHED', { threadId: 't', runId: 'r' }))
		expect(await drain(out.stream, 2)).toBe(
			'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m-1","delta":"Hi"}\n\n' +
				'data: {"type":"RUN_FINISHED","threadId":"t","runId":"r"}\n\n',
		)
	})

	// Spec §4.4: a keep-alive comment after 15 s of silence, the timer restarted by every write.
	it('sends a keep-alive comment after 15 s without an event', async () => {
		vi.useFakeTimers()
		const out = createEventStream()
		vi.advanceTimersByTime(KEEP_ALIVE_MS - 1)
		out.write(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'a' }))
		vi.advanceTimersByTime(KEEP_ALIVE_MS - 1)
		const reader = out.stream.getReader()
		const first = await reader.read()
		expect(new TextDecoder().decode(first.value)).toContain('"delta":"a"')
		vi.advanceTimersByTime(1)
		const second = await reader.read()
		expect(new TextDecoder().decode(second.value)).toBe(': keep-alive\n\n')
	})

	it('closes once, and drops writes after it is closed or cancelled', async () => {
		vi.useFakeTimers()
		const out = createEventStream()
		out.write(ev('RUN_STARTED', { threadId: 't', runId: 'r' }))
		out.close()
		out.close()
		out.write(ev('RUN_FINISHED', { threadId: 't', runId: 'r' }))
		const reader = out.stream.getReader()
		expect((await reader.read()).done).toBe(false)
		expect((await reader.read()).done).toBe(true)
		expect(vi.getTimerCount()).toBe(0)

		const cancelled = createEventStream()
		await cancelled.stream.cancel()
		expect(() => cancelled.write(ev('RUN_STARTED', { threadId: 't', runId: 'r' }))).not.toThrow()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('names the stream headers of spec §4.4', () => {
		expect(SSE_HEADERS).toEqual({
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no',
		})
	})
})
```

Create `__tests__/chat-session.test.ts`:

```ts
import type { BaseEvent, Message } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { saveMessages, saveState, finishRun } = vi.hoisted(() => ({
	saveMessages: vi.fn(),
	saveState: vi.fn(),
	finishRun: vi.fn(),
}))
vi.mock('@/lib/data/conversations', () => ({ saveMessages, saveState, finishRun }))
vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))

import { BROKEN_STREAM_TEXT, RunSession, SAVE_INTERVAL_MS } from '@/lib/chat/session'
import { STOPPED_TOOL_CONTENT, STOPPED_TOOL_ERROR } from '@/lib/chat/thread'
import { aguiChat } from '@/lib/providers/agui/chat'

const KEY = { conversationId: 'conversation-1', runId: 'run-1' }
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const USER: Message = { id: 'user-1', role: 'user', content: 'Hi' }
const assistant = (
	content: string,
	toolCalls?: { id: string; name: string; args: string }[],
): Message => ({
	id: 'm-1',
	role: 'assistant',
	content,
	...(toolCalls
		? {
				toolCalls: toolCalls.map(call => ({
					id: call.id,
					type: 'function',
					function: { name: call.name, arguments: call.args },
				})),
			}
		: {}),
})

let clock = 0
const setup = () => {
	const out: BaseEvent[] = []
	const session = new RunSession({
		key: KEY,
		appId: 'app-1',
		title: 'Hi',
		history: [USER],
		out: { write: event => void out.push(event) },
		now: () => clock,
	})
	return { out, session, types: () => out.map(event => event.type) }
}
/** All rows written so far, by message id: the last status and body each id was written with. */
const writtenRows = () =>
	Object.fromEntries(
		saveMessages.mock.calls.flatMap(([, rows]) =>
			(rows as { message: Message; status: string }[]).map(row => [row.message.id, row]),
		),
	)

beforeEach(() => {
	clock = 1_000_000
	saveMessages.mockReset().mockResolvedValue(undefined)
	saveState.mockReset().mockResolvedValue(undefined)
	finishRun.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('RunSession toward the browser (spec §4.4)', () => {
	it('names the run first, in hub:run', () => {
		const { out, session } = setup()
		session.start()
		expect(out).toEqual([
			{
				type: 'CUSTOM',
				name: 'hub:run',
				value: { conversationId: 'conversation-1', runId: 'run-1', title: 'Hi' },
			},
		])
	})

	it('passes the rendered events on, without their raw provider event', () => {
		const { out, session } = setup()
		session.event(
			ev('TEXT_MESSAGE_START', {
				messageId: 'm-1',
				role: 'assistant',
				rawEvent: { provider: 'x' },
			}),
		)
		session.event(ev('RUN_ERROR', { code: 'busy', message: 'Try again soon.' }))
		expect(out).toEqual([
			{ type: 'TEXT_MESSAGE_START', messageId: 'm-1', role: 'assistant' },
			{ type: 'RUN_ERROR', code: 'busy', message: 'Try again soon.' },
		])
	})

	it('keeps raw, encrypted, snapshot and delta events, the hub’s own names and the client’s abort error on the server', () => {
		const { out, session } = setup()
		for (const event of [
			ev('RAW', { event: {} }),
			ev('REASONING_ENCRYPTED_VALUE', {
				subtype: 'message',
				entityId: 'r-1',
				encryptedValue: 'opaque',
			}),
			ev('MESSAGES_SNAPSHOT', { messages: [] }),
			ev('STATE_SNAPSHOT', { snapshot: {} }),
			ev('STATE_DELTA', { delta: [] }),
			ev('ACTIVITY_DELTA', { messageId: 'a-1', activityType: 'progress', patch: [] }),
			ev('CUSTOM', { name: 'hub:run', value: { runId: 'spoofed' } }),
			ev('RUN_ERROR', { code: 'abort', message: 'This operation was aborted' }),
		])
			session.event(event)
		expect(out).toEqual([])
	})

	it('sends the applied state as a snapshot and stores it', async () => {
		const { out, session } = setup()
		session.event(ev('STATE_DELTA', { delta: [{ op: 'add', path: '/done', value: true }] }))
		session.state({ done: true })
		expect(out).toEqual([{ type: 'STATE_SNAPSHOT', snapshot: { done: true } }])
		await session.finish({ failed: false })
		expect(saveState).toHaveBeenCalledWith(KEY, { done: true })
	})

	it('sends an activity a delta changed as a snapshot of the patched message', () => {
		const { out, session } = setup()
		session.event(
			ev('ACTIVITY_DELTA', {
				messageId: 'a-1',
				activityType: 'progress',
				patch: [{ op: 'replace', path: '/done', value: 2 }],
			}),
		)
		session.messages([
			USER,
			{ id: 'a-1', role: 'activity', activityType: 'progress', content: { done: 2 } },
		])
		expect(out).toEqual([
			{
				type: 'ACTIVITY_SNAPSHOT',
				messageId: 'a-1',
				activityType: 'progress',
				content: { done: 2 },
				replace: true,
			},
		])
	})
})

// Spec §3.2 step 2: rows by message id when a message starts, ends, its tool result arrives, and every 2 s of text.
describe('RunSession storing the rows (spec §3.2)', () => {
	it('writes a message when it starts and ends, and its text at most every 2 s between', async () => {
		const { session } = setup()
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		// A delta every second: the first comes 1 s after the start's write, the second 2 s after it.
		for (const [i, delta] of ['a', 'b', 'c'].entries()) {
			clock += SAVE_INTERVAL_MS / 2
			session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta }))
			session.messages([USER, assistant('abc'.slice(0, i + 1))])
		}
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		await session.finish({ failed: false })
		const calls = saveMessages.mock.calls.map(([, rows]) =>
			(rows as { message: Message; status: string }[]).map(row => [
				row.message.id,
				row.status,
				(row.message as { content?: string }).content,
			]),
		)
		expect(calls).toEqual([
			[['m-1', 'streaming', '']],
			[['m-1', 'streaming', 'ab']],
			[['m-1', 'complete', 'abc']],
		])
	})

	it('never writes back a row of the thread it was given', async () => {
		const { session } = setup()
		session.event(ev('TOOL_CALL_RESULT', { messageId: 't-1', toolCallId: 'call-1', content: 'ok' }))
		session.messages([USER, { id: 't-1', role: 'tool', toolCallId: 'call-1', content: 'ok' }])
		await session.finish({ failed: false })
		expect(Object.keys(writtenRows())).toEqual(['t-1'])
	})

	it('writes the rows one after another', async () => {
		const order: string[] = []
		let release: () => void = () => undefined
		saveMessages.mockImplementationOnce(
			() => new Promise<void>(resolve => (release = () => (order.push('first'), resolve()))),
		)
		saveMessages.mockImplementation(async () => void order.push('second'))
		const { session } = setup()
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'done' }))
		session.messages([USER, assistant('done')])
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		const finished = session.finish({ failed: false })
		await Promise.resolve()
		expect(order).toEqual([])
		release()
		await finished
		expect(order).toEqual(['first', 'second'])
	})
})

describe('RunSession.finish (spec §3.2 steps 3–4, §4.5; plan call P6)', () => {
	const streamText = (session: RunSession) => {
		session.event(ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }))
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Part' }))
		session.messages([USER, assistant('Part')])
	}

	it('stores a finished run as succeeded with its outcome and usage', async () => {
		const { session } = setup()
		streamText(session)
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		session.event(
			ev('RUN_FINISHED', {
				threadId: 'conversation-1',
				runId: 'run-1',
				outcome: { type: 'success' },
				usage: [{ inputTokens: 3, outputTokens: 5 }],
			}),
		)
		const end = await session.finish({ failed: false })
		expect(end).toEqual({
			status: 'succeeded',
			outcome: { type: 'success' },
			usage: [{ inputTokens: 3, outputTokens: 5 }],
			custom: [],
		})
		expect(finishRun).toHaveBeenCalledWith(KEY, end)
	})

	it('stores an interrupted run with its interrupts', async () => {
		const { session } = setup()
		const outcome = {
			type: 'interrupt',
			interrupts: [{ id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }],
		}
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1', outcome }))
		expect(await session.finish({ failed: false })).toMatchObject({
			status: 'interrupted',
			outcome,
		})
	})

	// Spec §2.3: the agent's time limit is CUSTOM run_cancelled, then RUN_FINISHED.
	it('stores an agent’s time limit as cancelled, with the custom event', async () => {
		const { out, session } = setup()
		streamText(session)
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		session.event(ev('CUSTOM', { name: 'run_cancelled', value: { reason: 'run_timeout' } }))
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }))
		const end = await session.finish({ failed: false })
		expect(end).toMatchObject({
			status: 'cancelled',
			custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }],
		})
		expect(out.at(-1)).toMatchObject({ type: 'RUN_FINISHED' })
	})

	it('stores a RUN_ERROR as failed with the agent’s code, closing what was open', async () => {
		const { session } = setup()
		streamText(session)
		session.event(
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
		)
		session.messages([USER, assistant('Part', [{ id: 'call-1', name: 'search', args: '' }])])
		session.event(ev('RUN_ERROR', { code: 'model_unavailable', message: 'The model is down.' }))
		const end = await session.finish({ failed: false })
		expect(end).toMatchObject({
			status: 'failed',
			error: { code: 'model_unavailable', message: 'The model is down.' },
		})
		expect(end.close?.messageIds).toEqual(['m-1'])
		expect(end.close?.toolMessages).toEqual([
			{
				id: expect.any(String),
				role: 'tool',
				toolCallId: 'call-1',
				content: STOPPED_TOOL_CONTENT,
				error: STOPPED_TOOL_ERROR,
			},
		])
	})

	// Spec §4.5: the hub's Stop. The client's abort error is dropped; the hub closes the run in order as cancelled.
	it('closes a stopped run toward the browser and stores it cancelled', async () => {
		const { out, session } = setup()
		streamText(session)
		session.event(ev('REASONING_START', { messageId: 'r-1' }))
		session.event(
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
		)
		session.messages([USER, assistant('Part', [{ id: 'call-1', name: 'search', args: '' }])])
		session.event(ev('RUN_ERROR', { code: 'abort', message: 'This operation was aborted' }))
		const before = out.length
		const end = await session.finish({ failed: false, stopReason: 'stop' })
		expect(out.slice(before)).toEqual([
			{ type: 'TOOL_CALL_END', toolCallId: 'call-1' },
			{ type: 'TEXT_MESSAGE_END', messageId: 'm-1' },
			{ type: 'REASONING_END', messageId: 'r-1' },
			{
				type: 'RUN_FINISHED',
				threadId: 'conversation-1',
				runId: 'run-1',
				outcome: { type: 'cancelled' },
			},
		])
		expect(end).toMatchObject({
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			close: { messageIds: ['m-1'] },
		})
		expect(end.close?.toolMessages).toHaveLength(1)
	})

	it('stores a run the browser left as truncated, and sends nothing more', async () => {
		const { out, session } = setup()
		streamText(session)
		const before = out.length
		const end = await session.finish({ failed: false, stopReason: 'disconnect' })
		expect(end).toMatchObject({
			status: 'truncated',
			close: { messageIds: ['m-1'], toolMessages: [] },
		})
		expect(out.length).toBe(before)
	})

	it.each([
		['broke off', true],
		['ended without a terminal event', false],
	])('fails a stream that %s, telling the browser (plan call P6)', async (_case, failed) => {
		const { out, session } = setup()
		streamText(session)
		const end = await session.finish({ failed })
		expect(end).toMatchObject({
			status: 'failed',
			error: { code: 'upstream_error' },
			close: { messageIds: ['m-1'] },
		})
		expect(out.at(-1)).toEqual({
			type: 'RUN_ERROR',
			code: 'upstream_error',
			message: BROKEN_STREAM_TEXT,
		})
		expect(console.error).toHaveBeenCalledWith('Chat run failed:', {
			appId: 'app-1',
			runId: 'run-1',
			code: 'upstream_error',
		})
	})

	// The run route ends a run the agent never answered when a stop reason was set before it did (Task 11).
	it('closes a run that saw no event: stopped as cancelled, left as truncated, never failed', async () => {
		const stopped = setup()
		expect(await stopped.session.finish({ failed: false, stopReason: 'stop' })).toEqual({
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			custom: [],
			close: { messageIds: [], toolMessages: [] },
		})
		expect(stopped.out).toEqual([
			{
				type: 'RUN_FINISHED',
				threadId: 'conversation-1',
				runId: 'run-1',
				outcome: { type: 'cancelled' },
			},
		])
		const left = setup()
		expect(await left.session.finish({ failed: true, stopReason: 'disconnect' })).toMatchObject({
			status: 'truncated',
		})
		expect(left.out).toEqual([])
		expect(saveMessages).not.toHaveBeenCalled()
	})

	it('lets the terminal event win over a stop that came after it', async () => {
		const { session } = setup()
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }))
		expect(await session.finish({ failed: false, stopReason: 'stop' })).toMatchObject({
			status: 'succeeded',
		})
	})

	it('logs a failed final write and still answers the end', async () => {
		finishRun.mockRejectedValue(
			Object.assign(new Error('connection lost'), { name: 'DatabaseError' }),
		)
		const { session } = setup()
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }))
		await expect(session.finish({ failed: false })).resolves.toMatchObject({ status: 'succeeded' })
		expect(console.error).toHaveBeenCalled()
	})
})

// The hook order the session relies on, through the real client (Task 9's adapter on a stubbed fetch).
describe('RunSession behind aguiChat', () => {
	it('stores the client’s message list and forwards the stream as the browser reads it', async () => {
		const encoder = new EventEncoder()
		const events = [
			ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
			ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hello' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-1' }),
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			ev('TOOL_CALL_RESULT', { messageId: 't-1', toolCallId: 'call-1', content: 'found' }),
			ev('STATE_SNAPSHOT', { snapshot: { n: 1 } }),
			ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }),
		]
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(events.map(event => encoder.encodeSSE(event)).join(''), {
						headers: { 'content-type': 'text/event-stream' },
					}),
			),
		)
		const { out, session, types } = setup()
		session.start()
		const handle = aguiChat.runTurn(
			{
				settings: { agentUrl: 'http://agents.test/agents/assistant', audience: 'assistant' },
				secrets: { jwtSecret: 'a-test-secret-of-at-least-32-characters' },
			},
			{
				threadId: 'conversation-1',
				runId: 'run-1',
				messages: [USER],
				state: {},
				tools: [],
				caller: { id: 'account-1', source: 'local', role: 'user' },
				abortController: new AbortController(),
			},
			session,
		)
		const { failed } = await handle.finished
		const end = await session.finish({ failed })
		expect(end.status).toBe('succeeded')
		expect(types()).toEqual([
			'CUSTOM',
			'RUN_STARTED',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'TOOL_CALL_START',
			'TOOL_CALL_ARGS',
			'TOOL_CALL_END',
			'TOOL_CALL_RESULT',
			'STATE_SNAPSHOT',
			'RUN_FINISHED',
		])
		expect(out.find(event => event.type === 'STATE_SNAPSHOT')).toEqual({
			type: 'STATE_SNAPSHOT',
			snapshot: { n: 1 },
		})
		const rows = writtenRows()
		expect(Object.keys(rows).sort()).toEqual(['m-1', 't-1'])
		expect(rows['m-1']).toEqual({
			message: {
				id: 'm-1',
				role: 'assistant',
				content: 'Hello',
				toolCalls: [
					{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
				],
			},
			status: 'complete',
		})
		expect(rows['t-1']).toEqual({
			message: { id: 't-1', role: 'tool', toolCallId: 'call-1', content: 'found' },
			status: 'complete',
		})
	})
})
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-stream.test.ts __tests__/chat-session.test.ts` Expected: FAIL — `Failed to resolve import "@/lib/chat/stream"` and `"@/lib/chat/session"`.

- [ ] **Step 4: Write `lib/chat/active-runs.ts`**

```ts
import 'server-only'

/*
 * The runs this process is streaming, by run id (spec §3.2 step 5, §4.5): the stop route aborts a run's upstream request
 * through its AbortController, and a run stored as `running` that no process holds is truncated by the next request. One
 * map per process; several hub containers would need a shared one (spec §3.2 step 5, a follow-up). The map lives on
 * globalThis so a development reload keeps it, as lib/directory/schedule.ts keeps its job (Rallly's guard).
 */

export type StopReason = 'stop' | 'disconnect'

interface ActiveRun {
	conversationId: string
	controller: AbortController
	reason?: StopReason
}

const globalForRuns = globalThis as unknown as { aiAppHubActiveRuns?: Map<string, ActiveRun> }
const runs = (globalForRuns.aiAppHubActiveRuns ??= new Map<string, ActiveRun>())

export const activeRuns = {
	register(runId: string, entry: { conversationId: string; controller: AbortController }): void {
		runs.set(runId, { ...entry })
	},
	/**
	 * Aborts the run's upstream request; false when this process holds no such run of this conversation. The first reason
	 * stays: a Stop followed by the browser closing the stream is still a Stop. `abort()` takes no reason on purpose: fetch
	 * rejects with the signal's reason (MDN AbortController.abort(): "reason … Defaults to an 'AbortError' DOMException"),
	 * and `@ag-ui/client` recognises an abort by the AbortError's name (src/transform/http.ts, src/agent/agent.ts onError).
	 */
	stop(runId: string, conversationId: string, reason: StopReason): boolean {
		const run = runs.get(runId)
		if (!run || run.conversationId !== conversationId) return false
		run.reason ??= reason
		run.controller.abort()
		return true
	},
	reasonOf(runId: string): StopReason | undefined {
		return runs.get(runId)?.reason
	},
	has(runId: string): boolean {
		return runs.has(runId)
	},
	release(runId: string): void {
		runs.delete(runId)
	},
}
```

- [ ] **Step 5: Write `lib/chat/stream.ts`**

```ts
import 'server-only'

import type { BaseEvent } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'

/** Spec §4.4: a comment after 15 s of silence keeps proxies from closing an idle stream (CopilotKit's default). */
export const KEEP_ALIVE_MS = 15_000

/**
 * Spec §4.4: the stream's headers. `no-transform` keeps intermediaries from compressing it; `X-Accel-Buffering: no` turns
 * nginx's buffering off (Next bundled docs, 02-guides/streaming.md "What can affect streaming").
 */
export const SSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache, no-transform',
	'X-Accel-Buffering': 'no',
}

/** AG-UI's HTTP + SSE binding: consumers "MUST tolerate SSE comment lines (`: keep-alive`)" (docs.ag-ui.com, http-sse). */
const KEEP_ALIVE = new TextEncoder().encode(': keep-alive\n\n')

/**
 * A Route Handler body that streams AG-UI events (Next bundled docs, 02-guides/streaming.md "Streaming in Route
 * Handlers": `new Response(new ReadableStream({ start(controller) { … } }))`). Each event is one SSE `data:` line from
 * `@ag-ui/encoder`'s `EventEncoder.encodeSSE` (the binding's framing; CopilotKit's runtime encodes the same way). Writes
 * after the browser went away (the stream was cancelled) or after `close()` are dropped: the run goes on being stored.
 */
export const createEventStream = () => {
	const encoder = new EventEncoder()
	const text = new TextEncoder()
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	let closed = false

	const schedule = () => {
		clearTimeout(timer)
		if (!closed) timer = setTimeout(() => enqueue(KEEP_ALIVE), KEEP_ALIVE_MS)
	}
	const enqueue = (chunk: Uint8Array) => {
		if (closed || !controller) return
		try {
			controller.enqueue(chunk)
		} catch {
			// MDN ReadableStreamDefaultController.enqueue(): a TypeError once the stream is closed or errored.
			closed = true
		}
		schedule()
	}

	const stream = new ReadableStream<Uint8Array>({
		// MDN ReadableStream(): `start` "is called immediately when the object is constructed".
		start(c) {
			controller = c
			schedule()
		},
		cancel() {
			closed = true
			clearTimeout(timer)
		},
	})

	return {
		stream,
		write(event: BaseEvent): void {
			enqueue(text.encode(encoder.encodeSSE(event)))
		},
		close(): void {
			if (closed) return
			closed = true
			clearTimeout(timer)
			controller?.close()
		},
	}
}
```

- [ ] **Step 6: Write `lib/chat/session.ts`**

```ts
import 'server-only'

import {
	EventType,
	type ActivityDeltaEvent,
	type ActivitySnapshotEvent,
	type BaseEvent,
	type CustomEvent,
	type Message,
	type ReasoningEndEvent,
	type ReasoningMessageEndEvent,
	type ReasoningMessageStartEvent,
	type ReasoningStartEvent,
	type RunErrorEvent,
	type RunFinishedEvent,
	type StateSnapshotEvent,
	type TextMessageEndEvent,
	type TextMessageStartEvent,
	type ToolCallEndEvent,
	type ToolCallResultEvent,
	type ToolCallStartEvent,
} from '@ag-ui/core'

import {
	finishRun,
	saveMessages,
	saveState,
	type CustomRecord,
	type RunEnd,
	type RunError,
	type RunKey,
} from '@/lib/data/conversations'
import { logActionError } from '@/lib/error-log'

import type { ChatTurnSink } from './adapter'
import type { StopReason } from './active-runs'
import type { MessageStatus } from './statuses'
import { errorToolMessage, STOPPED_TOOL_CONTENT, STOPPED_TOOL_ERROR } from './thread'
import { HUB_RUN_EVENT, RUN_CANCELLED_EVENT, type HubRunValue } from './turn'

/** Spec §3.2 step 2: while text streams, rows are written at most this often (PostgreSQL rewrites a whole row per update). */
export const SAVE_INTERVAL_MS = 2_000

/** The browser's text for a stream that broke off (plan call P6); the turn shows the code's localised title. */
export const BROKEN_STREAM_TEXT = 'The agent stopped answering.'

/**
 * Never sent to the browser (spec §4.4): RAW is provider-native, REASONING_ENCRYPTED_VALUE stays in the stored message for
 * the agent, MESSAGES_SNAPSHOT is folded on the server, and the state and activity deltas go out as the snapshots the
 * client's own JSON Patch produced (`state()`, `messages()`).
 */
const NOT_FORWARDED: ReadonlySet<string> = new Set([
	EventType.RAW,
	EventType.REASONING_ENCRYPTED_VALUE,
	EventType.MESSAGES_SNAPSHOT,
	EventType.STATE_SNAPSHOT,
	EventType.STATE_DELTA,
	EventType.ACTIVITY_DELTA,
])

/** Spec §3.2 step 2: a message's row is written when it starts, when its tool result arrives (at the next message list). */
const SAVE_AT_NEXT_LIST: ReadonlySet<string> = new Set([
	EventType.TEXT_MESSAGE_START,
	EventType.REASONING_MESSAGE_START,
	EventType.TOOL_CALL_START,
	EventType.TOOL_CALL_RESULT,
	EventType.ACTIVITY_SNAPSHOT,
	EventType.ACTIVITY_DELTA,
	EventType.REASONING_ENCRYPTED_VALUE,
	EventType.MESSAGES_SNAPSHOT,
])

/** …and when it ends: an end event changes no message (the client applies none), so the rows are written at once. */
const SAVE_NOW: ReadonlySet<string> = new Set([
	EventType.TEXT_MESSAGE_END,
	EventType.REASONING_MESSAGE_END,
	EventType.TOOL_CALL_END,
])

/** The event that ended the run, if one came (spec §2.3, the agent's answers; AG-UI lifecycle). */
type Terminal =
	| { kind: 'finished'; event: RunFinishedEvent }
	| { kind: 'error'; error: RunError; usage?: unknown }

/** The hub's names are its own: a producer's CUSTOM event under `hub:` never reaches the browser (spec §4.4). */
const isHubEvent = (name: string) => name.startsWith('hub:')

/**
 * One run's bookkeeping between the provider's adapter and the browser (spec §3.2, §4.4, §4.5). The adapter reports each
 * event before the client applies it (`event`), the whole message list after each change (`messages`) and the state
 * after each change (`state`) — the AgentSubscriber hooks `onEvent`, `onMessagesChanged` and `onStateChanged`
 * (docs.ag-ui.com, "AbstractAgent" › subscribers; @ag-ui/client 1.0.2 src/agent/agent.ts `processApplyEvents`). The
 * session forwards what the browser reads, writes the rows from the client's own list (not `newMessages`, which misses a
 * message updated under an existing id: spike), and at the end decides the run's status.
 */
export class RunSession implements ChatTurnSink {
	private readonly key: RunKey
	private readonly appId: string
	private readonly title: string
	private readonly out: { write(event: BaseEvent): void }
	private readonly now: () => number
	/** The last row written per message id: its body and status as JSON, so only a changed row is written again. */
	private readonly written = new Map<string, string>()
	private latest: readonly Message[] = []
	private saveDue = false
	private lastSave: number
	/** Rows and state are written one after another (PostgreSQL applies them in the order they leave). */
	private queue: Promise<void> = Promise.resolve()
	private terminal: Terminal | undefined
	private readonly custom: CustomRecord[] = []
	private readonly openText = new Set<string>()
	private readonly openReasoningMessages = new Set<string>()
	private readonly openReasoning = new Set<string>()
	/** Tool calls this run started, by id: whether their arguments are still streaming. */
	private readonly toolCalls = new Map<string, { argsOpen: boolean }>()
	private readonly answered = new Set<string>()
	/** Activity messages a delta changed: their snapshot goes out with the next message list. */
	private readonly activityDue = new Set<string>()

	constructor(args: {
		key: RunKey
		appId: string
		title: string
		/** The thread the agent was given (Task 6's threadForAgent): its rows are stored already. */
		history: readonly Message[]
		out: { write(event: BaseEvent): void }
		now?: () => number
	}) {
		this.key = args.key
		this.appId = args.appId
		this.title = args.title
		this.out = args.out
		this.now = args.now ?? Date.now
		this.lastSave = this.now()
		for (const message of args.history) this.written.set(message.id, rowJson(message, 'complete'))
	}

	/** Spec §4.4: the first event names the run and its conversation, so the browser can stop it. */
	start(): void {
		const value: HubRunValue = {
			conversationId: this.key.conversationId,
			runId: this.key.runId,
			title: this.title,
		}
		this.out.write({ type: EventType.CUSTOM, name: HUB_RUN_EVENT, value } as CustomEvent)
	}

	event(event: BaseEvent): void {
		this.track(event)
		if (this.forwards(event)) this.out.write(withoutRaw(event))
		if (SAVE_NOW.has(event.type)) this.save()
		else if (SAVE_AT_NEXT_LIST.has(event.type)) this.saveDue = true
	}

	messages(messages: readonly Message[]): void {
		this.latest = messages
		for (const id of this.activityDue) {
			const activity = messages.find(message => message.id === id)
			if (activity?.role === 'activity')
				this.out.write({
					type: EventType.ACTIVITY_SNAPSHOT,
					messageId: activity.id,
					activityType: activity.activityType,
					content: activity.content,
					replace: true,
				} as ActivitySnapshotEvent)
		}
		this.activityDue.clear()
		if (this.saveDue || this.now() - this.lastSave >= SAVE_INTERVAL_MS) this.save()
	}

	state(state: unknown): void {
		this.out.write({ type: EventType.STATE_SNAPSHOT, snapshot: state } as StateSnapshotEvent)
		this.enqueue(() => saveState(this.key, state))
	}

	/**
	 * The run is over (the adapter's `finished` settled). A terminal event from the agent decides the status; without one,
	 * the hub's Stop is a cancelled run, which the hub as the browser's producer closes in order (AG-UI lifecycle,
	 * "Cancelled runs"; CopilotKit's finaliser), the browser leaving is a truncated run, and anything else a failure (plan
	 * call P6). A stop, a failure or a truncation marks open rows incomplete and answers each cut-off tool call (spec §3.2
	 * step 4), so the next RunAgentInput is valid history.
	 */
	async finish({ stopReason }: { failed: boolean; stopReason?: StopReason }): Promise<RunEnd> {
		this.save()
		const end = this.decide(stopReason)
		if (end.status === 'cancelled' && !this.terminal) this.closeForBrowser()
		if (end.status === 'failed' && !this.terminal)
			this.out.write({
				type: EventType.RUN_ERROR,
				code: 'upstream_error',
				message: BROKEN_STREAM_TEXT,
			} as RunErrorEvent)
		if (end.status === 'cancelled' || end.status === 'failed' || end.status === 'truncated')
			end.close = this.closeLists()
		await this.queue
		// Spec §4.4: a log line carries the app, the run and the code, never content.
		if (end.status === 'failed')
			console.error('Chat run failed:', {
				appId: this.appId,
				runId: this.key.runId,
				code: end.error?.code,
			})
		try {
			await finishRun(this.key, end)
		} catch (error) {
			// The run stays `running` with no process holding it: the next request truncates it (spec §3.2 step 5).
			logActionError(error, 'RunSession.finish')
		}
		return end
	}

	private track(event: BaseEvent): void {
		switch (event.type) {
			case EventType.TEXT_MESSAGE_START:
				this.openText.add((event as TextMessageStartEvent).messageId)
				break
			case EventType.TEXT_MESSAGE_END:
				this.openText.delete((event as TextMessageEndEvent).messageId)
				break
			case EventType.REASONING_START:
				this.openReasoning.add((event as ReasoningStartEvent).messageId)
				break
			case EventType.REASONING_END:
				this.openReasoning.delete((event as ReasoningEndEvent).messageId)
				break
			case EventType.REASONING_MESSAGE_START:
				this.openReasoningMessages.add((event as ReasoningMessageStartEvent).messageId)
				break
			case EventType.REASONING_MESSAGE_END:
				this.openReasoningMessages.delete((event as ReasoningMessageEndEvent).messageId)
				break
			case EventType.TOOL_CALL_START:
				this.toolCalls.set((event as ToolCallStartEvent).toolCallId, { argsOpen: true })
				break
			case EventType.TOOL_CALL_END: {
				const call = this.toolCalls.get((event as ToolCallEndEvent).toolCallId)
				if (call) call.argsOpen = false
				break
			}
			case EventType.TOOL_CALL_RESULT:
				this.answered.add((event as ToolCallResultEvent).toolCallId)
				break
			case EventType.ACTIVITY_DELTA:
				this.activityDue.add((event as ActivityDeltaEvent).messageId)
				break
			case EventType.CUSTOM: {
				const { name, value } = event as CustomEvent
				if (!isHubEvent(name)) this.custom.push({ name, value })
				break
			}
			case EventType.RUN_FINISHED:
				this.terminal = { kind: 'finished', event: event as RunFinishedEvent }
				break
			case EventType.RUN_ERROR: {
				const { code, message, usage } = event as RunErrorEvent
				// @ag-ui/client's own RUN_ERROR for an aborted request (src/transform/http.ts) is the hub's stop, not the agent's.
				if (code !== 'abort')
					this.terminal = {
						kind: 'error',
						error: code === undefined ? { message } : { code, message },
						usage,
					}
				break
			}
		}
	}

	private forwards(event: BaseEvent): boolean {
		if (NOT_FORWARDED.has(event.type)) return false
		if (event.type === EventType.RUN_ERROR) return (event as RunErrorEvent).code !== 'abort'
		if (event.type === EventType.CUSTOM) return !isHubEvent((event as CustomEvent).name)
		return true
	}

	private decide(stopReason: StopReason | undefined): RunEnd {
		const terminal = this.terminal
		const custom = this.custom
		if (terminal?.kind === 'finished') {
			const { outcome, usage } = terminal.event
			// Spec §2.3: an agent's time limit ends with CUSTOM run_cancelled, then RUN_FINISHED; the run is cancelled.
			const cancelled =
				outcome?.type === 'cancelled' || custom.some(c => c.name === RUN_CANCELLED_EVENT)
			return {
				status: cancelled
					? 'cancelled'
					: outcome?.type === 'interrupt'
						? 'interrupted'
						: 'succeeded',
				outcome: outcome ?? { type: 'success' },
				...(usage ? { usage } : {}),
				custom,
			}
		}
		if (terminal?.kind === 'error')
			return {
				status: 'failed',
				error: terminal.error,
				...(terminal.usage ? { usage: terminal.usage } : {}),
				custom,
			}
		if (stopReason === 'stop')
			return { status: 'cancelled', outcome: { type: 'cancelled' }, custom }
		if (stopReason === 'disconnect') return { status: 'truncated', custom }
		// No terminal event: a stream that broke (`failed`) or ended without one; failed either way (plan call P6).
		return {
			status: 'failed',
			error: { code: 'upstream_error', message: BROKEN_STREAM_TEXT },
			custom,
		}
	}

	/** Spec §4.5: what the hub closes toward the browser after its own Stop, then the cancelled outcome. */
	private closeForBrowser(): void {
		for (const [toolCallId, call] of this.toolCalls)
			if (call.argsOpen)
				this.out.write({ type: EventType.TOOL_CALL_END, toolCallId } as ToolCallEndEvent)
		for (const messageId of this.openText)
			this.out.write({ type: EventType.TEXT_MESSAGE_END, messageId } as TextMessageEndEvent)
		for (const messageId of this.openReasoningMessages)
			this.out.write({
				type: EventType.REASONING_MESSAGE_END,
				messageId,
			} as ReasoningMessageEndEvent)
		for (const messageId of this.openReasoning)
			this.out.write({ type: EventType.REASONING_END, messageId } as ReasoningEndEvent)
		this.out.write({
			type: EventType.RUN_FINISHED,
			threadId: this.key.conversationId,
			runId: this.key.runId,
			outcome: { type: 'cancelled' },
		} as RunFinishedEvent)
	}

	private closeLists(): NonNullable<RunEnd['close']> {
		const open = new Set([...this.openText, ...this.openReasoningMessages])
		for (const message of this.latest)
			if (
				message.role === 'assistant' &&
				message.toolCalls?.some(call => this.toolCalls.get(call.id)?.argsOpen)
			)
				open.add(message.id)
		const cutOff = [...this.toolCalls.keys()].filter(id => !this.answered.has(id))
		return {
			messageIds: [...open],
			toolMessages: cutOff.map(id =>
				errorToolMessage(id, STOPPED_TOOL_ERROR, STOPPED_TOOL_CONTENT),
			),
		}
	}

	/** A row is streaming while its text, reasoning or one of its tool calls' arguments are open (spec §3.1 `status`). */
	private statusOf(message: Message): MessageStatus {
		if (this.openText.has(message.id) || this.openReasoningMessages.has(message.id))
			return 'streaming'
		if (
			message.role === 'assistant' &&
			message.toolCalls?.some(call => this.toolCalls.get(call.id)?.argsOpen)
		)
			return 'streaming'
		return 'complete'
	}

	private save(): void {
		this.saveDue = false
		this.lastSave = this.now()
		const rows = this.latest.flatMap(message => {
			const status = this.statusOf(message)
			const json = rowJson(message, status)
			if (this.written.get(message.id) === json) return []
			this.written.set(message.id, json)
			return [{ message, status }]
		})
		if (rows.length) this.enqueue(() => saveMessages(this.key, rows))
	}

	private enqueue(write: () => Promise<void>): void {
		this.queue = this.queue.then(write).catch(error => {
			// A failed write leaves the stream going; the run's end is written at finish (or truncated later).
			logActionError(error, 'RunSession.save')
		})
	}
}

const rowJson = (message: Message, status: MessageStatus) => JSON.stringify([message, status])

/** `rawEvent` is the provider-native event a producer may attach (@ag-ui/core BaseEvent): like RAW, it stays on the server. */
const withoutRaw = (event: BaseEvent): BaseEvent => {
	if (!('rawEvent' in event)) return event
	const { rawEvent: _raw, ...rest } = event
	return rest as BaseEvent
}
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-stream.test.ts __tests__/chat-session.test.ts` Expected: `Tests  24 passed (24)`.

- [ ] **Step 8: Gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint lib/chat/active-runs.ts lib/chat/stream.ts lib/chat/session.ts __tests__/chat-stream.test.ts __tests__/chat-session.test.ts && pnpm exec oxfmt --check lib/chat/active-runs.ts lib/chat/stream.ts lib/chat/session.ts __tests__/chat-stream.test.ts __tests__/chat-session.test.ts && pnpm test` Expected: all exit 0; `pnpm test` green.

- [ ] **Step 9: Commit**

```bash
git add lib/chat/active-runs.ts lib/chat/stream.ts lib/chat/session.ts __tests__/chat-stream.test.ts __tests__/chat-session.test.ts
git commit -m "feat(chat): store a run as it streams and close it for the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/active-runs.ts", "lib/chat/stream.ts", "lib/chat/session.ts", "__tests__/chat-stream.test.ts", "__tests__/chat-session.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-stream.test.ts __tests__/chat-session.test.ts", "acceptanceCriteria": ["`pnpm exec vitest run --project unit __tests__/chat-stream.test.ts __tests__/chat-session.test.ts` reports 24 passed (4 and 20)", "the stream writes one `data: <json>` line per event and `: keep-alive` after 15 s without a write; `close()` twice and a write after cancel throw nothing and leave no timer", "`RunSession` writes `hub:run` first; never forwards `RAW`, `REASONING_ENCRYPTED_VALUE`, `MESSAGES_SNAPSHOT`, `STATE_SNAPSHOT`, `STATE_DELTA`, `ACTIVITY_DELTA`, a CUSTOM `hub:*` or `RUN_ERROR` code `abort`; strips `rawEvent`; sends the applied state as `STATE_SNAPSHOT` and a delta-changed activity as `ACTIVITY_SNAPSHOT`", "rows are written when a message starts and ends and at most every 2 s between (the throttle case's writes are `m-1` streaming '', streaming 'ab', complete 'abc'), one write after another, and the thread given is never written back", "`finish` stores succeeded, interrupted, cancelled (run_timeout) and failed with the agent's code; a Stop without a terminal event sends the closings then `RUN_FINISHED` cancelled; a disconnect is truncated with nothing sent; no terminal event is failed `upstream_error` with `RUN_ERROR upstream_error` sent; a run with no events is cancelled (stop) or truncated (disconnect), never failed", "stop, failure and truncation carry `close` with the open message ids and one `STOPPED_TOOL_ERROR` tool message per cut-off call; a failure logs `'Chat run failed:', { appId, runId, code }`", "behind the real `aguiChat` on a stubbed fetch, the stored rows are the client's final messages (`m-1` with its tool call, `t-1`), both `complete`", "tsc, oxlint and oxfmt pass on the changed files, and `pnpm test` is green"], "modelTier": "frontier"}
```

---

### Task 11: The shared chat routes

**Goal:** One Route Handler per operation under `app/api/apps/[appId]/` (spec §4.2): `POST runs` runs one turn through the app's chat adapter and streams it (§4.3, §4.4), `GET conversations` lists the actor's conversations, `GET conversations/[conversationId]` answers its latest turns, and `POST …/runs/[runId]/stop` stops a run (§4.5); all behind one guard (§4.1).

Spec §4.1–§4.5, §8; plan calls P3–P8. Builds on Tasks 5–10 through the Shared contracts only (`lib/data/conversations.ts`, `lib/chat/{thread,turn,adapter,active-runs,stream,session}.ts`).

**Two contract additions this task makes** (recorded in the Shared contracts section):

- `ResolvedChatRoute`'s success also carries the app's adapter: `{ ok: true; actor: SessionUser; app: ProviderAppAccess<ProviderId>; chat: ChatAdapter<ProviderId> }`, from `chatAdapterOf(provider)` (Task 9, `lib/providers/registry.ts`). `ChatAdapter<'agui'>` is assignable to `ChatAdapter<ProviderId>` because `runTurn` is declared with method syntax, whose parameters TypeScript checks bivariantly (TypeScript handbook, "Type Compatibility", "Function Parameter Bivariance"; `strictFunctionTypes` "does not apply to methods").
- `runTurn`'s argument gains `chat`: `runTurn({ request, actor, app, chat, body })`. `lib/chat/run.ts` also exports `reconcileStaleRun(conversation)`, which `GET conversations/[conversationId]` calls too, and `UPSTREAM_MESSAGES`. `lib/chat/schemas.ts` exports `MESSAGE_TEXT_MAX`. The page sizes and the list cursor are Task 7's (`LIST_PAGE_MAX` = 100, `THREAD_PAGE_TURNS` = 20, `decodeListCursor` in `lib/data/conversations.ts`); P4's answer is Task 6's (`UNAVAILABLE_TOOL_ERROR`, `UNAVAILABLE_TOOL_CONTENT` in `lib/chat/thread.ts`). A `route.ts` file exports only its HTTP methods.

**Behaviour this task fixes where the spec is silent:**

- **Stop before the agent answered.** The browser learns the run id from `hub:run`, which it only reads once the stream is answered, so the only stop it can send before then is closing its request. That aborts `request.signal`, `activeRuns.stop(…, 'disconnect')` aborts the upstream request, and the adapter's `opened` settles with a failure. `runTurn` does not treat that as the agent's refusal: when `activeRuns.reasonOf(runId)` is set, the run goes the streamed way and `RunSession.finish({ failed, stopReason })` stores it (`truncated` for a disconnect, `cancelled` for a stop), with no error and no envelope. Only a refusal with no stop reason answers the envelope and stores `failed`.
- **The messages around a failed open.** The user message and the run stay stored; the run is `failed` with `{ code, message }` (the envelope's), so a reload shows the turn with its error (Task 8 groups a run without assistant messages into an assistant turn).
- **A failure inside the hub after `startRun`** (the thread read, the adapter call) releases the run, stores it `failed` with `{ code: 'internal_error', message: '' }` and rethrows, so the route answers the logged 500 envelope (`errorResponseFrom`).
- **A failing end write** (`session.finish` rejects) is logged by code (`finish_failed`) and through `logActionError`; the run stays stored as `running` and, once this process has released it, the next request truncates it (§3.2 step 5).
- **The caller** handed to the adapter is `{ id, source, role }` copied from the actor (plan call P1), so nothing else of the session (the email) reaches provider code.
- **Bounds on `answers`:** at most 50 resume entries and 50 tool results, interrupt and tool-call ids 1–256 characters (the hub's own bound on a body; docs silent; OWASP Input Validation Cheat Sheet: "minimum and maximum length"). A message must contain a non-blank character; it is stored as typed.
- **A list cursor the DAL cannot read** answers 400 `invalid_param` ("Invalid request: cursor"), checked in the route with Task 7's `decodeListCursor`: `lib/chat/schemas.ts` stays client-safe, so it does not import the server-only DAL.

**Files:**

- Create: `lib/chat/schemas.ts`, `lib/chat/answers.ts`, `lib/chat/route.ts`, `lib/chat/run.ts`
- Create: `app/api/apps/[appId]/runs/route.ts`, `app/api/apps/[appId]/conversations/route.ts`, `app/api/apps/[appId]/conversations/[conversationId]/route.ts`, `app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts`
- Create: `__tests__/chat-schemas.test.ts`, `__tests__/chat-answers.test.ts`, `__tests__/chat-route.test.ts`, `__tests__/chat-run.test.ts`, `__tests__/chat-routes.test.ts`
- Modify: `__tests__/api-routes.test.ts` (whole file replaced)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts` reports every test passed, 0 failed.
- [ ] `POST runs` with both `message` and `answers`, with neither, with `answers` but no `conversationId`, or with a blank or 32,001-character text answers 400 `invalid_param` and calls no DAL function.
- [ ] A message to a conversation whose last run is `interrupted` answers 409 `{ code: 'answer_pending' }` and stores nothing; answers that miss, repeat or name an unknown interrupt, answer an expired one `resolved`, or carry any `toolResults` answer 400 `{ code: 'answers_invalid' }`.
- [ ] `startRun` answering `run_in_progress` answers 409 `{ code: 'run_in_progress' }`.
- [ ] Each upstream code answers its `UPSTREAM_STATUS` (502, or 503 for `provider_unreachable`) with the envelope `{ code, message: UPSTREAM_MESSAGES[code], status }`, stores the run `failed` with that code, and logs `'runTurn:', { appId, runId, code }`.
- [ ] An opened run answers 200 with every `SSE_HEADERS` header; `RunSession.start()` runs before the adapter is called; once `finished` settles, `session.finish({ failed, stopReason })` runs, the run is released (`activeRuns.has(runId)` false) and the body ends.
- [ ] A browser that closes its request aborts the adapter's `abortController` and the run settles with `stopReason: 'disconnect'`, also when it leaves before the agent answered (no envelope, no `failed` write).
- [ ] An unanswered call to a tool the hub never advertised is answered with a `tool` message `{ toolCallId, error: UNAVAILABLE_TOOL_ERROR, content: UNAVAILABLE_TOOL_CONTENT }` (Task 6's constants) inserted before the user message; a call an open interrupt names is not.
- [ ] A conversation whose `activeRunId` this process does not hold is truncated (`truncateStaleRun`) before its run starts and before its history is read.
- [ ] `GET conversations` answers `listConversations(actor, appId, { cursor, limit: LIST_PAGE_MAX })` with `Cache-Control: private, no-store`, and 400 for a cursor `decodeListCursor` refuses; `GET conversations/[id]` answers `{ id, title, state, turns, cursor }` built with `turnsFromMessages`, 404 `conversation_not_found` for a malformed or foreign id, 400 for `?before=abc`; the stop route answers 204 and calls `activeRuns.stop(runId, conversationId, 'stop')` only for a well-formed run id of the actor's conversation.
- [ ] Every route answers 401 signed out and 404 `app_not_found` for a Dify app; `__tests__/api-routes.test.ts` pins exactly the four new routes.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run --project unit __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts` → tsc prints nothing; Vitest reports all passed, 0 failed.

**Steps:**

- [ ] **Step 1: Read the sources this task leans on**

Next's bundled docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` ("Route Context Helper": `RouteContext<'/users/[id]'>` is global after `next typegen`), `node_modules/next/dist/docs/01-app/02-guides/streaming.md` ("Streaming in Route Handlers": `new Response(new ReadableStream(…))`), `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`. zod 4 (Context7 `/colinhacks/zod`: `.refine` with `path`, `z.record(z.string(), z.unknown())`, `.transform`). `@ag-ui/client` 1.0.2's `buildResumeArray(interrupts, responses)` (throws "missing responses for open interrupts" and "responses reference unknown interrupt ids"; drops a cancelled entry's payload) and `isInterruptExpired(interrupt, now)` (`expiresAt <= now`), in `node_modules/@ag-ui/client/dist/index.d.ts` and the package's `src/interrupts/index.ts` (source map); `@ag-ui/core/schemas`' `InterruptSchema` (zod 4, `import { z } from "zod/v4"`). The repo's idioms: `lib/providers/route.ts`, `lib/http/{errors,parse,response}.ts`, `__tests__/provider-route.test.ts`, `__tests__/dify-routes-chat.test.ts`.

- [ ] **Step 2: Write the failing tests for the body, the answers and the guard**

Create `__tests__/chat-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	conversationsQuerySchema,
	MESSAGE_TEXT_MAX,
	runBodySchema,
	threadQuerySchema,
} from '@/lib/chat/schemas'

const ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const resolved = { interruptId: 'int-1', status: 'resolved', payload: { approved: true } }

// Spec §4.2: exactly one of message and answers; answers continue a conversation; the text is 1–32,000 characters.
describe('runBodySchema', () => {
	it.each([
		['a first message', { message: { text: 'hi' } }],
		['a message in a conversation', { conversationId: ID, message: { text: 'hi' } }],
		['answers in a conversation', { conversationId: ID, answers: { resume: [resolved] } }],
		[
			'a cancelled answer without a payload',
			{ conversationId: ID, answers: { resume: [{ interruptId: 'int-1', status: 'cancelled' }] } },
		],
		['a message of the longest length', { message: { text: 'x'.repeat(MESSAGE_TEXT_MAX) } }],
	])('takes %s', (_case, body) => {
		expect(runBodySchema.safeParse(body).success).toBe(true)
	})

	it.each([
		['neither a message nor answers', {}],
		[
			'both a message and answers',
			{ conversationId: ID, message: { text: 'hi' }, answers: { resume: [resolved] } },
		],
		['answers without a conversation', { answers: { resume: [resolved] } }],
		['an empty text', { message: { text: '' } }],
		['a blank text', { message: { text: '  \n ' } }],
		['a text over 32,000 characters', { message: { text: 'x'.repeat(MESSAGE_TEXT_MAX + 1) } }],
		['a conversation id that is no UUID', { conversationId: 'nope', message: { text: 'hi' } }],
		[
			'an unknown answer status',
			{ conversationId: ID, answers: { resume: [{ ...resolved, status: 'maybe' }] } },
		],
		[
			'a payload that is no object',
			{ conversationId: ID, answers: { resume: [{ ...resolved, payload: [true] }] } },
		],
		[
			'more than 50 answers',
			{ conversationId: ID, answers: { resume: Array.from({ length: 51 }, () => resolved) } },
		],
		[
			'a tool result over 32,000 characters',
			{
				conversationId: ID,
				answers: { toolResults: [{ toolCallId: 'c1', content: 'x'.repeat(MESSAGE_TEXT_MAX + 1) }] },
			},
		],
	])('refuses %s', (_case, body) => {
		expect(runBodySchema.safeParse(body).success).toBe(false)
	})

	// zod 4 "Objects": unknown keys are stripped by default, so 2c's attachmentIds sent early change nothing.
	it('drops keys it does not know, and keeps the text as typed', () => {
		expect(runBodySchema.parse({ message: { text: ' hi ' }, attachmentIds: [ID] })).toEqual({
			message: { text: ' hi ' },
		})
	})
})

describe('the query schemas', () => {
	it('reads the history cursor as a positive integer', () => {
		expect(threadQuerySchema.parse({ before: '42' })).toEqual({ before: 42 })
		expect(threadQuerySchema.parse({})).toEqual({})
		for (const before of ['0', '-1', '1.5', 'abc', '12345678901234567'])
			expect(threadQuerySchema.safeParse({ before }).success).toBe(false)
	})
	it('takes a list cursor of 1–200 characters, or none', () => {
		expect(conversationsQuerySchema.parse({})).toEqual({})
		expect(conversationsQuerySchema.parse({ cursor: 'abc' })).toEqual({ cursor: 'abc' })
		expect(conversationsQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
		expect(conversationsQuerySchema.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false)
	})
})
```

Create `__tests__/chat-answers.test.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { checkAnswers, openItemsOf } from '@/lib/chat/answers'

const NOW = new Date('2026-10-14T12:00:00Z')
const approval: Interrupt = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }
const question: Interrupt = { id: 'int-2', reason: 'input_required', message: 'Which region?' }
const expired: Interrupt = {
	id: 'int-3',
	reason: 'confirmation',
	expiresAt: '2026-10-14T11:00:00Z',
}
const run = (status: string, outcome: unknown) => ({
	id: 'r1',
	status,
	outcome,
	error: null,
	custom: [],
	startedAt: NOW,
	finishedAt: NOW,
})

// Spec §3.3, §4.3 step 1: the open items are the last run's open interrupts (2b adds the hub's own pending tool calls).
describe('openItemsOf', () => {
	it('reads the interrupts of an interrupted last run', () => {
		expect(
			openItemsOf(run('interrupted', { type: 'interrupt', interrupts: [approval, question] })),
		).toEqual({ interrupts: [approval, question] })
	})
	it('has nothing open without a run, after any other end, or for an outcome it cannot read', () => {
		expect(openItemsOf(null)).toEqual({ interrupts: [] })
		expect(openItemsOf(run('succeeded', { type: 'success' }))).toEqual({ interrupts: [] })
		expect(openItemsOf(run('interrupted', null))).toEqual({ interrupts: [] })
		expect(openItemsOf(run('interrupted', { type: 'interrupt', interrupts: 'no' }))).toEqual({
			interrupts: [],
		})
	})
	// @ag-ui/core's own InterruptSchema reads each stored interrupt; one it refuses is left out.
	it('leaves out a stored interrupt the protocol schema refuses', () => {
		expect(
			openItemsOf(run('interrupted', { type: 'interrupt', interrupts: [{ id: 7 }, approval] })),
		).toEqual({ interrupts: [approval] })
	})
})

describe('checkAnswers', () => {
	const open = { interrupts: [approval, question] }

	it('builds one resume entry per open interrupt, in the interrupts’ order', () => {
		expect(
			checkAnswers(
				open,
				{
					resume: [
						{ interruptId: 'int-2', status: 'cancelled', payload: { ignored: true } },
						{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
					],
				},
				NOW,
			),
		).toEqual({
			ok: true,
			// buildResumeArray drops a cancelled entry's payload (@ag-ui/client src/interrupts/index.ts).
			resume: [
				{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'cancelled' },
			],
			toolMessages: [],
		})
	})

	it.each([
		['an open interrupt left unanswered', [{ interruptId: 'int-1', status: 'resolved' }]],
		[
			'an interrupt that is not open',
			[
				{ interruptId: 'int-1', status: 'resolved' },
				{ interruptId: 'int-2', status: 'resolved' },
				{ interruptId: 'int-9', status: 'cancelled' },
			],
		],
		[
			'one interrupt answered twice',
			[
				{ interruptId: 'int-1', status: 'resolved' },
				{ interruptId: 'int-1', status: 'cancelled' },
				{ interruptId: 'int-2', status: 'resolved' },
			],
		],
	] as const)('refuses %s', (_case, resume) => {
		expect(checkAnswers(open, { resume: [...resume] }, NOW)).toEqual({ ok: false })
	})

	// "An interrupt past its expiresAt … answers it cancelled" (spec §6.1); @ag-ui/client refuses the same.
	it('takes an expired interrupt only as cancelled', () => {
		const withExpired = { interrupts: [expired] }
		expect(
			checkAnswers(withExpired, { resume: [{ interruptId: 'int-3', status: 'resolved' }] }, NOW),
		).toEqual({ ok: false })
		expect(
			checkAnswers(withExpired, { resume: [{ interruptId: 'int-3', status: 'cancelled' }] }, NOW),
		).toEqual({
			ok: true,
			resume: [{ interruptId: 'int-3', status: 'cancelled' }],
			toolMessages: [],
		})
	})

	// Plan call P4: 2a advertises no tool, so no tool call is open and any tool result names an unknown call.
	it('refuses tool results, and answers to a conversation with nothing open', () => {
		expect(
			checkAnswers(
				open,
				{
					resume: [
						{ interruptId: 'int-1', status: 'resolved' },
						{ interruptId: 'int-2', status: 'resolved' },
					],
					toolResults: [{ toolCallId: 'call-1', content: 'done' }],
				},
				NOW,
			),
		).toEqual({ ok: false })
		expect(checkAnswers({ interrupts: [] }, { resume: [] }, NOW)).toEqual({ ok: false })
		expect(checkAnswers({ interrupts: [] }, {}, NOW)).toEqual({ ok: false })
	})
})
```

Create `__tests__/chat-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, findConversation, chat } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	findConversation: vi.fn(),
	chat: { runTurn: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/data/conversations', () => ({ findConversation }))
// The registry as the guard reads it: Dify has no chat adapter until Part 3, AG-UI has one (spec §4.1).
vi.mock('@/lib/providers/registry', () => ({
	chatAdapterOf: (provider: string) => (provider === 'agui' ? chat : undefined),
}))

import { resolveChatRoute, resolveConversation } from '@/lib/chat/route'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONVERSATION_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user', source: 'local' }
const params = (appId = APP_ID) => Promise.resolve({ appId })
const app = {
	id: APP_ID,
	enabled: true,
	provider: 'agui',
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const refusal = async (resolved: { ok: boolean; response?: Response }) => {
	expect(resolved.ok).toBe(false)
	return { status: resolved.response!.status, body: await resolved.response!.json() }
}
const appNotFound = {
	status: 404,
	body: { code: 'app_not_found', message: 'No such app.', status: 404 },
}

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	findConversation.mockReset()
})

// Spec §4.1: the session → the id → the app as the actor may see it → enabled → a provider with a chat adapter.
describe('resolveChatRoute', () => {
	it('answers 401 before it looks at the id or the app', async () => {
		verifySession.mockResolvedValue(null)
		expect(await refusal(await resolveChatRoute(params('not-a-uuid')))).toEqual({
			status: 401,
			body: { code: 'unauthorized', message: 'Sign in required.', status: 401 },
		})
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	it('answers a malformed id and an app the read does not return as unknown', async () => {
		verifySession.mockResolvedValue(actor)
		expect(await refusal(await resolveChatRoute(params('not-a-uuid')))).toEqual(appNotFound)
		expect(getAppAccess).not.toHaveBeenCalled()
		getAppAccess.mockResolvedValue(null)
		expect(await refusal(await resolveChatRoute(params()))).toEqual(appNotFound)
		expect(getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
	})
	it('answers 403 app_disabled for a disabled app, before the adapter check', async () => {
		verifySession.mockResolvedValue(actor)
		for (const provider of ['agui', 'dify']) {
			getAppAccess.mockResolvedValue({ ...app, enabled: false, provider })
			expect(await refusal(await resolveChatRoute(params()))).toEqual({
				status: 403,
				body: { code: 'app_disabled', message: 'This app is disabled.', status: 403 },
			})
		}
	})
	it('answers an app whose provider has no chat adapter as unknown', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({ ...app, provider: 'dify' })
		expect(await refusal(await resolveChatRoute(params()))).toEqual(appNotFound)
	})
	it('hands back the actor, the app and its adapter', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(app)
		expect(await resolveChatRoute(params())).toEqual({ ok: true, actor, app, chat })
	})
	it('answers a logged 500 envelope when a read throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockRejectedValue(new Error('db down'))
		expect(await refusal(await resolveChatRoute(params()))).toEqual({
			status: 500,
			body: { code: 'internal_error', message: 'Internal Server Error', status: 500 },
		})
		expect(errorSpy).toHaveBeenCalledWith('resolveChatRoute:', expect.any(Error))
		errorSpy.mockRestore()
	})
})

// Spec §4.1: a conversation must belong to the actor, match the app and not be deleted (findConversation's WHERE).
describe('resolveConversation', () => {
	const notFound = {
		status: 404,
		body: { code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
	}
	it('answers a malformed id as unknown without reading it', async () => {
		expect(await refusal(await resolveConversation(actor as never, APP_ID, 'nope'))).toEqual(
			notFound,
		)
		expect(findConversation).not.toHaveBeenCalled()
	})
	it('answers a conversation the read does not return as unknown', async () => {
		findConversation.mockResolvedValue(null)
		expect(
			await refusal(await resolveConversation(actor as never, APP_ID, CONVERSATION_ID)),
		).toEqual(notFound)
		expect(findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
	})
	it('hands back the conversation', async () => {
		const conversation = {
			id: CONVERSATION_ID,
			appId: APP_ID,
			title: 't',
			state: {},
			activeRunId: null,
		}
		findConversation.mockResolvedValue(conversation)
		expect(await resolveConversation(actor as never, APP_ID, CONVERSATION_ID)).toEqual({
			ok: true,
			conversation,
		})
	})
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts` Expected: FAIL, three files: `Failed to resolve import "@/lib/chat/schemas"` (and `…/answers`, `…/route`).

- [ ] **Step 4: Write the schemas**

Create `lib/chat/schemas.ts`:

```ts
import * as z from 'zod'

import { idSchema } from '@/lib/ids'

/*
 * The shared chat's request schemas (Part 2 spec §4.2; ADR-0025). Client-safe: the browser's own checks may reuse the
 * limits. zod 4 "Objects": unknown keys are stripped by default, so a field a later slice adds (2c's attachmentIds) is
 * dropped here until that slice reads it.
 */

/** Spec §4.2: a message's text, and a tool result's content, are at most 32,000 characters. */
export const MESSAGE_TEXT_MAX = 32_000
/** The hub's own bound on one body's answers (docs silent; OWASP Input Validation Cheat Sheet: minimum and maximum length). */
const ANSWERS_MAX = 50

/** An answer to one open interrupt (AG-UI 1.0 interrupt-resume: `{ interruptId, status, payload? }`, payload an object here). */
const resumeEntrySchema = z.object({
	interruptId: z.string().min(1).max(256),
	status: z.enum(['resolved', 'cancelled']),
	payload: z.record(z.string(), z.unknown()).optional(),
})

const toolResultSchema = z.object({
	toolCallId: z.string().min(1).max(256),
	content: z.string().max(MESSAGE_TEXT_MAX),
})

/**
 * POST runs (spec §4.2): exactly one of `message` and `answers`, and `answers` only in a conversation. A text must hold a
 * non-blank character and is stored as typed (zod 4 "Refinements": `.refine` with a `path`, so parseJsonBody names the
 * field). 2a has no `attachmentIds` (2c adds them).
 */
export const runBodySchema = z
	.object({
		conversationId: idSchema.optional(),
		message: z
			.object({
				text: z
					.string()
					.max(MESSAGE_TEXT_MAX)
					.refine(text => text.trim() !== ''),
			})
			.optional(),
		answers: z
			.object({
				resume: z.array(resumeEntrySchema).max(ANSWERS_MAX).optional(),
				toolResults: z.array(toolResultSchema).max(ANSWERS_MAX).optional(),
			})
			.optional(),
	})
	.refine(body => (body.message === undefined) !== (body.answers === undefined), {
		path: ['message'],
		message: 'exactly one of message and answers',
	})
	.refine(body => body.answers === undefined || body.conversationId !== undefined, {
		path: ['conversationId'],
		message: 'answers continue a conversation',
	})

export type RunBody = z.infer<typeof runBodySchema>

/**
 * GET conversations: the opaque keyset cursor the previous page answered. Its content is the DAL's to read (Task 7's
 * `decodeListCursor`, server-only), so the route checks it; this schema bounds its length only.
 */
export const conversationsQuerySchema = z.object({ cursor: z.string().min(1).max(200).optional() })

/**
 * GET conversations/[conversationId]: `before`, the seq of the oldest user message the browser shows (plan call P8), a
 * positive integer below 2^53 (`seq` is a bigint read in Drizzle's `number` mode, Task 5).
 */
export const threadQuerySchema = z.object({
	before: z
		.string()
		.regex(/^[1-9]\d{0,15}$/)
		.transform(Number)
		.optional(),
})
```

- [ ] **Step 5: Write the answers check**

Create `lib/chat/answers.ts`:

```ts
import 'server-only'

import { buildResumeArray, isInterruptExpired } from '@ag-ui/client'
import type { Interrupt, Message, ResumeEntry } from '@ag-ui/core'
import { InterruptSchema } from '@ag-ui/core/schemas'

import type { StoredRun } from '@/lib/data/conversations'

import type { RunBody } from './schemas'

/** What a conversation waits for (spec §4.3 step 1): 2a, its last run's open interrupts; 2b adds the hub's own tool calls. */
export type OpenItems = { interrupts: Interrupt[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The open interrupts (spec §3.3): those of the last run when it ended on an interrupt, read from the stored
 * `RUN_FINISHED.outcome` (Task 5 stores it as received) with the protocol's own schema (`@ag-ui/core/schemas`
 * `InterruptSchema`); an entry it refuses is left out, so a stored value never reaches the agent unread.
 */
export const openItemsOf = (run: StoredRun | null): OpenItems => {
	if (!run || run.status !== 'interrupted' || !isRecord(run.outcome)) return { interrupts: [] }
	const listed = Array.isArray(run.outcome.interrupts) ? run.outcome.interrupts : []
	return {
		interrupts: listed.flatMap(entry => {
			const parsed = InterruptSchema.safeParse(entry)
			return parsed.success ? [parsed.data] : []
		}),
	}
}

type Answers = NonNullable<RunBody['answers']>

/**
 * Spec §4.3 step 1: the answers must cover every open item, with no unknown or expired id. AG-UI: "The resume list MUST
 * cover every interrupt"; @ag-ui/client's `buildResumeArray` builds `resume[]` in the interrupts' order and throws for a
 * missing or unknown id, and `isInterruptExpired` is its expiry rule (an expired interrupt can only be cancelled, as its
 * `runAgent` enforces). An id given twice is refused first (a record would keep one of them). Plan call P4: 2a has no
 * open tool calls, so any tool result names an unknown call. Answers to nothing are refused: they would start a run
 * with nothing new in it.
 */
export const checkAnswers = (
	open: OpenItems,
	answers: Answers,
	now: Date = new Date(),
): { ok: true; resume: ResumeEntry[]; toolMessages: Message[] } | { ok: false } => {
	const entries = answers.resume ?? []
	if (open.interrupts.length === 0 || (answers.toolResults ?? []).length > 0) return { ok: false }
	if (new Set(entries.map(entry => entry.interruptId)).size !== entries.length) return { ok: false }
	const responses = Object.fromEntries(
		entries.map(entry => [
			entry.interruptId,
			entry.status === 'resolved'
				? { status: entry.status, payload: entry.payload }
				: { status: entry.status },
		]),
	)
	let resume: ResumeEntry[]
	try {
		resume = buildResumeArray(open.interrupts, responses)
	} catch {
		return { ok: false }
	}
	const expiredAnswered = open.interrupts.some(
		interrupt =>
			isInterruptExpired(interrupt, now) && responses[interrupt.id]?.status !== 'cancelled',
	)
	return expiredAnswered ? { ok: false } : { ok: true, resume, toolMessages: [] }
}
```

- [ ] **Step 6: Write the guard**

Create `lib/chat/route.ts`:

```ts
import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'
import { findConversation, type ConversationRecord } from '@/lib/data/conversations'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'
import type { ProviderId } from '@/lib/providers/ids'
import { chatAdapterOf } from '@/lib/providers/registry'
import type { ProviderAppAccess } from '@/lib/providers/route'

import type { ChatAdapter } from './adapter'

export type ResolvedChatRoute =
	| {
			ok: true
			actor: SessionUser
			app: ProviderAppAccess<ProviderId>
			chat: ChatAdapter<ProviderId>
	  }
	| { ok: false; response: Response }

const appNotFound = (): Response => errorResponse('app_not_found', 'No such app.', 404)

/** Spec §4.1, §8: a conversation that is not the actor's, of another app, or deleted answers as one that does not exist. */
export const conversationNotFound = (): Response =>
	errorResponse('conversation_not_found', 'No such conversation.', 404)

/**
 * The guard of every shared chat route (spec §4.1), in resolveAppRoute's order (lib/providers/route.ts): the session first,
 * so a revoked token learns nothing about apps; the id, a UUID (lib/ids.ts); the app as the actor may see it (getAppAccess
 * applies visibleTo and reads the documents with their provider's schemas); whether it is enabled; whether its provider has
 * a chat adapter. An unknown, invisible or malformed id and an app of a provider without the shared chat all answer 404
 * app_not_found; a disabled app answers 403 app_disabled; a failing read a logged 500 envelope, not Next's empty one.
 */
export const resolveChatRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedChatRoute> => {
	try {
		const actor = await verifySession()
		if (!actor)
			return { ok: false, response: errorResponse('unauthorized', 'Sign in required.', 401) }
		const { appId } = await params
		const app = isId(appId) ? await getAppAccess(actor, appId) : null
		if (!app) return { ok: false, response: appNotFound() }
		if (!app.enabled)
			return { ok: false, response: errorResponse('app_disabled', 'This app is disabled.', 403) }
		const chat = chatAdapterOf(app.provider)
		if (!chat) return { ok: false, response: appNotFound() }
		return { ok: true, actor, app, chat }
	} catch (error) {
		return { ok: false, response: errorResponseFrom(error, 'resolveChatRoute') }
	}
}

/** The actor's conversation of this app, not deleted (spec §4.1); a malformed id is never read (lib/ids.ts). */
export const resolveConversation = async (
	actor: SessionUser,
	appId: string,
	conversationId: string,
): Promise<{ ok: true; conversation: ConversationRecord } | { ok: false; response: Response }> => {
	const conversation = isId(conversationId)
		? await findConversation(actor, appId, conversationId)
		: null
	return conversation ? { ok: true, conversation } : { ok: false, response: conversationNotFound() }
}
```

- [ ] **Step 7: Run the three test files to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts` Expected: PASS, 3 files, 0 failed.

- [ ] **Step 8: Write the failing tests for the run and the four routes**

Create `__tests__/chat-run.test.ts`:

```ts
import type { Message } from '@ag-ui/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSession = {
	args: Record<string, unknown>
	start: ReturnType<typeof vi.fn>
	finish: ReturnType<typeof vi.fn>
}

const { dal, sessions } = vi.hoisted(() => ({
	dal: {
		findConversation: vi.fn(),
		lastRun: vi.fn(),
		loadThread: vi.fn(),
		startRun: vi.fn(),
		finishRun: vi.fn(),
		truncateStaleRun: vi.fn(),
	},
	sessions: [] as FakeSession[],
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: vi.fn(),
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: vi.fn() }))
vi.mock('@/lib/providers/registry', () => ({ chatAdapterOf: () => undefined }))
vi.mock('@/lib/data/conversations', () => dal)
// The session is Task 10's (persistence and the browser's events); here it records how the run drives it.
vi.mock('@/lib/chat/session', () => ({
	RunSession: class {
		args: Record<string, unknown>
		start = vi.fn()
		finish = vi.fn(async () => ({ status: 'succeeded', custom: [] }))
		event = vi.fn()
		messages = vi.fn()
		state = vi.fn()
		constructor(args: Record<string, unknown>) {
			this.args = args
			sessions.push(this as unknown as FakeSession)
		}
	},
}))

import { activeRuns } from '@/lib/chat/active-runs'
import { UPSTREAM_STATUS, type UpstreamErrorCode } from '@/lib/chat/adapter'
import { runTurn, UPSTREAM_MESSAGES } from '@/lib/chat/run'
import { SSE_HEADERS } from '@/lib/chat/stream'
import { threadForAgent, UNAVAILABLE_TOOL_CONTENT, UNAVAILABLE_TOOL_ERROR } from '@/lib/chat/thread'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = {
	id: 'u1',
	email: 'jane@example.com',
	name: null,
	role: 'user' as const,
	source: 'local' as const,
}
const app = {
	id: APP_ID,
	enabled: true,
	provider: 'agui' as const,
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const conversation = {
	id: CONVERSATION_ID,
	appId: APP_ID,
	title: 'Earlier',
	state: { steps: [] },
	activeRunId: null as string | null,
	updatedAt: new Date('2026-10-14T10:00:00Z'),
}
const row = (seq: number, body: Message) => ({
	seq,
	messageId: body.id,
	runId: 'r0',
	role: body.role,
	body,
	status: 'complete' as const,
})
const userRow = (seq: number, id: string, text: string) =>
	row(seq, { id, role: 'user', content: text })
const callRow = (seq: number, ...ids: string[]) =>
	row(seq, {
		id: `a${seq}`,
		role: 'assistant',
		toolCalls: ids.map(id => ({
			id,
			type: 'function',
			function: { name: 'lookup', arguments: '{}' },
		})),
	})
const interrupted = (interrupts: unknown[]) => ({
	id: 'r0',
	status: 'interrupted',
	outcome: { type: 'interrupt', interrupts },
	error: null,
	custom: [],
	startedAt: new Date(),
	finishedAt: new Date(),
})

const chat = { runTurn: vi.fn() }
const opens = (opened: unknown, finished: Promise<unknown> = Promise.resolve({ failed: false })) =>
	chat.runTurn.mockReturnValue({ opened: Promise.resolve(opened), finished })
const run = (body: Record<string, unknown>, signal?: AbortSignal) =>
	runTurn({
		request: new Request(`http://hub/api/apps/${APP_ID}/runs`, { method: 'POST', signal }),
		actor,
		app,
		chat,
		body,
	})
const envelope = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})
const started = () => dal.startRun.mock.calls[0][1]
const adapterInput = () => chat.runTurn.mock.calls[0][1]

beforeEach(() => {
	for (const fn of Object.values(dal)) fn.mockReset()
	chat.runTurn.mockReset()
	sessions.length = 0
	dal.findConversation.mockResolvedValue(conversation)
	dal.lastRun.mockResolvedValue(null)
	dal.loadThread.mockResolvedValue([])
	dal.finishRun.mockResolvedValue(undefined)
	dal.startRun.mockImplementation(
		async (_actor: unknown, input: { conversation: { id: string }; runId: string }) => ({
			ok: true,
			key: { conversationId: input.conversation.id, runId: input.runId },
		}),
	)
})

// Spec §4.3 steps 2–5: store, build, run, stream.
describe('runTurn: a run that opens', () => {
	it('starts a new conversation titled by the message, and streams the run', async () => {
		opens({ ok: true })
		const response = await run({ message: { text: 'Plan my week' } })
		expect(dal.findConversation).not.toHaveBeenCalled()
		expect(started()).toMatchObject({
			appId: APP_ID,
			conversation: { title: 'Plan my week', isNew: true },
			messages: [{ role: 'user', content: 'Plan my week' }],
		})
		const key = { conversationId: started().conversation.id, runId: started().runId }
		expect(response.status).toBe(200)
		for (const [name, value] of new Headers(SSE_HEADERS))
			expect(response.headers.get(name)).toBe(value)
		const [session] = sessions
		expect(session.args).toMatchObject({ key, appId: APP_ID, title: 'Plan my week' })
		expect(session.start).toHaveBeenCalledTimes(1)
		expect(session.start.mock.invocationCallOrder[0]).toBeLessThan(
			chat.runTurn.mock.invocationCallOrder[0],
		)
		// Plan call P1: the caller is the account's id, source and role, nothing else of the session.
		expect(chat.runTurn).toHaveBeenCalledWith(
			{ settings: app.settings, secrets: app.secrets },
			expect.objectContaining({
				threadId: key.conversationId,
				runId: key.runId,
				state: {},
				tools: [],
				resume: undefined,
				caller: { id: 'u1', source: 'local', role: 'user' },
			}),
			session,
		)
		await vi.waitFor(() =>
			expect(session.finish).toHaveBeenCalledWith({ failed: false, stopReason: undefined }),
		)
		expect(await response.text()).toBe('')
		expect(activeRuns.has(key.runId)).toBe(false)
	})

	it('continues a conversation with its title and state, from the stored thread', async () => {
		opens({ ok: true })
		const before = [userRow(1, 'm1', 'Earlier')]
		const after = [...before, userRow(2, 'm2', 'And next')]
		dal.loadThread.mockResolvedValueOnce(before).mockResolvedValueOnce(after)
		await run({ conversationId: CONVERSATION_ID, message: { text: 'And next' } })
		expect(dal.findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(started().conversation).toEqual({ id: CONVERSATION_ID })
		expect(sessions[0].args).toMatchObject({ title: 'Earlier' })
		expect(adapterInput()).toMatchObject({
			state: { steps: [] },
			messages: threadForAgent(after),
		})
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers a conversation the actor cannot reach as unknown, storing nothing', async () => {
		dal.findConversation.mockResolvedValue(null)
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 404,
			body: { code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	// Spec §3.2 step 5: a run stored as running that no process holds is truncated when the next request finds it.
	it('truncates a run this process does not hold, but not one it holds', async () => {
		opens({ ok: true })
		dal.findConversation.mockResolvedValue({ ...conversation, activeRunId: 'r-old' })
		await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })
		expect(dal.truncateStaleRun).toHaveBeenCalledWith({
			conversationId: CONVERSATION_ID,
			runId: 'r-old',
		})
		expect(dal.truncateStaleRun.mock.invocationCallOrder[0]).toBeLessThan(
			dal.lastRun.mock.invocationCallOrder[0],
		)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())

		dal.truncateStaleRun.mockReset()
		activeRuns.register('r-live', {
			conversationId: CONVERSATION_ID,
			controller: new AbortController(),
		})
		dal.findConversation.mockResolvedValue({ ...conversation, activeRunId: 'r-live' })
		await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })
		expect(dal.truncateStaleRun).not.toHaveBeenCalled()
		activeRuns.release('r-live')
	})
})

// Spec §4.3 step 1 (decision 50; plan call P3).
describe('runTurn: what the conversation waits for', () => {
	const approval = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }

	it('refuses a message while an interrupt is open, storing nothing', async () => {
		dal.lastRun.mockResolvedValue(interrupted([approval]))
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 409,
			body: { code: 'answer_pending', message: 'Answer the open question first.', status: 409 },
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('refuses answers that do not match what is open', async () => {
		dal.lastRun.mockResolvedValue(interrupted([approval]))
		const response = await run({
			conversationId: CONVERSATION_ID,
			answers: { resume: [{ interruptId: 'int-9', status: 'resolved' }] },
		})
		expect(await envelope(response)).toEqual({
			status: 400,
			body: {
				code: 'answers_invalid',
				message: 'The answers do not match what the conversation waits for.',
				status: 400,
			},
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('resumes with the answers, and leaves the gated call to the agent', async () => {
		opens({ ok: true })
		dal.lastRun.mockResolvedValue(interrupted([approval]))
		dal.loadThread.mockResolvedValue([
			userRow(1, 'm1', 'Delete it'),
			callRow(2, 'call-1', 'call-2'),
		])
		const resume = [{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } }]
		await run({ conversationId: CONVERSATION_ID, answers: { resume } })
		expect(started().resume).toEqual(resume)
		// call-2 is a call to a tool the hub never advertised (plan call P4); call-1 is the one the approval gates.
		expect(started().messages).toEqual([
			expect.objectContaining({
				role: 'tool',
				toolCallId: 'call-2',
				error: UNAVAILABLE_TOOL_ERROR,
				content: UNAVAILABLE_TOOL_CONTENT,
			}),
		])
		expect(adapterInput().resume).toEqual(resume)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers an unanswered call to a tool the hub never advertised before the user message', async () => {
		opens({ ok: true })
		dal.loadThread.mockResolvedValue([userRow(1, 'm1', 'Look it up'), callRow(2, 'call-9')])
		await run({ conversationId: CONVERSATION_ID, message: { text: 'Go on' } })
		expect(started().messages).toEqual([
			expect.objectContaining({
				role: 'tool',
				toolCallId: 'call-9',
				error: UNAVAILABLE_TOOL_ERROR,
				content: UNAVAILABLE_TOOL_CONTENT,
			}),
			expect.objectContaining({ role: 'user', content: 'Go on' }),
		])
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	it('answers 409 when the conversation already runs', async () => {
		dal.startRun.mockResolvedValue({ ok: false, code: 'run_in_progress' })
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 409,
			body: {
				code: 'run_in_progress',
				message: 'A run is already in progress in this conversation.',
				status: 409,
			},
		})
		expect(chat.runTurn).not.toHaveBeenCalled()
	})
})

// Spec §4.3 step 4 and plan call P5: the agent's refusal before any stream is the hub's envelope, not a stream.
describe('runTurn: an agent that refuses before the stream', () => {
	it.each(Object.entries(UPSTREAM_STATUS) as [UpstreamErrorCode, number][])(
		'answers %s with %i, stores the run failed and logs the code only',
		async (code, status) => {
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			opens({ ok: false, code }, Promise.resolve({ failed: true }))
			const response = await run({ message: { text: 'hi' } })
			expect(await envelope(response)).toEqual({
				status,
				body: { code, message: UPSTREAM_MESSAGES[code], status },
			})
			const key = { conversationId: started().conversation.id, runId: started().runId }
			expect(dal.finishRun).toHaveBeenCalledWith(key, {
				status: 'failed',
				error: { code, message: UPSTREAM_MESSAGES[code] },
				custom: [],
			})
			expect(errorSpy).toHaveBeenCalledWith('runTurn:', { appId: APP_ID, runId: key.runId, code })
			expect(sessions[0].finish).not.toHaveBeenCalled()
			expect(activeRuns.has(key.runId)).toBe(false)
			errorSpy.mockRestore()
		},
	)

	it('stores the run failed and rethrows when the hub cannot hand it to the agent', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		dal.loadThread.mockRejectedValueOnce(new Error('db down'))
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('db down')
		expect(dal.finishRun).toHaveBeenCalledWith(
			{ conversationId: started().conversation.id, runId: started().runId },
			{ status: 'failed', error: { code: 'internal_error', message: '' }, custom: [] },
		)
		expect(chat.runTurn).not.toHaveBeenCalled()
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})
})

// Spec §4.5: a browser that goes away aborts the upstream request; the run is stored as truncated (Task 10's finish).
describe('runTurn: a browser that leaves', () => {
	it('aborts the upstream request mid-stream and settles the run as a disconnect', async () => {
		let end!: (value: { failed: boolean }) => void
		opens({ ok: true }, new Promise(resolve => (end = resolve)))
		const browser = new AbortController()
		const response = await run({ message: { text: 'hi' } }, browser.signal)
		expect(response.status).toBe(200)
		browser.abort()
		expect(adapterInput().abortController.signal.aborted).toBe(true)
		end({ failed: false })
		await vi.waitFor(() =>
			expect(sessions[0].finish).toHaveBeenCalledWith({ failed: false, stopReason: 'disconnect' }),
		)
	})

	// The browser knows the run id only from hub:run, inside the stream: before the agent answers, closing the request is
	// its only stop. The adapter's refusal is then the stop's doing, not the agent's: no envelope, no failed write.
	it('settles a run stopped before the agent answered as that stop, not as a failure', async () => {
		chat.runTurn.mockImplementation(
			(_app: unknown, input: { abortController: AbortController }) => {
				const aborted = new Promise<void>(resolve =>
					input.abortController.signal.addEventListener('abort', () => resolve(), { once: true }),
				)
				return {
					opened: aborted.then(() => ({ ok: false, code: 'provider_unreachable' })),
					finished: aborted.then(() => ({ failed: false })),
				}
			},
		)
		const browser = new AbortController()
		const pending = run({ message: { text: 'hi' } }, browser.signal)
		await vi.waitFor(() => expect(chat.runTurn).toHaveBeenCalled())
		browser.abort()
		const response = await pending
		expect(response.status).toBe(200)
		await vi.waitFor(() =>
			expect(sessions[0].finish).toHaveBeenCalledWith({ failed: false, stopReason: 'disconnect' }),
		)
		expect(dal.finishRun).not.toHaveBeenCalled()
	})
})
```

Create `__tests__/chat-routes.test.ts`:

```ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	runTurn: vi.fn(),
	reconcileStaleRun: vi.fn(),
	findConversation: vi.fn(),
	listConversations: vi.fn(),
	readThreadPage: vi.fn(),
	decodeListCursor: vi.fn(),
	turnsFromMessages: vi.fn(),
	stop: vi.fn(),
	chat: { runTurn: vi.fn() },
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession: m.verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: m.getAppAccess }))
vi.mock('@/lib/providers/registry', () => ({
	chatAdapterOf: (provider: string) => (provider === 'agui' ? m.chat : undefined),
}))
vi.mock('@/lib/chat/run', () => ({ runTurn: m.runTurn, reconcileStaleRun: m.reconcileStaleRun }))
vi.mock('@/lib/data/conversations', () => ({
	LIST_PAGE_MAX: 100,
	THREAD_PAGE_TURNS: 20,
	decodeListCursor: m.decodeListCursor,
	findConversation: m.findConversation,
	listConversations: m.listConversations,
	readThreadPage: m.readThreadPage,
}))
vi.mock('@/lib/chat/turn', () => ({ turnsFromMessages: m.turnsFromMessages }))
vi.mock('@/lib/chat/active-runs', () => ({ activeRuns: { stop: m.stop } }))

import { GET as getConversation } from '@/app/api/apps/[appId]/conversations/[conversationId]/route'
import { POST as stopRun } from '@/app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route'
import { GET as listConversations } from '@/app/api/apps/[appId]/conversations/route'
import { POST as postRun } from '@/app/api/apps/[appId]/runs/route'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const RUN_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user', source: 'local' }
const agui = {
	id: APP_ID,
	enabled: true,
	provider: 'agui',
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
const conversation = {
	id: CONVERSATION_ID,
	appId: APP_ID,
	title: 'Tea',
	state: { a: 1 },
	activeRunId: null,
}
const base = `http://hub/api/apps/${APP_ID}`
const ctx = <P extends Record<string, string>>(extra?: P) => ({
	params: Promise.resolve({ appId: APP_ID, ...extra } as { appId: string } & P),
})
const post = (path: string, body: unknown) =>
	new NextRequest(`${base}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
const read = async (response: Response) => ({
	status: response.status,
	body: await response.json(),
})

beforeEach(() => {
	for (const fn of [
		m.verifySession,
		m.getAppAccess,
		m.runTurn,
		m.reconcileStaleRun,
		m.findConversation,
		m.listConversations,
		m.readThreadPage,
		m.decodeListCursor,
		m.turnsFromMessages,
		m.stop,
	])
		fn.mockReset()
	m.verifySession.mockResolvedValue(actor)
	m.getAppAccess.mockResolvedValue(agui)
	m.findConversation.mockResolvedValue(conversation)
})

describe('POST runs', () => {
	it('answers 401 signed out and 404 for an app without the shared chat, running nothing', async () => {
		m.verifySession.mockResolvedValue(null)
		expect((await postRun(post('/runs', { message: { text: 'hi' } }), ctx())).status).toBe(401)
		m.verifySession.mockResolvedValue(actor)
		m.getAppAccess.mockResolvedValue({ ...agui, provider: 'dify' })
		expect(await read(await postRun(post('/runs', { message: { text: 'hi' } }), ctx()))).toEqual({
			status: 404,
			body: { code: 'app_not_found', message: 'No such app.', status: 404 },
		})
		expect(m.runTurn).not.toHaveBeenCalled()
	})
	it('refuses a body with both a message and answers', async () => {
		const body = {
			conversationId: CONVERSATION_ID,
			message: { text: 'hi' },
			answers: { resume: [] },
		}
		expect(await read(await postRun(post('/runs', body), ctx()))).toEqual({
			status: 400,
			body: { code: 'invalid_param', message: 'Invalid request: message', status: 400 },
		})
		expect(m.runTurn).not.toHaveBeenCalled()
	})
	it('hands the guard’s actor, app and adapter and the checked body to runTurn, and answers its response', async () => {
		const streamed = new Response('data: {}\n\n', {
			headers: { 'content-type': 'text/event-stream' },
		})
		m.runTurn.mockResolvedValue(streamed)
		const request = post('/runs', { message: { text: 'hi' } })
		expect(await postRun(request, ctx())).toBe(streamed)
		expect(m.runTurn).toHaveBeenCalledWith({
			request,
			actor,
			app: agui,
			chat: m.chat,
			body: { message: { text: 'hi' } },
		})
	})
	it('answers a logged 500 envelope when the run throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		m.runTurn.mockRejectedValue(new Error('boom'))
		expect((await postRun(post('/runs', { message: { text: 'hi' } }), ctx())).status).toBe(500)
		expect(errorSpy).toHaveBeenCalledWith('POST /api/apps/[appId]/runs:', expect.any(Error))
		errorSpy.mockRestore()
	})
})

describe('GET conversations', () => {
	it('lists the actor’s conversations of the app, newest first, uncached', async () => {
		const page = {
			items: [{ id: CONVERSATION_ID, title: 'Tea', updatedAt: '2026-10-14T10:00:00.000Z' }],
			nextCursor: null,
		}
		m.listConversations.mockResolvedValue(page)
		const response = await listConversations(new NextRequest(`${base}/conversations`), ctx())
		expect(await read(response)).toEqual({ status: 200, body: page })
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(m.listConversations).toHaveBeenCalledWith(actor, APP_ID, {
			cursor: undefined,
			limit: 100,
		})
	})
	it('passes on a cursor the DAL reads', async () => {
		m.decodeListCursor.mockReturnValue({ updatedAt: new Date(), id: CONVERSATION_ID })
		m.listConversations.mockResolvedValue({ items: [], nextCursor: null })
		await listConversations(new NextRequest(`${base}/conversations?cursor=abc`), ctx())
		expect(m.decodeListCursor).toHaveBeenCalledWith('abc')
		expect(m.listConversations).toHaveBeenCalledWith(actor, APP_ID, { cursor: 'abc', limit: 100 })
	})
	it('refuses an empty cursor, and one the DAL cannot read', async () => {
		expect(
			(await listConversations(new NextRequest(`${base}/conversations?cursor=`), ctx())).status,
		).toBe(400)
		m.decodeListCursor.mockReturnValue(null)
		expect(
			await read(
				await listConversations(new NextRequest(`${base}/conversations?cursor=bad`), ctx()),
			),
		).toEqual({
			status: 400,
			body: { code: 'invalid_param', message: 'Invalid request: cursor', status: 400 },
		})
		expect(m.listConversations).not.toHaveBeenCalled()
	})
})

describe('GET conversations/[conversationId]', () => {
	const get = (query = '') => new NextRequest(`${base}/conversations/${CONVERSATION_ID}${query}`)
	const notFound = {
		status: 404,
		body: { code: 'conversation_not_found', message: 'No such conversation.', status: 404 },
	}
	it('answers the latest turns, after a stale run is reconciled', async () => {
		const page = { conversation, rows: ['rows'], runs: ['runs'], cursor: '12' }
		m.readThreadPage.mockResolvedValue(page)
		m.turnsFromMessages.mockReturnValue(['turns'])
		const response = await getConversation(
			get('?before=42'),
			ctx({ conversationId: CONVERSATION_ID }),
		)
		expect(await read(response)).toEqual({
			status: 200,
			body: { id: CONVERSATION_ID, title: 'Tea', state: { a: 1 }, turns: ['turns'], cursor: '12' },
		})
		expect(m.reconcileStaleRun).toHaveBeenCalledWith(conversation)
		expect(m.readThreadPage).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID, {
			before: 42,
			turns: 20,
		})
		expect(m.turnsFromMessages).toHaveBeenCalledWith(['rows'], ['runs'])
		expect(response.headers.get('cache-control')).toBe('private, no-store')
	})
	it('answers a malformed or foreign conversation as unknown', async () => {
		expect(await read(await getConversation(get(), ctx({ conversationId: 'nope' })))).toEqual(
			notFound,
		)
		m.findConversation.mockResolvedValue(null)
		expect(
			await read(await getConversation(get(), ctx({ conversationId: CONVERSATION_ID }))),
		).toEqual(notFound)
		expect(m.readThreadPage).not.toHaveBeenCalled()
	})
	it('refuses a cursor that is no positive integer', async () => {
		expect(
			(await getConversation(get('?before=abc'), ctx({ conversationId: CONVERSATION_ID }))).status,
		).toBe(400)
	})
})

describe('POST …/runs/[runId]/stop', () => {
	const stop = (conversationId: string, runId: string) =>
		stopRun(
			new NextRequest(`${base}/conversations/${conversationId}/runs/${runId}/stop`, {
				method: 'POST',
			}),
			ctx({ conversationId, runId }),
		)
	it('stops the run of the actor’s conversation and answers 204', async () => {
		const response = await stop(CONVERSATION_ID, RUN_ID)
		expect(response.status).toBe(204)
		expect(m.stop).toHaveBeenCalledWith(RUN_ID, CONVERSATION_ID, 'stop')
	})
	// Spec §4.2: 204 also when the run has already ended; a malformed id names no run of this process.
	it('answers 204 for a run id that is no UUID, stopping nothing', async () => {
		expect((await stop(CONVERSATION_ID, 'nope')).status).toBe(204)
		expect(m.stop).not.toHaveBeenCalled()
	})
	it('answers 404 for a conversation that is not the actor’s, and 401 signed out', async () => {
		m.findConversation.mockResolvedValue(null)
		expect((await stop(CONVERSATION_ID, RUN_ID)).status).toBe(404)
		m.verifySession.mockResolvedValue(null)
		expect((await stop(CONVERSATION_ID, RUN_ID)).status).toBe(401)
		expect(m.stop).not.toHaveBeenCalled()
	})
})
```

Replace the whole of `__tests__/api-routes.test.ts` with:

```ts
import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Charter §5, B2 "done when": no Route Handler remains under app/api except auth, health, dify and the icon route;
// B3b adds the directory group search, a read the groups page makes (ADR-0029, decision al); the settings spec adds the
// two public brand image routes; Part 2 spec §4.2 adds the shared chat's four routes under apps/[appId]/ (a run, the
// conversation list, one conversation, a run's stop). The forgot and reset password handlers stay as inherited (plan
// deviation 6, ADR-0024); they are named here so a new handler under auth/ still fails the test.
const routes = (readdirSync('app/api', { recursive: true }) as string[])
	.map(file => file.replaceAll('\\', '/'))
	.filter(file => /(^|\/)route\.ts$/.test(file))

describe('app/api', () => {
	it('holds only the auth, health, Dify, app, directory group search and brand image Route Handlers', () => {
		expect(routes.length).toBeGreaterThan(0)
		const stray = routes.filter(
			file =>
				!/^(auth\/(\[\.\.\.nextauth\]|forgot-password|reset-password)|health|dify\/\[appId\]\/.+|apps\/\[appId\]\/(icon|runs|conversations(\/\[conversationId\](\/runs\/\[runId\]\/stop)?)?)|directory\/groups|branding\/(logo|favicon))\/route\.ts$/.test(
					file,
				),
		)
		expect(stray).toEqual([])
		// Part 1 spec §6 (decision 21): the two annotation routes are gone with the feature.
		expect(routes.filter(file => file.includes('annotations'))).toEqual([])
	})

	it('holds exactly the shared chat routes of spec §4.2 under apps/[appId]/', () => {
		expect(
			routes
				.filter(file => file.startsWith('apps/[appId]/') && file !== 'apps/[appId]/icon/route.ts')
				.sort(),
		).toEqual([
			'apps/[appId]/conversations/[conversationId]/route.ts',
			'apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts',
			'apps/[appId]/conversations/route.ts',
			'apps/[appId]/runs/route.ts',
		])
	})
})
```

- [ ] **Step 9: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts` Expected: FAIL: `chat-run` and `chat-routes` cannot resolve `@/lib/chat/run` and the route modules; `api-routes` fails "holds exactly the shared chat routes" (`[]` received).

- [ ] **Step 10: Write the run**

Create `lib/chat/run.ts`:

```ts
import 'server-only'

import type { Message, ResumeEntry } from '@ag-ui/core'

import type { SessionUser } from '@/lib/auth/session'
import {
	finishRun,
	lastRun,
	loadThread,
	startRun,
	truncateStaleRun,
	type ConversationRecord,
	type RunKey,
} from '@/lib/data/conversations'
import { logActionError } from '@/lib/error-log'
import { errorResponse } from '@/lib/http/errors'
import type { ProviderId } from '@/lib/providers/ids'
import type { ProviderAppAccess } from '@/lib/providers/route'

import { activeRuns } from './active-runs'
import {
	UPSTREAM_STATUS,
	type ChatAdapter,
	type ChatTurnHandle,
	type ChatTurnOpened,
	type UpstreamErrorCode,
} from './adapter'
import { checkAnswers, openItemsOf } from './answers'
import { conversationNotFound, resolveConversation } from './route'
import type { RunBody } from './schemas'
import { RunSession } from './session'
import { createEventStream, SSE_HEADERS } from './stream'
import {
	errorToolMessage,
	threadForAgent,
	titleFrom,
	UNAVAILABLE_TOOL_CONTENT,
	UNAVAILABLE_TOOL_ERROR,
	unansweredToolCalls,
} from './thread'

/*
 * A run on the server (Part 2 spec §4.3): the checks, the store, the RunAgentInput, the upstream errors before any
 * stream, then the stream while the session persists (Task 10). Next's "Streaming in Route Handlers" answers a
 * `ReadableStream`; the run goes on while that response streams, writing into it, and closes it at the end.
 */

/** Spec §4.3 step 4 and plan call P5: the envelope's message per code ("The agent is restarting, try again"). */
export const UPSTREAM_MESSAGES: Record<UpstreamErrorCode, string> = {
	agent_auth_failed: 'The agent refused the hub’s credentials.',
	agent_not_found: 'The agent was not found.',
	agent_rejected_input: 'The agent refused the request.',
	provider_unreachable: 'The agent is restarting, try again.',
	upstream_error: 'The agent answered with an error.',
}

const ANSWER_PENDING = 'Answer the open question first.'
const ANSWERS_INVALID = 'The answers do not match what the conversation waits for.'
const RUN_IN_PROGRESS = 'A run is already in progress in this conversation.'

/** Spec §3.2 step 5: a run stored as running that this process does not hold was left by a crash; it becomes truncated. */
export const reconcileStaleRun = async (conversation: ConversationRecord): Promise<void> => {
	const runId = conversation.activeRunId
	if (runId && !activeRuns.has(runId))
		await truncateStaleRun({ conversationId: conversation.id, runId })
}

export interface RunTurnArgs {
	request: Request
	actor: SessionUser
	app: ProviderAppAccess<ProviderId>
	chat: ChatAdapter<ProviderId>
	body: RunBody
}

/** Spec §4.4: log lines carry the app, the run and a code, never content. */
const logRun = (appId: string, runId: string, code: string) =>
	console.error('runTurn:', { appId, runId, code })

/**
 * Spec §4.3. Step 1, the checks: the conversation is the actor's (§4.1); a run this process lost is truncated first
 * (§3.2 step 5); a message while something is open answers 409 answer_pending (decision 50), answers that do not cover
 * what is open 400 answers_invalid. Step 2, the store: the messages and the run in one transaction (startRun; an active
 * run answers 409 run_in_progress), a new conversation created with them. Steps 3–5 in streamRun.
 */
export const runTurn = async ({
	request,
	actor,
	app,
	chat,
	body,
}: RunTurnArgs): Promise<Response> => {
	let conversation: ConversationRecord | null = null
	if (body.conversationId) {
		const found = await resolveConversation(actor, app.id, body.conversationId)
		if (!found.ok) return found.response
		conversation = found.conversation
		await reconcileStaleRun(conversation)
	}
	const open = openItemsOf(conversation ? await lastRun(conversation.id) : null)
	let resume: ResumeEntry[] | undefined
	let answers: Message[] = []
	if (body.answers) {
		const checked = checkAnswers(open, body.answers)
		if (!checked.ok) return errorResponse('answers_invalid', ANSWERS_INVALID, 400)
		resume = checked.resume
		answers = checked.toolMessages
	} else if (open.interrupts.length > 0) return errorResponse('answer_pending', ANSWER_PENDING, 409)

	// Plan call P4 (spec §6.2): a call to a tool the hub never advertised, left without a result, is answered with an error
	// tool message, so the next history is valid. The calls the answers cover, and a gated call an open interrupt names
	// (its result comes from the resumed run), are left alone.
	const rows = conversation ? await loadThread(conversation.id) : []
	const kept = new Set([
		...answers.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : [])),
		...open.interrupts.flatMap(interrupt => (interrupt.toolCallId ? [interrupt.toolCallId] : [])),
	])
	const notAvailable = unansweredToolCalls(threadForAgent(rows))
		.filter(call => !kept.has(call.toolCallId))
		.map(call =>
			errorToolMessage(call.toolCallId, UNAVAILABLE_TOOL_ERROR, UNAVAILABLE_TOOL_CONTENT),
		)
	const text = body.message?.text
	const userMessage: Message[] =
		text === undefined ? [] : [{ id: crypto.randomUUID(), role: 'user', content: text }]
	const title = conversation ? conversation.title : titleFrom(text ?? '')

	const runId = crypto.randomUUID()
	const started = await startRun(actor, {
		appId: app.id,
		conversation: conversation
			? { id: conversation.id }
			: { id: crypto.randomUUID(), title, isNew: true },
		runId,
		messages: [...notAvailable, ...answers, ...userMessage],
		resume,
	})
	if (!started.ok)
		return started.code === 'run_in_progress'
			? errorResponse('run_in_progress', RUN_IN_PROGRESS, 409)
			: conversationNotFound()
	return streamRun({
		request,
		actor,
		app,
		chat,
		key: started.key,
		title,
		state: conversation?.state ?? {},
		resume,
	})
}

/**
 * Steps 3–5. The thread is read back from the store (§3.3), the rows just written included, and handed to the adapter
 * with the run's own AbortController, which the stop route (§4.5) and a disconnect abort through activeRuns. The session
 * writes `hub:run` before the adapter can report an event. A refusal before any stream (§4.3 step 4) answers the envelope
 * and stores the run failed, unless a stop caused it: then, as every other run, it is settled by the session (§4.5).
 */
const streamRun = async ({
	request,
	actor,
	app,
	chat,
	key,
	title,
	state,
	resume,
}: Omit<RunTurnArgs, 'body'> & {
	key: RunKey
	title: string
	state: unknown
	resume: ResumeEntry[] | undefined
}): Promise<Response> => {
	const out = createEventStream()
	const controller = new AbortController()
	let session: RunSession
	let handle: ChatTurnHandle
	let opened: ChatTurnOpened
	try {
		const messages = threadForAgent(await loadThread(key.conversationId))
		// The session seeds its write memory with the thread the agent is given, so no history row is written again (Task 10).
		session = new RunSession({ key, appId: app.id, title, out, history: messages })
		activeRuns.register(key.runId, { conversationId: key.conversationId, controller })
		// Spec §4.5: the browser that goes away aborts the upstream request (the run is stored truncated). Next aborts
		// `request.signal` when the client disconnects: the docs are silent for Node Route Handlers; the source is
		// NextRequestAdapter (part2-proxy-stop-identity.md §6). A signal already aborted fires no event, so it is read first.
		const onDisconnect = () => activeRuns.stop(key.runId, key.conversationId, 'disconnect')
		if (request.signal.aborted) onDisconnect()
		else request.signal.addEventListener('abort', onDisconnect, { once: true })
		session.start()
		handle = chat.runTurn(
			{ settings: app.settings, secrets: app.secrets },
			{
				threadId: key.conversationId,
				runId: key.runId,
				messages,
				state,
				tools: [],
				resume,
				caller: { id: actor.id, source: actor.source, role: actor.role },
				abortController: controller,
			},
			session,
		)
		opened = await handle.opened
	} catch (error) {
		activeRuns.release(key.runId)
		out.close()
		await finishRun(key, {
			status: 'failed',
			error: { code: 'internal_error', message: '' },
			custom: [],
		}).catch(finishError => logActionError(finishError, 'runTurn'))
		throw error
	}
	if (!opened.ok && activeRuns.reasonOf(key.runId) === undefined) {
		logRun(app.id, key.runId, opened.code)
		activeRuns.release(key.runId)
		out.close()
		await finishRun(key, {
			status: 'failed',
			error: { code: opened.code, message: UPSTREAM_MESSAGES[opened.code] },
			custom: [],
		})
		return errorResponse(opened.code, UPSTREAM_MESSAGES[opened.code], UPSTREAM_STATUS[opened.code])
	}
	void settle(handle, session, key, app.id, out)
	return new Response(out.stream, { headers: SSE_HEADERS })
}

/**
 * The rest of the run while the response streams: once the adapter's run is over, the session decides its status, closes
 * what is open, writes the end and the browser's last events (§3.2 steps 3–4, §4.5); then the run is released and the
 * stream ends. A failing end write is logged by code; the run stays stored as running, and once released the next
 * request truncates it (§3.2 step 5).
 */
const settle = async (
	handle: ChatTurnHandle,
	session: RunSession,
	key: RunKey,
	appId: string,
	out: { close(): void },
): Promise<void> => {
	try {
		const { failed } = await handle.finished
		await session.finish({ failed, stopReason: activeRuns.reasonOf(key.runId) })
	} catch (error) {
		logRun(appId, key.runId, 'finish_failed')
		logActionError(error, 'runTurn')
	} finally {
		activeRuns.release(key.runId)
		out.close()
	}
}
```

- [ ] **Step 11: Write the four Route Handlers**

Create `app/api/apps/[appId]/runs/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { resolveChatRoute } from '@/lib/chat/route'
import { runTurn } from '@/lib/chat/run'
import { runBodySchema } from '@/lib/chat/schemas'
import { errorResponseFrom } from '@/lib/http/errors'
import { parseJsonBody } from '@/lib/http/parse'

/**
 * POST runs (Part 2 spec §4.2, §4.3): one turn of the app's agent, answered as the hub's AG-UI event stream (§4.4), or as
 * the hub's envelope when it is refused before any stream.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/apps/[appId]/runs'>) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const body = await parseJsonBody(request, runBodySchema)
	if (!body.ok) return body.response
	try {
		const { actor, app, chat } = resolved
		return await runTurn({ request, actor, app, chat, body: body.data })
	} catch (error) {
		return errorResponseFrom(error, 'POST /api/apps/[appId]/runs')
	}
}
```

Create `app/api/apps/[appId]/conversations/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { resolveChatRoute } from '@/lib/chat/route'
import { conversationsQuerySchema } from '@/lib/chat/schemas'
import { decodeListCursor, LIST_PAGE_MAX, listConversations } from '@/lib/data/conversations'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { parseQuery } from '@/lib/http/parse'
import { jsonNoStore } from '@/lib/http/response'

/**
 * GET conversations (spec §4.2): the actor's conversations of this app, newest first, keyset-paged on (updated_at, id),
 * not deleted; the newest LIST_PAGE_MAX (plan call P8). A cursor the DAL cannot read answers 400, as any refused query.
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/conversations'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, conversationsQuerySchema)
	if (!query.ok) return query.response
	const { cursor } = query.data
	if (cursor !== undefined && !decodeListCursor(cursor))
		return errorResponse('invalid_param', 'Invalid request: cursor', 400)
	try {
		const { actor, app } = resolved
		return jsonNoStore(await listConversations(actor, app.id, { cursor, limit: LIST_PAGE_MAX }))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/conversations')
	}
}
```

Create `app/api/apps/[appId]/conversations/[conversationId]/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { conversationNotFound, resolveChatRoute, resolveConversation } from '@/lib/chat/route'
import { reconcileStaleRun } from '@/lib/chat/run'
import { threadQuerySchema } from '@/lib/chat/schemas'
import { turnsFromMessages } from '@/lib/chat/turn'
import { readThreadPage, THREAD_PAGE_TURNS } from '@/lib/data/conversations'
import { errorResponseFrom } from '@/lib/http/errors'
import { parseQuery } from '@/lib/http/parse'
import { jsonNoStore } from '@/lib/http/response'

/**
 * GET conversations/[conversationId] (spec §4.2, §3.3): the latest turns, grouped on the server, with a "load earlier"
 * cursor and the state. A run this process lost is truncated first (§3.2 step 5), so a reload after a crash shows it
 * stopped, not running.
 */
export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/conversations/[conversationId]'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	const query = parseQuery(request.nextUrl.searchParams, threadQuerySchema)
	if (!query.ok) return query.response
	try {
		const { actor, app } = resolved
		const { conversationId } = await ctx.params
		const found = await resolveConversation(actor, app.id, conversationId)
		if (!found.ok) return found.response
		await reconcileStaleRun(found.conversation)
		const page = await readThreadPage(actor, app.id, conversationId, {
			before: query.data.before,
			turns: THREAD_PAGE_TURNS,
		})
		if (!page) return conversationNotFound()
		return jsonNoStore({
			id: page.conversation.id,
			title: page.conversation.title,
			state: page.conversation.state,
			turns: turnsFromMessages(page.rows, page.runs),
			cursor: page.cursor,
		})
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/apps/[appId]/conversations/[conversationId]')
	}
}
```

Create `app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts`:

```ts
import type { NextRequest } from 'next/server'

import { activeRuns } from '@/lib/chat/active-runs'
import { resolveChatRoute, resolveConversation } from '@/lib/chat/route'
import { errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

/**
 * POST …/runs/[runId]/stop (spec §4.2, §4.5): AG-UI has no stop request, so the hub aborts the upstream request through
 * the run's AbortController and closes the run as cancelled (the session, Task 10), as CopilotKit's runtime stop,
 * LibreChat's `/chat/abort` and Open WebUI's task stop do. 204, also when the run has already ended; activeRuns stops a
 * run only when it belongs to this conversation, and this process holds it (several containers: a follow-up, §3.2).
 */
export async function POST(
	_request: NextRequest,
	ctx: RouteContext<'/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop'>,
) {
	const resolved = await resolveChatRoute(ctx.params)
	if (!resolved.ok) return resolved.response
	try {
		const { actor, app } = resolved
		const { conversationId, runId } = await ctx.params
		const found = await resolveConversation(actor, app.id, conversationId)
		if (!found.ok) return found.response
		if (isId(runId)) activeRuns.stop(runId, conversationId, 'stop')
		return new Response(null, { status: 204 })
	} catch (error) {
		return errorResponseFrom(
			error,
			'POST /api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop',
		)
	}
}
```

- [ ] **Step 12: Run the tests to see them pass, then the gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output (typegen generates the four `RouteContext` literals).

Run: `pnpm exec vitest run --project unit __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts` Expected: PASS, 6 files, 0 failed.

Run: `pnpm exec oxlint lib/chat/schemas.ts lib/chat/answers.ts lib/chat/route.ts lib/chat/run.ts 'app/api/apps/[appId]/runs/route.ts' 'app/api/apps/[appId]/conversations/route.ts' 'app/api/apps/[appId]/conversations/[conversationId]/route.ts' 'app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts' __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts` Expected: `Found 0 warnings and 0 errors.`

Run: `pnpm exec oxfmt --write <the same files>` then `pnpm exec oxfmt --check <the same files>` Expected: the check reports no file to format (the test files above are long-lined; oxfmt rewraps them).

Run: `pnpm test` Expected: every unit file passes, 0 failed.

- [ ] **Step 13: Commit**

```bash
git add lib/chat/schemas.ts lib/chat/answers.ts lib/chat/route.ts lib/chat/run.ts \
  'app/api/apps/[appId]/runs/route.ts' 'app/api/apps/[appId]/conversations/route.ts' \
  'app/api/apps/[appId]/conversations/[conversationId]/route.ts' \
  'app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts' \
  __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts \
  __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts
git commit -m "feat(chat): add the shared chat routes for runs, conversations and stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/schemas.ts", "lib/chat/answers.ts", "lib/chat/route.ts", "lib/chat/run.ts", "app/api/apps/[appId]/runs/route.ts", "app/api/apps/[appId]/conversations/route.ts", "app/api/apps/[appId]/conversations/[conversationId]/route.ts", "app/api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop/route.ts", "__tests__/chat-schemas.test.ts", "__tests__/chat-answers.test.ts", "__tests__/chat-route.test.ts", "__tests__/chat-run.test.ts", "__tests__/chat-routes.test.ts", "__tests__/api-routes.test.ts"], "verifyCommand": "pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run --project unit __tests__/chat-schemas.test.ts __tests__/chat-answers.test.ts __tests__/chat-route.test.ts __tests__/chat-run.test.ts __tests__/chat-routes.test.ts __tests__/api-routes.test.ts", "acceptanceCriteria": ["The six test files pass with 0 failed", "POST runs refuses a body with both or neither of message and answers, answers without conversationId, a blank or 32,001-character text with 400 invalid_param and no DAL call", "A message while the last run is interrupted answers 409 answer_pending and stores nothing; mismatched, repeated, unknown or expired-resolved answers and any toolResults answer 400 answers_invalid", "startRun's run_in_progress answers 409 run_in_progress", "Each upstream code answers UPSTREAM_STATUS with the envelope { code, message: UPSTREAM_MESSAGES[code], status }, stores the run failed and logs { appId, runId, code }", "An opened run answers 200 with every SSE_HEADERS header; session.start() runs before the adapter; session.finish({ failed, stopReason }) runs after finished; the run is released and the body ends", "A closed browser request aborts the adapter's abortController and the run settles with stopReason 'disconnect', also before the agent answered (no envelope, no failed write)", "An unanswered call to an unadvertised tool gets a tool message with UNAVAILABLE_TOOL_ERROR and UNAVAILABLE_TOOL_CONTENT before the user message; a call an open interrupt names does not", "A stale activeRunId is truncated before the run starts and before the history is read", "GET conversations calls listConversations(actor, appId, { cursor, limit: LIST_PAGE_MAX }) and answers private, no-store, 400 for a cursor decodeListCursor refuses; GET conversations/[id] answers { id, title, state, turns, cursor }, 404 conversation_not_found for malformed or foreign ids, 400 for ?before=abc; the stop route answers 204 and stops only a well-formed run id of the actor's conversation", "Every route answers 401 signed out and 404 app_not_found for a Dify app; api-routes pins exactly the four new routes"], "modelTier": "standard"}
```

---

### Task 12: Rename and delete actions, and the daily purge

**Goal:** A user renames and deletes their own conversations through two Server Actions returning `ActionResult` (spec §4.2, ADR-0024), and a daily job purges conversations deleted more than 30 days ago (spec §3.4; plan call P13).

Spec §3.4, §4.2; plan calls P13. Builds on Task 4 (`hubHistory` on every provider definition) and Tasks 6–7 (`findConversation`, `renameConversation`, `softDeleteConversation`, `purgeDeletedConversations`), Task 5 (`TITLE_MAX_LENGTH` in `lib/chat/statuses.ts`) and Task 10 (`activeRuns`).

**Behaviour this task fixes where the spec is silent:**

- **No `refresh()`.** The admin actions call `refresh()` because their pages read the database on the server; the chat page's server render holds only the app (the conversation list is the shared chat's client state, Task 15), so these actions answer their result and the client updates its list from it. Next "Server Actions": "An action that does none of the above carries only its return value, and the current route is not re-rendered" (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`).
- **The app must still be usable:** visible to the actor, enabled, and of a provider whose conversations the hub keeps (`PROVIDERS[provider].hubHistory`, spec §4.1); anything else, and a conversation that is not the actor's (`findConversation`'s and the DAL writes' own WHERE), answers `not_found`, so nothing can be told apart (B3 spec §4.2's rule).
- **A title is 1–80 code points after trimming** (`TITLE_MAX_LENGTH`, Task 5; the same bound as the first message's title, spec §3.1). zod's `.max()` counts UTF-16 code units, so the check counts code points with `Array.from()` (MDN "String: length": "the number of UTF-16 code units"; "Array.from()" iterates a string by code points); `.max(TITLE_MAX_LENGTH * 2)` first bounds the input before it is split (a code point is at most two code units).
- **Deleting a conversation stops its run first:** `softDeleteConversation` does not touch a run (Task 7), so a conversation with an active run is stopped through `activeRuns.stop(activeRunId, conversationId, 'stop')` (the stop route's path, spec §4.5) before it is soft-deleted; its session then stores the run `cancelled`.
- **The purge logs its count** (`'conversationPurge:', { purged }`) on every run, and a failing run through croner's `catch` option into `logActionError`, as the directory sync does.
- **`register()` starts each job on its own:** a failing directory schedule no longer stops the purge from starting, and the other way round; each failure is logged under its own name, through `describeError` (final review M9 of B3b).

**Files:**

- Create: `app/(user)/chat/actions.ts`, `lib/chat/purge.ts`, `__tests__/chat-actions.test.ts`, `__tests__/chat-purge.test.ts`
- Modify: `instrumentation.ts` (whole file replaced), `__tests__/instrumentation.test.ts` (whole file replaced)

`lib/action-result.ts` needs no new code: `unauthorized`, `invalid_input`, `not_found` and `operation_failed` exist.

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts` reports every test passed, 0 failed.
- [ ] Signed out, both actions answer `{ ok: false, code: 'unauthorized' }`; a malformed app or conversation id answers `{ ok: false, code: 'not_found' }` with no read.
- [ ] `renameConversationAction` refuses a blank title and one of 81 code points with `{ ok: false, code: 'invalid_input', fieldErrors: { title: [...] } }`, takes 80 emoji (160 code units), and stores the trimmed title.
- [ ] Both actions answer `not_found` for an app that is missing, disabled or of a provider without `hubHistory`, and when the DAL finds no such conversation of the actor's; nothing is written then.
- [ ] `deleteConversationAction` calls `activeRuns.stop(activeRunId, conversationId, 'stop')` before `softDeleteConversation` when the conversation has an active run, and answers `{ ok: true, data: undefined }`.
- [ ] A DAL failure answers `{ ok: false, code: 'operation_failed' }` and logs `'<action name>:'`.
- [ ] `startPurgeSchedule()` creates one croner job `'0 3 * * *'` with `mode: '5-part'`, `protect: true`, `unref: true` and a `catch` function, once per process; the job calls `purgeDeletedConversations()` with no argument and logs `'conversationPurge:', { purged }`; croner's real parser runs the pattern next at `2026-10-15T03:00:00.000Z` from `2026-10-14T12:00:00Z` in UTC.
- [ ] `register()` starts the directory schedule and the purge in the Node runtime only; one failing does not keep the other from starting; each failure is logged as `'instrumentation: <the job> did not start:'`.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run --project unit __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts` → tsc prints nothing; Vitest reports all passed, 0 failed.

**Steps:**

- [ ] **Step 1: Read the sources this task leans on**

Next: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (the revalidation paragraph quoted above; "Security": "Treat every action as an untrusted entry point … Authenticate and authorize … Validate inputs … Constrain return values") and `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`. croner 10.0.1: `node_modules/croner/README.md` (options `protect`: "Will block new triggers as long as an old trigger is in progress", `unref`: "allows the process to exit even if a cron job is running", `catch`) and `node_modules/croner/dist/croner.d.ts` (`mode?: CronMode`, `'5-part'`). The repo's patterns: `app/(admin)/group-management/actions.ts`, `lib/action-failure.ts`, `lib/directory/schedule.ts`, `__tests__/directory-schedule.test.ts`, `__tests__/group-management-actions.test.ts`.

- [ ] **Step 2: Write the failing tests**

Create `__tests__/chat-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	getAppAccess: vi.fn(),
	findConversation: vi.fn(),
	renameConversation: vi.fn(),
	softDeleteConversation: vi.fn(),
	stop: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ getAppAccess: m.getAppAccess }))
vi.mock('@/lib/data/conversations', () => ({
	findConversation: m.findConversation,
	renameConversation: m.renameConversation,
	softDeleteConversation: m.softDeleteConversation,
}))
vi.mock('@/lib/providers/registry', () => ({
	PROVIDERS: { dify: { hubHistory: false }, agui: { hubHistory: true } },
}))
vi.mock('@/lib/chat/active-runs', () => ({ activeRuns: { stop: m.stop } }))

import { deleteConversationAction, renameConversationAction } from '@/app/(user)/chat/actions'

const APP_ID = '0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b'
const CONVERSATION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const RUN_ID = '9c8dae0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
const user = { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'user', source: 'local' }
const actor = { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'user', source: 'local' }
const app = { id: APP_ID, enabled: true, provider: 'agui', settings: {}, secrets: {} }
const conversation = {
	id: CONVERSATION_ID,
	appId: APP_ID,
	title: 'Tea',
	state: {},
	activeRunId: null,
}

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset()
	m.getServerSession.mockResolvedValue({ user })
	m.getAppAccess.mockResolvedValue(app)
	m.findConversation.mockResolvedValue(conversation)
	m.renameConversation.mockResolvedValue(true)
	m.softDeleteConversation.mockResolvedValue(true)
})

describe('renameConversationAction (spec §4.2)', () => {
	it('stores the trimmed title and answers ok', async () => {
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, '  Tea time  ')).toEqual({
			ok: true,
			data: undefined,
		})
		expect(m.getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
		expect(m.renameConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID, 'Tea time')
	})

	// TITLE_MAX_LENGTH counts code points (spec §3.1), not zod's UTF-16 code units.
	it('takes 80 code points, emoji included, and refuses a blank title and 81 code points', async () => {
		expect((await renameConversationAction(APP_ID, CONVERSATION_ID, '😀'.repeat(80))).ok).toBe(true)
		for (const title of ['   ', 'x'.repeat(81), '😀'.repeat(81), 42])
			expect(await renameConversationAction(APP_ID, CONVERSATION_ID, title)).toMatchObject({
				ok: false,
				code: 'invalid_input',
				fieldErrors: { title: expect.any(Array) },
			})
		expect(m.renameConversation).toHaveBeenCalledTimes(1)
	})

	it('answers unauthorized signed out, and not_found for malformed ids, reading nothing', async () => {
		m.getServerSession.mockResolvedValue(null)
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, 'Tea')).toEqual({
			ok: false,
			code: 'unauthorized',
		})
		m.getServerSession.mockResolvedValue({ user })
		for (const [appId, conversationId] of [
			['nope', CONVERSATION_ID],
			[APP_ID, 'nope'],
		])
			expect(await renameConversationAction(appId, conversationId, 'Tea')).toEqual({
				ok: false,
				code: 'not_found',
			})
		expect(m.getAppAccess).not.toHaveBeenCalled()
	})

	it.each([
		['a missing app', null],
		['a disabled app', { ...app, enabled: false }],
		['an app whose conversations the hub does not keep', { ...app, provider: 'dify' }],
	])('answers not_found for %s, writing nothing', async (_case, found) => {
		m.getAppAccess.mockResolvedValue(found)
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, 'Tea')).toEqual({
			ok: false,
			code: 'not_found',
		})
		expect(m.renameConversation).not.toHaveBeenCalled()
	})

	it('answers not_found when the DAL finds no such conversation of the actor’s', async () => {
		m.renameConversation.mockResolvedValue(false)
		expect(await renameConversationAction(APP_ID, CONVERSATION_ID, 'Tea')).toEqual({
			ok: false,
			code: 'not_found',
		})
	})
})

describe('deleteConversationAction (spec §3.4, §4.2)', () => {
	it('soft-deletes the conversation and answers ok', async () => {
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: true,
			data: undefined,
		})
		expect(m.findConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(m.softDeleteConversation).toHaveBeenCalledWith(actor, APP_ID, CONVERSATION_ID)
		expect(m.stop).not.toHaveBeenCalled()
	})

	// softDeleteConversation leaves a run alone (Task 7): the stop route's path stops it first (spec §4.5).
	it('stops an active run before it deletes the conversation', async () => {
		m.findConversation.mockResolvedValue({ ...conversation, activeRunId: RUN_ID })
		expect((await deleteConversationAction(APP_ID, CONVERSATION_ID)).ok).toBe(true)
		expect(m.stop).toHaveBeenCalledWith(RUN_ID, CONVERSATION_ID, 'stop')
		expect(m.stop.mock.invocationCallOrder[0]).toBeLessThan(
			m.softDeleteConversation.mock.invocationCallOrder[0],
		)
	})

	it('answers not_found for a conversation that is not the actor’s, or that the write misses', async () => {
		m.findConversation.mockResolvedValue(null)
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'not_found',
		})
		expect(m.softDeleteConversation).not.toHaveBeenCalled()
		m.findConversation.mockResolvedValue(conversation)
		m.softDeleteConversation.mockResolvedValue(false)
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'not_found',
		})
	})

	it('answers not_found for a disabled app and malformed ids, and unauthorized signed out', async () => {
		m.getAppAccess.mockResolvedValue({ ...app, enabled: false })
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'not_found',
		})
		expect(await deleteConversationAction(APP_ID, 'nope')).toEqual({ ok: false, code: 'not_found' })
		m.getServerSession.mockResolvedValue(null)
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'unauthorized',
		})
		expect(m.softDeleteConversation).not.toHaveBeenCalled()
	})

	it('answers operation_failed and logs the action when the DAL fails', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		m.softDeleteConversation.mockRejectedValue(new Error('db down'))
		expect(await deleteConversationAction(APP_ID, CONVERSATION_ID)).toEqual({
			ok: false,
			code: 'operation_failed',
		})
		expect(errorSpy).toHaveBeenCalledWith('deleteConversationAction:', expect.any(Error))
		errorSpy.mockRestore()
	})
})
```

Create `__tests__/chat-purge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const jobs: {
		pattern: string
		options: Record<string, unknown>
		run: (...args: unknown[]) => unknown
	}[] = []
	class Cron {
		constructor(
			pattern: string,
			options: Record<string, unknown>,
			run: (...args: unknown[]) => unknown,
		) {
			jobs.push({ pattern, options, run })
		}
		stop() {}
	}
	return { jobs, Cron, purgeDeletedConversations: vi.fn() }
})
vi.mock('croner', () => ({ Cron: mocks.Cron }))
vi.mock('@/lib/data/conversations', () => ({
	purgeDeletedConversations: mocks.purgeDeletedConversations,
}))

import { PURGE_SCHEDULE, startPurgeSchedule } from '@/lib/chat/purge'

const reset = () => {
	delete (globalThis as { aiAppHubConversationPurge?: unknown }).aiAppHubConversationPurge
}

beforeEach(() => {
	reset()
	mocks.jobs.length = 0
	mocks.purgeDeletedConversations.mockReset()
})
afterEach(reset)

describe('startPurgeSchedule (spec §3.4; plan call P13)', () => {
	it('starts one protected, unref’d five-field job at 03:00, once per process', () => {
		startPurgeSchedule()
		startPurgeSchedule()
		expect(mocks.jobs).toHaveLength(1)
		expect(mocks.jobs[0].pattern).toBe('0 3 * * *')
		expect(mocks.jobs[0].options).toMatchObject({ mode: '5-part', protect: true, unref: true })
		expect(mocks.jobs[0].options.catch).toEqual(expect.any(Function))
	})

	// croner calls the job with itself and its context: the purge must not read them as its clock.
	it('purges with the current time and logs the count', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		mocks.purgeDeletedConversations.mockResolvedValue(3)
		startPurgeSchedule()
		await mocks.jobs[0].run({ croner: 'job' }, 'context')
		expect(mocks.purgeDeletedConversations).toHaveBeenCalledWith()
		expect(info).toHaveBeenCalledWith('conversationPurge:', { purged: 3 })
		info.mockRestore()
	})

	it('routes a failing run through the catch option to the log', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		startPurgeSchedule()
		const boom = new Error('db down')
		;(mocks.jobs[0].options.catch as (e: unknown) => void)(boom)
		expect(error).toHaveBeenCalledWith('conversationPurge:', boom)
		error.mockRestore()
	})

	it('is a pattern croner runs daily at 03:00', async () => {
		const { Cron } = await vi.importActual<typeof import('croner')>('croner')
		const job = new Cron(PURGE_SCHEDULE, { mode: '5-part', timezone: 'UTC' })
		expect(job.nextRun(new Date('2026-10-14T12:00:00Z'))?.toISOString()).toBe(
			'2026-10-15T03:00:00.000Z',
		)
		job.stop()
	})
})
```

Replace the whole of `__tests__/instrumentation.test.ts` with:

```ts
import { DatabaseError } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { startDirectorySchedule, startPurgeSchedule } = vi.hoisted(() => ({
	startDirectorySchedule: vi.fn(),
	startPurgeSchedule: vi.fn(),
}))
vi.mock('@/lib/directory/schedule', () => ({ startDirectorySchedule }))
vi.mock('@/lib/chat/purge', () => ({ startPurgeSchedule }))

import { register } from '@/instrumentation'

afterEach(() => {
	vi.unstubAllEnvs()
	startDirectorySchedule.mockReset()
	startPurgeSchedule.mockReset()
})

describe('register (Next instrumentation)', () => {
	it('starts the directory schedule and the conversation purge in the Node runtime only', async () => {
		vi.stubEnv('NEXT_RUNTIME', 'edge')
		await register()
		expect(startDirectorySchedule).not.toHaveBeenCalled()
		expect(startPurgeSchedule).not.toHaveBeenCalled()
		vi.stubEnv('NEXT_RUNTIME', 'nodejs')
		await register()
		expect(startDirectorySchedule).toHaveBeenCalledTimes(1)
		expect(startPurgeSchedule).toHaveBeenCalledTimes(1)
	})

	it('never throws, so a failure cannot stop the server from starting (decision ai)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			startDirectorySchedule.mockImplementation(() => {
				throw new Error('boom')
			})
			await expect(register()).resolves.toBeUndefined()
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
	})

	// Part 2 spec §3.4: the purge is a job of its own; a failing directory schedule does not keep it from starting.
	it('starts each job on its own and logs a failure under the job’s name', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			const bug = new Error('directory')
			startDirectorySchedule.mockImplementationOnce(() => {
				throw bug
			})
			await register()
			expect(startPurgeSchedule).toHaveBeenCalledTimes(1)
			expect(error).toHaveBeenCalledWith(
				'instrumentation: the directory schedule did not start:',
				bug,
			)
			const purgeBug = new Error('purge')
			startPurgeSchedule.mockImplementationOnce(() => {
				throw purgeBug
			})
			await register()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the conversation purge did not start:',
				purgeBug,
			)
		} finally {
			error.mockRestore()
		}
	})

	// Final review M9: the throw is logged through describeError (lib/error-log.ts), so a hub error keeps its message
	// and a database error is reduced to its name and SQLSTATE, not to its name alone.
	it('logs the throw through describeError, not by its name only', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			const bug = new TypeError("Cannot read properties of undefined (reading 'syncSchedule')")
			startDirectorySchedule.mockImplementationOnce(() => {
				throw bug
			})
			await register()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the directory schedule did not start:',
				bug,
			)
			startDirectorySchedule.mockImplementationOnce(() => {
				throw Object.assign(
					new DatabaseError('duplicate key value violates unique constraint "x"', 0, 'error'),
					{ code: '23505', detail: 'Key (slot)=(secret) already exists.' },
				)
			})
			await register()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the directory schedule did not start:',
				{
					name: 'error',
					code: '23505',
				},
			)
		} finally {
			error.mockRestore()
		}
	})

	it('falls back to the name when the log module cannot load either, and still never throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.resetModules()
		vi.doMock('@/lib/error-log', () => {
			throw new Error('cannot load')
		})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			startDirectorySchedule.mockImplementationOnce(() => {
				throw new RangeError('bad')
			})
			const { register: fresh } = await import('@/instrumentation')
			await expect(fresh()).resolves.toBeUndefined()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the directory schedule did not start:',
				'RangeError',
			)
		} finally {
			vi.doUnmock('@/lib/error-log')
			vi.resetModules()
			error.mockRestore()
		}
	})
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts` Expected: FAIL: `chat-actions` cannot resolve `@/app/(user)/chat/actions`, `chat-purge` cannot resolve `@/lib/chat/purge`; in `instrumentation`, "starts the directory schedule and the conversation purge in the Node runtime only" and "starts each job on its own" fail (`startPurgeSchedule` called 0 times).

- [ ] **Step 4: Write the actions**

Create `app/(user)/chat/actions.ts`:

```ts
'use server'

import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireActor, type SessionUser } from '@/lib/auth/session'
import { activeRuns } from '@/lib/chat/active-runs'
import { TITLE_MAX_LENGTH } from '@/lib/chat/statuses'
import { getAppAccess } from '@/lib/data/apps'
import {
	findConversation,
	renameConversation,
	softDeleteConversation,
} from '@/lib/data/conversations'
import { isId } from '@/lib/ids'
import { PROVIDERS } from '@/lib/providers/registry'

/*
 * The shared chat's writes to the hub's own data (Part 2 spec §4.2: rename and delete are Server Actions returning
 * ActionResult, ADR-0024). Thin, as every action of the hub (Next "Server Actions", Security: authenticate and authorize,
 * validate inputs, constrain return values): verify the account, check the input, call the DAL, answer a plain result.
 * No refresh(): the conversation list is the chat's client state, which updates itself from the result, and the page's
 * server render holds none of it (the same guide: "An action that does none of the above carries only its return value,
 * and the current route is not re-rendered").
 */

/**
 * A title is 1–TITLE_MAX_LENGTH code points after trimming (spec §3.1's bound). zod's `.max()` counts UTF-16 code units
 * (MDN "String: length"), so the code points are counted with `Array.from()`, after `.max()` has bounded the input (a
 * code point is at most two code units). zod 4 runs `.trim()` before the checks that follow it.
 */
const renameSchema = z.object({
	title: z
		.string()
		.trim()
		.max(TITLE_MAX_LENGTH * 2)
		.refine(title => {
			const length = Array.from(title).length
			return length >= 1 && length <= TITLE_MAX_LENGTH
		}),
})

/**
 * The app must be one the actor may use (getAppAccess applies visibleTo), enabled, and of a provider whose conversations
 * the hub keeps (spec §4.1 `hubHistory`); anything else answers not_found, as a missing one does (B3 spec §4.2).
 */
const usableApp = async (actor: SessionUser, appId: string): Promise<boolean> => {
	const app = await getAppAccess(actor, appId)
	return Boolean(app?.enabled && PROVIDERS[app.provider].hubHistory)
}

export async function renameConversationAction(
	appId: string,
	conversationId: string,
	title: unknown,
): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		if (!isId(appId) || !isId(conversationId)) return fail('not_found')
		const parsed = renameSchema.safeParse({ title })
		if (!parsed.success) return invalidInput(parsed.error)
		if (!(await usableApp(actor, appId))) return fail('not_found')
		return (await renameConversation(actor, appId, conversationId, parsed.data.title))
			? ok(undefined)
			: fail('not_found')
	} catch (error) {
		return toActionFailure(error, 'renameConversationAction')
	}
}

/**
 * The user's delete (spec §3.4): the conversation leaves their list at once (soft delete, decision 49) and the daily
 * purge removes it after 30 days. A run still going is stopped first, by the stop route's path (spec §4.5): the soft
 * delete leaves runs alone, and its session then stores the run cancelled.
 */
export async function deleteConversationAction(
	appId: string,
	conversationId: string,
): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		if (!isId(appId) || !isId(conversationId)) return fail('not_found')
		if (!(await usableApp(actor, appId))) return fail('not_found')
		const conversation = await findConversation(actor, appId, conversationId)
		if (!conversation) return fail('not_found')
		if (conversation.activeRunId) activeRuns.stop(conversation.activeRunId, conversationId, 'stop')
		return (await softDeleteConversation(actor, appId, conversationId))
			? ok(undefined)
			: fail('not_found')
	} catch (error) {
		return toActionFailure(error, 'deleteConversationAction')
	}
}
```

- [ ] **Step 5: Write the purge job**

Create `lib/chat/purge.ts`:

```ts
import 'server-only'

import { Cron } from 'croner'

import { purgeDeletedConversations } from '@/lib/data/conversations'
import { logActionError } from '@/lib/error-log'

/*
 * The daily purge of deleted conversations (Part 2 spec §3.4; plan call P13), registered beside the directory sync in
 * instrumentation.ts the way lib/directory/schedule.ts registers it: one croner job per process, kept on globalThis so a
 * development reload does not start a second one (Rallly's guard, cited there).
 */

/** Every day at 03:00 in the server's zone (croner reads a five-field pattern in `mode: '5-part'`, croner.d.ts). */
export const PURGE_SCHEDULE = '0 3 * * *'

const globalForPurge = globalThis as unknown as { aiAppHubConversationPurge?: Cron }

/** One run: conversations deleted more than PURGE_AFTER_DAYS ago go, with their runs and messages (cascade); the count is logged. */
const runPurge = async (): Promise<void> => {
	const purged = await purgeDeletedConversations()
	console.info('conversationPurge:', { purged })
}

/**
 * Starts the job once per process. croner's README, Options: `protect` "Will block new triggers as long as an old trigger
 * is in progress", `unref` "allows the process to exit even if a cron job is running", and `catch` receives a run's
 * error, logged here by logActionError (decision g of B3b: a database error by its name and code). croner calls the job
 * with itself and its context, so the purge is wrapped and takes no argument from it.
 */
export function startPurgeSchedule(): void {
	if (globalForPurge.aiAppHubConversationPurge) return
	globalForPurge.aiAppHubConversationPurge = new Cron(
		PURGE_SCHEDULE,
		{
			mode: '5-part',
			protect: true,
			unref: true,
			catch: (error: unknown) => logActionError(error, 'conversationPurge'),
		},
		() => runPurge(),
	)
}
```

- [ ] **Step 6: Register it in instrumentation**

Replace the whole of `instrumentation.ts` with:

```ts
/**
 * Next calls register() once when a server instance starts, in every runtime ("Next.js calls `register` in all
 * environments, so it's important to conditionally import any code that doesn't support specific runtimes",
 * node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). The directory schedule (ADR-0029) and the
 * conversation purge (Part 2 spec §3.4) run in the Node runtime only; NEXT_RUNTIME is Next's own variable, read here as
 * the guide shows, beside lib/env.ts. Decision ai: nothing escapes, since a failing register() stops the server from
 * starting; each job starts on its own, so one that fails leaves the other running.
 */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return
	await startJob('the directory schedule', async () => {
		const { startDirectorySchedule } = await import('./lib/directory/schedule')
		startDirectorySchedule()
	})
	await startJob('the conversation purge', async () => {
		const { startPurgeSchedule } = await import('./lib/chat/purge')
		startPurgeSchedule()
	})
}

/** Starts one job; a throw is logged under the job's name and never escapes. */
const startJob = async (name: string, start: () => Promise<void>): Promise<void> => {
	try {
		await start()
	} catch (error) {
		// Final review M9: logged through describeError (decision g), so the cause stays readable without a secret.
		// lib/error-log.ts imports ldapts, Node-only like the jobs, so it is imported here as well; if it cannot load
		// either, the error's name is logged, and still nothing escapes.
		const described = await import('./lib/error-log').then(
			({ describeError }) => describeError(error),
			() => (error instanceof Error ? error.name : 'unknown error'),
		)
		console.error(`instrumentation: ${name} did not start:`, described)
	}
}
```

- [ ] **Step 7: Run the tests to see them pass, then the gates**

Run: `pnpm exec vitest run --project unit __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts` Expected: PASS, 3 files, 0 failed.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint 'app/(user)/chat/actions.ts' lib/chat/purge.ts instrumentation.ts __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts` Expected: `Found 0 warnings and 0 errors.`

Run: `pnpm exec oxfmt --write <the same files>` then `pnpm exec oxfmt --check <the same files>` Expected: the check reports no file to format.

Run: `pnpm test` Expected: every unit file passes, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add 'app/(user)/chat/actions.ts' lib/chat/purge.ts instrumentation.ts \
  __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts
git commit -m "feat(chat): rename and delete conversations, and purge deleted ones daily

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["app/(user)/chat/actions.ts", "lib/chat/purge.ts", "instrumentation.ts", "__tests__/chat-actions.test.ts", "__tests__/chat-purge.test.ts", "__tests__/instrumentation.test.ts"], "verifyCommand": "pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run --project unit __tests__/chat-actions.test.ts __tests__/chat-purge.test.ts __tests__/instrumentation.test.ts", "acceptanceCriteria": ["The three test files pass with 0 failed", "Signed out both actions answer unauthorized; malformed app or conversation ids answer not_found with no read", "renameConversationAction refuses a blank title and 81 code points with invalid_input and fieldErrors.title, takes 80 emoji, and stores the trimmed title", "Both actions answer not_found for a missing, disabled or non-hubHistory app and when the DAL finds no conversation of the actor's, writing nothing", "deleteConversationAction calls activeRuns.stop(activeRunId, conversationId, 'stop') before softDeleteConversation and answers { ok: true, data: undefined }", "A DAL failure answers operation_failed and logs '<action name>:'", "startPurgeSchedule creates one croner job '0 3 * * *' with mode '5-part', protect, unref and a catch function, once per process; the job calls purgeDeletedConversations() with no argument and logs 'conversationPurge:', { purged }; the real parser runs it next at 2026-10-15T03:00:00.000Z from 2026-10-14T12:00:00Z in UTC", "register() starts the directory schedule and the purge in the Node runtime only; one failing does not keep the other from starting; each failure is logged as 'instrumentation: <the job> did not start:'"], "modelTier": "mechanical"}
```

---

### Task 13: The e2e AG-UI stub agent

**Goal:** The e2e stub server gains a spec-level AG-UI 1.0 producer under `/agui/agents/<name>` that verifies the hub's JWT as the owner's service does, serves 2a's scenarios by the last user text, and the e2e seed adds two AG-UI apps that point at it (spec §10 e2e, plan call P14; the spike's Appendix B is its starting point).

Depends on Task 1 (the packages), Task 4 (`'agui'` in `apps_provider_check`, which the seed needs) and Task 5 (the `conversations` table, which the seed clears).

**Files:**

- Create: `e2e/fixtures/stub/agui.ts` (the producer), `e2e/fixtures/stub/agui-apps.ts` (the seeded apps, pure constants), `__tests__/stub-agui.test.ts`
- Modify: `e2e/fixtures/stub/router.ts` (one import, one dispatch line after the `OPTIONS` block), `e2e/fixtures/stub/server.ts` (the start-up log line), `e2e/fixtures/constants.ts` (re-exports), `e2e/auth.setup.ts` (the AG-UI seed), `.env.e2e` (`E2E_AGUI_JWT_SECRET`)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` reports 7 passed.
- [ ] A request without a token, with a token signed by another secret, an expired token (beyond 10 s of tolerance), another audience, or no `auth_source` answers 401 before the agent name is looked at; a valid token on `/agui/agents/missing` answers 404; a `text/plain` body answers 415; `{}` (Test connection's body) and a valid input whose last user text contains `invalid` answer 422; none of them streams.
- [ ] The default scenario answers 200 `text/event-stream` with the event types `RUN_STARTED`, `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_END`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`…, `TEXT_MESSAGE_END`, `RUN_FINISHED`; `RUN_STARTED` carries the input's `threadId` and `runId` and `protocolVersion: '1.0'`; every event has a numeric `timestamp`.
- [ ] `@ag-ui/client`'s `HttpAgent.runAgent()` reads the default, `tool`, `error usage_limit` and `timeout` scenarios without a protocol error: `newMessages` roles `['reasoning', 'assistant']` and `['assistant', 'tool', 'assistant']`; a `RUN_ERROR` with code `usage_limit`; a `CUSTOM run_cancelled { reason: 'run_timeout' }`.
- [ ] After the client cancels a `slow` stream, `GET /agui/_slow` answers `{ closedEarly: true, words: n }` with `n` below 200; `GET /agui/_caller` answers the last verified run's `{ sub, auth_source, roles }`.
- [ ] `pnpm test:e2e e2e/apps.spec.ts --project desktop-light` passes (its `setup` dependency seeds the two AG-UI apps with provider `agui`).

**Verify:** `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` → 7 passed; `pnpm test:e2e e2e/apps.spec.ts --project desktop-light` → 0 failed

**Steps:**

- [ ] **Step 1: Read the stub as it is and check the APIs**

Read `e2e/fixtures/stub/router.ts` (its `handle`, the `CORS_HEADERS` loop and the `OPTIONS` block at lines 248–256 of `faebc118`), `e2e/fixtures/stub/server.ts`, `e2e/fixtures/env.ts`, `e2e/auth.setup.ts` and `__tests__/stub-router.test.ts` (the ephemeral-port harness this task's test copies). Check, with the typings in `node_modules` and their docs:

- `jose` `jwtVerify(jwt, key, { algorithms, issuer, audience, clockTolerance, requiredClaims })`: the documented symmetric-secret example encodes the secret with `TextEncoder` (panva/jose `docs/jwt/verify/functions/jwtVerify.md`, "Usage with a symmetric secret"); `clockTolerance` is "seconds or a duration string" applied to `exp`, and `requiredClaims` names "additional claim names required" (`JWTClaimVerificationOptions`); `issuer` and `audience` each require their claim.
- `@ag-ui/encoder` `EventEncoder`: `encodeSSE(event)` writes `data: <json>\n\n`, and `getContentType()` answers `text/event-stream` for an encoder built without an `accept` that prefers protobuf (`dist/index.d.ts`; `part2-proxy-stop-identity.md` §1.6).
- `@ag-ui/core/schemas` `RunAgentInputSchema`: `threadId`, `runId` and `messages` required, `tools`/`context` defaulted (`dist/schemas.mjs`). It imports `zod/v4`, which the hub's zod 4 provides; it is the protocol's own validator, so the stub refuses exactly what the 1.0 spec calls "a structurally invalid `RunAgentInput` … refused before `RUN_STARTED`, outside the stream" (transports page).
- The 1.0 event fields used below (`dist/version-*.d.ts`): `RUN_STARTED { threadId, runId, protocolVersion? }`, `TEXT_MESSAGE_START { messageId, role? }`, `TEXT_MESSAGE_CONTENT { messageId, delta }`, `REASONING_MESSAGE_START { messageId, role: 'reasoning' }`, `TOOL_CALL_START { toolCallId, toolCallName, parentMessageId? }`, `TOOL_CALL_RESULT { messageId, toolCallId, content, role?: 'tool' }`, `RUN_ERROR { message, code? }`, `CUSTOM { name, value }`, `RUN_FINISHED { threadId, runId, outcome? }` ("Absent means success").

- [ ] **Step 2: Write the failing test**

Create `__tests__/stub-agui.test.ts`:

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { HttpAgent, type Message } from '@ag-ui/client'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { e2eEnv } from '@/e2e/fixtures/env'
import { handle } from '@/e2e/fixtures/stub/router'

let server: Server
let base: string

// The same ephemeral-port harness as __tests__/stub-router.test.ts.
beforeAll(async () => {
	server = createServer((req, res) => {
		handle(req, res, (server.address() as AddressInfo).port).catch(() => res.end())
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

/** A token as the hub mints it (Part 2 spec §2.3), with one claim or option changed per case. */
const token = async (
	over: {
		secret?: string
		audience?: string
		expiresAt?: number
		claims?: Record<string, unknown>
	} = {},
) => {
	const now = Math.floor(Date.now() / 1000)
	return new SignJWT({ auth_source: 'local', roles: ['owner'], ...over.claims })
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject('e2e00000-0000-4000-8000-00000000beef')
		.setIssuer('nextjs-bff')
		.setAudience(over.audience ?? 'assistant')
		.setIssuedAt(now)
		.setExpirationTime(over.expiresAt ?? now + 60)
		.sign(new TextEncoder().encode(over.secret ?? e2eEnv.E2E_AGUI_JWT_SECRET))
}

const input = (text: string) => ({
	threadId: 'thread-1',
	runId: 'run-1',
	state: {},
	messages: [{ id: 'user-1', role: 'user', content: text }],
	tools: [],
	context: [],
	forwardedProps: {},
})

const post = (
	path: string,
	{ auth, body, contentType }: { auth?: string; body?: unknown; contentType?: string } = {},
) =>
	fetch(`${base}${path}`, {
		method: 'POST',
		headers: {
			'content-type': contentType ?? 'application/json',
			accept: 'text/event-stream',
			...(auth ? { authorization: `Bearer ${auth}` } : {}),
		},
		body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
	})

type Frame = { type: string; [key: string]: unknown }
const framesOf = async (response: Response): Promise<Frame[]> =>
	(await response.text())
		.split('\n\n')
		.filter(frame => frame.startsWith('data: '))
		.map(frame => JSON.parse(frame.slice(6)) as Frame)
/** The event types with repeats folded, so a streamed text reads as one CONTENT. */
const typesOf = (frames: Frame[]) =>
	frames.map(frame => frame.type).filter((type, index, all) => type !== all[index - 1])

const AGENT = '/agui/agents/assistant'

describe('the AG-UI stub agent (Part 2 spec §10)', () => {
	it('refuses a request without a valid token with 401, before anything else', async () => {
		const now = Math.floor(Date.now() / 1000)
		const refused = [
			undefined,
			await token({ secret: 'another-secret-another-secret-0000000000' }),
			await token({ expiresAt: now - 60 }),
			await token({ audience: 'someone-else' }),
			await token({ claims: { auth_source: undefined } }),
		]
		for (const auth of refused) {
			const response = await post(AGENT, { auth, body: input('hello') })
			expect(response.status).toBe(401)
			expect(response.headers.get('content-type')).toBe('application/json')
		}
		// The token first: an unknown agent without one is a 401 too.
		expect((await post('/agui/agents/missing', { body: input('hello') })).status).toBe(401)
	})

	it('answers 404 for an unknown agent and 415 for a body that is not JSON', async () => {
		const auth = await token()
		expect((await post('/agui/agents/missing', { auth, body: input('hello') })).status).toBe(404)
		expect((await post(AGENT, { auth, body: 'hello', contentType: 'text/plain' })).status).toBe(415)
	})

	it('answers 422 for Test connection’s {} and for the invalid scenario, before any stream', async () => {
		const auth = await token()
		const empty = await post(AGENT, { auth, body: {} })
		expect(empty.status).toBe(422)
		expect(empty.headers.get('content-type')).toBe('application/json')
		expect((await post(AGENT, { auth, body: input('please answer invalid') })).status).toBe(422)
	})

	it('streams the default scenario as a 1.0 run and records the caller', async () => {
		const response = await post(AGENT, { auth: await token(), body: input('hello') })
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		const frames = await framesOf(response)
		expect(typesOf(frames)).toEqual([
			'RUN_STARTED',
			'REASONING_START',
			'REASONING_MESSAGE_START',
			'REASONING_MESSAGE_CONTENT',
			'REASONING_MESSAGE_END',
			'REASONING_END',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'RUN_FINISHED',
		])
		expect(frames[0]).toMatchObject({
			threadId: 'thread-1',
			runId: 'run-1',
			protocolVersion: '1.0',
		})
		expect(frames.every(frame => typeof frame.timestamp === 'number')).toBe(true)
		const caller = await (await fetch(`${base}/agui/_caller`)).json()
		expect(caller).toEqual({
			sub: 'e2e00000-0000-4000-8000-00000000beef',
			auth_source: 'local',
			roles: ['owner'],
		})
	})

	it('is read by @ag-ui/client without a protocol error, scenario by scenario', async () => {
		const auth = await token()
		const runText = async (text: string) => {
			const seen: { errorCode?: string; custom?: { name: string; value: unknown } } = {}
			const agent = new HttpAgent({
				url: `${base}${AGENT}`,
				headers: { Authorization: `Bearer ${auth}` },
				threadId: `thread-${text}`,
				initialMessages: [{ id: `user-${text}`, role: 'user', content: text }],
			})
			const { newMessages } = await agent.runAgent(
				{ runId: `run-${text}` },
				{
					onRunErrorEvent: ({ event }) => {
						seen.errorCode = event.code
					},
					onCustomEvent: ({ event }) => {
						seen.custom = { name: event.name, value: event.value }
					},
				},
			)
			return { roles: newMessages.map((message: Message) => message.role), newMessages, seen }
		}
		expect((await runText('hello')).roles).toEqual(['reasoning', 'assistant'])
		const tool = await runText('use a tool')
		expect(tool.roles).toEqual(['assistant', 'tool', 'assistant'])
		const caller = tool.newMessages[0] as Extract<Message, { role: 'assistant' }>
		expect(caller.toolCalls?.[0]?.function.name).toBe('get_weather')
		expect((await runText('error usage_limit')).seen.errorCode).toBe('usage_limit')
		expect((await runText('timeout')).seen.custom).toEqual({
			name: 'run_cancelled',
			value: { reason: 'run_timeout' },
		})
	})

	it('records that a slow stream was closed early', async () => {
		const response = await post(AGENT, { auth: await token(), body: input('slow') })
		const reader = response.body!.getReader()
		const decoder = new TextDecoder()
		let read = ''
		while ((read.match(/TEXT_MESSAGE_CONTENT/g) ?? []).length < 3) {
			const chunk = await reader.read()
			if (chunk.done) break
			read += decoder.decode(chunk.value, { stream: true })
		}
		await reader.cancel()
		// The server sees the socket close on its next tick; one word interval is enough.
		await new Promise(resolve => setTimeout(resolve, 300))
		const slow = await (await fetch(`${base}/agui/_slow`)).json()
		expect(slow.closedEarly).toBe(true)
		expect(slow.words).toBeGreaterThanOrEqual(3)
		expect(slow.words).toBeLessThan(200)
	})

	it('leaves the Dify routes as they were', async () => {
		expect((await fetch(`${base}/v1/parameters`)).status).toBe(200)
	})
})
```

- [ ] **Step 3: Run the test and see it fail**

Run: `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` Expected: FAIL. The `/agui/...` requests reach the Dify router's last line and answer `404 not_found`, so the first five cases fail on their statuses (e.g. `expected 404 to be 401`); the last case passes.

- [ ] **Step 4: Add the secret to `.env.e2e`**

After the line `E2E_DIFY_STUB_PORT=5399`, add:

```bash
# The HS256 secret the stub AG-UI agents check (Part 2 spec §2.3, §10): seeded as the AG-UI apps' jwtSecret by
# e2e/auth.setup.ts and verified by e2e/fixtures/stub/agui.ts. Test-only; at least 32 characters (the schema's minimum).
E2E_AGUI_JWT_SECRET=e2e-agui-jwt-secret-not-a-secret-0123456789
```

- [ ] **Step 5: The seeded apps' constants**

Create `e2e/fixtures/stub/agui-apps.ts`:

```ts
/**
 * The AG-UI apps the e2e seed adds (Part 2 spec §10; plan call P14): one whose agent answers, and one whose agent the
 * stub does not know (404 before any stream: agent_not_found). Pure constants, so the specs import them without the
 * stub's server code.
 */
export interface StubAguiApp {
	id: string
	name: string
	/** The last path segment of the agent URL, as the owner's service names agents (`<base>/agents/<name>`). */
	agent: string
}

export const AGUI_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a1',
	name: 'Stub AG-UI agent',
	agent: 'assistant',
}

export const AGUI_MISSING_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a2',
	name: 'Stub AG-UI missing',
	agent: 'missing',
}

export const STUB_AGUI_APPS: StubAguiApp[] = [AGUI_APP, AGUI_MISSING_APP]

/** The one agent the stub serves; any other name answers 404. */
export const STUB_AGUI_AGENT = 'assistant'

/** The JWT audience the stub checks (the owner's AGENT_JWT_AUDIENCE) and the seeded apps' `audience`. */
export const STUB_AGUI_AUDIENCE = 'assistant'

/** An agent's URL on the stub server. */
export const aguiAgentUrl = (port: number, agent: string) =>
	`http://127.0.0.1:${port}/agui/agents/${agent}`
```

- [ ] **Step 6: The producer**

Create `e2e/fixtures/stub/agui.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { EventType, type Event } from '@ag-ui/core'
import { RunAgentInputSchema } from '@ag-ui/core/schemas'
import { EventEncoder } from '@ag-ui/encoder'
import { jwtVerify } from 'jose'
import type * as z from 'zod'

import { e2eEnv } from '../env'
import { STUB_AGUI_AGENT, STUB_AGUI_AUDIENCE } from './agui-apps'

/*
 * A spec-level AG-UI 1.0 producer for the e2e suite (Part 2 spec §10: "the second producer decision 7 asks for"; the
 * spike's Appendix B grown up). It checks the hub's JWT as the owner's agent service does (spec §2.3; decision 45) and
 * refuses a bad request with a plain HTTP status before any stream ("Input rejected before the run starts — malformed
 * JSON, failed validation, refused auth — is an HTTP error status with no event stream", AG-UI 1.0 HTTP + SSE binding,
 * Errors). Scenarios are picked by the last user text, as the Dify stub's are: the default (reasoning and Markdown
 * text), `tool`, `error <code>`, `timeout`, `slow` and `invalid`.
 */

/** lib/env.ts's AGENT_JWT_ISSUER default: the e2e `next dev` sets none, so the hub signs with it. */
const ISSUER = 'nextjs-bff'
/** The owner's service allows 10 s of clock skew (spec §2.3). */
const CLOCK_TOLERANCE_SECONDS = 10
const WORD_DELAY_MS = 20
/** One word every 100 ms, long enough for Stop to land mid-stream. */
const SLOW_WORD_DELAY_MS = 100
const SLOW_WORDS = 200

const AGENT_PATH = /^\/agui\/agents\/([^/]+)$/

/** Whether the last slow stream was closed by the client before its end, and how many words it wrote (the Stop check). */
let slow = { closedEarly: false, words: 0 }
/** The claims of the last run whose token passed, so a spec can check what the hub sent (spec §2.3's identity). */
let lastCaller: { sub: string; auth_source: string; roles: string[] } | null = null

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(body))
}
/** A refusal as a FastAPI service words it (`{ detail }`); the hub reads none of it (spec §2.4). */
const refuse = (res: ServerResponse, status: number, detail: string) =>
	json(res, status, { detail })

const readBody = (req: IncomingMessage) =>
	new Promise<string>(resolve => {
		const parts: Buffer[] = []
		req.on('data', (chunk: Buffer) => parts.push(chunk))
		req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
		req.on('error', () => resolve(Buffer.concat(parts).toString('utf8')))
	})

/**
 * The owner's contract (spec §2.3): HS256 with the app's secret as UTF-8 bytes (jose's symmetric-secret example), the
 * issuer and the audience, `exp` within 10 s of tolerance, a subject, `auth_source` `local` or `ldap`, `roles` strings.
 */
const verifyCaller = async (authorization: string | undefined) => {
	const jwt = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
	if (!jwt) return null
	try {
		const { payload } = await jwtVerify(jwt, new TextEncoder().encode(e2eEnv.E2E_AGUI_JWT_SECRET), {
			algorithms: ['HS256'],
			issuer: ISSUER,
			audience: STUB_AGUI_AUDIENCE,
			clockTolerance: CLOCK_TOLERANCE_SECONDS,
			requiredClaims: ['sub', 'iat', 'exp'],
		})
		const { sub, auth_source: source, roles } = payload
		if (typeof sub !== 'string' || (source !== 'local' && source !== 'ldap')) return null
		if (!Array.isArray(roles) || !roles.every(role => typeof role === 'string')) return null
		return { sub, auth_source: source, roles: roles as string[] }
	} catch {
		return null
	}
}

const isJson = (contentType: string | undefined) =>
	contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'

/** The parsed input's messages (zod 4 "Type inference": `z.output<typeof schema>`). */
type Messages = z.output<typeof RunAgentInputSchema>['messages']

const lastUserText = (messages: Messages): string => {
	const user = messages.findLast(message => message.role === 'user')
	if (!user) return ''
	if (typeof user.content === 'string') return user.content
	return user.content
		.map(part => (part.type === 'text' ? part.text : ''))
		.filter(Boolean)
		.join(' ')
}

const textMessage = (text: string, messageId: string = randomUUID()): Event[] => {
	const words = text.split(' ')
	return [
		{ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
		...words.map(
			(word, index): Event => ({
				type: EventType.TEXT_MESSAGE_CONTENT,
				messageId,
				delta: index < words.length - 1 ? `${word} ` : word,
			}),
		),
		{ type: EventType.TEXT_MESSAGE_END, messageId },
	]
}

const reasoning = (text: string): Event[] => {
	const messageId = randomUUID()
	return [
		{ type: EventType.REASONING_START, messageId },
		{ type: EventType.REASONING_MESSAGE_START, messageId, role: 'reasoning' },
		{ type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta: text },
		{ type: EventType.REASONING_MESSAGE_END, messageId },
		{ type: EventType.REASONING_END, messageId },
	]
}

/** A backend tool call and its result; ids are unique per call (the spike's finding: a reused id hides the second call). */
const weatherCall = (parentMessageId: string): Event[] => {
	const toolCallId = `call-${randomUUID()}`
	return [
		{ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: 'get_weather', parentMessageId },
		{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '{"city": ' },
		{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: '"Paris"}' },
		{ type: EventType.TOOL_CALL_END, toolCallId },
		{
			type: EventType.TOOL_CALL_RESULT,
			messageId: randomUUID(),
			toolCallId,
			role: 'tool',
			content: JSON.stringify({ city: 'Paris', temperature_c: 18, conditions: 'cloudy' }),
		},
	]
}

type Plan = { refuse: true } | { events: Event[]; delayMs: number; slow?: true }

const planFor = (threadId: string, runId: string, text: string): Plan => {
	const said = text.toLowerCase()
	if (said.includes('invalid')) return { refuse: true }
	const started: Event = { type: EventType.RUN_STARTED, threadId, runId, protocolVersion: '1.0' }
	const finished: Event = {
		type: EventType.RUN_FINISHED,
		threadId,
		runId,
		outcome: { type: 'success' },
	}
	if (said.startsWith('error')) {
		const code = said.split(/\s+/)[1] || 'agent_error'
		// The owner's service: "its message is safe to show" (spec §2.3).
		return {
			events: [
				started,
				{ type: EventType.RUN_ERROR, code, message: `The stub agent stopped with ${code}.` },
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	if (said.includes('timeout')) {
		// The owner's service on its time limit (spec §2.3): CUSTOM run_cancelled, then a bare RUN_FINISHED, as its
		// Pydantic AI 0.x stream ends one (no outcome: "Absent means success").
		return {
			events: [
				started,
				...textMessage('Here is what I found before the time limit.'),
				{ type: EventType.CUSTOM, name: 'run_cancelled', value: { reason: 'run_timeout' } },
				{ type: EventType.RUN_FINISHED, threadId, runId },
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	if (said.includes('slow')) {
		const words = Array.from({ length: SLOW_WORDS }, (_, index) => `word${index}`).join(' ')
		return {
			events: [started, ...textMessage(words), finished],
			delayMs: SLOW_WORD_DELAY_MS,
			slow: true,
		}
	}
	if (said.includes('tool')) {
		const askId = randomUUID()
		return {
			events: [
				started,
				...textMessage('Let me check the weather.', askId),
				...weatherCall(askId),
				...textMessage('It is 18 °C and cloudy in Paris.'),
				finished,
			],
			delayMs: WORD_DELAY_MS,
		}
	}
	return {
		events: [
			started,
			...reasoning('The user greets me. I will greet them back.'),
			...textMessage(
				'Hello from the **stub agent**. Ask for a tool, an error, a timeout or a slow answer.',
			),
			finished,
		],
		delayMs: WORD_DELAY_MS,
	}
}

/**
 * Writes the events one by one with `EventEncoder.encodeSSE` (one JSON event per `data:` line, LF framing: the HTTP +
 * SSE binding), each stamped with the time it leaves. A client that goes away ends the stream (no writes to a closed
 * response); a slow stream records whether that happened before its end.
 */
const streamEvents = (res: ServerResponse, plan: Extract<Plan, { events: Event[] }>) => {
	const encoder = new EventEncoder()
	res.writeHead(200, { 'content-type': encoder.getContentType(), 'cache-control': 'no-cache' })
	if (plan.slow) slow = { closedEarly: false, words: 0 }
	let index = 0
	let timer: NodeJS.Timeout | undefined
	res.on('close', () => {
		clearTimeout(timer)
		// Node http: `writableFinished` is true once the whole response was flushed; a close before it is the client's.
		if (plan.slow && !res.writableFinished) slow.closedEarly = true
	})
	const tick = () => {
		if (res.destroyed || res.writableEnded) return
		if (index === plan.events.length) {
			res.end()
			return
		}
		const event = plan.events[index++]!
		res.write(encoder.encodeSSE({ ...event, timestamp: Date.now() }))
		if (plan.slow && event.type === EventType.TEXT_MESSAGE_CONTENT) slow.words++
		timer = setTimeout(tick, plan.delayMs)
	}
	tick()
}

/**
 * `/agui/...` on the stub server. In the owner's service's order: the token (401), the agent (404), the body's type
 * (415), the body (422: not JSON, or not a RunAgentInput, which Test connection's `{}` is), then the scenario.
 */
export const handleAgui = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
	const method = req.method ?? 'GET'
	if (method === 'GET' && url.pathname === '/agui/_slow') return json(res, 200, slow)
	if (method === 'GET' && url.pathname === '/agui/_caller') return json(res, 200, lastCaller ?? {})
	const agent = AGENT_PATH.exec(url.pathname)?.[1]
	if (method !== 'POST' || !agent) return refuse(res, 404, 'Not Found')
	const caller = await verifyCaller(req.headers.authorization)
	if (!caller) return refuse(res, 401, 'Invalid or expired token')
	if (agent !== STUB_AGUI_AGENT) return refuse(res, 404, `Unknown agent: ${agent}`)
	if (!isJson(req.headers['content-type']))
		return refuse(res, 415, 'Content-Type must be application/json')
	let raw: unknown
	try {
		raw = JSON.parse(await readBody(req))
	} catch {
		return refuse(res, 422, 'The body is not valid JSON')
	}
	const parsed = RunAgentInputSchema.safeParse(raw)
	if (!parsed.success) return refuse(res, 422, 'The body is not a valid RunAgentInput')
	lastCaller = caller
	const { threadId, runId, messages } = parsed.data
	const plan = planFor(threadId, runId, lastUserText(messages))
	if ('refuse' in plan) return refuse(res, 422, 'The stub agent refuses this input')
	streamEvents(res, plan)
}
```

- [ ] **Step 7: Dispatch `/agui/` in the router and name it at start-up**

In `e2e/fixtures/stub/router.ts`, add the import beside the other local imports:

```ts
import { handleAgui } from './agui'
```

and, in `handle`, right after the `OPTIONS` block

```ts
if (method === 'OPTIONS') {
	res.writeHead(200)
	return res.end()
}
```

add:

```ts
// Part 2 spec §10: the AG-UI 1.0 stub agent lives on the same server, under its own prefix.
if (url.pathname.startsWith('/agui/')) return handleAgui(req, res, url)
```

In `e2e/fixtures/stub/server.ts`, replace the log line's text

```ts
		`dify stub listening on http://127.0.0.1:${port}/v1 (+ /agent, /chatflow, /workflow, /completion)`,
```

with

```ts
		`dify stub listening on http://127.0.0.1:${port}/v1 (+ /agent, /chatflow, /workflow, /completion); AG-UI agents on /agui/agents/<name>`,
```

- [ ] **Step 8: Run the test and see it pass**

Run: `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` Expected: PASS, 7 passed. If the `HttpAgent` case fails with a verification error, read the message (it names the event and the rule) and fix the scenario's event shape against the 1.0 typings, never the test.

- [ ] **Step 9: Export the constants and seed the two apps**

In `e2e/fixtures/constants.ts`, after the `export { APP_IDS, … } from './stub/apps'` block, add:

```ts
export {
	AGUI_APP,
	AGUI_MISSING_APP,
	aguiAgentUrl,
	STUB_AGUI_APPS,
	STUB_AGUI_AUDIENCE,
} from './stub/agui-apps'
```

In `e2e/auth.setup.ts`, change the imports

```ts
import { ADMIN_STATE, SEEDED_EXTRA_APPS, STUB_APPS } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubApiBase } from './fixtures/env'
```

to

```ts
import {
	ADMIN_STATE,
	aguiAgentUrl,
	SEEDED_EXTRA_APPS,
	STUB_AGUI_APPS,
	STUB_AGUI_AUDIENCE,
	STUB_APPS,
} from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubApiBase, stubPort } from './fixtures/env'
```

and, inside `withDb(async db => { … })`, after the Dify apps' `for` loop, add:

```ts
// Part 2 spec §10: two AG-UI apps on the stub agent (plan call P14), open to everyone like the stub apps. The
// documents are the AG-UI provider's (spec §2.2): the agent's URL, the JWT audience and the shared secret.
for (const app of STUB_AGUI_APPS) {
	await db.query(
		"INSERT INTO apps (id, provider, name, description, is_enabled, access_mode, settings, secrets) VALUES ($1, 'agui', $2, 'Seeded for the e2e suite', true, 'everyone', $3::jsonb, $4::jsonb) ON CONFLICT (id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, access_mode = EXCLUDED.access_mode, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets, icon_image = NULL, icon_mime = NULL",
		[
			app.id,
			app.name,
			JSON.stringify({
				agentUrl: aguiAgentUrl(stubPort, app.agent),
				audience: STUB_AGUI_AUDIENCE,
			}),
			JSON.stringify({ jwtSecret: e2eEnv.E2E_AGUI_JWT_SECRET }),
		],
	)
}
// The e2e database outlives a run (e2e/global-setup.ts reuses the container): the AG-UI apps' conversations of an
// earlier run are removed, so each run's sidebar starts empty. Runs and messages go with them (ON DELETE CASCADE,
// spec §3.1).
await db.query('DELETE FROM conversations WHERE app_id = ANY($1::uuid[])', [
	STUB_AGUI_APPS.map(app => app.id),
])
```

- [ ] **Step 10: Prove the seed in the browser suite**

Run (no `pnpm dev` running; nothing else on 5433): `pnpm test:e2e e2e/apps.spec.ts --project desktop-light` Expected: the `setup` project and `apps.spec.ts` pass, 0 failed. Then check the rows the seed wrote:

Run: `docker compose -f docker-compose.e2e.yml exec -T postgres psql -U e2e -d e2e -c "SELECT name, provider FROM apps WHERE provider = 'agui' ORDER BY name"` Expected: two rows, `Stub AG-UI agent | agui` and `Stub AG-UI missing | agui`.

- [ ] **Step 11: Gates and commit**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/fixtures/stub/router.ts e2e/fixtures/stub/server.ts e2e/fixtures/constants.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts && pnpm exec oxfmt --check e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/fixtures/stub/router.ts e2e/fixtures/stub/server.ts e2e/fixtures/constants.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts && pnpm test` Expected: no errors; `pnpm test` all passed. If `oxfmt --check` names a file, run `pnpm exec oxfmt <that file>` (the repo's `.oxfmtrc.json` decides the layout) and check again.

```bash
git add e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/fixtures/stub/router.ts e2e/fixtures/stub/server.ts e2e/fixtures/constants.ts e2e/auth.setup.ts .env.e2e __tests__/stub-agui.test.ts
git commit -m "test(e2e): an AG-UI 1.0 stub agent that checks the hub's JWT

Part 2 spec §10 and plan call P14: the stub server serves /agui/agents/<name>
with @ag-ui/encoder, verifies the HS256 token as the owner's service does
(401, then 404, 415, 422 before any stream), and plays the default, tool,
error, timeout, slow and invalid scenarios. The seed adds two AG-UI apps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["e2e/fixtures/stub/agui.ts", "e2e/fixtures/stub/agui-apps.ts", "e2e/fixtures/stub/router.ts", "e2e/fixtures/stub/server.ts", "e2e/fixtures/constants.ts", "e2e/auth.setup.ts", ".env.e2e", "__tests__/stub-agui.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/stub-agui.test.ts && pnpm test:e2e e2e/apps.spec.ts --project desktop-light", "acceptanceCriteria": ["pnpm exec vitest run --project unit __tests__/stub-agui.test.ts reports 7 passed", "No token, another secret, an expired token, another audience or no auth_source answer 401 before the agent is looked at; /agui/agents/missing answers 404; a text/plain body 415; {} and the invalid scenario 422; none streams", "The default scenario answers 200 text/event-stream with RUN_STARTED (input threadId/runId, protocolVersion 1.0), the reasoning events, the text events and RUN_FINISHED, each with a numeric timestamp", "@ag-ui/client HttpAgent.runAgent reads the default, tool, error usage_limit and timeout scenarios without a protocol error", "GET /agui/_slow answers closedEarly true with fewer than 200 words after the client cancels a slow stream; GET /agui/_caller answers the last verified sub, auth_source and roles", "pnpm test:e2e e2e/apps.spec.ts --project desktop-light passes with the two AG-UI apps seeded as provider agui"], "modelTier": "standard"}
```

---

### Task 14: Make the Dify chat's shared pieces neutral

**Goal:** The pieces of the Dify chat that the shared chat reuses no longer read Dify's `AppContext`: the Markdown blocks take their link rewrite from a `MarkdownLinkContext` (spec §5.1's one refactor), `AppAvatar` and `AppInfoBlock` take the app from a `ChatAppInfoContext`, the conversation list takes a neutral item type, and the conversation menu asks `canRename` instead of a Dify id and words its failures through the caller's `describeFailure` instead of Dify's `failureText` (plan call P11). The Dify chat provides both contexts and behaves exactly as before.

**Files:**

- Create: `components/chat/message/markdown/link-context.tsx`, `components/chat/chat-view/app-info-context.tsx`, `components/chat/dify-chat-contexts.ts`, `__tests__/dify-chat-contexts.test.ts`
- Modify: `components/chat/message/markdown/{markdown-image,markdown-link,markdown-source,video-block}.tsx` (whole files), `components/chat/chat-view/conversation-sidebar.tsx` (imports, `ConversationListProps.items`, `AppAvatar`, `AppInfoBlock`), `components/chat/chat-view/use-conversation-menu.tsx` (`canRename`, `describeFailure`), `components/chat/chat-view/chat-view.tsx` (line 462), `components/chat/chat-workspace.tsx` (the ready state and the providers)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts` reports 3 passed; `__tests__/provider-boundary.test.ts` and `__tests__/chat-file-links.test.ts` still pass.
- [ ] `grep -rn "useAppContext" components/chat/message/markdown components/chat/chat-view/conversation-sidebar.tsx` prints nothing; `grep -rn "getDifyId\|dify-errors" components/chat/chat-view/use-conversation-menu.tsx` prints nothing.
- [ ] The Dify specs that show Markdown links and images, the app's icon and name, the welcome panel, the workflow view and rename/delete pass unchanged on the three projects: `pnpm test:e2e e2e/chat-markdown.spec.ts e2e/chat.spec.ts e2e/chat-layout.spec.ts e2e/chat-mobile.spec.ts e2e/chat-header.spec.ts e2e/chat-files.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts` reports 0 failed.

**Verify:** `pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts __tests__/provider-boundary.test.ts __tests__/chat-file-links.test.ts` → all passed; then the e2e command above → 0 failed

**Steps:**

- [ ] **Step 1: Check the React API**

React 19's documented context API (react.dev, via Context7 `/reactjs/react.dev`): `createContext(defaultValue)`, where `defaultValue` is "The value that you want the context to have when there is no matching context provider in the tree above the component that reads context. If you don't have a meaningful default value, specify `null`"; `useContext(SomeContext)` returns "the `value` passed to the closest `SomeContext` provider above the calling component … If there is no such provider, returns the `defaultValue`"; the provider is rendered as `<SomeContext value={…}>` ("`SomeContext.Provider`: Legacy provider component used before React 19"); and "React automatically re-renders all children using a particular context starting from the provider that receives a different `value` (compared via `Object.is`)", so a provider's value is built once, not per render. The existing `AppContext.Provider` stays as it is (no behaviour change in this task); the two new contexts use the documented React 19 form.

- [ ] **Step 2: Write the failing test**

Create `__tests__/dify-chat-contexts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { DEFAULT_SITE_SETTINGS } from '@/components/chat/app-answers'
import type { DifyChatApp } from '@/components/chat/app-context'
import { difyChatContexts } from '@/components/chat/dify-chat-contexts'
import type { DifyApi } from '@/lib/providers/dify/browser'

const app = {
	id: 'a1',
	provider: 'dify',
	name: 'Tea',
	description: 'Brews tea',
	enabled: true,
	hasIcon: true,
	appType: 'chat',
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	},
} as DifyChatApp
const difyApi = {
	remoteFileUrl: (url: string) => `/api/dify/a1/files/remote?url=${encodeURIComponent(url)}`,
} as unknown as DifyApi

describe('the Dify chat’s contexts (Part 2 spec §5.1)', () => {
	it('names the app by its site settings first', () => {
		const site = { ...DEFAULT_SITE_SETTINGS, title: 'Tea room', description: 'Ask about tea' }
		expect(difyChatContexts({ app, site, difyApi }).appInfo).toEqual({
			id: 'a1',
			name: 'Tea room',
			description: 'Ask about tea',
			hasIcon: true,
		})
	})

	it('falls back to the app record when the site has no title or description', () => {
		expect(difyChatContexts({ app, site: DEFAULT_SITE_SETTINGS, difyApi }).appInfo).toEqual({
			id: 'a1',
			name: 'Tea',
			description: 'Brews tea',
			hasIcon: true,
		})
	})

	it('sends Dify’s file links through the remote-file route and keeps every other link', () => {
		const { rewriteLink } = difyChatContexts({ app, site: DEFAULT_SITE_SETTINGS, difyApi })
		expect(rewriteLink('/files/tools/x.png?timestamp=1&nonce=2&sign=3')).toBe(
			'/api/dify/a1/files/remote?url=%2Ffiles%2Ftools%2Fx.png%3Ftimestamp%3D1%26nonce%3D2%26sign%3D3',
		)
		expect(rewriteLink('https://example.com/page')).toBe('https://example.com/page')
		expect(rewriteLink(undefined)).toBeUndefined()
	})
})
```

- [ ] **Step 3: Run the test and see it fail**

Run: `pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts` Expected: FAIL with "Failed to resolve import "@/components/chat/dify-chat-contexts"".

- [ ] **Step 4: The two contexts**

Create `components/chat/message/markdown/link-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

/** How a link in an answer (an image or video `src`, a `<source>`, an anchor `href`) becomes the URL the browser loads. */
export type MarkdownLinkRewrite = (url: string | undefined) => string | undefined

const keepLink: MarkdownLinkRewrite = url => url

/**
 * The chat's link rewrite for the Markdown blocks (Part 2 spec §5.1: the Dify file-link rewrite was the one Dify
 * coupling in the renderer). The Dify chat provides one that sends Dify's file links through the app's remote-file
 * route (components/chat/dify-chat-contexts.ts); without a provider a link loads as written (react.dev
 * `createContext`: the default is "the value … when there is no matching context provider in the tree above").
 */
export const MarkdownLinkContext = createContext<MarkdownLinkRewrite>(keepLink)

export const useMarkdownLink = (): MarkdownLinkRewrite => useContext(MarkdownLinkContext)
```

Create `components/chat/chat-view/app-info-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

/** What the chat shows of its app in the sidebar, the collapsed rail and the welcome: its id, name, description and icon. */
export interface ChatAppInfo {
	id: string
	name: string
	description: string
	/** A stored image exists; it loads through the icon route (charter §4.1, §4.4). */
	hasIcon: boolean
}

/**
 * The open app as the chat names it (Part 2 spec §5.1: the sidebar is shared by the Dify chat and the shared chat).
 * Each chat provides it: the Dify chat from Dify's site settings and the app record, the shared chat from the app
 * record. No meaningful default exists, so the default is `null` (react.dev `createContext`) and the hook throws
 * outside a provider, as useAppContext does.
 */
export const ChatAppInfoContext = createContext<ChatAppInfo | null>(null)

export const useChatAppInfo = (): ChatAppInfo => {
	const value = useContext(ChatAppInfoContext)
	if (!value)
		throw new Error('useChatAppInfo must be used inside a chat that provides ChatAppInfoContext')
	return value
}
```

- [ ] **Step 5: The Dify chat's values, built once per loaded app**

Create `components/chat/dify-chat-contexts.ts`:

```ts
import type { AppContextValue } from './app-context'
import type { ChatAppInfo } from './chat-view/app-info-context'
import { answerLink } from './message/file-link'
import type { MarkdownLinkRewrite } from './message/markdown/link-context'

/**
 * What the Dify chat provides to the pieces it shares with the shared chat (Part 2 spec §5.1): the app as the sidebar
 * and the welcome name it (Dify's site settings first, the app record second, as AppAvatar and AppInfoBlock read them
 * before), and the answers' link rewrite (a Dify file link through the app's remote-file route, charter §4.1;
 * anything else as written: answerLink). Built once when the app has loaded, so the providers' values keep their
 * identity across renders (react.dev useContext: a provider whose `value` changes re-renders every reader).
 */
export const difyChatContexts = ({
	app,
	site,
	difyApi,
}: Pick<AppContextValue, 'app' | 'site' | 'difyApi'>): {
	appInfo: ChatAppInfo
	rewriteLink: MarkdownLinkRewrite
} => ({
	appInfo: {
		id: app.id,
		name: site.title || app.name,
		description: site.description || app.description,
		hasIcon: app.hasIcon,
	},
	rewriteLink: url => answerLink(url, difyApi),
})
```

- [ ] **Step 6: Run the test and see it pass**

Run: `pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts` Expected: PASS, 3 passed.

- [ ] **Step 7: The Markdown blocks read the rewrite**

Replace the whole of `components/chat/message/markdown/markdown-image.tsx` with:

```tsx
'use client'

import { Image } from 'antd'
import { useTranslation } from 'react-i18next'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'
import styles from './markdown.module.css'

/**
 * Markdown images and allowed <img> tags: antd Image with its click-to-preview. The chat's link rewrite decides where
 * the image loads from (MarkdownLinkContext): in the Dify chat, a file Dify wrote into the answer loads through the
 * app's remote-file route, never from the Dify host.
 */
export default function MarkdownImage({ domNode }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const rewriteLink = useMarkdownLink()
	const { src = '', alt } = domNode.attribs ?? {}
	if (!src) return null
	return (
		<Image
			src={rewriteLink(src)}
			alt={alt || t('message.image_alt')}
			classNames={{ root: styles.imageRoot, image: styles.media }}
		/>
	)
}
```

Replace the whole of `components/chat/message/markdown/markdown-link.tsx` with:

```tsx
'use client'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'

/**
 * Links in an answer. XMarkdown's `openLinksInNewTab` already wrote `target` and `rel` on the Markdown links; only the
 * `href` goes through the chat's link rewrite (MarkdownLinkContext: in the Dify chat, a link Dify wrote for one of its
 * files goes through the app's remote-file route, charter §4.1). The attributes a Markdown link carries are passed on,
 * never the renderer's own props.
 */
export default function MarkdownLink({ domNode, children, className }: MarkdownBlockProps) {
	const rewriteLink = useMarkdownLink()
	const { href, target, rel, title } = domNode.attribs ?? {}
	return (
		<a
			className={className || undefined}
			href={rewriteLink(href)}
			target={target}
			rel={rel}
			title={title}
		>
			{children}
		</a>
	)
}
```

Replace the whole of `components/chat/message/markdown/markdown-source.tsx` with:

```tsx
'use client'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'

/** <source> inside an answer's <video> (or <audio>, <picture>): its `src` goes through the chat's link rewrite, the rest is kept. */
export default function MarkdownSource({ domNode }: MarkdownBlockProps) {
	const rewriteLink = useMarkdownLink()
	const { src, type, media, srcset, sizes } = domNode.attribs ?? {}
	return (
		<source
			src={rewriteLink(src)}
			type={type}
			media={media}
			srcSet={srcset}
			sizes={sizes}
		/>
	)
}
```

Replace the whole of `components/chat/message/markdown/video-block.tsx` with:

```tsx
'use client'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownLink } from './link-context'
import styles from './markdown.module.css'

/**
 * <video> in an answer, with a `src` or <source>/<track> children: native controls, never wider than the bubble. The
 * `src` goes through the chat's link rewrite (MarkdownLinkContext; the <source> children do the same).
 */
export default function VideoBlock({ domNode, children }: MarkdownBlockProps) {
	const rewriteLink = useMarkdownLink()
	const src = domNode.attribs?.src
	const hasElements = domNode.children?.some(child => child.type === 'tag') ?? false
	if (!src && !hasElements) return null
	return (
		<video
			className={styles.media}
			src={rewriteLink(src)}
			controls
		>
			{children}
		</video>
	)
}
```

- [ ] **Step 8: The sidebar reads the app info and lists neutral items**

In `components/chat/chat-view/conversation-sidebar.tsx`, replace the two imports

```tsx
import { useAppContext } from '../app-context'
import type { ConversationGroup, ConversationItem } from '../provider/conversations'
import styles from './chat-view.module.css'
```

with

```tsx
import type { ConversationGroup } from '../provider/conversations'
import { useChatAppInfo } from './app-info-context'
import styles from './chat-view.module.css'
```

Replace

```tsx
export interface ConversationListProps {
	items: ConversationItem[]
```

with

```tsx
/**
 * What a row of the list shows (Part 2 spec §5.1: the Dify chat and the shared chat share the list): its key, its
 * label and its date group. Each chat's own item type carries more and satisfies this one.
 */
export interface ConversationListItem {
	key: string
	label: string
	group: ConversationGroup
}

export interface ConversationListProps {
	items: ConversationListItem[]
```

Replace the bodies of `AppAvatar` and `AppInfoBlock`, from

```tsx
export function AppAvatar({ size, alt }: Pick<AvatarProps, 'size' | 'alt'>) {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	return (
		<Avatar
			size={size}
			alt={alt ?? name}
			shape="square"
			src={app.hasIcon ? `/api/apps/${encodeURIComponent(app.id)}/icon` : undefined}
		>
			{name.slice(0, 1)}
		</Avatar>
	)
}

/** The app's icon, name and description (site settings first, the app record second). */
export function AppInfoBlock() {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	const description = site.description || app.description
```

to

```tsx
export function AppAvatar({ size, alt }: Pick<AvatarProps, 'size' | 'alt'>) {
	const { id, name, hasIcon } = useChatAppInfo()
	return (
		<Avatar
			size={size}
			alt={alt ?? name}
			shape="square"
			src={hasIcon ? `/api/apps/${encodeURIComponent(id)}/icon` : undefined}
		>
			{name.slice(0, 1)}
		</Avatar>
	)
}

/** The app's icon, name and description, as the chat names them (ChatAppInfoContext; the Dify chat: site settings first). */
export function AppInfoBlock() {
	const { name, description } = useChatAppInfo()
```

The rest of `AppInfoBlock` (it renders `name` and `description`) stays as it is.

- [ ] **Step 9: The menu asks `canRename`**

In `components/chat/chat-view/use-conversation-menu.tsx`, replace

```tsx
export interface ConversationMenuOptions {
	/** Rename on Dify, then locally; rejects with `{ status, code?, message }` (useConversations). */
	rename: (key: string, name: string) => Promise<void>
	/** Delete on Dify, then locally, activating the next conversation; rejects like `rename`. */
	remove: (key: string) => Promise<void>
	/** The Dify conversation id, undefined until a new chat's first reply named it (spec §4.4). */
	getDifyId: (key: string) => string | undefined
}

/**
 * The per-item menu of X `Conversations` (spec §5.2: `menu` as a function of the item, antd Menu items
 * and `onClick`). Rename and delete ask through `App.useApp().modal.confirm` (never the static `Modal`,
 * which has no App context), rename with an antd Form in the modal's content. A chat Dify has not named
 * yet can only be deleted: its name is Dify's to give once the first reply starts it.
 */
export const useConversationMenu = ({
	rename,
	remove,
	getDifyId,
}: ConversationMenuOptions): ConversationMenu => {
```

with

```tsx
export interface ConversationMenuOptions {
	/** Renames the conversation where it is stored, then in the list; rejects with the failure (failureText words it). */
	rename: (key: string, name: string) => Promise<void>
	/** Deletes the conversation, then removes it from the list and activates the next one; rejects like `rename`. */
	remove: (key: string) => Promise<void>
	/**
	 * Whether the conversation can be renamed yet (the Dify chat: once Dify has named it, spec §4.4; the shared chat:
	 * once the hub stores it). Keep it stable (useCallback): the menu, and so the memoised sidebar, follows it.
	 */
	canRename: (key: string) => boolean
	/**
	 * A failed rename or delete in words, for the toast (each chat words its own failures: the Dify chat with
	 * failureText, the shared chat with its own codes). Keep it stable (useCallback), as `canRename`.
	 */
	describeFailure: (error: unknown) => string
}

/**
 * The per-item menu of X `Conversations` (spec §5.2: `menu` as a function of the item, antd Menu items
 * and `onClick`). Rename and delete ask through `App.useApp().modal.confirm` (never the static `Modal`,
 * which has no App context), rename with an antd Form in the modal's content. A conversation that cannot be
 * renamed yet (`canRename`) can only be deleted.
 */
export const useConversationMenu = ({
	rename,
	remove,
	canRename,
	describeFailure,
}: ConversationMenuOptions): ConversationMenu => {
```

Replace the import that only the toast used

```tsx
import { failureText } from '../hooks/dify-errors'
```

with nothing (delete the line: the menu no longer imports Dify's error helper, so the shared chat's bundle does not carry it), and replace

```tsx
/** The failure's text (failureText), else the generic one; the modal stays open for another try. */
const reportFailure = useCallback(
	(error: unknown) => {
		message.error(failureText(error, t, t('common.request_failed_retry')))
	},
	[message, t],
)
```

with

```tsx
/** The failure's text (the chat's describeFailure); the modal stays open for another try. */
const reportFailure = useCallback(
	(error: unknown) => {
		message.error(describeFailure(error))
	},
	[describeFailure, message],
)
```

Replace

```tsx
				...(getDifyId(conversation.key)
					? [{ key: 'rename', label: t('chat.rename'), icon: <EditOutlined /> }]
					: []),
```

with

```tsx
				...(canRename(conversation.key)
					? [{ key: 'rename', label: t('chat.rename'), icon: <EditOutlined /> }]
					: []),
```

and the hook's dependency list `[ask, form, getDifyId, message, remove, rename, reportFailure, t]` with `[ask, canRename, form, message, remove, rename, reportFailure, t]`.

Run: `grep -n "dify-errors" components/chat/chat-view/use-conversation-menu.tsx` Expected: no output (the shared chat reuses this hook, and must not carry Dify's error helper, which imports the Dify browser client).

- [ ] **Step 10: The Dify chat passes `canRename`**

In `components/chat/chat-view/chat-view.tsx`, replace

```tsx
const conversationMenu = useConversationMenu({ rename, remove, getDifyId })
```

with

```tsx
// A chat Dify has not named yet can only be deleted: its name is Dify's to give once the first reply starts it
// (spec §4.4). Stable while getDifyId is, so the memoised sidebar keeps its menu.
const canRename = useCallback((key: string) => Boolean(getDifyId(key)), [getDifyId])
// The menu's toast, worded as before (failureText, else the generic text).
const describeFailure = useCallback(
	(error: unknown) => failureText(error, t, t('common.request_failed_retry')),
	[t],
)
const conversationMenu = useConversationMenu({ rename, remove, canRename, describeFailure })
```

(`useCallback` and `failureText` are already imported there.)

- [ ] **Step 11: The Dify chat provides both contexts**

In `components/chat/chat-workspace.tsx`, replace the imports

```tsx
import { DEFAULT_SITE_SETTINGS } from './app-answers'
import { AppContext, type AppContextValue, type DifyChatApp } from './app-context'
import { failureText } from './hooks/dify-errors'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
```

with

```tsx
import { DEFAULT_SITE_SETTINGS } from './app-answers'
import { AppContext, type AppContextValue, type DifyChatApp } from './app-context'
import { ChatAppInfoContext, type ChatAppInfo } from './chat-view/app-info-context'
import ChatView from './chat-view/chat-view'
import styles from './chat-view/chat-view.module.css'
import { difyChatContexts } from './dify-chat-contexts'
import { failureText } from './hooks/dify-errors'
import { MarkdownLinkContext, type MarkdownLinkRewrite } from './message/markdown/link-context'
```

Replace

```tsx
	| { status: 'ready'; value: AppContextValue }
```

with

```tsx
	| {
			status: 'ready'
			value: AppContextValue
			/** The shared pieces' contexts (Part 2 spec §5.1), built once with the app (difyChatContexts). */
			appInfo: ChatAppInfo
			rewriteLink: MarkdownLinkRewrite
	  }
```

Replace

```tsx
if (!cancelled) setState({ status: 'ready', value: { app, parameters, site, difyApi } })
```

with

```tsx
if (!cancelled) {
	const value = { app, parameters, site, difyApi }
	setState({ status: 'ready', value, ...difyChatContexts(value) })
}
```

Replace the ready branch's return

```tsx
return (
	<AppContext.Provider value={state.value}>
		{isChatLikeApp(mode) ? (
			<ChatView />
		) : isWorkflowLikeApp(mode) ? (
			<WorkflowView />
		) : (
			<UserShell>
				<Result
					status="warning"
					title={t('common.unsupported_app_type')}
				/>
			</UserShell>
		)}
	</AppContext.Provider>
)
```

with

```tsx
return (
	<AppContext.Provider value={state.value}>
		{/* React 19 renders a context as its own provider (react.dev createContext; `.Provider` is the legacy form). */}
		<ChatAppInfoContext value={state.appInfo}>
			<MarkdownLinkContext value={state.rewriteLink}>
				{isChatLikeApp(mode) ? (
					<ChatView />
				) : isWorkflowLikeApp(mode) ? (
					<WorkflowView />
				) : (
					<UserShell>
						<Result
							status="warning"
							title={t('common.unsupported_app_type')}
						/>
					</UserShell>
				)}
			</MarkdownLinkContext>
		</ChatAppInfoContext>
	</AppContext.Provider>
)
```

Every `AppAvatar` and `AppInfoBlock` of the Dify chat (the sidebar, the collapsed rail, the welcome panel, the workflow view) and every `MessageMarkdown` (the answers, the welcome's opening statement, the human input form, the workflow result) render under these providers, so their output is the same as before.

- [ ] **Step 12: The boundary and the old readers**

Run: `grep -rn "useAppContext" components/chat/message/markdown components/chat/chat-view/conversation-sidebar.tsx; grep -n "getDifyId" components/chat/chat-view/use-conversation-menu.tsx` Expected: no output.

Run: `pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts __tests__/provider-boundary.test.ts __tests__/chat-file-links.test.ts` Expected: PASS, all passed.

- [ ] **Step 13: Gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint components/chat __tests__/dify-chat-contexts.test.ts && pnpm exec oxfmt --check components/chat/message/markdown/link-context.tsx components/chat/chat-view/app-info-context.tsx components/chat/dify-chat-contexts.ts components/chat/message/markdown/markdown-image.tsx components/chat/message/markdown/markdown-link.tsx components/chat/message/markdown/markdown-source.tsx components/chat/message/markdown/video-block.tsx components/chat/chat-view/conversation-sidebar.tsx components/chat/chat-view/use-conversation-menu.tsx components/chat/chat-view/chat-view.tsx components/chat/chat-workspace.tsx __tests__/dify-chat-contexts.test.ts && pnpm test && npx -y @ant-design/cli lint ./` Expected: no errors; `pnpm test` all passed; the antd lint's finding count is not higher than before this task. If `oxfmt --check` names a file, run `pnpm exec oxfmt <that file>` (the repo's `.oxfmtrc.json` decides the layout) and check again.

- [ ] **Step 14: The Dify chat in the browser, unchanged**

Run (no `pnpm dev`; nothing else on 5433): `pnpm test:e2e e2e/chat-markdown.spec.ts e2e/chat.spec.ts e2e/chat-layout.spec.ts e2e/chat-mobile.spec.ts e2e/chat-header.spec.ts e2e/chat-files.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts` Expected: 0 failed on `desktop-light`, `desktop-dark` and `mobile-light`. These cover Dify's file links and images in answers through the remote-file route (`chat-markdown`, `chat-files`), the sidebar's app block and rename/delete (`chat`), the collapsed rail's avatar and the drawer (`chat-layout`, `chat-mobile`), the header (`chat-header`) and the workflow view's app block (`workflow`, `completion`).

- [ ] **Step 15: Commit**

```bash
git add components/chat/message/markdown/link-context.tsx components/chat/chat-view/app-info-context.tsx components/chat/dify-chat-contexts.ts components/chat/message/markdown/markdown-image.tsx components/chat/message/markdown/markdown-link.tsx components/chat/message/markdown/markdown-source.tsx components/chat/message/markdown/video-block.tsx components/chat/chat-view/conversation-sidebar.tsx components/chat/chat-view/use-conversation-menu.tsx components/chat/chat-view/chat-view.tsx components/chat/chat-workspace.tsx __tests__/dify-chat-contexts.test.ts
git commit -m "refactor(chat): neutral link and app-info contexts for the shared chat

Part 2 spec §5.1 and plan call P11: the Markdown blocks take their link
rewrite from MarkdownLinkContext, AppAvatar and AppInfoBlock take the app
from ChatAppInfoContext, the list takes a neutral item, and the menu asks
canRename. The Dify chat provides both contexts; it behaves as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["components/chat/message/markdown/link-context.tsx", "components/chat/chat-view/app-info-context.tsx", "components/chat/dify-chat-contexts.ts", "components/chat/message/markdown/markdown-image.tsx", "components/chat/message/markdown/markdown-link.tsx", "components/chat/message/markdown/markdown-source.tsx", "components/chat/message/markdown/video-block.tsx", "components/chat/chat-view/conversation-sidebar.tsx", "components/chat/chat-view/use-conversation-menu.tsx", "components/chat/chat-view/chat-view.tsx", "components/chat/chat-workspace.tsx", "__tests__/dify-chat-contexts.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts __tests__/provider-boundary.test.ts __tests__/chat-file-links.test.ts && pnpm test:e2e e2e/chat-markdown.spec.ts e2e/chat.spec.ts e2e/chat-layout.spec.ts e2e/chat-mobile.spec.ts e2e/chat-header.spec.ts e2e/chat-files.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts", "acceptanceCriteria": ["pnpm exec vitest run --project unit __tests__/dify-chat-contexts.test.ts reports 3 passed; provider-boundary and chat-file-links tests still pass", "grep -rn useAppContext over components/chat/message/markdown and conversation-sidebar.tsx prints nothing; use-conversation-menu.tsx has no getDifyId", "The Dify e2e specs chat-markdown, chat, chat-layout, chat-mobile, chat-header, chat-files, workflow and completion report 0 failed on the three projects"], "modelTier": "standard"}
```

---

### Task 15: The shared chat's browser data layer

**Goal:** `components/shared-chat/` gets everything the view needs below it: keys, a provider cache, the browser client of the read and stop routes, XRequest's `fetch`, `AgUiChatProvider` (the three transforms over `applyAgUiEvent`), `useSharedChat` (useXChat per conversation key, history, paging, queue, Stop) and `useSharedConversations` (the sidebar list on useXConversations, rename and delete through Task 12's Server Actions).

Spec §5.2 ("built like `useDifyChat`"), §4.2 (the routes), plan calls P8, P9, P11. Docs checked: the `use-x-chat`, `x-chat-provider` and `x-request` skills (2.9.0: implement only the three transforms, never a `request` method, never return `status` from `transformMessage`; one provider per conversation; `defaultMessages` may be async; `queueRequest` waits for a key's defaults; `requestFallback` gets `{ error, messageInfo }`), and `node_modules/@ant-design/x-sdk/es/{chat-providers/AbstractChatProvider,x-chat/index,x-request/index,x-conversations/index}.d.ts`. Research: `part2-x-mapping.md` §1 (one request updates one message; `transformMessage` gets no `originMessage` on a reload's first chunk; `requestFallback` moves the turn to the end under a new id, ADR-0017's note) and §1.6 (XRequest reads AG-UI SSE as it is; its own fetch drops a non-OK body).

**Depends on:** Task 8 (`lib/chat/turn.ts`), Task 11 (the routes' answers), Task 12 (`renameConversationAction`, `deleteConversationAction`), Task 14 (nothing here, the view's task uses it).

**Files:**

- Create: `components/shared-chat/keys.ts`
- Create: `components/shared-chat/provider-cache.ts`
- Create: `components/shared-chat/api.ts`
- Create: `components/shared-chat/hub-fetch.ts`
- Create: `components/shared-chat/conversations.ts`
- Create: `components/shared-chat/provider/ag-ui-chat-provider.ts`
- Create: `components/shared-chat/hooks/chat-helpers.ts`
- Create: `components/shared-chat/hooks/use-shared-chat.ts`
- Create: `components/shared-chat/hooks/use-shared-conversations.ts`
- Test: `__tests__/shared-chat-keys.test.ts`, `__tests__/shared-chat-provider.test.ts`, `__tests__/shared-chat-helpers.test.ts`, `__tests__/shared-chat-conversations.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts` reports every case passed (4 files, 0 failed).
- [ ] `AgUiChatProvider.transformParams({ message: { text: 'hi' } })` answers `{ conversationId: 'conv-1', message: { text: 'hi' } }` when the conversation has an id and `{ message: { text: 'hi' } }` when it has none; the client-only `continues` never reaches the body.
- [ ] A `CUSTOM hub:run` chunk calls `onRun` with its value and sets `provider.runId`; a `STATE_SNAPSHOT` chunk calls `onState` with its snapshot; a chunk that is not a JSON object with a string `type` returns the origin turn unchanged.
- [ ] A reload's first chunk (no `originMessage`) continues the `continues` turn given to `transformParams`.
- [ ] `fallbackTurn` closes a running run as `cancelled` on an AbortError (its running tools `stopped`), records a request's own failure as a run with `runId: ''` and the envelope's `code` (never its English `message`), and leaves a turn whose last run had ended unchanged.
- [ ] `grep -rn "from '@ag-ui/core'" components/shared-chat | grep -v "import type"` prints nothing (types only, Global Constraints).
- [ ] `pnpm exec tsc --noEmit` passes; `pnpm test` passes.

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts` → `Test Files  4 passed (4)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/shared-chat-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	conversationKeyFor,
	newTempConversationKey,
	parseConversationKey,
} from '@/components/shared-chat/keys'

const APP = 'e2e00000-0000-4000-8000-0000000000a1'
const CONVERSATION = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'

describe('shared chat keys (ADR-0017)', () => {
	it('keys a stored conversation by the app and its id, and reads both back', () => {
		const key = conversationKeyFor(APP, CONVERSATION)
		expect(key).toBe(`${APP}:${CONVERSATION}`)
		expect(parseConversationKey(key)).toEqual({
			appId: APP,
			conversationId: CONVERSATION,
			temp: false,
		})
	})
	it('gives a new chat a temporary key with no conversation id', () => {
		const key = newTempConversationKey(APP)
		expect(key).toMatch(new RegExp(`^${APP}:temp:[0-9a-f-]{36}$`))
		expect(parseConversationKey(key)).toEqual({ appId: APP, temp: true })
		expect(newTempConversationKey(APP)).not.toBe(key)
	})
	it('reads the empty key as no conversation', () => {
		expect(parseConversationKey('')).toEqual({ appId: '', conversationId: undefined, temp: false })
	})
})
```

Create `__tests__/shared-chat-provider.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import {
	AgUiChatProvider,
	parseHubEvent,
} from '@/components/shared-chat/provider/ag-ui-chat-provider'
import { emptyAssistantTurn, HUB_RUN_EVENT, userTurn, type Turn } from '@/lib/chat/turn'

const chunk = (event: object) => ({ data: JSON.stringify(event) })

const makeProvider = (overrides: Partial<ConstructorParameters<typeof AgUiChatProvider>[0]> = {}) =>
	new AgUiChatProvider({
		// AbstractChatProvider only checks `manual`; no network is involved in these tests (as dify-chat-provider.test.ts).
		request: { manual: true, options: {} } as never,
		getConversationId: () => 'conv-1',
		onRun: vi.fn(),
		onState: vi.fn(),
		...overrides,
	})

const feed = (provider: AgUiChatProvider, chunks: { data?: string }[], origin?: Turn) => {
	let turn = origin
	for (const data of chunks) {
		turn = provider.transformMessage({
			originMessage: turn,
			chunk: data,
			chunks: [],
			status: 'updating',
			responseHeaders: new Headers(),
		})
	}
	return turn!
}

const hubRun = {
	type: 'CUSTOM',
	name: HUB_RUN_EVENT,
	value: { conversationId: 'conv-1', runId: 'r1', title: 'Hi' },
}

describe('AgUiChatProvider.transformParams (spec §4.2)', () => {
	it('sends the message with the conversation id once the conversation has one', () => {
		expect(makeProvider().transformParams({ message: { text: 'hi' } })).toEqual({
			conversationId: 'conv-1',
			message: { text: 'hi' },
		})
	})
	it('sends no conversation id for a new chat', () => {
		const provider = makeProvider({ getConversationId: () => undefined })
		expect(provider.transformParams({ message: { text: 'hi' } })).toEqual({
			message: { text: 'hi' },
		})
	})
	it('sends answers without a message, and never the client-only turn they continue', () => {
		const answers = { resume: [{ interruptId: 'int-1', status: 'cancelled' as const }] }
		const body = makeProvider().transformParams({ answers, continues: emptyAssistantTurn() })
		expect(body).toEqual({ conversationId: 'conv-1', answers })
		expect(body).not.toHaveProperty('continues')
		expect(body).not.toHaveProperty('message')
	})
})

describe('AgUiChatProvider.transformLocalMessage', () => {
	it('shows the user turn of a message, and none for answers', () => {
		const provider = makeProvider()
		expect(provider.transformLocalMessage({ message: { text: 'hi' } })).toEqual(
			userTurn('local', 'hi'),
		)
		expect(provider.transformLocalMessage({ answers: { resume: [] } })).toEqual([])
	})
})

describe('AgUiChatProvider.transformMessage (spec §5.2)', () => {
	it('reports hub:run and keeps the run id for Stop, until the next request', () => {
		const onRun = vi.fn()
		const provider = makeProvider({ onRun })
		provider.transformParams({ message: { text: 'hi' } })
		feed(provider, [chunk(hubRun)])
		expect(onRun).toHaveBeenCalledWith(hubRun.value)
		expect(provider.runId).toBe('r1')
		provider.transformParams({ message: { text: 'again' } })
		expect(provider.runId).toBeUndefined()
	})
	it('folds text events into one turn', () => {
		const turn = feed(makeProvider(), [
			chunk(hubRun),
			chunk({ type: 'RUN_STARTED', threadId: 'conv-1', runId: 'r1' }),
			chunk({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }),
			chunk({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello ' }),
			chunk({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'world' }),
			chunk({ type: 'TEXT_MESSAGE_END', messageId: 'm1' }),
		])
		expect(turn.role).toBe('assistant')
		expect(turn.parts).toContainEqual({ kind: 'text', messageId: 'm1', text: 'Hello world' })
	})
	it('hands the state snapshot to the side store', () => {
		const onState = vi.fn()
		feed(makeProvider({ onState }), [chunk({ type: 'STATE_SNAPSHOT', snapshot: { steps: [] } })])
		expect(onState).toHaveBeenCalledWith({ steps: [] })
	})
	it('returns the origin for a chunk that is no event', () => {
		const origin = userTurn('m0', 'x')
		const provider = makeProvider()
		for (const data of [undefined, '', 'not json', '[1]', '{"type":3}', 'null']) {
			expect(
				provider.transformMessage({
					originMessage: origin,
					chunk: { data },
					chunks: [],
					status: 'updating',
					responseHeaders: new Headers(),
				}),
			).toBe(origin)
		}
	})
	it('starts an empty assistant turn when the stream ends without any chunk', () => {
		expect(
			makeProvider().transformMessage({
				chunk: undefined as never,
				chunks: [],
				status: 'success',
				responseHeaders: new Headers(),
			}),
		).toEqual(emptyAssistantTurn())
	})
	it('continues the given turn on a reload, whose first chunk has no origin (x-sdk onReload)', () => {
		const provider = makeProvider()
		const paused: Turn = {
			...emptyAssistantTurn(),
			parts: [{ kind: 'text', messageId: 'm1', text: 'Before the question.' }],
		}
		provider.transformParams({ answers: { resume: [] }, continues: paused })
		const turn = feed(provider, [
			chunk({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'After.' }),
		])
		expect(turn.parts[0]).toEqual({ kind: 'text', messageId: 'm1', text: 'Before the question.' })
		expect(turn.parts).toContainEqual({ kind: 'text', messageId: 'm2', text: 'After.' })
	})
	it('keeps streaming when a callback throws', () => {
		const provider = makeProvider({
			onRun: () => {
				throw new Error('list gone')
			},
		})
		expect(() => feed(provider, [chunk(hubRun)])).not.toThrow()
		expect(provider.runId).toBe('r1')
	})
})

describe('parseHubEvent', () => {
	it('reads one JSON event object with a string type', () => {
		expect(parseHubEvent('{"type":"RUN_STARTED","runId":"r1"}')).toEqual({
			type: 'RUN_STARTED',
			runId: 'r1',
		})
		expect(parseHubEvent('{"runId":"r1"}')).toBeNull()
		expect(parseHubEvent(' ')).toBeNull()
	})
})
```

Create `__tests__/shared-chat-helpers.test.ts`:

```ts
import type { MessageInfo } from '@ant-design/x-sdk'
import { describe, expect, it } from 'vitest'

import {
	fallbackTurn,
	openInterruptsOf,
	prependLatestTurns,
	sendDecision,
	toMessageInfo,
	toRequestError,
} from '@/components/shared-chat/hooks/chat-helpers'
import { emptyAssistantTurn, userTurn, type Turn } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

// fetch rejects with a DOMException named AbortError; the SDK and the fallback only read `name`.
const abortError = () =>
	Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })

const streaming: Turn = {
	...emptyAssistantTurn(),
	parts: [
		{ kind: 'text', messageId: 'm1', text: 'Half an ans' },
		{ kind: 'tool', toolCallId: 'c1', name: 'search', args: '{"q":', status: 'running' },
	],
	runs: [{ runId: 'r1', outcome: 'running' }],
}

describe('sendDecision (one reply at a time per conversation, as useDifyChat)', () => {
	it.each([
		[{ isRequesting: false, isDefaultMessagesRequesting: false, queued: false }, 'send'],
		[{ isRequesting: false, isDefaultMessagesRequesting: true, queued: false }, 'queue'],
		[{ isRequesting: true, isDefaultMessagesRequesting: false, queued: false }, 'ignore'],
		[{ isRequesting: false, isDefaultMessagesRequesting: true, queued: true }, 'ignore'],
	] as const)('%o → %s', (state, expected) => {
		expect(sendDecision(state)).toBe(expected)
	})
})

describe('fallbackTurn (useXChat requestFallback)', () => {
	it('closes the running run as cancelled on an abort and stops its running tools', () => {
		const turn = fallbackTurn(abortError(), streaming)
		expect(turn.runs).toEqual([{ runId: 'r1', outcome: 'cancelled' }])
		expect(turn.parts[0]).toEqual(streaming.parts[0])
		expect(turn.parts[1]).toMatchObject({ kind: 'tool', status: 'stopped' })
	})
	it('marks an abort before any run as a stopped request', () => {
		expect(fallbackTurn(abortError(), undefined).runs).toEqual([
			{ runId: '', outcome: 'cancelled' },
		])
	})
	it('records the envelope code of a refused request, never its English message', () => {
		const turn = fallbackTurn(
			new RequestError(502, 'agent_not_found', 'The agent was not found.'),
			undefined,
		)
		expect(turn.runs).toEqual([
			{ runId: '', outcome: 'error', error: { code: 'agent_not_found', message: '' } },
		])
	})
	it('closes a running run with the failure when the stream breaks', () => {
		const turn = fallbackTurn(new TypeError('network error'), streaming)
		expect(turn.runs).toEqual([
			{ runId: 'r1', outcome: 'error', error: { code: undefined, message: '' } },
		])
	})
	it('leaves a turn whose run had already ended as it was', () => {
		const ended: Turn = { ...streaming, runs: [{ runId: 'r1', outcome: 'success' }] }
		expect(fallbackTurn(abortError(), ended)).toEqual(ended)
	})
})

describe('toRequestError', () => {
	it('keeps a RequestError and wraps anything else without its text', () => {
		const refused = new RequestError(404, 'conversation_not_found', 'x')
		expect(toRequestError(refused)).toBe(refused)
		const wrapped = toRequestError(new TypeError('Failed to fetch'))
		expect(wrapped).toBeInstanceOf(RequestError)
		expect(wrapped.code).toBeUndefined()
		expect(wrapped.message).toBe('')
	})
})

const info = (
	id: string,
	message: Turn,
	status: MessageInfo<Turn>['status'] = 'success',
): MessageInfo<Turn> => ({
	id,
	message,
	status,
})
const answer = (runId: string): Turn => ({
	...emptyAssistantTurn(),
	runs: [{ runId, outcome: 'success' }],
})

describe('prependLatestTurns (a retried first page)', () => {
	it('puts the page above what was sent since, without the turns already on screen', () => {
		const current = [info('msg_1', userTurn('local', 'again')), info('msg_2', answer('r2'))]
		const page = [
			info('u1', userTurn('u1', 'first')),
			info('turn-r1', answer('r1')),
			info('u2', userTurn('u2', 'again')),
			info('turn-r2', answer('r2')),
		]
		expect(prependLatestTurns(current, page).map(m => m.id)).toEqual([
			'u1',
			'turn-r1',
			'msg_1',
			'msg_2',
		])
	})
})

describe('toMessageInfo and openInterruptsOf', () => {
	it('shows a history turn as a finished message under its id (plan call P9)', () => {
		const turn = answer('r1')
		expect(toMessageInfo({ id: 'turn-r1', turn })).toEqual({
			id: 'turn-r1',
			message: turn,
			status: 'success',
		})
	})
	it('reads the open interrupts of the last turn only (spec §3.3)', () => {
		const interrupted: Turn = {
			...answer('r1'),
			interrupts: [{ id: 'int-1', reason: 'tool_call' }],
		}
		expect(openInterruptsOf([info('a', interrupted)])).toEqual(interrupted.interrupts)
		expect(openInterruptsOf([info('a', interrupted), info('b', userTurn('b', 'x'))])).toEqual([])
		expect(openInterruptsOf([])).toEqual([])
	})
})
```

Create `__tests__/shared-chat-conversations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	isUnsentTemp,
	mergeConversations,
	toConversationItem,
	type SharedConversationItem,
} from '@/components/shared-chat/conversations'
import { conversationKeyFor, newTempConversationKey } from '@/components/shared-chat/keys'

const APP = 'e2e00000-0000-4000-8000-0000000000a1'
const NOW = Date.UTC(2026, 9, 14, 12)
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'

describe('toConversationItem', () => {
	it('keys the item by its id, groups it by its last activity and labels an untitled one', () => {
		const item = toConversationItem(
			APP,
			{ id: C1, title: '', updatedAt: new Date(NOW).toISOString() },
			NOW,
			'New conversation',
		)
		expect(item).toEqual({
			key: conversationKeyFor(APP, C1),
			label: 'New conversation',
			conversationId: C1,
			updatedAt: NOW / 1000,
			group: 'today',
		})
		expect(
			toConversationItem(
				APP,
				{ id: C1, title: 'Tea', updatedAt: new Date(NOW - 30 * 86_400_000).toISOString() },
				NOW,
				'New conversation',
			),
		).toMatchObject({ label: 'Tea', group: 'older' })
	})
})

describe('mergeConversations', () => {
	const server = (id: string, title: string) =>
		toConversationItem(
			APP,
			{ id, title, updatedAt: new Date(NOW).toISOString() },
			NOW,
			'New conversation',
		)
	it('keeps unsent new chats on top and the key a live chat already has', () => {
		const unsent: SharedConversationItem = {
			key: newTempConversationKey(APP),
			label: 'New conversation',
			updatedAt: NOW / 1000,
			group: 'today',
		}
		const named: SharedConversationItem = {
			...unsent,
			key: newTempConversationKey(APP),
			conversationId: C1,
		}
		const merged = mergeConversations([unsent, named], [server(C1, 'Tea'), server(C2, 'Coffee')])
		expect(merged.map(c => c.key)).toEqual([unsent.key, named.key, conversationKeyFor(APP, C2)])
		expect(merged[1]).toMatchObject({ label: 'Tea', conversationId: C1 })
		expect(isUnsentTemp(merged[0])).toBe(true)
		expect(isUnsentTemp(merged[1])).toBe(false)
	})
	it('keeps the active conversation in its place when the server no longer lists it', () => {
		const active = server(C1, 'Tea')
		const merged = mergeConversations([active], [server(C2, 'Coffee')], { activeKey: active.key })
		expect(merged.map(c => c.conversationId)).toEqual([C1, C2])
	})
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts` Expected: FAIL, 4 files: `Failed to resolve import "@/components/shared-chat/keys"` (and the other three modules).

- [ ] **Step 3: Write the keys and the provider cache**

Create `components/shared-chat/keys.ts`:

```ts
import { generateUuidV4 } from '@/lib/helpers'

/**
 * The shared chat's useXChat keys (Part 2 spec §5.2; ADR-0017). The x-sdk keeps one message store per key in a
 * module-global map, so a key carries the app id; a new chat gets a temporary key that never changes during the page
 * session, and the conversation id the server answers (`hub:run`) is kept on the conversation item instead. The Dify
 * chat's keys (components/chat/provider/keys.ts) name that id `difyId` and go with the Dify chat in Part 3 (plan call
 * P11).
 */
const TEMP = 'temp'

export const conversationKeyFor = (appId: string, conversationId: string) =>
	`${appId}:${conversationId}`

export const newTempConversationKey = (appId: string) => `${appId}:${TEMP}:${generateUuidV4()}`

export const parseConversationKey = (
	key: string,
): { appId: string; conversationId?: string; temp: boolean } => {
	const [appId = '', second] = key.split(':')
	if (second === TEMP) return { appId, temp: true }
	return { appId, conversationId: second || undefined, temp: false }
}
```

Create `components/shared-chat/provider-cache.ts`:

```ts
import type { AgUiChatProvider } from './provider/ag-ui-chat-provider'

/** One provider per conversation key (use-x-chat skill: "each conversation must have its own Provider instance"). */
const providers = new Map<string, AgUiChatProvider>()

export const getProvider = (key: string, create: () => AgUiChatProvider): AgUiChatProvider => {
	let provider = providers.get(key)
	if (!provider) {
		provider = create()
		providers.set(key, provider)
	}
	return provider
}

export const clearProviders = () => providers.clear()
```

- [ ] **Step 4: Write the browser client and XRequest's fetch**

Create `components/shared-chat/api.ts`:

```ts
// Client-safe: the two type imports below are erased (TypeScript `import type`), so neither server module reaches the
// bundle. The browser's way to the shared chat's read and stop routes (Part 2 spec §4.2): every method resolves the
// typed body and rejects with RequestError (lib/http/browser.ts) on a non-OK answer, as the Dify browser client does
// (lib/providers/dify/browser.ts).
import type { HistoryTurn } from '@/lib/chat/turn'
import type { ConversationListItem } from '@/lib/data/conversations'
import { readRequestError } from '@/lib/http/browser'

/** GET /api/apps/[appId]/conversations (spec §4.2; plan call P8). */
export interface ConversationsPage {
	items: ConversationListItem[]
	nextCursor: string | null
}

/** GET /api/apps/[appId]/conversations/[conversationId]: the latest turns, or those before `cursor` (plan call P8). */
export interface ConversationPage {
	id: string
	title: string
	state: unknown
	turns: HistoryTurn[]
	cursor: string | null
}

const segment = (value: string) => encodeURIComponent(value)

export const createSharedChatApi = (appId: string) => {
	const base = `/api/apps/${segment(appId)}`
	const request = async (path: string, init?: RequestInit): Promise<Response> => {
		const response = await fetch(`${base}${path}`, init)
		if (!response.ok) throw await readRequestError(response)
		return response
	}
	return {
		listConversations: () =>
			request('/conversations').then(response => response.json() as Promise<ConversationsPage>),
		getConversation: (conversationId: string, before?: string) =>
			request(
				`/conversations/${segment(conversationId)}${before ? `?before=${segment(before)}` : ''}`,
			).then(response => response.json() as Promise<ConversationPage>),
		/** Spec §4.5: the route answers 204, also for a run that has already ended. */
		stopRun: async (conversationId: string, runId: string): Promise<void> => {
			await request(`/conversations/${segment(conversationId)}/runs/${segment(runId)}/stop`, {
				method: 'POST',
			})
		},
	}
}

export type SharedChatApi = ReturnType<typeof createSharedChatApi>
```

Create `components/shared-chat/hub-fetch.ts`:

```ts
import type { SSEOutput, XRequestOptions } from '@ant-design/x-sdk'

import type { Turn } from '@/lib/chat/turn'
import { readRequestError } from '@/lib/http/browser'

import type { SharedChatInput } from './provider/ag-ui-chat-provider'

/** POST /api/apps/[appId]/runs (spec §4.2): the turn's event stream. */
export const runsUrl = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/runs`

/**
 * The documented XRequest `fetch` option ("Custom fetch", x-request skill and XRequestOptions), as the Dify chat's
 * createDifyFetch: XRequest hands over its RequestInit (the JSON body transformParams built, the abort signal), and a
 * non-OK answer becomes the hub envelope's RequestError, because XRequest's own fetch throws "Fetch failed with status
 * N" and drops the body (x-sdk 2.9.0 `es/x-request/x-fetch.js`; part2-x-mapping.md §1.6). The run route answers
 * `text/event-stream` (spec §4.4), which XRequest's SSE handler reads as it is.
 */
export const createHubFetch =
	(appId: string): NonNullable<XRequestOptions<SharedChatInput, SSEOutput, Turn>['fetch']> =>
	async (_baseURL, options) => {
		const init = (options ?? {}) as RequestInit
		const response = await fetch(runsUrl(appId), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: init.body,
			signal: init.signal ?? undefined,
		})
		if (!response.ok) throw await readRequestError(response)
		return response
	}
```

- [ ] **Step 5: Write the provider**

Create `components/shared-chat/provider/ag-ui-chat-provider.ts`:

```ts
import { AbstractChatProvider } from '@ant-design/x-sdk'
import type { ChatProviderConfig, SSEOutput, TransformMessage } from '@ant-design/x-sdk'
import type { BaseEvent, ResumeEntry } from '@ag-ui/core'

import {
	applyAgUiEvent,
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	userTurn,
	type HubRunValue,
	type Turn,
} from '@/lib/chat/turn'

/** The run route's body (spec §4.2), plus one client-only field that transformParams never sends. */
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
	answers?: { resume?: ResumeEntry[]; toolResults?: { toolCallId: string; content: string }[] }
	/** The turn answers continue (x-sdk `onReload`): kept for the reload's first chunk, never sent. */
	continues?: Turn
}

export interface AgUiChatProviderOptions {
	request: ChatProviderConfig<SharedChatInput, SSEOutput, Turn>['request']
	/** The server's id of this provider's conversation, once it has one (`hub:run`, or the list). */
	getConversationId: () => string | undefined
	/** The stream named its conversation and run (spec §4.4: `hub:run` comes first). */
	onRun: (value: HubRunValue) => void
	/** The agent's state after it changed (spec §4.4: the hub sends snapshots only). */
	onState: (state: unknown) => void
}

/** One AG-UI event as the run route sends it (spec §4.4): one JSON object per SSE `data:` line, with a string `type`. */
export type WireEvent = { type: string } & Record<string, unknown>

/**
 * XRequest's SSE parser hands each `data:` value as a string (x-sdk 2.9.0 `es/x-stream`); a keep-alive comment never
 * reaches here. Anything that is not one JSON object with a string `type` is no event (the shape `@ag-ui/client`'s
 * transport checks too, `src/transform/http.ts`).
 */
export const parseHubEvent = (data: unknown): WireEvent | null => {
	if (typeof data !== 'string' || !data.trim()) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(data)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	return typeof (parsed as { type?: unknown }).type === 'string' ? (parsed as WireEvent) : null
}

/**
 * The shared chat's x-sdk provider (spec §5.2; the `x-chat-provider` skill: only the three transforms, never a `request`
 * method, never a `status`). One X message per turn: `transformMessage` folds each AG-UI event into the turn with the
 * pure reducer `applyAgUiEvent`. The hub's server already ran `@ag-ui/client`'s compatibility boundary and folded the
 * deltas (spec §4.4), so the browser needs neither that client nor a JSON Patch library (spec §9).
 */
export class AgUiChatProvider extends AbstractChatProvider<Turn, SharedChatInput, SSEOutput> {
	private resumeBase: Turn | null = null
	private currentRunId: string | undefined
	private readonly getConversationId: () => string | undefined
	private readonly onRun: (value: HubRunValue) => void
	private readonly onState: (state: unknown) => void

	constructor({ request, getConversationId, onRun, onState }: AgUiChatProviderOptions) {
		super({ request })
		this.getConversationId = getConversationId
		this.onRun = onRun
		this.onState = onState
	}

	/** The run the stream on screen belongs to (spec §5.2: Stop names it), from `hub:run`. */
	get runId(): string | undefined {
		return this.currentRunId
	}

	transformParams(requestParams: Partial<SharedChatInput>): SharedChatInput {
		this.currentRunId = undefined
		// The SDK passes no originMessage on a reload's first chunk (part2-x-mapping.md §1.2); keep the turn to extend it.
		this.resumeBase = requestParams.continues ?? null
		const conversationId = this.getConversationId()
		const body: SharedChatInput = conversationId ? { conversationId } : {}
		if (requestParams.answers) body.answers = requestParams.answers
		else body.message = { text: requestParams.message?.text ?? '' }
		return body
	}

	transformLocalMessage(requestParams: Partial<SharedChatInput>): Turn | Turn[] {
		// Answers continue the turn on screen (x-sdk onReload discards local messages anyway).
		if (requestParams.answers) return []
		// The server mints the stored message's id; the page session's bubble has its own X id.
		return userTurn('local', requestParams.message?.text ?? '')
	}

	transformMessage(info: TransformMessage<Turn, SSEOutput>): Turn {
		const origin = info.originMessage ?? this.resumeBase ?? emptyAssistantTurn()
		const event = parseHubEvent(info.chunk?.data)
		if (!event) return origin
		if (event.type === 'CUSTOM' && event.name === HUB_RUN_EVENT) {
			const value = event.value as HubRunValue
			this.currentRunId = value.runId
			try {
				this.onRun(value)
			} catch {
				// Bookkeeping outside the turn must not end the stream (XRequest's catch would replace the bubble), the
				// Dify provider's rule.
			}
		} else if (event.type === 'STATE_SNAPSHOT') {
			try {
				this.onState(event.snapshot)
			} catch {
				// Same rule.
			}
		}
		// The wire is untyped JSON; the run route sent AG-UI events (spec §4.4), and the reducer narrows them by `type`.
		return applyAgUiEvent(origin, event as unknown as BaseEvent)
	}
}
```

- [ ] **Step 6: Write the pure helpers and the conversation items**

Create `components/shared-chat/hooks/chat-helpers.ts`:

```ts
import type { MessageInfo } from '@ant-design/x-sdk'
import type { Interrupt } from '@ag-ui/core'

import { prependOlder } from '@/components/chat/hooks/history-paging'
import { emptyAssistantTurn, type HistoryTurn, type Turn, type TurnRun } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

export type SendDecision = 'send' | 'queue' | 'ignore'

/**
 * One reply at a time per conversation, the rule useDifyChat documents (components/chat/hooks/use-dify-chat.ts
 * `sendDecision`): a send while a reply runs is ignored; while the history loads one send waits in the SDK's queue
 * (use-x-chat `queueRequest`) and further ones are ignored until its reply has started, since the SDK flushes the queue
 * at once in a `setTimeout`. Kept here rather than imported: that module's other imports start the Dify chat's
 * IndexedDB-persisted workflow store at load (plan call P11; the Dify one goes in Part 3).
 */
export const sendDecision = ({
	isRequesting,
	isDefaultMessagesRequesting,
	queued,
}: {
	isRequesting: boolean
	isDefaultMessagesRequesting: boolean
	queued: boolean
}): SendDecision => {
	if (isRequesting || queued) return 'ignore'
	return isDefaultMessagesRequesting ? 'queue' : 'send'
}

/**
 * Any failure as the error the shared chat keeps: the browser client's RequestError as it is, anything else (a network
 * failure) without text, with the original as `cause` (the Dify chat's `toDifyError` rule: no English from the wire).
 */
export const toRequestError = (error: unknown): RequestError => {
	if (error instanceof RequestError) return error
	const wrapped = new RequestError(0, undefined, '')
	wrapped.cause = error
	return wrapped
}

/** A history turn as useXChat holds it: finished, under the id the server gave it (plan call P9). */
export const toMessageInfo = ({ id, turn }: HistoryTurn): MessageInfo<Turn> => ({
	id,
	message: turn,
	status: 'success',
})

/**
 * useXChat's `requestFallback` (spec §5.2: it handles transport failures only). The turn keeps what streamed. A run
 * still running is closed: `cancelled` for an abort (the user left a stream the Stop route could not end), the failure
 * otherwise, and its running tool calls read `stopped` (plan call P10). A request that failed before any run (a refusal
 * in the hub's envelope, spec §4.3) becomes a run of its own with no id and the envelope's `code`; its English `message`
 * is never kept (charter §4.5: the view words every hub code). A turn whose last run had ended is left as it was.
 */
export const fallbackTurn = (error: Error, current: Turn | undefined): Turn => {
	const base = current ?? emptyAssistantTurn()
	const aborted = error.name === 'AbortError'
	const failure = { code: error instanceof RequestError ? error.code : undefined, message: '' }
	const last = base.runs.at(-1)
	if (last && last.outcome !== 'running') return base
	const closed: TurnRun = aborted
		? { runId: last?.runId ?? '', outcome: 'cancelled' }
		: { runId: last?.runId ?? '', outcome: 'error', error: failure }
	return {
		...base,
		parts: base.parts.map(part =>
			part.kind === 'tool' && part.status === 'running'
				? { ...part, status: 'stopped' as const }
				: part,
		),
		runs: last ? [...base.runs.slice(0, -1), closed] : [closed],
	}
}

/**
 * A retried first page goes above what was sent since the failure. The server stored those turns too, so a history
 * turn whose run is on screen is left out, with the user turn before it (a live user bubble has no stored id; its
 * answer's run ids match).
 */
export const prependLatestTurns = (
	current: MessageInfo<Turn>[],
	page: MessageInfo<Turn>[],
): MessageInfo<Turn>[] => {
	const shownRuns = new Set(
		current.flatMap(m => m.message.runs.map(run => run.runId)).filter(Boolean),
	)
	const shown = (turn: Turn) => turn.runs.some(run => shownRuns.has(run.runId))
	const kept: MessageInfo<Turn>[] = []
	for (let index = 0; index < page.length; index++) {
		const item = page[index]!
		const next = page[index + 1]
		if (
			item.message.role === 'user' &&
			next &&
			next.message.role === 'assistant' &&
			shown(next.message)
		) {
			index++
			continue
		}
		if (item.message.role === 'assistant' && shown(item.message)) continue
		kept.push(item)
	}
	return prependOlder(current, kept)
}

/** The open interrupts of the conversation: the last turn's, when it is an answer (spec §3.3). */
export const openInterruptsOf = (messages: readonly MessageInfo<Turn>[]): Interrupt[] => {
	const last = messages.at(-1)
	return last?.message.role === 'assistant' ? last.message.interrupts : []
}
```

Create `components/shared-chat/conversations.ts`:

```ts
import type { ConversationData } from '@ant-design/x-sdk'

import { groupFor, type ConversationGroup } from '@/components/chat/provider/conversations'
import type { ConversationListItem } from '@/lib/data/conversations'

import { conversationKeyFor, parseConversationKey } from './keys'

/** A sidebar item (spec §5.1): a client key, the server's id once the conversation has one, and its date group. */
export interface SharedConversationItem extends ConversationData {
	key: string
	label: string
	conversationId?: string
	/** Unix seconds, as `groupFor` reads them. */
	updatedAt: number
	group: ConversationGroup
}

/** An item of GET conversations; an untitled conversation reads as the localised "New conversation" (spec §3.1). */
export const toConversationItem = (
	appId: string,
	item: ConversationListItem,
	nowMs: number,
	defaultLabel: string,
): SharedConversationItem => {
	const updatedAt = Math.floor(Date.parse(item.updatedAt) / 1000)
	return {
		key: conversationKeyFor(appId, item.id),
		label: item.title || defaultLabel,
		conversationId: item.id,
		updatedAt,
		group: groupFor(updatedAt, nowMs),
	}
}

/** Groups are relative to now: recomputed on every refresh, so a list left open past midnight relabels. */
export const regroup = (items: SharedConversationItem[], nowMs: number): SharedConversationItem[] =>
	items.map(item => ({ ...item, group: groupFor(item.updatedAt, nowMs) }))

export const isUnsentTemp = (item: SharedConversationItem) =>
	parseConversationKey(item.key).temp && !item.conversationId

/**
 * The server's list without changing client keys (the Dify chat's `mergeServerList` rule, for the shared item): unsent
 * new chats stay on top; a chat that got its id this page session keeps its temporary key (its x-sdk store is bound to
 * it) and takes the server's title; the active conversation keeps its place when the page does not list it.
 */
export const mergeConversations = (
	current: SharedConversationItem[],
	server: SharedConversationItem[],
	{ activeKey }: { activeKey?: string } = {},
): SharedConversationItem[] => {
	const unsent = current.filter(isUnsentTemp)
	const byId = new Map<string, SharedConversationItem>()
	for (const item of current) if (item.conversationId) byId.set(item.conversationId, item)
	const merged = server.map(item => {
		const known = item.conversationId ? byId.get(item.conversationId) : undefined
		return known ? { ...item, key: known.key } : item
	})
	const result = [...unsent, ...merged]
	const activeIndex = activeKey ? current.findIndex(item => item.key === activeKey) : -1
	if (activeIndex !== -1 && !result.some(item => item.key === activeKey)) {
		result.splice(Math.min(activeIndex, result.length), 0, current[activeIndex]!)
	}
	return result
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts` Expected: PASS, `Test Files  4 passed (4)`.

- [ ] **Step 8: Write the two hooks**

Create `components/shared-chat/hooks/use-shared-chat.ts`:

```ts
import { useXChat, XRequest, type SSEOutput } from '@ant-design/x-sdk'
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'

import { prependOlder } from '@/components/chat/hooks/history-paging'
import { emptyAssistantTurn, type HubRunValue, type Turn } from '@/lib/chat/turn'
import type { RequestError } from '@/lib/http/browser'

import type { SharedChatApi } from '../api'
import { createHubFetch, runsUrl } from '../hub-fetch'
import { parseConversationKey } from '../keys'
import { AgUiChatProvider, type SharedChatInput } from '../provider/ag-ui-chat-provider'
import { getProvider } from '../provider-cache'
import {
	fallbackTurn,
	openInterruptsOf,
	prependLatestTurns,
	sendDecision,
	toMessageInfo,
	toRequestError,
} from './chat-helpers'

interface Options {
	appId: string
	/** The client conversation key, or '' while there is none yet (the list is still loading). */
	conversationKey: string
	api: SharedChatApi
	/** The server's id of the conversation on screen, if it has one (the list holds it). */
	getConversationId: () => string | undefined
	/** A stream of `key` named its conversation and run (`hub:run`), whichever conversation is on screen by then. */
	onRun?: (key: string, value: HubRunValue) => void
}

// Per conversation key and module-global, like the SDK's message store they serve (use-x-chat: defaultMessages runs
// once per key per page session), so a remounted chat keeps them; read through useSyncExternalStore (React reference),
// as useDifyChat's side store.
/** "Load earlier" cursor per key (plan call P8); null once nothing is older. */
const cursors = new Map<string, string | null>()
/** The failed first history load per key. */
const historyErrors = new Map<string, RequestError>()
/** The agent's state per key (spec §5.2: the side store holds it; 2b's plan panel reads it). */
const states = new Map<string, unknown>()
const listeners = new Set<() => void>()
const notify = () => {
	for (const listener of listeners) listener()
}
const setCursor = (key: string, cursor: string | null) => {
	cursors.set(key, cursor)
	notify()
}
const setHistoryError = (key: string, error: RequestError | undefined) => {
	if (error) historyErrors.set(key, error)
	else historyErrors.delete(key)
	notify()
}
const setStateOf = (key: string, state: unknown) => {
	states.set(key, state)
	notify()
}
const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
/** Keys with a page on the way (a second click asks for nothing). */
const pagesInFlight = new Set<string>()
/** The latest `getConversationId` given for each key; the key's cached provider reads it at send time. */
const conversationIdReaders = new Map<string, () => string | undefined>()
/** The latest `onRun` given for each key; the key's cached provider calls it from its stream. */
const runSinks = new Map<string, (key: string, value: HubRunValue) => void>()

/** The latest page of a conversation (its first load, or a retry of it); sets the key's cursor and state. */
const loadLatestPage = async (api: SharedChatApi, key: string, conversationId: string) => {
	const page = await api.getConversation(conversationId)
	setCursor(key, page.cursor)
	setStateOf(key, page.state)
	return page.turns.map(toMessageInfo)
}

/**
 * useXChat for one shared-chat conversation (spec §5.2, built like useDifyChat): the key is the client conversation
 * key; the history is the SDK's async `defaultMessages` (the server's turns, spec §3.3); a send during that load is
 * queued (`queueRequest`); the per-key provider keeps a stream bound to the conversation it started in; Stop asks the
 * hub's stop route to end the run in place (spec §4.5) and aborts the fetch only when that request fails.
 */
export const useSharedChat = ({
	appId,
	conversationKey,
	api,
	getConversationId,
	onRun,
}: Options) => {
	// No provider (useXChat's `provider` is optional) and no key until there is a conversation: nothing is cached for a
	// placeholder key, and a send without one is ignored.
	const provider = !conversationKey
		? undefined
		: getProvider(
				conversationKey,
				() =>
					new AgUiChatProvider({
						request: XRequest<SharedChatInput, SSEOutput, Turn>(runsUrl(appId), {
							manual: true,
							fetch: createHubFetch(appId),
						}),
						getConversationId: () => conversationIdReaders.get(conversationKey)?.(),
						onRun: value => runSinks.get(conversationKey)?.(conversationKey, value),
						onState: state => setStateOf(conversationKey, state),
					}),
			)

	const chat = useXChat<Turn, Turn, SharedChatInput, SSEOutput>({
		provider,
		conversationKey: conversationKey || undefined,
		defaultMessages: async ({ conversationKey: key = conversationKey }) => {
			const { conversationId, temp } = parseConversationKey(key)
			if (temp || !conversationId) return []
			try {
				return await loadLatestPage(api, key, conversationId)
			} catch (error) {
				// A failed load must not look like an empty conversation: the store starts empty (the SDK would do the same
				// and only log), and the view shows this error with a retry.
				setHistoryError(key, toRequestError(error))
				return []
			}
		},
		// Answers continue the turn on screen, which stays visible while the continuation connects (spec §5.2).
		requestPlaceholder: params => params.continues ?? emptyAssistantTurn(),
		// The SDK passes the request's params (use-x-chat API: requestFallback), so the continued turn is known here.
		requestFallback: (params, { error, messageInfo }) =>
			fallbackTurn(error, messageInfo?.message ?? params.continues),
	})

	// The callbacks below stay stable and read the committed render's values here (React: refs are written in effects,
	// not during rendering).
	const latest = useRef({ chat, provider, conversationKey, api })
	useLayoutEffect(() => {
		latest.current = { chat, provider, conversationKey, api }
		if (!conversationKey) return
		conversationIdReaders.set(conversationKey, getConversationId)
		if (onRun) runSinks.set(conversationKey, onRun)
	})

	// Keys with a send waiting in the SDK's queue, per hook instance like that queue (useDifyChat's rule): the ref
	// answers `send` at once, the state renders the view's guard.
	const queuedRef = useRef(new Set<string>())
	const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
	useEffect(() => {
		if (!chat.isRequesting || !queuedRef.current.has(conversationKey)) return
		queuedRef.current.delete(conversationKey)
		setQueuedKeys(new Set(queuedRef.current))
	}, [chat.isRequesting, conversationKey])

	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback((text: string) => {
		const { chat, conversationKey: key } = latest.current
		if (!key) return false
		const decision = sendDecision({
			isRequesting: chat.isRequesting,
			isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
			queued: queuedRef.current.has(key),
		})
		if (decision === 'ignore') return false
		const request: Partial<SharedChatInput> = { message: { text } }
		if (decision === 'queue') {
			queuedRef.current.add(key)
			setQueuedKeys(new Set(queuedRef.current))
			chat.queueRequest(key, request)
		} else chat.onRequest(request)
		return true
	}, [])

	/**
	 * Spec §4.5 and §5.2: the hub's stop route aborts the agent and ends the stream with `RUN_FINISHED` cancelled, so the
	 * turn finishes in place ("Stopped"). Only when there is no run to name yet, or that request fails, is the fetch
	 * aborted (XRequest's abort; the turn then moves to the end, ADR-0017's note, and the server stores it truncated).
	 */
	const stop = useCallback(async () => {
		const { chat, provider: current, conversationKey: key, api: client } = latest.current
		if (!chat.isRequesting) return
		const runId = current?.runId
		const conversationId =
			conversationIdReaders.get(key)?.() ?? parseConversationKey(key).conversationId
		if (runId && conversationId) {
			try {
				await client.stopRun(conversationId, runId)
				return
			} catch {
				// Falls through: the stream is closed from this side instead.
			}
		}
		// XRequest's abort() reads an AbortController that exists only once a request has run (useDifyChat's guard).
		if (latest.current.chat.isRequesting) latest.current.chat.abort()
	}, [])

	/** Prepends the next older page (plan call P8); rejects with a RequestError. */
	const loadEarlier = useCallback(async () => {
		const { chat, conversationKey: key, api: client } = latest.current
		const { conversationId } = parseConversationKey(key)
		const cursor = cursors.get(key)
		if (!conversationId || !cursor || pagesInFlight.has(key)) return
		// Taken now: this key's store, even if the user switches conversation while the page loads.
		const { setMessages } = chat
		pagesInFlight.add(key)
		try {
			const page = await client.getConversation(conversationId, cursor)
			setCursor(key, page.cursor)
			setMessages(previous => prependOlder(previous, page.turns.map(toMessageInfo)))
		} catch (error) {
			throw toRequestError(error)
		} finally {
			pagesInFlight.delete(key)
		}
	}, [])

	/** Loads the latest page again after a failed first load; what was sent since stays below it (prependLatestTurns). */
	const retryHistory = useCallback(async () => {
		const { chat, conversationKey: key, api: client } = latest.current
		const { conversationId } = parseConversationKey(key)
		if (!conversationId || pagesInFlight.has(key)) return
		const { setMessages } = chat
		pagesInFlight.add(key)
		setHistoryError(key, undefined)
		try {
			const loaded = await loadLatestPage(client, key, conversationId)
			setMessages(previous => prependLatestTurns(previous, loaded))
		} catch (error) {
			setHistoryError(key, toRequestError(error))
		} finally {
			pagesInFlight.delete(key)
		}
	}, [])

	const hasMore = useSyncExternalStore(
		subscribe,
		() => Boolean(cursors.get(conversationKey)),
		() => false,
	)
	const historyError = useSyncExternalStore(
		subscribe,
		() => historyErrors.get(conversationKey),
		() => undefined,
	)
	const state = useSyncExternalStore(
		subscribe,
		() => states.get(conversationKey),
		() => undefined,
	)
	const openInterrupts = useMemo(() => openInterruptsOf(chat.messages), [chat.messages])

	return {
		messages: chat.messages,
		isRequesting: chat.isRequesting,
		isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
		/** A send waits in the SDK's queue for this conversation's history; its reply has not started yet. */
		queued: queuedKeys.has(conversationKey),
		send,
		stop,
		loadEarlier,
		hasMore,
		historyError,
		retryHistory,
		/** The agent's last state (spec §5.2); 2b's plan panel reads it. */
		state,
		/** The last turn's open interrupts (spec §3.3); while any is open the Sender is disabled (plan call P3). */
		openInterrupts,
	}
}
```

Create `components/shared-chat/hooks/use-shared-conversations.ts`:

```ts
import { useXConversations } from '@ant-design/x-sdk'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deleteConversationAction, renameConversationAction } from '@/app/(user)/chat/actions'
import { RequestError } from '@/lib/http/browser'

import type { SharedChatApi } from '../api'
import {
	isUnsentTemp,
	mergeConversations,
	regroup,
	toConversationItem,
	type SharedConversationItem,
} from '../conversations'
import { conversationKeyFor, newTempConversationKey, parseConversationKey } from '../keys'
import { toRequestError } from './chat-helpers'

interface Options {
	appId: string
	api: SharedChatApi
	/** `?isNewCvst=1`: start on a new conversation instead of the latest one (the Dify chat's link parameter). */
	startNew?: boolean
}

/**
 * The sidebar list and the active key on useXConversations (x-sdk), fed from GET conversations (spec §4.2), the shape of
 * the Dify chat's useConversations. Rename and delete are Server Actions (spec §4.2: the hub's own data, ADR-0024); a
 * refusal rejects with a RequestError carrying the action's code, so `useConversationMenu` keeps its modal open.
 */
export const useSharedConversations = ({ appId, api, startNew = false }: Options) => {
	const { t } = useTranslation()
	// The store's methods are stable (one store per mount, x-sdk x-conversations).
	const {
		conversations: items,
		activeConversationKey: activeKey,
		setActiveConversationKey,
		addConversation,
		removeConversation,
		setConversation,
		getConversation,
		setConversations,
	} = useXConversations({ defaultConversations: [], defaultActiveConversationKey: '' })
	const conversations = items as SharedConversationItem[]
	const [loading, setLoading] = useState(true)
	/** The last failed load. */
	const [error, setError] = useState<RequestError | null>(null)

	// Read by the callbacks after an await (React: refs are written in effects, not during rendering).
	const latest = useRef({ appId, api, t, startNew, conversations, activeKey })
	useLayoutEffect(() => {
		latest.current = { appId, api, t, startNew, conversations, activeKey }
	})

	const itemOf = useCallback(
		(key: string) => getConversation(key) as SharedConversationItem | undefined,
		[getConversation],
	)

	/** A new chat on top, made active; at most one unsent one exists (the Dify chat's rule), which is reused. */
	const createTemp = useCallback(() => {
		// Checked against the store itself: the rendered list may still hold a temp just removed.
		const existing = latest.current.conversations
			.map(item => itemOf(item.key))
			.find(item => item !== undefined && isUnsentTemp(item))
		if (existing) {
			setActiveConversationKey(existing.key)
			return existing.key
		}
		const key = newTempConversationKey(appId)
		const item: SharedConversationItem = {
			key,
			label: latest.current.t('chat.default_conversation_name'),
			updatedAt: Math.floor(Date.now() / 1000),
			group: 'today',
		}
		addConversation(item, 'prepend')
		setActiveConversationKey(key)
		return key
	}, [addConversation, appId, itemOf, setActiveConversationKey])

	/** Reloads the list and merges it without changing client keys. Never rejects: a failure is kept in `error`. */
	const refresh = useCallback(async (): Promise<SharedConversationItem[] | null> => {
		try {
			const page = await latest.current.api.listConversations()
			// An answer for an app the page has since left changes nothing.
			if (latest.current.appId !== appId) return null
			const now = Date.now()
			const label = latest.current.t('chat.default_conversation_name')
			const server = page.items.map(item => toConversationItem(appId, item, now, label))
			const current = latest.current.conversations.filter(
				item => parseConversationKey(item.key).appId === appId,
			)
			const merged = regroup(
				mergeConversations(current, server, { activeKey: latest.current.activeKey }),
				now,
			)
			setConversations(merged)
			setError(null)
			return merged
		} catch (e) {
			if (latest.current.appId === appId) setError(toRequestError(e))
			return null
		}
	}, [appId, setConversations])

	// The list is loaded once per app; refresh() is called explicitly afterwards.
	useEffect(() => {
		let cancelled = false
		setConversations([])
		setActiveConversationKey('')
		setLoading(true)
		void refresh().then(list => {
			if (cancelled) return
			// Without a list (or with ?isNewCvst=1) the page still opens on a chat it can send to.
			if (latest.current.startNew || !list?.length) createTemp()
			else setActiveConversationKey(list[0]!.key)
			setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [appId, createTemp, refresh, setActiveConversationKey, setConversations])

	const getConversationId = useCallback((key: string) => itemOf(key)?.conversationId, [itemOf])

	/**
	 * A new chat's first stream named its conversation (`hub:run`, spec §4.4); the key stays (ADR-0017). A refresh that
	 * ran before listed it under its server key: that twin goes, because this key holds the live message store.
	 */
	const markConversation = useCallback(
		(key: string, conversationId: string, title: string) => {
			const known = itemOf(key)
			if (!known || known.conversationId === conversationId) return
			setConversation(key, { key, conversationId, ...(title ? { label: title } : {}) })
			const twin = conversationKeyFor(appId, conversationId)
			if (twin === key || !itemOf(twin)) return
			removeConversation(twin)
			if (latest.current.activeKey === twin) setActiveConversationKey(key)
		},
		[appId, itemOf, removeConversation, setActiveConversationKey, setConversation],
	)

	/** Renames on the hub, then locally; rejects with a RequestError and keeps the label on a refusal. */
	const rename = useCallback(
		async (key: string, name: string) => {
			const conversationId = getConversationId(key)
			if (conversationId) {
				const result = await renameConversationAction(latest.current.appId, conversationId, name)
				if (!result.ok) throw new RequestError(0, result.code, '')
			}
			setConversation(key, { key, label: name })
		},
		[getConversationId, setConversation],
	)

	/** Deletes on the hub (a soft delete, spec §3.4), then locally, activating the next conversation. */
	const remove = useCallback(
		async (key: string) => {
			const conversationId = getConversationId(key)
			if (conversationId) {
				const result = await deleteConversationAction(latest.current.appId, conversationId)
				if (!result.ok) throw new RequestError(0, result.code, '')
			}
			const { conversations: current, activeKey: active } = latest.current
			removeConversation(key)
			if (active !== key) return
			const rest = current.filter(item => item.key !== key)
			if (rest.length) setActiveConversationKey(rest[0]!.key)
			else createTemp()
		},
		[createTemp, getConversationId, removeConversation, setActiveConversationKey],
	)

	/** A chat the server has not stored yet has nothing to rename (useConversationMenu offers delete only). */
	const canRename = useCallback(
		(key: string) => Boolean(getConversationId(key)),
		[getConversationId],
	)

	return {
		conversations,
		activeKey,
		setActiveKey: setActiveConversationKey,
		loading,
		error,
		createTemp,
		markConversation,
		rename,
		remove,
		refresh,
		getConversationId,
		canRename,
		hasEmptyTemp: conversations.some(isUnsentTemp),
	}
}
```

- [ ] **Step 9: Run the gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts
pnpm exec oxfmt --check components/shared-chat __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts
pnpm test
grep -rn "from '@ag-ui/core'" components/shared-chat | grep -v "import type" || echo "types only"
```

Expected: tsc exits 0 (Task 12's actions and Task 8's `lib/chat/turn.ts` exist); oxlint 0 errors; oxfmt reports no file (run `pnpm exec oxfmt <files>` first if it does); `pnpm test` passes; the grep prints `types only`. Nothing renders these modules yet (Task 16), so no e2e run here.

- [ ] **Step 10: Commit**

```bash
git add components/shared-chat __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts
git commit -m "feat(shared-chat): the browser data layer on useXChat and AgUiChatProvider

Keys, the provider cache, the browser client of the read and stop routes,
XRequest's fetch, the provider over applyAgUiEvent, useSharedChat and
useSharedConversations (spec §5.2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["components/shared-chat/keys.ts", "components/shared-chat/provider-cache.ts", "components/shared-chat/api.ts", "components/shared-chat/hub-fetch.ts", "components/shared-chat/conversations.ts", "components/shared-chat/provider/ag-ui-chat-provider.ts", "components/shared-chat/hooks/chat-helpers.ts", "components/shared-chat/hooks/use-shared-chat.ts", "components/shared-chat/hooks/use-shared-conversations.ts", "__tests__/shared-chat-keys.test.ts", "__tests__/shared-chat-provider.test.ts", "__tests__/shared-chat-helpers.test.ts", "__tests__/shared-chat-conversations.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-keys.test.ts __tests__/shared-chat-provider.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-conversations.test.ts", "acceptanceCriteria": ["The four test files pass (0 failed)", "transformParams sends { conversationId, message } or { message } for a new chat, answers without a message, never `continues`", "hub:run calls onRun and sets provider.runId; STATE_SNAPSHOT calls onState; a non-event chunk returns the origin", "A reload's first chunk continues the `continues` turn", "fallbackTurn: abort closes a running run as cancelled with running tools stopped; a refused request is a runId '' run with the envelope code and an empty message; an ended turn is unchanged", "components/shared-chat imports @ag-ui/core with `import type` only", "tsc and pnpm test pass"], "modelTier": "standard"}
```

---

### Task 16: The shared chat view

**Goal:** An AG-UI app's chat page renders the shared chat: the Dify chat's shell, sider, drawer and column around a turn list where each answer shows its reasoning (X `Think`), its text (`MessageMarkdown`), its tool calls (X `ThoughtChain` cards with `CodeHighlighter`), its run errors (antd `Alert`) and "Stopped" or "Stopped: time limit", with Copy in X `Actions`; X `Welcome` on an empty conversation; the X Sender with Stop, disabled while an answer is pending (plan call P3). `ProviderChat`'s `'agui'` case renders it.

Spec §5.1 (what is reused), §5.3 (the table of parts and what surrounds the turns), §8 (every code worded in en, zh and ar), plan calls P3, P10, P11, P12. Docs checked before writing: the `x-components` skill and X 2.9.0 typings (`Bubble.List` `role` with `contentRender`/`footer`, `ThoughtChain` items `{ key, title, description, status: 'loading' | 'success' | 'error' | 'abort', collapsible, blink, content }` (`es/thought-chain/{interface,Status}.d.ts`), `CodeHighlighter` `lang`, `highlightProps` (`es/code-highlighter/interface.d.ts`), `Welcome` `variant`, `icon`, `title`, `description` (`es/welcome/index.d.ts`), `Actions` items with `actionRender` and `Actions.Copy` `text` (`es/actions/{interface,ActionsCopy}.d.ts`)), and antd 6.6.5 through the CLI (`npx -y @ant-design/cli info Alert --version 6.6.5`: `type`, `showIcon`, `title`, `description`; `Typography.Text type="secondary"`; `Flex` `vertical`, `gap`; `Skeleton`). The frontend rules (`.claude/rules/frontend.md`, `docs/frontend-conventions.md`): no new CSS (the column's CSS Module and the user bubble's are reused as they are), no hex, icon-only buttons named by keys.

**Depends on:** Task 8 (`lib/chat/turn.ts`), Task 14 (`ChatAppInfoContext`, `ConversationListItem`, `useConversationMenu({ canRename })`), Task 15 (the hooks), Task 4 (P12's `AppUnavailable` case this task replaces).

**Files:**

- Create: `components/shared-chat/run-error.ts`
- Create: `components/shared-chat/turn-parts.ts`
- Create: `components/shared-chat/bubble-items.ts`
- Create: `components/shared-chat/tool-chain.tsx`
- Create: `components/shared-chat/user-turn.tsx`
- Create: `components/shared-chat/assistant-turn.tsx`
- Create: `components/shared-chat/turn-footer.tsx`
- Create: `components/shared-chat/turn-list.tsx`
- Create: `components/shared-chat/shared-welcome.tsx`
- Create: `components/shared-chat/shared-chat.tsx`
- Modify: `components/provider-ui/provider-chat.tsx` (the whole file, below)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (a new top-level `shared_chat` area)
- Test: `__tests__/shared-chat-view.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts __tests__/i18n-locales.test.ts` reports every case passed.
- [ ] `runErrorView` gives each of the agent's five codes (`usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`) its own title and the agent's message as the description; each hub code of spec §8 (`agent_auth_failed`, `agent_not_found`, `agent_rejected_input`, `provider_unreachable`, `upstream_error`, `conversation_not_found`, `run_in_progress`, `answer_pending`, `answers_invalid`, plus `unauthorized`, `forbidden`, `app_not_found`, `app_disabled`) its title and no description; any other code, or none, the generic title with the message; every key it names exists in `locales/en/translation.json`.
- [ ] `stoppedCaptionKey` answers `chat.stopped` for a last run `cancelled` or `truncated`, `shared_chat.stopped_time_limit` when its `cancelledReason` is `run_timeout`, nothing otherwise.
- [ ] `groupParts` keeps arrival order and puts consecutive tool parts into one group (spec §5.3: "consecutive calls in one chain").
- [ ] `components/provider-ui/provider-chat.tsx` renders `<SharedChat app={app} />` for `'agui'` and no longer imports `AppUnavailable`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the changed files pass; `npx -y @ant-design/cli lint ./` reports no more findings than before this task (`docs/frontend-conventions.md` "Lint baseline").
- [ ] `pnpm exec playwright test e2e/chat.spec.ts --project desktop-light` still passes (the reused Dify pieces are untouched by this task; a sanity run before Task 17's full suite).

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/shared-chat-view.test.ts`:

```ts
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { toBubbleItems } from '@/components/shared-chat/bubble-items'
import {
	AGENT_ERROR_CODES,
	HUB_ERROR_CODES,
	requestFailureText,
	runErrorView,
	stoppedCaptionKey,
} from '@/components/shared-chat/run-error'
import { groupParts, inputHint, prettyJson } from '@/components/shared-chat/turn-parts'
import { emptyAssistantTurn, userTurn, type Turn, type TurnPart } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'
import en from '@/locales/en/translation.json'

const t = ((key: string) => `t:${key}`) as unknown as TFunction

/** A dotted key's value in the English file, or undefined. */
const english = (key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

describe('runErrorView (spec §5.3, §8)', () => {
	it.each([...AGENT_ERROR_CODES])('titles the agent code %s and shows its message', code => {
		expect(runErrorView({ code, message: 'Safe to show.' })).toEqual({
			titleKey: `shared_chat.error.${code}`,
			description: 'Safe to show.',
		})
	})
	it.each([...HUB_ERROR_CODES])('titles the hub code %s and never shows its text', code => {
		const view = runErrorView({ code, message: 'English from the hub' })
		expect(view.description).toBeUndefined()
		expect(english(view.titleKey)).toEqual(expect.any(String))
	})
	it('gives any other code, or none, the generic title with the message', () => {
		expect(runErrorView({ code: 'quota_gone', message: 'Out of credits.' })).toEqual({
			titleKey: 'shared_chat.error.generic',
			description: 'Out of credits.',
		})
		expect(runErrorView({ message: '' })).toEqual({
			titleKey: 'shared_chat.error.generic',
			description: undefined,
		})
	})
	it('names only keys the English file has', () => {
		for (const code of [...AGENT_ERROR_CODES, ...HUB_ERROR_CODES, 'other'])
			expect(english(runErrorView({ code, message: '' }).titleKey)).toEqual(expect.any(String))
	})
})

describe('requestFailureText', () => {
	it('words a hub code and falls back for anything else', () => {
		expect(
			requestFailureText(new RequestError(404, 'conversation_not_found', 'x'), t, 'fallback'),
		).toBe('t:shared_chat.error.conversation_not_found')
		expect(requestFailureText(new RequestError(500, 'internal_error', 'x'), t, 'fallback')).toBe(
			'fallback',
		)
		expect(requestFailureText(new TypeError('Failed to fetch'), t)).toBe('')
	})
})

describe('stoppedCaptionKey', () => {
	const ended = (run: Turn['runs'][number]): Turn => ({ ...emptyAssistantTurn(), runs: [run] })
	it('says Stopped for a cancelled or truncated last run, and the time limit when the agent hit it', () => {
		expect(stoppedCaptionKey(ended({ runId: 'r1', outcome: 'cancelled' }))).toBe('chat.stopped')
		expect(stoppedCaptionKey(ended({ runId: 'r1', outcome: 'truncated' }))).toBe('chat.stopped')
		expect(
			stoppedCaptionKey(
				ended({ runId: 'r1', outcome: 'cancelled', cancelledReason: 'run_timeout' }),
			),
		).toBe('shared_chat.stopped_time_limit')
	})
	it('says nothing for a finished, failed, interrupted or running run', () => {
		for (const outcome of ['success', 'error', 'interrupt', 'running'] as const)
			expect(stoppedCaptionKey(ended({ runId: 'r1', outcome }))).toBeUndefined()
		expect(stoppedCaptionKey(emptyAssistantTurn())).toBeUndefined()
	})
})

describe('turn parts', () => {
	const tool = (id: string): TurnPart => ({
		kind: 'tool',
		toolCallId: id,
		name: 'search',
		args: '{}',
		status: 'done',
	})
	it('groups consecutive tool calls into one chain and keeps arrival order', () => {
		const text: TurnPart = { kind: 'text', messageId: 'm1', text: 'Looking.' }
		const after: TurnPart = { kind: 'text', messageId: 'm2', text: 'Found it.' }
		expect(groupParts([text, tool('c1'), tool('c2'), after, tool('c3')])).toEqual([
			text,
			{ kind: 'tools', key: 'c1', tools: [tool('c1'), tool('c2')] },
			after,
			{ kind: 'tools', key: 'c3', tools: [tool('c3')] },
		])
	})
	it('hints at the input on one line, at most 60 characters', () => {
		expect(inputHint('{\n  "city": "Paris"\n}')).toBe('{ "city": "Paris" }')
		expect(inputHint('x'.repeat(70))).toBe(`${'x'.repeat(60)}…`)
	})
	it('pretty-prints JSON and keeps any other text', () => {
		expect(prettyJson('{"city":"Paris"}')).toBe('{\n  "city": "Paris"\n}')
		expect(prettyJson('{"city":')).toBe('{"city":')
		expect(prettyJson('18 °C')).toBe('18 °C')
	})
})

describe('toBubbleItems', () => {
	it('shows the loading dots only for an empty placeholder and streams while updating', () => {
		const answer: Turn = {
			...emptyAssistantTurn(),
			parts: [{ kind: 'text', messageId: 'm1', text: 'Hi' }],
		}
		expect(
			toBubbleItems([
				{ id: 'u', message: userTurn('local', 'hi'), status: 'local' },
				{ id: 'a', message: emptyAssistantTurn(), status: 'loading' },
				{ id: 'b', message: answer, status: 'updating' },
			]),
		).toEqual([
			{
				key: 'u',
				role: 'user',
				content: userTurn('local', 'hi'),
				loading: false,
				streaming: false,
				status: 'local',
			},
			{
				key: 'a',
				role: 'assistant',
				content: emptyAssistantTurn(),
				loading: true,
				streaming: false,
				status: 'loading',
			},
			{
				key: 'b',
				role: 'assistant',
				content: answer,
				loading: false,
				streaming: true,
				status: 'updating',
			},
		])
	})
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts` Expected: FAIL: `Failed to resolve import "@/components/shared-chat/bubble-items"`.

- [ ] **Step 3: Add the locale keys**

In each of `locales/en/translation.json`, `locales/zh/translation.json` and `locales/ar/translation.json`, add a `shared_chat` area as the last top-level key (after the area that is last now; mind the comma on the line before). The texts reuse existing keys where the meaning is the same (`chat.stopped`, `chat.history_load_failed`, `chat.retry`, `chat.default_conversation_name`, `chat.send_placeholder`, the `chat.error_*` keys of the hub's own access codes, `message.reasoning_title`), so only these are new.

`locales/en/translation.json`:

```json
	"shared_chat": {
		"stopped_time_limit": "Stopped: time limit",
		"answer_pending_hint": "This conversation waits for an answer this chat cannot show yet. Start a new conversation to go on.",
		"tool_arguments": "Arguments",
		"tool_result": "Result",
		"error": {
			"usage_limit": "Usage limit reached",
			"rate_limited": "Too many requests, try again shortly",
			"busy": "The agent is busy, try again shortly",
			"model_unavailable": "The model is unavailable",
			"agent_error": "The agent ran into an error",
			"generic": "The agent could not answer",
			"agent_auth_failed": "The agent refused the hub's credentials",
			"agent_not_found": "The agent was not found",
			"agent_rejected_input": "The agent refused the request",
			"provider_unreachable": "The agent is restarting, try again",
			"upstream_error": "The agent's answer could not be read",
			"conversation_not_found": "This conversation no longer exists",
			"run_in_progress": "An answer is still running in this conversation",
			"answer_pending": "This conversation waits for an answer first",
			"answers_invalid": "The answers do not match the open questions"
		}
	}
```

`locales/zh/translation.json`:

```json
	"shared_chat": {
		"stopped_time_limit": "已停止：达到时间限制",
		"answer_pending_hint": "此对话正在等待一个本聊天暂时无法显示的回答。请新建对话继续。",
		"tool_arguments": "参数",
		"tool_result": "结果",
		"error": {
			"usage_limit": "已达到使用上限",
			"rate_limited": "请求过于频繁，请稍后再试",
			"busy": "智能体正忙，请稍后再试",
			"model_unavailable": "模型不可用",
			"agent_error": "智能体出错",
			"generic": "智能体无法回答",
			"agent_auth_failed": "智能体拒绝了平台的凭据",
			"agent_not_found": "未找到该智能体",
			"agent_rejected_input": "智能体拒绝了该请求",
			"provider_unreachable": "智能体正在重启，请重试",
			"upstream_error": "无法读取智能体的回答",
			"conversation_not_found": "此对话已不存在",
			"run_in_progress": "此对话中仍有回答正在生成",
			"answer_pending": "此对话需要先得到回答",
			"answers_invalid": "回答与待处理的问题不匹配"
		}
	}
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005):

```json
	"shared_chat": {
		"stopped_time_limit": "توقّف: انتهت المهلة الزمنية",
		"answer_pending_hint": "تنتظر هذه المحادثة إجابةً لا يمكن لهذه الدردشة عرضها بعد. ابدأ محادثة جديدة للمتابعة.",
		"tool_arguments": "المُدخلات",
		"tool_result": "النتيجة",
		"error": {
			"usage_limit": "تم بلوغ حدّ الاستخدام",
			"rate_limited": "طلبات كثيرة جدًا، حاول مرة أخرى بعد قليل",
			"busy": "الوكيل مشغول، حاول مرة أخرى بعد قليل",
			"model_unavailable": "النموذج غير متاح",
			"agent_error": "واجه الوكيل خطأً",
			"generic": "تعذّر على الوكيل الإجابة",
			"agent_auth_failed": "رفض الوكيل بيانات اعتماد المنصة",
			"agent_not_found": "لم يُعثر على الوكيل",
			"agent_rejected_input": "رفض الوكيل الطلب",
			"provider_unreachable": "يُعاد تشغيل الوكيل، حاول مرة أخرى",
			"upstream_error": "تعذّرت قراءة إجابة الوكيل",
			"conversation_not_found": "لم تعد هذه المحادثة موجودة",
			"run_in_progress": "لا تزال إجابة قيد التنفيذ في هذه المحادثة",
			"answer_pending": "تنتظر هذه المحادثة إجابةً أولًا",
			"answers_invalid": "لا تطابق الإجابات الأسئلة المفتوحة"
		}
	}
```

These wordings join the owner's review list (zh and ar), as Part 1's did. `e2e/` holds none of the new strings yet (nothing changed, only added).

- [ ] **Step 4: Write the pure modules**

Create `components/shared-chat/run-error.ts`:

```ts
import type { TFunction } from 'i18next'

import type { Turn } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

/** The agent's in-stream RUN_ERROR codes (spec §2.3): a title each; the agent's message is safe to show (the owner). */
export const AGENT_ERROR_CODES = [
	'usage_limit',
	'rate_limited',
	'busy',
	'model_unavailable',
	'agent_error',
] as const

const AGENT_CODE_KEYS = {
	usage_limit: 'shared_chat.error.usage_limit',
	rate_limited: 'shared_chat.error.rate_limited',
	busy: 'shared_chat.error.busy',
	model_unavailable: 'shared_chat.error.model_unavailable',
	agent_error: 'shared_chat.error.agent_error',
} as const satisfies Record<(typeof AGENT_ERROR_CODES)[number], string>

/**
 * The hub's own codes (spec §8; the route guard's access codes, ADR-0023): worded by key, never by their English
 * message (charter §4.5: nothing user-facing is English from the wire). The access codes keep the chat's existing keys.
 */
const HUB_CODE_KEYS = {
	agent_auth_failed: 'shared_chat.error.agent_auth_failed',
	agent_not_found: 'shared_chat.error.agent_not_found',
	agent_rejected_input: 'shared_chat.error.agent_rejected_input',
	provider_unreachable: 'shared_chat.error.provider_unreachable',
	upstream_error: 'shared_chat.error.upstream_error',
	conversation_not_found: 'shared_chat.error.conversation_not_found',
	run_in_progress: 'shared_chat.error.run_in_progress',
	answer_pending: 'shared_chat.error.answer_pending',
	answers_invalid: 'shared_chat.error.answers_invalid',
	unauthorized: 'chat.error_unauthorized',
	forbidden: 'chat.error_forbidden',
	app_not_found: 'chat.error_app_not_found',
	app_disabled: 'chat.error_app_disabled',
} as const

export const HUB_ERROR_CODES = Object.keys(HUB_CODE_KEYS) as (keyof typeof HUB_CODE_KEYS)[]

type AgentCode = keyof typeof AGENT_CODE_KEYS
type HubCode = keyof typeof HUB_CODE_KEYS
const isAgentCode = (code: string | undefined): code is AgentCode =>
	code !== undefined && Object.hasOwn(AGENT_CODE_KEYS, code)
const isHubCode = (code: string | undefined): code is HubCode =>
	code !== undefined && Object.hasOwn(HUB_CODE_KEYS, code)

export interface RunErrorView {
	titleKey:
		| (typeof AGENT_CODE_KEYS)[AgentCode]
		| (typeof HUB_CODE_KEYS)[HubCode]
		| 'shared_chat.error.generic'
	description?: string
}

/**
 * A run error as the turn's Alert shows it (spec §5.3): a localised title for the code and, for the agent's codes and
 * any code the hub does not know, the agent's message (spec §4.4: `RUN_ERROR` passes through with its message, which
 * the owner says is safe to show); a hub code shows its title alone.
 */
export const runErrorView = (error: { code?: string; message: string }): RunErrorView => {
	if (isHubCode(error.code)) return { titleKey: HUB_CODE_KEYS[error.code] }
	return {
		titleKey: isAgentCode(error.code) ? AGENT_CODE_KEYS[error.code] : 'shared_chat.error.generic',
		description: error.message || undefined,
	}
}

/** A failed read (the list, the history) in words: a hub code by its key, anything else `fallback` (failureText's rule). */
export const requestFailureText = (error: unknown, t: TFunction, fallback = ''): string =>
	error instanceof RequestError && isHubCode(error.code) ? t(HUB_CODE_KEYS[error.code]) : fallback

/**
 * The caption under a stopped turn (spec §5.3): "Stopped" for a run the user stopped or left (`cancelled`,
 * `truncated`), "Stopped: time limit" for the agent's own time limit (spec §2.3: `CUSTOM run_cancelled` with
 * `reason: 'run_timeout'`).
 */
export const stoppedCaptionKey = (
	turn: Turn,
): 'chat.stopped' | 'shared_chat.stopped_time_limit' | undefined => {
	const last = turn.runs.at(-1)
	if (!last || (last.outcome !== 'cancelled' && last.outcome !== 'truncated')) return undefined
	return last.cancelledReason === 'run_timeout' ? 'shared_chat.stopped_time_limit' : 'chat.stopped'
}
```

Create `components/shared-chat/turn-parts.ts`:

```ts
import type { TurnPart } from '@/lib/chat/turn'

export type ToolPart = Extract<TurnPart, { kind: 'tool' }>

/** A turn's parts as the turn renders them: tool calls that follow each other form one chain (spec §5.3). */
export type PartGroup =
	| Exclude<TurnPart, ToolPart>
	| { kind: 'tools'; key: string; tools: ToolPart[] }

/** Arrival order kept (spec §5.2); consecutive tool parts are one ThoughtChain, keyed by its first call. */
export const groupParts = (parts: readonly TurnPart[]): PartGroup[] => {
	const groups: PartGroup[] = []
	for (const part of parts) {
		const last = groups.at(-1)
		if (part.kind !== 'tool') groups.push(part)
		else if (last?.kind === 'tools') last.tools.push(part)
		else groups.push({ kind: 'tools', key: part.toolCallId, tools: [part] })
	}
	return groups
}

const HINT_MAX = 60

/** The tool card's description (spec §5.3: "a short input hint"): the arguments on one line, at most 60 characters. */
export const inputHint = (args: string): string => {
	const flat = Array.from(args.replace(/\s+/g, ' ').trim())
	return flat.length > HINT_MAX ? `${flat.slice(0, HINT_MAX).join('')}…` : flat.join('')
}

/** Arguments and results for CodeHighlighter: JSON indented when it parses (streaming arguments may not yet), else as sent. */
export const prettyJson = (text: string): string => {
	try {
		return JSON.stringify(JSON.parse(text), null, 2)
	} catch {
		return text
	}
}
```

Create `components/shared-chat/bubble-items.ts`:

```ts
import type { BubbleItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'

import type { Turn } from '@/lib/chat/turn'

/** Nothing to render yet: no part, and no run that ended in an error or a stop (both show in the bubble). */
const isEmpty = (turn: Turn) =>
	turn.parts.length === 0 &&
	!turn.runs.some(run => run.error || run.outcome === 'cancelled' || run.outcome === 'truncated')

/**
 * x-components Pattern 3, as the Dify chat's toBubbleItems: `loading` only for a placeholder with nothing to show,
 * `streaming` only while the turn updates.
 */
export const toBubbleItems = (messages: MessageInfo<Turn>[]): BubbleItemType[] =>
	messages.map(({ id, message, status }) => ({
		key: id,
		role: message.role,
		content: message,
		loading: status === 'loading' && isEmpty(message),
		streaming: status === 'updating',
		status,
	}))
```

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts __tests__/i18n-locales.test.ts` Expected: PASS, `Test Files  2 passed (2)`.

- [ ] **Step 6: Write the turn's components**

Create `components/shared-chat/tool-chain.tsx`:

```tsx
'use client'

import { CodeHighlighter, ThoughtChain } from '@ant-design/x'
import type { CodeHighlighterProps, ThoughtChainItemType } from '@ant-design/x'
import { Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import type { ToolStatus } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { inputHint, prettyJson, type ToolPart } from './turn-parts'

/** ThoughtChain's item statuses (X 2.9.0 `es/thought-chain/Status.d.ts`) for the tool part's (plan call P10). */
const STATUS: Record<ToolStatus, NonNullable<ThoughtChainItemType['status']>> = {
	running: 'loading',
	done: 'success',
	error: 'error',
	stopped: 'abort',
}

// Dark scheme, as the Markdown code block does (components/chat/message/markdown/code-block.tsx): CodeHighlighter
// highlights with Prism's one-light style, and `highlightProps.style` replaces it. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * Consecutive tool calls as one X ThoughtChain (spec §5.3, the full-stack template's tool card on X's own component,
 * the one the Dify chat uses for agent thoughts): each item's title is the tool's name, its description a short input
 * hint, its status the part's, and its collapsible body the arguments and the result in X CodeHighlighter (`lang`
 * "json"; Prism's light mode loads the one `json` grammar, X CodeHighlighter API `prismLightMode`). Every text renders
 * as text, never HTML.
 */
export default function ToolChain({ tools }: { tools: ToolPart[] }) {
	const { t } = useTranslation()
	const { isDark } = useThemeContext()
	const highlight = isDark ? DARK_HIGHLIGHT : undefined
	const items = useMemo<ThoughtChainItemType[]>(
		() =>
			tools.map(tool => ({
				key: tool.toolCallId,
				title: tool.name,
				description: inputHint(tool.args),
				status: STATUS[tool.status],
				blink: tool.status === 'running',
				collapsible: true,
				content: (
					<Flex
						vertical
						gap="small"
					>
						<Typography.Text type="secondary">{t('shared_chat.tool_arguments')}</Typography.Text>
						<CodeHighlighter
							lang="json"
							highlightProps={highlight}
						>
							{prettyJson(tool.args)}
						</CodeHighlighter>
						{tool.result !== undefined && (
							<>
								<Typography.Text type="secondary">{t('shared_chat.tool_result')}</Typography.Text>
								<CodeHighlighter
									lang="json"
									highlightProps={highlight}
								>
									{prettyJson(tool.result)}
								</CodeHighlighter>
							</>
						)}
					</Flex>
				),
			})),
		[highlight, t, tools],
	)
	return <ThoughtChain items={items} />
}
```

Create `components/shared-chat/user-turn.tsx`:

```tsx
'use client'

import { Typography } from 'antd'

import styles from '@/components/chat/chat-view/user-content.module.css'
import { turnText, type Turn } from '@/lib/chat/turn'

/** A user bubble (spec §5.3): the text as typed, line breaks kept (the Dify chat's user text style). 2c adds files. */
export default function UserTurn({ turn }: { turn: Turn }) {
	return <Typography.Text className={styles.text}>{turnText(turn)}</Typography.Text>
}
```

Create `components/shared-chat/assistant-turn.tsx`:

```tsx
'use client'

import { Alert, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageMarkdown from '@/components/chat/message/message-markdown'
import Reasoning from '@/components/chat/message/reasoning'
import type { Turn } from '@/lib/chat/turn'

import { runErrorView, stoppedCaptionKey } from './run-error'
import ToolChain from './tool-chain'
import { groupParts } from './turn-parts'

export interface AssistantTurnProps {
	turn: Turn
	/** X's message status: `updating` while the turn streams (spec §5.2: the transport layer). */
	status?: string
}

/**
 * An answer (spec §5.3): its parts in arrival order (reasoning in X Think through the Dify chat's `Reasoning` and its
 * timer, text through `MessageMarkdown`, consecutive tool calls as one ThoughtChain; 2b renders activity parts), then
 * each run's error in an antd Alert below what streamed, then "Stopped" or "Stopped: time limit". An answer that ended
 * with nothing shows the Dify chat's empty-answer warning.
 */
export default function AssistantTurn({ turn, status }: AssistantTurnProps) {
	const { t } = useTranslation()
	const streaming = status === 'updating'
	const groups = useMemo(() => groupParts(turn.parts), [turn.parts])
	const errors = turn.runs.filter(run => run.error)
	const caption = stoppedCaptionKey(turn)
	const empty = groups.length === 0 && errors.length === 0 && !caption
	return (
		<Flex
			vertical
			gap="small"
		>
			{groups.map((group, index) => {
				const last = index === groups.length - 1
				switch (group.kind) {
					case 'reasoning':
						return (
							<Reasoning
								key={group.messageId}
								reasoning={group.text}
								// Done once anything follows it, or the turn stopped streaming.
								done={!streaming || !last}
								streaming={streaming}
								messageId={group.messageId}
							/>
						)
					case 'text':
						return (
							<MessageMarkdown
								key={group.messageId}
								content={group.text}
								streaming={streaming && last}
								messageId={group.messageId}
							/>
						)
					case 'tools':
						return (
							<ToolChain
								key={group.key}
								tools={group.tools}
							/>
						)
					case 'activity':
						// Spec §6.4 (2b): activity cards.
						return null
					default:
						return group satisfies never
				}
			})}
			{errors.map((run, index) => {
				const view = runErrorView(run.error!)
				return (
					<Alert
						key={`${run.runId}:${index}`}
						type="error"
						showIcon
						title={t(view.titleKey)}
						description={view.description}
					/>
				)
			})}
			{caption && <Typography.Text type="secondary">{t(caption)}</Typography.Text>}
			{empty && status === 'success' && (
				<Alert
					type="warning"
					showIcon
					title={t('message.empty_content')}
					description={t('message.empty_content_hint')}
				/>
			)}
		</Flex>
	)
}
```

Create `components/shared-chat/turn-footer.tsx`:

```tsx
'use client'

import { Actions } from '@ant-design/x'
import { memo } from 'react'

import { turnText, type Turn } from '@/lib/chat/turn'

/**
 * An answer's footer (spec §5.3: copy in X Actions): `Actions.Copy`, antd's Typography copy button named by antd's
 * locale ("Copy"), as the Dify chat's footer renders it. Not while the turn streams, and not for an answer with no text.
 */
function TurnFooter({ turn, status }: { turn: Turn; status?: string }) {
	const text = turnText(turn)
	if (!text || status === 'updating' || status === 'loading') return null
	return (
		<Actions
			items={[{ key: 'copy', actionRender: () => <Actions.Copy text={text} /> }]}
			variant="borderless"
		/>
	)
}

export default memo(TurnFooter)
```

Create `components/shared-chat/turn-list.tsx`:

```tsx
'use client'

import { Bubble, type BubbleListProps } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { App, Button, Skeleton } from 'antd'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import styles from '@/components/chat/chat-view/chat-view.module.css'
import type { BubbleInfo } from '@/components/chat/chat-view/message-list'
import type { Turn } from '@/lib/chat/turn'

import { toBubbleItems } from './bubble-items'
import UserTurn from './user-turn'

/** Bubble.List's ref: the package root exports no ref type, so it is derived from the component. */
type BubbleListRef = React.ComponentRef<typeof Bubble.List>

export interface TurnListProps {
	messages: MessageInfo<Turn>[]
	/** The conversation shown, '' while there is none yet; each one opens at its latest turn. */
	conversationKey: string
	isDefaultMessagesRequesting: boolean
	hasMore: boolean
	/** Rejects when the page could not be loaded. */
	loadEarlier: () => Promise<void>
	/** The bubbles' reading width; the scroll box itself spans the region. */
	maxWidth: React.CSSProperties['maxWidth']
	/** An answer's content; keep it stable (useCallback): the role map, and so every bubble, follows it. */
	renderAssistant: (turn: Turn, info: BubbleInfo) => React.ReactNode
	renderFooter?: (turn: Turn, info: BubbleInfo) => React.ReactNode
}

/**
 * X Bubble.List over the conversation's turns, with "load earlier" above it: the Dify chat's MessageList for the shared
 * turn (spec §5.1; plan call P11), the same role map, widths, skeleton and scroll anchoring.
 */
export default function TurnList({
	messages,
	conversationKey,
	isDefaultMessagesRequesting,
	hasMore,
	loadEarlier,
	maxWidth,
	renderAssistant,
	renderFooter,
}: TurnListProps) {
	const { t } = useTranslation()
	const { message: toast } = App.useApp()
	const listRef = useRef<BubbleListRef>(null)

	// Stable role map (x-components: "keep roles stable"); no avatar slot on either role (the Dify chat's).
	const role = useMemo<BubbleListProps['role']>(
		() => ({
			assistant: {
				placement: 'start',
				variant: 'borderless',
				contentRender: (content, info) => renderAssistant(content as Turn, info),
				footer: renderFooter ? (content, info) => renderFooter(content as Turn, info) : undefined,
			},
			user: {
				placement: 'end',
				contentRender: content => <UserTurn turn={content as Turn} />,
			},
		}),
		[renderAssistant, renderFooter],
	)

	// One object per width, like the role map: Bubble.List hands it to every item on each render.
	const rowStyles = useMemo<BubbleListProps['styles']>(() => {
		const row = { maxWidth, marginInline: 'auto' }
		return { bubble: row, system: row, divider: row }
	}, [maxWidth])

	const items = useMemo(() => toBubbleItems(messages), [messages])

	const onLoadEarlier = async () => {
		const firstKey = items[0]?.key
		try {
			await loadEarlier()
		} catch {
			toast.error(t('common.request_failed_retry'))
			return
		}
		// The turn that was first stays where the reader is instead of the list jumping (the Dify chat's rule).
		if (firstKey !== undefined)
			listRef.current?.scrollTo({ key: firstKey, block: 'start', behavior: 'instant' })
	}

	if (!conversationKey || (isDefaultMessagesRequesting && items.length === 0)) {
		return (
			<div className={styles.list}>
				<Skeleton
					active
					paragraph={{ rows: 4 }}
				/>
			</div>
		)
	}
	return (
		<div className={styles.list}>
			{hasMore && (
				<div className={styles.loadEarlier}>
					<Button
						type="link"
						onClick={() => void onLoadEarlier()}
					>
						{t('chat.load_earlier')}
					</Button>
				</div>
			)}
			<Bubble.List
				key={conversationKey}
				ref={listRef}
				items={items}
				role={role}
				autoScroll
				className={styles.bubbleList}
				classNames={{ scroll: styles.scrollBox }}
				styles={rowStyles}
			/>
		</div>
	)
}
```

Create `components/shared-chat/shared-welcome.tsx`:

```tsx
'use client'

import { Welcome } from '@ant-design/x'

import { useChatAppInfo } from '@/components/chat/chat-view/app-info-context'
import styles from '@/components/chat/chat-view/chat-view.module.css'
import { AppAvatar } from '@/components/chat/chat-view/conversation-sidebar'

/**
 * X Welcome on an empty conversation (spec §5.3): the app's icon, name and description. AG-UI has no opening statement
 * or suggested questions, so there is nothing else to show.
 */
export default function SharedWelcome({ visible }: { visible: boolean }) {
	const app = useChatAppInfo()
	if (!visible) return null
	return (
		<div className={styles.welcome}>
			<Welcome
				variant="borderless"
				icon={
					<AppAvatar
						size="large"
						alt={app.name}
					/>
				}
				title={app.name}
				description={app.description || undefined}
			/>
		</div>
	)
}
```

- [ ] **Step 7: Write the page and switch `ProviderChat` to it**

Create `components/shared-chat/shared-chat.tsx`:

```tsx
'use client'

import { MenuOutlined } from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import { Alert, App, Button, Layout, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChatAppInfoContext } from '@/components/chat/chat-view/app-info-context'
import ChatSender, { type SenderRef } from '@/components/chat/chat-view/chat-sender'
import styles from '@/components/chat/chat-view/chat-view.module.css'
import ConversationDrawer from '@/components/chat/chat-view/conversation-drawer'
import ConversationSidebar, {
	ConversationList,
} from '@/components/chat/chat-view/conversation-sidebar'
import type { BubbleInfo } from '@/components/chat/chat-view/message-list'
import SiderCollapsed from '@/components/chat/chat-view/sider-collapsed'
import { useConversationMenu } from '@/components/chat/chat-view/use-conversation-menu'
import WidthToggle from '@/components/chat/chat-view/width-toggle'
import AppSider from '@/components/shell/app-sider'
import UserShell from '@/components/shell/user-shell'
import type { Turn } from '@/lib/chat/turn'
import type { ChatAppDto } from '@/lib/data/apps'

import { createSharedChatApi } from './api'
import AssistantTurn from './assistant-turn'
import { useSharedChat } from './hooks/use-shared-chat'
import { useSharedConversations } from './hooks/use-shared-conversations'
import { requestFailureText } from './run-error'
import SharedWelcome from './shared-welcome'
import TurnFooter from './turn-footer'
import TurnList from './turn-list'

/** An AG-UI app's chat DTO: what ProviderChat hands this page (spec §2.2: no agent URL, audience or secret). */
export type AguiChatApp = Extract<ChatAppDto, { provider: 'agui' }>

/**
 * The shared chat (Part 2 spec §5): the Dify chat's page layout (UserShell, AppSider with the conversation sidebar or
 * its collapsed rail, the mobile ConversationDrawer, the reading-width toggle and the chat column's CSS Module), reused
 * as spec §5.1 lists, around the turn list and the X Sender. The app's name, description and icon reach the shared
 * sidebar pieces through ChatAppInfoContext (Task 14; React 19 renders a context as its own provider).
 */
export default function SharedChat({ app }: { app: AguiChatApp }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message: toast } = App.useApp()
	const searchParams = useSearchParams()
	const api = useMemo(() => createSharedChatApi(app.id), [app.id])
	const senderRef = useRef<SenderRef>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
	// The sider's collapsed state and, when collapsed, the popover that holds the list (the Dify chat's).
	const [collapsed, setCollapsed] = useState(false)
	const [railListOpen, setRailListOpen] = useState(false)
	// The same preference as the Dify chat's toggle: one reading width for every chat.
	const [wide, setWide] = useLocalStorageState<boolean>('ai-app-hub-wide-screen', {
		defaultValue: false,
	})

	const list = useSharedConversations({
		appId: app.id,
		api,
		startNew: searchParams.get('isNewCvst') === '1',
	})
	// '' until the list has loaded: no conversation, so no provider and no sending (useSharedChat).
	const activeKey = list.activeKey
	const { getConversationId, markConversation, refresh } = list
	const chat = useSharedChat({
		appId: app.id,
		conversationKey: activeKey,
		api,
		getConversationId: () => getConversationId(activeKey),
		// The stream named its conversation (hub:run): the item keeps its key and takes the id and title (ADR-0017).
		onRun: (key, value) => markConversation(key, value.conversationId, value.title),
	})

	// When a reply ends the list is reloaded for its `updated_at` order (the Dify chat's rule).
	const wasRequesting = useRef(false)
	useEffect(() => {
		if (wasRequesting.current && !chat.isRequesting) void refresh()
		wasRequesting.current = chat.isRequesting
	}, [chat.isRequesting, refresh])

	useEffect(() => {
		if (activeKey) senderRef.current?.focus()
	}, [activeKey])

	useEffect(() => {
		if (!list.error) return
		const reason = requestFailureText(list.error, t)
		toast.error(
			reason ? t('chat.fetch_list_failed', { error: reason }) : t('common.request_failed_retry'),
		)
	}, [list.error, t, toast])

	// Stable between renders: Bubble.List's role map follows them, and a new map re-renders every bubble.
	const renderAssistant = useCallback(
		(turn: Turn, info: BubbleInfo) => (
			<AssistantTurn
				turn={turn}
				status={info.status}
			/>
		),
		[],
	)
	const renderFooter = useCallback(
		(turn: Turn, info: BubbleInfo) => (
			<TurnFooter
				turn={turn}
				status={info.status}
			/>
		),
		[],
	)

	// Welcome while the conversation has no turns; never in place of a history that is loading or failed to load.
	const historyPending = chat.isDefaultMessagesRequesting && chat.messages.length === 0
	const showWelcome =
		Boolean(activeKey) && !historyPending && !chat.historyError && chat.messages.length === 0
	// Plan call P3 and decision 50: an open interrupt blocks the composer; 2b's cards answer it.
	const waiting = chat.openInterrupts.length > 0 && !chat.isRequesting

	// The list's callbacks and menu are stable, so the memoised sidebar does not re-render per streamed chunk.
	const { setActiveKey, createTemp, rename, remove, canRename } = list
	const closeDrawer = useCallback(() => setDrawerOpen(false), [])
	const selectConversation = useCallback(
		(key: string) => {
			setActiveKey(key)
			setDrawerOpen(false)
			setRailListOpen(false)
		},
		[setActiveKey],
	)
	const createConversation = useCallback(() => {
		createTemp()
		setDrawerOpen(false)
		setRailListOpen(false)
	}, [createTemp])
	// The menu's toast (Task 14's describeFailure): the hub's codes by their keys, else the generic text.
	const describeFailure = useCallback(
		(error: unknown) => requestFailureText(error, t, t('common.request_failed_retry')),
		[t],
	)
	const conversationMenu = useConversationMenu({ rename, remove, canRename, describeFailure })

	// A send queued for this conversation's history lives in the SDK's queue of this conversation: until its reply
	// starts, the list keeps it (ADR-0017 note of 2026-10-05).
	const locked = chat.queued
	const sidebarProps = {
		items: list.conversations,
		activeKey,
		onActiveChange: selectConversation,
		menu: conversationMenu,
		locked,
	}
	const createDisabled = list.hasEmptyTemp || locked

	// The reading width (the Dify chat's): antd's screenMD token, unbounded when wide.
	const readingStyle = { maxWidth: wide ? 'none' : token.screenMD }
	const bubbleWidth = wide ? 'none' : token.screenMD - 2 * token.padding - 2 * token.paddingXS

	const appInfo = useMemo(
		() => ({ id: app.id, name: app.name, description: app.description, hasIcon: app.hasIcon }),
		[app.id, app.name, app.description, app.hasIcon],
	)

	return (
		<ChatAppInfoContext value={appInfo}>
			<UserShell
				title={
					<Typography.Text
						strong
						ellipsis
					>
						{app.name}
					</Typography.Text>
				}
				extra={
					// Below md the column already spans the viewport: the toggle shows from md up (CSS, as the sider).
					<span className={styles.desktopOnly}>
						<WidthToggle
							wide={Boolean(wide)}
							onChange={setWide}
						/>
					</span>
				}
				mobileMenu={
					<Button
						type="text"
						icon={<MenuOutlined />}
						aria-label={t('system.menu')}
						title={t('system.menu')}
						onClick={() => setDrawerOpen(true)}
					/>
				}
			>
				<Layout
					className={styles.layout}
					hasSider
				>
					<AppSider
						collapsed={collapsed}
						onCollapse={setCollapsed}
					>
						{collapsed ? (
							<SiderCollapsed
								onCreate={createConversation}
								createDisabled={createDisabled}
								listOpen={railListOpen}
								onListOpenChange={setRailListOpen}
								list={<ConversationList {...sidebarProps} />}
							/>
						) : (
							<ConversationSidebar
								{...sidebarProps}
								onCreate={createConversation}
								createDisabled={createDisabled}
							/>
						)}
					</AppSider>
					<Layout.Content>
						<div className={styles.column}>
							{chat.historyError && (
								// The spacing sits on a wrapper: antd's Alert resets its own margin.
								<div
									className={`${styles.historyAlert} ${styles.reading}`}
									style={readingStyle}
								>
									<Alert
										type="error"
										showIcon
										title={t('chat.history_load_failed')}
										description={requestFailureText(
											chat.historyError,
											t,
											t('common.request_failed_retry'),
										)}
										action={
											<Button
												size="small"
												onClick={() => void chat.retryHistory()}
											>
												{t('chat.retry')}
											</Button>
										}
									/>
								</div>
							)}
							<div
								className={`${styles.top} ${styles.reading}`}
								style={readingStyle}
							>
								<SharedWelcome visible={showWelcome} />
							</div>
							<TurnList
								messages={chat.messages}
								conversationKey={activeKey}
								isDefaultMessagesRequesting={chat.isDefaultMessagesRequesting}
								hasMore={chat.hasMore}
								loadEarlier={chat.loadEarlier}
								maxWidth={bubbleWidth}
								renderAssistant={renderAssistant}
								renderFooter={renderFooter}
							/>
							<div
								className={`${styles.composer} ${styles.reading}`}
								style={readingStyle}
							>
								<ChatSender
									loading={chat.isRequesting}
									disabled={!activeKey || waiting}
									// The box says why it waits (spec §6.3's hint; plan call P3's 2a wording).
									placeholder={waiting ? t('shared_chat.answer_pending_hint') : undefined}
									senderRef={senderRef}
									onSend={text => chat.send(text)}
									onStop={() => void chat.stop()}
								/>
							</div>
						</div>
					</Layout.Content>
				</Layout>
				<ConversationDrawer
					open={drawerOpen}
					onClose={closeDrawer}
				>
					<ConversationSidebar
						{...sidebarProps}
						onCreate={createConversation}
						createDisabled={createDisabled}
					/>
				</ConversationDrawer>
			</UserShell>
		</ChatAppInfoContext>
	)
}
```

Replace the whole of `components/provider-ui/provider-chat.tsx` (Task 4 left an `AppUnavailable` case for `'agui'`, plan call P12):

```tsx
'use client'

import ChatWorkspace from '@/components/chat/chat-workspace'
import SharedChat from '@/components/shared-chat/shared-chat'
import type { ChatAppDto } from '@/lib/data/apps'

/**
 * The chat page's one client switch (Part 1 spec §3; DV 9b): the server page hands over the chat DTO, a serializable
 * prop, and the provider's chat view is chosen here, on the client (React "use client" caveats: a server module may
 * pass a client component only serializable values). Dify keeps its own chat until Part 3; AG-UI renders the shared
 * chat (Part 2 spec §5.1). The switch is exhaustive: a provider added to ProviderId without a view fails tsc at
 * `satisfies never`.
 */
export default function ProviderChat({ app }: { app: ChatAppDto }) {
	switch (app.provider) {
		case 'dify':
			return <ChatWorkspace app={app} />
		case 'agui':
			return <SharedChat app={app} />
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return app.provider satisfies never
	}
}
```

- [ ] **Step 8: Run the gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat components/provider-ui/provider-chat.tsx __tests__/shared-chat-view.test.ts
pnpm exec oxfmt --check components/shared-chat components/provider-ui/provider-chat.tsx __tests__/shared-chat-view.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
pnpm i18n:lint
npx -y @ant-design/cli lint ./
pnpm exec playwright test e2e/chat.spec.ts --project desktop-light
```

Expected: tsc exits 0; oxlint 0 errors; oxfmt lists no file (format with `pnpm exec oxfmt <files>` first if it does); `pnpm test` passes (the locale test included); `pnpm i18n:lint` reports no hardcoded text in `components/shared-chat`; the antd lint's finding count is the same as the count it printed before this task or lower (run `npx -y @ant-design/cli lint ./` once before Step 6 and note the count it prints); the Dify chat spec passes on `desktop-light` (stop `pnpm dev` first: one `next dev` per checkout). The AG-UI page itself is proven in Task 17.

- [ ] **Step 9: Commit**

```bash
git add components/shared-chat components/provider-ui/provider-chat.tsx __tests__/shared-chat-view.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(shared-chat): the shared chat view for AG-UI apps

Turns with reasoning, Markdown text, tool cards, run errors and the
stopped captions; Welcome, the Sender with Stop, Copy, and the Dify
chat's shell, sider and drawer reused (spec §5.1, §5.3). ProviderChat
renders it for AG-UI apps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["components/shared-chat/run-error.ts", "components/shared-chat/turn-parts.ts", "components/shared-chat/bubble-items.ts", "components/shared-chat/tool-chain.tsx", "components/shared-chat/user-turn.tsx", "components/shared-chat/assistant-turn.tsx", "components/shared-chat/turn-footer.tsx", "components/shared-chat/turn-list.tsx", "components/shared-chat/shared-welcome.tsx", "components/shared-chat/shared-chat.tsx", "components/provider-ui/provider-chat.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/shared-chat-view.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["shared-chat-view and i18n-locales tests pass", "runErrorView: the five agent codes get their own title and the agent's message; every spec §8 hub code and the access codes get a title and no description; anything else the generic title with the message; every key exists in the English file", "stoppedCaptionKey: chat.stopped for cancelled or truncated, shared_chat.stopped_time_limit for run_timeout, nothing otherwise", "groupParts keeps arrival order and chains consecutive tool parts", "ProviderChat renders SharedChat for 'agui' and no longer imports AppUnavailable", "tsc, pnpm test, oxlint and oxfmt pass; the antd lint count does not grow", "e2e/chat.spec.ts passes on desktop-light"], "modelTier": "standard"}
```

---

### Task 17: The e2e specs for the AG-UI chat and its admin

**Goal:** The Playwright suite proves 2a's "done when" (spec §12) against Task 13's stub AG-UI producer on all three projects: an admin adds an AG-UI app with Test connection; a user chats with it (text, reasoning and tool cards in one turn, run errors, the time limit, Stop that ends the run in place and stops the agent, a reload restoring the conversation, rename and delete, the refusals before a stream), signed with the identity contract; the full suite passes with every Dify spec still green.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §10 (the e2e list for 2a), §12, ADR-0010 (Playwright against `next dev`, the throwaway PostgreSQL and the stub on 5399), plan call P14. Idioms come from `e2e/admin-apps.spec.ts` (the drawer, `pickProvider`, `testResult`, `openDrawer`, own ids per project) and `e2e/chat.spec.ts` (the Sender box, the conversation list in the sider or the mobile drawer, the item menu). Playwright docs (Context7 `/microsoft/playwright`): web-first assertions (`toBeVisible`, `toContainText`, `expect.poll`), the `request` fixture for the stub's test-only routes, `test.skip` with `isMobile`.

**Texts this task asserts, and where they come from** (if a wording task changed one, change it here, the e2e rule of spec §8):

| Text | Key / source |
| --- | --- |
| `AG-UI agent` | `provider.agui` (Task 4) |
| `Agent URL`, `Audience`, `JWT secret` | the AG-UI form section's labels (Task 4) |
| `Leave blank to keep` | `app_setting.secret_keep_placeholder` (Part 1, reused by Task 4) |
| `Connected`, `The key was refused`, `The provider could not be reached` | `connection_test.*` (Part 1) |
| `The agent was not found` | `connection_test.agent_not_found_title` (Task 4) and `shared_chat.error.agent_not_found` (Task 16) |
| `robot` | `RobotOutlined`'s accessible name (Part 1's E11 fallback icon for AG-UI, Task 4) |
| `Reasoning`, `Stopped`, `Stopped: time limit`, `Arguments`, `Result`, `Usage limit reached`, `The agent refused the request` | `message.reasoning_title`, `chat.stopped`, `shared_chat.*` (Task 16) |
| `Hello from the **stub agent**`, `Let me check the weather.`, `get_weather`, `It is 18 °C and cloudy in Paris.`, `The stub agent stopped with usage_limit.`, `word0`…`word199` | the stub's scenarios (Task 13, `e2e/fixtures/stub/agui.ts`) |

**Depends on:** Tasks 4, 11–13, 15 and 16.

**Files:**

- Create: `e2e/agui-admin.spec.ts`
- Create: `e2e/agui-chat.spec.ts`
- Modify: `e2e/screenshots.spec.ts` (one page entry, `chat-agui`)

**Acceptance Criteria:**

- [ ] `pnpm exec playwright test e2e/agui-admin.spec.ts e2e/agui-chat.spec.ts` passes on `desktop-light`, `desktop-dark` and `mobile-light` (the desktop-only cases skipped on mobile), 0 failed.
- [ ] The admin spec adds an AG-UI app through the drawer: Test connection reads "Connected" with the stub's secret, "The key was refused" with another secret, "The agent was not found" for `/agui/agents/missing`, "The provider could not be reached" for `/v1/unreachable`; the save lists the app as "AG-UI agent" with the robot icon; an Edit with the secret left blank keeps `secrets.jwtSecret` in the database, and the chat still answers.
- [ ] The chat spec: the default scenario streams a "Reasoning" group and the **stub agent** text in one answer bubble, and `GET /agui/_caller` reports the signed-in owner's id, `auth_source` `local` and `roles` `['owner']`; `tool` shows `get_weather` between the two texts, with "Arguments" and "Result" in its body; `error usage_limit` shows "Usage limit reached" and "The stub agent stopped with usage_limit."; `timeout` shows "Stopped: time limit"; `slow` + Stop shows "Stopped" in the same bubble and `GET /agui/_slow` reports `closedEarly: true` with fewer than 200 words; a reload restores the user text, the answer and the sidebar title; rename and delete work through the item menu and survive a reload; the missing agent's app shows "The agent was not found"; `invalid` shows "The agent refused the request".
- [ ] `pnpm test:e2e` (the whole suite, three projects) reports 0 failed: every Dify spec stays green.

**Verify:** `pnpm test:e2e` → the list reporter ends with `N passed` and no `failed` line (record the counts and the run's duration in the task's close note)

**Steps:**

- [ ] **Step 1: Write the admin spec**

Create `e2e/agui-admin.spec.ts`:

```ts
import { expect, type Locator, type Page, test, type TestInfo } from '@playwright/test'

import { aguiAgentUrl, STUB_AGUI_AUDIENCE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubPort } from './fixtures/env'

/*
 * Part 2 spec §2 and §12 (2a): an admin adds an AG-UI agent with Test connection (spec §2.4's mapping against the stub,
 * Task 13), and an edit keeps the write-only secret (ADR-0032). The drawer idioms are e2e/admin-apps.spec.ts's.
 */

const PROJECTS = ['desktop-light', 'desktop-dark', 'mobile-light']
/** An apps id (a UUID) of the spec's own, distinct per project: the three projects run one after another. */
const ownId = (base: number, testInfo: TestInfo) =>
	`e2e00000-0000-4000-8000-${String(base + PROJECTS.indexOf(testInfo.project.name) + 1).padStart(12, '0')}`
const CREATED = 'Created AG-UI agent'
const AGENT_URL = aguiAgentUrl(stubPort, 'assistant')
const SECRET = e2eEnv.E2E_AGUI_JWT_SECRET

/** The drawer's provider Select (E1): an antd Select's search box is its combobox, named by the field's label. */
const pickProvider = async (page: Page, drawer: Locator, name: string) => {
	await drawer.getByRole('combobox', { name: /^Provider/ }).click()
	await page.getByTitle(name, { exact: true }).click()
}
/** The Alert under Test connection (E7), found by its title. */
const testResult = (drawer: Locator, title: string) =>
	drawer.getByRole('alert').filter({ hasText: title })
const openDrawer = async (control: Locator, drawer: Locator) => {
	await expect(async () => {
		if (!(await drawer.isVisible())) await control.click()
		await expect(drawer).toBeVisible({ timeout: 2_000 })
	}).toPass()
}
// antd's Table sets data-row-key from rowKey on each body row.
const rowById = (page: Page, id: string) => page.locator(`tr[data-row-key="${id}"]`)
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

const seedAguiApp = (id: string, name: string) =>
	withDb(db =>
		db.query(
			"INSERT INTO apps (id, provider, name, description, access_mode, settings, secrets) VALUES ($1, 'agui', $2, 'e2e', 'everyone', $3::jsonb, $4::jsonb) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets",
			[
				id,
				name,
				JSON.stringify({ agentUrl: AGENT_URL, audience: STUB_AGUI_AUDIENCE }),
				JSON.stringify({ jwtSecret: SECRET }),
			],
		),
	)
const dropApp = (id: string) => withDb(db => db.query('DELETE FROM apps WHERE id = $1', [id]))

test.describe('AG-UI apps in the admin', () => {
	// One project runs at a time, so the created app is removed by name after each test.
	test.afterEach(async () => {
		await withDb(db => db.query('DELETE FROM apps WHERE name = $1', [CREATED]))
	})

	test('an admin adds an AG-UI agent: its fields, Test connection’s answers, and the save', async ({
		page,
	}) => {
		await page.goto('/app-management')
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await openDrawer(page.getByRole('button', { name: 'New' }), create)
		await pickProvider(page, create, 'AG-UI agent')
		await create.getByLabel('App name').fill(CREATED)
		await create.getByLabel('Agent URL').fill(AGENT_URL)
		await create.getByLabel('Audience').fill(STUB_AGUI_AUDIENCE)
		await create.getByLabel('JWT secret').fill(SECRET)
		const test = create.getByRole('button', { name: 'Test connection' })

		// Spec §2.4: the stub refuses `{}` with 422 after the token passed: reachable.
		await test.click()
		await expect(testResult(create, 'Connected')).toBeVisible()

		// Another secret of the allowed length: the stub's 401.
		await create.getByLabel('JWT secret').fill('a-different-secret-of-forty-characters-00')
		// A connection field changed: the old result is gone (E7).
		await expect(testResult(create, 'Connected')).toHaveCount(0)
		await test.click()
		await expect(testResult(create, 'The key was refused')).toBeVisible()

		await create.getByLabel('JWT secret').fill(SECRET)
		await create.getByLabel('Agent URL').fill(aguiAgentUrl(stubPort, 'missing'))
		await test.click()
		await expect(testResult(create, 'The agent was not found')).toBeVisible()

		// The stub drops the socket on this path (Part 1's unreachable scenario).
		await create.getByLabel('Agent URL').fill(`http://127.0.0.1:${stubPort}/v1/unreachable`)
		await test.click()
		await expect(testResult(create, 'The provider could not be reached')).toBeVisible()

		await create.getByLabel('Agent URL').fill(AGENT_URL)
		await create.getByRole('button', { name: 'OK' }).click()
		await expect(page.getByText('App configuration added')).toBeVisible()
		const row = page.getByRole('row', { name: new RegExp(CREATED) })
		await expect(row.getByText('AG-UI agent', { exact: true })).toBeVisible()
		// E11: no image, so AG-UI's fallback icon (antd icons are role="img", named after the icon).
		await expect(row.getByRole('img', { name: 'robot' })).toBeVisible()
		// Secrets are write-only (spec §2.2): stored, never echoed.
		const stored = await withDb(async db => {
			const { rows } = await db.query<{ secrets: { jwtSecret: string } }>(
				'SELECT secrets FROM apps WHERE name = $1',
				[CREATED],
			)
			return rows[0]?.secrets
		})
		expect(stored).toEqual({ jwtSecret: SECRET })
	})

	test('an edit keeps a blank secret, and the chat still signs with it', async ({
		page,
	}, testInfo) => {
		const id = ownId(400, testInfo)
		await seedAguiApp(id, `AG-UI edit ${testInfo.project.name}`)
		try {
			await page.goto('/app-management')
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
			await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), edit)
			await expect(edit.getByLabel('Agent URL')).toHaveValue(AGENT_URL)
			// The stored secret never comes back to the browser: a blank field keeps it (ADR-0032).
			await expect(edit.getByLabel('JWT secret')).toHaveValue('')
			await expect(edit.getByLabel('JWT secret')).toHaveAttribute(
				'placeholder',
				'Leave blank to keep',
			)
			await edit.getByLabel('App description').fill('Edited by the e2e suite')
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(edit).toBeHidden()
			await expect(rowById(page, id).getByText('Edited by the e2e suite')).toBeVisible()
			const stored = await withDb(async db => {
				const { rows } = await db.query<{ secrets: { jwtSecret: string } }>(
					'SELECT secrets FROM apps WHERE id = $1',
					[id],
				)
				return rows[0]?.secrets
			})
			expect(stored).toEqual({ jwtSecret: SECRET })

			await page.goto(`/chat/${id}?isNewCvst=1`)
			await senderBox(page).fill('hello after the edit')
			await page.keyboard.press('Enter')
			await expect(
				page.locator('.ant-bubble-start').last().locator('strong', { hasText: 'stub agent' }),
			).toBeVisible()
		} finally {
			await dropApp(id)
		}
	})
})
```

- [ ] **Step 2: Write the chat spec**

Create `e2e/agui-chat.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test'

import { AGUI_APP, AGUI_MISSING_APP } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubPort } from './fixtures/env'

/*
 * Part 2 spec §12 (2a "done when") against Task 13's spec-level AG-UI 1.0 stub (ADR-0010; plan call P14). The stub
 * picks its scenario by the last user text; the seed empties the AG-UI apps' conversations on every run, and
 * `workers: 1` keeps one test on the stub at a time, so `/chat/<id>` reopens the conversation the test made last.
 */

/** The Sender's box by its placeholder (`chat.send_placeholder`). */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** X Sender's stop control, named by X's locale (as e2e/chat.spec.ts). */
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop loading' })
/** The answers: Bubble.List's start-placed bubbles (the assistant role), as the Dify specs find them. */
const answers = (page: Page) => page.locator('.ant-bubble-start')
const questions = (page: Page) => page.locator('.ant-bubble-end')
const stubUrl = (path: string) => `http://127.0.0.1:${stubPort}${path}`

const send = async (page: Page, text: string) => {
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
}

/**
 * The conversation list: the sider from md up; below md the list lives in the drawer behind the header's "Menu" button
 * (spec §5.1 reuses the Dify chat's layout; e2e/chat.spec.ts's helper).
 */
async function conversationList(page: Page, isMobile: boolean): Promise<Locator> {
	if (!isMobile) return page.getByRole('complementary')
	await page
		.locator('header.ant-layout-header')
		.getByRole('button', { name: 'Menu', exact: true })
		.click()
	return page.getByRole('dialog', { name: 'Conversations menu' })
}

/** A vertical position on the page, for the arrival order of a turn's parts (spec §5.2). */
const top = async (locator: Locator) => (await locator.boundingBox())!.y

test.describe('the AG-UI chat', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await expect(senderBox(page)).toBeEnabled()
	})

	test('streams reasoning and Markdown text into one answer, signed for the account', async ({
		page,
		request,
	}, testInfo) => {
		await send(page, `hello ${testInfo.project.name}`)
		const answer = answers(page).last()
		await expect(answer.locator('strong', { hasText: 'stub agent' })).toBeVisible()
		// X Think, named as a group by the Reasoning component (message.reasoning_title).
		await expect(answer.getByRole('group', { name: 'Reasoning' })).toBeVisible()
		await expect(stopButton(page)).toHaveCount(0)
		// One X message per turn (spec §5.2).
		await expect(answers(page)).toHaveCount(1)
		// The identity contract end to end (spec §2.3, §10): the stub verified the JWT and kept its claims.
		const ownerId = await withDb(async db => {
			const { rows } = await db.query<{ id: string }>(
				'SELECT id FROM users WHERE lower(email) = lower($1)',
				[e2eEnv.E2E_ADMIN_EMAIL],
			)
			return rows[0]?.id
		})
		const caller = await (await request.get(stubUrl('/agui/_caller'))).json()
		expect(caller).toEqual({ sub: ownerId, auth_source: 'local', roles: ['owner'] })
	})

	test('a tool call shows as a card with its arguments and result, between the texts', async ({
		page,
	}) => {
		await send(page, 'tool')
		const answer = answers(page).last()
		const before = answer.getByText('Let me check the weather.')
		const after = answer.getByText('It is 18 °C and cloudy in Paris.')
		const title = answer.getByText('get_weather', { exact: true })
		await expect(after).toBeVisible()
		await expect(before).toBeVisible()
		await expect(title).toBeVisible()
		// Arrival order (spec §5.2): the text, the call, the text after its result.
		expect(await top(before)).toBeLessThan(await top(title))
		expect(await top(title)).toBeLessThan(await top(after))
		// The card's body opens on a click (ThoughtChain `collapsible`): the arguments and the result as JSON.
		await title.click()
		await expect(answer.getByText('Arguments', { exact: true })).toBeVisible()
		await expect(answer.getByText('Result', { exact: true })).toBeVisible()
		await expect(answer).toContainText('"city": "Paris"')
	})

	test('a run error shows its localised title and the agent’s message', async ({ page }) => {
		await send(page, 'error usage_limit')
		const alert = answers(page).last().getByRole('alert')
		await expect(alert).toContainText('Usage limit reached')
		await expect(alert).toContainText('The stub agent stopped with usage_limit.')
		// An in-stream error ends the run, not the chat: the Sender takes the next message.
		await expect(senderBox(page)).toBeEnabled()
	})

	test('a run the agent ends at its time limit keeps its text and says so', async ({ page }) => {
		await send(page, 'timeout')
		await expect(
			answers(page).last().getByText('Stopped: time limit', { exact: true }),
		).toBeVisible()
	})

	test('Stop ends the run in place, and the agent stops', async ({ page, request }) => {
		await send(page, 'slow')
		const answer = answers(page).last()
		await expect(answer).toContainText('word2')
		await stopButton(page).click()
		// Spec §4.5: the hub closes the run as cancelled; the turn finishes where it is.
		await expect(answer.getByText('Stopped', { exact: true })).toBeVisible()
		await expect(stopButton(page)).toHaveCount(0)
		await expect(answers(page)).toHaveCount(1)
		// The agent saw its request closed (the stub's test-only report of the last slow stream).
		await expect
			.poll(async () => (await (await request.get(stubUrl('/agui/_slow'))).json()).closedEarly)
			.toBe(true)
		const { words } = await (await request.get(stubUrl('/agui/_slow'))).json()
		expect(words).toBeLessThan(200)
	})

	test('a reload restores the conversation and its title', async ({ page, isMobile }, testInfo) => {
		const question = `remember me ${testInfo.project.name}`
		await send(page, question)
		await expect(answers(page).last().locator('strong', { hasText: 'stub agent' })).toBeVisible()
		// Without ?isNewCvst the page opens the newest conversation: this one (spec §4.2, newest first).
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(questions(page).getByText(question, { exact: true })).toBeVisible()
		await expect(answers(page).last().locator('strong', { hasText: 'stub agent' })).toBeVisible()
		await expect(answers(page).last().getByRole('group', { name: 'Reasoning' })).toBeVisible()
		// The title is the first message (spec §3.1).
		const list = await conversationList(page, isMobile)
		await expect(list.getByRole('listitem', { name: question, exact: true })).toBeVisible()
	})

	test('a conversation can be renamed and deleted from its menu', async ({
		page,
		isMobile,
	}, testInfo) => {
		test.skip(isMobile, 'the item menu is exercised on desktop, as in e2e/chat.spec.ts')
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const original = `rename me ${run}`
		const renamed = `Renamed ${run}`
		const sider = page.getByRole('complementary')
		const item = (name: string) => sider.getByRole('listitem', { name, exact: true })
		// Each row's menu button is named after its conversation (chat.menu_for).
		const actions = (name: string) =>
			item(name).getByRole('button', { name: `Actions for ${name}`, exact: true })
		await send(page, original)
		await expect(answers(page).last().locator('strong', { hasText: 'stub agent' })).toBeVisible()
		await expect(item(original)).toBeVisible()
		await actions(original).click()
		await page.getByRole('menuitem', { name: 'Rename' }).click()
		const dialog = page.getByRole('dialog', { name: 'Rename' })
		const nameBox = dialog.getByLabel('Enter a conversation name')
		await expect(nameBox).toHaveValue(original)
		await nameBox.fill(renamed)
		await dialog.getByRole('button', { name: 'OK' }).click()
		await expect(dialog).toBeHidden()
		await expect(item(renamed)).toBeVisible()
		// The hub stored the name (a Server Action, spec §4.2): a reload lists it.
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(item(renamed)).toBeVisible()
		await actions(renamed).click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		const confirm = page.getByRole('dialog', { name: 'Delete this conversation?' })
		await confirm.getByRole('button', { name: 'Delete' }).click()
		await expect(confirm).toBeHidden()
		await expect(item(renamed)).toHaveCount(0)
		// A soft delete (spec §3.4): gone from the user's list for good.
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(senderBox(page)).toBeVisible()
		await expect(item(renamed)).toHaveCount(0)
	})

	test('an agent that does not exist answers with a localised error before any stream', async ({
		page,
	}) => {
		await page.goto(`/chat/${AGUI_MISSING_APP.id}?isNewCvst=1`)
		await send(page, 'hello')
		// Spec §4.3 step 4: the agent's 404 is the hub's 502 agent_not_found envelope, worded by Task 16.
		await expect(answers(page).last().getByRole('alert')).toContainText('The agent was not found')
		await expect(senderBox(page)).toBeEnabled()
	})

	test('input the agent refuses before its stream reads as a refused request', async ({ page }) => {
		await send(page, 'invalid please')
		// The agent's 422 is agent_rejected_input (spec §4.3 step 4).
		await expect(answers(page).last().getByRole('alert')).toContainText(
			'The agent refused the request',
		)
	})
})
```

- [ ] **Step 3: Add the screenshot page**

In `e2e/screenshots.spec.ts`, import the AG-UI app beside the others:

```ts
import { AGUI_APP, APP_ID, APP_IDS } from './fixtures/constants'
```

and add this entry to `signedInPages`, after `completion`:

```ts
	// The shared chat (Part 2 spec §5.3): the stub's `tool` scenario, its card opened.
	'chat-agui': {
		path: `/chat/${AGUI_APP.id}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await senderBox(page).fill('tool')
			await page.keyboard.press('Enter')
			await expect(page.getByText('It is 18 °C and cloudy in Paris.')).toBeVisible()
			await page.getByText('get_weather', { exact: true }).click()
			await expect(page.getByText('Arguments', { exact: true })).toBeVisible()
		},
	},
```

- [ ] **Step 4: Run the two new specs on the three projects**

Stop `pnpm dev` first (one `next dev` per checkout), and make sure `pnpm test:db` is not running (both use 127.0.0.1:5433).

Run: `pnpm exec playwright test e2e/agui-admin.spec.ts e2e/agui-chat.spec.ts` Expected: every case passes on `desktop-light`, `desktop-dark` and `mobile-light`; on `mobile-light` the rename/delete case reports skipped. A failure is debugged with the trace (`pnpm test:e2e:report`), never by loosening an assertion: each one is a 2a "done when" item.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test:e2e` Expected: the list reporter ends with `N passed` (and the skipped desktop-only/mobile-only cases), no `failed`; the Dify specs (`chat*.spec.ts`, `completion.spec.ts`, `admin-apps.spec.ts`, …) stay green. Look at the new `e2e/screenshots/chat-agui-*.png` (three projects; not committed) and keep them for the PR's review (frontend conventions §4.6). Record the counts and the duration in the task's close note.

- [ ] **Step 6: Run the gates on the spec files and commit**

```bash
pnpm exec oxlint e2e/agui-admin.spec.ts e2e/agui-chat.spec.ts e2e/screenshots.spec.ts
pnpm exec oxfmt --check e2e/agui-admin.spec.ts e2e/agui-chat.spec.ts e2e/screenshots.spec.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
git add e2e/agui-admin.spec.ts e2e/agui-chat.spec.ts e2e/screenshots.spec.ts
git commit -m "test(e2e): the AG-UI chat and its admin against the stub producer

Test connection's answers, the save and an edit that keeps the secret;
streamed reasoning, text and tool cards in one turn, run errors, the
time limit, Stop in place, reload, rename and delete, the refusals
before a stream, and the JWT's claims (spec §10, §12).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["e2e/agui-admin.spec.ts", "e2e/agui-chat.spec.ts", "e2e/screenshots.spec.ts"], "verifyCommand": "pnpm test:e2e", "acceptanceCriteria": ["pnpm exec playwright test e2e/agui-admin.spec.ts e2e/agui-chat.spec.ts passes on desktop-light, desktop-dark and mobile-light (desktop-only cases skipped on mobile), 0 failed", "Admin: Test connection reads Connected / The key was refused / The agent was not found / The provider could not be reached for the stub's agent, another secret, /agui/agents/missing and /v1/unreachable; the saved app lists as AG-UI agent with the robot icon; an edit with a blank secret keeps secrets.jwtSecret and the chat still answers", "Chat: default scenario shows a Reasoning group and the stub agent text in one answer and /agui/_caller reports { sub: the owner's id, auth_source: 'local', roles: ['owner'] }; tool shows get_weather between the two texts with Arguments and Result; error usage_limit shows Usage limit reached and the stub's message; timeout shows Stopped: time limit; slow + Stop shows Stopped in the same bubble and /agui/_slow reports closedEarly true with fewer than 200 words; a reload restores the turns and the sidebar title; rename and delete survive a reload; the missing agent's app shows The agent was not found; invalid shows The agent refused the request", "pnpm test:e2e (whole suite, three projects) reports 0 failed"], "modelTier": "standard", "userGate": true, "tags": ["user-gate"]}
```

---

### Task 18: Records — ADR-0033, ADR-0034, the notes, the agent authors' guide, AGENTS.md and the progress table

**Goal:** Every record spec §11 names for 2a exists in the branch: ADR-0033 and ADR-0034 (status `proposed` until the owner's check), dated notes on ADR-0017, ADR-0023, ADR-0026 and ADR-0032, `docs/agui-agents.md`, the ADR index rows, AGENTS.md's Layout and Docker-gate lines, `docs/frontend-conventions.md`'s structure line, spec §0's 2a row and the running record's decision 59.

**Files:**

- Create: `docs/decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md`, `docs/decisions/0034-add-ag-ui-agents-as-a-provider.md`, `docs/agui-agents.md`
- Modify: `docs/decisions/README.md` (two index rows), `docs/decisions/0017-build-the-chat-on-ant-design-x.md`, `docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md`, `docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md`, `docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md` (a note each, at the end), `AGENTS.md` (Layout; the Docker gate's checks), `docs/frontend-conventions.md` (§4.1's structure line), `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` (§0's 2a row and Next line), `docs/superpowers/research/2026-10-11-provider-hub/README.md` (decision 59)

**Acceptance Criteria:**

- [ ] `ls docs/decisions/0033-*.md docs/decisions/0034-*.md` lists both files; each has frontmatter `status: proposed` and a `date:` of the day the task ran (`grep -c '^status: proposed$'` → 1 each).
- [ ] `grep -c '^| \[003[34]\]' docs/decisions/README.md` → 2.
- [ ] `grep -c 'Part 2a' docs/decisions/0017-*.md docs/decisions/0023-*.md docs/decisions/0026-*.md docs/decisions/0032-*.md` → at least 1 in each file.
- [ ] `docs/agui-agents.md` names the endpoint, the four headers, every JWT claim, the four pre-stream statuses, the five `RUN_ERROR` codes, `run_cancelled`/`run_timeout`, the Test connection probe and the five-minute silence limit (`grep -c` for `auth_source`, `run_timeout`, `422`, `five minutes` → each ≥ 1).
- [ ] `grep -n 'components/shared-chat/' AGENTS.md docs/frontend-conventions.md` finds a line in each; `grep -n 'api/apps/<an AG-UI app id>/runs' AGENTS.md` finds the Docker gate's new check; `wc -l < AGENTS.md` stays under 200.
- [ ] Spec §0's 2a row names this plan and `feat/agui-core`; `grep -n '^59\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md` finds the decision.
- [ ] `pnpm exec oxfmt --check` on every changed Markdown file reports no findings.

**Verify:** `ls docs/decisions/0033-*.md docs/decisions/0034-*.md docs/agui-agents.md && grep -c '^| \[003[34]\]' docs/decisions/README.md && wc -l < AGENTS.md` → three paths, `2`, a number below 200

**Steps:**

- [ ] **Step 1: Read what the records describe**

Read, in this order: the ADR template the repo follows (`docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md`: frontmatter, Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome, Consequences, Implementation Plan, Verification, More Information), the `adr-skill` (invoke it with the Skill tool: it holds the repo's ADR conventions and agent-readiness checklist), `git log --oneline fork/overhaul..HEAD` (Tasks 1–17's commits), and the files the ADRs name. Where an earlier task deviated from this plan (its commit message or the plan's "Deviations" notes say so), the record describes what was built, and the deviation is named under "More Information".

- [ ] **Step 2: Write ADR-0033**

Create `docs/decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md`:

```markdown
---
status: proposed
date: TODAY
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (Part 2 brainstorm, the AG-UI spike `agui-spike.md`, research notes `part2-*.md`, Part 2 spec and 2a plan)
---

# Use AG-UI as the hub's chat protocol, with a hub-side conversation store

## Context and Problem Statement

The provider hub (charter `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`) fronts AI apps of several providers. Until Part 2 every chat was Dify's: the browser spoke Dify's event stream through the hub's pass-through routes ([ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)), and Dify kept the conversations. AG-UI agents (Part 2; the owner's Pydantic AI service first) keep no conversations: every run receives the whole thread (`RunAgentInput.messages`) and answers with an AG-UI event stream. The hub therefore needs its own chat protocol toward the browser, its own conversation store, and one chat that Part 3 can move Dify onto.

The questions: which protocol the browser speaks; how the server consumes an agent (0.x and 1.0 producers both exist); how a run that produces several messages and tool calls fits Ant Design X's `useXChat` (one message per request, [ADR-0017](0017-build-the-chat-on-ant-design-x.md)); how Stop works when AG-UI defines no stop request; and how conversations are stored.

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)); each piece below cites the AG-UI 1.0 spec, the `@ag-ui/*` 1.0.2 typings and sources, or a reference hub (`part2-proxy-stop-identity.md`, `part2-x-mapping.md`, `part2-store-and-logs.md`).
- The owner's rule: "the agui shouldn't be pydantic specific. it should follow the spec and be universal" (record, 2026-10-11).
- The browser stays on Ant Design X ([ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), ADR-0017); no second UI stack.
- The agent's credentials and the thread's construction stay on the server (Microsoft Agent Framework's AG-UI security considerations: the trusted server builds `RunAgentInput`).
- History survives a reload, an agent restart and another device.
- Part 3 moves Dify onto the same API, store and UI.

## Considered Options

The browser's protocol:

- AG-UI events, re-encoded by the hub (`@ag-ui/encoder`)
- The hub's own event set
- Each provider's own stream, as today for Dify

How the server consumes an agent:

- `@ag-ui/client`'s `HttpAgent.runAgent()` with a subscriber
- `HttpAgent.run()` (raw events, no compatibility boundary)
- A hand-written SSE parser

The X message model:

- One X message per turn, holding ordered parts
- One X message per AG-UI message
- X's unreleased `AgentProvider`

The store:

- One row per AG-UI message, with runs and conversations
- An event log, folded on every read

## Decision Outcome

Chosen: AG-UI toward the browser, re-encoded by the hub; `runAgent()` on the server; one X message per turn; a hub-side stop route; one row per AG-UI message.

### Protocol and libraries

- The server runs each turn through `@ag-ui/client` 1.0.2's `HttpAgent.runAgent(parameters, subscriber)`, one new `HttpAgent` per run. `runAgent()` is the documented path, and the only one that applies the client's 0.x → 1.0 compatibility boundary, enforcement, chunk expansion and verification (`src/agent/agent.ts`; `run()` returns raw events). CopilotKit's runtime consumes agents the same way. The spike read Pydantic AI 2.56's 0.x stream and a spec-level 1.0 stub through it alike.
- The subscriber's `onEvent` sees each event before it is applied; `onMessagesChanged` and `onStateChanged` see the thread after it (`processApplyEvents`). The hub forwards events from the first and persists from the second.
- `@ag-ui/encoder`'s `EventEncoder.encodeSSE` writes each event toward the browser (one JSON event per `data:` line, the HTTP+SSE binding). `@ag-ui/core` gives the types and, on the server, `MessageSchema` for stored rows.
- `@ag-ui/client` and `@ag-ui/encoder` bring `rxjs`, `fast-json-patch` and a second zod (3.25.x, beside the hub's 4.6.5; `@ag-ui/proto` needs it too). They are server-only: the browser parses events with XRequest and a pure reducer and imports `@ag-ui/core` types only.
- The hub folds what the browser would need a library for: `STATE_DELTA` and `ACTIVITY_DELTA` go out as snapshots of the applied state; `RAW`, `REASONING_ENCRYPTED_VALUE` (kept in the stored message for the agent) and `MESSAGES_SNAPSHOT` are not sent.
- The first event of every run stream is the hub's `CUSTOM { name: 'hub:run', value: { conversationId, runId, title } }`.

### One X message per turn

A turn is a user message, or everything the agent answered to it across the runs that continued it, as ordered parts (`text`, `reasoning`, `tool` with its result merged, `activity`). `useXChat` writes one message per request (`x-sdk` 2.9.0 `useXChat`), so a turn is exactly what one request produces; `AgUiChatProvider.transformMessage` folds events with `applyAgUiEvent` (`lib/chat/turn.ts`), and the server groups stored rows into the same turns (`turnsFromMessages`), because "nothing on the wire carries run identity" (assistant-ui). assistant-ui, TanStack AI and X's unreleased AgentProvider demo group a run the same way. X's status is the transport; a turn's run outcome is AG-UI's.

### Stop

AG-UI defines no stop request, and a consumer that closes the connection has a truncated run (spec 1.0, lifecycle). The hub is the producer toward the browser, so `POST /api/apps/[appId]/conversations/[conversationId]/runs/[runId]/stop` aborts the upstream request through the run's `AbortController` (a Starlette agent sees `CancelledError` and its model call stops: spike), closes every open message, tool call and reasoning block toward the browser, drops `HttpAgent`'s own `RUN_ERROR { code: 'abort' }`, and ends with `RUN_FINISHED { outcome: { type: 'cancelled' } }`. CopilotKit's stop route and finaliser, LibreChat's `/chat/abort` and Open WebUI's task stop work the same way. A browser that goes away aborts upstream too (`request.signal`) and the run is stored `truncated`. Runs are tracked in an in-process map; several hub containers need a shared one (a follow-up, with the one-shot migrate service).

### The store

`conversations` (one per AG-UI thread; `active_run_id` for one active run; soft delete), `conversation_runs` (status `running`, `succeeded`, `interrupted`, `cancelled`, `failed`, `truncated`; outcome, resume, error, usage, custom events) and `conversation_messages` (one row per AG-UI message, `body` checked with `@ag-ui/core`'s `MessageSchema`, `seq` an identity column for the transcript order). Rows are upserted by message id while a run streams: on a message's start and end, a tool result, and at most every 2 s while text streams (PostgreSQL rewrites a whole row on every update). The 1.0 spec replays history as messages and snapshots, every reference hub stores messages, and Microsoft Agent Framework keeps "no raw events" (`part2-store-and-logs.md` §7.1). A deleted conversation is purged after 30 days by a daily croner job (`lib/chat/purge.ts`, registered beside the directory schedule).

### Consequences

- Good: one chat protocol and one store for every provider; Part 3 adds a translating adapter for Dify instead of a second chat.
- Good: 0.x and 1.0 agents work through the same client; the browser needs no AG-UI runtime.
- Good: Stop stops the agent's model call, and the partial answer is kept and marked.
- Bad: a second zod copy and `rxjs` in the server bundle.
- Bad: the hub now holds user conversations: retention, admin access (2c's Logs) and backups are the hub's job.
- Bad: the in-process run map ties a run to one hub container until it is shared.

## Implementation Plan

- Affected paths: `db/schema/conversations.ts` and its migration, `lib/data/conversations.ts`, `lib/chat/` (`turn.ts`, `thread.ts`, `statuses.ts`, `adapter.ts`, `active-runs.ts`, `stream.ts`, `session.ts`, `route.ts`, `schemas.ts`, `answers.ts`, `run.ts`, `purge.ts`), `app/api/apps/[appId]/{runs,conversations}/…`, `app/(user)/chat/actions.ts`, `components/shared-chat/`, `instrumentation.ts`.
- Dependencies: `@ag-ui/client`, `@ag-ui/core`, `@ag-ui/encoder` 1.0.2, exact.
- Pattern: provider adapters report `event`, `messages` and `state` to the run session (`ChatTurnSink`); nothing outside `lib/providers/agui/` constructs an `HttpAgent`.

### Verification

- `__tests__/chat-turn.test.ts`: the live reducer and the history grouping agree on every stub scenario.
- `__tests__/chat-session.test.ts`: `hub:run` first, deltas as snapshots, dropped event types, Stop's closing events and `RUN_FINISHED cancelled`.
- `__tests__/db/conversations-*.db.test.ts`: `seq` order, one active run, closing on stop, cascades, the purge.
- `e2e/agui-chat.spec.ts` on three projects: streaming, tool cards, errors, Stop (the stub reports the stream closed early), reload, rename and delete.

## More Information

- Spec: `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §3–§5; plan `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md` (plan calls P6–P11).
- AG-UI 1.0 spec: run input, HTTP + SSE transport, lifecycle (cancelled and truncated runs), state, activity (https://docs.ag-ui.com/spec/1.0/).
- Sources read: `@ag-ui/client` 1.0.2 `src/agent/agent.ts`, `src/agent/http.ts`, `src/apply/default.ts`, `src/transform/http.ts`; CopilotKit runtime `handlers/handle-stop.ts`, `packages/shared/src/finalize-events.ts`; assistant-ui `react-ag-ui` `run-aggregator.ts`.
- Running record decisions 40–57.
```

Then: `sed -i "s/^date: TODAY$/date: $(date +%F)/" docs/decisions/0033-*.md`. Expected: `grep -c "^date: $(date +%F)$" docs/decisions/0033-*.md` → `1`.

- [ ] **Step 3: Write ADR-0034**

Create `docs/decisions/0034-add-ag-ui-agents-as-a-provider.md`:

```markdown
---
status: proposed
date: TODAY
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (Part 2 brainstorm, `part2-proxy-stop-identity.md`, Part 2 spec and 2a plan)
---

# Add AG-UI agents as a provider

## Context and Problem Statement

[ADR-0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md) made apps provider-neutral, with Dify as the first provider and a checklist for the next. The owner's agents are a separate Python service (Pydantic AI over AG-UI) that never sees the browser or NextAuth, trusts only the hub's server, and verifies every request itself (running record decision 45; the owner gave its contract on 2026-10-14). AG-UI leaves authentication to the binding: "AG-UI defines no credential" (spec 1.0, transports), and it defines no health or discovery endpoint.

The questions: what an AG-UI app stores, how the hub proves who the user is to the agent, how Test connection checks an agent, and how far the provider set should be configurable by admins.

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)).
- ADR-0032's checklist and its rules: zod documents parsed on every write and read, write-only secrets, a provider fixed at creation, saving never calls the provider.
- The agent can verify identity and role itself; a secret that leaks from the network path must not let anyone act as any user (the owner: "anyone holding the static secret can claim to be any user, roles can't be passed in a way the agent can trust, and the secret never expires").
- Minimal disclosure: no email or name leaves the hub (AGENTS.md: the owner's email goes to no other service).
- Test connection must not start a model run.

## Considered Options

The agent's credentials:

- A per-request signed JWT (HS256, a per-app secret) as the only auth header
- A static bearer plus a plain user-id header (Open WebUI's and LibreChat's default)
- Forwarding the user's own token (CopilotKit's self-hosted examples; the hub has session cookies, not tokens an agent can verify)

Test connection:

- POST an invalid `RunAgentInput` (`{}`) and read the status
- A framework health route (`/health`, `/ping`, `/ok`, `/info`)
- A minimal real run

Admin-defined providers:

- The registry and standard protocols only (AG-UI now, OpenAI-compatible next); an exotic backend gets a small AG-UI shim beside it
- An admin-configured "HTTP template" provider in the app settings

## Decision Outcome

Chosen: the per-request JWT, the `{}` probe, and the registry with standard protocols.

### The documents

`settings`: `agentUrl` (an http(s) URL of at most 500 characters, the full endpoint the hub POSTs to) and `audience` (1–255 characters, the JWT `aud`). `secrets`: `jwtSecret`, 32–512 characters after trimming, used as its UTF-8 bytes. Write-only, as Dify's key: the admin DTO carries `secretsSet: { jwtSecret }`, and a blank field on Edit keeps the stored value. Later slices add `askUser` (2b) and the attachment settings (2c) with zod defaults, so a document written now still parses. The chat DTO carries none of these in 2a.

### The JWT

`jose`'s `SignJWT` (its HMAC example), minted fresh for every upstream request (each run and each Test connection): header `{ alg: 'HS256', typ: 'JWT' }`; `sub` the account's permanent id ([ADR-0026](0026-use-the-accounts-permanent-id-as-the-dify-end-user.md)), `iat` now, `exp` now + 60 s (the owner's agent allows 10 s of clock skew), `iss` `AGENT_JWT_ISSUER` (default `nextjs-bff`), `aud` the app's audience, `auth_source` `local` or `ldap`, `roles` `[role]`. No name, no email; the NextAuth token is never forwarded. It is the only auth header (`Authorization: Bearer <JWT>`), beside `Content-Type: application/json` and `Accept: text/event-stream`; no browser header is forwarded (CopilotKit's rule: server-set headers win). Open WebUI's `X-OpenWebUI-User-Jwt` and the IETF Transaction Tokens draft carry identity the same way: a short-lived signed token the receiver verifies.

### Errors before the stream

The agent answers 401 (bad or expired token), 404 (unknown agent), 415 (not JSON) and 422 (invalid body) before any stream; the hub answers them as 502 `agent_auth_failed`, `agent_not_found` and `agent_rejected_input`, any other refusal as 502 `upstream_error`, and a refused connection or no answer as 503 `provider_unreachable`. In-stream `RUN_ERROR` codes (`usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`) pass through with their message, which the owner's agent makes safe to show; a time limit is `CUSTOM run_cancelled { reason: 'run_timeout' }` then `RUN_FINISHED`, stored as cancelled.

### Test connection, the hub's own convention

`POST agentUrl` with body `{}` (valid JSON, an invalid `RunAgentInput`) and a fresh JWT whose `sub` is the admin running it, given up after 10 s (`AbortSignal.timeout`). 422 or 400: reachable (the token passed and the body was refused before any run); 401 or 403: key refused; 404: agent not found; 415 or another 4xx: upstream error; a refused connection, the timeout or a 5xx: unreachable; a 2xx event stream: the body is cancelled at once and the result is reachable with the warning "ran on invalid input". No error body is read. No AG-UI document describes a reachability check; this one follows the spec's rule that refused input gets "a plain HTTP error status with no stream" (`part2-proxy-stop-identity.md` §5). The body is `{}` and not broken JSON because FastAPI decodes JSON before its auth dependencies run, so broken JSON would answer 422 without checking the token.

### The rule of decision 52

The browser contract is AG-UI; backends plug in through the provider registry and standard protocols. An admin-configured "HTTP template" provider for text-only APIs is kept as an idea for later (running record, "Ideas kept for later"); admin-uploaded adapter code (Open WebUI's Pipe functions) is not adopted.

### Consequences

- Good: the agent verifies identity, source and role on every request; a token expires in a minute.
- Good: Test connection works for any spec-following agent without a model call.
- Bad: each app has a shared secret to rotate on both sides; it is plain text in `apps.secrets` until the encryption follow-up (decision 8).
- Bad: an agent that validates its body before its auth answers 422 to a bad token, so Test connection then proves reachability only (the caveat is in `docs/agui-agents.md`).

## Implementation Plan

- Affected paths: `lib/providers/agui/` (`schema.ts`, `jwt.ts`, `test-connection.ts`, `chat.ts`, `provider.ts`), `lib/providers/{ids,schemas,registry,connection,caller}.ts`, `lib/env.ts` (`AGENT_JWT_ISSUER`), `lib/auth/session.ts` (`SessionUser.source`), `components/provider-ui/agui/form-section.tsx`, the `agui_provider` migration (the CHECK), `docs/agui-agents.md`.
- Dependency: `jose` 6.2.12, exact (no dependencies of its own).

### Verification

- `__tests__/agui-jwt.test.ts` (claims checked with `jwtVerify` and a fixed clock), `__tests__/agui-test-connection.test.ts` (one case per row above), `__tests__/agui-chat.test.ts` (headers, body, each pre-stream status).
- `e2e/agui-admin.spec.ts`: an admin adds an AG-UI app with Test connection; `e2e/agui-chat.spec.ts`: the stub verifies the JWT as the owner's service does and answers 401 otherwise.

## More Information

- Spec §2; plan `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md` (plan calls P1, P2, P4, P5).
- jose `SignJWT` and `jwtVerify` (https://github.com/panva/jose); PyJWT `jwt.decode` for the agent side (`docs/agui-agents.md`).
- Running record decisions 45 and 52; memory `agent-service-contract`.
```

Then: `sed -i "s/^date: TODAY$/date: $(date +%F)/" docs/decisions/0034-*.md`. Expected: `grep -c "^date: $(date +%F)$" docs/decisions/0034-*.md` → `1`.

- [ ] **Step 4: The index rows**

In `docs/decisions/README.md`, after the row of `[0032]`, add (the date column is the day the task ran: run the `sed` below after inserting the rows as written):

```markdown
| [0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md) | Use AG-UI as the hub's chat protocol, with a hub-side conversation store | proposed | TODAY | | [0034](0034-add-ag-ui-agents-as-a-provider.md) | Add AG-UI agents as a provider | proposed | TODAY |
```

Run: `sed -i "s/| proposed | TODAY |$/| proposed | $(date +%F) |/" docs/decisions/README.md && grep -c '^| \[003[34]\]' docs/decisions/README.md` Expected: `2`.

- [ ] **Step 5: The notes on ADR-0017, ADR-0023, ADR-0026 and ADR-0032**

Append one paragraph at the end of each file (a blank line before it), then run `sed -i "s/^Note, TODAY (Part 2a/Note, $(date +%F) (Part 2a/" docs/decisions/0017-*.md docs/decisions/0023-*.md docs/decisions/0026-*.md docs/decisions/0032-*.md`.

`docs/decisions/0017-build-the-chat-on-ant-design-x.md`:

```markdown
Note, TODAY (Part 2a, the shared chat): AG-UI apps chat in `components/shared-chat/`, on the same X patterns: `useXChat` with one provider per conversation key, `AgUiChatProvider` implementing only `AbstractChatProvider`'s three transforms, `defaultMessages` from the server's history, `queueRequest` while it loads, `temp:<uuid>` keys that never change in a page session, and a side store through `useSyncExternalStore`. One X message is one turn: the user message, or everything the agent answered to it, as ordered parts ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md)). Stop calls the hub's stop route and the turn finishes in place with "Stopped"; `chat.abort()` is the fallback when that call fails, with `requestFallback` keeping what streamed. This record's "one `DifyChatProvider`" is superseded once Part 3 moves Dify onto the shared chat.
```

`docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md`:

```markdown
Note, TODAY (Part 2a, the shared chat routes): the shared chat's routes live beside the Dify routes, under `app/api/apps/[appId]/`: `POST runs`, `GET conversations`, `GET conversations/[conversationId]` and `POST conversations/[conversationId]/runs/[runId]/stop`, one Route Handler per operation, guarded by `resolveChatRoute` (this record's order: session, UUID, visibility, enabled, then a provider with a chat adapter) and answering the same envelope. Unlike the Dify routes they pass nothing through: the run route streams AG-UI events the hub re-encodes ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md)), and the others answer the hub's own store. Rename and delete are Server Actions (`app/(user)/chat/actions.ts`, [ADR-0024](0024-keep-the-apps-own-data-behind-a-data-access-layer-with-server-actions-and-gate-the-admin-surface-by-role.md)): the conversations are the hub's own data.
```

`docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md`:

```markdown
Note, TODAY (Part 2a, AG-UI agents): the same permanent account id is the `sub` of the JWT the hub signs for every AG-UI request ([ADR-0034](0034-add-ag-ui-agents-as-a-provider.md)), with `auth_source` and `roles` beside it and no email or name. `SessionUser` now carries the account's `source`, which the session callback already exposed (next-auth "Callbacks").
```

`docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md`:

```markdown
Note, TODAY (Part 2a, the second provider): `'agui'` followed this record's checklist ([ADR-0034](0034-add-ag-ui-agents-as-a-provider.md)): the id, the migration that replaces `apps_provider_check`, the schemas and defaults, the server definition, `PROVIDER_UI.agui` (`RobotOutlined`, "AG-UI agent", no app types), its form section, its `ProviderChat` case and the `provider.agui` key. The registry changed with it: `testConnection` takes the caller (the admin, for the JWT's `sub`), `chatFields` and `summaryFields` are typed per provider instead of `object`, and a definition carries `hubHistory` and an optional `chat` adapter ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md)). Issue #62's items for the second provider are done: the typed fields, the client registry's app-type cast (Dify's lookup is typed), and M5 (an app whose settings read but whose secrets do not opens Edit on its stored settings).
```

Run: `grep -c 'Part 2a' docs/decisions/0017-*.md docs/decisions/0023-*.md docs/decisions/0026-*.md docs/decisions/0032-*.md` Expected: `1` for each.

- [ ] **Step 6: The agent authors' guide**

Create `docs/agui-agents.md`:

````markdown
# AG-UI agents in the hub

For the authors of agents an AG-UI app in the hub points at. The hub is an AG-UI 1.0 consumer ([ADR-0033](decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md), [ADR-0034](decisions/0034-add-ag-ui-agents-as-a-provider.md)); anything that follows the AG-UI spec over HTTP + SSE works, and a 0.x producer (Pydantic AI on `ag-ui-protocol` 0.1.x) works too.

## The app's settings

| Field | What it is |
| --- | --- |
| Agent URL | The full endpoint the hub POSTs to, e.g. `http://agents:8000/agents/assistant`. The hub's server calls it; the browser never does, so a Docker service name is fine. |
| Audience | The JWT's `aud`; your agent checks it, e.g. `assistant`. |
| JWT secret | 32–512 characters, shared with your agent: `openssl rand -base64 48`. Never the hub's `NEXTAUTH_SECRET`. Stored write-only; leave it blank on Edit to keep it. |

The issuer is the hub-wide `AGENT_JWT_ISSUER` (default `nextjs-bff`).

## Each request

`POST <Agent URL>` with:

- `Content-Type: application/json`
- `Accept: text/event-stream`
- `Authorization: Bearer <JWT>`, the only credential. No browser header and no NextAuth token reach your agent.
- The body: the AG-UI `RunAgentInput`, built by the hub from its own store: `threadId` (the hub's conversation id), `runId` (new for every run), `messages` (the whole thread: user, assistant with tool calls, tool results, reasoning with any `encryptedValue` you sent; activity messages stripped), `state` (your last state), `tools` (`[]`: the hub advertises no tools yet), `context` `[]`, `forwardedProps` `{}`, and `resume` when the user answered your interrupts.

Your agent is stateless: the hub re-sends the whole history every run.

## The JWT

HS256, signed with the app's JWT secret as UTF-8 bytes, minted fresh for every request (each run and each Test connection):

| Claim         | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `sub`         | the user's permanent account id (a UUID); never an email |
| `iat`         | now                                                      |
| `exp`         | now + 60 s                                               |
| `iss`         | `AGENT_JWT_ISSUER` (default `nextjs-bff`)                |
| `aud`         | the app's Audience                                       |
| `auth_source` | `local` or `ldap`                                        |
| `roles`       | `["owner"]`, `["admin"]` or `["user"]`                   |

No `name` and no `email`. Verify every request, for example with PyJWT ("Usage Examples": `algorithms`, `audience`, `issuer`, `leeway`, `options.require`):

```python
import jwt

claims = jwt.decode(
    token,
    secret.encode(),
    algorithms=['HS256'],
    audience='assistant',
    issuer='nextjs-bff',
    leeway=10,
    options={'require': ['exp', 'iat', 'sub', 'iss', 'aud']},
)
```

Then put `claims['sub']`, `claims['auth_source']` and `claims['roles']` into your run's dependencies, and authorise sensitive tools there, not from anything in the body (Pydantic AI: "UI adapter endpoints aren't authentication boundaries").

## Answering

Before any stream, answer with a plain HTTP status and no event stream:

| Status | When | The user sees |
| --- | --- | --- |
| 401 | a missing, bad or expired token | "The agent refused the hub's credentials" (`agent_auth_failed`) |
| 404 | an unknown agent | "The agent was not found" (`agent_not_found`) |
| 415 | a body that is not JSON | "The agent refused the request" (`agent_rejected_input`) |
| 422 | a body that is not a valid `RunAgentInput` | the same |

A refused connection reads as "The agent is restarting, try again" (`provider_unreachable`). Any other status before the stream is an upstream error.

In the stream, a failure is `RUN_ERROR` with a `code` and a `message` the user may read. The hub titles these codes: `usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`; any other code gets a generic title. A run that hits your time limit sends `CUSTOM { name: 'run_cancelled', value: { reason: 'run_timeout' } }` and then `RUN_FINISHED`; the hub keeps the partial answer and shows "Stopped: time limit".

The hub shows text, reasoning, tool calls with their results, and run errors. It does not show `RAW` events or `REASONING_ENCRYPTED_VALUE` (it keeps the value in the stored message and sends it back with the history).

## Stop and silence

The user's Stop closes the hub's request to your agent. On Starlette (FastAPI, Pydantic AI's `AGUIAdapter`) the stream sees `CancelledError` and the model call stops; the hub keeps what arrived and marks the turn "Stopped". Tool calls you started and did not answer come back in the next run's history with a `tool` message whose `error` is `stopped`.

The hub's HTTP client gives up after five minutes without a byte from your agent. If a tool can run longer, send something before that: an SSE comment line (`: keep-alive`), which AG-UI consumers must tolerate, or a progress event.

## Test connection

The app form's Test connection POSTs `{}` (valid JSON, not a valid `RunAgentInput`) with a fresh JWT whose `sub` is the admin running it, and waits up to 10 seconds:

| Your answer | The form shows |
| --- | --- |
| 422 or 400 | Connected |
| 401 or 403 | The secret was refused |
| 404 | The agent was not found |
| 415 or another 4xx | The agent answered with an error |
| no answer, the timeout, or a 5xx | The agent could not be reached |
| a 2xx event stream | Connected, with a warning: your agent started a run on invalid input (the hub closes it at once) |

Check the token before validating the body, so a wrong secret shows as refused rather than "Connected". FastAPI runs auth dependencies before body validation for well-formed JSON, which is why the probe is `{}`.
````

Run: `grep -c 'auth_source' docs/agui-agents.md; grep -c 'run_timeout' docs/agui-agents.md; grep -c '422' docs/agui-agents.md; grep -c 'five minutes' docs/agui-agents.md` Expected: each at least `1`.

- [ ] **Step 7: AGENTS.md and the frontend conventions**

In `AGENTS.md`, section "Layout", replace the `components/` bullet's first sentence:

```markdown
- `components/`: client components by area (`providers/` with the single client provider stack, `shell/`, `apps/`, `admin/`, `auth/`, `chat/`, `provider-ui/`, the client provider registry: labels, fallback icons, form sections and `ProviderChat`, ADR-0032); token-only CSS Modules, and antd's `reset.css` is the only global CSS (ADR-0021).
```

with:

```markdown
- `components/`: client components by area (`providers/` with the single client provider stack, `shell/`, `apps/`, `admin/`, `auth/`, `chat/` (the Dify chat until Part 3), `shared-chat/` (the AG-UI chat on the hub's store, ADR-0033), `provider-ui/`, the client provider registry: labels, fallback icons, form sections and `ProviderChat`, ADR-0032); token-only CSS Modules, and antd's `reset.css` is the only global CSS (ADR-0021).
```

and in the `lib/` bullet replace `` `providers/` (the provider ids, document schemas, server registry and route guard, with `dify/` as the Dify layer; ADR-0023, ADR-0032), `` with `` `providers/` (the provider ids, document schemas, server registry and route guard, with `dify/` as the Dify layer and `agui/` as the AG-UI one; ADR-0023, ADR-0032, ADR-0034), `chat/` (the shared chat's server side: turns, the run session, the routes' guard and the purge; ADR-0033), ``.

In "Docker stack (the real check before merging)", after `` `/api/branding/logo` signed out → 404 `{"code":"not_found",…}` while `BRANDING_MODE` is unset (the brand routes are public, ADR-0030; a 401 would mean the proxy's public list lost them), `` insert `` `POST /api/apps/<an AG-UI app id>/runs`, `GET /api/apps/<an AG-UI app id>/conversations` and `POST /api/apps/<an AG-UI app id>/conversations/<any UUID>/runs/<any UUID>/stop` signed out → the same 401 envelope (ADR-0033), ``.

Run: `wc -l < AGENTS.md` Expected: below `200`.

In `docs/frontend-conventions.md` §4.1, the first bullet's parenthesis, after `` the provider UI in `components/provider-ui/` `` insert ``; the shared chat in `components/shared-chat/` and its server side in `lib/chat/` since Part 2a, ADR-0033``.

- [ ] **Step 8: Spec §0 and the running record**

In `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §0, replace the 2a row's Build cell `—` with `built (Tasks 1–17), records (Task 18); gates and the Docker gate: Task 19`, and set the Next line to: `**Next:** 2a's gates and Docker gate (Task 19 of docs/superpowers/plans/2026-10-14-part-2a-agui-core.md) on feat/agui-core, then the owner's check, then the PR.`

In `docs/superpowers/research/2026-10-11-provider-hub/README.md`, after decision 58 (the plan's PR) and before "## Ideas kept for later", add:

```markdown
59. **2a is built** (TODAY): Tasks 1–18 of `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md` on `feat/agui-core`, subagent-driven; ADR-0033 and ADR-0034 proposed. Deviations from the plan, if any, are listed in the PR description. Next: the gates, the Docker gate and the owner's check (Task 19).
```

Run: `sed -i "s/^59\. \*\*2a is built\*\* (TODAY)/59. **2a is built** ($(date +%F))/" docs/superpowers/research/2026-10-11-provider-hub/README.md && grep -n '^59\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md` Expected: one line with today's date.

- [ ] **Step 9: Format check and commit**

Run: `pnpm exec oxfmt --check docs/decisions/0033-*.md docs/decisions/0034-*.md docs/decisions/README.md docs/decisions/0017-*.md docs/decisions/0023-*.md docs/decisions/0026-*.md docs/decisions/0032-*.md docs/agui-agents.md AGENTS.md docs/frontend-conventions.md docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md` Expected: no findings (if oxfmt reports a file, run it with `--write` on that file and re-check).

```bash
git add docs/decisions/0033-*.md docs/decisions/0034-*.md docs/decisions/README.md docs/decisions/0017-*.md docs/decisions/0023-*.md docs/decisions/0026-*.md docs/decisions/0032-*.md docs/agui-agents.md AGENTS.md docs/frontend-conventions.md docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
git commit -m "docs(agui): record ADR-0033 and ADR-0034, the agent authors' guide and 2a's progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["docs/decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md", "docs/decisions/0034-add-ag-ui-agents-as-a-provider.md", "docs/decisions/README.md", "docs/decisions/0017-build-the-chat-on-ant-design-x.md", "docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md", "docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md", "docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md", "docs/agui-agents.md", "AGENTS.md", "docs/frontend-conventions.md", "docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md", "docs/superpowers/research/2026-10-11-provider-hub/README.md"], "verifyCommand": "ls docs/decisions/0033-*.md docs/decisions/0034-*.md docs/agui-agents.md && grep -c '^| \\[003[34]\\]' docs/decisions/README.md && wc -l < AGENTS.md", "acceptanceCriteria": ["ADR-0033 and ADR-0034 exist with status proposed and today's date", "two index rows for 0033 and 0034 in docs/decisions/README.md", "a Part 2a note at the end of ADR-0017, ADR-0023, ADR-0026 and ADR-0032", "docs/agui-agents.md names the endpoint, headers, every JWT claim, the pre-stream statuses, the RUN_ERROR codes, run_timeout, the Test connection probe and the five-minute silence limit", "AGENTS.md and docs/frontend-conventions.md name components/shared-chat/; AGENTS.md lists the new signed-out checks and stays under 200 lines", "spec §0's 2a row and Next line updated; running record decision 59 written", "oxfmt --check clean on every changed Markdown file"], "modelTier": "mechanical"}
```

---

### Task 19: Final verification and the Docker gate

**Goal:** Every whole-branch gate exits clean (Steps 1–6); then, only after the owner's captured go-ahead, the owner's local stack is backed up (the `part1` image tag and a mode-600 dump with 12 tables), rebuilt from this branch, and shows `Database migration complete` once, RestartCount 0, six migration rows, `apps_provider_check` allowing `'agui'`, no `@ag-ui/client` or `@ag-ui/encoder` code in the browser bundle, and the signed-out checks of AGENTS.md plus the three new 401s.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §0 ("Gates: AGENTS.md's, then the Docker gate"), §10 ("Docker gate") and §12. No earlier task touches the owner's stack (`ai-app-hub-local`, `docker-compose.local.yml`, port 5300, PostgreSQL on 127.0.0.1:5432); this one does so only after the owner's word (Step 7). The two migrations are additive (three new tables, and `apps_provider_check` dropped and re-added with `'agui'`, which every stored `'dify'` row satisfies), and the migrator applies all pending migrations in one transaction (ADR-0031), so a failure leaves the database as it was; the backup is still taken, always, as in Part 1, and Step 14 is the written way back.

**Files:** none changed in the repository, except Step 15 (on the owner's word, after their check). Outside it: the backup `~/ai-app-hub-backups/local-before-part2a.sql` (Step 8) and the image tag `ai-app-hub-local-app:part1` (Step 8), kept until the owner lets them go.

**Acceptance Criteria:**

- [ ] Steps 1 to 6 are green on the whole branch: tsc; oxlint and oxfmt on the changed files; `npx -y @ant-design/cli lint ./ --format json` with `"total"` at the count `docs/frontend-conventions.md` records (0); `pnpm i18n:lint` ("No issues found.") and `pnpm i18n:status` (zh and ar at 100%); Step 2's three greps print nothing; `pnpm test`; `pnpm test:db`; `pnpm test:ldap`; `pnpm test:e2e` with 0 failed on desktop-light, desktop-dark and mobile-light.
- [ ] The owner's explicit go-ahead to Step 7's message is captured before Step 8; nothing touches `ai-app-hub-local` before it.
- [ ] The old image is tagged `ai-app-hub-local-app:part1` (never overwritten), and `~/ai-app-hub-backups/local-before-part2a.sql` exists with mode `600`, a size above zero and `12` `CREATE TABLE` lines.
- [ ] After the rebuild: `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` prints `1`; `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` prints `0`; `drizzle.__drizzle_migrations` lists six rows ending in `_agui_provider` and `_conversations`; `pg_get_constraintdef` of `apps_provider_check` contains `'agui'`; the three tables exist.
- [ ] Step 11's bundle check prints `0` twice (`[ag-ui]` and `@ag-ui/` in `.next/static`).
- [ ] Step 12's signed-out checks: `/api/health` 200; `/apps` 307 to `http://localhost:5300/login?callbackUrl=%2Fapps`; `/api/dify/<app id>/parameters`, `/api/client/apps`, `/api/users`, `/api/init/status`, `POST /api/apps/<id>/runs`, `GET /api/apps/<id>/conversations`, `POST /api/apps/<id>/conversations/<uuid>/runs/<uuid>/stop` 401 with `{"code":"unauthorized",…}`; `/api/branding/logo` 404 with `{"code":"not_found",…}` (BRANDING_MODE unset); `/init` 307 to `http://localhost:5300/login`; `grep -c 'href="/forgot-password"'` on `/login` → `0`; `grep -c 'id="antd-cssinjs"'` → `1`.

**Verify:** `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` → `1` then `0`

**Interfaces:** consumes every earlier task. Nothing in `.env` or `.env.development.local` is read or printed: inside the PostgreSQL container, `psql` reads the database's name and user from the container's own `POSTGRES_*` variables (`sh -c '… "$POSTGRES_USER" …'`).

- [ ] **Step 1: Static gates on the whole branch**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD -- '*.ts' '*.tsx')` Expected: no findings.

Run: `pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD -- ':!db/migrations')` Expected: no findings (`db/migrations/**` stays as drizzle-kit wrote it).

Run: `npx -y @ant-design/cli lint ./ --format json` Expected: `"summary": { "total": 0, …}` (the ratchet in `docs/frontend-conventions.md`).

Run: `pnpm i18n:lint && pnpm i18n:status` Expected: "No issues found." and `zh` and `ar` at 100%.

- [ ] **Step 2: The boundaries**

Run: `git grep -nE "from '@ag-ui/(client|encoder)'" -- components app hooks ':!app/api'` Expected: no output (spec §9: the browser carries none of their runtime; the route handlers under `app/api` are server code).

Run: `git grep -nE "^import [^t].*from '@ag-ui/core" -- components lib/chat/turn.ts` Expected: no output (client code imports `@ag-ui/core` with `import type` only; `lib/chat/turn.ts` is client-safe).

Run: `git grep -lE "from '@/lib/providers/(dify|agui)" -- app components hooks lib db ':!lib/providers' ':!components/provider-ui' ':!components/chat' ':!app/api/dify'` Expected: no output (`__tests__/provider-boundary.test.ts` pins the Dify half; AG-UI's module is reached only through the registry).

- [ ] **Step 3: The unit suite**

Run: `pnpm test` Expected: PASS.

- [ ] **Step 4: The live database suite**

Run: `pnpm test:db` Expected: PASS, the three `conversations-*.db.test.ts` files among them; the teardown stops the e2e PostgreSQL.

- [ ] **Step 5: The directory suite**

Run: `pnpm test:ldap` Expected: PASS (Task 2 changed `verifySession`, which the directory sign-in's sessions pass through).

- [ ] **Step 6: The e2e suite on an empty PostgreSQL**

Stop `pnpm dev` if it runs, and make sure `pnpm test:db` is not running. Run: `docker compose -f docker-compose.e2e.yml --profile ldap down -v && pnpm test:e2e` Expected: 0 failed on `desktop-light`, `desktop-dark` and `mobile-light`; the setup project seeds the two AG-UI apps (Task 13), and every Dify spec passes beside `e2e/agui-admin.spec.ts` and `e2e/agui-chat.spec.ts`.

Then free the memory the Docker build needs (about 5 GB on this machine): `docker compose -f docker-compose.e2e.yml --profile ldap down`.

- [ ] **Step 7: Stop and ask the owner before touching their stack**

Send the owner this and wait for their word:

> Part 2a passes every gate (tsc, oxlint, oxfmt, the antd lint, the i18next checks, `pnpm test`, `pnpm test:db`, `pnpm test:ldap`, the e2e suite on three projects). The Docker gate is next, on your local stack; the app is down for about two minutes during the rebuild, and PostgreSQL stays up.
>
> 1. I keep the old image as `ai-app-hub-local-app:part1` and stop the app container, then dump the database to `~/ai-app-hub-backups/local-before-part2a.sql` (mode 600, outside the repo; it holds your apps' keys and secrets and the password hashes in plain text, and I never print it).
> 2. I rebuild from `feat/agui-core`. Its entrypoint applies two migrations: three new tables for the conversations, and the provider check widened to allow AG-UI apps. Nothing existing changes.
> 3. The checks: the migration log, the restart count, the browser bundle, and AGENTS.md's signed-out curls plus three for the new routes.
>
> If you want Part 1 back afterwards, Step 14 restores the dump and the old image, on your word only; it drops anything written after the backup (conversations, apps or accounts added during your check). May I go ahead?

- [ ] **Step 8: Keep the old image, take the app down, back up (after the owner's word)**

```bash
docker compose -f docker-compose.local.yml ps --format '{{.Name}} {{.Status}}'
```

Expected: `ai-app-hub-local-app` and `ai-app-hub-local-postgres` running, the second `(healthy)`. If PostgreSQL is not running, stop and tell the owner instead of starting it.

```bash
if docker image inspect ai-app-hub-local-app:part1 >/dev/null 2>&1; then
  echo 'ai-app-hub-local-app:part1 already exists: stop and ask the owner'
else
  docker image tag ai-app-hub-local-app:latest ai-app-hub-local-app:part1 &&
    docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
fi
```

Expected: no "already exists" line; the app container stopped and removed (Compose tags a built service's image `<project>-<service>`; the tag is never overwritten: an earlier attempt's `:part1` may be the only copy).

```bash
install -d -m 700 "$HOME/ai-app-hub-backups"
(umask 077 && set -o noclobber && docker compose -f docker-compose.local.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$HOME/ai-app-hub-backups/local-before-part2a.sql")
stat -c '%a %s' "$HOME/ai-app-hub-backups/local-before-part2a.sql"
grep -c '^CREATE TABLE' "$HOME/ai-app-hub-backups/local-before-part2a.sql"
docker image inspect -f '{{.Id}}' ai-app-hub-local-app:part1
```

Expected: `600` and a size above zero; `12` (Part 1's eleven tables and `drizzle.__drizzle_migrations`); the old image's id. `noclobber` refuses to overwrite an earlier backup: stop and ask the owner what to do with it. If anything is not as expected, bring the old app back (`docker compose -f docker-compose.local.yml up -d --no-build app`; Compose `up --no-build`: "Don't build an image", so it starts the old `:latest`), check `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` → `200`, and report. Never `cat`, `head` or `grep` lines out of the dump.

- [ ] **Step 9: Rebuild the app container (AGENTS.md "Docker stack")**

Never build this folder's image while the `fork/main` folder builds its own. The app container is already down:

```bash
docker compose -f docker-compose.local.yml up -d --build app
```

Expected: about two minutes (80 s of it `next build`). If the build is killed for memory, do not restart it unprompted (AGENTS.md): bring the old app back as Step 8's failure path does and report.

- [ ] **Step 10: The migration on the real database**

- `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` Expected: `1`.
- `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` Expected: `0` (a failed migration rolls back and shows as a restart loop here; then Step 14).
- `docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at"'` Expected: six lines: `<14 digits>_baseline`, `_apps_expand`, `_apps_data`, `_apps_contract`, `_agui_provider`, `_conversations`.

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'apps_provider_check';
SELECT string_agg(tablename, ' ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'conversation%';
SELECT 'apps ' || count(*) FROM apps;
SQL
```

Expected: a `CHECK` definition naming both `'dify'` and `'agui'` (PostgreSQL 18 "System Information Functions": `pg_get_constraintdef`); `conversation_messages conversation_runs conversations`; the apps count as before the rebuild (the owner's apps are untouched).

- [ ] **Step 11: The browser bundle carries no AG-UI client runtime (spec §9)**

```bash
docker compose -f docker-compose.local.yml exec -T app sh -c "grep -rlF '[ag-ui]' .next/static | wc -l; grep -rlF '@ag-ui/' .next/static | wc -l"
```

Expected: `0` and `0`. `[ag-ui]` prefixes every warning `@ag-ui/client` 1.0.2 logs (`src/enforce/enforce.ts`, `src/agent/agent.ts`), so a client chunk that bundled it would contain the string; the image's static chunks are at `/app/.next/static` (Dockerfile: `COPY --from=builder /app/.next/static ./.next/static`). If either count is above zero, report the files to the owner and stop: a client module imports more than `@ag-ui/core`'s types.

- [ ] **Step 12: The signed-out checks (AGENTS.md's list plus the new routes), then the report**

Run each with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>` unless a body is named. `<app id>` is any id from `docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT id FROM apps LIMIT 1"'`; `<uuid>` is any UUID (`cat /proc/sys/kernel/random/uuid`), since a signed-out request never reaches a handler.

| Request | Expected |
| --- | --- |
| `localhost:5300/api/health` | `200` |
| `localhost:5300/apps` | `307 http://localhost:5300/login?callbackUrl=%2Fapps` |
| `curl -s localhost:5300/api/dify/<app id>/parameters` | `{"code":"unauthorized",…}` with 401 (`-w '%{http_code}'`) |
| `curl -s localhost:5300/api/client/apps` | the same 401 envelope |
| `curl -s localhost:5300/api/users` and `/api/init/status` | the same 401 envelope |
| `curl -s -X POST -H 'Content-Type: application/json' -d '{}' localhost:5300/api/apps/<app id>/runs` | the same 401 envelope |
| `curl -s localhost:5300/api/apps/<app id>/conversations` | the same 401 envelope |
| `curl -s -X POST localhost:5300/api/apps/<app id>/conversations/<uuid>/runs/<uuid>/stop` | the same 401 envelope |
| `curl -s localhost:5300/api/branding/logo` | 404 `{"code":"not_found",…}` while `BRANDING_MODE` is unset |
| `localhost:5300/init` | `307 http://localhost:5300/login` |
| `curl -s localhost:5300/login \| grep -c 'href="/forgot-password"'` | `0` while SMTP is off |
| `curl -s localhost:5300/login \| grep -c 'id="antd-cssinjs"'` | `1` |

Then report to the owner: Steps 1–12's results, the two migration names, the apps count, and what to check in the browser (spec §12, "2a done when"): add an AG-UI app pointing at their agent service with Test connection; chat with it (text, reasoning and tool cards stream into one turn); Stop ends a run in place and the agent stops; a reload restores the conversation; rename and delete work. Wait for their word.

- [ ] **Step 13: Record the owner's check**

When the owner reports, write their words and the date into spec §0's 2a row (Build cell: `gates and Docker gate passed; owner's check <date>: "<their words>"`) and the running record (decision 60, in the shape of decision 39), and commit:

```bash
git add docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
git commit -m "docs(agui): record 2a's gates and the owner's check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If the owner reports a problem instead, it becomes a fix on this branch (superpowers-extended-cc:systematic-debugging), and Steps 1–12 run again for what it touched.

- [ ] **Step 14: The way back (only on the owner's word)**

Restore Part 1 as it was before Step 8:

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -T template0 "$POSTGRES_DB"'
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$HOME/ai-app-hub-backups/local-before-part2a.sql"
docker image tag ai-app-hub-local-app:part1 ai-app-hub-local-app:latest
docker compose -f docker-compose.local.yml up -d --no-build app
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health
```

Expected: no `ERROR` from the restore (PostgreSQL 18 "SQL Dump", "Restoring the Dump": a database created from `template0`, `ON_ERROR_STOP`, `--single-transaction`); `200`. Everything written after the backup is gone; say so to the owner before running it.

- [ ] **Step 15: Accept the ADRs and open the PR (on the owner's word)**

On the owner's word after a passing check: set `status: accepted` in ADR-0033 and ADR-0034 and their index rows; commit (`docs(agui): accept ADR-0033 and ADR-0034`, with the trailer). Then the finish runs as superpowers-extended-cc:finishing-a-development-branch decides, within AGENTS.md's rules: push `feat/agui-core`, open the PR to `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`) with `.github/PULL_REQUEST_TEMPLATE.md`'s sections (Overview, Changes table, Testing, Related Issue: #62's three items done), naming ADR-0033 and ADR-0034, every deviation from this plan, and ending with the session's attribution lines; write the PR number into spec §0's 2a row in the same branch; after the merge, delete the branch on GitHub and locally (`git branch -d feat/agui-core`), and comment on issue #62 with the three items 2a closed. The backup and the `part1` tag stay until the owner lets them go.

```json:metadata
{"files": [], "verifyCommand": "docker compose -f docker-compose.local.yml logs app | grep -c \"Database migration complete\" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app", "acceptanceCriteria": ["Steps 1-6 green on the whole branch: tsc, oxlint, oxfmt, antd lint total 0, i18n lint and status, the three boundary greps empty, pnpm test, pnpm test:db, pnpm test:ldap, pnpm test:e2e 0 failed on three projects", "the owner's go-ahead to Step 7 captured before Step 8", "image tagged ai-app-hub-local-app:part1; ~/ai-app-hub-backups/local-before-part2a.sql mode 600, size > 0, 12 CREATE TABLE lines", "after the rebuild: one 'Database migration complete', RestartCount 0, six migration rows ending _agui_provider and _conversations, apps_provider_check names 'agui', the three conversation tables exist", "the bundle check prints 0 and 0", "every signed-out check of Step 12 answers as listed, the three new routes with the 401 unauthorized envelope"], "modelTier": "standard", "userGate": true, "tags": ["user-gate"]}
```

---

## Self-review: spec coverage

Every section of the spec that 2a holds (§1's table: §2–§5, §8–§12) and where this plan implements it:

| Spec | Tasks |
| --- | --- |
| §2.1 Where the provider plugs in (ADR-0032's checklist) | 4 (ids, migration, schemas, registry, client registry, form section, `ProviderChat`, `provider.agui`), 16 (`ProviderChat` renders the shared chat) |
| §2.2 The documents, write-only secret, chat DTO | 2 (schemas), 4 (registry, DTOs, `secretsSet`) |
| §2.3 The agent contract and the JWT | 2 (`mintAgentToken`, `AGENT_JWT_ISSUER`, `SessionUser.source`), 9 (headers, body, one auth header), 13 (the stub verifies it), 18 (`docs/agui-agents.md`) |
| §2.4 Test connection | 3 (the mapping, codes, texts), 4 (the caller), 17 (e2e) |
| §2.5 Issue #62's items | 4 (typed fields, the registry cast, M5), 18 (ADR-0032 note), 19 (the #62 comment after the merge) |
| §3.1 Tables | 5 |
| §3.2 Writing while a run streams | 6 (start, upsert, finish, close, truncate), 10 (the session's throttle, close lists), 11 (start and crash recovery) |
| §3.3 Reading | 6 (`threadForAgent`, P7), 7 (`readThreadPage`), 8 (`turnsFromMessages`) |
| §3.4 Deletion and retention | 7 (soft delete, purge), 12 (the actions, the daily job) |
| §4.1 The adapter and the guard | 9 (`ChatAdapter`, `chatAdapterOf`), 4 (`hubHistory`), 11 (`resolveChatRoute`, `resolveConversation`) |
| §4.2 Routes | 11 (four Route Handlers, `api-routes` pin), 12 (rename and delete actions) |
| §4.3 A run on the server | 11 (checks, answers, store, build, upstream errors), 9 (`runAgent`), 10 (stream) |
| §4.4 The stream to the browser | 10 (encoding, keep-alive, `hub:run`, snapshots, dropped types, logs) |
| §4.5 Stop, disconnects, time limits | 10 (closing events, statuses), 11 (stop route, `request.signal`), 15 (Stop calls the route), 17 (e2e: the agent stops) |
| §5.1 Where the browser chat lives; the one refactor | 14 (contexts, menu, list), 16 (the view reuses the shell pieces) |
| §5.2 The data layer | 8 (`applyAgUiEvent`), 15 (provider, hook, keys, side store, Stop) |
| §5.3 Rendering a turn | 16 |
| §8 Errors and i18n | 3, 4 (admin texts), 11 (codes and statuses), 16 (`shared_chat.error.*`) |
| §9 Dependencies | 1; 19 (the browser bundle check) |
| §10 Tests | unit: 2, 3, 4, 6, 8–16; database: 4, 5, 6, 7; e2e: 13 (stub), 14 (Dify specs), 17; Docker gate: 19 |
| §11 Records | 18 (ADR-0033, ADR-0034, the notes, `docs/agui-agents.md`, AGENTS.md, §0, the running record) |
| §12 Done when | 17 (e2e), 19 (gates, the Docker gate, the owner's check) |

Out of 2a by the spec's slices: approvals, `ask_user`, other interrupts, the plan panel and activity cards (2b; 2a stores and forwards the events and P3 blocks the composer); attachments and the Logs (2c).
