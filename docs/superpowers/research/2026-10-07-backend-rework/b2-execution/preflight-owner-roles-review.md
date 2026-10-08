# B2 plan: pre-flight review of the three-role revision (2026-10-08)

Plan: `docs/superpowers/plans/2026-10-08-backend-b2-accounts.md` (4,386 lines). Line numbers are the plan's unless a file is named. Nothing tracked was changed.

## How it was checked

- **Reading.** The whole plan, the charter's role sections, the current tree (`lib/auth/session.ts`, `db/schema/users.ts`, `lib/data/users.ts`, `lib/action-result.ts`, the users components, `e2e/admin-users.spec.ts`, `e2e/auth.setup.ts`, the fixtures and the e2e compose file), and the documenso files in `tmp/roles-ref/`.
- **Dry run of the final state.**
  - Setup: a `git archive` copy of HEAD in `tmp/owner-review/tree`, with the earlier dry-run patch (`tmp/b2probe/dryrun-tasks1-8.patch`) as scaffolding. The de-scoped forgot/reset parts were reverted. Every role-related file was overwritten with this plan's code blocks, and the prose edits were applied. The migration was generated with `drizzle-kit generate`.
  - Gates:
    - `next typegen` and `tsc` show 0 errors. The only other error is `packages/docs/rspress.config.ts`, which comes from the copy having no `packages/docs/node_modules`.
    - vitest: 94 files, 1160 tests, all passing.
    - oxlint: 0 findings on the 35 role-related files.
    - `antd lint components/admin/users`: no issues.
  - Afterwards: the copy was deleted, since root `tsc` would pick it up. Its diff is `tmp/owner-review/dryrun-final.patch` and its logs are in `tmp/owner-review/`. The commits were not replayed one task at a time, because the earlier pre-flight did that. The intermediate states the role change touches were checked by reading.
- **Mutation checks** on the users DAL in the copy:
  - taking the target role from the input;
  - taking the target role from the input for other accounts only;
  - dropping `.for('update')`.
- **A type probe** of `MANAGEABLE_ROLES`: `tmp/owner-review/probe/asconst.mts`.
- **Not run:** no `pnpm dev`, no Playwright and no Docker. The MySQL statements were checked by reading only.

Counts: **1 blocking, 1 significant, 7 minor.**

## 1. Security of the rank (the answers)

| Question | Answer |
| --- | --- |
| Can an admin, by a direct action call, edit, set the password of, or delete an admin's or the owner's row? | No. `updateUser` and `deleteUser` read the target with `lockTarget` inside the transaction and rank against that row (`updateRefusal` and `deleteRefusal`, lines 2114–2139 and 2205–2248). The DAL is correct. **However, no test pins that the row's role is used rather than the input's: see S1.** |
| Can an admin create or promote to admin or owner? | No. `createRefusal` is `canManage(actorRole, role)`, and `updateRefusal` also checks `canManage(actor.role, input.role)`. The owner role is in no list (lines 349–353), so `owner` can never be given, even by the owner. |
| Can an admin change its own role? | No. The self branch (line 2123) refuses a role that differs from the locked row's, and refuses any password. The comparison uses the database's `target.id`, so a case-variant id (MySQL's `_ci` collation) still lands in the self branch. |
| Can anyone create a second owner? | **Actions:** no (see above). **Migration:** no, `UPDATE … LIMIT 1` sets exactly one row. **`/init` race:** no under MySQL's default REPEATABLE READ, because the gap locks deadlock and one transaction is rolled back. Under READ COMMITTED, gap locking is off for searches and two owners with different emails are possible; see M1. |
| Is the target's current role read from the database? | Yes, on every path that has a target (`updateUser`, `deleteUser`). `createUser` has no target. `changeOwnPassword` reads only the caller's own row. The annotation routes read `annotationEnabled` from the database (`readAccess`). |
| Is the actor's role trustworthy? | Yes. Every `getServerSession` runs the `jwt` callback, which re-reads `role` from the row (decision a), so the actor's role is the row's role at the start of the request. A residual window remains between that read and the write, which is a few milliseconds plus about 0.25 s of bcrypt on writes that set a password. In that window, an admin the owner has just demoted can finish one create, update or delete of a `user` account. It cannot touch an admin, the owner or its own role, because its own row is checked against the locked row. Decision d (line 48) acknowledges this; it does not matter in practice. Optional hardening: inside the users transactions, read the actor's row `FOR SHARE` and rank against that role. This review does not ask for it. |
| Does `/init` refuse on any non-empty table? | Yes. `hasAccounts` and `lockAnyAccount` both test for _any_ row (lines 3250–3261), the action passes `forbidden` through, and the page and the login layout redirect on the same check. |

## 2. Findings

### Blocking

**B1. The tsc gate fails on today's tree because of the fetched documenso files.**

- **Lines:**
  - 28 (cites `tmp/roles-ref/`);
  - 359 and 1588 (`tmp/owner-probe/`);
  - every "`pnpm exec next typegen && pnpm exec tsc --noEmit` … Expected: PASS" gate: 104, 441, 955, 1389, 2362, 2883, 3515 and 4134.
- **Evidence:**
  - The root `tsconfig.json` includes `**/*.ts` and excludes only `node_modules`.
  - `tsc --listFilesOnly` lists `tmp/roles-ref/constants-teams.ts`, `tmp/roles-ref/utils-teams.ts` and `tmp/owner-probe/roles-probe.ts`.
  - `tsc --noEmit` on HEAD now reports 10 errors, all in `tmp/roles-ref/*.ts`, for example `TS2307: Cannot find module '@prisma/client'`. The log is `tmp/owner-review/tsc-base-current-tree.log`.
  - Every implementer's first gate is therefore red. The likely reactions are to stop, or to delete the reference files the plan cites.
  - vitest and the Docker build are unaffected: there are no test files there, and `.dockerignore` excludes `tmp`.
- **Fix:**
  - Rename the two files to `.ts.txt`, as `tmp/b2probe/web/saas-actions.ts.txt` already is.
  - Rename `tmp/owner-probe/roles-probe.ts` to `.mts`, or delete it. It compiles cleanly today, but it sits in tsc's scope.
  - Adjust the pointer at line 28.
  - Add one Execution note: a scratch file under `tmp/` never ends in `.ts` or `.tsx`, because the root tsconfig includes it. A copy of the tree under `tmp/` must also be deleted after use; this review deleted its own.

### Significant

**S1. No test pins that the rank is checked against the locked row's role rather than the input's role.**

- **Lines:**
  - 1514–1527 (the `updateRefusal` matrix);
  - 1852–1861 (the rank test sends `fields(row.role)`);
  - 137 (Review Focus 2: "the full rank matrix … against an admin's and the owner's row").
- **Evidence:**
  - In every refused action-level case, the input role equals the row's role, or the input role alone is refused.
  - Mutation test in the dry run: `updateRefusal({ actor, target: target.id === actor.id ? target : { id: target.id, role: input.role }, input })` passes all 52 tests of `user-management-rank`, `data-users`, `data-users-writes` and `user-management-actions`.
  - With that DAL, an admin could call `updateUserAction(ownerId, { …, role: 'user', password: 'x' })`, demote the owner, set its password and take the account over.
  - The plan's own DAL is correct. It is the safety net for Review Focus 2's central claim that is missing.
  - The pure matrix has `[admin, otherAdmin, 'user', 'forbidden']`, which pins the rule, but not the DAL's use of the row.
- **Fix:** add to `__tests__/user-management-rank.test.ts`, inside the admin describe. Checked: green on the plan's DAL, red (2 failures) on the mutant.

  ```ts
  // The row decides, not the input: the input names a role the admin manages, the locked row does not.
  it.each([
  	['another admin', { id: 'a2', role: 'admin' }],
  	['the owner', { id: 'o1', role: 'owner' }],
  ])('cannot demote %s or set its password by sending the user role', async (_name, row) => {
  	target.value = row
  	expect(await updateUserAction(row.id, fields('user'))).toEqual(forbidden)
  	expect(await updateUserAction(row.id, { ...fields('user'), password: 'password-1' })).toEqual(
  		forbidden,
  	)
  	expect(anyWrite()).toBe(false)
  })
  ```

  Also add `[admin, owner, 'user', 'forbidden']` and `[admin, owner, 'admin', 'forbidden']` to the pure matrix at line 1514, and name the "row decides" case in Review Focus 2 (line 137).

### Minor

**M1. The guarantee that `/init` creates at most one owner rests on REPEATABLE READ.**

- **Lines:** 49, 3255–3289 and 4180.
- **Evidence:**
  - Two first runs on an empty table each take a gap lock (`SELECT … LIMIT 1 FOR UPDATE`), and their inserts deadlock. That holds under REPEATABLE READ, the MySQL 8.4 default, which `docker-compose*.yml` does not override.
  - Under READ COMMITTED, InnoDB disables gap locking for searches (MySQL manual, "Transaction Isolation Levels"). Both inserts then succeed, and with different emails two owners result.
  - This is fine today, but the plan and ADR-0024 state the guarantee unconditionally.
- **Fix:** either pass the isolation level explicitly, `getDb().transaction(async tx => …, { isolationLevel: 'repeatable read' })` (Drizzle `MySqlTransactionConfig.isolationLevel`, `node_modules/drizzle-orm/mysql-core/session.d.ts:56`), or state the REPEATABLE READ assumption in `setup.ts`'s comment and in ADR-0024.

**M2. The backfill is never executed against several rows.**

- **Lines:** 417 (the heading "…and to a database that has rows"), 425 and 4335.
- **Evidence:**
  - Step 6 migrates a freshly started tmpfs e2e database, which is empty.
  - Task 9 Step 4's copy has one account, so `ORDER BY created_at, id LIMIT 1` and the "every other account is admin" rule are never run on more than one row. `oldest_is_owner` is trivially 1 there.
- **Fix:** before Step 5:
  1. start the e2e database and run `drizzle-kit migrate` (the B1 state);
  2. insert three accounts with explicit `created_at` values, two of them equal, to exercise the `id` tie-break.

  Then generate and hand-edit as written. In Step 6, migrate and run `SELECT email, role FROM users ORDER BY created_at, id`; the expected answer is the first row `owner` and the rest `admin`. Then `down` as Step 7 already does.

**M3. The owner password recovery recipe is described but never written out or tried.**

- **Lines:** 4233 (and 22).
- **Evidence:**
  - The text gives `UPDATE users SET password = ?, …`, with `?` standing for a bcrypt hash.
  - A bcrypt hash is `$2b$12$…`. Pasted into a double-quoted `mysql -e "…"`, as the plan's other MySQL commands are written, the shell expands `$2`, `$12` and so on, and the stored hash is garbage. That locks the owner out with no way back except the database.
- **Fix:** put the exact commands in the plan, so the hash never passes through shell expansion. For example:
  - `read -rs PW; export PW; HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.env.PW, 12))"); unset PW`
  - `docker compose -f docker-compose.local.yml exec -T -e HASH="$HASH" mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "UPDATE users SET password = '\''$HASH'\'', session_version = session_version + 1 WHERE role = '\''owner'\''"'`

  A parameter expansion is not expanded again. Then dry-run the recipe in Task 9 Step 4 on `b2copy`: `SELECT LENGTH(password) = 60 AND password LIKE '$2%'` for the owner.

**M4. Deviation 7 says "Only the owner … edits … an admin", but decision c and the code let an admin edit its own name and email.**

- **Lines:** 26, compared with 44, 2123 and 2689. ADR-0024 copies the deviations (line 4176).
- **Fix:** "Only the owner creates, edits, promotes, demotes, deletes or sets the password of an admin; an admin edits its own name and email (decision c)."

**M5. Task 3 Step 2 says "FAIL on every new case", but two new cases pass before the change.**

- **Lines:** 1161; the cases are at 1037–1044 and 1131–1139.
- **Evidence:**
  - "lets the owner through as well" passes before the change, because `requireActor` admits any role.
  - "lets an admin create an annotation whatever the app setting" passes too, because there is no gate yet.
  - A fresh implementer told every case fails will see green and may "fix" the test.
- **Fix:** name these two as regression pins that pass before and after.

**M6. Seeded accounts are inserted with fixed emails and no clean-up beforehand.**

- **Lines:** 1304–1306, 1361–1363, 2812, 2843–2844 and 4089.
- **Evidence:**
  - `afterEach` covers a failing test, but not a killed run.
  - Per-task runs reuse the e2e database (line 3523: "once more without `down`").
  - After a killed run, the next `INSERT` hits `users_email_key`, so every role and rank spec fails in `beforeEach` until someone runs `down`.
- **Fix:** have `seedUser` delete `WHERE email = ?` (and its reset tokens) before inserting. Alternatively, call `deleteUsersLike(…)` at the start of each `beforeEach` or test.

**M7. Agent uncertainty 2: the first-run page still says "admin".**

- **Lines:** 3509 and 4261.
- **Evidence:** the `init.*` strings ("Create an admin account", "Admin name", "Create admin and finish setup", "Admin account created") label the account the users table calls "Owner". Keeping the wording also keeps `auth.setup.ts`'s locators stable.
- **Fix:** keep the wording, but add the follow-up to Task 8 Step 4 item 7, next to the `auth.reset_title` line: "`init.*` says admin for the account that becomes the owner".

## 3. Code correctness (no further findings)

- **tsc and vitest, final state:** green (see "How it was checked").
- **Red first:** every new vitest file fails first for the stated reason (a missing module or export, a missing column or migration, a status-based mapper), except the two cases in M5.
- **Drizzle:**
  - `drizzle-kit generate` produced exactly ``ALTER TABLE `users` ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL;``.
  - `lockTarget(drizzle.mock(), 'u9').toSQL()` matches `/^select .* from `users`where`users`\.`id` = \? limit \? for update$/` with the parameters `['u9', 1]`.
  - `lockAnyAccount` renders ``select `id` from `users` limit ? for update`` with `[1]`.
  - `Pick<Tx, 'select'>` accepts both `Db` and `drizzle.mock()` without a cast; tsc passes.
- **Migrator and migration SQL:**
  - `node_modules/drizzle-orm/migrator.js:20` splits the file on `--> statement-breakpoint`.
  - `mysql-core/dialect.js` runs each piece with `tx.execute(sql.raw(stmt))` inside one transaction; the DDL auto-commits, as line 415 says.
  - The `users-schema` test's three `indexOf` strings match the hand-edited file.
  - A single-table `UPDATE … ORDER BY … LIMIT` is valid MySQL 8.4. `ORDER BY created_at, id` ends on the primary key, so it is deterministic and safe for statement-based binlogs.
- **Interfaces:** Tasks 1–7 agree on names, signatures and importers: `hasAdminRights`, `MANAGEABLE_ROLES`, `canManage`, `createRefusal({ actorRole, role })`, `updateRefusal({ actor, target, input })`, `deleteRefusal`, `lockTarget`, `hasAccounts`, `lockAnyAccount`, `createOwner`, `createOwnerAction` and `currentUser: { id, role }`. The only nit is that Task 5 lists `deleteUsersLike` under Consumes but does not use it.
- **Locking and the rank fake:** dropping `.for('update')` from `lockTarget` fails 10 tests (the rank fake only answers the target through `.for()`), so the lock is pinned. The missing check is the row-versus-input role (S1).

## 4. Existing tests and specs broken by the change and not updated

None.

- The only stray `last_admin` reader is `lib/action-result.ts:7`, which Task 4 removes.
- `hasUsers`, `/api/init` and `currentUserId` in `__tests__/{init-page,access,proxy,auth-failure,user-management-page}.test.ts` are each rewritten by Task 4, 5 or 6.
- `e2e/auth.setup.ts` and the `admin-users` search test are rewritten by Tasks 6 and 5.
- `screenshots.spec.ts:50`, `ssr-first-paint.spec.ts:236–239`, the `admin-apps` pagination loop and `page-headers.spec.ts` still hold with a role column; nothing compares screenshots.

## 5. The e2e cases (no further findings beyond M6)

- **Picking a role.** Clicking `getByText('Admin' | 'User', { exact: true })` inside the drawer reaches one element, the label span: Playwright's text engine skips a parent whose match comes from a child. The click toggles the radio through the `<label>`.
  - `getByRole('radio', { name })` resolves the 0×0 input, because a zero size with `opacity: 0` is not hidden for ARIA (antd style at `es/radio/style/index.js:389–393`).
  - `toBeChecked()` and `toBeDisabled()` need no visibility.
  - Nothing else in the drawer has the exact text "User" or "Admin". The title is "Edit user", and the column header "User" sits in the `thead` row, outside the dialog and outside `row()`.
- **A disabled Radio.Group** keeps its value in the form store, so the own-row update and the admin's "User only" add both submit `role`. `antd info Radio` confirms `optionType` and `options`.
- **The row locator's substring match.** No seeded email contains `admin@e2e.local`. `roleadmin-<project>@…` contains `admin-desktop…`, not `admin@e2e`. Workers are 1 and `fullyParallel` is false, so the owner's row stays on page 1 of the table (10 per page).
- **Cleanup.** The `user-<project>%` `afterEach` covers the second admin, the rank admin and peer, and the created user. `role-` and `roleadmin-` do not overlap.
- **The first-run annotation.** "owner created through /init" and "database already set up" read the same in Task 6 Steps 7–8 and Task 9 Step 3.

## 6. Consistency (no further findings beyond M4 and M7)

- **Numbering.** Deviations 1–7 and decisions a–k are each cited correctly; Tasks 4 and 5 cite "b, c, d" and "b, c, i".
- **Review Focus owners** match the tasks: Focus 1 → Tasks 2, 3 and 4 plus `roles.spec`; Focus 2 → Tasks 4 and 5; Focus 4 → Tasks 2 and 5; Focus 5 → Tasks 6 and 7.
- **The file structure** at lines 153–173 matches the tasks' Files lists.
- **Task 8:** ADR-0024's options and outcome, the 0006, 0018, 0020 and 0023 notes, `auth-gate.md` (including the ownership-transfer and owner-password limits) and the CLAUDE.md items are consistent with deviation 7 and decisions b and c.
- **Task 9:** the migration copy (one owner, no admin on the one-account database) and the Docker gate (`/init` → 307 to `/login`, one `owner` on the real volume) agree with line 29.
- **Old names.** The remaining mentions of `last_admin` (30, 161, 1409, 1436, 2261, 4174, 4179), `lockAdmins` (1588, a historical probe note) and `currentUserId` (2368, Task 4's interim page; 2399, 2660 and 2730, where Task 5 replaces it) are intentional. Nothing says two roles, `hasAdmin` or `createFirstAdmin`.

## 7. The agent's four uncertainties

1. **`MANAGEABLE_ROLES` as `Readonly<Record<Role, readonly Role[]>>`: correct, keep it.** The probe shows that `as const satisfies …` and plain `satisfies Record<Role, Role[]>` both break `canManage`: `.includes(target)` on the union of the tuples takes `never` (TS2345). The annotation still rejects a typo such as `'admn'` (TS2820). `roles.test.ts` pins the exact contents.
2. **The `/init` text says "admin": acceptable for B2.** The owner has admin rights, and the e2e setup's locators depend on the wording. Record it as a follow-up (M7).
3. **The rank test's fake is shaped to Task 4's queries: acceptable.** It pins the locking read (dropping `.for('update')` fails 10 tests), and line 1903's "adapt the fake, never the rules" is the right instruction. Its gap is not its shape but its inputs: S1.
4. **The `oldest_is_owner` query: valid MySQL 8.4, and it answers the question.** It is an uncorrelated scalar subquery beside `COUNT(*)` with no `GROUP BY`, which `ONLY_FULL_GROUP_BY` accepts because it references no outer column. The enum is compared as a string and gives 1 or 0, or NULL on an empty table. `owners` counts the owners. On a one-account copy it is trivially 1, so the multi-row case needs M2.
