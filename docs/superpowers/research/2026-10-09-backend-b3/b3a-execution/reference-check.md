# Rulings check — B3a (2026-10-09)

Nine controller rulings checked against official sources and reference projects (rule R0). The downloaded pages and files are under `tmp/rulings-check/` (git-ignored). Each reference names its repository, path and pinned commit. Commits fetched on 2026-10-09 are the repository HEAD at fetch time. The others are the B3 research pins (`docs/superpowers/research/2026-10-09-backend-b3/`).

## Summary

| # | Ruling | Verdict | Change |
| --- | --- | --- | --- |
| 1 | Unknown email answered in constant time (bcrypt compare against `UNKNOWN_ACCOUNT_HASH`) | **Supported** | None |
| 2 | Action test: real session chain, DAL under `vi.mock(path, { spy: true })`, a `user` or no session never reaches the DAL | **Supported** | None |
| 3 | Icon route answers `Cache-Control: private, no-cache` with its ETag | **Supported** | None. A side note on `If-None-Match` matching is in §3. |
| 4 | Task 6: locking read (`.for('update')`) of the `dify_apps` row inside the save transaction, `not_found` if gone | **Supported** | None. Keep `update` strength, not `share` (§4). |
| 5 | Server field errors put on the pickers with `form.setFields` | **Supported with a change** | The three pickers (`memberIds`, `access.groupIds`, `access.userIds`) have no `rules`, so antd never re-validates them and the server error stays after the admin changes the pick. Clear it when the value changes: Form `onValuesChange` → `form.setFields([{ name, errors: [] }])`. |
| 6 | Test-side hydration wait: a `ClientDateTime` `<time>` in the table has text | **Supported with a change** | `/app-management` renders no `<time>` (no date column, no `ClientDateTime`), so Task 6 cannot use the helper as written. Give the helper its signal as a parameter, or, where a page has no such signal, retry the first click and its visible outcome with `expect(…).toPass()` (Playwright docs). |
| 7 | Menu label "Groups" while the heading reads "Group management" (siblings: "App management", "User management") | **Supported with a change** | Keep the three menu labels parallel. Either use "Group management" (the menu text is the page heading in Grafana, Ant Design Pro and Dify) or shorten all three together as one cosmetic change for the owner. antd collapses overflowing items into "…" (documented), and the 1280 px e2e does not test 768–1280 px. |
| 8 | Western digits in literal Arabic strings ("255", "8"); `Intl` with `nu-arab` for formatted values | **Supported with a change** (to the record) | ADR-0027 deviation 7 should cite CLDR 48: generic `ar` defaults to `latn`, with `arab` only as `native`; `ar_SA`/`ar_EG` default to `arab`. It should also cite the three reference projects that write Western literals. The cost is not a digit sweep: it is formatting the numbers, e.g. i18next `{{n, number(numberingSystem: arab)}}`. Interpolated counts (`{{total}}`, the new tag's N and M) are Western too, and the record should say so. |
| 9 | No i18next plurals for the count tag ("Groups: N · People: M") | **Supported with a change** (to the rationale) | Keep the form, but change the reason. The Android docs recommend a quantity-neutral "Books: 1", and i18next needs nesting for two counts in one string. Drop "the parity test requires identical key sets": the documented route keeps per-language plural suffixes with a plural-aware check (Dify's `Intl.PluralRules` test, LibreChat's suffix stripping). |

---

## 1. Unknown email answered in constant time

**Ruling (Task 2 fix).** When no account matches the email, `findAccount` (`lib/auth/options.ts:33-37`) still runs `verifyPassword(password, UNKNOWN_ACCOUNT_HASH)`, a fixed cost-12 bcrypt hash (`lib/auth/password.ts`), then returns `null`. `__tests__/auth-password.test.ts:6-17` pins the hash's version and cost to `hashPassword`'s.

**Official sources**

- OWASP Authentication Cheat Sheet, "Authentication Responses" (local copy `tmp/b3-research/owasp-authn.md:148-190`):
  - "the processing time can be significantly different according to the case (success vs failure) allowing an attacker to mount a time-based attack".
  - On the "quick exit" pseudo-code: "if the user doesn't exist, the application will directly throw an error … the response time will be different for the same error, allowing the attacker to differentiate between a wrong username and a wrong password."
  - On the version that always hashes: it "will go through the same process no matter what the user or the password is, allowing the application to return in approximately the same response time."

**Reference projects**

- **Django** `django/django@ce285ce0` `django/contrib/auth/__init__.py:391-399`: `check_password_with_timing_attack_mitigation`, "otherwise runs the default password hasher to prevent user enumeration attacks (#20760)" (`get_user_model()().set_password(password)`). `ModelBackend.authenticate` (`django/contrib/auth/backends.py:67-79`) calls it, then `user_can_authenticate(user)`, the same order as spec §5 (password first, inactive refused after).
- **Spring Security** `spring-projects/spring-security@126f02bf` `core/.../dao/DaoAuthenticationProvider.java`: `USER_NOT_FOUND_PASSWORD` (:56), `userNotFoundEncodedPassword` (:67). On `UsernameNotFoundException` it calls `mitigateAgainstTimingAttack`, which runs `passwordEncoder.matches(presentedPassword, this.userNotFoundEncodedPassword)` (:113-116, :152-156). This is the repo's pattern exactly: a compare against a fixed stand-in hash.
- **Devise** `heartcombo/devise@05811fb8` `lib/devise/strategies/database_authenticatable.rb:19-22`: "In paranoid mode, hash the password even when a resource doesn't exist … the request is faster when a resource doesn't exist in the database if the password hashing algorithm is not called."
- **Better Auth** (TypeScript, used with Next.js) `better-auth/better-auth@f5569701` `packages/better-auth/src/api/routes/sign-in.ts:539-547`: "Hash password to prevent timing attacks from revealing valid email addresses".
- Contrast, two Next.js apps exit early: Cal.com `calcom/cal.com@54343aa6` `packages/features/auth/lib/next-auth-options.ts:164-167` (`if (!user) throw new Error(ErrorCode.IncorrectEmailPassword)`, and :170-172 even reveals a locked account), and Documenso `documenso/documenso@38ecb217` `packages/auth/server/routes/email-password.ts:114-118`. Neither is a precedent against OWASP; they simply omit the mitigation.

**Verdict: supported.** A compare against a well-formed hash of the same cost is the Spring Security pattern and does the same work as Django's or Better Auth's extra hash. Spring computes its stand-in from the configured encoder. The repo hard-codes it and pins it with a test, which is equivalent.

---

## 2. Testing that a Server Action enforces admin rights, not only a session

**Ruling (Task 4).** `__tests__/group-management-actions.test.ts` mocks only `getServerSession`, so `requireAdmin` is real. `vi.mock('@/lib/data/groups', { spy: true })` puts spies over the real DAL, and the test asserts that a `user` or signed-out session gets `forbidden`/`unauthorized` and that the DAL spies are never called. This is ADR-0024 deviation 3: "a test fails if an action checks only the session". Without the spies, an action that checked only the session would still answer `forbidden` through the DAL's `assertAdmin`, and the test would pass.

**Official sources**

- Vitest 4 `vi.mock` docs (Context7 `/vitest-dev/vitest/v4.1.6`, `docs/api/vi.md`, "Spy Mode"): "When spy is true, Vitest automocks the module but does not override the implementation of exports, allowing you to assert that exported methods were called correctly while preserving their original behavior." Example: `vi.mock('./src/calculator.ts', { spy: true })` … `expect(calculator).toHaveBeenCalledWith(1, 2)`. The installed version is vitest 4.1.7.
- Next 16.3.4 bundled `02-guides/authentication.md:1461-1481`, "Server Actions": "Treat Server Actions with the same security considerations as public-facing API endpoints, and verify if the user is allowed to perform a mutation", with the example `if (userRole !== 'admin') { return null }` under "Return early if user is not authorized". The test pins exactly this early return before any DAL call.
- Next bundled `02-guides/data-security.md:339`: "A page-level authentication check does not extend to the Server Actions defined within it. Always re-verify inside the action". Also :370: "Beyond authentication … remember to check authorization". And :609: "Is the user re-authorized inside the action?"

**Reference projects**

- **Formbricks** `formbricks/formbricks@27ca48e2` `apps/web/modules/ee/role-management/actions.test.ts:152-159`: a Server Action test where a manager tries to demote an owner. It asserts `rejects.toThrow(OperationNotAllowedError)` and `expect(mocks.updateMembership).not.toHaveBeenCalled()`: a refused caller never reaches the write layer. Formbricks mocks its authorization helpers; this repo keeps the chain real, which is stricter.
- **Langfuse** `langfuse/langfuse@c106bb3d` `.agents/skills/backend-dev-guidelines/references/testing-guide.md:236-385`, describing `web/src/__tests__/server/automations-trpc.servertest.ts`. It builds a real next-auth `Session` with a lower role ("VIEWER can't create automations") and runs the real router's auth middleware. It expects `rejects.toThrow("User does not have access")`: only the session is substituted, as here.

**Verdict: supported.** The `spy` option is the documented Vitest route. The assertion pins Next's documented "return early" check inside the action, and two well-known projects test refusals the same way: a lower-role session, a real or near-real authorization chain, and the write layer asserted not called.

---

## 3. An access-controlled image with `Cache-Control: private, no-cache` and an ETag

**Ruling (Task 3).** `app/api/apps/[appId]/icon/route.ts` answers `private, no-cache` with a content ETag and a `304` on a match. The access rule runs before the ETag check, so a caller without a grant gets 404, never 304 (`__tests__/app-icon-route.test.ts:37-45`).

**Official sources**

- RFC 9111 §5.2.2.4 (`tmp/rulings-check/r3/rfc9111.txt`): "The no-cache response directive, in its unqualified form …, indicates that the response MUST NOT be used to satisfy any other request without forwarding it for validation and receiving a successful response".
- RFC 9111 §5.2.2.7: "The unqualified private response directive indicates that a shared cache MUST NOT store the response (i.e., the response is intended for a single user)."
- RFC 9110 §15.4.5: "The server generating a 304 response MUST generate any of the following header fields that would have been sent in a 200 (OK) response …: … ETag … Cache-Control". The route sends the same headers on 304.
- MDN `Cache-Control` (`mdn/content@fd0b11ad`, `files/en-us/web/http/reference/headers/cache-control/index.md`):
  - :131 and :137: "the response must be validated with the origin server before each reuse" and "If you want caches to always check for content updates while reusing stored content, `no-cache` is the directive to use."
  - :183: "You should add the `private` directive for user-personalized content, especially for responses received after login and for sessions managed via cookies."
  - :439-447: "Adding `no-cache` … so you can serve a fresh response every time — or if the client already has a new one, just respond `304 Not Modified`", and `max-age=0, must-revalidate` "is equivalent to `no-cache`".

**Reference projects**

- **GitLab** `gitlabhq/gitlabhq@0739b8bf` `app/controllers/concerns/uploads_actions.rb:54-67`: uploads default to `directives ||= { private: true, must_revalidate: true }` with `ttl ||= 0`, i.e. `max-age=0, private, must-revalidate`, which MDN calls equivalent to `no-cache`. Only an avatar URL versioned by `?v=updated_at` gets `expires_in 7.days`: a content-versioned URL, not an access-checked one.
- **LibreChat** `danny-avila/LibreChat@e1dfc104` `api/server/utils/staticCache.js:24-28`: images checked per request (`res.locals.privateImageCache`) get `'private, no-store'` plus `Vary: Cookie`. Authorized downloads get `'private, no-store'` too (`api/server/routes/files/files.js:440`). This is the stricter form, with no 304 savings.
- **Open WebUI** `open-webui/open-webui@8bd8b4f` `backend/open_webui/routers/models.py:775-855`: the model image checks `AccessGrants.has_access(...)` on every request ("Denied callers get the default image rather than an error, so model ids stay unprobeable") and sends an `ETag` built from `updated_at`.
- Contrast: **Grafana** `grafana/grafana@c80649e8` `pkg/api/avatar/avatar.go:73`: `"private, max-age=3600"` for Gravatar proxies that every signed-in user may see. A max-age fits when no per-viewer access rule exists.

**Verdict: supported.** `private, no-cache` with an ETag is the RFC's "validate before each reuse" form. GitLab uses its equivalent for access-checked uploads, LibreChat uses the stricter `no-store`, and Open WebUI checks access and sends an ETag on each request.

_Side note (outside the ruling)._ RFC 9110 §13.1.2: "A recipient MUST use the weak comparison function when comparing entity tags for If-None-Match", and the field may be a list or `*`. The route's exact string match fails safe: a `W/"…"` or list value gets a 200, never a wrong 304. It only loses a 304 if an intermediary weakens the ETag. If anyone touches the route again, a weak-comparison match is the documented form.

---

## 4. A locking read of the parent row inside the save transaction

**Ruling (M11, Task 6).** Inside `updateApp`'s transaction, first `SELECT … FOR UPDATE` the `dify_apps` row (Drizzle `.for('update')`, the `lockTarget`/`lockGroup` pattern). A missing row answers `not_found` and writes nothing. Otherwise a delete between `readAccess` and the transaction makes the grant insert fail with 1452, which would be misreported as `invalid_input` on `access`.

**Official sources**

- MySQL 8.4 "Locking Reads" (`tmp/b3-research/mysql84-locking-reads.md`):
  - :293: "If you query data and then insert or update related data within the same transaction, the regular `SELECT` statement does not give enough protection. Other transactions can update or delete the same rows you just queried."
  - :336-351: the parent/child example, "some other session could delete the parent row in the moment between your `SELECT` and your `INSERT`". Its remedy is a locking read of the parent.
  - :353: "`FOR SHARE` is not a good solution because if two users read the counter at the same time, at least one of them ends up in deadlock when it attempts to update the counter", followed by the `SELECT … FOR UPDATE; UPDATE …` form (:364-365).
- MySQL 8.4 "Locks Set by Different SQL Statements in InnoDB" (`mysql84-locks-set.md:443`): "If a FOREIGN KEY constraint is defined on a table, any insert … that requires the constraint condition to be checked sets shared record-level locks on the records that it looks at". Once the parent is locked, the grant inserts cannot race a delete.
- Drizzle 1.0.0-rc.3 `mysql-core/query-builders/select.d.ts:601-611`: `for(strength: LockStrength, …)` "specif[ies] a lock strength … See docs: https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html", where `LockStrength = 'update' | 'share'`.

**Reference projects**

- **Dify** `langgenius/dify@2b65f0e8` `api/services/agent/composer_service.py:2048-2050`: "All draft writers lock the parent before checking for an absent draft. Locking a draft query alone cannot serialize concurrent first writes." followed by `session.scalar(select(Agent.id).where(…, Agent.id == agent.id).with_for_update())`. Also `api/services/workflow_service.py:272-283`, `_get_draft_workflow_for_update`: "Return the app draft while holding its row lock for the caller's transaction."
- **Open WebUI** `open-webui/open-webui@8bd8b4f` `backend/open_webui/models/chats.py:722-730`: `session.get(Chat, id, populate_existing=True, with_for_update=…)`, then `if chat_item is None: return None` before the write. The shape is the same: lock the row, answer "not found" if it is gone, then write. The lock applies on PostgreSQL; SQLite has no `FOR UPDATE`.
- Contrast: Open WebUI `backend/open_webui/models/access_grants.py:443-478`, `set_access_grants`, replaces grants with delete and insert but holds no lock on the resource. Its grants have no foreign key to the resource (polymorphic `resource_id`), so a deleted resource leaves orphans instead of an FK error. The repo's foreign keys are why its error has to be told apart.

**Verdict: supported.** It is MySQL's documented remedy, Drizzle's documented API, and Dify's explicit "lock the parent before writing children" rule.

- **`update` strength is right:** the same transaction then updates the parent row. `FOR SHARE` followed by that `UPDATE` is the deadlock case the manual describes (:353).
- **Alternative considered, not preferred:** the transaction's `UPDATE dify_apps … WHERE id = ?` already takes the exclusive lock. Its `affectedRows` could signal "gone", but only because mysql2 sends `CLIENT_FOUND_ROWS` by default (`mysql2/lib/connection_config.js:227-230`; MySQL C API `mysql_affected_rows()`: "by default is the number of rows actually changed. If you specify the `CLIENT_FOUND_ROWS` flag … the number of rows 'found'"). That would rest on an implicit driver flag; the explicit locking read is clearer and matches `lockTarget`/`lockGroup`.

---

## 5. Server field errors on an antd Form field with `form.setFields`

**Ruling (M13, Tasks 5 and 6).** On `invalid_input` with `fieldErrors.memberIds` (group drawer) or `fieldErrors.access` (app drawer), the drawer puts a translated error on the picker with `form.setFields`. The precedent is `components/shell/change-password-modal.tsx:66-67`.

**Official sources**

- antd 6 Form docs (`https://ant.design/components/form.md`, local `tmp/rulings-check/antd-form.md.txt:3908`; also `antd doc Form`):
  - `setFields`: "Set fields status | (fields: FieldData[]) => void".
  - `FieldData` (:4110-4119): `errors` "Error messages | string[]", `name` "Field name path".
  - `onValuesChange`: "Trigger when value updated" (:3678).
  - `Form.Item` `rules`: "Rules for field validation" (:3734); `validateTrigger` defaults to `onChange` (:3741).
- antd's form engine `@rc-component/form@1.8.6`, installed, as the docs leave this case open:
  - On a user change, `Field` dispatches validation only `if (rules && rules.length)` (`lib/Field.js:544-553`).
  - `validateFields` skips a field "without rule" (`lib/hooks/useForm.js:790-793`).
  - Errors are reset only by `reset`, an external `setFieldsValue`, or a new `setFields` (`lib/Field.js:189-197, 199-208, 239-241`).
  - So an error set on a rule-less field stays visible after the admin changes the pick, and even after a save. The precedent works only because `currentPassword` has `rules`.
  - In the plan, `memberIds` (`plan:2304-2318`) and `['access','groupIds']`/`['access','userIds']` (`plan:3074-3099`) have no `rules`.

**Reference projects**

- **refine** `refinedev/refine@2352eb5b` `packages/antd/src/hooks/form/useForm.ts:172-231`: on a mutation error it first resets every field ("reset antd errors before setting new errors", `errors: undefined` for each name), then maps the server's `errors` per field, translating `{ key, message }` through i18n, and calls `form.setFields([...parsedErrors])`. It is the same mechanism, plus an explicit clear.
- **Ant Design Pro** `ant-design/ant-design-pro@24de7e34` `src/pages/user/login/index.tsx:243-246` (local `tmp/b3-research/antd-pro-login-index.tsx.txt`): an error that belongs to no single field ("wrong account or password") is a form-level `LoginMessage` alert, not a field error. That matches the rest of the drawers' handling (`groupErrorKey`/`appErrorKey` through `message.error`). Only the attributable picker error goes on the field.

**Verdict: supported with a change.** `setFields` with `FieldData.errors` is the documented API, and refine uses it for server validation. Change: clear the server error when that picker's value changes, because antd re-validates only fields with `rules`. The documented route is the Form's `onValuesChange` calling `form.setFields([{ name: <picker>, errors: [] }])` for the changed name. refine also clears all server errors before setting new ones. A pinning test of the clear belongs in the drawer's e2e case: re-pick and assert the error is gone.

---

## 6. A test-side wait for hydration before the first click

**Ruling (I3, Tasks 5–7).** `e2e/fixtures/hydration.ts` waits until the first `<time>` in the table has text. `ClientDateTime` (`components/admin/client-date-time.tsx`) renders its text only after its effect runs. `/group-management` gets a seeded group so the table shows one. Task 6 uses "the file's existing wait if it has one, else the helper".

**Official sources**

- Playwright docs "Navigations > Hydration" (`microsoft/playwright@b28411b1` `docs/src/navigations.md:103-121`): "if the button on a page is enabled, but the listeners have not yet been added, Playwright will do its job, but the click won't have any effect … The right fix for this issue is to make sure that all the interactive controls are disabled until after the hydration". The owner declined this product-side fix on 2026-10-08; CLAUDE.md records it.
- react.dev `hydrateRoot` (`reactjs/react.dev@046f17d0` `src/content/reference/react-dom/client/hydrateRoot.md:280-282`): "you can do a two-pass rendering. Components that render something different on the client can read a state variable like `isClient`, which you can set to `true` in an Effect". This is `ClientDateTime`'s documented mechanism, so its text is a hydration-only signal.
- react.dev `Suspense` (same commit, `Suspense.md:38`): "Selective Hydration … integrated with Suspense". A signal proves hydration of its own Suspense boundary, so the `<time>` must share a client tree and boundary with the control clicked. That holds for the users and groups pages, where table and buttons are one client component.
- Playwright "Assertions > expect.toPass" (`docs/src/test-assertions-js.md:256-265`): "You can retry blocks of code until they are passing successfully."

**Reference projects**

- **Next.js's own e2e harness** `vercel/next.js@6469906e` `test/lib/next-webdriver.ts:164-200` waits for `window.__NEXT_HYDRATED` after each navigation. That flag is set in a root `useEffect` only under the internal `__NEXT_TEST_MODE` (installed `next/dist/client/app-index.js:221-228`). It is an effect-driven signal like `ClientDateTime`'s, but undocumented and test-mode only, so not usable here (ADR-0002, ADR-0010).
- **Documenso** `documenso/documenso@38ecb217` `packages/app-tests/e2e/fixtures/hydration.ts:3-26`: a test-side `waitForHydration(page, selector)` under the same file name. It polls for React's internal `__reactFiber` keys ("React attaches internal fiber keys to DOM nodes during hydration"). The repo's signal relies on documented React behaviour instead of internals.
- **Payload** `payloadcms/payload@58fe7653` `test/__setup/e2e/patchPageMethods.ts:48-97` waits after every `goto`/`reload` for an app-set `window.__TANSTACK_HYDRATED__` marker. That is a product-side test switch, which ADR-0010 rules out here.

**Verdict: supported with a change.** A test-side wait on a hydration-only signal is what all three projects do. The repo's signal is the documented React two-pass render, with no internals and no test switch. Change: the helper cannot serve Task 6.

- **Why:** `/app-management` renders no `<time>`. Its columns are name, type, description, tags, status and actions (`components/admin/apps/app-management.tsx:40-109`), and `e2e/admin-apps.spec.ts` has no hydration wait. The helper would time out there.
- **Either:** give the helper its signal locator as a parameter and pick a hydration-only signal on each page.
- **Or:** on a page without one, wrap the first click and its visible outcome in `await expect(async () => { await control.click(); await expect(outcome).toBeVisible({ timeout: … }) }).toPass()` (Playwright `expect.toPass`). A click ignored before hydration is retried; this suits clicks that open something, not toggles.

---

## 7. A short menu label "Groups" while the heading reads "Group management"

**Ruling (I1).** `admin.menu_groups` = "Groups" and `admin_groups.title` = "Group management" (zh 群组 / 群组管理, ar المجموعات / إدارة المجموعات). The ruling cites spec §4.3 ("a 'Groups' entry") and the existing `admin_apps.title` beside `admin.menu_apps`.

**Facts in the repo**

- The two existing menu labels are "App management" and "User management" (`components/shell/admin-shell.tsx:12-15`, `locales/en/translation.json:239-240`).
- The users page heading is the menu key itself (`components/admin/users/user-management.tsx:167`, `t('admin.menu_users')`).
- `admin_apps.title` is "App configuration", not "App management" (`e2e/page-headers.spec.ts:8`). The repo already has one page whose heading differs from its menu label, and one where they match.
- With "Groups", the header would read "App management · User management · Groups".

**Official sources**

- antd 6 Menu docs (`https://ant.design/components/menu.md`): `overflowedIndicator` is "Customized the ellipsis icon when menu is collapsed horizontally". The FAQ (:1166-1173) says: "Menu will render fully item in flex layout and then collapse it"; the header's `.nav { flex: 1; min-width: 0 }` follows it. Overflowing items stay reachable under "…", so overflow is a look question, not a broken link.
- The desktop header shows from 768 px (`components/shell/app-header.module.css:42-53`), but the e2e desktop projects run at 1280 px (`playwright.config.ts:51,61`). A desktop e2e click does not show that the label fits at 768–1279 px.

**Reference projects**

- **Grafana** `grafana/grafana@c80649e8` `pkg/services/navtree/navtreeimpl/admin.go:127-151`: under "Users and access" the siblings are "Users", "Teams" and "Service accounts", all parallel short nouns, each with a `SubTitle`. The page renders the nav node's text as its heading (`public/app/core/components/Page/PageHeader.tsx:44`, `<h1>{navItem.text}</h1>`; the teams page uses `navId="teams"`, `public/app/features/teams/TeamList.tsx:304`).
- **Ant Design Pro** `ant-design/ant-design-pro@24de7e34`: the route `name` is the menu label (`config/routes.ts`, `src/locales/en-US/menu.ts:25` "Search Table"). `<PageContainer>` with no title "Automatically handles page title" from it (`src/pages/table-list/index.tsx:244`; ProComponents `site/components/page-container.en-US.md:11`), so menu text equals page title.
- **Dify** `langgenius/dify@2b65f0e8` `web/app/components/header/account-setting/index.tsx:92-96, 246-247`: the section heading is `activeItem?.title ?? activeItem?.name`, i.e. the nav label unless an item sets its own title. Nav "Members" gives the heading "Members" (`web/i18n/locales/en-US/navigation.json:37`).

**Verdict: supported with a change.** A heading key separate from the menu key is fine, and Dify allows one. But the three reference projects keep sibling menu labels parallel and, by default, use the menu text as the heading. Change: keep the three labels parallel, using one of these:

- **(a)** "Group management": matches its siblings and its own heading; the Grafana and Ant Design Pro default.
- **(b)** Shorten all three ("Apps", "Users", "Groups", Grafana's style), keep the long headings, and fix `/app-management`'s "App configuration" heading in the same cosmetic pass.

This is the owner's wording call. The overflow argument does not decide it: antd collapses into "…" by design, and the 1280 px test cannot show a fit at narrower desktop widths.

---

## 8. Western digits in literal Arabic strings

**Ruling (M6).** New Arabic strings keep the file's Western digits ("255", "8"). Dates and formatted numbers use `Intl` with `nu-arab` (`libs/format-date.ts`). This is recorded as deviation 7 in ADR-0027 against ADR-0005's headline "with Arabic-Indic digits"; ADR-0005 lists "Western digits in Arabic: rejected" under alternatives.

**Official sources**

- Unicode CLDR 48 (`unicode-org/cldr@release-48`, local `tmp/rulings-check/cldr/`):
  - `common/main/ar.xml:6099-6103`: `<defaultNumberingSystem>↑↑↑</defaultNumberingSystem>` (inherited from `root.xml:3475`, `latn`) and `<otherNumberingSystems><native>arab</native>`. Generic Arabic now defaults to Western digits; Arabic-Indic is the "native" system.
  - `ar_SA.xml:1378` and `ar_EG.xml:20`: `<defaultNumberingSystem>arab</defaultNumberingSystem>`.
  - `ar_AE.xml:50`: inherits `latn`.
- Checked on the installed Node 24.16 (ICU 78.3, CLDR 48.0):
  - `new Intl.NumberFormat('ar').resolvedOptions().numberingSystem` → `latn` ("255"); `ar-SA`/`ar-EG` → `arab` ("٢٥٥").
  - i18next's built-in formatter: `{{n, number}}` with `lng: 'ar'` → "255", and `{{n, number(numberingSystem: arab)}}` → "٢٥٥".
- i18next "Formatting" (`https://www.i18next.com/translation-function/formatting.md`): "Format numbers … inside translations with the built-in Intl-based formatters", with `"intlNumber": "Some {{val, number}}"` and options passed to `Intl.NumberFormat` (its `numberingSystem` option, per MDN).

**Reference projects** (literal digits in Arabic translation files)

- **LibreChat** `danny-avila/LibreChat@e1dfc104` `client/src/locales/ar/translation.json:72-73, 107-108`: "يجب ألا يزيد البريد الإلكتروني عن 120 حرفًا", "… على الأقل 8 أحرف". Western digits on 45 lines, Arabic-Indic on none.
- **Open WebUI** `open-webui/open-webui@8bd8b4f` `src/lib/i18n/locales/ar/translation.json:98-102`: "قبل 10 دقائق", "قبل 15 دقيقة". About 76 value lines with Western digits and none with Arabic-Indic, in `ar` and in `ar-BH`.
- **Dify** `langgenius/dify@2b65f0e8` `web/i18n/__tests__/plural-selector.spec.ts` expects ar-TN "يستخدمها 3 وكلاء" and "متأخر بـ 11 إصدارًا". Tunisian Arabic, a `latn` region in CLDR, so the weakest of the three.
- Mattermost ships no Arabic file at `4d94455a` (`webapp/channels/src/i18n/`).

**Verdict: supported with a change (to the record).** Western literal digits match CLDR's own default for generic `ar` and all three reference projects; none writes Arabic-Indic literals. The ruling is right to keep the file's style and to raise ADR-0005's headline with the owner. Changes to deviation 7's text:

- **(a)** Cite CLDR 48 (generic `ar` → `latn`, `arab` as native) as the official basis, not only "the file already does it", which R0 does not accept as a reason.
- **(b)** Say that interpolated counts are Western too: `{{total}}` in `admin_users.total`/`admin_apps.total` and the new tag's `{{groups}}`/`{{people}}`, since i18next interpolates a number as text.
- **(c)** State the documented route if the owner wants Arabic-Indic digits: format the numbers rather than hand-typing ٢٥٥. Interpolate the limits as values through i18next's `number` formatter with `numberingSystem: arab`, or pass `Intl` output built from `intlLocale(lang)`. Note that a bare `{{n, number}}` gives Western digits for `ar` under CLDR 48. This replaces "costs a digit sweep of the whole file".

---

## 9. No i18next plurals for the count tag

**Ruling (M8).** The apps-table tag reads "Groups: {{groups}} · People: {{people}}" instead of spec §4.4's "N groups · M people". The stated reason: plural suffixes differ per language (zh `_other` only, ar six forms), while `__tests__/i18n-locales.test.ts:27-28` requires identical key sets.

**Official sources**

- i18next "Plurals" (`https://www.i18next.com/translation-function/plurals.md`):
  - "the \_one, \_other and other CLDR suffixes per language", "streamlined with the one used in the Intl API".
  - Arabic needs `key_zero`, `key_one`, `key_two`, `key_few`, `key_many` and `key_other` ("Languages with multiple plurals").
  - "The variable name must be `count`", and "If you need multiple counts, take a look at nesting". A two-count string like "N groups · M people" needs two nested plural keys, not one.
  - `Intl.PluralRules` on Node 24: en `one,other`, zh `other`, ar `zero,one,two,few,many,other`.
- Android developer docs, "String resources > Quantity strings (plurals)" (`tmp/rulings-check/android-string-resource.md.txt:796`): "It's often possible to avoid quantity strings by using quantity-neutral formulations such as "Books: 1". This makes your life and your translators' lives easier, if it's an acceptable style for your application."
- ADR-0005 "Patterns to follow": "never name an interpolation variable `count`". The repo has deliberately had no plural keys so far, so adopting them is a pattern change that needs its own ADR. The repo's totals already use the quantity-neutral form ("Total users: {{total}}").

**Reference projects** (plurals across languages with a parity or usage check)

- **Dify** `langgenius/dify@2b65f0e8`: per-language suffixes. `web/i18n/locales/ar-TN/skill.json:220-225` has all six forms of `skillManagement.referenceCount`; `en-US/skill.json:204-205` and `zh-Hans/skill.json:204-205` have `_one` and `_other`. Its check, `web/i18n/__tests__/plural-selector.spec.ts:33-66`, resolves each key for counts covering every `Intl.PluralRules(locale).resolvedOptions().pluralCategories` entry and asserts `usedLng` is the locale and the exact key exists. It is a plural-aware parity test, not identical key sets.
- **Open WebUI** `open-webui/open-webui@8bd8b4f`: `ar/translation.json:20-25` has six forms of "{{count}} files", `en-US:16-17` two, `zh-CN:15-16` two. They are generated per locale by i18next-parser (`i18next-parser.config.ts`, `pluralSeparator: '_'`), so key sets differ across languages by design.
- **LibreChat** `danny-avila/LibreChat@e1dfc104` `scripts/i18n.mts:1-9`: the unused-key check folds plural families onto the base key: `key.replace(/(?:_ordinal)?_(zero|one|two|few|many|other)$/, '')` ("i18next selects cardinal and ordinal suffixes from the base key's count").
- **Mattermost** `mattermost/mattermost@4d94455a` `webapp/channels/src/i18n/en.json:1203`: `"{count, number} {count, plural, one {channel} other {channels}}"`. ICU MessageFormat keeps one key per message with every form inside, so key sets stay equal. i18next would need its `i18next-icu` plugin for that.

**Verdict: supported with a change (to the rationale).** The quantity-neutral form is documented good practice (Android), the repo already uses it for totals, and it avoids both nested two-count plurals and a pattern change to ADR-0005. The stated reason is not: the parity test is the repo's own, and the documented i18next route keeps per-language suffixes with a plural-aware check, as Dify and LibreChat show. Change deviation 8 in ADR-0027 to cite:

- **(a)** the Android quantity-neutral guidance and i18next's "multiple counts … nesting" note;
- **(b)** ADR-0005's no-`count` pattern;
- **(c)** the documented alternative if the owner wants spec §4.4's wording: i18next plural keys per language, nested for the two counts, with the parity test made plural-aware the way Dify's `Intl.PluralRules` test is. That needs an ADR-0005 note.

---

## Local copies

The local copies are under `tmp/rulings-check/`:

- `r1/`: Django, Devise, Spring Security, Better Auth, Cal.com, Documenso.
- `r2/`: Formbricks, Langfuse.
- `r3/`: RFC 9110, RFC 9111, MDN, GitLab, LibreChat, Open WebUI.
- `r5/`: refine and others.
- `r6/`: Playwright, react.dev, Next.js harness, Documenso, Payload, Cal.com tree.
- `r7/`: antd Menu, Grafana, Ant Design Pro, Dify.
- `cldr/`, `librechat/`, `openwebui/`, `dify/`, `mattermost/`.
- Pages: `i18next-plurals.md.txt`, `i18next-formatting.md.txt`, `android-string-resource.md.txt`, `antd-form.md.txt`, `antd-doc-form.md.txt`, `mysql84-c-api-affected-rows.md.txt`, `ctx7-*.md.txt`.

Earlier pages reused from `tmp/b3-research/`: `owasp-authn.md`, `mysql84-locking-reads.md`, `mysql84-locks-set.md`, `antd-pro-login-index.tsx.txt`, and the local clones under `src/`.
