# C. Mapping AG-UI runs onto Ant Design X (research, 2026-10-14)

Research for Part 2 of the AI App Hub (`fork/overhaul`). It covers how `useXChat` and `AbstractChatProvider` (x-sdk 2.9.0) can carry AG-UI runs, X's unreleased `AgentProvider`, how three other AG-UI React clients map runs to UI messages, which X 2.9 and antd 6.6.5 components fit each chat element, and which existing chat files can be shared.

Facts come first, each with a source. "Docs silent" marks a gap. **(opinion)** marks my own view.

**What was read**

| Source | Version / commit | Date |
| --- | --- | --- |
| `node_modules/@ant-design/x-sdk` (es + .d.ts), `@ant-design/x` | 2.9.0 (installed) | npm 2026-07-28 |
| X skills `use-x-chat`, `x-chat-provider`, `x-request`, `x-components`, `x-markdown`, `x-card` (`~/.agents/skills/*`) | 2.9.0 | — |
| X doc sources behind x.ant.design (`packages/x/docs/...`), via `gh api` | tag `2.9.0` | — |
| ant-design/x branch `feature` (shallow, sparse clone) | `d7cdf365ee` | 2026-08-31 |
| ant-design/x branch `codex/feature-tool-call` (`ToolCall`, PR #2013) | `ddce9e8a4a` | 2026-08-06 |
| ant-design/x RFCs on `codex/feature-roadmap-phase-2` (`agent-timeline`, `tool-call`, `approval`) | `b0eadc96bc` | 2026-08-03 |
| assistant-ui `packages/react-ag-ui` and its docs | `main` @ `6e17b3a895` (npm 0.0.69) | 2026-10-14 |
| CopilotKit `packages/react-core/src/v2` | `main` @ `7643cd4ed1` (npm 1.79.0) | 2026-10-14 |
| TanStack AI `packages/ai`, `packages/ai-client` | `main` @ `1d0f8f11f4` (npm `@tanstack/ai` 0.69.0) | 2026-10-13 |
| AG-UI spec pages (`https://docs.ag-ui.com/<page>.md`) | 1.0 | fetched 2026-10-14 |
| antd component APIs: `npx -y @ant-design/cli info <C> --version 6.6.5` (CLI 6.6.6; the `antd` binary is not on PATH) | 6.6.5 | — |

Clones are in `scratchpad/refs/`. Nothing was run from them.

Paths below are relative to the hub repo unless they start with a clone name: `x-feature/`, `aui/`, `ck/`, `tsai/`. In x-sdk, `es/…` means `node_modules/@ant-design/x-sdk/es/…`.

---

## 1. The x-sdk 2.9.0 contract

### 1.1 What a provider is allowed to do

- **Construction.** `AbstractChatProvider` takes `{ request }`: an `XRequest` instance or a factory. It throws `'request must be manual'` unless the request has `manual: true` (`es/chat-providers/AbstractChatProvider.js:11`).
- **Three abstract methods** (`es/chat-providers/AbstractChatProvider.d.ts:24-34`):
  - `transformParams(requestParams: Partial<Input>, options: XRequestOptions): Input`. Its result is the request body (`es/x-chat/index.js:271`; XRequest JSON-stringifies `{...params, ...extraParams}` in `es/x-request/index.js:103-117`).
  - `transformLocalMessage(requestParams): ChatMessage | ChatMessage[]`. This builds the user-side message or messages.
  - `transformMessage(info: TransformMessage): ChatMessage`. It returns **one** `ChatMessage`.
- **Read-only access to history.** `getMessages()` returns the store's messages, minus those whose status is `loading`, as plain `ChatMessage[]` (`es/x-chat/index.js:93-96`; `AbstractChatProvider.js:36`).
- **No write access.** The provider has no `setMessages` handle (the `.d.ts` exposes only `getMessages`, `injectGetMessages` and `injectRequest`).
- **Callbacks.** `injectRequest` **overwrites** `request.options.callbacks` on every request. It wraps the app's own `onUpdate`, `onSuccess` and `onError` and passes the hook's `MessageInfo` to them as an extra argument (`AbstractChatProvider.js:39-61`). One provider therefore serves one in-flight request at a time.
- **Skill rules** (`x-chat-provider/SKILL.md:369-405`): implement only the three methods, never a `request` method, and never return a `status` field from `transformMessage`, because the framework manages status.
- **Release status.** x.ant.design 2.9 documents only `DefaultChatProvider`, `OpenAIChatProvider`, `DeepSeekChatProvider` and the custom route. The chat-provider page describes the custom route as the way "to convert data from different model providers or Agentic services into a unified format that `useXChat` can consume" (`packages/x/docs/x-sdk/chat-provider.en-US.md` at tag 2.9.0 → https://x.ant.design/x-sdks/chat-provider).

### 1.2 `TransformMessage`: what `transformMessage` receives

`TransformMessage` is `{ originMessage?, chunk, chunks, status, responseHeaders }` (`AbstractChatProvider.d.ts:6-12`). What it holds depends on the call:

| Call | `chunk` | `chunks` | `originMessage` | `status` | Source |
| --- | --- | --- | --- | --- | --- |
| First chunk of a new request | the SSE object `{data, event?, id?}` | `[]` | **absent**. The `requestPlaceholder` is _not_ passed; the result replaces the placeholder as a new message | `updating` | `es/x-chat/index.js:180-193` |
| Later chunks | the chunk | `[]` (not accumulated) | the current `message` of the message being updated | `updating` | `index.js:195-215` |
| First chunk after `onReload(id, …)` | the chunk | `[]` | **absent**, although the message being reloaded exists. The result is assigned onto that message in place | `updating` | `index.js:164-179` |
| Stream end (`onSuccess`) | `undefined` | every chunk received | the current message, or absent when no chunk arrived (a message is then created from `transformMessage` alone) | `success` | `index.js:225-230`, `162-219` |

- **Stream end with no chunk.** A provider has to return a sensible message from `{ chunk: undefined, chunks: [] }` without an origin. The hub's `DifyChatProvider` falls back to `emptyAssistant()` (`components/chat/provider/dify-chat-provider.ts:466-469`).
- **Reload with no origin.** The hub keeps the paused message itself (`resumeBase`), because "The SDK passes no originMessage on a reload's first chunk" (`dify-chat-provider.ts:410-412`).

### 1.3 One request updates exactly one message

- `innerOnRequest` keeps a single `updatingMsgId`, or `updatingId` for a reload, and every callback goes through `updateMessage`, which finds and replaces that one message (`es/x-chat/index.js:160-219`). Nothing in the hook can add a second assistant message during a request.
- **Placeholder.** `requestPlaceholder` adds one `loading` message. The first chunk replaces it, and that message is removed by id (`index.js:137-158`, `189-192`).
- **Failure and abort.** `onError` calls `requestFallback(params, { error, errorInfo, messageInfo, messages })`, where `messageInfo` is the loading or updating message.
  - **With `requestFallback`:** the hook **removes** that message and **appends a new one** (new id `msg_N`) with status `abort` when `error.name === 'AbortError'` and `error` otherwise (`index.js:231-250`).
  - **Without it:** the message keeps its id and content and only changes status (`index.js:251-265`).
  - The hub already noted that a stopped or failed reply "moves to the end with a new id" (ADR-0017 note of 2026-10-08).
- **So there is one message per request (fact).** `transformLocalMessage` may return several _local_ messages (an array; `index.js:109-110`), but the reply side is always one `ChatMessage`.

### 1.4 Can a provider legitimately produce several messages from one request?

- **From the provider: no.** It cannot write to the store (§1.1). The only documented one-to-many path is the hook's `parser`.
- **From callbacks: undocumented.** XRequest callbacks receive the hook's `MessageInfo` (`x-request/reference/API.md:36-42`). App code could call the hook's `setMessages` from them to insert extra messages, but the docs say nothing about doing so mid-stream. Side effects visible in the source:
  - `updateMessage` looks its one message up by id on every chunk, so inserted messages survive.
  - A `requestFallback` re-appends the failed message _after_ any inserted ones (`index.js:250`).
  - Statuses of inserted messages are never managed.
  - `abort()` and `onReload` act on one id only.

  **(opinion)** Treat this as not supported.

- **`parser` (documented one-to-many).**
  - `XChatConfig.parser?: (message: ChatMessage) => BubbleMessage | BubbleMessage[]` (`es/x-chat/index.d.ts:35-36`). The docs say: "Supports converting one ChatMessage into multiple ParsedMessages" (`use-x-chat/reference/API.md:30`).
  - In `parsedMessages`, each part gets the id `${id}_${index}` and the parent's `status`. `extraInfo` is not copied (`es/x-chat/index.js:72-90`).
  - The documented example splits DeepSeek reasoning and the answer into two bubbles (`use-x-chat/reference/CORE.md:217-247`, `EXAMPLES.md:331-402`).
- **X's own documented answer to a multi-part turn is one `ChatMessage` with fields**, rendered through `contentRender`:
  - **Tbox playground** (`packages/x/docs/playground/agent-tbox.tsx` at 2.9.0, https://x.ant.design/docs/playground/agent-tbox). `TboxProvider.transformMessage` accumulates `{text, ext_text}` (answer and reasoning) into one message (lines ~468-487). The assistant role renders a `ThoughtChain.Item` status header plus `XMarkdown` with a `<think>` block (lines ~745-775). The custom-provider page points to it as the example (`chat-provider-custom.en-US.md`, 2.9.0).
  - **Custom provider with attachments.** "Multi-field Response (with Attachments)" keeps content and attachments in one message (`x-chat-provider/reference/EXAMPLES.md:232-293`; `chat-provider-custom.en-US.md`).
  - **Tool chain pattern.** `x-components/reference/PATTERNS.md:212-222` maps `agentSteps` (`toolName`, `input`, `status`, `result`) to `ThoughtChain` items inside one bubble.
  - **Docs silent.** No released X doc or demo maps an agent run made of several protocol messages (text, tool calls, tool results, more text) onto `useXChat`. The released x-sdk demos are `openai`, `deepSeek`, `defaultMessages`, `async-defaultMessages`, `developer`, `openai-callback`, `custom-request-fetch` and `request-openai-node` (`packages/x/docs/x-sdk/demos/x-chat` at 2.9.0).

### 1.5 The rest of the hook

- **Message status** (`es/x-chat/index.d.ts:6-14`; meanings in `use-x-chat/SKILL.md:170-176`):
  - `local`: a user message, and the default for `defaultMessages` items without a status (`index.js:52-56`);
  - `loading`: the placeholder, set by `requestPlaceholder`;
  - `updating`: set per chunk;
  - `success`: set at stream end;
  - `error` / `abort`: set in `onError` (`AbortError` gives `abort`).

  An AG-UI `RUN_ERROR` arrives _inside_ a 200 stream, so x-sdk ends that request as `success`. Only transport failures (non-OK, network, timeouts) and aborts reach `onError` (`es/x-request/index.js:156-183`; `es/x-request/x-fetch.js:33-35`).

- **`extraInfo`.** `onRequest`, `onReload` and `queueRequest` take `{ extraInfo }`. It is stored on the _local_ messages (`index.js:58-69`, `110`), and on reload it is set on the reloaded message (`index.js:129-131`). The reply message created by the first chunk carries none (`createMessage(transformData, status)` at `index.js:188`).
- **`onRequest(params, opts)`:**
  1. adds the local messages and the placeholder;
  2. injects callbacks;
  3. sets `isRequesting`;
  4. runs `request.run(transformParams(...))` (`index.js:100-272`).
- **`onReload(id, params, opts)`:**
  - It throws when `id` is not in the store (`index.js:279-291`).
  - It calls `transformLocalMessage` but **discards** the result; no local bubble is added (`index.js:109-136`).
  - With a `requestPlaceholder` it sets that message to `loading` and _replaces its content_ with the placeholder (`index.js:113-134`). The hub's Dify chat returns the paused message itself as the placeholder (`components/chat/hooks/use-dify-chat.ts:358`).
  - The skill says "usually pass `{}` (original context will be reused)" (`use-x-chat/reference/CORE.md:118`). The source reuses nothing by itself: the provider rebuilds the request from `params` and `getMessages()`, as Tbox's `retry` does.
- **`abort()`** calls `provider.request.abort()`, and `XRequestClass.abort()` calls `this.abortController.abort()` (`es/x-request/index.js:81-85`). That controller exists only after a first `run()`, and the hub guards for it (`use-dify-chat.ts:415-419`).
- **`isRequesting`** is kept per `conversationKey` in a module-level `Map` (`index.js:16`, `227`, `233`, `270`, `339`). It is false once a stream ends, including a run that ended in an AG-UI interrupt.
- **`defaultMessages`** may be async and receives `{ conversationKey }` (`index.js:48-57`).
  - The store is module-global per key (`es/x-chat/store.js:2-17`, `63`, `175-186`), so the loader runs once per key per page session.
  - A failed loader logs a warning and yields `[]` (`store.js:75-80`).
  - `isDefaultMessagesRequesting` reports the load.
- **`queueRequest(key, params)`** holds sends until that key's defaults have loaded. It flushes in a `setTimeout`, and only for the key the hook currently shows (`index.js:294-324`).
- **`setMessages` / `setMessage` / `removeMessage`** write the store directly. `setMessage` merges in place with `Object.assign` and then copies the array (`store.js:123-132`).
  - A function given to `setMessages` is called **once, synchronously** (`store.js:91-105`). It is not a React updater, so it does not run twice under StrictMode. `transformMessage` runs inside such a function (`index.js:197-215`). **Docs silent** on side effects in `transformMessage`; the Dify provider makes "best effort" callbacks there (`dify-chat-provider.ts:484-507`).
  - Emits are throttled to 50 ms, leading and trailing (`store.js:28`, `36-52`).

### 1.6 XRequest and XStream with AG-UI SSE

AG-UI's HTTP binding: `POST`, `Accept: text/event-stream`; a `200 text/event-stream` answer; one JSON event per SSE `data:`; LF line endings; consumers ignore `event:`, `id:` and `retry:` and tolerate `: keep-alive` comments (https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse; summarised in `agui-and-reference-hubs.md` §1).

| AG-UI wire rule | XRequest / XStream 2.9.0 behaviour | Verdict |
| --- | --- | --- |
| `Content-Type: text/event-stream` | `XRequest` picks the SSE handler from the response MIME type; any other type except JSON throws "content-type … is not support" (`es/x-request/index.js:142-155`) | OK |
| Events separated by a blank line, LF | `splitStream` splits on `\n\n`, lines on `\n`, keys on the first `:` (`es/x-stream/index.js:4-14`, `33-60`, `86-117`) | OK for LF. CRLF streams would not split (the hub's route controls this) |
| One JSON per `data:` line | each event becomes `{ data: '<json string>' }` with the value `.trim()`med. The provider must `JSON.parse(chunk.data)`, as `parseEvent` does for Dify (`dify-chat-provider.ts:269-279`) | OK |
| Multi-line `data:` (generic SSE) | lines are reduced into an object, so a second `data:` line **overwrites** the first (`x-stream/index.js:91-110`) | Fine for AG-UI (single-line JSON), not general SSE |
| `: keep-alive` comments | an empty key is skipped and an empty event dropped (`x-stream/index.js:102`, `111`) | OK |
| `event:` / `id:` / `retry:` | kept as fields. `id` is remembered and sent as `Last-Event-ID` only on XRequest's own retries (`x-request/index.js:172-179`, `232-235`). AG-UI defines no resumption | Do not set `retryInterval` **(opinion)** |
| Errors before the stream (4xx/5xx) | `xFetch` throws `Fetch failed with status N`, and the body is lost (`x-fetch.js:33-35`) | Use the documented `fetch` option to read the hub's error envelope, as `createDifyFetch` does (`components/chat/provider/dify-fetch.ts`) |
| Alternative parsing | `transformStream` (fixed or per-response factory) replaces the SSE parsing (`x-request/reference/API.md:17-30`, FAQ: return a _new_ TransformStream per request) | Optional. It could emit parsed AG-UI events instead of `{data}` |

**Conclusion (fact plus small opinion).** XRequest can read an AG-UI SSE stream as it is. Each `chunk.data` is one AG-UI event as JSON. No `@ag-ui/client` is needed in the browser for transport. Whether the browser should run `@ag-ui/client`'s 0.x→1.0 compatibility layer, or the hub's server normalises, is a separate question (`agui-and-reference-hubs.md`, implication 6).

---

## 2. X's unreleased `AgentProvider` (`feature` branch)

### 2.1 Status on 2026-10-14

**Nothing has changed since 2026-10-11:**

- **`feature`.** The head is still `d7cdf365ee` (2026-08-31, "Merge pull request #2019 … agent-interaction"), and there are no commits since 2026-09-01 (`gh api repos/ant-design/x/commits?sha=feature&since=…`).
- **`main`.** The only commit since 2026-10-01 is `fc3a0cc7f3` (2026-10-12, a Folder style fix).
- **npm.** `@ant-design/x-sdk` and `@ant-design/x` are `latest` 2.9.0 (2026-07-28); there is no 2.10 (`npm view … dist-tags/time`). GitHub Releases still lists 2.7.0 as the newest release object, while tags go up to `2.9.0`.

**Two 2.10.0 release branches, only one with AgentProvider:**

- `codex/release-2.10.0` (PR #2040, **closed** 2026-08-31) has a changelog dated 2026-08-31 that lists, under x-sdk: "Add a model-independent Agent runtime with validated protocol events … and an `AgentProvider` adapter (#2006)" and "typed Agent interaction commands … integrate … with `useXChat` (#2011)".
- `codex/release-2.10.0-main` (PR #2041, **open**, "blocked", last activity 2026-08-31) has **no x-sdk section** and no `packages/x-sdk/src/agent` directory. Its 2.10.0 is Mermaid, x-markdown fixes and `componentsProps` only (`gh api …/contents/CHANGELOG.en-US.md?ref=…`).

So the 2.10 that targets `main` does **not** carry AgentProvider today.

**Component PRs:**

- `ToolCall` (PR #2013, `codex/feature-tool-call`) is **open**, last updated 2026-08-06.
- `Task` (PR #2015) is **open**, last updated 2026-08-31.

**AG-UI requests:** issue #1722 (AG-UI support, maintainer: "计划中了", planned) has been silent since 2026-08-18, and issue #1102's last comment is a "+1" on 2026-09-05. No PR mentions AG-UI.

**Labelling.** The doc page carries `tag: 2.9.0` although 2.9.0 does not contain it. It calls the API "experimental … until at least two structurally different reference Providers and an official Agent UI have validated it" (`x-feature/packages/x/docs/x-sdk/agent-provider.en-US.md:11`, `:220`).

### 2.2 Contract (`agent-provider.en-US.md:50-86`)

```ts
interface AgentProvider<Input, Request, Chunk, Context> {
	id
	protocol: { name: 'agent-event'; version: '0.1' }
	capabilities
	transport
	createContext(opts): Context
	start(input, ctx): AgentEvent[] // run.started, user message, initial entities
	prepareRequest(input, ctx): Request
	transformChunk(chunk, ctx): AgentEvent[] // one chunk → zero or more events
	flush(ctx): AgentEvent[] // close entities, terminal run event
	transformError(err, ctx): AgentEvent[]
	executeCommand?(cmd, opts): AsyncIterable<AgentEvent>
}
```

- The entry point stays `useXChat({ provider })`. There is no second hook (`:25`). `useXChat` detects the agent protocol with `isAgentProvider` (`x-feature/packages/x-sdk/src/x-chat/index.ts:182-186`).
- `requestPlaceholder` and `requestFallback` "belong to the legacy ChatProvider path" (`:165`).
- `onReload` "starts a new Run instead of rewriting an old Run" (`:171`).
- A transport is `{ kind, open(request, signal): AsyncIterable<Chunk> }`, with kinds `sse`, `websocket`, `async-iterable` or a namespaced custom kind (`:119-130`).

### 2.3 Event set (`x-feature/packages/x-sdk/src/agent/protocol/events.ts`)

- **Envelope:** `{ protocolVersion '0.1', type, eventId, sessionId, runId, sequence, timestamp, parentId?, payload, meta? }` (`events.ts:211-226`).
- **Families** (`events.ts:26-170`; lifecycle table at `agent-provider.en-US.md:136-143`):
  - `session.started`;
  - `run.started` / `completed` / `failed` / `cancelled`;
  - `message.started` (messageId, role, content?) / `delta` / `completed` / `failed` / `cancelled`;
  - `reasoning.started` / `delta` / `completed` (content, summary) / `failed` / `cancelled`;
  - `tool.requested` (toolCallId, name, arguments?, index, attempt, retryOf) / `arguments_delta` / `running` / `completed` (result) / `failed` / `cancelled`;
  - `approval.requested` (approvalId, toolCallId?, description, risk, data, editable, expiresAt, version) / `approval.resolved` (decision `approved|rejected|modified|expired`);
  - `task.*`;
  - `artifact.*`.
- **Content parts:** `text`, `image`, `file` or namespaced `x.y` data (`events.ts:19-24`).
- **No counterparts for:** AG-UI state (`STATE_*`), activity, `CUSTOM` and interrupts.

### 2.4 `agentState` (`x-feature/packages/x-sdk/src/agent/reducer/state.ts:154-167`)

- `sessions`, `runs` (status `running|completed|failed|cancelled`, input, output, usage, error) and `messages` (`AgentMessageState`: id, runId, parentId, role, content, status).
- `reasoning`, `toolCalls` (name, `arguments` string, result, status, attempt, retryOf), `approvals` (toolCallId, description, risk, data, editable, decision, status), `tasks` and `artifacts`.
- `order` (an `AgentEntityReference[]` of `{kind, id, runId}` in first-seen order), `issues`, `processedEventIds` and `lastSequenceByRun`.
- Entities are keyed by `runId + entityId` (`state.ts:169-171`).

### 2.5 How it maps several messages per run

- **Projection.** `projectAgentMessages` turns **every** `message` entity, in `order`, into its own `MessageInfo` with `id = runId+messageId`. Reasoning, tools, approvals, tasks and artifacts are **not** messages; they stay in `agentState` (`x-feature/packages/x-sdk/src/x-chat/agentRuntime.ts:79-99`).
- **Status mapping** (`agentRuntime.ts:79-85`): `failed`→`error`, `cancelled`→`abort`, user→`local`, `completed`→`success`, otherwise `updating`.
- **Timeline.** `selectAgentTimeline(state, { runId })` returns the run's ordered entries of kinds `message | reasoning | tool | approval` (`x-feature/packages/x-sdk/src/agent/selectors/selectAgentTimeline.ts:10-70`).
- **AgentTimeline RFC** (status "proposal"). It wants "one entity → one stable item", with tool call arguments, status and result merged into one item, an approval nested under its `toolCallId`, and `AgentState.order` as the only ordering (`x-rfcs/agent-timeline.zh-CN.md` §3, §6).
- **How the demo renders it** (`x-feature/packages/x/docs/x-sdk/demos/x-chat/agent-provider.tsx:408-500`). It renders **one Bubble per assistant message**. Inside it, it collects that message's run entities by `runId` (`getRunEntities(agentState.reasoning, message.runId)` and so on) into a `ThoughtChain` above the answer text. In effect it renders per run.

### 2.6 Approvals and commands, compared with AG-UI interrupts

- **X's model: the run keeps running.**
  - `approval.requested` creates an approval with status `waiting`, inside a run that stays `running` (`x-feature/packages/x-sdk/src/agent/reducer/reduceAgentState.ts:428-457`).
  - `agentActions.resolveApproval({ runId, approvalId, decision, data?, expectedVersion? })` asserts the run is **still running** (`assertRunningRun`), the provider declares `approval.resolve`, and the approval is `waiting`, not expired and at the expected version. It then calls `executeCommand`, and the returned events go into the **same run** with strictly increasing `sequence` (`agentRuntime.ts:101-116`, `350-381`).
  - The commands are `approval.resolve`, `tool.retry` and `run.cancel`, each with `commandId` and `idempotencyKey` (`x-feature/packages/x-sdk/src/agent/command/commands.ts:10-46`).
  - `isRequesting` is "any run `running`" (`agentRuntime.ts:433`), so the composer looks busy while an approval waits.
- **AG-UI's model: the run closes.** "An interrupted run is a closed run … continuing means a new run". The next run carries `resume[]`, which "MUST cover every interrupt" (https://docs.ag-ui.com/spec/1.0/basic/patterns/interrupt-resume).
- **Fitting AG-UI into X.** An AG-UI adapter on AgentProvider would have to keep X's run open across two AG-UI runs: hold back `run.completed` on an interrupt outcome, and turn `executeCommand('approval.resolve')` into the resume POST. **Docs silent** on whether a provider may end its transport without a terminal event. The doc requires "exactly one `run.started` and one terminal event" per run (`agent-provider.en-US.md:134`).
- **No counterparts** for AG-UI `input_required` / `confirmation` interrupts, frontend tools or `STATE_*`.

### 2.7 Proposed X components (unreleased)

- **`ToolCall`** (PR #2013, open; docs `codex/feature-tool-call:packages/x/components/tool-call/index.en-US.md`).
  - `item: { id, name, icon?, description?, argumentsText?, arguments?, result?, status: 'pending'|'streaming'|'running'|'completed'|'failed'|'cancelled', error?, attempt?, startedAt?, completedAt? }`.
  - Behaviour props: `approval: { status|defaultStatus 'pending'|'approved'|'rejected', title, description, risk, approveText, rejectText, loading, onApprove, onReject, onStatusChange }`, `approvalRender`, `duration`, `onCancel`/`cancelling`, `onRetry`/`retrying`, `argumentsRender`, `resultRender`, `errorRender`, `actions`, `statusIcons`, `expanded`/`defaultExpanded`.
  - "Complete JSON in `argumentsText` is formatted while incomplete streaming JSON is preserved."
- **`Approval`** (RFC only, "proposal", 2026-08-03): `item: { status 'waiting'|'approved'|'rejected'|'modified'|'expired'|'cancelled', risk, data, editable, … }`, `onResolve({ decision, data, version })`, `editorRender`, `dataRender` (`x-rfcs/approval.zh-CN.md` §6).
- **`AgentTimeline`** (RFC only) and **`Task`** (PR #2015, open).
- **Rejected alternative.** The ToolCall RFC rejects "extending ThoughtChain.Item" as the tool-call UI, because ThoughtChain "lacks tool parameters, results, errors and retry semantics" (`x-rfcs/tool-call.zh-CN.md` §13.1).

---

## 3. How other AG-UI React clients map runs to UI messages

### 3.1 assistant-ui `@assistant-ui/react-ag-ui` 0.0.69 (it still depends on `@ag-ui/client ^0.0.59`, npm)

- **One run becomes one assistant message with ordered parts.** "The aggregator keeps a single assistant message worth of parts. Each incoming event updates the parts and emits a fresh snapshot" (`aui/packages/react-ag-ui/src/runtime/adapter/run-aggregator.ts:185-194`).
- **Part kinds and order.** The kinds are `text`, `reasoning`, `tool-call` and `data`, kept in `partOrder` (`:56-60`, `:248`).
- **Text segments.** A new `TEXT_MESSAGE_START` after a tool call opens a new text part.
- **Tool results merge into tool calls.** `TOOL_CALL_RESULT` → `finishToolCall(toolCallId, content, …)` puts the result on the existing tool-call part (`:488-503`; docs: "Attaches a tool result to a tool call", `aui/apps/docs/content/docs/runtimes/ag-ui/runtime-options.mdx:277-304`).
- **Run end** (`run-aggregator.ts:286-326`):
  - `RUN_FINISHED` with an interrupt outcome gives the message status `requires-action` / `interrupt`, with the interrupts stored on `metadata.custom.agui.interrupts`;
  - a success with unresolved tool calls gives `requires-action` / `tool-calls`;
  - `RUN_ERROR` gives `incomplete` / `error`.
- **`CUSTOM` and activity.** A `CUSTOM` event becomes a `data` part `{ name, data }`, rendered through `useAssistantDataUI({ name, render })`. Unregistered names are not displayed (`runtime-options.mdx:306-321`). `ACTIVITY_SNAPSHOT` becomes an `agui-activity/<type>` data part (`:38-44`).
- **Tool approvals sit on the tool part.** Interrupts with `reason: "tool_call"` and a `toolCallId` are projected onto that tool part as `approval: { id, prompt }`. `input_required` and `confirmation` "stay on the bespoke interrupt hooks". A batch mixing the two kinds projects nothing, "because AG-UI resumes with one response per open interrupt" (`aui/…/adapter/tool-approval.ts:186-232`).
- **Interrupt API** (experimental, `runtime-options.mdx:182-255`):
  - `useAgUiInterrupts` and `useAgUiSubmitInterruptResponses`, where responses "must address every open interrupt";
  - `useAgUiSteerAway`: on a new user message, every open interrupt defaults to `status: "cancelled"`;
  - "Pending interrupts are never auto-cancelled: sending while an interrupt is open still throws".
- **Tool UI registry.** `makeAssistantToolUI({ toolName, render, display?: 'inline'|'standalone' })` and `useAssistantToolUI` register renderers by tool name, but both are now **deprecated** in favour of toolkit `render` (https://www.assistant-ui.com/docs/api-reference/tools/rendering.md). Helpers: `useToolArgsStatus` and `useToolCallElapsed` (https://www.assistant-ui.com/docs/api-reference/tools/status.md).
- **History.** `fromAgUiMessages` folds stored AG-UI messages back into turns:
  - a `reasoning` record is folded onto the assistant record that follows it;
  - parentless tool-call "containers" are joined to the turn.

  The docs call this lossy: "nothing on the wire carries run identity". "An AG-UI assistant record carries `content` and `toolCalls` as separate fields with no ordering between them, so its text is restored ahead of its tool calls" (`runtime-options.mdx:84-106`). Interrupts restore only if the backend persisted `metadata.custom.agui.interrupts` (`:128`).

### 3.2 CopilotKit v2 `@copilotkit/react-core` 1.79.0 (`@ag-ui/client` 1.0.2)

- **One row per AG-UI message.** `CopilotChatMessageView` renders a row per message by role: `assistant`, `user`, `activity` and `reasoning`. `tool` messages get no row (`ck/packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx:1020-1061`).
- **Tool results are looked up, not merged.** For each `toolCall` of an assistant message, `CopilotChatToolCallsView` finds `messages.find(m => m.role === 'tool' && m.toolCallId === toolCall.id)` and passes `{ toolCall, toolMessage }` to the renderer (`…/CopilotChatToolCallsView.tsx:32-57`).
- **Status comes from that lookup.** `complete` when a tool message exists, `executing`, or `inProgress` (`…/hooks/use-render-tool-call.tsx:52-83`).
- **Duplicates.** CopilotKit also has to remove duplicated assistant messages and tool calls that the HITL resync produces (`CopilotChatMessageView.tsx:337-400`).
- **Tool renderer registry.** `useRenderTool({ name, parameters?, render })`, where `render` gets `{ name, toolCallId, parameters, status: 'inProgress'|'executing'|'complete', result }`, plus a wildcard `"*"` fallback (`…/hooks/use-render-tool.tsx:9-36`, `69-105`).
- **`useInterrupt({ render, handler?, enabled?, renderInChat? })`.** It "Supports both the AG-UI standard interrupt flow (`RUN_FINISHED` with `outcome.type === "interrupt"`) and the legacy custom-event flow". `resolve(payload)` and `cancel()` address one interrupt, and "once every open interrupt is addressed, [it] submits a single spec `resume` array via `copilotkit.runAgent`". With `renderInChat` (the default) the element is published into the chat (`…/hooks/use-interrupt.tsx:139-161`, `248-351`, `467-480`).
- **`useHumanInTheLoop`** is a frontend tool whose handler awaits a `respond(result)` from the tool's own rendered UI. `respond` is live only while the status is `executing` (`…/hooks/use-human-in-the-loop.tsx:13-60` and the render branches after them). This is the AG-UI "frontend tools" path, not interrupts.

### 3.3 TanStack AI (`@tanstack/ai` 0.69.0, `@tanstack/ai-client` 0.39.3; streams are AG-UI events from `@ag-ui/core`)

- **`UIMessage`.** `UIMessage = { id, role: 'system'|'user'|'assistant'|'activity', parts: MessagePart[] }`. There is no `tool` or `reasoning` role (`tsai/packages/ai/src/types.ts:785-797`).
- **Parts** (`types.ts:488-545`, `674-686`):
  - `TextPart`;
  - `ToolCallPart { id, name, arguments (string, may be incomplete), input?, state, approval?: { id, needsApproval, approved? }, output? }`;
  - `ToolResultPart { toolCallId, content, state, outcome?, error? }`;
  - `ThinkingPart`;
  - plus `ActivityPart`, `StructuredOutputPart`, `UIResourcePart` and `SubagentPart`.
- **One flat stream becomes one assistant `UIMessage`.** The processor "receives a single flat stream of AG-UI events from all iterations … Each `TEXT_MESSAGE_START` resets its text segment accumulator". A text → tool → result → text run ends with "**two separate TextParts** in the final message. This preserves the interleaving" (`tsai/packages/ai/docs/chat-architecture.md:262-309`, `399-421`).
- **Approvals land on the tool-call part.** `RUN_FINISHED` with an interrupt outcome → `handleInterrupts`. An interrupt marked as an approval (`metadata.kind === 'approval'` or `reason === 'approval_required'`, TanStack's own convention rather than AG-UI's `tool_call`) sets the tool-call part's `state` to `approval-requested` and fires `onApprovalRequest`. Client-tool interrupts fire `onToolCall` (`tsai/packages/ai/src/activities/chat/stream/processor.ts:2681-2690`, `2759-2850`). The client answers with `addToolApprovalResponse(approvalId, bool)` (`chat-architecture.md:385-397`).

### 3.4 For comparison: vstorm template (not AG-UI)

From `agui-reference-projects.md` §1(a). A `ChatMessage` holds an ordered `parts` timeline (`thinking | text | tool | research`), and the tool part carries `{ args, result?, status }`. Approvals and questions are separate state shown above the composer. Its stored history loses the order of a multi-step turn on reload, because the database keeps flat fields.

### 3.5 The common pattern

| Concern | assistant-ui | CopilotKit | TanStack AI | X AgentProvider (unreleased) |
| --- | --- | --- | --- | --- |
| UI unit for a run's output | one assistant message per run, ordered parts | one row per AG-UI message (assistant / reasoning / activity) | one assistant `UIMessage`, ordered parts | one `MessageInfo` per message entity; the demo renders run entities inside the assistant bubble |
| Tool result | merged into the tool-call part | looked up by `toolCallId` at render | `ToolResultPart` next to the `ToolCallPart`, output copied onto it | merged into the tool entity (`tool.completed.result`) |
| Reasoning | a part of the same message | its own row | a part | its own entity, by run |
| `CUSTOM` | `data` part plus a renderer by name | `useRenderCustomMessages` | `CUSTOM` handled by name (approval / client-tool events) | none |
| Tool approval | `approval` on the tool part (AG-UI `tool_call` interrupts) | `useInterrupt` render in chat | `approval` on the tool part | `approvals` entity linked by `toolCallId` |
| Resume | one `resume[]` covering every interrupt; steer-away cancels | one `resume[]` once all are addressed | resume items via the interrupt manager | `executeCommand` inside the same run |
| Renderer registry | by tool name (deprecated `makeAssistantToolUI` → toolkits) | `useRenderTool` by name plus a `"*"` fallback | per-tool client definitions | none yet (ToolCall/Approval as controlled components) |

**Pattern (fact, from the rows above):**

- Tool results are always shown on their tool call.
- Three of the four (assistant-ui, TanStack, X's demo) group what a run produced into one visual assistant turn with arrival-ordered parts.
- Approvals bind to the tool call they gate.
- Renderers are found by tool name, with a generic fallback.

---

## 4. Which X 2.9 / antd 6.6.5 components fit each element

Props are copied from `x-components/reference/API.md` (X 2.9.0) and `npx @ant-design/cli info <C> --version 6.6.5`. Docs: `https://x.ant.design/components/<name>` and `https://ant.design/components/<name>`. This section lists candidates only. (The owner-picks-every-component rule was dropped on 2026-10-12, running record decision 38; the Part 2 spec records the components chosen.)

| Element | Dify chat today (file) | Candidates (documented props) |
| --- | --- | --- |
| **Assistant text** | X `Bubble.List` role `assistant` (`placement:'start'`, `variant:'borderless'`, `contentRender`, `footer`) → `MessageMarkdown` = `XMarkdown` + Latex, module-constant `components`, `streaming {hasNextChunk, enableAnimation}`, `paragraphTag="div"`, `openLinksInNewTab`, `dompurifyConfig` (`chat-view/message-list.tsx:48-64`, `message/message-markdown.tsx`) | 1. Same: Bubble (`variant` filled/outlined/shadow/borderless, `shape`, `streaming`, `typing`, `header`/`footer`/`extra` slots, `footerPlacement`) + XMarkdown. 2. One bubble per text part through `useXChat` `parser` (§1.4). 3. Bubble `typing` (`BubbleAnimationOption`) for plain text without Markdown |
| **Reasoning** | X `Think` (`title`, `loading`, `blink`, `expanded`/`onExpand`, `role="group"`) with a timer (`message/reasoning.tsx`); `<think>` in Markdown → `Think` (`message/markdown/think-block.tsx`) | 1. `Think` (`title`, `icon`, `loading`, `defaultExpanded`/`expanded`/`onExpand`, `blink`, `destroyOnHidden` since 2.9.0 per the changelog). 2. A `ThoughtChain` item (`title`, `description`, `content`, `status` loading/success/error/abort, `collapsible`, `blink`); the skill says to use Think for "a collapsible single-block reasoning display" (`x-components/SKILL.md:100`). 3. A separate Bubble with role `reasoning` through `parser` (X DeepSeek example) |
| **Tool call card (args + result)** | Dify agent thoughts → X `ThoughtChain` items: `title` "tool name", `status` from `thought-status.ts`, `collapsible`, `content` = `<pre>` input and observation (`message/agent-thoughts.tsx`); workflow nodes → antd `Collapse` + `Descriptions` + `Tag` (`message/workflow-logs.tsx`) | 1. `ThoughtChain` (`items`, `expandedKeys`/`onExpand`, `line`) with X `CodeHighlighter` (`lang="json"`, `header`, `highlightProps`) for args and result. 2. antd `Card` (`title`, `extra`, `actions`, `size` medium/small, `variant` outlined/borderless, `loading`) per call. 3. antd `Collapse` (`items` with `label`/`extra`/`children`, `ghost`, `size`, `accordion`) + `Descriptions`. Not released: X `ToolCall` (§2.7). |
| **Approval (Approve / Reject)** | none for tools. Dify human input: antd `Form` with action `Button`s in the bubble's `extra` slot (`message/human-input-form.tsx`, `chat-view.tsx:327-361`) | 1. antd `Card` with `actions={[Approve, Reject]}` or `extra`, args in CodeHighlighter. 2. antd `Alert` (`type` warning/info, `showIcon`, `title`, `description`, `action` slot for Buttons). 3. The gated tool's `ThoughtChain` item `footer` slot holding the Buttons. X 2.9 has **no** approval component (x-components lists none); `ToolCall.approval` and the `Approval` RFC are unreleased |
| **Ask-user question** | X `Prompts` for suggested questions (`chat-view/welcome-panel.tsx`, `chat-view.tsx:586-601`); Markdown post-back `AnswerButton` and `AnswerForm` (`message/markdown/answer-*.tsx`); `HumanInputForm` (antd Form) | 1. X `Prompts` (`items` of `{key,label,description,icon,disabled}`, `title`, `vertical`, `wrap`, `onItemClick`) for one-click options. 2. antd `Radio.Group` (`options`, `optionType` default/button, `buttonStyle`, `orientation`, `block`) or `Checkbox.Group` (`options`, `value`, `onChange`) inside an antd `Form` (the `HumanInputForm` pattern), plus `Input.TextArea` for free text. 3. A form generated from the interrupt's `responseSchema` (antd Form; **docs silent** on a schema-form helper in antd or X) |
| **Shared-state panel** | none | 1. antd `Descriptions` (`items`, `column`, `layout`, `bordered`, `size`) for flat keys. 2. antd `Tree` (`treeData`, `showLine`, `defaultExpandAll`, `titleRender`, `blockNode`) for nested JSON. 3. X `CodeHighlighter` `lang="json"` for raw JSON. Container: antd `Drawer` (frontend rules) or `Collapse`; X `Folder` is a file-tree browser (`x-components` API "Folder"), not a JSON viewer **(opinion)** |
| **Attachments** | X `Attachments` in `Sender.Header` (`open`, `onOpenChange`, `title`), with Upload props for the hub's proxy, `onPasteFile` (`chat-view/sender-attachments.tsx`); X `FileCard` and antd `Image.PreviewGroup` for message files (`message/message-files.tsx`) | 1. Same: `Attachments` (`items`, `maxCount`, `placeholder`, `overflow`, `getDropContainer`, inherits antd `Upload` incl. `customRequest`/`beforeUpload`/`accept`) in `Sender.Header`. 2. `FileCard` / `FileCard.List` (`items`, `size`, `removable`, `onRemove`, `overflow`) in user bubbles. 3. Sender `onPasteFile` for paste-to-attach |
| **Run error** | antd `Alert` `type="error"` `showIcon` `title` `description` inside the bubble, below what streamed (`chat-view/assistant-content.tsx:54-63`); history load error `Alert` with `action` Retry (`chat-view.tsx:540-560`) | 1. antd `Alert` (`type="error"`, `showIcon`, `title`, `description` = code, `action` = Retry). 2. A `ThoughtChain` item `status:'error'` for a failed tool step. 3. antd `Result` (`status` error, `title`, `subTitle`, `extra`) for a turn with nothing else. Bubble items take `status` (MessageStatus); **docs silent** on a dedicated error look for Bubble |
| **Stop** | X `Sender` `loading` + `onCancel` → `chat.stop()`; caption `Typography.Text type="secondary"` "stopped" (`chat-view/chat-sender.tsx`, `assistant-content.tsx:95`) | 1. Same: Sender `loading`/`onCancel` (its `LoadingButton` through `suffix` `components`). 2. `ThoughtChain` item `status:'abort'` for tools cut off. 3. ToolCall `onCancel` (unreleased) |
| _(extra)_ Activity / provider extras | n/a | ThoughtChain items, antd `Steps`; `@ant-design/x-card` 2.9.0 (`XCard.Box`/`XCard.Card`, A2UI v0.9) for `a2ui-surface` activity (`x-card/SKILL.md`). Not installed in the hub |

---

## 5. Existing hub code: what is provider-neutral

This builds on `dify-coupling-map.md` §5 (A = generic, B = Dify) and was re-checked against the imports on 2026-10-14. "Neutral" means it imports nothing from `lib/providers/dify` and needs at most a type rename.

| Area | Neutral as is (or after a type/prop rename) | Neutral UI, Dify data or wiring (split) | Dify only |
| --- | --- | --- | --- |
| Shell | `app-unavailable.tsx`; `chat-view/conversation-drawer.tsx`, `sider-collapsed.tsx`, `width-toggle.tsx`; the reading-width and column layout in `chat-view.module.css` | `chat-view/chat-view.tsx`: the page layout (UserShell, AppSider, column, history Alert, composer, disclaimer) is neutral; its wiring (`useDifyChat`, inputs form, HITL, suggestions, feedback, speech) is Dify | `chat-workspace.tsx` (`createDifyApi`, `/parameters`, `/site`, mode switch), `utils-index.ts`, `app-answers.ts`, `app-context.tsx` (`DifyChatApp`, `DifyApi`) |
| Message list | `chat-view/message-list.tsx` (Bubble.List, stable role map, load earlier, skeleton; typed to `useDifyChat`/`DifyChatMessage`); `hooks/bubble-items.ts` (loading only while empty; Dify field names in `isEmpty`) | `chat-view/assistant-content.tsx`: the frame (vertical Flex, error Alert below the content, "stopped" caption, empty warning) is reusable; its part order and fields (workflow, thoughts, citations) are Dify's | — |
| Composer | `chat-view/chat-sender.tsx` (X Sender, controlled, speech suffix, stop) | `chat-view/sender-attachments.tsx` (Attachments-in-header UI; uploads via `useDifyUpload` and Dify file rules) | `chat-view/file-upload.tsx`, `file-types.ts`, `inputs-form.tsx`, `inputs-collapse.tsx`, `inputs-values.ts` |
| Conversations | `provider/keys.ts` logic (the field is called `difyId`); `provider/provider-cache.ts` (typed to `DifyChatProvider`); `hooks/history-paging.ts`'s cursor helpers (Dify `first_id` semantics in the docs) | `chat-view/conversation-sidebar.tsx` (X Conversations, AppAvatar via the neutral icon route; reads `site.title`); `chat-view/use-conversation-menu.tsx` (rename/delete modal; gating on `getDifyId`); `hooks/use-conversations.ts` (`useXConversations` pattern; Dify list API) | `provider/conversations.ts` (Dify item mapping) |
| Welcome | — | `chat-view/welcome-panel.tsx` (X Welcome + Prompts; data from `site`/`parameters`) | — |
| Markdown | `message/message-markdown.tsx` (single XMarkdown entry); `markdown/code-block.tsx`, `echarts-block.tsx`, `echarts-option.ts`, `svg-block.tsx`, `think-block.tsx`, `dom-node.ts`, `message-context.tsx`, `send-context.tsx`, `markdown.module.css`; `markdown/dompurify-config.ts` (named `difyDompurifyConfig`) | `markdown/markdown-image.tsx`, `markdown-link.tsx`, `markdown-source.tsx`, `video-block.tsx` (rewrite Dify file links through `difyApi.remoteFileUrl`, otherwise generic); `markdown/components.tsx` (the map) | `markdown/answer-form.tsx`, `answer-button.tsx` (Dify post-back conventions; arguably reusable HTML conventions) |
| Message parts | `message/reasoning.tsx`, `think-title.ts`, `use-think-timer.ts`; `persistence/think-time-storage.ts`; `chat-view/dislike-popover.tsx`; `chat-view/user-content.tsx` (reads `app.settings.answerForm`) | `message/agent-thoughts.tsx` + `thought-status.ts` (the ThoughtChain tool-call pattern; typed to Dify `AgentThought`); `message/message-files.tsx` (FileCard/Image UI; links via `difyApi`); `message/message-sources.tsx` (X Sources UI; Dify `RetrieverResource`); `message/human-input-form.tsx` (antd Form-in-bubble with actions; Dify HITL types); `chat-view/message-footer.tsx` (X Actions: copy, regenerate, rating, TTS; Dify feedback/TTS API) | `message/workflow-logs.tsx`, `workflow-node-icon.tsx`, `workflow-summary.ts` (also holds the neutral `formatCount`), `display-workflow.ts`, `human-input-definition.ts`, `human-input-phase.ts`, `citations.ts`, `file-link.ts`; `persistence/workflow-data-storage.ts` |
| Data layer | `hooks/speech-recording.ts`; the _structure_ of `hooks/use-dify-chat.ts` (provider per key, `defaultMessages` + `queueRequest`, `sendDecision`, guarded `abort`, `requestFallback` keeping streamed content, `loadEarlier`/`retryHistory` via a `useSyncExternalStore` side store) is the template for an AG-UI hook | `hooks/dify-errors.ts` (`failureText` maps the hub's own codes; the rest is Dify) | `provider/dify-chat-provider.ts`, `dify-fetch.ts`, `history.ts`, `message.ts`; `hooks/use-dify-chat.ts` (as code), `use-dify-upload.ts`, `use-speech-to-text.ts`, `use-tts.ts`, `use-suggestions.ts`, `use-workflow-run.ts`, `run-reducer.ts`; `chat-view/message-actions.ts`; `workflow-view/*` |

**Note.** `DifyChatMessage` is already a "one X message per turn with several parts" model: `content`, `reasoning`, `thoughts` (tool calls), `workflow`, `humanInput` (the interrupt), `files`, `citations`, `error` and `aborted` (`components/chat/provider/message.ts:69-94`). The HITL resume continues that same message through `onReload` (ADR-0017, "HITL continuation").

---

## Implications for the hub (opinion)

### A. Message model: one X message per _turn_, holding ordered parts

**Recommendation.** One `useXChat` `ChatMessage` per user message and one per assistant **turn**. A turn holds everything the run produced in answer to a user message, including the runs that resume it after interrupts, as an arrival-ordered list of parts. It is not one X message per AG-UI message.

**Why:**

1. **The hook writes one message per request** (§1.3). A turn is exactly what one request, or one `onReload` resume, produces. With one message per AG-UI message we would have to insert messages from outside the provider, which is undocumented (§1.4), and manage their statuses, aborts and fallbacks by hand.
2. **`transformMessage(originMessage, chunk)` is a reducer over one value.** A turn reducer (`applyAgUiEvent(turn, event)`) fits it the way `applyEvent` fits Dify today (`dify-chat-provider.ts:98-263`), and it can be tested as a pure function.
3. **It matches what the reference clients do** (§3.5): tool results merged into their call, reasoning and text in arrival order, approvals on the gated call. It also matches the hub's own `DifyChatMessage`, so Part 3's Dify adapter fits the same shape.
4. **Visual splitting stays possible.** If the owner wants separate bubbles per part, X's documented `parser` can split a turn without changing the store (§1.4). The keys `${turnId}_${i}` stay stable while parts are only appended.
5. **It lines up with X's direction.** A turn's parts correspond to `selectAgentTimeline(state, { runId })` entries (message / reasoning / tool / approval), so a later move to an AgentProvider (if it ships on `main`) is a mapping, not a redesign.

**Sketch (names illustrative):**

```ts
type TurnPart =
	| { kind: 'text'; messageId: string; text: string; open: boolean }
	| { kind: 'reasoning'; messageId: string; text: string; open: boolean }
	| {
			kind: 'tool'
			toolCallId: string
			name: string
			argsText: string
			parentMessageId?: string
			status: 'streaming' | 'called' | 'done' | 'awaiting-client'
			result?: { messageId: string; content: unknown }
			approval?: { interruptId: string; message?: string; decision?: 'approved' | 'rejected' }
	  }
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }
	| { kind: 'custom'; name: string; value: unknown } // namespaced provider extras
interface AgUiTurn {
	role: 'user' | 'assistant'
	parts: TurnPart[] // arrival order; a user turn holds text + attachment parts
	runs: {
		runId: string
		outcome?: 'success' | 'interrupt' | 'cancelled' | 'error' | 'truncated'
		error?: { code?: string; message: string }
	}[]
	interrupts?: Interrupt[] // open interrupts of the last run (RUN_FINISHED outcome)
	pendingToolCallIds?: string[] // success outcome naming unanswered frontend tools
	messageIds: string[] // AG-UI message ids this turn covers (store / feedback alignment)
	aborted?: boolean
}
```

**Event to part mapping:**

| AG-UI event | Turn update |
| --- | --- |
| `RUN_STARTED` | push a run entry |
| `TEXT_MESSAGE_*` / `_CHUNK` | text part keyed by `messageId`; a new part after any non-text part, as TanStack does |
| `REASONING_*` | reasoning part keyed by `messageId` |
| `TOOL_CALL_START` / `ARGS` / `END` / `CHUNK` | tool part keyed by `toolCallId` |
| `TOOL_CALL_RESULT` | merged into the tool part found by `toolCallId`, also when it arrives in a resume run |
| `ACTIVITY_*` | activity part keyed by `messageId` (snapshot replaces, delta patches) |
| `CUSTOM` | custom part, or a turn-level map when the name is a sidecar |
| `STATE_*` | outside the turn (§D) |
| `RUN_FINISHED` | records the outcome, `interrupts` and `pendingToolCallIds` |
| `RUN_ERROR` | records the run's error |
| stream ends without a terminal event | `truncated` (the spec forbids synthesising `RUN_FINISHED`) |
| `MESSAGES_SNAPSHOT` / `STEP_*` / `RAW` | normalised or ignored on the hub's server |

**X `status` and run outcome are two layers.** X's `status` reports transport: `updating` while streaming, `success` once the stream closed, `abort`/`error` for transport failures. `runs.at(-1).outcome` reports what AG-UI said. A turn can be X-`success` and still be interrupted, failed in-stream or truncated.

### B. Interrupts (approvals, ask-user) in `useXChat`

1. **The run closes.** It ends with `RUN_FINISHED{outcome: interrupt}`. The stream closes, `onSuccess` fires, and the turn is X-`success` with `interrupts` set and `isRequesting` false.
2. **Rendering:**
   - interrupts with `reason: 'tool_call'` and a `toolCallId` render on that tool part (Approve / Reject; resume payload `{approved, editedArgs?}` per AG-UI);
   - other reasons (`input_required`, `confirmation`, a namespaced `…:ask_user`) render as an interrupt block at the end of the turn, a form built from `responseSchema` or provider-specific;
   - decisions are held client-side until **every** open interrupt is answered, as assistant-ui and CopilotKit do.
3. **Resume continues the same turn.** Call `chat.onReload(turnId, { resume, turn })`: `transformLocalMessage` returns `[]`, `requestPlaceholder` returns the turn itself, and the provider keeps `resumeBase` because the first reload chunk has no origin (§1.2). The resume run's `TOOL_CALL_RESULT` then merges into the gated call. This is the pattern the Dify HITL already uses (`use-dify-chat.ts:358`, `434-451`; `dify-chat-provider.ts:410-427`). The hub's server re-checks coverage before calling the agent (charter §4.3).
4. **A new message while interrupts are open.** Either block the send (assistant-ui throws), or "steer away": resume every open interrupt as `cancelled` and append the user message in the same request. The owner should decide. `isRequesting` is false during the wait, so the hub needs its own guard (§1.5).
5. **Frontend tools** (a success outcome with `pendingToolCallIds`) follow the same path: answers go as `tool` messages in the next request, continued with `onReload`. For Part 2's ask-user, prefer an interrupt over a frontend tool. The hub then needs no client tool execution, and the hub-chosen tools rule (charter §4.3) stays simple.
6. **Reload survival.** Open interrupts and pending calls are stored per thread on the server (charter §4.2) and returned with the history, so the approval UI comes back after a page reload. assistant-ui needs the same persisted metadata (`runtime-options.mdx:128`).

### C. Stop and history load

- **Stop.** Use `chat.abort()`: an `AbortError` → `requestFallback` → return `{ ...messageInfo.message, aborted: true }` (the hub's current `fallbackMessage` pattern), which accepts the documented quirk that the turn gets a new id at the end of the list.
  - AG-UI has no stop request. Closing the connection makes a **truncated** run, not a cancelled one.
  - So the hub's route must abort its upstream fetch when the browser disconnects, persist what arrived, and mark the run stopped in its store. A separate `POST …/stop` route is optional (CopilotKit's runtime has one).
  - Do not set XRequest `retryInterval`; a retry would replay the run.
- **History load.** `defaultMessages: async ({ conversationKey })` → the hub's history route returns **turns already grouped on the server**, together with each turn's run outcomes, open interrupts and stable ids (status `success`). Sends during the load go through `queueRequest` (the existing `sendDecision`), and "load earlier" pages by whole turns through `setMessages` prepend (existing helpers).
  - Group on the server because assistant-ui shows that regrouping bare AG-UI messages is lossy: there is no run identity on the wire, and the order of text and tool calls inside an assistant record is lost.
  - So the store should keep `runId`, the turn id and the part order per stored message. That is a store-design input for the Part 2 spec.

### D. Shared state, extras and renderers

- **State.** `STATE_SNAPSHOT` and `STATE_DELTA` (JSON Patch) are thread-scoped, and `useXChat` has no slot for them. Keep them in a per-conversation-key external store:
  - the provider writes it, as `onWorkflowUpdate` does today;
  - the history load seeds it;
  - components read it with `useSyncExternalStore`, the same pattern as `paging`/`historyErrors` in `use-dify-chat.ts:60-81`.

  Applying JSON Patch needs a library (`fast-json-patch` is what `@ag-ui/client` and assistant-ui use), which is a dependency decision for an ADR. Alternatively the hub's server applies deltas and sends snapshots only.

- **Renderers:**
  - one registry by tool name with a generic fallback card (CopilotKit `"*"`, assistant-ui's fallback);
  - one registry for `CUSTOM` names `<provider>:<name>`, in the client provider registry of ADR-0032 (`components/provider-ui/`);
  - unknown names are not shown (assistant-ui's rule).
- **Shared components.** Reuse `message-list`, `bubble-items`, `chat-sender`, `message-markdown` and its neutral blocks, `reasoning`, the `agent-thoughts` ThoughtChain pattern (generalised to tool parts), `message-files`, `sender-attachments` (with a hub upload route), `conversation-sidebar`, the shell pieces and the `assistant-content` frame. Move the Dify file-link rewrite out of the shared Markdown map into a provider extension.

### E. Watch list

- X PR #2041 (2.10 to `main`; no AgentProvider) and PR #2013 (`ToolCall`). If `ToolCall` ships, it is the natural tool card, approval included.
- AgentProvider reaching `main` with an approval model that can close and resume runs. Today its approvals happen inside a still-running run, which does not match AG-UI interrupts (§2.6).
- Issue #1722 (AG-UI "planned").
