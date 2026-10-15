---
status: accepted
date: 2026-10-15
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (Part 2b build, the look loop on the dev server, 2026-10-15)
---

# Show the shared chat's tool calls and requests as one card, and record the sent answers

## Context and Problem Statement

Part 2b ([ADR-0034](0034-add-ag-ui-agents-as-a-provider.md)) shipped the shared AG-UI chat's human-in-the-loop parts in Ant Design X's own components: tool calls as `ThoughtChain` items with Approve and Reject under them, interrupts as plain antd `Card`s, "Plan 2/5" in a `Collapse`, activity as a small `Card`. The owner looked at it on the dev server with a stub agent that plays every scenario (`e2e/fixtures/stub/`) and asked for one look instead: Vercel AI Elements' `Tool` component (https://elements.ai-sdk.dev/components/tool), which they found "very good and align with what I had in mind". During the same review they found two gaps in what 2b kept:

- A decision lived only in the browser's draft until it was sent, and afterwards nothing showed it: after a reload, or on another device, an approved call or an answered form looked as if it had never been asked ("record everything that happens in the chat, so even with other browsers or devices, it will still have all the data").
- Cards nested a bordered box inside a bordered card, so most cards showed two borders ("the inner border should be for the choice you selected, like in the tool").

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)): antd 6.6.5 and Ant Design X 2.9 components with their documented props, no style overrides beyond token-only CSS Modules ([ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)).
- One look for everything the chat shows in a turn or above the composer.
- What the user decided must survive a reload and show on any device, from what the hub already stores.
- Every agent string renders as text, never HTML (Part 2 spec §6.4).

## Considered Options

The tool call's look:

- X `ThoughtChain` items (2b as built)
- An antd tree `Table` for arguments and results with a Table/JSON switch (tried on the dev server; the owner turned it down)
- AI Elements' `Tool` rebuilt on antd: a `Collapse` card with the arguments and the result as plain JSON code blocks

Where the user acts:

- A bordered box holding the card's whole body (2b as built, and the first unified version)
- A bordered box only around the action, or around the choice once made; everything else without a border

The sent answers:

- Keep them in the browser only (2b as built)
- A new table for decisions
- Read back the `resume` list the hub already stores on each run ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md): "its `resume` stays on the row")

## Decision Outcome

Chosen: AI Elements' `Tool` on antd as the one card, the box only around the action or the choice, and the sent answers read back from each run's stored `resume`.

### One card

`ChatCard` (`components/shared-chat/chat-card.tsx`) is an antd `Collapse` with one small panel and the arrow at the end: the header is an icon, the title in strong text and a status `Tag` with a preset status colour and an icon (the Tag "status" demo), as AI Elements' `ToolHeader` and `getStatusBadge`. A card opens in one of three ways: collapsible with `defaultOpen` (keyed, so it opens when its call completes), held open or held closed (`fixed`, no arrow, the header does not toggle), or controlled by its owner (the plan panel). Every card in the turn and above the composer uses it: the tool card (`tool-chain.tsx`), the interrupt card and its answered form (`interrupt-card.tsx`, `answered-interrupt-card.tsx`), the activity card, the plan panel ("Plan" with a "1/3" badge that turns "Completed") and the `ask_user` question card, which keeps its Claude-style layout (pager and ✕ in the header's `extra`). Icons and badges are decided in `chat-card-view.ts` and `card-icons.tsx`; X `Think` ("Finished thinking") and the run-error `Alert`s stay as they are.

### The tool card

As AI Elements' `ToolContent`: the arguments, then the request when the call waits for one, then the result, each argument and result block an X `CodeHighlighter` as shipped (JSON, or a text result as Markdown; `code-section.tsx`), a call's error in an `Alert`. Completed, failed and waiting-for-approval cards start open ("Auto-opens completed tools by default"). The tree table and its switch are gone.

### The box

Content has no border: a form's fields, the agent's message once answered, the submitted values (antd `Descriptions` for a flat object, else JSON), the `ask_user` questions over their answers. The bordered box, an antd `Card size="small"`, holds only what the user acts on or chose: while waiting, the agent's message with the buttons at its end, negative first and primary last (Reject then Approve; Cancel then Submit; No then Yes; Dismiss once expired); once answered, the receipt alone ("✓ Approved", "✕ No", "✓ Submitted", "✓ Answered", "Cancelled"); while a choice waits in the draft for the other answers, its Tag with Change. A form's answer reads "Submitted", in the box and the header.

### The recorded answers

`lib/chat/sent-answers.ts` reads each run's `resume` (`TurnRunRow.resume`, selected by `readThreadPage`; a malformed list reads as none) against the run it continued: an approval bound to a call in the turn becomes that call's `ToolPart.decision`, any other answer an entry of `Turn.answered`, shown read-only in the turn it continued (`AnsweredInterruptCard`). A run refused before its stream records nothing, as it never reached the agent. The live chat merges the same answers when they go (`transformParams`), and a resumed run that starts a decided call again keeps its decision, so the live view and the reloaded one match. The `ask_user` answers need nothing new: their transcript is the stored `tool` message, which the card now reads back into each question's answer (`askUserAnswersOf`, round-trip checked; any other result shows as sent). Unsent choices stay in the browser's draft.

### Consequences

- Good, because one card, one place to act and one record: what the user decided shows the same live, after a reload and on another device.
- Good, because no new table or column: the `resume` jsonb already held every answer.
- Good, because the look follows a well-known reference (AI Elements) on documented antd and X components.
- Bad, because the cards no longer use X `ThoughtChain`, which [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md) listed among the native chat components; the turn renders its tool calls itself.
- Bad, because an antd Collapse header is a button, so the question card's pager and ✕ in its `extra` are buttons inside it (antd's documented "extra" pattern); a screen reader hears nested controls.
- Neutral, because the e2e suite's locators moved with the look (the final pass of PR #72).

## Implementation Plan

- **Affected paths**: `components/shared-chat/` (`chat-card.tsx`, `chat-card-view.ts`, `card-icons.tsx`, `tool-chain.tsx`, `tool-views.tsx`, `tool-view-data.ts`, `code-section.tsx`, `approval-actions.tsx`, `interrupt-card.tsx`, `answered-interrupt-card.tsx`, `answer-record.tsx`, `answer-receipt.ts`, `decision-note.tsx`, `decision-receipt.tsx`, `request-message.tsx`, `activity-card.tsx`, `plan-panel.tsx`, `ask-user-card.tsx`, `turn-list.tsx`), `lib/chat/sent-answers.ts`, `lib/chat/turn.ts`, `lib/chat/ask-user.ts`, `lib/data/conversations.ts`, the locale files.
- **Pattern**: a new card in the shared chat is a `ChatCard`; its badge and icon are decided in `chat-card-view.ts` (unit-tested); a bordered `Card size="small"` appears only around what the user acts on or chose.
- **Avoid**: a bordered box around a card's whole body; ThoughtChain or a table for tool data; agent strings as HTML; storing decisions anywhere but the run's `resume`.
- **Tests**: `__tests__/shared-chat-card-view.test.ts`, `shared-chat-tool-views.test.ts`, `chat-ask-user.test.ts`, `chat-turn.test.ts` (live and history parity), `__tests__/db/` for the thread page's `resume`; e2e `agui-chat.spec.ts` and `agui-hitl.spec.ts`.

### Verification

- [ ] Every card in the shared chat renders through `ChatCard`: `tool-chain.tsx`, `interrupt-card.tsx`, `answered-interrupt-card.tsx`, `activity-card.tsx`, `plan-panel.tsx` and `ask-user-card.tsx` each import it.
- [ ] An approved, rejected or cancelled call shows its receipt between Arguments and Result after a reload (e2e `agui-hitl.spec.ts`).
- [ ] A submitted form shows its values and "Submitted" after a reload; a confirmation shows Yes or No.
- [ ] `turnsFromMessages` and the live path build the same turns for the same runs (`chat-turn.test.ts`).
- [ ] `pnpm test`, `pnpm test:db` and `npx -y @ant-design/cli lint ./` pass at zero findings.

## More Information

- AI Elements `Tool`: https://elements.ai-sdk.dev/components/tool, source `vercel/ai-elements` `packages/elements/src/tool.tsx` (`ToolHeader`, `getStatusBadge`, `ToolContent`, `ToolInput`, `ToolOutput`, and its `Confirmation` inside the card).
- antd 6.6.5: `Collapse` (`items`, `extra`, `showArrow`, `activeKey`), `Tag` status demo, `Card`, `Descriptions`; Ant Design X 2.9 `CodeHighlighter`.
- Part 2 spec `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md` §5–§6; ADR-0033 and ADR-0034 carry notes pointing here.
- Commits on `feat/agui-hitl` (PR #72), 2026-10-15: `1b62387b` (tool cards), `0d976c6a` (approval inside), `e69c1dbe` and `c4f3d965` (recorded answers), `86d6e34e`, `766dfb88` (one card), `cc920559`, `f95cfb82` and `91688156` (the box rule).
