# Provider hub brainstorm (started 2026-10-11)

This is the running record of the brainstorm. Each decision is written here as soon as the owner makes it. If the session is lost, a new session starts from this file, from the specs it names, and from the research notes beside it.

## The owner's request (2026-10-11, in their words, condensed)

The hub has been built around Dify: its name, its routes, its design and the chat. It should become a hub for all of the company's AI apps and support many providers.

Adding an app first asks what type of app it is: a Dify app, an AG-UI app, or another provider later. The admin then sees the options that apply to that provider.

For now the work is the AG-UI provider, plus a backend reworked into modules that support several providers.

Frontend: before any component is chosen, the owner gets a list of every component that can render each UI element, with its variants, and picks one. Memory: `owner-picks-ui-components`.

Rules that apply throughout:

- ADR-0002: documented approaches only, checked against current docs.
- Reference projects are consulted for architectural decisions the docs leave open.

## Understanding (stated by Claude, not corrected by the owner)

- Dify apps keep working as they do today.
- Access grants, groups, the gallery and the admin table apply to every provider.
- AG-UI agents (Pydantic AI first) are the owner's own services on the same Docker network. They are reached only by the hub's server, behind the hub's login.
- Whether to rename "Dify App Hub" is a separate question, still to be asked.
- This work is on `fork/overhaul` only.

## Decisions

1. **Two specs and two plans, built in order** (owner, 2026-10-11: "split them").
   - **Part 1, the provider-neutral core.** The app record gets a provider type and per-provider settings. Each provider has its own module on the server. "Add app" asks for the provider first, and the gallery and chat page pick the provider's view. Dify becomes provider #1, with no change in behaviour.
   - **Part 2, the AG-UI provider.** Its settings, the server proxy for runs, and a chat on Ant Design X for AG-UI events. Probably also conversation storage on the hub.
   - The AG-UI spike runs early so that its result can shape Part 1's provider interface.
   - Each part must be resumable from these files alone.

2. **Later providers in view: OpenAI-compatible model APIs** such as LiteLLM, vLLM, Ollama and Azure OpenAI (owner, 2026-10-11). Workflow builders and vendor agent services are not in view.
   - Consequence: two providers will need the hub to store conversations, AG-UI and OpenAI-compatible APIs. So the hub's conversation store is designed provider-neutral.
   - It is built in Part 2, because Dify keeps its own history and nothing in Part 1 would use it.
   - The provider interface has to cover two cases: history kept by the provider (Dify) and history kept by the hub (AG-UI, OpenAI-compatible).

3. **Rename everything now** (owner, 2026-10-11). This covers the code names, the built-in brand, the package, the Docker images and compose projects, the GitHub repo and the local folder names. An earlier answer of "keep all names" was a mis-click; the owner withdrew it.
   - **Code names.** Every neutral concept loses "dify": `dify_apps` → `apps`, the shared helpers move out of `lib/dify`, and "Dify user ID" becomes "User ID". Dify-only code keeps the Dify name.
   - **The Docker volume.** Renaming a compose project changes its default volume names. The MySQL volume has to be carried over, or named explicitly, or the local data is orphaned. The production server is affected the same way.
   - **The GitHub repo** is shared by both product lines. Renaming it renames it for `fork/main` too; GitHub redirects the old URL. `fork/main`'s content stays upstream-shaped (ADR-0019), so none of the renames inside the code apply there.
   - **The local folders** (`~/repos/dify-app-hub`, `~/repos/dify-app-hub-main`). Claude Code's memory directory is keyed by the folder path (`~/.claude/projects/-home-madany-repos-dify-app-hub/`), so it has to be moved along with the folder. The folders must not be renamed while a session runs in them. This step is done between sessions with written steps.
   - **Housekeeping.** This overlaps the postponed housekeeping work (memory `repo-housekeeping`). Only the renames are taken from it.

4. **The new name is "AI App Hub"** (owner, 2026-10-11). Its kebab-case form, `ai-app-hub`, is used for the repo, the package, the Docker images, the compose projects and the local folders.

5. **Name, description, tags and icon are admin-owned for every provider, and the Dify sync is removed** (owner, 2026-10-11). The form always has these fields, and they are editable. Saving no longer calls Dify, and the "Sync app info" action and its code go (`fetchDifyProfile`, `iconColumnsFrom`, `syncApp`).
   - Existing rows keep the values and icons that were synced last.
   - **Still open:** the Dify mode also came from `/info`. Will it be an admin field, with or without a "test connection" check? This goes into the Dify settings section of the design.

6. **The AG-UI spike opens Part 2** (owner, 2026-10-11). Part 1 is designed from the research, with two history models in the provider interface: history kept by the provider (Dify) and history kept by the hub (AG-UI, OpenAI-compatible). The spike answers the chat-UI questions before Part 2's spec is written:
   - `useXChat` against AG-UI runs;
   - what "stop" does;
   - the 0.x versus 1.0 streams.

   This revises decision 1's "spike early".

7. **The AG-UI provider follows the AG-UI spec and is universal, not specific to Pydantic AI** (owner, 2026-10-11: "the agui shouldn't be pydantic specific. it should follow the spec and be universal").
   - The hub is built and tested against the AG-UI 1.0 specification and the official `@ag-ui/client`/`@ag-ui/core`. It uses no framework-specific behaviour: no Pydantic AI interrupt-id formats, and no CopilotKit `/info`.
   - Pydantic AI is only the first agent tested against it. The spike and the e2e stub exercise at least one more agent framework or a spec-level stub, so nothing Pydantic-specific slips in.
   - Where frameworks differ on a point the spec leaves open (identity header, stop behaviour, 0.x streams), the hub takes the spec's side and records the gap.

8. **Provider secrets stay in plain text in Part 1. Encryption comes later, together with SMTP and LDAP** (owner, 2026-10-11).
   - Part 1 still keeps secrets apart from the other provider settings (a separate column or table), as the reference hubs do. The later encryption then touches only the secrets.
   - The form keeps secrets write-only: a blank field keeps the stored value.
   - The follow-up, "encrypting the Dify API keys with the settings key", widens to "encrypting provider secrets".

9. **The shape is a hybrid** (owner, 2026-10-11). Claude had offered A (provider modules, each with its own routes and chat) and B (one chat API with adapters). The owner chose neither and answered: "somewhere in between. shared chat api for shared components between them. which is gonna be most of them. and per provider specific things".
   - A shared chat API and shared chat components cover what providers have in common, which is most of it.
   - Each provider adds what is specific to it on top.
10. **The hub stores the message history for every provider, Dify included** (owner, 2026-10-11: "make all providers save messge history on the server. and then we will deal with each provider if we should sent it or not").
    - The hub's store is the source of truth for conversations and messages.
    - Whether a provider is sent that history is decided per provider: AG-UI must be; Dify uses its own `conversation_id`; OpenAI-compatible APIs must be.
    - This reverses decision 2's "built in Part 2". The store now serves Dify too, and Dify's chat moves onto the shared chat API.
    - It also absorbs the deferred message-metadata study (memory `message-metadata-store-study`).
    - **Still open:** the order of the parts after decisions 9 and 10; what happens to existing Dify conversations; the wire format of the shared API.

11. **AG-UI is the hub's own chat protocol for every provider** (owner, 2026-10-11; option 1 of 3, recommended).
    - **Server side.** The shared chat API streams AG-UI events to the browser for every app, and the hub stores messages in AG-UI's message shape. Each provider's server adapter speaks the provider's own API and emits AG-UI.
    - **AG-UI agents** are passed through. The hub still builds `RunAgentInput` itself.
    - **Dify** is translated on the server:
      - text and reasoning map one to one;
      - agent thoughts become tool calls;
      - workflow nodes become steps or activity;
      - human input becomes interrupts;
      - Dify-only extras become namespaced `CUSTOM` events, for example `dify:citations`.
    - **OpenAI-compatible APIs** are translated from their streamed chunks.
    - **Browser.** One chat data layer on Ant Design X: a custom `AbstractChatProvider` over AG-UI. Shared components render the common parts; provider components render the provider's custom events and use its extra routes (Dify annotations, audio, the workflow view).
    - **References:** TanStack AI streams AG-UI events between its own server and client. CopilotKit's runtime turns its backends into AG-UI for its frontend.
    - **Consequences:** the Dify chat is rebuilt, because its event folding moves from the browser to a server adapter. ADR-0017's "one `DifyChatProvider`" is superseded. Options not taken: the hub's own event format (home-made, against ADR-0002); native streams with a shared API only for the rest (two parsers per provider).

12. **Three parts under a charter, in the order core → AG-UI → Dify** (owner, 2026-10-11). This replaces decision 1's two parts.
    - **Charter** (written now): `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`. It holds the whole architecture and every decision.
    - **Part 1, the neutral core** (spec and plan now):
      - the renames;
      - the `apps` record: provider, settings, and secrets kept apart;
      - the registry;
      - "add app" with the provider picker;
      - admin-owned metadata, with the Dify sync removed;
      - the gallery and the chat page dispatch. The Dify chat is unchanged.
    - **Part 2, the shared chat on AG-UI plus the AG-UI provider.** It opens with the spike and gets its spec after the spike. It covers:
      - the hub's conversation and message store;
      - the shared chat API;
      - the browser's AG-UI chat provider on X;
      - the shared chat components;
      - AG-UI agents as the first provider on it.
    - **Part 3, Dify onto the shared chat** (spec after Part 2):
      - the Dify-to-AG-UI adapter;
      - Dify's custom events and extras;
      - Dify history saved on the hub;
      - the old Dify chat removed.

13. **The MySQL → PostgreSQL move comes first, as Part 0** (owner, 2026-10-11). Options not taken: between Parts 1 and 2; after the programme.
    - Part 0 gets its own spec, plan, ADR (superseding ADR-0004) and branch.
    - Parts 1 to 3 are then written for PostgreSQL directly, using `jsonb` for the provider settings and the message store.
    - Memory `postgres-move-planned` lists what has to be re-derived:
      - a case-insensitive unique email;
      - the single-owner guard as a partial unique index;
      - SQLSTATE codes in place of MySQL errno;
      - `rowCount`;
      - the e2e fixtures and compose files.

      It also lists the choices still open: an own container or the Postgres that Dify already uses, and `pg` or `postgres.js`.

    - Execution order: Part 0 → Part 1 → Part 2 → Part 3.

14. **Part 0 is a fresh start** (owner, 2026-10-11). No hub data, local or production, has to survive.
    - A new empty PostgreSQL database with a fresh baseline migration; first-run setup runs again; nothing is copied from MySQL.
    - This also removes the MySQL volume concern in decision 3: the renamed compose project starts with a new PostgreSQL volume.
15. **PostgreSQL runs in the hub's own container** (owner, 2026-10-11).
    - It is a service in the hub's local, e2e and production compose files, as MySQL is today.
    - It does not use Dify's PostgreSQL, so the hub's upgrades, backups and restarts stay independent of Dify.
16. **Part 0's design is approved** (owner, 2026-10-11: "yes").
    - **Goal.** PostgreSQL 18 (18.6 current; supported to 2030-11-14 per postgresql.org/support/versioning, checked 2026-10-11) in the hub's own container, from a fresh baseline. No other change in behaviour.
    - **Driver.** `pg` (node-postgres) through `drizzle-orm/node-postgres` with a `Pool`.
      - Drizzle's PostgreSQL docs support both drivers and note that `pg` allows per-query type parsers, while `postgres.js` uses prepared statements by default that "you may need to opt out of".
      - Drizzle's get-started guide uses `pg`.
      - `mysql2` is removed.
      - Drizzle is at `1.0.0-rc.3`.
    - **Schema port.** Every `db/schema/*.ts` moves from mysql-core to pg-core:
      - `datetime` → `timestamp with time zone` (to be cited from the PostgreSQL wiki's "Don't Do This");
      - `mediumblob` → `bytea`;
      - enums → a pgEnum or text with a CHECK, per Drizzle's docs;
      - foreign keys, cascades, CHECKs and composite primary keys are kept.

      One drizzle-kit baseline migration replaces the MySQL migrations, which are deleted (git history keeps them).

    - **Re-derivations:**
      - a unique index on `lower(email)`;
      - the single-owner guard as a partial unique index, replacing B2's gap lock;
      - SQLSTATE `23505` in `lib/data/db-errors.ts`;
      - SQLSTATE in the logs where MySQL errno is logged today;
      - `rowCount` in place of `affectedRows`;
      - the directory sync's slot claim, re-checked.
    - **Docker.** A `postgres:18` service with a named volume and a `pg_isready` healthcheck in the local, e2e and production compose files. The MySQL services are removed. The entrypoint still runs migrations. `fork/main`'s MySQL stack is untouched.
    - **The product rename moves from Part 1 into Part 0**, so the volumes change only once. It covers the built-in brand "AI App Hub", the package names, the Docker images, the compose projects (`ai-app-hub-local`, …) and the app description.
      - The code renames (`dify_apps` → `apps`, the shared helpers out of `lib/dify`) stay in Part 1, with the reshape of the record.
      - The GitHub repo and the local folders are renamed after Part 0 merges, between sessions, with written steps, including moving Claude Code's memory directory.
    - **Records.** An ADR superseding ADR-0004; a dated note for the rename in the same PR.
    - **Testing.** Unit tests for the error mapping and the guards; the full e2e suite on a throwaway PostgreSQL; `pnpm test:ldap`; the Docker gate with `CLAUDE.md`'s curl checks.

17. **Provider settings: a provider column plus `jsonb`** (owner, 2026-10-11; option A of 3).
    - **The `apps` row** keeps the neutral columns: name, description, tags, icon, enabled, access mode and timestamps. It adds:
      - `provider`;
      - `settings jsonb`, which holds no secrets;
      - `secrets jsonb`, kept apart so that the later encryption touches only it.
    - Each provider module has zod schemas for both documents. They are checked on every write and every read (ADR-0025).
    - A new provider needs no migration. A change to a provider's settings shape needs a data migration of the documents.
    - **References:** LibreChat, LobeHub, Dify.
    - **Not taken:** a typed table per provider; a wide table.
18. **The Dify app type is an admin field, and the form has a "Test connection" button** (owner, 2026-10-11; recommended).
    - The test calls Dify with the key. It reports whether Dify is reachable and warns when the type differs from the one Dify reports.
    - The test copies nothing. Saving never calls Dify.
    - Every provider can offer a test through the registry (AG-UI's in Part 2).
19. **App icons are image-only** (owner, 2026-10-11). Options not taken: image or emoji; emoji only.
    - The admin uploads an image or leaves the icon empty. The image goes through ADR-0030's pipeline: PNG, JPEG or WebP in, re-encoded to PNG with sharp, no SVG, size-capped.
    - An app without an icon shows a fallback icon for its provider.
    - The emoji columns (`icon_type`, `icon`, `icon_background`) are dropped. The fresh start of decision 14 means no data has to be carried over.
20. **Part 1, Section 1 (data model and modules) is approved** (owner, 2026-10-11: "yes"). The owner asked for a check against docs and standards, cheaply now or at the end. A background check writes `doc-verification.md`, and the full spec gets a final docs check.
    - **The `apps` table** (in Part 0's baseline):
      - neutral columns: `id`, `created_at`, `updated_at`, `name` (required), `description`, `tags`, `is_enabled`, `access_mode`, `icon_image` (`bytea`) and `icon_mime`;
      - `provider`, a PostgreSQL enum with only `dify` in Part 1 (Part 2 adds `agui`);
      - `settings jsonb` and `secrets jsonb`, both NOT NULL and both checked by the provider's zod schemas on every write and read.

      For Dify, `settings` holds `{apiBase, appType, the four feature flags}` and `secrets` holds `{apiKey}`. The provider cannot change after creation. The grant tables keep their foreign keys.

    - **Modules:**
      - `lib/providers/`: the `ProviderDefinition` (id, schemas, defaults, `testConnection()`, chat view) and the server-only registry.
      - `lib/providers/dify/`: today's `lib/dify/` moves here.
      - `lib/http/`: the app-wide envelope, no-store JSON, the parse helpers and the browser request error.
      - `components/providers/`: the client registry (label, fallback icon, admin form section, chat view).
      - `components/chat/**` stays in place until Part 3.
    - **The data layer** keeps the actor parameter and `visibleTo`.
      - The admin DTO says which secrets are set, never their values (write-only; a blank field keeps the stored value).
      - The chat DTO has the provider and its public settings, never the base URL or the secrets.
      - The sync code is removed.

21. **Part 1, Section 2 (the admin flow, actions and routes) is approved, and annotations are removed** (owner, 2026-10-11: "remove the annotations. I don't use that feature. that way all the options are the same. otherwise good").
    - **Flow.** "Add app" first asks for the provider. In Part 1 only Dify is listed, and the choice still shows with that single entry. The form then shows two parts:
      - the shared part: name, description, tags, icon upload, status and access;
      - the provider's part: for Dify, the API base, the API key, the app type, the conversation options, the form-reply options and **Test connection**.

      Editing uses the same form; the provider is shown and cannot be changed, and a blank key keeps the stored one.

    - **Actions:**
      - `createAppAction` and `updateAppAction` take FormData, with the icon as a file, as the branding page does. zod parses it into `{provider, common, settings, secrets, icon}`, with a union keyed by provider. The data layer validates again through the registry.
      - `testAppConnectionAction` uses the stored key when the field is blank. Its results: reachable, unreachable, key refused, or a type-mismatch warning that does not block saving. It copies and saves nothing.
      - The delete action stays. The sync action goes.
    - **Table.** A provider column with a filter; Dify apps show their type beside it. The row actions are the same for every provider; the registry has no per-provider row actions.
    - **Routes.**
      - `app/api/dify/[appId]/**` keeps its paths until Part 3. The shared guard answers 404 `app_not_found` for an app of another provider.
      - `/api/apps/[appId]/icon` stays.
      - Part 1 adds no new route.
    - **Errors.** `dify_unreachable` becomes `provider_unreachable`. The test results get their own codes and i18n keys in en, zh and ar. The envelope is unchanged.
    - **Annotations are removed entirely:**
      - the `apps/annotations` routes (two files);
      - the admin drawer, panel and modal;
      - the chat's annotate action and drawer;
      - the `enable_annotation` setting;
      - the `annotation.*` i18n keys;
      - the stub's annotation endpoints and the tests for all of these.

22. **Part 1, Section 3 (the user side, renames, testing and records) is approved** (owner, 2026-10-11: "good").
    - **The gallery** carries `provider`. The card shows the icon (or the provider's fallback), the name, the description and the tags. What replaces the Dify-mode line is a UI pick.
    - **The chat page** stays at `/chat/[appId]` and renders the provider's chat view from the client registry. For Dify that is today's `ChatWorkspace`, which reads `settings.appType` in place of `mode`. The Dify chat is unchanged apart from the annotate action.
    - **Code renames:**
      - `dify_apps`/`difyApps` → `apps`;
      - `lib/dify` → `lib/providers/dify`;
      - the shared helpers → `lib/http` under neutral names, fixed in the spec;
      - "Dify user ID" → "User ID", with a note on ADR-0026 that the account id is the end user for every provider;
      - neutral i18n keys reworded.
    - **Removed:** the sync, annotations, emoji icons, and the fallback icons per Dify mode, which are replaced by one fallback per provider.
    - **Testing:**
      - unit tests for the schemas, the registry, the data layer, the guard, the actions and the route pin;
      - e2e on three projects: add a Dify app with Test connection against the stub's `/info`; edit with a blank key; the provider filter; the gallery card; the chat unchanged for every Dify type;
      - the Docker gate.
    - **Records:**
      - the charter `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`;
      - Part 1's ADR, "Organise apps by provider: a shared core with provider modules", with notes on ADR-0023 and ADR-0026;
      - the AG-UI protocol and hub-history ADRs in Parts 2 and 3;
      - `CLAUDE.md` updated in each part's PR.
23. **The docs check of Part 0 and Section 1** (`doc-verification.md`, 2026-10-11). Most pieces follow their docs. The fixes below are applied without a new decision, because the docs require them and they keep what was approved:
    - **Case-insensitive email lookups.** Four lookups rely on MySQL comparing case-insensitively:
      - `lib/auth/options.ts:32`;
      - `lib/data/users.ts:198`;
      - `lib/data/directory.ts:100`;
      - `app/api/auth/forgot-password/route.ts:30`.

      They become `lower(email) = lower($1)`, matching the `lower(email)` unique index, as PostgreSQL's citext page writes it. A behaviour change to record: MySQL's `utf8mb4_0900_ai_ci` also ignored accents, and `lower()` does not.

    - **The pool.** It is built as `new Pool()` with a `pool.on('error')` listener, and then `drizzle({ client: pool })`. node-postgres warns that an idle-client error with no listener can crash the process.
    - **The browser registry.** A server module may import only components or serializable values from a `'use client'` module (React docs). So the server chat page passes the provider id to one client switch, or keeps a server-side map whose values are client components.

      The folder name `components/providers/` is taken by the React context providers, so the provider UI gets another folder; the name is fixed in the Part 1 spec.

    - **Timestamps.** No `precision` on timestamps: the PostgreSQL wiki notes that a precision rounds rather than truncates.
    - **postgres:18 in Docker:**
      - the volume is mounted at `/var/lib/postgresql`, which changed in the 18 images;
      - `shm_size: 128mb`;
      - `pg_isready -h 127.0.0.1` in the healthcheck.
    - **Indexes on foreign-key columns** (`group_id` and `user_id` in the grant tables, `user_id` in `user_group_members`). PostgreSQL does not create them; MySQL did.
    - **Transactions and conflicts:**
      - `createOwner` loses its `repeatable read`; the partial unique index is the guarantee;
      - the deadlock code is `40P01`;
      - `onDuplicateKeyUpdate` becomes `onConflictDoUpdate`;
      - the slot claim becomes `ON CONFLICT DO NOTHING RETURNING`.
    - **Column types.** `text` over `varchar(n)`. If ids become `uuid`, every id from a URL is checked with `z.uuid()` first, because PostgreSQL raises `22P02` on a malformed one.
    - **Drizzle's zod helper.** `drizzle-orm/zod` exists, but it still needs an explicit parse, so the per-provider zod schemas stay and the jsonb columns stay `unknown` until parsed.
    - **Encryption later.** An encrypted value is not JSON, so `secrets` may change type when encryption lands.

    Points for the owner, which change approved items, are decisions 24 onwards.

24. **`apps.provider` is `text` with a CHECK listing the known ids, plus the registry's zod check in code** (owner, 2026-10-11; recommended). This revises Section 1's "PostgreSQL enum".
    - The reasons, all in `doc-verification.md` (2e):
      - PostgreSQL cannot use a value added by `ALTER TYPE … ADD VALUE` until the transaction commits, and Drizzle's migrator runs every pending migration in one transaction;
      - enum values cannot be removed;
      - the PostgreSQL docs call enums "primarily intended for static sets";
      - the reference hubs store the provider as a string.
    - The static sets stay PostgreSQL enums: role, access mode, membership source.
25. **Migrations keep running in the container's entrypoint** (owner, 2026-10-11). Each container migrates at start, as approved in decision 16.
    - Drizzle's `migrate()` takes no lock, so two containers starting together race; the loser fails `set -e` and restarts.
    - This is fine for the single production container. Before scaling out (`CLAUDE.md`'s deployment note), switch to Compose's documented one-shot `migrate` service with `depends_on: condition: service_completed_successfully`. This is recorded as a follow-up.
26. **The charter and Part 0's spec are written** (2026-10-11) and wait for the owner's review:
    - `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`;
    - `docs/superpowers/specs/2026-10-11-part-0-postgres-and-rename-design.md`.

    Part 0's spec makes two choices for the owner to check:
    - ids: first written as `text`. The owner then asked about it and chose **`uuid` with checks** (2026-10-11), and §3.2 now says so.
      - Claude's first estimate of "about 30 entry points" was corrected: the 26 `[appId]` routes share one guard, so the checks sit in a handful of places (the guard, the chat page, the icon route, the admin actions).
      - `22P02` maps to "not found" as a safety net.
    - The upstream-shaped documents (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `.all-contributorsrc`, `packages/docs/`) stay for the housekeeping work.

    The built-in logo, a blue "D" mark from the Dify era, stays (owner, 2026-10-11: "Keep the D mark"). The brand is set on the settings page.

    Still to come: the Part 1 UI picks (`ui-picks-part1.md`), then Part 1's spec, then the plans.

27. **The charter and Part 0's spec are approved** (owner, 2026-10-11: "specs looks good"). This includes the `uuid` ids and keeping the D logo.
    - Next: Part 0's implementation plan (writing-plans).
    - For Part 1's UI, the owner asked for the component list once it is ready, plus 2 to 3 layout options ("also suggest for me 2 to 3 layout options").
28. **Library versions** (checked with `pnpm outdated` and `npm view`, 2026-10-11). The owner asked whether the libraries are current, then: "what im after is ant design and x. thats what will make the biggest change".
    - **Already the latest:**
      - `antd` 6.6.5;
      - `@ant-design/x`, `x-sdk` and `x-markdown` 2.9.0;
      - the vendored X skill 2.9.0 and the antd CLI 6.6.5.
    - **`@ant-design/icons` is behind:** our imports use 5.6.1, while antd and X use 6.3.4 internally, so both copies ship. The upgrade to `^6.3.4` goes into Part 1, after its changelog is checked. It also gives the AI-vendor logos (icons 6 only).
    - **The other upgrades are a follow-up, outside the programme:**
      - `next` 16.4, `react` 19.3, Playwright 1.64;
      - TypeScript 7, vitest 5, i18next 26 and react-i18next 17;
      - nodemailer 10, oxfmt and oxlint, eslint 10, `@types/node` 26;
      - the deprecated `@types/bcryptjs` and `@types/pako`;
      - the Docker image's Node 22.21.1, while the local machine runs 24.16 (the current LTS).
    - **Drizzle** goes to `1.0.0-rc.4`, the newest tagged release candidate, in Part 0. Part 0 rewrites the database layer anyway.
29. **Layout B for "Add app" and "Edit app": the provider choice sits inside the drawer** (owner, 2026-10-11; chosen from three text mockups). The options not taken were A, a menu on the "Add app" button, and C, a page of its own with steps.
    - "Add app" opens the drawer, with the provider choice at its top. The rest of the form appears once a provider is picked, and the choice can be switched before saving.
    - Editing uses the same drawer; the provider row becomes read-only (E8).
    - The component for each slot (E1–E11) is the owner's pick from `ui-picks-part1.md`, element by element.
30. **UI picks for Part 1** (owner, 2026-10-11). Each pick is also written on its element's "Owner's pick" line in `ui-picks-part1.md`.
    - **E1, the provider choice:** a plain `Select` ("just a normal drop down"), with the default outlined variant and plain text options.
    - **E2, the container:** today's Drawer, unchanged ("same as today"): right, `size="large"`, Cancel and OK in `extra`.
    - **E3, the sections:** today's plain `Divider`s with the title at the start, and **no Collapse** ("its plain dividers with no collapse"; the earlier Collapse pick is withdrawn).
      - Form `layout="horizontal"`.
      - `requiredMark` is a render function that draws an asterisk on required fields and "(optional)" on optional ones. This is antd's documented customize route; its built-in values are either-or.
    - **E4, the icon:** Upload + Button with no list, as on the branding page. The preview is a square Avatar, whose corners are rounded through the token. Remove is a separate danger Button, assumed from the branding page.
    - **E5 to E11 were delegated** ("for the rest do as you see fit. vanilla showcase style"). Claude chose antd's showcase defaults:
      - **E5, tags:** `Select mode="tags"` with comma tokenization and existing tags as suggestions; default `Tag` chips.
      - **E6, description:** `Input.TextArea` with `autoSize` from 2 to 6 rows.
      - **E7, the test:** a default `Button` with `loading`. The result is an `Alert` (`showIcon`, title and description: success, warning or error) under it, cleared when a connection field changes.
      - **E8, the provider when editing:** the E1 `Select`, `disabled`.
      - **E9, the table:** a "Provider" column of plain text such as "Dify · Chatflow", with the built-in column `filters` and the Dify types nested under "Dify".
      - **E10, the gallery card:** the `Card.Meta` description as today, now "Dify · Chatflow" or "AG-UI agent".
      - **E11, fallback icons:** a square Avatar with the default background. Dify `ApartmentOutlined`, AG-UI `RobotOutlined`, OpenAI-compatible `ApiOutlined`, generic `AppstoreOutlined`.
31. **Part 1's spec is written** (2026-10-11): `docs/superpowers/specs/2026-10-11-part-1-provider-core-design.md`. It waits for the owner's review. Choices it makes that were not asked separately:
    - **Limits:** at most 10 tags of 1–32 characters; a description of up to 2,000 characters.
    - **App icons:** at most 256 × 256 px PNG, from a 1 MB input.
    - **Responsive labels:** the labels go above the fields on narrow screens.
    - **Rows whose stored documents fail their schema:** 404 for users; for admins, an "Invalid settings" Tag and an Edit that repairs the row.
    - **The client registry folder** is `components/provider-ui/`.
    - **The ADRs:** 0031 for Part 0, 0032 for Part 1.
    - **The Dify chat's internal names** keep "dify" until Part 3.
32. **Part 1's spec is approved** (owner, 2026-10-11: "go"). This includes the choices listed in decision 31. Next: the implementation plans, Part 0's first (writing-plans), then Part 1's.
33. **The plans are written one part at a time, each against the code as it stands then** (2026-10-11).
    - Part 0's plan is written now: `docs/superpowers/plans/2026-10-11-part-0-postgres-and-rename.md`.
    - Part 1's plan is written after Part 0 merges. Part 0 rewrites every schema file and most of the data layer, so a Part 1 plan written now would quote code that no longer exists.
34. **Part 0's plan is written and self-reviewed** (2026-10-11): `docs/superpowers/plans/2026-10-11-part-0-postgres-and-rename.md`, 14 tasks.
    - While planning, it was checked against a throwaway `postgres:18` with drizzle rc.4 and `pg` 8.23.1.
    - It corrected the spec's facts:
      - 25 `[appId]` routes, not 26;
      - the directory groups route takes no id;
      - `/chat/abc` shows the "missing" page;
      - `deploy-docs.yml` and the AGENTS.md lines;
      - `.env.template` has no `MYSQL_*` keys;
      - the old stack goes down with `-p dify-app-hub-local`.

    The owner's answers (2026-10-12):
    - **`docker-bake.hcl`:** no default `DOCKERHUB_USERNAME`; a Bake `validation` block requires it, per Docker's "Bake variables" docs.
    - **`pnpm test:db`:** accepted as a gate. It is a third Vitest project against a throwaway PostgreSQL.
    - **Group names:** stay case-insensitive through a `lower(name)` unique index.
    - **Two simultaneous first saves of one settings area:** the later save wins. This is recorded in ADR-0031.

    Decided without a question:
    - ADR-0004 is marked superseded while ADR-0031 is proposed, as ADR-0003 was.
    - AGENTS.md stays upstream's, and CLAUDE.md gives the working `pnpm db:*` form.

35. **The local folder rename moves to the end of the programme** (owner, 2026-10-12: "how about moving naming the folder it self to last? cause currently im on remote and can't edit files").
    - `~/repos/dify-app-hub`, `~/repos/dify-app-hub-main` and Claude Code's memory directory keep their paths until after Part 3, when the owner is at the machine. Nothing depends on the folder name: the compose files name their projects.
    - The GitHub repo can be renamed from the web any time, and a session then runs `git remote set-url`.
    - Recorded in Part 0's spec §8, its plan (decision s, Task 13's `CLAUDE.md` text, Task 14's reminder) and the charter. This revises decision 3's timing only.

    Also decided on 2026-10-12: Part 0 runs subagent-driven, in a new session; the docs went to `fork/overhaul` in PR #37 (`8e105912`).

36. **Part 0 is built, tested by the owner and merged** (2026-10-12).
    - It ran subagent-driven on `feat/postgres-and-rename`, with a review of each task, a three-seat final review and one fix wave. The run records are in `part0-execution/`.
    - The owner asked "did you follow adr 02?". A docs check of the execution-time choices followed (`part0-execution/doc-verification-execution.md`), and `tsconfig.json` now excludes `tmp/`.
    - The owner's answers (2026-10-12): "leave the commit" (the per-model `Co-Authored-By` trailers stay), "use pnpm remove" (mysql2 removed with the documented command), "use the exclude", "you can edit the .env yourself" (Claude switched both `.env` files to PostgreSQL without printing a value).
    - The owner tested the pushed branch: "ive tested it and it looks like its working". ADR-0031 was accepted, and PR #39 was merged into `fork/overhaul` as `fd05be49`.
    - Cleaned up on the owner's word: the old MySQL volume and the `.env` backups.
    - Next: Part 1's plan, written against the merged code (decision 33).

## Research findings that shape the design (2026-10-11)

Sources are in `agui-and-reference-hubs.md`.

**AG-UI**

- AG-UI 1.0 shipped on 2026-09-17; `@ag-ui/client` is at 1.0.2.
- The protocol has no discovery endpoint. An agent's name, icon and capabilities come from the admin form.
- The client owns the history: each run sends the complete message history and the state. The hub therefore stores AG-UI threads (messages, state, pending interrupts) per user and builds `RunAgentInput` on its server. Microsoft's AG-UI security guidance recommends a trusted server in front, and Pydantic AI says its endpoint "is not an authentication boundary".
- Hub-to-agent auth goes in server-side headers. The user-identity header is the hub's own convention; ADR-0026's account id is the value.
- The protocol has no stop request; what stopping does to an agent needs the spike.

**Pydantic AI**

- Version 2.55.0 serves AG-UI through `AGUIAdapter.dispatch_request` and keeps no state.
- Approvals arrive as interrupts and are answered with `resume[]` in the next run.
- It still pins `ag-ui-protocol` below 1.0 (PR #8627 is open). The 1.0 TypeScript client translates 0.x streams.

**Ant Design X**

- X 2.9.0 has no AG-UI support. Issue #1722 is "planned", and an unreleased, experimental `AgentProvider` with its own protocol exists on the `feature` branch.
- The documented route is therefore a custom `AbstractChatProvider` (ADR-0017).
- Other React AG-UI clients exist (assistant-ui's, TanStack AI), but each is a second UI stack.

**Reference hubs** (LibreChat, Open WebUI, LobeHub, Dify)

They agree on the shape:

- a provider discriminator column;
- per-provider settings as a JSON document, validated by that provider's schema;
- secrets split out and encrypted (Open WebUI is the exception);
- a registry from provider type to server adapter;
- one shared chat with provider-specific parts.

All of them keep history themselves. None mixes history kept by the provider with history kept by the hub, and none supports AG-UI.

**Reference projects for AG-UI** (`agui-reference-projects.md`, mostly for Part 2)

- **`vstorm-co/full-stack-ai-agent-template`** does not use AG-UI; it has its own WebSocket events. Worth borrowing:
  - ordered message parts;
  - a tool-card per tool;
  - the `ask_user` stepper;
  - the plan panel;
  - the sub-agent feed and panel.

  Its storage loses the order of the parts and saves only after a run ends; avoid both.

- **`vstorm-co/agenticos`** (v0.0.535) is a competing hub, not a provider. It exposes no AG-UI, A2A, OpenAI-compatible or MCP endpoint, and has its own login, groups and grants.
  - Verdict: use it as a design reference, not something to adopt.
  - Its best piece is the approval flow: the run parks on `ApprovalRequired`, resumes with `DeferredToolResults`, and the card offers Approve/Reject with read-only arguments.
- **The AG-UI Dojo** runs entirely on CopilotKit. It lists 26 features and serves as the acceptance list. Pydantic AI offers 7 of them there.
- **Pydantic AI's examples**: 7 agents, including `tool_approval` (an interrupt resumed with `resume[]`). This is the spike's agent list.

## Open questions (asked one at a time)

- How per-provider settings are stored (typed tables or a validated JSON document), after the reference-hub research.
- Conversation storage on the hub for providers that keep no history.
- The UI picks (provider picker in "add app", gallery provider badge, AG-UI chat elements): candidate lists for the owner.

## Research in this folder

- `part0-execution/`: Part 0's run records: the ledger, the rulings, the pre-flight scan, the docs check of the execution-time choices, the final review, the fix wave.
- `dify-coupling-map.md`: every place the code assumes Dify, classified as neutral core, Dify-only, or name only.
- `agui-and-reference-hubs.md`: the AG-UI protocol and `@ag-ui/client`, Pydantic AI's adapter, Ant Design X and AG-UI, and how LibreChat, Open WebUI and LobeChat model their providers.
- `agui-reference-projects.md`: `vstorm-co/full-stack-ai-agent-template`, `vstorm-co/agenticos` (build or adopt), the AG-UI Dojo, Pydantic AI's AG-UI examples.
