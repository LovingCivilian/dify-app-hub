# B2 whole-branch review: 533bfb37..ff5a9914 (17 commits, 109 files)

Reviewer: Opus, Task 9 Step 1. This review was read-only. The working tree stayed clean. My only scratch file was a probe under `tmp/review-final/`, and I deleted it afterwards.

## Gates re-run on ff5a9914

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec oxlint` on the 85 changed `.ts`/`.tsx` files | exit 0 |
| `pnpm exec oxfmt --check` on 99 changed files | all formatted |
| `npx @ant-design/cli lint ./` | 384 files, no issues |
| vitest, 21 B2 files (rank, actions, DAL, setup, password, auth options and session, layouts, proxy, init, login, routes, schemas) | 215/215 pass |
| `git grep -n "process.env" -- lib app components hooks` | only `lib/env.ts:92,94` |
| `\p{Han}` in the changed files | See the note below this table. |
| `AGENTS.md` | byte-identical (`git diff --quiet`) |
| Migration snapshot chain | B1 `eda7e271` → `fa624bcb` (ALTER) → `eeef7476` (backfill). The two B2 snapshots are identical apart from id and prevIds. The only delta from B1 is the `role` column. |

Notes on the `\p{Han}` check:

- Two kinds of hit are expected. `locales/zh` is Chinese by design. `.cii-assessment.md` is upstream's file, kept in Chinese per AGENTS.md, and B1 set the same precedent.
- Two hits in `locales/{en,ar}` are false positives. They match `·` (U+00B7), whose PCRE2 script extensions include Han.

## Strengths

- **Defence in depth is complete.** I found no admin entry point without a role check:
  - The `(admin)` layout and both pages call `requireAdminUser()`.
  - All seven admin Server Actions call `requireAdmin()` before reading input.
  - All four apps writes and all four users functions call `assertAdmin`.
  - The annotation routes check `hasAdminRights` right after `resolveDifyRoute`.
  - The two remaining `'use server'` exports are deliberately not admin actions. `changePasswordAction` calls `requireActor` and acts only on `actor.id`. `createOwnerAction` takes no actor (deviation 2) and guards itself on state.
- **The rank is checked against the locked row, never the input.**
  - `updateUser` and `deleteUser` run `lockTarget(tx, id)`, a `FOR UPDATE` on the primary key, and pass that row to `updateRefusal` and `deleteRefusal`.
  - `createRefusal` checks the role being given. With no existing row, that is the only thing to check.
  - `__tests__/user-management-rank.test.ts` drives the real session chain and the real rules with an admin session against admin and owner rows, including "send the `user` role for an admin's row". The SQL ending in `for update` is pinned through `drizzle.mock().toSQL()`.
- **The password change is tied to the locked row.** `changeOwnPassword` does a fast unlocked refusal, hashes outside the lock, then re-checks the hash under `FOR UPDATE` before the write and the `sessionVersion + 1`. This closes the lost-update race with an admin's reset, and the ADR writes it up carefully.
- **First run is correct under concurrency.**
  - `lockAnyAccount` runs under an explicit `isolationLevel: 'repeatable read'`.
  - A cheap `hasAccounts()` check comes before bcrypt.
  - `ER_DUP_ENTRY` maps to `forbidden`.
  - It is unit-tested on every branch and was probed on MySQL 8.4: one owner plus a 1213 under RR, versus two owners under RC.
- **Error logging is done properly.** `describeError` keeps only typed `code`/`errno` from a `DrizzleQueryError` cause or a bare driver error. That keeps `params` and mysql2's `sql`/`sqlMessage` out of the production log.
- **The migration is sound.**
  - The generated ALTER sits in its own folder. A Drizzle `--custom` backfill sits in another.
  - The backfill makes everyone `admin`, then the oldest by `ORDER BY created_at, id LIMIT 1` becomes owner. The order is deterministic and the statement is idempotent.
  - On an empty DB both UPDATEs touch nothing. On the owner's one-account DB, that account becomes owner. With N accounts, you get one owner and N−1 admins.
- **Session refresh rides the existing query.** The `jwt` callback reads `sessionVersion`, `role`, `email` and `name` in one query. The `session` callback forwards them explicitly without a fallback.
  - A pre-B2 token picks up its role on first use.
  - A demoted admin is refused on the next request, which the e2e test pins.
  - I confirmed in `node_modules/next-auth/core/routes/session.js` that every `getServerSession` runs the `jwt` callback.
- **The §5 "done when" is pinned in a test.** `__tests__/api-routes.test.ts` fails on any stray Route Handler.
- **The records are thorough.** ADR-0024 states its sources, the consequences (good and bad) and the deviations. `docs/auth-gate.md` is fully rewritten.

## Review Focus against its tests

| Focus | Tests | Verdict |
| --- | --- | --- |
| 1. A `user` reaches an admin entry point | `auth-options` (jwt refresh); `app-management-actions` (every app action with a `user` session); `data-apps` and `data-users` (DAL refuses before any query); `user-management-actions`; `dify-routes-files` "annotation routes and roles"; `e2e/roles.spec.ts` | Covered |
| 2. The rank | `data-users` (the full refusal matrix, `lockTarget` SQL); `user-management-rank` (admin vs admin/owner rows, row decides, owner session, nothing written); `e2e/admin-users.spec.ts` (an admin sees no Edit/Delete on owner or admin rows and only the User role; the owner's own row is fixed and still saves; dup email on edit writes nothing) | Covered (deferred e2e gap: an admin's own row, below) |
| 3. A failed users write | `data-users` `isDuplicateEntry`; `data-users-writes` (dup on insert → `email_in_use`, other errors rethrown); `action-failure` (`describeError` on a `DrizzleQueryError` whose params hold a hash; lost connection) | Covered for production logs. The dev Server Function log is a gap (I-1). |
| 4. Role/email changed mid-session | `auth-options` (pre-B2 token, refresh, revocation, deleted row); `e2e/admin-users` demotion test | Covered |
| 5. Single use and replay | `init-actions` (`forbidden` passed through), `auth-failure` (mapped), `init-form` redirects to `/login`; `e2e/account.spec.ts` (second context signed out) | Covered |

## Issues

### Critical (must fix)

None.

### Important (should fix)

**I-1. Dev mode logs Server Function arguments, so plaintext passwords (and B1's API keys) print to the `next dev` terminal.** `next.config.ts:4-9`

- **What's wrong.** Next 16 logs every Server Function call with its arguments in development by default. The logger stringifies each argument with `safe-stable-stringify`, using `maximumDepth: 2` and `maximumBreadth: 3`, and stable stringify sorts the keys (`node_modules/next/dist/server/dev/server-action-logger.js`). That breadth limit does not hide the secrets. The sorted keys that print are:

  | Action                                     | Keys printed                     |
  | ------------------------------------------ | -------------------------------- |
  | `createOwnerAction`                        | `email`, `name`, `password`      |
  | `createUserAction` / `updateUserAction`    | `email`, `name`, `password`      |
  | `changePasswordAction`                     | `currentPassword`, `newPassword` |
  | B1's `createAppAction` / `updateAppAction` | `apiBase`, `apiKey`, …           |

  Before B2 these passwords went to Route Handlers, which Next does not log.

- **Why it matters.**
  - CLAUDE.md's "Quick dev loop" runs `pnpm dev` against the owner's real local database and real accounts.
  - The e2e suite runs on `next dev` too.
  - Claude sessions routinely read the dev server's output.
  - OWASP's Logging Cheat Sheet ("Data to exclude") lists "Authentication passwords" and "Encryption keys and other primary secrets".
  - Unlike the Drizzle dev logger (hashes, recorded under decision g), this prints plaintext, it is new in this branch, and nothing records it.
- **Fix.** Add `logging: { serverFunctions: false }` to `nextConfig`, and add a sentence to ADR-0024 decision g. Source: Next 16 bundled docs `01-app/03-api-reference/05-config/01-next-config-js/logging.md`, "Server Functions" ("invocations are logged by default during development. You can disable this by setting `logging.serverFunctions` to `false`").

### Minor (nice to have)

**M-1. The init form's confirm validator lacks the empty guard.** `components/auth/init-form.tsx:95-98`

- **What's wrong.** The validator is `value === getFieldValue('password')` with no `!value ||`. This is inherited code in a file B2 touched.
- **Why it matters.** With the password filled and the confirm field empty, the form shows both "confirm required" and "passwords do not match".
- **Fix.** Use `!value || value === getFieldValue('password')`, as `change-password-modal.tsx` already does. Source: antd Form "register" demo (`npx @ant-design/cli demo Form register`, line 270: `if (!value || getFieldValue('password') === value)`).

**M-2. The users drawer's name rule lacks `whitespace: true`.** `components/admin/users/user-form-drawer.tsx:114` (plan-mandated: the plan's Task 5 code at plan line 2778)

- **What's wrong.** A name of only spaces passes antd. The server's `nameField` (`z.string().trim().min(1)`) then refuses it.
- **Why it matters.** The admin gets the generic "Check the fields and try again."
- **Fix.** `{ required: true, whitespace: true, message: … }`, as the init form already has. Source: antd `Form.Rule.whitespace` (`npx @ant-design/cli info Form`).

**M-3. The client rules and the zod fields disagree, and an `invalid_input` answer names no field.** Partly plan-mandated: decision k's premise.

Locations: `components/admin/users/user-form-drawer.tsx:63,72,121-124`; `components/auth/init-form.tsx:39,67-70`; `components/auth/auth-failure.ts:11-12`; `lib/auth/fields.ts:11-12`.

- **What's wrong.** antd's `type: 'email'` (`@rc-component/async-validator` 6.0.0) and `z.email()` do not agree. A probe on the installed versions showed that antd accepts:
  - `user@münchen.de`
  - `jo#e@example.com`
  - `o.brien!x@example.com`

  `z.email()` refuses all three. Name and email also have no antd `max: 255`, against `.max(255)` in zod.

- **Why it matters.**
  - On `/init`, `initFailureKey` maps `invalid_input` to `init.failed`, so the owner of a fresh install is told to try again, and retrying never helps.
  - In the drawer the admin gets a generic message with no field marked.
  - Decision k says antd "already refused such addresses". That is true only for TLD-less addresses.
- **Fix.** Either of these works; the first matches the change-password modal:
  - Show the action's `fieldErrors` on their fields with `form.setFields([{ name, errors: [t(...)] }])`, as `change-password-modal.tsx:66-69` already does. Source: antd FormInstance `setFields`.
  - Use the shared, client-safe zod field as the antd rule: `{ validator: (_, v) => !v || emailField.safeParse(v).success ? Promise.resolve() : Promise.reject(...) }`, and add `max: 255`. Sources: antd `Form.Rule.validator`/`max`; zod `safeParse`.

  Then amend decision k's sentence in ADR-0024.

**M-4. The 128-character password maximum accepts input that bcrypt silently truncates at 72 bytes.** `lib/auth/fields.ts:8,10`; ADR-0024 decision f (plan-mandated: decision f)

- **What's wrong.** A passphrase longer than 72 UTF-8 bytes (fewer characters if any are multibyte) is accepted, but only its first 72 bytes count.
- **Why it matters.** Two passphrases that share their first 72 bytes are interchangeable. The security impact is small, since 72 bytes is ample entropy, but it contradicts the standard advice:
  - OWASP Password Storage Cheat Sheet, "Input Limits of bcrypt": "you should enforce a maximum password length of 72 bytes".
  - bcryptjs README: "The maximum input length is 72 bytes", with `truncates(password)` documented as the check.
- **Fix.** This reverses a plan decision, so it needs the owner's word. Either:
  - add a `.refine(v => new TextEncoder().encode(v).length <= 72)` on `passwordField` and the same check as an antd `validator`, so it stays client-safe (sources: zod `refine`; MDN `TextEncoder.encode`); or
  - keep 128 and have ADR-0024 decision f cite OWASP's contrary advice and the reason for diverging.

**M-5. ADR-0024 lacks sources for decisions e, h and i, and for f's 72-byte claim.**

Locations: `docs/decisions/0024-…md:61,62,64,65`. This is a fix-wave candidate. Rule R0 requires a source for every decision. Sources to add:

| Decision | Source to cite |
| --- | --- |
| f | The bcryptjs README line above (and OWASP, M-4). |
| e | There is no foreign key from `password_reset_tokens.user_id` (`db/schema/password-reset-tokens.ts`), so nothing cascades; MySQL 8.4 "FOREIGN KEY Constraints" (`ON DELETE CASCADE` exists only with a constraint); Drizzle `transaction` docs for the single unit. |
| h | The init migration created `users.id` as `varchar(191)` under `CREATE TABLE IF NOT EXISTS` (`db/migrations/20260522015811_init/migration.sql:19-20`), so the table may predate this line's `generateUuidV4` default; the column is now `varchar(36)`. |
| i | The move follows the frontend conventions' shared-hooks location (`docs/frontend-conventions.md`) and react.dev "Reusing Logic with Custom Hooks". |

**M-6. The dev-noise follow-up states an unverified cause.** `CLAUDE.md:95`

- **What's wrong.** The follow-up says the `Performance.measure` "negative time stamp" TypeError happens "because `app/page.tsx` (`Home`) redirects to `/apps` during client navigation". The 2026-10-07 handoff it cites recorded it only as "Next internal".
- **Why it matters.** Future sessions treat CLAUDE.md as fact.
- **Fix.** Word it as observed: "seen on every form sign-in without `callbackUrl`, whose landing goes through `Home`'s server `redirect('/apps')`; recorded in the 2026-10-07 handoff as Next-internal; cause not established". This is a fix-wave candidate.

**M-7. The `.cii-assessment.md` summary does not match its own rows.** `.cii-assessment.md:5,82-84` (pre-existing)

- **What's wrong.** The 35 criterion rows tally 24 ✅, 6 ⚠️ and 5 ❌. The summary and the header say 28 ✅ / 2 ⚠️ / 5 ❌ (28/35, 80%).
- **Why it matters.** AGENTS.md requires the assessment to be accurate before commits.
- **Fix.** Set the summary to 24 (69%), 6 (17%), 5 (14%) and the header to "未通过 (24/35, 69%)". In the B2 change-log row, note that earlier summaries counted partial passes as passes. Use its own `docs: update CII assessment` commit. This is a fix-wave candidate.

**M-8. A database failure during sign-in sends its SQL text to the browser.** `lib/auth/options.ts:20-31` (pre-existing; B2 extracted and extended this function)

- **What's wrong.** A thrown `DrizzleQueryError` from `authorizeCredentials` has the message `Failed query: select … password, session_version … where users.email = ?\nparams: <typed email>,1`. next-auth puts that message into the error redirect URL (`node_modules/next-auth/core/routes/callback.js:344-349`; next-auth Credentials docs: "Throwing an Error will redirect the user to an error page with the error message"). With `redirect: false`, the login request's response carries it.
- **Why it matters.** It contains no hash and no key, only the schema's column names and the user's own email. Review Focus 3's intent ("a lost database leaks nothing") covers this path in spirit.
- **Fix.** Wrap the lookup and verify in `try/catch`, call `logActionError(error, 'authorizeCredentials')`, and throw a fixed `new Error('ServiceUnavailable')`. Source: the same next-auth doc line, which allows rejecting with an Error, and decision g's `describeError`.

**M-9. `changeOwnPassword` answers two codes for one cause, a deleted account.** `lib/data/users.ts:236,249`

- **What's wrong.** It answers `unauthorized` when the row is gone before the check, and `not_found` when it is gone before the lock.
- **Why it matters.** The form shows "session expired" in one case and "could not change the password" in the other, for the same cause.
- **Fix.** Return `fail('unauthorized')` in both places, and update `__tests__/data-users-password.test.ts:138`. Source: charter §4.5 (`unauthorized` = no live session) and `components/shell/account-errors.ts`. This is a nit.

## Triage of the ledger's deferred Minors and fix-wave candidates

| Item | Triage |
| --- | --- |
| Fix-wave: `next.config.ts` `logging.serverFunctions: false` | **Fix before merge** (I-1). |
| Fix-wave: init confirm validator `!value \|\|` | **Fix before merge** (M-1; documented route, R0). |
| Fix-wave: drawer name `whitespace: true` | **Fix before merge** (M-2; documented route, R0). |
| Fix-wave: ADR-0024 citations for e, h, i and f's 72 bytes | **Fix before merge** (M-5; R0, docs only). |
| Fix-wave: reword the dev-noise cause | **Fix before merge** (M-6; docs only, CLAUDE.md accuracy). |
| Fix-wave: CII summary vs rows | **Fix before merge** (M-7; AGENTS.md accuracy, its own commit). |
| New: M-3 (client/zod mismatch, field-less `invalid_input`) | **Fix in the fix wave** (documented route, R0). The first-run owner is the person hit. |
| New: M-4 (72-byte cap) | **Owner's decision.** It reverses plan decision f. Either change it, or cite OWASP's contrary advice in ADR-0024. |
| New: M-8 (sign-in SQL text to the browser) | **Fix wave preferred** (R0, function touched by B2). Acceptable as a follow-up, since no secret leaks. |
| New: M-9 (two codes for a deleted account) | **Fix wave** (trivial), or follow-up. |
| Task 1: crash window between the ALTER and its migrator record | **Follow-up / no action.** Inherent to Drizzle's migrator; ADR-0024 "More Information" records the recovery. |
| Task 2: no test for a token with id+role but no email | **No action.** Unreachable: next-auth's default token carries the email, and the jwt callback overwrites it from the row. |
| Task 3: task-3-report top sections keep the original claims | **No action.** Workspace-only file, not committed, not among the files Task 9 Step 6 may copy. |
| Task 5: no e2e for an admin's own row, or for an admin editing a user row | **Follow-up.** The server side is pinned by `user-management-rank.test.ts`. The UI uses the same `isSelf`/`MANAGEABLE_ROLES` logic the owner's own-row e2e exercises. |
| Task 7: the password test stub's `update()` drops the table argument | **Follow-up** (optional hardening). |
| Task 2 ⚠️: a pre-B2 cookie upgrading on first use | **Before merge, at Task 9** (owner browser check after the Docker rebuild). Already on ADR-0024's Verification list. |
| Task 7 ⚠️: "Change password" from the mobile chat drawer | **Before merge, at Task 9** (owner browser check). |
| Task 1 ⚠️: the migration on a copy of the owner's DB | **Before merge, at Task 9 Step 4.** |
| Task 5/6: e2e hydration race; product-side fix | **Follow-up**, recorded. It changes a pattern, so it needs the owner's yes and an ADR. |
| Task 6: MySQL down → `/login` renders `error.tsx` | **No action.** Recorded as Neutral in ADR-0024. Not a regression. |

## Declined to judge

- **Email as the Dify end-user id.**
  - An email edit hides that account's earlier conversations.
  - An account that takes a former email inherits that address's Dify conversations.
  - Reason: charter §2 "Identity" (do not re-open) and ADR-0006. Decision a and its consequences are recorded in ADR-0024. Worth the owner's attention before LDAP (B3).
- **First run is open to the first visitor of a fresh install.** Inherited design, kept by charter §4.2. The deployment is internal.
- **No link from the user area to the admin pages.** Pre-existing frontend. B2 changes no navigation.
- **No rate limiting on sign-in, change password or init.** Pre-existing for sign-in, and the charter is silent. bcrypt cost 12 bounds the guess rate.
- **Field-level last-write-wins when the owner and an admin edit different fields of one account at the same moment.** Ordinary CRUD semantics. Decision d's lock exists for the rank, not for merging fields.
- **next-auth clears the session cookie when the jwt callback's query fails (`JWT_SESSION_ERROR`).** Pre-existing since ADR-0018. B2 only widens the select.
- **`$onUpdate` writes UTC while `CURRENT_TIMESTAMP(3)` uses MySQL's session zone.** Charter §4.4 mandates `$onUpdate`. It is the same as B1's apps table, and consistent while MySQL runs in UTC.
- **Two containers migrating at the same instant.** Pre-existing for every migration. Production runs one container.
- **The inherited forgot/reset handlers' Chinese strings, raw-error logs, the signed-in `/reset-password`, and the title "Reset admin password".** Deviation 6, recorded.
- **`.cii-assessment.md` written in Chinese.** It is upstream's file under AGENTS.md, and B1 set the precedent.
- **The pre-existing orphan key `common.close`.** B2 did not touch it.
- **The Drizzle dev query logger printing hashes and keys.** Pre-existing and recorded (decision g). Silencing Server Function logging (I-1) does not cover it.
- **The full e2e suite, the migration on the copy, the Docker gate.** Task 9 Steps 3 to 5. The brief excluded Playwright and Docker from this review.
- **No ownership transfer.** Explicitly out of scope (ADR-0024 "Not in this decision").

## Assessment

**Ready to merge: With fixes.**

- The authorization model is complete and correct: every admin entry point checks the role at two layers, the rank is checked against the locked row, and all gates pass.
- What remains is one Important (a one-line config so dev stops printing plaintext passwords) and small Minors, mostly documented routes for the fix wave.
- Task 9's own pre-merge steps still have to happen: the full e2e suite from empty, the migration on the copy, the Docker gate, and the owner's browser check.
