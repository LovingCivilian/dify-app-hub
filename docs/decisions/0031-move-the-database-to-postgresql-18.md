---
status: proposed
date: 2026-10-11
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (provider-hub brainstorm, Part 0 spec and plan)
---

# Move the database to PostgreSQL 18

## Context and Problem Statement

[ADR-0004](0004-keep-mysql-through-drizzle.md) kept MySQL 8.4 through Drizzle because a port would have touched upstream-owned backend files on every sync. [ADR-0022](0022-treat-the-overhaul-line-as-fully-fork-owned.md) took that reason away: this line is fork-owned and takes upstream by cherry-pick only. ADR-0004's note of 2026-10-09 records the owner's wish to move to PostgreSQL, which their other projects and Dify on the production server run.

The provider-hub programme (charter `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`) turns the hub into "AI App Hub", a front for AI apps of several providers. Its Parts 1 to 3 store provider settings and secrets as `jsonb` and keep a message store, so the owner put the move first, as Part 0 (running record `docs/superpowers/research/2026-10-11-provider-hub/README.md`, decision 13), with a fresh start (decision 14: no hub data, local or production, has to survive), in the hub's own container (decision 15), on the design approved as decision 16 and corrected by the documentation check `doc-verification.md` (decision 23; rows cited below as "DV 1a" and so on), with migrations still run by the container's entrypoint (decision 25) and `uuid` ids (decision 27).

The question: which PostgreSQL, in which container, through which driver and column types; how the MySQL-specific behaviours the code relies on are re-derived; and how the move is proven.

## Decision Drivers

- Documented approaches only ([ADR-0002](0002-use-documented-library-approaches-only.md)); every piece below was checked against its docs in `doc-verification.md`.
- Parts 1 to 3 are written for PostgreSQL: `jsonb` documents, partial unique indexes, `ON CONFLICT`.
- The hub's upgrades, backups and restarts stay independent of Dify's (decision 15).
- No data has to survive (decision 14), so there is no data migration to write or test.
- One engine across the dev loop, the Docker stack, the e2e suite and a live test of the data layer.
- One production container today; several containers later (`CLAUDE.md`, "Deployment").
- No other change in behaviour, apart from the ones recorded here (spec §1).

## Considered Options

Where the database runs:

- **PostgreSQL 18 in the hub's own container** (chosen). The current major, 18.6, supported to 2030-11-14 (postgresql.org/support/versioning, checked 2026-10-11).
- **The PostgreSQL that Dify already runs on the production server.**
- **Stay on MySQL 8.4** (ADR-0004).

The driver:

- **`pg` (node-postgres) through `drizzle-orm/node-postgres`** (chosen).
- **`postgres` (postgres.js) through `drizzle-orm/postgres-js`.**

The data:

- **A fresh start with one baseline migration** (chosen).
- **Copy the MySQL data across.**

Ids:

- **PostgreSQL's `uuid` type, with every id from outside checked first** (chosen).
- **`text` ids**, as MySQL's `varchar(36)`.

Case-insensitive email:

- **A unique index on `lower(email)`, and `lower()` on both sides of every lookup** (chosen).
- **The `citext` extension.**
- **A nondeterministic collation.**

The single owner:

- **A partial unique index on `role` where `role = 'owner'`** (chosen).
- **B2's locking read under REPEATABLE READ**, as on MySQL.

Migrations:

- **Each container migrates at start, in its entrypoint** (chosen for now).
- **A one-shot `migrate` service the app services wait on.**

## Decision Outcome

Chosen: PostgreSQL 18 in the hub's own container, reached through `pg` and `drizzle-orm/node-postgres`, from one baseline migration on an empty database, with `uuid` ids, an expression index for case-insensitive emails, a partial unique index for the single owner, and the entrypoint migrating at start. Every MySQL-specific behaviour the code relied on is re-derived in its documented PostgreSQL form, each with a test, and a live test project proves the ones a mock cannot.

### The container

- Every compose file that runs a database has a `postgres` service on `postgres:18`; the MySQL services are gone. Credentials `POSTGRES_PASSWORD` (required, non-empty), `POSTGRES_USER`, `POSTGRES_DB` (the image's docs, DV 7a).
- The volume is mounted at `/var/lib/postgresql` (`pgdata:/var/lib/postgresql`): the 18 images moved `VOLUME` there and keep `PGDATA` at `/var/lib/postgresql/18/docker`; the old `/var/lib/postgresql/data` mount applies to 17 and below (DV 7b).
- `shm_size: 128mb`: the default 64 MB `/dev/shm` can fail with "could not resize shared memory segment" (the image's "Caveats", DV 7c).
- Healthcheck `pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}` with Docker's documented timings (`interval: 10s`, `timeout: 10s`, `retries: 5`, `start_period: 30s`); `-h` waits for TCP, because the first-start server listens on the Unix socket only (DV 7d). The hub waits on `condition: service_healthy` (Compose "Control startup order").
- `docker-compose.local.yml`: project `ai-app-hub-local`, PostgreSQL published on `127.0.0.1:5432` only. `docker-compose.e2e.yml`: project `ai-app-hub-e2e`, PostgreSQL on `127.0.0.1:5433` with `tmpfs` at `/var/lib/postgresql`, credentials `e2e`/`e2e`/`e2e`. `docker-compose.yml`, the production template, becomes the hub's own: the app plus `postgres` on the network `ai-app-hub-network`.

### The driver and the connection

- `pg` ^8.23.1 with `@types/pg` ^8.23.1; `drizzle-orm` and `drizzle-kit` `1.0.0-rc.4`, exact (npm dist-tag `rc`, its release notes checked); `mysql2` removed. Drizzle documents both `pg` and postgres.js; its notes favour `pg` here (per-query type parsers; postgres.js prepares statements by default, which "you may need to opt out of"), and its get-started guide uses `pg` (DV 1a). `pg` is in Next's default `serverExternalPackages`, so `next.config.ts` is unchanged.
- `db/index.ts` builds `new Pool({ connectionString, connectionTimeoutMillis: 10_000 })`, adds `pool.on('error', …)`, then `drizzle({ client: pool, logger })`, kept on `globalThis.aiAppHubDb`. node-postgres: an idle client whose server goes away emits `error` through the pool, the client "will be automatically terminated and removed from the pool", and with no listener Node "will emit an uncaught error and potentially crash your node process" (node-postgres "Pool", events; DV 1b). The listener logs the error by name and code.
- `db/migrate.ts` runs `migrate()` from `drizzle-orm/node-postgres/migrator`; `drizzle.config.ts` says `dialect: 'postgresql'`; both use Drizzle's default log `drizzle.__drizzle_migrations` (DV 1c, 1d).

### Column types

| MySQL | PostgreSQL | Source |
| --- | --- | --- |
| `datetime(3)` with `CURRENT_TIMESTAMP(3)` | `timestamp({ withTimezone: true, mode: 'date' }).defaultNow()`, no precision | DV 2a; DV 2b (PostgreSQL wiki "Don't Do This": a precision rounds rather than truncates) |
| `varchar(n)` | `text`; a length limit lives in zod (ADR-0025) | DV 11 (wiki: "Don't use varchar(n) by default") |
| `varchar(36)` ids | `uuid`, still generated by the app (`crypto.randomUUID()`), so an id is known before the insert | DV 11 (PostgreSQL "UUID Type") |
| `mediumblob` | `bytea` | DV 2c |
| `dify_apps.tags` (text holding JSON), `instance_settings.data` (`json`) | `jsonb` | DV 2d ("most applications should prefer to store JSON data as `jsonb`") |
| `mysqlEnum` | `pgEnum`: `user_role`, `account_source`, `access_mode`, `membership_source`, `sync_trigger`, `sync_outcome`, in `db/schema/enums.ts` and exported from the schema module, where drizzle-kit collects them | DV 2e; Drizzle "PostgreSQL column types", enum |
| `boolean`, `int`, CHECKs, composite primary keys, foreign keys with cascade | the same in pg-core | Drizzle's pg column types |

The table names stay (`dify_apps` until Part 1). PostgreSQL does not index the referencing columns of a foreign key, which InnoDB did (PostgreSQL "Constraints", Foreign Keys; MySQL 8.4 "FOREIGN KEY Constraints"; DV 12), so three indexes are added: `app_group_grants_group_id_idx`, `app_user_grants_user_id_idx`, `user_group_members_user_id_idx`. Every other foreign key's column is the leading column of its table's primary key.

### Migrations

`db/migrations/` was emptied (git keeps the MySQL history) and `drizzle-kit generate` wrote one baseline, `db/migrations/<timestamp>_baseline/`, applied to an empty database by `drizzle-kit migrate` and by the entrypoint. AGENTS.md's rule holds: generate and migrate, never `push`.

### Re-derived MySQL behaviours

| MySQL behaviour the code relied on | PostgreSQL form | Source |
| --- | --- | --- |
| Case-insensitive emails through the column's collation | `uniqueIndex('users_email_key').on(lower(t.email))`; every lookup through `emailMatches(email)` (`lib/data/email.ts`), `lower(users.email) = lower($1)`, in the sign-in, the users DAL, the directory DAL and the forgot-password route | DV 3a–3c (PostgreSQL "Indexes on Expressions" and "citext": "you always have to remember to use `lower` on both the column and the query value"; Drizzle guide "Unique and Case-Insensitive Email Handling") |
| The single owner through B2's gap lock under REPEATABLE READ | ``uniqueIndex('users_one_owner').on(t.role).where(sql`role = 'owner'`)``; `createOwner` runs at the default READ COMMITTED and answers any `23505` as `forbidden` | DV 4 (PostgreSQL "Partial Indexes", Example 11.3); DV 7 (REPEATABLE READ adds `40001` failures callers "must be prepared to retry") |
| `ER_DUP_ENTRY` 1062, `ER_NO_REFERENCED_ROW_2` 1452, `ER_LOCK_DEADLOCK` 1213 | `isUniqueViolation(error, constraint?)` (`23505`, reading the error's `constraint` where a table has several unique indexes), `isForeignKeyViolation` (`23503`), `isDeadlock` (`40P01`), `isInvalidTextRepresentation` (`22P02`), on the driver error under Drizzle's `DrizzleQueryError.cause` | DV 5a, 5b (PostgreSQL "Error Codes": "Applications that need to know which error condition has occurred should usually test the error code") |
| mysql2's `affectedRows` with `FOUND_ROWS` | `(result.rowCount ?? 0) > 0`; PostgreSQL counts the matched rows | DV 5c (node-postgres "Result"; PostgreSQL "UPDATE", Outputs) |
| `onDuplicateKeyUpdate` | `onConflictDoUpdate({ target, set })` | DV 8 (Drizzle "Upsert"; PostgreSQL "INSERT", ON CONFLICT) |
| The sync's slot claim, an insert a unique key refuses | `onConflictDoNothing({ target: slot }).returning({ id })`; no row back means "skip" | DV 6 |
| The sync's membership batches with a row-by-row fallback on duplicates | `onConflictDoNothing()`; a missing parent (`23503`) is still retried row by row and marks its group | DV 8 |
| Comments on gap locks, `FOUND_ROWS`, `max_allowed_packet` and InnoDB | rewritten for PostgreSQL; the 1,000-id batches stay, under PostgreSQL's 65,535 parameters per statement (the Bind message counts them in an Int16) | DV 7 (PostgreSQL "Message Formats") |
| A caught error inside a transaction | nothing changes: every catch sits outside its transaction; a future catch inside one needs a nested `tx.transaction()` (a savepoint) | DV 5d |

### Ids from outside

PostgreSQL's `uuid` type refuses a string that is not a UUID with `22P02 invalid_text_representation` instead of matching nothing (DV 11). Every id from outside is therefore checked with `idSchema = z.uuid()` (`lib/ids.ts`) before it reaches a query: in `resolveDifyRoute` (all 25 `app/api/dify/[appId]/…` route files), the chat page, the icon route, and the admin actions and their schemas for apps, users and groups (`userIdSchema` and `groupIdSchema` are `idSchema`; ADR-0024 decision h, "account ids are not checked as UUIDs", ends with the fresh start, since every id is now the hub's own UUID). A malformed id answers as an unknown one: 404 `app_not_found`, `icon_not_found` or the action's `not_found`. As a safety net, a `22P02` that reaches `toActionFailure` or `errorResponseFrom` is logged and answered as not found, never as a 500. Ids from the session token are the hub's own and are not checked. The directory groups route takes no id (`?q=` only).

### Errors and logs

`describeError` (`lib/error-log.ts`) logs a `DrizzleQueryError` and a bare pg `DatabaseError` by name and SQLSTATE code only: the driver error's `detail` carries the refused value (an email in `Key (lower(email))=(…) already exists.`), a `22P02` message carries the malformed input, and `DrizzleQueryError` carries the query's parameters. MySQL's `errno` is gone; Node's own socket errors keep their `errno`.

### Tests

- Unit tests (Vitest, node environment) on `drizzle-orm/node-postgres`'s `drizzle.mock()`: the rendered SQL of the locking reads, the email lookups and the conflict paths; the error predicates; the id checks; the `rowCount` consumers with `null`; the schema's DDL (`__tests__/db-baseline.test.ts` and the schema tests).
- A live test project, `pnpm test:db` (`__tests__/db/*.db.test.ts`), a Vitest project of its own like `pnpm test:ldap` ([ADR-0029](0029-sign-directory-accounts-in-over-ldap-and-keep-them-in-step-with-a-scheduled-sync.md)): it starts the e2e compose's `postgres`, recreates and migrates the database `hub_dal`, and runs the data layer against it: the `lower(email)` index, two concurrent first runs leaving one owner, the error predicates on real driver errors, the email lookups in another case, the slot claim and the membership batches. A mock cannot prove an index or a conflict.
- The e2e suite on the three projects against a throwaway PostgreSQL ([ADR-0010](0010-verify-the-frontend-with-playwright-and-a-stub-dify-api.md)), with new cases: signing in with the email in another case (local and directory), an account whose email differs only in case refused, a second owner refused by the partial index, and a malformed app id answering as an unknown app.
- The Docker gate: the migration applied to an empty volume, `/init` on the fresh database, and the hub surviving `docker compose restart postgres`.

### Behaviour changes, recorded

- **Email matching ignores case but no longer ignores accents.** MySQL's `utf8mb4_0900_ai_ci` collation treated `josé@example.com` and `jose@example.com` as one address; `lower()` does not (spec §3.4). `citext` and nondeterministic collations were not chosen (below).
- **Group names, the same.** The collation also kept group names unique without case (B3a deviation 2, pinned by `e2e/admin-groups.spec.ts`). `user_groups_name_key` is a unique index on `lower(name)`, so "Finance" and "finance" are still one name, and "Équipe" and "Equipe" are now two (a gap in the spec, closed while planning: spec §1 promises no other change).
- **Two first saves of a settings area at once: the later one wins.** MySQL's gap lock queued the second first save behind the first, which then built on the first's document. PostgreSQL locks only rows a read returns, so before the area's row exists both saves build from no document and the upsert keeps the later one (`lib/data/settings.ts`, `writeInstanceSetting`). Once the row exists, saves queue on its lock as before. Found while planning; the spec does not mention it.
- **The connection's wait is kept.** node-postgres's pool waits for a connection without a limit by default (`connectionTimeoutMillis`: "By default this is 0 which means no timeout", node-postgres "Pool"); the hub sets `connectionTimeoutMillis: 10_000`, the 10 s mysql2 used (`db/index.ts`), so a database that does not answer still fails a request after 10 s ([ADR-0030](0030-set-each-settings-area-from-the-environment-or-the-admin-page.md)'s login-page note).
- **The fresh start.** First-run setup runs again, and the apps, groups, grants and settings are added again by hand (spec §5).

### Corrections to the spec's text

The plan's corrections to the spec's text were applied to the spec while planning (commit 1cfec7a8).

### Consequences

- Good, because Parts 1 to 3 can store provider settings, secrets and messages as `jsonb`, and the database enforces what MySQL left to the application: the UUID format, one owner, case-insensitive email uniqueness.
- Good, because the hub's database is its own: upgrading, backing up or restarting Dify does not touch it.
- Good, because a database restart no longer risks the hub process: the pool's listener logs the error and the pool replaces the client.
- Good, because the live test project proves the indexes, the conflict paths and the error codes against a real server.
- Bad, because every id from outside needs its `z.uuid()` check; a missed one is caught as `22P02`, logged and answered as not found.
- Bad, because a value added to a PostgreSQL enum cannot be used in the transaction that adds it, and Drizzle's migrator runs every pending migration in one transaction (DV 1d, DV 2e; PostgreSQL "ALTER TYPE", Notes). A migration that adds an enum value ships in a deploy where no migration uses that value, and a value cannot be removed short of re-creating the type. The static sets stay enums (decision 24); Part 1's `apps.provider` is `text` with a CHECK.
- Bad, because `migrate()` takes no lock: two hub containers starting together race, and the loser fails `set -e` and restarts (decision 25). Before running several containers, migrations move to a one-shot `migrate` service with `depends_on: { migrate: { condition: service_completed_successfully } }` (Compose "Control startup order").
- Bad, because emails, and group names, that differ only in accents are now two.
- Neutral, because no data is kept: the owner sets the hub up again after the move (spec §5).
- Neutral, because the `fork/main` line keeps MySQL ([ADR-0019](0019-keep-two-product-lines.md)); its copy of ADR-0004 is unchanged.

## Implementation Plan

- **Affected paths**: `package.json`, `pnpm-lock.yaml`, `drizzle.config.ts`, `db/index.ts`, `db/migrate.ts`, `db/schema/{enums,users,apps,groups,app-grants,directory,password-reset-tokens,settings,index}.ts`, `db/migrations/<timestamp>_baseline/`, `lib/data/{db-errors,email,users,setup,groups,apps,directory,settings}.ts`, `lib/error-log.ts`, `lib/action-failure.ts`, `lib/dify/{errors,route}.ts`, `lib/ids.ts`, `lib/auth/options.ts`, `app/api/auth/{forgot,reset}-password/route.ts`, `app/(user)/chat/[appId]/page.tsx`, `app/api/apps/[appId]/icon/route.ts`, `app/(admin)/app-management/actions.ts`, `app/(admin)/{app,user,group}-management/schemas.ts`, `docker-compose{,.local,.e2e,.dev}.yml`, `.env.template`, `.env.e2e`, `vitest.config.ts`, `tsconfig.json` (`tmp` excluded), `__tests__/db/`, `e2e/global-setup.ts`, `e2e/fixtures/{db,users,access,directory,branding}.ts` and the specs with raw SQL, `docs/auth-gate.md`, `docs/ldap.md`.
- **Dependencies**: add `pg` ^8.23.1 and (dev) `@types/pg` ^8.23.1; `drizzle-orm` and `drizzle-kit` `1.0.0-rc.4`, exact; remove `mysql2`.
- **Patterns to follow**: new tables in `drizzle-orm/pg-core` with `uuid` ids, `text`, `timestamp` with time zone and no precision, `jsonb` read through a zod parse; an index on every foreign-key column that is not the leading column of a primary key; enums for static sets only, exported from `db/schema/index.ts`; email lookups through `emailMatches`; ids from outside through `idSchema`/`isId`; refusals through the `lib/data/db-errors.ts` predicates, with the constraint's name where a table has several unique indexes; upserts with `onConflictDoUpdate`, claims with `onConflictDoNothing().returning()`; write counts from `rowCount ?? 0`; a test in `__tests__/db/` for any behaviour that rests on an index, a constraint or a conflict clause.
- **Patterns to avoid**: `varchar(n)` by default; a timestamp precision; JSON in `text`; `eq(users.email, …)`; a case-insensitive match written as `LIKE` (use `ilike` or `lower()`); catching a database error inside a transaction without a savepoint; logging a database error's `detail`, message or parameters; `drizzle-kit push`; Dify's PostgreSQL; a migration that adds an enum value and uses it in the same deploy.
- **Configuration**: `.env`: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` replace `MYSQL_*`, and `DATABASE_URL=postgres://<user>:<password>@postgres:5432/<db>`; `.env.development.local`: the same database on `127.0.0.1:5432`; `.env.e2e`: `postgres://e2e:e2e@127.0.0.1:5433/e2e`.
- **Migration steps** (spec §5, the owner): take the old stack down (`docker compose -p dify-app-hub-local down`, after a `--dry-run`, as the branch's compose file names the new project; the old project and its MySQL volume are `dify-app-hub-local`'s), edit `.env` and `.env.development.local`, bring the new stack up, run first-run setup, add the apps, groups and settings again; the old MySQL volume can then be removed.

### Verification

- [ ] `git grep -nE "from '(mysql2|drizzle-orm/mysql)|drizzle-orm/mysql-core|image: mysql" -- . ':!docs/**' ':!*.md'` prints nothing, and `grep -nE "^  mysql2@" pnpm-lock.yaml` prints nothing (spec §9 asks for no import; history notes in comments and drizzle-orm's optional-peer entries in the lockfile stay).
- [ ] `drizzle.config.ts` says `dialect: 'postgresql'`, and `db/migrations/` holds one folder, `<timestamp>_baseline`.
- [ ] `pnpm exec next typegen && pnpm exec tsc --noEmit`, oxlint and oxfmt are clean; `pnpm test` passes.
- [ ] `pnpm test:db` passes.
- [ ] `pnpm test:ldap` passes.
- [ ] `pnpm test:e2e` passes on `desktop-light`, `desktop-dark` and `mobile-light` against the throwaway PostgreSQL, the new cases included.
- [ ] The Docker gate: the migration applied to an empty volume; `/init` signed out answers 200 on the fresh database and 307 to `/login` after setup; after `docker compose -f docker-compose.local.yml restart postgres` the hub answers `/api/health` 200; the `CLAUDE.md` curl checks pass.
- [ ] The owner's check on the local stack.

## Pros and Cons of the Options

### PostgreSQL 18 in the hub's own container

- Good, because the hub's upgrades, backups and restarts stay its own, and the same service runs in every compose file.
- Bad, because the production server runs a second PostgreSQL beside Dify's (memory and backups).

### The PostgreSQL Dify already runs

- Good, because one server to run and back up.
- Bad, because the hub would share Dify's upgrades, restarts and version, and a Dify upgrade could take the hub down with it.

### Stay on MySQL 8.4

- Good, because nothing changes.
- Bad, because Parts 1 to 3 would be designed around MySQL's `json` and the owner's other projects and Dify run PostgreSQL; ADR-0004's reason is gone (ADR-0022).

### `pg` (node-postgres)

- Good, because it is Drizzle's get-started driver, allows type parsers per query, sends no prepared statements by default, and is in Next's default `serverExternalPackages`.
- Bad, because its pool needs an explicit error listener and an explicit connect timeout (both set in `db/index.ts`).

### postgres.js

- Good, because it is fast and documented by Drizzle.
- Bad, because it prepares statements by default, which "you may need to opt out of" behind a pooler (DV 1a).

### A fresh start

- Good, because one baseline replaces twelve MySQL migrations and no data migration is written or tested.
- Bad, because the owner sets the hub up again (decision 14 accepts it: no data has to survive).

### Copying the data

- Good, because accounts, apps and grants would survive.
- Bad, because a one-off copy tool would be written, tested and thrown away for data the owner does not need.

### `uuid` ids

- Good, because the database enforces the format, and every id is the hub's own.
- Bad, because a malformed id raises `22P02` instead of matching nothing, so every id from outside is checked first.

### `text` ids

- Good, because a malformed id simply matches nothing.
- Bad, because the type check is given up.

### A `lower(email)` index with `lower()` on both sides

- Good, because both PostgreSQL's expression-index page and Drizzle's case-insensitive email guide document it, and the same function builds the index and runs the lookup.
- Bad, because accents now count, and every lookup must go through the helper.

### `citext`

- Good, because comparisons ignore case without a helper.
- Bad, because PostgreSQL's own page steers away from it: "Consider using nondeterministic collations … instead of this module" (DV 3b).

### A nondeterministic collation

- Good, because it can ignore case and accents together, as MySQL's collation did.
- Bad, because PostgreSQL says "their use leads to a performance penalty … they should be used only in cases where they are specifically wanted", B-tree deduplication is lost, and `ILIKE` and regular expressions do not support them (DV 3b).

### A partial unique index for the owner

- Good, because the database itself refuses a second owner, whatever the isolation level (PostgreSQL Example 11.3).
- Bad, because the loser of a race learns it from a `23505`, which `createOwner` maps to `forbidden`.

### REPEATABLE READ locking

- Good, because it is what B2 built on MySQL.
- Bad, because PostgreSQL has no gap locks, so a locking read of an empty table locks nothing, and REPEATABLE READ adds `40001` failures to retry (DV 7).

### Migrating in the entrypoint

- Good, because one container needs nothing more, as today (decision 25).
- Bad, because `migrate()` takes no lock, so several containers starting together race.

### A one-shot `migrate` service

- Good, because it migrates once before any app container starts (Compose `service_completed_successfully`).
- Bad, because it is a second service to run, not needed for one container; it is the follow-up before scaling out.

## More Information

Supersedes [ADR-0004](0004-keep-mysql-through-drizzle.md). Spec: `docs/superpowers/specs/2026-10-11-part-0-postgres-and-rename-design.md` (owner-approved 2026-10-11). Plan: `docs/superpowers/plans/2026-10-11-part-0-postgres-and-rename.md`. Charter: `docs/superpowers/specs/2026-10-11-provider-hub-charter.md`. Decisions 13 to 16 and 23 to 28: `docs/superpowers/research/2026-10-11-provider-hub/README.md`. Documentation check: `docs/superpowers/research/2026-10-11-provider-hub/doc-verification.md`. The product rename that ships in the same PR is a dated note on [ADR-0019](0019-keep-two-product-lines.md).

Follow-ups: a one-shot `migrate` service before running several hub containers; accent-insensitive email matching, if it is ever wanted, through a nondeterministic collation.

Sources: PostgreSQL 18 documentation ("Date/Time Types", "Binary Data Types", "JSON Types", "Enumerated Types", "ALTER TYPE", "UUID Type", "Indexes on Expressions", "Partial Indexes", "citext", "Collation Support", "Constraints", "INSERT" (ON CONFLICT), "UPDATE", "Transaction Isolation", "Error Codes", "Message Formats", "psql"); the PostgreSQL wiki "Don't Do This"; postgresql.org/support/versioning; the `postgres` image's documentation on Docker Hub; Docker Compose "Control startup order"; node-postgres ("Pool", "Result"); Drizzle ("Get started with PostgreSQL", "PostgreSQL column types", "Indexes & Constraints", "Upsert", "Migrations", the guide "Unique and Case-Insensitive Email Handling"); the Drizzle 1.0.0-rc.4 release notes. `DrizzleQueryError.cause` and pg's `DatabaseError.code` and `.constraint` are documented only by the installed packages' type declarations (`drizzle-orm` `errors.d.ts`; `pg-protocol` `messages.d.ts`) and the PostgreSQL protocol's ErrorResponse fields (`C`, `n`), not by the docs sites. Related: ADR-0002, ADR-0010, ADR-0019, ADR-0022, ADR-0023, ADR-0024, ADR-0025, ADR-0027, ADR-0029, ADR-0030.
