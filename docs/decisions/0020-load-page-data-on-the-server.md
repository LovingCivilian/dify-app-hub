---
status: accepted
date: 2026-10-06
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (sub-project 3)
---

# Load a page's first paint on the server and hand trimmed props to client components

## Context and Problem Statement

Before sub-project 3, the app list (`/apps`), app management (`/app-management`), user management (`/user-management`), the auth pages (`/login`, `/forgot-password`, `/reset-password`), first-run setup (`/init`) and the root (`/`) were Client Components that fetched after hydration. Every first paint was a spinner followed by a second round trip; `/init` and `/forgot-password` showed their form and then swapped it for a redirect or a warning; `/` was a client spinner that called `router.replace('/apps')`; the admin list sent every app's API key to the browser; and the pages printed the Chinese `message` strings the routes answer with.

The charter (`docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` §4.1, `docs/frontend-conventions.md` §4.1) asks for server components by default and a route-level `loading.tsx` where a page fetches. Next's authentication guide asks for session checks close to the data, because a layout does not re-render on navigation (`01-app/02-guides/authentication.md` "Layouts and auth checks"). [ADR-0018](0018-gate-route-groups-on-the-server.md) already gates the `(user)` and `(admin)` groups in their server layouts. How should these pages get their data so the first HTML shows it, only what the screen needs reaches the browser, and the session is checked where the data is read?

## Decision Drivers

- The first HTML carries what the screen shows: no spinner, no second round trip (the goal [ADR-0016](0016-store-the-theme-preference-in-cookies.md) and ADR-0018 reached for the shells).
- Only the fields the screen shows reach the browser; no API key in the admin list (Next data-security guide, data transfer objects).
- The session is checked where data is read, not only in the layout.
- Documented Next.js and React APIs only ([ADR-0002](0002-use-documented-library-approaches-only.md)); no new dependency; backend files stay upstream-shaped ([ADR-0009](0009-treat-the-frontend-as-fork-owned.md)).
- No hydration mismatch from server-rendered client components (dates, breakpoints, language).

## Considered Options

- Rebuild the client pages as they are: client fetching after hydration, with antd skeletons instead of spinners.
- Server pages on every route in scope: the page loads (checking the session first where it reads signed-in data), trims, and renders one client component with plain props.
- Hybrid: server-load `/apps` only and keep the admin and auth pages on the client.

## Decision Outcome

Chosen option: "server pages on every route in scope" (owner decision in brainstorming, 2026-10-06), because it is the pattern Next documents for data a page needs before it can render, and one pattern for all of these pages is simpler to keep than two.

1. A server `page.tsx` that reads signed-in data (`/apps`, `/app-management`, `/user-management`) calls `requireSessionUser()` before it reads, outside any `try/catch` (`redirect()` throws); the public auth pages and `/init` read nothing protected. The session is cached per request by `getCachedServerSession()` (ADR-0018), so the layout's check and the page's cost one lookup.
2. It loads the first-paint data from server code: `getAppList()` (`repository/app.ts`), `listApp({ isMask: true })` (`app/(admin)/app-management/actions.ts`; a Server Component may call a `'use server'` export directly, `01-app/03-api-reference/01-directives/use-server.md`), `listUsers()` and `hasUsers()` (`lib/data/users.ts`), `isMailConfigured()` (`lib/mail.ts`), and `searchParams` (a Promise in Next 16, read through `firstParam` in `lib/search-params.ts`). `lib/data/` holds read functions that start with `import 'server-only'` (Next fails the build if a client module imports them) and are deliberately not `'use server'` modules, so they are not reachable as endpoints (data-security guide: every export of a `'use server'` file is a POST endpoint).
3. It trims the data to plain props: `toAppSummaries` (`components/apps/app-summary.ts`, enabled apps only), `toAdminAppRows` (`components/admin/apps/admin-app-row.ts`, no `requestConfig`; the real key is fetched with `getApp(id)` only when an action needs it), `toUserRows` (`components/admin/users/user-row.ts`, dates as ISO strings). Props to Client Components must be serialisable (`01-app/01-getting-started/05-server-and-client-components.md`). Dates are formatted after hydration in the browser's time zone (`components/admin/client-date-time.tsx`, React's two-pass rendering).
4. It renders one client component under `components/<feature>/`: `components/apps/app-gallery.tsx`, `components/admin/apps/app-management.tsx`, `components/admin/users/user-management.tsx`, `components/auth/{login,forgot-password,reset-password,init}-form.tsx`. `app/` keeps routing files only (charter §4.1). `/` and `/init` (when an admin exists) redirect on the server.
5. Writes keep their endpoints and actions (`createApp`, `updateApp`, `deleteApp`, `getApp`; `/api/users`, `/api/auth/*`, `/api/init`; Dify through `lib/api` from the browser); the admin writes end in `router.refresh()`, which re-renders the Server Components and merges the result without losing client state (`01-app/03-api-reference/04-functions/use-router.md`), and the auth forms navigate on success (the forgot-password form shows its sent state). A write's status is mapped to a translation key (`components/admin/users/user-errors.ts`, `components/auth/auth-failure.ts`); a route's message text is never printed.
6. Loading and errors use the file conventions: `loading.tsx` in `app/(user)/apps/` and `app/(admin)/`; `error.tsx` in `app/(user)/apps/`, `app/(admin)/`, `app/(auth)/` and `app/init/`, each rendering `components/shell/route-error.tsx` with a Retry button that calls Next 16.3's `retry()` (`01-app/03-api-reference/03-file-conventions/loading.md`, `01-app/03-api-reference/03-file-conventions/error.md`).
7. Messages and confirms come from `App.useApp()` (the single `App` at the root, [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md)); no static `message`/`Modal` call remains in these pages or in `lib/api/base-request.ts`.

The exception, stated: the chat (`/chat/[appId]`, [ADR-0017](0017-build-the-chat-on-ant-design-x.md)) keeps its client-side loading, because its data is interactive by nature (conversations, streamed replies, per-conversation stores). Moving its app lookup to the server page is a follow-up.

### Consequences

- Good, because every page in scope follows one pattern, and a new page copies it: server page, trim function, client component.
- Good, because the first HTML carries the data: `e2e/ssr-first-paint.spec.ts` reads the raw HTML of `/apps`, `/app-management` and `/user-management` and finds the stub app names and the admin's table row. `/init`, `/forgot-password` and `/` decide on the server, so no form is shown and then swapped.
- Good, because the admin list no longer carries API keys (the same spec asserts the key is absent from the HTML).
- Good, because the pattern's practical rules were verified against the docs or the installed library source while implementing it:
  - Typography margins go through the `style` prop. antd 6.6.5 emits `h4:where(.css-…).ant-typography` and `div:where(.css-…).ant-typography { margin-bottom: 1em }` (specificity 0,1,1; `es/typography/style/index.js` and `mixins.js`), which beats a single-class CSS Module rule (0,1,0) because no cssinjs layer is configured. Per-instance Typography margins are therefore `style={{ margin: 0 }}` / `{ marginBottom: 0 }` or a `theme.useToken()` value (the charter's §4.3 rule 3 allows the `style` prop); static layout values stay in CSS Modules with `var(--ant-*)`.
  - A Form inside a `destroyOnHidden` Drawer or Modal owns its instance: no parent-level `Form.useForm()`. `@rc-component/form` 1.8.6 keeps a hook-held store across openings (`merge(initialValues, store)` on remount, `es/hooks/useForm.js`), and `clearOnDestroy` empties the store under React Strict Mode without re-seeding it (`es/Form.js:79-86`, `es/hooks/useForm.js:96-99`). The `<Form>` is created per mount (antd Form API: the instance is "automatically created when not provided"); a button outside the `<form>` element (a Drawer's `extra`) submits through the HTML `form` attribute (`htmlType="submit" form={<id>}`), and a Modal's OK button inside `modalRender` uses `htmlType: 'submit'`. Files: `components/admin/apps/app-form-drawer.tsx`, `annotation-form-modal.tsx`, `components/admin/users/user-form-drawer.tsx`.
  - Stateful drawer bodies are children the Drawer unmounts. `components/admin/apps/annotations-panel.tsx` holds the annotations state and is rendered inside the Drawer keyed by `record.id`, so `destroyOnHidden` and React's "resetting state with a key" reset it per app; one `useEffect` keyed on the query object is the only fetcher, with React's documented `ignore` cleanup, and reloads bump a version counter.
  - Answers from `lib/api` are guarded (`isAppInfo`, `isAnnotationPage`, `isAnnotationItem`, `isFailedUpdate` in `components/admin/apps/app-record.ts`, and `response.ok`), because that client resolves Dify's error bodies as values.
- Bad, because the `(user)` and `(admin)` layouts read the session and Cache Components is off, so entering an area waits for the layout and the `loading.tsx` skeleton covers only the page's own data (`01-app/03-api-reference/03-file-conventions/loading.md` "Good to know"; `01-app/03-api-reference/03-file-conventions/layout.md`). The documented fix, a `<Suspense>` around the layout's check, would turn the gate's redirect into a client-side meta-tag redirect inside a stream (`01-app/03-api-reference/04-functions/redirect.md`), so the layouts stay as ADR-0018 made them.
- Bad, because each app card's Dify icon costs one `/api/client/dify/[appId]/site` request from the browser (`components/apps/app-icon.tsx`); storing the icon on the app row at create or sync time is a recorded follow-up.
- Bad, because `/user-management` and `/init` repeat two short queries from `app/api/users/route.ts` (GET) and `app/api/init/status/route.ts` in `lib/data/users.ts` until the backend rework folds them together.
- Bad, because `router.refresh()` shows the old list for a moment after a write.
- Neutral, because the chat keeps its client-side loading (the exception above).

## Implementation Plan

- **Affected paths**: `app/page.tsx`, `app/(user)/apps/{page,loading,error}.tsx`, `app/(admin)/{loading,error}.tsx`, `app/(admin)/app-management/page.tsx`, `app/(admin)/user-management/page.tsx`, `app/(auth)/error.tsx`, `app/(auth)/{login,forgot-password,reset-password}/page.tsx`, `app/init/{page,error}.tsx`; `components/apps/`, `components/admin/`, `components/auth/`, `components/shell/{route-error,search-input,auth-card,admin-shell}.tsx`; `lib/data/users.ts`, `lib/search-params.ts`, `lib/match-query.ts`; line-level edits in `lib/api/client.ts` and `lib/api/base-request.ts`.
- **Dependencies**: none (`server-only` is handled by Next itself; the npm package is not installed).
- **Patterns to follow**: a page that needs data before it renders is an async server `page.tsx` that calls `requireSessionUser()`, loads from server code, trims with a pure, unit-tested function and renders one client component under `components/<feature>/`; new server-side reads go to `lib/data/` with `import 'server-only'`; a write ends in `router.refresh()`; feedback through `App.useApp()`; the four practical rules above.
- **Patterns to avoid**: `useEffect`/`useRequest` fetching of first-paint data in a page; passing database rows or `requestConfig` to a client component unchanged; `'use server'` modules for reads; printing a route's message; static `message`/`Modal` calls; a parent-level `Form.useForm()` for a form inside a `destroyOnHidden` overlay.
- **Configuration**: none (no route segment config added; the routes were already request-time).

### Confirmation

- [x] Unit tests per page (`__tests__/{apps,app-management,user-management,login,forgot-password,reset-password,init,root}-page.test.ts`): each data page checks the session before it reads, hands the client component the trimmed props, and the redirecting pages redirect where the spec says.
- [x] `e2e/ssr-first-paint.spec.ts`: the raw HTML of `/apps`, `/app-management` and `/user-management` carries the rows and no API key, in all three Playwright projects (full run 2026-10-06, sub-project 3 Task 11).
- [x] Grep gate: no `useRequest` or `fetch(` in any `app/**/page.tsx`.
- [ ] Production build: the curl checks in `CLAUDE.md` ("Docker stack") hold on the rebuilt image, plus `/` and `/init` signed out redirecting to `/login`.

## Pros and Cons of the Options

### Rebuild the client pages as they are

- Good, because it is the smallest change and keeps the old data flow.
- Bad, because the first paint stays a skeleton followed by a second round trip, the admin list keeps sending API keys unless a new endpoint is written, and `/init`, `/forgot-password` and `/` keep swapping content after hydration.

### Server pages on every route in scope

- Good, because the first HTML carries the data, the session is checked where data is read, and the props are trimmed on the server.
- Bad, because of the layout limit and the duplicated queries listed above.

### Hybrid: server-load `/apps` only

- Good, because the most visited page gets a server-rendered first paint with less work.
- Bad, because two data patterns would live side by side, and the admin list's API-key leak and the auth pages' swaps would remain.

## More Information

Sources: Next 16.3.4 bundled docs (`node_modules/next/dist/docs/01-app/`): `01-getting-started/05-server-and-client-components.md` (serialisable props), `02-guides/authentication.md` ("Layouts and auth checks"), `02-guides/data-security.md` (data transfer objects, `server-only`, `'use server'` exports are endpoints), `03-api-reference/03-file-conventions/{loading,error,layout,page}.md`, `03-api-reference/04-functions/{use-router,redirect}.md`, `03-api-reference/01-directives/use-server.md`. React (react.dev): two-pass rendering for content that differs between server and client (`hydrateRoot`, "Handling different client and server content"), "Resetting state with a key", `useEffect` "Fetching data with Effects" (the `ignore` flag), React 19 release notes ("Compatibility with third-party scripts and extensions": unexpected tags in `<body>` are skipped while hydrating, which `e2e/theme-aliases.spec.ts` relies on for its body-level probe). antd 6.6.5 (`@ant-design/cli` `doc Form`: `form` "automatically created when not provided", `clearOnDestroy`; Form.Item `extra` versus `help`; Button `href`), and the installed sources cited in the Consequences.

Reference projects (owner rule of 2026-10-06, [ADR-0002](0002-use-documented-library-approaches-only.md) note; survey in `.superpowers/sdd/2026-10-06-admin-apps-auth-on-antd/reference-projects.md`). No single project matches all four patterns, and refine's example is Next 14 + antd 5, so these support the decision beside the docs; the documented library behaviour wins where they differ.

- Server page, trimmed props, one client component, refresh after a write. vercel/platforms (`app/admin/page.tsx`, `app/admin/dashboard.tsx`, `app/actions.ts`): an async server page loads the tenants and renders one `'use client'` dashboard with a plain shape; writes are Server Actions ending in `revalidatePath('/admin')`. Agrees on the split and the plain props; differs on the refresh (ours: existing endpoints plus `router.refresh()`). refine `examples/with-nextjs-next-auth` (`src/app/blog-posts/layout.tsx`, `page.tsx`): the session check sits in a server layout (as ADR-0018), but the pages are client components that load with `useTable`; differs on the first paint. ant-design-pro (`src/pages/table-list/index.tsx`) is client-only (umi, not Next); its "mutate, then reload the list" shape matches ours.
- Drawer and modal form state. refine `useDrawerForm` (`packages/antd/src/hooks/form/useDrawerForm/useDrawerForm.ts`) owns one parent-level antd form and calls `resetFields()` on show and close; differs from our form owned inside a `destroyOnHidden` Drawer. ant-design-pro `CreateForm.tsx` / `UpdateForm.tsx` keep the form inside the overlay with `destroyOnHidden` and per-opening `initialValues`; agrees. antd's own form-in-modal demo puts the `<Form>` inside the Modal through `modalRender` with `destroyOnHidden` and a submit-typed OK button; agrees.
- Stale answers in list views. refine and ant-design-pro leave it to a query library (React Query, ProTable's `request`), which keys requests by the query and drops superseded results; ours is the dependency-free equivalent React documents (one effect keyed on the query, `ignore` cleanup). vercel/platforms has no client-fetched list.
- Dates in server-rendered client components. refine's `DateField` formats in the browser because its pages are client components; vercel/platforms formats `new Date(createdAt).toLocaleDateString()` during render with no guard, the shape that can mismatch between server and browser time zones. Ours formats after hydration, as Next's `01-app/02-guides/preventing-flash-before-hydration.md` describes.

Source URLs: https://github.com/vercel/platforms/blob/main/app/admin/page.tsx, https://github.com/vercel/platforms/blob/main/app/admin/dashboard.tsx, https://github.com/vercel/platforms/blob/main/app/actions.ts, https://github.com/refinedev/refine/tree/main/examples/with-nextjs-next-auth, https://github.com/refinedev/refine/blob/main/packages/antd/src/hooks/form/useDrawerForm/useDrawerForm.ts, https://github.com/refinedev/refine/blob/main/examples/form-antd-use-drawer-form/src/pages/posts/list.tsx, https://github.com/refinedev/refine/blob/main/packages/antd/src/components/fields/date/index.tsx, https://github.com/ant-design/ant-design-pro/blob/master/src/pages/table-list/index.tsx (and its `components/CreateForm.tsx`, `components/UpdateForm.tsx`).

Related: spec `docs/superpowers/specs/2026-10-06-admin-apps-auth-on-antd-design.md` (§3, §11, §12), plan `docs/superpowers/plans/2026-10-06-admin-apps-auth-on-antd.md`, charter `docs/superpowers/specs/2026-10-04-frontend-overhaul-charter.md` §4.1, [ADR-0006](0006-require-login-everywhere-and-use-the-email-as-dify-end-user-id.md), [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md), [ADR-0018](0018-gate-route-groups-on-the-server.md).
