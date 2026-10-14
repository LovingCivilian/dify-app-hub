---
status: accepted
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
| `lib/providers/registry.ts` | `PROVIDERS` (`satisfies` one definition per id; each entry spreads its `PROVIDER_SCHEMAS` entry, the schemas, `secretsUpdateSchema` and the defaults, and adds) `testConnection(settings, secrets)`, and what of the settings the chat DTO, the gallery DTO and the admin DTO's `secretsSet` carry; an id outside `PROVIDER_IDS` fails closed: neutral code narrows with `isProviderId` before indexing `PROVIDERS` (DV 11) | server only |
| `lib/providers/route.ts` | `resolveAppRoute(params, provider)`: session, `z.uuid()` on the id, `getAppAccess` (visibility), enabled, provider match; 401, 404 `app_not_found` (unknown, invisible, malformed or another provider's), 403 `app_disabled` | server only |
| `lib/providers/dify/` | Part 0's `lib/dify/`, moved: the client, the types, the request schemas, the remote-file guard, the browser client, `route.ts` (`resolveDifyRoute`, on the shared guard), `provider.ts` (the definition), `test-connection.ts` | the client, the route and the test server only; the browser client in the browser |
| `lib/http/` | the envelope and request helpers under neutral names: `errorResponse`, `forbiddenResponse`, `errorResponseFrom`, `ProviderError` (`DifyError` extends it), `jsonNoStore`, the `parse*` helpers, `RequestError` | as before |
| `components/provider-ui/` | the client registry: `PROVIDER_UI` (label key, fallback icon, type names), `ProviderChat` (one switch, `satisfies never` on the provider), `provider-form-section.tsx`, `dify/` | client |

Neutral code imports `lib/providers/dify` only through the registry, the guard and the provider UI; `__tests__/provider-boundary.test.ts` pins it. `components/chat/**` stays Dify's chat until Part 3 and imports the Dify browser client from its new path. The 23 Dify route files keep their paths and their calls to `resolveDifyRoute`.

### The data layer (`lib/data/apps.ts`)

- The documents are parsed on every write and on every read. A row that fails is logged as `{ appId, code }` and never returned half-typed: a user gets 404 and the gallery leaves it out; the admin DTO carries `invalid: true` and no settings, the table shows `Tag color="error"` "Invalid settings", and Edit opens on the provider's defaults.
- The reads that build a user's DTO never select `secrets`; only the guard's `getAppAccess`, Test connection's `getStoredSecrets` (for a secret field left blank), the admin writes and the admin list (`listAdminApps`, for `secretsSet`) read them.
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
- §3's `ProviderDefinition` declares `testConnection` and the DTO mappers `chatFields`, `summaryFields` and `secretsSet` only; each `PROVIDERS` entry spreads its `PROVIDER_SCHEMAS` entry (the schemas, `secretsUpdateSchema` and the defaults, in `lib/providers/schemas.ts`) and adds those, so the neutral data layer builds every DTO without importing a provider (§11).
- §10 asks for `CLAUDE.md` updates: `AGENTS.md` is the guide (`CLAUDE.md` imports it) and holds rules and a folder-level layout only, so its Layout gains `lib/providers/`, `lib/http/` and `components/provider-ui/`, while the follow-ups go to the GitHub issues #44, #45 and #49 (posted after the merge) and the decisions to this ADR.
- §9's Docker-gate check "`/api/dify/<id>/apps/annotations` signed in answering 404" is pinned by the e2e `roles` spec (a signed-in session against the stub) and the owner's browser check, since a signed-in curl needs the owner's credentials.

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

### Note, 2026-10-14 (the owner's check; accepted)

The owner checked the branch on the local stack after the migration and reported: "everything is working". With that last verification item done, the record is accepted.

Note, 2026-10-14 (Part 2a, the second provider): `'agui'` followed this record's checklist ([ADR-0034](0034-add-ag-ui-agents-as-a-provider.md)): the id, the migration that replaces `apps_provider_check`, the schemas and defaults, the server definition, `PROVIDER_UI.agui` (`RobotOutlined`, "AG-UI agent", no app types), its form section, its `ProviderChat` case and the `provider.agui` key. The registry changed with it: `testConnection` takes the caller (the admin, for the JWT's `sub`), `chatFields` and `summaryFields` are typed per provider instead of `object`, and a definition carries `hubHistory` and an optional `chat` adapter ([ADR-0033](0033-use-ag-ui-as-the-hubs-chat-protocol-with-a-hub-side-conversation-store.md)). Issue #62's items for the second provider are done: the typed fields, the client registry's app-type cast (Dify's lookup is typed), and M5 (an app whose settings read but whose secrets do not opens Edit on its stored settings).
