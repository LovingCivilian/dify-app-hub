# Handoff — sub-project 2 (chat on Ant Design X): spec and plan approved, execution not started

> 2026-10-05: this is the planning session's record. Where it conflicts with the chat spec's "Deviations during execution" paragraph or ADR-0017's dated notes (history pages are oldest first; X 2.9.0 colours neither feedback choice), those win.

Date: 2026-10-04 · Branch: `feat/chat-on-ant-design-x` (from `fork/main` @ 11c3fb3d; one commit, 36998edc, not pushed) · Written by the brainstorming/planning session for the executing session.

## What the next session is for

Execute `docs/superpowers/plans/2026-10-04-chat-on-ant-design-x.md` (20 tasks) with `superpowers:subagent-driven-development`, per-task review, a whole-branch review, then the Docker gate and a PR to `fork/main`; end with a handoff under `docs/superpowers/handoffs/`.

## State of the work

- Done this session: brainstorming (architectural path; three clarifying questions; approach chosen; six design sections approved one by one), the spec `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md` (approved with "go"), the plan (reviewed as "capture what you want" was asked; the owner answered "commit" and asked for this handoff, so treat the plan as approved for execution unless the owner says otherwise at the start of the new session).
- Not done: no product code, tests or stub changes yet. Nothing is pushed. PRs #7 and #8 are still open (the plan closes them in Task 20 only after an explicit go-ahead).
- Working tree: clean after commit 36998edc (spec + plan) plus the commits this handoff ships with (handoff doc, `CLAUDE.md` pointer update).

## Read first, in this order

1. `CLAUDE.md` (rules and pointers; the "Decisions" lines and "Local testing" sections), `.claude/rules/frontend.md`.
2. `docs/decisions/README.md`, then ADRs 0002, 0008, 0010, 0011, 0012, 0014 (binding for this work). ADRs 0016–0018 do not exist yet; Tasks 1, 2 and 4 create them as `proposed`.
3. The spec (§2 resolves the eight questions from the owner's brief; §16 lists the sources per API decision).
4. The plan: header, Global Constraints, Review Focus, File structure, then tasks in order. Every task carries its code, tests, commands and commit message with the two attribution trailers.
5. The skills under `.claude/skills/` for the component you touch (`antd`, `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`); the plan cites their sections.

## Owner decisions taken this session (not derivable from the documents' text alone)

- Scope: **every app mode, full page** (chat, agent, chatflow, workflow, completion), not chat-like only.
- PRs #7 and #8: **absorb** their behaviour as requirements but **re-derive the implementation from the docs** (Dify OpenAPI `StreamEventBase`, X `Actions.Feedback` semantic slots); "don't follow them to the tee, research them again". Close them as superseded only when the owner says so.
- Dark first paint: **cookie-backed theme** (not "accept the flash", not a body-only inline script).
- Approach: **A, provider-centred rebuild** (one `AbstractChatProvider`, `useXChat` with `conversationKey` + async `defaultMessages` + `queueRequest`, `useXConversations`, X components via `contentRender`, custom HITL/logs/files on antd primitives).
- Process confirmed: brainstorm → spec → plan → subagent-driven execution with the models named in that skill's execution notes; "as robust as possible, the more eyes the better"; documented approaches only, cite the source per API decision; commit only when asked (the owner asked to commit the spec/plan; per-task commits are part of the approved plan).

## Facts verified this session that the next session should not re-derive

- `@ant-design/x-sdk` 2.9.0 internals (read, not documented): the message store is per `conversationKey` in a module-global map and `defaultMessages` runs only when a key's store is first created; `queueRequest` flushes when `isDefaultMessagesRequesting` turns false; `onReload` adds no local bubble and calls `transformMessage` **without** `originMessage` on the first chunk (hence the provider's `resumeBase`); `IsRequestingMap` is per key; `setMessages`/`setMessage` accept updater functions; `transformLocalMessage` may return `[]`. `XRequest`'s JSON handler treats only `success === false` as an error, so non-OK proxy answers must be thrown from the `fetch` option.
- antd 6.6.5: `Grid.useBreakpoint()` returns `defaultScreens` (`{}`) on the server and the first client render (layout effect subscribes later) → breakpoint markup must be CSS-switched (spec §3.3). `Statistic.Countdown` is deprecated in favour of `Statistic.Timer`; `Alert` uses `title` (`message` deprecated).
- `@ant-design/x` 2.9.0 ships `en_US` and `zh_CN` only; `xLocale` type (20 strings) is exported from `@ant-design/x/es/locale`. `Actions.Feedback` has `styles`/`classNames` slots `like`, `liked`, `dislike`, `disliked`; only dislike is coloured by default (`colorError`).
- `@ant-design/x-markdown` 2.9.0 exports `XMarkdown`, `useStreaming` and the type `ComponentProps` (`domNode`, `streamStatus`, `lang`, `block`); `plugins/Latex`, `themes/light.css`, `themes/dark.css` exist.
- Dify's OpenAPI document: `https://raw.githubusercontent.com/langgenius/dify-docs/main/en/api-reference/openapi_service.json` ("Dify Service API", 64 paths). Stream schemas: `ChunkChatEvent`/`ChunkWorkflowEvent` unions, `StreamEventBase`, `StreamEventChatReasoningChunk` (`data.is_final`), `StreamEventHumanInputRequired`, `StreamEventWorkflowPaused`, `StreamEventHumanInputFormFilled/Timeout`, `StreamEventNodeRetry`, `StreamEventWorkflowStarted.data.reason` (`initial` | `resumption`). Human-input field types are `paragraph`, `select`, `file`, `file-list`. `POST /chat-messages` has no `parent_message_id` (regenerate = new turn). `GET /messages` is newest first. The run stop endpoints (`/workflows/tasks/{task_id}/stop`, `/completion-messages/{task_id}/stop`) have **no proxy route** in this app; the plan aborts the fetch instead (no backend changes).
- Next 16 bundled docs: `cookies()` in a layout makes the route dynamic (fine, every page is per-user); layouts do not re-render on navigation and cannot read the pathname (the proxy stays the navigation gate); `preventing-flash-before-hydration.md` exists but cannot switch antd's algorithm, hence cookies. next-auth v4 Context7 id: `/websites/next-auth_js` (`getServerSession` in server components; `SessionProvider session` prop avoids the loading state).
- `pnpm dev` on 5300 was **not running** at the end of this session, so whether `next dev` inlines the antd `<style id="antd-cssinjs">` in the server HTML is unverified; the plan asserts the inlined dark token on the production build only (Task 20 curl) and the body class in dev.
- Memory on the WSL box is ~5 GB: never run the Docker build and `pnpm test:e2e` together; one `next dev` per checkout.

## How to execute

- Skill: `superpowers:subagent-driven-development` with the plan path; use the models its execution notes prescribe for implementer and reviewer; a fresh reviewer per task; whole-branch review on the most capable model at the end; `superpowers:verification-before-completion` before any "done".
- Each task's report names the doc source per API decision (ADR-0002) and any deviation from the plan with its reason (the docs win over the plan).
- Run only the specs a task names; the full `pnpm test:e2e` at Tasks 1, 2, 5, 9, 17, 19 (stop `pnpm dev` first). Playwright timeouts are already raised for cold Turbopack compiles.
- Commits: conventional, English, the two trailers from the plan's Global Constraints; `git add` only the task's paths.
- ADR scripts: `node .claude/skills/adr-skill/scripts/new_adr.js --dir docs/decisions --title "…" --status proposed --update-index`; `node .claude/skills/adr-skill/scripts/set_adr_status.js <path> --status accepted`.
- Task 20: push, `gh pr create -R LovingCivilian/dify-app-hub --base fork/main …` (template in `.github/PULL_REQUEST_TEMPLATE.md`), Docker rebuild and the six curl checks; closing #7/#8 waits for the owner's word.

## Open items and follow-ups outside the plan

- Owner verifies in the browser against a real Dify server after the PR: each app mode, HITL, files, TTS/STT, dark first paint, mobile.
- `/api/users/*` revoked-session gap (ADR-0006) stays open; RTL, roles, LDAP, `chat_color_theme`, conversation id in the URL are out of scope (spec §1).
- Sub-project 3 inputs to carry: `LucideIcon` and any `useDifyChatStore` leftovers outside `components/chat/` found by Task 19's grep; the apps page still renders `UserShell` itself.
- Default GitHub branch is still `main`; merged branches not yet deleted (CLAUDE.md follow-ups).

## Suggested skills

`superpowers:subagent-driven-development` (execution), `superpowers:test-driven-development` and `superpowers:verification-before-completion` (implementers), `superpowers:requesting-code-review` / `superpowers:receiving-code-review` (reviews), `superpowers:systematic-debugging` (failures), `superpowers:finishing-a-development-branch` (before the PR), repo skills `antd`, `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`, `adr-skill`, and the user-level `handoff` at the end. Documentation lookups: Context7 (`npx ctx7@latest …`, max three commands per question), Next's bundled docs under `node_modules/next/dist/docs/`, crawl4ai in `.venv` for pages that need a browser.

No secrets in this document; `.env` and `.env*.local` were never read or printed.
