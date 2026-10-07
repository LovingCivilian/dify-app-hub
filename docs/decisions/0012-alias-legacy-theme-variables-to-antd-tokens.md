---
status: superseded by [ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (Task 11 implementation and review)
---

# Alias the legacy theme variables to Ant Design tokens on the App root until sub-project 4

## Context and Problem Statement

Upstream's page bodies use the fork's `--theme-*` CSS variables (through `.text-theme-*`/`.bg-theme-*`/`.border-theme*` utility classes) and shadcn-style variables consumed by Tailwind's `@theme inline` block (`bg-primary`, `text-muted-foreground`, …). They were hard-coded colours in `:root` and `.dark` blocks, so they did not follow antd's `darkAlgorithm` and dark mode recoloured only antd widgets. Antd 6 publishes every design token as a `--ant-<kebab>` CSS variable, scoped to the class it puts on `<App>`'s root (`.ant-app`), not on `:root`. The page bodies are migrated only in sub-projects 2–3, so a bridge is needed now.

## Decision Drivers

- One theme system now, even for untouched page bodies (charter §4.3.7–8).
- No literals in product CSS; nothing styled per mode by hand.
- Removable in one step when the last consumer goes (sub-project 4).

## Considered Options

- Alias block on `.ant-app`: every `--theme-*` and consumed shadcn variable = `var(--ant-…)`; delete the hard-coded `:root`/`.dark` blocks.
- Keep the hard-coded blocks until sub-project 4 (the spec's "stay for now").
- Set the variables on `:root` with fallbacks: impossible without literals, since `--ant-*` do not exist at `:root`.

## Decision Outcome

Chosen option: the alias block in `app/globals.css` on `.ant-app` (text → `color-text`, description → `color-text-secondary`, page/container/elevated surfaces per the three-layer model, borders → `color-border(-secondary)`/`color-split`, status colours one to one, radius → `border-radius-lg`). The shadcn `:root`/`.dark` blocks and the `body { background; color }` rule are deleted; `--sidebar-*`/`--chart-*` had no consumers and are dropped; `@theme inline` and the utility classes stay until sub-project 4.

### Consequences

- Good, because `.text-theme-desc` and friends now resolve to antd's `colorTextSecondary` in both schemes (pinned by `e2e/theme-aliases.spec.ts`), and dark mode recolours old page text.
- Good, because the bridge is one block with a removal note; no page was edited.
- Bad, because the aliases exist only inside `.ant-app`: antd overlays (Modal, Drawer, Dropdown) portal to `body`, so legacy classes inside overlay content get no alias (antd's own `--ant-*` do reach them); the `body` has no background (a dark-mode user sees a white canvas until the shell paints); the legacy body-scrollbar thumb is transparent where the document itself scrolls (auth pages at short viewports).
- Bad, because some mapped colours changed visibly on purpose: Tailwind `text-primary` consumers moved from near-black to antd blue, `--radius` from 10 px to 8 px.
- Neutral, because `--primary-foreground` → `color-white` and `--background` → `bg-container` bend antd's documented roles; their only consumers are dead files.

## Implementation Plan

- **Affected paths**: `app/globals.css` (alias block, deletions), `e2e/theme-aliases.spec.ts`; `components/chat/theme-config.ts` deleted (no importers after the single provider stack).
- **Patterns to follow**: new code never uses `--theme-*` or the shadcn names; overlay content in sub-projects 2–3 uses antd components or `--ant-*` tokens only; when a page body is migrated, delete its legacy classes and, in sub-project 4, the alias block, `@theme inline`, the utility classes and the scrollbar rules together.
- **Patterns to avoid**: literal fallbacks (`var(--theme-x, #hex)`); re-declaring aliases on `:root`; styling `.dark` by hand.

### Verification

- [x] `e2e/theme-aliases.spec.ts` passes in light and dark; screenshots show no lost colour on `/apps`, `/chat`, `/app-management`.
- [x] All 16 `--ant-*` names used resolve on `.ant-app` (antd 6.6.5, `theme.getDesignToken()` → `token2CSSVar`).
- [x] Sub-project 4 removed the block and its consumers (2026-10-07, [ADR-0021](0021-finish-on-pure-antd-after-the-tailwind-removal.md)); `git grep -- "--theme-"` over the code is empty.

## More Information

Sources: charter research (tokens on `<App>`'s root), foundation spec §3.3–3.4, plan Task 11, PR #12 Task 11 review and the final review. Related: [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md).
