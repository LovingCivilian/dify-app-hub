# Fix wave report: B3a final review, all seven Minors

**Status:** DONE_WITH_CONCERNS (all seven fixed and every gate green; three notes for the controller, listed under Concerns) **Commit:** `d09654de fix(b3a): final review fixes — grouped memberships, focusable tooltip, records` (one commit, 8 files, +102 −34, both R1 trailers in the same `-m`) **Base:** `2914fdcd`

## Per item

### 1. `listUsers` groups the memberships once (`lib/data/users.ts`)

- Change: a new exported pure function `toUserDtos(rows, memberships)` does `Map.groupBy(memberships, m => m.userId)` and maps each row through `toUserDto(row, (groupsOf.get(row.id) ?? []).map(…))`. `listUsers` now ends in `return toUserDtos(rows, memberships)`. The row type `toUserDto` already took (the inline `Pick<UserRow, …>`) is now named `UserDtoRow`, as `GroupDtoRow` is in `lib/data/groups.ts`. Every existing exported signature is unchanged (the type is structurally the same), and `toUserDtos` is a new export, the same shape as `toGroupDtos` and `toAdminAppDtos`.
- Test: `__tests__/data-users.test.ts` "toUserDtos (listUsers) › gives each account only its own groups, grouped once, and keeps both orders": three rows, memberships out of row order, one account with none. It checks that each account gets only its own groups, that both orders hold, and that the account with none gets `[]`.
- RED: `pnpm exec vitest run __tests__/data-users.test.ts` → `TypeError: toUserDtos is not a function` (1 failed, 48 passed). That was the expected failure, because the export did not exist yet.
- GREEN: the same command → 49 passed.
- Source: MDN "Map.groupBy()" (mdn/content `files/en-us/web/javascript/reference/global_objects/map/groupby/index.md`): it "groups the elements of a given iterable using the values returned by a provided callback function… Each key has an associated array containing all the elements for which the callback returned the same value". Node 22.21.1 in the image (final review). MDN mentions `Object.groupBy()` for keys that can be strings. I kept `Map.groupBy` because the brief names it and the two sibling DALs use it.

### 2. The deactivation tooltip is reachable by keyboard (`components/admin/users/user-management.tsx`)

- Change: the `Tag` gets `tabIndex={0}`, and the `Tooltip` gets `trigger={['hover', 'focus']}`. A three-line comment cites the sources. At rest the tag looks the same (same Tag, same colour). Keyboard focus shows the browser's focus ring.
- Why both props: the review suggested `tabIndex={0}` ("e.g."), and the brief asked me to follow antd's FAQ. The FAQ says focus alone does not open the tooltip: antd 6.6.5 shared FAQ, "How to support keyboard accessibility?": "By default, Tooltip and similar components trigger on `hover` rather than `focus`, so they will not respond to keyboard focus events… Set the `trigger` property to include `focus`, for example… `trigger={['hover', 'focus']}`" (`components/tooltip/shared/sharedFAQ.en-US.md` at tag 6.6.5; the `trigger` row of `sharedProps.en-US.md`: `hover | focus | click | contextMenu | Array<string>`, default `hover`). An intermediate run confirmed this (RED 2 below).
- `aria-describedby`: antd adds it itself. `@rc-component/tooltip` 1.5.2 `es/Tooltip.js:69-72` puts `aria-describedby` on the child while the tooltip is open, and `es/Popup.js` renders the popup with `role="tooltip"` and that id. So the APG roles come from the library, and the test pins them.
- WAI-ARIA APG "Tooltip Pattern" (w3.org/WAI/ARIA/apg/patterns/tooltip/): "A tooltip is a popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it"; "If the tooltip is invoked when the trigger element receives focus, then it is dismissed when it no longer has focus (onBlur)"; "The element that serves as the tooltip container has role tooltip. The element that triggers the tooltip references the tooltip element with aria-describedby." MDN `tabindex`: "`tabindex="0"` means that the element should be focusable in sequential keyboard navigation". antd `TagProps extends React.HTMLAttributes<HTMLSpanElement>`, and `es/tag/index.js` spreads the rest props onto the `<span>` with the forwarded ref, so `tabIndex` reaches the DOM.
- Reference projects (R0; tabIndex versus a text Button is a choice the docs leave open): Grafana `packages/grafana-ui/src/components/Tooltip/Tooltip.tsx` (@d6a38872, 2026-09-22) clones every tooltip child with `tabIndex: 0, // tooltip trigger should be keyboard focusable`, opens on `useFocus` as well as hover, and sets `aria-describedby` while open. Its `Badge` (a status label like this Tag) gets focus that way. Grafana's `Tooltip.mdx`: "Tooltips must be visible when their trigger is tabbed to or focused on via keyboard navigation". MUI's Tooltip docs, Accessibility: "Tooltips should wrap triggers that are focusable and hoverable … so that all users can activate them." I chose `tabIndex` on the Tag over a text Button: it keeps the visible look, as the brief asks, and it is Grafana's pattern.
- Test: `e2e/deactivation.spec.ts` "signs a user out, …". After the deactivation it focuses the status tag and checks four things: `toBeFocused()`, the tooltip contains "Deactivated by E2E Owner", `toHaveAccessibleDescription(/Deactivated by E2E Owner/)`, and after `blur()` there is no visible tooltip (`toHaveCount(0)`, APG's onBlur dismissal). All are documented Playwright locator and assertion APIs (`locator.focus`, `locator.blur`, `toBeFocused`, `toHaveAccessibleDescription`).
- RED 1 (before the fix): `pnpm exec playwright test e2e/deactivation.spec.ts --project desktop-light -g "signs a user out" --reporter=line` → `toBeFocused` failed. The locator resolved to `<span class="ant-tag … ant-tag-red …">Deactivated</span>` and gave `unexpected value "inactive"` (1 failed, 1 passed: setup). Expected, because a plain `span` cannot take focus.
- RED 2 (`tabIndex={0}` only): the same command → `toBeFocused` passed, then `toContainText('Deactivated by E2E Owner')` failed with "element(s) not found". This confirms the FAQ: a focused tag does not open a hover-only tooltip.
- GREEN (`tabIndex` + `trigger`): the same command → 2 passed (20.0 s).

### 3. `e2e/shell.spec.ts` uses `openUsers`

- Change: `import { openUsers } from './fixtures/users'`. The sidebar test's `goto('/user-management')`, its stale "as openUsers in admin-users.spec.ts" comment and the inline `not.toContainText(/^\s*$/)` wait became `await openUsers(page)`. `openUsers` does the same wait through `waitForHydration`.
- Covered by: the sidebar test in the Playwright gate (desktop-light and desktop-dark; mobile skips it by design).

### 4. `docs/auth-gate.md` inventories

- The DAL bullet now names `apps.ts`, `users.ts` and `groups.ts`. It says that `listAdminApps` and every groups function call `assertAdmin`. It adds `deactivateRefusal` to the users rank list, and says that `groups.ts` applies no rank (a membership grants no right, ADR-0027) and locks the group row (`lockGroup`) before a save.
- The actions bullet now lists `app/(admin)/group-management/actions.ts` beside the other two.
- I checked these against the code: `group-management/actions.ts:20,33,47` (`requireAdmin()` ×3); `lib/data/groups.ts:147,176,187,211,238` (`assertAdmin` ×5); `lockGroup` in `updateGroup` (:214).

### 5. ADR-0027: a collation mismatch is not rolled back

- "Bad" bullet (:126). Before `pnpm db:migrate`, run the check on any database these migrations did not create, because a failed run is not rolled back. The bullet gives the reasons. MySQL commits each DDL statement implicitly. Drizzle records a migration only after its last statement. So a 3780 at an `ADD CONSTRAINT` leaves the four tables, the four columns and any earlier foreign key in place, with the migration unrecorded. The next run then stops at the first `CREATE TABLE` (1050) until those objects are dropped by hand.
- Migration steps (the deploy note): run the collation query above and convert first, because a 3780 fails the migration midway and its DDL is not rolled back.
- Sources:
  - MySQL 8.4 "Statements That Cause an Implicit Commit": the statements listed "implicitly end any transaction active in the current session, as if you had done a COMMIT", including `ALTER TABLE` and `CREATE TABLE`.
  - MySQL 8.4 "Statements That Cannot Be Rolled Back": "In general, these include data definition language (DDL) statements… If you issue a statement early in a transaction that cannot be rolled back, and then another statement later fails, the full effect of the transaction cannot be rolled back".
  - Drizzle: `node_modules/drizzle-orm` 1.0.0-rc.3 `mysql-core/dialect.js:62-67` runs each migration's statements and then inserts its `__drizzle_migrations` row, inside `session.transaction`. `db/migrate.ts` (the container entrypoint) uses `drizzle-orm/mysql2/migrator`, and so does `drizzle-kit migrate` (`pnpm db:migrate`; drizzle-kit's `connections-*.js` loads `drizzle-orm/mysql2/migrator`).
- I changed "at the first `ADD CONSTRAINT`" (the review's words) to "at an `ADD CONSTRAINT`… and any foreign key added before it". The first statement to fail depends on which referenced table is mismatched: the `users` foreign keys come fourth and sixth.

### 6. ADR-0027 :89 rewritten

- The sentence now reads: "The groups page counts each account once in a group's member count, and the users page shows each account's groups as read-only tags". I checked the first half against `components/admin/groups/group-management.tsx:79-80` (`new Set(group.members.map(m => m.userId)).size`) and the second against the users table's `column_groups` Tag list.
- While in the ADR, I also recorded item 2: the Deactivation "Kept" bullet now says that the tooltip opens on hover and on keyboard focus (with the two sources), and the Verification line for `e2e/deactivation.spec.ts` adds "the status tooltip on keyboard focus".

### 7. `CLAUDE.md` Frontend follow-up

- The pointer is now `openUsers` in `e2e/fixtures/users.ts`, on `waitForHydration` in `e2e/fixtures/hydration.ts`.
- New sentence: the dev hydration warning about `caret-color` on form inputs during `e2e/screenshots.spec.ts`'s auth-page shots comes from Playwright. `page.screenshot()` defaults to `caret: 'hide'`, and 1.63's screenshot preparation sets an inline `caret-color: transparent !important` on every input before React hydrates. It affects screenshots only, never product code, and `caret: 'initial'` would quiet it.
- Sources:
  - Playwright 1.63.0 `types.d.ts:13563-13567`: "When set to `"hide"`, screenshot will hide text caret. When set to `"initial"`, text caret behavior will not be changed. Defaults to `"hide"`."
  - Context7 `/microsoft/playwright/v1.63.0`: `caret` is passed as `hideCaret = options.caret !== 'initial'` (`screenshotter.ts`).
  - `playwright-core@1.63.0/lib/coreBundle.js:21583-21597`: `element.style.setProperty("caret-color", "transparent", "important")` on `input,textarea,[contenteditable]`, restored afterwards.
- `CLAUDE.md` stays at 130 lines.

## Gates (all on the final tree, before the commit)

| Gate | Result |
| --- | --- |
| `pnpm exec next typegen && pnpm exec tsc --noEmit` | exit 0 ("Types generated successfully") |
| `pnpm exec oxfmt --write` then `--check` on the 8 changed files | "All matched files use the correct format." |
| `pnpm exec oxlint` on the 5 changed ts/tsx files | "Found 0 warnings and 0 errors." |
| `pnpm test --exclude 'tmp/**'` (R8) | 109 files, 1324 tests passed (was 1323; +1 `toUserDtos`) |
| `npx -y @ant-design/cli lint ./components` | "Scanned 130 files. No issues found." |
| Playwright `e2e/shell.spec.ts e2e/admin-users.spec.ts e2e/deactivation.spec.ts`, all projects (`docker compose -f docker-compose.e2e.yml down` before and after) | 48 passed, 4 skipped, 0 failed (2.7 min): setup 1, 17 per project (desktop-light, desktop-dark, mobile-light). The skips are the specs' own `test.skip(isMobile…)` / desktop skips. |
| lint-staged on commit | oxlint and oxfmt passed, no changes |
| `AGENTS.md` | byte-identical (`git diff --quiet HEAD -- AGENTS.md`) |
| R10 | no `next dev`, stub, Playwright, vitest or e2e container left running; only the owner's `dify-app-hub-local-*` containers are up, untouched; port 5300 untouched |

The Playwright log's only browser noise is the pre-existing `Performance.measure` "'Home' cannot have a negative time stamp" `TypeError` (CLAUDE.md follow-up). There was no hydration warning.

## Deviations from the brief

1. Item 2 adds `trigger={['hover', 'focus']}` beside `tabIndex={0}`. The brief's "e.g. `tabIndex={0}`" alone does not open the tooltip on focus. The brief also asked me to follow antd's FAQ, which names `trigger` as the way (RED 2 above shows it). This is the brief's route, made complete, not a different one.
2. Item 4 also adds `deactivateRefusal` to the users rank list, `listAdminApps` to the `assertAdmin` sentence, and one sentence on `groups.ts` (no rank, `lockGroup`). These names were missing from the same inventory sentences the review called the audit list. Two documentation clauses.
3. Item 5 says "at an `ADD CONSTRAINT` … and any foreign key added before it" rather than "the first". Which constraint fails depends on which referenced table is mismatched.
4. ADR-0027 also records item 2 (the "Kept" bullet and the deactivation spec's Verification line), so the ADR matches the code and the test.

## Concerns (for the controller)

- **Escape does not dismiss the tooltip.** The APG lists "Escape: Dismisses the Tooltip", and WCAG 1.4.13 asks for a way to dismiss it. antd 6.6.5's Tooltip has no Escape handling: there is none in `@rc-component/trigger` 3.10.1, `@rc-component/tooltip` 1.5.2 or `antd/es/tooltip`, and antd's docs describe none. Moving focus away (or the pointer) closes it. Adding Escape would mean a controlled `open` with a keydown handler, which is behaviour antd does not document for this. Per ADR-0002 I report it instead of building it; it could be an owner or phase-2 question.
- **`.cii-assessment.md` #19 and #20** still quote 1323 unit tests in their evidence; the suite now has 1324. No result changed (the score stays 24/35), so AGENTS.md's rule (update when a result changes, in its own commit) does not require an edit now. Task 9's final counts can refresh it with the full-run numbers.
- **The keyboard check is via `locator.focus()`, not a real Tab sequence.** `tabIndex={0}` puts the tag in the sequential order (MDN). A Tab-order assertion would depend on the column order of the row, so I did not add one (R9: no extra probes).

## Sources consulted

- antd 6.6.5: `antd doc Tooltip`; `components/tooltip/shared/sharedFAQ.en-US.md` and `sharedProps.en-US.md` at tag 6.6.5 (raw GitHub); `antd info Tag`; `node_modules/antd/es/tag/index.js`; `@rc-component/tooltip` 1.5.2 `es/Tooltip.js`, `es/Popup.js`; `@rc-component/trigger` 3.10.1.
- WAI-ARIA APG "Tooltip Pattern" (w3.org/WAI/ARIA/apg/patterns/tooltip/).
- MDN "Map.groupBy()" and "tabindex" (mdn/content sources).
- Grafana `grafana-ui` Tooltip.tsx @d6a38872, Tooltip.mdx, Badge.tsx @66b74a41; MUI `docs/data/material/components/tooltips/tooltips.md` (Accessibility).
- MySQL 8.4 Reference Manual: "Statements That Cause an Implicit Commit", "Statements That Cannot Be Rolled Back".
- drizzle-orm 1.0.0-rc.3 `mysql-core/dialect.js`; `db/migrate.ts`; drizzle-kit 1.0.0-rc.3 `connections-*.js`.
- Playwright 1.63.0: Context7 `/microsoft/playwright/v1.63.0` (screenshot `caret`), `playwright-core/types/types.d.ts`, `lib/coreBundle.js`; Playwright locator/assertion API (`focus`, `blur`, `toBeFocused`, `toHaveAccessibleDescription`).

## Self-review

`git diff 2914fdcd..d09654de` covers the seven items and nothing else. The names follow the sibling DALs (`toUserDtos`/`UserDtoRow` like `toGroupDtos`/`GroupDtoRow`). Nothing is overbuilt: no global `ConfigProvider` tooltip trigger, and the directory-deactivated tag, which has no tooltip, stays unfocusable. The tests check behaviour (the grouping by output, the tooltip by focus, ARIA description and dismissal). Gate output is clean apart from the known `Performance.measure` noise. Scratch files (fetched pages, logs) are under the repo's git-ignored `tmp/` (`tmp/fw-*.log`, `tmp/*.txt`), none with a `.ts` or `.tsx` ending. Nothing under `tmp/`, `.superpowers/` or `docs/superpowers/handoffs/` was staged.
