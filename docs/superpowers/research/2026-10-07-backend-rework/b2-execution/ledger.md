# SDD ledger — plan: docs/superpowers/plans/2026-10-08-backend-b2-accounts.md

Spec: docs/superpowers/specs/2026-10-07-backend-rework-charter.md (reachable). Branch feat/backend-b2-accounts, started from fork/overhaul 5f88775e; handoff commit 98d2d25f. Owner approved the plan on 2026-10-08 ("yes start, sub agent") after: de-scope of forgot/reset (deviation 6), no self-demotion, the owner/admin/user model (deviation 7), the login forgot link hidden without SMTP, /init worded "owner". Workspace files: global-constraints.md (controller rulings R1–R6 + the plan's header, Global Constraints, Review Focus, File structure), implementer-contract.md, reviewer-contract.md, re-review-contract.md. Models (plan table): T1 Sonnet/Opus; T2–T6 Opus/Opus; T7 Opus/Sonnet; T8 Opus/Sonnet; scoped re-reviews Sonnet; fix rounds 4–5 Opus; final review + fix wave Opus; fix-wave re-review Sonnet.

Ruling format (ADR-0002, owner 2026-10-08): `Ruling: <decision> — Source: <official doc / reference project> — <cost if wrong>`. A technical ruling without a source is not made; a finding that names a documented route gets that route.

## Pre-flight scan (2026-10-08)

Earlier evidence: tmp/b2-preflight-scan.md (Opus, two-role version, per-task replay: tsc + vitest green after every task), tmp/b2-descope-check.md (Opus, de-scope), tmp/b2-owner-review.md (Opus, owner revision, final-state dry run: tsc clean, vitest 94 files / 1160 tests, oxlint 0, antd lint 0). All their findings were applied to the plan.

### Pairs of tasks sharing a file or an interface

| Tasks | Shared | Produces → consumes | Found |
| --- | --- | --- | --- |
| 1 ↔ 6 | app/api/init/route.ts | T1 inserts `role: 'owner'` in the interim handler; T6 deletes the file | consistent |
| 2 ↔ 3 | **tests**/group-layouts.test.ts | T2 leaves an `it.todo` for the admin gate; T3 replaces it with real cases | consistent; see Ruling P3 |
| 2 ↔ 6 | **tests**/auth-page-layouts.test.ts | T2 creates it; T6 adds the `hasAccounts` mock (block-body beforeEach) | consistent |
| 3 ↔ 4 | app/(admin)/app-management/actions.ts | T3: `requireAdmin`; T4: failure logging through `toActionFailure` | consistent |
| 3 ↔ 4 ↔ 5 | app/(admin)/user-management/page.tsx + **tests**/user-management-page.test.ts | T3 `requireAdminUser`; T4 Step 7 `listUsers(user)` + `currentUserId`; T5 `currentUser={{ id, role }}` | T4's Files block omits the page and its test, its Step 7 and commit include them; Ruling P1 |
| 3, 5, 6, 7 | locales/{en,zh,ar}/translation.json | T3 `common.forbidden`/icon keys; T5 `admin_users.*` role keys + orphans; T6 `init.*` owner rename + `common.network_error_retry` removal; T7 `account.*` | disjoint keys; parity test runs in every `pnpm test` |
| 4 ↔ 6 ↔ 7 | lib/data/users.ts | T4 creates the DAL and keeps `hasUsers`; T6 drops `hasUsers`; T7 adds `changeOwnPassword` | consistent |
| 5 ↔ 7 | e2e/auth.spec.ts | T5 seeds the reset test through `seedUser` and drops the `ADMIN_STATE` import; T7 rewrites the login-link test with `e2eEnv` (already imported) | consistent |
| 1 → 2, 3, 4, 5 | lib/auth/roles.ts | `ROLES`, `Role`, `isRole`, `hasAdminRights`, `MANAGEABLE_ROLES`, `canManage` | names agree (owner review §3) |
| 2 → 3–7 | lib/auth/session.ts | `requireAdminUser`, `requireAdmin`, `assertAdmin`, `requireActor`, `SessionUser.role` | names agree |
| 3 → 5, 7 | e2e/fixtures/users.ts | `seedUser` (deletes a leftover first), `signInAs`, `deleteUsersLike` | consistent |
| 4 → 5, 6, 7 | lib/auth/fields.ts, lib/action-failure.ts, users DAL helpers | fields, `invalidInput`, `toActionFailure`, `logActionError`, `isDuplicateEntry`, `Tx` | consistent |
| 5 → 6, 7 | hooks/use-action-transition.ts | `useActionTransition` (`git mv` in T5) | consistent |

### Each task against itself

| Task | Tests vs code, files created vs touched | Found |
| --- | --- | --- |
| 1 | roles/schema tests match the code; Step 5 seeds three accounts at B1 state, Step 6 checks the backfill, Step 7 `down` then setup | consistent |
| 2 | jwt/session tests match; `data-apps-sync.test.ts` fixture role named | consistent |
| 3 | two new cases pass before the change (named as regression pins in Step 2) | consistent |
| 4 | rank tests (incl. row-decides) vs DAL; Files block vs Step 7 | Ruling P1 |
| 5 | drawer/table code vs e2e locators (owner review §5) | consistent |
| 6 | setup DAL + action + api-routes test red→green; owner wording table vs auth.setup labels | consistent |
| 7 | login page test mocks `@/lib/mail`; form hides the link; e2e uses `.env.e2e`'s `SMTP_ENABLED=false` | consistent |
| 8 | records only | consistent |
| 9 | controller task | n/a |

### Rulings

- Ruling P1: Task 4's Files block omits `app/(admin)/user-management/page.tsx` and `__tests__/user-management-page.test.ts`, but its Step 7 and its commit include both — the steps govern, and the brief says so in the dispatch — cost if wrong: none beyond a reviewer note.
- Ruling P2: the owner revision was dry-run in its final state only; the per-task replay was done on the two-role version — accept, each task's own gates (tsc, vitest, specs) catch an intermediate break — cost if wrong: one fix round on the task that breaks.
- Ruling P3: Task 2 commits an `it.todo` that Task 3 replaces in the next commit — keep it, it marks the hand-over and asserts nothing false — cost if wrong: a Minor reviewer note.

## Progress

- Task 0 (plan commit, controller): 533bfb37 docs(backend): B2 accounts and admin plan — hook reformatted the plan (4477→4679 lines); briefs extracted from the committed file. BASE for Task 1 = 533bfb37.
- Task 1: dispatched implementer (Sonnet) agent a823435775cc44375, BASE 533bfb37, brief task-1-brief.md, report task-1-report.md
- Task 1: implementer DONE, commit 012f2e56 (vitest 84 files/1058 tests, setup project owner); review (Opus) dispatched agent ab74d3b16252b8f87 on review-533bfb37..012f2e56.diff
- Task 1: review (Opus) Approved, spec ✅, 0 Critical/Important, 1 Minor (plan-mandated).
- Task 1: Ruling: migration keeps ALTER + backfill in one folder (plan layout); a crash between the ALTER's implicit commit and the migration record leaves the entrypoint failing on re-run (ER 1060). Not split into a --custom migration — the window is milliseconds on a one-row table, the failure is loud, and every earlier multi-statement migration has the same exposure. Instead Task 8 records the correct recovery in ADR-0024 (ALTER TABLE users DROP COLUMN role; then restart so the whole migration re-runs; re-running the UPDATEs alone does not unblock the entrypoint) — cost if wrong: one manual DB step after a rare crash.
- Task 1: ⚠️ carried to Task 2's review: canManage(MANAGEABLE_ROLES[actor]) throws on a non-Role at runtime (fails closed); Task 2's verifySession must narrow role with isRole before Tasks 3–4 call it.
- Task 1: ⚠️ migration on a copy of the owner's DB = Task 9 Step 4.
- Task 1: complete (commits 533bfb37..012f2e56, review clean)
- Task 2: dispatched implementer (Opus) agent a23e17d45fb7eb004, BASE 012f2e56, brief task-2-brief.md, report task-2-report.md
- Task 1: Ruling (REVISED, owner reminder 2026-10-08 "follow docs, standards, and popular repos"): the earlier ruling (keep the backfill in the ALTER migration, record a manual recovery) is withdrawn. The backfill moves to its own Drizzle custom migration (`drizzle-kit generate --custom --name=b2-users-role-backfill`; Context7 /drizzle-team/drizzle-orm-docs kit-custom-migrations / drizzle-kit-generate: "empty SQL migration file … custom DDL or data seeding statements"; same split as Django's data migrations). The ALTER migration then commits with its record; only the idempotent UPDATEs re-run after a crash. Runs as Task 1 fix round 1 after Task 2 commits (no concurrent commits in one checkout) — cost if wrong: one extra migration folder.
- Task 2: implementer DONE, commit 592531dd (vitest 84 files/1070 + 1 todo; Playwright auth/smoke/shell/ssr 91 passed, 3 skipped by project guards); 1 comment-only deviation; R0 sources cited. Concern for Task 8: Next's auth guide advises keeping PII (email) out of the session token; next-auth v4 carries email in its encrypted JWT by default and decision a only keeps it current — ADR-0024 gets a line.
- Task 2: review (Opus) dispatched agent a71be58554992ffc9 on review-012f2e56..592531dd.diff
- Task 1: fix round 1/5 dispatched (resumed Sonnet implementer a823435775cc44375): split backfill into `--custom` migration b2-users-role-backfill, test first, crash simulation on e2e DB; FIX_BASE 592531dd
- Task 1: fix round 1 implementer DONE, commit eecee31b (vitest 1071 + 1 todo; crash simulation: only backfill re-ran; migrator identifies applied migrations by name); scoped re-review (Sonnet) dispatched agent a3f900bcb4c2c12d8 on review-592531dd..eecee31b.diff
- Task 1: fix round 1/5 (1 addressed, 0 open — backfill moved to the custom migration 20261008130753_b2-users-role-backfill; commits 592531dd..eecee31b)
- Task 1: minor (deferred): a hard crash between the ALTER and its record insert inside drizzle's migrator still leaves the ALTER unrecorded (inherent to the migrator, far narrower than before) — for ADR-0024's migration note (Task 8).
- Task 1: complete (commits 533bfb37..eecee31b, review clean after fix round 1)
- Task 2: review (Opus) Approved, spec ✅, 0 Critical/Important, 2 Minor with documented routes → fix round per R0: (1) session callback `token.name ?? session.user.name` keeps a cleared name — Source: next-auth callbacks docs (forward token data explicitly); (2) jwt query predicate unpinned — Source: drizzle.mock() + .toSQL().
- Task 2: ⚠️ for Task 9: a cookie issued before B2 upgrading on first use is unit-tested only — exercise at the Docker gate with a browser session signed in before the rebuild.
- Task 2: ⚠️ for Tasks 5 and 7: the client session's `role` (useSession) is typed but not narrowed; never pass it to canManage — use the server's requireAdminUser() result (Task 5 does).
- Task 2: ⚠️ app/api/users/\*\* still unguarded by role until Task 5 deletes them (branch-internal; nothing ships before the whole branch merges).
- Task 2: fix round 1/5 dispatched (resumed Opus implementer a23e17d45fb7eb004); FIX_BASE eecee31b
- Task 2: fix round 1 commit d1270a77 (both findings; 1 test-expectation deviation: token in 'sets user.id and user.role only…' now carries email); extended in the same round: pin authorizeCredentials' lookup by email (implementer's concern; same documented route)
- Task 2: fix round 1 addendum commit 18c12920 (authorize lookup pinned: where `users`.`email` = ?). Implementer corrected the controller: options.ts does not normalize the email.
- Task 2: Ruling: no email normalization in authorizeCredentials — Source: users.email is utf8mb4_0900_ai_ci (checked on the e2e DB; MySQL 8.4 manual, "Unicode Character Sets": \_ai_ci = accent- and case-insensitive comparison) so the lookup and the unique index already ignore case; NO PAD keeps spaces significant, and the login form's antd `type: 'email'` rule and B2's z.email() fields refuse whitespace — cost if wrong: a sign-in typed with stray spaces is refused.
- Task 2: fix round re-review (Sonnet) dispatched agent aa4b0862f0f369fc5 on review-eecee31b..18c12920.diff
- Task 2: fix round 1/5 (3 addressed, 0 open — cleared name forwarded as null; jwt lookup pinned by id; authorize lookup pinned by email; commits eecee31b..18c12920)
- Task 2: minor (deferred): no test for a token with id+role but no email (unreachable: next-auth's default token carries the email and the jwt callback overwrites it from the row).
- Task 2: complete (commits 012f2e56..18c12920, review clean after fix round 1; note: Task 1's fix eecee31b sits inside this range)
- Task 3: dispatched implementer (Opus) agent a48c6f05a59da1a38, BASE 18c12920, brief task-3-brief.md, report task-3-report.md
- Task 3: implementer DONE, commit 83c7ab36 (vitest 84 files/1087; Playwright roles/admin-apps/chat-feedback/smoke 82 passed, 3 skipped by viewport guards); concerns: 404-vs-403 order on annotation routes (no new disclosure until B3); stale comment e2e/auth.setup.ts:44 (Task 6 rewrites that file)
- Task 3: review (Opus) dispatched agent aa7fd54f138c07aa0 on review-18c12920..83c7ab36.diff
- Task 3: review (Opus) Approved, spec ✅, 0 Critical/Important, 4 Minor → fix round per R0 for the documented routes: (2) forbidden envelope defined twice → one definition in lib/dify/errors.ts, re-exported from route.ts; (4) DAL refusal tests can reach the network → vi.stubGlobal('fetch') + not.toHaveBeenCalled (Vitest "Mocking globals"); (1) report accuracy + (3) two wrong citations → corrected in the report.
- Task 3: for Task 8 follow-ups: dev-only "[browser] Uncaught TypeError: Failed to execute 'measure' on 'Performance': '​Home' cannot have a negative time stamp" on every form sign-in without callbackUrl (app/page.tsx Home redirect during client navigation; recorded earlier only in the 2026-10-07 handoff).
- Task 3: fix round 1/5 dispatched (resumed Opus implementer a48c6f05a59da1a38); FIX_BASE 83c7ab36
- Task 3: fix round 1 commit 13289e13 (vitest 1088; forbiddenResponse defined once in errors.ts; fetch stubbed in DAL refusal tests; report corrected)
- Task 3: fix round re-review (Sonnet) dispatched agent aa7e5afcd53634430 on review-83c7ab36..13289e13.diff
- Task 3: fix round 1/5 (4 addressed, 0 open — envelope defined once; fetch stubbed; report corrected; citations fixed; commits 83c7ab36..13289e13)
- Task 3: minor (deferred): task-3-report's top sections keep the original claims, corrected only in its Fix round 1 section (workspace-only file).
- Task 3: complete (commits 18c12920..13289e13, review clean after fix round 1)
- Task 4: dispatched implementer (Opus) agent ae225b9056fc9041b, BASE 13289e13, brief task-4-brief.md, report task-4-report.md (Ruling P1 carried)
- Task 4: implementer DONE_WITH_CONCERNS, commit d084069c (vitest 89 files/1152); concern: describeError reads code only with errno, so mysql2 connection-lost/timeout/protocol errors (code, no errno) log code: undefined — sent to the reviewer to judge
- Task 4: review (Opus) dispatched agent a133e58bb33fd145c on review-13289e13..d084069c.diff (with the describeError concern)
- Task 4: review (Opus) Needs fixes, spec ✅, 1 Important (plan-mandated) + 2 Minor.
- Task 4: Ruling: describeError's DrizzleQueryError branch reads the cause's code and errno whenever present (string code guard), the raw branch keeps its errno gate — Source: mysql2 typings QueryError.code ("Either a MySQL server error …, a node.js error (e.g. 'ECONNREFUSED') or an internal error (e.g. 'PROTOCOL_CONNECTION_LOST')"), Node errors doc ("error.code is the most stable way to identify an error"), drizzle-orm mysql-core/session.js wraps the executor error as DrizzleQueryError cause — cost if wrong: none (codes are fixed identifiers, no params logged).
- Task 4: Minor fixes taken per R0: rank fake's `for(strength)` rejects anything but 'update' (Drizzle LockStrength, MySQL "Locking Reads"); admin-session self-refusal case in the rank test.
- Task 4: ⚠️ for Task 5's review: confirm admin-users e2e covers an edit hitting a duplicate email and a delete against real MySQL (updateUser/deleteUser transactions run only there).
- Task 4: fix round 1/5 dispatched (resumed Opus implementer ae225b9056fc9041b); FIX_BASE d084069c
- Task 4: fix round 1 commit 941b86ca (vitest 89 files/1155; mutation checks: .for('share') fails 10, self-row rule removal fails 2)
- Task 4: fix round re-review (Sonnet) dispatched agent aeebe1b931a2ade09 on review-d084069c..941b86ca.diff
- Task 4: fix round 1/5 (3 addressed, 0 open — DrizzleQueryError cause code/errno logged with type guards; lock strength pinned; admin self-refusals pinned; commits d084069c..941b86ca). Controller checked mysql2 sets `code` only to fixed identifiers (packets/packet.js asError: ErrorCodeToName; base/connection.js: PROTOCOL_CONNECTION_LOST, ETIMEDOUT, PROTOCOL_ERROR).
- Task 4: complete (commits 13289e13..941b86ca, review clean after fix round 1)
- Task 5: Ruling: add one e2e step to admin-users.spec.ts — editing a user's email to one another seeded account holds answers "This email is already in use" — Source: the plan's Global Constraints put real-SQL coverage in e2e; Task 4's DAL comment says updateUser's transaction runs only there; the existing CRUD test covers the duplicate only on add — cost if wrong: one extra e2e step (~seconds per project).
- Task 5: dispatched implementer (Opus) agent aaaf0de6fb470a4c9, BASE 941b86ca, brief task-5-brief.md, report task-5-report.md (carries: server currentUser not client role; the edit-to-duplicate-email e2e step)
- Task 5: implementer DONE_WITH_CONCERNS, commit 115516d2 (vitest 88 files/1160; Playwright admin-users/auth/admin-apps 82 passed, 3 skipped by viewport guards; users spec 3× green on mobile). Deviations: openUsers helper waits for hydration (a rendered date) before the first click — Playwright "Navigations > Hydration"; dup-email-on-edit as its own test with reload + nothing-written check.
- Task 5: for Task 8 follow-ups: clicks right after goto race hydration in other specs too; Playwright docs put the real fix in the product (disable controls until hydrated).
- Task 6 note: tsconfig includes .next/dev/types (written by next dev; Next CLI docs: typegen writes <distDir>/types, typically .next/dev/types in dev or .next/types in production); after deleting routes, run the task's Playwright step (starts next dev, regenerates them) before the tsc gate.
- Task 5: review (Opus) dispatched agent ac0ccdb38f3690f1e on review-941b86ca..115516d2.diff
- Task 5: review (Opus) Approved, spec ✅, 0 Critical/Important, 6 Minor.
- Task 5: Ruling: openUsers (test-side hydration wait) stays for B2, its comment states that Playwright's documented fix is product-side ("make sure that all the interactive controls are disabled until after the hydration", Playwright docs, Navigations > Hydration); the product change alters a pattern on every server-rendered admin page, which CLAUDE.md routes through an ADR and the owner's yes — surfaced to the owner, recorded as a follow-up (Task 8) — Source: Playwright docs; CLAUDE.md "Decisions and handoffs (ADR-0015)" — cost if wrong: other specs keep the hydration race until the product fix lands.
- Task 5: fix round 1/5 dispatched (resumed Opus implementer aaaf0de6fb470a4c9): helper comment; refused edit also changes the Name and asserts it unchanged after reload; titles "the owner …"; afterEach via deleteUsersLike. Deferred minor: no e2e for an admin's own row / an admin editing a user row (server side pinned by Task 4's matrix). FIX_BASE 115516d2
- Task 5: fix round 1 commit 2309c91d (users spec 22 passed on 3 projects; mutation: name saved before the email check fails the new assertion)
- Task 5: fix round re-review (Sonnet) dispatched agent abf60d506f77f1ba8 on review-115516d2..2309c91d.diff
- Task 5: fix round 1/5 (4 addressed, 0 open — openUsers comment names the product-side fix; refused edit pins "Kept name"; titles say owner; afterEach via deleteUsersLike; commits 115516d2..2309c91d)
- Task 5: complete (commits 941b86ca..2309c91d, review clean after fix round 1)
- Task 6: dispatched implementer (Opus) agent a0a64f51bdfaa32cd, BASE 2309c91d, brief task-6-brief.md, report task-6-report.md (carries the .next/dev/types note)
- Task 6: implementer DONE_WITH_CONCERNS, commit a72f5fbe (vitest 91 files/1161; Playwright auth/smoke/ssr/shell 91 passed, 3 skipped; first run from empty → one owner via /init; race probe: RR → one owner + 1213 deadlock, RC → two owners). Concerns: stale comment e2e/auth.spec.ts:49 (→ Task 7, which edits that file); /login errors when MySQL is down (layout reads the DB); /init setup step has no hydration wait; no unit pin of isolationLevel.
- Task 6: review (Opus) dispatched agent a2cd4d5f18db69c89 on review-2309c91d..a72f5fbe.diff
- Task 6: review (Opus) Needs fixes, spec ✅, 1 Important (no unit test of createOwner's branches or its isolationLevel) + 6 Minor.
- Task 6: fix round 1/5 dispatched (resumed Opus implementer a0a64f51bdfaa32cd): createOwner tests (pre-check, locked re-check, RR config + owner insert, ER_DUP_ENTRY → forbidden, other errors rethrown); init name rule `whitespace: true` (antd Form Rule "whitespace"); auth.setup starts at /login (charter §4.2/§4.6 flow end to end). FIX_BASE a72f5fbe
- Task 6: for Task 8 (ADR-0024): MySQL down → /login renders (auth)/error.tsx; not a regression (old proxy redirected to /init whose page threw); a fresh install no longer sends /forgot-password and /reset-password to /init (harmless, R2 keeps those layouts).
- Task 6: for Task 8 follow-ups: e2e/auth.setup.ts and signInAs click right after goto (hydration; a setup flake skips every project) — same product-side fix as Task 5's.
- Task 6: for Task 7: reword e2e/auth.spec.ts:49 comment (the suite's database holds the owner, created through the /init form).
- Fix wave candidate: users drawer name rule lacks `whitespace: true` (components/admin/users/user-form-drawer.tsx; antd Rule whitespace).
- Task 6: fix round 1 commit 229323c6 (vitest 91 files/1166; each createOwner guard removed in turn fails its own case; Playwright auth+smoke 34 passed from empty and set up)
- Task 6: fix round re-review (Sonnet) dispatched agent a94e16414e5ed9618 on review-a72f5fbe..229323c6.diff
- Task 6: fix round 1/5 (3 addressed, 0 open — createOwner tests a–e with removal runs; whitespace rule; setup starts at /login; commits a72f5fbe..229323c6)
- Task 6: complete (commits 2309c91d..229323c6, review clean after fix round 1)
- Task 7: Ruling: reviewer upgraded Sonnet → Opus — Source: kick-off handoff ("the reviews of the riskiest tasks on Opus"); SDD skill Model Selection (scale the review model to risk); Task 7 verifies the current password and revokes every session (Review Focus 5) — cost if wrong: a pricier review.
- Task 7: dispatched implementer (Opus) agent aa4a5eaaa837d2faf, BASE 229323c6, brief task-7-brief.md, report task-7-report.md (carries the auth.spec.ts:49 comment reword)
- Task 7: implementer DONE_WITH_CONCERNS, commit fbfbe81c (vitest 94 files/1177; Playwright six specs 92 passed, 11 skipped by spec conditions; account.spec on 3 projects). Deviations: Modal confirmLoading (antd async demo); auth.spec comment reworded. Concerns: changeOwnPassword read-then-write without lock (last write wins vs a concurrent admin set; both bump sessionVersion); confirm validator double error on empty (antd register demo guards with !value); login comment cites ADR-0024 (Task 8).
- Task 7: review (Opus) dispatched agent acfd13248176647ef on review-229323c6..fbfbe81c.diff
- Task 7: review (Opus) Needs fixes, 1 Important (plan-mandated: changeOwnPassword verifies against an unlocked read; a concurrent admin reset can be overwritten by the old password's holder) + 3 Minor.
- Task 7: Ruling: Option B — unlocked read + verify as the fast refusal, hash the new password, then a short transaction with a locking read on the primary key; refuse with invalid_input/currentPassword when the locked hash differs from the verified one, else update with sessionVersion + 1 — Source: MySQL 8.4 "Locking Reads"; plan decision d (lock held for the queries only); Drizzle transaction + .for('update') as lockTarget — cost if wrong: a password change racing an admin reset is refused and must be retried.
- Task 7: Minor taken in the fix round: confirm validator `!value` guard (antd demo Form register); stronger sessionVersion/where assertions via drizzle.mock().
- Fix wave candidates: init-form confirm validator `!value` guard (same antd demo); next.config.ts `logging: { serverFunctions: false }` — Next 05-config/01-next-config-js/logging.md: Server Function calls are logged with their arguments in development, so passwords print in the next dev terminal (createOwnerAction, createUserAction, updateUserAction, changePasswordAction).
- Task 9 owner browser check: open "Change password" from the mobile chat drawer's account menu (conversation-drawer.tsx) once.
- Task 7: fix round 1/5 dispatched (resumed Opus implementer aa4a5eaaa837d2faf); FIX_BASE fbfbe81c
- Task 7: fix round 1 commit e4b3a162 (vitest 1179; lock without re-check fails the race case; .for('share') fails 3; account.spec 4 passed)
- Task 7: fix round re-review — Ruling: on Opus (concurrency fix; SDD Model Selection: a subtle concurrency change takes the most capable model) — dispatched agent a81c0e0902bb76e6b on review-fbfbe81c..e4b3a162.diff
- Task 7: fix round 1/5 (3 addressed, 0 open — locked re-check closes the race for all three password writers; confirm guard; SQL-rendered sessionVersion/where assertions; commits fbfbe81c..e4b3a162)
- Task 7: minor (deferred): the password test stub's update() drops the table argument (renderUpdate supplies users itself); optional hardening.
- Task 7: complete (commits 229323c6..e4b3a162, review clean after fix round 1)
- Task 8: dispatched implementer (Opus) agent a50bfb87bd88bcd98, BASE e4b3a162, brief task-8-brief.md + task-8-carry.md, report task-8-report.md
- Task 8: implementer DONE_WITH_CONCERNS, commits 3c8c0c47 (records) + ff5a9914 (CII); 5 deviations (ADR numbering via scratch; extra stale CLAUDE.md lines fixed; heading; paraphrase; follow-ups.md in the records commit). Concerns: CII summary 28/35 vs tables 24✅/6⚠️/5❌ (pre-B2); reset handler also logs raw errors (recorded); decision k scope; gh -R claim backed by gh source.
- Task 8: review (Sonnet) dispatched agent a74d6a9f4b4ae49d6 on review-e4b3a162..ff5a9914.diff
- Task 8: review (Sonnet) Approved, spec ✅, 0 Critical/Important, 4 Minor → fix wave (R0): cite sources for decisions e, h, i and f's "bcrypt reads only 72 bytes" (bcryptjs README); reword the Home/Performance.measure cause as noted in the 2026-10-07 handoff; optional gh merge.go citation. CII summary count (28/35) does not match its row tables (pre-B2) → fix wave reconciles it in its own `docs: update CII assessment` commit (AGENTS.md requires an accurate assessment).
- Task 8: complete (commits e4b3a162..ff5a9914, review clean; minors to the fix wave)
- Task 9 Step 1: whole-branch review (Opus) dispatched agent acee1b208f2712f52 on review-533bfb37..ff5a9914.diff (17 commits, 109 files); report final-review-report.md
- Task 9 Step 1: whole-branch review (Opus) → With fixes: 0 Critical, 1 Important (I-1 dev Server Function logging prints passwords/API keys), 9 Minor. Re-ran tsc, oxlint (85 files), oxfmt (99), antd lint, 21 B2 vitest files 215/215; all admin entry points gated; rank vs locked row; no DTO/log leaks; migrations by hand OK.
- Task 9: Ruling: M-4 — replace the 128-character password maximum with a 72-byte UTF-8 maximum (reverses plan decision f) — Source: OWASP Password Storage Cheat Sheet (bcrypt: restrict input to 72 bytes), bcryptjs README (72-byte truncation), NIST SP 800-63B (allow at least 64 characters; 72 bytes ≥ 64 ASCII) — cost if wrong: long multibyte passwords are refused instead of silently truncated.
- Task 9: Ruling: M-3 — init form and users drawer validate email with the server's emailField through an antd `validator` rule (antd Form Rule validator) instead of `type: 'email'` — Source: antd Form docs; one validator on both sides — cost if wrong: none beyond the message wording.
- Task 9: Ruling: M-8 — authorizeCredentials catches unexpected DB errors, logs them through logActionError and throws a fixed message, following next-auth v4's documented authorize error contract — Source: next-auth Credentials docs (Context7) — cost if wrong: a DB outage at sign-in shows a generic error.
- Task 9: Ruling: M-9 — changeOwnPassword answers `unauthorized` for a deleted account at either point — Source: the jwt callback revokes a session whose row is gone (decision a) — cost if wrong: none.
- Task 9: triage — deferred minors (Task 1 crash window, Task 2 token test, Task 3 report, Task 5 admin own-row e2e, Task 7 stub) stay follow-ups/no action, per the final review.
- Task 9 Step 2: fix wave (Opus) dispatched with fix-wave-brief.md (I-1, M-1…M-9 incl. M-4 ruling); FIX_BASE ff5a9914
- Task 9 Step 2: fix wave DONE_WITH_CONCERNS, commits 810bb271 81dc62a1 ab088b9f ed5d98c8 808b5a49 d24f251d (vitest 96 files/1203; Playwright auth/admin-users/account/roles 61 passed; next dev log shows no Server Function args). Deviations: current password unbounded (as at sign-in); loginFailureKey for CredentialsSignin vs Default; ADR affected paths/sources; CII change-log row + evidence text. Concerns: no client 255 max on names; import cycle options.ts → action-failure.ts → session.ts → options.ts (function-level uses only).
- Task 9: Ruling: fix-wave re-review on Opus instead of Sonnet — Source: SDD Model Selection (scale the reviewer to risk: sign-in error handling, password rules, an import cycle to judge for the production build) — cost if wrong: a pricier review.
- Task 9 Step 2: fix-wave re-review (Opus) dispatched agent abacef1c580bed426 on review-ff5a9914..d24f251d.diff
- Task 9 Step 2: fix-wave re-review (Opus): all 11 items ADDRESSED, 0 new Critical/Important; 2 new Minor (import cycle options → action-failure → session → options; decision f / CII #28 wording overclaims vs the inherited reset handler) + concern 1 (no client 255 max on names). Out of scope: NIST 800-63B-4 "verify the entire submitted password" vs bcrypt for existing >72-byte passwords (residual, inherent).
- Task 9: Ruling: a short second round on the fix wave for the three documented Minors (R0 outranks the skill's single-wave rule; the owner's ADR-0002) — break the cycle by moving describeError/logActionError to a leaf server-only module (MDN "JavaScript modules" › Cyclic imports: "Move the shared code into a third module"); reword decision f and CII #28 to "set through these three forms"; name fields validate with nameField via an antd validator rule plus a "name too long" key — cost if wrong: one more small round.
- Task 9: fix-wave round 2 dispatched (resumed Opus implementer a2c6e07227f5654f8); FIX_BASE d24f251d
- Task 9 Step 2: fix-wave round 2 DONE, commits ad115fcd e3a0e5dc ea63fe90 67181818 (vitest 96 files/1207; Playwright auth+admin-users 46 passed); lib/error-log.ts leaf module; deviations: CLAUDE.md module list, decision k sentence
- Task 9 Step 2: round-2 re-review (Sonnet) dispatched; Step 3 full e2e from empty started on 67181818 (log tmp/b2-e2e-full.log)
- Task 9 Step 2: fix-wave round 2 re-review (Sonnet): all 3 ADDRESSED, no new breakage (commits d24f251d..67181818). Final review closed.
- Task 9 Step 3: full e2e from empty on 67181818: 465 passed, 19 skipped (spec conditions), 0 failed, 20.4 min, exit 0; e2e DB holds one owner (created through /init on the empty start)
- Task 9 Step 4: migration on a copy of the local DB: users_before 1 → owner 1, oldest_is_owner 1, email_refused 0; both B2 folders recorded; owner-recovery dry run hash_intact 1 (session_version 0→1); b2copy dropped, dump removed, e2e stack down
- Task 9 Step 5: Docker gate PASSED on 67181818: build exit 0 (next build compiled, 7 static pages, no DATABASE_URL); entrypoint migrations applied (both B2 folders); health 200; /apps 307 → /login?callbackUrl=%2Fapps; dify parameters / api/users / api/init/status / api/client/apps → 401 unauthorized envelope; /init 307 → /login; antd-cssinjs 1; forgot link 0; real volume: owner 1; app 119 MiB
- Task 9 Step 6: PR text in tmp/b2-pr.md; memory updated; stopping for the owner (push/PR, ledger commit question, merge options)
- Owner (2026-10-08, after the gates): keep the 72-byte password maximum; commit the run records under docs/superpowers/research/2026-10-07-backend-rework/b2-execution/; asked for an explanation of the hydration fix and for research on email as the Dify user (research dispatched, report tmp/b2-dify-user-identity.md).
