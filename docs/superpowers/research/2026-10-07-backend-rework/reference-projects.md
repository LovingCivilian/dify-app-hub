# Reference projects and library documentation for the backend rework

Researched 2026-10-07 against the live repositories (GitHub trees API + raw files, commits noted per
project) and the current docs (Context7, next-auth.js.org, zod.dev, the Next.js docs bundled in
`node_modules/next/dist/docs`). Installed here: next ^16.3.4, next-auth 4.24.15, drizzle-orm and
drizzle-kit 1.0.0-rc.3, mysql2 ^3.24, React 19.2; **zod is not installed** (not in `package.json`,
no `node_modules/zod`).

The plan under review: a `lib/` server-only Data Access Layer + thin `'use server'` actions +
zod-validated input + DTOs.

## Reference projects

### 1. nextjs/saas-starter (Vercel) — `main` @ `6e33e58b`

https://github.com/nextjs/saas-starter. Stack: Next 15.6 canary, drizzle-orm ^0.43.1 + drizzle-kit
^0.31.1 on **Postgres** (`postgres` driver), zod ^3.24.4, no next-auth (own JWT cookie via `jose`),
shadcn UI, SWR.

Server-code layout:

- `lib/db/drizzle.ts` — `export const db = drizzle(client, { schema })` (0.43 API, `schema` option).
- `lib/db/schema.ts` — `pgTable`s, `relations()` (v1 API), and the types:
  `export type User = typeof users.$inferSelect; export type NewUser = typeof users.$inferInsert;`
  `role: varchar('role', { length: 20 }).notNull().default('member')` on `users`, `role` on `team_members`.
- `lib/db/queries.ts` — all reads/writes used by pages, actions and routes (`getUser`, `getTeamForUser`,
  `getUserWithTeam`, `getActivityLogs`, `updateTeamSubscription`). `getUser()` reads the `session` cookie,
  verifies the JWT, then `db.select().from(users).where(and(eq(users.id, …), isNull(users.deletedAt)))`.
- `lib/db/migrations/0000_*.sql` + `meta/` (drizzle-kit 0.31 layout), `lib/db/seed.ts`, `lib/db/setup.ts`.
- `lib/auth/session.ts` — `hashPassword`, `comparePasswords` (bcryptjs), `signToken`/`verifyToken` (jose
  HS256), `getSession`, `setSession` (httpOnly, secure, sameSite lax, 1 day).
- `lib/auth/middleware.ts` — the action wrappers (below). `lib/payments/actions.ts` — `'use server'`
  actions built with `withTeam`. `app/(login)/actions.ts` — the auth/team actions (459 lines, `'use server'`).
- `app/api/user/route.ts`, `app/api/team/route.ts` — two-liners: `return Response.json(await getUser())`.
- `middleware.ts` — redirects `/dashboard*` without a cookie, refreshes the JWT on GET, `runtime: 'nodejs'`.
- `drizzle.config.ts` — `{ schema: './lib/db/schema.ts', out: './lib/db/migrations', dialect: 'postgresql', dbCredentials: { url } } satisfies Config`.

Validation and action results (`lib/auth/middleware.ts`):

- `export type ActionState = { error?: string; success?: string; [key: string]: any }`.
- `validatedAction(schema, action)` returns `async (prevState: ActionState, formData: FormData) =>` which does
  `schema.safeParse(Object.fromEntries(formData))` and on failure `return { error: result.error.errors[0].message }`
  (Zod 3 `.errors`; one message, no per-field map), else `action(result.data, formData)`.
- `validatedActionWithUser(schema, action)` first does `const user = await getUser(); if (!user) throw new Error('User is not authenticated')`,
  then the same parse, then `action(data, formData, user)`.
- `withTeam(action)` — `redirect('/sign-in')` when no user, `throw new Error('Team not found')` when no team.
- Actions return the submitted values with the error so the form repopulates:
  `return { error: 'Invalid email or password. Please try again.', email, password }`; success as
  `{ success: 'Password updated successfully.' }`; navigation by `redirect('/dashboard')` (throws).
- Client: `app/(login)/login.tsx:18` `const [state, formAction, pending] = useActionState<ActionState, FormData>(mode === 'signin' ? signIn : signUp, { error: '' })`, renders `{state.error}`.

Session and roles:

- Actions and route handlers call `getUser()` (cookie + DB). Dashboard pages are client components that
  fetch `/api/user` and `/api/team` with SWR; the Route Handlers return the query result as-is.
- Roles exist in the schema (`inviteTeamMember` schema has `role: z.enum(['member', 'owner'])`) but no action
  checks them: `removeTeamMember` only scopes the delete to the caller's team
  (`and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, userWithTeam.teamId))`). Authorization is
  "same team", not "owner".
- Caution: `getUser()` returns the full row (including `passwordHash`) and `app/api/user/route.ts` does
  `Response.json(user)`, so the hash reaches the browser. This is the case the Next.js DTO guidance is about.

Agrees/differs: agrees on `lib/` queries + thin zod-wrapped actions + a typed `ActionState` consumed by
`useActionState`; differs in that there is no `server-only` marker, no DTOs (full rows out), actions live in
`app/(login)/actions.ts`, Zod 3, Postgres, and no role gate.

### 2. t3-oss/create-t3-app — `main` @ `4709861f` (generated template)

https://github.com/t3-oss/create-t3-app, files under `cli/template/`. Template versions
(`cli/src/installers/dependencyVersionMap.ts`, `cli/template/base/package.json`): next ^15.5.9,
**next-auth 5.0.0-beta.25 (Auth.js v5, not v4)**, @auth/drizzle-adapter ^1.7.2, drizzle-orm ^0.41.0,
drizzle-kit ^0.30.5, zod ^3.24.2, @t3-oss/env-nextjs ^0.12.0, tRPC.

`src/server/` layout (extras → generated names): `server/auth/index.ts` + `server/auth/config.ts`,
`server/db/index.ts` + `server/db/schema.ts`, `server/api/root.ts` + `server/api/trpc.ts` +
`server/api/routers/post.ts`; `src/env.js` at the src root; `drizzle.config.ts` at the project root.

- `extras/src/server/auth/index.ts`: `const { auth: uncachedAuth, handlers, signIn, signOut } = NextAuth(authConfig); const auth = cache(uncachedAuth);` (React `cache` around the session read; same idea as this repo's `lib/session-user.ts`).
- `extras/src/server/auth/config/with-drizzle.ts` holds the module augmentation **inside the config module** (a file with imports):
  `declare module "next-auth" { interface Session extends DefaultSession { user: { id: string; /* role: UserRole */ } & DefaultSession["user"] } }`
  (a commented `interface User { role: UserRole }` sits beside it), plus
  `callbacks: { session: ({ session, user }) => ({ ...session, user: { ...session.user, id: user.id } }) }` and `DrizzleAdapter(db, { usersTable, accountsTable, sessionsTable, verificationTokensTable })`.
- `extras/src/server/db/index-drizzle/with-mysql.ts`: `createPool({ uri: env.DATABASE_URL })` cached on `globalThis` outside production, then `drizzle(conn, { schema, mode: "default" })` (0.41 API).
- `extras/src/server/db/schema-drizzle/with-auth-mysql.ts`: `export const createTable = mysqlTableCreator((name) => \`project1_${name}\`)`; column-builder callback form `createTable("post", (d) => ({ id: d.bigint({ mode: "number" }).primaryKey().autoincrement(), … }), (t) => [index("created_by_idx").on(t.createdById)])`; `$defaultFn(() => crypto.randomUUID())`; `timestamp({ mode: "date", fsp: 3 })`; `relations()` (v1).
- `extras/config/drizzle-config-mysql.ts`: `{ schema: "./src/server/db/schema.ts", dialect: "mysql", dbCredentials: { url: env.DATABASE_URL }, tablesFilter: ["project1_*"] } satisfies Config` (no `out`, default `./drizzle`).
- `base/src/env.js`: `createEnv({ server: { NODE_ENV: z.enum(["development", "test", "production"]) }, client: {}, runtimeEnv: { NODE_ENV: process.env.NODE_ENV }, skipValidation: !!process.env.SKIP_ENV_VALIDATION, emptyStringAsUndefined: true })`; `extras/src/env/with-auth-db.js` adds `DATABASE_URL: z.string().url()` and the auth vars.
- `extras/src/server/api/trpc-app/with-auth-db.ts`: context `{ db, session: await auth() }`; `protectedProcedure` throws `new TRPCError({ code: "UNAUTHORIZED" })` when `!ctx.session?.user` and narrows `session.user` to non-null for the handler.

Agrees/differs: agrees on one server folder (`server/db`, `server/auth`), typed env, a cached session
reader and the augmentation co-located with the auth config; differs in tRPC procedures instead of Server
Actions, Auth.js v5, no DTO layer (routers return Drizzle rows).

### 3. vercel/platforms — `main` @ `ec12e657`

https://github.com/vercel/platforms. Next ^16.2.10, React 19.2, @upstash/redis; no auth, no zod.

- `lib/redis.ts` (client), `lib/subdomains.ts` (`isValidIcon`, `getSubdomainData`, `getAllSubdomains` — the reads, plain async functions, no `server-only`), `lib/utils.ts`.
- `app/actions.ts` — `'use server'` at the top, two exports with the `useActionState` signature
  `createSubdomainAction(prevState: any, formData: FormData)` / `deleteSubdomainAction(prevState: any, formData: FormData)`.
  Validation is hand-written (`if (!subdomain || !icon) return { success: false, error: '…' }`, regex sanitising) and
  returns `{ subdomain, icon, success: false, error }` so the form repopulates; `redirect(...)` on success;
  delete does `revalidatePath('/admin'); return { success: 'Domain deleted successfully' }`.
- `app/admin/page.tsx` — server component: `const tenants = await getAllSubdomains(); return <AdminDashboard tenants={tenants} />`.
  Contains `// TODO: You can add authentication here with your preferred auth provider`; the actions check nothing.
- `app/admin/dashboard.tsx` — `useActionState<DeleteState, FormData>(deleteSubdomainAction, …)`.
- `proxy.ts` (Next 16's replacement for `middleware.ts`) rewrites `<tenant>.<root>` to `/s/<tenant>`.

Agrees/differs: agrees on server page → `lib/` read → client component with `useActionState`, and
`app/actions.ts` as a thin file; differs in having no auth check, no schema validation and no DTOs.

### 4. langgenius/webapp-conversation (Dify) — `main` @ `33085b66`

https://github.com/langgenius/webapp-conversation. Next ^15.5.9, `dify-client` ^2.3.1; no auth, no zod.

- Routes: `app/api/chat-messages/route.ts`, `app/api/conversations/route.ts`,
  `app/api/conversations/[conversationId]/name/route.ts`, `app/api/file-upload/route.ts`,
  `app/api/messages/route.ts`, `app/api/messages/[messageId]/feedbacks/route.ts`, `app/api/parameters/route.ts`,
  helper `app/api/utils/common.ts`.
- `common.ts` confirmed: `getInfo(request)` → `sessionId = request.cookies.get('session_id')?.value || v4()`,
  `user = \`user_${APP_ID}:\` + sessionId`; `setSession(sessionId)` returns `{ 'Set-Cookie': \`session_id=${sessionId}\` }`
  (with `SameSite=None; Secure` when `APP_INFO.disable_session_same_site`); `export const client = new ChatClient(API_KEY, API_URL || undefined)`.
- Streams: `chat-messages` POST does `const body = await request.json()` (destructured, unvalidated), then
  `const res = await client.createChatMessage(inputs, query, user, responseMode, conversationId, files); return new Response(res.data as any)`
  — the axios response stream becomes the body with no status or header mapping.
- Errors: `conversations` GET `catch (error) { return NextResponse.json({ data: [], error: error.message }) }` (HTTP 200 with an
  `error` field); `file-upload` `catch (e) { return new Response(e.message) }` (200, text); `messages` GET has no try/catch.

Agrees/differs: confirms the cookie-session + `dify-client` proxy shape only; it is not a model for input
validation, auth or error mapping (errors are 200 bodies).

### 5. documenso/documenso — `main` @ `a166cabd` (optional, server-only data layer)

https://github.com/documenso/documenso, monorepo, **Prisma** (not Drizzle), tRPC. `packages/lib/server-only/<domain>/<verb-noun>.ts`
with 39 domains (`user`, `admin`, `team`, `organisation`, `document`, `auth`, …), one exported function per
file taking an options object:

- `server-only/user/get-user-by-id.ts`: `export const getUserById = async ({ id }: GetUserByIdOptions) => { const user = await prisma.user.findFirst({ where: { id }, select: { id: true, name: true, email: true, emailVerified: true, roles: true, disabled: true, twoFactorEnabled: true, signature: true } }); if (!user) throw new AppError(AppErrorCode.NOT_FOUND); return user; }` — narrow select, typed error.
- `server-only/user/update-profile.ts`: existence check, then `prisma.$transaction` writing a `userSecurityAuditLog` row and the update; takes `requestMetadata?: RequestMetadata`.
- `server-only/admin/update-user.ts`: `UpdateUserOptions = { id: number; name: string | null | undefined; email: string | undefined; roles: Role[] | undefined }`.
- Shared zod schemas/types in `packages/lib/types/*.ts` (`user-auth-method.ts`, `document.ts`, …). The files do not `import 'server-only'`; the folder name carries the convention and callers are tRPC routers.

Agrees/differs: agrees on a server-only layer of small option-object functions with narrow selects (DTO-shaped)
and typed domain errors; differs in Prisma + tRPC and a folder-name convention instead of the `server-only` package.

## Library documentation

### next-auth v4 (installed 4.24.15)

Sources: Context7 `/websites/next-auth_js`; https://next-auth.js.org/getting-started/typescript,
/configuration/nextjs, /configuration/callbacks, /providers/credentials, /tutorials/ldap-auth-example.

(a) Module augmentation. The docs put it in `types/next-auth.d.ts` ("Ensure the `types` folder is in your
`tsconfig.json`'s `typeRoots`"; this repo's tsconfig `include: ["**/*.ts", …]` already covers it). Documented shape:

```ts
import NextAuth, { DefaultSession } from "next-auth"
declare module "next-auth" {
  interface Session { user: { address: string } & DefaultSession["user"] }
}
import { JWT } from "next-auth/jwt"
declare module "next-auth/jwt" { interface JWT { idToken?: string } }
```

The docs example has an `import` at the top (a module file, which is what TypeScript calls augmentation);
"By default, TypeScript will merge new interface properties and overwrite existing ones", so `& DefaultSession["user"]`
is needed to keep `name`/`email`/`image`. The repo's `types/next-auth.d.ts` has no import/export (an ambient
declaration) and re-lists `name/email/image` by hand; it works but is not the documented form.

(b) `getServerSession`. App Router: `import { getServerSession } from "next-auth/next"; const session = await getServerSession(authOptions)`
("You can also use getServerSession in Next.js' server components"); the page lists "Route Handlers, React Server
Components, API routes or getServerSideProps" and recommends it over `getSession`. Server Actions are not named on the
page; the installed overloads are `[req, res, O] | [NextApiRequest, NextApiResponse, O] | [O] | []`
(`node_modules/next-auth/next/index.d.ts:19`), and the `[O]` form reads `cookies()`, which Server Actions share with
Route Handlers and RSC. Return type is inferred from `callbacks.session` (`R = O["callbacks"]["session"] return`),
`null` when not signed in. Docs tip: wrap it in an `auth()` helper so `authOptions` is not passed around (this repo:
`lib/session-user.ts` `getCachedServerSession = cache(() => getServerSession(authOptions))`). Caveat: "the `expires`
value is stripped away from `session` in Server Components".

(c) Custom field (`role`). `jwt` callback: "The arguments user, account, profile and isNewUser are only passed the
first time this callback is called"; docs pattern `async jwt({ token, account, profile }) { if (account) { token.accessToken = account.access_token; token.id = profile.id } return token }`
→ for Credentials: `if (user) token.role = user.role`. `session` callback: "If you want to make something available you
added to the token … you have to explicitly forward it here": `async session({ session, token }) { session.user.id = token.id; return session }`
→ `session.user.role = token.role`. With JWT sessions `jwt()` runs before `session()`. Add `role` to `User`, `JWT` and
`Session.user` in the augmentation file.

(d) LDAP. The v4 page "LDAP Authentication" exists (/tutorials/ldap-auth-example): "This requires an additional
dependency, `ldapjs`" (`pnpm add ldapjs`). Shape: `CredentialsProvider({ name: "LDAP", credentials: { username: { label: "DN", type: "text" }, password: { label: "Password", type: "password" } }, async authorize(credentials, req) { const client = ldap.createClient({ url: process.env.LDAP_URI }); return new Promise((resolve, reject) => { client.bind(credentials.username, credentials.password, (error) => error ? reject() : resolve({ username: credentials.username, password: credentials.password })) }) } })`
plus `jwt`/`session` callbacks copying `username`. The example uses `const ldap = require("ldapjs")`, creates a client
per login ("You might want to pull this call out") and copies the password into the token — treat it as the provider
shape only. Credentials docs: `authorize()` returns a user object, or `null` to show an error; throwing redirects to the
error page.

### Drizzle ORM (installed drizzle-orm 1.0.0-rc.3, drizzle-kit 1.0.0-rc.3)

Sources: Context7 `/drizzle-team/drizzle-orm-docs` (`src/content/docs/mysql/{rqb,relations-v1-v2,migrations,typebox-legacy}.mdx`),
installed `.d.ts` files under `node_modules/drizzle-orm`.

(a) `mysqlEnum`. Docs: `mysql.mysqlEnum('name', ['val1', 'val2'])`. Installed overloads
(`mysql-core/columns/enum.d.ts:43-46`): `mysqlEnum(values)`, `mysqlEnum(name, values)`, `mysqlEnum(enumObj)`,
`mysqlEnum(name, enumObj)` (TS enum objects accepted). Migration: `drizzle-kit generate` diffs the schema against the
last snapshot and writes `db/migrations/<timestamp>_<name>/{migration.sql,snapshot.json}` (the 1.0 folder-per-migration
layout, which this repo already uses, e.g. `20260904062910_concerned_tattoo/`); an enum column change becomes an
`ALTER TABLE … MODIFY` in `migration.sql`.

(b) Relational queries are **RQB v2** in 1.0 (`relations-v1-v2.mdx`): "`where` and `orderBy` now use object syntax,
`db._query` -> `db.query`":

```ts
// v1: db._query.users.findMany({ where: (users, { eq }) => eq(users.id, 1) })
// v2: db.query.users.findMany({ where: { id: 1 }, orderBy: { id: "asc" } })
```

`findFirst({ columns: { id: true, email: true }, where: { email } })` — `where` is `RelationsFilter`/`TableFilter`
(column fields, `OR`, `NOT`; `relations.d.ts:129,306`). Enablement is `relations`, not `schema`:
`export const relations = defineRelations(schema, (r) => ({ users: { posts: r.many.posts() }, posts: { author: r.one.users({ from: r.posts.authorId, to: r.users.id }) } }))`
then `const db = drizzle(process.env.DATABASE_URL, { relations })`. Installed types confirm it:
`MySqlDatabase<…, TRelations>.query: { [K in keyof TRelations]: RelationalQueryBuilder<…> }` (`mysql-core/db.d.ts:27`)
and **the mysql2 driver config omits `schema`**:
`type DrizzleMySqlConfig<TRelations> = Omit<DrizzleConfig<Record<string, never>, TRelations>, 'schema'>`
(`mysql-core/utils.d.ts:44`); `drizzle(...params: [string] | [string, DrizzleMySqlConfig] | [{ connection | client, … }])`
(`mysql2/driver.d.ts:21`). The 0.x `mode: "default" | "planetscale"` option (T3's template) is not in the 1.0 type
either. This repo's `db/index.ts` passes `{ schema, logger: true } as any`; the cast hides the removed key, and `db.query`
is typed over `EmptyRelations`, so relational queries do not type-check until a `defineRelations` object is passed.
Tables without relations still need `defineRelations(schema)` (one-argument overload, `relations.d.ts:360`) for `db.query`.

(c) `$inferSelect` / `$inferInsert`: `readonly $inferSelect: InferModelFromColumns<TColumns, 'select'>;
readonly $inferInsert: InferModelFromColumns<TColumns, 'insert', …>` (`table.d.ts:68-69`); `InferModel` is
`@deprecated Use … InferSelectModel / InferInsertModel, or table.$inferSelect / table.$inferInsert` (`table.d.ts:55`).
saas-starter: `export type User = typeof users.$inferSelect; export type NewUser = typeof users.$inferInsert`.

(d) Workflow: `drizzle-kit generate` ("1. read previous migration folders 2. find diff 3. prompt for renames 4. generate
SQL migration and persist to file") then `drizzle-kit migrate` (uses `dbCredentials`) or the programmatic
`migrate(db, { migrationsFolder })` from `drizzle-orm/mysql2/migrator` (this repo's `db/migrate.ts`, run by the container
entrypoint). Installed CLI: `generate, migrate, pull, push, studio, up, check, export` (`check` validates the migration
folder). The repo's `drizzle.config.ts` (`defineConfig({ dialect: 'mysql', schema: './db/schema/index.ts', out: './db/migrations', dbCredentials: { url } })`)
and `db:generate` / `db:migrate` scripts match the documented flow. What 1.0 changes versus the 0.x docs: folder-per-migration
output (already here), RQB v2 object filters, `defineRelations` replacing `relations()`, `schema` dropped from the
driver config, `drizzle(url)` string form.

### Zod (not installed; npm `latest` 4.6.5)

Sources: Context7 `/websites/zod_dev`; https://zod.dev/v4/changelog, /error-formatting, /api, /packages/zod;
npm registry metadata for `zod`.

(a) Current major is **4** (`latest` 4.6.5; `beta` 4.1.13-beta.0). Import: `import * as z from "zod"` (docs
style; `import { z } from "zod"` also resolves). Package `exports`: `.`, `./v3`, `./v4`, `./v4/core`, `./mini`,
`./v4-mini`, `./locales`. `zod/v4` is "the flagship library of the Zod ecosystem" and in 4.x is the same code as `zod`
(the subpath exists so libraries can pin a major; `zod/v4/core` is for library authors). The `z.core` namespace is
re-exported from `zod`.

(b) `safeParse` → `{ success: true, data: T } | { success: false, error: ZodError }`. Field messages:
`z.flattenError(result.error)` → `{ formErrors: string[], fieldErrors: { [key: string]: string[] } }` (flat schemas);
`z.treeifyError(result.error)` → `{ errors: string[], properties: { field: { errors } }, items }` (nested);
`z.prettifyError(result.error)` → string. Changelog: `.format()` and `.flatten()` on `ZodError` "deprecated. Instead use the
top-level z.treeifyError()"; `.formErrors` and `.errors` dropped (`.issues` is the array).

(c) `z.enum(["a", "b"])`; `z.object({...})` strips unknown keys; `.strict()` / `.passthrough()` are "legacy … still
available for backwards compatibility" — use `z.strictObject({...})` / `z.looseObject({...})`; `z.coerce.number()` etc.
now have input type `unknown`, and "A missing key on an object schema with a `z.coerce.*` field now errors
(`Invalid input: expected nonoptional, received undefined`). Use `.default()`". Messages: `z.string().min(5, { error: "Too short." })`;
`invalid_type_error` / `required_error` "have been dropped" (`message` still works, deprecated).

(d) The bundled Next.js `forms.md` (16.3.4) example is **Zod 3**: `z.string({ invalid_type_error: 'Invalid Email' })` and
`validatedFields.error.flatten().fieldErrors`. Zod 4 equivalents: `z.string({ error: 'Invalid Email' })` (or `z.email()`) and
`z.flattenError(validatedFields.error).fieldErrors`. The `useActionState` half (`(prevState, formData)` signature,
`{ errors }` / `{ message }` state) is current. saas-starter's `result.error.errors[0].message` is also Zod 3.

### Next.js 16 (installed ^16.3.4; `node_modules/next/dist/docs/01-app/…`)

(a) `RouteContext` (`03-api-reference/03-file-conventions/route.md:104-121`):
`export async function GET(_req: NextRequest, ctx: RouteContext<'/users/[id]'>) { const { id } = await ctx.params; return Response.json({ id }) }`
— "RouteContext is a globally available helper … Types are generated during `next dev`, `next build` or `next typegen`
… It doesn't need to be imported." `params` is a Promise. Typegen is also described in
`03-api-reference/05-config/02-typescript.md`, `03-api-reference/06-cli/next.md` and `02-guides/upgrading/version-16.md`.

(b) `server-only` (`01-getting-started/05-server-and-client-components.md:562-604`, `02-guides/data-security.md:243-270`):
`import 'server-only'` at the top of a server module; "installing `server-only` or `client-only` is **optional** …
Next.js handles `server-only` and `client-only` imports internally … The contents of these packages from NPM are not used
by Next.js … Next.js also provides its own type declarations for `server-only` and `client-only`" (install only if lint
flags the import). `data-security.md:52-60` recommends a Data Access Layer that should "Only run on the server. Perform
authorization checks. Return safe, minimal Data Transfer Objects (DTOs)", with `data/auth.ts`
`export const getCurrentUser = cache(async () => { … return new User(decodedToken.id) })` and `data/user-dto.tsx`
(`import 'server-only'`, `getProfileDTO(slug)` returning only the fields the viewer may see). This repo's
`lib/data/users.ts` already does `import 'server-only'` without the package — consistent with the docs.

(c) `useActionState` form (`02-guides/forms.md:134-274`): server `createUser(prevState, formData)` doing
`schema.safeParse({ email: formData.get('email') })` and `return { errors: … }` early; client
`const [state, formAction, pending] = useActionState(createUser, initialState)`, `<form action={formAction}>`,
`<p aria-live="polite">{state?.message}</p>`, `<button disabled={pending}>`. Zod API in the snippet is Zod 3 (see Zod (d)).

(d) `forbidden()` / `unauthorized()` (`03-api-reference/04-functions/forbidden.md`, `unauthorized.md`): both
`version: experimental`; need `experimental: { authInterrupts: true }` in `next.config.ts`;
`import { forbidden } from 'next/navigation'`; throws `NEXT_HTTP_ERROR_FALLBACK;403` (401 for `unauthorized`), renders
`forbidden.js` / `unauthorized.js`, "can be invoked in Server Components, Server Functions, and Route Handlers"; returns
`never`, must be awaited in the render path, `try/catch` swallows it (`unstable_rethrow`).

(e) Cache update after a mutation (`02-guides/server-actions.md:141-152` "Choosing a cache update",
`03-api-reference/04-functions/refresh.md`, `updateTag.md`, `revalidatePath.md`):
- `updateTag(tag)` — "immediate expiration of a tag … read-your-own-writes … Server Actions only"; tags come from
  `fetch(url, { next: { tags } })` or `cacheTag()` inside a `'use cache'` function.
- `revalidateTag` — stale-while-revalidate, "the action's own re-render does **not** wait for the new data".
- `revalidatePath(path)` — "invalidate by URL path. Use when one route is affected and tagging is overkill"; Good to know:
  in Server Functions "Updates the UI immediately (if viewing the affected path). Currently, it also causes all previously
  visited pages to refresh when navigated to again."
- `refresh()` (`import { refresh } from 'next/cache'`, `refresh(): void`, Server Actions only) — "refetch the current
  route's RSC Payload without invalidating cached data. Use when the view depends on state outside the cache that the action
  just changed"; `mutating-data.md:421`: "does not revalidate tagged data".
- "When `updateTag`, `revalidatePath`, or `refresh` runs, Next.js re-renders the current route server-side and includes a
  newly rendered RSC Payload in the action's response"; none of them throw (unlike `redirect`).
For a dynamic page that reads the database directly (no `fetch` caching, no `'use cache'`) there is no tag to expire:
`refresh()` is the documented fit (the DB is "state outside the cache"); `revalidatePath('/admin/…')` also re-renders and
additionally clears any cached segment for that path.

(f) `after()` (`03-api-reference/04-functions/after.md`): `import { after } from 'next/server'`; "schedule work to be
executed after a response (or prerender) is finished … tasks and other side effects that should not block the response,
such as logging and analytics"; usable in Server Components (including `generateMetadata`), Server Functions, Route
Handlers and Proxy; takes a callback (`after(() => { log() })`). Fits audit-log or Dify-sync work after an action returns.
