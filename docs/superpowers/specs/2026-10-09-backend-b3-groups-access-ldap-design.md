# Backend rework B3: groups, per-app access and directory (LDAP) accounts — design

Date: 2026-10-09 · Status: draft for the owner's review · Scope: sub-project B3 of the backend rework on `fork/overhaul` (charter `docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §5, whose B3 row says "Specified then"; this document is that specification) · Delivery: two plans and two PRs, **B3a** (account status, groups, per-app access) then **B3b** (directory sign-in and sync) · Research: `docs/superpowers/research/2026-10-09-backend-b3/` (start at its README)

## 1. Goal

People in the company directory sign in to App Hub with their directory username and password. Each person sees only the Dify apps granted to them, directly, through a group, or to everyone. Someone who leaves the directory, or is disabled there, loses access within one sync period (and at once at their next sign-in), while their account, its `users.id` and so its Dify history (ADR-0026) are kept. Admins manage groups, app access and account status in the existing admin area. The hub works with Active Directory first and with any LDAPv3 server through settings.

## 2. Decisions taken in the brainstorm (do not re-open)

Owner's answers of 2026-10-09, in the order they were taken.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Slicing | One spec for B3, delivered as two plans and two PRs: B3a, then B3b from `fork/overhaul` after B3a merges. |
| 2 | Admin bypass | The owner and admins see and use every app; grants restrict only `user` accounts. Most surveyed projects bypass (Grafana org admin, Metabase Administrators, LibreChat capability, Open WebUI behind a flag on by default); Dify Enterprise is the exception (`groups-and-access.md`). |
| 3 | Groups and roles | Group membership is stored for every role and takes effect only while the account is a `user` (a demoted admin's groups apply at once; the directory sync treats every account alike). Groups are an audience, roles are rights. |
| 4 | Directory type | Active Directory first; any LDAPv3 server through settings with AD defaults. Vendor differences are settings (attribute names, filters), except the documented `objectGUID` byte order. "Disabled" is whatever the user filter excludes. |
| 5 | Login name | Directory users sign in with their Windows username (`sAMAccountName`); local accounts keep their email. |
| 6 | Login page | A switch between "Directory account" and "Local account", as GitLab's sign-in tabs and Open WebUI's LDAP mode do. |
| 7 | Roles of directory accounts | Set in the hub only: a new directory account starts as `user`; the owner or an admin promotes it under B2's rank map. No role mapping from directory groups (charter deviation, §11). |
| 8 | Group sources | Hub groups, each optionally linked to one or more directory groups (Grafana Team Sync, Metabase group mappings). Memberships record their source (`manual` or `directory`); the sync changes only `directory` memberships, so an admin can add someone by hand to a linked group (Grafana: "you can manually add a user as member of a team, and it will not be removed when the user signs in"). A user can belong to several groups; access is the union, with no deny. |
| 9 | New apps | Closed by default: a new app is visible to the owner and admins only until granted (OWASP "Deny by Default"; Dify Enterprise web apps). The migration grants every existing app to everyone (Open WebUI's migration turned unset access into a public grant). |
| 10 | Same email as a local account | A directory sign-in whose email belongs to a local account is refused; an admin resolves it. A "switch to directory sign-in" for the person (Mattermost's "Switch to AD/LDAP") is a follow-up. |
| 11 | Entry without email | Refused. Every account keeps an email (`users.email` stays `NOT NULL`, unique). A duplicate email between two directory entries is refused the same way; a sync keeps the old email and reports the conflict. |
| 12 | Lifecycle | Re-checked on a schedule and at each directory sign-in; removed or disabled means "not matched by the user filter"; two independent deactivation markers (admin, directory), each set and cleared only by its owner; directory deactivation lifts itself when the entry matches again, admin deactivation only by an admin; an unreachable directory changes nothing; deletion stays an admin action. |
| 13 | Directory settings | Environment variables: an all-or-nothing `LDAP_*` block in `lib/env.ts`, like SMTP. Group links are data, edited on the groups page. |
| 14 | Sync trigger | A croner job started from `instrumentation.ts` `register()`, scheduled by a cron expression (`LDAP_SYNC_SCHEDULE`, default `0 * * * *`, `off` to disable) in an optional IANA time zone (`LDAP_SYNC_TIMEZONE`). |
| 15 | Database | B3 stays on MySQL 8.4 (ADR-0004). The owner wants to move to PostgreSQL after B3 or after frontend phase 2; B3's schema uses only features both engines have (§12). |
| 16 | Sign-in messages | Generic for every account-related refusal (OWASP Authentication Cheat Sheet: "a generic error message regardless of whether … The account is locked or disabled"); the exact reason goes to the server log. Only "the directory is unreachable" is shown specifically. |
| 17 | Sign-in throttling | Deferred to its own design (follow-up), with Active Directory's lockout policy in mind. |
| 18 | Transport | `LDAP_ENCRYPTION` is `ldaps`, `starttls` or `none`, chosen explicitly (no default). `none` is supported because the owner's directory is reached today by IP and port without TLS (Mattermost "Connection security: None", GitLab `encryption: 'plain'`, Grafana `use_ssl = false`). |

## 3. Data model

Drizzle schema under `db/schema/`, migrations through `drizzle-kit generate` (and `generate --custom` for data), applied by the container entrypoint as today. Each PR has one generated migration, plus a custom migration where rows need values. Table and column names avoid reserved words (MySQL 8.4 "Keywords and Reserved Words" lists `GROUPS` as reserved, so the groups table is `user_groups`).

### 3.1 B3a

| Table | Columns and keys |
| --- | --- |
| `users` (changed) | `admin_deactivated_at` `datetime(3)` null; `admin_deactivated_by` `varchar(36)` null (the admin's `users.id`, no foreign key, so deleting that admin keeps the record); `directory_deactivated_at` `datetime(3)` null (written from B3b on). |
| `user_groups` (new) | `id` `varchar(36)` primary key (UUID v4, as `users.id`); `name` `varchar(255)` not null, unique; `description` `text` null; `created_at`, `updated_at` (`$onUpdate`). |
| `user_group_members` (new) | `group_id` → `user_groups.id` `ON DELETE CASCADE`; `user_id` → `users.id` `ON DELETE CASCADE`; `source` `enum('manual','directory')` not null; `created_at`. Primary key `(group_id, user_id, source)`: a person can be a member by hand and through the directory at once, and each source is changed only by its owner. |
| `dify_apps` (changed) | `access_mode` `enum('everyone','restricted')` not null default `restricted`. |
| `app_group_grants` (new) | `app_id` → `dify_apps.id` cascade; `group_id` → `user_groups.id` cascade; primary key `(app_id, group_id)`. |
| `app_user_grants` (new) | `app_id` → `dify_apps.id` cascade; `user_id` → `users.id` cascade; primary key `(app_id, user_id)`. |

Custom migration (B3a): `UPDATE dify_apps SET access_mode = 'everyone'` for the rows that existed before the column, so nobody loses an app on upgrade.

Two typed grant tables rather than one table with a principal-type column, because a polymorphic column cannot carry a foreign key; LibreChat and Grafana, which use the polymorphic form, delete orphans in code, while Metabase relies on foreign-key cascades (`groups-and-access.md`). These are the first foreign keys on this line (the existing tables have none; ADR-0024 decision e deleted reset tokens in code); ADR-0027 records the pattern. MySQL 8.4 requires matching storage engine, character set and collation for `varchar` keys on both sides (MySQL 8.4 "FOREIGN KEY Constraints"); the referenced `id` columns are all `varchar(36)` under the database default.

### 3.2 B3b

| Table | Columns and keys |
| --- | --- |
| `users` (changed) | `source` `enum('local','ldap')` not null default `local`; `password` becomes nullable; `directory_id` `varchar(64)` null, **unique** (the canonical key text: `objectGUID` as a lowercase GUID string, `entryUUID` lowercased); `directory_id_attribute` `varchar(64)` null (the attribute that produced the key, so a change of `LDAP_ID_ATTRIBUTE` is detected, §6.4); `directory_username` `varchar(255)` null (the login attribute's value, for display and search). `CHECK ((source = 'local' AND password IS NOT NULL AND directory_id IS NULL) OR (source = 'ldap' AND password IS NULL AND directory_id IS NOT NULL))`. |
| `user_group_directory_links` (new) | `group_id` → `user_groups.id` cascade; `directory_group_id` `varchar(64)` (the directory group's canonical key, as for users); `directory_group_name` `varchar(255)` (shown on the groups page, refreshed by the sync); `missing_since` `datetime(3)` null (the group was not found at the last sync); primary key `(group_id, directory_group_id)`. |
| `directory_sync_runs` (new) | `id` UUID primary key; `slot` `varchar(64)` not null, **unique** (the scheduled time, e.g. `schedule:2026-10-09T13:00Z`, or `manual:<run id>`); `trigger` `enum('schedule','startup','manual')`; `started_at`, `finished_at` null; `outcome` `enum('running','succeeded','failed','empty','id_attribute_changed')`; counts (`entries_seen`, `deactivated`, `reactivated`, `updated`, `conflicts`, `memberships_added`, `memberships_removed`); `error_code` `varchar(64)` null (a fixed code, never a message with secrets). Runs older than 90 days are deleted by the run itself. |

The `CHECK` is enforced since MySQL 8.0.16, and a `NULL` result passes, so the columns it reads are written explicitly (`source` is `NOT NULL`). Adding it fails if a row breaks it, so it is added after the column changes in the same migration; a later migration that modifies `password` or `source` must drop and re-add it in the same statement (MySQL 8.4 "CHECK Constraints", `nextauth-drizzle-antd.md` §D). A unique index permits several `NULL`s, so every local account can have `directory_id` null.

**drizzle-kit defect:** with drizzle-kit 1.0.0-rc.3, a migration that creates exactly one new table with foreign keys leaves `ON DELETE`/`ON UPDATE` out of the SQL while the snapshot records `CASCADE` (reproduced in `nextauth-drizzle-antd.md` §C; also in rc.4; no upstream issue found). Migrations creating several tables, or adding a foreign key to an existing table, are generated correctly. Each plan checks every generated `migration.sql` for `ON DELETE CASCADE` before the migration is committed.

## 4. Per-app access (B3a)

### 4.1 The rule

An account may use an app when any of these holds: it has admin rights (`hasAdminRights`, the owner or an admin); the app's `access_mode` is `everyone`; an `app_user_grants` row names it; an `app_group_grants` row names a group it belongs to (any `user_group_members` row, either source). Nothing denies (every surveyed project grants on any match: "'Deny' permissions do not exist", Open WebUI; "the _more permissive_ setting", Metabase). Deactivated accounts never reach the rule, since they have no session (§5).

### 4.2 Enforcement

One condition, built once in the apps Data Access Layer (`lib/data/apps.ts` or a helper module beside it): for a `user`, `access_mode = 'everyone' OR EXISTS (… app_user_grants …) OR EXISTS (… app_group_grants JOIN user_group_members …)` against the actor's id; for an account with admin rights, no condition. Every read applies it:

- `listApps(actor)`: the `/apps` gallery and `/chat`'s first app;
- `getChatApp(actor, id)`: the chat page;
- `getAppAccess(actor, id)`: every `/api/dify/*` route through `resolveDifyRoute` (`lib/dify/route.ts`);
- `getAppIcon(actor, id)`: the icon route.

`/app-management` keeps calling `listApps` with an admin actor, so it lists every app. The list filter and the single-app checks therefore share one rule, as LibreChat's `getUserPrincipals` feeds both `findAccessibleResources` and `checkPermission`; Next's guide puts authorization in the DAL ("A Data Access Layer should: … Perform authorization checks", `data-security.md`), and OWASP asks for a check "on _every_ request for the _specific_ object" (Authorization Cheat Sheet).

An app the account may not use is answered exactly as a missing one: the Dify routes `404 app_not_found`, the chat page `app-unavailable`, the icon route 404. A disabled app keeps `403 app_disabled`, for accounts that may use it.

### 4.3 Groups page

`/group-management` in `app/(admin)/` (gated by the `(admin)` layout and `requireAdminUser()`, ADR-0024), with a "Groups" entry in `components/shell/admin-shell.tsx`.

- A table: name, description, member count, number of apps granted (and, in B3b, the linked directory groups, with a "missing" tag when `missing_since` is set).
- A drawer to create or edit a group: name, description, a member picker for **manual** members (all accounts, deactivated ones tagged). In B3b, directory members are listed read-only with a "Directory" tag, and a "Directory groups" field links groups (§6.5).
- Delete with a confirmation; the cascade removes its memberships, grants and links.
- Membership is edited here only. The users table shows each account's groups as read-only tags.
- Rights: any account with admin rights manages groups and any account's membership; membership grants no rights, so the rank map does not apply.
- Server Actions in `app/(admin)/group-management/{actions,schemas}.ts` (`requireAdmin()`, zod), a DAL module `lib/data/groups.ts` (actor first, `assertAdmin`), DTOs without internal fields, `refresh()` after writes (ADR-0024 patterns).

### 4.4 App access on the app

The app drawer (`components/admin/apps/app-form-drawer.tsx`) gains an **Access** section: a radio "Everyone" / "Selected groups and people", and for the second, a group picker and a people picker. The apps table tags each app "Everyone", "N groups · M people", or "Admins only" (restricted with no grants). Grants are saved by the app's create and update actions (`app/(admin)/app-management/actions.ts`) through the apps DAL, in the same transaction as the app row. Grafana, Open WebUI and Dify all edit grants on the resource (`groups-and-access.md`).

### 4.5 The gallery

A `user` with no app gets the empty state "No apps are available to you yet. Ask an administrator." Every change applies at the person's next request, since each request reads the rule.

## 5. Account status (B3a)

- `isActive(row)` (pure, client-safe beside `lib/auth/roles.ts`): both deactivation markers are `NULL`.
- **Sign-in:** both providers refuse an inactive account only after the credentials check (the local password, or the directory bind), so a wrong password and a deactivated account take the same path and the same generic answer (§7.3).
- **Live sessions:** deactivation (admin or directory) bumps `sessionVersion` in the same write, so the `jwt` callback strips `id`, `role` and `sessionVersion` at the token's next use (ADR-0018's revocation rule, `lib/auth/options.ts`). The `jwt` callback also strips them when the row is inactive, which covers a row deactivated by hand in the database. Reactivation does not revive old tokens; the person signs in again. GitLab ("Signed out") and Mattermost ("all the user's current sessions are revoked") do the same.
- **Admin action:** "Deactivate" and "Reactivate" on the users page, through Server Actions in `app/(admin)/user-management/actions.ts` and DAL functions in `lib/data/users.ts` that lock the target (`lockTarget`, ADR-0024 decision d) and check the rank against the locked row (`canManage`): the owner deactivates admins and users, an admin deactivates users, nobody deactivates themselves or the owner. They write only the admin marker (`admin_deactivated_at`, `admin_deactivated_by`).
- **What deactivation keeps:** the row, `users.id` (Dify history), group memberships and grants; reactivation restores them (Grafana: "Disabled users keep their custom permissions").
- **Users page:** a status column (Active; Deactivated, with the admin and date in a tooltip; in B3b, Not in directory), and in B3b a source column (Local, Directory). Delete stays.

## 6. Directory accounts (B3b)

### 6.1 Library

`ldapts` 9.2.0 (MIT, pure JavaScript, Node ≥ 22, released 2026-09-15; n8n uses it for LDAP login and sync, Backstage for its LDAP catalog sync). `ldapjs`, which next-auth v4's LDAP tutorial uses, was decommissioned by its author on 2024-05-14 and is archived (`ldap-client.md` §1). next-auth's tutorial is not copied: it uses the typed DN as the identity and puts the password in the JWT. Server-only module folder `lib/directory/` (connection, entry mapping, sign-in, sync, schedule); its DAL functions in `lib/data/directory.ts`.

`lib/data/directory.ts` takes no actor: its callers are the `ldap` provider (no session exists at sign-in) and the sync (no person). It is the second actor-less DAL module after `lib/data/setup.ts` (ADR-0024 deviation 2), and its guard is its input: each function accepts only an entry obtained from a successful directory bind or a complete, error-free directory search, never raw form input. "Sync now" is admin-gated before it calls the sync.

### 6.2 Connection

A fresh client per sign-in and per sync, with `connectTimeout` and `timeout` set (both default to off in ldapts), and `unbind()` in `finally`.

- `ldaps`: `ldaps://` URL, `tlsOptions` with the CA from `LDAP_CA_FILE` when set.
- `starttls`: `ldap://` URL, `startTLS(tlsOptions)` before any bind, with the TLS options (including `servername`) passed to `startTLS()` only: options given to the constructor switch ldapts to direct TLS, and a transparent reconnect after a dropped socket opens a plain connection (`Client.ts:219-221, 772-780, 889-935` at `ldapts@b38cfc3`), so a client is never reused after an error.
- `none`: `ldap://` URL, no TLS. The hub logs a warning at start, and the directory status panel shows "Unencrypted connection". RFC 4513 §5.1.3: the simple bind with a password "is not suitable for authentication in environments without confidentiality protection"; this mode is the owner's explicit choice for a directory reached by IP and port (§2 #18).
- No setting skips certificate verification; a private CA goes in `LDAP_CA_FILE`.

### 6.3 Sign-in

The login page (`app/(auth)/login/page.tsx`, `components/auth/login-form.tsx`) shows antd `Tabs centered` with "Directory account" (default) and "Local account" when the `LDAP_*` block is set, and the current form otherwise. Ant Design Pro's own login page (antd 6) uses `<Tabs centered>` for this switch; antd's `Segmented` would fit too (`nextauth-drizzle-antd.md` §E). The directory tab asks for a username and a password, the local tab for an email and a password; each calls `signIn('<provider id>', { redirect: false, … })`.

A second next-auth Credentials provider, `id: 'ldap'`, beside the existing one (next-auth v4: "You can specify more than one credentials provider by specifying a unique `id` for each one"). Its `authorize`:

1. Refuse a blank username or an **empty password before any bind** (RFC 4513 §5.1.2: "Clients SHOULD disallow an empty password input"; ldapts sends an empty password as is, `BindRequest.ts:31`). Bound the lengths (username ≤ 255 characters).
2. Connect (§6.2) and bind as the service account.
3. Search the user base: `(&<LDAP_USER_FILTER>(<LDAP_LOGIN_ATTRIBUTE>=<username>))` with the value escaped (RFC 4515; ldapts `escapeFilter` or filter classes, `ldapts >= 9`), `scope: 'sub'`, `sizeLimit: 2`, `explicitBufferAttributes: [<id attribute>]` always (without it, a binary value whose bytes happen to be valid UTF-8 comes back as a string, `SearchEntry.ts:53`; the setting is case-sensitive), attributes: the id, login, email and name attributes. Exactly one entry is accepted.
4. Resolve the entry's linked groups (§6.5) while still bound as the service account.
5. Bind as the entry's DN with the typed password (search-then-bind, the flow all eight surveyed projects use; RFC 4513 §5.1.3). Unbind.
6. Canonicalise the key from its bytes: exactly 16 bytes become the GUID string in Microsoft's byte order (MS-DTYP 2.3.4.2: the first three fields little-endian; checked against Microsoft's example `90395fb99ab51b4a9e9686c66cb18d99` → `b95f3990-b59a-4a1b-9e96-86c66cb18d99`); bytes that decode to a UUID string (RFC 4530 §2.1: "UUID values are encoded using the [ASCII] character string representation"; RFC 4122 §3) are lowercased; anything else is refused and logged.
7. In one transaction (`lib/data/directory.ts`), with a locking read of the row found by `directory_id`:
   - **known account:** refused if the admin marker is set; otherwise the directory marker is cleared, name, email and `directory_username` are refreshed (an email already used by another account keeps the old one and logs a conflict; LibreChat overwrites these at every login), and the `directory` memberships of linked groups are set to what step 4 found;
   - **new account:** refused if the entry has no email or its email is used by any account (case-insensitively, as the unique index compares); otherwise a row is inserted with a fresh `users.id`, `source = 'ldap'`, role `user`, no password, the key and its attribute, and its `directory` memberships.
8. Return `{ id, role, sessionVersion }`, as the local provider does.

The local provider (`authorizeCredentials`) refuses `ldap` accounts (no password) and inactive accounts. In the users drawer, a directory account's name and email are read-only (the directory overwrites them), it has no password field, and its role follows the rank map. Deleting a directory account warns that the person gets a new account, with a new Dify history, at their next directory sign-in, and suggests deactivation instead.

### 6.4 The sync

**Schedule.** `instrumentation.ts` at the project root exports `register()`, which, in the Node runtime only (`process.env.NEXT_RUNTIME === 'nodejs'`, `02-guides/instrumentation.md`) and only when the `LDAP_*` block is set and `LDAP_SYNC_SCHEDULE` is not `off`, imports `lib/directory/schedule.ts` and starts one croner `Cron(schedule, { timezone, protect: true, catch })`, kept on `globalThis` so a development reload does not start a second (Rallly's guard). Next documents `register()` as startup code ("called **once** when a new Next.js server instance is initiated"; "You can run code on server startup using the `register` function", `self-hosting.md:83`) and does not document a scheduler in it; the shape is the reference projects' (Formbricks documents it for self-hosters, "starts the worker inside the web application by default"; Homarr, Rallly, ZTNet; `periodic-jobs.md`). Next skips `register` during `next build` (source, not docs), and the app guards nothing else at build since nothing runs at import.

**Claim.** A scheduled run inserts its `directory_sync_runs` row with `slot = schedule:<the scheduled time>`; the unique key refuses a second container's insert for the same slot, and that container skips (Documenso's deterministic slot key, `periodic-jobs.md` Q4). A manual run inserts `manual:<id>` and is refused (`sync_running`) while a run that started less than 30 minutes ago has no `finished_at`. The reconciliation is idempotent, so a rare overlap is harmless (Vercel's cron guidance: locks plus idempotent reconciliation).

**Missed run.** At start, the hub runs once (`trigger = 'startup'`) when the last succeeded run is older than the schedule's last due time (croner `previousRuns(1)`). croner does not catch up by itself.

**A run:**

1. Bind as the service account; a **paged** search (`paged: { pageSize: 500 }`; Active Directory returns at most 1,000 objects per page, "MaxPageSize … Default value: 1,000") for every entry under `LDAP_USER_BASE_DN` matching `LDAP_USER_FILTER`, reading the id, login, email and name attributes.
2. **Safety stops** (no account is changed; the outcome and a fixed error code are recorded and logged):
   - any connection, TLS, bind, search or page error: `failed` (GitLab: "All users are blocked if the LDAP server is unavailable when an LDAP user synchronization is run");
   - zero entries: `empty` (a filter written for one server returns zero on another without an error, which the LDAP standard requires; `e2e-ldap-server.md`);
   - any `ldap` account whose `directory_id_attribute` differs from `LDAP_ID_ATTRIBUTE`: `id_attribute_changed` (every key would miss, and Mattermost documents that a changed ID attribute splits accounts). Changing the id attribute after accounts exist is unsupported; recovery is a follow-up.
3. For every hub account with `source = 'ldap'`: key in the result → clear the directory marker if set (reactivated), refresh name, email and `directory_username` (an email used by another account keeps the old one and counts as a conflict); key absent → set `directory_deactivated_at` (if unset) and bump `sessionVersion`. Entries without a hub account are ignored: accounts are created at first sign-in only (Grafana: "Only users that have logged into Grafana at least once are synchronized").
4. Linked groups (§6.5): for each `user_group_directory_links` row, look the group up by its key (`(<id attribute>=<escaped key>)`; a binary key is rebuilt to its 16 bytes and every byte escaped) under `LDAP_GROUP_BASE_DN`; found → refresh `directory_group_name`, clear `missing_since`, search its members with `LDAP_GROUP_MEMBER_FILTER` (`{group_dn}` replaced by the escaped DN; paged); not found → set `missing_since` and treat it as having no members; an error → leave that group's memberships untouched and count the error. Each hub group's directory members are then the hub `ldap` accounts found in any of its links; only `directory` rows are added or removed.
5. Finish the row: counts, `finished_at`, outcome `succeeded`; delete runs older than 90 days; log one summary line.

Directory deactivation and reactivation follow GitLab (`ldap_blocked` lifted when the entry is back; an admin block is never lifted by LDAP, `lib/gitlab/auth/ldap/access.rb`, `app/models/user.rb:616-640` at `gitlabhq@0739b8bf`), Mattermost (deactivated at the next sync, every 60 minutes by default, sessions revoked) and Nextcloud (the remnant flag cleared when found again); the two markers make GitLab's separate states without its transition rules (§2 #12).

### 6.5 Directory groups

- **Membership filter.** `LDAP_GROUP_MEMBER_FILTER` with the placeholder `{group_dn}`. AD default `(memberOf:1.2.840.113556.1.4.1941:={group_dn})` resolves nested groups ("LDAP_MATCHING_RULE_IN_CHAIN … walks the chain of ancestry", ADSI Search Filter Syntax); OpenLDAP with the memberOf overlay uses `(memberOf={group_dn})`. Metabase ("Group membership lookup filter. The placeholders {dn} and {uid} will be replaced") and Grafana configure the same way.
- **At sign-in** (§6.3 step 4): for each linked group, one search with the user's DN as base, `scope: 'base'`, and the member filter for that group's DN; a returned entry means "member". This is Microsoft's documented form for testing one user's nested membership (ADSI Search Filter Syntax, `LDAP_MATCHING_RULE_IN_CHAIN`: base = the user DN, scope base, `(memberof:1.2.840.113556.1.4.1941:=<group DN>)`). New members get access at once.
- **Linking** (groups page drawer): a "Directory groups" field with search. An admin types part of a name; a Server Action (`requireAdmin()`) searches `(&<LDAP_GROUP_FILTER>(<LDAP_GROUP_NAME_ATTRIBUTE>=*<escaped text>*))` under `LDAP_GROUP_BASE_DN` with `sizeLimit: 20` and returns name and key; picking one stores the key and name. The key is the group's id attribute, so renaming or moving the group in the directory does not break the link (the reason accounts are never linked by DN, ADR-0026).

### 6.6 Status and "Sync now"

On the users page, for accounts with admin rights, when the `LDAP_*` block is set: the last run (time, trigger, outcome, counts, error code), the next scheduled run (croner `nextRun()`, or "off"), the encryption mode (an "Unencrypted connection" tag for `none`), and a **Sync now** button: a Server Action that runs the sync and returns its outcome.

## 7. Settings, security and logging

### 7.1 The `LDAP_*` block (`lib/env.ts`)

LDAP is on when `LDAP_URL` is set; every required key must then parse (zod, as the SMTP block), or the first request fails with the variables' names (`EnvError`), never `next build`.

| Variable | Required / default |
| --- | --- |
| `LDAP_URL` | required: `ldaps://host:636` or `ldap://host:389` |
| `LDAP_ENCRYPTION` | required: `ldaps` (with `ldaps://`), `starttls` or `none` (with `ldap://`); a mismatch fails validation |
| `LDAP_CA_FILE` | optional: a PEM file path mounted into the container; Node's trust store otherwise |
| `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` | required: a read-only service account |
| `LDAP_USER_BASE_DN` | required |
| `LDAP_USER_FILTER` | `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` (enabled AD users; Microsoft lists this filter as "All enabled user objects") |
| `LDAP_LOGIN_ATTRIBUTE` | `sAMAccountName` |
| `LDAP_ID_ATTRIBUTE` | `objectGUID` (binary, 16 bytes); `entryUUID` for OpenLDAP (an operational attribute, requested by name, RFC 4512 §3.4) |
| `LDAP_EMAIL_ATTRIBUTE`, `LDAP_NAME_ATTRIBUTE` | `mail`, `displayName` |
| `LDAP_GROUP_BASE_DN` | `LDAP_USER_BASE_DN` |
| `LDAP_GROUP_FILTER`, `LDAP_GROUP_NAME_ATTRIBUTE` | `(objectClass=group)`, `cn` |
| `LDAP_GROUP_MEMBER_FILTER` | `(memberOf:1.2.840.113556.1.4.1941:={group_dn})` |
| `LDAP_SYNC_SCHEDULE` | `0 * * * *`; `off` disables the schedule; validated with croner's parser |
| `LDAP_SYNC_TIMEZONE` | optional IANA name; the server's zone otherwise (UTC in the image) |

Timeouts are constants in `lib/directory/`, not settings. `docs/ldap.md` (new) gives a worked Active Directory example and an OpenLDAP one, the service account's needed rights (read), and the trade-off of `none` with the way to move to `ldaps` (a certificate naming the IP, or the DC's DNS name in the URL).

### 7.2 Security rules

- `users.id` stays the Dify user (ADR-0026); a directory account is linked only by `directory_id`, never by email, DN, UPN or `sAMAccountName`.
- No directory sign-in links or takes over another account (next-auth: automatic linking by email "can be exploited by bad actors to hijack accounts"; Credentials sign-ins never reach next-auth's linking code, so the DAL enforces it).
- Empty passwords never bind; every user-typed or directory-supplied value placed in a filter is escaped; binary keys are escaped per byte.
- One account per login: exactly one search match.
- The service account is read-only; its password lives in `.env` only.

### 7.3 Messages and logs

- The login form maps next-auth's result (`components/auth/auth-failure.ts`): `CredentialsSignin` → the generic "Check your username and password" (`auth.login_failed`), for a wrong password, an unknown user, an ambiguous match, a deactivated account, an entry without email, an email collision; `DirectoryUnavailable` (thrown by `authorize` for a connection, timeout or TLS failure; next-auth v4 passes a thrown message to `signIn`'s `result.error`) → "The directory is unreachable. Try again later."; anything else → `Default`, the generic sign-in error (ADR-0024 decision g).
- Each refusal logs one line with a fixed reason code and the username, never the password or the bind password. Sync runs log a summary and fixed error codes. Logging goes through `lib/error-log.ts`, which keeps a driver error to its name, code and errno; ldapts errors are reduced the same way (class name and LDAP result code).
- New action codes for the admin surface (Sync now, directory group search): `directory_unavailable`, `sync_running`; each mapped to a translation key.

### 7.4 Interface text

Every new string is an i18next key in `locales/{en,zh,ar}/translation.json` (ADR-0005: Modern Standard Arabic with Arabic-Indic digits), including the status and source tags, the access section, the groups page, the login tabs and the directory status panel.

## 8. Testing

**Vitest (node environment, test-first; B2's patterns).**

- Pure rules: `isActive`; the deactivation refusals by rank; the app access condition through Drizzle's `toSQL()` (as the existing DAL tests do); `objectGUID` to string against Microsoft's example; filter building and escaping; the `LDAP_*` block (encryption against the URL scheme, defaults, the cron expression through croner's parser, `off`); `planSync()` (from hub accounts and directory entries to deactivations, reactivations, updates, conflicts and the three safety stops); the group membership diff; the startup catch-up decision; the login failure mapping.
- The `ldap` provider with ldapts mocked: an empty password never binds; a wrong password, an unknown user, an ambiguous match, a missing email, a collision and a deactivated account answer `null` and log their reason; an unreachable directory throws `DirectoryUnavailable`.
- DAL functions with fakes; Server Actions through the real session chain (`getServerSession` mocked, `requireAdmin` real), so every new admin action is turned away for a `user` (ADR-0024 deviation 3).

**Directory integration suite (new), `pnpm test:ldap`.** A separate Vitest project (Vitest's documented `projects` configuration) that runs `lib/directory/` and the sync against real test servers from `docker-compose.e2e.yml`: `smblds/smblds` (Samba's AD code: binary `objectGUID`, `sAMAccountName`, the `userAccountControl` disabled flag, nested groups through the in-chain rule, paged results) over **LDAPS**, and OpenLDAP 2.6 (`osixia/openldap:2.6.15-alpha`, fallback `vegardit/openldap:2.6.x`: `entryUUID`, `uid`, `memberOf`, a per-account size limit that forces paging, which Samba does not enforce) over **StartTLS** and over **plain** (`none`). Both images are pinned by digest, live under a Compose profile `ldap`, are seeded at start (a `samba-tool` script; LDIF files), and get a `mem_limit` after one measurement. Precedents: os2mo and authentik run a Samba DC beside OpenLDAP in CI; ldapts, Mattermost, GitLab QA and Grafana test against OpenLDAP containers (`e2e-ldap-server.md`).

**Playwright (ADR-0010).** B3b runs the app under `next dev` against `smblds` over LDAPS (the e2e global setup enables the `ldap` profile; `.env.e2e` gets the block with `LDAP_SYNC_SCHEDULE=off`).

- B3a: groups create, edit, members, delete; app access everyone, groups or people, "Admins only"; a `user` with no grants sees the empty gallery; a grant through a group shows the app; an app not granted gives the unavailable chat page and 404s on a Dify route and the icon route; admins see every app; deactivation ends an open session at the next request and sign-in shows the generic message; reactivation.
- B3b: the login tabs (and their absence without the block, covered in vitest); a first directory sign-in creates a "Directory" account; a wrong password, an entry without email, an email used by a local account and a disabled AD account each get the generic message; a link to a nested AD group grants an app; Sync now deactivates and signs out a removed entry and reactivates it when it returns; the `empty` safety stop; the status panel.

**Migrations.** Each runs on the e2e database from empty and on a copy of the local Docker volume: every existing app becomes `everyone` (B3a); every existing account is `local` and the `CHECK` holds (B3b); each generated `migration.sql` carries `ON DELETE CASCADE` (§3.2).

**Gates** (per commit, `CLAUDE.md`): `pnpm exec next typegen && pnpm exec tsc --noEmit`, `oxlint`, `oxfmt --check`, `pnpm test`; per task the specs it touches; at the end of each PR the full e2e suite, then the Docker gate (rebuild, the curl checks, the migrations on the existing volume).

## 9. Delivery

Each PR: a plan under `docs/superpowers/plans/`, subagent-driven execution with a review per task (the security-sensitive reviews on the most capable model), a whole-branch review, the full e2e suite, the Docker gate, the owner's browser check, then the PR on the owner's word (merge commits; no branch deleted without the owner's word).

| PR | Branch | Delivers | Done when |
| --- | --- | --- | --- |
| B3a | `feat/backend-b3a-groups-access` | The B3a migrations; `user_groups` and members; `access_mode` and the grant tables; the access condition in the apps DAL; the groups page, the Access section and tags on the apps page; the status column and Deactivate/Reactivate on the users page; inactive accounts refused at sign-in and revoked in the `jwt` callback; ADR-0027 and its notes; `docs/auth-gate.md` | A `user` sees and opens only apps granted to them, directly, through a group or to everyone, in the gallery, the chat page, every Dify route and the icon route; admins see every app; deactivation signs the account out and blocks sign-in until reactivation; existing apps stay open to everyone after the migration; the gates and the Docker gate pass |
| B3b | `feat/backend-b3b-directory` (from `fork/overhaul` after B3a merges) | The B3b migrations; `ldapts` and `croner`; `lib/directory/`, `lib/data/directory.ts`; the `ldap` provider and the login tabs; the sync, its schedule in `instrumentation.ts`, the claim, the status panel and Sync now; directory group links; the `LDAP_*` block; `docs/ldap.md`; the integration suite and the LDAP test servers; ADR-0028 and its notes | A directory user signs in with their username, is created at first sign-in and linked by key; the scheduled and manual sync deactivate and reactivate accounts and keep linked-group memberships, with the safety stops; `pnpm test:ldap` passes on both servers in all three modes; the gates and the Docker gate pass; **the owner's live check against their Active Directory over `none`** passes: a sign-in, a sync, a nested group link |

The app works after each PR; nothing merges half-migrated.

## 10. Records

- **ADR-0027** (B3a, proposed in its PR): groups, per-app access and account deactivation: the access mode with typed grant tables, the admin bypass, closed by default, the first foreign keys on this line, the two deactivation markers and the session revocation. Dated notes on ADR-0024 (the rank map applies to deactivation; `lib/data/directory.ts` will be the second actor-less DAL module) and ADR-0018 (deactivation revokes like a password change).
- **ADR-0028** (B3b): directory sign-in and sync: `ldapts` and `croner` as dependencies (each against its alternatives: `ldapjs` decommissioned, `@infisical/ldapjs`, `ldap-native`, `passport-ldapauth`; `node-cron`, `cron`), linking by key, the second Credentials provider, the `instrumentation.ts` scheduler with the slot claim, generic sign-in messages, `LDAP_ENCRYPTION` including `none`, the `LDAP_*` block, the integration suite. A dated note on ADR-0026 (the LDAP linking rule implemented).
- A dated note on ADR-0004: the owner's intent to move to PostgreSQL after B3 or after frontend phase 2 (the decision itself gets its own ADR then).
- `docs/auth-gate.md` (deactivation, the directory provider, the generic messages), `docs/ldap.md` (new), `CLAUDE.md` (pointers, the decisions list, the follow-ups).
- The charter is left unedited (ADR-0026's reason: staging it would let the formatter rewrite the whole file); this spec supersedes its B3 row.

## 11. Deviations from the charter

- **No role mapping.** Charter §5 lists "the LDAP provider with a role and group mapping". Roles stay in the hub (§2 #7): one source of truth, the rank map unchanged, no extra settings.
- **Group mapping as links.** Directory groups are linked to hub groups by an admin rather than mapped automatically (§2 #8); no directory group appears in the hub unless linked (Open WebUI and LibreChat create groups at login; Grafana and Metabase map explicitly).
- **Roadmap row "in that order".** Groups and per-app access ship in B3a, LDAP in B3b, as the charter orders them.

## 12. Out of scope and follow-ups

- **Sign-in throttling** for both tabs, designed with Active Directory's lockout policy in mind (every failed directory bind counts toward it): OWASP's Authentication Cheat Sheet asks for protection against automated attacks; it needs a store shared by containers and probably a library.
- **"Switch to directory sign-in"** for a local account, proving both credentials and keeping `users.id` (Mattermost's "Switch to AD/LDAP").
- **Recovering from a changed `LDAP_ID_ATTRIBUTE`** (the sync stops with `id_attribute_changed`; Mattermost's `mmctl ldap idmigrate` is the precedent).
- **An admin "Logs" tab** (owner, 2026-10-09): the hub's log lines in the admin area with filters by type and time, so the owner need not read container logs from a terminal. Its own design: what is stored, where, retention, privacy.
- **The PostgreSQL move** after B3 or after frontend phase 2 (owner, 2026-10-09). B3 uses only features both engines have: foreign keys with cascade, `CHECK`, composite primary keys, enums (Drizzle `mysqlEnum`/`pgEnum`), a unique index that allows several `NULL`s (PostgreSQL's default).
- **`.dockerignore`**: its `!.env.example` and `!**/.env.example` exceptions let `.env.example` files from git-ignored folders such as `tmp/` into the build context (the current image holds two from the identity research).
- Pre-existing and unchanged: forgot and reset password stay inherited and local-only (a directory account has no hub password to reset).

## 13. Risks

- **Plaintext transport (`none`).** Every directory sign-in sends that person's Windows password, and every sync the service account's, in clear between the hub and the domain controller. The owner chose it for today's directory; the status panel and the start-up log keep it visible, and `docs/ldap.md` describes the move to LDAPS.
- **Account lockout through the hub** until throttling exists (§12).
- **A wrong but non-empty filter** (a subset of the real users) deactivates the rest at the next sync. It is reversible (the next correct sync reactivates them, sessions excepted), and the counts on the status panel show it; the `empty` and `id_attribute_changed` stops catch the total cases.
- **The in-process scheduler** is reference-project practice where Next's docs are silent (§6.4); a run cut by a restart is repeated by the startup catch-up or the next slot.
- **Real Active Directory differs from the test servers** in paging above 1,000 entries, referrals, LDAP signing policy and in-chain query cost; ldapts' own CI tests OpenLDAP only. The owner's live check is the real test.
- **drizzle-kit's single-table cascade defect** (§3.2).

## 14. Not confirmed

- Microsoft's current default for requiring LDAP signing on new domain controllers (a DC that requires it refuses simple binds over `ldap://` without TLS; MS-ADTS and Microsoft Learn describe the policy, the default for new installations was not checked).
- That the hub container on the owner's development machine (Docker on WSL2) can reach the directory's IP and port for the live check; on the production server it depends on its network.
- `smblds` and OpenLDAP memory use, start-up time and whether their data can live on tmpfs; how the e2e reads `smblds`'s generated certificate for `LDAP_CA_FILE`; the OpenLDAP `nestgroup` overlay configuration (if it is not proven, the OpenLDAP run covers direct `memberOf` only and nested groups are proven on `smblds`).
- Whether MySQL 8.4 accepts the table-qualified column names drizzle-kit writes inside `CHECK` (the first migration run shows it; the fallback is the DAL rule plus a test).
- croner's behaviour for a schedule inside a daylight-saving transition in `LDAP_SYNC_TIMEZONE`.

## 15. Sources

Research reports with full quotes and pinned commits: `docs/superpowers/research/2026-10-09-backend-b3/`.

- Next.js 16.3.4 bundled docs: `01-app/02-guides/instrumentation.md` (`register`, `NEXT_RUNTIME`), `self-hosting.md:83`, `data-security.md` (DAL authorization), `authentication.md`, `backend-for-frontend.md`.
- next-auth v4: Credentials provider, "Multiple providers" (next-auth.js.org/providers/credentials); OAuth `allowDangerousEmailAccountLinking`; installed `node_modules/next-auth` (`core/lib/providers.js`, `core/routes/callback.js`, `react/index.js`).
- ldapts 9.2.0 (`ldapts/ldapts@b38cfc3`): README (bind, search, `paged`, `explicitBufferAttributes`, `escapeFilter`, errors) and `src/Client.ts`, `src/messages/BindRequest.ts`, `src/filters/Filter.ts`. ldapjs decommission note (`ldapjs/node-ldapjs@8ffd0bc9`).
- croner 10.0.1 (Context7 `/hexagon/croner`): patterns, `timezone`, `protect`, `catch`, `nextRun()`, `previousRuns()`.
- Drizzle ORM 1.0.0-rc.3 (installed) and its docs: foreign keys, `primaryKey`, `check`, `mysqlEnum`, custom migrations.
- MySQL 8.4 Reference Manual: "FOREIGN KEY Constraints", "CHECK Constraints", "CREATE INDEX" (unique and `NULL`), "Keywords and Reserved Words", "Locking Reads".
- RFC 4511, RFC 4512 §3.4, RFC 4513 §5.1.2 and §5.1.3, RFC 4515, RFC 4530 §2, RFC 4122 §3; MS-DTYP 2.3.4.2; MS-ADTS 3.1.1.3.4.4 and 5.1.1.1.1; Microsoft Learn: `a-objectguid`, "Using objectGUID to bind to an object", `userAccountControl` flags, ADSI "Search Filter Syntax" (bit-AND and in-chain rules), LDAP policy `MaxPageSize`, "Polling for Changes Using uSNChanged" (periodic full synchronization); OpenLDAP 2.6 Administrator's Guide (entryUUID, memberOf overlay), slapo-ppolicy(5).
- OWASP Cheat Sheet Series (`OWASP/CheatSheetSeries@29994dd`): Authorization ("Deny by Default", "Validate the Permissions on Every Request"), Authentication ("Authentication Responses"), Logging.
- Reference projects (pinned in the reports): LibreChat `e1dfc104`, Open WebUI `8bd8b4fa`, Rocket.Chat `a6ae1988`, GitLab `0739b8bf`, Mattermost `4d94455a` and docs `bd09d959`, Grafana `7b702d79`/`c80649e8`, Keycloak `c7de391a`, Nextcloud `859e88ab`, Metabase `1c4f3ab9`, Dify `2b65f0e8` and Enterprise docs 3.13.x, Langfuse `c106bb3d`, Formbricks `27ca48e2`, Homarr `ad15cfc3`, Rallly `ac224fe8`, ZTNet `816c9e2b`, Documenso `38ecb217`, Cal.com `54343aa6`, Twenty `c168183b`, n8n `6fc0aeda`, Backstage `75128025`, Ant Design Pro (login page `Tabs`), os2mo `eea33ecf`, authentik `c3f92b69`.
