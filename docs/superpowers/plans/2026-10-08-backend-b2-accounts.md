# Backend rework B2 — accounts and admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every account a role (`owner`, `admin` or `user`) that gates the admin surface on the server, with a rank that decides who manages whom (deviation 7); move the app's own account data (users, first run) behind a `server-only` Data Access Layer with thin Server Actions; add the account-menu password change; take the init fetch out of the proxy; and delete the users and first-run Route Handlers, so that `app/api` holds only `auth` (next-auth, plus the forgot and reset password handlers left as they are, deviation 6), `health`, `dify` and `apps/[appId]/icon`.

**Architecture:** `users.role` (a `mysqlEnum` of `owner`, `admin` and `user`; the migration makes the oldest existing account the owner and every other one an admin) travels in next-auth's typed JWT. The `jwt` callback already re-reads the account on every call to re-check `sessionVersion`; it now also refreshes `role`, `email` and `name` from that row, so a demotion or an email change applies on the next request. `lib/auth/roles.ts` holds `hasAdminRights` (the owner or an admin) and the rank map `MANAGEABLE_ROLES` (the owner manages admins and users, an admin manages users). `lib/auth/session.ts` adds `requireAdminUser()` (layouts and pages: an account without admin rights goes to `/apps`), `requireAdmin()` (actions: `AuthError('forbidden')`) and `assertAdmin(actor)` (the DAL's own check). `lib/data/users.ts` and `setup.ts` hold the SQL; their decision rules are pure functions with tests; a users update or delete reads its target under a row lock, and first run creates the owner under a locking read that only an empty table passes. Each route segment's `actions.ts` validates with zod and answers `ActionResult`; the antd forms call the actions through `startTransition` (B1's ruling). The proxy keeps only the optimistic token check, and the login layout sends a fresh install to `/init`.

**Tech Stack:** Next 16.3.4 (Server Actions, `refresh`, `redirect`, `server-only`), next-auth 4.24, Drizzle ORM 1.0.0-rc.3 on MySQL 8.4 (`mysqlEnum`, `.for('update')`, `drizzle-kit generate`/`migrate`), zod 4, React 19.2, antd 6.6, vitest 4 (node), Playwright 1.63 with the stub Dify API. Nothing is added: `bcryptjs` is already a dependency, and the e2e user fixture uses it.

**Spec:** `docs/superpowers/specs/2026-10-07-backend-rework-charter.md`. Read §2 (decisions, not re-opened), §4.2 (data, sessions, roles, actions, first run, proxy), §4.4 (`users`), §4.5 (validation, action results), §4.6 (testing), §5 (the B2 row and its "done when"), §6 (records) first; every task cites its sections. B1's records carry three B2 items and one ruling this plan applies: `docs/superpowers/research/2026-10-07-backend-rework/b1-execution/follow-ups.md` (items tagged "(B2)"), `rulings.md`, and ADR-0023's "Admin actions" Neutral line. The kick-off handoff is `docs/superpowers/handoffs/2026-10-08-backend-b2-kickoff.md`.

**Deviations from the charter text, all deliberate (Task 8 records them in ADR-0024):**

1. **Forms.** §2 and §4.2 say `useActionState`. B1 ruled that admin forms call their Server Action through `startTransition` from antd Form's `onFinish`, because the antd Form owns validation (`.claude/rules/frontend.md`; Next `02-guides/server-actions.md` and `01-getting-started/07-mutating-data.md`: an action invoked from an event handler inside `startTransition`; ADR-0023 "Admin actions"). B2 applies the same ruling to the users drawer, `/init` and the new change-password form, through the shared `hooks/use-action-transition.ts`.
2. **One DAL module without an actor.** §4.2 says every DAL function takes the verified caller first. `lib/data/setup.ts` serves a visitor who cannot have a session: nobody exists before the owner. Its guard is the state it checks in a transaction: the users table is empty. `users.ts` and `apps.ts` keep the actor rule.
3. **"Turned away from every admin action" (§4.6).** Every admin action is pinned in vitest with a `user` session through the real session chain (`getServerSession` mocked, `requireAdmin` real), so a test fails if an action checks only the session. e2e pins the admin pages and the admin-only Dify routes. An action id cannot be addressed from a Playwright test without reading the build's chunks.
4. **`unauthorized` in a form** shows the "session expired" message, as B1's admin forms do (`appErrorKey`), instead of navigating to `/login` as §4.5 says. The next navigation goes there through the layout or the proxy.
5. **Codes for two new refusals, inside §4.5's list.** `/init` after setup answers `forbidden`. A wrong current password answers `invalid_input` with `fieldErrors.currentPassword`, which the form shows on that field. No code is added to `ActionErrorCode`.
6. **Forgot and reset password stay as they are (owner, 2026-10-08).** The hub is an internal app: most accounts will come from LDAP (B3) and need no reset, and the few local accounts are created by the owner or an admin. SMTP stays unused, a future feature (owner, 2026-10-08). So B2 leaves out §4.2's `lib/data/password-reset.ts` (also in §4.3's tree), its `requestPasswordReset` and `resetPassword` actions, and the deletion of `/api/auth/{forgot,reset}-password` (§4.2 "Actions"), with two of §5's "four forms". §5's "done when" still holds, since both handlers sit under `auth`. §4.6's reuse case stays covered by the existing UI assertion in `e2e/auth.spec.ts`, beside its API one.
   - The pages `/forgot-password` and `/reset-password` and the handlers `app/api/auth/{forgot,reset}-password/route.ts` are not touched. The forgot handler issues a link only with SMTP settings; without them the forgot-password page says mail is not configured, no token is issued, and the reset page has nothing to accept.
   - The login page shows the "Forgot password?" link only when SMTP is configured (Task 7), so without SMTP nobody reaches a page that can only say mail is not set up; the link comes back by itself once SMTP is set (owner, 2026-10-08: SMTP is a future feature).
   - A forgotten local password is set again in the users drawer, by the owner for an admin or a user and by an admin for a user (decision b), which signs that account out everywhere. Nobody sets the owner's password there, so a forgotten owner password is recovered in the database; `docs/auth-gate.md` gives the recipe (Task 8).
   - Moving the two handlers onto the DAL and actions, and the signed-in redirect on `/reset-password`, are recorded as follow-ups (Task 8), not dropped.
7. **Three roles: owner, admin and user (owner, 2026-10-08).** §2, §4.2 and §4.4 name two, `admin` and `user`.
   - The **owner** is the account `/init` creates, exactly one. It has every right, is never deleted, its role never changes, and nobody else edits it. On its own row it edits its name and email; its password changes through the account menu (Task 7).
   - An **admin** has the owner's rights on the admin surface (apps, annotations) and manages `user` accounts. Only the owner creates, edits, promotes, demotes, deletes or sets the password of an admin; an admin edits its own name and email (decision c).
   - A **user** is created, edited, deleted and given a password by the owner or an admin.
   - One rank map decides who manages whom, for the target's current role and for the role being given: `MANAGEABLE_ROLES` in `lib/auth/roles.ts` (owner → admin, user; admin → user; user → none). The owner role is in no list, so nothing but `/init` creates an owner. The shape is documenso's `TEAM_MEMBER_ROLE_HIERARCHY` (`packages/lib/constants/teams.ts`), checked by `isTeamRoleWithinUserHierarchy` (`packages/lib/utils/teams.ts`; both fetched to `tmp/roles-ref/*.ts.txt`). Documenso lets a role manage its own rank; this line manages strictly below it, by the owner's decision.
   - §4.4's backfill differs: every existing account becomes `admin`, then the oldest (the one `/init` created) becomes `owner`, so nobody loses a right on upgrade. The owner's local database holds one test account, which becomes the owner.
   - §4.2's last-admin rule goes: the owner cannot be removed or demoted, so an account with every right always exists. `last_admin` leaves §4.5's codes (`ActionErrorCode`), and the table-wide admin lock goes with it (decision d).

**Decisions this plan adds where the charter is silent (each goes into ADR-0024, Task 8):**

- a. **The `jwt` callback refreshes `role`, `email` and `name`** from the row, in the query that already re-checks `sessionVersion`. The `session` callback forwards them explicitly.
  - A demotion or an email change applies on the next request, and a token issued before B2 gets its role on its first use.
  - Every `getServerSession` runs the `jwt` callback (`node_modules/next-auth/next/index.js:102-129`, `core/routes/session.js:53-66`; checked in the pre-flight review).
  - The Dify `user` (the email, ADR-0006) follows the row. When an admin edits a user's email, that user's conversations stay under the old email and drop out of their chat list from the next request; before B2 that happened at their next sign-in. ADR-0024 and the ADR-0006 note record it.
  - Reference projects read the row on every request too: `nextjs/saas-starter`'s `getUser()`, and `create-t3-app`'s database-session template, whose session callback receives the database user (`docs/superpowers/research/2026-10-07-backend-rework/reference-projects.md` §1, §2).
  - Rejected: role only at sign-in, which keeps a demoted admin's rights until the token expires (30 days).
- b. **Who can set a password.** In the users drawer the owner sets an admin's or a user's password, and an admin a user's (the rank map, deviation 7). Each such password bumps that account's `sessionVersion` (§4.2: "a password change revokes every session"). The drawer offers no password field on your own row, and the DAL refuses one there (`forbidden`), so your own password changes only through the account menu, which asks for the current one.
  - Sources: `02-guides/server-actions.md` "Security" (stronger checks for sensitive changes); `nextjs/saas-starter` `updatePassword` also checks the current password (`app/(login)/actions.ts`, fetched to `tmp/b2probe/web/saas-actions.ts.txt`).
  - saas-starter also refuses a new password equal to the current one; this plan does not.
  - saas-starter does not revoke other sessions; this plan does.
- c. **Your own role is fixed** (owner, 2026-10-08), for the owner and for an admin. The users drawer disables the role field on your own row, and the DAL refuses a change to it (`forbidden`), as it refuses your own password there (decision b). Only the owner changes an admin's role, and the owner's role never changes (deviation 7), so nobody leaves the admin area by a slip of their own.
- d. **Locking.** A users update or delete reads its target inside the transaction with a locking read on the primary key (`SELECT … FOR UPDATE`; MySQL 8.4 Reference Manual, "Locking Reads"), and checks the rank against that row.
  - A concurrent change to the same account waits for the other transaction and then reads its result. When the owner promotes a user while an admin edits that user, the admin's write cannot rest on the stale `user` role.
  - The lock is one row by its primary key, held for the few milliseconds the transaction lasts. Sign-in and the `jwt` query are consistent reads and do not wait.
  - The actor's role comes from the session, which the `jwt` callback refreshes from the row on every request (decision a). An action already running when its actor is demoted finishes with the role it was checked with, as every admin action does.
  - First run takes a locking read of any users row (`SELECT id FROM users LIMIT 1 FOR UPDATE`) and creates the owner only on an empty table. There, two first-run transactions hold compatible gap locks and one is rolled back as a deadlock victim (§17.7.1), which reaches the form as `operation_failed`; at most one owner is created. That gap lock exists only under REPEATABLE READ (under READ COMMITTED InnoDB takes none for the search; MySQL 8.4 "Transaction Isolation Levels"), so the first-run transaction sets `isolationLevel: 'repeatable read'` itself (Drizzle `MySqlTransactionConfig`, `node_modules/drizzle-orm/mysql-core/session.d.ts`) rather than rely on the server's default.
  - No surveyed reference project locks these checks, so the MySQL manual alone settles this.
- e. **Deleting a user deletes their reset tokens** in the same transaction.
- f. **Password fields get a 128-character maximum**, in the zod field and as an antd rule, in the forms B2 moves to actions (users drawer, `/init`, change password; the inherited reset form keeps only its minimum, deviation 6). bcrypt reads only the first 72 bytes; the bound only limits the input.
- g. **Error logging.** `toActionFailure` and the new `logActionError` log a database error by its driver code and errno only. Drizzle's `DrizzleQueryError` message carries the query parameters (`node_modules/drizzle-orm/errors.js`), so a failed users write would log the bcrypt hash, and a failed apps write the API key.
  - This holds in production. In development, `db/index.ts` turns on Drizzle's query logger, which prints every query with its parameters (hashes, keys, reset-token hashes) to the `next dev` console. That is pre-existing and dev-only; ADR-0024 states the scope, and the run's follow-ups record a parameter-free dev logger as a candidate.
- h. **User ids in actions are not checked as UUIDs.** Rows that predate this line's id generator may use another format (the column is `varchar(36)`); an unknown id answers `not_found`. App ids keep B1's strict `z.uuid()`.
- i. **`useActionTransition` moves** from `components/admin/apps/` to `hooks/` (four new consumers outside the apps admin). `getApp` in `lib/data/apps.ts` is deleted (no caller).
- j. **Annotations** (the B1 carry): list, update and delete need admin rights (the owner or an admin, `hasAdminRights`). Create is allowed to an account with admin rights, and to a `user` only when the app's `enableAnnotation` is on (§4.1). The refusal is Dify's envelope `403 forbidden`.
- k. **A stricter email check.** zod 4's `z.email()` refuses an address without a top-level domain (`a@localhost`), which the inherited handlers accepted. antd's `type: 'email'` rule already refused such addresses in the forms. ADR-0024 records it, and Task 9 counts such accounts on the copy of the local database.

## Global Constraints

- **Documented approaches only (ADR-0002).** Name the source of every non-obvious API decision in the task report. Sources:
  - Next's bundled docs `node_modules/next/dist/docs/01-app/`: `02-guides/server-actions.md`, `02-guides/data-security.md`, `02-guides/authentication.md`, `02-guides/forms.md`, `03-api-reference/04-functions/{redirect,refresh}.md`, `03-api-reference/03-file-conventions/proxy.md`;
  - next-auth v4: Context7 `/websites/next-auth_js` (callbacks, Credentials provider, client `signOut`, TypeScript augmentation);
  - Drizzle: Context7 `/drizzle-team/drizzle-orm-docs` and the installed `node_modules/drizzle-orm/mysql-core` (`mysqlEnum`, `.for('update')`, `transaction`, `$onUpdate`, `drizzle.mock()`);
  - zod 4: Context7;
  - antd: the antd CLI (`antd info|demo|doc Form|Modal|Radio|Alert|Table|Popconfirm`, `.claude/skills/antd`);
  - MySQL 8.4 Reference Manual: "Locking Reads"; "UPDATE Statement" (a single-table UPDATE takes ORDER BY and LIMIT); error 1062 `ER_DUP_ENTRY`.

  For an architectural choice the docs leave open, compare it with 2–3 well-known projects on the same stack and cite them beside the docs (CLAUDE.md; the survey `docs/superpowers/research/2026-10-07-backend-rework/reference-projects.md`). No private imports, no `@ts-nocheck`, and a `@ts-expect-error` only with its reason on the line.

- **Versions:** `next` 16.3.4, `next-auth` 4.24, `drizzle-orm` and `drizzle-kit` 1.0.0-rc.3, `zod` ^4, `react` 19.2, `antd` 6.6.5. Nothing is added.
- **Two vocabularies (charter §4.5).**
  - Actions answer `ActionResult` with the codes in `lib/action-result.ts`.
  - The Dify routes answer Dify's envelope. A role refusal there is `{ code: 'forbidden', message: 'Not allowed.', status: 403 }` with status 403 (the body `errorResponseFrom` already gives an `AuthError('forbidden')`).
  - Expected failures never throw out of an action.
  - A `DifyError` inside an action becomes `dify_unreachable`; an unexpected throw becomes `operation_failed`, logged through `logActionError`.
- **Server-only code.** It imports `server-only`. `process.env` is read only in `lib/env.ts` (plus `drizzle.config.ts` and `db/migrate.ts`). DTOs never carry the password hash, `sessionVersion` or an API key. Browser-facing types come only from `lib/dify/types` and the DAL's exported DTO types (`import type`).
- **Database (ADR-0004, AGENTS.md).**
  - Schema changes go through `db/schema/*.ts` + `pnpm db:generate --name <name>` + a hand review of the SQL. Never `drizzle-kit push`.
  - The one B2 migration (Task 1) carries the role backfill.
  - The e2e harness applies migrations itself (`e2e/global-setup.ts`). The dev database is not needed during the run; the owner applies the migration there by hand if they use `pnpm dev`.
- **Language.**
  - No Chinese string remains in the files a task touches; logs are English.
  - Nothing user-facing is a server message, only a code the client translates.
  - New UI text goes through i18next keys present in `locales/en`, `locales/zh` and `locales/ar` (`pnpm test` checks parity; `types/i18next.d.ts` types the keys from `en`). Never run `i18next-cli extract/sync`.
  - Arabic is Modern Standard Arabic and writes digits as the file already does ("8" in `auth.password_min_8`).
  - A key with no remaining reader is removed from all three files.
- **Frontend rules (`.claude/rules/frontend.md`, `docs/frontend-conventions.md`).**
  - antd components first; token-only CSS Modules; `App.useApp()` for messages.
  - A form calls its action from `onFinish` through `useActionTransition` (`hooks/use-action-transition.ts` from Task 5).
  - A Form inside a `destroyOnHidden` Drawer or Modal owns its instance (no parent `Form.useForm()`), or lives in a child component the overlay unmounts. A submit button outside the `<form>` uses `htmlType="submit" form={<id>}`.
  - `npx -y @ant-design/cli lint ./` stays at zero findings.
- **Unit tests.**
  - vitest (node, no DOM) in `__tests__/`. Mock with `vi.hoisted` + `vi.mock`.
  - **Every test of a session-bearing action mocks `next-auth/next`'s `getServerSession` and `@/lib/auth/options`, and keeps `lib/auth/session` real.** The role check is then exercised as shipped, and a test fails if an action calls `requireActor` where it must call `requireAdmin`.
  - DAL rules are pure functions tested without a database; `@/db` is mocked to throw where only the rules run.
- **e2e (ADR-0010).**
  - Web-first assertions; role, label and name locators; never `networkidle`.
  - Every row a spec creates carries the project name (`…-${testInfo.project.name}…`) and is deleted in `finally` or `afterEach`.
  - Accounts are seeded with `e2e/fixtures/users.ts` (a bcrypt hash written to MySQL, Task 3), never through an HTTP route.
  - Run a task's specs with `pnpm exec playwright test e2e/<file>.spec.ts …`, with `pnpm dev` stopped (one `next dev` per checkout).
  - The full suite runs once, in Task 9, from a fresh e2e database.
- **Before every commit:**
  - `pnpm exec next typegen && pnpm exec tsc --noEmit`;
  - `pnpm exec oxlint <changed files>`;
  - `pnpm exec oxfmt --write <changed files>`, then `--check`;
  - `pnpm test`.

  The pre-commit hook (lint-staged) reformats staged Markdown. Never stage `docs/dify-service-api-1.17.1.md`, the B1 charter, plan or research files unless the reformat is intended.

- **Commits.**
  - Conventional (`feat|fix|test|docs|chore(scope): …`), in English.
  - `git add <paths>`, never `-A`. Remove tracked files with `git rm` and move them with `git mv`, which stage the change; `git add -u <path>` fails on a path that is already gone. Before each commit, `git status --short` shows nothing unstaged that belongs to the task, so the commit is as green as the working tree.
  - Both trailer lines go in ONE `-m` argument, after a blank line:

    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn
    ```

  - `.cii-assessment.md` goes in its own `docs: update CII assessment` commit (AGENTS.md).
  - No push and no PR without the owner's word.

- **This machine (~5 GB of memory).**
  - Never run the Docker build and `pnpm test:e2e` at once. Take the old app container down before a build, build in the foreground, and never restart a build that was killed for memory.
  - `AGENTS.md` stays byte-identical. Never read or print `.env` or `.env*.local`.
  - Scratch files go to the repo's `tmp/` (it ignores itself), never `/tmp`. Nothing under `tmp/` may end in `.ts` or `.tsx`: the root `tsconfig.json` includes `**/*.ts`, so a fetched or probe file there fails every task's tsc gate. Save TypeScript scratch as `.ts.txt` or `.mts`.

## Review Focus

Five conditions the charter implies but no feature flow pins on its own. Each has its test in the task named.

1. **A `user` account reaches an admin entry point directly.** Action ids sit in the static JS chunks, a layout does not re-run on client navigation, and the account may be an admin demoted mid-session. Its POST to an admin Server Action, or its call to an admin-only Dify route, must answer `forbidden` / 403 and write nothing; the DAL refuses as well. Tests:
   - Task 2: the `jwt` callback refreshes the role from the row;
   - Task 3: every app action with a `user` session; the apps DAL with a `user` actor; the annotation routes;
   - Task 4: every users action and DAL function;
   - Task 3's `e2e/roles.spec.ts`.
2. **The rank.** An admin calls a users action directly (the drawer hides what it may not do) to create an admin, promote a user, or edit, delete or set the password of another admin or the owner. Anyone tries to change their own role or delete themselves. The owner promotes a user while an admin edits that user. Each refusal answers `forbidden` (or `cannot_delete_self`) and writes nothing, the owner always stays, and a promotion is not overwritten. Tests:
   - Task 4: the full rank matrix of `createRefusal`, `updateRefusal` and `deleteRefusal`; the users actions through the real session chain and the real rules, with an `admin` session against an admin's and the owner's row and with the `owner` session; the row decides, not the input (an admin sending the `user` role for an admin's or the owner's row is refused); the target query's SQL ends in `for update` (`drizzle.mock()`);
   - Task 5 (e2e): an admin sees no Edit or Delete on the owner's or another admin's row and only the User role; the owner's own row has a fixed role and still saves.
3. **A failed users write** (a duplicate email lost to a race, a lost database). It answers `email_in_use` or `operation_failed`, and the server log carries no password hash and no API key. Tests: Task 4 (`isDuplicateEntry`; `describeError` on a `DrizzleQueryError` whose params hold a hash; `toActionFailure` logs only code and errno).
4. **A session the role or email of which changed while it lives.** This covers a token issued before the upgrade (no `role` claim), an admin the owner demotes, and an email the owner or an admin edits. The session keeps working with the row's current role and email; a session whose row is gone, or whose `sessionVersion` moved, is signed out. Tests: Task 2 (`jwt` callback cases) and Task 5's e2e: the owner demotes a signed-in admin, whose next page lands on `/apps`.
5. **Single-use and replay.**
   - `/init` submitted from a stale tab after setup: `forbidden`, then a redirect to `/login`.
   - A password change while another browser is signed in: that browser is signed out at its next page load.

   Tests: Task 6 (the init action passes `forbidden` through; the form maps it), Task 7 (`e2e/account.spec.ts` with a second context).

   The reset link's single use is the inherited handler's, which B2 does not touch (deviation 6); `e2e/auth.spec.ts` keeps covering it.

---

## File structure

```
lib/auth/roles.ts                        ROLES, Role, isRole, hasAdminRights, MANAGEABLE_ROLES, canManage (client-safe) (Task 1)
db/schema/users.ts, db/migrations/<ts>_b2-users-role/   role enum + backfill, updated_at $onUpdate          (Task 1)
types/next-auth.d.ts, lib/auth/options.ts, lib/auth/session.ts   role in User/JWT/Session; authorizeCredentials;
                                         jwt refreshes role/email/name; requireAdminUser/requireAdmin/assertAdmin (Task 2)
app/(admin)/layout.tsx, app/(admin)/*/page.tsx, app/(admin)/app-management/actions.ts, lib/data/apps.ts,
lib/dify/route.ts, app/api/dify/[appId]/apps/annotations/**, components/chat/hooks/dify-errors.ts,
components/admin/apps/app-errors.ts, e2e/fixtures/users.ts, e2e/roles.spec.ts   the role gates            (Task 3)
lib/auth/fields.ts, lib/data/users.ts, lib/action-failure.ts, lib/action-result.ts (no last_admin),
app/(admin)/user-management/{actions,schemas}.ts                                                         (Task 4)
hooks/use-action-transition.ts (moved), components/admin/users/* (role-labels.ts new), app/(admin)/user-management/page.tsx,
app/api/users/** (deleted), e2e/admin-users.spec.ts, e2e/auth.spec.ts (seeding)                          (Task 5)
lib/data/setup.ts (the owner), app/init/{page,actions}.ts(x), components/auth/{init-form,auth-failure}.ts(x),
app/(auth)/login/layout.tsx, proxy.ts, lib/access.ts, app/api/init/** (deleted), e2e/auth.setup.ts,
__tests__/api-routes.test.ts                                                                             (Task 6)
app/actions.ts, lib/data/users.ts (changeOwnPassword), components/shell/{account-dropdown,change-password-modal,account-errors}.ts(x),
app/(auth)/login/page.tsx, components/auth/login-form.tsx, e2e/account.spec.ts                           (Task 7)
docs/decisions/0024-…, notes on 0006/0018/0020/0023, docs/auth-gate.md, CLAUDE.md, docs/frontend-conventions.md,
b1-execution/follow-ups.md, .cii-assessment.md                                                           (Task 8)
whole-branch review, fix wave, full e2e, migration on a copy of the local DB, Docker gate, PR text        (Task 9)
```

## Execution notes (for the controller)

- **Workspace.** `.superpowers/sdd/2026-10-08-backend-b2-accounts/` (git-ignored) holds the contracts adapted from `.superpowers/sdd/2026-10-07-backend-b1-dify-layer/{implementer,reviewer,re-review}-contract.md`: official sources for every API decision and every suggested fix, and 2–3 reference projects for an architectural choice the docs leave open. It also holds a `ledger.md` and a `rulings.md`; Task 9 copies them to `docs/superpowers/research/2026-10-07-backend-rework/b2-execution/`.
- **Per task:**
  - a fresh implementer, given only its task text, the Global Constraints and the implementer contract;
  - a fresh reviewer, with the gates the task states (tsc, oxlint, oxfmt, `pnpm test`, the named e2e specs) and the Review Focus lines the task owns.
- **Models** (owner, 2026-10-08: no Fable; Opus and Sonnet have headroom; name every subagent's model). Pre-flight review, whole-branch review and fix wave on Opus. Per task:

  | Task | Implementer | Reviewer                               |
  | ---- | ----------- | -------------------------------------- |
  | 1    | Sonnet      | Opus (the migration touches real data) |
  | 2    | Opus        | Opus                                   |
  | 3    | Opus        | Opus                                   |
  | 4    | Opus        | Opus                                   |
  | 5    | Opus        | Opus                                   |
  | 6    | Opus        | Opus                                   |
  | 7    | Opus        | Sonnet                                 |
  | 8    | Opus        | Sonnet                                 |

  Scoped re-reviews run on Sonnet. A fix loop that reaches round 4 escalates to Opus.

- **e2e while iterating:** only each task's named specs. The full suite (~19 minutes) runs once, in Task 9.

---

### Task 1: The `users.role` column, its migration and the role vocabulary

Charter §4.2 "Roles", §4.4 "`users` (B2)"; deviation 7.

**Files:**

- Create: `lib/auth/roles.ts`
- Modify: `db/schema/users.ts`
- Modify: `app/api/init/route.ts`, one line. The first account it creates is the `owner`, so a fresh database still gets an account with admin rights until Task 6 replaces this handler. Task 6 deletes the file, so its Chinese strings are exempt from the Language constraint.
- Create (generated, then hand-edited): `db/migrations/<timestamp>_b2-users-role/migration.sql`, `snapshot.json`
- Test: `__tests__/roles.test.ts`, `__tests__/users-schema.test.ts`

**Interfaces:**

- Produces: from `@/lib/auth/roles` (client-safe, no imports):
  - `ROLES` (`readonly ['owner', 'admin', 'user']`)
  - `type Role = 'owner' | 'admin' | 'user'`
  - `isRole(value: unknown): value is Role`
  - `hasAdminRights(who: { role: Role }): boolean` (the owner or an admin: the admin surface)
  - `MANAGEABLE_ROLES: Readonly<Record<Role, readonly Role[]>>` (owner → admin, user; admin → user; user → none)
  - `canManage(actor: Role, target: Role): boolean`

  The column `users.role` (`Role`, not null, default `'user'`). `users.updatedAt` stamped by Drizzle on every update.

- [ ] **Step 0: Commit the approved plan**

The branch `feat/backend-b2-accounts` exists, and its first commit is the kick-off handoff. Commit this plan on its own; the pre-commit hook formats the new Markdown, which is intended.

```bash
git add docs/superpowers/plans/2026-10-08-backend-b2-accounts.md
git commit -m "docs(backend): B2 accounts and admin plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { MANAGEABLE_ROLES, ROLES, canManage, hasAdminRights, isRole } from '@/lib/auth/roles'

describe('roles', () => {
	it('has the three roles of B2 (ADR-0024)', () => {
		expect(ROLES).toEqual(['owner', 'admin', 'user'])
	})

	it('recognises a role and nothing else', () => {
		for (const role of ROLES) expect(isRole(role)).toBe(true)
		for (const value of ['Admin', 'superuser', '', null, undefined, 1])
			expect(isRole(value)).toBe(false)
	})

	it('gives the owner and an admin the admin surface, not a user', () => {
		expect(hasAdminRights({ role: 'owner' })).toBe(true)
		expect(hasAdminRights({ role: 'admin' })).toBe(true)
		expect(hasAdminRights({ role: 'user' })).toBe(false)
	})
})

// ADR-0024: each role manages only the roles below it; the owner role is in no list.
describe('the rank', () => {
	it('lists what each role manages', () => {
		expect(MANAGEABLE_ROLES).toEqual({ owner: ['admin', 'user'], admin: ['user'], user: [] })
	})

	it.each([
		['owner', 'owner', false],
		['owner', 'admin', true],
		['owner', 'user', true],
		['admin', 'owner', false],
		['admin', 'admin', false],
		['admin', 'user', true],
		['user', 'owner', false],
		['user', 'admin', false],
		['user', 'user', false],
	] as const)('%s manages %s: %s', (actor, target, expected) => {
		expect(canManage(actor, target)).toBe(expected)
	})
})
```

Create `__tests__/users-schema.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { users } from '@/db/schema'

describe('users schema', () => {
	it('stores the role as an enum that defaults to user (charter §4.4, ADR-0024)', () => {
		expect(users.role.enumValues).toEqual(['owner', 'admin', 'user'])
		expect(users.role.notNull).toBe(true)
		expect(users.role.default).toBe('user')
	})

	it('stamps updated_at on every update through Drizzle', () => {
		expect(users.updatedAt.onUpdateFn).toBeTypeOf('function')
	})
})

describe('the B2 migration', () => {
	it('adds the column, makes every existing account an admin, then the oldest the owner (ADR-0024: no lock-out on upgrade)', () => {
		const dir = readdirSync('db/migrations').find(name => name.endsWith('_b2-users-role'))
		expect(dir).toBeDefined()
		const sql = readFileSync(path.join('db/migrations', dir!, 'migration.sql'), 'utf8')
		const add = sql.indexOf("ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL")
		const backfill = sql.indexOf("UPDATE `users` SET `role` = 'admin';--> statement-breakpoint")
		const owner = sql.indexOf(
			"UPDATE `users` SET `role` = 'owner' ORDER BY `created_at`, `id` LIMIT 1;",
		)
		expect(add).toBeGreaterThanOrEqual(0)
		expect(backfill).toBeGreaterThan(add)
		expect(owner).toBeGreaterThan(backfill)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/roles.test.ts __tests__/users-schema.test.ts` Expected: FAIL. `@/lib/auth/roles` cannot be resolved; `users.role` is undefined; no `_b2-users-role` folder.

- [ ] **Step 3: Write the role vocabulary**

Create `lib/auth/roles.ts`:

```ts
/**
 * The account roles (charter §4.2 "Roles", ADR-0024): the owner (the account /init creates, exactly one)
 * and an admin run the admin surface, a user chats. Client-safe on purpose: the schema, the zod inputs, the
 * session types and the users table all read it.
 */
export const ROLES = ['owner', 'admin', 'user'] as const

export type Role = (typeof ROLES)[number]

export const isRole = (value: unknown): value is Role =>
	typeof value === 'string' && (ROLES as readonly string[]).includes(value)

/** The admin surface (apps, annotations, the users table): the owner and an admin. */
export const hasAdminRights = (who: { role: Role }): boolean =>
	who.role === 'owner' || who.role === 'admin'

/**
 * Who manages whom: the roles an account of each role may create, edit, delete, give a password to, or give.
 * Strictly below its own rank, and the owner role is in no list, so only /init creates an owner. The shape of
 * documenso's TEAM_MEMBER_ROLE_HIERARCHY (packages/lib/constants/teams.ts), which also lets a role manage its own.
 */
export const MANAGEABLE_ROLES: Readonly<Record<Role, readonly Role[]>> = {
	owner: ['admin', 'user'],
	admin: ['user'],
	user: [],
}

export const canManage = (actor: Role, target: Role): boolean =>
	MANAGEABLE_ROLES[actor].includes(target)
```

The map is typed as a `Record` rather than `as const`, so `canManage` and the drawer's options read it without a cast (checked with `tsc --strict` on a probe in `tmp/owner-probe/`).

- [ ] **Step 4: Add the column**

Replace `db/schema/users.ts` with:

```ts
import { sql } from 'drizzle-orm'
import { datetime, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

import { ROLES } from '@/lib/auth/roles'
import { generateUuidV4 } from '@/lib/helpers'

export const users = mysqlTable(
	'users',
	{
		id: varchar({ length: 36 })
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		name: varchar({ length: 255 }),
		email: varchar({ length: 255 }).notNull(),
		password: varchar({ length: 255 }).notNull(),
		/** ADR-0024: the migration made the oldest existing account the owner and every other one an admin. */
		role: mysqlEnum(ROLES).default('user').notNull(),
		sessionVersion: int('session_version').default(0).notNull(),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [uniqueIndex('users_email_key').on(table.email)],
)
```

Source: Drizzle `mysqlEnum(values)` (installed `node_modules/drizzle-orm/mysql-core/columns/enum.d.ts:43`) and `$onUpdate` (Context7 `/drizzle-team/drizzle-orm-docs`, column definitions). `apps.ts` already uses `$onUpdate` the same way.

- [ ] **Step 5: Generate the migration and add the backfill by hand**

First bring the e2e MySQL to B1's state with three accounts, so Step 6 runs the backfill on several rows. Two share a `created_at`, to exercise the `id` tie-break:

```bash
docker compose -f docker-compose.e2e.yml down
docker compose -f docker-compose.e2e.yml up -d --wait
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "INSERT INTO users (id, name, email, password, created_at) VALUES ('m2', 'Two', 'two@e2e.local', 'x', '2026-01-02 00:00:00'), ('m1b', 'One b', 'one-b@e2e.local', 'x', '2026-01-01 00:00:00'), ('m1a', 'One a', 'one-a@e2e.local', 'x', '2026-01-01 00:00:00');"
```

Then generate:

```bash
pnpm db:generate --name b2-users-role
cat db/migrations/*_b2-users-role/migration.sql
```

Expected: one statement, ``ALTER TABLE `users` ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL;``. `$onUpdate` is ORM-side and generates no SQL. If anything else appears, stop and report it; the schema must not drift.

Append the backfill as the last two statements, so the file reads:

```sql
ALTER TABLE `users` ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL;--> statement-breakpoint
UPDATE `users` SET `role` = 'admin';--> statement-breakpoint
UPDATE `users` SET `role` = 'owner' ORDER BY `created_at`, `id` LIMIT 1;
```

Drizzle's migrator runs each piece between `--> statement-breakpoint` markers as its own statement (`node_modules/drizzle-orm/migrator.js` splits the file on it). A single-table `UPDATE` takes `ORDER BY` and `LIMIT` (MySQL 8.4 Reference Manual, "UPDATE Statement"), so the second picks the oldest account, the one `/init` created; `id` breaks a tie. On an empty table both change nothing, and `/init` creates the owner. DDL auto-commits in MySQL, so a failure after the `ALTER` leaves the column, and re-running the two `UPDATE`s by hand, in order, is safe. Charter §4.4 made every existing account an admin "because every account can run the admin pages today and an upgrade must not lock anyone out"; deviation 7 keeps that (nobody loses a right) and adds exactly one owner.

- [ ] **Step 6: Apply it to the three-account e2e database**

```bash
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "SHOW COLUMNS FROM users LIKE 'role'; SELECT id, role FROM users ORDER BY created_at, id;"
```

Expected: the column is `enum('owner','admin','user')`, `NO` null, default `user`. The rows read `m1a owner`, `m1b admin`, `m2 admin`: the oldest account is the owner, the tie on `created_at` goes to the smaller `id`, and every other account is an admin. On an empty table both `UPDATE`s change nothing; Step 7 starts from empty (`down`) and creates the owner through the setup project.

- [ ] **Step 6b: Keep first run creating the owner until Task 6**

A new account now defaults to `user`. The inherited `/api/init` handler creates the first account, and the e2e setup calls it on an empty database. Without a change, that account would be a `user`, and Task 3's gates would lock the suite's account out. In `app/api/init/route.ts`, the insert becomes:

```ts
await db.insert(users).values({ name, email, password: hashedPassword, role: 'owner' })
```

Nothing else in the file changes; Task 6 deletes it.

- [ ] **Step 7: Run the tests and the gates**

```bash
pnpm exec vitest run __tests__/roles.test.ts __tests__/users-schema.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/auth/roles.ts db/schema/users.ts __tests__/roles.test.ts __tests__/users-schema.test.ts
pnpm exec oxfmt --write lib/auth/roles.ts db/schema/users.ts __tests__/roles.test.ts __tests__/users-schema.test.ts
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test --project=setup
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "SELECT email, role FROM users;"
```

Expected: all PASS. The setup project starts from an empty e2e database, and its account row is `owner`. The pre-commit hook runs oxfmt on staged JSON, so it reformats the generated `snapshot.json`; its content is unchanged (the recorded B1 follow-up about snapshot formatting). `app/api/init/route.ts` is left out of oxfmt and oxlint because Task 6 deletes it.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/roles.ts db/schema/users.ts app/api/init/route.ts db/migrations/*_b2-users-role __tests__/roles.test.ts __tests__/users-schema.test.ts
git commit -m "feat(db): add users.role with a backfill that makes the oldest account the owner and the rest admins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 2: The role in the session — typed next-auth, `authorize` tests, the admin helpers

Charter §4.2 "Session", "Roles"; B1 follow-up "`authorize` gets its tests"; Review Focus 1 and 4.

**Files:**

- Modify: `types/next-auth.d.ts`, `lib/auth/options.ts`, `lib/auth/session.ts`
- Test: `__tests__/auth-options.test.ts`, `__tests__/auth-session.test.ts`, `__tests__/group-layouts.test.ts`, `__tests__/auth-page-layouts.test.ts` (the session mocks gain `role`)

**Interfaces:**

- Consumes: `Role`, `isRole`, `hasAdminRights` (Task 1); `users.role`.
- Produces:
  - `authorizeCredentials(credentials): Promise<User | null>` (exported from `lib/auth/options.ts`);
  - `SessionUser` = `{ id: string; email: string; name: string | null; role: Role }`;
  - `verifySession(): Promise<SessionUser | null>` (null when the session has no valid `role`);
  - `requireAdminUser(): Promise<SessionUser>` (no session → `redirect('/login')`; no admin rights, that is neither the owner nor an admin → `redirect('/apps')`);
  - `assertAdmin(actor: SessionUser): void` (throws `AuthError('forbidden')`);
  - `requireAdmin(): Promise<SessionUser>` (throws `AuthError('unauthorized' | 'forbidden')`).

  `requireUser`, `requireActor`, `redirectSignedInUser`, `getCachedServerSession` and `AuthError` are unchanged.

- [ ] **Step 1: Write the failing tests for the options**

Replace `__tests__/auth-options.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rows, limit } = vi.hoisted(() => {
	const limit = vi.fn()
	return { rows: { value: [] as unknown[] }, limit }
})
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	verifyPassword: (password: string, hash: string) => Promise.resolve(hash === `hash:${password}`),
}))

import type { JWT } from 'next-auth/jwt'

import { authOptions, authorizeCredentials } from '@/lib/auth/options'

type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>
type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>
const jwt = authOptions.callbacks!.jwt as JwtCallback
const session = authOptions.callbacks!.session as SessionCallback

const row = {
	id: 'u1',
	email: 'jane@example.com',
	name: 'Jane',
	role: 'admin',
	password: 'hash:right-password',
	sessionVersion: 3,
}

beforeEach(() => {
	limit.mockReset()
	limit.mockImplementation(() => Promise.resolve(rows.value))
})

describe('authOptions', () => {
	it('uses the JWT strategy and the app login page', () => {
		expect(authOptions.session).toEqual({ strategy: 'jwt' })
		expect(authOptions.pages).toEqual({ signIn: '/login' })
	})
})

// B1 follow-up (follow-ups.md, Tests): nothing called authorize.
describe('authorizeCredentials', () => {
	it('refuses missing credentials without a query', async () => {
		expect(await authorizeCredentials(undefined)).toBeNull()
		expect(await authorizeCredentials({ email: '', password: 'x' })).toBeNull()
		expect(await authorizeCredentials({ email: 'jane@example.com', password: '' })).toBeNull()
		expect(limit).not.toHaveBeenCalled()
	})

	it('refuses an unknown email and a wrong password', async () => {
		rows.value = []
		expect(await authorizeCredentials({ email: 'nobody@example.com', password: 'x' })).toBeNull()
		rows.value = [row]
		expect(
			await authorizeCredentials({ email: 'jane@example.com', password: 'wrong-password' }),
		).toBeNull()
	})

	it('answers the account without its hash, with its role and session version', async () => {
		rows.value = [row]
		expect(
			await authorizeCredentials({ email: 'jane@example.com', password: 'right-password' }),
		).toEqual({
			id: 'u1',
			email: 'jane@example.com',
			name: 'Jane',
			role: 'admin',
			sessionVersion: 3,
		})
	})
})

describe('jwt callback', () => {
	it('copies id, role and sessionVersion into the token at sign-in', async () => {
		const token = await jwt({
			token: {} as JWT,
			user: { id: 'u1', email: 'jane@example.com', name: null, role: 'user', sessionVersion: 3 },
			account: null,
		} as never)
		expect(token).toMatchObject({ id: 'u1', role: 'user', sessionVersion: 3 })
	})

	// Review Focus 4: the row is the truth for what an admin can change while the session lives.
	it('refreshes role, email and name from the row while the version matches', async () => {
		rows.value = [{ sessionVersion: 3, role: 'user', email: 'new@example.com', name: 'New' }]
		const token = await jwt({
			token: {
				id: 'u1',
				sessionVersion: 3,
				role: 'admin',
				email: 'old@example.com',
				name: 'Old',
			} as JWT,
		} as never)
		expect(token).toMatchObject({
			id: 'u1',
			sessionVersion: 3,
			role: 'user',
			email: 'new@example.com',
			name: 'New',
		})
	})

	it('gives a token issued before roles existed its role on first use', async () => {
		rows.value = [{ sessionVersion: 0, role: 'admin', email: 'jane@example.com', name: null }]
		const token = await jwt({ token: { id: 'u1', sessionVersion: 0 } as JWT } as never)
		expect(token).toMatchObject({ id: 'u1', role: 'admin' })
	})

	// ADR-0018's revocation rule: the token loses id, sessionVersion and role; the session callback then sets none.
	it('strips id, sessionVersion and role when the version moved or the user is gone', async () => {
		const signedIn = {
			id: 'u1',
			sessionVersion: 3,
			role: 'admin',
			email: 'jane@example.com',
			name: 'Jane',
		} as JWT
		rows.value = [{ sessionVersion: 4, role: 'admin', email: 'jane@example.com', name: 'Jane' }]
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'jane@example.com',
			name: 'Jane',
		})
		rows.value = []
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'jane@example.com',
			name: 'Jane',
		})
	})

	it('leaves a token without an id alone, without a query', async () => {
		expect(await jwt({ token: { email: 'jane@example.com' } as JWT } as never)).toEqual({
			email: 'jane@example.com',
		})
		expect(limit).not.toHaveBeenCalled()
	})
})

describe('session callback', () => {
	// Review Focus 4: the session's email (the Dify user) is the token's, which the jwt callback refreshed from the row.
	it('forwards the refreshed email and name from the token', async () => {
		const result = await session({
			session: { user: { email: 'old@example.com', name: 'Old' }, expires: '' },
			token: { id: 'u1', role: 'user', email: 'new@example.com', name: 'New' } as JWT,
		} as never)
		expect(result.user).toMatchObject({ email: 'new@example.com', name: 'New' })
	})

	it('sets user.id and user.role only from a token that has both', async () => {
		const withBoth = await session({
			session: { user: { email: 'jane@example.com' }, expires: '' },
			token: { id: 'u1', role: 'user' } as JWT,
		} as never)
		expect(withBoth.user).toMatchObject({ id: 'u1', role: 'user', email: 'jane@example.com' })
		for (const token of [{}, { id: 'u1' }, { role: 'admin' }]) {
			const without = await session({
				session: { user: { email: 'jane@example.com' }, expires: '' },
				token: token as JWT,
			} as never)
			expect(without.user).not.toHaveProperty('id')
			expect(without.user).not.toHaveProperty('role')
		}
	})
})
```

- [ ] **Step 2: Write the failing tests for the session helpers**

In `__tests__/auth-session.test.ts`:

- `live` becomes `{ user: { id: 'u1', email: 'jane@example.com', name: 'Jane', role: 'admin' } }`;
- add `const member = { user: { id: 'u2', email: 'joe@example.com', name: null, role: 'user' } }` and `const owner = { user: { id: 'u0', email: 'owner@example.com', name: 'Owner', role: 'owner' } }`;
- the import list adds `assertAdmin`, `requireAdmin` and `requireAdminUser`;
- `verifySession`'s two success expectations include `role` (the second mocks `{ user: { id: 'u1', email: 'jane@example.com', role: 'admin' } }` and expects `role: 'admin'`).

Then add:

```ts
describe('verifySession and the role', () => {
	it('treats a session without a known role as no session', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await expect(verifySession()).resolves.toBeNull()
		getServerSession.mockResolvedValue({
			user: { id: 'u1', email: 'jane@example.com', role: 'superuser' },
		})
		await expect(verifySession()).resolves.toBeNull()
	})
})

describe('requireAdminUser', () => {
	it('returns the owner or an admin (ADR-0024)', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireAdminUser()).resolves.toMatchObject({ id: 'u1', role: 'admin' })
		getServerSession.mockResolvedValue(owner)
		await expect(requireAdminUser()).resolves.toMatchObject({ id: 'u0', role: 'owner' })
		expect(redirect).not.toHaveBeenCalled()
	})
	it('sends a user-role account to /apps and a visitor without a session to /login', async () => {
		getServerSession.mockResolvedValue(member)
		await expect(requireAdminUser()).rejects.toThrow('NEXT_REDIRECT:/apps')
		getServerSession.mockResolvedValue(null)
		await expect(requireAdminUser()).rejects.toThrow('NEXT_REDIRECT:/login')
	})
})

describe('assertAdmin and requireAdmin', () => {
	it('lets the owner and an admin through', async () => {
		getServerSession.mockResolvedValue(live)
		await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin' })
		getServerSession.mockResolvedValue(owner)
		await expect(requireAdmin()).resolves.toMatchObject({ role: 'owner' })
		expect(() =>
			assertAdmin({ id: 'u0', email: 'owner@example.com', name: null, role: 'owner' }),
		).not.toThrow()
		expect(() =>
			assertAdmin({ id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }),
		).not.toThrow()
	})
	it('throws AuthError(forbidden) for a user-role account and AuthError(unauthorized) without a session', async () => {
		getServerSession.mockResolvedValue(member)
		await expect(requireAdmin()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
		expect(() =>
			assertAdmin({ id: 'u2', email: 'joe@example.com', name: null, role: 'user' }),
		).toThrow(AuthError)
		getServerSession.mockResolvedValue(revoked)
		await expect(requireAdmin()).rejects.toMatchObject({ code: 'unauthorized' })
		expect(redirect).not.toHaveBeenCalled()
	})
})
```

In `__tests__/group-layouts.test.ts`, the live session mock becomes `{ user: { id: 'u1', email: 'jane@example.com', role: 'admin' } }`, and add after the `describe.each`:

```ts
describe('(admin) layout and roles', () => {
	beforeEach(() => {
		getServerSession.mockReset()
		redirect.mockReset()
		redirect.mockImplementation(() => {
			throw redirectSignal
		})
	})

	it('sends a user-role account to /apps (charter §4.2)', async () => {
		getServerSession.mockResolvedValue({
			user: { id: 'u2', email: 'joe@example.com', role: 'user' },
		})
		await expect(AdminLayout({ children: page })).rejects.toBe(redirectSignal)
		expect(redirect).toHaveBeenCalledWith('/apps')
	})

	it('lets a user-role account into the (user) layout', async () => {
		getServerSession.mockResolvedValue({
			user: { id: 'u2', email: 'joe@example.com', role: 'user' },
		})
		expect(await UserLayout({ children: page })).toBe(page)
	})
})
```

In `__tests__/auth-page-layouts.test.ts`, the signed-in mock gains `role: 'admin'`.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/auth-options.test.ts __tests__/auth-session.test.ts __tests__/group-layouts.test.ts __tests__/auth-page-layouts.test.ts` Expected: FAIL. `authorizeCredentials`, `requireAdminUser`, `requireAdmin` and `assertAdmin` are not exported; the token has no `role`; `AdminLayout` does not redirect a user-role account (Task 3 makes that pass; until then that one test fails, which is expected).

- [ ] **Step 4: Type the session**

Replace `types/next-auth.d.ts` with:

```ts
import type { DefaultSession } from 'next-auth'

import type { Role } from '@/lib/auth/roles'

// next-auth v4 module augmentation (TypeScript guide): the top-level import makes this file a module, and
// `& DefaultSession['user']` keeps name, email and image.
declare module 'next-auth' {
	/** What `authorize` returns and the `jwt` callback receives at sign-in. */
	interface User {
		id: string
		role: Role
		sessionVersion: number
	}

	interface Session {
		user: {
			/** Absent for a revoked JWT: the token lost its id (lib/auth/options.ts jwt callback, ADR-0018). */
			id?: string
			/** Absent with the id. */
			role?: Role
		} & DefaultSession['user']
	}
}

declare module 'next-auth/jwt' {
	interface JWT {
		id?: string
		role?: Role
		sessionVersion?: number
	}
}
```

- [ ] **Step 5: Implement the options**

Replace `lib/auth/options.ts` with:

```ts
import 'server-only'

import { eq } from 'drizzle-orm'
import type { NextAuthOptions, User } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

import { getDb } from '@/db'
import { users } from '@/db/schema'

import { verifyPassword } from './password'

/**
 * The credentials check of next-auth's Credentials provider: the account without its hash, or null, which the
 * login form shows as a failed sign-in. Exported for its tests.
 */
export async function authorizeCredentials(
	credentials: Record<'email' | 'password', string> | undefined,
): Promise<User | null> {
	if (!credentials?.email || !credentials?.password) return null
	const [user] = await getDb()
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			password: users.password,
			sessionVersion: users.sessionVersion,
		})
		.from(users)
		.where(eq(users.email, credentials.email))
		.limit(1)
	if (!user) return null
	if (!(await verifyPassword(credentials.password, user.password))) return null
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		sessionVersion: user.sessionVersion,
	}
}

/**
 * next-auth v4 with the credentials provider and the JWT strategy (ADR-0006). The jwt callback reads the account
 * on every call. A changed sessionVersion (a password reset or change) or a deleted row strips `id`,
 * `sessionVersion` and `role`; the session callback then sets no `user.id`, and verifySession() reads that as "no
 * live session" (ADR-0018). Otherwise the row's role, email and name replace the token's. An admin's demotion or
 * email edit applies on the next request, and a token from before roles existed gets its role (ADR-0024).
 */
export const authOptions: NextAuthOptions = {
	providers: [
		CredentialsProvider({
			name: 'credentials',
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' },
			},
			authorize: authorizeCredentials,
		}),
	],
	session: { strategy: 'jwt' },
	pages: { signIn: '/login' },
	callbacks: {
		async jwt({ token, user }) {
			if (user) {
				token.id = user.id
				token.role = user.role
				token.sessionVersion = user.sessionVersion
				return token
			}
			if (!token.id) return token
			const [row] = await getDb()
				.select({
					sessionVersion: users.sessionVersion,
					role: users.role,
					email: users.email,
					name: users.name,
				})
				.from(users)
				.where(eq(users.id, token.id))
				.limit(1)
			if (!row || row.sessionVersion !== token.sessionVersion) {
				const { id: _id, sessionVersion: _version, role: _role, ...rest } = token
				return rest
			}
			token.role = row.role
			token.email = row.email
			token.name = row.name
			return token
		},
		session({ session, token }) {
			if (token.id && token.role) {
				session.user.id = token.id
				session.user.role = token.role
				// Forwarded explicitly (next-auth callbacks docs: token data reaches the session only through this callback):
				// next-auth builds the default user from the decoded token object, which the jwt callback happens to mutate.
				session.user.email = token.email ?? session.user.email
				session.user.name = token.name ?? session.user.name
			}
			return session
		},
	},
}
```

Sources: next-auth `/configuration/callbacks` (the jwt callback runs whenever a JWT is created at sign-in or read on session access, before the session callback; `user` is passed only at sign-in) and `/getting-started/typescript`. The Credentials provider keeps the given `authorize` under `options` (`node_modules/next-auth/providers/credentials.js`), which is why the function is exported for tests instead of read off the provider.

- [ ] **Step 6: Implement the session helpers**

In `lib/auth/session.ts`:

- import `{ hasAdminRights, isRole, type Role } from './roles'`;
- `SessionUser` gains `role: Role`;
- the `AuthError` doc comment reads `/** Thrown by requireActor, requireAdmin and assertAdmin; actions map it to their result code. */`;
- `verifySession` becomes:

```ts
export async function verifySession(): Promise<SessionUser | null> {
	const session = await getCachedServerSession()
	const user = session?.user
	if (!user?.id || !user.email || !isRole(user.role)) return null
	return { id: user.id, email: user.email, name: user.name ?? null, role: user.role }
}
```

Add after `requireUser`:

```ts
/**
 * For the (admin) layout and pages (charter §4.2): an account with admin rights, the owner or an admin; anyone
 * else signed in goes to /apps, a visitor without a live session to /login. Call it outside any try/catch, since
 * redirect() works by throwing.
 */
export async function requireAdminUser(): Promise<SessionUser> {
	const user = await requireUser()
	if (!hasAdminRights(user)) redirect('/apps')
	return user
}
```

and after `requireActor`:

```ts
/**
 * The DAL's own role check (charter §4.2: the entry point verified the session; an admin-only DAL function
 * still refuses an actor without admin rights, the owner or an admin, whoever called it).
 */
export function assertAdmin(actor: SessionUser): void {
	if (!hasAdminRights(actor)) throw new AuthError('forbidden')
}

/** For admin Server Actions: the owner or an admin, or AuthError('unauthorized' | 'forbidden') (Next authentication guide: session, then role). */
export async function requireAdmin(): Promise<SessionUser> {
	const actor = await requireActor()
	assertAdmin(actor)
	return actor
}
```

Fix every compile error tsc reports where a `SessionUser` literal lacks `role`, by adding `role: 'admin' as const`, which matches what those tests exercise. The pre-flight dry run found one: `__tests__/data-apps-sync.test.ts:43`, whose `actor` goes to the typed `syncApp`/`createApp`. Without `as const`, the literal widens to `string` (TS2345). Fixtures handed to untyped `vi.fn()` mocks need nothing.

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run __tests__/auth-options.test.ts __tests__/auth-session.test.ts __tests__/auth-page-layouts.test.ts` Expected: PASS. `__tests__/group-layouts.test.ts` still fails only on "sends a user-role account to /apps" (Task 3). Mark that one test `it.todo` with the comment `// Task 3: the (admin) layout calls requireAdminUser()`, so this commit's `pnpm test` passes; Task 3 turns it back into `it`.

- [ ] **Step 8: Gates and the e2e specs that sign in**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint types/next-auth.d.ts lib/auth/options.ts lib/auth/session.ts __tests__/auth-options.test.ts __tests__/auth-session.test.ts __tests__/group-layouts.test.ts __tests__/auth-page-layouts.test.ts
pnpm exec oxfmt --write <the same files>
pnpm test
pnpm exec playwright test e2e/auth.spec.ts e2e/smoke.spec.ts e2e/shell.spec.ts e2e/ssr-first-paint.spec.ts
```

Expected: all PASS. The e2e account's session gains `role: 'owner'` from its row on its first request (Review Focus 4, live): Task 1's `/api/init` created it as the owner, or the backfill made it the owner as the oldest account.

- [ ] **Step 9: Commit**

```bash
git add types/next-auth.d.ts lib/auth/options.ts lib/auth/session.ts __tests__/auth-options.test.ts __tests__/auth-session.test.ts __tests__/group-layouts.test.ts __tests__/auth-page-layouts.test.ts <any fixture files tsc required>
git commit -m "feat(auth): carry the role in the session and refresh it from the account row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 3: The role gates — admin layout and pages, app actions, the apps DAL, the annotation routes

Charter §4.2 "Roles", §4.1 "Annotations and roles"; B1 follow-ups "creating an annotation gets the role gate and the app's `enableAnnotation`" and "`failureText` gains `forbidden` and `icon_not_found`"; Review Focus 1.

**Files:**

- Modify: `app/(admin)/layout.tsx`, `app/(admin)/app-management/page.tsx`, `app/(admin)/user-management/page.tsx`, `app/(admin)/app-management/actions.ts`, `lib/data/apps.ts`, `lib/dify/route.ts`, `app/api/dify/[appId]/apps/annotations/route.ts`, `app/api/dify/[appId]/apps/annotations/[annotationId]/route.ts`, `components/chat/hooks/dify-errors.ts`, `components/admin/apps/app-errors.ts`, `locales/{en,zh,ar}/translation.json`
- Create: `e2e/fixtures/users.ts`, `e2e/roles.spec.ts`
- Test: `__tests__/group-layouts.test.ts`, `__tests__/app-management-page.test.ts`, `__tests__/user-management-page.test.ts`, `__tests__/app-management-actions.test.ts`, `__tests__/data-apps.test.ts`, `__tests__/data-apps-sync.test.ts`, `__tests__/dify-routes-files.test.ts`, `__tests__/chat-dify-errors.test.ts`, `__tests__/app-errors.test.ts`

**Interfaces:**

- Consumes: `requireAdminUser`, `requireAdmin`, `assertAdmin` (Task 2); `hasAdminRights`, `type Role` (Task 1).
- Produces:
  - `AppAccess.annotationEnabled: boolean` and `DifyRouteContext.annotationEnabled: boolean`;
  - `forbiddenResponse(): Response` from `lib/dify/route.ts`;
  - the i18n keys `common.forbidden`, `chat.error_forbidden`, `chat.error_icon_not_found`;
  - from `e2e/fixtures/users.ts`:
    - `seedUser({ email, password, name?, role?: Role }): Promise<string>` (the id)
    - `deleteUsersLike(pattern: string): Promise<void>`
    - `signInAs(page, email, password): Promise<void>` (lands on `/apps`)

  `getApp` is removed from `lib/data/apps.ts`.

- [ ] **Step 1: Write the failing unit tests**

`__tests__/group-layouts.test.ts`: turn Task 2's `it.todo` back into the `it` it was.

`__tests__/app-management-page.test.ts` and `__tests__/user-management-page.test.ts`: their `@/lib/auth/session` mock provides `requireAdminUser` instead of `requireUser`, and every expectation on `requireUser` names `requireAdminUser`. The "checks the session before it lists" case rejects `requireAdminUser`.

`__tests__/app-management-actions.test.ts`: replace the mocks and the actor set-up with the real session chain:

```ts
const { getServerSession, createApp, updateApp, deleteApp, syncApp, refresh } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	createApp: vi.fn(),
	updateApp: vi.fn(),
	deleteApp: vi.fn(),
	syncApp: vi.fn(),
	refresh: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/apps', () => ({ createApp, updateApp, deleteApp, syncApp }))
vi.mock('next/cache', () => ({ refresh }))
```

`const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'admin' }`, and `beforeEach` resets the six mocks and sets `getServerSession.mockResolvedValue({ user: actor })`. The "answers unauthorized" case sets `getServerSession.mockResolvedValue(null)`; drop the `requireActor` mock and the `AuthError` import if unused. Add:

```ts
// Review Focus 1 and deviation 3: every admin action refuses a user-role session before touching the DAL.
it.each([
	['createAppAction', () => createAppAction(input)],
	['updateAppAction', () => updateAppAction(UUID, input)],
	['deleteAppAction', () => deleteAppAction(UUID)],
	['syncAppAction', () => syncAppAction(UUID)],
] as const)('%s answers forbidden to a user-role account', async (_name, call) => {
	getServerSession.mockResolvedValue({ user: { ...actor, role: 'user' } })
	expect(await call()).toEqual({ ok: false, code: 'forbidden' })
	for (const fn of [createApp, updateApp, deleteApp, syncApp, refresh])
		expect(fn).not.toHaveBeenCalled()
})

// ADR-0024: the owner has the admin surface too (hasAdminRights).
it('lets the owner through as well', async () => {
	const owner = { ...actor, role: 'owner' }
	getServerSession.mockResolvedValue({ user: owner })
	deleteApp.mockResolvedValue(true)
	expect(await deleteAppAction(UUID)).toEqual({ ok: true, data: undefined })
	expect(deleteApp).toHaveBeenCalledWith(owner, UUID)
})
```

`__tests__/data-apps.test.ts`: add (the `@/db` mock already throws when a query runs, which proves the refusal comes first):

```ts
import { createApp, deleteApp, syncApp, updateApp } from '@/lib/data/apps'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }
const appInput = {
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-k',
	mode: 'chat',
	enabled: true,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	},
} as const

// Review Focus 1: the role check comes before Dify and the database (the @/db mock throws on any query).
describe('the apps DAL refuses a non-admin actor before anything else', () => {
	it.each([
		['createApp', () => createApp(member, appInput)],
		['updateApp', () => updateApp(member, 'a1', appInput)],
		['deleteApp', () => deleteApp(member, 'a1')],
		['syncApp', () => syncApp(member, 'a1')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
```

If the file stubs `fetch` for other cases, these cases need no stub, since nothing reaches Dify.

(Merge the import into the file's existing import from `@/lib/data/apps`.)

`__tests__/dify-routes-files.test.ts`:

- `actor` becomes `{ id: 'u1', email: USER, name: null, role: 'admin' }`;
- `access` gains `annotationEnabled: false`;
- add `const member = { ...actor, role: 'user' }` and the cases below. `beforeEach` already resets mocks and resolves `verifySession` with `actor` and `getAppAccess` with `access`; if it does not, set both at the start of each case.

```ts
describe('annotation routes and roles (charter §4.1, §4.2)', () => {
	const forbidden = { code: 'forbidden', message: 'Not allowed.', status: 403 }

	it('refuses list, update and delete to a user-role account without calling Dify', async () => {
		verifySession.mockResolvedValue(member)
		const list = await listAnnotations(new NextRequest(`${base}/apps/annotations`), params())
		const put = await updateAnnotation(
			json('/apps/annotations/ann-1', 'PUT', { question: 'q', answer: 'a' }),
			params({ annotationId: 'ann-1' }),
		)
		const del = await deleteAnnotation(
			new NextRequest(`${base}/apps/annotations/ann-1`, { method: 'DELETE' }),
			params({ annotationId: 'ann-1' }),
		)
		for (const response of [list, put, del]) {
			expect(response.status).toBe(403)
			expect(await response.json()).toEqual(forbidden)
		}
		expect(client.listAnnotations).not.toHaveBeenCalled()
		expect(client.updateAnnotation).not.toHaveBeenCalled()
		expect(client.deleteAnnotation).not.toHaveBeenCalled()
	})

	it('lets a user-role account create an annotation only where the app enables annotations', async () => {
		verifySession.mockResolvedValue(member)
		getAppAccess.mockResolvedValue({ ...access, annotationEnabled: false })
		const refused = await createAnnotation(
			json('/apps/annotations', 'POST', { question: 'q', answer: 'a' }),
			params(),
		)
		expect(refused.status).toBe(403)
		expect(client.createAnnotation).not.toHaveBeenCalled()

		getAppAccess.mockResolvedValue({ ...access, annotationEnabled: true })
		client.createAnnotation.mockResolvedValue({ id: 'ann-1', question: 'q', answer: 'a' })
		const created = await createAnnotation(
			json('/apps/annotations', 'POST', { question: 'q', answer: 'a' }),
			params(),
		)
		expect(created.status).toBe(201)
	})

	it('lets an admin create an annotation whatever the app setting', async () => {
		getAppAccess.mockResolvedValue({ ...access, annotationEnabled: false })
		client.createAnnotation.mockResolvedValue({ id: 'ann-1', question: 'q', answer: 'a' })
		const created = await createAnnotation(
			json('/apps/annotations', 'POST', { question: 'q', answer: 'a' }),
			params(),
		)
		expect(created.status).toBe(201)
	})
})
```

`__tests__/chat-dify-errors.test.ts`: add

```ts
it('maps forbidden and icon_not_found to their keys (B2)', () => {
	expect(failureText(new DifyRequestError(403, 'forbidden', 'Not allowed.'), t)).toBe(
		'chat.error_forbidden',
	)
	expect(failureText(new DifyRequestError(404, 'icon_not_found', 'x'), t)).toBe(
		'chat.error_icon_not_found',
	)
})
```

using the file's existing `t` stand-in and `DifyRequestError` import. Adapt the constructor arguments to the file's existing calls if its signature differs.

`__tests__/app-errors.test.ts`: line 8, `expect(appErrorKey('forbidden', 'sync')).toBe('common.session_expired')`, becomes `.toBe('common.forbidden')`. `appErrorKey('unauthorized', 'save')` stays `'common.session_expired'`.

`__tests__/data-apps-sync.test.ts`: "syncApp reads only the access columns" (line 272) expects `['apiBase', 'apiKey', 'enableAnnotation', 'id', 'isEnabled']`, because `readAccess` gains the annotation switch in Step 4.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/group-layouts.test.ts __tests__/app-management-page.test.ts __tests__/user-management-page.test.ts __tests__/app-management-actions.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-routes-files.test.ts __tests__/chat-dify-errors.test.ts __tests__/app-errors.test.ts` Expected: FAIL on every new case except two regression pins that pass before and after the change: "lets the owner through as well" and "lets an admin create an annotation whatever the app setting". The layout and pages call `requireUser`, the actions call `requireActor`, the DAL writes do not check roles, the routes do not gate, `failureText` passes the message through, and `appErrorKey` maps `forbidden` to `session_expired`.

- [ ] **Step 3: Gate the layout and the pages**

`app/(admin)/layout.tsx`: import and await `requireAdminUser()` instead of `requireUser()`.

`app/(admin)/app-management/page.tsx`: `const actor = await requireAdminUser()`.

`app/(admin)/user-management/page.tsx`: `const user = await requireAdminUser()`. Its `listUsers()` call is unchanged until Task 5.

A page checks again because a layout does not re-render on client-side navigation (ADR-0018; Next `02-guides/authentication.md` "Layouts and auth checks").

- [ ] **Step 4: Gate the app actions and the apps DAL**

`app/(admin)/app-management/actions.ts`: every `requireActor()` becomes `requireAdmin()` (import changed); the module comment's first line reads `Thin Server Actions (charter §4.2): verify the admin, validate, call the DAL, refresh the route …`.

`lib/data/apps.ts`:

- import `assertAdmin` with `SessionUser`;
- `createApp`, `updateApp`, `deleteApp` and `syncApp` rename `_actor` to `actor` and start with `assertAdmin(actor)`, before any Dify or database call;
- `getApp` is deleted (`git grep -n "getApp\b"` shows no caller; decision i);
- `AppAccess` gains `/** The app's annotation switch: a user-role account may create annotations only where it is on (charter §4.1). */ annotationEnabled: boolean`;
- `readAccess` selects `enableAnnotation: difyApps.enableAnnotation` and maps it to `annotationEnabled: row.enableAnnotation`;
- the module comment's last sentence becomes `Admin-only writes check the role themselves (assertAdmin); the reads serve every signed-in user until B3 filters them.`

- [ ] **Step 5: Gate the annotation routes**

`lib/dify/route.ts`:

- `DifyRouteContext` gains `/** The app's annotation switch (AppAccess). */ annotationEnabled: boolean`;
- `resolveDifyRoute` sets `annotationEnabled: app.annotationEnabled`;
- add:

```ts
/**
 * The app's refusal of a signed-in caller whose role does not allow the operation (charter §4.2): the body
 * errorResponseFrom gives an AuthError('forbidden'), checked right after the app (session → app → role → input).
 */
export const forbiddenResponse = (): Response => difyErrorResponse('forbidden', 'Not allowed.', 403)
```

`app/api/dify/[appId]/apps/annotations/route.ts`: import `hasAdminRights` from `@/lib/auth/roles` and `forbiddenResponse` from `@/lib/dify/route`.

- GET: after `if (!resolved.ok) return resolved.response`, add `if (!hasAdminRights(resolved.ctx.actor)) return forbiddenResponse()`, and the doc comment ends "Admin rights only: the owner or an admin (charter §4.1)."
- POST: add `if (!hasAdminRights(resolved.ctx.actor) && !resolved.ctx.annotationEnabled) return forbiddenResponse()`, and its doc comment becomes `POST /apps/annotations: Dify answers 201. The owner or an admin may always create; a user-role account only where the app enables annotations (the chat's "annotate", charter §4.1).`

`app/api/dify/[appId]/apps/annotations/[annotationId]/route.ts`: PUT and DELETE add `if (!hasAdminRights(resolved.ctx.actor)) return forbiddenResponse()` right after the resolve check (before `parsePathParams`), and their comments say "Admin rights only: the owner or an admin (charter §4.1)."

- [ ] **Step 6: The texts for `forbidden`**

`components/chat/hooks/dify-errors.ts`: `APP_CODE_KEYS` gains `forbidden: 'chat.error_forbidden'` and `icon_not_found: 'chat.error_icon_not_found'`. Its doc comment ends `` `forbidden` is a role refusal (B2); `icon_not_found` is the icon route's 404.``

`components/admin/apps/app-errors.ts`: split the shared case so that `unauthorized` returns `'common.session_expired'` and `forbidden` returns `'common.forbidden'`.

Locale keys (`common` and `chat` namespaces, alphabetical position not required):

| key | en | zh | ar |
| --- | --- | --- | --- |
| `common.forbidden` | You do not have permission to do this. | 你没有执行此操作的权限。 | ليست لديك صلاحية للقيام بهذا الإجراء. |
| `chat.error_forbidden` | You do not have permission to do this. | 你没有执行此操作的权限。 | ليست لديك صلاحية للقيام بهذا الإجراء. |
| `chat.error_icon_not_found` | This app has no stored icon. | 此应用没有已保存的图标。 | لا توجد أيقونة محفوظة لهذا التطبيق. |

- [ ] **Step 7: Run the unit tests**

Run the Step 2 command. Expected: PASS. Then `pnpm test`: PASS.

- [ ] **Step 8: The e2e user fixture and the roles spec**

Create `e2e/fixtures/users.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { expect, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'

// Type-only and relative: erased at runtime, so the fixture loads none of the app's modules.
import type { Role } from '../../lib/auth/roles'

import { withDb } from './db'

/**
 * An account written straight to the e2e MySQL with a bcrypt hash (charter §4.6: extra users through the
 * database fixture). Its email must carry the project name, and the spec deletes it in `finally` or `afterEach`.
 * A leftover row with the same email (a run killed before its clean-up) is deleted first, with its reset tokens,
 * so the insert does not hit the unique email index.
 */
export const seedUser = async ({
	email,
	password,
	name = null,
	role = 'user',
}: {
	email: string
	password: string
	name?: string | null
	role?: Role
}): Promise<string> => {
	const id = randomUUID()
	const hash = await bcrypt.hash(password, 10)
	await withDb(async db => {
		await db.execute(
			'DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ?)',
			[email],
		)
		await db.execute('DELETE FROM users WHERE email = ?', [email])
		await db.execute('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', [
			id,
			name,
			email,
			hash,
			role,
		])
	})
	return id
}

/** Deletes the accounts whose email matches a LIKE pattern, and their reset tokens. */
export const deleteUsersLike = (pattern: string) =>
	withDb(async db => {
		await db.execute(
			'DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)',
			[pattern],
		)
		await db.execute('DELETE FROM users WHERE email LIKE ?', [pattern])
	})

/** Signs in through the login form and waits for the landing page. */
export const signInAs = async (page: Page, email: string, password: string) => {
	await page.goto('/login')
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page).toHaveURL(/\/apps$/)
}
```

Create `e2e/roles.spec.ts` (use the `advanced-chat` key of `APP_IDS` for the stub app with `enableAnnotation: true`; check `e2e/fixtures/stub/apps.ts` if the key differs):

```ts
import { expect, test } from '@playwright/test'

import { ADMIN_STATE, APP_ID, APP_IDS } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'user-pass-1'
const forbidden = { code: 'forbidden', message: 'Not allowed.', status: 403 }
/** The spec's account carries the project name (rows survive between runs). */
const emailOf = () => `role-${test.info().project.name}@e2e.local`

test.describe('a user-role account (charter §4.6)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test.beforeEach(async () => {
		await seedUser({ email: emailOf(), password: PASSWORD, name: 'Plain user' })
	})
	test.afterEach(async () => {
		await deleteUsersLike(`role-${test.info().project.name}%`)
	})

	test('is sent from the admin pages to /apps and still reaches a chat', async ({ page }) => {
		await signInAs(page, emailOf(), PASSWORD)
		for (const path of ['/app-management', '/user-management']) {
			await page.goto(path)
			await expect(page).toHaveURL(/\/apps$/)
		}
		await page.goto(`/chat/${APP_ID}`)
		await expect(page.getByPlaceholder('Type a message')).toBeVisible()
	})

	test('is refused by the admin-only annotation routes', async ({ page }) => {
		await signInAs(page, emailOf(), PASSWORD)
		const base = `/api/dify/${APP_ID}/apps/annotations`
		const answers = [
			await page.request.get(`${base}?page=1&limit=10`),
			await page.request.put(`${base}/ann-1`, { data: { question: 'q', answer: 'a' } }),
			await page.request.delete(`${base}/ann-1`),
			// The stub app has annotations off: a user-role account may not create one there.
			await page.request.post(base, { data: { question: 'q', answer: 'a' } }),
		]
		for (const answer of answers) {
			expect(answer.status()).toBe(403)
			expect(await answer.json()).toEqual(forbidden)
		}
	})

	test('may create an annotation where the app enables annotations', async ({ page, browser }) => {
		await signInAs(page, emailOf(), PASSWORD)
		const base = `/api/dify/${APP_IDS['advanced-chat']}/apps/annotations`
		const created = await page.request.post(base, {
			data: { question: `${emailOf()} q`, answer: 'a' },
		})
		expect(created.status()).toBe(201)
		const { id } = (await created.json()) as { id: string }
		// The stub keeps annotations in memory; the admin removes this one so other specs see the list unchanged.
		const admin = await browser.newContext({ storageState: ADMIN_STATE })
		try {
			expect((await admin.request.delete(`${base}/${id}`)).status()).toBe(204)
		} finally {
			await admin.close()
		}
	})
})

// ADR-0024: an admin who is not the owner has the admin surface too. Its own prefix keeps the user-role
// describe's cleanup (`role-<project>%`) from deleting this account.
test.describe('an admin account that is not the owner', () => {
	test.use({ storageState: { cookies: [], origins: [] } })
	const adminEmailOf = () => `roleadmin-${test.info().project.name}@e2e.local`

	test.beforeEach(async () => {
		await seedUser({
			email: adminEmailOf(),
			password: PASSWORD,
			name: 'Plain admin',
			role: 'admin',
		})
	})
	test.afterEach(async () => {
		await deleteUsersLike(`roleadmin-${test.info().project.name}%`)
	})

	test('reaches the admin pages', async ({ page }) => {
		await signInAs(page, adminEmailOf(), PASSWORD)
		for (const path of ['/app-management', '/user-management']) {
			await page.goto(path)
			await expect(page).toHaveURL(new RegExp(`${path}$`))
		}
	})
})
```

- [ ] **Step 9: Run the affected e2e specs**

```bash
pnpm exec playwright test e2e/roles.spec.ts e2e/admin-apps.spec.ts e2e/chat-feedback.spec.ts e2e/smoke.spec.ts
```

Expected: PASS on the three projects. `admin-apps.spec.ts` and `chat-feedback.spec.ts` run as the suite's account, the owner since Task 1.

- [ ] **Step 10: Gates and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <changed files>
pnpm exec oxfmt --write <changed files>
pnpm test
npx -y @ant-design/cli lint ./
git add app/\(admin\)/layout.tsx app/\(admin\)/app-management/page.tsx app/\(admin\)/user-management/page.tsx app/\(admin\)/app-management/actions.ts lib/data/apps.ts lib/dify/route.ts app/api/dify/\[appId\]/apps/annotations components/chat/hooks/dify-errors.ts components/admin/apps/app-errors.ts locales e2e/fixtures/users.ts e2e/roles.spec.ts __tests__/group-layouts.test.ts __tests__/app-management-page.test.ts __tests__/user-management-page.test.ts __tests__/app-management-actions.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-routes-files.test.ts __tests__/chat-dify-errors.test.ts __tests__/app-errors.test.ts
git commit -m "feat(auth): gate the admin surface and the annotation routes by role

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 4: The users Data Access Layer and Server Actions, and failure logging without secrets

Charter §4.2 "Data Access Layer", "Roles", "Actions"; §4.5 "Action results"; §4.6 "The DAL"; deviation 7; decisions b, c, d; Review Focus 1, 2, 3.

**Files:**

- Create: `lib/auth/fields.ts`, `app/(admin)/user-management/actions.ts`, `app/(admin)/user-management/schemas.ts`
- Modify: `lib/data/users.ts` (rewritten; `hasUsers` kept as is until Task 6), `lib/action-failure.ts`, `lib/action-result.ts` (`last_admin` removed), `app/(admin)/app-management/actions.ts` (uses `invalidInput`)
- Test: `__tests__/data-users.test.ts`, `__tests__/data-users-writes.test.ts`, `__tests__/user-management-actions.test.ts`, `__tests__/user-management-rank.test.ts` (new), `__tests__/user-management-schemas.test.ts`, `__tests__/action-failure.test.ts`

**Interfaces:**

- Consumes: `assertAdmin`, `requireAdmin`, `SessionUser` (Task 2); `Role`, `canManage` (Task 1); `hashPassword` (`lib/auth/password.ts`); `ok`, `fail`, `ActionResult`, `ActionErrorCode` (`lib/action-result.ts`).
- Produces:
  - from `lib/auth/fields.ts` (client-safe):
    - `PASSWORD_MIN = 8`, `PASSWORD_MAX = 128`
    - `passwordField`, `emailField`, `nameField` (zod)
  - from `lib/data/users.ts`:
    - types: `UserDto { id; name: string | null; email; role: Role; createdAt: string; updatedAt: string }` and `UserInput { name; email; role; password?: string }`
    - pure functions: `toUserDto`, `createRefusal({ actorRole, role })`, `updateRefusal({ actor, target, input })`, `deleteRefusal({ actor, target })` (each `ActionErrorCode | null`), `isDuplicateEntry`
    - `lockTarget(tx, id)` (the target-row lock, decision d)
    - `listUsers(actor): Promise<UserDto[]>`
    - `createUser(actor, input & { password: string }): Promise<ActionResult<{ id: string }>>`
    - `updateUser(actor, id, input): Promise<ActionResult>`
    - `deleteUser(actor, id): Promise<ActionResult>`
  - from `lib/action-failure.ts`:
    - `describeError(error): unknown`
    - `logActionError(error, context): void`
    - `invalidInput(error: z.ZodError): ActionFailure`
    - `toActionFailure` (unchanged signature)
  - from `app/(admin)/user-management/actions.ts`:
    - `createUserAction(input: unknown): Promise<ActionResult<{ id: string }>>`
    - `updateUserAction(id: string, input: unknown): Promise<ActionResult>`
    - `deleteUserAction(id: string): Promise<ActionResult>`
  - from `schemas.ts`: `userInputSchema`, `createUserInputSchema`, `userIdSchema`, `type UserFormInput`.
  - `ActionErrorCode` without `'last_admin'` (deviation 7).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/data-users.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/mysql2'
import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import {
	createRefusal,
	createUser,
	deleteRefusal,
	deleteUser,
	isDuplicateEntry,
	listUsers,
	lockTarget,
	toUserDto,
	updateRefusal,
	updateUser,
} from '@/lib/data/users'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }
const owner = { id: 'o1', role: 'owner' as const }
const admin = { id: 'a1', role: 'admin' as const }
const otherAdmin = { id: 'a2', role: 'admin' as const }
const user = { id: 'u9', role: 'user' as const }

describe('toUserDto', () => {
	it('passes dates as ISO strings and nothing but the DTO fields', () => {
		const at = new Date('2026-01-15T09:05:00.000Z')
		expect(
			toUserDto({
				id: 'u1',
				name: null,
				email: 'a@b.c',
				role: 'admin',
				createdAt: at,
				updatedAt: at,
			}),
		).toEqual({
			id: 'u1',
			name: null,
			email: 'a@b.c',
			role: 'admin',
			createdAt: '2026-01-15T09:05:00.000Z',
			updatedAt: '2026-01-15T09:05:00.000Z',
		})
	})
})

// ADR-0024: the owner manages admins and users, an admin manages users; nobody gives the owner role.
describe('createRefusal', () => {
	it.each([
		['owner', 'admin', null],
		['owner', 'user', null],
		['owner', 'owner', 'forbidden'],
		['admin', 'user', null],
		['admin', 'admin', 'forbidden'],
		['admin', 'owner', 'forbidden'],
	] as const)('%s giving %s: %s', (actorRole, role, expected) => {
		expect(createRefusal({ actorRole, role })).toBe(expected)
	})
})

describe('updateRefusal (charter §4.2, ADR-0024)', () => {
	it("lets you edit your own name and email only: your role is fixed, your password is the account menu's (decisions b, c)", () => {
		expect(updateRefusal({ actor: owner, target: owner, input: { role: 'owner' } })).toBeNull()
		expect(updateRefusal({ actor: admin, target: admin, input: { role: 'admin' } })).toBeNull()
		expect(updateRefusal({ actor: owner, target: owner, input: { role: 'admin' } })).toBe(
			'forbidden',
		)
		expect(updateRefusal({ actor: admin, target: admin, input: { role: 'user' } })).toBe(
			'forbidden',
		)
		expect(
			updateRefusal({
				actor: owner,
				target: owner,
				input: { role: 'owner', password: 'new-password-1' },
			}),
		).toBe('forbidden')
	})

	it.each([
		[owner, otherAdmin, 'admin', null],
		[owner, otherAdmin, 'user', null],
		[owner, user, 'admin', null],
		[owner, user, 'user', null],
		[owner, user, 'owner', 'forbidden'],
		[admin, user, 'user', null],
		[admin, user, 'admin', 'forbidden'],
		[admin, otherAdmin, 'admin', 'forbidden'],
		[admin, otherAdmin, 'user', 'forbidden'],
		[admin, owner, 'owner', 'forbidden'],
		[admin, owner, 'user', 'forbidden'],
		[admin, owner, 'admin', 'forbidden'],
	] as const)('%j editing %j to %s: %s', (actor, target, role, expected) => {
		expect(updateRefusal({ actor, target, input: { role } })).toBe(expected)
	})

	it('lets a password be set only where the actor manages the account (decision b)', () => {
		const password = 'new-password-1'
		expect(
			updateRefusal({ actor: owner, target: otherAdmin, input: { role: 'admin', password } }),
		).toBeNull()
		expect(
			updateRefusal({ actor: admin, target: user, input: { role: 'user', password } }),
		).toBeNull()
		expect(
			updateRefusal({ actor: admin, target: otherAdmin, input: { role: 'admin', password } }),
		).toBe('forbidden')
		expect(updateRefusal({ actor: admin, target: owner, input: { role: 'owner', password } })).toBe(
			'forbidden',
		)
	})
})

describe('deleteRefusal (charter §4.2: nobody deletes themselves; ADR-0024: the owner stays)', () => {
	it('refuses a self-delete first, and the owner to everyone', () => {
		expect(deleteRefusal({ actor: owner, target: owner })).toBe('cannot_delete_self')
		expect(deleteRefusal({ actor: admin, target: admin })).toBe('cannot_delete_self')
		expect(deleteRefusal({ actor: admin, target: owner })).toBe('forbidden')
	})

	it.each([
		[owner, otherAdmin, null],
		[owner, user, null],
		[admin, user, null],
		[admin, otherAdmin, 'forbidden'],
	] as const)('%j deleting %j: %s', (actor, target, expected) => {
		expect(deleteRefusal({ actor, target })).toBe(expected)
	})
})

describe('isDuplicateEntry (MySQL 1062 ER_DUP_ENTRY)', () => {
	const dup = Object.assign(new Error("Duplicate entry 'a@b.c' for key 'users_email_key'"), {
		code: 'ER_DUP_ENTRY',
		errno: 1062,
	})
	it('recognises the driver error bare and inside DrizzleQueryError', () => {
		expect(isDuplicateEntry(dup)).toBe(true)
		expect(isDuplicateEntry(new DrizzleQueryError('insert …', [], dup))).toBe(true)
	})
	it('ignores anything else', () => {
		expect(isDuplicateEntry(new Error('boom'))).toBe(false)
		expect(isDuplicateEntry(Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }))).toBe(
			false,
		)
		expect(isDuplicateEntry(null)).toBe(false)
	})
})

describe('lockTarget (decision d, Review Focus 2)', () => {
	it('is a locking read of one account by its primary key', () => {
		const query = lockTarget(drizzle.mock(), 'u9').toSQL()
		expect(query.sql).toMatch(
			/^select .* from `users` where `users`\.`id` = \? limit \? for update$/,
		)
		expect(query.params).toEqual(['u9', 1])
	})
})

describe('the users DAL refuses a non-admin actor before any query (Review Focus 1)', () => {
	it.each([
		['listUsers', () => listUsers(member)],
		[
			'createUser',
			() =>
				createUser(member, { name: 'N', email: 'n@e.com', role: 'user', password: 'password-1' }),
		],
		['updateUser', () => updateUser(member, 'u9', { name: 'N', email: 'n@e.com', role: 'user' })],
		['deleteUser', () => deleteUser(member, 'u9')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
```

The pre-flight review checked that a `Pick<Tx, 'select'>` parameter accepts `drizzle.mock()` (for the earlier `lockAdmins`, the same shape as `lockTarget`), so no cast is needed. Drizzle renders `.limit(1).for('update')` as `limit ? for update` with the params `[id, 1]` (probed with `drizzle.mock()` in `tmp/owner-probe/`), the order MySQL's SELECT syntax requires.

Create `__tests__/data-users-writes.test.ts`. It covers the race the unique email index catches after the DAL's own check (Review Focus 3):

```ts
import { DrizzleQueryError } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertValues } = vi.hoisted(() => ({ insertValues: vi.fn() }))
vi.mock('@/db', () => ({
	getDb: () => ({
		// The pre-check finds no account with the email, so the insert is what meets the unique index.
		select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
		insert: () => ({ values: insertValues }),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { createUser } from '@/lib/data/users'

const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const input = {
	name: 'Jane',
	email: 'jane@example.com',
	role: 'user' as const,
	password: 'password-1',
}

beforeEach(() => {
	insertValues.mockReset()
})

describe('createUser and the unique email index', () => {
	it('answers email_in_use when the insert loses a race to the index', async () => {
		const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })
		insertValues.mockRejectedValue(new DrizzleQueryError('insert into `users` …', [], dup))
		expect(await createUser(admin, input)).toEqual({ ok: false, code: 'email_in_use' })
	})

	it('rethrows any other database error for the action to log', async () => {
		insertValues.mockRejectedValue(new Error('connection lost'))
		await expect(createUser(admin, input)).rejects.toThrow('connection lost')
	})

	it('refuses a role the actor may not give before any query (ADR-0024)', async () => {
		expect(await createUser(admin, { ...input, role: 'admin' })).toEqual({
			ok: false,
			code: 'forbidden',
		})
		expect(insertValues).not.toHaveBeenCalled()
	})

	it('stores the hash with the role, never the password, and answers the new id', async () => {
		insertValues.mockResolvedValue([{ affectedRows: 1 }])
		expect(await createUser(admin, input)).toMatchObject({
			ok: true,
			data: { id: expect.any(String) },
		})
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'jane@example.com',
				password: 'hash:password-1',
				role: 'user',
			}),
		)
	})
})
```

Create `__tests__/user-management-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	createUserInputSchema,
	userIdSchema,
	userInputSchema,
} from '@/app/(admin)/user-management/schemas'

const base = { name: 'Jane', email: 'jane@example.com', role: 'user' }

describe('user input schemas', () => {
	it('requires a password of 8 to 128 characters on create', () => {
		expect(createUserInputSchema.safeParse({ ...base, password: 'password-1' }).success).toBe(true)
		expect(createUserInputSchema.safeParse(base).success).toBe(false)
		expect(createUserInputSchema.safeParse({ ...base, password: '1234567' }).success).toBe(false)
		expect(createUserInputSchema.safeParse({ ...base, password: 'x'.repeat(129) }).success).toBe(
			false,
		)
	})
	it('treats a blank or missing password as "keep" on update', () => {
		expect(userInputSchema.safeParse(base).success).toBe(true)
		expect(userInputSchema.safeParse({ ...base, password: '' }).success).toBe(true)
		expect(userInputSchema.safeParse({ ...base, password: '1234567' }).success).toBe(false)
	})
	it("accepts the three roles: the rank is the DAL's, and the owner's own row sends owner (ADR-0024)", () => {
		for (const role of ['owner', 'admin', 'user']) {
			expect(userInputSchema.safeParse({ ...base, role }).success).toBe(true)
		}
	})
	it('refuses an unknown role, a bad email and a blank name, and strips unknown keys', () => {
		expect(userInputSchema.safeParse({ ...base, role: 'superuser' }).success).toBe(false)
		expect(userInputSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false)
		expect(userInputSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
		const parsed = userInputSchema.parse({ ...base, sessionVersion: 9 })
		expect(parsed).not.toHaveProperty('sessionVersion')
	})
	it('accepts any id up to the column length (decision h: legacy ids are not UUIDs)', () => {
		expect(userIdSchema.safeParse('cm1abcdefghijk').success).toBe(true)
		expect(userIdSchema.safeParse('3b241101-e2bb-4255-8caf-4136c566a962').success).toBe(true)
		expect(userIdSchema.safeParse('').success).toBe(false)
		expect(userIdSchema.safeParse('x'.repeat(37)).success).toBe(false)
	})
})
```

Create `__tests__/user-management-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, createUser, updateUser, deleteUser, refresh } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	createUser: vi.fn(),
	updateUser: vi.fn(),
	deleteUser: vi.fn(),
	refresh: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/users', () => ({ createUser, updateUser, deleteUser }))
vi.mock('next/cache', () => ({ refresh }))

import {
	createUserAction,
	deleteUserAction,
	updateUserAction,
} from '@/app/(admin)/user-management/actions'

const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const input = { name: 'Jane', email: 'jane@example.com', role: 'user', password: 'password-1' }

beforeEach(() => {
	for (const fn of [getServerSession, createUser, updateUser, deleteUser, refresh]) fn.mockReset()
	getServerSession.mockResolvedValue({ user: admin })
})

describe('user actions', () => {
	it.each([
		['createUserAction', () => createUserAction(input)],
		['updateUserAction', () => updateUserAction('u9', input)],
		['deleteUserAction', () => deleteUserAction('u9')],
	] as const)(
		'%s refuses a user-role session and a missing one before the DAL',
		async (_name, call) => {
			getServerSession.mockResolvedValue({ user: { ...admin, role: 'user' } })
			expect(await call()).toEqual({ ok: false, code: 'forbidden' })
			getServerSession.mockResolvedValue(null)
			expect(await call()).toEqual({ ok: false, code: 'unauthorized' })
			for (const fn of [createUser, updateUser, deleteUser, refresh])
				expect(fn).not.toHaveBeenCalled()
		},
	)

	it('answers invalid_input with the fields for a bad input', async () => {
		const result = await createUserAction({ ...input, email: 'nope', password: 'short' })
		expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
		if (!result.ok)
			expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['email', 'password'])
	})

	it('creates through the DAL with the verified admin and refreshes', async () => {
		createUser.mockResolvedValue({ ok: true, data: { id: 'u9' } })
		expect(await createUserAction(input)).toEqual({ ok: true, data: { id: 'u9' } })
		expect(createUser).toHaveBeenCalledWith(admin, input)
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('passes a DAL refusal through without refreshing', async () => {
		createUser.mockResolvedValue({ ok: false, code: 'email_in_use' })
		expect(await createUserAction(input)).toEqual({ ok: false, code: 'email_in_use' })
		expect(refresh).not.toHaveBeenCalled()
	})

	it('updates with a blank password meaning "keep"', async () => {
		updateUser.mockResolvedValue({ ok: true, data: undefined })
		await updateUserAction('u9', { ...input, password: '' })
		expect(updateUser).toHaveBeenCalledWith(admin, 'u9', { ...input, password: undefined })
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('answers not_found for an empty id without asking the DAL', async () => {
		expect(await updateUserAction('', input)).toEqual({ ok: false, code: 'not_found' })
		expect(await deleteUserAction('')).toEqual({ ok: false, code: 'not_found' })
		expect(updateUser).not.toHaveBeenCalled()
		expect(deleteUser).not.toHaveBeenCalled()
	})

	it('deletes and refreshes; a refusal passes through', async () => {
		deleteUser.mockResolvedValue({ ok: true, data: undefined })
		expect(await deleteUserAction('u9')).toEqual({ ok: true, data: undefined })
		deleteUser.mockResolvedValue({ ok: false, code: 'cannot_delete_self' })
		expect(await deleteUserAction('u9')).toEqual({ ok: false, code: 'cannot_delete_self' })
		expect(refresh).toHaveBeenCalledTimes(1)
	})
})
```

Create `__tests__/user-management-rank.test.ts`. It runs the actions with the real session chain and the real DAL rules over a fake database, so a direct POST to an action is refused by rank whatever the drawer shows (Review Focus 2):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, target, writes } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	/** The row the locking read finds (lockTarget); the email check always finds the address free. */
	target: { value: undefined as { id: string; role: string } | undefined },
	writes: { insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
}))
vi.mock('@/db', () => {
	// select().from().where().limit(1) is awaited for the email check ([]), or ends in .for('update') for the target.
	const query = {
		from: () => query,
		where: () => query,
		limit: () =>
			Object.assign(Promise.resolve([]), {
				for: () => Promise.resolve(target.value ? [target.value] : []),
			}),
	}
	const db = {
		select: () => query,
		insert: () => ({ values: writes.insert }),
		update: () => ({ set: () => ({ where: writes.update }) }),
		delete: () => ({ where: writes.delete }),
		transaction: (work: (tx: unknown) => unknown) => work(db),
	}
	return { getDb: () => db }
})

import {
	createUserAction,
	deleteUserAction,
	updateUserAction,
} from '@/app/(admin)/user-management/actions'

const owner = { id: 'o1', email: 'owner@example.com', name: 'Owner', role: 'owner' }
const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const fields = (role: string) => ({ name: 'N', email: 'n@example.com', role, password: '' })
const forbidden = { ok: false, code: 'forbidden' }
const anyWrite = () =>
	[writes.insert, writes.update, writes.delete].some(fn => fn.mock.calls.length > 0)

beforeEach(() => {
	getServerSession.mockReset()
	for (const fn of Object.values(writes)) {
		fn.mockReset()
		fn.mockResolvedValue([{ affectedRows: 1 }])
	}
	target.value = undefined
})

describe('an admin session (ADR-0024: an admin manages users only)', () => {
	beforeEach(() => {
		getServerSession.mockResolvedValue({ user: admin })
	})

	it('cannot create an admin', async () => {
		expect(await createUserAction({ ...fields('admin'), password: 'password-1' })).toEqual(
			forbidden,
		)
		expect(anyWrite()).toBe(false)
	})

	it('cannot promote a user', async () => {
		target.value = { id: 'u9', role: 'user' }
		expect(await updateUserAction('u9', fields('admin'))).toEqual(forbidden)
		expect(anyWrite()).toBe(false)
	})

	it.each([
		['another admin', { id: 'a2', role: 'admin' }],
		['the owner', { id: 'o1', role: 'owner' }],
	])('cannot edit, set the password of, or delete %s', async (_name, row) => {
		target.value = row
		expect(await updateUserAction(row.id, fields(row.role))).toEqual(forbidden)
		expect(await updateUserAction(row.id, { ...fields(row.role), password: 'password-1' })).toEqual(
			forbidden,
		)
		expect(await deleteUserAction(row.id)).toEqual(forbidden)
		expect(anyWrite()).toBe(false)
	})

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

	it('creates, edits and deletes a user', async () => {
		expect(await createUserAction({ ...fields('user'), password: 'password-1' })).toMatchObject({
			ok: true,
		})
		target.value = { id: 'u9', role: 'user' }
		expect(await updateUserAction('u9', { ...fields('user'), password: 'password-1' })).toEqual({
			ok: true,
			data: undefined,
		})
		expect(await deleteUserAction('u9')).toEqual({ ok: true, data: undefined })
	})
})

describe('the owner session', () => {
	beforeEach(() => {
		getServerSession.mockResolvedValue({ user: owner })
	})

	it('creates an admin, promotes a user, and edits, demotes and deletes an admin', async () => {
		expect(await createUserAction({ ...fields('admin'), password: 'password-1' })).toMatchObject({
			ok: true,
		})
		target.value = { id: 'u9', role: 'user' }
		expect(await updateUserAction('u9', fields('admin'))).toEqual({ ok: true, data: undefined })
		target.value = { id: 'a2', role: 'admin' }
		expect(await updateUserAction('a2', { ...fields('user'), password: 'password-1' })).toEqual({
			ok: true,
			data: undefined,
		})
		expect(await deleteUserAction('a2')).toEqual({ ok: true, data: undefined })
	})

	it('cannot give the owner role, change its own role, or delete itself', async () => {
		expect(await createUserAction({ ...fields('owner'), password: 'password-1' })).toEqual(
			forbidden,
		)
		target.value = { id: 'u9', role: 'user' }
		expect(await updateUserAction('u9', fields('owner'))).toEqual(forbidden)
		target.value = { id: 'o1', role: 'owner' }
		expect(await updateUserAction('o1', fields('admin'))).toEqual(forbidden)
		expect(await deleteUserAction('o1')).toEqual({ ok: false, code: 'cannot_delete_self' })
		expect(anyWrite()).toBe(false)
	})

	it('edits its own name and email', async () => {
		target.value = { id: 'o1', role: 'owner' }
		expect(await updateUserAction('o1', fields('owner'))).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
	})
})
```

The fake database is shaped by the DAL's own queries (`emailTakenBy`, `lockTarget`, `insert().values()`, `update().set().where()`, `delete().where()`, `transaction`); if Step 5's code reads differently, adapt the fake, never the rules.

Add to `__tests__/action-failure.test.ts`, inside its existing structure (it already spies on `console.error`; reuse its set-up):

```ts
import { DrizzleQueryError } from 'drizzle-orm'

import { describeError, invalidInput, toActionFailure } from '@/lib/action-failure'

describe('failure logging without secrets (Review Focus 3, decision g)', () => {
	const hash = '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ'
	const cause = Object.assign(
		new Error("Duplicate entry 'jane@example.com' for key 'users_email_key'"),
		{
			code: 'ER_DUP_ENTRY',
			errno: 1062,
		},
	)
	const queryError = new DrizzleQueryError(
		'insert into `users` …',
		['u1', 'Jane', 'jane@example.com', hash],
		cause,
	)

	it('describes a failed query by its driver code only', () => {
		expect(describeError(queryError)).toEqual({
			name: 'DrizzleQueryError',
			code: 'ER_DUP_ENTRY',
			errno: 1062,
		})
		expect(describeError(cause)).toEqual({ name: 'Error', code: 'ER_DUP_ENTRY', errno: 1062 })
		const plain = new Error('boom')
		expect(describeError(plain)).toBe(plain)
	})

	it('logs neither the parameters nor the message of a failed query', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(toActionFailure(queryError, 'createUserAction')).toEqual({
			ok: false,
			code: 'operation_failed',
		})
		const logged = JSON.stringify(errorSpy.mock.calls)
		expect(logged).not.toContain(hash)
		expect(logged).not.toContain('jane@example.com')
		expect(logged).toContain('ER_DUP_ENTRY')
	})

	it('builds invalid_input from a zod error', () => {
		const result = z.object({ email: z.email() }).safeParse({ email: 'nope' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(invalidInput(result.error)).toEqual({
				ok: false,
				code: 'invalid_input',
				fieldErrors: { email: [expect.any(String)] },
			})
		}
	})
})
```

(Add `import * as z from 'zod'` and `vi` to the file's imports if missing.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/data-users.test.ts __tests__/data-users-writes.test.ts __tests__/user-management-schemas.test.ts __tests__/user-management-actions.test.ts __tests__/user-management-rank.test.ts __tests__/action-failure.test.ts` Expected: FAIL. The modules and exports do not exist.

- [ ] **Step 3: The shared fields**

Create `lib/auth/fields.ts`:

```ts
import * as z from 'zod'

/**
 * Account fields shared by the action schemas and the antd form rules (client-safe). Eight characters minimum,
 * as every form had; the maximum bounds the input, since bcrypt reads only the first 72 bytes (decision f).
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export const passwordField = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)
export const emailField = z.email().max(255)
export const nameField = z.string().trim().min(1).max(255)
```

- [ ] **Step 4: Failure logging and `invalidInput`**

Replace `lib/action-failure.ts` with:

```ts
import 'server-only'

import { DrizzleQueryError } from 'drizzle-orm'
import * as z from 'zod'

import { fail, type ActionFailure } from '@/lib/action-result'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

const driverFields = (value: unknown) =>
	typeof value === 'object' && value !== null && 'errno' in value
		? {
				code: 'code' in value ? value.code : undefined,
				errno: value.errno,
			}
		: null

/**
 * What the server log may carry for an error (decision g). Drizzle's DrizzleQueryError puts the query's
 * parameters in its message (node_modules/drizzle-orm/errors.js), and mysql2's error carries the SQL and the
 * duplicate value: a users write would log the bcrypt hash, an apps write the API key. Both are logged by name,
 * driver code and errno only; any other error as it is.
 */
export const describeError = (error: unknown): unknown => {
	if (error instanceof DrizzleQueryError) {
		return {
			name: error.name,
			...(driverFields(error.cause) ?? { code: undefined, errno: undefined }),
		}
	}
	const driver = driverFields(error)
	if (driver && error instanceof Error) return { name: error.name, ...driver }
	return error
}

/** Logs an action's unexpected failure with its context (charter §4.5: the failure itself is never shown). */
export const logActionError = (error: unknown, context: string): void => {
	console.error(`${context}:`, describeError(error))
}

/** A zod refusal as the action result (charter §4.5: fieldErrors keyed by field path). */
export const invalidInput = (error: z.ZodError): ActionFailure =>
	fail('invalid_input', z.flattenError(error).fieldErrors as Record<string, string[]>)

/**
 * An exception inside an action as its failure result (charter §4.5: two vocabularies on purpose; a DifyError
 * becomes dify_unreachable, never a raw envelope). A DifyError and an unexpected error are logged with their
 * context first, so a wrong key or a failing Dify leaves a trace on the server; the message of a DifyError never
 * carries the API key. An AuthError is an expected outcome and is not logged.
 */
export const toActionFailure = (error: unknown, context: string): ActionFailure => {
	if (error instanceof AuthError) return fail(error.code)
	if (error instanceof DifyError) {
		console.error(`${context}:`, { status: error.status, code: error.code, message: error.message })
		return fail('dify_unreachable')
	}
	logActionError(error, context)
	return fail('operation_failed')
}
```

In `app/(admin)/app-management/actions.ts`, delete the local `invalid` helper and its `z` import if unused, and call `invalidInput` from `@/lib/action-failure`. The `isId` helper stays (app ids keep `z.uuid()`).

- [ ] **Step 5: The users DAL**

Replace `lib/data/users.ts` with:

```ts
import 'server-only'

import { count, desc, eq, sql } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { passwordResetTokens, users } from '@/db/schema'
import { fail, ok, type ActionErrorCode, type ActionResult } from '@/lib/action-result'
import { hashPassword } from '@/lib/auth/password'
import { canManage, type Role } from '@/lib/auth/roles'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

/*
 * The users Data Access Layer (charter §4.2). Every function takes the verified actor first and checks its role
 * itself, applies the rank (ADR-0024: the owner manages admins and users, an admin manages users),
 * answers the app's own result codes for expected refusals, and returns DTOs, never the password hash. The rules
 * are pure functions below with their own tests; the SQL runs in the e2e suite.
 */

type UserRow = typeof users.$inferSelect
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface UserDto {
	id: string
	name: string | null
	email: string
	role: Role
	createdAt: string
	updatedAt: string
}

/** What the users drawer sends (validated by the action's schema); no password means "keep the current one". */
export interface UserInput {
	name: string
	email: string
	role: Role
	password?: string
}

/** The columns the DTO reads: never the hash or the session version. */
const dtoColumns = {
	id: users.id,
	name: users.name,
	email: users.email,
	role: users.role,
	createdAt: users.createdAt,
	updatedAt: users.updatedAt,
}

export const toUserDto = (
	row: Pick<UserRow, 'id' | 'name' | 'email' | 'role' | 'createdAt' | 'updatedAt'>,
): UserDto => ({
	id: row.id,
	name: row.name,
	email: row.email,
	role: row.role,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

/** Who may create which role (ADR-0024): only a role the actor's rank manages; nobody creates an owner. */
export const createRefusal = ({
	actorRole,
	role,
}: {
	actorRole: Role
	role: Role
}): ActionErrorCode | null => (canManage(actorRole, role) ? null : 'forbidden')

/**
 * Who may change what (charter §4.2, ADR-0024). Your own row: name and email only; the role is fixed and the
 * password changes through the account menu with the current one (decisions b, c). Another account: only one
 * whose role the actor's rank manages, and only to a role it manages.
 */
export const updateRefusal = ({
	actor,
	target,
	input,
}: {
	actor: { id: string; role: Role }
	target: { id: string; role: Role }
	input: Pick<UserInput, 'role' | 'password'>
}): ActionErrorCode | null => {
	if (target.id === actor.id)
		return input.password || input.role !== target.role ? 'forbidden' : null
	if (!canManage(actor.role, target.role)) return 'forbidden'
	if (!canManage(actor.role, input.role)) return 'forbidden'
	return null
}

/** Nobody deletes themselves (charter §4.2), and only an account whose role the actor's rank manages: never the owner. */
export const deleteRefusal = ({
	actor,
	target,
}: {
	actor: { id: string; role: Role }
	target: { id: string; role: Role }
}): ActionErrorCode | null => {
	if (target.id === actor.id) return 'cannot_delete_self'
	return canManage(actor.role, target.role) ? null : 'forbidden'
}

const codeOf = (value: unknown) =>
	typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined

/**
 * MySQL's duplicate-key error (1062 ER_DUP_ENTRY) as mysql2 reports it, bare or as the cause of Drizzle's
 * DrizzleQueryError: the unique email index refused a write that raced the check before it.
 */
export const isDuplicateEntry = (error: unknown): boolean =>
	codeOf(error) === 'ER_DUP_ENTRY' ||
	(error instanceof Error && codeOf(error.cause) === 'ER_DUP_ENTRY')

/**
 * A locking read of one account by its primary key (decision d; MySQL "Locking Reads": SELECT … FOR UPDATE). A
 * concurrent change to the same account, such as the owner promoting a user an admin is editing, waits and is then
 * read, so the rank is never checked against a stale role. One row, for the few milliseconds the transaction lasts;
 * consistent reads such as sign-in do not wait.
 */
export const lockTarget = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: users.id, role: users.role })
		.from(users)
		.where(eq(users.id, id))
		.limit(1)
		.for('update')

const emailTakenBy = (tx: Pick<Tx, 'select'>, email: string) =>
	tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

export async function listUsers(actor: SessionUser): Promise<UserDto[]> {
	assertAdmin(actor)
	const rows = await getDb().select(dtoColumns).from(users).orderBy(desc(users.createdAt))
	return rows.map(toUserDto)
}

export async function createUser(
	actor: SessionUser,
	input: UserInput & { password: string },
): Promise<ActionResult<{ id: string }>> {
	assertAdmin(actor)
	const refusal = createRefusal({ actorRole: actor.role, role: input.role })
	if (refusal) return fail(refusal)
	const db = getDb()
	const [taken] = await emailTakenBy(db, input.email)
	if (taken) return fail('email_in_use')
	const id = crypto.randomUUID()
	try {
		await db.insert(users).values({
			id,
			name: input.name,
			email: input.email,
			password: await hashPassword(input.password),
			role: input.role,
		})
	} catch (error) {
		if (isDuplicateEntry(error)) return fail('email_in_use')
		throw error
	}
	return ok({ id })
}

/**
 * Updates name, email and, for an account the actor's rank manages, the role and the password: a password set here
 * revokes that account's sessions (sessionVersion + 1; charter §4.2 "a password change revokes every session").
 */
export async function updateUser(
	actor: SessionUser,
	id: string,
	input: UserInput,
): Promise<ActionResult> {
	assertAdmin(actor)
	// Hashed before the transaction so the row lock is held for the queries only.
	const passwordHash = input.password ? await hashPassword(input.password) : undefined
	try {
		return await getDb().transaction(async tx => {
			const [target] = await lockTarget(tx, id)
			if (!target) return fail('not_found')
			const refusal = updateRefusal({ actor, target, input })
			if (refusal) return fail(refusal)
			const [taken] = await emailTakenBy(tx, input.email)
			if (taken && taken.id !== id) return fail('email_in_use')
			await tx
				.update(users)
				.set({
					name: input.name,
					email: input.email,
					role: input.role,
					...(passwordHash
						? { password: passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` }
						: {}),
				})
				.where(eq(users.id, id))
			return ok(undefined)
		})
	} catch (error) {
		if (isDuplicateEntry(error)) return fail('email_in_use')
		throw error
	}
}

/** Deletes an account the actor's rank manages, and its reset tokens (decision e). */
export async function deleteUser(actor: SessionUser, id: string): Promise<ActionResult> {
	assertAdmin(actor)
	return getDb().transaction(async tx => {
		const [target] = await lockTarget(tx, id)
		if (!target) return fail('not_found')
		const refusal = deleteRefusal({ actor, target })
		if (refusal) return fail(refusal)
		await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id))
		await tx.delete(users).where(eq(users.id, id))
		return ok(undefined)
	})
}

/** Whether any account exists (the /init page's check). Replaced by lib/data/setup.ts hasAccounts in Task 6. */
export async function hasUsers() {
	const [row] = await getDb().select({ count: count() }).from(users)
	return (row?.count ?? 0) > 0
}
```

Sources: Drizzle `transaction` (Context7 `/drizzle-team/drizzle-orm-docs`, MySQL transactions; the callback's return value is the transaction's), `.for('update')` (installed `mysql-core/query-builders/select.d.ts:611`), MySQL "Locking Reads".

`emailTakenBy` takes either the database or a transaction, and `lockTarget` a transaction or, in its test, `drizzle.mock()`. If tsc refuses `Pick<Tx, 'select'>` for the `Db` argument, type the parameter as `Pick<Db, 'select'> | Pick<Tx, 'select'>`. Report it; do not cast. `fail` and `ok` come from the client-safe `lib/action-result.ts`, so the DAL answers in the vocabulary the actions pass through (charter §4.5).

In `lib/action-result.ts`, remove `| 'last_admin'` from `ActionErrorCode`. The owner cannot be removed or demoted, so no refusal guards the last admin any more (deviation 7). `git grep -n "last_admin" -- app components lib hooks __tests__ e2e` must print nothing; the code had no other reader.

- [ ] **Step 6: The schemas and the actions**

Create `app/(admin)/user-management/schemas.ts`:

```ts
import * as z from 'zod'

import { emailField, nameField, passwordField } from '@/lib/auth/fields'
import { ROLES } from '@/lib/auth/roles'

/**
 * The users drawer's input (charter §4.5); on update a blank or missing password means "keep the current one". Any
 * of the three roles parses (the owner's own row sends `owner`); which role an actor may give is the DAL's rank.
 */
export const userInputSchema = z.object({
	name: nameField,
	email: emailField,
	role: z.enum(ROLES),
	password: z.union([z.literal(''), passwordField]).optional(),
})

export const createUserInputSchema = userInputSchema.extend({ password: passwordField })

/**
 * Account ids are not checked as UUIDs (decision h): rows older than this line's generator may use another
 * format; the column is varchar(36), and an unknown id answers not_found.
 */
export const userIdSchema = z.string().min(1).max(36)

export type UserFormInput = z.infer<typeof userInputSchema>
```

Create `app/(admin)/user-management/actions.ts`:

```ts
'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createUser, deleteUser, updateUser } from '@/lib/data/users'

import { createUserInputSchema, userIdSchema, userInputSchema } from './schemas'

/*
 * Thin Server Actions (charter §4.2): verify the admin, validate, call the DAL, refresh the route (next/cache
 * `refresh`: the page reads the database directly), answer a plain ActionResult. Every expected failure is a
 * result, never a throw; the DAL checks the role again.
 */

export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
	try {
		const actor = await requireAdmin()
		const parsed = createUserInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await createUser(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'createUserAction')
	}
}

export async function updateUserAction(id: string, input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const parsed = userInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateUser(actor, id, {
			...parsed.data,
			password: parsed.data.password || undefined,
		})
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'updateUserAction')
	}
}

export async function deleteUserAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const result = await deleteUser(actor, id)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'deleteUserAction')
	}
}
```

- [ ] **Step 7: Run the tests and the gates**

```bash
pnpm exec vitest run __tests__/data-users.test.ts __tests__/data-users-writes.test.ts __tests__/user-management-schemas.test.ts __tests__/user-management-actions.test.ts __tests__/user-management-rank.test.ts __tests__/action-failure.test.ts __tests__/app-management-actions.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <changed files>
pnpm exec oxfmt --write <changed files>
pnpm test
```

Expected: PASS. `app/(admin)/user-management/page.tsx` still calls `listUsers()` without an actor, and tsc flags it. The page becomes `return <UserManagement users={await listUsers(user)} currentUserId={user.id} />`, without `toUserRows`. A `UserDto` has every field of the table's `UserRow` and a `role`, so the client component compiles unchanged; Task 5 moves it to `UserDto` and deletes `user-row.ts`. Update `__tests__/user-management-page.test.ts`: `listUsers` is called with the admin and resolves DTOs (ISO dates, `role`), which the page passes through with `currentUserId`.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/fields.ts lib/data/users.ts lib/action-failure.ts lib/action-result.ts app/\(admin\)/user-management/actions.ts app/\(admin\)/user-management/schemas.ts app/\(admin\)/user-management/page.tsx app/\(admin\)/app-management/actions.ts __tests__/data-users.test.ts __tests__/data-users-writes.test.ts __tests__/user-management-schemas.test.ts __tests__/user-management-actions.test.ts __tests__/user-management-rank.test.ts __tests__/action-failure.test.ts __tests__/user-management-page.test.ts
git commit -m "feat(users): add the users DAL and Server Actions with the role rank

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 5: The users admin on the actions — role field, role column, `/api/users` deleted

Charter §4.2 "Roles" ("the users drawer gets a role field"), "Actions" (the handlers are deleted); §4.6 (the specs that assert on old shapes change with their route); deviations 1, 7; decisions b, c, i; Review Focus 2.

**Files:**

- Move: `components/admin/apps/use-action-transition.ts` → `hooks/use-action-transition.ts` (`git mv`), and update its importers (`git grep -n "use-action-transition"`), including `__tests__/use-action-transition.test.ts`
- Create: `components/admin/users/role-labels.ts`
- Modify: `components/admin/users/user-management.tsx`, `components/admin/users/user-form-drawer.tsx`, `components/admin/users/user-errors.ts`, `app/(admin)/user-management/page.tsx`, `locales/{en,zh,ar}/translation.json`
- Delete: `components/admin/users/user-row.ts`, `__tests__/user-row.test.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`
- Modify (e2e): `e2e/admin-users.spec.ts`, `e2e/auth.spec.ts` (its reset test seeds through the fixture)
- Test: `__tests__/user-errors.test.ts`, `__tests__/user-management-page.test.ts`

**Interfaces:**

- Consumes: `createUserAction`, `updateUserAction`, `deleteUserAction`, `UserFormInput` (Task 4); `UserDto` (`import type` from `@/lib/data/users`); `PASSWORD_MIN`, `PASSWORD_MAX` (Task 4); `MANAGEABLE_ROLES`, `canManage`, `type Role` (Task 1); `seedUser`, `signInAs` (Task 3).
- Produces:
  - `useActionTransition` at `@/hooks/use-action-transition` (same signature: `{ pending, run(work) }`);
  - `userErrorKey(code: ActionErrorCode)`;
  - `UserFormDrawer` and `UserManagement` take `currentUser: { id: string; role: Role }` (in place of `currentUserId`);
  - `ROLE_LABEL_KEYS` from `components/admin/users/role-labels.ts`;
  - the i18n keys `admin_users.role`, `role_owner`, `role_admin`, `role_user`, `role_self_hint`, `role_owner_only_hint`, `password_self_hint`, `invalid_input` and `auth.password_max_128`.

- [ ] **Step 1: Write the failing test**

Replace `__tests__/user-errors.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'

import { userErrorKey } from '@/components/admin/users/user-errors'

// Charter §4.5: the actions answer codes; the drawer and the table show their translation.
describe('userErrorKey', () => {
	it.each([
		['unauthorized', 'common.session_expired'],
		['forbidden', 'common.forbidden'],
		['not_found', 'admin_users.not_found'],
		['email_in_use', 'admin_users.email_in_use'],
		['cannot_delete_self', 'admin_users.cannot_delete_self'],
		['invalid_input', 'admin_users.invalid_input'],
		['operation_failed', 'common.operation_failed'],
		['dify_unreachable', 'common.operation_failed'],
	] as const)('maps %s to %s', (code, key) => {
		expect(userErrorKey(code)).toBe(key)
	})
})
```

Run: `pnpm exec vitest run __tests__/user-errors.test.ts` Expected: FAIL. `userErrorKey` still takes an HTTP status.

- [ ] **Step 2: Map the codes**

Replace `components/admin/users/user-errors.ts` with:

```ts
import type { ActionErrorCode } from '@/lib/action-result'

/** A users action's failure code as the message the admin reads (charter §4.5: codes, never a route's text). */
export const userErrorKey = (code: ActionErrorCode) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'not_found':
			return 'admin_users.not_found' as const
		case 'email_in_use':
			return 'admin_users.email_in_use' as const
		case 'cannot_delete_self':
			return 'admin_users.cannot_delete_self' as const
		case 'invalid_input':
			return 'admin_users.invalid_input' as const
		default:
			return 'common.operation_failed' as const
	}
}
```

- [ ] **Step 3: Move the transition hook**

```bash
git mv components/admin/apps/use-action-transition.ts hooks/use-action-transition.ts
git grep -ln "use-action-transition" -- app components hooks lib __tests__
```

Point every importer at `@/hooks/use-action-transition` (the apps drawer, the apps row actions, the test).

Create `components/admin/users/role-labels.ts`, which the table and the drawer share:

```ts
import type { Role } from '@/lib/auth/roles'

/** Each role's label key (ADR-0024), for the table's tags and the drawer's options. */
export const ROLE_LABEL_KEYS = {
	owner: 'admin_users.role_owner',
	admin: 'admin_users.role_admin',
	user: 'admin_users.role_user',
} as const satisfies Record<Role, string>
```

- [ ] **Step 4: The drawer**

Replace `components/admin/users/user-form-drawer.tsx` with:

```tsx
'use client'

import { App, Button, Drawer, Form, Input, Radio, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import { createUserAction, updateUserAction } from '@/app/(admin)/user-management/actions'
import type { UserFormInput } from '@/app/(admin)/user-management/schemas'
import { useActionTransition } from '@/hooks/use-action-transition'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/fields'
import { MANAGEABLE_ROLES, type Role } from '@/lib/auth/roles'
import type { UserDto } from '@/lib/data/users'

import { ROLE_LABEL_KEYS } from './role-labels'
import { userErrorKey } from './user-errors'

const USER_FORM_ID = 'user-form'

/**
 * Add or edit a user (charter §4.2). The Server Actions run through startTransition from onFinish (ADR-0023
 * "Admin actions"; the Form owns validation), and each refreshes the page itself.
 *
 * Your own row has no password field and a fixed role: your own password changes from the account menu with the
 * current one, only the owner changes an admin's role, and the owner's never changes (ADR-0024). Elsewhere the
 * role options are the roles the signed-in account's rank may give (MANAGEABLE_ROLES): Admin and User for the
 * owner, User alone for an admin, shown disabled with a hint. The server applies the same rank. A disabled field
 * keeps its value in the form store, so the role is still submitted (antd's store has no notion of disabled).
 *
 * The Form owns its instance (antd creates one when `form` is not provided), so each mounting under
 * `destroyOnHidden` gets a fresh store seeded from its own `initialValues`. A drawer-level `Form.useForm()` would
 * keep the previous user's values, and `clearOnDestroy` empties the store under Strict Mode's remount. The Form is
 * keyed by the user it edits, so a drawer reopened for someone else while it still slides out gets a fresh store
 * too. The submit button in `extra` reaches the form through the HTML `form` attribute.
 */
export default function UserFormDrawer({
	open,
	user,
	currentUser,
	onClose,
	onClosed,
}: {
	open: boolean
	/** The user to edit; absent when adding. */
	user?: UserDto
	/** The signed-in account: its own row offers no password field and a fixed role; its role decides the options. */
	currentUser: { id: string; role: Role }
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears `user`. */
	onClosed: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()
	const isSelf = user?.id === currentUser.id
	// Your own role is fixed; otherwise the roles the signed-in account's rank may give (ADR-0024).
	const roleOptions: readonly Role[] =
		user && user.id === currentUser.id ? [user.role] : MANAGEABLE_ROLES[currentUser.role]

	const save = (values: UserFormInput) =>
		void run(async () => {
			if (user) {
				const result = await updateUserAction(user.id, values)
				if (!result.ok) {
					message.error(t(userErrorKey(result.code)))
					return
				}
				message.success(t('admin_users.update_success'))
				onClose()
				return
			}
			const result = await createUserAction(values)
			if (!result.ok) {
				message.error(t(userErrorKey(result.code)))
				return
			}
			message.success(t('admin_users.add_success'))
			onClose()
		})

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			destroyOnHidden
			title={user ? t('admin_users.edit_user') : t('admin_users.add_user')}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						htmlType="submit"
						form={USER_FORM_ID}
						loading={pending}
					>
						{user ? t('common.update') : t('common.add')}
					</Button>
				</Space>
			}
		>
			<Form<UserFormInput>
				key={user?.id ?? 'create'}
				id={USER_FORM_ID}
				layout="vertical"
				initialValues={
					user ? { name: user.name ?? '', email: user.email, role: user.role } : { role: 'user' }
				}
				onFinish={save}
			>
				<Form.Item
					name="name"
					label={t('admin_users.name')}
					rules={[{ required: true, message: t('admin_users.name_required') }]}
				>
					<Input placeholder={t('admin_users.name_placeholder')} />
				</Form.Item>
				<Form.Item
					name="email"
					label={t('auth.email')}
					rules={[
						{ required: true, message: t('admin_users.email_required') },
						{ type: 'email', message: t('auth.email_invalid') },
					]}
				>
					<Input placeholder={t('admin_users.email_placeholder')} />
				</Form.Item>
				<Form.Item
					name="role"
					label={t('admin_users.role')}
					extra={
						isSelf
							? t('admin_users.role_self_hint')
							: roleOptions.length < 2
								? t('admin_users.role_owner_only_hint')
								: undefined
					}
				>
					<Radio.Group
						optionType="button"
						disabled={roleOptions.length < 2}
						options={roleOptions.map(role => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
					/>
				</Form.Item>
				{isSelf ? (
					<Typography.Paragraph type="secondary">
						{t('admin_users.password_self_hint')}
					</Typography.Paragraph>
				) : (
					<Form.Item
						name="password"
						label={user ? t('auth.new_password') : t('auth.password')}
						extra={user ? t('admin_users.password_keep_hint') : undefined}
						rules={[
							...(user ? [] : [{ required: true, message: t('admin_users.password_required') }]),
							{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
							{ max: PASSWORD_MAX, message: t('auth.password_max_128') },
						]}
					>
						<Input.Password autoComplete="new-password" />
					</Form.Item>
				)}
			</Form>
		</Drawer>
	)
}
```

Check `antd info Radio` for `optionType`, `disabled` and `options` before writing (Radio.Group "optionType: 'default' | 'button'"; `options` as `{ label, value }[]`).

- [ ] **Step 5: The table**

In `components/admin/users/user-management.tsx`:

- the prop `currentUserId: string` becomes `currentUser: { id: string; role: Role }` (import `canManage` and `type Role` from `@/lib/auth/roles`, and `ROLE_LABEL_KEYS` from `./role-labels`);
- import `type UserDto` from `@/lib/data/users` in place of `type UserRow`, and replace every `UserRow` with `UserDto`;
- import `deleteUserAction` and `useActionTransition`; drop `useRouter` (the action refreshes);
- `remove` becomes:

```tsx
const { run } = useActionTransition()
const remove = (user: UserDto) =>
	run(async () => {
		const result = await deleteUserAction(user.id)
		if (result.ok) message.success(t('admin_users.delete_success'))
		else message.error(t(userErrorKey(result.code)))
	})
```

- a column after "User":

```tsx
		{
			title: t('admin_users.role'),
			key: 'role',
			render: (_, user) => (
				<Tag color={user.role === 'owner' ? 'purple' : user.role === 'admin' ? 'gold' : 'default'}>
					{t(ROLE_LABEL_KEYS[user.role])}
				</Tag>
			),
		},
```

- in the actions column, Edit shows on your own row and on rows whose role your rank manages, and Delete only on rows whose role your rank manages. No role manages its own rank, so your own row never gets Delete, the owner's row never gets either button for an admin, and another admin's row gets neither for an admin (deviation 7; the DAL refuses the same):

```tsx
		render: (_, user) => (
			<Space>
				{(user.id === currentUser.id || canManage(currentUser.role, user.role)) && (
					<Button
						type="text"
						icon={<EditOutlined />}
						onClick={() => openDrawer(user)}
					>
						{t('common.edit')}
					</Button>
				)}
				{canManage(currentUser.role, user.role) && (
					<Popconfirm
						title={t('admin_users.delete_confirm_title')}
						description={t('admin_users.delete_confirm_description')}
						okText={t('common.delete')}
						okButtonProps={{ danger: true }}
						cancelText={t('common.cancel')}
						onConfirm={() => remove(user)}
					>
						<Button
							type="text"
							danger
							icon={<DeleteOutlined />}
						>
							{t('common.delete')}
						</Button>
					</Popconfirm>
				)}
			</Space>
		),
```

- `UserFormDrawer` gets `currentUser={currentUser}`;
- the component's doc comment reads `/** The user table (charter §4.2): the role column, Server Actions for every write; the "Active" tag is kept (owner decision); dates format in the browser. */`.

`Popconfirm`'s `onConfirm={() => remove(user)}` keeps the OK button loading until the action settles (antd Popconfirm: `onConfirm` may return a Promise).

`app/(admin)/user-management/page.tsx` already passes `listUsers(user)` (Task 4); its `currentUserId={user.id}` becomes `currentUser={{ id: user.id, role: user.role }}`, and `__tests__/user-management-page.test.ts` expects that prop (the admin's id and role from `requireAdminUser`). Its doc comment reads `/** The users table (charter §4.2): the signed-in account's id and role decide its own row and what its rank may manage. */`.

Delete the row mapper and its test, so the deletions are staged:

```bash
git rm components/admin/users/user-row.ts __tests__/user-row.test.ts
git grep -n "user-row\|toUserRows" -- app components lib hooks e2e __tests__
```

Expected: no output. `lib/data/users.ts`'s own `type UserRow = typeof users.$inferSelect` is the DAL's internal row type and stays.

- [ ] **Step 6: Delete the route handlers**

```bash
git rm app/api/users/route.ts "app/api/users/[id]/route.ts"
git grep -n "api/users" -- app components lib hooks proxy.ts e2e __tests__
```

Expected:

- `__tests__/proxy.test.ts` and `__tests__/access.test.ts`, which use `/api/users` as an example of a denied path; Task 6 rewrites them, so leave them here;
- `e2e/admin-users.spec.ts` and `e2e/auth.spec.ts`, which Step 8 rewrites.

- [ ] **Step 7: Locale keys and orphans**

| key | en | zh | ar |
| --- | --- | --- | --- |
| `admin_users.role` | Role | 角色 | الدور |
| `admin_users.role_owner` | Owner | 所有者 | المالك |
| `admin_users.role_admin` | Admin | 管理员 | مسؤول |
| `admin_users.role_user` | User | 普通用户 | مستخدم |
| `admin_users.role_self_hint` | You cannot change your own role. | 你不能修改自己的角色。 | لا يمكنك تغيير دورك. |
| `admin_users.role_owner_only_hint` | Only the owner can give the admin role. | 只有所有者可以授予管理员角色。 | لا يمنح دورَ المسؤول إلا المالك. |
| `admin_users.password_self_hint` | Change your own password from the account menu. | 请在账户菜单中修改你自己的密码。 | غيّر كلمة المرور الخاصة بك من قائمة الحساب. |
| `admin_users.invalid_input` | Check the fields and try again. | 请检查填写的内容后重试。 | راجع الحقول وأعد المحاولة. |
| `auth.password_max_128` | Password must be at most 128 characters | 密码不能超过 128 位 | يجب ألا تزيد كلمة المرور على 128 حرفًا |

Then, for each of `admin_users.delete_failed`, `admin_users.delete_error` and `common.operation_error`, run `git grep -n "<key>" -- app components lib hooks`. Remove a key from all three locale files when nothing reads it.

- [ ] **Step 8: The e2e specs**

`e2e/auth.spec.ts`, the reset test:

- the throwaway user comes from `const userId = await seedUser({ email, password: 'old-password-1', name: 'Reset me' })` (import from `./fixtures/users`), in place of the `browser.newContext({ storageState: ADMIN_STATE })` POST to `/api/users`;
- the token row insert uses `userId`;
- `browser` leaves the test's fixture list, and the `ADMIN_STATE` import goes (no reader is left in the file, and oxlint's `no-unused-vars` is an error);
- the comment above the seeding becomes `// A throwaway user seeded in MySQL (e2e/fixtures/users.ts), then the token row as the route` / `// would store it (lib/auth/password.ts: sha-256 hash, 15-minute expiry).`;
- the rest of the test stays as it is: the reset flow keeps its handlers (deviation 6).

`e2e/admin-users.spec.ts`:

- import `seedUser` and `signInAs` from `./fixtures/users`;
- in the CRUD test, after the first successful Add, assert `await expect(row(page, email)).toContainText('User')`. `toContainText` is case-sensitive by default, so only the role tag matches; the name "Spec user" is lowercase. In the rename edit, before Update, pick Admin as shown below, then `await expect(row(page, email)).toContainText('Admin')`;
- antd 6 draws a button-style radio's `<input>` at 0×0 with `pointer-events: none` (`node_modules/antd/es/radio/style/index.js:389-393`), so Playwright's `check()` cannot act on it. Every role pick clicks the visible option text inside the drawer, then asserts the state:

  ```ts
  await edit.getByText('Admin', { exact: true }).click()
  await expect(edit.getByRole('radio', { name: 'Admin' })).toBeChecked()
  ```

- the search test seeds with `await seedUser({ email, password: '12345678', name: 'Needle' })` in place of `page.request.post('/api/users', …)`;
- add inside `test.describe('user CRUD', …)`:

```ts
test('the own row of the owner offers no password field and a fixed role, and still saves', async ({
	page,
}) => {
	await page.goto('/user-management')
	const own = row(page, e2eEnv.E2E_ADMIN_EMAIL)
	await expect(own).toContainText('Owner')
	await own.getByRole('button', { name: 'Edit' }).click()
	const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
	await expect(edit.getByText('Change your own password from the account menu.')).toBeVisible()
	await expect(edit.getByLabel('New password')).toHaveCount(0)
	await expect(edit.getByText('You cannot change your own role.')).toBeVisible()
	await expect(edit.getByRole('radio', { name: 'Owner' })).toBeChecked()
	await expect(edit.getByRole('radio', { name: 'Owner' })).toBeDisabled()
	// The disabled role is still submitted (the action's schema requires it): saving the unchanged row succeeds.
	await edit.getByRole('button', { name: 'Update' }).click()
	await expect(page.getByText('User updated')).toBeVisible()
	await expect(own).toContainText('Owner')
})

test('the owner demotes a signed-in admin, whose next page lands on /apps', async ({
	page,
	browser,
}, testInfo) => {
	// Not ending in admin@e2e.local: the row locator is a substring match, and the owner's email is admin@e2e.local.
	const email = `user-${testInfo.project.name}-second@e2e.local`
	await seedUser({ email, password: 'second-admin-1', name: 'Second admin', role: 'admin' })
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
	try {
		const second = await context.newPage()
		await signInAs(second, email, 'second-admin-1')
		await second.goto('/user-management')
		await expect(second).toHaveURL(/\/user-management$/)

		await page.goto('/user-management')
		await row(page, email).getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
		await edit.getByText('User', { exact: true }).click()
		await expect(edit.getByRole('radio', { name: 'User' })).toBeChecked()
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row(page, email)).toContainText('User')

		// The jwt callback refreshes the role from the row (decision a): the demoted session keeps working as a user.
		await second.goto('/user-management')
		await expect(second).toHaveURL(/\/apps$/)
	} finally {
		await context.close()
	}
})

test('an admin manages users only: no Edit or Delete on the owner or another admin, only the User role', async ({
	browser,
}, testInfo) => {
	const prefix = `user-${testInfo.project.name}-rank`
	const adminEmail = `${prefix}-a@e2e.local`
	const peerEmail = `${prefix}-peer@e2e.local`
	const createdEmail = `${prefix}-created@e2e.local`
	await seedUser({ email: adminEmail, password: 'rank-admin-1', name: 'Rank admin', role: 'admin' })
	await seedUser({ email: peerEmail, password: 'rank-peer-1', name: 'Rank peer', role: 'admin' })
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
	try {
		const page = await context.newPage()
		await signInAs(page, adminEmail, 'rank-admin-1')
		await page.goto('/user-management')
		for (const email of [e2eEnv.E2E_ADMIN_EMAIL, peerEmail]) {
			await expect(row(page, email)).toBeVisible()
			await expect(row(page, email).getByRole('button', { name: 'Edit' })).toHaveCount(0)
			await expect(row(page, email).getByRole('button', { name: 'Delete' })).toHaveCount(0)
		}

		await page.getByRole('button', { name: 'Add user' }).click()
		const add = page.getByRole('dialog').filter({ hasText: 'Add user' })
		await expect(add.getByRole('radio')).toHaveCount(1)
		await expect(add.getByRole('radio', { name: 'User' })).toBeChecked()
		await expect(add.getByRole('radio', { name: 'User' })).toBeDisabled()
		await expect(add.getByText('Only the owner can give the admin role.')).toBeVisible()
		await add.getByLabel('Name').fill('Rank created')
		await add.getByLabel('Email').fill(createdEmail)
		await add.getByLabel('Password').fill('12345678')
		await add.getByRole('button', { name: 'Add' }).click()
		await expect(row(page, createdEmail)).toContainText('User')

		await row(page, createdEmail).getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).last().click()
		await expect(row(page, createdEmail)).toHaveCount(0)
	} finally {
		await context.close()
	}
})
```

The `afterEach` that deletes `user-${project.name}%` also removes the seeded admins, and the created user if a step failed before its delete. A seeded email must not end in `admin@e2e.local`: `row()` matches the email as an unanchored pattern, and the owner's row would match it too.

- [ ] **Step 9: Run the tests and the specs**

```bash
pnpm exec vitest run __tests__/user-errors.test.ts __tests__/use-action-transition.test.ts __tests__/user-management-page.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <changed files>
pnpm exec oxfmt --write <changed files>
pnpm test
npx -y @ant-design/cli lint ./
pnpm exec playwright test e2e/admin-users.spec.ts e2e/auth.spec.ts e2e/admin-apps.spec.ts
```

Expected: PASS on the three projects (`admin-apps.spec.ts` runs because the apps drawer's hook import moved).

- [ ] **Step 10: Commit**

```bash
git add hooks/use-action-transition.ts components/admin/apps components/admin/users app/\(admin\)/user-management/page.tsx locales e2e/admin-users.spec.ts e2e/auth.spec.ts __tests__/user-errors.test.ts __tests__/use-action-transition.test.ts __tests__/user-management-page.test.ts
git status --short   # the git mv and git rm are already staged; nothing may be left unstaged
git commit -m "feat(users): run the users admin on Server Actions with the role rank; delete /api/users

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 6: First run through the DAL and an action; the proxy without the init fetch

Charter §4.2 "First run and the proxy"; §4.6 "Setup creates the admin through the `/init` form" (here the owner, deviation 7); decision d; §5 B2 "done when" (no Route Handler under `app/api` except `auth`, `health`, `dify`, `apps/[appId]/icon`; deviation 6 keeps the two reset handlers under `auth`); deviation 2; Review Focus 5.

**Files:**

- Create: `lib/data/setup.ts`, `app/init/actions.ts`
- Modify: `app/init/page.tsx`, `components/auth/init-form.tsx`, `components/auth/auth-failure.ts`, `app/(auth)/login/layout.tsx`, `proxy.ts`, `lib/access.ts`, `lib/data/users.ts` (drop `hasUsers`), `locales/{en,zh,ar}/translation.json` (the `init.*` wording says owner)
- Delete: `app/api/init/route.ts`, `app/api/init/status/route.ts`
- Modify (e2e): `e2e/auth.setup.ts`
- Test: `__tests__/init-actions.test.ts` (new), `__tests__/data-setup.test.ts` (new), `__tests__/api-routes.test.ts` (new), `__tests__/init-page.test.ts`, `__tests__/auth-page-layouts.test.ts`, `__tests__/proxy.test.ts`, `__tests__/access.test.ts`, `__tests__/auth-failure.test.ts`

**Interfaces:**

- Consumes: `isDuplicateEntry` (Task 4); `invalidInput`, `toActionFailure` (Task 4); the fields (Task 4); `useActionTransition` (Task 5).
- Produces:
  - from `lib/data/setup.ts`: `hasAccounts(): Promise<boolean>`, `lockAnyAccount(tx)`, `createOwner(input: OwnerInput): Promise<ActionResult>`, `OwnerInput { name; email; password }`;
  - `createOwnerAction(input: unknown): Promise<ActionResult>`;
  - `initFailureKey(code: ActionErrorCode)`;
  - `isPublicPath` and `isApiPath` (`isUngatedPath` is removed).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/init-actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createOwner } = vi.hoisted(() => ({ createOwner: vi.fn() }))
vi.mock('@/lib/data/setup', () => ({ createOwner }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { createOwnerAction } from '@/app/init/actions'

const input = { name: 'Owner', email: 'owner@example.com', password: 'password-1' }

// A block body: vitest runs a function returned from beforeEach as cleanup, and mockReset() returns the mock.
beforeEach(() => {
	createOwner.mockReset()
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe('createOwnerAction (charter §4.2: no session exists yet; ADR-0024: first run creates the owner)', () => {
	it('hands the DAL the parsed input only: no role or other key from the client', async () => {
		createOwner.mockResolvedValue({ ok: true, data: undefined })
		expect(
			await createOwnerAction({ ...input, confirmPassword: 'password-1', role: 'user' }),
		).toEqual({ ok: true, data: undefined })
		expect(createOwner).toHaveBeenCalledWith(input)
	})

	it('passes forbidden through once setup is done (Review Focus 5)', async () => {
		createOwner.mockResolvedValue({ ok: false, code: 'forbidden' })
		expect(await createOwnerAction(input)).toEqual({ ok: false, code: 'forbidden' })
	})

	it('answers invalid_input without asking the DAL', async () => {
		const result = await createOwnerAction({ ...input, password: 'short' })
		expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
		expect(createOwner).not.toHaveBeenCalled()
	})

	it('answers operation_failed for an unexpected throw, and logs it', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		createOwner.mockRejectedValue(new Error('database down'))
		expect(await createOwnerAction(input)).toEqual({ ok: false, code: 'operation_failed' })
		expect(errorSpy).toHaveBeenCalled()
	})
})
```

Create `__tests__/data-setup.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/mysql2'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the SQL test')
	},
}))

import { lockAnyAccount } from '@/lib/data/setup'

describe('lockAnyAccount (decision d)', () => {
	it('is a locking read of any one account, so only an empty table lets first run through', () => {
		const query = lockAnyAccount(drizzle.mock()).toSQL()
		expect(query.sql).toBe('select `id` from `users` limit ? for update')
		expect(query.params).toEqual([1])
	})
})
```

`__tests__/init-page.test.ts`: `hasUsers` becomes `hasAccounts`, mocked on `@/lib/data/setup`.

`__tests__/auth-page-layouts.test.ts`:

- `vi.hoisted` also creates `hasAccounts: vi.fn()`, and `vi.mock('@/lib/data/setup', () => ({ hasAccounts }))`;
- the `describe.each`'s `beforeEach` adds `hasAccounts.mockReset(); hasAccounts.mockResolvedValue(true)`;
- add:

```ts
describe('/login layout on a fresh install (charter §4.2)', () => {
	it('sends the visitor to /init before reading the session', async () => {
		getServerSession.mockReset()
		hasAccounts.mockResolvedValue(false)
		redirect.mockImplementation((to: string) => {
			throw new Error(`NEXT_REDIRECT:${to}`)
		})
		await expect(LoginLayout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT:/init')
		expect(getServerSession).not.toHaveBeenCalled()
	})
})
```

Replace `__tests__/proxy.test.ts` with:

```ts
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken }))

import { proxy } from '@/proxy'

const ORIGIN = 'http://localhost:5300'
const fetchMock = vi.fn()
const request = (path: string) => new NextRequest(new URL(path, ORIGIN))
const isNext = (response: Response) => response.headers.get('x-middleware-next') === '1'
const unauthorized = { code: 'unauthorized', message: 'Sign in required.', status: 401 }

describe('proxy', () => {
	beforeEach(() => {
		getToken.mockReset()
		getToken.mockResolvedValue(null)
		fetchMock.mockReset()
		vi.stubGlobal('fetch', fetchMock)
	})

	afterEach(() => {
		// Charter §4.2: the proxy makes no request of its own (the /api/init/status self-fetch is gone).
		expect(fetchMock).not.toHaveBeenCalled()
		vi.unstubAllGlobals()
	})

	it('answers /api/dify without a session with the 401 envelope', async () => {
		const response = await proxy(request('/api/dify/app-1/parameters'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual(unauthorized)
	})

	it('redirects a page without a session to the login page with a callbackUrl', async () => {
		const response = await proxy(request('/chat/abc?x=1'))
		expect(response.status).toBe(307)
		const location = response.headers.get('location')
		expect(location).toBe(`${ORIGIN}/login?callbackUrl=%2Fchat%2Fabc%3Fx%3D1`)
		expect(new URL(location!).searchParams.get('callbackUrl')).toBe('/chat/abc?x=1')
	})

	it.each(['/api/users', '/api/init', '/api/init/status', '/api/authx'])(
		'denies %s without a session by default',
		async path => {
			const response = await proxy(request(path))
			expect(response.status).toBe(401)
			await expect(response.json()).resolves.toEqual(unauthorized)
		},
	)

	// ADR-0018: on a sessionVersion mismatch the jwt callback strips id from the token; the cookie still decodes.
	describe('with a revoked token (no id)', () => {
		const revoked = { email: 'jane@example.com', name: 'Jane' }

		it('answers an API path with the 401 envelope', async () => {
			getToken.mockResolvedValue(revoked)
			const response = await proxy(request('/api/dify/app-1/parameters'))
			expect(response.status).toBe(401)
			await expect(response.json()).resolves.toEqual(unauthorized)
		})

		it('redirects a page to the login page with a callbackUrl', async () => {
			getToken.mockResolvedValue(revoked)
			const response = await proxy(request('/apps'))
			expect(response.status).toBe(307)
			expect(response.headers.get('location')).toBe(`${ORIGIN}/login?callbackUrl=%2Fapps`)
		})
	})

	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/init',
		'/api/auth/session',
		'/api/health',
	])('lets %s through without reading the token', async path => {
		const response = await proxy(request(path))
		expect(isNext(response)).toBe(true)
		expect(response.headers.get('location')).toBeNull()
		expect(getToken).not.toHaveBeenCalled()
	})

	it('lets a signed-in page and API request through', async () => {
		getToken.mockResolvedValue({ id: 'u1', email: 'jane@example.com' })
		for (const path of ['/apps', '/api/dify/app-1/parameters']) {
			expect(isNext(await proxy(request(path)))).toBe(true)
		}
	})

	it('classifies the decoded pathname, so an encoded /api/dify still needs a session', async () => {
		const response = await proxy(request('/api/%64ify/app-1/parameters'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual(unauthorized)
	})

	it('rejects a pathname that does not decode with a 400', async () => {
		const response = await proxy(request('/api/dify/%E0%A4%A'))
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({
			code: 'invalid_param',
			message: 'Bad request.',
			status: 400,
		})
		expect(getToken).not.toHaveBeenCalled()
	})
})
```

Replace the first two `describe` blocks of `__tests__/access.test.ts` (`isPublicPath`, `isUngatedPath`) with:

```ts
describe('isPublicPath', () => {
	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/init',
		'/init/anything',
		'/api/auth/signin',
		'/api/auth/callback/credentials',
		'/api/health',
		'/_next/static/chunk.js',
		'/_next/data/build/page.json',
		'/favicon.ico',
	])('allows %s without a session', pathname => {
		expect(isPublicPath(pathname)).toBe(true)
	})

	it.each([
		'/',
		'/apps',
		'/chat/abc',
		'/app-management',
		'/user-management',
		'/loginx',
		'/initx',
		'/_nextx',
		'/api/dify/app-1/parameters',
		'/api/users',
		'/api/init',
		'/api/init/status',
	])('requires a session for %s', pathname => {
		expect(isPublicPath(pathname)).toBe(false)
	})
})
```

with the import line reduced to `getSafeCallbackUrl, isApiPath, isPublicPath`.

`__tests__/auth-failure.test.ts`, the `initFailureKey` block:

```ts
// The first-run action answers forbidden once any account exists (Review Focus 5).
describe('initFailureKey', () => {
	it('maps the action codes', () => {
		expect(initFailureKey('forbidden')).toBe('init.already_initialized')
		expect(initFailureKey('operation_failed')).toBe('init.failed')
		expect(initFailureKey('invalid_input')).toBe('init.failed')
	})
})
```

Create `__tests__/api-routes.test.ts`:

```ts
import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Charter §5, B2 "done when": no Route Handler remains under app/api except auth, health, dify and the icon route.
// The forgot and reset password handlers stay as inherited (plan deviation 6, ADR-0024); they are named here so a
// new handler under auth/ still fails the test.
describe('app/api', () => {
	it('holds only the auth, health, Dify and icon Route Handlers', () => {
		const routes = (readdirSync('app/api', { recursive: true }) as string[])
			.map(file => file.replaceAll('\\', '/'))
			.filter(file => /(^|\/)route\.ts$/.test(file))
		expect(routes.length).toBeGreaterThan(0)
		const stray = routes.filter(
			file =>
				!/^(auth\/(\[\.\.\.nextauth\]|forgot-password|reset-password)|health|dify\/\[appId\]\/.+|apps\/\[appId\]\/icon)\/route\.ts$/.test(
					file,
				),
		)
		expect(stray).toEqual([])
	})
})
```

Run: `pnpm exec vitest run __tests__/init-actions.test.ts __tests__/data-setup.test.ts __tests__/api-routes.test.ts __tests__/init-page.test.ts __tests__/auth-page-layouts.test.ts __tests__/proxy.test.ts __tests__/access.test.ts __tests__/auth-failure.test.ts` Expected: FAIL. No `app/init/actions.ts` or `lib/data/setup.ts`; the proxy fetches; `/api/init` is ungated; `initFailureKey` takes a status; `init/route.ts` and `init/status/route.ts` are strays under `app/api` (Task 5 already deleted `users/**`).

- [ ] **Step 2: The setup DAL**

Create `lib/data/setup.ts`:

```ts
import 'server-only'

import { getDb, type Db } from '@/db'
import { users } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { hashPassword } from '@/lib/auth/password'

import { isDuplicateEntry } from './users'

/*
 * First run (charter §4.2, ADR-0024): it creates the owner. No actor: nobody can be signed in before the
 * first account exists (ADR-0024). The guard is the state itself: setup is open only while the users table is
 * empty, checked again under a locking read when the owner is written. Even if an owner row were ever removed by
 * hand, /init stays closed while any account exists.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface OwnerInput {
	name: string
	email: string
	password: string
}

/** Whether setup is done: any account exists. The login layout sends a fresh install to /init, and /init sends a set-up one to /login. */
export async function hasAccounts(): Promise<boolean> {
	const [row] = await getDb().select({ id: users.id }).from(users).limit(1)
	return row !== undefined
}

/**
 * A locking read of any one account (decision d; MySQL "Locking Reads"). On a table with rows it finds one; on an
 * empty table it locks the gap, so a second first run waits, or is rolled back as a deadlock victim, instead of
 * creating a second owner.
 */
export const lockAnyAccount = (tx: Pick<Tx, 'select'>) =>
	tx.select({ id: users.id }).from(users).limit(1).for('update')

/**
 * Creates the owner, or answers `forbidden` once any account exists (a stale tab, a replayed request). A cheap
 * check runs first, so a request anyone can send costs no bcrypt round. Two submissions at once: the locking read
 * serialises them, or InnoDB rolls one back as a deadlock victim (two gap locks on an empty table), which reaches
 * the form as operation_failed. Either way at most one owner is created. The gap lock exists only under REPEATABLE
 * READ, so the transaction asks for it rather than rely on the server's default (decision d).
 */
export async function createOwner(input: OwnerInput): Promise<ActionResult> {
	if (await hasAccounts()) return fail('forbidden')
	const password = await hashPassword(input.password)
	try {
		return await getDb().transaction(
			async tx => {
				if ((await lockAnyAccount(tx)).length > 0) return fail('forbidden')
				await tx.insert(users).values({
					id: crypto.randomUUID(),
					name: input.name,
					email: input.email,
					password,
					role: 'owner',
				})
				return ok(undefined)
			},
			{ isolationLevel: 'repeatable read' },
		)
	} catch (error) {
		// The unique email index refused the insert: another first run wrote its owner first, so setup is done.
		if (isDuplicateEntry(error)) return fail('forbidden')
		throw error
	}
}
```

The table is empty when the insert runs, so no email check is needed: a duplicate can only come from a concurrent first run, which means setup is done. Drizzle renders `lockAnyAccount` as ``select `id` from `users` limit ? for update`` with the params `[1]` (probed with `drizzle.mock()` in `tmp/owner-probe/`).

Remove `hasUsers` (and the `count` import, if unused) from `lib/data/users.ts`.

- [ ] **Step 3: The action, the page and the login layout**

Create `app/init/actions.ts`:

```ts
'use server'

import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import type { ActionResult } from '@/lib/action-result'
import { emailField, nameField, passwordField } from '@/lib/auth/fields'
import { createOwner } from '@/lib/data/setup'

const ownerInput = z.object({ name: nameField, email: emailField, password: passwordField })

/**
 * First run (charter §4.2, ADR-0024): creates the owner. No session can exist yet; the DAL opens setup only while
 * no account exists. The proxy lets the POST to /init through (a public path); this action is its own guard.
 */
export async function createOwnerAction(input: unknown): Promise<ActionResult> {
	try {
		const parsed = ownerInput.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		return await createOwner(parsed.data)
	} catch (error) {
		return toActionFailure(error, 'createOwnerAction')
	}
}
```

`app/init/page.tsx`: `hasUsers` from `@/lib/data/users` becomes `hasAccounts` from `@/lib/data/setup`, and the doc comment reads `/** Charter §4.2: once any account exists the server redirects before any form renders (redirect() throws). */`.

Replace `app/(auth)/login/layout.tsx` with:

```tsx
import { redirect } from 'next/navigation'

import { redirectSignedInUser } from '@/lib/auth/session'
import { hasAccounts } from '@/lib/data/setup'

export const dynamic = 'force-dynamic'

/**
 * A fresh install has no account, so setup comes first (charter §4.2; this replaces the proxy's
 * /api/init/status fetch). Then a signed-in visitor is sent on (ADR-0018). redirect() throws, so nothing wraps
 * it in try/catch.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
	if (!(await hasAccounts())) redirect('/init')
	await redirectSignedInUser()
	return children
}
```

- [ ] **Step 4: The form**

`components/auth/auth-failure.ts`: replace `initFailureKey` with:

```ts
/**
 * The first-run action's failure code as a translation key (charter §4.5): forbidden once any account exists
 * (another tab finished first); anything else, try again.
 */
export const initFailureKey = (code: ActionErrorCode) =>
	code === 'forbidden' ? ('init.already_initialized' as const) : ('init.failed' as const)
```

(import `type ActionErrorCode` from `@/lib/action-result`). `resetFailureKey` keeps its status parameter, because the reset form still posts to its Route Handler; the JSDoc above it (today's top comment, which is attached to it) becomes `/** The reset handler's HTTP status as a translation key (the reset flow stays on its Route Handler, ADR-0024). */`.

In `components/auth/init-form.tsx`:

- drop `useState`;
- `const { pending, run } = useActionTransition()`;
- the password item's rules use `PASSWORD_MIN`, and add `{ max: PASSWORD_MAX, message: t('auth.password_max_128') }`;
- the submit button has `loading={pending}`;
- `create` becomes:

```tsx
const create = ({ name, email, password }: InitValues) =>
	void run(async () => {
		const result = await createOwnerAction({ name, email, password })
		if (result.ok) {
			message.success(t('init.owner_created'))
			router.replace(`/login?email=${encodeURIComponent(email)}`)
			return
		}
		message.error(t(initFailureKey(result.code)))
		if (result.code === 'forbidden') router.replace('/login')
	})
```

The doc comment adds `The Server Action runs through startTransition from onFinish (ADR-0024).`

The page now says owner (owner, 2026-10-08): the account it creates is the owner (deviation 7). Rename the `init.admin_*` keys to `init.owner_*` in the three locale files and in the form (`label`, `rules` and `placeholder` props, and the success message above), and reword the texts below. `init.title`, `init.already_initialized`, `init.email_invalid`, the password and confirm-password keys, and `init.failed` keep their names and texts. `git grep -n "init\.admin_" -- app components lib hooks` must print nothing afterwards.

| key (old → new) | en | zh | ar |
| --- | --- | --- | --- |
| `init.description` | First time here: create the owner account. It keeps every permission and cannot be deleted. You will be taken to the login page when setup finishes. | 首次使用，请创建所有者账户。该账户拥有全部权限且不能被删除。初始化完成后将跳转至登录页。 | هذه هي المرة الأولى: أنشئ حساب المالك. يملك هذا الحساب كل الصلاحيات ولا يمكن حذفه. ستُنقل إلى صفحة تسجيل الدخول عند انتهاء الإعداد. |
| `init.not_initialized` | The system is not set up yet. Create the owner account. | 系统未初始化，请创建所有者账户 | لم يتم إعداد النظام بعد. أنشئ حساب المالك. |
| `admin_name` → `owner_name` | Owner name | 所有者姓名 | اسم المالك |
| `admin_name_required` → `owner_name_required` | Enter the owner's name | 请输入所有者姓名 | أدخل اسم المالك |
| `admin_name_placeholder` → `owner_name_placeholder` | e.g. Owner | 例如：所有者 | مثال: المالك |
| `admin_email` → `owner_email` | Owner email | 所有者邮箱 | البريد الإلكتروني للمالك |
| `admin_email_required` → `owner_email_required` | Enter the owner's email | 请输入所有者邮箱 | أدخل البريد الإلكتروني للمالك |
| `admin_email_placeholder` → `owner_email_placeholder` | e.g. owner@example.com | 例如：owner@example.com | مثال: owner@example.com |
| `admin_password` → `owner_password` | Owner password | 所有者密码 | كلمة مرور المالك |
| `init.submit` | Create the owner and finish setup | 创建所有者并初始化 | إنشاء المالك وإنهاء الإعداد |
| `admin_created` → `owner_created` | Owner account created. Log in with it to continue. | 所有者账户创建成功，请使用该账户登录 | تم إنشاء حساب المالك. سجّل الدخول به للمتابعة. |

The zh and ar words for the role match Task 5's `admin_users.role_owner` (所有者, المالك).

The removed `catch` was the only reader of `common.network_error_retry`. A failed action call now reaches the error boundary through the transition (`hooks/use-action-transition.ts`). Confirm with `git grep -n "network_error_retry" -- app components lib hooks`; when it prints nothing, remove the key from the three locale files.

- [ ] **Step 5: The proxy and the access lists**

Replace `proxy.ts` with:

```ts
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isApiPath, isPublicPath } from '@/lib/access'

/**
 * The optimistic check of Next's authentication guide (the proxy reads the cookie; layouts, pages, actions and
 * handlers verify the session themselves): a public path passes, any other needs a token with an id (a revoked
 * token has none, ADR-0018). First run is the login layout's job (charter §4.2), so the proxy makes no request
 * of its own.
 */
export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl

	// Classify by the decoded path (Next matches routes on the decoded path too)
	let decoded: string
	try {
		decoded = decodeURIComponent(pathname)
	} catch {
		return NextResponse.json(
			{ code: 'invalid_param', message: 'Bad request.', status: 400 },
			{ status: 400 },
		)
	}

	if (isPublicPath(decoded)) return NextResponse.next()

	const token = await getToken({ req: request })
	if (token?.id) return NextResponse.next()

	if (isApiPath(decoded)) {
		return NextResponse.json(
			{ code: 'unauthorized', message: 'Sign in required.', status: 401 },
			{ status: 401 },
		)
	}
	const loginUrl = new URL('/login', request.url)
	loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search)
	return NextResponse.redirect(loginUrl)
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

In `lib/access.ts`, replace everything above `startsWithSegment` and the two exports `isUngatedPath` and `isPublicPath` with:

```ts
// Pages and APIs reachable without a session. Everything else needs one, enforced in proxy.ts on the decoded
// pathname: pages redirect to /login and every other /api path answers 401. The layouts, pages, actions and
// /api/dify handlers verify the session themselves; the proxy's check is the optimistic one.
const PUBLIC_PREFIXES = [
	'/login',
	'/forgot-password',
	'/reset-password',
	'/init',
	'/api/auth',
	'/api/health',
	'/_next',
	'/favicon.ico',
]
```

and, after `startsWithSegment`:

```ts
export const isPublicPath = (pathname: string): boolean =>
	PUBLIC_PREFIXES.some(prefix => startsWithSegment(pathname, prefix))
```

`isApiPath` and `getSafeCallbackUrl` stay. `git grep -n "isUngatedPath" -- app components lib hooks proxy.ts e2e __tests__` must print nothing (older records under `docs/` keep the name).

- [ ] **Step 6: Delete the init routes**

```bash
git rm app/api/init/route.ts app/api/init/status/route.ts
git grep -n "api/init\|hasUsers" -- app components lib hooks proxy.ts e2e
```

Expected:

- `e2e/auth.setup.ts`, which Step 7 rewrites;
- the comments in `app/(auth)/login/layout.tsx` and `proxy.ts` that name the replaced `/api/init/status` fetch.

No code may call `/api/init` or `hasUsers`.

- [ ] **Step 7: The e2e setup through the form**

In `e2e/auth.setup.ts`:

- the test title becomes `'set up the owner through /init when needed, seed the stub apps, sign in'`;
- its parameter list drops `request`;
- replace the POST to `/api/init` and its `expect` with:

```ts
// Charter §4.6: an empty database gets its owner through the /init form (ADR-0024); on a set-up one /init
// sends the browser to /login. The annotation records which path this run took (the final full run starts empty).
await page.goto('/init')
if (new URL(page.url()).pathname === '/init') {
	await page.getByLabel('Owner name').fill('E2E Owner')
	await page.getByLabel('Owner email').fill(e2eEnv.E2E_ADMIN_EMAIL)
	await page.getByLabel('Owner password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
	await page.getByLabel('Confirm password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
	await page.getByRole('button', { name: 'Create the owner and finish setup' }).click()
	// waitForURL is bounded by the setup project's 180 s timeout, not expect's 30 s: a cold `next dev` compiles /login here.
	await page.waitForURL(/\/login\?email=/)
	setup.info().annotations.push({ type: 'first-run', description: 'owner created through /init' })
} else {
	await expect(page).toHaveURL(/\/login$/)
	setup.info().annotations.push({ type: 'first-run', description: 'database already set up' })
}
```

The app seeding and the sign-in below it stay. The labels and the button are Step 4's owner wording. The environment keeps its names (`E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`): they name the suite's account, which is the owner.

- [ ] **Step 8: Run the tests and the specs, including a first run from empty**

```bash
pnpm exec vitest run __tests__/init-actions.test.ts __tests__/data-setup.test.ts __tests__/api-routes.test.ts __tests__/init-page.test.ts __tests__/auth-page-layouts.test.ts __tests__/proxy.test.ts __tests__/access.test.ts __tests__/auth-failure.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <changed files>
pnpm exec oxfmt --write <changed files>
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test e2e/auth.spec.ts e2e/smoke.spec.ts e2e/ssr-first-paint.spec.ts e2e/shell.spec.ts
```

Expected: PASS on the three projects. The `setup` project's annotation says `owner created through /init` (the e2e database started empty after `down`), and `SELECT role FROM users` on the e2e MySQL shows one `owner`. Run the same command once more without `down`: the annotation says `database already set up`, and the specs still pass.

- [ ] **Step 9: Commit**

```bash
git add lib/data/setup.ts lib/data/users.ts app/init components/auth/init-form.tsx components/auth/auth-failure.ts app/\(auth\)/login/layout.tsx proxy.ts lib/access.ts locales e2e/auth.setup.ts __tests__/init-actions.test.ts __tests__/data-setup.test.ts __tests__/api-routes.test.ts __tests__/init-page.test.ts __tests__/auth-page-layouts.test.ts __tests__/proxy.test.ts __tests__/access.test.ts __tests__/auth-failure.test.ts
git status --short   # the git rm is already staged; nothing may be left unstaged
git commit -m "feat(auth): create the owner at first run through the DAL and drop the proxy's init fetch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 7: The account-menu password change

Charter §4.2 "Actions" (`changePassword`; the client calls next-auth's `signOut` with `/login?notice=password-changed`; the login page shows the notice; next-auth's `update()` is not used), §4.3 (`app/actions.ts`), §4.6 (the e2e case); Review Focus 5.

**Files:**

- Create: `app/actions.ts`, `components/shell/change-password-modal.tsx`, `components/shell/account-errors.ts`, `components/shell/sign-out.ts`
- Modify: `lib/data/users.ts` (`changeOwnPassword`), `components/shell/account-dropdown.tsx`, `app/(auth)/login/page.tsx`, `components/auth/login-form.tsx`, `locales/{en,zh,ar}/translation.json`
- Create (e2e): `e2e/account.spec.ts`
- Modify (e2e): `e2e/auth.spec.ts` (the forgot-password link shows only with mail configured)
- Test: `__tests__/account-actions.test.ts`, `__tests__/data-users-password.test.ts`, `__tests__/account-menu.test.ts`, `__tests__/account-errors.test.ts`, `__tests__/login-page.test.ts`

**Interfaces:**

- Consumes: `requireActor` (Task 2); `verifyPassword`, `hashPassword`; `passwordField`, `PASSWORD_MAX`, `PASSWORD_MIN` (Task 4); `useActionTransition` (Task 5); `seedUser`, `signInAs`, `deleteUsersLike` (Task 3).
- Produces:
  - `changeOwnPassword(actor, { currentPassword, newPassword }): Promise<ActionResult>` (a wrong current password answers `invalid_input` with `fieldErrors.currentPassword`);
  - `changePasswordAction(input: unknown): Promise<ActionResult>`;
  - from `components/shell/sign-out.ts`: `logout()` (moved from `account-dropdown.tsx`) and `signOutAfterPasswordChange()`;
  - `changePasswordFailureKey(code)`;
  - `getAccountMenuItems({ email, t, onChangePassword, onLogout })`;
  - `LoginForm`'s `notice?: 'password-changed'` and `mailConfigured: boolean`;
  - the `account.*` i18n keys.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/data-users-password.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selectRows, setCalls } = vi.hoisted(() => ({
	selectRows: { value: [] as unknown[] },
	setCalls: [] as Record<string, unknown>[],
}))
vi.mock('@/db', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({ where: () => ({ limit: () => Promise.resolve(selectRows.value) }) }),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				setCalls.push(values)
				return { where: () => Promise.resolve([{ affectedRows: 1 }]) }
			},
		}),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
	verifyPassword: (password: string, hash: string) => Promise.resolve(hash === `hash:${password}`),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { changeOwnPassword } from '@/lib/data/users'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user' as const }

beforeEach(() => {
	selectRows.value = [{ password: 'hash:old-password-1' }]
	setCalls.length = 0
})

describe('changeOwnPassword (charter §4.2)', () => {
	it('refuses a wrong current password on its field and writes nothing', async () => {
		expect(
			await changeOwnPassword(actor, {
				currentPassword: 'wrong-password',
				newPassword: 'new-password-1',
			}),
		).toEqual({ ok: false, code: 'invalid_input', fieldErrors: { currentPassword: ['incorrect'] } })
		expect(setCalls).toEqual([])
	})

	it('stores the new hash and bumps sessionVersion, which revokes every session', async () => {
		expect(
			await changeOwnPassword(actor, {
				currentPassword: 'old-password-1',
				newPassword: 'new-password-1',
			}),
		).toEqual({ ok: true, data: undefined })
		expect(setCalls).toHaveLength(1)
		expect(setCalls[0].password).toBe('hash:new-password-1')
		expect(setCalls[0].sessionVersion).toBeDefined()
	})

	it('answers unauthorized when the account is gone', async () => {
		selectRows.value = []
		expect(
			await changeOwnPassword(actor, {
				currentPassword: 'old-password-1',
				newPassword: 'new-password-1',
			}),
		).toEqual({ ok: false, code: 'unauthorized' })
	})
})
```

Create `__tests__/account-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, changeOwnPassword } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	changeOwnPassword: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/data/users', () => ({ changeOwnPassword }))

import { changePasswordAction } from '@/app/actions'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' }
const input = { currentPassword: 'old-password-1', newPassword: 'new-password-1' }

beforeEach(() => {
	getServerSession.mockReset()
	changeOwnPassword.mockReset()
	getServerSession.mockResolvedValue({ user: member })
})

describe('changePasswordAction', () => {
	it('lets any signed-in role change their own password', async () => {
		changeOwnPassword.mockResolvedValue({ ok: true, data: undefined })
		expect(await changePasswordAction({ ...input, id: 'someone-else' })).toEqual({
			ok: true,
			data: undefined,
		})
		// No target id is read from the client: the DAL gets the verified actor and the two passwords.
		expect(changeOwnPassword).toHaveBeenCalledWith(member, input)
	})

	it('answers unauthorized without a live session', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await changePasswordAction(input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(changeOwnPassword).not.toHaveBeenCalled()
	})

	it('answers invalid_input for a short new password without asking the DAL', async () => {
		expect(await changePasswordAction({ ...input, newPassword: 'short' })).toMatchObject({
			ok: false,
			code: 'invalid_input',
		})
		expect(changeOwnPassword).not.toHaveBeenCalled()
	})

	it('passes the DAL refusal of a wrong current password through', async () => {
		const refusal = {
			ok: false,
			code: 'invalid_input',
			fieldErrors: { currentPassword: ['incorrect'] },
		}
		changeOwnPassword.mockResolvedValue(refusal)
		expect(await changePasswordAction(input)).toEqual(refusal)
	})
})
```

Replace `__tests__/account-menu.test.ts` with:

```ts
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { getAccountMenuItems } from '@/components/shell/account-dropdown'
import { logout, signOutAfterPasswordChange } from '@/components/shell/sign-out'

// next-auth's client is mocked: the test checks what the sign-outs ask of it, not the request they make.
vi.mock('next-auth/react', () => ({ signOut: vi.fn(), useSession: vi.fn() }))
// The modal reaches a Server Action and the DAL; the menu test needs neither.
vi.mock('@/components/shell/change-password-modal', () => ({ default: () => null }))
const { signOut } = await import('next-auth/react')

// A stand-in for i18next's t that makes the key and options visible in the output.
const t = ((key: string, options?: Record<string, string>) =>
	options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction

describe('getAccountMenuItems', () => {
	it('shows the signed-in email, then change password, then log out', () => {
		const onChangePassword = vi.fn()
		const onLogout = vi.fn()
		const items = getAccountMenuItems({ email: 'jane@example.com', t, onChangePassword, onLogout })
		expect(items.map(item => item?.key)).toEqual(['account', 'change-password', 'logout'])
		expect(items[0]).toMatchObject({
			disabled: true,
			label: 'auth.signed_in_as:{"email":"jane@example.com"}',
		})
		expect(items[1]).toMatchObject({ label: 'account.change_password' })
		;(items[1] as unknown as { onClick: () => void }).onClick()
		;(items[2] as unknown as { onClick: () => void }).onClick()
		expect(onChangePassword).toHaveBeenCalledTimes(1)
		expect(onLogout).toHaveBeenCalledTimes(1)
	})
})

describe('sign-outs', () => {
	// next-auth client API, signOut(): without `redirect: false` it sets window.location.href to the callback URL,
	// a full page load, so module state of the signed-out user does not outlive the session.
	it('logs out with a full page load to the login page', async () => {
		await logout()
		expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
	})

	it('after a password change, lands on the login page with the notice (charter §4.2)', async () => {
		await signOutAfterPasswordChange()
		expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login?notice=password-changed' })
	})
})
```

Create `__tests__/account-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { changePasswordFailureKey } from '@/components/shell/account-errors'

describe('changePasswordFailureKey', () => {
	it('maps a lost session to its text and anything else to the generic failure', () => {
		expect(changePasswordFailureKey('unauthorized')).toBe('common.session_expired')
		expect(changePasswordFailureKey('operation_failed')).toBe('account.change_password_failed')
		expect(changePasswordFailureKey('invalid_input')).toBe('account.change_password_failed')
	})
})
```

`__tests__/login-page.test.ts`: the first case's query adds `notice: 'password-changed'` and expects `notice: 'password-changed'` among the props. Add:

```ts
it('passes only the known notice', async () => {
	const page = await LoginPage({ searchParams: Promise.resolve({ notice: '<script>' }) })
	expect(page).toMatchObject({ props: { notice: undefined } })
})
```

The bare-`/login` case expects `notice: undefined` too.

The page also tells the form whether mail is configured, so the "Forgot password?" link shows only when the forgot-password flow can send a link (owner, 2026-10-08: SMTP is a future feature, so the link stays hidden until it is set up, and appears by itself then). `lib/mail.ts` imports `server-only` and nodemailer, so mock it beside the form, with `const { LoginForm, isMailConfigured } = vi.hoisted(() => ({ LoginForm: () => null, isMailConfigured: vi.fn(() => false) }))` and `vi.mock('@/lib/mail', () => ({ isMailConfigured }))`. The two existing cases expect `mailConfigured: false` among the props. Add:

```ts
it('tells the form when mail is configured (the forgot-password link shows only then)', async () => {
	isMailConfigured.mockReturnValueOnce(true)
	const page = await LoginPage({ searchParams: Promise.resolve({}) })
	expect(page).toMatchObject({ props: { mailConfigured: true } })
})
```

Run: `pnpm exec vitest run __tests__/data-users-password.test.ts __tests__/account-actions.test.ts __tests__/account-menu.test.ts __tests__/account-errors.test.ts __tests__/login-page.test.ts` Expected: FAIL. None of the new modules or props exist.

- [ ] **Step 2: The DAL function and the action**

Append to `lib/data/users.ts`, with `verifyPassword` added to the `@/lib/auth/password` import:

```ts
/**
 * The account menu's password change (charter §4.2): the current password is checked with bcrypt, the new one is
 * hashed, and sessionVersion is bumped, which revokes every session including this one; the client then signs
 * out. Any role, for the actor's own account only (no target id comes from the client).
 */
export async function changeOwnPassword(
	actor: SessionUser,
	input: { currentPassword: string; newPassword: string },
): Promise<ActionResult> {
	const db = getDb()
	const [row] = await db
		.select({ password: users.password })
		.from(users)
		.where(eq(users.id, actor.id))
		.limit(1)
	if (!row) return fail('unauthorized')
	if (!(await verifyPassword(input.currentPassword, row.password))) {
		return fail('invalid_input', { currentPassword: ['incorrect'] })
	}
	await db
		.update(users)
		.set({
			password: await hashPassword(input.newPassword),
			sessionVersion: sql`${users.sessionVersion} + 1`,
		})
		.where(eq(users.id, actor.id))
	return ok(undefined)
}
```

Create `app/actions.ts`:

```ts
'use server'

import * as z from 'zod'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import type { ActionResult } from '@/lib/action-result'
import { PASSWORD_MAX, passwordField } from '@/lib/auth/fields'
import { requireActor } from '@/lib/auth/session'
import { changeOwnPassword } from '@/lib/data/users'

/*
 * The account actions the shell uses (charter §4.3: app/actions.ts). Any signed-in role; each acts on the caller's
 * own account only.
 */

const changePasswordInput = z.object({
	currentPassword: z.string().min(1).max(PASSWORD_MAX),
	newPassword: passwordField,
})

/**
 * Changes the caller's password. On success every session is revoked, this one included, and the client signs
 * out; next-auth's session update() is not used, since a revoked token could call it too (charter §4.2).
 */
export async function changePasswordAction(input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireActor()
		const parsed = changePasswordInput.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		return await changeOwnPassword(actor, parsed.data)
	} catch (error) {
		return toActionFailure(error, 'changePasswordAction')
	}
}
```

- [ ] **Step 3: The sign-outs, the error key and the modal**

Create `components/shell/sign-out.ts`:

```ts
import { signOut } from 'next-auth/react'

/**
 * Sign out and return to the login page with a full page load: next-auth's default (`redirect` true) sets
 * `window.location.href` to the callback URL (next-auth client API, signOut "Specifying a callbackUrl").
 * The chat keeps per-conversation state at module level (provider cache, history paging, x-sdk's stores),
 * so a client navigation would hand it to the next account; a fresh document starts without it (ADR-0017).
 */
export const logout = () => signOut({ callbackUrl: '/login' })

/**
 * After a password change every session is revoked, this one included (charter §4.2): signing out clears the
 * cookie and lands on the login page, which shows the notice from the query flag.
 */
export const signOutAfterPasswordChange = () =>
	signOut({ callbackUrl: '/login?notice=password-changed' })
```

Create `components/shell/account-errors.ts`:

```ts
import type { ActionErrorCode } from '@/lib/action-result'

/** The change-password form's failure text (charter §4.5); a wrong current password is shown on its field instead. */
export const changePasswordFailureKey = (code: ActionErrorCode) =>
	code === 'unauthorized'
		? ('common.session_expired' as const)
		: ('account.change_password_failed' as const)
```

Create `components/shell/change-password-modal.tsx`:

```tsx
'use client'

import { App, Form, Input, Modal } from 'antd'
import { useTranslation } from 'react-i18next'

import { changePasswordAction } from '@/app/actions'
import { useActionTransition } from '@/hooks/use-action-transition'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/fields'

import { changePasswordFailureKey } from './account-errors'
import { signOutAfterPasswordChange } from './sign-out'

const FORM_ID = 'change-password-form'

interface Values {
	currentPassword: string
	newPassword: string
	confirmPassword: string
}

/**
 * The account menu's password change (charter §4.2). The Modal unmounts its body when closed (`destroyOnHidden`),
 * and the form lives in that body with its own instance, so every opening starts empty (.claude/rules/frontend.md).
 * The OK button submits it through the HTML `form` attribute (.claude/rules/frontend.md: a button outside the
 * `<form>` submits through the native `form` attribute).
 * The action runs through startTransition from onFinish (ADR-0024).
 */
export default function ChangePasswordModal({
	open,
	onClose,
}: {
	open: boolean
	onClose: () => void
}) {
	const { t } = useTranslation()
	const { pending, run } = useActionTransition()
	return (
		<Modal
			open={open}
			onCancel={onClose}
			destroyOnHidden
			title={t('account.change_password')}
			okText={t('account.change_password')}
			cancelText={t('common.cancel')}
			okButtonProps={{ htmlType: 'submit', form: FORM_ID, loading: pending }}
		>
			<ChangePasswordForm run={run} />
		</Modal>
	)
}

function ChangePasswordForm({ run }: { run: (work: () => Promise<void>) => Promise<void> }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [form] = Form.useForm<Values>()

	const submit = ({ currentPassword, newPassword }: Values) =>
		void run(async () => {
			const result = await changePasswordAction({ currentPassword, newPassword })
			if (result.ok) {
				await signOutAfterPasswordChange()
				return
			}
			if (result.code === 'invalid_input' && result.fieldErrors?.currentPassword) {
				form.setFields([{ name: 'currentPassword', errors: [t('account.current_password_wrong')] }])
				return
			}
			message.error(t(changePasswordFailureKey(result.code)))
		})

	return (
		<Form
			form={form}
			id={FORM_ID}
			layout="vertical"
			onFinish={submit}
		>
			<Form.Item
				name="currentPassword"
				label={t('account.current_password')}
				rules={[{ required: true, message: t('account.current_password_required') }]}
			>
				<Input.Password autoComplete="current-password" />
			</Form.Item>
			<Form.Item
				name="newPassword"
				label={t('auth.new_password')}
				rules={[
					{ required: true, message: t('auth.password_required') },
					{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
					{ max: PASSWORD_MAX, message: t('auth.password_max_128') },
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
			<Form.Item
				name="confirmPassword"
				label={t('auth.confirm_password')}
				dependencies={['newPassword']}
				rules={[
					{ required: true, message: t('auth.password_required') },
					({ getFieldValue }) => ({
						validator: (_, value) =>
							value === getFieldValue('newPassword')
								? Promise.resolve()
								: Promise.reject(new Error(t('auth.password_mismatch'))),
					}),
				]}
			>
				<Input.Password autoComplete="new-password" />
			</Form.Item>
		</Form>
	)
}
```

Check `antd info Modal` (`destroyOnHidden`, `okButtonProps`) and `antd info Form` (`setFields`) before writing.

- [ ] **Step 4: The menu and the login notice**

In `components/shell/account-dropdown.tsx`:

- import `KeyOutlined` with the other icons, `useState` from React, `ChangePasswordModal`, and `logout` from `./sign-out`;
- delete the local `logout` and its comment (moved);
- `IAccountMenuItemsOptions` gains `onChangePassword: () => void`, and `getAccountMenuItems` inserts between the two existing items:

```tsx
	{
		key: 'change-password',
		icon: <KeyOutlined />,
		label: t('account.change_password'),
		onClick: onChangePassword,
	},
```

- `AccountDropdown` becomes:

```tsx
export default function AccountDropdown() {
	const { data: session } = useSession()
	const { t } = useTranslation()
	const [changingPassword, setChangingPassword] = useState(false)
	const email = session?.user?.email
	if (!email) return null
	return (
		<>
			<Dropdown
				trigger={['click']}
				menu={{
					items: getAccountMenuItems({
						email,
						t,
						onChangePassword: () => setChangingPassword(true),
						onLogout: logout,
					}),
				}}
				placement="bottomRight"
			>
				<Button
					type="text"
					icon={<UserOutlined />}
					aria-label={t('auth.signed_in_as', { email })}
					title={t('auth.signed_in_as', { email })}
				/>
			</Dropdown>
			<ChangePasswordModal
				open={changingPassword}
				onClose={() => setChangingPassword(false)}
			/>
		</>
	)
}
```

`git grep -n "logout" -- components app` must show no importer of `logout` from `account-dropdown`.

`app/(auth)/login/page.tsx`: pass `mailConfigured={isMailConfigured()}` (import from `@/lib/mail`, as `app/(auth)/forgot-password/page.tsx` does) and `notice={firstParam(params.notice) === 'password-changed' ? 'password-changed' : undefined}` to `LoginForm`, and the doc comment adds `; a known ?notice= flag becomes a notice (charter §4.2)`.

`components/auth/login-form.tsx`:

- the props gain `notice?: 'password-changed'` and `mailConfigured: boolean`;
- the `<div className={styles.forgot}>` with the "Forgot password?" link renders only when `mailConfigured` (`{mailConfigured && (…)}`); the forgot-password page and its handler stay as they are (deviation 6);
- import `Alert` from antd;
- render before the subtitle paragraph:

```tsx
{
	notice === 'password-changed' && (
		<Alert
			type="success"
			showIcon
			title={t('account.password_changed')}
			style={{ marginBottom: token.marginLG }}
		/>
	)
}
```

- [ ] **Step 5: Locale keys (new namespace `account`)**

| key | en | zh | ar |
| --- | --- | --- | --- |
| `account.change_password` | Change password | 修改密码 | تغيير كلمة المرور |
| `account.current_password` | Current password | 当前密码 | كلمة المرور الحالية |
| `account.current_password_required` | Enter your current password | 请输入当前密码 | أدخل كلمة المرور الحالية |
| `account.current_password_wrong` | The current password is incorrect | 当前密码不正确 | كلمة المرور الحالية غير صحيحة |
| `account.password_changed` | Password changed. Log in with your new password. | 密码已修改，请使用新密码登录。 | تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة. |
| `account.change_password_failed` | Could not change the password. Try again. | 修改密码失败，请重试。 | تعذّر تغيير كلمة المرور. أعد المحاولة. |

- [ ] **Step 6: The e2e case**

Create `e2e/account.spec.ts`:

```ts
import { expect, type Page, test } from '@playwright/test'

import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const openAccountMenu = (page: Page, email: string) =>
	page.getByRole('button', { name: `Signed in as ${email}` }).click()

test.describe('the account-menu password change (charter §4.6)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test.afterEach(async () => {
		await deleteUsersLike(`account-${test.info().project.name}%`)
	})

	test('refuses a wrong current password, then signs every session out and logs in with the new one', async ({
		page,
		browser,
	}, testInfo) => {
		const email = `account-${testInfo.project.name}@e2e.local`
		await seedUser({ email, password: 'old-password-1', name: 'Account user' })
		// A second browser signed in as the same account: the change must revoke it too (Review Focus 5).
		const other = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const otherPage = await other.newPage()
			await signInAs(otherPage, email, 'old-password-1')
			await signInAs(page, email, 'old-password-1')

			await openAccountMenu(page, email)
			await page.getByRole('menuitem', { name: 'Change password' }).click()
			const dialog = page.getByRole('dialog', { name: 'Change password' })
			await dialog.getByLabel('Current password').fill('wrong-password-1')
			await dialog.getByLabel('New password').fill('new-password-1')
			await dialog.getByLabel('Confirm password').fill('new-password-1')
			await dialog.getByRole('button', { name: 'Change password' }).click()
			await expect(dialog.getByText('The current password is incorrect')).toBeVisible()

			await dialog.getByLabel('Current password').fill('old-password-1')
			await dialog.getByRole('button', { name: 'Change password' }).click()
			await expect(page).toHaveURL(/\/login\?notice=password-changed$/)
			await expect(page.getByText('Password changed. Log in with your new password.')).toBeVisible()

			await page.getByLabel('Email').fill(email)
			await page.getByLabel('Password').fill('old-password-1')
			await page.getByRole('button', { name: 'Log in' }).click()
			await expect(page.getByText('Login failed. Check your email and password.')).toBeVisible()
			await page.getByLabel('Password').fill('new-password-1')
			await page.getByRole('button', { name: 'Log in' }).click()
			await expect(page).toHaveURL(/\/apps$/)

			await otherPage.goto('/apps')
			await expect(otherPage).toHaveURL(/\/login/)
		} finally {
			await other.close()
		}
	})
})
```

If the `dialog` role locator by name does not match antd's Modal title, use `page.getByRole('dialog').filter({ hasText: 'Change password' })`, as `admin-users.spec.ts` does.

In `e2e/auth.spec.ts`, the login-page test becomes (`.env.e2e` sets `SMTP_ENABLED=false`, so the link is absent in the suite; the expression keeps the test right if that ever changes):

```ts
test('the login page shows the brand header, and the forgot-password link only with mail configured', async ({
	page,
}) => {
	await page.goto('/login')
	await expect(page.getByRole('heading', { name: 'Dify App Hub' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveCount(
		e2eEnv.SMTP_ENABLED === 'true' ? 1 : 0,
	)
})
```

- [ ] **Step 7: Run the tests and the specs**

```bash
pnpm exec vitest run __tests__/data-users-password.test.ts __tests__/account-actions.test.ts __tests__/account-menu.test.ts __tests__/account-errors.test.ts __tests__/login-page.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <changed files>
pnpm exec oxfmt --write <changed files>
pnpm test
npx -y @ant-design/cli lint ./
pnpm exec playwright test e2e/account.spec.ts e2e/auth.spec.ts e2e/shell.spec.ts e2e/chat-header.spec.ts e2e/chat-mobile.spec.ts e2e/ssr-first-paint.spec.ts
```

Expected: PASS on the three projects. `shell.spec.ts`, `chat-header.spec.ts` and `chat-mobile.spec.ts` pin the account menu and the header controls; `auth.spec.ts` runs because the login form changes.

- [ ] **Step 8: Commit**

```bash
git add app/actions.ts lib/data/users.ts components/shell app/\(auth\)/login/page.tsx components/auth/login-form.tsx locales e2e/account.spec.ts e2e/auth.spec.ts __tests__/data-users-password.test.ts __tests__/account-actions.test.ts __tests__/account-menu.test.ts __tests__/account-errors.test.ts __tests__/login-page.test.ts
git commit -m "feat(account): change the password from the account menu, revoking every session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 8: Records — ADR-0024, the ADR notes, `docs/auth-gate.md`, `CLAUDE.md`, the follow-ups, CII

Charter §6; handoff "Things the plan must settle or carry" items 3 and 4.

**Files:**

- Create: `docs/decisions/0024-<slug>.md` (through `/adr-skill`, project copy `.claude/skills/adr-skill`)
- Modify: `docs/decisions/README.md`, `docs/decisions/0006-…md`, `0018-…md`, `0020-…md`, `0023-…md` (dated notes), `docs/auth-gate.md` (rewritten), `CLAUDE.md`, `docs/frontend-conventions.md`, `docs/superpowers/research/2026-10-07-backend-rework/b1-execution/follow-ups.md`, `.cii-assessment.md`

- [ ] **Step 1: ADR-0024**

Write it with the adr-skill, in the MADR shape of ADR-0023, `status: proposed` (the owner accepts it in the PR). Title: **"Keep the app's own data behind a Data Access Layer with Server Actions, and gate the admin surface by role"**.

- **Context:** upstream's `/api/users` and `/api/init` handlers (no role, only `!session` checks, Chinese messages, the revoked-session gap of ADR-0006); Next's `02-guides/data-security.md` (one data approach, DAL, DTOs, actions verify) and `02-guides/authentication.md` (session, then role; the proxy's optimistic check).
- **Options:**
  1. DAL + thin actions + the role in the JWT refreshed from the row on every request (chosen);
  2. keep the Route Handlers beside the actions (charter §2 rejected it);
  3. the role written into the JWT at sign-in only (a demotion waits up to 30 days);
  4. next-auth's database session strategy (a session table and adapter for one column);
  5. two roles with a last-admin rule (the charter's design), replaced by the owner, who cannot be removed (deviation 7).
- **Outcome and consequences:**
  - deviations 1–7 and decisions a–k of this plan's header, each with its source;
  - the scope (deviation 6, owner 2026-10-08): an internal app whose accounts will mostly come from LDAP, with a few local accounts the owner or an admin creates, so forgot and reset password keep their inherited handlers, and SMTP stays a future feature;
  - the three roles and the rank map (deviation 7): the owner manages admins and users, an admin manages users, nobody manages their own rank; the shape is documenso's `TEAM_MEMBER_ROLE_HIERARCHY` (`packages/lib/constants/teams.ts`) checked by `isTeamRoleWithinUserHierarchy` (`packages/lib/utils/teams.ts`), where a role also manages its own rank;
  - the codes `forbidden`, `cannot_delete_self` and `email_in_use` in use, and `last_admin` removed from `ActionErrorCode`;
  - the target-row lock, and first run's locking read with its deadlock outcome on an empty table;
  - the failure logging by driver code;
  - `app/api` now holds only `auth` (next-auth and the two inherited reset handlers), `health`, `dify` and the icon route.
- **Verification:** the vitest files and e2e specs Tasks 1–7 added, by name.
- **More information:** `nextjs/saas-starter` (`getUser()` reads the row per request; `validatedActionWithUser`), `create-t3-app` (the augmentation beside the auth config), documenso (`server-only/admin/update-user.ts`, narrow selects; the team role hierarchy above, fetched for this plan), from the committed survey `docs/superpowers/research/2026-10-07-backend-rework/reference-projects.md`; the charter; this plan.

Add its row to `docs/decisions/README.md`.

- [ ] **Step 2: Dated notes (2026-10-08, "backend rework B2")**

- **ADR-0006:**
  - the `/api/users/*` revoked-session gap is closed by removal (the handlers are deleted);
  - roles exist (`owner`, `admin`, `user`; the first account is the owner through `/init`; on upgrade the oldest existing account became the owner and the others admins; the owner manages admins and users, an admin manages users);
  - the Dify `user` follows the account row's email, because the `jwt` callback refreshes it. When an admin edits a user's email, that user's conversations stay under the old email in Dify and drop out of their chat list from the next request (before B2: at their next sign-in).
- **ADR-0018:**
  - actions verify the session themselves (`requireActor`, `requireAdmin`), and the `(admin)` layout and pages call `requireAdminUser()`;
  - the proxy no longer fetches `/api/init/status`, and the login layout sends a fresh install to `/init` (`hasAccounts`);
  - the `jwt` callback refreshes role, email and name.
- **ADR-0020:** the users table now takes the DAL's `UserDto` with ISO dates (`components/admin/users/user-row.ts` and `toUserRows` are gone), and `getApp` was removed from `lib/data/apps.ts` (no caller).
- **ADR-0023:**
  - the annotation routes are gated: list, update and delete need admin rights (the owner or an admin); create is open to those, or to anyone where the app enables annotations (`forbiddenResponse`);
  - `failureText` maps `forbidden` and `icon_not_found`;
  - the apps DAL asserts admin rights on writes, and `getApp` is gone;
  - `toActionFailure` logs a database error by driver code only.

- [ ] **Step 3: Rewrite `docs/auth-gate.md`**

Same headings as today ("Where it lives", "After picking upstream commits", "Known limits"), describing the B2 result:

- **The proxy and `lib/access.ts`:** one public list, the optimistic check, no init fetch.
- **`lib/auth/session.ts`:** `verifySession` (with `role`), `requireUser`, `requireAdminUser`, `requireActor`, `requireAdmin`, `assertAdmin`, `redirectSignedInUser`.
- **`lib/auth/options.ts`:** `authorizeCredentials`; the `jwt` callback's revocation and refresh.
- **`lib/auth/roles.ts`:** the three roles, `hasAdminRights` (the owner or an admin), the rank map `MANAGEABLE_ROLES` and `canManage`.
- **The layouts:**
  - `(user)`: `requireUser`;
  - `(admin)`: `requireAdminUser`;
  - login: `hasAccounts`, then the signed-in redirect;
  - forgot-password: the signed-in redirect; reset-password: none yet.
- **The DAL modules and their guards:** `apps` and `users` take an actor, and `users` applies the rank under a target-row lock; `setup` runs on state (an empty table) and creates the owner.
- **Forgot and reset password:** still the inherited Route Handlers under `app/api/auth/` and their `fetch` forms (ADR-0024). The forgot handler issues a link only with SMTP settings; without them no token is issued, and the reset page has nothing to accept. The login page links to `/forgot-password` only when SMTP is configured (`isMailConfigured()`).
- **The actions files.**
- **The Dify routes** (`resolveDifyRoute`; annotations by role).
- **The account menu:** "signed in as", change password, log out.

For "After picking upstream commits":

- keep the grep;
- add that a new admin-only action calls `requireAdmin()` and its DAL function calls `assertAdmin()`, and that a new users write checks the rank (`canManage`) against the locked target row;
- note that a new public page goes into `PUBLIC_PREFIXES`.

For "Known limits":

- no `callbackUrl` on the layout redirect;
- a token revoked mid-session is caught at the next hard load (client navigation inside a group reuses the layout), although pages and actions re-check;
- session renewal only on tab focus or sign-in;
- without SMTP there is no self-service reset (SMTP is a future feature, owner 2026-10-08): the owner sets a forgotten admin's or user's password in the users drawer, and an admin a user's. Nobody sets the owner's password there, so a forgotten owner password is recovered in the database. Write the recipe into the doc exactly as below (run from the repo root, so `bcryptjs` resolves; cost 12 is `lib/auth/password.ts` `HASH_ROUNDS`). The password is read without echo, so it stays out of the shell history, and the hash reaches MySQL through an environment variable, so the shell never expands its `$2b$12$…` (Task 9 Step 4 dry-runs it). On the production server, use its compose file:

  ```bash
  read -rs PW && export PW
  HASH=$(node -e "process.stdout.write(require('bcryptjs').hashSync(process.env.PW, 12))") && unset PW
  docker compose -f docker-compose.local.yml exec -T -e HASH="$HASH" mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "UPDATE users SET password = '\''$HASH'\'', session_version = session_version + 1 WHERE role = '\''owner'\''"'
  unset HASH
  ```

- ownership cannot be handed to another account in the app; changing the owner is a database change (a transfer is a recorded follow-up);
- `/reset-password` stays reachable while signed in. Replace today's sentence ("stays reachable while signed in on purpose … Add a layout there once the account menu offers a password change") with: B2 left the reset flow as inherited (ADR-0024), so the signed-in redirect there waits for that flow's follow-up, although the account menu now offers a password change;
- the role refresh costs nothing beyond the existing per-request `sessionVersion` query;
- B3 brings groups, per-app access and LDAP.

Remove "No roles" and the `/api/users/*` sentence.

- [ ] **Step 4: `CLAUDE.md`**

Keep the file under 200 lines (`wc -l CLAUDE.md`).

1. **Branch model** (handoff item 3). Replace the sentence that begins "A merged branch is deleted on GitHub and locally" with:

   > A merged branch is deleted on GitHub and locally. `gh pr merge <n> -R LovingCivilian/dify-app-hub --merge --delete-branch` deletes only the GitHub branch (with `-R`, `gh` leaves the local checkout alone; seen on 2026-10-08), so `git branch -d <name>` always follows. Without `gh`, it is `git push origin --delete <name>` and `git branch -d <name>`. The merge commit keeps the branch's commits in the base's history, and the PR's **Restore branch** brings it back (ADR-0019 note of 2026-10-08).

2. **Decisions:** add `- ADR-0024 The app's own data behind a server-only DAL with thin Server Actions; roles owner/admin/user in the JWT, refreshed from the row, with a rank map (the owner manages admins and users, an admin manages users); the admin surface gated in the layout, the pages, the actions and the DAL; first run creates the owner without an actor; forgot and reset password left as inherited.`
3. **Where things are**, the "Backend" bullet:
   - replace "Still upstream-shaped until B2: …" with "Still upstream-shaped: `app/api/auth/{forgot,reset}-password/` and `components/auth/{forgot,reset}-password-form.tsx` (a link is issued only with SMTP settings; left out of B2, ADR-0024)";
   - add `lib/auth/{roles,fields}.ts`, `lib/data/{users,setup}.ts`, `app/actions.ts` (change password), `app/(admin)/user-management/{actions,schemas}.ts`, `app/init/actions.ts`, `hooks/use-action-transition.ts`;
   - say that `app/api` holds only `auth` (next-auth and the two reset handlers), `health`, `dify` and `apps/[appId]/icon` (pinned by `__tests__/api-routes.test.ts`).
4. **Latest handoff** pointer (handoff item 4): `docs/superpowers/handoffs/2026-10-08-backend-b2-kickoff.md` (B2 kick-off); the previous one moves to "previous".
5. **Next step:** B3 (groups, per-app access, LDAP, its own brainstorm), then frontend phase 2. Add B2's own plan path next to B1's.
6. **Docker curl checks:**
   - add: `/api/users` and `/api/init/status` signed out → the same 401 envelope (deny by default; both handlers are deleted);
   - add: `/init` on the set-up local database → 307 to `/login`.
   - add: `curl -s localhost:5300/login | grep -c 'href="/forgot-password"'` → 0 while SMTP is off (the login page hides the link, ADR-0024).
7. **Open follow-ups, "Auth" line:**
   - remove what B2 closed: the `/api/users/*` gap, role gates and the account-menu password change, the annotations POST gate, `forbidden`/`icon_not_found`; in "Later steps the user has named", drop the account-menu "change password";
   - keep the `x-middleware-next` reliance and ADR-0018's limits;
   - add what B2 leaves open: in development, Drizzle's query logger prints parameters (hashes, keys) to the `next dev` console, and a parameter-free dev logger is a candidate (decision g); an admin's email edit moves a user's Dify identity (decision a); forgot and reset password onto the DAL and actions, with the signed-in redirect on `/reset-password`, if local accounts ever need them (ADR-0024); no ownership transfer in the app, and a forgotten owner password is a database fix while SMTP is unused (ADR-0024); the inherited forgot handler logs raw errors, so a failed query there prints the email, the user id and the reset-token hash; `auth.reset_title` still reads "Reset admin password" although user-role accounts now exist; anything else the run records.

- [ ] **Step 5: The other records**

- **`docs/frontend-conventions.md`:** a dated status line for B2, worded like B1's (the users drawer's role field and the rank-dependent Edit and Delete, the account-menu modal, the users drawer, `/init` and change-password forms on actions).
- **`b1-execution/follow-ups.md`:** mark the three "(B2)" items done, with a short "Done in B2" note and the plan path. Do not reformat the rest of the file. Stage it only if the pre-commit hook's reformat stays limited to those lines (check `git diff --stat` after staging). If it reformats the whole file, revert and note the items in ADR-0024's "More information" instead.
- **`.cii-assessment.md`:** re-check it against the branch, as AGENTS.md requires, and commit it alone.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0024-*.md docs/decisions/README.md docs/decisions/0006-*.md docs/decisions/0018-*.md docs/decisions/0020-*.md docs/decisions/0023-*.md docs/auth-gate.md CLAUDE.md docs/frontend-conventions.md
git commit -m "docs: record B2 (ADR-0024, ADR notes, auth gate, CLAUDE.md)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
git add .cii-assessment.md
git commit -m "docs: update CII assessment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 9: Whole-branch review, the gates and the PR text (controller)

Charter §2 "Process", §4.4 "Verification", §4.6 "Gates", §5 B2 "done when". The order follows B1's ruling 72: review and fixes first, then the full suite and the Docker gate on the final tree.

- [ ] **Step 1: Whole-branch review (Opus)**

Dispatch one reviewer (superpowers:requesting-code-review, `model: opus`) on `fork/overhaul..HEAD`, with:

- the charter sections;
- this plan;
- the Review Focus;
- the reviewer contract;
- B1's open follow-ups that B2 touches.

The review checks:

- every Review Focus line against its tests;
- that every admin entry point (layout, pages, actions, DAL writes, annotation routes) checks the role;
- that no DTO carries the hash or `sessionVersion`;
- that no log line in a file this branch touches can carry a hash or a key (the inherited forgot and reset handlers are out of scope and stay untouched, ADR-0024; their logging is a recorded follow-up);
- the migration SQL by hand;
- `git grep -n "process.env" -- lib app components hooks` (only `lib/env.ts`);
- that no Chinese character remains in the touched files (`git diff --name-only fork/overhaul..HEAD | xargs grep -nP '\p{Han}'`);
- oxlint over every changed file.

- [ ] **Step 2: One fix wave, one scoped re-review**

One Opus implementer applies every finding the controller accepts, with sources. One Sonnet re-review checks exactly those fixes.

- [ ] **Step 3: The full e2e suite from empty**

```bash
docker compose -f docker-compose.e2e.yml down
pnpm test:e2e
```

Expected: every spec passes on the three projects; the setup annotation says `owner created through /init`. Report the counts. Stop `pnpm dev` first if it runs.

- [ ] **Step 4: The migration on a copy of the local database (charter §4.4)**

The dump holds password hashes and API keys: it stays in `tmp/`, is never printed, and is deleted at the end of this step. The container's own environment supplies the credentials, so nothing from `.env` is read or printed.

```bash
docker compose -f docker-compose.local.yml exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > tmp/b2-local.sql
docker compose -f docker-compose.e2e.yml up -d --wait
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e -e "DROP DATABASE IF EXISTS b2copy; CREATE DATABASE b2copy; GRANT ALL ON b2copy.* TO 'e2e'@'%';"
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b2copy < tmp/b2-local.sql
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b2copy -e "SELECT COUNT(*) AS users_before FROM users;"
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/b2copy pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b2copy -e "SELECT role, COUNT(*) FROM users GROUP BY role;"
# ADR-0024: exactly one owner on a table with rows, and it is the oldest account (1 means yes).
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b2copy -e "SELECT COUNT(*) AS owners, (SELECT role FROM users ORDER BY created_at, id LIMIT 1) = 'owner' AS oldest_is_owner FROM users WHERE role = 'owner';"
# Decision k: count the accounts whose domain z.email() refuses (zod 4's domain part: labels, then a top-level
# label of two or more letters). A number only, no addresses.
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b2copy -e "SELECT COUNT(*) AS email_refused FROM users WHERE email NOT REGEXP '@([A-Za-z0-9][A-Za-z0-9-]*[.])+[A-Za-z]{2,}$';"
# Dry-run docs/auth-gate.md's owner-recovery recipe on the copy, with a throwaway password (non-interactive here).
HASH=$(PW=dry-run-password-1 node -e "process.stdout.write(require('bcryptjs').hashSync(process.env.PW, 12))")
docker compose -f docker-compose.e2e.yml exec -T -e HASH="$HASH" mysql sh -c 'mysql -uroot -pe2e b2copy -e "UPDATE users SET password = '\''$HASH'\'', session_version = session_version + 1 WHERE role = '\''owner'\''; SELECT password = '\''$HASH'\'' AS hash_intact FROM users WHERE role = '\''owner'\''"'
unset HASH
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e -e "DROP DATABASE b2copy;"
rm tmp/b2-local.sql
# Free the memory before the Docker build (~5 GB machine).
docker compose -f docker-compose.e2e.yml down
```

Expected: the role counts add up to `users_before`; `owners` is 1 and `oldest_is_owner` is 1 when `users_before` is above 0; every other account is `admin`. The owner's local database holds one test account, so expect one `owner` and no `admin`. `hash_intact` is 1: the stored hash is byte-for-byte the generated one (when `users_before` is 0 the dry run has no owner row to update; say so). `email_refused` is 0. If it is not, report the number to the owner: those accounts already cannot sign in through the login form or be saved in the drawer without a corrected email (antd's `type: 'email'` rule), and B2 adds the same refusal on the server; the owner corrects them in the drawer (or an admin, for a user). If the local volume's `__drizzle_migrations` table lacks B1's migration, it is applied too, which is the same sequence the Docker entrypoint runs.

- [ ] **Step 5: The Docker gate**

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml build app
docker compose -f docker-compose.local.yml up -d app
```

Build in the foreground; never restart a build killed for memory. Then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/health                                   # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:5300/apps                          # 307 …/login?callbackUrl=%2Fapps
curl -s localhost:5300/api/dify/<an app id>/parameters                                                # 401 {"code":"unauthorized",…}
curl -s localhost:5300/api/users; echo; curl -s localhost:5300/api/init/status; echo                 # the same 401 envelope, twice
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:5300/init                          # 307 …/login
curl -s localhost:5300/login | grep -c 'id="antd-cssinjs"'                                            # 1
curl -s localhost:5300/login | grep -c 'href="/forgot-password"'                                      # 0 while SMTP is off
docker compose -f docker-compose.local.yml exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SELECT role, COUNT(*) FROM users GROUP BY role"'
docker stats --no-stream
```

Expected: as commented. The real volume's role query shows one `owner`, its only account (the entrypoint applied the migration). `next build` ran inside the image build without `DATABASE_URL`.

- [ ] **Step 6: The PR text, then stop**

- Write the PR text to `tmp/b2-pr.md`, following `.github/PULL_REQUEST_TEMPLATE.md`:
  - Overview, with the scope note: the charter's B2 row minus forgot and reset password, which keep their inherited handlers (ADR-0024);
  - a Changes table by task;
  - Testing, with the vitest count, the e2e counts, the migration copy and the Docker gate;
  - Related Issue (none; implements ADR-0024 and the charter's B2 row);
  - the PR attribution lines.
- Ask the owner whether the run's `ledger.md` and `rulings.md` should be committed under `docs/superpowers/research/2026-10-07-backend-rework/b2-execution/`, as B1's were.
- Present the merge options (superpowers:finishing-a-development-branch).
- **Stop.** Do not push or open the PR without the owner's word. The owner's browser check comes next:
  - a `user` account turned away from the admin pages;
  - the owner's own row: Owner, fixed, and no password field;
  - an admin sees only the User role in the drawer, and no Edit or Delete on the owner's or another admin's row;
  - the owner demotes an admin, who lands on `/apps` at their next page;
  - the account-menu password change;
  - the login page without the "Forgot password?" link (SMTP off);
  - first run on an empty database, with the owner wording, if they want to see it.
