---
status: proposed
date: 2026-10-14
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
- `@ag-ui/client` and `@ag-ui/encoder` bring `rxjs`, `fast-json-patch` and a second zod (3.25.x, beside the hub's 4.6.5; `@ag-ui/proto` needs it too). `@ag-ui/client` and `@ag-ui/proto` also bring `@protobuf-ts/protoc` and `@types/uuid` as runtime dependencies. They are server-only: the browser parses events with XRequest and a pure reducer and imports `@ag-ui/core` types only.
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
- Where the build departed from the plan (ruled while it ran): `turnsFromMessages` joins a run that only tool rows carry to its turn by start time; a run's `outcome` is stored as received (`null` when `RUN_FINISHED` carries none, which still means success); `RunSession.finish({ failed })` logs `stream_broken` or `stream_ended` while storing and sending `upstream_error`; once `finish()` starts the session accepts no sink writes; the run is registered in `activeRuns` before `startRun` commits it; a refused connection is rethrown as a plain `Error('agent unreachable')` so `@ag-ui/client` logs no host; `conversation_messages_run_id_idx` was added for the `run_id` key; a message's text must be non-blank and at most 32,000 characters. The plain error covers a refused connection only: a dropped stream or a malformed frame is logged by `@ag-ui/client` itself (`console.error('Agent execution failed:', …)`) with the socket's address or the frame's text. Wrapping the response body would be a custom mechanism around the library's own logging (ADR-0002), so this is a known limit, tracked as a follow-up issue.
