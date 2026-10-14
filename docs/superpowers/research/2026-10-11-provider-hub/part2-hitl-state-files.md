# Part 2 research D: ask-user, tool approvals, shared state, attachments (2026-10-14)

Read-only research for Part 2 of the AI App Hub. Facts first, one section per question; every fact names its source. "Docs silent" marks a gap; **(opinion)** marks my views. Background already known (not repeated): the charter, `agui-and-reference-hubs.md`, `agui-reference-projects.md`.

## Sources and versions read

| Source | Version / commit | How read |
| --- | --- | --- |
| AG-UI docs (spec 1.0, concepts, SDK pages) | live site, 2026-10-14 | `https://docs.ag-ui.com/<page>.md` (index `llms.txt`) |
| `ag-ui-protocol/ag-ui` (integrations, Dojo) | `main` @ `72e8ad1802ce` (2026-10-13) | shallow sparse clone |
| `@ag-ui/client`, `@ag-ui/core` | 1.0.2 | `npm pack`, TypeScript sources recovered from the published source maps |
| `ag-ui-protocol` (Python) | 0.1.22 (wheel uploaded 2026-08-31; what Pydantic AI's `<1` pin resolves to) | PyPI wheel |
| `pydantic/pydantic-ai` | tag `v2.56.0` = `4cd82817fcb2` (2026-10-13) | shallow sparse clone |
| CopilotKit | `main` @ `7643cd4ed1a3` (2026-10-14) | Context7 `/copilotkit/copilotkit` + `gh api` |
| assistant-ui | docs on `main` | Context7 `/assistant-ui/assistant-ui` |
| Microsoft Agent Framework AG-UI pages | HITL and Security pages, both updated 2026-09-15 | learn.microsoft.com |
| vstorm full-stack template / agenticos | `475f799f7df0` / `6f8d24c1fcdc` | existing clones in the repo's git-ignored `tmp/refs/` |
| Open WebUI / LibreChat / LobeHub | `f8ae8a6c3289` (2026-10-10) / `e1dfc10449ff` (2026-10-06) / `canary` `74d973b51e03` (2026-10-14) | shallow clones in the scratchpad |
| PostgreSQL docs | 18 | postgresql.org/docs/18 |
| OWASP File Upload Cheat Sheet | `89a49d9d8d85` (2026-10-04) | GitHub raw |
| npm form libraries | registry, 2026-10-14 | `npm view` |

---

## 1. ASK-USER: frontend tool vs `input_required` interrupt

### 1.1 What the spec says about each mechanism

**Frontend tools** (https://docs.ag-ui.com/spec/1.0/events/tool-calls, "Frontend tools", page lines 158–220):

- `RunAgentInput.tools` is "the application's": "the agent proposes a call, the application executes it." Tool calls are called "the protocol's human-in-the-loop core: the agent proposes, the application disposes" (lines 9–12).
- A producer that calls a frontend tool "MUST NOT answer it" and finishes the run "with the success outcome, or none, and MUST NOT report the run as interrupted". `pendingToolCallIds` on the success outcome SHOULD name the unanswered calls; when absent, the consumer derives them from the stream and "MUST NOT read absence as 'nothing pending'".
- "A thread that continues MUST answer every one of them first": one `tool` message per call, keyed by `toolCallId`; "a call the user declined is answered by saying so"; a failure is a tool message with `error`. "Abandoning the thread answers nothing and violates nothing."
- "A producer SHOULD call frontend tools only from the advertised list; a call naming a tool the input did not advertise is not by itself a protocol violation — what to do with it is the consumer's decision" (lines 216–220).
- Tool `parameters` is JSON Schema; arguments "MUST be treated as untrusted input: validated against the tool's declared parameter schema" (Security, lines 261–276).
- Concepts page (https://docs.ag-ui.com/concepts/tools, lines 21–28, 58–107, 216–238): tools exist to "Ask for human input or confirmation"; the worked example is a `confirmAction` frontend tool (`action: string`, `importance: enum low|medium|high|critical`). "`RunAgentInput.tools` is only for these client-provided tools."

**Interrupts** (https://docs.ag-ui.com/spec/1.0/basic/patterns/interrupt-resume, lines 9–45; https://docs.ag-ui.com/concepts/interrupts):

- "A run sometimes needs something only the outside world can give it — an approval, a credential, a choice." It ends with `RUN_FINISHED` whose outcome is `interrupt` with ≥1 `Interrupt`.
- The difference, in the spec's words: "an interrupt is the producer explicitly stopping to ask, answered by resume entries; a frontend tool call rides the ordinary message loop, answered by conversation history" (tool-calls page, lines 198–201).
- Reason taxonomy (concepts/interrupts, lines 171–196): core values `tool_call` ("`toolCallId` must be set"), `input_required` ("Agent needs structured input to continue … `responseSchema` should be set"), `confirmation` ("Free-standing yes/no … `responseSchema` optional; boolean default"); other strings valid, SHOULD be namespaced `<framework>:<name>`; "For unknown reasons, clients must not error. Render from `message`, `responseSchema`, and `metadata`."
- `responseSchema` is "carried opaquely so a consumer can build a form for it" (spec line 36–37); the schema reference restricts it to an object ("rejecting the boolean schemas JSON Schema also permits") (https://docs.ag-ui.com/spec/1.0/schema.md, `Interrupt`, line 1010).
- The non-tool example is a quarterly-filing form: `reason: "input_required"`, `responseSchema` with `enum`, `integer`/`minimum`, `number`, `required`, plus `expiresAt` (concepts/interrupts lines 384–428).

**Which does the spec recommend for asking a question?** Docs silent on an explicit recommendation. The spec states both as conforming and separates them by _who stops_: the producer's code (interrupt) or the model calling an application-offered tool (frontend tool). CopilotKit's docs draw the same line: "Pick `useHumanInTheLoop` when the pause is an agent-initiated decision — the model chose to ask the user"; "Pick `useInterrupt` when the pause is a graph-enforced checkpoint" (`showcase/shell-docs/src/content/docs/human-in-the-loop/index.mdx`, lines 50–61). Microsoft's Agent Framework page says the same for approvals: "Use interrupt-based HITL when the backend owns the decision … tool-based HITL when the frontend owns the work" (CopilotKit docs, `integrations/microsoft-agent-framework/human-in-the-loop/index.mdx`).

### 1.2 What Pydantic AI 2.56.0 can produce

- **Frontend tools: yes.** `RunAgentInput.tools` becomes `_AGUIFrontendToolset(ExternalToolset)` with `ToolDefinition(name, description, parameters_json_schema=tool.parameters or {})` (`pydantic_ai_slim/pydantic_ai/ui/ag_ui/_adapter.py` lines 160–185, 352–357). When that toolset exists, the adapter adds `DeferredToolRequests` to the output type (`ui/_adapter.py` lines 647–650), so the run ends cleanly with the call unanswered.
- **Run end for a frontend tool:** `RUN_FINISHED` with `RunFinishedSuccessOutcome()` (`_event_stream.py` lines 245–262: only `output.approvals` become interrupts; `output.calls` falls through to success). No `pendingToolCallIds`: the field does not exist in `ag-ui-protocol` 0.1.22 (`ag_ui/core/events.py` lines 24–28), so the hub derives pending calls from the stream, as the spec requires.
- **`input_required` interrupts: no.** The only interrupt the adapter builds is `approval_to_interrupt`, always `reason='tool_call'` (`_interrupt.py` lines 129–147); `grep input_required` over `pydantic_ai/ui` and `docs/` finds nothing. `CallDeferred` / external calls end as success, not interrupt (above).
- **Pydantic AI Harness `AskUser`** (in the same repository at v2.56.0, `docs/harness/ask-user.md`; source `src/pydantic_ai_harness/pydantic_ai_harness/ask_user/`): a capability exposing one tool `ask_user_question`. With `answerer=None` "every `ask_user_question` call is deferred instead: the run ends with `DeferredToolRequests` output" (docs lines 82–95; `_toolset.py` lines 61–65 raise `CallDeferred`). Over AG-UI this surfaces as an ordinary, **unadvertised** tool call with no result and a success outcome (because `calls`, not `approvals`). Its `AskUserRequestedEvent` is a `CapabilityEvent`, which the UI adapters do not forward ("Capability events are internal coordination signals and are not forwarded to frontends by default", `ui/_event_stream.py` lines 916–927), and `handle_deferred_tool_requests` emits nothing (lines 929–941).
- **Answer shape on 0.x:** in `ag-ui-protocol` 0.1.22 `ToolMessage.content` is `str` only (`ag_ui/core/types.py` lines 290–300). A 1.0 tool message whose content is a list of parts fails validation there; Pydantic AI's forward-compat skip only drops unknown message _roles_ and unknown content-part _types_ in user messages (`_forward_compat.py` lines 64–119), so such a request gets a 422 (docs/ui/ag-ui.md, "Protocol version compatibility", lines 505–513). Answer frontend tools with a string.
- **Tool-name collisions:** two toolsets defining the same tool name raise `UserError` ("defines a tool whose name conflicts with existing tool", `toolsets/combined.py` lines 72–76). A hub tool named like one of the agent's own tools breaks that agent's runs.
- 0.1.22's `RunAgentInput` has **required** `tools`, `context` and `forwarded_props` (no defaults; `types.py` lines 396–412): the hub must always send them, even empty. `@ag-ui/client` 1.0.2 always does (`src/agent/agent.ts` lines 593–608).

### 1.3 What other frameworks produce (Dojo and integration code, ag-ui @ `72e8ad1802ce`)

Dojo feature map (`apps/dojo/src/menu.ts`, parsed): `human_in_the_loop` (frontend-tool HITL) is wired for 25 of 27 integrations — LangGraph (3 variants), Mastra (2), Pydantic AI, ADK, Antigravity, MS Agent Framework (.NET, Python), AG2, Agno, LlamaIndex, AWS Strands (py, ts), Claude Agent SDK, Claude Managed Agents, Spring AI, agent-spec, server-starter; not adk-js or langroid. `interrupt` is wired only for Mastra (2), ADK, ADK-JS, Antigravity, AWS Strands (py, ts); `tool_approval` only for Mastra (2).

`grep -rn input_required` over every integration's TS/Python source: **zero hits**. What each emits instead:

| Framework | Interrupt `reason` | `responseSchema` | Approval payload read | Source |
| --- | --- | --- | --- | --- |
| LangGraph | the interrupt value's `reason` key, else `"langgraph:interrupt"`; `responseSchema`/`message`/`toolCallId`/`expiresAt` copied from the value if present | only if the graph author puts one in the `interrupt({...})` value | graph-defined | `integrations/langgraph/typescript/src/interrupts.ts` lines 11–61; python `interrupts.py` lines 28–30 |
| LangGraph (default config) | **no interrupt outcome**: legacy `CUSTOM on_interrupt` + plain `RUN_FINISHED`; the structured outcome needs `emitInterruptOutcome` / `emit_interrupt_outcome=True` ("default off") | — | legacy `forwardedProps.command.resume` | `agent.ts` lines 252–254; python `agent.py` lines 646, 2967–2980; concepts/interrupts line 434 |
| Mastra | `mastra:tool_approval` (approvals), `mastra:tool_suspend` (tool `suspend()`) | parsed from Mastra's `resumeSchema` when it is valid JSON | `true` or `{approved: bool}` | `integrations/mastra/typescript/src/mastra.ts` lines 288–300, 1691–1726 |
| AWS Strands | `tool_call` for its approval hook; otherwise the native interrupt **name** (not namespaced), payload under `metadata.reason` | `{approved: boolean}` required for approvals; none otherwise | `{approved}` | `integrations/aws-strands/python/src/ag_ui_strands/agent.py` lines 648–659, 910–941 |
| Google ADK | `confirmation` (from `adk_request_confirmation`, `toolCallId` set, hint as `message`); `confirm_changes` for predictive state | none | `accepted`/`approved`/`confirmed` booleans, or `{confirmed, payload}` | `integrations/adk-middleware/python/src/ag_ui_adk/event_translator.py` lines 56–75, 1203–1208; `adk_agent.py` lines 246–270, 2005–2020 |
| MS Agent Framework (Python) | `tool_call` | `{accepted: boolean, arguments: object}`, required `accepted` — **not** the spec's `{approved, editedArgs}` | `{accepted}` | https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop (updated 2026-09-15) |
| Pydantic AI 2.56 | `tool_call` only | `{approved: boolean, editedArgs: object, reason: string}`, required `approved` | deny-by-default | `_interrupt.py` lines 75–147 |

The Dojo's own `interrupt` demo renders one time-picker for all frameworks by reading **framework-specific metadata keys** (`metadata.mastra.suspendPayload`, `metadata.crewai.output`, `metadata.reason`, `metadata.adk.toolConfirmation.payload`, `metadata.payload`), not `responseSchema` (`apps/dojo/src/app/[integrationId]/feature/(v2)/interrupt/page.tsx` lines 84–138). So in practice no framework emits a generic `input_required` with a `responseSchema` today; generic interrupts carry payloads in `metadata`.

### 1.4 How UI libraries and reference apps shape an ask-user question

- **CopilotKit** (`@copilotkit/react-core/v2`):
  - `useFrontendTool` (with a handler) and `useHumanInTheLoop`, which "is built on top of `useFrontendTool` with an internally managed handler that resolves the tool call promise when `respond` is invoked". It takes `{name, description, parameters: z.ZodSchema, render}`; `render` gets `status` `InProgress` → `Executing` (with `respond`) → `Complete` (with `result: string`) (reference `useHumanInTheLoop.mdx`).
  - Examples are app-specific tools: `humanApprovedCommand {command}`, `collectShippingAddress {orderSummary}`, `confirmDeletion {itemName, itemCount}`; the Dojo's `generate_task_steps {steps: [{description, status: enabled|disabled|executing}]}` answered with `{accepted: false}` or `{accepted: true, steps}` (`human_in_the_loop/page.tsx` lines 354–369, 420–434).
  - `useInterrupt` handles the 1.0 outcome and the legacy `on_interrupt` event. `render` receives `interrupt` (the first), `interrupts` (all), `resolve(payload?, interruptId?)` and `cancel(interruptId?)`: "The agent run resumes once every open interrupt has a response" (`showcase/shell-docs/src/content/docs/human-in-the-loop/useInterrupt.mdx`). An `enabled` filter routes interrupts to different renderers.
  - No generic schema-to-form renderer for `responseSchema` is documented (docs silent).
- **assistant-ui**:
  - "Human tools" are declared with `defineToolkit({ name: { type: "human", description, parameters: z.object(...), render: ({args, result, addResult}) } })`, and "Call addResult exactly once" (`apps/docs/content/docs/tools/tool-ui.mdx`). A frontend tool can also pause inside `execute` with `human()`/`resume()`.
  - The AG-UI runtime's interrupt API is **experimental** (`useAgUiInterrupts`, `useAgUiSubmitInterruptResponses`). Interrupts land in `metadata.custom.agui.interrupts`. Responses "must address every open interrupt; missing entries, unknown ids, or expired interrupts (`expiresAt`) reject before any network call" (`apps/docs/content/docs/runtimes/ag-ui/runtime-options.mdx`).
  - `autoCancelPendingToolCalls` (default `true`): "Cancel unresolved client-side tool calls automatically when the user sends, edits, or reloads a message" (same page).
- **Pydantic AI Harness `ask_user_question`** schema:
  - `questions`: 1–10 items. Each has a `header` (≤25 characters, unique, one line), `question` (≤500), `options` (2–6 items, each `{label ≤50, description? ≤200}`, labels unique) and `multi_select` (default false).
  - `extra='forbid'`; no control characters, "since these strings are drawn on terminals and an escape sequence in a prompt-injected call is an attack".
  - Answer: a JSON object `{header: [picked labels]}` or `{header: [custom text]}`, or the sentence "The user declined to answer. Continue without the answer, or ask differently if it is essential."
  - "The tool schema mirrors Code Puppy's `ask_user_question`." Sources: `docs/harness/ask-user.md` lines 22–26, 51–69, 162–180; `_types.py` lines 14–21, 40–111; `_toolset.py` lines 13–36.
- **vstorm template and agenticos** `ask_user`:
  - Schema: `questions: list[QuestionItem]`, at most 10, each `{question: str, options: list[str] = [], allow_custom: bool = True}`. The answer is a "Q: … / A: …" transcript with "(skipped)" or "(no answer)" (template `backend/app/agents/tools/ask_user_tool.py` lines 13–39; tool docstring `assistant.py` lines 431–448; agenticos `backend/app/agents/ask_user.py` lines 20–34).
  - Not an AG-UI frontend tool: the run blocks on a WebSocket future (see `agui-reference-projects.md`).
  - agenticos's rationale: ask-user is "Deliberately not a capability … it is whether the _surface_ running it can hold a question open" (`ask_user.py` lines 8–12).
  - The template's tool, when no channel exists, returns "User interaction is unavailable here; proceed with a reasonable assumption" (`assistant.py` lines 449–453).
- **AG-UI docs:** `confirmAction {action, importance}` (concepts/tools lines 63–90, 278–300).
- **Microsoft's guidance on hub-chosen tools:** the trusted frontend "Controls which tools are available (does not allow client tool injection)". Validation checklist: "Maintain an allowlist of valid tool names. Validate tool parameter schemas" (https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/security-considerations, updated 2026-09-15). This is about the _browser_ injecting tools. A tool the hub's server defines is the trusted frontend's own choice.
- **Discovery:** `AgentCapabilities.tools.clientProvided` declares whether an agent "accepts and uses tools provided by the client at runtime" (https://docs.ag-ui.com/concepts/capabilities, lines 142–153). As established earlier, no binding retrieves capabilities, so the hub cannot ask.

### 1.5 Rendering an arbitrary `responseSchema` as an antd form

- antd's own docs: no JSON-Schema-driven Form (`antd doc Form` via `@ant-design/cli`; docs silent).
- **react-jsonschema-form, antd theme**:
  - `@rjsf/antd` 6.11.0 (2026-09-29) has peers `antd "^5 || >6.3.5"`, `@rjsf/core ^6.11.0`, `@rjsf/utils ^6.11.0`, `@ant-design/icons ^6.0.0` and `dayjs`. The hub has antd 6.6.5, so the peer is satisfied.
  - Added dependencies: `@rjsf/core` → `markdown-to-jsx`; `@rjsf/utils` → `fast-uri`, `react-is`, `fast-equals`, `jsonpointer`, `@x0k/json-schema-merge`; `@rjsf/validator-ajv8` → `ajv ^8.20`, `ajv-formats` (`npm view`).
  - Usage is `import Form from '@rjsf/antd'` with `validator` from `@rjsf/validator-ajv8`. JSON Schema draft-07 by default; other meta-schemas through `customizeValidator` (Context7 `/rjsf-team/react-jsonschema-form`: `packages/antd/README.md`, `docs/usage/validation.md`).
- **Formily**: `@formily/antd-v5` 1.2.4 (last published 2025-03) has peers `antd ^5.13.0`, so **no antd 6**. `@formily/json-schema` is Formily's own schema dialect.
- **Ant Design ProComponents** (`BetaSchemaForm`, its own column schema, not JSON Schema): `latest` 2.8.10 peers `antd ^4 || ^5`; the `beta` 3.1.15-7 peers `antd ^6.0.0`.
- **uniforms-antd** 4.0.0 peers `antd ^5`.
- **JSON Forms** (the `uiSchema` style used by AG-UI's draft generative-UI page, https://docs.ag-ui.com/drafts/generative-ui, "Status: Draft"): its official renderer sets are React Material, React Vanilla, Angular Material, Vue Vanilla and Vue Vuetify, with no antd set (https://jsonforms.io/docs/renderer-sets).
- **Server-side validation without ajv:** zod 4.6.5 (installed) has `z.fromJSONSchema()`, marked "semi-experimental. It's behavior is liable to change" (`node_modules/zod/v4/classic/from-json-schema.d.ts`) and "experimental … not considered part of Zod's stable API" (https://zod.dev/json-schema). It throws on `not`, `if/then/else`, `dependentSchemas`, `unevaluated*` (Context7 `/colinhacks/zod/v4.6.5`).
- **A2UI** (`@ant-design/x-card` 2.9.0, A2UI v0.9) renders agent-authored surfaces, but only for agents that emit A2UI, not `responseSchema` (charter background; https://docs.ag-ui.com/concepts/generative-ui-specs).

---

## 2. Tool approvals (confirmation of the 1.0 shape)

- **`Interrupt`** (schema lines 999–1011; concepts lines 70–95): `id` (required, unique within the run), `reason` (required, open string), `message?`, `toolCallId?`, `responseSchema?` (object), `expiresAt?` (string, "deliberately unconstrained"; convention ISO 8601), `metadata?`, `subagentRunId?`.
- **`ResumeEntry`** (schema lines 952–961; SDK types lines 50–70): `interruptId`, `status: "resolved" | "cancelled"`, `payload?` (any JSON except `null`), `metadata?` (envelope, e.g. signatures). "Denials are expressed inside the payload (for example, `{ approved: false }`), not as a separate status." `cancelled` means "abandoned without providing meaningful input" (concepts lines 112–122).
- **Recommended approval schema:** `{ approved: boolean, editedArgs?: object }`, required `approved`. `editedArgs` is "a full replacement, not a partial merge", and "Its presence in the schema is the capability signal that the client may offer edit UI" (concepts lines 211–231). The resumed run emits only `TOOL_CALL_RESULT` for the original `toolCallId` (lines 197–209).
- **Coverage rule** (spec lines 57–69):
  - "The resume list MUST cover every interrupt of the run being continued … Omission is not abandonment. Coverage is the consumer's rule to enforce … A consumer MUST reject a resuming input that leaves an interrupt uncovered before the run starts."
  - Each `interruptId` "MUST name an interrupt from … the most recent interrupted run on the thread".
  - The concepts page adds "Pending interrupts block new input": any input on a thread with unresolved interrupts must carry `resume` (rule 4, lines 133–136). Partial resumes are not supported (rule 3).
  - Idempotency: the same `(threadId, interruptId, status, payload)` must be safe to replay (rule 5).
- **Expiry** (spec lines 70–78): the consumer judges expiry. An interrupt it judges expired "can no longer be answered" (the consumer rejects a resolving entry) but "must be — abandoned". `@ag-ui/client` 1.0.2 reads it as `new Date(expiresAt) <= now` (`src/interrupts/index.ts` lines 13–16). It throws on a resolve of an expired interrupt and accepts a `cancelled` entry for it ("Expiry forecloses ANSWERING, not resolving the thread", `src/agent/agent.ts` lines 611–632).
- **Several interrupts** (concepts lines 349–382): one `RUN_FINISHED` may carry several. The consumer answers all in one `resume[]` (e.g. approve two, cancel one), and the agent "treats `tc-c` as not-executed". The client helper `buildResumeArray` throws on missing or unknown ids (`src/interrupts/index.ts` lines 22–46). CopilotKit accumulates per-interrupt answers and submits when all are in (useInterrupt docs). assistant-ui rejects incomplete lists before the network (runtime-options).
- **State at the boundary:** "the agent must emit any state required for resume via `StateSnapshot` and `MessagesSnapshot` events before the `RunFinished`" (concepts lines 147–157). Pydantic AI emits neither by itself (prior research).
- **Pydantic AI 2.56 on the 0.x wire:**
  - The gated call streams as ordinary `TOOL_CALL_START/ARGS/END`, then `RUN_FINISHED {outcome: {type: "interrupt", interrupts: [{id: "int-<toolCallId>", reason: "tool_call", toolCallId, message: "Approve <tool>(<args json>)?", responseSchema: {type: object, properties: {approved: {type: boolean}, editedArgs: {type: object}, reason: {type: string}}, required: ["approved"]}, metadata}]}}` (`_interrupt.py` lines 75–147; `_event_stream.py` lines 245–262).
  - Resume: `status: cancelled` gives `ToolDenied('Cancelled by user.')`. A payload that fails validation denies; `approved: true` approves; `editedArgs` maps to `override_args`; `approved: false` + `reason` gives `ToolDenied(reason)` (`_interrupt.py` lines 160–196; docs/ui/ag-ui.md lines 321–372).
  - Requires `ag-ui-protocol >= 0.1.19`, met by 0.1.22 (`_utils.py` line 51).
  - A run cancelled first-party ends with a bare `RUN_FINISHED` (no outcome), because "AG-UI has no cancelled outcome" in 0.x (`_event_stream.py` lines 217–225).
  - The docs warn the adapter "does not verify that an approved tool call is one the server actually issued" (docs/ui/overview.md lines 174–177).
- **`@ag-ui/client` 1.0.2's compatibility boundary does not need to translate interrupts.**
  - 0.1.22 already has the 1.0 shapes: `Interrupt`, `ResumeEntry` (`resolved|cancelled`) and `RunFinishedInterruptOutcome` (`ag_ui/core/types.py` lines 360–393; `events.py` lines 24–45), serialised camelCase.
  - The boundary only turns whole-`null` optional fields into absent ones (`RUN_FINISHED.outcome`, `outcome.pendingToolCallIds`, resume `payload`, …; `src/middleware/compatibility-boundary.ts` lines 36–60), translates `THINKING_*`, and upgrades legacy `binary` parts (migrating-to-1-0, lines 21–36).
  - Docs silent on any shim for LangGraph's legacy `CUSTOM on_interrupt`. The client has none: CopilotKit's `useInterrupt` handles that event itself.
- **Approval payload keys differ across frameworks** (§1.3): `approved` (Pydantic AI, Strands, Mastra), `accepted` + `arguments` (MS Agent Framework Python), `confirmed` (ADK). Each advertises its own `responseSchema`, except ADK and Mastra-without-`resumeSchema`, which send none.

---

## 3. Shared-state panel

### 3.1 The protocol

- **`STATE_SNAPSHOT` / `STATE_DELTA`** (https://docs.ag-ui.com/spec/1.0/events/state lines 14–29; snapshots pattern https://docs.ag-ui.com/spec/1.0/basic/patterns/snapshots lines 20–76):
  - A snapshot replaces wholesale.
  - A delta is an RFC 6902 patch, applied atomically against the consumer's current value. At run start that value is the input's `state`, or `{}` when none was sent (run-input lines 115–121).
  - A malformed patch is fatal; a well-formed patch that does not apply is warned about and skipped; "a consumer MUST adopt the next snapshot regardless".
  - `State` is "deliberately unconstrained — any JSON value, not only an object" (state page lines 79–84).
- **Cross-run:** "State persists across runs on a thread until an event replaces it, and the next run's input carries it back" (lines 57–63). The concepts page shows the TS client applying deltas with `fast-json-patch` `applyPatch(state, delta, true, false)` (https://docs.ag-ui.com/concepts/state lines 121–151).
- **Security** (state page lines 92–99): "State events are remote writes into application state. An application MUST validate what it reads out of state before acting on it — rendering it, executing it, granting anything because of it … A producer, in turn, SHOULD NOT put secrets in state: it round-trips through the consumer."
- **Activity** (https://docs.ag-ui.com/spec/1.0/events/activity lines 9–83):
  - "structured progress that is not conversation content — a search running, a checklist filling in". It is materialised as an `activity` message whose content is an object.
  - `ACTIVITY_SNAPSHOT` creates or replaces one message by `messageId`; `ACTIVITY_DELTA` patches it.
  - "`activityType` is an open string … A consumer MUST tolerate types it does not recognise."
  - Activity messages "MUST" be stripped from `messages` sent back. `@ag-ui/client` does this (`src/agent/agent.ts` line 591).
- **Plan/todo convention: none defined.**
  - The concepts page gives only example type names, `activityType: string // e.g. "PLAN", "SEARCH", "SCRAPE"`, with no content schema (https://docs.ag-ui.com/concepts/messages lines 180–204). The state page names "a plan, a form, a document" as typical state (line 9).
  - In use today: Mastra `mastra-background-task`, `mastra-observational-memory`; A2UI `a2ui-surface`; `mcp-apps`; Pydantic AI's own `pydantic_ai_file|compaction|uploaded_file|tool_availability_delta` (`mastra.ts` lines 69, 512; assistant-ui A2UI/MCP-apps docs; `pydantic_ai/ui/ag_ui/_utils.py` lines 68–78).
- **Capabilities:** `state.snapshots`, `state.deltas`, `state.persistentState` (concepts/capabilities lines 178–189). These are not retrievable (prior research).
- **Pydantic AI 2.56:**
  - Emits no `ACTIVITY_*` from its event stream (no hits in `_event_stream.py`).
  - Round-trips some data through activity messages it expects the frontend to echo back (`docs/ui/ag-ui.md` "Compaction", "Preserving files"). That contradicts the spec's "MUST strip" and the 1.0 client's behaviour (**(opinion)**: a hub sending the full history from its store would drop them too).
  - State comes from tools returning `StateSnapshotEvent`/`StateDeltaEvent` (the `agentic_generative_ui.py` example: `Plan {steps: [{description, status: pending|completed}]}`, lines 19–37).

### 3.2 How references display state

- **CopilotKit:**
  - Every state view is app-coded against a typed state: `useCoAgent` (`{state, setState}`), `useCoAgentStateRender({name, render: ({state, nodeName, status}) => …})`, the v2 `useAgent({updates: [OnStateChanged]})` (Context7 `/copilotkit/copilotkit`; `concepts/state` lines 182–225).
  - Activity renderers are registered per `activityType`, each with a zod `content` schema; a `"*"` wildcard is allowed (`dev-docs/architecture/plugin-points.md` lines 173–195).
  - The doc says unregistered types "show generic display", but the code returns `null` when no renderer (or wildcard) matches, and `null` when content fails the renderer's schema (`packages/react-core/src/v2/hooks/use-render-activity-message.tsx` lines 14–58).
  - Generic state views exist only as **dev tools**: the Inspector / Dev Console ("see what state the copilot is aware of"), and a docs example that prints `JSON.stringify(agent.state, null, 2)` in a `<pre>` ("Agent Dashboard", `snippets/use-agent.mdx`).
- **Dojo:**
  - `agentic_generative_ui` renders `TaskProgress` from `agent.state.steps` (description/status, progress bar; `agentic_generative_ui/page.tsx` lines 42–111).
  - `shared_state` is a typed recipe editor writing `agent.setState(...)`, which the next run sends as `state` (`shared_state/page.tsx` lines 234–259).
  - Both are schema-bound to their demo agents.
- **assistant-ui:**
  - `useAgUiState<T>()` and `useAgUiSetState<T>()` ("optimistic local update; sent with the NEXT run").
  - "Each assistant message stores the state as it stood at the end of its run"; "works with any AG-UI agent".
  - Rendering is the app's job (`apps/docs/content/docs/runtimes/ag-ui/agent-state.mdx`).
- **vstorm template:** a "Plan / Deep research" panel sticky above the composer: todos with status `pending | in_progress | completed | blocked`, a progress bar, sub-agents, auto-collapse. It is fed by its own `todo_event` frames, **not** AG-UI state; planning tool calls are hidden from the transcript and rebuilt from stored calls on reload (`frontend/src/components/chat/research-panel.tsx` lines 58–61, 125–128; `lib/research-from-tools.ts`). agenticos keeps `conversations.plan_items` JSONB with `plan-strip.tsx` (prior research).
- **Documented generic, schema-free state view for end users:** none found in AG-UI, CopilotKit, assistant-ui or the Dojo; docs silent. Only the debug tools above.

### 3.3 Editing state from the UI, and the injection threat

- The protocol allows it: state "may" be modified by both sides (concepts/state lines 26–31, 153–166: "Humans can correct or guide the agent by modifying state properties"). The Dojo's `shared_state` and assistant-ui's `useAgUiSetState` do it with typed, app-specific editors.
- **Microsoft:**
  - "State Injection — State is semantically similar to messages and can contain instructions to alter LLM behavior … `{"systemOverride": "Bypass all security checks"}`".
  - In the trusted-frontend pattern, state is "Managed by the trusted frontend based on application logic; may contain user input and in that case it must be validated".
  - Checklist: "Define a JSON schema for expected state structure … Enforce size limits … Reject unknown or unexpected fields (fail closed)" (security page).
- **Pydantic AI:**
  - `StateDeps[Model]` validates the _shape_ only (docs/ui/ag-ui.md lines 191–206).
  - The official `shared_state.py` example interpolates the client state into `@agent.instructions` ("The current state of the recipe is: {ctx.deps.state.recipe…}", lines 115–143). User-editable state therefore reaches the model **with operator authority**.
  - Compare the same docs on `context`: "Instructions carry operator authority … building them out of text a client sent lets a prompt injection inherit that authority" (docs/ui/ag-ui.md "Context").
- **(opinion)** A universal hub has no schema for an arbitrary agent's state, so it cannot meet Microsoft's "schema validate, fail closed" checklist for user edits. Round-tripping the state the **agent itself** emitted, stored server-side and never browser-supplied, is the "managed by the trusted frontend" case and is fine.

---

## 4. Attachments

### 4.1 AG-UI 1.0 content parts

- **`UserMessage.content: string | ContentPart[]`.** `ContentPart = TextPart | ImagePart | AudioPart | VideoPart | DocumentPart`. Each part has optional `id` and `metadata`; media parts have `source: PartSource` (https://docs.ag-ui.com/sdk/js/core/types lines 170–284). The same parts may be a `ToolMessage.content` (lines 286–308; tool-calls spec lines 99–124).
- **`PartSource`** (schema lines 813–847):
  - `DataSource {type: "data", value, mimeType}`: `value` is "The bytes, base64-encoded"; `mimeType` is required.
  - `UrlSource {type: "url", value, mimeType?}`: "fetched by whoever needs them"; the URL is not format-constrained.
  - `FileSource {type: "file", value, provider?, mimeType?}`: a provider-issued handle. "a consumer MUST NOT fetch it, parse it or read a scheme out of it". The source arms are a closed set (run-input lines 61–89).
- **Unusable parts:** a producer "MUST NOT fail the run" over a part it cannot use; it skips the part (run-input lines 52–56).
- **Capabilities:** `multimodal.input {image, audio, video, pdf, file}`, for clients "to show/hide file upload buttons" (concepts/capabilities lines 227–260). Not retrievable.

### 4.2 What Pydantic AI 2.56 (on `ag-ui-protocol` 0.1.22) accepts

- 0.1.22 already has the 1.0-style parts: `ImageInputContent | AudioInputContent | VideoInputContent | DocumentInputContent` with `source: InputContentDataSource {type: data, value, mime_type}` or `InputContentUrlSource {type: url, value, mime_type?}`, plus the deprecated `BinaryInputContent {mime_type, id?, url?, data?, filename?}`. There is **no `file` source** (`ag_ui/core/types.py` lines 181–246). Typed parts are gated at 0.1.15 (`_utils.py` line 45).
- **Mapping** (`_multimodal.py` lines 88–110; `_adapter.py` lines 419–461):
  - A `data` source decodes to `BinaryContent(data=b64decode(...), media_type)`, bytes sent inline to the model.
  - A `url` source becomes `ImageUrl | AudioUrl | VideoUrl | DocumentUrl(url, media_type)`.
  - Legacy `binary`: a `data:` URL decodes to bytes; another `url` becomes a typed URL by MIME prefix; `data` decodes to bytes.
- **A 1.0 `file` source inside a known part type → 422.** Validation fails and the forward-compat skip does not cover sources (§1.2).
- **URLs** (docs/input.md lines 143–179):
  - "Pydantic AI will default to sending the URL to the model provider, so the file is downloaded on their side." Per model: OpenAI Chat sends `ImageUrl` directly and downloads audio and documents; Anthropic sends images and PDFs directly; and so on (table lines 149–159).
  - `force_download=True` routes "through the library's HTTP client and applies SSRF protection"; "Only use `force_download='allow-local'` for server-authored URLs, since it allows local network access."
  - On client-submitted messages the UI adapters reset `force_download` to `False` and accept only `http(s)` schemes (docs/ui/overview.md lines 170–171).
  - **So a hub URL on the Docker network is unreachable either way**: the model provider cannot fetch it, and a local download is blocked or not attempted.
- `UploadedFile` (provider file handles) is dropped unless `allow_uploaded_files=True` (overview line 172).
- **`@ag-ui/client` 1.0.2** upgrades legacy `binary` parts to media parts both inbound and outbound (`src/middleware/compatibility-boundary.ts` lines 164, 179, 253; `legacy-content.ts` lines 40–74). It does not convert sources.

### 4.3 How reference hubs store and deliver uploads

- **Open WebUI:**
  - Table `file`: `id, user_id, hash, filename, path, data JSON, meta JSON, created_at, updated_at` (`backend/open_webui/models/files.py` lines 18–31).
  - Bytes go through a `StorageProvider`: `local` (writes `DATA_DIR/uploads`), `s3`, `gcs`, `azure`, chosen by `STORAGE_PROVIDER` (`storage/provider.py` lines 45–106, 341–360; `config.py` line 180).
  - Size cap `rag.file.max_size` (MB, unset by default; `routers/files.py` lines 394–399; `config.py` lines 987–990).
  - **To models:** image URLs are converted server-side to base64 data URIs, gated by ownership ("Gate file-by-id resolution by ownership to prevent exfiltration"; `utils/middleware.py` lines 2201–2245; `utils/files.py` lines 209–235). Documents go through RAG retrieval injected as context (`chat_completion_files_handler`, `get_sources_from_items`, `middleware.py` lines 2080–2147).
  - **Serving:** `Content-Disposition: attachment` except `inline` for PDF (and none for `text/plain`), behind an owner/admin/grant check (`routers/files.py` lines 820–846).
- **LibreChat:**
  - `FileSources`: `local, firebase, azure, azure_blob, openai, s3, cloudfront, vectordb, execute_code, mistral_ocr…, text, document_parser` (`packages/data-provider/src/types/files.ts` lines 5–20). Chosen by `fileStrategy` (default `local`, `config.ts` line 4019; local dir `uploads/`, `api/config/paths.js` line 5).
  - File documents: `user, conversationId, messageId, file_id, bytes, filename, filepath, storageKey, storageRegion, type, text, status…`, with a 1-hour TTL on temporary uploads (`packages/data-schemas/src/schema/file.ts` lines 24–95, 188–193).
  - Defaults: `fileLimit: 10`, `fileSizeLimit`/`totalSizeLimit`/`serverFileSizeLimit` 512 MB, `avatarSizeLimit` 2 MB (`packages/data-provider/src/file-config.ts` lines 553–591).
  - **To providers:** bytes are read from the strategy's stream and encoded inline as provider-native blocks, e.g. "Anthropic only accepts PDFs as base64 documents; textual types must use a text source" (`packages/api/src/files/encode/document.ts`; `image.ts`, `audio.ts`, `video.ts`).
- **LobeHub:**
  - `files` table (`id, user_id, file_type, file_hash → global_files.hash_id, name, size, url, source, …`) plus `global_files` deduplicated by SHA-256 (`packages/database/src/schemas/file.ts` lines 69–77, 201–231).
  - Bytes live in **S3-compatible storage**, whose `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` and `S3_BUCKET` are "Required"; `S3_INTERNAL_ENDPOINT` serves Docker-internal access.
  - Images go to models by URL unless `LLM_VISION_IMAGE_USE_BASE64=1` converts them to base64, needed e.g. for "Fetching images over plain http:// is not supported" (`docs/self-hosting/environment-variables/s3.mdx`).
- **CopilotKit:**
  - Attachments default to inline base64 `{type: "data"}`, with `maxSize` "default: 20MB".
  - An `onUpload` callback can return `{type: "url", value}` from an app upload endpoint "to optimize handling for large files" (`showcase/shell-docs/src/content/docs/multimodal-attachments.mdx`).
  - The Dojo's multimodal demo sends base64 images (prior research).

### 4.4 Where bytes live: PostgreSQL facts

- Field size limit **1 GB** (https://www.postgresql.org/docs/18/limits.html).
- **TOAST** (https://www.postgresql.org/docs/18/storage-toast.html):
  - Triggered when a row exceeds `TOAST_TUPLE_THRESHOLD` (normally 2 kB). Values are compressed and/or split into ~2000-byte chunk rows in the table's TOAST table.
  - The logical size of a TOAST-able value is at most 1 GB.
  - `EXTERNAL` storage skips compression, which speeds substring reads. Unchanged out-of-line values cost nothing on UPDATE.
- **Large Objects** (https://www.postgresql.org/docs/18/lo-intro.html): stored in `pg_largeobject`, up to **4 TB**, with streaming and partial reads. TOAST "makes the large object facility partially obsolete".
- **bytea** (https://www.postgresql.org/docs/18/datatype-binary.html): hex output by default.
- **PostgreSQL wiki** "BinaryFilesInDB" (last edited 2021-05-05):
  - bytea pluses: same interface, no OID tracking.
  - bytea minuses: "Limited to 1G per entry", "Memory requirements on the server can be steep".
  - DB storage overall: ACID, "Backups are easier", replicas get files, but "Backups can take significantly longer".
  - Filesystem storage: "External files and database can get out of sync".
- The hub already stores images as `bytea` (`db/schema/apps.ts` lines 42–43 `icon_image`; `db/schema/settings.ts` line 35).

### 4.5 Upload security (OWASP)

OWASP File Upload Cheat Sheet (`cheatsheets/File_Upload_Cheat_Sheet.md` @ `89a49d9d8d85`):

- **Principles** (lines 3–21): list allowed extensions; validate the type and don't trust `Content-Type`; generate the filename; limit filename length and size; authorized users only; store on a different host or outside the webroot; AV or CDR where available; CSRF protection.
- **Content-Type and signature checks** (lines 78–91): useful, but "should not be used on its own".
- **Images** (lines 107–121): "decode and re-encode … removing unnecessary metadata", with resource limits. ZIP files "are not recommended".
- **Storage** (lines 123–136): DB storage is "one additional technique … advised only when a DBA is on the team and that this process shows to be an improvement".
- **Limits** (lines 157–161): size limits, also after decompression, and download request limits.
- The upload sheet is silent on `Content-Disposition`. The HTTP Headers Cheat Sheet recommends `X-Content-Type-Options: nosniff` against MIME sniffing.

### 4.6 The hub today

- **Dify chat uploads:**
  - The hub uploads to Dify through `POST /api/dify/[appId]/files/upload`. `parseFilePart` reads `request.formData()` and takes exactly one non-empty part named `file`; there is no hub-side size check (`app/api/dify/[appId]/files/upload/route.ts`; `lib/http/parse.ts` lines 75–102).
  - The browser checks only type and count (`components/chat/hooks/use-dify-upload.ts` lines 37–80, `beforeUpload`).
  - Types by extension (`components/chat/chat-view/file-types.ts` lines 6–29):
    - document: `txt md markdown pdf html xlsx xls doc docx csv eml msg pptx ppt xml epub`
    - image: `jpg jpeg png gif svg webp`
    - audio: `mp3 m4a wav webm amr`
    - video: `mp4 mov mpeg mpga`
    - `custom` extensions from the app's rules.
  - Count comes from `file_upload.number_limits`. Dify's size limits (`system_parameters.image_file_size_limit`, `video_…`, `audio_…`, `file_size_limit`) are typed but unused in components and enforced by Dify (`lib/providers/dify/types/app.ts` lines 63–104).
- **Icon and brand pipeline** (ADR-0030, `lib/settings/images.ts` lines 30–97): byte cap, then sharp `limitInputPixels` 4096×4096, decoded-format allowlist `png | jpeg | webp` (SVG refused, with the librsvg reasoning), re-encode to PNG with metadata stripped, SHA-256.
- **Request bodies:** every path passes `proxy.ts` (matcher `/((?!_next/static|_next/image|favicon.ico).*)`, line 44). Next buffers proxied bodies up to `proxyClientMaxBodySize`, **10 MB by default**. Over the limit, "the body will only be buffered up to the limit", and "The request will not fail or return an error to the client" (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`). Uploads above 10 MB are therefore silently truncated unless the limit is raised.

---

## Implications for the hub (opinion)

### A. Ask-user

1. **Support interrupts generically first, for any `reason`.**
   - Render `message`, and a form when `responseSchema` is a supported subset: an object with string/number/integer/boolean/enum properties, arrays of enums, and `required`. Otherwise show a JSON editor checked against the schema.
   - Always offer "Cancel" (`status: cancelled`).
   - The spec says clients "must not error" on unknown reasons, so this covers `input_required`, `confirmation`, `mastra:tool_suspend`, LangGraph's free-form interrupts and anything new.
   - Validate the payload on the hub server before forwarding: the spec says clients "should validate before submitting". zod 4's `z.fromJSONSchema` is experimental. `@rjsf/validator-ajv8` brings ajv. Validating only the supported subset by hand would be a custom mechanism, so this is a spec-level decision for the owner.
   - Note that today's frameworks rarely send a `responseSchema` (§1.3), so the "message + free text" and Cancel paths will be the common case.
2. **Offer a hub frontend tool for questions, as an admin opt-in per app, default off.** Reasons:
   - It enters every model request.
   - A name clash with the agent's own tool makes Pydantic AI runs fail (`UserError`).
   - `tools.clientProvided` cannot be discovered.
   - Microsoft's guidance makes the trusted server the one that chooses tools, which this is.
3. **Schema:** adopt the Pydantic AI Harness / Code Puppy shape: `questions[1..10] {header, question, options[2..6] {label, description?}, multi_select}`, with free text allowed by the UI.
   - It is the best-specified, has length limits and a forbid-extra posture, and maps to antd Radio/Checkbox plus an "Other" Input.
   - Answer with a **string** (JSON `{header: [labels]}` or the decline sentence), because 0.x agents accept only string tool content.
   - Use a hub-namespaced name (e.g. `hub_ask_user`) rather than `ask_user_question`, so an agent running Harness `AskUser` does not clash.
   - Do not special-case unadvertised `ask_user_question` calls: that would couple the hub to Pydantic AI, against charter decision 7.
4. **Pending frontend calls:** derive them from the stream (Pydantic AI 0.x never sends `pendingToolCallIds`) and store them. If the user types instead of answering, answer the call first, with a "user did not answer" tool message, as assistant-ui's `autoCancelPendingToolCalls` does.

### B. Tool approvals

1. **Render from the interrupt, not from a hard-coded payload.** `reason: tool_call` with `toolCallId` attaches the card to the tool call. Approve/Reject buttons set the schema's required boolean property, which may be `approved` or `accepted`. With no schema, or `confirmation`, send `true`/`false`. Show the edit UI only when the schema has `editedArgs`; agenticos found read-only Approve/Reject sufficient, so edit can wait. "Dismiss" sends `cancelled`.
2. **The hub server is the consumer.**
   - Store open interrupts per thread.
   - Reject new input until they are covered.
   - Check coverage, unknown ids and expiry, letting `cancelled` pass for an expired interrupt, before calling the agent.
   - Collect all answers in the UI and submit once.
   - Store who decided and when, which also serves audit (agenticos `tool_approvals`).
   - Never let the browser send `resume` directly: the hub builds it from its stored interrupts, closing Pydantic AI's "client can approve its own call" gap at the hub boundary.
3. **Document for operators that LangGraph agents need `emit_interrupt_outcome=True`.** The hub should support only the 1.0 outcome and not the legacy `on_interrupt` custom event.

### C. Shared state

1. **Store state server-side and round-trip only what the agent emitted.**
   - Apply deltas with RFC 6902 semantics on the server (`fast-json-patch` already comes with `@ag-ui/client`).
   - Keep the per-run end state with each assistant message, as assistant-ui does.
   - Never accept state from the browser.
2. **Render generically and read-only:**
   - An activity card per `ACTIVITY_*` message. Title from `activityType`, body as a key/value or tree view of `content`, escaped, size-capped and collapsible. The spec requires consumers to tolerate unknown types; CopilotKit renders nothing for them.
   - An optional "Agent state" side panel with the same tree view, admin opt-in per app. There is no documented end-user generic state view; the references only have it as a dev tool.
   - No plan/todo convention exists, so a "plan" card needs either an agent emitting a known activity type or a per-agent renderer later. Don't invent a convention in Part 2.
3. **No user editing of state in Part 2.** Without a schema, the hub cannot meet Microsoft's "validate, fail closed" rule, and Pydantic AI's own example pipes state into instructions. A per-app typed editor can come later if a concrete agent needs one.

### D. Attachments

1. **Send `data` sources (inline base64), not URLs or file handles:**
   - Provider-fetched URLs cannot reach the hub on the Docker network.
   - Pydantic AI's local download blocks private addresses for client-submitted messages.
   - A hub URL would need a signed-URL scheme (a custom mechanism).
   - `file` sources 422 on Pydantic AI 2.56.
   - Open WebUI and LibreChat also inline bytes to providers; CopilotKit defaults to inline.
   - Cost: the full history re-sends the bytes on every run. Cap files per message and total attachment bytes per conversation.
2. **Store the bytes in PostgreSQL `bytea`** in a new attachments table: owner, conversation, message, SHA-256, decoded MIME, size, original name stored for display only.
   - The 10 MB proxy body cap and the 512 MB–1 GB container limit keep files small.
   - It matches the existing icon and brand storage, keeps one backup and ACID, and needs no new service.
   - Revisit with a volume or S3-compatible storage (LobeHub's route) only if limits grow. That would be an ADR.
3. **Pipeline and limits, per OWASP:**
   - Admin per-app allowlist of kinds (image, PDF, text, …), since `multimodal` capabilities cannot be discovered.
   - Hub-side size check below the 10 MB proxy limit (or an explicit `proxyClientMaxBodySize`), sniffing by content (sharp for images).
   - Images re-encoded through the ADR-0030 pipeline as a new kind with larger bounds, SVG refused. PDFs and text pass through unmodified (no CDR available).
   - Generated filenames.
   - Serve back only through an authorized route with `Content-Disposition: attachment` (inline only for hub-re-encoded images), `X-Content-Type-Options: nosniff` and the hub-detected `Content-Type`.
4. **The Dify path stays as it is in Part 2.** Part 3 decides whether Dify uploads move to the hub store.
