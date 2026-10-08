# B2 plan: check of the forgot/reset de-scope (2026-10-08)

Plan: `docs/superpowers/plans/2026-10-08-backend-b2-accounts.md` (3,986 lines). Line numbers are the plan's unless a file is named.

How it was checked:

- The whole plan was read against the pre-de-scope copy in `tmp/b2probe/plan.md`, which still holds the old Task 7.
- The current code was read: the two handlers, the `(auth)` pages and layouts, the three `components/auth` files, `lib/auth/password.ts`, `lib/mail.ts`, `lib/access.ts`, `e2e/auth.spec.ts`, the auth tests and the locales.
- The api-routes filter was run with node 24 on today's tree.
- zod 4 and antd's email validators were probed with node.

Nothing is blocking. One finding is significant: deviation 6 cites the charter wrongly, and ADR-0024 would copy that citation. The rest are minor.

## A. Dangling references

**None that point at the wrong thing.**

- Every `decision X` reference (lines 22, 1109, 1397, 1531, 1611, 1644, 1698, 1731, 1838, 1883, 1968, 2015, 2069, 2117, 3783, 3866, 3939) matches the header list a–k.
- Every `Task N` reference is correct (all 68 occurrences checked). So are the deviation numbers (1, 2, 3, 6, "1–6").
- The Review Focus owners are correct: Focus 5 is Task 6 plus Task 7's `account.spec.ts`.
- The Interfaces blocks of Tasks 6 and 7 consume nothing from the old Task 7. Tasks 8 and 9 have no Interfaces block.
- The model table is right: old row 7 was dropped, and old rows 8 and 9 became 7 and 8.
- Nothing remains of `ResetPasswordLayout`, `password-reset.ts`, `resetPasswordAction`, `reset_title`, `randomBytes`, `Task 10` or `decision l`.

- **A1 (minor).** Line 2972 puts "(deviation 6)" into a source comment in `components/auth/auth-failure.ts`. Line 3866 puts "(deviation 6)" into a CLAUDE.md follow-up line. Plan numbering means nothing once the plan is archived.
  - **Fix:** write "ADR-0024" in both places. The api-routes test comment at line 2807 already writes "plan deviation 6, ADR-0024".
- **A1b (minor).** Line 2972 says "the file's top comment becomes …". That comment is in fact the JSDoc attached to `resetFailureKey` (`auth-failure.ts:1`), so the new two-function sentence would land on `resetFailureKey` alone.
  - **Fix:** keep a reset-specific JSDoc on `resetFailureKey`, for example "`/api/auth/reset-password` answers 400 for a bad, used or expired token". `initFailureKey` already gets its own.
- **Aside (not caused by this edit).** The file-structure line 161 still says "notes on 0006/0018/0023". Task 8 also writes a 0020 note (lines 3770, 3804, 3877).

## B. The kept reset flow after every remaining task

**No remaining task breaks it.**

- **Task 1.** The reset handler sets `updatedAt: now` by hand (`reset-password/route.ts:144`). Drizzle's `buildUpdateSet` uses `set[col] ?? onUpdateFn()` (`node_modules/drizzle-orm/mysql-core/dialect.js:100`), so the explicit value wins over `$onUpdate`. The role column is never written by either handler.
- **Task 2.** The `jwt` refresh and `verifySession` with role are fine. The reset still bumps `sessionVersion`. Task 2 gives the auth-page-layouts signed-in mock a role, so `redirectSignedInUser` on `/forgot-password` keeps redirecting.
- **Tasks 3 and 4.** Both `deleteUsersLike` and `deleteUser` (decision e) delete the account's `password_reset_tokens` first. The table has no FK (`db/schema/password-reset-tokens.ts`), so the explicit delete is what prevents orphan tokens.
- **Tasks 5 and 6, orphan locale keys.**
  - Task 5's candidates are `admin_users.delete_failed`, `admin_users.delete_error` and `common.operation_error`.
  - Task 6's candidate is `common.network_error_retry`, whose only reader is `init-form.tsx:44`.
  - The forgot and reset forms read none of them: forgot uses `common.request_failed_retry`, reset uses the `auth.reset_*` keys. i18n parity is untouched, since no reset key changes.
- **Task 5, `e2e/auth.spec.ts` seeding.** Fine:
  - `request` stays (the API reuse at `auth.spec.ts:108` still has its handler);
  - `/api/auth/*` stays public;
  - the seeded `user`-role account lands on `/apps` after its reset.
- **Task 6, proxy and access.** `PUBLIC_PREFIXES` (line 3057) keeps `/forgot-password`, `/reset-password` and `/api/auth`, so both handlers and both pages stay public. The proxy test pins `/forgot-password` and `/reset-password`, and the access test pins `/api/auth/*`.
- **Task 6, `auth-failure.ts`.** `resetFailureKey(status)` survives, and `__tests__/auth-failure.test.ts` keeps its `resetFailureKey` block and its import of both functions. Only the `initFailureKey` block is replaced (line 2785).
- **Task 6, `auth-page-layouts`.** The `hasAdmin` mock is harmless for the forgot layout in the `describe.each`.
- **Task 7.** The login notice prop does not affect the reset form's `router.replace('/login')`.

Two small notes:

- **B1 (minor).** Task 5 Step 8 (line 2443) says "`ADMIN_STATE` and `browser` leave the test if unused". After the edit, `ADMIN_STATE` has no reader anywhere in `e2e/auth.spec.ts` (its only use is line 82). The old Task 7 re-imported it, and nothing does now. `.oxlintrc.json` sets `eslint/no-unused-vars: error`, so the import at line 5 must go too. The comment at `auth.spec.ts:80-81` ("through the signed-in API (admin storage state)") is also stale.
  - **Fix:** "remove the `ADMIN_STATE` import and `browser`, and reword the comment to 'through the database fixture'".
- **B2 (minor).** The kept forgot handler logs raw errors (`forgot-password/route.ts:63`, `console.error('…', error)`). A `DrizzleQueryError` there prints the email, the user id and the reset-token SHA-256. It never prints a password hash or an API key: the reset handler's users update sits inside a catch that does not log. Still, Task 9 Step 1 tells the reviewer to check "that no log line can carry a hash or a key". Without a scope note, the whole-branch review may flag the untouched handler, and the fix wave may edit it against the owner's scope.
  - **Fix:** in Task 9 Step 1, scope that check to the files the branch touches. Add "the inherited reset handlers log raw errors" to Task 8's follow-up line (line 3866).

Not caused by this edit, but cheap: Task 7 edits `login-form.tsx` and `login/page.tsx`, yet its Step 7 e2e list (line 3747) omits `e2e/auth.spec.ts`. That is the spec that drives the login form and the reset flow's sign-in. Consider adding it.

## C. Task 6's api-routes test

**None. It is correct.** Node run on today's tree:

- 34 `route.ts` files today. The strays are `init/route.ts`, `init/status/route.ts`, `users/route.ts` and `users/[id]/route.ts`.
- With `users/**` gone (Task 5), the strays are exactly the two init files, so the test is red at Step 1. This matches the expectation at line 2827.
- With init gone too (Step 6), the strays are `[]`: green at that commit.
- The regex still flags `auth/foo/route.ts`, `auth/forgot-passwordx/route.ts` and `dify/[appId]/route.ts`.

The test is listed in Files (2547), the Run line (2826), Step 8 (3122), `git add` (3136) and the file structure (158). The pre-flight dry run type-checked the same file without error: `tmp/b2probe/tsc-t7.log` holds only the `ADMIN_STATE` error.

## D. Accuracy of the new text

- **D1 (significant: records accuracy, and ADR-0024 copies deviations "each with its source").** Deviation 6, line 20, says B2 leaves out "the two handlers in §5's 'done when' list". §5's "done when" names no handler. Its "except `auth`" literally permits both handlers, since they sit under `app/api/auth/`. That is exactly why line 2540 can say "deviation 6 keeps the two reset handlers under `auth`".
  - What B2 actually leaves out:
    - §4.2 "Actions", last sentence: the deletion of `/api/auth/{forgot,reset}-password`;
    - §4.2's DAL list (`password-reset.ts`) and §4.3's tree (`data/password-reset.ts`, `(auth)/<page>/actions.ts`);
    - §5's "Delivers": "the … password-reset DAL module", and two of "the four forms".
  - §4.6's reuse case is not really left out: the kept e2e test asserts the UI reuse (`auth.spec.ts:113-118`). It also keeps the API assertion the charter wanted gone.
  - **Fix:** reword the sentence, for example: "So B2 leaves out §4.2's `lib/data/password-reset.ts` (also in §4.3's tree), its `requestPasswordReset` and `resetPassword` actions, and the deletion of `/api/auth/{forgot,reset}-password` (§4.2 'Actions'), with two of §5's 'four forms'. §5's 'done when' still holds, since both handlers sit under `auth`. §4.6's reuse case stays covered by the existing UI assertion, beside its API one."
- **D2 (minor). The `no_tld` note (lines 3939-3947) is inaccurate in two ways.**
  1. "Those accounts can no longer be edited in the drawer until their email is corrected" describes nothing new. antd's `type: 'email'` rule already refuses such addresses in the drawer (`user-form-drawer.tsx:112`) and the login form (`login-form.tsx:73`). The rule is in `@rc-component/async-validator` 5.1 and 6.0 and requires a dotted domain with a TLD of two or more letters. So these accounts already cannot sign in through the form. B2 only adds the same refusal on the server.
  2. The SQL regex `'@[^@]+[.][^@.]+$'` is looser than zod. Probe: `z.email()` refuses `a@b.c` and `a@host.123`, which this regex counts as fine. So "`no_tld` is 0" does not prove that no account is refused. zod 4's regex is `/^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/`.
  - **Fix:** count with the domain part zod uses, `email NOT REGEXP '@([A-Za-z0-9][A-Za-z0-9-]*[.])+[A-Za-z]{2,}$'`. Reword the note: "those accounts already cannot sign in through the login form or be saved in the drawer without a corrected email (antd's rule). B2 adds the same refusal on the server. Correct them in the drawer."
- **D3 (minor).** Deviation 6, line 22: "a sole admin who forgets theirs needs a second admin account". Read literally, they cannot create one after forgetting. The next sentence ("Keeping two admin accounts avoids that") carries the meaning, but the first should say "another admin who already exists".
  - The "database fix" (line 22, and the auth-gate known limit at line 3839) is the only way back for a sole admin without SMTP, and no procedure is given.
  - **Optional fix:** add the two-line recipe to `docs/auth-gate.md`: a bcryptjs hash at cost 12 from `node -e`, then `UPDATE users SET password = ?, session_version = session_version + 1 WHERE email = ?`.
- **D4 (minor).** "Active only with SMTP settings" (lines 3825 and 3855) is loose. The reset page and handler answer without SMTP; what needs SMTP is issuing a link (`forgot-password/route.ts:20`).
  - **Fix:** "the forgot handler sends a link only with SMTP settings. Without them no token is issued, and the reset page has nothing to accept."
  - In the same CLAUDE.md "Still upstream-shaped" line (3855), name `components/auth/{forgot,reset}-password-form.tsx` too. They still `fetch` the handlers, use `resetFailureKey(status)` and keep a local `PASSWORD_MIN`.
- **D5 (minor, owner's call).** `docs/auth-gate.md:11` today says: "`/reset-password` stays reachable while signed in on purpose: the emailed link is the only way a non-admin changes their password. Add a layout there once the account menu offers a password change." B2 adds that menu. The rationale becomes false, and the doc's own trigger fires.
  - Task 8 defers the layout "with the reset flow's move to actions" (lines 3823, 3840; deviation 6, line 23). The layout does not depend on that move. The removed one was a 6-line `redirectSignedInUser()` layout that touched neither the page nor the handler.
  - **Fix:** either keep it in B2 (the layout file, one row in `auth-page-layouts.test.ts`, and the signed-in e2e case with `ADMIN_STATE` re-imported), or have Task 8 Step 3 replace that sentence explicitly and give the owner's scope as the reason.
- **D6 (minor).** The frontend-conventions status line (line 3870) says "the forms on actions". Forgot and reset stay on `fetch`.
  - **Fix:** "the users drawer, `/init` and change-password forms on actions".
  - Task 9 Step 6's PR Overview should also carry the scope note (deviation 6), because the PR implements the B2 row minus the reset items.
- **Checked and correct:**
  - Deviation 6, bullet 1. Without SMTP, the forgot page renders the `auth.mail_not_configured` Alert and no form (`forgot-password/page.tsx:6`, `forgot-password-form.tsx:44-56`). The handler returns the generic body without sending (`route.ts:20`).
  - Auth-gate line 3823. `/forgot-password` has the `redirectSignedInUser` layout today; `/reset-password` has none.
  - Review Focus 5's note (line 139). `auth.spec.ts:108-118` covers the reuse.
  - ADR-0024's "app/api holds only auth (next-auth and the two inherited reset handlers) …" matches the tree after Task 6.
  - CLAUDE.md. Its "Still upstream-shaped until B2: …" text and the "Later steps … an account-menu 'change password'" item exist verbatim, so the Task 8 edits apply.

## E. What the old Task 7 delivered that a remaining part still needs

- **128-character maximum (minor).** Decision f (line 44) says "Password fields get a 128-character maximum, in the zod field and as an antd rule". The kept reset form has min 8 only (`reset-password-form.tsx:103, 166-172`), and the reset handler checks only `length < 8`.
  - `auth.password_max_128` keeps three readers: the drawer (2354), the init form (2977) and the change-password modal (3559). It is not orphaned, and parity holds.
  - **Fix:** scope decision f to "the password fields B2 moves to actions (users drawer, `/init`, change password); the inherited reset form and handler keep their minimum only".
- **`logActionError` (minor, optional).** Its only external caller was the forgot action. Now only `toActionFailure` calls it (line 1766). It is still exported and listed in Task 4's Produces (line 1332).
  - oxlint does not flag unused exports. The Global Constraint (line 68) and decision g stay true.
  - **Fix:** either make it module-private and drop it from Produces, or leave it with a doc note that `toActionFailure` is its only caller in B2.
- **`ADMIN_STATE`.** Nothing re-imports it now (see B1). The removal is correct, provided Task 5 also deletes the import.
- **`auth.reset_title` = "Reset admin password" (minor).** It is at line 196 of `locales/{en,zh,ar}/translation.json`. The old Task 7 changed it because B2 creates `user`-role accounts. After the de-scope, a `user`-role account that follows an emailed link (with SMTP set up) reads "Reset admin password".
  - The change touches only locales, not the page or the handler.
  - **Fix:** carry the three values in Task 5 Step 7's locale table: en "Reset your password", zh "重置密码", ar "إعادة تعيين كلمة المرور". Otherwise, list the text in the follow-up line.
- **`__tests__/api-routes.test.ts`.** Moved into Task 6 correctly (section C). Nothing else from the old Task 7 is needed: the 64-hex token, the reset layout test row, the forgot form's message change and the `PASSWORD_MIN` import were all tied to the actions.
