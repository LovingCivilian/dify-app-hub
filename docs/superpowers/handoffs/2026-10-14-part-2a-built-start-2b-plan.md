# Handoff: Part 2a is built (PR #70); start 2b's plan (2026-10-14)

The next session **writes the plan for slice 2b of Part 2, human in the loop**: tool approvals, the hub's `ask_user` tool, other interrupts and the blocked composer, the plan panel and activity cards (spec §6). 2b's design is already settled by the approved Part 2 spec, so this session writes a plan, not a spec. Before writing, it checks one thing: whether PR #70 has merged. Start with spec §0, the source of truth for Part 2's state.

## Where things stand

- **PR #70** (`feat/agui-core` → `fork/overhaul`, pushed) holds all of 2a: 19 tasks, each reviewed, then a final whole-branch review and one fix wave. It passed every gate at `413a0fe6`: the unit, database, directory and e2e suites, with e2e at 662 passed and 0 failed. It also passed the Docker gate. **It is not merged.** The owner was remote and will check it in a browser first, on the morning of 2026-10-15. ADR-0033 and ADR-0034 were accepted on the owner's word before that check (running record decision 60, with their words).
- **The owner's local stack** (`localhost:5300`) already runs `feat/agui-core`, with both new migrations applied. The Part 1 image is kept as `ai-app-hub-local-app:part1`, and its database dump is at `~/ai-app-hub-backups/local-before-part2a.sql` (mode 600, never printed). Both stay until the owner lets them go. Task 19 Step 14 of the 2a plan is the written way back, run only on the owner's word.
- **Still open for 2a:**
  - the owner's check (spec §12, "2a done when"); a problem it finds is fixed on `feat/agui-core`, and the gates that the fix touches are re-run;
  - then the merge;
  - then `git branch -d feat/agui-core`;
  - then a comment on issue #62 naming the three items 2a closed (typed DTO fields, no client-registry cast, M5);
  - then spec §0's 2a row records the check and the merge.
- **The record of what 2a did:** spec §0's 2a row, running record decisions 58–60, ADR-0033 and ADR-0034, `docs/agui-agents.md`, and the PR #70 description, which lists the 12 plan deviations and the fix wave. Follow-ups: #66, #67, #68, #69.

## Before 2b's plan is written

- **Decision 33:** a plan is written against the code as it stands after the previous slice merged. So 2b's plan starts from `fork/overhaul` once #70 is merged. If #70 is still open, ask the owner whether to wait or to plan against `feat/agui-core`. Don't assume. The plan goes on `docs/part-2b-plan` with its own PR. The build then runs on `feat/agui-hitl` (spec §0 table).
- **The 2a code that 2b extends** (read these files; the 2a plan's "Shared contracts" describe them):
  - **The server:** `lib/chat/answers.ts` and the `answers` body in `lib/chat/schemas.ts` already accept and check answers (plan call P3).
  - **The browser:** `components/shared-chat/` still disables the Sender while an answer is pending. It shows `shared_chat.answer_pending_hint`, which 2b replaces and gives a way out.
  - **The tools:** 2a advertises no tools (`tools: []`, P4), and the `askUser` document field is 2b's (spec §2.2).
- **Issues that 2b must handle:**
  - **#67:** `fallbackTurn` swallows a failed answer to an interrupted turn. 2b is the first slice that sends answers, so it must show this error.
  - **#68:** the queued-send key gets stuck in both chat hooks. Fix it in both hooks or neither: `components/chat/**` must behave as before.
- **What else 2b's plan takes in:**
  - **#69**, the AG-UI core follow-ups, especially the answer-pending hint shown only as a placeholder;
  - **#66**, the orphan conversation, if 2b changes the refusal path;
  - the spec's 2b rows in §8 (errors), §10 (tests: the approval payload builder, the `ask_user` check and transcript, the plan-state parse, the flat-schema validator), §11 (records: notes on ADR-0034 and `docs/agui-agents.md`) and §12 (done when).
- **Inputs:**
  - The spec: `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §6, plus 2b's rows in §1, §2.2, §8, §10, §11 and §12.
  - The research: `docs/superpowers/research/2026-10-11-provider-hub/`. It holds `part2-hitl-state-files.md` (research D: `ask_user`, tool approvals and shared state for 2b, attachments for 2c), `agui-spike.md` (Appendix A is a scripted Pydantic AI agent for local runs; Appendix B is the stub) and `part2-x-mapping.md`, which maps X components to tool and approval cards.
  - The owner's agent service contract (memory `agent-service-contract`).
  - The 2a plan, `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md`, as the model for structure, granularity and the `json:metadata` fences.

## How to work (standing rules, all in AGENTS.md or memory)

- The superpowers-extended-cc skills run the workflow.
- Branch in place in `~/repos/dify-app-hub`, with no worktree.
- Run `nvm use` first (Node 22).
- Documented approaches only, with a source per piece (ADR-0002), checked against every source AGENTS.md names.
- A new pattern or dependency gets an ADR or an ADR note in the same PR.
- Commits carry the session's `Co-Authored-By` and `Claude-Session` trailers.
- Follow-ups go in `fork/overhaul` issues.
- A handoff document only when the owner asks.

## Lessons from 2a's plan and build (for writing 2b's plan)

- **Pre-flight found real plan slips.** A read-only scan of the 16k-line plan before Task 1 found:
  - a test fed content without its start event;
  - a test helper typed `string` where tsc needed the union;
  - two ADR index rows that oxfmt merged into one line when it formatted the plan.

  In 2b's plan, type-check every test file in the scratch runs, not only the code. Write table rows that survive oxfmt, and re-read them after formatting.

- **The reviews' main catches were in cross-task timing:**
  - a run registered in memory only after the database marked it active;
  - a delayed write landing after a run ended;
  - a stream released before its run was stored.

  Plan these orderings explicitly and give each a test.

- **Facts checked about the libraries:**
  - `@ag-ui/client` 1.0.2 `runAgent` resolves on an agent `RUN_ERROR` and on a stream with no terminal event; the end is decided from the events.
  - `onStateChanged` doesn't fire at the start of a run.
  - An abort emits the client's own `RUN_ERROR { code: 'abort' }`.
  - The client `console.error`s every failure with its cause, so keep agent details out of errors the hub throws.
  - In x-sdk 2.9, `isRequesting` clears only when the stream closes.
- **e2e:**
  - A full run takes about 32 minutes. Run it in the background, never two heavy processes at once.
  - Stale `.next/dev/types` after an e2e run breaks `tsc`; delete it and re-run typegen.
  - At phone width Next's dev indicator covers the Sender's action button, so tests press it from the keyboard (ADR-0028 note).
  - Spec prompts must avoid the stub's scenario keywords (`tool`, `slow`).
- **Wording:** every text an agent's admin or user sees must fit AG-UI as well as Dify. The final review caught Dify-only Test connection texts shown for AG-UI.

## Suggested skills

- `superpowers-extended-cc:writing-plans`: 2b's plan, from spec §6.
- The Ant Design X skills for the cards and panels: `x-components` (`ThoughtChain`, `Think`, `Actions`), `x-card` (A2UI / generative UI, for activity cards), `use-x-chat`, `x-chat-provider`, `x-markdown`. Also `antd`, for the forms inside cards.
- `context7-mcp` and `crawl4ai`, for AG-UI's interrupt and `input_required` docs, Pydantic AI's deferred tools and approvals, and the reference projects in the research notes.
- `adr-skill`: the ADR-0034 notes for `ask_user`, the interrupt answers and the plan-state shape (spec §11).
- `superpowers-extended-cc:subagent-driven-development`, later, for the build.
