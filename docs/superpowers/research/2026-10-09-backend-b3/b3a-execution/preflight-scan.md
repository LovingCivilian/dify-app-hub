# Pre-flight review — B3a plan (account status, groups, per-app access)

Plan: `docs/superpowers/plans/2026-10-09-backend-b3a-groups-access.md` (3,967 lines) at HEAD `a2a72c03`, branch `feat/backend-b3a-groups-access`. Spec (binding): `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`. Rules: `rules.md` R0–R7. Reviewer: Opus, 2026-10-09. Nothing in the repo was edited, staged or committed; `.env`/`.env*.local` were not read.

## How the plan was checked

The plan's code was applied, task by task and verbatim, to a throwaway copy of the repo (sources rsync'd without `.git`, `.env`, `.env*.local`, `.superpowers`, `docs`; `node_modules` symlinked), then type-checked, generated, tested and linted. The copy lives in the session scratchpad `/tmp/claude-1000/…/scratchpad/copy`, outside the repo: rule R3 forbids `.ts` files under the repo's `tmp/` (the root `tsconfig.json` includes `**/*.ts`), and the copy is all `.ts`. No Docker container, `next dev` or e2e run was started (read-only role). The e2e findings come from reading the specs against the UI code, a minimal headless-Chromium locator probe, and a pixel measurement of the existing `e2e/screenshots/admin-desktop-light.png`.

| Check | Command / source | Result |
| --- | --- | --- | --- |
| Baseline | `next typegen && tsc --noEmit` on the unmodified copy | exit 0 |
| Task 1 types | `tsc --noEmit` after Task 1's schema edits | **exit 2**: `lib/data/apps.ts(305,2)`, `(333,18)`, `__tests__/data-apps.test.ts(81,24)`, `(96,19)`, `(99,28)`, "Property 'accessMode' is missing … required in type 'DtoRow'" (finding C1) |
| Migration | `drizzle-kit generate --name b3a-groups-access` (rc.3, dummy URL) | 4 `CREATE TABLE`, the `access_mode` line byte-identical to the test's string, 3 `ALTER TABLE users ADD`, 6 `ADD CONSTRAINT … FOREIGN KEY … REFERENCES …(\`id\`) ON DELETE CASCADE`; no change to existing columns |
| Data migration | `drizzle-kit generate --custom --name b3a-apps-open-to-everyone` | folder `…_b3a-apps-open-to-everyone/{migration.sql,snapshot.json}`, `prevIds` = the generated migration's `id`; a further `generate` without `DATABASE_URL` reports "No schema changes" (no journal file in rc.3's folder format; no drift) |
| Task 1 tests | `vitest run b3a-schema users-schema` | 13/13 pass |
| Task 2 | vitest + tsc | 20/20 pass, tsc 0 |
| Task 3 | vitest `data-apps-access` as written | **4 fail** (finding C2); 10/10 after the corrected regexes; `data-apps-sync` fails until its fake gains `orderBy` (as the plan says), then 50/50 across the five files |
| Task 4 | vitest (8 files incl. `data-setup`, `user-management-rank`) + tsc | 80/80 pass, tsc 0 |
| Task 5 | vitest + tsc (with the plan's locale tables applied) | 9/9 pass, tsc 0 |
| Task 6 | vitest + tsc | 65/65 pass; tsc 2 test-fixture errors (finding M2); e2e import: TS2440 (finding C3) |
| Task 7 | vitest + tsc | 92/92 pass, tsc 0 |
| Whole unit suite | `vitest run` after Tasks 1–7 | 106 files, 1,297 tests pass (incl. i18n parity) |
| i18n | script over every `t('…')` key in the new UI files; key-set diff en/zh/ar | no missing key; zh and ar parity diff empty |
| oxlint | `oxlint lib db app components e2e __tests__ hooks` | 1 error: `e2e/admin-groups.spec.ts:28:6 no-unused-vars` (finding C8); the repo today: 0 |
| antd lint | `npx -y @ant-design/cli lint ./components`, `./app` | 3 findings, `[deprecated] Select optionFilterProp` (finding C9); `app`: 0 |
| Han characters | `grep -cP '\p{Han}'` over every file the plan touches outside `locales/zh` | none |
| next-auth v4 | Context7 `/websites/next-auth_js` | `authorize` returning `null` → "an error will be displayed advising the user to check their details"; the JWT callback runs when the token "is created (at sign-in) or updated (when a session is accessed)". Matches Tasks 2 and 7 |
| Next 16 | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` (next 16.3.4) | "`refresh` can **only** be called from within Server Actions": every plan use is inside a `'use server'` action |
| Drizzle | Context7 `/drizzle-team/drizzle-orm-docs` + installed `mysql-core/*.d.ts` | standalone `new QueryBuilder()` from `drizzle-orm/mysql-core` documented ("Dynamic query building", "Views", "Goodies: `.toSQL()` … works with … the standalone QueryBuilder"); `primaryKey({ columns })`, `.references(ref, { onDelete })`, `mysqlEnum(name, values)`/`mysqlEnum(values)`, `getTableConfig` (`foreignKeys[].onDelete`, `reference().foreignTable`, `primaryKeys[].columns`, `indexes[].config.name`), `.for('update')`, `transaction`, `drizzle.mock()` all exist with the plan's signatures and behave as the tests expect |
| antd | `antd info | doc Select`, `antd doc Menu` (6.6.5) | Select: "~~optionFilterProp~~ Deprecated, see `showSearch.optionFilterProp`"; Menu: `overflowedIndicator` "when menu is collapsed horizontally" |
| Playwright probe | headless Chromium, antd's Radio/Select markup with the 0×0 radio CSS the repo documents (`e2e/admin-users.spec.ts:69`) | `getByLabel('Groups')` → 2 matches, `{ exact: true }` → 1; `getByRole('radio').check()` → timeout; clicking the visible label checks it (findings C4, C5) |
| Header width | pixels of `e2e/screenshots/admin-desktop-light.png` (1280×800) | logo ink ends x=147, menu starts ≈160; "App management" content 177–309, "User management" 344–481; left header region ends at x=640 (24 px padding + two `flex: 1` halves of 1,232 px) (finding I1) |
| rc-overflow | `node_modules/.pnpm/@rc-component+overflow@1.0.1…/lib/Item.js:51-61` | a collapsed item gets `opacity: 0`, `pointerEvents: 'none'` and `aria-hidden=true` |

---

## A. Cross-task table

| Tasks | Producer → consumer (names, signatures, files) | Found |
| --- | --- | --- |
| 1 → 2 | `users.adminDeactivatedAt`, `users.directoryDeactivatedAt` (plan 139) → `findAccount`/`jwt` selects (696–697, 728–729) | agree (tsc 0, tests pass) |
| 1 → 3 | `difyApps.accessMode`, `appGroupGrants`, `appUserGrants`, `userGroupMembers` from `@/db/schema` (139, 433–437) → `visibleTo` (910, 929–949) | agree; rendered SQL correct |
| 1 ↔ 3 / 6 | Task 1 adds `accessMode` to `difyApps.$inferSelect`; `lib/data/apps.ts:48` `DtoRow = Omit<AppRow, …>` then requires it, while `dtoColumns` does not select it. Task 6 writes `row: DtoRow & { accessMode: AccessMode }` (2885), which presumes `DtoRow` excludes it | **conflict**: Task 1 never edits `lib/data/apps.ts`, tsc fails from Task 1 on (C1) |
| 1 → 4 | `userGroups`, `userGroupMembers`, `appGroupGrants`, `MembershipSource` (`@/lib/app-access`) → `lib/data/groups.ts` (1680–1682) | agree |
| 1 → 6 | `ACCESS_MODES`, `AccessMode`, `AppAccessSettings` (268–286), the grant tables → `accessSchema` (2855–2868), `AdminAppDto`, `grantRowsFor`, `writeGrants` (2878–2935) | agree (after C1) |
| 1 → 7 | markers + `adminDeactivatedBy`, `userGroups`, `userGroupMembers` → `dtoColumns`, `toUserDto`, `listUsers` (3418–3512) | agree |
| 1 → 9 | six cascading FKs, backfill → Task 9 expects `fks` = 6 and every app `everyone` (3942) | agree with the generated SQL (6 FKs) |
| 2 → 4 | `isActive(markers)` (646–658) → `listUserOptions` (1666) | agree |
| 2 → 7 | `isActive` → `toUserDto.active` (3466); Task 2's `jwt` strip + Task 7's `sessionVersion` bump → `e2e/deactivation.spec.ts` | agree; login text "Login failed. Check your email and password." = `auth.login_failed` (`locales/en:181`), mapped from `CredentialsSignin` (`components/auth/auth-failure.ts`) |
| 3 → 5 | `e2e/fixtures/access.ts` `seedApp`, `deleteApp`, `deleteGroupsLike`, `grantAppToGroup` (1083–1139) → `e2e/admin-groups.spec.ts` (2558) | agree; tags `access-`/`grp-` do not overlap under the LIKE patterns |
| 3 → 6 | `lib/data/apps.ts`: Task 3's `visibleTo`, `readAccess(id, visible?)`, `listApps` (919–1016); Task 6 keeps `readAccess(id)` for `updateApp`/`syncApp` (1019) and adds `listAdminApps`, transactions (2878–2979) | agree |
| 3 → 6 | `__tests__/data-apps-sync.test.ts`: Task 3 adds `orderBy` to the fake (1021), Task 6 adds `transaction`/`delete`/`inserted` (2981) | **conflict**: neither task lists the file in Files, oxlint/oxfmt or `git add` (776, 1247–1259; 2700, 3228–3241) (I2) |
| 3 → 6 | `seedApp` exported by `e2e/fixtures/access.ts` → imported into `e2e/admin-apps.spec.ts` (3159), which already declares `const seedApp` (`e2e/admin-apps.spec.ts:12`) | **conflict**: TS2440 / ESM duplicate binding (C3) |
| 3, 5, 6, 7 | `locales/{en,zh,ar}/translation.json`: 3 → `app.empty_contact_admin`; 5 → `admin.menu_groups`, `admin_users.status_deactivated`, `admin_groups.*` (27); 6 → `app_setting.*` (10), `admin_apps.*` (4); 7 → `admin_users.*` (12) | agree: disjoint keys, every UI key present, parity holds |
| 4 → 5 | `listGroups`, `GroupDto`, `listUserOptions`, `UserOption`, the three group actions, `GroupFormInput`, `GROUP_NAME_MAX`, `GROUP_DESCRIPTION_MAX`, `name_in_use` (1281–1286) → page, drawer, table, `groupErrorKey` (2155–2510) | agree (tsc 0) |
| 4 → 6 | `listGroupOptions`, `GroupOption`, `listUserOptions`, `UserOption`, `isMissingReference`, `userIdSchema` → page (2997–3020), `accessSchema`, actions (2985–2993) | agree |
| 4 ↔ 7 | `lib/data/users.ts` (4: `isDuplicateEntry` moved, `asc`, `isActive`, `listUserOptions`; 7: imports `asc, desc, eq, sql`, DTO, `lockTarget`, `setUserActive`), `lib/action-result.ts` (4: `name_in_use`; 7: `cannot_deactivate_self`), `__tests__/data-users.test.ts` (both) | agree; `lib/data/setup.ts:8` still gets `isDuplicateEntry` through the re-export |
| 5 → 6 | `accountOptionLabel(user, deactivatedLabel)` (2125) and `admin_users.status_deactivated` → `app-settings-fields.tsx` (3096–3099) | agree |
| 5 → 7 | `admin_users.status_deactivated` → status column (3630, 3643) | agree |
| 5 ↔ 6 | `components/shell/admin-shell.tsx` nav (5) and the header shared by `/app-management` (6's e2e) | agree; the third item's width is a risk (I1) |
| 7 → 8 | `deactivateRefusal`, `lockTarget` reading the marker → ADR-0024 note (3857) | agree |
| 8 ↔ rules | R6: "the controller commits [the handoff] in Task 8" → Task 8's `git add` (3881) | **conflict**: the handoff file is absent (M5) |
| all → 9 | grep `from(difyApps)`, DTO, logging, migration checks (3908) | agree; the collation check has a gap (I7) |

## B. Per-task self-consistency table

| Task | Tests vs code | Files created vs touched later | `git add` vs files changed | Found |
| --- | --- | --- | --- | --- |
| 1 | schema + migration tests pass against the plan's schema and the generated SQL | `lib/app-access.ts` read by 3, 4, 6; schema files touched only here | lists all its files; once C1 is applied, `lib/data/apps.ts` must be added | **tsc gate fails (C1)** |
| 2 | 20/20 pass; the "six places" for `...live` are four (`__tests__/auth-options.test.ts:168,189,200,214`) | `lib/auth/account-status.ts` read by 4, 7 | matches | agree, wording (M1) |
| 3 | 4 regexes do not match Drizzle's output; Step 4's escape hatch (1025) allows editing only `select .+ from` | `e2e/fixtures/access.ts` reused by 5, 6 | omits `__tests__/data-apps-sync.test.ts` | **C2**, I2 |
| 4 | 80/80 pass, incl. the fake-db action tests and `lockGroup … for update` | `db-errors.ts`, `groups.ts`, schemas/actions reused by 5, 6 | matches | agree |
| 5 | unit 9/9 pass | creates `account-option.ts` (reused by 6) | omits `e2e/page-headers.spec.ts`, whose condition (2680) is met | **C7, C8, C9**, I1, I3, M4 |
| 6 | unit 65/65 pass; 2 fixture type errors; e2e has 4 defects | edits Task 3's `lib/data/apps.ts`, `data-apps-sync` | omits `__tests__/data-apps-sync.test.ts` | **C3–C6, C9**, I2, M2, M3 |
| 7 | 92/92 pass; idempotence half untested; owner-row test can pass vacuously | edits Task 4's `users.ts` | matches | I3, I6, M12 |
| 8 | n/a (records) | — | omits the handoff R6 assigns to Task 8 | M5 |
| 9 | n/a (controller) | — | n/a | I7, M14 |

---

## C. Findings

Severity: Critical = the task cannot work as written; Important = works but is wrong, fragile, insecure or off-spec; Minor. "R0" names the documented source of the correction.

### Critical

**C1. Task 1 breaks `tsc`: `DtoRow` gains `accessMode`.** Plan 289–324 (Step 4), 483–484 (gate), 494 (`git add`); Task 6 relies on the opposite at 2885. Evidence: `lib/data/apps.ts:19` `type AppRow = typeof difyApps.$inferSelect`; `:48` `type DtoRow = Omit<AppRow, 'apiKey' | 'iconImage' | 'iconMime'> & { hasIconImage: boolean }`; `dtoColumns` (`:26-45`) does not select `accessMode`. tsc on the copy: `lib/data/apps.ts(305,2)` (`selectDtoRow`), `(333,18)` (`rows.map(toAppDto)`), `__tests__/data-apps.test.ts(81,24)`, `(96,19)`, `(99,28)`: "Property 'accessMode' is missing … required in type 'DtoRow'". Task 3 keeps `rows.map(toAppDto)`, so the error persists through Task 9. Correction (verified: tsc 0 after it, all tests green): in Task 1, edit `lib/data/apps.ts:48` to

```ts
type DtoRow = Omit<AppRow, 'apiKey' | 'iconImage' | 'iconMime' | 'accessMode'> & {
	hasIconImage: boolean
}
```

and add `lib/data/apps.ts` to Task 1's Files, oxlint/oxfmt and `git add`. Task 6's `DtoRow & { accessMode: AccessMode }` (2885) then type-checks as written. R0: TypeScript Handbook, "Utility Types" (`Omit<Type, Keys>`); Drizzle docs, type API `$inferSelect`.

**C2. Task 3's SQL regexes do not match Drizzle rc.3's output, and the plan's escape hatch forbids the needed edit.** Plan 843–848, 877; 1025. Evidence: `drizzle.mock()` renders `visibleTo(user)` as `… where ((\`dify_apps\`.\`access_mode\` = ?) or (exists (select 1 from \`app_user_grants\` where ((\`app_user_grants\`.\`app_id\` = \`dify_apps\`.\`id\`) and (\`app_user_grants\`.\`user_id\` = ?)))) or (exists (select 1 from \`app_group_grants\` inner join \`user_group_members\` on \`user_group_members\`.\`group_id\` = \`app_group_grants\`.\`group_id\` where ((\`app_group_grants\`.\`app_id\` = \`dify_apps\`.\`id\`) and (\`user_group_members\`.\`user_id\` = ?)))))`and a single-app read as`where ((\`dify_apps\`.\`id\` = ?) and (((…`. `and()`/`or()`parenthesise each operand. The two`exists`regexes and`/\`dify_apps\`\.\`id\` = \? and \(/`fail (4 of 10 tests). Step 4 (1025) allows adjusting "only the`select .+ from`part". The code itself is right: params`['everyone','u1','u1']`, admin gets no condition. Correction (verified 10/10): replace with

```ts
/exists \(select 1 from `app_user_grants` where \(\(`app_user_grants`\.`app_id` = `dify_apps`\.`id`\) and \(`app_user_grants`\.`user_id` = \?\)\)\)/
/exists \(select 1 from `app_group_grants` inner join `user_group_members` on `user_group_members`\.`group_id` = `app_group_grants`\.`group_id` where \(\(`app_group_grants`\.`app_id` = `dify_apps`\.`id`\) and \(`user_group_members`\.`user_id` = \?\)\)\)/
/`dify_apps`\.`id` = \?\) and \(/
```

and widen Step 4's escape hatch to "Drizzle's parenthesisation". R0: Drizzle docs "Goodies" (`.toSQL()`), output of the installed `drizzle-orm` 1.0.0-rc.3.

**C3. Task 6's e2e import collides with `e2e/admin-apps.spec.ts`'s own `seedApp`.** Plan 3159. Evidence: `e2e/admin-apps.spec.ts:12` `const seedApp = (id, name, apiBase) => …`; on the copy, tsc reports `e2e/admin-apps.spec.ts(7,39): error TS2440: Import declaration conflicts with local declaration of 'seedApp'`. Under ESM the file is a SyntaxError and no test in it runs. Correction: `import { deleteApp, deleteGroupsLike, seedApp as seedAccessApp, seedGroup } from './fixtures/access'` (or a new `e2e/admin-app-access.spec.ts`). R0: MDN, `import` ("`as` … alias"); ECMAScript: duplicate lexical declaration is an early error.

**C4. Task 6's `getByRole('radio', { name: 'Everyone' }).check()` cannot act on antd's button radio.** Plan 3207. Evidence: the repo's own `e2e/admin-users.spec.ts:69` says "antd draws a button-style radio's `<input>` at 0×0 with pointer-events: none, so the visible label is clicked"; the probe: `check()` → "Timeout 2000ms exceeded", and a label click checks it. Correction: `const drawer = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' }); await drawer.getByText('Everyone', { exact: true }).click(); await expect(drawer.getByRole('radio', { name: 'Everyone' })).toBeChecked()`. Scope it to the drawer: the table also shows "Everyone" tags. R0: Playwright docs "Actionability" (Visible = non-empty bounding box); repo pattern.

**C5. Task 6's `page.getByLabel('Groups')` matches two elements.** Plan 3191. Evidence: `getByLabel` is case-insensitive and substring by default (Playwright docs). The radio input inside `<label>` "Selected groups and people" matches too; the probe returns count 2, so the `click()` is a strict-mode violation. Correction: `drawer.getByLabel('Groups', { exact: true }).click()` (probe: count 1). R0: Playwright `locator.getByLabel` `exact` option; "Strictness".

**C6. Task 6's Update renames the seeded app to "Stub app", so the spec's row and card locators stop matching.** Plan 3187, 3195, 3201, 3209; the note at 3221. Evidence: `updateApp` re-reads Dify and writes `infoColumns(info)` including `name` (`lib/data/apps.ts:288-293, 396-397`). The stub's `/info` answers `name: matched.name` (`e2e/fixtures/stub/router.ts:271-273`), "Stub app" for prefix `''` (`e2e/fixtures/stub/apps.ts:31-33`), and `seedApp` seeds prefix `''` (plan 1093). After the first Update, `getByRole('row', { name: /Drawer appacc-…/ })` and `memberPage.getByText('Drawer …')` find nothing, and "Stub app" is ambiguous with the real stub app. Correction: locate the row by id with the file's helper `rowById(page, appId)` (`e2e/admin-apps.spec.ts:21`, "antd's Table sets data-row-key from rowKey"), and the member's card by `memberPage.locator(\`a[href="/chat/${appId}"]\`)`(the card is a link to`/chat/<id>`, `e2e/apps.spec.ts:11`). R0: Playwright locators; antd Table `rowKey`.

**C7. Task 5's navigation test fails on `mobile-light`.** Plan 2660–2664 (outside any skip). Evidence: the desktop menu sits in `.desktopOnly { display: none }` below 768 px (`components/shell/app-header.module.css`); `mobile-light` is Pixel 7 (`playwright.config.ts:68-69`); the mobile menu lives in a closed Drawer. On desktop the link may also be hidden, see I1. Correction: branch on `isMobile`, as `e2e/shell.spec.ts:63-68` does: on mobile `getByRole('button', { name: 'Menu' })` then `getByRole('menuitem', { name: 'Group management' })`; on desktop the link. R0: Playwright `isMobile` fixture / `test.skip`; repo pattern.

**C8. Task 5's e2e spec fails oxlint, and the pre-commit hook blocks the commit.** Plan 2582, 2586. Evidence: `oxlint` on the copy: `e2e/admin-groups.spec.ts:28:6 error eslint(no-unused-vars): Variable 'userId' is assigned a value but never used`; `.oxlintrc.json` sets `"eslint/no-unused-vars": "error"`; `.lintstagedrc.mjs` runs `oxlint` on staged `*.ts`. Correction (one line): drop `let userId` and write `await seedUser({ … })`. R0: oxlint rule `no-unused-vars` as configured.

**C9. The three new Selects use `optionFilterProp`, deprecated in antd 6, so the plan's own "antd lint stays at zero findings" gate fails.** Plan 2312 (Task 5), 3081, 3094 (Task 6); constraint 52; gates 2674/2680, 3230, 3811. Evidence: `npx -y @ant-design/cli lint ./components` → "Select `optionFilterProp` is deprecated. Deprecated, see `showSearch.optionFilterProp`" ×3; antd 6.6.5 Select doc: `showSearch` "boolean | Object", Object since 6.0.0, whose `optionFilterProp` "If `options` is set, it should be set to `label`". Correction (one line each): `showSearch={{ optionFilterProp: 'label' }}` in place of `optionFilterProp="label"`. R0: antd 6.6.5 Select API (`antd doc Select`).

### Important

**I1. A third header item likely overflows into antd's "…" at 1280 px; the e2e then cannot find the link on desktop either.** Plan 2176–2180, 2514 (label "Group management"); spec §4.3 says a "Groups" entry. Evidence (measured, not rendered): the screenshot shows the menu starting at x≈160. The left header region ends at x=640 (`paddingInline: token.paddingLG` = 24; two `.side { flex: 1 }`, `app-header.tsx:66-74`, `app-header.module.css`), so the menu has ≈480 px. The current items measure 133 px and 138 px of content, ≈167 and ≈170 px with padding; "Group management" would be ≈179 px, ≈516 px in total. The repo's `.nav { flex: 1; min-width: 0 }` is the setup antd's FAQ gives to make a horizontal Menu collapse ("overflowedIndicator … when menu is collapsed horizontally"). rc-overflow then gives the item `aria-hidden` and `pointer-events: none` (`@rc-component/overflow/lib/Item.js:51-61`), so `getByRole('link')` cannot find it. Correction (needs a controller/owner choice, then the Task 5 e2e on desktop confirms it): shorter nav labels, e.g. the spec's own "Groups" for `admin.menu_groups`, with a separate page-title key; or a wider nav region. Keep the page heading "Group management" through its own key. R0: antd Menu doc (`overflowedIndicator`, FAQ "Why Menu do not responsive collapse in Flex layout?").

**I2. `__tests__/data-apps-sync.test.ts` is changed by Tasks 3 and 6 but committed by neither.** Plan 1021 and 2981 (the edits) vs 776, 1247–1248, 1259 and 2700, 3228–3229, 3241 (Files, lint, `git add`). Evidence: without Task 3's `orderBy` edit, "listApps reads neither the key nor the icon bytes" fails (run on the copy). Constraint 56 / R6 require `git status --short` to show nothing of the task's unstaged. Correction: add the file to both tasks' Files, oxlint/oxfmt and `git add` lists. R0: the run's Global Constraints ("Commits").

**I3. The new e2e specs click right after `goto` on server-rendered pages (hydration race).** Plan 2570–2573 then 2597 (`/group-management`), 3771–3775 (`/user-management`); also 3186–3190. Evidence: `e2e/admin-users.spec.ts:23-35` documents exactly this failure ("seen on the mobile project, where Edit opened no drawer") and waits for a hydration-only signal (`openUsers`). The owner declined the product-side fix on 2026-10-08 and kept test-side waits (CLAUDE.md, Open follow-ups). The groups table can be empty at the first click, so it has no `<time>` to wait for. Correction: Task 7, reuse `openUsers`' wait (move it to `e2e/fixtures/`). Task 5, seed one group of the spec's own in `beforeEach` so the table renders a `ClientDateTime`, then wait for it the same way; or retry the opening click with `await expect(async () => { … }).toPass()`. R0: Playwright docs "Navigations > Hydration"; `expect.toPass` (Playwright "Assertions").

**I4. Spec §8's "a `user` with no grants sees the empty gallery" e2e is dropped without being a declared deviation.** Plan 1241 (Task 9's browser check instead). Evidence: spec §8 lists it among B3a's Playwright cases and is the binding authority; deviations 1–6 do not include it. It is testable as the suite stands: `workers: 1`, `fullyParallel: false` (`playwright.config.ts:17-18`); the plan's `auth.setup.ts` writes `access_mode = 'everyone'` in `ON DUPLICATE KEY UPDATE` (1039), so a killed run self-heals the stub apps at the next setup. Correction: an `e2e/app-access.spec.ts` case that records the ids of every `everyone` app, sets them `restricted`, asserts the empty-state text for a fresh user, and restores them in `finally`. Or record it as deviation 7 for the owner. R0: spec §8; Playwright hooks/`finally` (the repo's cleanup pattern).

**I5. Review Focus 1 names `/chat`'s first-app redirect, but no test pins it.** Plan 71; Task 3 tests only `listApps`. Evidence: `app/(user)/chat/page.tsx` redirects to the first enabled app of `listApps(actor)`; `grep` finds no test of this page in `__tests__` or `e2e`. Correction: a vitest page test in the style of plan 2066–2111 (mock `requireUser`/`listApps`; assert `listApps` got the actor and the redirect goes to the first enabled item), or an e2e assertion: the `user` with the newest restricted app (sorted first by `createdAt desc`) visits `/chat` and does not land on `/chat/${appId}`. R0: Next bundled docs `redirect`; Review Focus 1.

**I6. Task 7's "offers no Deactivate on the owner's own row" passes vacuously when the row is not rendered.** Plan 3796–3800. Evidence: `toHaveCount(0)` on a child of a locator that matches nothing passes. The owner is the oldest account and the table sorts by `createdAt desc` with pagination. The existing `e2e/admin-users.spec.ts:110-111` asserts `own…Edit` visible first. Correction: `await expect(own.getByRole('button', { name: 'Edit' })).toBeVisible()` before the count. R0: Playwright web-first assertions.

**I7. Task 9's collation check reads the copy database's default, not the source database's.** Plan 3928–3933. Evidence: `mysqldump … "$MYSQL_DATABASE"` without `--databases` emits no `CREATE DATABASE`, so `b3acopy` gets the e2e server's default. `@@collation_database` then describes that default, while on the real volume the new tables take the real database's default (MySQL 8.4 "CREATE TABLE": table defaults come from the database). The failure the check targets, FK error 3780 on mismatched collations, can therefore pass on the copy and fail on the volume or in production. Correction: run, on the local stack (and give the owner the same line for production before deploying), `SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()` plus the two `id` columns' collations; or dump with `--databases` so the copy keeps the source's defaults. R0: MySQL 8.4 Reference Manual "FOREIGN KEY Constraints" (same character set and collation), "CREATE TABLE", mysqldump `--databases`.

### Minor

- **M1.** Plan 566: "six places" for `...live`; there are four (`__tests__/auth-options.test.ts:168,189,200,214`). Without it, 168 and 200 fail (fail-closed `isActive`), so name the four.
- **M2.** Plan 2843, 2981: adding `access: { mode: 'restricted', groupIds: [], userIds: [] }` literally gives TS2345. In `data-apps.test.ts` it sits under `as const` (readonly tuples), and in `data-apps-sync.test.ts` `mode` widens to `string`. Correction (verified tsc 0): `groupIds: [] as string[], userIds: [] as string[]` and `mode: 'restricted' as const`. R0: TypeScript Handbook, `as const` / readonly.
- **M3.** Plan 2781–2786: the snippet for the existing `__tests__/admin-app-row.test.ts` repeats `import { describe, expect, it } from 'vitest'`. Merge it into the existing import lines.
- **M4.** Plan 2680/2685: the condition is met. `e2e/page-headers.spec.ts:4-12` enumerates the list pages, so add `{ path: '/group-management', title: 'Group management', subtitle: 'Group accounts to give them apps together' }`, and add the file to Task 5's lint and `git add` lists.
- **M5.** R6 says the controller commits `docs/superpowers/handoffs/2026-10-09-backend-b3-brainstorm-and-b3a-plan.md` in Task 8; Task 8's `git add` (3881) omits it. Add it, or a ruling.
- **M6.** Spec §7.4 says Arabic with "Arabic-Indic digits" (ADR-0005). The plan's constraint 51 and its tables (2530, 2534) use Western digits, as the Arabic file does today (`locales/ar/translation.json:191,223,260`). This is not among deviations 1–6; record it as a deviation or ask.
- **M7.** Plan 3518–3527: `deactivateRefusal` repeats `deleteRefusal`'s body (`lib/data/users.ts:91-100`) with another self code. A reviewer will call it duplication; one helper taking the self code avoids it.
- **M8.** Plan 3152: the tag reads "Groups: N · People: M", where spec §4.4 has "N groups · M people". It avoids plurals but is not a listed deviation.
- **M9.** `app/api/apps/[appId]/icon/route.ts:24` caches `private, max-age=86400`. After a grant is removed, the browser can show the icon for a day without asking. Not an access leak (icon bytes only), but spec §4.5 says changes apply "at the next request". Options: note it in ADR-0027's consequences, or use `no-cache` with the existing ETag (304s stay cheap). R0: RFC 9111 §5.2.2.4 `no-cache`.
- **M10.** Plan 2409: the member count is `group.members.length` over membership rows. From B3b, a person who is both a `manual` and a `directory` member counts twice; count distinct `userId`.
- **M11.** Plan 2985–2993: if the app is deleted between `readAccess` and the transaction, the grant insert's 1452 answers `invalid_input` on `access` instead of `not_found`. Rare; check `affectedRows` of the app update first.
- **M12.** Plan 3376–3383: deviation 6's second half (reactivating an active account is a no-op) is untested. The idempotence test chains two calls and asserts one total write, so a wrong write in the first and a missing write in the second would cancel out. Split it: deactivate an already-deactivated account → `writes.update` not called; reactivate an active one (`adminDeactivatedAt: null`) → not called.
- **M13.** Deviation 3 (plan 17) promises "a field error on the picker", but neither drawer maps `fieldErrors`. The app drawer shows the generic `admin_apps.invalid_input` ("Some values are not valid…"). Reword the deviation, or set the error with antd `form.setFields` on `['access','groupIds']`/`['access','userIds']` and `memberIds` (antd Form API `setFields`).
- **M14.** Task 9 Steps 4–5 (3928, 3947–3956) operate `docker-compose.local.yml`, which R4 forbids to implementers and reviewers. Task 9 is the controller's; say so in the step so no subagent runs it.
- **M15.** Spec §8 "app access everyone, groups or people": the drawer e2e covers everyone and groups. A direct grant to a person is covered only by DB seeding (Task 3); one `People` pick in Task 6's case would close it.

### Checked and found sound (no finding)

- **Security.** Every app read a `user` reaches applies `visibleTo`: `listApps` (gallery, `/chat`), `getChatApp`, `getAppAccess` (all 25 Dify route files go through `resolveDifyRoute`, `lib/dify/route.ts:41`), `getAppIcon`. Admin reads and writes keep `assertAdmin`. Deny by default: new apps are `restricted` in the column default, `DEFAULT_APP_FORM_VALUES` and the required `access` in `appInputSchema`.
- **Deactivation.** The rank map applies through `canManage` on the locked row. Deactivation bumps `sessionVersion` in the same write, and the `jwt` callback strips inactive rows, so a reactivated old token stays revoked. The sign-in refusal comes after the bcrypt check and is logged as `{ reason: 'account_inactive', userId }` (no email, hash or password). Group and app write failures log only name, code and errno through `describeError`.
- **Migration.** Six `ON DELETE CASCADE`. The backfill is a later folder, its `UPDATE` alone. Both `id`s are `varchar(36)` (`20260904062910_concerned_tattoo`), and MySQL allows differing string lengths anyway. The SQL forms (`CONSTRAINT … UNIQUE INDEX`, `DEFAULT (CURRENT_TIMESTAMP(3))`) are already proven by applied migrations.
- **Session-chain tests.** Every session-bearing action test mocks `next-auth/next` and `@/lib/auth/options` and keeps `lib/auth/session` real (ADR-0024 deviation 3).

## D. Verdict

**Ready after the listed corrections.** The architecture, the security rule and the migration are sound and match the spec, and every DAL, action and unit test runs green on the copy once C1 and C2 are applied. The nine Critical items are concrete and mostly one-line fixes, five of them in e2e specs. Apply C1–C9 and I2 before dispatching Task 1. I1 needs a controller/owner choice on the nav label. Fold I3–I7 and the Minors into the affected tasks' dispatches.
