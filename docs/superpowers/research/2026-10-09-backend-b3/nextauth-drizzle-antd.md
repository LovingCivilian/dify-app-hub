# B3 research: next-auth v4 providers and refusal codes, Drizzle constraints, MySQL 8.4, antd Tabs vs Segmented

Date: 2026-10-09. Repository: `fork/overhaul` at `e31b43761a31049dc14ea3aac62b1ca310bdc659` (cited below as `@e31b4376`), read-only. Installed versions checked: next-auth 4.24.15, drizzle-orm 1.0.0-rc.3, drizzle-kit 1.0.0-rc.3, antd 6.6.5, TypeScript 5.9.3. Evidence saved beside this file (all git-ignored): `v4page-*.md.txt` (crawled next-auth v4 pages), `ctx7-*.txt` (Context7 output), `drizzle-docs/` (Drizzle MySQL docs pinned to commit `236d7ea7`), `probe/` (drizzle-kit generate runs on throwaway `.mjs` schemas, outputs under `probe/out*`), `drizzle-kit-rc4-excerpt.txt`, `mysql84/` (crawled manual pages), `antd-doc-*.json.txt` and `antd-site-*.md.txt`, `antd-pro-login-index.tsx.txt` and `pro-components-login-form.tsx.txt` (reference login pages).

## Headline findings

1. **Several Credentials providers, each with its own `id`, are documented in v4.** `signIn('ldap', { redirect: false, ... })` posts to `/api/auth/callback/ldap` and type-checks with no type argument.
2. **A thrown `Error`'s message reaches the browser unchanged as `result.error`** (status 401, `ok: false`). A `null` gives the fixed code `CredentialsSignin`. v4 has no `CredentialsSignin` class; that is Auth.js v5.
3. **drizzle-kit 1.0.0-rc.3 bug (still in rc.4): a migration that creates exactly one new table loses that table's `ON DELETE` and `ON UPDATE` clauses.** The snapshot still records `CASCADE`, so a later `generate` will not notice. A migration that creates two or more tables, or adds an FK to an existing table, emits `ALTER TABLE … ADD CONSTRAINT … ON DELETE CASCADE` correctly. Reproduced in `probe/`.
4. **Three MySQL 8.4 rules affect the planned constraints:**
   - CHECK constraints are enforced, and a NULL result counts as a pass.
   - FK referential actions are not allowed on columns used in a CHECK.
   - Once a column is used in a CHECK, a later migration cannot modify it unless it drops the CHECK in the same statement.

   Also: a UNIQUE index allows several NULLs, and FK varchar columns need the same charset and collation on both sides.

5. **antd docs: Segmented fits an exclusive two-way switch, and Tabs "Normal Tabs" are "for functional aspects of a page".** Ant Design Pro's own login page (antd ^6.6.0) uses `<Tabs centered>` for exactly this account/mobile switch.

---

## A. next-auth v4: several Credentials providers, each with its own `id`

### What the v4 docs say

- Credentials provider page, "Multiple providers": "You can specify more than one credentials provider by specifying a unique `id` for each one. You can also use them in conjunction with other provider options. As with all providers, the order you specify them is the order they are displayed on the sign in page." The example uses `CredentialsProvider({ id: "domain-login", name: "Domain Account", … })` and `CredentialsProvider({ id: "intranet-credentials", name: "Two Factor Auth", … })`. Source: https://next-auth.js.org/providers/credentials#multiple-providers (crawled page `v4page-providers_credentials.md.txt` lines 169–214; same text in Context7 `/websites/next-auth_js`, snippet "Multiple Credentials Providers with Unique IDs", `ctx7-nextauth-v4-credentials.txt`).
- Credentials provider page, Options: "The **Credentials Provider** comes with a set of default options … You can override any of the options to suit your own use case." In the example config: "`credentials` is used to generate a form on the sign in page." (same URL, `#options` and `#example---username--password`).
- Client page: "By default, when calling the `signIn()` method with no arguments, you will be redirected to the NextAuth.js sign-in page. If you want to skip that and get redirected to your provider's page immediately, call the `signIn()` method with the provider's `id`." Also: "The redirect option is only available for `credentials` and `email` providers." with the example `signIn('credentials', { redirect: false, password: 'password' })`. Source: https://next-auth.js.org/getting-started/client#signin and `#using-the-redirect-false-option`.
- Pages page, "Credentials Sign in": "If you create a sign in form for credentials based authentication, you will need to pass a **csrfToken** from **/api/auth/csrf** in a POST request to **/api/auth/callback/credentials**." and "You can also use the `signIn()` function which will handle obtaining the CSRF token for you: `signIn("credentials", { username: "jsmith", password: "1234" })`". Source: https://next-auth.js.org/configuration/pages#credentials-sign-in

### What the installed source does (next-auth 4.24.15)

- **Default id and override.** `node_modules/next-auth/src/providers/credentials.ts:34-45` returns `id: "credentials"` plus the user `options`. `node_modules/next-auth/core/lib/providers.js:29-34` does `const id = userOptions?.id ?? rest.id` and derives `signinUrl`/`callbackUrl` from that id. Lines 38–40 then pick the provider by `id === providerId`, where `providerId` is the URL segment. A user-supplied `id: 'ldap'` therefore replaces `credentials`.
- **Providers endpoint.** `src/core/routes/providers.ts:22-27` keys `/api/auth/providers` by `id`.
- **`signIn(id, …)`.** In `src/react/index.tsx:228-248` (compiled `react/index.js:203-222`):
  - It fetches the providers.
  - An unknown id sends the whole page to `/api/auth/signin?callbackUrl=…`.
  - Otherwise `isCredentials = providers[provider].type === "credentials"`, and it POSTs to `${baseUrl}/callback/${provider}`.

  The `redirect: false` branch keys on the provider **type**, not on the literal id, so `signIn('ldap', { redirect: false })` returns the response object.

- **What `authorize` receives.** `src/core/routes/callback.ts:327-337` sets `const credentials = body` and passes it to `authorize`. That is the whole POST body: the form fields plus `csrfToken`, `callbackUrl`, `json` and any other `signIn` options, since `react/index.tsx:258-263` spreads `...options`. The provider's `credentials` field map does not filter the body. It only drives the built-in page and the `authorize` parameter type (`src/providers/credentials.ts:12-21`).
- **Which provider signed the user in.** `callback.ts:358-363` builds `account = { providerAccountId: user.id, type: "credentials", provider: provider.id }` before the `signIn` and `jwt` callbacks. The `jwt` callback can therefore tell `ldap` from `credentials` at sign-in.
- **`pages.signIn`.** `src/core/index.ts:187-195`: a GET `/api/auth/signin` redirects to `pages.signIn?callbackUrl=…[&error=…]`. Lines 222–239: a GET `/api/auth/error?error=CredentialsSignin` redirects to `/api/auth/signin?error=…`, and from there to `pages.signIn`. With `redirect: false` the client never follows these redirects. So `pages.signIn: '/login'` (`lib/auth/options.ts@e31b4376`) only matters for navigations, and one login page can serve both providers.
- **Types.** `node_modules/next-auth/react/index.d.ts:71` declares `signIn<P extends RedirectableProviderType | undefined = undefined>(provider?: LiteralUnion<…>, …)`. An in-memory TypeScript program with the repo's `tsconfig.json` (TS 5.9.3, no file written) type-checked three calls: `signIn("credentials", { redirect: false })`, `signIn("ldap", { redirect: false })` and `signIn<"credentials">("ldap", …)`. All three gave `r?.error: string | null | undefined` with 0 diagnostics. As a sanity check, the same probe reports an error when one is planted. No explicit type argument is needed.
- **Proxy.** `lib/access.ts:9@e31b4376` lists `/api/auth` as a public prefix, so `/api/auth/callback/ldap` passes the deny-by-default proxy unchanged.
- **Repo today.** `lib/auth/options.ts@e31b4376` has one `CredentialsProvider({ name: 'credentials', … })` with no `id`, so its id is `credentials`. `components/auth/login-form.tsx:46@e31b4376` calls `signIn('credentials', { ...values, redirect: false })`.

**Verdict A: documented: yes.** Add `CredentialsProvider({ id: 'ldap', name: 'Directory account', credentials: { username, password }, authorize: authorizeLdap })` beside the existing provider. The existing `credentials` id can stay as is. The form calls `signIn(mode === 'ldap' ? 'ldap' : 'credentials', { ...values, redirect: false })`, and the `jwt` callback reads `account.provider` if it needs the source.

**Not confirmed:**

- The v4 docs show `redirect: false` only with the literal `'credentials'` id. That a custom id returns the response object comes from the installed source and the type probe, not from a docs sentence.
- The docs do not say that the whole POST body (`csrfToken`, `callbackUrl`, `json`) reaches `authorize`. This also comes from the source; parse it with zod and ignore the extra keys.

**Sources:** the next-auth.js.org URLs above; Context7 `/websites/next-auth_js`; `node_modules/next-auth/{src/providers/credentials.ts, core/lib/providers.js, src/core/routes/providers.ts, src/react/index.tsx, react/index.js, src/core/routes/callback.ts, src/core/index.ts, react/index.d.ts}`; `@e31b4376:lib/access.ts:9`, `lib/auth/options.ts`, `components/auth/login-form.tsx:46`.

---

## B. What reaches the client: `authorize` throws versus returns `null` (with `redirect: false`)

### Docs (v4)

- Credentials page: "If you return `null` then an error will be displayed advising the user to check their details." and "If you throw an Error, the user will be sent to the error page with the error message as a query parameter." (https://next-auth.js.org/providers/credentials#example---username--password)
- Client page, response of `signIn(…, { redirect: false })`: `error: string | undefined` ("Will be different error codes, depending on the type of error."), `status: number` ("HTTP status code, hints the kind of error that happened."), `ok: boolean`, and `url: string | null` ("`null` if there was an error"). (https://next-auth.js.org/getting-started/client#using-the-redirect-false-option)
- Pages page, "Error codes": "We purposefully restrict the returned error codes for increased security." Then: "**CredentialsSignin**: The `authorize` callback returned `null` in the Credentials provider. We don't recommend providing information about which part of the credentials were wrong, as it might be abused by malicious hackers." (https://next-auth.js.org/configuration/pages#error-codes)

### Installed source, end to end

1. **`null`.** `node_modules/next-auth/src/core/routes/callback.ts:338-347` (compiled `core/routes/callback.js:334-342`) returns `{ status: 401, redirect: "${url}/error?" + new URLSearchParams({ error: "CredentialsSignin", provider: provider.id }) }`.
2. **Throw.** `callback.ts:348-355` (compiled `callback.js:344-349`):
   ```js
   } catch (error) {
     return { status: 401, redirect: `${url}/error?error=${encodeURIComponent((error as Error).message)}`, cookies }
   }
   ```
3. **App Router handler.** `src/next/index.ts:100-109` (compiled `next/index.js:70-80`): when `body.json === "true"`, which `signIn` always sends (`react/index.tsx:262`), the redirect becomes `new Response(JSON.stringify({ url: redirect }), { status: internalResponse.status })`.
4. **Client.** `src/react/index.tsx:277-288` (compiled `react/index.js:267-282`):
   ```js
   const error = new URL(data.url).searchParams.get('error')
   if (res.ok) await __NEXTAUTH._getSession({ event: 'storage' })
   return { error, status: res.status, ok: res.ok, url: error ? null : data.url }
   ```

Result:

- **`authorize` throws `new Error('ldap_unreachable')`:** `result = { error: 'ldap_unreachable', status: 401, ok: false, url: null }`. This is the **thrown message itself**, URL-encoded and decoded back, not a fixed code. The repo already relies on this: `lib/auth/options.ts@e31b4376` throws `new Error('Default')`, and `components/auth/auth-failure.ts:138-139@e31b4376` maps any code other than `CredentialsSignin` to `auth.login_error`.
- **`authorize` returns `null`:** `result = { error: 'CredentialsSignin', status: 401, ok: false, url: null }`.

Two side paths, read from the source but not executed:

- If the **`signIn` callback** throws, `callback.ts:381-387` sends the message by the same route but with **no status**. The handler then answers 200, and the client returns `ok: true` with `error` set. If the callback returns `false`, the result is 403 `AccessDenied` (`callback.ts:372-377`). If it returns a string, that string becomes `data.url`, and the client's `new URL(data.url)` (`react/index.tsx:277`) needs it to be absolute.
- So refusal codes belong in `authorize`'s throw, not in the `signIn` callback.

### Is there a `CredentialsSignin` class in v4?

No.

- The installed `node_modules/next-auth/core/errors.d.ts` exports only `UnknownError`, `OAuthCallbackError`, `AccountNotLinkedError`, `MissingAPIRoute`, `MissingSecret`, `MissingAuthorize`, `MissingAdapter`, `MissingAdapterMethods`, `UnsupportedStrategy` and `InvalidCallbackUrl` (lines 6–49).
- `index.d.ts:1-5` re-exports no such class.
- In v4, `CredentialsSignin` exists only as a string: the `SignInErrorTypes` union in `core/pages/signin.d.ts:7`, and `callback.ts:342`.

The subclass with a custom `code` is Auth.js (v5) API. Context7 `/nextauthjs/next-auth`, source https://github.com/nextauthjs/next-auth/blob/main/docs/pages/getting-started/providers/credentials.mdx, shows `import NextAuth, { CredentialsSignin } from "next-auth"` with `class InvalidLoginError extends CredentialsSignin { code = "Invalid identifier or password" }`. It adds that "You will then receive that custom error code in the query parameters … for example `…?error=CredentialsSignin&code=Invalid+identifier+or+password`" (`ctx7-authjs-credentialssignin.txt`). Note the difference: v5 sends `error=CredentialsSignin` plus `code=…`, while v4 puts the thrown message in `error`.

### Caution for B3's specific codes

- The v4 docs advise against revealing which part of the credentials was wrong (quoted above).
- OWASP Authentication Cheat Sheet, "Authentication Responses": "an application must respond with a generic error message regardless of whether: The user ID or password was incorrect. The account does not exist. The account is locked or disabled." (https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#authentication-and-error-messages; local copy `owasp-authn.md:146-156`).

So two of the planned codes need a deliberate decision in the brainstorm:

- "account is deactivated" falls directly under OWASP's list.
- "a local account already uses this email" reveals that an account exists.

The defensible option is to return them only after the directory bind with the user's password has succeeded. That is a design choice, not a documented next-auth pattern. "Directory unreachable" reveals nothing about the account.

**Verdict B: documented: yes.** The docs say a thrown error's message goes "as a query parameter", and the source shows it reaches `result.error` verbatim with `redirect: false`. Use `throw new Error('<short-code>')` in `authorize` with a fixed, non-secret code set (never an LDAP or DB message), `null` for wrong credentials, and map each code in `auth-failure.ts`. Do not look for a `CredentialsSignin` class; it does not exist in v4.

**Not confirmed:**

- The two side paths (the `signIn` callback throwing gives `ok: true`; a relative string URL breaks `new URL`) are read from the source, not run in a browser.
- The v4 docs do not state in words that the thrown message is what `signIn` returns with `redirect: false`; only the source shows it.

**Sources:** the next-auth.js.org URLs above; `node_modules/next-auth/{src/core/routes/callback.ts:327-387, core/routes/callback.js:323-350, src/next/index.ts:72-112, next/index.js:55-83, src/react/index.tsx:212-289, react/index.js:200-285, core/errors.d.ts, index.d.ts, core/pages/signin.d.ts:7}`; Context7 `/nextauthjs/next-auth`; OWASP Authentication Cheat Sheet; `@e31b4376:lib/auth/options.ts`, `components/auth/auth-failure.ts:138-139`.

---

## C. Drizzle ORM 1.0.0-rc.3 and drizzle-kit 1.0.0-rc.3 (MySQL)

### The API exists in the installed version (`node_modules/drizzle-orm/mysql-core/*.d.ts`)

- **`.references()` with actions.** `columns/common.d.ts:11-26`: `interface ReferenceConfig { ref: () => MySqlColumn; actions: { onUpdate?: UpdateDeleteAction; onDelete?: UpdateDeleteAction } }` and `references(ref, actions?)`.
- **Action values.** `foreign-keys.d.ts`: `type UpdateDeleteAction = 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'`.
- **`foreignKey()` helper.** `foreign-keys.d.ts`: `foreignKey({ name?, columns, foreignColumns })` returns a `ForeignKeyBuilder` with `.onUpdate()` and `.onDelete()`.
- **Composite primary key.** `primary-keys.d.ts`: `primaryKey({ columns: [TColumn, ...TColumns] })`. The variadic form is marked `@deprecated`. **There is no `name` key in the MySQL type.**
- **`check()`.** `checks.d.ts`: `check(name: string, value: SQL): CheckBuilder`.
- **Indexes.** `indexes.d.ts`: `index(name)` and `uniqueIndex(name)`, each with `.on(...)`, `.using()`, `.algorithm()` and `.lock()`.
- **`mysqlEnum`.** `columns/enum.d.ts`: overloads for a tuple, a named tuple, an enum object and a named enum object.
- **Table extras.** `table.d.ts:14`: `MySqlTableExtraConfigValue = AnyIndexBuilder | CheckBuilder | ForeignKeyBuilder | PrimaryKeyBuilder | UniqueConstraintBuilder`. Return them as an array from the third `mysqlTable` argument, as the repo already does.

An in-memory type-check against the repo's tsconfig compiled one table using `.references(() => a.id, { onDelete: "cascade" })`, `primaryKey({ columns })`, `foreignKey({…}).onDelete("cascade")`, `uniqueIndex().on(nullableCol)`, `check("…", sql\`…\`)`and`mysqlEnum([...]).notNull()`. **There was exactly one diagnostic:** `primaryKey({ name: "named_pk", columns })`gave "No overload matches this call". Yet the MySQL docs page shows`primaryKey({ name: 'custom_name', columns: [...] })`. That is a docs/type mismatch; in MySQL the primary key is always named `PRIMARY` anyway.

### Docs (Drizzle MySQL pages, `drizzle-team/drizzle-orm-docs@236d7ea7`)

- **`src/content/docs/mysql/indexes-constraints.mdx`** (https://orm.drizzle.team/docs/mysql/indexes-constraints; local `drizzle-docs/mysql-indexes-constraints.mdx.txt`):
  - Check: "If you define a `CHECK` constraint on a table it can limit the values in certain columns based on values in other columns in the row." The example `check("age_check1", sql\`${table.age} > 21\`)`produces `` CONSTRAINT`age_check1` CHECK(`users`.`age` > 21) `` (lines 129–161).
  - Composite primary key: `primaryKey({ columns: [table.bookId, table.authorId] })` (lines 195–233).
  - Foreign key: `.references(() => user.id)` and a standalone `foreignKey({ columns, foreignColumns, name })` (lines 236–309).
  - Unique: "In MySQL, a `unique constraint` and a `unique index` are essentially the same thing … That is why Drizzle always treats any `.unique()` as `UNIQUE INDEX`" (lines 74–86).
  - Indexes: `uniqueIndex("email_idx").on(table.email)` (lines 311–335).
- **`mysql/relations.mdx`** lines 409–420: a junction table `users_to_groups` with `.references(() => users.id, { onDelete: "cascade" })`, `.references(() => groups.id, { onDelete: "cascade" })` and `p.primaryKey({ columns: [t.groupId, t.userId] })`. This is exactly B3's shape.
- **`mysql/column-types.mdx`**, "enum": `mysqlEnum(['unknown', 'known', 'popular'])` produces `` `popularity` enum('unknown','known','popular') ``.
- **`mysql/kit-custom-migrations.mdx`** (https://orm.drizzle.team/docs/mysql/kit-custom-migrations): "Drizzle lets you generate empty migration files to write your own custom SQL migrations for DDL alternations currently not supported by Drizzle Kit or data seeding, which you can then run with `drizzle-kit migrate` command." The command is `drizzle-kit generate --custom --name=seed-users`. The page also notes that JS/TS migrations are not supported yet.
- **`mysql/drizzle-kit-generate.mdx`**: the options table lists `custom` ("generate empty SQL for custom migration") and `name`. `breakpoints` defaults to `true`.
- **Installed CLI:** `node_modules/drizzle-kit/bin.cjs:232798` defines `custom: boolean().desc("Prepare empty migration file for custom SQL")`.
- **Repo precedent:** `@e31b4376:db/migrations/20261008130753_b2-users-role-backfill/migration.sql` (custom SQL with `--> statement-breakpoint` between statements, plus its `snapshot.json`).

### What drizzle-kit 1.0.0-rc.3 actually generates (probe)

Method: `drizzle-kit generate --dialect mysql --schema ./schema-*.mjs --out ./out*`, run from `tmp/b3-research/probe/`. There was no database and no repo config, and nothing was written under `db/`.

**1. One new table per migration (`probe/out/…_step3/migration.sql`)** loses the referential actions:

```sql
CREATE TABLE `user_groups` (
	`user_id` varchar(36) NOT NULL,
	`group_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`user_id`,`group_id`),
	CONSTRAINT `user_groups_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `user_groups_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`)
);
```

Both FKs were declared with cascade (`.references(..., { onDelete: 'cascade' })` and `foreignKey(...).onDelete('cascade')`), and the snapshot records `'onDelete': 'CASCADE'`. The emitted SQL has no `ON DELETE`, so MySQL applies its default `NO ACTION`.

The cause is in the code. `bin.cjs:80238-80240` (region `src/dialects/mysql/convertor.ts`, `createTable`) writes inline FKs without the actions. `bin.cjs:80489` and `:80567` (region `src/dialects/mysql/diff.ts`) send FKs through `create_fk`, which writes `ON DELETE`/`ON UPDATE` (`bin.cjs:80300-80305`), only when `createdTables.length >= 2` or the FK's table already exists. drizzle-kit **1.0.0-rc.4**, the current `rc` dist-tag, has the same code (`drizzle-kit-rc4-excerpt.txt`: bin.cjs:82038-82041 and :82290).

A GitHub issue search found no matching report. Queries used: `repo:drizzle-team/drizzle-orm is:issue mysql "CREATE TABLE" foreign key "ON DELETE"` and similar.

**2. Several new tables in one migration (`probe/out-all-at-once/…/migration.sql`)** keep the actions:

```sql
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE;
```

**3. ALTER on an existing `users` table (`probe/out-alter/…_step1/migration.sql`)**, B3's likely shape:

```sql
ALTER TABLE `users` MODIFY COLUMN `password` varchar(255);
ALTER TABLE `users` ADD `source` enum('local','ldap') DEFAULT 'local' NOT NULL;
ALTER TABLE `users` ADD `ldap_id` varchar(64);
CREATE UNIQUE INDEX `users_ldap_id_key` ON `users` (`ldap_id`);
ALTER TABLE `users` ADD CONSTRAINT `users_password_by_source` CHECK ((`users`.`source` = 'local' AND `users`.`password` IS NOT NULL) OR (`users`.`source` = 'ldap' AND `users`.`password` IS NULL));
```

So drizzle-kit **does** generate MySQL CHECK constraints, both in `CREATE TABLE` (`CONSTRAINT … CHECK(…)`) and as `ALTER TABLE … ADD CONSTRAINT … CHECK (…)`. It also generates the nullable unique index and the enum column.

**4. `--custom --name backfill`** produced `-- Custom SQL migration file, put your code below! --` plus a `snapshot.json`, the same layout as the repo's B2 back-fill folder.

**Verdict C: documented: yes.** Use `.references(() => users.id, { onDelete: 'cascade' })` or `foreignKey({...}).onDelete('cascade')`, `primaryKey({ columns: [...] })` without `name`, `check(name, sql\`…\`)`, `uniqueIndex(name).on(nullableCol)`, `mysqlEnum([...])`, and `drizzle-kit generate --custom --name=<x>`for the back-fill. **In the plan, review every generated`migration.sql`for`ON DELETE CASCADE`.\*\*

- If B3 creates its new tables in one `generate` run (two or more tables), the actions survive.
- If a migration creates a single new table with FKs, its SQL must be corrected, or the FK must be added in a later migration. Record this in an ADR note, since it touches a generated file.

**Not confirmed:**

- No live MySQL was used, so these are unverified:
  - Whether MySQL 8.4 accepts the table-qualified column names (`` `users`.`source` ``) that drizzle writes inside CHECK. The Drizzle MySQL docs show the same output, and the e2e suite's throwaway MySQL would show it at the first `pnpm test:e2e`.
  - Whether drizzle-kit's single-table output is the only place the actions get lost (for example, an FK added together with a new column through `add_column` was not probed).
- Whether the drizzle team knows of the rc.3/rc.4 FK-action loss: the issue search found nothing.
- The ordering inside a generated ALTER migration (MODIFY before ADD, CHECK last) was observed once and is not documented.

**Sources:** `node_modules/drizzle-orm/mysql-core/{foreign-keys,primary-keys,checks,indexes,table}.d.ts`, `columns/{common,enum}.d.ts`; `node_modules/drizzle-kit/bin.cjs:80209-80313, 80489, 80567, 232798`; drizzle-orm-docs `@236d7ea7` `src/content/docs/mysql/{indexes-constraints,relations,column-types,kit-custom-migrations,drizzle-kit-generate}.mdx`; Context7 `/drizzle-team/drizzle-orm-docs` (`ctx7-drizzle-constraints.txt`; it returned SQLite, PG and Cockroach pages only, so the MySQL pages were read from the repo); `probe/` outputs; `drizzle-kit-rc4-excerpt.txt`; `@e31b4376:db/migrations/20261008130753_b2-users-role-backfill/`.

---

## D. MySQL 8.4 Reference Manual

### CHECK constraints: https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html

- **Since 8.0.16.** From the 8.0 page (https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html): "Prior to MySQL 8.0.16, `CREATE TABLE` permits only the following limited version of table `CHECK` constraint syntax, which is parsed and ignored" and "As of MySQL 8.0.16, `CREATE TABLE` permits the core features of table and column `CHECK` constraints, for all storage engines."
- **Enforced by default.** "If omitted or specified as `ENFORCED`, the constraint is created and enforced."
- **NULL.** "_`expr`_ specifies the constraint condition as a boolean expression that must evaluate to `TRUE` or `UNKNOWN` (for `NULL` values) for each row of the table. If the condition evaluates to `FALSE`, it fails and a constraint violation occurs." This means `(source = 'local' AND password IS NOT NULL) OR (source = 'ldap' AND password IS NULL)` only holds while `source` is `NOT NULL`: a NULL `source` makes it UNKNOWN, which passes. `IS [NOT] NULL` never yields UNKNOWN.
- **Allowed expressions.** "Nongenerated and generated columns are permitted, except columns with the `AUTO_INCREMENT` attribute and columns in other tables." Subqueries, variables and stored functions are not permitted.
- **Interaction with FKs.** "Foreign key referential actions (`ON UPDATE`, `ON DELETE`) are prohibited on columns used in `CHECK` constraints. Likewise, `CHECK` constraints are prohibited on columns used in foreign key referential actions."
- **Names.** "`CHECK` constraint names must be unique per schema; no two tables in the same schema can share a `CHECK` constraint name." Prefix the name with the table name.
- **ALTER TABLE** (https://dev.mysql.com/doc/refman/8.4/en/alter-table.html): "If a table alteration causes a violation of an enforced `CHECK` constraint, an error occurs and the table is not modified." The listed cases include "Attempts to add an enforced `CHECK` constraint … for which existing rows violate the constraint condition" and "Attempts to modify, rename, or drop a column that is used in a `CHECK` constraint, unless that constraint is also dropped in the same statement."
  - Consequence 1: the back-fill must leave every row valid before the CHECK is added.
  - Consequence 2: any later drizzle-kit `MODIFY COLUMN` on `users.password` or `users.source` will fail while the CHECK exists, because drizzle-kit emits separate statements. Such a migration needs hand-written SQL.

### FOREIGN KEY with ON DELETE CASCADE: https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html

- **Engine.** "Parent and child tables must use the same storage engine, and they cannot be defined as temporary tables."
- **Column types.** "Corresponding columns in the foreign key and the referenced key must have similar data types. … The length of string types need not be the same. For nonbinary (character) string columns, the character set and collation must be the same."
- **Indexes.** "MySQL requires indexes on foreign keys and referenced keys … In the referencing table, there must be an index where the foreign key columns are listed as the _first_ columns in the same order. Such an index is created on the referencing table automatically if it does not exist."
- **CASCADE.** "`CASCADE`: Delete or update the row from the parent table and automatically delete or update the matching rows in the child table. Both `ON DELETE CASCADE` and `ON UPDATE CASCADE` are supported."
- **Default action.** "For an `ON DELETE` or `ON UPDATE` that is not specified, the default action is always `NO ACTION`." For InnoDB, `NO ACTION` "is equivalent to `RESTRICT`". This is why the drizzle-kit loss in C matters: deleting a user would be refused, not cascaded.
- **Triggers.** "Cascaded foreign key actions do not activate triggers."
- **Repo note.** The existing tables were created without an explicit charset or collation (`@e31b4376:db/migrations/20260522015811_init/migration.sql` uses `CREATE TABLE IF NOT EXISTS`, and `docker-compose.local.yml` / `docker-compose.e2e.yml` run `mysql:8.4` with no charset flags), so they use the database default. New tables created by the same migrations get the same default.

### UNIQUE index with several NULLs: https://dev.mysql.com/doc/refman/8.4/en/create-index.html

- "A `UNIQUE` index permits multiple `NULL` values for columns that can contain `NULL`."

### ENUM: https://dev.mysql.com/doc/refman/8.4/en/enum.html

- "If strict SQL mode is enabled, attempts to insert invalid `ENUM` values result in an error."
- "If an `ENUM` column is declared `NOT NULL`, its default value is the first element of the list of permitted values."

**Verdict D: documented: yes.** CHECK, FK `ON DELETE CASCADE` and a nullable UNIQUE column are all documented, enforced MySQL 8.4 features. Declare `source` `NOT NULL` so the CHECK cannot pass through UNKNOWN. Keep FK child and parent columns the same type and collation (`varchar(36)` on both sides). Put no referential actions on columns that a CHECK uses. Back-fill before the CHECK is added.

**Not confirmed:**

- The production database's actual charset and collation for `users.id`. A database created by upstream before this line may differ from the server default. Check `information_schema.COLUMNS` (`CHARACTER_SET_NAME`, `COLLATION_NAME`) on the owner's instance before the FK migration runs there.
- Table-qualified columns inside CHECK (see C).

**Sources:** the four 8.4 manual URLs above plus the 8.0 CHECK page (local copies in `mysql84/`); `@e31b4376:db/migrations/20260522015811_init/migration.sql`, `docker-compose.local.yml`, `docker-compose.e2e.yml`.

---

## E. antd 6: Tabs versus Segmented for "Local account" / "Directory account"

**antd CLI** (`antd doc Tabs --version 6.6.5`, `antd doc Segmented --version 6.6.5`; outputs in `antd-doc-tabs.json.txt` and `antd-doc-segmented.json.txt`; the same text is served at https://ant.design/components/tabs.md and https://ant.design/components/segmented.md, saved as `antd-site-*.md.txt`):

- **Tabs.** Description: "Tabs make it easy to explore and switch between different views." Group: Navigation. **When To Use:** "Ant Design has 3 types of Tabs for different situations.
  - Card Tabs: for managing too many closeable views.
  - Normal Tabs: for functional aspects of a page.
  - Radio.Button: for secondary tabs."
- **Segmented.** Description: "Display multiple options and allow users to select a single option." Group: Data Display. Available since `antd@4.20.0`. **When To Use:**
  - "When displaying multiple options and user can select a single option;
  - When switching the selected option, the content of the associated area changes."

**Reference projects (antd's own ecosystem):**

- Ant Design Pro's login page (https://github.com/ant-design/ant-design-pro/blob/24de7e34b8f035553cbe82639ee86292df71b14a/src/pages/user/login/index.tsx, lines 221–241; its `package.json` has `"antd": "^6.6.0"`) switches between "account" and "mobile" login with `<Tabs activeKey={type} onChange={setType} centered items={[{ key: 'account', label: … }, { key: 'mobile', label: … }]} />`, with label-only items and the form fields rendered conditionally below.
- ProComponents' LoginForm demo (https://github.com/ant-design/pro-components/blob/1c070b9b38a95da923262e609fc9e40fb5e732e3/demos/form/login-form/login-form.tsx, lines 51–58) does the same with `<Tabs centered activeKey={loginType} … />`.

**Verdict E: documented: both fit.**

- Segmented's "When To Use" describes this case word for word: one option out of several, and the associated area changes.
- Tabs' "Normal Tabs: for functional aspects of a page" also fits, and is what antd's own login templates use (`Tabs centered` with label-only `items` above one form).
- Use `Tabs centered` to follow the antd reference projects, or `Segmented block` to follow the docs' wording. The owner picks; neither is a workaround.

**Not confirmed:**

- Neither antd page names login-method switching explicitly. The Pro templates are practice, not docs.
- Accessibility differences (Tabs renders a tablist; Segmented's role was not checked in the installed source) were not compared.

**Sources:** `antd doc Tabs` / `antd doc Segmented` (antd CLI, version 6.6.5 data); https://ant.design/components/tabs.md, https://ant.design/components/segmented.md; the ant-design-pro and pro-components files at the commits above (located with `gh api search/code`).
