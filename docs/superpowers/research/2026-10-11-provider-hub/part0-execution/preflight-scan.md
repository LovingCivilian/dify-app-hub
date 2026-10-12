# Part 0 — pre-flight scan of the plan (2026-10-12)

Two Opus scanners read the 450 KB plan before Task 1: seat A for Tasks 1–7, seat B for Tasks 8–14. The rulings on their findings are in `rulings.md` (A1–A11, B1–B19).

## Seat A (Tasks 1–7)

## Pre-flight scan A: Tasks 1–7

Scanner A, 2026-10-12. Read: `plan-header.md`, the spec (`docs/superpowers/specs/2026-10-11-part-0-postgres-and-rename-design.md`), `interfaces.md`, `task-1-brief.md` … `task-7-brief.md`, and the parts of `task-8` … `task-14` that pair with them. Checked against the tree on `feat/postgres-and-rename` (code identical to `477d261d`; `git diff 477d261d -- ':!docs'` touches only `CLAUDE.md`).

How it was checked:

- Every "replace"/"find" fragment of Tasks 1–7 was matched line by line (leading whitespace stripped) against the tracked files with a script; the "as Task N left it" fragments were derived from the earlier briefs by hand.
- Library claims were checked in the published packages, downloaded read-only to the session scratchpad (nothing installed in the repo): `drizzle-orm@1.0.0-rc.4` (pg-core `getSQLType()` of `uuid`, `jsonb`, `bytea`, enum and `timestamp(withTimezone)`; `getTableConfig`, `QueryBuilder`, `onConflictDoUpdate`/`onConflictDoNothing`, `node-postgres/migrator`), `@types/pg@8.23.1` (`Pool.options: PoolOptions` at `pg/index.d.ts:200`, `export { DatabaseError } from "pg-protocol"`), `pg@8.23.1` (the ESM entry `esm/index.mjs` exports `DatabaseError`, `Pool`, `Client`), `pg-protocol@1.16.1` (`DatabaseError(message, length, name)`, `code`/`constraint`/`detail` fields). `npm view` confirms that `pg@8.23.1`, `@types/pg@8.23.1` and `drizzle-orm@1.0.0-rc.4` exist (peer `pg >=8`).
- Nothing in the repository was changed apart from this file. No `.env*` file was read.

### Cross-task rows

| Pair | Produced by the first / consumed or quoted by the second | Finding |
| --- | --- | --- |
| T1 → T2 | `drizzle-orm`/`drizzle-kit` exactly `1.0.0-rc.4` (`package.json:38`, `:68`) / T2 builds the pg port on rc.4 | Agrees. |
| T1 → T3, T4, T12 (`package.json`) | T1 edits lines 38 and 68 / T3 removes `mysql2` (line 44), T4 adds `test:db` after line 18, T12 edits lines 2 and 10–11 | Agrees: no overlapping lines. |
| T2 → T3 | `dialect: 'postgresql'`, the baseline, `pg`/`@types/pg`; `mysql2` kept for the e2e fixtures / T3 migrates the e2e DB with `drizzle-kit migrate`, ports the fixtures to `pg`, removes `mysql2` | Agrees on the interfaces. **Conflict** in T3 Step 19: its first grep expects no `mysql2` mention in any `*.ts`, but T2 leaves comment mentions owned by T5/T10 and adds two permanent ones of its own (`db/index.ts` "mysql2's `connectTimeout`", `__tests__/db-pool.test.ts` "mysql2 gave up after 10 s"). See A1. |
| T2 → T4 | the baseline (11 tables, the index and key names) / `resetTables` truncates `users, user_groups, dify_apps, directory_sync_runs, instance_settings, password_reset_tokens CASCADE`; `schema.db.test.ts` asserts `users_email_key`, `user_groups_name_key`, `users_one_owner`, the three `_idx` indexes, `user_group_members_group_id_user_groups_id_fkey` | Agrees. The six truncated tables reach the other five through their cascading foreign keys (baseline lines 999–1006); `password_reset_tokens` (no FK) is named. |
| T3 → T4 | `docker-compose.e2e.yml` service `postgres`, `127.0.0.1:5433`, `e2e`/`e2e`/`e2e`, and its line 1 text / T4 Step 4 quotes line 1 "as Task 3 wrote it" and replaces it | Agrees: T4's quoted line 1 equals T3 Step 5's first line. T3's compose test (`names neither MySQL nor the old product`, tmpfs, port) still passes after T4's two-line header. T4's teardown `down postgres` removes the e2e container; T3's global setup starts it again and `auth.setup.ts` creates the owner on the empty tmpfs database. |
| T2 → T5 | constraint names in the baseline / T5's predicates and fixtures name `users_email_key`, `users_directory_id_key`, `users_one_owner`, `user_groups_name_key`, `directory_sync_runs_slot_key`, `user_group_members_pkey`, `user_group_members_group_id_user_groups_id_fkey`, `user_group_members_user_id_users_id_fkey`, `app_user_grants_user_id_users_id_fkey` | Agrees: all nine are in T2 Step 9's listing (lines 869–1006). |
| T2 → T5 (shared test files) | T2 ports `data-users`, `data-users-writes`, `data-setup`, `data-settings`, `data-directory-sync`, `data-directory-sign-in`, `data-apps-sync`, `group-management-actions`, `auth-options` / T5 edits fixtures in the same files | Agrees. T5's quoted fragments sit outside T2's edits; only their line numbers move, and T5 says to find by text. T2 leaves the error fixtures alone on purpose (T2 Steps 17, 19, 20, 21, 22, 23, 28, 29 name them as Task 5's). |
| T2 → T5 (`db/index.ts`) | the pool's `error` listener calls `logActionError(error, 'Database pool')` / T5 Step 26 makes `describeError` reduce a bare `DatabaseError` to `{ name: 'error', code }` | Agrees, and matches T14's expected log line `Database pool: { name: 'error', code: '57P01' }`. |
| T4 → T5, T6, T7, T8 | `__tests__/db/database.ts` (`pool`, `resetTables`, `testDb`), project `db` / each live file mocks `@/db` with `testDb`, `beforeEach(resetTables)`, `afterAll(() => pool.end())` | Agrees. The `vi.mock` factories' `import('./database')` resolves to the same module the file imports. |
| T2 → T6 | `lower(column)` exported from `db/schema/users.ts`; `drizzle.mock()` from `drizzle-orm/node-postgres`; T2's ported SQL pins / T6 imports `lower` from `@/db/schema/users`; T6 Step 5 quotes the three `auth-options.test.ts` lines and T6 Step 7 the four `data-directory-sign-in.test.ts` lines "Task 2 left" | Agrees: the derived text (T2 Steps 28 and 23) equals T6's quotes. |
| T5 → T6 | T5 Step 6 replaces `data-users-writes.test.ts:32–36`; T5 Step 14 makes `lib/data/users.ts` import `isUniqueViolation` from `./db-errors` / T6 Step 6 replaces lines 4–11 and appends after T5's cases; T6 Step 13 adds `./email` after that import | Agrees. T6's Step 11 account of the pre-fix failures ("the one duplicate retry … the second 23505 is thrown") matches T5 Step 17 (`recordDirectorySignIn` retries once after any 23505). |
| T2 → T7 | T2 Step 20 rewrites `data-setup.test.ts:7` to `PgTransactionConfig`; `users_one_owner` / T7 Step 1 quotes lines 5–7 "as Task 2 left it" | Agrees. |
| T5 → T7 | T5 Step 8 adds `it.each(['users_one_owner', 'users_email_key'])('answers forbidden when %s refuses the insert …')`; T5 Step 15 the catch `if (isUniqueViolation(error)) return fail('forbidden')` and its import / T7 Step 1 adds `'answers forbidden when users_one_owner refuses a second owner'`; T7 Step 6 keeps T5's catch line | Catch and import agree. **Duplicate test**: T7's new unit case repeats T5's `users_one_owner` case (same fixture, same assertion; T7 Step 2 says it already passes). See A3. |
| T5, T6 → T7 (`data-directory-sign-in.test.ts`) | T5 Step 11 replaces lines 293–295 with 7 lines (+4); T6 Step 7 replaces a 2-line comment at 196–197 with 3 lines (+1) / T7 Step 9 quotes "lines 344 and 348–349" | Agrees by text; the lines are 349 and 353–354 when T7 runs. |
| T4 ↔ T7, T5 ↔ T7 (live) | T4 `'holds one owner and any number of admins'`, T5 `'a second owner: 23505 on users_one_owner'` / T7 `'refuses a second owner row at the database, and takes any number of admins'` | Agrees in substance; three near-identical live pins of the same index. See A3. |
| T5 → T8 | `duplicate(constraint = 'users_email_key')`, `missing()` (`23503`, `user_group_members_group_id_user_groups_id_fkey`), `deadlock()` (`40P01`); `claimSyncRun`'s catch on `directory_sync_runs_slot_key`; the comment "A sign-in added the row meanwhile (23505 on the primary key) …" / T8 quotes all of these | Agrees: T8's quoted "after Task 5" text (task-8-brief lines 158, 462–495) equals T5 Steps 10 and 17. |
| T2 → T8 | the sync fake's `rowCount` state (T2 Step 22) / T8 consumes `{ rowCount: state.rowCount }` | Agrees. |
| T5 → T9 | `app/(admin)/app-management/actions.ts` line 10 becomes the `isForeignKeyViolation` import / T9 adds `isId` after it; T9's `sed` id renames in `group-management-actions.test.ts` and `user-management-rank.test.ts` | Agrees: T5's new fixtures (`pgError`, `nameTaken`, `memberGone`, the `operation_failed` case) contain none of `'u2'`, `'u3'`, `'u4'`, `'o1'`, `'a1'`, `'a2'`, `'u9'`. |
| T2, T3, T5, T6, T7 → T10 | the comments the earlier tasks rewrite or add / T10 Step 1's expected hit list and Step 8's allowed "history" list | **Minor conflict**: T3 adds two new "MySQL" mentions in `e2e/` (Step 15's `deleteUsersLike` doc "because MySQL's collation compared without case"; Step 16's `deleteAppsLike` doc "without case as MySQL compared") that T10 Step 1's list and Step 8's allowed list both omit, so T10 would treat them as leftovers and reword them. Everything else agrees: T2's history notes (`db/index.ts`, `db-pool`, `db-baseline`, `b3a-schema`, `groups.ts`, `directory.ts`), T4's `schema.db.test.ts`, T6's `email.ts`/`email.db.test.ts` are on T10's allowed list. See A1. |
| T5 → T10 | `driverFields` keeps `errno` for Node system errors / T10 Step 8: `errno` only in `lib/error-log.ts` | Agrees. |
| T3 → T11 | `deleteUsersLike` with ILIKE; `directoryAccount(email)` by exact `email = $1`; `e2e/admin-users.spec.ts` −4 lines / T11 (b) looks up `directoryAccount('Erin@E2E.hub.test')` in the seeded case; T11 says the case's `})` is line 147 after Task 3 | Agrees (the lookup uses the stored case; 151 − 4 = 147). |
| T6, T7 → T11 | `emailMatches`; `__tests__/db/owner.db.test.ts` / T11's table and comment | Agrees. |
| T2 → T12 | `aiAppHubDb` set in T2 Step 10 / T12 consumes it | Agrees. |
| T3 → T12 | compose names; `.env.template` lines 3–4 and `.env.e2e` line 5 / T12 edits the `MAIL_DEFAULT_SEND_FROM` line and line 29's brand comment | Agrees: different lines. |
| T5 → T12 (`__tests__/error-log.test.ts`) | T5 Step 20 turns line 1 into three import lines and appends after line 130 / T12 replaces "line 115" | Agrees by text (the line is 117 when T12 runs). |
| T4 → T13, T14 | `pnpm test:db`, `hub_dal`, files `schema`/`errors`/`email`/`owner`/`directory` | Agrees. |
| T2, T3, T5 → T14 | "Database migration complete" (T2 `db/migrate.ts`); `ai-app-hub-local-app`, `ai-app-hub-local-postgres`, mount `/var/lib/postgresql` (T3); the pool log line (T5) | Agrees. |

### Per-task rows

| Task | Self-consistency | Finding |
| --- | --- | --- |
| T1 | Files block = File map (`package.json` lines 38, 68 verified; `pnpm-lock.yaml`). Step 1's code claim holds (`lib/data/apps.ts:48` is the only `mapWith`). Step 3 runs only tsc and the unit tests on a lockfile-only change: adequate. | Step 4's commit has no trailers (A2). Otherwise consistent. |
| T2 | Specified tests pass against specified code: every `getSQLType()` value the schema tests assert matches rc.4 (`uuid`, `jsonb`, `bytea`, enum name, `timestamp with time zone` with no precision); `getTableConfig` index/PK/FK/check accessors exist; `$client.options.connectionTimeoutMillis` is typed; `listenerCount('error')` is 1 (pg-pool adds none of its own). RED (Step 2) holds: twelve MySQL folders, mysql-core tables, `pg` unresolved. Step 9's "12 folders" holds. Step 32's grep: all 38 hits of `drizzle-orm/mysql2`, `mysql-core`, `affectedRows`, `onDuplicateKeyUpdate` under `__tests__` today are covered by Steps 1, 17–31 (checked one by one), as are all backtick-SQL assertions, including the two negative ones (`data-apps-access:63`, `data-directory-sign-in:222`) that would otherwise pass vacuously. The SQL parameter numbering of the ported pins is consistent with Drizzle's update-set order (table-column order: `password`/`session_version`/`updated_at` → `$1…$3`; deactivate → `directory_deactivated_at = $1`, `updated_at = $2`, `source = $3`, ids `$4, $5`; refresh → id `$5`, source `$6`). Files block = File map; the commit's `git add` list covers every edited path. | Counts wrong in Step 11 and Step 21 (A4). Step 34's `oxfmt --check db` will flag the generated `snapshot.json` (drizzle-kit writes 2-space JSON; the committed snapshots are tab-formatted by lint-staged); the step's "fix with `pnpm exec oxfmt <files>`" covers it. Commit lacks trailers (A2). |
| T3 | `compose-files.test.ts` (21 cases: 3×5 + 2×2 + 1 + 1) passes against Steps 4–7's files (each regex checked against the specified YAML); RED (Step 3) holds. Every e2e fixture/spec line range in the Files block matches the tree (one off-by-one, F5); every `RowDataPacket`/`mysql2` import and MySQL comment in `e2e/` is covered by Steps 12–18. All seeded ids are UUIDs (`e2e/fixtures/stub/apps.ts`, `randomUUID()`), so the `uuid` columns accept them; booleans and enum values are sent as JS booleans and text, which PostgreSQL types from the target column. Step 21's scope (smoke + auth) is consistent with the Task 2 state (`reset-password` reads `rowCount`; `createOwner` still works at Repeatable Read). | Step 19's two "Expected: no output" greps cannot be met (A1). Fixture parity with decision l is partial (A6). Files block says `chat-files.spec.ts` 254–262, Step 18 says 253–262 (F5). Commit lacks trailers (A2). |
| T4 | 10 live cases; they pass against the T2 baseline (constraint names, `drizzle.__drizzle_migrations.name` column exists in the migrator's DDL). RED (Step 2) holds: without `--project`, only the `unit` project collects the file (the `ldap` project's include does not match, so its global setup does not run). `resetTables` reaches every table. Files block = File map. | `vitest.config.ts` line references are off (A5). The global setup imports `./database`, which builds a (lazy, unused) `Pool` in the Vitest main process: harmless. Commit lacks trailers (A2). |
| T5 | RED claims hold: Step 3 (5 + 4 fail: the predicates are undefined), Step 13 (callers throw `isDuplicateEntry is not a function`; `data-settings` passes because `isDeadlock` already reads `40P01`), Step 25 (bare `DatabaseError` logged whole, `errno` present, 22P02 → `operation_failed`/500). Step 5's note on `errno: undefined` under `toEqual` holds. Step 31's grep covers every MySQL code in `lib`, `app`, `__tests__` today (each hit checked: `action-failure` 68–97 inside the replaced 63–130 block, `data-setup` 97/102 inside 96–105, etc.). No import cycle: `lib/data/db-errors.ts` imports only `server-only`; `lib/error-log.ts` imports drizzle-orm, ldapts, pg and `lib/directory/errors.ts`. Files block = File map. | Unused mocks in the live tests (A7). 22P02 covers more than ids (A8). Commit lacks trailers (A2). |
| T6 | RED claims hold: Step 2 (module missing), Step 9 (five failures: two in `auth-options`, one each in `data-users-writes`, `data-directory-sign-in`, `forgot-password-route`; the handler also lowercases in JS), Step 11 (3 fail, 1 passes through T5's `users_email_key` mapping). `authorizeCredentials` does not normalise the email (`lib/auth/options.ts:73–85`), so the test's `params` equal the typed value. Step 18: the four `eq(users.email, …)` named in spec §3.4 are the only ones in `lib`/`app` today. `eq` stays used in all four edited modules. Files block = File map. | Consistent. Commit lacks trailers (A2). |
| T7 | RED (Step 2) holds: the call today is `[Function, { isolationLevel: 'repeatable read' }]`. Live tests pass before and after (stated), consistent with PostgreSQL's unique-check wait; no deadlock path (both inserts touch the same indexes in the same order). Step 11's grep: today's only hits are `lib/data/setup.ts:62` and `__tests__/data-setup.test.ts:82`, both removed. Files block = File map. | Second new unit case duplicates T5's (A3). Line numbers in Steps 6 and 9 are pre-T5/T6 (F9, F10; text decides). Commit lacks trailers (A2). |

### Fragment mismatches

Every other quoted fragment of Tasks 1–7 matches the tree (Tasks 1–2) or the state the earlier briefs leave (Tasks 3–7).

- **F1.** T2 Step 17, `__tests__/data-users.test.ts` lines 288–294. Quoted: `expect(query.sql).toMatch(/^select .* from \`users\` where \`users\`\.\`id\` = \? limit \? for update$/)` on one line. In the file it is wrapped over lines 289–291 (`expect(query.sql).toMatch(`/ the regex /`)`). The range is right; the replacement is reformatted by oxfmt anyway.
- **F2.** T2 Step 22, `__tests__/data-directory-sync.test.ts` lines 40–45. Quoted: `return failure ? Promise.reject(failure) : Promise.resolve([{ affectedRows: state.affectedRows }])` on one line. In the file it spans lines 42–44 (`return failure` / `? Promise.reject(failure)` / `: Promise.resolve([{ affectedRows: state.affectedRows }])`). The range is right.
- **F3.** T3 Step 18, `e2e/directory-groups.spec.ts` lines 57–63. Quoted: `db.execute<RowDataPacket[]>('SELECT id FROM user_groups WHERE name = ?', [` / `tag(),` / `])`. In the file, lines 58–61 read `db.execute<RowDataPacket[]>(` / `'SELECT id FROM user_groups WHERE name = ?',` / `[tag()],` / `)`. The range is right.
- **F4.** T4 Step 4, `vitest.config.ts`. "Replace lines 15–35" but the quoted fragment is lines 14–23 (the two-line comment starts at 14; the `unit` entry closes at 23). "After the `ldap` project's closing `},` (line 35)": line 35 closes the `ldap` entry's `test` object; the project's closing `},` is line 36. See A5.
- **F5.** T3 Files block gives `e2e/chat-files.spec.ts` lines 254–262; Step 18 gives 253–262. 253 is right (`await withDb(db =>`).
- **F6.** T3 Step 5: "line 35" and "line 84" are pre-edit numbers. After lines 1–27 become the 34-line `postgres` block, the two `container_name` lines are 42 and 91. The text decides.
- **F7.** T2 Step 17 says the `isDuplicateEntry` block is lines 268–284; it is 268–283 (284 is blank). T5 Step 7 has it right.
- **F8.** T2 Step 28 says the failed-query case is lines 230–252; it is 230–251. T5 Step 23 has it right.
- **F9.** T7 Step 9: `data-directory-sign-in.test.ts` "lines 344 and 348–349" are base-commit numbers. After T5 Step 11 (+4) and T6 Step 7 (+1) they are 349 and 353–354. The text matches.
- **F10.** T7 Step 6: `lib/data/setup.ts` "lines 39–69" become 39–70 after T5 Step 15 (+1 comment line). The step replaces the whole function, so nothing is lost.
- **F11.** Pair note: T12 Step 1's `__tests__/error-log.test.ts` "line 115" is 117 after T5 Step 20 adds two import lines. The text decides.

Claims about the current code that were checked and hold: twelve MySQL migration folders; `__tests__/data-db-errors.test.ts` 41 lines; `lib/data/db-errors.ts` 25; the schema files' line counts (68, 50, 57, 37, 62, 17, 40, 7); `db/index.ts` and `db/migrate.ts` 15 each; `docker-compose.local.yml` 47 and `docker-compose.yml` 19 lines; `package.json` lines 18, 38, 44, 68; `lib/env.ts:25`; `lib/auth/options.ts:32`, `:68`; every spec §3.4 `affectedRows`/`onDuplicateKeyUpdate` site; the seven seeded stub apps (5 + 2); `pg` on Next's default `serverExternalPackages` list (`node_modules/next/dist/docs/…/serverExternalPackages.md:75`); every test count except the two in A4.

### Findings and suggested rulings

**A1. Important: Task 3 Step 19's two "Expected: no output" greps cannot pass, and Task 10 does not expect two of the hits.**

The first grep, `git grep -n "mysql2" -- '*.ts' '*.tsx' '*.mts' '*.js'`, still hits after Steps 13–18:

- comments that Tasks 5 and 10 rewrite later: `lib/error-log.ts:30–32, 66, 68`, `lib/data/db-errors.ts:6`, `lib/data/directory.ts:253–254`, `__tests__/action-failure.test.ts:100–101`, `__tests__/data-db-errors.test.ts:7`, `__tests__/data-setup.test.ts:33`;
- two comments Task 2 adds on purpose and that stay for good: `db/index.ts` ("mysql2's `connectTimeout`") and `__tests__/db-pool.test.ts` ("mysql2 gave up after 10 s"). Task 10 Step 8 lists both as history.

The second grep, `git grep -n -i "mysql" -- e2e …`, hits Task 3's own new comments:

- Step 15's `deleteUsersLike` doc ("because MySQL's collation compared without case");
- Step 16's `deleteAppsLike` doc ("without case as MySQL compared").

Task 10's Step 1 hit list and Step 8 allowed list omit both, so Task 10 would reword them.

- **Ruling:** turn the first check into an import check: `git grep -nE "from '(mysql2|drizzle-orm/mysql)" -- '*.ts' '*.tsx' '*.mts' '*.js'`, expected no output. The comment mentions belong to Tasks 5 and 10, and Task 2's two history notes stay. For the second check, the expected output is exactly those two decision-l history comments. Tell Task 10 to treat them as history (add them to its Step 8 list), or let Task 3 word them without the engine's name ("as the old collation compared"). The spec does not care either way.
- **If left alone:** the implementer meets a gate it cannot pass and either stops, or edits comments that Tasks 2, 5 and 10 own. No functional harm, but a likely stall or scope creep.

**A2. Important: every commit block in Tasks 1–7 leaves out the trailers that Global Constraints require.**

The blocks are T1 Step 4, T2 Step 34, T3 Step 22, T4 Step 7, T5 Step 32, T6 Step 19 and T7 Step 12. Each is `git commit -m "<subject>"`. Global Constraints and CLAUDE.md require each commit to end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: <link>` in the same `-m` argument.

- **Ruling:** implementers append both trailers inside the one `-m` (subject, blank line, the two trailer lines), as Global Constraints say. The controller states this in every dispatch.
- **If left alone:** seven commits without the owner's required attribution. Fixing them later means rewriting branch history before the push.

**A3. Minor: duplicated tests.**

- T7 Step 1's second case, `'answers forbidden when users_one_owner refuses a second owner'`, repeats T5 Step 8's `it.each(['users_one_owner', …])` case. Both test the same `createOwner` path with the same fixture (a `DrizzleQueryError` whose cause is `23505`/`users_one_owner`) and the same assertion. T7 Step 2 admits it already passes.
- Three live cases pin the same partial-index refusal:
  - T4 `schema.db.test.ts`: "holds one owner and any number of admins";
  - T5 `errors.db.test.ts`: "a second owner";
  - T7 `owner.db.test.ts`: "refuses a second owner row at the database, and takes any number of admins".
- T4 and T5 each define their own `refusal` helper, with different shapes.
- **Ruling:** drop T7's second unit case (T5's `it.each` covers it), and drop T7's third live case (T4's covers it). T7 keeps its two race tests, which are the new proof. Optionally, move one `refusal` helper into `__tests__/db/database.ts`.
- **If left alone:** a reviewer flags the duplication. Nothing breaks.

**A4. Minor: two test counts in Task 2 are off.**

- Step 11 expects "9 + 3 + 7 + 5 + 2 + 5 = 31". `b3a-schema` has 9 cases (3 plain + 2 `it.each` of 3 each), so the total is 33.
- Step 21 expects `data-settings` "(12 tests)". The file has 13 `it(` cases (lines 100–233), and the step adds none.
- **Ruling:** trust the run; all cases must pass.
- **If left alone:** an implementer may hunt for a missing or extra test.

**A5. Minor: Task 4 Step 4's line references in `vitest.config.ts` are off (F4).**

- **Ruling:** replace the quoted text, which is lines 14–23. Insert the `db` project after the `ldap` project's own closing `},` (line 36), not after line 35.
- **If left alone:** inserted after line 35, the `db` entry lands inside the `ldap` project object. The config breaks visibly (vitest and tsc error at once), so the damage is low.

**A6. Minor: Task 3's fixtures do not fully follow plan decision l ("the e2e fixtures match the way MySQL did").**

- `seedGroup` deletes a leftover with `DELETE FROM user_groups WHERE name = $1` (Step 16), but the unique index is now `lower(name)`, and MySQL's `name = ?` ignored case.
- `deleteDirectoryAccount` deletes by `email = $1` (Step 17).
- A case-variant leftover from a killed run would make `seedGroup`'s insert fail with 23505.
- **Ruling:** use `WHERE lower(name) = lower($1)` in `seedGroup`, as `seedUser` does for email, and optionally `lower(email) = lower($1)` in `deleteDirectoryAccount`. Leave `directoryAccount`'s exact lookup alone: Task 11 (b) calls it with the stored case.
- **If left alone:** a rare flake after an interrupted e2e run.

**A7. Minor: the live tests carry mocks they do not need.**

- `__tests__/db/errors.db.test.ts` (T5 Step 2) mocks `@/db` and `@/lib/auth/options`, but imports only `@/db/schema`, `lib/data/db-errors` and `lib/error-log`, none of which load either module.
- `__tests__/db/owner.db.test.ts` (T7 Step 3) mocks `@/lib/auth/options`, but after T5 Step 15 `lib/data/setup.ts` no longer imports `./users`, so it never reaches `lib/auth/session`.
- **Ruling:** drop the unused `vi.mock` calls. Keep `@/db` in `owner.db`.
- **If left alone:** reviewer nit.

**A8. Minor: T5's 22P02 safety net covers more than malformed ids.**

SQLSTATE `22P02` (`invalid_text_representation`) is also raised for invalid enum, boolean or json input text. `toActionFailure` and `errorResponseFrom` would answer those as `not_found`/`app_not_found`. zod validates those values before any query, and the line is logged with its code, so the behaviour is acceptable.

- **Ruling:** keep the code. Word the two comments as "a value its column's type cannot read, in practice a malformed id".
- **If left alone:** a misleading answer in a case that should not occur.

**A9. Minor: three quoted fragments differ from the file only in line wrapping (F1–F3).**

- **Ruling:** find them by their line range and meaning, and keep the replacement as oxfmt formats it.
- **If left alone:** an exact-text search fails, and the implementer has to look.

**A10. Minor: spec §6 says "Every `rowCount` consumer handles `null`", but only some consumers have a `null` test.**

Plan decision t pins the `null` case for the directory writes and `deleteGroup`. `deleteApp` (`lib/data/apps.ts:550–554` after T2) and the reset-password route (T2 Step 15) use `?? 0` but have no `null` case.

- **Ruling:** the code handles `null` everywhere, so this is acceptable as decision t chose. Optionally add a one-line `rowCount: null` case for `deleteApp`.
- **If left alone:** no functional effect.

**A11. Minor (informational): between Task 3 and Task 14, CLAUDE.md's local-stack commands no longer work.**

The owner's local MySQL stack (`dify-app-hub-local-app`, `dify-app-hub-local-mysql`) is running, as it should be. After Task 3, `docker-compose.local.yml` names the project `ai-app-hub-local` and requires `POSTGRES_*` through `${…:?}`. CLAUDE.md's quick-dev-loop and Docker-gate commands, such as `docker compose -f docker-compose.local.yml stop app`, then fail interpolation, and with the variables set they would target a different project. No task step runs them before Task 14.

- **Ruling:** no plan change. The controller tells implementers not to use those CLAUDE.md commands before Task 14, and to reach the old stack only by `-p dify-app-hub-local` (decision r).
- **If left alone:** an implementer who follows CLAUDE.md out of habit gets an error. Nothing is damaged.

Blockers: none found in Tasks 1–7.

## Seat B (Tasks 8–14)

## Pre-flight B: Tasks 8–14

Scanner B, 2026-10-12, read-only. The checkout is `feat/postgres-and-rename` at 79e72a05, the same code as 477d261d (only `CLAUDE.md` line 67 differs). Line numbers in "file:line" are the current tree's unless marked "base".

Checks run in this environment, all read-only or in the scratchpad:

- `tsc --strict` on an isolated copy of Task 8's test fake. Result: TS2322 on `rowCount = null`.
- `docker buildx bake --print` on Task 12's bake file, built in a scratch folder and deleted afterwards. Result: it fails without the variable and prints the expected tags with it.
- `npm view drizzle-orm@1.0.0-rc.4 peerDependencies`. Result: `mysql2` and `@effect/sql-mysql2` are optional peers.
- `pnpm exec oxfmt --check .` on today's tree. Result: 60 files fail.
- `docker ps` and `docker volume ls`. Result: the old stack's names match Task 14 Step 8.
- The sed commands of Task 9 Step 1, simulated in the scratchpad.

### Cross-task rows

| Tasks | Shared file / interface | Produced vs consumed | Finding |
| --- | --- | --- | --- |
| 2–8 | `lib/data/directory.ts`, `applyMembershipChanges` removals | Task 2 Step 14 turns `const [result]` into `const result` and `removed += result.affectedRows` into `result.rowCount ?? 0`. Task 8 Step 8 quotes both. | Agrees. |
| 2–8 | `__tests__/data-directory-sync.test.ts`, the fake's `state` | Task 2 Step 22 writes `rowCount: 1 as number \| null` (with a JSDoc) and adds three cases that set `mocks.state.rowCount = null`. Task 8 Step 1 replaces the whole hoisted block with `rowCount: 1` (type `number`). | **Conflict (B1).** tsc fails on the three null assignments. |
| 2–8 | Schema: `directory_sync_runs` columns, `user_group_members` columns, `directory_sync_runs_slot_key` | Task 2 Step 7: id, slot, run_trigger, started_at, finished_at, outcome, 8 counters, error_code. `user_group_members`: group_id, user_id, source, created_at (defaultNow). | Agrees with Task 8's rendered SQL strings and params. |
| 4–8 | `__tests__/db/database.ts` (`pool`, `testDb`, `resetTables`), project `db` | `resetTables` truncates `users`, `user_groups`, `directory_sync_runs` … CASCADE. | Agrees. Memberships cascade; files run one at a time. |
| 5–8 | `lib/data/directory.ts`: predicates import, `claimSyncRun` and `applyMembershipChanges` after Task 5 | Task 5 Step 17 text, e.g. "same slot (23505)" and `isUniqueViolation(error, 'directory_sync_runs_slot_key')`. | Agrees with Task 8 Steps 7–8's "after Task 5" quotes. |
| 5–8 | Test fixtures `duplicate(constraint)`, `missing()`, `deadlock()`; the comment at base 246–247 | Task 5 Step 10. | Agrees. `duplicate` stays in use (refresh cases), so nothing becomes unused. |
| 6–8 | `lib/data/directory.ts` (`./email` import, `emailTakenBy`) | Task 6 edits base 17–18 and 98–100. | No overlap; line shift only. |
| 7–8 | `lib/data/directory.ts` | Task 7 edits 219–226. Task 8 edits 203–211. | Adjacent, no overlap. |
| 8–10 | `lib/data/directory.ts` comments; `data-directory-sync.test.ts` 422–424 and 477 | Task 10 leaves the claim, membership, deadlock and batch comments to Task 8. Task 8 leaves the deadlock describe untouched. | Agrees. |
| 8–13 | ADR-0031's re-derivation rows | `onConflictDoNothing({ target: slot }).returning({ id })`; memberships `onConflictDoNothing()`, 23503 retried row by row. | Agrees. |
| 8–14 | `pnpm test:db` (directory file), `pnpm test:ldap` | Step 3 and Step 4. | Agrees. `sync.ldap.test.ts:20-40` stubs the DAL, as Task 8 Step 11 says. |
| 2–9 | `user-management-rank.test.ts` (Task 2 line 75); `group-management-actions.test.ts` (Task 2 Step 29: lines 71, 142, 202–205) | Task 9 changes ids only, above line 64 and after line 60. | Agrees, no overlap. |
| 5–9 | `app/(admin)/app-management/actions.ts` | Task 5 Step 18 changes line 10 to `isForeignKeyViolation` and lines 32/55. Task 9 Step 8 deletes line 4 and line 20 and adds `@/lib/ids` after line 10. | Agrees. `z` has no other use (`actions.ts:20` only). |
| 5–9 | `group-management-actions.test.ts` and `app-management-actions.test.ts` fixtures; the 22P02 net in `toActionFailure` and `errorResponseFrom` | Task 9 consumes these as the fallback. | Agrees. |
| 4–9 | `schema.db.test.ts` "raises 22P02 for a malformed uuid" | The reason behind Task 9. | Agrees. |
| 9–10 | `__tests__/dify-route.test.ts` | Task 9 inserts two tests before the comment at base line 64. Task 10 Step 7 replaces that comment by its text. | Agrees (match by text). |
| 9–10 | `user-management-rank.test.ts:22`; `user-management/schemas.ts` comment | Task 10 owns line 22. Task 9 owns the `varchar(36)` comment. | Agrees. |
| 9–10 | Task 9's new `lib/ids.ts` comment says "where MySQL's text column matched nothing" | Task 10 Step 8's re-run will list it. | Its expected list omits the line (B10). |
| 9–11 | `isId` in the guard, the page and the icon route | e2e case (d). | Agrees. The texts are verified: `app.no_config_default_text`, `app_not_found` envelope, `icon_not_found`. |
| 9–13 | ADR-0031 and CLAUDE.md name `lib/ids.ts`, `idSchema`, `isId`, "25 route files" |  | Agrees: 25 files, all call `resolveDifyRoute` (checked). ADR's "corrections" section is stale (B5). |
| 9–14 | Step 11 curl `/api/dify/<uuid>/parameters` signed out → 401 |  | Agrees. |
| 2–10 | Task 2's history notes: `db/index.ts`, `__tests__/db-pool.test.ts`, `db-baseline.test.ts`, `b3a-schema.test.ts`, `db/schema/{groups,directory}.ts` | Task 10 Step 8 lists them for the main search. | Agrees for the main list. The `collation` list omits `db/schema/groups.ts` and `__tests__/db-baseline.test.ts` (B10). |
| 3–10 | Task 3's new e2e comments: `e2e/fixtures/users.ts` ("ILIKE, because MySQL's collation compared"), `e2e/fixtures/access.ts` ("without case as MySQL compared"); `__tests__/compose-files.test.ts` title "names neither MySQL nor the old product" | Task 10 says the e2e side is Task 3's. | Step 1 says "rewrite any further line", and Step 8's lists omit these lines (B10). Aside for scanner A: Task 3's own `git grep -n -i "mysql" -- e2e …` "no output" check is hit by the same two fixture comments. |
| 4–10 | `__tests__/db/schema.db.test.ts` note |  | Listed in the main list; missing from the `collation` list (B10). |
| 5–10 | `lib/auth/options.ts:68` errno comment; `lib/data/apps.ts` 228/485; error fixtures | Task 5 Steps 18 and 25 rewrite them. | Agrees. Step 8's `errno` expectation holds. |
| 6–10, 7–10 | Email comments (directory.ts 98, sign-in test 197/287); setup.ts and the isolation comment | Owned by Tasks 6 and 7. | Agrees. |
| 2–11, 5–11, 6–11, 7–11 | `users_one_owner`, `users_email_key` → `email_in_use`, `emailMatches`, `owner.db.test.ts` |  | Agrees. |
| 3–11 | Fixtures (`seedUser` deletes by `lower(email)` and stores the email as given; `deleteUsersLike` uses ILIKE; `directoryAccount` matches the email exactly; `withDb(Client)`); `admin-users.spec.ts` closing line 151 → 147 | Task 3 Steps 15–17 and its admin-users edit (−4 lines). | Agrees. `directoryAccount('Erin@E2E.hub.test')` finds the row because it was seeded in that exact case. |
| 11–12 | `e2e/auth.spec.ts` | Task 11 inserts after line 39. Task 12 seds `'Dify App Hub'` (line 45 before Task 11). | Agrees. |
| 11–13, 11–14 | cii e2e spec count (36 → 38, computed); Step 6 full run |  | Agrees. |
| 2–12 | `db/index.ts` `aiAppHubDb` |  | Agrees. |
| 3–12 | Compose names; `.env.e2e` (Task 3 line 5, Task 12 line 29); `.env.template` (Task 3 DB block, Task 12 MAIL line); compose-files test (no `dify-app-hub`) |  | Agrees. Every current old-name hit outside the exclusions is covered by Tasks 2, 3 or 12 (checked with `git grep`). |
| 5–12 | `__tests__/error-log.test.ts` | Task 5 adds two import lines and appends a describe. Task 12 replaces the path line by its text. | Agrees. |
| 12–13 | ADR-0019 note names; Task 12's grep excludes `CLAUDE.md` and `docs/` |  | Agrees. The bake "no default" is recorded in the running record (README:358). An ADR clause for it is optional. |
| 12–14 | Dockerfile `--filter ai-app-hub deploy` | Proven by Step 9's build. | Agrees. |
| 13–14 | cii: Task 13 says "Task 14's full run may replace" the dated e2e sentence | Task 14: "Files: none changed". | Minor conflict (B14). |
| 2/10/13–14 | `mysql2` mentions: Task 2 (`db/index.ts`, `db-pool.test.ts`), Task 13 (`CLAUDE.md` "mysql2's default kept"); lockfile peers from drizzle-orm rc.4 (Task 1) | Task 14 Step 5 and ADR-0031's Verification expect none. | **Conflict (B3).** |
| 2/3–14 | Container names, healthcheck, "Database migration complete" (`db/migrate.ts`), `Database pool:` log, `drizzle.__drizzle_migrations.name` |  | Agrees. The old stack's names were checked live: `dify-app-hub-local-app`, `dify-app-hub-local-mysql`, `dify-app-hub-local_mysql-data`. |
| 5–14 | Pool error described as `{ name: 'error', code: '57P01' }` | Task 5 (`DatabaseError` → its name `'error'`). | Agrees. `/api/health` queries the database, so an idle client exists for Step 13. |
| 4–14 | `pnpm test:db` files: schema, errors, email, owner, directory |  | Agrees. |
| 2–13 | ADR-0030 note (`connectionTimeoutMillis: 10_000`) |  | Agrees. The driver bullet of ADR-0031 omits the option (B19 nit). |
| 6–13, 3–13, 4–13 | auth-gate bullet (`emailMatches`); CLAUDE.md ports and projects; "Database test project" paragraph |  | Agrees. |
| 13–spec | ADR-0031 "Corrections to the spec's text" and the migration step command | Spec §3.2, §4, §5 and §7 as they stand. | **Conflict (B5, B6).** |
| 12/13/14–tree | `oxfmt --check .` on the whole tree | 60 files fail before Part 0. | **Conflict (B4).** |

### Per-task rows

| Task | Self-consistency |
| --- | --- |
| 8 | **Red step:** traced against the new fake. With the old code, `values()` returns a non-thenable object, so no insert is recorded. The listed tests fail as described: membership tests 1–4, claim tests 1–3, and 6 deadlock cases (3 variants × `claimSyncRun` and `applyMembershipChanges (add)`). The rest pass. **Green step:** traced; every new expectation holds, including one write per attempt in the deadlock cases. **Live tests:** 7, and they pass before and after the change, as Step 6 says. **Defects:** the tsc gate fails (B1). Step 10's count is wrong: 56, not 53 (B7). Step 2 says "the second test" while Task 2 inserted a null-count case before it (match by text). The live test's `vi.mock('@/lib/auth/options')` is dead (B17). Files block, git add and File map agree. |
| 9 | **Red step:** 13 failures confirmed. The user actions fail on both the `operation_failed` result and the not-called assertions; the schema cases parse today; the guard, page and icon tests fail on their not-called assertions. **Green step:** 16 files, +15 tests. **Mechanical counts:** every quoted count matches the tree (5/2/3, `'a1'` ×4, 18, 11/6/9/15, 7/1/2). Step 1's expected output is wrong for three files (B8). **Fragments:** they exist; one is formatter-wrapped (fragment 2). **Stale prose:** "the spec's 26" (B5). Files, git add and File map agree. Every outside-id spot is covered: no page or route takes an id from search params; the reset, forgot and branding routes take none. |
| 10 | Comment-only. All quoted fragments exist verbatim (listed below). Step 7's `ECONNRESET` swap is safe: the directory code classifies errors by `instanceof` (`lib/directory/sync.ts:69-72`, `lib/auth/directory-provider.ts:75`), never by code. **Defects:** Step 1's and Step 8's expected outputs are incomplete, and Step 1's "rewrite any further line" contradicts Step 8 (B10). Step 1's list misses `__tests__/directory-sync.test.ts:291`. The PostgreSQL quotes match the 18 docs: 13.1, 13.2.1, 13.3.2, 13.3.4, 13.5, INSERT, the wiki. Files block (19 files) = git add = File map. |
| 11 | Anchors hold: auth.spec 39, directory-sign-in 108, admin-users 151→147. Imports are already present in each spec. **Texts:** "This email is already in use" is `locales/en/translation.json:283`; the missing page text comes from `app-unavailable.tsx` → `app.no_config_default_text`; `E2E_ADMIN_EMAIL=admin@e2e.local`. "2 skipped" holds (none of the three specs skips today). The chat-messages route resolves the guard before reading the body. **Defects:** (c) has a weak final assertion and (d) uses `<500` against the spec's 200 (B11). Files and File map agree. |
| 12 | **Red claims:** right, except "five expectations": the `brandingView` case (lines 239–240) passes before the code change (B12, nit). **Bake check:** run live; the build fails with the message without `DOCKERHUB_USERNAME`; tags `example/ai-app-hub:latest`, then `v1.0.0` plus `latest`. CI passes the variable from secrets (`docker-build-push.yaml:37`). **Lockfile:** importers are keyed by path; `dify-app-hub` does not appear in it. openssl is 3.0.13, so `-noenc` works. All fragments exist. Step 13's grep covers every current hit. Files, git add and File map agree. Stale prose: "spec §4 leaves it out" (B5). |
| 13 | **Line-67 fragment:** absent, and the line-66 insertion duplicates line 67 (B2). Every other CLAUDE.md, auth-gate, ldap, ADR README and cii fragment exists. CLAUDE.md has 139 lines; adding 7 gives ~146. All target files pass `oxfmt --check` today. Wide markdown tables stay compact (oxfmt aligns only narrow ones, as README's tables show). **ADR-0031:** the corrections section is stale (B5); the migration-step command contradicts spec §5 (B6); the Verification grep fails like Task 14 Step 5 (B3); "Affected paths" lists user and group `actions.ts`, which do not change (B19). **Step 9:** its expected grep is slightly off (B13). **Step 11:** conflicts with Task 14 (B14). |
| 14 | Step 1's oxfmt fails today (B4). Step 5 cannot pass (B3). **Step 8:** names match the live stack. **Step 10:** the log line exists in `db/migrate.ts`. **Step 13:** `/api/health` runs `SELECT 1`, so a pooled client is idle at the restart; the postgres image stops with SIGINT (fast shutdown), so idle clients get 57P01. Steps 7 and 12 need the owner at the machine (B16). Nothing in Task 14 reads or prints `.env`. |

### Fragment mismatches

1. **Task 13 Step 9, `CLAUDE.md:67`.** The step quotes "- Next step: AG-UI agents (Pydantic AI and other frameworks) in the chat, an AG-UI provider and its UI elements: brainstorm, spike and ADR (…)". The file now reads "- Next step: the **provider-hub programme** (owner, 2026-10-11/12): the hub becomes "AI App Hub", … **Part 0** PostgreSQL 18 and the product rename (spec …, plan …, to run **subagent-driven** on `feat/postgres-and-rename` from `fork/overhaul`; it stops in Task 14 for the owner's `.env` edits before the Docker gate), **Part 1** …, **Part 2** …, **Part 3** …. Charter: …. Every decision …: the running record … (start there). …". This is the one-line change since 477d261d, from 2db3fe81 and 11084f29. The rest of the line, from "Settings and branding is merged …" on, matches the base.
2. **Task 9 Step 2, `__tests__/group-management-schemas.test.ts:32-38`.** The step quotes the third `expect(…).toBe(false)` on one line. The file wraps it over lines 35–37 (`.toBe(` / `false,` / `)`). Match by text.
3. **Task 8 Step 2 ("Replace the second test").** After Task 2 Step 22, the second test of that describe is Task 2's "counts no removal when the driver reports no row count". The quoted comment anchor ("A sign-in added the row meanwhile (23505 on the primary key) …") picks the right test, which is now the third. Not a text mismatch.

Every other quoted fragment of Tasks 8–14 exists now or is produced by an earlier brief. Checked:

- **Task 8:** `directory.ts` 203–211, 252–257, 264–271, applyMembershipChanges and claimSyncRun after Tasks 2 and 5; test file anchors after Tasks 2 and 5.
- **Task 9:** `route.ts` 28–43, page 6–14, icon 20–21, the three schemas files, `actions.ts`, every test anchor.
- **Task 10:** all 25 fragments.
- **Task 11:** anchors.
- **Task 12:** bake 1–3 and 18–20, Dockerfile 12, package.json 2/10/11, docs package, workflow 35, ecosystem 4, oxfmtrc 30–31, `.env.template`, `.env.e2e:29`, branding-rules 4, layout 34, schedule 24/67/77/102, chat-view 78, seed 9, generate.sh 16, the test lines.
- **Task 13:** CLAUDE.md 21/31/37/62/66/73/80/82/87/91/95/99/109/110; auth-gate 44/49/53/57; ldap 109; README rows 28/54; ADR "More Information" sections last in 0004, 0019 and 0030; cii rows 48/49/60/66, change-log header.

### Findings and suggested rulings

**B1 — Important. Task 8 Step 1 breaks the tsc gate.**

- **The problem:** the replacement fake declares `rowCount: 1`, which infers `number`. Task 2 Step 22 left three cases that do `mocks.state.rowCount = null`: in the deactivate/reactivate, refresh and applyMembershipChanges describes.
- **Evidence:** reproduced with `tsc --strict` on an isolated copy of the fake: `TS2322: Type 'null' is not assignable to type 'number'`. Vitest does not type-check, so Step 10 passes and Step 12's `tsc --noEmit` fails.
- **Ruling:** keep Task 2's line in Task 8's block, `/** node-postgres "Result": \`rowCount\` is the rows the statement matched, or null. \*/ rowCount: 1 as number | null,`.
- **If left alone:** the gate fails. Worse, an implementer may delete the null-count cases that spec §6 ("Every `rowCount` consumer handles `null`") requires.

**B2 — Important. Task 13 Step 9 edits a CLAUDE.md line that no longer exists, and duplicates pointers.**

- **The problem:** line 67's quoted first sentence is gone (fragment 1). The current line 67 already carries the charter, the running record, the Part 0 spec and plan, and the Part 1 spec. Step 9's insertion into line 66 would repeat them.
- **Ruling:**
  - Skip the line-66 insertion.
  - In line 67, replace the Part 0 parenthesis "(spec …, plan …, to run **subagent-driven** on … ; it stops in Task 14 for the owner's `.env` edits before the Docker gate)" with Part 0's state: done on `feat/postgres-and-rename`, ADR-0031 proposed until the owner's check, the PR opened on the owner's word.
  - Add Task 13's rename sentence: the GitHub repo can be renamed any time and a session then runs `git remote set-url`; the folders, Claude Code's project directory and the memory paths wait for the end of the programme (Part 0 spec §8; owner, 2026-10-12). This is plan decision s, and it must land.
  - Keep the rest of the line.
- **If left alone:** the implementer stalls or improvises; the spec §8 pointer may be lost, or the pointers end up duplicated.

**B3 — Important. Task 14 Step 5 (and ADR-0031's first Verification box, Task 13 Step 2) cannot pass.**

- **What the grep finds:**
  - Task 2's intentional notes "mysql2's `connectTimeout`" in `db/index.ts` and "mysql2 gave up after 10 s" in `__tests__/db-pool.test.ts`. Task 10 Step 8 explicitly keeps both.
  - Task 13's `CLAUDE.md` follow-up "(mysql2's default kept, ADR-0031)".
  - `pnpm-lock.yaml`: `drizzle-orm@1.0.0-rc.4` lists `mysql2: '>=2'` and `@effect/sql-mysql2` as optional peers (`npm view drizzle-orm@1.0.0-rc.4 peerDependencies`; today's lock has the same block for rc.3 at `pnpm-lock.yaml:3441`, `:3508`). So `grep -c mysql2 pnpm-lock.yaml` is at least 2.
- **What the spec asks:** §9 asks for no `mysql2` or mysql-core _import_.
- **Ruling:** replace the check in both places with:
  - `git grep -nE "from '(mysql2|drizzle-orm/mysql)|drizzle-orm/mysql-core|image: mysql" -- . ':!docs/**' ':!*.md'` → no output;
  - `pnpm why mysql2` → no dependents. Equivalently `grep -nE "^  mysql2@" pnpm-lock.yaml` → no output, meaning no installed `mysql2` package.
- **If left alone:** the final gate "fails". The implementer either rewrites history notes other tasks keep on purpose or stops.

**B4 — Important. Task 14 Step 1's `pnpm exec oxfmt --check .` fails before Part 0 changes anything.**

- **Today's failures:** 60 files.
  - 30 under `.claude/skills/`, 15 under `docs/superpowers/`, 9 under `packages/docs/`;
  - `README.md`, `.all-contributorsrc`, `skills-lock.json`, `docs/dify-service-api-1.17.1.md`;
  - two MySQL migration `snapshot.json` files, which Task 2 deletes.
- **Ruling:** run `oxfmt --check` on the files the branch changed or added, `git diff --name-only --diff-filter=AMR fork/overhaul...HEAD`, and expect them clean. For the whole tree, expect the base's list minus the two deleted snapshots. If drizzle-kit's new baseline `snapshot.json` shows up, the controller decides whether to format a generated file. Do not format upstream, skill or `packages/docs` files: spec §1 keeps them for the housekeeping work.
- **If left alone:** the step fails, or the implementer reformats about 58 unrelated files.

**B5 — Important. ADR-0031's "Corrections to the spec's text, found while planning" (Task 13 Step 2) contradicts the spec as it stands.**

- **The four claims, each already handled by the spec:**
  - §3.2 says "all 25 `[appId]` route files" (`design.md:91`);
  - §3.2 says "The directory groups route takes no id";
  - the §4 table has the `.github/workflows/deploy-docs.yml` row;
  - §7 names auth-gate's recovery command and "MySQL error 3819".
- **The same stale claims** appear in Task 9's preamble ("the spec's '26' is one too many") and in Task 12's Files ("spec §4 leaves it out").
- **Ruling:** drop the section from ADR-0031, or reword it as one sentence: the plan's corrections were applied to the spec while planning (1cfec7a8). Ignore the prose claims in Tasks 9 and 12.
- **If left alone:** a permanent record misstates the binding spec.

**B6 — Minor. ADR-0031's Implementation Plan contradicts spec §5 step 3 (Task 13 Step 2, "Migration steps").**

- **The problem:** the ADR says `docker compose -f docker-compose.local.yml down` "on the old checkout". Spec §5 step 3, plan decision r and Task 14 Step 8 use `docker compose -p dify-app-hub-local down` after `--dry-run`. On the branch, the file names the new project, so the ADR's command would act on the new stack.
- **Ruling:** use spec §5's command.

**B7 — Minor. Task 8 Step 10's count is wrong.**

- **The count:** the base file has 50 tests, Task 2 Step 22 adds 3 and Task 8 adds 3, so expect 56, not 53.
- **Wording:** Step 2's "the second test" is the third one after Task 2 (see fragment 3).

**B8 — Minor. Task 9 Step 1's expected counts are wrong for three files, and one replacement weakens a test file.**

- **Wrong counts:** `dify-routes-chat`, `-files` and `-run` print `0 4`, not `0 3`, because each already holds the UUID string: `const UUID` at `dify-routes-chat.test.ts:40`, `'file-3b24…'` at `dify-routes-files.test.ts:134`, `'ft-3b24…'` at `dify-routes-run.test.ts:224`.
- **Weakened test:** in `dify-routes-chat.test.ts`, the app id becomes equal to the conversation `UUID` used at lines 129–199. A handler that passed the app id where the conversation id belongs would still pass.
- **Ruling:** accept `0 4` for those three. In `dify-routes-chat.test.ts`, use a different UUID for the app id, e.g. `sed 's/app-1/0b1c2d3e-4f50-4a61-8b72-9c8dae0f1a2b/g'` for that file only.

**B9 — Minor. Task 9 Step 2 has a formatter-wrapped fragment (fragment 2).** Replace by text.

**B10 — Minor. Task 10's Step 1 instruction and Step 8 expectations disagree with what earlier tasks write on purpose.**

- **The contradiction:** Step 1 says to rewrite "any further line"; Step 8 keeps history notes.
- **Lines Step 8's main list omits, but which will appear:**
  - `lib/ids.ts` (Task 9: "where MySQL's text column matched nothing");
  - `lib/directory/entry.ts` (Task 10's own new comment quotes "Don't use varchar(n) by default");
  - `__tests__/compose-files.test.ts` (Task 3 test title);
  - `e2e/fixtures/users.ts` and `e2e/fixtures/access.ts` (Task 3 ILIKE notes).
- **Lines the `collation` list omits:** `db/schema/groups.ts`, `__tests__/db-baseline.test.ts`, `__tests__/db/schema.db.test.ts`, `e2e/fixtures/users.ts`.
- **Step 1's own list** misses `__tests__/directory-sync.test.ts:291` (the "its column's 255 characters" title). Step 7 rewrites it anyway.
- **Ruling:** a line that names MySQL, mysql2 or `varchar(n)` as history or as a cited reason stays. Rewrite only lines that describe MySQL behaviour as the current engine. Never edit files outside Task 10's `git add` list; `e2e/**` belongs to Task 3.
- **If left alone:** stray edits to other tasks' files are left uncommitted, or correct history notes get rewritten.

**B11 — Minor. Two of Task 11's assertions are weaker than they claim.**

- **(c):** the final `expect(row(page, email)).toHaveCount(1)` uses a case-sensitive `RegExp`, so it cannot see an upper-case duplicate row. Use `page.getByRole('row', { name: new RegExp(email, 'i') })` with `toHaveCount(1)`.
- **(d):** the chat-page case asserts `status() < 500`, while spec §6 says "HTTP 200, like any unknown app". Use `toBe(200)`.

**B12 — Minor (nit). Task 12 Step 2's RED claim for `settings-branding` overcounts.** Only the cases at lines 95, 110 and 598 fail; the `brandingView` case (lines 239–240) passes before the code change. No action needed.

**B13 — Minor (nit). Task 13's grep expectations are slightly off.**

- **Step 9's expected-remaining list:** ADR-0031's CLAUDE.md line contains no "mysql". `docs/decisions/README.md:8` (the filename example) and `:34` (ADR-0010's title) also remain, and must not be renamed.
- **Step 1:** "the PostgreSQL move" does not match the pattern.

**B14 — Minor. Task 13 Step 11 and Task 14 disagree about the cii file.**

- **The problem:** Task 13 says "Task 14's full run may replace" the dated e2e sentence in cii #19. Task 14 says "Files: none changed".
- **Ruling:** Task 14 changes nothing. A refreshed cii e2e line, if the owner wants one, is its own docs commit after Task 14, on their word.

**B15 — Minor. The commit commands omit the required trailers.** The commands in Tasks 8–13 (and earlier briefs) leave out the trailers the Global Constraints require: `Co-Authored-By` and `Claude-Session`, in the same `-m` argument as the message. The implementer appends them as the Global Constraints say.

**B16 — Minor. Task 14 Steps 7 and 12 need the owner at the machine.**

- **Why:** Step 7 needs the owner's `.env` and `.env.development.local` edits. Step 12 needs a browser on `localhost:5300/init`. Spec §8 says the owner works remotely for now.
- **Ruling:** run Steps 1–6 whenever; schedule Steps 7–14 for when the owner can act on the machine. Step 13 does not depend on Step 12.

**B17 — Minor (nit). Task 8's live test has a dead mock.** It mocks `@/lib/auth/options`, but `lib/data/directory.ts` never imports it, directly or through `./db-errors` or `./email`. Drop the mock, or keep it only if the other live files share it as a pattern.

**B18 — Minor (nit). Dates.** ADR-0031's notes on ADR-0004, ADR-0019 and ADR-0030, and the cii change-log row, are dated 2026-10-11. The work lands on 2026-10-12 or later, and two owner decisions are from 2026-10-12 (bake has no default; folder rename deferred). Date the notes and the change-log row by commit; the ADR's own date is the owner's call.

**B19 — Minor (nit). Two inaccuracies in ADR-0031's wording.**

- The "driver and connection" bullet shows `new Pool({ connectionString })` without `connectionTimeoutMillis: 10_000`, which `db/index.ts` has (it is mentioned later under behaviour changes).
- "Affected paths" lists `app/(admin)/{app,user,group}-management/{actions,schemas}.ts`, but the user and group `actions.ts` do not change (Task 9).
