---
paths:
  - 'app/**'
  - 'components/**'
---

# Frontend rules (loaded when working under `app/` or `components/`)

- Conventions are binding: `docs/frontend-conventions.md` (charter §4). New code: antd component first; static styles in a colocated `*.module.css` with `var(--ant-*)` values only; runtime values via `theme.useToken()`; responsive logic via `Grid.useBreakpoint()`; no hex/rgb literals, magic pixel numbers, Tailwind classes, `!important` or Lucide icons. Old page bodies keep their classes until their sub-project migrates them.
- Read the matching skill before touching a component: `.claude/skills/antd` (`antd doc`, `antd token`), `x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`.
- Governing ADRs (`docs/decisions/`): 0008 rebuild on antd/X and the single `XProvider` + `App` at the root (`components/providers/app-providers.tsx`; never nest a `ConfigProvider`/`XProvider`); 0011 viewport-bound shells (`components/shell/shell.module.css`); 0012 legacy variable aliases on `.ant-app` (never use `--theme-*`/shadcn classes in new code or inside overlays); 0014 header controls click-triggered and named through i18next keys; 0013 keep `@ant-design/cssinjs` at antd's version.
- `app/` is routing only; route groups own their layouts; server components by default, `'use client'` only on interactive leaves and providers; URLs never change (gating in `lib/access.ts`/`proxy.ts` is by path).
- All UI text through i18next keys in all three locale files (`docs/i18n-maintenance.md`); accessible names of icon-only buttons come from keys and are e2e locator contracts (`e2e/shell.spec.ts`, `e2e/chat-header.spec.ts`).
- Verification for UI changes: `pnpm test:e2e` (stop `pnpm dev` first; one `next dev` per checkout), plus tsc, oxlint, oxfmt, vitest; `npx -y @ant-design/cli lint ./` must not exceed the baseline in `docs/frontend-conventions.md`; screenshots from `e2e/screenshots.spec.ts` are reviewed in chat, not committed.
