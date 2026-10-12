# Part 0 — final whole-branch review (2026-10-12)

Three Opus seats reviewed disjoint parts of the branch at `2464e86f`: A (product code, schema, infra, e2e), B (`__tests__/`), C (records). Their findings merged into one fix wave (`fix-wave-report.md`).

## Seat A

## Final review, seat A: product code, schema, baseline migration, infra, e2e

Branch `feat/postgres-and-rename`, 79e72a05..2464e86f. I read the package `final-A.diff` in four passes (lines 1–1100, 1100–2500, 2500–3950, 3950–4698). I also read these files on the branch and in `node_modules`: `lib/auth/{session,options}.ts`, `proxy.ts`, `docker/entrypoint.sh`, `lib/data/{users,groups,directory,apps}.ts`, `lib/helpers/id.ts`, the three compose files, `__tests__/compose-files.test.ts`, `__tests__/db/global-setup.ts`, next-auth's `core/routes/session.js` and `next/index.js`, pg-pool's `index.js`, pg's `lib/client.js`, drizzle-orm's `node-postgres/{session,codecs}.js`, Next's `server/lib/{router-server,start-server}.js` and pg's `package.json` exports. I checked one docs point through Context7 (`/websites/node-postgres`, the pool and client error events). I ran no containers and no test suites, and wrote nothing outside this file.

#### Strengths

- **The error mapping holds together across the layers.**
  - The baseline names `users_email_key`, `users_directory_id_key`, `users_one_owner`, `user_groups_name_key` and `directory_sync_runs_slot_key`. These are the names the DAL passes to `isUniqueViolation`.
  - `createUser` and `updateUser` narrow to `users_email_key`, so a `users_one_owner` refusal is not misreported as `email_in_use`.
  - `refusalOf` in `lib/data/groups.ts:224` narrows to `user_groups_name_key`. On MySQL, a duplicate on the membership primary key read as `name_in_use`; now it is `operation_failed`. That is an improvement.
  - The enum types are built from the same `ROLES`/`ACCESS_MODES`/… constants that the zod schemas use.
- **Review Focus 4 (malformed ids), traced end to end.**
  - All 25 `app/api/dify/[appId]/**/route.ts` files go through `resolveDifyRoute`; I checked each one, and none touches the DAL itself.
  - The chat page, the icon route and the nine id-taking actions (users ×5, groups ×2, apps ×2) check `isId`/`idSchema` before any query. Member and grant lists go through `userIdSchema = idSchema`.
  - The only other dynamic segment is `[...nextauth]`.
  - The 22P02 safety net sits in `toActionFailure` and `errorResponseFrom`, and both log by code only. Pages have no net, but the chat page is the only page that takes an id.
- **Review Focus 1 and 5 (email case).**
  - All four email lookups go through `emailMatches`, and no other `eq(users.email, …)` remains (checked with grep).
  - The login form sends the typed value without normalising it, so `e2e/auth.spec.ts`'s upper-case sign-in exercises the server path rather than a client-side lower-casing.
  - In the directory sign-in, a refreshed email that differs only in case finds the account itself (`taken.id !== known.id`), so it is not a conflict.
  - A racing insert is refused by `users_email_key` and answered `email_in_use`. The catch sits outside the transaction (DV 5d).
- **Review Focus 2 (first start).**
  - All three compose files use `-h 127.0.0.1`, `service_healthy`, `pgdata:/var/lib/postgresql` (tmpfs in e2e) and `shm_size: 128mb`.
  - The entrypoint's `node --experimental-strip-types db/migrate.ts` can load `import { Pool } from 'pg'` under plain Node: pg 8.23.1 exports `esm/index.mjs`.
  - `db/migrate.ts` imports nothing marked `server-only`, ends its pool, and exits non-zero on failure.
- **Review Focus 3 (PostgreSQL restart).**
  - `pool.on('error')` is in place. pg-pool's `makeIdleListener` (`index.js:51-63`) replaces itself with a no-op after the first error, so an idle client logs exactly one line, `{ name: 'error', code: '57P01' }`, through `describeError`'s new `DatabaseError` branch.
  - The quote in `db/index.ts` ("if a pool emits an `error` event and no listeners are added node will emit an uncaught error and potentially crash your node process") is on node-postgres.com/apis/pool (Context7, `/websites/node-postgres`). This settles docs-check row 6a's open note.
- **The baseline migration.**
  - Its order is types, tables, indexes, foreign keys.
  - Every referencing column that does not lead its primary key has its own index: `app_group_grants.group_id`, `app_user_grants.user_id`, `user_group_members.user_id`. The other foreign keys lead their primary key.
  - The partial index is `WHERE "role" = 'owner'`, and the full `users_source_credentials` CHECK body is carried over.
- **jsonb is written correctly.** drizzle-orm rc.4's node-postgres codec (`node-postgres/codecs.js`, `jsonb.normalizeParam`) JSON-stringifies arrays, so `dify_apps.tags` is stored as JSON and not as a PostgreSQL array literal (which would have raised 22P02 and been answered as `not_found`).
- **Secrets in logs (DV 5a/5b).**
  - `describeError` reduces `DrizzleQueryError` and bare `DatabaseError` to name and code.
  - `errorResponseFrom`'s raw `console.error` is gone (ruling T5-I1).
  - PostgreSQL is published on 127.0.0.1 only (local 5432, e2e 5433) and not at all in the production template.
  - `POSTGRES_PASSWORD` is guarded with `:?` in the local and production files.
- **Sources in comments.** ADR-0002 is followed throughout: PostgreSQL 18 chapters, node-postgres pages, Drizzle guides and the image's docs.

#### Issues

##### Critical

None.

##### Important

None.

##### Minor

1. **A transaction's client has no `error` listener while it is checked out.**
   - Where: `db/index.ts:21`, together with `node_modules/drizzle-orm/node-postgres/session.js:50-64` and `pg-pool/index.js:344`.
   - What's wrong:
     - pg-pool removes the idle listener on checkout, and Drizzle's `NodePgSession.transaction` adds none.
     - If PostgreSQL restarts while a transaction is in flight, the client emits `error` with no listener when the socket ends: "Connection terminated unexpectedly" (`pg/lib/client.js:204-222, 416-423`), or the 57P01 `DatabaseError` if no query is active.
     - The process survives only because Next registers its own `process.on('uncaughtException')` (`next/dist/server/lib/router-server.js:650`, which `start-server.js` loads in standalone mode too). That handler prints the raw error as `uncaughtException: …`, bypassing `describeError`.
   - Why it matters:
     - The content is harmless: a message, no parameters.
     - Review Focus 3's "does not crash" holds, but it holds through Next and not through the hub's code.
     - Task 14's restart check runs with an idle hub, so it will not show this.
   - How to fix:
     - Nothing is needed for merge.
     - Optionally, run Task 14's restart once with an admin save or a long request in flight and confirm the process stays up.
     - node-postgres documents `client.on('error')` for a client "disconnected while it is idle" and `pool.on('connect')` to set one up. Adding it is a design call, because idle errors would then be logged twice, and belongs in a later change.
2. **The template password satisfies the guard that is meant to force a choice.**
   - Where: `.env.template:10-11`.
   - What's wrong: `POSTGRES_PASSWORD=change-me`, with the same value in `DATABASE_URL`, passes `${POSTGRES_PASSWORD:?…}`. A copied template therefore brings up a working stack with a guessable database password. The MySQL-era template's `mysql://username:password@host:port/…` could not work unedited.
   - Why it matters:
     - The production hub may share a Docker network with Dify's containers (CLAUDE.md deployment note), so any compromised neighbour reaches PostgreSQL with a known password.
     - The image reads the password only on the volume's first start, so it tends to stay.
   - How to fix: leave `POSTGRES_PASSWORD=` empty in the template and put a `<password>` placeholder in the URL, so the compose files' `:?` message makes the operator choose a password. Keep the comment about percent-encoding.
3. **The production template needs `DOCKERHUB_USERNAME` for every compose command.**
   - Where: `docker-compose.yml:2-4,36`.
   - What's wrong: Compose interpolates `${DOCKERHUB_USERNAME:?…}` for every subcommand. With the header's suggested `DOCKERHUB_USERNAME=… docker compose up -d`, a later `docker compose logs`, `ps` or `down` fails with the interpolation error. Neither the header's list of `.env` keys nor `.env.template` mentions the variable.
   - Why it matters: an operator following the header hits an error on the first `logs` or `down`.
   - How to fix: add `DOCKERHUB_USERNAME` to the header's list of `.env` keys (Compose reads `.env` beside the file for interpolation) and to `.env.template`, commented as needed for the production template only.

#### Deferred-minor triage

Items in my area, plus test or infra items that pin behaviour in my area. Each is marked "fix before merge" or "can wait".

| Ledger item | Triage | Why |
| --- | --- | --- |
| T2: `db/schema/groups.ts:11-12` cites the unit test for the Finance/finance pin | can wait | The unit test does pin it (`group-management-actions.test.ts:152`, through a mocked 23505). Citing `e2e/admin-groups.spec.ts:73-75`, which hits the live index, would only be more precise. |
| T2: no unit test pins the `users_source_credentials` CHECK body | **fix before merge** | Spec §6 names "the CHECKs". I confirmed the body is in the baseline SQL, but only the name is asserted (`b3b-schema.test.ts:28`). One `toContain` on the baseline. Seat B's file. |
| T2: `db/migrate.ts:15` Pool has no `connectionTimeoutMillis` | **fix before merge** | One line. Spec §1 and plan decision f promise the 10 s bound mysql2 gave, and the MySQL-era `migrate.ts` had it too. Without it, a black-holed `DATABASE_URL` host holds the entrypoint for the kernel's TCP timeout (about 2 min) instead of 10 s. Docs-check 5f (a Pool rather than one client for migrate) needs no change: the PostgreSQL page is silent on it. |
| T2: `db/index.ts` comment says the listener logs name and code | can wait | True since Task 5 for `DatabaseError` (57P01) and socket errors. A bare `Error('Connection terminated unexpectedly')` passes through `describeError` with its message, which holds no secret. |
| T3: `compose-files.test.ts` pins neither the healthcheck timings nor `'127.0.0.1:5432:5432'` | **fix before merge** | It guards a stated security property that is correct today. Also pin that `docker-compose.yml`'s `postgres` service has no `ports:` and that the local and production files use `${POSTGRES_PASSWORD:?`. A few lines. Seat B's file. |
| T3: "Task 3" in a lasting comment (`compose-files.test.ts:7`) | can wait | Cosmetic. Seat B's file. |
| T4: `pnpm test:db` teardown `down postgres` stops a concurrent e2e run | can wait | Sequential use is safe: the e2e setup brings the database up again and re-migrates, and `auth.setup.ts` runs `/init`. The compose header already says `test:db` stops it. |
| T5: path-label first lines (`lib/data/db-errors.ts:1`, its test) | can wait | Cosmetic, though trivial to drop in the fix wave. |
| T5: `lib/data/directory.ts:238` says the retry is on 23505 for `users_directory_id_key` or `users_email_key` | **fix before merge** | The code retries on any 23505 (`isUniqueViolation(error)`, line 253). The comment above `replaceDirectoryMemberships` (lines 102-106) says a membership primary-key 23505 also retries, so the file contradicts itself. One phrase: "a unique violation (23505), such as …". |
| T5: "Resource is still in use" noise on teardown | can wait | Noise only. |
| T6: the `drizzle.mock()` snippet is repeated in three tests | can wait | Test hygiene. Seat B. |
| T6: forgot-password comment | can wait | Already addressed: the route's comment says lowering in JavaScript "missed an account stored with capitals". |
| T8: three test-comment items (sync fake doc, "waits" hedge, MySQL citations) | seat B | Test files. Seat B checks that Task 10 fixed the citations. |
| T9: a malformed list member and an unknown UUID give different field-error contents | can wait | Same code and same field. Plan-mandated. |
| T9 forwarded: unchecked session-token ids | can wait, no fix needed | Analysis follows the table. |
| T10: `lockDirectoryAccount` "is refused (23505)" (waits for the commit first) | can wait | Imprecise, not wrong. |
| T11: `e2e/admin-users.spec.ts:8` `new RegExp(email)` unescaped (also docs-check 8) | can wait | Pre-existing, and generated emails carry only `.`. |
| T11: `e2e/auth.spec.ts:86` checks only the URL `/apps` | can wait | `/apps` renders only after the `(user)` layout's server gate finds a live session, and the only account matching `ADMIN@E2E.LOCAL` case-insensitively is the admin. |
| T12: `docker-bake.hcl:1` cites the owner but no Docker source | **fix before merge** | ADR-0002 binds. Add `https://docs.docker.com/build/bake/variables/#validating-variables` to the comment. One line. |
| T12: rspress base path | can wait | Housekeeping. Out of scope (spec §1). |
| Ruling A10: the reset route's `rowCount ?? 0` path is untested | can wait | It is an upstream-shaped route, the `?? 0` is present, and tsc holds the null type. |

**The forwarded session-token item (T9).**

What happens when a cookie carries an id that is not a UUID:

1. The jwt callback's `eq(users.id, token.id)` raises 22P02 (`lib/auth/options.ts:144`).
2. next-auth v4 catches any error from the jwt callback. It calls `logger.error("JWT_SESSION_ERROR", error)` and clears the cookie (`next-auth/core/routes/session.js:88-89`), and the body stays `{}`.
3. `getServerSession` therefore returns `null` (`next-auth/next/index.js:144`).

The result in each place:

- Pages: `requireUser` and `requireAdminUser` redirect with a 307 to `/login`.
- Route Handlers: `verifySession` answers 401.
- Actions: `unauthorized`.
- There is no 500 anywhere.
- `proxy.ts` never redirects away from `/login`, so there is no loop.
- The client's first `/api/auth/session` fetch clears the cookie, since the Route Handler path can set cookies.

The visible cost is one `[next-auth][error][JWT_SESSION_ERROR]` line per server render until then. It carries the Drizzle message (the SQL and the id) and the pg message. Neither is a secret.

This is not reachable in practice. Upstream's Prisma schema used `@id @default(uuid())` (`aebcc86d:packages/nextjs-app/prisma/schema.prisma:18`), and every later generator is a v4 UUID (`lib/helpers/id.ts`, `crypto.randomUUID`). Only a token forged with `NEXTAUTH_SECRET` could carry another format. The spec §3.2 rule ("ids from the session token … need no check") stands.

#### Declined to judge

- **`/api/health` returns the raw database error message to an anonymous caller.** With pg that can be "password authentication failed for user …" or an internal address. Pre-existing and not touched by this branch. A candidate follow-up.
- **next-auth's own logger.** It prints a failing jwt-callback query's Drizzle message with its parameters (the account id) whenever the database is down. Pre-existing on MySQL, sits outside `lib/error-log.ts`, and an id is not a secret.
- **The inherited forgot and reset handlers log raw errors.** Already a recorded CLAUDE.md follow-up.
- **Drizzle's development query logger prints parameters.** Already a recorded CLAUDE.md follow-up.
- **`docker-compose.dev.yml` has no database service.** It is upstream's self-deploy file, and spec §2 asks for the new names only.
- **Text ordering.** `ORDER BY user_groups.name` and `users.email` now follow the `postgres:18` image's `en_US.utf8` collation instead of `utf8mb4_0900_ai_ci`. The orders are similar, both linguistic. The spec is silent and I did not verify it live.
- **`createOwner` under a non-default isolation level.** It relies on the server's default. Under a `default_transaction_isolation = serializable`, a race would surface as 40001 (`operation_failed`) instead of `forbidden`, still with one owner. The hub's own container uses the default.
- **NUL characters.** PostgreSQL `text` cannot hold U+0000, which MySQL stored. No realistic source exists: admin forms, Dify app names and directory attributes don't carry it.
- **A Node `AggregateError` (dual-stack connect) logged with its inner errors' addresses.** Edge case. No secret, just topology.
- **Memory limit, pool sizing (`max`, `idleTimeoutMillis`) and TLS to an external PostgreSQL in the production template.** Spec §2 does not ask for them. The CLAUDE.md memory note is deployment advice.
- **Validating the `DATABASE_URL` scheme (`postgres://`) in `lib/env.ts`.** The schema was `min(1)` on MySQL too, and spec §5's operator steps cover the edit.
- **Review Focus 3's premise that a missing listener exits the process.** Under Next's server it would be logged by Next's `uncaughtException` handler instead. The listener is still the documented approach, so this is a wording point in the plan, not a defect.
- **`migration.sql` has no trailing newline.** It is drizzle-kit's output, left as generated (ruling B4).
- **The lockfile route (ruling ADR2-1) and the `docker compose config` flags (ADR2-2a).** Ruled by the controller; nothing committed depends on them.

#### Recommendations

- **Fix wave (all small):**
  - `connectionTimeoutMillis: 10_000` in `db/migrate.ts`.
  - The `directory.ts:238` comment.
  - The Bake docs link.
  - Seat B's two pins: the CHECK body, and the compose binding, no-port and `:?` checks.
  - Optionally, Minor 2 (template password) and Minor 3 (`DOCKERHUB_USERNAME` in the `.env` key list), both a few lines of text.
- **Task 14:**
  - Run the restart check once more with a request in flight (Minor 1) and confirm the hub stays up.
  - Read the restart's log lines against Review Focus 3's expected `Database pool: { name: 'error', code: '57P01' }`.
- **Later:** a parameter-free `/api/health` failure body, and routing next-auth's `logger.error` through `describeError`. Both are pre-existing.

#### Assessment

**Ready to merge?** With fixes

**Reasoning:** In my area, the PostgreSQL move is complete and consistent across schema, migration, DAL, actions, routes, compose files and e2e fixtures. I found no defect that changes behaviour for a user or operator. The remaining items are four one-line accuracy, docs or pin fixes from the ledger, plus three minor operator-facing polish points. The live checks (restart, first start) are Task 14's.

## Seat B

## Final review, seat B: the unit and live tests (`__tests__/`)

Branch `feat/postgres-and-rename`, base `fork/overhaul` 79e72a05, head 2464e86f. Package `final-B.diff` (4,871 lines), read in four passes: (1) the commit list and stat; (2) the unit files whose driver mocks moved (action-failure through data-users); (3) the new live project (`__tests__/db/*`, `db-baseline`, `db-pool`); (4) the remaining unit files (dify-_, directory-_, error-log, forgot-password, group/user/app management, ids, schemas). Code under test was read where a question needed it: `vitest.config.ts`, `db/index.ts`, `drizzle.config.ts`, `lib/error-log.ts`, `lib/data/{db-errors,email,users,directory}.ts`, `app/(admin)/app-management/actions.ts`, `lib/auth/options.ts`, and the installed `pg-protocol`, `pg`, `drizzle-orm` 1.0.0-rc.4, `drizzle-kit` 1.0.0-rc.4 and `next-auth` 4.24.15 sources. One unit run: `pnpm exec vitest run --project unit` → 146 files, 1808 tests passed, 8.9 s, exit 0, no stderr, no warnings, no unhandled rejections.

#### Strengths

- **The fakes match the installed drivers.** `new DatabaseError(message, 0, 'error')` is how pg-protocol's parser builds a server error (`messages.js:36-41`, `parser.js:143` passes `'error'` as the name), so `describeError` answering `{ name: 'error', code }` is what production logs. `new DrizzleQueryError(query, params, cause)` matches `drizzle-orm/errors.js`. The `{ rowCount }` write results match Drizzle's `mode: "raw"` path, which hands back pg's whole `QueryResult` (`node-postgres/session.js`, `prepareQuery`: `mode === "raw" ? r : r.rows`). The lost-connection fixture without a code matches `pg/lib/client.js:204` ("Connection terminated unexpectedly").
- **SQL is pinned by rendering on `drizzle.mock()` in the pg dialect.** `$n` placeholders, `lower("users"."email") = lower($1)` with the value passed as typed, `on conflict ("slot") do nothing returning "id"`, and `on conflict do nothing` on the membership batches are all exact strings. A dropped `lower()`, an ON CONFLICT clause lost from an insert, or a JavaScript `toLowerCase()` would fail a test.
- **The constraint name is tested in both directions.** `users_one_owner` is told apart from `users_email_key` (data-db-errors, errors.db). `users_directory_id_key` is rethrown, not taken as `email_in_use` (data-users-writes, data-users). `user_group_members_pkey` answers `operation_failed`, not `name_in_use` (group-management-actions). `directory_sync_runs_pkey` propagates from the claim (data-directory-sync).
- **The live project is well isolated.** It has its own database `hub_dal`, recreated with `DROP … WITH (FORCE)`, and `fileParallelism: false`. Each file has one pool, ended in `afterAll`. `TRUNCATE … CASCADE` reaches all 11 tables. A failed setup stops the server, using `AggregateError` when the stop also fails. drizzle-kit loads `dotenv/config` at start, but without override (`bin.cjs:413-414`), so the `DATABASE_URL` that global-setup passes wins over the owner's `.env`. I checked this because a migrate against the wrong database would be serious.
- **The race tests assert outcomes, not paths.** "exactly one owner", `[false, true]` for two claims: both pass whichever path PostgreSQL takes, so they are deterministic.
- **The secrets-in-logs tests check for absence.** They assert that the hash, the email, the address, the SQL, `Key (` and the parameters are absent, for the action, route, instrumentation and live paths.
- **No MySQL leftover describes MySQL as the current engine.** Every remaining mention is a history note (ruling B10). Task 8's deferred citations were fixed by Task 10: `data-directory-sync.test.ts:561` and `data-directory-sign-in` now cite PostgreSQL 13.5, and the fixtures use `ECONNRESET`.

#### Review Focus / spec §6 coverage (scenario → the test that would fail)

| Scenario | Unit (would fail) | Live / e2e | Gap |
| --- | --- | --- | --- |
| RF1 local sign-in, other case | `auth-options.test.ts` "looks the email up without case" (SQL + param as typed) | `db/email.db.test.ts` "signs a local account in with its email typed in another case" | — |
| RF1 directory entry, case variant | `data-directory-sign-in.test.ts` email-check SQL (`lower(...) = lower($1)`) | `db/email.db.test.ts` "refuses a directory entry's first sign-in…" (`email_in_use`, no ldap row) | — |
| RF1 the other two lookups | `data-users-writes.test.ts` "checks the email without case" (createUser; updateUser shares `emailTakenBy`), `forgot-password-route.test.ts`, `data-email.test.ts` | — | — |
| RF2 fresh volume | `compose-files.test.ts` pins `pg_isready -h 127.0.0.1`, `/var/lib/postgresql` (never `/data`), `service_healthy`, `shm_size` | Task 14 Docker gate | Timings and the local `127.0.0.1:5432` binding unpinned (Minor M1) |
| RF3 restart under a running hub | `db-pool.test.ts` (one listener; emit does not throw; context `Database pool:`); `error-log.test.ts` "keeps a bare server error to its name and SQLSTATE" | Task 14 restart check | The listener's log payload is unpinned at the wiring (M3) |
| RF4 malformed id | `dify-route.test.ts` (404 `app_not_found`, no DAL, no client; 401 first), `chat-page.test.ts` (missing state, no read), `app-icon-route.test.ts`, `user-management-actions.test.ts` it.each (5 actions, no DAL), `group-management-actions.test.ts` ('g1', 'nope', member ids), `app-management-actions.test.ts` (access ids); safety net `action-failure.test.ts` and `dify-errors.test.ts` (22P02 → not_found / 404, logged by code) | `db/schema.db.test.ts` and `db/errors.db.test.ts` (live 22P02); e2e `malformed-ids.spec.ts` | App actions' own id guard: only `updateAppAction` has a case, and it cannot fail (M2) |
| RF5 two accounts differing in case | `data-users-writes.test.ts` (23505 `users_email_key` → `email_in_use`; other index rethrown), `data-users.test.ts` (updateUser, both directions), `db-baseline.test.ts` (`users_email_key` on `lower("email")`) | `db/schema.db.test.ts` and `db/errors.db.test.ts` (23505 `users_email_key`); `db/email.db.test.ts` (createUser `email_in_use`) | — |
| Single owner | `data-setup.test.ts` it.each (both indexes → forbidden; no isolation config); `users-schema.test.ts`; `db-baseline.test.ts` exact partial index | `db/owner.db.test.ts` (5 race rounds + same email in another case); `db/schema.db.test.ts` "holds one owner and any number of admins" | — |
| Slot claim | `data-directory-sync.test.ts` (exact SQL with target + returning; `[]` → false; other refusal propagates; deadlock retries) | `db/directory.db.test.ts` (sequential + concurrent) | — |
| §6 driver mocks moved | every file: `drizzle-orm/node-postgres`, `{ rowCount }` | — | — |
| §6 db-errors (23505/23503/40P01/22P02, constraint) | `data-db-errors.test.ts` (bare + as cause; constraint both ways; message and condition name ignored) | `db/errors.db.test.ts` | — |
| §6 rowCount null | `data-apps-sync` (deleteApp), `group-management-actions` (deleteGroup), `data-directory-sync` (deactivate, reactivate, refresh, membership add/remove/row path) | — | reset-password route untested (ruling A10); none of the null cases can catch a missing `?? 0` (tsc holds that) |
| §6 two conflict paths | `data-settings.test.ts` (`target` + `set` for both upserts); slot claim above | e2e `branding.spec.ts` "removing the logo…" runs the document row's DO UPDATE | The file row's DO UPDATE (logo replaced by a logo) is unit-only (M7) |
| §6 schema DDL: partial index, lower(email), FK indexes, enums | `db-baseline.test.ts`, `b3a-schema.test.ts`, `b3b-schema.test.ts`, `users-schema.test.ts`, `settings-schema.test.ts` | `db/schema.db.test.ts` | — |
| §6 schema DDL: **the CHECKs** | `b3b-schema.test.ts:26` checks the **name** only | none | **The body is unpinned (I1)** |
| Group names without case (decision e) | `db-baseline.test.ts` exact index | `db/schema.db.test.ts` (23505 `user_groups_name_key`) | — |

#### Issues

##### Critical

None.

##### Important

**I1. Neither a unit nor a live test pins the body of the `users_source_credentials` CHECK** (`__tests__/db-baseline.test.ts`, whole file; `__tests__/b3b-schema.test.ts:26-30` asserts the name only).

- **What's wrong.** On the base, `b3b-schema.test.ts` pinned the CHECK byte for byte ("adds the CHECK after every change to users columns"). The port deleted that MySQL case and added nothing in its place. Spec §6 lists "the CHECKs" among what the schema tests assert, and the Task 2 deferred minor says the same.
- **Why it matters.** The CHECK is the database's own guard that a directory account has no hub password and that a local account has no directory key (ADR-0029 decision an; CLAUDE.md: "the CHECK refuses the write" in the inherited reset handler). If a schema edit or a drizzle-kit regeneration weakened it, for example by dropping `"password" IS NULL` from the ldap branch, every test would still pass, and a directory account could be given a password the local tab accepts.
- **How to fix.**
  - Add to `db-baseline.test.ts` an exact `toContain` of the generated line: `CONSTRAINT "users_source_credentials" CHECK (("source" = 'local' AND "password" IS NOT NULL AND "directory_id" IS NULL) OR ("source" = 'ldap' AND "password" IS NULL AND "directory_id" IS NOT NULL AND "directory_id_attribute" IS NOT NULL))`. The text is in `db/migrations/20261011220610_baseline/migration.sql:126`.
  - Optionally add one live case to `db/schema.db.test.ts`: an `ldap` row with a password → `{ code: '23514', constraint: 'users_source_credentials' }`.

##### Minor

**M1. `__tests__/compose-files.test.ts:34-38` and `:64-68` (deferred, Task 3).**

- **What's wrong.** Nothing pins the local file's `'127.0.0.1:5432:5432'` binding or the healthcheck timings (`10s`/`10s`/`5`/`30s`).
- **Why it matters.** A slip to `'5432:5432'` would publish the owner's database on every interface without any error. That is spec §2's "127.0.0.1:5432 only".
- **How to fix.** Add `expect(read('docker-compose.local.yml')).toContain("- '127.0.0.1:5432:5432'")` (the e2e file's binding is already pinned the same way). Add a regex for `interval: 10s\n {6}timeout: 10s\n {6}retries: 5\n {6}start_period: 30s` in the per-file block.

**M2. `__tests__/app-management-actions.test.ts:91, 93-100`.**

- **What's wrong.** `updateAppAction('not-a-uuid')` runs after `updateApp.mockResolvedValue(null)`, so it answers `not_found` even with the `isId` guard removed. `deleteAppAction` and `syncAppAction` have no malformed-id case at all.
- **Why it matters.** Spec §6 says "the actions refuse malformed ids before any query", and for the app actions this has no failing test. The 22P02 safety net would hide a regression from users, leaving only an error line in the log.
- **How to fix.** Mirror `user-management-actions.test.ts`'s it.each: run all three actions with `'not-a-uuid'` and assert `updateApp`, `deleteApp`, `syncApp` and `refresh` were not called.

**M3. `__tests__/db-pool.test.ts:39`.**

- **What's wrong.** The test checks only the first log argument.
- **Why it matters.** A listener rewritten as `console.error('Database pool:', error)` would pass, and RF3's "the log carries name and code only" is then pinned only by `describeError` in isolation.
- **How to fix.** Replace the check with `expect(logged).toHaveBeenCalledWith('Database pool:', { name: 'error', code: '57P01' })`.

**M4. Path-label first lines** (deferred, Task 5; more files than the ledger lists).

- **What's wrong.** These files open with a `// <path>` line: `__tests__/data-db-errors.test.ts:1`, `__tests__/db/database.ts:1`, `__tests__/db/global-setup.ts:1`, `__tests__/db/errors.db.test.ts:1`, `__tests__/db/schema.db.test.ts:1`, and also `lib/data/db-errors.ts:1` (seat A).
- **Why it matters.** No other test file in the repo has such a line.
- **How to fix.** Drop the lines.

**M5. Plan-task numbers in lasting comments.**

- **What's wrong.** `compose-files.test.ts:7` names "Task 3", `data-setup.test.ts:96` names "Task 7 pins the race itself", and `db/schema.db.test.ts:71` names "(Task 9)".
- **Why it matters.** After the merge, "Task N" is ambiguous: the suite already cites other plans' task numbers.
- **How to fix.** Name the file instead, for example "`__tests__/db/owner.db.test.ts` pins the race itself" or "`lib/ids.ts`".

**M6. Comments and titles that over- or under-state what is asserted.**

- **`data-directory-sync.test.ts:32`** (deferred, Task 8): `rowCount` "is the rows the statement matched". It is also the rows an insert put in.
- **`db/directory.db.test.ts:72-73`** (deferred, Task 8): "the second insert waits for the first". Change it to "may wait": under autocommit the two inserts may not overlap.
- **`db/owner.db.test.ts:21`**: "so their transactions overlap". They may; the next sentence already says the loser takes either path.
- **`data-directory-sync.test.ts:561`** (deferred, Task 10): an unwrapped line of about 170 characters.
- **`b3b-schema.test.ts:44`**: the title "and the column name kept" does not say what is asserted. Change it to "keeps the column name `run_trigger`".

**M7. The file row's ON CONFLICT DO UPDATE has no live case** (`data-settings.test.ts`, unit only).

- **What's wrong.** Plan decision c says a conflict path cannot be proven with a mock. The arbiter inference is proven live by any first logo save (PostgreSQL resolves the target at plan time), and the document row's update branch by e2e "removing the logo…". No live or e2e case replaces one logo with another, which is the only path through `instance_setting_files`' update branch.
- **How to fix.** Optionally, add a `writeInstanceSetting` live case in `__tests__/db/` that saves a logo twice and reads back the second bytes.

**M8. `__tests__/db/global-setup.ts:11`** (deferred, Task 4).

- **What's wrong.** `down postgres` removes the shared e2e container, and its tmpfs database with it.
- **Why it matters.** A concurrent `pnpm test:e2e` or `next dev` on 5433 is cut off. Sequential use is safe.
- **How to fix.** Add one line to the JSDoc: "do not run alongside `pnpm test:e2e`; the e2e database is gone afterwards and the next e2e run re-migrates it".

#### Deferred-minor triage

**Fix before merge:**

- **T2: the CHECK body is unpinned.** This is I1; spec §6 names it, and the fix is one line.
- **T3: `compose-files` binding and timings.** This is M1; the binding is a security property, and the fix is one line in a file the wave touches anyway.

**Resolved, verified:**

- **T2: `db/index.ts:12`'s comment.** It is true since Task 5: `logActionError` goes through `describeError`.
- **T8: the MySQL 8.4 deadlock citation and the `PROTOCOL_CONNECTION_LOST` fixture.** Task 10 replaced them (grep finds neither).
- **T9: `dify-route.test.ts:85`, "a lost MySQL connection".** It now reads "a lost database connection".

**Can wait:**

- **T2: `db/schema/groups.ts:11-12` cites the wrong pin.** It is a product comment (seat A). The live pin now is `__tests__/db/schema.db.test.ts` "refuses a second group whose name differs only in case", so it can be pointed there.
- **T2: `db/migrate.ts`' Pool has no `connectionTimeoutMillis`.** This is product code (seat A).
- **T2 (info): the null-rowCount cases cannot catch a missing `?? 0`.** `null` coerces like 0, and tsc `strictNullChecks` holds the rule. The cases still catch `!== 0`-style regressions.
- **T3: `compose-files.test.ts:7` "Task 3".** Cosmetic (M5); fold it in while editing the file for M1.
- **T4: the teardown removes the shared e2e container.** Sequential use works; it needs a doc line (M8).
- **T5: the path-label lines.** Cosmetic (M4); fold them into the wave.
- **T5: `lib/data/directory.ts:228-231` comment.** This is product (seat A). The unit test's duplicate uses `users_directory_id_key`, so the comment's narrowing is not tested either way.
- **T5: the "Resource is still in use" teardown noise.** It is harmless output when `ldap-ad` is up.
- **T6: the `drizzle.mock()` rendering snippet appears in three files.** Each copy is about six lines; a helper would be churn.
- **T6: the forgot-password comment.** This is product (seat A).
- **T8: the `data-directory-sync.test.ts:32` doc and the `directory.db.test.ts:72-73` hedge.** Wording (M6); fold them in.
- **T9: field errors differ for a malformed member and an unknown UUID.** The code and the field are the same, which is plan-mandated.
- **T10: the unwrapped line at `data-directory-sync.test.ts:561`.** Cosmetic (M6).
- **T10: the `lockDirectoryAccount` comment.** This is product (seat A).
- **Ruling A10: the reset-password route's null path.** The route is upstream-shaped and has no test file, so the item stays deferred as ruled.

#### Declined to judge

- **Product code correctness** in `lib/`, `app/`, `db/schema`, compose, `Dockerfile` and e2e: seat A's. I read code only to answer test questions.
- **The records** (ADR-0031, the ADR notes, CLAUDE.md, the spec, the cii assessment): seat C's.
- **The forwarded Task 9 item.** A pre-fresh-start cookie whose id is not a UUID raises 22P02 in the `jwt` callback (`lib/auth/options.ts`, `eq(users.id, token.id)`). I checked next-auth 4.24.15: `core/routes/session.js:86-89` catches it, logs `JWT_SESSION_ERROR` with the raw error (whose message carries the SQL and the old id) and clears the cookie, so the visitor is signed out, not served a 500. No unit test covers it. Whether that log line or the missing page net matters is product behaviour, so it goes to seat A.
- **`lower()`'s folding of non-ASCII case depends on the database's `LC_CTYPE`.** `email.db.test.ts`' `JOSÉ@` → `josé@` assertion passes because the postgres:18 image initialises with `en_US.utf8`. This is an infra or product choice, for seats A and C.
- **The `pnpm test:db`, `pnpm test:ldap` and e2e results.** Running them was forbidden; I relied on the ledger's counts (27 live tests in 5 files match the files I read).
- **Drift between the schema and the migration.** No test runs `drizzle-kit generate` as a check; AGENTS.md's read-the-SQL-before-commit rule covers it, and the plan did not ask for one.
- **Running `vitest run` without `--project`.** It would start the `ldap` and `db` global setups on one compose file; every script passes `--project`, so this is outside the plan.
- **The overlap between `db/schema.db.test.ts` and `db/errors.db.test.ts`.** Their refusal cases overlap (case-variant email, second owner, FK, 22P02), but they assert different layers: the raw driver fields against the predicates and the log shape. Plan Tasks 4 and 5 set them, so this is not a duplicate defect.
- **Spec §1's accepted change** (two simultaneous first settings saves, the later one kept): the owner accepted it, and no test was asked for.
- **Stale `drizzle-orm` variants with mysql2 peers under `node_modules/.pnpm`**: install state, not the lockfile (seat A).

#### Assessment

**Ready to merge?** With fixes.

**Reasoning:** Every Review Focus scenario has a unit test that would fail on a regression, and a live or e2e case where an index, a conflict or a driver field is involved; the unit run is clean. The one test gap that matters is the users CHECK's body: spec §6 names it, the base pinned it, and the port left it unpinned. Pinning it, together with the local port binding (M1), is two one-line additions to the fix wave.

## Seat C

## Final review, seat C: the records (feat/postgres-and-rename, 79e72a05..2464e86f)

Scope: `docs/decisions/` (ADR-0031 new; notes on ADR-0004, 0019, 0030; the index), `docs/auth-gate.md`, `docs/ldap.md`, `CLAUDE.md`, `.cii-assessment.md`. I checked the claims against the branch: the compose files, `package.json`, `db/index.ts`, `db/migrate.ts`, `docker/entrypoint.sh`, `__tests__/db/{global-setup,database}.ts`, `vitest.config.ts`, `e2e/global-setup.ts`, `.env.e2e`, `.env.template`, the baseline migration, `lib/{ids,error-log}.ts`, `lib/data/{db-errors,setup,directory,email}.ts`, `docker-bake.hcl`, the spec, the plan header and the ledger. I did not read `.env` or `.env*.local`, and I did not start or stop a container. The Compose probes ran in the scratchpad against a copy of `docker-compose.yml`, a project name that does not exist, and `--dry-run`.

#### Strengths

- ADR-0031 is a complete MADR record. It has the front matter, the context, the drivers, seven option groups with their pros and cons, the outcome by area and the consequences. Its implementation plan covers the affected paths, the dependencies, the patterns to follow and to avoid, the configuration and the migration steps, and it ends with runnable verification boxes. It records all four behaviour changes of spec §1 (accents in emails and group names, the brand text, the later first save winning, the 10 s pool wait) and the fresh start. It also records what the docs do not cover (`DrizzleQueryError.cause`, pg's `code`/`constraint`) in its sources, as ruling ADR2-records asked. ADR-0004 and ADR-0031 point to each other, and the index row is updated.
- The concrete claims hold on the branch:
  - the project, container and service names (`ai-app-hub-local`, `ai-app-hub-local-app`, `ai-app-hub-local-postgres`, `postgres`, `pgdata`);
  - the ports (5432 local and 5433 e2e, both on 127.0.0.1 only);
  - the healthcheck, `shm_size` and the volume path;
  - the scripts (`test:db`, `test:ldap`, `db:generate`, `db:migrate`);
  - the `Database migration complete` line (`db/migrate.ts`);
  - `hub_dal` and its drop, create and migrate steps;
  - `globalThis.aiAppHubDb` and `connectionTimeoutMillis: 10_000`;
  - the three foreign-key indexes, the partial owner index and the `lower()` indexes in the baseline;
  - `emailMatches` at the four call sites, and `isId`/`idSchema` at the places ADR-0031 lists.
- ADR-0031's first verification box runs clean today: the `git grep` prints nothing and `grep -nE "^  mysql2@" pnpm-lock.yaml` prints nothing. `db/migrations/` holds only `20261011220610_baseline`.
- `docker compose -p dify-app-hub-local down` (ADR-0031's migration step, plan decision r) works from the repo root. Probed on Compose v5.1.1: with `-p` and no `-f`, `down` does not load the folder's `docker-compose.yml`. A deliberately broken copy did not fail it, and the production file's required variables did not stop it.
- The owner-password recovery in `docs/auth-gate.md` is sound:
  - the hash travels host env → `-e HASH` → container `sh` → `psql -v hash=…` → `:'hash'` in SQL read from stdin;
  - no step re-expands `$2b$12$…`;
  - `POSTGRES_USER`/`POSTGRES_DB` exist in the container's environment in both the local and the production file;
  - the image trusts local socket connections.
- `CLAUDE.md`:
  - is 146 lines;
  - has the ADR-0031 decision line, the Database pointer, the dev loop on 5432, the new "Database test project" section with "never beside `pnpm test:e2e`" (this closes Task 4's deferred teardown note on the records side), the extra Docker-gate checks and the scale-out note under "Deployment";
  - removes the "PostgreSQL move" follow-up, which is now done;
  - names MySQL only as history or for `fork/main`.
- `.cii-assessment.md` counts match the tree: 146 unit test files, 5 live db files with 27 cases, 4 ldap files, 38 e2e spec files (36 → 38). The change-log row is in place.
- No record contains a secret, a real password or a real email address. The only addresses are `example.com` ones, and the only credentials are the committed e2e test values.

#### Issues

##### Critical

None.

##### Important

**I1. `CLAUDE.md:69` (Part 0 parenthesis): the pointer to the pending Docker gate and the one-time `.env` switch was dropped.**

- What is wrong: the old text said Part 0 "stops in Task 14 for the owner's `.env` edits before the Docker gate". The new text only says that ADR-0031 "stays proposed until the owner's check". Nothing in `CLAUDE.md` points to spec §5 or to ADR-0031's "Migration steps". The "Docker stack" commands (`CLAUDE.md:75-82`) assume the switch has already happened.
  - Before the owner edits `.env`, `docker compose -f docker-compose.local.yml stop app` fails on `${POSTGRES_DB:?…}`.
  - The old `dify-app-hub-local-app` and `-mysql` keep running and keep port 5300 and memory on the 5 GB machine.
- Why it matters: the owner works remotely, the ledger is git-ignored, and the memory rule is "no handoff unless asked: status goes to the status bullets". A session that resumes from `CLAUDE.md` cannot see that Task 14 Steps 7–14 are still to run, or in which order (edit the `.env` files, take the old project down by name, then the gate).
- Fix: in the Part 0 parenthesis, add one sentence that stays true before and after the gate: "The Docker gate and the owner's check follow the owner's `.env` and `.env.development.local` edits and the old stack's removal (`docker compose -p dify-app-hub-local down`, after `--dry-run`; spec §5, ADR-0031 "Migration steps", plan Task 14 from Step 7)." Optionally, add one line at the top of "Docker stack": "Switching from the MySQL stack once: spec §5."

**I2. Accepted ADRs in the areas Part 1 will touch still describe the replaced MySQL mechanisms without a dated pointer to ADR-0031, and some of their statements are now false.**

The README conventions say a changed decision is "linked both ways", and that accepted ADRs are read "before architecture work in their area". Where each record is wrong:

- **`docs/decisions/0027-…md:87`:** "'Cafe' and 'Café' are the same name and answer `name_in_use`". This is now false: `user_groups_name_key` is on `lower(name)`, and ADR-0031 says "'Équipe' and 'Equipe' are now two".
- **`docs/decisions/0029-…md`:**
  - `:119` (decision ac): "The index compares as MySQL's collation does … case- and accent-insensitive". Now false.
  - `:116` (decision e): gap locks, 1062 and 1213.
  - `:120` (decision ae): `max_allowed_packet`.
  - `:122`: `affectedRows` and `FOUND_ROWS`.
  - `:94`: `mysqlEnum` and `varchar(64)`.
- **`docs/decisions/0024-…md`:**
  - `:60` (decision d): REPEATABLE READ and the gap lock for `createOwner`.
  - `:64` (decision h): "not checked as UUIDs". ADR-0031 says this decision ends.
  - `:137`: email case via the `utf8mb4_0900_ai_ci` collation.
- **`docs/decisions/0010-…md`:**
  - `:8` (the title) and `:23`: "a throwaway MySQL";
  - `:33`: `mysql2/promise`;
  - `:50`: the `mysql2` dependency.

  `CLAUDE.md:37` already says "(MySQL until ADR-0031)", but the record itself does not.

- **`docs/decisions/0030-…md`:**
  - `:67` and `:125`: deviation 4, "two first saves can deadlock on the gap lock". ADR-0031's behaviour change "the later one wins" belongs here.
  - Its new note at `:211` covers only the 10 s wait.

Why it matters: Part 1 reshapes apps, grants and groups and reads these records first. Two of them now state the opposite of the code. This was the Task 13 deferred minor (0010, 0024 and 0027); the problem is wider and includes 0029 and 0030.

Fix: add one dated note, "Note, 2026-10-12 ([ADR-0031](…))", under "More Information" on ADR-0010, ADR-0024, ADR-0027 and ADR-0029, and extend ADR-0030's existing note. Each note names what ADR-0031 replaces:

- decision h ends;
- the gap lock → the partial unique index at READ COMMITTED;
- the collation → `lower()` indexes, where accents now count;
- 1062/1452/1213/3819 → 23505/23503/40P01/23514;
- `FOUND_ROWS` → `rowCount`;
- the slot claim → `ON CONFLICT DO NOTHING`;
- `max_allowed_packet` → 65,535 parameters;
- the e2e MySQL on 3307 → PostgreSQL on 5433;
- for ADR-0030, the later first save wins.

ADR-0026's `:17` and `:44` (the collation, `varchar(36)`) could take the same one-line note.

##### Minor

**M1. `CLAUDE.md:114`: the B3b leftovers still say "the 1452 on a group deleted mid-sign-in".** That code is MySQL's; this line is now `23503` (`foreign_key_violation`). Replace the code.

**M2. `docs/decisions/0031-…md:90, 91, 108, 111, 113, 114, 119`: the citations "DV 7", "DV 8" and "DV 11" mean `doc-verification.md`'s numbered "Deviations and suggested changes".** But `:14` says DV citations are rows ("DV 1a"). Read as rows, they land in the wrong place:

- row 7 is the Docker image (7a–7d);
- row 8 is `jsonb` (8a–8c);
- row 11 is the provider registry.

So three source pointers misroute the reader. The owner checks sources piece by piece. Fix: write "DV change 7", "DV change 8" and "DV change 11" (plan decision k already uses "DV change 1"), and define both forms at `:14`.

**M3. `docs/decisions/0031-…md:160, 162` and `CLAUDE.md:65`: `db/schema/columns.ts` (the `timestamptz()` helper, plan decision g) is missing from "Affected paths", "Patterns to follow" and the Database pointer.** Part 1 adds tables and reads exactly these lines. "Affected paths" also omits:

- `playwright.config.ts`;
- `e2e/auth.setup.ts`;
- the new `e2e/{database,malformed-ids}.spec.ts`;
- the comment-only `lib/directory/{admin,entry,sync}.ts` and `lib/settings/branding.ts`.

**M4. `docs/auth-gate.md:53`: "changing the owner is a database change" now has a constraint the record does not mention.**

- `users_one_owner` refuses a second owner row.
- A non-deferrable unique index is checked as each row is written (PostgreSQL "Unique Constraints"), so a single `UPDATE` that swaps two roles can be refused.

Add one sentence: demote the current owner, then promote the other account, in one transaction, and bump both `session_version`s (ADR-0031).

**M5. `docs/auth-gate.md:44-49`: "On the production server, use its compose file".**

- The production template's image line `${DOCKERHUB_USERNAME:?…}` makes every `docker compose -f docker-compose.yml …` command fail, `exec` included, unless the variable is set. Verified with `--dry-run` on a scratch copy: "required variable DOCKERHUB_USERNAME is missing a value". The template's header passes it on the command line, for `up` only.
- Pre-existing problem: "Run this from the repo root, so `bcryptjs` resolves" does not fit a production server, because the template is "usable without the source tree".

Fix: add "(with `DOCKERHUB_USERNAME` set as for `up`, or in the `.env` beside the file)". Forwarded to seat A: whether the template should tell the operator to keep `DOCKERHUB_USERNAME` in `.env`.

**M6. `docs/auth-gate.md:44`: "psql interpolates only what it reads on standard input, never a `-c` command".** psql also interpolates `-f` files. Reword to "on standard input or from a file, never in `-c`". The command itself is right (Task 13 deferred minor).

**M7. `CLAUDE.md:101`: "it stops `postgres` afterwards".** The teardown is `down postgres`: it stops and removes the container, and because the server is on tmpfs, the e2e database is emptied too. When `ldap-ad` is up, the "Network … Resource is still in use" warning is harmless. Reword (Task 13 and Task 5 deferred minors).

**M8. `docs/decisions/0031-…md:164-165` (Configuration, Migration steps): two operator details are missing.**

- Name the old volume for its later removal: `docker volume rm dify-app-hub-local_mysql-data` (the old project `dify-app-hub-local` with the volume `mysql-data`, as plan Task 14 Step 7 gives it).
- Point to `docs/ldap.md:26` on `$` in `.env` values. `POSTGRES_PASSWORD` and `DATABASE_URL` pass through the same Compose interpolation and Next's env expansion, and `.env.template` covers only percent-encoding.

**M9. `docs/decisions/0019-…md:91` (the rename note): two items are left out.**

- It lists the compose projects `ai-app-hub-local` and `ai-app-hub-e2e`, but not the production template's `name: ai-app-hub` (volume `ai-app-hub_pgdata`, plan decision n).
- It does not mention the owner's no-default `DOCKERHUB_USERNAME` with Bake `validation` (running record decision 34). Optional.

**M10. `docs/decisions/0031-…md:20`: "every piece below was checked against its docs in `doc-verification.md`" is overstated.** Several pieces were decided after that check:

- `connectionTimeoutMillis`;
- the psql variable;
- `DROP DATABASE … WITH (FORCE)`;
- the `ILIKE` fixtures;
- the `lower(name)` group index.

These were checked in the plan's decisions or in the execution's docs check, and that check lives only in the git-ignored `.superpowers/sdd/…/docs-check-execution.md`. Reword to "in `doc-verification.md` and the plan's decisions; each source is listed under Sources".

**M11. `CLAUDE.md:69` (the rename sentence) and spec §8: neither says what changes in `CLAUDE.md` when the GitHub repo is renamed.** The `-R LovingCivilian/dify-app-hub` commands (`CLAUDE.md:8`) and the `origin` link (`:3`) should change in the same session as `git remote set-url`. Add that to the sentence.

#### Deferred-minor triage

| Deferred minor (ledger) | Verdict | Why |
| --- | --- | --- |
| Task 13: `CLAUDE.md:114` "1452" | **fix before merge** | One token. The line describes current behaviour with a MySQL code, and a grep for 1452 finds nothing in the code (M1). |
| Task 13: stale accepted ADRs 0010/0024/0027 with no pointer to ADR-0031 | **fix before merge** | ADR-0027:87 and ADR-0029 decision ac are now false, and Part 1 reads these ADRs first. Widened to 0029 and 0030 (I2). |
| Task 13: ADR-0031 "Affected paths" omissions; `timestamptz()` not named in Patterns or the `CLAUDE.md` Database pointer | **fix before merge** for `db/schema/columns.ts` in Patterns and the pointer; **can wait** for the rest | Part 1's plan follows "Patterns to follow". The other omitted paths are history, and git holds the diff (M3). |
| Task 13: DV citation style (DV 7/8/11 vs rows) | **fix before merge** | Three source pointers land on unrelated rows. The fix is one word per citation, and the owner audits sources (M2). |
| Task 13: `CLAUDE.md:101` "stops postgres afterwards" | **can wait** (fold into the I1 edit if convenient) | tmpfs: the e2e suite re-creates and migrates its database, and the rule that matters, "never beside `pnpm test:e2e`", is already there (M7). |
| Task 13: auth-gate "interpolates only what it reads on standard input" | **can wait** | Explanatory clause only. The command is correct (M6). |
| Task 4: the `test:db` teardown kills a concurrent e2e run | **resolved in the records** | `CLAUDE.md:101` says "never beside `pnpm test:e2e`". A header note in `__tests__/db/global-setup.ts` is seat A/B's call. |
| Task 5: the "Network … still in use" teardown noise with `ldap-ad` up | **can wait** | Harmless warning. One clause in `CLAUDE.md:101` would explain it. |
| Ruling B14: cii #19 keeps the 2026-10-10 MySQL e2e run beside "使用一次性 PostgreSQL" | **can wait** (as ruled) | Replace it with Task 14's full run (or Task 11's 636/31/0). Until then the sentence reads as if the PostgreSQL suite produced 554. |
| Task 12: the `docker-bake.hcl:2` comment has no Docker source | **can wait** (seat A) | Code comment. Add docs.docker.com "Bake variables → Validating variables". |
| Task 12 info: the `packages/docs` base path is still `/dify-app-hub-docs/` | **can wait** | The housekeeping work. Spec §1 leaves `packages/docs/` out. |
| Task 2: `db/schema/groups.ts:11-12` cites the wrong test | **can wait** (seat A) | Code comment. |

#### Execution decisions and their records

- **`tsconfig.json` excludes `tmp/`** (3396b12f, ruling ADR2-3). No ADR needed. It is a tooling scope change by TypeScript's documented `exclude`, and it mirrors `vitest.config.ts`'s `tmp/**` exclusion (owner, 2026-10-10). ADR-0031's "Affected paths" records it ("`tmp` excluded") without the reason, and the commit has no body. That is acceptable; an optional clause would give the reason. Ruling T1-tsc also promised to tell the owner at the end about the git-ignored `tmp/refs/{fsat,agenticos}` clones; the end-of-run report should keep that promise.
- **The Dify routes' 500 path logs by name and code** (a66fdc48, ruling T5-I1). No ADR needed. It applies ADR-0024 decision g and spec §3.4 ("params, which are never logged") to a path the plan had left raw; it is not a new pattern. ADR-0031's "Errors and logs" could add "and the Dify routes' 500 path (`errorResponseFrom`)", so the record lists every place `describeError` guards. Cii #32 likewise names only Server Actions and the sign-in. Can wait.
- **Commit trailers** (ruling "trailers"). Not an ADR matter: it interprets `CLAUDE.md`'s "Commits" rule ("the attribution trailers the session supplies"). On the branch:
  - 11 commits carry `Claude Sonnet 5.5`, 1 carries `Claude Haiku 4.5` (3396b12f) and 6 carry `Claude Opus 5.5`;
  - every commit carries the session's `Claude-Session` line;
  - f9354266 (written by Haiku, amended to "Opus 5.5") contradicts the ruling's own "name the model that wrote it".

  This needs the owner's word before the push. If the practice stays, `CLAUDE.md`'s "Commits" bullet gains a clause ("each commit names the model that wrote it; the `Claude-Session` line is the session's"). Otherwise, a reword before the push.

- **The lockfile method** (ruling ADR2-1). No record needed. The lockfile is pnpm's own for this `package.json` (`--frozen-lockfile` passes, and a plain install leaves it unchanged). The docs check's GAP (pruning a hand-deleted dependency through `--lockfile-only` is undocumented) lives only in the git-ignored ledger. One optional sentence in ADR-0031's "Dependencies" would keep it.
- **`DrizzleQueryError.cause` and pg `DatabaseError.code`/`.constraint` documented only by type declarations** (ruling ADR2-5g/6c). Recorded in ADR-0031's Sources.
- **`docker compose config … --no-env-resolution`** (ruling ADR2-2a). A validation step only; nothing was committed. No record.
- **`DOCKERHUB_USERNAME` with no default and a Bake `validation`** (the owner, running record decision 34). Recorded there and in the `docker-bake.hcl` comment. An optional clause in ADR-0019's note (M9).
- **ADR-0004 marked superseded while ADR-0031 is proposed.** Recorded in running record decision 34 ("as ADR-0003 was").
- **The final review runs before Task 14** (ruling "order"), and **the reset route's null path stays untested** (ruling A10). Process and deferral only. The ledger is enough.

#### Declined to judge

- Product code, schema, compose and infrastructure correctness beyond the commands the records give: seat A's.
- The tests: seat B's.
- The plan file: excluded from the package.
- The spec's own text: binding authority. Checked only where a record restates it.
- ADR-0004 shown as "superseded" while ADR-0031 is "proposed": an owner-level decision, recorded in running record decision 34.
- ADR-0031's date (2026-10-11) against notes dated 2026-10-12: ruling B18.
- The stale "Latest handoff" pointer in `CLAUDE.md`'s "Specs and plans": pre-existing, and the owner's "no handoff unless asked" rule applies.
- `README.md:107` ("Drizzle ORM + MySQL") and the other upstream-shaped documents: spec §1 leaves them to the housekeeping work.
- `docs/frontend-conventions.md:87` ("throwaway MySQL"): dated sub-project 0 history.
- The MySQL-era verification lines ([x]) in accepted ADRs: dated evidence. The README allows only notes on accepted records, which I2 asks for.
- Running the psql recovery: it needs a live container. I relied on the quoting analysis, the psql semantics and the implementer's rolled-back run (ledger, Task 13).
- `docker compose -p dify-app-hub-local down` against the real old project: it would stop the owner's containers. I relied on the scratch probe (no file loaded with `-p` and no `-f`) and on plan decision r's measurement.
- The unit test total (1808): not re-run. I checked the file counts (146 unit, 5 db, 4 ldap, 38 e2e) and the live db case count (27).
- A production switch-over procedure: spec §5 covers only the local stack, decision 14 says no production data must survive, and whether a production hub runs today is not in the records.
- The merits of the trailer ruling: the owner's call. Only its record placement is judged above.
- Seat A items I met while checking the records: the production template's need for `DOCKERHUB_USERNAME` on every compose command (M5, forwarded), and a pre-fresh-start cookie with a non-UUID id reaching `requireUser` (Task 9's forwarded item).

#### Assessment

**Ready to merge?** With fixes

**Reasoning:** The records are accurate, and every operator command they give works on the branch. Two gaps remain. `CLAUDE.md` lost the pointer to the pending `.env` switch and the Docker gate (spec §5, Task 14 from Step 7). The accepted ADRs for users, groups, the directory, settings and e2e still state MySQL mechanisms without a link to ADR-0031, and two of their statements are now false. Both fixes are docs-only and belong in the single fix wave, together with M1–M3.
