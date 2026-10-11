# Dify coupling map (fork/overhaul at 477d261d, 2026-10-11)

Where the code assumes Dify, for the provider-hub brainstorm. Classes:

- **A**: a core concept that has to become provider-neutral.
- **B**: code that only Dify needs. It moves into a Dify provider module.
- **C**: only the name needs to change.

Made by a read-only sweep of the tree.

## 1. Database

`dify_apps` (`db/schema/apps.ts:15`, export `difyApps`). The table name and the export name are C.

| Column | Holds | Class |
| --- | --- | --- |
| `id` | the hub's UUID, minted in `createApp` (`lib/data/apps.ts:494`). It is the id in every URL. | A |
| `created_at`, `updated_at` | timestamps | A |
| `name`, `description`, `tags` | filled only from Dify `/info`. The admin form has no fields for them. | A, but their source is Dify |
| `mode` | a Dify app mode (`APP_MODES`) | B as a value. The chat's view switch reads it, so the switch itself is A. |
| `is_enabled`, `access_mode` | hub flags | A |
| `api_base`, `api_key` | Dify Service API credentials, both NOT NULL | B |
| `enable_answer_form`, `answer_form_feedback_text`, `enable_update_input_after_starts`, `opening_statement_display_mode`, `enable_annotation` | Dify features | B |
| `icon_type`, `icon`, `icon_background`, `icon_image`, `icon_mime` | the stored icon, shaped after Dify `/site` (an emoji or an image) | A. The storage is generic; the shape and the source are Dify's. |

What the table does not have:

- No `provider` column.
- No column for Dify's own app id. A Dify app is identified only by `api_base` plus `api_key`.

Foreign keys to the table:

- `app_group_grants.app_id` and `app_user_grants.app_id` (`db/schema/app-grants.ts`), ON DELETE CASCADE.
- Their constraint names contain `dify_apps` (C).
- The grant tables themselves are already neutral (A).

No hub table stores conversations or messages.

## 2. Data access

`lib/data/apps.ts` (567 lines) imports `difyClient`, `DifyCredentials`, `DifyError` and the Dify types.

| Item | Class |
| --- | --- |
| `dtoColumns`, `AppDto`, `ChatAppDto`, `visibleTo`, `listApps`, `listAdminApps`, `getChatApp`, `getAppAccess`, `getAppIcon`, `deleteApp`, `readIconBytes` | A (the DTOs carry `mode`) |
| `AppSettings`, `AppInput` (`apiBase`, `apiKey`, `mode`), `modeOf`, `iconColumnsFrom`, `signedIconUrl`, `fetchDifyProfile` (`/info` + `/site`), `infoColumns`, `settingsColumns`, `syncApp`, `SyncResult.partial` | B |
| `createApp`, `updateApp` | the operations are A, but both call Dify `/info` on every save |

Other files:

- `lib/app-access.ts` and the group grant count in `lib/data/groups.ts` are neutral.
- `lib/data/users.ts` and `lib/data/directory.ts` do not touch apps.

## 3. The Dify layer

**`lib/dify/`**

| File | What it is | Class |
| --- | --- | --- |
| `client.ts` | the Service API calls | B. The `passthrough` and `filePassthrough` helpers are generic. |
| `route.ts`, `resolveDifyRoute` | session → app access → enabled check | A |
| `route.ts`, `DifyRouteContext` | the credentials, `user: actor.id` (line 52), `annotationEnabled` | B |
| `types/*` | the Dify types | B |
| `schemas.ts` | Dify request bodies | B |
| `schemas.ts`, the `parse*` helpers | already used by `app/api/directory/groups` | A |
| `errors.ts`, `response.ts` | the app-wide error envelope and no-store JSON (`difyErrorResponse`, `errorResponseFrom`, `forbiddenResponse`, `difyJson`). Also used by the branding, directory and icon routes, `lib/settings/image-response.ts` and `lib/action-failure.ts`. | C |
| `remote-file.ts` | the Dify file-link guard | B |
| `browser.ts`, `createDifyApi` | the browser client | B |
| `browser.ts`, `DifyRequestError` and `readDifyError` | also used by the groups page | C |

**`app/api/dify/[appId]/**`\*\*

- 25 route files, 28 handlers, all B.
- No route checks the app mode; Dify enforces the mode itself.

**Elsewhere**

- `proxy.ts` and `lib/access.ts` list no Dify paths. `/api/dify/*` falls under the rule "every `/api` path needs a session".
- `__tests__/api-routes.test.ts` pins the route folders.

## 4. Admin

**`app/(admin)/app-management/`**

- `schemas.ts`: `apiBase`, `apiKey`, `mode`, and the four Dify `settings` (B); `enabled` and `access` (A).
- `actions.ts`: the sync action is B. A `DifyError` maps to `dify_unreachable` (C).

**`components/admin/apps/app-settings-fields.tsx`**

The form, section by section. It has no provider choice.

| Section          | Contents                                                    | Class |
| ---------------- | ----------------------------------------------------------- | ----- |
| Read-only header | name, description and tags from Dify                        | A     |
| Request          | API Base and API Secret. The labels are hard-coded English. | B     |
| Basic            | Dify mode select                                            | B     |
| Basic            | Status                                                      | A     |
| Access           |                                                             | A     |
| Conversation     | update inputs, opening display                              | B     |
| More             | annotations, form reply                                     | B     |

**Elsewhere in `components/admin/apps/`**

- `app-management.tsx`: a "type" column with a Dify-mode filter (B).
- `admin-app-row.ts`: `supportsAnnotations(mode)` (B).
- `app-actions.tsx`: "Sync app info" and "Annotations" (B).
- The annotations drawer, panel and modal (B).

**Users page**

The "Dify user ID" column (`components/admin/users/user-management.tsx:150`, `admin_users.dify_user_id`) shows `users.id` (C).

## 5. User side

**Gallery**

- `toAppSummaries` carries `mode`.
- `components/apps/app-card.tsx:37` shows the Dify mode name as the card description.
- `app-icon.tsx` falls back to an icon per Dify mode (`MODE_ICONS`).
- `app-modes.ts` is B.

**Chat entry**

- `app/(user)/chat/[appId]/page.tsx` passes `getChatApp(actor, appId)` to `ChatWorkspace`. The DTO is neutral in shape.
- The seam is `components/chat/chat-workspace.tsx`. It calls `createDifyApi`, loads `/parameters` and `/site` on the client, and builds `AppContextValue {app, parameters, site, difyApi}` (`app-context.tsx:10`).
- It then switches on the mode through `utils-index.ts:43`: `CHAT_MODES` → `ChatView`, `RUN_MODES` → `WorkflowView`.
- About 40 chat files read `parameters`, `site` or `difyApi` from the context. The biggest is `chat-view.tsx` (670 lines).

**Dify-protocol code (B)**

- `provider/dify-chat-provider.ts` (509 lines): folds Dify SSE events into the message and holds the resume state machine for human input.
- `provider/dify-fetch.ts`, `provider/history.ts`.
- `provider/message.ts`: `DifyChatMessage`. Its base fields are neutral; the workflow, human-input, thought and citation fields and `ids.taskId` are Dify's.
- `hooks/use-dify-chat.ts` (525 lines), `use-conversations`, `use-workflow-run`, `run-reducer`, `use-dify-upload`, `use-speech-to-text`, `use-tts`, `use-suggestions`.
- In `chat-view/`: the inputs form, file types and upload, the message footer and actions, the annotation drawer.
- In `message/`: human input, workflow logs, agent thoughts, citations, sources, files.
- In `markdown/`: the answer form and button, `difyDompurifyConfig`, and the link rewrites through `difyApi.remoteFileUrl`.
- `workflow-view/*`.

**Generic chat UI (A, reusable)**

Some of these need only the message type renamed.

- `chat-view/`: `chat-sender`, `sider-collapsed`, `width-toggle`, `conversation-drawer`, `message-list`, `dislike-popover`, `user-content`.
- `hooks/`: `bubble-items`, `history-paging`, `speech-recording`.
- `markdown/`: code block, echarts, svg, think block.
- `message/`: `reasoning`, `think-title`, `use-think-timer`.
- `persistence/*`.
- `provider/keys.ts` (its field is called `difyId`) and `provider/provider-cache.ts`.
- Partly Dify: `conversation-sidebar` and `welcome-panel` (they read `site` and `parameters`), `hooks/dify-errors.ts` (`failureText` is a generic mapper).

## 6. i18n

- 523 keys per locale.
- 12 keys name Dify: `app.no_config_default_text`, `chat.error_upstream_*`, `admin_users.dify_user_id`, `admin_users.delete_directory_confirm_description`, `admin_apps.subtitle`, `admin_apps.dify_unreachable`, `app_setting.api_base_*`, `app_setting.api_secret_tooltip`, `app_setting.type_tooltip`, `hitl.no_token`.
- Whole namespaces hold Dify concepts without naming Dify: `app_mode.*`, `annotation.*`, `workflow.*`, `hitl.*`, and part of `app_setting.*`.

## 7. Tests

**Unit tests**

- 16 files are named for Dify.
- 14 more import Dify code or `dify_apps`.

**Stub Dify API (`e2e/fixtures/stub/`)**

- About 1,870 lines; port 5399.
- Five seeded apps keyed by `StubMode`.

**Seeding and specs**

- Raw SQL inserts into `dify_apps` in `e2e/auth.setup.ts:40` and `e2e/fixtures/access.ts`.
- 27 of the 36 e2e specs rely on Dify or the stub.

## 8. Naming and docs

**Names**

- The package name `dify-app-hub`, and the Docker, PM2, bake and workflow files that use it.
- `app/layout.tsx:34`: the description "A Dify web app that fits your business".
- `BUILT_IN_BRAND_NAME = 'Dify App Hub'` (`lib/settings/branding-rules.ts:4`).
- `.env.template`: the mail sender name.

**Environment**

- `lib/env.ts` has no Dify variables. The credentials are stored per app.

**Docs**

- Dify only: `docs/dify-service-api-1.17.1.md`, `docs/API_COMPLETION_SUMMARY.md`, `docs/CLIENT_API.md`.
- Partly Dify: `docs/auth-gate.md`, `docs/frontend-conventions.md`.
- 24 of the 31 ADRs mention Dify. Dify-specific: 0010, 0017 ("the one `DifyChatProvider`"), 0023, 0026.

## Cross-cutting

**App ids.** Every URL uses the hub's row id. Dify's app id is never stored.

**Conversations and messages.**

- They live only in Dify.
- In the browser they are held in memory, in the x-sdk store keyed `${appId}:${conversationId}`.
- IndexedDB keeps workflow data and think times.

**The end user (ADR-0026).**

- `users.id` is sent as Dify's `user` from one place only: `lib/dify/route.ts:52`.
- What ties it to Dify is the naming, not the schema. The same id can go to any provider.

## The five biggest coupling points

1. **The row and its inputs.**
   - The table: the `dify_apps` row, with `api_base` and `api_key` NOT NULL, `mode` holding Dify modes, and four columns for Dify features.
   - The input types: `AppInput` and `AppSettings`.
   - Name, description, tags and icon can come only from Dify.
2. **Create and update call Dify on every save.** The admin form is the Dify form. Sync and annotations depend on the Dify mode.
3. **The chat workspace seam.** `AppContextValue {app, parameters, site, difyApi}` and the switch on Dify modes, read by about 40 files.
4. **The streaming and message model.**
   - `DifyChatProvider`, `dify-fetch`, the history mapper, `use-dify-chat` and `use-conversations`.
   - `DifyChatMessage` mixes neutral fields with Dify fields.
5. **The route tree and the shared helpers.**
   - The tree: 25 route files under `app/api/dify/[appId]`.
   - `resolveDifyRoute` mixes the neutral session and app checks with Dify credentials.
   - The app-wide error envelope and the `parse*` helpers are named for Dify but used everywhere.
