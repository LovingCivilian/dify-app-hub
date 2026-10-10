# Backend rework B3b — directory (LDAP) sign-in and sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People in the company directory sign in on the login page's "Directory account" tab with their directory username and password. Their hub account is created at the first sign-in and linked to the entry by its `objectGUID` (or `entryUUID`), never by email. A scheduled and an on-demand sync deactivate and reactivate directory accounts and keep the directory memberships of hub groups linked to directory groups, with safety stops that change nothing when the directory's answer cannot be trusted. Active Directory works with the defaults; any LDAPv3 server works through the `LDAP_*` settings.

**Architecture:** ldapts 9.2.0 talks to the directory from server-only modules in `lib/directory/`: pure helpers (keys, escaped filters, entries), a fresh single-connection client per sign-in and per sync, the sign-in check (search, then bind), the sync (a pure plan, then the writes), and the schedule. `lib/data/directory.ts` is the second actor-less Data Access Layer module (after `lib/data/setup.ts`): it writes only what the directory owns, the directory deactivation marker, the directory fields of `ldap` accounts and `directory` memberships (ADR-0027). A second next-auth Credentials provider, `ldap`, beside the local one, refuses every account-related failure with the generic `CredentialsSignin` and throws `DirectoryUnavailable` only when the directory does not answer. croner runs the sync from `instrumentation.ts` `register()`, and each run claims a unique slot in `directory_sync_runs`, so several containers run each slot once. Admins link hub groups to directory groups on the groups page and see the sync's status, with Sync now, on the users page.

**Tech Stack:** Next 16.3.4 (`instrumentation.ts`, Server Actions, `refresh`, `server-only`), next-auth 4.24.15 (two Credentials providers), ldapts 9.2.0, croner 10.0.1, Drizzle ORM 1.0.0-rc.3 on MySQL 8.4 (`check`, `mysqlEnum`, `.for('update')`), zod 4, React 19.2, antd 6.6.5, vitest 4 (two projects: `unit`, `ldap`), Playwright 1.63, and two throwaway LDAP servers in `docker-compose.e2e.yml` (Samba's `smblds` for Active Directory behaviour, OpenLDAP 2.6 for the generic case).

**Spec:** `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`. Read §2 (the owner's 18 decisions, not re-opened), §3.2 (the B3b data model), §6 (directory accounts), §7 (settings, security, messages), §8 (B3b tests), §9 (the B3b row and its "done when"), §10 (records), §12–§14 (follow-ups, risks, not confirmed) first; every task cites its sections. The research behind it is `docs/superpowers/research/2026-10-09-backend-b3/` (start at its README); this plan's own research, checked against the current docs and sources on 2026-10-10, is in its `b3b-plan/` folder: `library-apis.md` (ldapts, croner, Vitest, Drizzle and MySQL, Next instrumentation, next-auth, zod), `ldap-test-servers.md` (the two test servers, their certificates, seeds and health checks) and `ad-and-reference-projects.md` (Active Directory's signing and channel binding, Docker on WSL, and the reference projects behind the decisions below). B3a's records are the patterns: ADR-0027 (the data model as built, `visibleTo`, the two markers, the B3b notes), the B3a plan `docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md` (task and test style) and its run records `docs/superpowers/research/2026-10-09-backend-b3/b3a-execution/`.

**Deviations from the spec text, all deliberate (Task 15 records them in ADR-0029):**

1. **The record is ADR-0029**, not ADR-0028 (spec §10): the sidebar took 0028 (ADR-0027's B3b notes).
2. **The run table's trigger column is `run_trigger`**, since `TRIGGER` is reserved in MySQL 8.4 and spec §3 asks that names avoid reserved words; the table also counts `group_errors` (spec §6.4 step 4 "count the error"). Task 1.
3. **A key is binary when the id attribute is `objectGUID`** (decision m), where spec §6.3 step 6 reads binary-ness from the value's length; the sync then knows how to rebuild a key's bytes for a lookup (spec §6.4 step 4). The results are the same for `objectGUID` and `entryUUID`. Task 5.
4. **`servername` is set only for a host name** (decision r), not for an IP address (spec §6.2 lists it among the TLS options): Node refuses an IP address there ("must be a host name, and not an IP address"; DEP0123) and checks the certificate against the host either way. Task 6.
5. **The `empty` safety stop is proven by `pnpm test:ldap` and the unit tests, not by Playwright** (spec §8 lists it under Playwright): the e2e app's settings are fixed for a run (ADR-0010: no test switches in product code), so no spec can point it at an empty base. Tasks 10 and 14.
6. **A directory that refuses the connection answers `DirectoryUnavailable`** (decision u): a refused service bind or StartTLS, and `strongerAuthRequired` (8) or `confidentialityRequired` (13) on the person's bind, besides spec §7.3's connection, timeout and TLS failures; a domain controller that enforces LDAP signing would otherwise tell every person to check their password. Tasks 6 and 7.
7. **No run starts while another is going, whatever its trigger** (decision ag; spec §6.4 names the check for manual runs). Task 10.
8. **The directory tab's failure text names the username** (`auth.directory_login_failed`, the spec's "Check your username and password"); the local tab keeps its "Check your email and password" (`auth.login_failed`), where spec §7.3 names one key for both (decision z). Task 8.

Every other choice the spec leaves open is a decision, lettered a–aq in the tasks that make them, each with its documented source and, where the docs are silent, two or three reference projects (rule R0).

## Global Constraints

- **Documented approaches only (ADR-0002, rule R0 of the run).** Name the source of every non-obvious API decision in the task report, and take a documented route whenever a reviewer names one. Sources:
  - Next's bundled docs `node_modules/next/dist/docs/01-app/`: `02-guides/instrumentation.md`, `03-api-reference/03-file-conventions/instrumentation.md`, `02-guides/self-hosting.md`, `02-guides/server-actions.md`, `02-guides/data-security.md`, `02-guides/authentication.md`, `03-api-reference/04-functions/refresh.md`;
  - next-auth v4: Context7 `/websites/next-auth_js` (Credentials provider, "Multiple providers", callbacks) and the installed `node_modules/next-auth` (`core/routes/callback.js`, `core/lib/providers.js`, `react/index.js`);
  - ldapts 9.2.0: its README and `dist/index.d.mts` (Context7 `/ldapts/ldapts`; the research pins `ldapts/ldapts@b38cfc3`);
  - croner 10.0.1: its README and `dist/croner.d.ts` (Context7 `/hexagon/croner`; `hexagon/croner@adc86215`);
  - Drizzle: Context7 `/drizzle-team/drizzle-orm-docs` and the installed `node_modules/drizzle-orm/mysql-core` (`check`, `mysqlEnum`, `uniqueIndex`, `getTableConfig`, `.for('update')`, `transaction`, `drizzle.mock()`);
  - zod 4 and Vitest 4: Context7 (`/colinhacks/zod/v4.6.5`, `/vitest-dev/vitest/v4.1.6`: "Test Projects", `globalSetup`, the CLI's `--project`);
  - antd: the antd CLI (`npx -y @ant-design/cli info|demo|doc Tabs|Select|Descriptions|Card|Tag|Form --version 6.6.5`, `.claude/skills/antd`);
  - the LDAP standards: RFC 4511 (protocol), RFC 4512 §1.4 and §2.5 (attribute names), RFC 4513 §5.1.2–§5.1.3 and §6.3.1 (empty passwords, simple binds), RFC 4514 (DNs), RFC 4515 §3 (filter escaping), RFC 4530 (entryUUID), RFC 9562 §4 (UUID text);
  - Microsoft Learn and the open specifications for Active Directory (MS-ADTS 3.1.1.3.4.4 and 5.1.1.1.1, MS-DTYP 2.3.4.2, ADSI "Search Filter Syntax", "LDAP signing for Active Directory Domain Services"); the OpenLDAP 2.6 Administrator's Guide and man pages; Samba's smb.conf(5) and samba-tool(8);
  - the MySQL 8.4 Reference Manual ("CHECK Constraints", "Locking Reads", "How to Minimize and Handle Deadlocks", "CREATE INDEX", the error reference: 1062, 1213, 1452, 3819);
  - the OWASP Cheat Sheet Series (Authentication "Authentication Responses", LDAP Injection Prevention, Logging "Data to exclude", Authorization).

  For a choice the docs leave open, cite two or three well-known projects on the same stack beside the docs: `docs/superpowers/research/2026-10-09-backend-b3/` and its `b3b-plan/` folder already pin LibreChat, Open WebUI, Rocket.Chat, GitLab, Mattermost, Grafana, Keycloak, Nextcloud, n8n, Backstage, Authelia, Homarr, Formbricks, Rallly, Documenso, Directus, python-ldap, os2mo and authentik. No private imports, no `@ts-nocheck`, and a `@ts-expect-error` only with its reason on the line.

- **Versions:** `next` 16.3.4, `next-auth` 4.24, `drizzle-orm` and `drizzle-kit` 1.0.0-rc.3, `zod` ^4, `react` 19.2, `antd` 6.6.5; added: `ldapts` 9.2.0 and `croner` 10.0.1, pinned exactly (decision a). Nothing else is added.
- **The directory's security rules (spec §7.2).** `users.id` stays the Dify end user (ADR-0026). A directory account is linked by `users.directory_id` only, never by email, DN, UPN or login name, and no directory sign-in links or takes over another account. An empty password never reaches a bind; every value a person types or the directory supplies reaches a filter only through `lib/directory/filters.ts` (ldapts' `Filter.escape`); exactly one entry may match a login. Every TLS certificate is verified, TLS options never go to the constructor for an `ldap://` URL, and a client makes one connection (decision p). The service account is read-only and its password lives in `.env` only.
- **The directory writes only what it owns (ADR-0027).** `directory_deactivated_at` (with a `sessionVersion` bump), the directory fields of `ldap` accounts (name, email, `directory_username`), `directory` memberships, and the links' names and `missing_since`; never the admin marker, a role, a password or a `manual` membership.
- **Two vocabularies (charter §4.5).** Actions answer `ActionResult` with the codes in `lib/action-result.ts` (B3b adds `directory_unavailable` and `sync_running`); a sign-in answers next-auth's `CredentialsSignin`, or the thrown codes `DirectoryUnavailable` and `Default`. Expected failures never throw out of an action; an unexpected throw becomes `operation_failed` through `toActionFailure`.
- **Logs (spec §7.3; OWASP Logging "Data to exclude").** One line per refused sign-in with a fixed reason and, for the directory, the username; one summary line per sync with the outcome, a fixed error code and the counts. Never a password, the bind password, a hash, an email, a directory message or a filter carrying a person's input; directory errors reach the log through `lib/error-log.ts` as their class name and LDAP result code.
- **Server-only code** imports `server-only`; every module under `lib/directory/` does. Client components import only the client-safe vocabularies (`lib/directory-status.ts`, `lib/auth/account-source.ts`) and types. `process.env` is read only in `lib/env.ts` (plus `drizzle.config.ts`, `db/migrate.ts`, and `NEXT_RUNTIME` in `instrumentation.ts`, as Next's guide shows). DTOs never carry a password hash, `sessionVersion`, an API key, the bind password or a directory key the screen does not need.
- **Database (ADR-0004, AGENTS.md).** Schema changes go through `db/schema/*.ts`, `pnpm db:generate --name <name>` and a hand review of the SQL; never `drizzle-kit push`. Every generated `migration.sql` with a foreign key is checked for `ON DELETE CASCADE` (the drizzle-kit rc.3 single-table defect, spec §3.2). The `users_source_credentials` CHECK must hold for every row. The e2e harness applies migrations itself (`e2e/global-setup.ts`); the e2e database is `mysql://e2e:e2e@127.0.0.1:3307/e2e`, reset with `docker compose -f docker-compose.e2e.yml down`.
- **Language.** No Chinese string remains in the files a task touches; logs are English; nothing user-facing is a server message, only a code the client translates. New UI text goes through i18next keys present in `locales/en`, `locales/zh` and `locales/ar` (`pnpm test` checks parity; `types/i18next.d.ts` types the keys from `en`). Never run `i18next-cli extract/sync`. Arabic is Modern Standard Arabic with the file's Western digits and terms ("مسؤول", "مستخدم", "المالك", "الدليل" for the directory); Chinese uses the file's terms ("管理员", "普通用户", "所有者", "目录") and its informal "你". A key with no remaining reader is removed from all three files.
- **Frontend rules (`.claude/rules/frontend.md`, `docs/frontend-conventions.md`).** antd components first, checked with the antd CLI; token-only CSS Modules or token-valued inline styles as the existing forms use; `App.useApp()` for messages. A form calls its action from `onFinish` through `useActionTransition`; a Form inside a `destroyOnHidden` Drawer owns its instance, keyed by what it edits; the submit button in `extra` uses `htmlType="submit" form={<id>}`. `npx -y @ant-design/cli lint ./` stays at zero findings.
- **Unit tests.** vitest (node, no DOM) in `__tests__/`; mock with `vi.hoisted` + `vi.mock`. Every test of a session-bearing action mocks `next-auth/next`'s `getServerSession` and `@/lib/auth/options`, and keeps `lib/auth/session` real (ADR-0024 deviation 3). DAL rules are pure functions tested without a database; a SQL shape is rendered on `drizzle.mock()`. `pnpm test` is the `unit` project; files named `*.ldap.test.ts` live in `__tests__/ldap/` and run only in `pnpm test:ldap` (decision j), which starts and stops the two test directories itself.
- **e2e (ADR-0010).** Web-first assertions; role, label and name locators; never `networkidle`. Every row a spec creates carries the project name where it can, and is deleted in `afterEach` or `finally`; directory accounts come from the smblds seed, carry its emails, and are deleted by email. The login page shows its two tabs in every spec (decision aa): local sign-ins go through `signInAs` or `chooseLocalAccount`, directory sign-ins through `signInWithDirectory`. A spec that changes the directory (`samba(['user', 'disable', …])`) restores it in `afterEach`. Run a task's specs with `pnpm exec playwright test e2e/<file>.spec.ts …`, with `pnpm dev` stopped (one `next dev` per checkout). The full suite runs once, in Task 16, from a fresh e2e database.
- **Before every commit:** `pnpm exec next typegen && pnpm exec tsc --noEmit`; `pnpm exec oxlint <changed files>`; `pnpm exec oxfmt --write <changed files>`, then `--check`; `pnpm test`; and `pnpm test:ldap` when the task changes `lib/directory/` code that talks to the directory or a `*.ldap.test.ts`. The pre-commit hook (lint-staged) reformats staged Markdown, JSON and YAML.
- **Commits.** Conventional (`feat|fix|test|docs|chore(scope): …`), in English. `git add <paths>`, never `-A`; `git rm`/`git mv` for removals and moves. Before each commit, `git status --short` shows nothing unstaged that belongs to the task. Both trailer lines go in ONE `-m` argument, after a blank line:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn
  ```

  `.cii-assessment.md` goes in its own `docs: update CII assessment` commit (AGENTS.md). No push and no PR without the owner's word.

- **This machine (~5 GB of memory).** Never run the Docker build at the same time as `pnpm test:e2e` or `pnpm test:ldap`. Take the old app container down before a build, build in the foreground, and never restart a build that was killed for memory. `AGENTS.md` stays byte-identical. Never read or print `.env` or `.env*.local` (`.env.e2e` is committed test configuration). Scratch files go to the repo's `tmp/` (it ignores itself), never `/tmp`; nothing under `tmp/` may end in `.ts` or `.tsx` (the root `tsconfig.json` includes `**/*.ts`), nor be named `.env.example`.

## Review Focus

Five conditions the spec implies that no feature flow pins on its own, most likely first. Each has its tests in the task named.

1. **A crafted value on the directory tab**: a username of `*`, `alice)(objectClass=*`, a backslash, a NUL or 256 characters; an empty or whitespace-only password; a login two entries share. The filter carries the value escaped, no bind runs with an empty password, and the person sees the one generic message. Tests: Task 5 (escaping, the parsed filter), Task 7 (zod bounds, no bind for an empty password, `ambiguous_user`, the wildcard against both servers), Task 6 (`*` finds nothing).
2. **A directory entry that meets an existing account**: its email belongs to a local account, or to another directory account, at the first sign-in, a later sign-in or the sync; a directory person types their password on the local tab. No account is taken over: the first sign-in is refused, a refresh keeps the old email and counts a conflict, the local tab refuses after the same bcrypt work. Tests: Task 1 (the passwordless local refusal), Task 3 (`email_in_use`, the kept email), Task 9 (the 1062 fallback), Task 8 (`e2e/directory-sign-in.spec.ts`, the local account erin), Task 13 (no password through a direct `updateUser` call).
3. **A directory that fails partway**: down, slow, a refused certificate, a refused service account, signing required (code 8), a page that fails, one linked group the directory refuses. Nothing is deactivated, the run is `failed` with a fixed code, the refused group's memberships stay, and a person signing in is told the directory is unreachable, not to check their password. Tests: Task 6 (failure classification, against both servers), Task 7 (codes 8 and 13), Task 9 (a group left whole), Task 10 (failure codes, partial counts, the unreachable run against both servers).
4. **A setting that would quietly cut the truth**: a filter that matches nothing on this server, a changed `LDAP_ID_ATTRIBUTE`, a server-side size cap, a StartTLS client that reconnects, a wrong CA, a malformed filter, schedule or time zone. The sync stops with `empty` or `id_attribute_changed`, the paged search gets every entry, a reconnect fails instead of going plain, the environment refuses the bad value by name. Tests: Task 2 (the block's refusals), Task 4 (the server's size limit is real), Task 6 (the single-use factory, paging past the limit, the untrusted CA), Task 9 (the stops), Task 10 (the empty base against both servers).
5. **Two at once**: two containers on one scheduled slot, Sync now during a scheduled run, two first sign-ins of the same person, a development reload. One run per slot, `sync_running` for the second, one account (the retry), one croner job per process. Tests: Task 3 (the retry on 1062 or 1213), Task 9 (the claim), Task 10 (the running guard for every trigger), Task 11 (the `globalThis` guard), Task 14 (`sync_running` through the action).

---

## File structure

```
lib/auth/account-source.ts, lib/directory-status.ts           the client-safe vocabularies                        (Task 1)
db/schema/{users,directory,index}.ts, db/migrations/<ts>_b3b-directory/, lib/auth/options.ts (passwordless refusal),
lib/data/{users,db-errors}.ts, lib/error-log.ts, __tests__/{b3b-schema,auth-options,data-users-password,data-db-errors}  (Task 1)
package.json (ldapts, croner), lib/env.ts (the LDAP block), lib/directory/config.ts, .env.template,
__tests__/{env,directory-config}.test.ts                                                                          (Task 2)
lib/data/directory.ts (sign-in write, links), __tests__/data-directory-sign-in.test.ts                           (Task 3)
e2e/fixtures/ldap/ (certificates, Samba scripts, OpenLDAP LDIF), docker-compose.e2e.yml, vitest.config.ts,
.gitattributes, __tests__/ldap/{global-setup,servers,servers.ldap.test}.ts                                         (Task 4)
lib/directory/{keys,filters,entry}.ts, __tests__/directory-{keys,filters,entry}.test.ts                            (Task 5)
lib/directory/{errors,connection,operations}.ts, lib/error-log.ts (directory errors),
__tests__/directory-{connection,operations}.test.ts, __tests__/ldap/connection.ldap.test.ts                         (Task 6)
lib/directory/{sign-in,response-floor}.ts, lib/auth/directory-provider.ts, lib/auth/options.ts (ldap, source),
types/next-auth.d.ts, __tests__/{directory-sign-in,directory-response-floor,auth-directory-provider}.test.ts,
__tests__/ldap/sign-in.ldap.test.ts                                                                                (Task 7)
app/(auth)/login/page.tsx, components/auth/{login-form,auth-failure}.ts(x), components/shell/account-dropdown.tsx,
.env.e2e, e2e/global-setup.ts, e2e/fixtures/{users,directory}.ts, e2e/{auth,deactivation}.spec.ts,
e2e/directory-sign-in.spec.ts, locales/*                                                                          (Task 8)
lib/directory/plan.ts, lib/data/directory.ts (sync writes, runs), __tests__/{directory-plan,data-directory-sync}  (Task 9)
lib/directory/sync.ts, __tests__/directory-sync.test.ts, __tests__/ldap/sync.ldap.test.ts                          (Task 10)
instrumentation.ts, lib/directory/schedule.ts, __tests__/{directory-schedule,instrumentation}.test.ts             (Task 11)
lib/directory/admin.ts (group search), lib/data/groups.ts (links), app/(admin)/group-management/*,
components/admin/groups/*, lib/action-{result,failure}.ts, e2e/directory-groups.spec.ts, locales/*               (Task 12)
lib/data/users.ts (source, updateUserRole), app/(admin)/user-management/{actions,schemas}.ts,
components/admin/users/{user-management,user-form-drawer}.tsx, e2e/directory-accounts.spec.ts, locales/*         (Task 13)
lib/directory/admin.ts (status, Sync now), components/admin/users/directory-{status,labels}.ts(x),
app/(admin)/user-management/{actions,page}.ts(x), e2e/directory-sync.spec.ts, locales/*                         (Task 14)
docs/decisions/0029-…, notes on 0006/0010/0018/0024/0026/0027, docs/ldap.md, docs/auth-gate.md, CLAUDE.md, CII   (Task 15)
whole-branch review, fix wave, test:ldap, full e2e, migration on a copy of the local DB, Docker gate, PR text,
the owner's live check list                                                                                      (Task 16)
```

## Execution notes (for the controller)

- **Pre-flight review first (Opus), before Task 1.** One Opus reviewer applies this plan, task by task and verbatim, to a throwaway copy of the repository outside it (the session scratchpad: sources copied without `.git`, `.env`, `.env*.local`, `.superpowers` and `docs`; `node_modules` symlinked), as B3a's pre-flight did (`docs/superpowers/research/2026-10-09-backend-b3/b3a-execution/preflight-scan.md`; it found 9 Critical defects before Task 1). It runs `next typegen` and `tsc --noEmit`, `drizzle-kit generate` (checking the SQL against Task 1's test), `vitest`, `oxlint` and the antd CLI's lint after each task's code. Then it runs the two LDAP test directories once on the copy, in this plan's Task 4 form: generate the certificates, `up -d --wait` both servers, the checklist of `ldap-test-servers.md` §7.6 (the certificates served and verified, the Samba seed with `CN=Smith\, Frank`, the nested group through the in-chain rule and through nestgroup, the OpenLDAP size limit with and without paging, the ppolicy lock, start-up time and `docker stats` memory), Task 1's migration on the e2e MySQL (the `CHECK` accepted, error 3819 on a bad row), and the plan's `pnpm test:ldap` suite against them; then `down -v` and nothing left running. It does not touch `docker-compose.local.yml`, never starts a Docker build and never runs `pnpm dev`. Its report lists Critical, Important and Minor findings with their fixes; the controller rules on each (rule R0), amends this plan (including the measured `mem_limit` values), and commits the amended plan before Task 1.
- **Workspace.** `.superpowers/sdd/2026-10-10-backend-b3b-directory/` (git-ignored) holds the contracts copied from `.superpowers/sdd/2026-10-09-backend-b3a-groups-access/{implementer-contract,reviewer-contract,re-review-contract}.md` and adapted to this plan (B3b, its branch, `pnpm test:ldap`), `global-constraints.md` (this plan's header, Global Constraints, Review Focus and File structure, verbatim), a `rules.md`, the ledger `progress.md`, `rulings.md`, each task's brief, carry, report and reviews, and a `RESUME.md` kept current. The rules, from B3a's R0–R10:
  - **R0** ADR-0002 governs every decision, the controller's rulings included; a review finding that names a documented route is taken, even when Minor and even against this plan; every architectural choice the docs leave open names 2–3 reference projects, or it is a finding.
  - **R1** the commit trailers above, in the same `-m`, whatever model writes them.
  - **R2** forgot and reset password stay as inherited (ADR-0024 deviation 6): `app/api/auth/{forgot,reset}-password/**`, `app/(auth)/{forgot,reset}-password/**`, their two forms and `lib/mail.ts` are not edited.
  - **R3** scratch in the repo's `tmp/`, nothing there ending in `.ts`/`.tsx` or named `.env.example`.
  - **R4** Docker: only `docker-compose.e2e.yml`'s services (MySQL, `ldap-ad`, `ldap-openldap`), and only where the brief says; never `docker-compose.local.yml`, never a Docker build, never `pnpm dev`.
  - **R5** `AGENTS.md` byte-identical; never read or print `.env` or `.env*.local`.
  - **R6** stage only the task's paths; never `tmp/`, `.superpowers/` or a handoff.
  - **R7** no push, no PR, no branch deletion (owner); commits on `feat/backend-b3b-directory` only.
  - **R8** the unit gate is `pnpm test` (the `unit` project); `pnpm test:ldap` runs where the brief names it, and stops its servers itself.
  - **R9** only the Playwright specs the brief names (plus a spec the task changed); never the full suite, which runs once in Task 16. No extra probes or scratch configs unless the brief asks; say in the report what you would have probed.
  - **R10** leave nothing running: no shell, `next dev`, Playwright or `pnpm test:ldap` process you started is alive when you report, `ldap-openldap` is not left up by hand, and no command waits on stdin.
- **Per task:** a fresh implementer, given its task text, the Global Constraints, the Review Focus lines its task owns, the implementer contract, `rules.md` and the task's carry (the controller's rulings for it); then a fresh reviewer with the task's gates; scoped re-reviews of each fix round. If a subagent cannot write its report file, save the report from its reply before dispatching the reviewer.
- **Models** (owner, 2026-10-10: Fable for the security-sensitive reviews and the final review; Opus or Sonnet elsewhere):

  | Task | Implementer | Reviewer |
  | --- | --- | --- |
  | 1 schema, the passwordless account | Opus | **Fable** (a migration on real data; the local sign-in path) |
  | 2 the LDAP block | Sonnet | Opus |
  | 3 the directory DAL for sign-in | Opus | **Fable** (account linking, takeover) |
  | 4 the test directories, `test:ldap` | Opus | Opus |
  | 5 keys, filters, entries | Opus | **Fable** (filter injection, key canonicalisation) |
  | 6 connection and operations | Opus | **Fable** (TLS, the StartTLS downgrade, failure classification) |
  | 7 sign-in and the `ldap` provider | Opus | **Fable** (authentication, timing) |
  | 8 login tabs, e2e harness | Opus | Opus |
  | 9 the sync plan and writes | Opus | **Fable** (deactivation writes) |
  | 10 the sync run | Opus | **Fable** (safety stops) |
  | 11 the schedule | Sonnet | Opus |
  | 12 directory groups on the groups page | Opus | Opus |
  | 13 directory accounts on the users page | Opus | **Fable** (rank-mapped writes) |
  | 14 status panel and Sync now | Sonnet | Opus |
  | 15 records | Sonnet | Sonnet |

  Scoped re-reviews run on Sonnet; a fix loop that reaches round 4 goes to Fable. The whole-branch review (Task 16) runs on Fable, its fix wave on Opus.

- **Keep tasks lean** (owner, after B3a's Task 4b): implementers run only their brief's Playwright specs; the full suite (about 25 minutes) runs once in Task 16.
- **Progress in chat.** This harness has no todo tool: post the task checklist in chat at each task boundary.
- **The owner changes design mid-run.** Relay a change to the running implementer, append it to that task's brief, and record it in ADR-0029 (Task 15).
- **Usage limits pause the run.** Keep `RESUME.md` and the ledger current, with a memory pointer, so a new session resumes without loss (B3a's pattern).
- **The owner is often remote**: they merge on the gates' strength and defer browser checks; the live check against their Active Directory (Task 16 Step 7) is theirs and comes after the merge decision.

---

### Task 1: The schema, the migration and the passwordless account

Spec §3.2 (B3b data model), §6.3 last paragraph (the local provider refuses `ldap` accounts), §12 (forgot and reset password stay local-only). Review Focus: line 2 (no local sign-in into a directory account). Task 16 runs the migration on a copy of the local database.

**Files:**

- Create: `lib/auth/account-source.ts`, `lib/directory-status.ts`, `db/schema/directory.ts`, `__tests__/b3b-schema.test.ts`
- Modify: `db/schema/users.ts`, `db/schema/index.ts`, `lib/auth/options.ts` (`findAccount`), `lib/data/users.ts` (`changeOwnPassword`), `lib/data/db-errors.ts` (`isDeadlock`), `lib/error-log.ts` (`SignInRefusalReason`), `__tests__/auth-options.test.ts`, `__tests__/data-users-password.test.ts`, `__tests__/data-db-errors.test.ts`
- Generate: `db/migrations/<timestamp>_b3b-directory/`

**Interfaces:**

- Produces: `ACCOUNT_SOURCES`, `AccountSource` from `@/lib/auth/account-source`; `SYNC_TRIGGERS`, `SyncTrigger`, `SYNC_OUTCOMES`, `SyncOutcome`, `SYNC_ERROR_CODES`, `SyncErrorCode`, `LDAP_ENCRYPTIONS`, `LdapEncryption`, `DIRECTORY_KEY_PATTERN`, `DIRECTORY_GROUP_SEARCH_LIMIT` from `@/lib/directory-status` (client-safe); the columns `users.source`, `users.directoryId`, `users.directoryIdAttribute`, `users.directoryUsername` and the nullable `users.password`; the tables `userGroupDirectoryLinks`, `directorySyncRuns`, all exported from `@/db/schema`; `isDeadlock(error)` from `@/lib/data/db-errors`; the refusal reason `'directory_account'` in `SignInRefusalReason`.

**Deviation from the spec text (recorded in ADR-0029, Task 15):** the run table's trigger column is `run_trigger`, not `trigger`: `TRIGGER` is a reserved word in MySQL 8.4 ("Keywords and Reserved Words", marked (R)), and spec §3 itself asks that "Table and column names avoid reserved words". The run table also counts `group_errors` (spec §6.4 step 4: "count the error"), which the spec's list of counts leaves out.

- [ ] **Step 1: Write the failing schema test**

Create `__tests__/b3b-schema.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { getTableConfig } from 'drizzle-orm/mysql-core'
import { describe, expect, it } from 'vitest'

import { directorySyncRuns, userGroupDirectoryLinks, users } from '@/db/schema'

describe('the B3b schema (B3 spec §3.2)', () => {
	it('gives every account a source and lets a directory account have no password', () => {
		expect(users.source.enumValues).toEqual(['local', 'ldap'])
		expect(users.source.notNull).toBe(true)
		expect(users.source.default).toBe('local')
		expect(users.password.notNull).toBe(false)
		for (const column of [users.directoryId, users.directoryIdAttribute, users.directoryUsername])
			expect(column.notNull).toBe(false)
	})

	it('keeps one account per directory key, beside the unique email', () => {
		const names = getTableConfig(users).indexes.map(index => index.config.name)
		expect(names).toEqual(['users_email_key', 'users_directory_id_key'])
		const directoryKey = getTableConfig(users).indexes.find(
			index => index.config.name === 'users_directory_id_key',
		)!
		expect(directoryKey.config.unique).toBe(true)
	})

	it('ties the source to the credentials with a CHECK', () => {
		expect(getTableConfig(users).checks.map(check => check.name)).toEqual([
			'users_source_credentials',
		])
	})

	it('links a hub group to directory groups by key, cascading with the group', () => {
		const config = getTableConfig(userGroupDirectoryLinks)
		expect(config.name).toBe('user_group_directory_links')
		expect(config.primaryKeys[0].columns.map(column => column.name)).toEqual([
			'group_id',
			'directory_group_id',
		])
		expect(config.foreignKeys.map(key => key.onDelete)).toEqual(['cascade'])
		expect(getTableConfig(config.foreignKeys[0].reference().foreignTable).name).toBe('user_groups')
		expect(userGroupDirectoryLinks.missingSince.notNull).toBe(false)
	})

	it('records sync runs with a unique slot and no reserved column name', () => {
		const config = getTableConfig(directorySyncRuns)
		expect(config.name).toBe('directory_sync_runs')
		expect(config.columns.map(column => column.name)).not.toContain('trigger')
		expect(directorySyncRuns.runTrigger.enumValues).toEqual(['schedule', 'startup', 'manual'])
		expect(directorySyncRuns.outcome.enumValues).toEqual([
			'running',
			'succeeded',
			'failed',
			'empty',
			'id_attribute_changed',
		])
		expect(directorySyncRuns.outcome.default).toBe('running')
		const slot = config.indexes.find(index => index.config.name === 'directory_sync_runs_slot_key')!
		expect(slot.config.unique).toBe(true)
		expect(config.foreignKeys).toEqual([])
	})
})

describe('the B3b migration', () => {
	const folder = readdirSync('db/migrations').find(name => name.endsWith('_b3b-directory'))
	const sql = () => readFileSync(path.join('db/migrations', folder!, 'migration.sql'), 'utf8')
	const statements = () =>
		sql()
			.split('--> statement-breakpoint')
			.map(part => part.trim())
			.filter(Boolean)

	it('creates both tables and changes users', () => {
		expect(folder).toBeDefined()
		expect(sql()).toContain('CREATE TABLE `user_group_directory_links`')
		expect(sql()).toContain('CREATE TABLE `directory_sync_runs`')
		expect(sql()).toContain('ALTER TABLE `users` MODIFY COLUMN `password` varchar(255);')
		expect(sql()).toContain(
			"ALTER TABLE `users` ADD `source` enum('local','ldap') DEFAULT 'local' NOT NULL;",
		)
		expect(sql()).toContain(
			'CREATE UNIQUE INDEX `users_directory_id_key` ON `users` (`directory_id`);',
		)
	})

	// drizzle-kit 1.0.0-rc.3 leaves ON DELETE out when a migration creates exactly one table with foreign keys (spec
	// §3.2); this migration creates two, so the action must be there.
	it('writes ON DELETE CASCADE on its one foreign key', () => {
		expect(sql().match(/FOREIGN KEY/g)).toHaveLength(1)
		expect(sql()).toMatch(
			/FOREIGN KEY \(`group_id`\) REFERENCES `user_groups`\(`id`\) ON DELETE CASCADE/,
		)
	})

	// MySQL 8.4 "ALTER TABLE": adding a CHECK that existing rows break fails; every existing account is local with a
	// password, so the CHECK comes after the column changes that make that true.
	it('adds the CHECK after every change to users columns', () => {
		const all = statements()
		const check = all.findIndex(statement => statement.includes('CHECK'))
		expect(check).toBeGreaterThan(-1)
		expect(all[check]).toMatch(
			/^ALTER TABLE `users` ADD CONSTRAINT `users_source_credentials` CHECK/,
		)
		const columnChanges = all
			.map((statement, index) =>
				/^ALTER TABLE `users` (ADD `|MODIFY COLUMN)/.test(statement) ? index : -1,
			)
			.filter(index => index >= 0)
		expect(columnChanges.length).toBeGreaterThanOrEqual(5)
		expect(Math.max(...columnChanges)).toBeLessThan(check)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run __tests__/b3b-schema.test.ts` Expected: FAIL; `directorySyncRuns` and `userGroupDirectoryLinks` are not exported from `@/db/schema` (and `users.source` is undefined).

- [ ] **Step 3: The vocabularies**

Create `lib/auth/account-source.ts`:

```ts
/**
 * Where an account's identity lives (B3 spec §3.2, ADR-0029): a `local` account signs in with the hub's email and
 * password; an `ldap` account with its directory username and password, which the directory checks, and has no hub
 * password. Client-safe on purpose: the schema, the session types and the users table read it.
 */
export const ACCOUNT_SOURCES = ['local', 'ldap'] as const

export type AccountSource = (typeof ACCOUNT_SOURCES)[number]
```

Create `lib/directory-status.ts`:

```ts
/**
 * The directory's vocabulary as the admin surface shows it (B3 spec §3.2, §6.4, §6.6, §7.1). Client-safe: the schema,
 * the sync and the users page's status panel read it.
 */

/** How a sync run started. */
export const SYNC_TRIGGERS = ['schedule', 'startup', 'manual'] as const
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number]

/** A run's outcome: `running` until it ends; `empty` and `id_attribute_changed` are safety stops that change no account (spec §6.4 step 2). */
export const SYNC_OUTCOMES = [
	'running',
	'succeeded',
	'failed',
	'empty',
	'id_attribute_changed',
] as const
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number]

/**
 * The fixed error code a failed run records (spec §3.2: "a fixed code, never a message with secrets"): the directory
 * did not answer (connection, TLS, timeout), refused the service account's bind, or refused a search; anything else.
 */
export const SYNC_ERROR_CODES = [
	'directory_unreachable',
	'bind_refused',
	'search_failed',
	'internal_error',
] as const
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number]

/**
 * A directory key in canonical text (spec §3.2): a lowercase 8-4-4-4-12 UUID (RFC 9562 §4). Client-safe, because the
 * groups form validates the keys it sends with it (Task 12).
 */
export const DIRECTORY_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Spec §6.5 "Linking": the most directory groups one search of the groups page shows. */
export const DIRECTORY_GROUP_SEARCH_LIMIT = 20

/** `LDAP_ENCRYPTION` (spec §7.1, §2 #18): chosen explicitly, no default. */
export const LDAP_ENCRYPTIONS = ['ldaps', 'starttls', 'none'] as const
export type LdapEncryption = (typeof LDAP_ENCRYPTIONS)[number]
```

- [ ] **Step 4: The schema**

In `db/schema/users.ts`, change the imports and the table:

```ts
import { sql } from 'drizzle-orm'
import {
	check,
	datetime,
	int,
	mysqlEnum,
	mysqlTable,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/mysql-core'

import { ACCOUNT_SOURCES } from '@/lib/auth/account-source'
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
		/** The bcrypt hash of a local account; null for a directory account, whose password the directory checks (ADR-0029). */
		password: varchar({ length: 255 }),
		/** ADR-0024: the migration made the oldest existing account the owner and every other one an admin. */
		role: mysqlEnum(ROLES).default('user').notNull(),
		sessionVersion: int('session_version').default(0).notNull(),
		/** ADR-0027: set by an admin's Deactivate, cleared by Reactivate; the account is active while both markers are null. */
		adminDeactivatedAt: datetime('admin_deactivated_at', { fsp: 3 }),
		/** The admin's users.id; no foreign key, so deleting that admin keeps the record. */
		adminDeactivatedBy: varchar('admin_deactivated_by', { length: 36 }),
		/** ADR-0027: set and cleared by the directory sync and sign-in only (ADR-0029). */
		directoryDeactivatedAt: datetime('directory_deactivated_at', { fsp: 3 }),
		/** ADR-0029: who owns the account's identity; existing accounts are local (the column default). */
		source: mysqlEnum(ACCOUNT_SOURCES).default('local').notNull(),
		/**
		 * The directory entry's key in canonical text (spec §3.2: `objectGUID` as a lowercase GUID string, `entryUUID`
		 * lowercased), the only link to the entry (ADR-0026: never the email, the DN, the UPN or the login name).
		 */
		directoryId: varchar('directory_id', { length: 64 }),
		/** The attribute that produced the key, so a change of LDAP_ID_ATTRIBUTE is detected (spec §6.4 step 2). */
		directoryIdAttribute: varchar('directory_id_attribute', { length: 64 }),
		/** The login attribute's value, for display and search. */
		directoryUsername: varchar('directory_username', { length: 255 }),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [
		uniqueIndex('users_email_key').on(table.email),
		// A unique index allows several NULLs (MySQL 8.4 "CREATE INDEX"), so every local account can have none.
		uniqueIndex('users_directory_id_key').on(table.directoryId),
		// MySQL 8.4 "CHECK Constraints": a NULL result passes, so `source` is NOT NULL and the other two columns are
		// tested with IS [NOT] NULL, which never yields UNKNOWN. A later migration that modifies `password` or `source`
		// must drop and re-add this constraint in the same statement ("ALTER TABLE").
		check(
			'users_source_credentials',
			sql`(${table.source} = 'local' AND ${table.password} IS NOT NULL AND ${table.directoryId} IS NULL) OR (${table.source} = 'ldap' AND ${table.password} IS NULL AND ${table.directoryId} IS NOT NULL)`,
		),
	],
)
```

Create `db/schema/directory.ts`:

```ts
import {
	datetime,
	index,
	int,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/mysql-core'

import { SYNC_OUTCOMES, SYNC_TRIGGERS } from '@/lib/directory-status'

import { userGroups } from './groups'

/**
 * A hub group's link to a directory group, by the directory group's key (B3 spec §3.2, §6.5): renaming or moving the
 * group in the directory keeps the link. Deleting the hub group removes its links (ON DELETE CASCADE). The name is what
 * the groups page shows, refreshed by the sync; `missing_since` is set while the sync does not find the group.
 */
export const userGroupDirectoryLinks = mysqlTable(
	'user_group_directory_links',
	{
		groupId: varchar('group_id', { length: 36 })
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
		directoryGroupId: varchar('directory_group_id', { length: 64 }).notNull(),
		directoryGroupName: varchar('directory_group_name', { length: 255 }).notNull(),
		missingSince: datetime('missing_since', { fsp: 3 }),
	},
	table => [primaryKey({ columns: [table.groupId, table.directoryGroupId] })],
)

/**
 * One row per sync run (spec §3.2, §6.4). `slot` is unique: a scheduled run's slot is its scheduled minute, so a second
 * container's insert for the same slot is refused and that container skips (Documenso's deterministic slot key). The
 * run deletes rows older than 90 days. `run_trigger`, not `trigger`, which MySQL 8.4 reserves.
 */
export const directorySyncRuns = mysqlTable(
	'directory_sync_runs',
	{
		id: varchar({ length: 36 }).primaryKey(),
		slot: varchar({ length: 64 }).notNull(),
		runTrigger: mysqlEnum('run_trigger', SYNC_TRIGGERS).notNull(),
		startedAt: datetime('started_at', { fsp: 3 }).notNull(),
		finishedAt: datetime('finished_at', { fsp: 3 }),
		outcome: mysqlEnum(SYNC_OUTCOMES).default('running').notNull(),
		entriesSeen: int('entries_seen').default(0).notNull(),
		deactivated: int('deactivated').default(0).notNull(),
		reactivated: int('reactivated').default(0).notNull(),
		updated: int('updated').default(0).notNull(),
		conflicts: int('conflicts').default(0).notNull(),
		groupErrors: int('group_errors').default(0).notNull(),
		membershipsAdded: int('memberships_added').default(0).notNull(),
		membershipsRemoved: int('memberships_removed').default(0).notNull(),
		errorCode: varchar('error_code', { length: 64 }),
	},
	table => [
		uniqueIndex('directory_sync_runs_slot_key').on(table.slot),
		index('directory_sync_runs_started_at_idx').on(table.startedAt),
	],
)
```

In `db/schema/index.ts`, add (keep the alphabetical order of the file):

```ts
export { directorySyncRuns, userGroupDirectoryLinks } from './directory'
```

- [ ] **Step 5: Generate the migration and read it**

```bash
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm db:generate --name b3b-directory
```

`generate` connects to nothing; `drizzle.config.ts` only needs a URL to load (B3a's pre-flight generated with a dummy one).

Read the generated `db/migrations/<timestamp>_b3b-directory/migration.sql` by hand. Expected: two `CREATE TABLE`, `MODIFY COLUMN \`password\` varchar(255)`, four `ALTER TABLE \`users\` ADD`, the unique index, one `ADD CONSTRAINT … FOREIGN KEY … ON DELETE CASCADE`, and the `CHECK`after the column changes. If the foreign key lacks`ON DELETE CASCADE` (the drizzle-kit defect, spec §3.2), stop and report NEEDS_CONTEXT: do not edit generated SQL by hand.

- [ ] **Step 6: Run the schema test and apply the migration to the e2e database**

```bash
pnpm exec vitest run __tests__/b3b-schema.test.ts
docker compose -f docker-compose.e2e.yml up -d --wait mysql
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/e2e pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'e2e'; SELECT source, COUNT(*) FROM users GROUP BY source;"
```

Expected: the test passes; the migration applies; `users_source_credentials` is listed; every existing account is `local`. MySQL 8.4 accepts the table-qualified column names drizzle-kit writes inside the `CHECK` (the pre-flight confirmed it on the e2e database; spec §14). Then prove the constraint refuses a directory row with a password:

```bash
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -ue2e -pe2e e2e -e "INSERT INTO users (id, email, password, source, directory_id) VALUES ('b3b-check', 'b3b-check@e2e.local', 'x', 'ldap', 'k');" ; echo "exit $?"
```

Expected: `ERROR 3819 (HY000): Check constraint 'users_source_credentials' is violated.` and a non-zero exit; no row is written.

- [ ] **Step 7: Write the failing tests for the passwordless account**

A directory account has no hub password. The local provider refuses it after the same bcrypt work as a wrong password, and the account menu's password change refuses it. Add to `__tests__/auth-options.test.ts`, inside `describe('authorizeCredentials', …)`:

```ts
// Spec §6.3: the local provider refuses an `ldap` account (no hub password). The same bcrypt work as a wrong
// password, against the fixed hash (OWASP "Authentication Responses"), and the reason is logged by account id.
it('refuses a directory account with the same work as a wrong password, and logs its id', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	try {
		rows.value = [{ ...row, password: null }]
		verifyPassword.mockResolvedValue(true)
		expect(
			await authorizeCredentials({ email: 'jane@example.com', password: 'any-password' }),
		).toBeNull()
		expect(verifyPassword).toHaveBeenCalledTimes(1)
		expect(verifyPassword).toHaveBeenCalledWith('any-password', noAccountHash)
		expect(warn).toHaveBeenCalledWith('authorizeCredentials: sign-in refused', {
			reason: 'directory_account',
			userId: 'u1',
		})
	} finally {
		warn.mockRestore()
	}
})
```

Add to `__tests__/data-users-password.test.ts` (at the end of its `describe`, or in a new `describe('changeOwnPassword on a directory account', …)`):

```ts
it('refuses a directory account, which has no hub password, before any check or write', async () => {
	mocks.rows.read = [{ password: null }]
	expect(await changeOwnPassword(actor, input)).toEqual({ ok: false, code: 'forbidden' })
	expect(mocks.strengths).toEqual([])
	expect(mocks.updates).toEqual([])
})
```

(If that file resets `mocks` in a `beforeEach`, the new case relies on it; otherwise clear `mocks.strengths` and `mocks.updates` at its start.)

Add to `__tests__/data-db-errors.test.ts`:

```ts
describe('isDeadlock (MySQL 1213 ER_LOCK_DEADLOCK)', () => {
	it('reads the code on the error or on its cause', () => {
		const driver = Object.assign(new Error('Deadlock found'), {
			code: 'ER_LOCK_DEADLOCK',
			errno: 1213,
		})
		expect(isDeadlock(driver)).toBe(true)
		expect(isDeadlock(new Error('wrapped', { cause: driver }))).toBe(true)
		expect(isDeadlock(Object.assign(new Error('x'), { code: 'ER_DUP_ENTRY' }))).toBe(false)
		expect(isDeadlock(null)).toBe(false)
	})
})
```

(and add `isDeadlock` to that file's import from `@/lib/data/db-errors`).

Run: `pnpm exec vitest run __tests__/auth-options.test.ts __tests__/data-users-password.test.ts __tests__/data-db-errors.test.ts` Expected: FAIL on the three new cases (and `pnpm exec tsc --noEmit` reports `user.password` and `row.password` as `string | null` where `verifyPassword` takes a string).

- [ ] **Step 8: Handle the passwordless account**

In `lib/error-log.ts`, widen the union and its comment:

```ts
/**
 * The fixed reason codes of a refused sign-in (B3 spec §7.3). `directory_account`: the local form named an account the
 * directory owns, which has no hub password. The directory's own reasons follow in ADR-0029's tasks.
 */
export type SignInRefusalReason = 'account_inactive' | 'directory_account'
```

In `lib/auth/options.ts` `findAccount`, after the `if (!user) { … }` block and before the password check:

```ts
// Spec §6.3: an account the directory owns has no hub password. The same bcrypt work as a wrong password, against
// the fixed hash, so the answer's time tells nothing; refused like a wrong password (OWASP "Authentication Responses").
if (user.password === null) {
	await verifyPassword(password, UNKNOWN_ACCOUNT_HASH)
	logSignInRefusal('authorizeCredentials', 'directory_account', { userId: user.id })
	return null
}
```

In `lib/data/users.ts` `changeOwnPassword`, right after `if (!row) return fail('unauthorized')`:

```ts
// A directory account has no hub password to change (spec §6.3; the directory owns it).
if (row.password === null) return fail('forbidden')
```

In `lib/data/db-errors.ts`, add:

```ts
/**
 * InnoDB's deadlock (1213 ER_LOCK_DEADLOCK): the transaction was rolled back and may be run again (MySQL 8.4 "How to
 * Minimize and Handle Deadlocks": "Always be prepared to re-issue a transaction if it fails due to deadlock").
 */
export const isDeadlock = (error: unknown): boolean => hasCode(error, 'ER_LOCK_DEADLOCK')
```

- [ ] **Step 9: Verify**

```bash
pnpm exec vitest run __tests__/b3b-schema.test.ts __tests__/auth-options.test.ts __tests__/data-users-password.test.ts __tests__/data-db-errors.test.ts
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/auth/account-source.ts lib/directory-status.ts db/schema/users.ts db/schema/directory.ts db/schema/index.ts lib/auth/options.ts lib/data/users.ts lib/data/db-errors.ts lib/error-log.ts __tests__/b3b-schema.test.ts __tests__/auth-options.test.ts __tests__/data-users-password.test.ts __tests__/data-db-errors.test.ts
pnpm exec oxfmt --write <the same files> && pnpm exec oxfmt --check <the same files>
pnpm test
```

Expected: all pass; tsc reports nothing. The inherited reset handler (`app/api/auth/reset-password/route.ts`, rule R2: untouched) writes a password only for the account its token names; a token for a directory account could only come from the inherited forgot flow with SMTP on, and the `CHECK` refuses that write (error 3819), so the handler answers its existing failure. Task 15 records it in `docs/auth-gate.md`.

- [ ] **Step 10: Commit**

```bash
git add lib/auth/account-source.ts lib/directory-status.ts db/schema/users.ts db/schema/directory.ts db/schema/index.ts db/migrations/*_b3b-directory lib/auth/options.ts lib/data/users.ts lib/data/db-errors.ts lib/error-log.ts __tests__/b3b-schema.test.ts __tests__/auth-options.test.ts __tests__/data-users-password.test.ts __tests__/data-db-errors.test.ts
git commit -m "feat(db): add directory accounts, group links and sync runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 2: The `LDAP_*` block and the two dependencies

Spec §7.1 (the block: on when `LDAP_URL` is set; every key parses or the first request fails with the variables' names), §2 #13, #14, #18 (environment variables, the cron schedule with `off`, `LDAP_ENCRYPTION` chosen explicitly), §6.1 (ldapts 9.2.0), §6.4 (croner). ADR-0025 (zod for `lib/env.ts`). Review Focus: line 4.

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add`), `lib/env.ts`, `__tests__/env.test.ts`, `.env.template`
- Create: `lib/directory/config.ts`, `__tests__/directory-config.test.ts`

**Interfaces:**

- Consumes: `LDAP_ENCRYPTIONS`, `LdapEncryption` from `@/lib/directory-status` (Task 1).
- Produces: `interface LdapConfig { url: string; encryption: LdapEncryption; caFile: string | null; bindDn: string; bindPassword: string; userBaseDn: string; userFilter: string; loginAttribute: string; idAttribute: string; emailAttribute: string; nameAttribute: string; groupBaseDn: string; groupFilter: string; groupNameAttribute: string; groupMemberFilter: string; syncSchedule: string | null; syncTimezone: string | null }` and `ServerEnv.ldap: LdapConfig | null` from `@/lib/env`; `GROUP_DN_PLACEHOLDER` (`'{group_dn}'`) from `@/lib/env`; `directoryConfig(): LdapConfig | null` and `isDirectoryConfigured(): boolean` from `@/lib/directory/config`. The dependencies `ldapts` 9.2.0 and `croner` 10.0.1, pinned exactly.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **a. Exact pins.** `ldapts@9.2.0` and `croner@10.0.1` are installed with `pnpm add -E` (pnpm docs, `pnpm add --save-exact`), as this line pins `drizzle-orm`: ldapts is the security-relevant client (spec §6.1), and both versions are the ones the research read (`docs/superpowers/research/2026-10-09-backend-b3/b3b-plan/library-apis.md` §1, §2: 9.2.0 and 10.0.1 are `latest` on 2026-10-10; Homarr pins `croner` 10.0.1 exactly).
- **b. Configured filters are read by ldapts' own parser.** `FilterParser.parseString` is exported from ldapts' root (`src/index.ts:12`, typed in `dist/index.d.mts`) and is the parser `search()` applies to a string filter (`src/Client.ts:640-646` at `ldapts@b38cfc3`); it is pinned by ldapts' tests (`tests/FilterParser.test.ts:19-55`) but not described in the README. A filter must also start with `(` and end with `)`, as RFC 4515 §3 writes one (`filter = LPAREN filtercomp RPAREN`; ldapts' README: "ldapts requires all filters to be surrounded by '()' blocks"). `LDAP_GROUP_MEMBER_FILTER` must contain `{group_dn}` and parses with a sample DN in its place.
- **c. The schedule is a five-field cron expression or `off`.** croner's default `auto` mode also takes six and seven fields with seconds first (croner README "Pattern"), which would allow a sync every second; the field count is checked, then croner parses the pattern, then `nextRun()` checks `LDAP_SYNC_TIMEZONE` (croner checks a time zone only when it converts a date: `CronDate.fromDate` throws "Failed to convert date to timezone", `src/date.ts:277` at `croner@adc86215`). The `Cron` used to validate has no function and no `name`, so it starts no timer and joins no `scheduledJobs` list (`src/croner.ts:208, 215-219`).
- **d. `LDAP_URL` needs a host** (zod 4 "URLs": `z.url({ protocol, hostname })`; without a hostname rule `ldap:host` passes with an empty host, which ldapts would read as `localhost`, `src/Client.ts:231`). Attribute settings follow RFC 4512 §1.4 (`descr = keystring`, a letter then letters, digits and hyphens, or a numeric OID), because the code writes them into filters unescaped (ldapts README "Filter Strings"; `ldap-client.md` §3.8). Non-secret values are trimmed; `LDAP_BIND_PASSWORD` is taken as it is (spaces can be part of a password).

- [ ] **Step 1: Add the dependencies**

```bash
pnpm add -E ldapts@9.2.0 croner@10.0.1
git diff package.json
```

Expected: `"croner": "10.0.1"` and `"ldapts": "9.2.0"` under `dependencies`, in alphabetical order; `pnpm-lock.yaml` changes. Neither package has an install script (`npm view ldapts@9.2.0 scripts` lists none that runs on install).

- [ ] **Step 2: Write the failing tests**

In `__tests__/env.test.ts`, change the expected object of `it('parses the minimal environment with no mail', …)` to include `ldap: null,`, and append inside the outer `describe`:

```ts
/** The settings an AD directory needs; everything else has a default (spec §7.1). */
const ldapBlock = {
	LDAP_URL: 'ldap://10.0.0.5:389',
	LDAP_ENCRYPTION: 'none',
	LDAP_BIND_DN: 'CN=svc-hub,CN=Users,DC=corp,DC=example',
	LDAP_BIND_PASSWORD: ' pass word ',
	LDAP_USER_BASE_DN: 'DC=corp,DC=example',
}
const keysOfFailure = (source: Record<string, string>) => {
	try {
		parseEnv({ ...base, ...source })
	} catch (e) {
		return (e as EnvError).keys.sort()
	}
	return []
}

it('leaves the directory off without LDAP_URL, whatever else is set', () => {
	expect(parseEnv({ ...base, LDAP_ENCRYPTION: 'ldaps' }).ldap).toBeNull()
	expect(parseEnv({ ...base, LDAP_URL: '  ' }).ldap).toBeNull()
})

it('requires the whole block once LDAP_URL is set', () => {
	expect(keysOfFailure({ LDAP_URL: 'ldaps://dc.corp.example' })).toEqual([
		'LDAP_BIND_DN',
		'LDAP_BIND_PASSWORD',
		'LDAP_ENCRYPTION',
		'LDAP_USER_BASE_DN',
	])
})

it('applies the Active Directory defaults and takes the password as it is', () => {
	expect(parseEnv({ ...base, ...ldapBlock }).ldap).toEqual({
		url: 'ldap://10.0.0.5:389',
		encryption: 'none',
		caFile: null,
		bindDn: 'CN=svc-hub,CN=Users,DC=corp,DC=example',
		bindPassword: ' pass word ',
		userBaseDn: 'DC=corp,DC=example',
		userFilter:
			'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
		loginAttribute: 'sAMAccountName',
		idAttribute: 'objectGUID',
		emailAttribute: 'mail',
		nameAttribute: 'displayName',
		groupBaseDn: 'DC=corp,DC=example',
		groupFilter: '(objectClass=group)',
		groupNameAttribute: 'cn',
		groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
		syncSchedule: '0 * * * *',
		syncTimezone: null,
	})
})

it('reads a blank optional value as absent', () => {
	const ldap = parseEnv({ ...base, ...ldapBlock, LDAP_GROUP_BASE_DN: ' ', LDAP_CA_FILE: '' }).ldap
	expect(ldap).toMatchObject({ groupBaseDn: 'DC=corp,DC=example', caFile: null })
})

// Spec §7.1: ldaps goes with ldaps://, starttls and none with ldap://.
it.each([
	['ldaps://dc.corp.example', 'none'],
	['ldaps://dc.corp.example', 'starttls'],
	['ldap://dc.corp.example', 'ldaps'],
])('refuses %s with LDAP_ENCRYPTION=%s', (url, encryption) => {
	expect(keysOfFailure({ ...ldapBlock, LDAP_URL: url, LDAP_ENCRYPTION: encryption })).toEqual([
		'LDAP_ENCRYPTION',
	])
})

it.each([['ldap:host'], ['https://dc.corp.example'], ['dc.corp.example']])(
	'refuses LDAP_URL %s (decision d)',
	url => {
		expect(keysOfFailure({ ...ldapBlock, LDAP_URL: url })).toContain('LDAP_URL')
	},
)

it('refuses an attribute setting that is not an attribute name (decision d)', () => {
	expect(keysOfFailure({ ...ldapBlock, LDAP_LOGIN_ATTRIBUTE: 'uid)(objectClass=*' })).toEqual([
		'LDAP_LOGIN_ATTRIBUTE',
	])
	expect(
		parseEnv({ ...base, ...ldapBlock, LDAP_ID_ATTRIBUTE: 'entryUUID' }).ldap?.idAttribute,
	).toBe('entryUUID')
})

it('refuses a filter ldapts cannot parse, or one without its outer parentheses (decision b)', () => {
	expect(keysOfFailure({ ...ldapBlock, LDAP_USER_FILTER: '(&(objectClass=user)' })).toEqual([
		'LDAP_USER_FILTER',
	])
	expect(keysOfFailure({ ...ldapBlock, LDAP_GROUP_FILTER: 'objectClass=group' })).toEqual([
		'LDAP_GROUP_FILTER',
	])
	expect(keysOfFailure({ ...ldapBlock, LDAP_GROUP_MEMBER_FILTER: '(memberOf=cn=x)' })).toEqual([
		'LDAP_GROUP_MEMBER_FILTER',
	])
	expect(
		parseEnv({ ...base, ...ldapBlock, LDAP_GROUP_MEMBER_FILTER: '(memberOf={group_dn})' }).ldap
			?.groupMemberFilter,
	).toBe('(memberOf={group_dn})')
})

it('reads the schedule: off, five fields, a valid time zone (decision c)', () => {
	expect(
		parseEnv({ ...base, ...ldapBlock, LDAP_SYNC_SCHEDULE: 'off' }).ldap?.syncSchedule,
	).toBeNull()
	expect(
		parseEnv({ ...base, ...ldapBlock, LDAP_SYNC_SCHEDULE: ' OFF ' }).ldap?.syncSchedule,
	).toBeNull()
	expect(
		parseEnv({
			...base,
			...ldapBlock,
			LDAP_SYNC_SCHEDULE: '30 6 * * 1-5',
			LDAP_SYNC_TIMEZONE: 'Asia/Riyadh',
		}).ldap,
	).toMatchObject({ syncSchedule: '30 6 * * 1-5', syncTimezone: 'Asia/Riyadh' })
	expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_SCHEDULE: '*/5 * * * * *' })).toEqual([
		'LDAP_SYNC_SCHEDULE',
	])
	expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_SCHEDULE: 'every hour' })).toEqual([
		'LDAP_SYNC_SCHEDULE',
	])
	expect(keysOfFailure({ ...ldapBlock, LDAP_SYNC_TIMEZONE: 'Mars/Olympus' })).toEqual([
		'LDAP_SYNC_TIMEZONE',
	])
})
```

Create `__tests__/directory-config.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { env } = vi.hoisted(() => ({ env: vi.fn() }))
vi.mock('@/lib/env', () => ({ env }))

import { directoryConfig, isDirectoryConfigured } from '@/lib/directory/config'

beforeEach(() => env.mockReset())

describe('directoryConfig', () => {
	it('answers the parsed block, or null when LDAP is off', () => {
		env.mockReturnValue({ ldap: null })
		expect(directoryConfig()).toBeNull()
		expect(isDirectoryConfigured()).toBe(false)
		env.mockReturnValue({ ldap: { url: 'ldaps://dc' } })
		expect(directoryConfig()).toEqual({ url: 'ldaps://dc' })
		expect(isDirectoryConfigured()).toBe(true)
	})
})
```

Run: `pnpm exec vitest run __tests__/env.test.ts __tests__/directory-config.test.ts` Expected: FAIL (no `ldap` key; `@/lib/directory/config` does not exist).

- [ ] **Step 3: The block in `lib/env.ts`**

Add the imports at the top (after `import * as z from 'zod'`):

```ts
import { Cron } from 'croner'
import { escapeFilter, FilterParser } from 'ldapts'

import { LDAP_ENCRYPTIONS, type LdapEncryption } from '@/lib/directory-status'
```

After `smtpSchema`, add:

```ts
/** A blank value counts as absent, so the inner default applies; any other value reaches the inner schema unchanged. */
const blankAsAbsent = <T extends z.ZodType>(inner: T) =>
	z.preprocess(
		value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
		inner,
	)

/** RFC 4512 §1.4: a descriptor (a letter, then letters, digits and hyphens) or a numeric OID (decision d). */
const ATTRIBUTE_NAME = /^(?:[A-Za-z][A-Za-z0-9-]*|\d+(?:\.\d+)+)$/

/** The placeholder LDAP_GROUP_MEMBER_FILTER carries for a group's DN (spec §6.5). */
export const GROUP_DN_PLACEHOLDER = '{group_dn}'

/** Decision b: wrapped in parentheses (RFC 4515 §3) and readable by the parser ldapts' search() uses. */
const isFilter = (value: string): boolean => {
	if (!value.startsWith('(') || !value.endsWith(')')) return false
	try {
		FilterParser.parseString(value)
		return true
	} catch {
		return false
	}
}

const isMemberFilter = (value: string): boolean =>
	value.includes(GROUP_DN_PLACEHOLDER) &&
	isFilter(value.replaceAll(GROUP_DN_PLACEHOLDER, escapeFilter`${'CN=Sample Group,DC=example'}`))

const attribute = (fallback: string) =>
	blankAsAbsent(z.string().trim().regex(ATTRIBUTE_NAME).default(fallback))
const filter = (fallback: string) =>
	blankAsAbsent(z.string().trim().refine(isFilter).default(fallback))

/**
 * Required together once LDAP_URL is set (spec §7.1: all or nothing, like the SMTP block). The defaults are Active
 * Directory's: Microsoft lists the user filter as "All enabled user objects" (archived TechNet wiki on Learn, "Active
 * Directory: LDAP Syntax Filters"), and the member filter walks nested groups (ADSI "Search Filter Syntax",
 * LDAP_MATCHING_RULE_IN_CHAIN).
 */
const ldapSchema = z
	.object({
		LDAP_URL: z.url({ protocol: /^ldaps?$/, hostname: /.+/ }),
		LDAP_ENCRYPTION: z.enum(LDAP_ENCRYPTIONS),
		LDAP_CA_FILE: blankAsAbsent(z.string().trim().optional()),
		LDAP_BIND_DN: z.string().trim().min(1),
		LDAP_BIND_PASSWORD: z.string().min(1),
		LDAP_USER_BASE_DN: z.string().trim().min(1),
		LDAP_USER_FILTER: filter(
			'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
		),
		LDAP_LOGIN_ATTRIBUTE: attribute('sAMAccountName'),
		LDAP_ID_ATTRIBUTE: attribute('objectGUID'),
		LDAP_EMAIL_ATTRIBUTE: attribute('mail'),
		LDAP_NAME_ATTRIBUTE: attribute('displayName'),
		LDAP_GROUP_BASE_DN: blankAsAbsent(z.string().trim().optional()),
		LDAP_GROUP_FILTER: filter('(objectClass=group)'),
		LDAP_GROUP_NAME_ATTRIBUTE: attribute('cn'),
		LDAP_GROUP_MEMBER_FILTER: blankAsAbsent(
			z
				.string()
				.trim()
				.refine(isMemberFilter)
				.default(`(memberOf:1.2.840.113556.1.4.1941:=${GROUP_DN_PLACEHOLDER})`),
		),
		LDAP_SYNC_SCHEDULE: blankAsAbsent(z.string().trim().default('0 * * * *')),
		LDAP_SYNC_TIMEZONE: blankAsAbsent(z.string().trim().optional()),
	})
	.superRefine((value, context) => {
		const secure = new URL(value.LDAP_URL).protocol === 'ldaps:'
		if (secure !== (value.LDAP_ENCRYPTION === 'ldaps'))
			context.addIssue({
				code: 'custom',
				path: ['LDAP_ENCRYPTION'],
				message: 'ldaps goes with ldaps://; starttls and none with ldap://',
			})
		const schedule = value.LDAP_SYNC_SCHEDULE
		if (schedule.toLowerCase() === 'off') return
		// Decision c: five fields, then croner's parser (a Cron without a function parses the pattern and schedules
		// nothing, croner src/croner.ts:215-219; stop() is harmless on it), then the time zone through a date conversion.
		try {
			if (schedule.split(/\s+/).length !== 5) throw new Error('five fields')
			new Cron(schedule).stop()
		} catch {
			context.addIssue({
				code: 'custom',
				path: ['LDAP_SYNC_SCHEDULE'],
				message: 'a five-field cron expression or off',
			})
			return
		}
		if (value.LDAP_SYNC_TIMEZONE === undefined) return
		try {
			new Cron(schedule, { timezone: value.LDAP_SYNC_TIMEZONE }).nextRun()
		} catch {
			context.addIssue({
				code: 'custom',
				path: ['LDAP_SYNC_TIMEZONE'],
				message: 'an IANA time zone',
			})
		}
	})

export interface LdapConfig {
	url: string
	encryption: LdapEncryption
	/** A PEM file with the CA that signed the directory's certificate; Node's trust store when null. */
	caFile: string | null
	bindDn: string
	bindPassword: string
	userBaseDn: string
	userFilter: string
	loginAttribute: string
	idAttribute: string
	emailAttribute: string
	nameAttribute: string
	groupBaseDn: string
	groupFilter: string
	groupNameAttribute: string
	/** Carries GROUP_DN_PLACEHOLDER, replaced by a group's escaped DN at run time. */
	groupMemberFilter: string
	/** A five-field cron expression; null for `off`. */
	syncSchedule: string | null
	/** An IANA time zone; the process's zone when null (UTC in the image). */
	syncTimezone: string | null
}
```

zod 4 runs an object's `superRefine` only once its fields have parsed (checked on the installed zod 4.6.5), so every value it reads is typed and present.

`ServerEnv` gains `ldap: LdapConfig | null`. In `parseEnv`, after the SMTP block:

```ts
let ldap: LdapConfig | null = null
if (typeof source.LDAP_URL === 'string' && source.LDAP_URL.trim() !== '') {
	const parsed = ldapSchema.safeParse(source)
	if (!parsed.success) throw new EnvError(keysOf(parsed.error))
	const data = parsed.data
	ldap = {
		url: data.LDAP_URL,
		encryption: data.LDAP_ENCRYPTION,
		caFile: data.LDAP_CA_FILE ?? null,
		bindDn: data.LDAP_BIND_DN,
		bindPassword: data.LDAP_BIND_PASSWORD,
		userBaseDn: data.LDAP_USER_BASE_DN,
		userFilter: data.LDAP_USER_FILTER,
		loginAttribute: data.LDAP_LOGIN_ATTRIBUTE,
		idAttribute: data.LDAP_ID_ATTRIBUTE,
		emailAttribute: data.LDAP_EMAIL_ATTRIBUTE,
		nameAttribute: data.LDAP_NAME_ATTRIBUTE,
		groupBaseDn: data.LDAP_GROUP_BASE_DN ?? data.LDAP_USER_BASE_DN,
		groupFilter: data.LDAP_GROUP_FILTER,
		groupNameAttribute: data.LDAP_GROUP_NAME_ATTRIBUTE,
		groupMemberFilter: data.LDAP_GROUP_MEMBER_FILTER,
		syncSchedule: data.LDAP_SYNC_SCHEDULE.toLowerCase() === 'off' ? null : data.LDAP_SYNC_SCHEDULE,
		syncTimezone: data.LDAP_SYNC_TIMEZONE ?? null,
	}
}
```

and return `ldap` beside `smtp`. `z.url()` keeps the trimmed input (zod 4 "URLs"; `schemas.js:263-292` trims), so the stored URL is the one given.

- [ ] **Step 4: `lib/directory/config.ts`**

```ts
import 'server-only'

import { env, type LdapConfig } from '@/lib/env'

/** The `LDAP_*` block (spec §7.1), or null while LDAP is off: the login page, the sign-in and the sync ask here. */
export const directoryConfig = (): LdapConfig | null => env().ldap

export const isDirectoryConfigured = (): boolean => directoryConfig() !== null
```

- [ ] **Step 5: `.env.template`**

Rewrite the file's comments in English (the language rule; the values stay) and append the block, every optional key commented out with its default:

```bash
# Environment for the hub. Copy this file to .env and fill in the values.

# Database: MySQL (ADR-0004)
DATABASE_URL=mysql://username:password@host:port/database_name

# next-auth's secret (a long random string)
NEXTAUTH_SECRET=xxx

# SMTP, for the inherited password-reset mail
# true to turn mail on; every SMTP_* key below is then required
SMTP_ENABLED=false
SMTP_SERVER=smtp.example.com
# 465 for implicit TLS, 587 for STARTTLS
SMTP_PORT=465
SMTP_USERNAME=noreply@example.com
SMTP_PASSWORD=your-app-password
SMTP_USE_TLS=true
# Display name and address
MAIL_DEFAULT_SEND_FROM="Dify App Hub <noreply@example.com>"
# The hub's public URL, for the links in mails
APP_URL=https://your-domain.example.com

# Directory (LDAP) sign-in and sync, ADR-0029 and docs/ldap.md. Setting LDAP_URL turns it on; the five keys after it
# are then required. The defaults are Active Directory's.
# LDAP_URL=ldaps://dc.corp.example:636
# ldaps (with ldaps://), starttls or none (with ldap://); none sends passwords in clear
# LDAP_ENCRYPTION=ldaps
# LDAP_CA_FILE=/run/secrets/ldap-ca.pem
# LDAP_BIND_DN=CN=svc-hub,OU=Service Accounts,DC=corp,DC=example
# LDAP_BIND_PASSWORD=
# LDAP_USER_BASE_DN=DC=corp,DC=example
# LDAP_USER_FILTER=(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
# LDAP_LOGIN_ATTRIBUTE=sAMAccountName
# LDAP_ID_ATTRIBUTE=objectGUID
# LDAP_EMAIL_ATTRIBUTE=mail
# LDAP_NAME_ATTRIBUTE=displayName
# LDAP_GROUP_BASE_DN=
# LDAP_GROUP_FILTER=(objectClass=group)
# LDAP_GROUP_NAME_ATTRIBUTE=cn
# LDAP_GROUP_MEMBER_FILTER=(memberOf:1.2.840.113556.1.4.1941:={group_dn})
# A five-field cron expression, or off
# LDAP_SYNC_SCHEDULE=0 * * * *
# An IANA time zone; the server's zone otherwise (UTC in the image)
# LDAP_SYNC_TIMEZONE=
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run __tests__/env.test.ts __tests__/directory-config.test.ts` Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/env.ts lib/directory/config.ts __tests__/env.test.ts __tests__/directory-config.test.ts
pnpm exec oxfmt --write lib/env.ts lib/directory/config.ts __tests__/env.test.ts __tests__/directory-config.test.ts && pnpm exec oxfmt --check lib/env.ts lib/directory/config.ts __tests__/env.test.ts __tests__/directory-config.test.ts
pnpm test
grep -nP '\p{Han}' .env.template ; echo "han: $?"
git add package.json pnpm-lock.yaml lib/env.ts lib/directory/config.ts __tests__/env.test.ts __tests__/directory-config.test.ts .env.template
git commit -m "feat(env): parse the LDAP block and add ldapts and croner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

Expected: `han: 1` (grep found nothing).

---

### Task 3: The directory Data Access Layer for sign-in

Spec §6.1 (an actor-less DAL module guarded by its input), §6.3 step 7 (the sign-in transaction), §2 #10 and #11 (an email used by any account refuses a first sign-in; a refresh keeps the old email), §7.2 (no takeover, linking by key only). ADR-0027's B3b notes (the directory writes only its own marker and `directory` memberships). Review Focus: lines 2 and 5.

**Files:**

- Create: `lib/data/directory.ts`, `__tests__/data-directory-sign-in.test.ts`

**Interfaces:**

- Consumes: `users` (with `source`, `directoryId`, `directoryIdAttribute`, `directoryUsername`), `userGroupMembers`, `userGroupDirectoryLinks` from `@/db/schema` (Task 1); `isDuplicateEntry`, `isDeadlock` from `./db-errors` (Task 1).
- Produces, from `@/lib/data/directory`:
  - `interface DirectoryIdentity { key: string; idAttribute: string; username: string; email: string | null; name: string | null }`
  - `interface DirectorySignInAccount { id: string; email: string; name: string | null; role: Role; sessionVersion: number }`
  - `type DirectorySignInRefusal = 'account_inactive' | 'entry_without_email' | 'email_in_use'`
  - `type DirectorySignInResult = { ok: true; account: DirectorySignInAccount; emailConflict: boolean } | { ok: false; reason: DirectorySignInRefusal }`
  - `interface GroupLink { groupId: string; directoryGroupId: string; directoryGroupName: string; missingSince: Date | null }`
  - `listGroupLinks(): Promise<GroupLink[]>`
  - `recordDirectorySignIn(identity: DirectoryIdentity, groupIds: readonly string[]): Promise<DirectorySignInResult>`: `groupIds` are the hub groups whose links the person was found in (Task 6).
  - the builders `lockDirectoryAccount(tx, key)` and `replaceDirectoryMemberships(tx, userId, groupIds)` (exported for their tests and for Task 8).

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **e. One retry on 1062 or 1213.** Two first sign-ins of the same person at once both find no row; the locking read takes a gap lock in the unique index, so one insert waits or is rolled back as a deadlock victim (1213), or the unique index refuses the second (1062). The whole transaction runs once more and then finds the account the other wrote, or the email taken. MySQL 8.4 "How to Minimize and Handle Deadlocks": "Always be prepared to re-issue a transaction if it fails due to deadlock." B2's `createOwner` relies on the same locking read (ADR-0024 decision d).
- **f. The memberships a sign-in writes are exactly the groups it found** (spec §6.3 step 7): the person's `directory` rows in any other group, including a group whose last link was removed, are deleted; `manual` rows are never read or written (spec §2 #8).
- **g. A refresh overwrites the name with the entry's** (null when the entry has none), as LibreChat overwrites "provider, `ldapId`, email, username and name … on every login" (`LibreChat@e1dfc104:packages/api/src/auth/ldap.ts:31-35,85-89`) and Mattermost treats AD/LDAP attributes as authoritative (`mattermost/docs@bd09d959:source/administration-guide/onboard/ad-ldap.rst:111`); the email is overwritten only when no other account uses it (spec §2 #11), and an entry without an email keeps the old one (`users.email` stays `NOT NULL`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/data-directory-sign-in.test.ts`:

```ts
import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A transaction fake that records every call. Reads answer from a queue in call order (`reads`); writes are kept with
 * their table, values and condition, so a test renders them on drizzle.mock() (no connection). A read's result is a
 * thenable (MDN "Thenables") so the code may await `limit()` directly or call `for('update')` on it.
 */
const mocks = vi.hoisted(() => {
	type Write = {
		op: 'insert' | 'update' | 'delete'
		table: unknown
		values?: unknown
		condition?: unknown
	}
	const state = {
		reads: [] as unknown[][],
		strengths: [] as string[],
		conditions: [] as unknown[],
		writes: [] as Write[],
		failures: [] as unknown[],
		transactions: 0,
	}
	const read = () => {
		const result = () => Promise.resolve(state.reads.shift() ?? [])
		const query = {
			from: () => query,
			where: (condition: unknown) => {
				state.conditions.push(condition)
				return query
			},
			limit: () => query,
			for: (strength: string) => {
				state.strengths.push(strength)
				return result()
			},
			then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
				result().then(resolve, reject),
		}
		return query
	}
	const tx = {
		select: () => read(),
		insert: (table: unknown) => ({
			values: (values: unknown) => {
				state.writes.push({ op: 'insert', table, values })
				return Promise.resolve([{ affectedRows: 1 }])
			},
		}),
		update: (table: unknown) => ({
			set: (values: unknown) => ({
				where: (condition: unknown) => {
					state.writes.push({ op: 'update', table, values, condition })
					return Promise.resolve([{ affectedRows: 1 }])
				},
			}),
		}),
		delete: (table: unknown) => ({
			where: (condition: unknown) => {
				state.writes.push({ op: 'delete', table, condition })
				return Promise.resolve([{ affectedRows: 0 }])
			},
		}),
	}
	const db = {
		select: () => read(),
		transaction: async (work: (t: typeof tx) => Promise<unknown>) => {
			state.transactions += 1
			const failure = state.failures.shift()
			if (failure) throw failure
			return work(tx)
		},
	}
	return { state, db, tx }
})
vi.mock('@/db', () => ({ getDb: () => mocks.db }))

import { userGroupMembers, users } from '@/db/schema'
import {
	lockDirectoryAccount,
	recordDirectorySignIn,
	replaceDirectoryMemberships,
} from '@/lib/data/directory'

const identity = {
	key: '90395fb9-9ab5-1b4a-9e96-86c66cb18d99',
	idAttribute: 'objectGUID',
	username: 'alice',
	email: 'alice@example.com',
	name: 'Alice Admin',
}
const known = {
	id: 'u1',
	email: 'alice@example.com',
	role: 'admin' as const,
	sessionVersion: 4,
	adminDeactivatedAt: null as Date | null,
}

const renderUpdate = (values: unknown, condition: unknown) =>
	drizzle
		.mock()
		.update(users)
		.set(values as Record<string, unknown>)
		.where(condition as SQL)
		.toSQL()
const renderDelete = (condition: unknown) =>
	drizzle
		.mock()
		.delete(userGroupMembers)
		.where(condition as SQL)
		.toSQL()
const renderSelect = (condition: unknown) =>
	drizzle
		.mock()
		.select({ id: users.id })
		.from(users)
		.where(condition as SQL)
		.toSQL()

beforeEach(() => {
	Object.assign(mocks.state, {
		reads: [],
		strengths: [],
		conditions: [],
		writes: [],
		failures: [],
		transactions: 0,
	})
})

describe('lockDirectoryAccount (decision d)', () => {
	it('is a locking read of the ldap account by its directory key', () => {
		const query = lockDirectoryAccount(drizzle.mock(), identity.key).toSQL()
		expect(query.sql).toMatch(
			/ from `users` where \(`users`\.`source` = \? and `users`\.`directory_id` = \?\) limit \? for update$/,
		)
		expect(query.params).toEqual(['ldap', identity.key, 1])
		// The admin marker is read under the lock: the directory never lifts it (ADR-0027).
		expect(query.sql).toContain('`admin_deactivated_at`')
	})
})

describe('replaceDirectoryMemberships (decision f, spec §2 #8)', () => {
	it('deletes the directory rows outside the found groups, then adds the missing ones; manual rows untouched', async () => {
		mocks.state.reads = [[{ groupId: 'g1' }]]
		await replaceDirectoryMemberships(mocks.tx as never, 'u1', ['g1', 'g2', 'g2'])
		const [deleted, inserted] = mocks.state.writes
		const { sql, params } = renderDelete(deleted.condition)
		expect(sql).toMatch(
			/where \(`user_group_members`\.`user_id` = \? and `user_group_members`\.`source` = \? and `user_group_members`\.`group_id` not in \(\?, \?\)\)$/,
		)
		expect(params).toEqual(['u1', 'directory', 'g1', 'g2'])
		expect(mocks.state.strengths).toEqual(['update'])
		expect(inserted).toMatchObject({
			op: 'insert',
			values: [{ groupId: 'g2', userId: 'u1', source: 'directory' }],
		})
	})

	it('deletes every directory row of the account when it was found in no linked group', async () => {
		await replaceDirectoryMemberships(mocks.tx as never, 'u1', [])
		const { sql, params } = renderDelete(mocks.state.writes[0].condition)
		expect(sql).toMatch(
			/where \(`user_group_members`\.`user_id` = \? and `user_group_members`\.`source` = \?\)$/,
		)
		expect(params).toEqual(['u1', 'directory'])
		expect(mocks.state.writes).toHaveLength(1)
	})
})

describe('recordDirectorySignIn (spec §6.3 step 7)', () => {
	it('refreshes a known account, clears the directory marker and answers its role and session version', async () => {
		// The lock finds the account; the email differs only by case, so the email check finds the account itself
		// (the collation compares without case) and there is no conflict; then the membership read under the lock.
		mocks.state.reads = [[known], [{ id: 'u1' }], []]
		const result = await recordDirectorySignIn({ ...identity, email: 'Alice@Example.com' }, ['g1'])
		expect(result).toEqual({
			ok: true,
			account: {
				id: 'u1',
				email: 'Alice@Example.com',
				name: 'Alice Admin',
				role: 'admin',
				sessionVersion: 4,
			},
			emailConflict: false,
		})
		const update = mocks.state.writes.find(write => write.op === 'update')!
		expect(update.values).toEqual({
			name: 'Alice Admin',
			email: 'Alice@Example.com',
			directoryUsername: 'alice',
			directoryDeactivatedAt: null,
		})
		const { sql, params } = renderUpdate(update.values, update.condition)
		expect(sql).toMatch(/ where `users`\.`id` = \?$/)
		expect(params.at(-1)).toBe('u1')
		// Never the admin marker, the role, the password or the session version (ADR-0027).
		expect(sql).not.toMatch(/admin_deactivated|`role`|`password`|session_version/)
	})

	it('refuses an account an admin deactivated, and writes nothing', async () => {
		mocks.state.reads = [[{ ...known, adminDeactivatedAt: new Date() }]]
		expect(await recordDirectorySignIn(identity, ['g1'])).toEqual({
			ok: false,
			reason: 'account_inactive',
		})
		expect(mocks.state.writes).toEqual([])
	})

	it('keeps the old email when another account uses the new one, and reports the conflict', async () => {
		mocks.state.reads = [[known], [{ id: 'u7' }], []]
		const result = await recordDirectorySignIn({ ...identity, email: 'taken@example.com' }, [])
		expect(result).toMatchObject({ ok: true, emailConflict: true, account: { email: known.email } })
		const update = mocks.state.writes.find(write => write.op === 'update')!
		expect(update.values).toMatchObject({ email: known.email })
	})

	it('keeps the old email when the entry has none', async () => {
		mocks.state.reads = [[known], []]
		const result = await recordDirectorySignIn({ ...identity, email: null }, [])
		expect(result).toMatchObject({
			ok: true,
			emailConflict: false,
			account: { email: known.email },
		})
	})

	it('creates a new ldap account with no password, the user role, the key and its attribute', async () => {
		mocks.state.reads = [[], [], []]
		const result = await recordDirectorySignIn(identity, ['g1'])
		expect(result).toMatchObject({
			ok: true,
			account: { email: identity.email, name: identity.name, role: 'user', sessionVersion: 0 },
		})
		const insert = mocks.state.writes.find(write => write.op === 'insert' && write.table === users)!
		expect(insert.values).toEqual({
			id: expect.any(String),
			name: identity.name,
			email: identity.email,
			password: null,
			source: 'ldap',
			role: 'user',
			directoryId: identity.key,
			directoryIdAttribute: 'objectGUID',
			directoryUsername: 'alice',
		})
		expect(result.ok && result.account.id).toBe((insert.values as { id: string }).id)
		expect(mocks.state.writes.some(write => write.table === userGroupMembers)).toBe(true)
	})

	it('refuses a new entry without an email, and one whose email any account uses (spec §2 #10, #11)', async () => {
		mocks.state.reads = [[]]
		expect(await recordDirectorySignIn({ ...identity, email: null }, [])).toEqual({
			ok: false,
			reason: 'entry_without_email',
		})
		mocks.state.reads = [[], [{ id: 'local-1' }]]
		expect(await recordDirectorySignIn(identity, [])).toEqual({
			ok: false,
			reason: 'email_in_use',
		})
		expect(mocks.state.writes).toEqual([])
		// The email check compares as the unique index does: by the column's collation, in SQL.
		const { sql, params } = renderSelect(mocks.state.conditions.at(-1))
		expect(sql).toMatch(/ where `users`\.`email` = \?$/)
		expect(params).toEqual([identity.email])
	})

	it('runs the transaction once more after a duplicate key or a deadlock (decision e), not a third time', async () => {
		const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 })
		const deadlock = Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 })
		mocks.state.failures = [duplicate]
		mocks.state.reads = [[known], []]
		expect(await recordDirectorySignIn({ ...identity, email: known.email }, [])).toMatchObject({
			ok: true,
		})
		expect(mocks.state.transactions).toBe(2)

		mocks.state.transactions = 0
		mocks.state.failures = [deadlock, deadlock]
		await expect(recordDirectorySignIn(identity, [])).rejects.toBe(deadlock)
		expect(mocks.state.transactions).toBe(2)
	})

	it('propagates any other failure without a retry', async () => {
		const other = Object.assign(new Error('gone'), { code: 'PROTOCOL_CONNECTION_LOST' })
		mocks.state.failures = [other]
		await expect(recordDirectorySignIn(identity, [])).rejects.toBe(other)
		expect(mocks.state.transactions).toBe(1)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/data-directory-sign-in.test.ts` Expected: FAIL; `@/lib/data/directory` does not exist.

- [ ] **Step 3: Write the module**

Create `lib/data/directory.ts`:

```ts
import 'server-only'

import { and, eq, notInArray } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { userGroupDirectoryLinks, userGroupMembers, users } from '@/db/schema'
import type { Role } from '@/lib/auth/roles'

import { isDeadlock, isDuplicateEntry } from './db-errors'

/*
 * The directory Data Access Layer (B3 spec §6.1, ADR-0029). It takes no actor: its callers are the `ldap` provider,
 * before any session exists, and the directory sync, which acts for no person. It is the second actor-less module after
 * lib/data/setup.ts (ADR-0024 deviation 2), and its guard is its input: every function takes values read from a
 * successful directory bind or from a complete, error-free directory search, never raw form input. It writes only what
 * the directory owns (ADR-0027): `directory_deactivated_at`, the directory fields of `ldap` accounts, and `directory`
 * memberships; never the admin marker, a role, a password or a `manual` membership.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** A directory entry as the sign-in read it once the person's own bind succeeded (spec §6.3 steps 3–6). */
export interface DirectoryIdentity {
	/** The canonical key (lib/directory/keys.ts): the account's only link to the entry (ADR-0026). */
	key: string
	/** The attribute that produced the key (LDAP_ID_ATTRIBUTE). */
	idAttribute: string
	/** The login attribute's value. */
	username: string
	email: string | null
	name: string | null
}

/** The account the `ldap` provider hands next-auth, as the local provider does (spec §6.3 step 8). */
export interface DirectorySignInAccount {
	id: string
	email: string
	name: string | null
	role: Role
	sessionVersion: number
}

export type DirectorySignInRefusal = 'account_inactive' | 'entry_without_email' | 'email_in_use'

export type DirectorySignInResult =
	| { ok: true; account: DirectorySignInAccount; emailConflict: boolean }
	| { ok: false; reason: DirectorySignInRefusal }

export interface GroupLink {
	groupId: string
	directoryGroupId: string
	directoryGroupName: string
	missingSince: Date | null
}

/** Every hub group's directory links (spec §6.5): the sign-in checks the person against each. */
export const listGroupLinks = (): Promise<GroupLink[]> =>
	getDb()
		.select({
			groupId: userGroupDirectoryLinks.groupId,
			directoryGroupId: userGroupDirectoryLinks.directoryGroupId,
			directoryGroupName: userGroupDirectoryLinks.directoryGroupName,
			missingSince: userGroupDirectoryLinks.missingSince,
		})
		.from(userGroupDirectoryLinks)

/**
 * A locking read of the directory account with this key (ADR-0024 decision d; MySQL 8.4 "Locking Reads"). When no row
 * exists it locks the gap in the unique index, so a second first sign-in of the same person waits, or is rolled back as
 * a deadlock victim, instead of inserting a second account (decision e).
 */
export const lockDirectoryAccount = (tx: Pick<Tx, 'select'>, key: string) =>
	tx
		.select({
			id: users.id,
			email: users.email,
			role: users.role,
			sessionVersion: users.sessionVersion,
			adminDeactivatedAt: users.adminDeactivatedAt,
		})
		.from(users)
		.where(and(eq(users.source, 'ldap'), eq(users.directoryId, key)))
		.limit(1)
		.for('update')

/** The account using this email, compared in SQL as the unique index compares it (the column's collation). */
const emailTakenBy = (tx: Pick<Tx, 'select'>, email: string) =>
	tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

/**
 * Sets the account's directory memberships to exactly these hub groups (decision f; spec §6.3 step 7). Its directory
 * rows anywhere else go, including a group whose links were removed; manual rows are never read or written (spec §2
 * #8). The remaining rows are read with a locking read before the insert (MySQL 8.4 "Locking Reads").
 */
export async function replaceDirectoryMemberships(
	tx: Pick<Tx, 'select' | 'insert' | 'delete'>,
	userId: string,
	groupIds: readonly string[],
): Promise<void> {
	const wanted = [...new Set(groupIds)]
	const ofThisAccount = and(
		eq(userGroupMembers.userId, userId),
		eq(userGroupMembers.source, 'directory'),
	)
	await tx
		.delete(userGroupMembers)
		.where(
			and(
				eq(userGroupMembers.userId, userId),
				eq(userGroupMembers.source, 'directory'),
				wanted.length ? notInArray(userGroupMembers.groupId, wanted) : undefined,
			),
		)
	if (!wanted.length) return
	const kept = await tx
		.select({ groupId: userGroupMembers.groupId })
		.from(userGroupMembers)
		.where(ofThisAccount)
		.for('update')
	const have = new Set(kept.map(row => row.groupId))
	const add = wanted.filter(groupId => !have.has(groupId))
	if (add.length)
		await tx
			.insert(userGroupMembers)
			.values(add.map(groupId => ({ groupId, userId, source: 'directory' as const })))
}

async function signInWithin(
	tx: Tx,
	identity: DirectoryIdentity,
	groupIds: readonly string[],
): Promise<DirectorySignInResult> {
	const [known] = await lockDirectoryAccount(tx, identity.key)
	if (known) {
		// ADR-0027: the admin's marker is the admin's to clear; the directory never lifts it.
		if (known.adminDeactivatedAt !== null) return { ok: false, reason: 'account_inactive' }
		const [taken] =
			identity.email && identity.email !== known.email ? await emailTakenBy(tx, identity.email) : []
		const emailConflict = taken !== undefined && taken.id !== known.id
		const email = identity.email && !emailConflict ? identity.email : known.email
		await tx
			.update(users)
			.set({
				name: identity.name,
				email,
				directoryUsername: identity.username,
				// The entry matched the user filter at this sign-in: the directory's own marker lifts (spec §2 #12).
				directoryDeactivatedAt: null,
			})
			.where(eq(users.id, known.id))
		await replaceDirectoryMemberships(tx, known.id, groupIds)
		return {
			ok: true,
			account: {
				id: known.id,
				email,
				name: identity.name,
				role: known.role,
				sessionVersion: known.sessionVersion,
			},
			emailConflict,
		}
	}
	if (!identity.email) return { ok: false, reason: 'entry_without_email' }
	// Spec §2 #10, §7.2: an email any account uses refuses the first sign-in; nothing links by email.
	const [taken] = await emailTakenBy(tx, identity.email)
	if (taken) return { ok: false, reason: 'email_in_use' }
	const id = crypto.randomUUID()
	await tx.insert(users).values({
		id,
		name: identity.name,
		email: identity.email,
		password: null,
		source: 'ldap',
		role: 'user',
		directoryId: identity.key,
		directoryIdAttribute: identity.idAttribute,
		directoryUsername: identity.username,
	})
	await replaceDirectoryMemberships(tx, id, groupIds)
	return {
		ok: true,
		account: { id, email: identity.email, name: identity.name, role: 'user', sessionVersion: 0 },
		emailConflict: false,
	}
}

/**
 * The sign-in's write (spec §6.3 step 7), in one transaction with a locking read of the account by its key: a known
 * account is refreshed (or refused while an admin has deactivated it); a new one is created as a `user` with no
 * password, unless the entry has no email or any account uses it. Run once more after a duplicate key or a deadlock
 * (decision e); any other failure propagates to the provider, which logs it and answers its generic error.
 */
export async function recordDirectorySignIn(
	identity: DirectoryIdentity,
	groupIds: readonly string[],
): Promise<DirectorySignInResult> {
	const attempt = () => getDb().transaction(tx => signInWithin(tx, identity, groupIds))
	try {
		return await attempt()
	} catch (error) {
		if (isDuplicateEntry(error) || isDeadlock(error)) return attempt()
		throw error
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run __tests__/data-directory-sign-in.test.ts` Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/directory.ts __tests__/data-directory-sign-in.test.ts
pnpm exec oxfmt --write lib/data/directory.ts __tests__/data-directory-sign-in.test.ts && pnpm exec oxfmt --check lib/data/directory.ts __tests__/data-directory-sign-in.test.ts
pnpm test
git add lib/data/directory.ts __tests__/data-directory-sign-in.test.ts
git commit -m "feat(directory): add the sign-in write of the directory DAL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 4: The LDAP test servers and the `pnpm test:ldap` suite

Spec §8 "Directory integration suite" (a separate Vitest project running `lib/directory/` and the sync against `smblds/smblds` over LDAPS and OpenLDAP 2.6 over StartTLS and plain; both images pinned by digest, under a Compose profile `ldap`, seeded at start, with a `mem_limit` after one measurement), §14 (memory, certificates, nested groups on OpenLDAP). ADR-0010 (the e2e harness). The setup is the research's §7 (`docs/superpowers/research/2026-10-09-backend-b3/b3b-plan/ldap-test-servers.md`), as the pre-flight ran it.

**Files:**

- Create: `e2e/fixtures/ldap/tls/{generate.sh,ca.crt,server.crt,server.key}`, `e2e/fixtures/ldap/ad/entrypoint.d/{10-tls.sh,20-seed.sh}`, `e2e/fixtures/ldap/openldap/config/{62-e2e-limits.ldif,170-e2e-nestgroup.ldif}`, `e2e/fixtures/ldap/openldap/data/{70-e2e-tree.ldif,80-e2e-people.ldif,90-e2e-groups.ldif}`, `.gitattributes`, `__tests__/ldap/global-setup.ts`, `__tests__/ldap/servers.ts`, `__tests__/ldap/servers.ldap.test.ts`
- Modify: `docker-compose.e2e.yml`, `vitest.config.ts`, `package.json` (scripts)

**Interfaces:**

- Consumes: `ldapts` (Task 2), `LdapConfig` (Task 2).
- Produces:
  - the Compose services `ldap-ad` (smblds; LDAPS on `127.0.0.1:10636`, StartTLS on `127.0.0.1:10389`) and `ldap-openldap` (osixia OpenLDAP 2.6.15; plain and StartTLS on `127.0.0.1:13890`, LDAPS on `127.0.0.1:16360`), profile `ldap`, started by name;
  - the test CA `e2e/fixtures/ldap/tls/ca.crt` (the `LDAP_CA_FILE` of every test configuration);
  - from `__tests__/ldap/servers.ts`: `PASSWORD` (every seeded person's), `adLdaps`, `adStartTls`, `adPlain`, `openldapStartTls`, `openldapPlain` (each an `LdapConfig`), `TEST_DIRECTORIES` (`{ name, config, people: { alice, bob, carol, dave, erin, frank }, groups: { admins, engineering, backend, rnd }, emailDomain, emptyBaseDn }` for the three working modes), and `rawClient(config)` (a bare ldapts client for the suite's own checks);
  - the scripts `pnpm test` (`vitest run --project unit`) and `pnpm test:ldap` (`vitest run --project ldap --no-file-parallelism`).

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029, and in a dated note on ADR-0010):

- **h. One committed test CA and server certificate**, with a regeneration script that uses the openssl CLI and throws the CA key away, as python-ldap commits its slapd test certificates for `localhost`, `127.0.0.1` and `::1` (`python-ldap@b47ed474:Lib/slapdtest/certs/README`, `gencerts.sh` ends `rm -rf $CATMPDIR ca.key`) and Node.js core commits its test keys with a Makefile (`nodejs/node@ae5a0f40:test/fixtures/keys/Makefile:189,196`). The files are `.crt` and `.key`, since the root `.gitignore` ignores `*.pem`; `.dockerignore` keeps `e2e/` out of the image. Generating at test time (ldapts' CI uses node-forge) would add a devDependency and drift from a reused container (`ldap-test-servers.md` §1.2). GitHub's default push protection does not cover generic private-key patterns, and this repository has them off (`secret_scanning_non_provider_patterns: disabled`, read 2026-10-10).
- **i. Both servers are started by name**, not by enabling the profile (Docker docs, "Using profiles with Compose": "When you explicitly target a service on the command line that has one or more profiles assigned, you do not need to enable the profile manually"), so a plain `docker compose -f docker-compose.e2e.yml up` still starts MySQL alone; Playwright starts `ldap-ad` only (Task 8), `pnpm test:ldap` both.
- **j. A separate Vitest project, filtered by the CLI**: one config with a `unit` and an `ldap` project (`extends: true`), `pnpm test` runs `--project unit` and `pnpm test:ldap` `--project ldap --no-file-parallelism` (Vitest docs, "Test Projects" and the CLI's `--project`; the test files share the two servers). Homarr does the same (`homarr@ad15cfc3:package.json:302,304`: `vitest run --project "!integration"` and `--project integration`), and Directus gives its Docker-backed project its own `globalSetup`, `hookTimeout` and `testTimeout` (`directus@8e140f94:packages/memory/vitest.config.ts:10-33`).
- **k. Real health checks.** smblds' built-in check exits 0 before Samba runs (`smblds-container@84fe79e6:healthcheck.sh`), so both services check a TLS bind as the seeded service account with the committed CA (`ldapwhoami`, `LDAPTLS_REQCERT=demand`): the listener is up, our certificate is served, the seed ran.
- **l. OpenLDAP's seed carries `memberOf` itself**: osixia loads its data with `slapadd`, which goes past every overlay (`openldap@f46b74e7:servers/slapd/backover.c:1375-1425`), and the OpenLDAP Admin Guide names slapadd for bulk loads of "entries known to be valid". Paging is forced on the service account with `size.soft=5 size.hard=5 size.prtotal=unlimited` (Admin Guide §9.3.1.2), never `size.pr`, which OpenLDAP enforces by refusing a larger page (`servers/slapd/limits.c:1168-1177`) where AD caps it.

- [ ] **Step 1: The certificates**

Create `e2e/fixtures/ldap/tls/generate.sh` (mode 755):

```sh
#!/bin/sh
# Regenerates the e2e and test:ldap TLS fixtures: a test CA (its key is discarded, as python-ldap's
# Lib/slapdtest/certs/gencerts.sh does) and one server certificate for both test directories (ADR-0029 decision h).
# Test-only: .dockerignore keeps e2e/ out of the image. Needs the openssl CLI (3.0 or later).
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = dify-app-hub e2e LDAP test CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF

cat >"$tmp/server.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
EOF

cat >"$tmp/server.ext" <<'EOF'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1,DNS:ldap-ad,DNS:ldap-openldap
EOF

openssl req -x509 -config "$tmp/ca.cnf" -newkey rsa:2048 -noenc -sha256 -days 36500 \
  -keyout "$tmp/ca.key" -out ca.crt
openssl req -new -config "$tmp/server.cnf" -newkey rsa:2048 -noenc -sha256 \
  -keyout server.key -out "$tmp/server.csr"
openssl x509 -req -in "$tmp/server.csr" -CA ca.crt -CAkey "$tmp/ca.key" -set_serial 2 \
  -days 36500 -sha256 -extfile "$tmp/server.ext" -out server.crt
# 0644 on purpose: osixia's slapd runs as uid 911 and must read the key; the Samba seed copies it in at 0600 root.
chmod 0644 ca.crt server.crt server.key
openssl verify -CAfile ca.crt -verify_hostname localhost server.crt
openssl verify -CAfile ca.crt -verify_ip 127.0.0.1 server.crt
```

Run it:

```bash
chmod +x e2e/fixtures/ldap/tls/generate.sh && sh e2e/fixtures/ldap/tls/generate.sh
openssl x509 -in e2e/fixtures/ldap/tls/server.crt -noout -ext subjectAltName
git check-ignore -v e2e/fixtures/ldap/tls/server.key ; echo "ignored: $?"
```

Expected: both `openssl verify` lines print `server.crt: OK`; the SAN lists `localhost`, `127.0.0.1`, `::1`, `ldap-ad`, `ldap-openldap`; `ignored: 1` (not ignored).

Create `.gitattributes`:

```
# The LDAP test fixtures run inside Linux containers: keep them LF on any checkout.
*.sh text eol=lf
*.ldif text eol=lf
```

- [ ] **Step 2: The Samba scripts**

Create `e2e/fixtures/ldap/ad/entrypoint.d/10-tls.sh`:

```sh
#!/bin/sh
# smblds runs every executable /entrypoint.d/* on every start, after provisioning and before samba starts.
# Samba refuses a TLS key not owned by its euid with mode exactly 0600 (CVE-2013-4476 check in
# source4/lib/tls/tls_tstream.c), so the key is copied in, never bind-mounted at the target path.
set -eu
tls_dir=/var/lib/samba/private/tls
mkdir -p "$tls_dir"
install -m 0600 -o root -g root /e2e-tls/server.key "$tls_dir/e2e-key.pem"
install -m 0644 -o root -g root /e2e-tls/server.crt "$tls_dir/e2e-cert.pem"
install -m 0644 -o root -g root /e2e-tls/ca.crt "$tls_dir/e2e-ca.pem"
# Same sed construct as the image's entrypoint.sh; guarded because this script runs on every start (issue #27).
if ! grep -q 'tls certfile = tls/e2e-cert.pem' /etc/samba/smb.conf; then
  sed -e '/^\[global\]/a\\ttls enabled = yes\n\ttls keyfile = tls/e2e-key.pem\n\ttls certfile = tls/e2e-cert.pem\n\ttls cafile = tls/e2e-ca.pem' \
      -i /etc/samba/smb.conf
fi
# Optional memory saver to compare in the pre-flight (smb.conf(5) "prefork children", default 4):
# grep -q 'prefork children' /etc/samba/smb.conf || sed -e '/^\[global\]/a\\tprefork children = 1' -i /etc/samba/smb.conf
```

Create `e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh`:

```sh
#!/bin/sh
# Seeds the AD-like test directory offline (samba-tool on the local sam.ldb; samba is not running yet).
# DNs: CN=<Given Surname>,CN=Users,DC=e2e,DC=hub,DC=test (svc-hub: CN=svc-hub,…).
set -eu
marker=/var/lib/samba/.e2e-seeded
[ -f "$marker" ] && exit 0
pw='E2e-Dir-Passw0rd'

samba-tool user add svc-hub 'E2e-Svc-Passw0rd' --description='dify-app-hub read-only service account'
samba-tool user add alice "$pw" --given-name=Alice --surname=Admin --mail-address=alice@e2e.hub.test
samba-tool user add bob "$pw" --given-name=Bob --surname=Builder --mail-address=bob@e2e.hub.test
samba-tool user add carol "$pw" --given-name=Carol --surname=Gone --mail-address=carol@e2e.hub.test
samba-tool user disable carol                                   # userAccountControl bit 2
samba-tool user add dave "$pw" --given-name=Dave --surname=Nomail # no mail: refused at first sign-in
samba-tool user add erin "$pw" --given-name=Erin --surname=Rename --mail-address=erin@e2e.hub.test # rename test
samba-tool user add frank "$pw" --given-name=Frank --surname=Smith --mail-address=frank@e2e.hub.test
samba-tool user rename frank --force-new-cn='Smith\, Frank'     # DN CN=Smith\, Frank,CN=Users,…

samba-tool group add hub-admins
samba-tool group add hub-engineering
samba-tool group add hub-backend
samba-tool group add rnd-team
samba-tool group rename rnd-team --force-new-cn='R&D (Berlin)\, Team' # ( ) \ in a filter value: RFC 4515 escaping
samba-tool group addmembers hub-admins alice
samba-tool group addmembers hub-engineering hub-backend         # nesting: in-chain rule 1.2.840.113556.1.4.1941
samba-tool group addmembers hub-backend bob
samba-tool group addmembers rnd-team frank

touch "$marker"
```

Then:

```bash
chmod +x e2e/fixtures/ldap/ad/entrypoint.d/*.sh
```

smblds runs only executable files in `/entrypoint.d` ("Ignoring …, not executable", `entrypoint.sh:115-125`); git keeps the mode (`git ls-files -s` shows `100755` after the commit).

- [ ] **Step 3: The OpenLDAP LDIF**

Ten people, nine of them matching `(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))` (more than the service account's limit of five), `carol` locked, `dave` without mail; four groups under `ou=groups` (at most five, so the hub's group search still answers under the limit); `memberOf` written beside every `member` (decision l).

Create `e2e/fixtures/ldap/openldap/config/62-e2e-limits.ldif`:

```ldif
olcLimits: dn.exact="cn=svc-hub,dc=openldap,dc=hub,dc=test" size.soft=5 size.hard=5 size.prtotal=unlimited
```

Create `e2e/fixtures/ldap/openldap/config/170-e2e-nestgroup.ldif`:

```ldif
dn: olcOverlay=nestgroup,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcNestGroupConfig
olcOverlay: nestgroup
olcNestGroupBase: ou=groups,dc=openldap,dc=hub,dc=test
olcNestGroupFlags: memberof-filter
```

Create `e2e/fixtures/ldap/openldap/data/70-e2e-tree.ldif`:

```ldif
dn: ou=people,dc=openldap,dc=hub,dc=test
objectClass: organizationalUnit
ou: people

dn: ou=groups,dc=openldap,dc=hub,dc=test
objectClass: organizationalUnit
ou: groups
```

Create `e2e/fixtures/ldap/openldap/data/80-e2e-people.ldif`:

```ldif
dn: uid=alice,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: alice
cn: Alice Admin
givenName: Alice
sn: Admin
displayName: Alice Admin
mail: alice@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
memberOf: cn=hub-admins,ou=groups,dc=openldap,dc=hub,dc=test

dn: uid=bob,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: bob
cn: Bob Builder
givenName: Bob
sn: Builder
displayName: Bob Builder
mail: bob@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
memberOf: cn=hub-backend,ou=groups,dc=openldap,dc=hub,dc=test

dn: uid=carol,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: carol
cn: Carol Gone
sn: Gone
displayName: Carol Gone
mail: carol@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
pwdAccountLockedTime: 000001010000Z

dn: uid=dave,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: dave
cn: Dave Nomail
sn: Nomail
displayName: Dave Nomail
userPassword: E2e-Dir-Passw0rd

dn: uid=erin,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: erin
cn: Erin Rename
sn: Rename
displayName: Erin Rename
mail: erin@openldap.hub.test
userPassword: E2e-Dir-Passw0rd

dn: uid=frank,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: frank
cn: Smith, Frank
sn: Smith
displayName: Smith, Frank
mail: frank@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
memberOf: cn=R&D (Berlin)\, Team,ou=groups,dc=openldap,dc=hub,dc=test

dn: uid=user01,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user01
cn: User 01
sn: 01
mail: user01@openldap.hub.test

dn: uid=user02,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user02
cn: User 02
sn: 02
mail: user02@openldap.hub.test

dn: uid=user03,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user03
cn: User 03
sn: 03
mail: user03@openldap.hub.test

dn: uid=user04,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user04
cn: User 04
sn: 04
mail: user04@openldap.hub.test
```

Create `e2e/fixtures/ldap/openldap/data/90-e2e-groups.ldif`:

```ldif
dn: cn=hub-admins,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: hub-admins
member: uid=alice,ou=people,dc=openldap,dc=hub,dc=test

dn: cn=hub-engineering,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: hub-engineering
member: cn=hub-backend,ou=groups,dc=openldap,dc=hub,dc=test

dn: cn=hub-backend,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: hub-backend
member: uid=bob,ou=people,dc=openldap,dc=hub,dc=test
memberOf: cn=hub-engineering,ou=groups,dc=openldap,dc=hub,dc=test

dn: cn=R&D (Berlin)\, Team,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: R&D (Berlin), Team
member: uid=frank,ou=people,dc=openldap,dc=hub,dc=test
```

- [ ] **Step 4: The Compose services**

Append the two services to `docker-compose.e2e.yml`, under `services:` (the `mem_limit` values are the starting guesses of `ldap-test-servers.md` §6; the pre-flight's one measurement replaces them in this plan, at about twice the peak):

```yaml
# B3b test directories (ADR-0010 harness; spec §8). Not started by a plain `up`: the e2e and test:ldap
# global setups target them by name. Reset: docker compose -f docker-compose.e2e.yml down -v ldap-ad ldap-openldap
ldap-ad:
  # Samba AD LDAP for developers/CI; rebuilt daily from alpine:latest, so bump the digest on purpose.
  image: smblds/smblds:latest@sha256:b4eeb4e723a3b3284101b950f9ab8c0e36665303ce962e86ef0b4e83f7677641
  container_name: dify-app-hub-e2e-ldap-ad
  profiles: [ldap]
  hostname: dc
  environment:
    REALM: E2E.HUB.TEST
    DOMAIN: E2EHUB
    ADMINPASS: E2e-Adm-Passw0rd
    SERVER_SERVICES: ldap
    TZ: UTC
  ports:
    - '127.0.0.1:10636:636' # LDAPS
    - '127.0.0.1:10389:389' # StartTLS; plain simple binds refused (ldap server require strong auth = yes)
  volumes:
    - ./e2e/fixtures/ldap/ad/entrypoint.d:/entrypoint.d:ro
    - ./e2e/fixtures/ldap/tls:/e2e-tls:ro
  tmpfs: # the image's VOLUME paths; fresh domain per container, nothing left behind (fallback: drop and use down -v)
    - /etc/samba:mode=0755
    - /var/lib/samba:mode=0755
    - /var/cache/samba:mode=0755
    - /var/log/samba:mode=0755
    - /root:mode=0700
    - /etc/dropbear:mode=0700
  mem_limit: 512m # placeholder until the pre-flight measures it
  healthcheck:
    test:
      - CMD
      - env
      - LDAPTLS_CACERT=/e2e-tls/ca.crt
      - LDAPTLS_REQCERT=demand
      - /usr/bin/ldapwhoami
      - -x
      - -H
      - ldaps://localhost
      - -D
      - CN=svc-hub,CN=Users,DC=e2e,DC=hub,DC=test
      - -w
      - E2e-Svc-Passw0rd
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 180s
    start_interval: 2s

ldap-openldap:
  # OpenLDAP 2.6.15 (osixia v2 alpha); bootstrap on an empty container (no VOLUME), data loaded by slapadd.
  image: osixia/openldap:2.6.15-alpha@sha256:de37b295c8f11f6654a2376f7b5f9d5e9d028bd2f50713751f99ed270f7abbec
  container_name: dify-app-hub-e2e-ldap-openldap
  profiles: [ldap]
  hostname: ldap-openldap
  environment:
    OPENLDAP_BOOTSTRAP_ORGANIZATION: E2E Hub
    OPENLDAP_BOOTSTRAP_SUFFIX: dc=openldap,dc=hub,dc=test
    OPENLDAP_BOOTSTRAP_CONFIG_ROOT_PASSWORD_HASHED: E2e-Cfg-Passw0rd # used verbatim; plain is allowed (slapd-config(5) olcRootPW)
    OPENLDAP_BOOTSTRAP_DATA_ROOT_PASSWORD_HASHED: E2e-Adm-Passw0rd
    OPENLDAP_BOOTSTRAP_DATA_READONLY: 'true'
    OPENLDAP_BOOTSTRAP_DATA_READONLY_DN: cn=svc-hub,dc=openldap,dc=hub,dc=test
    OPENLDAP_BOOTSTRAP_DATA_READONLY_PASSWORD_HASHED: E2e-Svc-Passw0rd
    OPENLDAP_BOOTSTRAP_MODULES: back_mdb.so argon2.so refint.so ppolicy.so unique.so memberof.so syncprov.so nestgroup.so
    OPENLDAP_BOOTSTRAP_MEMBEROF: 'true'
    OPENLDAP_BOOTSTRAP_PPOLICY: 'true'
    OPENLDAP_BOOTSTRAP_PPOLICY_DEFAULT_MAX_FAILURE: '0' # no lockout from wrong-password tests; pwdLockout stays TRUE
    OPENLDAP_BOOTSTRAP_TLS: 'true'
    OPENLDAP_BOOTSTRAP_TLS_CERT: /e2e-tls/server.crt
    OPENLDAP_BOOTSTRAP_TLS_CERT_KEY: /e2e-tls/server.key
    OPENLDAP_BOOTSTRAP_TLS_CA_CERT: /e2e-tls/ca.crt
    OPENLDAP_NOFILE: '1024'
  ports:
    - '127.0.0.1:13890:3890' # plain (none) and StartTLS
    - '127.0.0.1:16360:6360' # LDAPS
  volumes:
    - ./e2e/fixtures/ldap/tls:/e2e-tls:ro
    - ./e2e/fixtures/ldap/openldap/config/62-e2e-limits.ldif:/container/services/openldap-bootstrap/assets/ldif/config/custom/62-e2e-limits.ldif:ro
    - ./e2e/fixtures/ldap/openldap/config/170-e2e-nestgroup.ldif:/container/services/openldap-bootstrap/assets/ldif/config/custom/170-e2e-nestgroup.ldif:ro
    - ./e2e/fixtures/ldap/openldap/data/70-e2e-tree.ldif:/container/services/openldap-bootstrap/assets/ldif/data/custom/70-e2e-tree.ldif:ro
    - ./e2e/fixtures/ldap/openldap/data/80-e2e-people.ldif:/container/services/openldap-bootstrap/assets/ldif/data/custom/80-e2e-people.ldif:ro
    - ./e2e/fixtures/ldap/openldap/data/90-e2e-groups.ldif:/container/services/openldap-bootstrap/assets/ldif/data/custom/90-e2e-groups.ldif:ro
  mem_limit: 128m # placeholder until the pre-flight measures it
  healthcheck:
    test:
      - CMD
      - env
      - LDAPTLS_CACERT=/e2e-tls/ca.crt
      - LDAPTLS_REQCERT=demand
      - ldapwhoami
      - -x
      - -ZZ
      - -H
      - ldap://localhost:3890
      - -D
      - cn=svc-hub,dc=openldap,dc=hub,dc=test
      - -w
      - E2e-Svc-Passw0rd
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 60s
    start_interval: 1s
```

Update the file's header comment:

```yaml
# Throwaway services for the tests, published on 127.0.0.1 only. MySQL (tmpfs) is started by e2e/global-setup.ts;
# the two LDAP test directories (profile `ldap`) are started by name: ldap-ad by e2e/global-setup.ts, both by
# __tests__/ldap/global-setup.ts (pnpm test:ldap). Stop them with:
#   docker compose -f docker-compose.e2e.yml down             (MySQL)
#   docker compose -f docker-compose.e2e.yml down ldap-ad ldap-openldap
```

Bring them up once and check them (spec §14's open points; the pre-flight saw the same):

```bash
time docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 300 ldap-ad ldap-openldap
openssl s_client -connect 127.0.0.1:10636 -CAfile e2e/fixtures/ldap/tls/ca.crt -verify_ip 127.0.0.1 -verify_return_error -brief </dev/null
openssl s_client -starttls ldap -connect 127.0.0.1:13890 -CAfile e2e/fixtures/ldap/tls/ca.crt -verify_ip 127.0.0.1 -verify_return_error -brief </dev/null
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
```

Expected: both healthy within the timeout; both `s_client` lines report `Verification: OK`; the memory under each `mem_limit`. Then stop them (`docker compose -f docker-compose.e2e.yml down ldap-ad ldap-openldap`): `pnpm test:ldap` starts and stops them itself (Step 6).

- [ ] **Step 5: The Vitest projects and the scripts**

Replace `vitest.config.ts`'s `test` block with:

```ts
	test: {
		environment: 'node',
		globals: true,
		// Playwright specs under e2e/ run with `pnpm test:e2e`, not vitest; tmp/ is git-ignored scratch (research
		// clones carry their own test files), so it is never collected (owner, 2026-10-10).
		exclude: [...configDefaults.exclude, 'e2e/**', 'tmp/**'],
		// Decision j (Vitest "Test Projects"): `unit` is `pnpm test`; `ldap` needs the two test directories of
		// docker-compose.e2e.yml and runs only through `pnpm test:ldap`.
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					exclude: [...configDefaults.exclude, 'e2e/**', 'tmp/**', '**/*.ldap.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'ldap',
					include: ['__tests__/ldap/**/*.ldap.test.ts'],
					globalSetup: ['./__tests__/ldap/global-setup.ts'],
					hookTimeout: 120_000,
					testTimeout: 30_000,
				},
			},
		],
	},
```

In `package.json`, set `"test": "vitest run --project unit"`, `"test:watch": "vitest --project unit"`, and add `"test:ldap": "vitest run --project ldap --no-file-parallelism"` after it.

- [ ] **Step 6: The suite's setup and the server table**

Create `__tests__/ldap/global-setup.ts`:

```ts
import { execSync } from 'node:child_process'

const compose = 'docker compose -f docker-compose.e2e.yml'

/**
 * Starts the two LDAP test directories for `pnpm test:ldap` (Vitest "globalSetup": it runs only when tests are queued,
 * and a returned function is the teardown), and stops them afterwards, so nothing is left running (decision i).
 */
export default function setup() {
	execSync(`${compose} up -d --wait --wait-timeout 300 ldap-ad ldap-openldap`, { stdio: 'inherit' })
	return () => {
		execSync(`${compose} down ldap-ad ldap-openldap`, { stdio: 'inherit' })
	}
}
```

Create `__tests__/ldap/servers.ts`:

```ts
import { readFileSync } from 'node:fs'

import { Client } from 'ldapts'

import type { LdapConfig } from '@/lib/env'

/** The seeded people's password and the service account's (e2e/fixtures/ldap; test values only). */
export const PASSWORD = 'E2e-Dir-Passw0rd'
const SERVICE_PASSWORD = 'E2e-Svc-Passw0rd'
const CA_FILE = 'e2e/fixtures/ldap/tls/ca.crt'

const ad = {
	caFile: CA_FILE,
	bindDn: 'CN=svc-hub,CN=Users,DC=e2e,DC=hub,DC=test',
	bindPassword: SERVICE_PASSWORD,
	userBaseDn: 'CN=Users,DC=e2e,DC=hub,DC=test',
	userFilter:
		'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
	loginAttribute: 'sAMAccountName',
	idAttribute: 'objectGUID',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
	groupBaseDn: 'CN=Users,DC=e2e,DC=hub,DC=test',
	groupFilter: '(objectClass=group)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
	syncSchedule: null,
	syncTimezone: null,
} satisfies Omit<LdapConfig, 'url' | 'encryption'>

const openldap = {
	caFile: CA_FILE,
	bindDn: 'cn=svc-hub,dc=openldap,dc=hub,dc=test',
	bindPassword: SERVICE_PASSWORD,
	userBaseDn: 'ou=people,dc=openldap,dc=hub,dc=test',
	userFilter: '(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))',
	loginAttribute: 'uid',
	idAttribute: 'entryUUID',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
	groupBaseDn: 'ou=groups,dc=openldap,dc=hub,dc=test',
	groupFilter: '(objectClass=groupOfNames)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf={group_dn})',
	syncSchedule: null,
	syncTimezone: null,
} satisfies Omit<LdapConfig, 'url' | 'encryption'>

export const adLdaps: LdapConfig = { ...ad, url: 'ldaps://127.0.0.1:10636', encryption: 'ldaps' }
export const adStartTls: LdapConfig = {
	...ad,
	url: 'ldap://127.0.0.1:10389',
	encryption: 'starttls',
}
/** Samba keeps "ldap server require strong auth = yes": a plain simple bind is refused (strongerAuthRequired). */
export const adPlain: LdapConfig = { ...ad, url: 'ldap://127.0.0.1:10389', encryption: 'none' }
export const openldapStartTls: LdapConfig = {
	...openldap,
	url: 'ldap://127.0.0.1:13890',
	encryption: 'starttls',
}
export const openldapPlain: LdapConfig = {
	...openldap,
	url: 'ldap://127.0.0.1:13890',
	encryption: 'none',
}

/** The three working modes of spec §8, with the seeded names each directory uses. */
export const TEST_DIRECTORIES = [
	{
		name: 'smblds over LDAPS',
		config: adLdaps,
		people: {
			alice: 'alice',
			bob: 'bob',
			carol: 'carol',
			dave: 'dave',
			erin: 'erin',
			frank: 'frank',
		},
		groups: {
			admins: 'hub-admins',
			engineering: 'hub-engineering',
			backend: 'hub-backend',
			rnd: 'R&D (Berlin), Team',
		},
		emailDomain: 'e2e.hub.test',
		/** A base the user filter matches nothing under: the `empty` safety stop (spec §6.4 step 2). */
		emptyBaseDn: 'CN=Computers,DC=e2e,DC=hub,DC=test',
	},
	{
		name: 'OpenLDAP over StartTLS',
		config: openldapStartTls,
		people: {
			alice: 'alice',
			bob: 'bob',
			carol: 'carol',
			dave: 'dave',
			erin: 'erin',
			frank: 'frank',
		},
		groups: {
			admins: 'hub-admins',
			engineering: 'hub-engineering',
			backend: 'hub-backend',
			rnd: 'R&D (Berlin), Team',
		},
		emailDomain: 'openldap.hub.test',
		emptyBaseDn: 'ou=groups,dc=openldap,dc=hub,dc=test',
	},
	{
		name: 'OpenLDAP in plain',
		config: openldapPlain,
		people: {
			alice: 'alice',
			bob: 'bob',
			carol: 'carol',
			dave: 'dave',
			erin: 'erin',
			frank: 'frank',
		},
		groups: {
			admins: 'hub-admins',
			engineering: 'hub-engineering',
			backend: 'hub-backend',
			rnd: 'R&D (Berlin), Team',
		},
		emailDomain: 'openldap.hub.test',
		emptyBaseDn: 'ou=groups,dc=openldap,dc=hub,dc=test',
	},
] as const

/** A bare ldapts client for the suite's own checks (not the hub's connection code); TLS for an ldaps:// URL. */
export const rawClient = (config: LdapConfig) =>
	new Client({
		url: config.url,
		connectTimeout: 5_000,
		timeout: 15_000,
		...(config.encryption === 'ldaps' ? { tlsOptions: { ca: [readFileSync(CA_FILE)] } } : {}),
	})
```

- [ ] **Step 7: The smoke test, and run the suite**

Create `__tests__/ldap/servers.ldap.test.ts`:

```ts
import { readFileSync } from 'node:fs'

import { SizeLimitExceededError } from 'ldapts'
import { describe, expect, it } from 'vitest'

import { openldapPlain, rawClient, TEST_DIRECTORIES } from './servers'

// The harness itself (decision k): each directory answers a service bind and a search in its mode.
describe.each(TEST_DIRECTORIES)('the test directory: $name', ({ config, people }) => {
	it('binds as the service account and finds a seeded person', async () => {
		const client = rawClient(config)
		try {
			const ca = [readFileSync(config.caFile!)]
			if (config.encryption === 'starttls') await client.startTLS({ ca, host: '127.0.0.1' })
			await client.bind(config.bindDn, config.bindPassword)
			const { searchEntries } = await client.search(config.userBaseDn, {
				filter: `(${config.loginAttribute}=${people.alice})`,
				attributes: [config.loginAttribute],
			})
			expect(searchEntries).toHaveLength(1)
		} finally {
			await client.unbind()
		}
	})
})

// Spec §8: OpenLDAP's per-account size limit forces the sync to page (decision l).
describe("OpenLDAP's limit for the service account", () => {
	it('refuses an unpaged search over five entries', async () => {
		const client = rawClient(openldapPlain)
		try {
			await client.bind(openldapPlain.bindDn, openldapPlain.bindPassword)
			await expect(
				client.search(openldapPlain.userBaseDn, {
					filter: openldapPlain.userFilter,
					attributes: ['uid'],
				}),
			).rejects.toBeInstanceOf(SizeLimitExceededError)
		} finally {
			await client.unbind()
		}
	})
})
```

Run:

```bash
pnpm test:ldap
pnpm test
```

Expected: `pnpm test:ldap` passes 4 tests and stops both servers afterwards (`docker compose -f docker-compose.e2e.yml ps` lists neither); `pnpm test` runs the `unit` project only, with the same count as before this task.

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint vitest.config.ts __tests__/ldap/global-setup.ts __tests__/ldap/servers.ts __tests__/ldap/servers.ldap.test.ts
pnpm exec oxfmt --write vitest.config.ts package.json docker-compose.e2e.yml __tests__/ldap/global-setup.ts __tests__/ldap/servers.ts __tests__/ldap/servers.ldap.test.ts && pnpm exec oxfmt --check vitest.config.ts package.json docker-compose.e2e.yml __tests__/ldap/global-setup.ts __tests__/ldap/servers.ts __tests__/ldap/servers.ldap.test.ts
git add .gitattributes docker-compose.e2e.yml vitest.config.ts package.json e2e/fixtures/ldap __tests__/ldap
git ls-files -s e2e/fixtures/ldap | grep '\.sh$'
git commit -m "test(directory): add the LDAP test directories and the test:ldap suite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

Expected: the three `.sh` files listed with mode `100755`.

---

### Task 5: Directory keys, filters and entries (pure)

Spec §6.3 steps 3 and 6 (the escaped login filter, `explicitBufferAttributes`, the key canonicalised from its bytes), §6.4 step 4 (a binary key rebuilt to its 16 bytes and escaped per byte), §6.5 (the member filter's `{group_dn}`, the group search filter), §7.2 (every value placed in a filter is escaped). Review Focus: line 1.

**Files:**

- Create: `lib/directory/keys.ts`, `lib/directory/filters.ts`, `lib/directory/entry.ts`, `__tests__/directory-keys.test.ts`, `__tests__/directory-filters.test.ts`, `__tests__/directory-entry.test.ts`

**Interfaces:**

- Consumes: `LdapConfig`, `GROUP_DN_PLACEHOLDER` from `@/lib/env` (Task 2); `emailField` from `@/lib/auth/fields`; from `ldapts`: `Filter` (static `Filter.escape(input: Buffer | string): string`) and the type `Entry` (`{ dn: string; [attribute: string]: Buffer | Buffer[] | string[] | string }`).
- Produces:
  - `@/lib/directory/keys`: `DIRECTORY_KEY_PATTERN: RegExp` (lowercase 8-4-4-4-12 hex), `isBinaryKeyAttribute(attribute: string): boolean`, `guidBytesToString(bytes: Buffer): string`, `guidStringToBytes(key: string): Buffer`, `canonicalKey(value: unknown, attribute: string): string | null`, `keyFilterValue(key: string, attribute: string): Buffer | string`.
  - `@/lib/directory/filters`: `loginFilter(config, username: string): string`, `memberFilter(config, groupDn: string): string`, `groupByKeyFilter(config, key: string): string`, `groupSearchFilter(config, text: string): string`.
  - `@/lib/directory/entry`: `interface DirectoryEntry { dn: string; key: string; username: string | null; email: string | null; name: string | null }`, `readEntry(entry: Entry, config: LdapConfig): DirectoryEntry | null`, `entryAttributes(config): string[]`, `bufferAttributes(config): string[]`, `attributeValue(entry: Entry, attribute: string): unknown`, `firstText(value: unknown): string | null`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **m. A key is binary when the id attribute is `objectGUID`**, compared without case, as Keycloak decides (`keycloak/keycloak@c7de391a:federation/ldap/src/main/java/org/keycloak/storage/ldap/LDAPConfig.java:182-183`, `isObjectGUID()` is `getUuidLDAPAttributeName().equalsIgnoreCase(LDAPConstants.OBJECT_GUID)`; its `LDAPUtil.java:112, 170, 229` encode, decode and filter the 16 bytes) and as Backstage formats an AD vendor's GUID (`backstage@75128025:plugins/catalog-backend-module-ldap/src/ldap/vendors.ts:126-145`). Spec §6.3 step 6 reads binary-ness from the value's length; this reads it from the setting, so the sync can rebuild a key's 16 bytes for a lookup (spec §6.4 step 4) without guessing. For the two supported attributes the result is the same: `objectGUID` is 16 bytes (Microsoft Learn `a-objectguid`: "Size: 16 bytes"), `entryUUID` is text (RFC 4530 §2.1). Spec §2 #4 already names the `objectGUID` byte order as the one vendor difference in code.
- **n. `objectGUID` is always asked for as a Buffer under its schema spelling too.** ldapts matches `explicitBufferAttributes` against the attribute type as the server sends it, case-sensitively (`src/messages/SearchEntry.ts:53`), and AD sends `objectGUID`; a setting written `objectguid` would otherwise get a string whenever the bytes happen to be valid UTF-8 (`src/Attribute.ts:57-75`).
- **o. An entry's values are read without regard to the attribute's case** (RFC 4512 §2.5: "attribute type names are case insensitive"; ldapts keys a result by the type as the server sent it, `ldap-client.md` §3.5), the first value of a multi-valued attribute is used, an email that `emailField` refuses counts as none (spec §2 #11 then refuses a new account), and a name or username longer than its 255-character column is cut to 255.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/directory-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	canonicalKey,
	DIRECTORY_KEY_PATTERN,
	guidBytesToString,
	guidStringToBytes,
	isBinaryKeyAttribute,
	keyFilterValue,
} from '@/lib/directory/keys'

// Microsoft's worked example (archived TechNet wiki on Learn, "Active Directory: LDAP Syntax Filters", note 8): the
// GUID {b95f3990-b59a-4a1b-9e96-86c66cb18d99} is the bytes 90395fb99ab51b4a9e9686c66cb18d99 (MS-DTYP 2.3.4.2:
// Data1, Data2 and Data3 little-endian, Data4 as is).
const bytes = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')
const guid = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'

describe('the objectGUID byte order (MS-DTYP 2.3.4.2)', () => {
	it('turns the 16 bytes into the GUID string and back', () => {
		expect(guidBytesToString(bytes)).toBe(guid)
		expect(guidStringToBytes(guid).equals(bytes)).toBe(true)
	})

	it('refuses anything but 16 bytes or a canonical GUID string', () => {
		expect(() => guidBytesToString(Buffer.alloc(15))).toThrow()
		expect(() => guidStringToBytes('not-a-guid')).toThrow()
	})
})

describe('canonicalKey (spec §6.3 step 6, decision m)', () => {
	it('reads objectGUID from its 16 bytes only', () => {
		expect(isBinaryKeyAttribute('objectGUID')).toBe(true)
		expect(isBinaryKeyAttribute('ObjectGuid')).toBe(true)
		expect(canonicalKey(bytes, 'objectGUID')).toBe(guid)
		expect(canonicalKey([bytes], 'objectGUID')).toBe(guid)
		expect(canonicalKey(Buffer.alloc(8), 'objectGUID')).toBeNull()
		expect(canonicalKey(guid, 'objectGUID')).toBeNull()
		expect(canonicalKey([bytes, bytes], 'objectGUID')).toBeNull()
	})

	// RFC 4530 §2.1: "UUID values are encoded using the [ASCII] character string representation"; RFC 9562 §4 allows
	// either case on input; the hub stores lowercase.
	it('reads entryUUID as text, from a string or its bytes, lowercased', () => {
		expect(isBinaryKeyAttribute('entryUUID')).toBe(false)
		expect(canonicalKey('597AE2F6-16A6-1027-98F4-D28B5365DC14', 'entryUUID')).toBe(
			'597ae2f6-16a6-1027-98f4-d28b5365dc14',
		)
		expect(canonicalKey(Buffer.from('597ae2f6-16a6-1027-98f4-d28b5365dc14'), 'entryUUID')).toBe(
			'597ae2f6-16a6-1027-98f4-d28b5365dc14',
		)
		expect(canonicalKey('uid=alice', 'entryUUID')).toBeNull()
		expect(canonicalKey(Buffer.from([0xff, 0xfe]), 'entryUUID')).toBeNull()
		expect(canonicalKey([], 'entryUUID')).toBeNull()
		expect(canonicalKey(undefined, 'entryUUID')).toBeNull()
	})

	it('matches the canonical pattern the groups form validates against', () => {
		expect(DIRECTORY_KEY_PATTERN.test(guid)).toBe(true)
		expect(DIRECTORY_KEY_PATTERN.test(guid.toUpperCase())).toBe(false)
	})

	it('gives a filter the bytes of a binary key and the text of another', () => {
		expect((keyFilterValue(guid, 'objectGUID') as Buffer).equals(bytes)).toBe(true)
		expect(keyFilterValue('597ae2f6-16a6-1027-98f4-d28b5365dc14', 'entryUUID')).toBe(
			'597ae2f6-16a6-1027-98f4-d28b5365dc14',
		)
	})
})
```

Create `__tests__/directory-filters.test.ts`:

```ts
import { FilterParser } from 'ldapts'
import { describe, expect, it } from 'vitest'

import {
	groupByKeyFilter,
	groupSearchFilter,
	loginFilter,
	memberFilter,
} from '@/lib/directory/filters'

const config = {
	userFilter: '(&(objectCategory=person)(objectClass=user))',
	loginAttribute: 'sAMAccountName',
	idAttribute: 'objectGUID',
	groupFilter: '(objectClass=group)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
}

// RFC 4515 §3 and ldapts' Filter.escape: `*`, `(`, `)`, `\` and NUL become \2a \28 \29 \5c \00; OWASP LDAP Injection
// Prevention Cheat Sheet: "Escape all variables using the right LDAP encoding function".
describe('loginFilter (spec §6.3 step 3)', () => {
	it('ANDs the user filter with the escaped login', () => {
		expect(loginFilter(config, 'alice')).toBe(
			'(&(&(objectCategory=person)(objectClass=user))(sAMAccountName=alice))',
		)
	})

	it.each([
		['*', '\\2a'],
		['alice)(objectClass=*', 'alice\\29\\28objectClass=\\2a'],
		['a\\b', 'a\\5cb'],
		['a\u0000b', 'a\\00b'],
	])('escapes %j', (username, escaped) => {
		const filter = loginFilter(config, username)
		expect(filter).toBe(
			`(&(&(objectCategory=person)(objectClass=user))(sAMAccountName=${escaped}))`,
		)
		// The result is one filter ldapts reads back with the login as a single value.
		expect(() => FilterParser.parseString(filter)).not.toThrow()
	})
})

describe('memberFilter (spec §6.5)', () => {
	it('puts the escaped DN in place of {group_dn}', () => {
		expect(memberFilter(config, 'CN=Smith\\, John,OU=Groups,DC=corp')).toBe(
			'(memberOf:1.2.840.113556.1.4.1941:=CN=Smith\\5c, John,OU=Groups,DC=corp)',
		)
	})
})

describe('groupByKeyFilter (spec §6.4 step 4)', () => {
	it('escapes every byte of a binary key', () => {
		expect(groupByKeyFilter(config, 'b95f3990-b59a-4a1b-9e96-86c66cb18d99')).toBe(
			'(&(objectClass=group)(objectGUID=\\90\\39\\5f\\b9\\9a\\b5\\1b\\4a\\9e\\96\\86\\c6\\6c\\b1\\8d\\99))',
		)
	})

	it('compares a text key as text', () => {
		expect(
			groupByKeyFilter(
				{ ...config, idAttribute: 'entryUUID' },
				'597ae2f6-16a6-1027-98f4-d28b5365dc14',
			),
		).toBe('(&(objectClass=group)(entryUUID=597ae2f6-16a6-1027-98f4-d28b5365dc14))')
	})
})

describe('groupSearchFilter (spec §6.5 "Linking")', () => {
	it('searches the name attribute for the escaped text anywhere', () => {
		expect(groupSearchFilter(config, 'eng*')).toBe('(&(objectClass=group)(cn=*eng\\2a*))')
	})
})
```

(ldapts writes each byte as two lowercase hex digits, `src/filters/Filter.ts` `escape` at `ldapts@b38cfc3`; RFC 4515 §3 accepts either case.)

Create `__tests__/directory-entry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { bufferAttributes, entryAttributes, readEntry } from '@/lib/directory/entry'

const config = {
	idAttribute: 'objectGUID',
	loginAttribute: 'sAMAccountName',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
} as const
const guidBytes = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')

describe('readEntry (decision o)', () => {
	it('reads the key, login, email and name, whatever case the server writes the types in', () => {
		expect(
			readEntry(
				{
					dn: 'CN=Alice Admin,CN=Users,DC=corp',
					objectguid: guidBytes,
					SAMACCOUNTNAME: 'alice',
					mail: ['alice@corp.example', 'other@corp.example'],
					displayName: '  Alice Admin ',
				},
				config as never,
			),
		).toEqual({
			dn: 'CN=Alice Admin,CN=Users,DC=corp',
			key: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
			username: 'alice',
			email: 'alice@corp.example',
			name: 'Alice Admin',
		})
	})

	it('answers null without a key or a DN', () => {
		expect(readEntry({ dn: 'CN=x', sAMAccountName: 'x' }, config as never)).toBeNull()
		expect(readEntry({ dn: '', objectGUID: guidBytes }, config as never)).toBeNull()
	})

	it('counts an invalid or missing email as none, and cuts a long name to 255', () => {
		const entry = readEntry(
			{
				dn: 'CN=x',
				objectGUID: guidBytes,
				sAMAccountName: 'x',
				mail: 'not an email',
				displayName: 'n'.repeat(300),
			},
			config as never,
		)
		expect(entry).toMatchObject({ email: null, name: 'n'.repeat(255) })
		expect(
			readEntry({ dn: 'CN=x', objectGUID: guidBytes, mail: [] }, config as never),
		).toMatchObject({
			email: null,
			username: null,
			name: null,
		})
	})
})

describe('the attributes a search asks for (spec §6.3 step 3, decision n)', () => {
	it('names the four attributes and asks for the key as a Buffer under both spellings', () => {
		expect(entryAttributes(config as never)).toEqual([
			'objectGUID',
			'sAMAccountName',
			'mail',
			'displayName',
		])
		expect(bufferAttributes({ ...config, idAttribute: 'objectguid' } as never)).toEqual([
			'objectguid',
			'objectGUID',
		])
		expect(bufferAttributes({ ...config, idAttribute: 'entryUUID' } as never)).toEqual([
			'entryUUID',
		])
	})
})
```

Run: `pnpm exec vitest run __tests__/directory-keys.test.ts __tests__/directory-filters.test.ts __tests__/directory-entry.test.ts` Expected: FAIL; the modules do not exist.

- [ ] **Step 2: Write `lib/directory/keys.ts`**

```ts
import 'server-only'

import { DIRECTORY_KEY_PATTERN } from '@/lib/directory-status'

/*
 * A directory entry's key (B3 spec §3.2, §6.3 step 6): the only link between an account and its entry (ADR-0026),
 * stored as lowercase GUID text. `objectGUID` arrives as 16 bytes in Microsoft's byte order; `entryUUID` as text.
 */

/** The canonical key text (Task 1's client-safe vocabulary, so the groups form shares it). */
export { DIRECTORY_KEY_PATTERN }

/** Decision m: binary when the id attribute is `objectGUID`, compared without case (Keycloak's `isObjectGUID`). */
export const isBinaryKeyAttribute = (attribute: string): boolean =>
	attribute.toLowerCase() === 'objectguid'

/**
 * MS-DTYP 2.3.4.2: Data1 (4 bytes), Data2 (2) and Data3 (2) are little-endian and Data4 (8) is kept as it is, so the
 * first three groups are written byte-reversed (.NET `Guid.ToByteArray`: "The order of the beginning four-byte group
 * and the next two two-byte groups is reversed").
 */
export function guidBytesToString(bytes: Buffer): string {
	if (bytes.length !== 16) throw new Error('objectGUID must be 16 bytes')
	const h = bytes.toString('hex')
	return (
		`${h.slice(6, 8)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}-${h.slice(10, 12)}${h.slice(8, 10)}-` +
		`${h.slice(14, 16)}${h.slice(12, 14)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
	)
}

/** The reverse of guidBytesToString: the 16 bytes a filter compares `objectGUID` with (spec §6.4 step 4). */
export function guidStringToBytes(key: string): Buffer {
	if (!DIRECTORY_KEY_PATTERN.test(key)) throw new Error('not a canonical GUID')
	const h = key.replaceAll('-', '')
	return Buffer.from(
		`${h.slice(6, 8)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}${h.slice(10, 12)}${h.slice(8, 10)}` +
			`${h.slice(14, 16)}${h.slice(12, 14)}${h.slice(16, 32)}`,
		'hex',
	)
}

/** UTF-8 that refuses invalid bytes (MDN `TextDecoder`, `fatal`). */
const utf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * The canonical key of an entry's id value, or null when it is not one (the sign-in refuses it, the sync skips it):
 * exactly one value; for `objectGUID` 16 bytes; otherwise text, from a string or UTF-8 bytes, in UUID form.
 */
export function canonicalKey(value: unknown, attribute: string): string | null {
	const single = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value
	if (isBinaryKeyAttribute(attribute))
		return Buffer.isBuffer(single) && single.length === 16 ? guidBytesToString(single) : null
	let text: string | null = null
	if (typeof single === 'string') text = single
	else if (Buffer.isBuffer(single)) {
		try {
			text = utf8.decode(single)
		} catch {
			return null
		}
	}
	const lower = text?.trim().toLowerCase() ?? ''
	return DIRECTORY_KEY_PATTERN.test(lower) ? lower : null
}

/** What a filter compares the id attribute with: a binary key's 16 bytes, else its text (decision m). */
export const keyFilterValue = (key: string, attribute: string): Buffer | string =>
	isBinaryKeyAttribute(attribute) ? guidStringToBytes(key) : key
```

- [ ] **Step 3: Write `lib/directory/filters.ts`**

```ts
import 'server-only'

import { Filter } from 'ldapts'

import { GROUP_DN_PLACEHOLDER, type LdapConfig } from '@/lib/env'

import { keyFilterValue } from './keys'

/*
 * The filters the hub sends (B3 spec §6.3–§6.5, §7.2). The configured parts (filters, attribute names) were validated
 * by lib/env.ts; every value from a person or from the directory goes through ldapts' `Filter.escape` (ldapts README
 * "Filter Strings"; RFC 4515 §3; a Buffer is escaped byte by byte), never into the filter as written.
 */

type FilterConfig = Pick<
	LdapConfig,
	| 'userFilter'
	| 'loginAttribute'
	| 'idAttribute'
	| 'groupFilter'
	| 'groupNameAttribute'
	| 'groupMemberFilter'
>

/** Spec §6.3 step 3: `(&<LDAP_USER_FILTER>(<LDAP_LOGIN_ATTRIBUTE>=<username>))`. */
export const loginFilter = (config: FilterConfig, username: string): string =>
	`(&${config.userFilter}(${config.loginAttribute}=${Filter.escape(username)}))`

/** Spec §6.5: LDAP_GROUP_MEMBER_FILTER with the group's DN, escaped (a DN often carries RFC 4514 backslashes). */
export const memberFilter = (config: FilterConfig, groupDn: string): string =>
	config.groupMemberFilter.replaceAll(GROUP_DN_PLACEHOLDER, Filter.escape(groupDn))

/** Spec §6.4 step 4: a linked group by its key under the group filter; a binary key as its 16 escaped bytes. */
export const groupByKeyFilter = (config: FilterConfig, key: string): string =>
	`(&${config.groupFilter}(${config.idAttribute}=${Filter.escape(keyFilterValue(key, config.idAttribute))}))`

/** Spec §6.5 "Linking": the groups whose name contains the text. */
export const groupSearchFilter = (config: FilterConfig, text: string): string =>
	`(&${config.groupFilter}(${config.groupNameAttribute}=*${Filter.escape(text)}*))`
```

- [ ] **Step 4: Write `lib/directory/entry.ts`**

```ts
import 'server-only'

import type { Entry } from 'ldapts'

import { emailField } from '@/lib/auth/fields'
import type { LdapConfig } from '@/lib/env'

import { canonicalKey, isBinaryKeyAttribute } from './keys'

type EntryConfig = Pick<
	LdapConfig,
	'idAttribute' | 'loginAttribute' | 'emailAttribute' | 'nameAttribute'
>

/** A directory entry as the hub reads it (spec §6.3 step 6). */
export interface DirectoryEntry {
	dn: string
	key: string
	username: string | null
	email: string | null
	name: string | null
}

/** Spec §6.3 step 3: the id, login, email and name attributes, by name (an operational one is returned only so, RFC 4512 §3.4). */
export const entryAttributes = (config: EntryConfig): string[] => [
	config.idAttribute,
	config.loginAttribute,
	config.emailAttribute,
	config.nameAttribute,
]

/** Spec §6.3 step 3 and decision n: the key as a Buffer always, `objectGUID` under its schema spelling too. */
export const bufferAttributes = (config: Pick<LdapConfig, 'idAttribute'>): string[] => [
	...new Set([
		config.idAttribute,
		...(isBinaryKeyAttribute(config.idAttribute) ? ['objectGUID'] : []),
	]),
]

const COLUMN_MAX = 255

/** An attribute's value whatever the case of its type (RFC 4512 §2.5; decision o). */
export const attributeValue = (entry: Entry, attribute: string): unknown => {
	const wanted = attribute.toLowerCase()
	const key = Object.keys(entry).find(name => name !== 'dn' && name.toLowerCase() === wanted)
	return key === undefined ? undefined : entry[key]
}

/** The first value as trimmed text cut to its column's 255 characters, or null; a Buffer is read as UTF-8. */
export const firstText = (value: unknown): string | null => {
	const first = Array.isArray(value) ? value[0] : value
	const text = Buffer.isBuffer(first)
		? first.toString('utf8')
		: typeof first === 'string'
			? first
			: null
	const trimmed = text?.trim() ?? ''
	return trimmed === '' ? null : trimmed.slice(0, COLUMN_MAX)
}

/** The entry as the hub keeps it, or null when it has no DN or no valid key (spec §6.3 step 6). */
export function readEntry(entry: Entry, config: EntryConfig): DirectoryEntry | null {
	const key = canonicalKey(attributeValue(entry, config.idAttribute), config.idAttribute)
	if (!entry.dn || key === null) return null
	const email = firstText(attributeValue(entry, config.emailAttribute))
	return {
		dn: entry.dn,
		key,
		username: firstText(attributeValue(entry, config.loginAttribute)),
		email: email !== null && emailField.safeParse(email).success ? email : null,
		name: firstText(attributeValue(entry, config.nameAttribute)),
	}
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run __tests__/directory-keys.test.ts __tests__/directory-filters.test.ts __tests__/directory-entry.test.ts` Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/directory/keys.ts lib/directory/filters.ts lib/directory/entry.ts __tests__/directory-keys.test.ts __tests__/directory-filters.test.ts __tests__/directory-entry.test.ts
pnpm exec oxfmt --write <the same files> && pnpm exec oxfmt --check <the same files>
pnpm test
git add lib/directory/keys.ts lib/directory/filters.ts lib/directory/entry.ts __tests__/directory-keys.test.ts __tests__/directory-filters.test.ts __tests__/directory-entry.test.ts
git commit -m "feat(directory): read directory keys and entries and build escaped filters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 6: The directory connection and its operations

Spec §6.2 (a fresh client per sign-in and per sync with both timeouts set, `unbind()` in `finally`; the three encryption modes; TLS options to `startTLS()` only; never a reused client; no setting skips certificate verification), §6.3 steps 3–5 (the login search with `sizeLimit: 2`, the user bind), §6.4 steps 1 and 4 (the paged search, group lookups and member searches), §6.5 (the base-scope membership test, the bounded group search), §7.3 (ldapts errors reduced to class name and result code in the log). Review Focus: lines 1 and 4.

**Files:**

- Create: `lib/directory/errors.ts`, `lib/directory/connection.ts`, `lib/directory/operations.ts`, `__tests__/directory-connection.test.ts`, `__tests__/directory-operations.test.ts`, `__tests__/ldap/connection.ldap.test.ts`
- Modify: `lib/error-log.ts` (`describeError` reduces ldapts and directory errors), `__tests__/error-log.test.ts`

**Interfaces:**

- Consumes: `LdapConfig` (Task 2); `loginFilter`, `memberFilter`, `groupByKeyFilter`, `groupSearchFilter` (Task 5); `entryAttributes`, `bufferAttributes`, `attributeValue`, `firstText` and `canonicalKey` (Task 5); the test servers and `LDAP_TEST_SERVERS` from `__tests__/ldap/servers.ts` (Task 4); from `ldapts`: `Client` (`new Client({ url, connectTimeout, timeout, tlsOptions, createConnection, createSecureConnection })`, `startTLS(options)`, `bind(dn, password)`, `search(base, options)`, `unbind()`, the `isConnected` getter), `ResultCodeError` and its subclasses.
- Produces:
  - `@/lib/directory/errors`: `class DirectoryUnavailableError extends Error` (the directory did not answer: connection, TLS, timeout, a dropped socket) and `class DirectoryRefusedError extends Error` (the directory answered the connection set-up with a result code: the service account's bind or StartTLS refused), both with `{ cause }`.
  - `@/lib/directory/connection`: `CONNECT_TIMEOUT_MS`, `OPERATION_TIMEOUT_MS`, `withDirectory<T>(config: LdapConfig, work: (client: Client) => Promise<T>): Promise<T>` (a new client bound as the service account; unbound in `finally`), `oncePerClient(factory)` (exported for its test).
  - `@/lib/directory/operations`: `findLoginEntries(client, config, username): Promise<Entry[]>`, `listUserEntries(client, config): Promise<Entry[]>`, `findGroupByKey(client, config, key): Promise<{ dn: string; name: string } | null>`, `isMemberOf(client, config, userDn, groupDn): Promise<boolean>`, `listMemberKeys(client, config, groupDn): Promise<Set<string>>`, `searchGroups(client, config, text): Promise<{ key: string; name: string }[]>`, `GROUP_SEARCH_LIMIT` (20), `PAGE_SIZE` (500).

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **p. One connection per client.** ldapts documents `createConnection` and `createSecureConnection` as factories that "may be invoked more than once" because the client "transparently reconnects when it is used after being unbound or after the server closes the connection" (README "Custom connection factories"); after StartTLS that reconnect is plain TCP (`src/Client.ts:219-221, 889-935` at `ldapts@b38cfc3`; spec §6.2). The hub's factories allow one call per client, so a reconnect fails instead of sending a password in clear, in every mode. With one client per sign-in or per sync (spec §6.2), a legitimate second connection never happens (`library-apis.md` §7).
- **q. Failures are classified by phase.** Before the service account is bound (connect, TLS, StartTLS, the bind), a result code is `DirectoryRefusedError` and anything else `DirectoryUnavailableError`. During the work, a result code passes through (the directory answered: wrong password, no such base, size limit), and any other error with the client no longer connected is `DirectoryUnavailableError` (ldapts destroys the socket on an operation timeout, `src/Client.ts:1096-1103`); any other error passes through as the bug it is. The CA file is read before the client exists, so a missing file is a configuration error, not an unreachable directory.
- **r. TLS options:** TLS 1.2 or later (`minVersion`), the CA from `LDAP_CA_FILE` when set (Node `tls.connect` `ca`: "the default list would be completely replaced"), `host` always and `servername` for a host name (Node: `servername` "must be a host name, and not an IP address"; with `socket`, `host` is still used "for certificate validation", the StartTLS case). Node then checks the certificate against that name (`checkServerIdentity`); nothing turns that off (spec §6.2).
- **s. Every search names its limits.** The login search `sizeLimit: 2` (two means ambiguous, spec §6.3 step 3); a lookup by key `sizeLimit: 2`; the admin's group search `sizeLimit: 20` (spec §6.5); the membership test `scope: 'base'` with no attributes (`['1.1']`, RFC 4511 §4.5.1.8: "A list containing only the OID "1.1" indicates that no attributes are to be returned"); the user listing and member searches `paged: { pageSize: 500 }` and **no** `sizeLimit`, since ldapts accepts a size-limit result as complete whenever `sizeLimit` is set (`src/Client.ts:795`; `library-apis.md` §1), so a server-side cap fails the sync instead of cutting it short.

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/directory-connection.test.ts`:

```ts
import { InvalidCredentialsError, NoSuchObjectError } from 'ldapts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A fake ldapts Client that records its options and calls; the error classes stay ldapts' own. */
const mocks = vi.hoisted(() => {
	const state = {
		options: undefined as Record<string, unknown> | undefined,
		calls: [] as unknown[][],
		connected: true,
		failAt: undefined as undefined | { step: 'startTLS' | 'bind'; error: unknown },
	}
	class Client {
		constructor(options: Record<string, unknown>) {
			state.options = options
		}
		get isConnected() {
			return state.connected
		}
		async startTLS(options: unknown) {
			state.calls.push(['startTLS', options])
			if (state.failAt?.step === 'startTLS') throw state.failAt.error
		}
		async bind(dn: string, password: string) {
			state.calls.push(['bind', dn, password])
			if (state.failAt?.step === 'bind') throw state.failAt.error
		}
		async unbind() {
			state.calls.push(['unbind'])
		}
	}
	return { state, Client }
})
vi.mock('ldapts', async importOriginal => ({
	...(await importOriginal<typeof import('ldapts')>()),
	Client: mocks.Client,
}))
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile }))

import {
	CONNECT_TIMEOUT_MS,
	oncePerClient,
	OPERATION_TIMEOUT_MS,
	withDirectory,
} from '@/lib/directory/connection'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'

const base = {
	bindDn: 'CN=svc,DC=corp',
	bindPassword: 'secret',
	caFile: '/run/ca.pem',
} as const
const config = (url: string, encryption: 'ldaps' | 'starttls' | 'none') =>
	({ ...base, url, encryption }) as never

beforeEach(() => {
	Object.assign(mocks.state, { options: undefined, calls: [], connected: true, failAt: undefined })
	readFile.mockReset()
	readFile.mockResolvedValue(Buffer.from('PEM'))
})

describe('withDirectory: the three modes (spec §6.2, decisions p and r)', () => {
	it('ldaps: direct TLS with the CA and the host name, both timeouts, a single-use secure factory', async () => {
		await withDirectory(config('ldaps://dc.corp.example:636', 'ldaps'), async () => 'done')
		expect(mocks.state.options).toMatchObject({
			url: 'ldaps://dc.corp.example:636',
			connectTimeout: CONNECT_TIMEOUT_MS,
			timeout: OPERATION_TIMEOUT_MS,
			tlsOptions: {
				host: 'dc.corp.example',
				servername: 'dc.corp.example',
				minVersion: 'TLSv1.2',
				ca: [Buffer.from('PEM')],
			},
		})
		expect(mocks.state.options?.createSecureConnection).toBeTypeOf('function')
		expect(mocks.state.calls).toEqual([['bind', 'CN=svc,DC=corp', 'secret'], ['unbind']])
	})

	it('starttls: no TLS option on the constructor; startTLS with them before any bind', async () => {
		await withDirectory(config('ldap://dc.corp.example:389', 'starttls'), async () => undefined)
		expect(mocks.state.options).not.toHaveProperty('tlsOptions')
		expect(mocks.state.options?.createConnection).toBeTypeOf('function')
		expect(mocks.state.calls[0]).toEqual([
			'startTLS',
			{
				host: 'dc.corp.example',
				servername: 'dc.corp.example',
				minVersion: 'TLSv1.2',
				ca: [Buffer.from('PEM')],
			},
		])
		expect(mocks.state.calls[1][0]).toBe('bind')
	})

	it('none: plain, no TLS at all, no CA read', async () => {
		await withDirectory(config('ldap://10.0.0.5:389', 'none'), async () => undefined)
		expect(mocks.state.options).not.toHaveProperty('tlsOptions')
		expect(mocks.state.calls.map(call => call[0])).toEqual(['bind', 'unbind'])
		expect(readFile).not.toHaveBeenCalled()
	})

	it('leaves the server name out for an IP address and the CA out without a file', async () => {
		await withDirectory(
			{ ...config('ldaps://10.0.0.5:636', 'ldaps'), caFile: null } as never,
			async () => undefined,
		)
		expect(mocks.state.options?.tlsOptions).toEqual({ host: '10.0.0.5', minVersion: 'TLSv1.2' })
	})

	it('lets a factory open one connection only (decision p)', () => {
		const factory = vi.fn(() => 'socket')
		const once = oncePerClient(factory)
		expect(once(389, 'dc')).toBe('socket')
		expect(() => once(389, 'dc')).toThrow(/one connection/)
		expect(factory).toHaveBeenCalledTimes(1)
		expect(factory).toHaveBeenCalledWith(389, 'dc')
	})
})

describe('withDirectory: failures (decision q)', () => {
	it('unbinds when the work throws, and passes a result code through', async () => {
		const answered = new NoSuchObjectError('no such base')
		await expect(
			withDirectory(config('ldaps://dc', 'ldaps'), async () => {
				throw answered
			}),
		).rejects.toBe(answered)
		expect(mocks.state.calls.at(-1)).toEqual(['unbind'])
	})

	it('makes a refused service bind a DirectoryRefusedError', async () => {
		mocks.state.failAt = {
			step: 'bind',
			error: new InvalidCredentialsError('bad service password'),
		}
		await expect(
			withDirectory(config('ldaps://dc', 'ldaps'), async () => undefined),
		).rejects.toBeInstanceOf(DirectoryRefusedError)
	})

	it('makes a connection or TLS failure a DirectoryUnavailableError, with its cause', async () => {
		const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:389'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		mocks.state.failAt = { step: 'startTLS', error: refused }
		const error = await withDirectory(config('ldap://dc', 'starttls'), async () => undefined).catch(
			e => e,
		)
		expect(error).toBeInstanceOf(DirectoryUnavailableError)
		expect((error as Error).cause).toBe(refused)
	})

	it('makes a failure that dropped the connection during the work a DirectoryUnavailableError', async () => {
		const error = await withDirectory(config('ldaps://dc', 'ldaps'), async () => {
			mocks.state.connected = false
			throw new Error('SearchRequest: Operation timed out')
		}).catch(e => e)
		expect(error).toBeInstanceOf(DirectoryUnavailableError)
	})

	it('passes a bug through while still connected', async () => {
		const bug = new TypeError('x is undefined')
		await expect(
			withDirectory(config('ldaps://dc', 'ldaps'), async () => {
				throw bug
			}),
		).rejects.toBe(bug)
	})

	it('reads a missing CA file as a configuration error, before any client exists', async () => {
		const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT', errno: -2 })
		readFile.mockRejectedValue(missing)
		await expect(withDirectory(config('ldaps://dc', 'ldaps'), async () => undefined)).rejects.toBe(
			missing,
		)
		expect(mocks.state.options).toBeUndefined()
	})
})
```

Create `__tests__/directory-operations.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import {
	findGroupByKey,
	findLoginEntries,
	GROUP_SEARCH_LIMIT,
	isMemberOf,
	listMemberKeys,
	listUserEntries,
	PAGE_SIZE,
	searchGroups,
} from '@/lib/directory/operations'

const config = {
	userBaseDn: 'DC=corp',
	groupBaseDn: 'OU=Groups,DC=corp',
	userFilter: '(objectClass=user)',
	loginAttribute: 'sAMAccountName',
	idAttribute: 'objectGUID',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
	groupFilter: '(objectClass=group)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
} as never
const guid = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')
const clientAnswering = (searchEntries: unknown[]) => {
	const search = vi.fn().mockResolvedValue({ searchEntries, searchReferences: [] })
	return { client: { search } as never, search }
}

describe('the searches name their limits (decision s)', () => {
	it('the login search: two entries at most, no paging', async () => {
		const { client, search } = clientAnswering([])
		await findLoginEntries(client, config, 'alice')
		expect(search).toHaveBeenCalledWith('DC=corp', {
			scope: 'sub',
			filter: '(&(objectClass=user)(sAMAccountName=alice))',
			attributes: ['objectGUID', 'sAMAccountName', 'mail', 'displayName'],
			explicitBufferAttributes: ['objectGUID'],
			sizeLimit: 2,
		})
	})

	it('the user listing: paged and without a size limit', async () => {
		const { client, search } = clientAnswering([])
		await listUserEntries(client, config)
		const [, options] = search.mock.calls[0]
		expect(options).toMatchObject({
			scope: 'sub',
			filter: '(objectClass=user)',
			paged: { pageSize: PAGE_SIZE },
		})
		expect(options).not.toHaveProperty('sizeLimit')
	})

	it('a group by key: its DN and name, or null', async () => {
		const { client, search } = clientAnswering([
			{ dn: 'CN=Eng,OU=Groups,DC=corp', objectGUID: guid, cn: 'Eng' },
		])
		expect(await findGroupByKey(client, config, 'b95f3990-b59a-4a1b-9e96-86c66cb18d99')).toEqual({
			dn: 'CN=Eng,OU=Groups,DC=corp',
			name: 'Eng',
		})
		expect(search.mock.calls[0][0]).toBe('OU=Groups,DC=corp')
		expect(search.mock.calls[0][1]).toMatchObject({
			sizeLimit: 2,
			attributes: ['objectGUID', 'cn'],
		})
		expect(
			await findGroupByKey(
				clientAnswering([]).client,
				config,
				'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
			),
		).toBeNull()
	})

	it('the membership test: the user as base, scope base, no attributes (ADSI "Search Filter Syntax")', async () => {
		const { client, search } = clientAnswering([{ dn: 'CN=Bob,DC=corp' }])
		expect(await isMemberOf(client, config, 'CN=Bob,DC=corp', 'CN=Eng,OU=Groups,DC=corp')).toBe(
			true,
		)
		expect(search).toHaveBeenCalledWith('CN=Bob,DC=corp', {
			scope: 'base',
			filter: '(memberOf:1.2.840.113556.1.4.1941:=CN=Eng,OU=Groups,DC=corp)',
			attributes: ['1.1'],
			sizeLimit: 1,
		})
		expect(await isMemberOf(clientAnswering([]).client, config, 'CN=Bob,DC=corp', 'CN=Eng')).toBe(
			false,
		)
	})

	it('the members of a group: their keys, paged under the user base, invalid keys skipped', async () => {
		const { client, search } = clientAnswering([
			{ dn: 'CN=Bob', objectGUID: guid },
			{ dn: 'CN=Sub', objectGUID: Buffer.alloc(3) },
		])
		expect([...(await listMemberKeys(client, config, 'CN=Eng'))]).toEqual([
			'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
		])
		expect(search.mock.calls[0][1]).toMatchObject({
			paged: { pageSize: PAGE_SIZE },
			attributes: ['objectGUID'],
		})
		expect(search.mock.calls[0][1]).not.toHaveProperty('sizeLimit')
	})

	it('the admin group search: twenty at most, by name', async () => {
		const { client, search } = clientAnswering([
			{ dn: 'CN=Zeta', objectGUID: guid, cn: 'Zeta' },
			{ dn: 'CN=bad', objectGUID: Buffer.alloc(2), cn: 'bad' },
		])
		expect(await searchGroups(client, config, 'eta')).toEqual([
			{ key: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99', name: 'Zeta' },
		])
		expect(search.mock.calls[0][1]).toMatchObject({
			sizeLimit: GROUP_SEARCH_LIMIT,
			filter: '(&(objectClass=group)(cn=*eta*))',
		})
	})
})
```

In `__tests__/error-log.test.ts`, append:

```ts
describe('describeError and the directory (spec §7.3)', () => {
	it('keeps an ldapts result error to its name and LDAP result code', async () => {
		const { InvalidCredentialsError } = await import('ldapts')
		const described = describeError(
			new InvalidCredentialsError('80090308: LdapErr: DSID-0C09044E, data 52e'),
		)
		expect(described).toEqual({ name: 'InvalidCredentialsError', code: 49 })
	})

	it('keeps a directory error to its name and its cause reduced', async () => {
		const { DirectoryUnavailableError } = await import('@/lib/directory/errors')
		const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:389'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		expect(describeError(new DirectoryUnavailableError({ cause }))).toEqual({
			name: 'DirectoryUnavailableError',
			cause: { name: 'Error', code: 'ECONNREFUSED', errno: -111 },
		})
	})
})
```

(and `describeError` is already imported there; add it to the import if it is not.)

Run: `pnpm exec vitest run __tests__/directory-connection.test.ts __tests__/directory-operations.test.ts __tests__/error-log.test.ts` Expected: FAIL; the modules do not exist.

- [ ] **Step 2: Write `lib/directory/errors.ts`**

```ts
/*
 * The directory's failures as the hub tells them apart (B3 spec §7.3, decision q). No imports, so lib/action-failure.ts
 * and lib/error-log.ts can recognise them without loading ldapts' client.
 */

/** The directory did not answer: a refused or dropped connection, a TLS failure, a timeout. */
export class DirectoryUnavailableError extends Error {
	constructor(options: { cause: unknown }) {
		super('The directory is unreachable', options)
		this.name = 'DirectoryUnavailableError'
	}
}

/** The directory answered the connection's set-up with a result code: the service account's bind or StartTLS refused. */
export class DirectoryRefusedError extends Error {
	constructor(options: { cause: unknown }) {
		super('The directory refused the service account', options)
		this.name = 'DirectoryRefusedError'
	}
}
```

- [ ] **Step 3: Write `lib/directory/connection.ts`**

```ts
import 'server-only'

import { readFile } from 'node:fs/promises'
import net from 'node:net'
import tls from 'node:tls'

import { Client, ResultCodeError } from 'ldapts'

import type { LdapConfig } from '@/lib/env'

import { DirectoryRefusedError, DirectoryUnavailableError } from './errors'

/** Spec §6.2: both timeouts set (ldapts' defaults are off, `src/Client.ts:200-201`); constants, not settings (spec §7.1). */
export const CONNECT_TIMEOUT_MS = 5_000
export const OPERATION_TIMEOUT_MS = 15_000

/** Decision r: TLS 1.2 or later, the CA when set, the URL's host checked by name. */
async function tlsOptionsFor(config: LdapConfig): Promise<tls.ConnectionOptions> {
	// WHATWG URL keeps an IPv6 host in brackets; Node wants it bare.
	const host = new URL(config.url).hostname.replace(/^\[(.*)\]$/, '$1')
	return {
		host,
		...(net.isIP(host) === 0 ? { servername: host } : {}),
		minVersion: 'TLSv1.2',
		...(config.caFile ? { ca: [await readFile(config.caFile)] } : {}),
	}
}

/**
 * Decision p: a factory that opens one connection, then refuses. Its signature accepts whatever ldapts passes (ldapts
 * calls it "with the parsed port and host", README); a function taking `unknown[]` is assignable to each of the Node
 * factory's overloads, so no overload is guessed.
 */
export function oncePerClient<S>(factory: (...args: unknown[]) => S): (...args: unknown[]) => S {
	let used = false
	return (...args) => {
		if (used) throw new Error('A directory client makes one connection')
		used = true
		return factory(...args)
	}
}
const connectTcp = net.connect as (...args: unknown[]) => net.Socket
const connectTls = tls.connect as (...args: unknown[]) => tls.TLSSocket

/**
 * A fresh client for one sign-in or one sync, bound as the service account, unbound in `finally` (spec §6.2; ldapts
 * README "Authenticate example"). ldaps gives the TLS options to the constructor; StartTLS gives them to `startTLS()`
 * only, since options on the constructor switch ldapts to direct TLS (`src/Client.ts:219-221`); none sends no TLS.
 * Failures are classified by phase (decision q).
 */
export async function withDirectory<T>(
	config: LdapConfig,
	work: (client: Client) => Promise<T>,
): Promise<T> {
	const tlsOptions = config.encryption === 'none' ? undefined : await tlsOptionsFor(config)
	const client = new Client({
		url: config.url,
		connectTimeout: CONNECT_TIMEOUT_MS,
		timeout: OPERATION_TIMEOUT_MS,
		...(config.encryption === 'ldaps'
			? { tlsOptions, createSecureConnection: oncePerClient(connectTls) as typeof tls.connect }
			: { createConnection: oncePerClient(connectTcp) as typeof net.connect }),
	})
	try {
		try {
			if (config.encryption === 'starttls') await client.startTLS(tlsOptions)
			await client.bind(config.bindDn, config.bindPassword)
		} catch (error) {
			throw error instanceof ResultCodeError
				? new DirectoryRefusedError({ cause: error })
				: new DirectoryUnavailableError({ cause: error })
		}
		try {
			return await work(client)
		} catch (error) {
			if (!(error instanceof ResultCodeError) && !client.isConnected)
				throw new DirectoryUnavailableError({ cause: error })
			throw error
		}
	} finally {
		await client.unbind().catch(() => undefined)
	}
}
```

A function taking `unknown[]` is assignable to every overload of `net.connect` and `tls.connect`, so TypeScript accepts the assertions in both places; no `@ts-expect-error` is needed.

- [ ] **Step 4: Write `lib/directory/operations.ts`**

```ts
import 'server-only'

import type { Client, Entry } from 'ldapts'

import { DIRECTORY_GROUP_SEARCH_LIMIT } from '@/lib/directory-status'
import type { LdapConfig } from '@/lib/env'

import { attributeValue, bufferAttributes, entryAttributes, firstText } from './entry'
import { groupByKeyFilter, groupSearchFilter, loginFilter, memberFilter } from './filters'
import { canonicalKey } from './keys'

/*
 * The directory searches the hub makes (B3 spec §6.3–§6.5), each with its limits named (decision s). Every filter comes
 * from lib/directory/filters.ts, so every value in it is escaped.
 */

/** Spec §6.4 step 1: under Active Directory's MaxPageSize of 1,000 (MS-ADTS 3.1.1.3.4.6). */
export const PAGE_SIZE = 500

/** Spec §6.5 "Linking": the groups an admin's search shows (the groups page reads the same constant). */
export const GROUP_SEARCH_LIMIT = DIRECTORY_GROUP_SEARCH_LIMIT

/** Spec §6.3 step 3: at most two entries for the login; two means ambiguous. */
export async function findLoginEntries(
	client: Client,
	config: LdapConfig,
	username: string,
): Promise<Entry[]> {
	const { searchEntries } = await client.search(config.userBaseDn, {
		scope: 'sub',
		filter: loginFilter(config, username),
		attributes: entryAttributes(config),
		explicitBufferAttributes: bufferAttributes(config),
		sizeLimit: 2,
	})
	return searchEntries
}

/** Spec §6.4 step 1: every entry the user filter matches, paged, with no size limit (decision s). */
export async function listUserEntries(client: Client, config: LdapConfig): Promise<Entry[]> {
	const { searchEntries } = await client.search(config.userBaseDn, {
		scope: 'sub',
		filter: config.userFilter,
		attributes: entryAttributes(config),
		explicitBufferAttributes: bufferAttributes(config),
		paged: { pageSize: PAGE_SIZE },
	})
	return searchEntries
}

const nameOf = (entry: Entry, attribute: string): string | null =>
	firstText(attributeValue(entry, attribute))

/** Spec §6.4 step 4: a linked group by its key under the group base, or null when it is not found. */
export async function findGroupByKey(
	client: Client,
	config: LdapConfig,
	key: string,
): Promise<{ dn: string; name: string } | null> {
	const { searchEntries } = await client.search(config.groupBaseDn, {
		scope: 'sub',
		filter: groupByKeyFilter(config, key),
		attributes: [config.idAttribute, config.groupNameAttribute],
		explicitBufferAttributes: bufferAttributes(config),
		sizeLimit: 2,
	})
	const [group] = searchEntries
	return searchEntries.length === 1 && group
		? { dn: group.dn, name: nameOf(group, config.groupNameAttribute) ?? group.dn }
		: null
}

/**
 * Spec §6.5 at sign-in: Microsoft's documented test of one user's nested membership (ADSI "Search Filter Syntax",
 * LDAP_MATCHING_RULE_IN_CHAIN: base the user's DN, scope base, the in-chain filter for the group's DN).
 */
export async function isMemberOf(
	client: Client,
	config: LdapConfig,
	userDn: string,
	groupDn: string,
): Promise<boolean> {
	const { searchEntries } = await client.search(userDn, {
		scope: 'base',
		filter: memberFilter(config, groupDn),
		attributes: ['1.1'],
		sizeLimit: 1,
	})
	return searchEntries.length > 0
}

/** Spec §6.4 step 4: the keys of the entries the member filter matches for the group, paged under the user base. */
export async function listMemberKeys(
	client: Client,
	config: LdapConfig,
	groupDn: string,
): Promise<Set<string>> {
	const { searchEntries } = await client.search(config.userBaseDn, {
		scope: 'sub',
		filter: memberFilter(config, groupDn),
		attributes: [config.idAttribute],
		explicitBufferAttributes: bufferAttributes(config),
		paged: { pageSize: PAGE_SIZE },
	})
	const keys = new Set<string>()
	for (const entry of searchEntries) {
		const key = canonicalKey(attributeValue(entry, config.idAttribute), config.idAttribute)
		if (key) keys.add(key)
	}
	return keys
}

/** Spec §6.5 "Linking": up to twenty groups whose name contains the text, by name; entries without a valid key are left out. */
export async function searchGroups(
	client: Client,
	config: LdapConfig,
	text: string,
): Promise<{ key: string; name: string }[]> {
	const { searchEntries } = await client.search(config.groupBaseDn, {
		scope: 'sub',
		filter: groupSearchFilter(config, text),
		attributes: [config.idAttribute, config.groupNameAttribute],
		explicitBufferAttributes: bufferAttributes(config),
		sizeLimit: GROUP_SEARCH_LIMIT,
	})
	return searchEntries
		.flatMap(entry => {
			const key = canonicalKey(attributeValue(entry, config.idAttribute), config.idAttribute)
			return key ? [{ key, name: nameOf(entry, config.groupNameAttribute) ?? entry.dn }] : []
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 5: Reduce the directory's errors in the log**

In `lib/error-log.ts`, import `ResultCodeError` from `ldapts` and the two classes from `@/lib/directory/errors`, and add before the `DrizzleQueryError` line of `describeError`:

```ts
// Spec §7.3: an ldapts result error by its class and LDAP result code (its message carries the server's diagnostic
// text); a directory error by its name and its cause, reduced the same way.
if (error instanceof ResultCodeError) return { name: error.name, code: error.code }
if (error instanceof DirectoryUnavailableError || error instanceof DirectoryRefusedError)
	return { name: error.name, cause: describeError(error.cause) }
```

`describeError` is a `const` arrow; the recursive call is fine because it runs after the binding exists (MDN "Temporal dead zone": the binding is initialised before any call).

- [ ] **Step 6: Run the unit tests**

Run: `pnpm exec vitest run __tests__/directory-connection.test.ts __tests__/directory-operations.test.ts __tests__/error-log.test.ts` Expected: PASS.

- [ ] **Step 7: Write the integration tests against the test servers**

Create `__tests__/ldap/connection.ldap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { withDirectory } from '@/lib/directory/connection'
import { readEntry } from '@/lib/directory/entry'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'
import {
	findGroupByKey,
	findLoginEntries,
	isMemberOf,
	listMemberKeys,
	listUserEntries,
	searchGroups,
} from '@/lib/directory/operations'

import { adLdaps, adPlain, adStartTls, TEST_DIRECTORIES } from './servers'

// Spec §8: lib/directory/ against the real test directories, in the three working modes.
describe.each(TEST_DIRECTORIES)(
	'the directory connection: $name',
	({ config, people, groups, emailDomain }) => {
		it('finds one entry per login with a canonical key, none for a disabled person or an escaped wildcard', async () => {
			await withDirectory(config, async client => {
				const [alice] = await findLoginEntries(client, config, people.alice)
				const entry = readEntry(alice!, config)
				expect(entry?.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
				expect(entry).toMatchObject({
					username: people.alice,
					email: `alice@${emailDomain}`,
					name: 'Alice Admin',
				})
				expect(await findLoginEntries(client, config, people.carol)).toEqual([])
				// Spec §7.2: the typed value is escaped, so `*` is a literal login, not a wildcard.
				expect(await findLoginEntries(client, config, '*')).toEqual([])
			})
		})

		it("lists every person the filter matches, past the server's size limit (decision l)", async () => {
			const entries = await withDirectory(config, client => listUserEntries(client, config))
			const logins = entries.map(entry => readEntry(entry, config)?.username)
			expect(logins).toEqual(expect.arrayContaining(['alice', 'bob', 'dave', 'erin', 'frank']))
			expect(logins).not.toContain('carol')
			// OpenLDAP lets the service account see five entries per search; paging got all nine.
			if (config.idAttribute === 'entryUUID') expect(entries).toHaveLength(9)
		})

		it('finds groups by name and by key, and resolves nested and escaped memberships', async () => {
			await withDirectory(config, async client => {
				const found = await searchGroups(client, config, 'hub-')
				expect(found.map(group => group.name)).toEqual(
					expect.arrayContaining([groups.admins, groups.backend, groups.engineering]),
				)
				const engineering = await findGroupByKey(
					client,
					config,
					found.find(group => group.name === groups.engineering)!.key,
				)
				expect(engineering?.name).toBe(groups.engineering)
				const [bob] = await findLoginEntries(client, config, people.bob)
				// bob is in hub-backend, which is in hub-engineering: the in-chain rule on AD, nestgroup on OpenLDAP.
				expect(await isMemberOf(client, config, bob!.dn, engineering!.dn)).toBe(true)
				expect(
					(await listMemberKeys(client, config, engineering!.dn)).has(readEntry(bob!, config)!.key),
				).toBe(true)
				// A group DN with `(`, `)`, `&` and an escaped comma, and on AD a person DN with one (RFC 4514, RFC 4515).
				const [rnd] = await searchGroups(client, config, 'R&D (Berlin)')
				expect(rnd?.name).toBe(groups.rnd)
				const rndGroup = await findGroupByKey(client, config, rnd!.key)
				const [frank] = await findLoginEntries(client, config, people.frank)
				expect(await isMemberOf(client, config, frank!.dn, rndGroup!.dn)).toBe(true)
				expect(await isMemberOf(client, config, frank!.dn, engineering!.dn)).toBe(false)
			})
		})
	},
)

describe('the directory connection refuses what it must (decision q)', () => {
	it('names an untrusted certificate and a closed port unreachable', async () => {
		await expect(
			withDirectory({ ...adLdaps, caFile: null }, async () => 'never'),
		).rejects.toBeInstanceOf(DirectoryUnavailableError)
		await expect(
			withDirectory({ ...adLdaps, url: 'ldaps://127.0.0.1:1' }, async () => 'never'),
		).rejects.toBeInstanceOf(DirectoryUnavailableError)
	})

	it("names a wrong service password and Samba's refusal of a plain simple bind as refused", async () => {
		await expect(
			withDirectory({ ...adLdaps, bindPassword: 'Wrong-Passw0rd' }, async () => 'never'),
		).rejects.toBeInstanceOf(DirectoryRefusedError)
		// "ldap server require strong auth = yes": strongerAuthRequired (8), as a signing-enforcing AD answers.
		await expect(withDirectory(adPlain, async () => 'never')).rejects.toBeInstanceOf(
			DirectoryRefusedError,
		)
	})

	it("upgrades Samba's port 389 with StartTLS", async () => {
		expect(await withDirectory(adStartTls, async () => 'bound')).toBe('bound')
	})
})
```

- [ ] **Step 8: Run them**

```bash
pnpm test:ldap
```

Expected: PASS on smblds (LDAPS) and OpenLDAP (StartTLS, plain).

- [ ] **Step 9: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/directory/errors.ts lib/directory/connection.ts lib/directory/operations.ts lib/error-log.ts __tests__/directory-connection.test.ts __tests__/directory-operations.test.ts __tests__/error-log.test.ts __tests__/ldap/connection.ldap.test.ts
pnpm exec oxfmt --write <the same files> && pnpm exec oxfmt --check <the same files>
pnpm test
git add lib/directory/errors.ts lib/directory/connection.ts lib/directory/operations.ts lib/error-log.ts __tests__/directory-connection.test.ts __tests__/directory-operations.test.ts __tests__/error-log.test.ts __tests__/ldap/connection.ldap.test.ts
git commit -m "feat(directory): connect to the directory and search it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 7: The directory sign-in and the `ldap` provider

Spec §6.3 steps 1–8 (refuse blanks and an empty password before any bind; search, then the linked groups, then the user's bind; the key; the DAL's transaction; the provider's answer), §7.2 (no takeover, escaping, exactly one match), §7.3 (generic `CredentialsSignin` for every account-related refusal; `DirectoryUnavailable` for the directory not answering; one log line per refusal with a fixed reason and the username), ADR-0027's B3b notes (the admin marker after the bind; an unknown username answered in the same time as a wrong password). Review Focus: lines 1, 2 and 4.

**Files:**

- Create: `lib/directory/sign-in.ts`, `lib/directory/response-floor.ts`, `lib/auth/directory-provider.ts`, `__tests__/directory-sign-in.test.ts`, `__tests__/directory-response-floor.test.ts`, `__tests__/auth-directory-provider.test.ts`, `__tests__/ldap/sign-in.ldap.test.ts`
- Modify: `lib/auth/options.ts` (the second provider; `source` in the token and the session), `types/next-auth.d.ts`, `lib/error-log.ts` (`SignInRefusalReason`, `logDirectoryEmailConflict`), `__tests__/auth-options.test.ts`

**Interfaces:**

- Consumes: `withDirectory`, `findLoginEntries`, `findGroupByKey`, `isMemberOf` (Task 6); `DirectoryUnavailableError`, `DirectoryRefusedError` (Task 6); `readEntry`, `DirectoryEntry` (Task 5); `listGroupLinks`, `recordDirectorySignIn`, `GroupLink` (Task 3); `directoryConfig` (Task 2); `AccountSource` (Task 1); from `ldapts`: `InvalidCredentialsError`, `StrongAuthRequiredError`, `ConfidentialityRequiredError`.
- Produces:
  - `@/lib/directory/sign-in`: `type DirectoryCheck = { ok: true; entry: DirectoryEntry; groupIds: string[] } | { ok: false; reason: 'unknown_user' | 'ambiguous_user' | 'invalid_entry' | 'wrong_password' }`, `checkDirectoryCredentials(config: LdapConfig, username: string, password: string, links: readonly GroupLink[]): Promise<DirectoryCheck>`.
  - `@/lib/directory/response-floor`: `class ResponseFloor` (`record(ms)`, `floorMs()`, `pad(startedAt)`), `directoryResponseFloor` (the process's instance).
  - `@/lib/auth/directory-provider`: `directoryCredentialsSchema`, `authorizeDirectory(credentials: unknown): Promise<User | null>`.
  - next-auth `User`, `JWT` and `Session['user']` gain `source` (`AccountSource`); the `ldap` provider is registered beside `credentials`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **t. Unknown and known usernames are told apart by nothing, including time, through a response-time floor**, Authelia's shape: every refused directory sign-in waits until the moving average of the last ten successful directory sign-ins (one second until there is one, never under 250 ms) plus 0–85 ms of jitter has passed since it started (`authelia@2ed18389:internal/middlewares/timing_attack_delay.go:36-53, 150-153, 171-172`; wired at `internal/server/handlers.go:265-267`). No surveyed LDAP project binds a dummy DN (Spring Security's `BindAuthenticator`, django-auth-ldap, n8n, `ldap-authentication` and Authelia's provider return at once), and a dummy bind would not time like a wrong password on AD, where a domain controller forwards a wrong password to the PDC emulator (Microsoft Learn, "Password change processing and conflict resolution functionality"; `ad-and-reference-projects.md` B.3). OWASP "Authentication Responses" asks that the "processing time" not tell the cases apart. A `DirectoryUnavailable` answer is not padded: it says nothing about the account. The local tab keeps its bcrypt against the fixed hash for a directory account (Task 1).
- **u. The directory refusing the connection is "unreachable" to the person.** A refused service bind or StartTLS (`DirectoryRefusedError`, Task 6) and `strongerAuthRequired` (8) or `confidentialityRequired` (13) on the user's bind answer `DirectoryUnavailable`, not `CredentialsSignin`: a domain controller that enforces LDAP signing refuses every simple bind over plain `ldap://` with code 8 (new Windows Server 2025 domains by default; Microsoft Learn, "LDAP signing for Active Directory Domain Services", 2026-10-02; Microsoft's own check expects "Strong Authentication Required", "How to enable LDAP signing in Windows Server"), and the person's password is not at fault. Only `invalidCredentials` (49) on the user's bind is a wrong password. The log line names the result code (lib/error-log.ts).
- **v. The account's source travels in the token and the session**, refreshed from the row by the `jwt` callback as the role is, so the account menu can leave out "Change password" for a directory account (Task 8). GitLab hides the button and answers 404 (`gitlabhq@0739b8bf:app/controllers/user_settings/passwords_controller.rb:12,87-89`); Mattermost and Grafana read the source from the user object their UI loads (`auth_service`; `authLabels`); all three refuse on the server (`ad-and-reference-projects.md` B.10), as `changeOwnPassword` does since Task 1.
- **w. The directory's form input:** a username of 1–255 characters after trimming, a password of 1–1,024 characters as typed (RFC 4513 §5.1.2: "Clients SHOULD disallow an empty password input"; spaces can belong to a password); zod's object drops the rest of the POST body that next-auth hands `authorize` (csrfToken, callbackUrl, json; `nextauth-drizzle-antd.md` §A).

- [ ] **Step 1: Write the failing tests for the floor**

Create `__tests__/directory-response-floor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { ResponseFloor } from '@/lib/directory/response-floor'

describe("ResponseFloor (decision t, Authelia's timing delay)", () => {
	it('starts at one second, follows the average of the last ten successes, and never goes under 250 ms', () => {
		const floor = new ResponseFloor()
		expect(floor.floorMs()).toBe(1_000)
		floor.record(400)
		floor.record(600)
		expect(floor.floorMs()).toBe(500)
		for (let i = 0; i < 10; i += 1) floor.record(100)
		expect(floor.floorMs()).toBe(250)
	})

	it('waits the rest of the floor plus jitter, and nothing once it has passed', async () => {
		const sleep = vi.fn(() => Promise.resolve())
		const floor = new ResponseFloor({ random: () => 0.5, sleep, now: () => 1_300 })
		floor.record(800)
		await floor.pad(1_000)
		// 800 + 0.5 * 85 - (1_300 - 1_000)
		expect(sleep).toHaveBeenCalledWith(542.5)
		sleep.mockClear()
		await floor.pad(0)
		expect(sleep).not.toHaveBeenCalled()
	})
})
```

Run: `pnpm exec vitest run __tests__/directory-response-floor.test.ts` Expected: FAIL; the module does not exist.

- [ ] **Step 2: Write `lib/directory/response-floor.ts`**

```ts
import 'server-only'

import { setTimeout as sleepFor } from 'node:timers/promises'

/**
 * A response-time floor for refused directory sign-ins (decision t), the shape of Authelia's TimingAttackDelay: the
 * moving average of the last ten successful sign-ins, one second until there is one, never under 250 ms, plus 0–85 ms of
 * jitter. Kept in the process's memory; each container learns its own.
 */
export class ResponseFloor {
	private readonly samples: number[] = []
	private readonly random: () => number
	private readonly sleep: (ms: number) => Promise<unknown>
	private readonly now: () => number

	constructor(
		options: {
			random?: () => number
			sleep?: (ms: number) => Promise<unknown>
			now?: () => number
		} = {},
	) {
		this.random = options.random ?? Math.random
		this.sleep = options.sleep ?? (ms => sleepFor(ms))
		this.now = options.now ?? (() => performance.now())
	}

	/** A successful sign-in's duration in milliseconds. */
	record(ms: number): void {
		this.samples.push(ms)
		if (this.samples.length > 10) this.samples.shift()
	}

	floorMs(): number {
		const average = this.samples.length
			? this.samples.reduce((sum, sample) => sum + sample, 0) / this.samples.length
			: 1_000
		return Math.max(average, 250)
	}

	/** Waits until the floor plus jitter has passed since `startedAt` (a `performance.now()` reading). */
	async pad(startedAt: number): Promise<void> {
		const wait = this.floorMs() + this.random() * 85 - (this.now() - startedAt)
		if (wait > 0) await this.sleep(wait)
	}
}

/** The process's floor for the `ldap` provider. */
export const directoryResponseFloor = new ResponseFloor()
```

(`performance.now()` and `node:timers/promises` `setTimeout(delay)` are Node 22 globals and APIs: Node docs "Performance measurement APIs", "Timers Promises API".)

Run: `pnpm exec vitest run __tests__/directory-response-floor.test.ts` Expected: PASS.

- [ ] **Step 3: Write the failing tests for the check and the provider**

Create `__tests__/directory-sign-in.test.ts`:

```ts
import {
	ConfidentialityRequiredError,
	InvalidCredentialsError,
	NoSuchObjectError,
	StrongAuthRequiredError,
} from 'ldapts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	withDirectory: vi.fn(),
	findLoginEntries: vi.fn(),
	findGroupByKey: vi.fn(),
	isMemberOf: vi.fn(),
	bind: vi.fn(),
	order: [] as string[],
}))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))
vi.mock('@/lib/directory/operations', () => ({
	findLoginEntries: mocks.findLoginEntries,
	findGroupByKey: mocks.findGroupByKey,
	isMemberOf: mocks.isMemberOf,
}))

import { DirectoryRefusedError } from '@/lib/directory/errors'
import { checkDirectoryCredentials } from '@/lib/directory/sign-in'

const config = {
	idAttribute: 'objectGUID',
	loginAttribute: 'sAMAccountName',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
} as never
const alice = {
	dn: 'CN=Alice Admin,CN=Users,DC=corp',
	objectGUID: Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex'),
	sAMAccountName: 'alice',
	mail: 'alice@corp.example',
	displayName: 'Alice Admin',
}
const links = [
	{
		groupId: 'g1',
		directoryGroupId: 'k-eng',
		directoryGroupName: 'Engineering',
		missingSince: null,
	},
	{
		groupId: 'g2',
		directoryGroupId: 'k-eng',
		directoryGroupName: 'Engineering',
		missingSince: null,
	},
	{ groupId: 'g3', directoryGroupId: 'k-ops', directoryGroupName: 'Ops', missingSince: null },
]

beforeEach(() => {
	for (const fn of [
		mocks.withDirectory,
		mocks.findLoginEntries,
		mocks.findGroupByKey,
		mocks.isMemberOf,
		mocks.bind,
	])
		fn.mockReset()
	mocks.order.length = 0
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work({ bind: mocks.bind }),
	)
	mocks.findLoginEntries.mockResolvedValue([alice])
	mocks.findGroupByKey.mockImplementation(async (_c: unknown, _f: unknown, key: string) => {
		mocks.order.push(`group:${key}`)
		return key === 'k-eng' ? { dn: 'CN=Engineering,DC=corp', name: 'Engineering' } : null
	})
	mocks.isMemberOf.mockResolvedValue(true)
	mocks.bind.mockImplementation(async () => {
		mocks.order.push('bind')
	})
})

describe('checkDirectoryCredentials (spec §6.3)', () => {
	it('searches, resolves the linked groups as the service account, then binds as the entry', async () => {
		expect(await checkDirectoryCredentials(config, 'alice', 'pass word', links)).toEqual({
			ok: true,
			entry: {
				dn: alice.dn,
				key: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
				username: 'alice',
				email: 'alice@corp.example',
				name: 'Alice Admin',
			},
			groupIds: ['g1', 'g2'],
		})
		// Step 4 before step 5: each directory group looked up once, while still bound as the service account.
		expect(mocks.order).toEqual(['group:k-eng', 'group:k-ops', 'bind'])
		expect(mocks.bind).toHaveBeenCalledWith(alice.dn, 'pass word')
	})

	it('refuses an empty password or a blank username before any connection (RFC 4513 §5.1.2)', async () => {
		expect(await checkDirectoryCredentials(config, 'alice', '', links)).toEqual({
			ok: false,
			reason: 'wrong_password',
		})
		expect(await checkDirectoryCredentials(config, '  ', 'x', links)).toEqual({
			ok: false,
			reason: 'unknown_user',
		})
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it.each([
		[[], 'unknown_user'],
		[[alice, alice], 'ambiguous_user'],
		[[{ ...alice, objectGUID: Buffer.alloc(3) }], 'invalid_entry'],
	] as const)('refuses %j entries as %s, and never binds', async (entries, reason) => {
		mocks.findLoginEntries.mockResolvedValue(entries)
		expect(await checkDirectoryCredentials(config, 'alice', 'x', links)).toEqual({
			ok: false,
			reason,
		})
		expect(mocks.bind).not.toHaveBeenCalled()
	})

	it('reads invalidCredentials on the user bind as a wrong password', async () => {
		mocks.bind.mockRejectedValue(new InvalidCredentialsError('bad'))
		expect(await checkDirectoryCredentials(config, 'alice', 'x', links)).toEqual({
			ok: false,
			reason: 'wrong_password',
		})
	})

	it('reads strongerAuthRequired and confidentialityRequired as the directory refusing (decision u)', async () => {
		for (const error of [
			new StrongAuthRequiredError('signing'),
			new ConfidentialityRequiredError('tls'),
		]) {
			mocks.bind.mockRejectedValue(error)
			await expect(checkDirectoryCredentials(config, 'alice', 'x', links)).rejects.toBeInstanceOf(
				DirectoryRefusedError,
			)
		}
	})

	it('passes any other directory answer through', async () => {
		const other = new NoSuchObjectError('gone')
		mocks.bind.mockRejectedValue(other)
		await expect(checkDirectoryCredentials(config, 'alice', 'x', links)).rejects.toBe(other)
	})
})
```

Create `__tests__/auth-directory-provider.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	directoryConfig: vi.fn(),
	checkDirectoryCredentials: vi.fn(),
	listGroupLinks: vi.fn(),
	recordDirectorySignIn: vi.fn(),
	pad: vi.fn(),
	record: vi.fn(),
}))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/sign-in', () => ({
	checkDirectoryCredentials: mocks.checkDirectoryCredentials,
}))
vi.mock('@/lib/data/directory', () => ({
	listGroupLinks: mocks.listGroupLinks,
	recordDirectorySignIn: mocks.recordDirectorySignIn,
}))
vi.mock('@/lib/directory/response-floor', () => ({
	directoryResponseFloor: { pad: mocks.pad, record: mocks.record },
}))

import { authorizeDirectory } from '@/lib/auth/directory-provider'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'

const config = { idAttribute: 'objectGUID' }
const entry = {
	dn: 'CN=Alice',
	key: 'k-alice',
	username: 'alice',
	email: 'alice@corp.example',
	name: 'Alice',
}
const account = {
	id: 'u1',
	email: 'alice@corp.example',
	name: 'Alice',
	role: 'user',
	sessionVersion: 0,
}

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.directoryConfig.mockReturnValue(config)
	mocks.listGroupLinks.mockResolvedValue([])
	mocks.checkDirectoryCredentials.mockResolvedValue({ ok: true, entry, groupIds: ['g1'] })
	mocks.recordDirectorySignIn.mockResolvedValue({ ok: true, account, emailConflict: false })
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	error = vi.spyOn(console, 'error').mockImplementation(() => {})
	return () => {
		warn.mockRestore()
		error.mockRestore()
	}
})

describe('authorizeDirectory (spec §6.3, §7.3)', () => {
	it('signs a directory account in, keyed by its entry, and records the duration for the floor', async () => {
		expect(
			await authorizeDirectory({
				username: ' alice ',
				password: 'pass word',
				csrfToken: 'x',
				json: 'true',
			}),
		).toEqual({
			...account,
			source: 'ldap',
		})
		expect(mocks.checkDirectoryCredentials).toHaveBeenCalledWith(config, 'alice', 'pass word', [])
		expect(mocks.recordDirectorySignIn).toHaveBeenCalledWith(
			{
				key: 'k-alice',
				idAttribute: 'objectGUID',
				username: 'alice',
				email: 'alice@corp.example',
				name: 'Alice',
			},
			['g1'],
		)
		expect(mocks.record).toHaveBeenCalledTimes(1)
		expect(mocks.pad).not.toHaveBeenCalled()
	})

	it('refuses bad input before the directory (decision w)', async () => {
		for (const input of [
			undefined,
			{},
			{ username: 'alice', password: '' },
			{ username: ' ', password: 'x' },
			{ username: 'a'.repeat(256), password: 'x' },
		])
			expect(await authorizeDirectory(input)).toBeNull()
		expect(mocks.checkDirectoryCredentials).not.toHaveBeenCalled()
	})

	it.each([
		[
			'the directory refuses the credentials',
			() =>
				mocks.checkDirectoryCredentials.mockResolvedValue({ ok: false, reason: 'unknown_user' }),
			'unknown_user',
		],
		[
			'an admin deactivated the account',
			() =>
				mocks.recordDirectorySignIn.mockResolvedValue({ ok: false, reason: 'account_inactive' }),
			'account_inactive',
		],
		[
			'the entry has no email',
			() =>
				mocks.recordDirectorySignIn.mockResolvedValue({ ok: false, reason: 'entry_without_email' }),
			'entry_without_email',
		],
		[
			'another account uses the email',
			() => mocks.recordDirectorySignIn.mockResolvedValue({ ok: false, reason: 'email_in_use' }),
			'email_in_use',
		],
		['LDAP is off', () => mocks.directoryConfig.mockReturnValue(null), 'directory_off'],
	])(
		'answers null when %s, logs the reason with the username, and pads the time (decision t)',
		async (_name, arrange, reason) => {
			arrange()
			expect(await authorizeDirectory({ username: 'alice', password: 'secret-pass' })).toBeNull()
			expect(warn).toHaveBeenCalledWith('authorizeDirectory: sign-in refused', {
				username: 'alice',
				reason,
			})
			expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-pass')
			expect(mocks.pad).toHaveBeenCalledTimes(1)
		},
	)

	it('logs an email kept because another account has it', async () => {
		mocks.recordDirectorySignIn.mockResolvedValue({ ok: true, account, emailConflict: true })
		await authorizeDirectory({ username: 'alice', password: 'x' })
		expect(warn).toHaveBeenCalledWith('authorizeDirectory: directory email kept', {
			userId: 'u1',
			reason: 'email_conflict',
		})
	})

	it.each([
		['unreachable', new DirectoryUnavailableError({ cause: new Error('ECONNREFUSED') })],
		[
			'refusing the connection (decision u)',
			new DirectoryRefusedError({ cause: new Error('code 8') }),
		],
	])('throws DirectoryUnavailable when the directory is %s, unpadded', async (_name, failure) => {
		mocks.checkDirectoryCredentials.mockRejectedValue(failure)
		await expect(authorizeDirectory({ username: 'alice', password: 'x' })).rejects.toThrow(
			'DirectoryUnavailable',
		)
		expect(error).toHaveBeenCalled()
		expect(mocks.pad).not.toHaveBeenCalled()
	})

	it('throws Default for anything else, such as a database failure', async () => {
		mocks.recordDirectorySignIn.mockRejectedValue(
			Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' }),
		)
		await expect(authorizeDirectory({ username: 'alice', password: 'x' })).rejects.toThrow(
			'Default',
		)
	})
})
```

In `__tests__/auth-options.test.ts`:

- the expected object of `'answers the account without its hash, with its role and session version'` gains `source: 'local'`; the `row` constant gains `source: 'local'`;
- add a test that the options register two Credentials providers, `credentials` and `ldap`:

```ts
it('registers the local and the directory Credentials providers (next-auth "Multiple providers")', () => {
	expect(authOptions.providers.map(provider => provider.id)).toEqual(['credentials', 'ldap'])
})
```

- in the `jwt` tests: at sign-in the token takes `user.source`; on a later call it takes the row's `source` (add `source: 'ldap'` to the row the refresh reads and expect `token.source` to be `'ldap'`); the `session` callback forwards `token.source` to `session.user.source`.

Add `vi.mock('@/lib/auth/directory-provider', () => ({ authorizeDirectory: vi.fn() }))` at the top of `__tests__/auth-options.test.ts`, so its tests do not load ldapts' client.

Run: `pnpm exec vitest run __tests__/directory-sign-in.test.ts __tests__/auth-directory-provider.test.ts __tests__/auth-options.test.ts` Expected: FAIL.

- [ ] **Step 4: Write `lib/directory/sign-in.ts`**

```ts
import 'server-only'

import {
	ConfidentialityRequiredError,
	InvalidCredentialsError,
	StrongAuthRequiredError,
	type Client,
} from 'ldapts'

import type { GroupLink } from '@/lib/data/directory'
import type { LdapConfig } from '@/lib/env'

import { withDirectory } from './connection'
import { readEntry, type DirectoryEntry } from './entry'
import { DirectoryRefusedError } from './errors'
import { findGroupByKey, findLoginEntries, isMemberOf } from './operations'

export type DirectoryCheck =
	| { ok: true; entry: DirectoryEntry; groupIds: string[] }
	| { ok: false; reason: 'unknown_user' | 'ambiguous_user' | 'invalid_entry' | 'wrong_password' }

/**
 * Spec §6.3 step 4 and §6.5 at sign-in: the hub groups whose links the person is in, nested groups included, each
 * directory group looked up once by its key, while the client is still bound as the service account.
 */
async function linkedGroupsOf(
	client: Client,
	config: LdapConfig,
	userDn: string,
	links: readonly GroupLink[],
): Promise<string[]> {
	const groupIds = new Set<string>()
	for (const [key, groupLinks] of Map.groupBy(links, link => link.directoryGroupId)) {
		const group = await findGroupByKey(client, config, key)
		if (group && (await isMemberOf(client, config, userDn, group.dn)))
			for (const link of groupLinks) groupIds.add(link.groupId)
	}
	return [...groupIds]
}

/**
 * Search, then bind (spec §6.3; the flow of every surveyed project, Apache mod_authnz_ldap "The Authentication Phase":
 * "If the search does not return exactly one entry, deny"). An empty password never reaches a bind (RFC 4513 §5.1.2,
 * §6.3.1; ldapts sends one as it is, `src/messages/BindRequest.ts:31`). One client for the whole check (Task 6); the user's
 * bind is the last step, so nothing runs on the connection once it is bound as the person.
 */
export async function checkDirectoryCredentials(
	config: LdapConfig,
	username: string,
	password: string,
	links: readonly GroupLink[],
): Promise<DirectoryCheck> {
	if (username.trim() === '') return { ok: false, reason: 'unknown_user' }
	if (password === '') return { ok: false, reason: 'wrong_password' }
	return withDirectory(config, async client => {
		const entries = await findLoginEntries(client, config, username)
		if (entries.length === 0) return { ok: false, reason: 'unknown_user' }
		if (entries.length > 1) return { ok: false, reason: 'ambiguous_user' }
		const entry = readEntry(entries[0]!, config)
		if (!entry) return { ok: false, reason: 'invalid_entry' }
		const groupIds = await linkedGroupsOf(client, config, entry.dn, links)
		try {
			await client.bind(entry.dn, password)
		} catch (error) {
			if (error instanceof InvalidCredentialsError) return { ok: false, reason: 'wrong_password' }
			// Decision u: a directory that demands signing or TLS refuses the connection, not the password.
			if (error instanceof StrongAuthRequiredError || error instanceof ConfidentialityRequiredError)
				throw new DirectoryRefusedError({ cause: error })
			throw error
		}
		return { ok: true, entry, groupIds }
	})
}
```

- [ ] **Step 5: Write `lib/auth/directory-provider.ts`**

```ts
import 'server-only'

import type { User } from 'next-auth'
import * as z from 'zod'

import { listGroupLinks, recordDirectorySignIn } from '@/lib/data/directory'
import { directoryConfig } from '@/lib/directory/config'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'
import { directoryResponseFloor } from '@/lib/directory/response-floor'
import { checkDirectoryCredentials } from '@/lib/directory/sign-in'
import {
	logActionError,
	logDirectoryEmailConflict,
	logSignInRefusal,
	type SignInRefusalReason,
} from '@/lib/error-log'

/** Decision w: the username trimmed, the password as typed, both bounded; nothing else of the POST body. */
export const directoryCredentialsSchema = z.object({
	username: z.string().trim().min(1).max(255),
	password: z.string().min(1).max(1024),
})

/**
 * The `ldap` Credentials provider's check (spec §6.3). A refusal answers null, next-auth's `CredentialsSignin`, the
 * same for every account-related reason (spec §7.3; OWASP "Authentication Responses"), logged with its reason and the
 * username, and padded to the response floor (decision t). The directory not answering, or refusing the connection
 * (decision u), throws `DirectoryUnavailable`, which next-auth hands `signIn()` as `result.error`
 * (`node_modules/next-auth/src/core/routes/callback.ts:348-355`); anything else throws `Default` (ADR-0024 decision g),
 * so no driver or directory message reaches the browser.
 */
export async function authorizeDirectory(credentials: unknown): Promise<User | null> {
	const parsed = directoryCredentialsSchema.safeParse(credentials)
	if (!parsed.success) return null
	const { username, password } = parsed.data
	const startedAt = performance.now()
	const refuse = async (reason: SignInRefusalReason) => {
		logSignInRefusal('authorizeDirectory', reason, { username })
		await directoryResponseFloor.pad(startedAt)
		return null
	}
	try {
		const config = directoryConfig()
		if (!config) return await refuse('directory_off')
		const check = await checkDirectoryCredentials(
			config,
			username,
			password,
			await listGroupLinks(),
		)
		if (!check.ok) return await refuse(check.reason)
		const result = await recordDirectorySignIn(
			{
				key: check.entry.key,
				idAttribute: config.idAttribute,
				username: check.entry.username ?? username,
				email: check.entry.email,
				name: check.entry.name,
			},
			check.groupIds,
		)
		if (!result.ok) return await refuse(result.reason)
		if (result.emailConflict)
			logDirectoryEmailConflict('authorizeDirectory', { userId: result.account.id })
		directoryResponseFloor.record(performance.now() - startedAt)
		return { ...result.account, source: 'ldap' }
	} catch (error) {
		logActionError(error, 'authorizeDirectory')
		const unavailable =
			error instanceof DirectoryUnavailableError || error instanceof DirectoryRefusedError
		throw new Error(unavailable ? 'DirectoryUnavailable' : 'Default')
	}
}
```

In `lib/error-log.ts`, widen the union and add the conflict line:

```ts
/**
 * The fixed reason codes of a refused sign-in (B3 spec §7.3). Local: `account_inactive`, `directory_account`. Directory:
 * `directory_off`, the check's `unknown_user`, `ambiguous_user`, `invalid_entry`, `wrong_password`, and the DAL's
 * `account_inactive`, `entry_without_email`, `email_in_use` (ADR-0029).
 */
export type SignInRefusalReason =
	| 'account_inactive'
	| 'directory_account'
	| 'directory_off'
	| 'unknown_user'
	| 'ambiguous_user'
	| 'invalid_entry'
	| 'wrong_password'
	| 'entry_without_email'
	| 'email_in_use'

/** A directory sign-in or refresh kept the stored email because another account has the entry's (spec §2 #11). */
export const logDirectoryEmailConflict = (context: string, subject: { userId: string }): void => {
	console.warn(`${context}: directory email kept`, { ...subject, reason: 'email_conflict' })
}
```

- [ ] **Step 6: The provider, the token and the session**

`types/next-auth.d.ts`: import `type AccountSource` from `@/lib/auth/account-source`; `User` gains `source: AccountSource`; `Session['user']` gains `/** Absent with the id. */ source?: AccountSource`; `JWT` gains `source?: AccountSource`.

`lib/auth/options.ts`:

- import `authorizeDirectory` from `./directory-provider`;
- `findAccount` returns `source: 'local'` with the account (a local sign-in can only be a local account: the passwordless check of Task 1 refused the rest);
- `providers` gains, after the local provider:

```ts
		// next-auth v4 "Multiple providers": "You can specify more than one credentials provider by specifying a unique
		// `id` for each one" (Credentials provider page). The login page's Directory tab posts to /api/auth/callback/ldap.
		CredentialsProvider({
			id: 'ldap',
			name: 'Directory account',
			credentials: {
				username: { label: 'Username', type: 'text' },
				password: { label: 'Password', type: 'password' },
			},
			authorize: authorizeDirectory,
		}),
```

- the `jwt` callback: at sign-in `token.source = user.source`; the refresh reads `source: users.source` with the other columns and sets `token.source = row.source`; the strip on revocation also removes `source` (`const { id: _id, sessionVersion: _version, role: _role, source: _source, ...rest } = token`);
- the `session` callback sets `session.user.source = token.source` beside the role (decision v).

- [ ] **Step 7: Run the unit tests**

Run: `pnpm exec vitest run __tests__/directory-response-floor.test.ts __tests__/directory-sign-in.test.ts __tests__/auth-directory-provider.test.ts __tests__/auth-options.test.ts` Expected: PASS.

- [ ] **Step 8: Write the integration test against the test servers**

Create `__tests__/ldap/sign-in.ldap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { withDirectory } from '@/lib/directory/connection'
import { searchGroups } from '@/lib/directory/operations'
import { checkDirectoryCredentials } from '@/lib/directory/sign-in'

import { PASSWORD, TEST_DIRECTORIES } from './servers'

describe.each(TEST_DIRECTORIES)(
	'checkDirectoryCredentials: $name',
	({ config, people, groups, emailDomain }) => {
		/** A hub group `hub-g` linked to the named directory group. */
		const linkTo = async (name: string) => {
			const [group] = await withDirectory(config, client => searchGroups(client, config, name))
			return [
				{
					groupId: 'hub-g',
					directoryGroupId: group!.key,
					directoryGroupName: group!.name,
					missingSince: null,
				},
			]
		}

		it('signs a person in and finds the hub group linked to a parent of their group', async () => {
			const check = await checkDirectoryCredentials(
				config,
				people.bob,
				PASSWORD,
				await linkTo(groups.engineering),
			)
			expect(check).toMatchObject({
				ok: true,
				groupIds: ['hub-g'],
				entry: { username: people.bob, email: `bob@${emailDomain}` },
			})
		})

		it('answers no group for a link the person is not in', async () => {
			expect(
				await checkDirectoryCredentials(
					config,
					people.alice,
					PASSWORD,
					await linkTo(groups.engineering),
				),
			).toMatchObject({
				ok: true,
				groupIds: [],
			})
		})

		it('refuses a wrong password, an unknown and a disabled person, and a wildcard', async () => {
			expect(await checkDirectoryCredentials(config, people.alice, 'Wrong-Passw0rd', [])).toEqual({
				ok: false,
				reason: 'wrong_password',
			})
			expect(await checkDirectoryCredentials(config, 'nobody', PASSWORD, [])).toEqual({
				ok: false,
				reason: 'unknown_user',
			})
			expect(await checkDirectoryCredentials(config, people.carol, PASSWORD, [])).toEqual({
				ok: false,
				reason: 'unknown_user',
			})
			expect(await checkDirectoryCredentials(config, '*', PASSWORD, [])).toEqual({
				ok: false,
				reason: 'unknown_user',
			})
		})

		it('binds a person whose DN carries an escaped comma, and reads an entry without mail as no email', async () => {
			expect(await checkDirectoryCredentials(config, people.frank, PASSWORD, [])).toMatchObject({
				ok: true,
			})
			expect(await checkDirectoryCredentials(config, people.dave, PASSWORD, [])).toMatchObject({
				ok: true,
				entry: { email: null },
			})
		})
	},
)
```

- [ ] **Step 9: Run it**

```bash
pnpm exec vitest run --project ldap --no-file-parallelism __tests__/ldap/sign-in.ldap.test.ts
```

Expected: PASS on both servers.

- [ ] **Step 10: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/directory/sign-in.ts lib/directory/response-floor.ts lib/auth/directory-provider.ts lib/auth/options.ts types/next-auth.d.ts lib/error-log.ts __tests__/directory-sign-in.test.ts __tests__/directory-response-floor.test.ts __tests__/auth-directory-provider.test.ts __tests__/auth-options.test.ts __tests__/ldap/sign-in.ldap.test.ts
pnpm exec oxfmt --write <the same files> && pnpm exec oxfmt --check <the same files>
pnpm test
git add lib/directory/sign-in.ts lib/directory/response-floor.ts lib/auth/directory-provider.ts lib/auth/options.ts types/next-auth.d.ts lib/error-log.ts __tests__/directory-sign-in.test.ts __tests__/directory-response-floor.test.ts __tests__/auth-directory-provider.test.ts __tests__/auth-options.test.ts __tests__/ldap/sign-in.ldap.test.ts
git commit -m "feat(auth): sign directory accounts in through an ldap provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 8: The login tabs, the account menu and the e2e harness

Spec §6.3 first paragraph (antd `Tabs centered` with "Directory account", the default, and "Local account" when the `LDAP_*` block is set; the current form otherwise; each tab calls `signIn('<provider id>', { redirect: false, … })`), §7.3 (`CredentialsSignin` → the generic message; `DirectoryUnavailable` → "The directory is unreachable. Try again later."; anything else → the generic sign-in error), §7.4, §8 "Playwright" (the app under `next dev` against smblds over LDAPS; `.env.e2e` gets the block with `LDAP_SYNC_SCHEDULE=off`; the B3b sign-in cases). Review Focus: lines 1 and 2.

**Files:**

- Modify: `app/(auth)/login/page.tsx`, `components/auth/login-form.tsx`, `components/auth/auth-failure.ts`, `components/shell/account-dropdown.tsx`, `locales/{en,zh,ar}/translation.json`, `.env.e2e`, `e2e/global-setup.ts`, `e2e/fixtures/users.ts`, `e2e/auth.spec.ts`, `e2e/deactivation.spec.ts`, `__tests__/auth-failure.test.ts`, `__tests__/login-page.test.ts`, `__tests__/account-menu.test.ts`
- Create: `e2e/fixtures/directory.ts`, `e2e/directory-sign-in.spec.ts`

**Interfaces:**

- Consumes: `isDirectoryConfigured` (Task 2); the `ldap` provider and `session.user.source` (Task 7); the `ldap-ad` service and the committed CA (Task 4).
- Produces: `LoginForm`'s `directoryEnabled: boolean` prop; `loginFailureKey(error: string, mode: 'directory' | 'local')`; `getAccountMenuItems`'s `onChangePassword` becomes optional (no item without it); from `e2e/fixtures/users.ts`: `chooseLocalAccount(page)`, `signInWithDirectory(page, username, password)`; from `e2e/fixtures/directory.ts`: `DIRECTORY_PASSWORD`, `resetDirectoryState()`, `deleteDirectoryAccount(email)`, `directoryAccount(email)`, `samba(args: string[])`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **x. The local tab opens first after a password change or first run** (`?notice=password-changed`, `?email=`): only a local account changes a hub password or is created by `/init`; otherwise the directory tab opens first, as GitLab's first LDAP tab is active (`gitlabhq@0739b8bf:app/views/devise/shared/_tabs_ldap.html.haml:7-13`) and Open WebUI starts in LDAP mode (`open-webui@8bd8b4fa:src/routes/auth/+page.svelte:34`). The chosen tab is not remembered, as in Open WebUI (`ad-and-reference-projects.md` B.8).
- **y. Each tab is its own form in its own tab pane**, rendered only while active (antd Tabs `items[].children` and `destroyOnHidden`), so the tab panel holds the form it names (WAI-ARIA APG "Tabs Pattern": each tab "displays its associated tabpanel") and the two password fields never coexist; Ant Design Pro's login page renders label-only tabs with the fields below (`ant-design-pro@24de7e34:src/pages/user/login/index.tsx:221-241`), which leaves the tab panels empty. The forgot-password link shows on the local tab only (a directory account has no hub password, spec §12).
- **z. The failure text names the tab's identifier**: "Check your username and password" on the directory tab (`auth.directory_login_failed`, the spec's text) and the existing "Check your email and password" (`auth.login_failed`) on the local tab.
- **aa. The e2e suite runs with the LDAP block on**, so every spec sees the tabs: the local sign-in helpers choose "Local account" first. A Samba provisioned again issues new `objectGUID`s while the e2e MySQL is reused, so the global setup deletes the directory accounts and links left from a previous run before any spec (`ldap-test-servers.md` §5 "State rule").

- [ ] **Step 1: Write the failing unit tests**

In `__tests__/auth-failure.test.ts`, replace the `loginFailureKey` describe with:

```ts
// next-auth answers CredentialsSignin when authorize() returned null; a thrown Error arrives as its own message: the
// `ldap` provider throws DirectoryUnavailable when the directory does not answer, both providers `Default` otherwise.
describe('loginFailureKey', () => {
	it('names the identifier of the tab for a refused credential (decision z)', () => {
		expect(loginFailureKey('CredentialsSignin', 'local')).toBe('auth.login_failed')
		expect(loginFailureKey('CredentialsSignin', 'directory')).toBe('auth.directory_login_failed')
	})

	it('says the directory is unreachable, and anything else is the generic error', () => {
		expect(loginFailureKey('DirectoryUnavailable', 'directory')).toBe('auth.directory_unavailable')
		expect(loginFailureKey('Default', 'directory')).toBe('auth.login_error')
		expect(loginFailureKey('Configuration', 'local')).toBe('auth.login_error')
	})
})
```

In `__tests__/login-page.test.ts`, mock `@/lib/directory/config` (`vi.mock('@/lib/directory/config', () => ({ isDirectoryConfigured }))` with a hoisted `isDirectoryConfigured: vi.fn(() => false)`), add `directoryEnabled: false` to the expected props, and add:

```ts
it('tells the form whether the directory tab exists (spec §6.3)', async () => {
	isDirectoryConfigured.mockReturnValue(true)
	const page = await LoginPage({ searchParams: Promise.resolve({}) })
	expect(page).toMatchObject({ props: { directoryEnabled: true } })
})
```

In `__tests__/account-menu.test.ts`, add:

```ts
// Decision v: a directory account has no hub password; the menu leaves the entry out (GitLab hides it).
it('leaves out change password without its handler', () => {
	const items = getAccountMenuItems({ email: 'bob@corp.example', t, onLogout: vi.fn() })
	expect(items.map(item => item?.key)).toEqual(['account', 'logout'])
})
```

Run: `pnpm exec vitest run __tests__/auth-failure.test.ts __tests__/login-page.test.ts __tests__/account-menu.test.ts` Expected: FAIL.

- [ ] **Step 2: The failure mapping and the page**

`components/auth/auth-failure.ts`:

```ts
/**
 * next-auth's sign-in error as a translation key. `CredentialsSignin` is its code for an authorize() that returned
 * null (next-auth Pages, "Error codes"), named by the tab's identifier (decision z); `DirectoryUnavailable` is the
 * `ldap` provider's thrown code when the directory does not answer (spec §7.3); any other code is a failure the user
 * cannot fix by retyping, such as the `Default` both providers throw when the database fails.
 */
export const loginFailureKey = (error: string, mode: 'directory' | 'local') => {
	if (error === 'CredentialsSignin')
		return mode === 'directory'
			? ('auth.directory_login_failed' as const)
			: ('auth.login_failed' as const)
	if (error === 'DirectoryUnavailable') return 'auth.directory_unavailable' as const
	return 'auth.login_error' as const
}
```

`app/(auth)/login/page.tsx`: import `isDirectoryConfigured` from `@/lib/directory/config` and pass `directoryEnabled={isDirectoryConfigured()}`; the comment gains "and shows the directory tab when the `LDAP_*` block is set (spec §6.3)".

- [ ] **Step 3: The form**

Rewrite `components/auth/login-form.tsx`:

```tsx
'use client'

import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Tabs, theme, Typography } from 'antd'
import { getSession, signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSafeCallbackUrl } from '@/lib/access'

import { loginFailureKey } from './auth-failure'
import styles from './login-form.module.css'

type Mode = 'directory' | 'local'

/** The submit flow both tabs share: `signIn` without redirect, then the safe callback (spec §7.2 of sub-project 3). */
function useSignIn(callbackUrl: string | undefined) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [loading, setLoading] = useState(false)
	const submit = async (mode: Mode, values: Record<string, string>) => {
		setLoading(true)
		try {
			const result = await signIn(mode === 'directory' ? 'ldap' : 'credentials', {
				...values,
				redirect: false,
			})
			if (result?.error) {
				message.error(t(loginFailureKey(result.error, mode)))
				return
			}
			message.success(t('auth.login_success'))
			if (await getSession()) router.push(getSafeCallbackUrl(callbackUrl))
		} catch (error) {
			console.error('Error during login', error)
			message.error(t('auth.login_error'))
		} finally {
			setLoading(false)
		}
	}
	return { loading, submit }
}

function DirectoryForm({
	loading,
	onSubmit,
}: {
	loading: boolean
	onSubmit: (values: Record<string, string>) => void
}) {
	const { t } = useTranslation()
	return (
		<Form
			name="login-directory"
			layout="vertical"
			size="large"
			autoComplete="off"
			onFinish={onSubmit}
		>
			<Form.Item
				name="username"
				label={t('auth.username')}
				rules={[{ required: true, whitespace: true, message: t('auth.username_required') }]}
			>
				<Input
					prefix={<UserOutlined />}
					placeholder={t('auth.username_placeholder')}
					autoComplete="username"
				/>
			</Form.Item>
			<Form.Item
				name="password"
				label={t('auth.password')}
				rules={[{ required: true, message: t('auth.password_required') }]}
			>
				<Input.Password
					prefix={<LockOutlined />}
					placeholder={t('auth.password')}
					autoComplete="current-password"
				/>
			</Form.Item>
			<Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					block
					loading={loading}
				>
					{t('auth.login')}
				</Button>
			</Form.Item>
		</Form>
	)
}

function LocalForm({
	email,
	loading,
	mailConfigured,
	onSubmit,
}: {
	email?: string
	loading: boolean
	mailConfigured: boolean
	onSubmit: (values: Record<string, string>) => void
}) {
	const { t } = useTranslation()
	return (
		<Form
			name="login"
			layout="vertical"
			size="large"
			autoComplete="off"
			initialValues={email ? { email } : undefined}
			onFinish={onSubmit}
		>
			<Form.Item
				name="email"
				label={t('auth.email')}
				rules={[
					{ required: true, message: t('auth.email_required') },
					{ type: 'email', message: t('auth.email_invalid') },
				]}
			>
				<Input
					prefix={<MailOutlined />}
					placeholder={t('auth.email_placeholder')}
				/>
			</Form.Item>
			<Form.Item
				name="password"
				label={t('auth.password')}
				rules={[{ required: true, message: t('auth.password_required') }]}
			>
				<Input.Password
					prefix={<LockOutlined />}
					placeholder={t('auth.password')}
				/>
			</Form.Item>
			<Form.Item>
				<Button
					type="primary"
					htmlType="submit"
					block
					loading={loading}
				>
					{t('auth.login')}
				</Button>
			</Form.Item>
			{mailConfigured && (
				<div className={styles.forgot}>
					<Link href="/forgot-password">{t('auth.forgot_password_link')}</Link>
				</div>
			)}
		</Form>
	)
}

/**
 * The login page's form (spec §6.3). With the directory configured: antd `Tabs centered`, "Directory account" first
 * (decision x), each tab its own form in its own pane (decision y), posting to the `ldap` or the `credentials`
 * provider. Without it: the local form alone, as before. A password change lands here with a notice (charter §4.2);
 * the "Forgot password?" link shows on the local form only when mail is configured (ADR-0024).
 */
export default function LoginForm({
	callbackUrl,
	email,
	notice,
	mailConfigured,
	directoryEnabled,
}: {
	callbackUrl?: string
	email?: string
	notice?: 'password-changed'
	mailConfigured: boolean
	directoryEnabled: boolean
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { loading, submit } = useSignIn(callbackUrl)
	const [mode, setMode] = useState<Mode>(
		directoryEnabled && !email && !notice ? 'directory' : 'local',
	)
	const local = (
		<LocalForm
			email={email}
			loading={loading}
			mailConfigured={mailConfigured}
			onSubmit={values => void submit('local', values)}
		/>
	)

	return (
		<>
			{notice === 'password-changed' && (
				<Alert
					type="success"
					showIcon
					title={t('account.password_changed')}
					style={{ marginBottom: token.marginLG }}
				/>
			)}
			<Typography.Paragraph
				className={styles.subtitle}
				style={{ marginBottom: token.marginLG }}
			>
				{t('auth.login_subtitle')}
			</Typography.Paragraph>
			{directoryEnabled ? (
				<Tabs
					centered
					activeKey={mode}
					onChange={key => setMode(key as Mode)}
					destroyOnHidden
					items={[
						{
							key: 'directory',
							label: t('auth.directory_account'),
							children: (
								<DirectoryForm
									loading={loading}
									onSubmit={values => void submit('directory', values)}
								/>
							),
						},
						{ key: 'local', label: t('auth.local_account'), children: local },
					]}
				/>
			) : (
				local
			)}
		</>
	)
}
```

Check two antd 6.6.5 props with the CLI before relying on them, and use what it documents if it differs (rule R0): `npx -y @ant-design/cli info Tabs --version 6.6.5` (`destroyOnHidden`, `centered`, `items[].children`) and `npx -y @ant-design/cli info Alert --version 6.6.5` (`title`, which the current form already uses).

- [ ] **Step 4: The account menu**

In `components/shell/account-dropdown.tsx`, `IAccountMenuItemsOptions.onChangePassword` becomes optional (`onChangePassword?: () => void`), `getAccountMenuItems` adds the change-password item only when it is given (`...(onChangePassword ? [{ key: 'change-password', … }] : [])`), and `AccountDropdown` passes it only when `session?.user?.source !== 'ldap'` (decision v), rendering `ChangePasswordModal` in the same case.

- [ ] **Step 5: The texts**

Add to `auth` in each translation file:

| Key | en | zh | ar |
| --- | --- | --- | --- |
| `directory_account` | Directory account | 目录账户 | حساب الدليل |
| `local_account` | Local account | 本地账户 | حساب محلي |
| `username` | Username | 用户名 | اسم المستخدم |
| `username_placeholder` | Your directory username | 你的目录用户名 | اسم المستخدم في الدليل |
| `username_required` | Enter your username | 请输入用户名 | أدخل اسم المستخدم |
| `directory_login_failed` | Login failed. Check your username and password. | 登录失败，请检查用户名和密码 | فشل تسجيل الدخول. تحقق من اسم المستخدم وكلمة المرور. |
| `directory_unavailable` | The directory is unreachable. Try again later. | 无法连接目录，请稍后重试。 | تعذّر الوصول إلى الدليل. حاول مرة أخرى لاحقًا. |

Run: `pnpm exec vitest run __tests__/auth-failure.test.ts __tests__/login-page.test.ts __tests__/account-menu.test.ts` Expected: PASS (with `pnpm test`'s locale parity test).

- [ ] **Step 6: The e2e environment and harness**

Append to `.env.e2e` the block of `ldap-test-servers.md` §7.5 (every key set, so nothing leaks in from a developer's `.env`; Next does not override a variable already in `process.env`):

```dotenv
# Directory sign-in against the smblds test directory over LDAPS (docker-compose.e2e.yml ldap-ad; ADR-0029).
LDAP_URL=ldaps://127.0.0.1:10636
LDAP_ENCRYPTION=ldaps
LDAP_CA_FILE=e2e/fixtures/ldap/tls/ca.crt
LDAP_BIND_DN=CN=svc-hub,CN=Users,DC=e2e,DC=hub,DC=test
LDAP_BIND_PASSWORD=E2e-Svc-Passw0rd
LDAP_USER_BASE_DN=CN=Users,DC=e2e,DC=hub,DC=test
LDAP_USER_FILTER=(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
LDAP_LOGIN_ATTRIBUTE=sAMAccountName
LDAP_ID_ATTRIBUTE=objectGUID
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_NAME_ATTRIBUTE=displayName
LDAP_GROUP_BASE_DN=CN=Users,DC=e2e,DC=hub,DC=test
LDAP_GROUP_FILTER=(objectClass=group)
LDAP_GROUP_NAME_ATTRIBUTE=cn
LDAP_GROUP_MEMBER_FILTER=(memberOf:1.2.840.113556.1.4.1941:={group_dn})
LDAP_SYNC_SCHEDULE=off
LDAP_SYNC_TIMEZONE=UTC
```

Create `e2e/fixtures/directory.ts`:

```ts
import { execFileSync } from 'node:child_process'

import type { RowDataPacket } from 'mysql2/promise'

import { withDb } from './db'

/** The seeded people's password in the smblds test directory (e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh). */
export const DIRECTORY_PASSWORD = 'E2e-Dir-Passw0rd'

/**
 * Decision aa: a Samba provisioned again issues new objectGUIDs, so the directory accounts and links a previous run left
 * in the reused e2e MySQL would collide with the next first sign-in. Deleting the accounts removes their memberships
 * (ON DELETE CASCADE, ADR-0027).
 */
export const resetDirectoryState = () =>
	withDb(async db => {
		await db.execute('DELETE FROM user_group_directory_links')
		await db.execute("DELETE FROM users WHERE source = 'ldap'")
		await db.execute('DELETE FROM directory_sync_runs')
	})

export const deleteDirectoryAccount = (email: string) =>
	withDb(db => db.execute("DELETE FROM users WHERE source = 'ldap' AND email = ?", [email]))

/** The directory account with this email as the database holds it, or undefined. */
export const directoryAccount = (email: string) =>
	withDb(async db => {
		const [rows] = await db.execute<RowDataPacket[]>(
			'SELECT id, source, role, password, directory_id, directory_id_attribute, directory_username, directory_deactivated_at FROM users WHERE email = ?',
			[email],
		)
		return rows[0]
	})

/** Runs samba-tool in the test directory (`docker compose exec`, documented); a spec restores what it changes in `finally`. */
export const samba = (args: string[]) =>
	execFileSync(
		'docker',
		['compose', '-f', 'docker-compose.e2e.yml', 'exec', '-T', 'ldap-ad', 'samba-tool', ...args],
		{
			stdio: 'pipe',
		},
	)
```

`e2e/global-setup.ts`:

```ts
import { execSync } from 'node:child_process'

import { resetDirectoryState } from './fixtures/directory'
import { e2eEnv } from './fixtures/env'

/**
 * Starts the tmpfs MySQL and the smblds test directory (an already running container is reused, so MySQL's data
 * persists until `docker compose -f docker-compose.e2e.yml down`), applies the migrations, and clears the directory
 * accounts a previous run left (decision aa). ldap-ad is started by name: its profile keeps it out of a plain `up`
 * (Docker docs, "Using profiles with Compose"). Admin and app seeding happen in e2e/auth.setup.ts (they need the app).
 */
export default async function globalSetup() {
	execSync(
		'docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 300 mysql ldap-ad',
		{
			stdio: 'inherit',
		},
	)
	execSync('pnpm exec drizzle-kit migrate', {
		stdio: 'inherit',
		env: { ...process.env, DATABASE_URL: e2eEnv.DATABASE_URL },
	})
	await resetDirectoryState()
}
```

In `e2e/fixtures/users.ts`, add and use:

```ts
/** The login page shows the two tabs in the e2e suite (decision aa): local accounts sign in on "Local account". */
export const chooseLocalAccount = async (page: Page) => {
	await page.getByRole('tab', { name: 'Local account' }).click()
	await expect(page.getByLabel('Email')).toBeVisible()
}

/** Signs in through the login form's local tab and waits for the landing page. */
export const signInAs = async (page: Page, email: string, password: string) => {
	await page.goto('/login')
	await chooseLocalAccount(page)
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page).toHaveURL(/\/apps$/)
}

/** Signs in through the directory tab, the login page's default (spec §6.3). */
export const signInWithDirectory = async (page: Page, username: string, password: string) => {
	await page.goto('/login')
	await expect(page.getByRole('tab', { name: 'Directory account', selected: true })).toBeVisible()
	await page.getByLabel('Username').fill(username)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Log in' }).click()
}
```

The specs that fill the local form directly choose the local tab first: `e2e/auth.spec.ts` (the wrong-password case and the `callbackUrl` case: `await chooseLocalAccount(page)` after the `goto`; the reset case after `toHaveURL(/\/login$/)`), and `e2e/deactivation.spec.ts` (after `toHaveURL(/\/login/)`). `e2e/account.spec.ts` lands on `/login?notice=password-changed`, which opens the local tab (decision x), and needs no change. Run `grep -n "getByLabel('Email')" e2e/*.spec.ts` to check that no other spec fills the login form.

- [ ] **Step 7: The directory sign-in spec**

Create `e2e/directory-sign-in.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { DIRECTORY_PASSWORD, deleteDirectoryAccount, directoryAccount } from './fixtures/directory'
import { deleteUsersLike, seedUser, signInWithDirectory } from './fixtures/users'

// Spec §8 "Playwright" (B3b): the tabs, a first directory sign-in, and the generic answer for every account-related
// refusal (spec §7.3). The directory's people are the smblds seed (e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh).
test.describe('directory sign-in (ADR-0029)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test.afterEach(async () => {
		await deleteDirectoryAccount('alice@e2e.hub.test')
		await deleteUsersLike(`dir-local-${test.info().project.name}%`)
		await deleteUsersLike('erin@e2e.hub.test')
	})

	test('shows the directory tab first and the local tab beside it', async ({ page }) => {
		await page.goto('/login')
		await expect(page.getByRole('tab', { name: 'Directory account', selected: true })).toBeVisible()
		await expect(page.getByLabel('Username')).toBeVisible()
		await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveCount(0)
		await page.getByRole('tab', { name: 'Local account' }).click()
		await expect(page.getByLabel('Email')).toBeVisible()
		await expect(page.getByLabel('Username')).toHaveCount(0)
	})

	test('creates a directory account at the first sign-in, linked by its key, without a hub password', async ({
		page,
	}) => {
		await signInWithDirectory(page, 'alice', DIRECTORY_PASSWORD)
		await expect(page).toHaveURL(/\/apps$/)
		const account = await directoryAccount('alice@e2e.hub.test')
		expect(account).toMatchObject({
			source: 'ldap',
			role: 'user',
			password: null,
			directory_id_attribute: 'objectGUID',
			directory_username: 'alice',
		})
		expect(String(account!.directory_id)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		)
		// Decision v: the account menu has no password change for a directory account.
		await page.getByRole('button', { name: /Signed in as/ }).click()
		await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Change password' })).toHaveCount(0)
	})

	test.describe('answers every refusal with the same message (spec §7.3)', () => {
		const refused = 'Login failed. Check your username and password.'

		test('a wrong password', async ({ page }) => {
			await signInWithDirectory(page, 'alice', 'Not-the-Passw0rd')
			await expect(page.getByText(refused)).toBeVisible()
			await expect(page).toHaveURL(/\/login/)
		})

		test('an entry without an email', async ({ page }) => {
			await signInWithDirectory(page, 'dave', DIRECTORY_PASSWORD)
			await expect(page.getByText(refused)).toBeVisible()
			expect(await directoryAccount('dave@e2e.hub.test')).toBeUndefined()
		})

		test('a disabled directory account', async ({ page }) => {
			await signInWithDirectory(page, 'carol', DIRECTORY_PASSWORD)
			await expect(page.getByText(refused)).toBeVisible()
		})

		// Spec §2 #10 and §7.2: a local account's email is never taken over by a directory sign-in.
		test('an email a local account uses', async ({ page }) => {
			await seedUser({ email: 'erin@e2e.hub.test', password: 'local-pass-1', name: 'Local Erin' })
			await signInWithDirectory(page, 'erin', DIRECTORY_PASSWORD)
			await expect(page.getByText(refused)).toBeVisible()
			expect(await directoryAccount('erin@e2e.hub.test')).toMatchObject({ source: 'local' })
		})
	})
})
```

The local account seeded for erin uses the directory's email, which carries no project name; `afterEach` deletes it by that email, and the three projects run one after another (`workers: 1`).

Run (with `pnpm dev` stopped):

```bash
pnpm exec playwright test e2e/directory-sign-in.spec.ts e2e/auth.spec.ts e2e/deactivation.spec.ts e2e/account.spec.ts e2e/roles.spec.ts
```

Expected: every test passes on the three projects (`auth.setup.ts` signs the owner in through `signInAs`, so the setup project passes first).

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <every changed .ts/.tsx file>
pnpm exec oxfmt --write <every changed file> && pnpm exec oxfmt --check <every changed file>
npx -y @ant-design/cli lint ./
pnpm test
git add "app/(auth)/login/page.tsx" components/auth/login-form.tsx components/auth/auth-failure.ts components/shell/account-dropdown.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json .env.e2e e2e/global-setup.ts e2e/fixtures/users.ts e2e/fixtures/directory.ts e2e/auth.spec.ts e2e/deactivation.spec.ts e2e/directory-sign-in.spec.ts __tests__/auth-failure.test.ts __tests__/login-page.test.ts __tests__/account-menu.test.ts
git commit -m "feat(auth): add the directory tab to the login page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 9: The sync plan and the sync's writes

Spec §6.4 steps 2–5 (safety stops, account reconciliation, linked groups, the run row), §2 #12 (the lifecycle), §6.5 (a hub group's directory members are the hub `ldap` accounts found in any of its links). ADR-0027's B3b notes. Review Focus: lines 3 and 5.

**Files:**

- Create: `lib/directory/plan.ts`, `__tests__/directory-plan.test.ts`, `__tests__/data-directory-sync.test.ts`
- Modify: `lib/data/directory.ts`

**Interfaces:**

- Consumes: `lib/data/directory.ts` (Task 3), `isDuplicateEntry`, `isMissingReference` from `./db-errors`; `SyncTrigger`, `SyncOutcome`, `SyncErrorCode` from `@/lib/directory-status` (Task 1).
- Produces, from `@/lib/directory/plan` (pure):
  - `interface SyncAccount { id: string; directoryId: string | null; directoryIdAttribute: string | null; email: string; name: string | null; directoryUsername: string | null; directoryDeactivatedAt: Date | null }`
  - `interface SyncEntry { key: string; username: string | null; email: string | null; name: string | null }`
  - `interface AccountUpdate { id: string; name: string | null; directoryUsername: string | null; email: string | null }` (`email` null keeps the stored one)
  - `type AccountPlan = { stop: 'empty' | 'id_attribute_changed' } | { stop: null; deactivate: string[]; reactivate: string[]; updates: AccountUpdate[]; accountIdByKey: Map<string, string> }`
  - `planAccountChanges(accounts: readonly SyncAccount[], entries: readonly SyncEntry[], idAttribute: string): AccountPlan`
  - `interface MembershipRow { groupId: string; userId: string }`
  - `type LinkLookup = { groupId: string; directoryGroupId: string; result: { status: 'found'; name: string; memberKeys: ReadonlySet<string> } | { status: 'missing' } | { status: 'error' } }`
  - `interface LinkRefresh { groupId: string; directoryGroupId: string; name: string | null }` (`name` null: not found)
  - `interface MembershipPlan { add: MembershipRow[]; remove: MembershipRow[]; groupErrors: number; linkRefreshes: LinkRefresh[] }`
  - `planDirectoryMemberships(lookups: readonly LinkLookup[], accountIdByKey: ReadonlyMap<string, string>, current: readonly MembershipRow[]): MembershipPlan`
- Produces, added to `@/lib/data/directory`:
  - `listDirectoryAccounts(): Promise<SyncAccount[]>`, `listDirectoryMemberships(): Promise<MembershipRow[]>`
  - `deactivateDirectoryAccounts(ids: readonly string[], at: Date): Promise<number>`, `reactivateDirectoryAccounts(ids: readonly string[]): Promise<number>`, `refreshDirectoryAccount(update: AccountUpdate): Promise<{ conflict: boolean }>`
  - `applyMembershipChanges(plan: Pick<MembershipPlan, 'add' | 'remove'>): Promise<{ added: number; removed: number; groupErrors: number }>`, `refreshGroupLinks(refreshes: readonly LinkRefresh[], at: Date): Promise<void>`
  - `interface SyncRunCounts { entriesSeen: number; deactivated: number; reactivated: number; updated: number; conflicts: number; groupErrors: number; membershipsAdded: number; membershipsRemoved: number }`, `EMPTY_COUNTS: SyncRunCounts`
  - `claimSyncRun(run: { id: string; slot: string; trigger: SyncTrigger; startedAt: Date }): Promise<boolean>`, `hasUnfinishedRunSince(since: Date): Promise<boolean>`, `finishSyncRun(id: string, outcome: Exclude<SyncOutcome, 'running'>, counts: SyncRunCounts, errorCode: SyncErrorCode | null, at: Date): Promise<void>`, `pruneSyncRuns(before: Date): Promise<void>`
  - `interface SyncRunRecord { id: string; trigger: SyncTrigger; startedAt: Date; finishedAt: Date | null; outcome: SyncOutcome; errorCode: string | null; counts: SyncRunCounts }`, `latestSyncRun(): Promise<SyncRunRecord | null>`, `lastSucceededSyncRun(): Promise<SyncRunRecord | null>`

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **ab. A pure plan, then the writes.** The reconciliation is computed by pure functions from the hub's accounts and the directory's entries, then applied; the pure part carries the safety stops and has its own tests. n8n's LDAP sync does the same: `getUsersToCreate`, `getUsersToUpdate` and `getUsersToDisable` compute the sets that `processUsers` then writes (`n8n-io/n8n@5b78e8b6:packages/cli/src/modules/ldap.ee/ldap.service.ee.ts:430-433, 506-572`; `helpers.ee.ts:170-200`); Backstage's LDAP module reads, transforms, then applies the whole state (`backstage@75128025:plugins/catalog-backend-module-ldap/src/processors/LdapOrgEntityProvider.ts:274-317`); Keycloak reports counters per run (`keycloak@c7de391a:server-spi/src/main/java/org/keycloak/storage/user/SynchronizationResult.java:25-30`). Neither n8n nor Backstage has an empty-result stop in that path (an empty search disables every n8n LDAP account), so the spec's stops live in the plan (`ad-and-reference-projects.md` B.5).
- **ac. The unique index arbitrates an email conflict.** The plan only says "this email changed"; the write tries it and, when the unique index refuses (1062), writes the other fields and counts a conflict. The index compares as MySQL's collation does, which code cannot imitate (B3a: `utf8mb4_0900_ai_ci` is case- and accent-insensitive).
- **ad. A group whose lookup failed is left whole.** When one of a hub group's links errors, none of that group's directory memberships change (spec §6.4 step 4 "leave that group's memberships untouched"); a group with no link left loses its directory members (decision f).
- **ae. Writes in batches of 1,000 ids**, under MySQL's 65,535 placeholders per prepared statement (MySQL 8.4 Error Reference, `ER_PS_MANY_PARAM` 1390), each its own statement; the reconciliation is idempotent (spec §6.4 "Claim"), so a run cut short is completed by the next.

- [ ] **Step 1: Write the failing plan tests**

Create `__tests__/directory-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	planAccountChanges,
	planDirectoryMemberships,
	type SyncAccount,
} from '@/lib/directory/plan'

const account = (
	overrides: Partial<SyncAccount> & { id: string; directoryId: string },
): SyncAccount => ({
	directoryIdAttribute: 'objectGUID',
	email: `${overrides.id}@example.com`,
	name: overrides.id,
	directoryUsername: overrides.id,
	directoryDeactivatedAt: null,
	...overrides,
})
const entry = (
	key: string,
	overrides: Partial<{ username: string | null; email: string | null; name: string | null }> = {},
) => ({
	key,
	username: key.replace('key-', ''),
	email: `${key.replace('key-', '')}@example.com`,
	name: key.replace('key-', ''),
	...overrides,
})

describe('planAccountChanges (spec §6.4 steps 2–3)', () => {
	// Safety stops: no account changes.
	it('stops on zero entries', () => {
		expect(
			planAccountChanges([account({ id: 'a', directoryId: 'key-a' })], [], 'objectGUID'),
		).toEqual({
			stop: 'empty',
		})
	})

	it('stops when any account was keyed by another attribute', () => {
		const accounts = [
			account({ id: 'a', directoryId: 'key-a' }),
			account({ id: 'b', directoryId: 'key-b', directoryIdAttribute: 'entryUUID' }),
		]
		expect(planAccountChanges(accounts, [entry('key-a')], 'objectGUID')).toEqual({
			stop: 'id_attribute_changed',
		})
		// Attribute names compare without case (RFC 4512 §2.5: "attribute type names … are case insensitive").
		expect(
			planAccountChanges(
				[account({ id: 'a', directoryId: 'key-a' })],
				[entry('key-a')],
				'OBJECTGUID',
			).stop,
		).toBeNull()
	})

	it('deactivates the absent, reactivates the returned, and leaves the rest', () => {
		const accounts = [
			account({ id: 'present', directoryId: 'key-present' }),
			account({ id: 'gone', directoryId: 'key-gone' }),
			account({
				id: 'already-gone',
				directoryId: 'key-already-gone',
				directoryDeactivatedAt: new Date(),
			}),
			account({ id: 'back', directoryId: 'key-back', directoryDeactivatedAt: new Date() }),
		]
		const plan = planAccountChanges(
			accounts,
			[entry('key-present'), entry('key-back'), entry('key-stranger')],
			'objectGUID',
		)
		expect(plan).toMatchObject({
			stop: null,
			deactivate: ['gone'],
			reactivate: ['back'],
			updates: [],
		})
		// Entries without a hub account are ignored: accounts are created at first sign-in only (spec §6.4 step 3).
		if (plan.stop === null)
			expect([...plan.accountIdByKey.keys()].sort()).toEqual([
				'key-already-gone',
				'key-back',
				'key-gone',
				'key-present',
			])
	})

	it('refreshes name, username and email; an entry without an email or username keeps the stored one', () => {
		const accounts = [
			account({ id: 'renamed', directoryId: 'key-renamed' }),
			account({ id: 'moved', directoryId: 'key-moved' }),
			account({ id: 'bare', directoryId: 'key-bare' }),
		]
		const plan = planAccountChanges(
			accounts,
			[
				entry('key-renamed', { name: 'Renamed Person' }),
				entry('key-moved', { email: 'new@example.com' }),
				entry('key-bare', { email: null, username: null }),
			],
			'objectGUID',
		)
		expect(plan.stop === null && plan.updates).toEqual([
			{ id: 'renamed', name: 'Renamed Person', directoryUsername: 'renamed', email: null },
			{ id: 'moved', name: 'moved', directoryUsername: 'moved', email: 'new@example.com' },
		])
	})
})

describe('planDirectoryMemberships (spec §6.4 step 4, §6.5)', () => {
	const ids = new Map([
		['key-a', 'a'],
		['key-b', 'b'],
		['key-c', 'c'],
	])

	it('makes each group the union of its links, adding and removing directory rows only', () => {
		const plan = planDirectoryMemberships(
			[
				{
					groupId: 'g1',
					directoryGroupId: 'd1',
					result: { status: 'found', name: 'Engineering', memberKeys: new Set(['key-a', 'key-x']) },
				},
				{
					groupId: 'g1',
					directoryGroupId: 'd2',
					result: { status: 'found', name: 'Backend', memberKeys: new Set(['key-b']) },
				},
			],
			ids,
			[
				{ groupId: 'g1', userId: 'a' },
				{ groupId: 'g1', userId: 'c' },
			],
		)
		expect(plan.add).toEqual([{ groupId: 'g1', userId: 'b' }])
		expect(plan.remove).toEqual([{ groupId: 'g1', userId: 'c' }])
		expect(plan.groupErrors).toBe(0)
		expect(plan.linkRefreshes).toEqual([
			{ groupId: 'g1', directoryGroupId: 'd1', name: 'Engineering' },
			{ groupId: 'g1', directoryGroupId: 'd2', name: 'Backend' },
		])
	})

	it('treats a missing directory group as empty, and records it missing', () => {
		const plan = planDirectoryMemberships(
			[{ groupId: 'g1', directoryGroupId: 'd1', result: { status: 'missing' } }],
			ids,
			[{ groupId: 'g1', userId: 'a' }],
		)
		expect(plan.remove).toEqual([{ groupId: 'g1', userId: 'a' }])
		expect(plan.linkRefreshes).toEqual([{ groupId: 'g1', directoryGroupId: 'd1', name: null }])
	})

	// Decision ad: one failed link leaves its whole hub group untouched, and counts the error.
	it('leaves a group with a failed lookup untouched', () => {
		const plan = planDirectoryMemberships(
			[
				{ groupId: 'g1', directoryGroupId: 'd1', result: { status: 'error' } },
				{
					groupId: 'g1',
					directoryGroupId: 'd2',
					result: { status: 'found', name: 'Backend', memberKeys: new Set(['key-b']) },
				},
			],
			ids,
			[{ groupId: 'g1', userId: 'a' }],
		)
		expect(plan).toMatchObject({ add: [], remove: [], groupErrors: 1 })
		expect(plan.linkRefreshes).toEqual([{ groupId: 'g1', directoryGroupId: 'd2', name: 'Backend' }])
	})

	// Decision f: a group whose last link was removed keeps no directory member.
	it('removes the directory rows of a group with no link left', () => {
		const plan = planDirectoryMemberships([], ids, [{ groupId: 'g9', userId: 'a' }])
		expect(plan.remove).toEqual([{ groupId: 'g9', userId: 'a' }])
	})
})
```

- [ ] **Step 2: Write the failing DAL tests**

Create `__tests__/data-directory-sync.test.ts`:

```ts
import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A database fake that records each write's table, values and condition, so a test renders it on drizzle.mock().
const mocks = vi.hoisted(() => {
	type Write = {
		op: 'insert' | 'update' | 'delete'
		table: unknown
		values?: unknown
		condition?: unknown
	}
	const state = { writes: [] as Write[], affectedRows: 1, failures: [] as unknown[] }
	const result = () => {
		const failure = state.failures.shift()
		return failure
			? Promise.reject(failure)
			: Promise.resolve([{ affectedRows: state.affectedRows }])
	}
	const db = {
		insert: (table: unknown) => ({
			values: (values: unknown) => {
				state.writes.push({ op: 'insert', table, values })
				return result()
			},
		}),
		update: (table: unknown) => ({
			set: (values: unknown) => ({
				where: (condition: unknown) => {
					state.writes.push({ op: 'update', table, values, condition })
					return result()
				},
			}),
		}),
		delete: (table: unknown) => ({
			where: (condition: unknown) => {
				state.writes.push({ op: 'delete', table, condition })
				return result()
			},
		}),
	}
	return { state, db }
})
vi.mock('@/db', () => ({ getDb: () => mocks.db }))

import { directorySyncRuns, userGroupDirectoryLinks, userGroupMembers, users } from '@/db/schema'
import {
	applyMembershipChanges,
	claimSyncRun,
	deactivateDirectoryAccounts,
	reactivateDirectoryAccounts,
	refreshDirectoryAccount,
	refreshGroupLinks,
} from '@/lib/data/directory'

const render = (write: (typeof mocks.state.writes)[number]) => {
	const mock = drizzle.mock()
	if (write.op === 'update')
		return mock
			.update(write.table as typeof users)
			.set(write.values as Record<string, unknown>)
			.where(write.condition as SQL)
			.toSQL()
	return mock
		.delete(write.table as typeof users)
		.where(write.condition as SQL)
		.toSQL()
}
const duplicate = () => Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 })
const missing = () =>
	Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 })

beforeEach(() => {
	mocks.state.writes = []
	mocks.state.affectedRows = 1
	mocks.state.failures = []
})

describe('deactivateDirectoryAccounts (spec §6.4 step 3, ADR-0027)', () => {
	it('sets the directory marker and bumps sessionVersion, on ldap accounts not yet marked, never the admin marker', async () => {
		mocks.state.affectedRows = 2
		expect(await deactivateDirectoryAccounts(['a', 'b'], new Date('2026-10-10T10:00:00Z'))).toBe(2)
		const { sql, params } = render(mocks.state.writes[0])
		expect(sql).toContain('`session_version` = `users`.`session_version` + 1')
		expect(sql).toContain('`directory_deactivated_at` = ?')
		expect(sql).toMatch(
			/where \(`users`\.`source` = \? and `users`\.`id` in \(\?, \?\) and `users`\.`directory_deactivated_at` is null\)$/,
		)
		expect(sql).not.toContain('admin_deactivated')
		expect(params).toContain('ldap')
	})

	it('writes in batches of 1,000 ids (decision ae) and sums the counts', async () => {
		const ids = Array.from({ length: 2_500 }, (_, index) => `u${index}`)
		mocks.state.affectedRows = 10
		expect(await deactivateDirectoryAccounts(ids, new Date())).toBe(30)
		expect(mocks.state.writes).toHaveLength(3)
	})

	it('writes nothing for no ids', async () => {
		expect(await deactivateDirectoryAccounts([], new Date())).toBe(0)
		expect(mocks.state.writes).toEqual([])
	})
})

describe('reactivateDirectoryAccounts', () => {
	it('clears the directory marker only where it is set, and bumps nothing', async () => {
		await reactivateDirectoryAccounts(['a'])
		const { sql } = render(mocks.state.writes[0])
		expect(sql).toContain('`directory_deactivated_at` = ?')
		expect(sql).toMatch(/and `users`\.`directory_deactivated_at` is not null\)$/)
		expect(sql).not.toMatch(/session_version|admin_deactivated/)
	})
})

describe('refreshDirectoryAccount (decision ac)', () => {
	const update = { id: 'a', name: 'Alice', directoryUsername: 'alice', email: 'new@example.com' }

	it('writes the new email with the other fields when the index takes it', async () => {
		expect(await refreshDirectoryAccount(update)).toEqual({ conflict: false })
		expect(mocks.state.writes[0].values).toEqual({
			name: 'Alice',
			directoryUsername: 'alice',
			email: 'new@example.com',
		})
		expect(render(mocks.state.writes[0]).sql).toMatch(
			/where \(`users`\.`id` = \? and `users`\.`source` = \?\)$/,
		)
	})

	it('keeps the old email when another account has it (1062), and says so', async () => {
		mocks.state.failures = [duplicate()]
		expect(await refreshDirectoryAccount(update)).toEqual({ conflict: true })
		expect(mocks.state.writes.map(write => write.values)).toEqual([
			{ name: 'Alice', directoryUsername: 'alice', email: 'new@example.com' },
			{ name: 'Alice', directoryUsername: 'alice' },
		])
	})

	it('writes no email when the plan keeps it, and a null username is not written', async () => {
		await refreshDirectoryAccount({ ...update, email: null, directoryUsername: null })
		expect(mocks.state.writes[0].values).toEqual({ name: 'Alice' })
	})
})

describe('applyMembershipChanges (spec §2 #8: directory rows only)', () => {
	it('deletes and inserts directory rows per group', async () => {
		mocks.state.affectedRows = 1
		const result = await applyMembershipChanges({
			add: [{ groupId: 'g1', userId: 'b' }],
			remove: [{ groupId: 'g1', userId: 'c' }],
		})
		expect(result).toEqual({ added: 1, removed: 1, groupErrors: 0 })
		const deleted = mocks.state.writes.find(write => write.op === 'delete')!
		const { sql, params } = render(deleted)
		expect(sql).toMatch(
			/where \(`user_group_members`\.`group_id` = \? and `user_group_members`\.`source` = \? and `user_group_members`\.`user_id` in \(\?\)\)$/,
		)
		expect(params).toEqual(['g1', 'directory', 'c'])
		const inserted = mocks.state.writes.find(write => write.op === 'insert')!
		expect(inserted.table).toBe(userGroupMembers)
		expect(inserted.values).toEqual([{ groupId: 'g1', userId: 'b', source: 'directory' }])
	})

	// A sign-in added the row meanwhile (1062), or the group or the account was deleted during the run (1452):
	// row by row, a duplicate is already there and a missing reference counts as a group error.
	it('falls back to rows one by one on a duplicate or a missing reference', async () => {
		mocks.state.failures = [duplicate(), duplicate(), missing()]
		const result = await applyMembershipChanges({
			add: [
				{ groupId: 'g1', userId: 'a' },
				{ groupId: 'g1', userId: 'b' },
			],
			remove: [],
		})
		expect(result).toEqual({ added: 0, removed: 0, groupErrors: 1 })
		expect(mocks.state.writes.filter(write => write.op === 'insert')).toHaveLength(3)
	})
})

describe('refreshGroupLinks', () => {
	it('refreshes a found group and marks a missing one once', async () => {
		const at = new Date('2026-10-10T10:00:00Z')
		await refreshGroupLinks(
			[
				{ groupId: 'g1', directoryGroupId: 'd1', name: 'Engineering' },
				{ groupId: 'g1', directoryGroupId: 'd2', name: null },
			],
			at,
		)
		const [found, gone] = mocks.state.writes
		expect(found.table).toBe(userGroupDirectoryLinks)
		expect(found.values).toEqual({ directoryGroupName: 'Engineering', missingSince: null })
		expect(gone.values).toEqual({ missingSince: at })
		expect(render(gone).sql).toMatch(/and `user_group_directory_links`\.`missing_since` is null\)$/)
	})
})

describe('claimSyncRun (spec §6.4 "Claim")', () => {
	it('claims a slot once; the unique key refuses a second container', async () => {
		const run = {
			id: 'r1',
			slot: 'schedule:2026-10-10T10:00Z',
			trigger: 'schedule' as const,
			startedAt: new Date(),
		}
		expect(await claimSyncRun(run)).toBe(true)
		expect(mocks.state.writes[0]).toMatchObject({
			op: 'insert',
			table: directorySyncRuns,
			values: {
				id: 'r1',
				slot: run.slot,
				runTrigger: 'schedule',
				startedAt: run.startedAt,
				outcome: 'running',
			},
		})
		mocks.state.failures = [duplicate()]
		expect(await claimSyncRun({ ...run, id: 'r2' })).toBe(false)
	})
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run __tests__/directory-plan.test.ts __tests__/data-directory-sync.test.ts` Expected: FAIL; `@/lib/directory/plan` does not exist and the DAL functions are not exported.

- [ ] **Step 4: Write the plan**

Create `lib/directory/plan.ts`:

```ts
import 'server-only'

/*
 * The directory sync's reconciliation as pure functions (B3 spec §6.4, decision ab): from the hub's `ldap` accounts and
 * the directory's entries to what changes. The writes live in lib/data/directory.ts; the IO in lib/directory/sync.ts.
 */

/** A hub `ldap` account as the sync reads it. */
export interface SyncAccount {
	id: string
	directoryId: string | null
	directoryIdAttribute: string | null
	email: string
	name: string | null
	directoryUsername: string | null
	directoryDeactivatedAt: Date | null
}

/** A directory entry from the complete, error-free paged search, its key canonical (lib/directory/keys.ts). */
export interface SyncEntry {
	key: string
	username: string | null
	email: string | null
	name: string | null
}

/** One account's refreshed directory fields; `email` null keeps the stored email, `directoryUsername` null the stored name. */
export interface AccountUpdate {
	id: string
	name: string | null
	directoryUsername: string | null
	email: string | null
}

export type AccountPlan =
	| { stop: 'empty' | 'id_attribute_changed' }
	| {
			stop: null
			deactivate: string[]
			reactivate: string[]
			updates: AccountUpdate[]
			/** Every hub `ldap` account by its key, for the group step. */
			accountIdByKey: Map<string, string>
	  }

/**
 * Spec §6.4 steps 2–3. Two safety stops change nothing: zero entries (a filter written for another server matches
 * nothing without an error, RFC 4511 §4.5.1.7) and an account keyed by another attribute than LDAP_ID_ATTRIBUTE (every
 * key would miss; Mattermost documents that a changed ID attribute splits accounts). Otherwise: absent → deactivate
 * (once), present again → reactivate, present → refresh what changed. Entries without a hub account are ignored:
 * accounts are created at first sign-in only (Grafana: "Only users that have logged into Grafana at least once are
 * synchronized").
 */
export function planAccountChanges(
	accounts: readonly SyncAccount[],
	entries: readonly SyncEntry[],
	idAttribute: string,
): AccountPlan {
	if (entries.length === 0) return { stop: 'empty' }
	const wanted = idAttribute.toLowerCase()
	if (accounts.some(account => account.directoryIdAttribute?.toLowerCase() !== wanted))
		return { stop: 'id_attribute_changed' }
	const byKey = new Map(entries.map(entry => [entry.key, entry]))
	const deactivate: string[] = []
	const reactivate: string[] = []
	const updates: AccountUpdate[] = []
	const accountIdByKey = new Map<string, string>()
	for (const account of accounts) {
		if (account.directoryId === null) continue
		accountIdByKey.set(account.directoryId, account.id)
		const entry = byKey.get(account.directoryId)
		if (!entry) {
			if (account.directoryDeactivatedAt === null) deactivate.push(account.id)
			continue
		}
		if (account.directoryDeactivatedAt !== null) reactivate.push(account.id)
		const email = entry.email && entry.email !== account.email ? entry.email : null
		const username = entry.username ?? account.directoryUsername
		if (email !== null || entry.name !== account.name || username !== account.directoryUsername)
			updates.push({ id: account.id, name: entry.name, directoryUsername: username, email })
	}
	return { stop: null, deactivate, reactivate, updates, accountIdByKey }
}

export interface MembershipRow {
	groupId: string
	userId: string
}

export type LinkLookup = {
	groupId: string
	directoryGroupId: string
	result:
		| { status: 'found'; name: string; memberKeys: ReadonlySet<string> }
		| { status: 'missing' }
		| { status: 'error' }
}

/** A link's refreshed name, or null when the sync did not find its directory group. */
export interface LinkRefresh {
	groupId: string
	directoryGroupId: string
	name: string | null
}

export interface MembershipPlan {
	add: MembershipRow[]
	remove: MembershipRow[]
	groupErrors: number
	linkRefreshes: LinkRefresh[]
}

/**
 * Spec §6.4 step 4 and §6.5: each hub group's directory members are the hub `ldap` accounts found in any of its links;
 * a missing directory group counts as empty; a group with a failed lookup is left whole (decision ad); a group with no
 * link left loses its directory members (decision f). Only `directory` rows are planned (spec §2 #8).
 */
export function planDirectoryMemberships(
	lookups: readonly LinkLookup[],
	accountIdByKey: ReadonlyMap<string, string>,
	current: readonly MembershipRow[],
): MembershipPlan {
	const failed = new Set(
		lookups.filter(lookup => lookup.result.status === 'error').map(lookup => lookup.groupId),
	)
	const target = new Map<string, Set<string>>()
	for (const groupId of [
		...lookups.map(lookup => lookup.groupId),
		...current.map(row => row.groupId),
	])
		if (!failed.has(groupId) && !target.has(groupId)) target.set(groupId, new Set())
	const linkRefreshes: LinkRefresh[] = []
	for (const lookup of lookups) {
		if (lookup.result.status === 'error') continue
		const { groupId, directoryGroupId } = lookup
		if (lookup.result.status === 'missing') {
			linkRefreshes.push({ groupId, directoryGroupId, name: null })
			continue
		}
		linkRefreshes.push({ groupId, directoryGroupId, name: lookup.result.name })
		if (failed.has(groupId)) continue
		for (const key of lookup.result.memberKeys) {
			const userId = accountIdByKey.get(key)
			if (userId) target.get(groupId)!.add(userId)
		}
	}
	const have = Map.groupBy(current, row => row.groupId)
	const add: MembershipRow[] = []
	const remove: MembershipRow[] = []
	for (const [groupId, wanted] of target) {
		const now = new Set((have.get(groupId) ?? []).map(row => row.userId))
		for (const userId of wanted) if (!now.has(userId)) add.push({ groupId, userId })
		for (const userId of now) if (!wanted.has(userId)) remove.push({ groupId, userId })
	}
	const groupErrors = lookups.filter(lookup => lookup.result.status === 'error').length
	return { add, remove, groupErrors, linkRefreshes }
}
```

- [ ] **Step 5: Add the sync's reads and writes to the DAL**

In `lib/data/directory.ts`, extend the drizzle import to `import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm'`, add `directorySyncRuns` to the schema import, import `isMissingReference` beside the other two from `./db-errors`, import the types `import type { AccountUpdate, LinkRefresh, MembershipPlan, MembershipRow, SyncAccount } from '@/lib/directory/plan'` and `import type { SyncErrorCode, SyncOutcome, SyncTrigger } from '@/lib/directory-status'`, then append:

```ts
/** Decision ae: at most 1,000 ids per statement, under MySQL's 65,535 placeholders (ER_PS_MANY_PARAM, 1390). */
const BATCH = 1_000
const batches = <T>(items: readonly T[]): T[][] =>
	Array.from({ length: Math.ceil(items.length / BATCH) }, (_, index) =>
		items.slice(index * BATCH, (index + 1) * BATCH),
	)

/** Every hub `ldap` account, active or not (spec §6.4 step 3). */
export const listDirectoryAccounts = (): Promise<SyncAccount[]> =>
	getDb()
		.select({
			id: users.id,
			directoryId: users.directoryId,
			directoryIdAttribute: users.directoryIdAttribute,
			email: users.email,
			name: users.name,
			directoryUsername: users.directoryUsername,
			directoryDeactivatedAt: users.directoryDeactivatedAt,
		})
		.from(users)
		.where(eq(users.source, 'ldap'))

/** Every `directory` membership (spec §2 #8: the sync's own rows). */
export const listDirectoryMemberships = (): Promise<MembershipRow[]> =>
	getDb()
		.select({ groupId: userGroupMembers.groupId, userId: userGroupMembers.userId })
		.from(userGroupMembers)
		.where(eq(userGroupMembers.source, 'directory'))

/**
 * Directory deactivation (spec §6.4 step 3, ADR-0027): the directory marker and a sessionVersion bump in one write, so
 * every token in use loses its id at its next request (ADR-0018's rule); only on `ldap` accounts the directory has not
 * marked yet, never the admin marker. The count is the rows changed: the WHERE excludes marked rows, so mysql2's
 * found-rows count (its default `FOUND_ROWS` flag) equals the changed rows.
 */
export async function deactivateDirectoryAccounts(
	ids: readonly string[],
	at: Date,
): Promise<number> {
	let changed = 0
	for (const part of batches(ids)) {
		const [result] = await getDb()
			.update(users)
			.set({ directoryDeactivatedAt: at, sessionVersion: sql`${users.sessionVersion} + 1` })
			.where(
				and(
					eq(users.source, 'ldap'),
					inArray(users.id, part),
					isNull(users.directoryDeactivatedAt),
				),
			)
		changed += result.affectedRows
	}
	return changed
}

/** The entry matches again: the directory's marker lifts (spec §2 #12); old tokens stay revoked (sessionVersion). */
export async function reactivateDirectoryAccounts(ids: readonly string[]): Promise<number> {
	let changed = 0
	for (const part of batches(ids)) {
		const [result] = await getDb()
			.update(users)
			.set({ directoryDeactivatedAt: null })
			.where(
				and(
					eq(users.source, 'ldap'),
					inArray(users.id, part),
					isNotNull(users.directoryDeactivatedAt),
				),
			)
		changed += result.affectedRows
	}
	return changed
}

/**
 * One account's refreshed directory fields (spec §6.4 step 3). A new email the unique index refuses (1062: another
 * account has it) is dropped and the other fields written: the row keeps its old email and the run counts a conflict
 * (spec §2 #11, decision ac).
 */
export async function refreshDirectoryAccount(
	update: AccountUpdate,
): Promise<{ conflict: boolean }> {
	const fields = {
		name: update.name,
		...(update.directoryUsername !== null ? { directoryUsername: update.directoryUsername } : {}),
	}
	const where = and(eq(users.id, update.id), eq(users.source, 'ldap'))
	if (update.email !== null) {
		try {
			await getDb()
				.update(users)
				.set({ ...fields, email: update.email })
				.where(where)
			return { conflict: false }
		} catch (error) {
			if (!isDuplicateEntry(error)) throw error
		}
		await getDb().update(users).set(fields).where(where)
		return { conflict: true }
	}
	await getDb().update(users).set(fields).where(where)
	return { conflict: false }
}

const directoryRows = (groupId: string, userIds: readonly string[]) =>
	userIds.map(userId => ({ groupId, userId, source: 'directory' as const }))

/**
 * Applies the planned `directory` memberships per hub group (spec §2 #8: manual rows untouched). An insert refused as a
 * duplicate (a sign-in added the row meanwhile) or a missing reference (the group or the account was deleted during
 * the run) is retried row by row: a duplicate is already there, a missing reference counts as a group error.
 */
export async function applyMembershipChanges(
	plan: Pick<MembershipPlan, 'add' | 'remove'>,
): Promise<{ added: number; removed: number; groupErrors: number }> {
	const db = getDb()
	let added = 0
	let removed = 0
	let groupErrors = 0
	for (const [groupId, rows] of Map.groupBy(plan.remove, row => row.groupId))
		for (const part of batches(rows.map(row => row.userId))) {
			const [result] = await db
				.delete(userGroupMembers)
				.where(
					and(
						eq(userGroupMembers.groupId, groupId),
						eq(userGroupMembers.source, 'directory'),
						inArray(userGroupMembers.userId, part),
					),
				)
			removed += result.affectedRows
		}
	for (const [groupId, rows] of Map.groupBy(plan.add, row => row.groupId))
		for (const part of batches(rows.map(row => row.userId))) {
			try {
				await db.insert(userGroupMembers).values(directoryRows(groupId, part))
				added += part.length
			} catch (error) {
				if (!isDuplicateEntry(error) && !isMissingReference(error)) throw error
				for (const userId of part) {
					try {
						await db.insert(userGroupMembers).values(directoryRows(groupId, [userId]))
						added += 1
					} catch (rowError) {
						if (isMissingReference(rowError)) groupErrors += 1
						else if (!isDuplicateEntry(rowError)) throw rowError
					}
				}
			}
		}
	return { added, removed, groupErrors }
}

/** A found link's name is refreshed and its `missing_since` cleared; a missing one is stamped once (spec §3.2). */
export async function refreshGroupLinks(
	refreshes: readonly LinkRefresh[],
	at: Date,
): Promise<void> {
	const db = getDb()
	for (const refresh of refreshes) {
		const link = and(
			eq(userGroupDirectoryLinks.groupId, refresh.groupId),
			eq(userGroupDirectoryLinks.directoryGroupId, refresh.directoryGroupId),
		)
		if (refresh.name !== null)
			await db
				.update(userGroupDirectoryLinks)
				.set({ directoryGroupName: refresh.name, missingSince: null })
				.where(link)
		else
			await db
				.update(userGroupDirectoryLinks)
				.set({ missingSince: at })
				.where(and(link, isNull(userGroupDirectoryLinks.missingSince)))
	}
}

export interface SyncRunCounts {
	entriesSeen: number
	deactivated: number
	reactivated: number
	updated: number
	conflicts: number
	groupErrors: number
	membershipsAdded: number
	membershipsRemoved: number
}

export const EMPTY_COUNTS: SyncRunCounts = {
	entriesSeen: 0,
	deactivated: 0,
	reactivated: 0,
	updated: 0,
	conflicts: 0,
	groupErrors: 0,
	membershipsAdded: 0,
	membershipsRemoved: 0,
}

/**
 * Claims a run's slot (spec §6.4 "Claim"): the unique key refuses a second insert for the same slot (1062), and that
 * caller skips. Documenso builds a deterministic id per cron slot so that racing instances "collide on the primary key
 * instead of creating duplicates" (`documenso@38ecb217:packages/lib/jobs/client/local.ts:19-22`); GoodJob and Solid
 * Queue keep a unique index per scheduled time (`ad-and-reference-projects.md` B.9).
 */
export async function claimSyncRun(run: {
	id: string
	slot: string
	trigger: SyncTrigger
	startedAt: Date
}): Promise<boolean> {
	try {
		await getDb().insert(directorySyncRuns).values({
			id: run.id,
			slot: run.slot,
			runTrigger: run.trigger,
			startedAt: run.startedAt,
			outcome: 'running',
		})
		return true
	} catch (error) {
		if (isDuplicateEntry(error)) return false
		throw error
	}
}

/** A run started after `since` that has not finished (spec §6.4: no second run while one is going). */
export async function hasUnfinishedRunSince(since: Date): Promise<boolean> {
	const [row] = await getDb()
		.select({ id: directorySyncRuns.id })
		.from(directorySyncRuns)
		.where(and(isNull(directorySyncRuns.finishedAt), gt(directorySyncRuns.startedAt, since)))
		.limit(1)
	return row !== undefined
}

export async function finishSyncRun(
	id: string,
	outcome: Exclude<SyncOutcome, 'running'>,
	counts: SyncRunCounts,
	errorCode: SyncErrorCode | null,
	at: Date,
): Promise<void> {
	await getDb()
		.update(directorySyncRuns)
		.set({ ...counts, outcome, errorCode, finishedAt: at })
		.where(eq(directorySyncRuns.id, id))
}

/** Spec §3.2: runs older than 90 days are deleted by the run itself. */
export async function pruneSyncRuns(before: Date): Promise<void> {
	await getDb().delete(directorySyncRuns).where(lt(directorySyncRuns.startedAt, before))
}

export interface SyncRunRecord {
	id: string
	trigger: SyncTrigger
	startedAt: Date
	finishedAt: Date | null
	outcome: SyncOutcome
	errorCode: string | null
	counts: SyncRunCounts
}

const runColumns = {
	id: directorySyncRuns.id,
	trigger: directorySyncRuns.runTrigger,
	startedAt: directorySyncRuns.startedAt,
	finishedAt: directorySyncRuns.finishedAt,
	outcome: directorySyncRuns.outcome,
	errorCode: directorySyncRuns.errorCode,
	entriesSeen: directorySyncRuns.entriesSeen,
	deactivated: directorySyncRuns.deactivated,
	reactivated: directorySyncRuns.reactivated,
	updated: directorySyncRuns.updated,
	conflicts: directorySyncRuns.conflicts,
	groupErrors: directorySyncRuns.groupErrors,
	membershipsAdded: directorySyncRuns.membershipsAdded,
	membershipsRemoved: directorySyncRuns.membershipsRemoved,
}

const toRunRecord = ({
	id,
	trigger,
	startedAt,
	finishedAt,
	outcome,
	errorCode,
	...counts
}: {
	id: string
	trigger: SyncTrigger
	startedAt: Date
	finishedAt: Date | null
	outcome: SyncOutcome
	errorCode: string | null
} & SyncRunCounts): SyncRunRecord => ({
	id,
	trigger,
	startedAt,
	finishedAt,
	outcome,
	errorCode,
	counts,
})

/** The newest run, for the status panel (spec §6.6). */
export async function latestSyncRun(): Promise<SyncRunRecord | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(directorySyncRuns)
		.orderBy(desc(directorySyncRuns.startedAt))
		.limit(1)
	return row ? toRunRecord(row) : null
}

/** The newest succeeded run, for the startup catch-up (spec §6.4 "Missed run"). */
export async function lastSucceededSyncRun(): Promise<SyncRunRecord | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(directorySyncRuns)
		.where(eq(directorySyncRuns.outcome, 'succeeded'))
		.orderBy(desc(directorySyncRuns.startedAt))
		.limit(1)
	return row ? toRunRecord(row) : null
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run __tests__/directory-plan.test.ts __tests__/data-directory-sync.test.ts __tests__/data-directory-sign-in.test.ts` Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/directory/plan.ts lib/data/directory.ts __tests__/directory-plan.test.ts __tests__/data-directory-sync.test.ts
pnpm exec oxfmt --write lib/directory/plan.ts lib/data/directory.ts __tests__/directory-plan.test.ts __tests__/data-directory-sync.test.ts && pnpm exec oxfmt --check lib/directory/plan.ts lib/data/directory.ts __tests__/directory-plan.test.ts __tests__/data-directory-sync.test.ts
pnpm test
git add lib/directory/plan.ts lib/data/directory.ts __tests__/directory-plan.test.ts __tests__/data-directory-sync.test.ts
git commit -m "feat(directory): plan the sync and add its writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 10: The sync run

Spec §6.4 "Claim" and "A run" (claim the slot, read everything, the safety stops, apply, finish, prune, one summary line), §2 #12 (an unreachable directory changes nothing), §7.3 (fixed error codes in the log and the run row). Review Focus: lines 3 and 5.

**Files:**

- Create: `lib/directory/sync.ts`, `__tests__/directory-sync.test.ts`, `__tests__/ldap/sync.ldap.test.ts`

**Interfaces:**

- Consumes: `withDirectory` (Task 6), `listUserEntries`, `findGroupByKey`, `listMemberKeys` from `@/lib/directory/operations` (Task 6), `DirectoryUnavailableError`, `DirectoryRefusedError` from `@/lib/directory/errors` (Task 6), `readEntry` from `@/lib/directory/entry` (Task 5), `planAccountChanges`, `planDirectoryMemberships`, `type LinkLookup` from `@/lib/directory/plan` (Task 9), the sync functions of `@/lib/data/directory` (Tasks 3 and 9), `ResultCodeError` from `ldapts`.
- Produces, from `@/lib/directory/sync`:
  - `type SyncAttempt = { status: 'skipped' } | { status: 'running' } | { status: 'finished'; outcome: Exclude<SyncOutcome, 'running'>; counts: SyncRunCounts; errorCode: SyncErrorCode | null }`
  - `runSync(run: { config: LdapConfig; id: string; trigger: SyncTrigger; slot: string }): Promise<SyncAttempt>`
  - `runManualSync(config: LdapConfig): Promise<SyncAttempt>`
  - `scheduleSlot(at: Date): string`, `startupSlot(due: Date): string` (`schedule:2026-10-09T13:00Z`, `startup:…`)
  - `RUNNING_GUARD_MS` (30 minutes), `RUN_RETENTION_MS` (90 days)

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **af. Everything is read before anything is written.** The paged user search, every linked group's lookup and member search run on one connection (spec §6.2: one client per sync), and only then do the accounts and memberships change; any connection, TLS, bind, search or page failure in that phase fails the run with nothing written (spec §6.4 step 2, GitLab's warning that "All users are blocked if the LDAP server is unavailable when an LDAP user synchronization is run", `gitlabhq@0739b8bf:doc/administration/auth/ldap/ldap_synchronization.md:196-200`). A linked group's own result-code error (the directory answered, for that group) is that group's error only (spec §6.4 step 4); a transport failure there fails the run.
- **ag. No run starts while another is going, whatever its trigger.** Before it claims its slot, every run (scheduled, startup or manual) checks for a run that started less than 30 minutes ago and has not finished, and skips; the slot's unique key then stops a second container. Keycloak runs every sync, scheduled or manual, through one cluster-wide key with a timeout of at least 30 seconds and answers "Synchronization ignored as it's already in progress" (`keycloak@c7de391a:model/storage-private/src/main/java/org/keycloak/storage/UserStorageSyncTask.java:159-188`); Mattermost's `SaveOnce` inserts a job only while none of its type is pending or in progress (`mattermost@4d94455a:server/channels/store/sqlstore/job_store.go:81-135`). The spec names the check for Sync now; a check and then an insert can still race, which the idempotent reconciliation absorbs (spec §6.4 "Claim"; `ad-and-reference-projects.md` B.4).
- **ah. A failed run records the counts it reached**, so a write phase cut by a database error shows what it changed; the reconciliation is idempotent and the next run completes it (spec §6.4 "Claim").

- [ ] **Step 1: Write the failing unit tests**

Create `__tests__/directory-sync.test.ts`:

```ts
import { InvalidCredentialsError, NoSuchObjectError } from 'ldapts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	claimSyncRun: vi.fn(),
	finishSyncRun: vi.fn(),
	pruneSyncRuns: vi.fn(),
	hasUnfinishedRunSince: vi.fn(),
	listGroupLinks: vi.fn(),
	listDirectoryAccounts: vi.fn(),
	listDirectoryMemberships: vi.fn(),
	deactivateDirectoryAccounts: vi.fn(),
	reactivateDirectoryAccounts: vi.fn(),
	refreshDirectoryAccount: vi.fn(),
	refreshGroupLinks: vi.fn(),
	applyMembershipChanges: vi.fn(),
	listUserEntries: vi.fn(),
	findGroupByKey: vi.fn(),
	listMemberKeys: vi.fn(),
	withDirectory: vi.fn(),
}))
vi.mock('@/lib/data/directory', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/data/directory')>()),
	claimSyncRun: mocks.claimSyncRun,
	finishSyncRun: mocks.finishSyncRun,
	pruneSyncRuns: mocks.pruneSyncRuns,
	hasUnfinishedRunSince: mocks.hasUnfinishedRunSince,
	listGroupLinks: mocks.listGroupLinks,
	listDirectoryAccounts: mocks.listDirectoryAccounts,
	listDirectoryMemberships: mocks.listDirectoryMemberships,
	deactivateDirectoryAccounts: mocks.deactivateDirectoryAccounts,
	reactivateDirectoryAccounts: mocks.reactivateDirectoryAccounts,
	refreshDirectoryAccount: mocks.refreshDirectoryAccount,
	refreshGroupLinks: mocks.refreshGroupLinks,
	applyMembershipChanges: mocks.applyMembershipChanges,
}))
vi.mock('@/db', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/directory/operations', () => ({
	listUserEntries: mocks.listUserEntries,
	findGroupByKey: mocks.findGroupByKey,
	listMemberKeys: mocks.listMemberKeys,
}))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))

import { DirectoryUnavailableError } from '@/lib/directory/errors'
import { runManualSync, runSync, scheduleSlot, startupSlot } from '@/lib/directory/sync'

const config = {
	idAttribute: 'objectGUID',
	loginAttribute: 'sAMAccountName',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
} as never
const guid = (n: number) =>
	Buffer.from(`${n.toString(16).padStart(2, '0')}395fb99ab51b4a9e9686c66cb18d99`, 'hex')
const entry = (n: number, name: string) => ({
	dn: `CN=${name},DC=x`,
	objectGUID: guid(n),
	sAMAccountName: name,
	mail: `${name}@x.example`,
	displayName: name,
})
const run = { config, id: 'r1', trigger: 'schedule' as const, slot: 'schedule:2026-10-10T10:00Z' }

beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.claimSyncRun.mockResolvedValue(true)
	mocks.hasUnfinishedRunSince.mockResolvedValue(false)
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work({}),
	)
	mocks.listGroupLinks.mockResolvedValue([])
	mocks.listDirectoryAccounts.mockResolvedValue([])
	mocks.listDirectoryMemberships.mockResolvedValue([])
	mocks.deactivateDirectoryAccounts.mockResolvedValue(0)
	mocks.reactivateDirectoryAccounts.mockResolvedValue(0)
	mocks.applyMembershipChanges.mockResolvedValue({ added: 0, removed: 0, groupErrors: 0 })
	mocks.listUserEntries.mockResolvedValue([entry(0x90, 'alice')])
})

describe('the slots (decision ak)', () => {
	it('name a minute', () => {
		expect(scheduleSlot(new Date('2026-10-09T13:00:42.120Z'))).toBe('schedule:2026-10-09T13:00Z')
		expect(startupSlot(new Date('2026-10-09T13:00:00Z'))).toBe('startup:2026-10-09T13:00Z')
	})
})

describe('runSync (spec §6.4)', () => {
	it('skips a slot another container claimed, and reads nothing', async () => {
		mocks.claimSyncRun.mockResolvedValue(false)
		expect(await runSync(run)).toEqual({ status: 'skipped' })
		expect(mocks.withDirectory).not.toHaveBeenCalled()
		expect(mocks.finishSyncRun).not.toHaveBeenCalled()
	})

	it('deactivates an absent account, finishes the row and prunes old runs', async () => {
		mocks.listDirectoryAccounts.mockResolvedValue([
			{
				id: 'gone',
				directoryId: '00000000-0000-4000-8000-000000000000',
				directoryIdAttribute: 'objectGUID',
				email: 'g@x.example',
				name: 'g',
				directoryUsername: 'g',
				directoryDeactivatedAt: null,
			},
		])
		mocks.deactivateDirectoryAccounts.mockResolvedValue(1)
		const result = await runSync(run)
		expect(result).toMatchObject({
			status: 'finished',
			outcome: 'succeeded',
			errorCode: null,
			counts: { entriesSeen: 1, deactivated: 1 },
		})
		expect(mocks.deactivateDirectoryAccounts).toHaveBeenCalledWith(['gone'], expect.any(Date))
		expect(mocks.finishSyncRun).toHaveBeenCalledWith(
			'r1',
			'succeeded',
			expect.objectContaining({ deactivated: 1 }),
			null,
			expect.any(Date),
		)
		const [before] = mocks.pruneSyncRuns.mock.calls[0]
		expect(Date.now() - (before as Date).getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000)
	})

	it.each([
		['the empty stop', () => mocks.listUserEntries.mockResolvedValue([]), 'empty'],
		[
			'the id attribute stop',
			() =>
				mocks.listDirectoryAccounts.mockResolvedValue([
					{
						id: 'a',
						directoryId: 'k',
						directoryIdAttribute: 'entryUUID',
						email: 'a@x',
						name: null,
						directoryUsername: null,
						directoryDeactivatedAt: null,
					},
				]),
			'id_attribute_changed',
		],
	])('changes no account at %s', async (_name, arrange, outcome) => {
		arrange()
		expect(await runSync(run)).toMatchObject({ status: 'finished', outcome, errorCode: null })
		for (const write of [
			mocks.deactivateDirectoryAccounts,
			mocks.reactivateDirectoryAccounts,
			mocks.refreshDirectoryAccount,
			mocks.applyMembershipChanges,
		])
			expect(write).not.toHaveBeenCalled()
	})

	it.each([
		[
			'an unreachable directory',
			new DirectoryUnavailableError({ cause: new Error('ECONNREFUSED') }),
			'directory_unreachable',
		],
		['a refused search', new NoSuchObjectError('no such base'), 'search_failed'],
		['anything else', new TypeError('bug'), 'internal_error'],
	])('fails with a fixed code on %s, and writes no account', async (_name, error, code) => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.listUserEntries.mockRejectedValue(error)
			expect(await runSync(run)).toMatchObject({
				status: 'finished',
				outcome: 'failed',
				errorCode: code,
			})
			expect(mocks.deactivateDirectoryAccounts).not.toHaveBeenCalled()
			expect(mocks.finishSyncRun).toHaveBeenCalledWith(
				'r1',
				'failed',
				expect.anything(),
				code,
				expect.any(Date),
			)
		} finally {
			log.mockRestore()
		}
	})

	it('reads every linked group before any write, and counts a group the directory refused as an error (decision af)', async () => {
		mocks.listGroupLinks.mockResolvedValue([
			{ groupId: 'g1', directoryGroupId: 'd1', directoryGroupName: 'Eng', missingSince: null },
			{ groupId: 'g2', directoryGroupId: 'd2', directoryGroupName: 'Ops', missingSince: null },
			{ groupId: 'g3', directoryGroupId: 'd3', directoryGroupName: 'Gone', missingSince: null },
		])
		mocks.findGroupByKey.mockImplementation((_client: unknown, _config: unknown, key: string) =>
			key === 'd2'
				? Promise.reject(new InvalidCredentialsError('refused'))
				: key === 'd3'
					? Promise.resolve(null)
					: Promise.resolve({ dn: 'CN=Eng', name: 'Engineering' }),
		)
		mocks.listMemberKeys.mockResolvedValue(new Set())
		const result = await runSync(run)
		expect(result).toMatchObject({ outcome: 'succeeded', counts: { groupErrors: 1 } })
		expect(mocks.refreshGroupLinks).toHaveBeenCalledWith(
			[
				{ groupId: 'g1', directoryGroupId: 'd1', name: 'Engineering' },
				{ groupId: 'g3', directoryGroupId: 'd3', name: null },
			],
			expect.any(Date),
		)
		// All the directory's answers came before the first write (one connection, decision af).
		expect(mocks.withDirectory).toHaveBeenCalledTimes(1)
		expect(mocks.findGroupByKey.mock.invocationCallOrder.at(-1)!).toBeLessThan(
			mocks.deactivateDirectoryAccounts.mock.invocationCallOrder[0],
		)
	})

	it('fails the whole run when a group lookup loses the directory', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.listGroupLinks.mockResolvedValue([
				{ groupId: 'g1', directoryGroupId: 'd1', directoryGroupName: 'Eng', missingSince: null },
			])
			mocks.findGroupByKey.mockRejectedValue(
				new DirectoryUnavailableError({ cause: new Error('timeout') }),
			)
			expect(await runSync(run)).toMatchObject({
				outcome: 'failed',
				errorCode: 'directory_unreachable',
			})
			expect(mocks.deactivateDirectoryAccounts).not.toHaveBeenCalled()
		} finally {
			log.mockRestore()
		}
	})

	it('records the counts a failed write phase reached (decision ah)', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.listDirectoryAccounts.mockResolvedValue([
				{
					id: 'gone',
					directoryId: '00000000-0000-4000-8000-000000000000',
					directoryIdAttribute: 'objectGUID',
					email: 'g@x',
					name: 'g',
					directoryUsername: 'g',
					directoryDeactivatedAt: null,
				},
			])
			mocks.deactivateDirectoryAccounts.mockResolvedValue(1)
			mocks.applyMembershipChanges.mockRejectedValue(
				Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' }),
			)
			expect(await runSync(run)).toMatchObject({
				outcome: 'failed',
				errorCode: 'internal_error',
				counts: { deactivated: 1 },
			})
		} finally {
			log.mockRestore()
		}
	})

	it('logs one summary line with the counts and no names', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		try {
			await runSync(run)
			expect(info).toHaveBeenCalledTimes(1)
			expect(JSON.stringify(info.mock.calls)).not.toMatch(/alice/)
		} finally {
			info.mockRestore()
		}
	})
})

describe('the running guard (decision ag)', () => {
	it.each(['schedule', 'startup', 'manual'] as const)(
		'refuses a %s run while a run started in the last 30 minutes has not finished',
		async trigger => {
			mocks.hasUnfinishedRunSince.mockResolvedValue(true)
			expect(await runSync({ ...run, trigger })).toEqual({ status: 'running' })
			expect(mocks.claimSyncRun).not.toHaveBeenCalled()
			const [since] = mocks.hasUnfinishedRunSince.mock.calls[0]
			expect(Math.round((Date.now() - (since as Date).getTime()) / 60_000)).toBe(30)
		},
	)
})

describe('runManualSync (spec §6.4 "Claim")', () => {
	it('is refused like every run while another is going', async () => {
		mocks.hasUnfinishedRunSince.mockResolvedValue(true)
		expect(await runManualSync(config)).toEqual({ status: 'running' })
	})

	it('claims a manual slot named after its run id', async () => {
		mocks.hasUnfinishedRunSince.mockResolvedValue(false)
		expect(await runManualSync(config)).toMatchObject({ status: 'finished' })
		const [claimed] = mocks.claimSyncRun.mock.calls[0]
		expect(claimed).toMatchObject({
			trigger: 'manual',
			slot: `manual:${(claimed as { id: string }).id}`,
		})
	})
})
```

Run: `pnpm exec vitest run __tests__/directory-sync.test.ts` Expected: FAIL; `@/lib/directory/sync` does not exist.

- [ ] **Step 2: Write `lib/directory/sync.ts`**

```ts
import 'server-only'

import { randomUUID } from 'node:crypto'

import { ResultCodeError, type Client } from 'ldapts'

import {
	applyMembershipChanges,
	claimSyncRun,
	deactivateDirectoryAccounts,
	EMPTY_COUNTS,
	finishSyncRun,
	hasUnfinishedRunSince,
	listDirectoryAccounts,
	listDirectoryMemberships,
	listGroupLinks,
	pruneSyncRuns,
	reactivateDirectoryAccounts,
	refreshDirectoryAccount,
	refreshGroupLinks,
	type GroupLink,
	type SyncRunCounts,
} from '@/lib/data/directory'
import type { SyncErrorCode, SyncOutcome, SyncTrigger } from '@/lib/directory-status'
import { logActionError } from '@/lib/error-log'
import type { LdapConfig } from '@/lib/env'

import { withDirectory } from './connection'
import { readEntry, type DirectoryEntry } from './entry'
import { DirectoryRefusedError, DirectoryUnavailableError } from './errors'
import { findGroupByKey, listMemberKeys, listUserEntries } from './operations'
import { planAccountChanges, planDirectoryMemberships, type LinkLookup } from './plan'

/*
 * One directory sync run (B3 spec §6.4, ADR-0029): claim the slot, read the directory, stop on a safety stop, apply
 * the plan, finish the row, prune old rows, log one summary line. Called by the schedule (lib/directory/schedule.ts)
 * and by Sync now (lib/directory/admin.ts).
 */

/**
 * Spec §6.4: no run starts while a run that started less than 30 minutes ago has no finished_at (decision ag: every
 * trigger, not only Sync now). A run older than that is taken to have died with its container.
 */
export const RUNNING_GUARD_MS = 30 * 60 * 1000

/** Spec §3.2: runs older than 90 days are deleted by the run itself. */
export const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

const minute = (at: Date) => `${at.toISOString().slice(0, 16)}Z`

/** Decision ak: a scheduled run's slot is the minute it fires (`schedule:2026-10-09T13:00Z`). */
export const scheduleSlot = (at: Date): string => `schedule:${minute(at)}`

/** Decision ak: a startup catch-up's slot is the missed due minute, so two starting containers claim it once. */
export const startupSlot = (due: Date): string => `startup:${minute(due)}`

export type SyncAttempt =
	| { status: 'skipped' }
	| { status: 'running' }
	| {
			status: 'finished'
			outcome: Exclude<SyncOutcome, 'running'>
			counts: SyncRunCounts
			errorCode: SyncErrorCode | null
	  }

/** The fixed code a failed run records (spec §3.2: never a message). */
const errorCodeOf = (error: unknown): SyncErrorCode => {
	if (error instanceof DirectoryUnavailableError) return 'directory_unreachable'
	if (error instanceof DirectoryRefusedError) return 'bind_refused'
	if (error instanceof ResultCodeError) return 'search_failed'
	return 'internal_error'
}

interface DirectorySnapshot {
	entries: DirectoryEntry[]
	lookups: LinkLookup[]
}

/**
 * Decision af: every linked directory group, by key, then its members' keys. A result-code error for one group is that
 * group's error (the directory answered, spec §6.4 step 4); anything else, a lost connection above all, fails the run.
 */
async function lookUpLinks(
	client: Client,
	config: LdapConfig,
	links: readonly GroupLink[],
): Promise<LinkLookup[]> {
	const byKey = new Map<string, LinkLookup['result']>()
	for (const key of new Set(links.map(link => link.directoryGroupId))) {
		try {
			const group = await findGroupByKey(client, config, key)
			byKey.set(
				key,
				group
					? {
							status: 'found',
							name: group.name,
							memberKeys: await listMemberKeys(client, config, group.dn),
						}
					: { status: 'missing' },
			)
		} catch (error) {
			if (!(error instanceof ResultCodeError)) throw error
			logActionError(error, 'directorySync')
			byKey.set(key, { status: 'error' })
		}
	}
	return links.map(link => ({
		groupId: link.groupId,
		directoryGroupId: link.directoryGroupId,
		result: byKey.get(link.directoryGroupId)!,
	}))
}

async function reconcile(
	config: LdapConfig,
	counts: SyncRunCounts,
): Promise<Exclude<SyncOutcome, 'running' | 'failed'>> {
	const links = await listGroupLinks()
	const snapshot: DirectorySnapshot = await withDirectory(config, async client => ({
		entries: (await listUserEntries(client, config))
			.map(entry => readEntry(entry, config))
			.filter((entry): entry is DirectoryEntry => entry !== null),
		lookups: await lookUpLinks(client, config, links),
	}))
	counts.entriesSeen = snapshot.entries.length
	const plan = planAccountChanges(
		await listDirectoryAccounts(),
		snapshot.entries,
		config.idAttribute,
	)
	if (plan.stop !== null) return plan.stop
	const at = new Date()
	counts.deactivated = await deactivateDirectoryAccounts(plan.deactivate, at)
	counts.reactivated = await reactivateDirectoryAccounts(plan.reactivate)
	for (const update of plan.updates) {
		const { conflict } = await refreshDirectoryAccount(update)
		counts.updated += 1
		if (conflict) counts.conflicts += 1
	}
	const memberships = planDirectoryMemberships(
		snapshot.lookups,
		plan.accountIdByKey,
		await listDirectoryMemberships(),
	)
	counts.groupErrors = memberships.groupErrors
	await refreshGroupLinks(memberships.linkRefreshes, at)
	const applied = await applyMembershipChanges(memberships)
	counts.membershipsAdded = applied.added
	counts.membershipsRemoved = applied.removed
	counts.groupErrors += applied.groupErrors
	return 'succeeded'
}

/**
 * Runs one sync for a slot (spec §6.4). The slot's unique key decides which caller runs it: a refused claim skips. The
 * run's failure is caught, logged by name and code (lib/error-log.ts) and recorded with a fixed code; the summary line
 * carries the outcome and the counts, never a name or an email (OWASP Logging Cheat Sheet, "Data to exclude").
 */
export async function runSync(run: {
	config: LdapConfig
	id: string
	trigger: SyncTrigger
	slot: string
}): Promise<SyncAttempt> {
	// Decision ag: Keycloak's one sync key for every trigger; the slot claim below then stops a second container.
	if (await hasUnfinishedRunSince(new Date(Date.now() - RUNNING_GUARD_MS))) {
		console.info('directorySync: a run is going, this one is skipped', { trigger: run.trigger })
		return { status: 'running' }
	}
	if (
		!(await claimSyncRun({
			id: run.id,
			slot: run.slot,
			trigger: run.trigger,
			startedAt: new Date(),
		}))
	)
		return { status: 'skipped' }
	const counts: SyncRunCounts = { ...EMPTY_COUNTS }
	let outcome: Exclude<SyncOutcome, 'running'>
	let errorCode: SyncErrorCode | null = null
	try {
		outcome = await reconcile(run.config, counts)
	} catch (error) {
		logActionError(error, 'directorySync')
		outcome = 'failed'
		errorCode = errorCodeOf(error)
	}
	await finishSyncRun(run.id, outcome, counts, errorCode, new Date())
	await pruneSyncRuns(new Date(Date.now() - RUN_RETENTION_MS))
	console.info('directorySync: run finished', {
		trigger: run.trigger,
		outcome,
		errorCode,
		...counts,
	})
	return { status: 'finished', outcome, counts, errorCode }
}

/** Sync now (spec §6.6): its slot is `manual:<run id>`; refused while another run is going, as every run is. */
export async function runManualSync(config: LdapConfig): Promise<SyncAttempt> {
	const id = randomUUID()
	return runSync({ config, id, trigger: 'manual', slot: `manual:${id}` })
}
```

- [ ] **Step 3: Run the unit tests**

Run: `pnpm exec vitest run __tests__/directory-sync.test.ts` Expected: PASS.

- [ ] **Step 4: Write the integration test against the test servers**

Create `__tests__/ldap/sync.ldap.test.ts`. The directory is real; the database is an in-memory fake of the DAL's sync functions, so the suite needs no MySQL (the SQL is pinned in `__tests__/data-directory-sync.test.ts`, and `e2e/directory-sync.spec.ts` runs the whole chain, Task 14):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MembershipRow, SyncAccount } from '@/lib/directory/plan'

const store = vi.hoisted(() => ({
	accounts: [] as SyncAccount[],
	memberships: [] as MembershipRow[],
	links: [] as {
		groupId: string
		directoryGroupId: string
		directoryGroupName: string
		missingSince: Date | null
	}[],
	deactivated: [] as string[],
	reactivated: [] as string[],
	updates: [] as unknown[],
	added: [] as MembershipRow[],
	removed: [] as MembershipRow[],
}))
vi.mock('@/db', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/data/directory', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/data/directory')>()),
	claimSyncRun: async () => true,
	hasUnfinishedRunSince: async () => false,
	finishSyncRun: async () => undefined,
	pruneSyncRuns: async () => undefined,
	listGroupLinks: async () => store.links,
	listDirectoryAccounts: async () => store.accounts,
	listDirectoryMemberships: async () => store.memberships,
	deactivateDirectoryAccounts: async (ids: string[]) => (
		store.deactivated.push(...ids),
		ids.length
	),
	reactivateDirectoryAccounts: async (ids: string[]) => (
		store.reactivated.push(...ids),
		ids.length
	),
	refreshDirectoryAccount: async (update: unknown) => (
		store.updates.push(update),
		{ conflict: false }
	),
	refreshGroupLinks: async () => undefined,
	applyMembershipChanges: async (plan: { add: MembershipRow[]; remove: MembershipRow[] }) => {
		store.added.push(...plan.add)
		store.removed.push(...plan.remove)
		return { added: plan.add.length, removed: plan.remove.length, groupErrors: 0 }
	},
}))

import { withDirectory } from '@/lib/directory/connection'
import { readEntry } from '@/lib/directory/entry'
import { findLoginEntries, searchGroups } from '@/lib/directory/operations'
import { runSync } from '@/lib/directory/sync'

import { TEST_DIRECTORIES } from './servers'

beforeEach(() => {
	for (const list of Object.values(store)) list.length = 0
})

describe.each(TEST_DIRECTORIES)(
	'runSync against $name (spec §6.4)',
	({ config, people, groups, emailDomain, emptyBaseDn }) => {
		const keyOf = (login: string) =>
			withDirectory(
				config,
				async client => readEntry((await findLoginEntries(client, config, login))[0]!, config)!.key,
			)
		const account = (id: string, key: string, deactivated = false): SyncAccount => ({
			id,
			directoryId: key,
			directoryIdAttribute: config.idAttribute,
			email: `${id}@old.example`,
			name: 'Old Name',
			directoryUsername: id,
			directoryDeactivatedAt: deactivated ? new Date() : null,
		})
		const run = (overrides: Partial<typeof config> = {}) =>
			runSync({
				config: { ...config, ...overrides },
				id: 'r1',
				trigger: 'manual',
				slot: 'manual:r1',
			})

		it('deactivates the absent, reactivates the returned, refreshes the present', async () => {
			store.accounts = [
				account('alice', await keyOf(people.alice)),
				account('bob', await keyOf(people.bob), true),
				account('ghost', '00000000-0000-4000-8000-000000000000'),
			]
			expect(await run()).toMatchObject({
				status: 'finished',
				outcome: 'succeeded',
				errorCode: null,
			})
			expect(store.deactivated).toEqual(['ghost'])
			expect(store.reactivated).toEqual(['bob'])
			expect(store.updates).toContainEqual({
				id: 'alice',
				name: 'Alice Admin',
				directoryUsername: people.alice,
				email: `alice@${emailDomain}`,
			})
		})

		it('fills a linked group with its nested members (spec §6.5)', async () => {
			store.accounts = [
				account('bob', await keyOf(people.bob)),
				account('alice', await keyOf(people.alice)),
			]
			const [engineering] = await withDirectory(config, client =>
				searchGroups(client, config, groups.engineering),
			)
			store.links = [
				{
					groupId: 'hub-eng',
					directoryGroupId: engineering!.key,
					directoryGroupName: 'old',
					missingSince: null,
				},
			]
			store.memberships = [{ groupId: 'hub-eng', userId: 'alice' }]
			await run()
			expect(store.added).toEqual([{ groupId: 'hub-eng', userId: 'bob' }])
			expect(store.removed).toEqual([{ groupId: 'hub-eng', userId: 'alice' }])
		})

		it('stops on an empty answer and changes nothing', async () => {
			store.accounts = [account('alice', await keyOf(people.alice))]
			expect(await run({ userBaseDn: emptyBaseDn })).toMatchObject({
				outcome: 'empty',
				errorCode: null,
			})
			expect(store.deactivated).toEqual([])
		})

		it('fails without a write when the directory is unreachable', async () => {
			store.accounts = [account('alice', await keyOf(people.alice))]
			const log = vi.spyOn(console, 'error').mockImplementation(() => {})
			try {
				expect(await run({ url: config.url.replace(/:\d+$/, ':1') })).toMatchObject({
					outcome: 'failed',
					errorCode: 'directory_unreachable',
				})
				expect(store.deactivated).toEqual([])
			} finally {
				log.mockRestore()
			}
		})
	},
)
```

- [ ] **Step 5: Run it**

```bash
pnpm exec vitest run --project ldap --no-file-parallelism __tests__/ldap/sync.ldap.test.ts
```

Expected: PASS on both servers.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/directory/sync.ts __tests__/directory-sync.test.ts __tests__/ldap/sync.ldap.test.ts
pnpm exec oxfmt --write lib/directory/sync.ts __tests__/directory-sync.test.ts __tests__/ldap/sync.ldap.test.ts && pnpm exec oxfmt --check lib/directory/sync.ts __tests__/directory-sync.test.ts __tests__/ldap/sync.ldap.test.ts
pnpm test
git add lib/directory/sync.ts __tests__/directory-sync.test.ts __tests__/ldap/sync.ldap.test.ts
git commit -m "feat(directory): run the sync with its claim and safety stops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 11: The schedule in `instrumentation.ts`

Spec §6.4 "Schedule" and "Missed run" (one croner job started from `register()` in the Node runtime, kept on `globalThis`; a startup run when the last succeeded run is older than the schedule's last due time), §6.2 (`none` logs a warning at start), §7.1 (a bad `LDAP_*` block fails the first request, never the start or `next build`), §2 #14. Review Focus: line 5.

**Files:**

- Create: `instrumentation.ts`, `lib/directory/schedule.ts`, `__tests__/directory-schedule.test.ts`, `__tests__/instrumentation.test.ts`

**Interfaces:**

- Consumes: `runSync`, `scheduleSlot`, `startupSlot` from `@/lib/directory/sync` (Task 10); `lastSucceededSyncRun` from `@/lib/data/directory` (Task 9); `directoryConfig` from `@/lib/directory/config` (Task 2); `logActionError` from `@/lib/error-log`; `Cron` from `croner` (constructor `new Cron(pattern, options, callback)`, `previousRuns(n)`, `stop()`).
- Produces: `startDirectorySchedule(): void` and `missedRun(lastDue: Date | undefined, lastSucceededStart: Date | null): boolean` from `@/lib/directory/schedule`; `register(): Promise<void>` from `instrumentation.ts`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **ai. `register()` never throws.** Next 16.3.4 rethrows a failing `register()` as "An error occurred while loading instrumentation hook" and the server does not start (`node_modules/next/dist/esm/server/lib/router-utils/instrumentation-globals.external.js`; `library-apis.md` §5); the schedule's start catches and logs its own failure, so a bad `LDAP_*` block still fails at the first request with the variables' names (spec §7.1). Formbricks wraps its start the same way (`formbricks@27ca48e2:apps/web/instrumentation.ts:38-67`, `void registerRecurringJobs().catch(…)`).
- **aj. croner runs the callback's promise under `protect` and reports through `catch`.** croner skips a due run only while the previous callback's returned promise is pending (`protect`; `croner@adc86215:src/croner.ts:518-552, 576-596`), so the callback returns `runSync`'s promise; without `catch` a failing run becomes an unhandled rejection (`:527-540, 586-587`), so `catch` routes it to `logActionError`. `unref: true` (croner README options: the timer does not keep the process alive), so the process exits on SIGTERM when Next stops serving; a run cut there is idempotent and repeated by the startup catch-up or the next slot (spec §13).
- **ak. A scheduled run's slot is the minute it fires** (`schedule:2026-10-09T13:00Z`, spec §3.2's example), a startup run's the missed due minute (`startup:…`), so two containers starting together claim the same catch-up slot once.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/directory-schedule.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const jobs: { pattern: string; options: Record<string, unknown>; run: () => Promise<void> }[] = []
	const lastDue = { value: new Date('2026-10-10T09:00:00Z') as Date | undefined }
	class Cron {
		constructor(pattern: string, options: Record<string, unknown>, run: () => Promise<void>) {
			jobs.push({ pattern, options, run })
		}
		previousRuns() {
			return lastDue.value ? [lastDue.value] : []
		}
		stop() {}
	}
	return {
		jobs,
		Cron,
		lastDue,
		directoryConfig: vi.fn(),
		runSync: vi.fn(),
		lastSucceededSyncRun: vi.fn(),
	}
})
vi.mock('croner', () => ({ Cron: mocks.Cron }))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/sync', () => ({
	runSync: mocks.runSync,
	scheduleSlot: (at: Date) => `schedule:${at.toISOString().slice(0, 16)}Z`,
	startupSlot: (at: Date) => `startup:${at.toISOString().slice(0, 16)}Z`,
}))
vi.mock('@/lib/data/directory', () => ({ lastSucceededSyncRun: mocks.lastSucceededSyncRun }))

import { missedRun, startDirectorySchedule } from '@/lib/directory/schedule'

const config = {
	url: 'ldaps://dc.corp.example',
	encryption: 'ldaps',
	syncSchedule: '0 * * * *',
	syncTimezone: 'Asia/Riyadh',
}

const reset = () => {
	delete (globalThis as { difyAppHubDirectorySchedule?: unknown }).difyAppHubDirectorySchedule
}

beforeEach(() => {
	reset()
	mocks.jobs.length = 0
	mocks.directoryConfig.mockReset()
	mocks.runSync.mockReset()
	mocks.runSync.mockResolvedValue({ status: 'finished', outcome: 'succeeded' })
	mocks.lastSucceededSyncRun.mockReset()
	mocks.lastSucceededSyncRun.mockResolvedValue({ startedAt: new Date('2026-10-10T09:00:05Z') })
	mocks.lastDue.value = new Date('2026-10-10T09:00:00Z')
})
afterEach(reset)

describe('missedRun (spec §6.4 "Missed run")', () => {
	it('is true when the last due time is after the last succeeded run, or nothing ever succeeded', () => {
		const due = new Date('2026-10-10T09:00:00Z')
		expect(missedRun(due, new Date('2026-10-10T08:00:03Z'))).toBe(true)
		expect(missedRun(due, null)).toBe(true)
		expect(missedRun(due, new Date('2026-10-10T09:00:01Z'))).toBe(false)
		expect(missedRun(undefined, null)).toBe(false)
	})
})

describe('startDirectorySchedule', () => {
	it('starts nothing while the directory is off or the schedule is off', () => {
		mocks.directoryConfig.mockReturnValue(null)
		startDirectorySchedule()
		mocks.directoryConfig.mockReturnValue({ ...config, syncSchedule: null })
		reset()
		startDirectorySchedule()
		expect(mocks.jobs).toEqual([])
	})

	it('logs a bad LDAP block instead of throwing (decision ai)', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockImplementation(() => {
				throw Object.assign(new Error('Missing or invalid environment variables: LDAP_URL'), {
					name: 'EnvError',
				})
			})
			expect(() => startDirectorySchedule()).not.toThrow()
			expect(error).toHaveBeenCalled()
			expect(mocks.jobs).toEqual([])
		} finally {
			error.mockRestore()
		}
	})

	it('starts one protected, unref’d job in the zone, once per process (decision aj)', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		startDirectorySchedule()
		startDirectorySchedule()
		expect(mocks.jobs).toHaveLength(1)
		const [job] = mocks.jobs
		expect(job.pattern).toBe('0 * * * *')
		expect(job.options).toMatchObject({ timezone: 'Asia/Riyadh', protect: true, unref: true })
		expect(job.options.catch).toBeTypeOf('function')
		// The callback returns the run's promise, so `protect` holds while it runs.
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-10-10T10:00:00.120Z'))
		try {
			await job.run()
		} finally {
			vi.useRealTimers()
		}
		expect(mocks.runSync).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'schedule', slot: 'schedule:2026-10-10T10:00Z' }),
		)
	})

	it('runs a startup catch-up for a missed slot, under that slot (decision ak)', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		mocks.lastSucceededSyncRun.mockResolvedValue({ startedAt: new Date('2026-10-10T08:00:02Z') })
		startDirectorySchedule()
		await vi.waitFor(() => expect(mocks.runSync).toHaveBeenCalledTimes(1))
		expect(mocks.runSync).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'startup', slot: 'startup:2026-10-10T09:00Z' }),
		)
	})

	it('runs no catch-up when the last due slot already succeeded', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		startDirectorySchedule()
		await vi.waitFor(() => expect(mocks.lastSucceededSyncRun).toHaveBeenCalled())
		expect(mocks.runSync).not.toHaveBeenCalled()
	})

	it('warns once at start that passwords travel in clear with LDAP_ENCRYPTION=none (spec §6.2)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockReturnValue({
				...config,
				url: 'ldap://10.0.0.5',
				encryption: 'none',
				syncSchedule: null,
			})
			startDirectorySchedule()
			startDirectorySchedule()
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0][0])).toMatch(/LDAP_ENCRYPTION=none/)
		} finally {
			warn.mockRestore()
		}
	})
})
```

Create `__tests__/instrumentation.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const { startDirectorySchedule } = vi.hoisted(() => ({ startDirectorySchedule: vi.fn() }))
vi.mock('@/lib/directory/schedule', () => ({ startDirectorySchedule }))

import { register } from '@/instrumentation'

afterEach(() => {
	vi.unstubAllEnvs()
	startDirectorySchedule.mockReset()
})

describe('register (Next instrumentation)', () => {
	it('starts the directory schedule in the Node runtime only', async () => {
		vi.stubEnv('NEXT_RUNTIME', 'edge')
		await register()
		expect(startDirectorySchedule).not.toHaveBeenCalled()
		vi.stubEnv('NEXT_RUNTIME', 'nodejs')
		await register()
		expect(startDirectorySchedule).toHaveBeenCalledTimes(1)
	})

	it('never throws, so a failure cannot stop the server from starting (decision ai)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			startDirectorySchedule.mockImplementation(() => {
				throw new Error('boom')
			})
			await expect(register()).resolves.toBeUndefined()
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
	})
})
```

(`vi.stubEnv` and `vi.unstubAllEnvs` are Vitest's documented way to change `process.env` in a test.)

Run: `pnpm exec vitest run __tests__/directory-schedule.test.ts __tests__/instrumentation.test.ts` Expected: FAIL; the modules do not exist.

- [ ] **Step 2: Write `lib/directory/schedule.ts`**

```ts
import 'server-only'

import { randomUUID } from 'node:crypto'

import { Cron } from 'croner'

import { lastSucceededSyncRun } from '@/lib/data/directory'
import { logActionError } from '@/lib/error-log'
import type { LdapConfig } from '@/lib/env'

import { directoryConfig } from './config'
import { runSync, scheduleSlot, startupSlot } from './sync'

/*
 * The directory sync's schedule (B3 spec §6.4, ADR-0029). Next documents `register()` as startup code ("called once
 * when a new Next.js server instance is initiated", 02-guides/instrumentation.md) and no scheduler in it; starting one
 * there is the reference projects' shape: Homarr's croner jobs (`homarr@ad15cfc3:packages/cron-jobs-core/src/creator.ts:87-95`),
 * Rallly's interval kept on globalThis (`rallly@ac224fe8:apps/web/src/emails/queue.ts:77-84`), ZTNet's `cron` jobs,
 * and Formbricks, which documents it for self-hosters ("starts the worker inside the web application by default").
 */

const globalForSchedule = globalThis as unknown as {
	difyAppHubDirectorySchedule?: { job: Cron | null }
}

/** Spec §6.4: croner does not catch up by itself; a run is missed when the last due time is after the last success. */
export const missedRun = (lastDue: Date | undefined, lastSucceededStart: Date | null): boolean =>
	lastDue !== undefined && (lastSucceededStart === null || lastSucceededStart < lastDue)

async function catchUp(config: LdapConfig, job: Cron): Promise<void> {
	// croner's previousRuns(1): the latest pattern time strictly before now (library-apis.md §2).
	const [lastDue] = job.previousRuns(1)
	const lastSucceeded = await lastSucceededSyncRun()
	if (!missedRun(lastDue, lastSucceeded?.startedAt ?? null)) return
	await runSync({ config, id: randomUUID(), trigger: 'startup', slot: startupSlot(lastDue!) })
}

/**
 * Starts the schedule once per process (a development reload re-evaluates modules, so the state lives on globalThis,
 * Rallly's guard): nothing while LDAP is off or LDAP_SYNC_SCHEDULE is `off`; a warning for `none` (spec §6.2); one
 * croner job (decision aj) and a startup catch-up. A bad LDAP block is logged and left to the first request (decision ai).
 */
export function startDirectorySchedule(): void {
	if (globalForSchedule.difyAppHubDirectorySchedule) return
	let found: LdapConfig | null
	try {
		found = directoryConfig()
	} catch (error) {
		logActionError(error, 'directorySchedule')
		return
	}
	if (!found) return
	const config = found
	globalForSchedule.difyAppHubDirectorySchedule = { job: null }
	if (config.encryption === 'none')
		console.warn(
			'directorySchedule: LDAP_ENCRYPTION=none: directory passwords and the service account travel unencrypted (docs/ldap.md)',
		)
	if (config.syncSchedule === null) return
	const job = new Cron(
		config.syncSchedule,
		{
			timezone: config.syncTimezone ?? undefined,
			protect: true,
			unref: true,
			catch: (error: unknown) => logActionError(error, 'directorySync'),
		},
		() =>
			runSync({
				config,
				id: randomUUID(),
				trigger: 'schedule',
				slot: scheduleSlot(new Date()),
			}).then(() => undefined),
	)
	globalForSchedule.difyAppHubDirectorySchedule.job = job
	void catchUp(config, job).catch(error => logActionError(error, 'directorySync'))
}
```

- [ ] **Step 3: Write `instrumentation.ts`**

```ts
/**
 * Next calls register() once when a server instance starts, in every runtime ("Next.js calls `register` in all
 * environments, so it's important to conditionally import any code that doesn't support specific runtimes",
 * node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). The directory schedule runs in the Node runtime
 * only (ADR-0029); NEXT_RUNTIME is Next's own variable, read here as the guide shows, beside lib/env.ts. Decision ai:
 * nothing escapes, since a failing register() stops the server from starting.
 */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return
	try {
		const { startDirectorySchedule } = await import('./lib/directory/schedule')
		startDirectorySchedule()
	} catch (error) {
		console.error(
			'instrumentation: the directory schedule did not start:',
			error instanceof Error ? error.name : 'unknown error',
		)
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run __tests__/directory-schedule.test.ts __tests__/instrumentation.test.ts` Expected: PASS.

- [ ] **Step 5: Check it under `next dev`**

The e2e environment has `LDAP_SYNC_SCHEDULE=off` (Task 8), so the e2e server starts no job. Run the two specs that load the app first, to see the server start with the new `instrumentation.ts` and log nothing about the directory:

```bash
pnpm exec playwright test e2e/smoke.spec.ts e2e/auth.spec.ts
```

Expected: both pass on the three projects; the `next dev` output (Playwright's webServer log) has no `directorySchedule` or `instrumentation:` line.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint instrumentation.ts lib/directory/schedule.ts __tests__/directory-schedule.test.ts __tests__/instrumentation.test.ts
pnpm exec oxfmt --write instrumentation.ts lib/directory/schedule.ts __tests__/directory-schedule.test.ts __tests__/instrumentation.test.ts && pnpm exec oxfmt --check instrumentation.ts lib/directory/schedule.ts __tests__/directory-schedule.test.ts __tests__/instrumentation.test.ts
pnpm test
git add instrumentation.ts lib/directory/schedule.ts __tests__/directory-schedule.test.ts __tests__/instrumentation.test.ts
git commit -m "feat(directory): schedule the sync from instrumentation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 12: Directory groups on the groups page

Spec §6.5 "Linking" (a "Directory groups" field with search; a Server Action behind `requireAdmin()` searching `(&<LDAP_GROUP_FILTER>(<LDAP_GROUP_NAME_ATTRIBUTE>=*<text>*))` with `sizeLimit: 20`; the key and the name stored), §4.3 (the table shows the linked groups with a "missing" tag; the drawer lists directory members read-only with a "Directory" tag), §7.3 (the action code `directory_unavailable`), §7.4. Review Focus: line 1 (the typed text reaches the directory escaped).

**Files:**

- Create: `lib/directory/admin.ts`, `__tests__/directory-admin.test.ts`, `e2e/directory-groups.spec.ts`
- Modify: `lib/action-result.ts`, `lib/action-failure.ts`, `lib/data/groups.ts`, `app/(admin)/group-management/{page,actions,schemas}.ts(x)`, `components/admin/groups/{group-management,group-form-drawer,group-errors}.ts(x)`, `locales/{en,zh,ar}/translation.json`, `__tests__/{data-groups,group-management-actions,group-management-schemas,group-errors,action-failure}.test.ts`

**Interfaces:**

- Consumes: `withDirectory` and `searchGroups` (Task 6), `directoryConfig`, `isDirectoryConfigured` (Task 2), `DirectoryUnavailableError` (Task 6), `userGroupDirectoryLinks` (Task 1), `userGroupMembers`; `assertAdmin` from `@/lib/auth/session`.
- Produces: the action code `directory_unavailable`; `searchDirectoryGroups(actor: SessionUser, text: string): Promise<DirectoryGroupOption[]>` and `interface DirectoryGroupOption { key: string; name: string }` from `@/lib/directory/admin`; `searchDirectoryGroupsAction(text: unknown): Promise<ActionResult<DirectoryGroupOption[]>>`; `GroupDto.directoryLinks: { id: string; name: string; missingSince: string | null }[]`; `GroupInput.directoryGroups: { id: string; name: string }[]`; `DIRECTORY_SEARCH_MIN` (2) and `directoryGroupSearchSchema` in the groups `schemas.ts`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **al. The search starts at two characters** and is debounced in the browser (300 ms, ahooks `useDebounceFn`), as antd's "Search and Select Users" demo debounces a remote search (`npx -y @ant-design/cli demo Select select-users --version 6.6.5`); the server bounds the result at twenty (spec §6.5) and the text at 64 characters. No reference sets a minimum: Mattermost searches the directory's groups with free text on Enter (`mattermost@4d94455a:webapp/channels/src/components/admin_console/group_settings/groups_list/groups_list.tsx:284-319`) and GitLab offers "a dropdown list with matching CNs" as the admin types (`gitlabhq@0739b8bf:doc/user/group/access_and_permissions.md:303-313`), so the two characters are the hub's guard against one-letter substring searches of the whole directory; when twenty come back, the list says so and asks for a narrower search (`ad-and-reference-projects.md` B.7). The link stores the group's key, as Mattermost stores its Group ID attribute ("such as `entryUUID` or `objectGUID`", `mattermost/docs@bd09d959:source/administration-guide/onboard/ad-ldap-groups-synchronization.rst:46-48`), not Grafana's DN or GitLab's CN.
- **am. Links are saved with the group, in its transaction**: removed links are deleted, new ones inserted, kept ones get the picked name. When the save leaves the group with no link, its `directory` memberships are deleted in the same transaction, since nothing would refresh them (decision f); with links left, the next sync, Sync now or each member's next directory sign-in recomputes them (spec §6.4 step 4, §6.3 step 7). The drawer's hint says so. The key the browser sends is checked against the canonical form; a key that matches no directory group is harmless and is marked missing by the next sync.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/directory-admin.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	directoryConfig: vi.fn(),
	searchGroups: vi.fn(),
	withDirectory: vi.fn(),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/operations', () => ({ searchGroups: mocks.searchGroups }))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))

import { searchDirectoryGroups } from '@/lib/directory/admin'

const admin = { id: 'a1', email: 'a@x', name: null, role: 'admin' as const }
const user = { ...admin, role: 'user' as const }

beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work('client'),
	)
})

describe('searchDirectoryGroups (spec §6.5)', () => {
	it('refuses a non-admin actor before the directory', async () => {
		await expect(searchDirectoryGroups(user, 'eng')).rejects.toMatchObject({ code: 'forbidden' })
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it('answers nothing while LDAP is off', async () => {
		mocks.directoryConfig.mockReturnValue(null)
		expect(await searchDirectoryGroups(admin, 'eng')).toEqual([])
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it('searches through one service-bound client', async () => {
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		mocks.searchGroups.mockResolvedValue([{ key: 'k1', name: 'Engineering' }])
		expect(await searchDirectoryGroups(admin, 'eng')).toEqual([{ key: 'k1', name: 'Engineering' }])
		expect(mocks.searchGroups).toHaveBeenCalledWith('client', { url: 'ldaps://dc' }, 'eng')
	})
})
```

In `__tests__/group-management-schemas.test.ts`, append:

```ts
describe('directory groups on the group input (decision am)', () => {
	it('takes canonical keys with a name, at most 50', () => {
		const key = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'
		expect(
			groupInputSchema.parse({ name: 'Eng', directoryGroups: [{ id: key, name: ' Engineering ' }] })
				.directoryGroups,
		).toEqual([{ id: key, name: 'Engineering' }])
		expect(groupInputSchema.parse({ name: 'Eng' }).directoryGroups).toEqual([])
		expect(
			groupInputSchema.safeParse({
				name: 'Eng',
				directoryGroups: [{ id: key.toUpperCase(), name: 'x' }],
			}).success,
		).toBe(false)
		expect(
			groupInputSchema.safeParse({
				name: 'Eng',
				directoryGroups: Array.from({ length: 51 }, () => ({ id: key, name: 'x' })),
			}).success,
		).toBe(false)
	})

	it('bounds the search text (decision al)', () => {
		expect(directoryGroupSearchSchema.parse('  eng ')).toBe('eng')
		expect(directoryGroupSearchSchema.safeParse('e').success).toBe(false)
		expect(directoryGroupSearchSchema.safeParse('x'.repeat(65)).success).toBe(false)
	})
})
```

(add `directoryGroupSearchSchema` to that file's import.)

In `__tests__/data-groups.test.ts`:

1. Add `directoryLinks: []` to the expected object of the `toGroupDto` test and to the `toGroupDtos` test where it compares whole DTOs (it maps fields, so only if it compares `directoryLinks`), and add `directoryGroups: []` to the two `createGroup`/`updateGroup` inputs in the non-admin `it.each`.
2. Import `directoryLinkChanges`, `linksOf`, `removeLinks` and append:

```ts
describe('the directory links of a group (decision am)', () => {
	it('diffs the links by key: removes the dropped, inserts the new, renames the kept', () => {
		expect(
			directoryLinkChanges(
				[
					{ directoryGroupId: 'k1', directoryGroupName: 'Old' },
					{ directoryGroupId: 'k2', directoryGroupName: 'Two' },
				],
				[
					{ id: 'k1', name: 'New' },
					{ id: 'k3', name: 'Three' },
				],
			),
		).toEqual({
			add: [{ id: 'k3', name: 'Three' }],
			remove: ['k2'],
			rename: [{ id: 'k1', name: 'New' }],
		})
	})

	it('reads the links with a locking read and deletes only the named ones', () => {
		const read = linksOf(drizzle.mock(), 'g1').toSQL()
		expect(read.sql).toMatch(
			/from `user_group_directory_links` where `user_group_directory_links`\.`group_id` = \? for update$/,
		)
		const removal = removeLinks(drizzle.mock(), 'g1', ['k2']).toSQL()
		expect(removal.sql).toMatch(/^delete from `user_group_directory_links` where /)
		expect(removal.params).toEqual(['g1', 'k2'])
	})

	it('shows the links on the DTO with missing_since as an ISO date', () => {
		const at = new Date('2026-10-10T08:00:00.000Z')
		const [dto] = toGroupDtos(
			[{ id: 'g1', name: 'Eng', description: null, createdAt: at, updatedAt: at }],
			[],
			[],
			[
				{
					groupId: 'g1',
					directoryGroupId: 'k1',
					directoryGroupName: 'Engineering',
					missingSince: at,
				},
			],
		)
		expect(dto.directoryLinks).toEqual([
			{ id: 'k1', name: 'Engineering', missingSince: '2026-10-10T08:00:00.000Z' },
		])
	})
})
```

In `__tests__/group-management-actions.test.ts`, the database fake must tell the link table from the members table, since a save now also reads the group's links. Replace its `query` and `select` with ones that keep the table `from()` received, and add the links' rows to the hoisted state:

```ts
	// The fake answers by table: the group's lock (limit().for()), its manual members or its links (where().for()).
	const queryOn = (table: unknown) => ({
		where: () => ({
			limit: () => ({ for: forUpdate(() => (locked.value ? [locked.value] : [])) }),
			for: forUpdate(() => (table === userGroupDirectoryLinks ? links.value : manual.value)),
		}),
	})
	const db = {
		select: () => ({ from: queryOn }),
		…
```

with `links: { value: [] as { directoryGroupId: string; directoryGroupName: string }[] }` in `vi.hoisted`, reset to `[]` in `beforeEach`, and `userGroupDirectoryLinks` imported from `@/db/schema` inside the `vi.mock('@/db', …)` factory through `await import('@/db/schema')` (make the factory `async`; Vitest docs, `vi.mock` "factory … may return a promise"). Then append to `describe('the owner', …)`:

```ts
it('saves the directory links with the group, and drops the directory members when no link is left (decision am)', async () => {
	const key = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'
	expect(
		await updateGroupAction(groupId, {
			...input,
			directoryGroups: [{ id: key, name: 'Engineering' }],
		}),
	).toEqual({
		ok: true,
		data: undefined,
	})
	expect(writes.insert.mock.calls.some(([rows]) => JSON.stringify(rows).includes(key))).toBe(true)

	for (const fn of Object.values(writes)) fn.mockClear()
	links.value = [{ directoryGroupId: key, directoryGroupName: 'Engineering' }]
	expect(await updateGroupAction(groupId, { ...input, directoryGroups: [] })).toEqual({
		ok: true,
		data: undefined,
	})
	// The link, then the group's directory memberships (SQL pinned in data-groups.test.ts).
	expect(writes.delete).toHaveBeenCalledTimes(2)
})

it('refuses a key that is not canonical, before any write', async () => {
	expect(
		await updateGroupAction(groupId, {
			...input,
			directoryGroups: [{ id: 'CN=Engineering', name: 'Engineering' }],
		}),
	).toMatchObject({ ok: false, code: 'invalid_input' })
	expect(anyWrite()).toBe(false)
})
```

and a describe for the search action:

```ts
describe('searchDirectoryGroupsAction', () => {
	it('refuses a user-role session and a missing one, before the directory', async () => {
		getServerSession.mockResolvedValue({ user })
		expect(await searchDirectoryGroupsAction('eng')).toEqual({ ok: false, code: 'forbidden' })
		getServerSession.mockResolvedValue(null)
		expect(await searchDirectoryGroupsAction('eng')).toEqual({ ok: false, code: 'unauthorized' })
		expect(vi.mocked(searchDirectoryGroups)).not.toHaveBeenCalled()
	})

	it('answers the groups for an admin, invalid_input for a short text, directory_unavailable when the directory is down', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		vi.mocked(searchDirectoryGroups).mockResolvedValue([{ key: 'k1', name: 'Engineering' }])
		expect(await searchDirectoryGroupsAction(' eng ')).toEqual({
			ok: true,
			data: [{ key: 'k1', name: 'Engineering' }],
		})
		expect(vi.mocked(searchDirectoryGroups)).toHaveBeenCalledWith(owner, 'eng')
		expect(await searchDirectoryGroupsAction('e')).toMatchObject({
			ok: false,
			code: 'invalid_input',
		})
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.mocked(searchDirectoryGroups).mockRejectedValue(
				new DirectoryUnavailableError({ cause: new Error('ETIMEDOUT') }),
			)
			expect(await searchDirectoryGroupsAction('eng')).toEqual({
				ok: false,
				code: 'directory_unavailable',
			})
		} finally {
			log.mockRestore()
		}
	})
})
```

with `vi.mock('@/lib/directory/admin', () => ({ searchDirectoryGroups: vi.fn() }))`, and the imports of `searchDirectoryGroupsAction`, `searchDirectoryGroups` and `DirectoryUnavailableError`.

In `__tests__/action-failure.test.ts` (create it if the file does not exist; it tests `toActionFailure`), append:

```ts
it('maps an unreachable directory to directory_unavailable and logs it reduced (spec §7.3)', async () => {
	const { DirectoryUnavailableError } = await import('@/lib/directory/errors')
	const log = vi.spyOn(console, 'error').mockImplementation(() => {})
	try {
		expect(
			toActionFailure(new DirectoryUnavailableError({ cause: new Error('x') }), 'ctx'),
		).toEqual({ ok: false, code: 'directory_unavailable' })
		expect(log).toHaveBeenCalledTimes(1)
	} finally {
		log.mockRestore()
	}
})
```

In `__tests__/group-errors.test.ts`, add `['directory_unavailable', 'admin_groups.directory_unavailable']` to its table (or an `expect(groupErrorKey('directory_unavailable')).toBe('admin_groups.directory_unavailable')`).

Run: `pnpm exec vitest run __tests__/directory-admin.test.ts __tests__/group-management-schemas.test.ts __tests__/data-groups.test.ts __tests__/group-management-actions.test.ts __tests__/action-failure.test.ts __tests__/group-errors.test.ts` Expected: FAIL.

- [ ] **Step 2: The action code and its mapping**

`lib/action-result.ts`: add `| 'directory_unavailable'` to `ActionErrorCode` (after `dify_unreachable`).

`lib/action-failure.ts`: import `DirectoryUnavailableError` from `@/lib/directory/errors` and add, after the `DifyError` branch:

```ts
// Spec §7.3: the directory did not answer; logged by name and reduced cause (lib/error-log.ts), shown as its own code.
if (error instanceof DirectoryUnavailableError) {
	logActionError(error, context)
	return fail('directory_unavailable')
}
```

`components/admin/groups/group-errors.ts`: `case 'directory_unavailable': return 'admin_groups.directory_unavailable' as const`.

- [ ] **Step 3: `lib/directory/admin.ts`**

```ts
import 'server-only'

import { assertAdmin, type SessionUser } from '@/lib/auth/session'

import { directoryConfig } from './config'
import { withDirectory } from './connection'
import { searchGroups } from './operations'

/*
 * The directory as the admin surface uses it (B3 spec §6.5, §6.6): each function takes the verified actor first and
 * checks admin rights itself, the Data Access Layer's pattern (ADR-0024), before it reaches the directory.
 */

export interface DirectoryGroupOption {
	key: string
	name: string
}

/** Spec §6.5 "Linking": up to twenty directory groups whose name contains the text; none while LDAP is off. */
export async function searchDirectoryGroups(
	actor: SessionUser,
	text: string,
): Promise<DirectoryGroupOption[]> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return []
	return withDirectory(config, client => searchGroups(client, config, text))
}
```

- [ ] **Step 4: The schemas and the action**

In `app/(admin)/group-management/schemas.ts`, import `DIRECTORY_KEY_PATTERN` from `@/lib/directory-status` and add:

```ts
export const DIRECTORY_SEARCH_MIN = 2
export const DIRECTORY_SEARCH_MAX = 64
export const DIRECTORY_GROUPS_MAX = 50

/** Decision al: the text an admin types to find a directory group. */
export const directoryGroupSearchSchema = z
	.string()
	.trim()
	.min(DIRECTORY_SEARCH_MIN)
	.max(DIRECTORY_SEARCH_MAX)
```

and, in `groupInputSchema`, after `memberIds`:

```ts
	/** Decision am: the linked directory groups by canonical key, with the name the search showed. */
	directoryGroups: z
		.array(z.object({ id: z.string().regex(DIRECTORY_KEY_PATTERN), name: z.string().trim().min(1).max(255) }))
		.max(DIRECTORY_GROUPS_MAX)
		.default([]),
```

In `app/(admin)/group-management/actions.ts`, import `ok` beside `fail`, `searchDirectoryGroups` and `DirectoryGroupOption` from `@/lib/directory/admin` and `directoryGroupSearchSchema`, and add:

```ts
export async function searchDirectoryGroupsAction(
	text: unknown,
): Promise<ActionResult<DirectoryGroupOption[]>> {
	try {
		const actor = await requireAdmin()
		const parsed = directoryGroupSearchSchema.safeParse(text)
		if (!parsed.success) return invalidInput(parsed.error)
		return ok(await searchDirectoryGroups(actor, parsed.data))
	} catch (error) {
		return toActionFailure(error, 'searchDirectoryGroupsAction')
	}
}
```

- [ ] **Step 5: The groups DAL**

In `lib/data/groups.ts`:

- import `userGroupDirectoryLinks` from `@/db/schema`;
- add the DTO and input types:

```ts
/** A linked directory group as the groups page shows it (spec §4.3): its key, its name, since when it is missing. */
export interface DirectoryLinkDto {
	id: string
	name: string
	missingSince: string | null
}
```

`GroupDto` gains `directoryLinks: DirectoryLinkDto[]`; `GroupInput` gains `directoryGroups: { id: string; name: string }[]`;

- `toGroupDto(row, members, appCount, links: DirectoryLinkDto[] = [])` returns `directoryLinks: links`; `toGroupDtos(groups, members, grants, links: readonly { groupId: string; directoryGroupId: string; directoryGroupName: string; missingSince: Date | null }[] = [])` groups the links once with `Map.groupBy` and maps each to `{ id: link.directoryGroupId, name: link.directoryGroupName, missingSince: link.missingSince?.toISOString() ?? null }`;
- `listGroups` reads the links as a fourth query of its `Promise.all` (`db.select({ groupId, directoryGroupId, directoryGroupName, missingSince }).from(userGroupDirectoryLinks)`) and passes them on;
- add the builders and the diff:

```ts
/** The group's links, with a locking read (MySQL 8.4 "Locking Reads"), before the save changes them. */
export const linksOf = (tx: Pick<Tx, 'select'>, groupId: string) =>
	tx
		.select({
			directoryGroupId: userGroupDirectoryLinks.directoryGroupId,
			directoryGroupName: userGroupDirectoryLinks.directoryGroupName,
		})
		.from(userGroupDirectoryLinks)
		.where(eq(userGroupDirectoryLinks.groupId, groupId))
		.for('update')

export const removeLinks = (tx: Pick<Tx, 'delete'>, groupId: string, keys: readonly string[]) =>
	tx
		.delete(userGroupDirectoryLinks)
		.where(
			and(
				eq(userGroupDirectoryLinks.groupId, groupId),
				inArray(userGroupDirectoryLinks.directoryGroupId, keys),
			),
		)

/** Decision am: what a save changes in the links, by key; a kept link takes the picked name. */
export const directoryLinkChanges = (
	current: readonly { directoryGroupId: string; directoryGroupName: string }[],
	next: readonly { id: string; name: string }[],
): {
	add: { id: string; name: string }[]
	remove: string[]
	rename: { id: string; name: string }[]
} => {
	const now = new Map(current.map(link => [link.directoryGroupId, link.directoryGroupName]))
	const wanted = new Map(next.map(link => [link.id, link.name]))
	return {
		add: [...wanted].filter(([id]) => !now.has(id)).map(([id, name]) => ({ id, name })),
		remove: [...now.keys()].filter(id => !wanted.has(id)),
		rename: [...wanted]
			.filter(([id, name]) => now.has(id) && now.get(id) !== name)
			.map(([id, name]) => ({ id, name })),
	}
}

const linkRows = (groupId: string, links: readonly { id: string; name: string }[]) =>
	links.map(link => ({ groupId, directoryGroupId: link.id, directoryGroupName: link.name }))
```

- `createGroup` inserts `linkRows(id, unique)` after the members when `input.directoryGroups` is not empty (`unique` = the links once per key, the last name kept);
- `updateGroup`, after the manual members:

```ts
const currentLinks = await linksOf(tx, id)
const links = directoryLinkChanges(currentLinks, input.directoryGroups)
if (links.remove.length) await removeLinks(tx, id, links.remove)
if (links.add.length) await tx.insert(userGroupDirectoryLinks).values(linkRows(id, links.add))
for (const link of links.rename)
	await tx
		.update(userGroupDirectoryLinks)
		.set({ directoryGroupName: link.name })
		.where(
			and(
				eq(userGroupDirectoryLinks.groupId, id),
				eq(userGroupDirectoryLinks.directoryGroupId, link.id),
			),
		)
// Decision am: with no link left, nothing would refresh the group's directory members, so they go now.
if (currentLinks.length > 0 && input.directoryGroups.length === 0)
	await tx
		.delete(userGroupMembers)
		.where(and(eq(userGroupMembers.groupId, id), eq(userGroupMembers.source, 'directory')))
```

and add to `__tests__/data-groups.test.ts`'s link describe a render of that last delete through a small exported builder if you extract one (`removeDirectoryMembers(tx, groupId)`, asserting `source = 'directory'`); extract it, so the SQL is pinned.

- [ ] **Step 6: The page and the table**

`app/(admin)/group-management/page.tsx` passes `directoryEnabled={isDirectoryConfigured()}` to `GroupManagement`, which passes it to the drawer and, in the table, adds a column after the members when it is true:

```tsx
			...(directoryEnabled
				? [
						{
							title: t('admin_groups.column_directory_groups'),
							key: 'directoryGroups',
							render: (_: unknown, group: GroupDto) =>
								group.directoryLinks.length ? (
									<Flex
										wrap
										gap="small"
									>
										{group.directoryLinks.map(link => (
											<Tag
												key={link.id}
												color={link.missingSince ? 'warning' : 'blue'}
											>
												{link.missingSince
													? t('admin_groups.directory_group_missing', { name: link.name })
													: link.name}
											</Tag>
										))}
									</Flex>
								) : null,
						},
					]
				: []),
```

The members count already counts each account once (B3a).

- [ ] **Step 7: The drawer**

In `components/admin/groups/group-form-drawer.tsx`:

- the form's values type is `GroupFormValues = Omit<GroupFormInput, 'directoryGroups'> & { directoryGroups?: { value: string; label: string }[] }` (antd Select `labelInValue`: "the value … will be `{ value, label }`"); `initialValues` set `directoryGroups: group?.directoryLinks.map(link => ({ value: link.id, label: link.name })) ?? []`; `onSave` maps it back: `{ ...values, directoryGroups: (values.directoryGroups ?? []).map(({ value, label }) => ({ id: value, name: String(label) })) }`;
- under the manual members, for an existing group with directory members (`group.members.filter(member => member.source === 'directory')`, labelled through `users`), a read-only list:

```tsx
{
	directoryMembers.length > 0 && (
		<Form.Item
			label={t('admin_groups.directory_members')}
			extra={t('admin_groups.directory_members_hint')}
		>
			<Flex
				wrap
				gap="small"
			>
				{directoryMembers.map(user => (
					<Tag
						key={user.id}
						color="blue"
					>
						{accountOptionLabel(user, t('admin_users.status_deactivated'))}
					</Tag>
				))}
			</Flex>
		</Form.Item>
	)
}
```

- when `directoryEnabled`, the field:

```tsx
{
	directoryEnabled && (
		<Form.Item
			name="directoryGroups"
			label={t('admin_groups.directory_groups')}
			extra={t('admin_groups.directory_groups_hint')}
		>
			<DirectoryGroupSelect />
		</Form.Item>
	)
}
```

- and the select, after antd's "Search and Select Users" demo (remote search, debounced, callback order kept, `labelInValue`, `showSearch` with `filterOption: false`) with ahooks' `useDebounceFn` (ahooks docs) in place of the demo's lodash:

```tsx
/** The directory groups field (spec §6.5): a debounced remote search through searchDirectoryGroupsAction (decision al). */
function DirectoryGroupSelect({
	value,
	onChange,
}: {
	value?: { value: string; label: string }[]
	onChange?: (value: { value: string; label: string }[]) => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const [options, setOptions] = useState<{ value: string; label: string }[]>([])
	const [fetching, setFetching] = useState(false)
	const [limited, setLimited] = useState(false)
	const { token } = theme.useToken()
	// Only the latest search's answer is shown (the demo's "ajax callback order flow").
	const latest = useRef(0)
	const { run: search } = useDebounceFn(
		async (text: string) => {
			latest.current += 1
			const mine = latest.current
			setOptions([])
			setLimited(false)
			if (text.trim().length < DIRECTORY_SEARCH_MIN) {
				setFetching(false)
				return
			}
			setFetching(true)
			const result = await searchDirectoryGroupsAction(text)
			if (mine !== latest.current) return
			setFetching(false)
			if (result.ok) {
				setOptions(result.data.map(group => ({ value: group.key, label: group.name })))
				setLimited(result.data.length >= DIRECTORY_GROUP_SEARCH_LIMIT)
			} else message.error(t(groupErrorKey(result.code)))
		},
		{ wait: 300 },
	)
	return (
		<Select
			mode="multiple"
			labelInValue
			value={value}
			onChange={onChange}
			options={options}
			getPopupContainer={drawerPopupContainer}
			showSearch={{ filterOption: false, onSearch: search, autoClearSearchValue: false }}
			notFoundContent={fetching ? <Spin size="small" /> : t('admin_groups.directory_groups_none')}
			// Decision al: twenty answers may not be all; the list says so (antd Select `popupRender`, 5.25.0).
			popupRender={menu => (
				<>
					{menu}
					{limited && (
						<Typography.Paragraph
							type="secondary"
							style={{ margin: 0, padding: `${token.paddingXS}px ${token.paddingSM}px` }}
						>
							{t('admin_groups.directory_groups_limited', { count: DIRECTORY_GROUP_SEARCH_LIMIT })}
						</Typography.Paragraph>
					)}
				</>
			)}
			placeholder={t('admin_groups.directory_groups_placeholder')}
		/>
	)
}
```

(imports: `useRef`, `useState` from `react`; `useDebounceFn` from `ahooks`; `Spin`, `Tag`, `Flex`, `Typography`, `theme` from `antd`; `searchDirectoryGroupsAction`; `DIRECTORY_SEARCH_MIN`; `DIRECTORY_GROUP_SEARCH_LIMIT` from `@/lib/directory-status`.) Calling the Server Action from the search handler without a transition is documented (Next `02-guides/server-actions.md`: Server Functions "can be invoked … in event handlers"); it changes nothing, so it needs no `refresh()`.

- [ ] **Step 8: The texts**

Add to `admin_groups` in each translation file:

| Key | en | zh | ar |
| --- | --- | --- | --- |
| `column_directory_groups` | Directory groups | 目录群组 | مجموعات الدليل |
| `directory_groups` | Directory groups | 目录群组 | مجموعات الدليل |
| `directory_groups_placeholder` | Type at least two characters to search the directory | 输入至少两个字符以搜索目录 | اكتب حرفين على الأقل للبحث في الدليل |
| `directory_groups_hint` | Members of these directory groups, nested groups included, belong to this group. Changes apply at the next sync or the member's next directory sign-in; removing every link removes the directory members at once. | 这些目录群组（包括嵌套群组）的成员属于本群组。更改会在下次同步或该成员下次通过目录登录时生效；移除全部关联会立即移除目录成员。 | ينتمي أعضاء مجموعات الدليل هذه، بما فيها المجموعات المتداخلة، إلى هذه المجموعة. تسري التغييرات عند المزامنة التالية أو عند تسجيل دخول العضو التالي عبر الدليل؛ وإزالة كل الروابط تُزيل أعضاء الدليل فورًا. |
| `directory_groups_none` | No matching directory group | 没有匹配的目录群组 | لا توجد مجموعة مطابقة في الدليل |
| `directory_groups_limited` | Showing the first {{count}} matches; type more to narrow the search. | 仅显示前 {{count}} 个匹配项，请输入更多字符以缩小范围。 | تُعرض أول {{count}} نتيجة فقط؛ اكتب المزيد لتضييق البحث. |
| `directory_group_missing` | {{name}} (not found) | {{name}}（未找到） | {{name}} (غير موجودة) |
| `directory_members` | Directory members | 目录成员 | أعضاء الدليل |
| `directory_members_hint` | Added by the directory sync; change them in the directory. | 由目录同步添加；请在目录中修改。 | أضافتهم مزامنة الدليل؛ غيّرهم في الدليل. |
| `directory_unavailable` | The directory is unreachable. Try again later. | 无法连接目录，请稍后重试。 | تعذّر الوصول إلى الدليل. حاول مرة أخرى لاحقًا. |

- [ ] **Step 9: The e2e spec**

Create `e2e/directory-groups.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import type { RowDataPacket } from 'mysql2/promise'

import { deleteApp, deleteGroupsLike, grantAppToGroup, seedApp } from './fixtures/access'
import { ADMIN_STATE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { DIRECTORY_PASSWORD, deleteDirectoryAccount } from './fixtures/directory'
import { drawerOpened } from './fixtures/drawer'
import { signInWithDirectory } from './fixtures/users'

const tag = () => `dir-link-${test.info().project.name}`

test.use({ storageState: ADMIN_STATE })

// Spec §8 "Playwright" (B3b): "a link to a nested AD group grants an app". bob is in hub-backend, which is in
// hub-engineering (e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh); the hub group links hub-engineering.
test.describe('directory groups on the groups page (spec §6.5)', () => {
	let appId: string | undefined
	test.afterEach(async () => {
		if (appId) await deleteApp(appId)
		appId = undefined
		await deleteGroupsLike(`${tag()}%`)
		await deleteDirectoryAccount('bob@e2e.hub.test')
	})

	test('links a parent directory group; a member of its nested group gets the granted app at sign-in', async ({
		page,
		browser,
	}) => {
		await page.goto('/group-management')
		await page.getByRole('button', { name: 'Add group' }).click()
		const drawer = page.getByRole('dialog', { name: 'Add group' })
		await drawerOpened(drawer)
		await drawer.getByLabel('Name').fill(tag())
		await drawer.getByLabel('Directory groups').fill('engin')
		await page.getByTitle('hub-engineering', { exact: true }).click()
		await drawer.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(page.getByText('Group added')).toBeVisible()
		const row = page.getByRole('row', { name: new RegExp(tag()) })
		await expect(row.getByText('hub-engineering', { exact: true })).toBeVisible()

		const groupId = await withDb(async db => {
			const [rows] = await db.execute<RowDataPacket[]>(
				'SELECT id FROM user_groups WHERE name = ?',
				[tag()],
			)
			return String(rows[0]!.id)
		})
		appId = await seedApp({ name: `${tag()} app`, accessMode: 'restricted' })
		await grantAppToGroup(appId, groupId)

		const bobContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const bobPage = await bobContext.newPage()
			await signInWithDirectory(bobPage, 'bob', DIRECTORY_PASSWORD)
			await expect(bobPage).toHaveURL(/\/apps$/)
			await expect(bobPage.getByText(`${tag()} app`)).toBeVisible()
		} finally {
			await bobContext.close()
		}

		// The sign-in wrote bob's directory membership; the drawer lists it read-only (spec §4.3).
		await page.reload()
		await row.getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog', { name: 'Edit group' })
		await drawerOpened(edit)
		await expect(edit.getByText(/Bob Builder/)).toBeVisible()
		await expect(edit.getByText('Directory members')).toBeVisible()
	})

	test('a short search asks for more and searches nothing', async ({ page }) => {
		await page.goto('/group-management')
		await page.getByRole('button', { name: 'Add group' }).click()
		const drawer = page.getByRole('dialog', { name: 'Add group' })
		await drawerOpened(drawer)
		await drawer.getByLabel('Directory groups').fill('e')
		await expect(page.getByText('No matching directory group')).toBeVisible()
		await drawer.getByRole('button', { name: 'Cancel' }).click()
	})
})
```

Run (with `pnpm dev` stopped): `pnpm exec playwright test e2e/directory-groups.spec.ts e2e/admin-groups.spec.ts` Expected: every test passes on the three projects.

- [ ] **Step 10: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <every changed file>
pnpm exec oxfmt --write <every changed file> && pnpm exec oxfmt --check <every changed file>
npx -y @ant-design/cli lint ./
pnpm test
git add lib/directory/admin.ts lib/action-result.ts lib/action-failure.ts lib/data/groups.ts "app/(admin)/group-management/page.tsx" "app/(admin)/group-management/actions.ts" "app/(admin)/group-management/schemas.ts" components/admin/groups/group-management.tsx components/admin/groups/group-form-drawer.tsx components/admin/groups/group-errors.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json e2e/directory-groups.spec.ts __tests__/directory-admin.test.ts __tests__/data-groups.test.ts __tests__/group-management-actions.test.ts __tests__/group-management-schemas.test.ts __tests__/group-errors.test.ts __tests__/action-failure.test.ts
git commit -m "feat(groups): link hub groups to directory groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 13: Directory accounts on the users page

Spec §5 last bullet (the status column gains "Not in directory", a source column), §6.3 last paragraph (a directory account's name and email are read-only, it has no password field, its role follows the rank map, deleting it warns), §7.4. ADR-0024 (rank map, `lockTarget`), ADR-0027 (two markers, each written only by its owner). Review Focus: line 2 (no password reaches a directory account through a direct action call).

**Files:**

- Modify: `lib/data/users.ts`, `app/(admin)/user-management/{actions,schemas}.ts`, `components/admin/users/{user-management,user-form-drawer}.tsx`, `locales/{en,zh,ar}/translation.json`, `e2e/fixtures/users.ts`, `__tests__/data-users.test.ts`, `__tests__/user-management-actions.test.ts`
- Create: `e2e/directory-accounts.spec.ts`

**Interfaces:**

- Consumes: `users.source`, `users.directoryUsername`, `users.directoryDeactivatedAt` (Task 1); `AccountSource` from `@/lib/auth/account-source`.
- Produces: `UserDto` gains `source: AccountSource`, `directoryUsername: string | null`, `directoryDeactivation: { at: string } | null`; `updateUserRole(actor: SessionUser, id: string, role: Role): Promise<ActionResult>` in `@/lib/data/users`; `updateUserRoleAction(id: string, input: unknown): Promise<ActionResult>` in `app/(admin)/user-management/actions.ts`; `userRoleInputSchema` in its `schemas.ts`; `seedDirectoryUser(...)` in `e2e/fixtures/users.ts`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **an. A directory account's edit is a role-only action.** `updateUserRoleAction` → `updateUserRole` writes only the role, under the rank map and the locked target row; `updateUser` refuses an `ldap` target with `forbidden`, so a direct call cannot set its password, name or email (the directory overwrites name and email; spec §6.3). Next's guide asks every Server Action to verify its caller ("Treat Server Actions with the same security considerations as public-facing API endpoints", `02-guides/server-actions.md`); Mattermost refuses LDAP-owned attributes through its API ("the following user attribute changes can't be made through the API: first name, last name, position, nickname, email, profile picture, or username", `mattermost/docs@bd09d959:source/administration-guide/onboard/ad-ldap.rst:111`), and GitLab keeps LDAP-synced email out of the user's edit (`gitlabhq@0739b8bf:doc/administration/auth/ldap/_index.md:1457-1466`).
- **ao. Deactivate is offered while the admin marker is empty**, not only while the account is active: an account the directory has deactivated can also be deactivated by an admin, so it stays off when the directory lists it again (ADR-0027: two independent markers). `setUserActive` already decides on the admin marker alone (deviation 6).

- [ ] **Step 1: Write the failing DAL and action tests**

In `__tests__/data-users.test.ts`:

1. Add `source: 'local' as const, directoryUsername: null,` to every row literal passed to `toUserDto` or `toUserDtos` (the `toUserDto` tests and `row()` in the `toUserDtos` test), and to the expected DTO of the first `toUserDto` test add `source: 'local', directoryUsername: null, directoryDeactivation: null,`.
2. Add `updateUserRole` to the import from `@/lib/data/users`.
3. Append:

```ts
describe('directory accounts (spec §6.3, decision an)', () => {
	it('shows a directory account with its source, username and the directory marker', () => {
		const at = new Date('2026-10-10T08:00:00.000Z')
		expect(
			toUserDto({
				id: 'd1',
				name: 'Bob',
				email: 'bob@example.com',
				role: 'user',
				source: 'ldap',
				directoryUsername: 'bob',
				adminDeactivatedAt: null,
				adminDeactivatedBy: null,
				directoryDeactivatedAt: at,
				createdAt: at,
				updatedAt: at,
			}),
		).toMatchObject({
			source: 'ldap',
			directoryUsername: 'bob',
			active: false,
			adminDeactivation: null,
			directoryDeactivation: { at: '2026-10-10T08:00:00.000Z' },
		})
	})

	it('reads the source under the lock', () => {
		expect(lockTarget(drizzle.mock(), 'u9').toSQL().sql).toMatch(
			/^select [^]*`source`[^]* from `users` /,
		)
	})

	/** A database whose transaction answers the locking read with `target` and records updates. */
	const withTarget = (target: {
		id: string
		role: 'user' | 'admin'
		adminDeactivatedAt: null
		source: 'local' | 'ldap'
	}) => {
		const updates: { values: unknown; condition: SQL }[] = []
		const tx = {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => ({
							for: (strength: string) =>
								strength === 'update'
									? Promise.resolve([target])
									: Promise.reject(new Error(strength)),
						}),
					}),
				}),
			}),
			update: () => ({
				set: (values: unknown) => ({
					where: (condition: SQL) => {
						updates.push({ values, condition })
						return Promise.resolve([{ affectedRows: 1 }])
					},
				}),
			}),
		}
		database.value = { transaction: (work: (t: typeof tx) => unknown) => work(tx) }
		return updates
	}

	it('refuses the full edit of a directory account, before any write', async () => {
		const updates = withTarget({ id: 'd1', role: 'user', adminDeactivatedAt: null, source: 'ldap' })
		expect(
			await updateUser({ id: 'o1', email: 'o@e.com', name: null, role: 'owner' }, 'd1', {
				name: 'N',
				email: 'n@e.com',
				role: 'user',
				password: 'password-1',
			}),
		).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
	})

	it('changes only the role, under the rank map', async () => {
		const owner = { id: 'o1', email: 'o@e.com', name: null, role: 'owner' as const }
		let updates = withTarget({ id: 'd1', role: 'user', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(owner, 'd1', 'admin')).toEqual({ ok: true, data: undefined })
		expect(updates.map(update => update.values)).toEqual([{ role: 'admin' }])

		// An admin cannot promote (ADR-0024's rank map) and cannot change its own role.
		const anAdmin = { id: 'a1', email: 'a@e.com', name: null, role: 'admin' as const }
		updates = withTarget({ id: 'd1', role: 'user', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(anAdmin, 'd1', 'admin')).toEqual({ ok: false, code: 'forbidden' })
		updates = withTarget({ id: 'a1', role: 'admin', adminDeactivatedAt: null, source: 'ldap' })
		expect(await updateUserRole(anAdmin, 'a1', 'user')).toEqual({ ok: false, code: 'forbidden' })
		expect(updates).toEqual([])
	})
})
```

Also add `updateUserRole` to the list in the existing `describe('the users DAL refuses a non-admin actor before any query (Review Focus 1)', …)` table, as `['updateUserRole', () => updateUserRole(member, 'u9', 'user')]`.

In `__tests__/user-management-actions.test.ts`, add `updateUserRole: vi.fn()` beside the other hoisted DAL mocks (and to the `vi.mock('@/lib/data/users', …)` object and the reset loop), import `updateUserRoleAction`, add `['updateUserRoleAction', () => updateUserRoleAction('u9', { role: 'user' })]` to the `it.each` of the refusal test (and `updateUserRole` to its `not.toHaveBeenCalled` loop), and append:

```ts
it('changes a role through the DAL with the verified admin, and refuses anything but a role', async () => {
	updateUserRole.mockResolvedValue({ ok: true, data: undefined })
	expect(await updateUserRoleAction('u9', { role: 'admin', password: 'sneaky-1' })).toEqual({
		ok: true,
		data: undefined,
	})
	// zod's object strips unknown keys (zod 4 "Objects"): only the role reaches the DAL.
	expect(updateUserRole).toHaveBeenCalledWith(admin, 'u9', 'admin')
	expect(refresh).toHaveBeenCalledTimes(1)
	expect(await updateUserRoleAction('u9', { role: 'superuser' })).toMatchObject({
		ok: false,
		code: 'invalid_input',
	})
	expect(await updateUserRoleAction('', { role: 'user' })).toEqual({ ok: false, code: 'not_found' })
})
```

Run: `pnpm exec vitest run __tests__/data-users.test.ts __tests__/user-management-actions.test.ts` Expected: FAIL (the DTO lacks the new fields; `updateUserRole` and `updateUserRoleAction` do not exist).

- [ ] **Step 2: The DAL**

In `lib/data/users.ts`:

- import `type AccountSource` from `@/lib/auth/account-source`;
- `UserDto` gains, after `role`:

```ts
/** Who owns the account's identity (ADR-0029). */
source: AccountSource
/** The directory login name of a directory account. */
directoryUsername: string | null
```

and, after `adminDeactivation`:

```ts
	/** Set while the directory sync has found the account missing (ADR-0027's directory marker): since when. */
	directoryDeactivation: { at: string } | null
```

- `dtoColumns` gains `source: users.source,` and `directoryUsername: users.directoryUsername,`; `UserDtoRow` gains `| 'source' | 'directoryUsername'`;
- `toUserDto` gains `source: row.source,`, `directoryUsername: row.directoryUsername,` and `directoryDeactivation: row.directoryDeactivatedAt ? { at: row.directoryDeactivatedAt.toISOString() } : null,`;
- `lockTarget` selects `source: users.source` too;
- in `updateUser`, right after `if (!target) return fail('not_found')`:

```ts
// Decision an: a directory account's name and email are the directory's and it has no hub password; its role
// changes through updateUserRole.
if (target.source === 'ldap') return fail('forbidden')
```

- after `updateUser`, add:

```ts
/**
 * Changes an account's role only (decision an): the edit of a directory account, whose other fields the directory owns.
 * The rank map applies against the locked target row as in updateUser (ADR-0024 decision d): your own role is fixed,
 * and another account's only within the roles the actor's rank manages.
 */
export async function updateUserRole(
	actor: SessionUser,
	id: string,
	role: Role,
): Promise<ActionResult> {
	assertAdmin(actor)
	return getDb().transaction(async tx => {
		const [target] = await lockTarget(tx, id)
		if (!target) return fail('not_found')
		const refusal = updateRefusal({ actor, target, input: { role } })
		if (refusal) return fail(refusal)
		await tx.update(users).set({ role }).where(eq(users.id, id))
		return ok(undefined)
	})
}
```

- [ ] **Step 3: The action**

In `app/(admin)/user-management/schemas.ts`, add:

```ts
/** A directory account's edit (decision an): the role alone. */
export const userRoleInputSchema = z.object({ role: z.enum(ROLES) })
```

In `app/(admin)/user-management/actions.ts`, import `updateUserRole` and `userRoleInputSchema`, and add after `updateUserAction`:

```ts
export async function updateUserRoleAction(id: string, input: unknown): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!userIdSchema.safeParse(id).success) return fail('not_found')
		const parsed = userRoleInputSchema.safeParse(input)
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await updateUserRole(actor, id, parsed.data.role)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'updateUserRoleAction')
	}
}
```

Run: `pnpm exec vitest run __tests__/data-users.test.ts __tests__/user-management-actions.test.ts` Expected: PASS.

- [ ] **Step 4: The texts**

Add to `admin_users` in each translation file (same keys in all three; `pnpm test` checks parity):

| Key | en | zh | ar |
| --- | --- | --- | --- |
| `column_source` | Source | 来源 | المصدر |
| `source_local` | Local | 本地 | محلي |
| `source_directory` | Directory | 目录 | الدليل |
| `status_not_in_directory` | Not in directory | 不在目录中 | غير موجود في الدليل |
| `not_in_directory_since` | Not found in the directory since | 自以下时间起在目录中未找到 | غير موجود في الدليل منذ |
| `directory_username` | Directory username | 目录用户名 | اسم المستخدم في الدليل |
| `directory_account` | Directory account | 目录账户 | حساب الدليل |
| `directory_fields_hint` | The name and email come from the directory and are updated at each directory sign-in and sync. | 姓名和邮箱来自目录，每次目录登录和同步时都会更新。 | يأتي الاسم والبريد الإلكتروني من الدليل، ويُحدَّثان عند كل تسجيل دخول عبر الدليل وكل مزامنة. |
| `delete_directory_confirm_description` | Delete this directory account? At their next directory sign-in the person gets a new account with a new Dify history. To keep the account, deactivate it instead. | 确定要删除这个目录账户吗？此人下次通过目录登录时会获得一个新账户和新的 Dify 记录。如需保留该账户，请改为停用。 | حذف حساب الدليل هذا؟ عند تسجيل دخوله التالي عبر الدليل سيحصل الشخص على حساب جديد بسجل Dify جديد. للإبقاء على الحساب، عطّله بدلًا من ذلك. |

- [ ] **Step 5: The table**

In `components/admin/users/user-management.tsx`:

- the search matches the directory username too: `matchesQuery([user.name, user.email, user.id, user.directoryUsername ?? ''], query)`;
- add a Source column after the user column:

```tsx
		{
			title: t('admin_users.column_source'),
			key: 'source',
			render: (_, user) =>
				user.source === 'ldap' ? (
					<Space
						direction="vertical"
						size={0}
					>
						<Tag color="blue">{t('admin_users.source_directory')}</Tag>
						{user.directoryUsername && (
							<Typography.Text type="secondary">{user.directoryUsername}</Typography.Text>
						)}
					</Space>
				) : (
					<Tag>{t('admin_users.source_local')}</Tag>
				),
		},
```

- replace the status column's `render` with one that shows a tag per marker (both can be set):

```tsx
			render: (_, user) => {
				if (user.active) return <Tag color="green">{t('admin_users.status_active')}</Tag>
				const deactivation = user.adminDeactivation
				const by = deactivation ? nameOf(deactivation.by) : null
				// Who and when are in the tooltips only, so each opens on keyboard focus too: the tag takes focus and the
				// trigger includes `focus` (antd Tooltip FAQ, "How to support keyboard accessibility?"; WAI-ARIA APG,
				// "Tooltip Pattern"); antd describes the tag by the open tooltip (`aria-describedby`).
				return (
					<Flex
						wrap
						gap="small"
					>
						{deactivation && (
							<Tooltip
								trigger={['hover', 'focus']}
								title={
									<>
										<div>
											{by
												? t('admin_users.deactivated_by', { name: by })
												: t('admin_users.deactivated_by_unknown')}
										</div>
										<ClientDateTime value={deactivation.at} />
									</>
								}
							>
								<Tag
									color="red"
									tabIndex={0}
								>
									{t('admin_users.status_deactivated')}
								</Tag>
							</Tooltip>
						)}
						{user.directoryDeactivation && (
							<Tooltip
								trigger={['hover', 'focus']}
								title={
									<>
										<div>{t('admin_users.not_in_directory_since')}</div>
										<ClientDateTime value={user.directoryDeactivation.at} />
									</>
								}
							>
								<Tag
									color="orange"
									tabIndex={0}
								>
									{t('admin_users.status_not_in_directory')}
								</Tag>
							</Tooltip>
						)}
					</Flex>
				)
			},
```

- in the actions column: Edit shows for `(user.id === currentUser.id && user.source === 'local') || canManage(currentUser.role, user.role)` (your own directory row has nothing you may edit: name and email are the directory's, your role is fixed, your password is the directory's); Deactivate shows for `canManage(currentUser.role, user.role) && !user.adminDeactivation` (decision ao); the delete Popconfirm's description is `t(user.source === 'ldap' ? 'admin_users.delete_directory_confirm_description' : 'admin_users.delete_confirm_description')`.

- [ ] **Step 6: The drawer**

In `components/admin/users/user-form-drawer.tsx`, import `Descriptions` from `antd` and `updateUserRoleAction`, add the role-only form, and render it for a directory account instead of the full form:

```tsx
/**
 * A directory account's edit (decision an): the name, email and directory username read-only, since the directory
 * overwrites them, and the role under the rank map; no password (spec §6.3).
 */
function DirectoryUserForm({
	user,
	roleOptions,
	onSave,
}: {
	user: UserDto
	roleOptions: readonly Role[]
	onSave: (values: { role: Role }) => void
}) {
	const { t } = useTranslation()
	return (
		<Form<{ role: Role }>
			id={USER_FORM_ID}
			layout="vertical"
			initialValues={{ role: user.role }}
			onFinish={onSave}
		>
			<Descriptions
				column={1}
				size="small"
				items={[
					{
						key: 'name',
						label: t('admin_users.name'),
						children: user.name || t('admin_users.name_not_set'),
					},
					{ key: 'email', label: t('auth.email'), children: user.email },
					{
						key: 'username',
						label: t('admin_users.directory_username'),
						children: user.directoryUsername ?? '',
					},
				]}
			/>
			<Typography.Paragraph type="secondary">
				{t('admin_users.directory_fields_hint')}
			</Typography.Paragraph>
			<Form.Item
				name="role"
				label={t('admin_users.role')}
				extra={roleOptions.length < 2 ? t('admin_users.role_owner_only_hint') : undefined}
			>
				<Radio.Group
					optionType="button"
					disabled={roleOptions.length < 2}
					options={roleOptions.map(role => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
				/>
			</Form.Item>
		</Form>
	)
}
```

In `UserFormDrawer`, add the save for it and the branch:

```tsx
const saveRole = (values: { role: Role }) =>
	void run(async () => {
		if (!user) return
		const result = await updateUserRoleAction(user.id, values)
		if (!result.ok) {
			message.error(t(userErrorKey(result.code)))
			return
		}
		message.success(t('admin_users.update_success'))
		onClose()
	})
```

The drawer's title becomes `user?.source === 'ldap' ? t('admin_users.directory_account') : user ? t('admin_users.edit_user') : t('admin_users.add_user')`, and its body:

```tsx
			{user?.source === 'ldap' ? (
				<DirectoryUserForm
					key={user.id}
					user={user}
					roleOptions={roleOptions}
					onSave={saveRole}
				/>
			) : (
				<Form<UserFormInput> …the existing form, unchanged… </Form>
			)}
```

(`roleOptions` is computed as today; for a directory account it is `MANAGEABLE_ROLES[currentUser.role]`, since its own row has no Edit.)

- [ ] **Step 7: The e2e spec**

In `e2e/fixtures/users.ts`, add:

```ts
/**
 * A directory account written straight to the e2e MySQL (no password, source `ldap`, a key), as the first directory
 * sign-in creates one (ADR-0029). Its email must carry the project name; the spec deletes it with deleteUsersLike.
 */
export const seedDirectoryUser = async ({
	email,
	name,
	username,
	notInDirectorySince = null,
}: {
	email: string
	name: string
	username: string
	notInDirectorySince?: Date | null
}): Promise<string> => {
	const id = randomUUID()
	await withDb(async db => {
		await db.execute('DELETE FROM users WHERE email = ?', [email])
		await db.execute(
			"INSERT INTO users (id, name, email, password, source, directory_id, directory_id_attribute, directory_username, directory_deactivated_at) VALUES (?, ?, ?, NULL, 'ldap', ?, 'objectGUID', ?, ?)",
			[id, name, email, randomUUID(), username, notInDirectorySince],
		)
	})
	return id
}
```

Create `e2e/directory-accounts.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { drawerOpened } from './fixtures/drawer'
import { deleteUsersLike, openUsers, seedDirectoryUser } from './fixtures/users'

const tag = () => `dir-acct-${test.info().project.name}`
const email = (suffix: string) => `${tag()}-${suffix}@e2e.local`

test.use({ storageState: ADMIN_STATE })

// Spec §6.3 and §5: a directory account is read-only but for its role, shows its source, and the sync's marker.
test.describe('directory accounts on the users page (ADR-0029)', () => {
	test.afterEach(async () => {
		await deleteUsersLike(`${tag()}%`)
	})

	test('shows the source, edits the role only, and warns before a delete', async ({ page }) => {
		await seedDirectoryUser({ email: email('bob'), name: 'Bob Builder', username: 'bob.builder' })
		await openUsers(page)
		await page.getByPlaceholder('Search users').fill('bob.builder')
		const row = page.getByRole('row', { name: new RegExp(email('bob')) })
		await expect(row.getByText('Directory', { exact: true })).toBeVisible()
		await expect(row.getByText('bob.builder', { exact: true })).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		const drawer = page.getByRole('dialog', { name: 'Directory account' })
		await drawerOpened(drawer)
		await expect(drawer.getByText(email('bob'))).toBeVisible()
		// Name and email are text, not fields; there is no password field (spec §6.3).
		await expect(drawer.getByRole('textbox')).toHaveCount(0)
		await drawer.getByText('Admin', { exact: true }).click()
		await drawer.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('User updated')).toBeVisible()
		await expect(row.getByText('Admin', { exact: true })).toBeVisible()

		await row.getByRole('button', { name: 'Delete' }).click()
		await expect(page.getByText(/gets a new account with a new Dify history/)).toBeVisible()
		await page.getByRole('button', { name: 'Cancel' }).last().click()
	})

	test('shows the directory marker with its date, and still offers Deactivate (decision ao)', async ({
		page,
	}) => {
		await seedDirectoryUser({
			email: email('carol'),
			name: 'Carol Gone',
			username: 'carol.gone',
			notInDirectorySince: new Date('2026-10-01T09:00:00Z'),
		})
		await openUsers(page)
		await page.getByPlaceholder('Search users').fill('carol.gone')
		const row = page.getByRole('row', { name: new RegExp(email('carol')) })
		const status = row.getByText('Not in directory', { exact: true })
		await expect(status).toBeVisible()
		await status.focus()
		await expect(page.getByRole('tooltip')).toContainText('Not found in the directory since')
		await status.blur()
		await expect(row.getByRole('button', { name: 'Deactivate' })).toBeVisible()
		await expect(row.getByRole('button', { name: 'Reactivate' })).toHaveCount(0)
	})
})
```

Run (with `pnpm dev` stopped): `pnpm exec playwright test e2e/directory-accounts.spec.ts e2e/admin-users.spec.ts e2e/deactivation.spec.ts` Expected: every test passes on the three projects.

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint lib/data/users.ts "app/(admin)/user-management/actions.ts" "app/(admin)/user-management/schemas.ts" components/admin/users/user-management.tsx components/admin/users/user-form-drawer.tsx e2e/fixtures/users.ts e2e/directory-accounts.spec.ts __tests__/data-users.test.ts __tests__/user-management-actions.test.ts
pnpm exec oxfmt --write <the same files> locales/en/translation.json locales/zh/translation.json locales/ar/translation.json && pnpm exec oxfmt --check <the same files>
npx -y @ant-design/cli lint ./
pnpm test
git add lib/data/users.ts "app/(admin)/user-management/actions.ts" "app/(admin)/user-management/schemas.ts" components/admin/users/user-management.tsx components/admin/users/user-form-drawer.tsx locales/en/translation.json locales/zh/translation.json locales/ar/translation.json e2e/fixtures/users.ts e2e/directory-accounts.spec.ts __tests__/data-users.test.ts __tests__/user-management-actions.test.ts
git commit -m "feat(users): show directory accounts and edit their role only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 14: The status panel and Sync now

Spec §6.6 (on the users page, for accounts with admin rights, when the `LDAP_*` block is set: the last run with its time, trigger, outcome, counts and error code; the next scheduled run or "off"; the encryption mode with an "Unencrypted connection" tag for `none`; a Sync now button, a Server Action that runs the sync and returns its outcome), §7.3 (the action code `sync_running`), §8 "Playwright" (Sync now deactivates and signs out a removed entry and reactivates it when it returns; the status panel). Review Focus: lines 3 and 5.

**Files:**

- Create: `components/admin/users/directory-status.tsx`, `components/admin/users/directory-labels.ts`, `__tests__/directory-labels.test.ts`, `e2e/directory-sync.spec.ts`
- Modify: `lib/directory/admin.ts`, `lib/action-result.ts`, `app/(admin)/user-management/{actions,page}.ts(x)`, `components/admin/users/{user-management,user-errors}.ts(x)`, `locales/{en,zh,ar}/translation.json`, `__tests__/directory-admin.test.ts`, `__tests__/user-management-actions.test.ts`, `__tests__/user-errors.test.ts`, `__tests__/user-management-page.test.ts`

**Interfaces:**

- Consumes: `runManualSync`, `RUNNING_GUARD_MS`, `SyncAttempt` (Task 10); `latestSyncRun`, `SyncRunRecord`, `SyncRunCounts` (Task 9); `directoryConfig` (Task 2); `SYNC_OUTCOMES`, `SYNC_TRIGGERS`, `SYNC_ERROR_CODES` (Task 1); `Cron` from `croner` (`nextRun()`).
- Produces: from `@/lib/directory/admin`: `interface DirectoryRunDto { trigger: SyncTrigger; startedAt: string; finishedAt: string | null; outcome: SyncOutcome | 'interrupted'; errorCode: string | null; counts: SyncRunCounts }`, `interface DirectoryStatusDto { encryption: LdapEncryption; schedule: string | null; timezone: string | null; nextRun: string | null; lastRun: DirectoryRunDto | null }`, `getDirectoryStatus(actor): Promise<DirectoryStatusDto | null>`, `syncDirectoryNow(actor): Promise<SyncAttempt | null>`; the action code `sync_running`; `syncDirectoryAction(): Promise<ActionResult<{ outcome: Exclude<SyncOutcome, 'running'>; counts: SyncRunCounts; errorCode: SyncErrorCode | null }>>`.

Decisions this task makes where the spec is silent (Task 15 records them in ADR-0029):

- **ap. A run still `running` past the 30-minute guard shows as "Did not finish"**: its container stopped mid-run (spec §13: "a run cut by a restart is repeated by the startup catch-up or the next slot"), and the next run is no longer held back by it (decision ag). Mattermost's job table shows each job's status, finish time and details, the error first (`mattermost@4d94455a:webapp/channels/src/components/admin_console/jobs/table.tsx:64-74, 255-290`); Grafana's LDAP page shows "Next synchronization" (`grafana@7b702d79:public/app/features/admin/ldap/LdapSyncInfo.tsx:12-29`); the panel shows both, and an error as its translated code, never raw text (spec §7.3; `ad-and-reference-projects.md` B.4).
- **aq. Sync now waits for its run** inside the Server Action and answers the outcome (spec §6.6), as Mattermost's "AD/LDAP Synchronize Now" starts a job the admin then watches (`admin_definition_ldap_wizard.tsx:655-666`). The self-hosted Node server sets no duration limit on a Server Action (Next `02-guides/self-hosting.md`); a directory of tens of thousands of entries pages in seconds to minutes (spec §6.4 step 1), within AD's 900-second idle limit.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/directory-admin.test.ts` (mock `@/lib/data/directory` with `latestSyncRun: vi.fn()` and `@/lib/directory/sync` with `runManualSync: vi.fn()`, `RUNNING_GUARD_MS: 30 * 60 * 1000`, both in the hoisted `mocks`):

```ts
describe('getDirectoryStatus (spec §6.6)', () => {
	const config = {
		url: 'ldap://10.0.0.5',
		encryption: 'none',
		syncSchedule: '0 * * * *',
		syncTimezone: 'UTC',
	}

	it('refuses a non-admin actor, and answers null while LDAP is off', async () => {
		await expect(getDirectoryStatus(user)).rejects.toMatchObject({ code: 'forbidden' })
		mocks.directoryConfig.mockReturnValue(null)
		expect(await getDirectoryStatus(admin)).toBeNull()
	})

	it('shows the mode, the next run from the cron expression, and the last run', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		const startedAt = new Date(Date.now() - 60_000)
		mocks.latestSyncRun.mockResolvedValue({
			id: 'r1',
			trigger: 'schedule',
			startedAt,
			finishedAt: new Date(),
			outcome: 'succeeded',
			errorCode: null,
			counts: {
				entriesSeen: 3,
				deactivated: 1,
				reactivated: 0,
				updated: 0,
				conflicts: 0,
				groupErrors: 0,
				membershipsAdded: 0,
				membershipsRemoved: 0,
			},
		})
		const status = await getDirectoryStatus(admin)
		expect(status).toMatchObject({
			encryption: 'none',
			schedule: '0 * * * *',
			timezone: 'UTC',
			lastRun: {
				trigger: 'schedule',
				outcome: 'succeeded',
				startedAt: startedAt.toISOString(),
				counts: { deactivated: 1 },
			},
		})
		// croner's nextRun(): the next full hour.
		expect(new Date(status!.nextRun!).getUTCMinutes()).toBe(0)
		expect(new Date(status!.nextRun!).getTime()).toBeGreaterThan(Date.now())
	})

	it('answers no next run with the schedule off, and "interrupted" for a run that outlived the guard (decision ap)', async () => {
		mocks.directoryConfig.mockReturnValue({ ...config, syncSchedule: null })
		mocks.latestSyncRun.mockResolvedValue({
			id: 'r1',
			trigger: 'manual',
			startedAt: new Date(Date.now() - 31 * 60 * 1000),
			finishedAt: null,
			outcome: 'running',
			errorCode: null,
			counts: {
				entriesSeen: 0,
				deactivated: 0,
				reactivated: 0,
				updated: 0,
				conflicts: 0,
				groupErrors: 0,
				membershipsAdded: 0,
				membershipsRemoved: 0,
			},
		})
		expect(await getDirectoryStatus(admin)).toMatchObject({
			nextRun: null,
			lastRun: { outcome: 'interrupted' },
		})
	})
})

describe('syncDirectoryNow', () => {
	it('refuses a non-admin actor before any run, answers null while LDAP is off, and runs a manual sync', async () => {
		await expect(syncDirectoryNow(user)).rejects.toMatchObject({ code: 'forbidden' })
		expect(mocks.runManualSync).not.toHaveBeenCalled()
		mocks.directoryConfig.mockReturnValue(null)
		expect(await syncDirectoryNow(admin)).toBeNull()
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		mocks.runManualSync.mockResolvedValue({ status: 'running' })
		expect(await syncDirectoryNow(admin)).toEqual({ status: 'running' })
		expect(mocks.runManualSync).toHaveBeenCalledWith({ url: 'ldaps://dc' })
	})
})
```

(and import `getDirectoryStatus`, `syncDirectoryNow`.)

In `__tests__/user-management-actions.test.ts`, hoist `syncDirectoryNow: vi.fn()` with `vi.mock('@/lib/directory/admin', () => ({ syncDirectoryNow }))`, import `syncDirectoryAction`, add `['syncDirectoryAction', () => syncDirectoryAction()]` to the refusal `it.each` (and `syncDirectoryNow` to its not-called loop), and append:

```ts
it('runs Sync now and answers the outcome, sync_running while one is going, not_found while LDAP is off', async () => {
	const counts = {
		entriesSeen: 3,
		deactivated: 1,
		reactivated: 0,
		updated: 0,
		conflicts: 0,
		groupErrors: 0,
		membershipsAdded: 0,
		membershipsRemoved: 0,
	}
	syncDirectoryNow.mockResolvedValue({
		status: 'finished',
		outcome: 'succeeded',
		counts,
		errorCode: null,
	})
	expect(await syncDirectoryAction()).toEqual({
		ok: true,
		data: { outcome: 'succeeded', counts, errorCode: null },
	})
	expect(syncDirectoryNow).toHaveBeenCalledWith(admin)
	expect(refresh).toHaveBeenCalledTimes(1)
	syncDirectoryNow.mockResolvedValue({ status: 'running' })
	expect(await syncDirectoryAction()).toEqual({ ok: false, code: 'sync_running' })
	syncDirectoryNow.mockResolvedValue(null)
	expect(await syncDirectoryAction()).toEqual({ ok: false, code: 'not_found' })
})
```

In `__tests__/user-errors.test.ts`, add `sync_running` → `admin_users.sync_running` and `directory_unavailable` → `admin_users.directory_unavailable`.

In `__tests__/user-management-page.test.ts`, mock `@/lib/directory/admin` (`getDirectoryStatus: vi.fn(async () => null)`) and expect the page to hand `directory: null` to `UserManagement`, and the status when it answers one.

Create `__tests__/directory-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
	OUTCOME_LABEL_KEYS,
	syncErrorKey,
	TRIGGER_LABEL_KEYS,
} from '@/components/admin/users/directory-labels'
import { SYNC_ERROR_CODES, SYNC_OUTCOMES, SYNC_TRIGGERS } from '@/lib/directory-status'
import en from '@/locales/en/translation.json'

const has = (key: string) =>
	key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en) !==
	undefined

// Every outcome, trigger and error code a run can record has a text (spec §7.3: codes, never a server message).
describe('the directory labels', () => {
	it('name every outcome, trigger and error code', () => {
		for (const outcome of [...SYNC_OUTCOMES, 'interrupted' as const])
			expect(has(OUTCOME_LABEL_KEYS[outcome])).toBe(true)
		for (const trigger of SYNC_TRIGGERS) expect(has(TRIGGER_LABEL_KEYS[trigger])).toBe(true)
		for (const code of SYNC_ERROR_CODES) expect(has(syncErrorKey(code))).toBe(true)
		expect(syncErrorKey('something_new')).toBe('admin_users.sync_error_internal_error')
	})
})
```

Run: `pnpm exec vitest run __tests__/directory-admin.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts __tests__/directory-labels.test.ts` Expected: FAIL.

- [ ] **Step 2: The admin functions**

Append to `lib/directory/admin.ts` (import `Cron` from `croner`; `latestSyncRun`, `type SyncRunCounts`, `type SyncRunRecord` from `@/lib/data/directory`; `runManualSync`, `RUNNING_GUARD_MS`, `type SyncAttempt` from `./sync`; the vocabulary types from `@/lib/directory-status`):

```ts
export interface DirectoryRunDto {
	trigger: SyncTrigger
	startedAt: string
	finishedAt: string | null
	/** `interrupted`: still `running` after the guard, so its container stopped mid-run (decision ap). */
	outcome: SyncOutcome | 'interrupted'
	errorCode: string | null
	counts: SyncRunCounts
}

export interface DirectoryStatusDto {
	encryption: LdapEncryption
	schedule: string | null
	timezone: string | null
	nextRun: string | null
	lastRun: DirectoryRunDto | null
}

const toRunDto = (run: SyncRunRecord, now: number): DirectoryRunDto => ({
	trigger: run.trigger,
	startedAt: run.startedAt.toISOString(),
	finishedAt: run.finishedAt?.toISOString() ?? null,
	outcome:
		run.outcome === 'running' && now - run.startedAt.getTime() > RUNNING_GUARD_MS
			? 'interrupted'
			: run.outcome,
	errorCode: run.errorCode,
	counts: run.counts,
})

/**
 * Spec §6.6: the directory's state for the users page, or null while LDAP is off. The next run is croner's `nextRun()`
 * on a job without a function, which schedules nothing (croner `src/croner.ts:215-219`).
 */
export async function getDirectoryStatus(actor: SessionUser): Promise<DirectoryStatusDto | null> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return null
	const nextRun = config.syncSchedule
		? new Cron(config.syncSchedule, { timezone: config.syncTimezone ?? undefined }).nextRun()
		: null
	const run = await latestSyncRun()
	return {
		encryption: config.encryption,
		schedule: config.syncSchedule,
		timezone: config.syncTimezone,
		nextRun: nextRun?.toISOString() ?? null,
		lastRun: run ? toRunDto(run, Date.now()) : null,
	}
}

/** Sync now (spec §6.6, decision aq): one manual run, waited for; null while LDAP is off. */
export async function syncDirectoryNow(actor: SessionUser): Promise<SyncAttempt | null> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return null
	return runManualSync(config)
}
```

- [ ] **Step 3: The action**

`lib/action-result.ts`: add `| 'sync_running'` after `directory_unavailable`.

In `app/(admin)/user-management/actions.ts`, import `ok`, `syncDirectoryNow`, and the types, and add:

```ts
export async function syncDirectoryAction(): Promise<
	ActionResult<{
		outcome: Exclude<SyncOutcome, 'running'>
		counts: SyncRunCounts
		errorCode: SyncErrorCode | null
	}>
> {
	try {
		const actor = await requireAdmin()
		const result = await syncDirectoryNow(actor)
		if (result === null) return fail('not_found')
		// A manual slot is unique, so `skipped` cannot happen; both mean "another run has it".
		if (result.status !== 'finished') return fail('sync_running')
		refresh()
		return ok({ outcome: result.outcome, counts: result.counts, errorCode: result.errorCode })
	} catch (error) {
		return toActionFailure(error, 'syncDirectoryAction')
	}
}
```

`components/admin/users/user-errors.ts`: `case 'sync_running': return 'admin_users.sync_running' as const` and `case 'directory_unavailable': return 'admin_users.directory_unavailable' as const`.

- [ ] **Step 4: The labels and the panel**

Create `components/admin/users/directory-labels.ts`:

```ts
import type { SyncOutcome, SyncTrigger } from '@/lib/directory-status'

/** Each run outcome's label key and tag colour (spec §6.6; decision ap adds `interrupted`). */
export const OUTCOME_LABEL_KEYS = {
	running: 'admin_users.sync_outcome_running',
	succeeded: 'admin_users.sync_outcome_succeeded',
	failed: 'admin_users.sync_outcome_failed',
	empty: 'admin_users.sync_outcome_empty',
	id_attribute_changed: 'admin_users.sync_outcome_id_attribute_changed',
	interrupted: 'admin_users.sync_outcome_interrupted',
} as const satisfies Record<SyncOutcome | 'interrupted', string>

export const OUTCOME_COLORS = {
	running: 'processing',
	succeeded: 'success',
	failed: 'error',
	empty: 'warning',
	id_attribute_changed: 'warning',
	interrupted: 'default',
} as const satisfies Record<SyncOutcome | 'interrupted', string>

export const TRIGGER_LABEL_KEYS = {
	schedule: 'admin_users.sync_trigger_schedule',
	startup: 'admin_users.sync_trigger_startup',
	manual: 'admin_users.sync_trigger_manual',
} as const satisfies Record<SyncTrigger, string>

/** A run's fixed error code as its text; an unknown code reads as the internal one (spec §7.3). */
export const syncErrorKey = (code: string) => {
	switch (code) {
		case 'directory_unreachable':
			return 'admin_users.sync_error_directory_unreachable' as const
		case 'bind_refused':
			return 'admin_users.sync_error_bind_refused' as const
		case 'search_failed':
			return 'admin_users.sync_error_search_failed' as const
		default:
			return 'admin_users.sync_error_internal_error' as const
	}
}
```

Create `components/admin/users/directory-status.tsx`:

```tsx
'use client'

import { SyncOutlined } from '@ant-design/icons'
import { App, Button, Card, Descriptions, Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import { syncDirectoryAction } from '@/app/(admin)/user-management/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { DirectoryStatusDto } from '@/lib/directory/admin'

import {
	OUTCOME_COLORS,
	OUTCOME_LABEL_KEYS,
	syncErrorKey,
	TRIGGER_LABEL_KEYS,
} from './directory-labels'
import { userErrorKey } from './user-errors'

/**
 * The directory's status on the users page (spec §6.6): the connection's encryption, the next run, the last run with
 * its counts, and Sync now. Shown to accounts with admin rights while LDAP is configured (the page passes null otherwise).
 */
export default function DirectoryStatus({ status }: { status: DirectoryStatusDto }) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()
	const last = status.lastRun

	const syncNow = () =>
		run(async () => {
			const result = await syncDirectoryAction()
			if (!result.ok) {
				message.error(t(userErrorKey(result.code)))
				return
			}
			const { outcome, counts, errorCode } = result.data
			if (outcome === 'succeeded')
				message.success(
					t('admin_users.sync_succeeded', {
						deactivated: counts.deactivated,
						reactivated: counts.reactivated,
					}),
				)
			else if (outcome === 'failed')
				message.error(t('admin_users.sync_failed', { reason: t(syncErrorKey(errorCode ?? '')) }))
			else
				message.warning(
					t(
						outcome === 'empty'
							? 'admin_users.sync_stopped_empty'
							: 'admin_users.sync_stopped_id_attribute',
					),
				)
		})

	return (
		<Card
			size="small"
			title={t('admin_users.directory_title')}
			extra={
				<Button
					icon={<SyncOutlined />}
					loading={pending}
					onClick={() => void syncNow()}
				>
					{t('admin_users.sync_now')}
				</Button>
			}
		>
			<Descriptions
				size="small"
				column={{ xs: 1, md: 2 }}
				items={[
					{
						key: 'connection',
						label: t('admin_users.directory_connection'),
						children:
							status.encryption === 'none' ? (
								<Tag color="warning">{t('admin_users.directory_unencrypted')}</Tag>
							) : (
								<Tag color="success">
									{t(
										status.encryption === 'ldaps'
											? 'admin_users.directory_ldaps'
											: 'admin_users.directory_starttls',
									)}
								</Tag>
							),
					},
					{
						key: 'next',
						label: t('admin_users.directory_next_run'),
						children: status.nextRun ? (
							<ClientDateTime value={status.nextRun} />
						) : (
							t('admin_users.directory_schedule_off')
						),
					},
					{
						key: 'last',
						label: t('admin_users.directory_last_run'),
						children: last ? (
							<Space wrap>
								<ClientDateTime value={last.startedAt} />
								<Tag>{t(TRIGGER_LABEL_KEYS[last.trigger])}</Tag>
								<Tag color={OUTCOME_COLORS[last.outcome]}>
									{t(OUTCOME_LABEL_KEYS[last.outcome])}
								</Tag>
								{last.errorCode && (
									<Typography.Text type="danger">{t(syncErrorKey(last.errorCode))}</Typography.Text>
								)}
							</Space>
						) : (
							t('admin_users.directory_never_run')
						),
					},
					{
						key: 'counts',
						label: t('admin_users.directory_counts'),
						children: last ? t('admin_users.directory_counts_value', last.counts) : '—',
					},
				]}
			/>
		</Card>
	)
}
```

Check `Descriptions` `items` and `column` (responsive object) and `Card` `size`/`extra` with `npx -y @ant-design/cli info Descriptions --version 6.6.5` and `… info Card …` before relying on them (rule R0).

In `components/admin/users/user-management.tsx`, add the prop `directory: DirectoryStatusDto | null` and render `{directory && <DirectoryStatus status={directory} />}` between the page header and the search row. In `app/(admin)/user-management/page.tsx`, read it beside the users:

```tsx
const [users, directory] = await Promise.all([listUsers(user), getDirectoryStatus(user)])
return (
	<UserManagement
		users={users}
		directory={directory}
		currentUser={{ id: user.id, role: user.role }}
	/>
)
```

- [ ] **Step 5: The texts**

Add to `admin_users` in each translation file:

| Key | en | zh | ar |
| --- | --- | --- | --- |
| `directory_title` | Directory sync | 目录同步 | مزامنة الدليل |
| `sync_now` | Sync now | 立即同步 | مزامنة الآن |
| `directory_connection` | Connection | 连接 | الاتصال |
| `directory_unencrypted` | Unencrypted connection | 未加密的连接 | اتصال غير مشفّر |
| `directory_ldaps` | LDAPS | LDAPS | LDAPS |
| `directory_starttls` | StartTLS | StartTLS | StartTLS |
| `directory_next_run` | Next run | 下次运行 | التشغيل التالي |
| `directory_schedule_off` | Off | 已关闭 | متوقفة |
| `directory_last_run` | Last run | 上次运行 | آخر تشغيل |
| `directory_never_run` | Not run yet | 尚未运行 | لم تُشغَّل بعد |
| `directory_counts` | Last run's changes | 上次运行的更改 | تغييرات آخر تشغيل |
| `directory_counts_value` | {{entriesSeen}} entries · {{deactivated}} deactivated · {{reactivated}} reactivated · {{updated}} updated · {{conflicts}} email conflicts · {{membershipsAdded}} memberships added · {{membershipsRemoved}} removed · {{groupErrors}} group errors | {{entriesSeen}} 个条目 · 停用 {{deactivated}} · 重新启用 {{reactivated}} · 更新 {{updated}} · 邮箱冲突 {{conflicts}} · 新增成员资格 {{membershipsAdded}} · 移除 {{membershipsRemoved}} · 群组错误 {{groupErrors}} | {{entriesSeen}} إدخال · عُطّل {{deactivated}} · أُعيد تفعيل {{reactivated}} · حُدّث {{updated}} · تعارض في البريد {{conflicts}} · عضويات أُضيفت {{membershipsAdded}} · أُزيلت {{membershipsRemoved}} · أخطاء مجموعات {{groupErrors}} |
| `sync_succeeded` | Sync finished: {{deactivated}} deactivated, {{reactivated}} reactivated. | 同步完成：停用 {{deactivated}} 个，重新启用 {{reactivated}} 个。 | اكتملت المزامنة: عُطّل {{deactivated}} وأُعيد تفعيل {{reactivated}}. |
| `sync_failed` | Sync failed: {{reason}}. Nothing was changed. | 同步失败：{{reason}}。未做任何更改。 | فشلت المزامنة: {{reason}}. لم يُغيَّر شيء. |
| `sync_stopped_empty` | Sync stopped: the directory returned no accounts, so nothing was changed. Check LDAP_USER_BASE_DN and LDAP_USER_FILTER. | 同步已停止：目录未返回任何账户，因此未做任何更改。请检查 LDAP_USER_BASE_DN 和 LDAP_USER_FILTER。 | توقفت المزامنة: لم يُرجع الدليل أي حساب، فلم يُغيَّر شيء. تحقق من LDAP_USER_BASE_DN وLDAP_USER_FILTER. |
| `sync_stopped_id_attribute` | Sync stopped: accounts were linked by another LDAP_ID_ATTRIBUTE, so nothing was changed. | 同步已停止：账户是通过另一个 LDAP_ID_ATTRIBUTE 关联的，因此未做任何更改。 | توقفت المزامنة: رُبطت الحسابات بقيمة أخرى لـ LDAP_ID_ATTRIBUTE، فلم يُغيَّر شيء. |
| `sync_running` | A sync is already running. Try again when it has finished. | 已有同步正在运行，请在其完成后重试。 | هناك مزامنة قيد التشغيل. حاول مرة أخرى بعد انتهائها. |
| `directory_unavailable` | The directory is unreachable. Try again later. | 无法连接目录，请稍后重试。 | تعذّر الوصول إلى الدليل. حاول مرة أخرى لاحقًا. |
| `sync_outcome_running` | Running | 运行中 | قيد التشغيل |
| `sync_outcome_succeeded` | Succeeded | 成功 | نجحت |
| `sync_outcome_failed` | Failed | 失败 | فشلت |
| `sync_outcome_empty` | Stopped: no entries | 已停止：无条目 | توقفت: لا إدخالات |
| `sync_outcome_id_attribute_changed` | Stopped: ID attribute changed | 已停止：ID 属性已更改 | توقفت: تغيّرت سمة المعرّف |
| `sync_outcome_interrupted` | Did not finish | 未完成 | لم تكتمل |
| `sync_trigger_schedule` | Scheduled | 计划任务 | مجدولة |
| `sync_trigger_startup` | At start-up | 启动时 | عند بدء التشغيل |
| `sync_trigger_manual` | Manual | 手动 | يدوية |
| `sync_error_directory_unreachable` | the directory is unreachable | 无法连接目录 | تعذّر الوصول إلى الدليل |
| `sync_error_bind_refused` | the directory refused the service account | 目录拒绝了服务账户 | رفض الدليل حساب الخدمة |
| `sync_error_search_failed` | the directory refused a search | 目录拒绝了一次搜索 | رفض الدليل عملية بحث |
| `sync_error_internal_error` | an internal error (see the server log) | 内部错误（请查看服务器日志） | خطأ داخلي (راجع سجل الخادم) |

- [ ] **Step 6: The e2e spec**

Create `e2e/directory-sync.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { DIRECTORY_PASSWORD, deleteDirectoryAccount, samba } from './fixtures/directory'
import { openUsers, signInWithDirectory } from './fixtures/users'

test.use({ storageState: ADMIN_STATE })

// Spec §8 "Playwright" (B3b): Sync now deactivates and signs out a removed entry and reactivates it when it returns;
// the status panel. bob is a person of the smblds seed; the test disables him in the directory and restores him.
test.describe('Sync now (spec §6.6)', () => {
	test.afterEach(async () => {
		samba(['user', 'enable', 'bob'])
		await deleteDirectoryAccount('bob@e2e.hub.test')
	})

	test('deactivates and signs out a disabled person, then reactivates them when enabled again', async ({
		page,
		browser,
	}) => {
		const bobContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const bobPage = await bobContext.newPage()
			await signInWithDirectory(bobPage, 'bob', DIRECTORY_PASSWORD)
			await expect(bobPage).toHaveURL(/\/apps$/)

			await openUsers(page)
			const panel = page.locator('.ant-card').filter({ hasText: 'Directory sync' })
			await expect(panel.getByText('LDAPS', { exact: true })).toBeVisible()
			// .env.e2e sets LDAP_SYNC_SCHEDULE=off.
			await expect(panel.getByText('Off', { exact: true })).toBeVisible()

			samba(['user', 'disable', 'bob'])
			await panel.getByRole('button', { name: 'Sync now' }).click()
			await expect(page.getByText(/^Sync finished:/)).toBeVisible()
			await page.getByPlaceholder('Search users').fill('bob@e2e.hub.test')
			const row = page.getByRole('row', { name: /bob@e2e\.hub\.test/ })
			await expect(row.getByText('Not in directory', { exact: true })).toBeVisible()
			await expect(panel.getByText('Succeeded', { exact: true })).toBeVisible()
			// The directory's deactivation bumped sessionVersion: bob's open session ends at its next request.
			await bobPage.goto('/apps')
			await expect(bobPage).toHaveURL(/\/login/)

			samba(['user', 'enable', 'bob'])
			await panel.getByRole('button', { name: 'Sync now' }).click()
			await expect(row.getByText('Active', { exact: true })).toBeVisible()
			await signInWithDirectory(bobPage, 'bob', DIRECTORY_PASSWORD)
			await expect(bobPage).toHaveURL(/\/apps$/)
		} finally {
			await bobContext.close()
		}
	})
})
```

The `empty` safety stop is proven by `pnpm test:ldap` (Task 10's integration test runs the sync against a base with no matching entry on both servers) and by the plan's unit tests, not here: the e2e app's settings are fixed for the run (ADR-0010: no test switches in product code), so no spec can point it at an empty base. This is deviation 5 (Task 15).

Run (with `pnpm dev` stopped): `pnpm exec playwright test e2e/directory-sync.spec.ts e2e/admin-users.spec.ts e2e/directory-accounts.spec.ts` Expected: every test passes on the three projects.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec next typegen && pnpm exec tsc --noEmit
pnpm exec oxlint <every changed .ts/.tsx file>
pnpm exec oxfmt --write <every changed file> && pnpm exec oxfmt --check <every changed file>
npx -y @ant-design/cli lint ./
pnpm test
git add lib/directory/admin.ts lib/action-result.ts "app/(admin)/user-management/actions.ts" "app/(admin)/user-management/page.tsx" components/admin/users/directory-status.tsx components/admin/users/directory-labels.ts components/admin/users/user-management.tsx components/admin/users/user-errors.ts locales/en/translation.json locales/zh/translation.json locales/ar/translation.json e2e/directory-sync.spec.ts __tests__/directory-admin.test.ts __tests__/user-management-actions.test.ts __tests__/user-errors.test.ts __tests__/user-management-page.test.ts __tests__/directory-labels.test.ts
git commit -m "feat(users): show the directory sync's status and add Sync now

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 15: Records — ADR-0029, the notes, `docs/ldap.md`, `docs/auth-gate.md`, `CLAUDE.md`, CII

Spec §10 (the B3b record and its notes; `docs/auth-gate.md`, `docs/ldap.md`, `CLAUDE.md`), §7.1 (`docs/ldap.md`'s worked examples and the `none` trade-off), §12–§14. ADR-0015 (decisions in ADRs, `CLAUDE.md` under 200 lines). The spec calls this record ADR-0028; the sidebar took that number (ADR-0027's B3b notes), so it is ADR-0029.

**Files:**

- Create: `docs/decisions/0029-sign-directory-accounts-in-over-ldap-and-keep-them-in-step-with-a-scheduled-sync.md`, `docs/ldap.md`
- Modify: `docs/decisions/README.md`, `docs/decisions/{0006,0010,0018,0024,0026,0027}-*.md` (dated notes), `docs/auth-gate.md`, `CLAUDE.md`, `.cii-assessment.md`

- [ ] **Step 1: ADR-0029**

Create it with the project's adr-skill (`.claude/skills/adr-skill`; its README's workflow: run the scripts from a temporary copy with `scripts/*.js` renamed to `.cjs`) as `proposed`, titled "Sign directory accounts in over LDAP and keep them in step with a scheduled sync", with `--update-index`. Fill it in MADR 4.0 form, each claim with the source this plan gives it:

- **Context and Problem Statement:** the charter's B3 row; B3a built the audience (groups with `directory` memberships) and the off switch (the directory marker), and wrote neither; the owner's decisions of 2026-10-09 (spec §2 #4–#7, #10–#14, #16–#18); ADR-0027's B3b notes. The question: how do directory accounts sign in, how are they linked and kept in step, and how is that tested without the owner's directory?
- **Decision Drivers:** no account takeover and linking by the entry's key only (ADR-0026; next-auth's FAQ on automatic linking); an unreachable or misconfigured directory changes nothing (GitLab's "All users are blocked if the LDAP server is unavailable" warning); one generic answer for every account-related refusal (OWASP "Authentication Responses"); passwords never in clear without the owner's explicit choice (RFC 4513 §5.1.3); documented approaches only, with reference projects where the docs are silent (ADR-0002); features both MySQL and PostgreSQL have (ADR-0004 note).
- **Considered Options** (with the research's citations: `docs/superpowers/research/2026-10-09-backend-b3/ldap-client.md`, `periodic-jobs.md`, `ldap-reference-projects.md`, `e2e-ldap-server.md`, and `b3b-plan/`):
  - the client: `ldapts` 9.2.0 (chosen; n8n and Backstage use it) / `ldapjs` (decommissioned 2024-05-14, archived) / `@infisical/ldapjs` (a vendor's republish) / `ldap-native` (a native build, one author) / `passport-ldapauth` (built on ldapjs, a Passport strategy) / `ldap-authentication` (a wrapper of ldapts, not needed);
  - the schedule: croner from `instrumentation.ts` `register()` with a slot claim (chosen; Formbricks, Homarr, Rallly, ZTNet) / an external cron calling a secret route (Cal.com) / a worker container from the same image (Twenty, Langfuse) / a job queue (needs Redis); croner 10.0.1 (chosen; Homarr) / `node-cron` / `cron`;
  - the link: the entry's `objectGUID`/`entryUUID` (chosen; Keycloak, Mattermost, Nextcloud, Rocket.Chat) / the DN (GitLab, Grafana, with an email fallback) / the email (Open WebUI) / the login name (LibreChat);
  - the sign-in: a second Credentials provider `ldap` (chosen; next-auth "Multiple providers") / one form that tries both (Grafana, Rocket.Chat);
  - an unknown username's timing: a response-time floor (chosen; Authelia) / a dummy bind (no surveyed project; AD's PDC forwarding would still differ) / nothing (Spring Security, django-auth-ldap, n8n);
  - the test directories: smblds over LDAPS and OpenLDAP 2.6 over StartTLS and plain (chosen; os2mo and authentik run a Samba DC beside OpenLDAP) / OpenLDAP only (Mattermost, GitLab QA, ldapts) / smblds only;
  - the test certificates: committed with a regeneration script (chosen; python-ldap, Node.js core, Go) / generated at test time (ldapts with node-forge, authentik) / generated in a container at start.
- **Decision Outcome:** the data model of spec §3.2 as built (Task 1), the `LDAP_*` block (Task 2), the directory DAL (Tasks 3 and 9), the modules of `lib/directory/` (Tasks 5, 6, 7, 10, 11, 12, 14), the `ldap` provider and the session's `source` (Task 7), the login tabs and the account menu (Task 8), the groups page's links (Task 12), the users page's directory accounts and status panel (Tasks 13, 14), the test directories and `pnpm test:ldap` (Task 4); this plan's deviations 1–8 and decisions a–aq, each with its source, copied from the tasks.
- **Consequences:** Good: a directory account can never take over a local one, and its Dify history (`users.id`) survives renames and moves; an unreachable directory, an empty answer or a changed id attribute changes nothing; the directory owns only its own marker and memberships, so it never undoes an admin's decision; one CI-free suite proves the AD and the generic paths in all three modes. Bad: `LDAP_ENCRYPTION=none` sends every directory password and the service account's in clear (spec §13), and a domain controller that starts requiring LDAP signing (a new Windows Server 2025 domain, or an unconfigured DC upgraded to 2025; Microsoft Learn, "LDAP signing for Active Directory Domain Services") ends it: every sign-in then answers "the directory is unreachable" and the log names result code 8; failed binds through the hub count toward the directory's lockout until throttling exists (spec §12); a wrong but non-empty filter deactivates the people it misses until the next correct sync (spec §13); the in-process schedule is reference-project practice where Next's docs are silent; the test servers cover Samba's AD, not Microsoft's (paging above 1,000, referrals, signing policy), so the owner's live check is the real test. Neutral: the e2e suite runs with the LDAP block on, so every spec sees the login tabs; the run table keeps 90 days.
- **Implementation Plan:** affected paths (this plan's file structure); patterns to follow (every directory value in a filter goes through `lib/directory/filters.ts`; every directory connection through `withDirectory`, one per sign-in or sync; a new directory write touches only the directory's marker, the directory fields of `ldap` accounts or `directory` memberships; every failed directory sign-in goes through the response floor; the sync reads everything before it writes); patterns to avoid (binding with an unchecked password; a `sizeLimit` on a sync search; TLS options on the constructor for `ldap://`; linking by email, DN or login; an admin action writing the directory marker; a `register()` that can throw); configuration (the `LDAP_*` block, `docs/ldap.md`); migration steps (`pnpm db:migrate`; every existing account becomes `local`; the `CHECK` must hold, so a database whose `users.password` holds a NULL cannot be migrated until that row is fixed).
- **Verification:** the vitest files and e2e specs of Tasks 1–14 by name; `pnpm test:ldap`; the migration on a copy of the local database (Task 16); the Docker gate (Task 16, unchecked until done); the owner's live check against their Active Directory (unchecked until done).
- **More Information:** the spec and research paths; follow-ups: sign-in throttling for both tabs with AD's lockout in mind; "switch to directory sign-in" for a local account; recovery from a changed `LDAP_ID_ATTRIBUTE`; the inherited forgot and reset password for directory accounts (the `CHECK` refuses the write; the handler answers its failure).

Copy the deviations and decisions into the ADR in this plan's words, with their sources; do not shorten a source to "see the plan".

- [ ] **Step 2: The notes on earlier ADRs**

Append a dated note under "More Information" in each (the README's rule: an accepted ADR changes only by a status change or a dated note):

- `0026-…md`: "Note, 2026-10-10 (ADR-0029): the LDAP linking rule is built. A directory account is linked by `users.directory_id`, the entry's `objectGUID` as a lowercase GUID string in Microsoft's byte order or its `entryUUID` lowercased, with `directory_id_attribute` beside it; never by email, DN, UPN or login name. A first sign-in whose email any account uses is refused, so no directory sign-in takes over an account (`lib/data/directory.ts` `recordDirectorySignIn`)."
- `0024-…md`: "Note, 2026-10-10 (ADR-0029): `lib/data/directory.ts` is the second actor-less DAL module, after `lib/data/setup.ts`; its guard is its input (values from a successful bind or a complete directory search). `updateUserRole` is the role-only edit of a directory account under the rank map, and `updateUser` refuses an `ldap` target; `lockTarget` also reads `source`."
- `0027-…md`: "Note, 2026-10-10 (ADR-0029): the B3b notes are built. The `ldap` provider refuses an account an admin deactivated after the bind, inside the sign-in transaction; every refused directory sign-in waits for a response-time floor, so an unknown username answers in the same time as a wrong password; the sync and the sign-in write only `directory_deactivated_at` and `directory` memberships. The users page offers Deactivate while the admin marker is empty, also for an account the directory has deactivated."
- `0018-…md`: "Note, 2026-10-10 (ADR-0029): the directory sync's deactivation bumps `sessionVersion` like the admin's, so a person removed from the directory is signed out at the next request after the sync; the token and the session carry the account's `source`, refreshed from the row with the role."
- `0010-…md`: "Note, 2026-10-10 (ADR-0029): `docker-compose.e2e.yml` gains two LDAP test directories under the profile `ldap`, started by name: `ldap-ad` (smblds, LDAPS) by the Playwright global setup, both by `pnpm test:ldap` (a Vitest project of its own). `.env.e2e` holds the `LDAP_*` block with the schedule off, so the login page shows its tabs in every spec; the local sign-in helpers choose 'Local account'. A test CA and server certificate are committed under `e2e/fixtures/ldap/tls/` with their regeneration script."
- `0006-…md`: "Note, 2026-10-10 (ADR-0029): directory accounts sign in on the login page's 'Directory account' tab through next-auth's `/api/auth/callback/ldap`, under the public `/api/auth` prefix; deny by default is unchanged."

Add the row for 0029 to `docs/decisions/README.md` if `--update-index` did not.

- [ ] **Step 3: `docs/ldap.md`**

Create it:

````markdown
# Directory (LDAP) sign-in and sync

ADR-0029. People in the company directory sign in on the login page's "Directory account" tab with their directory username and password. Their hub account is created at the first sign-in and linked to their entry by its key (`objectGUID` on Active Directory, `entryUUID` elsewhere), never by email. A scheduled sync, and Sync now on the users page, deactivate the accounts whose entry is gone or disabled, reactivate those that come back, refresh names and emails, and keep the members of hub groups linked to directory groups. Roles stay in the hub: a new directory account is a `user`, and the owner or an admin promotes it.

## Settings

Setting `LDAP_URL` turns the directory on; the keys marked required must then be set, or the first request fails with their names. The defaults are Active Directory's. Copy the block from `.env.template`.

| Variable | Required / default | Notes |
| --- | --- | --- |
| `LDAP_URL` | required | `ldaps://host:636` or `ldap://host:389` |
| `LDAP_ENCRYPTION` | required | `ldaps` (with `ldaps://`), `starttls` or `none` (with `ldap://`) |
| `LDAP_CA_FILE` | optional | a PEM file with the CA that signed the directory's certificate, mounted into the container; Node's trust store otherwise. No setting skips certificate verification |
| `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` | required | a read-only service account |
| `LDAP_USER_BASE_DN` | required | where people are searched |
| `LDAP_USER_FILTER` | `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` | enabled AD users; a person the filter does not match cannot sign in and is deactivated by the sync |
| `LDAP_LOGIN_ATTRIBUTE` | `sAMAccountName` | what people type as their username |
| `LDAP_ID_ATTRIBUTE` | `objectGUID` | the link; do not change it once accounts exist (the sync then stops with "ID attribute changed") |
| `LDAP_EMAIL_ATTRIBUTE`, `LDAP_NAME_ATTRIBUTE` | `mail`, `displayName` | an entry without an email cannot get an account |
| `LDAP_GROUP_BASE_DN` | `LDAP_USER_BASE_DN` | where the groups page searches directory groups |
| `LDAP_GROUP_FILTER`, `LDAP_GROUP_NAME_ATTRIBUTE` | `(objectClass=group)`, `cn` |  |
| `LDAP_GROUP_MEMBER_FILTER` | `(memberOf:1.2.840.113556.1.4.1941:={group_dn})` | `{group_dn}` is replaced by a linked group's DN; the default includes nested groups |
| `LDAP_SYNC_SCHEDULE` | `0 * * * *` | a five-field cron expression, or `off` |
| `LDAP_SYNC_TIMEZONE` | the server's zone (UTC in the image) | an IANA name such as `Asia/Riyadh` |

Every filter must be wrapped in parentheses and parse as an LDAP filter; attribute settings must be attribute names. The hub writes the values people type (and the directory's own values) into its filters escaped.

## Active Directory

```dotenv
LDAP_URL=ldaps://dc01.corp.example:636
LDAP_ENCRYPTION=ldaps
LDAP_CA_FILE=/run/secrets/corp-root-ca.pem
LDAP_BIND_DN=CN=svc-hub,OU=Service Accounts,DC=corp,DC=example
LDAP_BIND_PASSWORD=…
LDAP_USER_BASE_DN=OU=Staff,DC=corp,DC=example
```

- **The service account** needs read access to the people and groups under the two base DNs, including `objectGUID`, `userAccountControl`, `mail`, `displayName` and `memberOf`. A plain domain user has it in a default domain, through "Pre-Windows 2000 Compatible Access" (Microsoft Learn, "Active Directory security groups"); a hardened domain may have removed that, and the service account then needs an explicit read grant. It needs no write right.
- **Nested groups** are resolved by the default member filter (`LDAP_MATCHING_RULE_IN_CHAIN`); Microsoft notes that such queries "may be more processor intensive" on large group trees.
- **Disabled accounts** are left out by the default user filter, so a person disabled in AD cannot sign in and is deactivated at the next sync.

## OpenLDAP and other LDAPv3 servers

```dotenv
LDAP_URL=ldap://ldap.corp.example:389
LDAP_ENCRYPTION=starttls
LDAP_BIND_DN=cn=svc-hub,dc=corp,dc=example
LDAP_USER_BASE_DN=ou=people,dc=corp,dc=example
LDAP_USER_FILTER=(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))
LDAP_LOGIN_ATTRIBUTE=uid
LDAP_ID_ATTRIBUTE=entryUUID
LDAP_GROUP_BASE_DN=ou=groups,dc=corp,dc=example
LDAP_GROUP_FILTER=(objectClass=groupOfNames)
LDAP_GROUP_MEMBER_FILTER=(memberOf={group_dn})
```

`memberOf` exists only with the memberof overlay; nested groups need the nestgroup overlay with `memberof-filter` (OpenLDAP 2.6.8 and later). Without them, write a member filter for your server. An Active Directory filter on another server matches nothing without an error: the sync then stops with "no entries" and changes nothing.

## Encryption, and moving off `none`

`LDAP_ENCRYPTION=none` sends every person's directory password, and the service account's, in clear between the hub and the directory (RFC 4513 §5.1.3: a simple bind with a password "is not suitable for authentication in environments without confidentiality protection"). The hub logs a warning at start and the users page shows "Unencrypted connection". It also stops working when the domain controller requires LDAP signing: a new Windows Server 2025 domain does by default, and so does a domain controller upgraded to 2025 that had no signing policy (Microsoft Learn, "LDAP signing for Active Directory Domain Services"). Sign-ins then say "The directory is unreachable" and the log names result code 8 (`StrongAuthRequiredError`).

To move to `ldaps`:

1. The domain controller needs a certificate for Server Authentication whose subject or DNS name is the DC's fully qualified name; installing it is enough ("There's no user interface for configuring LDAPS", Microsoft Learn).
2. Set `LDAP_URL=ldaps://<the DC's FQDN>:636` and `LDAP_ENCRYPTION=ldaps`. A URL by IP address works only if the certificate also names that IP.
3. Mount the enterprise root CA into the hub container and point `LDAP_CA_FILE` at it.
4. If the container cannot resolve the DC's name, map it with Compose's `extra_hosts` (`- "dc01.corp.example=10.0.0.5"`).

Channel binding does not apply to simple binds over TLS (Microsoft Learn, "LDAP channel binding for AD DS").

## The sync

- **When:** at `LDAP_SYNC_SCHEDULE` in `LDAP_SYNC_TIMEZONE`, once at start when a due run was missed, and on Sync now. Several hub containers run each scheduled time once. No run starts while another has been going for less than 30 minutes; a run that died with its container shows "Did not finish". In a zone with daylight saving, a time that falls in the skipped hour runs at the end of it; the default hourly schedule is not affected.
- **What:** the people the user filter matches are compared with the hub's directory accounts by key. Absent → deactivated and signed out at their next request; back → reactivated; present → name, email and username refreshed (an email another account has is kept and counted as a conflict). People without a hub account are ignored: accounts are created at first sign-in. Each hub group linked to directory groups gets the hub accounts found in any of them as its directory members; members added by hand stay.
- **Safety stops** (nothing changes, the run says why): the directory did not answer, refused the service account or a search ("failed"); it returned no entries ("no entries": check the base DN and the filter); an account was linked with another `LDAP_ID_ATTRIBUTE` ("ID attribute changed": put the old value back).
- **History:** the users page shows the last run, its counts, the next run and Sync now; runs are kept 90 days.
- **Admin and directory deactivation** are separate: the directory never lifts an admin's deactivation, and an admin's Reactivate does not undo the directory's.

## Logs

Each refused sign-in logs one line, `authorizeDirectory: sign-in refused` with the username and a reason: `unknown_user`, `ambiguous_user`, `wrong_password`, `invalid_entry` (no valid key), `entry_without_email`, `email_in_use`, `account_inactive` (deactivated by an admin), `directory_off`. A failure of the directory logs its error class and LDAP result code, never a password. Each sync logs one `directorySync: run finished` line with the outcome, the error code and the counts.

## Checking a new directory

1. From the hub's container, the directory's port answers (TCP only):

   ```bash
   docker compose exec -T app node -e "const s=require('node:net').connect({host:process.argv[1],port:Number(process.argv[2]),timeout:5000});s.on('connect',()=>{console.log('open');s.destroy()}).on('timeout',()=>{console.log('timeout');s.destroy()}).on('error',e=>console.log('error',e.code))" <DC address> 389
   ```

2. Start with `LDAP_SYNC_SCHEDULE=off`, sign in as yourself on the Directory tab, and check your account on the users page (Directory, your username, the user role).
3. Run Sync now: the counts should be plausible (no mass deactivation).
4. Link a hub group to a directory group, grant it an app, and sign in as a member of a nested group.
5. Then set the schedule.

## Known limits

- Sign-in attempts are not throttled yet, and every failed directory sign-in counts toward the directory's lockout policy.
- A local account cannot be switched to directory sign-in yet; the person keeps both or an admin resolves it.
- Changing `LDAP_ID_ATTRIBUTE` after accounts exist is not supported.
- Forgot and reset password are for local accounts; a directory account's password is the directory's.
````

- [ ] **Step 4: `docs/auth-gate.md`**

- In the opening paragraph, after the deactivation sentence: "Directory accounts (ADR-0029) sign in on the login page's Directory tab through a second Credentials provider, `ldap`; every account-related refusal answers the same generic message, and only a directory that does not answer is named."
- In "Where it lives", the `lib/auth/options.ts` bullet gains: "Two providers: `credentials` (`authorizeCredentials`, which also refuses an account the directory owns, after the same bcrypt work) and `ldap` (`authorizeDirectory` in `lib/auth/directory-provider.ts`: search, the linked groups, then the person's bind; the DAL's sign-in transaction; a response-time floor on every refusal). The token and the session carry the account's `source`, refreshed from the row."
- A new bullet after the Data Access Layer bullet: "The directory (ADR-0029): `lib/directory/` (server-only: keys, filters, entries, the connection, the sign-in check, the sync and its schedule, the admin functions) and `lib/data/directory.ts` (the second actor-less DAL module; it writes only the directory marker, the directory fields of `ldap` accounts and `directory` memberships). The schedule starts in `instrumentation.ts` `register()`, which never throws. Settings and operations: `docs/ldap.md`."
- "Known limits": the B3b sentence becomes "Directory sign-in and its sync are in (ADR-0029); sign-in throttling is not, so failed directory binds count toward the directory's lockout." Add: "The inherited reset handler could only reach a directory account through a link issued with SMTP on; the `users_source_credentials` CHECK refuses the password write (error 3819) and the handler answers its existing failure."

- [ ] **Step 5: `CLAUDE.md`**

- Decisions list: after ADR-0028, "- ADR-0029 Directory (LDAP) sign-in and sync: ldapts 9.2.0 and croner 10.0.1; a second Credentials provider `ldap` and the login tabs; accounts linked by `objectGUID`/`entryUUID` in `users.directory_id`, created at first sign-in as `user`, never by email; the sync from `instrumentation.ts` with a slot claim and safety stops, writing only the directory marker and `directory` memberships; group links on the groups page; status and Sync now on the users page; `LDAP_ENCRYPTION` including `none`; the `pnpm test:ldap` suite against smblds and OpenLDAP; proposed in B3b's PR."
- "Where things are", the backend bullet gains `lib/directory/`, `lib/data/directory.ts`, `lib/auth/{account-source,directory-provider}.ts`, `lib/directory-status.ts`, `instrumentation.ts`, `docs/ldap.md`, `e2e/fixtures/{directory.ts,ldap/}`, `__tests__/ldap/`.
- "Local testing": a short paragraph: "`pnpm test:ldap` runs the directory suite (a Vitest project of its own) against two test directories in `docker-compose.e2e.yml` (profile `ldap`: `ldap-ad` smblds on 127.0.0.1:10636/10389, `ldap-openldap` on 13890/16360); it starts and stops them. `pnpm test:e2e` starts `ldap-ad` with MySQL. The test CA is committed in `e2e/fixtures/ldap/tls/` (`generate.sh` remakes it)."
- "Next step": the owner's live check of B3b against their Active Directory (`docs/ldap.md` "Checking a new directory"), then frontend phase 2.
- "Open follow-ups": move B3b out of "the backend rework" item; keep sign-in throttling, "switch to directory sign-in", recovery from a changed `LDAP_ID_ATTRIBUTE`, the inherited reset handler for directory accounts.
- Keep the file under 200 lines (`wc -l CLAUDE.md`); shorten wording, not facts.

- [ ] **Step 6: Check and commit the records**

```bash
pnpm exec oxfmt --write docs/decisions/0029-*.md docs/decisions/README.md docs/decisions/0006-*.md docs/decisions/0010-*.md docs/decisions/0018-*.md docs/decisions/0024-*.md docs/decisions/0026-*.md docs/decisions/0027-*.md docs/ldap.md docs/auth-gate.md CLAUDE.md
wc -l CLAUDE.md
git add docs/decisions/0029-*.md docs/decisions/README.md docs/decisions/0006-*.md docs/decisions/0010-*.md docs/decisions/0018-*.md docs/decisions/0024-*.md docs/decisions/0026-*.md docs/decisions/0027-*.md docs/ldap.md docs/auth-gate.md CLAUDE.md
git commit -m "docs: record ADR-0029, the B3b notes, docs/ldap.md and the CLAUDE.md pointers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

- [ ] **Step 7: The CII assessment (its own commit)**

Re-check `.cii-assessment.md` per AGENTS.md: #19 (the vitest count and file count from `pnpm test`'s summary, plus the `pnpm test:ldap` suite), #20 (the Playwright spec count, `ls e2e/*.spec.ts | wc -l`), #25 and #26 (directory input validated with zod and escaped in every filter; TLS verified always; the generic sign-in answer and the response floor), and the change log line. If anything changed:

```bash
git add .cii-assessment.md
git commit -m "docs: update CII assessment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QyGbDaaWiu7VcFVMdNUtUn"
```

---

### Task 16: Whole-branch review, the gates and the PR text (controller)

Spec §8 ("Gates", "Migrations"), §9 (B3b "done when"), §13 (risks), §14 (what stays for the live check).

- [ ] **Step 1: Whole-branch review (Fable)**

Dispatch one reviewer (superpowers:requesting-code-review, `model: fable`) on `fork/overhaul..HEAD` with the spec's B3b sections, this plan, the Review Focus, the ledger's deferred Minors and rulings, and the reviewer contract. The review checks:

- every Review Focus line against its tests;
- that no code path binds with an empty password or a filter built from an unescaped value (`git grep -n "\.bind(\|\.search(" -- lib` and each call's inputs);
- that a StartTLS client never reconnects (the single-use connection factory) and no TLS option reaches the constructor for `ldap://`;
- that the sync's user search sets no `sizeLimit` (`library-apis.md` §1: ldapts then accepts a size-limit result as complete);
- that `lib/data/directory.ts` writes only `directory_deactivated_at`, the directory fields of `ldap` accounts and `directory` memberships (`git grep -n "adminDeactivated\|'manual'" -- lib/data/directory.ts` finds nothing);
- that every directory sign-in refusal answers the generic `CredentialsSignin` and only a transport failure answers `DirectoryUnavailable`;
- that no log line can carry a password, the bind password, a hash, an email or a filter with user input (`git grep -n "console\.\(log\|warn\|error\)" -- lib app instrumentation.ts`);
- `git grep -n "process.env" -- lib app components hooks instrumentation.ts` (only `lib/env.ts`, and `NEXT_RUNTIME` in `instrumentation.ts`);
- no Chinese character in the touched files outside `locales/zh` (`git diff --name-only fork/overhaul..HEAD | grep -v '^locales/zh/' | xargs grep -nP '\p{Han}'`);
- oxlint over every changed file; `npx -y @ant-design/cli lint ./` at zero findings;
- the migration SQL by hand (one `ON DELETE CASCADE`, the `CHECK` last on `users`).

- [ ] **Step 2: One fix wave, one scoped re-review**

One Opus implementer applies every finding the controller accepts (rule R0), with sources; one Sonnet re-review checks exactly those fixes; a fix loop that reaches round 4 goes to Fable.

- [ ] **Step 3: The directory integration suite and the full e2e suite, from empty**

```bash
pnpm test:ldap
docker compose -f docker-compose.e2e.yml --profile ldap down -v
pnpm test:e2e
```

Expected: `pnpm test:ldap` passes on both servers in the three modes (smblds over LDAPS; OpenLDAP over StartTLS and plain); every Playwright spec passes on the three projects; the setup annotation says `owner created through /init`. Report the counts. Stop `pnpm dev` first if it runs. Never at the same time as the Docker build (this machine has ~5 GB).

- [ ] **Step 4: The migration on a copy of the local database**

The dump holds password hashes and API keys: it stays in `tmp/`, is never printed, and is deleted at the end of this step. The container's own environment supplies the credentials.

```bash
docker compose -f docker-compose.local.yml exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > tmp/b3b-local.sql
docker compose -f docker-compose.e2e.yml up -d --wait mysql
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e -e "DROP DATABASE IF EXISTS b3bcopy; CREATE DATABASE b3bcopy; GRANT ALL ON b3bcopy.* TO 'e2e'@'%';"
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b3bcopy < tmp/b3b-local.sql
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b3bcopy -e "SELECT COUNT(*) AS accounts_before FROM users; SELECT COUNT(*) AS without_password FROM users WHERE password IS NULL;"
env DATABASE_URL=mysql://e2e:e2e@127.0.0.1:3307/b3bcopy pnpm exec drizzle-kit migrate
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e b3bcopy -e "SELECT source, COUNT(*) FROM users GROUP BY source; SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'b3bcopy'; SELECT COUNT(*) AS fks FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'b3bcopy' AND DELETE_RULE = 'CASCADE'; SELECT COUNT(*) AS migrations FROM __drizzle_migrations;"
docker compose -f docker-compose.e2e.yml exec -T mysql mysql -uroot -pe2e -e "DROP DATABASE b3bcopy;"
rm tmp/b3b-local.sql
docker compose -f docker-compose.e2e.yml --profile ldap down
```

Expected: `without_password` is 0 before; after, every account is `local` and their count equals `accounts_before`; `users_source_credentials` is listed; `fks` is 7 (B3a's six and the link table's one); 11 migrations applied. Record the result as a dated note on ADR-0029 (Task 15's file), committed with Step 6's records if any.

- [ ] **Step 5: The Docker gate**

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml build app
docker compose -f docker-compose.local.yml up -d app
```

Build in the foreground; never restart a build killed for memory. The owner's `.env` has no `LDAP_*` block yet, so the image runs with the directory off. Then the curl checks of `CLAUDE.md` ("Docker stack"), plus:

```bash
curl -s localhost:5300/login | grep -c 'role="tab"'                                     # 0: no tabs without the LDAP block
curl -s -o /dev/null -w '%{http_code}\n' localhost:5300/api/auth/providers                # 200
curl -s localhost:5300/api/auth/providers | grep -o '"ldap"' | head -1                     # "ldap": the provider is registered
docker compose -f docker-compose.local.yml logs app | grep -ci 'directory'                 # 0: no schedule, no warning
docker compose -f docker-compose.local.yml exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "SELECT source, COUNT(*) FROM users GROUP BY source"'
docker stats --no-stream
```

Expected: as commented; every account on the real volume is `local` (the entrypoint applied the migration). The image builds with ldapts and croner bundled (Next's default; `serverExternalPackages` stays unset unless the build fails on them, `library-apis.md` §1).

- [ ] **Step 6: The PR text, then stop**

- Write the PR text to `tmp/b3b-pr.md`, following `.github/PULL_REQUEST_TEMPLATE.md`: Overview (B3b of the B3 spec; ADR-0029); a Changes table by task; Testing (the vitest count, `pnpm test:ldap` per server and mode, the e2e counts, the migration copy, the Docker gate); Related Issue (none; implements ADR-0029 and the spec's B3b row); the PR attribution lines.
- Ask the owner whether the run's `ledger.md` and `rulings.md` go under `docs/superpowers/research/2026-10-09-backend-b3/b3b-execution/`.
- Present the merge options (superpowers:finishing-a-development-branch).
- **Stop.** No push and no PR without the owner's word.

- [ ] **Step 7: The owner's live check against their Active Directory (spec §9, after the owner's word)**

The B3b row's "done when" ends with this check, run by the owner on the local stack with the directory reached over `none` (spec §2 #18). Give the owner this list (from `docs/ldap.md`):

1. Reachability from Docker on WSL: `docker run --rm busybox nc -zv -w 5 <DC IP> 389` succeeds (spec §14; `ad-and-reference-projects.md` A.2 for WSL's networking modes).
2. The `LDAP_*` block in the local `.env` (`LDAP_URL=ldap://<DC IP>:389`, `LDAP_ENCRYPTION=none`, the service account, the base DN; `LDAP_SYNC_SCHEDULE=off` for the first try), then `docker compose -f docker-compose.local.yml up -d app` (no rebuild: the settings are read at the first request).
3. The start-up log shows the unencrypted-connection warning; `/login` shows the two tabs.
4. A directory sign-in with a Windows username: the account appears on the users page with the Directory tag, the `objectGUID` key, the user role.
5. Sync now on the users page: outcome succeeded, the counts plausible (no mass deactivation; spec §13's wrong-filter risk).
6. Link a hub group to a nested AD group, grant it an app, sign in as a member of a nested child group: the app appears.
7. If the DC refuses the plain simple bind (LDAP signing required: `strongerAuthRequired`, `ad-and-reference-projects.md` A.1), the sign-in shows the generic error and the log names the result code; the move is `ldaps` (`docs/ldap.md`).

Record the outcome as a dated note on ADR-0029 and tick its Verification item.
