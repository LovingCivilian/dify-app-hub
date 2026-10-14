# Part 2b: Human in the Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AG-UI agent can stop and ask the user, and the hub's chat answers it: Approve or Reject on a gated tool call, the hub's own `ask_user` question card, a form or Yes/No for any other interrupt, with the composer blocked until every open item is answered; the agent's plan shows in a panel above the composer and its activity messages as cards in the turn.

**Architecture:** The server already accepts `answers` (2a, plan call P3); 2b makes the open items complete and exact: the open interrupts of the run being continued (the newest run the agent actually started, decision 62) plus the unanswered calls to the hub's `ask_user` tool, which the AG-UI adapter advertises in `RunAgentInput.tools` while the app's `askUser` switch is on. The answers check validates each resume payload against the interrupt it answers (an approval payload built from the interrupt's own `responseSchema`, a bare boolean for a schema-less `confirmation`, a flat-schema form) and turns `ask_user` answers into `tool` messages; a run the agent refuses before its stream is stored failed with `beforeStream` and withdraws the answers it carried, so the items stay open. In the browser, `useSharedChat` derives the open items from the last turn, collects one decision per item in its side store, and sends them all at once through `onReload` when the last one is in; the cards are the gated call's ThoughtChain footer, an `ask_user` stepper above the composer (the full-stack template's), and an antd `Card` per other interrupt. Two pure client-safe modules, `lib/chat/ask-user.ts` and `lib/chat/interrupt-answers.ts`, hold every rule the browser and the server share.

**Tech Stack:** Next.js 16.3 (Route Handlers, Server Actions), React 19.2, antd 6.6.5 (`Card`, `Form`, `Input`, `InputNumber`, `Radio.Group`, `Switch`, `Button`, `Tag`, `Collapse`, `Steps`, `Progress`, `Descriptions`, `Typography`, `Alert`) and Ant Design X 2.9 (`ThoughtChain` item `footer`, `Prompts`, `CodeHighlighter`, `useXChat` `onReload`, XRequest `callbacks`), `@ag-ui/client`/`@ag-ui/core` 1.0.2 (already installed; `buildResumeArray`, `isInterruptExpired`, `InterruptSchema`), zod 4.6.5, Drizzle ORM on PostgreSQL 18 (no migration in 2b), Vitest 4 (projects `unit`, `db`; node environment), Playwright 1.63 (three projects; the stub on 5399 gains the human-in-the-loop scenarios).

**Spec:** `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` (owner-approved 2026-10-14, decision 56), slice 2b: §6, with 2b's rows in §1, §2.2, §8, §10, §11 and §12. Read its §0 first. Running record: `docs/superpowers/research/2026-10-11-provider-hub/README.md`, decisions 40–62 (62 holds the owner's four answers for this plan). Research: `…/part2-hitl-state-files.md` (ask-user, approvals across frameworks, shared state), `…/part2-x-mapping.md` §4 and Implications B and D (X components per element; interrupts in `useXChat`), `…/agui-spike.md` (Findings › Browser side: approvals, ask-user and `input_required` continue one turn through `onReload`; Appendix B's stub scenarios). The 2a plan, `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md`, describes the code 2b extends (its Shared contracts), and the 2a handoff `docs/superpowers/handoffs/2026-10-14-part-2a-built-start-2b-plan.md` the lessons this plan applies.

## Global Constraints

- **Branches.** This plan merges on its own `docs/part-2b-plan` PR first (spec §0, decision 33). The build then runs on `feat/agui-hitl`, branched from `fork/overhaul` after that merge, in `~/repos/dify-app-hub` itself (no worktree; owner, 2026-10-12). `nvm use` first (Node 22). Nothing is pushed until a task or the owner says so; the PR targets `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`). A problem the owner's browser check of 2a finds is fixed on its own `fix/` branch to `fork/overhaul` (decision 61), never on `feat/agui-hitl`; if such a fix merges while 2b is built, `feat/agui-hitl` merges `fork/overhaul` in before its gates.
- **Commits.** Conventional (`feat|fix|refactor|test|docs|chore(scope): …`), English, `git add <paths>`, never `-A`. Each message ends, after a blank line inside the same `-m`, with `Co-Authored-By: <the implementer's model> <noreply@anthropic.com>` (the plan's commands show `Claude Opus 5.5`; an implementer on another model writes its own name: the owner keeps the mixed per-model trailers, 2026-10-12), then the `Claude-Session:` line the build session supplies (CLAUDE.md: commits carry the attribution trailers the session supplies).
- **ADR-0002.** Documented approaches only, a source per non-obvious choice in a comment, as the surrounding code does. Before using an API, check it against every source AGENTS.md names: the repo's docs, Next's bundled docs (`node_modules/next/dist/docs/`), the library's own skill or CLI (`npx -y @ant-design/cli info|doc <Component> --version 6.6.5`, the X skills and `node_modules/@ant-design/x/es/**/*.d.ts`), Context7, crawl4ai. The facts this plan relies on are cited where they are used.
- **Gates before each commit (AGENTS.md):** `pnpm exec next typegen && pnpm exec tsc --noEmit` (tsc checks `__tests__/` and `e2e/` too: every test file is type-checked, the 2a handoff's first lesson), `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --check <changed files>`, `pnpm test`. A task that touches `lib/data/` also runs `pnpm test:db`. A task that names e2e specs runs them. UI tasks keep `npx -y @ant-design/cli lint ./ --format json` at `"total": 0` (the ratchet in `docs/frontend-conventions.md`).
- **One heavy process at a time** (~5 GB RAM): one `next dev` per checkout (stop `pnpm dev` before `pnpm test:e2e`); `pnpm test:db` and `pnpm test:e2e` share the e2e PostgreSQL on 127.0.0.1:5433 and never run together; a full e2e run takes about 32 minutes, so it runs in the background. After an e2e run, a stale `.next/dev/types` breaks tsc: `rm -rf .next/dev/types && pnpm exec next typegen`. The owner's local stack (`ai-app-hub-local`, port 5300) is touched only by Task 19's Docker gate.
- **No migration and no new dependency in 2b.** Decision 62 keeps the refusal flag inside the `error` jsonb and reads `ask_user` from the app's current switch, so no column changes; spec §6.3 adds no form library. A task that finds it needs either stops and asks.
- **The browser bundle carries no `@ag-ui/client` or `@ag-ui/encoder` runtime** (spec §9): client-safe modules (`lib/chat/ask-user.ts`, `lib/chat/interrupt-answers.ts`, `lib/chat/plan-state.ts`, `lib/chat/open-items.ts`, `lib/chat/turn.ts`, `components/**`) import `@ag-ui/core` with `import type` only, and never `@ag-ui/client`; the server modules keep using `@ag-ui/client`'s `buildResumeArray` and `isInterruptExpired`.
- **The agent contract (spec §2.3) is unchanged** except `RunAgentInput.tools`: `[ASK_USER_TOOL]` while the app's `askUser` is on, `[]` otherwise (spec §6.2).
- **Answers (spec §4.2, §6):** the run body's `answers` is `{ resume?: [{ interruptId, status: 'resolved' | 'cancelled', payload?: object | boolean }], toolResults?: [{ toolCallId, content ≤ 32,000 }] }` (plan call P6 adds `boolean`). The server rebuilds `resume[]` with `buildResumeArray`, refuses anything that does not cover every open item exactly once, names an unknown or answered item, resolves an expired interrupt, or carries a payload `payloadAccepted` refuses: 400 `answers_invalid`. A message while anything is open: 409 `answer_pending` (decision 50). No new error code.
- **Decision 62 (the owner's four answers, 2026-10-14):** (1) an answering run the agent refuses before its stream keeps the items open: stored failed with `error.beforeStream: true`, its answer messages withdrawn, the open items read from the newest run without that flag; (2) the generic form understands types and bounds (the keyword list in plan call P7); (3) the answers go when the last open item has one, and a recorded decision can be changed until then; (4) a pending `ask_user` call counts while the app's switch is on now; answered calls always render.
- **Decision 50:** while any approval, question or interrupt is open the Sender is disabled with a visible hint, and every card has a way out (Reject, Skip/Dismiss, Cancel, No, or Dismiss for an expired one).
- **Every text renders as text** (spec §6.4): agent-supplied strings (questions, options, messages, activity content, schema titles) go into React text nodes or antd props that render text, never HTML.
- **Browser (spec §5):** `components/shared-chat/` only; `components/chat/**` is the Dify chat and behaves exactly as before, except Task 9's fix for #68 in its hook, which changes no visible behaviour (its e2e specs stay green). X status (transport) and the turn's run outcome stay separate layers.
- **i18n (ADR-0005):** every new text is a key in `locales/{en,zh,ar}/translation.json` (Arabic in Modern Standard Arabic), the full texts are in each task; no plural keys (Arabic has six forms); icon-only buttons are named by keys, which the e2e locators use; when a string changes, `e2e/` is searched for the old text; `i18next-cli extract`/`sync` are never run.
- **Tests:** unit tests run in Vitest's node environment (no DOM), so the cards keep their logic in pure `.ts` modules that the unit suite covers; browser behaviour is proven by the e2e suite on `desktop-light`, `desktop-dark` and `mobile-light`; every Dify spec and every 2a AG-UI spec stays green. Spec prompts avoid the stub's scenario keywords (Task 16's list).
- **Never** read or print `.env` or `.env*.local`; never send an email address to any service other than this app.
- Line numbers are those of `fork/overhaul` at `e8530dcc` unless a step says "as of Task N"; the quoted text decides. A step that says "replace the whole of" a file gives its complete new content. The plan file is formatted by oxfmt (lint-staged), which formats its code blocks too and can strip the leading tabs of a fragment quoted from inside a function: find each "replace" fragment by its text and keep the indentation of the lines it replaces.

**User decisions (already made):**

- The plans are written one slice at a time, each against the code as it stands then (record decision 33; decision 51: "One spec, three PRs"); this plan is written against `e8530dcc`, 2a's merge (decision 61).
- Human in the loop is 2b's slice: tool approvals, ask-user questions, other interrupts, the plan panel and activity cards (owner, 2026-10-14; decisions 41, 51).
- Ask-user follows the full-stack template, advertised by the hub as a frontend tool, a per-app switch off by default (owner, 2026-10-14: "Template's design, hub-advertised"; decision 46).
- Shared state: the template's plan panel when the state reads as `steps: [{description, status}]`, activity messages as read-only cards, no state editing by users (owner, 2026-10-14; decision 47).
- An open approval, question or interrupt blocks the composer, and every card has a way out (owner, 2026-10-14: "Block until answered"; decision 50).
- An answer that never reaches the agent keeps its item open (owner, 2026-10-14: "Keep it open (Recommended)", after "can you explain it in laymans terms for me"; decision 62).
- The generic interrupt form understands types and bounds (owner, 2026-10-14: "Types and bounds (Recommended)"; decision 62).
- The answers go when the last open item is answered (owner, 2026-10-14: "When the last is answered (Recommended)"; decision 62).
- A pending `ask_user` call follows the app's current switch, as CopilotKit, assistant-ui and the template do; answered cards always stay (owner, 2026-10-14: "The app's current switch (Recommended)", after "what does refrenc projetc do about thsi?" and "does this mean if i change a switch from on to off, and go back to a hsitory, it removes that cards?"; decision 62).
- Every choice is backed by docs, best practice and reference projects (owner, 2026-10-14: "follow docs, best oractiers, and refrense other projetcs", and for this plan: "follow docs and standard, use context7 and crawl4ai, and refrench projects where there is a gap in info"; decision 43).
- Feature branches run in `~/repos/dify-app-hub` itself, no worktree (owner, 2026-10-12); commits keep the mixed per-model `Co-Authored-By` trailers (owner, 2026-10-12).

## Plan calls (where the spec is silent; for the owner's review of this plan)

- **P1. The hub's tools come from the chat adapter.** `ChatAdapter` gains `hubTools(settings): HubToolName[]` (spec §4.1: the adapter is "given … the tools"); AG-UI answers `['ask_user']` while `settings.askUser` is on. The run advertises their definitions (`hubToolDefinitions`, server-only) and the open items read the same names, so the switch is read in one place (decision 62's fourth answer).
- **P2. `ask_user`'s arguments** (spec §6.2): zod, `{ questions: [{ question, options = [], allow_custom = true }] }` with 1–10 questions, each question 1–500 characters after trimming, at most 10 options of 1–200 characters after trimming; unknown keys are dropped (zod 4 "Objects"). The tool's `parameters` is generated from that schema with zod 4's `z.toJSONSchema(askUserArgsSchema, { io: 'input' })` (the input view leaves out `additionalProperties: false`, which fits a schema that drops unknown keys), without `$schema` (AG-UI concepts › Tools: `{ type, properties, required }`), so the advertised limits are the checked ones, as the template generates its schema from its Pydantic model; each field carries the template's description through `.meta({ description })` (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21). The tool's description is the template's docstring adapted to say the call ends the agent's turn and the answers come back as its result in the next turn.
- **P3. The transcript is the template's `format_answers`**, built in the browser (`askUserTranscript`) and stored by the server as sent (≤ 32,000 characters). A free answer is at most 2,000 characters, so ten answered questions stay under the limit. A call whose arguments fail the schema shows "The agent asked an invalid question" with Dismiss; the server answers it with a `tool` message whose `error` is `invalid_arguments`, whatever content the browser sent, and the turn shows that error.
- **P4. Several `ask_user` calls in one run** are one card that steps through their questions in call order ("Question 2 of 5" counts across calls); each call gets its own transcript.
- **P5. The approval payload** (spec §6.1): the schema's first required boolean property, else its first boolean property, else `approved`; Reject adds `reason: 'Rejected by the user'` when the schema declares a string `reason`. The server accepts a resolved approval only if its payload equals one of the two payloads this rule builds.
- **P6. A `confirmation` without a `responseSchema`** shows Yes and No, which send a bare `true` or `false` (AG-UI concepts › Interrupts, reason taxonomy: "`responseSchema` optional; boolean default"); the body's `payload` accepts an object or a boolean.
- **P7. The flat-schema subset** (decision 62's second answer): the schema is `{ type: 'object', properties, required?, title?, description?, additionalProperties?: false, $schema? }`; each property is `{ type: 'string' | 'number' | 'integer' | 'boolean', title?, description?, default? }` with `minLength`/`maxLength` (string) or `minimum`/`maximum` (number, integer), or `{ enum: [strings or numbers], type?, title?, description?, default? }`. Any other keyword, a nested object or array, a `required` name that is not a property, or a `default` of the wrong type puts the schema outside the subset. Lengths count code points (JSON Schema Validation 2020-12 §6.3.1: "the number of its characters as defined by RFC 8259").
- **P8. Interrupts with no answer the hub can build** (a `responseSchema` outside the subset, or none on an interrupt that is not a `confirmation`, including `tool_call` without a `toolCallId`) show the message and Cancel only. An approval whose `toolCallId` matches no tool part in the turn renders as its own card with Approve and Reject.
- **P9. 2a's P10 revised: a call without a result at a run's success or interrupt end is `waiting`**, not `done`, live and in history: it waits for an approval, an answer, or the next run's `not_available` answer. A call still waiting from an earlier run of the turn becomes `stopped` when a later run is cancelled or fails, as history reads it. The ThoughtChain item shows an hourglass icon and no status colour (X 2.9 draws the item's index in the icon slot when it has neither a status nor an icon).
- **P10. The refused answering run** (decision 62's first answer): when the agent refuses a run before its stream (spec §4.3 step 4) or the hub fails before sending it, the run is stored `failed` with `error.beforeStream: true`, and every tool message its answers added (the `ask_user` transcripts, and the hub's error for a dismissed invalid question) is deleted in the same transaction as the run's end (`RunEnd.withdraw`, sent only when there is any); its `resume` stays on the row for the Logs (null when only questions were answered). `continuedRun` (replacing 2a's `lastRun`) is the newest run without the flag; the server's open items and the history's at-end statuses and open interrupts read it. A refused run that carried a message stays as 2a stores it (#66 stays open).
- **P11. #67:** `fallbackTurn` appends a closed error run (no id) to a turn whose last run has ended, keeping its interrupts and waiting calls, so the error shows under cards that stay answerable; an abort there leaves the turn as it was. The browser merges `ask_user` answers into the turn only when the request starts streaming (the provider's `transformParams`), so a refusal before the stream shows the questions unanswered.
- **P12. #68:** both hooks share `createQueuedSends` (`components/chat/hooks/queued-sends.ts`); a key's queued flag also clears when that key's reply ends, from XRequest's `callbacks` (x-sdk 2.9 `AbstractChatProvider.injectRequest` calls them after its own handlers, for every key, on screen or not).
- **P13. Answer drafts** live per conversation key in `useSharedChat`'s side store (spec §5.2: "the pending answers"), keyed by interrupt id or tool-call id; a decision can be changed ("Change") until the last item has one, then the hook clears the draft and sends at once. After a failed send the cards start over.
- **P14. Expiry** is judged in the browser with `@ag-ui/client`'s rule (`new Date(expiresAt) <= now`, `src/interrupts/index.ts`) copied into a client-safe `isExpired`; a clock (`useExpiryClock`) re-renders the cards when the next `expiresAt` passes. The server re-checks with `isInterruptExpired`.
- **P15. The hint (#69):** a visible secondary line above the Sender, "Answer the agent above to continue.", replaces 2a's placeholder text (`shared_chat.answer_pending_hint`, new wording in all three locales).
- **P16. The admin switch** sits in a "Conversation" section of AG-UI's form (the Dify form's `app_setting.section_conversation`), labelled "Ask the user" with a tooltip that says when to leave it off.
- **P17. The plan panel's statuses:** `pending` → `wait`, `in_progress` → `process`, `completed` → `finish`, `blocked` → `error`, any other → `wait`; "Plan 2/5" counts completed steps. **Activity content** is "flat" when it is an object whose values are strings, numbers, booleans or null (then antd `Descriptions`); anything else, or flat content whose JSON is longer than 10,240 characters, is indented JSON in `CodeHighlighter`, cut at 10,240 characters with a localised note.
- **P18. The e2e stub's 2b scenarios** live in `e2e/fixtures/stub/agui.ts` beside 2a's, picked by keywords no 2a prompt contains (Task 16's table), and a resumed run is answered from the original prompt; the seed turns `askUser` on for `AGUI_APP`, so every AG-UI e2e run advertises `ask_user`.

## File map

Each task's **Files** section is authoritative; this is the overview.

| Task | Creates | Changes most |
| --- | --- | --- |
| 1 The `askUser` switch | — | `lib/providers/agui/{schema,provider}.ts`, `components/provider-ui/agui/form-section.tsx`, locales, `__tests__/agui-schema.test.ts` |
| 2 The `ask_user` tool | `lib/chat/ask-user.ts`, `lib/chat/hub-tools.ts`, `__tests__/chat-ask-user.test.ts` | `lib/chat/statuses.ts` |
| 3 Interrupt answers | `lib/chat/interrupt-answers.ts`, `__tests__/chat-interrupt-answers.test.ts` | — |
| 4 Plan state and activity content | `lib/chat/plan-state.ts`, `components/shared-chat/activity-view.ts`, `__tests__/chat-plan-state.test.ts`, `__tests__/shared-chat-activity-view.test.ts` | — |
| 5 Turns: waiting calls and open items | `lib/chat/open-items.ts`, `__tests__/chat-open-items.test.ts` | `lib/chat/turn.ts`, `components/shared-chat/tool-chain.tsx`, `__tests__/chat-turn.test.ts` |
| 6 The store: continued run, withdrawn answers | — | `lib/data/conversations.ts`, `__tests__/db/conversations-run.db.test.ts` |
| 7 The server's open items and answers check | — | `lib/chat/{answers,schemas,thread}.ts`, `lib/chat/run.ts` (one line, until Task 8), `__tests__/chat-{answers,schemas,thread}.test.ts` |
| 8 Advertising `ask_user`, running answers | — | `lib/chat/{adapter,run}.ts`, `lib/providers/agui/chat.ts`, `__tests__/chat-run.test.ts`, `__tests__/agui-chat.test.ts` |
| 9 Queued sends in both hooks (#68) | `components/chat/hooks/queued-sends.ts`, `__tests__/chat-queued-sends.test.ts` | `components/chat/hooks/use-dify-chat.ts`, `components/shared-chat/hooks/use-shared-chat.ts` |
| 10 The browser's answers (#67) | `components/shared-chat/answers.ts`, `components/shared-chat/hooks/use-expiry-clock.ts`, `__tests__/shared-chat-answers.test.ts` | `components/shared-chat/hooks/{use-shared-chat,chat-helpers}.ts`, `components/shared-chat/provider/ag-ui-chat-provider.ts`, `components/shared-chat/shared-chat.tsx` (two lines, until Task 15), `__tests__/shared-chat-{helpers,provider}.test.ts` |
| 11 Tool cards: approvals and the `ask_user` view | `components/shared-chat/{answer-context.tsx,approval-actions.tsx,decision-note.tsx,tool-views.tsx,tool-view-data.ts,tool-views.module.css}`, `__tests__/shared-chat-tool-views.test.ts` | `components/shared-chat/tool-chain.tsx`, locales |
| 12 The `ask_user` card | `components/shared-chat/{ask-user-card.tsx,ask-user-steps.ts}`, `__tests__/shared-chat-ask-user-steps.test.ts` | locales |
| 13 The interrupt card | `components/shared-chat/{interrupt-card.tsx,interrupt-form.ts}`, `__tests__/shared-chat-interrupt-form.test.ts` | locales |
| 14 The plan panel and activity cards | `components/shared-chat/{plan-panel.tsx,activity-card.tsx}` | locales |
| 15 The chat view wiring (#69) | `components/shared-chat/shared-chat.module.css` | `components/shared-chat/{shared-chat,assistant-turn,turn-parts}.tsx/ts`, `components/shared-chat/bubble-items.ts`, locales, `__tests__/shared-chat-view.test.ts` |
| 16 The e2e stub's scenarios | — | `e2e/fixtures/stub/{agui,agui-apps}.ts`, `e2e/auth.setup.ts`, `__tests__/stub-agui.test.ts` |
| 17 The e2e specs | `e2e/agui-hitl.spec.ts` | `e2e/agui-admin.spec.ts`, `e2e/screenshots.spec.ts` |
| 18 Records | — | `docs/decisions/{0017,0033,0034}-*.md`, `docs/agui-agents.md`, `AGENTS.md`, spec §0, running record |
| 19 Gates | — | — (the Docker gate on the owner's local stack) |

## Cross-task ordering

The tasks run in order, 1 to 19. These dependencies are why, and each timing rule has its own test (the 2a reviews' main catches were orderings: the 2a handoff's second lesson).

| Rule | Where | Test |
| --- | --- | --- |
| Task 2's names and limits exist before Tasks 5, 7, 8, 10, 11 and 12 import them; Task 3's before 7, 10, 11 and 13; Task 4's before 14 | the modules' imports | tsc |
| Task 5 widens `ToolStatus` with `waiting`, so it updates `tool-chain.tsx`'s exhaustive status map (no status, an hourglass icon) in the same commit; Task 11 later moves the item views into `tool-views.tsx` and adds the approval footer | `components/shared-chat/tool-chain.tsx` | tsc (a `Record<ToolStatus, …>` missing a key fails) |
| Task 6 renames `lastRun` to `continuedRun` before Task 8's `run.ts` calls it, and `RunError.beforeStream` before Task 8 writes it | `lib/data/conversations.ts` | tsc; `pnpm test:db` |
| A refused answering run is stored (failed, `beforeStream`, answers withdrawn) before it leaves `activeRuns` and before the envelope answers (2a's rule kept) | Task 8, `streamRun` | `chat-run.test.ts`: `finishRun` resolves before `activeRuns.has(runId)` turns false |
| `withdraw` deletes only this run's rows, in the transaction that ends the run, so no request sees the run ended with its answers still stored | Task 6, `finishRun` | `conversations-run.db.test.ts` |
| The open items are read after `reconcileStaleRun` and before `startRun`; `startRun`'s row lock refuses a second answering run with 409 `run_in_progress`, and once the first has run the second's answers name nothing open (400) | Task 8, `runTurn` | `chat-run.test.ts` (order of the DAL calls); `conversations-run.db.test.ts` (2a's lock test) |
| The browser merges `ask_user` answers into the turn in `transformParams` (when the request starts), never in `requestPlaceholder`, so a refusal before the stream leaves the questions open | Task 10, `AgUiChatProvider` | `shared-chat-provider.test.ts` |
| The draft is cleared before `onReload` is called, and `answer` ignores calls while a request runs, so one decision never sends twice | Task 10, `useSharedChat.answer` | `shared-chat-answers.test.ts` (`decide` returns `send` once, then `ignore`) |
| Task 9 changes `use-shared-chat.ts` before Task 10 does; Task 10's steps quote it as of Task 9 | `components/shared-chat/hooks/use-shared-chat.ts` | — |
| Tasks 11–14 build cards that read `TurnAnswersContext` (Task 11); Task 15 provides it and places them | `components/shared-chat/` | tsc; Task 17's e2e |
| Task 16's stub before Task 17's specs; Task 17 before Task 18's records; Task 19 last | — | — |

## Shared contracts

These names, types and signatures are binding across tasks: a task that defines one writes it exactly as here; a task that uses one imports it from here. Comments in the real files follow the surrounding code's style; the comments below say what each piece is for.

### Settings and the hub's tools (Tasks 1, 2, 8)

```ts
// lib/providers/agui/schema.ts (Task 1) — client-safe; the settings gain one field with a zod default (spec §2.2),
// so a document 2a wrote still parses (zod 4 `.default()`).
export const aguiSettingsSchema = z.object({
	agentUrl: agentUrlSchema,
	audience: z.string().trim().min(1).max(255),
	askUser: z.boolean().default(false),
})
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
	askUser: false,
}

// lib/providers/agui/provider.ts (Task 1) — the chat DTO carries the switch (spec §2.2), never the URL, audience or secret
export type AguiChatFields = { askUser: boolean }
chatFields: (settings: AguiSettings): AguiChatFields => ({ askUser: settings.askUser })

// lib/chat/ask-user.ts (Task 2) — client-safe (zod only)
export const ASK_USER_TOOL_NAME = 'ask_user'
export const ASK_USER_MAX_QUESTIONS = 10
export const ASK_USER_QUESTION_MAX = 500
export const ASK_USER_MAX_OPTIONS = 10
export const ASK_USER_OPTION_MAX = 200
/** P3: one free answer in the card. */
export const ASK_USER_ANSWER_MAX = 2_000
// Each field also carries `.meta({ description })` (Task 2): the template's descriptions, which z.toJSONSchema copies into
// ASK_USER_TOOL.parameters (P2). The shape and the limits are these:
export const askUserArgsSchema = z.object({
	questions: z
		.array(
			z.object({
				question: z.string().trim().min(1).max(ASK_USER_QUESTION_MAX),
				options: z
					.array(z.string().trim().min(1).max(ASK_USER_OPTION_MAX))
					.max(ASK_USER_MAX_OPTIONS)
					.default([]),
				allow_custom: z.boolean().default(true),
			}),
		)
		.min(1)
		.max(ASK_USER_MAX_QUESTIONS),
})
export type AskUserArgs = z.output<typeof askUserArgsSchema>
export type AskUserQuestion = AskUserArgs['questions'][number]
/** A call's streamed arguments (JSON text) read with the schema; null when they do not parse or match (spec §6.2). */
export const parseAskUserArgs: (args: string) => AskUserArgs | null
export interface AskUserAnswer {
	answer: string
	skipped: boolean
}
export const SKIPPED_ANSWER = '(skipped)'
export const NO_ANSWER = '(no answer)'
/** The template's format_answers: "Q: <question>\nA: <answer>" per question, joined by a blank line. */
export const askUserTranscript: (
	questions: readonly AskUserQuestion[],
	answers: readonly AskUserAnswer[],
) => string

// lib/chat/hub-tools.ts (Task 2) — server-only
import type { Tool } from '@ag-ui/core'
export type HubToolName = typeof ASK_USER_TOOL_NAME
/** AG-UI 1.0 `Tool` (name, description, parameters as JSON Schema): spec §6.2, P2. */
export const ASK_USER_TOOL: Tool
export const hubToolDefinitions: (names: readonly HubToolName[]) => Tool[]

// lib/chat/statuses.ts (Task 2) — client-safe; beside 2a's STOPPED_* and UNAVAILABLE_*
/** P3: a call to ask_user whose arguments failed the schema, answered by the hub when the user dismisses it. */
export const INVALID_QUESTION_ERROR = 'invalid_arguments'
export const INVALID_QUESTION_CONTENT =
	'The questions did not match the parameters of the ask_user tool, so the user could not answer them.'

// lib/chat/adapter.ts (Task 8) — ChatAdapter gains one method (P1)
export interface ChatAdapter<P extends ProviderId> {
	/** The hub's own tools this app advertises, read from its settings now (decision 62). */
	hubTools(settings: ProviderSettings<P>): HubToolName[]
	runTurn(/* unchanged */): ChatTurnHandle
}
// lib/providers/agui/chat.ts (Task 8)
hubTools: settings => (settings.askUser ? [ASK_USER_TOOL_NAME] : [])
```

### Interrupt answers (Task 3) — `lib/chat/interrupt-answers.ts`, client-safe, `import type { Interrupt }` only

```ts
/** Spec §6.1: added to a rejection when the schema declares a string `reason`. */
export const REJECTED_REASON = 'Rejected by the user'
/** Spec §6.1: an interrupt with reason `tool_call` and a `toolCallId` (AG-UI concepts › Interrupts, "Tool-bound interrupts"). */
export const isApproval: (interrupt: Pick<Interrupt, 'reason' | 'toolCallId'>) => boolean
/** P5: the boolean property an approval sets. */
export const approvalKey: (schema: unknown) => string
/** P5: Approve (`true`) or Reject (`false`) in the interrupt's own schema's terms. */
export const approvalPayload: (schema: unknown, approved: boolean) => Record<string, unknown>

interface FieldBase {
	name: string
	required: boolean
	title?: string
	description?: string
}
/** P7: one field of a flat responseSchema, in the order of `properties`. */
export type FlatField =
	| (FieldBase & { type: 'string'; default?: string; minLength?: number; maxLength?: number })
	| (FieldBase & {
			type: 'number' | 'integer'
			default?: number
			minimum?: number
			maximum?: number
	  })
	| (FieldBase & { type: 'boolean'; default?: boolean })
	| (FieldBase & { type: 'enum'; default?: string | number; options: (string | number)[] })
/** P7: the fields of a flat schema, or null for a schema outside the subset. */
export const flatFields: (schema: unknown) => FlatField[] | null
/** P7: only declared keys, each of its type and within its bounds, every required one present. */
export const checkFlatPayload: (fields: readonly FlatField[], payload: unknown) => boolean

/** How an interrupt is answered (spec §6.1, §6.3; P6, P8). */
export type AnswerKind =
	| { kind: 'approval' }
	| { kind: 'confirm' }
	| { kind: 'form'; fields: FlatField[] }
	| { kind: 'cancel' }
export const answerKindOf: (interrupt: Interrupt) => AnswerKind
/** P14: @ag-ui/client 1.0.2's rule (`new Date(expiresAt) <= now`), client-safe. */
export const isExpired: (interrupt: Pick<Interrupt, 'expiresAt'>, now: Date) => boolean
/** The server's check of a resolved entry: an approval's payload is one of approvalPayload's two; a confirm's a boolean; a form's passes checkFlatPayload; a cancel-only interrupt accepts none. */
export const payloadAccepted: (interrupt: Interrupt, payload: unknown) => boolean
```

### Plan state and activity content (Task 4)

```ts
// lib/chat/plan-state.ts — client-safe
export interface PlanStep {
	description: string
	status: string
}
/** Spec §6.4: the state as `{ steps: [{ description, status }] }` with at least one step (zod), or null. */
export const planOf: (state: unknown) => PlanStep[] | null
export type PlanStepStatus = 'wait' | 'process' | 'finish' | 'error'
/** P17. */
export const planStepStatus: (status: string) => PlanStepStatus
export const planProgress: (steps: readonly PlanStep[]) => {
	done: number
	total: number
	percent: number
	complete: boolean
}

// components/shared-chat/activity-view.ts — client-safe, pure
export const ACTIVITY_JSON_MAX = 10_240
export type ActivityView =
	| { kind: 'fields'; items: { key: string; value: string }[] }
	| { kind: 'json'; text: string; truncated: boolean }
/** P17: a flat object as fields while its JSON fits ACTIVITY_JSON_MAX; anything else as indented JSON, cut at ACTIVITY_JSON_MAX characters. */
export const activityView: (content: unknown) => ActivityView
```

### Turns and open items (Task 5)

```ts
// lib/chat/turn.ts (Task 5) — client-safe
export type ToolStatus = 'running' | 'waiting' | 'done' | 'error' | 'stopped'
export type ToolPart = Extract<TurnPart, { kind: 'tool' }>
// TurnRunRow.error gains the refusal flag (P10):
export interface TurnRunRow {
	id: string
	status: RunStatus
	outcome: unknown
	error: { code?: string; message: string; beforeStream?: true } | null
	custom: { name: string; value: unknown }[]
	startedAt: Date
}
// applyAgUiEvent: RUN_FINISHED and RUN_ERROR settle a call without its result (running, or waiting from an earlier run of
// the turn): `waiting` after a success or an interrupt, `stopped` after a cancel or an error, the rule turnsFromMessages
// applies (P9). A turn's runs carry `{ code?, message }` only: the refusal flag stays on the stored row.
// turnsFromMessages: a call without a tool message ends `waiting` after a success or interrupt; the at-end status and
// the last turn's interrupts come from the turn's last run without `error.beforeStream` (P10).

// lib/chat/open-items.ts (Task 5) — client-safe
/** What the conversation's last turn waits for (spec §3.3, §6): its interrupts and, while askUser is on, its waiting ask_user calls. */
export interface TurnOpenItems {
	interrupts: Interrupt[]
	questions: ToolPart[]
}
export const NO_OPEN_ITEMS: TurnOpenItems
export const openItemsOfTurn: (turn: Turn | undefined, askUser: boolean) => TurnOpenItems
export const hasOpenItems: (open: TurnOpenItems) => boolean
```

### The store and the server (Tasks 6–8)

```ts
// lib/data/conversations.ts (Task 6)
export interface RunError {
	code?: string
	message: string
	/** P10: the agent never started this run (refused before its stream, or the hub failed before sending it). */
	beforeStream?: true
}
/** P10: the newest run without `error.beforeStream` (replaces 2a's lastRun). */
export async function continuedRun(conversationId: string): Promise<StoredRun | null>
export interface RunEnd {
	status: Exclude<RunStatus, 'running'>
	outcome?: unknown
	error?: RunError
	usage?: unknown
	custom: CustomRecord[]
	close?: { messageIds: string[]; toolMessages: Message[] }
	/** P10: message ids this run carried that the agent never received; deleted with the run's end. */
	withdraw?: string[]
}

// lib/chat/thread.ts (Task 7): unansweredToolCalls also answers each call's arguments
export const unansweredToolCalls: (
	messages: readonly Message[],
) => { toolCallId: string; name: string; args: string }[]

// lib/chat/schemas.ts (Task 7): a resume payload is an object or a boolean (P6)
payload: z.union([z.record(z.string(), z.unknown()), z.boolean()]).optional()

// lib/chat/answers.ts (Task 7) — server-only
export interface OpenQuestion {
	toolCallId: string
	/** null when the call's arguments fail askUserArgsSchema (P3). */
	args: AskUserArgs | null
}
export type OpenItems = { interrupts: Interrupt[]; questions: OpenQuestion[] }
/** Spec §4.3 step 1, decision 62: the continued run's open interrupts, and the thread's unanswered ask_user calls while it is advertised. */
export const openItemsOf: (
	run: StoredRun | null,
	thread: readonly Message[],
	hubTools: readonly HubToolName[],
) => OpenItems
/** Whether anything is open (the server's twin of open-items.ts's hasOpenItems). */
export const anyOpen: (open: OpenItems) => boolean
export const checkAnswers: (
	open: OpenItems,
	answers: NonNullable<RunBody['answers']>,
	now?: Date,
) => { ok: true; resume: ResumeEntry[]; toolMessages: Message[] } | { ok: false }
```

### Browser (Tasks 9–15)

```ts
// components/chat/hooks/queued-sends.ts (Task 9) — shared by both hooks, side-effect-free
export interface QueuedSends {
	has(key: string): boolean
	add(key: string): void
	/** The key's queued send has left, or its reply ended: nothing waits for it any more. */
	clear(key: string): void
}
export const createQueuedSends: (onChange: (keys: ReadonlySet<string>) => void) => QueuedSends

// components/shared-chat/provider/ag-ui-chat-provider.ts (Task 10)
export interface ResumeAnswer {
	interruptId: string
	status: 'resolved' | 'cancelled'
	payload?: Record<string, unknown> | boolean
}
export interface ToolAnswer {
	toolCallId: string
	content: string
}
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
	answers?: { resume?: ResumeAnswer[]; toolResults?: ToolAnswer[] }
	/** The turn answers continue (x-sdk onReload): never sent; transformParams merges the tool answers into it (P11). */
	continues?: Turn
}

// components/shared-chat/answers.ts (Task 10) — client-safe, pure
export type ItemAnswer = ({ kind: 'resume' } & ResumeAnswer) | ({ kind: 'tool' } & ToolAnswer)
export interface AnswerDraft {
	resume: Readonly<Record<string, ResumeAnswer>>
	tools: Readonly<Record<string, ToolAnswer>>
}
export const EMPTY_DRAFT: AnswerDraft
export const withAnswer: (draft: AnswerDraft, answer: ItemAnswer) => AnswerDraft
/** "Change" (P13): forgets the decision for an interrupt id or a tool-call id. */
export const withoutAnswer: (draft: AnswerDraft, itemId: string) => AnswerDraft
/** With `now`, a `resolved` entry for an interrupt isExpired judges expired counts as missing (P14: its card offers Dismiss). */
export const draftCovers: (open: TurnOpenItems, draft: AnswerDraft, now?: Date) => boolean
/** The run body's answers, in the open items' order, only for open items. */
export const answersBody: (
	open: TurnOpenItems,
	draft: AnswerDraft,
	now?: Date,
) => NonNullable<SharedChatInput['answers']>
/** The ask_user answers merged into the turn: `done` with the transcript, or `error` for invalid arguments (P3). */
export const withToolAnswers: (turn: Turn, answers: readonly ToolAnswer[]) => Turn
/** What `answer` does with a decision (D3, P13): keep it, send everything, or ignore it. */
export type AnswerDecision =
	| { action: 'keep'; draft: AnswerDraft }
	| { action: 'send'; body: NonNullable<SharedChatInput['answers']> }
	| { action: 'ignore' }
export const decide: (args: {
	open: TurnOpenItems
	draft: AnswerDraft
	answer: ItemAnswer
	/** The chat's or the provider's XRequest is running (Task 10). */
	isRequesting: boolean
	/** The moment of the click (an event handler, never render). */
	now: Date
}) => AnswerDecision
/** P14: the next `expiresAt` after `now` among the interrupts, in ms since the epoch, or null. */
export const nextExpiry: (interrupts: readonly Interrupt[], now: Date) => number | null

// components/shared-chat/hooks/chat-helpers.ts (Task 10)
export const fallbackTurn: (error: Error, current: Turn | undefined) => Turn // P11
/** Replaces 2a's openInterruptsOf: the last turn's open items when it is an answer. */
export const openItemsOf: (messages: readonly MessageInfo<Turn>[], askUser: boolean) => TurnOpenItems

// components/shared-chat/hooks/use-expiry-clock.ts (Task 10)
/** P14: now, renewed when the next expiresAt among the interrupts passes. */
export const useExpiryClock: (interrupts: readonly Interrupt[]) => Date

// components/shared-chat/hooks/use-shared-chat.ts (Task 10): Options gain `askUser: boolean`; the result replaces
// `openInterrupts` with:
openItems: TurnOpenItems
draft: AnswerDraft
answer: (answer: ItemAnswer) => void
retract: (itemId: string) => void

// components/shared-chat/answer-context.tsx (Task 11)
export interface TurnAnswers {
	/** The turn that waits: the conversation's last answer while it has open items. */
	turn: Turn
	open: TurnOpenItems
	draft: AnswerDraft
	/** A request is running, or the list is not ready: the cards' buttons are disabled. */
	disabled: boolean
	now: Date
	answer: (answer: ItemAnswer) => void
	retract: (itemId: string) => void
}
export const TurnAnswersContext: React.Context<TurnAnswers | null>
/** The context when `turn` is the turn that waits, else null (React `use`). */
export const useTurnAnswers: (turn: Turn) => TurnAnswers | null

// components/shared-chat/tool-views.tsx (Task 11): spec §5.3's renderer registry, by tool name; the generic card is the fallback
export interface ToolItemView {
	title: React.ReactNode
	description?: React.ReactNode
	content?: React.ReactNode
	collapsible: boolean
}
export const toolItemView: (part: ToolPart, t: TFunction) => ToolItemView

// components/shared-chat/ask-user-steps.ts (Task 12) — pure
export interface QuestionStep {
	toolCallId: string
	/** null: the call's arguments are invalid (P3); the step offers Dismiss only. */
	question: AskUserQuestion | null
}
export const questionSteps: (calls: readonly ToolPart[]) => QuestionStep[]
/** The calls whose every step has an answer, as tool answers (askUserTranscript; '' for an invalid call), in call order. */
export const finishedCalls: (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
) => ToolAnswer[]

// components/shared-chat/interrupt-form.ts (Task 13) — pure
export const fieldRules: (field: FlatField, t: TFunction) => FormRule[] // antd's root export of Rule
/** Defaults; a boolean without one starts false (a Switch has no unset state). */
export const initialValuesOf: (fields: readonly FlatField[]) => Record<string, unknown>
/** The form's values as the payload: undefined, null (a cleared InputNumber) and blank optional strings dropped. */
export const payloadOf: (fields: readonly FlatField[], values: Record<string, unknown>) => Record<string, unknown>
/** The title's i18n key for the core reasons, typed for i18next's `t`; null: the raw reason is the title. */
export const interruptTitleKey: (reason: string) => (typeof TITLE_KEYS)[keyof typeof TITLE_KEYS] | null
/** The card's pure logic: a recorded decision (read by own key), an expired interrupt (Dismiss), or how to answer it. */
export type InterruptCardView = { kind: 'decided'; tagKey: string } | { kind: 'expired' } | AnswerKind
export const interruptCardView: (interrupt: Interrupt, draft: AnswerDraft, now: Date) => InterruptCardView
```

Components (Tasks 11–15), default exports as 2a's are: `ApprovalActions({ interrupt }: { interrupt: Interrupt })`, `AskUserCard({ questions, disabled, onAnswer }: { questions: ToolPart[]; disabled: boolean; onAnswer: (answers: ToolAnswer[]) => void })` (it calls `onAnswer` once, with every call's answer, when its last step is answered or on Dismiss; Task 15 gives it only the open questions without a drafted answer, keyed by their ids), `InterruptCard({ interrupt }: { interrupt: Interrupt })`, `PlanPanel({ steps }: { steps: PlanStep[] })`, `ActivityCard({ part }: { part: Extract<TurnPart, { kind: 'activity' }> })`; `ToolChain` keeps its props and reads `TurnAnswersContext`; `AssistantTurn` keeps its props and reads `useTurnAnswers(turn)`, which compares turns by identity. `useSharedChat`'s `answer` reads the draft from its side store when it is called (Task 15 calls it once per tool answer in one handler).

## Tasks

### Task 1: The `askUser` switch and the chat DTO

**Goal:** An AG-UI app's settings carry `askUser` (a boolean, off by default, so every document 2a wrote still reads), the admin form shows it as an "Ask the user" switch in a Conversation section, and the chat DTO carries it (never the agent URL, the audience or the secret).

Spec §2.2 (the `askUser` row: "boolean; advertise the hub's `ask_user` tool (§6.2)", default `false`, slice 2b; "Fields added by 2b and 2c carry zod defaults, so a document written by 2a still parses"; "The chat DTO carries `askUser` … never `agentUrl`, `audience` … or the secret"), spec §6.2 ("off by default: Pydantic AI fails a run whose agent already has a tool of that name"), plan call P16 (the switch's place and texts) and the Shared contracts' "Settings and the hub's tools". Docs checked: zod 4.6.5 `.default()` through Context7 (`/colinhacks/zod/v4.6.5`, "optionality": `z.object({ a: z.string().default("d") }).parse({})` gives `{ a: "d" }`; the input type makes the key optional, so `AGUI_DEFAULT_SETTINGS` keeps its `z.input` annotation); antd 6.6.5 `Switch` in a `Form.Item` with `valuePropName="checked"` (`npx -y @ant-design/cli doc Form --version 6.6.5`: "the prop of Switch or Checkbox is `checked`"), the pattern the Dify section already uses for `enableUpdateAfterConversationStarts` (`components/provider-ui/dify/form-section.tsx`). The admin actions need no change: `createValuesSchema`, `updateValuesSchema` and `connectionTestSchema` (`app/(admin)/app-management/schemas.ts`) parse `settings` with `PROVIDER_SCHEMAS.agui.settingsSchema`, and `createApp`/`updateApp` store the parsed `settings.data` (`lib/data/apps.ts`), so the switch reaches the stored document through the schema this task changes; a new app's form starts from `AGUI_DEFAULT_SETTINGS` (`providerDefaults`, `components/admin/apps/app-form-values.ts`) and an edit from the admin DTO's parsed settings, which read `askUser: false` for a 2a row. The output type gains a required `askUser: boolean`, so every test that builds typed AG-UI settings by hand gains `askUser: false` here (tsc checks `__tests__/`); Task 8 later edits two of them (`agui-chat.test.ts`, `chat-run.test.ts`) as they are after this task. Nothing reads the DTO's `askUser` yet: Task 10's `useSharedChat` does. The browser check of the switch is Task 17's and the owner's.

**Files:**

- Modify: `lib/providers/agui/schema.ts` (`askUser` in `aguiSettingsSchema` and `AGUI_DEFAULT_SETTINGS`)
- Modify: `lib/providers/agui/provider.ts` (`AguiChatFields`, `chatFields`)
- Modify: `components/provider-ui/agui/form-section.tsx` (the Conversation section)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (`app_setting.ask_user`, `app_setting.ask_user_tooltip`)
- Test: `__tests__/agui-schema.test.ts` (the whole file, below)
- Test: `__tests__/provider-registry.test.ts`, `__tests__/provider-schemas.test.ts`, `__tests__/data-apps.test.ts`, `__tests__/app-management-schemas.test.ts` (expectations that change, and new cases)
- Test: `__tests__/agui-chat.test.ts`, `__tests__/agui-test-connection.test.ts`, `__tests__/chat-run.test.ts`, `__tests__/chat-session.test.ts`, `__tests__/provider-ui.test.ts` (typed fixtures gain `askUser: false`)

**Acceptance Criteria:**

- [ ] `aguiSettingsSchema` reads a document without `askUser` with `askUser: false`, keeps `true` and `false`, and refuses `'true'`, `1` and `null`; `AGUI_DEFAULT_SETTINGS` is `{ agentUrl: '', audience: '', askUser: false }`.
- [ ] `PROVIDERS.agui.chatFields(settings)` answers `{ askUser: settings.askUser }`; `toChatAppDto` of an AG-UI app answers the common fields plus `askUser`, with no `agentUrl`, `audience` or `jwtSecret` property.
- [ ] `createAppFormSchema` and `updateAppFormSchema` carry `settings.askUser: true` from the form's JSON, and a non-boolean is refused as `{ 'settings.askUser': ['invalid_type'] }`; a 2a row's admin DTO reads `settings.askUser: false`.
- [ ] The AG-UI form shows a "Conversation settings" divider and an "Ask the user" switch bound to `['settings', 'askUser']`, with the tooltip; `app_setting.ask_user` and `app_setting.ask_user_tooltip` exist in en, zh and ar.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/i18n-locales.test.ts` → `Test Files  6 passed (6)`, `Tests  112 passed (112)`

**Steps:**

- [ ] **Step 1: Branch and Node**

The plan's own PR has merged (Global Constraints). Run:

```bash
cd ~/repos/dify-app-hub
git switch fork/overhaul && git pull --ff-only
git switch -c feat/agui-hitl
nvm use
```

Expected: `Switched to a new branch 'feat/agui-hitl'`; `nvm use` prints Node v22.

- [ ] **Step 2: Write the failing tests**

Replace the whole of `__tests__/agui-schema.test.ts` with:

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
	// 2c's attachments are a key 2b does not know yet.
	it('reads a valid document and drops keys it does not know', () => {
		expect(
			aguiSettingsSchema.parse({ ...settings, askUser: true, attachments: { images: true } }),
		).toEqual({ ...settings, askUser: true })
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

// Spec §2.2, §6.2: the switch that advertises the hub's ask_user tool, off unless the admin turns it on.
describe('the ask_user switch', () => {
	it('is off by default, so a document 2a wrote reads with it off', () => {
		expect(aguiSettingsSchema.parse(settings)).toEqual({ ...settings, askUser: false })
	})
	it('keeps the value it is given', () => {
		expect(aguiSettingsSchema.parse({ ...settings, askUser: true }).askUser).toBe(true)
		expect(aguiSettingsSchema.parse({ ...settings, askUser: false }).askUser).toBe(false)
	})
	it.each([
		['a string', 'true'],
		['a number', 1],
		['null', null],
	])('refuses %s', (_label, askUser) => {
		expect(aguiSettingsSchema.safeParse({ ...settings, askUser }).success).toBe(false)
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
	it('start with empty fields and ask_user off, which the schemas refuse until filled', () => {
		expect(AGUI_DEFAULT_SETTINGS).toEqual({ agentUrl: '', audience: '', askUser: false })
		expect(AGUI_DEFAULT_SECRETS).toEqual({ jwtSecret: '' })
		expect(aguiSettingsSchema.safeParse(AGUI_DEFAULT_SETTINGS).success).toBe(false)
		expect(aguiSecretsSchema.safeParse(AGUI_DEFAULT_SECRETS).success).toBe(false)
	})
})
```

In `__tests__/provider-registry.test.ts`, find:

```ts
describe("AG-UI's DTO fields", () => {
	it('give the chat and the gallery nothing of the agent URL or the audience', () => {
		expect(PROVIDERS.agui.chatFields()).toEqual({})
		expect(PROVIDERS.agui.summaryFields()).toEqual({})
	})
```

Replace with:

```ts
describe("AG-UI's DTO fields", () => {
	const aguiSettings = {
		agentUrl: 'http://agents:8000/agents/assistant',
		audience: 'assistant',
		askUser: true,
	}
	it('give the chat the ask_user switch only, and the gallery nothing', () => {
		expect(PROVIDERS.agui.chatFields(aguiSettings)).toEqual({ askUser: true })
		expect(PROVIDERS.agui.chatFields({ ...aguiSettings, askUser: false })).toEqual({
			askUser: false,
		})
		expect(PROVIDERS.agui.summaryFields()).toEqual({})
	})
```

In `__tests__/provider-schemas.test.ts`, find:

```ts
			documents: { provider: 'agui', settings: agui, secrets: { jwtSecret } },
```

Replace with:

```ts
			documents: {
				provider: 'agui',
				settings: { ...agui, askUser: false },
				secrets: { jwtSecret },
			},
```

In `__tests__/data-apps.test.ts`, find:

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
```

Replace with:

```ts
	// Part 2 spec §2.2: an AG-UI app's chat DTO carries the ask_user switch only, its card nothing of its documents.
	it('an AG-UI app’s chat DTO carries the ask_user switch, never the agent URL or the audience', () => {
		const agui = {
			...record,
			provider: 'agui' as const,
			settings: {
				agentUrl: 'http://agents:8000/agents/assistant',
				audience: 'assistant',
				askUser: true,
			},
		}
		const dto = toChatAppDto(agui)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'agui',
			name: 'Tea',
			description: 'desc',
			enabled: true,
			hasIcon: true,
			askUser: true,
		})
		expect(dto).not.toHaveProperty('agentUrl')
		expect(dto).not.toHaveProperty('audience')
		expect(dto).not.toHaveProperty('jwtSecret')
```

In the same file, find:

```ts
	it('carries an AG-UI app’s settings and whether its secret is set, never the secret', () => {
```

Replace with:

```ts
	// Spec §2.2: a document 2a wrote reads with ask_user off, so the edit form opens with the switch off.
	it('carries an AG-UI app’s settings and whether its secret is set, never the secret', () => {
```

and, a few lines below it, find:

```ts
			settings: agui,
			secretsSet: { jwtSecret: true },
```

Replace with:

```ts
			settings: { ...agui, askUser: false },
			secretsSet: { jwtSecret: true },
```

In `__tests__/app-management-schemas.test.ts`, find:

```ts
		expect(parsed.provider).toBe('agui')
		expect(parsed.settings).toEqual(agui.settings)
		expect(parsed.secrets).toEqual(agui.secrets)
	})
```

Replace with:

```ts
		expect(parsed.provider).toBe('agui')
		expect(parsed.settings).toEqual({ ...agui.settings, askUser: false })
		expect(parsed.secrets).toEqual(agui.secrets)
	})
	// Spec §6.2, 2b's plan call P16: the drawer's switch reaches the settings createApp and updateApp store.
	it('carry the ask_user switch into the settings, and refuse a value that is not a boolean', () => {
		const on = aguiForm({ settings: { ...agui.settings, askUser: true } })
		expect(createAppFormSchema.parse(on)).toMatchObject({ settings: { askUser: true } })
		expect(updateAppFormSchema.parse(on)).toMatchObject({ settings: { askUser: true } })
		const parsed = createAppFormSchema.safeParse(
			aguiForm({ settings: { ...agui.settings, askUser: 'yes' } }),
		)
		expect(formFieldErrors(parsed.error!)).toEqual({ 'settings.askUser': ['invalid_type'] })
	})
```

In the same file, find:

```ts
		).toEqual({ provider: 'agui', settings: agui.settings, secrets: { jwtSecret: undefined } })
```

Replace with:

```ts
		).toEqual({
			provider: 'agui',
			settings: { ...agui.settings, askUser: false },
			secrets: { jwtSecret: undefined },
		})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts`

Expected: FAIL, `Test Files  5 failed (5)`, `Tests  14 failed | 88 passed (102)`, among them `AssertionError: expected { agentUrl: '', audience: '' } to deeply equal { agentUrl: '', audience: '', …(1) }` and `AssertionError: expected {} to deeply equal { askUser: true }`.

- [ ] **Step 4: Add the field and carry it in the chat DTO**

In `lib/providers/agui/schema.ts`, find:

```ts
	/** The JWT's `aud`; it must match the agent's AGENT_JWT_AUDIENCE (spec §2.3). */
	audience: z.string().trim().min(1).max(255),
})
```

Replace with:

```ts
	/** The JWT's `aud`; it must match the agent's AGENT_JWT_AUDIENCE (spec §2.3). */
	audience: z.string().trim().min(1).max(255),
	/**
	 * Spec §6.2: advertise the hub's `ask_user` tool in every run's `tools`. Off by default, because Pydantic AI fails a
	 * run whose agent already has a tool of that name (research `part2-hitl-state-files.md`, Implications A.2); a zod
	 * default, so a document 2a wrote reads with it off (zod 4 `.default()`: a missing key takes the default).
	 */
	askUser: z.boolean().default(false),
})
```

In the same file, find:

```ts
/** What the form starts a new AG-UI app from: both fields empty, for the admin to fill. */
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
}
```

Replace with:

```ts
/** What the form starts a new AG-UI app from: both connection fields empty, for the admin to fill, and `ask_user` off. */
export const AGUI_DEFAULT_SETTINGS: z.input<typeof aguiSettingsSchema> = {
	agentUrl: '',
	audience: '',
	askUser: false,
}
```

In `lib/providers/agui/provider.ts`, find:

```ts
import type { AguiSecrets } from './schema'
```

Replace with:

```ts
import type { AguiSecrets, AguiSettings } from './schema'
```

Find:

```ts
/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): nothing in 2a; 2b adds `askUser` and 2c the
 * allowed attachment kinds. Never the agent URL, the audience or the secret.
 */
export type AguiChatFields = Record<never, never>
```

Replace with:

```ts
/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): whether the hub's `ask_user` tool is
 * advertised, which the chat reads to know a pending call waits for the user (decision 62); 2c adds the allowed
 * attachment kinds. Never the agent URL, the audience or the secret.
 */
export type AguiChatFields = { askUser: boolean }
```

Find:

```ts
	chatFields: (): AguiChatFields => ({}),
```

Replace with:

```ts
	chatFields: (settings: AguiSettings): AguiChatFields => ({ askUser: settings.askUser }),
```

- [ ] **Step 5: Give the typed fixtures the new field**

`AguiSettings` (the schema's output) now requires `askUser`, so five test files that pass hand-built settings to typed code fail tsc until they carry it. Their tests do not change.

In `__tests__/agui-chat.test.ts`, find:

```ts
	settings: { agentUrl: 'http://agents.test:8000/agents/assistant', audience: 'assistant' },
```

Replace with:

```ts
	settings: {
		agentUrl: 'http://agents.test:8000/agents/assistant',
		audience: 'assistant',
		askUser: false,
	},
```

In `__tests__/agui-test-connection.test.ts`, find:

```ts
const settings = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
```

Replace with:

```ts
const settings = {
	agentUrl: 'http://agents:8000/agents/assistant',
	audience: 'assistant',
	askUser: false,
}
```

In `__tests__/chat-run.test.ts`, find:

```ts
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a' },
```

Replace with:

```ts
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a', askUser: false },
```

In `__tests__/chat-session.test.ts` (inside `describe('RunSession behind aguiChat', …)`), find:

```ts
				settings: { agentUrl: 'http://agents.test/agents/assistant', audience: 'assistant' },
```

Replace with:

```ts
				settings: {
					agentUrl: 'http://agents.test/agents/assistant',
					audience: 'assistant',
					askUser: false,
				},
```

In `__tests__/provider-ui.test.ts`, find:

```ts
				settings: { agentUrl: 'http://agents:8000/agents/a', audience: 'a' },
```

Replace with:

```ts
				settings: { agentUrl: 'http://agents:8000/agents/a', audience: 'a', askUser: false },
```

Each of these five texts occurs once in its file.

- [ ] **Step 6: The Conversation section of the AG-UI form (plan call P16)**

In `components/provider-ui/agui/form-section.tsx`, find:

```tsx
import { Divider, Form, Input } from 'antd'
```

Replace with:

```tsx
import { Divider, Form, Input, Switch } from 'antd'
```

Find:

```tsx
/**
 * AG-UI's section of the app form (Part 2 spec §2.1, §2.2): Connection (the agent URL, the JWT audience, the JWT secret,
 * Test connection). The secret is write-only as Dify's key is (ADR-0032): required on a new app, and on an edit blank by
 * default, which keeps the stored one. The server parses the documents again.
 */
```

Replace with:

```tsx
/**
 * AG-UI's sections of the app form (Part 2 spec §2.1, §2.2): Connection (the agent URL, the JWT audience, the JWT secret,
 * Test connection) and Conversation (the hub's ask_user tool, spec §6.2). The secret is write-only as Dify's key is
 * (ADR-0032): required on a new app, and on an edit blank by default, which keeps the stored one. The server parses the
 * documents again.
 */
```

Find (the end of the component):

```tsx
					fields={CONNECTION_FIELDS}
				/>
			</Form.Item>
		</>
	)
}
```

Replace with:

```tsx
					fields={CONNECTION_FIELDS}
				/>
			</Form.Item>

			{/*
			 * 2b's plan call P16: the Dify form's Conversation section and its switch (Form.Item `valuePropName="checked"`:
			 * "the prop of Switch or Checkbox is `checked`", antd 6.6.5 Form). Not a connection field: the test ignores it.
			 */}
			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.ask_user')}
				name={['settings', 'askUser']}
				tooltip={t('app_setting.ask_user_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
		</>
	)
}
```

`app_setting.section_conversation` exists already (the Dify form's "Conversation settings"); the label and the tooltip are new.

- [ ] **Step 7: Add the two locale keys**

In each locale file, `app_setting` ends with `jwt_secret_invalid`. Add a comma after that line and the two keys after it, before the closing `},` of `app_setting`.

`locales/en/translation.json`, find:

```json
		"jwt_secret_invalid": "Enter 32 to 512 characters"
	},
```

Replace with:

```json
		"jwt_secret_invalid": "Enter 32 to 512 characters",
		"ask_user": "Ask the user",
		"ask_user_tooltip": "Offer the agent the hub's ask_user tool, so it can ask questions with suggested answers. Leave it off if the agent has its own tool named ask_user."
	},
```

`locales/zh/translation.json`, find:

```json
		"jwt_secret_invalid": "请输入 32 到 512 个字符"
	},
```

Replace with:

```json
		"jwt_secret_invalid": "请输入 32 到 512 个字符",
		"ask_user": "向用户提问",
		"ask_user_tooltip": "为智能体提供应用中心的 ask_user 工具，使其可以提出附带建议答案的问题。如果智能体已有名为 ask_user 的工具，请保持关闭。"
	},
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
		"jwt_secret_invalid": "أدخل من 32 إلى 512 حرفًا"
	},
```

Replace with:

```json
		"jwt_secret_invalid": "أدخل من 32 إلى 512 حرفًا",
		"ask_user": "سؤال المستخدم",
		"ask_user_tooltip": "يتيح للوكيل أداة ask_user الخاصة بالمنصة ليطرح أسئلة مع إجابات مقترحة. اتركه معطّلًا إذا كان لدى الوكيل أداة خاصة به باسم ask_user."
	},
```

The zh and ar texts use the words the neighbouring keys use for "hub" (应用中心, المنصة) and "agent" (智能体, الوكيل). No e2e text changes: `e2e/` has no "Ask the user".

- [ ] **Step 8: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/i18n-locales.test.ts`

Expected: PASS, `Test Files  6 passed (6)`, `Tests  112 passed (112)`.

- [ ] **Step 9: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/providers/agui/schema.ts lib/providers/agui/provider.ts components/provider-ui/agui/form-section.tsx __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/agui-test-connection.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/provider-ui.test.ts
pnpm exec oxfmt --check lib/providers/agui/schema.ts lib/providers/agui/provider.ts components/provider-ui/agui/form-section.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/agui-test-connection.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/provider-ui.test.ts
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0 (without Step 5 it reports `Property 'askUser' is missing` in the five fixture files); oxlint prints no finding; oxfmt "All matched files use the correct format"; vitest 0 failed; the antd lint `"summary": { "total": 0, … }`. No `lib/data/` file changed, so `pnpm test:db` is not needed.

- [ ] **Step 10: Commit**

```bash
git add lib/providers/agui/schema.ts lib/providers/agui/provider.ts components/provider-ui/agui/form-section.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/agui-chat.test.ts __tests__/agui-test-connection.test.ts __tests__/chat-run.test.ts __tests__/chat-session.test.ts __tests__/provider-ui.test.ts
git commit -m "feat(agui): the askUser switch in AG-UI settings and the chat DTO

An AG-UI app's settings gain askUser, a boolean off by default, so every
document 2a wrote reads with it off (zod default). The admin form shows it
as an Ask the user switch in a Conversation section, and the chat DTO
carries it, never the agent URL, the audience or the secret (Part 2 spec
§2.2, §6.2; plan call P16).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the 16 files; lint-staged runs oxfmt and oxlint on them and changes nothing.

```json:metadata
{"files": ["lib/providers/agui/schema.ts", "lib/providers/agui/provider.ts", "components/provider-ui/agui/form-section.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/agui-schema.test.ts", "__tests__/provider-registry.test.ts", "__tests__/provider-schemas.test.ts", "__tests__/data-apps.test.ts", "__tests__/app-management-schemas.test.ts", "__tests__/agui-chat.test.ts", "__tests__/agui-test-connection.test.ts", "__tests__/chat-run.test.ts", "__tests__/chat-session.test.ts", "__tests__/provider-ui.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/agui-schema.test.ts __tests__/provider-registry.test.ts __tests__/provider-schemas.test.ts __tests__/data-apps.test.ts __tests__/app-management-schemas.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["aguiSettingsSchema reads a document without askUser as askUser false, keeps true and false, refuses 'true', 1 and null; AGUI_DEFAULT_SETTINGS is { agentUrl: '', audience: '', askUser: false }", "PROVIDERS.agui.chatFields(settings) answers { askUser }; toChatAppDto of an AG-UI app carries askUser and no agentUrl, audience or jwtSecret", "createAppFormSchema and updateAppFormSchema carry settings.askUser true; a non-boolean is refused as settings.askUser invalid_type; a 2a row's admin DTO reads askUser false", "the AG-UI form shows the Conversation settings divider and an Ask the user switch on ['settings','askUser'] with its tooltip; both keys exist in en, zh and ar", "tsc exits 0, pnpm test 0 failed, oxlint and oxfmt clean, antd lint total 0"], "modelTier": "mechanical"}
```

---

### Task 2: The `ask_user` tool: arguments, transcript and definition

**Goal:** `lib/chat/ask-user.ts` (client-safe) reads an `ask_user` call's arguments with the hub's limits and writes the template's Q/A transcript, `lib/chat/hub-tools.ts` (server-only) holds the tool's AG-UI definition and `hubToolDefinitions`, and `lib/chat/statuses.ts` gains the invalid question's answer.

Spec §6.2 (the template's name and schema, "Arguments are untrusted", the Q/A transcript, the description "adapted to say the answers come back in the next turn"), plan calls P1 (the hub's tools by name), P2 (the zod limits, the JSON Schema with the template's field descriptions) and P3 (the transcript is the template's `format_answers`; a free answer is at most 2,000 characters; the invalid question's error), and the Shared contracts' "Settings and the hub's tools". Sources: the full-stack template at release 0.2.21 (`tmp/refs/fsat`, tag `0.2.21`): `backend/app/agents/tools/ask_user_tool.py` (`MAX_QUESTIONS = 10`, `QuestionItem`'s field descriptions, `format_answers`) and `backend/app/agents/assistant.py` lines 431–448 (the tool's docstring); AG-UI 1.0 "Tool Calls" › Frontend tools ("The `tools` list in run input is the application's: the agent proposes a call, the application executes it"; "the answer can only cross a run boundary"); `@ag-ui/core` 1.0.2 `Tool` (`dist/version-DEKfpZNa.d.ts`: `name`, `description`, `parameters?: any`, "A JSON Schema describing the tool's arguments. Carried opaquely"); AG-UI concepts › Tools ("Tool Structure": `parameters` is `{ type: "object", properties, required }`). zod 4.6.5 through Context7 (`/colinhacks/zod/v4.6.5`, "JSON Schema"): `z.toJSONSchema(schema, { io: "input" })` ("When converting to JSON Schema in `"input"` mode, `additionalProperties` is not set") and `.meta({ description })`, whose metadata `z.toJSONSchema` copies; `node_modules/zod/v4/core/checks.js` `$ZodCheckMaxLength`: "Strings are measured in Unicode code points, not UTF-16 units", which is JSON Schema's `maxLength` rule too. The tool's parameters are generated from the zod schema, as the template's are generated from its Pydantic model, so the advertised limits are the checked ones. Nothing imports these modules yet: Tasks 5, 7, 8, 10, 11 and 12 do.

**Files:**

- Create: `lib/chat/ask-user.ts`
- Create: `lib/chat/hub-tools.ts`
- Modify: `lib/chat/statuses.ts` (two constants at the end)
- Test: `__tests__/chat-ask-user.test.ts`

**Acceptance Criteria:**

- [ ] `parseAskUserArgs` answers the arguments with `options: []` and `allow_custom: true` filled in, the strings trimmed and unknown keys dropped; it answers null for 0 or 11 questions, a 501-character question, 11 options, a 201-character option, a blank question or option, text that is not JSON, and JSON that is not an object of questions; 500 emoji count as 500 characters.
- [ ] `askUserTranscript` writes `Q: <question>\nA: <answer>` per question joined by `\n\n`, with the answer trimmed, `(skipped)` for a skipped question, `(no answer)` for a blank or missing answer; ten 500-character questions with ten 2,000-character answers stay within `MESSAGE_TEXT_MAX`.
- [ ] `ASK_USER_TOOL` is `{ name: 'ask_user', description, parameters }` whose parameters are the JSON Schema the test spells out (limits, the template's descriptions, defaults, no `$schema`, no `additionalProperties`); `hubToolDefinitions(['ask_user'])` is `[ASK_USER_TOOL]`, `hubToolDefinitions([])` is `[]`.
- [ ] `INVALID_QUESTION_ERROR` is `'invalid_arguments'` and `INVALID_QUESTION_CONTENT` the contract's sentence.
- [ ] `lib/chat/ask-user.ts` imports zod only (no `@ag-ui/*`); `lib/chat/hub-tools.ts` starts with `import 'server-only'`.
- [ ] tsc, oxlint, oxfmt clean on the four files; `pnpm test` 0 failed.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-ask-user.test.ts` → `Tests  29 passed (29)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/chat-ask-user.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	ASK_USER_ANSWER_MAX,
	ASK_USER_MAX_OPTIONS,
	ASK_USER_MAX_QUESTIONS,
	ASK_USER_OPTION_MAX,
	ASK_USER_QUESTION_MAX,
	ASK_USER_TOOL_NAME,
	askUserArgsSchema,
	askUserTranscript,
	NO_ANSWER,
	parseAskUserArgs,
	SKIPPED_ANSWER,
	type AskUserQuestion,
} from '@/lib/chat/ask-user'
import { ASK_USER_TOOL, hubToolDefinitions } from '@/lib/chat/hub-tools'
import { MESSAGE_TEXT_MAX } from '@/lib/chat/schemas'
import { INVALID_QUESTION_CONTENT, INVALID_QUESTION_ERROR } from '@/lib/chat/statuses'

const args = (value: unknown) => JSON.stringify(value)
const one = (question: Record<string, unknown>) => args({ questions: [question] })
const questions = (count: number) =>
	Array.from({ length: count }, (_, index) => ({ question: `Question ${index + 1}?` }))
const options = (count: number) =>
	Array.from({ length: count }, (_, index) => `Option ${index + 1}`)

// 2b's plan call P2: the template's names and limit, and the hub's bounds.
describe('the limits', () => {
	it('are 10 questions of 500 characters, 10 options of 200, and a free answer of 2,000', () => {
		expect(ASK_USER_TOOL_NAME).toBe('ask_user')
		expect([
			ASK_USER_MAX_QUESTIONS,
			ASK_USER_QUESTION_MAX,
			ASK_USER_MAX_OPTIONS,
			ASK_USER_OPTION_MAX,
			ASK_USER_ANSWER_MAX,
		]).toEqual([10, 500, 10, 200, 2000])
	})
})

describe('parseAskUserArgs (spec §6.2, P2)', () => {
	it('reads one question, with the template’s defaults: no options, a free answer allowed', () => {
		expect(parseAskUserArgs(one({ question: 'Which city?' }))).toEqual({
			questions: [{ question: 'Which city?', options: [], allow_custom: true }],
		})
	})
	it('trims the question and the options and keeps what is given', () => {
		expect(
			parseAskUserArgs(
				one({ question: '  Which city? ', options: [' Paris', 'Rome '], allow_custom: false }),
			),
		).toEqual({
			questions: [{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: false }],
		})
	})
	it('drops keys it does not know, at both levels', () => {
		expect(
			parseAskUserArgs(
				args({
					questions: [{ question: 'Which city?', header: 'City', multi_select: true }],
					note: 1,
				}),
			),
		).toEqual({ questions: [{ question: 'Which city?', options: [], allow_custom: true }] })
	})
	it('takes 10 questions and refuses 11, and refuses none', () => {
		expect(parseAskUserArgs(args({ questions: questions(10) }))?.questions).toHaveLength(10)
		expect(parseAskUserArgs(args({ questions: questions(11) }))).toBeNull()
		expect(parseAskUserArgs(args({ questions: [] }))).toBeNull()
	})
	// zod 4.6.5 counts code points, as JSON Schema's maxLength does: 500 emoji are 1,000 UTF-16 units.
	it('takes a question of 500 characters, counted as code points, and refuses 501', () => {
		expect(parseAskUserArgs(one({ question: 'q'.repeat(500) }))).not.toBeNull()
		expect(parseAskUserArgs(one({ question: '😀'.repeat(500) }))).not.toBeNull()
		expect(parseAskUserArgs(one({ question: 'q'.repeat(501) }))).toBeNull()
	})
	it('takes 10 options of 200 characters and refuses 11 options or 201 characters', () => {
		expect(
			parseAskUserArgs(one({ question: 'Q?', options: options(10) }))?.questions[0]?.options,
		).toHaveLength(10)
		expect(parseAskUserArgs(one({ question: 'Q?', options: ['o'.repeat(200)] }))).not.toBeNull()
		expect(parseAskUserArgs(one({ question: 'Q?', options: options(11) }))).toBeNull()
		expect(parseAskUserArgs(one({ question: 'Q?', options: ['o'.repeat(201)] }))).toBeNull()
	})
	it.each([
		['a blank question', { question: '   ' }],
		['a blank option', { question: 'Q?', options: ['Yes', '  '] }],
		['a question that is not a string', { question: 42 }],
		['options that are not strings', { question: 'Q?', options: [1, 2] }],
		['allow_custom that is not a boolean', { question: 'Q?', allow_custom: 'yes' }],
	])('refuses %s', (_label, question) => {
		expect(parseAskUserArgs(one(question))).toBeNull()
	})
	it.each([
		['text that is not JSON', '{"questions": ['],
		['an empty string', ''],
		['an array', '[]'],
		['a string', '"Which city?"'],
		['null', 'null'],
		['a number', '1'],
		['an object without questions', '{}'],
	])('answers null for %s', (_label, text) => {
		expect(parseAskUserArgs(text)).toBeNull()
	})
})

// 2b's plan call P3: the template's format_answers, character for character.
describe('askUserTranscript', () => {
	const asked: AskUserQuestion[] = [
		{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: true },
		{ question: 'How many nights?', options: [], allow_custom: true },
		{ question: 'Any wishes?', options: [], allow_custom: true },
	]

	it('writes each question and its answer, trimmed, joined by a blank line', () => {
		expect(
			askUserTranscript(asked, [
				{ answer: 'Paris', skipped: false },
				{ answer: ' 3 ', skipped: false },
				{ answer: 'A view', skipped: false },
			]),
		).toBe('Q: Which city?\nA: Paris\n\nQ: How many nights?\nA: 3\n\nQ: Any wishes?\nA: A view')
	})
	it('marks a skipped question, and a blank answer as no answer', () => {
		expect(
			askUserTranscript(asked, [
				{ answer: '', skipped: true },
				{ answer: '   ', skipped: false },
				{ answer: 'Ignored', skipped: true },
			]),
		).toBe(
			`Q: Which city?\nA: ${SKIPPED_ANSWER}\n\nQ: How many nights?\nA: ${NO_ANSWER}\n\nQ: Any wishes?\nA: ${SKIPPED_ANSWER}`,
		)
		expect([SKIPPED_ANSWER, NO_ANSWER]).toEqual(['(skipped)', '(no answer)'])
	})
	// The template's `answers[i] if i < len(answers) else {}`: a missing answer is not skipped, and blank.
	it('reads a question without an answer as no answer', () => {
		expect(askUserTranscript(asked, [{ answer: 'Rome', skipped: false }])).toBe(
			'Q: Which city?\nA: Rome\n\nQ: How many nights?\nA: (no answer)\n\nQ: Any wishes?\nA: (no answer)',
		)
	})
	// Spec §6.2: Dismiss skips the rest.
	it('writes a Dismiss as the questions after the answered ones skipped', () => {
		expect(
			askUserTranscript(asked, [
				{ answer: 'Rome', skipped: false },
				{ answer: '', skipped: true },
				{ answer: '', skipped: true },
			]),
		).toBe(
			'Q: Which city?\nA: Rome\n\nQ: How many nights?\nA: (skipped)\n\nQ: Any wishes?\nA: (skipped)',
		)
	})
	// P3: ten questions at their limit with ten free answers at theirs fit a tool result (spec §4.2: 32,000 characters).
	it('stays within a tool result’s limit at the longest', () => {
		const longest = Array.from({ length: ASK_USER_MAX_QUESTIONS }, () => ({
			question: 'q'.repeat(ASK_USER_QUESTION_MAX),
			options: [],
			allow_custom: true,
		}))
		const answers = longest.map(() => ({ answer: 'a'.repeat(ASK_USER_ANSWER_MAX), skipped: false }))
		expect(askUserTranscript(longest, answers).length).toBeLessThanOrEqual(MESSAGE_TEXT_MAX)
	})
})

describe('the tool’s definition (spec §6.2, P2)', () => {
	it('is advertised under the template’s name, and says the answers come back in the next turn', () => {
		expect(ASK_USER_TOOL.name).toBe('ask_user')
		expect(ASK_USER_TOOL.description).toMatch(
			/^Ask the user one or more questions and get their answers\.\n\n/,
		)
		expect(ASK_USER_TOOL.description).toContain('Calling this tool ends your turn.')
		expect(ASK_USER_TOOL.description).toContain('in the next turn')
	})
	// The JSON Schema the agent sees: the hub's limits, the template's descriptions, the template's defaults.
	it('states the schema’s limits and the template’s descriptions as JSON Schema', () => {
		expect(ASK_USER_TOOL.parameters).toEqual({
			type: 'object',
			properties: {
				questions: {
					description:
						'The questions to ask. Each has the question text, optional suggested `options`, and `allow_custom` (whether a free-form answer is allowed, default true).',
					minItems: 1,
					maxItems: 10,
					type: 'array',
					items: {
						type: 'object',
						description: 'One question to put to the user.',
						properties: {
							question: {
								type: 'string',
								minLength: 1,
								maxLength: 500,
								description: 'The question text.',
							},
							options: {
								type: 'array',
								items: { type: 'string', minLength: 1, maxLength: 200 },
								maxItems: 10,
								default: [],
								description: 'Optional suggested answers, shown as numbered choices.',
							},
							allow_custom: {
								type: 'boolean',
								default: true,
								description:
									'Whether the user may type a free-form answer instead of picking an option.',
							},
						},
						required: ['question'],
					},
				},
			},
			required: ['questions'],
		})
	})
	it('describes arguments the schema reads: the fewest and the most it allows', () => {
		const fewest = { questions: [{ question: 'Q?' }] }
		const most = {
			questions: Array.from({ length: ASK_USER_MAX_QUESTIONS }, () => ({
				question: 'q'.repeat(ASK_USER_QUESTION_MAX),
				options: Array.from({ length: ASK_USER_MAX_OPTIONS }, () =>
					'o'.repeat(ASK_USER_OPTION_MAX),
				),
				allow_custom: false,
			})),
		}
		expect(askUserArgsSchema.safeParse(fewest).success).toBe(true)
		expect(askUserArgsSchema.safeParse(most).success).toBe(true)
	})
})

describe('hubToolDefinitions (P1)', () => {
	it('gives the named tools’ definitions, and none for no name', () => {
		expect(hubToolDefinitions(['ask_user'])).toEqual([ASK_USER_TOOL])
		expect(hubToolDefinitions([])).toEqual([])
	})
})

// P3: the hub's answer to an invalid call, beside 2a's stopped and not-available answers.
describe('the invalid question’s answer', () => {
	it('is an error tool message the agent can read', () => {
		expect(INVALID_QUESTION_ERROR).toBe('invalid_arguments')
		expect(INVALID_QUESTION_CONTENT).toBe(
			'The questions did not match the parameters of the ask_user tool, so the user could not answer them.',
		)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-ask-user.test.ts` Expected: FAIL with `Error: Cannot find package '@/lib/chat/ask-user' imported from …/__tests__/chat-ask-user.test.ts`.

- [ ] **Step 3: The arguments and the transcript**

Create `lib/chat/ask-user.ts`:

```ts
import * as z from 'zod'

/*
 * The hub's own `ask_user` tool (Part 2 spec §6.2; decision 46): the full-stack template's tool
 * (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21), which the hub advertises as an AG-UI frontend tool while
 * the app's `askUser` is on. Client-safe (zod only): the browser reads a call's arguments and writes the transcript the
 * server stores (2b's plan calls P2, P3), the server checks the same arguments, and lib/chat/hub-tools.ts (server-only)
 * advertises the definition built from the schema below.
 */

/** The template's tool name. */
export const ASK_USER_TOOL_NAME = 'ask_user'
/** P2: the template's MAX_QUESTIONS. */
export const ASK_USER_MAX_QUESTIONS = 10
/** P2: the hub's bounds on a question and its options (spec §6.2: the arguments are untrusted; the template has none). */
export const ASK_USER_QUESTION_MAX = 500
export const ASK_USER_MAX_OPTIONS = 10
export const ASK_USER_OPTION_MAX = 200
/** P3: one free answer in the card. */
export const ASK_USER_ANSWER_MAX = 2_000

/**
 * P2: the arguments, the template's `questions: list[QuestionItem]` with the hub's limits. zod 4.6.5 measures a string's
 * length in code points (`$ZodCheckMaxLength`), as JSON Schema's `maxLength` does, so the advertised schema and this one
 * agree; unknown keys are dropped (zod 4 "Objects"). The descriptions are the template's (`QuestionItem`'s fields and the
 * tool docstring's `Args`), carried into the advertised JSON Schema by `.meta()` (zod 4 "JSON Schema": metadata), as
 * Pydantic carries the template's `Field(description=…)` into its tool schema.
 */
export const askUserArgsSchema = z.object({
	questions: z
		.array(
			z
				.object({
					question: z
						.string()
						.trim()
						.min(1)
						.max(ASK_USER_QUESTION_MAX)
						.meta({ description: 'The question text.' }),
					options: z
						.array(z.string().trim().min(1).max(ASK_USER_OPTION_MAX))
						.max(ASK_USER_MAX_OPTIONS)
						.default([])
						.meta({ description: 'Optional suggested answers, shown as numbered choices.' }),
					allow_custom: z.boolean().default(true).meta({
						description:
							'Whether the user may type a free-form answer instead of picking an option.',
					}),
				})
				.meta({ description: 'One question to put to the user.' }),
		)
		.min(1)
		.max(ASK_USER_MAX_QUESTIONS)
		.meta({
			description:
				'The questions to ask. Each has the question text, optional suggested `options`, and `allow_custom` (whether a free-form answer is allowed, default true).',
		}),
})

export type AskUserArgs = z.output<typeof askUserArgsSchema>
export type AskUserQuestion = AskUserArgs['questions'][number]

/**
 * A call's streamed arguments (JSON text) read with the schema; null when they are not JSON or do not match it (spec
 * §6.2: the arguments are untrusted; AG-UI 1.0 "Tool Calls": the arguments arrive as streamed JSON text).
 */
export const parseAskUserArgs = (args: string): AskUserArgs | null => {
	let value: unknown
	try {
		value = JSON.parse(args)
	} catch {
		return null
	}
	const parsed = askUserArgsSchema.safeParse(value)
	return parsed.success ? parsed.data : null
}

/** The user's answer to one question in the card: a picked option or a free answer, or Skip. */
export interface AskUserAnswer {
	answer: string
	skipped: boolean
}

/** P3: the template's markers for a skipped question and a blank answer. */
export const SKIPPED_ANSWER = '(skipped)'
export const NO_ANSWER = '(no answer)'

/**
 * P3: the template's `format_answers`, the `tool` message's content: "Q: <question>\nA: <answer>" per question, joined
 * by a blank line; a skipped question reads "(skipped)", a blank answer "(no answer)". A question without an answer
 * counts as not skipped and blank, as the template's `answers[i] if i < len(answers) else {}` does.
 */
export const askUserTranscript = (
	questions: readonly AskUserQuestion[],
	answers: readonly AskUserAnswer[],
): string =>
	questions
		.map((question, index) => {
			const answer: AskUserAnswer | undefined = answers[index]
			const text = answer?.skipped ? SKIPPED_ANSWER : answer?.answer.trim() || NO_ANSWER
			return `Q: ${question.question}\nA: ${text}`
		})
		.join('\n\n')
```

- [ ] **Step 4: The tool's definition**

Create `lib/chat/hub-tools.ts`:

```ts
import 'server-only'

import type { Tool } from '@ag-ui/core'
import * as z from 'zod'

import { ASK_USER_TOOL_NAME, askUserArgsSchema } from './ask-user'

/*
 * The hub's own tools (Part 2 spec §6.2; 2b's plan call P1): the definitions a run advertises in
 * `RunAgentInput.tools`, the application's list (AG-UI 1.0 "Tool Calls", Frontend tools: "the agent proposes a call,
 * the application executes it"). The chat adapter's `hubTools` names those an app advertises. Server-only: only the
 * run sends them.
 */

/** The names of the hub's tools (P1). */
export type HubToolName = typeof ASK_USER_TOOL_NAME

/**
 * The template's `ask_user` docstring (`backend/app/agents/assistant.py`, release 0.2.21) adapted to AG-UI's round trip:
 * the template's run waits on its socket, while an AG-UI frontend call ends the run and its answer comes back in the next
 * run's messages (spec §6.2; AG-UI 1.0 "Tool Calls", Frontend tools: "the answer can only cross a run boundary").
 */
const ASK_USER_DESCRIPTION = [
	'Ask the user one or more questions and get their answers.',
	"Use this when a decision or missing detail would materially change what you do next and you can't reasonably assume it. You may pass several questions at once — the user answers them one after another and you get all the answers back together (good for an intake/setup flow). You can also call this again later to follow up on what they said. Prefer answering directly when the request is already clear.",
	"Calling this tool ends your turn. The user answers in the chat, and their answers come back as this tool's result when the conversation continues, in the next turn: a Q/A transcript, with skipped questions marked.",
].join('\n\n')

/*
 * The arguments' JSON Schema, generated from askUserArgsSchema (zod 4 `z.toJSONSchema`), so its limits are the ones the
 * hub checks. `io: 'input'` describes what the agent sends: `options` and `allow_custom` optional with their defaults,
 * and no `additionalProperties: false`, since the schema drops unknown keys (zod 4 "JSON Schema": "When converting to
 * JSON Schema in "input" mode, additionalProperties is not set"). The `$schema` key is left out: AG-UI's "Tool
 * Structure" (concepts/tools) is `{ type, properties, required }`, as the template's Pydantic schema is.
 */
const { $schema: _dialect, ...askUserParameters } = z.toJSONSchema(askUserArgsSchema, {
	io: 'input',
})

/** AG-UI 1.0 `Tool` (`@ag-ui/core` 1.0.2: name, description, parameters as a JSON Schema): spec §6.2, P2. */
export const ASK_USER_TOOL: Tool = {
	name: ASK_USER_TOOL_NAME,
	description: ASK_USER_DESCRIPTION,
	parameters: askUserParameters,
}

const HUB_TOOLS: Record<HubToolName, Tool> = { [ASK_USER_TOOL_NAME]: ASK_USER_TOOL }

/** The named tools' definitions in the order given (spec §6.2: `[ASK_USER_TOOL]` while askUser is on, else `[]`). */
export const hubToolDefinitions = (names: readonly HubToolName[]): Tool[] =>
	names.map(name => HUB_TOOLS[name])
```

`_dialect` is the `$schema` key taken off the generated schema; oxlint's `no-unused-vars` ignores a name that starts with `_`.

- [ ] **Step 5: The invalid question's answer**

In `lib/chat/statuses.ts`, find (the end of the file):

```ts
/** Spec §6.2's last bullet (plan call P4): a call to a tool the hub never advertised. */
export const UNAVAILABLE_TOOL_ERROR = 'not_available'
export const UNAVAILABLE_TOOL_CONTENT = 'This tool is not available here.'
```

Replace with:

```ts
/** Spec §6.2's last bullet (plan call P4): a call to a tool the hub never advertised. */
export const UNAVAILABLE_TOOL_ERROR = 'not_available'
export const UNAVAILABLE_TOOL_CONTENT = 'This tool is not available here.'
/** 2b's plan call P3: an ask_user call whose arguments failed the schema, which the hub answers on Dismiss. */
export const INVALID_QUESTION_ERROR = 'invalid_arguments'
export const INVALID_QUESTION_CONTENT =
	'The questions did not match the parameters of the ask_user tool, so the user could not answer them.'
```

- [ ] **Step 6: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-ask-user.test.ts` Expected: PASS, `Tests  29 passed (29)`.

- [ ] **Step 7: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/ask-user.ts lib/chat/hub-tools.ts lib/chat/statuses.ts __tests__/chat-ask-user.test.ts
pnpm exec oxfmt --check lib/chat/ask-user.ts lib/chat/hub-tools.ts lib/chat/statuses.ts __tests__/chat-ask-user.test.ts
pnpm test
```

Expected: tsc exits 0, no oxlint finding, oxfmt "All matched files use the correct format", vitest 0 failed.

- [ ] **Step 8: Commit**

```bash
git add lib/chat/ask-user.ts lib/chat/hub-tools.ts lib/chat/statuses.ts __tests__/chat-ask-user.test.ts
git commit -m "feat(chat): the hub's ask_user tool: arguments, transcript and definition

The template's ask_user tool for AG-UI agents: its arguments read with
zod (1-10 questions of up to 500 characters, up to 10 options of up to 200),
its Q/A transcript as the template's format_answers writes it, and its
AG-UI Tool definition, whose JSON Schema is generated from the same zod
schema with the template's descriptions (Part 2 spec §6.2; plan calls
P1-P3).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the four files; lint-staged changes nothing.

```json:metadata
{"files": ["lib/chat/ask-user.ts", "lib/chat/hub-tools.ts", "lib/chat/statuses.ts", "__tests__/chat-ask-user.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-ask-user.test.ts", "acceptanceCriteria": ["parseAskUserArgs fills options [] and allow_custom true, trims, drops unknown keys, and answers null for 0 or 11 questions, a 501-character question, 11 options, a 201-character option, a blank question or option, non-JSON and non-object text; 500 emoji count as 500 characters", "askUserTranscript writes Q:/A: per question joined by a blank line, trimmed, (skipped) and (no answer), a missing answer as (no answer); the longest transcript fits MESSAGE_TEXT_MAX", "ASK_USER_TOOL is named ask_user with the adapted description and the JSON Schema the test spells out; hubToolDefinitions(['ask_user']) is [ASK_USER_TOOL] and [] is []", "INVALID_QUESTION_ERROR is invalid_arguments and INVALID_QUESTION_CONTENT the contract's sentence", "ask-user.ts imports zod only; hub-tools.ts is server-only", "tsc, oxlint, oxfmt clean; pnpm test 0 failed"], "modelTier": "mechanical"}
```

---

### Task 3: Interrupt answers: approval payloads and the flat-schema form

**Goal:** `lib/chat/interrupt-answers.ts`, a client-safe module, answers how the hub answers any AG-UI interrupt: the approval payload in the interrupt's own schema's terms, the fields of a flat `responseSchema`, the check of a form's payload, the kind of answer an interrupt allows, its expiry, and the server's check of a resolved entry.

Spec §6.1 (approvals follow the interrupt's own `responseSchema`; expired interrupts can only be dismissed) and §6.3 (the generic form and its subset; "The server validates answers against the same subset"); plan calls P5–P8 and P14; decision 62's second answer ("Types and bounds"). One module holds the rules the browser's cards (Tasks 11 and 13) and the server's answers check (Task 7 calls `payloadAccepted`) share, so the two never disagree. Sources: AG-UI concepts › Interrupts (the reason taxonomy, "Approve with edits", contract rules 6 and 7, the quarterly-filing example under "Non-tool input request"); the research note `part2-hitl-state-files.md` §1.3 and §2 (each framework's approval schema: Pydantic AI `{ approved, editedArgs, reason }` with `approved` required, Microsoft Agent Framework `{ accepted, arguments }` with `accepted` required, AWS Strands `{ approved }` required; Mastra and ADK send none); JSON Schema Validation 2020-12 (`draft-bhutton-json-schema-validation-01`: §6.1.1 `type`, where "integer" matches "any number with a zero fractional part"; §6.1.2 `enum`; §6.2.2 and §6.2.4, inclusive `maximum` and `minimum`; §6.3.1 and §6.3.2, lengths that "MUST be a non-negative integer" counted in RFC 8259 characters, that is code points; §6.5.3 `required`; §9.2 `default`, "RECOMMENDED that a default value be valid"); and `@ag-ui/client` 1.0.2's `isInterruptExpired` (`src/interrupts/index.ts`, read from `node_modules/@ag-ui/client/dist/index.mjs.map`): `if (interrupt.expiresAt === undefined) return false; return new Date(interrupt.expiresAt) <= now`. `@ag-ui/core` 1.0.2 types `responseSchema` as `Record<string, any>` and says of `expiresAt` that "a value that is not one leaves the interrupt looking permanently unexpired". Where P7 is silent the module applies JSON Schema's own MUST and SHOULD rules: an enum has at least one value and none twice, each of its declared `type`; a `default` must be of its field's type (an enum's must be one of its values); `title`, `description` and `$schema` are strings; a bound must be of the right JSON type. A schema with no properties (`{ type: 'object', properties: {} }`) is a form without fields, whose Submit sends `{}`. The module imports `@ag-ui/core` for its types only (Global Constraints); the test also runs `@ag-ui/client`'s own `isInterruptExpired` on the same cases, so the copy cannot drift (tests are not the browser bundle). Nothing imports the module yet: Tasks 7, 10, 11 and 13 do.

**Files:**

- Create: `lib/chat/interrupt-answers.ts`
- Test: `__tests__/chat-interrupt-answers.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-interrupt-answers.test.ts` reports 73 passed.
- [ ] `approvalPayload` answers each framework in its own terms: Pydantic AI's schema `{ approved: true }` and `{ approved: false, reason: 'Rejected by the user' }`, Microsoft Agent Framework's `{ accepted: true }` and `{ accepted: false }`, AWS Strands' `{ approved: true }` and `{ approved: false }`, and `{ approved }` without a schema (Mastra, ADK); `approvalKey` takes the first required boolean in the order of `properties`, else the first boolean, else `approved` (P5).
- [ ] `flatFields` reads the AG-UI quarterly-filing schema as an enum, an integer with `minimum: 2000` and a number, all required, and every keyword of P7's subset in the order of `properties`; it answers null for a nested object, an array, a type array, `pattern`, `format`, `const`, `oneOf`, a `required` name that is no property, a wrong-typed default, an enum holding an object or null, `additionalProperties` true or a schema, and the other cases the test lists (P7).
- [ ] `checkFlatPayload` refuses unknown keys, null values, wrong types, a fraction for an integer, values out of bounds (both bounds inclusive), a missing required key and anything that is not an object; it counts a string's length in code points (`'🔥🔥🔥'` fits `maxLength: 3`).
- [ ] `answerKindOf` answers `approval` for a `tool_call` with a `toolCallId`, `confirm` for a `confirmation` without a schema, `form` for a `confirmation` or `input_required` with a flat schema, and `cancel` for a schema outside the subset, no schema on anything but a `confirmation`, and a `tool_call` without a `toolCallId` and without a flat schema (P6, P8).
- [ ] `isExpired` agrees with `@ag-ui/client` 1.0.2's `isInterruptExpired` for an `expiresAt` in the past, exactly now, in the future, unparseable and absent (P14).
- [ ] `payloadAccepted` accepts exactly `approvalPayload`'s two payloads for an approval, a bare boolean for a confirm, a payload that passes `checkFlatPayload` for a form, and nothing for an interrupt that can only be cancelled.
- [ ] The module's only AG-UI import is `import type { Interrupt } from '@ag-ui/core'` (spec §9).
- [ ] tsc, oxlint and oxfmt clean on both files; `pnpm test` green.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-interrupt-answers.test.ts` → `Tests  73 passed (73)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/chat-interrupt-answers.test.ts`:

```ts
import { isInterruptExpired } from '@ag-ui/client'
import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import {
	answerKindOf,
	approvalKey,
	approvalPayload,
	checkFlatPayload,
	flatFields,
	isApproval,
	isExpired,
	payloadAccepted,
	REJECTED_REASON,
	type FlatField,
} from '@/lib/chat/interrupt-answers'

// Each framework's approval schema as it sends it (research part2-hitl-state-files.md §1.3, §2).
const PYDANTIC_AI = {
	type: 'object',
	properties: {
		approved: { type: 'boolean' },
		editedArgs: { type: 'object' },
		reason: { type: 'string' },
	},
	required: ['approved'],
}
const MS_AGENT_FRAMEWORK = {
	type: 'object',
	properties: { accepted: { type: 'boolean' }, arguments: { type: 'object' } },
	required: ['accepted'],
}
const AWS_STRANDS = {
	type: 'object',
	properties: { approved: { type: 'boolean' } },
	required: ['approved'],
}

// AG-UI concepts › Interrupts, Examples, "Non-tool input request".
const QUARTERLY_FILING: Interrupt = {
	id: 'int-form',
	reason: 'input_required',
	message: 'Please provide the quarterly filing details.',
	responseSchema: {
		type: 'object',
		properties: {
			quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
			year: { type: 'integer', minimum: 2000 },
			revenue: { type: 'number' },
		},
		required: ['quarter', 'year', 'revenue'],
	},
	expiresAt: '2026-04-20T17:00:00Z',
}

const objectSchema = (
	properties: Record<string, unknown>,
	extra: Record<string, unknown> = {},
) => ({
	type: 'object',
	properties,
	...extra,
})

const approval = (responseSchema?: Record<string, unknown>): Interrupt => ({
	id: 'int-1',
	reason: 'tool_call',
	toolCallId: 'call-1',
	responseSchema,
})

describe('approvals (spec §6.1, plan call P5)', () => {
	it('knows an approval by its tool_call reason and toolCallId', () => {
		expect(isApproval({ reason: 'tool_call', toolCallId: 'call-1' })).toBe(true)
		expect(isApproval({ reason: 'tool_call' })).toBe(false)
		expect(isApproval({ reason: 'tool_call', toolCallId: '' })).toBe(false)
		// Google ADK confirms a tool call with reason `confirmation`: a confirm, not an approval (research §1.3).
		expect(isApproval({ reason: 'confirmation', toolCallId: 'call-1' })).toBe(false)
	})

	it.each([
		[
			'Pydantic AI',
			PYDANTIC_AI,
			'approved',
			{ approved: true },
			{ approved: false, reason: REJECTED_REASON },
		],
		[
			'Microsoft Agent Framework',
			MS_AGENT_FRAMEWORK,
			'accepted',
			{ accepted: true },
			{ accepted: false },
		],
		['AWS Strands', AWS_STRANDS, 'approved', { approved: true }, { approved: false }],
		['no schema (Mastra, ADK)', undefined, 'approved', { approved: true }, { approved: false }],
	])('answers %s in its own terms', (_name, schema, key, approve, reject) => {
		expect(approvalKey(schema)).toBe(key)
		expect(approvalPayload(schema, true)).toEqual(approve)
		expect(approvalPayload(schema, false)).toEqual(reject)
	})

	it('takes the first required boolean, else the first boolean, else `approved`', () => {
		expect(
			approvalKey(
				objectSchema(
					{ notify: { type: 'boolean' }, confirmed: { type: 'boolean' } },
					{ required: ['confirmed'] },
				),
			),
		).toBe('confirmed')
		expect(approvalKey(objectSchema({ note: { type: 'string' }, ok: { type: 'boolean' } }))).toBe(
			'ok',
		)
		expect(approvalKey(objectSchema({ note: { type: 'string' } }))).toBe('approved')
		expect(approvalKey('yes')).toBe('approved')
	})

	it('adds the reason only when the schema declares a string `reason`', () => {
		expect(
			approvalPayload(
				objectSchema({ approved: { type: 'boolean' }, reason: { type: 'integer' } }),
				false,
			),
		).toEqual({ approved: false })
		expect(approvalPayload(PYDANTIC_AI, true)).toEqual({ approved: true })
	})
})

describe('flatFields (plan call P7)', () => {
	it('reads the AG-UI quarterly-filing example as a form', () => {
		expect(flatFields(QUARTERLY_FILING.responseSchema)).toEqual([
			{ name: 'quarter', required: true, type: 'enum', options: ['Q1', 'Q2', 'Q3', 'Q4'] },
			{ name: 'year', required: true, type: 'integer', minimum: 2000 },
			{ name: 'revenue', required: true, type: 'number' },
		])
	})

	it('reads every keyword of the subset, in the order of `properties`', () => {
		const schema = objectSchema(
			{
				name: {
					type: 'string',
					title: 'Name',
					description: 'As on the invoice',
					default: 'Ada',
					minLength: 1,
					maxLength: 40,
				},
				count: { type: 'integer', default: 2, minimum: 1, maximum: 10 },
				ratio: { type: 'number', default: 0.5, maximum: 1 },
				urgent: { type: 'boolean', default: false },
				size: { enum: [1, 2, 3], default: 2 },
			},
			{
				$schema: 'https://json-schema.org/draft/2020-12/schema',
				title: 'Details',
				description: 'What the agent needs',
				required: ['name'],
				additionalProperties: false,
			},
		)
		expect(flatFields(schema)).toEqual<FlatField[]>([
			{
				name: 'name',
				required: true,
				type: 'string',
				title: 'Name',
				description: 'As on the invoice',
				default: 'Ada',
				minLength: 1,
				maxLength: 40,
			},
			{ name: 'count', required: false, type: 'integer', default: 2, minimum: 1, maximum: 10 },
			{ name: 'ratio', required: false, type: 'number', default: 0.5, maximum: 1 },
			{ name: 'urgent', required: false, type: 'boolean', default: false },
			{ name: 'size', required: false, type: 'enum', options: [1, 2, 3], default: 2 },
		])
	})

	it('reads an empty object schema as a form without fields', () => {
		expect(flatFields(objectSchema({}))).toEqual([])
	})

	it.each<[string, unknown]>([
		['a nested object', objectSchema({ address: { type: 'object' } })],
		['an array', objectSchema({ tags: { type: 'array', items: { type: 'string' } } })],
		['a type array', objectSchema({ name: { type: ['string', 'null'] } })],
		['a property without a type', objectSchema({ name: { title: 'Name' } })],
		['pattern', objectSchema({ code: { type: 'string', pattern: '^[A-Z]+$' } })],
		['format', objectSchema({ email: { type: 'string', format: 'email' } })],
		['const', objectSchema({ kind: { type: 'string', const: 'a' } })],
		['oneOf', objectSchema({ value: { oneOf: [{ type: 'string' }, { type: 'number' }] } })],
		['a bound of another type', objectSchema({ name: { type: 'string', minimum: 1 } })],
		['a negative length', objectSchema({ name: { type: 'string', maxLength: -1 } })],
		['a fractional length', objectSchema({ name: { type: 'string', minLength: 1.5 } })],
		['a bound that is no number', objectSchema({ year: { type: 'integer', minimum: '2000' } })],
		[
			'a required name that is no property',
			objectSchema({ name: { type: 'string' } }, { required: ['missing'] }),
		],
		[
			'a required list that is no array',
			objectSchema({ name: { type: 'string' } }, { required: 'name' }),
		],
		[
			'a string default on an integer',
			objectSchema({ year: { type: 'integer', default: '2026' } }),
		],
		[
			'a fractional default on an integer',
			objectSchema({ year: { type: 'integer', default: 2026.5 } }),
		],
		['a null default', objectSchema({ name: { type: 'string', default: null } })],
		['a default the enum lacks', objectSchema({ pick: { enum: ['a', 'b'], default: 'c' } })],
		['an enum with an object', objectSchema({ pick: { enum: ['a', { b: 1 }] } })],
		['an enum with null', objectSchema({ pick: { enum: ['a', null] } })],
		['an empty enum', objectSchema({ pick: { enum: [] } })],
		['an enum with a value twice', objectSchema({ pick: { enum: ['a', 'a'] } })],
		['an enum of another type', objectSchema({ pick: { type: 'string', enum: [1, 2] } })],
		['an enum with bounds', objectSchema({ pick: { enum: ['a'], minLength: 1 } })],
		['a non-string title', objectSchema({ name: { type: 'string', title: 7 } })],
		['a boolean property schema', objectSchema({ name: true })],
		['additionalProperties true', objectSchema({}, { additionalProperties: true })],
		[
			'additionalProperties as a schema',
			objectSchema({}, { additionalProperties: { type: 'string' } }),
		],
		['another top-level keyword', objectSchema({}, { $defs: {} })],
		['no properties', { type: 'object' }],
		['a non-object type', { type: 'string' }],
		['no schema object', 'yes'],
		['null', null],
	])('puts a schema with %s outside the subset', (_name, schema) => {
		expect(flatFields(schema)).toBeNull()
	})
})

describe('checkFlatPayload (plan call P7)', () => {
	const fields = flatFields(
		objectSchema(
			{
				code: { type: 'string', minLength: 2, maxLength: 3 },
				count: { type: 'integer', minimum: 1, maximum: 10 },
				ratio: { type: 'number' },
				urgent: { type: 'boolean' },
				size: { enum: ['S', 'M', 1] },
			},
			{ required: ['code', 'count'] },
		),
	)!

	it('accepts declared keys of their type within bounds, inclusive at both ends', () => {
		expect(checkFlatPayload(fields, { code: 'ab', count: 1 })).toBe(true)
		expect(
			checkFlatPayload(fields, { code: 'abc', count: 10, ratio: -0.5, urgent: false, size: 1 }),
		).toBe(true)
	})

	it('counts a string’s length in code points (JSON Schema Validation §6.3.1)', () => {
		expect('🔥🔥🔥'.length).toBe(6)
		expect(checkFlatPayload(fields, { code: '🔥🔥🔥', count: 2 })).toBe(true)
		expect(checkFlatPayload(fields, { code: '🔥', count: 2 })).toBe(false)
	})

	it.each<[string, unknown]>([
		['an unknown key', { code: 'ab', count: 1, extra: true }],
		['a null value', { code: 'ab', count: 1, ratio: null }],
		['a wrong type', { code: 'ab', count: '1' }],
		['a fraction for an integer', { code: 'ab', count: 1.5 }],
		['a string too short', { code: 'a', count: 1 }],
		['a string too long', { code: 'abcd', count: 1 }],
		['a number under the minimum', { code: 'ab', count: 0 }],
		['a number over the maximum', { code: 'ab', count: 11 }],
		['a value the enum lacks', { code: 'ab', count: 1, size: 'L' }],
		['a missing required key', { code: 'ab' }],
		['an array', [{ code: 'ab', count: 1 }]],
		['null', null],
		['a boolean', true],
	])('refuses %s', (_name, payload) => {
		expect(checkFlatPayload(fields, payload)).toBe(false)
	})
})

describe('answerKindOf (spec §6.1, §6.3; plan calls P6, P8)', () => {
	const flat = objectSchema({ confirmed: { type: 'boolean' } }, { required: ['confirmed'] })

	it('answers an approval with Approve and Reject, whatever its schema', () => {
		expect(answerKindOf(approval(PYDANTIC_AI))).toEqual({ kind: 'approval' })
		expect(answerKindOf(approval())).toEqual({ kind: 'approval' })
	})

	it('answers a confirmation without a schema with a bare boolean, and with a flat one by its form', () => {
		expect(answerKindOf({ id: 'c', reason: 'confirmation', message: 'Proceed?' })).toEqual({
			kind: 'confirm',
		})
		expect(answerKindOf({ id: 'c', reason: 'confirmation', responseSchema: flat })).toEqual({
			kind: 'form',
			fields: [{ name: 'confirmed', required: true, type: 'boolean' }],
		})
	})

	it('answers a flat input_required with its form', () => {
		expect(answerKindOf(QUARTERLY_FILING)).toEqual({
			kind: 'form',
			fields: flatFields(QUARTERLY_FILING.responseSchema),
		})
	})

	it('offers only Cancel for a schema outside the subset', () => {
		const nested = objectSchema({ address: { type: 'object' } })
		expect(answerKindOf({ id: 'i', reason: 'input_required', responseSchema: nested })).toEqual({
			kind: 'cancel',
		})
		expect(answerKindOf({ id: 'c', reason: 'confirmation', responseSchema: nested })).toEqual({
			kind: 'cancel',
		})
	})

	it('offers only Cancel without a schema on anything but a confirmation', () => {
		expect(answerKindOf({ id: 'i', reason: 'input_required' })).toEqual({ kind: 'cancel' })
		// Mastra names its approvals `mastra:tool_approval` and sends no schema (research §1.3).
		expect(answerKindOf({ id: 'm', reason: 'mastra:tool_approval' })).toEqual({ kind: 'cancel' })
	})

	it('reads a tool_call without a toolCallId as any other interrupt', () => {
		expect(answerKindOf({ id: 't', reason: 'tool_call' })).toEqual({ kind: 'cancel' })
		expect(answerKindOf({ id: 't', reason: 'tool_call', responseSchema: flat })).toEqual({
			kind: 'form',
			fields: [{ name: 'confirmed', required: true, type: 'boolean' }],
		})
	})
})

describe('isExpired (plan call P14)', () => {
	const NOW = new Date('2026-10-14T12:00:00Z')

	it.each<[string, string | undefined, boolean]>([
		['in the past', '2026-10-14T11:59:59Z', true],
		['exactly now', '2026-10-14T12:00:00Z', true],
		['in the future', '2026-10-14T12:00:01Z', false],
		['unparseable', 'soon', false],
		['absent', undefined, false],
	])('reads an expiresAt %s as @ag-ui/client 1.0.2 does', (_name, expiresAt, expected) => {
		const interrupt: Interrupt = { id: 'x', reason: 'confirmation', expiresAt }
		expect(isExpired(interrupt, NOW)).toBe(expected)
		expect(isInterruptExpired(interrupt, NOW)).toBe(expected)
	})
})

describe('payloadAccepted (the server’s check of a resolved entry)', () => {
	it('accepts exactly the two approval payloads', () => {
		const pydantic = approval(PYDANTIC_AI)
		expect(payloadAccepted(pydantic, { approved: true })).toBe(true)
		expect(payloadAccepted(pydantic, { approved: false, reason: REJECTED_REASON })).toBe(true)
		expect(payloadAccepted(pydantic, { approved: false })).toBe(false)
		expect(payloadAccepted(pydantic, { approved: true, editedArgs: { to: 'a@b.com' } })).toBe(false)
		expect(payloadAccepted(pydantic, { approved: false, reason: 'Other words' })).toBe(false)
		expect(payloadAccepted(pydantic, true)).toBe(false)
		expect(payloadAccepted(pydantic, undefined)).toBe(false)
		const microsoft = approval(MS_AGENT_FRAMEWORK)
		expect(payloadAccepted(microsoft, { accepted: false })).toBe(true)
		expect(payloadAccepted(microsoft, { approved: true })).toBe(false)
	})

	it('accepts a bare boolean for a confirmation without a schema', () => {
		const confirmation: Interrupt = { id: 'c', reason: 'confirmation' }
		expect(payloadAccepted(confirmation, true)).toBe(true)
		expect(payloadAccepted(confirmation, false)).toBe(true)
		expect(payloadAccepted(confirmation, { confirmed: true })).toBe(false)
		expect(payloadAccepted(confirmation, undefined)).toBe(false)
	})

	it('accepts a form’s payload that passes its schema', () => {
		expect(payloadAccepted(QUARTERLY_FILING, { quarter: 'Q1', year: 2026, revenue: 4200000 })).toBe(
			true,
		)
		expect(payloadAccepted(QUARTERLY_FILING, { quarter: 'Q5', year: 2026, revenue: 1 })).toBe(false)
		expect(payloadAccepted(QUARTERLY_FILING, { quarter: 'Q1', year: 1999, revenue: 1 })).toBe(false)
	})

	it('accepts no payload for an interrupt that can only be cancelled', () => {
		const cancelOnly: Interrupt = { id: 'i', reason: 'input_required' }
		expect(payloadAccepted(cancelOnly, undefined)).toBe(false)
		expect(payloadAccepted(cancelOnly, {})).toBe(false)
		expect(payloadAccepted(cancelOnly, true)).toBe(false)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-interrupt-answers.test.ts` Expected: FAIL with `Error: Cannot find package '@/lib/chat/interrupt-answers'`.

- [ ] **Step 3: Implement**

Create `lib/chat/interrupt-answers.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'

/*
 * How the hub answers an AG-UI interrupt (Part 2 spec §6.1, §6.3; plan calls P5–P8, P14), client-safe: the browser's
 * cards build their answers with it, and the server's answers check (lib/chat/answers.ts) re-checks every resolved
 * entry with the same rules, as AG-UI asks of a client ("Clients should validate before submitting", concepts ›
 * Interrupts, contract rule 6). `@ag-ui/core` is imported for its types only (spec §9: the browser bundle carries no
 * AG-UI runtime). A `responseSchema` is the agent's, so untrusted: anything outside the subset below answers null or
 * false, never throws.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)
/** JSON Schema Validation 2020-12 §6.1.1: "integer" matches "any number with a zero fractional part". */
const isInteger = (value: unknown): value is number => Number.isInteger(value)
/** §6.3.1, §6.3.2: a length bound "MUST be a non-negative integer". */
const isLength = (value: unknown): value is number => isInteger(value) && value >= 0
const optional = <T>(
	value: unknown,
	guard: (value: unknown) => value is T,
): value is T | undefined => value === undefined || guard(value)

/** Spec §6.1: added to a rejection when the schema declares a string `reason`. */
export const REJECTED_REASON = 'Rejected by the user'

/**
 * Spec §6.1: an interrupt with reason `tool_call` and a `toolCallId` (AG-UI concepts › Interrupts, "Tool-bound
 * interrupts"; the reason taxonomy: for `tool_call`, "`toolCallId` must be set").
 */
export const isApproval = (interrupt: Pick<Interrupt, 'reason' | 'toolCallId'>): boolean =>
	interrupt.reason === 'tool_call' && Boolean(interrupt.toolCallId)

const propertiesOf = (schema: unknown): Record<string, unknown> =>
	isRecord(schema) && isRecord(schema.properties) ? schema.properties : {}

const hasType = (node: unknown, type: string): boolean => isRecord(node) && node.type === type

/**
 * P5: the boolean property an approval sets. Frameworks name it differently (`approved` for Pydantic AI and AWS
 * Strands, `accepted` for Microsoft Agent Framework: research part2-hitl-state-files.md §1.3), so it is read from the
 * interrupt's own schema: its first required boolean property in the order of `properties`, else its first boolean
 * property, else the spec's `approved` (AG-UI concepts › Interrupts, "Approve with edits").
 */
export const approvalKey = (schema: unknown): string => {
	const properties = propertiesOf(schema)
	const required = isRecord(schema) && Array.isArray(schema.required) ? schema.required : []
	const booleans = Object.keys(properties).filter(name => hasType(properties[name], 'boolean'))
	return booleans.find(name => required.includes(name)) ?? booleans[0] ?? 'approved'
}

/**
 * P5: Approve (`true`) or Reject (`false`) in the interrupt's own schema's terms: the approval key alone, plus
 * REJECTED_REASON on a rejection when the schema declares a string `reason` (Pydantic AI 2.56 turns `approved: false`
 * with a `reason` into its denial message: research §2). "Denials are expressed inside the payload … not as a separate
 * status" (AG-UI concepts › Interrupts, "Resuming a run").
 */
export const approvalPayload = (schema: unknown, approved: boolean): Record<string, unknown> => {
	const key = approvalKey(schema)
	return !approved && hasType(propertiesOf(schema).reason, 'string')
		? { [key]: false, reason: REJECTED_REASON }
		: { [key]: approved }
}

interface FieldBase {
	name: string
	required: boolean
	title?: string
	description?: string
}

/** P7: one field of a flat responseSchema, in the order of `properties`. */
export type FlatField =
	| (FieldBase & { type: 'string'; default?: string; minLength?: number; maxLength?: number })
	| (FieldBase & {
			type: 'number' | 'integer'
			default?: number
			minimum?: number
			maximum?: number
	  })
	| (FieldBase & { type: 'boolean'; default?: boolean })
	| (FieldBase & { type: 'enum'; default?: string | number; options: (string | number)[] })

/** P7: the keywords the subset knows, at the top and per kind of property; any other puts a schema outside it. */
const SCHEMA_KEYWORDS = new Set([
	'$schema',
	'type',
	'title',
	'description',
	'properties',
	'required',
	'additionalProperties',
])
const ANNOTATIONS = ['type', 'title', 'description', 'default']
const PROPERTY_KEYWORDS: Record<
	'string' | 'number' | 'integer' | 'boolean' | 'enum',
	Set<string>
> = {
	string: new Set([...ANNOTATIONS, 'minLength', 'maxLength']),
	number: new Set([...ANNOTATIONS, 'minimum', 'maximum']),
	integer: new Set([...ANNOTATIONS, 'minimum', 'maximum']),
	boolean: new Set(ANNOTATIONS),
	enum: new Set([...ANNOTATIONS, 'enum']),
}

const onlyKeywords = (node: Record<string, unknown>, known: Set<string>): boolean =>
	Object.keys(node).every(key => known.has(key))

/**
 * P7: an enum of strings or numbers, at least one and none twice (JSON Schema Validation 2020-12 §6.1.2: the array
 * "SHOULD have at least one element. Elements in the array SHOULD be unique"), each of the declared `type` when one
 * is given; null otherwise.
 */
const enumOptions = (node: Record<string, unknown>): (string | number)[] | null => {
	const { enum: options, type } = node
	if (!Array.isArray(options) || options.length === 0) return null
	if (new Set(options).size !== options.length) return null
	const fits = (option: unknown) =>
		type === undefined
			? isString(option) || isNumber(option)
			: type === 'string'
				? isString(option)
				: type === 'number'
					? isNumber(option)
					: type === 'integer' && isInteger(option)
	return options.every(fits) ? options : null
}

const fieldOf = (name: string, node: unknown, required: boolean): FlatField | null => {
	if (!isRecord(node)) return null
	const { type, title, description, default: fallback } = node
	if (!optional(title, isString) || !optional(description, isString)) return null
	const base = { name, required, title, description }
	if (Object.hasOwn(node, 'enum')) {
		const options = onlyKeywords(node, PROPERTY_KEYWORDS.enum) ? enumOptions(node) : null
		if (!options) return null
		const chosen = options.find(option => option === fallback)
		// §9.2: a default "SHOULD be valid against the associated schema"; one the enum lacks is refused (P7).
		return fallback === undefined || chosen !== undefined
			? { ...base, type: 'enum', options, default: chosen }
			: null
	}
	switch (type) {
		case 'string': {
			const { minLength, maxLength } = node
			if (!onlyKeywords(node, PROPERTY_KEYWORDS.string)) return null
			if (!optional(fallback, isString)) return null
			if (!optional(minLength, isLength) || !optional(maxLength, isLength)) return null
			return { ...base, type, default: fallback, minLength, maxLength }
		}
		case 'number':
		case 'integer': {
			const { minimum, maximum } = node
			if (!onlyKeywords(node, PROPERTY_KEYWORDS[type])) return null
			if (!optional(fallback, type === 'integer' ? isInteger : isNumber)) return null
			// §6.2.2, §6.2.4: each bound "MUST be a number".
			if (!optional(minimum, isNumber) || !optional(maximum, isNumber)) return null
			return { ...base, type, default: fallback, minimum, maximum }
		}
		case 'boolean':
			if (!onlyKeywords(node, PROPERTY_KEYWORDS.boolean)) return null
			return optional(fallback, isBoolean) ? { ...base, type, default: fallback } : null
		default:
			// Nested objects, arrays, type arrays (['string', 'null']) and schemas without a type are outside the subset.
			return null
	}
}

/**
 * P7 (decision 62: "Types and bounds"): the fields of a flat schema, `{ type: 'object', properties, required?, title?,
 * description?, additionalProperties?: false, $schema? }` whose properties are each a string, number, integer or
 * boolean with their bounds, or an enum; null for anything else, so the card offers Cancel only (P8). `required` must
 * name properties (§6.5.3: "Elements of this array, if any, MUST be strings").
 */
export const flatFields = (schema: unknown): FlatField[] | null => {
	if (!isRecord(schema) || schema.type !== 'object' || !onlyKeywords(schema, SCHEMA_KEYWORDS))
		return null
	const { properties, required = [], additionalProperties, title, description, $schema } = schema
	if (!isRecord(properties) || !Array.isArray(required)) return null
	if (!required.every(name => isString(name) && Object.hasOwn(properties, name))) return null
	if (additionalProperties !== undefined && additionalProperties !== false) return null
	if (
		!optional(title, isString) ||
		!optional(description, isString) ||
		!optional($schema, isString)
	)
		return null
	const fields = Object.entries(properties).map(([name, node]) =>
		fieldOf(name, node, required.includes(name)),
	)
	return fields.every((field): field is FlatField => field !== null) ? fields : null
}

/** §6.3.1: a string's length is "the number of its characters as defined by RFC 8259", that is code points. */
const codePoints = (text: string): number => Array.from(text).length

const fits = (field: FlatField, value: unknown): boolean => {
	switch (field.type) {
		case 'string': {
			if (!isString(value)) return false
			const length = codePoints(value)
			return (
				(field.minLength === undefined || length >= field.minLength) &&
				(field.maxLength === undefined || length <= field.maxLength)
			)
		}
		case 'number':
		case 'integer': {
			const ofType = field.type === 'integer' ? isInteger : isNumber
			if (!ofType(value)) return false
			// §6.2.2, §6.2.4: both bounds are inclusive.
			return (
				(field.minimum === undefined || value >= field.minimum) &&
				(field.maximum === undefined || value <= field.maximum)
			)
		}
		case 'boolean':
			return isBoolean(value)
		case 'enum':
			return field.options.some(option => option === value)
	}
}

/**
 * P7: a form's payload is an object with only declared keys, each value of its field's type (never null) and within
 * its bounds, and every required key present.
 */
export const checkFlatPayload = (fields: readonly FlatField[], payload: unknown): boolean => {
	if (!isRecord(payload)) return false
	const byName = new Map(fields.map(field => [field.name, field]))
	const known = Object.entries(payload).every(([name, value]) => {
		const field = byName.get(name)
		return field !== undefined && fits(field, value)
	})
	return known && fields.every(field => !field.required || Object.hasOwn(payload, field.name))
}

/** How an interrupt is answered (spec §6.1, §6.3; P6, P8). */
export type AnswerKind =
	| { kind: 'approval' }
	| { kind: 'confirm' }
	| { kind: 'form'; fields: FlatField[] }
	| { kind: 'cancel' }

/**
 * Spec §6.1, §6.3: an approval answers Approve or Reject (P5); a `confirmation` without a `responseSchema` answers a
 * bare boolean (P6: the reason taxonomy's "`responseSchema` optional; boolean default"); a flat schema a form (P7);
 * anything else, including a `tool_call` without a `toolCallId`, only Cancel (P8). Unknown reasons are rendered, never
 * refused ("For unknown reasons, clients must not error", concepts › Interrupts, "Client routing").
 */
export const answerKindOf = (interrupt: Interrupt): AnswerKind => {
	if (isApproval(interrupt)) return { kind: 'approval' }
	if (interrupt.responseSchema === undefined)
		return interrupt.reason === 'confirmation' ? { kind: 'confirm' } : { kind: 'cancel' }
	const fields = flatFields(interrupt.responseSchema)
	return fields ? { kind: 'form', fields } : { kind: 'cancel' }
}

/**
 * P14: @ag-ui/client 1.0.2's rule, copied so the browser needs no AG-UI runtime (spec §9): its `isInterruptExpired`
 * (`src/interrupts/index.ts`) answers false without an `expiresAt`, else `new Date(expiresAt) <= now`. A value that
 * is no date gives an Invalid Date, which compares false: "a value that is not one leaves the interrupt looking
 * permanently unexpired" (@ag-ui/core 1.0.2, `Interrupt.expiresAt`). The server re-checks with the client's own
 * function.
 */
export const isExpired = (interrupt: Pick<Interrupt, 'expiresAt'>, now: Date): boolean =>
	interrupt.expiresAt !== undefined && new Date(interrupt.expiresAt) <= now

/** Two flat records hold the same keys with the same values. */
const sameRecord = (expected: Record<string, unknown>, actual: unknown): boolean =>
	isRecord(actual) &&
	Object.keys(actual).length === Object.keys(expected).length &&
	Object.entries(expected).every(
		([key, value]) => Object.hasOwn(actual, key) && actual[key] === value,
	)

/**
 * The server's check of a resolved entry's payload (spec §6.1, §6.3): an approval's is exactly one of approvalPayload's
 * two (P5), a confirm's a boolean (P6), a form's passes checkFlatPayload (P7); an interrupt that can only be cancelled
 * accepts none (P8).
 */
export const payloadAccepted = (interrupt: Interrupt, payload: unknown): boolean => {
	const answer = answerKindOf(interrupt)
	switch (answer.kind) {
		case 'approval':
			return [true, false].some(approved =>
				sameRecord(approvalPayload(interrupt.responseSchema, approved), payload),
			)
		case 'confirm':
			return isBoolean(payload)
		case 'form':
			return checkFlatPayload(answer.fields, payload)
		case 'cancel':
			return false
	}
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-interrupt-answers.test.ts` Expected: PASS, `Tests  73 passed (73)`.

- [ ] **Step 5: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/interrupt-answers.ts __tests__/chat-interrupt-answers.test.ts
pnpm exec oxfmt --check lib/chat/interrupt-answers.ts __tests__/chat-interrupt-answers.test.ts
pnpm test
grep -n "from '@ag-ui" lib/chat/interrupt-answers.ts
```

Expected: no tsc error, no oxlint finding, oxfmt "All matched files use the correct format", vitest 0 failed; the grep prints one line, `1:import type { Interrupt } from '@ag-ui/core'`.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/interrupt-answers.ts __tests__/chat-interrupt-answers.test.ts
git commit -m "feat(chat): interrupt answers: approval payloads and the flat-schema form

The approval payload in each framework's own terms (the schema's first required
boolean, a reason on a rejection when declared), the fields of a flat responseSchema
with types and bounds, the check of a form's payload, the kind of answer an interrupt
allows and its expiry (@ag-ui/client 1.0.2's rule), shared by the browser's cards and
the server's answers check (Part 2 spec §6.1, §6.3; plan calls P5-P8, P14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/interrupt-answers.ts", "__tests__/chat-interrupt-answers.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-interrupt-answers.test.ts", "acceptanceCriteria": ["chat-interrupt-answers.test.ts reports 73 passed", "approvalPayload: Pydantic AI {approved} / {approved:false, reason}, Microsoft Agent Framework {accepted}, AWS Strands {approved}, {approved} without a schema; approvalKey: first required boolean, else first boolean, else approved", "flatFields reads the quarterly-filing schema and every P7 keyword in properties order; null for nested object, array, type array, pattern, format, const, oneOf, a required name that is no property, a wrong-typed default, an enum with an object or null, additionalProperties true or a schema", "checkFlatPayload refuses unknown keys, null, wrong types, fractions for integers, out-of-bounds values (inclusive bounds), missing required keys and non-objects; lengths count code points", "answerKindOf: approval, confirm, form (confirmation or input_required with a flat schema), cancel (outside the subset, no schema on a non-confirmation, tool_call without toolCallId)", "isExpired agrees with @ag-ui/client's isInterruptExpired for past, now, future, unparseable and absent", "payloadAccepted accepts only approvalPayload's two payloads, a boolean for a confirm, a checkFlatPayload-valid form payload, nothing for cancel-only", "the module imports @ag-ui/core with import type only", "tsc, oxlint, oxfmt clean; pnpm test green"], "modelTier": "mechanical"}
```

---

### Task 4: Plan state and activity content

**Goal:** `lib/chat/plan-state.ts` reads the conversation's state as a plan (`{ steps: [{ description, status }] }`) and answers each step's antd Steps status and the plan's progress, and `components/shared-chat/activity-view.ts` answers how an activity message's content shows: content whose indented JSON is over 10,240 characters as that JSON cut, otherwise a flat object as fields and anything else as the whole JSON.

Spec §6.4 (the plan panel: shown "when the conversation's state parses (zod) as `{ steps: [{ description: string, status: string }] }` with at least one step, the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example"; `pending` → wait, `in_progress` → process, `completed` → finish, `blocked` → error, any other neutral; "It collapses itself once every step is completed"; activity cards: "a flat `content` as antd `Descriptions`, anything nested as collapsed JSON in `CodeHighlighter`, capped at 10 KB. Everything renders as text, never HTML"), plan call P17 and the Shared contracts' "Plan state and activity content". Sources: AG-UI 1.0 "State" (state is "deliberately unconstrained", and "an application MUST validate what it reads out of state before acting on it — rendering it"), AG-UI 1.0 "Activity" (`content` "is an object, not text"; `activityType` "is an open string … A consumer MUST tolerate types it does not recognise"); research `part2-hitl-state-files.md` §3.1–§3.2 (the Dojo's `TaskProgress` from `state.steps`; Pydantic AI's `agentic_generative_ui.py` `Plan {steps: [{description, status: pending|completed}]}`) and Implications C.2 (read-only, escaped, size-capped); the full-stack template's plan panel (`tmp/refs/fsat`, release 0.2.21, `frontend/src/components/chat/research-panel.tsx`: statuses `pending | in_progress | completed | blocked`, `todoDone` counts `completed`, `pct = Math.round((todoDone / todoTotal) * 100)`); antd 6.6.5 `es/steps/index.d.ts` (`StepItem.status?: 'wait' | 'process' | 'finish' | 'error'`). One difference from the template, by the spec: the template treats a plan with no `pending` or `in_progress` step as done (a `blocked` step included), while spec §6.4 collapses the panel only "once every step is completed", so `complete` is that. Both modules are pure and client-safe (zod only, no `@ag-ui/*`): Task 14's `PlanPanel` and `ActivityCard` render what they answer as text. The 10 KB cap holds for every view, as spec §6.4 caps the content ("capped at 10 KB"): a flat object shows as fields only while its indented JSON fits `ACTIVITY_JSON_MAX`, and one over it shows as the cut JSON. The cut counts code points, as P7 counts lengths, and never splits a surrogate pair; content that is `undefined` (an activity message stored without one) shows as `null`, because `JSON.stringify(undefined)` answers `undefined`, not text (ECMA-262 SerializeJSONProperty).

**Files:**

- Create: `lib/chat/plan-state.ts`
- Create: `components/shared-chat/activity-view.ts`
- Test: `__tests__/chat-plan-state.test.ts`
- Test: `__tests__/shared-chat-activity-view.test.ts`

**Acceptance Criteria:**

- [ ] `planOf` answers the steps (keys beside `steps` and beside a step's two dropped) for state of the plan shape with at least one step, and null for no state, null, an array, a string, state of another shape, no steps, or a step without a string `description` and `status`.
- [ ] `planStepStatus` maps `pending`, `in_progress`, `completed`, `blocked` to `wait`, `process`, `finish`, `error`, and any other string (`Completed`, `''`, `toString`, `__proto__` included) to `wait`.
- [ ] `planProgress` of 2 completed among 5 is `{ done: 2, total: 5, percent: 40, complete: false }`; 1/3 → 33 and 2/3 → 67; all completed → `percent: 100, complete: true`; a `blocked` step keeps `complete: false`; no steps → `{ 0, 0, 0, false }`.
- [ ] `activityView` answers `{ kind: 'json', text: <cut>, truncated: true }` whenever `JSON.stringify(content, null, 2)` is longer than `ACTIVITY_JSON_MAX` code points, flat or not (cut to `ACTIVITY_JSON_MAX` code points, never splitting a surrogate pair); otherwise `fields` (values as `String(value)`, in key order) for a non-array object with at least one key whose values are all strings, numbers, booleans or null, and the whole JSON for anything else, `undefined` as `null`. A flat object whose JSON is exactly `ACTIVITY_JSON_MAX` long shows as fields; one character more, as cut JSON.
- [ ] tsc, oxlint, oxfmt clean on the four files; `pnpm test` 0 failed.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts` → `Test Files  2 passed (2)`, `Tests  38 passed (38)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/chat-plan-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { planOf, planProgress, planStepStatus, type PlanStep } from '@/lib/chat/plan-state'

const step = (status: string, description = `Step ${status}`): PlanStep => ({ description, status })

// Spec §6.4: the Dojo's agentic_generative_ui and Pydantic AI's example shape, read with zod.
describe('planOf', () => {
	it('reads the steps, dropping keys beside them', () => {
		expect(
			planOf({
				steps: [
					{ description: 'Search flights', status: 'completed', id: 's1' },
					{ description: 'Book a hotel', status: 'pending' },
				],
				recipe: { title: 'Tea' },
			}),
		).toEqual([
			{ description: 'Search flights', status: 'completed' },
			{ description: 'Book a hotel', status: 'pending' },
		])
	})
	it('reads any status string; the panel maps the ones it knows', () => {
		expect(planOf({ steps: [step('enabled')] })).toEqual([step('enabled')])
	})
	it.each([
		['no state', undefined],
		['null', null],
		['an array', [step('pending')]],
		['a string', 'steps'],
		['state of another shape', { recipe: { title: 'Tea' } }],
		['no steps', { steps: [] }],
		['steps that are not a list', { steps: 'Search flights' }],
		['a step without a status', { steps: [{ description: 'Search flights' }] }],
		[
			'a step whose description is not a string',
			{ steps: [{ description: 1, status: 'pending' }] },
		],
		['a step that is not an object', { steps: ['Search flights'] }],
	])('answers null for %s', (_label, state) => {
		expect(planOf(state)).toBeNull()
	})
})

// 2b's plan call P17: the template's four statuses as antd Steps' four.
describe('planStepStatus', () => {
	it.each([
		['pending', 'wait'],
		['in_progress', 'process'],
		['completed', 'finish'],
		['blocked', 'error'],
	])('shows %s as %s', (status, shown) => {
		expect(planStepStatus(status)).toBe(shown)
	})
	it.each(['enabled', 'executing', 'Completed', '', 'toString', '__proto__'])(
		'shows any other status (%j) as wait',
		status => {
			expect(planStepStatus(status)).toBe('wait')
		},
	)
})

describe('planProgress', () => {
	it('counts the completed steps for "Plan 2/5", with the percent rounded', () => {
		expect(
			planProgress([
				step('completed'),
				step('completed'),
				step('in_progress'),
				step('blocked'),
				step('pending'),
			]),
		).toEqual({ done: 2, total: 5, percent: 40, complete: false })
		expect(planProgress([step('completed'), step('pending'), step('pending')]).percent).toBe(33)
		expect(planProgress([step('completed'), step('completed'), step('pending')]).percent).toBe(67)
	})
	// Spec §6.4: the panel collapses once every step is completed; a blocked step keeps it open.
	it('is complete once every step is completed', () => {
		expect(planProgress([step('completed'), step('completed')])).toEqual({
			done: 2,
			total: 2,
			percent: 100,
			complete: true,
		})
		expect(planProgress([step('completed'), step('blocked')]).complete).toBe(false)
	})
	it('answers nothing done and nothing complete for no steps', () => {
		expect(planProgress([])).toEqual({ done: 0, total: 0, percent: 0, complete: false })
	})
})
```

Create `__tests__/shared-chat-activity-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { ACTIVITY_JSON_MAX, activityView } from '@/components/shared-chat/activity-view'

// 2b's plan call P17: a flat object as antd Descriptions.
describe('activityView: fields', () => {
	it('shows a flat object’s entries in their order, each value as text', () => {
		expect(activityView({ query: 'tea', found: 3, done: false, error: null })).toEqual({
			kind: 'fields',
			items: [
				{ key: 'query', value: 'tea' },
				{ key: 'found', value: '3' },
				{ key: 'done', value: 'false' },
				{ key: 'error', value: 'null' },
			],
		})
	})
	// Spec §6.4 caps the content at 10 KB in every view: a flat object shows as fields only while its JSON fits.
	it('shows a flat object whose JSON fits the cap as fields, and one over it as cut JSON', () => {
		const atCap = { note: 'x'.repeat(ACTIVITY_JSON_MAX - 16) }
		expect(JSON.stringify(atCap, null, 2)).toHaveLength(ACTIVITY_JSON_MAX)
		expect(activityView(atCap)).toEqual({
			kind: 'fields',
			items: [{ key: 'note', value: atCap.note }],
		})
		const overCap = { note: `${atCap.note}x` }
		const view = activityView(overCap)
		expect(view).toEqual({
			kind: 'json',
			text: JSON.stringify(overCap, null, 2).slice(0, ACTIVITY_JSON_MAX),
			truncated: true,
		})
	})
	it('keeps markup in a value as text for the card to render as text', () => {
		expect(activityView({ note: '<b>bold</b>' })).toEqual({
			kind: 'fields',
			items: [{ key: 'note', value: '<b>bold</b>' }],
		})
	})
})

// P17: anything else as indented JSON in CodeHighlighter.
describe('activityView: JSON', () => {
	it('shows a nested object as JSON indented by two spaces', () => {
		expect(activityView({ query: 'tea', results: [{ title: 'Green' }] })).toEqual({
			kind: 'json',
			text: '{\n  "query": "tea",\n  "results": [\n    {\n      "title": "Green"\n    }\n  ]\n}',
			truncated: false,
		})
	})
	it.each([
		['an empty object', {}, '{}'],
		['an array of scalars', ['a', 1], '[\n  "a",\n  1\n]'],
		['a string', 'Searching', '"Searching"'],
		['a number', 3, '3'],
		['null', null, 'null'],
		['no content', undefined, 'null'],
	])('shows %s as JSON', (_label, content, text) => {
		expect(activityView(content)).toEqual({ kind: 'json', text, truncated: false })
	})
	it('keeps JSON of exactly the limit, and cuts one character more at the limit', () => {
		// A JSON string's text is its characters between two quotes.
		const fits = activityView('x'.repeat(ACTIVITY_JSON_MAX - 2))
		expect(fits).toEqual({
			kind: 'json',
			text: `"${'x'.repeat(ACTIVITY_JSON_MAX - 2)}"`,
			truncated: false,
		})
		const over = activityView('x'.repeat(ACTIVITY_JSON_MAX - 1))
		expect(over).toEqual({
			kind: 'json',
			text: `"${'x'.repeat(ACTIVITY_JSON_MAX - 1)}`,
			truncated: true,
		})
	})
	it('counts the limit in code points and never splits a surrogate pair', () => {
		const view = activityView({ items: ['😀'.repeat(ACTIVITY_JSON_MAX)] })
		expect(view.kind).toBe('json')
		if (view.kind !== 'json') return
		expect(view.truncated).toBe(true)
		expect(Array.from(view.text)).toHaveLength(ACTIVITY_JSON_MAX)
		expect(view.text.isWellFormed()).toBe(true)
		expect(view.text.length).toBeGreaterThan(ACTIVITY_JSON_MAX)
	})
	it('reads deeply nested content without throwing', () => {
		let content: unknown = 'leaf'
		for (let depth = 0; depth < 100; depth += 1) content = { child: content }
		expect(activityView(content).kind).toBe('json')
	})
})
```

`String.prototype.isWellFormed` is ES2024, in Node 22 and in the `esnext` lib `tsconfig.json` names.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts` Expected: FAIL with `Error: Cannot find package '@/lib/chat/plan-state' imported from …/__tests__/chat-plan-state.test.ts` and the same for `@/components/shared-chat/activity-view`.

- [ ] **Step 3: The plan**

Create `lib/chat/plan-state.ts`:

```ts
import * as z from 'zod'

/*
 * The agent's plan (Part 2 spec §6.4; decision 47): shown above the composer when the conversation's state reads as
 * `{ steps: [{ description, status }] }`, the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example
 * (`Plan {steps: [{description, status}]}`; research `part2-hitl-state-files.md` §3.1, §3.2). State is "deliberately
 * unconstrained" and "an application MUST validate what it reads out of state before acting on it — rendering it"
 * (AG-UI 1.0 "State"), so it is read with zod and state of any other shape is not shown. Client-safe and pure: the plan
 * panel reads it.
 */

export interface PlanStep {
	description: string
	status: string
}

/** zod 4 "Objects": keys beside `steps`, and beside a step's two, are dropped. */
const planSchema = z.object({
	steps: z.array(z.object({ description: z.string(), status: z.string() })).min(1),
})

/** Spec §6.4: the state as `{ steps: [{ description, status }] }` with at least one step (zod), or null. */
export const planOf = (state: unknown): PlanStep[] | null => {
	const parsed = planSchema.safeParse(state)
	return parsed.success ? parsed.data.steps : null
}

/** An antd Steps item's status (antd 6.6.5 `es/steps/index.d.ts`, `StepItem.status`). */
export type PlanStepStatus = 'wait' | 'process' | 'finish' | 'error'

/** 2b's plan call P17: the template's statuses (`frontend/src/components/chat/research-panel.tsx`, 0.2.21). */
const STEP_STATUSES = new Map<string, PlanStepStatus>([
	['pending', 'wait'],
	['in_progress', 'process'],
	['completed', 'finish'],
	['blocked', 'error'],
])

/** P17: a step's status as an antd Steps status; any other status is `wait`, neutral (spec §6.4). */
export const planStepStatus = (status: string): PlanStepStatus =>
	STEP_STATUSES.get(status) ?? 'wait'

/**
 * P17: "Plan 2/5" counts the completed steps; the percent is the template's `Math.round((done / total) * 100)`; the plan
 * is complete, and the panel collapses itself, once every step is completed (spec §6.4). No steps: nothing done and
 * nothing complete (planOf never answers an empty plan).
 */
export const planProgress = (
	steps: readonly PlanStep[],
): { done: number; total: number; percent: number; complete: boolean } => {
	const done = steps.filter(step => step.status === 'completed').length
	const total = steps.length
	return {
		done,
		total,
		percent: total === 0 ? 0 : Math.round((done / total) * 100),
		complete: total > 0 && done === total,
	}
}
```

A `Map` and not an object literal: `STEP_STATUSES.get('toString')` is `undefined`, where an object's `['toString']` would answer `Object.prototype.toString`.

- [ ] **Step 4: The activity content**

Create `components/shared-chat/activity-view.ts`:

```ts
/*
 * An activity message's content as its card shows it (Part 2 spec §6.4; 2b's plan call P17): a flat object as antd
 * Descriptions, anything else as indented JSON in X CodeHighlighter; spec §6.4 caps the content at 10 KB, so content
 * whose JSON is longer shows as that JSON, cut, whatever its shape. AG-UI 1.0 "Activity": the content
 * "is an object, not text" and `activityType` is an open string a consumer "MUST tolerate", so every type renders alike,
 * read-only (research `part2-hitl-state-files.md`, Implications C.2). Pure and client-safe: the card puts what this
 * answers into text nodes, never HTML (spec §6.4).
 */

/** Spec §6.4's 10 KB cap on the JSON view, in characters counted as code points (as P7 counts lengths). */
export const ACTIVITY_JSON_MAX = 10_240

export type ActivityView =
	| { kind: 'fields'; items: { key: string; value: string }[] }
	| { kind: 'json'; text: string; truncated: boolean }

type Scalar = string | number | boolean | null

const isScalarEntry = (entry: [string, unknown]): entry is [string, Scalar] =>
	entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])

/**
 * P17: a flat object's entries: not an array, at least one key, every value a string, number, boolean or null. Null for
 * anything else.
 */
const flatEntries = (content: unknown): [string, Scalar][] | null => {
	if (typeof content !== 'object' || content === null || Array.isArray(content)) return null
	const entries = Object.entries(content)
	return entries.length > 0 && entries.every(isScalarEntry) ? entries : null
}

/**
 * The first `max` code points of `text`, or null when it has no more. A code point is one or two UTF-16 units, so a text
 * of at most `max` units fits; otherwise the string iterator, which yields code points (ECMAScript
 * `String.prototype[Symbol.iterator]`), finds the cut, so no surrogate pair is split.
 */
const cutAt = (text: string, max: number): string | null => {
	if (text.length <= max) return null
	let count = 0
	let end = 0
	for (const char of text) {
		if (count === max) return text.slice(0, end)
		count += 1
		end += char.length
	}
	return null
}

/**
 * P17: content whose indented JSON is longer than ACTIVITY_JSON_MAX as that JSON, cut; otherwise a flat object as fields
 * (values as `String(value)`) and anything else as the whole JSON.
 */
export const activityView = (content: unknown): ActivityView => {
	// JSON.stringify answers undefined, not text, for undefined (ECMA-262 SerializeJSONProperty): a missing content reads
	// as JSON's null, as JSON.stringify writes an undefined array element.
	const text = content === undefined ? 'null' : JSON.stringify(content, null, 2)
	const cut = cutAt(text, ACTIVITY_JSON_MAX)
	if (cut !== null) return { kind: 'json', text: cut, truncated: true }
	const entries = flatEntries(content)
	return entries
		? { kind: 'fields', items: entries.map(([key, value]) => ({ key, value: String(value) })) }
		: { kind: 'json', text, truncated: false }
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts` Expected: PASS, `Test Files  2 passed (2)`, `Tests  38 passed (38)` (25 and 13).

- [ ] **Step 6: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/plan-state.ts components/shared-chat/activity-view.ts __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts
pnpm exec oxfmt --check lib/chat/plan-state.ts components/shared-chat/activity-view.ts __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts
pnpm test
```

Expected: tsc exits 0, no oxlint finding, oxfmt "All matched files use the correct format", vitest 0 failed. No component renders yet, so the antd lint is unchanged (Task 14 adds the cards).

- [ ] **Step 7: Commit**

```bash
git add lib/chat/plan-state.ts components/shared-chat/activity-view.ts __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts
git commit -m "feat(chat): read the plan state and an activity's content for display

The conversation's state read with zod as a plan of steps, each step's
status as antd Steps' status and the plan's progress; an activity
message's content as fields when flat, else as indented JSON, and as
that JSON cut at 10,240 characters whenever it is longer (Part 2 spec
§6.4; plan call P17).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the four files; lint-staged changes nothing.

```json:metadata
{"files": ["lib/chat/plan-state.ts", "components/shared-chat/activity-view.ts", "__tests__/chat-plan-state.test.ts", "__tests__/shared-chat-activity-view.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-plan-state.test.ts __tests__/shared-chat-activity-view.test.ts", "acceptanceCriteria": ["planOf answers the steps of { steps: [{ description, status }] } with at least one step, other keys dropped, and null for any other state", "planStepStatus maps pending, in_progress, completed, blocked to wait, process, finish, error and anything else (toString and __proto__ included) to wait", "planProgress counts completed steps, rounds the percent (2/5 = 40, 1/3 = 33, 2/3 = 67), is complete only when every step is completed, and answers zeros and not complete for no steps", "activityView answers the cut JSON (truncated true, ACTIVITY_JSON_MAX code points, no split surrogate pair) whenever the indented JSON is over ACTIVITY_JSON_MAX, flat or not; otherwise fields for a flat non-empty object (values as String(value)) and the whole JSON for anything else, undefined as null", "tsc, oxlint, oxfmt clean; pnpm test 0 failed"], "modelTier": "mechanical"}
```

---

### Task 5: Turns: waiting calls, open items and refused runs

**Goal:** A tool call that a run ends without its result reads `waiting`, live and after a reload; a run the agent never started (`error.beforeStream`) continues nothing in the history's grouping; and the client-safe `lib/chat/open-items.ts` answers what the last turn waits for.

Plan call P9 revises 2a's P10: a call without a result at a run's success or interrupt end waits for an approval, an answer or the next run's `not_available` answer, so it is `waiting`, not `done` (AG-UI 1.0 "Tool Calls", Frontend tools: a consumer derives the pending calls from the stream, "every tool call the run started that received no result", and "On an interrupted run the pending calls are derived the same way"). The reducer and the grouping keep one rule, so a live turn and a reloaded one agree (spec §3.3): a call without its result takes the status of how the turn's last run ended. `waiting` stays `waiting` after a success or an interrupt and becomes `stopped` after a cancel or an error, in `applyAgUiEvent` as in `turnsFromMessages`. Plan call P10 (decision 62's first answer): in `turnsFromMessages`, the at-end status of a turn's calls and the last turn's interrupts come from the turn's last run without `error.beforeStream`, while every run, refused ones included, stays in `turn.runs` so its error shows. A run's error reaches the turn with RUN_ERROR's two fields only; the flag stays the store's. `openItemsOfTurn` is the browser's twin of the server's open items (Task 7): the turn's interrupts and, while the app's `askUser` is on, its `waiting` calls named `ASK_USER_TOOL_NAME` (Task 2). `ToolPart` moves to `lib/chat/turn.ts` (Shared contracts), and `components/shared-chat/turn-parts.ts` re-exports it. `ToolStatus` gains a member, so `tool-chain.tsx`'s exhaustive status map changes in this commit (Cross-task ordering). X 2.9.0's item status is `loading | success | error | abort` (`node_modules/@ant-design/x/es/thought-chain/Status.d.ts`), and `waiting` matches none of them, so a waiting item has no status and gets `icon: <HourglassOutlined />` (`node_modules/@ant-design/icons/es/icons/HourglassOutlined.js`, `@ant-design/icons` 6.3.4, already a dependency). `es/thought-chain/Status.js` draws a status's own icon when the item has one, else the item's `icon`. `es/thought-chain/Node.js` puts the item's number there when it has neither, so the icon is needed. The rest of `tool-chain.tsx` stays as it is; Task 11 rewrites it.

**Depends on:** Task 2 (`lib/chat/ask-user.ts`: `ASK_USER_TOOL_NAME`).

**Files:**

- Create: `lib/chat/open-items.ts`
- Modify: `lib/chat/turn.ts` (`ToolStatus`, `ToolPart`, `settleParts`, RUN_FINISHED, `TurnRunRow.error`, `toTurnRun`, `TOOL_STATUS_AT_END`, `turnsFromMessages`)
- Modify: `components/shared-chat/turn-parts.ts` (re-export `ToolPart`)
- Modify: `components/shared-chat/tool-chain.tsx` (the status map and the waiting item's icon)
- Test: `__tests__/chat-turn.test.ts` (2a's `done` expectations become `waiting`; two agreement scenarios; the refused run)
- Test: `__tests__/chat-open-items.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts` reports 2 files and 47 tests passed (36 and 11).
- [ ] Live, RUN_FINISHED with a success or interrupt outcome leaves a call without its result `waiting`, a cancelled one `stopped`; a later run's cancel or RUN_ERROR stops a call an earlier run of the turn left `waiting`, and its TOOL_CALL_RESULT makes it `done`.
- [ ] After a reload, a call without a tool message reads `waiting` when the turn's last run the agent started succeeded or was interrupted, `stopped` when it was cancelled, failed or truncated, `running` while it runs; the live and reloaded turns agree for the approval and `ask_user` scenarios and for a resumed run that is cancelled.
- [ ] A run stored with `error.beforeStream: true` after an interrupted run leaves the turn's interrupts and its `waiting` calls as the interrupted run left them, and shows in `turn.runs` as `{ runId, outcome: 'error', error: { code, message } }` without the flag; the same run failing without the flag ends the turn (no interrupts, calls `stopped`).
- [ ] `openItemsOfTurn` answers `NO_OPEN_ITEMS` (the same object) for no turn, a user turn or a turn with nothing open; the turn's interrupts whatever the switch; and its `waiting` `ask_user` calls in call order only while `askUser` is on. `hasOpenItems` is true when either list has an entry.
- [ ] `components/shared-chat/turn-parts.ts` re-exports `ToolPart` from `lib/chat/turn`; `tool-chain.tsx`'s `STATUS` covers all five statuses (`waiting: undefined`) and a waiting item carries `<HourglassOutlined />`.
- [ ] tsc, oxlint and oxfmt clean on the changed files; `pnpm test` green; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts` → `Test Files  2 passed (2)`, `Tests  47 passed (47)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

In `__tests__/chat-turn.test.ts`, make these replacements.

Replace:

```ts
/** A run started `minutes` after the first one. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 14, 10, minutes))
```

with:

```ts
/** A run started `minutes` after the first one. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 14, 10, minutes))
/** An approval (spec §6.1): a tool_call interrupt naming its call. */
const APPROVAL = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }
```

Replace the end of `SCENARIOS`:

```ts
			...text('m-2', 'Second.'),
			finished({ type: 'success' }),
		],
		{},
	],
]
```

with:

```ts
			...text('m-2', 'Second.'),
			finished({ type: 'success' }),
		],
		{},
	],
	[
		'approval: a gated call, then the interrupt (plan call P9)',
		[
			started,
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"path":"notes.txt"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			finished({ type: 'interrupt', interrupts: [APPROVAL] }),
		],
		{ status: 'interrupted', outcome: { type: 'interrupt', interrupts: [APPROVAL] } },
	],
	[
		'frontend: an ask_user call the run leaves unanswered (plan call P9)',
		[
			started,
			ev('TOOL_CALL_START', { toolCallId: 'call-2', toolCallName: 'ask_user' }),
			ev('TOOL_CALL_ARGS', {
				toolCallId: 'call-2',
				delta: '{"questions":[{"question":"Which city?"}]}',
			}),
			ev('TOOL_CALL_END', { toolCallId: 'call-2' }),
			finished({ type: 'success' }),
		],
		{},
	],
]
```

Replace:

```ts
	it('ends a run with its outcome, settles running tools and drops empty text (plan call P10)', () => {
```

with:

```ts
	it('ends a run with its outcome, settles running tools and drops empty text (plan call P9)', () => {
```

Replace:

```ts
			{ kind: 'tool', toolCallId: 'call-1', name: 'ask_user', args: '', status: 'done' },
```

with:

```ts
			{ kind: 'tool', toolCallId: 'call-1', name: 'ask_user', args: '', status: 'waiting' },
```

Replace:

```ts
expect(interrupt.interrupts).toEqual([{ id: 'i-1', reason: 'tool_call', toolCallId: 'call-1' }])
```

with:

```ts
expect(interrupt.interrupts).toEqual([{ id: 'i-1', reason: 'tool_call', toolCallId: 'call-1' }])
expect(interrupt.parts[0]).toMatchObject({ status: 'waiting' })
```

Replace:

```ts
		expect(turn.parts[0]).toMatchObject({ status: 'stopped' })
	})
	it('returns the same turn for events it does not render', () => {
```

with:

```ts
		expect(turn.parts[0]).toMatchObject({ status: 'stopped' })
	})
	it('lets the turn’s last run settle a call an earlier run left waiting (plan call P9)', () => {
		const interrupted = live([
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			finished({ type: 'interrupt', interrupts: [APPROVAL] }),
		])
		const resumed = applyAgUiEvent(interrupted, hubRun('run-2'))
		expect(resumed.parts[0]).toMatchObject({ status: 'waiting' })
		const end = (event: BaseEvent) => applyAgUiEvent(resumed, event).parts[0]
		expect(end(finished({ type: 'success' }))).toMatchObject({ status: 'waiting' })
		expect(end(finished({ type: 'cancelled' }))).toMatchObject({ status: 'stopped' })
		expect(end(ev('RUN_ERROR', { code: 'agent_error', message: 'Boom.' }))).toMatchObject({
			status: 'stopped',
		})
		expect(
			end(ev('TOOL_CALL_RESULT', { messageId: 'r-1', toolCallId: 'call-1', content: 'Deleted' })),
		).toMatchObject({ status: 'done', result: 'Deleted' })
	})
	it('returns the same turn for events it does not render', () => {
```

Replace the end of `'marks a call without a result by how its last run ended'` and of the `turnsFromMessages` block:

```ts
		expect(status({})).toMatchObject({ status: 'done' })
		expect(status({ status: 'running' })).toMatchObject({ status: 'running' })
		expect(status({ status: 'truncated' })).toMatchObject({ status: 'stopped' })
	})
})
```

with:

```ts
		expect(status({})).toMatchObject({ status: 'waiting' })
		expect(
			status({ status: 'interrupted', outcome: { type: 'interrupt', interrupts: [] } }),
		).toMatchObject({ status: 'waiting' })
		expect(status({ status: 'running' })).toMatchObject({ status: 'running' })
		expect(status({ status: 'cancelled' })).toMatchObject({ status: 'stopped' })
		expect(status({ status: 'failed', error: { message: 'Boom.' } })).toMatchObject({
			status: 'stopped',
		})
		expect(status({ status: 'truncated' })).toMatchObject({ status: 'stopped' })
	})

	// Plan call P10 (decision 62): a run the agent never started continues nothing; its error still shows.
	describe('a run refused before its stream', () => {
		const rows = [
			user('u-1', 'r-1', 'Delete it'),
			assistant('a-1', 'r-1', {
				toolCalls: [
					{ id: 'call-1', type: 'function', function: { name: 'delete_file', arguments: '{}' } },
				],
			}),
		]
		const interruptedRun = runRow({
			id: 'r-1',
			status: 'interrupted',
			outcome: { type: 'interrupt', interrupts: [APPROVAL] },
			startedAt: at(0),
		})
		const refused = runRow({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: {
				code: 'provider_unreachable',
				message: 'The agent is restarting, try again.',
				beforeStream: true,
			},
			startedAt: at(5),
		})

		it('leaves the turn’s interrupts and its waiting calls as the run before it left them', () => {
			const [, turn] = turnsFromMessages(rows, [interruptedRun, refused])
			expect(turn.turn.interrupts).toEqual([APPROVAL])
			expect(turn.turn.parts).toEqual([
				{ kind: 'tool', toolCallId: 'call-1', name: 'delete_file', args: '{}', status: 'waiting' },
			])
		})

		it('still shows the refused run in the turn’s runs, with its error and without the store’s flag', () => {
			const [, turn] = turnsFromMessages(rows, [interruptedRun, refused])
			expect(turn.turn.runs).toEqual([
				{ runId: 'r-1', outcome: 'interrupt' },
				{
					runId: 'r-2',
					outcome: 'error',
					error: { code: 'provider_unreachable', message: 'The agent is restarting, try again.' },
				},
			])
		})

		it('ends the turn when the run failed in its stream instead: no interrupt, the call stopped', () => {
			const inStream = runRow({
				...refused,
				error: { code: 'agent_error', message: 'Boom.' },
			})
			const [, turn] = turnsFromMessages(rows, [interruptedRun, inStream])
			expect(turn.turn.interrupts).toEqual([])
			expect(turn.turn.parts[0]).toMatchObject({ status: 'stopped' })
		})

		it('stops the calls when the last run the agent started was cancelled, as the live turn does', () => {
			const cancelled = runRow({
				id: 'r-2',
				status: 'cancelled',
				outcome: { type: 'cancelled' },
				startedAt: at(3),
			})
			const later = runRow({ ...refused, id: 'r-3', startedAt: at(6) })
			const [, turn] = turnsFromMessages(rows, [interruptedRun, cancelled, later])
			expect(turn.turn.interrupts).toEqual([])
			expect(turn.turn.parts[0]).toMatchObject({ status: 'stopped' })
			const resumedLive = [
				hubRun('run-2'),
				ev('RUN_FINISHED', { threadId: THREAD, runId: 'run-2', outcome: { type: 'cancelled' } }),
			].reduce(
				applyAgUiEvent,
				live([
					ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
					ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{}' }),
					ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
					finished({ type: 'interrupt', interrupts: [APPROVAL] }),
				]),
			)
			expect(resumedLive.parts).toEqual(turn.turn.parts)
			expect(resumedLive.interrupts).toEqual([])
		})

		it('carries no interrupts on a turn whose only runs were refused', () => {
			const turns = turnsFromMessages(
				[user('u-1', 'r-1', 'Hi')],
				[runRow({ ...refused, id: 'r-1', startedAt: at(0) })],
			)
			expect(turns[1].turn).toMatchObject({
				interrupts: [],
				runs: [{ runId: 'r-1', outcome: 'error' }],
			})
		})
	})
})
```

Create `__tests__/chat-open-items.test.ts`:

```ts
import type { BaseEvent, Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { hasOpenItems, NO_OPEN_ITEMS, openItemsOfTurn } from '@/lib/chat/open-items'
import {
	applyAgUiEvent,
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	turnsFromMessages,
	userTurn,
	type ToolPart,
	type Turn,
	type TurnMessageRow,
	type TurnRunRow,
} from '@/lib/chat/turn'

/** An AG-UI event as the wire carries it (the reducer reads `type` as a string). */
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const hubRun = (runId: string) =>
	ev('CUSTOM', { name: HUB_RUN_EVENT, value: { conversationId: 'c-1', runId, title: 'Hi' } })
const call = (toolCallId: string, name: string, args = '{}') => [
	ev('TOOL_CALL_START', { toolCallId, toolCallName: name }),
	ev('TOOL_CALL_ARGS', { toolCallId, delta: args }),
	ev('TOOL_CALL_END', { toolCallId }),
]
const finished = (outcome: Record<string, unknown>) =>
	ev('RUN_FINISHED', { threadId: 'c-1', runId: 'run-1', outcome })
const live = (events: BaseEvent[], from: Turn = emptyAssistantTurn()): Turn =>
	[hubRun('run-1'), ...events].reduce(applyAgUiEvent, from)

const QUESTION_ARGS = '{"questions":[{"question":"Which city?"}]}'
const approval = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-9' }
const toolPart = (over: Partial<ToolPart> = {}): ToolPart => ({
	kind: 'tool',
	toolCallId: 'call-1',
	name: ASK_USER_TOOL_NAME,
	args: QUESTION_ARGS,
	status: 'waiting',
	...over,
})
const turnWith = (parts: Turn['parts'], interrupts: Turn['interrupts'] = []): Turn => ({
	...emptyAssistantTurn(),
	parts,
	interrupts,
})

describe('openItemsOfTurn (spec §3.3, §6; decision 62)', () => {
	it('answers nothing for no turn or a user turn, as the one NO_OPEN_ITEMS', () => {
		expect(openItemsOfTurn(undefined, true)).toBe(NO_OPEN_ITEMS)
		expect(openItemsOfTurn(userTurn('u-1', 'Hi'), true)).toBe(NO_OPEN_ITEMS)
		expect(openItemsOfTurn(emptyAssistantTurn(), true)).toBe(NO_OPEN_ITEMS)
	})

	it('answers the turn’s interrupts, whatever the switch', () => {
		const turn = turnWith([toolPart({ toolCallId: 'call-9', name: 'delete_file' })], [approval])
		for (const askUser of [true, false])
			expect(openItemsOfTurn(turn, askUser)).toEqual({ interrupts: [approval], questions: [] })
	})

	it('answers the waiting ask_user calls in call order while the switch is on, none while it is off', () => {
		const first = toolPart({ toolCallId: 'call-1' })
		const second = toolPart({ toolCallId: 'call-2' })
		const turn = turnWith([
			first,
			{ kind: 'text', messageId: 'm-1', text: 'Two questions.' },
			second,
		])
		expect(openItemsOfTurn(turn, true)).toEqual({ interrupts: [], questions: [first, second] })
		expect(openItemsOfTurn(turn, false)).toBe(NO_OPEN_ITEMS)
	})

	it('leaves out an ask_user call that runs, has an answer, failed or stopped, and another tool’s waiting call', () => {
		const turn = turnWith([
			toolPart({ toolCallId: 'running', status: 'running' }),
			toolPart({ toolCallId: 'done', status: 'done', result: 'Q: Which city?\nA: Paris' }),
			toolPart({ toolCallId: 'error', status: 'error', error: 'invalid_arguments' }),
			toolPart({ toolCallId: 'stopped', status: 'stopped' }),
			toolPart({ toolCallId: 'other', name: 'ask_user_question' }),
		])
		expect(openItemsOfTurn(turn, true)).toBe(NO_OPEN_ITEMS)
	})

	it('answers both kinds when an interrupted run also left an ask_user call', () => {
		const question = toolPart()
		const turn = turnWith(
			[question, toolPart({ toolCallId: 'call-9', name: 'delete_file' })],
			[approval],
		)
		expect(openItemsOfTurn(turn, true)).toEqual({ interrupts: [approval], questions: [question] })
	})
})

describe('open items of the live turn (plan call P9)', () => {
	it('opens an ask_user call the run ended without an answer, and closes it when the call has its result', () => {
		const turn = live([
			...call('call-1', ASK_USER_TOOL_NAME, QUESTION_ARGS),
			finished({ type: 'success' }),
		])
		expect(openItemsOfTurn(turn, true).questions.map(part => part.toolCallId)).toEqual(['call-1'])
		const answered = applyAgUiEvent(
			turn,
			ev('TOOL_CALL_RESULT', {
				messageId: 'r-1',
				toolCallId: 'call-1',
				content: 'Q: Which city?\nA: Paris',
			}),
		)
		expect(openItemsOfTurn(answered, true)).toBe(NO_OPEN_ITEMS)
	})

	it('opens nothing while the run runs, nor once a cancel stopped the call', () => {
		const running = live(call('call-1', ASK_USER_TOOL_NAME, QUESTION_ARGS))
		expect(openItemsOfTurn(running, true)).toBe(NO_OPEN_ITEMS)
		expect(openItemsOfTurn(applyAgUiEvent(running, finished({ type: 'cancelled' })), true)).toBe(
			NO_OPEN_ITEMS,
		)
	})

	it('answers an interrupted run’s interrupts, and nothing once the answering run starts', () => {
		const interrupted = live([
			...call('call-9', 'delete_file'),
			finished({ type: 'interrupt', interrupts: [approval] }),
		])
		expect(openItemsOfTurn(interrupted, false)).toEqual({ interrupts: [approval], questions: [] })
		expect(openItemsOfTurn(applyAgUiEvent(interrupted, hubRun('run-2')), false)).toBe(NO_OPEN_ITEMS)
	})
})

describe('open items of a reloaded turn (plan call P10)', () => {
	const user: TurnMessageRow = {
		messageId: 'u-1',
		runId: 'r-1',
		role: 'user',
		body: { id: 'u-1', role: 'user', content: 'Plan my trip' },
		status: 'complete',
	}
	const asking: Message = {
		id: 'a-1',
		role: 'assistant',
		toolCalls: [
			{
				id: 'call-1',
				type: 'function',
				function: { name: ASK_USER_TOOL_NAME, arguments: QUESTION_ARGS },
			},
		],
	}
	const rows: TurnMessageRow[] = [
		user,
		{ messageId: 'a-1', runId: 'r-1', role: 'assistant', body: asking, status: 'complete' },
	]
	const run = (over: Partial<TurnRunRow>): TurnRunRow => ({
		id: 'r-1',
		status: 'succeeded',
		outcome: { type: 'success' },
		error: null,
		custom: [],
		startedAt: new Date('2026-10-14T10:00:00Z'),
		...over,
	})
	const lastTurn = (runs: TurnRunRow[]) => turnsFromMessages(rows, runs).at(-1)?.turn

	it('keeps the question open after an answering run the agent refused before its stream', () => {
		const refused = run({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: {
				code: 'provider_unreachable',
				message: 'The agent is restarting, try again.',
				beforeStream: true,
			},
			startedAt: new Date('2026-10-14T10:05:00Z'),
		})
		const open = openItemsOfTurn(lastTurn([run({}), refused]), true)
		expect(hasOpenItems(open)).toBe(true)
		expect(open.questions.map(part => part.toolCallId)).toEqual(['call-1'])
	})

	it('closes it once a run the agent started failed after it', () => {
		const failed = run({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: { code: 'agent_error', message: 'Boom.' },
			startedAt: new Date('2026-10-14T10:05:00Z'),
		})
		expect(openItemsOfTurn(lastTurn([run({}), failed]), true)).toBe(NO_OPEN_ITEMS)
	})
})

describe('hasOpenItems', () => {
	it('is true when an interrupt or a question is open', () => {
		expect(hasOpenItems(NO_OPEN_ITEMS)).toBe(false)
		expect(hasOpenItems({ interrupts: [approval], questions: [] })).toBe(true)
		expect(hasOpenItems({ interrupts: [], questions: [toolPart()] })).toBe(true)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts`

Expected: FAIL. `chat-open-items.test.ts` does not load (`Cannot find package '@/lib/chat/open-items'`); in `chat-turn.test.ts`, 6 tests fail: "ends a run with its outcome, …", "lets the turn’s last run settle a call an earlier run left waiting", "marks a call without a result by how its last run ended", and three of "a run refused before its stream" (the interrupts come back `[]`, the error carries `beforeStream`, the cancelled run's live turn reads `done`). The two new agreement scenarios pass already (both sides read `done` before this task): they are there to keep the two sides agreeing after it. `Tests  6 failed | 30 passed (36)`.

- [ ] **Step 3: Implement the turn changes**

In `lib/chat/turn.ts`, make these replacements.

Replace:

```ts
/** Plan call P10: running until its result; done with one; error for a tool message with an error; stopped when cut off. */
export type ToolStatus = 'running' | 'done' | 'error' | 'stopped'
```

with:

```ts
/**
 * Plan call P9 (2b's revision of 2a's P10): running while its run runs; waiting when the run ended (success or
 * interrupt) without its result, for an approval, an answer or the next run's `not_available` answer (AG-UI 1.0 "Tool
 * Calls", Frontend tools: the pending calls are "every tool call the run started that received no result", on an
 * interrupted run too); done with one; error for a tool message with an error; stopped when cut off.
 */
export type ToolStatus = 'running' | 'waiting' | 'done' | 'error' | 'stopped'
```

Replace:

```ts
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }
```

with:

```ts
	| { kind: 'activity'; messageId: string; activityType: string; content: unknown }

/** A tool call's part: the ThoughtChain items, the hub's tool cards and the open items read it. */
export type ToolPart = Extract<TurnPart, { kind: 'tool' }>
```

Replace:

```ts
/** The last run's open interrupts (spec §3.3); 2b renders them. */
```

with:

```ts
/** The open interrupts of the turn's last run the agent started (spec §3.3, plan call P10). */
```

Replace:

```ts
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
```

with:

```ts
/**
 * A run's end settles its parts (plan call P9). A call without its result, still running or left waiting by an earlier
 * run of the turn, waits after a success or an interrupt and is stopped after a cancel or an error: the turn's last run
 * decides, as `turnsFromMessages` decides after a reload. An empty text part goes: Pydantic AI opens an empty text
 * message before its tool calls (spike), and the stored assistant message of it has no content, so the live turn and the
 * reloaded one agree.
 */
const settleParts = (parts: TurnPart[], tools: ToolStatus): TurnPart[] =>
	parts
		.filter(part => !(part.kind === 'text' && part.text === ''))
		.map(part =>
			part.kind === 'tool' && (part.status === 'running' || part.status === 'waiting')
				? { ...part, status: tools }
				: part,
		)
```

Replace (in `applyAgUiEvent`'s `RUN_FINISHED` case):

```ts
				parts: settleParts(turn.parts, cancelled ? 'stopped' : 'done'),
```

with:

```ts
				parts: settleParts(turn.parts, cancelled ? 'stopped' : 'waiting'),
```

Replace (in `TurnRunRow`):

```ts
	error: { code?: string; message: string } | null
```

with:

```ts
	/** `beforeStream` (plan call P10): the agent never started this run, so it continues nothing. */
	error: { code?: string; message: string; beforeStream?: true } | null
```

Replace:

```ts
const toTurnRun = (run: TurnRunRow): TurnRun => {
	const reason = cancelledReasonOf(run.custom)
	return {
		runId: run.id,
		outcome: runOutcomeOf(run.status),
		...(run.error ? { error: run.error } : {}),
		...(reason ? { cancelledReason: reason } : {}),
	}
}
```

with:

```ts
/** A stored error as the turn shows it, with RUN_ERROR's two fields (applyAgUiEvent); the refusal flag is the store's. */
const turnErrorOf = ({
	code,
	message,
}: NonNullable<TurnRunRow['error']>): NonNullable<TurnRun['error']> =>
	code === undefined ? { message } : { code, message }

const toTurnRun = (run: TurnRunRow): TurnRun => {
	const reason = cancelledReasonOf(run.custom)
	return {
		runId: run.id,
		outcome: runOutcomeOf(run.status),
		...(run.error ? { error: turnErrorOf(run.error) } : {}),
		...(reason ? { cancelledReason: reason } : {}),
	}
}

/**
 * Plan call P10: a run the agent never started (refused before its stream, or the hub failed before sending it) does not
 * continue its turn, so the turn's calls and open interrupts are what the run before it left; its error still shows.
 */
const continues = (run: TurnRunRow | undefined): run is TurnRunRow =>
	run !== undefined && run.error?.beforeStream !== true
```

Replace:

```ts
const TOOL_STATUS_AT_END: Record<RunOutcome, ToolStatus> = {
	running: 'running',
	success: 'done',
	interrupt: 'done',
```

with:

```ts
/** Plan call P9: what a call without a tool message reads by how the turn's last run ended (applyAgUiEvent's settleParts). */
const TOOL_STATUS_AT_END: Record<RunOutcome, ToolStatus> = {
	running: 'running',
	success: 'waiting',
	interrupt: 'waiting',
```

Replace (in `turnsFromMessages`'s comment):

```ts
 * row up to the next user message, across the runs that resumed it. The last turn carries the open interrupts while its
 * last run is interrupted, so they survive a reload.
```

with:

```ts
 * row up to the next user message, across the runs that resumed it. A call without a tool message reads how the turn's
 * last run ended, and the last turn carries the open interrupts while that run is interrupted, so they survive a reload;
 * that run is the last one the agent started (plan call P10), while every run, a refused one included, shows in `runs`.
```

Replace:

```ts
const atEnd = TOOL_STATUS_AT_END[turnRuns.at(-1)?.outcome ?? 'success']
```

with:

```ts
const continued = ordered.map(id => runById.get(id)).findLast(continues)
const atEnd = TOOL_STATUS_AT_END[continued ? runOutcomeOf(continued.status) : 'success']
```

Replace:

```ts
const lastTurn = turns.at(-1)
const lastRun = lastTurn?.turn.runs.at(-1)
if (lastTurn && lastRun?.outcome === 'interrupt')
	lastTurn.turn = {
		...lastTurn.turn,
		interrupts: interruptsOf(runById.get(lastRun.runId)?.outcome),
	}
return turns
```

with:

```ts
const lastTurn = turns.at(-1)
const continued = lastTurn?.turn.runs.map(run => runById.get(run.runId)).findLast(continues)
if (lastTurn && continued?.status === 'interrupted')
	lastTurn.turn = { ...lastTurn.turn, interrupts: interruptsOf(continued.outcome) }
return turns
```

- [ ] **Step 4: Create the open items**

Create `lib/chat/open-items.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'

import { ASK_USER_TOOL_NAME } from './ask-user'
import type { ToolPart, Turn } from './turn'

/*
 * What the conversation waits for, read from the turn the browser shows (Part 2 spec §3.3, §6; decision 50: while
 * anything is open, the composer is blocked and every card has a way out). Client-safe: the browser's hook and cards
 * read it; the server's twin is lib/chat/answers.ts `openItemsOf`, which reads the store. `@ag-ui/core` is imported for
 * its types only (spec §9).
 */

/** What the conversation's last turn waits for (spec §3.3, §6): its interrupts and, while askUser is on, its waiting ask_user calls. */
export interface TurnOpenItems {
	interrupts: Interrupt[]
	questions: ToolPart[]
}

/** Nothing open: one object, so a memo that answers it keeps its identity between renders. */
export const NO_OPEN_ITEMS: TurnOpenItems = { interrupts: [], questions: [] }

/**
 * The turn's open interrupts (its last run the agent started ended on them: lib/chat/turn.ts, plan call P10) and, while
 * the app advertises ask_user, its calls to that tool still waiting for an answer (plan call P9), in call order. The
 * switch is the app's current one (decision 62, as CopilotKit, assistant-ui and the full-stack template read theirs): a
 * call left waiting while it is off does not block the composer, and the next run answers it as a call to a tool the
 * hub does not advertise (spec §6.2). A user turn, or no turn, waits for nothing.
 */
export const openItemsOfTurn = (turn: Turn | undefined, askUser: boolean): TurnOpenItems => {
	if (turn?.role !== 'assistant') return NO_OPEN_ITEMS
	const questions = askUser
		? turn.parts.filter(
				(part): part is ToolPart =>
					part.kind === 'tool' && part.name === ASK_USER_TOOL_NAME && part.status === 'waiting',
			)
		: []
	return turn.interrupts.length > 0 || questions.length > 0
		? { interrupts: turn.interrupts, questions }
		: NO_OPEN_ITEMS
}

/** Whether anything is open (the browser's twin of lib/chat/answers.ts `anyOpen`). */
export const hasOpenItems = (open: TurnOpenItems): boolean =>
	open.interrupts.length > 0 || open.questions.length > 0
```

- [ ] **Step 5: Move `ToolPart` and keep the status map exhaustive**

In `components/shared-chat/turn-parts.ts`, replace:

```ts
import type { TurnPart } from '@/lib/chat/turn'

export type ToolPart = Extract<TurnPart, { kind: 'tool' }>
```

with:

```ts
import type { ToolPart, TurnPart } from '@/lib/chat/turn'

export type { ToolPart }
```

In `components/shared-chat/tool-chain.tsx`, make these replacements.

Replace:

```tsx
'use client'

import { CodeHighlighter, ThoughtChain } from '@ant-design/x'
```

with:

```tsx
'use client'

import { HourglassOutlined } from '@ant-design/icons'
import { CodeHighlighter, ThoughtChain } from '@ant-design/x'
```

Replace:

```tsx
/** ThoughtChain's item statuses (X 2.9.0 `es/thought-chain/Status.d.ts`) for the tool part's (plan call P10). */
const STATUS: Record<ToolStatus, NonNullable<ThoughtChainItemType['status']>> = {
	running: 'loading',
	done: 'success',
```

with:

```tsx
/**
 * ThoughtChain's item statuses (X 2.9.0 `es/thought-chain/Status.d.ts`: loading, success, error, abort) for the tool
 * part's (plan calls P9, P10). A waiting call has none of the four: its item shows an hourglass `icon` and no status
 * colour (`es/thought-chain/Status.js` draws a status's own icon when the item has a status, else the item's `icon`;
 * `Node.js` puts the item's number there when it has neither).
 */
const STATUS: Record<ToolStatus, ThoughtChainItemType['status']> = {
	running: 'loading',
	waiting: undefined,
	done: 'success',
```

Replace:

```tsx
				status: STATUS[tool.status],
				blink: tool.status === 'running',
```

with:

```tsx
				status: STATUS[tool.status],
				icon: tool.status === 'waiting' ? <HourglassOutlined /> : undefined,
				blink: tool.status === 'running',
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts`

Expected: PASS, `Test Files  2 passed (2)`, `Tests  47 passed (47)`.

- [ ] **Step 7: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/turn.ts lib/chat/open-items.ts components/shared-chat/turn-parts.ts components/shared-chat/tool-chain.tsx __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts
pnpm exec oxfmt --check lib/chat/turn.ts lib/chat/open-items.ts components/shared-chat/turn-parts.ts components/shared-chat/tool-chain.tsx __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0 (a `Record<ToolStatus, …>` without `waiting` would fail here); no oxlint finding; "All matched files use the correct format."; vitest 0 failed; the antd lint's `"total": 0`.

- [ ] **Step 8: Commit**

```bash
git add lib/chat/turn.ts lib/chat/open-items.ts components/shared-chat/turn-parts.ts components/shared-chat/tool-chain.tsx __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts
git commit -m "feat(chat): waiting tool calls, the turn's open items and refused runs

A call a run ends without its result waits (plan call P9): live and after a
reload, the turn's last run decides how a call without a result reads, and a run
the agent never started (error.beforeStream) continues nothing while its error
still shows (P10). lib/chat/open-items.ts answers what the last turn waits for:
its interrupts and, while ask_user is advertised, its waiting ask_user calls.
The ThoughtChain item of a waiting call shows an hourglass (Part 2 spec §3.3, §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/turn.ts", "lib/chat/open-items.ts", "components/shared-chat/turn-parts.ts", "components/shared-chat/tool-chain.tsx", "__tests__/chat-turn.test.ts", "__tests__/chat-open-items.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-turn.test.ts __tests__/chat-open-items.test.ts", "acceptanceCriteria": ["chat-turn.test.ts and chat-open-items.test.ts report 47 tests passed (36 and 11)", "live, RUN_FINISHED success or interrupt leaves a call without its result waiting, cancelled stops it; a later run's cancel or RUN_ERROR stops a call an earlier run left waiting; its TOOL_CALL_RESULT makes it done", "after a reload a call without a tool message reads waiting after a success or interrupt of the turn's last run the agent started, stopped after cancelled, failed or truncated, running while it runs; live and reloaded turns agree for the approval and ask_user scenarios and a cancelled resumed run", "a run stored with error.beforeStream after an interrupted run keeps the turn's interrupts and waiting calls and shows in turn.runs with { code, message } only; the same run without the flag ends the turn", "openItemsOfTurn answers NO_OPEN_ITEMS for no turn, a user turn or nothing open; the interrupts whatever the switch; waiting ask_user calls in call order only while askUser is on; hasOpenItems is true when either list has an entry", "turn-parts.ts re-exports ToolPart from lib/chat/turn; tool-chain.tsx's STATUS covers five statuses and a waiting item carries HourglassOutlined", "tsc, oxlint, oxfmt clean; pnpm test green; antd CLI lint total 0"], "modelTier": "standard"}
```

---

### Task 6: The store: the continued run and withdrawn answers

**Goal:** `lib/data/conversations.ts` stores and reads the refusal flag `error.beforeStream`, answers the run a conversation continues from (`continuedRun`, replacing 2a's `lastRun`), and deletes the answers a refused run carried in the transaction that ends it (`RunEnd.withdraw`), proven on a live PostgreSQL.

Plan call P10 (decision 62's first answer: an answer that never reaches the agent keeps its item open). When the agent refuses an answering run before its stream (spec §4.3 step 4), or the hub fails before sending it, Task 8 stores the run `failed` with `error.beforeStream: true` and passes the `ask_user` answer messages the run carried as `withdraw`. This task gives the store the three pieces that needs. `RunError.beforeStream` and its zod reader: zod 4 "Literals" (`z.literal(true)`) and "Objects" (an object drops keys it does not declare, so 2a's reader drops the flag today). `continuedRun`, the newest run whose `error` does not carry the flag, which the server's open items (Task 7, through `run.ts`) and the history (Task 5's `turnsFromMessages`, the same rule in memory) read. `error ->> 'beforeStream'` answers the flag as text and NULL when `error` is NULL or has no such key (PostgreSQL 18 "JSON Functions and Operators", §9.16.1, Table 9.47 and its note: the extraction operators "return NULL, rather than failing, if the JSON input does not have the right structure to match the request; for example if no such key or array element exists"), and `coalesce` reads NULL as not refused. The condition is a Drizzle `sql` template inside `and()` (Drizzle "Magical sql operator": columns are mapped to their escaped names; the 2a code's `listConversations` writes its keyset condition the same way). `withdraw` is a `DELETE … WHERE conversation_id AND run_id AND message_id IN (…)` (Drizzle "Delete" with `and`, `eq`, `inArray`, "Filters"). It runs inside `finishRun`'s transaction, after the `UPDATE … WHERE status = 'running' RETURNING`, so it runs only when this call ended the run, and no request sees the run ended with its answers still stored (Cross-task ordering). The resume entries stay on the run's row for the Logs. No migration: the flag lives in the `error` jsonb (Global Constraints). `lib/chat/run.ts` and `__tests__/chat-run.test.ts` name `lastRun`, so this task renames those references and nothing else; Task 8 changes `run.ts`'s logic.

**Files:**

- Modify: `lib/data/conversations.ts` (`RunError`, `runErrorSchema`, `lastRun` → `continuedRun`, `RunEnd.withdraw`, `finishRun`)
- Modify: `lib/chat/run.ts` (the import and the one call: `lastRun` → `continuedRun`)
- Modify: `__tests__/chat-run.test.ts` (the DAL mock's `lastRun` key and its five uses → `continuedRun`)
- Test: `__tests__/db/conversations-run.db.test.ts` (`lastRun` → `continuedRun`; a new `describe` for P10)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts` reports 18 passed (12 of 2a's, 6 new).
- [ ] `continuedRun` answers the run before a run stored with `error.beforeStream: true`; a run with a NULL error, or with an error without the flag, is answered as the continued run; null before the first run.
- [ ] The stored error keeps `{ code, message, beforeStream: true }` in the `error` jsonb, and the run reader (`readThreadPage`'s runs) answers it with the flag.
- [ ] `finishRun` with `withdraw` deletes only the named rows of this run: a row of another run named in the list and an unnamed row of this run stay; the run is `failed` and the conversation's active run is cleared.
- [ ] The withdrawal is part of the end's transaction: an end whose last insert fails leaves the named row stored and the run `running`; a second `finishRun` on an ended run withdraws nothing.
- [ ] `lib/chat/run.ts` and `__tests__/chat-run.test.ts` name `continuedRun` and no `lastRun`; tsc, oxlint and oxfmt clean; `pnpm test` and `pnpm test:db` green.

**Verify:** `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts` → `Tests  18 passed (18)`

**Steps:**

- [ ] **Step 1: Write the failing database test**

`__tests__/db/` runs against the e2e PostgreSQL on 127.0.0.1:5433: `global-setup.ts` starts it, recreates and migrates `hub_dal`, and stops it afterwards; each file mocks `@/db` with `database.ts`'s `testDb` and empties the tables before each test (`resetTables`). Never run it beside `pnpm test:e2e`.

In `__tests__/db/conversations-run.db.test.ts`, make these replacements.

Replace:

```ts
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
```

with:

```ts
import {
	errorToolMessage,
	STOPPED_TOOL_CONTENT,
	threadForAgent,
	UNAVAILABLE_TOOL_CONTENT,
	UNAVAILABLE_TOOL_ERROR,
} from '@/lib/chat/thread'
import {
	continuedRun,
	finishRun,
	findConversation,
	loadThread,
	readThreadPage,
	saveMessages,
	saveState,
	startRun,
	truncateStaleRun,
	type RunEnd,
	type RunKey,
} from '@/lib/data/conversations'
```

Replace:

```ts
		expect(await lastRun(key.conversationId)).toMatchObject({
			id: key.runId,
```

with:

```ts
		expect(await continuedRun(key.conversationId)).toMatchObject({
			id: key.runId,
```

Replace:

```ts
		expect(await lastRun(key.conversationId)).toMatchObject({
			status: 'cancelled',
```

with:

```ts
		expect(await continuedRun(key.conversationId)).toMatchObject({
			status: 'cancelled',
```

Replace:

```ts
expect((await lastRun(key.conversationId))?.status).toBe('truncated')
```

with:

```ts
expect((await continuedRun(key.conversationId))?.status).toBe('truncated')
```

Replace:

```ts
describe('the run tables, read back as written', () => {
```

with:

```ts
// Plan call P10 (decision 62): an answering run the agent never started keeps what it answered open.
describe('a run refused before its stream (plan call P10)', () => {
	let actor: Actor
	let appId: string
	beforeEach(async () => {
		actor = actorFor()
		await insertAccount(actor)
		appId = await insertApp()
	})

	const REFUSAL = {
		code: 'provider_unreachable',
		message: 'The agent is restarting, try again.',
		beforeStream: true,
	} as const
	const refusedEnd = (withdraw?: string[]): RunEnd => ({
		status: 'failed',
		error: REFUSAL,
		custom: [],
		...(withdraw ? { withdraw } : {}),
	})

	/** The next run on the conversation, started with the given messages (an answering run carries tool messages). */
	const answering = async (conversationId: string, messages: Message[]): Promise<RunKey> => {
		const result = await startRun(actor, {
			appId,
			conversation: { id: conversationId },
			runId: crypto.randomUUID(),
			messages,
		})
		if (!result.ok) throw new Error(result.code)
		return result.key
	}
	const askUserAnswer = (toolCallId: string): Message => ({
		id: crypto.randomUUID(),
		role: 'tool',
		toolCallId,
		content: 'Q: Which city?\nA: Paris',
	})
	/** A first run that asked with ask_user and ended; answers its key and the assistant message's id. */
	const asked = async () => {
		const key = await begin(actor, appId)
		const askingId = crypto.randomUUID()
		await saveMessages(key, [
			{
				message: {
					id: askingId,
					role: 'assistant',
					toolCalls: [
						{ id: 'call-1', type: 'function', function: { name: 'ask_user', arguments: '{}' } },
					],
				},
				status: 'complete',
			},
		])
		await done(key)
		return { key, askingId }
	}

	it('is passed over: continuedRun answers the run before it', async () => {
		const first = await begin(actor, appId)
		await finishRun(first, {
			status: 'interrupted',
			outcome: { type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'input_required' }] },
			custom: [],
		})
		const refused = await answering(first.conversationId, [])
		await finishRun(refused, refusedEnd())
		expect(await continuedRun(first.conversationId)).toMatchObject({
			id: first.runId,
			status: 'interrupted',
			outcome: { type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'input_required' }] },
		})
	})

	it('leaves runs without an error, or with an error without the flag, as the continued run', async () => {
		const key = await begin(actor, appId)
		expect((await continuedRun(key.conversationId))?.id).toBe(key.runId)
		await done(key)
		expect(await continuedRun(key.conversationId)).toMatchObject({ id: key.runId, error: null })
		const failed = await answering(key.conversationId, [userMessage('Again')])
		await finishRun(failed, {
			status: 'failed',
			error: { code: 'agent_rejected_input', message: 'The agent refused the request.' },
			custom: [],
		})
		expect(await continuedRun(key.conversationId)).toMatchObject({
			id: failed.runId,
			error: { code: 'agent_rejected_input', message: 'The agent refused the request.' },
		})
	})

	it('keeps the flag on the stored error and reads it back', async () => {
		const first = await begin(actor, appId)
		await done(first)
		const refused = await answering(first.conversationId, [])
		await finishRun(refused, refusedEnd())
		const [stored] = await testDb
			.select({ error: conversationRuns.error })
			.from(conversationRuns)
			.where(eq(conversationRuns.id, refused.runId))
		expect(stored?.error).toEqual(REFUSAL)
		const page = await readThreadPage(actor, appId, first.conversationId, { turns: 20 })
		expect(page?.runs.find(run => run.id === refused.runId)).toMatchObject({
			status: 'failed',
			error: REFUSAL,
		})
	})

	it('withdraws only the rows it names of this run, with the run’s end', async () => {
		const { key: first, askingId } = await asked()
		const answer = askUserAnswer('call-1')
		const unavailable = errorToolMessage('call-2', UNAVAILABLE_TOOL_ERROR, UNAVAILABLE_TOOL_CONTENT)
		const refused = await answering(first.conversationId, [unavailable, answer])
		// The first run's assistant message is named too: it is another run's row, so it stays.
		await finishRun(refused, refusedEnd([answer.id, askingId]))
		const ids = (await loadThread(first.conversationId)).map(row => row.messageId)
		expect(ids).not.toContain(answer.id)
		expect(ids).toContain(askingId)
		expect(ids).toContain(unavailable.id)
		expect(await continuedRun(first.conversationId)).toMatchObject({ id: first.runId })
		const conversation = await findConversation(actor, appId, first.conversationId)
		expect(conversation?.activeRunId).toBeNull()
		const page = await readThreadPage(actor, appId, first.conversationId, { turns: 20 })
		expect(page?.runs.find(run => run.id === refused.runId)?.status).toBe('failed')
	})

	// PostgreSQL 18 Glossary, "Atomicity": "either all its operations complete as a single unit or none do". A tool message
	// whose id is already stored breaks the end's last insert (UNIQUE (conversation_id, message_id)), so the withdrawal is
	// rolled back with the rest of the end.
	it('withdraws in the transaction that ends the run: an end that fails withdraws nothing', async () => {
		const { key: first, askingId } = await asked()
		const answer = askUserAnswer('call-1')
		const refused = await answering(first.conversationId, [answer])
		const clash = { ...askUserAnswer('call-9'), id: askingId }
		await expect(
			finishRun(refused, {
				...refusedEnd([answer.id]),
				close: { messageIds: [], toolMessages: [clash] },
			}),
		).rejects.toThrow()
		expect((await loadThread(first.conversationId)).map(row => row.messageId)).toContain(answer.id)
		expect((await continuedRun(first.conversationId))?.id).toBe(refused.runId)
		expect((await continuedRun(first.conversationId))?.status).toBe('running')
	})

	it('withdraws nothing from a run that has already ended', async () => {
		const { key: first } = await asked()
		const answer = askUserAnswer('call-1')
		const refused = await answering(first.conversationId, [answer])
		await done(refused)
		await finishRun(refused, refusedEnd([answer.id]))
		expect((await loadThread(first.conversationId)).map(row => row.messageId)).toContain(answer.id)
		expect(await continuedRun(first.conversationId)).toMatchObject({
			id: refused.runId,
			status: 'succeeded',
			error: null,
		})
	})
})

describe('the run tables, read back as written', () => {
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts`

Expected: FAIL. Every test that calls `continuedRun` throws `TypeError: continuedRun is not a function` (three of 2a's and four new ones); "keeps the flag on the stored error and reads it back" fails because 2a's reader drops `beforeStream`; "withdraws only the rows it names of this run" fails because the answer row is still stored. `Tests  9 failed | 9 passed (18)`.

- [ ] **Step 3: Implement the store's pieces**

In `lib/data/conversations.ts`, make these replacements.

Replace:

```ts
export interface RunError {
	code?: string
	message: string
}
```

with:

```ts
export interface RunError {
	code?: string
	message: string
	/** P10: the agent never started this run (refused before its stream, or the hub failed before sending it). */
	beforeStream?: true
}
```

Replace:

```ts
const runErrorSchema = z.object({ code: z.string().optional(), message: z.string() })
```

with:

```ts
// zod 4 "Literals" (`z.literal(true)`) and "Objects" (an object drops keys it does not declare): the refusal flag reads
// back only as `true`, the one value the hub writes (plan call P10).
const runErrorSchema = z.object({
	code: z.string().optional(),
	message: z.string(),
	beforeStream: z.literal(true).optional(),
})
```

Replace:

```ts
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
```

with:

```ts
/**
 * The run the conversation continues from (spec §4.3 step 1 reads its open interrupts; plan call P10, decision 62): its
 * newest run the agent started, so a run refused before its stream is passed over and what it answered stays open; null
 * before the first. `error ->> 'beforeStream'` is the flag as text, and NULL when `error` is NULL or has no such key
 * (PostgreSQL 18 "JSON Functions and Operators", Table 9.47 and its note: the extraction operators "return NULL, rather
 * than failing"), which `coalesce` reads as not refused. The condition is a Drizzle `sql` template inside `and()`
 * (Drizzle "Magical sql operator": the column is mapped to its escaped name; the template holds no value).
 */
export async function continuedRun(conversationId: string): Promise<StoredRun | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(conversationRuns)
		.where(
			and(
				eq(conversationRuns.conversationId, conversationId),
				sql`coalesce(${conversationRuns.error} ->> 'beforeStream', 'false') <> 'true'`,
			),
		)
		.orderBy(desc(conversationRuns.startedAt), desc(conversationRuns.id))
		.limit(1)
	return row ? toStoredRun(row) : null
}
```

Replace:

```ts
	close?: { messageIds: string[]; toolMessages: Message[] }
}
```

with:

```ts
	close?: { messageIds: string[]; toolMessages: Message[] }
	/** P10: message ids this run carried that the agent never received; deleted with the run's end. */
	withdraw?: string[]
}
```

Replace (`finishRun`'s comment):

```ts
 * nothing); then the rows `close` names become incomplete and its tool messages are added under the run; the
 * conversation's active run is cleared where it is still this one, and its last activity is touched.
```

with:

```ts
 * nothing); then the rows `withdraw` names are deleted, only this run's own (plan call P10: the answers of a run the
 * agent never started go, so their items stay open, and no request sees the run ended with them still stored); the rows
 * `close` names become incomplete and its tool messages are added under the run; the conversation's active run is
 * cleared where it is still this one, and its last activity is touched.
```

Replace (in `finishRun`):

```ts
if (!ended.length) return
const messageIds = end.close?.messageIds ?? []
```

with:

```ts
if (!ended.length) return
const withdraw = end.withdraw ?? []
// Drizzle "Delete" (`.delete(table).where(…)`) with `and`, `eq` and `inArray` (Drizzle "Filters").
if (withdraw.length)
	await tx
		.delete(conversationMessages)
		.where(
			and(
				eq(conversationMessages.conversationId, key.conversationId),
				eq(conversationMessages.runId, key.runId),
				inArray(conversationMessages.messageId, withdraw),
			),
		)
const messageIds = end.close?.messageIds ?? []
```

The import block already has `and`, `desc`, `eq`, `inArray` and `sql` from `drizzle-orm`.

- [ ] **Step 4: Rename the two callers**

In `lib/chat/run.ts`, make these replacements.

Replace:

```ts
import {
	finishRun,
	lastRun,
	loadThread,
```

with:

```ts
import {
	continuedRun,
	finishRun,
	loadThread,
```

Replace:

```ts
const open = openItemsOf(conversation ? await lastRun(conversation.id) : null)
```

with:

```ts
const open = openItemsOf(conversation ? await continuedRun(conversation.id) : null)
```

In `__tests__/chat-run.test.ts`, the DAL mock's key and its five uses (one `vi.fn()`, one `invocationCallOrder`, four `mockResolvedValue`) take the new name; three of the lines are identical, so the rename is a substitution:

```bash
sed -i 's/\blastRun\b/continuedRun/g' __tests__/chat-run.test.ts
grep -c 'lastRun' __tests__/chat-run.test.ts
grep -c 'continuedRun' __tests__/chat-run.test.ts
```

Expected: `0`, then `6`. `git diff --stat __tests__/chat-run.test.ts` shows `6 insertions(+), 6 deletions(-)`.

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts`

Expected: PASS, `Tests  18 passed (18)`; the e2e PostgreSQL container is stopped and removed afterwards (global setup's teardown).

- [ ] **Step 6: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/conversations.ts lib/chat/run.ts __tests__/chat-run.test.ts __tests__/db/conversations-run.db.test.ts
pnpm exec oxfmt --check lib/data/conversations.ts lib/chat/run.ts __tests__/chat-run.test.ts __tests__/db/conversations-run.db.test.ts
pnpm test
pnpm test:db
```

Expected: tsc exits 0 (no `lastRun` is left anywhere: `grep -rn "lastRun" lib/chat lib/data __tests__/chat-run.test.ts __tests__/db` prints nothing); no oxlint finding; "All matched files use the correct format."; vitest 0 failed; `pnpm test:db` `Test Files  10 passed (10)`, `Tests  97 passed (97)`.

- [ ] **Step 7: Commit**

```bash
git add lib/data/conversations.ts lib/chat/run.ts __tests__/chat-run.test.ts __tests__/db/conversations-run.db.test.ts
git commit -m "feat(chat): the continued run and withdrawn answers in the store

A run the agent never started is stored with error.beforeStream, which the run
reader keeps; continuedRun (replacing lastRun) answers the newest run without
it; and finishRun deletes the answers such a run carried (RunEnd.withdraw), only
this run's rows and only when this call ended the run, in the transaction that
ends it (Part 2 plan call P10, decision 62).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/data/conversations.ts", "lib/chat/run.ts", "__tests__/chat-run.test.ts", "__tests__/db/conversations-run.db.test.ts"], "verifyCommand": "pnpm exec vitest run --project db __tests__/db/conversations-run.db.test.ts", "acceptanceCriteria": ["conversations-run.db.test.ts reports 18 passed", "continuedRun answers the run before one stored with error.beforeStream true; a NULL error or an error without the flag is the continued run; null before the first run", "the stored error keeps { code, message, beforeStream: true } and readThreadPage's runs answer it with the flag", "finishRun with withdraw deletes only the named rows of this run; another run's named row and an unnamed row of this run stay; the run is failed and the active run cleared", "an end whose last insert fails leaves the named row stored and the run running; a second finishRun on an ended run withdraws nothing", "run.ts and chat-run.test.ts name continuedRun and no lastRun; tsc, oxlint, oxfmt clean; pnpm test and pnpm test:db green"], "modelTier": "standard"}
```

---

### Task 7: The server's open items and answers check

**Goal:** `lib/chat/answers.ts` reads what a conversation waits for (the continued run's open interrupts and, while the app advertises `ask_user`, the thread's unanswered calls to it) and checks a body's answers against it, each resume payload against its own interrupt, turning the answers to questions into `tool` messages.

Spec §4.3 step 1 and §6: a run's checks read the open items, and answers must cover each exactly once (400 `answers_invalid`). 2a read only its last run's interrupts; 2b reads the continued run's (plan call P10: Task 6's `continuedRun`, the newest run the agent started) and adds the thread's unanswered `ask_user` calls while the app advertises the tool (decision 62's fourth answer; the `hubTools` list of plan call P1, which Task 8 passes in). AG-UI "Tool calls" › Frontend tools is the rule for those calls: without `pendingToolCallIds` (stripped by `@ag-ui/client` 1.0.2, the spike) the consumer derives them, "every tool call the run started that received no result", and "A thread that continues MUST answer every one of them first". Each resolved payload is checked against its interrupt with Task 3's `payloadAccepted` (plan calls P5–P8; AG-UI Concepts › Interrupts, contract rule 6: "Clients should validate before submitting"), so only a payload one of the hub's cards builds reaches the agent; a schema-less `confirmation` is answered with a bare boolean, which the body schema now takes (P6; zod 4 "Unions" tries its options in order). A question's answer is stored as sent (P3: the browser builds the transcript), an invalid question's as the hub's own error. The tests use Pydantic AI 2.56's real approval interrupt (`agui-spike.md`, Findings › Agent side) and AG-UI's quarterly-filing form (Concepts › Interrupts). `run.ts` only takes the new signature here, with an empty thread and no hub tools, so its behaviour stays 2a's until Task 8 reads both. Uses Task 2's `ASK_USER_TOOL_NAME`, `parseAskUserArgs`, `AskUserArgs`, `HubToolName` and `INVALID_QUESTION_*`.

**Files:**

- Modify: `lib/chat/answers.ts` (the whole file: `OpenQuestion`, `OpenItems`, `openItemsOf`, `anyOpen`, `checkAnswers`)
- Modify: `lib/chat/thread.ts` (`unansweredToolCalls` answers each call's `args`)
- Modify: `lib/chat/schemas.ts` (a resume payload is an object or a boolean)
- Modify: `lib/chat/run.ts` (the `openItemsOf` call takes the new signature; Task 8 fills in the thread and the tools)
- Test: `__tests__/chat-answers.test.ts` (the whole file), `__tests__/chat-schemas.test.ts`, `__tests__/chat-thread.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts __tests__/chat-run.test.ts` reports 4 files passed: 38, 21, 9 and 22 tests.
- [ ] `openItemsOf(run, thread, hubTools)` answers the continued run's interrupts that `InterruptSchema` reads and, only while `hubTools` holds `'ask_user'`, the thread's unanswered `ask_user` calls in call order, each with `parseAskUserArgs`'s result (`null` for arguments that fail the schema); `anyOpen` is true while either list has an item.
- [ ] `checkAnswers` refuses: nothing open; an id given twice in `resume` or `toolResults`; an interrupt left uncovered, unknown or answered twice (a `resume` entry while no interrupt is open included); an expired interrupt answered `resolved`; a resolved payload `payloadAccepted` refuses; tool results that do not name exactly the open questions.
- [ ] Pydantic AI's approval (`responseSchema` with `approved`, `editedArgs`, `reason`; `approved` required) is resolved only by `{ approved: true }` or `{ approved: false, reason: 'Rejected by the user' }`; a schema-less `confirmation` only by a boolean; AG-UI's quarterly-filing form only by a payload within its schema; an interrupt that only Cancel answers by no payload; any interrupt can be cancelled.
- [ ] On success `toolMessages` follow the open questions' order: a valid question's `{ id: <UUID>, role: 'tool', toolCallId, content }` with the content as sent, an invalid one's tool message with `error: 'invalid_arguments'` and `INVALID_QUESTION_CONTENT` whatever content came; `resume` is `buildResumeArray`'s, in the interrupts' order.
- [ ] `runBodySchema` takes a boolean payload and refuses a string or an array; `unansweredToolCalls` answers each call's `args`.
- [ ] `run.ts` calls `openItemsOf(<continued run>, [], [])`, so 2a's run tests pass unchanged.
- [ ] tsc, oxlint and oxfmt clean; `pnpm test` green.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts __tests__/chat-run.test.ts` → 4 files passed, 90 tests.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Replace the whole of `__tests__/chat-answers.test.ts` with:

```ts
import type { Interrupt, Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { anyOpen, checkAnswers, openItemsOf, type OpenItems } from '@/lib/chat/answers'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { REJECTED_REASON } from '@/lib/chat/interrupt-answers'
import {
	INVALID_QUESTION_CONTENT,
	INVALID_QUESTION_ERROR,
	type RunStatus,
} from '@/lib/chat/statuses'

const NOW = new Date('2026-10-14T12:00:00Z')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Pydantic AI 2.56's approval, as the spike recorded it (agui-spike.md, Findings › Agent side; `_interrupt.py`). */
const approval: Interrupt = {
	id: 'int-call-1',
	reason: 'tool_call',
	toolCallId: 'call-1',
	message: 'Approve delete_file({"path":"/tmp/report.txt"})?',
	responseSchema: {
		type: 'object',
		properties: {
			approved: { type: 'boolean' },
			editedArgs: { type: 'object' },
			reason: { type: 'string' },
		},
		required: ['approved'],
	},
}
/** No responseSchema on a reason that is not a confirmation: Cancel is the only answer (P8). */
const freeText: Interrupt = { id: 'int-2', reason: 'input_required', message: 'Which region?' }
/** A confirmation without a schema: Yes and No send a bare boolean (P6). */
const confirm: Interrupt = { id: 'int-4', reason: 'confirmation', message: 'Send it now?' }
/** AG-UI Concepts › Interrupts, the quarterly filing example (a flat schema, P7). */
const filing: Interrupt = {
	id: 'int-form',
	reason: 'input_required',
	message: 'Please provide the quarterly filing details.',
	responseSchema: {
		type: 'object',
		properties: {
			quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
			year: { type: 'integer', minimum: 2000 },
			revenue: { type: 'number' },
		},
		required: ['quarter', 'year', 'revenue'],
	},
	expiresAt: '2026-10-20T17:00:00Z',
}
const expired: Interrupt = {
	id: 'int-3',
	reason: 'confirmation',
	expiresAt: '2026-10-14T11:00:00Z',
}
const run = (status: RunStatus, outcome: unknown) => ({
	id: 'r1',
	status,
	outcome,
	error: null,
	custom: [],
	startedAt: NOW,
	finishedAt: NOW,
})

const user: Message = { id: 'u1', role: 'user', content: 'Plan my trip' }
const callTo = (id: string, name: string, args: string): Message => ({
	id: `a-${id}`,
	role: 'assistant',
	toolCalls: [{ id, type: 'function', function: { name, arguments: args } }],
})
const answer = (toolCallId: string): Message => ({
	id: `t-${toolCallId}`,
	role: 'tool',
	toolCallId,
	content: 'Q: Which city?\nA: Paris',
})
const CITY = JSON.stringify({
	questions: [{ question: 'Which city?', options: ['Paris', 'Rome'] }],
})
const DATES = JSON.stringify({ questions: [{ question: 'Which dates?', allow_custom: true }] })
const NOTHING: OpenItems = { interrupts: [], questions: [] }

// Spec §3.3, §4.3 step 1, decision 62: the continued run's open interrupts, and the open ask_user calls.
describe('openItemsOf', () => {
	it('reads the interrupts of an interrupted continued run', () => {
		expect(
			openItemsOf(
				run('interrupted', { type: 'interrupt', interrupts: [approval, freeText] }),
				[],
				[],
			),
		).toEqual({ interrupts: [approval, freeText], questions: [] })
	})
	it('has nothing open without a run, after any other end, or for an outcome it cannot read', () => {
		expect(openItemsOf(null, [], [])).toEqual(NOTHING)
		expect(openItemsOf(run('succeeded', { type: 'success' }), [], [])).toEqual(NOTHING)
		expect(openItemsOf(run('interrupted', null), [], [])).toEqual(NOTHING)
		expect(
			openItemsOf(run('interrupted', { type: 'interrupt', interrupts: 'no' }), [], []),
		).toEqual(NOTHING)
	})
	// @ag-ui/core's own InterruptSchema reads each stored interrupt; one it refuses is left out.
	it('leaves out a stored interrupt the protocol schema refuses', () => {
		expect(
			openItemsOf(
				run('interrupted', { type: 'interrupt', interrupts: [{ id: 7 }, approval] }),
				[],
				[],
			),
		).toEqual({ interrupts: [approval], questions: [] })
	})

	// AG-UI "Tool calls" › Frontend tools: the consumer derives the pending calls, "every tool call the run started that
	// received no result".
	it('lists the unanswered ask_user calls while the tool is advertised, in order, with their arguments read', () => {
		const thread = [
			user,
			callTo('q0', ASK_USER_TOOL_NAME, CITY),
			answer('q0'),
			callTo('q1', ASK_USER_TOOL_NAME, CITY),
			callTo('c1', 'search', '{}'),
			callTo('q2', ASK_USER_TOOL_NAME, DATES),
		]
		expect(openItemsOf(run('succeeded', { type: 'success' }), thread, ['ask_user'])).toEqual({
			interrupts: [],
			questions: [
				{
					toolCallId: 'q1',
					args: {
						questions: [
							{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: true },
						],
					},
				},
				{
					toolCallId: 'q2',
					args: { questions: [{ question: 'Which dates?', options: [], allow_custom: true }] },
				},
			],
		})
	})

	// Plan call P3: the arguments are untrusted; a call that fails the schema stays open, with nothing to ask.
	it('keeps a call whose arguments fail the schema open, without arguments', () => {
		const thread = [
			callTo('q1', ASK_USER_TOOL_NAME, '{"questions":[]}'),
			callTo('q2', ASK_USER_TOOL_NAME, '{"questions":'),
		]
		expect(openItemsOf(null, thread, ['ask_user']).questions).toEqual([
			{ toolCallId: 'q1', args: null },
			{ toolCallId: 'q2', args: null },
		])
	})

	// Decision 62's fourth answer: a pending call follows the app's switch now.
	it('opens no question while the app does not advertise ask_user', () => {
		expect(openItemsOf(null, [callTo('q1', ASK_USER_TOOL_NAME, CITY)], [])).toEqual(NOTHING)
	})

	it('reads an approval and a question that one run left open together', () => {
		const open = openItemsOf(
			run('interrupted', { type: 'interrupt', interrupts: [approval] }),
			[user, callTo('call-1', 'delete_file', '{}'), callTo('q1', ASK_USER_TOOL_NAME, CITY)],
			['ask_user'],
		)
		expect(open.interrupts).toEqual([approval])
		expect(open.questions.map(question => question.toolCallId)).toEqual(['q1'])
		expect(anyOpen(open)).toBe(true)
	})
})

describe('anyOpen', () => {
	it('is true while an interrupt or a question is open', () => {
		expect(anyOpen(NOTHING)).toBe(false)
		expect(anyOpen({ interrupts: [confirm], questions: [] })).toBe(true)
		expect(anyOpen({ interrupts: [], questions: [{ toolCallId: 'q1', args: null }] })).toBe(true)
	})
})

describe('checkAnswers: interrupts', () => {
	const open: OpenItems = { interrupts: [approval, freeText], questions: [] }

	it('builds one resume entry per open interrupt, in the interrupts’ order', () => {
		expect(
			checkAnswers(
				open,
				{
					resume: [
						{ interruptId: 'int-2', status: 'cancelled', payload: { ignored: true } },
						{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
					],
				},
				NOW,
			),
		).toEqual({
			ok: true,
			// buildResumeArray drops a cancelled entry's payload (@ag-ui/client src/interrupts/index.ts).
			resume: [
				{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'cancelled' },
			],
			toolMessages: [],
		})
	})

	it.each([
		['an open interrupt left unanswered', [{ interruptId: 'int-call-1', status: 'cancelled' }]],
		[
			'an interrupt that is not open',
			[
				{ interruptId: 'int-call-1', status: 'cancelled' },
				{ interruptId: 'int-2', status: 'cancelled' },
				{ interruptId: 'int-9', status: 'cancelled' },
			],
		],
		[
			'one interrupt answered twice',
			[
				{ interruptId: 'int-call-1', status: 'cancelled' },
				{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'cancelled' },
			],
		],
	] as const)('refuses %s', (_case, resume) => {
		expect(checkAnswers(open, { resume: [...resume] }, NOW)).toEqual({ ok: false })
	})

	// "An interrupt past its expiresAt … answers it cancelled" (spec §6.1); AG-UI: it "can no longer be answered".
	it('takes an expired interrupt only as cancelled', () => {
		const withExpired: OpenItems = { interrupts: [expired], questions: [] }
		expect(
			checkAnswers(
				withExpired,
				{ resume: [{ interruptId: 'int-3', status: 'resolved', payload: true }] },
				NOW,
			),
		).toEqual({ ok: false })
		expect(
			checkAnswers(withExpired, { resume: [{ interruptId: 'int-3', status: 'cancelled' }] }, NOW),
		).toEqual({
			ok: true,
			resume: [{ interruptId: 'int-3', status: 'cancelled' }],
			toolMessages: [],
		})
	})

	it('refuses answers to a conversation with nothing open', () => {
		expect(checkAnswers(NOTHING, { resume: [] }, NOW)).toEqual({ ok: false })
		expect(checkAnswers(NOTHING, {}, NOW)).toEqual({ ok: false })
		expect(
			checkAnswers(NOTHING, { toolResults: [{ toolCallId: 'q1', content: 'Q: x\nA: y' }] }, NOW),
		).toEqual({ ok: false })
	})
})

// Plan calls P5–P8: a resolved payload must be one the hub's cards build ("Clients should validate before submitting",
// AG-UI Concepts › Interrupts, contract rule 6).
describe('checkAnswers: payloads', () => {
	const resolved = (interrupt: Interrupt, payload?: Record<string, unknown> | boolean) =>
		checkAnswers(
			{ interrupts: [interrupt], questions: [] },
			{ resume: [{ interruptId: interrupt.id, status: 'resolved', payload }] },
			NOW,
		).ok

	it.each([
		['Approve, in the schema’s own terms', approval, { approved: true }],
		[
			'Reject, with the reason the schema declares',
			approval,
			{ approved: false, reason: REJECTED_REASON },
		],
		['Yes to a confirmation', confirm, true],
		['No to a confirmation', confirm, false],
		['a filled flat form', filing, { quarter: 'Q1', year: 2026, revenue: 4_200_000 }],
	] as const)('takes %s', (_case, interrupt, payload) => {
		expect(resolved(interrupt, payload)).toBe(true)
	})

	it.each([
		['an approval without a payload', approval, undefined],
		['an approval whose value is not a boolean', approval, { approved: 'yes' }],
		['an approval with edited arguments', approval, { approved: true, editedArgs: { path: '/' } }],
		['a rejection without the reason the schema declares', approval, { approved: false }],
		['a confirmation answered with an object', confirm, { approved: true }],
		['a confirmation without a payload', confirm, undefined],
		['a form without a required field', filing, { quarter: 'Q1', year: 2026 }],
		['a form value outside its enum', filing, { quarter: 'Q5', year: 2026, revenue: 1 }],
		['a form value below its minimum', filing, { quarter: 'Q1', year: 1999, revenue: 1 }],
		[
			'a form key the schema does not declare',
			filing,
			{ quarter: 'Q1', year: 2026, revenue: 1, x: 1 },
		],
		['an answer to an interrupt that only Cancel answers', freeText, { region: 'eu' }],
	] as const)('refuses %s', (_case, interrupt, payload) => {
		expect(resolved(interrupt, payload)).toBe(false)
	})

	it('takes any interrupt as cancelled', () => {
		const open: OpenItems = { interrupts: [approval, freeText, confirm, filing], questions: [] }
		const result = checkAnswers(
			open,
			{
				resume: open.interrupts.map(({ id }) => ({
					interruptId: id,
					status: 'cancelled' as const,
				})),
			},
			NOW,
		)
		expect(result.ok).toBe(true)
	})
})

// Spec §6.2, plan call P3: the answers to the open ask_user calls become tool messages.
describe('checkAnswers: questions', () => {
	const city = { questions: [{ question: 'Which city?', options: ['Paris'], allow_custom: true }] }
	const open: OpenItems = {
		interrupts: [],
		questions: [
			{ toolCallId: 'q1', args: city },
			{ toolCallId: 'q2', args: null },
		],
	}

	it('answers each open question in the questions’ order; an invalid one with the hub’s error', () => {
		expect(
			checkAnswers(
				open,
				{
					toolResults: [
						{ toolCallId: 'q2', content: 'anything' },
						{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' },
					],
				},
				NOW,
			),
		).toEqual({
			ok: true,
			resume: [],
			toolMessages: [
				{
					id: expect.stringMatching(UUID),
					role: 'tool',
					toolCallId: 'q1',
					content: 'Q: Which city?\nA: Paris',
				},
				{
					id: expect.stringMatching(UUID),
					role: 'tool',
					toolCallId: 'q2',
					content: INVALID_QUESTION_CONTENT,
					error: INVALID_QUESTION_ERROR,
				},
			],
		})
	})

	it.each([
		['an open question left unanswered', { toolResults: [{ toolCallId: 'q1', content: 'A' }] }],
		[
			'a call that is not open',
			{
				toolResults: [
					{ toolCallId: 'q1', content: 'A' },
					{ toolCallId: 'q2', content: '' },
					{ toolCallId: 'q9', content: 'A' },
				],
			},
		],
		[
			'one call answered twice',
			{
				toolResults: [
					{ toolCallId: 'q1', content: 'A' },
					{ toolCallId: 'q1', content: 'B' },
				],
			},
		],
		[
			'a resume entry while no interrupt is open',
			{
				resume: [{ interruptId: 'int-1', status: 'cancelled' as const }],
				toolResults: [
					{ toolCallId: 'q1', content: 'A' },
					{ toolCallId: 'q2', content: '' },
				],
			},
		],
	])('refuses %s', (_case, answers) => {
		expect(checkAnswers(open, answers, NOW)).toEqual({ ok: false })
	})
})

// Spec §6: one run can stop on an approval and leave a question; one answer body covers both.
describe('checkAnswers: an approval and a question together', () => {
	const open: OpenItems = {
		interrupts: [approval],
		questions: [{ toolCallId: 'q1', args: null }],
	}
	const approve = {
		interruptId: 'int-call-1',
		status: 'resolved' as const,
		payload: { approved: true },
	}
	const dismiss = { toolCallId: 'q1', content: '' }

	it('takes both answers at once', () => {
		const result = checkAnswers(open, { resume: [approve], toolResults: [dismiss] }, NOW)
		expect(result).toMatchObject({
			ok: true,
			resume: [approve],
			toolMessages: [{ role: 'tool', toolCallId: 'q1', error: INVALID_QUESTION_ERROR }],
		})
	})

	it('refuses either answer alone', () => {
		expect(checkAnswers(open, { resume: [approve] }, NOW)).toEqual({ ok: false })
		expect(checkAnswers(open, { toolResults: [dismiss] }, NOW)).toEqual({ ok: false })
	})
})
```

In `__tests__/chat-schemas.test.ts`, replace the comment above `describe('runBodySchema'`

```ts
// Spec §4.2: exactly one of message and answers; answers continue a conversation; the text is 1–32,000 characters.
```

with

```ts
// Spec §4.2: exactly one of message and answers; answers continue a conversation; the text is 1–32,000 characters; a
// payload is an object or a boolean (plan call P6).
```

Then, among the accepted bodies, replace

```ts
		[
			'a cancelled answer without a payload',
			{ conversationId: ID, answers: { resume: [{ interruptId: 'int-1', status: 'cancelled' }] } },
		],
```

with

```ts
		[
			'a cancelled answer without a payload',
			{ conversationId: ID, answers: { resume: [{ interruptId: 'int-1', status: 'cancelled' }] } },
		],
		[
			'a bare boolean payload (plan call P6)',
			{ conversationId: ID, answers: { resume: [{ ...resolved, payload: false }] } },
		],
```

and, among the refused ones, replace

```ts
		[
			'a payload that is no object',
			{ conversationId: ID, answers: { resume: [{ ...resolved, payload: [true] }] } },
		],
```

with

```ts
		[
			'a payload that is an array',
			{ conversationId: ID, answers: { resume: [{ ...resolved, payload: [true] }] } },
		],
		[
			'a payload that is a string',
			{ conversationId: ID, answers: { resume: [{ ...resolved, payload: 'yes' }] } },
		],
```

In `__tests__/chat-thread.test.ts`, replace

```ts
it('lists the calls no tool message answers, in order, with their tool names', () => {
	expect(unansweredToolCalls([user, call, result1, text])).toEqual([
		{ toolCallId: 'c2', name: 'get_time' },
	])
	expect(unansweredToolCalls([user, call, result1, result2])).toEqual([])
})
```

with

```ts
it('lists the calls no tool message answers, in order, with their tool names and arguments', () => {
	expect(unansweredToolCalls([user, call])).toEqual([
		{ toolCallId: 'c1', name: 'get_weather', args: '{"city":"Paris"}' },
		{ toolCallId: 'c2', name: 'get_time', args: '{}' },
	])
	expect(unansweredToolCalls([user, call, result1, text])).toEqual([
		{ toolCallId: 'c2', name: 'get_time', args: '{}' },
	])
	expect(unansweredToolCalls([user, call, result1, result2])).toEqual([])
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts`

Expected: FAIL, 24 failed, among them `expected { interrupts: [] } to deeply equal { interrupts: [], questions: [] }` (`openItemsOf` reads no questions yet), "takes a bare boolean payload (plan call P6)" and the `unansweredToolCalls` case (no `args`).

- [ ] **Step 3: Implement**

In `lib/chat/thread.ts`, replace

```ts
/** The calls of the thread's assistant messages that no tool message answers, in order (spec §3.2 step 4, §6.2). */
export const unansweredToolCalls = (
	messages: readonly Message[],
): { toolCallId: string; name: string }[] => {
```

with

```ts
/**
 * The calls of the thread's assistant messages that no tool message answers, in order (spec §3.2 step 4, §6.2), with
 * each call's arguments as the agent streamed them (AG-UI 1.0 `ToolCall.function.arguments`, a JSON string), which the
 * open questions read (lib/chat/answers.ts).
 */
export const unansweredToolCalls = (
	messages: readonly Message[],
): { toolCallId: string; name: string; args: string }[] => {
```

and, in its body,

```ts
					.map(call => ({ toolCallId: call.id, name: call.function.name }))
```

with

```ts
					.map(call => ({
						toolCallId: call.id,
						name: call.function.name,
						args: call.function.arguments,
					}))
```

In `lib/chat/schemas.ts`, replace

```ts
/** An answer to one open interrupt (AG-UI 1.0 interrupt-resume: `{ interruptId, status, payload? }`, payload an object here). */
const resumeEntrySchema = z.object({
	interruptId: z.string().min(1).max(256),
	status: z.enum(['resolved', 'cancelled']),
	payload: z.record(z.string(), z.unknown()).optional(),
})
```

with

```ts
/**
 * An answer to one open interrupt (AG-UI 1.0 interrupt-resume: `{ interruptId, status, payload? }`). The payload is an
 * object, or a bare boolean for a `confirmation` without a `responseSchema` (plan call P6; AG-UI Concepts › Interrupts,
 * reason taxonomy: "`responseSchema` optional; boolean default"); zod 4 "Unions" checks the options in order. Which
 * payload an interrupt accepts is checked against the interrupt itself (lib/chat/answers.ts).
 */
const resumeEntrySchema = z.object({
	interruptId: z.string().min(1).max(256),
	status: z.enum(['resolved', 'cancelled']),
	payload: z.union([z.record(z.string(), z.unknown()), z.boolean()]).optional(),
})
```

Replace the whole of `lib/chat/answers.ts` with:

```ts
import 'server-only'

import { buildResumeArray, isInterruptExpired } from '@ag-ui/client'
import type { Interrupt, Message, ResumeEntry } from '@ag-ui/core'
import { InterruptSchema } from '@ag-ui/core/schemas'

import type { StoredRun } from '@/lib/data/conversations'

import { ASK_USER_TOOL_NAME, parseAskUserArgs, type AskUserArgs } from './ask-user'
import type { HubToolName } from './hub-tools'
import { payloadAccepted } from './interrupt-answers'
import type { RunBody } from './schemas'
import { INVALID_QUESTION_CONTENT, INVALID_QUESTION_ERROR } from './statuses'
import { errorToolMessage, unansweredToolCalls } from './thread'

/** An unanswered call to the hub's own ask_user tool (spec §6.2): the conversation waits for its answer. */
export interface OpenQuestion {
	toolCallId: string
	/** null when the call's arguments fail askUserArgsSchema (P3). */
	args: AskUserArgs | null
}

/** What a conversation waits for (spec §4.3 step 1): the continued run's open interrupts and the open ask_user calls. */
export type OpenItems = { interrupts: Interrupt[]; questions: OpenQuestion[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The open interrupts (spec §3.3): those of the continued run (plan call P10: the newest run the agent started) when it
 * ended on an interrupt, read from the stored `RUN_FINISHED.outcome` (2a stores it as received) with the protocol's own
 * schema (`@ag-ui/core/schemas` `InterruptSchema`); an entry it refuses is left out, so a stored value never reaches the
 * agent unread. If every stored interrupt fails the schema, nothing is open: a message is accepted and answers get
 * answers_invalid.
 */
const openInterrupts = (run: StoredRun | null): Interrupt[] => {
	if (!run || run.status !== 'interrupted' || !isRecord(run.outcome)) return []
	const listed = Array.isArray(run.outcome.interrupts) ? run.outcome.interrupts : []
	return listed.flatMap(entry => {
		const parsed = InterruptSchema.safeParse(entry)
		return parsed.success ? [parsed.data] : []
	})
}

/**
 * Spec §4.3 step 1, decision 62: the continued run's open interrupts, and the thread's unanswered ask_user calls while
 * the app advertises the tool. AG-UI "Tool calls" › Frontend tools: a run ends with a frontend call unanswered, and
 * without `pendingToolCallIds` (which @ag-ui/client 1.0.2 strips: the spike) the consumer derives them, "every tool call
 * the run started that received no result". Every run the hub starts first answers each call left before it (the
 * answers, plan call P4's not-available answers, a stop's error), so the thread's unanswered calls are the continued
 * run's. The arguments are untrusted ("validated against the tool's declared parameter schema", same page, Security):
 * a call whose arguments fail stays open with `args: null` (P3). While the switch is off no call is open, and the next
 * run answers it as not available (decision 62's fourth answer).
 */
export const openItemsOf = (
	run: StoredRun | null,
	thread: readonly Message[],
	hubTools: readonly HubToolName[],
): OpenItems => ({
	interrupts: openInterrupts(run),
	questions: hubTools.includes(ASK_USER_TOOL_NAME)
		? unansweredToolCalls(thread)
				.filter(call => call.name === ASK_USER_TOOL_NAME)
				.map(call => ({ toolCallId: call.toolCallId, args: parseAskUserArgs(call.args) }))
		: [],
})

/** Whether anything is open (the server's twin of lib/chat/open-items.ts's hasOpenItems). */
export const anyOpen = (open: OpenItems): boolean =>
	open.interrupts.length > 0 || open.questions.length > 0

type Answers = NonNullable<RunBody['answers']>

const hasDuplicates = (ids: readonly string[]): boolean => new Set(ids).size !== ids.length

/** Spec §6.2: an open question answered with what the browser sent, the template's Q/A transcript (P3), as is. */
const answerMessage = (toolCallId: string, content: string): Message => ({
	id: crypto.randomUUID(),
	role: 'tool',
	toolCallId,
	content,
})

/**
 * Spec §4.3 step 1: the answers cover every open item exactly once, or the run is refused (400 answers_invalid).
 *
 * - Answers to nothing are refused: they would start a run with nothing new in it. An id given twice is refused first
 *   (a record would keep one of them).
 * - Interrupts: "The resume list MUST cover every interrupt of the run being continued", and "A consumer MUST reject a
 *   resuming input that leaves an interrupt uncovered before the run starts" (AG-UI "Interrupt and resume");
 *   @ag-ui/client's `buildResumeArray` builds `resume[]` in the interrupts' order and throws for a missing or unknown
 *   id, so with no open interrupt any entry is unknown. An interrupt the consumer judges expired "can no longer be
 *   answered" but can be abandoned (same page): `isInterruptExpired` is the client's rule. A resolved payload must be
 *   one the hub's cards build ("Clients should validate before submitting", AG-UI Concepts › Interrupts, contract rule
 *   6): `payloadAccepted` (plan calls P5–P8).
 * - Questions: the tool results name exactly the open questions ("A thread that continues MUST answer every one of
 *   them first", AG-UI "Tool calls" › Frontend tools). Each becomes a tool message, in the questions' order; a question
 *   whose arguments failed is answered with the hub's error, whatever content came (P3: "a failure is still an answer,
 *   as a tool message with `error` set", same page).
 */
export const checkAnswers = (
	open: OpenItems,
	answers: Answers,
	now: Date = new Date(),
): { ok: true; resume: ResumeEntry[]; toolMessages: Message[] } | { ok: false } => {
	const entries = answers.resume ?? []
	const results = answers.toolResults ?? []
	if (!anyOpen(open)) return { ok: false }
	if (
		hasDuplicates(entries.map(entry => entry.interruptId)) ||
		hasDuplicates(results.map(result => result.toolCallId))
	)
		return { ok: false }
	let resume: ResumeEntry[]
	try {
		resume = buildResumeArray(
			open.interrupts,
			Object.fromEntries(
				entries.map(entry => [
					entry.interruptId,
					entry.status === 'resolved'
						? { status: entry.status, payload: entry.payload }
						: { status: entry.status },
				]),
			),
		)
	} catch {
		return { ok: false }
	}
	const interruptOf = new Map(open.interrupts.map(interrupt => [interrupt.id, interrupt]))
	const refused = entries.some(entry => {
		if (entry.status === 'cancelled') return false
		const interrupt = interruptOf.get(entry.interruptId)
		return (
			!interrupt || isInterruptExpired(interrupt, now) || !payloadAccepted(interrupt, entry.payload)
		)
	})
	if (refused || results.length !== open.questions.length) return { ok: false }
	const contentOf = new Map(results.map(result => [result.toolCallId, result.content]))
	const toolMessages: Message[] = []
	for (const question of open.questions) {
		const content = contentOf.get(question.toolCallId)
		if (content === undefined) return { ok: false }
		toolMessages.push(
			question.args
				? answerMessage(question.toolCallId, content)
				: errorToolMessage(question.toolCallId, INVALID_QUESTION_ERROR, INVALID_QUESTION_CONTENT),
		)
	}
	return { ok: true, resume, toolMessages }
}
```

In `lib/chat/run.ts` (as of Task 6, which renamed `lastRun`), replace

```ts
const open = openItemsOf(conversation ? await continuedRun(conversation.id) : null)
```

with

```ts
// Task 8 reads the thread and the app's hub tools here; until then no ask_user call is open, as in 2a.
const open = openItemsOf(conversation ? await continuedRun(conversation.id) : null, [], [])
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts __tests__/chat-run.test.ts`

Expected: PASS, 4 files, 90 tests (chat-run's 22 are 2a's, unchanged).

- [ ] **Step 5: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/answers.ts lib/chat/thread.ts lib/chat/schemas.ts lib/chat/run.ts __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts
pnpm exec oxfmt --check lib/chat/answers.ts lib/chat/thread.ts lib/chat/schemas.ts lib/chat/run.ts __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts
pnpm test
```

Expected: tsc exits 0, oxlint finds nothing, oxfmt "All matched files use the correct format", vitest 0 failed. `lib/data/` is unchanged, so no `pnpm test:db`.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/answers.ts lib/chat/thread.ts lib/chat/schemas.ts lib/chat/run.ts __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts
git commit -m "feat(chat): read the open ask_user questions and check each answer against its item

The open items are the continued run's interrupts and, while the app advertises ask_user,
the thread's unanswered calls to it. A resolved payload must be one the hub's cards build
for its interrupt, a confirmation takes a bare boolean, and the answers to questions become
tool messages (Part 2 spec §4.3 step 1, §6; plan calls P3, P5–P8, P10; decision 62).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/answers.ts", "lib/chat/thread.ts", "lib/chat/schemas.ts", "lib/chat/run.ts", "__tests__/chat-answers.test.ts", "__tests__/chat-schemas.test.ts", "__tests__/chat-thread.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts __tests__/chat-run.test.ts", "acceptanceCriteria": ["`pnpm exec vitest run --project unit __tests__/chat-answers.test.ts __tests__/chat-schemas.test.ts __tests__/chat-thread.test.ts __tests__/chat-run.test.ts` reports 4 files passed: 38, 21, 9 and 22 tests.", "`openItemsOf(run, thread, hubTools)` answers the continued run's interrupts that `InterruptSchema` reads and, only while `hubTools` holds `'ask_user'`, the thread's unanswered `ask_user` calls in call order, each with `parseAskUserArgs`'s result (`null` for arguments that fail the schema); `anyOpen` is true while either list has an item.", "`checkAnswers` refuses: nothing open; an id given twice in `resume` or `toolResults`; an interrupt left uncovered, unknown or answered twice (a `resume` entry while no interrupt is open included); an expired interrupt answered `resolved`; a resolved payload `payloadAccepted` refuses; tool results that do not name exactly the open questions.", "Pydantic AI's approval (`responseSchema` with `approved`, `editedArgs`, `reason`; `approved` required) is resolved only by `{ approved: true }` or `{ approved: false, reason: 'Rejected by the user' }`; a schema-less `confirmation` only by a boolean; AG-UI's quarterly-filing form only by a payload within its schema; an interrupt that only Cancel answers by no payload; any interrupt can be cancelled.", "On success `toolMessages` follow the open questions' order: a valid question's `{ id: <UUID>, role: 'tool', toolCallId, content }` with the content as sent, an invalid one's tool message with `error: 'invalid_arguments'` and `INVALID_QUESTION_CONTENT` whatever content came; `resume` is `buildResumeArray`'s, in the interrupts' order.", "`runBodySchema` takes a boolean payload and refuses a string or an array; `unansweredToolCalls` answers each call's `args`.", "`run.ts` calls `openItemsOf(<continued run>, [], [])`, so 2a's run tests pass unchanged.", "tsc, oxlint and oxfmt clean; `pnpm test` green."], "modelTier": "standard"}
```

---

### Task 8: Advertising `ask_user` and running answers

**Goal:** The chat adapter names the hub's tools an app advertises, the run sends their definitions to the agent, reads the open questions from the thread, refuses a message while anything is open, and stores a run the agent never started as failed with `beforeStream`, withdrawing the answers it carried.

Plan call P1: `ChatAdapter` gains `hubTools(settings)` (spec §4.1: the adapter is given "the tools"), and AG-UI's adapter answers `['ask_user']` while the app's `askUser` switch (Task 1) is on; the run advertises their definitions in `RunAgentInput.tools` (spec §6.2; Global Constraints: the agent contract's one change) and the open items read the same names, so the switch is read in one place, as it is now (decision 62's fourth answer). `runTurn` reads the thread before the open items, because the open questions are its unanswered calls: after `reconcileStaleRun`, which answers a crashed run's calls, and before `startRun` (Cross-task ordering). A message while anything is open is 409 `answer_pending` (decision 50); answers to questions alone start a run without `resume` (AG-UI "Tool calls" › Frontend tools: "the next run's `messages` carry a tool message per call"). Plan call P10, decision 62's first answer: a run the agent refuses before its stream (spec §4.3 step 4), or that the hub fails to hand over, is stored failed with `error.beforeStream: true` and withdraws the tool messages the answers added (Task 6's `RunEnd.withdraw`), before the run is released and before the envelope answers (2a's rule, "The run is stored before it is released"), so the items stay open and the next answers resume the run the agent did start. Plan call P4's not-available answers and a user message stay (#66). The rest of 2a's run is unchanged. `__tests__/chat-route.test.ts` and `__tests__/chat-routes.test.ts` build their fake adapters inside `vi.mock` factories, which tsc does not check against `ChatAdapter`, so they need no change; `__tests__/provider-registry.test.ts` compares `chatAdapterOf('agui')` with `aguiChat` and stays as it is.

**Files:**

- Modify: `lib/chat/adapter.ts` (`ChatAdapter.hubTools`; the `tools` and `resume` comments)
- Modify: `lib/providers/agui/chat.ts` (`hubTools`)
- Modify: `lib/chat/run.ts` (the whole file)
- Test: `__tests__/chat-run.test.ts` (the whole file), `__tests__/agui-chat.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/agui-chat.test.ts` reports 2 files passed: 29 and 23 tests.
- [ ] `ChatAdapter` has `hubTools(settings): HubToolName[]`; `aguiChat.hubTools` answers `['ask_user']` while `settings.askUser` is true and `[]` otherwise, and the request body's `tools` is the run's `tools` as given.
- [ ] The adapter's `tools` is `[ASK_USER_TOOL]` for an app whose switch is on and `[]` otherwise, read with `chat.hubTools(app.settings)`.
- [ ] The thread and the continued run are read after `truncateStaleRun` and before `startRun`.
- [ ] A message while an `ask_user` call is open (switch on) answers 409 `answer_pending` and stores nothing; with the switch off the same call is answered `not_available` before the message (decision 62).
- [ ] Answers to a question store exactly its tool message (no not-available answer for it) and start the run with no `resume`, in the store and for the adapter.
- [ ] A refused answering run calls `finishRun(key, { status: 'failed', error: { code, message, beforeStream: true }, custom: [], withdraw })` while `activeRuns` still holds the run, `withdraw` being exactly the answers' tool message ids in order (never plan call P4's not-available answer); its `resume` is stored; the hub's own failure before sending does the same with `internal_error`.
- [ ] A refused message run is stored with `beforeStream: true` and no `withdraw`.
- [ ] tsc, oxlint and oxfmt clean; `pnpm test` green.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/agui-chat.test.ts` → 2 files passed, 52 tests.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Replace the whole of `__tests__/chat-run.test.ts` (as of Task 6, which renamed the `lastRun` mock) with:

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
		continuedRun: vi.fn(),
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
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { ASK_USER_TOOL } from '@/lib/chat/hub-tools'
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
	settings: { agentUrl: 'http://agent/agents/a', audience: 'a', askUser: false },
	secrets: { jwtSecret: 'x'.repeat(32) },
}
/** The same app with its `ask_user` switch on (spec §6.2). */
const askingApp = { ...app, settings: { ...app.settings, askUser: true } }
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
const QUESTION_ARGS = JSON.stringify({
	questions: [{ question: 'Which city?', options: ['Paris', 'Rome'] }],
})
const TRANSCRIPT = 'Q: Which city?\nA: Paris'
const askRow = (seq: number, id: string) =>
	row(seq, {
		id: `a${seq}`,
		role: 'assistant',
		toolCalls: [
			{ id, type: 'function', function: { name: ASK_USER_TOOL_NAME, arguments: QUESTION_ARGS } },
		],
	})
const succeeded = {
	id: 'r0',
	status: 'succeeded',
	outcome: { type: 'success' },
	error: null,
	custom: [],
	startedAt: new Date(),
	finishedAt: new Date(),
}
const interrupted = (interrupts: unknown[]) => ({
	id: 'r0',
	status: 'interrupted',
	outcome: { type: 'interrupt', interrupts },
	error: null,
	custom: [],
	startedAt: new Date(),
	finishedAt: new Date(),
})

const chat = { hubTools: vi.fn(), runTurn: vi.fn() }
const opens = (opened: unknown, finished: Promise<unknown> = Promise.resolve({ failed: false })) =>
	chat.runTurn.mockReturnValue({ opened: Promise.resolve(opened), finished })
const run = (
	body: Record<string, unknown>,
	{ signal, target = app }: { signal?: AbortSignal; target?: typeof app } = {},
) =>
	runTurn({
		request: new Request(`http://hub/api/apps/${APP_ID}/runs`, { method: 'POST', signal }),
		actor,
		app: target,
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
	// AG-UI's rule (lib/providers/agui/chat.ts): ask_user while the app's switch is on.
	chat.hubTools.mockReset()
	chat.hubTools.mockImplementation((settings: { askUser: boolean }) =>
		settings.askUser ? [ASK_USER_TOOL_NAME] : [],
	)
	sessions.length = 0
	dal.findConversation.mockResolvedValue(conversation)
	dal.continuedRun.mockResolvedValue(null)
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
		// The session's history is the very array the agent gets as its messages (Task 10: no history row is written again).
		expect(session.args.history).toBe(adapterInput().messages)
		await vi.waitFor(() =>
			expect(session.finish).toHaveBeenCalledWith({ failed: false, stopReason: undefined }),
		)
		expect(session.finish).toHaveBeenCalledTimes(1)
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

	// The run is held before the database calls it active, so a concurrent reconcile never truncates a live run.
	it('holds the run in activeRuns from before startRun until the stream ends', async () => {
		opens({ ok: true })
		let heldAtStart: boolean | undefined
		let heldAtThread: boolean | undefined
		dal.startRun.mockImplementation(
			async (_actor: unknown, input: { conversation: { id: string }; runId: string }) => {
				heldAtStart = activeRuns.has(input.runId)
				return { ok: true, key: { conversationId: input.conversation.id, runId: input.runId } }
			},
		)
		dal.loadThread.mockImplementation(async () => {
			heldAtThread = activeRuns.has(started().runId)
			return []
		})
		await run({ message: { text: 'hi' } })
		expect(heldAtStart).toBe(true)
		expect(heldAtThread).toBe(true)
		await vi.waitFor(() => expect(activeRuns.has(started().runId)).toBe(false))
	})

	it('leaves nothing registered when startRun refuses or throws', async () => {
		let runId = ''
		dal.startRun.mockImplementation(async (_actor: unknown, input: { runId: string }) => {
			runId = input.runId
			return { ok: false, code: 'run_in_progress' }
		})
		await run({ message: { text: 'hi' } })
		expect(runId).not.toBe('')
		expect(activeRuns.has(runId)).toBe(false)
		dal.startRun.mockImplementation(async (_actor: unknown, input: { runId: string }) => {
			runId = input.runId
			throw new Error('db down')
		})
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('db down')
		expect(activeRuns.has(runId)).toBe(false)
	})

	it('aborts the upstream request when the adapter throws after starting it', async () => {
		chat.runTurn.mockImplementation(() => {
			throw new Error('adapter broke')
		})
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('adapter broke')
		errorSpy.mockRestore()
		expect(adapterInput().abortController.signal.aborted).toBe(true)
		expect(activeRuns.has(started().runId)).toBe(false)
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
		// The open items are read after the reconcile and before startRun (the plan's cross-task ordering).
		const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0]
		expect(order(dal.truncateStaleRun)).toBeLessThan(order(dal.loadThread))
		expect(order(dal.truncateStaleRun)).toBeLessThan(order(dal.continuedRun))
		expect(order(dal.loadThread)).toBeLessThan(order(dal.startRun))
		expect(order(dal.continuedRun)).toBeLessThan(order(dal.startRun))
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

// Spec §6.2, plan call P1: the hub's own tools, read from the app's switch as it is now.
describe('runTurn: the hub’s tools', () => {
	it.each([
		['off', app, []],
		['on', askingApp, [ASK_USER_TOOL]],
	])('advertises ask_user only while the switch is on (%s)', async (_case, target, tools) => {
		opens({ ok: true })
		await run({ message: { text: 'hi' } }, { target })
		expect(chat.hubTools).toHaveBeenCalledWith(target.settings)
		expect(adapterInput().tools).toEqual(tools)
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})
})

// Spec §4.3 step 1 (decision 50; plan call P3).
describe('runTurn: what the conversation waits for', () => {
	const approval = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }

	it('refuses a message while an interrupt is open, storing nothing', async () => {
		dal.continuedRun.mockResolvedValue(interrupted([approval]))
		expect(
			await envelope(await run({ conversationId: CONVERSATION_ID, message: { text: 'hi' } })),
		).toEqual({
			status: 409,
			body: { code: 'answer_pending', message: 'Answer the open question first.', status: 409 },
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	it('refuses answers that do not match what is open', async () => {
		dal.continuedRun.mockResolvedValue(interrupted([approval]))
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
		dal.continuedRun.mockResolvedValue(interrupted([approval]))
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

	it('refuses a message while an ask_user question is open, storing nothing', async () => {
		dal.continuedRun.mockResolvedValue(succeeded)
		dal.loadThread.mockResolvedValue([userRow(1, 'm1', 'Plan a trip'), askRow(2, 'q1')])
		expect(
			await envelope(
				await run(
					{ conversationId: CONVERSATION_ID, message: { text: 'hi' } },
					{ target: askingApp },
				),
			),
		).toEqual({
			status: 409,
			body: { code: 'answer_pending', message: 'Answer the open question first.', status: 409 },
		})
		expect(dal.startRun).not.toHaveBeenCalled()
	})

	// Decision 62's fourth answer: with the switch off, a pending call is no question, and plan call P4 answers it.
	it('answers a pending ask_user call as not available once the switch is off', async () => {
		opens({ ok: true })
		dal.continuedRun.mockResolvedValue(succeeded)
		dal.loadThread.mockResolvedValue([userRow(1, 'm1', 'Plan a trip'), askRow(2, 'q1')])
		await run({ conversationId: CONVERSATION_ID, message: { text: 'Never mind' } })
		expect(started().messages).toEqual([
			expect.objectContaining({ role: 'tool', toolCallId: 'q1', error: UNAVAILABLE_TOOL_ERROR }),
			expect.objectContaining({ role: 'user', content: 'Never mind' }),
		])
		await vi.waitFor(() => expect(sessions[0].finish).toHaveBeenCalled())
	})

	// Spec §6.2: the answer is a tool message the hub stores; no interrupt is resumed, so the run has no resume list.
	it('stores the answer to a question and starts the run with no resume', async () => {
		opens({ ok: true })
		dal.continuedRun.mockResolvedValue(succeeded)
		dal.loadThread.mockResolvedValue([userRow(1, 'm1', 'Plan a trip'), askRow(2, 'q1')])
		await run(
			{
				conversationId: CONVERSATION_ID,
				answers: { toolResults: [{ toolCallId: 'q1', content: TRANSCRIPT }] },
			},
			{ target: askingApp },
		)
		expect(started().messages).toEqual([
			{ id: expect.any(String), role: 'tool', toolCallId: 'q1', content: TRANSCRIPT },
		])
		expect(started().resume).toBeUndefined()
		expect(adapterInput()).toMatchObject({ resume: undefined, tools: [ASK_USER_TOOL] })
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
			// Plan call P10: the agent never started the run. A message is not withdrawn (#66).
			expect(dal.finishRun).toHaveBeenCalledWith(key, {
				status: 'failed',
				error: { code, message: UPSTREAM_MESSAGES[code], beforeStream: true },
				custom: [],
			})
			expect(dal.finishRun.mock.calls[0][1]).not.toHaveProperty('withdraw')
			expect(errorSpy).toHaveBeenCalledWith('runTurn:', { appId: APP_ID, runId: key.runId, code })
			expect(sessions[0].finish).not.toHaveBeenCalled()
			expect(activeRuns.has(key.runId)).toBe(false)
			errorSpy.mockRestore()
		},
	)

	it('stores the run failed before it releases it', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const held: boolean[] = []
		dal.finishRun.mockImplementation(async (key: { runId: string }) => {
			held.push(activeRuns.has(key.runId))
		})
		opens({ ok: false, code: 'provider_unreachable' }, Promise.resolve({ failed: true }))
		await run({ message: { text: 'hi' } })
		expect(held).toEqual([true])
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})

	// Plan call P10, decision 62's first answer: the answers never reached the agent, so what they answered stays open.
	it('stores a refused answering run before it releases it, withdrawing exactly its answers', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const held: boolean[] = []
		dal.finishRun.mockImplementation(async (key: { runId: string }) => {
			held.push(activeRuns.has(key.runId))
		})
		opens({ ok: false, code: 'agent_rejected_input' }, Promise.resolve({ failed: true }))
		dal.continuedRun.mockResolvedValue(
			interrupted([{ id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }]),
		)
		dal.loadThread.mockResolvedValue([
			userRow(1, 'm1', 'Clean up'),
			callRow(2, 'call-1'),
			askRow(3, 'q1'),
			askRow(4, 'q2'),
			callRow(5, 'call-9'),
		])
		const resume = [{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } }]
		const response = await run(
			{
				conversationId: CONVERSATION_ID,
				answers: {
					resume,
					toolResults: [
						{ toolCallId: 'q2', content: TRANSCRIPT },
						{ toolCallId: 'q1', content: TRANSCRIPT },
					],
				},
			},
			{ target: askingApp },
		)
		expect((await envelope(response)).status).toBe(502)
		const messages: { id: string; toolCallId: string; error?: string }[] = started().messages
		// call-9's not-available answer (plan call P4) is stored with the run and never withdrawn.
		expect(messages.map(message => [message.toolCallId, message.error])).toEqual([
			['call-9', UNAVAILABLE_TOOL_ERROR],
			['q1', undefined],
			['q2', undefined],
		])
		expect(started().resume).toEqual(resume)
		expect(dal.finishRun).toHaveBeenCalledWith(
			{ conversationId: CONVERSATION_ID, runId: started().runId },
			{
				status: 'failed',
				error: {
					code: 'agent_rejected_input',
					message: UPSTREAM_MESSAGES.agent_rejected_input,
					beforeStream: true,
				},
				custom: [],
				withdraw: [messages[1].id, messages[2].id],
			},
		)
		expect(held).toEqual([true])
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})

	it('withdraws the answers when the hub cannot hand the answering run to the agent', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const thread = [userRow(1, 'm1', 'Plan a trip'), askRow(2, 'q1')]
		dal.continuedRun.mockResolvedValue(succeeded)
		dal.loadThread.mockResolvedValueOnce(thread).mockRejectedValueOnce(new Error('db down'))
		await expect(
			run(
				{
					conversationId: CONVERSATION_ID,
					answers: { toolResults: [{ toolCallId: 'q1', content: TRANSCRIPT }] },
				},
				{ target: askingApp },
			),
		).rejects.toThrow('db down')
		expect(dal.finishRun).toHaveBeenCalledWith(
			{ conversationId: CONVERSATION_ID, runId: started().runId },
			{
				status: 'failed',
				error: { code: 'internal_error', message: '', beforeStream: true },
				custom: [],
				withdraw: [started().messages[0].id],
			},
		)
		errorSpy.mockRestore()
	})

	it('stores the run failed and rethrows when the hub cannot hand it to the agent', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		dal.loadThread.mockRejectedValueOnce(new Error('db down'))
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('db down')
		expect(dal.finishRun).toHaveBeenCalledWith(
			{ conversationId: started().conversation.id, runId: started().runId },
			{
				status: 'failed',
				error: { code: 'internal_error', message: '', beforeStream: true },
				custom: [],
			},
		)
		expect(chat.runTurn).not.toHaveBeenCalled()
		expect(activeRuns.has(started().runId)).toBe(false)
		errorSpy.mockRestore()
	})

	it('stores the run failed before it releases it when the hand-over throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const held: boolean[] = []
		dal.finishRun.mockImplementation(async (key: { runId: string }) => {
			held.push(activeRuns.has(key.runId))
		})
		chat.runTurn.mockImplementation(() => {
			throw new Error('adapter broke')
		})
		await expect(run({ message: { text: 'hi' } })).rejects.toThrow('adapter broke')
		expect(held).toEqual([true])
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
		const response = await run({ message: { text: 'hi' } }, { signal: browser.signal })
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
		const pending = run({ message: { text: 'hi' } }, { signal: browser.signal })
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

In `__tests__/agui-chat.test.ts`, replace the imports

```ts
import type { ChatTurnInput } from '@/lib/chat/adapter'
import { aguiChat, upstreamCodeFor } from '@/lib/providers/agui/chat'
```

with

```ts
import type { ChatTurnInput } from '@/lib/chat/adapter'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { ASK_USER_TOOL } from '@/lib/chat/hub-tools'
import { aguiChat, upstreamCodeFor } from '@/lib/providers/agui/chat'
```

replace

```ts
describe('aguiChat.runTurn', () => {
```

with

```ts
// Spec §6.2, plan call P1: ask_user is advertised only while the app's switch is on (decision 62: as it is now).
describe('aguiChat.hubTools', () => {
	it('names ask_user while the switch is on, and nothing while it is off', () => {
		expect(aguiChat.hubTools({ ...app.settings, askUser: true })).toEqual([ASK_USER_TOOL_NAME])
		expect(aguiChat.hubTools({ ...app.settings, askUser: false })).toEqual([])
	})
})

describe('aguiChat.runTurn', () => {
```

and, inside `describe('aguiChat.runTurn'`, replace

```ts
// Spec §2.3: a token minted for each request.
```

with

```ts
// Spec §2.3, §6.2: the agent contract's one change in 2b, RunAgentInput.tools, sent as the run gives it.
it('sends the hub’s tools it is given', async () => {
	fetchMock.mockResolvedValue(sse(finishedRun))
	await aguiChat.runTurn(app, input({ tools: [ASK_USER_TOOL] }), recordingSink().sink).finished
	const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
	expect(JSON.parse(String(init.body)).tools).toEqual([ASK_USER_TOOL])
})

// Spec §2.3: a token minted for each request.
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/agui-chat.test.ts`

Expected: FAIL, 13 failed, among them `TypeError: aguiChat.hubTools is not a function`, the two "advertises ask_user only while the switch is on" cases, "refuses a message while an ask_user question is open, storing nothing" and every refusal case that now expects `beforeStream: true`. ("answers a pending ask_user call as not available once the switch is off" already passes: it is 2a's plan call P4.)

- [ ] **Step 3: Implement**

In `lib/chat/adapter.ts`, replace

```ts
import type { ProviderSecrets, ProviderSettings } from '@/lib/providers/schemas'
```

with

```ts
import type { ProviderSecrets, ProviderSettings } from '@/lib/providers/schemas'

import type { HubToolName } from './hub-tools'
```

replace

```ts
	/** 2a: always [] (plan call P4). */
	tools: Tool[]
	resume?: ResumeEntry[]
```

with

```ts
	/** The hub's own tools the app advertises (spec §6.2; plan call P1): hubToolDefinitions(chat.hubTools(settings)). */
	tools: Tool[]
	/** The answers to the continued run's interrupts (spec §6.1), in their order; absent when the run answers none. */
	resume?: ResumeEntry[]
```

and replace

```ts
export interface ChatAdapter<P extends ProviderId> {
	runTurn(
```

with

```ts
export interface ChatAdapter<P extends ProviderId> {
	/**
	 * The hub's own tools this app advertises (plan call P1; spec §4.1: the adapter is given "the tools"), read from its
	 * settings as they are now (decision 62): the run advertises their definitions, and its open items read the same names.
	 */
	hubTools(settings: ProviderSettings<P>): HubToolName[]
	runTurn(
```

In `lib/providers/agui/chat.ts`, replace

```ts
import type { ChatAdapter, ChatTurnOpened, UpstreamErrorCode } from '@/lib/chat/adapter'
```

with

```ts
import type { ChatAdapter, ChatTurnOpened, UpstreamErrorCode } from '@/lib/chat/adapter'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
```

and replace

```ts
export const aguiChat: ChatAdapter<'agui'> = {
	runTurn({ settings, secrets }, input, sink) {
```

with

```ts
export const aguiChat: ChatAdapter<'agui'> = {
	/**
	 * Spec §6.2: `ask_user` is advertised only while the app's switch is on (off by default: Pydantic AI fails a run whose
	 * agent already has a tool of that name); decision 62: the switch as it is now, for a pending call too.
	 */
	hubTools: settings => (settings.askUser ? [ASK_USER_TOOL_NAME] : []),
	runTurn({ settings, secrets }, input, sink) {
```

Replace the whole of `lib/chat/run.ts` (as of Task 7) with:

```ts
import 'server-only'

import type { Message, ResumeEntry, Tool } from '@ag-ui/core'

import type { SessionUser } from '@/lib/auth/session'
import {
	continuedRun,
	finishRun,
	loadThread,
	startRun,
	truncateStaleRun,
	type ConversationRecord,
	type RunEnd,
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
import { anyOpen, checkAnswers, openItemsOf } from './answers'
import { hubToolDefinitions } from './hub-tools'
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
 * (§3.2 step 5); then the open items are read (decision 62: the continued run's interrupts and, while the app advertises
 * ask_user, the thread's unanswered calls to it): a message while anything is open answers 409 answer_pending (decision
 * 50), answers that do not cover exactly what is open 400 answers_invalid. Step 2, the store: the messages and the run in
 * one transaction (startRun; an active run answers 409 run_in_progress), a new conversation created with them. Steps 3–5
 * in streamRun.
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
	// The thread is read after the reconcile, which answers a crashed run's calls, and before startRun: the open questions
	// are its unanswered ask_user calls. The hub's tools are the app's switch as it is now (plan call P1; decision 62).
	const thread = conversation ? threadForAgent(await loadThread(conversation.id)) : []
	const hubTools = chat.hubTools(app.settings)
	const open = openItemsOf(
		conversation ? await continuedRun(conversation.id) : null,
		thread,
		hubTools,
	)
	let resume: ResumeEntry[] | undefined
	let answers: Message[] = []
	if (body.answers) {
		const checked = checkAnswers(open, body.answers)
		if (!checked.ok) return errorResponse('answers_invalid', ANSWERS_INVALID, 400)
		// Answers to questions alone resume no interrupt: the run carries their tool messages and no `resume` (AG-UI
		// "Tool calls" › Frontend tools: "the next run's `messages` carry a tool message per call").
		resume = checked.resume.length > 0 ? checked.resume : undefined
		answers = checked.toolMessages
	} else if (anyOpen(open)) return errorResponse('answer_pending', ANSWER_PENDING, 409)

	// Plan call P4 (spec §6.2): a call to a tool the hub never advertised, left without a result, is answered with an error
	// tool message, so the next history is valid. The open questions (the answers cover exactly them), and a gated call an
	// open interrupt names (its result comes from the resumed run), are left alone.
	const kept = new Set([
		...open.questions.map(question => question.toolCallId),
		...open.interrupts.flatMap(interrupt => (interrupt.toolCallId ? [interrupt.toolCallId] : [])),
	])
	const notAvailable = unansweredToolCalls(thread)
		.filter(call => !kept.has(call.toolCallId))
		.map(call =>
			errorToolMessage(call.toolCallId, UNAVAILABLE_TOOL_ERROR, UNAVAILABLE_TOOL_CONTENT),
		)
	const text = body.message?.text
	const userMessage: Message[] =
		text === undefined ? [] : [{ id: crypto.randomUUID(), role: 'user', content: text }]
	const title = conversation ? conversation.title : titleFrom(text ?? '')

	// The run is held by this process before the database says it is active: a request that finds an activeRunId that
	// activeRuns does not hold truncates it as a crash's leftover (spec §3.2 step 5), so registering after startRun would
	// leave a window in which a live run is truncated. The ids are known beforehand (a new conversation's is made here).
	const runId = crypto.randomUUID()
	const conversationId = conversation ? conversation.id : crypto.randomUUID()
	const controller = new AbortController()
	activeRuns.register(runId, { conversationId, controller })
	let started: Awaited<ReturnType<typeof startRun>>
	try {
		started = await startRun(actor, {
			appId: app.id,
			conversation: conversation
				? { id: conversationId }
				: { id: conversationId, title, isNew: true },
			runId,
			messages: [...notAvailable, ...answers, ...userMessage],
			resume,
		})
	} catch (error) {
		activeRuns.release(runId)
		throw error
	}
	if (!started.ok) {
		activeRuns.release(runId)
		return started.code === 'run_in_progress'
			? errorResponse('run_in_progress', RUN_IN_PROGRESS, 409)
			: conversationNotFound()
	}
	return streamRun({
		request,
		actor,
		app,
		chat,
		key: started.key,
		controller,
		title,
		state: conversation?.state ?? {},
		resume,
		tools: hubToolDefinitions(hubTools),
		withdraw: answers.map(message => message.id),
	})
}

/**
 * Steps 3–5. The thread is read back from the store (§3.3), the rows just written included, and handed to the adapter
 * with the run's own AbortController, which the stop route (§4.5) and a disconnect abort through activeRuns, and with
 * the hub's tools the app advertises (§6.2). The session writes `hub:run` before the adapter can report an event. A
 * refusal before any stream (§4.3 step 4) answers the envelope and stores the run failed, unless a stop caused it: then,
 * as every other run, it is settled by the session (§4.5).
 *
 * A run the agent never started, refused before its stream or failed by the hub before it was sent, is stored with
 * `beforeStream` and withdraws the answers' tool messages it carried, in the transaction that ends it (plan call P10;
 * decision 62's first answer): what they answered stays open, and the next answers resume the run the agent did start.
 * Its `resume` stays on the row for the Logs. Plan call P4's answers stay (no open item waits for them), and so does a
 * user message, as 2a stores it (#66).
 */
const streamRun = async ({
	request,
	actor,
	app,
	chat,
	key,
	controller,
	title,
	state,
	resume,
	tools,
	withdraw,
}: Omit<RunTurnArgs, 'body'> & {
	key: RunKey
	controller: AbortController
	title: string
	state: unknown
	resume: ResumeEntry[] | undefined
	tools: Tool[]
	/** The ids of the tool messages the answers added (plan call P10). */
	withdraw: string[]
}): Promise<Response> => {
	const endBeforeStream = (code: string, message: string): RunEnd => ({
		status: 'failed',
		error: { code, message, beforeStream: true },
		custom: [],
		...(withdraw.length > 0 ? { withdraw } : {}),
	})
	const out = createEventStream()
	let onDisconnect: (() => void) | undefined
	const detach = () => {
		if (onDisconnect) request.signal.removeEventListener('abort', onDisconnect)
	}
	let session: RunSession
	let handle: ChatTurnHandle
	let opened: ChatTurnOpened
	try {
		const messages = threadForAgent(await loadThread(key.conversationId))
		// The session seeds its write memory with the thread the agent is given, so no history row is written again (Task 10).
		session = new RunSession({ key, appId: app.id, title, out, history: messages })
		// Spec §4.5: the browser that goes away aborts the upstream request (the run is stored truncated). Next aborts
		// `request.signal` when the client disconnects: the docs are silent for Node Route Handlers; the source is
		// NextRequestAdapter (part2-proxy-stop-identity.md §6). A signal already aborted fires no event, so it is read first.
		onDisconnect = () => void activeRuns.stop(key.runId, key.conversationId, 'disconnect')
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
				tools,
				resume,
				caller: { id: actor.id, source: actor.source, role: actor.role },
				abortController: controller,
			},
			session,
		)
		opened = await handle.opened
	} catch (error) {
		// An upstream request the adapter already started must not outlive the failure.
		controller.abort()
		detach()
		// The run is stored before it is released, as in settle: a concurrent request must not truncate it meanwhile.
		try {
			await finishRun(key, endBeforeStream('internal_error', ''))
		} catch (finishError) {
			logActionError(finishError, 'runTurn')
		} finally {
			endStream(out, key.runId)
		}
		throw error
	}
	if (!opened.ok && activeRuns.reasonOf(key.runId) === undefined) {
		logRun(app.id, key.runId, opened.code)
		detach()
		try {
			await finishRun(key, endBeforeStream(opened.code, UPSTREAM_MESSAGES[opened.code]))
		} finally {
			endStream(out, key.runId)
		}
		return errorResponse(opened.code, UPSTREAM_MESSAGES[opened.code], UPSTREAM_STATUS[opened.code])
	}
	void settle(handle, session, key, app.id, out, detach)
	return new Response(out.stream, { headers: SSE_HEADERS })
}

/** Closes the browser's stream first (an open one reschedules its keep-alive for good), then lets the process release the run. */
const endStream = (out: { close(): void }, runId: string): void => {
	try {
		out.close()
	} finally {
		activeRuns.release(runId)
	}
}

/**
 * The rest of the run while the response streams: once the adapter's run is over (`finished` never rejects), the session
 * decides its status, closes what is open, writes the end and the browser's last events (§3.2 steps 3–4, §4.5); then the
 * stream ends and the run is released. A failing end write is logged by code; the run stays stored as running, and once
 * released the next request truncates it (§3.2 step 5).
 */
const settle = async (
	handle: ChatTurnHandle,
	session: RunSession,
	key: RunKey,
	appId: string,
	out: { close(): void },
	detach: () => void,
): Promise<void> => {
	try {
		const { failed } = await handle.finished
		await session.finish({ failed, stopReason: activeRuns.reasonOf(key.runId) })
	} catch (error) {
		logRun(appId, key.runId, 'finish_failed')
		logActionError(error, 'runTurn')
	} finally {
		detach()
		endStream(out, key.runId)
	}
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/agui-chat.test.ts`

Expected: PASS, 2 files, 52 tests.

- [ ] **Step 5: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/chat/adapter.ts lib/providers/agui/chat.ts lib/chat/run.ts __tests__/chat-run.test.ts __tests__/agui-chat.test.ts
pnpm exec oxfmt --check lib/chat/adapter.ts lib/providers/agui/chat.ts lib/chat/run.ts __tests__/chat-run.test.ts __tests__/agui-chat.test.ts
pnpm test
```

Expected: tsc exits 0 (every `ChatAdapter` now has `hubTools`), oxlint finds nothing, oxfmt "All matched files use the correct format", vitest 0 failed. `lib/data/` is unchanged, so no `pnpm test:db`.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/adapter.ts lib/providers/agui/chat.ts lib/chat/run.ts __tests__/chat-run.test.ts __tests__/agui-chat.test.ts
git commit -m "feat(chat): advertise ask_user and run the answers to questions

The chat adapter names the hub's tools an app advertises (AG-UI: ask_user while its switch
is on), and the run sends their definitions. The open items read the thread's unanswered
ask_user calls, a message while one is open is refused, and a run the agent never started
is stored failed with beforeStream, withdrawing the answers it carried (Part 2 spec §4.3,
§6.2; plan calls P1, P10; decision 62).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["lib/chat/adapter.ts", "lib/providers/agui/chat.ts", "lib/chat/run.ts", "__tests__/chat-run.test.ts", "__tests__/agui-chat.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/agui-chat.test.ts", "acceptanceCriteria": ["`pnpm exec vitest run --project unit __tests__/chat-run.test.ts __tests__/agui-chat.test.ts` reports 2 files passed: 29 and 23 tests.", "`ChatAdapter` has `hubTools(settings): HubToolName[]`; `aguiChat.hubTools` answers `['ask_user']` while `settings.askUser` is true and `[]` otherwise, and the request body's `tools` is the run's `tools` as given.", "The adapter's `tools` is `[ASK_USER_TOOL]` for an app whose switch is on and `[]` otherwise, read with `chat.hubTools(app.settings)`.", "The thread and the continued run are read after `truncateStaleRun` and before `startRun`.", "A message while an `ask_user` call is open (switch on) answers 409 `answer_pending` and stores nothing; with the switch off the same call is answered `not_available` before the message (decision 62).", "Answers to a question store exactly its tool message (no not-available answer for it) and start the run with no `resume`, in the store and for the adapter.", "A refused answering run calls `finishRun(key, { status: 'failed', error: { code, message, beforeStream: true }, custom: [], withdraw })` while `activeRuns` still holds the run, `withdraw` being exactly the answers' tool message ids in order (never plan call P4's not-available answer); its `resume` is stored; the hub's own failure before sending does the same with `internal_error`.", "A refused message run is stored with `beforeStream: true` and no `withdraw`.", "tsc, oxlint and oxfmt clean; `pnpm test` green."], "modelTier": "standard"}
```

---

### Task 9: Queued sends in both chat hooks (#68)

**Goal:** A send that waited in useXChat's queue no longer blocks its conversation for good: both chat hooks keep their queued flags in one shared, side-effect-free `createQueuedSends`, and a key's flag also clears when that key's reply ends, from the per-key provider's XRequest `callbacks`, whichever conversation is on screen.

Issue #68 (from 2a's review of `useSharedChat`; the same code is in the Dify chat): a send made while a conversation's history loads waits in X's queue and the hook marks the key queued; the flag is cleared only by an effect that runs while the queued key is the one on screen and a render shows `chat.isRequesting`. A reply that starts and ends without such a render (refused at once, or ended after the user moved on) leaves the flag set, so `sendDecision` answers `ignore` for every later send to that conversation and the list stays locked (`locked = chat.queued`). Plan call P12 fixes both hooks together so they do not diverge: `components/chat/hooks/queued-sends.ts` (Shared contracts) is side-effect-free like `send-decision.ts`; each hook keeps one per instance through useState's initializer (React `useState` reference, "Avoiding recreating the initial state"; the `set` function `setQueuedKeys` it is given has a stable identity), as x-sdk keeps its queue per hook (`messageQueueRef`, x-sdk 2.9.0 `es/x-chat/index.js`); the existing effect still clears the key on screen once it requests (the SDK flushes the queue in a `setTimeout` after the history lands, `processMessageQueue`, so clearing at the history's end would let a second send through); and a module-level map from key to the latest hook's `clear`, set in the hooks' existing `useLayoutEffect` beside `conversationIdSinks`/`runSinks`, is called from the key's XRequest `callbacks.onSuccess` and `callbacks.onError`. Sources for the callbacks: the `x-chat-provider` skill, "callbacks" ("onError: triggered on request failure (including AbortError)"; "`callbacks` and `useXChat`'s `requestFallback` do not conflict — both execute"), the `x-request` skill's API (`XRequestCallbacks`: `onSuccess`, `onError`, `onUpdate`), and x-sdk 2.9.0 `es/chat-providers/AbstractChatProvider.js`: the constructor keeps `request.options.callbacks` as `_originalCallbacks`, and `injectRequest` calls each after useXChat's own handler (which already set `isRequesting` false, `es/x-chat/index.js` lines 225–233), for every request of that provider, so for every key on screen or not. The Dify provider already passes `callbacks` for `endResume`; the clear is added after it, and nothing else in the Dify chat changes (its e2e specs stay green, Global Constraints). The shared chat's XRequest gains `callbacks`. Task 10 changes `use-shared-chat.ts` after this task and quotes it as of this task.

**Files:**

- Create: `components/chat/hooks/queued-sends.ts`
- Modify: `components/chat/hooks/use-dify-chat.ts` (the queued flags through `createQueuedSends`; the provider's `callbacks` clear the key)
- Modify: `components/shared-chat/hooks/use-shared-chat.ts` (the same; its XRequest gains `callbacks`)
- Test: `__tests__/chat-queued-sends.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/chat-queued-sends.test.ts` reports 4 tests passed: `add`/`has`/`clear`; `onChange` gets a new Set on each change and a Set already handed out never changes; adding a queued key again or clearing a key that is not queued does not notify; the #68 sequence (queue, ignore, the reply ends unseen, the callback's clear, then `send`).
- [ ] Neither hook keeps `queuedRef`: `grep -rn queuedRef components/` prints nothing; both build `queued` with `useState(() => createQueuedSends(setQueuedKeys))` and register `queued.clear` in `queuedClearers` from their `useLayoutEffect`.
- [ ] Each per-key provider's XRequest has `callbacks.onSuccess` and `callbacks.onError` that call `queuedClearers.get(conversationKey)?.(conversationKey)`; the Dify ones still call `created.endResume()` / `created.endResume(error)` first.
- [ ] `pnpm test:e2e e2e/chat.spec.ts e2e/chat-race.spec.ts e2e/agui-chat.spec.ts --project desktop-light` passes with none failed or flaky (`chat-race.spec.ts` is the Dify chat's queued-send spec: a send while the history loads, and the locked list until its reply starts).
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm test`, `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the four files pass.

**Verify:** `pnpm exec vitest run --project unit __tests__/chat-queued-sends.test.ts && pnpm test:e2e e2e/chat.spec.ts e2e/chat-race.spec.ts e2e/agui-chat.spec.ts --project desktop-light` → vitest `Tests  4 passed (4)`; Playwright reports every test passed, 0 failed, 0 flaky

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/chat-queued-sends.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { createQueuedSends } from '@/components/chat/hooks/queued-sends'
import { sendDecision } from '@/components/chat/hooks/send-decision'

describe('createQueuedSends', () => {
	it('answers has at once after add, and forgets the key on clear', () => {
		const queued = createQueuedSends(() => {})
		expect(queued.has('a')).toBe(false)
		queued.add('a')
		expect(queued.has('a')).toBe(true)
		expect(queued.has('b')).toBe(false)
		queued.clear('a')
		expect(queued.has('a')).toBe(false)
	})
	it('hands onChange a new Set on each change, never its own', () => {
		const onChange = vi.fn<(keys: ReadonlySet<string>) => void>()
		const queued = createQueuedSends(onChange)
		queued.add('a')
		queued.add('b')
		queued.clear('a')
		expect(onChange.mock.calls.map(([keys]) => [...keys])).toEqual([['a'], ['a', 'b'], ['b']])
		const [first, second, third] = onChange.mock.calls.map(([keys]) => keys)
		expect(first).not.toBe(second)
		expect(second).not.toBe(third)
		// A later change does not alter a Set already handed out (React state compared with Object.is).
		expect([...first!]).toEqual(['a'])
	})
	it('does not notify for a key already queued, or for clearing a key that is not', () => {
		const onChange = vi.fn()
		const queued = createQueuedSends(onChange)
		queued.clear('a')
		queued.add('a')
		queued.add('a')
		queued.clear('a')
		queued.clear('a')
		expect(onChange).toHaveBeenCalledTimes(2)
	})
})

describe("a queued send's reply that ends unseen (#68)", () => {
	// The hook's calls, in order: its send (sendDecision), its effect (clears the key on screen in a render that shows it
	// requesting) and the per-key provider's XRequest callbacks (clear the key whose reply ended, wherever the user is).
	it('lets the conversation send again', () => {
		const queued = createQueuedSends(() => {})
		// A send while a's history loads waits in the SDK's queue.
		expect(
			sendDecision({
				isRequesting: false,
				isDefaultMessagesRequesting: true,
				queued: queued.has('a'),
			}),
		).toBe('queue')
		queued.add('a')
		// A second send before the reply starts is ignored (one reply at a time per conversation).
		expect(
			sendDecision({
				isRequesting: false,
				isDefaultMessagesRequesting: false,
				queued: queued.has('a'),
			}),
		).toBe('ignore')
		// a's reply starts and ends with no render showing a requesting: it was refused at once, or the user had moved to
		// another conversation. The effect never ran for it, so a is still marked; alone (2a's code), that ignored every
		// later send to a and kept the list locked.
		expect(queued.has('a')).toBe(true)
		// a's provider calls onSuccess (or onError) at the reply's end, which clears a.
		queued.clear('a')
		// On a, nothing runs and nothing waits: the next send goes.
		expect(
			sendDecision({
				isRequesting: false,
				isDefaultMessagesRequesting: false,
				queued: queued.has('a'),
			}),
		).toBe('send')
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/chat-queued-sends.test.ts`

Expected: FAIL with `Error: Cannot find package '@/components/chat/hooks/queued-sends'`.

- [ ] **Step 3: Implement `createQueuedSends`**

Create `components/chat/hooks/queued-sends.ts`:

```ts
/*
 * The sends that wait in useXChat's queue while a conversation's history loads (use-x-chat: queueRequest), by
 * conversation key. Shared by the Dify chat's hook and the shared chat's (#68, plan call P12), so the two do not
 * diverge; side-effect-free like send-decision.ts. A hook keeps one per instance (useState's initializer, React
 * "Avoiding recreating the initial state"), as x-sdk keeps its queue per hook (`messageQueueRef`, x-sdk 2.9.0
 * `es/x-chat/index.js`), so a flag never outlives the queue it stands for.
 */

export interface QueuedSends {
	has(key: string): boolean
	add(key: string): void
	/** The key's queued send has left, or its reply ended: nothing waits for it any more. */
	clear(key: string): void
}

/**
 * `has` answers at once, so two quick sends see the first. `onChange` gets a new Set after each change, for the React
 * state that renders the view's guard (React compares state with `Object.is`, so the same Set mutated would not
 * re-render). Adding a key already queued, or clearing a key that is not, changes nothing and calls nothing, so a hook
 * may clear on every render that requests.
 */
export const createQueuedSends = (onChange: (keys: ReadonlySet<string>) => void): QueuedSends => {
	const keys = new Set<string>()
	return {
		has: key => keys.has(key),
		add: key => {
			if (keys.has(key)) return
			keys.add(key)
			onChange(new Set(keys))
		},
		clear: key => {
			if (!keys.delete(key)) return
			onChange(new Set(keys))
		},
	}
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/chat-queued-sends.test.ts`

Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Use it in `useDifyChat`**

In `components/chat/hooks/use-dify-chat.ts`, replace:

```ts
import { nextPaging, prependLatestPage, prependOlder, type HistoryPaging } from './history-paging'
```

with:

```ts
import { nextPaging, prependLatestPage, prependOlder, type HistoryPaging } from './history-paging'
import { createQueuedSends, type QueuedSends } from './queued-sends'
```

Replace:

```ts
/** The latest `onConversationId` given for each key; the key's cached provider calls it from its stream. */
const conversationIdSinks = new Map<string, (key: string, difyId: string) => void>()
```

with:

```ts
/** The latest `onConversationId` given for each key; the key's cached provider calls it from its stream. */
const conversationIdSinks = new Map<string, (key: string, difyId: string) => void>()
/** The latest hook's queued-send `clear` for each key; the key's cached provider calls it when a reply ends (#68). */
const queuedClearers = new Map<string, QueuedSends['clear']>()
```

In the provider's XRequest options, replace:

```ts
							// The end of every request, whatever ended it (x-chat-provider skill, "callbacks": onError
							// includes AbortError); a resume stream's wait for its pause ends with it.
							callbacks: {
								onSuccess: () => created.endResume(),
								onError: error => created.endResume(error),
							},
```

with:

```ts
							// The end of every request, whatever ended it (x-chat-provider skill, "callbacks": onError
							// includes AbortError); a resume stream's wait for its pause ends with it, and so does the key's
							// queued send, whichever conversation is on screen (#68; x-sdk 2.9.0
							// AbstractChatProvider.injectRequest calls these after useXChat's own handlers, for every key).
							callbacks: {
								onSuccess: () => {
									created.endResume()
									queuedClearers.get(conversationKey)?.(conversationKey)
								},
								onError: error => {
									created.endResume(error)
									queuedClearers.get(conversationKey)?.(conversationKey)
								},
							},
```

Replace the `latest` ref, its layout effect, the queued flags and their effect:

```ts
// The callbacks below stay stable and read the committed render's values here (React: refs are
// written in effects, not during rendering).
const latest = useRef({ chat, provider, conversationKey, difyApi, appId })
useLayoutEffect(() => {
	latest.current = { chat, provider, conversationKey, difyApi, appId }
	if (!conversationKey) return
	difyIdReaders.set(conversationKey, getDifyConversationId)
	if (onConversationId) conversationIdSinks.set(conversationKey, onConversationId)
})

// Keys with a send waiting in the SDK's queue. Per hook instance, like that queue (use-x-chat keeps it in
// a ref of the hook, `messageQueueRef`), so a flag never outlives the queue it stands for. The ref answers
// `send` at once (two quick sends see the first); the state renders the view's guard (ADR-0017 note).
const queuedRef = useRef(new Set<string>())
const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
// The queued send has left once its key requests. The SDK flushes the queue in a `setTimeout` after the
// history lands, so clearing the flag when the history ends would let a second send through before it.
useEffect(() => {
	if (!chat.isRequesting || !queuedRef.current.has(conversationKey)) return
	queuedRef.current.delete(conversationKey)
	setQueuedKeys(new Set(queuedRef.current))
}, [chat.isRequesting, conversationKey])
```

with (the queued flags move above the layout effect, which registers their `clear`):

```ts
// Keys with a send waiting in the SDK's queue (queued-sends.ts): per hook instance, like that queue. `has`
// answers `send` at once (two quick sends see the first); the state renders the view's guard (ADR-0017 note).
const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
const [queued] = useState(() => createQueuedSends(setQueuedKeys))

// The callbacks below stay stable and read the committed render's values here (React: refs are
// written in effects, not during rendering).
const latest = useRef({ chat, provider, conversationKey, difyApi, appId })
useLayoutEffect(() => {
	latest.current = { chat, provider, conversationKey, difyApi, appId }
	if (!conversationKey) return
	difyIdReaders.set(conversationKey, getDifyConversationId)
	if (onConversationId) conversationIdSinks.set(conversationKey, onConversationId)
	queuedClearers.set(conversationKey, queued.clear)
})

// The queued send has left once its key requests. The SDK flushes the queue in a `setTimeout` after the
// history lands, so clearing the flag when the history ends would let a second send through before it. A
// reply that ends while another conversation is on screen clears its key from the provider's callbacks (#68).
useEffect(() => {
	if (chat.isRequesting) queued.clear(conversationKey)
}, [chat.isRequesting, conversationKey, queued])
```

Replace `send`:

```ts
const send = useCallback((params: SendParams) => {
	const { chat, conversationKey: key } = latest.current
	if (!key) return false
	const decision = sendDecision({
		isRequesting: chat.isRequesting,
		isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
		queued: queuedRef.current.has(key),
	})
	if (decision === 'ignore') return false
	const request: Partial<DifyChatInput> = {
		query: params.query,
		inputs: params.inputs,
		files: params.files,
	}
	if (decision === 'queue') {
		queuedRef.current.add(key)
		setQueuedKeys(new Set(queuedRef.current))
		chat.queueRequest(key, request)
	} else chat.onRequest(request)
	return true
}, [])
```

with:

```ts
const send = useCallback(
	(params: SendParams) => {
		const { chat, conversationKey: key } = latest.current
		if (!key) return false
		const decision = sendDecision({
			isRequesting: chat.isRequesting,
			isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
			queued: queued.has(key),
		})
		if (decision === 'ignore') return false
		const request: Partial<DifyChatInput> = {
			query: params.query,
			inputs: params.inputs,
			files: params.files,
		}
		if (decision === 'queue') {
			queued.add(key)
			chat.queueRequest(key, request)
		} else chat.onRequest(request)
		return true
	},
	[queued],
)
```

The hook's result keeps `queued: queuedKeys.has(conversationKey)` as it is; the React imports (`useEffect`, `useRef`, `useState`) are all still used.

- [ ] **Step 6: Use it in `useSharedChat`**

In `components/shared-chat/hooks/use-shared-chat.ts`, replace:

```ts
import { prependOlder } from '@/components/chat/hooks/history-paging'
```

with:

```ts
import { prependOlder } from '@/components/chat/hooks/history-paging'
import { createQueuedSends, type QueuedSends } from '@/components/chat/hooks/queued-sends'
```

Replace:

```ts
/** The latest `onRun` given for each key; the key's cached provider calls it from its stream. */
const runSinks = new Map<string, (key: string, value: HubRunValue) => void>()
```

with:

```ts
/** The latest `onRun` given for each key; the key's cached provider calls it from its stream. */
const runSinks = new Map<string, (key: string, value: HubRunValue) => void>()
/** The latest hook's queued-send `clear` for each key; the key's cached provider calls it when a reply ends (#68). */
const queuedClearers = new Map<string, QueuedSends['clear']>()
```

Replace:

```ts
						request: XRequest<SharedChatInput, SSEOutput, Turn>(runsUrl(appId), {
							manual: true,
							fetch: createHubFetch(appId),
						}),
```

with:

```ts
						request: XRequest<SharedChatInput, SSEOutput, Turn>(runsUrl(appId), {
							manual: true,
							fetch: createHubFetch(appId),
							// The end of every request, whatever ended it (x-chat-provider skill, "callbacks": onError
							// includes AbortError): the key's queued send no longer waits, whichever conversation is on
							// screen (#68; x-sdk 2.9.0 AbstractChatProvider.injectRequest calls these after useXChat's own
							// handlers, for every key).
							callbacks: {
								onSuccess: () => queuedClearers.get(conversationKey)?.(conversationKey),
								onError: () => queuedClearers.get(conversationKey)?.(conversationKey),
							},
						}),
```

Replace:

```ts
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
```

with:

```ts
// Keys with a send waiting in the SDK's queue, per hook instance like that queue (useDifyChat's rule, the same
// queued-sends.ts): `has` answers `send` at once, the state renders the view's guard.
const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
const [queued] = useState(() => createQueuedSends(setQueuedKeys))

// The callbacks below stay stable and read the committed render's values here (React: refs are written in effects,
// not during rendering).
const latest = useRef({ chat, provider, conversationKey, api })
useLayoutEffect(() => {
	latest.current = { chat, provider, conversationKey, api }
	if (!conversationKey) return
	conversationIdReaders.set(conversationKey, getConversationId)
	if (onRun) runSinks.set(conversationKey, onRun)
	queuedClearers.set(conversationKey, queued.clear)
})

// The queued send has left once its key requests (useDifyChat's rule); a reply that ends while another conversation
// is on screen clears its key from the provider's callbacks (#68).
useEffect(() => {
	if (chat.isRequesting) queued.clear(conversationKey)
}, [chat.isRequesting, conversationKey, queued])
```

Replace `send`:

```ts
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
```

with:

```ts
const send = useCallback(
	(text: string) => {
		const { chat, conversationKey: key } = latest.current
		if (!key) return false
		const decision = sendDecision({
			isRequesting: chat.isRequesting,
			isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
			queued: queued.has(key),
		})
		if (decision === 'ignore') return false
		const request: Partial<SharedChatInput> = { message: { text } }
		if (decision === 'queue') {
			queued.add(key)
			chat.queueRequest(key, request)
		} else chat.onRequest(request)
		return true
	},
	[queued],
)
```

Run: `grep -rn queuedRef components/`

Expected: no output.

- [ ] **Step 7: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/chat/hooks/queued-sends.ts components/chat/hooks/use-dify-chat.ts components/shared-chat/hooks/use-shared-chat.ts __tests__/chat-queued-sends.test.ts
pnpm exec oxfmt --check components/chat/hooks/queued-sends.ts components/chat/hooks/use-dify-chat.ts components/shared-chat/hooks/use-shared-chat.ts __tests__/chat-queued-sends.test.ts
pnpm test
```

Expected: tsc exits 0; oxlint exits 0 with no findings; oxfmt "All matched files use the correct format."; vitest 0 failed.

- [ ] **Step 8: The chat e2e specs on one project**

The Dify chat must behave exactly as before, and `chat-race.spec.ts` drives its queued send (a send while the history loads; the list locked until the reply starts). Stop `pnpm dev` first (one `next dev` per checkout), and do not run `pnpm test:db` beside it (both use the e2e PostgreSQL on 127.0.0.1:5433). Run:

```bash
pnpm test:e2e e2e/chat.spec.ts e2e/chat-race.spec.ts e2e/agui-chat.spec.ts --project desktop-light
rm -rf .next/dev/types && pnpm exec next typegen
```

Expected: Playwright lists the `setup` project and the three specs on `desktop-light`, every test passed, 0 failed, 0 flaky. The second line refreshes the route types the e2e run's `next dev` left stale (Global Constraints). A failure here is a behaviour change: fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add components/chat/hooks/queued-sends.ts components/chat/hooks/use-dify-chat.ts components/shared-chat/hooks/use-shared-chat.ts __tests__/chat-queued-sends.test.ts
git commit -m "fix(chat): clear a queued send's flag when its reply ends, in both chat hooks (#68)

A send made while a conversation's history loads waits in useXChat's queue; its flag was
cleared only by an effect that saw the key on screen requesting, so a reply that started and
ended unseen left the conversation ignoring every later send. Both hooks now keep their flags
in createQueuedSends (plan call P12), and each per-key provider's XRequest callbacks clear the
key when its reply ends, wherever the user is.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the four files; lint-staged passes.

```json:metadata
{"files": ["components/chat/hooks/queued-sends.ts", "components/chat/hooks/use-dify-chat.ts", "components/shared-chat/hooks/use-shared-chat.ts", "__tests__/chat-queued-sends.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/chat-queued-sends.test.ts && pnpm test:e2e e2e/chat.spec.ts e2e/chat-race.spec.ts e2e/agui-chat.spec.ts --project desktop-light", "acceptanceCriteria": ["chat-queued-sends.test.ts reports 4 tests passed: add/has/clear, a new Set per change, no notice for a repeated add or an absent clear, the #68 sequence", "neither hook keeps queuedRef (grep -rn queuedRef components/ prints nothing); both build queued with useState(() => createQueuedSends(setQueuedKeys)) and register queued.clear in queuedClearers from their useLayoutEffect", "each per-key provider's XRequest callbacks onSuccess and onError call queuedClearers.get(conversationKey)?.(conversationKey); the Dify ones still call endResume first", "pnpm test:e2e e2e/chat.spec.ts e2e/chat-race.spec.ts e2e/agui-chat.spec.ts --project desktop-light passes with none failed or flaky", "tsc, pnpm test, oxlint and oxfmt --check on the four files pass"], "modelTier": "standard"}
```

---

### Task 10: The browser's answers: drafts, sending, and a failed answer shown (#67)

**Goal:** `useSharedChat` derives the last turn's open items, keeps one decision per item in a per-conversation draft, and sends all of them through `onReload` when the last one is in; the provider merges `ask_user` answers into the turn only when the request starts; a failed answer (#67) shows its error under cards that stay answerable; and `useExpiryClock` re-renders when the next interrupt expires.

Spec §6.1 ("Several open interrupts: decisions wait in the browser until every one has one, then go back as one `resume[]`", "The resume list MUST cover every interrupt"; CopilotKit and assistant-ui wait the same way), §6.2 (no `TOOL_CALL_RESULT` comes back for a frontend tool, so "the hub writes it into the turn itself"; "the turn continues through `onReload`"), §5.2 (the side store holds "the pending answers"; `requestFallback` handles transport failures only), decision 62's third answer (the answers go when the last open item has one; a decision can be changed until then) and fourth (a pending `ask_user` call counts while the app's switch is on now), plan calls P11 (#67), P13 (drafts) and P14 (expiry), and the Shared contracts' "Browser". Issue #67: 2a's `fallbackTurn` left a turn unchanged whenever its last run was not `running`, so a refused or failed request that answered an interrupted turn was swallowed and the Sender stayed disabled. Now such a failure is appended as a closed error run with no id (this request's failure, not the interrupted run's; the server stores a refused answering run `failed` with `beforeStream` and leaves the items open, Tasks 6 and 8), the turn keeps its interrupts and waiting calls so its cards answer again, and an abort of that request leaves the turn as it was; a run still running is closed as in 2a, and its calls without a result, `waiting` ones too, read `stopped`, which is how Task 5's reducer settles them after a cancel or an error and how the reloaded turn reads them. P11's ordering: the `ask_user` answers merge in `transformParams` (when the request starts) into `resumeBase`, which `transformMessage` uses from the first chunk; `requestPlaceholder` keeps returning `params.continues` as it is, so a refusal before the stream reaches `requestFallback` with the questions unanswered (x-sdk 2.9.0 `es/x-chat/index.js`: on a reload the placeholder replaces the message, and `onError` hands `requestFallback` that message as `messageInfo`, then re-adds the fallback at the end under a new id). `answer` reads the draft from the side store's Map when it is called, never from a render's snapshot, because a card may record several decisions in one handler (Task 15's `ask_user` card does); it stores `EMPTY_DRAFT` before `chat.onReload(lastMessage.id, { answers, continues: lastMessage.message })` (`onReload` throws for an id the store no longer holds, `index.js` lines 279–291), so after a failure the cards start over; and `decide` ignores a decision while a request runs, read from the hook's `isRequesting` or the request's own flag, which `run()` sets at once (the `x-request` skill's API, `XRequestClass.isRequesting`; `es/x-request/index.js` `startRequest`), so one decision never sends twice even within one handler. `decide` also takes `now` (P14), which `answer` reads when the card is clicked (an event handler, not a render): a `resolved` decision for an interrupt that `isExpired` at that time counts as missing in `draftCovers` and `answersBody`, because only Dismiss (`cancelled`) answers an expired interrupt (spec §6.1) and the server refuses to resolve one (400 `answers_invalid`, spec §4.3); the decision then waits in the draft while the card offers Dismiss (Task 13's interrupt card and Task 11's approval footer show Dismiss for an expired interrupt with a resolved decision). The draft is read with `useSyncExternalStore` like the store's other entries (React reference). `nextExpiry` follows `@ag-ui/client` 1.0.2's rule (`isInterruptExpired`: `new Date(expiresAt) <= now`) and `@ag-ui/core` 1.0.2's `Interrupt.expiresAt` ("a value that is not one leaves the interrupt looking permanently unexpired"); `useExpiryClock` keeps the time in state set from a timer in an Effect (React, the `purity` lint, "I need to show the current time"; "Synchronizing with Effects" for the cleanup), its delay capped at setTimeout's longest (MDN "setTimeout()", Maximum delay value: 2,147,483,647 ms; "Negative values behave the same as 0"), re-armed on each tick, so an expiry further away is reached in steps. `shared-chat.tsx` keeps compiling with two lines: `askUser: app.askUser` (Task 1's chat DTO field) and the composer's `waiting` read from `hasOpenItems(chat.openItems)`; Task 15 rewires the view and places the cards, which call `answer` and `retract` and read `draft` and `useExpiryClock` through Task 11's context.

**Depends on:** Task 1 (`AguiChatFields.askUser`), Task 2 (`parseAskUserArgs`, `ASK_USER_TOOL_NAME`, `INVALID_QUESTION_CONTENT`), Task 3 (`isExpired`), Task 5 (`ToolPart`, the `waiting` status, `lib/chat/open-items.ts`), Task 9 (`use-shared-chat.ts` as of Task 9).

**Files:**

- Create: `components/shared-chat/answers.ts`
- Create: `components/shared-chat/hooks/use-expiry-clock.ts`
- Modify: `components/shared-chat/provider/ag-ui-chat-provider.ts` (`ResumeAnswer`, `ToolAnswer`, `SharedChatInput`; `transformParams` merges the tool answers into `resumeBase`)
- Modify: `components/shared-chat/hooks/chat-helpers.ts` (the whole file: `fallbackTurn` per P11, `openItemsOf` in place of `openInterruptsOf`)
- Modify: `components/shared-chat/hooks/use-shared-chat.ts` (the whole file, as of Task 9: `askUser`, the draft in the side store, `answer`, `retract`, `openItems`, `draft`)
- Modify: `components/shared-chat/shared-chat.tsx` (`askUser: app.askUser`; the composer's `waiting` reads `hasOpenItems(chat.openItems)`)
- Test: `__tests__/shared-chat-answers.test.ts`
- Test: `__tests__/shared-chat-helpers.test.ts` (#67's cases, `openItemsOf`)
- Test: `__tests__/shared-chat-provider.test.ts` (the merge in `transformParams`, a boolean payload)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts` reports 3 files and 48 tests passed (17, 16, 15).
- [ ] `decide({ open, draft, answer, isRequesting, now })` answers `keep` with the grown draft while another item is open, `send` with the body in the open items' order once every open item has a decision that holds at `now`, and `ignore` while a request runs (a second call after a send) and for an item that is not open; a `resolved` decision for an interrupt expired at `now` counts as missing (the last answer after that expiry keeps, and Dismiss for it then sends with that interrupt `cancelled`); `draftCovers` is false when nothing is open and never counts an inherited key such as `toString`; `answersBody` leaves out an empty list, any decision for an item that is not open, and, given `now`, a resolved decision for an expired interrupt.
- [ ] `withToolAnswers` makes an answered `ask_user` call `done` with its transcript and a call whose arguments fail `parseAskUserArgs` `error` with `INVALID_QUESTION_CONTENT`, leaves other parts and the given turn untouched, and gives back the same turn for no answers.
- [ ] `fallbackTurn` appends `{ runId: '', outcome: 'error', error: { code, message: '' } }` to a turn whose last run has ended, keeping its parts and interrupts (so `openItemsOf` still reports them); an AbortError leaves that turn as it was (the same object); a running run is closed as in 2a, its `running` and `waiting` calls `stopped`.
- [ ] `transformParams` sends `{ conversationId, answers }` with no `continues`, does not change the turn it was given, and the first chunk shows the merged turn; a resume payload may be a bare boolean (P6).
- [ ] `useSharedChat` takes `askUser` and returns `openItems`, `draft`, `answer` and `retract`, not `openInterrupts`: `grep -rn openInterrupts components/ __tests__/` prints nothing; `shared-chat.tsx` passes `askUser: app.askUser`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm test`, `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the changed files pass, and `npx -y @ant-design/cli lint ./ --format json` still reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts` → `Test Files  3 passed (3)`, `Tests  48 passed (48)`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `__tests__/shared-chat-answers.test.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import {
	answersBody,
	decide,
	draftCovers,
	EMPTY_DRAFT,
	nextExpiry,
	withAnswer,
	withoutAnswer,
	withToolAnswers,
	type AnswerDraft,
	type ItemAnswer,
} from '@/components/shared-chat/answers'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { NO_OPEN_ITEMS, type TurnOpenItems } from '@/lib/chat/open-items'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
import { emptyAssistantTurn, type ToolPart, type Turn } from '@/lib/chat/turn'

const approval: Interrupt = { id: 'int-1', reason: 'tool_call', toolCallId: 'c1' }
const form: Interrupt = { id: 'int-2', reason: 'input_required', message: 'Which region?' }
const question = (
	toolCallId: string,
	args = JSON.stringify({ questions: [{ question: 'Which city?' }] }),
): ToolPart => ({ kind: 'tool', toolCallId, name: ASK_USER_TOOL_NAME, args, status: 'waiting' })

/** Two interrupts and one question: the open items of one turn, in their order. */
const open: TurnOpenItems = { interrupts: [approval, form], questions: [question('q1')] }

const approve: ItemAnswer = {
	kind: 'resume',
	interruptId: 'int-1',
	status: 'resolved',
	payload: { approved: true },
}
const region: ItemAnswer = {
	kind: 'resume',
	interruptId: 'int-2',
	status: 'resolved',
	payload: { region: 'eu' },
}
const city: ItemAnswer = { kind: 'tool', toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' }

/** The draft after these decisions, in order. */
const draftOf = (...answers: ItemAnswer[]): AnswerDraft => answers.reduce(withAnswer, EMPTY_DRAFT)

/** The time the decisions are judged at (P14), and an approval that expired a minute before it. */
const NOW = new Date('2026-10-14T12:00:00Z')
const expired: Interrupt = { ...approval, expiresAt: '2026-10-14T11:59:00Z' }
const dismiss: ItemAnswer = { kind: 'resume', interruptId: 'int-1', status: 'cancelled' }

describe('the draft (plan call P13)', () => {
	it('keeps each decision under its item id, without its kind', () => {
		expect(draftOf(approve, city)).toEqual({
			resume: {
				'int-1': { interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
			},
			tools: { q1: { toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' } },
		})
	})
	it('replaces a decision for the same item, and leaves the draft it was given as it was', () => {
		const first = draftOf(approve)
		const changed = withAnswer(first, { kind: 'resume', interruptId: 'int-1', status: 'cancelled' })
		expect(changed.resume['int-1']).toEqual({ interruptId: 'int-1', status: 'cancelled' })
		expect(first.resume['int-1']?.status).toBe('resolved')
		expect(EMPTY_DRAFT).toEqual({ resume: {}, tools: {} })
	})
	it('forgets the decision for an interrupt id or a tool-call id ("Change")', () => {
		const full = draftOf(approve, region, city)
		expect(Object.keys(withoutAnswer(full, 'int-1').resume)).toEqual(['int-2'])
		expect(withoutAnswer(full, 'q1').tools).toEqual({})
		expect(withoutAnswer(full, 'unknown')).toEqual(full)
	})
})

describe('draftCovers and answersBody', () => {
	it('covers the open items only once each has a decision', () => {
		expect(draftCovers(open, draftOf(approve, city))).toBe(false)
		expect(draftCovers(open, draftOf(approve, region, city))).toBe(true)
		expect(draftCovers(NO_OPEN_ITEMS, draftOf(approve))).toBe(false)
	})
	it('does not take a key every object has for a decision', () => {
		const odd: TurnOpenItems = {
			interrupts: [{ id: 'toString', reason: 'confirmation' }],
			questions: [],
		}
		expect(draftCovers(odd, EMPTY_DRAFT)).toBe(false)
		expect(answersBody(odd, EMPTY_DRAFT)).toEqual({})
	})
	it('counts a resolved decision for an interrupt expired at now as missing, a cancelled one as given (P14)', () => {
		const late: TurnOpenItems = { interrupts: [expired, form], questions: [] }
		expect(draftCovers(late, draftOf(approve, region), NOW)).toBe(false)
		expect(answersBody(late, draftOf(approve, region), NOW)).toEqual({
			resume: [{ interruptId: 'int-2', status: 'resolved', payload: { region: 'eu' } }],
		})
		expect(draftCovers(late, draftOf(dismiss, region), NOW)).toBe(true)
		// Without a time, the decision stands as it was recorded.
		expect(draftCovers(late, draftOf(approve, region))).toBe(true)
	})
	it("builds the body in the open items' order, for open items only, without an empty list", () => {
		const stale: ItemAnswer = { kind: 'resume', interruptId: 'int-0', status: 'cancelled' }
		expect(answersBody(open, draftOf(city, region, stale, approve))).toEqual({
			resume: [
				{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'resolved', payload: { region: 'eu' } },
			],
			toolResults: [{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' }],
		})
		const onlyQuestions: TurnOpenItems = { interrupts: [], questions: [question('q1')] }
		expect(answersBody(onlyQuestions, draftOf(city))).toEqual({
			toolResults: [{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' }],
		})
	})
})

describe('decide (decision 62: the answers go when the last open item has one)', () => {
	it('keeps a decision while another item is open', () => {
		expect(
			decide({ open, draft: EMPTY_DRAFT, answer: approve, isRequesting: false, now: NOW }),
		).toEqual({
			action: 'keep',
			draft: draftOf(approve),
		})
	})
	it('sends everything with the last decision', () => {
		expect(
			decide({
				open,
				draft: draftOf(approve, city),
				answer: region,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({ action: 'send', body: answersBody(open, draftOf(approve, city, region)) })
	})
	it('sends at once when one item is open', () => {
		const one: TurnOpenItems = { interrupts: [approval], questions: [] }
		expect(
			decide({ open: one, draft: EMPTY_DRAFT, answer: approve, isRequesting: false, now: NOW }),
		).toEqual({
			action: 'send',
			body: {
				resume: [{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } }],
			},
		})
	})
	it('ignores a second call while the first one is requesting, so one decision never sends twice', () => {
		const one: TurnOpenItems = { interrupts: [approval], questions: [] }
		// The hook empties the draft before onReload; the request then runs.
		expect(
			decide({ open: one, draft: EMPTY_DRAFT, answer: approve, isRequesting: true, now: NOW }),
		).toEqual({
			action: 'ignore',
		})
	})
	it('keeps the last decision when a resolved one expired before it, and sends once that one is dismissed (P14)', () => {
		const late: TurnOpenItems = { interrupts: [expired, form], questions: [] }
		// Approved while it was open; the form's answer comes after the approval's expiry.
		expect(
			decide({
				open: late,
				draft: draftOf(approve),
				answer: region,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({ action: 'keep', draft: draftOf(approve, region) })
		// The card then offers only Dismiss, which answers it cancelled.
		expect(
			decide({
				open: late,
				draft: draftOf(approve, region),
				answer: dismiss,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({
			action: 'send',
			body: {
				resume: [
					{ interruptId: 'int-1', status: 'cancelled' },
					{ interruptId: 'int-2', status: 'resolved', payload: { region: 'eu' } },
				],
			},
		})
	})
	it('ignores a decision for an item that is not open', () => {
		const other: ItemAnswer = { kind: 'tool', toolCallId: 'q9', content: 'Q: x\nA: y' }
		expect(
			decide({ open, draft: EMPTY_DRAFT, answer: other, isRequesting: false, now: NOW }),
		).toEqual({
			action: 'ignore',
		})
		expect(
			decide({
				open: NO_OPEN_ITEMS,
				draft: EMPTY_DRAFT,
				answer: approve,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({ action: 'ignore' })
	})
})

describe('withToolAnswers (spec §6.2; plan calls P3, P11)', () => {
	const asked: Turn = {
		...emptyAssistantTurn(),
		parts: [
			{ kind: 'text', messageId: 'm1', text: 'One question first.' },
			question('q1'),
			question('q2', '{"questions":[]}'),
			question('q3'),
		],
		runs: [{ runId: 'r1', outcome: 'success' }],
	}
	it('marks an answered call done with its transcript, and a call with invalid arguments an error', () => {
		const merged = withToolAnswers(asked, [
			{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' },
			{ toolCallId: 'q2', content: '' },
		])
		expect(merged.parts).toEqual([
			asked.parts[0],
			{ ...question('q1'), status: 'done', result: 'Q: Which city?\nA: Paris' },
			{ ...question('q2', '{"questions":[]}'), status: 'error', error: INVALID_QUESTION_CONTENT },
			question('q3'),
		])
		expect(merged.runs).toBe(asked.runs)
		expect(asked.parts[1]).toEqual(question('q1'))
	})
	it('gives back the same turn when there is nothing to merge', () => {
		expect(withToolAnswers(asked, [])).toBe(asked)
	})
})

describe('nextExpiry (plan call P14)', () => {
	const now = new Date('2026-10-14T12:00:00Z')
	const expiring = (id: string, expiresAt?: string): Interrupt => ({
		id,
		reason: 'confirmation',
		...(expiresAt === undefined ? {} : { expiresAt }),
	})
	it('answers the earliest expiry still ahead', () => {
		expect(
			nextExpiry(
				[
					expiring('a', '2026-10-14T12:05:00Z'),
					expiring('b', '2026-10-14T12:01:00Z'),
					expiring('c'),
				],
				now,
			),
		).toBe(Date.parse('2026-10-14T12:01:00Z'))
	})
	it('skips one that has expired (at or before now) and one that is not a date', () => {
		expect(
			nextExpiry(
				[
					expiring('a', '2026-10-14T11:00:00Z'),
					expiring('b', '2026-10-14T12:00:00Z'),
					expiring('c', 'tomorrow'),
				],
				now,
			),
		).toBeNull()
		expect(nextExpiry([], now)).toBeNull()
	})
})
```

In `__tests__/shared-chat-helpers.test.ts`, replace the imports:

```ts
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
```

with:

```ts
import {
	fallbackTurn,
	openItemsOf,
	prependLatestTurns,
	sendDecision,
	toMessageInfo,
	toRequestError,
} from '@/components/shared-chat/hooks/chat-helpers'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { hasOpenItems, NO_OPEN_ITEMS } from '@/lib/chat/open-items'
import { emptyAssistantTurn, userTurn, type ToolPart, type Turn } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'
```

After the `streaming` fixture (before `describe('sendDecision …`), add:

```ts
/** A question to the user that the run ended on (plan call P9), and a gated call waiting for its approval. */
const asking: ToolPart = {
	kind: 'tool',
	toolCallId: 'q1',
	name: ASK_USER_TOOL_NAME,
	args: '{"questions":[{"question":"Which city?"}]}',
	status: 'waiting',
}
const gated: ToolPart = {
	kind: 'tool',
	toolCallId: 'c1',
	name: 'delete_file',
	args: '{"path":"a.txt"}',
	status: 'waiting',
}
/** A turn that waits: its run ended on an interrupt and a question (spec §6). */
const waitingTurn: Turn = {
	...emptyAssistantTurn(),
	parts: [{ kind: 'text', messageId: 'm1', text: 'Before I go on:' }, gated, asking],
	runs: [{ runId: 'r1', outcome: 'interrupt' }],
	interrupts: [{ id: 'int-1', reason: 'tool_call', toolCallId: 'c1' }],
}
```

In `describe('fallbackTurn (useXChat requestFallback)', …)`, replace the last case:

```ts
it('leaves a turn whose run had already ended as it was', () => {
	const ended: Turn = { ...streaming, runs: [{ runId: 'r1', outcome: 'success' }] }
	expect(fallbackTurn(abortError(), ended)).toEqual(ended)
})
```

with:

```ts
it('stops the calls a cut-off run leaves without a result, waiting ones too (plan call P9)', () => {
	const resumed: Turn = {
		...waitingTurn,
		runs: [...waitingTurn.runs, { runId: 'r2', outcome: 'running' }],
		interrupts: [],
	}
	const turn = fallbackTurn(new TypeError('network error'), resumed)
	expect(turn.parts.slice(1)).toEqual([
		{ ...gated, status: 'stopped' },
		{ ...asking, status: 'stopped' },
	])
})
it('appends the failure of a request that continued an ended run, and keeps what it waits for (#67)', () => {
	const turn = fallbackTurn(
		new RequestError(503, 'provider_unreachable', 'The agent is restarting.'),
		waitingTurn,
	)
	expect(turn.runs).toEqual([
		{ runId: 'r1', outcome: 'interrupt' },
		{ runId: '', outcome: 'error', error: { code: 'provider_unreachable', message: '' } },
	])
	expect(turn.parts).toEqual(waitingTurn.parts)
	expect(turn.interrupts).toEqual(waitingTurn.interrupts)
	expect(fallbackTurn(new TypeError('Failed to fetch'), waitingTurn).runs.at(-1)).toEqual({
		runId: '',
		outcome: 'error',
		error: { code: undefined, message: '' },
	})
})
it('leaves a turn whose run had already ended as it was when that request is aborted', () => {
	const ended: Turn = { ...streaming, runs: [{ runId: 'r1', outcome: 'success' }] }
	expect(fallbackTurn(abortError(), ended)).toEqual(ended)
	expect(fallbackTurn(abortError(), waitingTurn)).toBe(waitingTurn)
})
```

Replace the last `describe` block's title, `describe('toMessageInfo and openInterruptsOf', () => {`, with `describe('toMessageInfo and openItemsOf', () => {`, and its second case:

```ts
it('reads the open interrupts of the last turn only (spec §3.3)', () => {
	const interrupted: Turn = {
		...answer('r1'),
		interrupts: [{ id: 'int-1', reason: 'tool_call' }],
	}
	expect(openInterruptsOf([info('a', interrupted)])).toEqual(interrupted.interrupts)
	expect(openInterruptsOf([info('a', interrupted), info('b', userTurn('b', 'x'))])).toEqual([])
	expect(openInterruptsOf([])).toEqual([])
})
```

with:

```ts
it("reads what the last turn waits for, its questions while the app's switch is on (spec §3.3, §6)", () => {
	expect(openItemsOf([info('a', waitingTurn)], true)).toEqual({
		interrupts: waitingTurn.interrupts,
		questions: [asking],
	})
	expect(openItemsOf([info('a', waitingTurn)], false)).toEqual({
		interrupts: waitingTurn.interrupts,
		questions: [],
	})
	expect(openItemsOf([info('a', waitingTurn), info('b', userTurn('b', 'x'))], true)).toEqual(
		NO_OPEN_ITEMS,
	)
	expect(openItemsOf([], true)).toEqual(NO_OPEN_ITEMS)
})
it('keeps the items open after a failed answer, so the cards can answer again (#67)', () => {
	const failed = fallbackTurn(new RequestError(400, 'answers_invalid', 'x'), waitingTurn)
	expect(openItemsOf([info('a', failed, 'error')], true)).toEqual({
		interrupts: waitingTurn.interrupts,
		questions: [asking],
	})
	expect(hasOpenItems(openItemsOf([info('a', failed, 'error')], true))).toBe(true)
})
```

In `__tests__/shared-chat-provider.test.ts`, replace:

```ts
import { emptyAssistantTurn, HUB_RUN_EVENT, userTurn, type Turn } from '@/lib/chat/turn'
```

with:

```ts
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
import {
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	userTurn,
	type ToolPart,
	type Turn,
} from '@/lib/chat/turn'
```

and, at the end of `describe('AgUiChatProvider.transformParams (spec §4.2)', …)`, replace:

```ts
		expect(body).not.toHaveProperty('continues')
		expect(body).not.toHaveProperty('message')
	})
})
```

with (the case it closes, then one more case and a new `describe`):

```ts
		expect(body).not.toHaveProperty('continues')
		expect(body).not.toHaveProperty('message')
	})
	it("sends a confirmation's bare boolean as it is (plan call P6)", () => {
		const answers = {
			resume: [{ interruptId: 'int-1', status: 'resolved' as const, payload: false }],
		}
		expect(makeProvider().transformParams({ answers, continues: emptyAssistantTurn() })).toEqual({
			conversationId: 'conv-1',
			answers,
		})
	})
})

describe('AgUiChatProvider: ask_user answers merge when the request starts (plan call P11)', () => {
	const call = (toolCallId: string, args: string): ToolPart => ({
		kind: 'tool',
		toolCallId,
		name: ASK_USER_TOOL_NAME,
		args,
		status: 'waiting',
	})
	const valid = call('q1', '{"questions":[{"question":"Which city?"}]}')
	const invalid = call('q2', '{"questions":[]}')
	const asked: Turn = {
		...emptyAssistantTurn(),
		parts: [valid, invalid],
		runs: [{ runId: 'r1', outcome: 'success' }],
	}
	const answers = {
		toolResults: [
			{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' },
			{ toolCallId: 'q2', content: '' },
		],
	}

	it('sends the answers, and leaves the turn it was given unanswered for the placeholder', () => {
		const provider = makeProvider()
		expect(provider.transformParams({ answers, continues: asked })).toEqual({
			conversationId: 'conv-1',
			answers,
		})
		// requestPlaceholder shows `continues` until the first chunk: a refusal before the stream keeps the questions open.
		expect(asked.parts).toEqual([valid, invalid])
	})
	it('shows the merged turn from the first chunk: done with the transcript, or the invalid question an error', () => {
		const provider = makeProvider()
		provider.transformParams({ answers, continues: asked })
		const turn = feed(provider, [chunk({ ...hubRun, value: { ...hubRun.value, runId: 'r2' } })])
		expect(turn.parts).toEqual([
			{ ...valid, status: 'done', result: 'Q: Which city?\nA: Paris' },
			{ ...invalid, status: 'error', error: INVALID_QUESTION_CONTENT },
		])
		expect(turn.runs.map(run => run.runId)).toEqual(['r1', 'r2'])
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts`

Expected: FAIL. `shared-chat-answers.test.ts` with `Error: Cannot find package '@/components/shared-chat/answers'`; in `shared-chat-helpers.test.ts` the two `openItemsOf` cases with `TypeError: openItemsOf is not a function` and the two new `fallbackTurn` cases with an `AssertionError` (2a leaves the ended turn as it was and the waiting calls as they were); in `shared-chat-provider.test.ts` the merged-turn case with an `AssertionError` (the calls still `waiting`).

- [ ] **Step 3: The answers module**

Create `components/shared-chat/answers.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'

import { parseAskUserArgs } from '@/lib/chat/ask-user'
import { isExpired } from '@/lib/chat/interrupt-answers'
import { hasOpenItems, type TurnOpenItems } from '@/lib/chat/open-items'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
import type { Turn } from '@/lib/chat/turn'

import type { ResumeAnswer, SharedChatInput, ToolAnswer } from './provider/ag-ui-chat-provider'

/*
 * The browser's answers to what a turn waits for (Part 2 spec §6; decision 62's third answer; plan calls P11, P13, P14):
 * one decision per open item, kept in a draft until the last open item has one, then all of them in one request, as
 * CopilotKit and assistant-ui wait for every interrupt (AG-UI 1.0 interrupt-resume: "The resume list MUST cover every
 * interrupt"). Pure and client-safe: useSharedChat keeps the draft per conversation key, and the cards read it.
 * `@ag-ui/core` is imported for its types only (spec §9).
 */

/** One card's decision: a resume entry for an interrupt, or the answer to an ask_user call. */
export type ItemAnswer = ({ kind: 'resume' } & ResumeAnswer) | ({ kind: 'tool' } & ToolAnswer)

/** The decisions so far, by interrupt id and by tool-call id (P13). */
export interface AnswerDraft {
	resume: Readonly<Record<string, ResumeAnswer>>
	tools: Readonly<Record<string, ToolAnswer>>
}

export const EMPTY_DRAFT: AnswerDraft = { resume: {}, tools: {} }

/** The draft with this decision; one already there for the same item is replaced ("Change", P13). */
export const withAnswer = (draft: AnswerDraft, answer: ItemAnswer): AnswerDraft => {
	if (answer.kind === 'resume') {
		const { kind: _kind, ...entry } = answer
		return { ...draft, resume: { ...draft.resume, [entry.interruptId]: entry } }
	}
	const { kind: _kind, ...entry } = answer
	return { ...draft, tools: { ...draft.tools, [entry.toolCallId]: entry } }
}

/** "Change" (P13): forgets the decision for an interrupt id or a tool-call id. */
export const withoutAnswer = (draft: AnswerDraft, itemId: string): AnswerDraft => {
	const { [itemId]: _resume, ...resume } = draft.resume
	const { [itemId]: _tool, ...tools } = draft.tools
	return { resume, tools }
}

/** The draft's entry for an id, as a list of none or one; own keys only, so an id like "toString" is no decision. */
const entryOf = <T>(record: Readonly<Record<string, T>>, id: string): T[] =>
	Object.hasOwn(record, id) ? [record[id]!] : []

/**
 * The draft's decision for an interrupt, as a list of none or one. Given `now`, a `resolved` decision for an interrupt
 * that has expired by then counts as none: only Dismiss (`cancelled`) answers it now (spec §6.1), and the server refuses
 * to resolve it (400 `answers_invalid`, spec §4.3), so the decision waits for the card's Dismiss instead of sending.
 */
const resumeEntryOf = (draft: AnswerDraft, interrupt: Interrupt, now?: Date): ResumeAnswer[] =>
	entryOf(draft.resume, interrupt.id).filter(
		({ status }) => !(status === 'resolved' && now !== undefined && isExpired(interrupt, now)),
	)

/** Whether every open item has a decision that holds at `now`, and something is open (decision 62's third answer). */
export const draftCovers = (open: TurnOpenItems, draft: AnswerDraft, now?: Date): boolean =>
	hasOpenItems(open) &&
	open.interrupts.every(interrupt => resumeEntryOf(draft, interrupt, now).length > 0) &&
	open.questions.every(({ toolCallId }) => Object.hasOwn(draft.tools, toolCallId))

/**
 * The run body's answers, in the open items' order, only for open items and decisions that still hold at `now`
 * (spec §4.2; an empty list is left out).
 */
export const answersBody = (
	open: TurnOpenItems,
	draft: AnswerDraft,
	now?: Date,
): NonNullable<SharedChatInput['answers']> => {
	const resume = open.interrupts.flatMap(interrupt => resumeEntryOf(draft, interrupt, now))
	const toolResults = open.questions.flatMap(({ toolCallId }) => entryOf(draft.tools, toolCallId))
	return {
		...(resume.length > 0 ? { resume } : {}),
		...(toolResults.length > 0 ? { toolResults } : {}),
	}
}

/**
 * The ask_user answers merged into the turn they continue: no TOOL_CALL_RESULT comes back for a frontend tool, so the
 * hub writes the answer into the turn itself (spec §6.2; spike, "Ask-user"). A call whose arguments read as questions
 * is `done` with its transcript; one whose arguments do not is `error` with the text the server stores for it, whatever
 * the browser sent (P3), as the reloaded turn shows it (lib/chat/turn.ts `foldRow`: an error's text is the content).
 */
export const withToolAnswers = (turn: Turn, answers: readonly ToolAnswer[]): Turn => {
	if (answers.length === 0) return turn
	const contents = new Map(answers.map(({ toolCallId, content }) => [toolCallId, content]))
	return {
		...turn,
		parts: turn.parts.map(part => {
			if (part.kind !== 'tool') return part
			const content = contents.get(part.toolCallId)
			if (content === undefined) return part
			return parseAskUserArgs(part.args)
				? { ...part, status: 'done' as const, result: content }
				: { ...part, status: 'error' as const, error: INVALID_QUESTION_CONTENT }
		}),
	}
}

/** What `answer` does with a decision (decision 62's third answer, P13): keep it, send everything, or ignore it. */
export type AnswerDecision =
	| { action: 'keep'; draft: AnswerDraft }
	| { action: 'send'; body: NonNullable<SharedChatInput['answers']> }
	| { action: 'ignore' }

const isOpen = (open: TurnOpenItems, answer: ItemAnswer): boolean =>
	answer.kind === 'resume'
		? open.interrupts.some(({ id }) => id === answer.interruptId)
		: open.questions.some(({ toolCallId }) => toolCallId === answer.toolCallId)

/**
 * A decision while a request runs is ignored (the answers have gone, or a message is on its way), and so is one for an
 * item that is not open (a card of a turn that no longer waits). Otherwise it joins the draft, and once every open item
 * has a decision that still holds at `now` (P14: a resolved one for an interrupt expired since does not), the whole
 * draft goes.
 */
export const decide = ({
	open,
	draft,
	answer,
	isRequesting,
	now,
}: {
	open: TurnOpenItems
	draft: AnswerDraft
	answer: ItemAnswer
	isRequesting: boolean
	now: Date
}): AnswerDecision => {
	if (isRequesting || !isOpen(open, answer)) return { action: 'ignore' }
	const next = withAnswer(draft, answer)
	return draftCovers(open, next, now)
		? { action: 'send', body: answersBody(open, next, now) }
		: { action: 'keep', draft: next }
}

/**
 * P14: the next `expiresAt` after `now` among the interrupts, in ms since the epoch, or null when none is ahead. One at
 * or before `now` has expired already (`@ag-ui/client` 1.0.2 `isInterruptExpired`: `new Date(expiresAt) <= now`), and a
 * value that is not a date never expires (`@ag-ui/core` 1.0.2 `Interrupt.expiresAt`: "a value that is not one leaves the
 * interrupt looking permanently unexpired"; `NaN > now` is false).
 */
export const nextExpiry = (interrupts: readonly Interrupt[], now: Date): number | null => {
	const ahead = interrupts.flatMap(({ expiresAt }) => {
		const at = expiresAt === undefined ? Number.NaN : new Date(expiresAt).getTime()
		return at > now.getTime() ? [at] : []
	})
	return ahead.length > 0 ? Math.min(...ahead) : null
}
```

- [ ] **Step 4: The provider's answer types and the merge**

In `components/shared-chat/provider/ag-ui-chat-provider.ts`, replace:

```ts
import type { BaseEvent, ResumeEntry } from '@ag-ui/core'
```

with:

```ts
import type { BaseEvent } from '@ag-ui/core'
```

Replace:

```ts
} from '@/lib/chat/turn'

/** The run route's body (spec §4.2), plus one client-only field that transformParams never sends. */
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
	answers?: { resume?: ResumeEntry[]; toolResults?: { toolCallId: string; content: string }[] }
	/** The turn answers continue (x-sdk `onReload`): kept for the reload's first chunk, never sent. */
	continues?: Turn
}
```

with:

```ts
} from '@/lib/chat/turn'

import { withToolAnswers } from '../answers'

/**
 * An answer to one open interrupt (AG-UI 1.0 interrupt-resume: `{ interruptId, status, payload? }`); a `confirmation`
 * without a `responseSchema` is answered with a bare boolean (plan call P6).
 */
export interface ResumeAnswer {
	interruptId: string
	status: 'resolved' | 'cancelled'
	payload?: Record<string, unknown> | boolean
}

/** An answer to one `ask_user` call (spec §6.2): its transcript, or '' for a call with invalid arguments (P3). */
export interface ToolAnswer {
	toolCallId: string
	content: string
}

/** The run route's body (spec §4.2), plus one client-only field that transformParams never sends. */
export interface SharedChatInput {
	conversationId?: string
	message?: { text: string }
	answers?: { resume?: ResumeAnswer[]; toolResults?: ToolAnswer[] }
	/** The turn answers continue (x-sdk onReload): never sent; transformParams merges the tool answers into it (P11). */
	continues?: Turn
}
```

In `transformParams`, replace:

```ts
this.currentRunId = undefined
// The SDK passes no originMessage on a reload's first chunk (part2-x-mapping.md §1.2); keep the turn to extend it.
this.resumeBase = requestParams.continues ?? null
const conversationId = this.getConversationId()
const body: SharedChatInput = conversationId ? { conversationId } : {}
if (requestParams.answers) body.answers = requestParams.answers
else body.message = { text: requestParams.message?.text ?? '' }
return body
```

with:

```ts
this.currentRunId = undefined
// The SDK passes no originMessage on a reload's first chunk (part2-x-mapping.md §1.2); keep the turn to extend it,
// with the ask_user answers merged in (spec §6.2). Merged when the request starts and shown from its first chunk:
// the placeholder is the turn as it was, so a request refused before its stream leaves the questions unanswered
// (plan call P11).
const { continues, answers } = requestParams
this.resumeBase = continues ? withToolAnswers(continues, answers?.toolResults ?? []) : null
const conversationId = this.getConversationId()
const body: SharedChatInput = conversationId ? { conversationId } : {}
if (answers) body.answers = answers
else body.message = { text: requestParams.message?.text ?? '' }
return body
```

`answers.ts` imports the provider's types with `import type` only, so the two modules form no runtime cycle.

- [ ] **Step 5: `fallbackTurn` and `openItemsOf`**

Replace the whole of `components/shared-chat/hooks/chat-helpers.ts` with:

```ts
import type { MessageInfo } from '@ant-design/x-sdk'

import { prependOlder } from '@/components/chat/hooks/history-paging'
import { NO_OPEN_ITEMS, openItemsOfTurn, type TurnOpenItems } from '@/lib/chat/open-items'
import { emptyAssistantTurn, type HistoryTurn, type Turn, type TurnRun } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

// One reply at a time per conversation, as useDifyChat: the Dify chat's side-effect-free module, shared (plan call P11).
export { sendDecision, type SendDecision } from '@/components/chat/hooks/send-decision'

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
 * useXChat's `requestFallback` (spec §5.2: it handles transport failures only). The turn keeps what streamed, and an
 * envelope's English `message` is never kept (charter §4.5: the view words every hub code). A run still running is
 * closed: `cancelled` for an abort (the user left a stream the Stop route could not end), the failure otherwise, and
 * its calls without a result read `stopped`, as the reloaded turn reads them after such a run (plan calls P9, P10). A
 * request that failed before any run (a refusal in the hub's envelope, spec §4.3) becomes a run of its own with no id
 * and the envelope's `code`. A turn whose last run had ended was being continued with answers (#67, plan call P11): the
 * failure is this request's, not that run's, so it is appended as a closed run with no id, and the turn keeps its
 * interrupts and waiting calls, whose cards can be answered again; an abort of that request leaves the turn as it was.
 */
export const fallbackTurn = (error: Error, current: Turn | undefined): Turn => {
	const base = current ?? emptyAssistantTurn()
	const aborted = error.name === 'AbortError'
	const failure = { code: error instanceof RequestError ? error.code : undefined, message: '' }
	const last = base.runs.at(-1)
	if (last && last.outcome !== 'running') {
		if (aborted) return base
		return { ...base, runs: [...base.runs, { runId: '', outcome: 'error', error: failure }] }
	}
	const closed: TurnRun = aborted
		? { runId: last?.runId ?? '', outcome: 'cancelled' }
		: { runId: last?.runId ?? '', outcome: 'error', error: failure }
	return {
		...base,
		parts: base.parts.map(part =>
			part.kind === 'tool' && (part.status === 'running' || part.status === 'waiting')
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

/**
 * What the conversation waits for: the last turn's open items when it is an answer (spec §3.3, §6;
 * lib/chat/open-items.ts), its waiting ask_user calls only while the app's switch is on (decision 62's fourth answer).
 */
export const openItemsOf = (
	messages: readonly MessageInfo<Turn>[],
	askUser: boolean,
): TurnOpenItems => {
	const last = messages.at(-1)
	return last?.message.role === 'assistant' ? openItemsOfTurn(last.message, askUser) : NO_OPEN_ITEMS
}
```

- [ ] **Step 6: The expiry clock**

Create `components/shared-chat/hooks/use-expiry-clock.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'
import { useEffect, useState } from 'react'

import { nextExpiry } from '../answers'

/** setTimeout's longest delay (MDN "setTimeout()", Maximum delay value: a signed 32-bit integer, about 24.8 days). */
const MAX_DELAY_MS = 2_147_483_647

/**
 * P14: now, renewed when the next `expiresAt` among the interrupts passes, so an interrupt's card turns expired on time.
 * The time is state set from a timer in an Effect, never read while rendering (React, the `purity` lint: "I need to show
 * the current time"); the cleanup clears the timer when the next expiry or the time changes (React "Synchronizing with
 * Effects"). An expiry further away than setTimeout can wait is reached in steps of its longest delay; one already past
 * fires at once (MDN: "Negative values behave the same as 0").
 */
export const useExpiryClock = (interrupts: readonly Interrupt[]): Date => {
	const [now, setNow] = useState(() => new Date())
	const next = nextExpiry(interrupts, now)
	useEffect(() => {
		if (next === null) return
		const timer = setTimeout(() => setNow(new Date()), Math.min(next - Date.now(), MAX_DELAY_MS))
		return () => clearTimeout(timer)
	}, [next, now])
	return now
}
```

Nothing calls it yet: Task 15 passes its time to the cards through Task 11's `TurnAnswersContext` (`now`).

- [ ] **Step 7: The hook**

Replace the whole of `components/shared-chat/hooks/use-shared-chat.ts` (as of Task 9) with:

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
import { createQueuedSends, type QueuedSends } from '@/components/chat/hooks/queued-sends'
import { emptyAssistantTurn, type HubRunValue, type Turn } from '@/lib/chat/turn'
import type { RequestError } from '@/lib/http/browser'

import { decide, EMPTY_DRAFT, withoutAnswer, type AnswerDraft, type ItemAnswer } from '../answers'
import type { SharedChatApi } from '../api'
import { createHubFetch, runsUrl } from '../hub-fetch'
import { parseConversationKey } from '../keys'
import { AgUiChatProvider, type SharedChatInput } from '../provider/ag-ui-chat-provider'
import { getProvider } from '../provider-cache'
import {
	fallbackTurn,
	openItemsOf,
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
	/** The app's ask_user switch now (spec §6.2): its waiting calls are open items only while it is on (decision 62). */
	askUser: boolean
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
/** The decisions so far per key (spec §5.2: "the pending answers"; plan call P13), until the last open item has one. */
const drafts = new Map<string, AnswerDraft>()
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
const setDraft = (key: string, draft: AnswerDraft) => {
	drafts.set(key, draft)
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
/** The latest hook's queued-send `clear` for each key; the key's cached provider calls it when a reply ends (#68). */
const queuedClearers = new Map<string, QueuedSends['clear']>()

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
	askUser,
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
							// The end of every request, whatever ended it (x-chat-provider skill, "callbacks": onError
							// includes AbortError): the key's queued send no longer waits, whichever conversation is on
							// screen (#68; x-sdk 2.9.0 AbstractChatProvider.injectRequest calls these after useXChat's own
							// handlers, for every key).
							callbacks: {
								onSuccess: () => queuedClearers.get(conversationKey)?.(conversationKey),
								onError: () => queuedClearers.get(conversationKey)?.(conversationKey),
							},
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

	// Keys with a send waiting in the SDK's queue, per hook instance like that queue (useDifyChat's rule, the same
	// queued-sends.ts): `has` answers `send` at once, the state renders the view's guard.
	const [queuedKeys, setQueuedKeys] = useState<ReadonlySet<string>>(() => new Set())
	const [queued] = useState(() => createQueuedSends(setQueuedKeys))

	// The callbacks below stay stable and read the committed render's values here (React: refs are written in effects,
	// not during rendering).
	const latest = useRef({ chat, provider, conversationKey, api, askUser })
	useLayoutEffect(() => {
		latest.current = { chat, provider, conversationKey, api, askUser }
		if (!conversationKey) return
		conversationIdReaders.set(conversationKey, getConversationId)
		if (onRun) runSinks.set(conversationKey, onRun)
		queuedClearers.set(conversationKey, queued.clear)
	})

	// The queued send has left once its key requests (useDifyChat's rule); a reply that ends while another conversation
	// is on screen clears its key from the provider's callbacks (#68).
	useEffect(() => {
		if (chat.isRequesting) queued.clear(conversationKey)
	}, [chat.isRequesting, conversationKey, queued])

	/** Sends, or queues while the history loads (sendDecision); false when the send was ignored. */
	const send = useCallback(
		(text: string) => {
			const { chat, conversationKey: key } = latest.current
			if (!key) return false
			const decision = sendDecision({
				isRequesting: chat.isRequesting,
				isDefaultMessagesRequesting: chat.isDefaultMessagesRequesting,
				queued: queued.has(key),
			})
			if (decision === 'ignore') return false
			const request: Partial<SharedChatInput> = { message: { text } }
			if (decision === 'queue') {
				queued.add(key)
				chat.queueRequest(key, request)
			} else chat.onRequest(request)
			return true
		},
		[queued],
	)

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

	/**
	 * One card's decision (spec §6; decision 62's third answer; plan call P13): kept in the key's draft until every open
	 * item has one, then all of them go at once through `onReload`, which continues the turn in place (spike, "Browser
	 * side": approvals, ask-user and input_required continue one turn). The draft is emptied before the request, so a
	 * failed one leaves the cards to start over, and `decide` ignores a decision while a request runs, so one decision
	 * never sends twice.
	 */
	const answer = useCallback((item: ItemAnswer) => {
		const { chat, provider: current, conversationKey: key, askUser: advertised } = latest.current
		const last = chat.messages.at(-1)
		if (!key || !last) return
		const decision = decide({
			open: openItemsOf(chat.messages, advertised),
			// The draft as it is now, not as a render saw it: a card may record several decisions in one handler.
			draft: drafts.get(key) ?? EMPTY_DRAFT,
			answer: item,
			// The request's own flag turns at once when onReload runs it (x-request API, XRequestClass `isRequesting`);
			// the hook's turns with the next render.
			isRequesting: chat.isRequesting || Boolean(current?.request.isRequesting),
			// Read when the card is clicked (an event handler, not a render): a resolved decision for an interrupt that
			// expired since then no longer counts (P14).
			now: new Date(),
		})
		if (decision.action === 'ignore') return
		if (decision.action === 'keep') {
			setDraft(key, decision.draft)
			return
		}
		setDraft(key, EMPTY_DRAFT)
		chat.onReload(last.id, { answers: decision.body, continues: last.message })
	}, [])

	/** "Change" (plan call P13): forgets an item's decision, until the answers have gone. */
	const retract = useCallback((itemId: string) => {
		const { chat, conversationKey: key } = latest.current
		if (!key || chat.isRequesting) return
		setDraft(key, withoutAnswer(drafts.get(key) ?? EMPTY_DRAFT, itemId))
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
	const draft = useSyncExternalStore(
		subscribe,
		() => drafts.get(conversationKey) ?? EMPTY_DRAFT,
		() => EMPTY_DRAFT,
	)
	const openItems = useMemo(() => openItemsOf(chat.messages, askUser), [chat.messages, askUser])

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
		/** What the last turn waits for (spec §3.3, §6); while anything is open the Sender is disabled (decision 50). */
		openItems,
		/** The decisions so far for those items (plan call P13). */
		draft,
		answer,
		retract,
	}
}
```

- [ ] **Step 8: Keep the view compiling**

In `components/shared-chat/shared-chat.tsx`, replace:

```tsx
import UserShell from '@/components/shell/user-shell'
import type { Turn } from '@/lib/chat/turn'
```

with:

```tsx
import UserShell from '@/components/shell/user-shell'
import { hasOpenItems } from '@/lib/chat/open-items'
import type { Turn } from '@/lib/chat/turn'
```

Replace:

```tsx
		getConversationId: readConversationId,
		// The stream named its conversation (hub:run): the item keeps its key and takes the id and title (ADR-0017).
```

with:

```tsx
		getConversationId: readConversationId,
		askUser: app.askUser,
		// The stream named its conversation (hub:run): the item keeps its key and takes the id and title (ADR-0017).
```

Replace:

```tsx
// Plan call P3 and decision 50: an open interrupt blocks the composer; 2b's cards answer it.
const waiting = chat.openInterrupts.length > 0 && !chat.isRequesting
```

with:

```tsx
// Decision 50: an open approval, question or interrupt blocks the composer; its card answers it (spec §6).
const waiting = hasOpenItems(chat.openItems) && !chat.isRequesting
```

Run: `grep -rn openInterrupts components/ __tests__/`

Expected: no output.

- [ ] **Step 9: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts`

Expected: `Test Files  3 passed (3)`, `Tests  48 passed (48)`.

- [ ] **Step 10: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/answers.ts components/shared-chat/hooks/use-expiry-clock.ts components/shared-chat/provider/ag-ui-chat-provider.ts components/shared-chat/hooks/chat-helpers.ts components/shared-chat/hooks/use-shared-chat.ts components/shared-chat/shared-chat.tsx __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts
pnpm exec oxfmt --check components/shared-chat/answers.ts components/shared-chat/hooks/use-expiry-clock.ts components/shared-chat/provider/ag-ui-chat-provider.ts components/shared-chat/hooks/chat-helpers.ts components/shared-chat/hooks/use-shared-chat.ts components/shared-chat/shared-chat.tsx __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; oxlint exits 0 with no findings; oxfmt "All matched files use the correct format."; vitest 0 failed; the antd lint prints `"total": 0`.

- [ ] **Step 11: Commit**

```bash
git add components/shared-chat/answers.ts components/shared-chat/hooks/use-expiry-clock.ts components/shared-chat/provider/ag-ui-chat-provider.ts components/shared-chat/hooks/chat-helpers.ts components/shared-chat/hooks/use-shared-chat.ts components/shared-chat/shared-chat.tsx __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts
git commit -m "feat(shared-chat): collect answers per open item and send them together; show a failed answer (#67)

useSharedChat derives the last turn's open items, keeps one decision per item in a draft per
conversation and sends them all through onReload when the last one is in (spec §6, decision 62,
plan call P13). The provider merges ask_user answers into the turn when the request starts, so a
refusal before the stream leaves the questions open (P11). fallbackTurn appends a failed answer's
error to the turn it continued and keeps its interrupts and waiting calls answerable (#67).
useExpiryClock re-renders when the next interrupt expires (P14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the nine files; lint-staged passes.

```json:metadata
{"files": ["components/shared-chat/answers.ts", "components/shared-chat/hooks/use-expiry-clock.ts", "components/shared-chat/provider/ag-ui-chat-provider.ts", "components/shared-chat/hooks/chat-helpers.ts", "components/shared-chat/hooks/use-shared-chat.ts", "components/shared-chat/shared-chat.tsx", "__tests__/shared-chat-answers.test.ts", "__tests__/shared-chat-helpers.test.ts", "__tests__/shared-chat-provider.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-answers.test.ts __tests__/shared-chat-helpers.test.ts __tests__/shared-chat-provider.test.ts", "acceptanceCriteria": ["the three test files report 48 tests passed (17, 16, 15)", "decide({ open, draft, answer, isRequesting, now }) answers keep while another item is open, send with the body in the open items' order once every open item has a decision that holds at now, ignore while a request runs and for an item that is not open; a resolved decision for an interrupt expired at now counts as missing (keep), and Dismiss for it then sends it cancelled; draftCovers is false when nothing is open and ignores inherited keys; answersBody leaves out empty lists, decisions for items not open and, given now, resolved decisions for expired interrupts", "withToolAnswers marks an answered ask_user call done with its transcript and an invalid one error with INVALID_QUESTION_CONTENT, touches nothing else and returns the same turn for no answers", "fallbackTurn appends { runId: '', outcome: 'error', error: { code, message: '' } } to a turn whose last run ended, keeping parts and interrupts; an AbortError leaves it as it was; a running run closes as in 2a with running and waiting calls stopped", "transformParams sends { conversationId, answers } without continues, leaves the given turn unchanged, and the first chunk shows the merged turn; a resume payload may be a bare boolean", "useSharedChat takes askUser and returns openItems, draft, answer and retract, not openInterrupts (grep -rn openInterrupts components/ __tests__/ prints nothing); shared-chat.tsx passes askUser: app.askUser", "tsc, pnpm test, oxlint and oxfmt --check on the changed files pass; the antd CLI lint stays at total 0"], "modelTier": "standard"}
```

---

### Task 11: Tool cards: approvals on the gated call and the ask_user view

**Goal:** Tool calls render through a registry by tool name: `ask_user` as "Questions for you" with its questions or its transcript, every other tool as 2a's generic card; in the turn that waits, the gated call's ThoughtChain item carries Approve and Reject (Expired and Dismiss once past its `expiresAt`, the recorded decision with Change once decided), and an `ask_user` call with drafted answers reads "Answered" with Change.

Spec §5.3 ("Tool renderers are looked up by tool name with this generic card as the fallback … 2b registers `ask_user` as the first"), §6.1 (Approve primary and Reject on the gated tool's item, the arguments read-only, the answer in the interrupt's own `responseSchema`'s terms, an expired interrupt "offers only Dismiss, which answers it `cancelled`"), §6.2 ("Afterwards the `ask_user` card in the transcript shows the questions and answers"), plan calls P3, P5, P9, P13 and P14, and the Shared contracts' "Browser" (`TurnAnswers`, `TurnAnswersContext`, `useTurnAnswers`, `ToolItemView`, `toolItemView`). Every card of Tasks 11–14 reads `TurnAnswersContext`; Task 15 provides it around the turn list while the last turn has open items, and places the `ask_user` card above the composer with only the calls that have no drafted answer, so a drafted call's Change lives on its item in the turn (this task). Docs checked: X 2.9.0 `node_modules/@ant-design/x/es/thought-chain/interface.d.ts` (`ThoughtChainItemType`: `icon`, `title`, `description`, `content`, `footer`, `status`, `collapsible`, `blink`) and `es/thought-chain/Node.js` (`content` renders only when given, inside the collapse motion when `collapsible`; `footer` renders after it, outside the motion, so it is always visible), the `x-components` skill (`reference/API.md`, ThoughtChain); React 19 through Context7 (`/reactjs/react.dev`): `use(context)` reads a context like `useContext` and "can be called inside conditionals", `createContext(null)` when there is no meaningful default, and a context renders as its own provider; antd 6.6.5 (`npx -y @ant-design/cli info Tag --version 6.6.5`: `color` takes the preset status colours `success`, `error`, `warning`, `default`; `Button` `type`, `size`; `Typography.Text` `type`; the facts sheet); the full-stack template's transcript view (`tmp/refs/fsat/template/{{cookiecutter.project_slug}}/frontend/src/components/chat/tool-results/ask-user.tsx`: once answered, "the result is already a 'Q: …/A: …' transcript, so render it as-is; while waiting, list the questions"). Vitest's node environment renders no components, so what each card shows is decided in a pure module, `tool-view-data.ts` (`askUserView`, `approvalView`, `toolFooter`), which the unit suite covers; three files beyond the File map's: that module, `decision-note.tsx` (the decided state the approval footer and the answered `ask_user` item share: a Tag, Change, and "Waiting for the other answers" while another item has no decision) and `tool-views.module.css` (the transcript keeps its line breaks). An approval past its `expiresAt` offers Dismiss again even when an Approve or Reject was recorded before it expired ("Expiry forecloses ANSWERING", `@ag-ui/client` 1.0.2 `src/agent/agent.ts`), the rule Task 13's `interruptCardView` applies to every other interrupt and Task 10's `draftCovers(open, draft, now)` applies to the draft, so `DecisionNote` passes the clock. The generic card's body moves from `tool-chain.tsx` to `tool-views.tsx` unchanged (same texts, same `CodeHighlighter` and dark style), so `e2e/agui-chat.spec.ts`'s tool card test holds. Every agent string (a question, the interrupt's message, a transcript) renders in a React text node (spec §6.4).

**Depends on:** Task 2 (`ASK_USER_TOOL_NAME`, `parseAskUserArgs`), Task 3 (`isApproval`, `approvalKey`, `approvalPayload`, `isExpired`), Task 5 (`ToolPart` and `ToolStatus` with `waiting` in `lib/chat/turn.ts`, `TurnOpenItems`, `tool-chain.tsx`'s status map), Task 10 (`AnswerDraft`, `EMPTY_DRAFT`, `ItemAnswer`, `draftCovers` with its optional `now`).

**Files:**

- Create: `components/shared-chat/tool-view-data.ts`
- Create: `components/shared-chat/answer-context.tsx`
- Create: `components/shared-chat/decision-note.tsx`
- Create: `components/shared-chat/approval-actions.tsx`
- Create: `components/shared-chat/tool-views.tsx`
- Create: `components/shared-chat/tool-views.module.css`
- Modify: `components/shared-chat/tool-chain.tsx` (the whole file, below)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (`shared_chat.answer`, `shared_chat.ask_user`)
- Test: `__tests__/shared-chat-tool-views.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/shared-chat-tool-views.test.ts __tests__/i18n-locales.test.ts` reports 26 passed.
- [ ] `askUserView` answers the questions for a `waiting` or `stopped` call with valid arguments, the result as the transcript for a `done` call (whatever its arguments), `invalid` for arguments that fail `askUserArgsSchema` on any other status but `running`, `pending` for a `running` call whose arguments do not parse yet, and the error text for an `error` call with valid arguments.
- [ ] `approvalView` answers `cancelled` for a drafted Dismiss (even once expired), `expired` from `expiresAt` on (`new Date(expiresAt) <= now`) for anything else, an Approve or Reject recorded before it expired included, `open` without a decision, and otherwise the drafted decision: `approved` when the payload sets the schema's own approval key (`accepted` for Microsoft Agent Framework's schema, `approved` without a schema), `rejected` otherwise; it reads the draft by own key only.
- [ ] `toolFooter` answers the open approval whose `toolCallId` names the call (`isApproval(i) && i.toolCallId === tool.toolCallId`), `answered` for an open `ask_user` call whose answer is in the draft, and null otherwise (an `input_required` interrupt naming the call, a call no open item names, an undecided question).
- [ ] `toolItemView` answers 2a's generic view for every tool but `ask_user` (title = the name, description = `inputHint`, collapsible, Arguments and Result in `CodeHighlighter`) and, for `ask_user`, the title "Questions for you", not collapsible, with the questions as lines, the transcript with its line breaks, "The agent asked an invalid question", or the error text.
- [ ] `useTurnAnswers(turn)` answers the context only when `ctx.turn === turn`; `TurnAnswersContext` defaults to `null`.
- [ ] `ToolChain` keeps its props; a waiting item shows `HourglassOutlined` and no status; the footer holds `ApprovalActions` for an approval and a `DecisionNote` "Answered" for a drafted question; `ApprovalActions` shows the interrupt's message, then Approve (primary) and Reject sending `{ kind: 'resume', interruptId, status: 'resolved', payload: approvalPayload(responseSchema, true | false) }`, or an "Expired" Tag with Dismiss (`status: 'cancelled'`), or the decision's Tag with Change; every button is disabled while `ctx.disabled`.
- [ ] `shared_chat.answer.{approve,reject,approved,rejected,cancelled,answered,change,waiting_others,expired,dismiss}` and `shared_chat.ask_user.{title,invalid}` exist in en, zh and ar.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`; `pnpm exec playwright test e2e/agui-chat.spec.ts --project desktop-light` passes.

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-tool-views.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`, `Tests  26 passed (26)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/shared-chat-tool-views.test.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, type AnswerDraft } from '@/components/shared-chat/answers'
import { approvalView, askUserView, toolFooter } from '@/components/shared-chat/tool-view-data'
import { approvalPayload } from '@/lib/chat/interrupt-answers'
import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { ToolPart } from '@/lib/chat/turn'

const ARGS = JSON.stringify({
	questions: [{ question: 'Which city?', options: ['Paris', 'Rome'] }, { question: 'When?' }],
})

const call = (patch: Partial<ToolPart> = {}): ToolPart => ({
	kind: 'tool',
	toolCallId: 'c1',
	name: 'ask_user',
	args: ARGS,
	status: 'waiting',
	...patch,
})

describe('askUserView (spec §6.2, plan call P3)', () => {
	it('lists the questions while the call waits, and after its run was stopped', () => {
		for (const status of ['waiting', 'stopped'] as const)
			expect(askUserView(call({ status }))).toEqual({
				kind: 'questions',
				questions: ['Which city?', 'When?'],
			})
	})
	it('shows the transcript once answered, as it was sent', () => {
		const result = 'Q: Which city?\nA: Paris\n\nQ: When?\nA: (skipped)'
		expect(askUserView(call({ status: 'done', result }))).toEqual({
			kind: 'transcript',
			text: result,
		})
	})
	it('keeps a result over arguments of another shape (an agent tool of the same name)', () => {
		expect(askUserView(call({ status: 'done', args: '{"prompt":"x"}', result: 'ok' }))).toEqual({
			kind: 'transcript',
			text: 'ok',
		})
	})
	it('reads arguments that fail the schema as an invalid question, answered or not', () => {
		const invalid = JSON.stringify({ questions: [] })
		for (const status of ['waiting', 'stopped', 'error'] as const)
			expect(askUserView(call({ status, args: invalid, error: 'invalid_arguments' }))).toEqual({
				kind: 'invalid',
			})
		expect(askUserView(call({ args: '{"questions": [{"question": "Wh' }))).toEqual({
			kind: 'invalid',
		})
	})
	it('waits for arguments that are still streaming', () => {
		expect(askUserView(call({ status: 'running', args: '{"questions": [{"quest' }))).toEqual({
			kind: 'pending',
		})
	})
	it('shows an error answer with its text', () => {
		expect(
			askUserView(call({ status: 'error', error: 'This tool is not available here.' })),
		).toEqual({ kind: 'error', text: 'This tool is not available here.' })
	})
})

describe('approvalView (spec §6.1, plan calls P5, P13, P14)', () => {
	// Microsoft Agent Framework's field (spec §6.1): the schema decides the payload, not a fixed `approved`.
	const SCHEMA = {
		type: 'object',
		properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
		required: ['accepted'],
	}
	const NOW = new Date('2026-10-14T12:00:00Z')
	const approval = (patch: Partial<Interrupt> = {}): Interrupt => ({
		id: 'i1',
		reason: 'tool_call',
		toolCallId: 'c1',
		message: 'Send the email?',
		responseSchema: SCHEMA,
		...patch,
	})
	const decided = (entry: Omit<AnswerDraft['resume'][string], 'interruptId'>): AnswerDraft => ({
		...EMPTY_DRAFT,
		resume: { i1: { interruptId: 'i1', ...entry } },
	})

	it('is open until it has a decision or expires', () => {
		expect(approvalView(approval(), { draft: EMPTY_DRAFT, now: NOW })).toEqual({ kind: 'open' })
		expect(
			approvalView(approval({ expiresAt: '2026-10-14T12:00:01Z' }), {
				draft: EMPTY_DRAFT,
				now: NOW,
			}),
		).toEqual({ kind: 'open' })
	})
	it('is expired from its expiresAt on (`new Date(expiresAt) <= now`)', () => {
		for (const expiresAt of ['2026-10-14T12:00:00Z', '2026-10-14T11:00:00Z'])
			expect(approvalView(approval({ expiresAt }), { draft: EMPTY_DRAFT, now: NOW })).toEqual({
				kind: 'expired',
			})
	})
	it("reads Approve and Reject from the schema's own property", () => {
		const approved = decided({ status: 'resolved', payload: approvalPayload(SCHEMA, true) })
		const rejected = decided({ status: 'resolved', payload: approvalPayload(SCHEMA, false) })
		expect(approvalView(approval(), { draft: approved, now: NOW })).toEqual({
			kind: 'decided',
			decision: 'approved',
		})
		expect(approvalView(approval(), { draft: rejected, now: NOW })).toEqual({
			kind: 'decided',
			decision: 'rejected',
		})
	})
	it('reads a schema-less approval by the recommended `approved`', () => {
		const draft = decided({ status: 'resolved', payload: approvalPayload(undefined, true) })
		expect(approvalView(approval({ responseSchema: undefined }), { draft, now: NOW })).toEqual({
			kind: 'decided',
			decision: 'approved',
		})
	})
	it('shows a Dismiss as cancelled, even once expired', () => {
		const draft = decided({ status: 'cancelled' })
		expect(
			approvalView(approval({ expiresAt: '2026-10-14T11:00:00Z' }), { draft, now: NOW }),
		).toEqual({ kind: 'decided', decision: 'cancelled' })
	})
	it('offers Dismiss again for an Approve or Reject recorded before it expired', () => {
		const draft = decided({ status: 'resolved', payload: approvalPayload(SCHEMA, true) })
		expect(
			approvalView(approval({ expiresAt: '2026-10-14T11:00:00Z' }), { draft, now: NOW }),
		).toEqual({ kind: 'expired' })
	})
	it('reads the draft by own key only', () => {
		expect(approvalView(approval({ id: 'constructor' }), { draft: EMPTY_DRAFT, now: NOW })).toEqual(
			{
				kind: 'open',
			},
		)
	})
})

describe('toolFooter (spec §6.1, plan call P13)', () => {
	const gated: ToolPart = { ...call(), name: 'send_email', toolCallId: 'c7', args: '{}' }
	const approval: Interrupt = { id: 'i1', reason: 'tool_call', toolCallId: 'c7' }
	const asked = call({ toolCallId: 'c8' })

	it('puts Approve and Reject on the call an open approval names', () => {
		const open: TurnOpenItems = { interrupts: [approval], questions: [] }
		expect(toolFooter(gated, { open, draft: EMPTY_DRAFT })).toEqual({
			kind: 'approval',
			interrupt: approval,
		})
	})
	it('ignores an interrupt that is not an approval, and a call no open item names', () => {
		const input: Interrupt = { id: 'i2', reason: 'input_required', toolCallId: 'c7' }
		expect(
			toolFooter(gated, { open: { interrupts: [input], questions: [] }, draft: EMPTY_DRAFT }),
		).toBeNull()
		expect(
			toolFooter(call({ toolCallId: 'c1' }), {
				open: { interrupts: [approval], questions: [asked] },
				draft: EMPTY_DRAFT,
			}),
		).toBeNull()
	})
	it('reads an open question with drafted answers as answered, and one without as nothing', () => {
		const open: TurnOpenItems = { interrupts: [approval], questions: [asked] }
		const draft: AnswerDraft = {
			...EMPTY_DRAFT,
			tools: { c8: { toolCallId: 'c8', content: 'Q: Which city?\nA: Paris' } },
		}
		expect(toolFooter(asked, { open, draft })).toEqual({ kind: 'answered' })
		expect(toolFooter(asked, { open, draft: EMPTY_DRAFT })).toBeNull()
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-tool-views.test.ts`

Expected: FAIL with `Error: Cannot find package '@/components/shared-chat/tool-view-data' imported from …/__tests__/shared-chat-tool-views.test.ts`.

- [ ] **Step 3: What the cards show**

Create `components/shared-chat/tool-view-data.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'

import { parseAskUserArgs } from '@/lib/chat/ask-user'
import { approvalKey, isApproval, isExpired } from '@/lib/chat/interrupt-answers'
import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { ToolPart } from '@/lib/chat/turn'

import type { AnswerDraft } from './answers'

/*
 * What the tool cards show, decided outside React so the unit suite covers it (tool-views.tsx, approval-actions.tsx and
 * tool-chain.tsx only render it). Client-safe: `@ag-ui/core` is imported for its types only (spec §9).
 */

/** The `ask_user` call in the turn (spec §6.2; the full-stack template's `AskUserResult`). */
export type AskUserView =
	/** Its arguments are still streaming: nothing to read yet. */
	| { kind: 'pending' }
	/** It waits for its answers (or its run was stopped first): the questions it asked. */
	| { kind: 'questions'; questions: string[] }
	/** Answered: the Q/A transcript that went back to the agent, as it was sent (plan call P3). */
	| { kind: 'transcript'; text: string }
	/** Its arguments fail the tool's schema (plan call P3). */
	| { kind: 'invalid' }
	/** Answered with an error tool message: its text. */
	| { kind: 'error'; text: string }

/**
 * The template's rule ("once answered, the result is already a Q/A transcript, so render it as-is; while waiting, list
 * the questions"), with the hub's two additions: arguments that fail `askUserArgsSchema` read as an invalid question
 * (plan call P3), and an error answer shows its text. A result wins over the arguments, so an agent's own tool of the
 * same name still shows what it returned.
 */
export const askUserView = (part: ToolPart): AskUserView => {
	if (part.status === 'done') return { kind: 'transcript', text: part.result ?? '' }
	const args = parseAskUserArgs(part.args)
	if (!args) return part.status === 'running' ? { kind: 'pending' } : { kind: 'invalid' }
	if (part.status === 'error') return { kind: 'error', text: part.error ?? '' }
	return { kind: 'questions', questions: args.questions.map(question => question.question) }
}

export type ApprovalDecision = 'approved' | 'rejected' | 'cancelled'

/** The gated call's footer (spec §6.1): open, expired, or decided (plan call P13). */
export type ApprovalView =
	| { kind: 'open' }
	| { kind: 'expired' }
	| { kind: 'decided'; decision: ApprovalDecision }

/**
 * A Dismiss in the draft stays one; otherwise an approval past its `expiresAt` can only be dismissed (spec §6.1; plan
 * call P14), even with an Approve or Reject recorded before it expired ("Expiry forecloses ANSWERING", @ag-ui/client
 * 1.0.2 `src/agent/agent.ts`), as Task 13's `interruptCardView` reads every other interrupt. A recorded decision reads
 * the payload Approve built: the schema's own boolean property true (plan call P5); it can be changed until the last
 * item has one (plan call P13). The draft is read by own key only: an interrupt id is the agent's string.
 */
export const approvalView = (
	interrupt: Interrupt,
	{ draft, now }: { draft: AnswerDraft; now: Date },
): ApprovalView => {
	const recorded = Object.hasOwn(draft.resume, interrupt.id)
		? draft.resume[interrupt.id]
		: undefined
	if (recorded?.status === 'cancelled') return { kind: 'decided', decision: 'cancelled' }
	if (isExpired(interrupt, now)) return { kind: 'expired' }
	if (!recorded) return { kind: 'open' }
	const { payload } = recorded
	return {
		kind: 'decided',
		decision:
			typeof payload === 'object' && payload[approvalKey(interrupt.responseSchema)] === true
				? 'approved'
				: 'rejected',
	}
}

/** What a tool's ThoughtChain item carries below its body, in the turn that waits. */
export type ToolFooter = { kind: 'approval'; interrupt: Interrupt } | { kind: 'answered' } | null

/**
 * The open approval that names the call (spec §6.1: reason `tool_call` with its `toolCallId`) puts Approve and Reject
 * on it; an open `ask_user` call whose answers wait in the draft reads "Answered" with Change (plan call P13), since the
 * card above the composer shows only the calls without a decision (Task 15).
 */
export const toolFooter = (
	part: ToolPart,
	{ open, draft }: { open: TurnOpenItems; draft: AnswerDraft },
): ToolFooter => {
	const approval = open.interrupts.find(
		interrupt => isApproval(interrupt) && interrupt.toolCallId === part.toolCallId,
	)
	if (approval) return { kind: 'approval', interrupt: approval }
	const asked = open.questions.some(question => question.toolCallId === part.toolCallId)
	return asked && Object.hasOwn(draft.tools, part.toolCallId) ? { kind: 'answered' } : null
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-tool-views.test.ts`

Expected: `Tests  16 passed (16)`.

- [ ] **Step 5: The answers' context**

Create `components/shared-chat/answer-context.tsx`:

```tsx
'use client'

import { createContext, use } from 'react'

import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { Turn } from '@/lib/chat/turn'

import type { AnswerDraft, ItemAnswer } from './answers'

/** What the cards of the turn that waits read (spec §6; plan call P13): its open items, the decisions so far, and how to record one. */
export interface TurnAnswers {
	/** The turn that waits: the conversation's last answer while it has open items. */
	turn: Turn
	open: TurnOpenItems
	draft: AnswerDraft
	/** A request is running, or the list is not ready: the cards' buttons are disabled. */
	disabled: boolean
	now: Date
	answer: (answer: ItemAnswer) => void
	retract: (itemId: string) => void
}

/**
 * The shared chat provides it while its last turn has open items (Task 15; React 19 renders a context as its own
 * provider, react.dev `createContext`). No meaningful default exists, so the default is `null` ("If you don't have any
 * meaningful default value, specify null"): a card outside a waiting chat offers no answer.
 */
export const TurnAnswersContext = createContext<TurnAnswers | null>(null)

/**
 * The context when `turn` is the turn that waits, else null: an older answer shows its cards read-only. React's `use`
 * reads a context like `useContext` (react.dev `use`: "Unlike useContext, use can be called inside conditionals").
 */
export const useTurnAnswers = (turn: Turn): TurnAnswers | null => {
	const answers = use(TurnAnswersContext)
	return answers?.turn === turn ? answers : null
}
```

- [ ] **Step 6: The decided note and the approval's actions**

Create `components/shared-chat/decision-note.tsx`:

```tsx
'use client'

import { Button, Flex, Tag, Typography } from 'antd'
import type { TagProps } from 'antd'
import { use } from 'react'
import { useTranslation } from 'react-i18next'

import { TurnAnswersContext } from './answer-context'
import { draftCovers } from './answers'

export interface DecisionNoteProps {
	/** The interrupt id or tool-call id the decision answers (the draft's key). */
	itemId: string
	color: TagProps['color']
	label: string
}

/**
 * A decision in the draft (plan call P13): its Tag, Change (`retract`), which brings the item back, and "Waiting for
 * the other answers" while another open item has none that holds now (an Approve recorded before its interrupt expired
 * holds no longer, Task 10's `draftCovers`), since the answers go together when the last one is in (decision 62's
 * third answer). Outside a waiting chat it renders nothing.
 */
export default function DecisionNote({ itemId, color, label }: DecisionNoteProps) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	if (!answers) return null
	return (
		<Flex
			wrap
			gap="small"
			align="center"
		>
			<Tag color={color}>{label}</Tag>
			<Button
				type="link"
				size="small"
				disabled={answers.disabled}
				onClick={() => answers.retract(itemId)}
			>
				{t('shared_chat.answer.change')}
			</Button>
			{!draftCovers(answers.open, answers.draft, answers.now) && (
				<Typography.Text type="secondary">{t('shared_chat.answer.waiting_others')}</Typography.Text>
			)}
		</Flex>
	)
}
```

Create `components/shared-chat/approval-actions.tsx`:

```tsx
'use client'

import type { Interrupt } from '@ag-ui/core'
import { Button, Flex, Tag, Typography } from 'antd'
import { use } from 'react'
import { useTranslation } from 'react-i18next'

import { approvalPayload } from '@/lib/chat/interrupt-answers'

import { TurnAnswersContext } from './answer-context'
import DecisionNote from './decision-note'
import { approvalView, type ApprovalDecision } from './tool-view-data'

/** A recorded decision's Tag (antd Tag `color`: the preset status colours `success`, `error`, `default`). */
const DECISION_TAGS = {
	approved: { color: 'success', key: 'shared_chat.answer.approved' },
	rejected: { color: 'error', key: 'shared_chat.answer.rejected' },
	cancelled: { color: 'default', key: 'shared_chat.answer.cancelled' },
} as const satisfies Record<ApprovalDecision, { color: string; key: string }>

/**
 * Approve and Reject on the gated tool's ThoughtChain item (spec §6.1), with the arguments read-only in the item above
 * (agenticos's rule). The interrupt's message renders as text (spec §6.4). The answer follows the interrupt's own
 * `responseSchema` (approvalPayload, plan call P5); an expired approval offers Dismiss only, which answers it
 * `cancelled` (plan call P14); a recorded decision shows as a DecisionNote with Change until the last open item has one
 * (plan call P13). Outside a waiting chat it renders nothing.
 */
export default function ApprovalActions({ interrupt }: { interrupt: Interrupt }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	if (!answers) return null
	const { disabled, answer } = answers
	const view = approvalView(interrupt, answers)
	const resolve = (approved: boolean) =>
		answer({
			kind: 'resume',
			interruptId: interrupt.id,
			status: 'resolved',
			payload: approvalPayload(interrupt.responseSchema, approved),
		})
	return (
		<Flex
			vertical
			gap="small"
		>
			{interrupt.message && <Typography.Text>{interrupt.message}</Typography.Text>}
			{view.kind === 'open' && (
				<Flex
					wrap
					gap="small"
				>
					<Button
						type="primary"
						size="small"
						disabled={disabled}
						onClick={() => resolve(true)}
					>
						{t('shared_chat.answer.approve')}
					</Button>
					<Button
						size="small"
						disabled={disabled}
						onClick={() => resolve(false)}
					>
						{t('shared_chat.answer.reject')}
					</Button>
				</Flex>
			)}
			{view.kind === 'expired' && (
				<Flex
					wrap
					gap="small"
					align="center"
				>
					<Tag color="warning">{t('shared_chat.answer.expired')}</Tag>
					<Button
						size="small"
						disabled={disabled}
						onClick={() =>
							answer({ kind: 'resume', interruptId: interrupt.id, status: 'cancelled' })
						}
					>
						{t('shared_chat.answer.dismiss')}
					</Button>
				</Flex>
			)}
			{view.kind === 'decided' && (
				<DecisionNote
					itemId={interrupt.id}
					color={DECISION_TAGS[view.decision].color}
					label={t(DECISION_TAGS[view.decision].key)}
				/>
			)}
		</Flex>
	)
}
```

- [ ] **Step 7: The renderer registry**

Create `components/shared-chat/tool-views.module.css`:

```css
/* The ask_user transcript as it went back to the agent ("Q: …" and "A: …" lines, plan call P3): its line breaks are kept. */
.transcript {
	white-space: pre-wrap;
}
```

Create `components/shared-chat/tool-views.tsx` (the generic body is 2a's, moved from `tool-chain.tsx`):

```tsx
'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Flex, Typography } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { askUserView, type AskUserView } from './tool-view-data'
import styles from './tool-views.module.css'
import { inputHint, prettyJson } from './turn-parts'

/** One ThoughtChain item's own fields (X 2.9.0 `ThoughtChainItemType`); the chain adds the key, status and footer. */
export interface ToolItemView {
	title: ReactNode
	description?: ReactNode
	content?: ReactNode
	collapsible: boolean
}

// Dark scheme, as the Markdown code block does (components/chat/message/markdown/code-block.tsx): CodeHighlighter
// highlights with Prism's one-light style, and `highlightProps.style` replaces it. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * The generic card's body (spec §5.3, the full-stack template's tool card on X's own component): the arguments and the
 * result in X CodeHighlighter (`lang` "json"; Prism's light mode loads the one `json` grammar, X CodeHighlighter API
 * `prismLightMode`). Every text renders as text, never HTML.
 */
function ToolCallDetails({ args, result }: { args: string; result?: string }) {
	const { t } = useTranslation()
	const { isDark } = useThemeContext()
	const highlight = isDark ? DARK_HIGHLIGHT : undefined
	return (
		<Flex
			vertical
			gap="small"
		>
			<Typography.Text type="secondary">{t('shared_chat.tool_arguments')}</Typography.Text>
			<CodeHighlighter
				lang="json"
				highlightProps={highlight}
			>
				{prettyJson(args)}
			</CodeHighlighter>
			{result !== undefined && (
				<>
					<Typography.Text type="secondary">{t('shared_chat.tool_result')}</Typography.Text>
					<CodeHighlighter
						lang="json"
						highlightProps={highlight}
					>
						{prettyJson(result)}
					</CodeHighlighter>
				</>
			)}
		</Flex>
	)
}

/** Any tool: title = its name, description = a short input hint, a collapsible body with the arguments and the result. */
const genericView = (part: ToolPart): ToolItemView => ({
	title: part.name,
	description: inputHint(part.args),
	collapsible: true,
	content: (
		<ToolCallDetails
			args={part.args}
			result={part.result}
		/>
	),
})

const askUserContent = (view: AskUserView, t: TFunction): ReactNode => {
	switch (view.kind) {
		case 'pending':
			return undefined
		case 'questions':
			return (
				<Flex
					vertical
					gap="small"
				>
					{view.questions.map((question, index) => (
						<Typography.Text key={index}>{question}</Typography.Text>
					))}
				</Flex>
			)
		case 'transcript':
			return <Typography.Text className={styles.transcript}>{view.text}</Typography.Text>
		case 'invalid':
			return <Typography.Text type="secondary">{t('shared_chat.ask_user.invalid')}</Typography.Text>
		case 'error':
			return <Typography.Text type="danger">{view.text}</Typography.Text>
		default:
			return view satisfies never
	}
}

/**
 * The hub's own `ask_user` tool in the turn (spec §6.2: "Afterwards the ask_user card in the transcript shows the
 * questions and answers"; the template's `AskUserResult`): not collapsible, so the questions, or the transcript once
 * answered, are always in view. The card that answers it sits above the composer (ask-user-card.tsx).
 */
const askUserItemView = (part: ToolPart, t: TFunction): ToolItemView => ({
	title: t('shared_chat.ask_user.title'),
	collapsible: false,
	content: askUserContent(askUserView(part), t),
})

/**
 * Spec §5.3: renderers are looked up by tool name with the generic card as the fallback (assistant-ui, CopilotKit,
 * TanStack AI and X's demo all do; `part2-x-mapping.md` §3.5); `ask_user` is the first. A Map, so a tool named like an
 * object's own property (`constructor`) still gets the generic card.
 */
const TOOL_VIEWS = new Map<string, (part: ToolPart, t: TFunction) => ToolItemView>([
	[ASK_USER_TOOL_NAME, askUserItemView],
])

export const toolItemView = (part: ToolPart, t: TFunction): ToolItemView =>
	TOOL_VIEWS.get(part.name)?.(part, t) ?? genericView(part)
```

- [ ] **Step 8: The chain**

Replace the whole of `components/shared-chat/tool-chain.tsx` (as of Task 5) with:

```tsx
'use client'

import { HourglassOutlined } from '@ant-design/icons'
import { ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItemType } from '@ant-design/x'
import { use, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolPart, ToolStatus } from '@/lib/chat/turn'

import { TurnAnswersContext } from './answer-context'
import ApprovalActions from './approval-actions'
import DecisionNote from './decision-note'
import { toolFooter } from './tool-view-data'
import { toolItemView } from './tool-views'

/**
 * ThoughtChain's item statuses (X 2.9.0 `es/thought-chain/Status.d.ts`: loading, success, error, abort) for the tool
 * part's (plan calls P9, P10). A waiting call has none of the four: its item shows an hourglass `icon` and no status
 * colour (`es/thought-chain/Status.js` draws a status's own icon when the item has a status, else the item's `icon`;
 * `Node.js` puts the item's number there when it has neither).
 */
const STATUS: Record<ToolStatus, ThoughtChainItemType['status']> = {
	running: 'loading',
	waiting: undefined,
	done: 'success',
	error: 'error',
	stopped: 'abort',
}

/**
 * Consecutive tool calls as one X ThoughtChain (spec §5.3, the full-stack template's tool card on X's own component,
 * the one the Dify chat uses for agent thoughts). Each item's title, description and body come from the tool's
 * renderer (tool-views.tsx: the generic card, or the hub's `ask_user` view), its status from the part. In the turn that
 * waits (TurnAnswersContext), a call an open approval names carries Approve and Reject in the item's `footer` (spec
 * §6.1), and an open `ask_user` call with drafted answers reads "Answered" with Change (plan call P13); X renders the
 * footer below the collapsible body, always visible (`es/thought-chain/Node.js`). Tool-call ids are unique in a thread
 * (the spike), so an older turn's calls never match an open item.
 */
export default function ToolChain({ tools }: { tools: ToolPart[] }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	const items = useMemo<ThoughtChainItemType[]>(
		() =>
			tools.map(tool => {
				const view = toolItemView(tool, t)
				const footer = answers ? toolFooter(tool, answers) : null
				return {
					key: tool.toolCallId,
					title: view.title,
					description: view.description,
					status: STATUS[tool.status],
					icon: tool.status === 'waiting' ? <HourglassOutlined /> : undefined,
					blink: tool.status === 'running',
					collapsible: view.collapsible,
					content: view.content,
					footer:
						footer?.kind === 'approval' ? (
							<ApprovalActions interrupt={footer.interrupt} />
						) : footer?.kind === 'answered' ? (
							<DecisionNote
								itemId={tool.toolCallId}
								color="success"
								label={t('shared_chat.answer.answered')}
							/>
						) : undefined,
				}
			}),
		[answers, t, tools],
	)
	return <ThoughtChain items={items} />
}
```

`turn-parts.ts` keeps `inputHint` and `prettyJson` (2a's `__tests__/shared-chat-view.test.ts` imports them there) and Task 5's `ToolPart` re-export.

- [ ] **Step 9: The texts**

In `locales/en/translation.json`, find:

```json
		"tool_result": "Result",
```

Replace with:

```json
		"tool_result": "Result",
		"answer": {
			"approve": "Approve",
			"reject": "Reject",
			"approved": "Approved",
			"rejected": "Rejected",
			"cancelled": "Cancelled",
			"answered": "Answered",
			"change": "Change",
			"waiting_others": "Waiting for the other answers",
			"expired": "Expired",
			"dismiss": "Dismiss"
		},
		"ask_user": {
			"title": "Questions for you",
			"invalid": "The agent asked an invalid question"
		},
```

In `locales/zh/translation.json`, find:

```json
		"tool_result": "结果",
```

Replace with:

```json
		"tool_result": "结果",
		"answer": {
			"approve": "批准",
			"reject": "拒绝",
			"approved": "已批准",
			"rejected": "已拒绝",
			"cancelled": "已取消",
			"answered": "已回答",
			"change": "更改",
			"waiting_others": "正在等待其他回答",
			"expired": "已过期",
			"dismiss": "忽略"
		},
		"ask_user": {
			"title": "需要您回答的问题",
			"invalid": "智能体提出了无效的问题"
		},
```

In `locales/ar/translation.json`, find:

```json
		"tool_result": "النتيجة",
```

Replace with:

```json
		"tool_result": "النتيجة",
		"answer": {
			"approve": "موافقة",
			"reject": "رفض",
			"approved": "تمت الموافقة",
			"rejected": "تم الرفض",
			"cancelled": "تم الإلغاء",
			"answered": "تمت الإجابة",
			"change": "تغيير",
			"waiting_others": "بانتظار الإجابات الأخرى",
			"expired": "منتهي الصلاحية",
			"dismiss": "تجاهل"
		},
		"ask_user": {
			"title": "أسئلة موجّهة إليك",
			"invalid": "طرح الوكيل سؤالًا غير صالح"
		},
```

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-tool-views.test.ts __tests__/i18n-locales.test.ts`

Expected: `Test Files  2 passed (2)`, `Tests  26 passed (26)`.

- [ ] **Step 10: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/tool-view-data.ts components/shared-chat/answer-context.tsx components/shared-chat/decision-note.tsx components/shared-chat/approval-actions.tsx components/shared-chat/tool-views.tsx components/shared-chat/tool-chain.tsx __tests__/shared-chat-tool-views.test.ts
pnpm exec oxfmt --check components/shared-chat/tool-view-data.ts components/shared-chat/answer-context.tsx components/shared-chat/decision-note.tsx components/shared-chat/approval-actions.tsx components/shared-chat/tool-views.tsx components/shared-chat/tool-views.module.css components/shared-chat/tool-chain.tsx __tests__/shared-chat-tool-views.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; oxlint exits 0; oxfmt "All matched files use the correct format."; vitest 0 failed; the antd lint's `"summary"` has `"total": 0`.

Then the 2a tool card's e2e test, since its card moved (stop `pnpm dev` first; one `next dev` per checkout):

```bash
pnpm exec playwright test e2e/agui-chat.spec.ts --project desktop-light
```

Expected: every test passes, "a tool call shows as a card with its arguments and result, between the texts" among them. Afterwards `rm -rf .next/dev/types && pnpm exec next typegen` (Global Constraints). The approval footer and the `ask_user` item are proven in the browser by Task 17.

- [ ] **Step 11: Commit**

```bash
git add components/shared-chat/tool-view-data.ts components/shared-chat/answer-context.tsx components/shared-chat/decision-note.tsx components/shared-chat/approval-actions.tsx components/shared-chat/tool-views.tsx components/shared-chat/tool-views.module.css components/shared-chat/tool-chain.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/shared-chat-tool-views.test.ts
git commit -m "feat(shared-chat): approvals on the gated tool call and the ask_user view

Spec §5.3, §6.1, §6.2; plan calls P3, P5, P9, P13, P14. Tool calls render through a registry by name
with 2a's generic card as the fallback; ask_user shows its questions, or its transcript once answered.
In the turn that waits, an open approval puts Approve and Reject (Expired and Dismiss once past its
expiresAt) in the gated call's ThoughtChain footer, and a drafted decision shows with Change.
TurnAnswersContext is what the cards read; Task 15 provides it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the eleven files; lint-staged passes.

```json:metadata
{"files": ["components/shared-chat/tool-view-data.ts", "components/shared-chat/answer-context.tsx", "components/shared-chat/decision-note.tsx", "components/shared-chat/approval-actions.tsx", "components/shared-chat/tool-views.tsx", "components/shared-chat/tool-views.module.css", "components/shared-chat/tool-chain.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/shared-chat-tool-views.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-tool-views.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["the two test files report 26 passed", "askUserView answers questions (waiting, stopped), the transcript (done), invalid (schema fails, not running), pending (running, unparsed) and the error text (error, valid arguments)", "approvalView answers cancelled for a drafted Dismiss even once expired, expired from expiresAt on (a resolved decision recorded before included), open without a decision, else approved/rejected by the schema's own key; own keys only", "toolFooter answers the open approval naming the call, answered for an open ask_user call in the draft, null otherwise", "toolItemView keeps 2a's generic card for every tool but ask_user, which reads 'Questions for you', not collapsible", "useTurnAnswers answers the context only when ctx.turn === turn", "ToolChain keeps its props, shows HourglassOutlined for a waiting call, and puts ApprovalActions or the Answered DecisionNote in the item's footer; every button is disabled while ctx.disabled", "the twelve new keys exist in en, zh and ar", "tsc, oxlint, oxfmt, pnpm test pass; the antd lint stays at total 0; e2e/agui-chat.spec.ts passes on desktop-light"], "modelTier": "standard"}
```

---

### Task 12: The ask_user card

**Goal:** `AskUserCard`, the card above the composer, steps through the open `ask_user` calls' questions one at a time (the full-stack template's UX on antd and X: "Question 2 of 5", options as X Prompts with digit keys, a free answer, Skip, Dismiss) and hands every call's transcript over at once when its last step has an answer.

Spec §6.2 (the card "sits above the composer: 'Question 2 of 3'; the options as X `Prompts` (vertical, one click, digit keys pick); an antd `Input` for a free answer when `allow_custom`; **Skip** (this question) and **Dismiss** (skip the rest)"; invalid arguments show "The agent asked an invalid question" with Dismiss), plan calls P3 (the template's transcript; a free answer of at most 2,000 characters; an invalid call's answer is the server's, whatever the browser sends), P4 (several calls are one card, "Question 2 of 5" counting across calls, each call with its own transcript) and P13 (after a failed send the cards start over), and the Shared contracts' `QuestionStep`, `questionSteps`, `finishedCalls` and `AskUserCard({ questions, disabled, onAnswer })`. The reference is the template's `QuestionPrompt` (`tmp/refs/fsat/template/{{cookiecutter.project_slug}}/frontend/src/components/ui/question-prompt.tsx`): one question at a time with the answers kept in order, `onComplete` once every question has an answer, Dismiss fills the rest with `{ answer: "", skipped: true }`, digit keys 1–9 pick an option while focus is not in the free-answer field, and each new question takes the focus. Task 15 renders the card while no request runs, with only the open questions that have no drafted answer, keyed by their ids, and sends each `ToolAnswer` of `onAnswer` as `answer({ kind: 'tool', … })`; the card therefore calls `onAnswer` once, with every call in call order, when its last step has an answer or on Dismiss, as the template's `onComplete` does. Docs checked: X 2.9.0 `node_modules/@ant-design/x/es/prompts/index.d.ts` (items `{ key, icon, label, description, disabled }`, `vertical`, `onItemClick({ data })`) and `es/prompts/index.js` (an item is a `div` with a click handler, not a focusable button; a disabled item ignores clicks), so the keyboard path is the digit keys on the card's group element; the template's ↑/↓ highlight has no Prompts counterpart (no active item), so it is left out. Each option's digit is its item's `icon` as an antd `Typography.Text keyboard` (a `<kbd>`, antd's Typography demo "Press <Text keyboard>Esc</Text>"), so the label stays the agent's text as sent; a tenth option (P2 allows ten) has no key and no digit. antd 6.6.5: `Card` `size="small"`, `title`, `extra` (`es/card/Card.js` draws the header when either is given), `Input` `maxLength`, `onPressEnter` (`@rc-component/input` `Input.js` skips it during IME composition: `!e.nativeEvent.isComposing`), `Space.Compact` `block` (`npx -y @ant-design/cli doc Space --version 6.6.5`: "Option to fit width to its parent's width"), `Button` `type="text"` with `icon` and an `aria-label` from a key for the icon-only Dismiss (frontend rules). React: a component's state resets when its `key` changes (react.dev "Resetting all state when a prop changes"); focusing a node is an Effect's work. The steps live in a pure module the unit suite covers; the card is proven in the browser by Task 17.

**Depends on:** Task 2 (`parseAskUserArgs`, `askUserTranscript`, `AskUserAnswer`, `AskUserQuestion`, `ASK_USER_ANSWER_MAX`), Task 5 (`ToolPart`), Task 10 (`ToolAnswer`), Task 11 (`shared_chat.answer.answered`, `shared_chat.answer.dismiss`, `shared_chat.ask_user.invalid` and the `shared_chat.ask_user` area).

**Files:**

- Create: `components/shared-chat/ask-user-steps.ts`
- Create: `components/shared-chat/ask-user-card.tsx`
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (six keys in `shared_chat.ask_user`)
- Test: `__tests__/shared-chat-ask-user-steps.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/shared-chat-ask-user-steps.test.ts __tests__/i18n-locales.test.ts` reports 20 passed.
- [ ] `questionSteps` answers every call's questions in call order with the schema's defaults (`options: []`, `allow_custom: true`), and one step with `question: null` for a call whose arguments fail the schema.
- [ ] `finishedCalls` answers, in call order, only the calls whose every step has an answer, each with `askUserTranscript` of its own questions and answers, and `''` for an invalid call.
- [ ] `answerStep` answers `complete: null` until the last step has an answer, then every call (`finishedCalls` of all the answers); `dismissSteps` skips the current step and every one after it with `SKIPPED` (`{ answer: '', skipped: true }`, transcript `(skipped)`) and answers every call, an invalid one with `''`.
- [ ] `optionIndexOfKey` answers the option index for `1`–`9` when an option is under the key, null for `0`, a digit past the options, a letter, `Enter` and space.
- [ ] `AskUserCard` renders nothing without questions; otherwise an antd small `Card` titled "Question N of M" when there is more than one step, with an icon-only Dismiss (`CloseOutlined`, named "Dismiss questions") in `extra`; its body is a `role="group"` element named "Question from the agent" whose digit keys pick an option unless focus is in the free-answer field; the question, the options as vertical X Prompts with their digit as a `<kbd>`, an `Input` (max 2,000 characters, placeholder "Type your own answer") with Send when `allow_custom`, and Skip; an invalid call's step shows "The agent asked an invalid question" with Dismiss; every control is disabled while `disabled`.
- [ ] `shared_chat.ask_user.{progress,skip,dismiss,custom_placeholder,send,label}` exist in en, zh and ar, `progress` with `{{current}}` and `{{total}}` in each.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` exits 0; `pnpm test` reports 0 failed; oxlint and oxfmt clean on the changed files; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-ask-user-steps.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`, `Tests  20 passed (20)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/shared-chat-ask-user-steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	answerStep,
	dismissSteps,
	finishedCalls,
	optionIndexOfKey,
	questionSteps,
	SKIPPED,
} from '@/components/shared-chat/ask-user-steps'
import { askUserTranscript, type AskUserAnswer } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

const call = (toolCallId: string, args: unknown): ToolPart => ({
	kind: 'tool',
	toolCallId,
	name: 'ask_user',
	args: typeof args === 'string' ? args : JSON.stringify(args),
	status: 'waiting',
})

const CITY = { question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: false }
const WHEN = { question: 'When?' }
const BUDGET = { question: 'What budget?', options: ['Low', 'High'] }
const first = call('c1', { questions: [CITY, WHEN] })
const second = call('c2', { questions: [BUDGET] })
const invalid = call('c3', '{"questions": []}')

const picked = (answer: string): AskUserAnswer => ({ answer, skipped: false })
/** A call's questions as its steps hold them (with the schema's defaults). */
const questionsOf = (part: ToolPart) => questionSteps([part]).map(step => step.question!)

describe('questionSteps (plan call P4)', () => {
	it("steps through every call's questions in call order, with the schema's defaults", () => {
		expect(questionSteps([first, second])).toEqual([
			{ toolCallId: 'c1', question: CITY },
			{ toolCallId: 'c1', question: { ...WHEN, options: [], allow_custom: true } },
			{ toolCallId: 'c2', question: { ...BUDGET, allow_custom: true } },
		])
	})
	it('gives a call with invalid arguments one step of its own (plan call P3)', () => {
		expect(questionSteps([invalid, second]).map(step => step.toolCallId)).toEqual(['c3', 'c2'])
		expect(questionSteps([invalid])).toEqual([{ toolCallId: 'c3', question: null }])
	})
})

describe('finishedCalls (plan call P3)', () => {
	it('answers a call only once every one of its questions has an answer', () => {
		expect(finishedCalls([first, second], [])).toEqual([])
		expect(finishedCalls([first, second], [picked('Paris')])).toEqual([])
		expect(finishedCalls([first, second], [picked('Paris'), SKIPPED])).toEqual([
			{
				toolCallId: 'c1',
				content: askUserTranscript(questionsOf(first), [picked('Paris'), SKIPPED]),
			},
		])
	})
	it("gives each call its own transcript, from that call's answers", () => {
		expect(finishedCalls([first, second], [picked('Paris'), picked('May'), picked('Low')])).toEqual(
			[
				{
					toolCallId: 'c1',
					content: askUserTranscript(questionsOf(first), [picked('Paris'), picked('May')]),
				},
				{ toolCallId: 'c2', content: askUserTranscript(questionsOf(second), [picked('Low')]) },
			],
		)
	})
	it('answers an invalid call with an empty content (the server writes its error)', () => {
		expect(finishedCalls([invalid, second], [SKIPPED])).toEqual([{ toolCallId: 'c3', content: '' }])
	})
})

describe('answerStep and dismissSteps (the template: every call is handed over at once)', () => {
	it('hands nothing over until the last step has an answer, then every call', () => {
		const one = answerStep([first, second], [], picked('Rome'))
		expect(one).toEqual({ answers: [picked('Rome')], complete: null })
		const two = answerStep([first, second], one.answers, picked('June'))
		expect(two.complete).toBeNull()
		const three = answerStep([first, second], two.answers, SKIPPED)
		expect(three.complete).toEqual(finishedCalls([first, second], three.answers))
		expect(three.complete?.map(answer => answer.toolCallId)).toEqual(['c1', 'c2'])
	})
	it('skips the current step and every one after it on Dismiss, and hands every call over', () => {
		const result = dismissSteps([first, second], [picked('Paris')])
		expect(result.answers).toEqual([picked('Paris'), SKIPPED, SKIPPED])
		expect(result.complete).toEqual([
			{
				toolCallId: 'c1',
				content: askUserTranscript(questionsOf(first), [picked('Paris'), SKIPPED]),
			},
			{ toolCallId: 'c2', content: askUserTranscript(questionsOf(second), [SKIPPED]) },
		])
		expect(result.complete?.[0]?.content).toContain('A: (skipped)')
	})
	it('dismisses an invalid call with the rest', () => {
		expect(dismissSteps([invalid, second], []).complete).toEqual([
			{ toolCallId: 'c3', content: '' },
			{ toolCallId: 'c2', content: askUserTranscript(questionsOf(second), [SKIPPED]) },
		])
	})
})

describe('optionIndexOfKey (the template: digit keys pick an option)', () => {
	it('picks the option under keys 1 to 9', () => {
		expect(optionIndexOfKey('1', 2)).toBe(0)
		expect(optionIndexOfKey('2', 2)).toBe(1)
		expect(optionIndexOfKey('9', 10)).toBe(8)
	})
	it('ignores another key, or a digit with no option under it', () => {
		for (const key of ['0', '3', 'a', 'Enter', ' ']) expect(optionIndexOfKey(key, 2)).toBeNull()
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-ask-user-steps.test.ts`

Expected: FAIL with `Error: Cannot find package '@/components/shared-chat/ask-user-steps' imported from …/__tests__/shared-chat-ask-user-steps.test.ts`.

- [ ] **Step 3: The steps**

Create `components/shared-chat/ask-user-steps.ts`:

```ts
import {
	askUserTranscript,
	parseAskUserArgs,
	type AskUserAnswer,
	type AskUserQuestion,
} from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

import type { ToolAnswer } from './provider/ag-ui-chat-provider'

/*
 * The ask_user card's steps (spec §6.2; plan calls P3, P4), pure so the unit suite covers them: the card
 * (ask-user-card.tsx) only renders the current step and records what the user did. The UX is the full-stack template's
 * `QuestionPrompt` (`frontend/src/components/ui/question-prompt.tsx`): one question at a time, digit keys pick an
 * option, Skip answers one question, Dismiss skips the rest.
 */

/** One question on the card, with the call it belongs to. */
export interface QuestionStep {
	toolCallId: string
	/** null: the call's arguments are invalid (P3); the step offers Dismiss only. */
	question: AskUserQuestion | null
}

/** Plan call P4: every open call's questions in call order, one card; a call with invalid arguments is one step. */
export const questionSteps = (calls: readonly ToolPart[]): QuestionStep[] =>
	calls.flatMap<QuestionStep>(call => {
		const args = parseAskUserArgs(call.args)
		return args
			? args.questions.map(question => ({ toolCallId: call.toolCallId, question }))
			: [{ toolCallId: call.toolCallId, question: null }]
	})

/**
 * The calls whose every step has an answer, as tool answers (askUserTranscript; '' for an invalid call), in call order.
 * `answers` holds one answer per step from the first, so the finished calls are always the first ones.
 */
export const finishedCalls = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
): ToolAnswer[] => {
	const finished: ToolAnswer[] = []
	let start = 0
	for (const call of calls) {
		const args = parseAskUserArgs(call.args)
		const end = start + (args ? args.questions.length : 1)
		if (answers.length < end) break
		finished.push({
			toolCallId: call.toolCallId,
			// Plan call P3: the server answers an invalid call with its own error message, whatever the browser sends.
			content: args ? askUserTranscript(args.questions, answers.slice(start, end)) : '',
		})
		start = end
	}
	return finished
}

/** Skip, and every step Dismiss passes over (the template's `{ answer: "", skipped: true }`). */
export const SKIPPED: AskUserAnswer = { answer: '', skipped: true }

/**
 * The answers after a step. The card hands its calls over together once its last step has an answer (Skip and Dismiss
 * included), the template's `onComplete`, so the composer's open items change once per card (plan call P13).
 */
export interface StepResult {
	answers: AskUserAnswer[]
	/** Every call as a tool answer, in call order, once every step has an answer; null until then. */
	complete: ToolAnswer[] | null
}

const advance = (calls: readonly ToolPart[], answers: AskUserAnswer[]): StepResult => ({
	answers,
	complete: answers.length >= questionSteps(calls).length ? finishedCalls(calls, answers) : null,
})

/** The current step answered: an option, a free answer, or Skip. */
export const answerStep = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
	answer: AskUserAnswer,
): StepResult => advance(calls, [...answers, answer])

/** Dismiss (the template's: "skip the rest"): the current step and every one after it are skipped. */
export const dismissSteps = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
): StepResult => {
	const left = Math.max(questionSteps(calls).length - answers.length, 0)
	return advance(calls, [...answers, ...Array.from({ length: left }, () => SKIPPED)])
}

/** The template's keys: 1–9 pick the first nine options (a tenth, P2 allows ten, is picked by click only). */
export const DIGIT_KEYS = 9

/** The option a pressed key picks, or null (not a digit from 1, or no option under it). */
export const optionIndexOfKey = (key: string, optionCount: number): number | null => {
	if (!/^[1-9]$/.test(key)) return null
	const index = Number(key) - 1
	return index < optionCount ? index : null
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-ask-user-steps.test.ts`

Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: The card**

Create `components/shared-chat/ask-user-card.tsx`:

```tsx
'use client'

import { CloseOutlined } from '@ant-design/icons'
import { Prompts } from '@ant-design/x'
import { Button, Card, Flex, Input, Space, Tag, Typography } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ASK_USER_ANSWER_MAX, type AskUserAnswer } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

import {
	answerStep,
	DIGIT_KEYS,
	dismissSteps,
	optionIndexOfKey,
	questionSteps,
	SKIPPED,
	type StepResult,
} from './ask-user-steps'
import type { ToolAnswer } from './provider/ag-ui-chat-provider'

export interface AskUserCardProps {
	/** The open `ask_user` calls without an answer yet, in call order (TurnOpenItems.questions). */
	questions: ToolPart[]
	disabled: boolean
	/** Every call with its transcript ('' for an invalid call), in call order, once the last step has an answer. */
	onAnswer: (answers: ToolAnswer[]) => void
}

/**
 * The hub's `ask_user` card above the composer (spec §6.2), the full-stack template's `QuestionPrompt` on antd and X:
 * "Question 2 of 5" across the calls (plan call P4), the question, its options as X Prompts (`vertical`,
 * `onItemClick`), each with its digit key shown as a keyboard key (antd `Typography.Text keyboard`), an antd Input for a
 * free answer when the question allows one, Skip (this question) and an icon-only Dismiss (the rest). Like the
 * template's `onComplete`, it hands every call over at once when its last step has an answer. The card starts over
 * when the set of calls changes: React resets a component's state when its `key` changes (react.dev "Resetting all
 * state when a prop changes").
 */
export default function AskUserCard({ questions, disabled, onAnswer }: AskUserCardProps) {
	if (!questions.length) return null
	return (
		<QuestionStepper
			key={questions.map(call => call.toolCallId).join(' ')}
			questions={questions}
			disabled={disabled}
			onAnswer={onAnswer}
		/>
	)
}

function QuestionStepper({ questions, disabled, onAnswer }: AskUserCardProps) {
	const { t } = useTranslation()
	const steps = useMemo(() => questionSteps(questions), [questions])
	// One answer per step, from the first (the template's answersRef); the current step is the next one.
	const [given, setGiven] = useState<AskUserAnswer[]>([])
	const [text, setText] = useState('')
	const groupRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<InputRef>(null)
	// Handed over, the calls leave the card (their answers are in the draft) or their request runs (`disabled`). A
	// finished card still shown while nothing runs had its answers sent and refused, so it asks again (plan call P13:
	// after a failed send the cards start over).
	const progress = !disabled && given.length >= steps.length ? [] : given
	const index = progress.length
	const question = steps[index]?.question

	// The template focuses each new question: the free-answer field when there is nothing to pick, else the group, so
	// the digit keys work at once (React: focusing a DOM node is an Effect's work, synchronising with the DOM).
	useEffect(() => {
		const current = steps[index]?.question
		if (current && current.options.length === 0 && current.allow_custom) inputRef.current?.focus()
		else groupRef.current?.focus()
	}, [steps, index])

	const apply = ({ answers, complete }: StepResult) => {
		setGiven(answers)
		setText('')
		if (complete) onAnswer(complete)
	}
	const commit = (answer: AskUserAnswer) => apply(answerStep(questions, progress, answer))
	const submitText = () => {
		const answer = text.trim()
		if (answer) commit({ answer, skipped: false })
	}
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Digits typed into the free-answer field are text; a shortcut with a modifier is the browser's.
		if (disabled || !question || event.target instanceof HTMLInputElement) return
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const option = optionIndexOfKey(event.key, question.options.length)
		if (option === null) return
		event.preventDefault()
		commit({ answer: question.options[option], skipped: false })
	}

	if (index >= steps.length)
		return (
			<Card size="small">
				<Tag color="success">{t('shared_chat.answer.answered')}</Tag>
			</Card>
		)

	return (
		<Card
			size="small"
			title={
				steps.length > 1
					? t('shared_chat.ask_user.progress', { current: index + 1, total: steps.length })
					: undefined
			}
			extra={
				<Button
					type="text"
					size="small"
					icon={<CloseOutlined />}
					aria-label={t('shared_chat.ask_user.dismiss')}
					disabled={disabled}
					onClick={() => apply(dismissSteps(questions, progress))}
				/>
			}
		>
			<div
				ref={groupRef}
				role="group"
				aria-label={t('shared_chat.ask_user.label')}
				tabIndex={-1}
				onKeyDown={onKeyDown}
			>
				<Flex
					vertical
					gap="small"
				>
					{question ? (
						<>
							<Typography.Text strong>{question.question}</Typography.Text>
							{question.options.length > 0 && (
								<Prompts
									vertical
									items={question.options.map((option, optionIndex) => ({
										key: String(optionIndex),
										label: option,
										icon:
											optionIndex < DIGIT_KEYS ? (
												<Typography.Text keyboard>{optionIndex + 1}</Typography.Text>
											) : undefined,
										disabled,
									}))}
									onItemClick={({ data }) =>
										commit({ answer: question.options[Number(data.key)], skipped: false })
									}
								/>
							)}
							{question.allow_custom && (
								<Space.Compact block>
									<Input
										ref={inputRef}
										value={text}
										maxLength={ASK_USER_ANSWER_MAX}
										placeholder={t('shared_chat.ask_user.custom_placeholder')}
										disabled={disabled}
										onChange={event => setText(event.target.value)}
										onPressEnter={submitText}
									/>
									<Button
										type="primary"
										disabled={disabled || !text.trim()}
										onClick={submitText}
									>
										{t('shared_chat.ask_user.send')}
									</Button>
								</Space.Compact>
							)}
							<Flex justify="flex-end">
								<Button
									size="small"
									disabled={disabled}
									onClick={() => commit(SKIPPED)}
								>
									{t('shared_chat.ask_user.skip')}
								</Button>
							</Flex>
						</>
					) : (
						<>
							<Typography.Text type="secondary">
								{t('shared_chat.ask_user.invalid')}
							</Typography.Text>
							<Flex justify="flex-end">
								<Button
									size="small"
									disabled={disabled}
									onClick={() => commit(SKIPPED)}
								>
									{t('shared_chat.answer.dismiss')}
								</Button>
							</Flex>
						</>
					)}
				</Flex>
			</div>
		</Card>
	)
}
```

Nothing renders the card yet: Task 15 places it above the composer.

- [ ] **Step 6: The texts**

In `locales/en/translation.json` (as of Task 11), find:

```json
			"invalid": "The agent asked an invalid question"
```

Replace with:

```json
			"invalid": "The agent asked an invalid question",
			"progress": "Question {{current}} of {{total}}",
			"skip": "Skip",
			"dismiss": "Dismiss questions",
			"custom_placeholder": "Type your own answer",
			"send": "Send",
			"label": "Question from the agent"
```

In `locales/zh/translation.json`, find:

```json
			"invalid": "智能体提出了无效的问题"
```

Replace with:

```json
			"invalid": "智能体提出了无效的问题",
			"progress": "第 {{current}} 个问题，共 {{total}} 个",
			"skip": "跳过",
			"dismiss": "忽略这些问题",
			"custom_placeholder": "输入您自己的回答",
			"send": "发送",
			"label": "来自智能体的问题"
```

In `locales/ar/translation.json`, find:

```json
			"invalid": "طرح الوكيل سؤالًا غير صالح"
```

Replace with:

```json
			"invalid": "طرح الوكيل سؤالًا غير صالح",
			"progress": "السؤال {{current}} من {{total}}",
			"skip": "تخطّي",
			"dismiss": "تجاهل الأسئلة",
			"custom_placeholder": "اكتب إجابتك الخاصة",
			"send": "إرسال",
			"label": "سؤال من الوكيل"
```

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-ask-user-steps.test.ts __tests__/i18n-locales.test.ts`

Expected: `Test Files  2 passed (2)`, `Tests  20 passed (20)`.

- [ ] **Step 7: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/ask-user-steps.ts components/shared-chat/ask-user-card.tsx __tests__/shared-chat-ask-user-steps.test.ts
pnpm exec oxfmt --check components/shared-chat/ask-user-steps.ts components/shared-chat/ask-user-card.tsx __tests__/shared-chat-ask-user-steps.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; oxlint exits 0; oxfmt "All matched files use the correct format."; vitest 0 failed; the antd lint's `"summary"` has `"total": 0`.

- [ ] **Step 8: Commit**

```bash
git add components/shared-chat/ask-user-steps.ts components/shared-chat/ask-user-card.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/shared-chat-ask-user-steps.test.ts
git commit -m "feat(shared-chat): the ask_user card

Spec §6.2; plan calls P3, P4, P13. The full-stack template's question stepper on antd and X: one
question at a time across the open calls, options as X Prompts with digit keys, a free answer,
Skip and Dismiss; an invalid call offers Dismiss only. Every call's transcript is handed over at
once when the last step has an answer. Task 15 places the card above the composer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the six files; lint-staged passes.

```json:metadata
{"files": ["components/shared-chat/ask-user-steps.ts", "components/shared-chat/ask-user-card.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/shared-chat-ask-user-steps.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-ask-user-steps.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["the two test files report 20 passed", "questionSteps answers every call's questions in call order with the schema's defaults, and one null step for an invalid call", "finishedCalls answers only the calls whose every step has an answer, each with its own transcript, '' for an invalid call", "answerStep answers complete: null until the last step, then every call; dismissSteps skips the rest with SKIPPED and answers every call", "optionIndexOfKey answers the index for 1-9 under an option, null otherwise", "AskUserCard renders a small Card with 'Question N of M' for several steps, the icon-only Dismiss named 'Dismiss questions', a group named 'Question from the agent' with digit keys, vertical Prompts with kbd digits, an Input with Send when allow_custom, Skip, and Dismiss only for an invalid call; disabled while disabled", "the six new keys exist in en, zh and ar with matching placeholders", "tsc, oxlint, oxfmt, pnpm test pass; the antd lint stays at total 0"], "modelTier": "standard"}
```

---

### Task 13: The interrupt card

**Goal:** `InterruptCard` renders an interrupt that is not a gated call on screen as an antd `Card` in the turn (its reason as the title, its message, then a flat-schema form, Yes and No, Approve and Reject, Cancel, or Dismiss once expired), records the decision through the turn's answers context with a way to change it, and a pure `interrupt-form.ts` holds its rules under unit tests.

Spec §6.3 (the card: "an antd `Card` titled from the reason (known reasons localised, others shown raw), the interrupt's message, a form for a flat `responseSchema` … **Submit** and **Cancel** … A `confirmation` without a schema shows **Yes** and **No** … A schema outside that subset shows only the message and **Cancel**") and §6.1 (an expired interrupt "offers only Dismiss, which answers it `cancelled`"); plan calls P6, P7, P8 (an approval whose `toolCallId` matches no tool part renders here with Approve and Reject), P13 (a recorded decision shows with Change until the last open item has one) and P14 (expiry judged with the context's `now`); decision 50 (every card has a way out). The card renders whatever interrupt it is given; Task 15 places one per interrupt of the waiting turn, except approvals whose call has a tool part there (Task 11's ThoughtChain footer answers those). It reads Task 11's `TurnAnswersContext` with React's `use` (react.dev `use`: "Reads the value of a React context"; it has no `turn` prop to pass to `useTurnAnswers`) and answers only an interrupt open in the context's `open.interrupts`. Docs checked with the antd CLI (`npx -y @ant-design/cli info|doc <Component> --version 6.6.5`): Card `size` `'medium' | 'small'`, `variant` `'outlined' | 'borderless'` (`bordered` deprecated), `title` and `extra` ReactNode; Form `name`, `layout`, `initialValues`, `disabled`, `onFinish`; Form.Item `rules`, `extra`, `valuePropName` ("the prop of Switch or Checkbox is `checked`"), `required` ("generated by the validation rule"); Rule `required`, `whitespace` ("only work with `type: 'string'` rule"), `type` (`integer`, `enum`), `min`/`max` ("`type` required"), `enum`, `transform`, `message`; the FAQ's "set a different `name`" for several forms on a page; Input `count` (`max`, `strategy`, `exceedFormatter`, the "Custom count logic" demo); InputNumber `min`, `max`, `precision`, no `block` prop; Radio.Group `options`; Switch `checked` default false; Tag `color`; Button `type="link"`. Validation messages need no new key: the app's one XProvider passes `locale` (`getAntdLocale`) to antd's ConfigProvider (`@ant-design/x` 2.9 `es/x-provider/index.js`), which merges `locale.Form.defaultValidateMessages` (antd 6.6.5 `es/config-provider/index.js`, "validateMessages" in antd doc Form), and `en_US`, `zh_CN` and `ar_EG` all carry them; the required message reuses the Dify inputs form's `form.field_required` (`{{label}} is required`), which is why `fieldRules` takes `t`. antd's validator (`@rc-component/async-validator` 6.0.0) counts a string's `min`/`max` in code points (`es/rule/range.js`), as P7 does, and treats a rule holding more than `required` as a string rule unless typed (`es/index.js`, `getValidationMethod`), so only a string field's required rule carries `whitespace`. No new CSS: InputNumber takes the full width through the Dify inputs form's `.number` class (`components/chat/chat-view/inputs-form.module.css`), as the shared chat already reuses the Dify chat's modules (spec §5.1).

**Depends on:** Task 3 (`lib/chat/interrupt-answers.ts`), Task 10 (`components/shared-chat/answers.ts`: `AnswerDraft`, `EMPTY_DRAFT`, `ItemAnswer`; `ResumeAnswer` in the provider), Task 11 (`components/shared-chat/answer-context.tsx` and the `shared_chat.answer.*` keys: `approve`, `reject`, `approved`, `rejected`, `cancelled`, `answered`, `change`, `waiting_others`, `expired`, `dismiss`).

**Files:**

- Create: `components/shared-chat/interrupt-form.ts`
- Create: `components/shared-chat/interrupt-card.tsx`
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (a `shared_chat.interrupt` area)
- Test: `__tests__/shared-chat-interrupt-form.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/shared-chat-interrupt-form.test.ts __tests__/i18n-locales.test.ts` reports `Test Files  2 passed (2)`, 25 tests in `shared-chat-interrupt-form.test.ts`.
- [ ] `fieldRules` gives a required field a first rule with the Dify inputs form's message (`form.field_required`, labelled by the field's title or name; plus `whitespace: true` for a string), then its type and bounds: `{ type: 'string', min, max, transform }` (a blank string reads as empty), `{ type: 'number' | 'integer', min, max }`, `{ type: 'boolean' }`, `{ type: 'enum', enum }`; type and bound messages come from antd's locale pack (en, zh, ar) through the app's XProvider.
- [ ] `initialValuesOf` starts each field at its `default`, and a boolean without one at `false`.
- [ ] `payloadOf` drops undefined, null and blank optional strings, keeps `false` and `0`, ignores undeclared values, and its result passes Task 3's `checkFlatPayload`.
- [ ] `interruptTitleKey` answers a key that exists in the English file for `input_required`, `confirmation` and `tool_call`, and null for any other reason (including `constructor` and `''`).
- [ ] `interruptCardView` answers the interrupt's answer kind while nothing is recorded; a recorded decision as Approved, Rejected, Yes, No, Answered or Cancelled (keys that exist in the English file); `expired` once `expiresAt` has passed, also over a recorded resolved decision; a recorded cancel stays a decision.
- [ ] `locales/{en,zh,ar}/translation.json` hold the seven `shared_chat.interrupt.*` keys of Step 3; `shared_chat.answer.*` (Task 11) is reused, not added.
- [ ] `InterruptCard({ interrupt })` (default export) is an antd `Card` (`size="small"`, `variant="outlined"`) titled by `interruptTitleKey` or the raw reason, with an "Expired" `Tag` in `extra` once expired and the message as text; it answers through `TurnAnswersContext`: a vertical Form named by `useId` (Input with a code-point `count`, Radio.Group, Switch with `valuePropName="checked"`, full-width InputNumber with `precision` 0 for an integer) with Submit (primary, `htmlType="submit"`) and Cancel; Yes and No sending `true`/`false`; Approve and Reject sending `approvalPayload`; Cancel alone; Dismiss alone once expired; a recorded decision as a Tag with "Waiting for the other answers" and Change (`retract`); every button disabled while `ctx.disabled`; no actions when the interrupt is not open in the context.
- [ ] tsc, oxlint and oxfmt clean on the changed files; `pnpm test` green; `npx -y @ant-design/cli lint ./ --format json` reports `"total": 0`.

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-interrupt-form.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `__tests__/shared-chat-interrupt-form.test.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'
import type { FormRule } from 'antd'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, type AnswerDraft } from '@/components/shared-chat/answers'
import {
	fieldRules,
	initialValuesOf,
	interruptCardView,
	interruptTitleKey,
	payloadOf,
} from '@/components/shared-chat/interrupt-form'
import type { ResumeAnswer } from '@/components/shared-chat/provider/ag-ui-chat-provider'
import { checkFlatPayload, flatFields, type FlatField } from '@/lib/chat/interrupt-answers'
import en from '@/locales/en/translation.json'

const t = ((key: string, options?: { label?: string }) =>
	options?.label ? `t:${key}:${options.label}` : `t:${key}`) as unknown as TFunction

/** A dotted key's value in the English file, or undefined. */
const english = (key: string): unknown =>
	key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

const FIELDS = flatFields({
	type: 'object',
	properties: {
		name: { type: 'string', title: 'Name', minLength: 2, maxLength: 40 },
		note: { type: 'string', default: 'none' },
		year: { type: 'integer', minimum: 2000 },
		ratio: { type: 'number', maximum: 1 },
		urgent: { type: 'boolean' },
		notify: { type: 'boolean', default: true },
		quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
	},
	required: ['name', 'year', 'quarter'],
})!
const field = (name: string): FlatField => FIELDS.find(item => item.name === name)!

describe('fieldRules (spec §6.3, plan call P7)', () => {
	it('requires a string with the form’s message, then checks its type and length', () => {
		expect(fieldRules(field('name'), t)).toEqual([
			{ required: true, whitespace: true, message: 't:form.field_required:Name' },
			{ type: 'string', min: 2, max: 40, transform: expect.any(Function) },
		])
	})

	it('reads a blank string as empty, so an optional blank passes and a required one is missing', () => {
		const [bounds] = fieldRules(field('note'), t) as { transform?: (value: unknown) => unknown }[]
		expect(bounds!.transform!('   ')).toBe('')
		expect(bounds!.transform!(' a ')).toBe(' a ')
		expect(bounds!.transform!(undefined)).toBeUndefined()
	})

	it('labels the message with the field’s name when it has no title', () => {
		expect(fieldRules(field('year'), t)[0]).toEqual({
			required: true,
			message: 't:form.field_required:year',
		})
	})

	it.each<[string, FormRule[]]>([
		[
			'year',
			[
				{ required: true, message: 't:form.field_required:year' },
				{ type: 'integer', min: 2000 },
			],
		],
		['ratio', [{ type: 'number', max: 1 }]],
		['urgent', [{ type: 'boolean' }]],
		[
			'quarter',
			[
				{ required: true, message: 't:form.field_required:quarter' },
				{ type: 'enum', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
			],
		],
	])('gives %s its type and bounds', (name, rules) => {
		expect(fieldRules(field(name), t)).toEqual(rules)
	})
})

describe('initialValuesOf', () => {
	it('starts each field at its default, and a boolean without one at false', () => {
		expect(initialValuesOf(FIELDS)).toEqual({ note: 'none', urgent: false, notify: true })
	})
})

describe('payloadOf (plan call P7)', () => {
	it('drops undefined, null and blank optional strings, keeps false and 0, and only declared fields', () => {
		const payload = payloadOf(FIELDS, {
			name: 'Ada',
			note: '   ',
			year: 2026,
			ratio: null,
			urgent: false,
			notify: true,
			quarter: 'Q1',
			extra: 'ignored',
		})
		expect(payload).toEqual({ name: 'Ada', year: 2026, urgent: false, notify: true, quarter: 'Q1' })
		expect(checkFlatPayload(FIELDS, payload)).toBe(true)
		expect(payloadOf(FIELDS, { name: 'Ada', year: 0, quarter: 'Q2', note: '' })).toEqual({
			name: 'Ada',
			year: 0,
			quarter: 'Q2',
		})
	})
})

describe('interruptTitleKey', () => {
	it.each(['input_required', 'confirmation', 'tool_call'])('titles %s with a key', reason => {
		const key = interruptTitleKey(reason)
		expect(key).toBe(`shared_chat.interrupt.title_${reason}`)
		expect(english(key!)).toEqual(expect.any(String))
	})

	it.each(['mastra:tool_suspend', 'langgraph:interrupt', 'constructor', ''])(
		'shows %j as sent',
		reason => {
			expect(interruptTitleKey(reason)).toBeNull()
		},
	)
})

describe('interruptCardView (plan calls P13, P14)', () => {
	const NOW = new Date('2026-10-14T12:00:00Z')
	const PAST = '2026-10-14T11:00:00Z'
	const approval: Interrupt = {
		id: 'int-1',
		reason: 'tool_call',
		toolCallId: 'call-1',
		responseSchema: {
			type: 'object',
			properties: { accepted: { type: 'boolean' }, arguments: { type: 'object' } },
			required: ['accepted'],
		},
	}
	const confirmation: Interrupt = { id: 'int-2', reason: 'confirmation' }
	const form: Interrupt = {
		id: 'int-3',
		reason: 'input_required',
		responseSchema: { type: 'object', properties: { note: { type: 'string' } } },
	}
	const drafted = (...answers: ResumeAnswer[]): AnswerDraft => ({
		...EMPTY_DRAFT,
		resume: Object.fromEntries(answers.map(answer => [answer.interruptId, answer])),
	})

	it('offers the answer its kind allows while nothing is recorded', () => {
		expect(interruptCardView(approval, EMPTY_DRAFT, NOW)).toEqual({ kind: 'approval' })
		expect(interruptCardView(confirmation, EMPTY_DRAFT, NOW)).toEqual({ kind: 'confirm' })
		expect(interruptCardView(form, EMPTY_DRAFT, NOW)).toEqual({
			kind: 'form',
			fields: [{ name: 'note', required: false, type: 'string' }],
		})
	})

	it.each<[string, Interrupt, ResumeAnswer, string]>([
		[
			'an approval',
			approval,
			{ interruptId: 'int-1', status: 'resolved', payload: { accepted: true } },
			'shared_chat.answer.approved',
		],
		[
			'a rejection',
			approval,
			{ interruptId: 'int-1', status: 'resolved', payload: { accepted: false } },
			'shared_chat.answer.rejected',
		],
		[
			'a Yes',
			confirmation,
			{ interruptId: 'int-2', status: 'resolved', payload: true },
			'shared_chat.interrupt.yes',
		],
		[
			'a No',
			confirmation,
			{ interruptId: 'int-2', status: 'resolved', payload: false },
			'shared_chat.interrupt.no',
		],
		[
			'a form’s answer',
			form,
			{ interruptId: 'int-3', status: 'resolved', payload: { note: 'x' } },
			'shared_chat.answer.answered',
		],
		[
			'a cancel',
			form,
			{ interruptId: 'int-3', status: 'cancelled' },
			'shared_chat.answer.cancelled',
		],
	])('shows %s recorded in the draft as its decision', (_name, interrupt, recorded, tagKey) => {
		expect(interruptCardView(interrupt, drafted(recorded), NOW)).toEqual({
			kind: 'decided',
			tagKey,
		})
		expect(english(tagKey)).toEqual(expect.any(String))
	})

	it('offers only Dismiss once expired, also over a resolved decision it can no longer take', () => {
		const expired = { ...confirmation, expiresAt: PAST }
		expect(interruptCardView(expired, EMPTY_DRAFT, NOW)).toEqual({ kind: 'expired' })
		expect(
			interruptCardView(
				expired,
				drafted({ interruptId: 'int-2', status: 'resolved', payload: true }),
				NOW,
			),
		).toEqual({ kind: 'expired' })
		expect(
			interruptCardView(expired, drafted({ interruptId: 'int-2', status: 'cancelled' }), NOW),
		).toEqual({ kind: 'decided', tagKey: 'shared_chat.answer.cancelled' })
	})

	it('reads the draft by own key only', () => {
		expect(interruptCardView({ ...confirmation, id: 'constructor' }, EMPTY_DRAFT, NOW)).toEqual({
			kind: 'confirm',
		})
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-interrupt-form.test.ts` Expected: FAIL with `Error: Cannot find package '@/components/shared-chat/interrupt-form'`.

- [ ] **Step 3: Add the locale keys**

Seven keys in a new `shared_chat.interrupt` area, placed after `tool_result` (Tasks 11 and 12 add their own areas to `shared_chat`; find each fragment by its text). The decision tags, Approve, Reject, Change, Dismiss, "Expired" and "Waiting for the other answers" are Task 11's `shared_chat.answer.*` keys, reused here.

In `locales/en/translation.json`, find:

```json
		"tool_result": "Result",
```

Replace with:

```json
		"tool_result": "Result",
		"interrupt": {
			"submit": "Submit",
			"cancel": "Cancel",
			"yes": "Yes",
			"no": "No",
			"title_input_required": "The agent needs more information",
			"title_confirmation": "The agent asks you to confirm",
			"title_tool_call": "The agent asks to run a tool"
		},
```

In `locales/zh/translation.json`, find:

```json
		"tool_result": "结果",
```

Replace with:

```json
		"tool_result": "结果",
		"interrupt": {
			"submit": "提交",
			"cancel": "取消",
			"yes": "是",
			"no": "否",
			"title_input_required": "智能体需要更多信息",
			"title_confirmation": "智能体请你确认",
			"title_tool_call": "智能体请求运行一个工具"
		},
```

In `locales/ar/translation.json` (Modern Standard Arabic, ADR-0005), find:

```json
		"tool_result": "النتيجة",
```

Replace with:

```json
		"tool_result": "النتيجة",
		"interrupt": {
			"submit": "إرسال",
			"cancel": "إلغاء",
			"yes": "نعم",
			"no": "لا",
			"title_input_required": "يحتاج الوكيل إلى مزيد من المعلومات",
			"title_confirmation": "يطلب منك الوكيل التأكيد",
			"title_tool_call": "يطلب الوكيل تشغيل أداة"
		},
```

These wordings join the owner's review list (zh and ar). Nothing changed, only added, so `e2e/` needs no search for old text.

- [ ] **Step 4: Write the pure module**

Create `components/shared-chat/interrupt-form.ts`:

```ts
import type { Interrupt } from '@ag-ui/core'
import type { FormRule } from 'antd'
import type { TFunction } from 'i18next'

import {
	answerKindOf,
	approvalKey,
	isExpired,
	type AnswerKind,
	type FlatField,
} from '@/lib/chat/interrupt-answers'

import type { AnswerDraft } from './answers'

/*
 * The interrupt card's rules (Part 2 spec §6.3; plan calls P6, P7, P8, P13, P14), pure so the unit suite covers them
 * (the card itself is proven by the e2e suite). The form's messages for types and bounds come from antd's own locale
 * pack, which the app's XProvider hands to antd's ConfigProvider (components/providers/app-providers.tsx; antd 6.6.5
 * `es/config-provider/index.js` merges `locale.Form.defaultValidateMessages`; antd doc Form "validateMessages"), so
 * they follow the UI language without a key; the required message is the Dify inputs form's `form.field_required`.
 */

/** A blank answer counts as none: the rule sees what payloadOf will drop (antd doc Form, Rule `transform`). */
const blankAsEmpty = (value: unknown): unknown =>
	typeof value === 'string' && value.trim() === '' ? '' : value

/**
 * The field's antd Form rules (antd doc Form, "Rule"): a required one with the app's own message, then its type and
 * bounds. antd counts a string's `min`/`max` in code points (`@rc-component/async-validator` 6.0.0 `es/rule/range.js`
 * counts a surrogate pair once), as JSON Schema does (P7), and `min`/`max` on a number are inclusive, as `minimum` and
 * `maximum` are; `type: 'integer'` refuses a fraction.
 */
export const fieldRules = (field: FlatField, t: TFunction): FormRule[] => {
	const message = t('form.field_required', { label: field.title ?? field.name })
	// A string of spaces is no answer (antd doc Form, Rule `whitespace`: "only work with type: 'string' rule"). A rule
	// holding only `required` is checked as such for any value; one with more keys is a string rule unless typed
	// (`@rc-component/async-validator` 6.0.0 `es/index.js`, getValidationMethod), so only a string field gets it.
	const required: FormRule[] = !field.required
		? []
		: field.type === 'string'
			? [{ required: true, whitespace: true, message }]
			: [{ required: true, message }]
	switch (field.type) {
		case 'string':
			return [
				...required,
				{ type: 'string', min: field.minLength, max: field.maxLength, transform: blankAsEmpty },
			]
		case 'number':
		case 'integer':
			return [...required, { type: field.type, min: field.minimum, max: field.maximum }]
		case 'boolean':
			return [...required, { type: 'boolean' }]
		case 'enum':
			return [...required, { type: 'enum', enum: field.options }]
	}
}

/**
 * The form's initial values: each field's `default`. A boolean without one starts false, because a Switch has no
 * unset state (antd doc Switch: `checked` defaults to false): the answer is what the card shows.
 */
export const initialValuesOf = (fields: readonly FlatField[]): Record<string, unknown> =>
	Object.fromEntries(
		fields.flatMap(field =>
			field.default !== undefined
				? [[field.name, field.default]]
				: field.type === 'boolean'
					? [[field.name, false]]
					: [],
		),
	)

/**
 * The form's values as the payload (P7): only the schema's fields, without undefined, null (a cleared InputNumber
 * answers null, antd doc InputNumber `onChange`) and blank optional strings, so an untouched optional field is left
 * out rather than sent empty.
 */
export const payloadOf = (
	fields: readonly FlatField[],
	values: Record<string, unknown>,
): Record<string, unknown> =>
	Object.fromEntries(
		fields.flatMap(field => {
			const value = values[field.name]
			if (value === undefined || value === null) return []
			if (!field.required && blankAsEmpty(value) === '') return []
			return [[field.name, value]]
		}),
	)

/** AG-UI's core reasons (concepts › Interrupts, "Reason taxonomy"), each with a localised title. */
const TITLE_KEYS = {
	input_required: 'shared_chat.interrupt.title_input_required',
	confirmation: 'shared_chat.interrupt.title_confirmation',
	tool_call: 'shared_chat.interrupt.title_tool_call',
} as const

/**
 * The card's title key, or null for any other reason, which the card shows as sent ("For unknown reasons, clients
 * must not error. Render from `message`, `responseSchema`, and `metadata`", concepts › Interrupts, "Client routing").
 */
export const interruptTitleKey = (
	reason: string,
): (typeof TITLE_KEYS)[keyof typeof TITLE_KEYS] | null =>
	Object.hasOwn(TITLE_KEYS, reason) ? TITLE_KEYS[reason as keyof typeof TITLE_KEYS] : null

type DecisionKey =
	| 'shared_chat.answer.cancelled'
	| 'shared_chat.answer.approved'
	| 'shared_chat.answer.rejected'
	| 'shared_chat.answer.answered'
	| 'shared_chat.interrupt.yes'
	| 'shared_chat.interrupt.no'

/** What the card shows: the recorded decision, Dismiss for an expired interrupt, or the answer its kind allows. */
export type InterruptCardView =
	| { kind: 'decided'; tagKey: DecisionKey }
	| { kind: 'expired' }
	| AnswerKind

/**
 * P13, P14: a decision recorded in the draft shows as a Tag with "Change" until the last open item has one; an
 * expired interrupt can only be dismissed (spec §6.1), so a resolved decision it can no longer take is offered
 * Dismiss again ("Expiry forecloses ANSWERING", @ag-ui/client 1.0.2 `src/agent/agent.ts`); otherwise the answer its
 * kind allows. The draft is read by own key only: an interrupt id is the agent's string.
 */
export const interruptCardView = (
	interrupt: Interrupt,
	draft: AnswerDraft,
	now: Date,
): InterruptCardView => {
	const recorded = Object.hasOwn(draft.resume, interrupt.id)
		? draft.resume[interrupt.id]
		: undefined
	if (recorded?.status === 'cancelled')
		return { kind: 'decided', tagKey: 'shared_chat.answer.cancelled' }
	if (isExpired(interrupt, now)) return { kind: 'expired' }
	const answer = answerKindOf(interrupt)
	if (!recorded) return answer
	const { payload } = recorded
	switch (answer.kind) {
		case 'approval':
			return {
				kind: 'decided',
				tagKey:
					typeof payload === 'object' && payload[approvalKey(interrupt.responseSchema)] === true
						? 'shared_chat.answer.approved'
						: 'shared_chat.answer.rejected',
			}
		case 'confirm':
			return {
				kind: 'decided',
				tagKey: payload === true ? 'shared_chat.interrupt.yes' : 'shared_chat.interrupt.no',
			}
		default:
			return { kind: 'decided', tagKey: 'shared_chat.answer.answered' }
	}
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-interrupt-form.test.ts __tests__/i18n-locales.test.ts` Expected: PASS, `Test Files  2 passed (2)`, 25 tests in `shared-chat-interrupt-form.test.ts`.

- [ ] **Step 6: Write the card**

Create `components/shared-chat/interrupt-card.tsx`:

```tsx
'use client'

import type { Interrupt } from '@ag-ui/core'
import { Button, Card, Flex, Form, Input, InputNumber, Radio, Switch, Tag, Typography } from 'antd'
import { use, useId } from 'react'
import { useTranslation } from 'react-i18next'

import formStyles from '@/components/chat/chat-view/inputs-form.module.css'
import { approvalPayload, isExpired, type FlatField } from '@/lib/chat/interrupt-answers'

import { TurnAnswersContext, type TurnAnswers } from './answer-context'
import {
	fieldRules,
	initialValuesOf,
	interruptCardView,
	interruptTitleKey,
	payloadOf,
} from './interrupt-form'

/** JSON Schema's string length (P7): code points, the count antd's own "emoji as length 1" demo swaps in. */
const codePointCount = (text: string) => Array.from(text).length

/**
 * One control per field kind (spec §6.3): string → Input, enum → Radio.Group, boolean → Switch, number or integer →
 * InputNumber. A bounded string counts and cuts in code points through antd's `count` (antd doc Input, CountConfig and
 * the "Custom count logic" demo), where the native `maxLength` would count UTF-16 units. InputNumber takes the full
 * width through the Dify inputs form's class (antd 6.6.5 InputNumber has no `block`), and `precision` 0 for an
 * integer. Option labels are the values as text.
 */
const fieldControl = (field: FlatField) => {
	switch (field.type) {
		case 'string':
			return (
				<Input
					count={
						field.maxLength === undefined
							? undefined
							: {
									show: true,
									max: field.maxLength,
									strategy: codePointCount,
									exceedFormatter: (text, { max }) => Array.from(text).slice(0, max).join(''),
								}
					}
				/>
			)
		case 'number':
		case 'integer':
			return (
				<InputNumber
					className={formStyles.number}
					min={field.minimum}
					max={field.maximum}
					precision={field.type === 'integer' ? 0 : undefined}
				/>
			)
		case 'boolean':
			return <Switch />
		case 'enum':
			return <Radio.Group options={field.options.map(value => ({ label: String(value), value }))} />
	}
}

interface AnswerProps {
	interrupt: Interrupt
	answers: TurnAnswers
}

/**
 * The flat-schema form (P7): one Form.Item per field, labelled by its title or name, its description as help text,
 * `required` marked by its rules (antd doc Form.Item `required`: "generated by the validation rule"); Submit sends the
 * payload, Cancel the `cancelled` status. The Form's `disabled` reaches every control and button inside it (antd doc
 * Form `disabled`).
 */
function InterruptForm({ interrupt, answers, fields }: AnswerProps & { fields: FlatField[] }) {
	const { t } = useTranslation()
	// antd builds each field's id from the Form's `name` (`${name}_${field}`, antd `es/form/util.js` getFieldId) and asks
	// for a different `name` per form on one page (antd doc Form, FAQ); an interrupt id is the agent's string, so the
	// name comes from React's useId ("unique IDs that can be passed to accessibility attributes", react.dev `useId`).
	const name = useId()
	return (
		<Form
			name={name}
			layout="vertical"
			initialValues={initialValuesOf(fields)}
			disabled={answers.disabled}
			onFinish={(values: Record<string, unknown>) =>
				answers.answer({
					kind: 'resume',
					interruptId: interrupt.id,
					status: 'resolved',
					payload: payloadOf(fields, values),
				})
			}
		>
			{fields.map(field => (
				<Form.Item
					key={field.name}
					name={field.name}
					label={field.title ?? field.name}
					extra={field.description}
					rules={fieldRules(field, t)}
					// antd doc Form.Item `valuePropName`: "the prop of Switch or Checkbox is `checked`".
					valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
				>
					{fieldControl(field)}
				</Form.Item>
			))}
			<Flex
				gap="small"
				wrap
			>
				<Button
					type="primary"
					htmlType="submit"
				>
					{t('shared_chat.interrupt.submit')}
				</Button>
				<Button
					onClick={() =>
						answers.answer({ kind: 'resume', interruptId: interrupt.id, status: 'cancelled' })
					}
				>
					{t('shared_chat.interrupt.cancel')}
				</Button>
			</Flex>
		</Form>
	)
}

/** The card's actions (interruptCardView): the decision with Change, Dismiss, or the answer the kind allows. */
function InterruptAnswer({ interrupt, answers }: AnswerProps) {
	const { t } = useTranslation()
	const view = interruptCardView(interrupt, answers.draft, answers.now)
	const { disabled } = answers
	const resolve = (payload: Record<string, unknown> | boolean) =>
		answers.answer({ kind: 'resume', interruptId: interrupt.id, status: 'resolved', payload })
	const cancel = () =>
		answers.answer({ kind: 'resume', interruptId: interrupt.id, status: 'cancelled' })
	switch (view.kind) {
		case 'decided':
			return (
				<Flex
					align="center"
					gap="small"
					wrap
				>
					<Tag>{t(view.tagKey)}</Tag>
					<Typography.Text type="secondary">
						{t('shared_chat.answer.waiting_others')}
					</Typography.Text>
					<Button
						type="link"
						size="small"
						disabled={disabled}
						onClick={() => answers.retract(interrupt.id)}
					>
						{t('shared_chat.answer.change')}
					</Button>
				</Flex>
			)
		case 'expired':
			return (
				<Flex
					gap="small"
					wrap
				>
					<Button
						disabled={disabled}
						onClick={cancel}
					>
						{t('shared_chat.answer.dismiss')}
					</Button>
				</Flex>
			)
		case 'form':
			return (
				<InterruptForm
					interrupt={interrupt}
					answers={answers}
					fields={view.fields}
				/>
			)
		case 'confirm':
			return (
				<Flex
					gap="small"
					wrap
				>
					<Button
						type="primary"
						disabled={disabled}
						onClick={() => resolve(true)}
					>
						{t('shared_chat.interrupt.yes')}
					</Button>
					<Button
						disabled={disabled}
						onClick={() => resolve(false)}
					>
						{t('shared_chat.interrupt.no')}
					</Button>
				</Flex>
			)
		case 'approval':
			return (
				<Flex
					gap="small"
					wrap
				>
					<Button
						type="primary"
						disabled={disabled}
						onClick={() => resolve(approvalPayload(interrupt.responseSchema, true))}
					>
						{t('shared_chat.answer.approve')}
					</Button>
					<Button
						disabled={disabled}
						onClick={() => resolve(approvalPayload(interrupt.responseSchema, false))}
					>
						{t('shared_chat.answer.reject')}
					</Button>
				</Flex>
			)
		case 'cancel':
			return (
				<Flex
					gap="small"
					wrap
				>
					<Button
						disabled={disabled}
						onClick={cancel}
					>
						{t('shared_chat.interrupt.cancel')}
					</Button>
				</Flex>
			)
	}
}

/**
 * An interrupt that is not a gated call on screen (spec §6.3; plan calls P6, P8, P13, P14), as one antd Card in the
 * turn: titled from its reason (the three core reasons localised, any other as sent), an "Expired" Tag when its
 * `expiresAt` has passed, its message, then the answer: a form for a flat schema, Yes and No for a confirmation without
 * one, Approve and Reject for an approval whose call has no tool part in the turn, Cancel alone otherwise, and Dismiss
 * once expired. Every card has a way out (decision 50). The answers come from the turn's TurnAnswersContext (React
 * `use`); an interrupt that is not open there shows its title and message only. Every agent string renders as text.
 */
export default function InterruptCard({ interrupt }: { interrupt: Interrupt }) {
	const { t } = useTranslation()
	const context = use(TurnAnswersContext)
	const answers = context?.open.interrupts.some(open => open.id === interrupt.id) ? context : null
	const titleKey = interruptTitleKey(interrupt.reason)
	const expired = answers !== null && isExpired(interrupt, answers.now)
	return (
		<Card
			size="small"
			variant="outlined"
			title={titleKey ? t(titleKey) : interrupt.reason}
			extra={expired && <Tag color="warning">{t('shared_chat.answer.expired')}</Tag>}
		>
			<Flex
				vertical
				gap="small"
			>
				{interrupt.message && <Typography.Text>{interrupt.message}</Typography.Text>}
				{answers && (
					<InterruptAnswer
						interrupt={interrupt}
						answers={answers}
					/>
				)}
			</Flex>
		</Card>
	)
}
```

Nothing renders it yet: Task 15 places it in the turn, and Task 17's e2e proves it in the browser.

- [ ] **Step 7: Gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/interrupt-form.ts components/shared-chat/interrupt-card.tsx __tests__/shared-chat-interrupt-form.test.ts
pnpm exec oxfmt --check components/shared-chat/interrupt-form.ts components/shared-chat/interrupt-card.tsx __tests__/shared-chat-interrupt-form.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
npx -y @ant-design/cli lint ./ --format json
```

Expected: no tsc error, no oxlint finding, oxfmt "All matched files use the correct format", vitest 0 failed, and the antd lint's `"summary"` at `"total": 0`.

- [ ] **Step 8: Commit**

```bash
git add components/shared-chat/interrupt-form.ts components/shared-chat/interrupt-card.tsx __tests__/shared-chat-interrupt-form.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(chat): the interrupt card

An interrupt that is not a gated call on screen as an antd Card: its reason as the
title, its message, then a flat-schema form, Yes and No, Approve and Reject, Cancel,
or Dismiss once expired; a recorded decision shows with Change until the last open
item has one (Part 2 spec §6.1, §6.3; plan calls P6-P8, P13, P14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["components/shared-chat/interrupt-form.ts", "components/shared-chat/interrupt-card.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/shared-chat-interrupt-form.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-interrupt-form.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["shared-chat-interrupt-form (25 tests) and i18n-locales pass", "fieldRules: a required rule with form.field_required (whitespace for strings), then type and bounds per kind; other messages from antd's locale pack", "initialValuesOf: defaults, booleans without one false", "payloadOf drops undefined, null and blank optional strings, keeps false and 0, only declared fields; its result passes checkFlatPayload", "interruptTitleKey: keys for input_required, confirmation, tool_call that exist in en; null otherwise", "interruptCardView: the answer kind with nothing recorded; recorded decisions as approved, rejected, yes, no, answered, cancelled; expired over a resolved decision; a cancel stays", "seven shared_chat.interrupt keys in en, zh, ar; shared_chat.answer keys reused", "InterruptCard: small outlined Card, title key or raw reason, Expired tag, message as text; form / Yes-No / Approve-Reject / Cancel / Dismiss / decided with Change by view; buttons disabled while ctx.disabled; no actions when not open", "tsc, oxlint, oxfmt clean; pnpm test green; antd CLI lint total 0"], "modelTier": "standard"}
```

---

### Task 14: The plan panel and activity cards

**Goal:** Two read-only views for 2b's shared state and activity: `PlanPanel`, an antd `Collapse` headed "Plan 2/5" with a `Progress` and vertical `Steps` that closes itself once every step is completed, and `ActivityCard`, a small antd `Card` per activity part with `Descriptions` or collapsed JSON, with their texts in en, zh and ar.

Spec §6.4 (decision 47) and plan call P17. The panel is the full-stack template's (`tmp/refs/fsat/template/{{cookiecutter.project_slug}}/frontend/src/components/chat/research-panel.tsx`: a "done/total" header, a progress bar, the steps by status `pending | in_progress | completed | blocked`, and an Effect that closes the panel when the work is done and opens it again when work starts, lines 58–71); the state shape it reads is the AG-UI Dojo's `agentic_generative_ui` and Pydantic AI's example, `{ steps: [{ description, status }] }` (research `part2-hitl-state-files.md` §3.1–§3.2). Here it is built on antd's own components, and the template's Effect-plus-ref becomes React's documented "adjusting some state when a prop changes" (react.dev, "You Might Not Need an Effect"; Context7 `/reactjs/react.dev`): the previous `complete` lives in state and the panel's open state is set while rendering, so there is no Effect and no frame with a stale panel. Every rule lives in Task 4's pure modules (`planOf`, `planStepStatus`, `planProgress` in `lib/chat/plan-state.ts`; `activityView` in `components/shared-chat/activity-view.ts`), which Task 4's unit tests cover; these two components only lay those results out, so this task adds no unit test (Global Constraints: components are proven by Task 17's e2e suite). Nothing renders them until Task 15 places them. Docs checked (Step 1): antd 6.6.5 through the CLI and its typings: `Steps` takes `orientation` (`direction` is `@deprecated Please use orientation`, `es/steps/index.d.ts`), `size` `small` or `medium`, and items `{ title, content, status }` (`description` is `@deprecated Please use content`); this panel puts the step's text in `title` and needs neither; an item's own `status` wins over `current` (`@rc-component/steps` 1.2.3 `es/Steps.js` lines 44–57), so `current` is left out. `Collapse` takes `items` `{ key, label, children }`, `activeKey`, `onChange(key: string[])` and `ghost`, and renders a panel's children only once it opens (`forceRender` defaults to false). `Progress` takes `percent` and `size="small"`; `Descriptions` `items` `{ key, label, children }`, `column` and `size="small"`; `Card` `size="small"` and `title`. X 2.9.0 `CodeHighlighter` takes `lang` and `highlightProps` (`node_modules/@ant-design/x/es/code-highlighter/interface.d.ts`), and the dark style is the one `tool-chain.tsx` and `markdown/code-block.tsx` already pass. AG-UI 1.0's Activity page: `activityType` "is an open string … A consumer MUST tolerate types it does not recognise", so the card shows any type as its title.

**Files:**

- Create: `components/shared-chat/plan-panel.tsx`
- Create: `components/shared-chat/activity-card.tsx`
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (`shared_chat.plan` and `shared_chat.activity`)

**Acceptance Criteria:**

- [ ] `PlanPanel({ steps })` renders one antd `Collapse` (`ghost`, one item) labelled `t('shared_chat.plan.title', { done, total })` from `planProgress(steps)`, holding a `Progress` (`percent`, `size="small"`) and `Steps` (`orientation="vertical"`, `size="small"`, items `{ title: step.description, status: planStepStatus(step.status) }`); no deprecated `direction`, `description` or `size="default"`.
- [ ] The panel is controlled (`activeKey`, `onChange`): it starts closed for a complete plan and open otherwise, closes when `planProgress(...).complete` turns true and opens when it turns false again, adjusted while rendering (no `useEffect`), and the user's own toggles hold in between.
- [ ] `ActivityCard({ part })` renders a small antd `Card` titled with `part.activityType` as text; `activityView(part.content)`'s `fields` as `Descriptions` (`column={1}`, `size="small"`, each key as label and value as text); its `json` as a closed ghost `Collapse` labelled `shared_chat.activity.content` holding X `CodeHighlighter lang="json"` (Prism's one-dark style under the dark theme) and, when `truncated`, `shared_chat.activity.truncated`.
- [ ] en, zh and ar hold `shared_chat.plan.title` ("Plan {{done}}/{{total}}") and `shared_chat.activity.content` and `.truncated`; `__tests__/i18n-locales.test.ts` passes (same keys, same placeholders).
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the changed files, `pnpm test` and `pnpm i18n:lint` pass; `npx -y @ant-design/cli lint ./ --format json` stays at `"total": 0`.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run --project unit __tests__/i18n-locales.test.ts` → tsc exit 0, `Test Files  1 passed (1)`

**Steps:**

- [ ] **Step 1: Check the antd APIs**

Run:

```bash
npx -y @ant-design/cli info Steps --version 6.6.5 --format json
npx -y @ant-design/cli info Collapse --version 6.6.5 --format json
grep -n "orientation\|direction\|description\|content" node_modules/antd/es/steps/index.d.ts
grep -n "activeKey\|onChange\|ghost" node_modules/antd/es/collapse/Collapse.d.ts
```

Expected: `Steps` lists `orientation` and `size` (default `medium`) and a `StepItem` with `title`, `content`, `description` and `status` (default `wait`); the typings mark `direction` deprecated ("Please use `orientation` instead") and the item's `description` too ("Please use `content` instead"). `Collapse` lists `activeKey`, `ghost`, `onChange` and `items` (`key`, `label`, `children`), typed `onChange?: (key: string[]) => void`. If any of these differ, stop and report: the components below rely on them.

- [ ] **Step 2: Add the locale keys**

In each locale file, insert the two new objects right after the `tool_result` line of `shared_chat` (earlier tasks may have added keys after it; the line itself is 2a's and unchanged).

`locales/en/translation.json`: find

```json
		"tool_result": "Result",
```

and replace with

```json
		"tool_result": "Result",
		"plan": {
			"title": "Plan {{done}}/{{total}}"
		},
		"activity": {
			"content": "Content",
			"truncated": "Shown in part: the content is longer than 10 KB."
		},
```

`locales/zh/translation.json`: find

```json
		"tool_result": "结果",
```

and replace with

```json
		"tool_result": "结果",
		"plan": {
			"title": "计划 {{done}}/{{total}}"
		},
		"activity": {
			"content": "内容",
			"truncated": "仅显示部分内容：内容超过 10 KB。"
		},
```

`locales/ar/translation.json` (Modern Standard Arabic; the file writes sizes as "KB", e.g. `settings.logo_too_large`): find

```json
		"tool_result": "النتيجة",
```

and replace with

```json
		"tool_result": "النتيجة",
		"plan": {
			"title": "الخطة {{done}}/{{total}}"
		},
		"activity": {
			"content": "المحتوى",
			"truncated": "يُعرض جزء منه فقط: المحتوى أطول من 10 KB."
		},
```

Run: `pnpm exec vitest run --project unit __tests__/i18n-locales.test.ts` Expected: `Test Files  1 passed (1)`.

- [ ] **Step 3: The plan panel**

Create `components/shared-chat/plan-panel.tsx`:

```tsx
'use client'

import { Collapse, Flex, Progress, Steps } from 'antd'
import type { StepsProps } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { planProgress, planStepStatus, type PlanStep } from '@/lib/chat/plan-state'

/** The Collapse's one panel. */
const PANEL_KEY = 'plan'

/**
 * The agent's plan above the composer (spec §6.4, decision 47, plan call P17): the full-stack template's panel
 * (`frontend/src/components/chat/research-panel.tsx`: a "Plan 2/5" header, a progress bar, the steps by status, closed
 * once no step is left) on antd's own components: one ghost Collapse panel headed "Plan {{done}}/{{total}}", a small
 * Progress and vertical small Steps (antd 6.6.5 `Steps`: `orientation`, which replaces the deprecated `direction`; an
 * item's own `status` wins over `current`, `@rc-component/steps` `Steps.js`). Each step's description is its item's
 * title, a text node (spec §6.4: every text renders as text).
 */
export default function PlanPanel({ steps }: { steps: PlanStep[] }) {
	const { t } = useTranslation()
	const { done, total, percent, complete } = planProgress(steps)
	// A finished plan starts closed; the user opens and closes it at will.
	const [open, setOpen] = useState(!complete)
	// React "You Might Not Need an Effect" › "Adjusting some state when a prop changes": the previous value lives in
	// state and the panel is set while rendering, so it closes when the plan completes and opens again when a new one
	// starts (the template's rule, `research-panel.tsx` lines 65–71), with no Effect and no stale frame.
	const [wasComplete, setWasComplete] = useState(complete)
	if (complete !== wasComplete) {
		setWasComplete(complete)
		setOpen(!complete)
	}
	const items = useMemo<StepsProps['items']>(
		() =>
			steps.map((step, index) => ({
				key: index,
				title: step.description,
				status: planStepStatus(step.status),
			})),
		[steps],
	)
	return (
		<Collapse
			ghost
			activeKey={open ? [PANEL_KEY] : []}
			onChange={keys => setOpen(keys.includes(PANEL_KEY))}
			items={[
				{
					key: PANEL_KEY,
					label: t('shared_chat.plan.title', { done, total }),
					children: (
						<Flex
							vertical
							gap="small"
						>
							<Progress
								percent={percent}
								size="small"
							/>
							<Steps
								orientation="vertical"
								size="small"
								items={items}
							/>
						</Flex>
					),
				},
			]}
		/>
	)
}
```

- [ ] **Step 4: The activity card**

Create `components/shared-chat/activity-card.tsx`:

```tsx
'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Card, Collapse, Descriptions, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import type { TurnPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { activityView } from './activity-view'

// Dark scheme, as the tool card and the Markdown code block do (`tool-chain.tsx`, `markdown/code-block.tsx`):
// `highlightProps.style` replaces Prism's one-light style. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * An `activity` part, read-only in the turn (spec §6.4, plan call P17): a small antd Card titled with its
 * `activityType` (AG-UI 1.0 spec, Events › Activity: an open string, and "a consumer MUST tolerate types it does not
 * recognise"), a flat `content` as antd Descriptions, anything else as indented JSON in X CodeHighlighter inside a
 * closed ghost Collapse, cut at 10 KB with a note (`activityView`). Keys, values and the type render as text nodes,
 * never HTML.
 */
export default function ActivityCard({ part }: { part: Extract<TurnPart, { kind: 'activity' }> }) {
	const { t } = useTranslation()
	const { isDark } = useThemeContext()
	const view = useMemo(() => activityView(part.content), [part.content])
	return (
		<Card
			size="small"
			title={part.activityType}
		>
			{view.kind === 'fields' ? (
				<Descriptions
					size="small"
					column={1}
					items={view.items.map(item => ({ key: item.key, label: item.key, children: item.value }))}
				/>
			) : (
				<Collapse
					ghost
					items={[
						{
							key: 'content',
							label: t('shared_chat.activity.content'),
							children: (
								<Flex
									vertical
									gap="small"
								>
									<CodeHighlighter
										lang="json"
										highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
									>
										{view.text}
									</CodeHighlighter>
									{view.truncated && (
										<Typography.Text type="secondary">
											{t('shared_chat.activity.truncated')}
										</Typography.Text>
									)}
								</Flex>
							),
						},
					]}
				/>
			)}
		</Card>
	)
}
```

- [ ] **Step 5: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat/plan-panel.tsx components/shared-chat/activity-card.tsx
pnpm exec oxfmt --check components/shared-chat/plan-panel.tsx components/shared-chat/activity-card.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
pnpm i18n:lint
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; oxlint reports no errors; oxfmt "All matched files use the correct format"; vitest 0 failed; `pnpm i18n:lint` "No issues found."; the antd lint's `summary.total` is `0`. No unit test is added: every rule the two components show (which state is a plan, the status map, the counts, flat or JSON, the 10 KB cut) is Task 4's and tested there.

- [ ] **Step 6: Commit**

```bash
git add components/shared-chat/plan-panel.tsx components/shared-chat/activity-card.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(shared-chat): the plan panel and activity cards

Spec §6.4, plan call P17: the agent's plan as one ghost Collapse
headed \"Plan 2/5\" with a Progress and vertical Steps, closing itself
once every step is completed (the full-stack template's panel), and
each activity part as a small Card with Descriptions or collapsed
JSON. Task 15 places them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the five files; lint-staged's oxfmt and oxlint pass.

```json:metadata
{"files": ["components/shared-chat/plan-panel.tsx", "components/shared-chat/activity-card.tsx", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json"], "verifyCommand": "pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec vitest run --project unit __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["PlanPanel renders one ghost antd Collapse labelled shared_chat.plan.title with done and total from planProgress, holding Progress (percent, size small) and Steps (orientation vertical, size small, items {title: description, status: planStepStatus(status)}), no deprecated props", "the panel is controlled: closed at start for a complete plan, closes when complete turns true and opens when it turns false, adjusted while rendering without an Effect; user toggles hold in between", "ActivityCard renders a small Card titled with activityType; fields as Descriptions (column 1, size small); json as a closed ghost Collapse with X CodeHighlighter lang json (dark style in the dark theme) and the truncated note when cut", "en, zh and ar hold shared_chat.plan.title and shared_chat.activity.content and .truncated; the locale test passes", "tsc, oxlint, oxfmt, pnpm test and pnpm i18n:lint pass; the antd lint stays at total 0"], "modelTier": "standard"}
```

---

### Task 15: The chat view: cards, panel and the visible hint (#69)

**Goal:** The shared chat shows 2b's human-in-the-loop pieces where spec §6 puts them: the answers' context around the turn list for the turn that waits, activity cards and standalone interrupt cards inside the turn, the plan panel and the `ask_user` card above the composer, and, while the Sender is disabled, a visible "Answer the agent above to continue." line in place of 2a's placeholder text (#69's hint item).

Spec §6.1–§6.4, decision 50 (the Sender is disabled with a visible hint while anything is open), plan calls P8 (an approval whose `toolCallId` matches no tool part of the turn is its own card), P9 (`waiting` calls), P13 (drafts and "Change"), P15 (the hint). It places what Tasks 11–14 built: `TurnAnswersContext` (Task 11) is provided around `TurnList` for the turn that waits, so `ToolChain`'s approval footer (Task 11) and `InterruptCard` (Task 13) read it, while `renderAssistant` and `renderFooter` keep their empty dependency lists (2a's rule in this file: Bubble.List's role map follows them, and a new map re-renders every bubble; a new context value re-renders only the components that read it, React reference `useContext`). `AskUserCard` (Task 12) and `PlanPanel` (Task 14) sit in a new "dock" between the list and the composer, inside the reading-width column; like the column's `.top` area it takes at most half the column and scrolls beyond that. The card gets only the questions without a drafted answer: while another open item still waits, a call answered already leaves the card, and a "Change" (`retract`, P13) brings it back; the card is keyed by those calls, so it starts a fresh stepper when that set changes. The hint is a `Typography.Text type="secondary"` line above the Sender (the Dify chat's disclaimer pattern), and the Sender keeps its usual placeholder, which `e2e/agui-chat.spec.ts` locates the box by ("Type a message"). The one rule here, which open interrupts get a card of their own, is a pure helper in `turn-parts.ts` with unit tests; `bubble-items.ts`' `isEmpty` already holds with `waiting` parts (a waiting call is a part), which a new test pins. Styles: a new colocated CSS Module with `var(--ant-*)` values only (the frontend rules; `components/chat/**` stays untouched). Depends on Task 3 (`isApproval`), Task 4 (`planOf`), Task 5 (`hasOpenItems`, `ToolStatus` `waiting`), Task 10 (`useSharedChat`'s `askUser` option and its `openItems`, `draft`, `answer`, `retract`; `useExpiryClock`; `ToolAnswer`), Tasks 11–14 (the components).

**Files:**

- Create: `components/shared-chat/shared-chat.module.css`
- Modify: `components/shared-chat/shared-chat.tsx` (the whole file)
- Modify: `components/shared-chat/assistant-turn.tsx` (the whole file)
- Modify: `components/shared-chat/turn-parts.ts` (`standaloneInterrupts`)
- Modify: `components/shared-chat/bubble-items.ts` (`isEmpty`'s comment: checked against waiting calls)
- Modify: `locales/en/translation.json`, `locales/zh/translation.json`, `locales/ar/translation.json` (`shared_chat.answer_pending_hint`)
- Test: `__tests__/shared-chat-view.test.ts` (extended)

**Acceptance Criteria:**

- [ ] `standaloneInterrupts(parts, interrupts)` keeps every open interrupt in order except an approval (`isApproval`) whose `toolCallId` names a tool part of the turn; an approval for a call the turn does not hold, a `tool_call` without a `toolCallId` and any other reason stay (P8).
- [ ] `toBubbleItems` shows no loading dots for a `loading` answer whose only part is a `waiting` call (P9; `isEmpty` unchanged).
- [ ] `SharedChat` passes `askUser: app.askUser` to `useSharedChat`; `waiting` is `hasOpenItems(chat.openItems) && !chat.isRequesting`; the Sender is disabled while waiting, keeps its usual placeholder, and a secondary line `shared_chat.answer_pending_hint` shows above it while waiting.
- [ ] `TurnAnswersContext` wraps `TurnList` with a memoised `{ turn, open, draft, disabled: chat.isRequesting || !activeKey, now: useExpiryClock(open.interrupts), answer, retract }` while the last message is an assistant turn with open items, and `null` otherwise; `renderAssistant` and `renderFooter` keep `[]` dependencies.
- [ ] Above the composer, inside the reading-width column: `PlanPanel` when `planOf(chat.state)` is not null (keyed by the conversation), then, while no request runs, `AskUserCard` with the open questions that have no drafted answer, whose `onAnswer` sends each `ToolAnswer` as `chat.answer({ kind: 'tool', … })`.
- [ ] `AssistantTurn` renders `ActivityCard` for an activity group, and after the groups, before the run errors, one `InterruptCard` per `standaloneInterrupts(turn.parts, useTurnAnswers(turn).open.interrupts)` (none for a turn that does not wait).
- [ ] `shared_chat.answer_pending_hint` is "Answer the agent above to continue." in en, with zh and Modern Standard Arabic; no file under `e2e/` holds the old English text.
- [ ] tsc, oxlint, oxfmt, `pnpm test` and `pnpm i18n:lint` pass; `npx -y @ant-design/cli lint ./ --format json` stays at `"total": 0`; `pnpm test:e2e e2e/agui-chat.spec.ts --project desktop-light` passes (2a's AG-UI specs stay green).

**Verify:** `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts __tests__/i18n-locales.test.ts` → `Test Files  2 passed (2)`

**Steps:**

- [ ] **Step 1: Write the failing test**

In `__tests__/shared-chat-view.test.ts`, find

```ts
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
```

and replace with

```ts
import type { Interrupt } from '@ag-ui/core'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
```

Find

```ts
import { groupParts, inputHint, prettyJson } from '@/components/shared-chat/turn-parts'
```

and replace with

```ts
import {
	groupParts,
	inputHint,
	prettyJson,
	standaloneInterrupts,
} from '@/components/shared-chat/turn-parts'
```

Append at the end of the file:

```ts
describe('standaloneInterrupts (spec §6.3, plan call P8)', () => {
	const call = (id: string): TurnPart => ({
		kind: 'tool',
		toolCallId: id,
		name: 'delete_file',
		args: '{}',
		status: 'waiting',
	})
	const approval: Interrupt = { id: 'i1', reason: 'tool_call', toolCallId: 'c1' }
	const elsewhere: Interrupt = { id: 'i2', reason: 'tool_call', toolCallId: 'c9' }
	const unbound: Interrupt = { id: 'i3', reason: 'tool_call' }
	const input: Interrupt = { id: 'i4', reason: 'input_required', message: 'Which city?' }
	const confirm: Interrupt = { id: 'i5', reason: 'confirmation', toolCallId: 'c1' }
	it("leaves an approval to its own call's card and keeps every other interrupt in order", () => {
		expect(
			standaloneInterrupts([call('c1')], [approval, elsewhere, unbound, input, confirm]),
		).toEqual([elsewhere, unbound, input, confirm])
	})
	it('keeps an approval as its own card when the turn holds no such call', () => {
		expect(standaloneInterrupts([], [approval])).toEqual([approval])
		expect(standaloneInterrupts([call('c2')], [approval])).toEqual([approval])
	})
	it('shows nothing when nothing is open', () => {
		expect(standaloneInterrupts([call('c1')], [])).toEqual([])
	})
})

describe('toBubbleItems with a waiting call (plan call P9)', () => {
	it('does not show the loading dots for an answer whose only part waits for an answer', () => {
		const asking: Turn = {
			...emptyAssistantTurn(),
			parts: [{ kind: 'tool', toolCallId: 'c1', name: 'ask_user', args: '{}', status: 'waiting' }],
		}
		expect(toBubbleItems([{ id: 'a', message: asking, status: 'loading' }])[0]).toMatchObject({
			loading: false,
		})
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts` Expected: FAIL: the three `standaloneInterrupts` cases with `TypeError: standaloneInterrupts is not a function`; the waiting-call case already passes (it pins 2a's `isEmpty`, which counts every part).

- [ ] **Step 3: The standalone interrupts**

In `components/shared-chat/turn-parts.ts` (as of Task 5, which re-exports `ToolPart`), find

```ts
import type { ToolPart, TurnPart } from '@/lib/chat/turn'
```

and replace with

```ts
import type { Interrupt } from '@ag-ui/core'

import { isApproval } from '@/lib/chat/interrupt-answers'
import type { ToolPart, TurnPart } from '@/lib/chat/turn'
```

Append at the end of the file (after `prettyJson`):

```ts
/**
 * The open interrupts a turn shows as cards of their own (spec §6.3, plan call P8): all of them except an approval
 * whose `toolCallId` names one of this turn's tool calls, which that call's ThoughtChain item answers (spec §6.1). An
 * approval for a call the turn does not hold keeps its own card, with Approve and Reject. Order is kept.
 */
export const standaloneInterrupts = (
	parts: readonly TurnPart[],
	interrupts: readonly Interrupt[],
): Interrupt[] => {
	const calls = new Set(parts.flatMap(part => (part.kind === 'tool' ? [part.toolCallId] : [])))
	return interrupts.filter(
		interrupt =>
			!(
				isApproval(interrupt) &&
				interrupt.toolCallId !== undefined &&
				calls.has(interrupt.toolCallId)
			),
	)
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts` Expected: `Test Files  1 passed (1)`.

- [ ] **Step 5: Record the `isEmpty` check**

The check of `components/shared-chat/bubble-items.ts`: `isEmpty` counts parts, and a `waiting` call (P9) is a part, so an answer that only asks never shows the loading dots; an answer that only interrupts already counted (2a's test). Only its comment changes. Find

```ts
/** Nothing to render yet: no part, no open interrupt, and no run that ended in an error or a stop (all show in the bubble). */
```

and replace with

```ts
/**
 * Nothing to render yet: no part, no open interrupt, and no run that ended in an error or a stop (all show in the
 * bubble). A call that waits for an answer (plan call P9) is a part, so a turn that only asks is never empty either.
 */
```

- [ ] **Step 6: The dock and the hint's styles**

Create `components/shared-chat/shared-chat.module.css`:

```css
/* What waits above the composer (Part 2 spec §6.2, §6.4): the plan panel and the ask_user card. Like the column's
   top area (chat-view.module.css `.top`), it takes at most half the column and scrolls beyond that, so the
   messages always keep room. */
.dock {
	flex: 0 1 auto;
	min-height: 0;
	max-height: 50%;
	overflow: auto;
	padding-block-start: var(--ant-padding-sm);
}
/* The visible hint above the Sender while an answer is pending (spec §6.3, plan call P15): its own line, as the
   Dify chat's disclaimer below the Sender (chat-view.module.css `.disclaimer`). */
.hint {
	display: block;
	padding-block-end: var(--ant-padding-xs);
}
```

- [ ] **Step 7: The turn's cards**

`components/shared-chat/assistant-turn.tsx` is as 2a left it (`git diff fork/overhaul -- components/shared-chat/assistant-turn.tsx` prints nothing; if it prints a change, stop and report). Replace the whole of it with:

```tsx
'use client'

import { Alert, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageMarkdown from '@/components/chat/message/message-markdown'
import Reasoning from '@/components/chat/message/reasoning'
import type { Turn } from '@/lib/chat/turn'

import ActivityCard from './activity-card'
import { useTurnAnswers } from './answer-context'
import InterruptCard from './interrupt-card'
import { runErrorView, stoppedCaptionKey } from './run-error'
import ToolChain from './tool-chain'
import { groupParts, standaloneInterrupts } from './turn-parts'

export interface AssistantTurnProps {
	turn: Turn
	/** X's message status: `updating` while the turn streams (spec §5.2: the transport layer). */
	status?: string
}

/**
 * An answer (spec §5.3): its parts in arrival order (reasoning in X Think through the Dify chat's `Reasoning` and its
 * timer, text through `MessageMarkdown`, consecutive tool calls as one ThoughtChain, activity parts as read-only cards,
 * spec §6.4), then, while this is the turn that waits, each open interrupt no tool card answers as a card of its own
 * (spec §6.3, plan call P8), then each run's error in an antd Alert below what streamed (plan call P11: under cards
 * that stay answerable), then "Stopped" or "Stopped: time limit". An answer that ended with nothing shows the Dify
 * chat's empty-answer warning.
 */
export default function AssistantTurn({ turn, status }: AssistantTurnProps) {
	const { t } = useTranslation()
	// The answers' context, only for the turn that waits (Task 11's useTurnAnswers); null for every other turn.
	const answers = useTurnAnswers(turn)
	const streaming = status === 'updating'
	const groups = useMemo(() => groupParts(turn.parts), [turn.parts])
	const interrupts = useMemo(
		() => (answers ? standaloneInterrupts(turn.parts, answers.open.interrupts) : []),
		[answers, turn.parts],
	)
	const errors = turn.runs.filter(run => run.error)
	const caption = stoppedCaptionKey(turn)
	// An answer that only interrupts (the agent asks and says nothing) is not empty.
	const empty =
		groups.length === 0 && errors.length === 0 && turn.interrupts.length === 0 && !caption
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
						return (
							<ActivityCard
								key={group.messageId}
								part={group}
							/>
						)
					default:
						return group satisfies never
				}
			})}
			{interrupts.map(interrupt => (
				<InterruptCard
					key={interrupt.id}
					interrupt={interrupt}
				/>
			))}
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

- [ ] **Step 8: The chat view**

Run `git diff fork/overhaul -- components/shared-chat/shared-chat.tsx` first. Task 10 changed this file only as far as its own API change required: `askUser: app.askUser` in the `useSharedChat` call, and the `waiting` line reading `chat.openItems` instead of 2a's `openInterrupts`. Both are in the content below; if the diff shows anything else, stop and report. Replace the whole of `components/shared-chat/shared-chat.tsx` with:

```tsx
'use client'

import { MenuOutlined } from '@ant-design/icons'
import { useLocalStorageState } from 'ahooks'
import { Alert, App, Button, Flex, Layout, Typography, theme } from 'antd'
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
import { hasOpenItems } from '@/lib/chat/open-items'
import { planOf } from '@/lib/chat/plan-state'
import type { Turn } from '@/lib/chat/turn'
import type { ChatAppDto } from '@/lib/data/apps'

import { TurnAnswersContext, type TurnAnswers } from './answer-context'
import { createSharedChatApi } from './api'
import AskUserCard from './ask-user-card'
import AssistantTurn from './assistant-turn'
import { useExpiryClock } from './hooks/use-expiry-clock'
import { useSharedChat } from './hooks/use-shared-chat'
import { useSharedConversations } from './hooks/use-shared-conversations'
import PlanPanel from './plan-panel'
import type { ToolAnswer } from './provider/ag-ui-chat-provider'
import { requestFailureText } from './run-error'
import shared from './shared-chat.module.css'
import SharedWelcome from './shared-welcome'
import TurnFooter from './turn-footer'
import TurnList from './turn-list'

/** An AG-UI app's chat DTO: what ProviderChat hands this page (spec §2.2: no agent URL, audience or secret). */
export type AguiChatApp = Extract<ChatAppDto, { provider: 'agui' }>

/**
 * The shared chat (Part 2 spec §5): the Dify chat's page layout (UserShell, AppSider with the conversation sidebar or
 * its collapsed rail, the mobile ConversationDrawer, the reading-width toggle and the chat column's CSS Module), reused
 * as spec §5.1 lists, around the turn list and the X Sender. The app's name, description and icon reach the shared
 * sidebar pieces through ChatAppInfoContext (Task 14; React 19 renders a context as its own provider). Human in the
 * loop (spec §6): the turn that waits gets the answers' context for its cards, and above the Sender sit the plan panel,
 * the ask_user card and, while anything is open, a visible hint (decision 50).
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
	// useSharedChat keeps this reader under `activeKey` for as long as that conversation lives in the background, so it
	// is bound to this render's key (a const), never to "the active key" read later.
	const readConversationId = useCallback(
		() => getConversationId(activeKey),
		[getConversationId, activeKey],
	)
	const chat = useSharedChat({
		appId: app.id,
		conversationKey: activeKey,
		api,
		getConversationId: readConversationId,
		// The stream named its conversation (hub:run): the item keeps its key and takes the id and title (ADR-0017).
		onRun: (key, value) => markConversation(key, value.conversationId, value.title),
		// Spec §6.2, decision 62: a waiting ask_user call is open while the app's switch is on now.
		askUser: app.askUser,
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
	// Decision 50: an open approval, question or interrupt blocks the composer until the cards answer it (spec §6.3).
	const open = chat.openItems
	const waiting = hasOpenItems(open) && !chat.isRequesting
	// The clock the cards judge expiry by (plan call P14): it ticks when the next expiresAt passes.
	const now = useExpiryClock(open.interrupts)
	// The turn that waits: the last one, when it is an answer with open items (useSharedChat reads them from it).
	const lastTurn = chat.messages.at(-1)?.message
	const waitingTurn = lastTurn?.role === 'assistant' && hasOpenItems(open) ? lastTurn : undefined
	const answersDisabled = chat.isRequesting || !activeKey
	const { draft, answer, retract } = chat
	// The cards in the turn read this through useTurnAnswers (Task 11), so the role map's callbacks above stay stable:
	// a new value re-renders the components that read the context (React reference, `useContext`), not the role map.
	const turnAnswers = useMemo<TurnAnswers | null>(
		() =>
			waitingTurn
				? {
						turn: waitingTurn,
						open,
						draft,
						disabled: answersDisabled,
						now,
						answer,
						retract,
					}
				: null,
		[waitingTurn, open, draft, answersDisabled, now, answer, retract],
	)
	// The ask_user questions without a decision yet (plan call P13): a drafted call leaves the card while other items
	// wait, and a "Change" (retract) brings it back.
	const questions = useMemo(
		() => open.questions.filter(part => !draft.tools[part.toolCallId]),
		[open.questions, draft.tools],
	)
	const answerQuestions = useCallback(
		(answers: ToolAnswer[]) => {
			for (const toolAnswer of answers) answer({ kind: 'tool', ...toolAnswer })
		},
		[answer],
	)
	const asking = questions.length > 0 && !chat.isRequesting
	// Spec §6.4: the panel shows only for state that reads as a plan.
	const plan = useMemo(() => planOf(chat.state), [chat.state])

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
							<TurnAnswersContext value={turnAnswers}>
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
							</TurnAnswersContext>
							{(plan || asking) && (
								<div
									className={`${shared.dock} ${styles.reading}`}
									style={readingStyle}
								>
									<Flex
										vertical
										gap="small"
									>
										{plan && (
											<PlanPanel
												// React "Resetting all state when a prop changes": each conversation's panel starts afresh.
												key={activeKey}
												steps={plan}
											/>
										)}
										{asking && (
											<AskUserCard
												// A fresh stepper whenever the set of undecided calls changes.
												key={questions.map(part => part.toolCallId).join()}
												questions={questions}
												disabled={answersDisabled}
												onAnswer={answerQuestions}
											/>
										)}
									</Flex>
								</div>
							)}
							<div
								className={`${styles.composer} ${styles.reading}`}
								style={readingStyle}
							>
								{waiting && (
									// Plan call P15 (#69): a visible line says why the box is disabled.
									<Typography.Text
										type="secondary"
										className={shared.hint}
									>
										{t('shared_chat.answer_pending_hint')}
									</Typography.Text>
								)}
								<ChatSender
									loading={chat.isRequesting}
									disabled={!activeKey || waiting}
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

- [ ] **Step 9: The hint's text (P15)**

`locales/en/translation.json`: find

```json
		"answer_pending_hint": "This conversation waits for an answer this chat cannot show yet. Start a new conversation to go on.",
```

and replace with

```json
		"answer_pending_hint": "Answer the agent above to continue.",
```

`locales/zh/translation.json`: find

```json
		"answer_pending_hint": "此对话正在等待一个本聊天暂时无法显示的回答。请新建对话继续。",
```

and replace with

```json
		"answer_pending_hint": "请先回应上方的智能体，然后继续。",
```

`locales/ar/translation.json`: find

```json
		"answer_pending_hint": "تنتظر هذه المحادثة إجابةً لا يمكن لهذه الدردشة عرضها بعد. ابدأ محادثة جديدة للمتابعة.",
```

and replace with

```json
		"answer_pending_hint": "أجب الوكيل أعلاه للمتابعة.",
```

The i18n rule: search `e2e/` for the old English text. Run:

```bash
grep -rn "cannot show yet\|Start a new conversation to go on" e2e/
```

Expected: no output (no 2a spec reads the old hint; `e2e/agui-chat.spec.ts` finds the Sender by "Type a message", which the box keeps now). A hit means a spec to update in this step to the new text.

- [ ] **Step 10: Gates**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint components/shared-chat __tests__/shared-chat-view.test.ts
pnpm exec oxfmt --check components/shared-chat __tests__/shared-chat-view.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
pnpm i18n:lint
npx -y @ant-design/cli lint ./ --format json
```

Expected: tsc exits 0; oxlint reports no errors; oxfmt "All matched files use the correct format"; vitest 0 failed; `pnpm i18n:lint` "No issues found."; the antd lint's `summary.total` is `0`.

Then the AG-UI chat's e2e spec on one project (stop `pnpm dev` first: one `next dev` per checkout):

```bash
pnpm test:e2e e2e/agui-chat.spec.ts --project desktop-light
rm -rf .next/dev/types && pnpm exec next typegen
```

Expected: every test of `e2e/agui-chat.spec.ts` passes on `desktop-light` (2a's behaviour is unchanged: none of its scenarios ends with an open item, a plan or an activity); the second line clears the stale route types an e2e run leaves (Global Constraints). The new pieces are proven by Task 17's `e2e/agui-hitl.spec.ts`.

- [ ] **Step 11: Commit**

```bash
git add components/shared-chat/shared-chat.module.css components/shared-chat/shared-chat.tsx components/shared-chat/assistant-turn.tsx components/shared-chat/turn-parts.ts components/shared-chat/bubble-items.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json __tests__/shared-chat-view.test.ts
git commit -m "feat(shared-chat): answer cards, the plan panel and a visible hint

Spec §6, decision 50: the turn that waits gets the answers' context
(approvals on its tool cards, a card per other interrupt, plan call
P8), activity parts render as cards, and the plan panel and the
ask_user card sit above the composer. While anything is open the
Sender is disabled under a visible line, \"Answer the agent above to
continue.\", instead of 2a's placeholder (plan call P15, #69).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with the nine files; lint-staged's oxfmt and oxlint pass.

```json:metadata
{"files": ["components/shared-chat/shared-chat.module.css", "components/shared-chat/shared-chat.tsx", "components/shared-chat/assistant-turn.tsx", "components/shared-chat/turn-parts.ts", "components/shared-chat/bubble-items.ts", "locales/en/translation.json", "locales/zh/translation.json", "locales/ar/translation.json", "__tests__/shared-chat-view.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/shared-chat-view.test.ts __tests__/i18n-locales.test.ts", "acceptanceCriteria": ["standaloneInterrupts keeps every open interrupt in order except an approval whose toolCallId names a tool part of the turn (P8)", "toBubbleItems shows no loading dots for a loading answer whose only part is a waiting call", "SharedChat passes askUser: app.askUser; waiting = hasOpenItems(openItems) && !isRequesting; the Sender is disabled while waiting, keeps its placeholder, and a secondary hint line shows above it", "TurnAnswersContext wraps TurnList with the memoised answers of the turn that waits, null otherwise; renderAssistant and renderFooter keep [] dependencies", "above the composer: PlanPanel when planOf(state) is not null, then AskUserCard with the undecided open questions while no request runs, onAnswer sending each ToolAnswer through chat.answer({kind: 'tool'})", "AssistantTurn renders ActivityCard for activity groups and an InterruptCard per standalone open interrupt before the run errors", "shared_chat.answer_pending_hint reads 'Answer the agent above to continue.' in en with zh and ar; no e2e file holds the old text", "tsc, oxlint, oxfmt, pnpm test, pnpm i18n:lint pass; the antd lint stays at total 0; e2e/agui-chat.spec.ts passes on desktop-light"], "modelTier": "standard"}
```

---

### Task 16: The e2e stub's human-in-the-loop scenarios

**Goal:** The stub AG-UI producer on 5399 plays 2b's scenarios (spec §10's 2b list: approvals, `ask_user`, `input_required` and the other interrupts, plan state, activity), answers the runs that continue them from the original prompt, and the e2e seed turns `askUser` on for the agent that answers (plan call P18).

Spec §10 (e2e, 2b: "an approval (approve, reject), `ask_user` (answer, skip, dismiss), `input_required`, plan state, activity"), plan call P18, decision 62 (the `fragile` scenario proves its first answer: a refused answering run keeps the items open, #67), ADR-0010 (the stub is the suite's fake backend; scenarios by the query text). It grows 2a's `e2e/fixtures/stub/agui.ts` the way the spike's 1.0 stub did (`agui-spike.md` Appendix B: `input_required`, activity, a frontend tool call) and keeps 2a's scenarios exactly as they are: 2b's are tried first, by keywords that are whole words of the last user text (the Dify stub's `hasWord`, `e2e/fixtures/stub/scenarios.ts`) and that no 2a prompt holds (2a's prompts: `hello <project>`, `tool`, `use a tool`, `error <code>`, `timeout`, `slow`, `remember me <project>`, `rename me <project> …`, `invalid please`, `please answer invalid`, `hello`, `hello after the edit`; the projects are `desktop-light`, `desktop-dark` and `mobile-light`). The stub stays independent of the hub's code (the second producer of decision 7): it names `ask_user` itself and reads only the tool's name from `RunAgentInput.tools`. Nothing in the browser reads these scenarios yet: Task 17's specs do. Depends on Task 1 (`askUser` in the AG-UI settings, which the seed writes) and Task 8 (the hub advertises `ask_user` while it is on).

Docs checked (Step 1): `@ag-ui/core` 1.0.2 `dist/schemas.mjs`: `RunAgentInputSchema` has `resume: z.array(ResumeEntrySchema).optional()` (`interruptId`, `status` `resolved` or `cancelled`, `payload` any non-null value) and `tools` defaulted to `[]`; `ToolMessageSchema` has `error: z.string().optional()`; `StateSchema` is any JSON. The typings (`dist/version-*.d.ts`): `Interrupt` `{ id, reason, message?, toolCallId?, responseSchema?: Record<string, any>, expiresAt?, metadata? }`; `RunFinishedSuccessOutcome` `{ type: 'success', pendingToolCallIds?: string[] }`; `STATE_SNAPSHOT { snapshot }`, `STATE_DELTA { delta: JsonPatch }`, `ACTIVITY_SNAPSHOT { messageId, activityType, content }`, `ACTIVITY_DELTA { messageId, activityType, patch }`. AG-UI concepts › Interrupts (`scratchpad/docs/concepts_interrupts.md`): the "Non-tool input request" example's quarterly filing schema; the reason taxonomy (`confirmation`: "`responseSchema` optional; boolean default"); "Tool-bound interrupts": the resumed run "emits `ToolCallResult` against the original `toolCallId`"; Error handling: a resume that "fails to address every open interrupt" ends with `RunError`. AG-UI 1.0 "Tool calls", Frontend tools: the producer "MUST NOT answer it", finishes with the success outcome, and its `pendingToolCallIds` "SHOULD" name the calls left open. The approval interrupt is Pydantic AI's exact shape as the spike recorded it (Findings › Agent side): `id: "int-<toolCallId>"`, reason `tool_call`, `message: "Approve delete_file({...})?"`, the `toolCallId`, and `responseSchema` `{ approved: boolean (required), editedArgs: object, reason: string }`.

**The scenarios** (Task 17 reads these texts; a keyword counts as a whole word, tried in this order):

| Keyword | The run it starts | The run that answers it |
| --- | --- | --- |
| `gated` | text "I need your approval to delete report.pdf.", a `delete_file` call `{"path": "report.pdf"}` under it, `RUN_FINISHED` with one approval interrupt in Pydantic AI's shape | `resume` → a `TOOL_CALL_RESULT` on the original call ("Deleted report.pdf." when approved, else "Not deleted: " and the payload's `reason`, or `cancelled` without one), then "Done: report.pdf deleted." or "Done: report.pdf kept." |
| `double` | the same for `report.pdf` and `notes.txt`: two calls, two interrupts in call order | a result per call, then "Done: report.pdf deleted, notes.txt kept." (per decision); a `resume` that leaves an open call unanswered → `RUN_ERROR` |
| `fragile` | as `gated` | the first `resume` on a thread → 422 before any stream; the next one as `gated` |
| `badquestion` | an `ask_user` call `{"questions": []}` (invalid), when `tools` names `ask_user` | its tool message (last row) |
| `question` | text "I need a few answers before I go on.", an `ask_user` call: "Which city?" (options Paris, Rome) and "Which month?" (no options); success outcome with `pendingToolCallIds`. Without `ask_user` in `tools`: only "No ask_user tool was offered, so I cannot ask you." | its tool message (last row) |
| `form` | `input_required`, "Please provide the quarterly filing details.", AG-UI's quarterly filing schema (`quarter` enum Q1–Q4, `year` integer ≥ 2000, `revenue` number, all required) | "Filed: " and the payload as JSON, or "The form was cancelled." |
| `confirm` | `confirmation` without a schema, "Archive the old reports?" | "Confirmed: true" or "Confirmed: false", or "The confirmation was cancelled." |
| `expired` | `input_required`, "Pick a delivery slot.", `expiresAt` one minute in the past | "The request expired." |
| `finish` (sent as `finish plan`) | a `STATE_SNAPSHOT` of the input's `state` with every step `completed` (the stub's three steps when it has none), then "Every step of the plan is done." | — |
| `plan` | `STATE_SNAPSHOT` `{ steps }` with "Gather the sources", "Draft the summary", "Review the draft" pending, two `STATE_DELTA`s to completed, in_progress, pending (1 of 3 done), then "I made a plan and finished its first step." | — |
| `activity` | `ACTIVITY_SNAPSHOT` `progress` `{ label: 'Indexing', done: 0, total: 3 }`, three `ACTIVITY_DELTA`s to `done` 3, then "Indexing finished." | — |
| (any) | — | a run whose last message is a tool message answering an `ask_user` call → "Got your answers: " and its content with each run of line breaks as " / ", or "The question was dismissed." when the message has an `error` |

**Files:**

- Modify: `e2e/fixtures/stub/agui.ts` (2b's scenarios, tried before 2a's)
- Modify: `e2e/fixtures/stub/agui-apps.ts` (`StubAguiApp.askUser`)
- Modify: `e2e/auth.setup.ts` (the seed writes `askUser` into the AG-UI apps' settings)
- Test: `__tests__/stub-agui.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` reports 21 passed (2a's 7 and 14 new).
- [ ] `gated` streams a text, a `delete_file` call with `{"path": "report.pdf"}` whose `parentMessageId` is the text's id, and ends on exactly `{ type: 'interrupt', interrupts: [{ id: 'int-<toolCallId>', reason: 'tool_call', message: 'Approve delete_file({"path": "report.pdf"})?', toolCallId, responseSchema: <Pydantic AI's> }] }`; `double` ends on two such interrupts in call order.
- [ ] A resumed approval answers the original call: "Deleted report.pdf." (approved), "Not deleted: Rejected by the user" (rejected with that reason), "Not deleted: cancelled" (cancelled), then "Done: …"; a `double` resume covering one of two calls ends with `RUN_ERROR`; `fragile`'s first resume per thread answers 422 `application/json` with no stream and its second answers 200.
- [ ] `question` with `ask_user` in `tools` streams an `ask_user` call with the two questions and ends `{ type: 'success', pendingToolCallIds: [<its id>] }`; without it, only the "No ask_user tool was offered" text; `badquestion` calls `ask_user` with `{"questions": []}`; an input ending with a tool message on an `ask_user` call gets "Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May", or "The question was dismissed." when the message has `error`.
- [ ] `form`, `confirm` and `expired` end on their interrupts (the quarterly filing schema; a `confirmation` with no `responseSchema`; an `expiresAt` before now), and their resumes answer "Filed: {…}" or "The form was cancelled.", "Confirmed: true" or "Confirmed: false", and "The request expired."
- [ ] `plan` sends a snapshot of three pending steps and two deltas; `finish plan` completes the steps of the `state` it is given and keeps the state's other keys; `activity` sends a `progress` snapshot and three deltas to `done` 3.
- [ ] `@ag-ui/client`'s `HttpAgent` reads `gated` and its resume (built with `buildResumeArray`), `question`, `plan` (its `state` after the deltas) and `activity` (one activity message with `done` 3) without a protocol error.
- [ ] `AGUI_APP.askUser` is `true` and `AGUI_MISSING_APP.askUser` is `false`; the seed writes it into each AG-UI app's `settings`; `pnpm test:e2e e2e/agui-chat.spec.ts --project desktop-light` stays green (2a's scenarios with `ask_user` advertised).

**Verify:** `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` → `Tests  21 passed (21)`

**Steps:**

- [ ] **Step 1: Read the stub as it is and check the APIs**

Read `e2e/fixtures/stub/agui.ts` (2a's `planFor`, `textMessage`, `lastUserText`, `handleAgui`), `e2e/fixtures/stub/agui-apps.ts`, `e2e/fixtures/stub/scenarios.ts` (`hasWord`, line 46: a case-insensitive RegExp with `\b` word boundaries), `e2e/auth.setup.ts` and `__tests__/stub-agui.test.ts`. Check the facts in this task's docs paragraph against `node_modules/@ag-ui/core/dist/schemas.mjs` (`RunAgentInputSchema`, `ResumeEntrySchema`, `ToolMessageSchema`) and `dist/version-*.d.ts` (`Interrupt`, `RunFinishedSuccessOutcome`, the state and activity events), and `@ag-ui/client`'s `buildResumeArray(interrupts, responses)` and `pendingInterrupts` (`dist/index.d.ts`).

- [ ] **Step 2: Write the failing tests**

In `__tests__/stub-agui.test.ts`, replace the import

```ts
import { HttpAgent, type Message } from '@ag-ui/client'
```

with

```ts
import { buildResumeArray, HttpAgent, type Message } from '@ag-ui/client'
```

Replace the `input` helper

```ts
const input = (text: string) => ({
	threadId: 'thread-1',
	runId: 'run-1',
	state: {},
	messages: [{ id: 'user-1', role: 'user', content: text }],
	tools: [],
	context: [],
	forwardedProps: {},
})
```

with (2a's calls keep their meaning: `input(text)` builds the same body)

```ts
/** A RunAgentInput for one user text; 2b's cases add the messages after it, the tools, the state or the resume. */
const input = (
	text: string,
	over: {
		threadId?: string
		after?: unknown[]
		tools?: unknown[]
		state?: unknown
		resume?: unknown[]
	} = {},
) => ({
	threadId: over.threadId ?? 'thread-1',
	runId: 'run-1',
	state: over.state ?? {},
	messages: [{ id: 'user-1', role: 'user', content: text }, ...(over.after ?? [])],
	tools: over.tools ?? [],
	context: [],
	forwardedProps: {},
	...(over.resume ? { resume: over.resume } : {}),
})
```

Then append to the end of the file, after the closing `})` of `describe('the AG-UI stub agent (Part 2 spec §10)', …)`:

```ts
/** The hub's ask_user tool as a run advertises it (spec §6.2); the stub reads only its name. */
const ASK_USER_TOOL = {
	name: 'ask_user',
	description: 'Ask the user one or more questions.',
	parameters: { type: 'object' },
}
const APPROVAL_SCHEMA = {
	type: 'object',
	properties: {
		approved: { type: 'boolean' },
		editedArgs: { type: 'object' },
		reason: { type: 'string' },
	},
	required: ['approved'],
}

/** An assistant message as the hub stores a run's tool calls (AG-UI 1.0 `AssistantMessage.toolCalls`). */
const assistantWith = (...calls: { id: string; name: string; args: string }[]) => ({
	id: `assistant-${calls[0]?.id}`,
	role: 'assistant',
	toolCalls: calls.map(({ id, name, args }) => ({
		id,
		type: 'function',
		function: { name, arguments: args },
	})),
})
const deleteCall = (id: string, path: string) => ({
	id,
	name: 'delete_file',
	args: `{"path": "${path}"}`,
})

/** A 2b request with a fresh valid token, answered 200 with a stream. */
const runFrames = async (body: unknown) => {
	const response = await post(AGENT, { auth: await token(), body })
	expect(response.status).toBe(200)
	return framesOf(response)
}
const frameOf = (frames: Frame[], type: string) => frames.find(frame => frame.type === type)
const framesOfType = (frames: Frame[], type: string) => frames.filter(frame => frame.type === type)
/** The run's text, its deltas joined. */
const textOf = (frames: Frame[]) =>
	framesOfType(frames, 'TEXT_MESSAGE_CONTENT')
		.map(frame => frame.delta)
		.join('')
const outcomeOf = (frames: Frame[]) => frameOf(frames, 'RUN_FINISHED')?.outcome
const TEXT = ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']
const CALL = ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']

describe('the AG-UI stub agent’s human-in-the-loop scenarios (Part 2 spec §10, plan call P18)', () => {
	it('gated ends on Pydantic AI’s approval interrupt for its delete_file call', async () => {
		const frames = await runFrames(input('gated'))
		expect(typesOf(frames)).toEqual(['RUN_STARTED', ...TEXT, ...CALL, 'RUN_FINISHED'])
		const start = frameOf(frames, 'TOOL_CALL_START')!
		expect(start).toMatchObject({
			toolCallName: 'delete_file',
			parentMessageId: frameOf(frames, 'TEXT_MESSAGE_START')!.messageId,
		})
		expect(frameOf(frames, 'TOOL_CALL_ARGS')!.delta).toBe('{"path": "report.pdf"}')
		expect(outcomeOf(frames)).toEqual({
			type: 'interrupt',
			interrupts: [
				{
					id: `int-${start.toolCallId}`,
					reason: 'tool_call',
					message: 'Approve delete_file({"path": "report.pdf"})?',
					toolCallId: start.toolCallId,
					responseSchema: APPROVAL_SCHEMA,
				},
			],
		})
	})

	it('double ends on two approval interrupts, one per call, in call order', async () => {
		const frames = await runFrames(input('double'))
		const ids = framesOfType(frames, 'TOOL_CALL_START').map(frame => frame.toolCallId)
		expect(ids).toHaveLength(2)
		expect(outcomeOf(frames)).toMatchObject({
			type: 'interrupt',
			interrupts: [
				{
					id: `int-${ids[0]}`,
					toolCallId: ids[0],
					message: 'Approve delete_file({"path": "report.pdf"})?',
				},
				{
					id: `int-${ids[1]}`,
					toolCallId: ids[1],
					message: 'Approve delete_file({"path": "notes.txt"})?',
				},
			],
		})
	})

	it('a resumed approval answers the original call: approved, rejected with its reason, cancelled', async () => {
		const resumeGated = (entry: Record<string, unknown>) =>
			runFrames(
				input('gated', {
					after: [assistantWith(deleteCall('call-1', 'report.pdf'))],
					resume: [{ interruptId: 'int-call-1', ...entry }],
				}),
			)
		const approved = await resumeGated({ status: 'resolved', payload: { approved: true } })
		expect(typesOf(approved)).toEqual(['RUN_STARTED', 'TOOL_CALL_RESULT', ...TEXT, 'RUN_FINISHED'])
		expect(frameOf(approved, 'TOOL_CALL_RESULT')).toMatchObject({
			toolCallId: 'call-1',
			role: 'tool',
			content: 'Deleted report.pdf.',
		})
		expect(textOf(approved)).toBe('Done: report.pdf deleted.')
		const rejected = await resumeGated({
			status: 'resolved',
			payload: { approved: false, reason: 'Rejected by the user' },
		})
		expect(frameOf(rejected, 'TOOL_CALL_RESULT')?.content).toBe('Not deleted: Rejected by the user')
		expect(textOf(rejected)).toBe('Done: report.pdf kept.')
		const cancelled = await resumeGated({ status: 'cancelled' })
		expect(frameOf(cancelled, 'TOOL_CALL_RESULT')?.content).toBe('Not deleted: cancelled')
	})

	it('a resumed double answers both calls, and a resume that leaves one open is a RUN_ERROR', async () => {
		const after = [
			assistantWith(deleteCall('call-1', 'report.pdf'), deleteCall('call-2', 'notes.txt')),
		]
		const both = await runFrames(
			input('double', {
				after,
				resume: [
					{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
					{
						interruptId: 'int-call-2',
						status: 'resolved',
						payload: { approved: false, reason: 'Rejected by the user' },
					},
				],
			}),
		)
		expect(framesOfType(both, 'TOOL_CALL_RESULT').map(frame => frame.content)).toEqual([
			'Deleted report.pdf.',
			'Not deleted: Rejected by the user',
		])
		expect(textOf(both)).toBe('Done: report.pdf deleted, notes.txt kept.')
		const partial = await runFrames(
			input('double', {
				after,
				resume: [{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } }],
			}),
		)
		expect(typesOf(partial)).toEqual(['RUN_STARTED', 'RUN_ERROR'])
	})

	it('fragile refuses its first resume per thread with 422 before any stream, then answers it', async () => {
		const auth = await token()
		expect(outcomeOf(await runFrames(input('fragile')))).toMatchObject({ type: 'interrupt' })
		const resumeOn = (threadId: string) =>
			post(AGENT, {
				auth,
				body: input('fragile', {
					threadId,
					after: [assistantWith(deleteCall('call-1', 'report.pdf'))],
					resume: [{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } }],
				}),
			})
		const refused = await resumeOn('thread-fragile-1')
		expect(refused.status).toBe(422)
		expect(refused.headers.get('content-type')).toBe('application/json')
		const retried = await resumeOn('thread-fragile-1')
		expect(retried.status).toBe(200)
		expect(frameOf(await framesOf(retried), 'TOOL_CALL_RESULT')?.content).toBe(
			'Deleted report.pdf.',
		)
		// Another thread is refused once too.
		expect((await resumeOn('thread-fragile-2')).status).toBe(422)
	})

	it('question asks two questions through ask_user when it is offered, and says so when it is not', async () => {
		const frames = await runFrames(input('question', { tools: [ASK_USER_TOOL] }))
		expect(typesOf(frames)).toEqual(['RUN_STARTED', ...TEXT, ...CALL, 'RUN_FINISHED'])
		const start = frameOf(frames, 'TOOL_CALL_START')!
		expect(start.toolCallName).toBe('ask_user')
		expect(JSON.parse(String(frameOf(frames, 'TOOL_CALL_ARGS')!.delta))).toEqual({
			questions: [
				{ question: 'Which city?', options: ['Paris', 'Rome'] },
				{ question: 'Which month?' },
			],
		})
		// AG-UI 1.0 "Tool calls", Frontend tools: the success outcome names the call left pending.
		expect(outcomeOf(frames)).toEqual({ type: 'success', pendingToolCallIds: [start.toolCallId] })
		const unoffered = await runFrames(input('question'))
		expect(typesOf(unoffered)).toEqual(['RUN_STARTED', ...TEXT, 'RUN_FINISHED'])
		expect(textOf(unoffered)).toBe('No ask_user tool was offered, so I cannot ask you.')
	})

	it('badquestion calls ask_user with no questions', async () => {
		const frames = await runFrames(input('badquestion', { tools: [ASK_USER_TOOL] }))
		expect(frameOf(frames, 'TOOL_CALL_START')?.toolCallName).toBe('ask_user')
		expect(JSON.parse(String(frameOf(frames, 'TOOL_CALL_ARGS')!.delta))).toEqual({ questions: [] })
	})

	it('reads the answers to an ask_user call back, and says when the question was dismissed', async () => {
		const asked = assistantWith({ id: 'call-q', name: 'ask_user', args: '{"questions": []}' })
		const answered = await runFrames(
			input('question', {
				tools: [ASK_USER_TOOL],
				after: [
					asked,
					{
						id: 'tool-1',
						role: 'tool',
						toolCallId: 'call-q',
						content: 'Q: Which city?\nA: Paris\n\nQ: Which month?\nA: May',
					},
				],
			}),
		)
		expect(textOf(answered)).toBe(
			'Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May',
		)
		const dismissed = await runFrames(
			input('badquestion', {
				tools: [ASK_USER_TOOL],
				after: [
					asked,
					{
						id: 'tool-1',
						role: 'tool',
						toolCallId: 'call-q',
						content: 'The questions did not match the parameters of the ask_user tool.',
						error: 'invalid_arguments',
					},
				],
			}),
		)
		expect(textOf(dismissed)).toBe('The question was dismissed.')
	})

	it('form ends on the quarterly filing interrupt; its resume is filed or cancelled', async () => {
		const frames = await runFrames(input('form'))
		expect(outcomeOf(frames)).toEqual({
			type: 'interrupt',
			interrupts: [
				{
					id: expect.stringMatching(/^int-/),
					reason: 'input_required',
					message: 'Please provide the quarterly filing details.',
					responseSchema: {
						type: 'object',
						properties: {
							quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
							year: { type: 'integer', minimum: 2000 },
							revenue: { type: 'number' },
						},
						required: ['quarter', 'year', 'revenue'],
					},
				},
			],
		})
		const payload = { quarter: 'Q2', year: 2026, revenue: 1250 }
		const filed = await runFrames(
			input('form', { resume: [{ interruptId: 'int-form', status: 'resolved', payload }] }),
		)
		expect(textOf(filed)).toBe('Filed: {"quarter":"Q2","year":2026,"revenue":1250}')
		const cancelled = await runFrames(
			input('form', { resume: [{ interruptId: 'int-form', status: 'cancelled' }] }),
		)
		expect(textOf(cancelled)).toBe('The form was cancelled.')
	})

	it('confirm ends on a confirmation without a schema; its resume carries the boolean', async () => {
		const frames = await runFrames(input('confirm'))
		expect(outcomeOf(frames)).toEqual({
			type: 'interrupt',
			interrupts: [
				{
					id: expect.stringMatching(/^int-/),
					reason: 'confirmation',
					message: 'Archive the old reports?',
				},
			],
		})
		for (const answer of [true, false]) {
			const resumed = await runFrames(
				input('confirm', {
					resume: [{ interruptId: 'int-1', status: 'resolved', payload: answer }],
				}),
			)
			expect(textOf(resumed)).toBe(`Confirmed: ${answer}`)
		}
	})

	it('expired ends on an interrupt already past its expiresAt; its resume says it expired', async () => {
		const outcome = outcomeOf(await runFrames(input('expired'))) as {
			interrupts: { reason: string; expiresAt: string }[]
		}
		expect(outcome.interrupts).toHaveLength(1)
		expect(outcome.interrupts[0]?.reason).toBe('input_required')
		expect(Date.parse(outcome.interrupts[0]!.expiresAt)).toBeLessThan(Date.now())
		const resumed = await runFrames(
			input('expired', { resume: [{ interruptId: 'int-1', status: 'cancelled' }] }),
		)
		expect(textOf(resumed)).toBe('The request expired.')
	})

	it('plan sends its steps as a snapshot and two deltas; finish plan completes the state it is given', async () => {
		const plan = await runFrames(input('plan'))
		expect(typesOf(plan)).toEqual([
			'RUN_STARTED',
			'STATE_SNAPSHOT',
			'STATE_DELTA',
			...TEXT,
			'RUN_FINISHED',
		])
		expect(frameOf(plan, 'STATE_SNAPSHOT')?.snapshot).toEqual({
			steps: [
				{ description: 'Gather the sources', status: 'pending' },
				{ description: 'Draft the summary', status: 'pending' },
				{ description: 'Review the draft', status: 'pending' },
			],
		})
		expect(framesOfType(plan, 'STATE_DELTA')).toHaveLength(2)
		const finished = await runFrames(
			input('finish plan', {
				state: {
					note: 'kept',
					steps: [
						{ description: 'One', status: 'completed' },
						{ description: 'Two', status: 'in_progress' },
					],
				},
			}),
		)
		expect(frameOf(finished, 'STATE_SNAPSHOT')?.snapshot).toEqual({
			note: 'kept',
			steps: [
				{ description: 'One', status: 'completed' },
				{ description: 'Two', status: 'completed' },
			],
		})
		expect(textOf(finished)).toBe('Every step of the plan is done.')
	})

	it('activity sends a progress snapshot and three deltas, then text', async () => {
		const frames = await runFrames(input('activity'))
		expect(typesOf(frames)).toEqual([
			'RUN_STARTED',
			'ACTIVITY_SNAPSHOT',
			'ACTIVITY_DELTA',
			...TEXT,
			'RUN_FINISHED',
		])
		expect(frameOf(frames, 'ACTIVITY_SNAPSHOT')).toMatchObject({
			activityType: 'progress',
			content: { label: 'Indexing', done: 0, total: 3 },
		})
		expect(framesOfType(frames, 'ACTIVITY_DELTA').map(frame => frame.patch)).toEqual(
			[1, 2, 3].map(done => [{ op: 'replace', path: '/done', value: done }]),
		)
	})

	it('is read by @ag-ui/client without a protocol error, approval resume included', async () => {
		const auth = await token()
		const agentFor = (text: string) =>
			new HttpAgent({
				url: `${base}${AGENT}`,
				headers: { Authorization: `Bearer ${auth}` },
				threadId: `thread-client-${text}`,
				initialMessages: [{ id: `user-${text}`, role: 'user', content: text }],
			})
		// An approval and its resume on one agent, as the hub's runs continue a thread (spec §6.1).
		const gated = agentFor('gated')
		await gated.runAgent({ runId: 'run-gated-1' })
		expect(gated.pendingInterrupts).toHaveLength(1)
		const [interrupt] = gated.pendingInterrupts
		const { newMessages } = await gated.runAgent({
			runId: 'run-gated-2',
			resume: buildResumeArray(gated.pendingInterrupts, {
				[interrupt!.id]: { status: 'resolved', payload: { approved: true } },
			}),
		})
		expect(newMessages.map((message: Message) => message.role)).toEqual(['tool', 'assistant'])
		// The question's call, the plan's state after its deltas, the activity's content after its deltas.
		const question = agentFor('question')
		const asked = await question.runAgent({ runId: 'run-question', tools: [ASK_USER_TOOL] })
		const caller = asked.newMessages[0] as Extract<Message, { role: 'assistant' }>
		expect(caller.toolCalls?.[0]?.function.name).toBe('ask_user')
		const plan = agentFor('plan')
		await plan.runAgent({ runId: 'run-plan' })
		expect(plan.state).toEqual({
			steps: [
				{ description: 'Gather the sources', status: 'completed' },
				{ description: 'Draft the summary', status: 'in_progress' },
				{ description: 'Review the draft', status: 'pending' },
			],
		})
		const activity = await agentFor('activity').runAgent({ runId: 'run-activity' })
		expect(
			activity.newMessages.find((message: Message) => message.role === 'activity'),
		).toMatchObject({ activityType: 'progress', content: { label: 'Indexing', done: 3, total: 3 } })
	})
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` Expected: FAIL, `Tests  14 failed | 7 passed (21)`: every 2b prompt still falls through to 2a's default scenario (e.g. `gated`: the types are the reasoning and text events, not `TOOL_CALL_START`; `fragile`: 200 where 422 is expected).

- [ ] **Step 4: Give each stub app its `askUser` and seed it**

In `e2e/fixtures/stub/agui-apps.ts`, replace

```ts
	/** The last path segment of the agent URL, as the owner's service names agents (`<base>/agents/<name>`). */
	agent: string
}
```

with

```ts
	/** The last path segment of the agent URL, as the owner's service names agents (`<base>/agents/<name>`). */
	agent: string
	/** The app's `askUser` switch (Part 2 spec §6.2; plan call P18): while it is on, its runs advertise ask_user. */
	askUser: boolean
}
```

then add `askUser: true,` after `agent: 'assistant',` in `AGUI_APP`, and `askUser: false,` after `agent: 'missing',` in `AGUI_MISSING_APP`:

```ts
export const AGUI_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a1',
	name: 'Stub AG-UI agent',
	agent: 'assistant',
	askUser: true,
}

export const AGUI_MISSING_APP: StubAguiApp = {
	id: 'e2e00000-0000-4000-8000-0000000000a2',
	name: 'Stub AG-UI missing',
	agent: 'missing',
	askUser: false,
}
```

In `e2e/auth.setup.ts`, replace

```ts
// Part 2 spec §10: two AG-UI apps on the stub agent (plan call P14), open to everyone like the stub apps. The
// documents are the AG-UI provider's (spec §2.2): the agent's URL, the JWT audience and the shared secret.
```

with

```ts
// Part 2 spec §10: two AG-UI apps on the stub agent (plan call P14), open to everyone like the stub apps. The
// documents are the AG-UI provider's (spec §2.2): the agent's URL, the JWT audience, the `askUser` switch (2b's
// plan call P18: on for the agent that answers) and the shared secret.
```

and, in the same loop, replace

```ts
						JSON.stringify({
							agentUrl: aguiAgentUrl(stubPort, app.agent),
							audience: STUB_AGUI_AUDIENCE,
						}),
```

with

```ts
						JSON.stringify({
							agentUrl: aguiAgentUrl(stubPort, app.agent),
							audience: STUB_AGUI_AUDIENCE,
							askUser: app.askUser,
						}),
```

The `ON CONFLICT … DO UPDATE SET settings = EXCLUDED.settings` already in that statement rewrites the document on a database that survives between runs. `e2e/agui-admin.spec.ts`'s own seeded apps write no `askUser`, which Task 1's zod default reads as `false`.

- [ ] **Step 5: The scenarios**

In `e2e/fixtures/stub/agui.ts`, replace the first `@ag-ui/core` import

```ts
import { EventType, type Event } from '@ag-ui/core'
```

with

```ts
import { EventType, type Event, type Interrupt, type RunFinishedOutcome } from '@ag-ui/core'
```

and, after `import { STUB_AGUI_AGENT, STUB_AGUI_AUDIENCE } from './agui-apps'`, add

```ts
import { hasWord } from './scenarios'
```

In the header comment, replace

```ts
 * Errors). Scenarios are picked by the last user text, as the Dify stub's are: the default (reasoning and Markdown
 * text), `tool`, `error <code>`, `timeout`, `slow` and `invalid`.
 */
```

with

```ts
 * Errors). Scenarios are picked by the last user text, as the Dify stub's are: the default (reasoning and Markdown
 * text), `tool`, `error <code>`, `timeout`, `slow` and `invalid`; 2b's human-in-the-loop scenarios (HITL_KEYWORDS) are
 * checked first.
 */
```

Replace

```ts
/** The parsed input's messages (zod 4 "Type inference": `z.output<typeof schema>`). */
type Messages = z.output<typeof RunAgentInputSchema>['messages']
```

with

```ts
/** The parsed input and its messages (zod 4 "Type inference": `z.output<typeof schema>`). */
type RunInput = z.output<typeof RunAgentInputSchema>
type Messages = RunInput['messages']
```

Insert this block between `planFor`'s closing `}` and the doc comment above `streamEvents` (it begins "Writes the events one by one with `EventEncoder.encodeSSE`"):

```ts
/*
 * Part 2b's scenarios (spec §6, §10; plan call P18): human in the loop. Each is picked by a keyword that is a whole word
 * of the last user text (the Dify stub's `hasWord`), tried in this order before 2a's scenarios; no 2a prompt holds one.
 * An answering run carries no user message (spec §4.2), so its last user text is still the prompt that asked.
 */
const HITL_KEYWORDS = [
	'gated',
	'double',
	'fragile',
	'badquestion',
	'question',
	'form',
	'confirm',
	'expired',
	'finish',
	'plan',
	'activity',
] as const
type HitlKeyword = (typeof HITL_KEYWORDS)[number]

/** The hub's own frontend tool (spec §6.2), by the name the hub advertises it under in `RunAgentInput.tools`. */
const ASK_USER = 'ask_user'
/** The gated tool: Pydantic AI's `requires_approval` example (agui-spike.md, Findings › Agent side). */
const GATED_TOOL = 'delete_file'
/** Pydantic AI's approval schema, as the spike recorded it: `approved` required, `editedArgs` and `reason` optional. */
const APPROVAL_SCHEMA = {
	type: 'object',
	properties: {
		approved: { type: 'boolean' },
		editedArgs: { type: 'object' },
		reason: { type: 'string' },
	},
	required: ['approved'],
}
/** The `question` scenario's arguments, in the template's shape (spec §6.2): one question with options, one without. */
const QUESTIONS = {
	questions: [
		{ question: 'Which city?', options: ['Paris', 'Rome'] },
		{ question: 'Which month?' },
	],
}
const PLAN_STEPS = ['Gather the sources', 'Draft the summary', 'Review the draft']

/** The threads whose `fragile` resume was refused once: the hub keeps the answers open (decision 62), and a retry passes. */
const refusedOnce = new Set<string>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/** A 2b run: RUN_STARTED, its events, and RUN_FINISHED with the outcome given. */
const hitlRun = (
	input: RunInput,
	events: Event[],
	outcome: RunFinishedOutcome = { type: 'success' },
): Plan => ({
	events: [
		{
			type: EventType.RUN_STARTED,
			threadId: input.threadId,
			runId: input.runId,
			protocolVersion: '1.0',
		},
		...events,
		{ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId, outcome },
	],
	delayMs: WORD_DELAY_MS,
})

/**
 * AG-UI concepts › Interrupts, Error handling: "A resume references an `interruptId` the agent cannot correlate" or
 * "fails to address every open interrupt" → RUN_ERROR.
 */
const resumeError = (input: RunInput, message: string): Plan => ({
	events: [
		{
			type: EventType.RUN_STARTED,
			threadId: input.threadId,
			runId: input.runId,
			protocolVersion: '1.0',
		},
		{ type: EventType.RUN_ERROR, code: 'agent_error', message },
	],
	delayMs: WORD_DELAY_MS,
})

/**
 * Calls to the gated tool, left without a result, and the run's end on one approval interrupt per call in Pydantic AI's
 * exact shape (agui-spike.md, Findings › Agent side): `int-<toolCallId>`, reason `tool_call`, "Approve <tool>(<args>)?",
 * the call's id and the approval schema. The result comes from the resumed run (AG-UI "Tool-bound interrupts").
 */
const gatedRun = (input: RunInput, paths: readonly string[]): Plan => {
	const messageId = randomUUID()
	const calls = paths.map(path => ({
		toolCallId: `call-${randomUUID()}`,
		args: `{"path": "${path}"}`,
	}))
	return hitlRun(
		input,
		[
			...textMessage(`I need your approval to delete ${paths.join(' and ')}.`, messageId),
			...calls.flatMap(({ toolCallId, args }): Event[] => [
				{
					type: EventType.TOOL_CALL_START,
					toolCallId,
					toolCallName: GATED_TOOL,
					parentMessageId: messageId,
				},
				{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: args },
				{ type: EventType.TOOL_CALL_END, toolCallId },
			]),
		],
		{
			type: 'interrupt',
			interrupts: calls.map(({ toolCallId, args }) => ({
				id: `int-${toolCallId}`,
				reason: 'tool_call',
				message: `Approve ${GATED_TOOL}(${args})?`,
				toolCallId,
				responseSchema: APPROVAL_SCHEMA,
			})),
		},
	)
}

/**
 * A call to the hub's ask_user tool, left unanswered: a frontend tool's run ends with the success outcome, whose
 * `pendingToolCallIds` names the call (AG-UI 1.0 "Tool calls", Frontend tools: the producer "MUST NOT answer it" and
 * "SHOULD send it"). A producer "SHOULD call frontend tools only from the advertised list", so without ask_user in
 * `tools` the stub says so instead.
 */
const askUserRun = (input: RunInput, args: unknown): Plan => {
	if (!input.tools.some(tool => tool.name === ASK_USER))
		return hitlRun(input, textMessage('No ask_user tool was offered, so I cannot ask you.'))
	const messageId = randomUUID()
	const toolCallId = `call-${randomUUID()}`
	return hitlRun(
		input,
		[
			...textMessage('I need a few answers before I go on.', messageId),
			{
				type: EventType.TOOL_CALL_START,
				toolCallId,
				toolCallName: ASK_USER,
				parentMessageId: messageId,
			},
			{ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(args) },
			{ type: EventType.TOOL_CALL_END, toolCallId },
		],
		{ type: 'success', pendingToolCallIds: [toolCallId] },
	)
}

/** One interrupt that is not bound to a tool call (AG-UI concepts › Interrupts, reason taxonomy), after a text. */
const interruptRun = (input: RunInput, text: string, interrupt: Omit<Interrupt, 'id'>): Plan =>
	hitlRun(input, textMessage(text), {
		type: 'interrupt',
		interrupts: [{ id: `int-${randomUUID()}`, ...interrupt }],
	})

/** The plan as Pydantic AI's example sends it (spec §6.4): a snapshot of pending steps, then JSON Patch deltas. */
const planRun = (input: RunInput): Plan =>
	hitlRun(input, [
		{
			type: EventType.STATE_SNAPSHOT,
			snapshot: { steps: PLAN_STEPS.map(description => ({ description, status: 'pending' })) },
		},
		{
			type: EventType.STATE_DELTA,
			delta: [{ op: 'replace', path: '/steps/0/status', value: 'in_progress' }],
		},
		{
			type: EventType.STATE_DELTA,
			delta: [
				{ op: 'replace', path: '/steps/0/status', value: 'completed' },
				{ op: 'replace', path: '/steps/1/status', value: 'in_progress' },
			],
		},
		...textMessage('I made a plan and finished its first step.'),
	])

/** Completes the plan in the state the hub sends back (spec §3.3: the conversation's last state), else the stub's own. */
const finishRun = (input: RunInput): Plan => {
	const state = isRecord(input.state) ? input.state : {}
	const sent = (Array.isArray(state.steps) ? state.steps : []).flatMap(step =>
		isRecord(step) && typeof step.description === 'string' ? [step.description] : [],
	)
	const steps = (sent.length ? sent : PLAN_STEPS).map(description => ({
		description,
		status: 'completed',
	}))
	return hitlRun(input, [
		{ type: EventType.STATE_SNAPSHOT, snapshot: { ...state, steps } },
		...textMessage('Every step of the plan is done.'),
	])
}

/** The spike's activity scenario (Appendix B): a `progress` snapshot, then three deltas to done 3 of 3. */
const activityRun = (input: RunInput): Plan => {
	const messageId = randomUUID()
	return hitlRun(input, [
		{
			type: EventType.ACTIVITY_SNAPSHOT,
			messageId,
			activityType: 'progress',
			content: { label: 'Indexing', done: 0, total: 3 },
		},
		...[1, 2, 3].map(
			(done): Event => ({
				type: EventType.ACTIVITY_DELTA,
				messageId,
				activityType: 'progress',
				patch: [{ op: 'replace', path: '/done', value: done }],
			}),
		),
		...textMessage('Indexing finished.'),
	])
}

/** The first run of each 2b scenario. */
const FIRST_RUNS: Record<HitlKeyword, (input: RunInput) => Plan> = {
	gated: input => gatedRun(input, ['report.pdf']),
	double: input => gatedRun(input, ['report.pdf', 'notes.txt']),
	fragile: input => gatedRun(input, ['report.pdf']),
	badquestion: input => askUserRun(input, { questions: [] }),
	question: input => askUserRun(input, QUESTIONS),
	// AG-UI concepts › Interrupts, "Non-tool input request" (its `expiresAt` left out: the example's date has passed).
	form: input =>
		interruptRun(input, 'I need the filing details first.', {
			reason: 'input_required',
			message: 'Please provide the quarterly filing details.',
			responseSchema: {
				type: 'object',
				properties: {
					quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
					year: { type: 'integer', minimum: 2000 },
					revenue: { type: 'number' },
				},
				required: ['quarter', 'year', 'revenue'],
			},
		}),
	// Reason taxonomy: `confirmation`, "`responseSchema` optional; boolean default".
	confirm: input =>
		interruptRun(input, 'I want to check one thing.', {
			reason: 'confirmation',
			message: 'Archive the old reports?',
		}),
	expired: input =>
		interruptRun(input, 'I needed a slot a minute ago.', {
			reason: 'input_required',
			message: 'Pick a delivery slot.',
			responseSchema: {
				type: 'object',
				properties: { slot: { type: 'string', enum: ['Morning', 'Evening'] } },
				required: ['slot'],
			},
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
		}),
	finish: finishRun,
	plan: planRun,
	activity: activityRun,
}

/** The path a gated call's arguments name. */
const pathOf = (args: string): string => {
	try {
		const parsed: unknown = JSON.parse(args)
		return isRecord(parsed) && typeof parsed.path === 'string' ? parsed.path : 'the file'
	} catch {
		return 'the file'
	}
}

/**
 * The resumed run of an approval scenario: a TOOL_CALL_RESULT on each open gated call (one in the input's assistant
 * messages that no tool message answers), then a text (AG-UI "Tool-bound interrupts": "it emits `ToolCallResult` against
 * the original `toolCallId`"). Pydantic AI answers a denial with its reason as the result (spike, Agent side). The
 * resume must address every open call ("Cover all open interrupts").
 */
const approvalResults = (input: RunInput): Plan => {
	const answered = new Set(
		input.messages.flatMap(message => (message.role === 'tool' ? [message.toolCallId] : [])),
	)
	const open = input.messages.flatMap(message =>
		message.role === 'assistant'
			? (message.toolCalls ?? []).filter(
					call => call.function.name === GATED_TOOL && !answered.has(call.id),
				)
			: [],
	)
	const entries = new Map((input.resume ?? []).map(entry => [entry.interruptId, entry]))
	const decided = open.flatMap(call => {
		const entry = entries.get(`int-${call.id}`)
		return entry ? [{ call, entry }] : []
	})
	if (decided.length === 0 || decided.length !== open.length)
		return resumeError(input, 'The resume did not answer every open approval.')
	const results = decided.map(({ call, entry }) => {
		const path = pathOf(call.function.arguments)
		const payload = entry.status === 'resolved' && isRecord(entry.payload) ? entry.payload : {}
		const approved = payload.approved === true
		const reason = typeof payload.reason === 'string' ? payload.reason : 'cancelled'
		return {
			toolCallId: call.id,
			outcome: `${path} ${approved ? 'deleted' : 'kept'}`,
			content: approved ? `Deleted ${path}.` : `Not deleted: ${reason}`,
		}
	})
	return hitlRun(input, [
		...results.map(
			({ toolCallId, content }): Event => ({
				type: EventType.TOOL_CALL_RESULT,
				messageId: randomUUID(),
				toolCallId,
				role: 'tool',
				content,
			}),
		),
		...textMessage(`Done: ${results.map(result => result.outcome).join(', ')}.`),
	])
}

/**
 * A run that carries `resume` (AG-UI concepts › Interrupts, "Resuming a run"), answered by the scenario that asked.
 * `fragile` refuses its first resume per thread with a plain 422 before any stream (spec §4.3 step 4), the case decision
 * 62 keeps the items open for (#67).
 */
const resumedRun = (input: RunInput, keyword: HitlKeyword): Plan => {
	const [entry] = input.resume ?? []
	switch (keyword) {
		case 'fragile':
			if (refusedOnce.has(input.threadId)) return approvalResults(input)
			refusedOnce.add(input.threadId)
			return { refuse: true }
		case 'gated':
		case 'double':
			return approvalResults(input)
		case 'form':
			return hitlRun(
				input,
				textMessage(
					entry?.status === 'resolved'
						? `Filed: ${JSON.stringify(entry.payload)}`
						: 'The form was cancelled.',
				),
			)
		case 'confirm':
			return hitlRun(
				input,
				textMessage(
					entry?.status === 'resolved'
						? `Confirmed: ${JSON.stringify(entry.payload)}`
						: 'The confirmation was cancelled.',
				),
			)
		case 'expired':
			return hitlRun(input, textMessage('The request expired.'))
		default:
			return resumeError(input, 'Nothing in this thread waits for an answer.')
	}
}

/**
 * The tool message the input ends with when it answers an ask_user call: the answers the hub wrote (spec §6.2; the
 * hub places each tool message right after the call it answers, lib/chat/thread.ts).
 */
const askUserAnswerOf = (messages: Messages) => {
	const last = messages.at(-1)
	if (last?.role !== 'tool') return undefined
	const asked = messages.some(
		message =>
			message.role === 'assistant' &&
			(message.toolCalls ?? []).some(
				call => call.id === last.toolCallId && call.function.name === ASK_USER,
			),
	)
	return asked ? last : undefined
}

/** 2b's plan for a run, or null when no 2b scenario applies (then 2a's planFor decides). */
const hitlPlanFor = (input: RunInput): Plan | null => {
	const answer = askUserAnswerOf(input.messages)
	if (answer) {
		const content =
			typeof answer.content === 'string'
				? answer.content
				: answer.content.map(part => (part.type === 'text' ? part.text : '')).join('')
		// A dismissed invalid question is answered by the hub with an `error` (plan call P3).
		return hitlRun(
			input,
			textMessage(
				answer.error === undefined
					? `Got your answers: ${content.replace(/\n+/g, ' / ')}`
					: 'The question was dismissed.',
			),
		)
	}
	const text = lastUserText(input.messages)
	const keyword = HITL_KEYWORDS.find(word => hasWord(text, word))
	if (!keyword) return null
	return input.resume?.length ? resumedRun(input, keyword) : FIRST_RUNS[keyword](input)
}
```

In `handleAgui`, replace

```ts
const plan = planFor(threadId, runId, lastUserText(messages))
```

with

```ts
const plan = hitlPlanFor(parsed.data) ?? planFor(threadId, runId, lastUserText(messages))
```

`hitlPlanFor` answers null for every 2a prompt, so 2a's scenarios, refusals and their order are untouched; a 2b plan's `{ refuse: true }` (the `fragile` retry case) takes 2a's existing 422 path.

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/stub-agui.test.ts` Expected: PASS, `Tests  21 passed (21)`, and no `[ag-ui]` warning in the output (the client strips nothing from these events). If the `HttpAgent` case fails with a verification error, read the message (it names the event and the rule) and fix the scenario's event shape against the 1.0 typings, never the test.

- [ ] **Step 7: Gates, and 2a's AG-UI chat with `ask_user` advertised**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts
pnpm exec oxfmt --check e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts
pnpm test
```

Expected: tsc exits 0; oxlint reports nothing; oxfmt "All matched files use the correct format"; vitest 0 failed. Then, with no `pnpm dev` running and nothing else on 5433 (one `next dev` per checkout; `pnpm test:db` shares the e2e PostgreSQL):

```bash
pnpm test:e2e e2e/agui-chat.spec.ts --project desktop-light
rm -rf .next/dev/types && pnpm exec next typegen
```

Expected: every test of `e2e/agui-chat.spec.ts` passes on `desktop-light`: the seed now turns `askUser` on for `AGUI_APP`, so each of 2a's runs advertises `ask_user` (Task 8), and the stub's 2a scenarios ignore it. The second line clears the stale route types an e2e run leaves (Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add e2e/fixtures/stub/agui.ts e2e/fixtures/stub/agui-apps.ts e2e/auth.setup.ts __tests__/stub-agui.test.ts
git commit -m "test(e2e): the AG-UI stub's human-in-the-loop scenarios

Part 2 spec §10 (2b) and plan call P18: approvals in Pydantic AI's shape
(gated, double, and fragile, whose first resume is refused before the
stream), ask_user questions (question, badquestion) and their answers,
input_required, confirmation and expired interrupts, plan state and an
activity. A resumed run is answered from the original prompt. The seed
turns askUser on for the stub agent that answers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["e2e/fixtures/stub/agui.ts", "e2e/fixtures/stub/agui-apps.ts", "e2e/auth.setup.ts", "__tests__/stub-agui.test.ts"], "verifyCommand": "pnpm exec vitest run --project unit __tests__/stub-agui.test.ts", "acceptanceCriteria": ["pnpm exec vitest run --project unit __tests__/stub-agui.test.ts reports 21 passed", "gated streams a text and a delete_file call {\"path\": \"report.pdf\"} under it and ends on one interrupt in Pydantic AI's shape (id int-<toolCallId>, reason tool_call, message Approve delete_file({\"path\": \"report.pdf\"})?, toolCallId, the approval responseSchema); double ends on two in call order", "A resumed approval answers the original call with Deleted report.pdf. / Not deleted: <reason> / Not deleted: cancelled, then Done: …; a resume that leaves an open call unanswered ends with RUN_ERROR; fragile's first resume per thread answers 422 with no stream, its second 200", "question with ask_user in tools calls ask_user with Which city? (Paris, Rome) and Which month? and ends success with pendingToolCallIds; without it only the no-tool text; badquestion calls ask_user with no questions; a closing ask_user tool message gets Got your answers: <lines joined by ' / '>, or The question was dismissed. when it has an error", "form, confirm and expired end on the quarterly filing, a schema-less confirmation and an already expired interrupt; their resumes answer Filed: <payload JSON> or The form was cancelled., Confirmed: true or false, and The request expired.", "plan sends three pending steps and two deltas to 1 of 3 done; finish plan completes the given state's steps and keeps its other keys; activity sends a progress snapshot and three deltas to done 3", "HttpAgent reads gated and its buildResumeArray resume, question, plan and activity without a protocol error", "AGUI_APP.askUser is true and AGUI_MISSING_APP.askUser false, seeded into settings; e2e/agui-chat.spec.ts passes on desktop-light"], "modelTier": "standard"}
```

---

### Task 17: The e2e specs for human in the loop

**Goal:** The Playwright suite proves 2b's "done when" (spec §12) against Task 16's stub scenarios on `desktop-light`, `desktop-dark` and `mobile-light`: approvals (approve, reject, two at once, a refused answer kept open), the `ask_user` card (an option, a free answer, Skip, Dismiss, a digit key, an invalid question), the `input_required` form, a confirmation, an expired interrupt, the plan panel, activity cards, a reload with something open, and the admin's "Ask the user" switch, with the composer blocked while anything is open.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §6 and §12 (2b: "approvals, `ask_user`, `input_required`, the plan panel and activity cards work against the stub …; the composer blocks while something is open"), §10 (the e2e list), decisions 50 and 62, plan calls P1, P3, P5, P6, P13, P15, P16 and P18, ADR-0010 (Playwright against `next dev` and the stub; web-first assertions; locators by role, placeholder and text). The idioms are 2a's `e2e/agui-chat.spec.ts` (`senderBox`, `stopButton`, `answers`, `send`, `top`, a new conversation per test through `?isNewCvst=1`, `/chat/<id>` reopening the newest one) and `e2e/agui-admin.spec.ts` (`ownId`, `seedAguiApp`, `openDrawer`, `rowById`, `dropApp`). At phone width Next's dev indicator (bottom-right, dev only) can cover controls near the Sender; ADR-0028's note of 2026-10-14 records it, and ADR-0010's "Patterns to avoid" rule out moving it for tests, so on `mobile-light` the cards' buttons are pressed from the keyboard (`activate`), as 2a's Stop test does. Each `activate` first waits for the button to be enabled: the cards' buttons are disabled while a request runs (Task 11's `disabled`), and `Locator.press` does not wait for that the way `click` does. Playwright docs (Context7 `/microsoft/playwright`): `page.on('request')` to count the answers' requests, `toBeChecked` on a `role="switch"` element (it reads `aria-checked`), `toHaveAttribute('aria-expanded', …)` on antd Collapse's header (`@rc-component/collapse` 1.2.0 `es/Panel.js`: `role: 'button'`, `aria-expanded`), `toHaveText` with an array for the Descriptions' rows.

**Texts this task asserts, and where they come from** (if a task changed one, change it here; the e2e rule of spec §8):

| Text | Key / source |
| --- | --- |
| `Approve`, `Reject`, `Expired`, `Dismiss` | `shared_chat.answer.approve`, `.reject`, `.expired`, `.dismiss` (Task 11) |
| `The agent asked an invalid question` | `shared_chat.ask_user.invalid` (Task 11, the turn's `ask_user` card) |
| `Question 1 of 2`, `Question 2 of 2` | `shared_chat.ask_user.progress`, "Question {{current}} of {{total}}" (Task 12) |
| `Skip`, `Dismiss questions`, `Type your own answer` | `shared_chat.ask_user.skip`, `.dismiss`, `.custom_placeholder` (Task 12) |
| `Submit`, `Cancel`, `Yes`, `No` | `shared_chat.interrupt.submit`, `.cancel`, `.yes`, `.no` (Task 13) |
| `The agent needs more information`, `The agent asks you to confirm` | `shared_chat.interrupt.title_input_required`, `.title_confirmation` (Task 13) |
| `Plan 1/3`, `Plan 3/3` | `shared_chat.plan.title`, "Plan {{done}}/{{total}}" (Task 14) |
| `Answer the agent above to continue.` | `shared_chat.answer_pending_hint` (Task 15) |
| `Ask the user` | `app_setting.ask_user` (Task 1) |
| `The agent refused the request` | `shared_chat.error.agent_rejected_input` (2a) |
| `Type a message`, `Stop loading`, `Edit app configuration`, `Update` | `chat.send_placeholder`, X Sender's locale, `app_setting.edit_title`, the drawer's button (2a and Part 1) |
| `Approve delete_file({"path": "report.pdf"})?`, `Deleted report.pdf.`, `Not deleted: Rejected by the user`, `Done: …`, `Paris`, `Got your answers: …`, `The question was dismissed.`, `Please provide the quarterly filing details.`, `Filed: …`, `The form was cancelled.`, `Archive the old reports?`, `Confirmed: true`, `Confirmed: false`, `The request expired.`, the three plan steps, `I made a plan and finished its first step.`, `progress`, `Indexing finished.`, `No ask_user tool was offered, so I cannot ask you.` | the stub's scenarios (Task 16, `e2e/fixtures/stub/agui.ts`) |

**What the specs rely on in Tasks 11–15's markup** (Step 1 checks each against the code as built; a difference is fixed in this spec's helpers or locators, never by loosening an assertion): the gated call's footer shows the interrupt's message and Approve and Reject, and a recorded decision replaces both buttons (Task 11); the result of a resumed call is in the card's collapsible body, opened by its title (`delete_file`); the `ask_user` card's options are clickable by their text (X `Prompts`), a digit key pressed on any control of the question (here its Skip button) picks that option (the template's `question-prompt.tsx`: the question's container handles the digit keys and holds Skip), the free answer is an `Input` that sends on Enter, and "Dismiss questions" is a button on every step, the invalid one included (Task 12); the interrupt card's fields are labelled by their property names, the enum as radios (Task 13); the plan panel is one Collapse panel above the composer, closed once complete (Task 14); the activity card is an antd `Card` titled with the type, its flat content as `Descriptions` rows (Task 14).

**Depends on:** Tasks 1, 8, 10–16.

**Files:**

- Create: `e2e/agui-hitl.spec.ts`
- Modify: `e2e/agui-admin.spec.ts` (one test: the "Ask the user" switch)
- Modify: `e2e/screenshots.spec.ts` (three page entries: `chat-agui-approval`, `chat-agui-question`, `chat-agui-plan`)

**Acceptance Criteria:**

- [ ] `pnpm test:e2e e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts` passes on `desktop-light`, `desktop-dark` and `mobile-light`, 0 failed (14 tests of `agui-hitl.spec.ts` and 3 of `agui-admin.spec.ts` per project).
- [ ] Approvals: `gated` shows the interrupt's message with Approve and Reject, disables the Sender and shows the hint; Approve gives "Deleted report.pdf." in the call's card and "Done: report.pdf deleted." in the same turn (one answer bubble), then the Sender is enabled and the hint gone; Reject gives "Not deleted: Rejected by the user"; `double` sends nothing after the first decision (the hint stays, one POST /runs so far) and exactly one request after the second, with both results; `fragile` shows "The agent refused the request" under the still-open approval, the Sender still blocked, and Approve again succeeds.
- [ ] `ask_user`: "Question 1 of 2" above the composer with the Sender blocked; "Paris" by a click and "May" typed with Enter give "Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May" and an enabled Sender; Skip then "May" gives "A: (skipped)" then "A: May"; "Dismiss questions" gives two "(skipped)"; the digit key 2 picks "Rome"; `badquestion` shows "The agent asked an invalid question", and "Dismiss questions" gives "The question was dismissed.".
- [ ] Interrupts: the `form` card ("The agent needs more information") takes Q2, 2026 and 1250 and Submit gives `Filed: {"quarter":"Q2","year":2026,"revenue":1250}`, Cancel "The form was cancelled."; `confirm` ("The agent asks you to confirm") Yes gives "Confirmed: true" and No "Confirmed: false"; `expired` shows "Expired" and no Submit, and Dismiss gives "The request expired.".
- [ ] State and activity: `plan` shows "Plan 1/3" expanded above the composer with the three steps and leaves the Sender enabled; `finish plan` shows "Plan 3/3" collapsed; `activity` shows a card titled "progress" whose rows read label Indexing, done 3, total 3.
- [ ] A reload with an open approval, and one with an open question, restores the card and the blocked Sender with its hint, and the restored card still answers.
- [ ] The admin: a seeded AG-UI app's chat answers `question` with "No ask_user tool was offered, so I cannot ask you."; its edit drawer's "Ask the user" switch is off, saves on, `apps.settings` holds `askUser: true`, and the next `question` shows "Question 1 of 2".
- [ ] `pnpm exec playwright test e2e/screenshots.spec.ts -g "chat-agui"` writes `chat-agui-approval-*.png`, `chat-agui-question-*.png` and `chat-agui-plan-*.png` for the three projects (beside 2a's `chat-agui-*.png`).
- [ ] tsc (which checks `e2e/`), oxlint and oxfmt are clean on the three files.

**Verify:** `pnpm test:e2e e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts` → the list reporter ends with `52 passed` (the `setup` project, 14 × 3 and 3 × 3) and no `failed` line; the whole suite runs in Task 19.

**Steps:**

- [ ] **Step 1: Read the cards as built and check the locators**

Read `components/shared-chat/approval-actions.tsx`, `tool-views.tsx` and `tool-chain.tsx` (Task 11), `ask-user-card.tsx` (Task 12), `interrupt-card.tsx` (Task 13), `plan-panel.tsx` and `activity-card.tsx` (Task 14), `shared-chat.tsx` and `assistant-turn.tsx` (Task 15), and the `shared_chat` and `app_setting` areas of `locales/en/translation.json`. Check each row of the two lists above against them: the English values, which control carries which text, where Approve and Reject sit (the item's `footer`), that the `ask_user` card sits in the dock above the Sender, that the digit keys reach the question's handler from its Skip button, and that the activity card's `Descriptions` renders one row per field. Where the code as built differs, adjust the matching helper or locator in Step 2 and say so in the task's close note.

- [ ] **Step 2: Write the human-in-the-loop spec**

Create `e2e/agui-hitl.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test'

import { AGUI_APP } from './fixtures/constants'

/*
 * Part 2 spec §6 and §12 (2b "done when") against Task 16's human-in-the-loop scenarios of the stub AG-UI producer
 * (ADR-0010; plan call P18): approvals, the hub's ask_user questions, the other interrupts, the plan panel and activity
 * cards, and the composer blocked while anything is open (decision 50). The seed turns AGUI_APP's `askUser` on, so its
 * runs advertise ask_user. Each prompt is a stub keyword (Task 16's table); `workers: 1` keeps one test on the stub at
 * a time, so `/chat/<id>` reopens the conversation the test made last (e2e/agui-chat.spec.ts).
 */

/** The Sender's box by its placeholder (`chat.send_placeholder`), which it keeps while disabled (Task 15). */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** X Sender's stop control, named by X's locale (as e2e/agui-chat.spec.ts). */
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop loading' })
/** The answers: Bubble.List's start-placed bubbles (the assistant role), as the 2a specs find them. */
const answers = (page: Page) => page.locator('.ant-bubble-start')
/** Plan call P15 (#69): the visible line above the Sender while an answer is pending. */
const hint = (page: Page) => page.getByText('Answer the agent above to continue.')
/** The free answer of the ask_user card (Task 12, `shared_chat.ask_user.custom_placeholder`). */
const freeAnswer = (page: Page) => page.getByPlaceholder('Type your own answer')
const RUNS_PATH = /\/api\/apps\/[^/]+\/runs$/

const send = async (page: Page, text: string) => {
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
}

/** A vertical position on the page, for where a card sits (spec §6.2: above the composer). */
const top = async (locator: Locator) => (await locator.boundingBox())!.y

/**
 * Activates a button once it is enabled (the cards' buttons are disabled while a request runs: Task 11's `disabled`).
 * At phone width Next's dev indicator (bottom-right, dev only) can sit over the controls near the Sender; ADR-0028's
 * note and ADR-0010's "Patterns to avoid" rule out moving it for tests, so there the button is pressed from the
 * keyboard, which a real user can do, as 2a's Stop test does (Locator.press focuses the element, then presses the key).
 */
const activate = async (button: Locator, isMobile: boolean) => {
	await expect(button).toBeEnabled()
	if (isMobile) await button.press('Enter')
	else await button.click()
}

/** The POST /runs requests the page makes from now on (spec §4.2), to count what the answers send. */
const runRequests = (page: Page) => {
	const urls: string[] = []
	page.on('request', request => {
		if (request.method() === 'POST' && RUNS_PATH.test(new URL(request.url()).pathname))
			urls.push(request.url())
	})
	return urls
}

/** Opens each tool card's collapsible body by its title (ThoughtChain `collapsible`, as in e2e/agui-chat.spec.ts). */
const openToolCards = async (answer: Locator, name: string) => {
	for (const title of await answer.getByText(name, { exact: true }).all()) await title.click()
}

test.describe('human in the loop in the AG-UI chat', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await expect(senderBox(page)).toBeEnabled()
	})

	test('an approval blocks the composer; Approve runs the call and the agent goes on in the same turn', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'gated')
		const answer = answers(page).last()
		// Spec §6.1: Approve and Reject on the gated call's card, with the interrupt's message.
		await expect(answer.getByText('Approve delete_file({"path": "report.pdf"})?')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(answer.getByRole('button', { name: 'Approve' }), isMobile)
		await expect(answer.getByText('Done: report.pdf deleted.')).toBeVisible()
		// The resumed run continues the same turn (spec §6.1, onReload), and its result lands on the gated call's card.
		await expect(answers(page)).toHaveCount(1)
		await openToolCards(answer, 'delete_file')
		await expect(answer).toContainText('Deleted report.pdf.')
		await expect(answer.getByRole('button', { name: 'Approve' })).toHaveCount(0)
		await expect(senderBox(page)).toBeEnabled()
		await expect(hint(page)).toHaveCount(0)
	})

	test('Reject sends the schema’s reason, which the agent returns as the call’s result', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'gated')
		const answer = answers(page).last()
		await activate(answer.getByRole('button', { name: 'Reject' }), isMobile)
		await expect(answer.getByText('Done: report.pdf kept.')).toBeVisible()
		await openToolCards(answer, 'delete_file')
		// Plan call P5: the schema declares a string `reason`, so Reject adds REJECTED_REASON.
		await expect(answer).toContainText('Not deleted: Rejected by the user')
		await expect(senderBox(page)).toBeEnabled()
	})

	test('two approvals go back together, in one request, once both have a decision', async ({
		page,
		isMobile,
	}) => {
		const runs = runRequests(page)
		await send(page, 'double')
		const answer = answers(page).last()
		const approve = answer.getByRole('button', { name: 'Approve' })
		await expect(approve).toHaveCount(2)
		await expect(stopButton(page)).toHaveCount(0)
		expect(runs).toHaveLength(1)
		// Decision 62's third answer: the first decision is kept in the browser, and nothing is sent yet.
		await activate(approve.first(), isMobile)
		await expect(approve).toHaveCount(1)
		await expect(hint(page)).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		expect(runs).toHaveLength(1)
		await activate(answer.getByRole('button', { name: 'Reject' }), isMobile)
		await expect(answer.getByText('Done: report.pdf deleted, notes.txt kept.')).toBeVisible()
		// Exactly one request carried both answers (a request after the first decision would make it three).
		expect(runs).toHaveLength(2)
		await openToolCards(answer, 'delete_file')
		await expect(answer).toContainText('Deleted report.pdf.')
		await expect(answer).toContainText('Not deleted: Rejected by the user')
		await expect(senderBox(page)).toBeEnabled()
	})

	test('an answer the agent refuses before its stream keeps the approval open, and a retry goes through', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'fragile')
		const answer = answers(page).last()
		const approve = answer.getByRole('button', { name: 'Approve' })
		await activate(approve, isMobile)
		// Decision 62's first answer (#67): the refusal shows under the card, which stays answerable.
		const alert = answer.getByRole('alert')
		await expect(alert).toContainText('The agent refused the request')
		await expect(approve).toBeEnabled()
		expect(await top(alert)).toBeGreaterThan(await top(approve))
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(approve, isMobile)
		await expect(answer.getByText('Done: report.pdf deleted.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('the ask_user card above the composer takes an option and a free answer', async ({
		page,
	}) => {
		await send(page, 'question')
		const progress = page.getByText('Question 1 of 2')
		await expect(progress).toBeVisible()
		expect(await top(progress)).toBeLessThan(await top(senderBox(page)))
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		// Spec §6.2: the options as X Prompts, one click picks.
		await page.getByText('Paris').click()
		await expect(page.getByText('Question 2 of 2')).toBeVisible()
		await freeAnswer(page).fill('May')
		await freeAnswer(page).press('Enter')
		// The template's Q/A transcript reached the agent as the call's tool message (Task 16 echoes it, lines as " / ").
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May'),
		).toBeVisible()
		await expect(page.getByText(/^Question \d+ of \d+$/)).toHaveCount(0)
		await expect(senderBox(page)).toBeEnabled()
		await expect(hint(page)).toHaveCount(0)
	})

	test('Skip skips one question, and Dismiss skips the rest', async ({ page, isMobile }) => {
		await send(page, 'question')
		await activate(page.getByRole('button', { name: 'Skip' }), isMobile)
		await expect(page.getByText('Question 2 of 2')).toBeVisible()
		await freeAnswer(page).fill('May')
		await freeAnswer(page).press('Enter')
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: (skipped) / Q: Which month? / A: May'),
		).toBeVisible()

		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await send(page, 'question')
		await activate(page.getByRole('button', { name: 'Dismiss questions' }), isMobile)
		await expect(
			answers(page)
				.last()
				.getByText(
					'Got your answers: Q: Which city? / A: (skipped) / Q: Which month? / A: (skipped)',
				),
		).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('a digit key picks that option', async ({ page }) => {
		await send(page, 'question')
		await expect(page.getByText('Question 1 of 2')).toBeVisible()
		// The template's keyboard rule (question-prompt.tsx): a digit picks that option from anywhere in the question;
		// Locator.press focuses Skip first, and the key reaches the question's handler.
		await page.getByRole('button', { name: 'Skip' }).press('2')
		await expect(page.getByText('Question 2 of 2')).toBeVisible()
		await freeAnswer(page).fill('June')
		await freeAnswer(page).press('Enter')
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: Rome / Q: Which month? / A: June'),
		).toBeVisible()
	})

	test('an invalid question offers Dismiss, which the hub answers with an error', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'badquestion')
		const answer = answers(page).last()
		// Plan call P3: the call's arguments fail the schema; its card in the turn says so.
		await expect(answer.getByText('The agent asked an invalid question')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await activate(page.getByRole('button', { name: 'Dismiss questions' }), isMobile)
		await expect(answer.getByText('The question was dismissed.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('an input_required interrupt is a form: Submit sends its values, Cancel cancels it', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'form')
		let answer = answers(page).last()
		// Spec §6.3: a Card titled from the reason (Task 13 localises the core ones), with the interrupt's message.
		await expect(answer.getByText('The agent needs more information')).toBeVisible()
		await expect(answer.getByText('Please provide the quarterly filing details.')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		// Spec §6.3: enum → Radio.Group, integer and number → InputNumber, each labelled by its property.
		await answer.getByRole('radio', { name: 'Q2' }).check()
		await answer.getByLabel('year').fill('2026')
		await answer.getByLabel('revenue').fill('1250')
		await activate(answer.getByRole('button', { name: 'Submit' }), isMobile)
		await expect(
			answer.getByText('Filed: {"quarter":"Q2","year":2026,"revenue":1250}'),
		).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()

		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await send(page, 'form')
		answer = answers(page).last()
		await activate(answer.getByRole('button', { name: 'Cancel' }), isMobile)
		await expect(answer.getByText('The form was cancelled.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('a confirmation without a schema answers Yes or No as a boolean', async ({
		page,
		isMobile,
	}) => {
		for (const [button, value] of [
			['Yes', 'true'],
			['No', 'false'],
		]) {
			await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
			await send(page, 'confirm')
			const answer = answers(page).last()
			await expect(answer.getByText('The agent asks you to confirm')).toBeVisible()
			await expect(answer.getByText('Archive the old reports?')).toBeVisible()
			// Plan call P6: a confirmation without a responseSchema sends a bare boolean.
			await activate(answer.getByRole('button', { name: button, exact: true }), isMobile)
			await expect(answer.getByText(`Confirmed: ${value}`)).toBeVisible()
			await expect(senderBox(page)).toBeEnabled()
		}
	})

	test('an expired interrupt offers only Dismiss, which cancels it', async ({ page, isMobile }) => {
		await send(page, 'expired')
		const answer = answers(page).last()
		await expect(answer.getByText('Expired', { exact: true })).toBeVisible()
		await expect(answer.getByRole('button', { name: 'Submit' })).toHaveCount(0)
		await expect(senderBox(page)).toBeDisabled()
		await activate(answer.getByRole('button', { name: 'Dismiss', exact: true }), isMobile)
		await expect(answer.getByText('The request expired.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('the plan shows above the composer and closes once every step is done', async ({ page }) => {
		await send(page, 'plan')
		await expect(
			answers(page).last().getByText('I made a plan and finished its first step.'),
		).toBeVisible()
		// Spec §6.4: one Collapse panel headed "Plan 1/3" (antd's header is a button with aria-expanded).
		const panel = page.getByRole('button', { name: 'Plan 1/3' })
		await expect(panel).toHaveAttribute('aria-expanded', 'true')
		expect(await top(panel)).toBeLessThan(await top(senderBox(page)))
		for (const step of ['Gather the sources', 'Draft the summary', 'Review the draft'])
			await expect(page.getByText(step, { exact: true })).toBeVisible()
		// A plan blocks nothing.
		await expect(senderBox(page)).toBeEnabled()

		await send(page, 'finish plan')
		const done = page.getByRole('button', { name: 'Plan 3/3' })
		await expect(done).toBeVisible()
		await expect(done).toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByText('Gather the sources', { exact: true })).toBeHidden()
	})

	test('an activity shows as a read-only card in the turn', async ({ page }) => {
		await send(page, 'activity')
		const answer = answers(page).last()
		await expect(answer.getByText('Indexing finished.')).toBeVisible()
		// Spec §6.4: a Card titled with the activityType; a flat content as Descriptions, after its deltas (done 3 of 3).
		const card = answer
			.locator('.ant-card')
			.filter({ has: page.getByText('progress', { exact: true }) })
		await expect(card.getByRole('row')).toHaveText([/label\s*Indexing/, /done\s*3/, /total\s*3/])
	})

	test('a reload restores a waiting approval and a waiting question, with the Sender blocked', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'gated')
		await expect(answers(page).last().getByRole('button', { name: 'Approve' })).toBeVisible()
		// The run's end is stored before its stream closes (Task 10's settle), which ends X's request.
		await expect(stopButton(page)).toHaveCount(0)
		// Without ?isNewCvst the page opens the newest conversation: this one (spec §4.2).
		await page.goto(`/chat/${AGUI_APP.id}`)
		const approve = answers(page).last().getByRole('button', { name: 'Approve' })
		await expect(approve).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(approve, isMobile)
		await expect(answers(page).last().getByText('Done: report.pdf deleted.')).toBeVisible()

		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await send(page, 'question')
		await expect(page.getByText('Question 1 of 2')).toBeVisible()
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(page.getByText('Question 1 of 2')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(page.getByRole('button', { name: 'Dismiss questions' }), isMobile)
		await expect(
			answers(page)
				.last()
				.getByText(
					'Got your answers: Q: Which city? / A: (skipped) / Q: Which month? / A: (skipped)',
				),
		).toBeVisible()
	})
})
```

- [ ] **Step 3: The admin's switch**

In `e2e/agui-admin.spec.ts`, replace the end of the file

```ts
		} finally {
			await dropApp(id)
		}
	})
})
```

with

```ts
		} finally {
			await dropApp(id)
		}
	})

	// Part 2 spec §6.2 and plan calls P1 and P16: the switch is off by default, saves into the settings, and the next run
	// advertises ask_user only while it is on (the stub asks only when `tools` names it, Task 16).
	test('the Ask the user switch saves, and the chat offers ask_user only while it is on', async ({
		page,
	}, testInfo) => {
		const id = ownId(410, testInfo)
		await seedAguiApp(id, `AG-UI ask ${testInfo.project.name}`)
		try {
			await page.goto(`/chat/${id}?isNewCvst=1`)
			await senderBox(page).fill('question')
			await page.keyboard.press('Enter')
			await expect(
				page
					.locator('.ant-bubble-start')
					.last()
					.getByText('No ask_user tool was offered, so I cannot ask you.'),
			).toBeVisible()

			await page.goto('/app-management')
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
			await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), edit)
			// antd Switch is a button with role="switch" and aria-checked, named by its Form.Item label.
			const askUser = edit.getByRole('switch', { name: 'Ask the user' })
			await expect(askUser).not.toBeChecked()
			await askUser.click()
			await expect(askUser).toBeChecked()
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(edit).toBeHidden()
			const settings = await withDb(async db => {
				const { rows } = await db.query<{ settings: Record<string, unknown> }>(
					'SELECT settings FROM apps WHERE id = $1',
					[id],
				)
				return rows[0]?.settings
			})
			expect(settings).toMatchObject({ askUser: true })

			await page.goto(`/chat/${id}?isNewCvst=1`)
			await senderBox(page).fill('question')
			await page.keyboard.press('Enter')
			await expect(page.getByText('Question 1 of 2')).toBeVisible()
		} finally {
			await dropApp(id)
		}
	})
})
```

`ownId(410, …)` gives ids ending `…411`–`…413`, apart from the edit test's `…401`–`…403`. The seeded document has no `askUser`, which Task 1's zod default reads as `false`; the app and its conversations go with `dropApp` (ON DELETE CASCADE, spec §3.1), as in the edit test.

- [ ] **Step 4: The screenshots**

In `e2e/screenshots.spec.ts`, after the `chat-agui` entry of `signedInPages`, replace

```ts
			await page.getByText('get_weather', { exact: true }).click()
			await expect(page.getByText('Arguments', { exact: true })).toBeVisible()
		},
	},
}
```

with

```ts
			await page.getByText('get_weather', { exact: true }).click()
			await expect(page.getByText('Arguments', { exact: true })).toBeVisible()
		},
	},
	// Part 2b (spec §6.1): the stub's `gated` approval on its tool card, the Sender blocked with its hint.
	'chat-agui-approval': {
		path: `/chat/${AGUI_APP.id}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await senderBox(page).fill('gated')
			await page.keyboard.press('Enter')
			await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled()
			await expect(page.getByText('Answer the agent above to continue.')).toBeVisible()
		},
	},
	// Spec §6.2: the stub's `question` scenario, the ask_user card above the composer.
	'chat-agui-question': {
		path: `/chat/${AGUI_APP.id}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await senderBox(page).fill('question')
			await page.keyboard.press('Enter')
			await expect(page.getByText('Question 1 of 2')).toBeVisible()
			await expect(page.getByText('Paris')).toBeVisible()
		},
	},
	// Spec §6.4: the stub's `plan` scenario, the plan panel open above the composer.
	'chat-agui-plan': {
		path: `/chat/${AGUI_APP.id}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await senderBox(page).fill('plan')
			await page.keyboard.press('Enter')
			await expect(page.getByText('I made a plan and finished its first step.')).toBeVisible()
			await expect(page.getByRole('button', { name: 'Plan 1/3' })).toHaveAttribute(
				'aria-expanded',
				'true',
			)
			await expect(page.getByText('Review the draft', { exact: true })).toBeVisible()
		},
	},
}
```

- [ ] **Step 5: Gates on the three files**

Run:

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts e2e/screenshots.spec.ts
pnpm exec oxfmt --check e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts e2e/screenshots.spec.ts
pnpm exec playwright test --list e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts
```

Expected: tsc exits 0; oxlint reports nothing; oxfmt "All matched files use the correct format"; the list ends `Total: 52 tests in 3 files` (the `setup` project's one, 14 per project in `agui-hitl.spec.ts`, 3 per project in `agui-admin.spec.ts`).

- [ ] **Step 6: Run the specs on the three projects**

Stop `pnpm dev` first (one `next dev` per checkout), and make sure `pnpm test:db` is not running (both use 127.0.0.1:5433).

Run: `pnpm test:e2e e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts` Expected: `52 passed`, no `failed` line. A failure is debugged with the trace (`pnpm test:e2e:report`) and superpowers-extended-cc:systematic-debugging, never by loosening an assertion: each one is a 2b "done when" item. If a locator of Step 1's list misses because the markup differs, fix the locator; if the behaviour differs (for example a request after the first of two decisions, or a closed card after a refusal), the bug is in Tasks 10–15 and is fixed there in its own commit.

Then the screenshots: `pnpm exec playwright test e2e/screenshots.spec.ts -g "chat-agui"` Expected: passed for the four `chat-agui` entries on the three projects (with its `setup` dependency); look at the new `e2e/screenshots/chat-agui-{approval,question,plan}-*.png` (not committed) and keep them for the PR's review (frontend conventions §4.6). Then clear the stale route types an e2e run leaves (Global Constraints): `rm -rf .next/dev/types && pnpm exec next typegen`.

- [ ] **Step 7: Commit**

```bash
git add e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts e2e/screenshots.spec.ts
git commit -m "test(e2e): human in the loop in the AG-UI chat

Part 2 spec §6 and §12 (2b) against the stub's scenarios on three
projects: approve, reject, two approvals sent once, a refused answer
kept open; the ask_user card (option, free answer, Skip, Dismiss, a
digit key, an invalid question); a form, a confirmation and an expired
interrupt; the plan panel and an activity card; a reload with an open
item; the admin's Ask the user switch. Screenshots of the approval, the
question card and the plan panel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["e2e/agui-hitl.spec.ts", "e2e/agui-admin.spec.ts", "e2e/screenshots.spec.ts"], "verifyCommand": "pnpm test:e2e e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts", "acceptanceCriteria": ["pnpm test:e2e e2e/agui-hitl.spec.ts e2e/agui-admin.spec.ts passes on desktop-light, desktop-dark and mobile-light: 52 passed, 0 failed", "Approvals: gated blocks the Sender with the hint; Approve gives Deleted report.pdf. in the card and Done: report.pdf deleted. in the same bubble, then the Sender is enabled and the hint gone; Reject gives Not deleted: Rejected by the user; double sends nothing after the first decision and exactly one request after the second, with both results; fragile shows The agent refused the request under the still-open approval and Approve again succeeds", "ask_user: Question 1 of 2 above the composer with the Sender blocked; Paris by click and May with Enter give Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May; Skip and Dismiss questions give (skipped); the digit key 2 picks Rome; badquestion shows The agent asked an invalid question and Dismiss questions gives The question was dismissed.", "Interrupts: the form takes Q2, 2026, 1250 and Submit gives Filed: {\"quarter\":\"Q2\",\"year\":2026,\"revenue\":1250}, Cancel The form was cancelled.; confirm Yes gives Confirmed: true and No Confirmed: false; expired shows Expired, no Submit, and Dismiss gives The request expired.", "plan shows Plan 1/3 expanded above the composer with three steps and the Sender enabled; finish plan shows Plan 3/3 collapsed; activity shows a progress card with rows label Indexing, done 3, total 3", "A reload with an open approval and with an open question restores the card, the blocked Sender and the hint, and the card still answers", "Admin: Ask the user is off for a seeded app (question gets the no-tool text), saves on into apps.settings.askUser, and the next question shows Question 1 of 2", "playwright test e2e/screenshots.spec.ts -g chat-agui writes the approval, question and plan shots on the three projects", "tsc, oxlint and oxfmt clean on the three files"], "modelTier": "standard", "userGate": true, "tags": ["user-gate"]}
```

---

### Task 18: Records — the ADR notes, the agent authors' guide, AGENTS.md and Part 2's progress

**Goal:** Every record spec §11 names for 2b is in the branch: dated notes on ADR-0034 (`ask_user`, the interrupt answers, the plan state and activity cards), ADR-0033 (decision 62's store rule, `waiting`, answers that continue a turn) and ADR-0017 (#68's queued send, the answers through `onReload`, #67), `docs/agui-agents.md`'s three new sections and its `tools` line, AGENTS.md's Layout, spec §0's 2b row and Next line, and the running record's decision 64.

Spec §11 ("2b: notes on ADR-0034: `ask_user`, the interrupt answers, the plan state shape. `docs/agui-agents.md`: the same three"; "every slice: AGENTS.md's Layout, §0 of this spec, the running record"), spec §0's hand-off rules (decision 57). No new ADR: 2b adds no dependency and no pattern beyond what ADR-0017, ADR-0033 and ADR-0034 decided, and ADR-0015 asks for an ADR only then; the adr-skill's conventions ("Add learnings: append to `## More Information` with a date stamp. Do not rewrite history") are why each record gets a dated note at its end, in the style that record already uses: ADR-0033 and ADR-0034 end with `### Note, <date> (…)` headings, ADR-0017 with `Note, <date> (…):` paragraphs. `docs/frontend-conventions.md` needs no change: its §4.1 already names `components/shared-chat/` and `lib/chat/` (Part 2a). The running record's decisions 62 ("the owner's four answers") and 63 ("2b's plan is written") come from this plan's PR, so the build writes 64 here and 65 in Task 19.

**Files:**

- Modify: `docs/decisions/0034-add-ag-ui-agents-as-a-provider.md`, `docs/decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md`, `docs/decisions/0017-build-the-chat-on-ant-design-x.md` (a dated note each, at the end)
- Modify: `docs/agui-agents.md` (the settings table's "Ask the user" row; "Each request"'s body line; "Answering"'s list of what the hub shows; three new sections "Asking the user", "Interrupts", "State and activity" before "Stop and silence")
- Modify: `AGENTS.md` (Layout: the `components/` bullet's `shared-chat/` and the `lib/` bullet's `chat/`)
- Modify: `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` (§0: the 2b row and the Next line)
- Modify: `docs/superpowers/research/2026-10-11-provider-hub/README.md` (decision 64)

**Acceptance Criteria:**

- [ ] `grep -c "^### Note, $(date +%F) (Part 2b" docs/decisions/0033-*.md docs/decisions/0034-*.md` → `1` for each; `grep -c "^Note, $(date +%F) (Part 2b" docs/decisions/0017-*.md` → `1`.
- [ ] The ADR-0034 note names `ask_user`'s limits, the switch, the transcript and `invalid_arguments`, the approval payload rule with `Rejected by the user`, the bare boolean of a `confirmation`, the flat subset, the one resume and expiry, and the plan shape (`grep -c` for `invalid_arguments`, `Rejected by the user`, `minLength`, `isInterruptExpired`, `steps` in it → each ≥ 1).
- [ ] `docs/agui-agents.md` has the sections `## Asking the user`, `## Interrupts` and `## State and activity` (`grep -cE '^## (Asking the user|Interrupts|State and activity)$'` → `3`), no longer says `the hub advertises no tools yet` (→ `0`), and names `emit_interrupt_outcome`, `invalid_arguments`, `Rejected by the user` and `10,240` (each ≥ 1).
- [ ] `grep -c 'the plan state and the open items; ADR-0033, ADR-0034' AGENTS.md` → `1`; `grep -c 'interrupt, plan and activity cards; ADR-0033, ADR-0034' AGENTS.md` → `1`; `wc -l < AGENTS.md` stays below `200`.
- [ ] Spec §0's 2b row names this plan with the merged plan PR's number and `built: Tasks 1–17`; `grep -cE 'PLAN_PR|DEVIATIONS'` on the spec and the running record → `0` each; `grep -n '^64\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md` finds one line with today's date.
- [ ] `pnpm exec oxfmt --check` on the seven changed Markdown files reports no findings.

**Verify:** `grep -cE '^## (Asking the user|Interrupts|State and activity)$' docs/agui-agents.md && grep -c "(Part 2b" docs/decisions/0017-*.md docs/decisions/0033-*.md docs/decisions/0034-*.md && wc -l < AGENTS.md` → `3`, `1` for each of the three files, a number below 200

**Steps:**

- [ ] **Step 1: Read what the records describe**

Read, in this order: the three ADRs' last sections (`docs/decisions/0017-*.md` from "## More Information" to the end, `0033-*.md` and `0034-*.md` from "## Decision Outcome"), `docs/agui-agents.md`, the `adr-skill` (invoke it with the Skill tool: its conventions on appending dated learnings to an accepted record), `git log --oneline fork/overhaul..HEAD` (Tasks 1–17's commits, with their bodies: `git log --format='%h %s%n%b' fork/overhaul..HEAD`), and the files the notes name. Where a task deviated from this plan (its commit message, a ruling of the session that ran it, or a review fix says so), the records describe what was built, and the deviation is named in Step 7's `DEVIATIONS` list; if a note below states something the build did differently, change that sentence to what was built and name it there too.

- [ ] **Step 2: The note on ADR-0034**

Append at the end of `docs/decisions/0034-add-ag-ui-agents-as-a-provider.md`, after a blank line:

```markdown
### Note, TODAY (Part 2b, human in the loop)

Part 2b lets an agent stop and ask the user (spec §6; plan `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md`, plan calls P1–P8, P14 and P17; running record decisions 46, 47, 50 and 62). The agent contract of this record is unchanged except `RunAgentInput.tools`, and `docs/agui-agents.md` describes all of it for agent authors ("Asking the user", "Interrupts", "State and activity").

**The hub's `ask_user` tool** (decision 46: the full-stack template's design, advertised by the hub). An AG-UI app's settings gain `askUser`, a boolean with the zod default `false`, so a document 2a wrote still parses; the admin form shows it as "Ask the user" in a Conversation settings section, and the chat DTO carries it (`AguiChatFields`), still without the URL, audience or secret. The chat adapter reads the switch now, on every run (`ChatAdapter.hubTools(settings)`, P1): while it is on, the run advertises `ask_user` in `RunAgentInput.tools`; off, it sends `tools: []` as 2a did. It is off by default because Pydantic AI fails every run of an agent that already has a tool of that name (`UserError`, `toolsets/combined.py`). The name and the arguments are the template's (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21): `{ questions: [{ question, options = [], allow_custom = true }] }`. The arguments are untrusted (AG-UI "Tool calls", Security: validated against the declared schema) and read with zod: 1–10 questions of 1–500 characters after trimming, at most 10 options of 1–200 characters after trimming, unknown keys dropped (P2); the tool's JSON Schema states the same limits. The answer is one `tool` message per call whose content is the template's `format_answers` transcript (`Q: …` and `A: …` per question, `(skipped)`, `(no answer)`), a string because 0.x agents accept only string content; the browser builds it and the server stores it as sent (at most 32,000 characters, a free answer at most 2,000; P3). Arguments that fail the schema show "The agent asked an invalid question" with Dismiss, and the server answers that call with a `tool` message whose `error` is `invalid_arguments`, whatever the browser sent. A pending call counts as open only while the app's switch is on now (decision 62's fourth answer, as CopilotKit, assistant-ui and the template decide it): a question still waiting when the switch goes off is answered `not_available` by the next run, and an answered call always renders. Several calls in one run are one card that steps through their questions in call order, each call answered by its own transcript (P4).

**The interrupt answers.** An approval is an interrupt with `reason: 'tool_call'` and a `toolCallId` (AG-UI concepts › Interrupts, "Tool-bound interrupts"); the gated call's card shows Approve and Reject, its arguments read-only. The payload follows the interrupt's own `responseSchema` (P5): the schema's first required boolean property, else its first boolean property, else the spec's `approved`, set to `true` or `false`; Reject adds `reason: 'Rejected by the user'` when the schema declares a string `reason`. That covers `approved` (Pydantic AI, Strands, Mastra) and `accepted` (Microsoft Agent Framework) alike (`part2-hitl-state-files.md` §1.3), and the server accepts only one of the two payloads the rule builds. A `confirmation` without a `responseSchema` shows Yes and No, which answer a bare `true` or `false` (P6; the reason taxonomy's "`responseSchema` optional; boolean default"), so a resume payload is an object or a boolean. Any other interrupt whose `responseSchema` is flat gets a form (P7, the owner's "Types and bounds", decision 62): properties of `type` string, number, integer or boolean, or an `enum` of strings or numbers, with `title`, `description`, `default`, `minLength`/`maxLength`, `minimum`/`maximum` and `required`; lengths count code points (JSON Schema Validation 2020-12 §6.3.1). Any other keyword, a nested object or array, or no schema on an interrupt that is not a confirmation leaves the message and Cancel only (P8). The browser and the server share these rules (`lib/chat/interrupt-answers.ts`, client-safe), and the server checks each resolved payload with them (`payloadAccepted`) before the run starts. The decisions wait in the browser until the last open item, an interrupt or a question, has one, and can be changed until then (decision 62's third answer; CopilotKit's `useInterrupt` waits the same way); they go as one run whose `resume[]` covers every interrupt of the continued run ("The resume list MUST cover every interrupt"). An interrupt past its `expiresAt` offers only Dismiss, which answers it `cancelled`; the browser judges expiry with `@ag-ui/client` 1.0.2's rule (`new Date(expiresAt) <= now`, copied client-safe, P14) and the server re-checks with `isInterruptExpired`. No form library is added (spec §6.3). The hub reads only the 1.0 interrupt outcome of `RUN_FINISHED`, so a LangGraph agent needs `emit_interrupt_outcome=True` (`part2-hitl-state-files.md` Implications B.3).

**The plan state and activity cards** (decision 47). A state that parses as `{ steps: [{ description, status }] }` with at least one step shows as a plan panel above the composer: "Plan 2/5" (completed steps), a progress bar and vertical `Steps`, with `pending` → wait, `in_progress` → process, `completed` → finish, `blocked` → error and any other status → wait (P17); it is the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example. State of any other shape is not shown to users, and users never edit state. An `activity` message renders read-only in its turn as a card titled with its `activityType`: an object whose values are strings, numbers, booleans or null as `Descriptions`, anything else as indented JSON in `CodeHighlighter`, cut at 10,240 characters with a note. Everything an agent sends renders as text, never HTML (spec §6.4).

Verification: `__tests__/chat-ask-user.test.ts`, `__tests__/chat-interrupt-answers.test.ts`, `__tests__/chat-plan-state.test.ts`, `__tests__/shared-chat-activity-view.test.ts`, `__tests__/chat-answers.test.ts`, `__tests__/agui-chat.test.ts` (the advertised tools), and `e2e/agui-hitl.spec.ts` on three projects against the stub's human-in-the-loop scenarios.
```

- [ ] **Step 3: The note on ADR-0033**

Append at the end of `docs/decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md`, after a blank line:

```markdown
### Note, TODAY (Part 2b, answers that continue a turn)

Part 2b sends answers (spec §6; plan calls P9–P11; running record decision 62), which adds three rules to the store and the turn model.

- **A run refused before its stream does not continue the turn** (decision 62's first answer, P10). When the agent refuses an answering run before any event (spec §4.3 step 4: a 401, 403, 404, 415 or 422, or no connection) or the hub fails before sending it, the run is stored `failed` with `error.beforeStream: true` inside the `error` jsonb, so no column changes, and the `ask_user` answer messages it carried are deleted in the transaction that ends it (`RunEnd.withdraw`); its `resume` stays on the row for the Logs. `continuedRun` (`lib/data/conversations.ts`, replacing `lastRun`) is the newest run without the flag: the server's open items, the history's at-end tool statuses and the last turn's open interrupts all read it, so the cards stay answerable and the user can answer again. AG-UI names this run: a resume entry names an interrupt "from the run being continued — the most recent interrupted run on the thread", and the agent never received the refused one. A refused run that carried a message stays as 2a stores it (#66 stays open).
- **`waiting`** (P9, revising 2a's P10): a tool call without a result when its run ends on success or an interrupt is `waiting`, not `done`, live and in the history. It waits for an approval, an answer, or the next run's `not_available` answer; its ThoughtChain item shows an hourglass and no status colour.
- **Answers continue the turn they answer.** The open items are the continued run's open interrupts plus the thread's unanswered `ask_user` calls while the app advertises the tool (`openItemsOf`, `lib/chat/answers.ts`); `checkAnswers` refuses answers that do not cover each exactly once, or that carry a payload the interrupt's schema refuses (400 `answers_invalid`), and a message while anything is open is still 409 `answer_pending` (decision 50). The browser sends the answers through `onReload` on the waiting turn ([ADR-0017](0017-build-the-chat-on-ant-design-x.md) note of the same day), so the resumed run's events, the gated tool's `TOOL_CALL_RESULT` among them, extend the same X message, as this record's "one X message per turn" says of runs that continue a turn. No `TOOL_CALL_RESULT` comes back for `ask_user`, a frontend tool (spike), so the server stores the transcripts as `tool` messages and the browser merges the same answers into the turn.

Verification: `__tests__/db/conversations-run.db.test.ts` (`continuedRun`; `withdraw` in the transaction that ends the run), `__tests__/chat-run.test.ts` (a refused answering run is stored before it leaves `activeRuns`), `__tests__/chat-turn.test.ts` and `__tests__/chat-open-items.test.ts` (`waiting`, the refusal flag), `__tests__/chat-answers.test.ts`, and `e2e/agui-hitl.spec.ts`.
```

- [ ] **Step 4: The note on ADR-0017**

Append one paragraph at the end of `docs/decisions/0017-build-the-chat-on-ant-design-x.md`, after a blank line:

```markdown
Note, TODAY (Part 2b, the queued send and the answers): issue #68 is fixed in both chat hooks together. They share `createQueuedSends` (`components/chat/hooks/queued-sends.ts`), and a key's queued flag now also clears when that key's reply ends, from XRequest's `callbacks` (`onSuccess`, `onError`), which x-sdk 2.9.0's `AbstractChatProvider.injectRequest` calls after its own handlers for every key, on screen or not (`es/chat-providers/AbstractChatProvider.js`). The note of 2026-10-05 still holds for a reply that starts on screen; a reply that ends while another conversation is on screen no longer leaves its key marked, which had made `sendDecision` ignore every later send to that conversation. The Dify chat behaves as before otherwise. The shared chat's answers (approvals, the hub's `ask_user` questions, other interrupts; [ADR-0034](0034-add-ag-ui-agents-as-a-provider.md) note of the same day) continue the turn they answer the way the Dify human-input resume does: `onReload(turnId, …)` with `requestPlaceholder` returning the waiting turn until the first chunk (`params.continues` here, `params.resume.message` there), so the resumed run's events extend the same X message ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md) note of the same day). The `ask_user` transcripts join that turn only from the provider's `transformParams`, never in `requestPlaceholder`, so a request refused before its stream leaves the questions open (plan call P11). Issue #67 is fixed in `fallbackTurn` (`requestFallback`): a failed answer appends a closed error run to a turn whose last run has ended, keeping its interrupts and waiting calls, so the error shows under cards that stay answerable; an abort there leaves the turn as it was. The decisions wait per conversation key in `useSharedChat`'s side store until the last open item has one, and can be changed until then (plan call P13); the hook clears the draft before it calls `onReload` and ignores answers while a request runs, so one decision never goes twice.
```

Then date the three notes and check them:

```bash
sed -i "s/^### Note, TODAY (Part 2b/### Note, $(date +%F) (Part 2b/" docs/decisions/0033-*.md docs/decisions/0034-*.md
sed -i "s/^Note, TODAY (Part 2b/Note, $(date +%F) (Part 2b/" docs/decisions/0017-*.md
grep -c "^### Note, $(date +%F) (Part 2b" docs/decisions/0033-*.md docs/decisions/0034-*.md
grep -c "^Note, $(date +%F) (Part 2b" docs/decisions/0017-*.md
grep -c 'TODAY' docs/decisions/0017-*.md docs/decisions/0033-*.md docs/decisions/0034-*.md
```

Expected: `1` for 0033 and 0034; `1` for 0017; `0` for each of the three files.

- [ ] **Step 5: The agent authors' guide**

In `docs/agui-agents.md`, section "The app's settings", find the table's last row:

```markdown
| JWT secret | 32–512 characters, shared with your agent: `openssl rand -base64 48`. Never the hub's `NEXTAUTH_SECRET`. Stored write-only; leave it blank on Edit to keep it. |
```

and add this row on the line after it:

```markdown
| Ask the user | Off by default. On, every run offers your agent the hub's `ask_user` tool (see "Asking the user"). Leave it off if your agent has a tool of that name. |
```

In "Each request", replace the body line:

```markdown
- The body: the AG-UI `RunAgentInput`, built by the hub from its own store: `threadId` (the hub's conversation id), `runId` (new for every run), `messages` (the whole thread: user, assistant with tool calls, tool results, reasoning with any `encryptedValue` you sent; activity messages stripped), `state` (your last state), `tools` (`[]`: the hub advertises no tools yet), `context` `[]`, `forwardedProps` `{}`, and `resume` when the user answered your interrupts.
```

with:

```markdown
- The body: the AG-UI `RunAgentInput`, built by the hub from its own store: `threadId` (the hub's conversation id), `runId` (new for every run), `messages` (the whole thread: user, assistant with tool calls, tool results, the hub's answers to your `ask_user` calls, reasoning with any `encryptedValue` you sent; activity messages stripped), `state` (your last state), `tools` (the hub's `ask_user` tool while the app's "Ask the user" switch is on, `[]` otherwise: see "Asking the user"), `context` `[]`, `forwardedProps` `{}`, and `resume` when the run answers your interrupts (see "Interrupts").
```

In "Answering", replace the sentence `The hub shows text, reasoning, tool calls with their results, and run errors.` with `The hub shows text, reasoning, tool calls with their results, run errors, your interrupts (see "Interrupts"), a plan from your state and your activity messages (see "State and activity").`

Then replace the heading line `## Stop and silence` with the three new sections followed by that heading:

````markdown
## Asking the user

While the app's **Ask the user** switch is on (an admin sets it in the app form's Conversation settings; it is off by default), every run advertises one tool in `RunAgentInput.tools`: the hub's `ask_user`, the full-stack template's tool (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21). Its description tells the model that the answers come back in the next turn. Its arguments:

```json
{ "questions": [{ "question": "Which region?", "options": ["EU", "US"], "allow_custom": true }] }
```

| Argument | Rule |
| --- | --- |
| `questions` | 1–10 questions |
| `question` | 1–500 characters after trimming |
| `options` | optional, at most 10, each 1–200 characters after trimming; shown as choices |
| `allow_custom` | optional, `true` by default: the user may type their own answer (at most 2,000 characters) |

Unknown keys are ignored. Call it as a frontend tool (AG-UI "Tool calls", "Frontend tools"): do not answer the call yourself, and end the run with the success outcome. The user sees the questions above the composer, one at a time, with **Skip** (this question) and **Dismiss** (the rest), and cannot send a message until they are done. Several calls in one run are asked in one go, in call order. Once the last question, and any interrupt of the same run, has an answer, the hub starts the next run, which carries one `tool` message per call, keyed by its `toolCallId`, whose `content` is a transcript:

```text
Q: Which region?
A: EU

Q: Anything else?
A: (skipped)
```

`(skipped)` marks a question the user skipped or dismissed, `(no answer)` one left without an answer.

Arguments that break these rules show the user "The agent asked an invalid question" with Dismiss, and the call is answered with a `tool` message whose `error` is `invalid_arguments`. If an admin turns the switch off while a question waits, the question is released and the next run answers the call with `error` `not_available` ("This tool is not available here."), as it answers any call to a tool the hub did not advertise; answered questions stay in the conversation.

**The name:** if your agent has a tool named `ask_user` of its own, leave the switch off. Pydantic AI fails every run in which two tools share a name (`UserError`: "defines a tool whose name conflicts with existing tool"). A call to a tool the hub did not advertise, such as Pydantic AI Harness's deferred `ask_user_question`, is not a question for the user: it never blocks the composer, and the next run answers it `not_available`.

## Interrupts

A run that needs the user ends with `RUN_FINISHED` and the outcome `{ type: 'interrupt', interrupts: […] }` (AG-UI "Interrupt and resume"). The hub shows each interrupt and blocks the composer until every open interrupt and question has an answer; the user can change an answer until the last one is in. The next run then carries `resume`, one entry per interrupt of your run, in the order your outcome lists them: `{ interruptId, status: 'resolved', payload }` or `{ interruptId, status: 'cancelled' }`, beside the answers to any `ask_user` calls of the same run.

| Interrupt | The user sees | A resolved entry's `payload` |
| --- | --- | --- |
| `reason: 'tool_call'` with a `toolCallId` (an approval) | **Approve** and **Reject** on the tool's card, its arguments read-only | your `responseSchema`'s first required boolean property, else its first boolean property, else `approved`, set to `true` or `false`; Reject adds `reason: 'Rejected by the user'` when the schema has a string `reason` |
| `reason: 'confirmation'` without a `responseSchema` | **Yes** and **No** | `true` or `false` (AG-UI's boolean default) |
| any reason with a flat `responseSchema` | a form with **Submit** and **Cancel** | the form's values: only your schema's properties |
| anything else | your `message` and **Cancel** | — |

Approvals, for example:

| Your `responseSchema` | Approve | Reject |
| --- | --- | --- |
| Pydantic AI's: `approved` (boolean, required), `editedArgs`, `reason` (string) | `{ "approved": true }` | `{ "approved": false, "reason": "Rejected by the user" }` |
| Microsoft Agent Framework's: `accepted` (boolean, required), `arguments` | `{ "accepted": true }` | `{ "accepted": false }` |
| none | `{ "approved": true }` | `{ "approved": false }` |

The hub never sends `editedArgs`: the arguments are not editable. An approval whose `toolCallId` matches no tool call in the turn shows as a card of its own with the same buttons.

**The form** reads a flat object schema: `properties` whose `type` is `string` (with `minLength`, `maxLength`), `number` or `integer` (with `minimum`, `maximum`) or `boolean`, or an `enum` of strings or numbers, each with an optional `title`, `description` and `default`; `required`; and at the top `title`, `description`, `additionalProperties: false` and `$schema`. Lengths count characters (code points). With any other keyword, a nested object or array, a `required` name that is not a property, or a `default` of the wrong type, the user sees only your `message` and **Cancel**. The hub checks every payload against your schema before your next run starts.

**The card's title** is the reason: the reasons AG-UI defines are translated, and any other reason (namespace your own, e.g. `myframework:choose_slot`) is shown as written. Write `message` for the user; it is shown as plain text.

**Cancel** sends `status: 'cancelled'` without a payload ("abandoned without providing meaningful input"); treat a cancelled approval as not executed.

**Expiry:** an interrupt whose `expiresAt` (ISO 8601) has passed shows as expired with only **Dismiss**, which sends `cancelled`; the hub refuses any other answer to it.

**One resume:** every interrupt of your run is answered in one `resume` list, never a partial one (AG-UI: "The resume list MUST cover every interrupt"). If your agent refuses that run before its stream (401, 404, 422, or unreachable), the interrupts stay open and the user can answer again.

**LangGraph:** the hub reads only the 1.0 interrupt outcome of `RUN_FINISHED`. `ag-ui-langgraph` sends it only with `emit_interrupt_outcome=True` (`emitInterruptOutcome` in TypeScript; off by default); without it, interrupts arrive as the legacy `CUSTOM on_interrupt` event, which the hub does not read, and the run looks finished.

## State and activity

**A plan.** When your state (`STATE_SNAPSHOT`, `STATE_DELTA`) has this shape, with at least one step, the hub shows it in a panel above the composer:

```json
{
	"steps": [
		{ "description": "Find flights", "status": "completed" },
		{ "description": "Book a hotel", "status": "in_progress" }
	]
}
```

The panel reads "Plan 1/2" (completed steps), with a progress bar and the steps. It collapses once every step is completed.

| `status`      | The step shows |
| ------------- | -------------- |
| `pending`     | waiting        |
| `in_progress` | in progress    |
| `completed`   | done           |
| `blocked`     | an error       |
| anything else | waiting        |

It is the shape of AG-UI's Dojo `agentic_generative_ui` and Pydantic AI's example of it.

**Other state** is not shown to users. Your next run receives it unchanged as `state`, and users cannot edit it, so it is only ever what your agent sent. Keep secrets out of it: state round-trips through the hub (AG-UI "State").

**Activity:** an `activity` message (`ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA`) shows read-only in its turn as a small card titled with its `activityType`: an object whose values are strings, numbers, booleans or null as a list of fields, anything else as indented JSON, cut at 10,240 characters. Activity messages are stripped from the `messages` your next run receives (AG-UI "Activity": a consumer "MUST strip activity messages" from the messages it sends), so keep nothing you need only there.

Everything your agent sends is shown as plain text, never as HTML.

## Stop and silence
````

Run: `grep -cE '^## (Asking the user|Interrupts|State and activity)$' docs/agui-agents.md; grep -c 'the hub advertises no tools yet' docs/agui-agents.md; grep -c 'emit_interrupt_outcome' docs/agui-agents.md; grep -c 'invalid_arguments' docs/agui-agents.md; grep -c '^## Stop and silence$' docs/agui-agents.md` Expected: `3`, `0`, `1`, `1`, `1`.

- [ ] **Step 6: AGENTS.md's Layout**

In `AGENTS.md`, section "Layout", the `components/` bullet: replace `` `shared-chat/` (the AG-UI chat on the hub's store, ADR-0033) `` with `` `shared-chat/` (the AG-UI chat on the hub's store, with its approval, question, interrupt, plan and activity cards; ADR-0033, ADR-0034) ``.

The `lib/` bullet: replace `` `chat/` (the shared chat's server side: turns, the run session, the routes' guard and the purge; ADR-0033) `` with `` `chat/` (the shared chat's server side: turns, the run session, the routes' guard, the answers check and the purge, beside the client-safe rules the browser shares: `ask_user`, the interrupt answers, the plan state and the open items; ADR-0033, ADR-0034) ``.

The Docker gate's checks stay as they are: 2b adds no route.

Run: `grep -c 'the plan state and the open items; ADR-0033, ADR-0034' AGENTS.md; grep -c 'interrupt, plan and activity cards; ADR-0033, ADR-0034' AGENTS.md; wc -l < AGENTS.md` Expected: `1`, `1`, a number below `200` (the two bullets stay one line each).

- [ ] **Step 7: Spec §0 and the running record**

In `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §0, replace the whole table row that begins with ``| 2b human in the loop | `feat/agui-hitl` |`` (the progress table's row; §1's slices table has another row starting `| 2b human in the loop |`, which stays) with:

```markdown
| 2b human in the loop | `feat/agui-hitl` | `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md` (19 tasks; `docs/part-2b-plan`, PR #PLAN_PR) | built: Tasks 1–17, each reviewed, and the records (Task 18); no migration and no new dependency. Fixed here: #67, #68 and #69's answer-pending hint. Plan deviations (ruled while it ran): DEVIATIONS. The gates and the Docker gate: Task 19 | — | — |
```

Replace the line that begins with `**Next:**` with the line below. If the old line names something still due for 2a or Part 1 (the owner's browser check of 2a, the `ai-app-hub-local-app:part1` image and the `local-before-part2a.sql` dump), keep those sentences after it, as they stand.

```markdown
**Next:** 2b's gates and Docker gate (Task 19 of `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md`) on `feat/agui-hitl`, then its PR to `fork/overhaul`; the owner's browser check (spec §12, "2b done when") and the merge are the owner's.
```

In `docs/superpowers/research/2026-10-11-provider-hub/README.md`, after decision 63 (2b's plan) and before `## Ideas kept for later`, add, with a blank line before and after as decisions 60–63 have:

```markdown
64. **2b is built** (TODAY): Tasks 1–18 of `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md` on `feat/agui-hitl`, subagent-driven, each task reviewed. No migration and no new dependency (decision 62 keeps the refusal flag inside the `error` jsonb and reads `ask_user` from the app's current switch). Records: dated notes on ADR-0017 (#68's queued send, the answers through `onReload`, #67's `fallbackTurn`), ADR-0033 (`error.beforeStream` and `continuedRun`, `waiting`, answers that continue a turn) and ADR-0034 (`ask_user`, the interrupt answers, the plan state and activity cards), and `docs/agui-agents.md`'s "Asking the user", "Interrupts" and "State and activity"; no new ADR (ADR-0015). Fixed here: #67, #68 and #69's answer-pending hint (P15). Deviations from the plan (ruled while it ran): DEVIATIONS. Next: the gates, the Docker gate and the PR (Task 19), then the owner's check.
```

Then fill the three tokens. `DEVIATIONS` (twice: the spec row and decision 64) becomes the deviations Step 1 found, as a `;`-separated list in the style of the 2a row (no `|` in the text, which would split the table cell), or `none`. `PLAN_PR` and `TODAY` are filled by:

```bash
PLAN_PR=$(gh pr list -R LovingCivilian/dify-app-hub --head docs/part-2b-plan --state merged --json number --jq '.[0].number')
echo "plan PR: $PLAN_PR"
sed -i "s/PR #PLAN_PR)/PR #$PLAN_PR)/" docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md
sed -i "s/^64\. \*\*2b is built\*\* (TODAY)/64. **2b is built** ($(date +%F))/" docs/superpowers/research/2026-10-11-provider-hub/README.md
grep -cE 'PLAN_PR|DEVIATIONS' docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
grep -c '^| 2b human in the loop | `feat/agui-hitl` | `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md` (19 tasks' docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md
grep -n '^64\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md
```

Expected: `plan PR:` and a number (the merged PR of `docs/part-2b-plan`); `0` for both files; `1`; one line with today's date.

- [ ] **Step 8: Format check and commit**

Run: `pnpm exec oxfmt --check docs/decisions/0017-*.md docs/decisions/0033-*.md docs/decisions/0034-*.md docs/agui-agents.md AGENTS.md docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md` Expected: no findings (if oxfmt reports a file, run `pnpm exec oxfmt` on that file and check that every table row is still one line).

```bash
git add docs/decisions/0017-*.md docs/decisions/0033-*.md docs/decisions/0034-*.md docs/agui-agents.md AGENTS.md docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
git commit -m "docs(agui): record 2b in the ADR notes, the agent authors' guide and Part 2's progress

Notes on ADR-0034 (ask_user, the interrupt answers, the plan state and
activity cards), ADR-0033 (beforeStream and continuedRun, waiting) and
ADR-0017 (#68, the answers through onReload, #67); docs/agui-agents.md's
three new sections; AGENTS.md's Layout; spec §0's 2b row; decision 64.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```json:metadata
{"files": ["docs/decisions/0034-add-ag-ui-agents-as-a-provider.md", "docs/decisions/0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md", "docs/decisions/0017-build-the-chat-on-ant-design-x.md", "docs/agui-agents.md", "AGENTS.md", "docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md", "docs/superpowers/research/2026-10-11-provider-hub/README.md"], "verifyCommand": "grep -cE '^## (Asking the user|Interrupts|State and activity)$' docs/agui-agents.md && grep -c \"(Part 2b\" docs/decisions/0017-*.md docs/decisions/0033-*.md docs/decisions/0034-*.md && wc -l < AGENTS.md", "acceptanceCriteria": ["a Part 2b note dated today at the end of ADR-0034 and ADR-0033 (### Note headings) and ADR-0017 (a Note paragraph)", "the ADR-0034 note names ask_user's limits, the switch, the transcript, invalid_arguments, the approval payload rule with 'Rejected by the user', the confirmation boolean, the flat subset with minLength, the one resume, expiry with isInterruptExpired, and the steps plan shape", "docs/agui-agents.md has Asking the user, Interrupts and State and activity; its tools line names ask_user; it names emit_interrupt_outcome, invalid_arguments, Rejected by the user and 10,240", "AGENTS.md's Layout lines for shared-chat/ and chat/ updated; AGENTS.md stays under 200 lines", "spec §0's 2b row names the plan, its merged PR number and the build; Next line updated; running record decision 64 with today's date; no PLAN_PR or DEVIATIONS token left", "oxfmt --check clean on the seven changed Markdown files"], "modelTier": "mechanical"}
```

---

### Task 19: Final verification and the Docker gate

**Goal:** Every whole-branch gate exits clean (Steps 1–6); then, only after the owner's captured go-ahead, the owner's local stack keeps its current image as `ai-app-hub-local-app:part2a`, is rebuilt from this branch and shows `Database migration complete` once, RestartCount 0, the same six migration rows, no `@ag-ui/client` or `@ag-ui/encoder` code in the browser bundle and AGENTS.md's signed-out checks; `feat/agui-hitl` is pushed, its PR to `fork/overhaul` is open, #69's hint item is ticked, and spec §0 and decision 65 record the gates.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §0 ("Gates: AGENTS.md's, then the Docker gate"), §10 ("Docker gate") and §12. No earlier task touches the owner's stack (`ai-app-hub-local`, `docker-compose.local.yml`, port 5300, PostgreSQL on 127.0.0.1:5432); this one does so only after the owner's word (Step 7). 2b has no migration (Global Constraints, decision 62), so the database is not dumped: the entrypoint's migrator finds nothing pending, and the old image is enough for a way back (Step 17), because 2a's code reads what 2b writes. 2a's `aguiSettingsSchema` is a `z.object`, which drops the unknown `askUser` (zod 4 "Objects"), and its `readRunError` schema drops `beforeStream` the same way (`lib/data/conversations.ts` at `e8530dcc`). The owner's browser check and the merge are the owner's (decision 61's pattern); this task ends with the PR open and the owner told what to check.

**Files:** none changed in the repository, except Step 15's records (spec §0, the running record). Outside it: the image tag `ai-app-hub-local-app:part2a` (Step 8), kept until the owner lets it go; the PR body in the session's scratchpad (Step 13).

**Acceptance Criteria:**

- [ ] Steps 1 to 6 are green on the whole branch: after the fetch, `git log --oneline HEAD..fork/overhaul` prints nothing; tsc; oxlint and oxfmt on the changed files; `npx -y @ant-design/cli lint ./ --format json` with `"total": 0`; `pnpm i18n:lint` ("No issues found.") and `pnpm i18n:status` (zh and ar at 100%); Step 2's four checks print nothing; `pnpm test`; `pnpm test:db`; `pnpm test:ldap`; `pnpm test:e2e` with 0 failed on desktop-light, desktop-dark and mobile-light.
- [ ] The owner's explicit go-ahead to Step 7's message is captured before Step 8; nothing touches `ai-app-hub-local` before it.
- [ ] The old image is tagged `ai-app-hub-local-app:part2a` (never overwritten), and Step 8 printed the migration rows and the counts before the rebuild.
- [ ] After the rebuild: `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` prints `1`; `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` prints `0`; `drizzle.__drizzle_migrations` lists the same six rows as before, ending in `_agui_provider` and `_conversations`; the apps and conversations counts are unchanged.
- [ ] Step 11's bundle check prints `0` twice (`[ag-ui]` and `@ag-ui/` in `.next/static`).
- [ ] Step 12's signed-out checks answer as listed, and `/api/health` answers `200` again after `restart postgres`.
- [ ] `feat/agui-hitl` is pushed; the PR to `fork/overhaul` follows `.github/PULL_REQUEST_TEMPLATE.md`'s sections, names ADR-0017, ADR-0033 and ADR-0034, has "Closes #67" and "Closes #68", and ends with the session's attribution lines; #69 has the comment and its hint item is ticked; spec §0's 2b row names the PR and the gates, and decision 65 is written.

**Verify:** `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app && gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json state,baseRefName --jq '"\(.state) \(.baseRefName)"'` → `1`, `0`, `OPEN fork/overhaul`

**Interfaces:** consumes every earlier task. Nothing in `.env` or `.env.development.local` is read or printed: inside the PostgreSQL container, `psql` reads the database's name and user from the container's own `POSTGRES_*` variables (`sh -c '… "$POSTGRES_USER" …'`).

- [ ] **Step 1: Static gates on the whole branch**

First make sure the branch holds everything `fork/overhaul` has (Global Constraints: a `fix/` branch from the owner's 2a check may have merged meanwhile):

```bash
git fetch origin fork/overhaul:fork/overhaul
git log --oneline HEAD..fork/overhaul
```

Expected: the fetch updates or confirms the local `fork/overhaul`, and the log prints nothing. If it prints commits, merge `fork/overhaul` into `feat/agui-hitl` (`git merge fork/overhaul`, a merge commit, as the branch model keeps history), and run every step of this task from here on the result.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD -- '*.ts' '*.tsx')` Expected: no findings.

Run: `pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD)` Expected: no findings.

Run: `npx -y @ant-design/cli lint ./ --format json` Expected: `"summary": { "total": 0, …}` (the ratchet in `docs/frontend-conventions.md`).

Run: `pnpm i18n:lint && pnpm i18n:status` Expected: "No issues found." and `zh` and `ar` at 100%.

- [ ] **Step 2: The boundaries**

Run: `git grep -nE "from '@ag-ui/(client|encoder)'" -- components app hooks lib/chat/turn.ts lib/chat/ask-user.ts lib/chat/interrupt-answers.ts lib/chat/plan-state.ts lib/chat/open-items.ts ':!app/api'` Expected: no output (spec §9: the browser carries none of their runtime; the route handlers under `app/api` are server code, and the five `lib/chat/` modules are client-safe).

Run: `git grep -nE "^import [^t].*from '@ag-ui/core" -- components lib/chat/turn.ts lib/chat/ask-user.ts lib/chat/interrupt-answers.ts lib/chat/plan-state.ts lib/chat/open-items.ts` Expected: no output (client code and the client-safe modules import `@ag-ui/core` with `import type` only; the pattern also catches a runtime `@ag-ui/core/schemas` import, which only the server's `lib/chat/answers.ts` may have).

Run: `git grep -lE "from '@/lib/providers/(dify|agui)" -- app components hooks lib db ':!lib/providers' ':!components/provider-ui' ':!components/chat' ':!app/api/dify'` Expected: no output (`__tests__/provider-boundary.test.ts` pins the Dify half; AG-UI's module is reached only through the registry).

Run: `git diff --name-only fork/overhaul...HEAD -- db package.json pnpm-lock.yaml` Expected: no output (Global Constraints: no migration, no schema change and no new dependency in 2b).

- [ ] **Step 3: The unit suite**

Run: `pnpm test` Expected: PASS; keep the summary line (files and tests) for Step 13.

- [ ] **Step 4: The live database suite**

Run: `pnpm test:db` Expected: PASS, `conversations-run.db.test.ts` among them (Task 6 changed `lib/data/conversations.ts`); the teardown stops the e2e PostgreSQL. Keep the test count.

- [ ] **Step 5: The directory suite**

Run: `pnpm test:ldap` Expected: PASS (2b changes nothing in the directory code; the whole-branch gate runs every suite). Keep the test count.

- [ ] **Step 6: The e2e suite on an empty PostgreSQL**

Stop `pnpm dev` if it runs (one `next dev` per checkout), and make sure `pnpm test:db` is not running (the two share the e2e PostgreSQL). Run in the background (about 32 minutes; the Bash tool's `run_in_background`, its output read when it ends): `docker compose -f docker-compose.e2e.yml --profile ldap down -v && pnpm test:e2e` Expected: 0 failed on `desktop-light`, `desktop-dark` and `mobile-light`, with `e2e/agui-hitl.spec.ts` beside every Dify spec and 2a's `e2e/agui-admin.spec.ts` and `e2e/agui-chat.spec.ts`. Keep the passed and skipped counts. A failure is investigated (superpowers-extended-cc:systematic-debugging), fixed in its own commit, and Steps 1–6 run again.

Then free the memory the Docker build needs (about 5 GB on this machine), and clear the dev types the e2e server left (they break tsc):

```bash
docker compose -f docker-compose.e2e.yml --profile ldap down
rm -rf .next/dev/types && pnpm exec next typegen && pnpm exec tsc --noEmit
```

Expected: the e2e containers stopped; no tsc output.

- [ ] **Step 7: Stop and ask the owner before touching their stack**

Send the owner this and wait for their word:

> Part 2b passes every gate (tsc, oxlint, oxfmt, the antd lint, the i18next checks, `pnpm test`, `pnpm test:db`, `pnpm test:ldap`, the e2e suite on three projects). The Docker gate is next, on your local stack; the app is down for about two minutes during the rebuild, and PostgreSQL stays up apart from one restart check.
>
> 1. I keep the current image as `ai-app-hub-local-app:part2a` and stop the app container. 2b has no migration, so I take no database dump: the database is left as it is.
> 2. I rebuild from `feat/agui-hitl`. Its entrypoint finds no pending migration, so the six migration rows stay as they are.
> 3. The checks: the migration log, the restart count, the browser bundle, AGENTS.md's signed-out curls, and, because 2b changes the data layer, one `docker compose restart postgres` with the health check after it.
> 4. Then I push `feat/agui-hitl`, open the PR to `fork/overhaul`, and tick #69's hint item. Your browser check and the merge stay yours.
>
> If you want 2a back afterwards, Step 17 starts the `part2a` image again, on your word only; nothing in the database needs restoring, since 2a reads what 2b writes. May I go ahead?

- [ ] **Step 8: Keep the old image, take the app down, note the database (after the owner's word)**

```bash
docker compose -f docker-compose.local.yml ps --format '{{.Name}} {{.Status}}'
```

Expected: `ai-app-hub-local-postgres` running and `(healthy)`; `ai-app-hub-local-app` running, or not listed. If PostgreSQL is not running, stop and tell the owner instead of starting it. If the app is not listed, check that nothing else holds port 5300: `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` Expected: `000`; anything else is another server on the port (the quick dev loop's `pnpm dev`): stop and ask the owner.

```bash
if docker image inspect ai-app-hub-local-app:part2a >/dev/null 2>&1; then
  echo 'ai-app-hub-local-app:part2a already exists: stop and ask the owner'
else
  docker image tag ai-app-hub-local-app:latest ai-app-hub-local-app:part2a &&
    docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
fi
docker image inspect -f '{{.Id}}' ai-app-hub-local-app:part2a
```

Expected: no "already exists" line; the app container stopped and removed (or nothing to remove); the old image's id (Compose tags a built service's image `<project>-<service>`; the tag is never overwritten, since an earlier attempt's `:part2a` may be the only copy of 2a's image; `ai-app-hub-local-app:part1` and `~/ai-app-hub-backups/local-before-part2a.sql` stay untouched).

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT 'apps ' || count(*) FROM apps;
SELECT 'conversations ' || count(*) FROM conversations;
SQL
```

Expected: six names (`<14 digits>_baseline`, `_apps_expand`, `_apps_data`, `_apps_contract`, `_agui_provider`, `_conversations`), then `apps <n>` and `conversations <n>`; keep this output for Step 10. If anything is not as expected, bring the old app back (`docker compose -f docker-compose.local.yml up -d --no-build app`; Compose `up --no-build`: "Don't build an image", so it starts the old `:latest`), check `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` → `200`, and report.

- [ ] **Step 9: Rebuild the app container (AGENTS.md "Docker stack")**

Never build this folder's image while the `fork/main` folder builds its own. The app container is already down:

```bash
docker compose -f docker-compose.local.yml up -d --build app
```

Expected: about two minutes (80 s of it `next build`). If the build is killed for memory, do not restart it unprompted (AGENTS.md): bring the old app back as Step 8's failure path does and report.

- [ ] **Step 10: The database after the rebuild**

- `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` Expected: `1` (`db/migrate.ts` prints it once per container start, with or without a pending migration).
- `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` Expected: `0`.
- Step 8's `psql` block again. Expected: exactly Step 8's output: the same six migration names and the same two counts (no migration ran; the owner's apps and conversations are untouched).

- [ ] **Step 11: The browser bundle carries no AG-UI client runtime (spec §9)**

```bash
docker compose -f docker-compose.local.yml exec -T app sh -c "grep -rlF '[ag-ui]' .next/static | wc -l; grep -rlF '@ag-ui/' .next/static | wc -l"
```

Expected: `0` and `0`. `[ag-ui]` prefixes every warning `@ag-ui/client` 1.0.2 logs (`src/enforce/enforce.ts`, `src/agent/agent.ts`), so a client chunk that bundled it would contain the string; the image's static chunks are at `/app/.next/static` (Dockerfile: `COPY --from=builder /app/.next/static ./.next/static`). If either count is above zero, report the files to the owner and stop: a client module imports more than `@ag-ui/core`'s types (2b's client-safe modules in `lib/chat/` are the new suspects).

- [ ] **Step 12: The signed-out checks (AGENTS.md's list) and the database restart**

Run each with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>` unless a body is named. `<app id>` is any id from `docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT id FROM apps LIMIT 1"'`; `<uuid>` is any UUID (`cat /proc/sys/kernel/random/uuid`), since a signed-out request never reaches a handler. 2b adds no route, so the list is 2a's.

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

2b changes the data layer (`lib/data/conversations.ts`), so AGENTS.md's database-layer check follows (the pool's error listener):

```bash
docker compose -f docker-compose.local.yml restart postgres
docker compose -f docker-compose.local.yml up -d --no-recreate --wait --wait-timeout 120 postgres
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health
docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app
```

Expected: the restart touches PostgreSQL only (it has no dependencies of its own; the app depends on it, and `restart` does not restart a service's dependents); `up --wait` returns once it is healthy again without recreating it (Compose `up`: `--wait` "Wait for services to be running|healthy", `--no-recreate` "If containers already exist, don't recreate them"); then `200` and `0`. `/api/health` runs `SELECT 1` through the pool, and an unhandled pool `error` event would have crashed the app into a restart (`db/index.ts`'s `pool.on('error', …)` is what this proves).

- [ ] **Step 13: Push and open the PR**

```bash
git status --short
git log --oneline fork/overhaul..HEAD | wc -l
git push -u origin feat/agui-hitl
```

Expected: no `git status` output (everything committed); the branch's commit count; the push creates `origin/feat/agui-hitl`. Note the gates' commit: `git rev-parse --short=8 HEAD` (`GATE_SHA` below and in Step 15).

Write the PR body below to `pr-2b.md` in your session's scratchpad directory (never in the repository), replacing the tokens with this task's results: `PLAN_PR` (the plan's merged PR, as in Task 18 Step 7), `DEVIATIONS` (running record decision 64's list, or "none"), `GATE_SHA`, `UNIT_TESTS` (Step 3's files and tests, e.g. "180 files, 2,300 tests"), `DB_TESTS`, `LDAP_TESTS`, `E2E_PASSED` and `E2E_SKIPPED` (Steps 4–6). Then append, after a blank line, the session's attribution lines for pull requests (the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line, a blank line, and the session link the session's system reminder gives), and check that no token is left: `grep -cE 'PLAN_PR|DEVIATIONS|GATE_SHA|UNIT_TESTS|DB_TESTS|LDAP_TESTS|E2E_PASSED|E2E_SKIPPED' <scratchpad>/pr-2b.md` Expected: `0`.

```markdown
## Overview

Part 2b of the provider hub: **human in the loop.** An AG-UI agent can stop and ask the user, and the shared chat answers it:

- **Approvals:** Approve or Reject on a gated tool call, answered in the terms of the interrupt's own `responseSchema` (`approved`, `accepted`, …).
- **Questions:** the hub's own `ask_user` tool, a per-app switch that is off by default. The agent's questions show one at a time above the composer, with Skip and Dismiss, and go back as a Q/A transcript.
- **Other interrupts:** a form for a flat `responseSchema` (types and bounds), Yes and No for a confirmation without a schema, otherwise the message and Cancel; an expired interrupt offers Dismiss.
- **The composer is blocked**, with a visible hint, until every open item has an answer. The answers go together when the last one is in, and a decision can be changed until then.
- **The agent's plan** shows in a panel above the composer, and its activity messages as read-only cards in the turn.

A run the agent refuses before its stream keeps the items open, so the user can answer again (running record decision 62). No migration and no new dependency. It follows **ADR-0033** and **ADR-0034**, with a dated note on each, and **ADR-0017**, with a note on the queued send and the answers' `onReload`.

- Spec: `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md`, slice 2b (§6).
- Plan: `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md` (PR #PLAN_PR), run subagent-driven: 19 tasks.

## Changes

| Type | File | Description |
| --- | --- | --- |
| Changed | `lib/providers/agui/{schema,provider,chat}.ts`, `components/provider-ui/agui/form-section.tsx` | The `askUser` switch (zod default `false`) in a Conversation settings section, the chat DTO's `askUser`, and the adapter's `hubTools` (P1) |
| Added | `lib/chat/{ask-user,hub-tools,interrupt-answers,plan-state,open-items}.ts` | The `ask_user` tool, its arguments and transcript; the approval payload, the confirmation boolean and the flat-schema subset; the plan state; the open items. All but `hub-tools.ts` are client-safe and shared with the browser |
| Changed | `lib/chat/{turn,statuses,answers,schemas,thread,adapter,run}.ts` | The `waiting` tool status (P9); the open items and the answers check with questions and payloads; `RunAgentInput.tools` |
| Changed | `lib/data/conversations.ts` | `continuedRun` replaces `lastRun`; a run refused before its stream is stored with `error.beforeStream` and withdraws its answer messages (P10) |
| Added | `components/chat/hooks/queued-sends.ts` | The queued-send flag both chat hooks share, also cleared when a key's reply ends (#68) |
| Changed | `components/chat/hooks/use-dify-chat.ts` | #68 only; the Dify chat behaves as before otherwise |
| Added | `components/shared-chat/{answers,activity-view,ask-user-steps,interrupt-form}.ts`, `components/shared-chat/hooks/use-expiry-clock.ts` | The answer draft and when it sends, expiry, the question steps, the form's rules and payload |
| Added | `components/shared-chat/{answer-context,approval-actions,tool-views,ask-user-card,interrupt-card,plan-panel,activity-card}.tsx` | The cards and the tool renderer registry |
| Changed | `components/shared-chat/**` (the hook, the provider, the helpers, the view) | Answers through `onReload`; `fallbackTurn` keeps the cards answerable under the error (#67); the hint above the Sender (#69) |
| Changed | `e2e/fixtures/stub/agui.ts`, `e2e/auth.setup.ts` | The stub's human-in-the-loop scenarios; the seed turns `askUser` on |
| Added | `e2e/agui-hitl.spec.ts` | Approvals, `ask_user`, interrupts, the plan panel and activity cards on three projects |
| Changed | locales en/zh/ar | Every new text |
| Changed | `docs/decisions/{0017,0033,0034}-*.md`, `docs/agui-agents.md`, `AGENTS.md`, spec §0, running record | The notes, the agent authors' guide ("Asking the user", "Interrupts", "State and activity"), decisions 64 and 65 |

**Deviations from the plan** (ruled while it ran): DEVIATIONS

## Testing

- [x] Gates on the whole branch at `GATE_SHA`:
  - `pnpm exec next typegen && pnpm exec tsc --noEmit`, oxlint and oxfmt are clean.
  - `npx -y @ant-design/cli lint ./` reports total 0.
  - `pnpm i18n:lint` is clean, and `i18n:status` shows zh and ar at 100%.
  - The boundary checks are empty: no `@ag-ui/client` or `@ag-ui/encoder` in browser code, `@ag-ui/core` as types only in the client-safe modules, and nothing changed under `db/` or in the dependencies.
  - `pnpm test`: UNIT_TESTS.
  - `pnpm test:db`: DB_TESTS tests.
  - `pnpm test:ldap`: LDAP_TESTS tests.
  - `pnpm test:e2e` on an empty PostgreSQL: E2E_PASSED passed, E2E_SKIPPED skipped, 0 failed, on desktop-light, desktop-dark and mobile-light.
- [x] Docker gate on the owner's local stack, run on their go-ahead:
  - The old image is kept as `ai-app-hub-local-app:part2a`; 2b has no migration, so no dump.
  - After the rebuild: one `Database migration complete`, RestartCount 0, the same six migration rows, and the same apps and conversations counts.
  - `.next/static` has no AG-UI client code.
  - Every AGENTS.md signed-out check passes, and the app answers `/api/health` again after a PostgreSQL restart.
- [x] No new TypeScript errors.
- [ ] **The owner's browser check** (spec §12, "2b done when"): with "Ask the user" on for an AG-UI app that points at the owner's agent service, approvals and `ask_user`, and the plan panel if the agent sends a plan; the composer blocks while something is open. `input_required`, the other interrupts and activity cards are proven against the stub, since Pydantic AI 2.56 sends only `tool_call` interrupts and no activity events.

## Related Issue

- Closes #67: a failed answer to an interrupted turn shows its error under the cards, which stay answerable.
- Closes #68: in both chat hooks, a queued send's key no longer stays set.
- #69: its answer-pending hint item is done (plan call P15); the other items stay open there.
- #66 stays open: a refused first run still leaves an orphan conversation.

GitHub closes issues from these keywords only when a PR merges into the default branch (`fork/main`), so #67 and #68 are closed by hand after the merge.
```

```bash
gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul --head feat/agui-hitl --title "feat(agui): Part 2b, human in the loop in the shared chat" --body-file <scratchpad>/pr-2b.md
gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json number,state,baseRefName --jq '"\(.number) \(.state) \(.baseRefName)"'
```

Expected: the PR's URL; then `<number> OPEN fork/overhaul`. GitHub links a closing keyword to an issue only for a PR into the default branch ("Linking a pull request to an issue": "The pull request must be on the default branch"); here the base is `fork/overhaul`, so the keywords record intent and Step 16 closes the two issues after the merge.

- [ ] **Step 14: Tick #69's hint item**

```bash
PR=$(gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json number --jq .number)
comment=$(cat <<'EOF'
Part 2b (PR #PR_NUMBER, `feat/agui-hitl` to `fork/overhaul`) does this issue's answer-pending hint item:

- [x] **The answer-pending hint:** a visible line above the Sender, "Answer the agent above to continue." (`shared_chat.answer_pending_hint`, plan call P15), replaces the Sender's placeholder, so a draft no longer hides it.

The other items stay open here.
EOF
)
gh issue comment 69 -R LovingCivilian/dify-app-hub --body "${comment//PR_NUMBER/$PR}"
body=$(gh issue view 69 -R LovingCivilian/dify-app-hub --json body --jq .body)
printf '%s\n' "$body" | grep -c '^- \[ \] \*\*The answer-pending hint\*\*'
gh issue edit 69 -R LovingCivilian/dify-app-hub --body "$(printf '%s\n' "$body" | sed 's/^- \[ \] \*\*The answer-pending hint\*\*/- [x] **The answer-pending hint**/')"
gh issue view 69 -R LovingCivilian/dify-app-hub --json body --jq .body | grep -c '^- \[x\] \*\*The answer-pending hint\*\*'
```

Expected: the comment's URL; `1` (the unticked item was found); the issue's URL; `1` (it is ticked). If the first count is `0`, the item's text changed since this plan was written: tick it by its new text, and leave every other item as it is.

- [ ] **Step 15: Record the gates and the PR**

In `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §0, in the row that begins with ``| 2b human in the loop | `feat/agui-hitl` |``, replace the row's end as Task 18 wrote it, `The gates and the Docker gate: Task 19 | — | — |`, with:

```markdown
The gates and the Docker gate passed (`GATE_SHA`, GATE_DATE); the owner's browser check pending | #PR_NUMBER | — |
```

Replace the line that begins with `**Next:**` with the line below, keeping after it any sentence of the old line that is still true about 2a or Part 1 (as Task 18 Step 7 did):

```markdown
**Next:** the owner's browser check of 2b on the local stack (`localhost:5300`, built from `feat/agui-hitl` at `GATE_SHA`; spec §12, "2b done when"), then the merge of PR #PR_NUMBER, both the owner's; a problem the check finds becomes a fix on `feat/agui-hitl`. The image `ai-app-hub-local-app:part2a` (2a, for a way back: Task 19 Step 17 of the 2b plan) stays until the owner lets it go.
```

In `docs/superpowers/research/2026-10-11-provider-hub/README.md`, after decision 64 and before `## Ideas kept for later`, add, with a blank line before and after:

```markdown
65. **2b passes its gates** (GATE_DATE).
    - **Gates** at `GATE_SHA`: tsc, oxlint, oxfmt, the antd lint at 0, i18next lint and status (zh and ar 100%), the four boundary checks empty, `pnpm test` UNIT_TESTS, `pnpm test:db` DB_TESTS, `pnpm test:ldap` LDAP_TESTS, and the e2e suite on an empty PostgreSQL with E2E_PASSED passed, E2E_SKIPPED skipped and 0 failed.
    - **The Docker gate** ran on the owner's go-ahead ("OWNER_WORDS", GATE_DATE): the old image kept as `ai-app-hub-local-app:part2a` (no migration, so no dump); one `Database migration complete`, RestartCount 0, the same six migration rows and the same apps and conversations counts; no `[ag-ui]` or `@ag-ui/` in `.next/static`; every signed-out check as AGENTS.md lists, and `/api/health` 200 after a PostgreSQL restart.
    - **The PR** is #PR_NUMBER to `fork/overhaul`, with #67 and #68 to close at the merge; #69's answer-pending hint item is ticked, with a comment. The owner's browser check (spec §12, "2b done when") and the merge are the owner's; a problem the check finds becomes a fix on `feat/agui-hitl`.
```

`OWNER_WORDS` is the owner's reply to Step 7, quoted as they wrote it. Fill the tokens and check:

```bash
GATE_SHA=$(git rev-parse --short=8 HEAD)
PR=$(gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json number --jq .number)
sed -i -e "s/GATE_SHA/$GATE_SHA/g" -e "s/PR_NUMBER/$PR/g" -e "s/GATE_DATE/$(date +%F)/g" docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
grep -cE 'GATE_SHA|GATE_DATE|PR_NUMBER|UNIT_TESTS|DB_TESTS|LDAP_TESTS|E2E_PASSED|E2E_SKIPPED|OWNER_WORDS' docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
grep -n '^65\. ' docs/superpowers/research/2026-10-11-provider-hub/README.md
pnpm exec oxfmt --check docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
```

Expected: `0` for both files; one line with today's date; no findings. (Replace the `UNIT_TESTS`, `DB_TESTS`, `LDAP_TESTS`, `E2E_PASSED`, `E2E_SKIPPED` and `OWNER_WORDS` tokens by hand first, with Steps 3–7's results; the `sed` fills the rest.)

```bash
PR=$(gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json number --jq .number)
git add docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md docs/superpowers/research/2026-10-11-provider-hub/README.md
git commit -m "docs(agui): record 2b's gates and PR #$PR in Part 2's progress

Spec §0's 2b row and Next line, and running record decision 65.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Expected: one commit; the push updates the PR.

- [ ] **Step 16: Report to the owner, then their check and merge**

Report to the owner: Steps 1–15's results, the PR's link, the migration rows and counts (unchanged), and what to check in the browser (spec §12, "2b done when") on `localhost:5300`: in App management, turn on "Ask the user" (Conversation settings) for an AG-UI app that points at their agent service; ask for something that needs a gated tool (Approve, then Reject with a new request) and something that makes the agent ask (answer, Skip, Dismiss); the Sender stays disabled with the hint while something is open; a reload keeps open cards answerable and answered ones as they were; the plan panel shows if their agent sends a `steps` state. `input_required`, a confirmation, the form, expiry and activity cards come from the stub's scenarios in `e2e/agui-hitl.spec.ts` (screenshots in `e2e/screenshots/`), since Pydantic AI 2.56 sends only `tool_call` interrupts and no activity events (`part2-hitl-state-files.md` §1.2, §3.1). Wait for their word.

A problem they report becomes a fix on this branch (superpowers-extended-cc:systematic-debugging): Steps 1–12 run again for what it touched, the fix is pushed to the PR, and spec §0's row says so.

When the owner has merged the PR (the merge is theirs), close the two issues by hand, since the keywords do not fire for this base, and remove the local branch (AGENTS.md: `gh pr merge … --delete-branch` and the web button delete only the GitHub branch):

```bash
PR=$(gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json number --jq .number)
gh issue close 67 -R LovingCivilian/dify-app-hub --comment "Fixed by #$PR (Part 2b), merged into fork/overhaul."
gh issue close 68 -R LovingCivilian/dify-app-hub --comment "Fixed by #$PR (Part 2b), merged into fork/overhaul."
git switch fork/overhaul && git pull --ff-only origin fork/overhaul && git branch -d feat/agui-hitl
git ls-remote --heads origin feat/agui-hitl
```

Expected: both issues closed; the branch deleted locally; `ls-remote` prints nothing (if it prints the branch, `git push origin --delete feat/agui-hitl`). The merge's own record (spec §0's Merged cell, the running record) goes with 2c's plan branch, as 2a's did (decision 61).

- [ ] **Step 17: The way back (only on the owner's word)**

Start 2a's image again:

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker image tag ai-app-hub-local-app:part2a ai-app-hub-local-app:latest
docker compose -f docker-compose.local.yml up -d --no-build app
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health
```

Expected: `200`. The database stays as it is: 2b ran no migration, and 2a's code reads 2b's rows (`askUser` and `beforeStream` are dropped by 2a's zod schemas; the `tool` messages 2b wrote are ordinary AG-UI messages). Under 2a, a refused answering run counts as the conversation's last run again, so the items it would have kept open close (2a's rule), and a waiting `ask_user` question is answered `not_available` by the next run. The 2b image loses its `:latest` tag; Step 9 rebuilds it.

```json:metadata
{"files": [], "verifyCommand": "docker compose -f docker-compose.local.yml logs app | grep -c \"Database migration complete\" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app && gh pr view feat/agui-hitl -R LovingCivilian/dify-app-hub --json state,baseRefName --jq '\"\\(.state) \\(.baseRefName)\"'", "acceptanceCriteria": ["Steps 1-6 green on the whole branch: nothing on fork/overhaul missing from the branch, tsc, oxlint, oxfmt, antd lint total 0, i18n lint and status, the four boundary checks empty (no @ag-ui/client or encoder in browser code; @ag-ui/core type-only in components and the client-safe lib/chat modules; provider modules only through the registry; nothing changed under db/ or in package.json and pnpm-lock.yaml), pnpm test, pnpm test:db, pnpm test:ldap, pnpm test:e2e 0 failed on three projects", "the owner's go-ahead to Step 7 captured before Step 8", "image tagged ai-app-hub-local-app:part2a, never overwritten; migration rows and apps and conversations counts printed before the rebuild", "after the rebuild: one 'Database migration complete', RestartCount 0, the same six migration rows ending _agui_provider and _conversations, the same counts", "the bundle check prints 0 and 0", "every signed-out check of Step 12 answers as listed; /api/health 200 and RestartCount 0 after restarting postgres", "feat/agui-hitl pushed; PR to fork/overhaul open with the template's sections, ADR-0017, ADR-0033 and ADR-0034 named, Closes #67 and #68, the #69 note and the session's attribution lines", "#69 has the comment and its answer-pending hint item is ticked", "spec §0's 2b row names the PR and the gates' commit; running record decision 65 written and pushed"], "modelTier": "standard", "userGate": true, "tags": ["user-gate"]}
```

---

## Self-review: spec coverage

Each requirement of spec §6 and 2b's rows elsewhere, with the task that builds it and the test that proves it.

| Spec | Requirement | Task | Proof |
| --- | --- | --- | --- |
| §2.2 | `askUser`, a boolean defaulting to false; a 2a document still parses; the chat DTO carries it, never the URL, audience or secret | 1 | `agui-schema`, `provider-registry`, `data-apps` tests; Task 17's admin test |
| §6.1 | The gated call's ThoughtChain item shows Approve (primary) and Reject, the arguments read-only | 11 | Task 17: approve, reject |
| §6.1 | The answer follows the interrupt's `responseSchema`: first required boolean, `reason` on Reject, `{ approved }` without a schema (P5) | 3 | `chat-interrupt-answers.test.ts`: Pydantic AI, MS Agent Framework, Strands, Mastra, the AG-UI recommendation |
| §6.1 | Several interrupts: the decisions wait until every one has one, then go as one `resume[]` (decision 62) | 10, 7 | `shared-chat-answers.test.ts` (`decide`); `chat-answers.test.ts` (coverage); Task 17: two approvals, one request |
| §6.1 | An interrupt past `expiresAt` shows as expired and offers only Dismiss (`cancelled`) | 3, 10, 11, 13, 7 | `isExpired` against the client's own rule; `checkAnswers` refuses a resolved expired one; Task 17: expired |
| §6.1 | The server rebuilds `resume[]`, re-checks coverage, unknown ids and expiry, and stores the answers on the run | 7, 8 | `chat-answers.test.ts`, `chat-run.test.ts` |
| §6.1 | The resumed run's result merges into the gated card; the turn continues in place through `onReload` | 5, 10 | `chat-turn.test.ts` (live and history agree); Task 17: the result in the same bubble |
| §6.2 | `ask_user` advertised only while the switch is on (decision 46; decision 62) | 1, 2, 8 | `chat-run.test.ts`, `agui-chat.test.ts`; Task 17: the switch off, then on |
| §6.2 | The template's name, schema (1–10 questions, limits) and description, adapted | 2 | `chat-ask-user.test.ts` |
| §6.2 | Arguments are untrusted: zod; invalid shows "The agent asked an invalid question" with Dismiss, which answers with an error (P3) | 2, 7, 11, 12 | `chat-ask-user.test.ts`, `chat-answers.test.ts`; Task 17: badquestion |
| §6.2 | The card above the composer: "Question 2 of 3", options as vertical `Prompts`, digit keys, an `Input` when `allow_custom`, Skip and Dismiss (P4) | 12, 15 | `shared-chat-ask-user-steps.test.ts`; Task 17: click, free answer, digit key, Skip, Dismiss |
| §6.2 | The answer is a `tool` message with the template's Q/A transcript; the hub writes it into the turn; the card in the transcript shows the questions and answers | 2, 7, 10, 11 | `askUserTranscript` tests; `shared-chat-provider.test.ts`; Task 17: the agent echoes the transcript |
| §6.2 | A pending call is derived (no `pendingToolCallIds` from the client) | 5, 7 | `chat-open-items.test.ts`, `chat-answers.test.ts` |
| §6.2 | A call to a tool the hub never advertised is answered "This tool is not available here" and never blocks | 8 (2a's P4 kept) | `chat-run.test.ts`: the switch-off path |
| §6.3 | Any other interrupt: an antd `Card` titled from the reason, its message, a flat form (P7), Submit and Cancel; `confirmation` without a schema: Yes and No (P6); outside the subset: message and Cancel (P8) | 3, 13 | `chat-interrupt-answers.test.ts`, `shared-chat-interrupt-form.test.ts`; Task 17: form, confirm |
| §6.3 | The server validates answers against the same subset | 3, 7 | `payloadAccepted` tests; `chat-answers.test.ts` |
| §6.3 | While anything is open the Sender is disabled with a hint; the server answers 409 `answer_pending`; every card has a way out | 8, 15 | `chat-run.test.ts`; Task 17: the hint and the disabled Sender in each scenario |
| §6.4 | The plan panel: `{ steps: [{ description, status }] }` (zod), "Plan 2/5", `Progress`, vertical small `Steps`, the status mapping, collapsed once complete (P17) | 4, 14, 15 | `chat-plan-state.test.ts`; Task 17: plan, finish plan |
| §6.4 | Other state is not shown; users cannot edit state | 15 (nothing renders it) | — |
| §6.4 | Activity cards: a small `Card` titled with `activityType`; flat content as `Descriptions`, anything else as collapsed JSON capped at 10 KB; text only | 4, 14, 15 | `shared-chat-activity-view.test.ts`; Task 17: activity |
| §8 | No new error code in 2b: `answer_pending` and `answers_invalid` exist | 7, 8 | `chat-run.test.ts` |
| §10 | Unit: the approval payload builder, the `ask_user` check and transcript, the plan-state parse, the flat-schema validator | 2, 3, 4 | the four test files above |
| §10 | e2e: an approval (approve, reject), `ask_user` (answer, skip, dismiss), `input_required`, plan state, activity | 16, 17 | `e2e/agui-hitl.spec.ts` on three projects |
| §10 | The Docker gate | 19 | Task 19 |
| §11 | Notes on ADR-0034 (`ask_user`, the interrupt answers, the plan state shape); `docs/agui-agents.md` the same three | 18 | Task 18's greps |
| §12 | 2b done when: approvals, `ask_user`, `input_required`, the plan panel and activity cards work against the stub and the owner's service; the composer blocks while something is open | 17, 19 | the e2e suite; the owner's check (their Pydantic AI service emits `tool_call` interrupts and can call frontend tools; `input_required`, `confirmation`, plan state and activity are proven against the stub only) |

**Issues.** #67 (a failed answer swallowed): Task 10's `fallbackTurn` (P11) with Task 8's refused-run rule (P10, decision 62), proven by Task 17's `fragile` scenario. #68 (the queued-send flag): Task 9, in both hooks. #69's answer-pending hint: Task 15 (P15). #66 (the orphan conversation) is untouched: 2b changes the refusal path only for answering runs (P10).

**Placeholder scan.** No step says "TBD", "similar to Task N" or "add error handling"; every code step holds its code. The only fill-ins are Task 18's and 19's tokens (`TODAY`, `PLAN_PR`, `PR_NUMBER`, `DEVIATIONS`), which their steps fill from a command or the commits.

**Type consistency.** The Shared contracts name every cross-task export; the pre-flight run (below) applied Tasks 1–17 in order in one scratch copy and type-checked every file, tests included.

## Pre-flight (2026-10-15)

Before this plan's PR, Tasks 1–17 were applied exactly as written, in order, to one scratch copy of `fork/overhaul` at `e8530dcc` (one commit per task), the 2a handoff's first lesson: every Find fragment matched once, and every test file was type-checked. Two plan slips were fixed then: Task 3's boundary grep matched comments (now `from '@ag-ui`), and Task 15's `turn-parts.ts` fragment quoted 2a's import instead of Task 5's. After Task 17: tsc clean; `pnpm test` 2,479 passed (189 files); `pnpm test:db` 97 passed; oxlint and oxfmt clean on the 81 changed files; the antd lint at 0; `i18next-cli lint` clean and zh and ar at 100%; Task 19's boundary greps empty. e2e: `agui-hitl`, `agui-admin` and `agui-chat` on desktop-light 28 passed; `agui-hitl` on mobile-light 15 passed and with `agui-admin` on desktop-dark 18 passed; the Dify chat's `chat` and `chat-race` on desktop-light 25 passed (Task 9); the `chat-agui` screenshots on three projects 13 passed. Each task's Acceptance counts are the ones seen. The build still runs every gate itself: the pre-flight proves the plan applies, not the branch.

Two observations for the owner's review, unchanged by the plan: while an `ask_user` call waits, its questions show both in the turn's "Questions for you" item and in the card above the composer, as the full-stack template shows them (its `AskUserResult` lists the waiting questions beside its `QuestionPrompt`); and at phone width Next's dev indicator covers the Sender's button, so the specs press buttons there from the keyboard (ADR-0028's note).
