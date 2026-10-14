# Part 2: the shared chat on AG-UI and the AG-UI provider (design)

Date: 2026-10-14 · Status: approved by the owner on 2026-10-14 (seven sections, then the written spec: "specs looks good, push and merge") · Programme: `2026-10-11-provider-hub-charter.md` · Builds on: Part 1 (`2026-10-11-part-1-provider-core-design.md`, ADR-0032, merged as `8500cce3`) · Decisions: running record `docs/superpowers/research/2026-10-11-provider-hub/README.md`, numbers 40–55 · Spike: `…/agui-spike.md` · Research: `…/part2-store-and-logs.md`, `…/part2-proxy-stop-identity.md`, `…/part2-x-mapping.md`, `…/part2-hitl-state-files.md`

## 0. Progress and where a new session starts

Part 2 runs over several sessions (decision 55). **This section is the source of truth for its state.** Every session that moves Part 2 forward updates the table and the "Next" line in the same PR as the work.

| Slice | Branch | Plan | Build | PR | Merged |
| --- | --- | --- | --- | --- | --- |
| Spec | `docs/part-2-spec` | — | spec, spike and research notes written; approved 2026-10-14 | #63 | 2026-10-14 |
| 2a the core | `feat/agui-core` | `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md` (19 tasks; `docs/part-2a-plan`, PR #65) | — | built (Tasks 1–17), records (Task 18); gates and the Docker gate: Task 19. Plan deviations (ruled while it ran): `turnsFromMessages` joins tool-only runs by start time; a run's `outcome` is stored as received (`null` stays `null`); `finish({ failed })` logs `stream_broken` or `stream_ended`; `RunSession` takes no sink writes after `finish()` starts; the run is registered in `activeRuns` before `startRun`; a refused connection is a plain `Error('agent unreachable')`; `ConversationListRow` is the sidebar's item type; `sendDecision` moved to `components/chat/hooks/send-decision.ts`; `conversation_messages_run_id_idx` added; message text non-blank and at most 32,000 characters; one e2e test loops the five `RUN_ERROR` codes; the e2e Stop test presses the button from the keyboard (ADR-0028 note). Left for later: a first run the agent refuses before the stream stores a conversation with no `hub:run` (sidebar can list it twice); `fallbackTurn` on a failed answer (2b must show the error); the queued-send key stays set when a reply ends on another conversation (both chat hooks); the sidebar lists only the newest 100 conversations; the plain `agent unreachable` error covers a refused connection only, so a dropped stream or a malformed frame is logged by `@ag-ui/client` itself with the socket's address or the frame's text; an agent that sends only `MESSAGES_SNAPSHOT` shows nothing live until a reload | — |
| 2b human in the loop | `feat/agui-hitl` | not written | — | — | — |
| 2c attachments and Logs | `feat/agui-files-logs` | not written | — | — | — |

**Next:** 2a's gates and Docker gate (Task 19 of docs/superpowers/plans/2026-10-14-part-2a-agui-core.md) on feat/agui-core, then the owner's check, then the PR.

**Phases.**

- **The programme:** Part 0 (merged, #39) → Part 1 (merged, #60) → Part 2 (spec merged, #63; then 2a → 2b → 2c) → Part 3, Dify onto the shared chat (its spec after 2c) → the local folder rename (decision 35).
- **Each slice:**
  1. **Plan:** on a `docs/` branch, with its own PR.
  2. **Build:** on the slice's `feat/` branch, run by the superpowers skills.
  3. **Gates:** AGENTS.md's, then the Docker gate.
  4. **The owner's check.**
  5. **Merge:** the PR merged, with its records (ADRs, the running record, this table, AGENTS.md's Layout, issues).

**Handing off** (decision 57). A session that stops before its slice is done leaves the next one everything in the repo, never only in chat or memory:

- **The Next line** says:
  - the branch and its last pushed commit;
  - the next plan task;
  - what is verified and what is not;
  - questions waiting for the owner;
  - the local state (running containers, migrations applied to the local database).
- **This table** shows every phase reached.
- **The running record** has every owner decision, with their words and the date.
- **Work is committed and pushed**, unfinished work included.
- **Deviations** from this spec go in the plan or an ADR note.
- **Findings left for later** go in a GitHub issue labelled `fork/overhaul`.

No separate handoff document unless the owner asks.

**A new session starts by reading, in order:** AGENTS.md; this section; the running record's decisions 40 onwards; the sections of this spec for the slice at hand; the slice's plan once it exists. Facts that are not in the repo yet are not facts: anything decided in a session goes into this spec, the running record or the slice's plan before the session ends.

**Standing rules for every slice** (AGENTS.md, memory): documented approaches only, with a source per piece (ADR-0002) checked against every source AGENTS.md names; a feature branch in `~/repos/dify-app-hub` itself, no worktree; `nvm use` first (Node 22); a new dependency or pattern gets its ADR in the same PR; the gates of AGENTS.md before every commit; the Docker gate before merging.

**Local help:** `agui-spike.md` Appendix A is a scripted Pydantic AI agent (no LLM key) that serves every scenario of §6 and §7 except JWT checks; Appendix B is a spec-level 1.0 stub. The owner's real agent service is described in §2.3.

## 1. Goal and scope

AG-UI agents become the hub's second provider, and the hub gets its own chat: one chat API that speaks AG-UI to the browser, one conversation store, and one chat UI. Part 2 serves AG-UI apps only; Part 3 moves Dify onto the same API, store and UI, and removes the old Dify chat. The charter's decisions stand (§2 of the charter); this spec settles what it left open (charter §8).

**In scope** (decision 41):

- the AG-UI provider: settings, secrets, a signed JWT per request, Test connection;
- the conversation store: conversations, runs, messages, soft delete and purge;
- the shared chat API: run, stop, list, history, rename, delete;
- the shared browser chat: streamed text, reasoning, tool calls as cards, run errors, stop, history;
- human in the loop: tool approvals, the hub's `ask_user` question tool, other interrupts, the plan panel, activity cards;
- attachments: images, PDFs and text files, stored on the hub and sent inline;
- the admin Logs: every conversation of an app, read-only, audited, with a notice to users.

**Out of scope:** Dify on the shared chat (Part 3); like and dislike feedback, regenerate and edit (Part 3 decides them with Dify's parity; AG-UI history is linear); sub-agents, A2UI, citations and predictive state (no first agent emits them); user editing of shared state (§6.4); an admin-defined "HTTP template" provider (decision 52, an idea for later); encrypting secrets (the follow-up of decision 8).

**Slices** (decision 51). One spec, three branches and PRs to `fork/overhaul`, each with its own plan written after the previous one merges (decision 33). Each leaves a working hub.

| Slice | Holds | Sections |
| --- | --- | --- |
| 2a the core | the provider, the store, the API, the browser chat, the e2e stub, ADR-0033 and ADR-0034 | §2–§5, §8–§12 |
| 2b human in the loop | approvals, `ask_user`, other interrupts, the plan panel, activity cards | §6 |
| 2c attachments and Logs | attachments, the Logs page, the access log, the notice, ADR-0035 | §7 |

## 2. The AG-UI provider (2a)

### 2.1 Where it plugs in

ADR-0032's checklist: `'agui'` in `PROVIDER_IDS` (`lib/providers/ids.ts`); a migration that replaces `apps_provider_check` (generated by drizzle-kit from `db/schema/apps.ts`, which builds the CHECK from `PROVIDER_IDS`); its schemas and defaults in `PROVIDER_SCHEMAS`; its definition in `PROVIDERS`; `PROVIDER_UI.agui` (label key `provider.agui`, "AG-UI agent"; fallback icon `RobotOutlined`, Part 1's E11); its section in `provider-form-section.tsx`; its case in `ProviderChat`; the `provider.agui` key in en, zh and ar. The module is `lib/providers/agui/` (`schema.ts`, `provider.ts`, `jwt.ts`, `test-connection.ts`, `chat.ts`) and `components/provider-ui/agui/form-section.tsx`.

### 2.2 The documents

`settings` (zod; ADR-0025):

| Field | Rule | Default | Slice |
| --- | --- | --- | --- |
| `agentUrl` | an http(s) URL of at most 500 characters (`z.url({ protocol: /^https?$/ })`, as Dify's `apiBase`); the full endpoint the hub POSTs to, e.g. `http://agents:8000/agents/assistant` | `''` | 2a |
| `audience` | 1–255 characters; the JWT `aud` | `''` | 2a |
| `askUser` | boolean; advertise the hub's `ask_user` tool (§6.2) | `false` | 2b |
| `attachments.images` | boolean; images allowed (vision models only) | `false` | 2c |
| `attachments.documents` | `'off'` \| `'text'` (extract to text in the hub) \| `'native'` (send PDF as a `document` part) | `'text'` | 2c |
| `attachments.maxImageEdge` | null, or an integer 256–8192 (pixels on the long edge) | `null` | 2c |

Fields added by 2b and 2c carry zod defaults, so a document written by 2a still parses (zod 4 `.default()`); no data migration.

`secrets`: `{ jwtSecret }`, 32–512 characters after trimming, used as its UTF-8 bytes (decision 45; the owner's `jose` example encodes the string with `TextEncoder`). Write-only as Dify's key: the admin DTO carries `secretsSet: { jwtSecret: boolean }`; a blank field on Edit keeps the stored value (ADR-0032).

The chat DTO carries `askUser` and the allowed attachment kinds (`images`, `documents !== 'off'`), never `agentUrl`, `audience`, `maxImageEdge` or the secret. The gallery line reads "AG-UI agent" (no app types).

### 2.3 The agent service and the JWT

The owner's agents are a separate Python service (Pydantic AI over AG-UI) that trusts only the hub's server and verifies every request itself (decision 45; memory `agent-service-contract`). The hub follows that contract for every AG-UI app; it is also spec-neutral, since AG-UI leaves authentication to the binding ("AG-UI defines no credential", transports index).

- **Request:** `POST <agentUrl>`, body the `RunAgentInput` (built by `@ag-ui/client`'s `HttpAgent`, §4.3), headers `Content-Type: application/json`, `Accept: text/event-stream` and exactly one auth header, `Authorization: Bearer <JWT>`. No browser header is forwarded (CopilotKit's precedence rule: server-set headers win).
- **JWT** (`jose` `SignJWT`, HS256, the documented HMAC example; minted fresh for every upstream request, the run and Test connection alike):

  | Claim | Value |
  | --- | --- |
  | `sub` | the account's permanent id (ADR-0026) |
  | `iat` | now |
  | `exp` | now + 60 s (the agent allows 10 s of clock skew) |
  | `iss` | `AGENT_JWT_ISSUER` from `lib/env.ts`, default `nextjs-bff` (it must match the agent's `AGENT_JWT_ISSUER`) |
  | `aud` | `settings.audience` (it must match the agent's `AGENT_JWT_AUDIENCE`) |
  | `auth_source` | the account's `source`: `local` or `ldap` |
  | `roles` | `[role]`: `owner`, `admin` or `user` (ADR-0024) |

  No `name` or `email` (minimal disclosure; AGENTS.md: the owner's email goes to no other service). The NextAuth token is never forwarded. Header `{ alg: 'HS256', typ: 'JWT' }`.

- **What the agent answers:** 401 for a bad or expired token, 404 for an unknown agent, 415 for a body that is not JSON, 422 for an invalid body, all before any stream; a refused connection when it is down or restarting; in-stream `RUN_ERROR` with `code` `usage_limit`, `rate_limited`, `busy`, `model_unavailable` or `agent_error`, whose message is safe to show; a run that hits its time limit sends `CUSTOM { name: 'run_cancelled', value: { reason: 'run_timeout' } }` and then `RUN_FINISHED`.

### 2.4 Test connection

`testConnection(settings, secrets)` POSTs `{}` (valid JSON, an invalid `RunAgentInput`) to `agentUrl` with a fresh JWT whose `sub` is the admin who runs the test, given up after 10 s (MDN `AbortSignal.timeout()`, as Dify's test). The answer:

| Agent's answer | Result |
| --- | --- |
| 422 or 400 | reachable: the token passed and the body was refused before any run |
| 401 or 403 | `key_refused` |
| 404 | `agent_not_found` (new code) |
| 415 or another 4xx | `upstream_error` |
| a refused connection, the timeout or a 5xx | `unreachable` |
| a 2xx event stream | the body is cancelled at once; reachable with a warning, `ran_on_invalid_input` (new code) |

At most a small part of an error body is read, and none is echoed. ADR-0034 records this as the hub's own convention, derived from the spec's rule that refused input gets "a plain HTTP error status with no stream" (`part2-proxy-stop-identity.md` §5). `ConnectionTestResult` gains the two codes; both get i18n keys.

### 2.5 Issue #62 items taken here

The second provider touches them (issue #62, "For the second provider"):

- `ProviderDefinition.chatFields` and `summaryFields` are typed per provider instead of `object`;
- `components/provider-ui/registry.tsx`'s cast of the app type to a label key goes (AG-UI has no types; Dify's lookup is typed);
- **M5:** an app whose settings read but whose secrets do not opens Edit on its stored settings, not the provider's defaults (`toAdminAppDto`).

The other #62 items stay in the issue.

## 3. The conversation store (2a)

Messages are stored one row per AG-UI message, never as an event log (`part2-store-and-logs.md` §7.1: the 1.0 spec replays history as messages and snapshots; every reference hub stores messages; Microsoft Agent Framework keeps "no raw events"; an event log would be folded again on every run).

### 3.1 Tables (`db/schema/conversations.ts`)

**`conversations`**, one per AG-UI thread:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | the AG-UI `threadId`, minted by the hub |
| `app_id` | `uuid` NOT NULL → `apps.id` ON DELETE CASCADE |  |
| `user_id` | `uuid` NOT NULL → `users.id` ON DELETE CASCADE | the owner of the thread |
| `title` | `text` NOT NULL DEFAULT `''` | the first user message, trimmed to 80 characters, until renamed; empty when the message had no text, and the UI then shows a localised "New conversation" |
| `state` | `jsonb` NOT NULL DEFAULT `'{}'` | the agent's shared state after the last run |
| `active_run_id` | `uuid` NULL | one active run per conversation |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` is the last activity |
| `deleted_at` | `timestamptz` NULL | the soft delete (decision 49) |

Indexes: `(user_id, app_id, updated_at)` for the user's list; `(app_id, updated_at)` for the Logs.

**`conversation_runs`**, one per AG-UI run:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | the AG-UI `runId`, minted by the hub, never reused |
| `conversation_id` | `uuid` NOT NULL → CASCADE |  |
| `status` | `text` + CHECK | `running`, `succeeded`, `interrupted`, `cancelled`, `failed`, `truncated` |
| `outcome` | `jsonb` NULL | `RUN_FINISHED.outcome` as received (interrupts) |
| `resume` | `jsonb` NULL | the answers this run was started with (§6), kept for the Logs |
| `error` | `jsonb` NULL | `{ code, message }` from `RUN_ERROR` or the hub |
| `usage` | `jsonb` NULL | the terminal event's usage |
| `custom` | `jsonb` NOT NULL DEFAULT `'[]'` | the run's `CUSTOM` events `{ name, value }` (e.g. `run_cancelled`), never sent back to the agent |
| `started_at`, `finished_at` | `timestamptz` |  |

Index: `(conversation_id, started_at)`.

**`conversation_messages`**, one per AG-UI message:

| Column | Type | Notes |
| --- | --- | --- |
| `seq` | `bigint` GENERATED ALWAYS AS IDENTITY PK | the transcript order; timestamps tie inside a transaction (`part2-store-and-logs.md` §6.2; agenticos's ordinal) |
| `conversation_id` | `uuid` NOT NULL → CASCADE |  |
| `run_id` | `uuid` NULL → `conversation_runs.id` ON DELETE SET NULL | the run that produced it; a user message: the run it started |
| `message_id` | `text` NOT NULL | the AG-UI `id`; UNIQUE `(conversation_id, message_id)` |
| `role` | `text` + CHECK | the seven AG-UI roles |
| `body` | `jsonb` NOT NULL | the AG-UI message, checked with `@ag-ui/core`'s message schema, `encryptedValue` included |
| `status` | `text` + CHECK | `streaming`, `complete`, `incomplete` |
| `created_at`, `updated_at` | `timestamptz` |  |

Index: `(conversation_id, seq)`. The tables of 2c are in §7. The schema change is a generated drizzle-kit migration, read before it is committed (ADR-0031).

### 3.2 Writing while a run streams

From the server's `HttpAgent` subscriber (§4.3), in `lib/data/conversations.ts` with the verified actor (ADR-0024):

1. **Start**, in one transaction: insert the user message (or the answers of §6), insert the run as `running`, set `active_run_id`. Another active run on the conversation answers 409 `run_in_progress`.
2. **During the run:** upsert each message by `message_id` when it starts, when it ends, when its tool result arrives, and every 2 s while text streams (PostgreSQL rewrites a whole row on every update, so not per token; Microsoft Agent Framework writes "after tool-result batches and approval safe points"). The rows come from the agent's message list (`onMessagesChanged`, `agent.messages`), not from `newMessages`, which omits a message updated under an existing id (spike finding). State is written when it changes.
3. **End:** write the run's status, outcome, error, usage and `finished_at`; clear `active_run_id`; touch `updated_at`.
4. **Stop, failure or truncation:** messages still open become `incomplete`; every tool call left without a result gets a `tool` message with `error: 'stopped'`, so the next `RunAgentInput` is valid history (CopilotKit's finaliser; Open WebUI and LibreChat mark partial messages).
5. **A crash:** the server keeps an in-process map from run id to its `AbortController`. A run stored as `running` that is not in the map is set to `truncated` when the next request finds it. Several hub containers would need a shared map: a follow-up, with the one-shot migrate service (AGENTS.md).

### 3.3 Reading

- **The next `RunAgentInput`:** every message row in `seq` order, minus `activity` messages (the spec: they MUST be stripped before sending); `state`; `tools` (§6.2); `resume[]` (§6.1). Unanswered calls to tools the hub never advertised are answered with an error `tool` message first (§6.2).
- **Turns for the browser:** `turnsFromMessages(rows, runs)` groups the rows into turns on the server: a user turn per user message; an assistant turn holding everything up to the next user message, across the runs that resumed it, as ordered parts (§5.2). Each turn carries its runs' outcomes; the last turn carries the open interrupts and pending questions, so they survive a reload. Grouping happens on the server because "nothing on the wire carries run identity" (assistant-ui; `part2-x-mapping.md` §C). Within one assistant message a reload shows the text before its tool calls; the live view shows arrival order. The two agree for every spike scenario.

### 3.4 Deletion and retention

- A user's delete sets `deleted_at`; the conversation leaves the user's list at once.
- A daily job, `lib/chat/purge.ts`, registered the way `lib/directory/schedule.ts` registers the directory sync (croner in `instrumentation.ts`), deletes conversations whose `deleted_at` is more than 30 days old (cascade: runs, messages, attachments) and, from 2c, attachments never sent after 24 hours.
- Deleting an app or an account cascades to its conversations at once (the hub hard-deletes both).

## 4. The shared chat API (2a)

### 4.1 The adapter and the guard

`ProviderDefinition` gains an optional `chat` adapter: given the app, the actor, the stored history, the state, the tools and the answers, it runs one turn and reports AG-UI events. AG-UI's adapter (`lib/providers/agui/chat.ts`) wraps `HttpAgent`; Part 3 adds Dify's translating adapter. The registry also gains `hubHistory: boolean` (AG-UI true, Dify false until Part 3; §7.3 reads it).

`resolveChatRoute(params)` (`lib/chat/route.ts`) checks, in order, as `resolveAppRoute` does: the session; the app id is a UUID; the app is visible to the actor (`getAppAccess`); it is enabled; its provider has a `chat` adapter. Failures: 401, 404 `app_not_found`, 403 `app_disabled`, 404 `app_not_found`. A conversation must belong to the actor, match the app and not be deleted; otherwise 404 `conversation_not_found`.

### 4.2 Routes

One Route Handler per operation (ADR-0023's pattern), under `app/api/apps/[appId]/`; `__tests__/api-routes.test.ts` pins them:

| Route | Does |
| --- | --- |
| `POST runs` | Body (zod): `{ conversationId?: uuid, message?: { text: string ≤ 32,000, attachmentIds?: uuid[] ≤ 5 }, answers?: { resume?: [{ interruptId: string, status: 'resolved' \| 'cancelled', payload?: object }], toolResults?: [{ toolCallId: string, content: string ≤ 32,000 }] } }`, exactly one of `message` and `answers`; `answers` needs a `conversationId`. Streams the turn (§4.4). |
| `POST conversations/[conversationId]/runs/[runId]/stop` | Aborts that run (§4.5); 204, also when it has already ended. |
| `GET conversations` | The actor's conversations of this app, newest first, keyset-paged on `(updated_at, id)`, not deleted. |
| `GET conversations/[conversationId]` | The latest turns with a "load earlier" cursor, the state, the open interrupts and pending questions. |

Rename and delete are Server Actions returning `ActionResult` (ADR-0024: the hub's own data), in `app/(user)/chat/actions.ts`.

### 4.3 A run, on the server

`lib/chat/run.ts`:

1. **Checks.** The open items are the last run's open interrupts plus its unanswered calls to the hub's own `ask_user` tool (§6.2). A `message` while any is open → 409 `answer_pending` (decision 50). `answers` must cover every open item (a `resume` entry per interrupt, a `toolResults` entry per call), with no unknown or expired id → 400 `answers_invalid`. An active run → 409 `run_in_progress`.
2. **Store** the user message or the answers and the run (§3.2); a new conversation is created first, owned by the actor.
3. **Build** `RunAgentInput` (§3.3) and run it through a new `HttpAgent({ url, headers: { Authorization }, threadId, initialMessages, initialState, fetch })` per run, with `runAgent({ runId, tools, context: [], forwardedProps: {}, resume }, subscriber)`. `runAgent()` is the documented path that applies `@ag-ui/client`'s 0.x → 1.0 compatibility boundary, enforcement and verification; `run()` returns raw events (`part2-proxy-stop-identity.md` §1.2). CopilotKit's runtime consumes agents the same way. Pydantic AI on protocol 0.1.22 requires `tools`, `context` and `forwardedProps` to be present; `HttpAgent` always sends them.
4. **Upstream errors before any stream.** The hub's `fetch` (the documented `HttpAgent` option) sees the agent's status before the hub answers the browser, so these get the hub's error envelope (`lib/http`), not a stream: 401 or 403 → 502 `agent_auth_failed`; 404 → 502 `agent_not_found`; 415 or 422 → 502 `agent_rejected_input`; a refused connection or no answer → 503 `provider_unreachable` ("The agent is restarting, try again"). The run is stored as `failed` with that code.
5. **Stream** to the browser (§4.4) while the subscriber persists (§3.2).

### 4.4 The stream to the browser

- A `ReadableStream` Route Handler response (Next bundled docs, "Streaming in Route Handlers"), `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, each event encoded with `@ag-ui/encoder`'s `EventEncoder.encodeSSE`, and a `: keep-alive` comment after 15 s of silence (the transport spec tolerates comments; CopilotKit's default).
- The first event is `CUSTOM { name: 'hub:run', value: { conversationId, runId, title } }`, so the browser can name the stop route and its conversation.
- **Deltas become snapshots.** `STATE_DELTA` and `ACTIVITY_DELTA` are applied on the server (`HttpAgent` applies JSON Patch with `fast-json-patch`) and sent as `STATE_SNAPSHOT` and `ACTIVITY_SNAPSHOT`, so the browser needs no JSON Patch library (spike finding).
- **Not sent to the browser:** `RAW` (provider-native), `REASONING_ENCRYPTED_VALUE` (kept in the stored message for the agent; the owner: ignore it in the UI) and `MESSAGES_SNAPSHOT` (folded on the server).
- `RUN_ERROR` passes through with its `code` and message (the owner: safe to show).
- Log lines carry `{ appId, runId, code }`, never message content.

### 4.5 Stop, disconnects and time limits

AG-UI has no stop request; closing the connection makes a "truncated" run, and the consumer "MUST NOT synthesize a `RUN_FINISHED`" for the producer (spec, lifecycle). The hub is the producer toward the browser, so:

- **Stop** (the stop route): the hub aborts the upstream request through the run's `AbortController` (a Starlette agent then sees `CancelledError` and its model call stops: spike), closes every open message, tool call and reasoning block toward the browser, and ends the stream with `RUN_FINISHED { outcome: { type: 'cancelled' } }`. `HttpAgent`'s own `RUN_ERROR { code: 'abort' }` is dropped. The run is stored as `cancelled`. CopilotKit's finaliser, LibreChat's `/chat/abort` and Open WebUI's task stop work the same way.
- **The browser goes away** without Stop: `request.signal` aborts (Next aborts it on a client disconnect), the hub aborts upstream, and the run is stored as `truncated`.
- **The agent's time limit** (`CUSTOM run_cancelled` with `reason: run_timeout`): the run is stored as `cancelled` with that reason; the turn reads "Stopped: time limit".
- **Silence:** undici's documented 300 s limit between upstream chunks stays; `docs/agui-agents.md` tells agent authors to send something at least every five minutes.

## 5. The browser chat (2a)

### 5.1 Where it lives

A new `components/shared-chat/`; `ProviderChat`'s `'agui'` case renders it. `components/chat/**` stays the Dify chat until Part 3 (ADR-0032). The shared chat reuses, without copying: the shell (`UserShell`, `AppSider`, `conversation-drawer`, `width-toggle`, `sider-collapsed`); `MessageMarkdown` and its neutral blocks; `Reasoning` and its timer; the conversation sidebar and the rename and delete menu, generalised from their Dify wiring. One refactor: the Dify file-link rewrite in the Markdown map (`markdown-image`, `markdown-link`, `markdown-source`, `video-block`) moves behind a context only the Dify chat provides, the one Dify coupling in the renderer (`part2-x-mapping.md` §5). The Dify chat's behaviour does not change.

### 5.2 The data layer

The shape the spike proved, built like `useDifyChat`:

- **`lib/chat/turn.ts`** (client-safe): the `Turn` and `TurnPart` types; `applyAgUiEvent(turn, event)`, a pure reducer the browser runs; and `turnsFromMessages(rows, runs)`, which the server runs (§3.3). One X message is one turn. Parts, in arrival order: `text` (by message id), `reasoning` (by message id), `tool` (by tool-call id, its result merged in when `TOOL_CALL_RESULT` arrives, in this run or a resumed one), `activity` (by message id, the snapshot replaces). A turn also holds its runs (`runId`, outcome, error, the `run_cancelled` reason) and the open interrupts.
- **`AgUiChatProvider`** extends x-sdk's `AbstractChatProvider` and implements only its three transforms (the `x-chat-provider` skill). `transformMessage` parses each `chunk.data` (one AG-UI event per SSE `data:` line; XRequest's SSE parser reads it as is) and folds it with `applyAgUiEvent`; on a reload it keeps the turn being continued itself, because "the SDK passes no originMessage on a reload's first chunk" (as `DifyChatProvider` does). Requests go through XRequest's documented `fetch` option, so the hub's error envelopes become a `RequestError` (as `createDifyFetch` does).
- **`useSharedChat`** mirrors `useDifyChat`'s structure: one provider per conversation key from a cache; `defaultMessages` loads the server's turns; `queueRequest` holds a send while history loads; "load earlier" prepends whole turns; a `useSyncExternalStore` side store holds paging, history errors, the state (§6.4) and the pending answers.
- **Keys** follow ADR-0017: a new chat's key is `temp:<uuid>` and never changes during the page session; the server's conversation id arrives in `hub:run` and is kept on the conversation item.
- **Stop** calls the stop route; the turn then finishes in place with "Stopped". `requestFallback` handles transport failures only (an aborted fetch would otherwise move the turn to the end under a new id, x-sdk's behaviour noted in ADR-0017).
- **Two layers of status:** X's status is the transport (`updating`, `success`, `error`); a turn's last run outcome is what AG-UI reported. A turn can be X-`success` and still interrupted, failed in-stream or stopped.

### 5.3 Rendering a turn

| Part | Component | Notes |
| --- | --- | --- |
| reasoning | X `Think` | as the Dify chat's `Reasoning` |
| text | `MessageMarkdown` | `streaming` while the turn updates |
| tool calls | X `ThoughtChain` | consecutive calls in one chain; each item: title = the tool's name, description = a short input hint, `status` running, done, error or stopped, a collapsible body with the arguments and the result in X `CodeHighlighter` (`lang="json"`). This is the full-stack template's tool card ("caption, check or cross, `</>` raw view") on X's own component, the one the Dify chat uses for agent thoughts |
| a run error | antd `Alert` `type="error"` `showIcon` | below what streamed: a localised title for the `code` (`usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`, the hub's codes; anything else a generic title) and the agent's message |
| a stopped run | `Typography.Text type="secondary"` | "Stopped", or "Stopped: time limit" |

Tool renderers are looked up by tool name with this generic card as the fallback (assistant-ui, CopilotKit, TanStack AI and X's demo all do; `part2-x-mapping.md` §3.5). 2b registers `ask_user` as the first.

Around the turns: X `Welcome` with the app's icon, name and description (AG-UI has no opening statement or suggested questions); the X `Sender` (disabled while an answer is pending, §6.3); copy in X `Actions` on each assistant turn. Every text is an i18n key in en, zh and ar; icon-only buttons are named by keys, which the e2e locators use (frontend rules).

## 6. Human in the loop (2b)

### 6.1 Tool approvals

An interrupt with `reason: 'tool_call'` and a `toolCallId` (AG-UI 1.0 interrupt-resume; Pydantic AI's `requires_approval` tools):

- The gated tool's ThoughtChain item shows **Approve** (primary) and **Reject**, with the arguments read-only (agenticos's rule: the template's editable JSON box was dead weight).
- The answer follows the interrupt's own `responseSchema`, because frameworks name the field differently (`approved` for Pydantic AI, Strands and Mastra; `accepted` for Microsoft Agent Framework; `confirmed` for ADK: `part2-hitl-state-files.md` §1.3): the hub sets the schema's first required boolean property, adds `reason: 'Rejected by the user'` when the schema has a string `reason`, and falls back to the spec's recommended `{ approved }` when there is no schema.
- Several open interrupts: decisions wait in the browser until every one has one, then go back as one `resume[]` ("The resume list MUST cover every interrupt"; CopilotKit and assistant-ui wait the same way).
- An interrupt past its `expiresAt` shows as expired and offers only Dismiss, which answers it `cancelled`.
- The server rebuilds `resume[]` from the answers, checks coverage, unknown ids and expiry again, and stores the answers on the run (§3.1), so the Logs show what was decided. The resumed run's `TOOL_CALL_RESULT` merges into the gated tool's card; the turn continues in place through `onReload(turnId, …)` (spike).

### 6.2 The hub's `ask_user` tool

Decision 46: the full-stack template's design, advertised by the hub as an AG-UI frontend tool, because AG-UI's HTTP + SSE cannot hold a run open on a socket the way the template does.

- **Advertised** in `RunAgentInput.tools` only when the app's `askUser` is on (off by default: Pydantic AI fails a run whose agent already has a tool of that name).
- **Name and schema** are the template's (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21): `ask_user`, `{ questions: [{ question: string, options?: string[], allow_custom?: boolean = true }] }` with 1–10 questions, and the template's tool description adapted to say the answers come back in the next turn.
- **Arguments are untrusted** (the spec: validate them against the declared schema): zod allows at most 10 questions of at most 500 characters and at most 10 options of at most 200 characters. Invalid arguments show "The agent asked an invalid question" with Dismiss, which answers the call with an error.
- **The card**, the template's UX, sits above the composer: "Question 2 of 3"; the options as X `Prompts` (vertical, one click, digit keys pick); an antd `Input` for a free answer when `allow_custom`; **Skip** (this question) and **Dismiss** (skip the rest).
- **The answer** is a `tool` message whose content is the template's Q/A transcript (`Q: …` / `A: …`, `(skipped)`, `(no answer)`), a string, which Pydantic AI's 0.x protocol requires. The hub writes it into the turn itself, because no `TOOL_CALL_RESULT` comes back for a frontend tool (spike); the turn continues through `onReload`. Afterwards the `ask_user` card in the transcript shows the questions and answers.
- **A pending call** is one the run ended on without a `tool` message; the hub derives it, since `@ag-ui/client` 1.0.2 strips `pendingToolCallIds` (spike).
- **A call to a tool the hub never advertised** (e.g. an agent's own deferred `ask_user_question`) is answered by the server with an error `tool` message ("This tool is not available here") when the next run is built. The spec leaves such calls to the consumer; they never block the composer.

### 6.3 Other interrupts and the blocked composer

- Any other interrupt (`input_required`, `confirmation`, or a namespaced reason) renders as one card in the turn: an antd `Card` titled from the reason (known reasons localised, others shown raw), the interrupt's message, a form for a flat `responseSchema` (string → `Input`, `enum` → `Radio.Group`, boolean → `Switch`, number or integer → `InputNumber`; `required` marked), **Submit** and **Cancel** (status `cancelled`). A `confirmation` without a schema shows **Yes** and **No** (the spec's boolean default). A schema outside that subset shows only the message and **Cancel**. The server validates answers against the same subset. No form library is added (`@rjsf/antd` would bring ajv; the other JSON Schema form libraries do not support antd 6: `part2-hitl-state-files.md` §1.5).
- While any approval, question or interrupt is open, the Sender is disabled with a hint, and the server refuses a new message with 409 `answer_pending` (decision 50). Every card has a way out (Reject, Dismiss, Cancel).

### 6.4 The plan panel and activity cards

- **Plan panel** (decision 47): shown above the composer when the conversation's state parses (zod) as `{ steps: [{ description: string, status: string }] }` with at least one step, the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example. An antd `Collapse` with one ghost panel headed "Plan 2/5", an antd `Progress`, and antd `Steps` (vertical, small) mapping `pending` → wait, `in_progress` → process, `completed` → finish, `blocked` → error, any other status neutral. It collapses itself once every step is completed, as the template's panel does. State of any other shape is not shown to users; it reaches the agent unchanged and the admin Logs as JSON. Users cannot edit state: without a schema the hub cannot meet Microsoft's "validate, fail closed" rule for state injection, and Pydantic AI's example puts state into the agent's instructions.
- **Activity cards:** an `activity` part renders read-only in the turn as a small antd `Card` titled with its `activityType`; a flat `content` as antd `Descriptions`, anything nested as collapsed JSON in `CodeHighlighter`, capped at 10 KB. Everything renders as text, never HTML.

## 7. Attachments and Logs (2c)

### 7.1 Attachments

Decisions 48, 53 and 54.

- **Table `conversation_attachments`:** `id` (uuid); `user_id`, `app_id` (both cascade) and `conversation_id` (NULL until sent, then cascade); `message_id` (text NULL); `kind` (`image`, `document`, `text`, CHECK); `mime` (detected); `name` (the original name, for display only); `size`; `sha256`; `data` (`bytea`); `extracted_text` (text NULL); `created_at`. The purge (§3.4) removes rows never sent after 24 hours (LibreChat keeps temporary uploads for an hour).
- **Upload:** `POST /api/apps/[appId]/attachments`, one multipart part named `file` (the shape of Dify's upload route, `parseFilePart`), guarded by `resolveChatRoute`. Checks (OWASP File Upload Cheat Sheet): the kind is allowed by the app's settings; the type is detected from the bytes, never the browser's claim; at most 5 MB per file (under Next's 10 MB `proxyClientMaxBodySize`, which would truncate silently); at most 6 MB of attachments per conversation; at most 5 files per message. Refusals: 413 `attachment_too_large`, 413 `conversation_attachments_full`, 415 `attachment_type_not_allowed`, 400 `attachment_invalid`.
- **Images:** PNG, JPEG or WebP, decoded by sharp with ADR-0030's pixel limit (SVG and anything else refused), metadata stripped, re-encoded in the same format at the original size; shrunk only to the app's `maxImageEdge` when set (decision 53). A new `chatImage` kind in `lib/settings/images.ts`.
- **PDFs:** checked by their `%PDF-` header. In `text` mode the hub extracts the text (Mozilla's pdf.js, `pdfjs-dist`, chosen in ADR-0035 after a docs check of its Node usage; at most 100,000 characters per file). **Text files** (`.txt`, `.md`, `.csv`) must be valid UTF-8.
- **To the agent:** the user message's `content` array holds the text part, then per attachment: `{ type: 'image', source: { type: 'data', value: <base64>, mimeType } }`; in `native` mode `{ type: 'document', source: { type: 'data', value, mimeType: 'application/pdf' } }`; in `text` mode a text part `[file report.pdf]` followed by the extracted text (text files always go this way). `mimeType` is `@ag-ui/core` 1.0's name; the agent's 0.1.22 models accept it (spike). Never a hub URL: a model provider cannot reach it and Pydantic AI blocks private addresses (the owner's rule). Every run re-sends every attachment (decision 54).
- **Serving back:** `GET /api/apps/[appId]/attachments/[attachmentId]` to the conversation's owner, or an admin through the Logs (audited, §7.2); `Content-Type` as detected, `X-Content-Type-Options: nosniff`, the icon route's sandbox CSP, `Content-Disposition: inline` only for re-encoded images and `attachment` otherwise.
- **UI:** X `Attachments` in the `Sender.Header`, as the Dify chat's `sender-attachments.tsx`, limited to the app's allowed kinds; `FileCard` and image thumbnails in the user bubble, as `message-files.tsx`.

### 7.2 Logs and the access log

Decisions 42 and 49; ADR-0024's admin gates.

- **Entry:** a "Logs" row action in the apps table on apps whose provider has `hubHistory` (§4.1). The row actions stay the same for every provider in principle (ADR-0032); the flag hides the action where the hub holds no history, until Part 3.
- **Page** `app/(admin)/app-management/[appId]/logs/page.tsx`: a server page with trimmed props for a client table (ADR-0020), owner and admin. An antd `Table`: user (name and email), title, messages, last activity, tokens (summed from the runs), status tags (failed, stopped, waiting for an answer, and "Deleted by the user, purged on <date>"). Filters in the URL: a date range on the last activity, the user, the status, "include deleted". Keyset pagination on `(updated_at, id)` using `(app_id, updated_at)`.
- **Detail:** a large antd `Drawer` that fetches `GET /api/apps/[appId]/logs/[conversationId]` when opened (a Route Handler, so a prefetch never writes an audit row; owner and admin, checked in the handler and the data layer). It shows the transcript rendered read-only by the shared chat components (no composer, no buttons), a run timeline (antd `Timeline`: status, duration, tokens, error, interrupts and the user's answers) and the final state as collapsed JSON.
- **Audit:** opening a transcript, or downloading an attachment through the Logs, writes a `conversation_access_log` row: `id`, `actor_id`, `conversation_id`, `app_id` (no foreign keys, so the row outlives the conversation, as `users.admin_deactivated_by` does), `action` (`view`, `download`), `at`. Indexes `(conversation_id, at)` and `(actor_id, at)`. Not purged in Part 2. OWASP's Logging Cheat Sheet lists access by administrators and access to sensitive data among the events to log; none of the five reference hubs does this, so it is the hub's own addition.
- **Access log tab:** on the Logs page, for the owner role only, the rows for this app (who, which conversation, when).
- **Notice:** one line under the composer in every chat of an app with `hubHistory`, in en, zh and ar: "Admins can read conversations in this app. Deleted conversations are kept for 30 days." (the UK ICO: employers "must inform workers about any monitoring").

## 8. Errors and i18n

New error codes in the hub's envelope (`lib/http`), each with an i18n key in en, zh and ar:

| Code | Status | Where |
| --- | --- | --- |
| `conversation_not_found` | 404 | the conversation routes |
| `run_in_progress` | 409 | `POST runs` |
| `answer_pending` | 409 | `POST runs` with a message while something is open |
| `answers_invalid` | 400 | answers that do not cover, are unknown or expired |
| `agent_auth_failed` | 502 | the agent answered 401 or 403 |
| `agent_not_found` | 502 | the agent answered 404 (also a Test connection code) |
| `agent_rejected_input` | 502 | the agent answered 415 or 422 |
| `provider_unreachable` | 503 | existing code; the agent did not answer |
| `attachment_too_large`, `conversation_attachments_full` | 413 | 2c uploads |
| `attachment_type_not_allowed` | 415 | 2c uploads |
| `attachment_invalid` | 400 | 2c uploads |

Test connection adds `agent_not_found` and the warning `ran_on_invalid_input`. The agent's `RUN_ERROR` codes get titles (`usage_limit`, `rate_limited`, `busy`, `model_unavailable`, `agent_error`), with a generic title for any other. When a locale string changes, `e2e/` is searched for the old text (lesson of Part 1).

## 9. Dependencies

Each gets its ADR in the slice that adds it (ADR-0015), with its docs checked:

| Package | Version | Slice | Why | Notes |
| --- | --- | --- | --- | --- |
| `@ag-ui/client` | 1.0.2 | 2a | `HttpAgent.runAgent()` on the server | brings `rxjs` 7.8.1, `fast-json-patch` and a second zod (3.25.76) beside the hub's zod 4.6.5; server-only |
| `@ag-ui/core` | 1.0.2 | 2a | the protocol's types and message schema | zod 4 as a peer for its schemas |
| `@ag-ui/encoder` | 1.0.2 | 2a | `EventEncoder.encodeSSE` toward the browser | pulls `@ag-ui/proto` |
| `jose` | 6.2.12 | 2a | `SignJWT`, HS256 | no dependencies |
| `pdfjs-dist` | the release current when 2c's plan is written, pinned there | 2c | PDF text extraction | its Node usage is checked in 2c's plan; ADR-0035 records it, or a better-documented alternative the check finds |

The browser bundle carries none of `@ag-ui/client`'s runtime: the browser parses events with XRequest and the reducer, and imports only `@ag-ui/core`'s types.

## 10. Tests

**Unit (`pnpm test`, Vitest, node environment):**

- 2a: the AG-UI document schemas and defaults; the JWT's claims (a fixed clock, verified with `jose`'s `jwtVerify`); the Test connection mapping (a stubbed `fetch` per row of §2.4); `applyAgUiEvent` and `turnsFromMessages` agreeing on the spike's scenarios; the event normalisation (deltas to snapshots, dropped types, `hub:run` first, `RUN_FINISHED cancelled` on stop); the upstream-error mapping; the answers check; `resolveChatRoute`; `api-routes`; `provider-boundary`.
- 2b: the approval payload builder (each framework's schema shape); the `ask_user` argument check and transcript; the plan-state parse; the flat-schema validator.
- 2c: type sniffing and the caps; the content-part builder for each documents mode; the attachment response headers.

**Database (`pnpm test:db`):** 2a: `'agui'` passes `apps_provider_check`; `seq` order; one active run; closing open messages and tool calls on stop; the `RunAgentInput` build without activity messages; turn grouping; soft delete, the purge and the cascades. 2c: the attachments table and its cap; the access log.

**e2e (`pnpm test:e2e`, three projects; ADR-0010):** the stub server (port 5399) gains a spec-level AG-UI 1.0 producer under `/agui/agents/<name>` (`e2e/fixtures/stub/agui.ts`, `@ag-ui/encoder`), the second producer decision 7 asks for. It verifies the JWT as the owner's service does (HS256 with the e2e app's secret from `.env.e2e`; `iss`, `aud`, `sub`, `auth_source`, `roles`, `exp`) and answers 401 otherwise, so the identity contract is tested end to end. Scenarios by the query text, as the Dify stub's: 2a text and reasoning, a tool call, each `RUN_ERROR` code, `run_cancelled`/`run_timeout`, a slow stream for Stop, 404 and 422 before the stream, a reload restoring the turns; 2b an approval (approve, reject), `ask_user` (answer, skip, dismiss), `input_required`, plan state, activity; 2c an attachment echo, the caps, the Logs list and transcript, the access log, the notice. The seed adds an AG-UI app beside the five Dify apps. Every Dify spec stays green. Pydantic AI itself is covered by the spike and by the owner's service; CI runs no Python.

**Docker gate** (per PR; AGENTS.md): the existing curl checks, plus signed-out 401 envelopes from `/api/apps/<id>/runs`, `/api/apps/<id>/conversations`, the stop route and, from 2c, the attachment and logs routes; the migration's log line once and `RestartCount` 0.

## 11. Records

| Slice | Records |
| --- | --- |
| 2a | **ADR-0033** "Use AG-UI as the hub's chat protocol with a hub-side conversation store": `@ag-ui/client`, `core` and `encoder` and the second zod; one X message per turn; the stop route; the store. **ADR-0034** "Add AG-UI agents as a provider": the agent contract and its JWT (`jose`), the Test connection convention, the rule of decision 52 (the provider registry and standard protocols; the "HTTP template" provider not taken). Notes on ADR-0017 (its "one `DifyChatProvider`" is superseded once Part 3 lands), ADR-0023 (the shared chat routes beside the Dify routes), ADR-0026 (the account id as the JWT `sub`) and ADR-0032 (the second provider, the #62 items of §2.5). `docs/agui-agents.md`, the operator guide for agent authors: the URL, the JWT, the error codes, the five-minute silence limit. |
| 2b | Notes on ADR-0034: `ask_user`, the interrupt answers, the plan state shape. `docs/agui-agents.md`: the same three. |
| 2c | **ADR-0035** "Keep chat attachments and admin logs on the hub": `bytea`, the PDF library, the caps, the audit and the notice. A note on ADR-0030 (the `chatImage` kind). `docs/agui-agents.md`: attachment kinds. |
| every slice | AGENTS.md's Layout (`components/shared-chat/`, `lib/chat/`, the new routes), §0 of this spec, the running record, issue #62. |

## 12. Done when

- **2a:** an admin adds an AG-UI app with Test connection; a user chats with it: text, reasoning and tool cards stream into one turn; Stop ends a run in place and the agent stops; a reload restores the conversation; rename and delete work; every gate, the three e2e projects and the Docker gate pass; the owner's check against their agent service.
- **2b:** approvals, `ask_user`, `input_required`, the plan panel and activity cards work against the stub and the owner's service; the composer blocks while something is open.
- **2c:** images, PDFs and text files reach the agent per the app's settings; the caps hold; admins read conversations in the Logs, every view is in the access log, and users see the notice; deleted conversations are purged after 30 days.

## 13. Sources

The research notes and the spike beside the running record carry a source for every fact; the ones this spec leans on most:

- AG-UI 1.0 spec (`https://docs.ag-ui.com/spec/1.0/…`): run input, HTTP + SSE transport, lifecycle (truncated and cancelled runs), tool calls (frontend tools), interrupt-resume, state, activity; `@ag-ui/client` 1.0.2 typings (`HttpAgent`, `runAgent`, `buildResumeArray`); `@ag-ui/encoder` `EventEncoder`.
- Pydantic AI 2.56.0 `pydantic_ai/ui/ag_ui` (`_adapter.py`, `_interrupt.py`, `_multimodal.py`) and its AG-UI examples; the owner's agent service contract (decision 45).
- Ant Design X 2.9.0 (`x-sdk` `AbstractChatProvider`, `useXChat`, XRequest and XStream; `Bubble`, `Think`, `ThoughtChain`, `CodeHighlighter`, `Prompts`, `Sender`, `Attachments`, `FileCard`, `Welcome`, `Actions`) and antd 6.6.5 (`Alert`, `Card`, `Collapse`, `Steps`, `Progress`, `Descriptions`, `Table`, `Drawer`, `Timeline`, form controls), each checked through the X skills and the antd CLI before use.
- Next.js 16 bundled docs (`02-guides/streaming.md`, `02-guides/backend-for-frontend.md`, `proxyClientMaxBodySize`); Drizzle and PostgreSQL 18 (identity columns, `jsonb`, `bytea`, cascades); `jose` (`SignJWT` HMAC example).
- Microsoft Agent Framework's AG-UI security considerations (the trusted server builds `RunAgentInput`; state injection); OWASP File Upload and Logging cheat sheets; the UK ICO on monitoring workers.
- Reference projects: `vstorm-co/full-stack-ai-agent-template` 0.2.21 (`ask_user`, tool card, plan panel); `vstorm-co/agenticos` v0.0.535 (approvals, ordinal, Activity); CopilotKit (runtime, stop route, finaliser, `useInterrupt`); assistant-ui (`react-ag-ui`, history and turns); LibreChat, Open WebUI, LobeHub and Dify (storage, admin access, uploads, stop).
