# The conversation store, history, admin Logs and retention (research for Part 2, 2026-10-14)

Research for Part 2 of the provider-hub programme (`docs/superpowers/specs/2026-10-11-provider-hub-charter.md` §4.2, §8). Its topic is the hub-side store of AG-UI conversations, the read-only admin "Logs" view per app (the owner's decision: admins read every user's conversations, users see and delete only their own), and retention.

Ground rules:

- Facts first, each with its source (URL, or file and lines at a named commit). "docs silent" marks a gap; **(opinion)** marks my own reading.
- Section 7 is entirely opinion.
- This note does not repeat `agui-and-reference-hubs.md` or `agui-reference-projects.md`; it adds to them.
- Reference repositories were shallow-cloned into the session scratchpad (nothing run). Sections 3–5 for LibreChat, Open WebUI, LobeHub, agenticos and Dify were read by two helper agents and spot-checked (a sample of their citations was re-read in the clones).

| Source | Version read |
| --- | --- |
| AG-UI docs (`docs.ag-ui.com/<page>.md`) and `ag-ui-protocol/ag-ui` | `main` @ `72e8ad1802ce` (2026-10-13); `@ag-ui/client`/`@ag-ui/core` 1.0.2 |
| CopilotKit/CopilotKit | `main` @ `7643cd4ed1a3` (2026-10-14); runtime and sqlite-runner 1.79.0 |
| microsoft/agent-framework | `main` @ `1b9879c58ac9` (2026-10-13); Python `agent-framework-ag-ui` 1.5.1 |
| assistant-ui/assistant-ui | `main` @ `c6b7f087f7ed` (2026-10-14); `@assistant-ui/react-ag-ui` 0.0.69 |
| LibreChat-AI/LibreChat | `main` @ `e1dfc10449ff` (2026-10-06) |
| open-webui/open-webui | `main` @ `f8ae8a6c3289` (2026-10-10) |
| lobehub/lobehub | `canary` @ `74d973b51e03` (2026-10-14) |
| vstorm-co/agenticos | `main` @ `6f8d24c1fcdc` (v0.0.535, 2026-10-09) |
| langgenius/dify | `main` @ `e421dcc1f532` (2026-10-14) |
| Drizzle | Context7 `/drizzle-team/drizzle-orm-docs`; installed `drizzle-orm` 1.0.0-rc.4 typings |
| PostgreSQL | 18 docs, read 2026-10-14 |
| Vercel AI SDK | https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence, read 2026-10-14 |

## Summary

- **AG-UI.** Its only persistence guide stores events: it is pre-1.0 and its branching meaning of `parentRunId` is superseded. The 1.0 spec says nothing about storage and replays history as `MESSAGES_SNAPSHOT` + `STATE_SNAPSHOT`. The message list carries no run outcome, no interrupts, no `CUSTOM` events and no feedback, so these need their own place (§1).
- **AG-UI backends** (§2):
  - CopilotKit's `SqliteAgentRunner` stores compacted events per run, at run end, keyed by thread only.
  - Microsoft Agent Framework stores the latest messages, state and interrupts per (trusted scope, thread), "no raw events", written at safe points.
  - assistant-ui restores from stored AG-UI messages, plus metadata for interrupts.
- **The five chat hubs** all store one row (or document) per message or turn. Open WebUI is migrating off a per-chat JSON blob. Only agenticos orders by a database identity; the others use timestamps plus a parent pointer (§3).
- **Admin reading** (§4): Open WebUI (on by default) and agenticos (`runs:view`) let admins read whole conversations, Dify lets owners, admins and editors read and also rate and annotate, and LibreChat and LobeHub do not. **None of them audits those reads, and none tells users in the product.**
- **Retention** of ordinary chats is off by default everywhere it exists; LibreChat expires only temporary chats by default. Account deletion cascades to conversations in LibreChat, Open WebUI, LobeHub and agenticos. ICO, OWASP and Open WebUI's own docs say users must be told and access restricted (§5).
- **Recommendation** (§7, opinion): `conversations` / `conversation_runs` / `conversation_messages` (one AG-UI message per row, jsonb body, identity order) plus `message_feedback` and an admin `conversation_access_log`. Write at message boundaries, close stopped runs into valid history, and make the Logs list per app with a read-only transcript drawer and an audited read.

---

## 1. AG-UI's own guidance on persisting threads

Pages read as Markdown on 2026-10-14 from `https://docs.ag-ui.com/<page>.md`; code read from `ag-ui-protocol/ag-ui` `main` @ `72e8ad1802ce` (2026-10-13), `@ag-ui/client` 1.0.2.

### 1.1 The serialization guide (https://docs.ag-ui.com/concepts/serialization) stores events

- Purpose as stated: "persist and restore the event stream that drives an agent–UI session", to "Restore chat history and UI state after reloads or reconnects", "Attach to running agents", "Create branches (time travel) from any prior run" and "Compact stored history".
- Model: the **event stream** is what gets stored ("Stream serialization – Convert the full event history to and from a portable representation (e.g., JSON) for storage in databases, files, or logs"). The example is `storage.save(threadId, JSON.stringify(events))`, then `compactEvents(restored)` on load.
- Implementation notes on the page: "Store streams append‑only; prefer incremental writes when possible", "Consider compression when persisting long histories", "Add indexes by `threadId`, `runId`, and timestamps for fast retrieval".
- Metadata: "persist it alongside everything else or a replayed stream will be missing token usage, trace ids…"; "Prefer JSON for archival storage" (protobuf loses integers above 2^53 and has no representation for some event types).
- **Age and status of the page (fact):** it was written for 0.0.40 (commit `fc74be5f1f`, 2025-11-06) and touched once since, for metadata (`dfe184238b`, 2026-08-18) (`gh api repos/ag-ui-protocol/ag-ui/commits?path=docs/concepts/serialization.mdx`). It is a concepts page, not part of the normative 1.0 spec, and it ends with "Provide SDK helpers for compaction and (de)serialization" — a to-do, not a contract.
- **Branching on that page conflicts with the 1.0 spec (fact):** the page says "Setting `parentRunId` on a `RunStarted` event creates a git‑like lineage … each run can branch from any previous run". The 1.0 spec gives `parentRunId` another meaning: it "names the run that spawned this one, when an agent starts another agent as a separate run" (https://docs.ag-ui.com/spec/1.0/basic/run-input, "Identity"; same wording on https://docs.ag-ui.com/spec/1.0/events/lifecycle, `RUN_STARTED`), and its usage rules treat it as agent-to-agent ("An agent invoked as a separate run — named by `parentRunId` — reports its own usage", lifecycle "Token usage"). The 1.0 spec defines no branching or edit/regenerate mechanism (docs silent). Edits, regeneration and branches are the application's business.
- `RUN_STARTED.input` (an echo of `RunAgentInput`) exists in the 1.0 schema (`RunStartedEventSchema`, `sdks/typescript/packages/core/src/generated/schemas.ts` lines 750–762) and "MAY echo the input the run was started from, so a consumer that did not make the request can still see what the agent was asked" (run-input page). The serialization page's "Normalized Input" (drop already-stored messages from `input.messages`) is a storage convention, not a spec rule.

### 1.2 `compactEvents` (https://docs.ag-ui.com/sdk/js/client/compaction)

- Docs: groups `TEXT_MESSAGE_START → CONTENT* → END` into one `CONTENT`; groups `TOOL_CALL_START → ARGS* → END` into one `ARGS`; moves interleaved events after the block; "All other events (state, custom, etc.) are preserved unchanged"; "It does not modify state events (`STATE_SNAPSHOT`/`STATE_DELTA`) or generate message snapshots."
- **The code disagrees on state (fact):** the 1.0.2 source says "For state: all STATE_SNAPSHOT and STATE_DELTA events within a run are compacted into a single STATE_SNAPSHOT representing the final state" (`sdks/typescript/packages/client/src/compact/compact.ts` lines 76–86, 226, 410–448), and a test file covers it (`compact/__tests__/compact.state-window.test.ts`: deltas alone are not folded into a snapshot, "Replaying that wipes whatever the consumer already held"). Neither the page nor the code produces `MESSAGES_SNAPSHOT` (only a comment mentions it, `compact.ts` line 29), although the serialization page's example shows one. Reasoning events are not compacted (no `REASONING` match in `compact.ts`).
- Caveat on the page and in the code: compaction reorders events, which "is not semantics-preserving in general": parallel tool calls can swap order in `toolCalls`, and "a `MESSAGES_SNAPSHOT` arriving mid-message is replayed after that message's own events and overwrites what they produced" (compaction page "Metadata"; `compact.ts` lines 18–40).
- Use cases on the page: "Persisting event history", "Preparing snapshots for analytics or export", "Reducing noise in tests".

### 1.3 Snapshots and replay (normative 1.0)

- "A single stream MAY carry several runs in sequence — a replayed thread is the common case … A producer restating history … MUST restate it as snapshots: `MESSAGES_SNAPSHOT` reconciles by id and `STATE_SNAPSHOT` replaces, so a restatement the consumer already holds is idempotent. Re-streaming a message the consumer already has appends to it rather than restating it, which is why the streaming triads are for new material only" (https://docs.ag-ui.com/spec/1.0/events/lifecycle, "Several runs on one stream").
- `MESSAGES_SNAPSHOT` is "The complete set of messages the producer owns, in order"; reconciliation: same id replaces in place, unseen ids append, consumer messages absent from it are dropped **except** activity and reasoning messages (unless the snapshot carries some of that role) (https://docs.ag-ui.com/spec/1.0/events/state). `STATE_SNAPSHOT`: "A consumer MUST replace its state with `snapshot` — no merging"; `STATE_DELTA` is RFC 6902 against the current state.
- "State persists across runs on a thread until an event replaces it, and the next run's input carries it back as the starting value … Messages accumulate the same way" (state page, "Cross-run behaviour").
- At an interrupt: "the agent must emit any state required for resume via `StateSnapshot` and `MessagesSnapshot` events **before** the `RunFinished` event that carries the interrupt" (https://docs.ag-ui.com/concepts/interrupts, "State at the interrupt boundary"). And the producer "is not required to remember the interrupts of a prior run … A producer that carries nothing across the gap is conformant" (https://docs.ag-ui.com/spec/1.0/basic/patterns/interrupt-resume). So open interrupts are the consumer's (the hub's) to keep.
- What goes back to the agent: `messages` is "the complete history" (run-input page). "Activity messages never travel back to the producer: a consumer MUST strip them from `messages` before sending" (run-input page). Reasoning messages "are meant to be sent back to the agent for further processing on subsequent turns", possibly as `encryptedValue` only (https://docs.ag-ui.com/concepts/messages, "Reasoning Messages").
- Stopped and failed runs: a stopped run is `RUN_FINISHED` with outcome `cancelled`, after the producer closed every message and tool call it opened; "Everything the run delivered before the stop remains delivered, as after `RUN_ERROR`"; a consumer that just closes the connection has a _truncated_ run and "MUST NOT synthesize a `RUN_FINISHED`" (lifecycle page, "Cancelled runs"). A tool call "cut off mid-arguments closes like any other and what to do with arguments that do not parse is the application's decision" (same section).
- Usage: `RUN_FINISHED.usage`/`RUN_ERROR.usage` carry `TokenUsage` per provider and model; "a consumer wanting a thread's total sums across the thread's runs" (lifecycle, "Token usage").

### 1.4 The message shape the hub would store (`@ag-ui/core` 1.0.2)

From `sdks/typescript/packages/core/src/generated/schemas.ts` lines 462–590 (the schema, which wins over the concepts page where they differ):

- Seven roles in one discriminated union `MessageSchema`: `developer`, `system`, `assistant` (`content?`, `toolCalls?`), `user` (`content`: string or `ContentPart[]`), `tool` (`toolCallId`, `content`: string or parts, `error?`), `activity` (`activityType`, `content`: object), `reasoning` (`content`, `encryptedValue?`). Every role has `id`, optional `metadata` and optional `subagentRunId`; all are `z.looseObject` (unknown keys pass).
- The concepts page names the encrypted field `encryptedContent` on `BaseMessage`/`AssistantMessage` (https://docs.ag-ui.com/concepts/messages, "Message Structure" and "Assistant Messages"); the 1.0 schema calls it `encryptedValue` on every role. The schema is authoritative.
- `ToolCall` is `{ id, type: "function", function: { name, arguments: string } }` plus its own `metadata` (messages page "Tool Calls"; metadata page "Tool calls": tool-call events "merge into the **tool call**, not into the assistant message").
- Metadata merges into the message an event builds, "last write wins, key by key"; run, step, state, `RAW`, `CUSTOM` and reasoning-span events do **not** merge into any message (https://docs.ag-ui.com/concepts/metadata, "What does not merge"). The key `ag-ui` is reserved. So `CUSTOM` events, run outcomes and interrupts have no place in the message list.
- No feedback in the protocol: a "Meta Events" proposal (`META` with `metaType` `thumbs_up`/`thumbs_down`, payload `{ messageId, userId, reason? }`) is a **Draft** (`docs/drafts/meta-events.mdx`, "Status: Draft"), and `@ag-ui/core` has no `META` event (no match in `packages/core/src`).
- Folding events into messages is a client function: `defaultApplyEvents(input, events$, agent, subscribers)` returns `AgentStateMutation`s (messages, state) and also tallies pending tool calls ("every call the run started that got no TOOL_CALL_RESULT") (`packages/client/src/apply/default.ts` lines 135–160; exported from `@ag-ui/client`).

### 1.5 Messages or events: what each source recommends

| Source | Stores | Why, in its words |
| --- | --- | --- |
| AG-UI serialization concept page | Event stream, append-only, compacted | restore, attach to running agents, branching, compaction (§1.1) |
| AG-UI 1.0 spec | Silent on storage; defines replay as `MESSAGES_SNAPSHOT` + `STATE_SNAPSHOT` | "a restatement the consumer already holds is idempotent" (§1.3) |
| CopilotKit `SqliteAgentRunner` | Events per run, compacted (§2.1) | replay on `connect` |
| CopilotKit `InMemoryAgentRunner` | Events per run **and** a thread-level message snapshot (§2.1) | thread routes read messages; events for replay |
| Microsoft Agent Framework snapshot store | Latest messages + state + interrupt, **no events** (§2.2) | "Snapshots do not include raw events, request metadata, auth claims, diagnostics, traces, or provider responses" |
| assistant-ui AG-UI history adapter | AG-UI messages (+ its own metadata for interrupts and data parts) (§2.3) | `fromAgUiMessages` restores a thread from "the persisted AG-UI messages" |
| Vercel AI SDK (not AG-UI, for comparison) | UI messages per chat | "We recommend storing the messages in the `useChat` message format" (https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence, "Storing messages") |

---

## 2. How AG-UI backends persist threads

### 2.1 CopilotKit (`CopilotKit/CopilotKit` `main` @ `7643cd4ed1a3`, 2026-10-14; `@copilotkit/runtime` and `@copilotkit/sqlite-runner` 1.79.0 in the tree)

- **`AgentRunner`** (`packages/runtime/src/v2/runtime/runner/agent-runner.ts`): four abstract methods, `run(request) → Observable<BaseEvent>`, `connect`, `isRunning`, `stop({ threadId, runId? })`. The run request carries `threadId`, `agent`, `input: RunAgentInput` and `persistedInputMessages?`. An optional local thread-endpoint interface lists `listThreads()`, `getThreadMessages(threadId)`, `getThreadEvents(threadId)`, `getThreadState(threadId)`, `clearThreads()`, and a thread record `{ id, name, agentId, organizationId, createdById, archived, createdAt, updatedAt }`.
- **`SqliteAgentRunner`** (`packages/sqlite-runner/src/sqlite-runner.ts`):
  - Tables (lines 72–121): `agent_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, parent_run_id TEXT, events TEXT NOT NULL, input TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL)`, indexes on `thread_id` and `parent_run_id`; `run_state (thread_id TEXT PRIMARY KEY, is_running INTEGER, current_run_id TEXT, updated_at INTEGER)`; `schema_version`.
  - **One row per run, events not messages**: `storeRun` writes `JSON.stringify(compactEvents(events))` for "ONLY the events from this run" plus the `RunAgentInput` (lines 126–149).
  - Written **once, at the end of the run** (success path lines 350–368) or in the `catch` ("Store the run even if it failed (partial events)", lines 396–406). Nothing is written while the run streams.
  - Lineage: `parent_run_id` is set to the thread's latest run (`getLatestRunId`, line 277) and history is read by a recursive CTE from the root run, ordered by `created_at` (lines 151–181). This is the serialization page's lineage idea, not the 1.0 spec's `parentRunId`.
  - Replay (`connect`): all stored runs' events are concatenated and passed through `compactEvents` again, then emitted; message ids already in history are skipped (lines 451–493). Previously seen message ids are also filtered out of the next run's stored `RUN_STARTED.input.messages` (lines 241–255, 274–287).
  - Interrupts and state: no columns of their own; they live inside the stored events (`RUN_FINISHED.outcome`, `STATE_*`).
  - No owner: rows are keyed by `thread_id` only; the docs say "`SqliteAgentRunner` opts out, so its read routes answer `422`" and warn that the in-memory runner "records no thread owner" (`showcase/shell-docs/src/content/docs/backend/agent-runner.mdx`, callout "The in-memory runner records no thread owner"; `auth.mdx` "Scope threads yourself": "Without CopilotKit Intelligence there is no server-side binding between a `threadId` and a user").
  - Stop: `stop()` marks `stopRequested` and calls `agent.abortRun()` (lines 500–535). The run is then **finalized**: `finalizeRunEvents` (`packages/shared/src/finalize-events.ts`) appends `REASONING_END`/`TEXT_MESSAGE_END`/`TOOL_CALL_END` for anything open, a synthetic `TOOL_CALL_RESULT` with `{"status":"stopped","reason":"stop_requested"}` (or `"error"`, `"missing_terminal_event"`) for every tool call without a result, then `RUN_FINISHED` with outcome `cancelled` (only when the client declared a `protocolVersion`) or `RUN_ERROR` code `INCOMPLETE_STREAM` (lines 160–240). So the stored partial turn is well-formed history for the next run.
- **`InMemoryAgentRunner`** (`packages/runtime/src/v2/runtime/runner/in-memory.ts`): keeps compacted events per run **and** a thread-level `messagesSnapshot` ("keep the single latest NON-EMPTY snapshot … so history is never lost", lines 165–185, 398–436); `getThreadState` is the last `STATE_SNAPSHOT` of the compacted events (lines 1040–1060). Bounded by `maxThreads` (1000), `maxRunsPerThread` (100), `maxBytes` (512 MiB) (agent-runner.mdx, "Bounding in-memory history").
- Concurrency: a second `run()` on a busy thread throws `Thread already running` by default; `onConcurrentRun: "supersede"` aborts the old run and "The superseded run's partial output is discarded rather than written to history" (agent-runner.mdx, "Handling a second run on a busy thread"). CopilotKit Intelligence answers 409 for the same case (`intelligence/threads-explained.mdx`, "Thread locked").
- CopilotKit Intelligence (hosted/self-hosted product): "the runtime writes each event (messages, tool calls, and state updates) to the thread", replays with a cursor; threads have rename, **archive** ("a soft delete … can also be unarchived") and **delete** ("permanent and irreversible"); auto-naming from the first run (`intelligence/threads-explained.mdx`). It scopes threads to `identifyUser`'s id, "but `threads/events`, `threads/state` and `agent/stop` still read the thread by id alone" (agent-runner.mdx callout).

### 2.2 Microsoft Agent Framework (`microsoft/agent-framework` `main` @ `1b9879c58ac9`, 2026-10-13; Python `agent-framework-ag-ui` 1.5.1)

Source: `python/packages/ag-ui/README.md` lines 386–555 and `agent_framework_ag_ui/_snapshots.py`.

- Opt-in: "AG-UI Thread Snapshot persistence is opt-in and disabled by default".
- What is stored, per `(Snapshot Scope, threadId)`, latest only: `AGUIThreadSnapshot { messages: list[dict], state: dict | None, interrupt: list[dict] | None, session_state: dict | None }` — "client-replayable message, Shared State, and interruption data plus optional private Session Continuation State … Snapshots do not include raw events, request metadata, auth claims, diagnostics, traces, or provider responses" (`_snapshots.py` lines 66–87).
- Store protocol: `save(scope, thread_id, snapshot)`, `get`, `delete`, `clear(scope?)` (`_snapshots.py` lines 90–152). The built-in store is in memory, "process-local, bounded, latest-only, and not durable"; "No file-backed AG-UI snapshot store is provided … Applications that need durable persistence should provide an app-owned implementation … and own storage hardening, including encryption, integrity protection, access control, retention, audit, data residency, and deletion behavior" (README lines 539–549).
- `snapshot_scope_resolver` is **required** whenever a store is configured; it returns the trusted scope string used with the thread id as the key, and the internal session id is a SHA-256 of `(version, "scoped", scope, thread_id)` so "context providers cannot merge server-side state for equal Thread ids in different scopes" (README lines 481–495; `_snapshots.py` lines 34–55). "AG-UI Thread ids identify AG-UI Threads; they do not authorize snapshot access … choose a Snapshot Scope that represents the app's real access boundary, such as an authenticated user, tenant, or workspace."
- When it writes: "updated after function/MCP tool-result batches and approval safe points, then written once more with the terminal run state … Intermediate snapshots project only completed call/result groups and current approval controls" (README lines 428–434) — i.e. at safe points during the run, never mid-token.
- Hydration: a request with a known `threadId`, `messages: []` and no `resume` replays "the stored Shared State, message snapshot, and canonical interrupt outcome", without running the agent (README lines 395–399).
- Authority table under scoped snapshots: conversation history → "AG-UI Thread Snapshot messages"; approval state → "the Approval State Store" (README lines 511–518). Snapshot mode "only accepts user turns and results for backend-issued tool calls when extending stored history" (lines 386–388).
- Confidentiality: snapshots "may contain sensitive user text, model output, tool results, function arguments, UI payloads, Shared State, interrupt data, and private provider working state" (lines 539–541).
- Consistency: "one active run per `(Snapshot Scope, threadId)`"; with `detached_runs=True` a concurrent mutating request gets HTTP 409; without it, "concurrent writes to the same scoped thread remain last-writer-wins" (lines 462–467, 551–555). Detached runs keep running after the reader disconnects but "This option does not add resumable event replay" (lines 470–475).
- assistant-ui notes that MAF is a host that "owns the thread and seeds a resume request from its own stored snapshot", for which it sends `resumeTranscript: "appended"` (assistant-ui `runtime-options.mdx` line 243).

### 2.3 assistant-ui (`assistant-ui/assistant-ui` `main` @ `c6b7f087f7ed`, 2026-10-14; `@assistant-ui/react-ag-ui` 0.0.69)

Source: `apps/docs/content/docs/runtimes/ag-ui/runtime-options.mdx` and `apps/docs/content/docs/runtimes/concepts/adapters.mdx`.

- History adapter: "If your backend exposes the persisted AG-UI messages of a conversation …, use `fromAgUiMessages` to convert them … and return them from the history adapter so the thread is restored on page load" (runtime-options lines 46–76). The generic adapter is `{ load() → { headId?, messages: { parentId, message }[] }, append({ parentId, message }), update?, delete?, resume? }` — a **parent-pointer tree** with a head (adapters.mdx lines 194–225). `append` "runs after each message completes"; `update` "rewrites a stored message in place, which lets the runtime store a run paused for tool approval and a tool result that arrives after its message settled" (adapters.mdx line 227).
- What the AG-UI message list cannot carry, per these docs:
  - **Interrupts:** "The AG-UI message body has no interrupt field, so persist the runtime's own `metadata.custom.agui.interrupts` array alongside the message … Without the persisted array, interrupt state cannot be reconstructed" (runtime-options line 128).
  - **Run outcome:** "The AG-UI wire snapshot carries no run outcome, so a tool call that a successful run intentionally left without a result is also surfaced as actionable" (line 126).
  - **`CUSTOM` events:** become `data` parts "not sent back to the agent, since the AG-UI assistant record has no field for them. History adapters … persist them as part of the message JSON" (lines 308–321).
  - **Activity:** restored as parts of the preceding assistant message, and "not included in the next AG-UI run input" (line 44).
  - **Sub-agent nesting:** "Nested structure does not survive a reload" (line 269).
- Reasoning: a `reasoning` record is folded onto the following assistant message on load and unfolded "as a standalone `reasoning` record placed ahead of that assistant record, under the id it arrived with" on the next run, so an agent's `encryptedValue` keeps its id (line 85); a reasoning record with only `encryptedValue` is kept in metadata and replayed (line 108).
- Pending work on reload: an assistant tool call without a tool result comes back as `requires-action` (line 126). By default, sending a new message while frontend tool calls are open cancels them "with an error result" so the next run's history is complete (`autoCancelPendingToolCalls`, lines 17, 253). Steering away from an open interrupt sends every open interrupt as `status: "cancelled"` (line 218).
- Thread list adapter (experimental): `{ threadId, onSwitchToNewThread(), onSwitchToThread(id) → { messages, state?, unstable_resume? } }` (lines 140–180).
- Feedback adapter: thumbs up/down on assistant messages, the app posts `{ messageId, rating, comment }` to its own endpoint (adapters.mdx lines 166–191).

### 2.4 Vercel AI SDK, for comparison (not AG-UI)

https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence (read 2026-10-14):

- "We recommend storing the messages in the `useChat` message format" (the display format), saved in `onEnd` with the complete message list.
- IDs: "for persistence, you should use IDs that are stable before messages are stored"; generate assistant ids on the server (`generateMessageId`).
- Validate stored messages on load (`validateUIMessages`) when they hold tools, metadata or data parts.
- "Sending only the last message": once the server persists, the client can send only the new message and the server loads the rest.
- Client disconnects: `result.consumeStream()` "removes the backpressure, meaning that the result is stored even when the client has already disconnected".
- Next.js 16's bundled docs do not say what happens to a Route Handler's upstream stream when the browser disconnects (no match for "abort", "request.signal" or "disconnect" in `node_modules/next/dist/docs/01-app/02-guides/streaming.md` or `backend-for-frontend.md`; docs silent). `after()` runs work "after a response … is finished" (`03-api-reference/04-functions/after.md`).

---

## 3. How chat hubs store conversations and messages

### 3.1 LibreChat (`LibreChat-AI/LibreChat` `main` @ `e1dfc10449ff`, 2026-10-06; MongoDB through Mongoose)

Paths below: `ds/` = `packages/data-schemas/src/`, `dp/` = `packages/data-provider/src/`.

- **Shape: one document per message** in `messages`, and one per conversation in `conversations`, which also keeps a `messages: [ObjectId]` array (`ds/schema/convo.ts` line 40).
- **Conversation:**
  - `conversationId` (indexed), `title` (default "New Chat"), `user` (string), `isTemporary` (`convo.ts` lines 22–44).
  - The preset fields, including `endpoint`, `model` and the model parameters (`ds/schema/defaults.ts` lines 10–23), and `isArchived` (line 155).
  - `agent_id`, `tags[]`, `files[]`, `expiredAt`, `pinned`, `archivedAt`, and timestamps (`convo.ts` lines 71–433).
  - Indexes: a TTL on `expiredAt` (`expireAfterSeconds: 0`), unique `{conversationId, user, tenantId}`, and sidebar indexes such as `{user, isArchived, updatedAt: -1, _id: -1}` (lines 436–471).
- **Message:**
  - Keys: `messageId`, `conversationId`, `user` (all indexed).
  - Model and accounting: `model`, `endpoint`, `parentMessageId`, `tokenCount`, `sender`, `text`, `isCreatedByUser`.
  - Turn state: `unfinished`, `error`, `finish_reason`.
  - `feedback {rating: 'thumbsUp'|'thumbsDown', tag, text}`.
  - Mixed-type fields: `files[]`, `content[]`, `metadata`, `attachments[]`.
  - `expiredAt` and timestamps (`ds/schema/message.ts` lines 7–323).
  - Indexes: a TTL on `expiredAt`, unique `{messageId, user, tenantId}`, and `{conversationId, user, createdAt, _id}` (lines 326–356).
- **Ordering:** reads sort by `createdAt` (`ds/methods/message.ts` line 3062). The client builds the tree from `parentMessageId` and computes the sibling index itself (`dp/messages.ts` lines 50–110). A root message's parent is `NO_PARENT = '00000000-…'` (`dp/config.ts` line 5019).
- **Tool calls, reasoning and files:**
  - `content` is an array of typed parts: `text`, `think`, `tool_call`, `image_file`, `image_url`, `video_url`, `input_audio`, `agent_update`, `summary`, `activity_label`, `steer` and `error` (`dp/types/runs.ts` lines 4–18). A `tool_call` part holds `{id, name, args, output, stepId}` (`dp/types/agents.ts` lines 86–104).
  - A separate `toolcalls` collection holds `{conversationId, messageId, toolId, user, result, attachments, blockIndex, partIndex, expiredAt}` (`ds/schema/toolCall.ts` lines 19–63).
  - Files have their own collection, keyed by `conversationId` and `messageId` (`ds/schema/file.ts` lines 30–38).
- **Partial, stopped and failed turns:**
  - The user message is saved before generation (`api/app/clients/BaseClient.js` line 938), and the response after completion (line 1271).
  - **Stop:** the partial `content`/`text` is saved with `finish_reason: 'incomplete'`, `unfinished: false`, `error: false`, the token count of the partial text, and usage in `metadata` (`api/server/middleware/abortMiddleware.js` lines 47–90).
  - **Client disconnect:** the partial response is saved with `unfinished: true` (`api/server/controllers/agents/request.js` lines 1966–1980).
  - **Error:** a message with `error: true` and the error as `text` (`api/server/middleware/error.js` lines 41–52), or `unfinished: true` when partial text exists (`abortMiddleware.js` lines 231–237).
- **Edits, regeneration, branches:**
  - An edit changes `text`, or one content part, in place (`PUT /api/messages/:conversationId/:messageId`, `api/server/routes/messages.js` lines 632–660).
  - Regenerate and resubmit create **sibling** messages under the same parent (`client/src/hooks/Chat/useChatFunctions.ts` lines 569–614).
  - "Fork" copies messages into a new conversation, with the options `directPath`, `includeBranches` and `targetLevel` (`api/server/utils/import/fork.js`; https://www.librechat.ai/docs/features/fork).
- **Metadata:** feedback on the message (`PUT …/:messageId/feedback`, `messages.js` lines 754–775); `tokenCount`; `metadata.usage`; per-call billing rows in `transactions` with `{user, conversationId, model, tokenType, inputTokens, …, messageId}` (`ds/schema/transaction.ts` lines 25–57).

### 3.2 Open WebUI (`open-webui/open-webui` `main` @ `f8ae8a6c3289`, 2026-10-10; SQLAlchemy on SQLite or PostgreSQL)

Paths below: `be/` = `backend/open_webui/`.

- **Shape: a per-conversation blob being replaced by per-message rows**, with both written today.
  - **`chat` table** (`be/models/chats.py` lines 131–184):
    - `id`, `user_id`, `title`, and **`chat` JSON** (the blob).
    - Epoch-second `created_at`/`updated_at`.
    - `share_id`, `archived`, `pinned`, `meta`, `folder_id`, `summary`, `current_message_id`, …
    - Indexes include `(user_id, updated_at desc, id)`.
  - **The blob** holds `history.messages`, a map by message id with `parentId`/`childrenIds`, and `history.currentId` (lines 1072–1133).
  - **`chat_message` table**, added on 2026-02-01 (migration `8452d01d26d7`, which backfills from the blobs) (`be/models/chat_messages.py` lines 132–175):
    - `id` is `"{chat_id}-{message_id}"`; `chat_id` is an FK to `chat.id` with **ON DELETE CASCADE**.
    - Other columns: `user_id`, `role`, `parent_id`, `content` JSON, `output` JSON, `model_id`, `files`, `sources`, `embeds`, `meta`, `done` (bool), `status_history`, `error` JSON, `usage` JSON, timestamps.
    - Indexes: `(chat_id, parent_id)`, `(model_id, created_at)`, `(user_id, created_at)`, `(chat_id, role, done)`.
- **Writes:** each message update rewrites the whole `chat.chat` JSON **and** upserts the row, in one locked transaction (`SELECT … FOR UPDATE`) (`chats.py` lines 400–407, 1326–1363). `update_chat_by_id` merges the incoming history with the stored one, so a writer holding an older copy does not drop messages (lines 803–853).
- **Reads:** reads prefer `chat_message` rows and fall back to the blob, backfilling as they go (`chats.py` lines 1149–1200).
- **Ordering:** the tree (`parentId`, plus `currentId`/`current_message_id`); flat reads use `created_at` ascending (`chat_messages.py` line 344).
- **Channel messages** are a different system: a `message` table with `channel_id`, threads by `parent_id`, and reactions (`be/models/messages.py` lines 39–58).
- **Tool calls and reasoning:** `output` is a list of Responses-style items:
  - `function_call {id, call_id, name, arguments, status}` (`be/utils/middleware.py` lines 5411–5419);
  - `function_call_output {call_id, output[], status, files, embeds}` (lines 3631–3639);
  - `reasoning {content, summary, start_tag, started_at, status}` (lines 5533–5544).

  Files are in the message's `files` and in a `chat_file` join table with cascading FKs (`chats.py` lines 219–233).

- **Partial, stopped and failed turns:**
  - At turn start the server inserts the user message and an assistant placeholder with `done: False` (`chats.py` lines 1242–1321).
  - While streaming, output goes to Redis or an in-memory buffer, not to the database (`be/tasks.py` lines 199–223). It is saved once at the end with `done: True`, `output` and `usage` (`middleware.py` lines 6593–6611).
  - **Stop:** unfinished items are marked `incomplete` and the partial output is saved (lines 6639–6685).
  - **Error:** saved as `{error: {content}, done: True}` (lines 4278–4290).
  - **Interrupted tool:** gets a synthetic `function_call_output` with status `incomplete` (lines 3642–3659).
  - `ENABLE_REALTIME_CHAT_SAVE` (default False, `be/env.py` line 369) is documented as saving each chunk (https://docs.openwebui.com/reference/env-configuration#enable_realtime_chat_save), but in this clone it is imported and never used (`middleware.py` line 43; the helper's reading).
- **Edits, regeneration, branches:**
  - An edit with submit makes a sibling user message; an edit without submit changes it in place (`src/lib/components/chat/Messages.svelte` lines 323–366).
  - Regenerate adds an assistant child to the parent user message (`Chat.svelte` lines 4357–4385), and the UI steps through siblings.
  - `POST /chats/{id}/fork` and `/clone` (`be/routers/chats.py` lines 1763–1905).
- **Metadata and feedback:**
  - A `feedback` table: `user_id`, `type`, `data` (`rating`, `model_id`, `reason`, `comment`), `meta` (`chat_id`, `message_id`, `tags`), and a `snapshot` JSON holding **a full copy of the chat at rating time** (`be/models/feedbacks.py` lines 20–96; `ResponseMessage.svelte` lines 490–514).
  - Each message stores its `usage`, `model_id` and `created_at`.

### 3.3 LobeHub (`lobehub/lobehub` `canary` @ `74d973b51e03`, 2026-10-14; Drizzle on PostgreSQL)

Paths below are under `packages/database/src/` unless they say otherwise.

- **Shape: one row per message in `messages`** (`schemas/message.ts` lines 95–177): `id text` PK, `role varchar(255)`, `content text`, `editor_data jsonb`, `summary text`, `client_id text`, and the `timestamptz` columns `created_at`, `updated_at` and `accessed_at` (`schemas/_helpers.ts` lines 7–12, 56–60).
- **Ordering: no order column.** Reads sort by `(created_at, id)` (`models/message.ts` line 1544); paged reads sort descending and reverse the page (lines 1730–1740).
- **Foreign keys** (`schemas/message.ts` lines 130–152):
  - ON DELETE CASCADE: `user_id` (NOT NULL), `session_id`, `topic_id`, `thread_id`, `agent_id`, `message_group_id`, `workspace_id`;
  - ON DELETE SET NULL: `parent_id` (self), `quota_id` (self), `group_id`.
- **Indexes** (lines 157–176):
  - `created_at`;
  - unique `(client_id, user_id)`;
  - `topic_id` and `(topic_id, updated_at)`;
  - one per FK;
  - expression indexes on `(usage->>'cost')::numeric` and `(usage->>'totalTokens')::numeric`.
- **Topics are the conversations** (`schemas/topic.ts` lines 27–121):
  - FKs to user, session and agent, all CASCADE;
  - a `status` enum: `active`, `running`, `waitingForHuman`, `scheduled`, `failed`, `completed`, `archived`, `unread`;
  - usage roll-ups (`total_cost`, `total_*_tokens`, `usage` jsonb), plus `model` and `provider`.
- **Threads are sub-topics** (lines 127–187):
  - `type` is `continuation`, `standalone`, `isolation` or `eval`;
  - `topic_id` CASCADE;
  - `source_message_id` with no FK.
- **Tool calls:**
  - the assistant row has `tools jsonb` (`schemas/message.ts` line 122);
  - each result is its own `role = 'tool'` message, plus a `message_plugins` row keyed by that message id (CASCADE), holding `tool_call_id`, `api_name`, `arguments text`, `identifier`, `state jsonb`, `error jsonb` and `intervention jsonb` (lines 182–211).
- **Reasoning and metadata:** `reasoning jsonb`, `search jsonb` (grounding), `metadata jsonb`, `usage jsonb`, `model`, `provider`, `trace_id` (lines 106–125).
- **Side tables:** files go through `messages_files`; there are also TTS, translation, RAG-query and chunk tables (lines 213–354), and `message_groups` (`parallel` or `compression`) (lines 37–87).
- **Partial, stopped and failed turns:**
  - The server creates the assistant placeholder first, then overwrites it at each LLM step's end with content, reasoning, search, tools and the trace id (`packages/agent-runtime/src/executors/callLlmFinalizer.ts` lines 203–215).
  - Output cut off mid-stream is stored with `metadata.interruptedMidStream: true` (lines 427–447).
  - Failures write `{content: '', error}` onto the placeholder (`apps/server/src/services/aiAgent/pipeline/startOperation.ts` lines 459–467).
  - Run status is a separate table, `agent_operations.status`, with the values `abandoned`, `done`, `error`, `idle`, `interrupted`, `running`, `waiting_for_async_tool` and `waiting_for_client` (`schemas/agentOperations.ts` line 63).
- **Branches:**
  - Siblings under one `parent_id`, with the active one in `metadata.activeBranchIndex` on the parent (`packages/types/src/message/common/metadata.ts` line 350; `packages/conversation-flow/src/transformation/BranchResolver.ts`).
  - Deleting a node re-parents its children (`models/message.ts` lines 5251–5256).
  - Compare mode uses `message_groups`.
- **Feedback:** none for chat messages; there is only a `favorite` flag (`schemas/message.ts` line 119).

### 3.4 agenticos (`vstorm-co/agenticos` `main` @ `6f8d24c1fcdc` = v0.0.535) — additions to `agui-reference-projects.md` §2

- **The ordinal** (`backend/app/db/models/conversation.py` lines 160–177) is `BigInteger Identity(always=False, start=1)`: "one deployment-wide identity, not counted per conversation". The model comment gives the reasons:
  - "`created_at` defaults to `func.now()`, which in Postgres is the _transaction's_ start time - and one turn writes the question and the answer inside a single transaction, so both rows carry the same timestamp";
  - "`id` cannot break the tie either: it is `uuid4`";
  - "`MAX(ordinal) + 1` is a read two writers get the same answer to";
  - "Gaps are the price and cost nothing".

  Indexes: `(conversation_id, ordinal)` and a GIN index on the generated `search_vector` (`to_tsvector('simple', content)`) (lines 158–159, 254–259).

- **Message columns** (lines 156–311):
  - `role varchar(20)`, `content text NOT NULL`, `thinking text`, `model_name`, `parts jsonb NULL`;
  - token and cost columns, including `cost_is_partial`;
  - FKs: `conversation_id` CASCADE; `run_id`, `agent_id` and `agent_version_id` SET NULL.
- **Conversation columns** (lines 42–135): `user_id` CASCADE (nullable, indexed), `organization_id` CASCADE, `title`, `is_archived`, `summary_ordinal`, `reminder_state jsonb`. There is no `deleted_at`.
- **A `parts` element** (`backend/app/schemas/conversation.py` lines 16–77):
  - `type` is `text`, `thinking`, `tool` or `ask_user`;
  - a `tool` part points at its `tool_calls` row instead of copying the arguments and result;
  - text is kept unstripped, because it is built from streamed deltas.
- **Partial, stopped and failed turns:**
  - No status on messages. The read path joins `agent_runs.status` through `run_id`, so a half-written answer from a cancelled run shows as such (`services/conversation.py` lines 783–804).
  - Run statuses: `running`, `completed`, `failed`, `cancelled`, `awaiting_approval`, `budget_exceeded`, `guardrail_blocked` (`db/models/agent_run.py` lines 40–58).
  - The transcript is written when the run ends, in a savepoint (`services/transcript.py` lines 246–330). Streaming surfaces also persist what they streamed on fail or cancel (`services/agent_chat.py` lines 203–221, 346–351).
- **Edits, regeneration, branches:** none. Regenerate re-sends the previous user message as a new turn (`frontend/src/components/chat/chat-container.tsx` lines 289–301).
- **Feedback:** a `message_ratings` table with unique `(message_id, user_id)`, `CHECK rating IN (1,-1)`, `comment`, both FKs CASCADE (`db/models/message_rating.py` lines 21–44). App admins can list, summarise and export ratings (`api/routes/v1/admin_ratings.py`).

### 3.5 Dify (`langgenius/dify` `main` @ `e421dcc1f532`, 2026-10-14) — what the hub fronts today and what Part 3 maps

- **Foreign keys:** only `messages.conversation_id → conversations.id` is a real foreign key, with no ON DELETE (`api/models/model.py` line 1458).
- **`conversations`** (lines 1109–1184): `from_source` (`api`/`console`), `from_end_user_id`, `from_account_id`, `invoke_from`, `read_at`, `read_account_id`, `dialogue_count`, `is_deleted`. Indexes include partial `(app_id, created_at DESC)` and `(app_id, updated_at DESC)` `WHERE is_deleted IS false`.
- **`messages`: one row per turn** (query and answer together) (lines 1440–1496):
  - content: `query`, `message` (the prompt JSON), `answer`;
  - accounting: `message_tokens`, `answer_tokens`, prices, `provider_response_latency`;
  - **`parent_message_id`** (regeneration);
  - outcome: `status` (`normal`, `paused`, `error`) and `error`;
  - `workflow_run_id`.

  Indexes include `(app_id, created_at)` and `(created_at, id)`.

- **The thread** is rebuilt by walking `parent_message_id` from the newest message (`api/core/prompt/utils/extract_thread_messages.py` lines 7–25, read with `gh api`).
- **Partial turns:** the row is created at the start with an empty answer. A stop saves the partial answer and its usage; an error sets `status = error` (`core/app/apps/message_based_app_generator.py`, `easy_ui_based_generate_task_pipeline.py`, `based_generate_task_pipeline.py`, read with `gh api`).
- **Side tables:**
  - `message_feedbacks`: `rating like|dislike`, `from_source user|admin`, `content`; no unique constraint (lines 1833–1858);
  - `message_agent_thoughts`, with `position`, `thought`, `tool`, `tool_input`, `observation`, tokens and latency (lines 2430–2470);
  - `message_files` (lines 1883–1908);
  - workflow runs and app logs (`api/models/workflow.py`).

### 3.6 Across the hubs

|  | LibreChat | Open WebUI | LobeHub | agenticos | Dify |
| --- | --- | --- | --- | --- | --- |
| Unit stored | message document | blob per chat + row per message (both written) | row per message | row per message, with `parts` | row per turn (query + answer) |
| Order | `createdAt` + `parentMessageId` tree | tree + `current_message_id`; `created_at` | `(created_at, id)` + `parent_id` | **identity `ordinal`** | `created_at` + `parent_message_id` |
| Tool calls / results | content parts + `toolcalls` collection | `output` items | `tools` jsonb + `role=tool` rows + `message_plugins` | `parts` + `tool_calls` table | `message_agent_thoughts` |
| Reasoning | `think` part | `reasoning` output item | `reasoning` jsonb | `thinking` column + parts | in the answer / thoughts |
| Stopped / failed | `finish_reason: incomplete`, `unfinished`, `error` | `done`, `error`, items `incomplete` | `error` jsonb, `interruptedMidStream`; run status table | run status via `run_id` | `status` `normal`/`paused`/`error` |
| Written while streaming | no (start + end) | no (placeholder, then end; buffer in Redis) | at each step's end | at run end (+ partial on fail/cancel) | row at start, answer at end/stop |
| Branches | siblings + fork | siblings + fork/clone | siblings + `activeBranchIndex`; threads | none | `parent_message_id` |
| Feedback | on the message | `feedback` table with a chat snapshot | none (favourite) | `message_ratings` | `message_feedbacks` (user and admin) |
| Run/turn usage | `tokenCount`, `metadata.usage`, `transactions` | `usage` per message | `usage` jsonb, topic roll-ups | tokens + cost per message | tokens + prices + latency per message |

---

## 4. Admin access to users' conversations

### 4.1 Open WebUI: on by default, read-only in the UI, not audited by default

- **`ENABLE_ADMIN_CHAT_ACCESS` (default `True`, `be/env.py` line 371) gates:**
  - the admin's list of a user's chats, including archived ones, paged, with `query`/`order_by`/`direction` (`GET /chats/list/user/{user_id}`, `be/routers/chats.py` lines 783–813);
  - reading any chat by id (line 1903ff.);
  - **editing and deleting messages, and deleting the chat** (lines 1507, 1573, 1666–1668).
- **UI:** the admin user list shows a "Chats" button when the flag is on (`src/lib/components/admin/Users/UserList.svelte` lines 429–440). It opens `UserChatsModal`; chats open read-only at `/s/{chat.id}`, but the modal offers "Delete Chat" (`UserChatsModal.svelte` lines 109–126; `layout/ChatsModal.svelte`).
- **The docs say:** the chat opens read-only, and "Through the API the admin can also edit or delete its messages, delete the chat, change its share settings and clone it" (https://docs.openwebui.com/reference/env-configuration#enable_admin_chat_access).
- **Other paths to content that the flag does not cover:**
  - `GET /api/v1/analytics/messages?chat_id|user_id|model_id` returns full message rows to any admin, gated by `ENABLE_ADMIN_ANALYTICS` (default `True`) (`be/routers/analytics.py` lines 125–152).
  - The admin Feedbacks view shows the prompt and response from each feedback snapshot, with an export of all of them (`be/routers/evaluations.py` lines 354–364).
- **`ENABLE_ADMIN_EXPORT`** (default `True`, `be/config.py` line 2100) gates `GET /chats/all/db` (all chats) and the SQLite file download (`be/routers/utils.py` lines 74–90).
- **Audit:** `AUDIT_LOG_LEVEL` defaults to `NONE`, and `AUDIT_EXCLUDED_PATHS` defaults to `/chats,/chat,/folders` (`be/env.py` lines 1246–1268; https://docs.openwebui.com/reference/env-configuration#audit_log_level). With defaults, an admin reading chats leaves no audit record. Only chat deletion publishes an event with the actor (`CHAT_DELETED`, `be/routers/chats.py` lines 1697–1703).
- **Users are not told** in the UI (no such string in the en-US locale).
- **The operator docs are explicit:**
  - The admin role is "root-equivalent", and these toggles "are not a security boundary" (env reference, `ENABLE_ADMIN_EXPORT`).
  - "Chat Data Privacy & Encryption" (https://docs.openwebui.com/security/chat-data-privacy-and-encryption) recommends `ENABLE_ADMIN_CHAT_ACCESS=false`, `ENABLE_ADMIN_EXPORT=false` and metadata-only audit logs, and a separate instance for HR or legal. It tells operators to "Publish clear usage guidance" and "Make clear who administers the system and what is retained".
  - The RBAC page says the flag "can prevent Admins from viewing user chats" (https://docs.openwebui.com/features/authentication-access/rbac/roles).

### 4.2 LibreChat: no conversation viewer; an opt-in "Insights" page

- **No admin view of other users' conversations was found.**
  - Message reads are scoped to `{conversationId, user: req.user.id}` (`api/server/routes/messages.js` line 545).
  - The admin API covers users, groups, roles, grants, config and audit (`api/server/routes/admin/`; https://www.librechat.ai/docs/features/admin_panel).
  - Meilisearch search is filtered by user (`messages.js` line 189).
- **Admin Insights** (`ENABLE_INSIGHTS=false` by default, `.env.example` line 69):
  - **What it shows:** recent conversations with the owner's name and email, the conversation id, **the first user message**, the message count and tokens (`dp/types/insights.ts` lines 44–55; `ds/methods/insights.ts` lines 500–525). Search is by conversation id or user.
  - **Who:** per the docs, ADMIN plus `access:admin` plus `read:insights`, flagged as "Sensitive operational data" (https://www.librechat.ai/docs/features/insights). The code also lets non-admins with `READ_INSIGHTS`/`VIEW_INSIGHTS` on an agent see that agent's conversations (`packages/api/src/insights/access.ts` lines 51–90).
- **Audit:** an append-only, hash-chained `auditlogs` collection (`ds/schema/auditLog.ts` lines 45–120). It records grant and insights-permission changes only (`ds/types/admin.ts` lines 50–82); reads are not audited.
- **Privacy guidance:** none found beyond the Insights note (docs silent on telling users).

### 4.3 LobeHub: no admin view of chats

- **No admin console or logs route** was found under `src/app` or `apps/server/src`.
- **Team workspaces:** messages and topics have no `visibility` column and are scoped by `workspace_id` alone, so every member of a workspace can see them (`packages/database/src/utils/workspace.ts` lines 52–57, 150–155; `models/message.ts` lines 1128–1142).
- **Agent share:** the creator may view visitors' sessions only if `allowCreatorViewSessions` is on (default `false`) (`schemas/agentShare.ts` lines 8–13).
- **Audit:** `workspace_audit_logs` exists (`schemas/workspace.ts` lines 124–146); no write for message reads was found.

### 4.4 agenticos: "Activity" with whole-thread transcripts under `runs:view`, not audited

- **`GET /admin/conversations?user_id=`** is for the app admin only. It lists a user's threads (title, count) and never their bodies; its docstring says the deployment-wide conversation browser and its body read were removed "in favour of Activity" (`backend/app/api/routes/v1/admin_conversations.py` lines 12–36).
- **Activity / Runs** (`frontend/src/app/[locale]/(dashboard)/runs/page.tsx`; `GET /runs`, `backend/app/api/routes/v1/runs.py` lines 50–160):
  - **Gate:** `runs:view`.
  - **Filters:**
    - agent, status (including "problems"), surface, user, conversation, model;
    - date range (`started_from`/`to`), environment, exposure, version;
    - `rated=up|down`.
  - **Sort:** started, duration, cost or tokens.
  - **Columns:** status, agent, person, surface, model, tokens, cost, time taken, started, and a link to the chat (`frontend/src/components/runs/run-table.tsx` lines 80–280).
- **`GET /runs/{id}/transcript?scope=run|conversation`** reads another person's run, or with `scope=conversation` the **whole thread**, under `runs:view`. It is read-only (deciding approvals is a separate permission), and a run in another tenant answers 404 (`runs.py` lines 240–289). Owners, admins, builders and operators have `runs:view`; members and viewers do not (`backend/app/core/permissions.py` lines 190–268).
- **Not audited:** `get_run_transcript` writes no audit entry (`services/agent_runner.py` lines 4474–4489).
- **The docs disagree with that endpoint.** `docs/governance.md` says "Reading a run is authorized, not owned" (lines 436–480), but `docs/data-protection.md` line 147 says reading another person's chat is for "Owner, an explicit share, or the deployment's app admin - never an organization role" (the helper's finding; `runs:view` is an organisation role permission). No in-product notice telling users that others can read their chats was found.

### 4.5 Dify: console "Logs" per app, editable, unread-marker only

- **Who:**
  - Owner, admin or editor; "Normal" members cannot open the logs (`edit_permission_required`, `api/controllers/console/wraps.py` lines 402–416; https://docs.dify.ai/en/cloud/use-dify/workspace/team-members-management).
  - Under enterprise RBAC the gate is `APP_VIEW_LAYOUT` (`api/controllers/console/app/conversation.py` line 239).
- **List** (`conversation.py` lines 54–80, 243–345):
  - Parameters: keyword, start and end, `annotation_status` (`all`, `annotated`, `not_annotated`), `sort_by` (±`created_at`, ±`updated_at`; default `-updated_at`), page and limit (≤100).
  - The keyword matches the message query and answer, the conversation name and introduction, and the end-user session id.
- **The UI** (`web/app/components/app/log/filter.tsx` lines 28–37; `log/list.tsx` lines 877–907):
  - Periods: today, 7 days, 4 weeks, 3 months, 12 months, month/quarter/year to date, all.
  - Columns: summary or input, end user, status (Chatflow), message count or output, user rating, operator rating, updated, created.
- **Detail drawer:**
  - Messages are paged by a `first_id` cursor (`message.py` lines 399–440).
  - Per answer it shows tokens, latency, the log (prompt, agent tool iterations, node trace), the team rating and the annotation (https://docs.dify.ai/en/use-dify/monitor/logs, "Inspect a Conversation").
- **Not read-only:**
  - Admins rate answers (stored as `from_source = admin`) and annotate (`message.py` lines 194–216, 455–497).
  - Deleting needs `APP_EDIT` (`conversation.py` lines 377–395).
- **Audit:** opening a conversation only sets `read_at`/`read_account_id` the first time (`conversation.py` lines 398–419). That is an unread marker, not an audit trail. An `operation_logs` table exists (`api/models/model.py` lines 2051–2075), but no writer was found (GitHub code search).

### 4.6 Across the hubs

|  | Admin can read others' chats | Read-only | Filters | Audited | Users told |
| --- | --- | --- | --- | --- | --- |
| Open WebUI | yes, by default (`ENABLE_ADMIN_CHAT_ACCESS=True`), plus analytics and feedback snapshots | UI read-only; API can edit and delete | per user: query, order | no, by default | no (docs tell operators to publish guidance) |
| LibreChat | no; opt-in Insights shows first message, counts, tokens | — | conversation id, user | no (audit covers grants only) | — |
| LobeHub | no admin view; workspace members share rows | — | — | no | — |
| agenticos | yes, with `runs:view` (whole thread via `scope=conversation`) | yes | many (agent, status, user, date, rating, …) | no | no |
| Dify | yes, owner/admin/editor per app | no (rate, annotate, delete) | period, keyword, annotation, sort | no (unread marker only) | no |

---

## 5. Retention, deletion, export and privacy guidance

### 5.1 LibreChat

- **A user deletes their account** (`DELETE /api/user/delete`): the delete removes conversations, messages, shared links, files, tool calls, tags, memories, transactions and other data (`api/server/controllers/UserController.js` lines 521–560). The admin API's user-delete route is commented out (`api/server/routes/admin/users.js` line 49); the CLI `config/delete-user.js` deletes conversations and messages (lines 209–211).
- **Agent deletion** removes ACLs, edges and favourites only; conversations and messages keep the dangling `agent_id` (`ds/methods/agent.ts` lines 1870–1903).
- **Retention settings** (`interface` in `librechat.yaml`):
  - `temporaryChatRetention` (default 720 h, range 1–8760) and `generalChatRetention`;
  - `retentionMode`: `temporary` (default), `all` or `ephemeral`;
  - `retainAgentFiles`.

  MongoDB TTL indexes on `expiredAt` enforce them (`librechat.example.yaml` lines 396–416; `dp/config.ts` lines 2578–2582, 2692–2696; https://www.librechat.ai/docs/features/temporary_chat).

- **User controls:**
  - delete all chats (`DELETE /api/convos/all`) and archive;
  - shared links as a `sharedlinks` collection with a snapshot of message refs and a TTL (`ds/schema/share.ts` lines 44–93);
  - export done in the client, as markdown, text, json, csv or png. Only json and csv include branches (`client/src/components/Nav/ExportConversation/ExportModal.tsx`).
- **No admin export of all chats** was found.

### 5.2 Open WebUI

- **Admin deletes a user:** `Users.delete_user_by_id` → `Chats.delete_chats_by_user_id` deletes shared chats, `chat_message` rows and `chat` rows (`be/models/users.py` lines 845–859; `be/models/chats.py` lines 2668–2686). **Feedback rows and their chat snapshots are not deleted on that path** (the helper's reading of the same code). Users can delete their own feedback (`be/routers/evaluations.py` lines 381–387).
- **Model deletion** does not touch chats; `model_id` strings stay (`be/routers/models.py` has no reference to chats).
- **No chat retention or auto-delete setting** was found in `be/env.py` or `be/config.py`. Temporary chats (ids `temporary:`/`local:`) are never stored (`be/utils/chat_id.py`); permissions `USER_PERMISSIONS_CHAT_TEMPORARY`/`…_ENFORCED` (`be/config.py` lines 1915–1917).
- **User controls:**
  - delete all and archive (`be/routers/chats.py` lines 752, 1174, 2014);
  - sharing, which stores a snapshot row in `shared_chat` with a cascading FK (`be/models/shared_chats.py` lines 26–36);
  - export of the user's own chats as NDJSON (`GET /chats/all`, `be/routers/chats.py` lines 1038–1074), and of one chat as json, txt or pdf.
- **Admin export:** all chats, and the SQLite file, under `ENABLE_ADMIN_EXPORT` (§4.1).

### 5.3 LobeHub

- **Cascades:** deleting a user removes their sessions, topics and messages; deleting an agent removes its topics and messages (`schemas/session.ts` line 29, `topic.ts` lines 47–49, `message.ts` lines 130–132). `agent_operations.user_id` is deliberately not an FK, so operation records survive the user (`schemas/agentOperations.ts` lines 44–50).
- **Trash:**
  - Soft delete through `is_deleted`/`deleted_at` (`schemas/_helpers.ts` lines 36–39) and a `trash_items` registry with `expires_at` and a purge sweep (`schemas/trash.ts` lines 35–97).
  - `TRASH_RETENTION_DAYS = 30` (`packages/const/src/trash.ts` lines 6–8).
  - `deleted_by_user_id` records a workspace owner tidying a member's rows.
- **Export:** per topic as image, text, PDF or JSON (`docs/usage/agent/topic.mdx`). A whole-workspace export needs `workspace:delete:all` (`apps/server/src/routers/lambda/exporter.ts` lines 27–28).

### 5.4 agenticos

- **Hard delete only:** `DELETE /conversations/{id}` cascades and purges the conversation's workspace (`backend/app/api/routes/v1/conversations.py` lines 173–192; `docs/data-protection.md` line 192). The only soft state is `is_archived`.
- **Retention per data class:**
  - The classes are conversations, runs, workspaces, artifacts, memory, knowledge documents and audit.
  - The default is to keep for ever, with an organisation setting and a deployment ceiling. Audit has a floor of 2190 days and is never swept (`backend/app/core/retention.py` lines 1–70).
  - A daily sweep deletes conversations with `updated_at < cutoff`, and messages cascade (`repositories/retention.py` lines 93–111; `docs/data-protection.md` line 161).
- **On deletion:**
  - **User deleted:** conversations cascade; `agent_runs.user_id` and `conversation_id` are set to NULL (`db/models/agent_run.py` lines 179–198).
  - **Agent deleted:** its runs cascade, and `messages.run_id`/`agent_id` become NULL.
- **Export:** `GET /me/data/export` returns JSON "for GDPR art. 15/17" and is audited (`api/routes/v1/me_personal_data.py` lines 13–43; `docs/data-protection.md` line 163). Runs can also be exported as CSV (`runs.py` lines 163–193).

### 5.5 Dify

- **App deleted:** a task hard-deletes its conversations, messages, feedback, annotations, agent thoughts, files, end users and workflow runs and logs (`api/tasks/remove_app_and_related_data_task.py` lines 63–101, 378–435).
- **Conversation deleted** (console or service API `DELETE /conversations/{id}`):
  - First `is_deleted = true`, then an asynchronous physical cleanup (`services/conversation_service.py` lines 197–234; `tasks/delete_conversation_task.py` lines 47–89).
  - The cost is partial indexes on `is_deleted` on every list path (§3.5).
- **Account deleted:** the task only calls billing (`tasks/delete_account_task.py` lines 17–24).
- **Retention (self-hosted):**
  - Logs are kept for ever by default.
  - `ENABLE_CLEAN_MESSAGES` (default false) plus `SANDBOX_EXPIRED_RECORDS_RETENTION_DAYS` (default 30) cover messages; `WORKFLOW_LOG_CLEANUP_ENABLED` plus `WORKFLOW_LOG_RETENTION_DAYS` (default 30) cover workflow logs (`api/configs/feature/__init__.py` lines 1454–1457, 1652–1653, 1694–1697; https://docs.dify.ai/en/self-host/use-dify/monitor/logs).
  - A Celery beat job at 04:00 hard-deletes messages by a `(created_at, id)` cursor (`schedule/clean_messages.py`; `services/retention/conversation/messages_clean_service.py`).
- **Retention (cloud):** sandbox plans keep 30 days of logs; paid plans keep conversations for the subscription (https://docs.dify.ai/en/use-dify/monitor/logs).

### 5.6 Privacy guidance on admins reading chats

- **Open WebUI's own docs** (§4.1) are the only hub docs found that address it. They recommend switching admin chat access and export off where privacy matters, keeping metadata-only audit logs, and "Publish clear usage guidance … Make clear who administers the system and what is retained" (https://docs.openwebui.com/security/chat-data-privacy-and-encryption).
- **ICO, "Monitoring workers"** (UK GDPR; the hub is a company-internal tool, so admins reading employees' chats is workplace monitoring in this guidance's sense):
  - "Apart from in very exceptional circumstances where covert monitoring is justified, you **must** inform workers about any monitoring."
  - "You **must** carry out a DPIA before undertaking any processing likely to cause high risk", and "you **must** provide information about it to your workers before you begin monitoring."
  - "You **must not** keep personal information obtained from monitoring workers for any longer than is necessary … You **should not** retain information just in case."
  - "restrict access to the information to only those who need access"; "set clear rules limiting disclosure and access to the information you collect."

  Source: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/data-protection-and-monitoring-workers/, read 2026-10-14.

- **ICO, "What privacy information should we provide?"**: people must always be told "The retention periods for the personal data … If you don't have a specific retention period then you need to tell people the criteria you use" (https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/). This is the UK reading of GDPR Art. 13(2)(a). The other GDPR rights that bear on the store are access (Art. 15), erasure (Art. 17), portability in "a structured, commonly used and machine-readable format" (Art. 20) and storage limitation (Art. 5(1)(e)) (Regulation (EU) 2016/679, https://eur-lex.europa.eu/eli/reg/2016/679/oj; EUR-Lex refused the automated fetch, so these four are cited by article, not quoted). Whether GDPR or UK GDPR applies to the owner's company is not established here.
- **OWASP Top 10 for LLM Applications 2025, LLM02 Sensitive Information Disclosure:**
  - "Limit access to sensitive data based on the principle of least privilege";
  - "Maintain clear policies about data retention, usage, and deletion" (https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/, "Access Controls", "Ensure Transparency in Data Usage").
- **OWASP Logging Cheat Sheet:**
  - Events to log include "Use of systems administrative privileges or access by application administrators including all actions by those users", "Access to sensitive data" and "Data import and export including screen-based reports".
  - "Sensitive personal data" should usually be kept out of the log itself.
  - "The privileges to read log data should be restricted and reviewed periodically."

  Source: `OWASP/CheatSheetSeries` `cheatsheets/Logging_Cheat_Sheet.md`, last commit `d3b4f6f6fb92`, 2026-10-04, lines 98–112, 185–195, 314. For the hub this means an audit row records who opened which conversation, not the conversation's text.

- **Microsoft Agent Framework** puts the same duty on whoever stores AG-UI snapshots: "own storage hardening, including encryption, integrity protection, access control, retention, audit, data residency, and deletion behavior" (§2.2).

---

## 6. PostgreSQL 18 and Drizzle specifics

Drizzle docs through Context7 (`/drizzle-team/drizzle-orm-docs`) and the installed `drizzle-orm` 1.0.0-rc.4 typings; PostgreSQL 18 pages read with crawl4ai on 2026-10-14.

### 6.1 jsonb size, TOAST and updates

- Any TOAST-able value is limited to 1 GB ("limiting the logical size of any value of a TOAST-able data type to 1 GB (2^30 - 1 bytes)", https://www.postgresql.org/docs/18/storage-toast.html). The docs give no separate jsonb limit (docs silent).
- TOAST starts when a row is wider than `TOAST_TUPLE_THRESHOLD` ("normally 2 kB"); values are compressed and/or moved out of line in ~2000-byte chunks. "During an UPDATE operation, values of unchanged fields are normally preserved as-is; so an UPDATE of a row with out-of-line values incurs no TOAST costs if none of the out-of-line values change" (same page). The compression method is per column (`COMPRESSION`) or `default_toast_compression` (same page).
- Design guidance for JSON: "any update acquires a row-level lock on the whole row. Consider limiting JSON documents to a manageable size … Ideally, JSON documents should each represent an atomic datum that business rules dictate cannot reasonably be further subdivided into smaller datums that could be modified independently" (https://www.postgresql.org/docs/18/datatype-json.html, 8.14.2 "Designing JSON Documents").
- `jsonb` "does not preserve the order of object keys, and does not keep duplicate object keys" (same page, 8.14). Array order is kept (only containment ignores it). So a message's `content` parts array keeps its order inside jsonb; object key order does not matter to AG-UI's schemas.
- HOT updates (no index churn) need "The update does not modify any columns referenced by the table's indexes" (https://www.postgresql.org/docs/18/storage-hot.html). An index that includes `conversations.updated_at` makes every "touch" of a conversation a non-HOT update (fact about PostgreSQL; how much it matters at the hub's scale is opinion: little).

### 6.2 Ordering: identity vs timestamps vs UUIDv7

- Identity columns: "generated automatically from an implicit sequence"; an identity column "does not guarantee uniqueness" without a PK/UNIQUE (https://www.postgresql.org/docs/18/ddl-identity-columns.html).
- Gaps: "the value obtained by `nextval` is not reclaimed for re-use if the calling transaction later aborts … PostgreSQL sequence objects _cannot be used to obtain “gapless” sequences_" (https://www.postgresql.org/docs/18/functions-sequence.html).
- Order: "with a _cache_ setting of one it is safe to assume that `nextval` values are generated sequentially; with a _cache_ setting greater than one you should only assume that the `nextval` values are all distinct, not that they are generated purely sequentially"; the default cache is 1 (https://www.postgresql.org/docs/18/sql-createsequence.html, Notes). The docs do not promise that values are _committed_ in `nextval` order (docs silent); within one conversation the hub writes sequentially (one active run per thread), so that question does not arise there (opinion).
- PostgreSQL 18 adds `uuidv7()`: "Generates a version 7 (time-ordered) UUID … UNIX timestamp with millisecond precision + sub-millisecond timestamp + random" (https://www.postgresql.org/docs/18/functions-uuid.html); "PostgreSQL provides native support for generating UUIDs using the UUIDv4 and UUIDv7 algorithms" (https://www.postgresql.org/docs/18/datatype-uuid.html).
- Timestamps tie inside a transaction: the SQL-standard current-time functions "return the start time of the current transaction … so that multiple modifications within the same transaction bear the same time stamp"; only `clock_timestamp()` changes during a statement (https://www.postgresql.org/docs/18/functions-datetime.html, 9.9.5). Drizzle's `defaultNow()` (`pg-core/columns/date.common.d.ts` line 11) is the `DEFAULT now()` the hub's tables use (`db/schema/users.ts`, `apps.ts`), so a user message and its run row written in one transaction carry the same `created_at`. agenticos's model comment makes exactly this point and adds that a uuid4 cannot break the tie (§3.4). The hub's `timestamptz` helper also stores only milliseconds from a JS `Date` (`db/schema/columns.ts`).
- Drizzle: `integer().primaryKey().generatedAlwaysAsIdentity()` (Drizzle "PostgreSQL column types", Identity Columns); `bigint` takes `{ mode: 'number' | 'bigint' | 'string' }`, and "If you're expecting values above 2^31 but below 2^53, you can utilise `mode: 'number'`" (same page, bigint); the installed `PgBigInt53Builder`/`PgBigInt64Builder` extend `PgIntColumnBuilder`, which declares `generatedAlwaysAsIdentity()`/`generatedByDefaultAsIdentity()` (`node_modules/drizzle-orm/pg-core/columns/int.common.d.ts` lines 12–19, `bigint.d.ts` lines 6–46). Drizzle's `uuid()` builder has `defaultRandom()` (v4) and no v7 helper in 1.0.0-rc.4 (`pg-core/columns/uuid.d.ts` line 15); a `default(sql\`uuidv7()\`)`would be the route (opinion; the Drizzle docs show`.default(sql\`…\`)` for jsonb defaults).

### 6.3 Indexes for "conversations of user X in app Y, newest first"

- "A multicolumn B-tree index … is most efficient when there are constraints on the leading (leftmost) columns … equality constraints on leading columns, plus any inequality constraints on the first column that does not have an equality constraint" (https://www.postgresql.org/docs/18/indexes-multicolumn.html).
- "only B-tree can produce sorted output"; a B-tree "can also be scanned backward, producing output satisfying `ORDER BY x DESC`"; indexes are "more useful when only a few rows need be fetched", the `ORDER BY … LIMIT n` case (https://www.postgresql.org/docs/18/indexes-ordering.html).
- So `(user_id, app_id, updated_at)` serves `WHERE user_id = $1 AND app_id = $2 ORDER BY updated_at DESC LIMIT n` (backward scan); `(app_id, updated_at)` serves the admin Logs list of one app. Drizzle index columns take `.asc()`, `.desc()`, `.nullsFirst()`, `.nullsLast()` (`pg-core/columns/common.d.ts` lines 263–279; Drizzle "Indexes & Constraints": `index('name').on(table.column1.asc(), table.column2.nullsFirst())`), and `.using('gin', …)` for a GIN index (`pg-core/indexes.d.ts` line 56).
- Messages: a unique `(conversation_id, seq)` (or `(conversation_id, id)` with a bigint id) serves "messages of conversation C in order" by an index range scan (opinion, from the two pages above).

### 6.4 Cascading deletes

- `ON DELETE CASCADE` fits "When the referencing table represents something that is a component of what is represented by the referenced table and cannot exist independently"; `RESTRICT`/`NO ACTION` when the objects are independent; `SET NULL` sets the referencing columns to null (https://www.postgresql.org/docs/18/ddl-constraints.html, 5.5.5).
- "it is often a good idea to index the referencing columns too … the declaration of a foreign key constraint does not automatically create an index on the referencing columns" (same section). The hub already follows this (`db/schema/app-grants.ts` comment).
- Drizzle: `.references(() => users.id, { onDelete: 'cascade' })` or `foreignKey({...}).onDelete('cascade')` (Drizzle "Relations", foreign key actions; "Indexes & Constraints").
- `typed jsonb`: `jsonb().$type<T>()` gives compile-time types only, it "**won't** check runtime values" (Drizzle "PostgreSQL column types", jsonb). The hub's pattern of untyped jsonb read through zod (`db/schema/apps.ts` comment, ADR-0025) applies to message bodies too (opinion).
- The hub today hard-deletes users (`lib/data/users.ts` line 361, `tx.delete(users)`) and apps (`lib/data/apps.ts` line 597), and grants cascade from both (`db/schema/app-grants.ts`).

---

## 7. Implications for the hub (opinion)

Everything in this section is **(opinion)**, derived from the facts above. Decisions marked "owner" are for the owner to take in Part 2's spec.

### 7.1 Store messages, not events

The hub should store **AG-UI messages, one row per message, in an explicit order**, plus a **run row per AG-UI run** and the **thread's state**, and should not make an event log its source of truth:

1. **The hub needs messages on every run.** `RunAgentInput.messages` is "the complete history" (§1.3), so each run starts by reading the thread's messages. An event store has to be folded on every read (CopilotKit re-runs `compactEvents` over every stored run on each `connect`, §2.1).
2. **The normative 1.0 spec replays history as snapshots, not events** (`MESSAGES_SNAPSHOT` reconciles by id, `STATE_SNAPSHOT` replaces, §1.3). A message row keyed by `(conversation, AG-UI id)` is exactly what that reconciliation needs: upsert by id, append unseen ids in order.
3. **The events page is older and partly superseded.** The serialization guide predates 1.0, its `parentRunId` branching contradicts the 1.0 meaning, and `compactEvents`' own docs warn that compaction reorders and is "not semantics-preserving in general"; its docs and its code disagree about state (§1.1, §1.2).
4. **The two backends that persist for a multi-user server store messages:** Microsoft Agent Framework's snapshot (messages + state + interrupts, "no raw events", §2.2), and assistant-ui's history adapter (AG-UI messages, §2.3). The AI SDK recommends the display format too (§2.4). All five chat hubs store messages or turns, never events, and Open WebUI is moving from a per-chat blob to per-message rows (§3.6).
5. **The Logs view reads messages.** An admin transcript is the same rendering as the user's, and keyword search, counts and feedback attach to messages.
6. **Row per message, not one document per conversation:** PostgreSQL's own guidance is a JSON document per "atomic datum" because "any update acquires a row-level lock on the whole row" (§6.1). Streaming writes then touch one small row, not a growing blob.

Keep a raw event log only as an optional debugging aid with a short retention, if ever. It is not needed in Part 2.

### 7.2 What the message list cannot hold, and where it goes

| Item | Why not in the message body | Where |
| --- | --- | --- |
| Run outcome (success, interrupt, cancelled), `RUN_ERROR`, usage | Run events "do not merge" into messages (§1.4); "The AG-UI wire snapshot carries no run outcome" (§2.3) | `conversation_runs` row |
| Open interrupts and the user's answers (`resume[]`) | "The AG-UI message body has no interrupt field" (§2.3); the producer may remember nothing across the gap (§1.3) | `conversation_runs.outcome` (interrupts) and `.resume` (answers); the "open" set is the last run's interrupts when it ended in `interrupt` |
| Pending frontend tool calls | Derivable: assistant `toolCalls` with no `tool` message (`defaultApplyEvents` tally, §1.4), or `outcome.pendingToolCallIds` | derived on read; optionally copied into the run's outcome |
| Shared state | State "persists across runs on a thread" and goes back in `RunAgentInput.state` (§1.3) | `conversations.state jsonb` (latest), written at `STATE_SNAPSHOT`/`STATE_DELTA` safe points |
| `CUSTOM` events (provider extras, Part 3's `dify:*`) | No field in the assistant record (§2.3) | message `metadata` under a hub key (as assistant-ui stores data parts in message JSON), or a per-run list; never sent back to the agent |
| Activity messages | Are messages, but "MUST" be stripped before sending (§1.3) | ordinary rows with `role = 'activity'`, filtered out when the hub builds `RunAgentInput` |
| Feedback | No AG-UI event (META is a draft, §1.4) | `message_feedback` table |

### 7.3 Recommended store shape

Drizzle on PostgreSQL 18, following the hub's existing conventions (`uuid` ids from `generateUuidV4`, the `timestamptz` helper, text + CHECK for open value sets as `apps.provider` does, jsonb read through zod). Names are suggestions.

**`conversations`** — one per AG-UI thread.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | the AG-UI `threadId`, minted by the hub; the browser's id is a continuation id checked against the session (charter §4.3) |
| `app_id` | `uuid` NOT NULL → `apps.id` ON DELETE CASCADE |  |
| `user_id` | `uuid` NOT NULL → `users.id` ON DELETE CASCADE | the owner of the thread; every user-side query filters on it |
| `title` | `text` | first user message, trimmed, until renamed |
| `state` | `jsonb` NOT NULL DEFAULT `'{}'` | the thread's AG-UI shared state after the last run |
| `active_run_id` | `uuid` NULL | one active run per thread; a second run while set answers 409 (MAF and CopilotKit Intelligence do the same, §2.1–2.2) |
| `provider_thread_id` | `text` NULL | for Part 3 (Dify's own `conversation_id`); null for AG-UI |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` = last activity |
| `deleted_at` | `timestamptz` NULL | only if the owner chooses soft delete (§7.5) |

Indexes: `(user_id, app_id, updated_at)` for the user's list; `(app_id, updated_at)` for the app's Logs; FK indexes are covered by these leading columns.

**`conversation_runs`** — one per AG-UI run.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | the AG-UI `runId`, minted by the hub, never reused |
| `conversation_id` | `uuid` NOT NULL → `conversations.id` ON DELETE CASCADE |  |
| `status` | `text` + CHECK | `running`, `succeeded`, `interrupted`, `cancelled`, `failed`, `truncated` (the connection ended without a terminal event; the hub must not invent a `RUN_FINISHED`, §1.3) |
| `outcome` | `jsonb` NULL | `RUN_FINISHED.outcome` as received (interrupts, `pendingToolCallIds`) |
| `resume` | `jsonb` NULL | the `resume[]` this run was started with: the user's decisions, kept for the Logs view |
| `error` | `jsonb` NULL | `RUN_ERROR` `{ message, code }` |
| `usage` | `jsonb` NULL | `TokenUsage[]` from the terminal event |
| `protocol_version` | `text` NULL | from `RUN_STARTED` (0.x agents omit it) |
| `started_at`, `finished_at` | `timestamptz` |  |

Index: `(conversation_id, started_at)`.

**`conversation_messages`** — one per AG-UI message.

| Column | Type | Notes |
| --- | --- | --- |
| `seq` | `bigint` GENERATED ALWAYS AS IDENTITY PK (`mode: 'number'`) | the order, one deployment-wide identity as agenticos does it (§3.4). One active run per thread means rows of a thread are inserted in arrival order, so `ORDER BY seq` within a conversation is the transcript order; gaps do not matter, and `created_at` cannot do this job (ties inside a transaction, §6.2) |
| `conversation_id` | `uuid` NOT NULL → CASCADE |  |
| `run_id` | `uuid` NULL → `conversation_runs.id` ON DELETE SET NULL | the run that produced the message (a user message: the run it started) |
| `message_id` | `text` NOT NULL | the AG-UI `id`; producers choose it, so it is unique per conversation only: UNIQUE `(conversation_id, message_id)` |
| `role` | `text` + CHECK (seven roles) | duplicated from the body for filtering |
| `body` | `jsonb` NOT NULL | the AG-UI message object as `@ag-ui/core`'s `MessageSchema` parses it (loose objects keep unknown keys), metadata included |
| `status` | `text` + CHECK | `streaming`, `complete`, `incomplete` (stopped, failed or truncated while open) |
| `created_at`, `updated_at` | `timestamptz` |  |

Index: the UNIQUE `(conversation_id, message_id)`; plus `(conversation_id, seq)` for ordered reads (or make the PK `(conversation_id, seq)`).

A `tool` message that answers a frontend tool arrives in the _next_ run's input and is appended then, after the assistant message that asked; a reasoning message streams before its assistant message and gets the lower `seq`, which is the order assistant-ui expects when it folds reasoning onto the following assistant record (§2.3).

**`message_feedback`** — `message_seq` → `conversation_messages.seq` ON DELETE CASCADE, `user_id` → `users.id` ON DELETE CASCADE, `rating` (`like`/`dislike`), `comment` text NULL, timestamps; PK `(message_seq, user_id)`.

**`conversation_access_log`** — the audit of admin reads: `id`, `actor_id` (`uuid`, no FK, like `users.admin_deactivated_by`, so the record outlives the admin), `conversation_id` and `app_id` (no FK, so the record outlives a deleted conversation), `action` (`view`, `export`), `at`. Index `(conversation_id, at)` and `(actor_id, at)`.

### 7.4 How it is written (the charter's "written as a run streams")

- Before the run: insert the user message(s) and the run row (`running`), set `active_run_id` — one transaction.
- During the run, at boundaries, not per token (MAF writes "after tool-result batches and approval safe points", §2.2; PostgreSQL rewrites the whole row on every update, §6.1): insert a message row at its `*_START` with `status = 'streaming'`; update its body at `*_END`, at `TOOL_CALL_RESULT`, and on a timer (every few seconds) while a long text streams, so a crash keeps most of what arrived; write `state` at `STATE_SNAPSHOT` and after a batch of `STATE_DELTA`s.
- Folding events into messages: reuse `@ag-ui/client`'s reducer (`defaultApplyEvents`) or `@ag-ui/core`'s schemas rather than a hand-written fold (ADR-0002), subject to the dependency note in `agui-and-reference-hubs.md` (the client brings RxJS and zod 3).
- At the end: update the run row (`status`, `outcome`, `error`, `usage`, `finished_at`), clear `active_run_id`, touch `conversations.updated_at`.
- On stop, failure or truncation: close what is open the way CopilotKit's finalizer does (§2.1) — mark open messages `incomplete`, and give every tool call that has no result a synthetic `tool` message (`{"status":"stopped"}` or `"error"`), so the next `RunAgentInput` is valid history for the model. assistant-ui does the same for unanswered frontend tools when the user moves on (`autoCancelPendingToolCalls`, §2.3).
- Building the next `RunAgentInput`: all rows in `seq` order, minus `activity` rows (MUST, §1.3), minus `incomplete` text only if the owner prefers (keeping it matches "everything the run delivered … remains delivered"); `state` from the conversation; `resume[]` checked against the last run's open interrupts (all covered, none unknown, none expired).

### 7.5 Edits, regeneration, branches

AG-UI 1.0 has no branching (§1.1). Two shapes fit the store above:

1. **Linear only (recommended for Part 2):** regenerate and edit replace the tail. The old tail is deleted, or kept with a `superseded_by_run_id` so the Logs view can still show it. `useXChat` holds one message list, which matches.
2. **A tree later:** add a nullable `parent_message_id` (as LibreChat, Open WebUI and Dify do, and as assistant-ui's history adapter models with `{ parentId, message }` and a `headId`, §2.3), and build `RunAgentInput.messages` from the path to the head. This is additive and can wait for an owner-picked UI.

### 7.6 Deletion and retention (owner decisions, with a default)

- **User deletes a conversation:** the default is a hard delete with cascade, as agenticos does it (§5.4). It is simplest and matches "users delete their own". The alternative, if the owner wants admins to keep seeing deleted conversations for N days, is `deleted_at` plus a purge job, as Dify (soft delete, then async cleanup) and LobeHub (a 30-day trash) do (§5.3, §5.5). The cost, which Dify's schema shows, is a `deleted_at IS NULL` filter and partial indexes on every user-side list, and the privacy notice must say so.
- **Account deleted** (the hub hard-deletes accounts): cascade the account's conversations. A "keep logs, anonymise the user" option would need `user_id` nullable with `SET NULL`.
- **App deleted:** cascade, as the grants do.
- **Retention:** an optional `CHAT_RETENTION_DAYS` in the ADR-0030 style (environment or admin page, off by default). It runs as a croner job registered next to the directory sync in `instrumentation.ts` (ADR-0029's pattern), deletes conversations whose `updated_at` is older than the limit, and records the run.

  Precedents: agenticos's daily sweep on conversations' `updated_at`, default keep-for-ever; Dify's `ENABLE_CLEAN_MESSAGES` plus a days setting, default off; LibreChat's TTL indexes (§5). Keep the access log longer than the conversations, as agenticos keeps its audit at a floor of 2190 days.

- **Export:** a user exports their own conversations as AG-UI JSON. An admin export of an app's logs, if wanted, is written to `conversation_access_log` (OWASP lists "Data import and export" as higher-risk functionality to log).

### 7.7 The admin Logs view

- **Where and who:** a read-only "Logs" page per app in the admin area, gated like the other admin pages (ADR-0024: owner and admin), served by DAL functions that take the verified actor and never the client's say-so.
- **List:** one row per conversation:
  - the user (name, email) and the title or first user message;
  - message count and last activity;
  - status badges (failed, stopped, waiting for approval);
  - feedback counts and token total (summed from the runs).

  Filters: date range on last activity, user, status, feedback (liked or disliked) and, later, keyword. Keyset pagination on `(updated_at, id)`, using the `(app_id, updated_at)` index.

- **Detail:** the transcript rendered by the shared chat components in a read-only mode (no composer, no approve or reject, no feedback buttons). Beside it, a run timeline (status, duration, usage, error, the interrupts and the user's answers), and the final state as collapsed JSON.
- **Audit:** opening a transcript or exporting writes a `conversation_access_log` row (OWASP: log "access by application administrators" and "Access to sensitive data"). None of the five hubs does this (§4.6), so this would be the hub's own addition, not an established pattern. The owner may want to see that log, and users could be shown "viewed by an admin", the owner's choice.
- **Closest models:** agenticos's Activity (a filterable run table, and a whole-thread read-only transcript under one permission) and Dify's per-app Logs (period, keyword, sort, list columns, detail drawer) are the two to borrow from (§4.4, §4.5). Dify's admin rating and annotation are what the owner's "read-only" rules out.
- **Transparency:** tell users before they chat that admins can read their conversations. Put it once in the chat (a line under the composer or a first-visit notice) and in any privacy text. The ICO says employers "must inform workers about any monitoring" and must restrict access to those who need it. GDPR, where it applies, requires telling people the retention period (Art. 13(2)(a)), and gives them access, erasure and portability rights (Art. 15, 17, 20). OWASP LLM02 asks for "clear policies about data retention, usage, and deletion".
- **Part 3:** Dify conversations use the same tables (`provider_thread_id` set), so one Logs view covers both providers. Dify's own console logs then become a second copy, a point for Part 3's spec.
