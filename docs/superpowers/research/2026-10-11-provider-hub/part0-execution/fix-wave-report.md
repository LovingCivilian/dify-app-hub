# Part 0 — the final review's fix wave (2026-10-12)

## The fix list (F1–F19)

Sources: final-review-A.md, final-review-B.md, final-review-C.md (same folder); the ledger progress.md. Read the cited review section for each item's detail. Line numbers are approximate; find by text.

### Code and config

F1. `db/migrate.ts` (~line 15): give its `Pool` `connectionTimeoutMillis: 10_000`, with the same kind of source comment `db/index.ts` carries (node-postgres "Pool" default 0 = no timeout; spec §1; plan decision f). [A deferred 1] F2. `lib/data/directory.ts` (~238): the comment says the sign-in retries on 23505 for `users_directory_id_key` or `users_email_key`; the code retries on any 23505 (`isUniqueViolation(error)`), which correctly includes a racing sign-in's `user_group_members_pkey`. Reword to match (the comment at ~102-106 already says it right). [A deferred 2] F3. `docker-bake.hcl` (lines 1–2): add the Docker source for the `validation` block: https://docs.docker.com/build/bake/variables/#validating-variables (ADR-0002). [A deferred 3] F4. Production template: every compose command on `docker-compose.yml` needs `DOCKERHUB_USERNAME` (`${DOCKERHUB_USERNAME:?…}`), but its header's `.env` key list and `.env.template` do not mention it. Add it to the header's key list, and add `DOCKERHUB_USERNAME=` to `.env.template` under a comment saying only the production template (`docker-compose.yml`) and `docker-bake.hcl` read it. [A-M3, C-M5] F5. `.env.template`: `POSTGRES_PASSWORD=change-me` passes the `${POSTGRES_PASSWORD:?}` guard, so a copied template starts with a guessable password. Leave it empty (`POSTGRES_PASSWORD=`) with a comment that it is required and must not be empty (docker-library postgres: "must not be empty"), so the guard forces a choice; keep the `DATABASE_URL` example consistent (a placeholder, not a password). First check nothing (tests, docs) asserts `change-me`. [A-M2] F6. Remove the plan's path-label first lines: `lib/data/db-errors.ts:1` (`// lib/data/db-errors.ts`) and `__tests__/data-db-errors.test.ts:1`. (Keep `__tests__/db/*` labels only if every file in that folder has one; otherwise remove them too for consistency.) [T5 minor]

### Tests

F7. The `users_source_credentials` CHECK body is pinned by no test (spec §6 "the CHECKs"): in `__tests__/db-baseline.test.ts` add one exact `toContain` of the CHECK as the baseline `migration.sql` writes it (~line 126); in `__tests__/db/schema.db.test.ts` add a live case: an `ldap` row with a password (and a `local` row without one, if the CHECK refuses that) is refused with `23514` and `constraint: 'users_source_credentials'`. [B-I1, A deferred 5] F8. `__tests__/compose-files.test.ts`: pin the local file's `'127.0.0.1:5432:5432'`, the healthcheck timings (`interval: 10s`, `timeout: 10s`, `retries: 5`, `start_period: 30s`) on every `postgres` service, that the production template publishes no PostgreSQL port, and `${POSTGRES_PASSWORD:?` in the local and production files; drop "Task 3" from the lasting comment at ~line 7. [B-M1, A deferred 4] F9. `__tests__/app-management-actions.test.ts` (~91): the malformed-id case cannot fail because the DAL mock already answers null — assert the DAL function is never called; add malformed-id cases for the delete and sync actions with the same assertion. [B-M2] F10. `__tests__/db-pool.test.ts` (~39): assert the logged `{ name, code }` (e.g. `code: '57P01'`), not only the context string. [B-M3] F11. `__tests__/data-directory-sync.test.ts`: the fake's doc comment says `rowCount` "is the rows the statement matched" → "matched or inserted"; re-wrap the ~170-char comment line above `describe('a deadlocked sync statement makes up to three attempts'`. `__tests__/db/directory.db.test.ts` (~72-73): "waits for the first on the slot's index" → "may wait …" (the test proves one claim wins, not that the second waited). [T8, T10 minors]

### Records

F12. `CLAUDE.md` "Next step" (Part 0 status): add one sentence: before the Docker gate the owner edits `.env` and `.env.development.local` (spec §5; ADR-0031 "Migration steps"), and the old stack goes down by `docker compose -p dify-app-hub-local down` after `--dry-run`; until then the "Docker stack" commands fail on `${POSTGRES_DB:?}`. [C-I1] F13. Dated notes on accepted ADRs whose MySQL statements are now stale or false — append "Note, 2026-10-12 (ADR-0031): …" (one or two sentences: what changed, pointer to ADR-0031); never rewrite the original text: ADR-0010 (~23, 32–33: mysql:8.4, 3307, mysql2/promise), ADR-0024 (decisions d and h, ~137), ADR-0027 (~87: "Cafe"/"Café" one group name — now accent-sensitive), ADR-0029 (decisions ac, e, ae; ~94, 122), ADR-0030 (deviation 4; ~67, 125). See final-review-C.md I2 for each statement. [C-I2] F14. `CLAUDE.md` (~114): "the 1452 on a group deleted mid-sign-in" → "the 23503 …". [C-M1] F15. ADR-0031: "DV 7", "DV 8", "DV 11" (~90, 91, 108, 111, 113, 114, 119) cite doc-verification.md's numbered changes, not its table rows — write "DV change 7" etc. (or the right row id). Do not edit the spec. [C-M2] F16. ADR-0031 "Patterns to follow" and `CLAUDE.md`'s Database pointer name `timestamptz()` in `db/schema/columns.ts`. [C-M3] F17. `docs/auth-gate.md`: (~53) a hand owner transfer must demote the current owner first — `users_one_owner` refuses a second owner row; (~44) psql "interpolates only what it reads on standard input" → it interpolates variables in input read from standard input or a file, never in a `-c` command; where it gives `docker compose -f docker-compose.yml …` commands, note that `DOCKERHUB_USERNAME` must be set. [C-M4, C-M5, T13] F18. `CLAUDE.md` (~101): `pnpm test:db` "stops `postgres` afterwards" → stops and removes the e2e `postgres` container afterwards; do not run it alongside `pnpm test:e2e`. [T4, T13] F19. ADR-0031 "Errors and logs": one clause that the Dify routes' 500 path also logs a failed query by name and code (`lib/dify/errors.ts`, commit a66fdc48); in "Affected paths" (or a note) one phrase for `tsconfig.json`: excludes the git-ignored `tmp/` from type checking (TypeScript `exclude`). [C exec decisions]

## The fix report

## Final fix wave: report (F1–F19)

Branch `feat/postgres-and-rename`. The wave started at 2464e86f and ended at 9202d6e6. All 19 items are done, and no item turned out to be a reviewer misreading.

### Commits

| SHA | Subject | Items |
| --- | --- | --- |
| a6d6cf6d | fix(db): bound the migration's connection wait and match the sign-in retry comment to the code | F1, F2 |
| 4a300df2 | chore: name DOCKERHUB_USERNAME for the production template, leave the template password empty and cite Bake's validation docs | F3–F6 |
| 32ad595e | test: pin the users CHECK, the compose bindings and the app actions' id guard | F7–F11 |
| 9202d6e6 | docs: point the accepted ADRs to ADR-0031 and finish the Part 0 records | F12–F19 |

Every commit carries the `Co-Authored-By: Claude Opus 5.5` and `Claude-Session` trailers, and was staged with `git add <paths>` (one exception, noted below). The untracked `docs/superpowers/handoffs/2026-10-10-repo-housekeeping-kickoff.md` was left alone. Diff 2464e86f..HEAD: 25 files, +145 / −45.

**The staging exception.** `__tests__/db/schema.db.test.ts` carries both F6 (the label line) and F7 (the live case). The chore commit therefore staged only the label removal: a blob of HEAD's file minus line 1, via `git hash-object -w` and `git update-index --cacheinfo`. The test commit then took the F7 case.

### Items

#### Code and config

- **F1 done.** `db/migrate.ts:18`: `new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 })`.
  - The comment at lines 14–17 quotes node-postgres "Pool" ("By default this is 0 which means no timeout") and cites spec §1. It says this keeps the bound the MySQL-era script had (mysql2's `connectTimeout`, 10,000 ms by default) and is the same bound as `db/index.ts`.
  - Checked: the MySQL-era script (79e72a05) used `drizzle(databaseUrl)`, so it had mysql2's default.
- **F2 done.** `lib/data/directory.ts:238-240`: the retry is now described as "once after any unique violation (23505)". The examples are `users_directory_id_key`, `users_email_key` and a racing sync's membership row (`user_group_members_pkey`, replaceDirectoryMemberships). This matches `isUniqueViolation(error)` at about line 255 and the comment at about lines 102–106.
- **F3 done.** `docker-bake.hcl:2-3` now cites Docker docs, Bake "Variables", "Validating variables": https://docs.docker.com/build/bake/variables/#validating-variables.
- **F4 done.**
  - `docker-compose.yml:2-7`: the header's `.env` key list now includes DOCKERHUB_USERNAME. It says that Compose reads that `.env` for interpolation on every command (`logs`, `exec`, `down`), and the start line is now `docker compose up -d`.
  - `.env.template:15-18`: `DOCKERHUB_USERNAME=`, with a comment.
  - The comment is more precise than the fix list's wording. Only the production template reads the variable from `.env`. `docker-bake.hcl` reads the same name from the environment (Bake "Variables"; the release workflow runs `docker buildx bake -f docker-bake.hcl` with the variable in `env`). Bake's documented `.env` loading applies to Compose files used as Bake input, not to HCL variables (Docker docs `content/manuals/build/bake/compose-file.md`). So the comment does not claim that Bake reads `.env`.
  - `docker compose -f docker-compose.yml --env-file tmp/final-fix/compose.env config --no-env-resolution --quiet` passes (exit 0).
- **F5 done.**
  - `.env.template:12` is now `POSTGRES_PASSWORD=`.
  - `.env.template:13` is now `DATABASE_URL=postgres://hub:<password>@postgres:5432/hub`.
  - The comment at lines 3–9 says the password is required and "must not be empty" (postgres image docs). It also says the `${POSTGRES_PASSWORD:?}` guard stops until one is chosen, and that the image reads it only on the first start.
  - Checked first: `change-me` appears only in `.env.template` and the plan (`docs/superpowers/plans/…part-0…md:3101-3102`, a record, not edited). No test or doc asserts it.
  - Probe: with an empty password, `docker compose -f docker-compose.yml --env-file tmp/final-fix/empty.env config --no-env-resolution --quiet` fails with "required variable POSTGRES_PASSWORD is missing a value: Set POSTGRES_PASSWORD in .env" (exit 1).
- **F6 done.** The `// <path>` first line is removed from six files: `lib/data/db-errors.ts`, `__tests__/data-db-errors.test.ts`, `__tests__/db/database.ts`, `__tests__/db/errors.db.test.ts`, `__tests__/db/global-setup.ts` and `__tests__/db/schema.db.test.ts`. Not every file in `__tests__/db/` had one (`directory`, `email` and `owner.db.test.ts` did not), so all of them went. `git grep` finds no other such first line.

#### Tests

- **F7 done.**
  - `__tests__/db-baseline.test.ts:65-71`, "ties the credentials to the account source through the users CHECK": an exact `toContain` of the baseline's `CONSTRAINT "users_source_credentials" CHECK ((…))` line.
  - `__tests__/db/schema.db.test.ts:77-97`, a live case. A directory account with key, attribute and no password is accepted. A directory account with a password is refused with `{ code: '23514', constraint: 'users_source_credentials' }`, and so is a local account with `password: null`.
  - RED for the unit pin: I temporarily edited the baseline `migration.sql` to drop `"password" IS NULL AND` from the ldap branch. The new baseline case failed (×). I restored the file and confirmed `git diff --quiet`.
  - GREEN: unit passed. `pnpm test:db` gave 5 files and 28 tests passed, up from 27; the extra test is the new case.
  - What would make the live case fail:
    - dropping `"password" IS NULL` from the ldap branch, because the second insert would succeed and `refusal` would answer `{ code: undefined }`;
    - dropping `"password" IS NOT NULL` from the local branch, which affects the third insert;
    - renaming the constraint;
    - making either branch stricter so that the valid directory row is refused, which would throw on the first insert.
- **F8 done.** In `__tests__/compose-files.test.ts`:
  - The comment at lines 5–9 no longer says "Task 3".
  - New helper `postgresService` (line 13) cuts the postgres service's block.
  - Line 43, on every file: "checks health every 10 s, with a 10 s timeout, five retries and a 30 s start period". It is an exact regex inside the postgres block.
  - Line 71, local and production files: `'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?'`.
  - Line 78, local file: the postgres `ports:` holds exactly `- '127.0.0.1:5432:5432'`, with comments allowed, and nothing after it.
  - Line 87, production file: no `ports:` in the postgres block, and no `:5432:` anywhere in the file.
  - RED: temporary edits each made the matching new case fail, 5 failed out of 38. The edits were: local `'5432:5432'`, local `${POSTGRES_PASSWORD:-hub}`, e2e `start_period: 60s`, and a `ports:` block added to the production postgres. All files were restored from copies in `tmp/final-fix/`.
- **F9 done.** In `__tests__/app-management-actions.test.ts`:
  - The malformed-id line was removed from "updates with a blank key…", where it could not fail.
  - A new `it.each` (lines 93-105) covers `updateAppAction`, `deleteAppAction` and `syncAppAction` with `'not-a-uuid'`. It asserts `not_found`, and that `updateApp`, `deleteApp`, `syncApp` and `refresh` were never called.
  - RED: with the three `isId` guards removed from `app/(admin)/app-management/actions.ts`, all three cases failed ("expected "vi.fn()" to not be called at all, but actually been called 1 times"; 3 failed / 15 passed). I restored with `git checkout --` and confirmed clean before and after.
  - GREEN: 18 of 18 pass.
- **F10 done.** `__tests__/db-pool.test.ts:39-40`: `expect(logged).toHaveBeenCalledWith('Database pool:', { name: 'error', code: '57P01' })`.
  - RED: I temporarily set the listener in `db/index.ts` to `console.error('Database pool:', error)`. The test failed ("expected "error" to be called with arguments: [ 'Database pool:', …(1) ]"); the old first-argument check would have passed. Restored from a copy and confirmed `git diff --quiet`.
- **F11 done.**
  - `__tests__/data-directory-sync.test.ts:32`: "matched or inserted".
  - Lines 560-562: the 214-character comment line is re-wrapped to under 120.
  - `__tests__/db/directory.db.test.ts:72`: "the second insert may wait for the first".

#### Records

- **F12 done.** `CLAUDE.md:69` (Part 0 parenthesis) now says the following:
  - before the Docker gate, the owner edits `.env` and `.env.development.local` (spec §5; ADR-0031 "Migration steps");
  - the old stack goes down by `docker compose -p dify-app-hub-local down` after a `--dry-run`;
  - until then, the "Docker stack" commands below fail on `${POSTGRES_DB:?}`.
- **F13 done.** New notes, all dated 2026-10-12 and linking ADR-0031:
  - `docs/decisions/0010-…md:68`: the e2e database is `postgres:18` on 127.0.0.1:5433 (tmpfs), the rows are written through `pg`, and `mysql2/promise` is gone.
  - `0024-…md:152`, three points:
    - decision d's owner guarantee is now `users_one_owner` at READ COMMITTED;
    - decision h ends;
    - email case goes through `lower(email)`, with accents now counting, and the error codes are PostgreSQL's.
  - `0027-…md:229` (as a heading, as that ADR writes its notes): "Cafe" and "Café" are now two names; 1062/1452 become 23505/23503; `access_mode` is a `pgEnum`.
  - `0029-…md:361` (heading style), covering:
    - the schema bullet's `varchar`/`mysqlEnum` are now `text`/`pgEnum`;
    - decision e: the retry codes, and no gap locks at READ COMMITTED;
    - decision ac: the `lower(email)` index;
    - decision ae: 65,535 parameters instead of `max_allowed_packet`;
    - `rowCount` instead of `affectedRows`/`FOUND_ROWS`;
    - `ON CONFLICT DO NOTHING`.
  - ADR-0030: I extended its existing 2026-10-12 note (`0030-…md:211`) with deviation 4. That note was written on this branch, in 6ce8245d, and seat C asked for it to be extended. The added sentences: there is no gap-lock deadlock on two first saves any more, the later save wins (the owner accepted this), and saves queue on the row lock once it exists, with the deadlock retry kept.
  - No accepted ADR's original text was edited.
- **F14 done.** `CLAUDE.md:114`: "the 23503 on a group deleted mid-sign-in".
- **F15 done.** ADR-0031 lines 90, 91, 108, 111, 113, 114, 119 and 248 now cite "DV change 7", "DV change 8" and "DV change 11". The fix list did not name line 248 (the REPEATABLE READ con), but it had the same citation, so I changed it too. Line 14 now defines both forms: rows as "DV 1a", numbered changes as "DV change 7".
  - Checked against `docs/superpowers/research/2026-10-11-provider-hub/doc-verification.md`: change 7 is the isolation levels and deadlock code, change 8 is `ON CONFLICT`, change 11 is the column types.
  - The spec is not edited.
- **F16 done.**
  - ADR-0031 "Patterns to follow" (line 162): time columns through `timestamptz()` (`db/schema/columns.ts`).
  - "Affected paths" (line 160): `db/schema/{columns,…}.ts`.
  - `CLAUDE.md:65` (Database pointer): `timestamptz()` in `db/schema/columns.ts` (every time column).
- **F17 done.** `docs/auth-gate.md`:
  - Line 44: psql "interpolates variables in the input it reads from standard input or from a file (`-f`), never in a `-c` command, which must be 'completely parsable by the server (i.e., it contains no psql-specific features)'".
  - Also line 44: the production server uses `-f docker-compose.yml` with `DOCKERHUB_USERNAME` set, in the `.env` beside it or in the shell, because Compose interpolates the image on every command, `exec` included.
  - Line 53: `users_one_owner` refuses a second owner row and is checked as each row is written (PostgreSQL 18 "CREATE TABLE", "Non-Deferred Uniqueness Constraints"). So a hand transfer demotes the current owner first, then promotes the other account: two `UPDATE`s in one transaction.
  - I did not add seat C's optional "bump both session_versions". The `jwt` callback re-reads the role from the row on every request (ADR-0024 decision a; `docs/auth-gate.md` "The role refresh…"), so a bump is not needed for the role change, and the fix list does not ask for it.
- **F18 done.** `CLAUDE.md:101`: "afterwards it stops and removes the e2e `postgres` container, whose tmpfs database goes with it". "Never beside `pnpm test:e2e`" was already there and is kept.
- **F19 done.** ADR-0031:
  - "Errors and logs" (line 123): `describeError` guards the Server Actions, the sign-in, the pool's listener and the Dify routes' 500 path (`errorResponseFrom` in `lib/dify/errors.ts`, which logged the raw error before; commit a66fdc48, verified with `git show --stat`).
  - "Affected paths" (line 160): `tsconfig.json` excludes the git-ignored `tmp/` scratch folder from type checking (TypeScript `exclude`), as `vitest.config.ts` excludes it from the tests.

### Gates (on the final content; tsc and unit re-run after the last commit)

- `pnpm exec next typegen && pnpm exec tsc --noEmit`: no output, exit 0.
- `pnpm exec oxlint <14 changed code files>`: exit 0, no findings.
- `pnpm exec oxfmt --check <changed code, md and yml files>`: one file needed formatting, `__tests__/db/schema.db.test.ts`, where a long `refusal(...)` call wrapped. I ran `oxfmt` on it, and the re-check passed: "All matched files use the correct format". lint-staged's oxlint/oxfmt ran clean on each commit.
- `pnpm test`: 146 files and 1819 tests passed, up from 1808. The 11 new tests:
  - 1 baseline;
  - 3 healthcheck timings (×3 files);
  - 2 password guards;
  - 1 local binding;
  - 1 no production port;
  - 3 malformed app ids.
- `pnpm test:db`: 5 files and 28 tests passed, up from 27. `ai-app-hub-e2e-postgres` was already running (left from an earlier run); no e2e run or `next dev` was active (checked with `pgrep`). The teardown stopped and removed it. "Network ai-app-hub-e2e_default Resource is still in use" is the known harmless message, because `ldap-ad` was up and stays up.
- Not run, as instructed: `pnpm test:e2e` and `pnpm test:ldap`.
- The owner's `dify-app-hub-local-*` containers were not touched. The only `docker compose` commands were `config --no-env-resolution --quiet` on the production file with throwaway env files under `tmp/final-fix/`. `.env` and `.env*.local` were never read.

### Concerns / notes for the controller

- The ldap-ad container (`ai-app-hub-e2e-ldap-ad`) is still running, as it was before this wave. `pnpm test:db` removed the e2e `postgres` container, so the next e2e run starts it fresh.
- Spots with the same wording problems as fixed items, left unchanged because they are not in the fix list:
  - the `docker-compose.e2e.yml:2` header says `pnpm test:db` "stops it afterwards" (the F18 point, in another file);
  - `lib/data/directory.ts:407` cites "DV 8" in the old style (F15 covered ADR-0031 only);
  - `__tests__/data-setup.test.ts:96` and `__tests__/db/schema.db.test.ts:70` keep "Task 7"/"Task 9" references (seat B's M5; F8 named only `compose-files.test.ts`).
- Scratch files are in the git-ignored `tmp/final-fix/`: compose env files and backups, none ending in `.ts`.

### Docs checked

- node-postgres "Pool", `connectionTimeoutMillis` (F1): cited in the fix list and already quoted in `db/index.ts` from Context7 `/websites/node-postgres` ("By default this is 0 which means no timeout"); reused verbatim.
- Docker Bake variable validation (F3): Context7 `/docker/docs`, `content/manuals/build/bake/variables.md` "Validating variables": "If the `condition` expression evaluates to `false`, the variable value is considered invalid, whereby the build invocation fails and `error_message` is displayed".
- Bake reading variables from the environment, not from `.env` (F4): Context7 `/docker/docs`, `bake-reference.md`: "Bake uses the environment variable value instead of the declared default if an environment variable with the matching name exists". The `.env` loading is documented in `compose-file.md` for Compose files used as Bake input.
- Compose `.env` interpolation (F4): Context7 `/docker/docs`, `content/manuals/compose/how-tos/environment-variables/variable-interpolation.md` (the `.env` in the project directory supplies values for `${VAR}` in the Compose file).
- postgres image, `POSTGRES_PASSWORD` (F5): Context7 `/docker-library/docs`, `postgres/content.md`: "This environment variable is required for you to use the PostgreSQL image. It must not be empty or undefined." It is read only on first start: "the Docker specific variables will only have an effect if you start the container with a data directory that is empty".
- psql `-c` (F17): Context7 `/websites/postgresql_18`, https://www.postgresql.org/docs/18/app-psql.html: "command must be either a command string that is completely parsable by the server (i.e., it contains no psql-specific features), or a single backslash command".
- Unique checks per row (F17): Context7 `/websites/postgresql_18`, https://www.postgresql.org/docs/18/sql-createtable.html, "Non-Deferred Uniqueness Constraints": "When a UNIQUE or PRIMARY KEY constraint is not deferrable, PostgreSQL checks for uniqueness immediately whenever a row is inserted or modified."
- 23514 `check_violation` (F7): PostgreSQL 18 Appendix A, already cited in `docs/auth-gate.md` ("SQLSTATE 23514, `check_violation`"). The live run confirms the driver reports `code` and `constraint` for it.
- Vitest `toHaveBeenCalledWith`, `it.each` and `toMatch` (F8–F10): the same APIs already used in the files edited; no new API.
