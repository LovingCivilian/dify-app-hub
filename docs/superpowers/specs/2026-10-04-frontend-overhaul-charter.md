# Frontend overhaul — charter

Date: 2026-10-04 · Status: draft for review · Scope: the whole frontend of this fork

## 1. Goal

Rebuild the frontend on Ant Design 6 and Ant Design X 2 the way their documentation says a Next.js 16 app should be built: stock components wherever one exists, custom components only where none exists and then styled from design tokens, project structure per Next's App Router conventions. The result reads as one antd/X application (the default antd/X look, antd's default primary colour) with less custom code, while every Dify feature the app has today keeps working.

The backend is out of scope and stays merge-friendly with upstream: `app/api/**`, `db/**`, `lib/auth*`, `proxy.ts`, `services/`, `lib/dify-client.ts` and the Dify API types are not changed by this programme except where a UI change strictly needs a new field.

## 2. Decisions already taken (do not re-open)

| Topic | Decision |
| --- | --- |
| Library | antd 6 + Ant Design X 2 (+ `@ant-design/x-sdk`, `@ant-design/x-markdown`). shadcn/AI Elements rejected: it needs the AI SDK transport and would mean two UI kits. ProComponents rejected: latest release supports antd 4/5 only. |
| Custom components | Replace with the X/antd equivalent wherever one exists. Keep custom only where none exists; style those from tokens. |
| Upstream | The frontend becomes fork-owned. Upstream UI changes are re-implemented when wanted, not merged. Backend stays merge-friendly. |
| Styling | Pure antd: Tailwind, PostCSS config, `tw-animate-css`, Radix/shadcn primitives, `class-variance-authority`, `tailwind-merge`, `clsx`/`classnames`, Lucide are removed by the end. Custom styling = CSS Modules consuming `--ant-*` tokens + `theme.useToken()` for runtime values. |
| Theme | Single antd theme: `defaultAlgorithm`/`darkAlgorithm` from the existing theme-mode switch, antd default tokens, primary `#1677ff` (light) / `#1668dc` (dark). No `--theme-*`/shadcn variables at the end. |
| Icons | `@ant-design/icons` only. |
| i18n | Keep react-i18next (typed keys, en/zh/ar), antd + Day.js locales as wired in `libs/antd-locale.ts`; `XProvider` carries locale and, later, `direction`. Next's `/[lang]/` routing is not adopted. |
| Markdown | Spike `@ant-design/x-markdown` against Dify content first (KaTeX, injected `<img>` HTML, `<think>`, code highlighting, streaming); adopt it if it covers them, otherwise keep the react-markdown pipeline restyled with tokens. |
| Verification | `@playwright/test` end-to-end suite against the dev server with a stub Dify API; screenshots light/dark × desktop/mobile per sub-project; `antd lint` clean; vitest for logic; Docker image rebuild as the final gate before merge. |
| Process | Each sub-project: spec → plan → subagent-driven implementation with per-task review → PR to `fork/main`. The app works after every sub-project. |

## 3. Sources these conventions come from

- Ant Design: `https://ant.design/design.md` (design language: tokens, three-layer surfaces, 4 px grid, component archetypes, do's and don'ts), `docs/react/use-with-next.md` (App Router: `AntdRegistry`), `docs/react/customize-theme.md` (algorithms, nested themes, `theme.useToken()`), `docs/react/for-agents.md` (CLI, skill, per-page `.md` docs at `https://ant.design/components/<name>.md`), `components/layout.md`. Per-page Markdown and `llms.txt` exist for every antd page.
- Ant Design X: the official skill package `@ant-design/x-skill` (`x-components` incl. `reference/PATTERNS.md` and `COMPONENTS.md`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown`). The X site publishes no `llms.txt`; the skills are its agent-facing documentation.
- Next.js 16: the bundled docs in `node_modules/next/dist/docs/` — `01-getting-started/02-project-structure.md`, `03-layouts-and-pages.md`, `05-server-and-client-components.md`, `02-guides/css-in-js.md`, `02-guides/authentication.md`, `02-guides/testing/playwright.md`.
- Measured in this repo (headless Chromium against `next dev`): antd 6 declares its 380 tokens as `--ant-*` CSS variables on the class it gives `<App>`'s root; plain descendants resolve them; they flip under `darkAlgorithm`; a `var(--ant-…)` alias declared at `:root` does not resolve, one declared on `.ant-app` does.

## 4. Conventions

### 4.1 Project structure (Next)

- `app/` is routing only. Shared code lives in root folders: `components/<feature>/`, `hooks/`, `lib/` (`libs/` merged into it), `services/`, `types/`, `locales/`.
- Route groups own their layouts: `app/(auth)/` (login, forgot-password, reset-password), `app/(admin)/` (app-management, user-management), `app/(user)/` (apps, chat/[appId]); `app/init/` and `app/page.tsx` stay top-level. Layout selection by URL-sniffing (`PageLayoutWrapper`) is removed.
- Root `app/layout.tsx` (server component): `<html lang>` → `<body>` → `AntdRegistry` → client providers (session, theme mode, i18n, `XProvider`, `App`) → children. Providers are one client component, `components/providers/app-providers.tsx`.
- Server components by default; `'use client'` only on interactive leaves and providers. Route-level `loading.tsx` where a page fetches before rendering.
- Files are named `kebab-case.tsx`; one component per file; colocated `*.module.css` next to the component it styles.

### 4.2 Providers (antd + X)

- Exactly one `XProvider` at the root (the X rule: it supersedes `ConfigProvider`; multiple wraps are an anti-pattern). It receives `theme={{ algorithm }}` from the theme-mode context, `locale` from `libs/antd-locale.ts`, and later `direction` for RTL. No token overrides unless a sub-project spec names one.
- `App` (antd) directly inside it, so `App.useApp()` provides message/modal/notification everywhere.
- No nested `ConfigProvider`/`XProvider` in pages. The chat's current `XProvider` with a token override goes.

### 4.3 Styling rules (from `design.md`)

1. Antd component first: `Layout`, `Flex`, `Space`, `Typography`, `Card`, `Divider`, `Grid`, `List`, `Avatar`, `Tag`, `Tooltip`, `Empty`, `Spin`, `Skeleton`, `Result`.
2. Static custom styles: a CSS Module next to the component, values only from `var(--ant-<token>)` (`--ant-color-text-secondary`, `--ant-padding-sm`, `--ant-border-radius-lg`, `--ant-box-shadow-secondary`, `--ant-font-size-heading-3`, …). Token name = antd token in kebab-case; verify against the browser's variable list when unsure.
3. Runtime-dependent values: `theme.useToken()` and the `style` prop.
4. Responsive logic: `Grid.useBreakpoint()`; media queries in CSS Modules use antd's screen token values written as numbers with a comment naming the token.
5. Surfaces follow the three-layer model: page = `color-bg-layout`, panels/cards/tables = `color-bg-container`, popups = `color-bg-elevated` (shadow distinguishes it).
6. Spacing snaps to antd's scale (`paddingXXS`…`paddingXL`, `marginXXS`…`marginXXL`); typography to `fontSize*`/`lineHeight*`; radius to `borderRadius*`.
7. Forbidden in product code: hex/rgb/oklch literals, magic pixel numbers, Tailwind utility classes, `!important`, a second theme system, CSS-in-JS libraries other than antd's own.
8. Dark mode is `darkAlgorithm`; nothing is styled per mode by hand.

### 4.4 Chat (the X full-page pattern, `x-components/reference/PATTERNS.md` Pattern 1)

| Today | Target |
| --- | --- |
| Custom sidebar wrapper around `Conversations` | `Conversations` with `groupable`, `creation`, per-item `menu` (rename/delete) |
| `WelcomePlaceholder` with own chips | `Welcome` + `Prompts` fed by Dify's opening statement and suggested questions, honouring the app's display rules (always / until first message) |
| `Bubble.List` with custom `contentRender`/footer, typing off | `Bubble.List` with stable `roles` (avatars), `streaming` true while a reply streams and false on the final chunk, `contentRender` → markdown renderer |
| `MessageFooter`/`ActionButton` | `Actions` with `Actions.Copy`, `Actions.Feedback` (green/red kept via tokens), `Actions.Audio` (TTS), plus regenerate and annotate items |
| Own `ThoughtChain` (Collapse) | X `ThoughtChain` for agent thoughts and workflow node logs; `Think` for `<think>` blocks |
| `referrence.tsx` | `Sources` for `retriever_resources` |
| `MessageSender` wrapper | `Sender` + `Sender.Header` + `Attachments` + `allowSpeech`; `Suggestion` only if a feature needs it |
| react-markdown pipeline | `XMarkdown` (Latex plugin, `components` map with `Think`, explicit `dompurifyConfig` for Dify's injected images) — subject to the spike |
| Own HITL form, workflow logs, file list | Kept as custom: antd `Form`/`Descriptions`/`Steps`/`Collapse` inside the bubble flow, token-styled |

Data layer: the Dify provider stays an `AbstractChatProvider` with the three transform methods and `XRequest(…, { manual: true, fetch })` (documented options); `useXConversations` is evaluated for sidebar state in the chat sub-project's spec. Workflow and completion app modes get the same shell with their own centre content.

### 4.5 Admin, app list, auth pages

- `(admin)`: antd `Layout` (Header + Content), `Menu` or `Segmented` navigation, `Table` with `Drawer`/`Form` editing, `Descriptions`, `Tabs`, `Popconfirm`/`Modal` confirms, `Tag`/`Badge` for status.
- `(user)/apps`: `Card` grid (`Row`/`Col` or `Flex wrap`), `Empty` state.
- `(auth)` and `init`: centred `Card` with `Form` on the `color-bg-layout` surface.
- Header (all areas): logo + title, area navigation, then `Dropdown`s for language, theme mode and account, GitHub link; `@ant-design/icons`.

### 4.6 Verification

- `@playwright/test` with `webServer` (Next's Playwright guide). A stub Dify API fixture serves the proxied endpoints with recorded-style event streams built from Dify's OpenAPI spec: plain chat, agent (`agent_thought`/`agent_message`), chatflow (`workflow_*`, `node_*`, `message_end`), HITL (`human_input_required` → form → continuation), errors, files.
- Each sub-project adds e2e flows for what it changes and screenshots (light/dark × desktop/mobile) to `e2e/screenshots/` for review in the PR.
- `npx @ant-design/cli lint ./` reports no errors; `tsc`, `oxlint`, `oxfmt`, vitest stay green.
- Final gate before merging a sub-project: Docker image rebuild and the usual curl checks.

## 5. Delivery plan

| # | Sub-project | Delivers | Done when |
| --- | --- | --- | --- |
| 0 | Tooling | X skills and the antd skill in `.claude/skills/`; `@playwright/test` + stub Dify fixture + smoke e2e (login → apps → open chat); `antd lint` baseline; antd/X/x-sdk bumped to current minors, `@ant-design/x-markdown` added; `docs/frontend-conventions.md` (this section 4, kept current) | e2e smoke green in CI-style run; lint baseline recorded |
| 1 | Foundation and shells | Root layout + single provider stack; route groups and their layouts; admin/user/auth shells and header rebuilt from antd; token-only styling in everything new; old pages keep working inside the new shells (their Tailwind classes stay until their own sub-project) | all routes render in the new shells; e2e smoke + shell screenshots; dark mode via algorithm only |
| 2 | Chat | §4.4, starting with the XMarkdown spike; mobile via `Drawer` sidebar and breakpoints | chat/agent/chatflow/HITL e2e flows green; screenshots; no custom component where X has one |
| 3 | App list, admin, auth/init pages | §4.5 | e2e flows for app CRUD, user CRUD, login/reset; screenshots |
| 4 | Cleanup | Tailwind, PostCSS config, Radix/cva/tailwind-merge/clsx/classnames, Lucide, `components/ui/`, `theme-config.ts`, old theme CSS and aliases removed; `CLAUDE.md` and `docs/frontend-conventions.md` final | `git grep` for the removed packages and `--theme-` is empty; bundle has no Tailwind; full e2e green; `antd lint` clean |

Follow-ups already named, after this programme: RTL (`XProvider direction="rtl"` + screenshots), server-side message/e-mail translation, account-menu "change password".

## 6. Risks and how they are handled

- Markdown: Dify content may not survive `XMarkdown` (raw `<img>`, KaTeX, `<think>`, citations). The spike runs first with real Dify payload samples; the fallback (keep our renderer) is a valid outcome.
- Streaming regressions (typing/streaming flags, HITL reconnect, workflow events): covered by the stub-Dify e2e flows before and after the swap; the provider is not rewritten.
- Mobile: every screenshot set includes a 390 px viewport; the sidebar becomes a `Drawer` below `md`.
- First paint: antd styles are injected by `AntdRegistry`; the production build is checked for inlined styles in sub-project 1 (dev mode injects on hydration).
- Upstream drift: documented in `CLAUDE.md`; syncs take the backend only.
- Size: ~100 files / ~15 k lines of frontend. Sub-projects keep the app shippable at every step; nothing is merged half-migrated except the deliberate "old page inside new shell" state of sub-project 1.

## 7. Definition of done for the programme

Every page is composed of antd/X components and token-styled custom components; no Tailwind, Lucide, Radix, hand-written theme variables or hex colours remain; the e2e suite covers login, app list, chat (all app modes), HITL, feedback, admin CRUD and auth flows in light and dark, desktop and mobile; `antd lint` is clean; `CLAUDE.md` and `docs/frontend-conventions.md` describe the conventions so the next session follows them.
