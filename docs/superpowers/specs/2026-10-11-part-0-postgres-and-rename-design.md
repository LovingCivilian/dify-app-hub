# Part 0: PostgreSQL and the product rename (design)

Date: 2026-10-11 · Status: draft for the owner's review · Programme: `2026-10-11-provider-hub-charter.md` · Branch: `feat/postgres-and-rename` from `fork/overhaul` · Decisions: running record `docs/superpowers/research/2026-10-11-provider-hub/README.md`, numbers 3, 4 and 13–16, 23–25 · Docs check: `…/doc-verification.md` (rows cited as "DV 1a" and so on)

## 1. Goal and scope

The hub moves from MySQL 8.4 to PostgreSQL 18 and is renamed "AI App Hub". Nothing else changes in behaviour, with two exceptions, both recorded: email matching ignores case but no longer ignores accents (§3.4), and the built-in brand text changes.

**In scope:**

- the database engine, driver, schema, migrations and compose services;
- every MySQL-specific spot in the code and the tests;
- the product name in the operational files and the code;
- the rename steps for the GitHub repo and the local folders after merge.

**Out of scope:**

- the `apps` reshape and the code renames such as `dify_apps` → `apps` (Part 1);
- encryption of secrets (decision 8);
- a one-shot migrate service (decision 25, a follow-up before scaling out);
- the upstream-shaped documents (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `.all-contributorsrc`, `packages/docs/`). They stay for the postponed housekeeping work (memory `repo-housekeeping`), which rewrites them.

## 2. The database container

Every compose file that runs a database gets a `postgres` service on `postgres:18`, the current major version (18.6, supported to 2030-11-14, postgresql.org/support/versioning, checked 2026-10-11). The MySQL services are removed.

| Setting | Value | Source |
| --- | --- | --- |
| Credentials | `POSTGRES_PASSWORD` (required, non-empty), `POSTGRES_USER`, `POSTGRES_DB` | DV 7a, the image's docs |
| Volume | `pgdata:/var/lib/postgresql`. The 18 images moved `VOLUME` there, and the old `/var/lib/postgresql/data` mount applies only to 17 and below. | DV 7b |
| Shared memory | `shm_size: 128mb`. The default 64 MB can fail with "could not resize shared memory segment". | DV 7c |
| Healthcheck | `pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}`, with Docker's documented timings (`interval: 10s`, `timeout: 10s`, `retries: 5`, `start_period: 30s`). `-h` waits for TCP, because the first-start server listens only on the socket. | DV 7d |
| Startup order | The hub waits on `condition: service_healthy`, as it does for MySQL today | Compose "startup order" |

**The files:**

- `docker-compose.local.yml`:
  - project `ai-app-hub-local`;
  - containers `ai-app-hub-local-postgres` and `ai-app-hub-local-app`;
  - PostgreSQL published on `127.0.0.1:5432` only, for `pnpm dev` on the host;
  - values from `.env`.
- `docker-compose.e2e.yml`:
  - project `ai-app-hub-e2e`;
  - `postgres` on `127.0.0.1:5433`, with `tmpfs` at `/var/lib/postgresql` (throwaway, as MySQL's is today);
  - fixed test credentials `e2e`/`e2e`/`e2e`;
  - the LDAP services are unchanged apart from their container names.
- `docker-compose.yml`, the production template:
  - becomes the hub's own: the app plus `postgres`, on a named network `ai-app-hub-network`;
  - the image comes from `docker-bake.hcl`'s name (`${DOCKERHUB_USERNAME}/ai-app-hub`);
  - its comments switch from upstream's Chinese to English, like the other fork-owned files.
- `docker-compose.dev.yml` (upstream's "self-deploy" file) gets the new names.

## 3. The database layer

### 3.1 The driver and the connection

`pg` (node-postgres) through `drizzle-orm/node-postgres`, with `@types/pg` for types. `drizzle-orm` and `drizzle-kit` move from `1.0.0-rc.3` to `1.0.0-rc.4`, the newest tagged release candidate (npm dist-tag `rc`, 2026-06-27); its changelog is checked first. Drizzle documents both `pg` and `postgres.js`. Its notes favour `pg` here: type parsers per query, and no prepared statements by default (postgres.js's default "you may need to opt out of"). Its get-started guide uses `pg` (DV 1a). `pg` is in Next's default `serverExternalPackages` list, so `next.config.ts` needs no change (DV 1a). `mysql2` is removed.

**`db/index.ts`:**

1. `new Pool({ connectionString })`.
2. `pool.on('error', …)`, logging the error's name and code through `lib/error-log.ts`. node-postgres warns that without a listener an idle-client error "potentially crash[es] your node process" (DV 1b).
3. `drizzle({ client: pool, logger })`.

The `globalThis` singleton stays; its key is renamed `aiAppHubDb`.

**`db/migrate.ts`:** `migrate()` from `drizzle-orm/node-postgres/migrator`, run by `docker/entrypoint.sh` as today (decision 25).

**`drizzle.config.ts`:** `dialect: 'postgresql'`. The migrations log keeps Drizzle's default `drizzle.__drizzle_migrations`, the same table the runtime migrator reads (DV 1c).

### 3.2 Column types

| MySQL today | PostgreSQL | Source |
| --- | --- | --- |
| `datetime({ fsp: 3 })` + `CURRENT_TIMESTAMP(3)` | `timestamp({ withTimezone: true, mode: 'date' }).defaultNow()`, with no precision | DV 2a, DV 2b (the wiki: a precision rounds rather than truncates) |
| `varchar(n)` | `text`. A length limit lives in zod (`.max()`, ADR-0025), or in a CHECK where the database must hold it. | DV 11 (the wiki's "Don't use varchar(n) by default") |
| `varchar(36)` ids | `uuid()`, still generated by the app as now (`crypto.randomUUID()`, version 4), so an id is known before the insert (see the note below) | DV 11 (PostgreSQL's `uuid` type, Drizzle `uuid()`) |
| `mediumblob({ mode: 'buffer' })` | `bytea()` | DV 2c |
| `text` holding JSON (`apps.tags`, `instance_settings.data`) | `jsonb` | DV 2d ("most applications should prefer … `jsonb`") |
| `mysqlEnum` (role, access mode, membership source, the other static sets) | `pgEnum` | DV 2e. Static sets fit enums; Part 1's `apps.provider` is `text` with a CHECK instead (decision 24). |
| `boolean`, `int`, CHECK constraints, composite primary keys, foreign keys with cascade | the same in pg-core | the Drizzle pg column types |

**Why the ids use `uuid`, and the checks that come with it** (owner, 2026-10-11). `uuid` is PostgreSQL's documented type for UUIDs, and the database enforces the format. A string that is not a UUID raises `22P02 invalid_text_representation` instead of matching nothing (DV 11). So every id from outside is checked with `z.uuid()` before it reaches a query:

- the shared route guard (`resolveDifyRoute`), which covers all 26 `[appId]` route files;
- the chat page `app/(user)/chat/[appId]/page.tsx`;
- the icon route;
- the admin actions for apps, users and groups (four `z.uuid()` checks exist today; the rest are added);
- the directory groups route, where it takes an id.

A malformed id answers as an unknown one: 404 `app_not_found` or the action's `not_found`, as today. As a safety net, `lib/data/db-errors.ts` maps `22P02` to "not found", so a missed spot still gives 404 rather than 500. Ids from the session token are the hub's own and need no check.

**Indexes MySQL created silently.** PostgreSQL does not index the referencing columns of a foreign key; InnoDB did (DV 12). Part 0 adds:

- an index on `group_id` in `app_group_grants`;
- an index on `user_id` in `app_user_grants`;
- an index on `user_id` in `user_group_members`.

It also checks every other foreign key the same way.

### 3.3 Migrations

One baseline migration replaces the MySQL history:

- `db/migrations/` is emptied (git history keeps it);
- `drizzle-kit generate` writes the PostgreSQL baseline from the ported schema;
- `drizzle-kit migrate` and the entrypoint apply it to an empty database.

This is the fresh start of decision 14: no data is copied, and first-run setup runs again. AGENTS.md's migration rules hold (generate and migrate, never `push`).

### 3.4 What has to be re-derived

| MySQL spot | PostgreSQL form | Where | Source |
| --- | --- | --- | --- |
| Case-insensitive email through the column collation | A unique index on `lower(email)`. Every lookup becomes `lower(users.email) = lower($1)`, with `lower()` on both sides in SQL through one helper. **Recorded change:** MySQL's `utf8mb4_0900_ai_ci` also ignored accents; `lower()` does not. | `db/schema/users.ts`; `lib/auth/options.ts:32`, `lib/data/users.ts:198`, `lib/data/directory.ts:100`, `app/api/auth/forgot-password/route.ts:30` | DV 3a–3c (PostgreSQL's expression-index and citext pages, Drizzle's case-insensitive email guide). `citext` and nondeterministic collations are not chosen: the docs steer away from citext and keep collations for cases that need them (DV 3b). |
| The single-owner guard (B2's gap lock under `repeatable read`) | A partial unique index, `uniqueIndex('users_one_owner').on(t.role).where(sql\`role = 'owner'\`)`. `createOwner`loses`isolationLevel: 'repeatable read'`. | `db/schema/users.ts`, `lib/data/setup.ts:62` | DV 4 (PostgreSQL Example 11.3), DV 7 (Repeatable Read adds `40001` retries) |
| `ER_DUP_ENTRY` (1062), `ER_NO_REFERENCED_ROW_2` (1452), `ER_LOCK_DEADLOCK` (1213) | SQLSTATE `23505`, `23503`, `40P01`, read from the driver error under Drizzle's `DrizzleQueryError.cause`. Where one table has several unique indexes (`users`: email, directory id, one owner), the error's `constraint` field names the index. | `lib/data/db-errors.ts` and its callers | DV 5a, DV 5b (the errcodes appendix: "test the error code") |
| Logging `errno` | Log the SQLSTATE `code` and the error name only. `DrizzleQueryError` carries `params`, which are never logged. | `lib/error-log.ts`, `lib/auth/options.ts:68` | DV 5b |
| `affectedRows` | `(result.rowCount ?? 0) > 0`. PostgreSQL counts matched rows, as the code relied on from mysql2's `FOUND_ROWS`. | `lib/data/apps.ts:553`, `lib/data/groups.ts:342`, `lib/data/directory.ts:328,349,372,415`, `app/api/auth/reset-password/route.ts:69,82` | DV 5c |
| `onDuplicateKeyUpdate` | `onConflictDoUpdate({ target, set })`; pg-core has no `onDuplicateKeyUpdate` | `lib/data/settings.ts:145,155` | DV 8 |
| The sync's slot claim (an insert that a unique `slot` key refuses) | `onConflictDoNothing({ target: slot }).returning({ id })`; zero rows means "skip" | `lib/data/directory.ts:497-518` | DV 6 (`INSERT … ON CONFLICT DO NOTHING`) |
| The sync's membership batches with a row-by-row fallback on duplicates | `onConflictDoNothing()` on the batch insert. A missing parent (`23503`) still raises. | `lib/data/directory.ts` | DV 8 |
| Comments about gap locks, `FOUND_ROWS`, `max_allowed_packet` and InnoDB | Rewritten for PostgreSQL. The 1,000-id batches stay: PostgreSQL's limit is 65,535 parameters per statement. | the files above | DV 7 |
| Ids as text: a malformed id matched nothing | `uuid` columns. `z.uuid()` on every id from outside (§3.2), and `22P02` mapped to "not found" in `lib/data/db-errors.ts` as a safety net. | the guard, the chat page, the icon route, the admin actions | DV 11; PostgreSQL errcodes appendix |
| A caught error inside a transaction | Nothing to change today: every catch sits outside its transaction. A future catch inside one needs a nested `tx.transaction()` (a savepoint). | `lib/data/{groups,setup,directory}.ts` | DV 5d |

## 4. The product rename

The new name is "AI App Hub", in kebab case `ai-app-hub` (decision 4).

| File | Change |
| --- | --- |
| `package.json` | `name: "ai-app-hub"`; the docs package filter becomes `ai-app-hub-docs` (with `packages/docs/package.json`'s name) |
| `Dockerfile:12` | `pnpm --filter ai-app-hub deploy …` |
| `docker-bake.hcl` | image `${DOCKERHUB_USERNAME}/ai-app-hub` |
| `ecosystem.config.js` | app name `ai-app-hub` |
| compose files | project, container and network names (§2) |
| `.env.template` | the `MAIL_DEFAULT_SEND_FROM` display name; `DATABASE_URL=postgres://…`; `POSTGRES_*` replacing `MYSQL_*` |
| `.oxfmtrc.json:31` | the `.dify-app-hub` ignore entry is removed. It names a folder that nothing in this line creates; it came from upstream's `dify-chat` rename (`f650fb9d`). |
| `lib/settings/branding-rules.ts:4` | `BUILT_IN_BRAND_NAME = 'AI App Hub'` |
| `app/layout.tsx:34` | the description, for example "AI App Hub: the company's AI apps in one place" |
| `lib/directory/schedule.ts` and `db/index.ts` | the `globalThis` keys `aiAppHub…` |
| `components/chat/chat-view/chat-view.tsx:78` | the localStorage key `ai-app-hub-wide-screen`. Users lose the saved chat width once. |
| Tests | `e2e/branding.spec.ts`, `e2e/auth.spec.ts`, `__tests__/settings-branding.test.ts`, `__tests__/directory-schedule.test.ts`, `__tests__/error-log.test.ts`; the e2e LDAP seed's descriptions and the test CA's CN (`generate.sh`, regenerated) |
| `.env.e2e` | the comment and `DATABASE_URL=postgres://e2e:e2e@127.0.0.1:5433/e2e` |

**The built-in logo** (`assets/images/logo.png`, a blue "D" mark) stays as it is (owner, 2026-10-11). The real brand is set on the settings page (ADR-0030).

## 5. Operator steps (the owner's `.env` files, never printed or committed)

1. In `.env`:
   - replace `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` with `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD`;
   - set `DATABASE_URL=postgres://<user>:<password>@postgres:5432/<db>`.
2. In `.env.development.local`, set `DATABASE_URL` to the same database on `127.0.0.1:5432`.
3. Take down the old stack: `docker compose -f docker-compose.local.yml down` on the old checkout, before pulling Part 0. The old project name and MySQL volume belong to `dify-app-hub-local`; after a fresh start the volume can be removed.
4. Bring up the new stack, then run first-run setup and re-add the apps, groups and settings.

## 6. Tests

**Unit tests** (Vitest, node environment):

- **The driver mocks.** The data-layer tests built on `drizzle-orm/mysql2` mocks move to `drizzle-orm/node-postgres`.
- **`db-errors`.** It maps `23505`, `23503`, `40P01` and `22P02`, and reads the `constraint` field.
- **The id checks.** The route guard and the actions refuse malformed ids before any query.
- **The email lookups.** They render `lower()` on both sides; checked by asserting the SQL.
- **Write results.** Every `rowCount` consumer handles `null`.
- **The two conflict paths.** `onConflictDoUpdate` for settings, and the slot claim's `returning`.
- **The schema test files** (`b3a-schema`, `b3b-schema`) assert the PostgreSQL DDL: the partial unique index, the `lower(email)` index, the new foreign-key indexes, the enums and the CHECKs.

**e2e:**

- **The fixtures.** `e2e/fixtures/db.ts` uses a `pg` `Client`. The raw SQL in the fixtures and specs moves from `?` to `$1` and from `ON DUPLICATE KEY UPDATE` to `ON CONFLICT`.
- **New cases:**
  - signing in with the email in different case (local and directory accounts);
  - a second owner refused by the partial index on the first-run path;
  - a malformed app id (`/chat/abc`, `/api/dify/abc/parameters` signed in) answering 404, never 500.
- **The full suite** runs on all three projects against the throwaway PostgreSQL.

**`pnpm test:ldap`:** the directory suite, because the sync's claim and memberships change.

**The Docker gate:** a rebuild of `docker-compose.local.yml` from the branch, then the `CLAUDE.md` curl checks, plus:

- the migration applied to an empty volume;
- `/init` signed out answering 200 on the fresh database, then 307 to `/login` after setup;
- the hub surviving `docker compose restart postgres`, which exercises the pool's error listener.

## 7. Records

**ADR-0031 "Move the database to PostgreSQL 18"** supersedes ADR-0004. It records:

- the driver choice;
- the type mapping;
- the re-derivations;
- the fresh start;
- the entrypoint migration with its scale-out follow-up;
- the accent-sensitivity change.

The rename gets a dated note in the same PR (ADR-0019, the product-line record).

**`CLAUDE.md` changes:**

- "Local testing": PostgreSQL ports, project names, the reset commands, `.env.development.local`;
- the pointers;
- the decision line.

**`docs/auth-gate.md`:** what it says about MySQL's case-insensitivity.

## 8. After the merge: renaming the repo and the folders (owner, between sessions)

Run these with no Claude Code session open in either folder.

1. **The GitHub repo.** In the repo's Settings, rename `LovingCivilian/dify-app-hub` → `LovingCivilian/ai-app-hub`. GitHub redirects the old URL. Then `git remote set-url origin https://github.com/LovingCivilian/ai-app-hub.git` (the worktrees share one config).
2. **The linked worktree first, from the main folder.** `git worktree move ~/repos/dify-app-hub-main ~/repos/ai-app-hub-main` (git-worktree: `move` updates the administrative files).
3. **The main worktree.**
   - `mv ~/repos/dify-app-hub ~/repos/ai-app-hub`;
   - `cd ~/repos/ai-app-hub && git worktree repair`. git-worktree: "if the main worktree … is moved, linked worktrees will be unable to locate it. Running repair in the main worktree will reestablish the connection".
4. **Claude Code's project directory.** `mv ~/.claude/projects/-home-madany-repos-dify-app-hub ~/.claude/projects/-home-madany-repos-ai-app-hub`. It holds the memory and the session history. Then update the folder paths inside the memory files (`two-product-lines`, `fork-claude-md-source-of-truth`, `provider-hub-brainstorm`).
5. **`fork/main`'s `CLAUDE.md`** names its folder (`~/repos/dify-app-hub-main`). Its path lines change in a small docs PR to `fork/main`. Its content stays upstream-shaped (ADR-0019), and its compose project keeps its own name.
6. **This line's `CLAUDE.md`** paths change in the first PR after the move (Part 1's).

## 9. Done when

- Every gate in `CLAUDE.md` passes on PostgreSQL:
  - typegen and `tsc`, oxlint and oxfmt;
  - `pnpm test`;
  - the e2e suite on three projects;
  - `pnpm test:ldap`;
  - the Docker gate with the extra checks in §6.
- No `mysql2` or mysql-core import remains (`grep`).
- The product name appears as "AI App Hub" wherever §4 lists it.
- ADR-0031 is accepted after the owner's check.
