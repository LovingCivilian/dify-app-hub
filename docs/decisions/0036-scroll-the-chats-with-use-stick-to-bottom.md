---
status: accepted
date: 2026-10-15
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (Part 2b look loop; measurements in Playwright Chromium and Firefox 155, 2026-10-15)
---

# Scroll the chats with use-stick-to-bottom

## Context and Problem Statement

Both chats (the Dify chat's `MessageList` and the shared chat's `TurnList`) let Ant Design X's `Bubble.List` scroll itself with `autoScroll`. X lays the list out bottom-up (`flex-direction: column-reverse`, `es/bubble/style/list.js`) so it follows a streaming answer, and when the reader is away from the bottom it holds the view in place by script: a ResizeObserver on the list's content resets `scrollTop` to a value saved at the last scroll event (`es/bubble/hooks/useCompatibleScroll.js`, "Safari 兼容…", added by X PR #1690 for issue #1684, "Thinking 组件在 Bubble.List 里折叠展开会影响滚动位置"). The owner, in Firefox: "when I expand a card or thinking block, while expanding it jumps up and then down … only when the chat is not scrolled to the bottom".

Measured on a page built from the real components and the real shell layout (no other scroller moves; our layering is not the cause): while a card animates open, X's correction lags the growth. Where the browser's own scroll anchoring holds the view, that lag stays at 1–2 px; with anchoring off for the scroll box, the clicked header rises about 170 px in Firefox and comes back when the animation ends, which is the owner's report. Firefox turns anchoring off for a container after 10 consecutive adjustments within 500 ms averaging under 2 px (`layout.css.scroll-anchoring.max-consecutive-adjustments`, `ScrollAnchoringDisabledInContainer`), and nothing turns it back on until the container is rebuilt. X 2.9.0 is the latest release; it has no option for its correction besides `autoScroll` itself.

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)); a workaround only with the owner's word, marked with its upstream issue.
- Opening a card or a thought must not move what the reader looks at, in Chromium and Firefox, at any display scaling.
- Keep what auto-scroll gave: a conversation opens at its latest message, the answer is followed while the reader is at the bottom, reading further up is never pulled down.
- A send brings the reader to their message (the owner: sending while scrolled up "doesn't auto scroll to the bottom").

## Considered Options

- Keep X's `autoScroll` (the jump stays in Firefox; nothing to configure)
- Turn off the cards' open animation (measured worse: one frame jumps up to 800 px, X's correction lags a frame even then)
- `overflow-anchor: none` on the scroll box (measured: removes the browser's anchoring, which is what was holding the view; the jump appears in every browser)
- `autoScroll` off and our own stick-to-bottom code (a custom mechanism)
- `autoScroll` off inside use-stick-to-bottom, as AI Elements' `Conversation` does

## Decision Outcome

Chosen: `autoScroll` off inside use-stick-to-bottom 1.1.6 (StackBlitz Labs, MIT, zero dependencies, React 16–19), the library AI Elements builds its `Conversation` on (`vercel/ai-elements` `packages/elements/src/conversation.tsx`). With the list flowing top-down, an opening card grows downwards and nothing above it moves: 0 px in Chromium and Firefox at 100, 125 and 150 % scaling, with the browser's anchoring on or off.

### The scroll region

`components/chat/chat-view/chat-scroll.tsx` (`ChatScroll`) renders `StickToBottom` (the region's root, `.scrollRegion`: `flex: 1; min-height: 0; position: relative`, so the scroll box's `height: 100%` resolves) and `StickToBottom.Content` (`scrollClassName` `.scrollBox`: `overflow-y: auto` and the inline padding Bubble.List's own box used to carry) around `Bubble.List autoScroll={false}`, whose own box no longer scrolls (its `max-height: 100%` has no definite height inside the content). `initial="instant"` opens each conversation at its latest message; the caller keys `ChatScroll` by the conversation. `resize="smooth"` follows the answer while the reader is at the bottom, and the library lets go when they scroll up (it never moves the view otherwise, `preserveScrollPosition`). The spring is twice as stiff as the library's default (`stiffness={0.1}`; damping 0.7 and mass 1.25 stay): one new line is followed in about 0.2 s instead of 0.6 s (the owner: "go with twice").

### A send

`ChatScroll` exposes `ChatScrollHandle.scrollToBottom` (React 19 `ref` as a prop, `useImperativeHandle` over the library's `contextRef`), as the README's chat box calls `scrollToBottom()` when the user enters a message. The Dify chat calls it in `send` when the send was taken (the composer, a suggested question, an answer button); the shared chat in its `onSend`.

### The workaround

use-stick-to-bottom observes only the content, so when something below the list grows (the composer up to 8 lines, the plan panel, the question card) the scroll box shrinks and the newest lines slide out of view: issue #40, "scroll position drifts when scroll container height changes (flex sibling resize)" (https://github.com/stackblitz-labs/use-stick-to-bottom/issues/40), open, with the open fix PR #43 (https://github.com/stackblitz-labs/use-stick-to-bottom/pull/43). With the owner's word, `useScrollBoxResize` in `chat-scroll.tsx`, marked WORKAROUND with both links, does what PR #43 does through the library's own API: a ResizeObserver on the scroll box re-anchors to the bottom when it shrinks while the reader is at the bottom, and records the resize in `state.resizeDifference` so the browser's clamp when the box grows back is not taken for the reader scrolling up. Measured: the newest lines stay within 2 px of the bottom (221 and 287 px without it); reading further up is not moved.

### Consequences

- Good, because opening a card or a thought no longer moves the view, in every browser we measured.
- Good, because both chats share one scroll region, the reference project's.
- Bad, because a new dependency (32 KB unpacked) and a workaround to remove once upstream ships PR #43 (a GitHub issue tracks it).
- Bad, because the e2e suite's scroll-box locator (`.ant-bubble-list-scroll-box`) and "load earlier" check now measure the new box.
- Neutral, because "load earlier" keeps the reader's place as before: Bubble.List's `scrollTo({ key, block: 'start' })` calls `scrollIntoView`, which scrolls the region's box.

## Implementation Plan

- **Dependency**: `use-stick-to-bottom` 1.1.6, pinned (`package.json`).
- **Affected paths**: `components/chat/chat-view/chat-scroll.tsx` (new), `chat-view.module.css` (`.scrollRegion`, `.scrollBox`), `message-list.tsx`, `chat-view.tsx`, `components/shared-chat/turn-list.tsx`, `shared-chat.tsx`.
- **Pattern**: a chat's messages scroll in `ChatScroll`, keyed by the conversation, around a `Bubble.List` with `autoScroll={false}`; a send calls the handle's `scrollToBottom`.
- **Avoid**: X's `autoScroll` in a chat; `overflow-anchor` rules; scroll code of our own beyond the marked workaround.
- **Removing the workaround**: when a use-stick-to-bottom release carries PR #43 (or another fix for #40), delete `useScrollBoxResize` and `RETAIN_ANIMATION_DURATION_MS`, and bump the pin.

### Verification

- [ ] Opening a tool card or a thought away from the bottom leaves its header where it was, in Chromium and Firefox (e2e and the browser).
- [ ] A conversation opens at its latest message; an answer streaming at the bottom is followed; reading further up is not moved.
- [ ] A send from further up ends at the bottom with the reply followed.
- [ ] "Load earlier" keeps the first earlier message in view (e2e `chat.spec.ts`).
- [ ] `chat-scroll.tsx` names issue #40 and PR #43 at the workaround.

## More Information

- use-stick-to-bottom README (https://github.com/stackblitz-labs/use-stick-to-bottom): `<StickToBottom>`, `StickToBottom.Content`, `useStickToBottomContext`, `scrollToBottom`; types in `dist/useStickToBottom.d.ts` and `dist/StickToBottom.d.ts` (`initial`, `resize`, `damping`, `stiffness`, `mass`, `contextRef`).
- Ant Design X: issue #1684, PR #1690; `es/bubble/hooks/useCompatibleScroll.js` and `es/bubble/style/list.js` in 2.9.0.
- Firefox: `layout/generic/ScrollAnchorContainer.cpp` (the disabling heuristic) and `StaticPrefList.yaml` (its defaults), mozilla-central.
- Commit `e8fc3dfd` on `feat/agui-hitl` (PR #72).
