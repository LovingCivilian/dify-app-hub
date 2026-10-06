---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (charter research, execution and reviews)
---

# Rebuild the frontend on Ant Design 6 and Ant Design X 2, following their documentation

## Context and Problem Statement

Upstream's frontend mixes Tailwind utilities, Lucide icons, Radix/shadcn fragments, hard-coded `--theme-*` colours and antd widgets, with three separate `ConfigProvider`/`XProvider` stacks and a layout chosen by URL sniffing. Dark mode and i18n only partly reached the pages, and every fork feature had to fight two styling systems. The owner wants a frontend that follows one library's documented patterns ([ADR-0002](0002-use-documented-library-approaches-only.md)) and that agents can extend safely.

## Decision Drivers

- One theme system (antd tokens, `darkAlgorithm`), one provider stack, documented component usage.
- Native chat components for Dify's streams (Ant Design X: `Conversations`, `Bubble.List`, `Sender`, `Actions`, `ThoughtChain`, `Sources`, `XMarkdown`).
- Mergeability: the backend stays upstream's ([ADR-0009](0009-treat-the-frontend-as-fork-owned.md)).
- Deliverable in bounded sub-projects, each verifiable end to end.

## Considered Options

- Keep upstream's UI and patch per feature ([ADR-0007](0007-leave-the-ant-design-look-as-upstream-has-it.md)).
- Rebuild on antd 6 / Ant Design X 2 per their docs, in five sub-projects.
- Rebuild on another component system (shadcn/Radix fully): would discard the X chat components and upstream's antd usage.

## Decision Outcome

Chosen option: rebuild on antd 6 / X 2 per docs, governed by the charter `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` whose §4 conventions are binding:

- `app/` is routing only; route groups `(auth)`, `(admin)`, `(user)` own their layouts; server components by default.
- Exactly one `XProvider` at the root with antd `App` inside (`components/providers/app-providers.tsx`); no nested `ConfigProvider`/`XProvider`; no token overrides unless a sub-project spec names one.
- Styling: antd component first; static styles in a colocated CSS Module using only `var(--ant-*)`; runtime values via `theme.useToken()`; responsive logic via `Grid.useBreakpoint()`; three-layer surfaces (`color-bg-layout` / `color-bg-container` / `color-bg-elevated`); forbidden in new code: hex/rgb literals, magic pixel numbers, Tailwind classes, `!important`, Lucide icons.
- Sub-projects: 0 tooling, 1 foundation and shells (done, PR #12), 2 chat, 3 admin/app list/auth pages, 4 removal of Tailwind, Lucide, Radix and the alias bridge. Each gets a spec and a plan, executed subagent-driven with per-task reviews and a whole-branch review.
- Verification per sub-project: Playwright e2e flows and screenshots ([ADR-0010](0010-verify-the-frontend-with-playwright-and-a-stub-dify-api.md)), `npx @ant-design/cli lint ./` not growing (baseline 75 findings / 1 error, `docs/frontend-conventions.md`), tsc/oxlint/oxfmt/vitest green, Docker rebuild before merging.

Components with no antd/X equivalent (the human-in-the-loop form, workflow logs, file lists) stay custom but are built from antd primitives and tokens so they look native.

### Consequences

- Good, because every new component is reviewable against public docs and dark mode, locale and tokens reach everything.
- Good, because the official agent skills (`.claude/skills/antd`, `x-*`) give implementers the current API.
- Bad, because old page bodies keep Tailwind/Lucide internals until sub-projects 2–4, so two styling systems coexist for a while (bridged by [ADR-0012](0012-alias-legacy-theme-variables-to-antd-tokens.md)).
- Bad, because the frontend diverges from upstream for good ([ADR-0009](0009-treat-the-frontend-as-fork-owned.md)).

## Pros and Cons of the Options

### Keep upstream's UI

- Good, because no rewrite cost. Bad, because every feature fights two systems and dark mode/i18n stay partial.

### Rebuild on antd 6 / X 2

- Good, because one documented system and native chat components. Bad, because four more sub-projects of work.

### Another component system

- Bad, because it discards the X chat components, the main reason to standardise.

## Implementation Plan

- **Affected paths**: `app/**` (routing and layouts), `components/providers/**`, `components/shell/**`, `components/chat/**` (sub-project 2), admin/app-list/auth pages (sub-project 3), `app/globals.css` (sub-project 4), `docs/frontend-conventions.md`, `.claude/skills/**`.
- **Dependencies**: `antd` 6.x, `@ant-design/x` 2.x, `@ant-design/x-sdk`, `@ant-design/x-markdown`, `@ant-design/icons`, `@ant-design/nextjs-registry`, `@ant-design/cssinjs` aligned with antd ([ADR-0013](0013-pin-ant-design-cssinjs-to-antd-version.md)); bumps within majors.
- **Patterns to follow**: read the matching skill before touching a component; new code per §4.3; one component per `kebab-case.tsx` file; colocated `*.module.css`.
- **Patterns to avoid**: a second `ConfigProvider`/`XProvider`; `antd-style` or other CSS-in-JS; ProComponents (no antd 6 support); styling per mode by hand.

### Verification

- [x] Sub-projects 0 and 1: PR #12 (e2e 49 passed / 3 skipped; providers spec pins one `App` root and one CSS-variable class on the chat page).
- [x] Sub-project 2 (chat) spec and plan written and executed.
- [ ] Sub-project 3 (admin, app list, auth pages).
- [ ] Sub-project 4: Tailwind, Lucide, Radix and the alias block removed; `antd lint` reports no errors.

## More Information

Sources: charter (PR #10), foundation spec `docs/superpowers/specs/2026-10-04-frontend-foundation-design.md`, plan `docs/superpowers/plans/2026-10-04-frontend-foundation.md` (PR #11), execution PR #12, handoff `docs/superpowers/handoffs/2026-10-04-frontend-foundation.md`. Research recorded in the charter (do not redo): antd 6 exposes tokens as `--ant-*` CSS variables on `<App>`'s root; the X site ships `@ant-design/x-skill`; antd serves docs pages as Markdown; ProComponents does not support antd 6; `antd-style` is not used.

Note, 2026-10-05 (sub-project 2): the chat spec (`docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md`, with its "Deviations during execution" paragraph) and its plan were executed on `feat/chat-on-ant-design-x`: `/chat/[appId]` runs every Dify app mode on Ant Design X inside the user shell ([ADR-0017](0017-build-the-chat-on-ant-design-x.md)), the route groups gate on the server ([ADR-0018](0018-gate-route-groups-on-the-server.md)), the theme and the language are cookies the server renders ([ADR-0016](0016-store-the-theme-preference-in-cookies.md)), the X locale has a fork Arabic pack, and the old chat tree with its Tailwind classes, Lucide icons, Radix tree view, zustand store and react-markdown pipeline is deleted. Still one `XProvider` and one `App` at the root (providers e2e spec). `npx -y @ant-design/cli lint ./` fell from 75 findings to 39 (1 error, unchanged; none under `components/chat/`). The verification item above is done; sub-projects 3 and 4 remain.
