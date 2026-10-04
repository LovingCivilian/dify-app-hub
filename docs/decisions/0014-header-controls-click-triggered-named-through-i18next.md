---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (Task 7 review and rulings)
---

# Make header controls click-triggered and named through i18next, and keep legacy classes out of overlays

## Context and Problem Statement

The shared header (`components/shell/app-header.tsx`) holds four icon-only controls (language, theme, GitHub, account) and a mobile nav button. The plan's first version used antd `Dropdown`'s default hover trigger and a hard-coded `aria-label="Menu"`. The Task 7 review found that hover-triggered dropdowns cannot be opened from the keyboard (rc-trigger binds click/focus handlers only when listed), that antd's docs say hover cannot be used on touchscreens, that the logo link had no name on mobile, and that the mobile `Drawer` dialog had no accessible name. Separately, the alias bridge ([ADR-0012](0012-alias-legacy-theme-variables-to-antd-tokens.md)) does not reach antd overlays.

## Decision

Rules for every header or overlay control built from now on:

- Antd `Dropdown`s in the header use `trigger={['click']}`; so does the chat's mobile conversation menu.
- Every icon-only button has an accessible name from an i18next key (`system.language`, `system.theme`, `system.menu`, `auth.signed_in_as`), with a matching `title` tooltip; product names ("GitHub", "Dify App Hub") are the only literal names. The logo link carries `aria-label="Dify App Hub"` because its text is hidden below the `md` breakpoint.
- Overlays get a name: `Drawer` has a `title`; menus are antd `Menu`/`Dropdown` items so roles come for free.
- Overlay content (Modal, Drawer, Dropdown, Popover) uses antd components and `--ant-*` tokens only; never the legacy `--theme-*`/shadcn classes, which are undefined outside `.ant-app`.
- Static layout CSS lives in the colocated CSS Module with token values and the screen-token media query named in a comment (`screenSMMax` = 767); antd component styling that must beat antd's own class rules uses the component's `style` prop (as antd's Layout demos do), never a tying class rule.

Non-goals: tooltips as antd `Tooltip` components (native `title` suffices for icon buttons today); RTL.

## Consequences

- Good, because every header control is reachable by keyboard and touch, and screen readers get real names in the active language (pinned by `e2e/shell.spec.ts` through the names "Language", "Theme", "Menu", "Signed in as …").
- Good, because e2e locators use accessible names, so the tests double as the accessibility check.
- Bad, because the accessible names are test contracts: renaming a key changes the e2e locators.
- Neutral, because `Grid.useBreakpoint()` returns `{}` on the server, so a server-rendered header would paint the mobile branch first; today the shells render after the client gate, so nothing flashes.

## Implementation Plan

- **Affected paths**: `components/shell/app-header.tsx`, `language-dropdown.tsx`, `theme-dropdown.tsx`, `account-dropdown.tsx`, `app-header.module.css`, `components/chat/chat-layout.tsx` (mobile menu), `locales/*/translation.json` (`system.menu`), `e2e/shell.spec.ts`, `e2e/chat-header.spec.ts`.
- **Patterns to follow**: the four dropdown files are the reference implementation; new controls copy their shape (text `Button` with `icon`, `aria-label`, `title`, click-triggered `Dropdown` with `menu={{ items, selectedKeys, onClick }}`).
- **Patterns to avoid**: hover-only triggers; icon buttons without names; hard-coded English labels; legacy classes inside portals; `!important` or tying class rules against antd component styles.

### Verification

- [x] `e2e/shell.spec.ts`: language switch via the "Language" button, theme switch via "Theme", logout via the account menu, mobile Drawer via "Menu".
- [x] Task 7 review: rc-trigger binds click handlers only with `click` in `trigger` (verified in `@rc-component/trigger`).
- [ ] Sub-project 2: the chat's mobile menu test opens the menu and asserts an item.

## Alternatives Considered

- Keep antd's default hover trigger (the plan's first version): rejected; not keyboard-openable (rc-trigger binds click/focus only when listed) and antd's docs rule hover out on touchscreens.
- Antd `Tooltip` components instead of native `title`: deferred; `title` on icon buttons is sufficient and adds no portal, which keeps the header simple until sub-project 3 revisits the admin pages.
- Literal English `aria-label`s: rejected; `CLAUDE.md` routes all UI text through i18next keys (ADR-0005).

## More Information

Sources: PR #12 Task 7 review and fix round (commit `5f723cfa`), Task 10 and the final review; antd `Dropdown` API ("hover can't be used on touchscreens"). Related: [ADR-0005](0005-internationalise-the-ui-with-typed-i18next-keys-and-msa-arabic.md), [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md).
