# Backend rework — charter

Date: 2026-10-07 · Status: draft for the owner's review · Scope: the whole backend of the `fork/overhaul` line (ADR-0019), plus the frontend edges that its contracts touch · Supersedes the brief `2026-10-05-backend-rework-brief.md` (input only; its incremental, upstream-shaped patch list is not what is built)

## 1. Goal

Rebuild the backend of this line so that it is compliant with the Dify Service API as the owner's Dify 1.17.1 serves it, with Next.js 16 (Route Handlers, Server Actions, `proxy.ts`, the bundled docs), next-auth v4 and Drizzle on MySQL, and with the fork's own rules (ADR-0002: documented approaches only, verified against current docs and well-known reference projects). Nothing of the inherited backend is kept only because upstream had it: files and folders are reshaped as the docs and reference projects recommend, ADR-0009 is superseded for this line, and upstream becomes a cherry-pick source only (ADR-0019).

The result: one Route Handler per Dify operation forwarding exactly what the API defines, typed request and response contracts shared with the frontend, Dify's error bodies passed through unchanged, the end-user id set server-side from the session (ADR-0006), a server-only Data Access Layer with Server Actions for the app's own data, a typed session with a minimal role, and every recorded follow-up of the old backend implemented or deliberately deferred with a reason.

## 2. Decisions already taken (do not re-open)

Taken in the brainstorm of 2026-10-07; the alternatives and reasons are in the ADRs §6 names.

| Topic | Decision |
| --- | --- |
| Slicing | A charter (this document, the spec for B1 and B2) plus sub-projects, each with its own plan and PR to `fork/overhaul`: **B1** the Dify layer, **B2** accounts and admin, **B3** groups, per-app access and LDAP, then frontend phase 2 (§5). |
| Dify layer | One Route Handler per Dify operation under `app/api/dify/[appId]/<Dify path>/route.ts`, Dify's own paths and verbs, calling a fork-owned typed server client (`lib/dify/`). Rejected: a catch-all handler with an allowlist table; Server Actions for Dify mutations; the official `dify-client` 3.1.0 package (untyped `JsonObject` answers, no human-input form, events or logs). |
| App data | A `server-only` Data Access Layer (DAL) with thin Server Actions for writes and `useActionState` forms; the user, first-run and password Route Handlers are deleted. Rejected: keeping those handlers beside the actions (the mix Next's Data Security guide advises against); Route Handlers everywhere. |
| Roadmap placement | B2 adds a minimal `role` (`admin`, `user`) and the account-menu password change. B3 adds groups, per-app access and the LDAP provider, in that order, because an LDAP login creates accounts on first sign-in and needs a role to assign. |
| Database | MySQL through Drizzle stays (ADR-0004). Migrations through `drizzle-kit generate` and `migrate` only (AGENTS.md: never `push`). |
| Auth library | next-auth v4 stays. The session is typed through module augmentation; the revocation rule of ADR-0018 (`sessionVersion` mismatch leaves `user.id` out) is unchanged. Session renewal stays as ADR-0018 documents it (no `refetchInterval`). |
| Validation | `zod` v4 is the one new dependency (its first use gets the ADR). |
| Identity | The Dify `user` is the signed-in email, set on the server (ADR-0006). Tracing fields (`X-Trace-Id`, `trace_session_id`) are not forwarded; the email already attributes conversations. |
| Error contract | Dify's `{ code, message, status }` envelope and HTTP status reach the browser verbatim; the app's own refusals use the same envelope. The `{ code, data }` wrapper of the old proxy disappears. |
| Process | Brainstorm → spec → plan → subagent-driven execution with a review per task → whole-branch review on the most capable model → Docker gate → owner's browser check → PR. Commits and pushes only on the owner's word; no handoff document unless asked. |

## 3. Sources

- Next.js 16.3 bundled docs (`node_modules/next/dist/docs/01-app/`): `02-guides/backend-for-frontend.md` (Route Handlers as the public API layer, "Proxying to a backend", Server Actions are for mutations and are dispatched sequentially, "use a Route Handler for non-mutation requests", fetch data in Server Components from the source rather than through Route Handlers), `02-guides/data-security.md` (one data-fetching approach, the Data Access Layer with `verifySession`, DTOs, actions verify the caller themselves, thin actions delegating to a `server-only` DAL), `02-guides/authentication.md` (two-tier checks: session then role; optimistic checks in the proxy, secure checks in the DAL; Server Actions and Route Handlers each verify), `02-guides/server-actions.md` (single-response model, `refresh`/`revalidatePath`, security), `02-guides/forms.md` (`useActionState`), `03-api-reference/03-file-conventions/route.md` (`RouteContext`, dynamic segments, streaming, segment config), `03-api-reference/03-file-conventions/proxy.md` (Node.js runtime, "last resort", Server Functions are POSTs to the page route), `02-guides/upgrading/version-15.md` (`GET` handlers are not cached by default), `02-guides/caching-without-cache-components.md`.
- Dify Service API: `docs/dify-service-api-1.17.1.md` (this rework's committed endpoint map, built from the dify-docs OpenAPI at `7801fc28` and the 1.17.1 controllers at `8387590a`; 36 app-token operations on 32 paths; the docs and the source agree on the path set and nothing documented is newer than 1.17.1).
- next-auth v4 docs (Context7 `/websites/next-auth_js`): TypeScript module augmentation (`declare module 'next-auth'` in a module file, `& DefaultSession['user']`), `getServerSession(authOptions)` in the App Router, custom claims through the `jwt` and `session` callbacks, the LDAP page (Credentials provider with `ldapjs`, for B3).
- Drizzle ORM 1.0.0-rc.3 (installed) and its docs (Context7 `/drizzle-team/drizzle-orm-docs`): `mysqlEnum`, `mediumblob`, `$onUpdate`, `$inferSelect`; the mysql2 driver config takes no `schema` option and the relational API is typed over `defineRelations`, so the DAL uses the query builder with explicit columns.
- zod 4 docs: `import * as z from 'zod'`, `z.object`/`z.strictObject`, `safeParse`, `z.flattenError`, `{ error }` messages (Next's guide snippets still show zod 3 syntax).
- Reference projects (owner rule of 2026-10-06, ADR-0002 note; survey in `.superpowers/sdd/2026-10-07-backend-rework/reference-projects.md`): `nextjs/saas-starter` (`lib/db/` queries, `lib/auth/` session helpers, `validatedAction` wrappers with zod and `useActionState`; its `/api/user` route returning the full row with the password hash is the mistake the DTO rule prevents), `create-t3-app` (`server/{auth,db}`, the next-auth augmentation beside the auth config, a cached session reader), `vercel/platforms` (thin `app/actions.ts`), `langgenius/webapp-conversation` (Dify's own Next.js template: one Route Handler per Dify endpoint), documenso (`server-only/<domain>/` one function per concern, narrow selects). Documented library behaviour outranks a reference project's choice.
- This repository's maps (research, local): `.superpowers/sdd/2026-10-07-backend-rework/frontend-consumer-map.md` (every frontend call into the backend, the shape each caller expects, the e2e specs per route) and `design-notes.md` (the approved brainstorm record).

## 4. Architecture

### 4.1 The Dify layer (B1)

**Routes.** `app/api/dify/[appId]/<Dify path>/route.ts`, one file per Dify path with Dify's verbs, no segment config (`GET` handlers are uncached since Next 15 and every handler reads the session cookie). Each handler, in this order: verify the session (401 before anything else, so a revoked token learns nothing about apps); load the app by id through the DAL (404 `app_not_found`; 403 `app_disabled`); validate params, query, body or form parts against the operation's schema (400 `invalid_param`); call one method of the server client; return its answer. Params are typed with `RouteContext<'/api/dify/[appId]/…'>`.

**Coverage in B1**: every operation a screen uses today or a recorded follow-up needs, 27 operations in 24 files.

| Dify path | Methods | Consumer |
| --- | --- | --- |
| `info`, `parameters`, `site`, `meta` | GET | chat workspace, app icon sync, admin create and sync (`meta` has no consumer yet; kept on the owner's list) |
| `chat-messages`, `chat-messages/[taskId]/stop` | POST | chat |
| `messages`, `messages/[messageId]/suggested`, `messages/[messageId]/feedbacks` | GET, GET, POST | history, suggestions, rating |
| `conversations`, `conversations/[conversationId]`, `conversations/[conversationId]/name` | GET, DELETE, POST | sider (list, delete, rename, Dify-generated name) |
| `completion-messages`, `completion-messages/[taskId]/stop` | POST | completion runner (stop is new) |
| `workflows/run`, `workflows/tasks/[taskId]/stop` | POST | workflow runner (stop is new) |
| `workflow/[workflowRunId]/events` | GET | human-input resume (note Dify's singular `workflow`) |
| `form/human_input/[formToken]` | GET, POST | human-input form definition (new) and submission |
| `files/upload`, `files/[fileId]/preview` | POST, GET | attachments, file links |
| `audio-to-text`, `text-to-audio` | POST | speech to text, TTS |
| `apps/annotations`, `apps/annotations/[annotationId]` | GET, POST; PUT, DELETE | admin annotations drawer, chat "annotate" |

Deferred, with the endpoint map as the reference and no route until a consumer exists: run by version id (`workflows/{workflow_id}/run`), run detail (`workflows/run/{id}`), `workflows/logs`, conversation variables, `app/feedbacks`, `end-users/{id}`, annotation-reply settings, the unauthenticated version root (`GET /`). The `agent` mode value (Dify's sixth app mode, SSE-only) is accepted by the backend wherever a mode is validated; the chat's handling of its closing `message` event is frontend phase 2.

**Server client** (`lib/dify/client.ts`, `server-only`). One typed function per operation, input and output types written from the endpoint map in `lib/dify/types/` (the nine `user_input_form` control types, the real `file_upload` shape, `extra_contents`, the paused shapes, the 29 stream event names). It places `user` where Dify reads it for that operation (JSON body, query string, or multipart field), sets the bearer header from the app row, and never reads a client-supplied `user`. A non-OK answer becomes `DifyError { status, code, message }` parsed from Dify's envelope, or `upstream_error` with Dify's status when the body is not JSON; a network failure becomes `upstream_unreachable` (502). JSON operations return typed data. Streams (`text/event-stream`) and binaries (file preview, audio) return the upstream `Response` body with its status and the headers that carry meaning (`Content-Type`, `Content-Disposition`, `Content-Length`, `Accept-Ranges`), as the Backend for Frontend guide's proxy example does; nothing re-pumps a stream through a hand-written `ReadableStream`.

**Contract to the browser.** Dify's status and body verbatim: 201 for an upload, 204 for a conversation delete, `{"result":"success"}` for the three stops and for feedback, `{}` for a form submission, 412 for a submitted or expired form, SSE and audio as they come. The app's own refusals use the same `{ code, message, status }` envelope with the app's codes: `unauthorized`, `app_not_found`, `app_disabled`, `invalid_param`, `upstream_unreachable`. The frontend therefore keeps one parser (`DifyRequestError` in the chat provider) and the thirteen shape-specific checks in `components/chat/hooks/dify-errors.ts` and the apps code go.

**App data for the browser.** `app/(user)/chat/[appId]/page.tsx` loads its app on the server (ADR-0020's pattern, closing its stated exception) and passes a DTO without `apiBase` or `apiKey`: `id`, `name`, `mode`, `description`, `icon` (`{ kind: 'emoji', emoji, background }`, `{ kind: 'image' }` for which the client requests `/api/apps/[appId]/icon`, or `null` for the mode icon), and the four settings the chat reads (`answerForm`, `enableUpdateAfterConversationStarts`, `openingStatementDisplayMode`, `annotationEnabled`). The same `icon` shape serves the app gallery and the admin table. A disabled app's chat page renders the `app_disabled` state (an antd `Result` with a link back to `/apps`) instead of the workspace, and its routes answer 403. File links go through the preview route, so the Dify host never reaches the browser. The admin's browser-side calls to Dify (`/info` on create and sync, the annotations panel) move behind the DAL (sync) and the annotation routes.

**Audio.** The browser records what `MediaRecorder` offers; the route forwards the part under its real MIME type and file name. Dify 1.17.1 lists mp3, mpga, m4a, x-m4a, wav and amr for `/audio-to-text`; whether the owner's server accepts WebM is verified against it during B1, and that result decides between keeping WebM and recording a listed format. No silent relabelling of the part.

**Annotations and roles.** Creating an annotation from the chat is allowed for any signed-in user when the app enables it (the existing feature). List, update and delete require a signed-in user in B1 and the `admin` role from B2 on (a one-line change the B2 plan carries).

### 4.2 The app's own data, sessions and roles (B1 foundation, B2 completion)

**Data Access Layer.** `server-only` modules under `lib/data/`, one per aggregate: `apps.ts`, `users.ts`, `setup.ts` (first run), `password-reset.ts`. Every function takes the verified caller (`actor: SessionUser`) as its first parameter, so nothing in the DAL can be called without a session the entry point verified through `verifySession()` (React `cache` dedupes that lookup within a render pass but not inside Route Handlers, where a second in-DAL verification would double the JWT decode and the `sessionVersion` query per chat request; B1 plan header, deviation 1), and returns a DTO: never the password hash, never the API key except to the Dify server client. The apps module calls the Dify client for create and sync (`/info` and `/site`), storing name, mode, description, tags and the icon (§4.4). Pages read the DAL directly; Server Actions are thin wrappers around it. The DAL uses Drizzle's query builder with explicit column lists, not the relational API.

**Session.** next-auth v4. `types/next-auth.d.ts` becomes a module augmentation (an import at the top makes it a module; `Session.user` is `{ id, email, name, role } & DefaultSession['user']`; `JWT` carries `id`, `role`, `sessionVersion`); `lib/auth/options.ts` exports `authOptions: NextAuthOptions` with typed callbacks (`jwt` copies `id`, `role`, `sessionVersion` from the user on sign-in and re-checks `sessionVersion` on every call as today; `session` copies `id` and `role`). `lib/auth/session.ts`: `verifySession()` returns `{ id, email }` or null in B1 and gains `role` in B2; `requireUser()` redirects to `/login` when there is no live session (pages and layouts; the `(admin)` layout additionally redirects a non-admin to `/apps` from B2 on); `requireAdmin()` throws a typed `AuthError` with `unauthorized` or `forbidden` (the DAL and the actions, which map it to their result code); the Dify handlers answer the 401 envelope themselves. The `@ts-expect-error` on `next-auth/jwt` in `proxy.ts` is re-checked once the augmentation is a module and kept only with its reason on the line.

**Roles (B2).** `users.role`: `admin` or `user`, default `user`. `/init` creates the first admin. Admin-only: the `(admin)` layout and pages, every admin action, annotation list, update and delete. The users drawer gets a role field; the last admin cannot be demoted or deleted; nobody deletes themselves.

**Actions (B2; the apps actions are reshaped in B1).** `'use server'` files colocated with their route segment (`app/(admin)/app-management/actions.ts`, `app/(admin)/user-management/actions.ts`, `app/(auth)/<page>/actions.ts` where a form posts, `app/init/actions.ts`, `app/actions.ts` for the account menu). Each validates its input with a schema, calls the DAL, and returns a plain result for `useActionState` (§4.5). Expected failures never throw. Writes end in `refresh()` (the documented fit for a page that reads the database without `fetch` caching; `revalidatePath` where a different route must update). In scope: apps (create, update, delete, sync), users (create, update, delete), `createFirstAdmin`, `requestPasswordReset` and `resetPassword` (the same token hashing, one-minute rate limit and transaction as today; nodemailer unchanged), and `changePassword` (current password checked with bcrypt, the new one hashed, `sessionVersion` bumped). A password change revokes every session including the current one, as a reset does; on the action's success the client calls next-auth's `signOut` with `/login?notice=password-changed` as the callback, and the login page shows the notice from that query flag. next-auth's session `update()` is not used to re-validate a token, because a revoked token could call it too. The Route Handlers these replace (`/api/users/*`, `/api/init`, `/api/init/status`, `/api/auth/forgot-password`, `/api/auth/reset-password`) are deleted, which closes the `/api/users/*` revoked-session gap of ADR-0006 by removal.

**First run and the proxy.** `proxy.ts` keeps only the optimistic check the authentication guide assigns to it: a token present lets the request through, otherwise `/api/*` gets the 401 envelope and a page gets `/login?callbackUrl=…` (the only place that sees the full URL, ADR-0018). The HTTP self-fetch of `/api/init/status` goes. The login page's server layout asks the DAL whether an admin exists and redirects to `/init` when none does; `/init` redirects to `/login` once one exists. `/api/health` stays for Docker and the e2e harness.

### 4.3 Structure

Next's project-structure guidance stops at "`app/` is routing; colocate `actions.ts` with its segment"; the rest follows the surveyed projects (§3).

```
app/
  api/auth/[...nextauth]/route.ts   next-auth (unchanged)
  api/health/route.ts               Docker and e2e probe (unchanged)
  api/dify/[appId]/…/route.ts       the 24 Dify routes (§4.1)
  api/apps/[appId]/icon/route.ts    the stored app icon (§4.4)
  actions.ts                        account actions (change password), used by the shell
  (admin)/app-management/{page.tsx,actions.ts}
  (admin)/user-management/{page.tsx,actions.ts}
  (auth)/{login,forgot-password,reset-password}/…, actions.ts where a form posts
  (user)/chat/[appId]/page.tsx      loads the app DTO on the server
  init/{page.tsx,actions.ts}
db/   schema/, migrations/, index.ts, migrate.ts   (layout unchanged; seed.ts removed)
lib/
  auth/      options.ts (typed NextAuthOptions), session.ts, password.ts (bcrypt and reset-token helpers)
  data/      apps.ts, users.ts, setup.ts, password-reset.ts   server-only DAL; DTO types exported beside them
  dify/      client.ts (server-only), errors.ts, schemas.ts, route.ts, remote-file.ts, browser.ts, types/ (contracts per area)
  env.ts     the server environment parsed once, lazily, with a schema
  access.ts, mail.ts, i18n/, theme/, match-query.ts, search-params.ts   (kept)
types/next-auth.d.ts   module augmentation; types/i18next.d.ts kept
lib/dify/browser.ts                    the browser client (the chat and the admin annotations panel), typed from lib/dify/types; no server-only import
components/chat/provider/dify-fetch.ts x-sdk's fetch option on top of it
```

**Deleted** (each after a grep shows no importer): `lib/dify-client.ts`, `lib/api/` (the browser client that called Dify directly, its request helper and types), `lib/api-utils.ts`, `lib/core/`, `lib/db/types.ts`, `lib/session-user.ts` (folded into `lib/auth/session.ts`), `lib/is-next-build.ts`, `lib/password-reset.ts` (moves under `lib/auth/`), `lib/helpers/` except the uuid helper the schema uses, `repository/`, `services/`, `types/index.ts`, `app/api/apps.ts` (never routed), `app/api/client/**`, `app/api/users/**`, `app/api/init/**`, `app/api/auth/{forgot-password,reset-password}/`, `app/(admin)/app-management/utils.ts`, `instrumentation.ts`, `db/seed.ts`.

**Config cleanup.** `db/index.ts` drops the build-time throwing proxy and the `as any` cast (the rc.3 mysql2 driver takes no `schema` option) and logs queries only in development. `next.config.ts` drops the wildcard CORS headers set on every path (invalid beside `Allow-Credentials`; a same-origin app needs none; a route that ever needs CORS sets it itself per the Route Handler reference). The Docker image build already runs `next build` without `DATABASE_URL`; a route the build still tries to prerender gets the documented `dynamic = 'force-dynamic'`, as `/init` has today.

**Rules.** Browser-facing types come only from `lib/dify/types` and the DAL's DTO types. Server-only modules import `server-only` (built into Next, no package). `process.env` is read only in `lib/env.ts`. `app/` keeps routing files and colocated `actions.ts`; everything else lives under `lib/` or `components/`.

### 4.4 Schema and migrations

Migrations are generated with `pnpm db:generate`, hand-edited only for the data backfills below, reviewed in the PR, applied by the container entrypoint (`db/migrate.ts`) and by hand in the dev loop; one migration per sub-project.

**`users` (B2).** `role mysqlEnum('admin', 'user')`, not null, default `user`. Backfill: every existing account becomes `admin`, because every account can run the admin pages today and an upgrade must not lock anyone out; the owner demotes from the users table afterwards. `updated_at` gets Drizzle's `$onUpdate`.

**`dify_apps` (B1).**
- `is_enabled` becomes a boolean, not null, default true; the migration maps upstream's integers (`1` enabled, `2` disabled) before the column type changes. The DTO exposes `enabled: boolean`.
- Icon columns filled at create and sync by the DAL from `/site`: `icon_type` (`emoji` or `image`, nullable), `icon` (the emoji, or Dify's file id for an image), `icon_background` (hex), and for images `icon_image` (`mediumblob`) with `icon_mime`. Dify's `icon_url` for an image is a signed link that expires (`FILES_ACCESS_TIMEOUT`, default 300 s; `controllers/common/fields.py` `Site.icon_url` → `graphon.file.helpers.get_signed_file_url`), so the DAL fetches the bytes once through it, on the server, capped at 1 MB; a failed fetch keeps the previous icon and reports the sync as partial. `GET /api/apps/[appId]/icon` serves the bytes with the stored type, an `ETag` from a hash of the bytes and `Cache-Control: private, max-age=86400`, to signed-in callers only (an `<img>` on a gated page sends the cookie). No per-card `/site` request and no Dify host in the browser.
- `mode` stays a `varchar` so a future mode value does not break the row; the DAL validates writes against the six known modes and the DTO types it. `tags` stays JSON in a text column. `api_base` and `api_key` stay as they are (plain text at rest, as upstream and Dify store them; encryption at rest is a candidate for a later note, not this rework). The five settings columns stay because the chat reads all of them. `updated_at` gets `$onUpdate`.

**`password_reset_tokens`.** Unchanged.

**Verification.** Each migration runs on the e2e MySQL from empty and on a copy of the local Docker volume with existing rows (the integer-to-boolean mapping and the role backfill need real data) before the Docker gate.

### 4.5 Validation, contracts and dependencies

**zod v4** is the one new dependency: route schemas in `lib/dify/schemas.ts`, action input schemas beside each `actions.ts`, and `lib/env.ts`. `bcryptjs`, `nodemailer` and `mysql2` stay; B3 brings `ldapjs` with its own ADR.

**Dify route input.** Each operation has a schema listing exactly the fields the endpoint map lets the browser send (for `chat-messages`: `query`, `inputs`, `files`, `response_mode`, `conversation_id`, `auto_generate_name`); unknown keys are stripped, so a client cannot smuggle `user` or the tracing fields, and `user` is set from the session after parsing. A failed parse answers Dify's own `400 invalid_param` envelope. Query parameters and form parts get the same treatment (`limit` 1 to 100, `sort_by` from the four documented values, exactly one `file` part).

**Action results.** `{ ok: true, data }` or `{ ok: false, code, fieldErrors? }` with codes `unauthorized`, `forbidden`, `invalid_input`, `email_in_use`, `last_admin`, `cannot_delete_self`, `not_found`, `dify_unreachable`, `operation_failed`; the client maps a code to a translation key (both locales), as the users drawer maps statuses today but without HTTP in between. Two vocabularies on purpose: the Dify routes speak Dify's codes in Dify's envelope (§4.1), the actions speak the app's own result codes; a `DifyError` inside an action becomes `dify_unreachable` or `operation_failed`, never a raw envelope. An unexpected throw reaches the form as `operation_failed`; `unauthorized` sends the client to `/login`.

**DTOs.** Exported from the DAL module that produces them; dates as ISO strings; only what the screen uses (ADR-0020's serialisable-props rule).

**Environment.** `lib/env.ts` parses the server environment once, lazily, on first use: `DATABASE_URL`, `NEXTAUTH_SECRET`, `APP_URL`, and the SMTP group as an all-or-nothing optional block (today's `isMailConfigured()` becomes "the SMTP block parsed"). A missing value fails at the first request with the variable's name, never during `next build`.

**Language and types.** No Chinese strings remain in the backend: logs are English, and nothing user-facing is a message, only a code the frontend translates. `tsc` runs clean with no `@ts-nocheck`; a `@ts-expect-error` survives only with its reason on the line.

### 4.6 Testing

**Vitest (node, no DOM), test-first per task.**
- The server client: `fetch` stubbed with `vi.stubGlobal`; one case per operation checks the URL, verb, bearer header and where `user` lands, plus the error mapping and that a stream or binary answer is handed back untouched.
- The routes: table-driven suites per area (`__tests__/dify/*.test.ts`) importing each `route.ts` and calling its handler with a `Request` and a `params` promise, with `lib/auth/session` and `lib/data/apps` mocked (the existing `vi.mock` pattern): no session 401, unknown app 404, disabled app 403, invalid body 400, success passthrough with Dify's status.
- The DAL: its decision rules are pure functions with their own tests (last admin, self-delete, role checks, DTO mappings, the icon size cap); the SQL is exercised by the e2e suite. Actions are tested with the DAL mocked: result shapes for unauthorized, forbidden and invalid input.
- Schemas, `lib/env.ts`, the session helpers, `lib/access.ts` and `proxy.ts` keep or gain focused tests.

**Playwright (ADR-0010), the stub brought to the endpoint map.** `DELETE /conversations/{id}` answers 204, the stops and feedback `{"result":"success"}`, the form submit `{}`, uploads 201, `ping` as a bare `event: ping` frame, the image `/site` variant pointing at the stub's own asset so the icon sync has bytes to download. Setup creates the admin through the `/init` form in the browser when the database has none (the reused-server case is the redirect to `/login`), seeds apps through the database fixture with the new columns, and seeds extra users through that fixture with a bcrypt hash. Specs that assert on old shapes change with their route: upload `.data.id` becomes `.id`, the mocked human-input 412 and upload 415 become Dify's envelope, the reset-token reuse asserts the UI, the app icon is read from the icon route or the DTO.

**New e2e cases.** The workflow and completion stop POSTs; the human-input form fetched by GET when `human_input_required` arrives and when a pending form is reopened; the icon route; a `user`-role account turned away from `/app-management` and from every admin action; the account-menu password change ending in sign-out and a login with the new password; first run through the form; a disabled app's chat page. Each plan names, per task, the specs from the consumer map that must stay green.

**Gates.** Per commit: `pnpm exec tsc --noEmit`, `oxlint`, `oxfmt --check`, `pnpm test`. Per route-touching task: the specs the consumer map names for that route plus the task's new cases, on the three Playwright projects. At the end of each sub-project, before the whole-branch review: the full suite. Before merging: the Docker rebuild from the branch with the curl checks updated for the new paths (`/api/health` 200; `/apps` signed out 307 to `/login?callbackUrl=%2Fapps`; `/api/dify/<id>/parameters` signed out 401 envelope; a deleted path such as `/api/client/apps` 404; one `antd-cssinjs` style tag), the migrations applied to the existing local volume with a query confirming the mapped rows, and `next build` without `DATABASE_URL` succeeding inside the image build. The owner verifies in the browser against Dify 1.17.1, including the audio format check of §4.1.

## 5. Delivery plan

| # | Sub-project | Branch | Delivers | Done when |
| --- | --- | --- | --- | --- |
| B1 | Dify layer | `feat/backend-b1-dify-layer` | The structure move and deletions (§4.3), `lib/env.ts`, `lib/auth/session.ts` without roles, `lib/dify/*`, the 24 routes, the `dify_apps` migration, the icon route and sync through the DAL, the chat page's server app lookup and DTO, the chat's browser client and hooks on the new contract, the apps actions reshaped on the DAL, the admin create, sync and annotations through the DAL and routes, the stub and specs of §4.6, ADR-0022/0023/0025, `CLAUDE.md` | Every route in §4.1 forwards per the endpoint map with its vitest suite; the full e2e suite is green with the new cases; the Docker gate passes; the owner's browser check against Dify 1.17.1 passes, audio decided |
| B2 | Accounts and admin | `feat/backend-b2-accounts` (from `fork/overhaul` after B1 merges) | The `users` migration and roles, the typed session, the users, setup and password-reset DAL modules, the actions and the four forms on `useActionState`, the account-menu password change, the proxy without the init fetch, the deleted handlers, the role gates and their e2e cases, ADR-0024, `docs/auth-gate.md` rewritten | No Route Handler remains under `app/api` except `auth`, `health`, `dify`, `apps/[appId]/icon`; a `user` account is turned away from every admin surface; the Docker gate passes |
| B3 | Groups, per-app access, LDAP | its own brainstorm after B2 | Groups, which apps a user or group may see (the `/apps` list and the chat lookup filter by it), the LDAP provider with a role and group mapping | Specified then |
| F2 | Frontend phase 2 | after B2 | What the brief's table and `CLAUDE.md`'s follow-ups still hold: the `agent` mode in the chat, a paused workflow run showing its form, tool icons from `meta` if wanted, the chat's Flex-spacing audit, the Mermaid Strict Mode retest at the next X release, RTL and the Arabic review, the first-paint language, the two `@ant-design/icons` majors | Specified then |

The app works after every sub-project; nothing merges half-migrated.

## 6. Records and documentation

- ADRs, proposed in their PRs for the owner to accept: **0022** supersedes ADR-0009 for this line (the whole line is fork-owned; upstream is a cherry-pick source); **0023** the Dify layer (one route per operation, the typed server client, the pass-through contract, the stored icon); **0024** the Data Access Layer with Server Actions and roles (B2); **0025** zod as the validation library. Dated notes on ADR-0006 (the `/api/users/*` gap closed by removal; roles), ADR-0017 (the contract change, the stop routes, the human-input GET), ADR-0018 (actions verify the session themselves; the proxy no longer fetches the init status) and ADR-0020 (the chat's server lookup and the stored icon, both done).
- Documents: this charter is the spec for B1 and B2; each of them gets a plan under `docs/superpowers/plans/` written from §4 and §5 (a separate spec only where this charter leaves a design open: B3 and F2); `docs/dify-service-api-1.17.1.md` (the endpoint map, committed because the routes implement it); the consumer map, the reference survey and the design notes stay local research under `.superpowers/sdd/2026-10-07-backend-rework/`, cited by path as ADR-0020 did.
- `CLAUDE.md` with B1: the backend rule in "How to work here" (the upstream-shaped rule goes), the backend entries in "Where things are", the Docker curl checks, the open follow-ups. `AGENTS.md` stays byte-identical; `CLAUDE.md` notes that its project-structure section describes upstream's tree, as it already does for the Tailwind paragraph. `.cii-assessment.md` is re-checked before each PR's commits, in its own commit, as AGENTS.md requires.

## 7. Risks and how they are handled

- **Contract changes break the chat.** Every route change lands with its consumer in the same task and the consumer map names the e2e specs that pin it; the full suite runs per route-touching task.
- **Dify behaviour differs from the map.** The map records the docs and the 1.17.1 source separately where they differ (§6 of the map); the owner's browser check against the real server is part of B1's done condition, and the audio format is the known unknown.
- **Signed icon URLs.** Handled by storing the bytes at sync time (§4.4); a sync against an unreachable Dify keeps the old icon.
- **Migrations on real data.** The integer-to-boolean mapping and the role backfill are verified on a copy of the local volume before the Docker gate; the migration SQL is reviewed by hand.
- **Lock-out on upgrade.** Existing accounts become admins; the first-run redirect cannot fire on a database that has users.
- **Build without a database.** The Docker build already runs `next build` without `DATABASE_URL`; the throwing proxy's removal is covered by that build, and any route the build still prerenders gets `force-dynamic`.
- **Size.** About 2,300 backend lines plus the chat's data edges. B1 and B2 are separate PRs with their own gates; B1 is the larger one and its plan keeps each task to one route area or one module.

## 8. Definition of done for the programme

Every Dify operation the app uses has one Route Handler that forwards what the endpoint map defines, with a typed server client, Dify's envelope passed through, and the end-user id from the session; the app's own data goes through a `server-only` Data Access Layer and Server Actions with validated input and DTOs; the session is typed and carries a role that gates the admin surface; `app/api` holds only `auth`, `health`, `dify` and the icon route; no `@ts-nocheck`, no Chinese string, no `process.env` outside `lib/env.ts`, no Dify host or key in the browser; vitest covers the client, routes, schemas, DAL rules and actions; the e2e suite covers the new routes, roles and account flows in all three projects; ADR-0022 to 0025 are accepted; `CLAUDE.md`, `docs/auth-gate.md` and the ADR notes describe the result so the next session follows it.
