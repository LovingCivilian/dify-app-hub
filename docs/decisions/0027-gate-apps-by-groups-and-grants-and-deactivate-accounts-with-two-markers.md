---
status: accepted
date: 2026-10-10
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (B3 brainstorm, B3a plan and run)
---

# Gate apps by groups and grants, and deactivate accounts with two markers

## Context and Problem Statement

The backend rework charter's B3 row (`docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §5) asks for groups, per-app access and LDAP, and says "Specified then". The B3 design spec (`docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`) is that specification and splits the work in two: B3a (this record: account status, groups, per-app access) and B3b (directory sign-in and sync, its own record).

Until B3a, every signed-in account saw and could open every Dify app: `listApps`, `getChatApp`, `getAppAccess` and `getAppIcon` in `lib/data/apps.ts` applied no condition. Accounts could not be switched off either: the only way to stop one was to delete it, which discards `users.id` and with it the account's Dify history (ADR-0026). B3b's directory accounts need both: an audience to grant apps to (groups, filled by hand or by the directory), and an off switch that the sync can flip without touching what an admin decided.

The owner decided on 2026-10-09 (spec §2, not re-opened): #1 two plans and two PRs; #2 the owner and admins see and use every app; #3 group membership is stored for every role and takes effect only while the account is a `user`; #8 hub groups with memberships that record their source (`manual` or `directory`), access as the union of grants, no deny; #9 new apps are closed by default and the migration opens every existing app; #12 two independent deactivation markers (admin, directory), each set and cleared only by its owner. The question: how does the hub store and enforce who may use which app, and how does it switch an account off?

## Decision Drivers

- Deny by default: a new app must not leak (OWASP Authorization Cheat Sheet, "Deny by Default").
- One rule for the list and for every single-app check, applied on every request (OWASP "Validate the Permissions on Every Request"; Next's `data-security.md`: a Data Access Layer should "Perform authorization checks").
- No history lost on deactivation: `users.id` is the Dify end user (ADR-0026), so deactivating must not delete.
- B3b's sync must change only what it owns: a directory membership or marker must not overwrite an admin's decision.
- Documented approaches only (ADR-0002), with reference projects for what the docs leave open (the B3 research, `docs/superpowers/research/2026-10-09-backend-b3/groups-and-access.md`).
- Only features both MySQL and PostgreSQL have, for the planned move (ADR-0004 note of 2026-10-09).

## Considered Options

The options and the projects named below are compared, with file paths and pinned commits, in `docs/superpowers/research/2026-10-09-backend-b3/groups-and-access.md` (Open WebUI, LibreChat, Dify Community and Enterprise, Grafana, Metabase, Langfuse); GitLab's user model is `gitlabhq/gitlabhq@0739b8bf` `app/models/user.rb:616-640`.

Grants:

- Typed grant tables with foreign keys (`app_group_grants`, `app_user_grants`). Chosen. Metabase relies on foreign-key cascades.
- One polymorphic grant table with a principal-type column. LibreChat's `AclEntry` and Grafana's managed roles do this, and clean up orphans in code, since a polymorphic column cannot carry a foreign key.
- A JSON column on the app. Open WebUI did this until 2026-02, then moved to a grant table.

"Everyone":

- A mode on the app (`access_mode`: `everyone` or `restricted`). Chosen. Dify Enterprise's `private_all` is the same idea.
- A wildcard principal (Open WebUI's `user:*`, LibreChat's `PUBLIC`).
- A built-in group of all users (Metabase's "All Users").

Admins:

- Bypass: the owner and admins see every app. Chosen. Grafana's org admin, Metabase's Administrators, LibreChat's capability and Open WebUI's flag (on by default) do this.
- No bypass (Dify Enterprise).

Deactivation:

- Two independent markers, admin and directory. Chosen.
- One status column with transitions. GitLab's `blocked` and `ldap_blocked` (`gitlabhq/gitlabhq@0739b8bf`, `app/models/user.rb:616-640`) show the transition logic this would need.

Memberships:

- A `source` in the key (`manual`, `directory`). Chosen. Grafana's `external` flag keeps manual members: "it will not be removed when the user signs in".
- Directory-only groups.

## Decision Outcome

Chosen: typed grant tables with foreign keys, an `access_mode` on the app, an admin bypass, closed-by-default apps, memberships keyed by source, and two deactivation markers that also revoke sessions, because each keeps one writer per fact (deny by default, one rule, nothing the directory sync can overwrite) and uses features both engines have.

### The data model, as built (Task 1)

- `db/schema/groups.ts`: `user_groups` (UUID `id`, `name` unique, `description`, timestamps; the table is not called `groups`, a reserved word in MySQL 8.4) and `user_group_members` (primary key `(group_id, user_id, source)`, so one person can be a member by hand and through the directory, each source changed only by its owner).
- `db/schema/app-grants.ts`: `app_group_grants` `(app_id, group_id)` and `app_user_grants` `(app_id, user_id)`.
- `db/schema/apps.ts`: `dify_apps.access_mode` (`mysqlEnum`, default `restricted`). `db/schema/users.ts`: `admin_deactivated_at`, `admin_deactivated_by` (no foreign key, so deleting that admin keeps the record) and `directory_deactivated_at` (written from B3b on).
- `lib/app-access.ts` (client-safe): `ACCESS_MODES`, `MEMBERSHIP_SOURCES`, `AppAccessSettings`.
- Two migrations: `db/migrations/20261009000215_b3a-groups-access` (generated; four tables, three `users` columns, `access_mode`, six foreign keys all `ON DELETE CASCADE`) and `db/migrations/20261009000216_b3a-apps-open-to-everyone` (custom: `UPDATE dify_apps SET access_mode = 'everyone'`, so nobody loses an app on upgrade; Open WebUI's migration likewise turned unset access into a public grant). These are the first foreign keys on this line (ADR-0024 decision e deleted reset tokens in code). Pinned by `__tests__/b3a-schema.test.ts`, which asserts every foreign key in the SQL carries `ON DELETE CASCADE`.
- Deleting an app, a group or an account therefore removes its grants and memberships by construction (MySQL 8.4 "FOREIGN KEY Constraints").

### The rule (Task 3)

`visibleTo(actor)` in `lib/data/apps.ts` returns no condition for an account with admin rights, and for a `user` `access_mode = 'everyone' OR EXISTS (app_user_grants for the actor) OR EXISTS (app_group_grants joined to user_group_members for the actor, either source)`. The role comes from the actor the session refreshed, so a demoted admin sees exactly what its groups and grants give at its next request, and a promoted user sees every app. Every read applies it: `listApps`, `getChatApp`, `getAppAccess` (so every `/api/dify/*` route through `resolveDifyRoute`) and `getAppIcon`. An app the account may not use is answered as a missing one: the Dify routes `404 app_not_found`, the chat page `AppUnavailable reason="missing"`, the icon route `404 icon_not_found`, and `/chat` never redirects to it. A disabled app keeps `403 app_disabled` for accounts that may use it.

- Decision d: the condition is built with Drizzle's query builder (`or`, `eq`, `exists` with correlated subqueries), the subqueries on the standalone `QueryBuilder` from `drizzle-orm/mysql-core`, so `visibleTo` needs no connection and the tests render it on `drizzle.mock()` (Drizzle docs "Goodies: standalone query builder" and "Dynamic query building"; `exists` in "Filters"; `and()` skips an `undefined` condition, `node_modules/drizzle-orm/sql/expressions/conditions.d.ts`). Pinned by `__tests__/data-apps-access.test.ts`, `__tests__/data-apps-sync.test.ts` and `__tests__/chat-index-page.test.ts`.
- One rule for the list and the single checks is LibreChat's `getUserPrincipals` feeding both `findAccessibleResources` and `checkPermission`.
- The icon route answers `Cache-Control: private, no-cache` with its ETag and 304, so a removed grant applies at the next request: RFC 9111 §5.2.2.4, an unqualified `no-cache` response MUST NOT be used to satisfy a later request without validation. It costs one 304 per icon per page load (`app/api/apps/[appId]/icon/route.ts`, `__tests__/app-icon-route.test.ts`).
- Grants are visibility only and one level (Dify's web-app model); the gallery's empty text for an account with no grants is reworded (deviation 5).

### Groups (Tasks 4 and 5)

- `lib/data/groups.ts` (the second DAL module on ADR-0024's pattern: actor first, `assertAdmin`, DTOs without internal columns), `lib/data/db-errors.ts` (`isDuplicateEntry` moved here, `isMissingReference` for MySQL 1452), `app/(admin)/group-management/{page,actions,schemas}.ts(x)`, `components/admin/groups/`, `components/admin/account-option.ts`. Actions call `requireAdmin()` first, validate with zod and `refresh()` after writes.
- Membership grants no right, so ADR-0024's rank map does not apply: any account with admin rights manages groups and any account's membership.
- Every membership write touches only `source = 'manual'` rows (spec §2 #8), pinned by SQL-shape tests rendered on `drizzle.mock()`. A save diffs the manual members (`manualMemberChanges`: delete the removed, insert the new) instead of replacing them; documenso's recipient update and Cal.com's host update diff the same way.
- A group save reads its manual member rows with a locking read after `lockGroup` (`SELECT … FOR UPDATE`; MySQL 8.4 "Locking Reads": a plain SELECT before related writes "does not give enough protection"). One narrow deadlock is possible (an admin adds a manual member who is that group's directory member as the account is deleted); InnoDB rolls one back (1213) and the action answers `operation_failed`.
- A refusal is mapped outside the transaction, so the throw rolls it back first (Drizzle "Transactions"): 1062 answers `name_in_use`, 1452 (a picked account deleted while the form was open) answers `invalid_input` with a field error on the picker, and nothing is written.
- Group names are unique under the database collation `utf8mb4_0900_ai_ci`, so they are case- and accent-insensitive: "Cafe" and "Café" are the same name and answer `name_in_use` (MySQL 8.4 "Unicode Character Sets").
- Action tests spy on the DAL module (`vi.mock(path, { spy: true })`, Vitest docs), so an action that checks only the session fails (ADR-0024 deviation 3). Vitest's `vi.mock` "Spy Mode" (https://vitest.dev/api/vi.html#vi-mock) automocks the module without overriding the implementation, so calls can be asserted while the real DAL still runs; Next's `02-guides/authentication.md` ("Server Actions": verify the user may perform the mutation, "Return early if user is not authorized") and `data-security.md` ("Always re-verify inside the action") describe the early return the test pins. Formbricks tests a refused caller the same way (`formbricks/formbricks@27ca48e2`, `apps/web/modules/ee/role-management/actions.test.ts:152-159`: the write layer asserted not called), and Langfuse runs the real router middleware under a lower-role session (`langfuse/langfuse@c106bb3d`, `web/src/__tests__/server/automations-trpc.servertest.ts`). With the real DAL behind it, `assertAdmin` would answer `forbidden` anyway and the test could not tell.
- Group fields (decision c): a name of 1–255 characters after trimming, a description of at most 1,000 after trimming (blank stored as `NULL`), at most 10,000 member ids; group ids are UUIDs (`z.uuid()`, B1's app-id rule); account ids keep ADR-0024 decision h. The groups page counts each account once in a group's member count, and the users page shows each account's groups as read-only tags; the account picker label is `accountOptionLabel` (decision e: `Name (email)` or the email, with a "Deactivated" suffix).
- A server field error on a picker (`fieldErrors.memberIds`, `fieldErrors.access`) is shown with antd `form.setFields` and cleared in `onValuesChange` (antd Form; @rc-component/form validates only fields with rules; refine's `useForm` does the same).

### App access on the app (Task 6)

- The app drawer gains an Access section (radio "Everyone" or "Selected groups and people", then the group and people pickers); grants are saved by the app's create and update actions, in the app row's transaction (replacing the grant set inside it, as Open WebUI's `set_access_grants` and LibreChat's `bulkUpdateResourcePermissions` do). `listAdminApps(actor)` returns the app DTO plus its access, grouped once with `Map.groupBy` (MDN), and the pickers share `components/admin/drawer-popup-container.ts` (antd Select `getPopupContainer`).
- The app update first reads the app row with a locking read and answers `not_found` for an app deleted mid-save (MySQL 8.4 "Locking Reads"; Dify's `composer_service.py` and Open WebUI's `chats.py` lock the parent the same way).
- The apps table tags each app "Everyone", "Groups: N · People: M" or "Admins only".

### Deactivation (Tasks 2 and 7)

- `isActive(markers)` in `lib/auth/account-status.ts` (client-safe): both markers empty. Decision a: it fails closed (`=== null`; MDN "Strict equality": `undefined === null` is `false`), so a select that left a column out refuses the account.
- Sign-in: `authorizeCredentials` refuses an inactive account only after the password check and returns `null` like a wrong password, so the form shows the same generic message (next-auth Credentials: returning `null` shows the invalid-credentials error; OWASP Authentication "Authentication Responses": a generic message when "the account is locked or disabled"). An unknown email takes the same time as a wrong password: bcrypt compares against a fixed cost-12 `UNKNOWN_ACCOUNT_HASH` (`lib/auth/password.ts`) before `null` (OWASP "Authentication Responses"; Spring Security, Django `ModelBackend` and Devise do the same).
- Decision b: the refusal is logged by account id, `{ ...subject, reason }` with `reason` a literal union `SignInRefusalReason` (`account_inactive`), never by email (a pseudonymous subject; OWASP Logging Cheat Sheet, "Data to exclude").
- Live sessions: the `jwt` callback strips the token of an inactive row (next-auth calls it on every session access), which also covers a row deactivated by hand in the database; the admin action also bumps `sessionVersion` in the same write, ADR-0018's revocation rule. Reactivation does not revive old tokens (pinned by `e2e/deactivation.spec.ts`, which replays the cookie saved before deactivation).
- `deactivateRefusal` in `lib/data/users.ts` applies ADR-0024's rank map (the owner deactivates admins and users, an admin users, nobody themselves or the owner; `cannot_deactivate_self` is a new action code); `deleteRefusal` and `deactivateRefusal` share one private helper. The target row is read with a locking read (`lockTarget`, which also reads the marker). The admin action writes only the admin marker.
- Deactivating an account already deactivated by an admin, or reactivating an active one, is a no-op success: no second `sessionVersion` bump, no new timestamp (deviation 6).
- Deactivation also deletes the account's pending password reset tokens in the same write, as documenso's `disableUser` does (`packages/lib/server-only/user/disable-user.ts` @38ecb217; `enableUser` only clears the flag). A reset link issued before deactivation stops working and reactivation does not restore it. The inherited forgot and reset handlers stay untouched (ADR-0024 deviation 6), and the sign-in refusal (`isActive`) still guards every path.
- Kept: the row, `users.id` and so the Dify history, memberships and grants (Grafana: "Disabled users keep their custom permissions"). The users page shows a status column (Active, or Deactivated with the admin and date in a tooltip that opens on hover and on keyboard focus: antd Tooltip FAQ, "How to support keyboard accessibility?"; WAI-ARIA APG "Tooltip Pattern") and the account's groups as read-only tags.

### Deviations from the spec text (Task 8 records them)

1. `/app-management` reads `listAdminApps(actor)`, a new admin-only read, instead of `listApps`: the grant lists are admin data and the gallery, which also calls `listApps`, must not receive them (ADR-0020).
2. Two action codes beyond B3b's two in spec §7.3: `name_in_use` and `cannot_deactivate_self`.
3. A picked group or account deleted while the form was open (MySQL 1452) answers `invalid_input` with a field error on the picker and writes nothing.
4. Switching an app to `everyone` deletes its grants, which mean nothing there; switching back starts empty. The spec is silent.
5. The gallery's empty text becomes "No apps are available to you yet. Ask your administrator." (spec §4.5 says "an administrator"). It also shows to the owner or an admin on an install with no apps, as the old text did; an admin empty state that links to App management is a frontend phase-2 cosmetic candidate.
6. A no-op deactivation or reactivation succeeds without a write.
7. New Arabic strings keep the file's Western digits, as every literal digit in `locales/ar/translation.json` does. Unicode CLDR 48 makes plain `ar` default to Western digits (Arabic-Indic for `ar-SA` and `ar-EG`), LibreChat and Open WebUI write Western digits in their Arabic files, and interpolated counts show Western digits today. ADR-0005's Arabic-Indic digits apply to dates and formatted values through `Intl` `nu-arab`. If the owner wants Arabic-Indic digits for numbers, the documented route is i18next number formatting (`{{n, number(numberingSystem: arab)}}`, i18next "Formatting"), not a hand sweep (i18n follow-up).
8. The apps-table tag reads "Groups: N · People: M" instead of the spec's "N groups · M people". It is a quantity-neutral label (Android "Quantity strings": "Books: 1"), and one string with two counts would need nested i18next plurals ("If you need multiple counts, take a look at nesting"); the repo has no plural key yet, and its totals already read "Total users: {{total}}". It is not because of the parity test: Dify keeps per-language plural keys and checks them with `Intl.PluralRules`. If the owner wants the spec's wording, the route is per-language plural keys with a plural-aware parity test and a note on ADR-0005.

### Consequences

- Good, because a new app cannot leak: `restricted` is the column default, and the migration opens only the apps that existed.
- Good, because deleting an app, a group or an account removes its grants by construction, and a demoted admin's access follows its groups at once.
- Good, because deactivation keeps `users.id` and the Dify history, and B3b's sync has its own marker and its own membership source to write.
- Bad, because every app read has one more query shape (two `EXISTS` on primary-key-indexed tables; the `EXPLAIN` of `listApps`' query for a `user`, on a copy of the local database, is recorded as a dated note on this ADR).
- Bad, because the six foreign keys need `users` and `dify_apps` in the database default collation (MySQL 8.4 "FOREIGN KEY Constraints": matching character set and collation, error 3780 otherwise). A database whose tables began under upstream's Prisma init with `utf8mb4_unicode_ci` must be converted first. On any database these migrations did not create, run the check below **before** `pnpm db:migrate`: a failed run is not rolled back. MySQL commits each DDL statement implicitly (MySQL 8.4 "Statements That Cause an Implicit Commit" and "Statements That Cannot Be Rolled Back"), and Drizzle's migrator records a migration in `__drizzle_migrations` only after its last statement (`pnpm db:migrate` runs `drizzle-kit migrate` per `package.json`, and the container entrypoint runs `db/migrate.ts`, which calls Drizzle's `migrate` from `drizzle-orm/mysql2/migrator`; both record a migration only after its last statement, so a failed foreign-key statement is not rolled back). A 3780 at an `ADD CONSTRAINT` therefore leaves the four tables, the four columns and any foreign key added before it in place and the migration unrecorded, and the next run stops at the first `CREATE TABLE` (1050) until they are dropped by hand. Check with:

  ```sql
  SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'dify_apps');
  SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE();
  ```

  The owner's local volume, the only hub database (testing only, no production yet; owner, 2026-10-09), was checked on 2026-10-09: `utf8mb4_0900_ai_ci` throughout. A database created elsewhere is created by this line's migrations under the server default, so this matters only for an upgrade of a database that began elsewhere.

- Bad, because drizzle-kit 1.0.0-rc.3 drops `ON DELETE CASCADE` from a migration that creates exactly one new table with foreign keys (the snapshot records it, the SQL leaves it out; B3 research `nextauth-drizzle-antd.md` §C). This migration creates four tables and generates correctly; every later migration that creates one table with foreign keys must be checked.
- Bad, because a deactivated account's open tab stays until its next request, which is refused, and a Dify stream already running finishes.
- Neutral, because grants are visibility only and one level, and admins edit grants on the app, not on the group.

### B3b notes

- The `ldap` provider calls `isActive` after the bind (spec §6.3 step 7), as the local provider does after the password, and answers an unknown username in the same time as a wrong password (OWASP "Authentication Responses").
- B3b writes only `directory_deactivated_at` and only `directory` memberships. Its directory ADR is ADR-0029, because ADR-0028 is the sidebar below; the spec's "ADR-0028 (B3b)" means ADR-0029.

## Implementation Plan

- **Affected paths**: `lib/app-access.ts`, `db/schema/{users,apps,groups,app-grants,index}.ts`, `db/migrations/20261009000215_b3a-groups-access/`, `db/migrations/20261009000216_b3a-apps-open-to-everyone/`, `lib/auth/{account-status,options,password}.ts`, `lib/error-log.ts`, `lib/data/{apps,groups,db-errors,users}.ts`, `lib/action-result.ts`, `app/(admin)/group-management/`, `app/(admin)/app-management/{actions,schemas,page}.ts(x)`, `app/(admin)/user-management/actions.ts`, `app/api/apps/[appId]/icon/route.ts`, `components/admin/{groups,apps,users}/`, `components/admin/{account-option,drawer-popup-container}.ts`, `components/apps/app-gallery.tsx`, `locales/{en,zh,ar}/translation.json`, `e2e/fixtures/{access,hydration}.ts`, `e2e/{app-access,admin-groups,deactivation}.spec.ts`.
- **Dependencies**: none added.
- **Patterns to follow**: every new app read applies `visibleTo(actor)`; a new admin action calls `requireAdmin()` and its DAL function `assertAdmin`; a new membership writer changes only its own `source`; a new users write checks the rank against the locked target row; a migration that creates one table with foreign keys is checked for `ON DELETE CASCADE` in its SQL.
- **Patterns to avoid**: reading `dify_apps` for a user without `visibleTo`; deleting an account to block it; an admin action writing the directory marker or a directory membership; a membership writer that deletes and re-inserts rows of the other source; returning grant lists to the gallery.
- **Configuration**: none.
- **Migration steps**: `pnpm db:migrate` applies both migrations; existing apps become `everyone`, new apps `restricted`. Before upgrading a database these migrations did not create, run the collation query above and convert first: a collation mismatch (3780) fails the migration midway, and its DDL is not rolled back (Consequences).

### Verification

- [x] `__tests__/b3a-schema.test.ts`: the tables, columns, six cascading foreign keys and the custom migration.
- [x] `__tests__/{account-status,auth-options,auth-password,error-log}.test.ts`: `isActive` fails closed; each marker refuses sign-in and strips the token; the unknown-email hash; the refusal log carries the id, no email.
- [x] `__tests__/{data-apps-access,data-apps-sync,data-apps,chat-index-page,app-icon-route,dify-route}.test.ts`: `visibleTo` rendered for a user and an admin on every read; the icon route's header; `resolveDifyRoute`'s 404.
- [x] `__tests__/{data-db-errors,data-groups,group-management-actions,group-management-schemas,group-management-page,group-errors,account-option}.test.ts`: manual-only writes, locking reads, 1062 and 1452 mapping, actions through the real session chain with the DAL spied.
- [x] `__tests__/{app-management-actions,app-management-schemas,app-management-page,admin-app-row,app-form-values}.test.ts` and `__tests__/{data-users,user-management-actions,user-management-rank,user-management-page,user-errors}.test.ts`: grants in the save, the app lock, the rank matrix on deactivation, the reset-token delete order.
- [x] `e2e/app-access.spec.ts` (gallery, chat page, a Dify route and the icon route, without and with each kind of grant, and the empty gallery), `e2e/admin-groups.spec.ts`, `e2e/admin-apps.spec.ts` (the Access section), `e2e/deactivation.spec.ts` (an open session refused, the wrong-password text for the right password, an old cookie refused after reactivation, the status tooltip on keyboard focus). Results as run on the branch: 2026-10-09, `pnpm exec playwright test e2e/app-access.spec.ts` after Task 3: 5 of 5 per project; 2026-10-10, `pnpm exec playwright test e2e/deactivation.spec.ts e2e/admin-users.spec.ts e2e/auth.spec.ts e2e/roles.spec.ts e2e/account.spec.ts` after Task 7: 73 passed; unit gate `pnpm test --exclude 'tmp/**'` at the end of Task 7: 109 files, 1323 tests passed.
- [x] Task 9: the migration on a copy of the local database and `EXPLAIN` of the gallery's access rule for a `user` (More Information, note of 2026-10-10); the full e2e suite, 2026-10-10: `pnpm test:e2e` from a fresh database, 515 passed, 20 skipped, 0 failed (23.0 min).
- [ ] Task 9: the Docker gate.
- [ ] The owner's browser check: a `user` with and without a grant, the groups page, an app's Access section, deactivating and reactivating an account.

## Pros and Cons of the Options

### Typed grant tables with foreign keys

- Good, because the database removes grants with their app, group or account (Metabase relies on the same cascade).
- Bad, because there are two tables where a polymorphic one would be one.

### One polymorphic grant table

- Good, because it is one table and extends to new principal types.
- Bad, because a polymorphic column cannot carry a foreign key; LibreChat and Grafana clean orphans in code.

### A JSON column on the app

- Good, because it is the smallest change.
- Bad, because nothing removes a deleted group's id from it and the access condition cannot join it; Open WebUI moved off it.

### A mode on the app for "everyone"

- Good, because "everyone" is one column, not a row per account or a wildcard to special-case.
- Neutral, because switching to `everyone` makes the grants meaningless (deviation 4).

### A wildcard principal or a built-in group

- Bad, because a wildcard needs a special case in every grant query, and a built-in group needs a membership row per account kept in step with account creation.

### Admin bypass

- Good, because admins keep a view of every app they manage, as in most surveyed projects.
- Bad, because the owner and admins cannot test what a user sees without a second account.

### Two deactivation markers

- Good, because each writer owns one fact, so the sync cannot undo an admin's decision and the other way round.
- Bad, because two columns say "inactive" and every reader must use `isActive`.

### One status column with transitions

- Bad, because GitLab's two flags and their transition rules show the cost: the directory's "blocked" and the admin's "blocked" need extra states to avoid overwriting each other.

## More Information

### Note, 2026-10-10 (migration copy and query plan)

- The local volume (the only hub database, owner 2026-10-09) was dumped and restored as a copy on the e2e MySQL. Source collations from `information_schema` on the local stack: schema `utf8mb4` / `utf8mb4_0900_ai_ci`; `users.id` and `dify_apps.id` `utf8mb4_0900_ai_ci`. Before: 4 apps, 8 applied migrations. `drizzle-kit migrate` on the copy applied both B3a migrations; after: every app `everyone` (4 of 4), no inactive account, 6 foreign keys with `DELETE_RULE = 'CASCADE'`, 10 applied migrations, every table `utf8mb4_0900_ai_ci`.
- `EXPLAIN` of the gallery's access rule for a `user` on that copy: `dify_apps` is scanned (4 rows, then sorted by `created_at`); the direct-grant subquery is an `eq_ref` covering lookup on `app_user_grants`' primary key `(app_id, user_id)`; the group subquery is a covering `ref` lookup on `app_group_grants`' primary key `(app_id)` joined to a covering `ref` lookup on `user_group_members`' primary key `(group_id, user_id)`. Both subqueries read primary-key prefixes only ("Using index"); the outer scan grows with the number of apps, not with grants.

Spec: `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md` (§2, §3.1, §4, §5, §10, §12). Plan: `docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md`. Research: `docs/superpowers/research/2026-10-09-backend-b3/` (start at its README; `groups-and-access.md` for the option comparison).

Follow-ups (spec §12 and the run): sign-in throttling for both tabs, designed with Active Directory's lockout in mind; "switch to directory sign-in" for a local account; an admin Logs tab; the PostgreSQL move (ADR-0004 note); `.dockerignore`'s `!**/.env.example` exception; an admin empty state in the gallery; Arabic-Indic digits for numbers through i18next number formatting if the owner wants them.

Sources: OWASP Cheat Sheet Series: Authorization ("Deny by Default", "Validate the Permissions on Every Request"), Authentication ("Authentication Responses"), Logging ("Data to exclude"); Next 16.3.4 bundled docs `02-guides/data-security.md`, `02-guides/server-actions.md`, `03-api-reference/04-functions/refresh.md`; next-auth v4 Credentials provider and callbacks (Context7 `/websites/next-auth_js`); Drizzle (Context7 `/drizzle-team/drizzle-orm-docs`: Goodies standalone query builder, Dynamic query building, Filters, Transactions); MySQL 8.4 "FOREIGN KEY Constraints", "Locking Reads", "Unicode Character Sets", "Keywords and Reserved Words", Error Reference (1062, 1213, 1452); RFC 9111 §5.2.2.4; MDN "Strict equality", "Map.groupBy()"; Unicode CLDR 48; i18next "Plurals" and "Formatting"; Android "Quantity strings (plurals)"; Vitest `vi.mock` `spy`; antd 6.6.5 Form and Select (CLI); reference projects: Metabase, LibreChat `e1dfc104`, Open WebUI `8bd8b4f`, Grafana, Dify Enterprise docs, GitLab `0739b8bf`, documenso `38ecb217`, Cal.com `54343aa6`, Dify `2b65f0e8`, refine `2352eb5b`, Spring Security, Django, Devise. Paths and pinned commits:

- Option comparison (LibreChat, Open WebUI, Dify, Grafana, Metabase, Langfuse): `docs/superpowers/research/2026-10-09-backend-b3/groups-and-access.md`, pinned there.
- Constant-time unknown account: Django `django/django@ce285ce0` `django/contrib/auth/__init__.py:391-399` and `backends.py:67-79`; Spring Security `spring-projects/spring-security@126f02bf` `core/.../dao/DaoAuthenticationProvider.java` (`mitigateAgainstTimingAttack`); Devise `heartcombo/devise@05811fb8` `lib/devise/strategies/database_authenticatable.rb:19-22`; Better Auth `better-auth/better-auth@f5569701` `packages/better-auth/src/api/routes/sign-in.ts:539-547`.
- Deactivation: documenso `documenso/documenso@38ecb217` `packages/lib/server-only/user/disable-user.ts` and `enable-user.ts`; GitLab `gitlabhq/gitlabhq@0739b8bf` `app/models/user.rb:616-640`.
- Grant replacement: Open WebUI `open-webui/open-webui@8bd8b4f` `backend/open_webui/models/access_grants.py:443-478` (`set_access_grants`); LibreChat `danny-avila/LibreChat@e1dfc10` `packages/api/src/acl/accessControlService.ts:406-735` (`bulkUpdateResourcePermissions`). Parent-row locks: Dify `langgenius/dify@2b65f0e8` `api/services/agent/composer_service.py:2048-2050`, Open WebUI `backend/open_webui/models/chats.py:722-730`.
- Member diffs: documenso `packages/lib/server-only/recipient/set-document-recipients.ts:103-121,257-266`; Cal.com `calcom/cal.com@54343aa6` `packages/trpc/server/routers/viewer/eventTypes/heavy/update.handler.ts:466-483`. Locking clause asserted by rendering: `drizzle-team/drizzle-orm@eab8bedb` `integration-tests/tests/mysql/mysql-common.ts:2305-2328`.
- Field errors: refine `refinedev/refine@2352eb5b` `packages/antd/src/hooks/form/useForm.ts:172-231`. Drawer forms owning their `Form.useForm()`: pro-components `ant-design/pro-components@1c070b9b` `DrawerForm`, refine `useDrawerForm`.
- Arabic digits: LibreChat `client/src/locales/ar/translation.json:72-73,107-108`, Open WebUI `src/lib/i18n/locales/ar/translation.json:98-102`, CLDR 48 `common/main/ar.xml` (`defaultNumberingSystem` inherited `latn`) and `ar_SA.xml`, `ar_EG.xml` (`arab`). Plurals: Dify `web/i18n/__tests__/plural-selector.spec.ts`, Open WebUI `ar/translation.json:20-25`.
- Library docs: RFC 9111 §5.2.2.4 (https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.4); OWASP Authentication (https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#authentication-responses); i18next Plurals and Formatting (https://www.i18next.com/translation-function/plurals, https://www.i18next.com/translation-function/formatting).
