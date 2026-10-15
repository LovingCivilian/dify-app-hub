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
    - **E4, the icon:** Upload + Button with no list, as on the branding page. The preview is a square Avatar, whose corners are rounded through the token. Remove is a separate danger Button, assumed from the branding page. (Revised by decision 37 (owner, 2026-10-12): a default Button, as the branding page's is.)
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
    - **App icons:** at most 256 × 256 px PNG, from a 1 MB input. (Revised by decision 37 (owner, 2026-10-12): a 512 KB input.)
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

37. **Part 1's plan is written and reviewed** (2026-10-12): `docs/superpowers/plans/2026-10-12-part-1-provider-core.md`, 15 tasks.
    - It was written against `fork/overhaul` at `dfeff12e` (Part 0 merged), with its migrations measured on a throwaway PostgreSQL 18.
    - Two Opus reviewers checked it, one on Tasks 1–10 and one on Tasks 11–15. One fix round took every Blocker and Important finding: the drawer now sends the form's whole store (a save with the form reply switched off was refused), the screenshot spec follows the removed annotations and emoji icons, the e2e no longer presses Escape inside the drawer, the two pins of the deleted sync test keep a home, and the Docker gate always backs the database up, with a written way back. The few Minor findings not taken are listed at the end of the plan.
    - The owner answered the plan's two questions: "Cap at 512 KB" (the icon's input cap: Next's default 1 MB Server Action body has to carry the icon and the form's other fields) and "Default, like branding" (the icon's Remove is a default Button, as on the branding page). Spec §4.4 and §4.1 now say so, each marked "(owner, 2026-10-12)".
    - Next: the owner's approval of the plan, then its execution on `feat/provider-core`.

38. **The superpowers-extended-cc defaults replace our own process rules** (owner, 2026-10-12: "it should follow deafults superpowers, and the things superpowers owns are loaded with its skills, we shouldnt have to re explain it in our files").
    - The plugin `superpowers-extended-cc` 6.5.3-dev replaced `superpowers` 6.4.1. Its skills now decide the steps, reviews, commits, worktrees and finish of every plan run.
    - Dropped: the Opus pre-flight, the three-seat final review, the run records archived in a docs PR, this record's "update after every answer" rule, and the owner-picks-every-component rule (brainstorming's 2–3 options with a recommendation instead; the Part 1 picks E1–E11 stay in the plan).
    - Next: Part 1's plan is converted to the plugin's plan format (task fields, per-task metadata with a model tier, the `.tasks.json` file), then run by its skills. From here the specs and plans carry the decisions; this record keeps the history.

39. **Part 1 is built, tested by the owner and merged** (2026-10-14).
    - It ran subagent-driven on `feat/provider-core`, in `~/repos/dify-app-hub` itself (owner, 2026-10-12: "remove the worktree and use the branch as you did originally"). Each of the 15 tasks got a review. The final whole-branch review found one Important issue: an icon replaced on Edit was not fetched again, so the admin icon URLs now carry `?v=<updatedAt>`. One fix wave took it, with the must-fix items the task reviews had deferred. The run's ledger was a local file, deleted at the finish (decision 38); what it left open is listed in PR #60's description.
    - During the run the owner asked for docs checks: "use the context7 mcp to check docs", then "why only context7, why not crawl4ai, or the libs actaly mcps and docs in the repo?". From then on, every implementer and reviewer checked each library API against every source AGENTS.md names. A read-only audit covered Tasks 1–8, and its three findings were fixed.
    - The Docker gate ran on the owner's go-ahead ("Go ahead", 2026-10-13):
      - **Backup:** the old image kept as `ai-app-hub-local-app:part0`, and a mode-600 dump.
      - **Rehearsal:** the three migrations ran on a restored copy with the same counts (2 apps, no grants, none without a mode).
      - **Rebuild:** one `Database migration complete`, RestartCount 0, four migration rows.
    - **The e2e flake:** it was `next dev`'s memory-threshold restart. `next dev` sizes its heap at half of the 4.9 GB machine's RAM and restarts at 80% of it, which happened about 80% into each full run. The owner chose a fixed 4 GB heap for the e2e dev server ("a, and then 2", 2026-10-14; ADR-0010 note). The next run, slower in heavy swap, caught two locators that matched two elements; they are exact now, and the last full run had 0 failed.
    - The owner checked the migrated stack: "everything is working" (2026-10-14). ADR-0032 was accepted, and PR #60 was merged into `fork/overhaul` as `8500cce3`.
    - On the owner's word:
      - **crawl4ai:** it moved to the owner's pipx install, and both folders' `.venv` were removed. This line's docs follow (ADR-0002 note); `fork/main`'s guide is left as it is.
      - **Cleanup:** the backup and the `part0` image were removed.
      - **Backlog:** comments went to #44, #45 and #49.
    - Next: Part 2, the shared chat on AG-UI and the AG-UI provider. Its spec comes first, then its plan, written against the merged code (decision 33).

## Part 2's brainstorm (2026-10-14)

The decisions below were taken in one session on 2026-10-14. The spec they produced is `docs/superpowers/specs/2026-10-14-part-2-agui-shared-chat-design.md`; its "Progress" section is where the state of Part 2 is kept from now on.

40. **Part 2 starts from the charter** (owner, 2026-10-14: "use the charter and contume with brainstorming"). No Part 2 plan existed; the charter's decisions are not re-opened, and the brainstorm covers what it left open (§8). Claude classed the work as architectural (full spec).
41. **Scope: the core chat plus four extras** (owner, 2026-10-14, all four picked): tool approvals, ask-user questions, a shared-state panel and attachments. The core is streamed text, reasoning, tool calls as cards, run errors, stop and history from the hub's store. Sub-agents, A2UI, citations and predictive state wait for a later part.
42. **Admins can read every conversation** (owner, 2026-10-14: "Admins can read"): a read-only Logs view per app; users see and delete only their own. Options not taken: owner-only reading; auto-expiry.
43. **Every choice is backed by docs, best practice and reference projects** (owner, 2026-10-14: "follow docs, best oractiers, and refrense other projetcs"). Four research notes were written beside this record: `part2-store-and-logs.md`, `part2-proxy-stop-identity.md`, `part2-x-mapping.md`, `part2-hitl-state-files.md`.
44. **The spike ran** (owner, 2026-10-14: "Go ahead"; scripted Pydantic AI `FunctionModel` agents with no key, a spec-level 1.0 stub, a throwaway `spike/agui` branch). Its answers are in `agui-spike.md`: one X message per assistant turn with ordered parts; interrupts continue the same turn through `onReload`; aborting upstream stops a Pydantic AI agent; `HttpAgent.runAgent()` on the server reads 0.x and 1.0 streams; structured history replays; only inline base64 attachments reach the model.
45. **Identity: a per-request signed JWT is the only auth header** (owner, 2026-10-14, choosing "Bearer + signed user JWT" and giving the agent service's contract). The owner's agents are a separate Python service (Pydantic AI over AG-UI) that trusts only the hub's server and verifies every request itself.
    - Call: `POST <agent URL>` (the owner's service: `<base>/agents/<name>`), body the `RunAgentInput` unchanged, `Authorization: Bearer <JWT>`, no other auth or identity header; stream back unbuffered (`Cache-Control: no-cache, no-transform`).
    - JWT: HS256 with a per-app secret of at least 32 random bytes (never `NEXTAUTH_SECRET`), minted per request; `sub` = the account id (ADR-0026), `iat`, `exp` = 60 s, `iss` = `nextjs-bff`, `aud` = the app's audience such as `assistant`, `auth_source` = `local` or `ldap`, optional `roles`; name and email omitted.
    - The agent answers 401, 404, 415 or 422 before streaming; a refused connection means it is restarting; in-stream `RUN_ERROR` codes are `usage_limit`, `rate_limited`, `busy`, `model_unavailable` and `agent_error`, with a message safe to show; a time limit ends with `CUSTOM run_cancelled {reason: run_timeout}` then `RUN_FINISHED`.
    - The owner's reason against a static bearer plus a user-id header: "anyone holding the static secret can claim to be any user, roles can't be passed in a way the agent can trust, and the secret never expires".
46. **Ask-user follows the full-stack template, advertised by the hub** (owner, 2026-10-14: "i want you to check project like the full stack ai template and how they do it", then "Template's design, hub-advertised"). The template's `ask_user` blocks a run on its own WebSocket, which AG-UI's HTTP + SSE cannot do; the AG-UI equivalent is a frontend tool. The hub advertises `ask_user` with the template's schema (at most 10 questions; `question`, `options`, `allow_custom`), shows the template's stepping card and answers with its Q/A transcript. A per-app switch, off by default (an agent with its own `ask_user` would fail). Other non-approval interrupts get a generic card.
47. **Shared state: a plan panel and activity cards** (owner, 2026-10-14). The template's plan panel, shown when the state reads as `steps: [{description, status}]` (the shape of AG-UI's Dojo and Pydantic AI's example); activity messages as read-only cards; no state editing by users. Options not taken: a generic state tree; both.
48. **Attachments are stored in PostgreSQL `bytea` and sent inline** (owner, 2026-10-14). The owner's rules for the agent service: typed input content with a `data` source beside the text, never hub URLs; every run re-sends the full history; allowed kinds per app must match the model (many self-hosted models are text-only, most reject PDF `document` parts, which fails with `model_unavailable`); by default images only for vision models, and PDF or text extracted to plain text in the hub.
49. **Logs policy: audited, with a notice, and soft delete** (owner, 2026-10-14: "Audited, notice, soft delete"). Each admin view writes an access-log row; users see that admins can read their conversations; a deleted conversation stays visible to admins for 30 days, then a job purges it.
50. **An open approval, question or interrupt blocks the composer** (owner, 2026-10-14: "Block until answered"), as the template does; every card has a way out.
51. **One spec, three PRs** (owner, 2026-10-14): 2a the core, 2b human in the loop, 2c attachments and Logs, each with its own plan written after the previous one merges (decision 33).
52. **A custom backend contract in the app settings is not built** (owner, 2026-10-14: "currently the contract between the fronend and backend is fixed, cant we make it modular, in the app settings i can crerate a custom contarct, so that the app hub can support any backend. how would that be done?", then "Record it, continue"). The rule stays: the browser contract is AG-UI; backends plug in through the provider registry and standard protocols (AG-UI now, OpenAI-compatible next), and an exotic backend gets a small AG-UI shim beside it. An admin-configured "HTTP template" provider for text-only APIs is kept as an idea below. Admin-uploaded adapter code (Open WebUI's Pipe functions) was not proposed for adoption.
53. **Images keep their size unless the app sets a maximum** (owner, 2026-10-14: "why resize the images?", then "Per-app max size"). Images are decoded and re-encoded to strip metadata (OWASP) at their original size; an optional per-app "max image edge" shrinks them.
54. **A per-conversation cap of 6 MB, every attachment re-sent** (owner, 2026-10-14: "why is there a cap on the chat size?", then "Per-conversation cap"). The per-run budget with placeholders was offered and not taken; the "last N turns" placeholder setting is dropped.
55. **The design's seven sections are approved** (owner, 2026-10-14: "go ahead", "go", "go", "go", "go", "yes", "yes"), and Part 2 must stay resumable (owner: "this will be a muli session project, so keep facts and progres durable is future agents dont lose context"). The spike and research notes are committed beside this record, the spec carries a Progress section, and each later session updates it.
56. **Part 2's spec is approved** (owner, 2026-10-14: "specs looks good, push and merge"). It merges as a docs PR with the spike and research notes. The owner asked whether to write 2a's plan in the same session ("should we do it this session? its already at 500k context"); Claude recommended a new session that starts from the spec's §0.
57. **How sessions hand off** (owner, 2026-10-14: "recored how each next session should hand off its work to the next after it, whats are the importnts bits, and the phases of the projetc, keep it breif"). The phases and the hand-off checklist are in §0 of the Part 2 spec; AGENTS.md points to it. The last handoff document, `docs/superpowers/handoffs/2026-10-14-part-1-done-start-part-2.md`, is committed (owner: "commit it").
58. **2a's plan is written** (2026-10-14): `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md`, 19 tasks with a `.tasks.json`, on `docs/part-2a-plan`, against `fork/overhaul` at `faebc118` (decision 33). Six parallel drafts wrote the task bodies against the plan's shared contracts; Tasks 2–4 and 8–11 were run in scratch copies against the real `@ag-ui/client`, `@ag-ui/encoder`, `jose` and zod (tsc clean; Tasks 2–4: `pnpm test` 1,929 passed; Tasks 8–10: 71 tests passed), and `drizzle-kit generate` wrote both migrations' SQL as the plan quotes it. The owner, while it was written: "as ive said, follow docs and standard" (2026-10-14); plan call P1 then moved from a database read of the account's source to the session, the documented next-auth path. The plan calls P1–P14 (where the spec is silent) are for the owner's review on the plan's PR. Next: that review, the merge, then the build on `feat/agui-core`.
59. **2a is built** (2026-10-14): Tasks 1–18 of `docs/superpowers/plans/2026-10-14-part-2a-agui-core.md` on `feat/agui-core`, subagent-driven; ADR-0033 and ADR-0034 proposed. Deviations (ruled while it ran; the spec §0 2a row lists them): tool-only runs join their turn by start time; a run's `outcome` stored as received; `finish({ failed })` log codes `stream_broken`/`stream_ended`; no sink writes after `finish()`; run registered before `startRun`; a refused connection rethrown as a plain error; `ConversationListRow`; `sendDecision` shared from `components/chat/hooks/send-decision.ts`; `conversation_messages_run_id_idx`; text at most 32,000 characters and non-blank; the e2e Stop test uses the keyboard (ADR-0028 note). Left for later: the refused-first-run list duplicate (#66), `fallbackTurn` in 2b (#67), the queued-send key in both chat hooks (#68), and in #69 the 100-conversation sidebar, the agent's address in `@ag-ui/client`'s own failure log when a stream drops (the plain error covers a refused connection only), and `MESSAGES_SNAPSHOT`-only agents showing nothing live until a reload. Next: the gates, the Docker gate and the owner's check (Task 19).

60. **2a passes its gates; the ADRs are accepted before the owner's check** (2026-10-14).
    - **Run.** Task 19's gates ran on `feat/agui-core` after a final whole-branch review. That review found two Important items, and one fix wave took both, with the Minors it marked worth fixing: AG-UI admins saw Dify's Test connection descriptions ("Check the API base…"), and the e2e Stop test could pass through the abort fallback without the stop route. The plan author's session answered every ambiguity during the run (Q1–Q11 before Task 1; Task 17's dev-indicator question, ADR-0028's rule).
    - **Gates** at `413a0fe6`: tsc, oxlint, oxfmt, the antd lint at 0, i18next lint and status (zh and ar 100%), the three boundary greps empty, `pnpm test` 2,178, `pnpm test:db` 91, `pnpm test:ldap` 51, and the e2e suite on an empty PostgreSQL with 662 passed, 32 skipped and 0 failed.
    - **The Docker gate** ran on the owner's go-ahead ("Go ahead", 2026-10-14):
      - **Backup:** the old image kept as `ai-app-hub-local-app:part1`, and a mode-600 dump with 12 tables.
      - **Rebuild:** one `Database migration complete`, RestartCount 0, and six migration rows ending `_agui_provider` and `_conversations`. `apps_provider_check` allows `'agui'`, the three tables exist, and the apps count is unchanged (2).
      - **Checks:** no `[ag-ui]` or `@ag-ui/` in `.next/static`, and every signed-out check as AGENTS.md lists, with 401 on the three new routes.
    - **The owner's word**, working remotely without a browser: "let's proceed nonetheless … I will test it in the morning … accept the ADR, push the PR, open the issues". ADR-0033 and ADR-0034 are accepted on it. The PR is #70, and the issues are #66–#69. The owner's browser check on the local stack comes before the merge, and a problem it finds becomes a fix on the branch.

61. **2a is merged before the owner's browser check** (owner, 2026-10-14: "I merged it before my browser check, and I'll still do that check; a problem it finds becomes a fix/ branch"). PR #70 merged into `fork/overhaul` as `e8530dcc`; `feat/agui-core` is deleted, and issue #62 has the comment naming the three items 2a closed. The check (spec §12, "2a done when") stays due; a problem it finds is fixed on a `fix/` branch from `fork/overhaul`, not on 2b's branches. Next: 2b's plan on `docs/part-2b-plan`, written against `e8530dcc` (decision 33).

62. **2b's open questions, answered** (owner, 2026-10-14, while 2b's plan was written; the plan's "User decisions" and plan calls P10, P7, P13 and P1 carry them).
    - **An answer that never reaches the agent keeps its item open.** When the agent refuses an answering run before its stream (restarting, 401, 404, 422), the run is stored failed for the Logs, but its answers do not count: the cards stay, the error shows under them (#67), and the user can retry. AG-UI: a resume entry names an interrupt "from the run being continued — the most recent interrupted run on the thread", and the agent never received this one. The owner first asked "can you explain it in laymans terms for me", then chose "Keep it open (Recommended)". Options not taken: roll the refused run back (which would also have closed #66); keep 2a's rule (the refused run closes the items).
    - **The generic interrupt form understands types and bounds:** type, enum, title, description, default, minimum/maximum, minLength/maxLength, and required; any other keyword shows only the message and Cancel (owner: "Types and bounds (Recommended)"). Options not taken: types only; types with the rest ignored.
    - **The answers go when the last open item is answered,** and a recorded decision can be changed until then, as CopilotKit's `useInterrupt` does (owner: "When the last is answered (Recommended)"). Option not taken: a Send button.
    - **A pending `ask_user` call follows the app's current switch.** The owner asked "what does refrenc projetc do about thsi? im not sure what to choose?": CopilotKit draws a tool call with the renderer registered now, assistant-ui rebuilds a result-less call as waiting from the current configuration, and the template decides per run; none stores the tools a run advertised. Then "does this mean if i change a switch from on to off, and go back to a hsitory, it removes that cards?": no, answered cards always stay; only a question still waiting is released. Then "The app's current switch (Recommended)". Option not taken: store each run's advertised tools (a migration).

63. **2b's plan is written** (2026-10-15): `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md`, 19 tasks with a `.tasks.json`, on `docs/part-2b-plan`, against `fork/overhaul` at `e8530dcc` (decision 33). Nine parallel drafts wrote the task bodies against the plan's shared contracts, each verified in its own scratch copy; then a pre-flight applied Tasks 1–17 in order to one copy (the 2a handoff's lessons): tsc clean, `pnpm test` 2,479, `pnpm test:db` 97, oxlint, oxfmt, the antd lint and the i18next checks clean, and the new e2e specs green on desktop-light, desktop-dark and mobile-light beside 2a's AG-UI specs and the Dify chat's queued-send specs; two plan slips were fixed. The owner, while it was written: "also read any other relevemt docs or code", "follow docs and standard, use context7 and crawl4ai, and refrench projects where there is a gap in info" (2026-10-14), and "you can bring down the current instance to free memory" (the local app container was stopped; PostgreSQL kept running). Decision 62 holds the answers to the spec's open questions; the plan calls P1–P18 are for the owner's review on the plan's PR. Next: that review, the merge, then the build on `feat/agui-hitl` in its own session.

64. **2b is built** (2026-10-15): Tasks 1–18 of `docs/superpowers/plans/2026-10-14-part-2b-agui-hitl.md` on `feat/agui-hitl`, subagent-driven, each task reviewed. No migration and no new dependency (decision 62 keeps the refusal flag inside the `error` jsonb and reads `ask_user` from the app's current switch). Records: dated notes on ADR-0017 (#68's queued send, the answers through `onReload`, #67's `fallbackTurn`), ADR-0033 (`error.beforeStream` and `continuedRun`, `waiting`, answers that continue a turn) and ADR-0034 (`ask_user`, the interrupt answers, the plan state and activity cards), and `docs/agui-agents.md`'s "Asking the user", "Interrupts" and "State and activity"; no new ADR (ADR-0015). Fixed here: #67, #68 and #69's answer-pending hint (P15). Deviations from the plan (ruled while it ran): the ask_user card also cuts a free answer at 2,000 characters beside the Input's maxLength, since the card is P3's only enforcement point (Task 12); the final review's fix wave: the ask_user card's open-question filter reads own keys only, the docs name every refusal before the stream that keeps the items open, and the admin e2e waits for the run to settle before dropping its app. Next: the gates, the Docker gate and the PR (Task 19), then the owner's check.

65. **2b passes its gates** (2026-10-15).
    - **Gates** at `44ffd97d`: tsc, oxlint, oxfmt, the antd lint at 0, i18next lint and status (zh and ar 100%), the four boundary checks empty, `pnpm test` 189 files and 2,479 tests, `pnpm test:db` 97 tests, `pnpm test:ldap` 51 tests, and the e2e suite on an empty PostgreSQL with 715 passed, 32 skipped, and 1 failure that passed on re-run (`admin-apps` "items per page", the flake #69 lists), on desktop-light, desktop-dark and mobile-light.
    - **The Docker gate** ran on the owner's go-ahead ("you have my early permission for thr docker", then "yes ho" to the push, the PR and the #69 comment; 2026-10-15): the old image kept as `ai-app-hub-local-app:part2a` (no migration, so no dump); one `Database migration complete`, RestartCount 0, the same six migration rows and the same apps and conversations counts; no `[ag-ui]` or `@ag-ui/` in `.next/static`; every signed-out check as AGENTS.md lists, and `/api/health` 200 after a PostgreSQL restart.
    - **The PR** is #72 to `fork/overhaul`, with #67 and #68 to close at the merge; #69's answer-pending hint item is ticked, with a comment. The owner's browser check (spec §12, "2b done when") and the merge are the owner's; a problem the check finds becomes a fix on `feat/agui-hitl`.

66. **2b's look, settled on the dev server with the owner** (2026-10-15, after decision 65; ADR-0035).
    - **The loop.** The owner: "stop e2e tesing, i want a quick dev loop, where i tell you if it looks good or not, and you change based on what i tell you etc etc, e2e is for the end". `pnpm dev` on :5300 with the e2e stub agent beside it as a playground app (`http://127.0.0.1:5399/agui/agents/assistant`, audience `assistant`, the test-only secret of `.env.e2e`; keywords `tool`, `nested`, `gated`, `double`, `fragile`, `question`, `badquestion`, `form`, `confirm`, `expired`, `plan`, `finish plan`, `activity`, `error <code>`, `timeout`, `slow`). The owner: "keep it as is for now", so no `dev:stub` script yet. Unit tests and static checks per change; e2e and Docker at the end.
    - **Tool calls as AI Elements' `Tool`** ("i think the way https://elements.ai-sdk.dev/components/tool does it is very good and align with what i had in mind"): an antd Collapse card with the name and a status badge, the arguments and the result as plain JSON code blocks ("Parameters and Result be plain JSON code blocks like AI Elements"), the approval inside the card between them ("the approval should be shown inside the block like how ai elements does it"). An antd tree table with a Table/JSON switch was tried first and dropped.
    - **Every decision is recorded** ("basicly i want to record everything that happens in the chat, so even with other browsers or devices, it will still have all the data"): each run's stored `resume` is read back (`lib/chat/sent-answers.ts`), live and after a reload; unsent picks stay in the browser (the owner accepted that several open items at once are rare).
    - **Width:** "the width should be fixed to the chat width", within the chat-width switch; the narrow chat no longer shrinks as the window widens, in both chats (X's 15 % padding is 0 while the row is capped).
    - **One card look** ("i like the new card look, so can we make eveyrhting follow that?"), the question card keeping its layout ("keep the same layout, but change the card style to match the others"); X `Think` and the run-error Alerts stay as they are. **The box only around the action or the choice** ("the inner border should be for the choice you selected, like in the tool"; for the form, "the form itself shoudnt have a border, the border should only be for the button like the tool, keep the button on the right like the tool"); a sent form reads "Submitted" ("make it subbmited"); then "okay now contiute with the others": the questions' record shows each question over its answer, and a drafted answer reads like the answered card with Change.

67. **The chats scroll in use-stick-to-bottom** (2026-10-15; ADR-0036). The owner: "when i expand a card or thinking block, while expanding it jumps up and then down one while expanding, after expanding is fisnhed it return to its original place, thin only happen wehn that chat is not scrolled to the bottom, what cuase thta?", then "are you sure theres no fix for this? maybe its the way were layouting and layring stuff is what casuing this?". Measured on the real components in the real shell layout (Playwright Chromium and Firefox): our layout moves nothing; X's column-reverse auto-scroll holds the view by script and lags while a card animates, which Firefox shows once its scroll anchoring is off (about 170 px up and back). "yes prototype it so i can see": use-stick-to-bottom 1.1.6 around Bubble.List with `autoScroll` off, 0 px of movement in both browsers. "yes add it, and mark that its a workaround with the github issue or pr": the scroll box observer of upstream issue #40 and PR #43, marked, tracked by #73. "go with twice": the spring's stiffness 0.1. "if i send a messge while scrolled up, it doesnt auto scroll to the bottom": a send scrolls to the bottom. The final review moved the region to the library's `useStickToBottom` hook (its `StickToBottom.Content` adds a scrollbar gutter on both sides) and made "load earlier" let go of the bottom first. This is 2b's one new dependency, and it reverses the `autoScroll` kept in ADR-0017's note of 2026-10-07.

68. **2b passes its gates again after the look, and is merged** (2026-10-15). The owner: "okay i think were done for now, recored everyhing and fisnh up, adr pr etc etc", then "After you finish, you can push the PR and then merge them", and to update the 2b plan author's session so 2c can be planned with it.
    - **Records:** ADR-0035 (the one card, the recorded answers) and ADR-0036 (the scroll region), with notes on ADR-0008, ADR-0017 (its `autoScroll` note reversed), ADR-0033 and ADR-0034; the Part 2 spec's 2c ADR renumbered from the reserved 0035 to 0037; `docs/frontend-conventions.md`'s status; decisions 66–67.
    - **The final review** of the 28 loop commits (one critical, three important, seven minor) was fixed here, except the placement of an answered interrupt's card in its turn, which is the owner's call (#74). The e2e suite caught the critical one too ("load earlier" pulled a reader at the bottom back down).
    - **Gates** at `138b012a`: `next typegen` and tsc, oxlint, oxfmt, the antd lint at 0, i18next lint and status (zh and ar 100%), `pnpm test` 192 files and 2,545 tests, `pnpm test:db` 98, `pnpm test:ldap` 51, and the e2e suite on an empty PostgreSQL with 725 passed, 32 skipped and none failed, on desktop-light, desktop-dark and mobile-light.
    - **The Docker gate:** the local stack rebuilt from the branch: one `Database migration complete`, RestartCount 0, the same six migration rows; no `@ag-ui/` in `.next/static`; every signed-out check as AGENTS.md lists; `/api/health` 200 after a PostgreSQL restart. Windows' `/mnt/c` bridge answered "Cannot allocate memory" that afternoon, and Docker Desktop keeps the CLI's contexts there (`~/.docker/contexts` links to it), so the build ran with `DOCKER_CONFIG` pointing at a fresh folder inside WSL (C: was 96% full).
    - **Follow-ups:** #73 (remove the scroll workaround once use-stick-to-bottom ships its PR #43), #74 (the answered interrupt card's place in its turn).

69. **2c's open questions, answered** (owner, 2026-10-15, while 2c's plan was written; the plan's "User decisions" carry them). Each option offered said what changes and what does not; the recommended one came first.
    - **PDFs** are read with `pdfjs-dist` 6.4.299 ("pdfjs-dist 6.4.299 (Recommended)"). Option not taken: `unpdf` 1.9.0.
    - **A message may hold files and no text** ("Allow file-only (Recommended)"). Option not taken: text required.
    - **Long and empty text:** a file's text is cut at 100,000 characters with a note to the agent and on the file's card; a PDF without text is refused at upload ("Cut long, refuse empty (Recommended)"). Options not taken: refuse both; cut long and send empty.
    - **Images in the Logs:** every fetch of an attachment by someone other than its uploader is a `download` row, thumbnails included ("Every fetch is a download (Recommended)"). Option not taken: file cards that open on click.
    - **The Logs list has numbered pages** like the other admin tables ("Numbered pages"), replacing spec §7.2's keyset. Options not taken: "Load more"; Newer/Older pages.
    - **Name and bytes:** the extension claims the kind and the bytes must prove it ("Bytes prove the kind (Recommended)"). Options not taken: exact match; bytes decide everything.
    - **Unsent files** are left for the daily purge ("Leave it for the purge (Recommended)"); decision 70 reverses it.
    - **No notice in the chat:** the owner typed "don't show it" in place of the two placements offered, which reverses the notice part of decision 49.
    - Then: "after you finish all of your questions, I want you to look online for documentation, best practices, and relevant projects and how they deal with those". Three research passes followed (`part2c-files-logs.md`: R1 attachments, R2 documents and images, R3 the Logs).

70. **2c's answers after the research** (owner, 2026-10-15; `part2c-files-logs.md`).
    - **PDFs are read in a worker thread** with a 256 MB heap and a 10-second limit, after R2 measured a crafted 92 KB PDF stalling the event loop 3.9 s and a crafted 916 KB one crashing the process ("Worker thread (Recommended)"). Options not taken: a child process; the calling thread, as LibreChat and LobeHub do.
    - **Chat images may have 50 MP** (the iPhone 15 and later save 24 MP by default; logos and icons keep ADR-0030's 16.7 MP) ("Raise to 50 MP (Recommended)"). Options not taken: 25 MP; 16.7 MP.
    - **Text files may be UTF-8 or UTF-16 with a byte-order mark**, others refused with a "save as UTF-8" message ("UTF-8 or UTF-16 (Recommended)"). Options not taken: UTF-8 only; guessing legacy encodings.
    - **Removing a card deletes its unsent file, and a user may have at most 25 unsent files** ("Add a delete route too", after R1 found that nothing bounded unsent uploads), which reverses decision 69's "leave it for the purge". Options not taken: the limit alone; no limit.
    - **Four small additions**, all ticked: a download row names its attachment (`attachment_id`); a text file holding NUL is refused; an animated WebP is refused; JPEG and WebP are re-encoded at quality 90.
    - **The PDF worker's path carries `/* turbopackIgnore: true */`** ("Magic comment (Recommended)"), after the drafts found Turbopack 16.3.4 bundling a `worker_threads` worker into a chunk that breaks at run time: the placement Next's own server code uses, not described by Next's docs, so the one accepted exception to ADR-0002, recorded in ADR-0037 with a build check. Options not taken: a workspace package in `serverExternalPackages` (bundled too under this repo's pnpm linking, measured); no worker.
    - **Memory for the plan's checks:** "Yes, stop the app (Recommended)": the local app container was stopped while the drafters and the pre-flight ran, PostgreSQL kept running, and the app was started again at the end ("Let them finish (Recommended)" kept the drafters running during the exploration of decision 71).

71. **2c's plan is written** (2026-10-15): `docs/superpowers/plans/2026-10-15-part-2c-agui-files-logs.md`, 21 tasks with a `.tasks.json`, on `docs/part-2c-plan`, against `fork/overhaul` at `09000df4` (decision 33). Nine parallel drafts wrote Tasks 1–19 against the plan's shared contracts, each proven in its own scratch copy; then a pre-flight applied Tasks 1–19 in order to one copy: tsc clean, `pnpm test` 2,930, `pnpm test:db` 151, oxlint, oxfmt, the antd lint and the i18next checks clean, Task 7's build check as written, and the new e2e specs green on desktop-light, desktop-dark and mobile-light beside 2a's and 2b's AG-UI specs and the Dify chat's; five slips were fixed in the texts (the plan's "Pre-flight").
    - **Build or adopt.** While it was written, the owner asked: "so far we've been building everything from scratch which is a huge undertaking and we're bound to create errors. and in the end we will have w worse product that whats already available. why don't we just take an existing template. like full stack ai template. and just do the simple modification thats important to us. like ldap login and having different apps. can you explore that for me?"; then "dify is not a hard requirement for me. its was the initial idea but I've grown past it. im more interested in having agents code like pydantic ai and the others", and "keep the current 2c about dify. just the exploration shouldn't be limited by dify". Three passes (`build-vs-adopt.md`) compared the full-stack AI agent template, AgenticOS, Open WebUI and LibreChat with the hub's requirements, Dify left out. None serves code-defined agents from several frameworks as separate services with human in the loop (none speaks AG-UI), and each lacks the hub's LDAP groups, right-to-left Arabic or audited admin reading; the researchers' estimates to reach the hub's features ran from five weeks to four months plus a fork, against weeks to finish 2c. Claude's recommendation: finish the hub as a narrow agent portal, put tools, retrieval and MCP inside the agents, and run a general assistant such as LibreChat beside it if users need one. The owner has not ruled on it; 2c's plan stands as it is.
    - Next: the plan's PR, its review and merge, then the build on `feat/agui-files-logs` in its own session.

## Ideas kept for later

- **An "HTTP template" provider** (decision 52): an admin-defined request template and response mapping for text-only APIs. It would need its own spec and an ADR recording the deviation from ADR-0002, since it is a home-made mapping language. References: LibreChat's custom endpoints vary only headers and parameters of an OpenAI-compatible wire format; LobeHub's custom providers pick from fixed SDK types.

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

- ~~How per-provider settings are stored~~: decided (decision 17).
- ~~Conversation storage on the hub for providers that keep no history~~: decided for Part 2 (decisions 42, 49; the Part 2 spec §3).
- ~~The UI picks~~: Part 1's are decision 30; Part 2's are in its spec (decision 38 replaced the per-element picking with options and a recommendation).
- Part 3: what happens to conversations that exist only in Dify; whether Dify's workflow and completion views move onto AG-UI runs; audio, file previews, suggestions and feedback as shared capabilities or Dify extras.

## Research in this folder

- `part0-execution/`: Part 0's run records: the ledger, the rulings, the pre-flight scan, the docs check of the execution-time choices, the final review, the fix wave.
- `dify-coupling-map.md`: every place the code assumes Dify, classified as neutral core, Dify-only, or name only.
- `agui-and-reference-hubs.md`: the AG-UI protocol and `@ag-ui/client`, Pydantic AI's adapter, Ant Design X and AG-UI, and how LibreChat, Open WebUI and LobeChat model their providers.
- `agui-reference-projects.md`: `vstorm-co/full-stack-ai-agent-template`, `vstorm-co/agenticos` (build or adopt), the AG-UI Dojo, Pydantic AI's AG-UI examples.
- `agui-spike.md`: Part 2's spike (2026-10-14): findings, the answers to the charter's spike questions, and the spike's code to rerun it.
- `part2-store-and-logs.md`: AG-UI's persistence guidance, how AG-UI backends and five chat hubs store conversations, admin access and retention, PostgreSQL specifics.
- `part2-proxy-stop-identity.md`: `@ag-ui/client` on the server, CopilotKit's runtime, stop, identity headers, Test connection, Next 16 streaming.
- `part2-x-mapping.md`: the x-sdk 2.9 contract, X's unreleased AgentProvider, other AG-UI React clients, components per element, the hub's shareable chat code.
- `part2-hitl-state-files.md`: ask-user (frontend tool versus interrupt), approvals across frameworks, shared state, attachments and upload security.
- `part2c-files-logs.md`: Part 2c's research (2026-10-15): R1 attachments (file-only messages, name against bytes, unsent files, caps), R2 documents and images (pdf.js in Node with measurements, sharp, text encodings), R3 the Logs (the attachment audit, numbered pages, the notice).
- `build-vs-adopt.md`: the owner's question of 2026-10-15, the hub against the full-stack AI agent template, AgenticOS, Open WebUI and LibreChat (decision 71).
