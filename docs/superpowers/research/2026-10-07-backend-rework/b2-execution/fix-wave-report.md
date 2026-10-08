# B2 fix wave: report (implementer, 2026-10-08)

Base ff5a9914, head d24f251d. Six commits. Every item of `fix-wave-brief.md` is done. The working tree is clean, and `AGENTS.md` is byte-identical.

| Commit | Subject | Items |
| --- | --- | --- |
| 810bb271 | fix(config): stop logging Server Function arguments in development | 1 (I-1) |
| 81dc62a1 | fix(auth): match the account forms' rules to the server fields | 2 (M-4), 3 (M-3), 4 (M-1), 5 (M-2) |
| ab088b9f | fix(auth): keep a database failure at sign-in out of the browser | 6 (M-8) |
| ed5d98c8 | fix(account): answer unauthorized for an account deleted mid-change | 7 (M-9) |
| 808b5a49 | docs: record the B2 fix wave in ADR-0024 and reword a follow-up | 8 (M-5), 9 (M-6), 11 |
| d24f251d | docs: update CII assessment | 10 (M-7) |

## Per item

### 1. I-1: `logging.serverFunctions: false`

- **Change.** `next.config.ts` gains `logging: { serverFunctions: false }`. There were no earlier `logging` keys to keep.
- **Test.** New file `__tests__/next-config.test.ts`. It imports the config and expects `logging` to match `{ serverFunctions: false }`.
  - RED: `pnpm exec vitest run __tests__/next-config.test.ts` failed with `Received: undefined`, as expected, since the key did not exist yet.
  - GREEN: 1 passed.
- **Installed code.** Next 16.3.4 reads the key in `node_modules/next/dist/server/base-server.js:424`: `logServerFunctions: typeof this.nextConfig.logging === 'object' && Boolean(this.nextConfig.logging.serverFunctions)`. The key's schema entry is `config-schema.js:708`.
- **Live evidence.** I ran `DEBUG=pw:webserver pnpm exec playwright test e2e/account.spec.ts --project=desktop-light`, which prints the `next dev` terminal.
  - The two change-password Server Action calls show as `POST /apps 200 in 73ms` and `POST /apps 200 in 258ms`.
  - Neither has a `└─ ƒ changePasswordAction(...)` line beneath it, and the log has no `ƒ` line anywhere.
- **Sources.**
  - Next's bundled docs, `01-app/03-api-reference/05-config/01-next-config-js/logging.md`, "Server Functions": "invocations are logged by default during development. You can disable this by setting `logging.serverFunctions` to `false`".
  - OWASP Logging Cheat Sheet, "Data to exclude": "Authentication passwords", "Encryption keys and other primary secrets". I fetched the page with crwl.

### 2. M-4: the 72-byte password maximum

- **Change in `lib/auth/fields.ts`.**
  - `PASSWORD_MAX` (128) is gone. `PASSWORD_MAX_BYTES = 72` takes its place.
  - `passwordField` is now `z.string().min(8).refine(fitsBcrypt, { error: … })`. `fitsBcrypt` tests `new TextEncoder().encode(value).length <= 72`.
  - One shared, client-safe helper builds the antd rules: `ruleFor(check)(message)` returns `{ validator }`. It exports `passwordBytesRule`, here, and `emailRule`, under item 3.
- **The forms.** Three forms replace `{ max: PASSWORD_MAX, … }` with `passwordBytesRule(t('auth.password_too_long'))`:
  - the users drawer;
  - the init form;
  - the change-password modal's new password.
- **i18n.** `auth.password_max_128` is replaced by `auth.password_too_long` in en, zh and ar, with the brief's texts verbatim.
- **Readers of `PASSWORD_MAX` and the old key.** None remain in code. Only the B2 plan still mentions them, and it is a historical record that I left untouched.
- **Sign-in.** `authorizeCredentials` stays unbounded.
- **Tests.**
  - New file `__tests__/auth-fields.test.ts`:
    - 72 ASCII characters pass, 73 fail;
    - 24 × '€' (72 bytes) pass, 25 × '€' (75 bytes) fail.
    - Each case also asserts `bcrypt.truncates(value) === !accepted`, the bcryptjs README's documented check, as an oracle.
    - The same four cases run through `passwordBytesRule`'s validator.
    - An empty or undefined value resolves, so the `required` rule reports it alone.
    - The 8-character minimum is kept.
    - '€' was chosen to keep Chinese characters out of a touched file.
  - `__tests__/user-management-schemas.test.ts`: the 128/129 case becomes 72 passes and 73 fails.
  - `__tests__/account-actions.test.ts`:
    - a new password over 72 bytes gives `invalid_input` with `fieldErrors.newPassword`, and the DAL is not called;
    - a 129-character current password reaches the DAL (see deviation 1).
  - RED: `TypeError: passwordBytesRule is not a function`. The schema test failed because 73 characters were still accepted, and the action test because the 129-character current password was refused.
  - GREEN: all passed.
- **Sources.**
  - bcryptjs 3.0.3 README, lines 17–19 and 154–155: "The maximum input length is 72 bytes (note that UTF-8 encoded characters use up to 4 bytes)", and `bcrypt.truncates(password)`.
  - OWASP Password Storage Cheat Sheet, "Input Limits of bcrypt": "you should enforce a maximum password length of 72 bytes".
  - NIST SP 800-63B-4: "Verifiers and CSPs SHOULD permit a maximum password length of at least 64 characters".
  - zod.dev/api, `.refine` with `{ error }` (Context7 `/websites/zod_dev`).
  - MDN `TextEncoder.encode()`: "returns a Uint8Array containing the string encoded using UTF-8".
  - antd Form Rule `validator`: `npx @ant-design/cli doc Form --version 6.6.5`.
  - The OWASP, NIST and MDN pages were fetched with crwl.
- **ADR-0024 decision f** is amended in place. It states that it replaces the plan's 128-character maximum and cites the sources above.

### 3. M-3: the email fields validate with `emailField`

- **Change.**
  - `emailRule = ruleFor(value => emailField.safeParse(value).success)` lives in `lib/auth/fields.ts`.
  - The init form and the users drawer use `emailRule(t(…))` in place of `type: 'email'`.
  - `emailField` carries `.max(255)`, so the 255 maximum now holds on the client by construction.
  - The login form keeps `type: 'email'`.
- **Test.** `__tests__/auth-fields.test.ts`, `emailRule`:
  - `user@münchen.de`, `jo#e@example.com`, `o.brien!x@example.com`, `a@localhost` and a 262-character address are each refused by both `emailField` and the rule;
  - a valid address passes both;
  - an empty value passes.
- **Probe on the installed versions.** `@rc-component/async-validator` 6.0.0 with `type: 'email'` accepts the first three addresses, refuses `a@localhost`, and accepts `jane.doe@example.com`. `z.email()` refuses all four and accepts the valid one. This confirms the ADR's amended sentence.
- **Sources.**
  - antd Form Rule `validator`, from the antd CLI.
  - zod `safeParse`, zod.dev/api.
- **ADR-0024 decision k** is amended.

### 4. M-1: the init confirm validator

- **Change.** `!value || value === getFieldValue('password')`.
- **Source.** `npx @ant-design/cli demo Form register --version 6.6.5`, line 272: `if (!value || getFieldValue('password') === value)`.
- **Test.** None in vitest: these are component rules and the suite has no DOM. The e2e first-run setup (`e2e/auth.setup.ts`) submits this form and passed.

### 5. M-2: `whitespace: true` on the drawer's name rule

- **Change.** `{ required: true, whitespace: true, message }`.
- **Source.** The antd docs state that `whitespace` "only work[s] with `type: 'string'` rule". A rule without a `type` is a string rule: `@rc-component/async-validator/lib/index.js:275` (`getType`: `return rule.type || 'string'`), and `lib/validator/string.js` runs `rules.whitespace` when `rule.whitespace === true`. The init form's name rule already used this form.
- **Test.** e2e only, as for item 4 (`e2e/admin-users.spec.ts` add and edit passed).

### 6. M-8: a database failure at sign-in

- **Change in `lib/auth/options.ts`.**
  - The lookup and the bcrypt check move into a private `findAccount`.
  - `authorizeCredentials` wraps the call in `try`/`catch`. On a throw it calls `logActionError(error, 'authorizeCredentials')`, which logs name, code and errno only, then `throw new Error('Default')`.
  - Refused credentials still return `null`.
- **Change in the login form.**
  - `components/auth/auth-failure.ts` gains `loginFailureKey(error)`: `CredentialsSignin` maps to `auth.login_failed` ("Check your email and password"), and anything else to `auth.login_error` ("Something went wrong while logging in").
  - `components/auth/login-form.tsx` uses it.
- **The documented contract** (Context7 `/websites/next-auth_js`, then crwl on the two pages):
  - Credentials provider: "1. If you return `null` then an error will be displayed advising the user to check their details. 2. If you throw an Error, the user will be sent to the error page with the error message as a query parameter."
  - Pages, "Error codes": "**CredentialsSignin**: The `authorize` callback returned `null` …" and "**Default**: Catch all, will apply, if none of the above matched".
- **Why not `null`.** `null` is the documented route for wrong credentials. The documented distinct route for a failure is a thrown Error, and the brief says not to show "wrong password" for a database failure when a distinct route exists.
- **Why the message `Default`.** It is next-auth's own documented catch-all code for the error parameter, so it is fixed, non-sensitive, and means the same to any next-auth page. The reviewer suggested `ServiceUnavailable`; the brief asks only for a fixed message.
- **Installed code.**
  - `node_modules/next-auth/core/routes/callback.js:344-349` puts `error.message` into `/error?error=`.
  - `node_modules/next-auth/react/index.js` (`signIn`, case 42) returns that parameter as `result.error` when `redirect: false` is set.
- **Tests.** In `__tests__/auth-options.test.ts`, `verifyPassword` is now a hoisted `vi.fn` with the same default behaviour.
  - A `DrizzleQueryError` whose query names `users` and `password`, whose params hold `jane@example.com`, and whose cause is `ECONNREFUSED`/-111 is thrown as `Error('Default')`:
    - the message contains neither the email nor `select|users|password`;
    - `console.error` is called once with `('authorizeCredentials:', { name: 'DrizzleQueryError', code: 'ECONNREFUSED', errno: -111 })`;
    - no log call contains the email.
  - A throwing `verifyPassword` produces the same fixed message.
  - `__tests__/auth-failure.test.ts`: `loginFailureKey` maps `CredentialsSignin`, `Default` and `Configuration`.
  - RED: `expected 'Failed query: select `id`, `password`…' to be 'Default'`, `expected 'Illegal arguments: string, undefined' to be 'Default'`, and `loginFailureKey is not a function`.
  - GREEN: all passed.
- **e2e.** `auth.spec.ts` "a wrong password shows the login error and stays on the page" still passes on all three projects, so `CredentialsSignin` still maps to the old text.

### 7. M-9: one code for a deleted account

- **Change.** `changeOwnPassword` answers `fail('unauthorized')` when the locked read finds no row, as the unlocked read already did.
- **Test.** `__tests__/data-users-password.test.ts`: the "deleted before the lock" case now expects `unauthorized`.
  - RED: `expected { ok: false, code: 'not_found' } to deeply equal { ok: false, code: 'unauthorized' }`.
  - GREEN: 5 passed.
- **Source.** Charter §4.5 defines `unauthorized` as no live session. `components/shell/account-errors.ts` maps `unauthorized` to `common.session_expired`.

### 8. M-5: ADR-0024 sources for e, h and i

- **e.**
  - `password_reset_tokens.user_id` has no foreign key (`db/schema/password-reset-tokens.ts`; verified).
  - MySQL 8.4 "FOREIGN KEY Constraints": "`CASCADE`: Delete or update the row from the parent table and automatically delete or update the matching rows in the child table".
  - Drizzle docs "Transactions": all statements commit or roll back as one unit (Context7 `/drizzle-team/drizzle-orm-docs`).
- **h.**
  - The init migration has `CREATE TABLE IF NOT EXISTS users` with an `id varchar(191)` key (verified at `db/migrations/20260522015811_init/migration.sql:19-20`).
  - MySQL 8.4 "The CHAR and VARCHAR Types": the types "are declared with a length that indicates the maximum number of characters you want to store".
- **i.**
  - `docs/frontend-conventions.md:7`: "Shared code lives in root folders: `components/<feature>/`, `hooks/`, `lib/`".
  - react.dev "Reusing Logic with Custom Hooks": "Custom Hooks let you share logic between components".
- **f.** Covered under item 2.

### 9. M-6: the dev-noise follow-up in CLAUDE.md

- **Change.** The sentence now says the `Performance.measure` "negative time stamp" `TypeError` "is seen on form sign-ins without `callbackUrl`, whose landing goes through `Home`'s server `redirect('/apps')`; first noted in the 2026-10-07 handoff, which recorded it as Next-internal; cause not established".
- **Elsewhere.** `git grep` finds the claim nowhere else except the handoff itself, which is the original record.

### 10. M-7: `.cii-assessment.md`

- **Tally.** A script counted the 35 rows before and after the edit: 24 ✅ (rows 1–6, 8–13, 15–19, 22, 25, 27–29, 31, 33), 6 ⚠️ (7, 23, 24, 26, 30, 32) and 5 ❌ (14, 20, 21, 34, 35).
- **Summary.** The header now reads "未通过 (24/35, 69%)", and 汇总 reads 24 / 69%, 6 / 17% and 5 / 14%.
- **Statuses.** No row's status changed.
- **Change log.** A new row explains the reconciliation: the earlier 28/35 did not match the rows, and the 4-row difference is rows that are ⚠️ in the table. It also records the fix wave's evidence updates (see deviation 4).
- **Commit.** Committed alone as `docs: update CII assessment`.

### 11. ADR-0024 records items 1, 2, 3 and 6

- **Decision g** gains the Server Function logging setting and the sign-in failure handling, with their quotes.
- **Decisions f and k** are amended as above.
- **The Sources paragraph** gains the new sources.
- **Affected paths** gains `next.config.ts`.
- **Everything else** is unchanged: Verification, Consequences and Patterns.

## Gates (run on the final tree before the last commit)

| Gate | Result |
| --- | --- |
| `pnpm exec next typegen && pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec oxlint` on the 17 changed `.ts`/`.tsx` files | exit 0 |
| `pnpm exec oxfmt --check` on the 23 changed files and `.cii-assessment.md` | all formatted |
| `pnpm test` | 96 files, 1203 tests, all passed. The baseline at ff5a9914 was 94 files and 1179 tests; the first run in this wave counted 95 and 1180 including the new config test. |
| `npx -y @ant-design/cli lint ./` | 386 files scanned, no issues |
| `AGENTS.md` | byte-identical (`git diff --quiet ff5a9914 HEAD -- AGENTS.md`) |

**Playwright.**

- **Command.** `pnpm exec playwright test e2e/auth.spec.ts e2e/admin-users.spec.ts e2e/account.spec.ts e2e/roles.spec.ts`.
- **When.** After commit ed5d98c8. Everything after it is documentation.
- **Ports.** 5301 and 5399 were free beforehand. 5300 is the owner's stack and was not touched.
- **Result.** 61 passed in 3.0 min:

  | Project       | Passed |
  | ------------- | ------ |
  | setup         | 1      |
  | desktop-light | 20     |
  | desktop-dark  | 20     |
  | mobile-light  | 20     |

- **Extra run.** The I-1 evidence run (`account.spec.ts`, desktop-light, `DEBUG=pw:webserver`) passed 2 of 2.
- **e2e stack.** The e2e MySQL is still running, as the brief asks.

## Deviations from the brief

1. **`app/actions.ts`, the current password.** The brief removes `PASSWORD_MAX` "and every reader of it" but does not say what replaces this reader, `currentPassword: z.string().min(1).max(PASSWORD_MAX)`.
   - It is now `z.string().min(1)`, with no maximum, the same as sign-in.
   - Reason: before B2 no form had a password maximum (`git grep` at 533bfb37 finds none), and the inherited reset form still has none. A password longer than 72 bytes can therefore exist. A 72-byte cap on the current password would stop its owner from changing it, although they can still sign in with it.
   - The Server Action body limit bounds the input: `serverActions.bodySizeLimit`, 1MB by default, per `serverActions.md`.
   - Pinned by the new account-actions test, and recorded in decision f.
2. **`components/auth/login-form.tsx` and `components/auth/auth-failure.ts` (`loginFailureKey`).** Item 6 names only `lib/auth/options.ts`. Its last sentence ("Do not show 'wrong password' for a database failure if the docs offer a distinct route") needs the form to tell `CredentialsSignin` apart from the thrown code. Before this, every `result.error` showed `auth.login_failed`.
3. **ADR-0024 beyond the decisions.** Item 11 says to keep every other part as it is. I added `next.config.ts` to "Affected paths" and extended the closing "Sources" paragraph, because both are part of recording items 1–3 and 6 with their sources. Verification, Consequences and Patterns are unchanged.
4. **`.cii-assessment.md` beyond the summary.** AGENTS.md requires a new change-log row whenever the result changes, and the result went from 28/35 to 24/35. I also updated evidence text, never a status: the #19 and #20 counts (1179 → 1203 tests, 94 → 96 files), the 72-byte cap in #28, and the dev logging and sign-in change in #32.

## Concerns

1. **Name fields have no client maximum.** M-3's "What's wrong" also notes that the name fields lack antd's `max: 255`, against `nameField`'s `.max(255)`. The brief scopes item 3 to email, and item 5 adds only `whitespace`, so a name over 255 characters still gets the generic message ("setup failed" on `/init`). I did not add it, because it needs a new i18n key in three languages, which is outside the brief. Candidate follow-up: `ruleFor(value => nameField.safeParse(value).success)` with a "name too long" key.
2. **New import cycle.** `lib/auth/options.ts` now imports `lib/action-failure.ts`, which imports `AuthError` from `lib/auth/session.ts`, which imports `authOptions` from `options.ts`.
   - Each module uses the others' exports only inside function bodies (`instanceof AuthError` in `toActionFailure` and `errorResponseFrom`; `getServerSession(authOptions)` at call time). Under ESM live bindings the cycle is safe at evaluation.
   - `.oxlintrc.json` has no import plugin.
   - vitest and the e2e run on `next dev` are green: every spec signs in through `authorize`.
   - The production build (Turbopack) is not exercised until the controller's Docker gate. If it ever matters, moving `describeError` and `logActionError` into a module without the session import would break the cycle.
3. **Scratch files.** These are under the self-ignoring `tmp/fixwave/`: the fetched OWASP, NIST, MDN, MySQL, react.dev and next-auth pages, the email probe (`.cjs`), and the Playwright logs. They contain only e2e test credentials from the committed `.env.e2e`. Nothing there ends in `.ts` or `.tsx`.

---

# Round 2 (implementer, 2026-10-08)

Base d24f251d, head 67181818. Four commits. The working tree is clean, and `AGENTS.md` is byte-identical.

| Commit | Subject | Item |
| --- | --- | --- |
| ad115fcd | fix(auth): move the error log helpers out of the auth import cycle | 1 |
| e3a0e5dc | fix(auth): check the name length in the account forms with the server field | 3 |
| ea63fe90 | docs: narrow ADR-0024 decision f and record the round-2 fixes | 1, 2, 3 (records) |
| 67181818 | docs: update CII assessment | 2 |

## 1. The import cycle

- **Change.** `describeError` and `logActionError`, with their private helpers `driverFields` and `causeFields`, move unchanged into a new `server-only` leaf module, `lib/error-log.ts`. It imports only drizzle-orm's `DrizzleQueryError`.
  - `lib/action-failure.ts` imports `logActionError` from it and no longer defines or exports the two functions.
  - `lib/auth/options.ts` imports `logActionError` from `@/lib/error-log`.
- **Why no re-export.** Callers import from `@/lib/error-log` directly, so each function has one import path. The only callers were `options.ts` and `__tests__/action-failure.test.ts`.
- **Tests.**
  - `describeError`'s tests stay in `__tests__/action-failure.test.ts`, and only its import changes to `@/lib/error-log`.
  - RED: `Cannot find package '@/lib/error-log'`.
  - GREEN: `action-failure.test.ts` and `auth-options.test.ts` pass, 25 tests.
- **Import-graph check.** `tmp/fixwave/import-graph.mjs` walks the static `import`/`export … from` specifiers, resolving `@/` and relative paths.
  - From `lib/auth/options.ts` it reaches `db/index.ts`, `lib/env.ts`, `db/schema/*`, `lib/helpers/*`, `lib/auth/roles.ts`, `lib/error-log.ts` and `lib/auth/password.ts`. Neither `lib/auth/session.ts` nor `lib/action-failure.ts` is among them.
  - Sanity check on the walker: from `lib/action-failure.ts` it reaches `session.ts`, then `options.ts`, then `error-log.ts`, and nothing leads back.
- **Source.** MDN "JavaScript modules", "Cyclic imports": "You should usually avoid cyclic imports in your project, because they make your code more error-prone. Some common cycle-elimination techniques are: … Move the shared code into a third module." Fetched with crwl.
- **Docs.** ADR-0024 decision g names the leaf module and the source, `lib/error-log.ts` joins Affected paths, and CLAUDE.md's backend pointer lists it.

## 2. Decision f's wording

- **ADR-0024:62.**
  - "no newly set password has a tail bcrypt ignores" became "a password set through the users drawer, `/init` or the account menu is refused above 72 bytes instead of being cut".
  - It names the exception: the inherited reset handler (`app/api/auth/reset-password/route.ts`, deviation 6) checks only `password.length < 8` (verified at lines 10–18) and still accepts a longer password when SMTP is configured.
  - The residual clause is added: for an existing password over 72 bytes, the hub cannot meet NIST SP 800-63B-4's rule that verifiers "SHALL verify the entire submitted password (e.g., not truncate it)". This is item 9 under "Password Verifiers" (#passwordver) in the fetched page. It was already true before B2.
- **`.cii-assessment.md` row #28.** The evidence now reads "经用户抽屉、`/init` 与账户菜单设置的密码按 bcrypt 的 72 字节输入上限校验（继承的重置密码路由只校验最少 8 位，ADR-0024）". The status stays ✅.
- **The rest of the CII commit.**
  - The #19 and #20 counts change from 1203 to 1207 tests (still 96 files).
  - A new change-log row follows the file's precedent of one row per evidence update.
  - A script counted the 35 rows before and after: 24 ✅, 6 ⚠️, 5 ❌ both times.
  - Committed alone as `docs: update CII assessment`.

## 3. A client maximum on names

- **Change in `lib/auth/fields.ts`.**
  - New export: `nameRule = ruleFor(value => value.trim() === '' || nameField.safeParse(value).success)`.
  - The `trim() === ''` clause leaves a blank name to the `required` rule with `whitespace`. Without it, " " would show both "name required" and "too long", because `nameField` trims and then fails `min(1)`.
  - Any non-blank value that `nameField` refuses is over 255 characters after its trim, so the "too long" message is accurate.
  - JS `\s`, which async-validator's whitespace rule uses, and `String.prototype.trim`, which zod's `.trim()` uses, cover the same characters.
- **Forms.** The init form and the users drawer add `nameRule(t('init.owner_name_too_long'))` and `nameRule(t('admin_users.name_too_long'))` after their `required` + `whitespace` rule.
- **i18n.** Two keys, following the files' per-area pattern (`init.email_invalid` beside `auth.email_invalid`, `init.password_min_8` beside `auth.password_min_8`). Both carry the brief's texts in en, zh and ar.
- **Tests.** `__tests__/auth-fields.test.ts`, `nameRule`:
  - 255 characters pass and 256 fail;
  - 255 characters wrapped in spaces pass, because the server trims;
  - each case is asserted against `nameField.safeParse` as well;
  - empty, undefined and " " resolve.
  - RED: `TypeError: nameRule is not a function`.
  - GREEN: 22 tests in the file.
- **Sources.** antd Form Rule `validator` and `whitespace` (`npx @ant-design/cli doc Form --version 6.6.5`); zod `safeParse` (zod.dev/api).
- **Docs.** ADR-0024 decision k gains one sentence on the name rule.

## Gates (round 2)

| Gate | Result |
| --- | --- |
| `pnpm exec next typegen && pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec oxlint` on the changed `.ts`/`.tsx` files | exit 0 |
| `pnpm exec oxfmt --check` on the 14 changed files and `.cii-assessment.md` | all formatted |
| `pnpm test` | 96 files, 1207 tests, all passed |
| `npx -y @ant-design/cli lint ./` | 387 files, no issues |

**Playwright.**

- **Command.** `pnpm exec playwright test e2e/auth.spec.ts e2e/admin-users.spec.ts`, run after e3a0e5dc. Everything after it is documentation.
- **Ports.** 5301 and 5399 were free beforehand.
- **Result.** 46 passed in 2.0 min:

  | Project       | Passed |
  | ------------- | ------ |
  | setup         | 1      |
  | desktop-light | 15     |
  | desktop-dark  | 15     |
  | mobile-light  | 15     |

- **e2e stack.** The e2e MySQL is left running.

## Deviations (round 2)

1. **CLAUDE.md.** The backend pointer gained `lib/error-log.ts`. The brief did not name CLAUDE.md, but the file lists the backend modules, and leaving the new one out would make it stale.
2. **Decision k.** It gained the name rule. The brief asked only that item 3 be implemented, but ADR-0024 is where B2 records form/server agreement.

## Concerns (round 2)

None.

- Round 1's concern 1 (the name maximum) is resolved by item 3.
- Round 1's concern 2 (the import cycle) is resolved by item 1.
