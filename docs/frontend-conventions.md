# Frontend Conventions

## Conventions

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

## Lint baseline

**Date:** 2026-10-04

**Command:** `npx -y @ant-design/cli lint ./`

**Scanned:** 208 files. Found 75 issues.

**Summary by category:** 5 deprecated, 7 a11y, 62 usage, 1 performance

**Severity breakdown:** The CLI marks each finding `✗` (error) or `⚠` (warning). Baseline: **1 error** (✗, performance, `app/app-management/page.tsx:8`, "Avoid default import from antd/es/typography/Title") and **74 warnings** (⚠).

**How to re-check:** `grep -c '✗'` and `grep -c '⚠'` on the saved output.

**Top 5 rules by frequency:**

1. Static antd feedback API `message.error` cannot consume ConfigProvider context. Use App.useApp() instead. (35)
2. Static antd feedback API `message.success` cannot consume ConfigProvider context. Use App.useApp() instead. (20)
3. Clickable icon should have `aria-label` for screen readers (7)
4. Static antd feedback API `Modal.confirm` cannot consume ConfigProvider context. Use App.useApp() instead. (3)
5. Static antd feedback API `message.warning` cannot consume ConfigProvider context. Use App.useApp() instead. (2, ties with "Alert `message` is deprecated" at 2)

Sub-projects 2–4 drive this to zero. No task may increase the total (75) or the `✗` error count (1).

## Status

- Sub-project 0 (tooling): in progress.
- Sub-project 1 (foundation and shells): not started.
