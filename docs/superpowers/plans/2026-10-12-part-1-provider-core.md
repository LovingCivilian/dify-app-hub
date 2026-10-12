# Part 1: The Provider-Neutral Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app record, the admin flow and the user pages provider-neutral, with Dify as the first provider in a registry, so that Part 2's AG-UI provider plugs into named places; the Dify chat behaves exactly as before, apart from the annotate action.

**Architecture:** Part 0's `dify_apps` becomes `apps` with a `provider` column (`text` and a CHECK) and two `jsonb` documents, `settings` and `secrets`, each checked by the provider's zod schemas on every write and every read; three drizzle-kit migrations carry Part 0's rows and grants over. A client-safe schema map (`lib/providers/schemas.ts`), a server-only registry (`lib/providers/registry.ts`: schemas, Test connection, what each DTO carries) and a shared route guard (`lib/providers/route.ts`) are the only ways neutral code reaches a provider; on the client, `components/provider-ui/` holds the label, the fallback icon, the admin form section and `ProviderChat`. The admin drawer moves to layout B (the provider first, then shared fields with tags and an icon upload through ADR-0030's image pipeline, then the provider's sections with Test connection), saving never calls a provider, and secrets are write-only. The Dify sync, the annotations and the emoji icons go.

**Tech Stack:** Next.js 16.3 (App Router, Server Actions with FormData, Route Handlers), React 19.2, antd 6.6.5 and Ant Design X 2.9, `@ant-design/icons` 5.6.1 → 6.3.4, zod 4.6.5, Drizzle ORM and drizzle-kit 1.0.0-rc.4 on PostgreSQL 18 (`pg` 8.23), sharp 0.35.4, Vitest 4 (projects `unit`, `ldap`, `db`; node environment), Playwright 1.63 (three projects, the stub Dify on 5399).

**Spec:** `docs/superpowers/specs/2026-10-11-part-1-provider-core-design.md` (owner-approved 2026-10-11, decision 32). Programme: `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`. Docs check: `docs/superpowers/research/2026-10-11-provider-hub/doc-verification.md` (rows cited as "DV 8a" and so on). Running record: `docs/superpowers/research/2026-10-11-provider-hub/README.md` (decisions 5, 8, 9, 17–22, 24, 28–33). UI picks: `docs/superpowers/research/2026-10-11-provider-hub/ui-picks-part1.md` (E1–E11). Reference hubs: `docs/superpowers/research/2026-10-11-provider-hub/agui-and-reference-hubs.md` §5.

## Global Constraints

- Branch `feat/provider-core` from `fork/overhaul` (`e459ca26` or later; after `dfeff12e`, PRs #42, #56 and the plan-format PR changed only `CLAUDE.md`, this plan and other docs no task touches), created when execution starts. Nothing is pushed and no PR is opened until the owner says so; the PR then targets `fork/overhaul` (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`).
- Commits: conventional (`feat|fix|refactor|test|docs|chore(scope): …`), English, `git add <paths>`, never `-A`. Each message ends with the session's two trailers inside the same `-m` argument, after a blank line: `Co-Authored-By: <the implementer's model> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn`. The plan's commands show `Claude Opus 5.5`; an implementer on another model writes its own name.
- ADR-0002: documented approaches only; every non-obvious choice carries its source in a comment, as the surrounding code does. The sources are the DV rows, the docs each task names, and the measurements under "Plan decisions".
- Gates before each commit (CLAUDE.md): `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm exec oxlint <changed files>`, `pnpm exec oxfmt --check <changed files>`, `pnpm test`. A task that touches the data layer (`db/`, `lib/data/`, the documents) also runs `pnpm test:db`. A task that names e2e specs runs them.
- One `next dev` per checkout (Next 16): stop `pnpm dev` before `pnpm test:e2e`. `pnpm test:db` and `pnpm test:e2e` share the e2e PostgreSQL on 127.0.0.1:5433 and never run at the same time. This machine has about 5 GB of RAM: one heavy process at a time.
- The owner's running local stack (`ai-app-hub-local`, `docker-compose.local.yml`, port 5300, PostgreSQL on 127.0.0.1:5432) is never touched by a task, except Task 15's Docker gate, which stops for the owner's word first (Task 15, Step 7) and always backs the database up before the migration (Step 9), with a written way back (Step 15).
- AGENTS.md: migrations through `pnpm db:generate` only (with `--name`, `--custom` and `--hints` as Task 11 gives them), never `drizzle-kit push`; the generated SQL is read before it is committed. `.cii-assessment.md` is re-checked before the last commit and committed on its own (Task 14).
- The `apps` table (spec §2.1): `provider` `text` NOT NULL with `CHECK (provider IN ('dify'))` named `apps_provider_check`; `name` 1–255 characters; `description` NOT NULL DEFAULT `''`, at most 2,000 characters; `tags` `jsonb` NOT NULL DEFAULT `'[]'`, at most 10 tags, each 1–32 characters, trimmed, duplicates removed; `settings` and `secrets` `jsonb` NOT NULL; `icon_image` and `icon_mime` both NULL or both set. Limits live in zod (ADR-0025); the jsonb columns stay `unknown` in Drizzle (DV 8a).
- Dify's documents (spec §2.2): `settings` `{ apiBase, appType, answerForm: { enabled, feedbackText }, enableUpdateAfterConversationStarts, openingStatementDisplayMode }` — `apiBase` an http(s) URL of at most 500 characters, `appType` one of the six `APP_MODES`, `feedbackText` at most 255 characters, `openingStatementDisplayMode` `'default' | 'always'`; `secrets` `{ apiKey }`, 1–255 characters.
- Secrets are write-only: no DTO, action result or log line carries one; a blank secret field keeps the stored value (spec §2.3; DV 10, OWASP ASVS 5.0 14.2.6).
- The provider never changes after insert (spec §2.3). Saving never calls a provider (decision 18).
- The icon (spec §4.4): ADR-0030's pipeline, image kind `appIcon`, PNG, JPEG or WebP in, re-encoded to a PNG of at most 256 × 256 px in proportion; an input cap of 512 KB (owner, 2026-10-12; Plan decision af).
- Every id from outside passes `z.uuid()` (`lib/ids.ts`) before a query. Every `rowCount` consumer handles `null` (node-postgres types it `number | null`). New log lines carry an error's name and code only, or an app id and a check's code; never a document, a zod issue, a message or query parameters. Two inherited lines stay as recorded: the Dify client's log of a network failure's cause (ADR-0023: the cause stays in the server log, the browser gets a fixed message) and `toActionFailure`'s log of a provider error's status, code and message (charter §4.5).
- Dify-only code keeps the Dify name (`difyClient`, `createDifyApi`, `resolveDifyRoute`, `DifyError`, `DifyChatProvider`, …; spec §7); `components/chat/**` stays Dify's chat until Part 3.
- i18n: every new key in en, zh and ar (ADR-0005; Arabic in Modern Standard Arabic); `pnpm i18n:lint` and `pnpm i18n:status` are the i18next-cli checks; `i18next-cli extract` and `sync` are never run (`docs/i18n-maintenance.md`). The zh and ar wording joins the owner's review list (Task 14).
- New UI components and variants are the owner's picks E1–E11 only (`ui-picks-part1.md`); nothing outside them.
- Unit tests run in Vitest's node environment (no DOM); browser behaviour is proven by the e2e suite on `desktop-light`, `desktop-dark` and `mobile-light`.
- Never read or print `.env` or `.env*.local`; never send an email address to any service.
- Scratch files go to the repo's git-ignored `tmp/`, never `/tmp`; nothing under `tmp/` ends in `.ts` (`tsconfig.json` excludes `tmp`, but the scratch habit stays).
- Line numbers are those of `dfeff12e` (still true for every file a task touches) unless a step says "as of Task N"; earlier tasks shift some of them, so the quoted text decides. `oxfmt` strips the leading tabs of a fragment quoted from inside a function: find each "replace" fragment by its text and keep the indentation of the lines it replaces. A step that says "replace the whole of" a file gives the file's complete new content.

**User decisions (already made):**

- Part 1 is the provider-neutral core (Dify as provider #1, behaviour unchanged), before the AG-UI and Dify-on-shared-chat parts (owner, 2026-10-11: "split them"; record decision 1)
- Name, description, tags and icon are admin-owned for every provider, and the Dify sync is removed (owner, 2026-10-11; record decision 5)
- Provider secrets stay plain text in Part 1, kept apart from settings, write-only in the form, with encryption deferred to the SMTP/LDAP work (owner, 2026-10-11; record decision 8)
- The shape is a hybrid: a shared chat API and shared components for what providers have in common, plus per-provider specifics (owner, 2026-10-11: "somewhere in between. shared chat api for shared components between them. which is gonna be most of them. and per provider specific things"; record decision 9)
- Part 0 is a fresh start (new PostgreSQL baseline, nothing copied from MySQL) and ids are `uuid` (owner, 2026-10-11: "specs looks good"; record decisions 14 and 27)
- Provider settings are a `provider` column plus `settings jsonb` (no secrets) and `secrets jsonb`, each checked by the provider's zod schemas on every write and read; a new provider needs no migration (owner, 2026-10-11; option A of 3; record decision 17)
- The Dify app type is an admin field, the form has a "Test connection" button that copies nothing, and saving never calls Dify (owner, 2026-10-11; record decision 18)
- App icons are image-only: upload through ADR-0030's pipeline (PNG, JPEG or WebP in, PNG out, no SVG, size-capped) or leave empty for a provider fallback icon, and the emoji columns are dropped (owner, 2026-10-11; record decision 19)
- Annotations are removed from the product (owner, 2026-10-11: "remove the annotations. I don't use that feature. that way all the options are the same. otherwise good"; record decision 21)
- The gallery, the chat page at `/chat/[appId]` and the Dify chat (unchanged apart from the annotate action) follow the approved user-side design (owner, 2026-10-11: "good"; record decision 22)
- `apps.provider` is `text` with a CHECK listing the known ids plus the registry's zod check, not a PostgreSQL enum (owner, 2026-10-11; recommended option; record decision 24)
- Migrations keep running in the container's entrypoint (owner, 2026-10-11; record decision 25)
- "Add app" and "Edit app" use layout B: the provider choice sits at the top of the drawer, and editing makes it read-only (owner, 2026-10-11, chosen from three mockups; record decision 29)
- The UI components are the owner's picks E1–E11 and nothing outside them: E1 to E4 picked by the owner (a plain `Select`, today's Drawer, plain Dividers with no Collapse, Upload + Button with a square Avatar), E5 to E11 delegated ("for the rest do as you see fit. vanilla showcase style"), full list in `ui-picks-part1.md` (record decision 30)
- Part 1's spec is approved, including the choices decision 31 lists (owner, 2026-10-11: "go"; record decision 32)
- The icon's input cap is 512 KB (owner, 2026-10-12: "Cap at 512 KB"; record decision 37)
- The icon's Remove is a default Button with `DeleteOutlined`, as on the branding page (owner, 2026-10-12: "Default, like branding"; record decision 37)
- The local folders and Claude Code's memory directory keep their paths until after Part 3 (owner, 2026-10-12: "how about moving naming the folder it self to last? cause currently im on remote and can't edit files"; record decision 35)

## Review Focus

1. **An app that no longer reads**: a Part 0 app stored without a known mode, or stored secrets that do not parse. Expected: the admin sees "Invalid settings"; Edit opens on Dify's defaults with the shared fields kept; a typed key repairs a broken key, while a blank one is refused on the key field (there is nothing valid to keep); users meet the app as an unknown one (404, not in the gallery); nothing shows half a document. Pinned in Task 11 (`apps-migration.db.test.ts` "keeps an app without a mode, with appType null"; `apps.db.test.ts` "refuses a blank key over broken stored secrets, by field, and writes nothing"; the admin DTO cases in `data-apps.test.ts`) and Task 13 (e2e "an app with invalid settings is marked, hidden from the gallery, and repaired from its Edit").
2. **The migration on a database with apps and grants** (the owner's local stack now, production later). Expected: every app and every grant kept; a drop-and-create would cascade the grants away. Pinned in Task 11 (`db-apps-migrations.test.ts` "rename dify_apps to apps and add the three columns as NULL-able first"; `apps-migration.db.test.ts` "keeps the grants") and Task 15 (the backup, the rehearsal on the restored copy, with the counts before and after, and the written way back).
3. **An API base without `/v1`** (`https://api.dify.ai` for `https://api.dify.ai/v1`, the likeliest typo). Expected: Test connection says the provider answered with an error and to check the API base; not "Connected", not "unreachable". Dify's console answers that path with its HTML page and 200. Pinned in Task 7 (`dify-test-connection.test.ts`, the "Review Focus 3" case) and Task 12 (`connection-outcome.test.ts`, the upstream-error text).
4. **An icon that is not what it claims**: an SVG, a renamed file, an image over the cap. Expected: refused with a translated message, nothing stored; the browser's check is a convenience, sharp's decoding decides. Pinned in Task 8 (`settings-images.test.ts`: "refuses an SVG icon as not_allowed", "refuses an icon over its byte limit before decoding") and Task 11 (`apps.db.test.ts` "refuses an icon that is not a PNG, JPEG or WebP, and writes nothing").
5. **Tags typed with spaces or twice** (`" a"`, `"a"`, `"b "`). Expected: trimmed and de-duplicated before the 10-tag limit counts them, so ten distinct tags pass whatever the duplicates; an empty or 33-character tag is refused. Pinned in Task 11 (`app-management-schemas.test.ts` "trims the name, the description and the tags, drops duplicate tags, then counts them", and the `refuses %s` cases).

## Plan decisions (taken while planning, where the spec leaves the choice open)

Measured while planning, against a throwaway `postgres:18` (the e2e service, 127.0.0.1:5433) with drizzle-orm and drizzle-kit 1.0.0-rc.4 in a scratch project under `tmp/`: the three migrations generated from the planned schema, applied in one transaction to a database in Part 0's shape with seeded rows (an emoji-icon app, an image-icon app, an app without a mode, grants), and read back; the same three applied with `psql --single-transaction` to a `pg_dump` copy (Task 15's rehearsal), and a plain dump restored into a database made from `template0`, both as a copy and in place (Task 15's backup and way back); Task 15's counts, including the apps over the new limits; the SQL Drizzle renders for `visibleTo`, `appOfProvider` and the locking read (`drizzle.mock()`); zod 4.6.5's issue shapes for the codec and `flattenError`; the 52 icon names the code imports, all present in `@ant-design/icons` 6.3.4.

- **a. One switch task (Task 11).** Tasks 9 and 10 read the documents from Part 0's columns (`storedSettings(row)`, `{ apiKey: row.apiKey }`), mapped exactly as the data migration maps them, so the guard and the user side move first. Task 11 changes the table, the data layer and the actions together, because tsc is green only when the columns, the DTOs and the action inputs move as one. Between Tasks 11 and 12 the browser cannot create an app (`invalid_input`: the form has no name field yet); editing works.
- **b. Three drizzle-kit migrations**: expand (generated, with a rename hint), data (`--custom`, hand-written SQL) and contract (generated), applied in one transaction by the migrator (DV 1d). One custom migration cannot hold the reshape: `generate --custom` copies the previous snapshot, so the next `generate` would emit the whole diff again (drizzle-kit 1.0.0-rc.4 `prepareSnapshot`).
- **c. The constraint names stay** (`dify_apps_pkey`, `app_group_grants_app_id_dify_apps_id_fkey`, `app_user_grants_app_id_dify_apps_id_fkey`). PostgreSQL keeps them on a rename and drizzle-kit's snapshot records the same names; renaming them changes no behaviour.
- **d. `lib/providers/schemas.ts` is the client-safe half of the registry**: the schemas, the defaults, `checkSettings`, `checkDocuments`, `mergeSecrets`, `documentFieldErrors`. The admin form and the data layer share one parse (DV 9a); `lib/providers/registry.ts` (server-only) adds the test and the DTO mappers.
- **e. The server registry says what each DTO carries** (`chatFields`, `summaryFields`, `secretsSet`), so `lib/data/apps.ts` builds every DTO without importing Dify (spec §11).
- **f. Dify's Test connection reads `/info` through a raw client method** (`fetchInfo`) and gives up after 10 s (`AbortSignal.timeout`, MDN; the same bound as the database's in Part 0). 401 is "key refused"; a network failure, the timeout or a 5xx is "unreachable" (spec §4.2); any other answer that is not OK, or an OK answer that is not Dify's JSON, is "upstream error"; another `mode` is "reachable" with a warning.
- **g. The test's failures are action codes** in `ActionResult` (`provider_key_refused`, `provider_unreachable`, `provider_error`), its successes `{ outcome: 'reachable' }` or `{ outcome: 'type_mismatch', reported }`; the drawer's `connectionOutcome` turns them into the `connection_test.*` texts. The action is admin-only and reads the stored key (`getStoredSecrets`) only when the field is blank on a saved app.
- **h. One FormData field, `values`, holds the form's values as JSON**, which a zod codec decodes and checks (zod 4 "Codecs", the `json(schema)` example), next to `iconIntent` and the `icon` file. The nested documents stay typed end to end instead of being flattened into dotted field names.
- **i. The icon is a draft until saved**: `IconDraft` (`keep`, `remove`, or `replace` with an object URL for the preview, revoked when it changes); antd Upload only picks the file (`beforeUpload` returns `false`, or `Upload.LIST_IGNORE` for a wrong type or size: the "Upload manually" and "Upload png file only" demos).
- **j. The fixed provider in SQL**: the update locks the row (`FOR UPDATE`, reading `provider` and `secrets` under the lock), and the write's WHERE is `appOfProvider(id, stored provider)`.
- **k. A blank key over stored secrets that do not read is refused on `secrets.apiKey`**: there is nothing valid to keep. Typing a key repairs the row (Review Focus 1).
- **l. The admin DTO is a union on `invalid`**: an invalid row carries no settings; the table shows "Invalid settings" and no type, and Edit opens on `providerDefaults(provider)` with the shared fields kept.
- **m. A refused read logs `'Stored app documents refused:', { appId, code }`**, the code being `unknown_provider`, `invalid_settings` or `invalid_secrets`: never the document or the zod issues, which can echo the input, the key included.
- **n. Tags are normalised in zod**: each trimmed and 1–32 characters, duplicates dropped (`new Set`, so case-sensitive), then at most 10 (`.transform().pipe()`). The field is `Select mode="tags"` with `tokenSeparators={[',']}` and the other apps' tags as options (E5).
- **o. `lib/settings/image-rules.ts`** (client-safe) holds `IMAGE_MIME_TYPES`, `IMAGE_ERROR_CODES`, `ImageErrorCode`, `APP_ICON_MAX_BYTES` and `APP_ICON_SIZE` for the form and the pipeline. The pipeline's names drop "brand" (`processImage`, `ImageError`); the branding images behave as before.
- **p. The icon is never enlarged** (sharp `fit: 'inside'`, `withoutEnlargement: true`): "at most 256 × 256 px, in proportion" (spec §4.4).
- **q. One client switch**: `ProviderChat` switches on `app.provider` with a `satisfies never` default. The server page passes only the serializable DTO (DV 9b); `PROVIDER_UI` holds data and components and is read only in client components.
- **r. `ProviderError`** in `lib/http/errors.ts` is the base of `DifyError`, so `errorResponseFrom` and `toActionFailure` answer any provider's error without importing one.
- **s. `lib/dify` moves before anything changes** (Task 3: paths only, names kept), right after Task 2 takes the neutral helpers out, so later diffs show behaviour, not moves.
- **t. `fetchSignedFile` goes with the sync**: the icon sync was its only caller.
- **u. `DifyError`'s `toBody()` is not carried over** to `ProviderError`: nothing calls it.
- **v. The stub's Test connection scenarios are a key and a path**: the key `app-refused` answers Dify's 401, and a base under `/v1/unreachable` drops the connection; success and the type mismatch use the stub's existing `/info`.
- **w. The running record's Part 1 entry follows the merge**, as Part 0's decision 36 did (PR #40). Task 14 writes the ADR and the notes only.
- **x. One `@ant-design/icons` copy is pinned by a test** (`__tests__/icons-version.test.ts`: the hub, antd and X resolve the same package), so a later bump that splits the tree again fails `pnpm test`.
- **y. `forbiddenResponse` leaves the Dify routes' re-exports** with the annotation routes, its last users there; it stays in `lib/http/errors.ts`.
- **z. `admin_users.delete_directory_confirm_description` is reworded too**: it names Dify in neutral copy, which Task 5's locale test refuses. The spec names two keys as examples.
- **aa. The provider boundary is also a unit test** (`__tests__/provider-boundary.test.ts`), besides the spec's grep in the final review (Task 15, Step 2), so a later import of Dify from neutral code fails `pnpm test`.
- **ab. The reads behind a user's DTO never select `secrets`**: they check the settings alone (`checkSettings`). Only the guard's `getAppAccess`, `getStoredSecrets` and the admin writes read the secrets; a mapper cannot leak what is never read.
- **ac. Field labels in sentence case, neutral where shared**: "API Base" → "API base", "API Secret" → "API key" (`app_setting.api_secret_*` → `app_setting.api_key_*`), and "Leave blank to keep" (`app_setting.secret_keep_placeholder`) for any provider's secret.
- **ad. The drawer submits the form's whole store** (`form.getFieldsValue(true)`, antd Form: "use `getFieldsValue(true)` to get all values"), never `onFinish`'s values: those hold only the mounted fields (`@rc-component/form` `validateFields`), so the form reply's text, shown only while its switch is on, would be missing and zod would refuse the settings. The create and edit e2e cases save with that switch off (review B1).
- **ae. Two live database tests**: `apps-migration.db.test.ts` builds Part 0's shape in its own database (`hub_migration`, created and dropped by the test) and runs the three migrations; `apps.db.test.ts` runs the data layer's writes on `hub_dal`, replacing `data-apps-sync.test.ts`'s mocked query chains. The two pins no live test can observe (which columns the user reads select, and `deleteApp` on a `null` row count) keep a small fake chain in `__tests__/data-apps-reads.test.ts` (review B4).
- **af. The icon's input cap is 512 KB** (owner, 2026-10-12: "Cap at 512 KB"). Spec §4.4 said 1 MB, but Next counts its default 1 MB Server Action body limit on the raw multipart body ("By default, the maximum size of the request body sent to a Server Action is 1MB"; the limit "applies to the raw HTTP request body, including the bytes that `multipart/form-data` adds", the bundled next.config.js docs, lines 29 and 45), so a 1 MB icon and the form's other fields could not be saved. 512 KB is the branding logo's cap for the same reason (`lib/settings/branding-rules.ts`), and the stored PNG is at most 256 × 256 px. The spec's §4.4 now says 512 KB (owner, 2026-10-12).
- **ag. The icon's Remove is a default Button with `DeleteOutlined`** (owner, 2026-10-12: "Default, like branding"), as on the branding page (`components/admin/settings/branding-settings.tsx`, lines 131–136). Spec §4.1 said "a danger Remove button, the branding page's pattern", while that page's Remove is not a danger one; the spec now names the default one (owner, 2026-10-12).

## File map

| Task | Creates | Changes most | Removes |
| --- | --- | --- | --- |
| 1 Icons 6.3.4 | `__tests__/icons-version.test.ts` | `package.json`, `pnpm-lock.yaml` | — |
| 2 `lib/http` | `lib/http/{errors,response,parse,browser}.ts`, `__tests__/http-{errors,parse}.test.ts` | `lib/dify/{errors,schemas,route,browser}.ts`, `lib/action-{failure,result}.ts`, the import sites, locales | `lib/dify/response.ts` |
| 3 The move | — | `lib/dify/` → `lib/providers/dify/`, every import of it | — |
| 4 Annotations | — | Dify client, browser, schemas, route; admin and chat components; stub; locales; `e2e/screenshots.spec.ts` (the annotations shot), `lib/auth/roles.ts` (a comment) | the two annotation routes, `types/annotations.ts`, three admin components, `annotation-drawer.tsx` |
| 5 Neutral wording | — | `components/admin/users/user-management.{tsx,module.css}`, locales, `__tests__/i18n-locales.test.ts`, `e2e/admin-users.spec.ts` | — |
| 6 Ids and documents | `lib/providers/{ids,schemas}.ts`, `lib/providers/dify/schema.ts`, `__tests__/provider-schemas.test.ts` | — | — |
| 7 Registry and test | `lib/providers/{connection,registry}.ts`, `lib/providers/dify/{test-connection,provider}.ts`, two tests | `lib/providers/dify/client.ts` | — |
| 8 Icon kind | `lib/settings/image-rules.ts` | `lib/settings/{images,branding-rules,branding}.ts`, `branding-settings.tsx` | — |
| 9 Route guard | `lib/providers/route.ts`, `__tests__/provider-route.test.ts` | `lib/providers/dify/route.ts`, `lib/data/apps.ts` | — |
| 10 User side | `components/provider-ui/{registry,provider-chat}.tsx`, `__tests__/provider-ui.test.ts` | `lib/data/apps.ts`, gallery, chat page, workspace, locales, `e2e/screenshots.spec.ts` (four readiness waits); `app-modes.ts` → `components/provider-ui/dify/app-types.ts` | `components/apps/app-summary.ts` |
| 11 Table, DAL, actions | three migrations, `__tests__/{apps-schema,db-apps-migrations,data-apps-reads}.test.ts`, `__tests__/db/{apps-migration,apps}.db.test.ts` | `db/schema/apps.ts`, `lib/data/apps.ts`, `app/(admin)/app-management/{actions,schemas}.ts`, `components/admin/apps/*`, `api-base-rule.ts` → `components/provider-ui/dify/`, locales (the sync keys), e2e seeds | `__tests__/data-apps-sync.test.ts` |
| 12 Drawer, layout B | `components/admin/apps/{required-mark,icon-field,connection-test}.tsx`, `connection-outcome.ts`, `components/provider-ui/{provider-form-section.tsx,dify/form-section.tsx}` | `app-form-drawer.tsx`, `app-common-fields.tsx` (renamed), `app-management.tsx` (`tagOptions`), `components/provider-ui/registry.tsx` (`typeName`), locales, stub, `e2e/admin-apps.spec.ts`; test `__tests__/connection-outcome.test.ts` | `app-settings-fields.tsx` (renamed) |
| 13 Table | `__tests__/provider-boundary.test.ts` | `components/provider-ui/registry.tsx`, `app-management.tsx`, locales, `e2e/admin-apps.spec.ts` | — |
| 14 Records | ADR-0032 | ADR index, ADR-0023/0026/0027/0030, `docs/{frontend-conventions,auth-gate}.md`, `.cii-assessment.md` | — |
| 15 Gates | — | — (Step 16 accepts ADR-0032 on the owner's word; outside the repo, Step 9's backup and the `part0` image tag) | — |

---

### Task 1: `@ant-design/icons` 6.3.4, one copy in the tree

**Goal:** The hub depends on @ant-design/icons 6.3.4 so that one copy is installed and shared with antd and Ant Design X.

Spec §8 and decision 28. antd 6.6.5 depends on `^6.3.4` and Ant Design X 2.9.0 on `^6.0.0`, while the hub's own imports resolve 5.6.1, so both majors ship. antd's v5 → v6 migration guide (`antd migrate 5 6 --format json`, the "Global" item): "@ant-design/icons must be upgraded to v6. Icons v6 is not compatible with antd v5."

**Files:**

- Create: `__tests__/icons-version.test.ts`
- Modify: `package.json` (line 27 `"@ant-design/icons": "^5.6.1"`), `pnpm-lock.yaml` (by pnpm)

**Acceptance Criteria:**

- [ ] `__tests__/icons-version.test.ts` exists, and before the bump its two cases fail (Step 2: 2 failed).
- [ ] After the bump, `pnpm exec vitest run --project unit __tests__/icons-version.test.ts` reports 2 passed: 'resolves to the copy antd uses' and 'resolves to the copy Ant Design X uses'.
- [ ] `package.json` line 27 reads `"@ant-design/icons": "^6.3.4",`.
- [ ] `pnpm why @ant-design/icons` shows one version, `@ant-design/icons@6.3.4`, with no 'Found 2 versions'.
- [ ] The Step 4 script prints `sources [ '@ant-design/icons' ] count 52 missing []`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` prints nothing from tsc and every unit test passes.

**Verify:** `pnpm exec vitest run --project unit __tests__/icons-version.test.ts && pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm exec oxlint __tests__/icons-version.test.ts && pnpm exec oxfmt --check __tests__/icons-version.test.ts` → 2 passed; tsc prints nothing; all unit tests pass; no lint or format findings

**Interfaces:**

- Consumes: nothing.
- Produces: `@ant-design/icons` `^6.3.4`, one copy (6.3.4). Tasks 10, 12 and 13 import `ApartmentOutlined`, `AppstoreOutlined`, `UploadOutlined`, `DeleteOutlined` from it.

- [ ] **Step 1: Write the failing test**

Create `__tests__/icons-version.test.ts`:

```ts
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * Spec §8: the hub's icons are the copy antd and Ant Design X use, so one major ships (antd's v5 → v6 migration guide:
 * "@ant-design/icons must be upgraded to v6"). Node's `createRequire` resolves a package as the named file's
 * directory would, so the same resolved path means the same installed copy (pnpm keeps one directory per version).
 */
const fromRoot = createRequire(path.resolve('package.json'))
const resolvedFrom = (pkg: string) =>
	createRequire(fromRoot.resolve(pkg)).resolve('@ant-design/icons')

describe('@ant-design/icons', () => {
	it('resolves to the copy antd uses', () => {
		expect(fromRoot.resolve('@ant-design/icons')).toBe(resolvedFrom('antd'))
	})

	it('resolves to the copy Ant Design X uses', () => {
		expect(fromRoot.resolve('@ant-design/icons')).toBe(resolvedFrom('@ant-design/x'))
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/icons-version.test.ts` Expected: 2 failed. Each message shows the root's path under `@ant-design+icons@5.6.1_…` against antd's or X's under `@ant-design+icons@6.3.4_…`.

- [ ] **Step 3: Read the changelog from 5.6.1 to 6.3.4**

The icons repository publishes no release notes; its commit log on the React package is the changelog.

Run: `gh api "repos/ant-design/ant-design-icons/commits?path=packages/icons-react&since=2024-12-01T00:00:00Z&per_page=60" --jq '.[] | "\(.sha[0:8]) \(.commit.author.date[0:10]) \(.commit.message | split("\n")[0])"'` Expected (read on 2026-10-12 while planning): from `d694b4a6 feat: support layer (#681)` (6.0.0) to `7f2516ac fix: require matching icons-svg release (#770)` (6.3.4). What touches this code:

- `feat: support layer (#681)`, `fix: layer order (#683)`: the icon styles go into a CSS `@layer`, as antd 6's own do; the hub already renders antd 6 with these icons inside X and antd.
- `fix(icons-react): center loading icon … (#717)`: `LoadingOutlined` with `spin` is centred differently; the hub uses it in the chat (`components/chat/**`), a visual detail only.
- `feat: update package.json exports … (#720)`, `fix: add ./lib and ./es entries to exports field (#733)`, `fix: add node.import wrapper … (#719)`, `fix: make ESM wrapper interop-agnostic for Turbopack SSR (#730)`, `fix(react): use ESM icon definitions in ESM build (#768)`: packaging; the hub imports named icons from the package root only (Step 4).
- Brand icons added (#739, #738, #755) and `zeroRuntime` (#715): new features, unused here.
- `fix: color should be svg property (#498)`, the wider ref type (#741) and the guard on invalid icon definitions (#762): no effect here (no icon in the hub takes `color` or `twoToneColor`, and tsc runs after the bump).
- Nothing renames or removes an icon or a prop the code uses.

- [ ] **Step 4: Confirm every icon the code imports exists in 6.3.4**

Run:

```bash
node -e '
const { execSync } = require("child_process"); const fs = require("fs")
const files = execSync("git grep -l @ant-design/icons -- \"*.ts\" \"*.tsx\"").toString().trim().split("\n")
const names = new Set(), sources = new Set()
for (const f of files) {
  const s = fs.readFileSync(f, "utf8")
  for (const m of s.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["\x27](@ant-design\/icons[^"\x27]*)["\x27]/g)) {
    sources.add(m[3])
    for (const n of m[2].split(",").map(x => x.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "")).filter(Boolean)) names.add(n)
  }
}
const v6 = require("./node_modules/.pnpm/@ant-design+icons@6.3.4_react-dom@19.2.6_react@19.2.6__react@19.2.6/node_modules/@ant-design/icons")
console.log("sources", [...sources], "count", names.size, "missing", [...names].filter(n => !(n in v6)))'
```

Expected: `sources [ '@ant-design/icons' ] count 52 missing []` (measured while planning). The count may differ by the time the task runs only if an earlier task changed an icon import (none does); `missing []` is what matters.

- [ ] **Step 5: Bump the dependency**

Run: `pnpm add @ant-design/icons@^6.3.4` Expected: `package.json` line 27 reads `"@ant-design/icons": "^6.3.4",`; `pnpm-lock.yaml` changes.

Run: `pnpm why @ant-design/icons` Expected: one version, `@ant-design/icons@6.3.4`, used by `ai-app-hub`, `antd`, `@ant-design/x` and `@ant-design/nextjs-registry` (no "Found 2 versions").

- [ ] **Step 6: Run the test and the gates**

Run: `pnpm exec vitest run --project unit __tests__/icons-version.test.ts` Expected: 2 passed.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; every unit test passes (the run decides the count: the base's count plus 2).

Run: `pnpm exec oxlint __tests__/icons-version.test.ts && pnpm exec oxfmt --check __tests__/icons-version.test.ts` Expected: no findings.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml __tests__/icons-version.test.ts
git commit -m "chore(deps): update @ant-design/icons to 6.3.4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 2: The envelope and the request helpers under neutral names (`lib/http`)

**Goal:** The error envelope, the no-store JSON answer, the parse helpers and the browser request error live in neutral lib/http modules, with a ProviderError base class and the action code provider_unreachable.

Spec §3 (`lib/http/`) and §7. The envelope, the no-store JSON answer, the `parse*` helpers and the browser's request error leave `lib/dify` under neutral names: `errorResponse` (was `difyErrorResponse`), `forbiddenResponse`, `errorResponseFrom`, `jsonNoStore` (was `difyJson`), `ErrorBody`/`isErrorBody` (were `DifyErrorBody`/`isDifyErrorBody`), `parseJsonBody`, `parseQuery`, `parsePathParams`, `parseFilePart`, and `RequestError`/`readRequestError` (were `DifyRequestError`/`readDifyError`). A new base class, `ProviderError`, lets `errorResponseFrom` and `toActionFailure` answer a provider's error without importing the provider (Plan decision r). The action code `dify_unreachable` becomes `provider_unreachable` (spec §7). Nothing changes in behaviour.

**Files:**

- Create: `lib/http/errors.ts`, `lib/http/response.ts`, `lib/http/parse.ts`, `lib/http/browser.ts`, `__tests__/http-errors.test.ts`, `__tests__/http-parse.test.ts`
- Rename: `__tests__/dify-response.test.ts` → `__tests__/http-response.test.ts`
- Delete: `lib/dify/response.ts`
- Modify: `lib/dify/{errors,schemas,route,browser}.ts`, `lib/action-failure.ts`, `lib/action-result.ts`, `lib/data/db-errors.ts` (a comment), `components/admin/apps/app-errors.ts`, `components/chat/provider/dify-fetch.ts`, `locales/{en,zh,ar}/translation.json`, `e2e/admin-apps.spec.ts`, `__tests__/{dify-errors,dify-schemas}.test.ts`; and, by the rename script in Step 8, every other file that names the old helpers: `app/api/dify/[appId]/**/route.ts` (the 25 files), `app/api/apps/[appId]/icon/route.ts`, `app/api/branding/{logo,favicon}/route.ts`, `app/api/directory/groups/route.ts`, `lib/settings/image-response.ts`, `components/admin/groups/directory-group-select.tsx`, `components/chat/**` (the `DifyRequestError` mentions), `__tests__/{action-failure,app-errors,app-management-actions,user-errors,dify-browser,dify-fetch,chat-dify-errors,chat-use-dify-chat}.test.ts`

**Acceptance Criteria:**

- [ ] `__tests__/http-errors.test.ts`, `__tests__/http-parse.test.ts` and `__tests__/http-response.test.ts` exist; before `lib/http` is written they fail with 'Failed to resolve import "@/lib/http/errors"' (or `…/parse`, `…/response`).
- [ ] `lib/http/errors.ts`, `lib/http/response.ts`, `lib/http/parse.ts` and `lib/http/browser.ts` exist and `lib/dify/response.ts` is removed.
- [ ] `pnpm exec vitest run --project unit` over http-errors, http-parse, http-response, dify-errors, dify-schemas, action-failure, app-errors, dify-browser, dify-fetch, chat-dify-errors and i18n-locales passes for every file (Step 10).
- [ ] `git grep -nE "DifyRequestError|readDifyError|difyErrorResponse|difyJson|DifyErrorBody|isDifyErrorBody|dify_unreachable|lib/dify/response" -- ':!docs'` prints nothing.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` prints nothing.
- [ ] `pnpm test` passes (the moved cases plus the two new ones).

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') lib/http/*.ts __tests__/http-*.test.ts && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json') lib/http/*.ts __tests__/http-*.test.ts && pnpm test` → tsc prints nothing; no lint or format findings; all unit tests pass

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `lib/http/errors.ts` (server-only): `interface ErrorBody { code: string; message: string; status: number }`, `isErrorBody(value: unknown): value is ErrorBody`, `class ProviderError extends Error { readonly status: number; readonly code: string }` (constructor `(status, code, message)`), `errorResponse(code: string, message: string, status: number): Response`, `forbiddenResponse(): Response`, `errorResponseFrom(error: unknown, context: string): Response`.
  - `lib/http/response.ts` (server-only): `jsonNoStore(body: unknown, init?: ResponseInit): Response`.
  - `lib/http/parse.ts` (server-only): `type Parsed<T>`, `pathSegment`, `parseJsonBody(request, schema)`, `parsePathParams(params, ...names)`, `parseQuery(searchParams, schema)`, `parseFilePart(request)` (signatures as today in `lib/dify/schemas.ts`).
  - `lib/http/browser.ts` (client-safe): `class RequestError extends Error { readonly status: number; readonly code: string | undefined }`, `readRequestError(response: Response): Promise<RequestError>`.
  - `lib/dify/errors.ts`: `class DifyError extends ProviderError` (name `'DifyError'`), `difyErrorFromResponse(response)`.
  - `lib/dify/route.ts` re-exports `errorResponseFrom`, `forbiddenResponse` and `jsonNoStore` (the Dify routes keep one import line for them).
  - `ActionErrorCode` has `'provider_unreachable'` in place of `'dify_unreachable'`; i18n key `admin_apps.provider_unreachable`.

- [ ] **Step 1: Write the neutral error tests**

Create `__tests__/http-errors.test.ts`. Its cases are the neutral half of `__tests__/dify-errors.test.ts` (moved in Step 6, with the new names) plus one new case for `ProviderError`:

```ts
import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '@/lib/auth/session'
import {
	errorResponse,
	errorResponseFrom,
	forbiddenResponse,
	isErrorBody,
	ProviderError,
} from '@/lib/http/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

describe('isErrorBody', () => {
	it('accepts the envelope and nothing else', () => {
		expect(isErrorBody({ code: 'not_found', message: 'Nope', status: 404 })).toBe(true)
		expect(isErrorBody({ code: 'not_found', message: 'Nope' })).toBe(false)
		expect(isErrorBody({ error: 'x' })).toBe(false)
		expect(isErrorBody('nope')).toBe(false)
		expect(isErrorBody(null)).toBe(false)
	})
})

describe('errorResponse and errorResponseFrom', () => {
	it('answers the envelope with the status', async () => {
		const response = errorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({
			code: 'app_not_found',
			message: 'No such app.',
			status: 404,
		})
	})
	// Part 1 spec §11: the neutral answer reads any provider's error without importing the provider.
	it('turns a ProviderError into its envelope', async () => {
		const response = errorResponseFrom(
			new ProviderError(429, 'too_many_requests', 'Slow down'),
			'test',
		)
		expect(response.status).toBe(429)
		await expect(response.json()).resolves.toEqual({
			code: 'too_many_requests',
			message: 'Slow down',
			status: 429,
		})
	})
	it('turns an AuthError into 401 or 403', async () => {
		expect(errorResponseFrom(new AuthError('unauthorized'), 'test').status).toBe(401)
		expect(errorResponseFrom(new AuthError('forbidden'), 'test').status).toBe(403)
	})
	// One definition of the role refusal (charter §4.2): the routes' own check and a thrown AuthError answer alike.
	it("answers an AuthError('forbidden') exactly as forbiddenResponse()", async () => {
		const thrown = errorResponseFrom(new AuthError('forbidden'), 'test')
		const direct = forbiddenResponse()
		expect(thrown.status).toBe(direct.status)
		expect(await thrown.json()).toEqual(await direct.json())
	})
	it('logs anything else and answers 500 internal_error without the message', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const response = errorResponseFrom(new Error('secret detail'), 'POST chat')
		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(spy).toHaveBeenCalledWith('POST chat:', expect.any(Error))
		spy.mockRestore()
	})

	// Part 0 spec §3.4: a DrizzleQueryError carries the SQL and its params, which are never logged; a database that does
	// not answer (the access lookup inside the route guard) is logged by its name and code only.
	it('logs a failed query by its name and code on the 500 path, never its SQL, parameters or address', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		const failed = new DrizzleQueryError(
			'select "access_mode" from "apps" where "apps"."id" = $1 limit $2',
			['6a3f0c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b', 1],
			refused,
		)
		const response = errorResponseFrom(failed, 'GET /api/dify/[appId]/parameters')
		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(spy).toHaveBeenCalledWith('GET /api/dify/[appId]/parameters:', {
			name: 'DrizzleQueryError',
			code: 'ECONNREFUSED',
		})
		const logged = JSON.stringify(spy.mock.calls)
		for (const value of [
			'6a3f0c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b',
			'127.0.0.1',
			'select',
			'access_mode',
		])
			expect(logged).not.toContain(value)
		spy.mockRestore()
	})

	// Part 0 spec §3.2's safety net: an id that reached a uuid column unchecked answers as an unknown app, never a 500,
	// and is logged by its code only (the message quotes the id).
	it('answers a malformed id (22P02) as app_not_found', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const malformed = new DrizzleQueryError(
			'select "id" from "apps" where "apps"."id" = $1 limit $2',
			['abc', 1],
			Object.assign(new DatabaseError('invalid input syntax for type uuid: "abc"', 0, 'error'), {
				code: '22P02',
			}),
		)
		const response = errorResponseFrom(malformed, 'GET /api/dify/[appId]/parameters')
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({
			code: 'app_not_found',
			message: 'No such app.',
			status: 404,
		})
		expect(spy).toHaveBeenCalledWith('GET /api/dify/[appId]/parameters:', {
			name: 'DrizzleQueryError',
			code: '22P02',
		})
		expect(JSON.stringify(spy.mock.calls)).not.toContain('abc')
		spy.mockRestore()
	})
})
```

- [ ] **Step 2: Move the parse helpers' tests**

Create `__tests__/http-parse.test.ts` with this header:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { parseFilePart, parsePathParams } from '@/lib/http/parse'

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
```

Then move lines 212–326 of `__tests__/dify-schemas.test.ts` (from `// Review Focus 2` to the end of the file: `describe('parseFilePart', …)` and `describe('parsePathParams', …)`, unchanged) below that header, one blank line after `const UUID …`. Delete line 211 of `dify-schemas.test.ts` (the blank line before the moved block), so the file ends with the closing `})` of `describe('body schemas', …)` at line 210 and one newline. Do the move first: the line numbers are those before this step.

Then, in `__tests__/dify-schemas.test.ts`, replace the import block (lines 5–23):

```ts
import {
	annotationBody,
	annotationsQuery,
	chatMessagesBody,
	completionBody,
	conversationsQuery,
	feedbackBody,
	filePreviewQuery,
	humanInputBody,
	messagesQuery,
	parseFilePart,
	parseJsonBody,
	parsePathParams,
	parseQuery,
	renameConversationBody,
	textToAudioBody,
	workflowEventsQuery,
	workflowRunBody,
} from '@/lib/dify/schemas'
```

with:

```ts
import {
	annotationBody,
	annotationsQuery,
	chatMessagesBody,
	completionBody,
	conversationsQuery,
	feedbackBody,
	filePreviewQuery,
	humanInputBody,
	messagesQuery,
	renameConversationBody,
	textToAudioBody,
	workflowEventsQuery,
	workflowRunBody,
} from '@/lib/dify/schemas'
import { parseJsonBody, parseQuery } from '@/lib/http/parse'
```

- [ ] **Step 3: Move the no-store test**

Run: `git mv __tests__/dify-response.test.ts __tests__/http-response.test.ts`

In `__tests__/http-response.test.ts`, replace lines 8–27:

```ts
import { difyErrorResponse } from '@/lib/dify/errors'
import { difyJson } from '@/lib/dify/response'

// Next adds no Cache-Control to a dynamic Route Handler's answer (its app-route handler sends the handler's own
// headers only), so every JSON answer of /api/dify says itself that no cache may store it (ADR-0023).
describe('difyJson', () => {
	it('answers JSON with private, no-store, keeping the status and the other headers', async () => {
		const response = difyJson({ ok: true }, { status: 201, headers: { 'x-extra': '1' } })
		expect(response.status).toBe(201)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(response.headers.get('content-type')).toBe('application/json')
		expect(response.headers.get('x-extra')).toBe('1')
		await expect(response.json()).resolves.toEqual({ ok: true })
	})
	it('carries no-store on the envelope too', () => {
		const response = difyErrorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
	})
})
```

with:

```ts
import { errorResponse } from '@/lib/http/errors'
import { jsonNoStore } from '@/lib/http/response'

// Next adds no Cache-Control to a dynamic Route Handler's answer (its app-route handler sends the handler's own
// headers only), so every JSON answer of the hub's routes says itself that no cache may store it (ADR-0023).
describe('jsonNoStore', () => {
	it('answers JSON with private, no-store, keeping the status and the other headers', async () => {
		const response = jsonNoStore({ ok: true }, { status: 201, headers: { 'x-extra': '1' } })
		expect(response.status).toBe(201)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		expect(response.headers.get('content-type')).toBe('application/json')
		expect(response.headers.get('x-extra')).toBe('1')
		await expect(response.json()).resolves.toEqual({ ok: true })
	})
	it('carries no-store on the envelope too', () => {
		const response = errorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
	})
})
```

and in the same file replace `'%s answers JSON through difyJson only',` with `'%s answers JSON through jsonNoStore only',`.

- [ ] **Step 4: Run the three files to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/http-errors.test.ts __tests__/http-parse.test.ts __tests__/http-response.test.ts` Expected: FAIL, all three files, with "Failed to resolve import "@/lib/http/errors"" (or `…/parse`, `…/response`).

- [ ] **Step 5: Write `lib/http`**

Create `lib/http/response.ts`:

```ts
import 'server-only'

/**
 * `Response.json` for every JSON answer of the hub's Route Handlers, the envelopes included: one user's data behind the
 * session cookie, with `Cache-Control: private, no-store`. Next adds no Cache-Control to a dynamic Route Handler's
 * answer (its app-route handler sends the handler's own headers), and without one a cache may store an answer
 * heuristically (MDN Cache-Control, "Up-to-date contents always"); `no-store` keeps it out of every cache (ADR-0023).
 */
export const jsonNoStore = (body: unknown, init: ResponseInit = {}): Response => {
	const headers = new Headers(init.headers)
	headers.set('cache-control', 'private, no-store')
	return Response.json(body, { ...init, headers })
}
```

Create `lib/http/errors.ts`:

```ts
import 'server-only'

import { AuthError } from '@/lib/auth/session'
import { isInvalidTextRepresentation } from '@/lib/data/db-errors'
import { logActionError } from '@/lib/error-log'

import { jsonNoStore } from './response'

/** The hub's error envelope: Dify's own shape (endpoint map §4), which every route of the hub answers (ADR-0023). */
export interface ErrorBody {
	code: string
	message: string
	status: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const isErrorBody = (value: unknown): value is ErrorBody =>
	isRecord(value) &&
	typeof value.code === 'string' &&
	typeof value.message === 'string' &&
	typeof value.status === 'number'

/**
 * A provider's refusal or failure as the envelope a route answers (Part 1 spec §3): each provider's server client throws
 * its own subclass (DifyError), and the neutral answers here and in lib/action-failure.ts read any of them without
 * importing the provider (spec §11).
 */
export class ProviderError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message)
		this.name = 'ProviderError'
	}
}

/** The hub's own refusal in the envelope (no-store, like every JSON answer of its routes). */
export const errorResponse = (code: string, message: string, status: number): Response =>
	jsonNoStore({ code, message, status } satisfies ErrorBody, { status })

/**
 * The refusal of a signed-in caller whose role does not allow the operation (charter §4.2): the one definition, which a
 * route's own role check and errorResponseFrom's AuthError('forbidden') both answer.
 */
export const forbiddenResponse = (): Response => errorResponse('forbidden', 'Not allowed.', 403)

/**
 * What a route answers for an exception: a ProviderError's envelope (the provider's, or its client's
 * upstream_unreachable), an AuthError's 401/403, a value its column's type cannot read (22P02), in practice a malformed
 * id that reached a `uuid` column unchecked, as an unknown app (Part 0 spec §3.2's safety net: a 404, never a 500; logged
 * by its code, lib/error-log.ts, since the message quotes the id), else a logged 500 whose body carries no detail
 * (Backend for Frontend guide: no sensitive information in error messages).
 */
export const errorResponseFrom = (error: unknown, context: string): Response => {
	if (error instanceof ProviderError) return errorResponse(error.code, error.message, error.status)
	if (error instanceof AuthError) {
		return error.code === 'forbidden'
			? forbiddenResponse()
			: errorResponse('unauthorized', 'Sign in required.', 401)
	}
	if (isInvalidTextRepresentation(error)) {
		logActionError(error, context)
		return errorResponse('app_not_found', 'No such app.', 404)
	}
	logActionError(error, context)
	return errorResponse('internal_error', 'Internal Server Error', 500)
}
```

`DifyError`'s `toBody()` is not carried over: nothing calls it (`git grep -n toBody -- app lib components __tests__` finds only its definition).

Create `lib/http/parse.ts` from the helpers at the top and bottom of `lib/dify/schemas.ts`, renamed to the neutral envelope:

```ts
import 'server-only'

import * as z from 'zod'

import { errorResponse } from './errors'

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }

/** `400 invalid_param` naming the paths that failed (charter §4.5), in the hub's envelope. */
const invalid = (issues: z.core.$ZodIssue[]): Parsed<never> => {
	const paths = [...new Set(issues.map(issue => issue.path.map(String).join('.') || 'body'))]
	return {
		ok: false,
		response: errorResponse('invalid_param', `Invalid request: ${paths.join(', ')}`, 400),
	}
}

/**
 * A dynamic path segment forwarded to a provider (task id, message id, conversation id, file id, form token): RFC 3986
 * unreserved characters, 1-256 long, never a bare `.` or `..` (fetch's URL parser collapses those, so encoding the
 * segment cannot stop `..` from rewriting the upstream path). Not UUID-strict on purpose: the e2e stub's
 * message-file ids (`file-<uuid>`) and form tokens (`ft-<uuid>`) are not UUIDs, and the map does not define the
 * form-token format.
 */
export const pathSegment = z.string().regex(/^(?!\.{1,2}$)[A-Za-z0-9._~-]{1,256}$/)

/** The JSON body against a schema; a body that is not JSON is `invalid_param` too. */
export const parseJsonBody = async <S extends z.ZodType>(
	request: Request,
	schema: S,
): Promise<Parsed<z.infer<S>>> => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return {
			ok: false,
			response: errorResponse('invalid_param', 'Request body is not valid JSON.', 400),
		}
	}
	const result = schema.safeParse(raw)
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
}

/**
 * A route's extra dynamic segments (everything but `appId`, which the route guard has checked) against `pathSegment`.
 * Run it right after the guard, before the body or any client call. Answers `400 invalid_param` naming each param that
 * failed; on success `data` carries just the named params:
 * `const segments = await parsePathParams(ctx.params, 'taskId')`.
 */
export const parsePathParams = async <P extends Record<string, string>, K extends keyof P & string>(
	params: Promise<P>,
	...names: K[]
): Promise<Parsed<Pick<P, K>>> => {
	const schema = z.object(Object.fromEntries(names.map(name => [name, pathSegment])))
	const result = schema.safeParse(await params)
	return result.success
		? { ok: true, data: result.data as Pick<P, K> }
		: invalid(result.error.issues)
}

/** The query string against a schema (every value arrives as a string; the schemas coerce). */
export const parseQuery = <S extends z.ZodType>(
	searchParams: URLSearchParams,
	schema: S,
): Parsed<z.infer<S>> => {
	const result = schema.safeParse(Object.fromEntries(searchParams))
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
}

/**
 * Exactly one non-empty `file` part with a name (Dify: one part, filename required; Review Focus 2 of the B1 plan).
 * Other parts (a client-sent `user`) are dropped: the route builds its own form for the provider.
 */
export const parseFilePart = async (request: Request): Promise<Parsed<File>> => {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected a multipart body with one file part.',
				400,
			),
		}
	}
	const files = form.getAll('file')
	const file = files[0]
	if (files.length !== 1 || !(file instanceof File) || !file.name || file.size === 0) {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected exactly one non-empty file part named file.',
				400,
			),
		}
	}
	return { ok: true, data: file }
}
```

Create `lib/http/browser.ts`:

```ts
// Client-safe: no server-only import. The browser's reading of a refusal from any of the hub's routes (charter §4.5):
// the provider clients and the admin pages reject with RequestError, so every caller keeps one parser.

/** The envelope (`{ code, message, status }`) as a thrown error; `code` is undefined for a body of another shape. */
export class RequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | undefined,
		message: string,
	) {
		super(message)
		this.name = 'RequestError'
	}
}

/**
 * Reads a non-OK answer. An empty or non-JSON body (a proxy page, Next's empty 500) keeps no message, never the
 * status text: nothing user-facing is English from the wire, the view shows its own i18n text (charter §4.5).
 */
export const readRequestError = async (response: Response): Promise<RequestError> => {
	let body: { code?: unknown; message?: unknown } | null = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return new RequestError(
		response.status,
		typeof body?.code === 'string' ? body.code : undefined,
		typeof body?.message === 'string' ? body.message : '',
	)
}
```

- [ ] **Step 6: Point `lib/dify` at `lib/http`**

Run: `git rm lib/dify/response.ts`

Replace the whole of `lib/dify/errors.ts` with:

```ts
import 'server-only'

import { isErrorBody, ProviderError } from '@/lib/http/errors'

/** Dify's refusal in the hub's envelope (endpoint map §4); errorResponseFrom answers it as any ProviderError. */
export class DifyError extends ProviderError {
	constructor(status: number, code: string, message: string) {
		super(status, code, message)
		this.name = 'DifyError'
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A non-OK upstream answer as a DifyError: Dify's code and message when the body is its envelope (the HTTP
 * status is authoritative), `upstream_error` with the status otherwise — an HTML page from a reverse proxy, an
 * empty body, a JSON body of another shape (Review Focus 1 of the B1 plan).
 */
export const difyErrorFromResponse = async (response: Response): Promise<DifyError> => {
	let body: unknown = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	if (isErrorBody(body)) return new DifyError(response.status, body.code, body.message)
	const message =
		isRecord(body) && typeof body.message === 'string'
			? body.message
			: `Dify answered ${response.status}`
	return new DifyError(response.status, 'upstream_error', message)
}
```

In `lib/dify/schemas.ts`, delete, from the bottom up so the numbers hold (they are those before this step), lines 162–238 (from `/** The JSON body against a schema; …` to the end of `parseFilePart`), lines 19–26 (the `pathSegment` comment and constant), lines 9–16 (the `invalid` helper and its comment) and lines 5–7 (`import { difyErrorResponse } from './errors'`, the blank line, `export type Parsed<T> = …`). The file keeps `import 'server-only'`, `import * as z from 'zod'`, the schemas (from `const uuid = z.uuid()` to `remoteFileQuery`) and the `export type … = z.infer<…>` lines, and ends after `export type AnnotationBody = z.infer<typeof annotationBody>` with one newline.

In `lib/dify/route.ts`, replace lines 1–12:

```ts
import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'
import { isId } from '@/lib/ids'

import { difyClient, type DifyClient } from './client'
import { difyErrorResponse, errorResponseFrom, forbiddenResponse } from './errors'

// A route checks the role right after the app (session → app → role → input) and answers forbiddenResponse().
export { errorResponseFrom, forbiddenResponse }
export { difyJson } from './response'
```

with:

```ts
import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess } from '@/lib/data/apps'
import { errorResponse, errorResponseFrom, forbiddenResponse } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

import { difyClient, type DifyClient } from './client'

// A route checks the role right after the app (session → app → role → input) and answers forbiddenResponse().
export { errorResponseFrom, forbiddenResponse }
export { jsonNoStore } from '@/lib/http/response'
```

and in the same file replace each `difyErrorResponse(` with `errorResponse(` (three places, lines 42, 46 and 50 before this step).

In `lib/dify/browser.ts`, replace lines 1–55 (the two comment lines, the type import, the `DifyRequestError` class and `readDifyError`) with:

```ts
// Client-safe: no server-only import. The browser's one way to the Dify routes (charter §4.1): every JSON
// method resolves the typed body and rejects with RequestError (lib/http/browser.ts) on a non-OK answer, so the chat
// keeps one parser.
import { readRequestError } from '@/lib/http/browser'

import type {
	AnnotationInput,
	AnnotationItem,
	AnnotationsPage,
	AnnotationsQuery,
	AppParameters,
	CompletionRequest,
	ConversationItem,
	ConversationsPage,
	ConversationsQuery,
	FeedbackRequest,
	FileUploadResponse,
	HumanInputForm,
	HumanInputSubmission,
	MessagesPage,
	MessagesQuery,
	RenameConversationRequest,
	SiteSettings,
	StopResponse,
	SuggestedQuestionsResponse,
	TextToAudioRequest,
	WorkflowRunRequest,
} from './types'
```

and in the same file replace `if (!response.ok) throw await readDifyError(response)` with `if (!response.ok) throw await readRequestError(response)`.

- [ ] **Step 7: Keep the Dify half of the error tests**

In `__tests__/dify-errors.test.ts`, first delete lines 61–165 (the blank line and the whole `describe('difyErrorResponse and errorResponseFrom', …)`, moved to `__tests__/http-errors.test.ts` in Step 1), so the file ends with the closing `})` of `describe('difyErrorFromResponse', …)` at line 60 and one newline. Then replace lines 1–28 (the imports, the mock, `jsonResponse` and `describe('isDifyErrorBody', …)`):

```ts
import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '@/lib/auth/session'
import {
	DifyError,
	difyErrorFromResponse,
	difyErrorResponse,
	errorResponseFrom,
	forbiddenResponse,
	isDifyErrorBody,
} from '@/lib/dify/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('isDifyErrorBody', () => {
	it('accepts Dify’s envelope and nothing else', () => {
		expect(isDifyErrorBody({ code: 'not_found', message: 'Nope', status: 404 })).toBe(true)
		expect(isDifyErrorBody({ code: 'not_found', message: 'Nope' })).toBe(false)
		expect(isDifyErrorBody({ error: 'x' })).toBe(false)
		expect(isDifyErrorBody('nope')).toBe(false)
		expect(isDifyErrorBody(null)).toBe(false)
	})
})
```

with:

```ts
import { describe, expect, it, vi } from 'vitest'

import { DifyError, difyErrorFromResponse } from '@/lib/dify/errors'
import { ProviderError } from '@/lib/http/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Part 1 spec §11: errorResponseFrom and toActionFailure answer a DifyError as the ProviderError it is.
describe('DifyError', () => {
	it('is a ProviderError named DifyError', () => {
		const error = new DifyError(401, 'unauthorized', 'bad key')
		expect(error).toBeInstanceOf(ProviderError)
		expect(error).toMatchObject({ name: 'DifyError', status: 401, code: 'unauthorized' })
	})
})
```

- [ ] **Step 8: Rename the helpers in every importer**

Run this script from the repository root. It renames the seven identifiers in the listed folders (word boundaries, so `toDifyError` and `useDifyChat` stay), then splits each one-line import from `@/lib/dify/{errors,schemas,browser}` outside `lib/dify` so the neutral names come from `lib/http`, and points `@/lib/dify/response` at `@/lib/http/response`:

```bash
node --input-type=module <<'JS'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const RENAMES = [
	['DifyRequestError', 'RequestError'],
	['readDifyError', 'readRequestError'],
	['difyErrorResponse', 'errorResponse'],
	['difyJson', 'jsonNoStore'],
	['isDifyErrorBody', 'isErrorBody'],
	['DifyErrorBody', 'ErrorBody'],
	['dify_unreachable', 'provider_unreachable'],
]
// Names that leave each Dify module for lib/http; every other name stays where it is.
const MOVED = {
	errors: { target: '@/lib/http/errors', names: new Set(['errorResponse', 'errorResponseFrom', 'forbiddenResponse', 'isErrorBody', 'ErrorBody']) },
	schemas: { target: '@/lib/http/parse', names: new Set(['Parsed', 'pathSegment', 'parseJsonBody', 'parsePathParams', 'parseQuery', 'parseFilePart']) },
	browser: { target: '@/lib/http/browser', names: new Set(['RequestError', 'readRequestError']) },
}
const files = execSync(
	`git grep -lE "DifyRequestError|readDifyError|difyErrorResponse|difyJson|DifyErrorBody|isDifyErrorBody|dify_unreachable|@/lib/dify/(errors|response|schemas|browser)'" -- app components hooks lib __tests__ e2e ':!lib/http'`,
)
	.toString()
	.trim()
	.split('\n')
for (const file of files) {
	let text = readFileSync(file, 'utf8')
	for (const [from, to] of RENAMES) text = text.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
	if (!file.startsWith('lib/dify/')) {
		text = text.replaceAll("from '@/lib/dify/response'", "from '@/lib/http/response'")
		text = text.replace(
			/^import (type )?\{ ([^}]+) \} from '@\/lib\/dify\/(errors|schemas|browser)'$/gm,
			(_all, typeOnly = '', list, module) => {
				const names = list.split(',').map(name => name.trim()).filter(Boolean)
				const moved = MOVED[module]
				const stay = names.filter(name => !moved.names.has(name.replace(/^type /, '')))
				const go = names.filter(name => moved.names.has(name.replace(/^type /, '')))
				return [
					stay.length ? `import ${typeOnly}{ ${stay.join(', ')} } from '@/lib/dify/${module}'` : null,
					go.length ? `import ${typeOnly}{ ${go.join(', ')} } from '${moved.target}'` : null,
				]
					.filter(Boolean)
					.join('\n')
			},
		)
	}
	writeFileSync(file, text)
	console.log(file)
}
JS
```

Expected: it prints each file it wrote; `git status --short` lists them as modified. The multi-line imports in `__tests__/dify-errors.test.ts` and `__tests__/dify-schemas.test.ts` were rewritten by hand in Steps 2 and 7 and match nothing here.

Then fix the re-export the script cannot split. In `components/chat/provider/dify-fetch.ts` the script has split line 3 into `import { createDifyApi } from '@/lib/dify/browser'` and `import { readRequestError } from '@/lib/http/browser'`; replace the two lines that follow `import type { DifyChatInput, DifyChatMessage } from './message'` and its blank line:

```ts
// The chat's importers keep these names; the classes live with the browser client (lib/dify/browser.ts).
export { RequestError, readRequestError } from '@/lib/dify/browser'
```

with:

```ts
// The chat's importers keep this import path; the class lives with the hub's request helpers (lib/http/browser.ts).
export { RequestError, readRequestError } from '@/lib/http/browser'
```

- [ ] **Step 9: The action code and its message**

In `lib/action-failure.ts`, replace line 8 `import { DifyError } from '@/lib/dify/errors'` with `import { ProviderError } from '@/lib/http/errors'`, and replace the comment and the first branch of `toActionFailure` (lines 15–28):

```ts
/**
 * An exception inside an action as its failure result (charter §4.5: two vocabularies on purpose; a DifyError
 * becomes provider_unreachable, never a raw envelope). A DifyError and an unexpected error are logged with their
 * context first, so a wrong key or a failing Dify leaves a trace on the server; the message of a DifyError never
 * carries the API key. An AuthError is an expected outcome and is not logged. A value its column's type cannot read
 * (22P02), in practice a malformed id that reached a `uuid` column unchecked, answers not_found, as an unknown id does
 * (spec §3.2's safety net); its log line names the action whose id check missed it.
 */
export const toActionFailure = (error: unknown, context: string): ActionFailure => {
	if (error instanceof AuthError) return fail(error.code)
	if (error instanceof DifyError) {
		console.error(`${context}:`, { status: error.status, code: error.code, message: error.message })
		return fail('provider_unreachable')
	}
```

with:

```ts
/**
 * An exception inside an action as its failure result (charter §4.5: two vocabularies on purpose; a provider's error
 * becomes provider_unreachable, never a raw envelope). A ProviderError (Dify's DifyError) and an unexpected error are
 * logged with their context first, so a wrong key or a failing provider leaves a trace on the server; a provider
 * error's message never carries the key. An AuthError is an expected outcome and is not logged. A value its column's
 * type cannot read (22P02), in practice a malformed id that reached a `uuid` column unchecked, answers not_found, as an
 * unknown id does (Part 0 spec §3.2's safety net); its log line names the action whose id check missed it.
 */
export const toActionFailure = (error: unknown, context: string): ActionFailure => {
	if (error instanceof AuthError) return fail(error.code)
	if (error instanceof ProviderError) {
		console.error(`${context}:`, { status: error.status, code: error.code, message: error.message })
		return fail('provider_unreachable')
	}
```

(The script already turned `dify_unreachable` into `provider_unreachable` in `lib/action-result.ts`, `components/admin/apps/app-errors.ts` and the tests; check with `git diff lib/action-result.ts components/admin/apps/app-errors.ts`.)

Change the message key in the three locale files:

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const EDITS = {
	en: { 'admin_apps.dify_unreachable': null, 'admin_apps.provider_unreachable': "Could not reach the app's provider. Check the connection settings." },
	zh: { 'admin_apps.dify_unreachable': null, 'admin_apps.provider_unreachable': '无法连接到应用的提供方，请检查连接设置。' },
	ar: { 'admin_apps.dify_unreachable': null, 'admin_apps.provider_unreachable': 'تعذّر الوصول إلى مزوّد التطبيق. تحقّق من إعدادات الاتصال.' },
}
// A dotted path is set, or deleted when its value is null; JSON.stringify with a tab keeps the files' own format.
for (const [language, edits] of Object.entries(EDITS)) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	for (const [path, value] of Object.entries(edits)) {
		const keys = path.split('.')
		const last = keys.pop()
		const node = keys.reduce((parent, key) => (parent[key] ??= {}), tree)
		if (value === null) delete node[last]
		else node[last] = value
	}
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

In `lib/data/db-errors.ts`, line 53, the comment names where the 22P02 safety net lives: replace `(lib/action-failure.ts, lib/dify/errors.ts)` with `(lib/action-failure.ts, lib/http/errors.ts)`.

In `e2e/admin-apps.spec.ts`, replace line 168 `page.getByText('Could not reach the Dify app. Check the API Base and API Secret.'),` with `page.getByText("Could not reach the app's provider. Check the connection settings."),`.

- [ ] **Step 10: Run the moved and touched tests**

Run: `pnpm exec vitest run --project unit __tests__/http-errors.test.ts __tests__/http-parse.test.ts __tests__/http-response.test.ts __tests__/dify-errors.test.ts __tests__/dify-schemas.test.ts __tests__/action-failure.test.ts __tests__/app-errors.test.ts __tests__/dify-browser.test.ts __tests__/dify-fetch.test.ts __tests__/chat-dify-errors.test.ts __tests__/i18n-locales.test.ts` Expected: PASS, every file.

- [ ] **Step 11: Check that no old name is left, then run the gates**

Run: `git grep -nE "DifyRequestError|readDifyError|difyErrorResponse|difyJson|DifyErrorBody|isDifyErrorBody|dify_unreachable|lib/dify/response" -- ':!docs'` Expected: no output (since PR #56, `CLAUDE.md` names none of these).

Run: `pnpm exec oxfmt $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json') lib/http/*.ts __tests__/http-*.test.ts` Expected: the files are written; the split imports are sorted into place.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') lib/http/*.ts __tests__/http-*.test.ts && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json') lib/http/*.ts __tests__/http-*.test.ts` Expected: no findings.

Run: `pnpm test` Expected: PASS (the run decides the count: the cases moved, plus the two new ones).

- [ ] **Step 12: Commit**

```bash
git add lib/http lib/dify app components hooks __tests__ e2e/admin-apps.spec.ts locales lib/action-failure.ts lib/action-result.ts lib/data/db-errors.ts lib/settings/image-response.ts
git status --short
git commit -m "refactor(http): move the envelope and request helpers out of lib/dify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

`git status --short` before the commit must show no unstaged or untracked file of this task (only `tmp/` and the owner's untracked handoff, which stay out).

---

### Task 3: `lib/dify` moves to `lib/providers/dify`

**Goal:** The Dify client, types, schemas, remote-file guard and browser client sit under lib/providers/dify with every import path updated and no name changed.

Spec §3 and §7: the Dify client, types, request schemas, the remote-file guard and the browser client become the first provider module. The move changes paths only; every name stays (`difyClient`, `createDifyApi`, `resolveDifyRoute`, `DifyError`, …; spec §7: Dify-only code keeps the Dify name).

**Files:**

- Rename: `lib/dify/` → `lib/providers/dify/` (`browser.ts`, `client.ts`, `errors.ts`, `remote-file.ts`, `route.ts`, `schemas.ts`, `types/{annotations,app,chat,events,files,human-input,index,workflow}.ts`)
- Modify (the path only, by the script in Step 3): every file that names `lib/dify/` — the 25 `app/api/dify/[appId]/**/route.ts`, `lib/data/apps.ts`, `app/(admin)/app-management/schemas.ts`, `components/admin/apps/{admin-app-row.ts,annotation-form-modal.tsx,annotations-panel.tsx}`, `components/apps/{app-icon.tsx,app-modes.ts,app-summary.ts}`, `components/chat/**`, `db/schema/apps.ts` (a comment), `e2e/malformed-ids.spec.ts` (a comment), and the `__tests__` files that import or mock `@/lib/dify/…`

**Acceptance Criteria:**

- [ ] `git mv lib/dify lib/providers/dify` shows the eight `types/` files and the six modules as renamed (`R  lib/dify/… -> lib/providers/dify/…`).
- [ ] Before the rewrite, `pnpm exec next typegen && pnpm exec tsc --noEmit 2>&1 | grep -c "Cannot find module '@/lib/dify/"` prints a positive count.
- [ ] `git grep -n "lib/dify/" -- ':!docs'` returns only `.cii-assessment.md` lines 59 and 60.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` prints nothing.
- [ ] `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the changed .ts/.tsx files report no findings.
- [ ] `pnpm test` passes with the same count as after Task 2.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') && pnpm test` → tsc prints nothing; no findings; PASS with the same test count as after Task 2

**Interfaces:**

- Consumes: Task 2's `lib/http/*` (unchanged here).
- Produces: the same exports as before, under `@/lib/providers/dify/{browser,client,errors,remote-file,route,schemas,types}`. Later tasks import from these paths only.

- [ ] **Step 1: Move the folder**

Run: `mkdir -p lib/providers && git mv lib/dify lib/providers/dify` Expected: `git status --short` shows the eight `types/` files and the six modules as renamed (`R  lib/dify/… -> lib/providers/dify/…`).

- [ ] **Step 2: See the importers fail**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit 2>&1 | grep -c "Cannot find module '@/lib/dify/"` Expected: a positive count (the run decides it): every import of the old path fails.

- [ ] **Step 3: Rewrite the paths**

Run: `git grep -lz "lib/dify/" -- app components hooks lib __tests__ e2e db | xargs -0 sed -i 's#lib/dify/#lib/providers/dify/#g'` Expected: no output. The substitution is idempotent (`lib/providers/dify/` does not contain `lib/dify/`), and it also updates the comments that name a file (`db/schema/apps.ts:18`, `e2e/malformed-ids.spec.ts:32`, the chat's "(lib/dify/browser.ts)" remarks).

Run: `git grep -n "lib/dify/" -- ':!docs'` Expected: only `.cii-assessment.md` lines 59 and 60; Task 14 rewrites them.

- [ ] **Step 4: Format and run the gates**

The new path sorts after `@/lib/ids` and the other `@/lib/…` modules, so oxfmt moves those import lines.

Run: `pnpm exec oxfmt $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx')` Expected: the files are written.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx')` Expected: no findings.

Run: `pnpm test` Expected: PASS, the same count as after Task 2 (no test is added or removed).

- [ ] **Step 5: Commit**

```bash
git add lib/providers app components hooks lib __tests__ e2e db
git status --short
git commit -m "refactor(providers): move lib/dify to lib/providers/dify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

`git status --short` before the commit shows nothing of this task left unstaged.

---

### Task 4: Annotations removed

**Goal:** The Dify annotation feature (routes, client and browser methods, admin drawer/panel/modal, chat annotate action, app switch, i18n keys, stub endpoints and their tests) is gone.

Spec §6 and decision 21 ("remove the annotations. I don't use that feature. that way all the options are the same"). The two Dify annotation routes, their client, browser and schema pieces, the admin drawer, panel and modal, the chat's annotate action and drawer, the app's annotation switch (`annotationEnabled` everywhere; the `enable_annotation` column itself is dropped by Task 11's migration and is no longer read or written from here on), the i18n keys, the stub's endpoints and every test of them go. The Dify routes' re-export of `forbiddenResponse` goes with its last users (Plan decision y).

**Files:**

- Delete: `app/api/dify/[appId]/apps/annotations/route.ts`, `app/api/dify/[appId]/apps/annotations/[annotationId]/route.ts`, `lib/providers/dify/types/annotations.ts`, `components/admin/apps/{annotations-drawer,annotations-panel,annotation-form-modal}.tsx`, `components/chat/chat-view/annotation-drawer.tsx`
- Modify: `lib/providers/dify/{client,browser,schemas,route}.ts`, `lib/providers/dify/types/index.ts`, `lib/data/apps.ts`, `app/(admin)/app-management/schemas.ts`, `components/admin/apps/{admin-app-row.ts,app-actions.tsx,app-form-values.ts,app-management.tsx,app-settings-fields.tsx}`, `components/chat/chat-view/{chat-view.tsx,message-actions.ts,message-footer.tsx}`, `locales/{en,zh,ar}/translation.json`, `e2e/fixtures/stub/{apps,router,store}.ts`, `e2e/auth.setup.ts`, `e2e/{admin-apps,chat-feedback,roles,screenshots}.spec.ts`, `lib/auth/roles.ts` (a comment)
- Test: `__tests__/{api-routes,chat-message-actions,dify-client,dify-browser,dify-schemas,dify-routes-files,admin-app-row,app-form-values,app-management-schemas,app-management-actions,app-summary,apps-page,chat-page,data-apps,data-apps-sync,stub-events,stub-router}.test.ts`

**Acceptance Criteria:**

- [ ] The files listed under Delete no longer exist: both `app/api/dify/[appId]/apps/annotations/**/route.ts`, `lib/providers/dify/types/annotations.ts`, `components/admin/apps/{annotations-drawer,annotations-panel,annotation-form-modal}.tsx` and `components/chat/chat-view/annotation-drawer.tsx`.
- [ ] `__tests__/api-routes.test.ts` (no route file includes 'annotations'), `__tests__/dify-browser.test.ts` case 'has no annotation method', `__tests__/chat-message-actions.test.ts` and `__tests__/dify-client.test.ts` 'covers every method of the client' pass; they fail before the removal in Step 2.
- [ ] `git grep -n -i "annotat" -- app components hooks lib __tests__ e2e locales` returns only the listed exceptions (`lib/providers/dify/types/app.ts` annotation_reply, `e2e/fixtures/stub/scenarios.ts` annotation_reply, `e2e/auth.setup.ts` Playwright annotations, and this task's new comment/test lines in `__tests__/api-routes.test.ts`, `__tests__/dify-browser.test.ts`, `e2e/chat-feedback.spec.ts`, `e2e/roles.spec.ts`); nothing in `e2e/screenshots.spec.ts` or `lib/auth/roles.ts`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` prints nothing.
- [ ] `pnpm test` passes.
- [ ] `pnpm test:e2e e2e/roles.spec.ts e2e/chat-feedback.spec.ts e2e/screenshots.spec.ts --project desktop-light` passes.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json') && pnpm test && pnpm test:e2e e2e/roles.spec.ts e2e/chat-feedback.spec.ts e2e/screenshots.spec.ts --project desktop-light` → tsc prints nothing; no findings; unit tests and the three e2e specs pass

**Interfaces:**

- Consumes: Task 3's paths.
- Produces: `FooterActions` without `annotate`, `FooterContext` without `annotation`; `AppSettings` (lib/data/apps.ts) without `annotationEnabled`; `AppAccess` without `annotationEnabled`; `DifyRouteContext` without `annotationEnabled`; `lib/providers/dify/route.ts` re-exports `errorResponseFrom` and `jsonNoStore` only. No `Annotation*` type, client or browser method remains.

- [ ] **Step 1: Write the failing tests**

In `__tests__/api-routes.test.ts`, add after line 22 (`expect(stray).toEqual([])`), inside the same `it`:

```ts
// Part 1 spec §6 (decision 21): the two annotation routes are gone with the feature.
expect(routes.filter(file => file.includes('annotations'))).toEqual([])
```

In `__tests__/chat-message-actions.test.ts`:

- replace line 26 `const none = { annotation: false, tts: false, hasQuestion: true }` with `const none = { tts: false, hasQuestion: true }`;
- in the `toStrictEqual` of `'offers regenerate, copy, feedback and the time on a finished answer'`, delete the line `			annotate: false,`;
- replace the case at lines 66–75:

```ts
it('offers annotation and text-to-speech only when the app enables them and there is text', () => {
	const enabled = { annotation: true, tts: true, hasQuestion: true }
	expect(footerActions(answer(), 'success', enabled)).toMatchObject({ annotate: true, tts: true })
	expect(footerActions(answer({ content: '' }), 'success', enabled)).toMatchObject({
		copy: false,
		annotate: false,
		tts: false,
		regenerate: true,
	})
})
```

with:

```ts
it('offers text-to-speech only when the app enables it and there is text', () => {
	const enabled = { tts: true, hasQuestion: true }
	expect(footerActions(answer(), 'success', enabled)).toMatchObject({ tts: true })
	expect(footerActions(answer({ content: '' }), 'success', enabled)).toMatchObject({
		copy: false,
		tts: false,
		regenerate: true,
	})
})
```

- replace `it('is the question annotation starts from too', () => {` with `it('is the user turn just before the answer', () => {`.

In `__tests__/dify-client.test.ts`:

- in `it('no user: info, parameters, site, meta, human-input form, annotations', …)` (lines 167–195), change the title to `'no user: info, parameters, site, meta, human-input form'` and delete lines 183–193 (from `reply(() => jsonResponse(200, { data: [], has_more: false, limit: 10, total: 0, page: 1 }))` through `await expect(client.deleteAnnotation('a1')).resolves.toBeUndefined()`);
- delete the four entries of `operations` named `listAnnotations`, `createAnnotation`, `updateAnnotation` and `deleteAnnotation` (lines 662–693 before the first deletion: from the `{` before `name: 'listAnnotations',` to the `},` after `result: 'empty',`). The case `'covers every method of the client'` now fails until Step 4 removes the methods.

In `__tests__/dify-browser.test.ts`, delete lines 32–33 (`await api.listAnnotations({ page: 1, limit: 10, keyword: '' })` and its `expect`) and lines 61–62 (`await expect(api.deleteAnnotation('a1')).resolves.toBeUndefined()` and its `expect`), then add as the last case of `describe('createDifyApi: paths on the app route tree, Dify’s verbs', …)` (after `'builds the remote-file, chat and events URLs'`; `api` is the file's `createDifyApi('app 1')`):

```ts
// Part 1 spec §6: the annotation methods went with the routes.
it('has no annotation method', () => {
	for (const name of [
		'listAnnotations',
		'createAnnotation',
		'updateAnnotation',
		'deleteAnnotation',
	])
		expect(api).not.toHaveProperty(name)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/api-routes.test.ts __tests__/chat-message-actions.test.ts __tests__/dify-client.test.ts __tests__/dify-browser.test.ts` Expected: FAIL: api-routes (`['dify/[appId]/apps/annotations/[annotationId]/route.ts', 'dify/[appId]/apps/annotations/route.ts']`), chat-message-actions (`annotate: false` present in the strict object), dify-client (`covers every method of the client`: the four annotation names), dify-browser (`has no annotation method`).

- [ ] **Step 3: Delete the annotation files**

Run:

```bash
git rm "app/api/dify/[appId]/apps/annotations/route.ts" "app/api/dify/[appId]/apps/annotations/[annotationId]/route.ts" \
	lib/providers/dify/types/annotations.ts \
	components/admin/apps/annotations-drawer.tsx components/admin/apps/annotations-panel.tsx components/admin/apps/annotation-form-modal.tsx \
	components/chat/chat-view/annotation-drawer.tsx
```

- [ ] **Step 4: Remove the annotation pieces from the Dify module**

`lib/providers/dify/types/index.ts`: delete line 1, `export * from './annotations'`.

`lib/providers/dify/client.ts`: delete lines 5–8 (`AnnotationInput,`, `AnnotationItem,`, `AnnotationsPage,`, `AnnotationsQuery,` in the type import) and lines 314–327 (the blank line after `textToAudio`, `// Annotations (§1.7): no end-user context.` and the four annotation methods through `deleteAnnotation`'s closing `},`); delete the lower range first so the numbers hold. The returned object then ends with `textToAudio`.

`lib/providers/dify/browser.ts`: in the `import type { … } from './types'` list delete `AnnotationInput,`, `AnnotationItem,`, `AnnotationsPage,` and `AnnotationsQuery,`; in the returned object delete the blank line before `listAnnotations` and the four methods from `listAnnotations: (query: AnnotationsQuery) =>` through `deleteAnnotation`'s closing `},`, so `textToAudio` is followed by the blank line and `/** The app's URL for a file link Dify handed out …`.

`lib/providers/dify/schemas.ts`: delete `export const annotationsQuery = z.object({ … })` (5 lines), `export const annotationBody = z.object({ … })` (4 lines), each with the blank line after it, and the two lines `export type AnnotationsQueryInput = z.infer<typeof annotationsQuery>` and `export type AnnotationBody = z.infer<typeof annotationBody>`.

`lib/providers/dify/route.ts`: replace

```ts
// A route checks the role right after the app (session → app → role → input) and answers forbiddenResponse().
export { errorResponseFrom, forbiddenResponse }
export { jsonNoStore } from '@/lib/http/response'
```

with

```ts
export { errorResponseFrom }
export { jsonNoStore } from '@/lib/http/response'
```

and replace `import { errorResponse, errorResponseFrom, forbiddenResponse } from '@/lib/http/errors'` with `import { errorResponse, errorResponseFrom } from '@/lib/http/errors'`. In `DifyRouteContext` delete

```ts
/** The app's annotation switch (AppAccess). */
annotationEnabled: boolean
```

and in the `ctx` object delete `annotationEnabled: app.annotationEnabled,`.

- [ ] **Step 5: Remove the switch from the data layer and the admin form**

`lib/data/apps.ts`:

- in `dtoColumns`, delete `enableAnnotation: difyApps.enableAnnotation,`;
- replace `type DtoRow = Omit<AppRow, 'apiKey' | 'iconImage' | 'iconMime' | 'accessMode'> & {` with `type DtoRow = Omit<AppRow, 'apiKey' | 'iconImage' | 'iconMime' | 'accessMode' | 'enableAnnotation'> & {`;
- in `interface AppSettings`, delete `annotationEnabled: boolean`;
- in `interface AppAccess`, delete the two lines `/** The app's annotation switch: a user-role account may create annotations only where it is on (charter §4.1). */` and `annotationEnabled: boolean`;
- in `settingsOf`, delete `| 'enableAnnotation'` from the `Pick` and `annotationEnabled: row.enableAnnotation,` from the result;
- in `settingsColumns`, delete `enableAnnotation: settings.annotationEnabled,`;
- in `readAccess`, delete `enableAnnotation: difyApps.enableAnnotation,` from the select and `annotationEnabled: row.enableAnnotation,` from the result.

`app/(admin)/app-management/schemas.ts`: delete `annotationEnabled: z.boolean(),` in `appSettingsSchema`.

`components/admin/apps/app-form-values.ts`: delete `annotationEnabled: false,` in `DEFAULT_APP_FORM_VALUES.settings`.

`components/admin/apps/app-settings-fields.tsx`: delete lines 189–196, the `<Form.Item label={t('app_setting.allow_annotation')} …>` with its `<Switch />` and closing `</Form.Item>`.

`components/admin/apps/admin-app-row.ts`: delete line 3 (`import type { AppMode } from '@/lib/providers/dify/types'`) and lines 8–10 (the `supportsAnnotations` comment and function, with the blank line after them).

`components/admin/apps/app-actions.tsx`: delete the `onAnnotations,` destructured prop, the `onAnnotations?: () => void` prop type, the menu entry `...(onAnnotations ? [{ key: 'annotations', label: t('admin_apps.annotations') }] : []),` and the line `if (key === 'annotations') onAnnotations?.()`.

`components/admin/apps/app-management.tsx`:

- replace `import { accessSummary, type AdminAppRow, supportsAnnotations } from './admin-app-row'` with `import { accessSummary, type AdminAppRow } from './admin-app-row'` and delete `import AnnotationsDrawer from './annotations-drawer'`;
- delete `const [annotations, setAnnotations] = useState<{ open: boolean; appId?: string }>({ open: false })` and `const openAnnotations = (appId: string) => setAnnotations({ open: true, appId })`;
- delete the prop line `onAnnotations={supportsAnnotations(app.mode) ? () => openAnnotations(app.id) : undefined}`;
- delete the `<AnnotationsDrawer … />` element (lines 206–211: `<AnnotationsDrawer`, `open={annotations.open}`, `appId={annotations.appId}`, the two callbacks and `/>`).

- [ ] **Step 6: Remove the annotate action from the chat**

`components/chat/chat-view/message-actions.ts`:

- in `FooterActions`, delete `annotate: boolean`;
- in `FooterContext`, delete `/** The app's \`settings.annotationEnabled\` \*/`and`annotation: boolean`;
- replace the comment line ` * copy, annotation and text-to-speech need text, and the last two the app's switch. Regenerate asks the` with ` * copy and text-to-speech need text, and text-to-speech the app's switch. Regenerate asks the`;
- delete `annotate: context.annotation && hasText,`.

`components/chat/chat-view/message-footer.tsx`:

- delete `EditOutlined,` from the icon import;
- delete the prop doc and type `/** Opens the annotation drawer for this answer and its question. */` and `onAnnotate: (key: string | number) => void`, and the destructured `onAnnotate,`;
- replace ` * An assistant bubble's footer (spec §5.2): X \`Actions\` with regenerate, \`Actions.Copy\`, annotate, like and`with` \* An assistant bubble's footer (spec §5.2): X \`Actions\` with regenerate, \`Actions.Copy\`, like and`;
- delete `annotation: app.settings.annotationEnabled,` from the `footerActions` call; `app` is then no longer read here, so replace `const { app, parameters, difyApi } = useAppContext()` with `const { parameters, difyApi } = useAppContext()`;
- delete the `if (actions.annotate) { … }` block (16 lines: `if (actions.annotate) {` through its closing `}`).

`components/chat/chat-view/chat-view.tsx`:

- delete line 32, `import AnnotationDrawer from './annotation-drawer'`;
- replace line 49 `import { questionOf, regenerateRequest, suggestionTarget, unansweredKeys } from './message-actions'` with `import { regenerateRequest, suggestionTarget, unansweredKeys } from './message-actions'`;
- delete lines 415–425 (`// One annotation drawer for the page, …`, the `annotation` state, the `annotate` callback and the blank line after it);
- in `renderFooter`, delete `onAnnotate={annotate}` and replace its dependency list `[annotate, feedback, isRequesting, regenerate, unansweredSet],` with `[feedback, isRequesting, regenerate, unansweredSet],`;
- delete lines 660–667, the `{app.settings.annotationEnabled && ( <AnnotationDrawer … /> )}` block.

(The line numbers in this list are those before the step; delete from the bottom up.)

- [ ] **Step 7: Remove the i18n keys**

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const REMOVED = ['annotation', 'app_setting.allow_annotation', 'app_setting.allow_annotation_tooltip', 'admin_apps.annotations', 'message.annotation']
for (const language of ['en', 'zh', 'ar']) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	for (const path of REMOVED) {
		const keys = path.split('.')
		const last = keys.pop()
		const node = keys.reduce((parent, key) => parent[key], tree)
		delete node[last]
	}
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

- [ ] **Step 8: Remove the stub's endpoints and the seeds' switch**

`e2e/fixtures/stub/router.ts`: delete `annotationsFor,` from the `./store` import (line 22) and lines 450–503 (the `if (path === '/apps/annotations' || path.startsWith('/apps/annotations/')) { … }` block and the blank line after it). `limitOf` stays (the conversation and message lists use it).

`e2e/fixtures/stub/store.ts`: delete lines 72–91 (the blank line, `StoredAnnotation`, the `annotations` map and `annotationsFor`; line 71, `export const now`, stays: `router.ts` imports it), so the file ends with `export const now = () => Math.floor(Date.now() / 1000)` and one newline.

`e2e/fixtures/stub/apps.ts`: delete the two lines of the `enableAnnotation` field in `StubApp` (`/** Seeded into \`dify*apps.enable_annotation\` … */`and`enableAnnotation: boolean`), every `enableAnnotation: false,`/`enableAnnotation: true,`line (eight), and replace`/\*\* The app a stub path belongs to (its name, site variant and annotation store). _/`with`/\*_ The app a stub path belongs to (its name and site variant). \_/`.

`e2e/auth.setup.ts`: replace the seed statement and its parameters (lines 34–55):

```ts
// A database that survives between runs keeps its rows: the display mode, the annotation switch, the
// status and the icon are refreshed on them. The icon is the emoji the stub's /site answers (the DAL stores
// it at create and sync; a seeded row needs it set), none for the app without a site. The stub apps are
// open to everyone, as the B3a migration left existing apps (ADR-0027); specs that test access create
// their own restricted apps (e2e/fixtures/access.ts). PostgreSQL 18 "INSERT", ON CONFLICT DO UPDATE: the
// SET list reads the proposed row through the special table EXCLUDED.
await db.query(
	'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, enable_annotation, is_enabled, icon_type, icon, icon_background, access_mode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO UPDATE SET opening_statement_display_mode = EXCLUDED.opening_statement_display_mode, enable_annotation = EXCLUDED.enable_annotation, is_enabled = EXCLUDED.is_enabled, icon_type = EXCLUDED.icon_type, icon = EXCLUDED.icon, icon_background = EXCLUDED.icon_background, access_mode = EXCLUDED.access_mode',
	[
		app.id,
		app.name,
		app.mode,
		'Seeded for the e2e suite',
		`${stubApiBase}${app.prefix}`,
		'app-e2e',
		app.openingStatementDisplayMode,
		app.enableAnnotation,
		app.enabled !== false,
		...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
		'everyone',
	],
)
```

with:

```ts
// A database that survives between runs keeps its rows: the display mode, the status and the icon are
// refreshed on them. The icon is the emoji the stub's /site answers (the DAL stores it at create and sync; a
// seeded row needs it set), none for the app without a site. The stub apps are open to everyone, as the B3a
// migration left existing apps (ADR-0027); specs that test access create their own restricted apps
// (e2e/fixtures/access.ts). PostgreSQL 18 "INSERT", ON CONFLICT DO UPDATE: the SET list reads the proposed
// row through the special table EXCLUDED.
await db.query(
	'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, is_enabled, icon_type, icon, icon_background, access_mode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO UPDATE SET opening_statement_display_mode = EXCLUDED.opening_statement_display_mode, is_enabled = EXCLUDED.is_enabled, icon_type = EXCLUDED.icon_type, icon = EXCLUDED.icon, icon_background = EXCLUDED.icon_background, access_mode = EXCLUDED.access_mode',
	[
		app.id,
		app.name,
		app.mode,
		'Seeded for the e2e suite',
		`${stubApiBase}${app.prefix}`,
		'app-e2e',
		app.openingStatementDisplayMode,
		app.enabled !== false,
		...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
		'everyone',
	],
)
```

(Task 11 rewrites this seed for the `apps` table; the column `enable_annotation` keeps its default until then.)

- [ ] **Step 9: Remove the annotation cases from the other tests and specs**

Run this to drop the `annotationEnabled` lines from the test fixtures that still carry the switch:

```bash
sed -i -E '/^\s*annotationEnabled: (true|false),$/d' __tests__/app-form-values.test.ts __tests__/app-management-schemas.test.ts __tests__/app-management-actions.test.ts __tests__/app-summary.test.ts __tests__/apps-page.test.ts __tests__/chat-page.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-routes-files.test.ts
sed -i -E '/^\s*enableAnnotation: (true|false),$/d' __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts
```

Expected: `git grep -n "annotationEnabled\|enableAnnotation" -- __tests__` then prints only `__tests__/data-apps-sync.test.ts` with `'enableAnnotation',` (the expected selection list), the three `getAppAccess.mockResolvedValue({ ...access, annotationEnabled: … })` lines of `__tests__/dify-routes-files.test.ts`, and `__tests__/stub-events.test.ts:76` (`app.enableAnnotation`, in the case deleted below); the next edits remove them all.

`__tests__/data-apps-sync.test.ts`: in `it('syncApp reads only the access columns', …)`, delete `'enableAnnotation',` from the expected list.

`__tests__/admin-app-row.test.ts`: replace line 3 with `import { accessSummary } from '@/components/admin/apps/admin-app-row'` and delete lines 5–18 (`describe('supportsAnnotations', …)` and the blank line after it).

`__tests__/dify-schemas.test.ts`: delete `annotationBody,` and `annotationsQuery,` from the import list and the case `it('annotationsQuery: page ≥ 1, limit 1..100, keyword free text', …)` (7 lines).

`__tests__/dify-routes-files.test.ts` (line numbers as the first `sed` above leaves the file, one less than at `dfeff12e` from line 50 on; delete from the bottom up):

- in `describe('path segments', …)`, delete the two `'annotationId'` entries of `refusals` (the 16 lines from the `[` before the first `'annotationId',` to the `],` after the second `params({ annotationId: dotDot }),` block), and replace the case `it('validates the segment before the query or the body is read', …)` (lines 357–368) with:

```ts
it('validates the segment before the query is read', async () => {
	const badFlag = await preview(
		new NextRequest(`${base}/files/../preview?as_attachment=yes`),
		params({ fileId: dotDot }),
	)
	expect((await badFlag.json()).message).toContain('fileId')
})
```

- delete lines 206–318 (the blank line, `describe('annotations', …)` and `describe('annotation routes and roles (charter §4.1, §4.2)', …)`);
- delete `const member = { ...actor, role: 'user' }` (line 46);
- delete lines 29–36 (the two annotation route imports);
- delete lines 13–16 (`listAnnotations: vi.fn(),` through `deleteAnnotation: vi.fn(),` in the hoisted `client`).

`__tests__/stub-events.test.ts`: delete the case `it('seeds annotation on the chatflow app only (no stub parameters enable annotation_reply)', …)` (5 lines).

`__tests__/stub-router.test.ts`: delete lines 639–682 (the blank line and the case `it('keeps annotations per app: create, newest-first paging, keyword, update, delete', …)`).

`e2e/admin-apps.spec.ts`: delete lines 206–298 (the blank line and `test.describe('annotations', …)`).

`e2e/chat-feedback.spec.ts`:

- replace the two comment lines before the describe and its title:

```ts
// The stub's chatflow app enables text_to_speech (its /parameters) and annotation (seeded in auth.setup.ts);
// the chat app enables neither.
test.describe('text to speech and annotation', () => {
```

with

```ts
// The stub's chatflow app enables text_to_speech (its /parameters); the chat app does not.
test.describe('text to speech', () => {
```

- at the end of the case `'read aloud plays the answer, stop reading ends it, and it ends by itself'`, after `await expect(read).toHaveClass(/ant-actions-audio-default/)`, add:

```ts
// Part 1 spec §6: no annotate action, even on the app that had annotations on.
await expect(lastAnswer(page).getByRole('button', { name: 'Annotation' })).toHaveCount(0)
```

- delete the case `test('annotation opens a drawer with the question and the answer and saves them', …)` with the blank line before it;
- in `test('an app without them offers neither', …)`, change the title to `'an app without it offers no read aloud'` and delete its last line `await expect(lastAnswer(page).getByRole('button', { name: 'Annotation' })).toHaveCount(0)`.

`e2e/roles.spec.ts`: replace the two cases `test('is refused by the admin-only annotation routes', …)` and `test('may create an annotation where the app enables annotations', …)` (lines 30–62: the blank line before them and the two cases; line 63, the `describe`'s closing `})`, stays) with nothing, replace line 3 `import { ADMIN_STATE, APP_ID, APP_IDS } from './fixtures/constants'` with `import { APP_ID } from './fixtures/constants'`, and delete line 7 `const forbidden = { code: 'forbidden', message: 'Not allowed.', status: 403 }`. Then append at the end of the file:

```ts
// Part 1 spec §9, Docker gate: the annotation routes are gone, so a signed-in caller meets Next's 404 there.
test('the annotation routes answer 404', async ({ page }) => {
	for (const path of [
		`/api/dify/${APP_ID}/apps/annotations`,
		`/api/dify/${APP_ID}/apps/annotations/3b241101-e2bb-4255-8caf-4136c566a962`,
	])
		expect((await page.request.get(path)).status()).toBe(404)
})
```

(This case runs under the projects' signed-in admin state; the `describe`s above set their own.)

`e2e/screenshots.spec.ts`: delete lines 178–189 (the blank line and the case `test('screenshot annotations-drawer', …)`, which opens the row menu's "Annotations"). `APP_IDS` stays imported: the chat shots use it.

`lib/auth/roles.ts`: replace line 13 `/** The admin surface (apps, annotations, the users table): the owner and an admin. */` with `/** The admin surface (apps, the users table): the owner and an admin. */`.

- [ ] **Step 10: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/api-routes.test.ts __tests__/chat-message-actions.test.ts __tests__/dify-client.test.ts __tests__/dify-browser.test.ts __tests__/dify-routes-files.test.ts __tests__/stub-router.test.ts __tests__/stub-events.test.ts __tests__/i18n-locales.test.ts` Expected: PASS.

Run: `git grep -n -i "annotat" -- app components hooks lib __tests__ e2e locales` Expected: only Dify's own feature names that are not this feature: `lib/providers/dify/types/app.ts` (`annotation_reply?: { enabled: boolean }` in `AppParameters`), `e2e/fixtures/stub/scenarios.ts` (`annotation_reply: { enabled: false },` in the stub's `/parameters`), `e2e/auth.setup.ts` (`.annotations.push(` and "the annotation records it", Playwright's test annotations), and this task's new comment and test lines in four files (`__tests__/api-routes.test.ts`, `__tests__/dify-browser.test.ts`, `e2e/chat-feedback.spec.ts`, `e2e/roles.spec.ts`). Nothing in `e2e/screenshots.spec.ts` or `lib/auth/roles.ts`.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output (a leftover use of a removed name fails here).

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json')` Expected: no findings (fix formatting with `pnpm exec oxfmt <files>` and re-run).

Run: `pnpm test` Expected: PASS (the run decides the count).

Run, with nothing listening on 5301 (no other `next dev` of this checkout) and `pnpm test:db` not running: `pnpm test:e2e e2e/roles.spec.ts e2e/chat-feedback.spec.ts e2e/screenshots.spec.ts --project desktop-light` Expected: PASS (the setup project runs first; the screenshot shots no longer include an annotations drawer).

- [ ] **Step 11: Commit**

```bash
git add app components lib locales e2e __tests__
git status --short
git commit -m "feat(apps): remove Dify annotations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 5: Neutral wording on the users page and in the shared copy

**Goal:** The users page names the account id column 'User ID' and the shared copy no longer names Dify, with a locale test that keeps Dify's name inside Dify-only areas.

Spec §5 ("The users page") and §7: "Dify user ID" becomes "User ID" (`admin_users.user_id`, CSS class `userId`), and the keys that name Dify in neutral places are reworded: `admin_apps.subtitle`, `app.no_config_default_text`, and `admin_users.delete_directory_confirm_description` (Plan decision z). A locale test keeps Dify's name inside the Dify-only areas from now on.

**Files:**

- Modify: `components/admin/users/user-management.tsx` (lines 150–155), `components/admin/users/user-management.module.css` (line 4), `locales/{en,zh,ar}/translation.json`, `e2e/admin-users.spec.ts`
- Test: `__tests__/i18n-locales.test.ts`

**Acceptance Criteria:**

- [ ] `__tests__/i18n-locales.test.ts` case 'names Dify only where the copy is about Dify' exists; before the rewording it fails listing `['admin_apps.subtitle', 'admin_users.delete_directory_confirm_description', 'admin_users.dify_user_id', 'app.no_config_default_text']`, and afterwards `pnpm exec vitest run --project unit __tests__/i18n-locales.test.ts` passes.
- [ ] `git grep -n "dify_user_id\|difyUserId" -- ':!docs'` returns no output.
- [ ] `admin_users.user_id` is 'User ID' in en (and translated in zh and ar), and `admin_users.dify_user_id` is removed from all three `locales/{en,zh,ar}/translation.json`.
- [ ] The users table column uses `key: 'userId'` and the CSS class `.userId` in `components/admin/users/user-management.module.css`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` prints nothing from tsc and passes.
- [ ] `pnpm test:e2e e2e/admin-users.spec.ts --project desktop-light` passes.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm exec oxlint components/admin/users/user-management.tsx __tests__/i18n-locales.test.ts && pnpm exec oxfmt --check components/admin/users/user-management.tsx components/admin/users/user-management.module.css __tests__/i18n-locales.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json e2e/admin-users.spec.ts && pnpm test:e2e e2e/admin-users.spec.ts --project desktop-light` → tsc prints nothing; unit tests pass; no findings; the e2e spec passes

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: i18n key `admin_users.user_id` (en "User ID"); the users table column `key: 'userId'`; the locale test `'names Dify only where the copy is about Dify'`, whose allow-list later tasks keep (Tasks 10 and 12 add `provider.*` and `app_setting.api_*` keys inside it).

- [ ] **Step 1: Write the failing tests**

In `__tests__/i18n-locales.test.ts`, add as the last case of `describe('locale files', …)`, before its closing `})`:

```ts
// Part 1 spec §7: neutral copy does not name Dify. The Dify-only places may: the Dify chat (chat, hitl, workflow),
// its app types, the provider names, and the Dify connection fields of the app form.
it('names Dify only where the copy is about Dify', () => {
	const difyOnly = /^(chat|hitl|workflow|app_mode|provider)\.|^app_setting\.(api_|type_)/
	const offenders = [enFlat, ...Object.values(translations)]
		.flatMap(flat => Object.entries(flat))
		.filter(([key, value]) => /dify/i.test(value) && !difyOnly.test(key))
		.map(([key]) => key)
	expect([...new Set(offenders)].sort()).toEqual([])
})
```

In `e2e/admin-users.spec.ts`:

- replace line 10 `/** The owner's account id, the Dify user ID (ADR-0026), read from the database: exactly one row. */` with `/** The owner's account id, the end user every provider sees (ADR-0026), read from the database: exactly one row. */`;
- replace the title `"the owner's row shows its Dify user ID, the account id, with a copy button (ADR-0026)"` with `"the owner's row shows its User ID, the account id, with a copy button (ADR-0026)"`, and add after its `await openUsers(page)` line:

```ts
await expect(page.getByRole('columnheader', { name: 'User ID', exact: true })).toBeVisible()
```

- replace the title `'searching for a Dify user ID finds its account (ADR-0026)'` with `'searching for a User ID finds its account (ADR-0026)'`.

- [ ] **Step 2: Run the locale test to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/i18n-locales.test.ts` Expected: FAIL in `'names Dify only where the copy is about Dify'` with `['admin_apps.subtitle', 'admin_users.delete_directory_confirm_description', 'admin_users.dify_user_id', 'app.no_config_default_text']`.

- [ ] **Step 3: Reword the keys**

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const EDITS = {
	en: {
		'admin_users.dify_user_id': null,
		'admin_users.user_id': 'User ID',
		'admin_users.delete_directory_confirm_description':
			'Delete this directory account? At their next directory sign-in the person gets a new account and starts every app afresh. To keep the account, deactivate it instead.',
		'admin_apps.subtitle': 'Manage the AI apps published in the hub',
		'app.no_config_default_text': 'No app configuration found. Contact your administrator.',
	},
	zh: {
		'admin_users.dify_user_id': null,
		'admin_users.user_id': '用户 ID',
		'admin_users.delete_directory_confirm_description':
			'确定要删除这个目录账户吗？此人下次通过目录登录时会获得一个新账户，所有应用都将从头开始。如需保留该账户，请改为停用。',
		'admin_apps.subtitle': '管理在应用中心发布的 AI 应用',
		'app.no_config_default_text': '暂无应用配置，请联系管理员',
	},
	ar: {
		'admin_users.dify_user_id': null,
		'admin_users.user_id': 'معرّف المستخدم',
		'admin_users.delete_directory_confirm_description':
			'حذف حساب الدليل هذا؟ عند تسجيل دخوله التالي عبر الدليل سيحصل الشخص على حساب جديد ويبدأ كل تطبيق من جديد. للإبقاء على الحساب، عطّله بدلًا من ذلك.',
		'admin_apps.subtitle': 'إدارة تطبيقات الذكاء الاصطناعي المنشورة في المنصة',
		'app.no_config_default_text': 'لم يتم العثور على إعدادات التطبيق. تواصل مع المسؤول.',
	},
}
// A dotted path is set, or deleted when its value is null; JSON.stringify with a tab keeps the files' own format.
for (const [language, edits] of Object.entries(EDITS)) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	for (const [path, value] of Object.entries(edits)) {
		const keys = path.split('.')
		const last = keys.pop()
		const node = keys.reduce((parent, key) => (parent[key] ??= {}), tree)
		if (value === null) delete node[last]
		else node[last] = value
	}
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

- [ ] **Step 4: Rename the column**

In `components/admin/users/user-management.tsx`, replace lines 150–155:

```tsx
			// ADR-0026: the account id is the Dify end user; the owner copies it into Dify's log search or Langfuse.
			title: t('admin_users.dify_user_id'),
			key: 'difyUserId',
			render: (_, user) => (
				<Typography.Text
					className={styles.difyUserId}
```

with:

```tsx
			// ADR-0026: the account id is the end user every provider sees; the owner copies it into a provider's log search
			// or Langfuse.
			title: t('admin_users.user_id'),
			key: 'userId',
			render: (_, user) => (
				<Typography.Text
					className={styles.userId}
```

In `components/admin/users/user-management.module.css`, replace line 4 `.difyUserId {` with `.userId {`.

- [ ] **Step 5: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/i18n-locales.test.ts` Expected: PASS.

Run: `git grep -n "dify_user_id\|difyUserId" -- ':!docs'` Expected: no output. (`docs/auth-gate.md` says "Dify user ID" in words; Task 14 rewrites it.)

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint components/admin/users/user-management.tsx __tests__/i18n-locales.test.ts && pnpm exec oxfmt --check components/admin/users/user-management.tsx components/admin/users/user-management.module.css __tests__/i18n-locales.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json e2e/admin-users.spec.ts` Expected: no findings.

Run (no other `next dev` of this checkout, `pnpm test:db` not running): `pnpm test:e2e e2e/admin-users.spec.ts --project desktop-light` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/admin/users locales __tests__/i18n-locales.test.ts e2e/admin-users.spec.ts
git commit -m "feat(users): name the account id User ID and keep Dify out of neutral copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 6: The provider ids and Dify's documents

**Goal:** Add the client-safe provider id list, Dify's settings and secrets zod schemas, and the shared checkSettings/checkDocuments/mergeSecrets helpers, with nothing using them yet.

Spec §2.1–§2.3 and §3 (`lib/providers/ids.ts`, `lib/providers/dify/schema.ts`). Decision 17: each provider has zod schemas for its `settings` and `secrets` documents, checked on every write and read. The schemas are client-safe, so the admin form validates with the same rules the server parses (DV 9a); a client-safe map from provider id to schemas, `lib/providers/schemas.ts`, is the half of the registry the form and the data layer share (Plan decision d). Nothing uses these modules yet; Tasks 7, 9, 10 and 11 do.

**Files:**

- Create: `lib/providers/ids.ts`, `lib/providers/dify/schema.ts`, `lib/providers/schemas.ts`
- Test: `__tests__/provider-schemas.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/provider-schemas.test.ts` passes, including the cases 'are Dify only in Part 1' and 'each have their schemas (DV 11: the map is exhaustive)'.
- [ ] In `__tests__/provider-schemas.test.ts`, the Dify settings cases 'reads a valid document and drops keys it does not know' and 'starts a new app as a chatbot with the switches off and no key' pass, and every 'refuses %s' case (unknown app type, no app type, ftp base, base without a scheme, base over 500 characters, submit text over 255 characters, unknown opener display) passes.
- [ ] The secrets cases pass: 'takes a key of 1–255 characters, trimmed', the 'refuses %s' cases for an empty, blank and over-255 key, and 'reads a blank key on an edit as not given'.
- [ ] `checkDocuments` cases 'refuses an unknown provider' and 'says which document failed' pass, answering `unknown_provider`, `invalid_settings` and `invalid_secrets` as the test states, and the `checkSettings` and `mergeSecrets` describe blocks pass.
- [ ] `lib/providers/ids.ts`, `lib/providers/dify/schema.ts` and `lib/providers/schemas.ts` exist, and `pnpm exec next typegen && pnpm exec tsc --noEmit` prints nothing.
- [ ] `pnpm test` passes, and `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the four task files report no findings.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm exec oxlint lib/providers/ids.ts lib/providers/schemas.ts lib/providers/dify/schema.ts __tests__/provider-schemas.test.ts && pnpm exec oxfmt --check lib/providers/ids.ts lib/providers/schemas.ts lib/providers/dify/schema.ts __tests__/provider-schemas.test.ts` → tsc prints nothing; tests PASS; no lint or format findings

**Interfaces:**

- Consumes: `APP_MODES` from `lib/providers/dify/types/app.ts` (Task 3's path).
- Produces:
  - `lib/providers/ids.ts`: `PROVIDER_IDS = ['dify'] as const`, `type ProviderId`, `isProviderId(value: unknown): value is ProviderId`.
  - `lib/providers/dify/schema.ts`: `apiBaseSchema`, `DIFY_DEFAULT_SECRETS` (`{ apiKey: '' }`), `difySettingsSchema`, `type DifySettings = { apiBase: string; appType: AppMode; answerForm: { enabled: boolean; feedbackText: string }; enableUpdateAfterConversationStarts: boolean; openingStatementDisplayMode: 'default' | 'always' }`, `difySecretsSchema`, `type DifySecrets = { apiKey: string }`, `difySecretsUpdateSchema` (output `{ apiKey: string | undefined }`), `DIFY_DEFAULT_SETTINGS`.
  - `lib/providers/schemas.ts`: `PROVIDER_SCHEMAS` (`{ dify: { settingsSchema, secretsSchema, secretsUpdateSchema, defaultSettings, defaultSecrets } }`), `type ProviderSettings<P>`, `type ProviderSecrets<P>`, `type StoredSettings` (`{ provider: 'dify'; settings: DifySettings }` for each provider), `type StoredDocuments` (`StoredSettings` plus `secrets: DifySecrets`), `checkSettings(provider: string, settings: unknown): SettingsCheck` where `SettingsCheck = { ok: true; documents: StoredSettings } | { ok: false; code: 'unknown_provider' | 'invalid_settings' }`, `checkDocuments(provider: string, settings: unknown, secrets: unknown): DocumentsCheck` where `DocumentsCheck = { ok: true; documents: StoredDocuments } | { ok: false; code: 'unknown_provider' | 'invalid_settings' | 'invalid_secrets' }`, `mergeSecrets(stored: unknown, update: Record<string, string | undefined>): Record<string, unknown>`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/provider-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	DIFY_DEFAULT_SECRETS,
	DIFY_DEFAULT_SETTINGS,
	difySecretsSchema,
	difySecretsUpdateSchema,
	difySettingsSchema,
} from '@/lib/providers/dify/schema'
import { isProviderId, PROVIDER_IDS } from '@/lib/providers/ids'
import {
	checkDocuments,
	checkSettings,
	mergeSecrets,
	PROVIDER_SCHEMAS,
} from '@/lib/providers/schemas'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat',
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'always',
}

describe('the provider ids (spec §3; decision 24)', () => {
	it('are Dify only in Part 1', () => {
		expect(PROVIDER_IDS).toEqual(['dify'])
		expect(isProviderId('dify')).toBe(true)
		expect(isProviderId('agui')).toBe(false)
		expect(isProviderId(undefined)).toBe(false)
	})
	it('each have their schemas (DV 11: the map is exhaustive)', () => {
		expect(Object.keys(PROVIDER_SCHEMAS).sort()).toEqual([...PROVIDER_IDS].sort())
	})
})

describe("Dify's settings (spec §2.2)", () => {
	it('reads a valid document and drops keys it does not know', () => {
		expect(difySettingsSchema.parse({ ...settings, annotationEnabled: true })).toEqual(settings)
	})
	it('takes a Docker service name as the API base', () => {
		expect(
			difySettingsSchema.safeParse({ ...settings, apiBase: 'http://api:5001/v1' }).success,
		).toBe(true)
	})
	it.each([
		['an unknown app type', { appType: 'rag-pipeline' }],
		['no app type', { appType: null }],
		['an ftp base', { apiBase: 'ftp://dify.example/v1' }],
		['a base without a scheme', { apiBase: 'dify.example/v1' }],
		['a base over 500 characters', { apiBase: `https://dify.example/${'a'.repeat(480)}` }],
		[
			'a submit text over 255 characters',
			{ answerForm: { enabled: true, feedbackText: 'a'.repeat(256) } },
		],
		['an unknown opener display', { openingStatementDisplayMode: 'sometimes' }],
	])('refuses %s', (_label, change) => {
		expect(difySettingsSchema.safeParse({ ...settings, ...change }).success).toBe(false)
	})
	it('starts a new app as a chatbot with the switches off and no key', () => {
		expect(DIFY_DEFAULT_SETTINGS).toEqual({
			apiBase: '',
			appType: 'chat',
			answerForm: { enabled: false, feedbackText: '' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'default',
		})
		expect(DIFY_DEFAULT_SECRETS).toEqual({ apiKey: '' })
	})
})

describe("Dify's secrets (spec §2.2)", () => {
	it('takes a key of 1–255 characters, trimmed', () => {
		expect(difySecretsSchema.parse({ apiKey: '  app-abc  ' })).toEqual({ apiKey: 'app-abc' })
		expect(difySecretsSchema.safeParse({ apiKey: 'a'.repeat(255) }).success).toBe(true)
	})
	it.each([
		['an empty key', ''],
		['a blank key', '   '],
		['a key over 255 characters', 'a'.repeat(256)],
	])('refuses %s', (_label, apiKey) => {
		expect(difySecretsSchema.safeParse({ apiKey }).success).toBe(false)
	})
	// Spec §2.3: on an edit a blank secret field keeps the stored value, so the form's blank becomes "not given".
	it('reads a blank key on an edit as not given', () => {
		expect(difySecretsUpdateSchema.parse({ apiKey: '' })).toEqual({ apiKey: undefined })
		expect(difySecretsUpdateSchema.parse({ apiKey: '   ' })).toEqual({ apiKey: undefined })
		expect(difySecretsUpdateSchema.parse({})).toEqual({ apiKey: undefined })
		expect(difySecretsUpdateSchema.parse({ apiKey: ' app-new ' })).toEqual({ apiKey: 'app-new' })
		expect(difySecretsUpdateSchema.safeParse({ apiKey: 'a'.repeat(256) }).success).toBe(false)
	})
})

describe('checkDocuments (spec §2.3)', () => {
	it('reads both documents with the provider’s schemas', () => {
		expect(checkDocuments('dify', settings, { apiKey: 'app-k' })).toEqual({
			ok: true,
			documents: { provider: 'dify', settings, secrets: { apiKey: 'app-k' } },
		})
	})
	// DV 11: an id the hub does not know fails closed.
	it('refuses an unknown provider', () => {
		expect(checkDocuments('agui', settings, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'unknown_provider',
		})
	})
	it('says which document failed', () => {
		expect(checkDocuments('dify', { ...settings, appType: null }, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'invalid_settings',
		})
		expect(checkDocuments('dify', settings, { apiKey: '' })).toEqual({
			ok: false,
			code: 'invalid_secrets',
		})
		expect(checkDocuments('dify', settings, null)).toEqual({ ok: false, code: 'invalid_secrets' })
	})
})

// Plan decision ab: the reads that build a user's DTO never select the secrets, so they check the settings alone.
describe('checkSettings', () => {
	it('reads the settings with the provider’s schema', () => {
		expect(checkSettings('dify', settings)).toEqual({
			ok: true,
			documents: { provider: 'dify', settings },
		})
	})
	it('refuses an unknown provider and broken settings', () => {
		expect(checkSettings('agui', settings)).toEqual({ ok: false, code: 'unknown_provider' })
		expect(checkSettings('dify', { ...settings, apiBase: 'nope' })).toEqual({
			ok: false,
			code: 'invalid_settings',
		})
	})
})

describe('mergeSecrets (spec §2.3: a blank secret keeps the stored one)', () => {
	it('keeps the stored fields the update leaves out and replaces the ones it gives', () => {
		expect(mergeSecrets({ apiKey: 'app-old' }, { apiKey: undefined })).toEqual({
			apiKey: 'app-old',
		})
		expect(mergeSecrets({ apiKey: 'app-old' }, { apiKey: 'app-new' })).toEqual({
			apiKey: 'app-new',
		})
	})
	it('starts from nothing when the stored document is not an object', () => {
		expect(mergeSecrets(null, { apiKey: undefined })).toEqual({})
		expect(mergeSecrets('x', { apiKey: 'app-new' })).toEqual({ apiKey: 'app-new' })
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/provider-schemas.test.ts` Expected: FAIL with `Failed to resolve import "@/lib/providers/dify/schema"`.

- [ ] **Step 3: Write the modules**

Create `lib/providers/ids.ts`:

```ts
/**
 * The providers the hub knows (Part 1 spec §3; decision 24: a `text` column with a CHECK listing these ids, plus this
 * check in code). Part 2 adds `'agui'` here and to the CHECK in `db/schema/apps.ts`. Client-safe: the schema, the forms
 * and both registries read it.
 */
export const PROVIDER_IDS = ['dify'] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const isProviderId = (value: unknown): value is ProviderId =>
	typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
```

Create `lib/providers/dify/schema.ts`:

```ts
import * as z from 'zod'

import { APP_MODES } from './types/app'

/*
 * Dify's documents (Part 1 spec §2.2): the settings an app row holds for Dify, and its secrets, kept apart so the later
 * encryption touches only them (decision 8). zod parses both on every write and every read (decision 17; ADR-0025;
 * DV 8b). Client-safe on purpose (DV 9a): the admin form validates with the same schemas. `z.object` drops keys it does
 * not know (zod 4 "Objects": unknown keys are stripped by default), so a document written before a field was removed
 * reads cleanly.
 */

/**
 * The app's API base as Dify shows it, e.g. `https://host/v1`: an http(s) URL of at most 500 characters (today's
 * API base rule). zod 4's `z.url({ protocol })` checks the scheme only, so a Docker service name such as
 * `http://api:5001/v1` passes, which antd's `type: 'url'` would refuse.
 */
export const apiBaseSchema = z.url({ protocol: /^https?$/ }).max(500)

export const difySettingsSchema = z.object({
	apiBase: apiBaseSchema,
	/** The admin's choice (decision 18); Test connection compares it with the mode Dify reports. */
	appType: z.enum(APP_MODES),
	answerForm: z.object({ enabled: z.boolean(), feedbackText: z.string().max(255) }),
	enableUpdateAfterConversationStarts: z.boolean(),
	openingStatementDisplayMode: z.enum(['default', 'always']),
})

export type DifySettings = z.infer<typeof difySettingsSchema>

export const difySecretsSchema = z.object({ apiKey: z.string().trim().min(1).max(255) })

export type DifySecrets = z.infer<typeof difySecretsSchema>

/**
 * The secrets as an edit sends them (spec §2.3): a blank key keeps the stored one, so a blank or missing field reads as
 * "not given" (`undefined`) and the data layer merges the rest into the stored document (lib/providers/schemas.ts
 * `mergeSecrets`).
 */
export const difySecretsUpdateSchema = z.object({
	apiKey: z
		.string()
		.trim()
		.max(255)
		.optional()
		.transform(value => value || undefined),
})

/** What the form starts a new Dify app from: a chatbot, the switches off (today's form defaults). */
export const DIFY_DEFAULT_SETTINGS: z.input<typeof difySettingsSchema> = {
	apiBase: '',
	appType: 'chat',
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
}

/** The form's secret fields, blank: a new app's key is typed, an edit's blank key keeps the stored one. */
export const DIFY_DEFAULT_SECRETS: Record<keyof DifySecrets, string> = { apiKey: '' }
```

Create `lib/providers/schemas.ts`:

```ts
import type * as z from 'zod'

import {
	DIFY_DEFAULT_SECRETS,
	DIFY_DEFAULT_SETTINGS,
	difySecretsSchema,
	difySecretsUpdateSchema,
	difySettingsSchema,
} from './dify/schema'
import { isProviderId, type ProviderId } from './ids'

/*
 * The client-safe half of the provider registry (Part 1 spec §3; Plan decision d): each provider's document schemas, the
 * edit form of its secrets and the form's defaults for both documents. The admin form validates with them (DV 9a) and the data layer parses
 * every write and read with them (decision 17); lib/providers/registry.ts adds the server-only half. `satisfies` keeps
 * the map exhaustive over ProviderId (DV 11): a provider added to PROVIDER_IDS without schemas fails tsc here.
 */
export const PROVIDER_SCHEMAS = {
	dify: {
		settingsSchema: difySettingsSchema,
		secretsSchema: difySecretsSchema,
		secretsUpdateSchema: difySecretsUpdateSchema,
		defaultSettings: DIFY_DEFAULT_SETTINGS,
		defaultSecrets: DIFY_DEFAULT_SECRETS,
	},
} satisfies Record<
	ProviderId,
	{
		settingsSchema: z.ZodType
		secretsSchema: z.ZodType
		secretsUpdateSchema: z.ZodType
		defaultSettings: unknown
		defaultSecrets: Record<string, string>
	}
>

export type ProviderSettings<P extends ProviderId> = z.infer<
	(typeof PROVIDER_SCHEMAS)[P]['settingsSchema']
>
export type ProviderSecrets<P extends ProviderId> = z.infer<
	(typeof PROVIDER_SCHEMAS)[P]['secretsSchema']
>

/** An app's settings once its provider's schema has read them: the only typed form of `settings`. */
export type StoredSettings = {
	[P in ProviderId]: { provider: P; settings: ProviderSettings<P> }
}[ProviderId]

/** An app's documents once its provider's schemas have read them: the only typed form of `settings` and `secrets`. */
export type StoredDocuments = {
	[P in ProviderId]: { provider: P; settings: ProviderSettings<P>; secrets: ProviderSecrets<P> }
}[ProviderId]

export type SettingsCheck =
	| { ok: true; documents: StoredSettings }
	| { ok: false; code: 'unknown_provider' | 'invalid_settings' }

export type DocumentsCheck =
	| { ok: true; documents: StoredDocuments }
	| { ok: false; code: 'unknown_provider' | 'invalid_settings' | 'invalid_secrets' }

/**
 * Reads a row's settings with its provider's schema (spec §2.3; DV 8b: zod `safeParse`). An unknown provider fails closed
 * (DV 11); a document that fails is reported, never returned half-typed. The jsonb columns are `unknown` in Drizzle
 * (DV 8a), so this is where they become typed. The reads that build a user's DTO stop here: they never select the
 * secrets (Plan decision ab).
 */
export const checkSettings = (provider: string, settings: unknown): SettingsCheck => {
	if (!isProviderId(provider)) return { ok: false, code: 'unknown_provider' }
	const parsed = PROVIDER_SCHEMAS[provider].settingsSchema.safeParse(settings)
	return parsed.success
		? { ok: true, documents: { provider, settings: parsed.data } }
		: { ok: false, code: 'invalid_settings' }
}

/** Both documents, as a provider route and the admin writes need them (spec §2.3); the secrets are read after the settings. */
export const checkDocuments = (
	provider: string,
	settings: unknown,
	secrets: unknown,
): DocumentsCheck => {
	const checked = checkSettings(provider, settings)
	if (!checked.ok) return checked
	const parsedSecrets =
		PROVIDER_SCHEMAS[checked.documents.provider].secretsSchema.safeParse(secrets)
	return parsedSecrets.success
		? { ok: true, documents: { ...checked.documents, secrets: parsedSecrets.data } }
		: { ok: false, code: 'invalid_secrets' }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Spec §2.3, write-only secrets: the stored document with the fields the edit gives laid over it; a field the edit
 * leaves `undefined` (a blank form field) keeps its stored value. The result is parsed by the provider's secrets schema
 * before it is stored or used.
 */
export const mergeSecrets = (
	stored: unknown,
	update: Record<string, string | undefined>,
): Record<string, unknown> => ({
	...(isRecord(stored) ? stored : {}),
	...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
})
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run --project unit __tests__/provider-schemas.test.ts` Expected: PASS (the run decides the count; every case passes).

- [ ] **Step 5: Gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint lib/providers/ids.ts lib/providers/schemas.ts lib/providers/dify/schema.ts __tests__/provider-schemas.test.ts && pnpm exec oxfmt --check lib/providers/ids.ts lib/providers/schemas.ts lib/providers/dify/schema.ts __tests__/provider-schemas.test.ts` Expected: no findings (format with `pnpm exec oxfmt <files>` first if the check lists a file).

- [ ] **Step 6: Commit**

```bash
git add lib/providers/ids.ts lib/providers/schemas.ts lib/providers/dify/schema.ts __tests__/provider-schemas.test.ts
git commit -m "feat(providers): add the provider ids and Dify's settings and secrets schemas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 7: The server registry and Dify's Test connection

**Goal:** Add the server-only provider registry and Dify's GET /info connection test, through a new raw fetchInfo client method, so DTOs can be built without importing Dify.

Spec §3 (`lib/providers/registry.ts`) and §4.2 (decision 18). The server-only registry holds, per provider, the schemas of Task 6, its `testConnection(settings, secrets)` and what of its settings each DTO carries (Plan decision e), so the neutral data layer builds the DTOs without importing Dify (spec §11). Dify's test is `GET /info` with the key, read by a new raw client method so that an OK answer that is not Dify's JSON is an upstream error, not "unreachable" (Plan decision f).

**Files:**

- Create: `lib/providers/connection.ts`, `lib/providers/dify/test-connection.ts`, `lib/providers/dify/provider.ts`, `lib/providers/registry.ts`
- Modify: `lib/providers/dify/client.ts` (after `getInfo`, line 207 as of Task 4)
- Test: `__tests__/provider-registry.test.ts`, `__tests__/dify-test-connection.test.ts`, `__tests__/dify-client.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts` passes.
- [ ] In `__tests__/dify-test-connection.test.ts`, 'calls GET <base>/info with the key as a bearer', 'is reachable when Dify answers with the chosen type' and 'warns, still reachable, when Dify reports another type' pass.
- [ ] The failure cases pass: "answers key_refused on Dify's 401", 'answers unreachable on a network failure', the 'answers unreachable on %s' cases (502 page, Dify's 500, 503) and 'answers unreachable when Dify does not answer within 10 s' with `CONNECTION_TEST_TIMEOUT_MS` equal to 10_000.
- [ ] The 'answers upstream_error on %s' cases pass, including 'an OK answer that is not JSON' (the Review Focus 3 case, a base without /v1).
- [ ] `__tests__/provider-registry.test.ts` passes: 'has one definition per provider id (DV 11)', 'answers undefined for an id it does not know, with no fallback (DV 11)', and the DTO-field cases showing the chat fields never contain the API base and the secrets-set result never contains the key value.
- [ ] `__tests__/dify-client.test.ts` passes with the new `fetchInfo` operation entry, and 'covers every method of the client' passes.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` passes with tsc printing nothing, and oxlint and oxfmt --check report no findings on the task files.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm exec oxlint lib/providers __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts && pnpm exec oxfmt --check lib/providers/connection.ts lib/providers/registry.ts lib/providers/dify/provider.ts lib/providers/dify/test-connection.ts lib/providers/dify/client.ts __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts` → tsc prints nothing; tests PASS; no findings

**Interfaces:**

- Consumes: Task 6's `PROVIDER_SCHEMAS`, `ProviderSettings<P>`, `ProviderSecrets<P>`, `DifySettings`, `DifySecrets`, `isProviderId`, `ProviderId`.
- Produces:
  - `lib/providers/connection.ts`: `type ConnectionTestResult = { ok: true; warning?: { code: 'type_mismatch'; reported: string } } | { ok: false; code: 'key_refused' | 'unreachable' | 'upstream_error' }`.
  - `lib/providers/dify/client.ts`: `fetchInfo(signal?: AbortSignal): Promise<Response>` on the client.
  - `lib/providers/dify/test-connection.ts`: `CONNECTION_TEST_TIMEOUT_MS = 10_000`, `testDifyConnection(settings: DifySettings, secrets: DifySecrets): Promise<ConnectionTestResult>`.
  - `lib/providers/registry.ts`: `PROVIDERS` (`{ dify: difyProvider }`), `getProvider(id: string)` (the definition or `undefined`), and the types `ProviderChatFields<P>` (Dify: `{ appType: AppMode; settings: { answerForm: { enabled: boolean; feedbackText: string }; enableUpdateAfterConversationStarts: boolean; openingStatementDisplayMode: 'default' | 'always' } }`), `ProviderSummaryFields<P>` (Dify: `{ appType: AppMode }`), `ProviderSecretsSet<P>` (Dify: `{ apiKey: boolean }`). Each definition has `id`, `settingsSchema`, `secretsSchema`, `secretsUpdateSchema`, `defaultSettings`, `testConnection`, `chatFields(settings)`, `summaryFields(settings)`, `secretsSet(secrets)`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dify-test-connection.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// DifyError extends lib/http's ProviderError, whose module reaches lib/auth/session (as the other Dify tests mock it).
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import {
	CONNECTION_TEST_TIMEOUT_MS,
	testDifyConnection,
} from '@/lib/providers/dify/test-connection'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat' as const,
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default' as const,
}
const secrets = { apiKey: 'app-key' }
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const info = (mode: string) =>
	json(200, { name: 'Tea', description: '', tags: [], mode, author_name: 'x' })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
	// The client logs a network failure with its cause; the cases below assert outcomes, not that line.
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// Part 1 spec §4.2 (decision 18): GET /info with the key; the test copies and saves nothing.
describe('testDifyConnection', () => {
	it('calls GET <base>/info with the key as a bearer', async () => {
		fetchMock.mockResolvedValue(info('advanced-chat'))
		await testDifyConnection(settings, secrets)
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://dify.example/v1/info')
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer app-key')
		expect(init.method ?? 'GET').toBe('GET')
	})
	it('is reachable when Dify answers with the chosen type', async () => {
		fetchMock.mockResolvedValue(info('advanced-chat'))
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: true })
	})
	it('warns, still reachable, when Dify reports another type', async () => {
		fetchMock.mockResolvedValue(info('workflow'))
		expect(await testDifyConnection(settings, secrets)).toEqual({
			ok: true,
			warning: { code: 'type_mismatch', reported: 'workflow' },
		})
	})
	it("answers key_refused on Dify's 401", async () => {
		fetchMock.mockResolvedValue(
			json(401, { code: 'unauthorized', message: 'Access token is invalid', status: 401 }),
		)
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'key_refused' })
	})
	it('answers unreachable on a network failure', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'))
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'unreachable' })
	})
	it.each([
		['a 502 page from a proxy', () => new Response('<html>Bad Gateway</html>', { status: 502 })],
		[
			"Dify's own 500",
			() => json(500, { code: 'internal_server_error', message: 'x', status: 500 }),
		],
		['a 503 with no body', () => new Response(null, { status: 503 })],
	])('answers unreachable on %s', async (_label, answer) => {
		fetchMock.mockImplementation(async () => answer())
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'unreachable' })
	})
	// Plan decision f: the test gives up after 10 s (MDN AbortSignal.timeout()).
	it('answers unreachable when Dify does not answer within 10 s', async () => {
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(
				AbortSignal.abort(
					new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
				),
			)
		fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
			throw init.signal?.reason
		})
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'unreachable' })
		expect(timeout).toHaveBeenCalledWith(CONNECTION_TEST_TIMEOUT_MS)
		expect(CONNECTION_TEST_TIMEOUT_MS).toBe(10_000)
	})
	it.each([
		[
			"Dify's 403 for a disabled app",
			() => json(403, { code: 'forbidden', message: 'x', status: 403 }),
		],
		['a 404 for a wrong path', () => json(404, { code: 'not_found', message: 'x', status: 404 })],
		// Review Focus 3: a base without /v1 reaches the console, which answers its HTML page with 200.
		['an OK answer that is not JSON', () => new Response('<html>Dify</html>', { status: 200 })],
		['an OK JSON answer without a mode', () => json(200, { name: 'Tea' })],
	])('answers upstream_error on %s', async (_label, answer) => {
		fetchMock.mockImplementation(async () => answer())
		expect(await testDifyConnection(settings, secrets)).toEqual({
			ok: false,
			code: 'upstream_error',
		})
	})
})
```

Create `__tests__/provider-registry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { PROVIDER_IDS } from '@/lib/providers/ids'
import { getProvider, PROVIDERS } from '@/lib/providers/registry'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'workflow' as const,
	answerForm: { enabled: true, feedbackText: 'Sent' },
	enableUpdateAfterConversationStarts: true,
	openingStatementDisplayMode: 'always' as const,
}

describe('the server registry (spec §3)', () => {
	it('has one definition per provider id (DV 11)', () => {
		expect(Object.keys(PROVIDERS).sort()).toEqual([...PROVIDER_IDS].sort())
		expect(PROVIDERS.dify.id).toBe('dify')
	})
	it('answers undefined for an id it does not know, with no fallback (DV 11)', () => {
		expect(getProvider('dify')).toBe(PROVIDERS.dify)
		expect(getProvider('agui')).toBeUndefined()
		expect(getProvider('')).toBeUndefined()
	})
})

// Spec §2.3: what each DTO may carry of Dify's settings and secrets.
describe("Dify's DTO fields", () => {
	it('give the chat the type and its three switches, never the API base', () => {
		const fields = PROVIDERS.dify.chatFields(settings)
		expect(fields).toEqual({
			appType: 'workflow',
			settings: {
				answerForm: { enabled: true, feedbackText: 'Sent' },
				enableUpdateAfterConversationStarts: true,
				openingStatementDisplayMode: 'always',
			},
		})
		expect(JSON.stringify(fields)).not.toContain('dify.example')
	})
	it('give the gallery the type only', () => {
		expect(PROVIDERS.dify.summaryFields(settings)).toEqual({ appType: 'workflow' })
	})
	it('say whether the key is set, never its value', () => {
		const set = PROVIDERS.dify.secretsSet({ apiKey: 'app-secret' })
		expect(set).toEqual({ apiKey: true })
		expect(JSON.stringify(set)).not.toContain('app-secret')
	})
})
```

In `__tests__/dify-client.test.ts`, add this entry to `operations`, right after the `getInfo` entry:

```ts
	{
		// The connection test reads the body itself (Plan decision f), so the Response comes back untouched.
		name: 'fetchInfo',
		call: c => c.fetchInfo(),
		method: 'GET',
		url: `${V1}/info`,
		user: 'none',
		result: 'binary',
	},
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts` Expected: FAIL: the two new files cannot resolve `@/lib/providers/dify/test-connection` and `@/lib/providers/registry`; in `dify-client.test.ts`, `covers every method of the client` fails (`fetchInfo` is not a method yet) and the `fetchInfo` cases throw `c.fetchInfo is not a function`.

- [ ] **Step 3: The client method**

In `lib/providers/dify/client.ts`, after the line `getInfo: () => send('/info').then(json<AppInfo>),` add:

```ts
		/**
		 * GET /info as Dify's raw answer, for the connection test (lib/providers/dify/test-connection.ts), which reads the
		 * body itself: an OK answer that is not Dify's JSON then reads as an upstream error, not as an unreachable host.
		 */
		fetchInfo: (signal?: AbortSignal) => send('/info', { signal }),
```

- [ ] **Step 4: The connection result and Dify's test**

Create `lib/providers/connection.ts`:

```ts
/**
 * What a provider's connection test found (Part 1 spec §4.2; decision 18): reachable, reachable with a warning, or why
 * it failed. Every provider's `testConnection` answers this shape (lib/providers/registry.ts); a test copies and saves
 * nothing.
 */
export type ConnectionTestResult =
	| { ok: true; warning?: { code: 'type_mismatch'; reported: string } }
	| { ok: false; code: 'key_refused' | 'unreachable' | 'upstream_error' }
```

Create `lib/providers/dify/test-connection.ts`:

```ts
import 'server-only'

import type { ConnectionTestResult } from '../connection'
import { difyClient } from './client'
import { DifyError } from './errors'
import type { DifySecrets, DifySettings } from './schema'

/** Plan decision f: a base that never answers is unreachable after 10 s (the hub's database timeout, Part 0). */
export const CONNECTION_TEST_TIMEOUT_MS = 10_000

/**
 * Part 1 spec §4.2 (decision 18): GET /info with the key (endpoint map §1.1: `{ name, description, tags, mode,
 * author_name }`, no end-user context). An answer with the chosen type is success, another `mode` a warning. Dify's 401
 * is a refused key. A network failure, the timeout (MDN `AbortSignal.timeout()`: the fetch rejects with a
 * "TimeoutError" DOMException, which the client turns into upstream_unreachable) or a 5xx is unreachable. Any other
 * answer is an upstream error, an OK answer that is not Dify's JSON included: a base without `/v1` reaches Dify's
 * console, which answers its HTML page with 200 (Review Focus 3).
 */
export const testDifyConnection = async (
	settings: DifySettings,
	secrets: DifySecrets,
): Promise<ConnectionTestResult> => {
	let response: Response
	try {
		response = await difyClient({ apiBase: settings.apiBase, apiKey: secrets.apiKey }).fetchInfo(
			AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
		)
	} catch (error) {
		if (!(error instanceof DifyError)) throw error
		if (error.code === 'upstream_unreachable' || error.status >= 500)
			return { ok: false, code: 'unreachable' }
		if (error.status === 401) return { ok: false, code: 'key_refused' }
		return { ok: false, code: 'upstream_error' }
	}
	let mode: unknown
	try {
		const body: unknown = await response.json()
		mode = typeof body === 'object' && body !== null ? (body as { mode?: unknown }).mode : undefined
	} catch {
		return { ok: false, code: 'upstream_error' }
	}
	if (typeof mode !== 'string') return { ok: false, code: 'upstream_error' }
	return mode === settings.appType
		? { ok: true }
		: { ok: true, warning: { code: 'type_mismatch', reported: mode } }
}
```

- [ ] **Step 5: Dify's definition and the registry**

Create `lib/providers/dify/provider.ts`:

```ts
import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import type { DifySecrets, DifySettings } from './schema'
import { testDifyConnection } from './test-connection'

/**
 * Dify as the server registry holds it (Part 1 spec §3): its schemas, its connection test, and what of its documents each
 * DTO carries (spec §2.3): the chat gets the type and the three chat switches, never the base or the key; the gallery
 * the type; the admin which secrets are set, never their values (DV 10, OWASP ASVS 14.2.6).
 */
export const difyProvider = {
	id: 'dify',
	...PROVIDER_SCHEMAS.dify,
	testConnection: testDifyConnection,
	chatFields: (settings: DifySettings) => ({
		appType: settings.appType,
		settings: {
			answerForm: settings.answerForm,
			enableUpdateAfterConversationStarts: settings.enableUpdateAfterConversationStarts,
			openingStatementDisplayMode: settings.openingStatementDisplayMode,
		},
	}),
	summaryFields: (settings: DifySettings) => ({ appType: settings.appType }),
	secretsSet: (secrets: DifySecrets) => ({ apiKey: secrets.apiKey.length > 0 }),
} as const
```

Create `lib/providers/registry.ts`:

```ts
import 'server-only'

import type { ConnectionTestResult } from './connection'
import { difyProvider } from './dify/provider'
import { isProviderId, type ProviderId } from './ids'
import type { ProviderSecrets, ProviderSettings } from './schemas'

/**
 * What the server knows of each provider (Part 1 spec §3): the schemas (lib/providers/schemas.ts), the connection test,
 * and the DTO fields its settings give (Plan decision e). The neutral data layer, the route guard and the actions reach a
 * provider only through here (spec §11). Server-only (DV 9a: the registry, testConnection and the clients).
 */
export interface ProviderDefinition<P extends ProviderId> {
	id: P
	testConnection: (
		settings: ProviderSettings<P>,
		secrets: ProviderSecrets<P>,
	) => Promise<ConnectionTestResult>
	chatFields: (settings: ProviderSettings<P>) => object
	summaryFields: (settings: ProviderSettings<P>) => object
	secretsSet: (secrets: ProviderSecrets<P>) => Record<string, boolean>
}

/**
 * One definition per provider id: `satisfies` over the mapped type makes the map exhaustive (DV 11), as LobeHub's
 * `providerRuntimeMap` and LibreChat's `providerConfigMap` are maps from type to adapter; unlike LobeHub's
 * `runtimeMap[provider] ?? LobeOpenAI`, an unknown id has no fallback here (getProvider).
 */
export const PROVIDERS = {
	dify: difyProvider,
} satisfies { [P in ProviderId]: ProviderDefinition<P> }

export type ProviderChatFields<P extends ProviderId> = ReturnType<
	(typeof PROVIDERS)[P]['chatFields']
>
export type ProviderSummaryFields<P extends ProviderId> = ReturnType<
	(typeof PROVIDERS)[P]['summaryFields']
>
export type ProviderSecretsSet<P extends ProviderId> = ReturnType<
	(typeof PROVIDERS)[P]['secretsSet']
>

/** The provider's definition, or undefined for an id the hub does not know: it fails closed (DV 11). */
export const getProvider = (id: string) => (isProviderId(id) ? PROVIDERS[id] : undefined)
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run --project unit __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts` Expected: PASS (the run decides the count; `dify-client.test.ts` gains the `fetchInfo` cases).

- [ ] **Step 7: Gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint lib/providers __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts && pnpm exec oxfmt --check lib/providers/connection.ts lib/providers/registry.ts lib/providers/dify/provider.ts lib/providers/dify/test-connection.ts lib/providers/dify/client.ts __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts` Expected: no findings.

- [ ] **Step 8: Commit**

```bash
git add lib/providers/connection.ts lib/providers/registry.ts lib/providers/dify/provider.ts lib/providers/dify/test-connection.ts lib/providers/dify/client.ts __tests__/dify-test-connection.test.ts __tests__/provider-registry.test.ts __tests__/dify-client.test.ts
git commit -m "feat(providers): add the server registry and Dify's connection test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 8: The app icon as an image kind of the settings pipeline

**Goal:** Make the app icon a third image kind of ADR-0030's settings pipeline (PNG, JPEG or WebP in, PNG at most 256 px out, 512 KB input cap), renaming the pipeline's brand-specific names, with branding behaviour unchanged.

Spec §4.4: the icon goes through `lib/settings/images.ts`, ADR-0030's pipeline, as a new image kind, `appIcon`: PNG, JPEG or WebP in; sharp with `limitInputPixels`, auto-orient and metadata stripped; re-encoded to PNG; at most 256 × 256 px, in proportion; an input cap. The pipeline's names lose "brand" now that it serves app icons too (`processImage`, `ImageError`, `IMAGE_MIME_TYPES`, `ImageErrorCode` in a new client-safe `lib/settings/image-rules.ts`), with no change for the branding images.

The input cap is **512 KB** (`APP_ICON_MAX_BYTES = 512 * 1024`), the owner's answer of 2026-10-12 (Plan decision af): a save with the icon stays under Next's default 1 MB Server Action body, as the branding logo's does.

**Files:**

- Create: `lib/settings/image-rules.ts`
- Modify: `lib/settings/images.ts` (whole file), `lib/settings/branding-rules.ts` (lines 19–24), `lib/settings/branding.ts` (the names, by the script in Step 4), `components/admin/settings/branding-settings.tsx` (lines 28–34, 109, 114)
- Test: `__tests__/settings-images.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/settings-images.test.ts __tests__/settings-branding.test.ts __tests__/branding-actions.test.ts` passes, the branding cases unchanged.
- [ ] In `__tests__/settings-images.test.ts`, the describe 'processImage for an app icon (Part 1 spec §4.4)' passes: the limits case (PNG/JPEG/WebP, 256 px, 512 KB), 're-encodes a %s icon as a PNG inside 256 × 256, in proportion' for png, jpeg and webp, and 'does not enlarge a small icon'.
- [ ] 'refuses an SVG icon as not_allowed' and 'refuses an icon over its byte limit before decoding' pass in `__tests__/settings-images.test.ts`.
- [ ] `git grep -nE "processBrandImage|BrandImageError|BRAND_IMAGE_MIME_TYPES|BRAND_IMAGE_ERROR_CODES|BrandImageErrorCode" -- ':!docs'` prints no output.
- [ ] `lib/settings/image-rules.ts` exists and `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` passes with tsc printing nothing.
- [ ] `pnpm exec oxlint` and `pnpm exec oxfmt --check` on the task files report no findings.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && git grep -nE "processBrandImage|BrandImageError|BRAND_IMAGE_MIME_TYPES|BRAND_IMAGE_ERROR_CODES|BrandImageErrorCode" -- ':!docs'; pnpm exec oxlint lib/settings components/admin/settings/branding-settings.tsx __tests__/settings-images.test.ts && pnpm exec oxfmt --check lib/settings/images.ts lib/settings/image-rules.ts lib/settings/branding-rules.ts lib/settings/branding.ts components/admin/settings/branding-settings.tsx __tests__/settings-images.test.ts` → tsc prints nothing; tests PASS; the grep prints no output; no lint or format findings

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `lib/settings/image-rules.ts` (client-safe): `IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const`, `IMAGE_ERROR_CODES = ['too_large', 'not_allowed'] as const`, `type ImageErrorCode`, `APP_ICON_MAX_BYTES = 512 * 1024`, `APP_ICON_SIZE = 256`.
  - `lib/settings/images.ts` (server-only): `type ImageKind = BrandImageKind | 'appIcon'`, `class ImageError extends Error { readonly code: ImageErrorCode }`, `processImage(kind: ImageKind, input: Buffer): Promise<ProcessedImage>` (`ProcessedImage` unchanged: `{ bytes, sha256, width, height }`), `MAX_INPUT_PIXELS` unchanged.

- [ ] **Step 1: Write the failing tests**

In `__tests__/settings-images.test.ts`, rename the pipeline's names and import the rules:

```bash
sed -i -E 's/\bprocessBrandImage\b/processImage/g; s/\bBrandImageError\b/ImageError/g' __tests__/settings-images.test.ts
```

Then replace line 4 (as the `sed` left it), `import { ImageError, MAX_INPUT_PIXELS, processImage } from '@/lib/settings/images'`, with:

```ts
import { APP_ICON_MAX_BYTES, APP_ICON_SIZE, IMAGE_MIME_TYPES } from '@/lib/settings/image-rules'
import { ImageError, MAX_INPUT_PIXELS, processImage } from '@/lib/settings/images'
```

and append at the end of the file:

```ts
// Part 1 spec §4.4: the app icon is a third kind of the same pipeline.
describe('processImage for an app icon (Part 1 spec §4.4)', () => {
	it('keeps the limits the spec sets: PNG, JPEG or WebP, 256 px, a 512 KB input (owner, 2026-10-12)', () => {
		expect(IMAGE_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp'])
		expect(APP_ICON_SIZE).toBe(256)
		expect(APP_ICON_MAX_BYTES).toBe(512 * 1024)
	})

	it.each(['png', 'jpeg', 'webp'] as const)(
		're-encodes a %s icon as a PNG inside 256 × 256, in proportion',
		async format => {
			const out = await processImage('appIcon', await solid(1024, 512)[format]().toBuffer())
			const meta = await sharp(out.bytes).metadata()
			expect(meta.format).toBe('png')
			expect([out.width, out.height]).toEqual([256, 128])
			expect([meta.width, meta.height]).toEqual([256, 128])
		},
	)

	it('does not enlarge a small icon', async () => {
		const out = await processImage('appIcon', await solid(64, 64).png().toBuffer())
		expect([out.width, out.height]).toEqual([64, 64])
	})

	it('refuses an SVG icon as not_allowed', async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
		)
		expect(await outcome(processImage('appIcon', svg))).toBe('not_allowed')
	})

	it('refuses an icon over its byte limit before decoding', async () => {
		expect(await outcome(processImage('appIcon', Buffer.alloc(APP_ICON_MAX_BYTES + 1)))).toBe(
			'too_large',
		)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/settings-images.test.ts` Expected: FAIL with `Failed to resolve import "@/lib/settings/image-rules"`.

- [ ] **Step 3: The rules module**

Create `lib/settings/image-rules.ts`:

```ts
/*
 * The image upload rules every kind shares (settings spec §4.4; Part 1 spec §4.4), client-safe so the pickers' quick
 * check reads the same values as the server. The server decodes and decides (OWASP File Upload Cheat Sheet).
 */

/** What a file picker offers and the browser's quick check takes. */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Why the server refused an image: over the byte limit, or not a PNG, JPEG or WebP that decodes. */
export const IMAGE_ERROR_CODES = ['too_large', 'not_allowed'] as const
export type ImageErrorCode = (typeof IMAGE_ERROR_CODES)[number]

/**
 * An app icon's input cap (512 KB, as the logo's; owner, 2026-10-12): with the form's other fields a save stays under
 * Next's default Server Action body limit (Next docs, next.config.js options: "By default, the maximum size of the
 * request body sent to a Server Action is 1MB"; the limit "applies to the raw HTTP request body").
 */
export const APP_ICON_MAX_BYTES = 512 * 1024

/** Spec §4.4: the stored icon is at most this many pixels on its longer side. */
export const APP_ICON_SIZE = 256
```

In `lib/settings/branding-rules.ts`, delete lines 19–24 (the `BRAND_IMAGE_MIME_TYPES` comment and constant, the blank line, the `BRAND_IMAGE_ERROR_CODES` comment, constant and type) and the blank line after them, so `BRAND_IMAGE_MAX_BYTES`'s closing `}` is followed by one blank line and `/** The two public image routes (spec §4.5). */`.

- [ ] **Step 4: The pipeline**

Replace the whole of `lib/settings/images.ts` with:

```ts
import 'server-only'

import { createHash } from 'node:crypto'

import sharp, { type Metadata } from 'sharp'

import { BRAND_IMAGE_MAX_BYTES, type BrandImageKind } from './branding-rules'
import { APP_ICON_MAX_BYTES, APP_ICON_SIZE, type ImageErrorCode } from './image-rules'

/** An image the hub produced (settings spec §4.4): a PNG, its SHA-256 (hex) and its size in pixels. */
export interface ProcessedImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
}

/** The images the pipeline takes: the two brand images (ADR-0030) and an app's icon (Part 1 spec §4.4). */
export type ImageKind = BrandImageKind | 'appIcon'

export class ImageError extends Error {
	constructor(
		public readonly code: ImageErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options)
		this.name = 'ImageError'
	}
}

/** A resource limit in OWASP's sense, tighter than sharp's default `0x3FFF * 0x3FFF` (sharp src/common.h). */
export const MAX_INPUT_PIXELS = 4096 * 4096

/**
 * The decoded formats accepted (spec §4.4 step 3); the browser's declared type is never read. SVG is refused (OWASP File
 * Upload Cheat Sheet, "restricted formats", "resource limits"): librsvg, the renderer inside sharp, decodes `data:` rasters
 * itself while it renders, outside `limitInputPixels`, and sharp's `svg.stylesheet` cannot switch them off, because librsvg
 * lets author `!important` rules and `style` attributes override it (`rsvg/src/css.rs:861-867,1051-1059`,
 * `element.rs:430-444`, `properties.rs:946-953`) and cascades a nested `data:` document without it (`document.rs:501,718-726`,
 * librsvg 2.62.0). A 415 KB SVG reached 1.18 GB of memory that way.
 */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp'])

const MAX_BYTES: Readonly<Record<ImageKind, number>> = {
	...BRAND_IMAGE_MAX_BYTES,
	appIcon: APP_ICON_MAX_BYTES,
}

/**
 * The box each kind is fitted into (sharp `resize`). The logo: three times its largest display height (64 px), up to 4:1,
 * never enlarged. The favicon: twice the 32 px tab size, padded to a square. The app icon: at most 256 px on its longer
 * side, in proportion, never enlarged (Part 1 spec §4.4).
 */
const SHAPE: Readonly<
	Record<
		ImageKind,
		{ width: number; height: number; fit: 'inside' | 'contain'; withoutEnlargement: boolean }
	>
> = {
	logo: { width: 768, height: 192, fit: 'inside', withoutEnlargement: true },
	favicon: { width: 64, height: 64, fit: 'contain', withoutEnlargement: false },
	appIcon: { width: APP_ICON_SIZE, height: APP_ICON_SIZE, fit: 'inside', withoutEnlargement: true },
}

/**
 * Decode, check and re-encode an image as PNG (OWASP File Upload Cheat Sheet: "decode and re-encode to an allowed image
 * format, explicitly removing unnecessary metadata … restricted formats, resource limits"). sharp refuses input on any
 * decoder warning by default (`failOn`), removes metadata from its output by default ("By default all metadata will be
 * removed"), and `autoOrient` applies the EXIF orientation first, so a phone photo stays upright.
 */
export async function processImage(kind: ImageKind, input: Buffer): Promise<ProcessedImage> {
	if (input.length > MAX_BYTES[kind]) throw new ImageError('too_large')
	const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true }
	let meta: Metadata
	try {
		meta = await sharp(input, options).metadata()
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height)
		throw new ImageError('not_allowed')
	try {
		const { data, info } = await sharp(input, options)
			.resize({ ...SHAPE[kind], background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.png()
			.toBuffer({ resolveWithObject: true })
		return {
			bytes: data,
			sha256: createHash('sha256').update(data).digest('hex'),
			width: info.width,
			height: info.height,
		}
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
}
```

(`resize` takes `width`, `height`, `fit`, `withoutEnlargement` and `background` in one options object, as the logo and favicon passed them before; sharp "Resizing images", `resize(options)`.)

Rename the pipeline's names in the branding module and the picker's types in the branding page:

```bash
sed -i -E 's/\bprocessBrandImage\b/processImage/g; s/\bBrandImageError\b/ImageError/g' lib/settings/branding.ts
sed -i -E 's/\bBRAND_IMAGE_MIME_TYPES\b/IMAGE_MIME_TYPES/g' components/admin/settings/branding-settings.tsx
```

In `components/admin/settings/branding-settings.tsx`, the `branding-rules` import (lines 28–34) still lists `IMAGE_MIME_TYPES`; replace it with:

```tsx
import {
	BRAND_IMAGE_MAX_BYTES,
	BRAND_NAME_MAX,
	effectiveShowName,
	type BrandImageKind,
} from '@/lib/settings/branding-rules'
import { IMAGE_MIME_TYPES } from '@/lib/settings/image-rules'
```

- [ ] **Step 5: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/settings-images.test.ts __tests__/settings-branding.test.ts __tests__/branding-actions.test.ts` Expected: PASS (the branding cases unchanged; the app-icon cases new).

Run: `git grep -nE "processBrandImage|BrandImageError|BRAND_IMAGE_MIME_TYPES|BRAND_IMAGE_ERROR_CODES|BrandImageErrorCode" -- ':!docs'` Expected: no output.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint lib/settings components/admin/settings/branding-settings.tsx __tests__/settings-images.test.ts && pnpm exec oxfmt --check lib/settings/images.ts lib/settings/image-rules.ts lib/settings/branding-rules.ts lib/settings/branding.ts components/admin/settings/branding-settings.tsx __tests__/settings-images.test.ts` Expected: no findings.

- [ ] **Step 6: Commit**

```bash
git add lib/settings components/admin/settings/branding-settings.tsx __tests__/settings-images.test.ts
git commit -m "feat(settings): take app icons through the image pipeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 9: The shared route guard and the checked documents

**Goal:** Add the shared resolveAppRoute guard and have getAppAccess return an app's documents as its provider's schemas read them, with resolveDifyRoute built on the guard and the 25 Dify routes unchanged.

Spec §2.3 and §3 (`lib/providers/route.ts`). `getAppAccess` answers the final `AppAccess` — `{ id, enabled }` plus the app's documents as its provider's schemas read them — and `resolveAppRoute(params, provider)` is the shared guard: session → `z.uuid()` on the id → `getAppAccess` (visibility) → enabled → provider match, answering 401, 404 `app_not_found` (unknown, invisible, malformed or another provider's) or 403 `app_disabled` in the envelope. `resolveDifyRoute` wraps it and builds today's Dify context from `settings.apiBase` and `secrets.apiKey`; the 25 Dify routes do not change.

The table still has Part 0's columns until Task 11. Here the settings document is read from them through `storedSettings(row)`, which maps the columns exactly as Task 11's data migration will (spec §2.4), and the secrets document is `{ apiKey: row.apiKey }`; Task 11 replaces both with the two `jsonb` columns (Plan decision a). `readDocuments` — the check and its log line — stays as written here.

**Files:**

- Create: `lib/providers/route.ts`
- Modify: `lib/data/apps.ts` (imports; `AppAccess`; `readAccess`; one line each in `updateApp` and `syncApp`), `lib/providers/dify/route.ts` (whole file)
- Test: `__tests__/provider-route.test.ts` (new), `__tests__/dify-route.test.ts` (whole file), `__tests__/data-apps.test.ts`, `__tests__/data-apps-sync.test.ts`, `__tests__/dify-routes-{app,app-upstream,chat,files,run}.test.ts` (their `access` fixtures)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit` on `__tests__/provider-route.test.ts`, `__tests__/dify-route.test.ts`, `__tests__/data-apps.test.ts`, `__tests__/data-apps-sync.test.ts`, `__tests__/data-apps-access.test.ts` and the five `__tests__/dify-routes-{app,app-upstream,chat,files,run}.test.ts` passes.
- [ ] `__tests__/provider-route.test.ts` passes: 401 before the id or app is looked at, 'answers a malformed id as an unknown app without reading it', 'answers 403 app_disabled for a disabled app, before the provider check', "answers another provider's app as unknown", and 'answers a logged 500 envelope when %s throws'.
- [ ] `__tests__/dify-route.test.ts` passes, including 'builds the context with the account id as the Dify user, never the email, and a client from the documents'.
- [ ] The `readDocuments` describe in `__tests__/data-apps.test.ts` passes: valid documents with no log line, and null for an unknown provider, broken settings and broken secrets, logging only the app id and the code and never 'app-secret' or 'dify.example'.
- [ ] `git grep -n "credentials:" -- __tests__/dify-routes-*.test.ts` prints nothing after the sed in Step 5.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` passes with tsc printing nothing, and oxlint and oxfmt --check report no findings.
- [ ] `pnpm test:e2e e2e/chat.spec.ts e2e/malformed-ids.spec.ts e2e/app-access.spec.ts --project desktop-light` passes.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm exec oxlint lib/data/apps.ts lib/providers/route.ts lib/providers/dify/route.ts __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts && pnpm exec oxfmt --check lib/data/apps.ts lib/providers/route.ts lib/providers/dify/route.ts __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-routes-*.test.ts && pnpm test:e2e e2e/chat.spec.ts e2e/malformed-ids.spec.ts e2e/app-access.spec.ts --project desktop-light` → tsc prints nothing; unit tests PASS; no findings; e2e PASS

**Interfaces:**

- Consumes: Task 6's `checkDocuments`, `StoredDocuments`, `ProviderId`.
- Produces:
  - `lib/data/apps.ts`: `type AppAccess = { id: string; enabled: boolean } & StoredDocuments` (for Dify `{ id, enabled, provider: 'dify', settings: DifySettings, secrets: DifySecrets }`); `getAppAccess(actor, id): Promise<AppAccess | null>` (null when missing, invisible, or its documents fail); `readDocuments(appId: string, provider: string, settings: unknown, secrets: unknown): StoredDocuments | null`, which logs `'Stored app documents refused:', { appId, code }` on a failure; and two module-private helpers in the same file, `storedSettingsColumns` (the Part 0 columns a settings read selects) and `storedSettings(row)` (those columns as the settings document), which Task 10's reads use and Task 11 removes with the columns.
  - `lib/providers/route.ts`: `type ProviderAppAccess<P> = Extract<AppAccess, { provider: P }>`, `type ResolvedAppRoute<P> = { ok: true; actor: SessionUser; app: ProviderAppAccess<P> } | { ok: false; response: Response }`, `resolveAppRoute<P extends ProviderId>(params: Promise<{ appId: string }>, provider: P): Promise<ResolvedAppRoute<P>>`.
  - `lib/providers/dify/route.ts`: `resolveDifyRoute(params)` and `DifyRouteContext` (`{ user, actor, appId, apiBase, dify }`) as before; re-exports `errorResponseFrom` and `jsonNoStore`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/provider-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))

import { resolveAppRoute } from '@/lib/providers/route'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user' }
const params = (appId = APP_ID) => Promise.resolve({ appId })
const app = {
	id: APP_ID,
	enabled: true,
	provider: 'dify',
	settings: { apiBase: 'http://d/v1' },
	secrets: { apiKey: 'k' },
}
const refusal = async (resolved: Awaited<ReturnType<typeof resolveAppRoute>>) => {
	expect(resolved.ok).toBe(false)
	return resolved.ok
		? null
		: { status: resolved.response.status, body: await resolved.response.json() }
}
const notFound = {
	status: 404,
	body: { code: 'app_not_found', message: 'No such app.', status: 404 },
}

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
})

// Part 1 spec §3: session → z.uuid() on the id → getAppAccess (visibility) → enabled → provider match.
describe('resolveAppRoute', () => {
	it('answers 401 before it looks at the id or the app', async () => {
		verifySession.mockResolvedValue(null)
		for (const appId of [APP_ID, 'not-a-uuid'])
			expect(await refusal(await resolveAppRoute(params(appId), 'dify'))).toEqual({
				status: 401,
				body: { code: 'unauthorized', message: 'Sign in required.', status: 401 },
			})
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	// Part 0 spec §3.2: PostgreSQL refuses a malformed uuid with 22P02, so it never reaches the read.
	it('answers a malformed id as an unknown app without reading it', async () => {
		verifySession.mockResolvedValue(actor)
		expect(await refusal(await resolveAppRoute(params('not-a-uuid'), 'dify'))).toEqual(notFound)
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	// B3 spec §4.2: getAppAccess answers null for a missing app, one the actor may not see, and one whose documents fail.
	it('answers an app the read does not return as unknown', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual(notFound)
		expect(getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
	})
	it('answers 403 app_disabled for a disabled app, before the provider check', async () => {
		verifySession.mockResolvedValue(actor)
		for (const provider of ['dify', 'agui']) {
			getAppAccess.mockResolvedValue({ ...app, enabled: false, provider })
			expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual({
				status: 403,
				body: { code: 'app_disabled', message: 'This app is disabled.', status: 403 },
			})
		}
	})
	it("answers another provider's app as unknown", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({ ...app, provider: 'agui' })
		expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual(notFound)
	})
	it('hands back the actor and the app of this provider', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(app)
		expect(await resolveAppRoute(params(), 'dify')).toEqual({ ok: true, actor, app })
	})
	// A database or environment failure answers the envelope, not Next's empty 500.
	it.each([
		['the session read', () => verifySession.mockRejectedValue(new Error('db down'))],
		[
			'the app read',
			() => {
				verifySession.mockResolvedValue(actor)
				getAppAccess.mockRejectedValue(new Error('db down'))
			},
		],
	])('answers a logged 500 envelope when %s throws', async (_case, arrange) => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		arrange()
		expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual({
			status: 500,
			body: { code: 'internal_error', message: 'Internal Server Error', status: 500 },
		})
		expect(errorSpy).toHaveBeenCalledWith('resolveAppRoute:', expect.any(Error))
		errorSpy.mockRestore()
	})
})
```

Replace the whole of `__tests__/dify-route.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, difyClient } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	difyClient: vi.fn(() => ({ marker: 'client' })),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/providers/dify/client', () => ({ difyClient }))

import { resolveDifyRoute } from '@/lib/providers/dify/route'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = { id: 'u1', email: 'jane@example.com', name: null }
const params = Promise.resolve({ appId: APP_ID })

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	difyClient.mockClear()
})

// The shared guard's own cases are in __tests__/provider-route.test.ts; these are the Dify half (Part 1 spec §3).
describe('resolveDifyRoute', () => {
	it("answers the guard's refusal as it is and builds no Dify client", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok ? null : resolved.response.status).toBe(404)
		// A missing app and one the actor may not use reach no Dify client, so no request goes to Dify.
		expect(difyClient).not.toHaveBeenCalled()
	})
	it('builds the context with the account id as the Dify user, never the email, and a client from the documents', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({
			id: APP_ID,
			enabled: true,
			provider: 'dify',
			settings: { apiBase: 'http://d/v1' },
			secrets: { apiKey: 'k' },
		})
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(true)
		if (!resolved.ok) return
		expect(resolved.ctx).toEqual({
			user: 'u1',
			actor,
			appId: APP_ID,
			apiBase: 'http://d/v1',
			dify: { marker: 'client' },
		})
		// The context's `actor` keeps the email for the routes' own checks; the Dify end user is the id (ADR-0026).
		expect(resolved.ctx.user).not.toContain('@')
		expect(difyClient).toHaveBeenCalledWith({ apiBase: 'http://d/v1', apiKey: 'k' })
	})
})
```

In `__tests__/data-apps.test.ts`, change the import list (lines 11–29) to add `readDocuments,` (in alphabetical place, after `parseTags,`), and append at the end of the file:

```ts
// Spec §2.3: a row whose documents fail is logged by its id and the failing document, never its values, and is never
// returned half-typed.
describe('readDocuments', () => {
	const settings = {
		apiBase: 'https://dify.example/v1',
		appType: 'chat',
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	}
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads valid documents without a log line', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(readDocuments('a1', 'dify', settings, { apiKey: 'app-secret' })).toEqual({
			provider: 'dify',
			settings,
			secrets: { apiKey: 'app-secret' },
		})
		expect(spy).not.toHaveBeenCalled()
	})
	it.each([
		['an unknown provider', 'agui', settings, { apiKey: 'app-secret' }, 'unknown_provider'],
		[
			'broken settings',
			'dify',
			{ ...settings, appType: null },
			{ apiKey: 'app-secret' },
			'invalid_settings',
		],
		['broken secrets', 'dify', settings, { apiKey: '' }, 'invalid_secrets'],
	])(
		'answers null for %s and logs the app id and the code only',
		(_label, provider, stored, secrets, code) => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
			expect(readDocuments('a1', provider, stored, secrets)).toBeNull()
			expect(spy).toHaveBeenCalledWith('Stored app documents refused:', { appId: 'a1', code })
			expect(JSON.stringify(spy.mock.calls)).not.toContain('app-secret')
			expect(JSON.stringify(spy.mock.calls)).not.toContain('dify.example')
		},
	)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts` Expected: FAIL: `provider-route` cannot resolve `@/lib/providers/route`; `dify-route` fails the context case with `expected false to be true` (today's guard reads `app.credentials`, which the new fixture lacks, and its catch answers a 500); `data-apps` fails with `readDocuments is not a function`.

- [ ] **Step 3: The documents in the data layer**

In `lib/data/apps.ts`:

Add the import `import { checkDocuments, type StoredDocuments } from '@/lib/providers/schemas'` to the import block.

Replace the `AppAccess` interface:

```ts
/** What a Dify route needs: whether the app may be used, and how to reach Dify. */
export interface AppAccess {
	id: string
	enabled: boolean
	credentials: DifyCredentials
}
```

with:

```ts
/**
 * What a provider route needs (spec §2.3): whether the app may be used, and its documents as its provider's schemas read
 * them. Built only for the server-only route guard (lib/providers/route.ts) and the admin writes; never a DTO.
 */
export type AppAccess = { id: string; enabled: boolean } & StoredDocuments
```

Replace `readAccess` (from its comment `/** The access columns only: …` to its closing `}`):

```ts
/** The access columns only: the Dify routes (with visibleTo), and the admin writes that re-read Dify with the stored key (without). */
const readAccess = async (id: string, visible?: SQL): Promise<AppAccess | null> => {
	const [row] = await getDb()
		.select({
			id: difyApps.id,
			isEnabled: difyApps.isEnabled,
			apiBase: difyApps.apiBase,
			apiKey: difyApps.apiKey,
		})
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visible))
		.limit(1)
	return row
		? {
				id: row.id,
				enabled: row.isEnabled,
				credentials: { apiBase: row.apiBase, apiKey: row.apiKey },
			}
		: null
}
```

with:

```ts
/**
 * Task 11 moves the documents into `apps.settings` and `apps.secrets`; until then they are read from Part 0's columns,
 * mapped exactly as Task 11's data migration maps them (spec §2.4), so the checks below already run on what the reshaped
 * row will hold.
 */
const storedSettingsColumns = {
	mode: difyApps.mode,
	apiBase: difyApps.apiBase,
	enableAnswerForm: difyApps.enableAnswerForm,
	answerFormFeedbackText: difyApps.answerFormFeedbackText,
	enableUpdateInputAfterStarts: difyApps.enableUpdateInputAfterStarts,
	openingStatementDisplayMode: difyApps.openingStatementDisplayMode,
}

const storedSettings = (
	row: Pick<
		AppRow,
		| 'mode'
		| 'apiBase'
		| 'enableAnswerForm'
		| 'answerFormFeedbackText'
		| 'enableUpdateInputAfterStarts'
		| 'openingStatementDisplayMode'
	>,
) => ({
	provider: 'dify',
	settings: {
		apiBase: row.apiBase,
		appType: row.mode,
		answerForm: { enabled: row.enableAnswerForm, feedbackText: row.answerFormFeedbackText ?? '' },
		enableUpdateAfterConversationStarts: row.enableUpdateInputAfterStarts,
		openingStatementDisplayMode:
			row.openingStatementDisplayMode === 'always' ? 'always' : 'default',
	},
})

/**
 * A row's documents as its provider's schemas read them, or null (spec §2.3; decision 17: checked on every read). A row
 * that fails is logged by its id and which document failed, never their values (OWASP Logging Cheat Sheet, "Data to
 * exclude"), and is never returned half-typed: users meet it as an unknown app.
 */
export const readDocuments = (
	appId: string,
	provider: string,
	settings: unknown,
	secrets: unknown,
): StoredDocuments | null => {
	const check = checkDocuments(provider, settings, secrets)
	if (check.ok) return check.documents
	console.error('Stored app documents refused:', { appId, code: check.code })
	return null
}

/** The access read: the provider routes (with visibleTo), and the admin writes (without). Null when missing or refused. */
const readAccess = async (id: string, visible?: SQL): Promise<AppAccess | null> => {
	const [row] = await getDb()
		.select({
			id: difyApps.id,
			isEnabled: difyApps.isEnabled,
			...storedSettingsColumns,
			apiKey: difyApps.apiKey,
		})
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visible))
		.limit(1)
	if (!row) return null
	const { provider, settings } = storedSettings(row)
	const documents = readDocuments(row.id, provider, settings, { apiKey: row.apiKey })
	return documents && { id: row.id, enabled: row.isEnabled, ...documents }
}
```

In `updateApp`, replace `const credentials = { apiBase: input.apiBase, apiKey: input.apiKey || access.credentials.apiKey }` with `const credentials = { apiBase: input.apiBase, apiKey: input.apiKey || access.secrets.apiKey }`.

In `syncApp`, replace `const { info, iconColumns, partial } = await fetchDifyProfile(access.credentials)` with:

```ts
const { info, iconColumns, partial } = await fetchDifyProfile({
	apiBase: access.settings.apiBase,
	apiKey: access.secrets.apiKey,
})
```

- [ ] **Step 4: The shared guard and the Dify wrapper**

Create `lib/providers/route.ts`:

```ts
import 'server-only'

import { verifySession, type SessionUser } from '@/lib/auth/session'
import { getAppAccess, type AppAccess } from '@/lib/data/apps'
import { errorResponse, errorResponseFrom } from '@/lib/http/errors'
import { isId } from '@/lib/ids'

import type { ProviderId } from './ids'

/** An app's access once the guard has seen that its provider is P. */
export type ProviderAppAccess<P extends ProviderId> = Extract<AppAccess, { provider: P }>

export type ResolvedAppRoute<P extends ProviderId> =
	| { ok: true; actor: SessionUser; app: ProviderAppAccess<P> }
	| { ok: false; response: Response }

const appNotFound = (): Response => errorResponse('app_not_found', 'No such app.', 404)

const isOfProvider = <P extends ProviderId>(
	app: AppAccess,
	provider: P,
): app is ProviderAppAccess<P> => app.provider === provider

/**
 * The shared guard of every provider route (Part 1 spec §3; charter §4.1; ADR-0023): the session first, so a revoked
 * token learns nothing about apps; then the id, which must be a UUID (Part 0 spec §3.2: PostgreSQL refuses a malformed
 * one with 22P02; lib/ids.ts); then the app as the actor may see it (getAppAccess applies visibleTo and reads the
 * documents with their provider's schemas); then whether it is enabled; then whether it is this route's provider. An
 * unknown, invisible or malformed id and another provider's app all answer 404 app_not_found, so nothing can be told
 * apart (B3 spec §4.2); a disabled app answers 403 app_disabled. A failure of the session or the app read (a lost
 * database, an EnvError) answers a logged 500 envelope, not Next's empty one.
 */
export const resolveAppRoute = async <P extends ProviderId>(
	params: Promise<{ appId: string }>,
	provider: P,
): Promise<ResolvedAppRoute<P>> => {
	try {
		const actor = await verifySession()
		if (!actor)
			return { ok: false, response: errorResponse('unauthorized', 'Sign in required.', 401) }
		const { appId } = await params
		const app = isId(appId) ? await getAppAccess(actor, appId) : null
		if (!app) return { ok: false, response: appNotFound() }
		if (!app.enabled)
			return { ok: false, response: errorResponse('app_disabled', 'This app is disabled.', 403) }
		if (!isOfProvider(app, provider)) return { ok: false, response: appNotFound() }
		return { ok: true, actor, app }
	} catch (error) {
		return { ok: false, response: errorResponseFrom(error, 'resolveAppRoute') }
	}
}
```

Replace the whole of `lib/providers/dify/route.ts` with:

```ts
import 'server-only'

import type { SessionUser } from '@/lib/auth/session'
import { resolveAppRoute } from '@/lib/providers/route'

import { difyClient, type DifyClient } from './client'

export { errorResponseFrom } from '@/lib/http/errors'
export { jsonNoStore } from '@/lib/http/response'

export interface DifyRouteContext {
	/** The Dify end user: the account's permanent id, never the email (ADR-0026). */
	user: string
	actor: SessionUser
	appId: string
	apiBase: string
	dify: DifyClient
}

export type ResolvedDifyRoute =
	| { ok: true; ctx: DifyRouteContext }
	| { ok: false; response: Response }

/**
 * The first steps of every Dify handler (charter §4.1): the shared guard (lib/providers/route.ts: session → id → app →
 * enabled → provider), then the Dify context from the app's documents. The API base and the key never leave the server.
 */
export const resolveDifyRoute = async (
	params: Promise<{ appId: string }>,
): Promise<ResolvedDifyRoute> => {
	const resolved = await resolveAppRoute(params, 'dify')
	if (!resolved.ok) return resolved
	const { actor, app } = resolved
	return {
		ok: true,
		ctx: {
			user: actor.id,
			actor,
			appId: app.id,
			apiBase: app.settings.apiBase,
			dify: difyClient({ apiBase: app.settings.apiBase, apiKey: app.secrets.apiKey }),
		},
	}
}
```

- [ ] **Step 5: Bring the route and data-layer fixtures to the new access shape**

The five route test files mock `getAppAccess` with `credentials: { apiBase, apiKey }`; give them the documents instead:

```bash
sed -i -E "s#^(\s*)credentials: \{ apiBase: ('[^']+'), apiKey: ('[^']+') \},#\1provider: 'dify',\n\1settings: { apiBase: \2 },\n\1secrets: { apiKey: \3 },#" \
	__tests__/dify-routes-app.test.ts __tests__/dify-routes-app-upstream.test.ts __tests__/dify-routes-chat.test.ts __tests__/dify-routes-files.test.ts __tests__/dify-routes-run.test.ts
```

Expected: `git grep -n "credentials:" -- __tests__/dify-routes-*.test.ts` prints nothing.

In `__tests__/data-apps-sync.test.ts`, the access read now selects the document columns and checks them, so its stored row carries them. Replace the `stored` fixture (lines 88–94):

```ts
// What the narrow access read returns (the fake ignores the selection; the selection test checks it).
const stored = {
	id: 'a1',
	isEnabled: true,
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
}
```

with:

```ts
// What the narrow access read returns (the fake ignores the selection; the selection test checks it): the Part 0
// columns the documents are read from until Task 11 stores them.
const stored = {
	id: 'a1',
	isEnabled: true,
	mode: 'chat',
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
	enableAnswerForm: false,
	answerFormFeedbackText: null,
	enableUpdateInputAfterStarts: false,
	openingStatementDisplayMode: null,
}
```

and in `it('syncApp reads only the access columns', …)` replace the expected list, which Task 4's oxfmt run left on one line,

```ts
expect(Object.keys(db.fields ?? {}).sort()).toEqual(['apiBase', 'apiKey', 'id', 'isEnabled'])
```

with:

```ts
expect(Object.keys(db.fields ?? {}).sort()).toEqual([
	'answerFormFeedbackText',
	'apiBase',
	'apiKey',
	'enableAnswerForm',
	'enableUpdateInputAfterStarts',
	'id',
	'isEnabled',
	'mode',
	'openingStatementDisplayMode',
])
```

- [ ] **Step 6: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/data-apps-access.test.ts __tests__/dify-routes-app.test.ts __tests__/dify-routes-app-upstream.test.ts __tests__/dify-routes-chat.test.ts __tests__/dify-routes-files.test.ts __tests__/dify-routes-run.test.ts` Expected: PASS.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint lib/data/apps.ts lib/providers/route.ts lib/providers/dify/route.ts __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts && pnpm exec oxfmt --check lib/data/apps.ts lib/providers/route.ts lib/providers/dify/route.ts __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-routes-*.test.ts` Expected: no findings.

Run (no other `next dev` of this checkout; `pnpm test:db` not running): `pnpm test:e2e e2e/chat.spec.ts e2e/malformed-ids.spec.ts e2e/app-access.spec.ts --project desktop-light` Expected: PASS (the Dify routes answer as before through the new guard).

- [ ] **Step 7: Commit**

```bash
git add lib/data/apps.ts lib/providers/route.ts lib/providers/dify/route.ts __tests__/provider-route.test.ts __tests__/dify-route.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-routes-app.test.ts __tests__/dify-routes-app-upstream.test.ts __tests__/dify-routes-chat.test.ts __tests__/dify-routes-files.test.ts __tests__/dify-routes-run.test.ts
git commit -m "feat(providers): guard provider routes with the shared resolveAppRoute

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 10: The user side: the gallery, the chat page dispatch and the client registry

**Goal:** Make the gallery and chat page provider-aware: the data layer returns provider-neutral AppSummary and ChatAppDto, cards name the provider and type with a provider fallback icon, and the chat page dispatches through ProviderChat to the unchanged Dify workspace.

Spec §2.3 (`ChatAppDto`, `AppSummary`), §3 (`components/provider-ui/`) and §5. The gallery receives `AppSummary` straight from the data layer (the enabled apps the actor may use whose settings read cleanly); the card's description names the provider and, for Dify, the type ("Dify · Chatflow", E10); an app without a stored image shows its provider's fallback icon (E11: Dify `ApartmentOutlined`, unknown `AppstoreOutlined`). The chat page renders `ProviderChat`, the one client switch, which renders today's `ChatWorkspace` for Dify; the workspace reads `app.appType` where it read `app.mode` (three places), and its avatar `app.hasIcon` (the emoji branch goes, decision 19). The admin DTO's base, `AppDto`, trades `icon` for `provider` and `hasIcon` so the shared `AppIcon` serves the admin table too; Task 11 reshapes the rest of it.

The DTO reads never select the secrets (Plan decision ab); they check the settings with `checkSettings` and log a refusal the way `readDocuments` does. They still read Part 0's columns through Task 9's `storedSettings` until Task 11.

**Files:**

- Create: `components/provider-ui/registry.tsx`, `components/provider-ui/provider-chat.tsx`, `__tests__/provider-ui.test.ts`
- Rename: `components/apps/app-modes.ts` → `components/provider-ui/dify/app-types.ts`
- Delete: `components/apps/app-summary.ts`, `__tests__/app-summary.test.ts`
- Modify: `lib/data/apps.ts`, `components/apps/{app-card,app-icon,app-gallery}.tsx`, `app/(user)/apps/page.tsx`, `app/(user)/chat/page.tsx`, `app/(user)/chat/[appId]/page.tsx`, `components/chat/{app-context,chat-workspace}.tsx`, `components/chat/hooks/use-workflow-run.ts` (line 33), `components/chat/workflow-view/workflow-view.tsx` (line 125), `components/chat/chat-view/conversation-sidebar.tsx` (`AppAvatar`), `components/admin/apps/app-management.tsx` (the `AppIcon` and the app-types import), `components/admin/apps/app-settings-fields.tsx` (the app-types import), `locales/{en,zh,ar}/translation.json`, `e2e/apps.spec.ts`, `e2e/chat-files.spec.ts`, `e2e/screenshots.spec.ts` (four readiness waits)
- Test: `__tests__/{data-apps,data-apps-access,data-apps-sync,apps-page,chat-index-page,chat-page,app-form-values,i18n-locales}.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/data-apps.test.ts __tests__/data-apps-access.test.ts __tests__/data-apps-sync.test.ts __tests__/apps-page.test.ts __tests__/chat-index-page.test.ts __tests__/chat-page.test.ts __tests__/app-form-values.test.ts __tests__/i18n-locales.test.ts` passes.
- [ ] `__tests__/provider-ui.test.ts` passes: 'has an entry per provider id (DV 11)', 'gives each provider its fallback icon, and an unknown one the generic icon' and 'names the provider and the app type, or the provider alone'.
- [ ] In `__tests__/data-apps.test.ts`, the DTO cases pass: the chat DTO never contains 'dify.example', the gallery card carries the provider and type only, and 'reads the settings alone for the DTO reads, with the same log line on a refusal'; in `__tests__/data-apps-access.test.ts` the 'listApps: the enabled apps under the whole rule for a user, the enabled apps for an admin' case passes.
- [ ] `components/apps/app-summary.ts` and `__tests__/app-summary.test.ts` are removed, `components/apps/app-modes.ts` is renamed to `components/provider-ui/dify/app-types.ts`, and `grep -c "getByRole('img', { name: 'apartment' })" e2e/screenshots.spec.ts` prints `4` while `grep -c "🤖" e2e/screenshots.spec.ts` prints `0`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` prints nothing and `pnpm test` passes.
- [ ] `pnpm test:e2e e2e/apps.spec.ts e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts` passes on the three projects, including the new 'a card names its provider and type, and shows the provider icon when no image is stored' and 'an app without a stored image shows its first letter, not an emoji'.
- [ ] `pnpm test:e2e e2e/screenshots.spec.ts --project desktop-light` passes.

**Verify:** `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e e2e/apps.spec.ts e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts && pnpm test:e2e e2e/screenshots.spec.ts --project desktop-light` → tsc prints nothing; unit tests PASS; e2e PASS on the three projects, then the screenshots spec PASS on desktop-light

**Interfaces:**

- Consumes: Task 6's `checkSettings`, `StoredSettings`, `ProviderId`, `isProviderId`; Task 7's `PROVIDERS`, `ProviderChatFields<P>`, `ProviderSummaryFields<P>`; Task 9's `storedSettingsColumns`, `storedSettings`, `readDocuments` (unchanged).
- Produces:
  - `lib/data/apps.ts`: `type AppRecord = { id: string; name: string; description: string; tags: string[]; enabled: boolean; hasIcon: boolean } & StoredSettings`; `type ChatAppDto` (for Dify `{ id, provider: 'dify', name, description, enabled, hasIcon, appType: AppMode, settings: { answerForm, enableUpdateAfterConversationStarts, openingStatementDisplayMode } }`); `type AppSummary` (for Dify `{ id, provider: 'dify', name, description, tags, hasIcon, appType: AppMode }`); `toChatAppDto(record: AppRecord): ChatAppDto`; `toAppSummary(record: AppRecord): AppSummary`; `readSettings(appId, provider, settings): StoredSettings | null`; `listApps(actor): Promise<AppSummary[]>`; `getChatApp(actor, id): Promise<ChatAppDto | null>`; `AppDto` now has `provider: ProviderId` and `hasIcon: boolean` and no `icon`; `AppIcon` (the type) and `iconOf` are gone.
  - `components/provider-ui/registry.tsx` (client): `PROVIDER_UI` (`{ dify: { labelKey: 'provider.dify', Icon: ApartmentOutlined, typeLabelKeys: APP_MODE_NAME_KEYS } }`), `GenericAppIcon` (`AppstoreOutlined`), `providerIcon(provider: string): ComponentType`, `providerLine(t: TFunction, provider: ProviderId, appType?: string): string`.
  - `components/provider-ui/provider-chat.tsx` (client): default `ProviderChat({ app }: { app: ChatAppDto })`.
  - `components/provider-ui/dify/app-types.ts`: `APP_MODE_NAME_KEYS`, `APP_MODE_OPTION_KEYS`, `APP_MODE_OPTIONS` (unchanged contents).
  - `components/apps/app-icon.tsx`: `AppIcon({ appId, provider, hasIcon, size })`, `appIconUrl(appId)`.
  - `components/chat/app-context.tsx`: `type DifyChatApp = Extract<ChatAppDto, { provider: 'dify' }>`; `AppContextValue.app: DifyChatApp`.
  - i18n key `provider.dify` ("Dify" in every language).

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/provider-ui.test.ts`:

```ts
import { ApartmentOutlined, AppstoreOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { PROVIDER_UI, providerIcon, providerLine } from '@/components/provider-ui/registry'
import { PROVIDER_IDS } from '@/lib/providers/ids'

const t = ((key: string) => key) as unknown as TFunction

describe('the client registry (spec §3)', () => {
	it('has an entry per provider id (DV 11)', () => {
		expect(Object.keys(PROVIDER_UI).sort()).toEqual([...PROVIDER_IDS].sort())
	})
	// E11: Dify's fallback icon, and the generic one for a provider the browser does not know.
	it('gives each provider its fallback icon, and an unknown one the generic icon', () => {
		expect(providerIcon('dify')).toBe(ApartmentOutlined)
		expect(providerIcon('agui')).toBe(AppstoreOutlined)
	})
	// E9 and E10: "Dify · Chatflow".
	it('names the provider and the app type, or the provider alone', () => {
		expect(providerLine(t, 'dify', 'advanced-chat')).toBe('provider.dify · app_mode.name.chatflow')
		expect(providerLine(t, 'dify', 'workflow')).toBe('provider.dify · app_mode.name.workflow')
		expect(providerLine(t, 'dify')).toBe('provider.dify')
		expect(providerLine(t, 'dify', 'rag-pipeline')).toBe('provider.dify')
		expect(providerLine(t, 'dify', 'toString')).toBe('provider.dify')
	})
})
```

In `__tests__/data-apps.test.ts`:

- replace the import list (from `import {` on line 11 to `} from '@/lib/data/apps'`) with:

```ts
import {
	createApp,
	deleteApp,
	grantRowsFor,
	ICON_MAX_BYTES,
	iconColumnsFrom,
	listAdminApps,
	lockApp,
	parseTags,
	readDocuments,
	readIconBytes,
	readSettings,
	settingsOf,
	syncApp,
	toAdminAppDto,
	toAdminAppDtos,
	toAppDto,
	toAppSummary,
	toChatAppDto,
	updateApp,
} from '@/lib/data/apps'
```

- in the `row` fixture (lines 31–52), replace the four lines `iconType: 'emoji',`, `icon: '🍵',`, `iconBackground: '#FFEAD5',`, `hasIconImage: false,` with the one line `hasIcon: false,`;
- replace `describe('iconOf and settingsOf', () => {` and its first case (`it('maps an emoji icon, an image icon and no icon', …)`, 6 lines) with `describe('settingsOf', () => {`;
- replace the whole `describe('DTOs', () => { … })` (found by that first line; Tasks 4 and 9 shifted its numbers) with:

```ts
// Spec §2.3: what each DTO carries; never the key, and outside the admin's never the API base.
describe('DTOs', () => {
	const record = {
		id: 'a1',
		provider: 'dify' as const,
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		enabled: true,
		hasIcon: true,
		settings: {
			apiBase: 'https://dify.example/v1',
			appType: 'advanced-chat' as const,
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'always' as const,
		},
	}
	it('the admin DTO carries the provider, whether an image is stored, and the base; never the key', () => {
		const dto = toAppDto(row)
		expect(dto).toMatchObject({ id: 'a1', provider: 'dify', hasIcon: false, mode: 'advanced-chat' })
		expect(dto).not.toHaveProperty('icon')
		expect(JSON.stringify(dto)).not.toContain('app-secret')
		expect(toAppDto({ ...row, mode: 'rag-pipeline' }).mode).toBeNull()
	})
	it('the chat DTO carries the type and the chat switches, never the base', () => {
		const dto = toChatAppDto(record)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			enabled: true,
			hasIcon: true,
			appType: 'advanced-chat',
			settings: {
				answerForm: { enabled: true, feedbackText: 'Thanks' },
				enableUpdateAfterConversationStarts: false,
				openingStatementDisplayMode: 'always',
			},
		})
		expect(JSON.stringify(dto)).not.toContain('dify.example')
	})
	it('the gallery card carries the provider and the type, never the base or the switches', () => {
		const summary = toAppSummary(record)
		expect(summary).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			tags: ['a', 'b'],
			hasIcon: true,
			appType: 'advanced-chat',
		})
	})
})
```

- append to the end of `describe('readDocuments', …)` (Task 9's block), before its closing `})`:

```ts
it('reads the settings alone for the DTO reads, with the same log line on a refusal', () => {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
	expect(readSettings('a1', 'dify', settings)).toEqual({ provider: 'dify', settings })
	expect(readSettings('a1', 'dify', { ...settings, apiBase: 'nope' })).toBeNull()
	expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
		appId: 'a1',
		code: 'invalid_settings',
	})
})
```

In `__tests__/data-apps-access.test.ts`, replace the case `it('listApps: the whole rule for a user, nothing for an admin', …)` (lines 78–83) with:

```ts
it('listApps: the enabled apps under the whole rule for a user, the enabled apps for an admin', async () => {
	await listApps(user)
	expect(render(where.mock.calls[0]![0])).toEqual(
		render(and(eq(difyApps.isEnabled, true), visibleTo(user))),
	)
	await listApps(admin)
	expect(render(where.mock.calls[1]![0])).toEqual(render(eq(difyApps.isEnabled, true)))
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/data-apps.test.ts __tests__/data-apps-access.test.ts` Expected: FAIL: `provider-ui` cannot resolve `@/components/provider-ui/registry`; `data-apps` fails on `toAppSummary is not a function` (and the DTO cases); `data-apps-access`'s `listApps` case gets `visibleTo(user)` alone.

- [ ] **Step 3: The DTOs in the data layer**

In `lib/data/apps.ts`:

Add these imports to the block:

```ts
import type { ProviderId } from '@/lib/providers/ids'
import {
	PROVIDERS,
	type ProviderChatFields,
	type ProviderSummaryFields,
} from '@/lib/providers/registry'
```

and change `import { checkDocuments, type StoredDocuments } from '@/lib/providers/schemas'` to `import { checkDocuments, checkSettings, type StoredDocuments, type StoredSettings } from '@/lib/providers/schemas'`.

Replace the `dtoColumns` comment and object, and the `DtoRow` type (from `/**` before `const dtoColumns = {` through the closing `}` of `DtoRow`):

```ts
/**
 * Every column the DTOs read, never the key or the icon bytes (charter §4.2: explicit columns; the image itself is
 * served through getAppIcon). Whether an image is stored is computed by the database.
 */
const dtoColumns = {
	id: difyApps.id,
	createdAt: difyApps.createdAt,
	updatedAt: difyApps.updatedAt,
	name: difyApps.name,
	mode: difyApps.mode,
	description: difyApps.description,
	tags: difyApps.tags,
	isEnabled: difyApps.isEnabled,
	apiBase: difyApps.apiBase,
	enableAnswerForm: difyApps.enableAnswerForm,
	answerFormFeedbackText: difyApps.answerFormFeedbackText,
	enableUpdateInputAfterStarts: difyApps.enableUpdateInputAfterStarts,
	openingStatementDisplayMode: difyApps.openingStatementDisplayMode,
	iconType: difyApps.iconType,
	icon: difyApps.icon,
	iconBackground: difyApps.iconBackground,
	hasIconImage: sql<boolean>`${difyApps.iconImage} IS NOT NULL`.mapWith(Boolean),
}

/** A row as the DTOs read it (dtoColumns). */
type DtoRow = Omit<
	AppRow,
	'apiKey' | 'iconImage' | 'iconMime' | 'accessMode' | 'enableAnnotation'
> & {
	hasIconImage: boolean
}
```

with:

```ts
/**
 * Whether an image is stored, computed by the database: no DTO read selects the bytes (charter §4.2: explicit columns;
 * the image itself is served through getAppIcon).
 */
const hasIcon = sql<boolean>`${difyApps.iconImage} IS NOT NULL`.mapWith(Boolean)

/** Every column the admin DTO reads, never the key or the icon bytes. */
const dtoColumns = {
	id: difyApps.id,
	createdAt: difyApps.createdAt,
	updatedAt: difyApps.updatedAt,
	name: difyApps.name,
	mode: difyApps.mode,
	description: difyApps.description,
	tags: difyApps.tags,
	isEnabled: difyApps.isEnabled,
	apiBase: difyApps.apiBase,
	enableAnswerForm: difyApps.enableAnswerForm,
	answerFormFeedbackText: difyApps.answerFormFeedbackText,
	enableUpdateInputAfterStarts: difyApps.enableUpdateInputAfterStarts,
	openingStatementDisplayMode: difyApps.openingStatementDisplayMode,
	hasIcon,
}

/** A row as the admin DTO reads it (dtoColumns). */
type DtoRow = Omit<
	AppRow,
	| 'apiKey'
	| 'iconImage'
	| 'iconMime'
	| 'accessMode'
	| 'enableAnnotation'
	| 'iconType'
	| 'icon'
	| 'iconBackground'
> & { hasIcon: boolean }
```

Delete the `AppIcon` type with its comment (`/** What the browser needs to draw the icon (charter §4.1): …` and the three lines of the type).

In `interface AppDto`, replace `icon: AppIcon` with the two lines `provider: ProviderId` and `hasIcon: boolean`.

Delete `interface ChatAppDto` with its comment (`/** The chat's view: no key, no base (file links go through the proxy). */` and the 9 lines of the interface).

Delete `iconOf` (from `export const iconOf = (` to its closing `}`, and the blank line after it).

In `toAppDto`, replace `icon: iconOf(row),` with the two lines `provider: 'dify',` and `hasIcon: row.hasIcon,` (Task 11 reads the provider from the row).

Delete `toChatAppDto` (the old one, `export const toChatAppDto = (row: DtoRow): ChatAppDto => ({ … })`).

After `readDocuments` (Task 9), add:

```ts
/** The settings alone, as a user's DTO reads need them, checked and logged as readDocuments does (spec §2.3). */
export const readSettings = (
	appId: string,
	provider: string,
	settings: unknown,
): StoredSettings | null => {
	const check = checkSettings(provider, settings)
	if (check.ok) return check.documents
	console.error('Stored app documents refused:', { appId, code: check.code })
	return null
}

/**
 * The columns a user's DTO reads (spec §2.3): the neutral fields and the settings, never the secrets, the key or the icon
 * bytes (Plan decision ab: a mapper cannot leak what is never read).
 */
const recordColumns = {
	id: difyApps.id,
	name: difyApps.name,
	description: difyApps.description,
	tags: difyApps.tags,
	isEnabled: difyApps.isEnabled,
	hasIcon,
	...storedSettingsColumns,
}

type RecordRow = {
	id: string
	name: string
	description: string | null
	tags: unknown
	isEnabled: boolean
	hasIcon: boolean
} & Parameters<typeof storedSettings>[0]

/** An app as a user's DTOs see it: its neutral fields and its settings as its provider's schema reads them. */
export type AppRecord = {
	id: string
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
} & StoredSettings

const toRecord = (row: RecordRow): AppRecord | null => {
	const { provider, settings } = storedSettings(row)
	const documents = readSettings(row.id, provider, settings)
	return (
		documents && {
			id: row.id,
			name: row.name,
			description: row.description ?? '',
			tags: parseTags(row.tags),
			enabled: row.isEnabled,
			hasIcon: row.hasIcon,
			...documents,
		}
	)
}

type ChatAppCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'enabled' | 'hasIcon'>

/** The chat's view (spec §2.3): a union keyed by provider; never the base URL or the secrets (file links go through the proxy). */
export type ChatAppDto = {
	[P in ProviderId]: ChatAppCommon & { provider: P } & ProviderChatFields<P>
}[ProviderId]

type SummaryCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'tags' | 'hasIcon'>

/** What a gallery card shows (spec §2.3, E10): the provider's own fields are its summary fields (for Dify, the type). */
export type AppSummary = {
	[P in ProviderId]: SummaryCommon & { provider: P } & ProviderSummaryFields<P>
}[ProviderId]

export const toChatAppDto = (record: AppRecord): ChatAppDto => ({
	id: record.id,
	provider: record.provider,
	name: record.name,
	description: record.description,
	enabled: record.enabled,
	hasIcon: record.hasIcon,
	...PROVIDERS[record.provider].chatFields(record.settings),
})

export const toAppSummary = (record: AppRecord): AppSummary => ({
	id: record.id,
	provider: record.provider,
	name: record.name,
	description: record.description,
	tags: record.tags,
	hasIcon: record.hasIcon,
	...PROVIDERS[record.provider].summaryFields(record.settings),
})
```

Replace `listApps`:

```ts
export async function listApps(actor: SessionUser): Promise<AppDto[]> {
	const rows = await getDb()
		.select(dtoColumns)
		.from(difyApps)
		.where(visibleTo(actor))
		.orderBy(desc(difyApps.createdAt))
	return rows.map(toAppDto)
}
```

with:

```ts
/**
 * The gallery (spec §2.3, §5): the enabled apps the actor may use, newest first, as cards. An app whose settings fail
 * is left out (readSettings logs it); the access rule is visibleTo, as for every read (ADR-0027).
 */
export async function listApps(actor: SessionUser): Promise<AppSummary[]> {
	const rows = await getDb()
		.select(recordColumns)
		.from(difyApps)
		.where(and(eq(difyApps.isEnabled, true), visibleTo(actor)))
		.orderBy(desc(difyApps.createdAt))
	return rows.flatMap(row => {
		const record = toRecord(row)
		return record ? [toAppSummary(record)] : []
	})
}
```

Replace `getChatApp`:

```ts
/** Null for a missing app and for one the actor may not use alike (spec §4.2: no difference to probe). */
export async function getChatApp(actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const [row] = await getDb()
		.select(dtoColumns)
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visibleTo(actor)))
		.limit(1)
	return row ? toChatAppDto(row) : null
}
```

with:

```ts
/**
 * Null for a missing app, one the actor may not use, and one whose settings fail alike (B3 spec §4.2: no difference to
 * probe; Part 1 spec §2.3: users meet a broken row as an unknown app).
 */
export async function getChatApp(actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const [row] = await getDb()
		.select(recordColumns)
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visibleTo(actor)))
		.limit(1)
	const record = row ? toRecord(row) : null
	return record ? toChatAppDto(record) : null
}
```

`listApps` and `getChatApp` stay where they are in the file; `recordColumns` is defined above them (after `readDocuments`), which keeps it out of the temporal dead zone.

- [ ] **Step 4: The client registry and the chat switch**

Run: `mkdir -p components/provider-ui/dify && git mv components/apps/app-modes.ts components/provider-ui/dify/app-types.ts`

Replace the first comment line of `components/provider-ui/dify/app-types.ts`, `/*` … ` * Translation keys per Dify app mode: the short name (labels, filters) and the admin form's option text.`, so it reads:

```ts
/*
 * Dify's app types in the client registry (Part 1 spec §3): the translation key of each type's short name (the card,
 * the table and its filter) and of the admin form's option text.
```

(the rest of the file, the `as const satisfies` note and the three exports, stays).

Create `components/provider-ui/registry.tsx`:

```tsx
'use client'

import { ApartmentOutlined, AppstoreOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import type { ComponentType } from 'react'

import { isProviderId, type ProviderId } from '@/lib/providers/ids'

import { APP_MODE_NAME_KEYS } from './dify/app-types'

/*
 * The client half of the provider registry (Part 1 spec §3): what the gallery and the admin table show of a provider,
 * its name, its fallback icon (E11) and the names of its app types. The chat views (provider-chat.tsx) and the admin
 * form sections (provider-form-section.tsx, Task 12) live in modules of their own: once a file is marked "use client",
 * "all of its imports and the components it directly renders are included in the client bundle" (Next "Server and Client
 * Components"), and the gallery should not carry the chat. `satisfies` keeps the map exhaustive over ProviderId (DV 11);
 * `as const` keeps each key a literal, which the typed `t()` requires (types/i18next.d.ts).
 */
export const PROVIDER_UI = {
	dify: { labelKey: 'provider.dify', Icon: ApartmentOutlined, typeLabelKeys: APP_MODE_NAME_KEYS },
} as const satisfies Record<
	ProviderId,
	{ labelKey: string; Icon: ComponentType; typeLabelKeys: Readonly<Record<string, string>> }
>

/** E11: the icon of an app whose provider the browser does not know. */
export const GenericAppIcon = AppstoreOutlined

/** The icon an app without a stored image shows (E11): its provider's, or the generic one. */
export const providerIcon = (provider: string): ComponentType =>
	isProviderId(provider) ? PROVIDER_UI[provider].Icon : GenericAppIcon

/** E9 and E10: the provider's name and, when the provider has types and the app's is known, the type ("Dify · Chatflow"). */
export const providerLine = (t: TFunction, provider: ProviderId, appType?: string): string => {
	const ui = PROVIDER_UI[provider]
	const typeKey =
		appType !== undefined && Object.hasOwn(ui.typeLabelKeys, appType)
			? ui.typeLabelKeys[appType as keyof typeof ui.typeLabelKeys]
			: undefined
	return typeKey ? `${t(ui.labelKey)} · ${t(typeKey)}` : t(ui.labelKey)
}
```

Create `components/provider-ui/provider-chat.tsx`:

```tsx
'use client'

import ChatWorkspace from '@/components/chat/chat-workspace'
import type { ChatAppDto } from '@/lib/data/apps'

/**
 * The chat page's one client switch (Part 1 spec §3; DV 9b): the server page hands over the chat DTO, a serializable
 * prop, and the provider's chat view is chosen here, on the client (React "use client" caveats: a server module may
 * pass a client component only serializable values). The switch is exhaustive: a provider added to ProviderId without a
 * view fails tsc at `satisfies never`.
 */
export default function ProviderChat({ app }: { app: ChatAppDto }) {
	switch (app.provider) {
		case 'dify':
			return <ChatWorkspace app={app} />
		default:
			return app satisfies never
	}
}
```

Add the provider's name to the locales:

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

// "Dify" is a product name, written the same in every language.
for (const language of ['en', 'zh', 'ar']) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	tree.provider = { ...tree.provider, dify: 'Dify' }
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

In `__tests__/i18n-locales.test.ts`, add `'provider.dify',` to the `latinOnly` set (after `'admin_users.directory_starttls',`), and replace the comment line `// The directory connection's protocol names (spec §6.6) stay as written in every language.` with `// The directory connection's protocol names (spec §6.6) and the provider names stay as written in every language.`.

- [ ] **Step 5: The gallery**

Replace the whole of `components/apps/app-icon.tsx` with:

```tsx
'use client'

import { Avatar } from 'antd'

import { providerIcon } from '@/components/provider-ui/registry'

/** The stored icon image's URL (charter §4.4). */
export const appIconUrl = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/icon`

/**
 * An app's icon (Part 1 spec §5, E11): the stored image through the icon route, or its provider's fallback icon on the
 * square Avatar's default grey, at today's sizes. Emoji icons are gone (decision 19).
 */
export default function AppIcon({
	appId,
	provider,
	hasIcon,
	size = 'large',
}: {
	appId: string
	provider: string
	hasIcon: boolean
	size?: 'large' | 'small'
}) {
	if (hasIcon) {
		return (
			<Avatar
				shape="square"
				size={size}
				src={appIconUrl(appId)}
				alt=""
			/>
		)
	}
	const Icon = providerIcon(provider)
	return (
		<Avatar
			shape="square"
			size={size}
			icon={<Icon />}
		/>
	)
}
```

In `components/apps/app-card.tsx`:

- replace lines 7–10:

```tsx
import styles from './app-gallery.module.css'
import AppIcon from './app-icon'
import { APP_MODE_NAME_KEYS } from './app-modes'
import type { AppSummary } from './app-summary'
```

with:

```tsx
import { providerLine } from '@/components/provider-ui/registry'
import type { AppSummary } from '@/lib/data/apps'

import styles from './app-gallery.module.css'
import AppIcon from './app-icon'
```

- replace the `Card.Meta` (lines 28–38):

```tsx
<Card.Meta
	avatar={
		<AppIcon
			appId={app.id}
			icon={app.icon}
			mode={app.mode}
		/>
	}
	title={app.name}
	description={app.mode ? t(APP_MODE_NAME_KEYS[app.mode]) : undefined}
/>
```

with:

```tsx
<Card.Meta
	avatar={
		<AppIcon
			appId={app.id}
			provider={app.provider}
			hasIcon={app.hasIcon}
		/>
	}
	title={app.name}
	// E10: the provider and, when it has one, the app's type, as today's plain description text.
	description={providerLine(t, app.provider, 'appType' in app ? app.appType : undefined)}
/>
```

In `components/apps/app-gallery.tsx`, replace `import type { AppSummary } from './app-summary'` with `import type { AppSummary } from '@/lib/data/apps'` (oxfmt moves it into the `@/` group).

Run: `git rm components/apps/app-summary.ts __tests__/app-summary.test.ts`

Replace the whole of `app/(user)/apps/page.tsx` with:

```tsx
import AppGallery from '@/components/apps/app-gallery'
import UserShell from '@/components/shell/user-shell'
import { requireUser } from '@/lib/auth/session'
import { listApps } from '@/lib/data/apps'

/**
 * The server page checks the session, reads the cards from the DAL (the enabled apps the actor may use, already trimmed
 * to AppSummary) and hands them to the client gallery (ADR-0020).
 */
export default async function AppListPage() {
	const actor = await requireUser()
	const apps = await listApps(actor)
	return (
		<UserShell>
			<AppGallery apps={apps} />
		</UserShell>
	)
}
```

In `app/(user)/chat/page.tsx`, replace lines 8–11:

```tsx
/** `/chat` opens the first enabled app, or the app list when there is none. */
export default async function ChatIndexPage() {
	const actor = await requireUser()
	const first = (await listApps(actor)).find(app => app.enabled)
```

with:

```tsx
/** `/chat` opens the gallery's first app (listApps: enabled, and the actor's to use), or the app list when there is none. */
export default async function ChatIndexPage() {
	const actor = await requireUser()
	const [first] = await listApps(actor)
```

- [ ] **Step 6: The chat page and the Dify workspace**

In `app/(user)/chat/[appId]/page.tsx`, replace line 2 `import ChatWorkspace from '@/components/chat/chat-workspace'` with `import ProviderChat from '@/components/provider-ui/provider-chat'`, replace the comment line ` * The app is loaded on the server (ADR-0020's pattern; charter §4.1) and handed to the workspace as a DTO` with ` * The app is loaded on the server (ADR-0020's pattern; charter §4.1) and handed to its provider's chat view as a DTO`, and replace the returned element:

```tsx
// Keyed by the app: another app starts from a fresh workspace (React: resetting state with a key).
return (
	<ChatWorkspace
		key={appId}
		app={app}
	/>
)
```

with:

```tsx
// Keyed by the app: another app starts from a fresh view (React: resetting state with a key). ProviderChat picks the
// provider's chat view on the client (Part 1 spec §3).
return (
	<ProviderChat
		key={appId}
		app={app}
	/>
)
```

In `components/chat/app-context.tsx`, replace lines 5–12:

```tsx
import type { ChatAppDto } from '@/lib/data/apps'
import type { DifyApi } from '@/lib/providers/dify/browser'
import type { AppParameters, SiteSettings } from '@/lib/providers/dify/types'

/** The open app and what was loaded for it: one value per page, provided by ChatWorkspace. */
export interface AppContextValue {
	app: ChatAppDto
```

with:

```tsx
import type { ChatAppDto } from '@/lib/data/apps'
import type { DifyApi } from '@/lib/providers/dify/browser'
import type { AppParameters, SiteSettings } from '@/lib/providers/dify/types'

/** A Dify app's chat DTO: what ProviderChat hands this workspace (Part 1 spec §5). */
export type DifyChatApp = Extract<ChatAppDto, { provider: 'dify' }>

/** The open app and what was loaded for it: one value per page, provided by ChatWorkspace. */
export interface AppContextValue {
	app: DifyChatApp
```

(Task 3's oxfmt run may have ordered these three imports differently; keep the order the file has.)

In `components/chat/chat-workspace.tsx`, replace `import type { ChatAppDto } from '@/lib/data/apps'` with nothing (delete the line), add `type DifyChatApp,` to the `./app-context` import so it reads `import { AppContext, type AppContextValue, type DifyChatApp } from './app-context'`, replace `export default function ChatWorkspace({ app }: { app: ChatAppDto }) {` with `export default function ChatWorkspace({ app }: { app: DifyChatApp }) {`, and replace `const mode = state.value.app.mode` with `const mode = state.value.app.appType`.

In `components/chat/hooks/use-workflow-run.ts`, replace line 33 `const mode = app.mode` with `const mode = app.appType`.

In `components/chat/workflow-view/workflow-view.tsx`, replace line 125 `workflowApp={app.mode === 'workflow'}` with `workflowApp={app.appType === 'workflow'}`.

In `components/chat/chat-view/conversation-sidebar.tsx`, replace `AppAvatar` with its comment (from `/**` before `export function AppAvatar(` to the function's closing `}`):

```tsx
/**
 * The app's icon: the stored Dify icon (an emoji, or the image through the icon route, so the Dify host never
 * reaches the browser; charter §4.1, §4.4), else the first letter of its name (also while the image loads or fails).
 */
export function AppAvatar({ size, alt }: Pick<AvatarProps, 'size' | 'alt'>) {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	const icon = app.icon
	return (
		<Avatar
			size={size}
			alt={alt ?? name}
			shape="square"
			src={icon?.kind === 'image' ? `/api/apps/${encodeURIComponent(app.id)}/icon` : undefined}
			style={
				icon?.kind === 'emoji' && icon.background ? { backgroundColor: icon.background } : undefined
			}
		>
			{icon?.kind === 'emoji' ? icon.emoji : name.slice(0, 1)}
		</Avatar>
	)
}
```

with:

```tsx
/**
 * The app's icon: the stored image through the icon route, so the provider's host never reaches the browser (charter
 * §4.1, §4.4), else the first letter of its name (also while the image loads or fails). Emoji icons are gone (Part 1
 * decision 19).
 */
export function AppAvatar({ size, alt }: Pick<AvatarProps, 'size' | 'alt'>) {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	return (
		<Avatar
			size={size}
			alt={alt ?? name}
			shape="square"
			src={app.hasIcon ? `/api/apps/${encodeURIComponent(app.id)}/icon` : undefined}
		>
			{name.slice(0, 1)}
		</Avatar>
	)
}
```

- [ ] **Step 7: The admin table's compile-level changes**

In `components/admin/apps/app-management.tsx`, replace `import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from '@/components/apps/app-modes'` with `import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from '@/components/provider-ui/dify/app-types'`, and in the Name column replace

```tsx
<AppIcon
	appId={app.id}
	icon={app.icon}
	mode={app.mode}
	size="small"
/>
```

with

```tsx
<AppIcon
	appId={app.id}
	provider={app.provider}
	hasIcon={app.hasIcon}
	size="small"
/>
```

In `components/admin/apps/app-settings-fields.tsx`, replace `import { APP_MODE_OPTION_KEYS, APP_MODE_OPTIONS } from '@/components/apps/app-modes'` with `import { APP_MODE_OPTION_KEYS, APP_MODE_OPTIONS } from '@/components/provider-ui/dify/app-types'`. (Task 13 rewrites the table, Task 12 the form.)

- [ ] **Step 8: Bring the page tests and the fixtures along**

In `__tests__/app-form-values.test.ts`, replace the fixture line `	icon: null,` with the two lines `	provider: 'dify',` and `	hasIcon: false,`.

In `__tests__/data-apps-sync.test.ts`, in the `dtoRow` fixture of `describe('reads select explicit columns (charter §4.2)', …)` (around line 353), replace the four lines `iconType: 'image',`, `icon: 'file-id',`, `iconBackground: null,`, `hasIconImage: true,` with `hasIcon: true,`, and in the case `'%s reads neither the key nor the icon bytes'` replace `expect(fields).toContain('hasIconImage')` with `expect(fields).toContain('hasIcon')` and the last line `expect(Array.isArray(result) ? result[0] : result).toMatchObject({ icon: { kind: 'image' } })` with `expect(Array.isArray(result) ? result[0] : result).toMatchObject({ hasIcon: true })`. The two DTO reads select no secret: `expect(fields).not.toContain('apiKey')` stays and now pins Plan decision ab.

Replace the second case of `__tests__/apps-page.test.ts` (from `it('hands the gallery the enabled apps, trimmed', …)` to its closing `})`), and the `settings` and `app` fixtures above the `describe` (lines 18–35 as Task 4 left them), with:

```ts
const summary = {
	id: 'a1',
	provider: 'dify',
	name: 'App a1',
	description: '',
	tags: [],
	hasIcon: false,
	appType: 'chat',
}
```

(before the `describe`) and:

```ts
// The DAL trims and filters (listApps answers AppSummary for the enabled apps the actor may use); the page passes them on.
it('hands the gallery the summaries the DAL read', async () => {
	requireUser.mockResolvedValue(actor)
	listApps.mockResolvedValue([summary])
	const page = await AppListPage()
	expect(listApps).toHaveBeenCalledWith(actor)
	expect(page).toMatchObject({
		type: UserShell,
		props: { children: { type: AppGallery, props: { apps: [summary] } } },
	})
})
```

In `__tests__/chat-index-page.test.ts`, replace line 16 `const app = (id: string, enabled: boolean) => ({ id, enabled })` with `const app = (id: string) => ({ id })`, and replace the cases from `it('reads the apps as the session actor and opens the first enabled one', …)` through `it('sends the actor to /apps when no enabled app is visible to it', …)` (lines 35–48) with:

```ts
// listApps answers the enabled apps the actor may use (lib/data/apps.ts), so the page opens the first.
it('reads the apps as the session actor and opens the first one', async () => {
	requireUser.mockResolvedValue(actor)
	listApps.mockResolvedValue([app('a2'), app('a3')])
	await expect(ChatIndexPage()).rejects.toBe(redirectSignal)
	expect(listApps).toHaveBeenCalledWith(actor)
	expect(redirect).toHaveBeenCalledWith('/chat/a2')
})
```

In `__tests__/chat-page.test.ts`:

- replace `const { requireUser, getChatApp, ChatWorkspace, AppUnavailable, redirectSignal } = vi.hoisted(` with `const { requireUser, getChatApp, ProviderChat, AppUnavailable, redirectSignal } = vi.hoisted(` and, inside, `ChatWorkspace: () => null,` with `ProviderChat: () => null,`;
- replace `vi.mock('@/components/chat/chat-workspace', () => ({ default: ChatWorkspace }))` with `vi.mock('@/components/provider-ui/provider-chat', () => ({ default: ProviderChat }))`;
- replace the `app` fixture (lines 20–32 after Task 4) with:

```ts
const app = {
	id: '3b241101-e2bb-4255-8caf-4136c566a962',
	provider: 'dify',
	name: 'Tea',
	description: '',
	enabled: true,
	hasIcon: false,
	appType: 'chat',
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	},
}
```

- replace `it('hands the workspace the chat DTO, keyed by the app', async () => {` with `it("hands the provider's chat view the chat DTO, keyed by the app", async () => {` and `type: ChatWorkspace,` with `type: ProviderChat,`.

- [ ] **Step 9: The e2e expectations**

In `e2e/apps.spec.ts`, replace the case `test('a card shows the Dify emoji icon, or the mode icon when the app has no site', …)` (lines 20–29) with:

```ts
// E10 and E11: the card names the provider and the type; without a stored image it shows the provider's icon.
test('a card names its provider and type, and shows the provider icon when no image is stored', async ({
	page,
}) => {
	await page.goto('/apps')
	const stub = page.getByRole('link', card('Stub app'))
	await expect(stub.getByText('Dify · Chatbot', { exact: true })).toBeVisible()
	// antd icons render role="img" named after the icon: Dify's fallback is ApartmentOutlined.
	await expect(stub.getByRole('img', { name: 'apartment' })).toBeVisible()
	// The seeded row's emoji (Dify's /site icon) is no longer shown (decision 19).
	await expect(stub.getByText('🤖')).toHaveCount(0)
	await expect(
		page.getByRole('link', card(NO_SITE_APP.name)).getByText('Dify · Workflow', { exact: true }),
	).toBeVisible()
})
```

In `e2e/chat-files.spec.ts`, replace the case `test('the app icon is the stored emoji on its colour, in the welcome panel and the sider', …)` (lines 266–286) with:

```ts
// Decision 19: an emoji stored by an older sync is no longer drawn; the avatar shows the app's first letter.
test('an app without a stored image shows its first letter, not an emoji', async ({
	page,
	isMobile,
}, testInfo) => {
	await withIconApp(
		testInfo,
		{ icon_type: 'emoji', icon: '🦊', icon_background: '#FFEAD5' },
		async app => {
			await page.goto(`/chat/${app.id}?isNewCvst=1`)
			// The welcome panel's avatar and, on a desktop, the sider's (hidden below md). The stub's /site names the app
			// "Stub app", which the avatar shows first.
			await expect(page.locator('.ant-avatar', { hasText: /^S$/ }).visible()).toHaveCount(
				isMobile ? 1 : 2,
			)
			await expect(page.getByText('🦊')).toHaveCount(0)
		},
	)
})
```

`e2e/screenshots.spec.ts` waits for the seeded emoji before four shots (the `apps` and `admin` entries of `signedInPages`, `openAppManagement`, and the branded `/apps` shot); the cards and the table now draw Dify's fallback icon instead (E11; antd icons are `role="img"`, named after the icon):

```bash
sed -i "s/page.getByText('🤖').first()/page.getByRole('img', { name: 'apartment' }).first()/" e2e/screenshots.spec.ts
grep -c "getByRole('img', { name: 'apartment' })" e2e/screenshots.spec.ts
```

Expected: `4`, and `grep -c "🤖" e2e/screenshots.spec.ts` prints `0`.

- [ ] **Step 10: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/data-apps.test.ts __tests__/data-apps-access.test.ts __tests__/data-apps-sync.test.ts __tests__/apps-page.test.ts __tests__/chat-index-page.test.ts __tests__/chat-page.test.ts __tests__/app-form-values.test.ts __tests__/i18n-locales.test.ts` Expected: PASS.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') components/provider-ui && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json') components/provider-ui/registry.tsx components/provider-ui/provider-chat.tsx __tests__/provider-ui.test.ts` Expected: no findings.

Run: `pnpm test` Expected: PASS (the run decides the count).

Run (no other `next dev` of this checkout; `pnpm test:db` not running): `pnpm test:e2e e2e/apps.spec.ts e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/workflow.spec.ts e2e/completion.spec.ts` Expected: PASS on the three projects (the chat behaves as before for every Dify type).

Run: `pnpm test:e2e e2e/screenshots.spec.ts --project desktop-light` Expected: PASS (the readiness waits find the fallback icon).

- [ ] **Step 11: Commit**

```bash
git add lib/data/apps.ts components app locales e2e/apps.spec.ts e2e/chat-files.spec.ts e2e/screenshots.spec.ts __tests__
git status --short
git commit -m "feat(apps): show the provider in the gallery and dispatch the chat by provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 11: The `apps` table, the admin's data layer and the save actions

**Goal:** Replace the dify_apps table with a provider-neutral apps table (provider, settings and secrets documents) through three migrations, and move the admin data layer and save actions onto it, with the sync and old Dify columns removed.

Spec §2 and §4.3. The table becomes `apps` with `provider`, `settings` and `secrets`, Part 0's rows kept (§2.4); the data layer reads and writes the documents in it through the registry (§2.3): the admin DTO with `invalid` and `secretsSet`, `createApp`/`updateApp` that validate both documents, keep a blank secret, keep the provider, store the icon through Task 8's pipeline and never call the provider (decision 18); the sync, its icon fetch and the old columns go (§2.3 "Removed"); `createAppAction`/`updateAppAction` take FormData, and `testAppConnectionAction` is new (§4.2). The admin form keeps its look until Task 12 and the table until Task 13; here they change only as far as the new values and DTO require.

This is the "switch" task (Plan decision a): the table, the data layer and the actions change together, because tsc and the tests can be green only when the columns, the DTOs and the action inputs move as one. Between this task and Task 12, creating an app in the browser is refused (`invalid_input`: the form has no name field yet); editing works. The e2e cases of the old create flow go here and Task 12 brings the new ones.

The migration (Plan decision b) is three drizzle-kit migrations, applied in one transaction by the migrator (DV 1d): **expand** (generated, with a rename hint: `dify_apps` → `apps`, the three new columns nullable), **data** (`--custom`, hand-written SQL: each row's Dify columns become `settings`, `api_key` becomes `secrets`, `provider` becomes `'dify'`), **contract** (generated: `NOT NULL`, the defaults, the two CHECKs, the old columns dropped). A single custom migration cannot hold the reshape: `drizzle-kit generate --custom` writes the previous snapshot unchanged (drizzle-kit 1.0.0-rc.4 `prepareSnapshot`: `custom: { id, prevIds, ...prevRest }`), so the next `generate` would emit the whole diff again. All three steps were measured while planning (Plan decisions b, c).

**Files:**

- Create: `db/migrations/<timestamp>_apps_expand/{migration.sql,snapshot.json}`, `db/migrations/<timestamp>_apps_data/{migration.sql,snapshot.json}`, `db/migrations/<timestamp>_apps_contract/{migration.sql,snapshot.json}` (by drizzle-kit; the data SQL by hand), `__tests__/apps-schema.test.ts`, `__tests__/db-apps-migrations.test.ts`, `__tests__/data-apps-reads.test.ts`, `__tests__/db/apps-migration.db.test.ts`, `__tests__/db/apps.db.test.ts`
- Rename: `components/admin/apps/api-base-rule.ts` → `components/provider-ui/dify/api-base-rule.ts`
- Delete: `__tests__/data-apps-sync.test.ts`
- Modify: `db/schema/apps.ts` (whole file, twice), `db/schema/app-grants.ts`, `db/schema/index.ts`, `db/schema/settings.ts` (a comment), `lib/data/apps.ts` (whole file), `lib/providers/schemas.ts` (`documentFieldErrors`), `lib/providers/dify/client.ts` (`fetchSignedFile` goes), `lib/action-result.ts`, `app/(admin)/app-management/{actions,schemas}.ts` (whole files), `components/admin/apps/{app-form-values.ts,app-form-drawer.tsx,app-settings-fields.tsx,app-actions.tsx,app-errors.ts,app-management.tsx}`, `e2e/auth.setup.ts`, `e2e/fixtures/{access,constants}.ts`, `e2e/fixtures/stub/apps.ts` (comments), `e2e/{admin-apps,chat-files}.spec.ts`, `locales/{en,zh,ar}/translation.json` (the sync keys), `__tests__/action-failure.test.ts` (a context string)
- Test: `__tests__/{data-apps,data-apps-access,app-management-actions,app-management-schemas,app-form-values,app-errors,api-base-rule,b3a-schema,db-baseline,dify-client}.test.ts`, `__tests__/db/{database.ts,schema.db.test.ts}`

**Acceptance Criteria:**

- [ ] `pnpm db:generate` produces exactly three new migration folders after the baseline, `db/migrations/<timestamp>_apps_expand`, `db/migrations/<timestamp>_apps_data` and `db/migrations/<timestamp>_apps_contract`. The expand SQL renames the table (`ALTER TABLE "dify_apps" RENAME TO "apps";`) and adds `provider`, `settings` and `secrets` as nullable columns. The contract SQL drops the eleven Part 0 columns, sets NOT NULL, and adds `apps_provider_check` and `apps_icon_check`. A following `pnpm db:generate --name nothing` prints `No schema changes, nothing to migrate` and leaves four folders in `db/migrations`.
- [ ] `__tests__/apps-schema.test.ts` (the apps table: its thirteen columns with no Dify column, the NOT NULL columns and defaults, and the two named CHECKs), `__tests__/db-apps-migrations.test.ts` ("Part 1's migrations": follow the baseline as expand, data and contract; rename; fill; then add the constraints and drop the eleven columns) and `__tests__/db-baseline.test.ts` pass.
- [ ] `__tests__/db/apps-migration.db.test.ts` passes ("Part 1's migration on Part 0's rows (spec §2.4)"): Dify columns become the settings document, the key becomes the secrets, the provider becomes dify, an emoji icon becomes no icon, an image icon keeps its bytes, an app without a mode keeps appType null, the grants are kept, and no Part 0 column and no dify_apps table remain.
- [ ] `__tests__/db/apps.db.test.ts` passes against live PostgreSQL: createApp and updateApp validate both documents, keep a blank stored secret, keep the provider, store icons as PNG inside 256 x 256, refuse non-PNG/JPEG/WebP icons with `invalid_image`, and never call the provider. The reads give the admin which secrets are set without their values, mark a broken row invalid, and hide it from users. `__tests__/db/schema.db.test.ts` also passes, including the refusals from `apps_provider_check` and `apps_icon_check` and the four-migration log check.
- [ ] `__tests__/data-apps-reads.test.ts`, `__tests__/app-management-schemas.test.ts` and `__tests__/app-management-actions.test.ts` pass (including `createAppAction and updateAppAction (spec §4.3)` and `testAppConnectionAction`), along with `__tests__/app-form-values.test.ts` ("the drawer's values (spec §4.1)"). `__tests__/data-apps-sync.test.ts` is deleted.
- [ ] `git grep -nE "syncApp|SyncResult|readIconBytes|iconColumnsFrom|fetchSignedFile|\bICON_MAX_BYTES\b|fetchDifyProfile|annotationEnabled" -- app components lib hooks __tests__ e2e` prints nothing. `git grep -nE "\bdifyApps\b|dify_apps" -- ':!docs' ':!db/migrations' ':!media'` prints only the lines the plan lists (the three migration test files, and the query texts in `__tests__/action-failure.test.ts` and `__tests__/http-errors.test.ts`).
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit` prints nothing, and the oxlint and oxfmt checks on the changed files report no findings.
- [ ] `pnpm test:e2e e2e/admin-apps.spec.ts e2e/app-access.spec.ts e2e/admin-groups.spec.ts e2e/directory-groups.spec.ts e2e/apps.spec.ts e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/malformed-ids.spec.ts` passes on desktop-light, desktop-dark and mobile-light, with the seeds moved onto the `apps` table.

**Verify:** `git grep -nE "syncApp|SyncResult|readIconBytes|iconColumnsFrom|fetchSignedFile|\bICON_MAX_BYTES\b|fetchDifyProfile|annotationEnabled" -- app components lib hooks __tests__ e2e` → no output; `pnpm exec next typegen && pnpm exec tsc --noEmit` → no output; `pnpm test` → PASS; `pnpm test:db` → PASS, every file; oxlint and oxfmt --check on the changed files → no findings; `pnpm test:e2e e2e/admin-apps.spec.ts e2e/app-access.spec.ts e2e/admin-groups.spec.ts e2e/directory-groups.spec.ts e2e/apps.spec.ts e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/malformed-ids.spec.ts` → PASS on the three projects

**Interfaces:**

- Consumes: Task 6 (`PROVIDER_SCHEMAS` with `defaultSettings`/`defaultSecrets`, `checkSettings`, `checkDocuments`, `mergeSecrets`, `StoredSettings`, `StoredDocuments`, `ProviderSettings<P>`), Task 7 (`PROVIDERS`, `getProvider`, `ProviderChatFields`, `ProviderSummaryFields`, `ProviderSecretsSet`, `ConnectionTestResult`), Task 8 (`processImage`, `ImageError`, `APP_ICON_MAX_BYTES`, `ImageErrorCode`), Task 9 (`readDocuments`, `AppAccess`), Task 10 (`readSettings`, `AppRecord`, `ChatAppDto`, `AppSummary`, `toChatAppDto`, `toAppSummary`).
- Produces:
  - `db/schema`: `apps` (columns `id`, `created_at`, `updated_at`, `provider`, `name`, `description`, `tags`, `is_enabled`, `access_mode`, `settings`, `secrets`, `icon_image`, `icon_mime`; CHECKs `apps_provider_check`, `apps_icon_check`); `difyApps` is gone.
  - `lib/data/apps.ts`: `type IconChange = { intent: 'keep' } | { intent: 'remove' } | { intent: 'replace'; file: File }`; `interface AppCommonInput { name: string; description: string; tags: string[]; enabled: boolean }`; `interface CreateAppInput { provider: ProviderId; common: AppCommonInput; access: AppAccessSettings; settings: unknown; secrets: unknown; icon: IconChange }`; `interface UpdateAppInput { common: AppCommonInput; access: AppAccessSettings; settings: unknown; secrets: Record<string, string | undefined>; icon: IconChange }`; `type AdminAppDto` (common `{ id, provider, name, description, tags, enabled, hasIcon, access, createdAt, updatedAt }` plus either `{ invalid: false; settings; secretsSet }` or `{ invalid: true }`); `createApp(actor, input: CreateAppInput): Promise<ActionResult<{ id: string }>>`; `updateApp(actor, id, input: UpdateAppInput): Promise<ActionResult>`; `deleteApp(actor, id): Promise<boolean>`; `getStoredSecrets(actor, id, provider): Promise<{ secrets: unknown } | null>`; `listAdminApps(actor): Promise<AdminAppDto[]>`; `appOfProvider(id, provider): SQL | undefined`; `toAdminAppDto(row, groupGrants, userGrants): AdminAppDto | null`; `toAdminAppDtos(rows, groupGrants, userGrants): AdminAppDto[]`; unchanged: `parseTags`, `visibleTo`, `grantRowsFor`, `lockApp` (now selecting `id`, `provider`, `secrets`), `readDocuments`, `readSettings`, `toChatAppDto`, `toAppSummary`, `listApps`, `getChatApp`, `getAppAccess`, `getAppIcon`. Gone: `AppDto`, `AppSettings`, `AppInput`, `SyncResult`, `ICON_MAX_BYTES`, `readIconBytes`, `iconColumnsFrom`, `settingsOf`, `toAppDto`, `syncApp`, `OpeningStatementDisplayMode`.
  - `lib/providers/schemas.ts`: `documentFieldErrors(document: 'settings' | 'secrets', error: z.ZodError): Record<string, string[]>`.
  - `lib/action-result.ts`: `ActionErrorCode` adds `'provider_key_refused'` and `'provider_error'`.
  - `app/(admin)/app-management/schemas.ts`: `accessSchema` (unchanged), `APP_NAME_MAX = 255`, `APP_DESCRIPTION_MAX = 2000`, `APP_TAGS_MAX = 10`, `APP_TAG_MAX = 32`, `appNameSchema`, `appDescriptionSchema`, `appTagsSchema`, `createValuesSchema`, `updateValuesSchema`, `ICON_INTENTS`, `createAppFormSchema`, `updateAppFormSchema` (FormData entries → `CreateAppInput` / `{ provider } & UpdateAppInput`), `formFieldErrors(error: z.ZodError): Record<string, string[]>` (the save forms' field errors keyed by path inside `values`, codes only), `connectionTestSchema`.
  - `app/(admin)/app-management/actions.ts`: `createAppAction(formData: FormData): Promise<ActionResult<{ id: string }>>`, `updateAppAction(id: string, formData: FormData): Promise<ActionResult>`, `deleteAppAction(id: string): Promise<ActionResult>`, `type ConnectionTestOutcome = { outcome: 'reachable' } | { outcome: 'type_mismatch'; reported: string }`, `testAppConnectionAction(input: unknown): Promise<ActionResult<ConnectionTestOutcome>>`.
  - `components/admin/apps/app-form-values.ts`: `type AppFormValues`, `type IconDraft = { intent: 'keep' } | { intent: 'remove' } | { intent: 'replace'; file: File; url: string }`, `DEFAULT_APP_FORM_VALUES`, `toAppFormValues(app: AdminAppDto): AppFormValues`, `providerDefaults(provider: ProviderId): Pick<AppFormValues, 'settings' | 'secrets'>`, `toAppFormData(values: AppFormValues, icon: IconDraft): FormData`.
  - `components/provider-ui/dify/api-base-rule.ts`: `validateApiBase(message)` (moved, reading `apiBaseSchema`).

#### The table and its migrations

- [ ] **Step 1: Write the failing schema tests**

Create `__tests__/apps-schema.test.ts`:

```ts
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { apps } from '@/db/schema'

// Part 1 spec §2.1: the shape of the apps table.
describe('the apps table', () => {
	const config = getTableConfig(apps)
	const column = (name: string) => config.columns.find(entry => entry.name === name)

	it('holds the neutral columns, the provider and its two documents, and no Dify column', () => {
		expect(config.name).toBe('apps')
		expect(config.columns.map(entry => entry.name).sort()).toEqual(
			[
				'access_mode',
				'created_at',
				'description',
				'icon_image',
				'icon_mime',
				'id',
				'is_enabled',
				'name',
				'provider',
				'secrets',
				'settings',
				'tags',
				'updated_at',
			].sort(),
		)
	})
	it('keeps the provider, the documents, the description and the tags NOT NULL, with the spec’s defaults', () => {
		for (const name of ['provider', 'settings', 'secrets', 'description', 'tags'])
			expect(column(name)?.notNull).toBe(true)
		expect(column('provider')?.getSQLType()).toBe('text')
		expect(column('settings')?.getSQLType()).toBe('jsonb')
		expect(column('secrets')?.getSQLType()).toBe('jsonb')
		expect(column('description')?.default).toBe('')
		expect(column('tags')?.default).toEqual([])
	})
	// Decision 24 and spec §4.4: the provider set and the icon pair are checked by the database.
	it('names its two CHECKs', () => {
		expect(config.checks.map(check => check.name).sort()).toEqual([
			'apps_icon_check',
			'apps_provider_check',
		])
	})
})
```

Create `__tests__/db-apps-migrations.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const folders = readdirSync('db/migrations').sort()
const sqlOf = (suffix: string) => {
	const folder = folders.find(name => name.endsWith(`_${suffix}`))
	expect(folder).toBeDefined()
	return readFileSync(path.join('db/migrations', folder!, 'migration.sql'), 'utf8')
}

// Part 1 spec §2.4 and Plan decision b: expand (generated), data (custom), contract (generated), in that order.
describe("Part 1's migrations", () => {
	it('follow the baseline as expand, data and contract', () => {
		expect(folders.map(name => name.replace(/^\d{14}_/, ''))).toEqual([
			'baseline',
			'apps_expand',
			'apps_data',
			'apps_contract',
		])
	})
	// A rename keeps the rows and the grants' foreign keys; a drop and create would lose them (Review Focus 2).
	it('rename dify_apps to apps and add the three columns as NULL-able first', () => {
		const sql = sqlOf('apps_expand')
		expect(sql).toContain('ALTER TABLE "dify_apps" RENAME TO "apps";')
		expect(sql).toContain('ALTER TABLE "apps" ADD COLUMN "provider" text;')
		expect(sql).toContain('ALTER TABLE "apps" ADD COLUMN "settings" jsonb;')
		expect(sql).toContain('ALTER TABLE "apps" ADD COLUMN "secrets" jsonb;')
		expect(sql).not.toMatch(/DROP TABLE|CREATE TABLE/)
	})
	it('fill the documents from the Part 0 columns before anything is dropped', () => {
		const sql = sqlOf('apps_data')
		expect(sql).toContain(`"provider" = 'dify'`)
		expect(sql).toContain(`'appType', "mode"`)
		expect(sql).toContain(`"secrets" = jsonb_build_object('apiKey', "api_key")`)
		expect(sql).not.toMatch(/DROP|ALTER/)
	})
	it('then add the constraints and drop the eleven Part 0 columns', () => {
		const sql = sqlOf('apps_contract')
		expect(sql).toContain(
			`ALTER TABLE "apps" ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify'));`,
		)
		expect(sql).toContain(
			'ALTER TABLE "apps" ADD CONSTRAINT "apps_icon_check" CHECK (("icon_image" IS NULL) = ("icon_mime" IS NULL));',
		)
		for (const name of [
			'mode',
			'api_base',
			'api_key',
			'enable_answer_form',
			'answer_form_feedback_text',
			'enable_update_input_after_starts',
			'opening_statement_display_mode',
			'enable_annotation',
			'icon_type',
			'icon',
			'icon_background',
		])
			expect(sql).toContain(`ALTER TABLE "apps" DROP COLUMN "${name}";`)
		for (const name of ['provider', 'settings', 'secrets', 'description', 'tags'])
			expect(sql).toContain(`ALTER TABLE "apps" ALTER COLUMN "${name}" SET NOT NULL;`)
	})
})
```

In `__tests__/db-baseline.test.ts`, replace lines 6–13:

```ts
const folders = readdirSync('db/migrations')
const sql = () => readFileSync(path.join('db/migrations', folders[0]!, 'migration.sql'), 'utf8')

describe('the PostgreSQL baseline (Part 0 spec §3.3)', () => {
	it('is the only migration: the MySQL history is gone (a fresh start, decision 14)', () => {
		expect(folders).toHaveLength(1)
		expect(folders[0]).toMatch(/^\d{14}_baseline$/)
	})
```

with:

```ts
const folders = readdirSync('db/migrations').sort()
const baseline = folders.find(name => /^\d{14}_baseline$/.test(name))
const sql = () => readFileSync(path.join('db/migrations', baseline!, 'migration.sql'), 'utf8')

describe('the PostgreSQL baseline (Part 0 spec §3.3)', () => {
	// Part 1's three apps migrations follow it (__tests__/db-apps-migrations.test.ts).
	it('is the first migration: the MySQL history is gone (a fresh start, decision 14)', () => {
		expect(folders[0]).toBe(baseline)
	})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/apps-schema.test.ts __tests__/db-apps-migrations.test.ts __tests__/db-baseline.test.ts` Expected: FAIL: `apps-schema` (`apps` is not exported by `@/db/schema`), `db-apps-migrations` (the three folders are missing); `db-baseline` passes.

- [ ] **Step 3: The expand state and its migration**

Replace the whole of `db/schema/apps.ts` with this expand state (Part 0's columns, the new name and three NULL-able columns; Step 5 replaces it with the final one):

```ts
import { boolean, bytea, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { generateUuidV4 } from '@/lib/helpers'

import { timestamptz } from './columns'
import { accessMode } from './enums'

export const apps = pgTable('apps', {
	id: uuid()
		.primaryKey()
		.$defaultFn(() => generateUuidV4()),
	createdAt: timestamptz('created_at').defaultNow().notNull(),
	updatedAt: timestamptz('updated_at')
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
	provider: text(),
	name: text().notNull(),
	mode: text(),
	description: text(),
	tags: jsonb(),
	isEnabled: boolean('is_enabled').default(true).notNull(),
	accessMode: accessMode('access_mode').default('restricted').notNull(),
	apiBase: text('api_base').notNull(),
	apiKey: text('api_key').notNull(),
	enableAnswerForm: boolean('enable_answer_form').default(false).notNull(),
	answerFormFeedbackText: text('answer_form_feedback_text'),
	enableUpdateInputAfterStarts: boolean('enable_update_input_after_starts')
		.default(false)
		.notNull(),
	openingStatementDisplayMode: text('opening_statement_display_mode'),
	enableAnnotation: boolean('enable_annotation').default(false).notNull(),
	iconType: text('icon_type'),
	icon: text('icon'),
	iconBackground: text('icon_background'),
	iconImage: bytea('icon_image'),
	iconMime: text('icon_mime'),
	settings: jsonb(),
	secrets: jsonb(),
})
```

In `db/schema/app-grants.ts`, replace `import { difyApps } from './apps'` with `import { apps } from './apps'` and both `.references(() => difyApps.id, { onDelete: 'cascade' }),` with `.references(() => apps.id, { onDelete: 'cascade' }),`. In `db/schema/index.ts`, replace `export { difyApps } from './apps'` with `export { apps } from './apps'`. In `db/schema/settings.ts`, replace `(dify_apps.icon_image)` with `(apps.icon_image)` in the comment of `instanceSettingFiles`.

drizzle-kit 1.0.0-rc.4 cannot tell a renamed table from a new one without a hint; outside a terminal it answers `missing_hints` instead of prompting (rc.4 release notes; drizzle-kit `HINTS.md`, "Rename a table"). The table hint is the only one needed: the grants' foreign keys follow the renamed table (measured while planning).

Run: `pnpm db:generate --name apps_expand --hints '[{"type":"rename","kind":"table","from":["public","dify_apps"],"to":["public","apps"]}]'` Expected: `~ dify_apps › apps table will be renamed/moved` and `[✓] Your SQL migration ➜ db/migrations/<timestamp>_apps_expand/migration.sql`. The file is exactly:

```sql
ALTER TABLE "dify_apps" RENAME TO "apps";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "secrets" jsonb;
```

(The constraint names stay `dify_apps_pkey`, `app_group_grants_app_id_dify_apps_id_fkey` and `app_user_grants_app_id_dify_apps_id_fkey`: PostgreSQL keeps them on a rename, and drizzle-kit's snapshot records the same names; Plan decision c.)

- [ ] **Step 4: The data migration**

Run: `pnpm db:generate --custom --name apps_data` Expected: `Prepared empty file for your custom SQL migration!` and `db/migrations/<timestamp>_apps_data/migration.sql` holding one comment line.

Replace the whole of that `migration.sql` with:

```sql
-- Part 1 spec §2.4: every Part 0 row becomes a Dify app. Its Dify columns become the settings document and its key the
-- secrets document, mapped as lib/data/apps.ts read them before this migration; the expand migration before this one
-- added the columns and the contract migration after it drops the old ones. A row without a known mode keeps
-- "appType": null, which the settings schema refuses: the admin sees "Invalid settings" and repairs it (spec §2.3). An
-- emoji icon stores no image, so it becomes no icon (decision 19); an image keeps its bytes and its type.
UPDATE "apps" SET
	"provider" = 'dify',
	"settings" = jsonb_build_object(
		'apiBase', "api_base",
		'appType', "mode",
		'answerForm', jsonb_build_object('enabled', "enable_answer_form", 'feedbackText', coalesce("answer_form_feedback_text", '')),
		'enableUpdateAfterConversationStarts', "enable_update_input_after_starts",
		'openingStatementDisplayMode', CASE WHEN "opening_statement_display_mode" = 'always' THEN 'always' ELSE 'default' END
	),
	"secrets" = jsonb_build_object('apiKey', "api_key"),
	"description" = coalesce("description", ''),
	"tags" = CASE WHEN jsonb_typeof("tags") = 'array' THEN "tags" ELSE '[]'::jsonb END;--> statement-breakpoint
UPDATE "apps" SET "icon_image" = NULL, "icon_mime" = NULL WHERE "icon_image" IS NULL OR "icon_mime" IS NULL;
```

(PostgreSQL 18 "JSON Functions": `jsonb_build_object` builds an object from alternating keys and values, `jsonb_typeof` names a value's type and answers NULL for SQL NULL. The second statement leaves only complete icon pairs, which the contract's `apps_icon_check` requires.)

- [ ] **Step 5: The final state and its migration**

Replace the whole of `db/schema/apps.ts` with:

```ts
import { sql } from 'drizzle-orm'
import { boolean, bytea, check, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { generateUuidV4 } from '@/lib/helpers'
import { PROVIDER_IDS } from '@/lib/providers/ids'

import { timestamptz } from './columns'
import { accessMode } from './enums'

/**
 * An app of any provider (Part 1 spec §2.1; decisions 17 and 24). The provider is `text` with a CHECK listing the known
 * ids, not an enum: a value added to an enum "cannot be used until after the transaction has been committed" while the
 * migrator applies every pending migration in one transaction, and the provider set is meant to grow (DV 2e); the
 * reference hubs store it as a string too (DV 11). The two documents are untyped jsonb (`unknown`, DV 8a): only their
 * provider's zod schemas make them usable (lib/providers/schemas.ts, on every write and read). The secrets sit apart from
 * the settings so the later encryption touches them alone (decision 8). The icon is an upload re-encoded to PNG (spec
 * §4.4) or an image Part 0 stored, which keeps its type (the icon route serves it with `nosniff` and a sandbox CSP);
 * both columns set or both NULL.
 */
export const apps = pgTable(
	'apps',
	{
		id: uuid()
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at')
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
		/** Fixed at insert (spec §2.3). `enum` types the column in TypeScript only (DV 2e); the CHECK refuses other values. */
		provider: text({ enum: PROVIDER_IDS }).notNull(),
		name: text().notNull(),
		description: text().default('').notNull(),
		/** A JSON array of strings (PostgreSQL 18 "JSON Types"); lib/data/apps.ts parseTags keeps the strings only. */
		tags: jsonb().default([]).notNull(),
		isEnabled: boolean('is_enabled').default(true).notNull(),
		/** B3 spec §2 #9: a new app is closed until granted. */
		accessMode: accessMode('access_mode').default('restricted').notNull(),
		settings: jsonb().notNull(),
		secrets: jsonb().notNull(),
		/** PostgreSQL 18 "Binary Data Types" (DV 2c); Drizzle's bytea reads and writes a Buffer. */
		iconImage: bytea('icon_image'),
		iconMime: text('icon_mime'),
	},
	table => [
		// PostgreSQL 18 "Check Constraints"; Drizzle "Indexes & Constraints", check(). The ids are the code's own constants,
		// never input, so they are written into the SQL as literals (sql.raw). Part 2 adds 'agui' through PROVIDER_IDS.
		check(
			'apps_provider_check',
			sql`${table.provider} IN (${sql.raw(PROVIDER_IDS.map(id => `'${id}'`).join(', '))})`,
		),
		check('apps_icon_check', sql`(${table.iconImage} IS NULL) = (${table.iconMime} IS NULL)`),
	],
)
```

Run: `pnpm db:generate --name apps_contract` Expected: `[✓] Your SQL migration ➜ db/migrations/<timestamp>_apps_contract/migration.sql`, exactly (measured while planning):

```sql
ALTER TABLE "apps" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "api_base";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "enable_answer_form";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "answer_form_feedback_text";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "enable_update_input_after_starts";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "opening_statement_display_mode";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "enable_annotation";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "icon_type";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "icon";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "icon_background";--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "tags" SET DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "tags" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "settings" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "secrets" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify'));--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_icon_check" CHECK (("icon_image" IS NULL) = ("icon_mime" IS NULL));
```

Run: `pnpm db:generate --name nothing` Expected: `No schema changes, nothing to migrate 😴`, and no new folder (`ls db/migrations` lists four).

- [ ] **Step 6: Run the schema tests**

Run: `pnpm exec vitest run --project unit __tests__/apps-schema.test.ts __tests__/db-apps-migrations.test.ts __tests__/db-baseline.test.ts` Expected: PASS.

- [ ] **Step 7: The migration against Part 0's rows, live**

Create `__tests__/db/apps-migration.db.test.ts`:

```ts
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * Part 1 spec §9: the migration runs against a database seeded in Part 0's shape. Its own database in the e2e PostgreSQL
 * (`hub_migration`, as global-setup.ts makes hub_dal): the baseline's statements, then Part 0 rows, then Part 1's three
 * migrations in one transaction, as the migrator applies pending migrations (DV 1d). The statements are the migrator's
 * own reading of the folder (drizzle-orm `readMigrationFiles`: the files sorted by name, split at `--> statement-breakpoint`).
 */
const ADMIN_URL = 'postgres://e2e:e2e@127.0.0.1:5433/e2e'
const MIGRATION_URL = 'postgres://e2e:e2e@127.0.0.1:5433/hub_migration'
const [baseline, ...part1] = readMigrationFiles({ migrationsFolder: 'db/migrations' })

const EMOJI_APP = 'a0000000-0000-4000-8000-000000000001'
const IMAGE_APP = 'a0000000-0000-4000-8000-000000000002'
const NO_MODE_APP = 'a0000000-0000-4000-8000-000000000003'
const USER = '11111111-1111-4111-8111-111111111111'
const GROUP = '22222222-2222-4222-8222-222222222222'
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

const admin = async (statement: string) => {
	const client = new Client({ connectionString: ADMIN_URL })
	await client.connect()
	try {
		await client.query(statement)
	} finally {
		await client.end()
	}
}
let db: Client
const run = async (statements: string[]) => {
	for (const statement of statements) if (statement.trim()) await db.query(statement)
}

beforeAll(async () => {
	// PostgreSQL 18 "DROP DATABASE": FORCE ends the connections a crashed run left open.
	await admin('DROP DATABASE IF EXISTS hub_migration WITH (FORCE)')
	await admin('CREATE DATABASE hub_migration')
	db = new Client({ connectionString: MIGRATION_URL })
	await db.connect()
	await run(baseline!.sql)
	await db.query("INSERT INTO users (id, email, password) VALUES ($1, 'u@example.com', 'hash')", [
		USER,
	])
	await db.query("INSERT INTO user_groups (id, name) VALUES ($1, 'G')", [GROUP])
	await db.query(
		`INSERT INTO dify_apps (id, name, mode, description, tags, api_base, api_key, enable_answer_form, answer_form_feedback_text,
			enable_update_input_after_starts, opening_statement_display_mode, enable_annotation, icon_type, icon, icon_background, access_mode)
		VALUES ($1, 'Emoji chat', 'advanced-chat', 'desc', '["a","b"]', 'https://dify.example/v1', 'app-key-1', true, 'Thanks',
			true, 'always', true, 'emoji', '🍵', '#FFEAD5', 'restricted')`,
		[EMOJI_APP],
	)
	await db.query(
		`INSERT INTO dify_apps (id, name, mode, api_base, api_key, icon_type, icon, icon_image, icon_mime, access_mode)
		VALUES ($1, 'Image workflow', 'workflow', 'http://api:5001/v1', 'app-key-2', 'image', 'file', $2, 'image/png', 'everyone')`,
		[IMAGE_APP, PNG],
	)
	await db.query(
		"INSERT INTO dify_apps (id, name, mode, api_base, api_key) VALUES ($1, 'No mode', NULL, 'https://x.example/v1', 'app-key-3')",
		[NO_MODE_APP],
	)
	await db.query('INSERT INTO app_user_grants (app_id, user_id) VALUES ($1, $2)', [EMOJI_APP, USER])
	await db.query('INSERT INTO app_group_grants (app_id, group_id) VALUES ($1, $2)', [
		EMOJI_APP,
		GROUP,
	])
	await db.query('BEGIN')
	for (const migration of part1) await run(migration.sql)
	await db.query('COMMIT')
})

afterAll(async () => {
	await db?.end()
	await admin('DROP DATABASE IF EXISTS hub_migration WITH (FORCE)')
})

const appRow = async (id: string) =>
	(
		await db.query<{
			provider: string
			name: string
			description: string
			tags: unknown
			settings: unknown
			secrets: unknown
			icon_image: Buffer | null
			icon_mime: string | null
			access_mode: string
		}>(
			'SELECT provider, name, description, tags, settings, secrets, icon_image, icon_mime, access_mode FROM apps WHERE id = $1',
			[id],
		)
	).rows[0]

describe("Part 1's migration on Part 0's rows (spec §2.4)", () => {
	it('turns every Dify column into the settings, the key into the secrets, and the provider into dify', async () => {
		expect(await appRow(EMOJI_APP)).toMatchObject({
			provider: 'dify',
			name: 'Emoji chat',
			description: 'desc',
			tags: ['a', 'b'],
			settings: {
				apiBase: 'https://dify.example/v1',
				appType: 'advanced-chat',
				answerForm: { enabled: true, feedbackText: 'Thanks' },
				enableUpdateAfterConversationStarts: true,
				openingStatementDisplayMode: 'always',
			},
			secrets: { apiKey: 'app-key-1' },
			access_mode: 'restricted',
		})
	})
	it('gives a missing description and missing tags their defaults', async () => {
		expect(await appRow(IMAGE_APP)).toMatchObject({ description: '', tags: [] })
	})
	it('makes an emoji icon no icon and keeps an image with its bytes', async () => {
		expect(await appRow(EMOJI_APP)).toMatchObject({ icon_image: null, icon_mime: null })
		const image = await appRow(IMAGE_APP)
		expect(image?.icon_mime).toBe('image/png')
		expect(Buffer.compare(image!.icon_image!, PNG)).toBe(0)
	})
	// Review Focus 1: an app Part 0 stored without a known mode becomes an "Invalid settings" row for the admin to repair.
	it('keeps an app without a mode, with appType null', async () => {
		expect((await appRow(NO_MODE_APP))?.settings).toMatchObject({ appType: null })
	})
	it('keeps the grants', async () => {
		const users = await db.query('SELECT app_id FROM app_user_grants')
		const groups = await db.query('SELECT app_id FROM app_group_grants')
		expect(users.rows).toEqual([{ app_id: EMOJI_APP }])
		expect(groups.rows).toEqual([{ app_id: EMOJI_APP }])
	})
	it('leaves no Part 0 column and no dify_apps table', async () => {
		const { rows } = await db.query<{ column_name: string }>(
			"SELECT column_name FROM information_schema.columns WHERE table_name = 'apps' ORDER BY column_name",
		)
		expect(rows.map(row => row.column_name)).toEqual([
			'access_mode',
			'created_at',
			'description',
			'icon_image',
			'icon_mime',
			'id',
			'is_enabled',
			'name',
			'provider',
			'secrets',
			'settings',
			'tags',
			'updated_at',
		])
		const tables = await db.query(
			"SELECT 1 FROM information_schema.tables WHERE table_name = 'dify_apps'",
		)
		expect(tables.rowCount).toBe(0)
	})
})
```

In `__tests__/db/database.ts`, replace `'TRUNCATE users, user_groups, dify_apps, directory_sync_runs, instance_settings, password_reset_tokens CASCADE',` with `'TRUNCATE users, user_groups, apps, directory_sync_runs, instance_settings, password_reset_tokens CASCADE',`.

In `__tests__/db/schema.db.test.ts`:

- replace `import { difyApps, userGroupMembers, userGroups, users } from '@/db/schema'` with `import { apps, userGroupMembers, userGroups, users } from '@/db/schema'`;
- replace the case `it('was applied once, through the log the runtime migrator shares with drizzle-kit (DV 1c)', …)` (7 lines) with:

```ts
it('was applied with Part 1’s three migrations, through the log the runtime migrator shares with drizzle-kit (DV 1c)', async () => {
	const { rows } = await pool.query<{ name: string }>(
		'SELECT name FROM drizzle.__drizzle_migrations ORDER BY id',
	)
	expect(rows.map(row => row.name.replace(/^\d{14}_/, ''))).toEqual([
		'baseline',
		'apps_expand',
		'apps_data',
		'apps_contract',
	])
})
```

- replace the case `it('reads the tags back as the jsonb array they were written as', …)` (15 lines) with:

```ts
const app = (over: Record<string, unknown> = {}) => ({
	id: crypto.randomUUID(),
	provider: 'dify' as const,
	name: 'Tea',
	settings: { apiBase: 'http://dify.test/v1' },
	secrets: { apiKey: 'app-key' },
	...over,
})

it('reads the tags back as the jsonb array they were written as', async () => {
	const row = app({ tags: ['a', 'b'] })
	await testDb.insert(apps).values(row)
	const [stored] = await testDb.select({ tags: apps.tags }).from(apps).where(eq(apps.id, row.id))
	expect(stored!.tags).toEqual(['a', 'b'])
})

// Decision 24 (PostgreSQL 18 "Check Constraints"; 23514 is check_violation, Appendix A).
it('refuses a provider the CHECK does not list', async () => {
	expect(
		await refusal(
			pool.query(
				"INSERT INTO apps (id, provider, name, settings, secrets) VALUES ($1, 'agui', 'x', '{}', '{}')",
				[crypto.randomUUID()],
			),
		),
	).toEqual({ code: '23514', constraint: 'apps_provider_check' })
})

// Spec §4.4: the icon's bytes and type are stored together or not at all.
it('refuses an icon image without its type', async () => {
	expect(await refusal(testDb.insert(apps).values(app({ iconImage: Buffer.from([1]) })))).toEqual({
		code: '23514',
		constraint: 'apps_icon_check',
	})
})
```

The `refusal` helper of this file reads `cause.code` from a Drizzle error; `pool.query` rejects with node-postgres's `DatabaseError` itself, whose `code` and `constraint` sit on the error. Replace the helper and its comment (lines 11–25) with one that reads both:

```ts
/**
 * A query's refusal as the driver reported it: Drizzle rejects with a DrizzleQueryError whose `cause` is node-postgres's
 * DatabaseError, and `pool.query` with the DatabaseError itself; either carries the SQLSTATE and, for a constraint, its
 * name (DV 5a, 5b).
 */
const refusal = async (query: PromiseLike<unknown>) => {
	const error: unknown = await query.then(
		() => null,
		(caught: unknown) => caught,
	)
	const fields = (value: unknown) => value as { code?: string; constraint?: string } | undefined
	const driver = error instanceof Error && error.cause ? fields(error.cause) : fields(error)
	return { code: driver?.code, constraint: driver?.constraint }
}
```

#### The data layer on the documents

- [ ] **Step 8: Write the failing data-layer tests**

Create `__tests__/db/apps.db.test.ts` (the live data layer; it needs Steps 3–5's schema and replaces the fake-chain writes of `__tests__/data-apps-sync.test.ts`, which Step 11 deletes):

```ts
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { apps, userGroups } from '@/db/schema'
import {
	createApp,
	getAppAccess,
	getChatApp,
	getStoredSecrets,
	listAdminApps,
	listApps,
	updateApp,
} from '@/lib/data/apps'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterEach(() => {
	vi.restoreAllMocks()
})
afterAll(() => pool.end())

const owner = {
	id: crypto.randomUUID(),
	email: 'owner@example.com',
	name: null,
	role: 'owner' as const,
}
const member = {
	id: crypto.randomUUID(),
	email: 'member@example.com',
	name: null,
	role: 'user' as const,
}
const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat',
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'always',
}
const common = { name: 'Tea', description: 'Brews tea', tags: ['a', 'b'], enabled: true }
const everyone = { mode: 'everyone' as const, groupIds: [], userIds: [] }
const create = (over: Record<string, unknown> = {}) =>
	createApp(owner, {
		provider: 'dify',
		common,
		access: everyone,
		settings,
		secrets: { apiKey: 'app-secret' },
		icon: { intent: 'keep' },
		...over,
	})
const createdId = async (over: Record<string, unknown> = {}) => {
	const result = await create(over)
	if (!result.ok) throw new Error(`createApp refused: ${result.code}`)
	return result.data.id
}
const stored = async (id: string) => (await testDb.select().from(apps).where(eq(apps.id, id)))[0]
const png = async (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: '#1677ff' } })
		.png()
		.toBuffer()

describe('createApp (spec §2.3)', () => {
	it('stores the provider and both documents as their schemas read them', async () => {
		const id = await createdId({ secrets: { apiKey: '  app-secret  ' } })
		expect(await stored(id)).toMatchObject({
			provider: 'dify',
			name: 'Tea',
			description: 'Brews tea',
			tags: ['a', 'b'],
			isEnabled: true,
			accessMode: 'everyone',
			settings,
			secrets: { apiKey: 'app-secret' },
			iconImage: null,
			iconMime: null,
		})
	})
	it('refuses settings its provider’s schema refuses, by field, and writes nothing', async () => {
		expect(await create({ settings: { ...settings, apiBase: 'ftp://x/v1' } })).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'settings.apiBase': ['invalid_format'] },
		})
		expect(await create({ secrets: { apiKey: '' } })).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.apiKey': ['too_small'] },
		})
		expect(await testDb.select().from(apps)).toEqual([])
	})
	// Spec §4.4: the image through the pipeline, as a PNG of at most 256 × 256.
	it('stores an uploaded icon as a PNG inside 256 × 256', async () => {
		const file = new File([await png(1024, 512)], 'icon.png', { type: 'image/png' })
		const id = await createdId({ icon: { intent: 'replace', file } })
		const row = await stored(id)
		expect(row?.iconMime).toBe('image/png')
		const meta = await sharp(row!.iconImage!).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(['png', 256, 128])
	})
	it('refuses an icon that is not a PNG, JPEG or WebP, and writes nothing', async () => {
		const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'icon.svg', {
			type: 'image/svg+xml',
		})
		expect(await create({ icon: { intent: 'replace', file } })).toEqual({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { icon: ['not_allowed'] },
		})
		expect(await testDb.select().from(apps)).toEqual([])
	})
	// One transaction: a group deleted before the save rejects the grant insert (23503) and leaves no app behind.
	it('writes no app when a granted group no longer exists', async () => {
		await expect(
			create({
				access: { mode: 'restricted', groupIds: [crypto.randomUUID()], userIds: [] },
			}),
		).rejects.toMatchObject({ cause: { code: '23503' } })
		expect(await testDb.select().from(apps)).toEqual([])
	})
})

describe('updateApp (spec §2.3)', () => {
	const update = (id: string, over: Record<string, unknown> = {}) =>
		updateApp(owner, id, {
			common: { ...common, name: 'Tea 2' },
			access: everyone,
			settings,
			secrets: { apiKey: undefined },
			icon: { intent: 'keep' },
			...over,
		})

	it('keeps the stored key when the field is blank, and replaces it when one is typed', async () => {
		const id = await createdId()
		expect(await update(id)).toEqual({ ok: true, data: undefined })
		expect(await stored(id)).toMatchObject({ name: 'Tea 2', secrets: { apiKey: 'app-secret' } })
		expect(await update(id, { secrets: { apiKey: 'app-new' } })).toEqual({
			ok: true,
			data: undefined,
		})
		expect((await stored(id))?.secrets).toEqual({ apiKey: 'app-new' })
	})
	// Review Focus 1: a row whose stored key is broken is repaired by typing one; a blank key cannot repair it.
	it('refuses a blank key over broken stored secrets, by field, and writes nothing', async () => {
		const id = await createdId()
		await testDb
			.update(apps)
			.set({ secrets: { apiKey: '' } })
			.where(eq(apps.id, id))
		expect(await update(id)).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.apiKey': ['too_small'] },
		})
		expect((await stored(id))?.name).toBe('Tea')
		expect(await update(id, { secrets: { apiKey: 'app-fixed' } })).toEqual({
			ok: true,
			data: undefined,
		})
	})
	it('replaces and removes the icon', async () => {
		const id = await createdId()
		const file = new File([await png(64, 64)], 'icon.png', { type: 'image/png' })
		await update(id, { icon: { intent: 'replace', file } })
		expect((await stored(id))?.iconMime).toBe('image/png')
		await update(id, { icon: { intent: 'remove' } })
		expect(await stored(id)).toMatchObject({ iconImage: null, iconMime: null })
	})
	it('answers not_found for an app that is gone', async () => {
		expect(await update(crypto.randomUUID())).toEqual({ ok: false, code: 'not_found' })
	})
	// Spec §2.3: the provider is fixed; an input that names another is never read (the CHECK would refuse 'agui').
	it('keeps the stored provider whatever the input says', async () => {
		const id = await createdId()
		expect(await update(id, { provider: 'agui' })).toEqual({ ok: true, data: undefined })
		expect((await stored(id))?.provider).toBe('dify')
	})
	// Decision 18: saving never calls a provider, so a create and an update reach no fetch at all.
	it('never calls the provider, on a create or an update', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		try {
			const id = await createdId()
			expect(await update(id)).toEqual({ ok: true, data: undefined })
		} finally {
			vi.unstubAllGlobals()
		}
		expect(fetchSpy).not.toHaveBeenCalled()
	})
})

describe('the reads (spec §2.3)', () => {
	it('give the admin which secrets are set, never their values', async () => {
		const id = await createdId()
		const [dto] = await listAdminApps(owner)
		expect(dto).toMatchObject({
			id,
			provider: 'dify',
			invalid: false,
			settings,
			secretsSet: { apiKey: true },
			hasIcon: false,
		})
		expect(JSON.stringify(dto)).not.toContain('app-secret')
	})
	// Spec §2.3: a row whose documents fail is never returned half-typed.
	it('mark a broken row invalid for the admin, with no settings, and hide it from users', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const id = await createdId()
		await testDb
			.update(apps)
			.set({ settings: { ...settings, appType: null } })
			.where(eq(apps.id, id))
		const [dto] = await listAdminApps(owner)
		expect(dto).toMatchObject({ id, invalid: true, name: 'Tea' })
		expect(dto).not.toHaveProperty('settings')
		expect(dto).not.toHaveProperty('secretsSet')
		expect(await listApps(member)).toEqual([])
		expect(await getChatApp(member, id)).toBeNull()
		expect(await getAppAccess(member, id)).toBeNull()
		expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
			appId: id,
			code: 'invalid_settings',
		})
	})
	it('give users their DTOs without the secrets or the API base', async () => {
		const id = await createdId()
		const [summary] = await listApps(member)
		expect(summary).toMatchObject({ id, provider: 'dify', appType: 'advanced-chat' })
		const chat = await getChatApp(member, id)
		expect(chat).toMatchObject({ id, appType: 'advanced-chat' })
		for (const dto of [summary, chat]) {
			expect(JSON.stringify(dto)).not.toContain('app-secret')
			expect(JSON.stringify(dto)).not.toContain('dify.example')
		}
	})
	it('give a provider route the checked documents', async () => {
		const id = await createdId()
		expect(await getAppAccess(member, id)).toEqual({
			id,
			enabled: true,
			provider: 'dify',
			settings,
			secrets: { apiKey: 'app-secret' },
		})
	})
	// Spec §4.2: the stored secrets for a test that leaves a field blank; only an app of that provider.
	it('read the stored secrets for the connection test', async () => {
		const id = await createdId()
		expect(await getStoredSecrets(owner, id, 'dify')).toEqual({ secrets: { apiKey: 'app-secret' } })
		expect(await getStoredSecrets(owner, crypto.randomUUID(), 'dify')).toBeNull()
		await expect(getStoredSecrets(member, id, 'dify')).rejects.toMatchObject({ code: 'forbidden' })
	})
	it('keep a group grant: a restricted app is listed to a member of a granted group', async () => {
		const groupId = crypto.randomUUID()
		await testDb.insert(userGroups).values({ id: groupId, name: 'G' })
		const id = await createdId({ access: { mode: 'restricted', groupIds: [groupId], userIds: [] } })
		expect(await listApps(member)).toEqual([])
		await pool.query(
			"INSERT INTO users (id, email, password) VALUES ($1, 'member@example.com', 'hash')",
			[member.id],
		)
		await pool.query(
			"INSERT INTO user_group_members (group_id, user_id, source) VALUES ($1, $2, 'manual')",
			[groupId, member.id],
		)
		expect((await listApps(member)).map(app => app.id)).toEqual([id])
	})
})
```

Replace the whole of `__tests__/data-apps.test.ts` (its fake-row DTO and sync cases go with the code they tested) with:

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import { apps } from '@/db/schema'
import {
	appOfProvider,
	createApp,
	deleteApp,
	getStoredSecrets,
	grantRowsFor,
	listAdminApps,
	lockApp,
	parseTags,
	readDocuments,
	readSettings,
	toAdminAppDto,
	toAdminAppDtos,
	toAppSummary,
	toChatAppDto,
	updateApp,
} from '@/lib/data/apps'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat' as const,
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'always' as const,
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('parseTags', () => {
	// The jsonb column's value as the driver parsed it (PostgreSQL 18 "JSON Types"): only its strings are tags.
	it('reads an array of strings from the jsonb value and tolerates anything else', () => {
		expect(parseTags(['a', 'b'])).toEqual(['a', 'b'])
		expect(parseTags(['a', 1])).toEqual(['a'])
		expect(parseTags('["a"]')).toEqual([])
		expect(parseTags({ tags: ['a'] })).toEqual([])
		expect(parseTags(null)).toEqual([])
	})
})

// Spec §2.3: a row whose documents fail is logged by its id and the failing document, never its values.
describe('readDocuments and readSettings', () => {
	it('read valid documents without a log line', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(readDocuments('a1', 'dify', settings, { apiKey: 'app-secret' })).toEqual({
			provider: 'dify',
			settings,
			secrets: { apiKey: 'app-secret' },
		})
		expect(readSettings('a1', 'dify', settings)).toEqual({ provider: 'dify', settings })
		expect(spy).not.toHaveBeenCalled()
	})
	it.each([
		['an unknown provider', 'agui', settings, { apiKey: 'app-secret' }, 'unknown_provider'],
		[
			'broken settings',
			'dify',
			{ ...settings, appType: null },
			{ apiKey: 'app-secret' },
			'invalid_settings',
		],
		['broken secrets', 'dify', settings, { apiKey: '' }, 'invalid_secrets'],
	])(
		'answer null for %s and log the app id and the code only',
		(_label, provider, stored, secrets, code) => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
			expect(readDocuments('a1', provider, stored, secrets)).toBeNull()
			expect(spy).toHaveBeenCalledWith('Stored app documents refused:', { appId: 'a1', code })
			expect(JSON.stringify(spy.mock.calls)).not.toContain('app-secret')
			expect(JSON.stringify(spy.mock.calls)).not.toContain('dify.example')
		},
	)
})

describe('the user DTOs (spec §2.3)', () => {
	const record = {
		id: 'a1',
		provider: 'dify' as const,
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		enabled: true,
		hasIcon: true,
		settings,
	}
	it('the chat DTO carries the type and the chat switches, never the base', () => {
		const dto = toChatAppDto(record)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			enabled: true,
			hasIcon: true,
			appType: 'advanced-chat',
			settings: {
				answerForm: { enabled: true, feedbackText: 'Thanks' },
				enableUpdateAfterConversationStarts: false,
				openingStatementDisplayMode: 'always',
			},
		})
		expect(JSON.stringify(dto)).not.toContain('dify.example')
	})
	it('the gallery card carries the provider and the type, never the base or the switches', () => {
		expect(toAppSummary(record)).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			tags: ['a', 'b'],
			hasIcon: true,
			appType: 'advanced-chat',
		})
	})
})

describe('the admin DTO (spec §2.3)', () => {
	const row = {
		id: 'a1',
		createdAt: new Date('2026-10-07T10:00:00Z'),
		updatedAt: new Date('2026-10-07T11:00:00Z'),
		provider: 'dify',
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		isEnabled: true,
		accessMode: 'restricted' as const,
		hasIcon: false,
		settings,
		secrets: { apiKey: 'app-secret' },
	}
	it('carries the settings and which secrets are set, never their values, and only this app’s grants', () => {
		const dto = toAdminAppDto(
			row,
			[
				{ appId: 'a1', groupId: 'g1' },
				{ appId: 'other', groupId: 'g2' },
			],
			[{ appId: 'a1', userId: 'u1' }],
		)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			tags: ['a', 'b'],
			enabled: true,
			hasIcon: false,
			access: { mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] },
			createdAt: '2026-10-07T10:00:00.000Z',
			updatedAt: '2026-10-07T11:00:00.000Z',
			invalid: false,
			settings,
			secretsSet: { apiKey: true },
		})
		expect(JSON.stringify(dto)).not.toContain('app-secret')
	})
	it('marks a row whose documents fail invalid, with no settings and no secrets flags', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const dto = toAdminAppDto({ ...row, secrets: { apiKey: '' } }, [], [])
		expect(dto).toMatchObject({ id: 'a1', provider: 'dify', invalid: true })
		expect(dto).not.toHaveProperty('settings')
		expect(dto).not.toHaveProperty('secretsSet')
	})
	// DV 11: the CHECK allows no other provider; a row that has one anyway is left out of the list, logged.
	it('leaves out a row whose provider the hub does not know', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(toAdminAppDto({ ...row, provider: 'agui' }, [], [])).toBeNull()
		expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
			appId: 'a1',
			code: 'unknown_provider',
		})
	})
	it('gives each app only its own grants, grouped once, and keeps the apps’ order', () => {
		const dtos = toAdminAppDtos(
			[
				{ ...row, id: 'a1' },
				{ ...row, id: 'a2' },
				{ ...row, id: 'a3', accessMode: 'everyone' },
			],
			[
				{ appId: 'a2', groupId: 'g2' },
				{ appId: 'a1', groupId: 'g1' },
				{ appId: 'a2', groupId: 'g3' },
			],
			[{ appId: 'a1', userId: 'u1' }],
		)
		expect(dtos.map(dto => [dto.id, dto.access])).toEqual([
			['a1', { mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] }],
			['a2', { mode: 'restricted', groupIds: ['g2', 'g3'], userIds: [] }],
			['a3', { mode: 'everyone', groupIds: [], userIds: [] }],
		])
	})
})

describe('grantRowsFor (B3 spec §4.4, deviation 4)', () => {
	it('stores no grant for an app open to everyone', () => {
		expect(grantRowsFor('a1', { mode: 'everyone', groupIds: ['g1'], userIds: ['u1'] })).toEqual({
			groups: [],
			users: [],
		})
	})
	it('stores each restricted grant once', () => {
		expect(
			grantRowsFor('a1', { mode: 'restricted', groupIds: ['g1', 'g1'], userIds: ['u1', 'u2'] }),
		).toEqual({
			groups: [{ appId: 'a1', groupId: 'g1' }],
			users: [
				{ appId: 'a1', userId: 'u1' },
				{ appId: 'a1', userId: 'u2' },
			],
		})
	})
})

// Ruling M11 of B3a: the update locks the app row before it writes the grants, so a delete in between reads as not_found.
describe('lockApp (ADR-0024 decision d)', () => {
	it('is a locking read of one app by its primary key, with its provider and stored secrets', () => {
		const query = lockApp(drizzle.mock(), 'a1').toSQL()
		expect(query.sql).toMatch(
			/^select "id", "provider", "secrets" from "apps" where "apps"\."id" = \$1 limit \$2 for update$/,
		)
		expect(query.params).toEqual(['a1', 1])
	})
})

// Spec §2.3: the provider never changes; the update and the secrets read name the stored one.
describe('appOfProvider', () => {
	it('is this app of this provider', () => {
		const query = drizzle
			.mock()
			.select({ id: apps.id })
			.from(apps)
			.where(appOfProvider('a1', 'dify'))
			.toSQL()
		// Drizzle 1.0.0-rc.4 parenthesises each and() operand and the whole condition (measured while planning).
		expect(query.sql).toMatch(/where \(\("apps"\."id" = \$1\) and \("apps"\."provider" = \$2\)\)$/)
		expect(query.params).toEqual(['a1', 'dify'])
	})
})

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }

// The role check comes before the database (the @/db mock throws on any query).
describe('the apps DAL refuses a non-admin actor before anything else', () => {
	it.each([
		['listAdminApps', () => listAdminApps(member)],
		[
			'createApp',
			() =>
				createApp(member, {
					provider: 'dify',
					common: { name: 'x', description: '', tags: [], enabled: true },
					access: { mode: 'everyone', groupIds: [], userIds: [] },
					settings,
					secrets: { apiKey: 'k' },
					icon: { intent: 'keep' },
				}),
		],
		[
			'updateApp',
			() =>
				updateApp(member, 'a1', {
					common: { name: 'x', description: '', tags: [], enabled: true },
					access: { mode: 'everyone', groupIds: [], userIds: [] },
					settings,
					secrets: {},
					icon: { intent: 'keep' },
				}),
		],
		['deleteApp', () => deleteApp(member, 'a1')],
		['getStoredSecrets', () => getStoredSecrets(member, 'a1', 'dify')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
```

In `__tests__/data-apps-access.test.ts`, rename the table: `sed -i -E 's/\bdifyApps\b/apps/g; s/"dify_apps"/"apps"/g; s/select from dify_apps/select from apps/' __tests__/data-apps-access.test.ts`. Its `render` helper, the helper's comment and its expectations then read `apps` (the SQL patterns quote the table as `"apps"`).

In `__tests__/b3a-schema.test.ts`, rename likewise: `sed -i -E "s/\bdifyApps\b/apps/g; s/'dify_apps'/'apps'/g" __tests__/b3a-schema.test.ts`.

Delete the operation case `fetchSignedFile` from `__tests__/dify-client.test.ts` (the `operations` entry from `{` before `name: 'fetchSignedFile',` to its `},`, 9 lines) and the case that tests it on its own with the comment above it (from `// /site's icon_url is a signed link Dify built from FILES_URL, which may be another origin than the API's.`, line 407 at `dfeff12e`, through the closing `})` of the `it(…)` whose body starts `const response = await difyClient(credentials).fetchSignedFile(`, line 419).

In `__tests__/action-failure.test.ts`, the case that logs a DifyError names the removed sync as its context; rename it:

```bash
sed -i "s/'syncApp'/'updateAppAction'/; s/'syncApp:'/'updateAppAction:'/" __tests__/action-failure.test.ts
git diff --numstat -- __tests__/action-failure.test.ts
```

Expected: `2`, `2` and the file name (lines 49 and 51 at `dfeff12e`).

Create `__tests__/data-apps-reads.test.ts`, the two pins of `__tests__/data-apps-sync.test.ts` that no live test can observe (which columns a read selects, and a delete the driver reports no row count for), on a fake Drizzle chain:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

// A fake Drizzle chain that records the selection and answers a delete with a chosen rowCount (node-postgres "Result":
// `rowCount` is null for a command it cannot count). vi.mock factories are hoisted, so the fake comes from vi.hoisted.
const { db } = vi.hoisted(() => {
	const db = {
		row: undefined as Record<string, unknown> | undefined,
		fields: undefined as Record<string, unknown> | undefined,
		deleted: 0 as number | null,
		select: (fields?: Record<string, unknown>) => {
			db.fields = fields
			const rows = async () => (db.row ? [db.row] : [])
			return { from: () => ({ where: () => ({ limit: rows, orderBy: rows }) }) }
		},
		delete: () => ({ where: async () => ({ rowCount: db.deleted }) }),
	}
	return { db }
})
vi.mock('@/db', () => ({ getDb: () => db }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { deleteApp, getChatApp, listApps } from '@/lib/data/apps'

const owner = { id: 'o1', email: 'o@example.com', name: null, role: 'owner' as const }
const member = { id: 'u1', email: 'u@example.com', name: null, role: 'user' as const }
const row = {
	id: 'a1',
	name: 'Tea',
	description: '',
	tags: [],
	isEnabled: true,
	hasIcon: true,
	provider: 'dify',
	settings: {
		apiBase: 'https://dify.example/v1',
		appType: 'chat',
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	},
}

afterEach(() => {
	db.row = undefined
	db.fields = undefined
})

// Plan decision ab: a mapper cannot leak what is never read.
describe('the user reads select neither the secrets nor the icon bytes', () => {
	it.each([
		['listApps', () => listApps(member)],
		['getChatApp', () => getChatApp(member, 'a1')],
	])('%s', async (_name, read) => {
		db.row = row
		const result = await read()
		const fields = Object.keys(db.fields ?? {})
		expect(fields).toEqual(expect.arrayContaining(['provider', 'settings', 'hasIcon']))
		for (const column of ['secrets', 'iconImage', 'iconMime']) expect(fields).not.toContain(column)
		expect(Array.isArray(result) ? result[0] : result).toMatchObject({ id: 'a1', hasIcon: true })
	})
})

// Global Constraints: every rowCount consumer handles null (Part 0's ruling A10).
describe('deleteApp reads the row count', () => {
	it('answers true for a deleted row, and false for none or no row count (rowCount null)', async () => {
		db.deleted = 1
		await expect(deleteApp(owner, 'a1')).resolves.toBe(true)
		db.deleted = 0
		await expect(deleteApp(owner, 'a1')).resolves.toBe(false)
		db.deleted = null
		await expect(deleteApp(owner, 'a1')).resolves.toBe(false)
	})
})
```

- [ ] **Step 9: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/data-apps.test.ts __tests__/data-apps-reads.test.ts __tests__/data-apps-access.test.ts __tests__/b3a-schema.test.ts __tests__/dify-client.test.ts` Expected: FAIL: `data-apps` (`appOfProvider`, `getStoredSecrets` and the new DTO shapes do not exist; `lib/data/apps.ts` still reads `difyApps`, which `@/db/schema` no longer exports); `data-apps-reads` and `data-apps-access` likewise; `dify-client` (`covers every method of the client`: `fetchSignedFile` is still a method).

Run: `pnpm test:db` Expected: FAIL in `apps.db.test.ts` (the module does not load: `difyApps` is not exported); `apps-migration.db.test.ts` and `schema.db.test.ts` PASS (they need only the migrations of Steps 3–5).

- [ ] **Step 10: The data layer**

Add to `lib/providers/schemas.ts`, after `mergeSecrets`:

```ts
/**
 * A document's zod refusal as an action's field errors (charter §4.5: keyed by field path), under the document's name:
 * `secrets.apiKey: ['too_small']`. The codes are zod's issue codes; the form maps a field with an error to its own text.
 */
export const documentFieldErrors = (
	document: 'settings' | 'secrets',
	error: z.ZodError,
): Record<string, string[]> =>
	Object.fromEntries(
		error.issues.map(issue => [[document, ...issue.path.map(String)].join('.'), [issue.code]]),
	)
```

In `lib/providers/dify/client.ts`, delete `fetchSignedFile` with its comment (the `/** A signed link from Dify's own answer (`/site`'s `icon_url`), for the icon sync: …` block and `fetchSignedFile: (url: URL) => request(url.toString(), { redirect: 'error' }, false),`): its only caller was the sync (Plan decision t).

In `lib/action-result.ts`, add after `| 'provider_unreachable'` the two lines `| 'provider_key_refused'` and `| 'provider_error'`.

Replace the whole of `lib/data/apps.ts` with:

```ts
import 'server-only'

import { and, desc, eq, exists, or, sql, type SQL } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'

import { getDb, type Db } from '@/db'
import { appGroupGrants, appUserGrants, apps, userGroupMembers } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import type { AccessMode, AppAccessSettings } from '@/lib/app-access'
import { hasAdminRights } from '@/lib/auth/roles'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'
import { isProviderId, type ProviderId } from '@/lib/providers/ids'
import {
	PROVIDERS,
	type ProviderChatFields,
	type ProviderSecretsSet,
	type ProviderSummaryFields,
} from '@/lib/providers/registry'
import {
	checkDocuments,
	checkSettings,
	documentFieldErrors,
	mergeSecrets,
	PROVIDER_SCHEMAS,
	type ProviderSettings,
	type StoredDocuments,
	type StoredSettings,
} from '@/lib/providers/schemas'
import { APP_ICON_MAX_BYTES, type ImageErrorCode } from '@/lib/settings/image-rules'
import { ImageError, processImage } from '@/lib/settings/images'

/*
 * The apps Data Access Layer (charter §4.2; Part 1 spec §2.3). Every function takes the verified actor first: the entry
 * point (route, action, page) verifies the session once, and nothing here can be called without a SessionUser.
 * Admin-only reads and writes check the role themselves (assertAdmin); every user read applies `visibleTo`, so a `user`
 * reaches only the apps granted to it (ADR-0027). The documents are read and written through the provider registry
 * (lib/providers): parsed on every write and every read (decision 17), never half-typed, the secrets in no DTO (DV 10).
 * Saving never calls a provider (decision 18).
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The stored tags, a jsonb array (PostgreSQL 18 "JSON Types"): its strings only, and [] for anything else. */
export const parseTags = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []

/** Whether an image is stored, computed by the database: no read selects the bytes (getAppIcon serves them). */
const hasIcon = sql<boolean>`${apps.iconImage} IS NOT NULL`.mapWith(Boolean)

/** A refused row is logged by its id and which document failed, never their values (OWASP Logging, "Data to exclude"). */
const logRefusal = (appId: string, code: string) =>
	console.error('Stored app documents refused:', { appId, code })

/** The settings alone, as a user's DTO reads need them, or null (spec §2.3); a refusal is logged. */
export const readSettings = (
	appId: string,
	provider: string,
	settings: unknown,
): StoredSettings | null => {
	const check = checkSettings(provider, settings)
	if (check.ok) return check.documents
	logRefusal(appId, check.code)
	return null
}

/**
 * A row's documents as its provider's schemas read them, or null (spec §2.3; decision 17: checked on every read). A row
 * that fails is never returned half-typed: users meet it as an unknown app, the admin as "Invalid settings".
 */
export const readDocuments = (
	appId: string,
	provider: string,
	settings: unknown,
	secrets: unknown,
): StoredDocuments | null => {
	const check = checkDocuments(provider, settings, secrets)
	if (check.ok) return check.documents
	logRefusal(appId, check.code)
	return null
}

/* ----- The user's DTOs (spec §2.3, §5) ----- */

/**
 * The columns a user's DTO reads: the neutral fields, the provider and the settings, never the secrets or the icon bytes
 * (Plan decision ab: a mapper cannot leak what is never read).
 */
const recordColumns = {
	id: apps.id,
	name: apps.name,
	description: apps.description,
	tags: apps.tags,
	isEnabled: apps.isEnabled,
	hasIcon,
	provider: apps.provider,
	settings: apps.settings,
}

type RecordRow = {
	id: string
	name: string
	description: string
	tags: unknown
	isEnabled: boolean
	hasIcon: boolean
	provider: string
	settings: unknown
}

/** An app as a user's DTOs see it: its neutral fields and its settings as its provider's schema reads them. */
export type AppRecord = {
	id: string
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
} & StoredSettings

const toRecord = (row: RecordRow): AppRecord | null => {
	const documents = readSettings(row.id, row.provider, row.settings)
	return (
		documents && {
			id: row.id,
			name: row.name,
			description: row.description,
			tags: parseTags(row.tags),
			enabled: row.isEnabled,
			hasIcon: row.hasIcon,
			...documents,
		}
	)
}

type ChatAppCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'enabled' | 'hasIcon'>

/** The chat's view (spec §2.3): a union keyed by provider; never the base URL or the secrets (file links go through the proxy). */
export type ChatAppDto = {
	[P in ProviderId]: ChatAppCommon & { provider: P } & ProviderChatFields<P>
}[ProviderId]

type SummaryCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'tags' | 'hasIcon'>

/** What a gallery card shows (spec §2.3, E10): the provider's own fields are its summary fields (for Dify, the type). */
export type AppSummary = {
	[P in ProviderId]: SummaryCommon & { provider: P } & ProviderSummaryFields<P>
}[ProviderId]

export const toChatAppDto = (record: AppRecord): ChatAppDto => ({
	id: record.id,
	provider: record.provider,
	name: record.name,
	description: record.description,
	enabled: record.enabled,
	hasIcon: record.hasIcon,
	...PROVIDERS[record.provider].chatFields(record.settings),
})

export const toAppSummary = (record: AppRecord): AppSummary => ({
	id: record.id,
	provider: record.provider,
	name: record.name,
	description: record.description,
	tags: record.tags,
	hasIcon: record.hasIcon,
	...PROVIDERS[record.provider].summaryFields(record.settings),
})

/* ----- The admin's DTO (spec §2.3, §4.5) ----- */

type AdminAppCommon = {
	id: string
	provider: ProviderId
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
	access: AppAccessSettings
	createdAt: string
	updatedAt: string
}

/**
 * The admin's view: every app with its access, its settings and which secrets are set, never their values (spec §2.3;
 * DV 10, OWASP ASVS 14.2.6). A row whose documents fail carries `invalid: true` and no settings: the table marks it and
 * the form opens on the provider's defaults so the admin can repair it.
 */
export type AdminAppDto =
	| {
			[P in ProviderId]: AdminAppCommon & {
				provider: P
				invalid: false
				settings: ProviderSettings<P>
				secretsSet: ProviderSecretsSet<P>
			}
	  }[ProviderId]
	| (AdminAppCommon & { invalid: true })

/** Every column the admin DTO reads: the secrets too (for `secretsSet`), never the icon bytes. */
const adminColumns = {
	id: apps.id,
	createdAt: apps.createdAt,
	updatedAt: apps.updatedAt,
	provider: apps.provider,
	name: apps.name,
	description: apps.description,
	tags: apps.tags,
	isEnabled: apps.isEnabled,
	accessMode: apps.accessMode,
	hasIcon,
	settings: apps.settings,
	secrets: apps.secrets,
}

type AdminRow = {
	id: string
	createdAt: Date
	updatedAt: Date
	provider: string
	name: string
	description: string
	tags: unknown
	isEnabled: boolean
	accessMode: AccessMode
	hasIcon: boolean
	settings: unknown
	secrets: unknown
}
type GroupGrant = { appId: string; groupId: string }
type UserGrant = { appId: string; userId: string }

/**
 * One app with its access; only the grants of this app count, whatever lists it is handed. Null for a provider the hub
 * does not know (DV 11: the CHECK allows none; such a row is logged and left out).
 */
export const toAdminAppDto = (
	row: AdminRow,
	groupGrants: readonly GroupGrant[],
	userGrants: readonly UserGrant[],
): AdminAppDto | null => {
	if (!isProviderId(row.provider)) {
		logRefusal(row.id, 'unknown_provider')
		return null
	}
	const common: AdminAppCommon = {
		id: row.id,
		provider: row.provider,
		name: row.name,
		description: row.description,
		tags: parseTags(row.tags),
		enabled: row.isEnabled,
		hasIcon: row.hasIcon,
		access: {
			mode: row.accessMode,
			groupIds: groupGrants.filter(grant => grant.appId === row.id).map(grant => grant.groupId),
			userIds: userGrants.filter(grant => grant.appId === row.id).map(grant => grant.userId),
		},
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	}
	const documents = readDocuments(row.id, row.provider, row.settings, row.secrets)
	if (!documents) return { ...common, invalid: true }
	return {
		...common,
		provider: documents.provider,
		invalid: false,
		settings: documents.settings,
		secretsSet: PROVIDERS[documents.provider].secretsSet(documents.secrets),
	}
}

/** The apps with their access, each grant list grouped once by app (MDN `Map.groupBy`); the apps' order stays. */
export const toAdminAppDtos = (
	rows: readonly AdminRow[],
	groupGrants: readonly GroupGrant[],
	userGrants: readonly UserGrant[],
): AdminAppDto[] => {
	const groupsOf = Map.groupBy(groupGrants, grant => grant.appId)
	const usersOf = Map.groupBy(userGrants, grant => grant.appId)
	return rows.flatMap(row => {
		const dto = toAdminAppDto(row, groupsOf.get(row.id) ?? [], usersOf.get(row.id) ?? [])
		return dto ? [dto] : []
	})
}

/* ----- Access and grants (ADR-0027) ----- */

/** The grant rows an access setting stores (B3 spec §4.4): none while open to everyone (deviation 4), each id once. */
export const grantRowsFor = (appId: string, access: AppAccessSettings) =>
	access.mode === 'everyone'
		? { groups: [], users: [] }
		: {
				groups: [...new Set(access.groupIds)].map(groupId => ({ appId, groupId })),
				users: [...new Set(access.userIds)].map(userId => ({ appId, userId })),
			}

/** Replaces the app's grants inside the caller's transaction; a deleted group or account fails it (23503). */
const writeGrants = async (
	tx: Pick<Tx, 'delete' | 'insert'>,
	appId: string,
	access: AppAccessSettings,
) => {
	const rows = grantRowsFor(appId, access)
	await tx.delete(appGroupGrants).where(eq(appGroupGrants.appId, appId))
	await tx.delete(appUserGrants).where(eq(appUserGrants.appId, appId))
	if (rows.groups.length) await tx.insert(appGroupGrants).values(rows.groups)
	if (rows.users.length) await tx.insert(appUserGrants).values(rows.users)
}

/**
 * A locking read of one app by its primary key (ADR-0024 decision d; PostgreSQL 18 "Explicit Locking", 13.3.2: FOR
 * UPDATE "prevents them from being locked, modified or deleted by other transactions until the current transaction
 * ends"), with the provider and the stored secrets the update needs: the update reads them under the lock, so an app
 * deleted after the form loaded answers not_found and writes nothing (ruling M11 of B3a).
 */
export const lockApp = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: apps.id, provider: apps.provider, secrets: apps.secrets })
		.from(apps)
		.where(eq(apps.id, id))
		.limit(1)
		.for('update')

/** This app, of this provider (spec §2.3: the provider never changes after insert, so a write names the stored one). */
export const appOfProvider = (id: string, provider: ProviderId) =>
	and(eq(apps.id, id), eq(apps.provider, provider))

/** Builds the access rule's subqueries without a database instance (Drizzle docs, standalone query builder). */
const qb = new QueryBuilder()

/**
 * Which apps an actor may use (B3 spec §4.1, ADR-0027): every app for an account with admin rights (no condition),
 * otherwise an app open to everyone, granted to the account, or granted to a group it belongs to, whatever the
 * membership's source. One rule for the list and every single-app read (spec §4.2; OWASP Authorization "Validate the
 * Permissions on Every Request"; Next "A Data Access Layer should … Perform authorization checks"). Built with
 * Drizzle's `or`/`exists` on correlated subqueries; `and()` skips the undefined an admin gets.
 */
export const visibleTo = (actor: Pick<SessionUser, 'id' | 'role'>): SQL | undefined =>
	hasAdminRights(actor)
		? undefined
		: or(
				eq(apps.accessMode, 'everyone'),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appUserGrants)
						.where(and(eq(appUserGrants.appId, apps.id), eq(appUserGrants.userId, actor.id))),
				),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appGroupGrants)
						.innerJoin(userGroupMembers, eq(userGroupMembers.groupId, appGroupGrants.groupId))
						.where(and(eq(appGroupGrants.appId, apps.id), eq(userGroupMembers.userId, actor.id))),
				),
			)

/* ----- Reads ----- */

/**
 * The gallery (spec §2.3, §5): the enabled apps the actor may use, newest first, as cards. An app whose settings fail is
 * left out (logged); the access rule is visibleTo, as for every read (ADR-0027).
 */
export async function listApps(actor: SessionUser): Promise<AppSummary[]> {
	const rows = await getDb()
		.select(recordColumns)
		.from(apps)
		.where(and(eq(apps.isEnabled, true), visibleTo(actor)))
		.orderBy(desc(apps.createdAt))
	return rows.flatMap(row => {
		const record = toRecord(row)
		return record ? [toAppSummary(record)] : []
	})
}

/** Every app with its access, for /app-management (B3a deviation 1). */
export async function listAdminApps(actor: SessionUser): Promise<AdminAppDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [rows, groupGrants, userGrants] = await Promise.all([
		db.select(adminColumns).from(apps).orderBy(desc(apps.createdAt)),
		db
			.select({ appId: appGroupGrants.appId, groupId: appGroupGrants.groupId })
			.from(appGroupGrants),
		db.select({ appId: appUserGrants.appId, userId: appUserGrants.userId }).from(appUserGrants),
	])
	return toAdminAppDtos(rows, groupGrants, userGrants)
}

/**
 * Null for a missing app, one the actor may not use, and one whose settings fail alike (B3 spec §4.2: no difference to
 * probe; Part 1 spec §2.3: users meet a broken row as an unknown app).
 */
export async function getChatApp(actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const [row] = await getDb()
		.select(recordColumns)
		.from(apps)
		.where(and(eq(apps.id, id), visibleTo(actor)))
		.limit(1)
	const record = row ? toRecord(row) : null
	return record ? toChatAppDto(record) : null
}

/**
 * What a provider route needs (spec §2.3): whether the app may be used, and its documents as its provider's schemas read
 * them. Built only for the server-only route guard (lib/providers/route.ts); never a DTO.
 */
export type AppAccess = { id: string; enabled: boolean } & StoredDocuments

/** For the provider routes: null when missing, not the actor's to use, or refused by its schemas. */
export async function getAppAccess(actor: SessionUser, id: string): Promise<AppAccess | null> {
	const [row] = await getDb()
		.select({
			id: apps.id,
			isEnabled: apps.isEnabled,
			provider: apps.provider,
			settings: apps.settings,
			secrets: apps.secrets,
		})
		.from(apps)
		.where(and(eq(apps.id, id), visibleTo(actor)))
		.limit(1)
	if (!row) return null
	const documents = readDocuments(row.id, row.provider, row.settings, row.secrets)
	return documents && { id: row.id, enabled: row.isEnabled, ...documents }
}

export async function getAppIcon(
	actor: SessionUser,
	id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
	const [row] = await getDb()
		.select({ iconImage: apps.iconImage, iconMime: apps.iconMime })
		.from(apps)
		.where(and(eq(apps.id, id), visibleTo(actor)))
		.limit(1)
	return row?.iconImage && row.iconMime ? { bytes: row.iconImage, mime: row.iconMime } : null
}

/**
 * The stored secrets of this app of this provider, for a connection test that leaves a secret blank (spec §4.2): read on
 * the server and never answered to the browser. Admin only; null when there is no such app.
 */
export async function getStoredSecrets(
	actor: SessionUser,
	id: string,
	provider: ProviderId,
): Promise<{ secrets: unknown } | null> {
	assertAdmin(actor)
	const [row] = await getDb()
		.select({ secrets: apps.secrets })
		.from(apps)
		.where(appOfProvider(id, provider))
		.limit(1)
	return row ? { secrets: row.secrets } : null
}

/* ----- Writes (spec §2.3, §4.3, §4.4) ----- */

/** An icon change (spec §4.1, §4.4): keep the stored image, remove it, or replace it with an upload. */
export type IconChange =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File }

/** The admin-owned fields every provider shares (spec §2.1; decision 5). */
export interface AppCommonInput {
	name: string
	description: string
	tags: string[]
	enabled: boolean
}

export interface CreateAppInput {
	provider: ProviderId
	common: AppCommonInput
	access: AppAccessSettings
	settings: unknown
	secrets: unknown
	icon: IconChange
}

/** An edit takes no provider: the stored one stays (spec §2.3). A secret left undefined keeps its stored value. */
export interface UpdateAppInput {
	common: AppCommonInput
	access: AppAccessSettings
	settings: unknown
	secrets: Record<string, string | undefined>
	icon: IconChange
}

type IconColumns = { iconImage: Buffer | null; iconMime: string | null }

/**
 * The icon columns a change writes (spec §4.4), or why the image was refused. A replacement goes through ADR-0030's
 * pipeline before any transaction, as saveBranding does (PostgreSQL 18 "Explicit Locking": no long-held transactions);
 * an upload over the cap is refused unread by its size (MDN `Blob.size`), before `arrayBuffer()` copies it.
 */
const iconColumnsFor = async (
	icon: IconChange,
): Promise<{ ok: true; columns?: IconColumns } | { ok: false; code: ImageErrorCode }> => {
	if (icon.intent === 'keep') return { ok: true }
	if (icon.intent === 'remove') return { ok: true, columns: { iconImage: null, iconMime: null } }
	try {
		if (icon.file.size > APP_ICON_MAX_BYTES) throw new ImageError('too_large')
		const image = await processImage('appIcon', Buffer.from(await icon.file.arrayBuffer()))
		return { ok: true, columns: { iconImage: image.bytes, iconMime: 'image/png' } }
	} catch (error) {
		if (!(error instanceof ImageError)) throw error
		return { ok: false, code: error.code }
	}
}

const commonColumns = (common: AppCommonInput, access: AppAccessSettings) => ({
	name: common.name,
	description: common.description,
	tags: common.tags,
	isEnabled: common.enabled,
	accessMode: access.mode,
})

/**
 * Creates the app: both documents parsed again by the provider's schemas (the action parsed them too; DV 8b), the icon
 * through the pipeline first, then the row and its grants in one transaction (a deleted group or account rejects the
 * grant insert with 23503 and no app is left behind). Saving never calls the provider (decision 18).
 */
export async function createApp(
	actor: SessionUser,
	input: CreateAppInput,
): Promise<ActionResult<{ id: string }>> {
	assertAdmin(actor)
	const schemas = PROVIDER_SCHEMAS[input.provider]
	const settings = schemas.settingsSchema.safeParse(input.settings)
	if (!settings.success)
		return fail('invalid_input', documentFieldErrors('settings', settings.error))
	const secrets = schemas.secretsSchema.safeParse(input.secrets)
	if (!secrets.success) return fail('invalid_input', documentFieldErrors('secrets', secrets.error))
	const icon = await iconColumnsFor(input.icon)
	if (!icon.ok) return fail('invalid_image', { icon: [icon.code] })
	const id = crypto.randomUUID()
	await getDb().transaction(async tx => {
		await tx.insert(apps).values({
			id,
			provider: input.provider,
			...commonColumns(input.common, input.access),
			settings: settings.data,
			secrets: secrets.data,
			...icon.columns,
		})
		await writeGrants(tx, id, input.access)
	})
	return ok({ id })
}

/**
 * Updates the app under a lock on its row: the provider is the stored one (the update's WHERE names it, spec §2.3), the
 * settings are parsed by its schema, a blank secret keeps the stored value (the stored document with the given fields
 * laid over it, then parsed; spec §2.3, DV 10), the icon goes through the pipeline before the transaction, and the
 * grants are replaced with the row. not_found when the app is gone. Saving never calls the provider (decision 18).
 */
export async function updateApp(
	actor: SessionUser,
	id: string,
	input: UpdateAppInput,
): Promise<ActionResult> {
	assertAdmin(actor)
	const icon = await iconColumnsFor(input.icon)
	if (!icon.ok) return fail('invalid_image', { icon: [icon.code] })
	return getDb().transaction(async (tx): Promise<ActionResult> => {
		const [locked] = await lockApp(tx, id)
		if (!locked || !isProviderId(locked.provider)) return fail('not_found')
		const schemas = PROVIDER_SCHEMAS[locked.provider]
		const settings = schemas.settingsSchema.safeParse(input.settings)
		if (!settings.success)
			return fail('invalid_input', documentFieldErrors('settings', settings.error))
		const secrets = schemas.secretsSchema.safeParse(mergeSecrets(locked.secrets, input.secrets))
		if (!secrets.success)
			return fail('invalid_input', documentFieldErrors('secrets', secrets.error))
		await tx
			.update(apps)
			.set({
				...commonColumns(input.common, input.access),
				settings: settings.data,
				secrets: secrets.data,
				...icon.columns,
			})
			.where(appOfProvider(id, locked.provider))
		await writeGrants(tx, id, input.access)
		return ok(undefined)
	})
}

export async function deleteApp(actor: SessionUser, id: string): Promise<boolean> {
	assertAdmin(actor)
	// node-postgres "Result": `rowCount` is the rows the command processed, null for a command that reports none.
	const result = await getDb().delete(apps).where(eq(apps.id, id))
	return (result.rowCount ?? 0) > 0
}
```

(`lib/providers/route.ts` imports `AppAccess` from here; it is unchanged.)

#### The actions and the admin client

- [ ] **Step 11: Write the failing action and form tests**

Run: `git rm __tests__/data-apps-sync.test.ts` (its reads are Step 8's live cases and `data-apps.test.ts`, its selection and row-count pins `data-apps-reads.test.ts`; its sync cases go with the sync).

Replace the whole of `__tests__/app-management-schemas.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'

import {
	accessSchema,
	APP_DESCRIPTION_MAX,
	APP_NAME_MAX,
	APP_TAG_MAX,
	APP_TAGS_MAX,
	connectionTestSchema,
	createAppFormSchema,
	formFieldErrors,
	updateAppFormSchema,
} from '@/app/(admin)/app-management/schemas'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'chat',
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
}
const values = {
	provider: 'dify',
	name: 'Tea',
	description: 'Brews tea',
	tags: ['a'],
	enabled: true,
	access: { mode: 'restricted', groupIds: [], userIds: [] },
	settings,
	secrets: { apiKey: 'app-k' },
}
/** The create form's entries as Object.fromEntries(formData) hands them to the schema. */
const form = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
	values: JSON.stringify({ ...values, ...over }),
	iconIntent: 'keep',
	...extra,
})
const icon = new File([new Uint8Array([1])], 'icon.png', { type: 'image/png' })

// Spec §2.1: the limits of the admin-owned fields, pinned.
describe('the limits', () => {
	it('are a 255-character name, a 2,000-character description and 10 tags of 32 characters', () => {
		expect([APP_NAME_MAX, APP_DESCRIPTION_MAX, APP_TAGS_MAX, APP_TAG_MAX]).toEqual([
			255, 2000, 10, 32,
		])
	})
})

describe('createAppFormSchema (spec §4.3)', () => {
	it('reads the JSON values and the icon intent into the data layer’s input', () => {
		expect(createAppFormSchema.parse(form())).toEqual({
			provider: 'dify',
			common: { name: 'Tea', description: 'Brews tea', tags: ['a'], enabled: true },
			access: { mode: 'restricted', groupIds: [], userIds: [] },
			settings,
			secrets: { apiKey: 'app-k' },
			icon: { intent: 'keep' },
		})
	})
	// Three tags given, one a duplicate once trimmed, and eight more: ten distinct, the limit.
	it('trims the name, the description and the tags, drops duplicate tags, then counts them', () => {
		const parsed = createAppFormSchema.parse(
			form({
				name: '  Tea  ',
				description: ' Brews ',
				tags: [' a', 'a', 'b ', ...Array.from({ length: 8 }, (_, index) => `t${index}`)],
			}),
		)
		expect(parsed.common).toMatchObject({ name: 'Tea', description: 'Brews' })
		expect(parsed.common.tags).toEqual(['a', 'b', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
	})
	it.each([
		['an empty name', { name: '   ' }],
		['a 256-character name', { name: 'a'.repeat(256) }],
		['a 2,001-character description', { description: 'a'.repeat(2001) }],
		['an empty tag', { tags: [' '] }],
		['a 33-character tag', { tags: ['a'.repeat(33)] }],
		['11 different tags', { tags: Array.from({ length: 11 }, (_, index) => `t${index}`) }],
		['an unknown provider', { provider: 'agui' }],
		['settings Dify refuses', { settings: { ...settings, appType: 'rag-pipeline' } }],
		['no key on a new app', { secrets: { apiKey: '' } }],
	])('refuses %s', (_label, over) => {
		expect(createAppFormSchema.safeParse(form(over)).success).toBe(false)
	})
	it('refuses values that are not JSON, or missing', () => {
		expect(createAppFormSchema.safeParse({ values: '{', iconIntent: 'keep' }).success).toBe(false)
		expect(createAppFormSchema.safeParse({ iconIntent: 'keep' }).success).toBe(false)
	})
	it('takes a replacement icon with its file, refuses a replacement without one, and reads remove', () => {
		expect(createAppFormSchema.parse(form({}, { iconIntent: 'replace', icon })).icon).toEqual({
			intent: 'replace',
			file: icon,
		})
		expect(createAppFormSchema.safeParse(form({}, { iconIntent: 'replace' })).success).toBe(false)
		expect(createAppFormSchema.parse(form({}, { iconIntent: 'remove' })).icon).toEqual({
			intent: 'remove',
		})
	})
})

describe('updateAppFormSchema (spec §2.3)', () => {
	it('reads a blank key as not given, so the stored one stays', () => {
		expect(updateAppFormSchema.parse(form({ secrets: { apiKey: '' } })).secrets).toEqual({
			apiKey: undefined,
		})
		expect(updateAppFormSchema.parse(form({ secrets: { apiKey: 'app-new' } })).secrets).toEqual({
			apiKey: 'app-new',
		})
	})
})

describe('connectionTestSchema (spec §4.2)', () => {
	const test = { provider: 'dify', settings, secrets: { apiKey: '' } }
	it('takes the provider, its settings, its secrets as the form holds them, and the app when it exists', () => {
		expect(connectionTestSchema.parse(test)).toEqual({ ...test, secrets: { apiKey: undefined } })
		const appId = '3b241101-e2bb-4255-8caf-4136c566a962'
		expect(connectionTestSchema.parse({ ...test, appId }).appId).toBe(appId)
	})
	// Part 0 spec §3.2: an id from outside passes z.uuid() before it reaches a query.
	it('refuses an app id that is not a UUID', () => {
		expect(connectionTestSchema.safeParse({ ...test, appId: 'a1' }).success).toBe(false)
	})
})

// The drawer marks a refused field by its path; codes only, since a zod message can echo the input (review B7).
describe('formFieldErrors', () => {
	it('keys an issue inside the JSON values by its own path, with its code', () => {
		const parsed = createAppFormSchema.safeParse(
			form({ name: '', settings: { ...settings, apiBase: 'ftp://x' } }),
		)
		expect(parsed.success).toBe(false)
		expect(formFieldErrors(parsed.error!)).toEqual({
			name: ['too_small'],
			'settings.apiBase': ['invalid_format'],
		})
	})
	it('keys a body that is not JSON as values, with a fixed message instead of the parser’s', () => {
		const parsed = createAppFormSchema.safeParse({
			values: '{"secrets": {"apiKey": "app-sec',
			iconIntent: 'keep',
		})
		expect(parsed.error?.issues).toEqual([
			expect.objectContaining({
				path: ['values'],
				code: 'invalid_format',
				message: 'Invalid JSON',
			}),
		])
		expect(formFieldErrors(parsed.error!)).toEqual({ values: ['invalid_format'] })
	})
})
```

Then append, at the end of the new file, the unchanged `describe('accessSchema (B3 spec §4.4)', …)` block from the old file (its lines 57–88; copy it before the old file is overwritten).

Replace the whole of `__tests__/app-management-actions.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, createApp, updateApp, deleteApp, getStoredSecrets, refresh } = vi.hoisted(
	() => ({
		getServerSession: vi.fn(),
		createApp: vi.fn(),
		updateApp: vi.fn(),
		deleteApp: vi.fn(),
		getStoredSecrets: vi.fn(),
		refresh: vi.fn(),
	}),
)
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ createApp, updateApp, deleteApp, getStoredSecrets }))
vi.mock('next/cache', () => ({ refresh }))

import {
	createAppAction,
	deleteAppAction,
	testAppConnectionAction,
	updateAppAction,
} from '@/app/(admin)/app-management/actions'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const ACCOUNT_ID = '3d1a6f4b-8e5a-4192-ad0e-4f5a6b7c8d93'
const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'chat',
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
}
const values = {
	provider: 'dify',
	name: 'Tea',
	description: '',
	tags: [],
	enabled: true,
	access: { mode: 'restricted', groupIds: [], userIds: [] },
	settings,
	secrets: { apiKey: 'app-abc' },
}
const formData = (over: Record<string, unknown> = {}, file?: File) => {
	const data = new FormData()
	data.set('values', JSON.stringify({ ...values, ...over }))
	data.set('iconIntent', file ? 'replace' : 'keep')
	if (file) data.set('icon', file)
	return data
}
const common = { name: 'Tea', description: '', tags: [], enabled: true }
const access = { mode: 'restricted', groupIds: [], userIds: [] }

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	for (const fn of [getServerSession, createApp, updateApp, deleteApp, getStoredSecrets, refresh])
		fn.mockReset()
	getServerSession.mockResolvedValue({ user: actor })
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('createAppAction and updateAppAction (spec §4.3)', () => {
	it('answers unauthorized without a live session and touches nothing', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await createAppAction(formData())).toEqual({ ok: false, code: 'unauthorized' })
		expect(createApp).not.toHaveBeenCalled()
	})
	it('creates through the DAL with the parsed input, refreshes the route and answers its result', async () => {
		createApp.mockResolvedValue({ ok: true, data: { id: UUID } })
		expect(await createAppAction(formData())).toEqual({ ok: true, data: { id: UUID } })
		expect(createApp).toHaveBeenCalledWith(actor, {
			provider: 'dify',
			common,
			access,
			settings,
			secrets: { apiKey: 'app-abc' },
			icon: { intent: 'keep' },
		})
		expect(refresh).toHaveBeenCalledTimes(1)
	})
	it('hands the DAL a replacement icon’s file', async () => {
		createApp.mockResolvedValue({ ok: true, data: { id: UUID } })
		const file = new File([new Uint8Array([1])], 'icon.png', { type: 'image/png' })
		await createAppAction(formData({}, file))
		expect(createApp.mock.calls[0]![1].icon).toMatchObject({
			intent: 'replace',
			file: { name: 'icon.png' },
		})
	})
	it('answers invalid_input for values the schema refuses, by field, before the DAL', async () => {
		expect(await createAppAction(formData({ name: '' }))).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { name: ['too_small'] },
		})
		expect(createApp).not.toHaveBeenCalled()
	})
	it('passes a refusal of the DAL on, without a refresh', async () => {
		createApp.mockResolvedValue({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { icon: ['too_large'] },
		})
		expect(await createAppAction(formData())).toEqual({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { icon: ['too_large'] },
		})
		expect(refresh).not.toHaveBeenCalled()
	})
	// Spec §2.3: the edit takes no provider, and a blank key keeps the stored one.
	it('updates with no provider and a blank key read as not given', async () => {
		updateApp.mockResolvedValue({ ok: true, data: undefined })
		expect(await updateAppAction(UUID, formData({ secrets: { apiKey: '' } }))).toEqual({
			ok: true,
			data: undefined,
		})
		expect(updateApp).toHaveBeenCalledWith(actor, UUID, {
			common,
			access,
			settings,
			secrets: { apiKey: undefined },
			icon: { intent: 'keep' },
		})
		updateApp.mockResolvedValue({ ok: false, code: 'not_found' })
		expect(await updateAppAction(UUID, formData())).toEqual({ ok: false, code: 'not_found' })
	})

	// Part 0 spec §3.2: an id that is not a UUID would raise 22P02 in PostgreSQL; it is answered as an unknown app.
	it.each([
		['updateAppAction', () => updateAppAction('not-a-uuid', formData())],
		['deleteAppAction', () => deleteAppAction('not-a-uuid')],
	] as const)(
		'%s answers not_found for an id that is not a UUID, without asking the DAL',
		async (_name, call) => {
			expect(await call()).toEqual({ ok: false, code: 'not_found' })
			for (const fn of [updateApp, deleteApp, refresh]) expect(fn).not.toHaveBeenCalled()
		},
	)
	it('deletes, answering not_found when the row is gone', async () => {
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		deleteApp.mockResolvedValue(false)
		expect(await deleteAppAction(UUID)).toEqual({ ok: false, code: 'not_found' })
		expect(refresh).toHaveBeenCalledTimes(1)
	})
	// B3a deviation 3: a group or account picked in the drawer was deleted before the save.
	it.each([
		['createAppAction', () => createAppAction(formData()), createApp],
		['updateAppAction', () => updateAppAction(UUID, formData()), updateApp],
	] as const)(
		'%s answers invalid_input on the access field when a granted id is gone',
		async (_name, call, dal) => {
			dal.mockRejectedValue(
				new Error('Failed query', {
					cause: Object.assign(new Error('violates foreign key constraint'), {
						code: '23503',
						constraint: 'app_user_grants_user_id_users_id_fkey',
					}),
				}),
			)
			expect(await call()).toEqual({
				ok: false,
				code: 'invalid_input',
				fieldErrors: { access: ['unknown'] },
			})
			expect(refresh).not.toHaveBeenCalled()
		},
	)
	it('passes the access settings to the DAL as parsed', async () => {
		createApp.mockResolvedValue({ ok: true, data: { id: UUID } })
		const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
		const granted = { mode: 'restricted', groupIds: [groupId], userIds: [ACCOUNT_ID] }
		await createAppAction(formData({ access: granted }))
		expect(createApp.mock.calls[0]![1].access).toEqual(granted)
	})
	it.each([
		['createAppAction', () => createAppAction(formData())],
		['updateAppAction', () => updateAppAction(UUID, formData())],
		['deleteAppAction', () => deleteAppAction(UUID)],
		[
			'testAppConnectionAction',
			() => testAppConnectionAction({ provider: 'dify', settings, secrets: values.secrets }),
		],
	] as const)('%s answers forbidden to a user-role account', async (_name, call) => {
		getServerSession.mockResolvedValue({ user: { ...actor, role: 'user' } })
		expect(await call()).toEqual({ ok: false, code: 'forbidden' })
		for (const fn of [createApp, updateApp, deleteApp, getStoredSecrets, refresh])
			expect(fn).not.toHaveBeenCalled()
		expect(fetchMock).not.toHaveBeenCalled()
	})
	it('lets the owner through as well', async () => {
		const owner = { ...actor, role: 'owner' }
		getServerSession.mockResolvedValue({ user: owner })
		deleteApp.mockResolvedValue(true)
		expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
		expect(deleteApp).toHaveBeenCalledWith(owner, UUID)
	})
})

// Spec §4.2 and §9: against a mocked /info, with a typed key and with the stored one. The action saves nothing.
describe('testAppConnectionAction', () => {
	const json = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
	const sentKey = () =>
		new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).get('authorization')

	it('tests with the typed key and answers reachable', async () => {
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'chat' }))
		expect(
			await testAppConnectionAction({
				provider: 'dify',
				settings,
				secrets: { apiKey: 'app-typed' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(fetchMock.mock.calls[0]![0]).toBe('https://dify.example/v1/info')
		expect(sentKey()).toBe('Bearer app-typed')
		expect(getStoredSecrets).not.toHaveBeenCalled()
	})
	it('reads the stored key on the server when the field is blank and the app exists', async () => {
		getStoredSecrets.mockResolvedValue({ secrets: { apiKey: 'app-stored' } })
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'chat' }))
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'dify',
				settings,
				secrets: { apiKey: '' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(getStoredSecrets).toHaveBeenCalledWith(actor, UUID, 'dify')
		expect(sentKey()).toBe('Bearer app-stored')
	})
	it('leaves the stored secrets alone when every secret is typed, on a saved app too', async () => {
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'chat' }))
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'dify',
				settings,
				secrets: { apiKey: 'app-typed' },
			}),
		).toEqual({ ok: true, data: { outcome: 'reachable' } })
		expect(getStoredSecrets).not.toHaveBeenCalled()
		expect(sentKey()).toBe('Bearer app-typed')
	})
	it('answers the type Dify reports when it differs, as a success', async () => {
		fetchMock.mockResolvedValue(json(200, { name: 'Tea', mode: 'workflow' }))
		expect(
			await testAppConnectionAction({ provider: 'dify', settings, secrets: { apiKey: 'app-k' } }),
		).toEqual({ ok: true, data: { outcome: 'type_mismatch', reported: 'workflow' } })
	})
	it.each([
		[
			'a refused key',
			() => json(401, { code: 'unauthorized', message: 'x', status: 401 }),
			'provider_key_refused',
		],
		['an unreachable provider', () => new Response(null, { status: 503 }), 'provider_unreachable'],
		[
			'any other answer',
			() => json(403, { code: 'forbidden', message: 'x', status: 403 }),
			'provider_error',
		],
	])('answers %s with its own code', async (_label, answer, code) => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		fetchMock.mockImplementation(async () => answer())
		expect(
			await testAppConnectionAction({ provider: 'dify', settings, secrets: { apiKey: 'app-k' } }),
		).toEqual({ ok: false, code })
	})
	it('answers not_found for an app that is not there, and calls nothing', async () => {
		getStoredSecrets.mockResolvedValue(null)
		expect(
			await testAppConnectionAction({
				appId: UUID,
				provider: 'dify',
				settings,
				secrets: { apiKey: '' },
			}),
		).toEqual({ ok: false, code: 'not_found' })
		expect(fetchMock).not.toHaveBeenCalled()
	})
	it('answers invalid_input on the key when a new app’s key is blank', async () => {
		expect(
			await testAppConnectionAction({ provider: 'dify', settings, secrets: { apiKey: '' } }),
		).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { 'secrets.apiKey': ['invalid_type'] },
		})
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
```

(The last case's code is zod's for a missing required string: the blank key is dropped by `secretsUpdateSchema`, so `mergeSecrets({}, { apiKey: undefined })` is `{}` and `secretsSchema` reports `invalid_type` at `apiKey`; measured with zod 4.6.5 while planning.)

Replace the whole of `__tests__/app-form-values.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'

import {
	DEFAULT_APP_FORM_VALUES,
	providerDefaults,
	toAppFormData,
	toAppFormValues,
} from '@/components/admin/apps/app-form-values'
import type { AdminAppDto } from '@/lib/data/apps'
import { PROVIDER_SCHEMAS } from '@/lib/providers/schemas'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat' as const,
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: true,
	openingStatementDisplayMode: 'always' as const,
}
const access = { mode: 'restricted' as const, groupIds: ['g1'], userIds: ['u1'] }
const common = {
	id: 'a1',
	provider: 'dify' as const,
	name: 'Alpha',
	description: 'An app',
	tags: ['t'],
	enabled: false,
	hasIcon: false,
	access,
	createdAt: '',
	updatedAt: '',
}
const app: AdminAppDto = { ...common, invalid: false, settings, secretsSet: { apiKey: true } }

describe('the drawer’s values (spec §4.1)', () => {
	it('start a new app with no provider and closed (B3 spec §2 #9)', () => {
		expect(DEFAULT_APP_FORM_VALUES).toEqual({
			name: '',
			description: '',
			tags: [],
			enabled: true,
			access: { mode: 'restricted', groupIds: [], userIds: [] },
		})
	})
	it('give a picked provider its defaults, as a copy', () => {
		const defaults = providerDefaults('dify')
		expect(defaults).toEqual({
			settings: PROVIDER_SCHEMAS.dify.defaultSettings,
			secrets: { apiKey: '' },
		})
		expect(defaults.settings).not.toBe(PROVIDER_SCHEMAS.dify.defaultSettings)
	})
	it('fill the form from a saved app, with the key left blank (a blank keeps it)', () => {
		expect(toAppFormValues(app)).toEqual({
			provider: 'dify',
			name: 'Alpha',
			description: 'An app',
			tags: ['t'],
			enabled: false,
			access,
			settings,
			secrets: { apiKey: '' },
		})
	})
	// Spec §2.3: an invalid row opens on its provider's defaults, so the admin can repair it.
	it('open an invalid app on its provider’s defaults', () => {
		expect(toAppFormValues({ ...common, invalid: true }).settings).toEqual(
			PROVIDER_SCHEMAS.dify.defaultSettings,
		)
	})
	it('travel to the action as JSON with the icon intent, and the file only when it is replaced', () => {
		const keep = toAppFormData(toAppFormValues(app), { intent: 'keep' })
		expect(JSON.parse(String(keep.get('values')))).toMatchObject({
			provider: 'dify',
			name: 'Alpha',
		})
		expect(keep.get('iconIntent')).toBe('keep')
		expect(keep.has('icon')).toBe(false)
		const file = new File([new Uint8Array([1])], 'icon.png', { type: 'image/png' })
		const replace = toAppFormData(toAppFormValues(app), { intent: 'replace', file, url: 'blob:x' })
		expect(replace.get('iconIntent')).toBe('replace')
		expect((replace.get('icon') as File).name).toBe('icon.png')
	})
})
```

In `__tests__/app-errors.test.ts`, replace the body of the case (lines 7–14) with:

```ts
expect(appErrorKey('unauthorized', 'save')).toBe('common.session_expired')
expect(appErrorKey('forbidden', 'delete')).toBe('common.forbidden')
expect(appErrorKey('not_found', 'delete')).toBe('admin_apps.not_found')
expect(appErrorKey('provider_unreachable', 'save')).toBe('admin_apps.provider_unreachable')
expect(appErrorKey('invalid_input', 'save')).toBe('admin_apps.invalid_input')
expect(appErrorKey('operation_failed', 'save')).toBe('admin_apps.save_failed')
expect(appErrorKey('operation_failed', 'delete')).toBe('common.delete_failed')
```

Move the API base rule with its test's import: `git mv components/admin/apps/api-base-rule.ts components/provider-ui/dify/api-base-rule.ts`, and in `__tests__/api-base-rule.test.ts` replace `import { validateApiBase } from '@/components/admin/apps/api-base-rule'` with `import { validateApiBase } from '@/components/provider-ui/dify/api-base-rule'`.

- [ ] **Step 12: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/app-management-schemas.test.ts __tests__/app-management-actions.test.ts __tests__/app-form-values.test.ts __tests__/app-errors.test.ts __tests__/api-base-rule.test.ts` Expected: FAIL: the schemas do not export `createAppFormSchema` and the rest; `testAppConnectionAction` does not exist; `providerDefaults`/`toAppFormData` do not exist. (`api-base-rule` still passes here: `appInputSchema` goes in Step 13, and Step 14 points the rule at `apiBaseSchema`.)

- [ ] **Step 13: The schemas and the actions**

Replace the whole of `app/(admin)/app-management/schemas.ts` with:

```ts
import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'
import { ACCESS_MODES } from '@/lib/app-access'
import type { IconChange } from '@/lib/data/apps'
import { idSchema } from '@/lib/ids'
import { PROVIDER_SCHEMAS } from '@/lib/providers/schemas'

/** Who may use the app (B3 spec §4.4): the grants count while restricted; group and account ids are UUIDs (ADR-0031). */
export const accessSchema = z.object({
	mode: z.enum(ACCESS_MODES),
	groupIds: z.array(idSchema).max(1000).default([]),
	userIds: z.array(userIdSchema).max(10_000).default([]),
})

/** Part 1 spec §2.1: the admin-owned fields' limits (ADR-0025: limits live in zod; the columns are `text`). */
export const APP_NAME_MAX = 255
export const APP_DESCRIPTION_MAX = 2000
export const APP_TAGS_MAX = 10
export const APP_TAG_MAX = 32

export const appNameSchema = z.string().trim().min(1).max(APP_NAME_MAX)
export const appDescriptionSchema = z.string().trim().max(APP_DESCRIPTION_MAX)
/** Each tag trimmed and 1–32 characters, duplicates removed, then at most 10 (spec §2.1; zod 4 `.transform().pipe()`). */
export const appTagsSchema = z
	.array(z.string().trim().min(1).max(APP_TAG_MAX))
	.transform(tags => [...new Set(tags)])
	.pipe(z.array(z.string()).max(APP_TAGS_MAX))

const commonFields = {
	name: appNameSchema,
	description: appDescriptionSchema,
	tags: appTagsSchema,
	enabled: z.boolean(),
	access: accessSchema,
}

/**
 * The form's values, a union keyed by provider (spec §4.3; DV 8b, zod `z.discriminatedUnion`): the shared fields and the
 * provider's documents, checked by that provider's schemas. A new app's secrets are required; an edit's may be blank,
 * which keeps the stored value (spec §2.3).
 */
export const createValuesSchema = z.discriminatedUnion('provider', [
	z.object({
		...commonFields,
		provider: z.literal('dify'),
		settings: PROVIDER_SCHEMAS.dify.settingsSchema,
		secrets: PROVIDER_SCHEMAS.dify.secretsSchema,
	}),
])

export const updateValuesSchema = z.discriminatedUnion('provider', [
	z.object({
		...commonFields,
		provider: z.literal('dify'),
		settings: PROVIDER_SCHEMAS.dify.settingsSchema,
		secrets: PROVIDER_SCHEMAS.dify.secretsUpdateSchema,
	}),
])

export const ICON_INTENTS = ['keep', 'replace', 'remove'] as const

/**
 * A JSON string decoded, then checked by the schema: zod 4.6.5 "Codecs", its `json(schema)` example (Plan decision h:
 * the form's nested values travel as one FormData field next to the icon file). The message is fixed: JSON.parse's own
 * quotes part of the body, which can hold the typed key.
 */
const jsonField = <T extends z.core.$ZodType>(schema: T) =>
	z.codec(z.string(), schema, {
		decode: (text, ctx) => {
			try {
				return JSON.parse(text)
			} catch {
				ctx.issues.push({
					code: 'invalid_format',
					format: 'json',
					input: text,
					message: 'Invalid JSON',
				})
				return z.NEVER
			}
		},
		encode: value => JSON.stringify(value),
	})

const iconFields = {
	iconIntent: z.enum(ICON_INTENTS),
	icon: z.instanceof(File).optional(),
}

/** A replacement needs its file (the branding form's rule; zod 4 names the message through `error`). */
const fileGiven = (form: { iconIntent: (typeof ICON_INTENTS)[number]; icon?: File }) =>
	form.iconIntent !== 'replace' || form.icon !== undefined
const fileRequired = { path: ['icon'], error: 'file_required' }

const iconChange = (intent: (typeof ICON_INTENTS)[number], file: File | undefined): IconChange =>
	intent === 'replace' && file
		? { intent, file }
		: intent === 'remove'
			? { intent }
			: { intent: 'keep' }

const commonOf = (values: {
	name: string
	description: string
	tags: string[]
	enabled: boolean
}) => ({
	name: values.name,
	description: values.description,
	tags: values.tags,
	enabled: values.enabled,
})

/**
 * The create form as FormData sends it (spec §4.3; Server Actions accept FormData with files, as the branding page's
 * save does): `values` (the JSON above), `iconIntent`, and `icon` when replaced; read into the data layer's
 * CreateAppInput.
 */
export const createAppFormSchema = z
	.object({ values: jsonField(createValuesSchema), ...iconFields })
	.refine(fileGiven, fileRequired)
	.transform(({ values, iconIntent, icon }) => ({
		provider: values.provider,
		common: commonOf(values),
		access: values.access,
		settings: values.settings,
		secrets: values.secrets,
		icon: iconChange(iconIntent, icon),
	}))

/** The edit form, read the same way; the action passes everything but the provider to updateApp (spec §2.3). */
export const updateAppFormSchema = z
	.object({ values: jsonField(updateValuesSchema), ...iconFields })
	.refine(fileGiven, fileRequired)
	.transform(({ values, iconIntent, icon }) => ({
		provider: values.provider,
		common: commonOf(values),
		access: values.access,
		settings: values.settings,
		secrets: values.secrets,
		icon: iconChange(iconIntent, icon),
	}))

/**
 * The save forms' field errors: an issue inside the JSON `values` field is keyed by its own path (`name`,
 * `settings.apiBase`, `secrets.apiKey`), so the drawer can mark the field (`z.flattenError` would key them all
 * `values`), and each carries its code only, as documentFieldErrors does: a zod message can echo the input.
 */
export const formFieldErrors = (error: z.ZodError): Record<string, string[]> => {
	const errors: Record<string, string[]> = {}
	for (const issue of error.issues) {
		const path =
			issue.path[0] === 'values' && issue.path.length > 1 ? issue.path.slice(1) : issue.path
		const key = path.map(String).join('.') || 'values'
		errors[key] = [...(errors[key] ?? []), issue.code]
	}
	return errors
}

/**
 * Test connection's input (spec §4.2): the provider, its settings and its secrets as the form holds them (a blank one is
 * read from the stored app on the server), and the app's id when it exists (Part 0 spec §3.2: a UUID).
 */
export const connectionTestSchema = z.discriminatedUnion('provider', [
	z.object({
		appId: idSchema.optional(),
		provider: z.literal('dify'),
		settings: PROVIDER_SCHEMAS.dify.settingsSchema,
		secrets: PROVIDER_SCHEMAS.dify.secretsUpdateSchema,
	}),
])
```

Replace the whole of `app/(admin)/app-management/actions.ts` with:

```ts
'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createApp, deleteApp, getStoredSecrets, updateApp } from '@/lib/data/apps'
import { isForeignKeyViolation } from '@/lib/data/db-errors'
import { isId } from '@/lib/ids'
import { PROVIDERS } from '@/lib/providers/registry'
import { documentFieldErrors, mergeSecrets } from '@/lib/providers/schemas'

import {
	connectionTestSchema,
	createAppFormSchema,
	formFieldErrors,
	updateAppFormSchema,
} from './schemas'

/*
 * Thin Server Actions (charter §4.2; Part 1 spec §4.3): verify the admin, validate, call the DAL, refresh the route
 * (next/cache `refresh`: the page reads the database directly, so the current route's RSC payload is refetched in the
 * same round trip), answer a plain ActionResult. Every expected failure is a result, never a throw. The save actions
 * take FormData, because the icon is a file (the branding page's pattern).
 */

export async function createAppAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
	try {
		const actor = await requireAdmin()
		const parsed = createAppFormSchema.safeParse(Object.fromEntries(formData))
		if (!parsed.success) return fail('invalid_input', formFieldErrors(parsed.error))
		const result = await createApp(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		// B3a deviation 3: a group or account picked in the drawer was deleted before the save; nothing was written.
		if (isForeignKeyViolation(error)) return fail('invalid_input', { access: ['unknown'] })
		return toActionFailure(error, 'createAppAction')
	}
}

export async function updateAppAction(id: string, formData: FormData): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isId(id)) return fail('not_found')
		const parsed = updateAppFormSchema.safeParse(Object.fromEntries(formData))
		if (!parsed.success) return fail('invalid_input', formFieldErrors(parsed.error))
		// Spec §2.3: the provider is the stored one; updateApp takes none.
		const { common, access, settings, secrets, icon } = parsed.data
		const result = await updateApp(actor, id, { common, access, settings, secrets, icon })
		if (result.ok) refresh()
		return result
	} catch (error) {
		// B3a deviation 3: a group or account picked in the drawer was deleted before the save; nothing was written.
		if (isForeignKeyViolation(error)) return fail('invalid_input', { access: ['unknown'] })
		return toActionFailure(error, 'updateAppAction')
	}
}

export async function deleteAppAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isId(id) || !(await deleteApp(actor, id))) return fail('not_found')
		refresh()
		return ok(undefined)
	} catch (error) {
		return toActionFailure(error, 'deleteAppAction')
	}
}

/** What a test that reached the provider found (spec §4.2): reachable, or reachable while the provider reports another type. */
export type ConnectionTestOutcome =
	| { outcome: 'reachable' }
	| { outcome: 'type_mismatch'; reported: string }

/** Decision 21: the test's failures have codes of their own. */
const TEST_FAILURES = {
	key_refused: 'provider_key_refused',
	unreachable: 'provider_unreachable',
	upstream_error: 'provider_error',
} as const

/**
 * Test connection (spec §4.2; decision 18): verifies the admin (ADR-0024), reads the stored secret on the server when the
 * app exists and a field is blank, and asks the provider through the registry. It saves nothing and copies nothing.
 */
export async function testAppConnectionAction(
	input: unknown,
): Promise<ActionResult<ConnectionTestOutcome>> {
	try {
		const actor = await requireAdmin()
		const parsed = connectionTestSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const { appId, provider, settings, secrets } = parsed.data
		const definition = PROVIDERS[provider]
		// Spec §4.2 step 2: the stored secrets are read only for a saved app with a secret field left blank.
		const blank = Object.keys(definition.defaultSecrets).some(
			key => (secrets as Record<string, string | undefined>)[key] === undefined,
		)
		let stored: unknown = {}
		if (appId && blank) {
			const found = await getStoredSecrets(actor, appId, provider)
			if (!found) return fail('not_found')
			stored = found.secrets
		}
		const merged = definition.secretsSchema.safeParse(mergeSecrets(stored, secrets))
		if (!merged.success) return fail('invalid_input', documentFieldErrors('secrets', merged.error))
		const result = await definition.testConnection(settings, merged.data)
		if (!result.ok) return fail(TEST_FAILURES[result.code])
		return ok(
			result.warning
				? { outcome: 'type_mismatch', reported: result.warning.reported }
				: { outcome: 'reachable' },
		)
	} catch (error) {
		return toActionFailure(error, 'testAppConnectionAction')
	}
}
```

(A `'use server'` file may export only async functions at run time; the type export is erased. Next "use server" directive.)

- [ ] **Step 14: The admin client, as far as the new values and DTO require**

Replace the whole of `components/admin/apps/app-form-values.ts` with:

```ts
import type { AppAccessSettings } from '@/lib/app-access'
import type { AdminAppDto } from '@/lib/data/apps'
import type { ProviderId } from '@/lib/providers/ids'
import { PROVIDER_SCHEMAS } from '@/lib/providers/schemas'

/**
 * The drawer's values (spec §4.1): the shared fields and, once a provider is picked, its settings and secrets. They
 * travel to the action as one JSON field (toAppFormData) and the server parses all of them again.
 */
export interface AppFormValues {
	provider?: ProviderId
	name: string
	description: string
	tags: string[]
	enabled: boolean
	access: AppAccessSettings
	settings?: Record<string, unknown>
	secrets?: Record<string, string>
}

/** The icon field's pending change; `url` is a new file's object URL for the preview (File API, URL.createObjectURL). */
export type IconDraft =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File; url: string }

/** Layout B (decision 29): a new app starts with no provider; its sections appear once one is picked. */
export const DEFAULT_APP_FORM_VALUES: AppFormValues = {
	name: '',
	description: '',
	tags: [],
	enabled: true,
	// B3 spec §2 #9: a new app is closed, restricted with no grant, until the admin opens it.
	access: { mode: 'restricted', groupIds: [], userIds: [] },
}

/** A provider's documents as the form starts them: when it is picked, and to repair an invalid row (MDN structuredClone). */
export const providerDefaults = (
	provider: ProviderId,
): Required<Pick<AppFormValues, 'settings' | 'secrets'>> => ({
	settings: structuredClone(PROVIDER_SCHEMAS[provider].defaultSettings),
	secrets: { ...PROVIDER_SCHEMAS[provider].defaultSecrets },
})

/**
 * A saved app as the form's values. The stored secrets never come back to the browser, so their fields start blank (a
 * blank keeps them, spec §2.3); an invalid row opens on its provider's defaults so the admin can repair it.
 */
export const toAppFormValues = (app: AdminAppDto): AppFormValues => ({
	provider: app.provider,
	name: app.name,
	description: app.description,
	tags: app.tags,
	enabled: app.enabled,
	access: app.access,
	...providerDefaults(app.provider),
	...(app.invalid ? {} : { settings: app.settings }),
})

/** The action's FormData (spec §4.3): the values as JSON, the icon intent and, for a replacement, the file. */
export const toAppFormData = (values: AppFormValues, icon: IconDraft): FormData => {
	const data = new FormData()
	data.set('values', JSON.stringify(values))
	data.set('iconIntent', icon.intent)
	if (icon.intent === 'replace') data.set('icon', icon.file)
	return data
}
```

In `components/admin/apps/app-form-drawer.tsx`:

- replace `import { type AppFormValues, DEFAULT_APP_FORM_VALUES, toAppFormValues } from './app-form-values'` with `import { type AppFormValues, DEFAULT_APP_FORM_VALUES, providerDefaults, toAppFormData, toAppFormValues } from './app-form-values'`;
- replace `initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}` with `initialValues={record ? toAppFormValues(record) : { ...DEFAULT_APP_FORM_VALUES, provider: 'dify', ...providerDefaults('dify') }}` (Task 12 replaces this with the provider choice);
- replace the `save` body's first lines

```tsx
const result = record ? await updateAppAction(record.id, values) : await createAppAction(values)
```

with

```tsx
// The whole store (antd Form: "use `getFieldsValue(true)` to get all values"): onFinish's values hold only the
// mounted fields, so a field shown behind a switch (the form reply's text) would be missing from them, and the
// server parses whole documents (spec §4.3).
const data = toAppFormData(form.getFieldsValue(true), { intent: 'keep' })
const result = record ? await updateAppAction(record.id, data) : await createAppAction(data)
```

- delete the line `if (result.data.partial) message.warning(t('admin_apps.icon_not_stored'))`.

In `components/admin/apps/app-settings-fields.tsx`:

- replace `import { validateApiBase } from './api-base-rule'` with `import { validateApiBase } from '@/components/provider-ui/dify/api-base-rule'`;
- replace `name="apiBase"` with `name={['settings', 'apiBase']}`, `name="apiKey"` with `name={['secrets', 'apiKey']}`, and `name="mode"` with `name={['settings', 'appType']}`.

In `components/provider-ui/dify/api-base-rule.ts` (moved in Step 11), replace lines 1–13 (the import, the comment and the function) with:

```ts
import { apiBaseSchema } from '@/lib/providers/dify/schema'

/**
 * The API base field's antd Rule `validator` (Form §Rule: "Customize validation rule. Accept Promise as return"):
 * Dify's own settings schema (lib/providers/dify/schema.ts), so the browser and the server agree on every value. A
 * Docker service name such as http://api:5001/v1 passes (antd's `type: 'url'` would refuse it); a scheme-less, ftp://
 * or protocol-relative base does not. An empty value resolves: the field's `required` rule words that case.
 */
export const validateApiBase =
	(message: string) =>
	(_rule: unknown, value: unknown): Promise<void> =>
		!value || apiBaseSchema.safeParse(value).success
			? Promise.resolve()
			: Promise.reject(new Error(message))
```

In `components/admin/apps/app-actions.tsx`, the sync goes:

- replace `import { deleteAppAction, syncAppAction } from '@/app/(admin)/app-management/actions'` with `import { deleteAppAction } from '@/app/(admin)/app-management/actions'`;
- delete the `sync` function (`const sync = () =>` through its closing `})` and the blank line after it);
- delete the menu entry `{ key: 'sync', label: t('admin_apps.sync_info') },` and the line `if (key === 'sync') sync()`.

Replace the whole of `components/admin/apps/app-errors.ts` with:

```ts
import type { ActionErrorCode } from '@/lib/action-result'

export type AppAction = 'save' | 'delete'

/** An action's failure code as the message the admin reads (charter §4.5: codes, never a route's text). */
export const appErrorKey = (code: ActionErrorCode, action: AppAction) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'not_found':
			return 'admin_apps.not_found' as const
		case 'provider_unreachable':
			return 'admin_apps.provider_unreachable' as const
		case 'invalid_input':
			return 'admin_apps.invalid_input' as const
		default:
			return action === 'delete'
				? ('common.delete_failed' as const)
				: ('admin_apps.save_failed' as const)
	}
}
```

In `components/admin/apps/app-management.tsx`, the Type column reads the type from the settings (Task 13 replaces the column):

```tsx
			filters: APP_MODE_OPTIONS.map(mode => ({ text: t(APP_MODE_NAME_KEYS[mode]), value: mode })),
			onFilter: (value, app) => app.mode === value,
			render: (_, app) => (app.mode ? t(APP_MODE_NAME_KEYS[app.mode]) : t('common.none')),
```

becomes

```tsx
			filters: APP_MODE_OPTIONS.map(mode => ({ text: t(APP_MODE_NAME_KEYS[mode]), value: mode })),
			onFilter: (value, app) => !app.invalid && app.settings.appType === value,
			render: (_, app) => (app.invalid ? t('common.none') : t(APP_MODE_NAME_KEYS[app.settings.appType])),
```

Remove the sync keys from the locales:

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const REMOVED = ['admin_apps.sync_info', 'admin_apps.sync_success', 'admin_apps.sync_failed', 'admin_apps.icon_not_stored']
for (const language of ['en', 'zh', 'ar']) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	for (const path of REMOVED) {
		const [area, key] = path.split('.')
		delete tree[area][key]
	}
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

- [ ] **Step 15: The e2e seeds and specs on the `apps` table**

Replace the seed statement and its parameters in `e2e/auth.setup.ts` (the block Task 4 wrote, from `// A database that survives between runs keeps its rows:` to the closing `)` of `db.query(`):

```ts
// A database that survives between runs keeps its rows: the status and the documents are refreshed on them,
// and the icon is cleared (decision 19: no emoji; a stub app shows Dify's fallback icon). The stub apps are
// open to everyone, as the B3a migration left existing apps (ADR-0027); specs that test access create their
// own restricted apps (e2e/fixtures/access.ts). PostgreSQL 18 "INSERT", ON CONFLICT DO UPDATE: the SET list
// reads the proposed row through the special table EXCLUDED. The documents go as JSON text cast to jsonb.
await db.query(
	"INSERT INTO apps (id, provider, name, description, is_enabled, access_mode, settings, secrets) VALUES ($1, 'dify', $2, 'Seeded for the e2e suite', $3, 'everyone', $4::jsonb, $5::jsonb) ON CONFLICT (id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, access_mode = EXCLUDED.access_mode, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets, icon_image = NULL, icon_mime = NULL",
	[
		app.id,
		app.name,
		app.enabled !== false,
		JSON.stringify({
			apiBase: `${stubApiBase}${app.prefix}`,
			appType: app.mode,
			answerForm: { enabled: false, feedbackText: '' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: app.openingStatementDisplayMode,
		}),
		JSON.stringify({ apiKey: 'app-e2e' }),
	],
)
```

In `e2e/fixtures/access.ts`, replace `seedApp` and the four helpers after it (lines 12–53) with:

```ts
/** A Dify app's documents on one of the stub's apps (its prefix), as the e2e seeds store them. */
export const stubDocuments = (prefix = '', appType = 'chat') => ({
	settings: JSON.stringify({
		apiBase: `${stubApiBase}${prefix}`,
		appType,
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	}),
	secrets: JSON.stringify({ apiKey: 'app-e2e' }),
})

/**
 * An app row of the spec's own on the stub's chat app (prefix ''), with a stored image icon; its name must carry the
 * project name, and the spec deletes it in `afterEach` (its grants go with it, ON DELETE CASCADE).
 */
export const seedApp = async ({
	name,
	accessMode,
}: {
	name: string
	accessMode: 'everyone' | 'restricted'
}): Promise<string> => {
	const id = randomUUID()
	const { settings, secrets } = stubDocuments()
	await withDb(db =>
		db.query(
			"INSERT INTO apps (id, provider, name, description, access_mode, settings, secrets, icon_image, icon_mime) VALUES ($1, 'dify', $2, 'Seeded for an access spec', $3, $4::jsonb, $5::jsonb, $6, 'image/png')",
			[id, name, accessMode, settings, secrets, PIXEL_PNG],
		),
	)
	return id
}

export const deleteApp = (id: string) =>
	withDb(db => db.query('DELETE FROM apps WHERE id = $1', [id]))

/** The ids of every app open to everyone, so a case that closes them can reopen exactly these. */
export const appsOpenToEveryone = () =>
	withDb(async db => {
		const { rows } = await db.query<{ id: string }>(
			"SELECT id FROM apps WHERE access_mode = 'everyone'",
		)
		return rows.map(row => row.id)
	})

export const setAccessMode = (ids: string[], accessMode: 'everyone' | 'restricted') =>
	withDb(async db => {
		for (const id of ids)
			await db.query('UPDATE apps SET access_mode = $1 WHERE id = $2', [accessMode, id])
	})

/** Deletes the apps whose name matches a pattern (a run killed before its clean-up), without case as MySQL compared. */
export const deleteAppsLike = (pattern: string) =>
	withDb(db => db.query('DELETE FROM apps WHERE name ILIKE $1', [pattern]))
```

In `e2e/fixtures/constants.ts`, replace `/** Seeded app id (36 chars, fits dify_apps.id) and the signed-in storage state file. */` with `/** Seeded app id (a UUID, apps.id) and the signed-in storage state file. */`.

In `e2e/fixtures/stub/apps.ts`, replace `/** Seeded into \`dify*apps.opening_statement_display_mode\`: 'always' keeps the welcome panel after the first reply. */`with`/\*\* Seeded into the app's settings (\`openingStatementDisplayMode\`): 'always' keeps the welcome panel after the first reply. _/`, `/** Seeded into dify_apps.is_enabled; true when absent. \*/`with`/** Seeded into apps.is_enabled; true when absent. _/`, and in the comment above `DISABLED*APP`replace` * spec creates it through the form, and its /info answers a name of its own and its /site an image icon.`with` \* spec creates it through the form, and its /info answers its own name and mode.`.

In `e2e/admin-apps.spec.ts`:

- replace the two helpers `seedApp` and `dropApp` (lines 18–28) with:

```ts
/** An apps id (a UUID) of the spec's own, distinct per project: the three projects run one after another. */
const ownId = (base: number, testInfo: TestInfo) =>
	`e2e00000-0000-4000-8000-${String(base + PROJECTS.indexOf(testInfo.project.name) + 1).padStart(12, '0')}`
const seedApp = (id: string, name: string, prefix = '') => {
	const { settings, secrets } = stubDocuments(prefix)
	return withDb(db =>
		db.query(
			"INSERT INTO apps (id, provider, name, description, settings, secrets) VALUES ($1, 'dify', $2, 'e2e', $3::jsonb, $4::jsonb) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, settings = EXCLUDED.settings",
			[id, name, settings, secrets],
		),
	)
}
const dropApp = (id: string) => withDb(db => db.query('DELETE FROM apps WHERE id = $1', [id]))
```

- add `stubDocuments` to the `./fixtures/access` import (the file keeps its `stubApiBase` import: the drawer case reads it);
- delete the case `test('sync info refreshes the app from Dify', …)`;
- in `test('delete asks for confirmation and removes the app', …)`, replace `await seedApp(id, \`Delete me ${testInfo.project.name}\`, stubApiBase)`with`await seedApp(id, \`Delete me ${testInfo.project.name}\`)`;
- in `test('on a phone the table scrolls inside its container and More stays reachable', …)`, replace `await expect(page.getByRole('menuitem', { name: 'Sync app info' })).toBeVisible()` with `await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()`;
- in `test.describe('create and edit', …)`, replace `await withDb(db => db.query('DELETE FROM dify_apps WHERE name = $1', [CREATED_APP.name]))` with `await withDb(db => db.query('DELETE FROM apps WHERE name = $1', [CREATED_APP.name]))`, and delete its first two cases (`'an admin creates an app from its Dify API base and key, then disables it'` and `'a Dify error body instead of app info keeps the drawer open with a translated error'`); Task 12 adds the new create and edit cases;
- in `storedAccess`, replace `'SELECT name, access_mode FROM dify_apps WHERE id = $1',` with `'SELECT name, access_mode FROM apps WHERE id = $1',`;
- in `test.describe('app access in the drawer (B3 spec §4.4)', …)`: replace the `afterEach` comment `// By id: an Update renames the app from the stub's /info ("Stub app"). Its grants go with it (ON DELETE CASCADE).` with `// By id; its grants go with it (ON DELETE CASCADE).`, the comment `// The Update renamed the app, so this drawer is found by its title's fixed part.` with `// The drawer is found by its title's fixed part.`, and `// One transaction: the Dify info the update read was not stored either, and no grant was.` with `// One transaction: no grant was stored either.`.

In `e2e/chat-files.spec.ts`, replace the `withIconApp` helper's column lists (lines 251–252):

```ts
const columns = ['id', 'name', 'mode', 'description', 'api_base', 'api_key', ...Object.keys(icon)]
const values = [app.id, app.name, 'chat', 'icon', stubApiBase, 'app-e2e', ...Object.values(icon)]
```

with:

```ts
const { settings, secrets } = stubDocuments()
const columns = [
	'id',
	'provider',
	'name',
	'description',
	'settings',
	'secrets',
	...Object.keys(icon),
]
const values = [app.id, 'dify', app.name, 'icon', settings, secrets, ...Object.values(icon)]
```

(node-postgres sends the two JSON strings as text, which PostgreSQL reads as `jsonb` for those columns), replace `INSERT INTO dify_apps (` with `INSERT INTO apps (` and `'DELETE FROM dify_apps WHERE id = $1'` with `'DELETE FROM apps WHERE id = $1'` in the same helper, add `import { stubDocuments } from './fixtures/access'` to the imports (the `stubApiBase` import stays: the image case reads the Dify origin from it), and in Task 10's case `'an app without a stored image shows its first letter, not an emoji'` replace `{ icon_type: 'emoji', icon: '🦊', icon_background: '#FFEAD5' },` with `{},` and delete the line `await expect(page.getByText('🦊')).toHaveCount(0)`; in the image case replace `{ icon_type: 'image', icon: 'stub-icon-file', icon_image: STUB_PNG, icon_mime: 'image/png' },` with `{ icon_image: STUB_PNG, icon_mime: 'image/png' },`.

- [ ] **Step 16: Run everything this task touches**

Run: `git grep -nE "\bdifyApps\b|dify_apps" -- ':!docs' ':!db/migrations' ':!media'` Expected: only `__tests__/db/apps-migration.db.test.ts`, `__tests__/db-apps-migrations.test.ts` and `__tests__/db-baseline.test.ts` (the Part 0 table the baseline creates and the migrations start from); and the query texts in `__tests__/action-failure.test.ts` and `__tests__/http-errors.test.ts` (SQL a failed query carries, which the tests prove stays out of the log; the table name in them does not matter). (`media/archived/` is upstream's archived notes.)

Run: `git grep -nE "syncApp|SyncResult|readIconBytes|iconColumnsFrom|fetchSignedFile|\bICON_MAX_BYTES\b|fetchDifyProfile|annotationEnabled" -- app components lib hooks __tests__ e2e` Expected: no output. (The word boundaries keep Task 8's `APP_ICON_MAX_BYTES` out of the match: `_` is a word character. `syncApp` also covers `syncAppAction`, gone from `actions.ts` and `app-actions.tsx`; the two context strings of `action-failure.test.ts` were renamed in Step 8.)

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm test` Expected: PASS (the run decides the count).

Run: `pnpm test:db` Expected: PASS, every file (the run decides the count; `apps.db.test.ts` and `apps-migration.db.test.ts` among them).

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx') $(git ls-files --others --exclude-standard -- '*.ts' '*.tsx') && pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR HEAD -- '*.ts' '*.tsx' '*.json' ':!db/migrations') $(git ls-files --others --exclude-standard -- '*.ts' '*.tsx' ':!db/migrations')` Expected: no findings (the generated `db/migrations/**` stay as drizzle-kit writes them; lint-staged formats the snapshots on commit, as Part 0's ruling B4 found).

Run (no other `next dev` of this checkout; `pnpm test:db` finished): `pnpm test:e2e e2e/admin-apps.spec.ts e2e/app-access.spec.ts e2e/admin-groups.spec.ts e2e/directory-groups.spec.ts e2e/apps.spec.ts e2e/chat.spec.ts e2e/chat-files.spec.ts e2e/malformed-ids.spec.ts` (every spec that seeds apps through `e2e/fixtures/access.ts`; `pnpm test:e2e` starts the `ldap-ad` test directory the directory spec needs) Expected: PASS on the three projects. (global-setup migrates the e2e database through the three new migrations, keeping any rows a running e2e PostgreSQL still holds.)

- [ ] **Step 17: Commit**

```bash
git add db lib app components locales e2e __tests__
git status --short
git commit -m "feat(apps): move apps to the provider documents and take the icon from the admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 12: The drawer, layout B: the provider first, the shared fields, the provider's sections and Test connection

**Goal:** Rebuild the admin app drawer so the provider is picked first, followed by the shared fields (name, description, tags, icon, access) and the provider's own sections with a Test connection button.

Spec §4.1 and §4.2, decision 29 and the owner's picks E1–E8 (`ui-picks-part1.md`). Today's Drawer stays (E2). "Add app" opens it with the provider `Select` as its only row (E1); once a provider is picked, the shared sections and the provider's sections appear, and switching the provider before saving resets its fields to the new provider's defaults. "Edit app" opens the same drawer with the Select disabled (E8). The form is `layout="horizontal"` with responsive `labelCol`/`wrapperCol` spans (labels above the fields on a phone), and a `requiredMark` render that draws an asterisk on required fields and "(optional)" on the others (E3). Name, description (E6), tags (E5) and the icon (E4) are fields now; the Descriptions block goes (spec §6). The Dify section is Connection (API base, API key, App type, Test connection: E7), Conversation and More. The admin-form half of the client registry, `provider-form-section.tsx`, picks the provider's sections.

The icon's Remove is a default Button with `DeleteOutlined`, as on the branding page: the owner's answer of 2026-10-12 (Plan decision ag).

**Files:**

- Create: `components/admin/apps/{required-mark.tsx,icon-field.tsx,connection-test.tsx,connection-outcome.ts}`, `components/provider-ui/provider-form-section.tsx`, `components/provider-ui/dify/form-section.tsx`, `__tests__/connection-outcome.test.ts`
- Rename: `components/admin/apps/app-settings-fields.tsx` → `components/admin/apps/app-common-fields.tsx` (whole file rewritten)
- Modify: `components/admin/apps/app-form-drawer.tsx` (whole file), `components/admin/apps/app-management.tsx` (the drawer's `tagOptions`), `components/provider-ui/registry.tsx` (`typeName`), `locales/{en,zh,ar}/translation.json`, `e2e/fixtures/stub/router.ts`, `e2e/admin-apps.spec.ts`
- Test: `__tests__/provider-ui.test.ts`, `__tests__/stub-router.test.ts`, `__tests__/i18n-locales.test.ts` (unchanged; it checks the new keys)

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/connection-outcome.test.ts __tests__/provider-ui.test.ts __tests__/stub-router.test.ts __tests__/i18n-locales.test.ts` passes, including the `connectionOutcome` cases, the `typeName` case ('names a type, or gives a type it does not know back as written') and the stub cases "answers Dify's 401 for the refused key, on any path" and 'drops the connection for a path under /v1/unreachable'.
- [ ] `git grep -nE "api_secret|section_request|app-settings-fields|AppSettingsFields" -- app components lib locales __tests__ e2e` returns no output.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` prints no tsc output and passes.
- [ ] oxlint and `oxfmt --check` on `components/admin/apps`, `components/provider-ui`, `e2e/fixtures/stub/router.ts`, the three test files and `locales` report no findings; `pnpm exec antd lint components/admin/apps components/provider-ui --format json` names no deprecated prop; `pnpm i18n:lint` reports no hardcoded text in those two folders.
- [ ] `pnpm test:e2e e2e/admin-apps.spec.ts e2e/apps.spec.ts e2e/app-access.spec.ts` passes on desktop-light, desktop-dark and mobile-light, including 'each opening of the drawer starts from its own app, and New starts with the provider alone', 'an admin adds a Dify app: the provider, its fields, a passing test, and the save', 'Test connection warns of another type, and reports a refused key and an unreachable base' and 'an edit keeps the provider and a blank key, and replaces then removes the icon'.
- [ ] The new files exist: `components/admin/apps/{required-mark.tsx,icon-field.tsx,connection-test.tsx,connection-outcome.ts}`, `components/provider-ui/provider-form-section.tsx`, `components/provider-ui/dify/form-section.tsx`, and `app-settings-fields.tsx` is renamed to `app-common-fields.tsx`.

**Verify:** `pnpm exec vitest run --project unit __tests__/connection-outcome.test.ts __tests__/provider-ui.test.ts __tests__/stub-router.test.ts __tests__/i18n-locales.test.ts && pnpm test:e2e e2e/admin-apps.spec.ts e2e/apps.spec.ts e2e/app-access.spec.ts` → unit tests PASS; e2e PASS on the three projects

**Interfaces:**

- Consumes: Task 10's `PROVIDER_UI`, `providerIcon`, `APP_MODE_OPTIONS`, `APP_MODE_OPTION_KEYS`, `APP_MODE_NAME_KEYS`; Task 11's `AppFormValues`, `IconDraft`, `DEFAULT_APP_FORM_VALUES`, `providerDefaults`, `toAppFormValues`, `toAppFormData`, `createAppAction`, `updateAppAction`, `testAppConnectionAction`, `ConnectionTestOutcome`, `appErrorKey`, `validateApiBase`, `appTagsSchema`, `APP_NAME_MAX`, `APP_DESCRIPTION_MAX`; Task 8's `IMAGE_MIME_TYPES`, `APP_ICON_MAX_BYTES`; Task 10's `appIconUrl`.
- Produces:
  - `components/provider-ui/registry.tsx`: `typeName(t: TFunction, provider: ProviderId, type: string): string` (the type's name, or the raw value for one the client does not know).
  - `components/admin/apps/connection-outcome.ts`: `type ConnectionOutcome = { type: 'success' | 'warning' | 'error'; title: string; description: string }`, `connectionOutcome(t, provider, result: ActionResult<ConnectionTestOutcome>, chosenType?: string): ConnectionOutcome`.
  - `components/admin/apps/connection-test.tsx`: default `ConnectionTest({ appId?, provider, fields: NonNullable<FormItemProps['name']>[], chosenType? })`.
  - `components/admin/apps/icon-field.tsx`: default `IconField({ provider, savedSrc, draft, onChange, error })`.
  - `components/admin/apps/required-mark.tsx`: `useRequiredMark(): (label: ReactNode, info: { required: boolean }) => ReactNode`.
  - `components/admin/apps/app-common-fields.tsx`: default `AppCommonFields({ record?, groups, users, tagOptions, icon, onIconChange, iconError })`.
  - `components/provider-ui/provider-form-section.tsx`: default `ProviderFormSection({ provider, appId?, editing })`.
  - `components/provider-ui/dify/form-section.tsx`: default `DifyFormSection({ appId?, editing })`.
  - `AppFormDrawer` gains the prop `tagOptions: string[]`.
  - The e2e stub answers Dify's 401 for the key `app-refused` and drops the connection for paths under `/v1/unreachable`.

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/connection-outcome.test.ts`:

```ts
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { connectionOutcome } from '@/components/admin/apps/connection-outcome'

const t = ((key: string, options?: Record<string, unknown>) =>
	options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction

// Spec §4.2 (E7): success, warning or error, each with a title and a description.
describe('connectionOutcome', () => {
	it('is a success when the provider was reached', () => {
		expect(
			connectionOutcome(t, 'dify', { ok: true, data: { outcome: 'reachable' } }, 'chat'),
		).toEqual({
			type: 'success',
			title: 'connection_test.reachable_title',
			description: 'connection_test.reachable_description',
		})
	})
	it('is a warning naming both types when the provider reports another one', () => {
		expect(
			connectionOutcome(
				t,
				'dify',
				{ ok: true, data: { outcome: 'type_mismatch', reported: 'workflow' } },
				'chat',
			),
		).toEqual({
			type: 'warning',
			title: 'connection_test.type_mismatch_title',
			description: `connection_test.type_mismatch_description:${JSON.stringify({
				reported: 'app_mode.name.workflow',
				chosen: 'app_mode.name.chatbot',
			})}`,
		})
	})
	it('names a type the client does not know as the provider wrote it', () => {
		const outcome = connectionOutcome(
			t,
			'dify',
			{ ok: true, data: { outcome: 'type_mismatch', reported: 'rag-pipeline' } },
			'chat',
		)
		expect(outcome.description).toContain('"reported":"rag-pipeline"')
	})
	it.each([
		['provider_key_refused', 'key_refused'],
		['provider_unreachable', 'unreachable'],
		['provider_error', 'upstream_error'],
	] as const)('is an error with its own words for %s', (code, words) => {
		expect(connectionOutcome(t, 'dify', { ok: false, code })).toEqual({
			type: 'error',
			title: `connection_test.${words}_title`,
			description: `connection_test.${words}_description`,
		})
	})
	it('is an error with the action’s own message for any other failure', () => {
		expect(connectionOutcome(t, 'dify', { ok: false, code: 'invalid_input' })).toEqual({
			type: 'error',
			title: 'connection_test.failed_title',
			description: 'admin_apps.invalid_input',
		})
	})
})
```

In `__tests__/provider-ui.test.ts`, add `typeName` to the registry import and append inside `describe('the client registry (spec §3)', …)`:

```ts
it('names a type, or gives a type it does not know back as written', () => {
	expect(typeName(t, 'dify', 'advanced-chat')).toBe('app_mode.name.chatflow')
	expect(typeName(t, 'dify', 'rag-pipeline')).toBe('rag-pipeline')
})
```

In `__tests__/stub-router.test.ts`, add after the last case of the file's main `describe` (before its closing `})`; the file's own `base` and `fetch` helpers are in scope there):

```ts
// Part 1 spec §9: Test connection's refused and unreachable scenarios.
it("answers Dify's 401 for the refused key, on any path", async () => {
	const refused = await fetch(`${base}/v1/info`, {
		headers: { authorization: 'Bearer app-refused' },
	})
	expect(refused.status).toBe(401)
	expect(await refused.json()).toEqual({
		code: 'unauthorized',
		message: 'Access token is invalid',
		status: 401,
	})
})
it('drops the connection for a path under /v1/unreachable', async () => {
	await expect(fetch(`${base}/v1/unreachable/info`)).rejects.toThrow()
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/connection-outcome.test.ts __tests__/provider-ui.test.ts __tests__/stub-router.test.ts` Expected: FAIL: `connection-outcome` cannot be resolved; `typeName` is not exported; the stub answers 200 to the refused key and its `/v1/unreachable/info` answers too.

- [ ] **Step 3: The stub's two scenarios**

In `e2e/fixtures/stub/router.ts`, add after the `OPTIONS` block (the `if (method === 'OPTIONS') { … }` in `handle`):

```ts
// Test connection (Part 1 spec §9): a key Dify does not know is its 401 envelope (endpoint map, Conventions:
// "401 unauthorized (missing/invalid bearer token)"), whatever the path.
if (req.headers.authorization === 'Bearer app-refused')
	return difyError(res, 401, 'unauthorized', 'Access token is invalid')
// A host that is not there: the stub ends the socket without an answer, so the hub's fetch fails as it would.
if (url.pathname === '/v1/unreachable' || url.pathname.startsWith('/v1/unreachable/')) {
	req.socket.destroy()
	return
}
```

- [ ] **Step 4: The registry's type names and the outcome**

In `components/provider-ui/registry.tsx`, add after `providerLine`:

```tsx
/** A type's name for the provider (E7's warning): the translation, or the provider's raw value for a type the client does not know. */
export const typeName = (t: TFunction, provider: ProviderId, type: string): string => {
	const keys = PROVIDER_UI[provider].typeLabelKeys
	return Object.hasOwn(keys, type) ? t(keys[type as keyof typeof keys]) : type
}
```

and simplify `providerLine` to use it:

```tsx
export const providerLine = (t: TFunction, provider: ProviderId, appType?: string): string => {
	const ui = PROVIDER_UI[provider]
	return appType !== undefined && Object.hasOwn(ui.typeLabelKeys, appType)
		? `${t(ui.labelKey)} · ${typeName(t, provider, appType)}`
		: t(ui.labelKey)
}
```

Create `components/admin/apps/connection-outcome.ts`:

```ts
import type { TFunction } from 'i18next'

import type { ConnectionTestOutcome } from '@/app/(admin)/app-management/actions'
import { typeName } from '@/components/provider-ui/registry'
import type { ActionResult } from '@/lib/action-result'
import type { ProviderId } from '@/lib/providers/ids'

import { appErrorKey } from './app-errors'

/** What the Alert under Test connection shows (E7): its type, its title and its description. */
export interface ConnectionOutcome {
	type: 'success' | 'warning' | 'error'
	title: string
	description: string
}

/**
 * The test's result in words (spec §4.2): reachable is success, another type a warning that does not block the save,
 * and each failure an error with words of its own (decision 21); any other failure says why the test did not run.
 */
export const connectionOutcome = (
	t: TFunction,
	provider: ProviderId,
	result: ActionResult<ConnectionTestOutcome>,
	chosenType?: string,
): ConnectionOutcome => {
	if (result.ok) {
		if (result.data.outcome === 'reachable')
			return {
				type: 'success',
				title: t('connection_test.reachable_title'),
				description: t('connection_test.reachable_description'),
			}
		return {
			type: 'warning',
			title: t('connection_test.type_mismatch_title'),
			description: t('connection_test.type_mismatch_description', {
				reported: typeName(t, provider, result.data.reported),
				chosen: chosenType ? typeName(t, provider, chosenType) : '',
			}),
		}
	}
	switch (result.code) {
		case 'provider_key_refused':
			return {
				type: 'error',
				title: t('connection_test.key_refused_title'),
				description: t('connection_test.key_refused_description'),
			}
		case 'provider_unreachable':
			return {
				type: 'error',
				title: t('connection_test.unreachable_title'),
				description: t('connection_test.unreachable_description'),
			}
		case 'provider_error':
			return {
				type: 'error',
				title: t('connection_test.upstream_error_title'),
				description: t('connection_test.upstream_error_description'),
			}
		default:
			return {
				type: 'error',
				title: t('connection_test.failed_title'),
				description: t(appErrorKey(result.code, 'save')),
			}
	}
}
```

- [ ] **Step 5: The words**

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const EDITS = {
	en: {
		'form.optional': '(optional)',
		'app_setting.provider': 'Provider',
		'app_setting.provider_placeholder': 'Choose a provider',
		'app_setting.provider_required': 'Choose a provider',
		'app_setting.provider_tooltip': 'Where the app runs. It cannot be changed once the app is saved.',
		'app_setting.name_required': 'Enter the app name',
		'app_setting.name_tooltip': 'Shown on the app’s card and in its chat',
		'app_setting.description_tooltip': 'Shown on the app’s card',
		'app_setting.tags_placeholder': 'Type a tag, then Enter or a comma',
		'app_setting.tags_help': 'Up to 10 tags of up to 32 characters',
		'app_setting.icon': 'App icon',
		'app_setting.icon_help': 'PNG, JPEG or WebP, up to 512 KB. Saved as a PNG of at most 256 × 256 pixels.',
		'app_setting.icon_choose': 'Choose image',
		'app_setting.icon_remove': 'Remove',
		'app_setting.icon_too_large': 'The image is larger than 512 KB.',
		'app_setting.icon_not_allowed': 'Use a PNG, JPEG or WebP image that opens correctly.',
		'app_setting.section_request': null,
		'app_setting.section_connection': 'Connection',
		'app_setting.api_base': 'API base',
		'app_setting.api_base_required': 'Enter the API base',
		'app_setting.api_base_placeholder': 'Enter the API base',
		'app_setting.api_secret_tooltip': null,
		'app_setting.api_secret_required': null,
		'app_setting.api_secret_placeholder': null,
		'app_setting.api_secret_keep': null,
		'app_setting.api_key': 'API key',
		'app_setting.api_key_tooltip': 'The Dify app’s API key (starts with app-)',
		'app_setting.api_key_required': 'Enter the API key',
		'app_setting.api_key_placeholder': 'Enter the API key',
		'app_setting.secret_keep_placeholder': 'Leave blank to keep',
		'app_setting.type_tooltip': 'The app’s type in Dify. Test connection compares it with the type Dify reports.',
		'app_setting.test_connection': 'Test connection',
		'admin_apps.field_invalid': 'Check this value',
		'connection_test.reachable_title': 'Connected',
		'connection_test.reachable_description': 'The provider answered with these settings.',
		'connection_test.type_mismatch_title': 'Connected, but the type differs',
		'connection_test.type_mismatch_description': 'The provider reports this app as {{reported}}, not {{chosen}}. Check the app type before you save.',
		'connection_test.key_refused_title': 'The key was refused',
		'connection_test.key_refused_description': 'The provider did not accept this key. Check it and test again.',
		'connection_test.unreachable_title': 'The provider could not be reached',
		'connection_test.unreachable_description': 'Check the API base, and that the provider is running and reachable from the hub.',
		'connection_test.upstream_error_title': 'The provider answered with an error',
		'connection_test.upstream_error_description': 'Check the API base: it should be the provider’s API address.',
		'connection_test.failed_title': 'The test did not run',
	},
	zh: {
		'form.optional': '（可选）',
		'app_setting.provider': '提供方',
		'app_setting.provider_placeholder': '请选择提供方',
		'app_setting.provider_required': '请选择提供方',
		'app_setting.provider_tooltip': '应用运行的平台。应用保存后无法更改。',
		'app_setting.name_required': '请输入应用名称',
		'app_setting.name_tooltip': '显示在应用卡片和对话中',
		'app_setting.description_tooltip': '显示在应用卡片上',
		'app_setting.tags_placeholder': '输入标签后按回车或逗号',
		'app_setting.tags_help': '最多 10 个标签，每个不超过 32 个字符',
		'app_setting.icon': '应用图标',
		'app_setting.icon_help': 'PNG、JPEG 或 WebP，最大 512 KB。保存为不超过 256 × 256 像素的 PNG。',
		'app_setting.icon_choose': '选择图片',
		'app_setting.icon_remove': '移除',
		'app_setting.icon_too_large': '图片超过 512 KB。',
		'app_setting.icon_not_allowed': '请使用能正常打开的 PNG、JPEG 或 WebP 图片。',
		'app_setting.section_request': null,
		'app_setting.section_connection': '连接',
		'app_setting.api_base': 'API 地址',
		'app_setting.api_base_required': '请输入 API 地址',
		'app_setting.api_base_placeholder': '请输入 API 地址',
		'app_setting.api_secret_tooltip': null,
		'app_setting.api_secret_required': null,
		'app_setting.api_secret_placeholder': null,
		'app_setting.api_secret_keep': null,
		'app_setting.api_key': 'API 密钥',
		'app_setting.api_key_tooltip': 'Dify 应用的 API 密钥（以 app- 开头）',
		'app_setting.api_key_required': '请输入 API 密钥',
		'app_setting.api_key_placeholder': '请输入 API 密钥',
		'app_setting.secret_keep_placeholder': '留空则保留原值',
		'app_setting.type_tooltip': '应用在 Dify 中的类型。测试连接会将其与 Dify 报告的类型比较。',
		'app_setting.test_connection': '测试连接',
		'admin_apps.field_invalid': '请检查此值',
		'connection_test.reachable_title': '连接成功',
		'connection_test.reachable_description': '提供方已按这些设置作出响应。',
		'connection_test.type_mismatch_title': '已连接，但类型不同',
		'connection_test.type_mismatch_description': '提供方报告此应用为 {{reported}}，而不是 {{chosen}}。保存前请检查应用类型。',
		'connection_test.key_refused_title': '密钥被拒绝',
		'connection_test.key_refused_description': '提供方不接受此密钥。请检查后重新测试。',
		'connection_test.unreachable_title': '无法连接到提供方',
		'connection_test.unreachable_description': '请检查 API 地址，并确认提供方正在运行且应用中心可以访问。',
		'connection_test.upstream_error_title': '提供方返回了错误',
		'connection_test.upstream_error_description': '请检查 API 地址：它应为提供方的 API 地址。',
		'connection_test.failed_title': '测试未运行',
	},
	ar: {
		'form.optional': '(اختياري)',
		'app_setting.provider': 'المزوّد',
		'app_setting.provider_placeholder': 'اختر المزوّد',
		'app_setting.provider_required': 'اختر المزوّد',
		'app_setting.provider_tooltip': 'المنصة التي يعمل عليها التطبيق. لا يمكن تغييرها بعد حفظ التطبيق.',
		'app_setting.name_required': 'أدخل اسم التطبيق',
		'app_setting.name_tooltip': 'يظهر على بطاقة التطبيق وفي محادثته',
		'app_setting.description_tooltip': 'يظهر على بطاقة التطبيق',
		'app_setting.tags_placeholder': 'اكتب وسمًا ثم اضغط Enter أو فاصلة',
		'app_setting.tags_help': 'حتى 10 وسوم، لا يتجاوز كلٌّ منها 32 حرفًا',
		'app_setting.icon': 'أيقونة التطبيق',
		'app_setting.icon_help': 'PNG أو JPEG أو WebP، بحد أقصى 512 KB. يُحفظ بصيغة PNG لا تتجاوز 256 × 256 بكسل.',
		'app_setting.icon_choose': 'اختيار صورة',
		'app_setting.icon_remove': 'إزالة',
		'app_setting.icon_too_large': 'حجم الصورة أكبر من 512 KB.',
		'app_setting.icon_not_allowed': 'استخدم صورة PNG أو JPEG أو WebP تُفتح بشكل سليم.',
		'app_setting.section_request': null,
		'app_setting.section_connection': 'الاتصال',
		'app_setting.api_base': 'عنوان API',
		'app_setting.api_base_required': 'أدخل عنوان API',
		'app_setting.api_base_placeholder': 'أدخل عنوان API',
		'app_setting.api_secret_tooltip': null,
		'app_setting.api_secret_required': null,
		'app_setting.api_secret_placeholder': null,
		'app_setting.api_secret_keep': null,
		'app_setting.api_key': 'مفتاح API',
		'app_setting.api_key_tooltip': 'مفتاح API لتطبيق Dify (يبدأ بـ app-)',
		'app_setting.api_key_required': 'أدخل مفتاح API',
		'app_setting.api_key_placeholder': 'أدخل مفتاح API',
		'app_setting.secret_keep_placeholder': 'اتركه فارغًا للإبقاء على القيمة الحالية',
		'app_setting.type_tooltip': 'نوع التطبيق في Dify. يقارن اختبار الاتصال بينه وبين النوع الذي يُبلغ عنه Dify.',
		'app_setting.test_connection': 'اختبار الاتصال',
		'admin_apps.field_invalid': 'تحقّق من هذه القيمة',
		'connection_test.reachable_title': 'تم الاتصال',
		'connection_test.reachable_description': 'استجاب المزوّد بهذه الإعدادات.',
		'connection_test.type_mismatch_title': 'تم الاتصال، لكن النوع مختلف',
		'connection_test.type_mismatch_description': 'يُبلغ المزوّد أن هذا التطبيق من نوع {{reported}} وليس {{chosen}}. تحقّق من نوع التطبيق قبل الحفظ.',
		'connection_test.key_refused_title': 'رُفض المفتاح',
		'connection_test.key_refused_description': 'لم يقبل المزوّد هذا المفتاح. تحقّق منه ثم أعد الاختبار.',
		'connection_test.unreachable_title': 'تعذّر الوصول إلى المزوّد',
		'connection_test.unreachable_description': 'تحقّق من عنوان API، ومن أن المزوّد يعمل ويمكن للمنصة الوصول إليه.',
		'connection_test.upstream_error_title': 'أجاب المزوّد بخطأ',
		'connection_test.upstream_error_description': 'تحقّق من عنوان API: يجب أن يكون عنوان واجهة API لدى المزوّد.',
		'connection_test.failed_title': 'لم يُنفَّذ الاختبار',
	},
}
// A dotted path is set, or deleted when its value is null; JSON.stringify with a tab keeps the files' own format.
for (const [language, edits] of Object.entries(EDITS)) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	for (const [path, value] of Object.entries(edits)) {
		const keys = path.split('.')
		const last = keys.pop()
		const node = keys.reduce((parent, key) => (parent[key] ??= {}), tree)
		if (value === null) delete node[last]
		else node[last] = value
	}
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

(The keys `app_setting.name`, `description`, `description_placeholder`, `name_placeholder`, `tags`, `type`, `type_required`, `type_placeholder`, `status`, the access keys and the Conversation and More keys stay; their texts already fit. Spec §7 puts the zh and ar wording on the owner's review list.)

- [ ] **Step 6: The shared pieces of the form**

Create `components/admin/apps/required-mark.tsx`:

```tsx
'use client'

import { theme } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * E3 (owner's pick): an asterisk on required fields and "(optional)" on the others. antd's built-in `requiredMark`
 * values give one or the other; its documented customize form, a render function `(label, { required })` (Form API,
 * `requiredMark`, since 5.9.0; demo "required-mark"), draws both, and antd then hides its own asterisk
 * (FormItemLabel: a function's mark type is `optional`, whose style drops the `::before` mark). The asterisk takes the
 * error colour token, as antd's own does, and is hidden from assistive technology like antd's CSS mark; "(optional)"
 * is read out.
 */
export const useRequiredMark = () => {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	return (label: ReactNode, { required }: { required: boolean }): ReactNode =>
		required ? (
			<>
				<span
					aria-hidden="true"
					style={{ color: token.colorError, marginInlineEnd: token.marginXXS }}
				>
					*
				</span>
				{label}
			</>
		) : (
			<>
				{label}
				<span style={{ color: token.colorTextDescription, marginInlineStart: token.marginXXS }}>
					{t('form.optional')}
				</span>
			</>
		)
}
```

Create `components/admin/apps/icon-field.tsx`:

```tsx
'use client'

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { App, Avatar, Button, Flex, Form, Upload } from 'antd'
import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'

import { providerIcon } from '@/components/provider-ui/registry'
import { APP_ICON_MAX_BYTES, IMAGE_MIME_TYPES } from '@/lib/settings/image-rules'

import type { IconDraft } from './app-form-values'

/**
 * E4 (owner's pick): the branding page's image field, an Upload with a Button and no list, with a square Avatar preview
 * at the gallery card's size and a separate Remove button, a default one as on the branding page (owner, 2026-10-12).
 * The picker's check is a convenience; the server decodes and decides (OWASP File Upload Cheat Sheet; Task 8's
 * pipeline). Without an image the preview is the provider's fallback icon, as the card will show it (E11).
 */
export default function IconField({
	provider,
	savedSrc,
	draft,
	onChange,
	error,
}: {
	provider: string
	/** The stored image's URL, or null when the app has none. */
	savedSrc: string | null
	draft: IconDraft
	onChange: (draft: IconDraft) => void
	error?: string
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	// react.dev `useId`: "generating unique IDs that can be passed to accessibility attributes".
	const labelId = useId()
	// MDN URL.revokeObjectURL: a replaced draft's object URL is let go when it changes or the field unmounts.
	useEffect(
		() => () => {
			if (draft.intent === 'replace') URL.revokeObjectURL(draft.url)
		},
		[draft],
	)
	const src = draft.intent === 'replace' ? draft.url : draft.intent === 'keep' ? savedSrc : null
	const Fallback = providerIcon(provider)
	const label = t('app_setting.icon')
	return (
		<Form.Item
			// The label names the group, not one control (the branding page's field; WCAG 2.2 SC 2.5.3).
			label={<span id={labelId}>{label}</span>}
			extra={t('app_setting.icon_help')}
			validateStatus={error ? 'error' : undefined}
			help={error}
		>
			<Flex
				role="group"
				aria-labelledby={labelId}
				wrap
				align="center"
				gap="small"
			>
				{src ? (
					<Avatar
						shape="square"
						size="large"
						src={src}
						alt={label}
					/>
				) : (
					<Avatar
						shape="square"
						size="large"
						icon={<Fallback />}
					/>
				)}
				<Upload
					accept={IMAGE_MIME_TYPES.join(',')}
					showUploadList={false}
					// antd demos "Upload manually" and "Upload png file only": keep the file in the browser (return false) or
					// drop it (Upload.LIST_IGNORE).
					beforeUpload={file => {
						if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
							message.error(t('app_setting.icon_not_allowed'))
							return Upload.LIST_IGNORE
						}
						if (file.size > APP_ICON_MAX_BYTES) {
							message.error(t('app_setting.icon_too_large'))
							return Upload.LIST_IGNORE
						}
						onChange({ intent: 'replace', file, url: URL.createObjectURL(file) })
						return false
					}}
				>
					<Button icon={<UploadOutlined />}>{t('app_setting.icon_choose')}</Button>
				</Upload>
				{src && (
					<Button
						icon={<DeleteOutlined />}
						onClick={() => onChange({ intent: 'remove' })}
					>
						{t('app_setting.icon_remove')}
					</Button>
				)}
			</Flex>
		</Form.Item>
	)
}
```

Create `components/admin/apps/connection-test.tsx`:

```tsx
'use client'

import { Alert, Button, Flex, Form, type FormInstance, type FormItemProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { testAppConnectionAction } from '@/app/(admin)/app-management/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { ProviderId } from '@/lib/providers/ids'

import type { AppFormValues } from './app-form-values'
import { connectionOutcome, type ConnectionOutcome } from './connection-outcome'

/**
 * E7 (spec §4.2): a default Button, "Test connection", with `loading` while the test runs, and an Alert under it with
 * `showIcon`, a title and a description: success, warning or error (Alert API: `title` replaces the deprecated
 * `message`). The provider section renders it last in its Connection rows and keys it by the connection fields' values,
 * so a change there clears the result (react.dev "Resetting state with a key"). The connection fields are checked first
 * (Form `validateFields(nameList)`); the action reads a blank secret from the stored app and saves nothing.
 */
export default function ConnectionTest({
	appId,
	provider,
	fields,
	chosenType,
}: {
	appId?: string
	provider: ProviderId
	/** The connection fields' names (antd's own type for a Form.Item `name`). */
	fields: NonNullable<FormItemProps['name']>[]
	chosenType?: string
}) {
	const { t } = useTranslation()
	const form = Form.useFormInstance() as FormInstance<AppFormValues>
	const { pending, run } = useActionTransition()
	const [outcome, setOutcome] = useState<ConnectionOutcome | null>(null)

	const test = () =>
		void run(async () => {
			try {
				await form.validateFields(fields)
			} catch {
				// The fields show their own errors (Form `validateFields` rejects with the error list).
				return
			}
			const values = form.getFieldsValue(true)
			const result = await testAppConnectionAction({
				appId,
				provider,
				settings: values.settings,
				secrets: values.secrets,
			})
			setOutcome(connectionOutcome(t, provider, result, chosenType))
		})

	return (
		<Flex
			vertical
			gap="small"
			align="flex-start"
		>
			<Button
				loading={pending}
				onClick={test}
			>
				{t('app_setting.test_connection')}
			</Button>
			{outcome && (
				<Alert
					type={outcome.type}
					showIcon
					title={outcome.title}
					description={outcome.description}
				/>
			)}
		</Flex>
	)
}
```

(`FormItemProps['name']` is antd's `NamePath`, the type `validateFields(nameList?: NamePath[])` takes (`antd info Form --format json`); antd exports the props type from its root, not `NamePath` itself.)

- [ ] **Step 7: The shared fields and the provider sections**

Run: `git mv components/admin/apps/app-settings-fields.tsx components/admin/apps/app-common-fields.tsx`, then replace the whole of `components/admin/apps/app-common-fields.tsx` with:

```tsx
'use client'

import { Divider, Form, Input, Radio, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'

import {
	APP_DESCRIPTION_MAX,
	APP_NAME_MAX,
	appTagsSchema,
} from '@/app/(admin)/app-management/schemas'
import { accountOptionLabel } from '@/components/admin/account-option'
import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import { appIconUrl } from '@/components/apps/app-icon'
import { PROVIDER_UI } from '@/components/provider-ui/registry'
import type { AdminAppDto } from '@/lib/data/apps'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import { PROVIDER_IDS } from '@/lib/providers/ids'

import type { AppFormValues, IconDraft } from './app-form-values'
import IconField from './icon-field'

/**
 * The fields every provider shares (spec §4.1, layout B): the provider choice first (E1; disabled on an edit, E8), and,
 * once a provider is picked, the rest of Basic (name, description E6, tags E5, icon E4, status) and Access. Until then
 * the provider is the only row. The access pickers show while the app is restricted; hidden, they keep their values in
 * the form store (antd Form `preserve`, default true) and an app open to everyone stores no grant (B3a deviation 4).
 */
export default function AppCommonFields({
	record,
	groups,
	users,
	tagOptions,
	icon,
	onIconChange,
	iconError,
}: {
	record?: AdminAppDto
	groups: GroupOption[]
	users: UserOption[]
	/** The tags other apps use, offered as suggestions (E5). */
	tagOptions: string[]
	icon: IconDraft
	onIconChange: (draft: IconDraft) => void
	iconError?: string
}) {
	const { t } = useTranslation()
	const form = Form.useFormInstance<AppFormValues>()
	const provider = Form.useWatch('provider', form)
	const accessMode = Form.useWatch(['access', 'mode'], form)

	return (
		<>
			<Divider titlePlacement="start">{t('app_setting.section_basic')}</Divider>
			<Form.Item
				label={t('app_setting.provider')}
				name="provider"
				tooltip={t('app_setting.provider_tooltip')}
				rules={[{ required: true, message: t('app_setting.provider_required') }]}
			>
				<Select
					placeholder={t('app_setting.provider_placeholder')}
					disabled={Boolean(record)}
					getPopupContainer={drawerPopupContainer}
					options={PROVIDER_IDS.map(id => ({ value: id, label: t(PROVIDER_UI[id].labelKey) }))}
				/>
			</Form.Item>
			{provider && (
				<>
					<Form.Item
						label={t('app_setting.name')}
						name="name"
						tooltip={t('app_setting.name_tooltip')}
						rules={[
							{ required: true, whitespace: true, message: t('app_setting.name_required') },
							{ max: APP_NAME_MAX },
						]}
					>
						<Input placeholder={t('app_setting.name_placeholder')} />
					</Form.Item>
					<Form.Item
						label={t('app_setting.description')}
						name="description"
						tooltip={t('app_setting.description_tooltip')}
						rules={[{ max: APP_DESCRIPTION_MAX }]}
					>
						<Input.TextArea
							autoSize={{ minRows: 2, maxRows: 6 }}
							placeholder={t('app_setting.description_placeholder')}
						/>
					</Form.Item>
					<Form.Item
						label={t('app_setting.tags')}
						name="tags"
						extra={t('app_setting.tags_help')}
						rules={[
							{
								// The action's own rule (appTagsSchema), so the browser and the server agree.
								validator: (_rule, value) =>
									appTagsSchema.safeParse(value ?? []).success
										? Promise.resolve()
										: Promise.reject(new Error(t('app_setting.tags_help'))),
							},
						]}
					>
						<Select
							mode="tags"
							tokenSeparators={[',']}
							getPopupContainer={drawerPopupContainer}
							placeholder={t('app_setting.tags_placeholder')}
							options={tagOptions.map(tag => ({ value: tag, label: tag }))}
						/>
					</Form.Item>
					<IconField
						provider={provider}
						savedSrc={record?.hasIcon ? appIconUrl(record.id) : null}
						draft={icon}
						onChange={onIconChange}
						error={iconError}
					/>
					<Form.Item
						label={t('app_setting.status')}
						name="enabled"
						tooltip={t('app_setting.status_tooltip')}
						valuePropName="checked"
					>
						<Switch />
					</Form.Item>

					<Divider titlePlacement="start">{t('app_setting.section_access')}</Divider>
					<Form.Item
						label={t('app_setting.access')}
						name={['access', 'mode']}
						tooltip={t('app_setting.access_tooltip')}
					>
						<Radio.Group
							optionType="button"
							options={[
								{ value: 'everyone', label: t('app_setting.access_everyone') },
								{ value: 'restricted', label: t('app_setting.access_restricted') },
							]}
						/>
					</Form.Item>
					{accessMode === 'restricted' && (
						<>
							<Form.Item
								label={t('app_setting.access_groups')}
								name={['access', 'groupIds']}
							>
								<Select
									mode="multiple"
									getPopupContainer={drawerPopupContainer}
									allowClear
									showSearch={{ optionFilterProp: 'label' }}
									placeholder={t('app_setting.access_groups_placeholder')}
									options={groups.map(group => ({ value: group.id, label: group.name }))}
								/>
							</Form.Item>
							<Form.Item
								label={t('app_setting.access_people')}
								name={['access', 'userIds']}
								extra={t('app_setting.access_admins_hint')}
							>
								<Select
									mode="multiple"
									getPopupContainer={drawerPopupContainer}
									allowClear
									showSearch={{ optionFilterProp: 'label' }}
									placeholder={t('app_setting.access_people_placeholder')}
									options={users.map(user => ({
										value: user.id,
										label: accountOptionLabel(user, t('admin_users.status_deactivated')),
									}))}
								/>
							</Form.Item>
						</>
					)}
				</>
			)}
		</>
	)
}
```

Create `components/provider-ui/provider-form-section.tsx`:

```tsx
'use client'

import type { ProviderId } from '@/lib/providers/ids'

import DifyFormSection from './dify/form-section'

/**
 * The admin form's half of the client registry (Part 1 spec §3): the picked provider's sections, after the shared ones.
 * A module of its own, so the gallery's registry does not carry the admin form (Next "Server and Client Components":
 * a client module's imports are all in the bundle). An exhaustive switch: a provider without a section fails tsc.
 */
export default function ProviderFormSection({
	provider,
	appId,
	editing,
}: {
	provider: ProviderId
	appId?: string
	editing: boolean
}) {
	switch (provider) {
		case 'dify':
			return (
				<DifyFormSection
					appId={appId}
					editing={editing}
				/>
			)
		default:
			return provider satisfies never
	}
}
```

Create `components/provider-ui/dify/form-section.tsx`:

```tsx
'use client'

import { Divider, Form, Input, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'

import { drawerPopupContainer } from '@/components/admin/drawer-popup-container'
import ConnectionTest from '@/components/admin/apps/connection-test'

import { validateApiBase } from './api-base-rule'
import { APP_MODE_OPTION_KEYS, APP_MODE_OPTIONS } from './app-types'

/** The connection fields: the test is keyed by their values, so a change clears its result (E7). */
const CONNECTION_FIELDS = [
	['settings', 'apiBase'],
	['secrets', 'apiKey'],
	['settings', 'appType'],
]

/**
 * Dify's sections of the app form (spec §4.1): Connection (API base, API key, app type, Test connection), Conversation
 * (update inputs after the conversation starts; the opening statement's display) and More (form replies and their submit
 * text). The key is write-only (spec §2.3): required on a new app, and on an edit blank by default, which keeps the
 * stored one. The labels are i18n keys now; they were hard-coded English (coupling map §4).
 */
export default function DifyFormSection({ appId, editing }: { appId?: string; editing: boolean }) {
	const { t } = useTranslation()
	const form = Form.useFormInstance()
	const replyOn = Form.useWatch(['settings', 'answerForm', 'enabled'], form)
	const apiBase = Form.useWatch(['settings', 'apiBase'], form)
	const apiKey = Form.useWatch(['secrets', 'apiKey'], form)
	const appType = Form.useWatch(['settings', 'appType'], form)

	return (
		<>
			<Divider titlePlacement="start">{t('app_setting.section_connection')}</Divider>
			<Form.Item
				label={t('app_setting.api_base')}
				name={['settings', 'apiBase']}
				tooltip={t('app_setting.api_base_tooltip')}
				rules={[
					{ required: true, message: t('app_setting.api_base_required') },
					{ validator: validateApiBase(t('app_setting.api_base_invalid')) },
				]}
			>
				<Input placeholder={t('app_setting.api_base_placeholder')} />
			</Form.Item>
			<Form.Item
				label={t('app_setting.api_key')}
				name={['secrets', 'apiKey']}
				tooltip={t('app_setting.api_key_tooltip')}
				rules={editing ? [] : [{ required: true, message: t('app_setting.api_key_required') }]}
			>
				<Input.Password
					autoComplete="new-password"
					placeholder={t(
						editing ? 'app_setting.secret_keep_placeholder' : 'app_setting.api_key_placeholder',
					)}
				/>
			</Form.Item>
			<Form.Item
				label={t('app_setting.type')}
				name={['settings', 'appType']}
				tooltip={t('app_setting.type_tooltip')}
				rules={[{ required: true, message: t('app_setting.type_required') }]}
			>
				<Select
					placeholder={t('app_setting.type_placeholder')}
					getPopupContainer={drawerPopupContainer}
					options={APP_MODE_OPTIONS.map(mode => ({
						value: mode,
						label: t(APP_MODE_OPTION_KEYS[mode]),
					}))}
				/>
			</Form.Item>
			{/* E7: the last row of Connection, under the fields (no label: the wrapper takes the field column). */}
			<Form.Item wrapperCol={{ xs: { span: 24 }, sm: { offset: 8, span: 16 } }}>
				<ConnectionTest
					key={[apiBase, apiKey, appType].join('\n')}
					appId={appId}
					provider="dify"
					fields={CONNECTION_FIELDS}
					chosenType={appType}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_conversation')}</Divider>
			<Form.Item
				label={t('app_setting.update_inputs')}
				name={['settings', 'enableUpdateAfterConversationStarts']}
				tooltip={t('app_setting.update_inputs_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			<Form.Item
				label={t('app_setting.opening_display')}
				name={['settings', 'openingStatementDisplayMode']}
				tooltip={t('app_setting.opening_display_tooltip')}
			>
				<Select
					getPopupContainer={drawerPopupContainer}
					options={[
						{ value: 'default', label: t('app_setting.opening_display_default') },
						{ value: 'always', label: t('app_setting.opening_display_always') },
					]}
				/>
			</Form.Item>

			<Divider titlePlacement="start">{t('app_setting.section_more')}</Divider>
			<Form.Item
				label={t('app_setting.form_reply')}
				name={['settings', 'answerForm', 'enabled']}
				tooltip={t('app_setting.form_reply_tooltip')}
				valuePropName="checked"
			>
				<Switch />
			</Form.Item>
			{replyOn && (
				<Form.Item
					label={t('app_setting.submit_text')}
					name={['settings', 'answerForm', 'feedbackText']}
					tooltip={t('app_setting.submit_text_tooltip')}
					rules={[{ max: 255 }]}
				>
					<Input placeholder={t('app_setting.submit_text_placeholder')} />
				</Form.Item>
			)}
		</>
	)
}
```

- [ ] **Step 8: The drawer**

Replace the whole of `components/admin/apps/app-form-drawer.tsx` with:

```tsx
'use client'

import { App, Button, Drawer, Form, type FormInstance, Space } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createAppAction, updateAppAction } from '@/app/(admin)/app-management/actions'
import ProviderFormSection from '@/components/provider-ui/provider-form-section'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { AppAccessSettings } from '@/lib/app-access'
import type { AdminAppDto } from '@/lib/data/apps'
import type { GroupOption } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import type { ProviderId } from '@/lib/providers/ids'

import AppCommonFields from './app-common-fields'
import { appErrorKey } from './app-errors'
import {
	type AppFormValues,
	DEFAULT_APP_FORM_VALUES,
	type IconDraft,
	providerDefaults,
	toAppFormData,
	toAppFormValues,
} from './app-form-values'
import { useRequiredMark } from './required-mark'

const APP_FORM_ID = 'app-settings-form'

/** The access pickers' errors: a group or account picked there and deleted meanwhile (B3a deviation 3, ruling M13). */
const accessPickerErrors = (
	errors: string[],
): Parameters<FormInstance<AppFormValues>['setFields']>[0] => [
	{ name: ['access', 'groupIds'], errors },
	{ name: ['access', 'userIds'], errors },
]

/** What the drawer's save needs from the form: its instance and its icon, whose server refusal it shows. */
interface SaveContext {
	form: FormInstance<AppFormValues>
	icon: IconDraft
	setIconError: (error: string | undefined) => void
}

/**
 * The form inside the drawer. It owns its instance through `Form.useForm()` here, in a component that mounts with the
 * drawer's content (`destroyOnHidden`), so each opening starts from its own `initialValues` and its own icon draft.
 * Layout B (decision 29): `layout="horizontal"` with labels beside the fields, above them on a phone through the grid's
 * responsive spans (Form API `labelCol`: "sm: {span: 3, offset: 12}"; the "basic" demo's 8/16); the requiredMark render
 * (E3). Picking a provider sets its documents to the provider's defaults, so switching before the save resets them.
 */
function AppForm({
	record,
	groups,
	users,
	tagOptions,
	onSave,
}: {
	record?: AdminAppDto
	groups: GroupOption[]
	users: UserOption[]
	tagOptions: string[]
	onSave: (context: SaveContext) => void
}) {
	const [form] = Form.useForm<AppFormValues>()
	const requiredMark = useRequiredMark()
	const [icon, setIcon] = useState<IconDraft>({ intent: 'keep' })
	const [iconError, setIconError] = useState<string | undefined>()
	const provider = Form.useWatch('provider', form)
	return (
		<Form<AppFormValues>
			form={form}
			id={APP_FORM_ID}
			layout="horizontal"
			labelCol={{ xs: { span: 24 }, sm: { span: 8 } }}
			wrapperCol={{ xs: { span: 24 }, sm: { span: 16 } }}
			requiredMark={requiredMark}
			autoComplete="off"
			initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}
			onFinish={() => onSave({ form, icon, setIconError })}
			onValuesChange={(changed: { provider?: ProviderId; access?: Partial<AppAccessSettings> }) => {
				if (changed.provider) form.setFieldsValue(providerDefaults(changed.provider))
				// A field without `rules` is never re-validated, so the server's error on the pickers is cleared by hand
				// when either pick changes (@rc-component/form Field: validation runs only for fields with rules).
				if (changed.access && ('groupIds' in changed.access || 'userIds' in changed.access))
					form.setFields(accessPickerErrors([]))
			}}
		>
			<AppCommonFields
				record={record}
				groups={groups}
				users={users}
				tagOptions={tagOptions}
				icon={icon}
				onIconChange={draft => {
					setIcon(draft)
					setIconError(undefined)
				}}
				iconError={iconError}
			/>
			{provider && (
				<ProviderFormSection
					provider={provider}
					appId={record?.id}
					editing={Boolean(record)}
				/>
			)}
		</Form>
	)
}

export interface AppFormDrawerProps {
	open: boolean
	/** The app to edit; absent means create. */
	record?: AdminAppDto
	/** The options of the access pickers (B3 spec §4.4). */
	groups: GroupOption[]
	users: UserOption[]
	/** The tags other apps use, offered as suggestions (E5). */
	tagOptions: string[]
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears the content. */
	onClosed: () => void
}

/**
 * Create or edit an app (spec §4.1, E2: today's Drawer, right, `size="large"`, Cancel and OK in `extra`);
 * `destroyOnHidden` unmounts the form on close. The submit button reaches the form through the HTML `form` attribute.
 * The form is keyed by what it edits, so a drawer reopened for other content while it still slides out gets a fresh
 * store too.
 */
export default function AppFormDrawer({
	open,
	record,
	groups,
	users,
	tagOptions,
	onClose,
	onClosed,
}: AppFormDrawerProps) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = ({ form, icon, setIconError }: SaveContext) =>
		void run(async () => {
			// The whole store (antd Form: "use `getFieldsValue(true)` to get all values"), not onFinish's values, which
			// hold only the mounted fields: a field shown behind a switch (the form reply's text) would be missing from
			// them, and the server parses whole documents (spec §4.3).
			const data = toAppFormData(form.getFieldsValue(true), icon)
			const result = record ? await updateAppAction(record.id, data) : await createAppAction(data)
			if (result.ok) {
				message.success(t(record ? 'admin_apps.edit_success' : 'admin_apps.create_success'))
				onClose()
				return
			}
			// A stale pick (a group or account deleted meanwhile) is the pickers' own error (B3a deviation 3).
			if (result.code === 'invalid_input' && result.fieldErrors?.access) {
				form.setFields(accessPickerErrors([t('app_setting.access_pick_missing')]))
				return
			}
			// The image the server refused (Task 8's pipeline) is the icon field's own error.
			if (result.code === 'invalid_image') {
				setIconError(
					t(
						result.fieldErrors?.icon?.[0] === 'too_large'
							? 'app_setting.icon_too_large'
							: 'app_setting.icon_not_allowed',
					),
				)
				return
			}
			// A field the server refused (a blank key over a broken stored one, spec §2.3, or a value the browser's rules
			// let through) is marked on its field (formFieldErrors keys them by path).
			const documentFields = Object.keys(result.fieldErrors ?? {}).filter(key =>
				/^(name|description|tags)$|^tags\.\d+$|^(settings|secrets)\./.test(key),
			)
			// A refused tag comes back as `tags.<index>`; the field is the whole tag list.
			if (documentFields.length)
				form.setFields(
					documentFields.map(key => ({
						name: key.replace(/^tags\.\d+$/, 'tags').split('.'),
						errors: [t('admin_apps.field_invalid')],
					})),
				)
			message.error(t(appErrorKey(result.code, 'save')))
		})

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			size="large"
			destroyOnHidden
			title={
				record ? t('admin_apps.edit_title', { name: record.name }) : t('admin_apps.create_title')
			}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={pending}
						htmlType="submit"
						form={APP_FORM_ID}
					>
						{record ? t('common.update') : t('common.ok')}
					</Button>
				</Space>
			}
		>
			<AppForm
				key={record?.id ?? 'create'}
				record={record}
				groups={groups}
				users={users}
				tagOptions={tagOptions}
				onSave={save}
			/>
		</Drawer>
	)
}
```

In `components/admin/apps/app-management.tsx`, pass the tags other apps use: after `const shown = apps.filter(…)` add

```tsx
// E5: every tag the apps use, once, as the tag field's suggestions.
const tagOptions = [...new Set(apps.flatMap(app => app.tags))].sort()
```

and add `tagOptions={tagOptions}` to the `<AppFormDrawer … />` props.

- [ ] **Step 9: Run the unit tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/connection-outcome.test.ts __tests__/provider-ui.test.ts __tests__/stub-router.test.ts __tests__/i18n-locales.test.ts` Expected: PASS.

Run: `git grep -nE "api_secret|section_request|app-settings-fields|AppSettingsFields" -- app components lib locales __tests__ e2e` Expected: no output.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint components/admin/apps components/provider-ui e2e/fixtures/stub/router.ts __tests__/connection-outcome.test.ts __tests__/provider-ui.test.ts __tests__/stub-router.test.ts && pnpm exec oxfmt --check components/admin/apps components/provider-ui e2e/fixtures/stub/router.ts __tests__/connection-outcome.test.ts __tests__/provider-ui.test.ts __tests__/stub-router.test.ts locales` Expected: no findings.

Run: `pnpm exec antd lint components/admin/apps components/provider-ui --format json` (the antd skill: lint after changing antd code) Expected: no deprecated prop or API in these files (the run lists any; fix what it names).

Run: `pnpm i18n:lint` Expected: no hardcoded text reported in `components/admin/apps` or `components/provider-ui` (it may still report product names elsewhere, as `docs/i18n-maintenance.md` says).

- [ ] **Step 10: The e2e cases**

In `e2e/admin-apps.spec.ts`:

- add the imports `import { chooseFile, pngOf } from './fixtures/branding'` and keep `stubApiBase`;
- add these helpers after `moreActions`:

```ts
/** The drawer's provider Select (E1): an antd Select's search box is its combobox, named by the field's label. */
const pickProvider = async (page: Page, drawer: Locator, name: string) => {
	await drawer.getByRole('combobox', { name: /^Provider/ }).click()
	await page.getByTitle(name, { exact: true }).click()
}
/** The Alert under Test connection (E7), found by its title. */
const testResult = (drawer: Locator, title: string) =>
	drawer.getByRole('alert').filter({ hasText: title })
```

- replace the case `test('each opening of the drawer starts from its own app, and New starts empty', …)` with:

```ts
test('each opening of the drawer starts from its own app, and New starts with the provider alone', async ({
	page,
}) => {
	await page.goto('/app-management')
	const first = page.getByRole('dialog').filter({ hasText: 'Edit app configuration - Stub app' })
	await openDrawer(rowById(page, APP_ID).getByRole('button', { name: 'Edit' }), first)
	await expect(first.getByLabel('API base')).toHaveValue(`${stubApiBase}`)
	// The stored key never comes back to the browser: a blank field keeps it (spec §2.3).
	await expect(first.getByLabel('API key')).toHaveValue('')
	await expect(first.getByLabel('API key')).toHaveAttribute('placeholder', 'Leave blank to keep')
	// E8: the provider shows, disabled.
	await expect(first.getByRole('combobox', { name: /^Provider/ })).toBeDisabled()
	await drawerOpened(first)
	await first.getByRole('button', { name: 'Cancel' }).click()
	await expect(first).toBeHidden()

	await rowById(page, APP_IDS.workflow).getByRole('button', { name: 'Edit' }).click()
	const second = page
		.getByRole('dialog')
		.filter({ hasText: 'Edit app configuration - Stub workflow' })
	await expect(second.getByLabel('API base')).toHaveValue(`${stubApiBase}/workflow`)
	await second.getByRole('button', { name: 'Cancel' }).click()
	await expect(second).toBeHidden()

	// Layout B (decision 29): until a provider is picked, the provider is the only row.
	const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
	await openDrawer(page.getByRole('button', { name: 'New' }), create)
	await expect(create.getByRole('combobox', { name: /^Provider/ })).toBeEnabled()
	await expect(create.getByLabel('App name')).toHaveCount(0)
	await expect(create.getByLabel('API base')).toHaveCount(0)
	await pickProvider(page, create, 'Dify')
	await expect(create.getByLabel('App name')).toHaveValue('')
	await expect(create.getByLabel('API base')).toHaveValue('')
	await create.getByRole('button', { name: 'Cancel' }).click()
})

test('an admin adds a Dify app: the provider, its fields, a passing test, and the save', async ({
	page,
	isMobile,
}) => {
	await page.goto('/app-management')
	const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
	await openDrawer(page.getByRole('button', { name: 'New' }), create)
	await pickProvider(page, create, 'Dify')
	// E3: the required fields carry the asterisk, the others "(optional)".
	await expect(create.getByText('(optional)').first()).toBeVisible()
	await create.getByLabel('App name').fill(CREATED_APP.name)
	await create.getByLabel('App description').fill('Made by the e2e suite')
	// E5: Enter and a comma both make a tag.
	const tags = create.getByRole('combobox', { name: /^App tags/ })
	await tags.fill('alpha')
	await tags.press('Enter')
	await tags.fill('beta,')
	await expect(create.locator('.ant-select-selection-item', { hasText: 'alpha' })).toBeVisible()
	await expect(create.locator('.ant-select-selection-item', { hasText: 'beta' })).toBeVisible()
	// A comma closes the tag list (rc-select closes it after a token split), so no Escape: with the list closed,
	// Escape would reach the Drawer and close it (antd Drawer `keyboard`, on by default).
	await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0)
	// E4: the image through the Upload button; the preview shows it before the save.
	await chooseFile(page, 'Choose image', {
		name: 'icon.png',
		mimeType: 'image/png',
		buffer: await pngOf(512, 512),
	})
	await expect(create.getByRole('img', { name: 'App icon' })).toBeVisible()
	await create.getByLabel('API base').fill(stubApiBase)
	await create.getByLabel('API key').fill('app-e2e')
	// The app type stays Chatbot; the stub's chat app reports `chat`.
	await create.getByRole('button', { name: 'Test connection' }).click()
	await expect(testResult(create, 'Connected')).toBeVisible()
	if (isMobile) {
		// Spec §4.1: on a phone the labels sit above their fields (responsive spans, xs: 24).
		const label = await create.locator('label', { hasText: 'App name' }).boundingBox()
		const input = await create.getByLabel('App name').boundingBox()
		expect(label!.y + label!.height).toBeLessThanOrEqual(input!.y + 1)
	}
	await create.getByRole('button', { name: 'OK' }).click()
	await expect(page.getByText('App configuration added')).toBeVisible()

	const row = page.getByRole('row', { name: new RegExp(CREATED_APP.name) })
	await expect(row).toBeVisible()
	await expect(row.getByText('Made by the e2e suite')).toBeVisible()
	// The icon was stored as a PNG and the icon route serves it (spec §4.4).
	await expect(row.locator('img')).toHaveAttribute('src', /\/api\/apps\/[^/]+\/icon$/)
	await expect
		.poll(() => row.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0)
})

// Spec §9: the test's mismatch, refused and unreachable scenarios against the stub; a connection change clears it.
test('Test connection warns of another type, and reports a refused key and an unreachable base', async ({
	page,
}) => {
	await page.goto('/app-management')
	const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
	await openDrawer(page.getByRole('button', { name: 'New' }), create)
	await pickProvider(page, create, 'Dify')
	const test = create.getByRole('button', { name: 'Test connection' })

	await create.getByLabel('API base').fill(stubApiBase)
	await create.getByLabel('API key').fill('app-e2e')
	await create.getByRole('combobox', { name: /^App type/ }).click()
	await page.getByTitle('Workflow', { exact: true }).click()
	await test.click()
	await expect(testResult(create, 'Connected, but the type differs')).toContainText(
		'The provider reports this app as Chatbot, not Workflow.',
	)

	await create.getByLabel('API key').fill('app-refused')
	// A connection field changed: the old result is gone (E7).
	await expect(testResult(create, 'Connected, but the type differs')).toHaveCount(0)
	await test.click()
	await expect(testResult(create, 'The key was refused')).toBeVisible()

	await create.getByLabel('API key').fill('app-e2e')
	await create.getByLabel('API base').fill(`${stubApiBase}/unreachable`)
	await test.click()
	await expect(testResult(create, 'The provider could not be reached')).toBeVisible()
	await create.getByRole('button', { name: 'Cancel' }).click()
})

// Spec §2.3 and §9: the provider stays, a blank key keeps the stored one (the chat still works), the icon is replaced
// and removed.
test('an edit keeps the provider and a blank key, and replaces then removes the icon', async ({
	page,
}, testInfo) => {
	const id = ownId(300, testInfo)
	await seedApp(id, `Edit me ${testInfo.project.name}`)
	try {
		await page.goto('/app-management')
		const row = rowById(page, id)
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
		await openDrawer(row.getByRole('button', { name: 'Edit' }), edit)
		await chooseFile(page, 'Choose image', {
			name: 'icon.png',
			mimeType: 'image/png',
			buffer: await pngOf(64, 64),
		})
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row.locator('img')).toHaveAttribute('src', /\/api\/apps\/[^/]+\/icon$/)
		const stored = await withDb(async db => {
			const { rows } = await db.query<{ secrets: { apiKey: string } }>(
				'SELECT secrets FROM apps WHERE id = $1',
				[id],
			)
			return rows[0]?.secrets
		})
		expect(stored).toEqual({ apiKey: 'app-e2e' })

		await openDrawer(row.getByRole('button', { name: 'Edit' }), edit)
		await edit.getByRole('button', { name: 'Remove' }).click()
		await edit.getByRole('button', { name: 'Update' }).click()
		// E11: no image, so Dify's fallback icon (antd icons are role="img", named after the icon).
		await expect(row.getByRole('img', { name: 'apartment' })).toBeVisible()

		await page.goto(`/chat/${id}?isNewCvst=1`)
		await page.getByPlaceholder('Type a message').fill('still here')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: still here', { exact: true })).toBeVisible()
	} finally {
		await dropApp(id)
	}
})
```

- in `test.describe('app access in the drawer (B3 spec §4.4)', …)`, `pick` uses `drawer.getByLabel(picker, { exact: true })`; the labels now end with "(optional)", so replace that line with `await drawer.getByRole('combobox', { name: new RegExp(\`^${picker}\`) }).fill(filter)`, and in `test('a new app starts closed', …)`add`await pickProvider(page, create, 'Dify')`after`openDrawer(…)`and replace`await expect(create.getByLabel('Groups', { exact: true })).toBeVisible()`with`await expect(create.getByRole('combobox', { name: /^Groups/ })).toBeVisible()`.

Run (no other `next dev` of this checkout; `pnpm test:db` not running): `pnpm test:e2e e2e/admin-apps.spec.ts e2e/apps.spec.ts e2e/app-access.spec.ts` Expected: PASS on the three projects.

- [ ] **Step 11: Commit**

```bash
git add components app locales e2e __tests__
git status --short
git commit -m "feat(admin): add apps by provider in the drawer, with Test connection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 13: The table: the Provider column, its filter, "Invalid settings", and the provider boundary

**Goal:** Turn the apps table's Type column into a Provider column with a nested type filter, mark apps whose stored settings fail as 'Invalid settings', and pin the provider boundary with a unit test.

Spec §4.5 (E9) and §2.3. The "Type" column becomes a "Provider" column of plain text ("Dify · Chatflow"), whose built-in `filters` list the providers with the Dify types nested under "Dify" (`children`), so today's filter by type stays (antd Table, column `filters` with `children`; the default `filterMode` "menu" shows a provider with types as a submenu). An app whose documents fail shows `Tag color="error"` "Invalid settings" in the status column (spec §2.3, the column's existing Tag pattern), and its Edit opens on the provider's defaults (Task 11's `toAppFormValues`) so the admin can repair it. Last, spec §11's check — nothing neutral imports from `lib/providers/dify` except the registry, the route guard and the provider UI — becomes a unit test.

**Files:**

- Create: `__tests__/provider-boundary.test.ts`
- Modify: `components/provider-ui/registry.tsx` (`types`, `adminAppType`), `components/admin/apps/app-management.tsx` (the Provider and status columns), `locales/{en,zh,ar}/translation.json`, `e2e/admin-apps.spec.ts`
- Test: `__tests__/provider-ui.test.ts`

**Acceptance Criteria:**

- [ ] `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts __tests__/i18n-locales.test.ts` passes, including 'reads the admin DTO’s type, and none for an invalid app', 'lists Dify’s types in the console’s order' and the 'the provider boundary' case 'keeps every import of the Dify module inside the provider code'.
- [ ] `__tests__/provider-boundary.test.ts` exists.
- [ ] `git grep -n "column_type\|APP_MODE_NAME_KEYS\[app\|app\.mode\b" -- components app` returns no output.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` prints no tsc output and passes; oxlint and `oxfmt --check` on the changed files and `locales` report no findings.
- [ ] `pnpm test:e2e e2e/admin-apps.spec.ts` passes on desktop-light, desktop-dark and mobile-light, including 'the table shows every app with its provider and status, and the provider filter narrows it by type' and 'an app with invalid settings is marked, hidden from the gallery, and repaired from its Edit'.

**Verify:** `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts __tests__/i18n-locales.test.ts && pnpm test:e2e e2e/admin-apps.spec.ts` → unit tests PASS; e2e PASS on the three projects

**Interfaces:**

- Consumes: Task 10's `PROVIDER_UI`, `providerLine`; Task 11's `AdminAppDto`; Task 12's drawer.
- Produces: `PROVIDER_UI.dify.types` (`APP_MODE_OPTIONS`, the console's order); `adminAppType(app: AdminAppDto): string | undefined`; i18n keys `admin_apps.column_provider`, `admin_apps.status_invalid` (and `admin_apps.column_type` removed).

- [ ] **Step 1: Write the failing tests**

In `__tests__/provider-ui.test.ts`, add `adminAppType` to the registry import and append inside the `describe`:

```ts
// E9: the table reads the type of an app whose documents read cleanly; an invalid one has none.
it('reads the admin DTO’s type, and none for an invalid app', () => {
	const common = {
		id: 'a1',
		provider: 'dify' as const,
		name: 'Tea',
		description: '',
		tags: [],
		enabled: true,
		hasIcon: false,
		access: { mode: 'everyone' as const, groupIds: [], userIds: [] },
		createdAt: '',
		updatedAt: '',
	}
	expect(
		adminAppType({
			...common,
			invalid: false,
			settings: {
				apiBase: 'https://dify.example/v1',
				appType: 'workflow',
				answerForm: { enabled: false, feedbackText: '' },
				enableUpdateAfterConversationStarts: false,
				openingStatementDisplayMode: 'default',
			},
			secretsSet: { apiKey: true },
		}),
	).toBe('workflow')
	expect(adminAppType({ ...common, invalid: true })).toBeUndefined()
})
it('lists Dify’s types in the console’s order', () => {
	expect(PROVIDER_UI.dify.types).toEqual([
		'chat',
		'agent',
		'advanced-chat',
		'agent-chat',
		'workflow',
		'completion',
	])
})
```

Create `__tests__/provider-boundary.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * Part 1 spec §11: nothing neutral imports from lib/providers/dify except through the registry, the route guard or the
 * provider UI. The places that may: the provider modules themselves (lib/providers, whose registry and schemas map the
 * ids to Dify), the client registry and its provider sections (components/provider-ui), the Dify chat until Part 3
 * moves it onto the shared chat (components/chat), and the Dify routes (app/api/dify). Everything else is neutral.
 */
const ALLOWED = [
	/^lib\/providers\//,
	/^components\/provider-ui\//,
	/^components\/chat\//,
	/^app\/api\/dify\//,
]
const SOURCE = /\.(ts|tsx)$/
const DIFY_IMPORT = /from '(@\/lib\/providers\/dify[^']*|(\.\.?\/)+(providers\/)?dify\/[^']*)'/

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return sources(full)
		return SOURCE.test(entry.name) ? [full.replaceAll('\\', '/')] : []
	})

describe('the provider boundary', () => {
	it('keeps every import of the Dify module inside the provider code', () => {
		const files = ['app', 'components', 'hooks', 'lib', 'db'].flatMap(sources)
		expect(files.length).toBeGreaterThan(100)
		const offenders = files.filter(
			file =>
				!ALLOWED.some(allowed => allowed.test(file)) &&
				DIFY_IMPORT.test(readFileSync(file, 'utf8')),
		)
		expect(offenders).toEqual([])
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts` Expected: `provider-ui` FAILS (`adminAppType` is not exported; `types` is undefined). `provider-boundary` should PASS already: Tasks 9–12 moved every neutral import behind the registries (Task 11 moved the API base rule into `components/provider-ui/dify`). If it fails, the offenders it lists are neutral files that still import Dify; route each through the registry before going on.

- [ ] **Step 3: The registry's types**

In `components/provider-ui/registry.tsx`, change the `./dify/app-types` import to `import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from './dify/app-types'`, add `import type { AdminAppDto } from '@/lib/data/apps'`, add `types: APP_MODE_OPTIONS` to the `dify` entry and `types: readonly string[]` to the entry type of the `satisfies` clause:

```tsx
export const PROVIDER_UI = {
	dify: {
		labelKey: 'provider.dify',
		Icon: ApartmentOutlined,
		typeLabelKeys: APP_MODE_NAME_KEYS,
		/** The order the table's filter lists the types in: Dify's console order (the admin form's choices). */
		types: APP_MODE_OPTIONS,
	},
} as const satisfies Record<
	ProviderId,
	{
		labelKey: string
		Icon: ComponentType
		typeLabelKeys: Readonly<Record<string, string>>
		types: readonly string[]
	}
>
```

and add after `typeName`:

```tsx
/** The app's type as its provider's settings hold it, for the table (E9); none for an app whose documents failed. */
export const adminAppType = (app: AdminAppDto): string | undefined => {
	if (app.invalid) return undefined
	switch (app.provider) {
		case 'dify':
			return app.settings.appType
		default:
			return app satisfies never
	}
}
```

- [ ] **Step 4: The columns**

In `components/admin/apps/app-management.tsx`:

- replace `import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from '@/components/provider-ui/dify/app-types'` with `import { adminAppType, PROVIDER_UI, providerLine } from '@/components/provider-ui/registry'` and add `import { PROVIDER_IDS } from '@/lib/providers/ids'`;
- replace the Type column object (from `{` before `title: t('admin_apps.column_type'),` to its `},`) with:

```tsx
		{
			// E9: plain text, "Dify · Chatflow"; the built-in filters list the providers with their types nested
			// (antd Table column `filters` with `children`; the default filterMode "menu" shows them as a submenu).
			title: t('admin_apps.column_provider'),
			key: 'provider',
			filters: PROVIDER_IDS.map(id => {
				const ui = PROVIDER_UI[id]
				return ui.types.length
					? {
							text: t(ui.labelKey),
							value: id,
							children: ui.types.map(type => ({
								text: t(ui.typeLabelKeys[type]),
								value: `${id}:${type}`,
							})),
						}
					: { text: t(ui.labelKey), value: id }
			}),
			onFilter: (value, app) =>
				value === app.provider || value === `${app.provider}:${adminAppType(app)}`,
			render: (_, app) => providerLine(t, app.provider, adminAppType(app)),
		},
```

- in the status column's `render`, show the refused documents first:

```tsx
			render: (_, app) =>
				app.enabled ? (
					<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
				) : (
					<Tag>{t('admin_apps.status_disabled')}</Tag>
				),
```

becomes

```tsx
			// Spec §2.3: a row whose documents fail cannot be used; it says so, and Edit opens on the provider's defaults.
			render: (_, app) =>
				app.invalid ? (
					<Tag color="error">{t('admin_apps.status_invalid')}</Tag>
				) : app.enabled ? (
					<Tag color="success">{t('admin_apps.status_enabled')}</Tag>
				) : (
					<Tag>{t('admin_apps.status_disabled')}</Tag>
				),
```

- replace the component comment's first line ` * The app table (spec §5.2): search above, documented column filters for type and status, horizontal scroll` with ` * The app table (spec §5.2; Part 1 E9): search above, documented column filters for provider and status, horizontal scroll`.

The words:

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const EDITS = {
	en: { 'admin_apps.column_type': null, 'admin_apps.column_provider': 'Provider', 'admin_apps.status_invalid': 'Invalid settings' },
	zh: { 'admin_apps.column_type': null, 'admin_apps.column_provider': '提供方', 'admin_apps.status_invalid': '设置无效' },
	ar: { 'admin_apps.column_type': null, 'admin_apps.column_provider': 'المزوّد', 'admin_apps.status_invalid': 'إعدادات غير صالحة' },
}
for (const [language, edits] of Object.entries(EDITS)) {
	const file = `locales/${language}/translation.json`
	const tree = JSON.parse(readFileSync(file, 'utf8'))
	for (const [path, value] of Object.entries(edits)) {
		const [area, key] = path.split('.')
		if (value === null) delete tree[area][key]
		else tree[area][key] = value
	}
	writeFileSync(file, `${JSON.stringify(tree, null, '\t')}\n`)
}
JS
```

- [ ] **Step 5: The e2e cases**

In `e2e/admin-apps.spec.ts`, replace the case `test('the table shows every app with its status, and the type filter narrows it', …)` with:

```ts
// E9: the Provider column reads "Dify · <type>", and its filter nests the Dify types under "Dify".
test('the table shows every app with its provider and status, and the provider filter narrows it by type', async ({
	page,
}) => {
	await page.goto('/app-management')
	await expect(
		page.getByRole('row', { name: /Stub disabled/ }).getByText('Disabled', { exact: true }),
	).toBeVisible()
	await expect(
		rowById(page, APP_IDS.workflow).getByText('Dify · Workflow', { exact: true }),
	).toBeVisible()
	await page.getByRole('columnheader', { name: 'Provider' }).getByRole('button').click()
	// antd's filter menu shows a provider with types as a submenu, opened on hover (Menu `triggerSubMenuAction`).
	await page.getByRole('menuitem', { name: 'Dify' }).hover()
	await page.getByRole('menuitem', { name: 'Workflow', exact: true }).click()
	await page.getByRole('button', { name: 'OK' }).click()
	await expect(page.getByRole('row', { name: /Stub workflow/ })).toBeVisible()
	await expect(page.getByRole('row', { name: /Stub no-site/ })).toBeVisible()
	await expect(page.getByRole('row', { name: /Stub agent/ })).toHaveCount(0)
})

// Spec §2.3: a row whose stored settings fail is marked, hidden from the gallery, and repaired from its Edit.
test('an app with invalid settings is marked, hidden from the gallery, and repaired from its Edit', async ({
	page,
}, testInfo) => {
	const id = ownId(400, testInfo)
	const name = `Broken ${testInfo.project.name}`
	await seedApp(id, name)
	await withDb(db =>
		db.query(`UPDATE apps SET settings = jsonb_set(settings, '{appType}', 'null') WHERE id = $1`, [
			id,
		]),
	)
	try {
		await page.goto('/apps')
		// The gallery has drawn its cards (the seeded stub app's), so the next count is not of an empty page.
		await expect(page.locator(`a[href="/chat/${APP_ID}"]`)).toBeVisible()
		await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0)
		await page.goto('/app-management')
		const row = rowById(page, id)
		await expect(row.getByText('Invalid settings', { exact: true })).toBeVisible()
		const edit = page.getByRole('dialog').filter({ hasText: `Edit app configuration - ${name}` })
		await openDrawer(row.getByRole('button', { name: 'Edit' }), edit)
		// The form opens on Dify's defaults; the admin fills the connection again (the key stays blank: kept).
		await expect(edit.getByLabel('API base')).toHaveValue('')
		await edit.getByLabel('API base').fill(stubApiBase)
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row.getByText('Enabled', { exact: true })).toBeVisible()
		await expect(row.getByText('Dify · Chatbot', { exact: true })).toBeVisible()
	} finally {
		await dropApp(id)
	}
})
```

(`seedApp` and `ownId` are the file's helpers from Task 11; base 400 keeps this case's ids apart from the others'.)

- [ ] **Step 6: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts __tests__/i18n-locales.test.ts` Expected: PASS.

Run: `git grep -n "column_type\|APP_MODE_NAME_KEYS\[app\|app\.mode\b" -- components app` Expected: no output.

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm test` Expected: tsc prints nothing; PASS.

Run: `pnpm exec oxlint components/admin/apps/app-management.tsx components/provider-ui/registry.tsx __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts && pnpm exec oxfmt --check components/admin/apps/app-management.tsx components/provider-ui/registry.tsx __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts e2e/admin-apps.spec.ts locales` Expected: no findings.

Run (no other `next dev` of this checkout; `pnpm test:db` not running): `pnpm test:e2e e2e/admin-apps.spec.ts` Expected: PASS on the three projects.

- [ ] **Step 7: Commit**

```bash
git add components locales e2e/admin-apps.spec.ts __tests__/provider-ui.test.ts __tests__/provider-boundary.test.ts
git commit -m "feat(admin): show the provider in the apps table and mark invalid settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 14: Records

**Goal:** Write ADR-0032 (proposed) and bring the ADR index, four earlier ADRs, the frontend-conventions and auth-gate docs, and the CII assessment in line with the provider-core code.

Spec §10: ADR-0032 "Organise apps by provider: a shared core with provider modules" (status `proposed` until the owner's check, spec §11), dated notes on ADR-0023 (the record, the guard, the removed routes), ADR-0026 (every provider's end user) and ADR-0027 (grants on `apps`), plus one on ADR-0030 (its pipeline now serves app icons, under new names); `docs/frontend-conventions.md` (the form conventions) and `docs/auth-gate.md` follow the code, and three GitHub issues take the backlog updates (Step 5; since PR #56 `CLAUDE.md` holds no file map, decision lines or follow-ups, so this task leaves it alone). `AGENTS.md` asks for the `.cii-assessment.md` re-check before a commit; it goes in its own commit. The running record's entry for Part 1 is written after the merge, as Part 0's decision 36 was (PR #40; Plan decision w).

**Files:**

- Create: `docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md`
- Modify: `docs/decisions/README.md` (a row after 0031), `docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md`, `docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md`, `docs/decisions/0027-gate-apps-by-groups-and-grants-and-deactivate-accounts-with-two-markers.md`, `docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md` (a dated note at the end of each)
- Modify: `docs/frontend-conventions.md` (line 7; the §4.4 table's `MessageFooter` row; §4.5; a status entry before the `- Next:` line)
- Modify: `docs/auth-gate.md` (lines 17, 28, 33, 34 and 43)
- Modify: `.cii-assessment.md` (rows #19, #20, #25, #26, #32, the last-updated date and the change log; its own commit)

**Acceptance Criteria:**

- [ ] `docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md` exists with `status: proposed` and is committed in the docs commit; `docs/decisions/README.md` has its row after 0031.
- [ ] Dated notes are added at the end of ADR-0023, ADR-0026, ADR-0027 and ADR-0030; `git diff --stat` before the commit shows the seven files of Steps 3, 4 and 6 and no other.
- [ ] `CLAUDE.md` is unchanged; the three backlog updates for issues #44, #45 and #49 are written down for the PR description (Step 5); the frontend-conventions and auth-gate script prints `docs/frontend-conventions.md: 4 edits` and `docs/auth-gate.md: 5 edits`.
- [ ] The Step 8 path check prints no `missing:` line, and `find app/api/dify -name route.ts | wc -l` prints `23`.
- [ ] Step 9's `git grep` over `docs/auth-gate.md docs/frontend-conventions.md` prints only the deliberate mentions the step lists.
- [ ] `pnpm exec oxfmt --check` on the two docs, the ADR index and the five ADRs is clean, and the docs commit 'docs: record apps organised by provider (ADR-0032)' exists.
- [ ] The `.cii-assessment.md` script prints `11 edits`, `git grep -c "lib/dify/" -- .cii-assessment.md` prints nothing, the summary stays 24/35, and it is committed alone as 'docs: update CII assessment'.

**Verify:** `find app/api/dify -name route.ts | wc -l && git grep -c "lib/dify/" -- .cii-assessment.md; pnpm exec oxfmt --check docs/auth-gate.md docs/frontend-conventions.md docs/decisions/README.md docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md .cii-assessment.md` → `23`, no grep output, oxfmt clean

**Interfaces:**

- Consumes: every name the earlier tasks produced, as their **Interfaces** blocks give them (`lib/http/*`, `lib/providers/{ids,schemas,registry,route,connection}.ts`, `lib/providers/dify/{schema,provider,test-connection,route}.ts`, `components/provider-ui/*`, `components/admin/apps/{required-mark,icon-field,connection-test}.tsx`, `processImage`/`ImageError`/`lib/settings/image-rules.ts`, the three `apps_*` migrations, `__tests__/provider-boundary.test.ts`, `__tests__/db/{apps,apps-migration}.db.test.ts`).
- Produces: ADR-0032 (`proposed`), which Task 15's last step turns to `accepted` only on the owner's word.

- [ ] **Step 1: List the records that still name the old paths and features**

```bash
git grep -n -o -E "lib/dify\b|dify_apps|[Aa]nnotation[a-z]*|Dify user ID|two \`@ant-design/icons\` majors|encrypting the Dify API keys" -- docs/auth-gate.md docs/frontend-conventions.md .cii-assessment.md
```

Expected now (the earlier tasks touch none of these files): `.cii-assessment.md` lines 59 and 60; `docs/auth-gate.md` lines 17 (three times), 28, 33, 34 (twice: `lib/dify/` and upstream's old `lib/dify-client.ts`) and 43; `docs/frontend-conventions.md` lines 7, 93 (three times) and 97 (three times). Step 9 runs it again.

- [ ] **Step 2: Write ADR-0032**

Create `docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md`. Its icon cap and Remove style are the owner's answers of 2026-10-12 (Plan decisions af and ag).

```markdown
---
status: proposed
date: 2026-10-11
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code sessions (provider-hub brainstorm, the docs check `doc-verification.md`, Part 1 spec and plan)
---

# Organise apps by provider: a shared core with provider modules

## Context and Problem Statement

The provider-hub programme (charter `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`) turns the hub into "AI App Hub", a front for AI apps of several providers: Dify today, AG-UI agents in Part 2, OpenAI-compatible model APIs later (running record `docs/superpowers/research/2026-10-11-provider-hub/README.md`, decisions 2 and 12). Until this record an app was a Dify app. Part 0's `dify_apps` table held Dify's columns (`api_base`, `api_key`, `mode`, the feature switches, the emoji icon columns); saving an app called Dify's `/info` and `/site` and copied the name, the description, the mode and the icon ([ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md)); "Sync app info" did it again; and the admin form, the gallery and the chat page read Dify's fields directly.

The question: how an app of any provider is stored; how the neutral code (the data layer, the route guard, the actions, the gallery, the admin table, the chat page) reaches a provider's code without knowing it; what the admin edits; and what happens to the Dify-only features that do not fit: the sync, the annotations and the emoji icons.

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)); each piece below was checked in `doc-verification.md`, whose rows are cited as "DV 8a" and so on.
- One app record for every provider, so per-app access ([ADR-0027](0027-gate-apps-by-groups-and-grants-and-deactivate-accounts-with-two-markers.md)), the gallery, the admin table and the icon stay one implementation each.
- A new provider is added in a known, small set of places, and the compiler names each one.
- Secrets never reach a browser or a log, and they sit apart from the settings, so the later encryption touches only them (decision 8; OWASP ASVS 5.0 14.2.6, DV 10).
- A stored document that no longer reads (a Part 0 row, a provider whose schema changed) never breaks a page and is never returned half-typed.
- Part 0's rows and grants survive (spec §2.4).
- The Dify chat behaves as before, apart from the annotate action (spec §1).
- The browser bundle carries only client code, and the server chat page hands only serializable props to the client (DV 9b).

## Considered Options

Where a provider's settings live:

- A `provider` column and two `jsonb` documents, `settings` and `secrets`, checked by the provider's zod schemas
- A typed table per provider (`dify_app_settings`, one row per app)
- One wide table with every provider's columns, NULL where they do not apply

The type of the `provider` column:

- `text` with a CHECK that lists the known ids, plus the registry's zod check
- A PostgreSQL enum

How neutral code reaches a provider's code:

- Two registries, server and client, one route guard, and an exhaustive switch where a component is chosen
- A branch on the provider wherever one is needed (Open WebUI's `if`/`else`)
- A registry with a default for an unknown id (LobeHub's `runtimeMap[provider] ?? LobeOpenAI`)

Name, description, tags and icon:

- Admin-owned for every provider, with a Test connection button that copies nothing
- Copied from the provider where it has them (Dify's sync), typed by the admin elsewhere

Dify's annotations:

- Removed
- Kept as a Dify-only row action and chat action

## Decision Outcome

Chosen: one `apps` table with a `provider` column (`text` and a CHECK) and two `jsonb` documents checked by the provider's zod schemas (decisions 17 and 24); two registries and one route guard (decision 9; DV 9 and 11); admin-owned name, description, tags and icon, no sync, and a Test connection button (decisions 5 and 18); image-only icons (decision 19); a provider fixed at creation; the annotations removed (decision 21). This is the shape the reference hubs share (`agui-and-reference-hubs.md` §5): a provider discriminator stored as a string, a per-provider settings document validated by that provider's schema, secrets kept apart, a registry from provider to adapter, and one shared front with provider-specific parts.

### The record

- **`apps`** (Part 0's `dify_apps`, renamed): `id`, `created_at`, `updated_at`, `provider` (`text` NOT NULL, CHECK `apps_provider_check`: `provider IN ('dify')`), `name` (`text` NOT NULL), `description` (`text` NOT NULL DEFAULT `''`), `tags` (`jsonb` NOT NULL DEFAULT `'[]'`), `is_enabled`, `access_mode`, `settings` and `secrets` (`jsonb` NOT NULL), `icon_image` and `icon_mime` (both NULL or both set, CHECK `apps_icon_check`). The jsonb columns are untyped (`unknown`) in Drizzle: `.$type<>()` checks nothing at runtime (DV 8a), so the only typed value is the one a zod parse returns (DV 8b, 8c).
- **Dify's documents** (`lib/providers/dify/schema.ts`): `settings` is `{ apiBase, appType, answerForm: { enabled, feedbackText }, enableUpdateAfterConversationStarts, openingStatementDisplayMode }` (an http(s) URL of at most 500 characters; one of Dify's six app types; at most 255 characters; `'default'` or `'always'`), and `secrets` is `{ apiKey }` (1 to 255 characters).
- **Limits** (zod, ADR-0025): a name of 1 to 255 characters, a description of at most 2,000, at most 10 tags of 1 to 32 characters each, trimmed, duplicates removed before they are counted.
- **The migration** is three drizzle-kit migrations that the migrator applies in one transaction: expand (generated: the rename, the three new columns NULL-able), data (`--custom`: each row's Dify columns become `settings`, `api_key` becomes `secrets`, `provider` becomes `'dify'`, an emoji icon becomes no icon, an image keeps its bytes) and contract (generated: NOT NULL, the defaults, the two CHECKs, the eleven Part 0 columns dropped). One custom migration cannot hold the reshape, because `drizzle-kit generate --custom` writes the previous snapshot unchanged and the next `generate` would emit the whole diff again. A rename keeps the rows, the grants and their foreign keys; PostgreSQL keeps the constraint names (`dify_apps_pkey`, `app_group_grants_app_id_dify_apps_id_fkey`, `app_user_grants_app_id_dify_apps_id_fkey`), and drizzle-kit's snapshot records the same names. A Part 0 app whose `mode` was empty or unknown carries that value into `appType` (`null`, or the unknown text), which the schema refuses, so it shows as "Invalid settings" until an admin repairs it.

### The modules

| Path | Holds | Runs |
| --- | --- | --- |
| `lib/providers/ids.ts` | `PROVIDER_IDS`, `ProviderId`, `isProviderId` | anywhere |
| `lib/providers/schemas.ts` | `PROVIDER_SCHEMAS` (each provider's schemas and defaults), `checkSettings`, `checkDocuments`, `mergeSecrets`, `documentFieldErrors` | anywhere: the admin form validates with the rules the server parses (DV 9a) |
| `lib/providers/dify/schema.ts` | Dify's two document schemas and their defaults | anywhere |
| `lib/providers/registry.ts` | `PROVIDERS` (`satisfies` one definition per id): schemas, defaults, `testConnection(settings, secrets)`, and what of the settings the chat DTO, the gallery DTO and the admin DTO's `secretsSet` carry; `getProvider(id)` answers `undefined` for an id it does not know (fail closed, DV 11) | server only |
| `lib/providers/route.ts` | `resolveAppRoute(params, provider)`: session, `z.uuid()` on the id, `getAppAccess` (visibility), enabled, provider match; 401, 404 `app_not_found` (unknown, invisible, malformed or another provider's), 403 `app_disabled` | server only |
| `lib/providers/dify/` | Part 0's `lib/dify/`, moved: the client, the types, the request schemas, the remote-file guard, the browser client, `route.ts` (`resolveDifyRoute`, on the shared guard), `provider.ts` (the definition), `test-connection.ts` | the client, the route and the test server only; the browser client in the browser |
| `lib/http/` | the envelope and request helpers under neutral names: `errorResponse`, `forbiddenResponse`, `errorResponseFrom`, `ProviderError` (`DifyError` extends it), `jsonNoStore`, the `parse*` helpers, `RequestError` | as before |
| `components/provider-ui/` | the client registry: `PROVIDER_UI` (label key, fallback icon, type names), `ProviderChat` (one switch, `satisfies never` on the provider), `provider-form-section.tsx`, `dify/` | client |

Neutral code imports `lib/providers/dify` only through the registry, the guard and the provider UI; `__tests__/provider-boundary.test.ts` pins it. `components/chat/**` stays Dify's chat until Part 3 and imports the Dify browser client from its new path. The 23 Dify route files keep their paths and their calls to `resolveDifyRoute`.

### The data layer (`lib/data/apps.ts`)

- The documents are parsed on every write and on every read. A row that fails is logged as `{ appId, code }` and never returned half-typed: a user gets 404 and the gallery leaves it out; the admin DTO carries `invalid: true` and no settings, the table shows `Tag color="error"` "Invalid settings", and Edit opens on the provider's defaults.
- The reads that build a user's DTO never select `secrets`; only the guard's `getAppAccess`, Test connection's `getStoredSecrets` (for a secret field left blank) and the admin writes read them.
- The provider is fixed: `updateApp` takes none, and the update's WHERE carries the stored provider.
- Secrets are write-only (DV 10): no DTO carries them, the admin DTO says only `secretsSet: { apiKey: boolean }`, and a blank field keeps the stored value. A blank field over stored secrets that do not read is refused on that field: there is nothing valid to keep.
- Saving never calls a provider (decision 18).

### The admin flow

- Layout B (decision 29): one drawer, the provider `Select` first (disabled on Edit), then the shared fields (name, description, tags, icon, status, access) and the provider's sections; the owner's picks E1 to E11 (`ui-picks-part1.md`).
- `createAppAction(formData)` and `updateAppAction(id, formData)` take FormData because of the icon file (Next "Mutating data"); the nested values travel as one JSON field that zod decodes and checks (zod 4 "Codecs", the `json(schema)` example), in a union keyed by provider; the data layer checks again through the registry. A refused field comes back keyed by its path, with zod's code only.
- `testAppConnectionAction` calls the provider's `testConnection` with the form's values; a blank key on a saved app uses the stored one. Dify's test is `GET <apiBase>/info` with the key, given up after 10 s (MDN `AbortSignal.timeout()`): reachable; reachable with a warning when Dify reports another type (saving is not blocked); the key refused (401); unreachable (no answer, none in time, or a 5xx); an upstream error (any other answer, an OK one that is not Dify's JSON included, which is what a base without `/v1` gets). It copies nothing.
- The icon goes through [ADR-0030](0030-set-each-settings-area-from-the-environment-or-the-admin-page.md)'s pipeline as the image kind `appIcon`: PNG, JPEG or WebP, up to 512 KB in; decoded by sharp, never by the browser's claimed type; re-encoded to a PNG of at most 256 × 256 pixels, in proportion. An image Part 0 stored keeps its type (Dify's `/site` icon may be an SVG), so the icon route keeps answering with `nosniff` and its sandbox CSP. An app without an image shows its provider's fallback icon (Dify `ApartmentOutlined`, an unknown provider `AppstoreOutlined`); Remove is a default Button, as on the branding page.
- The table's Type column becomes a Provider column ("Dify · Chatflow") whose filter lists the providers with Dify's types nested under it.

### Removed

- The sync: `syncAppAction`, `syncApp`, `fetchDifyProfile`, the client's `fetchSignedFile` (its only caller), the icon fetch and the "Sync app info" menu item.
- The annotations: the two `apps/annotations` routes, their client, browser and schema pieces, the admin drawer, panel and modal, the chat's annotate action and drawer, `enable_annotation`, the `annotation.*` keys and the stub's endpoints. Dify's console still has them.
- The emoji icons (`icon_type`, `icon`, `icon_background`) and the fallback icon per Dify type.

### Consequences

- Good, because a provider plugs into named places (the checklist below), and `satisfies Record<ProviderId, …>` and the `never` check make tsc name each one.
- Good, because a new provider needs no new table; per-app access, the gallery and the icon serve it unchanged.
- Good, because the secrets are one column the later encryption can take on its own, and no DTO or log carries them.
- Good, because a document that stops reading becomes a visible, repairable row instead of an error page.
- Bad, because a change to a provider's settings shape needs a data migration of the documents (decision 17), and every new provider a migration that replaces `apps_provider_check` (Part 2 adds `'agui'`).
- Bad, because the jsonb columns have no types in Drizzle; code that skips the zod parse gets `unknown`.
- Bad, because the secrets stay plain text until the encryption follow-up (decision 8).
- Bad, because an admin types the name, the description and the icon that Dify already holds, and a changed Dify app no longer updates the hub's card.
- Bad, because the hub no longer offers Dify's annotations.
- Bad, because write-only secrets do not stop an admin from sending a stored key to an API base of their choosing: Test connection and a save with a blank key both use the stored key with the base the form holds. Only admins can, and the key was theirs to set.
- Bad, because the migration is one-way: Part 0's image cannot read `apps`. The way back is the dump taken before it and the old image (the plan's Task 15, Steps 9 and 15).

### Deviations from the spec text

- §2.4 says "one migration"; it is three drizzle-kit migrations applied in one transaction, a mechanism the spec left to the plan.
- §3 places "the app-type list" in `dify/schema.ts`; `APP_MODES` stays in `lib/providers/dify/types/app.ts` (the schema imports it) and the option labels in `components/provider-ui/dify/app-types.ts`.
- §3 writes `resolveAppRoute(appId, provider)`; it takes the route's `params` promise, as every handler receives it.
- §3's `ProviderDefinition` also carries `secretsUpdateSchema` and the DTO mappers `chatFields`, `summaryFields` and `secretsSet`, so the neutral data layer builds every DTO without importing a provider (§11).

## Implementation Plan

- **Affected paths:** `db/schema/apps.ts`, `db/migrations/*_apps_{expand,data,contract}/`, `lib/providers/**`, `lib/http/**`, `lib/data/apps.ts`, `lib/settings/{images,image-rules}.ts`, `app/(admin)/app-management/{actions,schemas}.ts`, `components/admin/apps/**`, `components/provider-ui/**`, `components/apps/**`, `app/(user)/chat/[appId]/page.tsx`.
- **Adding a provider:** its id in `PROVIDER_IDS`; its document schemas and defaults in `PROVIDER_SCHEMAS`; its definition in `PROVIDERS`; its label, fallback icon and types in `PROVIDER_UI`, its form section in `provider-form-section.tsx`, its view in `ProviderChat`; the `provider.<id>` key in every locale; a migration that replaces `apps_provider_check`; its routes through `resolveAppRoute(params, '<id>')`.
- **Patterns:** neutral code never imports `lib/providers/<id>/`; a provider's settings are read only through `checkSettings`/`checkDocuments`; a secret never enters a DTO, a log line or an action result.

### Verification

- [ ] `pnpm test` passes, with `provider-schemas`, `provider-registry`, `dify-test-connection`, `provider-route`, `provider-ui`, `provider-boundary`, `apps-schema` and `db-apps-migrations` among its files.
- [ ] `pnpm test:db` passes, with `apps.db.test.ts` (the documents, the blank key, the icon, the fixed provider) and `apps-migration.db.test.ts` (Part 0 rows through the three migrations).
- [ ] The e2e suite passes on its three projects: create with Test connection, edit with a blank key and the icon replaced then removed, the Provider filter, an invalid row repaired, the gallery card, the chat for every Dify type.
- [ ] The three migrations ran on a copy of the local database before the real one, and the Docker gate's checks pass, `/api/dify/<id>/apps/annotations` signed in answering 404.
- [ ] The owner's check of the running stack.

## Pros and Cons of the Options

### A `provider` column and two `jsonb` documents

- Good, because it is the reference hubs' shape: LobeHub's `ai_providers.settings` jsonb with `key_vaults` apart, Dify's `provider_credentials.encrypted_config`, LibreChat's zod-validated endpoint objects.
- Good, because a provider needs no new table, and access, the gallery and the icon stay one implementation.
- Bad, because the database checks only the provider id; the documents' shape lives in zod (ADR-0025), on every write and every read.

### A typed table per provider

- Good, because the database types each setting.
- Bad, because every provider adds a table and a join, and the neutral reads either join all of them or branch per provider.

### One wide table

- Bad, because most columns are NULL for most rows, and nothing ties a column to its provider.

### `text` with a CHECK

- Good, because PostgreSQL cannot use a value added by `ALTER TYPE … ADD VALUE` until the transaction commits, and Drizzle's migrator runs every pending migration in one transaction (DV 2e); a CHECK is replaced inside it.
- Good, because LobeHub stores the provider as a `varchar` with a TypeScript-only enum (DV 11).

### A PostgreSQL enum

- Bad, because enum values cannot be removed, and the PostgreSQL docs call enums "primarily intended for static sets"; the hub's static sets (role, access mode, membership source) stay enums.

### Two registries, one guard, an exhaustive switch

- Good, because LibreChat (`providerConfigMap`) and LobeHub (`providerRuntimeMap`) dispatch through a registry, and an unknown id here fails closed instead of falling back (DV 11).
- Good, because the client registry is a `'use client'` module the server page never reads from: it passes the provider and a serializable DTO to `ProviderChat` (DV 9b; React "use client" caveats).

### A branch at each place

- Bad, because each new provider means finding every branch; Open WebUI's `if`/`else` in `generate_chat_completion` is the one reference hub that does this.

### A registry with a default

- Bad, because an app of an unknown provider would run as another provider; the hub refuses it instead.

### Admin-owned metadata with Test connection

- Good, because every provider gets the same form, and AG-UI agents have nothing to copy from (`agui-and-reference-hubs.md`, "Implications" 3).
- Good, because saving never waits on a provider, and the test still catches a wrong base, key or type before it reaches a user.
- Bad, because the admin types what Dify already has.

### Copying from the provider

- Bad, because the form would differ by provider, and a save would depend on the provider answering.

### Annotations removed

- Good, because every provider's row and chat actions are the same, as the owner asked: "remove the annotations. I don't use that feature. that way all the options are the same" (decision 21).
- Bad, because a Dify app's annotations are managed in Dify's console only.

### Annotations kept as a Dify-only action

- Bad, because it keeps the only role-gated Dify routes and the registry's only per-provider row action for a feature nobody uses.

## More Information

Spec: `docs/superpowers/specs/2026-10-11-part-1-provider-core-design.md` (approved 2026-10-11, decision 32). Plan: `docs/superpowers/plans/2026-10-12-part-1-provider-core.md` (its Plan decisions; af and ag are the owner's answers of 2026-10-12). Running record: decisions 5, 8, 9, 17 to 19, 21, 22, 24, 28 to 30, 37. Research: `agui-and-reference-hubs.md` §5 (the reference hubs), `doc-verification.md` (DV 8 to 11), `dify-coupling-map.md`, `ui-picks-part1.md`.

The spec's §4.4 (a 512 KB icon input, first 1 MB) and §4.1 (a default Remove button, first a danger one) carry the owner's answers of 2026-10-12 (running record, decision 37).

Notes on [ADR-0023](0023-build-the-dify-layer-as-one-route-per-operation.md), [ADR-0026](0026-use-the-accounts-permanent-id-as-the-dify-end-user.md), [ADR-0027](0027-gate-apps-by-groups-and-grants-and-deactivate-accounts-with-two-markers.md) and [ADR-0030](0030-set-each-settings-area-from-the-environment-or-the-admin-page.md) record what changed in each.

Follow-ups: encrypting provider secrets (`apps.secrets`) with the settings key, with SMTP and LDAP (decision 8); the AG-UI provider and `'agui'` in the CHECK (Part 2); Dify onto the shared chat (Part 3).

Sources: Drizzle "PostgreSQL column types" (`jsonb`, `.$type<>()`), "Migrations" and drizzle-kit `generate --custom`; PostgreSQL 18 "Constraints" (CHECK), "Enumerated Types", "ALTER TYPE", "ALTER TABLE" (RENAME), "SQL Dump" (the backup and its restore); Docker Compose `build` and `up` references (the `project-service` image tag, `--no-build`); zod 4.6.5 (`safeParse`, `z.discriminatedUnion`, "Codecs"); Next 16.3 bundled docs (`01-getting-started/05-server-and-client-components.md`, `01-getting-started/07-mutating-data.md`, `02-guides/data-security.md`, `03-api-reference/05-config/01-next-config-js/serverActions.md`); React "'use client'" caveats; OWASP ASVS 5.0 14.2.6 and the Secrets Management Cheat Sheet; MDN `AbortSignal.timeout()`; antd 6.6.5 Form (`layout`, `labelCol`, `requiredMark`), Upload, Table (`filters`), Select (`mode="tags"`); LibreChat `packages/api/src/endpoints/config/providers.ts`; LobeHub `packages/database/src/schemas/aiInfra.ts` and `packages/model-runtime/src/runtimeMap.ts`; Dify `api/models/provider.py` and `api/core/entities/provider_configuration.py`.
```

- [ ] **Step 3: The index row**

In `docs/decisions/README.md`, after the line

```
| [0031](0031-move-the-database-to-postgresql-18.md) | Move the database to PostgreSQL 18 | accepted | 2026-10-11 |
```

add

```
| [0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md) | Organise apps by provider: a shared core with provider modules | proposed | 2026-10-11 |
```

- [ ] **Step 4: The notes on ADR-0023, ADR-0026, ADR-0027 and ADR-0030**

Each note is appended at the end of its file (the end of "More Information"), in that file's style: ADR-0023, ADR-0026 and ADR-0030 use a "Note, <date> (…):" paragraph, ADR-0027 a `### Note, <date> (…)` heading. The date is the day this step runs; the text shows 2026-10-12.

```bash
cat >> docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md <<'MD'

Note, 2026-10-12 (Part 1, [ADR-0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md)): the record is `apps`, with Dify's settings and key in the `settings` and `secrets` documents (`lib/providers/dify/schema.ts`), and `lib/dify/` is `lib/providers/dify/`. `resolveDifyRoute` now wraps the shared guard `resolveAppRoute(params, 'dify')` (`lib/providers/route.ts`), which answers an app of another provider as `404 app_not_found`; the Dify context it builds is unchanged. The envelope and the request helpers moved to `lib/http/` under neutral names (`errorResponse`, `forbiddenResponse`, `errorResponseFrom`, `jsonNoStore`, the `parse*` helpers, `RequestError`), and `DifyError` extends the new `ProviderError`; `pathSegment` lives in `lib/http/parse.ts`. The two annotation routes are removed (decision 21), so 23 route files remain (23 operations in 22, plus `files/remote`) and no Dify route checks a role. Saving no longer calls `/info` or `/site`, and the icon is the admin's upload (ADR-0032), so the DAL bullet's sync and the icon-staleness follow-up no longer apply.
MD

cat >> docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md <<'MD'

Note, 2026-10-12 (Part 1, [ADR-0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md)): the account's permanent id is the end user for every provider, not Dify alone. The shared guard (`lib/providers/route.ts`) hands each provider's route the verified actor, and Dify's `resolveDifyRoute` (`lib/providers/dify/route.ts`) sets `user` from its id as before; Part 2's AG-UI provider takes the same id. The users page's column is "User ID" (`admin_users.user_id`, CSS class `userId`), still with its copy button.
MD

cat >> docs/decisions/0027-gate-apps-by-groups-and-grants-and-deactivate-accounts-with-two-markers.md <<'MD'

### Note, 2026-10-12 ([ADR-0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md))

The grants are on `apps`, Part 0's `dify_apps` renamed for every provider: `app_group_grants` and `app_user_grants` keep their foreign keys to `apps.id` with `ON DELETE CASCADE`, and their constraint names (`app_group_grants_app_id_dify_apps_id_fkey`, `app_user_grants_app_id_dify_apps_id_fkey`), which PostgreSQL keeps on a rename. `access_mode` and `visibleTo` are unchanged and apply to an app of any provider; a row whose documents do not read is left out of every user's list and answers 404, like an app the user may not see.
MD

cat >> docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md <<'MD'

Note, 2026-10-12 (Part 1, [ADR-0032](0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md)): the image pipeline also serves app icons, as the kind `appIcon`: PNG, JPEG or WebP, up to 512 KB in (`APP_ICON_MAX_BYTES`), re-encoded to a PNG of at most 256 × 256 pixels (`APP_ICON_SIZE`), in proportion and never enlarged. Its names lost "brand": `processImage` (was `processBrandImage`) and `ImageError` (was `BrandImageError`) in `lib/settings/images.ts`, and the client-safe `IMAGE_MIME_TYPES`, `IMAGE_ERROR_CODES` and `ImageErrorCode` in `lib/settings/image-rules.ts` (were `BRAND_IMAGE_*` in `lib/settings/branding-rules.ts`); the branding images behave as before. The follow-up "encrypting the Dify API keys" is now "encrypting provider secrets" (`apps.secrets`).
MD
```

- [ ] **Step 5: The backlog updates (GitHub issues)**

Since PR #56, `CLAUDE.md` holds no file map, no decision lines and no follow-ups, so nothing in it changes. The follow-ups live in GitHub issues labelled `fork/overhaul`; Part 1 changes three of them. Posting to GitHub waits for the owner's word, like the PR: write the three updates into the PR description (Task 15 opens the PR on the owner's word), and post them as issue comments after the merge.

- #44 (i18n): add Part 1's new and reworded keys to the owner's review list: `provider.dify`, `form.optional`, `connection_test.*`, the drawer's new and reworded `app_setting.*` keys, `admin_apps.provider_unreachable`, `admin_apps.column_provider`, `admin_apps.status_invalid`, `admin_apps.field_invalid`, `admin_users.user_id`, and the reworded `admin_apps.subtitle`, `app.no_config_default_text` and `admin_users.delete_directory_confirm_description`.
- #45 (frontend): the item "two `@ant-design/icons` majors in the tree" is done (Task 1 leaves one).
- #49 (settings and branding): "encrypting the Dify API keys with the settings key" becomes "encrypting provider secrets (`apps.secrets`) with the settings key (ADR-0032)".

Expected: nothing to run; the three updates are written down for the PR.

- [ ] **Step 6: `docs/frontend-conventions.md` and `docs/auth-gate.md`**

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const EDITS = {
	'docs/frontend-conventions.md': [
		// Line 7.
		[
			"the backend's `lib/auth/`, `lib/data/` and `lib/dify/` since B1, ADR-0023)",
			"the backend's `lib/auth/`, `lib/data/` and `lib/dify/` since B1, ADR-0023; `lib/providers/` with `lib/providers/dify/`, and `lib/http/`, since Part 1, ADR-0032; the provider UI in `components/provider-ui/`)",
		],
		// Line 38, the §4.4 table: the annotate item was removed.
		['`Actions.Audio` (TTS), plus regenerate and annotate items |', '`Actions.Audio` (TTS), plus regenerate (the annotate item went in Part 1, ADR-0032) |'],
		// §4.5: the form conventions, after the auth-pages bullet.
		[
			'- `(auth)` and `init`: centred `Card` with `Form` on the `color-bg-layout` surface.\n',
			'- `(auth)` and `init`: centred `Card` with `Form` on the `color-bg-layout` surface.\n' +
				'- Admin forms (Part 1, ADR-0032; the app drawer first): `layout="horizontal"` with `labelCol={{ xs: { span: 24 }, sm: { span: 8 } }}` and `wrapperCol={{ xs: { span: 24 }, sm: { span: 16 } }}`, so a label sits beside its field from `sm` and above it on a phone (antd Form `labelCol`, "basic" demo); a button row under the fields takes `wrapperCol={{ xs: { span: 24 }, sm: { offset: 8, span: 16 } }}`. `requiredMark` is the render function from `components/admin/apps/required-mark.tsx` (antd Form `requiredMark`, a function since 5.9.0): an asterisk on required fields and "(optional)" (`form.optional`) on the others.\n' +
				'- A provider\'s own fields and views come from the client registry (`components/provider-ui/`: `provider-form-section.tsx`, `ProviderChat`); neutral components never import `lib/providers/<id>/` or `components/provider-ui/<id>/` (`__tests__/provider-boundary.test.ts`).\n',
		],
		// Status: Part 1 before the "Next" line.
		[
			'- Next: B3 of the backend rework',
			'- Part 1 of the provider-hub programme (branch `feat/provider-core`; ADR-0032): apps organised by provider. The `apps` table with `provider`, `settings` and `secrets`; `lib/providers/` and `lib/http/`; the admin drawer in layout B (the provider first, the shared fields with tags and an icon upload, Dify\'s sections with Test connection), the Provider column and "Invalid settings" in the table, the gallery card\'s provider line and fallback icon, the chat page through `ProviderChat`; the sync, the annotations and the emoji icons removed; `@ant-design/icons` 6.3.4, one copy.\n' +
				'- Next: B3 of the backend rework',
		],
	],
	'docs/auth-gate.md': [
		// Line 17.
		[
			"- `lib/dify/route.ts`: `resolveDifyRoute()`, the first step of every `/api/dify/*` handler: `verifySession()` (401 envelope), then the app (404, 403 when disabled); `user` for Dify is the session's account id, never the email (ADR-0026). The annotation routes then check the role: list, update and delete need admin rights, create needs them unless the app enables annotations, and a refusal answers `forbiddenResponse()` (403 `forbidden`).",
			"- `lib/providers/route.ts`: `resolveAppRoute(params, provider)`, the shared guard (ADR-0032): `verifySession()` (401 envelope), the id through `z.uuid()`, then the app (404 `app_not_found` when it is missing, invisible, malformed or another provider's; 403 when disabled). `lib/providers/dify/route.ts`'s `resolveDifyRoute()`, the first step of every `/api/dify/*` handler, wraps it; `user` for Dify is the session's account id, never the email (ADR-0026). No Dify route checks a role since the annotation routes went (ADR-0032).",
		],
		// Line 28.
		['-- app/api/dify lib/dify\n', '-- app/api/dify lib/providers lib/http\n'],
		// Line 33.
		[
			'through `resolveDifyRoute` (`lib/dify/route.ts`) and sets `user` from it',
			'through `resolveDifyRoute` (`lib/providers/dify/route.ts`, on the shared guard `lib/providers/route.ts`) and sets `user` from it',
		],
		// Line 34.
		['re-implemented in `app/api/dify/**` and `lib/dify/`,', 're-implemented in `app/api/dify/**` and `lib/providers/dify/`,'],
		// Line 43.
		['the users page\'s "Dify user ID" column', 'the users page\'s "User ID" column'],
	],
}
for (const [file, edits] of Object.entries(EDITS)) {
	let text = readFileSync(file, 'utf8')
	for (const [from, to] of edits) {
		const count = text.split(from).length - 1
		if (count !== 1) throw new Error(`${file}: ${count} matches for: ${from.slice(0, 80)}`)
		text = text.replace(from, () => to)
	}
	writeFileSync(file, text)
	console.log(`${file}: ${edits.length} edits`)
}
JS
```

Expected: `docs/frontend-conventions.md: 4 edits` and `docs/auth-gate.md: 5 edits`.

- [ ] **Step 7: Read the diff**

Run: `git diff --stat` Expected: the seven files of Steps 3, 4 and 6 (`docs/auth-gate.md`, `docs/frontend-conventions.md`, `docs/decisions/README.md` and the four ADRs) and no other; ADR-0032 is untracked (`git status --short` shows it with `??`).

Run: `git diff -- docs/auth-gate.md docs/frontend-conventions.md` and read each hunk against Step 6: every hunk is one of the listed replacements, and nothing else moved.

- [ ] **Step 8: Check the paths the records name**

Every path the new text names exists on the branch:

```bash
for p in lib/http/errors.ts lib/http/response.ts lib/http/parse.ts lib/http/browser.ts \
  lib/providers/ids.ts lib/providers/schemas.ts lib/providers/registry.ts lib/providers/route.ts lib/providers/connection.ts \
  lib/providers/dify/schema.ts lib/providers/dify/schemas.ts lib/providers/dify/route.ts lib/providers/dify/provider.ts \
  lib/providers/dify/test-connection.ts lib/providers/dify/browser.ts lib/providers/dify/client.ts lib/providers/dify/errors.ts \
  lib/providers/dify/remote-file.ts lib/settings/image-rules.ts \
  components/provider-ui/registry.tsx components/provider-ui/provider-chat.tsx components/provider-ui/provider-form-section.tsx \
  components/admin/apps/required-mark.tsx __tests__/provider-boundary.test.ts \
  __tests__/db/apps.db.test.ts __tests__/db/apps-migration.db.test.ts; do test -e "$p" || echo "missing: $p"; done
find app/api/dify -name route.ts | wc -l
```

Expected: no `missing:` line, then `23`.

- [ ] **Step 9: Run Step 1's search again**

```bash
git grep -n -o -E "lib/dify\b|dify_apps|[Aa]nnotation[a-z]*|Dify user ID|two \`@ant-design/icons\` majors|encrypting the Dify API keys" -- docs/auth-gate.md docs/frontend-conventions.md
```

Expected, and nothing else (each a deliberate mention: history, or the removal itself): `docs/auth-gate.md` line 17 (`annotation`, "since the annotation routes went") and line 34 (`lib/dify`, upstream's old `lib/dify-client.ts`); `docs/frontend-conventions.md` line 7 (`lib/dify`, "since B1"), line 95 (three times) and line 99 (three times), the sub-project 3 and B1 status entries, and line 101 (`annotations`, Part 1's own entry). `.cii-assessment.md` is Step 11's.

- [ ] **Step 10: Format check and commit**

Run: `pnpm exec oxfmt --check docs/auth-gate.md docs/frontend-conventions.md docs/decisions/README.md docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md docs/decisions/0027-gate-apps-by-groups-and-grants-and-deactivate-accounts-with-two-markers.md docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md` Expected: clean. If it is not, run `pnpm exec oxfmt <file>` on the files it names and read the diff: a Markdown table it realigns is fine; a changed word is not.

```bash
git add docs/auth-gate.md docs/frontend-conventions.md docs/decisions/README.md \
  docs/decisions/0023-build-the-dify-layer-as-one-route-per-operation.md \
  docs/decisions/0026-use-the-accounts-permanent-id-as-the-dify-end-user.md \
  docs/decisions/0027-gate-apps-by-groups-and-grants-and-deactivate-accounts-with-two-markers.md \
  docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md \
  docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md
git commit -m "docs: record apps organised by provider (ADR-0032)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

- [ ] **Step 11: Re-check `.cii-assessment.md` (AGENTS.md) and commit it on its own**

Read the 35 rows against the branch. Part 1 changes no row's status; it changes the evidence of #19, #20, #25, #26 and #32. Read the counts first (`pnpm test:db` and `pnpm test:e2e` never run at once; this step runs neither suite's e2e):

```bash
pnpm test 2>&1 | tail -6
pnpm test:db 2>&1 | tail -6
ls e2e/*.spec.ts | wc -l
```

From the summaries, take the unit tests and test files ("Tests" and "Test Files" of `pnpm test`), the database tests and files (the same two lines of `pnpm test:db`) and the spec count, and pass them to the script (the numbers below are examples; use the printed ones):

```bash
UNIT_TESTS=1850 UNIT_FILES=150 DB_TESTS=45 DB_FILES=7 SPECS=38 TODAY=$(date +%F) node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'

const env = name => {
	const value = process.env[name]
	if (!value || !/^[\d-]+$/.test(value)) throw new Error(`set ${name}`)
	return value
}
const [unitTests, unitFiles, dbTests, dbFiles, specs, today] = ['UNIT_TESTS', 'UNIT_FILES', 'DB_TESTS', 'DB_FILES', 'SPECS', 'TODAY'].map(env)
const file = '.cii-assessment.md'
let text = readFileSync(file, 'utf8')
const EDITS = [
	['**最后更新**: 2026-10-12', `**最后更新**: ${today}`],
	// #19
	['vitest 单元测试（1808 个，146 个测试文件', `vitest 单元测试（${unitTests} 个，${unitFiles} 个测试文件`],
	['（`pnpm test:db`，5 个测试文件、27 个测试', `（\`pnpm test:db\`，${dbFiles} 个测试文件、${dbTests} 个测试`],
	['含应用增删改 `admin-apps.spec.ts`', '含应用增删改、提供方筛选、测试连接与图标上传 `admin-apps.spec.ts`'],
	['用户增删改、角色等级与 Dify 用户 ID `admin-users.spec.ts`', '用户增删改、角色等级与用户 ID `admin-users.spec.ts`'],
	// #20
	['1808 个单元测试分布在 146 个测试文件，另有 38 个 Playwright 端到端测试文件', `${unitTests} 个单元测试分布在 ${unitFiles} 个测试文件，另有 ${specs} 个 Playwright 端到端测试文件`],
	// #25
	[
		'Dify 只由服务端客户端 `lib/dify/client.ts` 调用，数据访问层 `lib/data/apps.ts` 返回的 DTO 不含密钥（ADR-0023）；',
		'Dify 只由服务端客户端 `lib/providers/dify/client.ts` 调用，数据访问层 `lib/data/apps.ts` 返回的 DTO 不含密钥（ADR-0023）；各提供方的密钥单独存放在 `secrets` 文档中、只写不读：任何 DTO 与日志都不含密钥，管理员只看到每个密钥是否已设置，留空即保留原值（ADR-0032）；',
	],
	// #26
	[
		'图片格式按解码结果而非浏览器声明的类型判断（ADR-0030）',
		'图片格式按解码结果而非浏览器声明的类型判断（ADR-0030），应用图标同样经该流程处理；应用的提供方设置与密钥文档在每次写入和读取时都经该提供方的 zod 模式校验，无法解析的记录不会以半解析的形式返回（ADR-0032）',
	],
	['（`lib/dify/schemas.ts` 按操作白名单', '（`lib/providers/dify/schemas.ts` 按操作白名单'],
	// #32
	['API key 与 Dify 主机都不进入浏览器（DTO 不含密钥；', 'API key 与 Dify 主机都不进入浏览器（DTO 不含密钥，管理员只看到密钥是否已设置，ADR-0032；'],
	// The change log, first row under the header.
	[
		'| 日期 | 版本 | 通过项 | 变更说明 |\n| --- | --- | --- | --- |\n',
		'| 日期 | 版本 | 通过项 | 变更说明 |\n| --- | --- | --- | --- |\n' +
			`| ${today} | v0.8.1 | 24/35 | 应用按提供方组织（ADR-0032）：#19、#20 证据更新（vitest 1808 → ${unitTests} 个，146 → ${unitFiles} 个测试文件；数据库测试 27 → ${dbTests} 个，5 → ${dbFiles} 个测试文件；端到端测试文件 38 → ${specs}；#20 仍为 ❌）；#25 证据更新（提供方密钥只写不读，DTO 只给出是否已设置）；#26 证据更新（提供方设置与密钥文档按提供方的 zod 模式在读写时校验，应用图标经图片处理流程）；#32 证据更新（管理员只看到密钥是否已设置）；条目状态均未改变 |\n`,
	],
]
for (const [from, to] of EDITS) {
	const count = text.split(from).length - 1
	if (count !== 1) throw new Error(`${count} matches for: ${from.slice(0, 60)}`)
	text = text.replace(from, () => to)
}
writeFileSync(file, text)
console.log(`${EDITS.length} edits`)
JS
```

Expected: `11 edits`. Then `git grep -c "lib/dify/" -- .cii-assessment.md` prints nothing (no line names the old path), and `git diff -- .cii-assessment.md` shows the eleven replacements only; the summary stays 24/35.

```bash
pnpm exec oxfmt --check .cii-assessment.md
git add .cii-assessment.md
git commit -m "docs: update CII assessment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 15: Final verification and the Docker gate

**Goal:** Every whole-branch gate exits clean (Steps 1–6), and only after the owner's captured go-ahead the local stack is backed up (the `part0` image tag and a mode-600 dump with 12 tables), the migration is rehearsed on `hub_copy` with counts equal to Step 8's, and the rebuild logs `Database migration complete` once with RestartCount 0, four migration rows and Step 13's counts equal to the rehearsal's.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

Spec §9 and §11. Every gate in `CLAUDE.md` on the whole branch, then the Docker gate on the owner's running stack (`ai-app-hub-local`, `docker-compose.local.yml`, port 5300, PostgreSQL on 127.0.0.1:5432). No earlier task touches that stack, and this one does so only after the owner's word (Step 7): the app is taken down so nothing writes, the old image is kept under a second tag and the database is dumped (always), the dump is restored into a copy and the three migrations are rehearsed on it (spec §2.4: "tested on a copy of the local database before it runs on the real one"), then the rebuild, whose entrypoint migrates the real one. Step 15 is the written way back (restore the dump, start the old image), run only on the owner's word.

**Files:** none changed in the repository, except Step 16 (the acceptance), which runs only on the owner's word after their check. Outside it: the backup `~/ai-app-hub-backups/local-before-part1.sql` (Step 9) and the image tag `ai-app-hub-local-app:part0` (Step 8), kept until the owner lets them go.

**Acceptance Criteria:**

- [ ] Steps 1 to 6 are green on the whole branch: tsc, oxlint, oxfmt, `npx -y @ant-design/cli lint ./ --format json` (`"summary": { "total": 0, …}`), `pnpm i18n:lint && pnpm i18n:status` ("No issues found.", zh and ar at 100%), both Step 2 greps with no output, `pnpm test`, `pnpm test:db` (including `apps.db.test.ts` and `apps-migration.db.test.ts`), `pnpm test:ldap`, and `pnpm test:e2e` with 0 failed on desktop-light, desktop-dark and mobile-light.
- [ ] The owner's explicit go-ahead to Step 7's message is captured before Step 8; nothing touches the owner's stack (`ai-app-hub-local`) before it.
- [ ] The old image is tagged `ai-app-hub-local-app:part0` (never overwritten), and the dump `~/ai-app-hub-backups/local-before-part1.sql` exists with mode `600`, a size above zero and `12` `CREATE TABLE` lines (`stat -c '%a %s'` and `grep -c '^CREATE TABLE'`).
- [ ] The rehearsal on `hub_copy` restores the dump with no `ERROR`, applies the `*_apps_expand`, `*_apps_data` and `*_apps_contract` migrations in one transaction with no `ERROR`, and its apps and grants counts equal Step 8's (every app `provider` `dify`, `has_key` `t`; 'without a type' equals 'apps without a mode'); `hub_copy` is then dropped.
- [ ] After the rebuild, `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` prints `1`, `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` prints `0`, and `drizzle.__drizzle_migrations` lists four rows: `<14 digits>_baseline`, `_apps_expand`, `_apps_data`, `_apps_contract`.
- [ ] Step 13's four counts (apps, group grants, user grants, without a type) equal the rehearsal's and Step 8's.
- [ ] Step 14's signed-out checks give: `/api/health` 200; `/apps` 307 to `http://localhost:5300/login?callbackUrl=%2Fapps`; `/api/dify/<app id>/parameters`, `/api/client/apps`, `/api/users`, `/api/init/status` 401 with `{"code":"unauthorized",…}`; `/api/branding/logo` 404 with `{"code":"not_found",…}`; `/init` 307 to `http://localhost:5300/login`; `grep -c 'href="/forgot-password"'` on `/login` gives `0`; `grep -c 'id="antd-cssinjs"'` gives `1`.

**Verify:** `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete" && docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` → `1` then `0`

**Interfaces:**

- Consumes: everything above. Nothing in `.env` or `.env.development.local` is read or printed: inside the PostgreSQL container, `psql` reads the database's name and user from the container's own `POSTGRES_*` variables (`sh -c '… "$POSTGRES_USER" …'`), so no value reaches this session's output.

- [ ] **Step 1: Static gates on the whole tree**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: no output.

Run: `pnpm exec oxlint $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD -- '*.ts' '*.tsx')` Expected: no findings.

Run: `pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AMR fork/overhaul...HEAD -- ':!db/migrations')` Expected: no findings. (`db/migrations/**` stays as drizzle-kit wrote it and lint-staged formatted it on commit, as in Task 11.)

Run: `npx -y @ant-design/cli lint ./ --format json` Expected: `"summary": { "total": 0, …}`, the ratchet in `docs/frontend-conventions.md` (0 findings since sub-project 3).

Run: `pnpm i18n:lint && pnpm i18n:status` Expected: "No issues found." and both `zh` and `ar` at 100% (spec §7's i18next-cli check; `docs/i18n-maintenance.md` rules out `i18next-cli extract` and `sync`, which rewrite the files).

- [ ] **Step 2: The provider boundary (spec §11)**

Run: `git grep -lE "from '@/lib/providers/dify" -- app components hooks lib db ':!lib/providers' ':!components/provider-ui' ':!components/chat' ':!app/api/dify'` Expected: no output. `__tests__/provider-boundary.test.ts` (Task 13) pins the same rule, relative imports included; this is the spec's grep for the final review.

Run: `git grep -nE "lib/dify['/]|\bdifyApps\b|annotationEnabled|syncApp|difyErrorResponse|difyJson|DifyRequestError|readDifyError|dify_unreachable" -- app components hooks lib db e2e __tests__ ':!db/migrations'` Expected: no output: Tasks 2, 3, 4 and 11 removed every one of these names (the query texts in `__tests__/action-failure.test.ts` and `__tests__/http-errors.test.ts` say `dify_apps`, which this pattern does not look for).

- [ ] **Step 3: The unit suite**

Run: `pnpm test` Expected: PASS (the run decides the count; Task 14 recorded it in `.cii-assessment.md`).

- [ ] **Step 4: The live database suite**

Run: `pnpm test:db` Expected: PASS, every file, `apps.db.test.ts` and `apps-migration.db.test.ts` among them; the teardown stops the e2e PostgreSQL.

- [ ] **Step 5: The directory suite**

Run: `pnpm test:ldap` Expected: PASS. (Task 2 renamed the helpers that `app/api/directory/groups/route.ts` and the directory code import.)

- [ ] **Step 6: The e2e suite on an empty PostgreSQL**

Stop `pnpm dev` if it runs (Next 16 allows one `next dev` per checkout), and make sure `pnpm test:db` is not running. Run: `docker compose -f docker-compose.e2e.yml --profile ldap down -v && pnpm test:e2e` Expected: 0 failed on `desktop-light`, `desktop-dark` and `mobile-light` (about 25 minutes). The setup project seeds the stub apps as `apps` rows with their documents; Tasks 11 to 13's cases run among the others.

Then free the memory the Docker build needs (this machine has about 5 GB): `docker compose -f docker-compose.e2e.yml --profile ldap down`.

- [ ] **Step 7: Stop and ask the owner before touching their stack**

Nothing so far has touched the owner's stack, and nothing does before their word. Send the owner this and wait for it:

> Part 1 passes every gate (tsc, oxlint, oxfmt, the antd lint, the i18next checks, `pnpm test`, `pnpm test:db`, `pnpm test:ldap`, the e2e suite on three projects). The Docker gate is next, on your local stack. The app is down for a few minutes from step 1 until step 5; PostgreSQL stays up throughout.
>
> 1. I stop and remove the app container (so nothing writes while I count and back up), then count your apps and grants, and the apps that will show "Invalid settings" or exceed the new limits.
> 2. A backup, always: the old image is kept as `ai-app-hub-local-app:part0`, and the database is dumped to `~/ai-app-hub-backups/local-before-part1.sql` (mode 600, outside the repo; it holds the API keys and password hashes in plain text, and I never print it).
> 3. A rehearsal: the dump restored into a copy (`hub_copy`, in the same PostgreSQL container), which also proves the dump restores; the three new migrations applied to the copy; its apps listed (names, providers, types, API bases; never the keys); the copy dropped. If anything fails, the old app comes back as it was and I stop.
> 4. The rebuild from this branch; its entrypoint applies the same migrations to your database: `dify_apps` becomes `apps`, keeping every app and grant.
> 5. The checks.
>
> The migration is one-way: the old image cannot read `apps`. If you want Part 0 back afterwards, Step 15 of the plan restores the dump and the old image (or rebuilds it from `fork/overhaul`); it runs only on your word. Restoring the dump drops everything written after the backup: apps, accounts, groups, grants or settings added or changed during your check. May I go ahead?

- [ ] **Step 8: Take the app down, then count (after the owner's word)**

```bash
docker compose -f docker-compose.local.yml ps --format '{{.Name}} {{.Status}}'
```

Expected: `ai-app-hub-local-app` and `ai-app-hub-local-postgres` running, the second `(healthy)`. If PostgreSQL is not running, stop and tell the owner instead of starting it.

Keep the old image under a second tag before anything replaces it (Compose tags a built service's image `<project>-<service>`, `docs/reference/compose_build.md`: "by default as `project-service`"), then take the app container down (this machine's memory, and no writes while the counts and the dump run):

```bash
if docker image inspect ai-app-hub-local-app:part0 >/dev/null 2>&1; then
  echo 'ai-app-hub-local-app:part0 already exists: stop and ask the owner'
else
  docker image tag ai-app-hub-local-app:latest ai-app-hub-local-app:part0 &&
    docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
fi
```

Expected: no "already exists" line; the app container stopped and removed. The tag is never overwritten, as the dump never is (Step 9): a `:part0` from an earlier attempt may be the only copy of the old image, and after Step 11 `:latest` is the new one. If the line prints, nothing was changed; stop and ask the owner.

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT 'apps ' || count(*) FROM dify_apps;
SELECT 'group grants ' || count(*) FROM app_group_grants;
SELECT 'user grants ' || count(*) FROM app_user_grants;
SELECT 'apps without a mode ' || count(*) FROM dify_apps WHERE mode IS NULL;
SELECT 'apps with an unknown mode ' || count(*) FROM dify_apps WHERE mode NOT IN ('chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion', 'agent');
SELECT 'apps over the new limits ' || count(*) FROM dify_apps WHERE length(name) > 255 OR length(coalesce(description, '')) > 2000 OR (jsonb_typeof(tags) = 'array' AND (jsonb_array_length(tags) > 10 OR EXISTS (SELECT 1 FROM jsonb_array_elements(tags) AS tag WHERE jsonb_typeof(tag) <> 'string' OR length(btrim(tag #>> '{}')) NOT BETWEEN 1 AND 32)));
SQL
```

Expected: six lines of counts (psql reads standard input, so the queries never pass through `sh`; measured while planning on a Part 0 database with one app of each kind). Keep them for Steps 10 and 13. "Without a mode" and "with an unknown mode" are the apps that will show "Invalid settings" until the owner repairs them (Review Focus 1; `APP_MODES` in `lib/providers/dify/types/app.ts` is the list). "Over the new limits" are apps whose migrated name, description or tags break spec §2.1's limits (a migrated tag list that is not an array becomes `[]`): they show as usual, but their Edit is refused until the admin trims those fields. Tell the owner these numbers with Step 14's report.

- [ ] **Step 9: The backup (always)**

```bash
install -d -m 700 "$HOME/ai-app-hub-backups"
(umask 077 && set -o noclobber && docker compose -f docker-compose.local.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$HOME/ai-app-hub-backups/local-before-part1.sql")
stat -c '%a %s' "$HOME/ai-app-hub-backups/local-before-part1.sql"
grep -c '^CREATE TABLE' "$HOME/ai-app-hub-backups/local-before-part1.sql"
docker image inspect -f '{{.Id}}' ai-app-hub-local-app:part0
```

Expected: `600` and a size above zero; `12` (the baseline's eleven tables and drizzle's migration log, `drizzle.__drizzle_migrations`); the old image's id. `noclobber` makes the redirect fail if the file exists: a backup from an earlier attempt is never overwritten; stop and ask the owner what to do with it. If the mode, the size, the `12` or the image id is not as expected, bring the old app back as Step 10's failure path does and report; the database is untouched. Never `cat`, `head` or `grep` lines out of the dump: it holds the API keys and password hashes.

- [ ] **Step 10: The rehearsal, on the dump restored into a copy**

Restore the dump into a fresh copy (PostgreSQL 18 "SQL Dump", "Restoring the Dump": create the database from `template0`, then `psql` with `ON_ERROR_STOP` and `--single-transaction`). This also proves the backup restores:

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists hub_copy && createdb -U "$POSTGRES_USER" -T template0 hub_copy'
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d hub_copy' < "$HOME/ai-app-hub-backups/local-before-part1.sql"
```

Expected: on a first run, `NOTICE:  database "hub_copy" does not exist, skipping` from `dropdb --if-exists`; then a `set_config` result and a `setval` result (drizzle's migration log has a sequence), and no `ERROR`.

Apply the three migrations to the copy, in order, in one transaction, as the migrator does (DV 1d):

```bash
cat db/migrations/*_apps_expand/migration.sql db/migrations/*_apps_data/migration.sql db/migrations/*_apps_contract/migration.sql \
  | docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d hub_copy'
```

Expected: `ALTER TABLE` lines; `UPDATE <n>` with Step 8's apps count (the documents), then `UPDATE <m>` with the number of apps without a complete stored image (the icon columns cleared together); more `ALTER TABLE` lines; no `ERROR` (measured while planning on a copy of a Part 0 database with an emoji-icon app, an image-icon app, an app without a mode and grants).

Read the copy:

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d hub_copy' <<'SQL'
SELECT id, name, provider, settings->>'appType' AS type, settings->>'apiBase' AS base, secrets ? 'apiKey' AS has_key, icon_image IS NOT NULL AS has_icon, icon_mime FROM apps ORDER BY name;
SELECT 'apps ' || count(*) FROM apps;
SELECT 'group grants ' || count(*) FROM app_group_grants;
SELECT 'user grants ' || count(*) FROM app_user_grants;
SELECT 'without a type ' || count(*) FROM apps WHERE settings->>'appType' IS NULL;
SQL
```

Expected: every app with `provider` `dify`, its type and base as before, `has_key` `t` for each; the apps and grants counts equal Step 8's; "without a type" equal to Step 8's "apps without a mode" (an unknown mode keeps its text as the type). A migrated image keeps its stored type (`icon_mime`; an SVG Dify's `/site` gave is possible), which the icon route serves with `nosniff` and its sandbox CSP as before. Never select `secrets` itself.

Drop the copy:

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" hub_copy'
```

Expected: no output.

If any command of this step failed: drop the copy (the command above, with `--if-exists`), bring the old app back unchanged (`docker compose -f docker-compose.local.yml up -d --no-build app`; Compose `up --no-build`: "Don't build an image", so it starts `ai-app-hub-local-app:latest`, still the old image), check `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` → `200`, and report the error to the owner. The real database is untouched.

- [ ] **Step 11: Rebuild the app container (CLAUDE.md "Docker stack")**

Never build this folder's image while the `fork/main` folder builds its own. The app container is already down (Step 8):

```bash
docker compose -f docker-compose.local.yml up -d --build app
```

Expected: about two minutes (80 s of it `next build`). PostgreSQL and its volume stay up. If the build is killed for memory, do not restart it unprompted (CLAUDE.md); bring the old app back as Step 10's failure path does and report it.

- [ ] **Step 12: The migration on the real database**

Run each:

- `docker compose -f docker-compose.local.yml logs app | grep -c "Database migration complete"` Expected: `1`.
- `docker inspect -f '{{.RestartCount}}' ai-app-hub-local-app` Expected: `0`. (The migrator applies the three migrations in one transaction; a failure would leave the database as it was and show as a restart loop here. Then: Step 15.)
- `docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at"'` Expected: four lines, `<14 digits>_baseline`, `<14 digits>_apps_expand`, `<14 digits>_apps_data`, `<14 digits>_apps_contract`.

- [ ] **Step 13: The counts after the migration**

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT 'apps ' || count(*) FROM apps;
SELECT 'group grants ' || count(*) FROM app_group_grants;
SELECT 'user grants ' || count(*) FROM app_user_grants;
SELECT 'without a type ' || count(*) FROM apps WHERE settings->>'appType' IS NULL;
SQL
```

Expected: the same four numbers as the rehearsal's (Step 10). Nothing wrote between Step 8 and the rebuild, so they also equal Step 8's.

- [ ] **Step 14: The signed-out checks (CLAUDE.md's list), then the report**

Run each with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <url>` unless a body is named; `<app id>` is any id the copy listed in Step 10:

- `localhost:5300/api/health` → `200`.
- `localhost:5300/apps` → `307 http://localhost:5300/login?callbackUrl=%2Fapps`.
- `curl -s localhost:5300/api/dify/<app id>/parameters` → `401` with `{"code":"unauthorized",…}`; the same 401 envelope for `/api/client/apps`, `/api/users` and `/api/init/status` (the proxy denies unknown `/api/*` paths before routing).
- `curl -s localhost:5300/api/branding/logo` → `404` with `{"code":"not_found",…}` while no logo is stored (a 401 would mean the proxy's public list lost the route).
- `localhost:5300/init` → `307 http://localhost:5300/login` (the database is set up).
- `curl -s localhost:5300/login | grep -c 'href="/forgot-password"'` → `0` while SMTP is off.
- `curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'` → `1`.

Report every result above, Step 8's counts, the backup's path and Step 15 (the way back), then the checks left for the browser (signed in as the owner, at `http://localhost:5300`):

- App management: every existing app listed with "Dify · <type>" in the Provider column, the filter narrowing by provider and type, and the apps Step 8 counted without a mode or with an unknown one marked "Invalid settings"; Edit on one of those opens with Dify's defaults, the API key field blank, and saves once the type (and, if its key did not read, the key) is entered.
- Edit an existing app: the provider disabled, the key blank ("Leave blank to keep"); save with it blank, then chat with the app (the stored key still works).
- Test connection on that app: "Connected"; change the App type and test again: the type warning; type a wrong key: "The key was refused".
- Add app: the provider first, then the fields; upload a PNG, JPEG or WebP icon, save, then replace it and remove it on Edit (a default Remove button, as on the branding page); an SVG or an image over 512 KB is refused with a message.
- The gallery card: the icon (or the Dify fallback), the name, "Dify · <type>", the tags.
- The chat for each Dify type you use: as before, without the Annotate action.
- Open `http://localhost:5300/api/dify/<app id>/apps/annotations` signed in: 404 (spec §9's Docker gate check; signed out, the proxy answers 401 before routing).
- Users page: the "User ID" column with its copy button.

ADR-0032 stays `proposed` until the owner reports the check. The branch is pushed and the PR opened only on the owner's word (`gh pr create -R LovingCivilian/dify-app-hub --base fork/overhaul …`, the PR template, naming ADR-0032). The running record's entry for Part 1 follows the merge (Plan decision w). The backup and the `part0` image stay until the owner says they may go (`rm "$HOME/ai-app-hub-backups/local-before-part1.sql"`, `docker image rm ai-app-hub-local-app:part0`).

- [ ] **Step 15: The way back to Part 0 (only on the owner's word)**

Run only if the owner asks for Part 0 back (the check failed, or the migration restart-loops). It restores the database from Step 9's dump and starts the old image; nothing else of the stack changes. Everything written after the backup is lost: apps, accounts, groups, grants and settings added or changed since Step 9. Say so to the owner before step 2, and go on only on their word.

1. Take the app down: `docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app`.
2. Replace the database with the dump (PostgreSQL 18 "Restoring the Dump"; `dropdb` connects to the maintenance database, and no client is connected once the app is down):

```bash
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -T template0 "$POSTGRES_DB"'
docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$HOME/ai-app-hub-backups/local-before-part1.sql"
```

Expected: a `set_config` and a `setval` result, no `ERROR` (Step 10 ran the same restore into the copy). 3. Start the old image, either from the kept tag:

```bash
docker image tag ai-app-hub-local-app:part0 ai-app-hub-local-app:latest
docker compose -f docker-compose.local.yml up -d --no-build app
```

or, if that tag is gone, rebuilt from `fork/overhaul` (the working tree must be clean; `git status --short` prints nothing):

```bash
git switch fork/overhaul
docker compose -f docker-compose.local.yml up -d --build app
git switch feat/provider-core
```

4. Check: `curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health` → `200`; `docker compose -f docker-compose.local.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT name FROM drizzle.__drizzle_migrations"'` → one line, `<14 digits>_baseline`; `… -tAc "SELECT count(*) FROM dify_apps"` → Step 8's apps count. Report to the owner.

- [ ] **Step 16: The acceptance (only after the owner reports their check)**

With the owner's words at hand:

- `docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md`: line 2 `status: proposed` → `status: accepted`, and at the end of the file:

```markdown
### Note, <the day of the owner's check> (the owner's check; accepted)

The owner checked the branch on the local stack after the migration and reported: "<the owner's words>". With that last verification item done, the record is accepted.
```

where the two angle-bracket parts are the date and the owner's words, verbatim.

- `docs/decisions/README.md`: in the 0032 row, `| proposed |` → `| accepted |`.

```bash
pnpm exec oxfmt --check docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md docs/decisions/README.md
git add docs/decisions/0032-organise-apps-by-provider-with-a-shared-core-and-provider-modules.md docs/decisions/README.md
git commit -m "docs: accept ADR-0032 after the owner's check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

## Open questions

None. The owner answered the draft's two questions on 2026-10-12 (Plan decisions af and ag).

## Review findings not taken

- **A9 and B26** (the Dify client logs a network failure's whole cause; `toActionFailure` logs a provider error's message): both lines are inherited and recorded. ADR-0023 keeps the cause in the server log on purpose (the browser gets the fixed "Dify is unreachable."; a B1 controller ruling, pinned by `__tests__/dify-client.test.ts`), and the cause holds the typed URL, never the key, which travels in a header. The Global Constraints now name both lines as the exceptions.
- **B27** (the admin DTO tested both as a unit and live): the two layers can fail apart. The unit cases pin the mapper without a database (the exact shape, each app's grants, the log line); the live cases pin that the reads select the columns the mapper needs, which a wrong column list breaks while every unit case still passes.
