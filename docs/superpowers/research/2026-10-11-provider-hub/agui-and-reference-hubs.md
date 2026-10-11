# AG-UI, Pydantic AI, Ant Design X and reference hubs (research, 2026-10-11)

Research notes for the provider-hub brainstorm (`README.md` in this folder). Facts only, each with its source; "docs silent" marks a gap. Versions were checked on 2026-10-11 against the npm registry and PyPI unless a line says otherwise. Copies of the AG-UI pages were read from `https://docs.ag-ui.com/<page>.md` (the site serves every page as Markdown; index at https://docs.ag-ui.com/llms.txt).

## 1. The AG-UI protocol today

### Versions

| Package | Latest | Published | Source |
| --- | --- | --- | --- |
| `@ag-ui/client` | 1.0.2 | 2026-10-05 | `npm view @ag-ui/client` (https://www.npmjs.com/package/@ag-ui/client) |
| `@ag-ui/core` | 1.0.2 | 2026-10-05 | https://www.npmjs.com/package/@ag-ui/core |
| `@ag-ui/encoder`, `@ag-ui/proto` | 1.0.2 | 2026-10-05 | npm |
| `ag-ui-protocol` (Python) | 1.0.0 | 2026-09-17 | https://pypi.org/pypi/ag-ui-protocol/json |
| `@ag-ui/react` | does not exist (npm 404) | — | `npm view @ag-ui/react` |

- `@ag-ui/client` 1.0.0 was published on 2026-09-17; the 0.0.x line ended at 0.0.59 (2026-08-27) (`npm view @ag-ui/client time`). The repo publishes dated releases almost daily (`release/2026-10-10`, https://github.com/ag-ui-protocol/ag-ui/releases).
- `@ag-ui/client@1.0.2`'s `package.json` declares `"agui": {"protocolVersion": "1.0"}`; it depends on `rxjs` 7.8.1, `fast-json-patch`, `uuid`, `zod ^3.25.76` (imported as `zod/v4`) and `@ag-ui/core|proto|encoder` 1.0.2. `@ag-ui/core` takes zod as a peer, `^3.25.18 || ^4.0.0` (read from the published tarballs). The hub has zod 4.6.5, so the client package would add a second zod copy (3.x) to the tree.
- 1.0 is the first version with a written, normative specification: "0.x defined shapes; behaviour lived in the TypeScript client" (https://docs.ag-ui.com/spec/1.0/changelog). Three SDKs are first-party: TypeScript, Python and .NET (https://docs.ag-ui.com/spec/1.0/index).
- "A 0.x agent keeps working against a 1.0 client": the TypeScript client has an always-on compatibility boundary that translates retired shapes, with a warning for each (https://docs.ag-ui.com/migrating-to-1-0).

### `HttpAgent` and `AbstractAgent` (`@ag-ui/client` 1.0.2)

From the docs (https://docs.ag-ui.com/sdk/js/client/http-agent, https://docs.ag-ui.com/sdk/js/client/abstract-agent) and checked against the published `dist/index.d.ts`:

- Constructor: `new HttpAgent(config: HttpAgentConfig)`, where `HttpAgentConfig extends AgentConfig` with `url: string`, `headers?: Record<string,string>` and `fetch?: (url, requestInit) => Promise<Response>` (the `fetch` option is in the typings, not on the docs page). `AgentConfig` is `{ agentId?, description?, threadId?, initialMessages?, initialState?, debug? }`.
- `runAgent(parameters?, subscriber?) => Promise<{ result, newMessages }>`. `RunAgentParameters` is `Partial<Pick<RunAgentInput, "runId" | "tools" | "context" | "forwardedProps">>` plus `resume?: ResumeEntry[]`; `HttpAgent.runAgent` also takes an `abortController`. The docs page lists the parameters without `resume` (the typings have it).
- `subscribe(subscriber) => { unsubscribe }` (an `AgentSubscriber` has per-event and lifecycle callbacks, https://docs.ag-ui.com/sdk/js/client/subscriber); `abortRun()` aborts the HTTP request through its `AbortController`; `use(...middlewares)`; `clone()`; `connectAgent()` (needs a `connect()` implementation, which `HttpAgent` lacks: "must implement `connect()` or this functionality must be provided by a framework like CopilotKit"); optional `getCapabilities?()`.
- State on the instance: `threadId`, `messages`, `state`, `isRunning`, `pendingInterrupts` (interrupts of the last run not yet resolved), `events$` (a replaying observable). `addMessage(s)`, `setMessages`, `setState`.
- The request `HttpAgent` sends: `POST`, headers `{...this.headers, "Content-Type": "application/json", Accept: "text/event-stream"}`, body `JSON.stringify(input)` (docs "requestInit()" and the 1.0.2 bundle). It does not ask for protobuf by default; the response parser is chosen by the response `Content-Type`.

### `RunAgentInput` (https://docs.ag-ui.com/spec/1.0/basic/run-input)

- `threadId` and `runId` are required; `parentRunId` optional. `threadId` "is minted by the application and is stable across runs"; `runId` "MUST NOT be reused" (https://docs.ag-ui.com/spec/1.0/basic).
- `protocolVersion`: a 1.0 consumer MUST declare it; the producer answers on `RUN_STARTED.protocolVersion` (https://docs.ag-ui.com/spec/1.0/basic/versioning).
- `messages` (required): "The conversation so far, in order. A producer MUST treat it as the complete history it is being shown — the protocol has no side channel through which earlier turns arrive." Activity messages MUST be stripped before sending. Message roles in the SDK: `developer`, `system`, `assistant`, `user`, `tool`, `activity`, `reasoning` (https://docs.ag-ui.com/sdk/js/core/types). User messages may carry multimodal parts (text, image, audio, video, document) by URL, inline data or a provider `file` handle.
- `tools` (optional): the application's own "frontend tools"; the application executes them, not the agent.
- `context` (optional): description–value pairs the producer SHOULD make visible to the model.
- `state` (optional): the state the run starts from; absent means `{}`.
- `forwardedProps` (optional): "An application-specific channel passed through to the agent untouched … intermediaries MUST NOT alter it."
- `resume` (optional): answers to the interrupts that ended the previous run.

### Transport (https://docs.ag-ui.com/spec/1.0/basic/transports)

- HTTP + SSE is the default and mandatory binding: `POST` with `Content-Type: application/json` and `Accept: text/event-stream`; `200` with `Content-Type: text/event-stream`; one JSON event per SSE `data:`; LF line endings; consumers ignore `event:`/`id:`/`retry:` and tolerate `: keep-alive` comments (https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse).
- Errors: input refused before the run (bad JSON, validation, "refused auth") is a plain HTTP error status with no stream; a failure after the stream opens is an in-stream `RUN_ERROR`, so "a consumer MUST NOT infer success from `200` alone".
- No stream resumption: `Last-Event-ID` is not used; "Re-running is a new run with a new `runId`".
- HTTP + Protobuf is optional: the client adds `application/vnd.ag-ui.event+proto` to `Accept`; the response is 4-byte big-endian length-prefixed protobuf frames; the producer MUST answer SSE when it does not support protobuf (https://docs.ag-ui.com/spec/1.0/basic/transports/http-protobuf).
- "Authentication and authorization are properties of the binding and the application, not of the protocol: AG-UI defines no credential" (transports index).
- A consumer that closes the connection has a _truncated_ run, not a cancelled one; it MUST NOT synthesize a `RUN_FINISHED` (https://docs.ag-ui.com/spec/1.0/events/lifecycle#cancelled-runs). The protocol defines no stop request: cancellation is "a producer's report", and how a client asks a producer to stop is not specified (docs silent; CopilotKit's runtime adds its own `POST /agent/:agentId/stop/:threadId`, see §2).

### Events (https://docs.ag-ui.com/spec/1.0/basic, https://docs.ag-ui.com/spec/1.0/events)

Thirty-one event types in eight families; only the run lifecycle is mandatory for a producer, and a consumer MUST accept all of them:

| Family | Events |
| --- | --- |
| Runs and steps | `RUN_STARTED`, `RUN_FINISHED` (optional `outcome`: success, interrupt or cancelled; optional `usage`, `result`), `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED` |
| Text messages | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK` |
| Tool calls | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT` (content may be a string or content parts) |
| Reasoning | `REASONING_START`, `REASONING_END`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_MESSAGE_CHUNK`, `REASONING_ENCRYPTED_VALUE` (the 0.x `THINKING_*` events are retired and translated at the compatibility boundary) |
| State | `STATE_SNAPSHOT`, `STATE_DELTA` (JSON Patch), `MESSAGES_SNAPSHOT` |
| Activity | `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` (structured progress as a message whose content is an object; `activityType` is an open string, https://docs.ag-ui.com/spec/1.0/events/activity) |
| Subagents | `SUBAGENT_STARTED`, `SUBAGENT_FINISHED`, `SUBAGENT_ERROR` (plus `subagentRunId` on attributable events) |
| Passthrough | `RAW` (provider-native event), `CUSTOM` (the application's own event) |

Every event has `type`, optional `timestamp` (not for ordering), `rawEvent` and `metadata`.

### Human in the loop: two mechanisms

1. **Frontend tools** (https://docs.ag-ui.com/spec/1.0/events/tool-calls#frontend-tools): the agent calls a tool from `RunAgentInput.tools`, does not answer it, and ends the run as _success_, optionally naming `pendingToolCallIds`. The application executes or declines the call and sends the answer as a `tool` message in the next run's `messages`.
2. **Interrupts** (https://docs.ag-ui.com/spec/1.0/basic/patterns/interrupt-resume, https://docs.ag-ui.com/concepts/interrupts): the run ends with `RUN_FINISHED` whose `outcome` is `interrupt`, carrying `Interrupt` objects (`id`, `reason`, `message`, `toolCallId`, `responseSchema`, `expiresAt`, `metadata`). Core reasons are `tool_call`, `input_required` and `confirmation`; other strings are allowed, namespaced `<framework>:<name>`. The next run carries `resume: [{ interruptId, status, payload }]`, and "The resume list MUST cover every interrupt" (the consumer enforces this before sending). For tool approvals the recommended `responseSchema` is `{ approved: boolean, editedArgs?: object }`, and the resumed run emits only `TOOL_CALL_RESULT` for the original `toolCallId`. The docs list LangGraph (opt-in `emitInterruptOutcome`) and AWS Strands as integrations with interrupt support; Pydantic AI also implements it (§3).

### Capability discovery: shape defined, retrieval not

- `AgentCapabilities` has optional groups `identity` (name, type/framework, description, version, provider, documentationUrl, metadata), `transport`, `tools`, `output`, `state` (including `persistentState`, `memory`), `multiAgent`, `reasoning`, `multimodal`, `execution`, `humanInTheLoop` (including `approvals`, `interrupts`) and `custom` (https://docs.ag-ui.com/concepts/capabilities).
- "This specification defines the shape of a declaration and what it obliges. It does not define how a consumer obtains one. No transport binding in this version carries a capabilities exchange" (https://docs.ag-ui.com/spec/1.0/basic/capabilities#retrieval). Omitted means "undeclared, not unsupported", and declarations are informative: the event stream is authoritative.
- `getCapabilities()` is implemented by framework-specific client agents (the docs name LangGraph and ADK), "not by the bare `HttpAgent`, which is a transport and has no discovery endpoint to ask" (https://docs.ag-ui.com/concepts/capabilities).
- So AG-UI has no equivalent of Dify's `/info` or `/parameters`: no agent card, no list of agents. CopilotKit's runtime has its own `GET /info` listing the agents registered in that runtime (§2), which is CopilotKit's, not AG-UI's.

### Who owns threads and history

- The protocol: the consumer sends the complete history in `messages` on every run (above). State likewise round-trips through `state`. "State and messages round-trip through the consumer and back on every run" (https://docs.ag-ui.com/spec/1.0/index, Security).
- A producer MAY restate history: one response may carry replayed earlier runs before the requested one, as `MESSAGES_SNAPSHOT` and `STATE_SNAPSHOT` (https://docs.ag-ui.com/spec/1.0/events/lifecycle#several-runs-on-one-stream). `capabilities.state.persistentState` declares whether state survives across runs on a thread.
- Persistence is the implementation's choice and differs by framework: Pydantic AI keeps nothing (§3); Microsoft Agent Framework offers an optional server-side `snapshot_store` "so the client only ever sends the newest message plus its thread_id", with a required `snapshot_scope_resolver` because "AG-UI thread ids are not an authorization boundary" (https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/security-considerations); CopilotKit's runtime keeps threads in an `AgentRunner` (in memory by default, SQLite optional) (§2).
- AG-UI's serialization guide describes storing the event stream for history restore, branching through `parentRunId`, and compaction with `compactEvents` (https://docs.ag-ui.com/concepts/serialization, https://docs.ag-ui.com/sdk/js/client/compaction).

## 2. Proxying AG-UI through the hub's server

- AG-UI's architecture diagram shows a "Secure Proxy" between the client and agents: "Backend services that provide additional capabilities and act as a secure proxy" (https://docs.ag-ui.com/concepts/architecture). The spec binds proxies: one that "forwards a run untranslated declares what the original producer spoke", and "Middlewares and proxies that pass a producer's `RUN_STARTED` through must leave its `protocolVersion` untouched" (https://docs.ag-ui.com/spec/1.0/basic/versioning, https://docs.ag-ui.com/migrating-to-1-0). `forwardedProps`: "intermediaries MUST NOT alter it" (run-input page).
- Microsoft's AG-UI security page recommends exactly the hub's shape: "**Do not expose AG-UI servers directly to untrusted clients** (e.g., JavaScript running in browsers …). Instead, implement a trusted frontend server that mediates communication and constructs AG-UI protocol messages in a controlled manner." The trusted frontend "Only includes user messages with role "user" in the message list", "Controls which tools are available (does not allow client tool injection)", manages state and context, and "Implements authentication and authorization for end users". It also says: "Treat a client-supplied `threadId` as an untrusted continuation identifier, not an authorization credential", and lists message, tool, state, context and forwarded-properties injection as threats (https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/security-considerations, updated 2026-09-15).
- Pydantic AI says the same from the agent side: "UI adapter endpoints aren't authentication boundaries … Treat the adapter endpoint as an internal backend service, running it inside your own authenticated route handler", and "Both the AG-UI and Vercel AI protocols are designed around the client transmitting the full conversation history on each request"; for integrity it recommends to "persist the history server-side keyed by the thread/session ID and pass it to the adapter via `message_history`" (https://pydantic.dev/docs/ai/integrations/ui/overview/).
- CopilotKit's runtime is the best-documented AG-UI backend-for-frontend (https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shell-docs/src/content/docs/backend/runtime-endpoints.mdx). Registered as `new CopilotRuntime({ agents: { my_agent: new HttpAgent({ url }) } })` in a Next.js route handler (`createCopilotRuntimeHandler`), it serves:
  - `GET {base}/info`: "discover registered agents and their metadata";
  - `POST {base}/agent/:agentId/run`: "The request body is an AG-UI `RunAgentInput`; the response is an SSE stream of AG-UI events";
  - `POST {base}/agent/:agentId/connect`: "resume streaming after a reconnect or page refresh";
  - `POST {base}/agent/:agentId/stop/:threadId`: "Stop the in-progress run on a given thread".
- CopilotKit's runtime keeps threads in an `AgentRunner`: `InMemoryAgentRunner` is the default ("Threads are ephemeral and lost on server restart"), `SQLiteAgentRunner` persists them, and subclasses override `run`/`connect` to persist and rehydrate (https://github.com/CopilotKit/CopilotKit/blob/main/dev-docs/architecture/setup-runtime.md, https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shell-docs/src/content/docs/backend/agent-runner.mdx). `@copilotkit/runtime` is at 1.78.0 (2026-10-09, npm).
- Authentication and identity, as the docs show them:
  - Hub to agent: the `HttpAgent` `headers` option, e.g. `Authorization: "Bearer …"` (https://docs.ag-ui.com/sdk/js/client/http-agent). CopilotKit: headers configured on the agent on the server "win on collision, so a service-to-service token can't be overridden from the browser"; browser headers are forwarded only through a `forwardHeaders.allow` allowlist (https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shell-docs/src/content/docs/auth.mdx, https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shell-docs/src/content/docs/frontends/angular/auth.mdx).
  - User identity: CopilotKit warns that "`properties` is not an auth channel … The runtime delivers `properties` to the agent as AG-UI `forwardedProps` — run payload data, not a request header — so nothing turns them into a Bearer credential. Use `headers` for auth" (auth.mdx); its runtime has an `identifyUser(request)` hook returning `{ id, name }` (Microsoft Agent Framework quickstart in the same docs tree). On the agent side, the self-hosted examples verify the forwarded `Authorization` header in a FastAPI dependency and put the user into the agent's per-request config (auth.mdx, "Self-hosted (FastAPI)"). Pydantic AI: build `deps` from authenticated server state; `context` and `forwardedProps` "prove shape, not identity" (https://pydantic.dev/docs/ai/integrations/ui/ag-ui/).
  - Conflicting example: AG-UI's own middleware page shows an `AuthMiddleware` that writes a bearer token into `forwardedProps` (https://docs.ag-ui.com/sdk/js/client/middleware, "AuthMiddleware"). The CopilotKit and Pydantic AI pages above advise against using `forwardedProps` for auth.
  - Docs silent: no AG-UI document defines a header for passing the end user's id from a trusted proxy to the agent; that convention is the hub's to choose.
- Next.js 16 (bundled docs, `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`, "Proxying to a backend"): a Route Handler may validate a request and `return fetch(proxyRequest)`; `02-guides/streaming.md` "Streaming in Route Handlers" streams raw `ReadableStream` responses (SSE named as a use case) and recommends `X-Accel-Buffering: no` behind nginx. The hub's Dify layer already does this (`lib/dify/client.ts`, ADR-0023).

## 3. Pydantic AI's AG-UI adapter

Sources: https://pydantic.dev/docs/ai/integrations/ui/ag-ui/ (the old `ai.pydantic.dev/ui/ag-ui/` and `/ag-ui/` addresses redirect there), https://pydantic.dev/docs/ai/api/ui/ag_ui/, https://pydantic.dev/docs/ai/integrations/ui/overview/, source at https://github.com/pydantic/pydantic-ai/tree/v2.55.0/pydantic_ai_slim/pydantic_ai/ui.

- **Version:** `pydantic-ai` 2.55.0, uploaded 2026-10-09 (https://pypi.org/pypi/pydantic-ai/json). v2.0.0 was released on 2026-06-23; the 1.x line still gets patches (1.107.7, 2026-09-30).
- **Entry points (2.x):** `pydantic_ai.ui.ag_ui` exports `AGUIAdapter`, `AGUIEventStream` and `DEFAULT_AG_UI_VERSION`. The recommended route is `AGUIAdapter.dispatch_request(request, agent=…, deps=…, on_complete=…, on_cancel=…)`; the manual chain is `build_run_input`/`from_request` → `run_stream` → `encode_stream`/`streaming_response`. `StateDeps` and `StateHandler` come from `pydantic_ai.ui`. Removed in 2.0 (deprecated in 1.x): the `pydantic_ai.ag_ui` module with `handle_ag_ui_request` and `run_ag_ui`, `Agent.to_ag_ui()` and `AGUIApp` (https://github.com/pydantic/pydantic-ai/blob/v1.107.7/pydantic_ai_slim/pydantic_ai/ag_ui.py).
- **Protocol version: still 0.x.** The `ag-ui` extra pins `ag-ui-protocol>=0.1.10,<1` (https://github.com/pydantic/pydantic-ai/blob/v2.55.0/pydantic_ai_slim/pyproject.toml, line 145), so it resolves to 0.1.22 although 1.0.0 exists. Support for 1.0 is the open PR #8627 "Support `ag-ui-protocol` 1.0", last updated 2026-09-24 (https://github.com/pydantic/pydantic-ai/pull/8627). Features switch on by the installed protocol version: 0.1.11 reasoning, 0.1.15 typed multimodal content, 0.1.19 interrupts and activity events. A 1.0 `@ag-ui/client` accepts the 0.x stream through its compatibility boundary (§1).
- **Frontend tools:** `RunAgentInput.tools` become an external toolset; the run ends as success and the client returns the result as a tool message in the next run (docs "Tools"; source `ui/ag_ui/_adapter.py`, `_event_stream.py`).
- **Shared state:** `StateDeps[Model]` or a `StateHandler` dataclass; `RunAgentInput.state` is validated into it. The adapter does not emit `STATE_SNAPSHOT` by itself; tools return `ToolReturn(metadata=[StateSnapshotEvent…])` (docs "State management", "Events").
- **Approvals (human in the loop):** tools with `requires_approval=True` plus `DeferredToolRequests` in the output type end the run with `RUN_FINISHED` `outcome.type == "interrupt"`, one interrupt per call, `id = f"int-{tool_call_id}"`, `reason "tool_call"`; the client POSTs the next `RunAgentInput` with `resume[]` (payload `{approved, editedArgs?, reason?}`); requires `ag-ui-protocol >= 0.1.19`, otherwise "`resume[]` is ignored even if a client sends it" (docs "Tool approval (interrupts)"). The overview warns that approvals and results are submitted by the client, so authorization belongs inside the tool.
- **Reasoning:** `REASONING_*` from protocol 0.1.11 (with encrypted values), `THINKING_*` below it.
- **Custom events:** `ctx.emit(...)` of a custom event class arrives as AG-UI `CUSTOM`.
- **`forwardedProps`:** passed through as `adapter.run_input.forwarded_props`, never read by the adapter; `context` is not given to the model automatically.
- **`threadId`/`runId`:** `threadId` becomes the agent's `conversation_id` and is echoed on `RUN_STARTED`/`RUN_FINISHED`; the protocol `runId` is not wired to the agent's run id. `on_cancel` fires on first-party cancellation, "not on a client disconnect".
- **History:** stateless. No `MESSAGES_SNAPSHOT` anywhere in `ui/ag_ui/` (source search; docs silent). Message ids the client sent survive the round trip. Server-held history goes in through `message_history` and is then trusted; frontend compaction items are ignored in that mode (docs "Compaction").
- **Capabilities:** the adapter declares no `AgentCapabilities` (no match in the docs or the `ui/ag_ui` source; docs silent).
- **Auth:** only `application/json` bodies are accepted (415 otherwise) as a CSRF guard; identity comes from `deps` built from the authenticated request. Service-to-service auth between a proxy and the agent is not covered (docs silent).

### Agent frameworks with AG-UI support (https://docs.ag-ui.com/introduction, "Supported Integrations"; https://docs.ag-ui.com/integrations)

| Label on the page | Framework | Status |
| --- | --- | --- |
| Partnership | LangChain / LangGraph | Supported |
| Partnership | CrewAI | Supported |
| 1st party | Microsoft Agent Framework (Python, .NET) | Supported |
| 1st party | Google ADK (Python middleware and JavaScript) | Supported |
| 1st party | Google Antigravity | Supported |
| 1st party | AWS Strands Agents | Supported |
| 1st party | AWS Bedrock AgentCore (hosting) | Supported |
| 1st party | Mastra | Supported |
| 1st party | Pydantic AI | Supported |
| 1st party | Agno | Supported |
| 1st party | LlamaIndex | Supported |
| 1st party | AG2 | Supported |
| 1st party | AWS Bedrock Agents | In progress |
| Community | Claude Agent SDK, Claude Managed Agents | Supported |
| Community | Langroid | Supported |
| Community | OpenAI Agents SDK | In progress |
| Community | Cloudflare Agents | In progress ("coming soon" on the integrations page) |

Also listed: A2A middleware, Oracle Agent Spec, and A2UI and MCP Apps (generative UI). Client SDKs beyond the three first-party ones: Kotlin, Go, Dart, Java, Rust, Ruby, C++ (community). npm has `@ag-ui/langgraph`, `@ag-ui/mastra`, `@ag-ui/crewai`, `@ag-ui/llamaindex`, `@ag-ui/agno`, `@ag-ui/aws-strands`, `@ag-ui/a2a`, `@ag-ui/claude-agent-sdk`, `@ag-ui/langchain` and `@ag-ui/mcp-apps-middleware` (`npm search ag-ui`). Vercel AI SDK is not on the list; TanStack's comparison says AI SDK interop "requires an external translation layer (`@ag-ui/vercel-ai-sdk` …), and native support remains an open feature request" (https://old.tanstack.com/ai/latest/docs/comparison/vercel-ai-sdk.md).

## 4. Ant Design X and AG-UI

- **Released packages: no AG-UI support.** `@ant-design/x`, `@ant-design/x-sdk` and `@ant-design/x-markdown` are at 2.9.0 (2026-07-28), the versions the hub has installed. `@ant-design/x-sdk` 2.9.0 ships `AbstractChatProvider`, `DefaultChatProvider`, `OpenAIChatProvider` and `DeepSeekChatProvider` (plus `x-request`, `x-stream`, `x-chat`, `x-conversations`, `x-mcp-client`); no file mentions AG-UI (searched `node_modules/@ant-design/x-sdk/es`). The x-sdk docs on `main` list only the chat-provider pages (custom, DeepSeek, OpenAI) (https://github.com/ant-design/x/tree/main/packages/x/docs/x-sdk).
- **Requests:** issue #1102 "适配 Agent User Interaction Protocol (AG-UI协议)" (opened 2025-08-06, `enhancement`, open; +1 from afc163; a commenter writes "CopilotKit crippled with issues and I would love to get rid of it!") (https://github.com/ant-design/x/issues/1102). Issue #1722 asks for an AG-UI-compatible solution; a maintainer (kimteayon) replied "计划中了" ("it's planned") on 2026-02-03; still open, last asked about on 2026-08-18 (https://github.com/ant-design/x/issues/1722). No pull request mentions AG-UI (`gh search prs`).
- **Unreleased: X is building its own agent protocol, not AG-UI.** On the `feature` branch (PRs #2011 and #2019, merged into `feature` in August 2026), x-sdk gains an `AgentProvider` (https://github.com/ant-design/x/blob/feature/packages/x/docs/x-sdk/agent-provider.en-US.md): "a model- and Runtime-independent Agent integration contract. It converts SSE, WebSocket, local Runtimes, recorded fixtures, and other sources into unified Agent Events." It declares `protocol: { name: 'agent-event', version: '0.1' }`; events are `run.*`, `message.*`, `reasoning.*`, `tool.*`, `approval.requested/resolved`, `task.*` and `artifact.*`; `useXChat({ provider })` then also returns `agentState` (runs, messages, reasoning, toolCalls, approvals, tasks, artifacts); commands (`approval.resolve`, `tool.retry`, `run.cancel`) go through `executeCommand`. The roadmap marks it experimental: phase 1 runs 2026-08 to 2026-09-30, and a stable API is judged only after "至少两个结构不同的参考 Provider" (at least two structurally different reference providers) pass the same contract tests (https://github.com/ant-design/x/blob/codex/feature-roadmap-phase-2/docs/roadmap/phase-1-breakdown.zh-CN.md). None of the RFCs (`x-sdk-agent-interaction`, `approval`, `tool-call`, `agent-timeline`) or roadmap pages mentions AG-UI or CopilotKit (searched on branch `codex/feature-roadmap-phase-2`). A `codex/release-2.10.0` branch exists (last commit 2026-08-31), but npm's `latest` is still 2.9.0. Separate `codex/feature-tool-call` and `codex/feature-agent-task` branches add `ToolCall` and `Task` components (August 2026). The x-card RFC plans A2UI v0.8/v0.9 surfaces (https://github.com/ant-design/x/blob/feature/docs/rfcs/0003-production-generative-ui.zh-CN.md); `@ant-design/x-card` 2.9.0 is on npm.
- **What the released X offers for a custom protocol:** a custom `AbstractChatProvider` subclass that adapts any stream to `useXChat` (https://x.ant.design/x-sdks/chat-provider-custom; the hub's `DifyChatProvider` is one, ADR-0017).
- **Other React clients for AG-UI:**
  - CopilotKit (the only "Frontend Integration" on https://docs.ag-ui.com/integrations).
  - assistant-ui's `@assistant-ui/react-ag-ui` 0.0.67 (2026-10-10), "a runtime adapter for the AG-UI … protocol", built on `ExternalStoreRuntime`; "you provide an `HttpAgent` from `@ag-ui/client`"; history restore through a history adapter and `fromAgUiMessages`; an experimental thread-list adapter (https://www.assistant-ui.com/docs/runtimes/ag-ui/overview.md, https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options.md). Its published dependencies still name `@ag-ui/client ^0.0.59` (npm).
  - TanStack AI: "The events TanStack AI streams between server and client are AG-UI events … imported directly from `@ag-ui/core`" (https://old.tanstack.com/ai/latest/docs/comparison/vercel-ai-sdk.md).
  - No official `@ag-ui/react` package exists; the AG-UI project's own clients are `@ag-ui/client` (framework-free, RxJS based) and the language SDKs.

## 5. Reference hubs: how they model providers

Read through `gh api` on 2026-10-11. Two repositories have moved: LibreChat is now `LibreChat-AI/LibreChat` (branch `main`), and LobeChat is now `lobehub/lobehub` (default branch `canary`).

### LibreChat (https://github.com/LibreChat-AI/LibreChat)

- **Provider type:** the enum `EModelEndpoint` (`azureOpenAI`, `openAI`, `google`, `anthropic`, `assistants`, `azureAssistants`, `agents`, `custom`, `bedrock`) and a `Providers` enum (`packages/data-provider/src/schemas.ts`, lines 28–54). Conversations store `endpoint`, `endpointType`, `model`, `agent_id` and `assistant_id` (`packages/data-schemas/src/schema/defaults.ts`). An agent document stores `provider` (required string), `model`, `model_parameters` (free object), `tools`, `actions`, `edges` and `versions` (`packages/data-schemas/src/schema/agent.ts`).
- **Settings:** custom endpoints are a YAML array `endpoints.custom` in `librechat.yaml`, validated by the zod `endpointSchema` (`packages/data-provider/src/config.ts`): `name`, `apiKey`, `baseURL`, `models`, `headers`, `addParams`, `dropParams`, `iconURL`, and an optional `provider` that switches the wire format (https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint). Admin overrides live in a `config` collection (`overrides: Mixed`, `priority`, `tenantId`; `packages/data-schemas/src/schema/config.ts`); secrets in them are encrypted through a registry of secret paths with a stored masked preview (`packages/api/src/admin/secrets.ts`).
- **Dispatch:** a registry, `providerConfigMap: Record<string, InitializeFn>` (`packages/api/src/endpoints/config/providers.ts`, line 40), used by `packages/api/src/agents/initialize.ts`. Every plain model endpoint runs as an "ephemeral agent" (`api/server/services/Endpoints/agents/build.js`), so all chats go through one agent runtime.
- **Frontend:** one chat view (`client/src/components/Chat/ChatView.tsx`); provider-specific parts are settings panels looked up by endpoint (`client/src/components/Endpoints/EndpointSettings.tsx`) and icons.
- **External agents / AG-UI:** none. The "Agents API" goes the other way, exposing LibreChat agents as OpenAI-compatible endpoints (https://www.librechat.ai/docs/features/agents_api).

### Open WebUI (https://github.com/open-webui/open-webui)

- **Provider type:** no provider table. The kinds are fixed (OpenAI-compatible, Ollama, pipe functions, direct, arena); each model carries `urlIdx`, `owned_by` and `pipe` at runtime.
- **Settings:** connections are parallel lists in the key/value `config` table (`backend/open_webui/models/config.py`): `openai.api_base_urls`, `openai.api_keys`, `openai.api_configs` (per index: `enable`, `prefix_id`, `model_ids`, `connection_type`, `auth_type`, …), the same under `ollama.*`; seeded from environment variables on first run, then the database wins unless `ENABLE_PERSISTENT_CONFIG=False` (https://docs.openwebui.com/reference/env-configuration). No encryption of the keys was found. Workspace models are rows of the `model` table with `base_model_id`, `params` JSON and `meta` JSON (`backend/open_webui/models/models.py`). Functions are rows of the `function` table with `type` (pipe, filter, action), Python `content` and `valves` JSON for settings (`backend/open_webui/models/functions.py`).
- **Dispatch:** an if/else in `generate_chat_completion` (`backend/open_webui/utils/chat.py`): direct connection, then `pipe` → function, then `owned_by == 'ollama'` → the Ollama router (with format conversion), else the OpenAI router.
- **Frontend:** one chat component (`src/lib/components/chat/Chat.svelte`) that always posts OpenAI-format requests to `/api/chat/completions`; the server normalises every provider to that format.
- **External agents:** through Pipe functions, admin-uploaded Python that can proxy any API or agent and appears as a model (https://docs.openwebui.com/features/extensibility/plugin/functions/pipe). No AG-UI support found.

### LobeHub (https://github.com/lobehub/lobehub, branch `canary`)

- **Provider type:** `enum ModelProvider` (`packages/model-bank/src/const/modelProvider.ts`); in the database `ai_providers.id` plus `source` (`builtin` or `custom`); a custom provider picks its wire protocol through `settings.sdkType` (`AiProviderSDKEnum`: openai, anthropic, azure, bedrock, google, ollama, …; `packages/model-bank/src/types/aiProvider.ts`).
- **Settings** (`packages/database/src/schemas/aiInfra.ts`, Drizzle): `ai_providers.key_vaults` (text, AES-GCM encrypted with `KEY_VAULTS_SECRET` through `KeyVaultsGateKeeper`, `apps/server/src/modules/KeyVaultsEncrypt/index.ts`), `settings` jsonb (`AiProviderSettings`, which also declares which settings fields the UI shows: `showApiKey`, a `proxyUrl` form spec, `showChecker`, `sdkType`, …), `config` jsonb, `enabled`, `sort`, `logo`. `ai_models` holds per-model `abilities`, `parameters`, `config` and `settings` jsonb. `agents` (`packages/database/src/schemas/agent.ts`) holds `provider`, `model`, `params` jsonb, `chat_config` jsonb, `agency_config` jsonb.
- **Dispatch:** each provider implements `LobeRuntimeAI` (optional `chat`, `models`, `embeddings`, …; `packages/model-runtime/src/core/BaseAI.ts`); the registry is `providerRuntimeMap` (`packages/model-runtime/src/runtimeMap.ts`) and `ModelRuntime` does `runtimeMap[provider] ?? LobeOpenAI` (`packages/model-runtime/src/core/ModelRuntime.ts`, line 642). Many providers come from `openaiCompatibleFactory`. The route `src/app/(backend)/webapi/chat/[provider]/route.ts` calls `initModelRuntimeFromDB`, which decrypts the key vault and builds the runtime (`apps/server/src/modules/ModelRuntime/index.ts`).
- **Frontend:** one shared conversation feature (`src/features/Conversation/`); provider-specific parts plug into the input control bar (`src/features/ChatInput/ControlBar/HeteroControlBar`).
- **External agents:** "heterogeneous agents", stored as JSON in `agents.agency_config.heterogeneousProvider` (`packages/types/src/agent/agencyConfig.ts`), from a descriptor catalogue (`packages/types/src/agent/heterogeneousAgent.ts`) and run by desktop drivers for CLI agents (Claude Code, Codex, Cursor, …; `apps/desktop/src/main/modules/heterogeneousAgent/drivers/`). They are CLI agents, not HTTP or AG-UI; no AG-UI support found.

### Dify's own model providers (https://github.com/langgenius/dify)

- **Provider type:** `providers.provider_name` (a plugin provider id) and `provider_type` (`custom` or `system`) (`api/models/provider.py`).
- **Settings:** separate `provider_credentials` and `provider_model_credentials` tables with `encrypted_config` (JSON text); only the fields the plugin's `credential_form_schemas` mark secret are encrypted, per tenant (`api/core/entities/provider_configuration.py`, `api/core/helper/encrypter.py`). The plugin manifest declares the settings form.
- **Dispatch:** model instances from `api/core/plugin/impl/model_runtime_factory.py`; calls go over HTTP to the plugin daemon (`api/core/plugin/impl/model.py`). Frontend not checked.

### Patterns across the four

1. The provider type is one discriminator: an enum or catalogue in code plus a string column, sometimes with a second "protocol" field so custom entries reuse an adapter (LibreChat's custom `provider`, LobeHub's `sdkType`).
2. Provider settings are a JSON document validated by a per-provider schema; secrets are kept apart and encrypted (LobeHub's `key_vaults` column, Dify's credentials table encrypting only the fields the schema marks secret, LibreChat's secret-path registry with masked previews). Open WebUI stores keys as plain JSON. LobeHub and Dify let the provider's schema declare its settings form.
3. Dispatch is a registry from type to adapter with a fallback (LobeHub, LibreChat); Open WebUI's if/else is the exception.
4. All three chat hubs have one shared chat view; provider-specific parts are limited to settings panels, input-bar controls and icons. Open WebUI and LibreChat normalise everything to one internal format on the server.
5. None of them supports AG-UI agents as a provider (tree and issue searches; GitHub code search returned nothing, so this is a negative finding, not a proof).

## Implications for the hub

1. **The hub has to own AG-UI threads.** The protocol makes the consumer send the complete history (`messages`) and the starting `state` on every run, and Pydantic AI keeps nothing. So the hub mints `threadId` and `runId` and stores each thread's messages, state and open interrupts or pending tool calls, scoped to the user. This matches README decision 2 (a provider-neutral conversation store). How to store it is left open by the docs: AG-UI's serialization guide describes storing event streams with `compactEvents`, while assistant-ui restores threads from stored AG-UI messages. Pydantic AI's own recommendation, server-held `message_history`, assumes the agent process can read that store, which the HTTP adapter cannot do.
2. **The hub should build the `RunAgentInput` on its server, not pass through what the browser sends.** Microsoft's guidance is that a "trusted frontend server" constructs the protocol messages, allows only `user` messages from the person, and decides the tools, state, context and `forwardedProps`. Pydantic AI says its endpoint is "not an authentication boundary". This fits ADR-0023's model: one hub route per operation, with the key on the server.
3. **Discovery: there is nothing to call.** AG-UI defines the shape of `AgentCapabilities` but no way to fetch it, a bare `HttpAgent` has none, and Pydantic AI's adapter declares none. An agent's name, description and icon, and whether it supports approvals or reasoning, must come from the admin form (the docs are silent on any health or info endpoint). CopilotKit's `GET /info` belongs to CopilotKit's runtime, not to AG-UI.
4. **Hub-to-agent auth is a server-side header.** `HttpAgent` `headers`, or a plain `fetch` with `Authorization`, set on the server so the browser cannot override it (CopilotKit's precedence rule). No document defines how a proxy passes the end user's id to the agent. CopilotKit and Pydantic AI both advise against using `forwardedProps` as an auth channel, while AG-UI's own middleware example does exactly that. The hub chooses the convention (ADR-0026's account id is the candidate value), and the agent turns it into `deps`.
5. **Stopping a run is not in the protocol.** Closing the connection is a "truncated run", and Pydantic AI's `on_cancel` does not fire on a client disconnect. The docs do not say whether the agent stops generating when the hub aborts its upstream fetch; this needs a spike. CopilotKit adds its own `stop/:threadId` route backed by its runner.
6. **Version skew is real today.** Pydantic AI 2.55.0 pins `ag-ui-protocol <1` (0.1.22), while `@ag-ui/client` is 1.0.2. The 1.0 client translates 0.x shapes with warnings (`THINKING_*` becomes reasoning, and so on). If the hub parses events on the server to persist them, it must either accept both shapes or run them through `@ag-ui/client`'s compatibility layer. A pass-through proxy must leave `RUN_STARTED.protocolVersion` alone.
7. **Human in the loop crosses run boundaries.** Approvals are an interrupt outcome answered by `resume[]` on the next run, which must cover every interrupt; frontend tools end as success and are answered by a `tool` message in the next run. Both mean the hub keeps a thread's pending items between requests. Per the spec, checking resume coverage is the hub's job as the consumer, and Pydantic AI does not check that an approved call is one it issued.
8. **Ant Design X offers no AG-UI path today.** The documented route is a custom `AbstractChatProvider` (as `DifyChatProvider` is), feeding `useXChat`. X's own `AgentProvider` (protocol `agent-event` 0.1, with approval, tool, reasoning and task events plus `agentState`) is unreleased and experimental, on the `feature` branch only. AG-UI support is "planned" per a maintainer comment, with no code and no date.
9. **The reference hubs agree on the data shape**, and it matches ADR-0030's style. They use a provider discriminator column; a per-provider settings document validated by that provider's schema; secrets split out and encrypted, sometimes write-only with a masked preview; a registry from provider type to server adapter; and one shared chat with provider-specific parts. None of them treats "where history lives" as a provider property, because all of them keep history themselves. The hub's case, where Dify keeps its own history and AG-UI does not, has no precedent among them.
10. **A dependency note.** `@ag-ui/client` brings `rxjs` and its own `zod` 3.x, while the hub uses zod 4.6.5. `@ag-ui/core` alone takes zod `^3.25 || ^4` as a peer and has the schemas and types without the RxJS client.
