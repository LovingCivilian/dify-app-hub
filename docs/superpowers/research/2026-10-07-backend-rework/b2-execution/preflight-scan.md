# B2 pre-flight scan (read-only, 2026-10-08)

Scope: `docs/superpowers/plans/2026-10-08-backend-b2-accounts.md` (Tasks 1–10, header, Global Constraints, Review Focus) against the charter (§2, §4.2, §4.4–§4.6, §5 B2, §6), the kick-off handoff, B1's records and the tree at `98d2d25f`. Nothing tracked was changed. Probes ran under `tmp/b2probe/`. The main probe was a literal dry run of Tasks 1–8 in a `git archive` copy of the tree: the code blocks were extracted from the plan by script, the prose edits were applied as written, and the gates ran after each task. The copy was deleted afterwards, because the root `tsconfig.json` (`**/*.ts`) and vitest's default include would otherwise pick it up. Its diff is kept as `tmp/b2probe/dryrun-tasks1-8.patch`, and the per-task logs as `tmp/b2probe/{tsc,vitest}-t*.log`.

## Verdict

The design holds up, and the plan matches the tree closely. The dry run of Tasks 1–8 passes tsc and vitest from task to task once five small text fixes are applied:

- `next typegen` and `tsc --noEmit` show 0 errors.
- vitest ends at 92 files and 1126 tests.
- oxlint has no findings on the 84 changed files.
- `antd lint ./` reports "No issues found".

The checks behind that:

- **next-auth.** Every `getServerSession` runs the `jwt` callback, so the role and email refresh is real.
- **Drizzle.**
  - The generated migration is the exact statement the test expects.
  - `lockAdmins` produces `… where \`users\`.\`role\` = ? for update`.
  - `Pick<Tx,'select'>` accepts both `Db` and `drizzle.mock()` without a cast.
- **Logging.** `describeError` keeps the hash and the e-mail out of the action logs.
- **Locking.** It is correct, with one caveat: with no index on `role`, it locks the whole `users` table.

What has to change before execution:

- **Five blocking items.** The most important are:
  - a vitest hook that returns the mock, which vitest then calls as a teardown (Task 6);
  - antd 6 button-style radios, whose `<input>` is 0×0, so Playwright's `check()` can never act on them (Task 5 e2e).
- **One significant item.** A `git add -u` line aborts with `fatal: pathspec` and can leave a red commit (Task 5).

Each fix is one or two lines of plan text. The rest are minor wording, citation and record items.

Counts: **5 blocking, 1 significant, 16 minor.**

## Findings

### Blocking

1. **Task 6, Step 1: `__tests__/init-actions.test.ts` fails `pnpm test`.**
   - **Text:** `beforeEach(() => createFirstAdmin.mockReset())` (plan line 2474).
   - **Reality:**
     - `mockReset()` returns the mock function, and vitest runs a function returned from `beforeEach` as that test's cleanup. Vitest docs, `docs/api/hooks.md`: "Return a cleanup function from beforeEach … runs once after each test run".
     - After "answers operation_failed for an unexpected throw", vitest therefore calls `createFirstAdmin()`, which is mocked to reject, and the test fails.
     - Dry-run output: `FAIL … answers operation_failed for an unexpected throw, and logs it` / `Error: database down ❯ __tests__/init-actions.test.ts:36:38`.
     - The action itself is correct. The error points at a passing line, so an implementer may "fix" the wrong file.
   - **Fix:** `beforeEach(() => {\n\tcreateFirstAdmin.mockReset()\n})`. No other hook in the plan has this shape; `afterEach(() => vi.restoreAllMocks())` returns an object and is harmless.

2. **Task 5, Step 8 (e2e): `getByRole('radio', { name: 'Admin' | 'User' }).check()` cannot act on antd 6 button-style radios.** This affects the CRUD test, the own-row test and the second-admin test, on all three projects.
   - **Text:** plan lines 2358, 2379 and 2400. The drawer uses `Radio.Group optionType="button"`.
   - **Reality:**
     - antd 6.6.5 styles the radio input inside `.ant-radio-button-wrapper` as `width: 0; height: 0; opacity: 0; pointerEvents: 'none'` (`node_modules/antd/es/radio/style/index.js:389-393`, inside the `${componentCls}-button-wrapper` block opened at :265).
     - Playwright 1.63's `check()` is `_setChecked` → `this._click(...)`, with the standard actionability checks (`playwright-core/lib/coreBundle.js`). "Visible" means a non-empty bounding box (`computeBox`; https://playwright.dev/docs/actionability).
     - So the action waits until the test times out. `force: true` does not help: it clicks at the centre of a 0×0 box that has `pointer-events: none`.
     - No existing spec uses antd radios (`grep -rn radio e2e` finds nothing).
   - **Fix:** click the visible option text inside the drawer, then assert the state:

     ```ts
     await edit.getByText('Admin', { exact: true }).click()
     await expect(edit.getByRole('radio', { name: 'Admin' })).toBeChecked()
     ```

     Do the same for 'User'. `toBeChecked` needs no visibility.

3. **Task 3: `__tests__/data-apps-sync.test.ts:272-276` turns red, and the file is not in Task 3.**
   - **Reality:**
     - "syncApp reads only the access columns" asserts `['apiBase', 'apiKey', 'id', 'isEnabled']`.
     - Step 4 adds `enableAnnotation` to `readAccess`, which `syncApp` uses.
     - Dry-run output: `× syncApp reads only the access columns`.
   - **Fix:**
     - Add the file to Task 3's Test list and to its `git add`.
     - The expected list becomes `['apiBase', 'apiKey', 'enableAnnotation', 'id', 'isEnabled']`.

4. **Task 3, Step 1: `__tests__/app-errors.test.ts:8` contradicts the new mapping.**
   - **Text:** "`appErrorKey('forbidden', 'save')` is `'common.forbidden'`" is added.
   - **Reality:** the existing line `expect(appErrorKey('forbidden', 'sync')).toBe('common.session_expired')` stays and fails (dry run: `× maps the codes to translation keys …`).
   - **Fix:** say "replace line 8's expectation with `'common.forbidden'`".

5. **Task 7, Step 6: `e2e/auth.spec.ts` no longer type-checks.**
   - **Text:**
     - Task 5 Step 8: "`ADMIN_STATE` and `browser` leave the test if unused" (line 2353). oxlint's `eslint/no-unused-vars: error` forces the import out.
     - Task 7 then adds `test.use({ storageState: ADMIN_STATE })` (line 3400) without re-importing it.
   - **Reality:** dry-run tsc reports `e2e/auth.spec.ts(115,28): error TS2304: Cannot find name 'ADMIN_STATE'`.
   - **Fix:** Task 7 Step 6 adds "import `ADMIN_STATE` from `./fixtures/constants` (Task 5 removed it)".

### Significant

6. **Task 5, Step 10: `git add -u …` aborts the staging it was meant to do.**
   - **Text:** `git add -u app/api/users components/admin/users/user-row.ts __tests__/user-row.test.ts components/admin/apps/use-action-transition.ts` (line 2431).
   - **Reality:**
     - Probed in the copy, after Step 3's `git mv` and Step 6's `git rm`: `fatal: pathspec 'app/api/users' did not match any files`, exit 128. Nothing in that command is staged.
     - Step 5 says only "Delete `components/admin/users/user-row.ts` and `__tests__/user-row.test.ts`", with no command.
     - If that delete is a plain `rm`, the earlier `git add … components/admin/users` stages `user-row.ts`'s removal, but `__tests__/user-row.test.ts`'s removal is never staged.
     - The commit then contains a test that imports a deleted module: a red commit with a green working tree.
     - The same harmless `fatal` appears in Task 6 Step 9 (`git add -u app/api/init`, line 3000) and Task 7 Step 8 (line 3428).
   - **Fix:**
     - Step 5 uses `git rm components/admin/users/user-row.ts __tests__/user-row.test.ts`.
     - Drop the three `git add -u` lines (the `git rm`/`git mv` already staged the removals).
     - Add `git status --short` (expect nothing unstaged) before each commit.

### Minor

7. **Task 6, Step 7 (e2e setup): `await expect(page).toHaveURL(/\/login\?email=/)` (line 2972) has the 30 s expect timeout.**
   - It waits for a client `router.replace` that must compile `/login`. The old setup reached `/login` through `page.goto`, which is bounded only by the 180 s setup timeout.
   - Turbopack's dev filesystem cache is on by default (`05-config/01-next-config-js/turbopackFileSystemCache.md:40`), so this bites only on a truly cold `.next`.
   - **Fix:** `await page.waitForURL(/\/login\?email=/)`.

8. **Task 2, Step 6: "add `role: 'admin'`" to fixtures.**
   - In `__tests__/data-apps-sync.test.ts:43`, `const actor = { …, role: 'admin' }` widens to `string` and is passed to the typed `syncApp`/`createApp`, which gives TS2345 (probed).
   - **Fix:** `role: 'admin' as const`. It is the only fixture tsc flags. The others go to untyped `vi.fn()` mocks.

9. **Greps that "must print nothing" or have a fixed expected output do not hold as written.**
   - Task 5 Step 5, `git grep -n "user-row\|toUserRows\|UserRow"` (line 2323), hits:
     - Task 4's own `lib/data/users.ts` `type UserRow = typeof users.$inferSelect`;
     - `docs/decisions/0020-…md:36`;
     - older plans and specs.
   - Task 6 Step 5, `git grep -n "isUngatedPath"`, hits the B1 ledger and the preflight scan, plus a 2026-10-03 spec.
   - Task 6 Step 6's expected output misses the plan's own login-layout comment, which contains "/api/init/status".
   - Task 5 Step 6's expected output misses `e2e/admin-users.spec.ts:76` and `e2e/auth.spec.ts:83`, which Step 8 rewrites only later.
   - **Fix:** scope every grep to `-- app components lib hooks proxy.ts e2e __tests__` and state the real expected lines.

10. **The session's email follows the row only through object aliasing.**
    - `node_modules/next-auth/core/routes/session.js:53-66` builds `session.user.{name,email}` from `decodedToken`, not from the token the `jwt` callback returns.
    - The plan's callback mutates `token`, which is the same object, so it works. A refactor to `return { ...token, email }` would silently stop the refresh, and no test pins `session.user.email`.
    - next-auth's docs say token data must be forwarded explicitly in the `session` callback (`/configuration/callbacks`).
    - **Fix:** the `session` callback also sets `session.user.email = token.email ?? session.user.email` and `name`, with a test case. This covers Review Focus 4.

11. **Decision h's invariant holds in production only.**
    - `db/index.ts:89` sets `logger: env().nodeEnv === 'development'`, and Drizzle's `DefaultLogger` prints every query with its parameters (`drizzle-orm/mysql-core/session.js:59`).
    - So `pnpm dev` and the e2e `next dev` log bcrypt hashes, API keys and reset-token hashes.
    - **Fix:** state the scope in decision h and ADR-0024, or replace the dev logger with one that omits parameters.

12. **The `lockAdmins` comment and decision d understate the lock.**
    - There is no index on `role`, so the locking read scans the clustered index. MySQL 8.4 §17.7.3: "every row of the table becomes locked, which in turn blocks all inserts by other users to the table."
    - The behaviour is still correct:
      - user writes serialise for a few milliseconds;
      - sign-in and the `jwt` query are consistent reads and are not blocked;
      - on an empty table the two first-run transactions deadlock, as the plan says (§17.7.1: gap locks "can co-exist", and the insert-intention lock waits on them).
    - **Fix:** reword it as "locks the users table for the transaction (no index on role)" in the code comment and in ADR-0024.

13. **Orphan key: `common.network_error_retry` (`locales/en/translation.json:26`).**
    - Its only reader is the `catch` in `components/auth/init-form.tsx:44`, which Task 6 removes.
    - The Global Constraints require removing it from all three files.
    - **Fix:** add it to Task 6, with `locales` in Task 6's `git add`.

14. **Task 8, Step 3 cites antd "Form in Modal" for the `form`-attribute submit.**
    - The documented demo (`antd demo Form form-in-modal`) wraps the modal in the Form through `modalRender`, with `okButtonProps={{ htmlType: 'submit' }}`.
    - The plan's approach is the project rule (`.claude/rules/frontend.md`: "a button outside the `<form>` submits through the native `form` attribute").
    - **Fix:** cite the rule, not the demo.

15. **Task 1, Steps 7–8: "The migration's `snapshot.json` stays out of oxfmt".**
    - The pre-commit hook's lint-staged runs `oxfmt` on `*.json` (`.lintstagedrc.mjs`).
    - Drizzle snapshots are not oxfmt-clean (probed: B1's and the new one). The commit reformats it; the JSON content is unchanged and harmless.
    - **Fix:** say so, or add `db/migrations/**/snapshot.json` to `.oxfmtrc.json` `ignorePatterns` in Task 1 (the recorded B1 follow-up).

16. **Decision a has a user-visible consequence the plan does not record.**
    - When an admin edits a user's email, that user's Dify `user` changes on the next request. Their conversations stay under the old email and drop out of the chat list.
    - Today that happens only at the next sign-in.
    - **Fix:** record it in ADR-0024 and the ADR-0006 note.

17. **Review Focus 3 has no unit test for the database's duplicate-email refusal.**
    - `createUser`/`updateUser` catch `ER_DUP_ENTRY` and answer `email_in_use`, which is the race the unique index catches after the check.
    - Only `isDuplicateEntry` is tested, and the e2e duplicate hits the pre-check.
    - **Fix:** one `data-users` case with a fake `getDb` whose insert rejects with `new DrizzleQueryError(…, dup)`.

18. **Task 10: the e2e MySQL stays up through the Docker build.**
    - Step 4 starts the e2e MySQL and leaves it running through Step 5's `docker compose … build app` on the ~5 GB box.
    - **Fix:** end Step 4 with `docker compose -f docker-compose.e2e.yml down`.

19. **Reference-project citations (CLAUDE.md rule) are thin for b and d.**
    - **Decision a** can also cite create-t3-app's database-session template, where the session callback receives the DB user per request (survey §2).
    - **Decision b** fits `nextjs/saas-starter` `updatePassword` (`app/(login)/actions.ts:231-289` @ `6e33e58b`, fetched to `tmp/b2probe/web/saas-actions.ts.txt`):
      - it checks the current password, and also refuses new == current, which the plan does not;
      - saas-starter does not revoke other sessions, which the plan does.
    - **Decision d:** none of the surveyed projects has a last-admin rule. Say that the MySQL manual alone settles it.

20. **zod 4's `z.email()` is stricter than the inherited handlers.**
    - It rejects addresses without a TLD (probe: `a@localhost` → false). The inherited handlers accepted them.
    - An existing account with such an address can no longer be edited in the drawer (`invalid_input`) and cannot request a reset.
    - antd's `type: 'email'` rule already refused such addresses in the forms.
    - **Fix:** a sentence in ADR-0024. Optionally check the owner's DB in Task 10 Step 4 with a count query (no values printed).

21. **ADR-0020 still names removed code.**
    - Its line 36 names `toUserRows` (`components/admin/users/user-row.ts`) and `getApp(id)`; B2 removes both.
    - Task 9 adds notes to 0006, 0018 and 0023 only.
    - **Fix:** add a dated ADR-0020 note.

22. **Task 5, Step 1 relies on case-sensitive matching.**
    - `toContainText('User')` passes only through the role tag; "Spec user" is lowercase.
    - This is intended, but the step should say it relies on `toContainText` being case-sensitive by default.

## Pair rows

| Tasks | Shared thing | Produced vs consumed | Finding |
| --- | --- | --- | --- |
| 1 → 2, 3, 4, 5 | `lib/auth/roles.ts`: `ROLES`, `Role`, `isRole`, `isAdmin` | session (2), annotation routes (3), `z.enum(ROLES)` (4), drawer type (5) | Agrees (`z.enum` accepts the readonly tuple; tsc 0). |
| 1 → 2, 4, 6, 8 | `users.role` (enum, default `user`), `updatedAt.$onUpdate` | authorize/jwt selects; DAL writes; `$onUpdate` adds `updated_at = ?` to every update (probed) | Agrees. The migration SQL matches the test byte for byte (drizzle-kit probe). |
| 1 → 6 (e2e) | `app/api/init/route.ts` inserts `role: 'admin'` | the setup project until Task 6 deletes it | Agrees (line 21 matches the replacement). |
| 2 → 3, 4 | `requireAdminUser`, `requireAdmin`, `assertAdmin`, `SessionUser.role` | layout/pages, app actions, apps DAL; users actions and DAL | Agrees. |
| 2 → all `SessionUser` fixtures | `role` now required | `data-apps-sync.test.ts` calls typed DAL functions | Needs `as const` (finding 8); all other fixtures go to untyped mocks. |
| 2 → 3 | `group-layouts.test.ts` `it.todo` hand-off | vitest 4 accepts `it.todo(name, fn)` and reports it as todo (dry run: 1059 passed, 1 todo) | Agrees. |
| 2 → 8 | `requireActor` | `changePasswordAction` | Agrees. |
| 3 → 3 | `readAccess` columns | `data-apps-sync.test.ts:272` exact list | **Conflict** (finding 3). |
| 3 → 3 | `appErrorKey('forbidden')` | `app-errors.test.ts:8` | **Conflict** (finding 4). |
| 3 → 3 | `AppAccess.annotationEnabled`, `DifyRouteContext.annotationEnabled`, `forbiddenResponse` | annotation routes and tests (`dify-routes-files` mocks `@/lib/auth/session` with `verifySession`/`AuthError` only; `isAdmin` comes from `roles`, real) | Agrees. `dify-route.test.ts` uses `toMatchObject`. |
| 3 → 5, 7, 8 | `e2e/fixtures/users.ts`: `seedUser`, `signInAs`, `deleteUsersLike` | admin-users, auth reset, account spec | Agrees. Login labels "Email"/"Password" exist (`login-form.tsx:70,83`; `auth.spec.ts:23` already uses them). `withDb`/bcryptjs type-check. |
| 3 → 5 | `common.forbidden` key | `userErrorKey` | Agrees (added in 3, read in 5). |
| 3 ↔ 4 | `app/(admin)/app-management/actions.ts` (3: `requireAdmin`; 4: `invalidInput`) | sequential edits of one file | Agrees. |
| 4 → 5 | actions, `UserFormInput`, `UserDto` (type import), `PASSWORD_MIN/MAX` | drawer and table | Agrees (tsc 0). |
| 4 → 6 | `lockAdmins`, `isDuplicateEntry`, `invalidInput`, `toActionFailure`, fields; `hasUsers` kept until 6 | `setup.ts`, init action; Task 6 drops `count` | Agrees. |
| 4 → 7 | `invalidInput`, `logActionError`, `toActionFailure`, `emailField`, `passwordField` | reset actions | Agrees (`logActionError` passes a plain Error through, so `expect.any(Error)` holds). |
| 4 → 8 | `lib/data/users.ts` + `verifyPassword` import, `passwordField`, `PASSWORD_MAX` | `changeOwnPassword`, `app/actions.ts` | Agrees. |
| 4 → 5 | page passes `UserDto[]` into the still-`UserRow` client component | structural typing | Agrees (tsc 0 at Task 4). |
| 5 → 6, 7, 8 | `@/hooks/use-action-transition` (`{ pending, run(work): Promise<void> }`) | init, forgot, reset forms; change-password modal (`run` prop type) | Agrees. |
| 5 → 7 | `e2e/auth.spec.ts` `ADMIN_STATE` import | removed in 5, used in 7 | **Conflict** (finding 5). |
| 5 → 5 | the users locale keys (`role`, `role_admin`, `role_user`, `last_admin`, `password_self_hint`, `invalid_input`), plus `auth.password_max_128` (used by 5–8) | added in 5 before every reader | Agrees. |
| 5 (e2e) | antd `Radio.Group optionType="button"` ↔ `getByRole('radio').check()` | Playwright actionability | **Conflict** (finding 2). |
| 5 (git) | `git rm`/`git mv` then `git add -u <removed paths>` | commit hygiene | **Conflict** (finding 6). |
| 6 → 7 | `components/auth/auth-failure.ts` (`ActionErrorCode` import; `resetFailureKey` replaced in 7) | — | Agrees. |
| 6 → 7 | `auth-page-layouts.test.ts` (`hasAdmin` mock; 7 adds `ResetPasswordLayout`) | the reset layout never calls `hasAdmin` | Agrees. |
| 6 → all e2e | `auth.setup.ts` via `/init`; `isPublicPath` without `/api/init` | setup on an empty and on a set-up DB | Agrees on locators (Admin name/email/password, Confirm password, "Create admin and finish setup"). Timing note: finding 7. |
| 7 → 7 | the 64-hex token format ↔ `e2e/auth.spec.ts` token (`randomBytes(32).toString('hex')`) | — | Agrees. The screenshot spec's `?token=screenshot` still renders the form (the format is checked only in the action). |
| 8 → 8 | `getAccountMenuItems` signature; `logout` moved to `sign-out.ts` | only caller `account-dropdown.tsx` (the chat drawer reuses `<AccountDropdown/>`); `account-menu.test.ts` rewritten | Agrees. Two dropdown instances on the chat page each own a `destroyOnHidden` modal, so ids are never duplicated. |
| 8 (e2e) | account button `aria-label "Signed in as {email}"`, menuitem "Change password", dialog name, labels | `/apps` has no `mobileMenu`, so the dropdown is visible on Pixel 7 too; Modal dialog names already work (`admin-apps.spec.ts:222`) | Agrees. |

## Probes run and results

1. **Baseline copy** (`git archive HEAD` → `tmp/b2probe/tree`, node_modules symlinked):
   - `next typegen` + `tsc --noEmit`: 0 errors.
   - vitest: 82 files, 1042 tests, green.
2. **Literal dry run of Tasks 1–8**, gates after each task:

   | Task | tsc | vitest | Notes |
   | --- | --- | --- | --- |
   | T1 | 0 | 84 / 1048 | — |
   | T2 | 12 errors (`data-apps-sync` fixture) | 1 expected failure | A literal `role: 'admin'` still fails (TS2345 `string`); `as const` gives 0. The `it.todo` then makes vitest green: 1059 passed, 1 todo. |
   | T3 | 0 | 2 failures | Findings 3 and 4; green after fixing them. |
   | T4 | 0 | the planned page-test update | No cast needed for `lockAdmins(drizzle.mock())` or `emailTakenBy(db, …)`. |
   | T5 | 0 | 86 / 1108 | — |
   | T6 | 0 | 1 failure | Finding 1; green after the braces (87 / 1107). |
   | T7 | 1 error (finding 5) | 89 / 1116 | — |
   | T8 | 0 | 92 / 1126 | — |

   Over the 84 changed `.ts`/`.tsx` files:
   - oxlint: 0 findings;
   - `oxfmt --check`: 25 files to format (expected, since the plan runs `--write`);
   - `antd lint ./`: "Scanned 383 files. No issues found."

3. **drizzle-kit migration** (`drizzle-kit generate --name b2-users-role`, isolated copies, twice; the second time with the schema importing `@/lib/auth/roles`):
   - one statement, ``ALTER TABLE `users` ADD `role` enum('admin','user') DEFAULT 'user' NOT NULL;``;
   - folder `<ts>_b2-users-role`;
   - the path alias resolves.
4. **Drizzle `drizzle.mock()`** (`tmp/b2probe/drizzle-probe.mts`):
   - `select \`id\` from \`users\` where \`users\`.\`role\` = ? for update`, params `['admin']`; the plan's regex matches;
   - `enumValues ['admin','user']`, `notNull true`, `default 'user'`, `onUpdateFn` is a function;
   - an update also sets `updated_at = ?`;
   - `DrizzleQueryError.name === 'DrizzleQueryError'`, and its message embeds the parameters (`errors.js`), as decision h says.
5. **Formatting of migration snapshots.** `oxfmt --check` on B1's and the new `snapshot.json`: format issues, so lint-staged will rewrite the file at commit (finding 15).
6. **`git add -u` on paths already removed by `git rm`/`git mv`:** `fatal: pathspec … did not match any files`, exit 128 (finding 6).
7. **zod** (`tmp/b2probe/zod-probe.mts`):
   - `z.email()` refuses `a@localhost`, `a@b.c` and a leading space, and accepts `Jane@Example.COM` and `jane+x@…`;
   - `z.flattenError` field errors behave as the tests expect;
   - the user-schema tests pass in the dry run.
8. **The running B1 Docker stack:** `curl localhost:5300/init` → `307 …/login`, and `/api/health` → 200. This confirms Task 10's `/init` curl expectation.
9. **Source reads:**
   - next-auth:
     - `next/index.js:102-129`: `getServerSession` calls `AuthHandler` with action `session`;
     - `core/routes/session.js:53-66`: the `jwt` callback runs on every call, and `session.user` is built from `decodedToken`;
     - `providers/credentials.js`: the top-level `authorize` is a stub, so exporting `authorizeCredentials` is the right test seam.
   - Drizzle:
     - `drizzle(url)` builds a pool (`mysql2/driver.js`), so transactions get their own connection;
     - a transaction rolls back and rethrows on a throw and commits on a returned `fail(...)` (`mysql2/session.js:72-90`);
     - `for(strength: 'update' | 'share')` (`select.d.ts:611`).
   - antd: the radio style (finding 2).
   - Playwright: `_setChecked` and `computeBox`.
10. **Documentation:**
    - Context7:
      - next-auth (`/websites/next-auth_js`): the `jwt` callback runs on session access; `signOut({ callbackUrl })` reloads by default; `JWT` augmentation.
      - Drizzle (`/drizzle-team/drizzle-orm-docs`): returning values from `db.transaction`.
      - zod v4.6.5: `z.flattenError`, `z.email()`.
      - vitest: the `beforeEach` cleanup return.
    - MySQL 8.4 manual pages through crawl4ai: §17.7.3 "Locks Set by Different SQL Statements" and §17.7.1 "InnoDB Locking" (gap locks co-exist; insert intention).
    - antd CLI:
      - `info`: Radio (`optionType`, `options`), Modal (`destroyOnHidden`, `okButtonProps`), Popconfirm, Alert (`title`), Form (`setFields`);
      - `demo Form form-in-modal`;
      - `demo Popconfirm promise`, which confirms that `onConfirm` may return a Promise.
    - Next bundled docs:
      - `02-guides/server-actions.md:22` (event handler in `startTransition`) and `:76-95` (Security: every action authenticates and authorises; deletes may warrant stronger checks);
      - `02-guides/authentication.md:1350-1358` (layouts do not re-run; check in the DAL);
      - `04-functions/refresh.md`.

## Spec coverage

Every B2 item of the charter and the handoff has a task:

- **§4.2:**
  - DAL modules: Tasks 4, 6, 7.
  - Typed session with the role: Task 2.
  - `requireAdmin` / the (admin) redirect: Tasks 2–3.
  - Actions colocated, including `app/actions.ts`: Tasks 4, 6, 7, 8.
  - `changePassword` with bcrypt, `sessionVersion`, `signOut` with the notice, no `update()`: Task 8.
  - Handlers deleted: Tasks 5–7.
  - The proxy without the init fetch, and the login layout's `/init` redirect: Task 6.
- **§4.4** role, backfill, `$onUpdate`, and verification on an empty and a copied DB: Tasks 1 and 10.
- **§4.5** codes: deviations 4 and 5.
- **§4.6:**
  - DAL rules, action results, session, access and proxy tests;
  - setup through `/init`;
  - users seeded through the fixture;
  - the reset reuse asserted in the UI;
  - roles, password change and first run e2e.
- **§5** "done when": `api-routes.test.ts`, the role gates, the Docker gate.
- **§6** ADR-0024, the ADR notes, `auth-gate.md`, `CLAUDE.md`, CII.
- **The three B1 "(B2)" follow-ups:** Tasks 2 and 3.
- **The handoff's items 1–4:** the deviation 1 header; Task 3 and Task 2; Task 9 Step 4.1; Task 9 Step 4.4.

What remains:

- **e2e of every admin action** (§4.6): replaced by vitest, as deviation 3 states (actions cannot be addressed from Playwright). Accepted as designed.
- **ADR-0020's stale references** (finding 21).
- **No test for the duplicate-entry branch in the DAL** (finding 17).

## Review Focus assessment

Each of the five lines has the test the plan names. The dry run confirms the unit tests pass:

- Line 1: tested in Tasks 2, 3 and 4.
- Line 2: the pure rules, and the lock SQL (probed).
- Line 3: `describeError` and `toActionFailure`. The JSON of the logged calls carries neither the hash nor the e-mail.
- Line 4: the `jwt` cases.
- Line 5: the init action, the reset outcome, and the second browser context.

More likely to bite than the listed five, in order:

1. the radio locators (finding 2), which would fail Task 5 and the full suite on every project;
2. the vitest hook teardown (finding 1);
3. commit hygiene around `git rm` / `git add -u` (finding 6);
4. the email refresh resting on next-auth's object aliasing, with no `session.user.email` test (finding 10; Review Focus 4 is the place for it).
