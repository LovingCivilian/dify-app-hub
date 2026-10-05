# Frontend overhaul — sub-projects 0 and 1: tooling, foundation and shells

Date: 2026-10-04 · Status: draft for review · Charter: `2026-10-04-frontend-overhaul-charter.md` (its §4 conventions are binding here)

## 1. Outcome

After these two sub-projects the app has its final skeleton — root layout, single provider stack, route groups, antd shells and header — and the tooling that every later sub-project relies on (e2e suite with a stub Dify API, antd lint, official skills). The existing pages render unchanged inside the new shells; their internals are migrated by sub-projects 2 and 3.

## 2. Sub-project 0 — tooling

### 2.1 Agent skills in the repo

- `.claude/skills/x-components`, `use-x-chat`, `x-chat-provider`, `x-request`, `x-markdown` copied from `@ant-design/x-skill@2.9.0` (its marketplace manifest lacks the `owner` field Claude Code requires, so the package's documented manual install is used). `x-card` is not copied.
- `.claude/skills/antd` written by `npx -y @ant-design/cli setup --client claude --mode skill` from the repo root; the block it appends to `CLAUDE.md` is kept, edited only for duplication with existing text.
- `CLAUDE.md` gets a "Frontend conventions" pointer to `docs/frontend-conventions.md` and the rule that implementers read the matching skill before touching a component.

### 2.2 Dependencies

- Bump within majors to current: `antd`, `@ant-design/x`, `@ant-design/x-sdk`, `@ant-design/icons`; add `@ant-design/x-markdown` (for the spike in sub-project 2). Record the before/after versions in the PR.
- Add dev dependency `@playwright/test`; browsers come from the existing `~/.cache/ms-playwright` (no download in CI-style runs here).

### 2.3 End-to-end harness

- `playwright.config.ts`: `webServer` runs `pnpm dev` on port 5301 with its own environment (`PORT`, `NEXTAUTH_URL=http://localhost:5301`, `NEXTAUTH_SECRET`, `DATABASE_URL` of the throwaway e2e MySQL) so nothing touches the developer's `.env`; `baseURL` accordingly; projects `desktop` (1280×800) and `mobile` (390×844) × `colorScheme` light/dark. No test switches in product code: the app reaches the stub only through the seeded app's `apiBase`.
- `e2e/fixtures/dify-stub.ts`: a `node:http` server the test run starts, answering the Dify endpoints the proxy forwards to (`/v1/chat-messages` SSE, `/messages`, `/conversations`, `/parameters`, `/meta`, `/site`, `/messages/{id}/feedbacks`, `/files/upload`, `/workflows/run`, `/form/human_input/*`) with event streams written from Dify's OpenAPI spec: plain chat, agent, chatflow, HITL, error. The app under test points at it through a seeded `dify_apps` row (`apiBase` = stub URL).
- `e2e/fixtures/db.ts`: the test database is a throwaway MySQL (`docker compose -f docker-compose.e2e.yml`, tmpfs) initialised through `POST /api/init` with a known admin; never the developer's `.env` database.
- `e2e/auth.setup.ts`: logs the admin in once and saves storage state.
- Smoke flows: `login → /apps`, open the seeded app → first bubble renders from the stub stream; signed-out `/apps` redirects. Screenshots go to the git-ignored `e2e/screenshots/<flow>/<project>.png` and are attached to the PR review (sent in chat), not committed.

### 2.4 Lint baseline

- `npx -y @ant-design/cli lint ./` run once; its findings go into `docs/frontend-conventions.md` as the baseline to drive to zero by sub-project 4.

## 3. Sub-project 1 — foundation and shells

### 3.1 Root layout and providers

```
app/layout.tsx                  server: <html lang suppressHydrationWarning> <body> <AntdRegistry> <AppProviders>
components/providers/app-providers.tsx   client: SessionProvider → ThemeModeProvider → I18nProvider → XProvider → App
```

- `XProvider` props: `theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}`, `locale={getAntdLocale(i18n.resolvedLanguage)}`; `direction` is wired but left `ltr` until the RTL sub-project.
- `ThemeModeProvider` is today's `ThemeContextProvider` moved to `components/providers/`; it keeps the body `dark` class only until sub-project 4 removes the last consumer, then drops it.
- `useHtmlLang` and `applyDayjsLocale` run inside `I18nProvider`.
- The two `ConfigProvider`s (`page-layout-wrapper.tsx`, `app/(user)/layout.tsx`) and the chat `XProvider` are deleted.

### 3.2 Route groups and layouts

| Route group | Layout | Contents |
| --- | --- | --- |
| `app/(auth)/` | centred `Card` on `color-bg-layout`; server layout calls `redirectSignedInUser()` for login and forgot-password only | `login`, `forgot-password`, `reset-password` |
| `app/(admin)/` | `AdminShell` (antd `Layout` + header with admin nav) | `app-management`, `user-management` |
| `app/(user)/` | `UserShell` (header without admin nav; chat pages add their sidebar) | `apps`, `chat/[appId]` |
| `app/init/` | same visual layout as `(auth)` (shared `AuthCard` component) but top-level, so it never gets the signed-in redirect | `init` |

URLs do not change. `app/(user)/auth/page.tsx` (fingerprint, vestigial) is deleted; the login page's own `layout.tsx` is replaced by the group layout. `proxy.ts` and `lib/access.ts` are untouched (route groups do not change paths).

### 3.3 Shells and header

- `components/shell/app-header.tsx`: antd `Layout.Header` with `Flex`: logo + title (`Typography.Title level={5}`), area navigation (`Menu mode="horizontal"` for admin: App management / User management), right side `Space` of `Dropdown`s — language (`GlobalOutlined`), theme mode (`BulbOutlined`/`MoonOutlined`), account (`UserOutlined`, email + log out) — and the GitHub link (`GithubOutlined`). Mobile (`!screens.md`): navigation collapses into a `Drawer` opened by `MenuOutlined`.
- `components/shell/admin-shell.tsx` / `user-shell.tsx`: `Layout` → `AppHeader` → `Layout.Content` on `color-bg-layout`, content card on `color-bg-container` where the page is a form/table. The chat page keeps its own `Layout.Sider` for conversations inside `UserShell`.
- All of this is new code: CSS Modules + tokens only, no Tailwind. Existing page bodies render as they are (with their Tailwind classes) inside the new shells; the `--theme-*` and shadcn variables remain declared (now as aliases of `--ant-*` on `.ant-app`) so those bodies keep their colours until migrated.

### 3.4 What changes in the old code

- `components/layout/*` (page-layout-wrapper, page-layout, admin-page-layout, admin-header-title) and `components/shared/header-layout.tsx`, `center-title-wrapper.tsx`, `logo.tsx` are replaced by the shells; `components/auth/account-menu.tsx`, `components/chat/i18n-switcher`, `lib/theme/theme-selector.tsx` are rewritten as the three header `Dropdown`s under `components/shell/`.
- `components/chat/main-layout.tsx` loses its `XProvider`; chat/common/workflow layouts keep their centre content but hand the header to `UserShell`.
- `app/globals.css`: Tailwind import and shadcn `:root`/`.dark` blocks stay for now; the `--theme-*` block becomes the `.ant-app { … }` alias block from the earlier design; antd/X override rules are reviewed and kept only where still needed.

### 3.5 Verification (sub-project 1)

- e2e: smoke flows from sub-project 0 plus header interactions (language switch changes a visible label; theme switch flips `--ant-color-bg-layout` on the layout element; account dropdown shows the email and logs out); mobile drawer navigation.
- Screenshots: `/login`, `/apps`, `/app-management`, `/chat/[appId]` in light/dark × desktop/mobile.
- Production check: `pnpm build && pnpm start` once; the login page HTML must contain antd's inlined styles (`AntdRegistry`), otherwise the aliases get `var(--ant-…, fallback)` values and the finding goes to the charter's risk log.
- `antd lint ./` count must not grow; `tsc`, `oxlint`, `oxfmt`, vitest green; Docker rebuild before merge.

## 4. Out of scope here

Page internals (chat bubbles, tables, forms), Tailwind removal, Lucide removal, XMarkdown — sub-projects 2–4.

## Spec drift (resolved 2026-10-05)

The foundation handoff (`docs/superpowers/handoffs/2026-10-04-frontend-foundation.md`, "Spec drift to reconcile") listed five places where the branch differs from §2–§3 above; the approved plan decided each, and this spec now defers to what was built. Where each landed:

1. **Theme provider location.** §3.1 moves `ThemeContextProvider` to `components/providers/` as `ThemeModeProvider`; it stays `ThemeContextProvider` in `lib/theme/theme-context.tsx`, used by `components/providers/app-providers.tsx`. Since sub-project 2 it starts from the theme cookies the root layout reads ([ADR-0016](../../decisions/0016-store-the-theme-preference-in-cookies.md)).
2. **i18n provider.** §3.1 names an `I18nProvider` component running `useHtmlLang`; sub-project 1 used the module i18n instance with `useHtmlLang()` inside `AppProviders`. Since sub-project 2 (Task 18b) the stack is `I18nextProvider` (a per-request clone with the cookie's language on the server) → `InitialLanguage` (react-i18next `useSSR`) → `SessionProvider` → `ThemeContextProvider` → `XProvider` → `App`, with `useHtmlLang()` kept for changes after hydration (ADR-0005 note of 2026-10-05, `docs/i18n-maintenance.md`).
3. **Where `UserShell` renders.** §3.2 has the `(user)` layout render `UserShell`; the apps page and the chat views render it (the chat passes header slots: the wide-screen toggle and the mobile menu). Since sub-project 2 the `(user)` layout is the server gate (`requireSessionUser()`, [ADR-0018](../../decisions/0018-gate-route-groups-on-the-server.md)) and renders only its children.
4. **shadcn blocks.** §3.4 says they "stay for now"; they are aliased to antd tokens through the `--theme-*` variables on `.ant-app` ([ADR-0012](../../decisions/0012-alias-legacy-theme-variables-to-antd-tokens.md)) and go in sub-project 4.
5. **Stub catalogue.** §2.3 describes the full stream catalogue; sub-project 1 shipped the plain chat stream only. Sub-project 2 completed it in `e2e/fixtures/stub/` (five apps by path prefix, agent, chatflow, HITL, error, file, citation and Markdown streams, per-user storage) and removed the test-only reset ([ADR-0010](../../decisions/0010-verify-the-frontend-with-playwright-and-a-stub-dify-api.md) note of 2026-10-05).
