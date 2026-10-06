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
2. Static custom styles: a CSS Module next to the component, values only from `var(--ant-<token>)` (`--ant-color-text-secondary`, `--ant-padding-sm`, `--ant-border-radius-lg`, `--ant-box-shadow-secondary`, `--ant-font-size-heading-3`, …). Token name = antd token in kebab-case; verify against the browser's variable list when unsure. Exception: on antd components that reset their own box (Flex: `es/flex/style/index.js:10-11` margin/padding; Typography: margins) per-instance spacing goes through `style` with tokens, or through a plain wrapper element carrying the module class when the value is responsive; a module class on the antd element loses to its `:where(.css-…)` rule (specificity 0,1,1 against 0,1,0) while no cssinjs layer is configured (ADR-0020).
3. Runtime-dependent values: `theme.useToken()` and the `style` prop.
4. Responsive layout by CSS, behaviour by hook (chat spec §3.3): markup that differs by breakpoint is rendered for both variants and switched by a CSS Module media query at antd's screen token, mobile first with one query (the mobile variant shows by default; `@media (min-width: 768px /* screenMD */)` shows the desktop variant and hides the mobile one, so the two are exact complements at any width). `Grid.useBreakpoint()` returns `{}` on the server and on the first client render, so it is used only for behaviour after hydration (which element a `Drawer` mounts, placements), never to choose markup. Media query values are antd's screen token values written as numbers with a comment naming the token.
5. Surfaces follow the three-layer model: page = `color-bg-layout`, panels/cards/tables = `color-bg-container`, popups = `color-bg-elevated` (shadow distinguishes it).
6. Spacing snaps to antd's scale (`paddingXXS`…`paddingXL`, `marginXXS`…`marginXXL`); typography to `fontSize*`/`lineHeight*`; radius to `borderRadius*`.
7. Forbidden in product code: hex/rgb/oklch literals, magic pixel numbers, Tailwind utility classes, `!important`, a second theme system, CSS-in-JS libraries other than antd's own.
8. Dark mode is `darkAlgorithm`; nothing is styled per mode by hand.
9. Forms inside a `destroyOnHidden` Drawer/Modal own their instance (no parent `Form.useForm()`); a button outside the `<form>` submits through the native `form` attribute (`htmlType="submit" form={<id>}`); stateful drawer bodies are children the Drawer unmounts (keyed by the record). Reason: `@rc-component/form` keeps a hook-held store across openings and `clearOnDestroy` empties it under Strict Mode without re-seeding (ADR-0020). Drawer content state is set on every opening and cleared in the Drawer's documented `afterOpenChange(false)`, which antd skips when a drawer is closed before its open motion ends (so no code relies on it for correctness); edit forms are keyed by the edited record's id, and the Drawer's `loading` prop (5.18+) shows the load state (`antd doc Drawer`).

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

Sub-project 3 reached zero; no task may add a finding.

## Status

- Sub-project 0 (tooling): done. Skills, conventions, dependency bump, Playwright harness with throwaway MySQL and stub Dify API, lint baseline.
- Sub-project 1 (foundation and shells): done. The single provider stack (`components/providers/app-providers.tsx`), `AppHeader` with language/theme/account dropdowns, admin/user/auth shells, the `(auth)`/`(admin)`/`(user)` route groups, the `--ant-*` alias block on `.ant-app`, and the e2e suite for all of it (setup, harness, smoke, providers, chat header, theme aliases, shell flows, screenshots; three projects). The stub Dify API is narrower than §4.6 describes. Stub today: plain chat stream, conversations/messages/feedback, parameters/meta/info/site, and a test-only `POST /__e2e/reset`; agent/chatflow/HITL/error/file streams arrive with sub-project 2. The legacy `--theme-*`/shadcn aliases live on `.ant-app` and do not reach antd overlays (Modal/Drawer/Dropdown portal to body); antd's own `--ant-*` do — sub-projects 2–3 must not use legacy classes inside overlays.
- Lint re-check (2026-10-04, `npx -y @ant-design/cli lint ./`): 210 files scanned, 74 findings (baseline 75), 1 error `✗` (baseline 1, still `app/(admin)/app-management/page.tsx:8`), 73 warnings `⚠` (baseline 74). Categories: 5 deprecated, 7 a11y, 61 usage, 1 performance.
- Production first-paint check (2026-10-04; `pnpm build`, then `next start -p 5302` with the `.env.e2e` values so that `/login` renders instead of redirecting to `/init`; `curl -s /login`): the first run found **0** `<style` tags and **0** `--ant-color-primary` occurrences, so the server HTML carried no antd styles. Cause: `package.json` pinned `@ant-design/cssinjs` at `^1.24.0` (upstream's) while antd 6 and Ant Design X use 2.1.2, so `AntdRegistry` read a different cssinjs context and extracted nothing; the antd Next.js guide's Pages Router note says the version must be consistent with the one in antd's `node_modules`, and `@ant-design/nextjs-registry` declares `@ant-design/cssinjs >=1.0.0` as a peer, which pnpm resolved to the root's 1.x copy. After `pnpm add @ant-design/cssinjs@^2.1.2` (one copy left, `pnpm why @ant-design/cssinjs`): **1** `<style id="antd-cssinjs">` tag, **3** lines and **24** occurrences of `--ant-color-primary`, `--ant-color-text:rgba(0,0,0,0.88)` and `--ant-color-bg-layout:#f5f5f5` present in the first HTML. No fallback values were needed for the alias block. `next start` prints that it "does not work with `output: standalone`" but serves the page; Next's documented runner for a standalone build is `node .next/standalone/server.js` (the Docker image copies that output and runs the same `server.js`), and the check still verified the inlined styles because it only reads the HTML.
- Sub-project 2 (chat): done (spec `docs/superpowers/specs/2026-10-04-chat-on-ant-design-x-design.md`, plan `docs/superpowers/plans/2026-10-04-chat-on-ant-design-x.md`; ADR-0016, 0017, 0018). `/chat/[appId]` runs every Dify app mode (chat, agent, chatflow, workflow, completion) on Ant Design X inside the user shell: one `DifyChatProvider` with `useXChat` per conversation key (history and live replies share one store, which ends the late-history race), `Conversations` with rename and delete, `Welcome` + `Prompts`, the inputs form, `Bubble.List` with reasoning, agent thoughts, workflow logs, HITL forms and citations, `XMarkdown` behind `message-markdown.tsx`, the footer actions (regenerate, copy, annotate, like/dislike as named antd buttons, TTS), `Sender` with attachments and speech to text, next-question suggestions, the wide-screen toggle, a collapsible sider and a mobile drawer, and the workflow and completion runners. Also: the server gate in the `(user)` and `(admin)` layouts (the client gates are gone and the shells server-render), the theme and language cookies for a correct first paint, `100dvh`, the CSS breakpoint rule above, the X locale with a fork Arabic pack, and the old chat tree with its packages removed. The stub Dify API (`e2e/fixtures/stub/`) now serves the catalogue §4.6 describes: five apps by path prefix (chat, agent, chatflow, workflow, completion) with plain, agent, chatflow, HITL, error, slow, file, citation and Markdown streams, per-user storage and Dify-shaped errors; the test-only `POST /__e2e/reset` is gone.
- Lint re-check (2026-10-05, after sub-project 2, `npx -y @ant-design/cli lint ./`): 288 files scanned, 39 findings (baseline 75), 1 error `✗` (baseline 1, still `app/(admin)/app-management/page.tsx:8`), 38 warnings `⚠` (baseline 74). Categories: 2 deprecated, 0 a11y, 36 usage, 1 performance. None under `components/chat/`; the remaining findings are in the sub-project 3 pages (admin, auth, `init`, apps: static `message.*` calls, two `Alert message` props, the `Title` default import) plus one static `message.error` in `lib/api/base-request.ts`.
- Sub-project 3 (app list, admin and auth pages): done (spec `docs/superpowers/specs/2026-10-06-admin-apps-auth-on-antd-design.md`, plan `docs/superpowers/plans/2026-10-06-admin-apps-auth-on-antd.md`; ADR-0020). Every route in scope (`/`, `/apps`, `/app-management`, `/user-management`, `/login`, `/forgot-password`, `/reset-password`, `/init`) is a server page that loads what the first paint needs (the three signed-in pages check the session where they read), trims it to plain props and renders one client component: `components/apps/` (gallery, card, `AppIcon` with the Dify site icon and a mode-icon fallback), `components/admin/apps/` (table with Type filter and search, Edit plus a More dropdown for user view, sync, annotations and delete, the create/edit drawer, the annotations drawer with keyword search, paging and an add/edit modal), `components/admin/users/` (table with search, add/edit drawer, `Popconfirm` delete, no Delete on the signed-in user's row, dates formatted after hydration), `components/auth/` (login, forgot-password, reset-password and init forms in the branded `AuthCard`); `/` and an initialised `/init` redirect on the server. New shared pieces: `lib/data/users.ts` (`server-only` reads, not `'use server'`), `lib/match-query.ts`, `lib/search-params.ts`, `components/shell/{search-input,route-error}.tsx`, `components/admin/admin-page-header.tsx`, `loading.tsx`/`error.tsx` with `retry()`. The polish: load and error states, search and filter, Dify app icons. Fixed defects: double padding, the admin table clipped on mobile, the stray "0" tag, the login logo image warning, disabled apps on `/apps`, untranslated mode labels, a failed update shown as saved, uncaught sync and delete errors, API keys in the admin list, the routes' Chinese text printed, the `/init` and `/forgot-password` form swaps, the client spinner on `/`; `LucideIcon` and the `Title` default import are gone, and writes report through `App.useApp()` with status codes mapped to translation keys. e2e: `apps.spec.ts`, `admin-apps.spec.ts`, `admin-users.spec.ts`, `auth.spec.ts`, server-rendering proofs in `ssr-first-paint.spec.ts`, the body-level probe in `theme-aliases.spec.ts`, screenshots of the auth pages and the three drawers. Stub additions (`e2e/fixtures/stub/`): CORS headers and `OPTIONS` answered as Dify's service API does, annotations per app (list with `page`, `limit`, `keyword`; create, update, delete), `/site` variants (emoji, image, 403 for the no-site prefix), a create prefix whose `/info` answers a distinct name; `auth.setup.ts` seeds a disabled and a no-site app, `e2e/fixtures/db.ts` gives specs their own MySQL connection. Eight translation keys that lost their last caller were removed.
- Lint re-check (2026-10-06, after sub-project 3, `npx -y @ant-design/cli lint ./`): 343 files scanned, 0 findings, 0 errors `✗`, 0 warnings `⚠` (baseline 75 → ratchet 0).
- Sub-project 4 (removal of the legacy styling stack): done (spec `docs/superpowers/specs/2026-10-07-remove-legacy-styling-stack-design.md`, plan `docs/superpowers/plans/2026-10-07-remove-legacy-styling-stack.md`; ADR-0021, ADR-0012 superseded). Tailwind, its PostCSS config and `tw-animate-css`, `components.json`, `components/ui/`, `lib/utils.ts`, Radix, `class-variance-authority`, `clsx`, `tailwind-merge`, `vaul`, Lucide, `lib/helpers/responsive.ts`, the orphan `types/emoji.d.ts` and `@toolkit-fe/where-am-i`, and `app/globals.css` with the ADR-0012 alias block are gone. `app/layout.tsx` imports `antd/dist/reset.css` as the only global CSS; `<html>` carries `color-scheme` from the theme cookies and the theme context toggles it; the chat's Collapses take antd's default look (the deleted override had removed only their header/content divider, which no prop reproduces) and the auth card's level-3 title regains antd's 24 px (the legacy `h3 !important` rule had shrunk it); scrollbars are native. e2e: `theme-aliases.spec.ts` deleted, the scheme probes moved to the html style, one new case for an explicit light theme under an OS dark preference. Lint re-check (2026-10-07, `npx -y @ant-design/cli lint ./`): 337 files scanned, 0 findings.
- Next: the owner's cosmetic sweep (candidates: token-coloured thin scrollbars on `.ant-app`, the chat Collapse look, markdown spacing), then the backend rework (`docs/superpowers/specs/2026-10-05-backend-rework-brief.md`).
