# AG-UI reference projects, read at code level (2026-10-11)

Research note for the provider-hub brainstorm (see `README.md` beside this file). It covers four sources the owner named or that define the AG-UI feature set. It does not repeat the AG-UI spec, `@ag-ui/client`, Pydantic AI's adapter docs, Ant Design X's AG-UI support or LibreChat/Open WebUI/LobeChat; those are in `agui-and-reference-hubs.md`.

Method: shallow clones of the two vstorm repositories into the git-ignored `tmp/refs/` (nothing run); the AG-UI and Pydantic AI repositories read through `gh api` at a fixed commit or tag; the hosted Dojo crawled once with crawl4ai. Every claim names the file it comes from. Paths in section 1 are relative to `template/{{cookiecutter.project_slug}}/` unless they start with `template/`. Statements marked **(opinion)** are mine, not the source's.

| Source | Version read | Date |
| --- | --- | --- |
| vstorm-co/full-stack-ai-agent-template (MIT) | `main` @ `475f799f7df0` = release 0.2.21 | 2026-10-06 |
| vstorm-co/agenticos (Apache-2.0) | `main` @ `6f8d24c1fcdc` = release v0.0.535 | 2026-10-09 |
| ag-ui-protocol/ag-ui, `apps/dojo` | `main` @ `2aabfc8cada0` | 2026-10-10 |
| pydantic/pydantic-ai, `examples/pydantic_ai_examples/ag_ui/` | tag `v2.55.0` (`7db7a4d8c4b7`) | 2026-10-09 |

---

## 1. vstorm-co/full-stack-ai-agent-template

A cookiecutter generator (FastAPI + Next.js), not an app. Each generated project picks one AI framework at generation time: `ai_framework` = `pydantic_ai | langchain | langgraph | deepagents | pydantic_deep | none` (`template/VARIABLES.md` lines 270–276). Most files are Jinja templates with `{%- if cookiecutter.… %}` blocks.

**It does not use AG-UI.** A search for `ag-ui`, `ag_ui`, `agui` and `copilotkit` over the whole clone finds nothing. Its transport is its own WebSocket at `/api/v1/ws/agent` (`backend/app/api/routes/v1/agent.py` line 64), with its own event names (`frontend/src/types/chat.ts`, `WSEventType`): `model_request_start`, `part_start`, `text_delta`, `thinking_delta`, `tool_call_delta`, `call_tools_start`, `tool_call`, `tool_result`, `final_result_start`, `final_result`, `complete`, `error`, `conversation_created`, `message_saved`, `tool_approval_required`, `ask_user`, `todo_event`, `subagent_status`, `subagent_message`, `context_usage`, `context_compacted`, `llm_started`, `llm_completed`. These are Pydantic AI's own graph-node and part events renamed (see (c)), which is why they look like AG-UI's families (text, tool call, run lifecycle) without being AG-UI. The earlier note is confirmed.

### (a) Frontend message model and UX pieces

Message model (`frontend/src/types/chat.ts`): a `ChatMessage` carries flat aggregates (`content`, `thinking`, `toolCalls[]`) **and** an ordered `parts: MessagePart[]` timeline. A part is `type: "thinking" | "text" | "tool" | "research"`; a `"tool"` part holds a `ToolCall {id, name, args, result?, status: pending|running|completed|error}`; a `"research"` part holds a `ResearchReplay {todos, subagents}`. The comment on `parts` says it exists so a multi-step turn (think → tools → text → think → tools → text) renders in order. State lives in a Zustand store (`frontend/src/stores/chat-store.ts`: `appendTextDelta`, `appendThinkingDelta`, `addToolCallPart`, `updateToolCallPart`); the WebSocket handler is `frontend/src/hooks/use-chat.ts`. Approvals, questions, to-dos and sub-agents are **not** message parts: they are separate state (`pendingApproval`, `pendingQuestions`, `useResearchStore`).

| Piece | File | UX in one line |
| --- | --- | --- |
| Ordered turn rendering | `frontend/src/components/chat/message-item.tsx` (lines ~250–330) | Each part rendered in arrival order: `ThinkingBlock` (dimmed, collapsible, open while streaming), `ToolCallCard`, `TextBubble` with a cursor, `ResearchReplayBlock`; a "Thinking…" placeholder until anything arrives. |
| Tool card | `frontend/src/components/chat/tool-call-card.tsx` | A collapsed bar per call: icon, live caption while running ("Searching the web" + bouncing dots + progress shimmer), then a check or cross, an input hint (the `url`/`query` arg), a `</>` toggle for raw args + output, and an expanded formatted view. Charts, `ask_user` and finished `run_python` open by default. |
| Per-tool result renderers | `frontend/src/components/chat/tool-results/{ask-user,datetime,fetch-url,generic,memory,rag,run-python,skills,web-search}.tsx` | One component per tool family; `generic.tsx` is the fallback (`GenericToolResult`, `RawToolView`). |
| How a renderer is chosen | `tool-call-card.tsx` | **Not a registry.** Hard-coded name tests (`toolCall.name === "web_search_tool" \|\| … "search_web"`) feeding chained ternaries for the label, the icon and the body; captions and display names in separate maps in `frontend/src/lib/agent-step-captions.ts` (`EXACT_CAPTIONS`, `PREFIX_CAPTIONS`, `DISPLAY_NAMES`). |
| Approve / edit / reject | `frontend/src/components/chat/tool-approval-dialog.tsx`, mounted above the composer by `chat-container.tsx` | An inline yellow panel "Tool approval required": per pending call, the tool name and its args as an editable JSON textarea; one **Submit (n)** button. Unchanged args → `approve`, changed args → `edit`, JSON that fails to parse → `reject`. There is **no Reject button**. The composer is disabled while it shows; the decisions go back as a `{type: "resume", decisions}` frame (`use-chat.ts` `sendResumeDecisions`). |
| `ask_user` | `frontend/src/components/ui/question-prompt.tsx` (above the composer) + `tool-results/ask-user.tsx` (in the transcript) | A card that steps through 1–10 questions one at a time ("Question 2 of 3"), each with numbered options (digit keys pick, ↑/↓ move), an optional free-text answer and a dismiss (skips the rest); answers return as `{type: "ask_user_response", answers}`. The finished tool card then shows the Q/A. |
| Sub-agent feed | `frontend/src/components/chat/subagent-feed.tsx` (inline, below the message list) | One card per spawned sub-agent: spinner / check / cross, name, live description or "Waiting for answer…" or "n messages"; clicking selects it. |
| Sub-agent panel | `frontend/src/components/chat/subagent-panel.tsx` (right side panel) | The selected sub-agent's status (Queued, Running, Waiting, Done, Failed, Cancelled, Retrying) and a timestamped log of typed messages: info, steering, question, result, error. |
| To-do checklist | `frontend/src/components/chat/research-panel.tsx` (sticky above the composer) | "Plan" / "Deep research" panel: the turn's to-do list with status icons (pending, in_progress, completed, blocked), a progress bar, sub-agent statuses and a context meter; collapses itself when everything is done. Planning tool calls (`RESEARCH_TOOL_NAMES`: `add_todo`, `write_todos`, `task`, …) are hidden from the transcript and only feed this panel. |
| Research replay | `frontend/src/components/chat/research-replay-block.tsx`, `frontend/src/lib/research-from-tools.ts` | On a reloaded conversation, the plan and the sub-agents are reconstructed from the stored planning tool calls (`reconstructResearch`). |

### (b) Where conversations and messages are stored

PostgreSQL through SQLAlchemy (`backend/app/db/models/conversation.py`, lines 186–366):

- `conversations`: `id`, `user_id`, optional `external_user_id` (IdP `sub`), `organization_id`, `project_id`, `title`, `is_archived`, `is_demo`, `active_knowledge_base_ids` (JSONB).
- `messages`: `id`, `conversation_id`, `role` (user / assistant / system), `content` (text), `thinking` (text), `model_name`, `tokens_used`. **No parts column**: the turn's interleaving is not stored.
- `tool_calls`: `id`, `message_id` → messages, `tool_call_id` (Pydantic AI's id), `tool_name`, `args` (JSONB), `result` (text), `status`, `started_at`, `completed_at`, `duration_ms`.
- The planner's to-dos sit in a separate store: `pydantic-ai-todo`'s `AsyncPostgresStorage` on a raw asyncpg pool keyed by conversation id (`backend/app/db/todo_pool.py`, `backend/app/services/research.py` `_build_todo_capability`).

How it is written (`backend/app/services/agent.py` `persist_assistant_turn`, lines 271–313): one assistant row per turn, written **after** the run ends, then one `tool_calls` row per collected call, with `started_at = now()` at persistence time (so `duration_ms` cannot be real). A turn that is stopped or fails before `agent_run.result` exists is not persisted (`backend/app/services/agent_session.py` lines ~335–360).

How it is read back (`frontend/src/lib/conversation-to-chat.ts` `buildAssistantParts`): the comment says "the DB stores flat fields … with no interleaving metadata, so we reconstruct a realistic ordered timeline": thinking first, then every tool call, then the text. A multi-step turn therefore reloads in a different order than it streamed.

Is the agent stateless? Per WebSocket session it keeps `conversation_history: list[{role, content}]` in memory and appends user text + final output after each complete run (`agent_session.py` lines ~330–340). On a new connection or a conversation switch it reloads the last `HISTORY_REPLAY_LIMIT = 100` user/assistant rows (`agent.py` lines 237–268). Every run gets that history through `build_message_history` (`agent.py` lines 96–109), which builds `ModelRequest(UserPromptPart)` / `ModelResponse(TextPart)` only: **tool calls, tool results and thinking are never replayed to the model**. So the agent object is rebuilt per turn (`get_agent(...)` in `process_message`) and gets a lossy, text-only history.

### (c) How the backend runs Pydantic AI and maps it to events

`backend/app/services/agent_session.py` (Pydantic AI branch, lines 1–857):

- One turn = `async with assistant.agent.iter(user_input, deps=…, message_history=…) as agent_run`, then `async for node in agent_run` (`_stream_agent_run`). Node kinds map to events: `is_user_prompt_node` → `user_prompt_processed`; `is_model_request_node` → `model_request_start`, then `node.stream(ctx)` and per event (`_stream_request_events`): `PartStartEvent` → `part_start` (+ `text_delta` / `thinking_delta` for a non-empty first chunk), `PartDeltaEvent` with `TextPartDelta` / `ThinkingPartDelta` / `ToolCallPartDelta` → `text_delta` / `thinking_delta` / `tool_call_delta`, `FinalResultEvent` → `final_result_start`; `is_call_tools_node` → `call_tools_start`, then `FunctionToolCallEvent` → `tool_call {tool_call_id, tool_name, args}` and `FunctionToolResultEvent` → `tool_result {tool_call_id, content}` (`_stream_tool_events`); `is_end_node` → `final_result {output}`. Then `message_saved` and `complete`.
- A turn runs as a cancellable `asyncio.Task`; a `{type: "stop"}` frame cancels it and a `complete {stopped: true}` is still sent (`handle_frame`, `_run_turn`).
- **`ask_user` is not a deferred tool.** The tool awaits `deps.ask_user`, which sends an `ask_user` event and blocks on an `asyncio.Future` until the `ask_user_response` frame arrives on the same socket (`_ask_user`, lines ~419–434; schema in `backend/app/agents/tools/ask_user_tool.py`). The run stays open in memory while the person thinks; a dropped socket loses it.
- **Tool approvals are not implemented for Pydantic AI.** The Pydantic AI session handles only `message` and `ask_user_response` frames and ignores `resume`; its comment says the shared frontend hook "emits `resume` regardless of which framework is generated" (`_HANDLED_FRAME_TYPES`, line ~74). The only producer of `tool_approval_required` is the DeepAgents (LangChain) branch (`agent_session.py` line ~2287, `_handle_resume` lines ~1998–2054), driven by LangGraph's `interrupt_on` parsed from settings (`backend/app/agents/deepagents_assistant.py` lines 220–252). No `DeferredToolRequests`, `requires_approval` or `ApprovalRequired` appears in the backend.
- Sub-agents and to-dos come from vstorm's own Pydantic AI capability packages: `subagents_pydantic_ai.SubAgentCapability`, `pydantic_ai_todo`, `pydantic_ai_summarization.ContextManagerCapability` (`backend/app/services/research.py` imports). Sub-agent status is **polled** once a second from the task manager and turned into `subagent_status` / `subagent_message` frames (`_poll_subagent_status`); to-do changes come from the storage's event emitter as `todo_event`.
- In deep-research mode the text of a model step that also calls a planning tool is withheld (buffered) as narration and only released if the run ends on it (`_stream_request_events` docstring).

### (d) More than one agent or provider?

- Framework: one per generated project (`ai_framework`, above). Each framework has its own `AgentSession` class in `agent_session.py` (five near-copies, ~600 lines each).
- Agents: one assistant per project (`backend/app/agents/assistant.py` `get_agent`), optionally with a "deep research" persona switched per message (`deep_research` flag in the frame).
- LLM providers: one at generation time, or `use_all_providers` routes by a model-name prefix chosen per message (`openai/…`, `anthropic/…`, `google/…`, `openrouter/…`; `assistant.py` `_build_model`, lines ~89–128), plus an OpenAI-compatible endpoint option (`backend/app/agents/openai_compatible.py`). This is model choice, not agent choice.

---

## 2. vstorm-co/agenticos

### State and activity (facts)

- Created 2026-07-31; 535 releases, the latest v0.0.535 on 2026-10-09; eleven releases on 2026-10-08 alone (`gh release list`). 280 commits in the 30 days to 2026-10-11 (`gh api …/commits?since=2026-09-11`). Contributors: one main author (944 commits), a second (177), then a long tail. 64 stars, 13 forks, 149 open issues (`gh repo view`, `gh api`). About 3,600 files; docs in four languages.
- So "very young" holds for age and version number, not for size: this is a large, fast-moving product.
- Stack: FastAPI, Pydantic AI + `pydantic-ai-harness`, PostgreSQL + pgvector, Redis, Prefect, Next.js (`README.md`, "For developers and operators").
- Deployment: "AgenticOS runs on a single host with Docker Compose. There are no Kubernetes manifests." (`README.md` "Not available today"; `docs/deploy.md` line 3). Also listed there: no native MFA/SAML/SCIM (OIDC instead), budgets can be overshot by parallel runs.
- It is a fork-lineage sibling of the template: its WebSocket event list (`frontend/src/types/chat.ts` lines 185–237) keeps the template's names (`model_request_start`, `text_delta`, `tool_call`, `tool_approval_required`, `ask_user`, …) and adds `connect_account`, `compaction_*`, `subagent_start|text_delta|thinking_delta|tool_call|tool_result|awaiting_approval|complete` and `browser_opened|step|frame|finished`.

### Does it speak AG-UI or any standard API a hub could front? (facts)

- **AG-UI: no.** `ag-ui` / `ag_ui` / `agui` occur only inside catalog data (`backend/app/core/catalog/mcp_registry.json`, `frontend/src/lib/mcp-logos.generated.ts`), never in code.
- **A2A: no.** Mentioned only in a comparison page about Gemini Enterprise (`docs/about/gemini-enterprise.md` line 43).
- **OpenAI-compatible: consumed, not exposed.** The hits are model-provider clients (`backend/app/agents/model_resolver.py`, `backend/app/services/model_profile.py`).
- **MCP: consumed, not exposed.** It connects agents to 5,700+ listed MCP servers (`docs/mcp.md`); nothing serves an agent as an MCP server.
- What it does expose (`docs/api.md`):
  - `POST /api/v1/agents/{id}/run`: non-streaming; body `{prompt, conversation_id?, environment_id?, file_ids?}`; answer `{run_id, output, status, cost_usd, input_tokens, output_tokens, parked[]}` (`backend/app/api/routes/v1/agents.py` line 541). Rate-limited; the per-agent grant is checked inside the service.
  - `WS /api/v1/ws/agent` (the console's, its own event protocol; a frame with `agent_id` runs that agent) and `WS /api/v1/embed/{public_key}/ws` (the public widget).
  - Approvals and resumes over REST: `GET /approvals`, `POST /approvals/{id}`, `POST /runs/{run_id}/resume` (`backend/app/api/routes/v1/runs.py` lines 373–502).
  - Auth: its own JWT (bound to its own sessions), an `X-API-Key` "service-to-service, no user behind it", or the console cookie; every call needs `X-Organization-Id` (`docs/api.md` "Authenticating", "The organization header").
  - Other "surfaces": Slack, Telegram, Mattermost bots, an embed widget, a hosted page, schedules and signed webhook triggers (`docs/concepts.md` "Exposure"; `backend/app/db/models/agent_run.py` `RunSurface`).

### Agent and data model (facts)

- `agents` (`backend/app/db/models/agent.py`): per organization, owner, `visibility`, `slug`, `name`, `categories`, `tags`, `status`, `draft_spec` (JSONB), `current_version_id`; `agent_versions` hold published `spec` JSONB with a version number. Agents are **configuration** composed from capabilities registered in code ("Code defines, configuration composes", `README.md`); environments pin versions (`docs/concepts.md`).
- `agent_runs` (`backend/app/db/models/agent_run.py`): one row per run with `surface` (web, embed, api, slack, telegram, mattermost, schedule), `status`, `user_id`, `conversation_id`, `parent_run_id` + `subagent_task_id` (delegations), model, provider, tokens, `cost_usd`, `logfire_trace_id`, and `paused_state` JSONB = "the message history as of the parked tool call, and which call each approval belongs to", set only while awaiting approval.
- `tool_approvals`: `run_id`, `agent_id`, `tool_id`, `tool_args` JSONB, sub-agent fields, `status`, `decided_by_user_id`, `decided_at`, `note`, `decided_via`.
- `messages` (`backend/app/db/models/conversation.py`): a database-allocated `ordinal` (the comment explains why `created_at` and uuid4 cannot order a turn), `run_id`, `agent_id`, `agent_version_id`, token and cost columns, a full-text `search_vector`, and **`parts` JSONB**: "the turn's timeline, in the order it happened: reasoning, the text the model wrote, and the tools it called, interleaved as they occurred … stored rather than reconstructed". `tool_calls` is the template's table unchanged. `conversations` add `summary_messages` (JSONB, full Pydantic AI messages after compaction) and `plan_items` (JSONB).
- History to the model: still text-only replay (`backend/app/services/message_history.py` `build_message_history`), with recorded usage attached so compaction can anchor on real token counts; a compacted conversation replays `summary_messages` through `ModelMessagesTypeAdapter` (`backend/app/services/conversation.py` line ~127).
- Audit: `app_admin_audit_logs` with `seq`, `prev_hash`, `entry_hash`, a hash chain (`backend/app/db/models/audit_log.py`).
- Identity: LDAP password sign-in (ldap3), Kerberos/SPNEGO, OIDC, directory group mappings to roles and groups, sharing with groups (`docs/directory.md`).

### Approvals in agenticos (facts, the best-built piece found)

`backend/app/agents/capabilities/approval/_capability.py` (`ApprovalGate`): a Pydantic AI capability whose `wrap_tool_execute` decides per tool whether a call is gated (from the agent spec, or every tool when the person chose "ask all"); asks `ctx.deps.request_approval`; on a pending decision raises Pydantic AI's `ApprovalRequired()`, ending the run with the call parked; on rejection returns a refusal as tool output; on approval runs **the approved arguments**, not whatever the model proposes on the replay. A surface with no approval channel (schedule, webhook) refuses the call ("No channel means no"). The resume uses `DeferredToolResults` / `ToolApproved` (`backend/app/services/agent_runner.py` lines ~871–940). The chat's approval card (`frontend/src/components/chat/tool-approval-dialog.tsx`) shows read-only arguments with **Approve** and **Reject**; its comment records that the template's editable-JSON "edit" path was dead and removed, and that deciding needs `approvals:decide`, a permission ordinary chat users lack.

Other agenticos UI worth knowing: a single tool table keyed by stable tool id (`frontend/src/lib/tool-catalog.ts`; the comment describes renamed tools rendering as raw JSON for five weeks because icon, caption and renderer lived in three files, and a backend test now checks both directions); `turn-parts.tsx` (one renderer for a turn, shared by the chat and the public page); `delegation-panel.tsx` (one collapsible block per sub-agent `task_id`, nested by depth, never mixed into the parent's text); `plan-checklist.tsx` / `plan-strip.tsx` (the plan strip above the composer); `connect-account-prompt.tsx` (a run paused until the person connects their own OAuth account).

### Build vs adopt/embed for a hub that fronts agents behind its own login

Facts first:

- agenticos fronts its **own** agents, defined in its own database and run by its own runner. It does not front external AG-UI agents, and it does not expose AG-UI, A2A, an OpenAI-compatible API or MCP.
- To use it as a provider, the hub would talk to `POST /agents/{id}/run` (no streaming) or to its own WebSocket protocol (a custom adapter to translate its events), authenticated as an agenticos user (JWT plus organization header) or with an API key that has "no user behind it", so per-person tools and per-person attribution are lost.
- It already has what the hub has or plans: login with LDAP/AD and OIDC, roles, groups, per-agent grants, a catalog, conversations, settings, audit, plus budgets, approvals queues, channels, an embed widget and versions.

Assessment **(opinion)**: agenticos is a competing hub, not a provider. Fronting it would mean two logins, two group models and two audit trails, through a non-standard API, with either no streaming or a hand-written protocol adapter (which ADR-0002 rules against). Adopting it instead of the hub would mean PostgreSQL + Redis + Prefect, its own UI stack (Radix UI + Tailwind, not antd; `frontend/package.json`), and giving up Dify fronting and the ADR-0026 end-user model; it is also changing fast (several releases a day). The useful path is to treat it as a design reference: the approval gate, `paused_state`, the stored `parts` timeline, the tool catalog and the delegation panel are the parts to learn from. If the owner ever wants agenticos agents in the hub, the clean way is for agenticos to grow an AG-UI endpoint (Pydantic AI's adapter would make that small on their side); the hub would then front it like any other AG-UI agent.

---

## 3. The AG-UI Dojo (`ag-ui-protocol/ag-ui`, `apps/dojo`)

### How it is built (facts)

- A Next.js app. The browser uses **CopilotKit** (`@copilotkit/react-core` 1.76.0 with its `/v2` entry, `@copilotkit/react-ui`, `@copilotkit/a2ui-renderer`; `apps/dojo/package.json`). Every feature page uses CopilotKit, the A2A chat included (`a2a_chat/a2a_chat.tsx` wraps `CopilotKit`).
- The server side is a Next.js Route Handler that builds a `CopilotRuntime` (v2, `InMemoryAgentRunner`, served through Hono) from a registry of AG-UI agents per integration (`apps/dojo/src/app/api/copilotkitnext/[integrationId]/[[...slug]]/route.ts`). The registry is `apps/dojo/src/agents.ts`: integration id → `{featureId: AbstractAgent}`, mostly `HttpAgent` instances pointing at each framework's server. The Pydantic AI client is literally `class PydanticAIAgent extends HttpAgent {}` (`integrations/pydantic-ai/typescript/src/index.ts`).
- The feature list is `apps/dojo/src/config.ts`; which integration shows which feature is `apps/dojo/src/menu.ts` ("SINGLE SOURCE OF TRUTH"); CrewAI's lists are in `apps/dojo/src/crewai.ts`. Each feature page is `apps/dojo/src/app/[integrationId]/feature/(v2)/<id>/page.tsx` with a `README.mdx`. Playwright specs per integration live in `apps/dojo/e2e/tests/` (Pydantic AI: `e2e/tests/pydanticAITests/`, nine specs), with LLM responses mocked by `@copilotkit/aimock`.

### Feature catalogue

"Mechanism" names the AG-UI events or inputs the demo relies on, taken from the README or page code; "(inferred)" marks the ones read off CopilotKit hook names rather than stated. Hook = the CopilotKit hook the page uses.

| Feature id | What the user sees | AG-UI mechanism | CopilotKit hook(s) | Pydantic AI in Dojo |
| --- | --- | --- | --- | --- |
| `agentic_chat` | Chat; asking for a new background changes the page's background; a weather card for a backend tool | Text message events; tool-call events; **frontend tools** declared by the client in the run input and executed in the browser; context from the page | `useFrontendTool` (`change_background`), `useRenderTool` (`get_weather`), `useAgentContext` | yes |
| `v1_agentic_chat` | Same chat on CopilotKit's v1 components (compatibility check) | as above | `CopilotKit` + `CopilotChat` (v1) | yes (menu) |
| `backend_tool_rendering` | A weather card rendered from a **backend** tool's arguments, status and result | tool-call start/args/end + tool-call result | `useRenderTool({name: "get_weather"})` | yes |
| `human_in_the_loop` | The agent proposes a step list; the user ticks/unticks steps and clicks Execute or Reject; the agent adapts | a **frontend tool** (`generate_task_steps`) that the browser answers once the user responds; the answer goes back as the tool result on the next run | `useHumanInTheLoop` (render gets `respond`) | yes ("No special handling is required", `human_in_the_loop.py`) |
| `interrupt` | The agent books a meeting; a backend tool suspends and an in-chat time picker appears; picking resumes the tool | `RUN_FINISHED.outcome = {type: "interrupt"}` (or legacy CUSTOM `on_interrupt`), resumed by a new run carrying the choice | `useInterrupt` → `resolve(...)` | no (Mastra, ADK, ADK-JS, Antigravity, AWS Strands, CrewAI) |
| `tool_approval` | A backend tool needing approval shows **Approve / Reject**; approve runs the original call and its real result renders; reject means the tool never runs | same interrupt outcome; resume approves or declines the pending call | `useInterrupt`, `useRenderTool` | no (Mastra only); but Pydantic AI ships this example itself, see section 4 |
| `agentic_generative_ui` | A task-progress card whose steps tick from pending to completed while the agent "works" | `STATE_SNAPSHOT` + `STATE_DELTA` (JSON Patch) emitted from tool returns | `useAgent({updates: [OnStateChanged]})` | yes |
| `tool_based_generative_ui` | A haiku card (Japanese + English + image) appears for each request | a frontend tool with a handler and a render | `useFrontendTool` (`generate_haiku`) | yes |
| `shared_state` | A recipe editor (skill level, time, ingredients, steps) that both the user and the agent edit | agent `STATE_SNAPSHOT`; client state sent in the run input; `agent.setState` | `useAgent`, `useCopilotKit` | yes (`StateDeps`) |
| `predictive_state_updates` | A document editor; the agent's rewrite streams in with green/red diff, then a confirm step | CUSTOM `PredictState` event mapping a tool argument to a state key, so state updates stream from tool-call args (`predictive_state_updates.py`) | `useAgent`, `useHumanInTheLoop` | code present, **disabled** ("until we can figure out why production builds break", `menu.ts`) |
| `agentic_chat_reasoning` | Chat with a reasoning model; reasoning shown in CopilotChat's reasoning view; a model dropdown in shared state | reasoning events (inferred); shared state | `useAgent`, `useFrontendTool` | no (LangGraph, Mastra, Agno, Antigravity, AWS Strands, CrewAI) |
| `agentic_chat_citations` | Sources panel grouped under each answer, filling while it streams, kept on later turns | citations in the assistant message's `metadata.citations`, kept in `MESSAGES_SNAPSHOT`; no separate citation event | `useAgent` | no (AWS Strands py/ts) |
| `agentic_chat_multimodal` | Attach an image and ask about it | `ImageInputContent` (base64) in the user message | `CopilotChat` with `attachments={{ enabled: true }}` | yes |
| `subgraphs` | Travel planner: supervisor plus flights / hotels / experiences sub-graphs; interrupts to choose a flight and a hotel; a shared itinerary | LangGraph interrupts + shared state (inferred) | `useLangGraphInterrupt`, `useAgent` | no (LangGraph, MS Agent Framework .NET, Antigravity) |
| `deepagents_subagents` | A collapsible sub-agent card (pulsing dot → check or red mark) grouping the sub-agent's messages; an Approve/Reject raised inside the sub-agent | `SUBAGENT_STARTED / FINISHED / ERROR` + `subagentRunId` on messages; opt-in `emit_subagent_events=True` "because released clients reject the `SUBAGENT_*` event types outright" | `useAgent`, `useInterrupt` | no (LangGraph FastAPI only) |
| `multi_agent` | Pipeline cards researcher → analyst → writer moving Waiting → Running → Done, handoff rows, each node's text streaming | `STEP_STARTED / STEP_FINISHED` named `<nodeType>:<nodeId>`; CUSTOM `MultiAgentHandoff` | `useAgent` | no (AWS Strands, ADK-JS) |
| `background_agents` | A distinct "Background Task" card with live progress while the chat continues | `ACTIVITY_SNAPSHOT / ACTIVITY_DELTA` (`activityType: "mastra-background-task"`), custom `renderActivityMessages` | — | no (Mastra local) |
| `observational_memory` | An "Observational Memory" card as memory is compressed in the background | `ACTIVITY_*` (`mastra-observational-memory`) | — | no (Mastra) |
| `a2ui_fixed_schema` | Flight cards from a fixed A2UI schema, with a Select action | A2UI surfaces through `@ag-ui/a2ui-middleware` | `@copilotkit/a2ui-renderer` | no |
| `a2ui_dynamic_schema` | A UI generated by a second LLM from the conversation, streaming in with a progress indicator | A2UI, `render_a2ui` tool | same | no |
| `a2ui_advanced` | Dynamic A2UI with a custom progress renderer and frontend action handlers | A2UI | `useRenderTool` | no |
| `a2ui_recovery` | An invalid generated surface never paints; it is regenerated, or a clean failure state shows | A2UI validation + `a2ui_recovery` activity | same | no |
| `error_flow` | A banner with the run's error code and message | `RUN_ERROR` | `useAgent` (`onRunErrorEvent`) | no (CrewAI) |
| `crew_chat` | Chat with a CrewAI crew | CrewAI dict-state path | — | no (CrewAI) |
| `a2a_chat`, `vnext_chat` | Chat with A2A agents through AG-UI middleware | `@ag-ui/a2a`, `@ag-ui/a2a-middleware` | CopilotKit | no (integrations `a2a`, `a2a-basic` in `agents.ts`, not in `menu.ts`) |

Pydantic AI's Dojo entry (`menu.ts` and `agents.ts` lines 113–128): `agentic_chat`, `agentic_chat_multimodal`, `v1_agentic_chat`, `backend_tool_rendering`, `human_in_the_loop`, `agentic_generative_ui`, `shared_state`, `tool_based_generative_ui`; `predictive_state_updates` commented out. The hosted Dojo (`https://dojo.ag-ui.com/pydantic-ai`, crawled 2026-10-11) lists seven demos: Agentic Chat, Backend Tool Rendering, Human in the loop, Agentic Generative UI, Tool Based Generative UI, Shared State, Agentic Chat Multimodal. The Dojo's Pydantic AI server (`integrations/pydantic-ai/python/examples/server/__init__.py`) serves each agent with `AGUIAdapter.dispatch_request(request, agent=…)` on `pydantic-ai-slim[openai,ag-ui]>=2,<3` and builds a fresh `StateDeps` per request because "dispatch_request writes the request's state into deps.state".

---

## 4. Pydantic AI's own AG-UI examples (`examples/pydantic_ai_examples/ag_ui/`, v2.55.0)

One FastAPI app mounting seven Starlette sub-apps (`__init__.py`), each `AGUIAdapter.dispatch_request(request, agent=agent)` on `POST /`; run with `python -m pydantic_ai_examples.ag_ui` on port 9000 and view through a local Dojo at `http://localhost:3000/pydantic-ai` (`__main__.py`, `docs/examples/ag-ui.md`). All agents use `openai:gpt-5-mini` with the `Caching()` capability.

| Example (`api/…`) | Agent code | AG-UI features exercised |
| --- | --- | --- |
| `agentic_chat.py` | `@agent.tool_plain current_time(timezone)` | Text streaming; a backend tool; a frontend tool from the client (`background`, per the docs page) mixed with it in one run |
| `human_in_the_loop.py` | Instructions only; the step tool is the client's `generate_task_steps` | Frontend tool as human-in-the-loop; the user's choice returns as the tool result |
| `tool_based_generative_ui.py` | Bare agent | A frontend tool (`generate_haiku`) rendered as UI |
| `agentic_generative_ui.py` | Tools `create_plan` → returns `StateSnapshotEvent`; `update_plan_step` → returns `StateDeltaEvent` (JSON Patch ops) | Tools returning AG-UI events, which the adapter forwards into the stream; state-driven progress UI |
| `shared_state.py` | `deps_type=StateDeps[RecipeSnapshot]`; tool `display_recipe` → `StateSnapshotEvent`; `@agent.instructions` reads `ctx.deps.state` | Two-way shared state (client state in, snapshot out); per-request `replace(deps)` because `dispatch_request` mutates `deps.state` |
| `predictive_state_updates.py` | `StateDeps[DocumentState]`; tool `document_predict_state` → `CustomEvent(name="PredictState", value=[{state_key: "document", tool: "write_document", tool_argument: "document"}])` | CUSTOM events; predictive state from streamed tool arguments; a frontend confirm tool (`write_document`) |
| `tool_approval.py` | `output_type=[str, DeferredToolRequests]`; `@agent.tool_plain(requires_approval=True) delete_file(path)` | **AG-UI interrupts**: the adapter ends the run with `RUN_FINISHED` `outcome.type == "interrupt"`; the client renders approval from `outcome.interrupts[]` and posts a new run input with `resume[]` to "approve, deny, or edit the call"; "Requires `ag-ui-protocol >= 0.1.19`" (module docstring) |

Notes (facts): `tool_approval` exists in Pydantic AI's examples but is not wired into the Dojo's Pydantic AI menu, whose `tool_approval` page is Mastra-only. Multimodal is in the Dojo's Pydantic AI server but not in Pydantic AI's own examples. Pydantic AI's adapter package has an `_interrupt.py`, `_multimodal.py` and two thinking modules (`_thinking_0_10.py`, `_thinking_0_11.py`) (`pydantic_ai_slim/pydantic_ai/ui/ag_ui/`, repository tree), which the other note covers.

What a spike agent should cover **(opinion, derived from the two lists)**: one Pydantic AI agent (or a few on one FastAPI app) exercising (1) text + reasoning streaming, (2) a backend tool with a custom result card, (3) a frontend tool (`ask_user`-style choice) answered in the chat, (4) a `requires_approval=True` tool through the interrupt outcome and `resume[]`, including Reject, (5) `STATE_SNAPSHOT` / `STATE_DELTA` driving a plan/to-do card, (6) a multimodal user message, (7) a run error, and (8) history re-sent on a second turn and after a page reload from the hub's store. Predictive state, A2UI, activities, sub-agents and citations can wait: Pydantic AI's Dojo entry does not show them, and the sub-agent events are opt-in elsewhere.

---

## 5. What the hub should borrow / avoid

Facts are stated with their source above; every recommendation here is **(opinion)**.

**Borrow**

1. **Store the turn as ordered parts.** The template stores flat columns and reconstructs order wrongly on reload (`conversation-to-chat.ts`); agenticos fixed it with `messages.parts` JSONB plus a database `ordinal` (`conversation.py`). The hub's provider-neutral conversation store should keep the ordered parts (text, reasoning, tool call + result, interrupts/approvals, state snapshots if shown) and an explicit order column, not rely on `created_at`. AG-UI's own message list (assistant messages with tool calls, tool messages, reasoning, activity) is a ready shape to store.
2. **Keep the agent stateless and send the full history.** Both vstorm projects replay text only and lose tool calls and results; AG-UI's run input carries the whole message list, and Pydantic AI's adapter converts it. The hub, holding the history, can send the full structured history each run, which neither vstorm project does.
3. **One tool table keyed by tool name, with a generic fallback.** agenticos's `lib/tool-catalog.ts` (icon, live caption, result renderer in one row, a test keeping it in sync) over the template's hard-coded ternaries. In the hub: a registry map consumed by Ant Design X's message `contentRender`, so a tool with no entry still renders as a generic card with raw args and result. CopilotKit's `useRenderTool({name, render})` in the Dojo is the same idea.
4. **Approvals as durable, standard pauses.** agenticos's rules are good product rules: the approved arguments are what runs, a refusal comes back to the model as tool output, a surface that cannot ask refuses, and the card is Approve/Reject with read-only arguments (the template's editable JSON box was dead weight). Over AG-UI this maps onto Pydantic AI's `requires_approval=True` → interrupt outcome → `resume[]` (section 4), so the hub needs no custom approval protocol; whether the hub also records decisions (who, when) for audit is a hub-side choice.
5. **A server-side agent registry behind the hub's own route.** The Dojo's shape (browser → Next.js Route Handler → registry of `HttpAgent`s by id) is the hub's shape already (ADR-0023's per-app server routes, `visibleTo` access). The hub's version: the app row holds the agent URL and secret, the Route Handler checks the session and grants, then forwards the run input and streams the SSE back. CopilotKit's runtime is not needed for this.
6. **Plans and to-dos from shared state, sub-agents in their own blocks.** The template's sticky plan panel above the composer and agenticos's delegation panel (one block per sub-agent, never mixed into the parent's text) are the UX to copy; on AG-UI the plan comes from `STATE_SNAPSHOT`/`STATE_DELTA` (Dojo `agentic_generative_ui`) and sub-agents from `SUBAGENT_*` or `STEP_*` events where a framework emits them.
7. **Use the Dojo as the acceptance list.** The seven hosted Pydantic AI demos plus Pydantic AI's `tool_approval` example are a concrete "done" list for the hub's AG-UI chat, and the Dojo's per-integration Playwright specs with a mocked LLM (`@copilotkit/aimock`) mirror the hub's own e2e approach (stub server, ADR-0010).

**Avoid**

1. **A home-made event protocol.** Both vstorm projects carry their own WebSocket vocabulary, and agenticos's `chat.ts` comments record the drift (types that described frames nobody sent, two vocabularies for one subsystem). AG-UI removes that class of bug for the hub, and ADR-0002 points the same way.
2. **Pauses held in server memory on a socket.** The template's `ask_user` blocks an `asyncio.Future` until the same WebSocket answers; a reload or a dropped connection loses the run. AG-UI's frontend tools and interrupt outcome end the run and resume with a new request, which suits the hub's stateless HTTP proxy.
3. **Persisting only after the run ends, with fake timings.** The template writes the assistant turn and its tool calls after completion with `started_at = now()`, and drops stopped turns entirely. The hub should save what streamed, including partial and stopped turns, marked as such.
4. **Framework-per-deployment and copy-pasted sessions.** The template's five near-identical `AgentSession` classes are what a protocol boundary avoids; the hub talks AG-UI to every agent and leaves the framework to the agent's own service.
5. **Fronting agenticos as a provider.** It is a competing hub with its own login, groups and protocol (section 2); revisit only if it exposes AG-UI.
6. **CopilotKit as the UI.** The Dojo is built on it end to end, so its demos show the behaviour, not a component choice for the hub; the owner already weighed CopilotKit against ADR-0008/0017 (antd X stays). Each Dojo feature still needs an antd X equivalent chosen with the owner (memory `owner-picks-ui-components`).
