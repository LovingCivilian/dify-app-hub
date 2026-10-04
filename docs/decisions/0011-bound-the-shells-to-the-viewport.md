---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (Task 8 review and ruling)
---

# Bound the shells to the viewport and scroll the content region, with the header pinned

## Context and Problem Statement

The foundation plan wrote the shared shell CSS as `.root { min-height: 100vh }`, antd's demo pattern, which lets the document scroll and the header scroll away. The deleted upstream layout pinned the header (`h-screen overflow-hidden` with an `overflow-y-auto` content area), and the chat page needs a bounded view where the conversation sidebar and the message list scroll independently. The Task 8 review raised the conflict before the user shell existed.

## Decision

`components/shell/shell.module.css` is `.root { height: 100vh }` and `.content { overflow: auto }`. Antd `Layout` is a flex column, so `Layout.Header` keeps its height and `Layout.Content` takes the rest and is the scroll container. `AdminShell` and `UserShell` share these two classes; page bodies inside the user shell fill the content region (`h-full`) rather than the screen. Layouts do not set an inline background on `Layout` (antd paints `bodyBg` = `colorBgLayout` by default).

Non-goals: sticky table headers or `Affix` relative to the window (none used today; inside a scroll container they need a container), `100dvh` (deferred, see below).

## Consequences

- Good, because the header stays visible on every page and the chat keeps its bounded sidebar + messages view (no document scrollbar, no double scrollbar — verified: document `scrollHeight == innerHeight`, content `overflowY: auto`, 3000 px filler scrolls inside the content).
- Good, because the pattern is two CSS declarations on top of antd's own Layout flex model.
- Bad, because on real mobile browsers `100vh` can exceed the visible viewport while the URL bar shows; `100dvh` is the modern unit — decide with the chat rebuild (the old app used `100vh` too).
- Bad, because a future `Table sticky`/`Affix` must target the content container.
- Neutral, because the pages' old `h-screen` wrappers had to become fill-height wrappers (`chat-layout.tsx`, `common-layout.tsx`).

## Implementation Plan

- **Affected paths**: `components/shell/shell.module.css`, `components/shell/admin-shell.tsx`, `components/shell/user-shell.tsx`, `components/chat/chat-layout.tsx`, `components/chat/common-layout.tsx`.
- **Patterns to follow**: content that must fill the region uses `height: 100%` or flex inside `Layout.Content`; nested scroll areas use `min-height: 0`/`overflow: auto` on the scrolling child.
- **Patterns to avoid**: `100vh`/`min-h-screen` inside the content region; `position: fixed` headers; inline `background` on `Layout`.

### Verification

- [x] Task 8 browser probe (PR #12 report): header at 0–64 px, `window.scrollY` stays 0 while the content scrolls.
- [x] e2e `chat-header.spec.ts` and screenshots: chat sidebar + messages inside the viewport on desktop and mobile.
- [ ] Sub-project 2: decide `100dvh` for the chat view.

## Alternatives Considered

- `min-height: 100vh` (antd demo, document scroll): rejected; the header scrolls away and the chat cannot bound its lists.
- `position: sticky` header with document scroll: rejected; still leaves the chat without a bounded region.

## More Information

Source: PR #12 Task 8 review and fix round (commit `7c6c197e`); `docs/frontend-conventions.md`. Related: [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md) (the client gates render a spinner before the shell paints; the gate design is a sub-project 2/3 question).
