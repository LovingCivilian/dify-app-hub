# Backend rework B3a — account status, groups and per-app access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `user` account sees and opens only the Dify apps granted to it, directly, through a group, or to everyone, in the gallery, the chat page, every `/api/dify/*` route and the icon route; the owner and admins see every app. Admins manage groups on a new page and each app's access in the app drawer. Any account can be deactivated by an admin under B2's rank map, which signs it out at its next request and blocks sign-in until reactivation; its `users.id`, groups and grants are kept.

**Architecture:** Two new tables hold groups and memberships (`user_groups`, `user_group_members` with a `source` of `manual` or `directory`), two typed grant tables hold app access (`app_group_grants`, `app_user_grants`), `dify_apps.access_mode` says `everyone` or `restricted`, and `users` gains an admin deactivation marker (with who) and a directory marker that B3b will write. Foreign keys cascade on delete, the first on this line. One SQL condition in the apps Data Access Layer, `visibleTo(actor)`, is applied by every app read, so the list and each single-app check share one rule; accounts with admin rights get no condition. `isActive` (both markers empty) is checked by the Credentials `authorize` after the password and by the `jwt` callback on every request; deactivation also bumps `sessionVersion`, ADR-0018's revocation rule. Groups get a DAL module, thin Server Actions and an antd page; grants are edited on the app drawer; deactivation is a users-page row action.

**Tech Stack:** Next 16.3.4 (Server Actions, `refresh`, `server-only`), next-auth 4.24, Drizzle ORM 1.0.0-rc.3 on MySQL 8.4 (`mysqlEnum`, `primaryKey`, `.references(…, { onDelete: 'cascade' })`, `exists`, `.for('update')`, `drizzle-kit generate` and `generate --custom`), zod 4, React 19.2, antd 6.6.5, vitest 4 (node), Playwright 1.63 with the stub Dify API. Nothing is added to `package.json`.

**Spec:** `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`. Read §2 (the owner's decisions, not re-opened), §3.1 (B3a data model), §4 (per-app access), §5 (account status), §7.3 (the generic sign-in message) and §7.4 (interface text), §8 (B3a tests), §9 (the B3a row and its "done when"), §10 (ADR-0027) and §12 (follow-ups) first; every task cites its sections. The research behind it is `docs/superpowers/research/2026-10-09-backend-b3/` (start at its README). B2's records are the patterns: ADR-0024 (the DAL, the rank map, decision d's locking, decision g's logging), `docs/superpowers/plans/2026-10-08-backend-b2-accounts.md` (task and test style).

**Deviations from the spec text, all deliberate (Task 8 records them in ADR-0027):**

1. **`/app-management` reads `listAdminApps(actor)`**, a new admin-only read returning the app DTO plus its access, instead of `listApps` (spec §4.2 says the page "keeps calling `listApps`"). The grant lists are admin data: the gallery, which also calls `listApps`, must not receive them (ADR-0020: props carry only what the screen uses). `listApps` still gives an admin every app.
2. **Two new action codes**, beside B3b's two in spec §7.3: `name_in_use` (a group name the unique index refuses, case-insensitively, since `utf8mb4_0900_ai_ci` compares without case) and `cannot_deactivate_self` (B2's `cannot_delete_self` pattern).
3. **A picked group or account deleted while the admin's form was open** (MySQL error 1452 `ER_NO_REFERENCED_ROW_2` from a foreign key) answers `invalid_input` with a field error on the picker, and nothing is written: the save runs in one transaction.
4. **Switching an app to `everyone` deletes its grants**, which mean nothing there; switching back to `restricted` starts empty. The spec is silent.
5. **The gallery's empty text** (`app.empty_contact_admin`) is reworded for an account that has no grants (spec §4.5): "No apps are available to you yet. Ask your administrator."
6. **Deactivating an account already deactivated by an admin, or reactivating an active one, is a no-op success**: no second `sessionVersion` bump, no new timestamp.

**Decisions this plan adds where the spec is silent (each goes into ADR-0027, Task 8):**

- a. **`isActive` fails closed.** It compares each marker with `=== null`, so a marker read as `undefined` (a select that left the column out) counts as set and refuses the account.
- b. **A refused local sign-in is logged by account id**, `{ reason: 'account_inactive', userId }`, never by email (a pseudonymous subject, spec §7.3; OWASP Logging Cheat Sheet "Data to exclude").
- c. **Group fields:** a name of 1–255 characters after trimming, a description of at most 1,000 after trimming (blank stored as `NULL`), at most 10,000 member ids; group ids are UUIDs (`z.uuid()`, B1's app-id rule); account ids keep B2's decision h (`userIdSchema`, 1–36 characters).
- d. **The access condition is built with Drizzle's query builder** (`or`, `eq`, `exists` with a correlated subquery), its subqueries on Drizzle's standalone `QueryBuilder` (`new QueryBuilder()` from `drizzle-orm/mysql-core`; Drizzle docs "Goodies: standalone query builder", "Dynamic query building", "Views": a query builder "without creating a database instance"), so `visibleTo(actor)` needs no connection and the tests render it on `drizzle.mock()`. Drizzle docs, "Filters" (`exists`); `and()` skips an `undefined` condition (`node_modules/drizzle-orm/sql/expressions/conditions.d.ts`).
- e. **A shared label for account pickers**, `accountOptionLabel`, shows `Name (email)` or the email alone, and a "Deactivated" suffix for an inactive account (spec §4.3: "deactivated ones tagged").

## Global Constraints

- **Documented approaches only (ADR-0002, rule R0 of the run).** Name the source of every non-obvious API decision in the task report, and take a documented route whenever a reviewer names one. Sources:
  - Next's bundled docs `node_modules/next/dist/docs/01-app/`: `02-guides/server-actions.md`, `02-guides/data-security.md`, `02-guides/authentication.md`, `03-api-reference/04-functions/refresh.md`;
  - next-auth v4: Context7 `/websites/next-auth_js` (callbacks, Credentials provider);
  - Drizzle: Context7 `/drizzle-team/drizzle-orm-docs` and the installed `node_modules/drizzle-orm/mysql-core` (`mysqlEnum`, `primaryKey`, `references`, `getTableConfig`, `.for('update')`, `transaction`, `drizzle.mock()`), `node_modules/drizzle-orm/sql/expressions/conditions.d.ts` (`exists`, `or`, `and`, `inArray`);
  - zod 4: Context7;
  - antd: the antd CLI (`npx -y @ant-design/cli info|demo|doc Select|Radio|Tabs|Table|Popconfirm|Tooltip|Drawer|Form`, `.claude/skills/antd`);
  - MySQL 8.4 Reference Manual: "FOREIGN KEY Constraints", "CREATE INDEX" (unique and `NULL`), "Locking Reads", "Keywords and Reserved Words" (`GROUPS` is reserved), the error reference (1062 `ER_DUP_ENTRY`, 1452 `ER_NO_REFERENCED_ROW_2`);
  - OWASP Cheat Sheet Series: Authorization ("Deny by Default", "Validate the Permissions on Every Request"), Authentication ("Authentication Responses"), Logging.

  For an architectural choice the docs leave open, compare 2–3 well-known projects on the same stack and cite them beside the docs (CLAUDE.md; the B3 research reports). No private imports, no `@ts-nocheck`, and a `@ts-expect-error` only with its reason on the line.

- **Versions:** `next` 16.3.4, `next-auth` 4.24, `drizzle-orm` and `drizzle-kit` 1.0.0-rc.3, `zod` ^4, `react` 19.2, `antd` 6.6.5. Nothing is added.
- **Two vocabularies (charter §4.5).** Actions answer `ActionResult` with the codes in `lib/action-result.ts`; the Dify routes answer Dify's envelope. An app the account may not use answers exactly as a missing app (`404 app_not_found` on the Dify routes, `AppUnavailable reason="missing"` on the chat page, `404 icon_not_found` on the icon route). Expected failures never throw out of an action; an unexpected throw becomes `operation_failed` through `toActionFailure`.
- **Server-only code** imports `server-only`. `process.env` is read only in `lib/env.ts` (plus `drizzle.config.ts` and `db/migrate.ts`). DTOs never carry the password hash, `sessionVersion` or an API key; the gallery's DTOs never carry grant lists.
- **Database (ADR-0004, AGENTS.md).**
  - Schema changes go through `db/schema/*.ts`, `pnpm db:generate --name <name>`, and a hand review of the SQL; data changes through `pnpm exec drizzle-kit generate --custom --name <name>`. Never `drizzle-kit push`.
  - **drizzle-kit 1.0.0-rc.3 drops `ON DELETE CASCADE` from a migration that creates exactly one new table with foreign keys** (spec §3.2). Task 1 creates four tables in one migration, which generates correctly; its test asserts every foreign key in the SQL carries `ON DELETE CASCADE`.
  - Foreign keys need matching charset and collation on both sides (MySQL 8.4 "FOREIGN KEY Constraints"); every referenced `id` is `varchar(36)` under the database default. Task 9 checks the local volume's collation before the Docker gate.
  - The e2e harness applies migrations itself (`e2e/global-setup.ts`); the e2e database is `mysql://e2e:e2e@127.0.0.1:3307/e2e`, reset with `docker compose -f docker-compose.e2e.yml down`. The dev database (`pnpm dev`) is migrated by hand by the owner if they use it.
- **Language.** No Chinese string remains in the files a task touches; logs are English; nothing user-facing is a server message, only a code the client translates. New UI text goes through i18next keys present in `locales/en`, `locales/zh` and `locales/ar` (`pnpm test` checks parity; `types/i18next.d.ts` types the keys from `en`). Never run `i18next-cli extract/sync`. Arabic is Modern Standard Arabic with the file's digit style (Western digits: "255", "8") and the file's terms ("مسؤول" for admin, "مستخدم" for user, "المالك" for owner); Chinese uses the file's terms ("管理员", "普通用户", "所有者") and its informal "你". A key with no remaining reader is removed from all three files.
- **Frontend rules (`.claude/rules/frontend.md`, `docs/frontend-conventions.md`).** antd components first; token-only CSS Modules; `App.useApp()` for messages. A form calls its action from `onFinish` through `useActionTransition` (`hooks/use-action-transition.ts`). A Form inside a `destroyOnHidden` Drawer owns its instance (no parent `Form.useForm()`), keyed by what it edits; the submit button in `extra` uses `htmlType="submit" form={<id>}`. `npx -y @ant-design/cli lint ./` stays at zero findings.
- **Unit tests.** vitest (node, no DOM) in `__tests__/`; mock with `vi.hoisted` + `vi.mock`. **Every test of a session-bearing action mocks `next-auth/next`'s `getServerSession` and `@/lib/auth/options`, and keeps `lib/auth/session` real** (ADR-0024 deviation 3), so a test fails if an action checks only the session. DAL rules are pure functions tested without a database; `@/db` is mocked to throw where only the rules run. A SQL shape is rendered on `drizzle.mock()` (`import { drizzle } from 'drizzle-orm/mysql2'`).
- **e2e (ADR-0010).** Web-first assertions; role, label and name locators; never `networkidle`. Every row a spec creates carries the project name (`…-${test.info().project.name}…`) and is deleted in `afterEach` or `finally`. Accounts are seeded with `e2e/fixtures/users.ts`, apps, groups and grants with `e2e/fixtures/access.ts` (Task 3). antd Select options are picked by `page.getByTitle('<label>', { exact: true })` after opening the select (the pattern of `e2e/chat-hitl.spec.ts`). Run a task's specs with `pnpm exec playwright test e2e/<file>.spec.ts …`, with `pnpm dev` stopped (one `next dev` per checkout). The full suite runs once, in Task 9, from a fresh e2e database.
- **Before every commit:** `pnpm exec next typegen && pnpm exec tsc --noEmit`; `pnpm exec oxlint <changed files>`; `pnpm exec oxfmt --write <changed files>`, then `--check`; `pnpm test`. The pre-commit hook (lint-staged) reformats staged Markdown and JSON (including the generated `snapshot.json`, whose content does not change).
- **Commits.** Conventional (`feat|fix|test|docs|chore(scope): …`), in English. `git add <paths>`, never `-A`; `git rm`/`git mv` for removals and moves. Before each commit, `git status --short` shows nothing unstaged that belongs to the task. Both trailer lines go in ONE `-m` argument, after a blank line:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn
  ```

  `.cii-assessment.md` goes in its own `docs: update CII assessment` commit (AGENTS.md). No push and no PR without the owner's word.

- **This machine (~5 GB of memory).** Never run the Docker build and `pnpm test:e2e` at once. Take the old app container down before a build, build in the foreground, and never restart a build that was killed for memory. `AGENTS.md` stays byte-identical. Never read or print `.env` or `.env*.local`. Scratch files go to the repo's `tmp/` (it ignores itself), never `/tmp`; nothing under `tmp/` may end in `.ts` or `.tsx` (the root `tsconfig.json` includes `**/*.ts`), nor be named `.env.example` (`.dockerignore`'s exception lets it into the image build).

## Review Focus

Five conditions the spec implies that no feature flow pins on its own, most likely first. Each has its test in the task named.

1. **A `user` account reaches an app it was not granted by its id**: a bookmarked `/chat/<id>`, a hand-typed `/api/dify/<id>/parameters`, an `<img>` of `/api/apps/<id>/icon`, or `/chat`'s first-app redirect. Each answers as for a missing app (404, "unavailable", no redirect to it), and no Dify request is made. Tests: Task 3 (every read applies `visibleTo`, rendered for a `user` and an admin; `resolveDifyRoute`'s 404 is unchanged) and `e2e/app-access.spec.ts` (gallery, chat page, a Dify route and the icon route, without and with a grant).
2. **An account whose role changes while signed in.** A demoted admin sees exactly what its groups and direct grants give at its next request; a promoted user sees every app. Tests: Task 3 (`visibleTo` takes the role from the actor the session refreshed; the same id as `user` and as `admin`).
3. **A stale form.** A group or account picked in the app drawer or the group drawer is deleted before the admin saves; or the group being edited is deleted meanwhile. The save answers `invalid_input` (field error on the picker) or `not_found`, and writes nothing. Tests: Task 4 (`isMissingReference`; the group actions map 1452 and a missing group), Task 6 (the app actions map 1452).
4. **The rank on deactivation, reached by a direct action call** (the table hides what the actor may not do): an admin deactivates the owner, another admin or itself; anyone deactivates itself. Each answers `forbidden` or `cannot_deactivate_self` and writes nothing; the target row is read with a locking read. Tests: Task 7 (`deactivateRefusal`'s matrix; the actions through the real session chain against an admin's, the owner's and the own row; the target query ends in `for update`).
5. **A deactivated account with a session still open, and a reactivated one with an old token.** The open session is refused at its next request; an old token stays refused after reactivation; the sign-in form shows the same generic message as a wrong password, even with the right password. Tests: Task 2 (`authorizeCredentials` and the `jwt` callback with each marker), Task 7 (`e2e/deactivation.spec.ts` with a second browser context).

---

## File structure

```
lib/app-access.ts                                   ACCESS_MODES, MEMBERSHIP_SOURCES, AppAccessSettings (client-safe)   (Task 1)
db/schema/{users,apps,groups,app-grants,index}.ts, db/migrations/<ts>_b3a-groups-access/,
db/migrations/<ts>_b3a-apps-open-to-everyone/, __tests__/b3a-schema.test.ts                                            (Task 1)
lib/auth/account-status.ts, lib/auth/options.ts, lib/error-log.ts, __tests__/{account-status,auth-options}.test.ts      (Task 2)
lib/data/apps.ts (visibleTo, the reads), components/apps/app-gallery.tsx (text only), locales/*,
e2e/auth.setup.ts, e2e/fixtures/access.ts, e2e/app-access.spec.ts, __tests__/data-apps-access.test.ts                  (Task 3)
lib/data/db-errors.ts, lib/data/groups.ts, lib/data/users.ts (listUserOptions; isDuplicateEntry moved),
lib/action-result.ts (name_in_use), app/(admin)/group-management/{actions,schemas}.ts,
__tests__/{data-db-errors,data-groups,group-management-actions,group-management-schemas}.test.ts                       (Task 4)
app/(admin)/group-management/page.tsx, components/admin/groups/{group-management,group-form-drawer,group-errors}.ts(x),
components/admin/account-option.ts, components/shell/admin-shell.tsx, locales/*, e2e/admin-groups.spec.ts,
__tests__/{group-management-page,group-errors,account-option}.test.ts                                                    (Task 5)
app/(admin)/app-management/{schemas,actions,page}.ts(x), lib/data/apps.ts (grants, listAdminApps),
components/admin/apps/{admin-app-row,app-form-values,app-form-drawer,app-settings-fields,app-management}.ts(x),
locales/*, e2e/admin-apps.spec.ts, __tests__/{app-management-*,data-apps,admin-app-row,app-form-values}.test.ts          (Task 6)
lib/data/users.ts (status, groups, setUserActive), lib/action-result.ts (cannot_deactivate_self),
app/(admin)/user-management/actions.ts, components/admin/users/{user-management,user-errors}.ts(x), locales/*,
e2e/deactivation.spec.ts, __tests__/{data-users,user-management-actions,user-management-rank,user-errors}.test.ts        (Task 7)
docs/decisions/0027-…, notes on 0004/0018/0024, docs/decisions/README.md, docs/auth-gate.md, CLAUDE.md, .cii-assessment.md (Task 8)
whole-branch review, fix wave, full e2e, migration on a copy of the local DB, Docker gate, PR text                      (Task 9)
```

## Execution notes (for the controller)

- **Workspace.** `.superpowers/sdd/2026-10-09-backend-b3a-groups-access/` (git-ignored) holds the contracts copied from `.superpowers/sdd/2026-10-08-backend-b2-accounts/{implementer-contract,re-review-contract,global-constraints}.md` and adapted to this plan, a `rules.md` whose first rule is **R0: ADR-0002 governs every decision, the controller's rulings included; a review finding that names a documented route is taken, even when Minor and even against this plan**, a `ledger.md` and a `rulings.md`. Task 9 asks the owner whether to commit them under `docs/superpowers/research/2026-10-09-backend-b3/b3a-execution/`.
- **Per task:** a fresh implementer, given only its task text, the Global Constraints, the Review Focus lines its task owns and the implementer contract; then a fresh reviewer with the task's gates. If a subagent cannot write its report file, save the report from its reply into the workspace before dispatching the reviewer.
- **Models** (owner: the riskiest reviews on Opus). Pre-flight review of this plan, whole-branch review and fix wave on Opus. Per task:

  | Task | Implementer | Reviewer                               |
  | ---- | ----------- | -------------------------------------- |
  | 1    | Sonnet      | Opus (the migration touches real data) |
  | 2    | Opus        | Opus (authentication)                  |
  | 3    | Opus        | Opus (authorization on every read)     |
  | 4    | Opus        | Opus                                   |
  | 5    | Sonnet      | Sonnet                                 |
  | 6    | Opus        | Opus                                   |
  | 7    | Opus        | Opus                                   |
  | 8    | Sonnet      | Sonnet                                 |

  Scoped re-reviews run on Sonnet; a fix loop that reaches round 4 escalates to Opus.

- **e2e while iterating:** only each task's named specs. The full suite (about 20 minutes) runs once, in Task 9.

---

### Task 1: The schema, the migrations and the access vocabulary

Spec §3.1, §2 #9 (existing apps open to everyone), §3.2 (the drizzle-kit defect). Review Focus: none directly; Task 9 runs the migration on a copy of the local database.

**Files:**

- Create: `lib/app-access.ts`, `db/schema/groups.ts`, `db/schema/app-grants.ts`, `__tests__/b3a-schema.test.ts`
- Modify: `db/schema/users.ts`, `db/schema/apps.ts`, `db/schema/index.ts`
- Generate: `db/migrations/<timestamp>_b3a-groups-access/`, `db/migrations/<timestamp>_b3a-apps-open-to-everyone/`

**Interfaces:**

- Produces: `ACCESS_MODES`, `AccessMode`, `MEMBERSHIP_SOURCES`, `MembershipSource`, `AppAccessSettings` from `@/lib/app-access`; the tables `userGroups`, `userGroupMembers`, `appGroupGrants`, `appUserGrants` and the columns `users.adminDeactivatedAt`, `users.adminDeactivatedBy`, `users.directoryDeactivatedAt`, `difyApps.accessMode`, all exported from `@/db/schema`.

- [ ] **Step 1: Write the failing schema test**

Create `__tests__/b3a-schema.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { getTableConfig } from 'drizzle-orm/mysql-core'
import { describe, expect, it } from 'vitest'

import {
	appGroupGrants,
	appUserGrants,
	difyApps,
	userGroupMembers,
	userGroups,
	users,
} from '@/db/schema'

describe('the B3a schema (B3 spec §3.1)', () => {
	it('adds two deactivation markers and who deactivated, all nullable, to users', () => {
		expect(users.adminDeactivatedAt.notNull).toBe(false)
		expect(users.adminDeactivatedBy.notNull).toBe(false)
		expect(users.directoryDeactivatedAt.notNull).toBe(false)
		// No foreign key on who deactivated: deleting that admin keeps the record.
		expect(getTableConfig(users).foreignKeys).toEqual([])
	})

	it('closes a new app by default (spec §2 #9)', () => {
		expect(difyApps.accessMode.enumValues).toEqual(['everyone', 'restricted'])
		expect(difyApps.accessMode.notNull).toBe(true)
		expect(difyApps.accessMode.default).toBe('restricted')
	})

	it('names groups uniquely and records the source of each membership', () => {
		expect(getTableConfig(userGroups).name).toBe('user_groups')
		expect(getTableConfig(userGroups).indexes.map(index => index.config.name)).toEqual([
			'user_groups_name_key',
		])
		expect(userGroupMembers.source.enumValues).toEqual(['manual', 'directory'])
		const [primary] = getTableConfig(userGroupMembers).primaryKeys
		expect(primary.columns.map(column => column.name)).toEqual(['group_id', 'user_id', 'source'])
	})

	it.each([
		['user_group_members', userGroupMembers, ['user_groups', 'users']],
		['app_group_grants', appGroupGrants, ['dify_apps', 'user_groups']],
		['app_user_grants', appUserGrants, ['dify_apps', 'users']],
	] as const)('%s cascades every foreign key on delete', (_name, table, parents) => {
		const keys = getTableConfig(table).foreignKeys
		expect(keys.map(key => key.onDelete)).toEqual(parents.map(() => 'cascade'))
		expect(keys.map(key => getTableConfig(key.reference().foreignTable).name).sort()).toEqual(
			[...parents].sort(),
		)
	})
})

describe('the B3a migrations', () => {
	const folders = readdirSync('db/migrations')
	const generated = folders.find(name => name.endsWith('_b3a-groups-access'))
	const backfill = folders.find(name => name.endsWith('_b3a-apps-open-to-everyone'))
	const read = (dir: string) =>
		readFileSync(path.join('db/migrations', dir, 'migration.sql'), 'utf8')
	const statements = (sql: string) =>
		sql
			.split('--> statement-breakpoint')
			.map(part =>
				part
					.split('\n')
					.filter(line => !line.startsWith('--'))
					.join('\n')
					.trim(),
			)
			.filter(Boolean)

	it('creates the four tables and adds the columns', () => {
		expect(generated).toBeDefined()
		const sql = read(generated!)
		for (const table of [
			'user_groups',
			'user_group_members',
			'app_group_grants',
			'app_user_grants',
		])
			expect(sql).toContain(`CREATE TABLE \`${table}\``)
		expect(sql).toContain(
			"ALTER TABLE `dify_apps` ADD `access_mode` enum('everyone','restricted') DEFAULT 'restricted' NOT NULL;",
		)
		for (const column of [
			'admin_deactivated_at',
			'admin_deactivated_by',
			'directory_deactivated_at',
		])
			expect(sql).toContain(`ALTER TABLE \`users\` ADD \`${column}\``)
	})

	// drizzle-kit 1.0.0-rc.3 leaves ON DELETE out when a migration creates exactly one table with foreign keys
	// (spec §3.2); pin that every foreign key here cascades.
	it('writes ON DELETE CASCADE on all six foreign keys', () => {
		const sql = read(generated!)
		expect(sql.match(/FOREIGN KEY/g)).toHaveLength(6)
		expect(
			sql.match(/FOREIGN KEY \(`[a-z_]+`\) REFERENCES `[a-z_]+`\(`id`\) ON DELETE CASCADE/g),
		).toHaveLength(6)
	})

	it('opens every existing app to everyone in a later custom migration (spec §2 #9)', () => {
		expect(backfill).toBeDefined()
		// the migrator applies folders in name order
		expect(backfill! > generated!).toBe(true)
		expect(statements(read(backfill!))).toEqual([
			"UPDATE `dify_apps` SET `access_mode` = 'everyone';",
		])
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run __tests__/b3a-schema.test.ts` Expected: FAIL (the exports `userGroups`, `appGroupGrants`… do not exist).

- [ ] **Step 3: The vocabulary**

Create `lib/app-access.ts`:

```ts
/**
 * The vocabulary of per-app access (B3 spec §3.1, §4; ADR-0027): an app is open to everyone or restricted to its
 * grants, and a group membership was added by an admin or by the directory sync (B3b). Client-safe on purpose: the
 * schema, the zod inputs, the DTOs and the admin forms all read it.
 */
export const ACCESS_MODES = ['everyone', 'restricted'] as const

export type AccessMode = (typeof ACCESS_MODES)[number]

export const MEMBERSHIP_SOURCES = ['manual', 'directory'] as const

export type MembershipSource = (typeof MEMBERSHIP_SOURCES)[number]

/** An app's access as the admin edits it; the grants count only while the mode is `restricted` (spec §4.1). */
export interface AppAccessSettings {
	mode: AccessMode
	groupIds: string[]
	userIds: string[]
}
```

- [ ] **Step 4: The tables and columns**

In `db/schema/users.ts`, add three columns after `sessionVersion` (keep every other line):

```ts
		sessionVersion: int('session_version').default(0).notNull(),
		/** ADR-0027: set by an admin's Deactivate, cleared by Reactivate; the account is active while both markers are null. */
		adminDeactivatedAt: datetime('admin_deactivated_at', { fsp: 3 }),
		/** The admin's users.id; no foreign key, so deleting that admin keeps the record. */
		adminDeactivatedBy: varchar('admin_deactivated_by', { length: 36 }),
		/** ADR-0027: set and cleared by the directory sync and sign-in only (B3b). */
		directoryDeactivatedAt: datetime('directory_deactivated_at', { fsp: 3 }),
```

In `db/schema/apps.ts`, import `mysqlEnum` and `ACCESS_MODES`, and add after `isEnabled`:

```ts
import {
	boolean,
	datetime,
	mediumblob,
	mysqlEnum,
	mysqlTable,
	text,
	varchar,
} from 'drizzle-orm/mysql-core'

import { ACCESS_MODES } from '@/lib/app-access'
import { generateUuidV4 } from '@/lib/helpers'
```

```ts
	isEnabled: boolean('is_enabled').default(true).notNull(),
	/** B3 spec §2 #9: a new app is closed until granted; the B3a migration opened every existing app to everyone. */
	accessMode: mysqlEnum('access_mode', ACCESS_MODES).default('restricted').notNull(),
```

Create `db/schema/groups.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
	datetime,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	text,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/mysql-core'

import { MEMBERSHIP_SOURCES } from '@/lib/app-access'
import { generateUuidV4 } from '@/lib/helpers'

import { users } from './users'

/** Hub groups (B3 spec §3.1). `groups` is a reserved word in MySQL 8.4, hence `user_groups`. */
export const userGroups = mysqlTable(
	'user_groups',
	{
		id: varchar({ length: 36 })
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		name: varchar({ length: 255 }).notNull(),
		description: text(),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [uniqueIndex('user_groups_name_key').on(table.name)],
)

/**
 * Memberships (spec §2 #8): a person can be a member by hand and through the directory at once, one row per source;
 * an admin changes only `manual` rows and the sync only `directory` rows. Deleting the group or the account removes
 * its rows (ON DELETE CASCADE, MySQL 8.4 "FOREIGN KEY Constraints").
 */
export const userGroupMembers = mysqlTable(
	'user_group_members',
	{
		groupId: varchar('group_id', { length: 36 })
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
		userId: varchar('user_id', { length: 36 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		source: mysqlEnum(MEMBERSHIP_SOURCES).notNull(),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
	},
	table => [primaryKey({ columns: [table.groupId, table.userId, table.source] })],
)
```

Create `db/schema/app-grants.ts`:

```ts
import { mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core'

import { difyApps } from './apps'
import { userGroups } from './groups'
import { users } from './users'

/*
 * App grants (B3 spec §3.1, ADR-0027): two typed tables rather than one with a principal-type column, so each grant
 * carries foreign keys and is removed with its app, group or account (Metabase relies on the same cascade; LibreChat
 * and Grafana, with a polymorphic column, delete orphans in code). A grant counts only while the app is restricted.
 */

export const appGroupGrants = mysqlTable(
	'app_group_grants',
	{
		appId: varchar('app_id', { length: 36 })
			.notNull()
			.references(() => difyApps.id, { onDelete: 'cascade' }),
		groupId: varchar('group_id', { length: 36 })
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
	},
	table => [primaryKey({ columns: [table.appId, table.groupId] })],
)

export const appUserGrants = mysqlTable(
	'app_user_grants',
	{
		appId: varchar('app_id', { length: 36 })
			.notNull()
			.references(() => difyApps.id, { onDelete: 'cascade' }),
		userId: varchar('user_id', { length: 36 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [primaryKey({ columns: [table.appId, table.userId] })],
)
```

Replace `db/schema/index.ts`:

```ts
export { appGroupGrants, appUserGrants } from './app-grants'
export { difyApps } from './apps'
export { userGroupMembers, userGroups } from './groups'
export { passwordResetTokens } from './password-reset-tokens'
export { users } from './users'
```

Source: Drizzle `primaryKey({ columns })` (installed `mysql-core/primary-keys.d.ts`; the MySQL type takes no `name`), `.references(ref, { onDelete })` (`mysql-core/columns/common.d.ts`), `mysqlEnum(name, values)` (`columns/enum.d.ts`), `getTableConfig` (`mysql-core/utils.d.ts`).

- [ ] **Step 5: Generate the migration on an e2e database with existing apps**

Bring the e2e MySQL to B2's state with two apps, so Step 6 opens rows that existed before the column:

```bash
docker compose -f docker-compose.e2e.yml down
docker compose -f docker-compose.e2e.yml up -d --wait
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "INSERT INTO dify_apps (id, name, api_base, api_key) VALUES ('00000000-0000-4000-8000-0000000000a1', 'Old one', 'http://x/v1', 'k'), ('00000000-0000-4000-8000-0000000000a2', 'Old two', 'http://x/v1', 'k');"
pnpm db:generate --name b3a-groups-access
cat db/migrations/*_b3a-groups-access/migration.sql
```

Expected: `CREATE TABLE` for `app_group_grants`, `app_user_grants`, `user_group_members` and `user_groups` (with `CONSTRAINT PRIMARY KEY(…)` and `CONSTRAINT \`user_groups_name_key\` UNIQUE INDEX(\`name\`)`), `ALTER TABLE \`dify_apps\` ADD \`access_mode\` …`, three `ALTER TABLE \`users\` ADD …`, then six `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY (…) REFERENCES …(\`id\`) ON DELETE CASCADE`. If a foreign key lacks `ON DELETE CASCADE`, or anything else appears (a change to an existing column), stop and report it: the schema must not drift.

Then the data migration:

```bash
pnpm exec drizzle-kit generate --custom --name b3a-apps-open-to-everyone
```

Write the generated `db/migrations/*_b3a-apps-open-to-everyone/migration.sql` as exactly:

```sql
UPDATE `dify_apps` SET `access_mode` = 'everyone';
```

Why two migrations: `ALTER TABLE` commits implicitly in MySQL, and Drizzle's migrator records applied migrations by name, so a crash re-runs only the idempotent `UPDATE` (ADR-0024 "More Information", the same split as B2's role backfill). Drizzle docs, "Custom migrations" (`drizzle-kit generate --custom`).

- [ ] **Step 6: Apply both and check the rows**

```bash
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "SELECT name, access_mode FROM dify_apps ORDER BY name; INSERT INTO dify_apps (id, name, api_base, api_key) VALUES ('00000000-0000-4000-8000-0000000000a3', 'New one', 'http://x/v1', 'k'); SELECT name, access_mode FROM dify_apps WHERE name = 'New one'; SHOW CREATE TABLE user_group_members\G"
```

Expected: `Old one everyone`, `Old two everyone`; `New one restricted`; `SHOW CREATE TABLE` lists both foreign keys with `ON DELETE CASCADE`. Then reset: `docker compose -f docker-compose.e2e.yml down`.

- [ ] **Step 7: Run the tests and the gates**

```bash
pnpm exec vitest run __tests__/b3a-schema.test.ts __tests__/users-schema.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/app-access.ts db/schema/*.ts __tests__/b3a-schema.test.ts
pnpm exec oxfmt --write lib/app-access.ts db/schema/*.ts __tests__/b3a-schema.test.ts
pnpm test
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/app-access.ts db/schema/users.ts db/schema/apps.ts db/schema/groups.ts db/schema/app-grants.ts db/schema/index.ts db/migrations/*_b3a-groups-access db/migrations/*_b3a-apps-open-to-everyone __tests__/b3a-schema.test.ts
git commit -m "feat(db): add groups, app grants, the access mode and the deactivation markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 2: Account status at sign-in and in the session

Spec §5 ("Sign-in", "Live sessions"), §7.3 (generic message, the reason in the log). Review Focus 5 (the vitest half).

**Files:**

- Create: `lib/auth/account-status.ts`, `__tests__/account-status.test.ts`
- Modify: `lib/auth/options.ts`, `lib/error-log.ts`, `__tests__/auth-options.test.ts`

**Interfaces:**

- Consumes: `users.adminDeactivatedAt`, `users.directoryDeactivatedAt` (Task 1).
- Produces: `isActive(markers: DeactivationMarkers): boolean` and `interface DeactivationMarkers { adminDeactivatedAt: Date | null; directoryDeactivatedAt: Date | null }` from `@/lib/auth/account-status`; `logSignInRefusal(context: string, reason: string, subject: Record<string, string>): void` from `@/lib/error-log`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/account-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isActive } from '@/lib/auth/account-status'

const at = new Date('2026-10-09T10:00:00Z')

describe('isActive (ADR-0027: two independent markers)', () => {
	it('is true only while both markers are empty', () => {
		expect(isActive({ adminDeactivatedAt: null, directoryDeactivatedAt: null })).toBe(true)
		expect(isActive({ adminDeactivatedAt: at, directoryDeactivatedAt: null })).toBe(false)
		expect(isActive({ adminDeactivatedAt: null, directoryDeactivatedAt: at })).toBe(false)
		expect(isActive({ adminDeactivatedAt: at, directoryDeactivatedAt: at })).toBe(false)
	})

	// Decision a: a select that left a marker out must not let the account in.
	it('fails closed on a marker read as undefined', () => {
		expect(isActive({ adminDeactivatedAt: undefined, directoryDeactivatedAt: null } as never)).toBe(
			false,
		)
		expect(isActive({} as never)).toBe(false)
	})
})
```

In `__tests__/auth-options.test.ts`:

1. Add a constant under the imports and spread it into the `row` constant:

```ts
/** Both deactivation markers empty: an active account (ADR-0027). */
const live = { adminDeactivatedAt: null, directoryDeactivatedAt: null }

const row = {
	id: 'u1',
	email: 'jane@example.com',
	name: 'Jane',
	role: 'admin',
	password: 'hash:right-password',
	sessionVersion: 3,
	...live,
}
```

2. In the `jwt callback` describe, every `rows.value = [{ sessionVersion: …, role: …, email: …, name: … }]` gains `...live` (six places: "refreshes role, email and name", "looks the account up", "gives a token issued before roles existed", and the version-moved case), so those tests keep testing what they tested.

3. Add to the `authorizeCredentials` describe:

```ts
// Spec §5 and §7.3: refused after the password check, with the same answer as a wrong password; the reason is
// logged by account id, never by email (decision b).
it('refuses an account an admin or the directory deactivated, after the password check, and logs its id', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	try {
		for (const markers of [
			{ adminDeactivatedAt: new Date(), directoryDeactivatedAt: null },
			{ adminDeactivatedAt: null, directoryDeactivatedAt: new Date() },
		]) {
			rows.value = [{ ...row, ...markers }]
			expect(
				await authorizeCredentials({ email: 'jane@example.com', password: 'right-password' }),
			).toBeNull()
		}
		expect(warn).toHaveBeenCalledTimes(2)
		expect(warn).toHaveBeenCalledWith('authorizeCredentials: sign-in refused', {
			reason: 'account_inactive',
			userId: 'u1',
		})
		expect(JSON.stringify(warn.mock.calls)).not.toMatch(/jane@example\.com|right-password|hash:/)
	} finally {
		warn.mockRestore()
	}
})

it('answers a wrong password on a deactivated account without telling it is deactivated', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	try {
		rows.value = [{ ...row, adminDeactivatedAt: new Date() }]
		expect(
			await authorizeCredentials({ email: 'jane@example.com', password: 'wrong-password' }),
		).toBeNull()
		expect(warn).not.toHaveBeenCalled()
	} finally {
		warn.mockRestore()
	}
})
```

4. Add to the `jwt callback` describe:

```ts
// Spec §5: a row an admin or the directory deactivated is refused at the token's next use, like a revoked one.
it('strips id, sessionVersion and role from the token of a deactivated account', async () => {
	const signedIn = {
		id: 'u1',
		sessionVersion: 3,
		role: 'user',
		email: 'jane@example.com',
		name: 'Jane',
	} as JWT
	for (const markers of [
		{ adminDeactivatedAt: new Date(), directoryDeactivatedAt: null },
		{ adminDeactivatedAt: null, directoryDeactivatedAt: new Date() },
	]) {
		rows.value = [
			{ sessionVersion: 3, role: 'user', email: 'jane@example.com', name: 'Jane', ...markers },
		]
		expect(await jwt({ token: { ...signedIn } } as never)).toEqual({
			email: 'jane@example.com',
			name: 'Jane',
		})
	}
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/account-status.test.ts __tests__/auth-options.test.ts` Expected: FAIL (`@/lib/auth/account-status` does not exist; the new cases fail).

- [ ] **Step 3: The rule and the log helper**

Create `lib/auth/account-status.ts`:

```ts
/**
 * An account's status (B3 spec §5, ADR-0027): two independent deactivation markers, one written by an admin and one
 * by the directory sync (B3b), each set and cleared only by its owner; the account is active only while both are
 * empty. Fails closed (decision a): a marker read as undefined, such as from a select that left the column out,
 * counts as set. Client-safe: it imports nothing.
 */
export interface DeactivationMarkers {
	adminDeactivatedAt: Date | null
	directoryDeactivatedAt: Date | null
}

export const isActive = (markers: DeactivationMarkers): boolean =>
	markers.adminDeactivatedAt === null && markers.directoryDeactivatedAt === null
```

In `lib/error-log.ts`, append:

```ts
/**
 * A refused sign-in, logged once with a fixed reason code and a subject that names the account without a secret
 * (B3 spec §7.3: the login form shows a generic message, as OWASP's "Authentication Responses" asks, so the reason
 * lives in the server log). Pass an account id or a directory username, never a password, a hash or an email
 * (OWASP Logging Cheat Sheet, "Data to exclude").
 */
export const logSignInRefusal = (
	context: string,
	reason: string,
	subject: Record<string, string>,
): void => {
	console.warn(`${context}: sign-in refused`, { reason, ...subject })
}
```

- [ ] **Step 4: Sign-in and the `jwt` callback**

In `lib/auth/options.ts`:

- import `isActive` from `./account-status` and `logSignInRefusal` beside `logActionError` from `@/lib/error-log`;
- in `findAccount`, select the two markers and refuse an inactive account after the password check:

```ts
async function findAccount(email: string, password: string): Promise<User | null> {
	const [user] = await getDb()
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			password: users.password,
			sessionVersion: users.sessionVersion,
			adminDeactivatedAt: users.adminDeactivatedAt,
			directoryDeactivatedAt: users.directoryDeactivatedAt,
		})
		.from(users)
		.where(eq(users.email, email))
		.limit(1)
	if (!user) return null
	if (!(await verifyPassword(password, user.password))) return null
	// Spec §5: after the password, so a wrong password and a deactivated account take the same path and answer.
	if (!isActive(user)) {
		logSignInRefusal('authorizeCredentials', 'account_inactive', { userId: user.id })
		return null
	}
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		sessionVersion: user.sessionVersion,
	}
}
```

- in the `jwt` callback, select the markers and treat an inactive row as revoked:

```ts
			const [row] = await getDb()
				.select({
					sessionVersion: users.sessionVersion,
					role: users.role,
					email: users.email,
					name: users.name,
					adminDeactivatedAt: users.adminDeactivatedAt,
					directoryDeactivatedAt: users.directoryDeactivatedAt,
				})
				.from(users)
				.where(eq(users.id, token.id))
				.limit(1)
			// ADR-0018's revocation rule, and spec §5: a deactivated row (a marker set, also by hand in the database)
			// strips the token too; deactivation also bumps sessionVersion, so reactivation does not revive it.
			if (!row || row.sessionVersion !== token.sessionVersion || !isActive(row)) {
```

- extend the `authOptions` doc comment: "A deactivated row (ADR-0027) is treated as revoked."

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run __tests__/account-status.test.ts __tests__/auth-options.test.ts` Expected: PASS.

- [ ] **Step 6: The gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/auth/account-status.ts lib/auth/options.ts lib/error-log.ts __tests__/account-status.test.ts __tests__/auth-options.test.ts
pnpm exec oxfmt --write lib/auth/account-status.ts lib/auth/options.ts lib/error-log.ts __tests__/account-status.test.ts __tests__/auth-options.test.ts
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test e2e/auth.spec.ts e2e/account.spec.ts
```

Expected: all PASS (the setup project creates the owner on the fresh database; sign-in and the password change still work with the markers empty).

- [ ] **Step 7: Commit**

```bash
git add lib/auth/account-status.ts lib/auth/options.ts lib/error-log.ts __tests__/account-status.test.ts __tests__/auth-options.test.ts
git commit -m "feat(auth): refuse deactivated accounts at sign-in and on every session check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 3: The access rule in the apps Data Access Layer

Spec §4.1, §4.2, §4.5. Review Focus 1 and 2.

**Files:**

- Modify: `lib/data/apps.ts`, `components/apps/app-gallery.tsx` (no code change; its key's text changes), `locales/{en,zh,ar}/translation.json` (`app.empty_contact_admin`), `e2e/auth.setup.ts`
- Create: `__tests__/data-apps-access.test.ts`, `e2e/fixtures/access.ts`, `e2e/app-access.spec.ts`

**Interfaces:**

- Consumes: `difyApps.accessMode`, `appGroupGrants`, `appUserGrants`, `userGroupMembers` (Task 1); `hasAdminRights` (`@/lib/auth/roles`).
- Produces: `visibleTo(actor: Pick<SessionUser, 'id' | 'role'>): SQL | undefined` from `@/lib/data/apps`; the reads `listApps`, `getChatApp`, `getAppAccess`, `getAppIcon` keep their signatures and now filter. e2e helpers `seedApp`, `deleteApp`, `seedGroup`, `deleteGroupsLike`, `grantAppToUser`, `grantAppToGroup` from `e2e/fixtures/access.ts`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/data-apps-access.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/mysql2'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The fake chain keeps the condition each read passes to where(), so a test can render it on drizzle.mock().
const { where, rows } = vi.hoisted(() => ({
	where: vi.fn(),
	rows: { value: [] as unknown[] },
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => {
	const chain = {
		from: () => chain,
		where: (condition: unknown) => {
			where(condition)
			return chain
		},
		orderBy: () => Promise.resolve(rows.value),
		limit: () => Promise.resolve(rows.value),
	}
	const db = { select: () => chain }
	return { getDb: () => db }
})

import { difyApps } from '@/db/schema'
import { getAppAccess, getAppIcon, getChatApp, listApps, visibleTo } from '@/lib/data/apps'

const user = { id: 'u1', email: 'u@example.com', name: null, role: 'user' as const }
const admin = { id: 'a1', email: 'a@example.com', name: null, role: 'admin' as const }
const owner = { id: 'o1', email: 'o@example.com', name: null, role: 'owner' as const }

/** A condition rendered on a select from dify_apps (no connection). */
const render = (condition: unknown) =>
	drizzle
		.mock()
		.select({ id: difyApps.id })
		.from(difyApps)
		.where(condition as SQL | undefined)
		.toSQL()

beforeEach(() => {
	where.mockClear()
	rows.value = []
})

describe('visibleTo (spec §4.1)', () => {
	it('gives an account with admin rights every app: no condition', () => {
		expect(visibleTo(admin)).toBeUndefined()
		expect(visibleTo(owner)).toBeUndefined()
	})

	it('lets a user see an app open to everyone, granted to it, or granted to one of its groups', () => {
		const { sql, params } = render(visibleTo(user))
		expect(sql).toMatch(/`dify_apps`\.`access_mode` = \?/)
		expect(sql).toMatch(
			/exists \(select .+ from `app_user_grants` where \(`app_user_grants`\.`app_id` = `dify_apps`\.`id` and `app_user_grants`\.`user_id` = \?\)\)/,
		)
		expect(sql).toMatch(
			/exists \(select .+ from `app_group_grants` inner join `user_group_members` on `user_group_members`\.`group_id` = `app_group_grants`\.`group_id` where \(`app_group_grants`\.`app_id` = `dify_apps`\.`id` and `user_group_members`\.`user_id` = \?\)\)/,
		)
		// Any membership counts, whatever its source (spec §4.1); the actor's id is the only account parameter.
		expect(sql).not.toMatch(/`source`/)
		expect(params).toEqual(['everyone', 'u1', 'u1'])
	})

	// Review Focus 2: the rule follows the role the session refreshed from the row (ADR-0024 decision a).
	it('follows the role it is given for the same account', () => {
		expect(visibleTo({ id: 'x1', role: 'user' })).toBeDefined()
		expect(visibleTo({ id: 'x1', role: 'admin' })).toBeUndefined()
	})
})

// Review Focus 1: every read applies the same rule, for the list and for each single-app check.
describe('the app reads apply visibleTo', () => {
	it('listApps: the rule alone for a user, nothing for an admin', async () => {
		await listApps(user)
		expect(render(where.mock.calls[0]![0]).sql).toMatch(/exists/)
		await listApps(admin)
		expect(where.mock.calls[1]![0]).toBeUndefined()
	})

	it.each([
		['getChatApp', () => getChatApp(user, 'app-1')],
		['getAppAccess', () => getAppAccess(user, 'app-1')],
		['getAppIcon', () => getAppIcon(user, 'app-1')],
	] as const)('%s: the id and the rule for a user', async (_name, read) => {
		expect(await read()).toBeNull()
		const { sql, params } = render(where.mock.calls[0]![0])
		expect(sql).toMatch(/`dify_apps`\.`id` = \? and \(/)
		expect(sql).toMatch(/exists/)
		expect(params[0]).toBe('app-1')
	})

	it.each([
		['getChatApp', () => getChatApp(admin, 'app-1')],
		['getAppAccess', () => getAppAccess(admin, 'app-1')],
		['getAppIcon', () => getAppIcon(admin, 'app-1')],
	] as const)('%s: the id alone for an admin', async (_name, read) => {
		await read()
		const { sql, params } = render(where.mock.calls[0]![0])
		expect(sql).not.toMatch(/exists/)
		expect(params).toEqual(['app-1'])
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run __tests__/data-apps-access.test.ts` Expected: FAIL (`visibleTo` is not exported).

- [ ] **Step 3: The rule and the reads**

In `lib/data/apps.ts`:

- imports:

```ts
import { and, desc, eq, exists, or, sql, type SQL } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/mysql-core'

import { getDb } from '@/db'
import { appGroupGrants, appUserGrants, difyApps, userGroupMembers } from '@/db/schema'
import { hasAdminRights } from '@/lib/auth/roles'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'
```

- the module comment's last sentence becomes: "Admin-only writes check the role themselves (assertAdmin); every read applies `visibleTo`, so a `user` reaches only the apps granted to it (ADR-0027)."
- add after `settingsColumns`:

```ts
/** Builds the access rule's subqueries without a database instance (Drizzle docs, standalone query builder; decision d). */
const qb = new QueryBuilder()

/**
 * Which apps an actor may use (B3 spec §4.1, ADR-0027): every app for an account with admin rights (no condition),
 * otherwise an app open to everyone, granted to the account, or granted to a group it belongs to, whatever the
 * membership's source. One rule for the list and every single-app read (spec §4.2; OWASP Authorization "Validate the
 * Permissions on Every Request"; Next "A Data Access Layer should … Perform authorization checks"). Built with
 * Drizzle's `or`/`exists` on correlated subqueries; `and()` skips the undefined an admin gets.
 */
export const visibleTo = (actor: Pick<SessionUser, 'id' | 'role'>): SQL | undefined =>
	hasAdminRights(actor)
		? undefined
		: or(
				eq(difyApps.accessMode, 'everyone'),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appUserGrants)
						.where(and(eq(appUserGrants.appId, difyApps.id), eq(appUserGrants.userId, actor.id))),
				),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appGroupGrants)
						.innerJoin(userGroupMembers, eq(userGroupMembers.groupId, appGroupGrants.groupId))
						.where(
							and(eq(appGroupGrants.appId, difyApps.id), eq(userGroupMembers.userId, actor.id)),
						),
				),
			)
```

- delete `selectDtoRow` and give `readAccess` an optional condition:

```ts
/** The access columns only: the Dify routes (with visibleTo), and the admin writes that re-read Dify with the stored key (without). */
const readAccess = async (id: string, visible?: SQL): Promise<AppAccess | null> => {
	const [row] = await getDb()
		.select({
			id: difyApps.id,
			isEnabled: difyApps.isEnabled,
			enableAnnotation: difyApps.enableAnnotation,
			apiBase: difyApps.apiBase,
			apiKey: difyApps.apiKey,
		})
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visible))
		.limit(1)
	return row
		? {
				id: row.id,
				enabled: row.isEnabled,
				annotationEnabled: row.enableAnnotation,
				credentials: { apiBase: row.apiBase, apiKey: row.apiKey },
			}
		: null
}
```

- replace the four reads:

```ts
export async function listApps(actor: SessionUser): Promise<AppDto[]> {
	const rows = await getDb()
		.select(dtoColumns)
		.from(difyApps)
		.where(visibleTo(actor))
		.orderBy(desc(difyApps.createdAt))
	return rows.map(toAppDto)
}

/** Null for a missing app and for one the actor may not use alike (spec §4.2: no difference to probe). */
export async function getChatApp(actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const [row] = await getDb()
		.select(dtoColumns)
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visibleTo(actor)))
		.limit(1)
	return row ? toChatAppDto(row) : null
}

/** For the Dify routes: the credentials never leave the server; null when missing or not the actor's to use. */
export async function getAppAccess(actor: SessionUser, id: string): Promise<AppAccess | null> {
	return readAccess(id, visibleTo(actor))
}

export async function getAppIcon(
	actor: SessionUser,
	id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
	const [row] = await getDb()
		.select({ iconImage: difyApps.iconImage, iconMime: difyApps.iconMime })
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visibleTo(actor)))
		.limit(1)
	return row?.iconImage && row.iconMime ? { bytes: row.iconImage, mime: row.iconMime } : null
}
```

`updateApp` and `syncApp` keep calling `readAccess(id)` without a condition (admin writes, already `assertAdmin`).

`listApps` now calls `.where()` before `.orderBy()`, so the fake chain in `__tests__/data-apps-sync.test.ts` gains `orderBy` after `where`: its `select` returns `{ from: () => ({ where: () => ({ limit: rows, orderBy: rows }), orderBy: rows }) }`. Nothing else in that file changes in this task.

- [ ] **Step 4: Run the unit tests**

Run: `pnpm exec vitest run __tests__/data-apps-access.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/dify-route.test.ts __tests__/app-icon-route.test.ts` Expected: PASS. If the rendered SQL differs in spacing from the regexes in Step 1 (for example how Drizzle prints `select 1`), adjust only the `select .+ from` part of the pattern, keep every table, column, join and parameter assertion, and say so in the report.

- [ ] **Step 5: The gallery text and the e2e seeds**

Set `app.empty_contact_admin` in the three locales:

- `en`: `"No apps are available to you yet. Ask your administrator."`
- `zh`: `"暂无可用的应用，请联系管理员。"`
- `ar`: `"لا توجد تطبيقات متاحة لك بعد. تواصل مع المسؤول."`

In `e2e/auth.setup.ts`, the stub apps stay open to every account, as the migration leaves existing apps (spec §2 #9): add `access_mode` to the insert and to the `ON DUPLICATE KEY UPDATE` list:

```ts
await db.execute(
	'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, enable_annotation, is_enabled, icon_type, icon, icon_background, access_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE opening_statement_display_mode = ?, enable_annotation = ?, is_enabled = ?, icon_type = ?, icon = ?, icon_background = ?, access_mode = ?',
	[
		app.id,
		app.name,
		app.mode,
		'Seeded for the e2e suite',
		`${stubApiBase}${app.prefix}`,
		'app-e2e',
		app.openingStatementDisplayMode,
		app.enableAnnotation,
		app.enabled === false ? 0 : 1,
		...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
		'everyone',
		app.openingStatementDisplayMode,
		app.enableAnnotation,
		app.enabled === false ? 0 : 1,
		...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
		'everyone',
	],
)
```

and extend the comment above it: "The stub apps are open to everyone, as the B3a migration leaves existing apps (ADR-0027); specs that test access create their own restricted apps (e2e/fixtures/access.ts)."

- [ ] **Step 6: The e2e fixture**

Create `e2e/fixtures/access.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { withDb } from './db'
import { stubApiBase } from './env'

/** A 1×1 PNG, so the icon route has bytes to serve. */
const PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * An app row of the spec's own on the stub's chat app (prefix ''), with a stored image icon; its name must carry the
 * project name, and the spec deletes it in `afterEach` (its grants go with it, ON DELETE CASCADE).
 */
export const seedApp = async ({
	name,
	accessMode,
}: {
	name: string
	accessMode: 'everyone' | 'restricted'
}): Promise<string> => {
	const id = randomUUID()
	await withDb(db =>
		db.execute(
			"INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, access_mode, icon_type, icon, icon_image, icon_mime) VALUES (?, ?, 'chat', 'Seeded for an access spec', ?, 'app-e2e', ?, 'image', 'file-1', ?, 'image/png')",
			[id, name, stubApiBase, accessMode, PIXEL_PNG],
		),
	)
	return id
}

export const deleteApp = (id: string) =>
	withDb(db => db.execute('DELETE FROM dify_apps WHERE id = ?', [id]))

/** Deletes the apps whose name matches a LIKE pattern (a run killed before its clean-up). */
export const deleteAppsLike = (pattern: string) =>
	withDb(db => db.execute('DELETE FROM dify_apps WHERE name LIKE ?', [pattern]))

/** A group with manual members; its name must carry the project name. */
export const seedGroup = async ({
	name,
	memberIds = [],
}: {
	name: string
	memberIds?: string[]
}): Promise<string> => {
	const id = randomUUID()
	await withDb(async db => {
		await db.execute('DELETE FROM user_groups WHERE name = ?', [name])
		await db.execute('INSERT INTO user_groups (id, name) VALUES (?, ?)', [id, name])
		for (const userId of memberIds)
			await db.execute(
				"INSERT INTO user_group_members (group_id, user_id, source) VALUES (?, ?, 'manual')",
				[id, userId],
			)
	})
	return id
}

export const deleteGroupsLike = (pattern: string) =>
	withDb(db => db.execute('DELETE FROM user_groups WHERE name LIKE ?', [pattern]))

export const grantAppToUser = (appId: string, userId: string) =>
	withDb(db =>
		db.execute('INSERT INTO app_user_grants (app_id, user_id) VALUES (?, ?)', [appId, userId]),
	)

export const grantAppToGroup = (appId: string, groupId: string) =>
	withDb(db =>
		db.execute('INSERT INTO app_group_grants (app_id, group_id) VALUES (?, ?)', [appId, groupId]),
	)
```

- [ ] **Step 7: The e2e spec**

Create `e2e/app-access.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import {
	deleteApp,
	deleteAppsLike,
	deleteGroupsLike,
	grantAppToGroup,
	grantAppToUser,
	seedApp,
	seedGroup,
} from './fixtures/access'
import { ADMIN_STATE } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'access-pass-1'
const tag = () => `access-${test.info().project.name}`
const appName = () => `Restricted ${tag()}`
const notFound = { code: 'app_not_found', message: 'No such app.', status: 404 }

// Review Focus 1: an app the account was not granted is answered as a missing one everywhere.
test.describe('per-app access for a user-role account (B3 spec §4)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })
	let appId: string
	let userId: string

	test.beforeEach(async () => {
		await deleteAppsLike(`%${tag()}`)
		userId = await seedUser({
			email: `${tag()}@e2e.local`,
			password: PASSWORD,
			name: 'Access user',
		})
		appId = await seedApp({ name: appName(), accessMode: 'restricted' })
	})
	test.afterEach(async () => {
		await deleteApp(appId)
		await deleteGroupsLike(`%${tag()}`)
		await deleteUsersLike(`${tag()}%`)
	})

	test('cannot see or open an app nobody granted', async ({ page }) => {
		await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
		await expect(page.getByText('Stub app', { exact: true })).toBeVisible()
		await expect(page.getByText(appName(), { exact: true })).toHaveCount(0)
		await page.goto(`/chat/${appId}`)
		await expect(
			page.getByText('No Dify app configuration found. Contact your administrator.'),
		).toBeVisible()
		const parameters = await page.request.get(`/api/dify/${appId}/parameters`)
		expect(parameters.status()).toBe(404)
		expect(await parameters.json()).toEqual(notFound)
		expect((await page.request.get(`/api/apps/${appId}/icon`)).status()).toBe(404)
	})

	test('sees and opens an app granted to the account', async ({ page }) => {
		await grantAppToUser(appId, userId)
		await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
		await expect(page.getByText(appName(), { exact: true })).toBeVisible()
		await page.goto(`/chat/${appId}`)
		await expect(page.getByPlaceholder('Type a message')).toBeVisible()
		expect((await page.request.get(`/api/dify/${appId}/parameters`)).status()).toBe(200)
		const icon = await page.request.get(`/api/apps/${appId}/icon`)
		expect(icon.status()).toBe(200)
		expect(icon.headers()['content-type']).toBe('image/png')
	})

	test('sees an app granted to one of its groups', async ({ page }) => {
		const groupId = await seedGroup({ name: `Group ${tag()}`, memberIds: [userId] })
		await grantAppToGroup(appId, groupId)
		await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
		await expect(page.getByText(appName(), { exact: true })).toBeVisible()
	})
})

test.describe('the owner', () => {
	test.use({ storageState: ADMIN_STATE })
	let appId: string

	test.beforeEach(async () => {
		appId = await seedApp({ name: `Admins only ${tag()}`, accessMode: 'restricted' })
	})
	test.afterEach(async () => {
		await deleteApp(appId)
	})

	test('sees and opens a restricted app nobody was granted', async ({ page }) => {
		await page.goto('/apps')
		await expect(page.getByText(`Admins only ${tag()}`, { exact: true })).toBeVisible()
		await page.goto(`/chat/${appId}`)
		await expect(page.getByPlaceholder('Type a message')).toBeVisible()
	})
})
```

The gallery's empty state for an account with no grant (spec §8) is the existing `apps.length === 0` branch of `components/apps/app-gallery.tsx` with the reworded text. The suite's stub apps are open to everyone and shared by every spec, so the e2e cannot show it without changing other specs' data; Task 9's browser check covers it.

- [ ] **Step 8: Run the specs and the gates**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/apps.ts __tests__/data-apps-access.test.ts e2e/fixtures/access.ts e2e/app-access.spec.ts e2e/auth.setup.ts
pnpm exec oxfmt --write lib/data/apps.ts __tests__/data-apps-access.test.ts e2e/fixtures/access.ts e2e/app-access.spec.ts e2e/auth.setup.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test e2e/app-access.spec.ts e2e/apps.spec.ts e2e/roles.spec.ts e2e/chat.spec.ts e2e/smoke.spec.ts
```

Expected: all PASS on the three projects (the stub apps stay visible to the seeded `user` accounts of `roles.spec.ts`).

- [ ] **Step 9: Commit**

```bash
git add lib/data/apps.ts __tests__/data-apps-access.test.ts e2e/fixtures/access.ts e2e/app-access.spec.ts e2e/auth.setup.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(apps): show and open only the apps an account was granted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 4: The groups Data Access Layer and Server Actions

Spec §4.3 (rights, actions, DAL), §2 #8 (manual memberships only). Review Focus 3 (groups half).

**Files:**

- Create: `lib/data/db-errors.ts`, `lib/data/groups.ts`, `app/(admin)/group-management/actions.ts`, `app/(admin)/group-management/schemas.ts`, `__tests__/data-db-errors.test.ts`, `__tests__/data-groups.test.ts`, `__tests__/group-management-actions.test.ts`, `__tests__/group-management-schemas.test.ts`
- Modify: `lib/data/users.ts` (`isDuplicateEntry` moves; `listUserOptions`), `lib/action-result.ts` (`name_in_use`), `__tests__/data-users.test.ts` (`listUserOptions` in the non-admin list)

**Interfaces:**

- Consumes: `userGroups`, `userGroupMembers`, `appGroupGrants` (Task 1); `isActive` (Task 2); `userIdSchema` (`@/app/(admin)/user-management/schemas`).
- Produces:
  - `@/lib/data/db-errors`: `isDuplicateEntry(error: unknown): boolean`, `isMissingReference(error: unknown): boolean` (and `@/lib/data/users` still re-exports `isDuplicateEntry`);
  - `@/lib/data/groups`: `GroupMemberDto { userId: string; source: MembershipSource }`, `GroupDto { id; name; description: string | null; members: GroupMemberDto[]; appCount: number; createdAt: string; updatedAt: string }`, `GroupOption { id: string; name: string }`, `GroupInput { name: string; description: string; memberIds: string[] }`, `manualMemberChanges(current, next): { add: string[]; remove: string[] }`, `lockGroup(tx, id)`, `listGroups(actor): Promise<GroupDto[]>`, `listGroupOptions(actor): Promise<GroupOption[]>`, `createGroup(actor, input): Promise<ActionResult<{ id: string }>>`, `updateGroup(actor, id, input): Promise<ActionResult>`, `deleteGroup(actor, id): Promise<ActionResult>`;
  - `@/lib/data/users`: `UserOption { id: string; name: string | null; email: string; active: boolean }`, `listUserOptions(actor): Promise<UserOption[]>`;
  - `@/app/(admin)/group-management/schemas`: `groupInputSchema`, `groupIdSchema`, `GROUP_NAME_MAX = 255`, `GROUP_DESCRIPTION_MAX = 1000`, `type GroupFormInput = z.input<typeof groupInputSchema>`;
  - `@/app/(admin)/group-management/actions`: `createGroupAction(input: unknown)`, `updateGroupAction(id: string, input: unknown)`, `deleteGroupAction(id: string)`, each answering `ActionResult`;
  - `ActionErrorCode` gains `'name_in_use'`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/data-db-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isDuplicateEntry, isMissingReference } from '@/lib/data/db-errors'

const mysqlError = (code: string, errno: number) => Object.assign(new Error(code), { code, errno })

describe('MySQL error codes as mysql2 reports them, bare or as the cause of a DrizzleQueryError', () => {
	it('isDuplicateEntry: 1062 ER_DUP_ENTRY', () => {
		expect(isDuplicateEntry(mysqlError('ER_DUP_ENTRY', 1062))).toBe(true)
		expect(
			isDuplicateEntry(new Error('Failed query', { cause: mysqlError('ER_DUP_ENTRY', 1062) })),
		).toBe(true)
		expect(isDuplicateEntry(mysqlError('ER_NO_REFERENCED_ROW_2', 1452))).toBe(false)
		expect(isDuplicateEntry(null)).toBe(false)
	})

	// Review Focus 3: a picked account or group deleted while the form was open.
	it('isMissingReference: 1452 ER_NO_REFERENCED_ROW_2', () => {
		expect(isMissingReference(mysqlError('ER_NO_REFERENCED_ROW_2', 1452))).toBe(true)
		expect(
			isMissingReference(
				new Error('Failed query', { cause: mysqlError('ER_NO_REFERENCED_ROW_2', 1452) }),
			),
		).toBe(true)
		expect(isMissingReference(mysqlError('ER_DUP_ENTRY', 1062))).toBe(false)
		expect(isMissingReference(undefined)).toBe(false)
	})
})
```

Create `__tests__/data-groups.test.ts`:

```ts
import { drizzle } from 'drizzle-orm/mysql2'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import {
	createGroup,
	deleteGroup,
	listGroupOptions,
	listGroups,
	lockGroup,
	manualMemberChanges,
	toGroupDto,
	updateGroup,
} from '@/lib/data/groups'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }

describe('manualMemberChanges (spec §2 #8: an admin changes manual rows only)', () => {
	it('adds the new ids and removes the dropped ones, each once', () => {
		expect(manualMemberChanges(['a', 'b'], ['b', 'c', 'c'])).toEqual({ add: ['c'], remove: ['a'] })
		expect(manualMemberChanges([], ['a'])).toEqual({ add: ['a'], remove: [] })
		expect(manualMemberChanges(['a'], [])).toEqual({ add: [], remove: ['a'] })
		expect(manualMemberChanges(['a'], ['a'])).toEqual({ add: [], remove: [] })
	})
})

describe('toGroupDto', () => {
	it('passes dates as ISO strings and nothing but the DTO fields', () => {
		const at = new Date('2026-10-09T09:05:00.000Z')
		expect(
			toGroupDto(
				{ id: 'g1', name: 'Finance', description: null, createdAt: at, updatedAt: at },
				[{ userId: 'u1', source: 'manual' }],
				2,
			),
		).toEqual({
			id: 'g1',
			name: 'Finance',
			description: null,
			members: [{ userId: 'u1', source: 'manual' }],
			appCount: 2,
			createdAt: '2026-10-09T09:05:00.000Z',
			updatedAt: '2026-10-09T09:05:00.000Z',
		})
	})
})

describe('lockGroup (ADR-0024 decision d)', () => {
	it('is a locking read of one group by its primary key', () => {
		const query = lockGroup(drizzle.mock(), 'g1').toSQL()
		expect(query.sql).toMatch(
			/^select .* from `user_groups` where `user_groups`\.`id` = \? limit \? for update$/,
		)
		expect(query.params).toEqual(['g1', 1])
	})
})

describe('the groups DAL refuses a non-admin actor before any query', () => {
	it.each([
		['listGroups', () => listGroups(member)],
		['listGroupOptions', () => listGroupOptions(member)],
		['createGroup', () => createGroup(member, { name: 'N', description: '', memberIds: [] })],
		['updateGroup', () => updateGroup(member, 'g1', { name: 'N', description: '', memberIds: [] })],
		['deleteGroup', () => deleteGroup(member, 'g1')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
```

Create `__tests__/group-management-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	GROUP_DESCRIPTION_MAX,
	GROUP_NAME_MAX,
	groupIdSchema,
	groupInputSchema,
} from '@/app/(admin)/group-management/schemas'

describe('groupInputSchema (decision c)', () => {
	it('trims, and defaults the description and members', () => {
		expect(groupInputSchema.parse({ name: '  Finance  ' })).toEqual({
			name: 'Finance',
			description: '',
			memberIds: [],
		})
	})

	it('refuses a blank or too long name and a too long description', () => {
		expect(groupInputSchema.safeParse({ name: '   ' }).success).toBe(false)
		expect(groupInputSchema.safeParse({ name: 'x'.repeat(GROUP_NAME_MAX + 1) }).success).toBe(false)
		expect(groupInputSchema.safeParse({ name: 'x'.repeat(GROUP_NAME_MAX) }).success).toBe(true)
		expect(
			groupInputSchema.safeParse({ name: 'N', description: 'd'.repeat(GROUP_DESCRIPTION_MAX + 1) })
				.success,
		).toBe(false)
	})

	it('takes account ids by B2 decision h (1 to 36 characters)', () => {
		expect(groupInputSchema.safeParse({ name: 'N', memberIds: ['legacy-id'] }).success).toBe(true)
		expect(groupInputSchema.safeParse({ name: 'N', memberIds: [''] }).success).toBe(false)
		expect(groupInputSchema.safeParse({ name: 'N', memberIds: ['x'.repeat(37)] }).success).toBe(
			false,
		)
	})

	it('takes UUIDs as group ids', () => {
		expect(groupIdSchema.safeParse(crypto.randomUUID()).success).toBe(true)
		expect(groupIdSchema.safeParse('g1').success).toBe(false)
	})
})
```

Create `__tests__/group-management-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, refresh, writes, locked } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	refresh: vi.fn(),
	writes: { insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	/** The group the locking read finds (lockGroup). */
	locked: { value: undefined as { id: string } | undefined },
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => {
	// select().from().where() is awaited for the current manual members ([]), or ends in .limit().for('update').
	const query = {
		from: () => query,
		where: () => Object.assign(Promise.resolve([]), query),
		limit: () => ({
			for: (strength: string) =>
				strength === 'update'
					? Promise.resolve(locked.value ? [locked.value] : [])
					: Promise.reject(new Error(`lock ${strength}`)),
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
	createGroupAction,
	deleteGroupAction,
	updateGroupAction,
} from '@/app/(admin)/group-management/actions'

const owner = { id: 'o1', email: 'owner@example.com', name: 'Owner', role: 'owner' }
const user = { id: 'u1', email: 'user@example.com', name: 'User', role: 'user' }
const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
const input = { name: 'Finance', description: '', memberIds: ['u2'] }
const mysqlError = (code: string, errno: number) => Object.assign(new Error(code), { code, errno })
const anyWrite = () => Object.values(writes).some(fn => fn.mock.calls.length > 0)

beforeEach(() => {
	getServerSession.mockReset()
	refresh.mockReset()
	for (const fn of Object.values(writes)) {
		fn.mockReset()
		fn.mockResolvedValue([{ affectedRows: 1 }])
	}
	locked.value = { id: groupId }
})

// ADR-0024 deviation 3: the real session chain, so an action that checked only the session would fail here.
describe('a user-role session', () => {
	beforeEach(() => getServerSession.mockResolvedValue({ user }))

	it.each([
		['createGroupAction', () => createGroupAction(input)],
		['updateGroupAction', () => updateGroupAction(groupId, input)],
		['deleteGroupAction', () => deleteGroupAction(groupId)],
	] as const)('%s is forbidden and writes nothing', async (_name, call) => {
		expect(await call()).toEqual({ ok: false, code: 'forbidden' })
		expect(anyWrite()).toBe(false)
	})
})

describe('no session', () => {
	it('answers unauthorized', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await createGroupAction(input)).toEqual({ ok: false, code: 'unauthorized' })
	})
})

describe('the owner', () => {
	beforeEach(() => getServerSession.mockResolvedValue({ user: owner }))

	it('creates a group with its manual members and refreshes the page', async () => {
		const result = await createGroupAction(input)
		expect(result).toMatchObject({ ok: true })
		expect(writes.insert).toHaveBeenCalledTimes(2)
		expect(writes.insert.mock.calls[1]![0]).toEqual([
			{ groupId: expect.any(String), userId: 'u2', source: 'manual' },
		])
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('refuses invalid input on its field, before any write', async () => {
		expect(await createGroupAction({ name: '  ' })).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { name: expect.any(Array) },
		})
		expect(anyWrite()).toBe(false)
	})

	// Decision c and deviation 2: the unique index compares names without case.
	it('answers name_in_use for a name the unique index refuses', async () => {
		writes.insert.mockRejectedValueOnce(
			new Error('Failed query', { cause: mysqlError('ER_DUP_ENTRY', 1062) }),
		)
		expect(await createGroupAction(input)).toEqual({ ok: false, code: 'name_in_use' })
		expect(refresh).not.toHaveBeenCalled()
	})

	// Review Focus 3: a member deleted while the drawer was open.
	it('answers invalid_input on the members when a picked account is gone', async () => {
		writes.insert
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockRejectedValueOnce(
				new Error('Failed query', { cause: mysqlError('ER_NO_REFERENCED_ROW_2', 1452) }),
			)
		expect(await createGroupAction(input)).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { memberIds: ['unknown'] },
		})
	})

	it('updates a group: answers not_found for a malformed or missing id, without a write', async () => {
		expect(await updateGroupAction('g1', input)).toEqual({ ok: false, code: 'not_found' })
		locked.value = undefined
		expect(await updateGroupAction(groupId, input)).toEqual({ ok: false, code: 'not_found' })
		expect(anyWrite()).toBe(false)
	})

	it('updates the name and adds the new manual member', async () => {
		expect(await updateGroupAction(groupId, input)).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
		expect(writes.insert).toHaveBeenCalledTimes(1)
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('deletes a group, and answers not_found when nothing was deleted', async () => {
		expect(await deleteGroupAction(groupId)).toEqual({ ok: true, data: undefined })
		writes.delete.mockResolvedValueOnce([{ affectedRows: 0 }])
		expect(await deleteGroupAction(groupId)).toEqual({ ok: false, code: 'not_found' })
		expect(await deleteGroupAction('nope')).toEqual({ ok: false, code: 'not_found' })
	})
})
```

In `__tests__/data-users.test.ts`, import `listUserOptions` and add `['listUserOptions', () => listUserOptions(member)]` to the "refuses a non-admin actor" table.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/data-db-errors.test.ts __tests__/data-groups.test.ts __tests__/group-management-schemas.test.ts __tests__/group-management-actions.test.ts __tests__/data-users.test.ts` Expected: FAIL (the modules do not exist).

- [ ] **Step 3: The error codes**

Create `lib/data/db-errors.ts`:

```ts
import 'server-only'

const codeOf = (value: unknown) =>
	typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined

/** A mysql2 error code, on the error itself or as the cause of Drizzle's DrizzleQueryError. */
const hasCode = (error: unknown, code: string): boolean =>
	codeOf(error) === code || (error instanceof Error && codeOf(error.cause) === code)

/** MySQL's duplicate-key error (1062 ER_DUP_ENTRY): a unique index refused a write that raced the check before it. */
export const isDuplicateEntry = (error: unknown): boolean => hasCode(error, 'ER_DUP_ENTRY')

/**
 * MySQL's missing parent row (1452 ER_NO_REFERENCED_ROW_2, "Cannot add or update a child row: a foreign key
 * constraint fails"): a foreign key refused an id that no longer exists, such as an account or a group deleted while
 * the admin's form was open (plan deviation 3).
 */
export const isMissingReference = (error: unknown): boolean =>
	hasCode(error, 'ER_NO_REFERENCED_ROW_2')
```

In `lib/data/users.ts`, delete the local `codeOf` and `isDuplicateEntry` with their comment, and add near the imports:

```ts
import { isDuplicateEntry } from './db-errors'

export { isDuplicateEntry } from './db-errors'
```

In `lib/action-result.ts`, add `| 'name_in_use'` after `'email_in_use'`.

- [ ] **Step 4: The account options**

In `lib/data/users.ts`, import `asc` from `drizzle-orm` and `isActive` from `@/lib/auth/account-status`, and add:

```ts
/** An account as the admin pickers show it (spec §4.3, §4.4): no role, no dates, whether it is active. */
export interface UserOption {
	id: string
	name: string | null
	email: string
	active: boolean
}

/** Every account for the group and app pickers, deactivated ones included and tagged (spec §4.3). */
export async function listUserOptions(actor: SessionUser): Promise<UserOption[]> {
	assertAdmin(actor)
	const rows = await getDb()
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			adminDeactivatedAt: users.adminDeactivatedAt,
			directoryDeactivatedAt: users.directoryDeactivatedAt,
		})
		.from(users)
		.orderBy(asc(users.email))
	return rows.map(row => ({ id: row.id, name: row.name, email: row.email, active: isActive(row) }))
}
```

- [ ] **Step 5: The groups DAL**

Create `lib/data/groups.ts`:

```ts
import 'server-only'

import { and, asc, count, eq, inArray } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { appGroupGrants, userGroupMembers, userGroups } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import type { MembershipSource } from '@/lib/app-access'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

import { isDuplicateEntry, isMissingReference } from './db-errors'

/*
 * The groups Data Access Layer (B3 spec §4.3, ADR-0027). Every function takes the verified actor first and checks
 * admin rights itself (ADR-0024's pattern); membership grants no right, so the rank map does not apply. An admin
 * edits manual memberships only; the directory sync (B3b) owns the `directory` rows. DTOs carry ISO dates.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type GroupRow = typeof userGroups.$inferSelect

export interface GroupMemberDto {
	userId: string
	source: MembershipSource
}

export interface GroupDto {
	id: string
	name: string
	description: string | null
	members: GroupMemberDto[]
	appCount: number
	createdAt: string
	updatedAt: string
}

/** A group as the app drawer's picker shows it. */
export interface GroupOption {
	id: string
	name: string
}

/** What the group drawer sends (validated by the action's schema); `memberIds` are the manual members. */
export interface GroupInput {
	name: string
	description: string
	memberIds: string[]
}

export const toGroupDto = (
	row: Pick<GroupRow, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>,
	members: GroupMemberDto[],
	appCount: number,
): GroupDto => ({
	id: row.id,
	name: row.name,
	description: row.description,
	members,
	appCount,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

/** What a save changes in the manual memberships (spec §2 #8): the ids to add and to remove, each once. */
export const manualMemberChanges = (
	current: readonly string[],
	next: readonly string[],
): { add: string[]; remove: string[] } => {
	const now = new Set(current)
	const wanted = new Set(next)
	return {
		add: [...wanted].filter(id => !now.has(id)),
		remove: [...now].filter(id => !wanted.has(id)),
	}
}

/** A locking read of one group by its primary key (ADR-0024 decision d; MySQL 8.4 "Locking Reads"). */
export const lockGroup = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: userGroups.id })
		.from(userGroups)
		.where(eq(userGroups.id, id))
		.limit(1)
		.for('update')

const manualRows = (groupId: string, userIds: readonly string[]) =>
	userIds.map(userId => ({ groupId, userId, source: 'manual' as const }))

/** A write's expected refusals as results; anything else propagates to the action (toActionFailure). */
const refusalOf = (error: unknown) => {
	if (isDuplicateEntry(error)) return fail('name_in_use')
	if (isMissingReference(error)) return fail('invalid_input', { memberIds: ['unknown'] })
	return null
}

export async function listGroups(actor: SessionUser): Promise<GroupDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [groups, members, grants] = await Promise.all([
		db
			.select({
				id: userGroups.id,
				name: userGroups.name,
				description: userGroups.description,
				createdAt: userGroups.createdAt,
				updatedAt: userGroups.updatedAt,
			})
			.from(userGroups)
			.orderBy(asc(userGroups.name)),
		db
			.select({
				groupId: userGroupMembers.groupId,
				userId: userGroupMembers.userId,
				source: userGroupMembers.source,
			})
			.from(userGroupMembers),
		db
			.select({ groupId: appGroupGrants.groupId, apps: count() })
			.from(appGroupGrants)
			.groupBy(appGroupGrants.groupId),
	])
	return groups.map(group =>
		toGroupDto(
			group,
			members
				.filter(member => member.groupId === group.id)
				.map(member => ({ userId: member.userId, source: member.source })),
			grants.find(grant => grant.groupId === group.id)?.apps ?? 0,
		),
	)
}

export async function listGroupOptions(actor: SessionUser): Promise<GroupOption[]> {
	assertAdmin(actor)
	return getDb()
		.select({ id: userGroups.id, name: userGroups.name })
		.from(userGroups)
		.orderBy(asc(userGroups.name))
}

export async function createGroup(
	actor: SessionUser,
	input: GroupInput,
): Promise<ActionResult<{ id: string }>> {
	assertAdmin(actor)
	const id = crypto.randomUUID()
	const memberIds = [...new Set(input.memberIds)]
	try {
		await getDb().transaction(async tx => {
			await tx
				.insert(userGroups)
				.values({ id, name: input.name, description: input.description || null })
			if (memberIds.length) await tx.insert(userGroupMembers).values(manualRows(id, memberIds))
		})
	} catch (error) {
		const refusal = refusalOf(error)
		if (refusal) return refusal
		throw error
	}
	return ok({ id })
}

/** Renames and re-describes the group and replaces its manual members; directory members stay (spec §2 #8). */
export async function updateGroup(
	actor: SessionUser,
	id: string,
	input: GroupInput,
): Promise<ActionResult> {
	assertAdmin(actor)
	try {
		return await getDb().transaction(async tx => {
			const [group] = await lockGroup(tx, id)
			if (!group) return fail('not_found')
			await tx
				.update(userGroups)
				.set({ name: input.name, description: input.description || null })
				.where(eq(userGroups.id, id))
			const current = await tx
				.select({ userId: userGroupMembers.userId })
				.from(userGroupMembers)
				.where(and(eq(userGroupMembers.groupId, id), eq(userGroupMembers.source, 'manual')))
			const { add, remove } = manualMemberChanges(
				current.map(row => row.userId),
				input.memberIds,
			)
			if (remove.length)
				await tx
					.delete(userGroupMembers)
					.where(
						and(
							eq(userGroupMembers.groupId, id),
							eq(userGroupMembers.source, 'manual'),
							inArray(userGroupMembers.userId, remove),
						),
					)
			if (add.length) await tx.insert(userGroupMembers).values(manualRows(id, add))
			return ok(undefined)
		})
	} catch (error) {
		const refusal = refusalOf(error)
		if (refusal) return refusal
		throw error
	}
}

/** Deletes the group; its memberships, grants and (B3b) directory links go with it (ON DELETE CASCADE). */
export async function deleteGroup(actor: SessionUser, id: string): Promise<ActionResult> {
	assertAdmin(actor)
	const [result] = await getDb().delete(userGroups).where(eq(userGroups.id, id))
	return result.affectedRows > 0 ? ok(undefined) : fail('not_found')
}
```

Source: Drizzle `count()` and `groupBy` (Context7 `/drizzle-team/drizzle-orm-docs`, "Select": aggregations), `inArray` (`conditions.d.ts`), `transaction` (docs "Transactions": a throw rolls the transaction back).

- [ ] **Step 6: The schemas and actions**

Create `app/(admin)/group-management/schemas.ts`:

```ts
import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'

export const GROUP_NAME_MAX = 255
export const GROUP_DESCRIPTION_MAX = 1000

/** The group drawer's input (decision c): the manual members only; the directory's are the sync's (spec §2 #8). */
export const groupInputSchema = z.object({
	name: z.string().trim().min(1).max(GROUP_NAME_MAX),
	description: z.string().trim().max(GROUP_DESCRIPTION_MAX).default(''),
	memberIds: z.array(userIdSchema).max(10_000).default([]),
})

/** Group ids are this line's UUIDs (B1's app-id rule). */
export const groupIdSchema = z.uuid()

export type GroupFormInput = z.input<typeof groupInputSchema>
```

Create `app/(admin)/group-management/actions.ts`:

```ts
'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { createGroup, deleteGroup, updateGroup } from '@/lib/data/groups'

import { groupIdSchema, groupInputSchema } from './schemas'

/*
 * Thin Server Actions (ADR-0024): verify the admin, validate, call the DAL, refresh the route (next/cache `refresh`:
 * the page reads the database directly), answer a plain ActionResult. Every expected failure is a result, never a
 * throw; the DAL checks the role again.
 */

export async function createGroupAction(input: unknown): Promise<ActionResult<{ id: string }>> {
	try {
		const actor = await requireAdmin()
		const parsed = groupInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await createGroup(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'createGroupAction')
	}
}

export async function updateGroupAction(id: string, input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!groupIdSchema.safeParse(id).success) return fail('not_found')
		const parsed = groupInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateGroup(actor, id, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'updateGroupAction')
	}
}

export async function deleteGroupAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!groupIdSchema.safeParse(id).success) return fail('not_found')
		const result = await deleteGroup(actor, id)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'deleteGroupAction')
	}
}
```

- [ ] **Step 7: Run the tests and the gates**

```bash
pnpm exec vitest run __tests__/data-db-errors.test.ts __tests__/data-groups.test.ts __tests__/group-management-schemas.test.ts __tests__/group-management-actions.test.ts __tests__/data-users.test.ts __tests__/data-users-writes.test.ts __tests__/user-management-rank.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/db-errors.ts lib/data/groups.ts lib/data/users.ts lib/action-result.ts "app/(admin)/group-management/actions.ts" "app/(admin)/group-management/schemas.ts" __tests__/data-db-errors.test.ts __tests__/data-groups.test.ts __tests__/group-management-schemas.test.ts __tests__/group-management-actions.test.ts __tests__/data-users.test.ts
pnpm exec oxfmt --write lib/data/db-errors.ts lib/data/groups.ts lib/data/users.ts lib/action-result.ts "app/(admin)/group-management/actions.ts" "app/(admin)/group-management/schemas.ts" __tests__/data-db-errors.test.ts __tests__/data-groups.test.ts __tests__/group-management-schemas.test.ts __tests__/group-management-actions.test.ts __tests__/data-users.test.ts
pnpm test
```

Expected: all PASS. If the fake db's `where()` shape in `group-management-actions.test.ts` does not fit a query the DAL builds (for example the member select), adapt the fake, not the DAL, and keep every assertion.

- [ ] **Step 8: Commit**

```bash
git add lib/data/db-errors.ts lib/data/groups.ts lib/data/users.ts lib/action-result.ts "app/(admin)/group-management/actions.ts" "app/(admin)/group-management/schemas.ts" __tests__/data-db-errors.test.ts __tests__/data-groups.test.ts __tests__/group-management-schemas.test.ts __tests__/group-management-actions.test.ts __tests__/data-users.test.ts
git commit -m "feat(groups): add the groups data access layer and server actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 5: The groups page

Spec §4.3. Review Focus: none of its own (the actions are pinned in Task 4); its e2e covers the cascade of a deleted group.

**Files:**

- Create: `app/(admin)/group-management/page.tsx`, `components/admin/groups/group-management.tsx`, `components/admin/groups/group-form-drawer.tsx`, `components/admin/groups/group-errors.ts`, `components/admin/account-option.ts`, `e2e/admin-groups.spec.ts`, `__tests__/group-management-page.test.ts`, `__tests__/group-errors.test.ts`, `__tests__/account-option.test.ts`
- Modify: `components/shell/admin-shell.tsx`, `locales/{en,zh,ar}/translation.json`

**Interfaces:**

- Consumes: `listGroups`, `GroupDto` (`@/lib/data/groups`), `listUserOptions`, `UserOption` (`@/lib/data/users`), the three group actions and `GroupFormInput` (Task 4), `useActionTransition`, `PageHeader`, `SearchInput`, `tablePagination`, `ClientDateTime`, `matchesQuery`.
- Produces: `accountOptionLabel(user: UserOption, deactivatedLabel: string): string` from `@/components/admin/account-option` (Task 6 reuses it); `groupErrorKey(code: ActionErrorCode)` from `@/components/admin/groups/group-errors`; the translation keys `admin.menu_groups`, `admin_groups.*`, `admin_users.status_deactivated`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/account-option.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { accountOptionLabel } from '@/components/admin/account-option'

describe('accountOptionLabel (decision e)', () => {
	it('shows the name with the email, the email alone without a name, and tags a deactivated account', () => {
		expect(
			accountOptionLabel(
				{ id: 'u1', name: 'Jane', email: 'jane@x.io', active: true },
				'Deactivated',
			),
		).toBe('Jane (jane@x.io)')
		expect(
			accountOptionLabel({ id: 'u2', name: null, email: 'joe@x.io', active: true }, 'Deactivated'),
		).toBe('joe@x.io')
		expect(
			accountOptionLabel(
				{ id: 'u3', name: 'Ann', email: 'ann@x.io', active: false },
				'Deactivated',
			),
		).toBe('Ann (ann@x.io) · Deactivated')
	})
})
```

Create `__tests__/group-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { groupErrorKey } from '@/components/admin/groups/group-errors'

describe('groupErrorKey', () => {
	it.each([
		['unauthorized', 'common.session_expired'],
		['forbidden', 'common.forbidden'],
		['not_found', 'admin_groups.not_found'],
		['name_in_use', 'admin_groups.name_in_use'],
		['invalid_input', 'admin_groups.invalid_input'],
		['operation_failed', 'common.operation_failed'],
	] as const)('%s → %s', (code, key) => {
		expect(groupErrorKey(code)).toBe(key)
	})
})
```

Create `__tests__/group-management-page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdminUser, listGroups, listUserOptions, GroupManagement, redirectSignal } =
	vi.hoisted(() => ({
		requireAdminUser: vi.fn(),
		listGroups: vi.fn(),
		listUserOptions: vi.fn(),
		GroupManagement: () => null,
		redirectSignal: new Error('NEXT_REDIRECT'),
	}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/data/groups', () => ({ listGroups }))
vi.mock('@/lib/data/users', () => ({ listUserOptions }))
vi.mock('@/components/admin/groups/group-management', () => ({ default: GroupManagement }))

import GroupManagementPage from '@/app/(admin)/group-management/page'

describe('/group-management page', () => {
	beforeEach(() => {
		requireAdminUser.mockReset()
		listGroups.mockReset()
		listUserOptions.mockReset()
	})

	it('checks the session before it reads anything', async () => {
		requireAdminUser.mockRejectedValue(redirectSignal)
		await expect(GroupManagementPage()).rejects.toBe(redirectSignal)
		expect(listGroups).not.toHaveBeenCalled()
		expect(listUserOptions).not.toHaveBeenCalled()
	})

	it('hands the table the groups and the accounts the picker offers, read as the signed-in admin', async () => {
		const admin = { id: 'a1', email: 'a@e2e.local', name: 'Admin', role: 'admin' }
		requireAdminUser.mockResolvedValue(admin)
		listGroups.mockResolvedValue([{ id: 'g1' }])
		listUserOptions.mockResolvedValue([{ id: 'u1' }])
		expect(await GroupManagementPage()).toMatchObject({
			type: GroupManagement,
			props: { groups: [{ id: 'g1' }], users: [{ id: 'u1' }] },
		})
		expect(listGroups).toHaveBeenCalledWith(admin)
		expect(listUserOptions).toHaveBeenCalledWith(admin)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/account-option.test.ts __tests__/group-errors.test.ts __tests__/group-management-page.test.ts` Expected: FAIL (the modules do not exist).

- [ ] **Step 3: The helpers and the page**

Create `components/admin/account-option.ts`:

```ts
import type { UserOption } from '@/lib/data/users'

/** An account as an admin picker lists it (decision e): name and email, the email alone, and a deactivated tag. */
export const accountOptionLabel = (user: UserOption, deactivatedLabel: string): string => {
	const label = user.name ? `${user.name} (${user.email})` : user.email
	return user.active ? label : `${label} · ${deactivatedLabel}`
}
```

Create `components/admin/groups/group-errors.ts`:

```ts
import type { ActionErrorCode } from '@/lib/action-result'

/** A groups action's failure code as the message the admin reads (charter §4.5: codes, never a server message). */
export const groupErrorKey = (code: ActionErrorCode) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'not_found':
			return 'admin_groups.not_found' as const
		case 'name_in_use':
			return 'admin_groups.name_in_use' as const
		case 'invalid_input':
			return 'admin_groups.invalid_input' as const
		default:
			return 'common.operation_failed' as const
	}
}
```

Create `app/(admin)/group-management/page.tsx`:

```tsx
import GroupManagement from '@/components/admin/groups/group-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listGroups } from '@/lib/data/groups'
import { listUserOptions } from '@/lib/data/users'

/** The groups page (B3 spec §4.3): the server reads the groups and the accounts the member picker offers (ADR-0020). */
export default async function GroupManagementPage() {
	const actor = await requireAdminUser()
	const [groups, users] = await Promise.all([listGroups(actor), listUserOptions(actor)])
	return (
		<GroupManagement
			groups={groups}
			users={users}
		/>
	)
}
```

In `components/shell/admin-shell.tsx`, import `ApartmentOutlined` and add the entry after the users entry:

```tsx
	{ key: '/group-management', icon: <ApartmentOutlined />, label: 'admin.menu_groups' },
```

- [ ] **Step 4: The drawer**

Create `components/admin/groups/group-form-drawer.tsx`. Read `antd doc Select` and `antd demo Select` first (multiple mode, `optionFilterProp`):

```tsx
'use client'

import { App, Button, Drawer, Form, Input, Select, Space } from 'antd'
import { useTranslation } from 'react-i18next'

import { createGroupAction, updateGroupAction } from '@/app/(admin)/group-management/actions'
import {
	GROUP_DESCRIPTION_MAX,
	GROUP_NAME_MAX,
	type GroupFormInput,
} from '@/app/(admin)/group-management/schemas'
import { accountOptionLabel } from '@/components/admin/account-option'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { GroupDto } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'

import { groupErrorKey } from './group-errors'

const GROUP_FORM_ID = 'group-form'

/**
 * Add or edit a group (B3 spec §4.3). The Server Actions run through startTransition from onFinish (ADR-0023 "Admin
 * actions"); the Form owns its instance under `destroyOnHidden` and is keyed by the group it edits (the pattern of
 * the users drawer). The member picker edits the manual members only (spec §2 #8).
 */
export default function GroupFormDrawer({
	open,
	group,
	users,
	onClose,
	onClosed,
}: {
	open: boolean
	/** The group to edit; absent when adding. */
	group?: GroupDto
	users: UserOption[]
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears `group`. */
	onClosed: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()

	const save = (values: GroupFormInput) =>
		void run(async () => {
			const result = group
				? await updateGroupAction(group.id, values)
				: await createGroupAction(values)
			if (!result.ok) {
				message.error(t(groupErrorKey(result.code)))
				return
			}
			message.success(t(group ? 'admin_groups.update_success' : 'admin_groups.add_success'))
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
			title={group ? t('admin_groups.edit_group') : t('admin_groups.add_group')}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						htmlType="submit"
						form={GROUP_FORM_ID}
						loading={pending}
					>
						{group ? t('common.update') : t('common.add')}
					</Button>
				</Space>
			}
		>
			<Form<GroupFormInput>
				key={group?.id ?? 'create'}
				id={GROUP_FORM_ID}
				layout="vertical"
				initialValues={
					group
						? {
								name: group.name,
								description: group.description ?? '',
								memberIds: group.members
									.filter(member => member.source === 'manual')
									.map(member => member.userId),
							}
						: { name: '', description: '', memberIds: [] }
				}
				onFinish={save}
			>
				<Form.Item
					name="name"
					label={t('admin_groups.name')}
					rules={[
						{ required: true, whitespace: true, message: t('admin_groups.name_required') },
						{ max: GROUP_NAME_MAX, message: t('admin_groups.name_too_long') },
					]}
				>
					<Input placeholder={t('admin_groups.name_placeholder')} />
				</Form.Item>
				<Form.Item
					name="description"
					label={t('admin_groups.description')}
					rules={[{ max: GROUP_DESCRIPTION_MAX, message: t('admin_groups.description_too_long') }]}
				>
					<Input.TextArea
						autoSize={{ minRows: 2, maxRows: 6 }}
						placeholder={t('admin_groups.description_placeholder')}
					/>
				</Form.Item>
				<Form.Item
					name="memberIds"
					label={t('admin_groups.members')}
					extra={t('admin_groups.members_hint')}
				>
					<Select
						mode="multiple"
						allowClear
						optionFilterProp="label"
						placeholder={t('admin_groups.members_placeholder')}
						options={users.map(user => ({
							value: user.id,
							label: accountOptionLabel(user, t('admin_users.status_deactivated')),
						}))}
					/>
				</Form.Item>
			</Form>
		</Drawer>
	)
}
```

- [ ] **Step 5: The table**

Create `components/admin/groups/group-management.tsx`:

```tsx
'use client'

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import {
	App,
	Button,
	Col,
	Empty,
	Flex,
	Popconfirm,
	Row,
	Space,
	Table,
	type TableProps,
	Typography,
	theme,
} from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deleteGroupAction } from '@/app/(admin)/group-management/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import { tablePagination } from '@/components/admin/table-pagination'
import PageHeader from '@/components/shell/page-header'
import SearchInput from '@/components/shell/search-input'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { GroupDto } from '@/lib/data/groups'
import type { UserOption } from '@/lib/data/users'
import { matchesQuery } from '@/lib/match-query'

import { groupErrorKey } from './group-errors'
import GroupFormDrawer from './group-form-drawer'

/** The groups table (B3 spec §4.3): search, member and app counts, Server Actions for every write. */
export default function GroupManagement({
	groups,
	users,
}: {
	groups: GroupDto[]
	users: UserOption[]
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [query, setQuery] = useState('')
	// The drawer's `open` follows the admin's action; the group it edits stays until the close animation has ended.
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [editing, setEditing] = useState<GroupDto>()
	const openDrawer = (group?: GroupDto) => {
		setEditing(group)
		setDrawerOpen(true)
	}
	const shown = groups.filter(group => matchesQuery([group.name, group.description ?? ''], query))

	const { run } = useActionTransition()
	const remove = (group: GroupDto) =>
		run(async () => {
			const result = await deleteGroupAction(group.id)
			if (result.ok) message.success(t('admin_groups.delete_success'))
			else message.error(t(groupErrorKey(result.code)))
		})

	const columns: TableProps<GroupDto>['columns'] = [
		{
			title: t('admin_groups.column_group'),
			key: 'group',
			render: (_, group) => (
				<div>
					<div>{group.name}</div>
					{group.description && (
						<Typography.Text type="secondary">{group.description}</Typography.Text>
					)}
				</div>
			),
		},
		{
			title: t('admin_groups.column_members'),
			key: 'members',
			render: (_, group) => group.members.length,
		},
		{ title: t('admin_groups.column_apps'), key: 'apps', render: (_, group) => group.appCount },
		{
			title: t('common.created_at'),
			key: 'createdAt',
			render: (_, group) => <ClientDateTime value={group.createdAt} />,
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, group) => (
				<Space>
					<Button
						type="text"
						icon={<EditOutlined />}
						onClick={() => openDrawer(group)}
					>
						{t('common.edit')}
					</Button>
					<Popconfirm
						title={t('admin_groups.delete_confirm_title')}
						description={t('admin_groups.delete_confirm_description')}
						okText={t('common.delete')}
						okButtonProps={{ danger: true }}
						cancelText={t('common.cancel')}
						onConfirm={() => remove(group)}
					>
						<Button
							type="text"
							danger
							icon={<DeleteOutlined />}
						>
							{t('common.delete')}
						</Button>
					</Popconfirm>
				</Space>
			),
		},
	]

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<PageHeader
				title={t('admin.menu_groups')}
				subtitle={t('admin_groups.subtitle')}
				action={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => openDrawer()}
					>
						{t('admin_groups.add_group')}
					</Button>
				}
			/>
			<Row>
				<Col
					xs={24}
					md={12}
					lg={8}
				>
					<SearchInput
						placeholder={t('admin_groups.search_placeholder')}
						value={query}
						onChange={setQuery}
					/>
				</Col>
			</Row>
			<Table
				rowKey="id"
				columns={columns}
				dataSource={shown}
				scroll={{ x: 'max-content' }}
				locale={
					query.trim()
						? {
								emptyText: (
									<Empty
										image={Empty.PRESENTED_IMAGE_SIMPLE}
										description={t('admin_groups.no_match')}
									/>
								),
							}
						: undefined
				}
				pagination={tablePagination(total => t('admin_groups.total', { total }))}
			/>
			<GroupFormDrawer
				open={drawerOpen}
				group={editing}
				users={users}
				onClose={() => setDrawerOpen(false)}
				onClosed={() => setEditing(undefined)}
			/>
		</Flex>
	)
}
```

- [ ] **Step 6: The translations**

Add to `admin` in each locale: `"menu_groups"` — en `"Group management"`, zh `"群组管理"`, ar `"إدارة المجموعات"`.

Add `"status_deactivated"` to `admin_users` — en `"Deactivated"`, zh `"已停用"`, ar `"معطَّل"`.

Add a new `admin_groups` object after `admin_users` in each locale:

| key | en | zh | ar |
| --- | --- | --- | --- |
| `subtitle` | Group accounts to give them apps together | 将账户分组，统一授予应用 | اجمع الحسابات في مجموعات لمنحها التطبيقات معًا |
| `add_group` | Add group | 添加群组 | إضافة مجموعة |
| `edit_group` | Edit group | 编辑群组 | تعديل المجموعة |
| `column_group` | Group | 群组 | المجموعة |
| `column_members` | Members | 成员 | الأعضاء |
| `column_apps` | Apps | 应用 | التطبيقات |
| `name` | Name | 名称 | الاسم |
| `name_required` | Enter a group name | 请输入群组名称 | أدخل اسم المجموعة |
| `name_too_long` | Name must be at most 255 characters | 名称不能超过 255 个字符 | يجب ألا يزيد الاسم على 255 حرفًا |
| `name_placeholder` | Enter a group name | 请输入群组名称 | أدخل اسم المجموعة |
| `description` | Description | 描述 | الوصف |
| `description_placeholder` | What this group is for (optional) | 群组用途（可选） | الغرض من هذه المجموعة (اختياري) |
| `description_too_long` | Description must be at most 1000 characters | 描述不能超过 1000 个字符 | يجب ألا يزيد الوصف على 1000 حرف |
| `members` | Members | 成员 | الأعضاء |
| `members_placeholder` | Choose accounts | 选择账户 | اختر الحسابات |
| `members_hint` | Membership matters only for accounts with the User role: the owner and admins see every app. | 群组成员资格只对普通用户生效：所有者和管理员可以看到所有应用。 | لا تؤثر العضوية إلا في الحسابات ذات دور «مستخدم»: يرى المالك والمسؤولون جميع التطبيقات. |
| `search_placeholder` | Search groups | 搜索群组 | ابحث في المجموعات |
| `no_match` | No groups match your search | 没有符合搜索条件的群组 | لا توجد مجموعات تطابق بحثك |
| `total` | Total groups: {{total}} | 群组总数：{{total}} | إجمالي المجموعات: {{total}} |
| `delete_confirm_title` | Delete this group? | 删除这个群组吗？ | حذف هذه المجموعة؟ |
| `delete_confirm_description` | Its members lose the apps granted through it. This cannot be undone. | 成员将失去通过该群组授予的应用。此操作不可恢复。 | سيفقد أعضاؤها التطبيقات الممنوحة من خلالها. لا يمكن التراجع عن هذا الإجراء. |
| `delete_success` | Group deleted | 群组已删除 | تم حذف المجموعة |
| `add_success` | Group added | 群组已添加 | تمت إضافة المجموعة |
| `update_success` | Group updated | 群组已更新 | تم تحديث المجموعة |
| `not_found` | Group not found | 群组不存在 | المجموعة غير موجودة |
| `name_in_use` | A group with this name already exists | 已存在同名群组 | توجد مجموعة بهذا الاسم بالفعل |
| `invalid_input` | Check the fields and try again. An account you chose may have been deleted. | 请检查填写的内容后重试。你选择的账户可能已被删除。 | راجع الحقول وأعد المحاولة. ربما حُذف حساب اخترته. |

- [ ] **Step 7: The e2e spec**

Create `e2e/admin-groups.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import type { RowDataPacket } from 'mysql2/promise'

import { deleteApp, deleteGroupsLike, grantAppToGroup, seedApp } from './fixtures/access'
import { ADMIN_STATE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'groups-pass-1'
const tag = () => `grp-${test.info().project.name}`
const groupName = () => `Group ${tag()}`
const email = () => `${tag()}@e2e.local`

test.use({ storageState: ADMIN_STATE })

const openGroups = async (page: Page) => {
	await page.goto('/group-management')
	await expect(page.getByRole('heading', { name: 'Group management' })).toBeVisible()
}

/** Opens the drawer's member picker, filters by the account's email and picks it (antd Select options carry a title). */
const pickMember = async (page: Page, label: string, filter: string) => {
	await page.getByLabel('Members').fill(filter)
	await page.getByTitle(label, { exact: true }).click()
}

test.describe('the groups page (B3 spec §4.3)', () => {
	let userId: string

	test.beforeEach(async () => {
		await deleteGroupsLike(`%${tag()}%`)
		userId = await seedUser({ email: email(), password: PASSWORD, name: 'Group member' })
	})
	test.afterEach(async () => {
		await deleteGroupsLike(`%${tag()}%`)
		await deleteUsersLike(`${tag()}%`)
	})

	test('creates a group with a member, renames it, refuses a duplicate name and deletes it', async ({
		page,
	}) => {
		await openGroups(page)
		await page.getByRole('button', { name: 'Add group' }).click()
		await page.getByLabel('Name').fill(groupName())
		await pickMember(page, `Group member (${email()})`, email())
		await page.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(page.getByText('Group added')).toBeVisible()
		const row = page.getByRole('row', { name: new RegExp(groupName()) })
		await expect(row.getByRole('cell', { name: '1', exact: true })).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		await page.getByLabel('Name').fill(`${groupName()} renamed`)
		await page.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('Group updated')).toBeVisible()

		// The unique index compares names without case (deviation 2).
		await page.getByRole('button', { name: 'Add group' }).click()
		await page.getByLabel('Name').fill(`${groupName()} RENAMED`.toLowerCase())
		await page.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(page.getByText('A group with this name already exists')).toBeVisible()
		await page.getByRole('button', { name: 'Cancel' }).click()

		const renamed = page.getByRole('row', { name: new RegExp(`${groupName()} renamed`) })
		await renamed.getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
		await expect(page.getByText('Group deleted')).toBeVisible()
		await expect(renamed).toHaveCount(0)
	})

	// Spec §3.1: deleting a group removes its grants (ON DELETE CASCADE), so its members lose the app.
	test('deleting a group takes away the apps granted through it', async ({ page, browser }) => {
		const appId = await seedApp({ name: `Through group ${tag()}`, accessMode: 'restricted' })
		const member = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			await openGroups(page)
			await page.getByRole('button', { name: 'Add group' }).click()
			await page.getByLabel('Name').fill(groupName())
			await pickMember(page, `Group member (${email()})`, email())
			await page.getByRole('button', { name: 'Add', exact: true }).click()
			await expect(page.getByText('Group added')).toBeVisible()
			// The group the form created, read back from MySQL (the pattern of e2e/admin-users.spec.ts).
			const [found] = await withDb(db =>
				db.execute<RowDataPacket[]>('SELECT id FROM user_groups WHERE name = ?', [groupName()]),
			)
			expect(found).toHaveLength(1)
			await grantAppToGroup(appId, found[0]!.id as string)

			const memberPage = await member.newPage()
			await signInAs(memberPage, email(), PASSWORD)
			await expect(memberPage.getByText(`Through group ${tag()}`, { exact: true })).toBeVisible()

			const row = page.getByRole('row', { name: new RegExp(groupName()) })
			await row.getByRole('button', { name: 'Delete' }).click()
			await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
			await expect(page.getByText('Group deleted')).toBeVisible()

			await memberPage.reload()
			await expect(memberPage.getByText(`Through group ${tag()}`, { exact: true })).toHaveCount(0)
		} finally {
			await member.close()
			await deleteApp(appId)
		}
	})
})

test('the admin navigation reaches the groups page', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('link', { name: 'Group management' }).click()
	await expect(page).toHaveURL(/\/group-management$/)
})
```

- [ ] **Step 8: Run the specs and the gates**

```bash
pnpm exec vitest run __tests__/account-option.test.ts __tests__/group-errors.test.ts __tests__/group-management-page.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint "app/(admin)/group-management/page.tsx" components/admin/groups components/admin/account-option.ts components/shell/admin-shell.tsx e2e/admin-groups.spec.ts __tests__/account-option.test.ts __tests__/group-errors.test.ts __tests__/group-management-page.test.ts
pnpm exec oxfmt --write "app/(admin)/group-management/page.tsx" components/admin/groups components/admin/account-option.ts components/shell/admin-shell.tsx e2e/admin-groups.spec.ts __tests__/account-option.test.ts __tests__/group-errors.test.ts __tests__/group-management-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
npx -y @ant-design/cli lint ./
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test e2e/admin-groups.spec.ts e2e/shell.spec.ts e2e/page-headers.spec.ts
```

Expected: all PASS on the three projects; the antd lint reports zero findings. If `e2e/page-headers.spec.ts` or `e2e/shell.spec.ts` enumerates the admin pages, add `/group-management` there with the same assertions.

- [ ] **Step 9: Commit**

```bash
git add "app/(admin)/group-management/page.tsx" components/admin/groups components/admin/account-option.ts components/shell/admin-shell.tsx e2e/admin-groups.spec.ts __tests__/account-option.test.ts __tests__/group-errors.test.ts __tests__/group-management-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(groups): add the groups page with members and the admin navigation entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 6: App access on the app

Spec §4.4, §2 #9 (closed by default). Review Focus 3 (apps half).

**Files:**

- Modify: `app/(admin)/app-management/schemas.ts`, `app/(admin)/app-management/actions.ts`, `app/(admin)/app-management/page.tsx`, `lib/data/apps.ts`, `components/admin/apps/{admin-app-row,app-form-values,app-form-drawer,app-settings-fields,app-management}.ts(x)`, `locales/{en,zh,ar}/translation.json`, `e2e/admin-apps.spec.ts`, `__tests__/{app-management-schemas,app-management-actions,app-management-page,data-apps,admin-app-row,app-form-values}.test.ts`

**Interfaces:**

- Consumes: `AppAccessSettings`, `ACCESS_MODES` (Task 1); `listGroupOptions`, `GroupOption` (Task 4); `listUserOptions`, `UserOption` (Task 4); `isMissingReference` (Task 4); `accountOptionLabel` (Task 5).
- Produces: `accessSchema` (`app-management/schemas.ts`); `AppInput.access: AppAccessSettings`; `AdminAppDto extends AppDto { access: AppAccessSettings }`, `toAdminAppDto`, `listAdminApps(actor): Promise<AdminAppDto[]>`, `grantRowsFor(appId, access): { groups: { appId: string; groupId: string }[]; users: { appId: string; userId: string }[] }` from `@/lib/data/apps`; `AdminAppRow = AdminAppDto`, `AccessSummary`, `accessSummary(access)` from `components/admin/apps/admin-app-row.ts`.

- [ ] **Step 1: Write the failing tests**

In `__tests__/app-management-schemas.test.ts`, add:

```ts
import { accessSchema } from '@/app/(admin)/app-management/schemas'

describe('accessSchema (B3 spec §4.4)', () => {
	const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'

	it('defaults the grant lists and takes the two modes only', () => {
		expect(accessSchema.parse({ mode: 'restricted' })).toEqual({
			mode: 'restricted',
			groupIds: [],
			userIds: [],
		})
		expect(accessSchema.safeParse({ mode: 'public' }).success).toBe(false)
	})

	it('takes UUID group ids and account ids by B2 decision h', () => {
		expect(
			accessSchema.safeParse({ mode: 'restricted', groupIds: [groupId], userIds: ['legacy-1'] })
				.success,
		).toBe(true)
		expect(accessSchema.safeParse({ mode: 'restricted', groupIds: ['g1'] }).success).toBe(false)
		expect(accessSchema.safeParse({ mode: 'restricted', userIds: [''] }).success).toBe(false)
	})
})
```

and give every valid app input in that file an `access: { mode: 'restricted', groupIds: [], userIds: [] }` field; add a case that an input without `access` is refused (`appInputSchema.safeParse({ …valid without access })` → `success: false`).

In `__tests__/data-apps.test.ts`, import `grantRowsFor`, `listAdminApps` and `toAdminAppDto`, and add:

```ts
describe('grantRowsFor (spec §4.4, deviation 4)', () => {
	it('stores no grant for an app open to everyone', () => {
		expect(grantRowsFor('a1', { mode: 'everyone', groupIds: ['g1'], userIds: ['u1'] })).toEqual({
			groups: [],
			users: [],
		})
	})

	it('stores each restricted grant once', () => {
		expect(
			grantRowsFor('a1', { mode: 'restricted', groupIds: ['g1', 'g1'], userIds: ['u1', 'u2'] }),
		).toEqual({
			groups: [{ appId: 'a1', groupId: 'g1' }],
			users: [
				{ appId: 'a1', userId: 'u1' },
				{ appId: 'a1', userId: 'u2' },
			],
		})
	})
})

describe('toAdminAppDto', () => {
	it('adds the mode and only this app’s grants to the DTO', () => {
		const dto = toAdminAppDto(
			{ ...row, accessMode: 'restricted' },
			[
				{ appId: 'a1', groupId: 'g1' },
				{ appId: 'other', groupId: 'g2' },
			],
			[{ appId: 'a1', userId: 'u1' }],
		)
		expect(dto.access).toEqual({ mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] })
		expect(dto).not.toHaveProperty('apiKey')
	})
})
```

and add `['listAdminApps', () => listAdminApps(member)]` to the file's table "the apps DAL refuses a non-admin actor before anything else".

In `__tests__/admin-app-row.test.ts` (create it if absent), add:

```ts
import { describe, expect, it } from 'vitest'

import { accessSummary } from '@/components/admin/apps/admin-app-row'

describe('accessSummary (spec §4.4: the table tag)', () => {
	it('says everyone, admins only, or how many groups and people', () => {
		expect(accessSummary({ mode: 'everyone', groupIds: ['g1'], userIds: [] })).toEqual({
			kind: 'everyone',
		})
		expect(accessSummary({ mode: 'restricted', groupIds: [], userIds: [] })).toEqual({
			kind: 'admins_only',
		})
		expect(accessSummary({ mode: 'restricted', groupIds: ['g1', 'g2'], userIds: ['u1'] })).toEqual({
			kind: 'restricted',
			groups: 2,
			people: 1,
		})
	})
})
```

In `__tests__/app-form-values.test.ts`, expect `DEFAULT_APP_FORM_VALUES.access` to equal `{ mode: 'restricted', groupIds: [], userIds: [] }` (spec §2 #9) and `toAppFormValues(app)` to carry `app.access`.

In `__tests__/app-management-actions.test.ts` (it mocks the apps DAL), the shared `input` gains `access: { mode: 'restricted', groupIds: [], userIds: [] }`, and add to the `app actions` describe:

```ts
// Review Focus 3 and deviation 3: a group or account picked in the drawer was deleted before the save.
it.each([
	['createAppAction', () => createAppAction(input), createApp],
	['updateAppAction', () => updateAppAction(UUID, input), updateApp],
] as const)(
	'%s answers invalid_input on the access field when a granted id is gone',
	async (_name, call, dal) => {
		dal.mockRejectedValue(
			new Error('Failed query', {
				cause: Object.assign(new Error('ER_NO_REFERENCED_ROW_2'), {
					code: 'ER_NO_REFERENCED_ROW_2',
					errno: 1452,
				}),
			}),
		)
		expect(await call()).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { access: ['unknown'] },
		})
		expect(refresh).not.toHaveBeenCalled()
	},
)

it('passes the access settings to the DAL as parsed', async () => {
	createApp.mockResolvedValue({ id: UUID, partial: false })
	const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
	const granted = { ...input, access: { mode: 'restricted', groupIds: [groupId], userIds: ['u7'] } }
	await createAppAction(granted)
	expect(createApp).toHaveBeenCalledWith(actor, granted)
})
```

In `__tests__/data-apps.test.ts`, the shared `appInput` gains the same `access` field.

In `__tests__/app-management-page.test.ts`, mock `listAdminApps` (instead of `listApps`), `listGroupOptions` and `listUserOptions`, and expect `props: { apps: rows, groups, users }`, each read called with the actor, none before the session check.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/app-management-schemas.test.ts __tests__/data-apps.test.ts __tests__/admin-app-row.test.ts __tests__/app-form-values.test.ts __tests__/app-management-actions.test.ts __tests__/app-management-page.test.ts` Expected: FAIL.

- [ ] **Step 3: The schema and the DAL**

In `app/(admin)/app-management/schemas.ts`:

```ts
import * as z from 'zod'

import { userIdSchema } from '@/app/(admin)/user-management/schemas'
import { ACCESS_MODES } from '@/lib/app-access'
import { APP_MODES } from '@/lib/dify/types'

/** Who may use the app (B3 spec §4.4): the grants count while restricted; group ids are UUIDs, account ids follow B2 decision h. */
export const accessSchema = z.object({
	mode: z.enum(ACCESS_MODES),
	groupIds: z.array(z.uuid()).max(1000).default([]),
	userIds: z.array(userIdSchema).max(10_000).default([]),
})
```

and add `access: accessSchema,` to `appInputSchema` (after `settings`).

In `lib/data/apps.ts`:

- import `type AccessMode, type AppAccessSettings` from `@/lib/app-access`, change the `@/db` import to `import { getDb, type Db } from '@/db'`, and add `type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]` near the other types;
- `AppInput` gains `access: AppAccessSettings`;
- add the admin DTO and the grant helpers:

```ts
/** The admin's view (plan deviation 1): the app DTO and who may use it; the gallery never receives the grants. */
export interface AdminAppDto extends AppDto {
	access: AppAccessSettings
}

export const toAdminAppDto = (
	row: DtoRow & { accessMode: AccessMode },
	groupGrants: { appId: string; groupId: string }[],
	userGrants: { appId: string; userId: string }[],
): AdminAppDto => ({
	...toAppDto(row),
	access: {
		mode: row.accessMode,
		groupIds: groupGrants.filter(grant => grant.appId === row.id).map(grant => grant.groupId),
		userIds: userGrants.filter(grant => grant.appId === row.id).map(grant => grant.userId),
	},
})

/** The grant rows an access setting stores (spec §4.4): none while open to everyone (deviation 4), each id once. */
export const grantRowsFor = (appId: string, access: AppAccessSettings) =>
	access.mode === 'everyone'
		? { groups: [], users: [] }
		: {
				groups: [...new Set(access.groupIds)].map(groupId => ({ appId, groupId })),
				users: [...new Set(access.userIds)].map(userId => ({ appId, userId })),
			}

/** Replaces the app's grants inside the caller's transaction; a deleted group or account fails it (1452). */
const writeGrants = async (
	tx: Pick<Tx, 'delete' | 'insert'>,
	appId: string,
	access: AppAccessSettings,
) => {
	const rows = grantRowsFor(appId, access)
	await tx.delete(appGroupGrants).where(eq(appGroupGrants.appId, appId))
	await tx.delete(appUserGrants).where(eq(appUserGrants.appId, appId))
	if (rows.groups.length) await tx.insert(appGroupGrants).values(rows.groups)
	if (rows.users.length) await tx.insert(appUserGrants).values(rows.users)
}

/** Every app with its access, for /app-management (deviation 1). */
export async function listAdminApps(actor: SessionUser): Promise<AdminAppDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [rows, groupGrants, userGrants] = await Promise.all([
		db
			.select({ ...dtoColumns, accessMode: difyApps.accessMode })
			.from(difyApps)
			.orderBy(desc(difyApps.createdAt)),
		db
			.select({ appId: appGroupGrants.appId, groupId: appGroupGrants.groupId })
			.from(appGroupGrants),
		db.select({ appId: appUserGrants.appId, userId: appUserGrants.userId }).from(appUserGrants),
	])
	return rows.map(row => toAdminAppDto(row, groupGrants, userGrants))
}
```

- in `createApp`, the insert and the grants share a transaction (the Dify fetch stays before it):

```ts
const id = crypto.randomUUID()
await getDb().transaction(async tx => {
	await tx.insert(difyApps).values({
		id,
		...infoColumns(info),
		// Dify reports the mode; the form's choice only decides when Dify's is not one of the known six.
		mode: isAppMode(info.mode) ? info.mode : input.mode,
		isEnabled: input.enabled,
		accessMode: input.access.mode,
		apiBase: input.apiBase,
		apiKey: input.apiKey,
		...settingsColumns(input.settings),
		...iconColumns,
	})
	await writeGrants(tx, id, input.access)
})
return { id, partial }
```

- in `updateApp`, the same:

```ts
await getDb().transaction(async tx => {
	await tx
		.update(difyApps)
		.set({
			...infoColumns(info),
			mode: isAppMode(info.mode) ? info.mode : input.mode,
			isEnabled: input.enabled,
			accessMode: input.access.mode,
			apiBase: credentials.apiBase,
			apiKey: credentials.apiKey,
			...settingsColumns(input.settings),
			...iconColumns,
		})
		.where(eq(difyApps.id, id))
	await writeGrants(tx, id, input.access)
})
return { id, partial }
```

In `__tests__/data-apps-sync.test.ts`, the fake `db` gains what the transaction and the grant writes call: `transaction: async (work: (tx: unknown) => unknown) => work(db)` and `delete: () => ({ where: async () => [{ affectedRows: 0 }] })`; the create cases' `input` gains `access: { mode: 'restricted', groupIds: [], userIds: [] }` (no grant rows, so `db.values` still holds the app row), and the create assertion adds `accessMode: 'restricted'` to its `toMatchObject`. Add one case: a create with `access: { mode: 'restricted', groupIds: ['g1'], userIds: [] }` records the grant rows (make `insert().values` push every call into a `db.inserted` list, and expect it to end with `[{ appId: expect.any(String), groupId: 'g1' }]`).

- [ ] **Step 4: The actions and the page**

In `app/(admin)/app-management/actions.ts`, import `isMissingReference` from `@/lib/data/db-errors`, and in the `catch` of `createAppAction` and `updateAppAction`, before `toActionFailure`:

```ts
	} catch (error) {
		// Deviation 3: a group or account picked in the drawer was deleted before the save; nothing was written.
		if (isMissingReference(error)) return fail('invalid_input', { access: ['unknown'] })
		return toActionFailure(error, 'createAppAction')
	}
```

(`'updateAppAction'` in the second.) Replace `app/(admin)/app-management/page.tsx`:

```tsx
import AppManagement from '@/components/admin/apps/app-management'
import { requireAdminUser } from '@/lib/auth/session'
import { listAdminApps } from '@/lib/data/apps'
import { listGroupOptions } from '@/lib/data/groups'
import { listUserOptions } from '@/lib/data/users'

/** The DTO carries no key (charter §4.4); the admin reads add each app's access and the pickers' options (B3 spec §4.4). */
export default async function AppManagementPage() {
	const actor = await requireAdminUser()
	const [apps, groups, users] = await Promise.all([
		listAdminApps(actor),
		listGroupOptions(actor),
		listUserOptions(actor),
	])
	return (
		<AppManagement
			apps={apps}
			groups={groups}
			users={users}
		/>
	)
}
```

- [ ] **Step 5: The drawer, the fields and the table**

`components/admin/apps/admin-app-row.ts`:

```ts
import type { AppAccessSettings } from '@/lib/app-access'
import type { AdminAppDto } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

/** The admin table's row is the admin DTO: no key (charter §4.4), and the app's access (B3 spec §4.4). */
export type AdminAppRow = AdminAppDto

/** Dify documents GET /apps/annotations for chatbot, chatflow and the legacy agent apps. */
export const supportsAnnotations = (mode: AppMode | null) =>
	mode === 'chat' || mode === 'advanced-chat' || mode === 'agent-chat'

export type AccessSummary =
	| { kind: 'everyone' }
	| { kind: 'admins_only' }
	| { kind: 'restricted'; groups: number; people: number }

/** The table's access tag (spec §4.4): restricted with no grant means only the owner and admins can use the app. */
export const accessSummary = (access: AppAccessSettings): AccessSummary => {
	if (access.mode === 'everyone') return { kind: 'everyone' }
	if (access.groupIds.length + access.userIds.length === 0) return { kind: 'admins_only' }
	return { kind: 'restricted', groups: access.groupIds.length, people: access.userIds.length }
}
```

`components/admin/apps/app-form-values.ts`: `DEFAULT_APP_FORM_VALUES` gains `access: { mode: 'restricted', groupIds: [], userIds: [] }` (spec §2 #9: closed by default); `toAppFormValues` takes `AdminAppDto` and adds `access: app.access`.

`components/admin/apps/app-form-drawer.tsx`: `record?: AdminAppRow` (import from `./admin-app-row`), new props `groups: GroupOption[]` and `users: UserOption[]`, passed to `<AppSettingsFields record={record} groups={groups} users={users} />`.

`components/admin/apps/app-settings-fields.tsx`: props `{ record?: AdminAppRow; groups: GroupOption[]; users: UserOption[] }`; import `Radio` from antd and `accountOptionLabel`; watch the mode; insert after the status `Form.Item` (end of "Basic information"):

```tsx
			<Divider titlePlacement="start">{t('app_setting.section_access')}</Divider>
			<Form.Item
				label={t('app_setting.access')}
				name={['access', 'mode']}
				tooltip={t('app_setting.access_tooltip')}
			>
				<Radio.Group
					optionType="button"
					options={[
						{ value: 'everyone', label: t('app_setting.access_everyone') },
						{ value: 'restricted', label: t('app_setting.access_restricted') },
					]}
				/>
			</Form.Item>
			{accessMode === 'restricted' && (
				<>
					<Form.Item
						label={t('app_setting.access_groups')}
						name={['access', 'groupIds']}
					>
						<Select
							mode="multiple"
							allowClear
							optionFilterProp="label"
							placeholder={t('app_setting.access_groups_placeholder')}
							options={groups.map(group => ({ value: group.id, label: group.name }))}
						/>
					</Form.Item>
					<Form.Item
						label={t('app_setting.access_people')}
						name={['access', 'userIds']}
						extra={t('app_setting.access_admins_hint')}
					>
						<Select
							mode="multiple"
							allowClear
							optionFilterProp="label"
							placeholder={t('app_setting.access_people_placeholder')}
							options={users.map(user => ({
								value: user.id,
								label: accountOptionLabel(user, t('admin_users.status_deactivated')),
							}))}
						/>
					</Form.Item>
				</>
			)}
```

with `const accessMode = Form.useWatch(['access', 'mode'], form)` beside `replyOn`. The hidden pickers keep their values in the form store (antd `Form.Item` `preserve` defaults to true), and the DAL drops grants for `everyone` (deviation 4).

`components/admin/apps/app-management.tsx`: props `{ apps: AdminAppRow[]; groups: GroupOption[]; users: UserOption[] }`; pass `groups` and `users` to `AppFormDrawer`; add a column after "Status":

```tsx
		{
			title: t('admin_apps.column_access'),
			key: 'access',
			render: (_, app) => {
				const summary = accessSummary(app.access)
				if (summary.kind === 'everyone') return <Tag color="green">{t('admin_apps.access_everyone')}</Tag>
				if (summary.kind === 'admins_only')
					return <Tag color="warning">{t('admin_apps.access_admins_only')}</Tag>
				return (
					<Tag color="blue">
						{t('admin_apps.access_restricted', { groups: summary.groups, people: summary.people })}
					</Tag>
				)
			},
		},
```

- [ ] **Step 6: The translations**

`app_setting` in each locale:

| key | en | zh | ar |
| --- | --- | --- | --- |
| `section_access` | Access | 访问权限 | الوصول |
| `access` | Who can use this app | 谁可以使用此应用 | من يمكنه استخدام هذا التطبيق |
| `access_tooltip` | The owner and admins can always use every app | 所有者和管理员始终可以使用所有应用 | يمكن للمالك والمسؤولين دائمًا استخدام جميع التطبيقات |
| `access_everyone` | Everyone | 所有人 | الجميع |
| `access_restricted` | Selected groups and people | 指定的群组和人员 | مجموعات وأشخاص محددون |
| `access_groups` | Groups | 群组 | المجموعات |
| `access_groups_placeholder` | Choose groups | 选择群组 | اختر المجموعات |
| `access_people` | People | 人员 | الأشخاص |
| `access_people_placeholder` | Choose accounts | 选择账户 | اختر الحسابات |
| `access_admins_hint` | With no groups or people chosen, only the owner and admins can use the app. | 未选择任何群组或人员时，只有所有者和管理员可以使用此应用。 | إذا لم تُختر أي مجموعة أو شخص، فلن يستخدم التطبيق إلا المالك والمسؤولون. |

`admin_apps` in each locale:

| key | en | zh | ar |
| --- | --- | --- | --- |
| `column_access` | Access | 访问权限 | الوصول |
| `access_everyone` | Everyone | 所有人 | الجميع |
| `access_admins_only` | Admins only | 仅管理员 | المسؤولون فقط |
| `access_restricted` | Groups: {{groups}} · People: {{people}} | 群组：{{groups}} · 人员：{{people}} | المجموعات: {{groups}} · الأشخاص: {{people}} |

- [ ] **Step 7: The e2e cases**

In `e2e/admin-apps.spec.ts`, add a describe (owner storage state, as the file already uses):

```ts
import { deleteApp, deleteGroupsLike, seedApp, seedGroup } from './fixtures/access'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

test.describe('app access in the drawer (B3 spec §4.4)', () => {
	const tag = () => `appacc-${test.info().project.name}`
	let appId: string
	let userId: string

	test.beforeEach(async () => {
		userId = await seedUser({
			email: `${tag()}@e2e.local`,
			password: 'appacc-pass-1',
			name: 'App access user',
		})
		appId = await seedApp({ name: `Drawer ${tag()}`, accessMode: 'restricted' })
	})
	test.afterEach(async () => {
		await deleteApp(appId)
		await deleteGroupsLike(`%${tag()}`)
		await deleteUsersLike(`${tag()}%`)
	})

	test('a restricted app with no grant is tagged Admins only; granting a group opens it to its members', async ({
		page,
		browser,
	}) => {
		await seedGroup({ name: `Group ${tag()}`, memberIds: [userId] })
		await page.goto('/app-management')
		const row = page.getByRole('row', { name: new RegExp(`Drawer ${tag()}`) })
		await expect(row.getByText('Admins only')).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		await page.getByLabel('Groups').click()
		await page.getByTitle(`Group ${tag()}`, { exact: true }).click()
		await page.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('App configuration updated')).toBeVisible()
		await expect(row.getByText('Groups: 1 · People: 0')).toBeVisible()

		const member = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const memberPage = await member.newPage()
			await signInAs(memberPage, `${tag()}@e2e.local`, 'appacc-pass-1')
			await expect(memberPage.getByText(`Drawer ${tag()}`, { exact: true })).toBeVisible()
		} finally {
			await member.close()
		}

		await row.getByRole('button', { name: 'Edit' }).click()
		await page.getByRole('radio', { name: 'Everyone' }).check()
		await page.getByRole('button', { name: 'Update' }).click()
		await expect(row.getByText('Everyone', { exact: true })).toBeVisible()
	})

	test('a new app starts closed', async ({ page }) => {
		await page.goto('/app-management')
		await page.getByRole('button', { name: 'New' }).click()
		await expect(page.getByRole('radio', { name: 'Selected groups and people' })).toBeChecked()
		await page.getByRole('button', { name: 'Cancel' }).click()
	})
})
```

The edit reaches the stub's `/info` and `/site` through the seeded `api_base` (the stub's chat app), as the file's existing edit cases do.

- [ ] **Step 8: Run the specs and the gates**

```bash
pnpm exec vitest run __tests__/app-management-schemas.test.ts __tests__/data-apps.test.ts __tests__/data-apps-sync.test.ts __tests__/admin-app-row.test.ts __tests__/app-form-values.test.ts __tests__/app-management-actions.test.ts __tests__/app-management-page.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint "app/(admin)/app-management" lib/data/apps.ts components/admin/apps e2e/admin-apps.spec.ts __tests__/app-management-schemas.test.ts __tests__/data-apps.test.ts __tests__/admin-app-row.test.ts __tests__/app-form-values.test.ts __tests__/app-management-actions.test.ts __tests__/app-management-page.test.ts
pnpm exec oxfmt --write "app/(admin)/app-management" lib/data/apps.ts components/admin/apps e2e/admin-apps.spec.ts __tests__/app-management-schemas.test.ts __tests__/data-apps.test.ts __tests__/admin-app-row.test.ts __tests__/app-form-values.test.ts __tests__/app-management-actions.test.ts __tests__/app-management-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
npx -y @ant-design/cli lint ./
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test e2e/admin-apps.spec.ts e2e/app-access.spec.ts e2e/apps.spec.ts
```

Expected: all PASS on the three projects.

- [ ] **Step 9: Commit**

```bash
git add "app/(admin)/app-management" lib/data/apps.ts components/admin/apps e2e/admin-apps.spec.ts __tests__/app-management-schemas.test.ts __tests__/data-apps.test.ts __tests__/admin-app-row.test.ts __tests__/app-form-values.test.ts __tests__/app-management-actions.test.ts __tests__/app-management-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(apps): edit each app's access in the app drawer and tag it in the table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 7: Deactivation on the users page

Spec §5 ("Admin action", "What deactivation keeps", "Users page"). Review Focus 4 and 5 (the e2e half).

**Files:**

- Modify: `lib/data/users.ts`, `lib/action-result.ts`, `app/(admin)/user-management/actions.ts`, `components/admin/users/user-management.tsx`, `components/admin/users/user-errors.ts`, `locales/{en,zh,ar}/translation.json`, `__tests__/{data-users,user-management-actions,user-management-rank,user-errors,user-management-page}.test.ts`
- Create: `e2e/deactivation.spec.ts`

**Interfaces:**

- Consumes: `users.adminDeactivatedAt`, `users.adminDeactivatedBy` (Task 1); `isActive` (Task 2); `userGroupMembers`, `userGroups` (Task 1).
- Produces: `UserDto` gains `active: boolean`, `adminDeactivation: { at: string; by: string | null } | null`, `groups: { id: string; name: string }[]`; `toUserDto(row, groups?)`; `deactivateRefusal({ actor, target }): ActionErrorCode | null`; `setUserActive(actor, id, active: boolean): Promise<ActionResult>`; `lockTarget` also selects `adminDeactivatedAt`; `deactivateUserAction(id: string)`, `reactivateUserAction(id: string)`; `ActionErrorCode` gains `'cannot_deactivate_self'`.

- [ ] **Step 1: Write the failing tests**

In `__tests__/data-users.test.ts`:

- update the `toUserDto` case: the row gains `adminDeactivatedAt: null, adminDeactivatedBy: null, directoryDeactivatedAt: null`, and the expected DTO gains `active: true, adminDeactivation: null, groups: []`;
- add:

```ts
describe('toUserDto with markers and groups', () => {
	it('reports an admin deactivation with when and by whom, and the groups it was given', () => {
		const at = new Date('2026-10-09T09:05:00.000Z')
		expect(
			toUserDto(
				{
					id: 'u1',
					name: null,
					email: 'a@b.c',
					role: 'user',
					adminDeactivatedAt: at,
					adminDeactivatedBy: 'o1',
					directoryDeactivatedAt: null,
					createdAt: at,
					updatedAt: at,
				},
				[{ id: 'g1', name: 'Finance' }],
			),
		).toMatchObject({
			active: false,
			adminDeactivation: { at: '2026-10-09T09:05:00.000Z', by: 'o1' },
			groups: [{ id: 'g1', name: 'Finance' }],
		})
	})

	it('reads a directory deactivation as inactive without an admin record', () => {
		const at = new Date()
		expect(
			toUserDto({
				id: 'u1',
				name: null,
				email: 'a@b.c',
				role: 'user',
				adminDeactivatedAt: null,
				adminDeactivatedBy: null,
				directoryDeactivatedAt: at,
				createdAt: at,
				updatedAt: at,
			}),
		).toMatchObject({ active: false, adminDeactivation: null })
	})
})

// Review Focus 4: ADR-0024's rank applies to deactivation; nobody deactivates themselves or the owner.
describe('deactivateRefusal', () => {
	it.each([
		[owner, admin, null],
		[owner, user, null],
		[admin, user, null],
		[admin, otherAdmin, 'forbidden'],
		[admin, owner, 'forbidden'],
		[{ id: 'u8', role: 'user' }, user, 'forbidden'],
		[owner, owner, 'cannot_deactivate_self'],
		[admin, admin, 'cannot_deactivate_self'],
	] as const)('%o deactivating %o → %s', (actor, target, expected) => {
		expect(deactivateRefusal({ actor, target })).toBe(expected)
	})
})
```

Add `['setUserActive', () => setUserActive(member, 'u9', false)]` to the non-admin refusal table, and import `deactivateRefusal` and `setUserActive`.

In `__tests__/user-management-rank.test.ts`, widen the fake so it records what each update writes:

- in `vi.hoisted`, the target's type becomes `{ id: string; role: string; adminDeactivatedAt?: Date | null } | undefined`, and add `sets: [] as Record<string, unknown>[]`;
- the `@/db` fake's `update` becomes `update: () => ({ set: (values: Record<string, unknown>) => { sets.push(values); return { where: writes.update } } })`;
- `beforeEach` adds `sets.length = 0`.

Then add:

```ts
import { deactivateUserAction, reactivateUserAction } from '@/app/(admin)/user-management/actions'

describe('deactivation through the real session chain (Review Focus 4)', () => {
	it('an admin cannot deactivate the owner, another admin or itself', async () => {
		getServerSession.mockResolvedValue({ user: admin })
		target.value = { id: 'o1', role: 'owner', adminDeactivatedAt: null }
		expect(await deactivateUserAction('o1')).toEqual(forbidden)
		target.value = { id: 'a2', role: 'admin', adminDeactivatedAt: null }
		expect(await deactivateUserAction('a2')).toEqual(forbidden)
		target.value = { id: 'a1', role: 'admin', adminDeactivatedAt: null }
		expect(await deactivateUserAction('a1')).toEqual({ ok: false, code: 'cannot_deactivate_self' })
		expect(anyWrite()).toBe(false)
	})

	it('the owner deactivates an admin: one update that stamps the marker and bumps the session version', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: 'a2', role: 'admin', adminDeactivatedAt: null }
		expect(await deactivateUserAction('a2')).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
		expect(sets[0]).toMatchObject({
			adminDeactivatedAt: expect.any(Date),
			adminDeactivatedBy: 'o1',
		})
		expect(sets[0]).toHaveProperty('sessionVersion')
	})

	it('reactivation clears the admin marker only and leaves the session version alone', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: 'u9', role: 'user', adminDeactivatedAt: new Date() }
		expect(await reactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
		expect(sets).toEqual([{ adminDeactivatedAt: null, adminDeactivatedBy: null }])
	})

	// Deviation 6: idempotent.
	it('deactivating an account already deactivated writes nothing', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		target.value = { id: 'u9', role: 'user', adminDeactivatedAt: new Date() }
		expect(await deactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
		expect(await reactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
	})
})
```

In `__tests__/user-management-actions.test.ts` (it mocks the users DAL): add `setUserActive: vi.fn()` to the hoisted mocks and the `@/lib/data/users` mock and the `beforeEach` reset list; import `deactivateUserAction` and `reactivateUserAction`; add `['deactivateUserAction', () => deactivateUserAction('u9')]` and `['reactivateUserAction', () => reactivateUserAction('u9')]` to the table "refuses a user-role session and a missing one before the DAL" (and `setUserActive` to its not-called list); and add:

```ts
it('deactivates and reactivates through the DAL, and answers not_found for an id that cannot be one', async () => {
	setUserActive.mockResolvedValue({ ok: true, data: undefined })
	expect(await deactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
	expect(setUserActive).toHaveBeenLastCalledWith(admin, 'u9', false)
	expect(await reactivateUserAction('u9')).toEqual({ ok: true, data: undefined })
	expect(setUserActive).toHaveBeenLastCalledWith(admin, 'u9', true)
	expect(refresh).toHaveBeenCalledTimes(2)
	expect(await deactivateUserAction('x'.repeat(37))).toEqual({ ok: false, code: 'not_found' })
})
```

In `__tests__/user-errors.test.ts`, add `['cannot_deactivate_self', 'admin_users.cannot_deactivate_self']`.

In `__tests__/user-management-page.test.ts`, the fixture user gains `active: true, adminDeactivation: null, groups: []`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/data-users.test.ts __tests__/user-management-rank.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts` Expected: FAIL.

- [ ] **Step 3: The DAL**

In `lib/action-result.ts`, add `| 'cannot_deactivate_self'` after `'cannot_delete_self'`.

In `lib/data/users.ts`:

- imports: `asc, desc, eq, sql` from `drizzle-orm`; `passwordResetTokens, userGroupMembers, userGroups, users` from `@/db/schema`; `isActive` from `@/lib/auth/account-status`;
- the DTO and its columns:

```ts
export interface UserDto {
	id: string
	name: string | null
	email: string
	role: Role
	/** Both deactivation markers empty (ADR-0027). */
	active: boolean
	/** Set while an admin has deactivated the account: when, and that admin's id (null when the record names nobody). */
	adminDeactivation: { at: string; by: string | null } | null
	/** The groups it belongs to, by any source, each once. */
	groups: { id: string; name: string }[]
	createdAt: string
	updatedAt: string
}

/** The columns the DTO reads: never the hash or the session version. */
const dtoColumns = {
	id: users.id,
	name: users.name,
	email: users.email,
	role: users.role,
	adminDeactivatedAt: users.adminDeactivatedAt,
	adminDeactivatedBy: users.adminDeactivatedBy,
	directoryDeactivatedAt: users.directoryDeactivatedAt,
	createdAt: users.createdAt,
	updatedAt: users.updatedAt,
}

export const toUserDto = (
	row: Pick<
		UserRow,
		| 'id'
		| 'name'
		| 'email'
		| 'role'
		| 'adminDeactivatedAt'
		| 'adminDeactivatedBy'
		| 'directoryDeactivatedAt'
		| 'createdAt'
		| 'updatedAt'
	>,
	groups: { id: string; name: string }[] = [],
): UserDto => ({
	id: row.id,
	name: row.name,
	email: row.email,
	role: row.role,
	active: isActive(row),
	adminDeactivation: row.adminDeactivatedAt
		? { at: row.adminDeactivatedAt.toISOString(), by: row.adminDeactivatedBy }
		: null,
	groups,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})
```

- `lockTarget` selects `adminDeactivatedAt` too:

```ts
export const lockTarget = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: users.id, role: users.role, adminDeactivatedAt: users.adminDeactivatedAt })
		.from(users)
		.where(eq(users.id, id))
		.limit(1)
		.for('update')
```

- `listUsers` adds the groups:

```ts
export async function listUsers(actor: SessionUser): Promise<UserDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [rows, memberships] = await Promise.all([
		db.select(dtoColumns).from(users).orderBy(desc(users.createdAt)),
		// Distinct: a person in a group by hand and through the directory is listed once.
		db
			.selectDistinct({ userId: userGroupMembers.userId, id: userGroups.id, name: userGroups.name })
			.from(userGroupMembers)
			.innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId))
			.orderBy(asc(userGroups.name)),
	])
	return rows.map(row =>
		toUserDto(
			row,
			memberships
				.filter(membership => membership.userId === row.id)
				.map(membership => ({ id: membership.id, name: membership.name })),
		),
	)
}
```

- the rule and the write:

```ts
/** Who may deactivate or reactivate whom (ADR-0027 with ADR-0024's rank): nobody themselves, and only an account the actor's rank manages, never the owner. */
export const deactivateRefusal = ({
	actor,
	target,
}: {
	actor: { id: string; role: Role }
	target: { id: string; role: Role }
}): ActionErrorCode | null => {
	if (target.id === actor.id) return 'cannot_deactivate_self'
	return canManage(actor.role, target.role) ? null : 'forbidden'
}

/**
 * Deactivates or reactivates an account by the admin marker only (B3 spec §5). Deactivation stamps when and by whom
 * and bumps sessionVersion, so every token in use loses its id at its next request (ADR-0018's rule); reactivation
 * clears the marker and leaves those tokens revoked. The directory marker (B3b) is never touched here. The target is
 * read with a locking read and the rank checked against that row (ADR-0024 decision d). Idempotent (deviation 6).
 */
export async function setUserActive(
	actor: SessionUser,
	id: string,
	active: boolean,
): Promise<ActionResult> {
	assertAdmin(actor)
	return getDb().transaction(async tx => {
		const [target] = await lockTarget(tx, id)
		if (!target) return fail('not_found')
		const refusal = deactivateRefusal({ actor, target })
		if (refusal) return fail(refusal)
		const deactivatedByAdmin = target.adminDeactivatedAt !== null
		if (active !== deactivatedByAdmin) return ok(undefined)
		await tx
			.update(users)
			.set(
				active
					? { adminDeactivatedAt: null, adminDeactivatedBy: null }
					: {
							adminDeactivatedAt: new Date(),
							adminDeactivatedBy: actor.id,
							sessionVersion: sql`${users.sessionVersion} + 1`,
						},
			)
			.where(eq(users.id, id))
		return ok(undefined)
	})
}
```

The idempotence line reads: deactivating (`active` false) an account already deactivated by an admin (`deactivatedByAdmin` true) returns early, as does reactivating (`active` true) one that is not (`deactivatedByAdmin` false).

- [ ] **Step 4: The actions**

In `app/(admin)/user-management/actions.ts`, import `setUserActive` and add:

```ts
export async function deactivateUserAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const result = await setUserActive(actor, id, false)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'deactivateUserAction')
	}
}

export async function reactivateUserAction(id: string): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const result = await setUserActive(actor, id, true)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'reactivateUserAction')
	}
}
```

In `components/admin/users/user-errors.ts`, add `case 'cannot_deactivate_self': return 'admin_users.cannot_deactivate_self' as const`.

- [ ] **Step 5: The table**

In `components/admin/users/user-management.tsx`:

- import `CheckCircleOutlined`, `StopOutlined` and `Tooltip`; import `deactivateUserAction`, `reactivateUserAction`;
- a lookup for who deactivated: `const nameOf = (id: string | null) => { const found = users.find(user => user.id === id); return found ? found.name || found.email : null }`;
- two runners beside `remove`:

```tsx
const setActive = (user: UserDto, active: boolean) =>
	run(async () => {
		const result = active
			? await reactivateUserAction(user.id)
			: await deactivateUserAction(user.id)
		if (result.ok)
			message.success(
				t(active ? 'admin_users.reactivate_success' : 'admin_users.deactivate_success'),
			)
		else message.error(t(userErrorKey(result.code)))
	})
```

- the status column replaces the fixed "Active" tag:

```tsx
		{
			title: t('common.status'),
			key: 'status',
			render: (_, user) => {
				if (user.active) return <Tag color="green">{t('admin_users.status_active')}</Tag>
				const deactivation = user.adminDeactivation
				if (!deactivation) return <Tag color="red">{t('admin_users.status_deactivated')}</Tag>
				const by = nameOf(deactivation.by)
				return (
					<Tooltip
						title={
							<>
								<div>
									{by ? t('admin_users.deactivated_by', { name: by }) : t('admin_users.deactivated_by_unknown')}
								</div>
								<ClientDateTime value={deactivation.at} />
							</>
						}
					>
						<Tag color="red">{t('admin_users.status_deactivated')}</Tag>
					</Tooltip>
				)
			},
		},
```

- a groups column after the role column:

```tsx
		{
			title: t('admin_users.column_groups'),
			key: 'groups',
			render: (_, user) =>
				user.groups.length ? (
					<Flex
						wrap
						gap="small"
					>
						{user.groups.map(group => (
							<Tag key={group.id}>{group.name}</Tag>
						))}
					</Flex>
				) : null,
		},
```

- in the actions column, between Edit and Delete, when `canManage(currentUser.role, user.role)`:

```tsx
{
	canManage(currentUser.role, user.role) && user.active && (
		<Popconfirm
			title={t('admin_users.deactivate_confirm_title')}
			description={t('admin_users.deactivate_confirm_description')}
			okText={t('admin_users.deactivate')}
			okButtonProps={{ danger: true }}
			cancelText={t('common.cancel')}
			onConfirm={() => setActive(user, false)}
		>
			<Button
				type="text"
				danger
				icon={<StopOutlined />}
			>
				{t('admin_users.deactivate')}
			</Button>
		</Popconfirm>
	)
}
{
	canManage(currentUser.role, user.role) && user.adminDeactivation && (
		<Popconfirm
			title={t('admin_users.reactivate_confirm_title')}
			description={t('admin_users.reactivate_confirm_description')}
			okText={t('admin_users.reactivate')}
			cancelText={t('common.cancel')}
			onConfirm={() => setActive(user, true)}
		>
			<Button
				type="text"
				icon={<CheckCircleOutlined />}
			>
				{t('admin_users.reactivate')}
			</Button>
		</Popconfirm>
	)
}
```

- update the component comment: "the status column shows Active or Deactivated (ADR-0027) instead of the fixed tag".

- [ ] **Step 6: The translations**

`admin_users` in each locale:

| key | en | zh | ar |
| --- | --- | --- | --- |
| `column_groups` | Groups | 群组 | المجموعات |
| `deactivate` | Deactivate | 停用 | تعطيل |
| `reactivate` | Reactivate | 重新启用 | إعادة التفعيل |
| `deactivate_confirm_title` | Deactivate this account? | 停用这个账户吗？ | تعطيل هذا الحساب؟ |
| `deactivate_confirm_description` | They are signed out at once and cannot sign in until an admin reactivates the account. Their groups, apps and history are kept. | 该账户会立即退出登录，在管理员重新启用之前无法登录。其群组、应用和历史记录都会保留。 | سيُسجَّل خروجه فورًا ولن يتمكن من تسجيل الدخول حتى يعيد مسؤول تفعيل الحساب. تبقى مجموعاته وتطبيقاته وسجله محفوظة. |
| `deactivate_success` | Account deactivated | 账户已停用 | تم تعطيل الحساب |
| `reactivate_confirm_title` | Reactivate this account? | 重新启用这个账户吗？ | إعادة تفعيل هذا الحساب؟ |
| `reactivate_confirm_description` | They can sign in again. Sessions from before the deactivation stay signed out. | 该账户可以再次登录。停用前的会话仍保持退出状态。 | سيتمكن من تسجيل الدخول مجددًا. تبقى الجلسات السابقة للتعطيل منتهية. |
| `reactivate_success` | Account reactivated | 账户已重新启用 | تمت إعادة تفعيل الحساب |
| `cannot_deactivate_self` | You cannot deactivate your own account | 你不能停用自己的账户 | لا يمكنك تعطيل حسابك |
| `deactivated_by` | Deactivated by {{name}} | 由 {{name}} 停用 | عطّله {{name}} |
| `deactivated_by_unknown` | Deactivated by an account that no longer exists | 由一个已不存在的账户停用 | عطّله حساب لم يعد موجودًا |

`admin_users.status_active` stays. The table no longer uses any other key; keep the parity test green.

- [ ] **Step 7: The e2e spec**

Create `e2e/deactivation.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'deact-pass-1'
const tag = () => `deact-${test.info().project.name}`
const email = () => `${tag()}@e2e.local`

test.use({ storageState: ADMIN_STATE })

// Review Focus 5: an open session ends at its next request, sign-in answers like a wrong password, and
// reactivation lets the account sign in again (old tokens stay revoked).
test.describe('deactivation (B3 spec §5)', () => {
	test.beforeEach(async () => {
		await seedUser({ email: email(), password: PASSWORD, name: 'Deactivated user' })
	})
	test.afterEach(async () => {
		await deleteUsersLike(`${tag()}%`)
	})

	test('signs a user out, blocks sign-in until reactivation, then lets it back in', async ({
		page,
		browser,
	}) => {
		const userContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const userPage = await userContext.newPage()
			await signInAs(userPage, email(), PASSWORD)

			await page.goto('/user-management')
			await page.getByPlaceholder('Search users').fill(email())
			const row = page.getByRole('row', { name: new RegExp(email()) })
			await row.getByRole('button', { name: 'Deactivate' }).click()
			await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click()
			await expect(page.getByText('Account deactivated')).toBeVisible()
			await expect(row.getByText('Deactivated', { exact: true })).toBeVisible()

			await userPage.goto('/apps')
			await expect(userPage).toHaveURL(/\/login/)
			await userPage.getByLabel('Email').fill(email())
			await userPage.getByLabel('Password').fill(PASSWORD)
			await userPage.getByRole('button', { name: 'Log in' }).click()
			await expect(userPage.getByText('Login failed. Check your email and password.')).toBeVisible()

			await row.getByRole('button', { name: 'Reactivate' }).click()
			await page.getByRole('button', { name: 'Reactivate', exact: true }).last().click()
			await expect(page.getByText('Account reactivated')).toBeVisible()
			await expect(row.getByText('Active', { exact: true })).toBeVisible()
			await signInAs(userPage, email(), PASSWORD)
		} finally {
			await userContext.close()
		}
	})

	test('offers no Deactivate on the owner’s own row', async ({ page }) => {
		await page.goto('/user-management')
		const own = page.getByRole('row', { name: /E2E Owner/ })
		await expect(own.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
	})
})
```

- [ ] **Step 8: Run the specs and the gates**

```bash
pnpm exec vitest run __tests__/data-users.test.ts __tests__/data-users-writes.test.ts __tests__/data-users-password.test.ts __tests__/user-management-rank.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/users.ts lib/action-result.ts "app/(admin)/user-management/actions.ts" components/admin/users e2e/deactivation.spec.ts __tests__/data-users.test.ts __tests__/user-management-rank.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts
pnpm exec oxfmt --write lib/data/users.ts lib/action-result.ts "app/(admin)/user-management/actions.ts" components/admin/users e2e/deactivation.spec.ts __tests__/data-users.test.ts __tests__/user-management-rank.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
npx -y @ant-design/cli lint ./
pnpm test
docker compose -f docker-compose.e2e.yml down
pnpm exec playwright test e2e/deactivation.spec.ts e2e/admin-users.spec.ts e2e/roles.spec.ts e2e/account.spec.ts
```

Expected: all PASS on the three projects.

- [ ] **Step 9: Commit**

```bash
git add lib/data/users.ts lib/action-result.ts "app/(admin)/user-management/actions.ts" components/admin/users e2e/deactivation.spec.ts __tests__/data-users.test.ts __tests__/user-management-rank.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json
git commit -m "feat(users): deactivate and reactivate accounts, and show their status and groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 8: Records — ADR-0027, the notes, `docs/auth-gate.md`, `CLAUDE.md`, CII

Spec §10, §12. ADR-0015 (decisions in ADRs, `CLAUDE.md` under 200 lines).

**Files:**

- Create: `docs/decisions/0027-gate-apps-by-groups-and-grants-and-deactivate-accounts.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/0004-keep-mysql-through-drizzle.md`, `docs/decisions/0018-gate-route-groups-on-the-server.md`, `docs/decisions/0024-…md`, `docs/auth-gate.md`, `CLAUDE.md`, `.cii-assessment.md`

- [ ] **Step 1: ADR-0027**

Create it with the project's adr-skill (`.claude/skills/adr-skill`; the README's workflow: run the scripts from a temporary copy with `scripts/*.js` renamed to `.cjs`) as `proposed`, titled "Gate apps by groups and grants, and deactivate accounts with two markers", with `--update-index`. Fill it in MADR 4.0 form:

- **Context and Problem Statement:** the charter's B3 row; every signed-in account saw every app; LDAP accounts (B3b) need groups and an off switch; the owner's decisions of 2026-10-09 (spec §2 #1–#3, #8, #9, #12).
- **Decision Drivers:** deny by default (OWASP Authorization "Deny by Default"); one rule for the list and every object (OWASP "Validate the Permissions on Every Request"; Next `data-security.md`: the DAL performs authorization checks); no history lost on deactivation (ADR-0026); B3b's sync must change only what it owns; documented approaches only (ADR-0002).
- **Considered Options** (with the research's citations, `docs/superpowers/research/2026-10-09-backend-b3/groups-and-access.md`): grants as typed tables with foreign keys (chosen; Metabase's FK cascade) / one polymorphic grant table (LibreChat `AclEntry`, Grafana managed roles: orphans cleaned in code) / a JSON column on the app (Open WebUI until 2026-02, which then moved to a grant table); "everyone" as a mode on the app (chosen; Dify Enterprise `private_all`) / a wildcard principal (Open WebUI `user:*`, LibreChat `PUBLIC`) / a built-in group (Metabase "All Users"); admin bypass (chosen; Grafana, Metabase, LibreChat, Open WebUI's flag on by default) / no bypass (Dify Enterprise); deactivation as two independent markers (chosen) / one status column with transitions (GitLab `blocked` and `ldap_blocked`, `gitlabhq@0739b8bf:app/models/user.rb:616-640`); memberships with a source in the key (chosen; Grafana's `external` flag keeps manual members, "it will not be removed when the user signs in") / directory-only groups.
- **Decision Outcome:** the data model of spec §3.1 as built (Task 1), the rule `visibleTo` (Task 3), the groups page (Tasks 4–5), the app drawer's access (Task 6), deactivation (Tasks 2 and 7), plan deviations 1–6 and decisions a–e, each with its source.
- **Consequences:** Good: a new app cannot leak; deleting an app, group or account removes its grants by construction; a demoted admin's access follows its groups at once; deactivation keeps `users.id` and Dify history. Bad: one more query shape on every app read (two `EXISTS` on primary-key-indexed tables); the first foreign keys need matching collations on an upgraded database (Task 9 checked the local volume); drizzle-kit's single-table cascade defect must be watched in every later migration that creates a table with foreign keys. Neutral: grants are visibility only, one level (Dify's web-app model); admins edit grants on the app, not on the group.
- **Implementation Plan:** affected paths (this plan's file structure), patterns to follow (every new app read applies `visibleTo`; a new admin action calls `requireAdmin()` and its DAL `assertAdmin`; a new membership writer changes only its own `source`; a migration that creates one table with foreign keys is checked for `ON DELETE CASCADE`), patterns to avoid (reading `dify_apps` for a user without `visibleTo`; deleting an account to block it; an admin action writing the directory marker).
- **Verification:** the vitest files and e2e specs of Tasks 1–7 by name, the migration on the copy of the local database (Task 9), the owner's browser check (unchecked until done).
- **More Information:** spec and research paths; follow-ups (spec §12).

- [ ] **Step 2: The notes on earlier ADRs**

Append a dated note under "More Information" in each (the README's rule: accepted ADRs change only by a status change or a dated note):

- `0024-…md`: "Note, 2026-10-09 (ADR-0027): the rank map also decides who may deactivate and reactivate whom (`deactivateRefusal` in `lib/data/users.ts`: the owner deactivates admins and users, an admin users, nobody themselves or the owner), and `lockTarget` also reads the admin deactivation marker. The groups DAL (`lib/data/groups.ts`) follows this record's DAL pattern; membership grants no right, so the rank map does not apply to it. B3b will add `lib/data/directory.ts` as the second DAL module without an actor (spec §6.1)."
- `0018-…md`: "Note, 2026-10-09 (ADR-0027): deactivation revokes like a password change. Deactivating an account bumps `sessionVersion`, and the `jwt` callback also strips a token whose row is deactivated (`isActive` in `lib/auth/account-status.ts`), so the gates here turn the account away at its next request; reactivation does not revive old tokens."
- `0004-keep-mysql-through-drizzle.md`: "Note, 2026-10-09: the owner wants to move this line to PostgreSQL after backend rework B3 or after frontend phase 2 (their other projects and Dify on the production server run PostgreSQL). That move gets its own ADR superseding this one. This record's main reason, cheap upstream merges, fell away with ADR-0022. B3 keeps to features both engines have (foreign keys with cascade, `CHECK`, composite primary keys, enums, a unique index that allows several `NULL`s)."

- [ ] **Step 3: `docs/auth-gate.md`**

- In the opening paragraph, after the admin-rights sentence: "A deactivated account (an admin's marker, or from B3b the directory's) has no session: sign-in refuses it after the password check with the same message as a wrong password, and the `jwt` callback strips its token (ADR-0027)."
- In "Where it lives", the `lib/auth/options.ts` bullet gains: "`authorizeCredentials` refuses an inactive account after the password (`isActive`, `lib/auth/account-status.ts`) and logs `account_inactive` with the account id; the `jwt` callback strips the token of an inactive row."
- A new bullet after the Data Access Layer bullet: "Per-app access (ADR-0027): every app read in `lib/data/apps.ts` applies `visibleTo(actor)`; an account with admin rights sees every app, a `user` an app open to everyone, granted to it, or granted to one of its groups. An app it may not use is answered as a missing one (the Dify routes `404 app_not_found`, the chat page "unavailable", the icon route 404). Groups: `lib/data/groups.ts` and `/group-management`."
- "Known limits": "B3 brings groups, per-app access and LDAP." becomes "B3b brings directory (LDAP) sign-in and the scheduled sync; a directory account's deactivation marker is written by it." Add: "A deactivated account keeps its open tab until its next request, which is refused; a Dify stream already running finishes."

- [ ] **Step 4: `CLAUDE.md`**

- Decisions list: after ADR-0026, "- ADR-0027 Per-app access by groups and grants: `dify_apps.access_mode` (`everyone`/`restricted`, new apps closed, existing apps opened by the migration), typed grant tables with foreign keys (the first on this line), admins see every app, one rule `visibleTo` in the apps DAL for the list and every single-app read; groups with memberships keyed by source (`manual`, `directory` for B3b); deactivation as two markers (admin, directory), revoking sessions; proposed in B3a's PR."
- "Where things are", the backend bullet gains `lib/app-access.ts`, `lib/auth/account-status.ts`, `lib/data/{groups,db-errors}.ts`, `app/(admin)/group-management/{page,actions,schemas}.ts(x)`, `components/admin/groups/`, `components/admin/account-option.ts`, `e2e/fixtures/access.ts`.
- "Next step": B3b (`feat/backend-b3b-directory`, from `fork/overhaul` after B3a merges), spec `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md` §6–§8, research `docs/superpowers/research/2026-10-09-backend-b3/`; B3a plan `docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md`.
- "Open follow-ups", new items: sign-in throttling, designed with Active Directory's lockout in mind; an admin "Logs" tab (owner, 2026-10-09: the hub's logs with filters, instead of reading container logs); the PostgreSQL move after B3 or frontend phase 2 (ADR-0004 note); `.dockerignore`'s `!**/.env.example` exception lets `.env.example` files from git-ignored folders such as `tmp/` into the image; "switch to directory sign-in" for local accounts (B3 spec §12).
- Keep the file under 200 lines (`wc -l CLAUDE.md`); shorten wording, not facts.

- [ ] **Step 5: Check and commit the records**

```bash
pnpm exec oxfmt --write docs/decisions/0027-*.md docs/decisions/README.md docs/decisions/0004-*.md docs/decisions/0018-*.md docs/decisions/0024-*.md docs/auth-gate.md CLAUDE.md
wc -l CLAUDE.md
git add docs/decisions/0027-*.md docs/decisions/README.md docs/decisions/0004-*.md docs/decisions/0018-*.md docs/decisions/0024-*.md docs/auth-gate.md CLAUDE.md
git commit -m "docs: record ADR-0027 and the B3a notes, auth gate and CLAUDE.md pointers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

- [ ] **Step 6: The CII assessment (its own commit)**

Re-check `.cii-assessment.md` per AGENTS.md: #19 (the vitest count and file count from `pnpm test`'s summary), #20 (the Playwright spec file count, `ls e2e/*.spec.ts | wc -l`), #25 and #26 (per-app authorization in the DAL; the group and deactivation actions validate with zod), and the change log line. If anything changed:

```bash
git add .cii-assessment.md
git commit -m "docs: update CII assessment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 9: Whole-branch review, the gates and the PR text (controller)

Spec §8 ("Gates", "Migrations"), §9 (B3a "done when").

- [ ] **Step 1: Whole-branch review (Opus)**

Dispatch one reviewer (superpowers:requesting-code-review, `model: opus`) on `fork/overhaul..HEAD` with the spec's B3a sections, this plan, the Review Focus and the reviewer contract. The review checks: every Review Focus line against its tests; that every app read reachable by a `user` applies `visibleTo` (`git grep -n "from(difyApps)" -- lib app` and each hit's condition); that no DTO carries the hash, `sessionVersion`, an API key, or (the gallery's) grant lists; that every admin action calls `requireAdmin()` and its DAL `assertAdmin`; that the deactivation write locks its target and bumps `sessionVersion`; the migration SQL by hand (six `ON DELETE CASCADE`, the backfill); no log line can carry a password, a hash or an email; `git grep -n "process.env" -- lib app components hooks` (only `lib/env.ts`); no Chinese character in the touched files outside `locales/zh` (`git diff --name-only fork/overhaul..HEAD | grep -v '^locales/zh/' | xargs grep -nP '\p{Han}'`); oxlint over every changed file.

- [ ] **Step 2: One fix wave, one scoped re-review**

One Opus implementer applies every finding the controller accepts (rule R0), with sources; one Sonnet re-review checks exactly those fixes.

- [ ] **Step 3: The full e2e suite from empty**

```bash
docker compose -f docker-compose.e2e.yml down
pnpm test:e2e
```

Expected: every spec passes on the three projects; the setup annotation says `owner created through /init`. Report the counts. Stop `pnpm dev` first if it runs.

- [ ] **Step 4: The migration on a copy of the local database, with the collation check**

The dump holds password hashes and API keys: it stays in `tmp/`, is never printed, and is deleted at the end of this step. The container's own environment supplies the credentials.

```bash
docker compose -f docker-compose.local.yml exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > tmp/b3a-local.sql
docker compose -f docker-compose.e2e.yml up -d --wait
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e -e "DROP DATABASE IF EXISTS b3acopy; CREATE DATABASE b3acopy; GRANT ALL ON b3acopy.* TO 'e2e'@'%';"
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b3acopy < tmp/b3a-local.sql
# Foreign keys need the same charset and collation on both sides (MySQL 8.4 "FOREIGN KEY Constraints").
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b3acopy -e "SELECT TABLE_NAME, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'b3acopy' AND COLUMN_NAME = 'id' AND TABLE_NAME IN ('users', 'dify_apps'); SELECT @@collation_database; SELECT COUNT(*) AS apps_before FROM dify_apps;"
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/b3acopy pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b3acopy -e "SELECT access_mode, COUNT(*) FROM dify_apps GROUP BY access_mode; SELECT COUNT(*) AS inactive FROM users WHERE admin_deactivated_at IS NOT NULL OR directory_deactivated_at IS NOT NULL; SELECT COUNT(*) AS fks FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'b3acopy' AND DELETE_RULE = 'CASCADE';"
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e -e "DROP DATABASE b3acopy;"
rm tmp/b3a-local.sql
# Free the memory before the Docker build (~5 GB machine).
docker compose -f docker-compose.e2e.yml down
```

Expected: `users.id` and `dify_apps.id` share the database's collation (if they differ, stop: the foreign keys would fail on this volume; report it to the owner before the Docker gate); every app is `everyone` and their count equals `apps_before`; `inactive` is 0; `fks` is 6.

- [ ] **Step 5: The Docker gate**

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml build app
docker compose -f docker-compose.local.yml up -d app
```

Build in the foreground; never restart a build killed for memory. Then the curl checks of `CLAUDE.md` ("Docker stack"), plus:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:5300/group-management                     # 307 …/login?callbackUrl=%2Fgroup-management
docker compose -f docker-compose.local.yml exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SELECT access_mode, COUNT(*) FROM dify_apps GROUP BY access_mode"'
docker stats --no-stream
```

Expected: as commented; the real volume's apps are all `everyone` (the entrypoint applied both migrations).

- [ ] **Step 6: The PR text, then stop**

- Write the PR text to `tmp/b3a-pr.md`, following `.github/PULL_REQUEST_TEMPLATE.md`: Overview (B3a of the B3 spec; ADR-0027); a Changes table by task; Testing (the vitest count, the e2e counts, the migration copy with the collation check, the Docker gate); Related Issue (none; implements ADR-0027 and the spec's B3a row); the PR attribution lines.
- Ask the owner whether the run's `ledger.md` and `rulings.md` go under `docs/superpowers/research/2026-10-09-backend-b3/b3a-execution/`.
- Present the merge options (superpowers:finishing-a-development-branch).
- **Stop.** No push and no PR without the owner's word. The owner's browser check comes next: a `user` account sees only granted apps (directly, through a group, everyone) and gets "unavailable" on a bookmarked ungranted app; with every app restricted and nothing granted, it sees the empty gallery's text; the groups page (add, members, rename, delete); the app drawer's Access section and the table tag; a new app starts closed; deactivate a signed-in user in another browser, whose next page lands on `/login` and whose sign-in shows the generic message; reactivate; the owner's row has no Deactivate.
