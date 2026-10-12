# Part 1: the provider-neutral core (design)

Date: 2026-10-11 · Status: draft for the owner's review · Programme: `2026-10-11-provider-hub-charter.md` · Builds on: Part 0, PostgreSQL and the rename (merged first) · Branch: `feat/provider-core` from `fork/overhaul` · Decisions: running record `docs/superpowers/research/2026-10-11-provider-hub/README.md`, numbers 5, 8, 9, 17–24 and 29–30 · UI picks: `…/ui-picks-part1.md` · Docs check: `…/doc-verification.md` (rows cited as "DV 8b" and so on)

## 1. Goal and scope

The app record, the admin flow and the user pages stop being Dify-shaped. Dify becomes the first provider in a registry, and every new provider plugs into the same places. **The Dify chat behaves exactly as before**, apart from the annotate action, which goes with the rest of the annotations.

**In scope:**

- the `apps` record (provider, settings, secrets, admin-owned metadata, image icon);
- the provider registry, server and client;
- the "Add app" and "Edit app" drawer with the provider choice and Test connection;
- the admin table, the gallery and the chat page dispatch;
- removing the Dify sync, the annotations and the emoji icons;
- the code renames that make neutral code neutral;
- `@ant-design/icons` 5 → 6 (decision 28).

**Out of scope:**

- the AG-UI provider, the hub's message store and the shared chat API (Part 2);
- moving the Dify chat onto that API (Part 3);
- encryption of secrets (decision 8);
- the other library upgrades (decision 28).

## 2. Data

### 2.1 The `apps` table

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid`, primary key | made by the app (Part 0) |
| `created_at`, `updated_at` | `timestamp with time zone` | as in Part 0 |
| `provider` | `text` NOT NULL, `CHECK (provider IN ('dify'))` named `apps_provider_check` | decision 24. Part 2 replaces the CHECK to add `'agui'`. The provider never changes after insert (§2.3). |
| `name` | `text` NOT NULL | admin-owned; zod 1–255 characters |
| `description` | `text` NOT NULL DEFAULT `''` | admin-owned; zod ≤ 2,000 characters |
| `tags` | `jsonb` NOT NULL DEFAULT `'[]'` | an array of strings; zod: at most 10 tags, each 1–32 characters, trimmed, duplicates removed |
| `is_enabled` | `boolean` | unchanged |
| `access_mode` | the access-mode enum | unchanged (ADR-0027) |
| `settings` | `jsonb` NOT NULL | the provider's settings, no secrets; checked by the provider's schema on every write and read |
| `secrets` | `jsonb` NOT NULL | the provider's secrets, plain text until encryption (decision 8); checked the same way; never read into a DTO |
| `icon_image`, `icon_mime` | `bytea`, `text`, both NULL or both set (a CHECK) | the uploaded image, re-encoded to PNG (§4.4) |

The grant tables keep their foreign keys to `apps.id`, with the indexes Part 0 adds. The jsonb columns stay untyped (`unknown`) in Drizzle. `.$type<>()` is type-only (DV 8a), so the only typed value is the one a zod parse returns (DV 8c).

### 2.2 Dify's documents

- **`settings`:** `{ apiBase, appType, answerForm: { enabled, feedbackText }, enableUpdateAfterConversationStarts, openingStatementDisplayMode }`.
  - `apiBase`: an http(s) URL, ≤ 500 characters (today's `api-base-rule`).
  - `appType`: one of the six `APP_MODES`.
  - `feedbackText`: ≤ 255 characters.
  - `openingStatementDisplayMode`: `'default' | 'always'`.

  These are today's columns, without `enable_annotation`.

- **`secrets`:** `{ apiKey }`, 1–255 characters.

### 2.3 The data layer (`lib/data/apps.ts`)

It keeps the verified actor as the first parameter and `visibleTo` (ADR-0023, ADR-0027). It reads and writes through the registry.

- **Validation.** On write, the provider's `settingsSchema` and `secretsSchema` parse the documents before the insert or update. On read, they parse what the row holds. A row that fails is logged by app id and error code, and is never returned half-typed:
  - users get 404, as for an unknown app;
  - the admin DTO carries `invalid: true` and no settings. The status column shows `Tag color="error"` "Invalid settings" (the status column's existing Tag pattern), and Edit opens the form with the provider's defaults so the admin can repair the row. The registry is exhaustive: `satisfies Record<ProviderId, …>`, and an unknown id fails closed (DV 11).
- **The provider is fixed.** `updateApp` takes no provider, and the update's WHERE includes the stored provider, so a mismatched document is refused.
- **Secrets are write-only.** On update, a blank secret field keeps the stored value: the stored document is merged with the non-blank fields. No DTO carries `secrets`; the admin DTO carries `secretsSet: { apiKey: boolean }` (DV 10, OWASP ASVS 14.2.6).
- **The DTOs:**
  - **`AdminAppDto`:** `{ id, provider, name, description, tags, enabled, hasIcon, access, settings, secretsSet, createdAt, updatedAt }`. The settings include Dify's `apiBase`, as today.
  - **`ChatAppDto`:** a union keyed by `provider`.
    - Common: `{ id, provider, name, description, enabled, hasIcon }`.
    - For Dify, also `{ appType, settings: { answerForm, enableUpdateAfterConversationStarts, openingStatementDisplayMode } }`.
    - Never the base URL or the secrets.
  - **`AppSummary`** (the gallery): `{ id, provider, name, description, tags, hasIcon, appType? }`.
  - **`AppAccess`** (what a provider route needs): `{ id, provider, enabled, settings, secrets }`. It is built only inside the server-only route guard.
- **Removed:**
  - `fetchDifyProfile`, `iconColumnsFrom`, `signedIconUrl`, `infoColumns`, `settingsColumns`, `syncApp`, `SyncResult`, `readIconBytes`, `ICON_MAX_BYTES`;
  - the emoji branch of `AppIcon`, which becomes `hasIcon: boolean`;
  - `annotationEnabled` everywhere.

  Saving never calls a provider (decision 18).

### 2.4 The migration

One migration turns Part 0's `dify_apps` into `apps` and keeps the existing rows:

- each row's Dify columns become `settings`;
- `api_key` becomes `secrets`;
- `provider` becomes `'dify'`;
- `tags` becomes a jsonb array;
- an image icon keeps its bytes;
- an emoji icon becomes no icon (decision 19).

Then the Dify columns are dropped. How drizzle-kit produces it (a generated schema diff plus a custom data step, or one custom migration) is settled in the plan against drizzle-kit's migration docs. It is tested on a copy of the local database before it runs on the real one.

## 3. Modules

| Path | Contents | Runs |
| --- | --- | --- |
| `lib/providers/ids.ts` | `PROVIDER_IDS = ['dify'] as const`, `ProviderId` | anywhere |
| `lib/providers/dify/schema.ts` | Dify's `settingsSchema` and `secretsSchema`, defaults, the app-type list | anywhere: the form uses them too. No `server-only` here (DV 9a). |
| `lib/providers/dify/` (moved from `lib/dify/`) | the Dify client, types, request schemas, the remote-file guard, the browser client, and `testConnection()` | the client and `testConnection` are `server-only`; the browser client stays a client module |
| `lib/providers/registry.ts` | `import 'server-only'`; `ProviderDefinition { id, settingsSchema, secretsSchema, defaults, testConnection(settings, secrets) }` per id | server |
| `lib/providers/route.ts` | `resolveAppRoute(appId, provider)`: session → `z.uuid()` on the id (Part 0) → `getAppAccess` (visibility) → enabled → provider match. Answers in the envelope: 401, 404 `app_not_found` (unknown, invisible, malformed or another provider's), 403 `app_disabled`. `lib/providers/dify/route.ts`'s `resolveDifyRoute` wraps it and builds today's Dify context from `settings.apiBase` and `secrets.apiKey`. | server |
| `lib/http/` (moved out of `lib/dify/`) | the envelope and helpers under neutral names: `errorResponse` (was `difyErrorResponse`), `forbiddenResponse`, `errorResponseFrom`, `jsonNoStore` (was `difyJson`), the `parse*` helpers, and the browser's `RequestError` and `readRequestError` (were `DifyRequestError`, `readDifyError`) | as before |
| `components/provider-ui/` | the client registry. Per provider: label key, fallback icon, admin form section, chat view. One client switch, `ProviderChat`, takes `provider` and the DTO and renders the view. The server chat page passes only serializable props (DV 9b, React "use client" caveats). The name keeps `components/providers/` for the React context providers (DV 9c). | client |

`components/chat/**` stays where it is and keeps importing the Dify browser client from its new path. Part 3 replaces it.

## 4. The admin flow

### 4.1 Layout B (decision 29)

- **The drawer is today's** (E2): right, `size="large"`, Cancel and OK in `extra`.
- **"Add app" opens it.** The first row is the **provider `Select`** (E1): plain, outlined, text options. Until a provider is picked, it is the only row. Once one is picked, the shared sections and that provider's sections appear, and the choice can still change before saving (the provider's fields reset to its defaults).
- **"Edit app" opens the same drawer.** The provider row shows the same Select, disabled (E8).

**The form:**

- `layout="horizontal"`, labels beside the fields. On narrow screens the labels go above, through responsive `labelCol` and `wrapperCol` spans (`xs: 24`), the documented grid object, so the mobile e2e project keeps a usable form.
- `requiredMark` is a render function that draws the asterisk on required fields and "(optional)" on the others (E3). antd's built-in values give one or the other; its documented customize form gives both (`Form` demo `required-mark`, since 5.9.0). The asterisk uses the error colour token.
- The sections are separated by today's plain `Divider`s with the title at the start (E3).

**The sections, in order:**

| Section | Fields (required ones marked \*) |
| --- | --- |
| Basic | Provider*. Name*. Description: `Input.TextArea`, `autoSize` 2–6 rows (E6). Tags: `Select mode="tags"`, comma separator, the tags of other apps as suggestions (E5). Icon: Upload + Button with no list, a square `Avatar` preview, a default Remove button as on the branding page (owner, 2026-10-12), the branding page's pattern (E4). Status. |
| Access | unchanged (ADR-0027) |
| Connection (from the provider) | for Dify: API base*, API key* (on create; on edit "optional", placeholder "Leave blank to keep"), App type\*, **Test connection** |
| Conversation (from the provider) | for Dify: update inputs after the conversation starts; opening statement display |
| More (from the provider) | for Dify: form reply and its submit text |

### 4.2 Test connection (E7, decision 18)

- **The button.** A default `Button`, "Test connection", with `loading` while the test runs. It is the last row of the provider's Connection section.
- **The action.** `testAppConnectionAction({ appId?, provider, settings, secrets })`. The action:
  1. verifies the admin, as the other actions do (ADR-0024);
  2. when `appId` is given and a secret is blank, reads the stored secret on the server;
  3. calls the registry's `testConnection`;
  4. returns an `ActionResult`.

  It saves nothing and copies nothing.

- **Dify's test.** `GET /info` with the key:
  - **Reachable:** success.
  - **Type mismatch:** success with a warning; Dify's `mode` differs from the chosen type.
  - **Key refused:** Dify's 401.
  - **Unreachable:** network failure, timeout or 5xx.
  - **Upstream error:** any other non-OK answer.
- **The result.** An `Alert` under the button, with `showIcon`, a title and a description: success, warning or error. It is cleared when a connection field changes.

### 4.3 The actions

- **`createAppAction(formData)` and `updateAppAction(formData)`** take FormData, because the icon is a file. This is the branding page's pattern (Server Actions accept FormData with files). zod parses the fields into `{ provider, common, settings, secrets, icon, access }`, with a union keyed by provider, and the data layer validates again through the registry (DV 8b).
  - **Errors:** `invalid_input` with field errors, `not_found`, `provider_unreachable` (was `dify_unreachable`; no longer raised on save, kept for the test), and the existing grant errors.
- **`deleteAppAction`** stays. **`syncAppAction`** is removed.

### 4.4 The icon

The image goes through `lib/settings/images.ts`, ADR-0030's pipeline:

- a new image kind, `appIcon`;
- PNG, JPEG or WebP in;
- sharp with `limitInputPixels`, auto-orient and metadata stripped;
- re-encoded to PNG;
- at most 256 × 256 px, in proportion;
- an input cap of 512 KB (owner, 2026-10-12: Next's default 1 MB Server Action body has to carry the icon and the form's other fields; the branding logo's cap is 512 KB for the same reason).

"Remove" clears both icon columns. `GET /api/apps/[appId]/icon` serves the stored PNG as today.

### 4.5 The table (E9)

- **The "Provider" column** replaces "Type". It is plain text from i18n, for example "Dify · Chatflow". Its built-in column `filters` list the providers, with the Dify types nested under "Dify", so today's filter by type stays.
- **The Name column** keeps the icon: the stored image, or the provider's fallback.
- **The row actions** are the same for every provider: open in the user view, edit, delete. "Sync app info" and "Annotations" are gone.

## 5. The user side

- **The gallery card (E10).** Today's `Card.Meta` description names the provider and, for Dify, the type, for example "Dify · Chatflow". The icon is the stored image, or the provider's fallback.
- **The fallback icons (E11).** A square `Avatar` with the default grey background:
  - Dify: `ApartmentOutlined`;
  - unknown or generic: `AppstoreOutlined`;
  - AG-UI's `RobotOutlined` and OpenAI-compatible's `ApiOutlined` arrive with their providers.
- **The chat page.** `/chat/[appId]` loads `ChatAppDto` on the server as now, renders `AppUnavailable` for a missing or disabled app, and otherwise renders `ProviderChat`.
  - For Dify, `ProviderChat` renders today's `ChatWorkspace`, which reads `app.appType` where it read `app.mode` (three places).
  - The annotate action and the annotation drawer are removed from `chat-view`, `message-footer` and `message-actions`.
- **The users page.** "Dify user ID" becomes "User ID" (`admin_users.user_id`, CSS class `userId`). ADR-0026 gets a note: the account id is the end user for every provider.

## 6. Removed

- **Annotations:**
  - `app/api/dify/[appId]/apps/annotations/route.ts` and `…/[annotationId]/route.ts`;
  - the client functions, schemas, types (`lib/dify/types/annotations.ts`) and browser methods;
  - `components/admin/apps/annotations-{drawer,panel}.tsx` and `annotation-form-modal.tsx`;
  - `components/chat/chat-view/annotation-drawer.tsx` and the annotate action;
  - the `annotation.*` and `app_setting.allow_annotation*` keys;
  - the stub's annotation endpoints;
  - their tests.

  `__tests__/api-routes.test.ts` drops the two folders.

- **The sync:** `syncAppAction`, the sync menu item, `admin_apps.sync_*`, `admin_apps.icon_not_stored`, `__tests__/data-apps-sync.test.ts`.
- **Emoji icons:** the emoji branch in `AppIcon` and the fallback icons per Dify mode (`MODE_ICONS`).
- **The Descriptions block** at the top of the edit drawer. Name, description and tags are now fields.

## 7. Renames and i18n

**Code:**

- `difyApps` → `apps`;
- `lib/dify` → `lib/providers/dify`;
- the shared helpers → `lib/http`, with the names in §3;
- `admin_users.dify_user_id` → `admin_users.user_id`;
- the `dify_unreachable` code → `provider_unreachable`.

The Dify chat's internal names (`difyApi`, `DifyChatProvider`, `use-dify-chat`, `provider/keys.ts`'s `difyId`) stay until Part 3, because they are Dify-only.

**New keys**, in en, zh and ar, each run through `i18next-cli`:

- the provider names;
- the provider field's label and placeholder;
- name, description, tags and icon labels, with their help text;
- "(optional)";
- the Test connection button and its result titles and descriptions;
- the "Provider" column;
- "Leave blank to keep".

Keys that named Dify in neutral places are reworded (`admin_apps.subtitle`, `app.no_config_default_text`). The Arabic follows ADR-0005, and the zh and ar wording joins the owner's review list.

## 8. Dependencies

`@ant-design/icons` `^5.6.1` → `^6.3.4`, the version antd 6.6.5 and X 2.9.0 already depend on. That leaves one copy in the tree, which closes the "two icon majors" follow-up. The changelog from 5.6.1 to 6.3.4 is checked before the bump, and every icon the code imports is confirmed to exist in 6.

## 9. Tests

**Unit tests** (Vitest, node environment):

- **Dify's schemas:** valid and invalid `settings` and `secrets`; an unknown `appType`; a non-http base.
- **The registry:** it is exhaustive, and an unknown provider fails closed.
- **The data layer:**
  - validation on write and read, including a row with a broken document;
  - the provider cannot be changed;
  - a blank secret keeps the stored one;
  - no DTO carries `secrets`;
  - `visibleTo` is unchanged.
- **`resolveAppRoute`:** a malformed id, another provider's app, a disabled app, an invisible app.
- **The actions:**
  - FormData parsing with and without an icon;
  - the icon pipeline (an oversize image, SVG refused, PNG out);
  - `testAppConnectionAction` with a stored key and with a typed key, and each of its results against a mocked `/info`.
- **The migration:** run against a database seeded in Part 0's shape. Every Dify column lands in `settings` or `secrets`, and an emoji icon becomes none.
- **`__tests__/api-routes.test.ts`:** without the annotation folders.
- **The i18n parity test:** across en, zh and ar.

**e2e** (the three projects, the stub Dify):

- **Add a Dify app:**
  1. pick Dify;
  2. fill name, description, tags and icon;
  3. Test connection against the stub's `/info`, with success, mismatch, refused and unreachable scenarios;
  4. save.
- **Edit:**
  - the provider is disabled;
  - a blank key keeps the stored one (the chat still works);
  - replace and remove the icon.
- **The table:** the Provider column and its filter, including a Dify type.
- **The gallery card:** the provider line and the fallback icon.
- **The chat:** every Dify type works as before (the existing chat specs, minus annotations).
- **The users page:** "User ID".
- **`e2e/auth.setup.ts` and the fixtures** seed `apps` rows with `settings` and `secrets`.

**Docker gate:** the `CLAUDE.md` checks after the migration on the local database, plus `/api/dify/<id>/apps/annotations` signed in → 404.

## 10. Records

- **ADR-0032 "Organise apps by provider: a shared core with provider modules"** (ADR-0031 is Part 0's). It covers:
  - the provider column with jsonb settings and separate secrets (decisions 17 and 24);
  - the registries and the route guard;
  - admin-owned metadata and no sync (decision 5);
  - Test connection (decision 18);
  - image-only icons (decision 19);
  - the fixed provider;
  - the removed annotations (decision 21).

  It cites LibreChat, LobeHub and Dify's own model (the reference hubs) and DV 8 to 11.

- **ADR notes:** ADR-0023 (the record, the guard and the removed routes), ADR-0026 (every provider's end user), ADR-0027 (grants on `apps`).
- **`CLAUDE.md`:** the structure pointers, the decision line and the open follow-ups (annotations removed; the sync removed; icons 6 closes the "two icon majors" item).
- **`docs/frontend-conventions.md`:** the form conventions (horizontal labels with responsive spans, the requiredMark render).

## 11. Done when

- Every gate in `CLAUDE.md` passes: typegen and `tsc`, oxlint and oxfmt, `pnpm test`, the e2e suite on three projects, and the Docker gate.
- An admin can add, edit, test and delete a Dify app through layout B.
- The gallery, the table and the chat work for every Dify type.
- Nothing neutral imports from `lib/providers/dify` except through the registry, the route guard or `ProviderChat`. This is checked with a grep in the final review.
- ADR-0032 is accepted after the owner's check.
