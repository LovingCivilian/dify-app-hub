# App list, admin and auth pages on antd — design (frontend overhaul, sub-project 3)

Date: 2026-10-06 · Status: draft for review · Branch: `feat/admin-apps-auth-on-antd` (from `fork/overhaul` @ 9e4ba79e)

Governing documents: the charter (`2026-10-04-frontend-overhaul-charter.md`, §4 binding, §4.5 these pages, row 3 of the sub-projects table), ADR-0002 (documented approaches only), ADR-0008 (rebuild on antd 6 / X 2), ADR-0010 (Playwright + stub Dify, no test switches in product code), ADR-0011 (viewport-bound shells), ADR-0012 (alias block), ADR-0014 (header controls), ADR-0018 (server gate in the route-group layouts), ADR-0019 (two product lines; ADR numbers after 0019 are per line). Inputs from the sub-project 2 handoff (`docs/superpowers/handoffs/2026-10-05-chat-on-ant-design-x-execution.md`, "Sub-project 3 inputs") are all addressed below.

Library versions this spec was checked against: `antd` 6.6.5, `next` 16.3.4 (Cache Components off), `react` 19.2.6, `next-auth` 4.24. Dify shapes come from `langgenius/dify-docs` → `en/api-reference/openapi_service.json` and Dify's source where the document is silent (§14).

## 1. Goal and non-goals

**Goal.** Rebuild the app list (`/apps`), app management (`/app-management`), user management (`/user-management`), the auth pages (`/login`, `/forgot-password`, `/reset-password`), first-run setup (`/init`) and the root redirect (`/`) the way antd 6 and Next 16 document it: server pages load what the first paint needs, client components handle interaction, every screen is composed of antd components and token-only CSS Modules, no feature is lost, the known defects are fixed, and the owner's light-polish picks are added (load/error states, search and filter, Dify app icons).

**Owner decisions taken in brainstorming (2026-10-06).**

| Topic | Decision |
| --- | --- |
| Scope | Faithful rebuild plus light polish: load/error states, search and filter, Dify app icons. The user table keeps its always-green "Active" tag. |
| Data loading | Server pages on every route in scope (option 1): the page checks the session, loads, trims to what the screen shows, passes it to a client component. |
| Chat | Untouched. Moving its app lookup to the server is a follow-up (§12). |
| Disabled apps | Hidden from `/apps`, with the predicate `/chat`'s index already uses (`isEnabled !== EIsEnabled.disabled`). |
| Admin actions | **Edit** plus a **More** dropdown instead of five link buttons. |
| Password minimum | 8 characters everywhere (init, reset, admin create/edit); client-side, as today. |

**Non-goals.** The chat (`/chat/**`, `components/chat/**`). The backend: API routes, `app/(admin)/app-management/actions.ts`, `utils.ts`, `repository/`, `lib/auth*`, `proxy.ts`, `lib/dify-client.ts` (only the line-level edits in §11). LDAP, roles, change password (backend rework, after sub-project 4). RTL. Sub-project 4's removals (the Tailwind package, `components/ui/`, the alias block, `lib/helpers/responsive.ts`).

## 2. Defects and inputs this spec resolves

| Input | Where it is resolved |
| --- | --- |
| Double padding (admin shell `paddingLG` + page `px-6`) | §3.4 |
| Admin table clipped on mobile (`scroll.x: 1200` + fixed columns) | §5.2 |
| Stray "0" on app cards (`{tags.length && …}`) | §4.2 |
| Login logo image warning (81×83 PNG forced to 64×64) | §7.1 |
| Last `antd lint` error (`antd/es/typography/Title` default import) and the 38 warnings (static `message.*`, Alert `message`) | §3.5, §10 |
| `LucideIcon` in `/apps` | §4.5 (component deleted) |
| `/apps` lists disabled apps | §4.1 |
| `/apps` shows untranslated mode labels (`AppModeLabels`, literal `'unknown'`) | §4.2 |
| A failed app update shows "saved" (`updateApp` resolves `{ success: false }`) | §5.3 |
| Sync and delete errors are never caught | §5.3 |
| Every API key reaches the browser with the admin list | §5.1 |
| Routes answer in Chinese and the pages print that text | §3.6 |
| `/init` shows the form, then redirects with a toast on an initialised instance | §7.5 |
| `/forgot-password` shows the form, then swaps in the "mail not configured" warning | §7.3 |
| `/` is a client spinner that `router.replace`s to `/apps` | §7.6 |
| `e2e/theme-aliases.spec.ts` reads `.text-theme-desc` on `/apps` | §9.2 |

## 3. Architecture

### 3.1 Server page, trimmed props, client component

Every route in scope follows one pattern (ADR-0020, §11):

1. The server `page.tsx` checks the session itself where it reads data (`requireSessionUser()`; the session is cached per request by `getCachedServerSession`, so the layout's check and the page's cost one lookup). Next's authentication guide: layouts do not re-render on navigation, so checks belong close to the data (`02-guides/authentication.md` §"Layouts and auth checks").
2. It loads the first-paint data from server code.
3. It trims the data to the fields the screen shows (plain objects, ISO strings for dates) — Next's data-security guide (`02-guides/data-security.md`, data transfer objects).
4. It renders a client component under `components/<feature>/` with those props. `app/` keeps routing files only (charter §4.1).

| Route | Server page loads | Client component |
| --- | --- | --- |
| `/` | — ; `redirect('/apps')` | — |
| `/apps` | `getAppList()` (`repository/app.ts`), enabled apps only, trimmed to `AppSummary` | `components/apps/app-gallery.tsx` |
| `/app-management` | `listApp({ isMask: true })` (`actions.ts`), trimmed to `AdminAppRow` (no `requestConfig`) | `components/admin/apps/app-management.tsx` |
| `/user-management` | `listUsers()` (§3.2) and `session.user.id` from `getCachedServerSession()` | `components/admin/users/user-management.tsx` |
| `/login` | `callbackUrl`, `email` from `searchParams` (a Promise in Next 16, `03-file-conventions/page.md`) | `components/auth/login-form.tsx` |
| `/forgot-password` | `isMailConfigured()` (`lib/mail.ts`) | `components/auth/forgot-password-form.tsx`, or the warning |
| `/reset-password` | `token` from `searchParams` | `components/auth/reset-password-form.tsx`, or the invalid-link `Result` |
| `/init` | `hasUsers()` (§3.2); `redirect('/login')` when true | `components/auth/init-form.tsx` |

Server Components may call functions exported from a `'use server'` module directly (`01-directives/use-server.md`); the repo already does it (`app/(user)/chat/page.tsx`). `redirect()` throws `NEXT_REDIRECT`, so it stays outside any `try/catch` (`04-functions/redirect.md`).

Every route in scope is already rendered at request time, so no page that reads the database is prerendered at build: the root layout awaits `cookies()` and the session (a request-time API makes the route dynamic, `04-glossary.md` §Prerendering), and the `(user)`/`(admin)` layouts also export `dynamic = 'force-dynamic'` (`02-guides/caching-without-cache-components.md`, route segment config). The new pages add no segment config of their own.

### 3.2 `lib/data/users.ts` (new, fork-owned)

`listUsers(): Promise<UserRow[]>` (id, name, email, createdAt, updatedAt; newest first) and `hasUsers(): Promise<boolean>`. The module starts with `import 'server-only'`: Next handles that import itself and fails the build if a client module imports it (`02-guides/data-security.md` §"Preventing client-side execution of server-only code"; the npm package's contents are not used). It is deliberately **not** a `'use server'` module, so it is not reachable as an endpoint (data-security guide: every export of a `'use server'` file is a POST endpoint). The two queries repeat the ones in `app/api/users/route.ts` (GET) and `app/api/init/status/route.ts`; the backend rework folds them together (§12). If `tsc` or oxlint rejects the unresolved side-effect import, the plan installs `server-only` as the same guide allows.

### 3.3 Loading and errors (Next file conventions)

- `app/(user)/apps/loading.tsx`: `UserShell` around skeleton cards (antd `Card` `loading`). `app/(admin)/loading.tsx`: a table skeleton inside `AdminShell` (the admin layout renders the shell; `loading.tsx` wraps the page only, `03-file-conventions/loading.md`).
- `error.tsx` in `app/(user)/apps/`, `app/(admin)/`, `app/(auth)/` and `app/init/`: client components rendering a shared `components/shell/route-error.tsx` — antd `Result status="error"`, a translated title, and a Retry button calling Next 16.3's `retry()` (re-fetches and re-renders the segment; `03-file-conventions/error.md`). The `(user)/apps` one wraps `UserShell` (that page renders its own shell). In production a server error's message is replaced by a digest, so the screen shows translated text only.
- Known limit: the `(user)` and `(admin)` layouts read the session cookie and Cache Components is off, so entering an area waits for the layout before anything shows and the skeleton covers only the page's own data (`loading.md` "Good to know"; `layout.md` §"Interaction with loading.js"). The documented fix (a `<Suspense>` around the layout's check) would turn the gate's redirect into a client-side meta-tag redirect inside a stream (`redirect.md`), so the layouts stay as ADR-0018 made them.

### 3.4 Shells and page frame

- `components/shell/admin-shell.tsx`: the content padding moves from the inline `token.paddingLG` to `shell.module.css`, mobile first (`--ant-padding` below md, `--ant-padding-lg` from `@media (min-width: 768px /* screenMD */)`). Pages add no outer padding of their own.
- `/apps` gets the same frame from its own CSS Module (`UserShell` content has no padding because the chat fills it edge to edge).
- `components/admin/admin-page-header.tsx` (new): `Flex` with `wrap`, `justify="space-between"`, `align="center"` holding a `Typography.Title level={4}`, an optional secondary subtitle and the primary action; shared by both admin pages.
- `components/shell/auth-card.tsx`: its inline styles move to `auth-card.module.css` (`min-height: 100vh` then `100dvh`, `--ant-color-bg-layout`, `--ant-padding-lg`); it gains the brand header (§7.1).

### 3.5 Mutations and feedback

- Writes keep their current endpoints and actions: `createApp`, `updateApp`, `deleteApp`, `getApp` (`actions.ts`); `POST /api/users`, `PUT|DELETE /api/users/[id]`; `POST /api/auth/forgot-password`, `/api/auth/reset-password`, `/api/init`; Dify through `lib/api` `DifyApi` from the browser (§5).
- After a successful write the client calls `router.refresh()`: a new server request re-renders the Server Components and merges the result without losing client state (search text, table page, scroll) (`04-functions/use-router.md`). `refresh()` from `next/cache` is for Server Actions only and the actions stay untouched.
- Messages and confirms come from `App.useApp()` (`message`, `modal`) — the single `App` at the root (ADR-0008). No static `message`/`Modal` call remains in these pages or in `lib/api/base-request.ts`.

### 3.6 Error text: status codes to translation keys

The routes answer with Chinese `message` strings. The client never prints them; it maps the status to a key, which is sound because the forms already guarantee the fields the routes would otherwise reject:

| Call | Status | Key (new keys in §8) |
| --- | --- | --- |
| `POST /api/users` | 400 | "email already in use" |
| `PUT /api/users/[id]` | 400 / 404 | "email already in use" / "user not found" |
| `DELETE /api/users/[id]` | 400 / 404 | "you cannot delete your own account" / "user not found" |
| `POST /api/auth/reset-password` | 400 | "link invalid or expired, request a new one" |
| `POST /api/init` | 400 | `init.already_initialized` (then `/login`) |
| any of the above | 401 | "session expired, sign in again" |
| any of the above | other / network | the existing generic keys (`common.operation_failed`, `auth.reset_failed_retry`, `init.failed`, `common.network_error_retry`) |

The maps are pure functions with unit tests (§9.4). The routes keep their statuses and bodies.

## 4. `/apps`

### 4.1 Page

Server page: `requireSessionUser()`, `getAppList()`, keep apps whose `isEnabled !== EIsEnabled.disabled`, map each to `AppSummary` (`{ id, name, description, mode, tags }`, or `{ id, missingInfo: true }` when the row has no `info`). Nothing from `requestConfig` reaches the client. Renders `UserShell` around `AppGallery`.

### 4.2 Gallery and card

- `Typography.Title level={4}` (`app.list`), the search box (§4.4), then `Row` with a token gutter and `Col xs={24} sm={12} lg={8} xl={6}` (antd's grid switches by CSS classes, so the server HTML is already correct).
- Card: `next/link` `<Link href="/chat/{id}">` wrapping `<Card hoverable>` — a real link (keyboard, open in new tab); antd documents no whole-card link pattern, so this is plain HTML semantics. `Card.Meta`: `avatar` = `AppIcon` (§4.3), `title` = name, `description` = the mode through `t(AppModeNames[mode])` (omitted when the mode is unknown). Body: `Typography.Paragraph ellipsis={{ rows: 2 }}` with the description or `app.no_description_user`; tags as antd `Tag`s inside `Flex wrap`, rendered only when `tags.length > 0`.
- `missingInfo` rows: a non-link `Card` with `Typography.Text type="secondary"` (`app.info_missing`).
- Static styles in `app-gallery.module.css` with `var(--ant-*)` values only.

### 4.3 `AppIcon`

Client component, also used by the admin table (§5.2).

- Reads `GET /api/client/dify/{id}/site` (existing proxy route; session required; answers `{ code, data }`, with Dify's error body in `data` on failure). Shows `Skeleton.Avatar` (square) while loading.
- `data.icon_type === 'emoji'`: square `Avatar` with the emoji as its child and `style={{ backgroundColor: data.icon_background }}` (Dify data passed through `style`, not a colour literal in code). `'image'`: `Avatar src={data.icon_url}`. `'link'`: `Avatar src={data.icon}` (Dify source `IconType` = image/emoji/link; `icon_url` is filled only for `image`).
- Anything else — Dify's 403 when the app has no site, an envelope without a string `icon_type`, a network error, a Dify version without `/site` — renders the mode fallback from `@ant-design/icons` inside the square `Avatar`: `MessageOutlined` (chat), `RobotOutlined` (agent-chat), `ApartmentOutlined` (advanced-chat), `DeploymentUnitOutlined` (workflow), `FileTextOutlined` (completion), `AppstoreOutlined` (unknown).
- The decision `site → icon kind` is a pure function with unit tests (§9.4). One request per rendered icon; §12 records the sync-time alternative.

### 4.4 Search and empty states

- `Input` with `allowClear`, a `SearchOutlined` prefix and a translated placeholder; case-insensitive (`toLocaleLowerCase`) match on name, description and tags, over the list the server passed in. antd documents no toolbar-search demo for lists or tables; filtering the array before rendering is plain data handling, not a library mechanism.
- No apps at all: `Empty` with `app.empty_contact_admin`. No match: `Empty image={Empty.PRESENTED_IMAGE_SIMPLE}` with a new "no apps match" key.

### 4.5 Removed with the old page

The `LucideIcon` import, `useIsMobile`, ahooks `useRequest`, `services/app.ts` usage (the chat still uses it) and the static `message.error`. `components/shared/` (`index.ts`, `lucide-icon.tsx`) has no importer left and is deleted.

## 5. `/app-management`

### 5.1 Page

Server page: `requireSessionUser()`, `listApp({ isMask: true })`, map to `AdminAppRow` (`{ id, name, mode, description, tags, isEnabled, missingInfo? }`). The list carries no `requestConfig`; the full record (with the real key) is fetched with `getApp(id)` only when the admin opens edit, sync or annotations — the form shows and edits the key, and the browser calls Dify with it, as today.

### 5.2 Table

- `AdminPageHeader` (`admin_apps.title`, primary **New** with `PlusOutlined`), then the search box of §4.4 (name, description, tags).
- `Table rowKey="id"` with columns: **Name** (`AppIcon` + name, `ellipsis`), **Type** (translated; `filters` + `onFilter` by mode), **Description** (`ellipsis`, fallback `app.no_description`), **Tags** (`Tag`s in `Flex wrap`), **Status** (`Tag color="success"` / default; `filters` + `onFilter`), **Actions**.
- `scroll={{ x: 'max-content' }}` and **no fixed columns**: on a phone the table scrolls sideways inside its container instead of being clipped (`scroll.x` documented values; fixed columns require `scroll.x` and caused the clipping).
- No column uses `responsive`: antd's `InternalTable` drops responsive columns from the server HTML and the first client render and adds them after a layout effect (`es/table/InternalTable.js`, `es/grid/hooks/useBreakpoint.js`), which on a server-rendered table makes columns pop in.

### 5.3 Actions

- **Edit** (link button) and **More** (`Dropdown` on click, trigger `Button type="text" icon={<EllipsisOutlined />}` named through an i18next key, ADR-0014) with items:
  - **User view**: a real link opening `/chat/{id}` in a new tab (`target="_blank" rel="noreferrer"`).
  - **Sync info**: `getApp(id)` → `DifyApi.getAppInfo()` from the browser → `updateApp({ ...rest, info: { ...info, ...appInfo } })`.
  - **Annotations**: only for `chat`, `advanced-chat` and `agent-chat` apps (the modes Dify documents annotations for).
  - **Delete** (`danger`): `modal.confirm` whose `onOk` returns the `deleteApp` Promise, so the dialog stays open with a loading OK button until it settles (antd Modal hooks).
- Every action runs inside `try/catch`; `updateApp`'s `{ success: false }` result counts as a failure. Success: translated message, then `router.refresh()`.

### 5.4 Create/edit drawer

- `Drawer size="large"` (`width` is deprecated in 6.x; antd caps drawers at `100vw`), `destroyOnHidden`, Cancel/Save in `extra` (antd form-in-drawer demo). Edit fetches `getApp(id)` first and shows a `Skeleton` until it arrives; the Form mounts with `initialValues` from the record.
- `Form layout="vertical"` with array name paths in `IDifyAppItem`'s shape (`['requestConfig','apiBase']`, `['requestConfig','apiKey']`, `['info','mode']`, `'isEnabled'`, `['inputParams','enableUpdateAfterCvstStarts']`, `['extConfig','conversation','openingStatement','displayMode']`, `['extConfig','annotation','enabled']`, `['answerForm','enabled']`, `['answerForm','feedbackText']`). Dotted strings are single keys in antd (`getNamePath = toArray(path)`), which is why the old drawer rebuilt the object by hand; array paths remove that.
- Booleans are `Switch`es (`valuePropName="checked"`). The 1/2 status uses `getValueProps: v => ({ checked: v === EIsEnabled.enabled })` and `normalize: c => (c ? EIsEnabled.enabled : EIsEnabled.disabled)` (Form API; `valuePropName` is ignored once `getValueProps` is set). The feedback text shows only while form-reply is on (`Form.useWatch`).
- Sections: `Divider titlePlacement="start"` with the existing `app_setting.section_*` titles (replaces the `#1669ee` bars; `orientation="left"` is deprecated). In edit mode name, description and tags show as `Descriptions` above the form.
- Save: `validateFields` → `DifyApi.getAppInfo()` with the entered base and key (browser, as today) → `createApp(item)` or `updateApp({ id, ...item })` (mode falls back to the form's when Dify returns none) → result check → message → close → `router.refresh()`. An unreachable Dify or a rejected key shows a new "could not reach the Dify app; check API Base and API Secret" key and keeps the drawer open.
- The conversion record ↔ form values is a pure module with unit tests (§9.4).

### 5.5 Annotations drawer

- Opens after `getApp(id)` (the browser needs the base and key). `Drawer size="large"`, `destroyOnHidden`.
- Toolbar: `Input.Search` sending Dify's documented `keyword` (`GET /apps/annotations`, "filter annotations by question or answer content"; Dify source `AnnotationListQuery.keyword`) and **Add**. Needs the `keyword` parameter on `getAnnotationList` in `lib/api/client.ts` (§11).
- `Table` with server paging as today (`page`, `limit` ≤ 100, `total`): question and answer as `Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}` (replaces the popovers), hit count, created at (`formatDateTime`; client-fetched, so no hydration concern), actions **Edit** and **Delete** (`Popconfirm` whose `onConfirm` returns the Promise, so its OK button loads until it settles — antd `ActionButton`).
- A failed load shows `Result status="error"` with Retry inside the drawer.
- Add/edit: antd's form-in-modal pattern — `Modal` with `destroyOnHidden`, the `Form` with `clearOnDestroy` in `modalRender`, OK as `htmlType: 'submit'` — instead of a drawer inside the drawer.

## 6. `/user-management`

- Server page: `requireSessionUser()`, `listUsers()` (dates as ISO strings), and `session.user.id` (the database id; `getSessionUserId()` returns the email). `useSession` leaves the page.
- `AdminPageHeader` (`admin.menu_users`, subtitle `admin_users.subtitle`, primary **Add user** with `PlusOutlined`), search box matching name and email.
- `Table`: **User** (`Avatar icon={<UserOutlined />}`, the name or `admin_users.name_not_set`, the email as secondary text), **Status** (the existing `Tag color="green"` "Active", unchanged by owner decision), **Created**, **Updated**, **Actions** (**Edit**; **Delete** through `Popconfirm` with a Promise `onConfirm`, hidden on the signed-in user's row as today). Pagination keeps `showSizeChanger`, `showQuickJumper`, `showTotal`. `scroll={{ x: 'max-content' }}`, no fixed columns.
- **Dates.** A server-rendered client component would format times in the server's time zone (the container's UTC) and then mismatch the browser's during hydration; `suppressHydrationWarning` only silences that and leaves the server text unpatched (react.dev, hydration mismatch). React's documented answer is two-pass rendering (react.dev, "Two-pass rendering with isClient"): `components/admin/client-date-time.tsx` renders `<time dateTime={iso}>` with a placeholder on the server and the first client render, and `formatDateTime(iso, i18n.resolvedLanguage)` after mount. The plan picks the exact mount flag (state set in an effect, or `useSyncExternalStore` with a server snapshot) against the lint rules in force.
- Drawer: default `size` (378 px), `destroyOnHidden`, Cancel/Save in `extra`; `Form layout="vertical"`: name (required), email (required, type email), password (create: required, min 8; edit: optional, min 8, help "leave blank to keep"). `admin_users.password_min_6` is replaced by the existing 8-character key.
- Errors through §3.6; success → message → `router.refresh()`.

## 7. Auth pages, `/init`, `/`

### 7.1 Frame

`AuthCard` (the `(auth)` layout, and `/init` directly) keeps the centred `Card` on `color-bg-layout`, with its styles in a CSS Module (§3.4), and gains a brand header shown on every auth page and on `/init`: the logo through `next/image` with `width={64}` only (Next derives the height from the static import, keeping the real 81×83 ratio) and "Dify App Hub" as `Typography.Title level={3}`.

### 7.2 `/login`

Server page reads `callbackUrl` and `email` and renders `LoginForm`. The form becomes `layout="vertical"` with visible labels; it keeps the placeholders "Email address" and "Password", the "Log in" button (e2e contracts), `size="large"`, the prefix icons and the flow (`signIn('credentials', { redirect: false })` → `getSession()` → `router.push(getSafeCallbackUrl(callbackUrl))`). "Forgot password?" becomes a `next/link` `Link`. The login layout's `redirectSignedInUser()` stays.

### 7.3 `/forgot-password`

When `isMailConfigured()` is false the server page renders the warning `Alert` (`title`, since `message` is deprecated) and a back-to-login link, with no form. Otherwise `ForgotPasswordForm`: email; after sending, the "check your inbox" text (`auth.reset_link_sent`) and the back button. Non-OK and network failures keep `common.request_failed_retry`.

### 7.4 `/reset-password`

No token: `Result status="error"` (`auth.reset_link_invalid`) with a back-to-login button; the `Suspense` wrapper goes. With a token: `ResetPasswordForm` — new password (min 8), confirm with `dependencies={['password']}` and a match validator (Form API). 200 → message → `router.replace('/login')`; 400 → the "link invalid or expired" key with a link to `/forgot-password`; other → `auth.reset_failed_retry`.

### 7.5 `/init`

Server page: `hasUsers()` true → `redirect('/login')` (the old info toast cannot survive a server redirect and goes). Otherwise `AuthCard` with `InitForm`: `init.title`, `init.description`, the info `Alert` (`title`), name, email, password (min 8), confirm (`dependencies` + match validator, replacing the submit-time `message.warning`). 201 → message → `/login?email=…`; 400 → `init.already_initialized` → `/login`; other → `init.failed`. `/init` stays ungated in `lib/access.ts`; the page check and `POST /api/init`'s own refusal are its guards.

### 7.6 `/`

`app/page.tsx` becomes a server component calling `redirect('/apps')`. Signed out, the proxy already sends `/` to `/login?callbackUrl=%2F`.

## 8. i18n

- Every new string is a typed key in `locales/{en,zh,ar}/translation.json` (`docs/i18n-maintenance.md`: add to all three, `pnpm test` checks key and placeholder parity, `pnpm exec tsc --noEmit` checks the types, no `count` interpolation name, no `i18next-cli extract/sync`). Arabic is Modern Standard Arabic with Arabic-Indic digits (ADR-0005) and joins the owner's wording review.
- New keys (final names in the plan; existing keys are reused where the text fits): app search placeholder, "no apps match"; admin "more actions", "could not reach the Dify app; check API Base and API Secret"; user search placeholder, "email already in use", "user not found", "you cannot delete your own account"; annotation search placeholder and load failure; "session expired, sign in again"; route-error title and Retry; "link invalid or expired, request a new one"; the brand header's alt text if one is needed.
- Keys left without a user (`admin_users.password_min_6`, `app.fetch_list_failed`, …) are removed from all three files; `pnpm i18n:lint` reports no hard-coded JSX text in the touched files.

## 9. Verification

### 9.1 New e2e specs (projects `desktop-light`, `desktop-dark`, `mobile-light`; role and name locators; web-first assertions)

- `e2e/apps.spec.ts`: enabled stub apps show and the seeded disabled app does not; search filters and a miss shows the no-match empty state; a card is a link to `/chat/{id}`; an emoji icon comes from the stub's `/site`; the no-site app shows its mode icon.
- `e2e/admin-apps.spec.ts`: create (stub API base on a prefix whose `/info` returns a distinct name; the new row shows it); edit (a `Switch` change persists after reopening); sync info; Type filter; search; delete through the confirm; a bad API base shows the translated error and the drawer stays open; annotations: list, keyword search, add and edit through the modal, delete; mobile: the table scrolls sideways and **More** is reachable. Rows it creates are deleted, so a reused database stays clean.
- `e2e/admin-users.spec.ts`: add (7 characters refused, 8 accepted); edit; duplicate email → "email already in use"; delete through the `Popconfirm`; the signed-in user's row has no Delete; search. Users it creates are deleted.
- `e2e/auth.spec.ts`: wrong password → error; sign-in honours `callbackUrl`; `/` signed in → `/apps`; `/init` on the initialised database → `/login`; `/forgot-password` shows the state `.env.e2e` implies; reset: no token → invalid-link `Result`; a valid token (inserted into MySQL with `hashPasswordResetToken` from `lib/password-reset.ts`, for a throwaway user the test creates through `/api/users`) sets the password and signing in with it works; reusing the token → "link invalid or expired".

### 9.2 Existing specs

- `theme-aliases.spec.ts`: `/apps` no longer has `.text-theme-desc`; the test adds its own element with that class inside `.ant-app` (`page.evaluate`) and asserts the alias colour in both schemes. The alias block lives until sub-project 4; ADR-0010 bars a product-code test switch.
- `ssr-first-paint.spec.ts`: adds the server-rendering proof — the raw HTML of `/apps`, `/app-management` and `/user-management` already contains the stub app names and the admin email.
- `screenshots.spec.ts`: adds forgot-password, reset-password (with and without a token), the app drawer, the annotations drawer and the user drawer; existing ready conditions (`.ant-card` on login, "Stub app", the admin email, no spinner) stay true.
- `smoke.spec.ts`, `shell.spec.ts`, `auth.setup.ts`, `providers.spec.ts`: locators unchanged (`header.ant-layout-header`, `.ant-table`, "Stub app", the menu items, the login placeholders and button, one `.ant-app`).

### 9.3 Stub and seed (test-only)

- `e2e/fixtures/stub/`: CORS headers on every response and `OPTIONS` preflight answered, as Dify's service API does (flask-cors defaults: any origin, no credentials; allowed headers `Content-Type`, `Authorization`, `X-App-Code`, `X-App-Passport`; methods GET, PUT, POST, DELETE, OPTIONS, PATCH — Dify `api/extensions/ext_blueprints.py`). Annotations: list with `page`, `limit`, `keyword`, `total`, update and delete, stored per app. `/site` variants: emoji (default), image, and 403 for a no-site prefix. A create prefix whose `/info` returns a distinct name.
- `e2e/auth.setup.ts` seeds a disabled app and a no-site app (idempotent, like the existing rows).

### 9.4 Unit tests (vitest, node environment, written first)

The search matcher; `toAppSummary` and `toAdminAppRow` (enabled filter, no `requestConfig`, `missingInfo`); `site → icon kind`; the app form conversion both ways (including the 1/2 status); the §3.6 status → key maps.

### 9.5 Gates before the PR

- `pnpm exec tsc --noEmit`, `pnpm exec oxlint`, `pnpm exec oxfmt --check`, `pnpm test`, `pnpm i18n:lint`.
- `npx -y @ant-design/cli lint ./`: 0 findings (39 today, all in these pages and `lib/api/base-request.ts`); the ratchet in `docs/frontend-conventions.md` drops to 0.
- Grep gates over the touched files: no Tailwind utility classes, no `--theme-`, no `lucide`, no hex/rgb/oklch literals, no static `message.`/`Modal.` calls, no `antd/es/` imports.
- Full `pnpm test:e2e`, then — never at the same time — the Docker rebuild and the curl checks in `CLAUDE.md`. Screenshots are reviewed in chat, not committed.

### 9.6 Gaps stated

- The `/init` form UI has no e2e: it needs an empty database and the suite's database holds the admin. The redirect is covered (§9.1) and the API path by `auth.setup.ts`.
- The `error.tsx` screens cannot be triggered without a test switch in product code (ADR-0010); they are verified by review.

## 10. Lint and conventions

The rebuilt files follow charter §4.3: antd components first; static styles in colocated CSS Modules with `var(--ant-*)` only; runtime values through `theme.useToken()`; breakpoint differences by the mobile-first `screenMD` query; no literals, magic pixel numbers, Tailwind classes, `!important` or Lucide; `Flex` for layout (antd 6: `Space` `direction` is deprecated). Drawer sizes use the named `size` values, not pixel numbers.

## 11. Documentation, decisions, files outside the pages

- **ADR-0020** (new, this PR): server pages load the first-paint data; trimmed plain objects go to client components; each data page checks the session itself; loading and errors use `loading.tsx`/`error.tsx` with `retry()`; the chat keeps its client-side loading as the stated exception; `lib/data/` holds `server-only` read functions that are not `'use server'`.
- Same PR: `docs/frontend-conventions.md` (status, lint ratchet 0), `CLAUDE.md` (decision line for ADR-0020, "Where things are" for `components/apps|admin|auth` and `lib/data/`, next step), a handoff under `docs/superpowers/handoffs/` at the session end.
- Line-level edits outside the pages: `lib/api/client.ts` (`getAnnotationList` accepts `keyword`; `IGetAnnotationListRequest` gains it), `lib/api/base-request.ts` (the 401 branch throws `UnauthorizedError` without the static `message.error`; only the admin pages use this client — the chat imports types from `lib/api` and its own `DifyApi` from `lib/dify-client.ts`). New fork-owned: `lib/data/users.ts`.
- Dependencies: none added (`server-only` only if §3.2's fallback applies).

## 12. Follow-ups (recorded, not in this sub-project)

- The chat's app lookup moves to the server page (pass the trimmed app to `ChatWorkspace`; `services/app.ts` then has no user).
- Store the Dify icon on the app row at create/sync time if `/apps` traffic or app count grows (one `/site` request per card today).
- Backend rework: fold `lib/data/users.ts`'s queries and the route handlers together; session checks inside the Server Actions and `repository/app.ts` exports (brief item 1); a server-side password minimum; machine-readable error codes instead of Chinese text; `createSafeApp` still sends `apiBase` to clients.

## 13. Risks

- **Hydration mismatches** from server-rendered client components: dates handled by §6; language is the same on both sides (cookie, ADR-0016/0005 note); no `responsive` columns (§5.2); breakpoint markup by CSS only.
- **Forms in hidden drawers** ("Instance created by `useForm` is not connected"): the instance is used only while the drawer is open, and `destroyOnHidden` remounts the form with fresh `initialValues` (Form FAQ).
- **Refresh after writes** briefly shows the old list; the plan checks whether a React transition around `router.refresh()` is documented for Next 16 before showing a pending state.
- **The stub's CORS** could hide a real-Dify difference; it mirrors Dify's source settings (§9.3), and a reverse proxy in front of Dify is the owner's to check.
- **Memory on this machine**: never the Docker build and `pnpm test:e2e` together; one `next dev` per checkout.

## 14. Sources consulted

- antd 6.6.5 through `@ant-design/cli` 6.6.5 (`antd doc|demo|info`) and `https://ant.design/components/<name>.md`: Table (`scroll`, `fixed`, `filters`/`onFilter`/`filterSearch`/`filterDropdown`, `responsive`, `pagination.showTotal`), Drawer (`size`, deprecated `width`, `destroyOnHidden`, `forceRender`, `extra`, `push`), Form (`valuePropName`, `getValueProps`, `normalize`, `NamePath`, `useWatch`, `dependencies`, form-in-modal demo, FAQ), Divider (`titlePlacement`), Card (`hoverable`, `Card.Meta`, `loading`), Typography (`ellipsis`), Avatar, Skeleton, Result, Empty, Input (`allowClear`, `Input.Search`), App (`useApp`), Modal hooks (`onOk` Promise), Popconfirm (Promise demo), Space/Flex. Source facts not in the docs: `es/table/InternalTable.js` + `es/grid/hooks/useBreakpoint.js` (responsive columns after a layout effect), `es/drawer/style/index.js` (`maxWidth: 100vw`), `@rc-component/form/es/utils/valueUtil.js` (`getNamePath`), `es/_util/ActionButton.js` (Promise loading).
- Next 16.3.4 bundled docs (`node_modules/next/dist/docs/01-app/`): `03-api-reference/03-file-conventions/{loading,error,layout,page}.md`, `03-api-reference/04-functions/{use-router,refresh,redirect,use-search-params,connection}.md`, `02-guides/{authentication,data-security,caching-without-cache-components}.md`, `01-directives/use-server.md`, `01-getting-started/{07-mutating-data,10-error-handling}.md`.
- React (Context7 `/websites/react_dev`): hydration mismatch — `suppressHydrationWarning` does not patch text; two-pass rendering with an `isClient` flag.
- Dify: `openapi_service.json` (`getChatWebAppSettings` → `/site` fields and 403; `GET /apps/annotations` `keyword`, `page`, `limit` ≤ 100); source `api/models/model.py` (`IconType`), `api/controllers/common/fields.py` (`icon_url`), `api/controllers/service_api/app/annotation.py`, `api/extensions/ext_blueprints.py` (service API CORS).
- Repo: `lib/session-user.ts`, `lib/access.ts`, `proxy.ts`, `lib/api-utils.ts` (`createSafeApp`, `createDifyApiResponse`), `repository/app.ts`, `app/(admin)/app-management/actions.ts`, `app/api/users/**`, `app/api/auth/**`, `app/api/init/**`, `app/api/client/dify/[appId]/site/route.ts`, `lib/core/constants.ts`, `e2e/**`.
