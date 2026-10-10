---
status: accepted
date: 2026-10-10
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (B3a run)
---

# Navigate the admin area in a sidebar shared with the chat

## Context and Problem Statement

The admin area's navigation was a horizontal antd `Menu` in the header (`components/shell/admin-shell.tsx`) with two entries, App management and User management. B3a adds a third, Group management, and the owner found that the header menu could not hold it. On 2026-10-09 the owner asked: "instead of a header menu, use a sidebar, it will be better for mobile and desktop, like https://ant.design/components/layout". Asked to confirm, the owner said yes, adding that "the look of the sidebar [must be] consistent across the hub, because the chat has its own sidebar too, so either the admin will match the chat, or the chat match the admin, whichever is the documented path." The chat already had a sidebar, antd's `Layout.Sider` with the "Custom trigger" variant (`components/chat/chat-view/chat-view.tsx`). During the work the owner chose the trigger: "don't use the trigger that is on the top, I want the trigger that is on the bottom, like the one in the sider in the url I gave you" (antd Layout's built-in Sider trigger).

How should the admin area's navigation look and behave, so that the hub has one sidebar and not two?

## Decision Drivers

- One look across the hub (owner, 2026-10-09): the two sidebars must not drift.
- The documented path (ADR-0002): antd Layout and Menu as the docs show them.
- Works on desktop and phone: below `md` the header's drawer already carries the chat's sidebar content.
- First paint without a flash: the server must render the right layout (ADR-0020, ADR-0021; antd Layout `hasSider` is "Useful in ssr avoid style flickering").
- The trigger is reachable by keyboard and named for assistive technology (WAI-ARIA APG, Disclosure pattern).

## Considered Options

- Keep the header `Menu` and rely on antd's overflow, or shorten the labels.
- A sidebar for the admin area that matches the chat's (chosen).
- The chat matches a new admin sider (a sidebar designed for the admin area, the chat restyled to it).

## Decision Outcome

Chosen option: a sidebar for the admin area that matches the chat's, one shared piece, `components/shell/app-sider.tsx`, because the chat's sider was already an antd documented variant, reviewed and in use, and one component for both cannot drift.

- `AppSider` wraps antd's `Layout.Sider` (`theme="light"`, `collapsible`, controlled `collapsed` and `onCollapse`, width 280, collapsed width `controlHeightLG * 2`) and is used by `AdminShell` (an inline `Menu` of the three entries, inside a `<nav>`) and by the chat view (the conversation list). One width for both, so the frame does not jump between areas.
- The trigger is antd's built-in bar at the bottom (the "Sider" demo of antd Layout), on the owner's word. antd's bar is a `div` with a click handler around an arrow, with no role, name or keyboard support, so the `trigger` prop carries a node that keeps the bar and its arrows and holds an antd text `Button` with an accessible name (`system.sidebar_open` and `system.sidebar_close`), `aria-expanded` and `aria-controls` (WAI-ARIA APG, Disclosure: the control has role `button`, `aria-expanded`, optionally `aria-controls`; Enter and Space activate it). The button has no handler of its own: its click bubbles to the bar's, as MDN's "Element: click event" describes for a focused `<button>`. refine's antd sider uses the same construction (an antd `Button` as the `trigger`, no `onClick`) without the name.
- The sider is hidden below `md` by CSS (`components/shell/app-sider.module.css`) and the header's drawer carries the navigation there (Ant Design Pro's mobile drawer; refine's `Drawer`; Grafana overlays its menu below `xl`). There is no `breakpoint` prop: antd measures it after hydration, so the server would paint the expanded sider on phones.
- The collapsed state is local state, kept while the admin pages change (the `(admin)` layout stays mounted) and not stored across loads (ProLayout's default; Grafana persists its docked state in `localStorage`, which is the counterpoint).
- The navigation sits in a `<nav>` inside the sider's `<aside>` (WHATWG HTML, "The aside element"; WAI-ARIA APG, "Landmark Regions"); the menu is an inline `Menu` that collapses to icons with the Sider (antd's `Menu` reads the Sider's state, so no `inlineCollapsed` is set).
- Menu text equals the page heading, "Group management", parallel to the other two entries (Grafana, Ant Design Pro and Dify do the same).
- Next's dev indicator floats at the bottom-left by default and covers the trigger bar under `next dev`; Playwright's call log showed `<nextjs-portal>` intercepting the click about 230 times. `next.config.ts` sets `devIndicators.position: 'bottom-right'` (Next's `devIndicators` docs: "The default is `bottom-left`"). It is development only.

### Consequences

- Good, because the admin area and the chat have one sidebar, one trigger and one width.
- Good, because the navigation has room for more entries and works with a phone's drawer.
- Bad, because in development the bottom-right indicator covers the corner of the admin table's page-size changer when the last row reaches the viewport's bottom-right.
- Bad, because the trigger's arrows do not flip under RTL (antd's built-in trigger does not; a code comment in `components/shell/app-sider.tsx` records it). It joins the RTL follow-up of ADR-0005.
- Neutral, because the chat lost its top toggle (the app-info row's action and the rail's toggle) and `AppInfoBlock` lost its `action` prop.

## Implementation Plan

- **Affected paths**: `components/shell/{app-sider.tsx,app-sider.module.css,admin-shell.tsx,app-header.tsx,app-header.module.css,shell.module.css}`, `components/chat/chat-view/{chat-view.tsx,chat-view.module.css,conversation-sidebar.tsx,sider-collapsed.tsx}`, `next.config.ts`, `e2e/{shell,smoke,page-headers,ssr-first-paint}.spec.ts`.
- **Dependencies**: none.
- **Patterns to follow**: a new admin page adds one entry to `ADMIN_NAV` in `admin-shell.tsx`; a new sidebar uses `AppSider` and never a second `Layout.Sider`.
- **Patterns to avoid**: a `breakpoint` prop (SSR flash); a sidebar width other than `AppSider`'s; CSS that hides or moves Next's dev indicator, or a test switch (ADR-0010).
- **Migration steps**: none.

### Verification

- [x] `e2e/shell.spec.ts` (the sidebar entries, collapse and expand by pointer and by Enter and Space on the trigger, the drawer below `md`), `e2e/ssr-first-paint.spec.ts`, `e2e/page-headers.spec.ts`, `e2e/smoke.spec.ts` and `e2e/chat.spec.ts` on the three projects. Result as run on the branch: 2026-10-09, `pnpm exec playwright test` (full suite) after the change: 488 passed, 20 skipped, 0 failed.
- [x] `npx -y @ant-design/cli lint ./` at zero findings.
- [ ] The owner's two look calls (below) and the browser check.

## Pros and Cons of the Options

### Keep the header `Menu`

- Good, because nothing else changes.
- Bad, because antd's overflow collapses entries into a "…" submenu, and shortened labels trade clarity for room; neither suits a phone.

### A sidebar matching the chat's

- Good, because the sider was already antd's documented variant, in use and reviewed, and one shared component keeps both identical.
- Bad, because the chat's code changes too (its toggle moves to the bottom trigger).

### The chat matches a new admin sider

- Good, because the admin area could be designed first.
- Bad, because it rebuilds a reviewed, working chat sidebar for no gain.

## More Information

Look questions put to the owner, not yet answered when this was written:

- A separator above the light trigger bar, which antd draws without one. The documented route is the Layout token `lightTriggerBg` in the root `XProvider` theme (antd Layout and theme tokens).
- The dev indicator's corner: `bottom-right` today; `devIndicators: false` is the other documented option.

Sources: antd 6.6.5 Layout (Sider API: `collapsible`, `collapsed`, `onCollapse`, `trigger`, `collapsedWidth`, `theme`, `width`, `breakpoint`; Layout `hasSider`; demos "Sider", "Header Sider 2", "Custom trigger", "Responsive") and Menu (`inlineCollapsed`, `tooltip`) through `npx -y @ant-design/cli doc|demo`; Next 16.3.4 `devIndicators` (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/devIndicators.md`); WAI-ARIA APG Disclosure and Landmark Regions; WHATWG HTML "The aside element"; MDN "Element: click event"; Playwright "Navigations > Hydration" (the desktop test waits for hydration, as `openUsers` does). Reference projects: refine `refinedev/refine@acc3d7936ee8` (`packages/antd/src/components/themedLayout/sider/index.tsx:277-300`, a `Drawer` on mobile at `:195`, collapsed state not persisted in `packages/antd/src/contexts/themedLayoutContext/index.tsx:17-19`), Ant Design Pro / pro-components `ant-design/pro-components@e3d860f7` (`src/layout/components/SiderMenu/SiderMenu.tsx:342-356,420-430,479-492`, `SiderMenu/index.tsx:81-87`, `src/layout/ProLayout.tsx:581-586`), Grafana `grafana/grafana@320f74d5` (`public/app/core/components/AppChrome/AppChrome.tsx:259-311`), LibreChat. Related: ADR-0011 (viewport-bound shells), ADR-0018, ADR-0020, ADR-0021, ADR-0027.
