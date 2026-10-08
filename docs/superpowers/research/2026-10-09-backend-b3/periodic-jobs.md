# B3 research: running a periodic job (LDAP sync) for the self-hosted hub

Date: 2026-10-09. Branch read: `fork/overhaul` at `e31b4376` (read-only). Next.js 16.3.4 (`node_modules/next/package.json`), next-auth 4.24.15, drizzle-orm 1.0.0-rc.3, mysql2 3.24.3, tsx 4.22.4, image `node:22.21.1-alpine`.

The job: every N minutes or hours, bind to the directory with a service account, list the users, deactivate hub accounts whose entry is gone or disabled, refresh name, email and groups.

Contents: Q1 Next.js docs · Q2 reference projects · Q3 a TypeScript script from the image · Q4 MySQL mutual exclusion · Q5 Compose patterns · Q6 the on-request check · Comparison of options · Not confirmed · Pinned sources.

---

## Q1. What the bundled Next.js 16 docs say

Read locally under `node_modules/next/dist/docs/` (Next 16.3.4).

### `instrumentation.ts` `register()`

- When it runs, how often: "Then, export a `register` function in the file. This function will be called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests." (`01-app/02-guides/instrumentation.md:19`; same sentence in `01-app/03-api-reference/03-file-conventions/instrumentation.md:18`, which adds "`register` can be an async function.")
- Runtimes: "Next.js calls `register` in all environments, so it's important to conditionally import any code that doesn't support specific runtimes (e.g. Edge or Node.js). You can use the `NEXT_RUNTIME` environment variable to get the current environment" (`02-guides/instrumentation.md:72`), and "The `instrumentation.js` file works in both the Node.js and Edge runtime, however, you can use `process.env.NEXT_RUNTIME` to target a specific runtime." (`03-file-conventions/instrumentation.md:127`).
- Purpose as documented: "Instrumentation is the process of using code to integrate monitoring and logging tools into your application." (`02-guides/instrumentation.md`, opening line); the reference page: "The `instrumentation.js|ts` file is used to integrate observability tools into your application". The self-hosting guide adds one general line: "You can run code on server startup using the [`register` function](/docs/app/guides/instrumentation)." (`02-guides/self-hosting.md:83`).
- Not in the docs, seen in source (`node_modules/next/dist/esm/server/lib/router-utils/instrumentation-globals.external.js:21-25`, Next 16.3.4): `register` is skipped during `next build` ("// Ensure registerInstrumentation is not called in production build / if (process.env.NEXT_PHASE === 'phase-production-build') { return; }"), and the registration promise is cached per process (`ensureInstrumentationRegistered`, lines 50-55). `next-server.js:504-510` runs it in `prepareImpl()` (server start), `next-dev-server.js:485` does the same in `next dev`. Source behaviour, not a documented contract.

### `after()`

- "`after` allows you to schedule work to be executed after a response (or prerender) is finished. This is useful for tasks and other side effects that should not block the response, such as logging and analytics." (`03-api-reference/04-functions/after.md:6`). It can be used in Server Components, Server Functions, Route Handlers and Proxy.
- Duration: "`after` will run for the platform's default or configured max duration of your route." (`after.md:50`).
- Self-hosting: "[`after`] is fully supported when self-hosting with `next start`. When stopping the server, ensure a graceful shutdown by sending `SIGINT` or `SIGTERM` signals and waiting. The Next.js server will finish in-flight requests and execute any pending `after()` callbacks before exiting. Platforms should allow a configurable drain period (10-30 seconds is recommended) to ensure all background work completes." (`02-guides/self-hosting.md:297-299`). Platform table: Node.js server Yes, Docker container Yes.
- `after` is request-scoped: it extends a request, it does not schedule anything by time.

### Route Handlers as a triggered endpoint

- "Use Route Handlers to receive event notifications from third-party applications." with an example that rejects a request whose `token` query parameter differs from `process.env.REVALIDATE_SECRET_TOKEN` (`02-guides/backend-for-frontend.md:556-580`).
- Caveats (written for hosts that deploy handlers as lambdas): "Route Handlers cannot share data between requests." … "Long-running handlers may be terminated due to timeouts." (`backend-for-frontend.md:922-927`).
- Custom server, the only documented way to own the process: "it should only be used when the integrated router of Next.js can't meet your app requirements" and "When using standalone output mode, it does not trace custom server files. This mode outputs a separate minimal `server.js` file, instead. These cannot be used together." (`02-guides/custom-server.md:13-14`). The hub uses `output: 'standalone'`, so a custom server is out.

### Anything about cron

`grep -ril "cron\|setInterval\|schedul" node_modules/next/dist/docs` finds no guide on scheduled work. The only `cron` strings are:

- `node-cron` in the list of packages Next opts out of bundling automatically ("Next.js includes a short list of popular packages that currently are working on compatibility and automatically opt-ed out", `03-api-reference/05-config/01-next-config-js/serverExternalPackages.md:19,70`). This is a bundling note, not a pattern.
- A commented-out GitHub Actions `schedule: - cron: '0 2 * * *'` in a CI example (`03-api-reference/07-adapters/04-testing-adapters.md:19-20`).
- "background" appears only for ISR regeneration, `waitUntil` in Proxy and adapters (`ctx.waitUntil` "allowing background work like cache revalidation to complete", `07-adapters/07-runtime-integration.md:17`).

**Plainly: the Next.js 16 docs do not document running a scheduler (timers, cron) inside the Next server.** They document `register()` as startup code "called once when a new Next.js server instance is initiated", `after()` as post-response work tied to a request, and Route Handlers as endpoints a third party calls with a secret. A scheduler started from `register()` is a use the docs neither describe nor forbid. With several replicas, "once per server instance" means once per container, so N containers start N schedulers.

Multi-server notes in the same guide concern caches, the Server Functions key and the deployment id (`self-hosting.md`, "Multi-Server Deployments"); nothing about jobs.

---

## Q2. How reference projects on the same stack run periodic jobs

Two survey files hold every quote with its pinned path and lines: `q2-worker-projects.md` (Langfuse, Twenty, Homarr, Karakeep) and `q2-cron-projects.md` (Cal.com, Documenso, Formbricks, Dub, Papermark, and a GitHub search for schedulers in `instrumentation.ts`). The key citations below were re-checked against `raw.githubusercontent.com` at the pinned commits.

### Summary

| Project (pinned) | Stack | Mechanism | Duplicates across replicas | Docker shipping |
| --- | --- | --- | --- | --- |
| Formbricks `formbricks/formbricks@27ca48e29e45150e4582470e468a0e37a7c42d57` (13k stars) | Next.js | Since Sept 2025: BullMQ job schedulers registered and the worker started from `instrumentation.ts` `register()`. Before (`@0188aad97b6d9e68542e1437d131626f1902d0a7`): supercronic in the image ran `curl` against `/api/cron/*` with `x-api-key: $CRON_SECRET` | Redis: one scheduler per stable id (`upsertJobScheduler`), BullMQ hands a job to one worker; handlers still "must be idempotent and safe to overlap" | One web image; Redis/Valkey required in compose |
| Homarr `homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c` | Next.js | In-process `croner` schedules started from `instrumentation.ts` since v1.62 (PR #5600 "perf(memory): combine 3 node processes into one", merged 2026-05-01); up to v1.61.0 (`@4635c51fe1b47d1112ed4fdc64f526609dab8124`) `run.sh` backgrounded a separate tasks process | None across replicas; `global.cronJobs ??=` within one process | One image, one container |
| Rallly `lukevella/rallly@ac224fe84821b332a7fab1e31537a3989b53feb2` (5.3k stars) | Next.js | Self-hosted image: `instrumentation.ts` starts a 60 s `setInterval`; on Vercel the same work is a `CRON_SECRET` Bearer route called by Vercel Cron | Postgres `FOR UPDATE SKIP LOCKED` claims, an in-process "running" flag | Nothing extra |
| ZTNet `sinamics/ztnet@816c9e2b2ea2f5e7ec8c478edd2cfdfe78972514` (1.25k stars) | Next.js | `instrumentation.ts` starts `cron` `CronJob`s, one of them a daily "check expired users and deactivate them" | None; the update is idempotent (`isActive: true` → `false`) | Nothing extra |
| Cal.com `calcom/cal.com@54343aa685ae8f33159d2f485ec4a57bad5c574a` (renamed `calcom/cal.diy`, 49k stars) | Next.js | External cron calls secret-protected routes `/api/cron/*` and `/api/tasks/cron` (`authorization: CRON_API_KEY`, `?apiKey=`, or `Bearer ${CRON_SECRET}`); their cloud uses GitHub Actions `curl` and Vercel Cron | None in code (plain `findMany` batch); relies on one trigger | No scheduler in the image or compose; docs: set up cron "according to the hosting platform you are using" |
| Documenso `documenso/documenso@38ecb217effcc53a7164d7123c51336f636bd3b2` (15k stars) | React Router 7 + Hono (no longer Next.js) | Default `local` provider: a 30 s (+ jitter) in-process poller writes `BackgroundJob` rows and the app calls itself over signed HTTP; optional `bullmq` or `inngest` | Deterministic primary key per (job, slot): the second replica's insert fails on the key; then a guarded `PENDING → PROCESSING` update | One container; docs call `local` "not recommended for production workloads" and recommend BullMQ + Redis for self-hosted production |
| Langfuse `langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53` | Next.js web + Express worker | Separate worker image and service; BullMQ job schedulers | Redis schedulers; plus Postgres lock rows (background migrations: `workerId` + `lockedAt` heartbeat, 60 s stale rule; a `cron_jobs` lease row claimed by conditional update) | Two images, two compose services |
| Twenty `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4` | NestJS server + React front | Same image, `worker` service with `command: ["yarn", "worker:prod"]`; schedules registered by `cron:register:all` in the entrypoint | Registration only in `server` (`DISABLE_CRON_JOBS_REGISTRATION: "true"` on the worker), BullMQ upsert; a Postgres advisory lock inside at least one job | One image, two compose services; worker also sets `DISABLE_DB_MIGRATIONS: "true" # it already runs on the server` |
| Karakeep `karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea` | Next.js web + workers app | s6-overlay runs web and workers as two processes in one "aio" image; `node-cron` enqueues into a SQLite queue (liteque) | Unique `(queue, idempotencyKey)` with insert-or-ignore per feed per hour; compare-and-swap claim on `allocationId` | One image, one container |
| Dub `dubinc/dub@d1e47554a755b2e902dffb1efef4fbc33cd04913`, Papermark `mfts/papermark@ed19717ec02a1ac79aecf5569159aa9d2d869312` | Next.js | Hosted: Vercel Cron, Upstash QStash, Trigger.dev | Hosted | Dub's self-hosting guide deploys to Vercel and says to delete `vercel.json` "since cron jobs are not required for the self-hosted version" |

Not used: Infisical (Fastify backend), Plane (Django + Celery), Umami (no periodic jobs found) are off-stack or lack the feature; Dify (Celery beat) is cited in Q5 for the Compose shape only.

### Key quotes

- Formbricks, in-process by default (`docs/self-hosting/configuration/job-runner.mdx:7-9`, published at https://formbricks.com/docs/self-hosting/configuration/job-runner): "Formbricks starts the worker inside the web application by default, so a standard self-hosted deployment does not need a separate worker container." and (`:89-90`) "Each web replica starts its own in-process workers and connects to the same queue. BullMQ coordinates job claims so one available worker ordinarily processes a queued job." The start (`apps/web/instrumentation.ts:38-67`): `if (process.env.NEXT_RUNTIME === "nodejs") {` … `// Skip runtime-only BullMQ bootstrapping during production builds.` `if (process.env.NEXT_PHASE !== "phase-production-build") {` … `void registerRecurringJobs().catch(…)`.
- Homarr (`apps/nextjs/src/instrumentation.ts:1-7`): `if (process.env.NEXT_RUNTIME !== "nodejs") return;` `if (process.env.NODE_ENV !== "production") return;` then imports the tasks; PR #5600's reason: "Usage before: 600MB - 1GB", after "During idle between 200 and 300MB".
- Rallly (`apps/web/src/emails/queue.ts:77-84`): "Runs the queue every minute inside this server process, the same run the house-keeping cron triggers on Vercel. For long-lived servers only: `next dev` and the self-hosted image. A tick that finds the previous run still going is skipped, and the timer is kept on `globalThis` so a dev reload cannot start a second one. Several processes can each run one; claims do not overlap."
- Documenso (`packages/lib/jobs/client/local.ts:19-22`): "Build a deterministic BackgroundJob ID for a cron run so that multiple instances of the local provider racing to enqueue the same slot will collide on the primary key instead of creating duplicates."
- Twenty (`packages/twenty-docker/docker-compose.yml:65-76`): `worker:` `image: twentycrm/twenty:${TAG:-latest}` … `command: ["yarn", "worker:prod"]` … `DISABLE_DB_MIGRATIONS: "true" # it already runs on the server` / `DISABLE_CRON_JOBS_REGISTRATION: "true" # it already runs on the server`.
- Langfuse (`worker/src/backgroundMigrations/README.md:35-38`): "If the worker is killed for any reason, another worker will pick up the migration and continue where it left off after the lock expired."
- Cal.com self-hosting docs (`apps/docs/content/installation.mdx:72-80`, https://www.cal.diy/installation): "There are a few features which require cron job setup. When self-hosting, you would probably need to set up cron jobs according to the hosting platform you are using."
- GitHub Actions `schedule` (used by Cal.com's cloud): "The `schedule` event can be delayed during periods of high loads … some queued jobs may be dropped." and "The shortest interval you can run scheduled workflows is once every 5 minutes." (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

### What the survey shows

- The in-process scheduler started from `instrumentation.ts` `register()` is the most common shape among recent self-hosted Next.js projects (Formbricks, Homarr, Rallly, ZTNet; LobeHub was seen doing the same without analysis). Formbricks and Homarr both moved _to_ it (from supercronic + cron routes, and from a separate tasks process; Homarr for memory). They guard the runtime (`NEXT_RUNTIME === "nodejs"`) and the build (`NEXT_PHASE !== "phase-production-build"`), or skip outside production.
- Across replicas, those that care rely on Redis/BullMQ (Formbricks) or on a database claim (Rallly `SKIP LOCKED`, Documenso slot key); Homarr and ZTNet have no guard and rely on one instance or an idempotent job.
- The separate-worker shape belongs to projects with a queue broker (Langfuse, Twenty: BullMQ on Redis). Twenty shows the same-image, different-command form and the flags that keep the worker from re-running migrations and registrations.
- The external-cron-to-secret-route shape (Cal.com, old Formbricks, Rallly on Vercel) is the one that leaves the trigger to the operator; Cal.com's docs give self-hosters no concrete schedule.
- None of the projects uses MySQL for this; the database-claim patterns (lease row, slot key, advisory lock) map to MySQL as in Q4. Note from the cron survey: Rallly's single statement `UPDATE … WHERE id IN (SELECT … FROM same_table … FOR UPDATE SKIP LOCKED)` does not port to MySQL as written (MySQL 8.4 UPDATE: "You cannot update a table and select directly from the same table in a subquery.", https://dev.mysql.com/doc/refman/8.4/en/update.html).

---

## Q3. Running a TypeScript script from the same image, outside the Next server

### What the image holds today

Checked in a throwaway container of the local image `dify-app-hub-local-app:latest` (entrypoint overridden, nothing connected): Node `v22.21.1`; `/app` contains the sources (`lib/`, `db/`, `app/`, `tsconfig.json`), `server.js`, and the production `node_modules` from `pnpm deploy --prod` (`drizzle-orm`, `mysql2`, `tsx`, with `node_modules/.bin/tsx`). `server-only` is **not** resolvable: `import.meta.resolve('server-only')` gives `ERR_MODULE_NOT_FOUND`, in the image and in the checkout. Next resolves it through compiler aliases (`node_modules/next/dist/build/create-compiler-aliases.js:218-229`: on the server `'server-only$': 'next/dist/compiled/server-only/empty'`), so it never needs the package at run time; vitest aliases it to `__mocks__/empty.js` (`vitest.config.ts`).

Side finding: the image also contains `/app/tmp` (60 KB of an older research folder today), because `.dockerignore` does not exclude `tmp/`. The clones under `tmp/b3-research/src/` would go into the next build context and probably the image; delete them or add `tmp/` to `.dockerignore` before the next Docker build.

### Node 22 type stripping

Source: https://nodejs.org/docs/latest-v22.x/api/typescript.html (crawled 2026-10-09).

- History table: "v22.18.0 Type stripping is enabled by default." and "Type stripping no longer emits an experimental warning." Stability 1.2, release candidate. On 22.21.1 the entrypoint's `--experimental-strip-types` flag is therefore redundant but harmless.
- No tsconfig, no paths: "Node.js does not read `tsconfig.json` files and does not support features that depend on settings within `tsconfig.json`, such as paths or converting newer JavaScript syntax into older standards." and "Paths aliases: `tsconfig` "paths" won't be transformed and therefore produce an error. The closest feature available is subpath imports with the limitation that they need to start with `#`."
- Extensions: "As in JavaScript files, file extensions are mandatory in `import` statements and `import()` expressions: `import './file.ts'`, not `import './file'`."
- Type imports: "the `type` keyword is necessary to correctly strip type imports. Without the `type` keyword, Node.js will treat the import as a value import, which will result in a runtime error."
- Not supported without `--experimental-transform-types`: "`Enum` declarations", "`namespace` with runtime code", "parameter properties", "import aliases"; `.tsx` files are unsupported.
- "Node.js refuses to handle TypeScript files inside folders under a `node_modules` path."

Consequence for the hub: `db/migrate.ts` works under plain Node because it imports only `drizzle-orm` packages and reads `./db/migrations`. The app's own modules do not: `db/index.ts` imports `@/lib/env`, `db/schema/users.ts` imports `@/lib/auth/roles` and `@/lib/helpers`, `lib/data/users.ts` imports `@/db`, and `lib/env.ts`, `lib/data/*.ts`, `lib/auth/*.ts` begin with `import 'server-only'`. A script that reuses the DAL cannot run under plain `node`.

### `server-only` outside a React Server environment

The package Next vendors (`node_modules/next/dist/compiled/server-only/package.json`) is byte-for-byte the npm package (`https://unpkg.com/server-only@0.0.1/package.json`):

```json
"main": "index.js",
"exports": { ".": { "react-server": "./empty.js", "default": "./index.js" } }
```

`index.js` is `throw new Error("This module cannot be imported from a Client Component module. " + "It should only be used from a Server Component.");`, `empty.js` is empty. So, if the package were installed: in plain Node the `default` condition applies and the import throws; with `--conditions=react-server` the `react-server` condition matches and it resolves to the empty file. Node docs, "Resolving user conditions": "When running Node.js, custom user conditions can be added with the `--conditions` flag: `node --conditions=development index.js` which would then resolve the `"development"` condition in package imports and exports, while resolving the existing `"node"`, `"node-addons"`, `"default"`, `"import"`, and `"require"` conditions as appropriate." and "Condition strings other than the `"import"`, `"require"`, `"node"`, `"module-sync"`, `"node-addons"` and `"default"` conditions implemented in Node.js core are ignored by default." (https://nodejs.org/docs/latest-v22.x/api/packages.html#resolving-user-conditions, #community-conditions-definitions). `react-server` is not one of Node's listed community conditions; it is React's.

Next's docs on the package: "Next.js handles `server-only` imports internally. The contents of these packages from NPM are not used. However, if your linting rules flag extraneous dependencies, you may install them to avoid issues." (`01-app/02-guides/data-security.md:255`).

Two observations, not decisions: (1) `--conditions=react-server` is process-wide, so every package with a `react-server` export (React itself) would also resolve its server build; harmless for a script that imports no React, but a side effect. (2) The plain way out is structural: keep the sync's core (LDAP read, diff, writes through a `Db` handle) in modules without `server-only`, called from both the Next side and the script, and keep the `server-only` marker on the modules that read the session.

### `tsx` as the runner

- Node's own TypeScript page names it: "To use TypeScript with full support for all TypeScript features, including `tsconfig.json`, you can use a third-party package. These instructions use [`tsx`](https://tsx.is/) as an example" … "`npx tsx your-file.ts`" … "Or alternatively, you can run with `node` via: `node --import=tsx your-file.ts`" (https://nodejs.org/docs/latest-v22.x/api/typescript.html#full-typescript-support).
- tsx docs, pinned `privatenumber/tsx@4473971f4b3261de253209b148d8fdc43269fcc4`:
  - `docs/faq.md:235`: "**tsx**: Supports new JS & TS syntax and features based on Node.js version and includes support for `tsconfig.json` paths."
  - `docs/node-enhancement.md:5`: "`tsx` is a drop-in replacement for `node`, meaning you can use it the exact same way (supports all command-line flags)." (so `tsx --env-file … --conditions=react-server script.ts` is the documented form).
  - `docs/typescript.md`: "By default, `tsconfig.json` is detected from the current working directory." and "_tsx_ does not type check your code on its own and expects it to be handled separately."
  - `docs/faq.md:249-262`, "Can/should _tsx_ be used in production?": "Deciding whether to use _tsx_ in production depends on your specific needs and risk tolerance." … "_tsx_ uses esbuild for transforming TypeScript and ESM. Although esbuild is already adopted in many production ready tools, keep in mind that it technically hasn't reached a stable release yet." … "Ultimately, it's a decision you'll need to make based on your specific production requirements and comfort level with potential risks."
- In the image: `tsx` is a production dependency (`package.json`), present in `/app/node_modules` and `/app/node_modules/.bin/tsx`, and `/app/tsconfig.json` is there for the `@/*` paths.
- tsx is documented as a runner; its own FAQ leaves production use to the reader's risk judgement. `server-only` still has to be dealt with (installed and `--conditions=react-server`, or kept out of the script's import graph).

---

## Q4. Mutual exclusion in MySQL 8.4

### `GET_LOCK()` / `RELEASE_LOCK()`

MySQL 8.4 Reference Manual, 14.14 Locking Functions (https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html):

- "Tries to obtain a lock with a name given by the string `str`, using a timeout of `timeout` seconds. A negative `timeout` value means infinite timeout. The lock is exclusive. While held by one session, other sessions cannot obtain a lock of the same name."
- "Returns `1` if the lock was obtained successfully, `0` if the attempt timed out (for example, because another client has previously locked the name), or `NULL` if an error occurred".
- "A lock obtained with `GET_LOCK()` is released explicitly by executing `RELEASE_LOCK()` or implicitly when your session terminates (either normally or abnormally). Locks obtained with `GET_LOCK()` are not released when transactions commit or roll back."
- "It is even possible for a given session to acquire multiple locks for the same name. Other sessions cannot acquire a lock with that name until the acquiring session releases all its locks for the name."
- "MySQL enforces a maximum length on lock names of 64 characters."
- "`GET_LOCK()` can be used to implement application locks or to simulate record locks. Names are locked on a server-wide basis. … This enables clients that agree on a given lock name to use the name to perform cooperative advisory locking. … use lock names that are database-specific or application-specific. For example, use lock names of the form `db_name.str` or `app_name.str`."
- `RELEASE_LOCK(str)`: "Returns `1` if the lock was released, `0` if the lock was not established by this thread (in which case the lock is not released), and `NULL` if the named lock did not exist."
- "`GET_LOCK()` is unsafe for statement-based replication." and "Since `GET_LOCK()` establishes a lock only on a single **mysqld**, it is not suitable for use with NDB Cluster". The hub's single MySQL 8.4 server is fine.

Connection loss: the lock dies with the session ("implicitly when your session terminates (either normally or abnormally)"), so a crashed worker cannot leave a stale lock. The flip side: if the lock's connection drops mid-run (server restart, network), the lock is gone while the job still runs; another instance could then start.

### The pool caveat (mysql2 + Drizzle)

- `drizzle(connectionString)` creates a pool: `return construct(createPool({ uri: connectionString }), params[1]);` (`node_modules/drizzle-orm/mysql2/driver.js:33-35`), exposed as `db.$client` (line 23). The hub's `db/index.ts` uses that form.
- Plain queries take any pooled connection and give it back: "pool.query … Executes a SQL query using a connection from the pool. The connection is automatically released back to the pool once the query resolves." (mysql2 docs, https://sidorares.github.io/node-mysql2/docs, via Context7). So `db.execute(sql\`SELECT GET_LOCK(...)\`)`followed by`db.execute(sql\`SELECT RELEASE_LOCK(...)\`)`may run on two different connections: the release returns`0` ("not established by this thread") and the lock stays on an idle pooled connection until that connection closes.
- mysql2's `resetOnRelease` (default `false`) would reset a connection on release: "When set to `true` on a pool, every connection is automatically reset via `COM_RESET_CONNECTION` when it is released back to the pool." and its table lists "Locks (GET_LOCK) | Yes | All named locks released" (https://sidorares.github.io/node-mysql2/docs/documentation/reset-connection). The MySQL C API page confirms the reset "Releases locks acquired with `GET_LOCK()`" (https://dev.mysql.com/doc/c-api/8.4/en/mysql-reset-connection.html). Present in the installed 3.24.3 (`node_modules/mysql2/lib/pool_config.js:27-30`, `lib/base/pool.js:151`).
- Documented way to pin one connection: "const conn = await pool.getConnection(); … await conn.query(/_ ... _/); … pool.releaseConnection(conn);" or `conn.release()` (mysql2 docs, "Manually Acquire and Release Connection (Promise)"). Drizzle's own transactions do the same (`node_modules/drizzle-orm/mysql2/session.js:72-89`: `await this.client.getConnection()` … `finally { if (isPool(this.client)) session.client.release(); }`), but a transaction held open for a whole LDAP sync is a long transaction; the lock connection does not need one.
- So: take the lock on a dedicated `getConnection()` held for the run, do the work through the normal pool, release the lock on the same connection, then release the connection. While the job runs, that connection counts against the pool's `connectionLimit` (default 10, `maxIdle` defaults to it, `pool_config.js:15-23`).

### `SELECT … FOR UPDATE SKIP LOCKED` on a lock row

MySQL 8.4, 17.7.2.4 Locking Reads (https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html):

- "All locks set by `FOR SHARE` and `FOR UPDATE` queries are released when the transaction is committed or rolled back."
- "A locking read that uses `SKIP LOCKED` never waits to acquire a row lock. The query executes immediately, removing locked rows from the result set." and "Queries that skip locked rows return an inconsistent view of the data. `SKIP LOCKED` is therefore not suitable for general transactional work. However, it may be used to avoid lock contention when multiple sessions access the same queue-like table."
- "`NOWAIT` and `SKIP LOCKED` only apply to row-level locks." and are "unsafe for statement based replication".

Fit: the row lock lives only as long as the transaction, so this holds the lock for the run only if a transaction stays open for the whole run, on one connection (the same pinned-connection problem, plus a long-open transaction). It is the documented tool for a queue-like table of many jobs, not for one singleton job.

### A "last run" row with a conditional UPDATE

- "`UPDATE … WHERE …` sets an exclusive next-key lock on every record the search encounters. However, only an index record lock is required for statements that lock rows using a unique index to search for a unique row." (https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html).
- "The snapshot of the database state applies to `SELECT` statements within a transaction, not necessarily to DML statements." (https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html).
- "For `UPDATE` statements, the affected-rows value by default is the number of rows actually changed. If you specify the `CLIENT_FOUND_ROWS` flag … the affected-rows value is the number of rows "found"; that is, matched by the `WHERE` clause." (https://dev.mysql.com/doc/refman/8.4/en/information-functions.html, `ROW_COUNT()`). mysql2 sends `FOUND_ROWS` by default (`node_modules/mysql2/lib/connection_config.js:228-230`), so `affectedRows` counts matched rows; with the condition in the `WHERE` clause, matched means claimed.
- Pattern (described, not code): one row per job (`name` primary key, `locked_until`, `locked_by`, `last_success_at`); claim with `UPDATE … SET locked_by = ?, locked_until = NOW() + INTERVAL lease WHERE name = ? AND (locked_until IS NULL OR locked_until < NOW())` in autocommit; `affectedRows = 1` means this instance runs. Release by clearing `locked_until` where `locked_by` matches. The same row can carry "last run" so a run is skipped if the previous success is younger than the interval, which makes N schedulers behave like one schedule.
- Fit: works through the ordinary pool (no pinned connection), survives connection drops, is visible to the admin UI, and needs a table plus a lease length longer than the longest run (a crashed run blocks others until the lease expires). It is the only one of the three that also records history.

### A unique key per (job, time slot)

- "A `UNIQUE` index creates a constraint such that all values in the index must be distinct. An error occurs if you try to add a new row with a key value that matches an existing row." (https://dev.mysql.com/doc/refman/8.4/en/create-index.html).
- Pattern from Documenso (deterministic `BackgroundJob` id per cron slot, the losing replica gets the duplicate-key error and skips) and Karakeep (unique `(queue, idempotencyKey)` per hour, insert-or-ignore): every scheduler computes the current slot (for example the run's start rounded down to the interval) and inserts `(job, slot)`; only the instance whose insert succeeds runs. It guarantees one run per slot, not mutual exclusion: a run longer than the interval can overlap the next slot's run unless the claim also checks that the previous run finished.
- Fit: the simplest guard for "N in-process schedulers, one run per interval"; the rows double as a run log.

Reference projects use the same shapes (details in Q2): a Redis lock (Dify's `db_upgrade_lock`), BullMQ's scheduler ids, a Postgres lease row (Langfuse), a Postgres advisory lock (Twenty, the counterpart of `GET_LOCK`), a slot key (Documenso, Karakeep), `SKIP LOCKED` claims (Rallly), or a single scheduler process (Dify's `worker_beat`, Twenty's server-only registration). Celery's docs state the general rule: "You have to ensure only a single scheduler is running for a schedule at a time, otherwise you'd end up with duplicate tasks. Using a centralized approach means the schedule doesn't have to be synchronized, and the service can operate without using locks." (https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html). Vercel's cron docs make the same point for triggered routes: "If your cron job runs longer than the interval between invocations, Vercel can trigger a second instance while the first is still running." … "Use both locks (to prevent concurrent runs) and idempotent reconciliation (to handle duplicate or missed runs safely) for the most reliable cron jobs." (https://vercel.com/docs/cron-jobs/manage-cron-jobs#controlling-cron-job-concurrency). An LDAP reconciliation ("set state to what the directory says") is idempotent by nature.

---

## Q5. Docker Compose patterns for a scheduled task beside the web service

Docker docs, pinned `docker/docs@858251609b8884594fd1de29c51155bc3024b260`, `docker/compose@4e1cd3f4e1b25924a4d1f5a43aefe4c994cb90a2`.

### Second service from the same image with a different command (documented)

- One concern per container: "A container's main running process is the `ENTRYPOINT` and/or `CMD` at the end of the `Dockerfile`. It's best practice to separate areas of concern by using one service per container. That service may fork into multiple processes … It's ok to have multiple processes, but to get the most benefit out of Docker, avoid one container being responsible for multiple aspects of your overall application." (`content/manuals/engine/containers/multi-service_container.md`, https://docs.docker.com/engine/containers/multi-service_container/). The same page documents a wrapper script, bash job control and `supervisord` for when several processes must share one container.
- `command`: "`command` overrides the default command declared by the container image, for example by Dockerfile's `CMD`." and the note that it "doesn't automatically run within the context of the `SHELL` instruction" (https://docs.docker.com/reference/compose-file/services/#command).
- `entrypoint`: "This overrides the `ENTRYPOINT` instruction from the service's Dockerfile. If `entrypoint` is non-null, Compose ignores any default command from the image" (#entrypoint).
- `depends_on` conditions: "`service_healthy`: Specifies that a dependency is expected to be "healthy" (as indicated by `healthcheck`) before starting a dependent service." and "`service_completed_successfully`: Specifies that a dependency is expected to run to successful completion before starting a dependent service." (#depends_on).
- `restart`: "`unless-stopped`: The policy restarts the container irrespective of the exit code but stops restarting when the service is stopped or removed." (#restart).
- Hub-specific caveat: the image's `ENTRYPOINT` (`docker/entrypoint.sh`) runs `db/migrate.ts` before `exec "$@"`. A worker from the same image would run migrations too, and Drizzle's MySQL migrator takes no lock (`node_modules/drizzle-orm/mysql-core/dialect.js:34-67`: it reads `__drizzle_migrations`, then runs pending statements in a transaction; MySQL DDL commits implicitly), so two containers starting together can race. Documented ways around it: override `entrypoint` for the worker, or move migration into a one-shot service and give the app and worker `depends_on: … condition: service_completed_successfully`.
- Precedent on the production server itself: Dify 1.17.1's compose runs `api`, `worker` and `worker_beat` from the same image `langgenius/dify-api:1.17.1`, selected by `MODE` (`langgenius/dify@8387590ace4a094de812b7847fc6a4c3a27cd52b:docker/docker-compose.yaml:227-231,304-310,351-357`: "# worker_beat service / # Celery beat for scheduling periodic tasks. … image: langgenius/dify-api:1.17.1 … MODE: beat"); its entrypoint dispatches on `MODE` (`api/docker/entrypoint.sh:21,71-72`: `elif [[ "${MODE}" == "beat" ]]; then exec celery -A app.celery beat`). Every one of those containers runs migrations when `MIGRATION_ENABLED=true` (set in the shared env, `docker/envs/core-services/shared.env.example:17`), and Dify serialises that with a Redis lock (`api/commands/system.py:136-165`: `DbMigrationAutoRenewLock(… name="db_upgrade_lock" …)`, `if lock.acquire(blocking=False):` … `else: click.echo("Database migration skipped")`). Dify is Python, not this stack; it is cited for the Compose shape and the migration lock.

### One-off runs triggered from the host (documented commands, host cron is the OS's)

- `docker compose run`: "Runs a one-time command against a service." … "the command passed by `run` overrides the command defined in the service configuration" … "the `docker compose run` command does not create any of the ports specified in the service configuration." and "If you want to remove the container after running while overriding the container's restart policy, use the `--rm` flag: `docker compose run --rm web python manage.py db upgrade`" (`docker/compose:docs/reference/compose_run.md:4-52`). A host crontab line `docker compose -f … run --rm --no-deps <service> <command>` is therefore built from documented pieces; Docker documents no scheduler of its own. Note `run` also goes through the image's `ENTRYPOINT` (migrations) unless `--entrypoint` is given.
- `docker compose exec` runs a command in an already running container (`docs/reference/compose_exec.md`), e.g. `docker compose exec app node …` from host cron; it shares the web container's memory and lifetime.
- A host cron calling `curl` against a secret-protected Route Handler is the third host-side form; it needs the port reachable from the host (the hub publishes 5300) or a call from inside the Docker network.

### Scheduler containers (community tools, not Docker documentation)

- Ofelia (community, `mcuadros/ofelia@a573727aee28af0bf049c9b3a16d79a0523d9914`, ~4.0k stars): "**Ofelia** is a modern and low footprint job scheduler for **docker** environments, built on Go. Ofelia aims to be a replacement for the old fashioned cron." Job types: "`job-exec`: this job is executed inside of a running container. `job-run`: runs a command inside of a new container, using a specific image. `job-local`: runs the command inside of the host running ofelia." (`README.md:5,28-31`). Its compose example mounts `- /var/run/docker.sock:/var/run/docker.sock:ro` (`README.md:106`). Docker's security page on that socket: "only trusted users should be allowed to control your Docker daemon" (`content/manuals/engine/security/_index.md:88-89`); a container holding the socket can control the host's Docker.
- Supercronic (community, `aptible/supercronic@8e0a4a40090de8a22942c9fa573e27885ce18311`, ~2.7k stars): "Supercronic is a crontab-compatible job runner, designed specifically to run in containers." and, on overlap, "Supercronic will wait for a given job to finish before that job is scheduled again" (`README.md`, "Duplicate Jobs"). It would run inside a worker container (or a tiny sidecar that calls `curl`), with no Docker socket.
- Not found: an official Docker or Compose feature for scheduled services (Compose has no `schedule` key in the services reference).

---

## Q6. The complementary on-request check (next-auth v4)

next-auth v4 docs, Callbacks (https://next-auth.js.org/configuration/callbacks, crawled 2026-10-09; Context7 `/nextauthjs/docs` gives the same text):

- "This callback is called whenever a JSON Web Token is created (i.e. at sign in) or updated (i.e whenever a session is accessed in the client). The returned value will be encrypted, and it is stored in a cookie."
- "Requests to `/api/auth/signin`, `/api/auth/session` and calls to `getSession()`, `getServerSession()`, `useSession()` will invoke this function, but only if you are using a JWT session. This method is not invoked when you persist sessions in a database."
- "The arguments _user_, _account_, _profile_ and _isNewUser_ are only passed the first time this callback is called on a new session, after the user signs in. In subsequent calls, only `token` will be available."
- Session callback: "The session callback is called whenever a session is checked."

The `getToken()` helper does not run it: "You can use the built-in `getToken()` helper method to verify and decrypt the token" (https://next-auth.js.org/configuration/options#jwt-helper); in 4.24.15 `getToken` only decodes (`node_modules/next-auth/jwt/index.js`, the `_decode` call).

In the hub: `lib/auth/options.ts` `jwt` already reads `sessionVersion, role, email, name` for `token.id` on every call and strips `id`, `sessionVersion`, `role` when the row is gone or `sessionVersion` differs; `verifySession()` (`lib/auth/session.ts:38-44`, through `getServerSession`) then answers null. `verifySession()` guards the layouts, the pages, the actions, `lib/dify/route.ts:37` and `app/api/apps/[appId]/icon/route.ts:15`. The proxy (`proxy.ts`) uses `getToken`, so it stays optimistic. Consequence: a `deactivated` column (or a `sessionVersion` bump when the sync deactivates someone) read in the same `jwt` query ends that account's access at its next server check, without waiting for the JWT to expire and without a second query. The periodic job then only has to write the row; the on-request check enforces it. (Freshness is bounded by the sync interval: a directory change reaches the hub only when the job runs, or at the next LDAP sign-in.)

---

## Comparison of the options

|  | A. In-process scheduler in `instrumentation.ts` `register()` | B. External cron → secret-protected Route Handler | C. Worker service from the same image running a script | D. Job-queue library |
| --- | --- | --- | --- | --- |
| Documented by | Next documents `register()` as startup code run "once when a new Next.js server instance is initiated"; nothing documents timers or cron in it | Next: Route Handlers for webhooks with a secret (`backend-for-frontend.md:556`); `after()` drained on SIGTERM (`self-hosting.md:299`); Vercel's `CRON_SECRET` Bearer pattern; Node `crypto.timingSafeEqual` for the comparison | Docker: one service per container, Compose `command`/`entrypoint`/`depends_on`; Node + tsx docs for the runner; Dify's `worker_beat` on the same server | The library's docs (BullMQ needs Redis; Q2) |
| Reference projects | Formbricks (docs: "starts the worker inside the web application by default"), Homarr (moved here for memory), Rallly, ZTNet | Cal.com, Formbricks before Sept 2025 (supercronic + `curl` inside the image), Rallly on Vercel | Twenty (same image, `worker:prod`), Langfuse (own image), Karakeep and old Homarr (second process in the same container) | Langfuse, Twenty, Formbricks (BullMQ); Documenso (`local` DB queue, "not recommended for production") |
| Runs where | Inside every web process | Inside the web process that receives the call | Separate container, own memory and restarts | Separate worker, plus a broker |
| Duplicates with N replicas | N schedulers: needs a DB lock or last-run row (Q4) | One call reaches one replica; overlap still possible (retries, long runs): lock recommended | One worker replica = one schedule; lock as insurance | The queue's own dedupe |
| Reuses the DAL as is | Yes (bundled by Next, `@/` and `server-only` handled) | Yes | No: `@/` needs tsx; `server-only` must be installed + `--conditions=react-server`, or kept out of the job's imports | As C |
| Shutdown mid-run | Not covered by docs; the timer's run is cut | Work in `after()` is drained on SIGTERM (documented) | Container stop; idempotent reconciliation needed | Queue retries |
| Extra parts | None (a small scheduler lib or `setInterval`) | A trigger: host crontab, or a sidecar (supercronic/curl), or Ofelia (Docker socket); the route made public in `lib/access.ts` and checked by secret | A compose service; the migration race to solve (entrypoint override or one-shot migrate service) | Redis (the hub has none; Dify's Redis would couple the stacks) |
| Dev box (~5 GB) | No extra memory; also runs under `next dev` (start it only when configured) | No extra process if the host cron is used | A second Node process (size not measured) | Plus Redis |
| Fit now / later | Works on one server; for replicas it needs Q4's lock; least documented | Good: documented pieces, single trigger; needs the lock for overlap and a secret | Good: the Docker-documented shape, the one Dify uses next door; most moving parts in the image | Overkill for one job |

Reading of the evidence (for the brainstorm, not a decision):

- Docs vs practice. Only B and C are built entirely from documented pieces (Next's webhook Route Handler, Docker's service-per-container and Compose keys). A uses `register()` for something Next's docs do not describe, yet it is the shape the best-known recent self-hosted Next.js projects chose (Formbricks documents it for self-hosters; Homarr moved to it to cut memory from "600MB - 1GB" to "200 and 300MB" idle). Under ADR-0002 that makes A an "architectural decision the docs leave open, checked against reference projects" rather than a documented approach; B and C are documented.
- If A: guard with `NEXT_RUNTIME === 'nodejs'` (documented) and skip the build phase (Formbricks and Rallly check `NEXT_PHASE !== 'phase-production-build'`; Next 16.3.4's source already skips `register` then), decide whether it runs under `next dev` (Homarr: production only; Rallly: dev too, with a `globalThis` guard), keep the timer on `globalThis`, skip a tick while the previous run is still going, and claim each run in MySQL (Q4) for replicas.
- If B: the trigger is the operator's (host crontab, or a sidecar with supercronic/curl as Formbricks once shipped); the route must be exempt from the proxy's deny-by-default (`lib/access.ts`) and check a secret with `crypto.timingSafeEqual`; a long run belongs in `after()` (drained on SIGTERM per the self-hosting guide); overlap still needs Q4's claim.
- If C: the worker cannot import the `server-only` DAL as is (Q3), and the entrypoint's migration must be skipped for it (Twenty's `DISABLE_DB_MIGRATIONS`, or a Compose `entrypoint` override, or a one-shot migrate service with `service_completed_successfully`). One worker replica gives one schedule (Celery's "only a single scheduler" rule, Twenty's server-only registration).
- D needs Redis, which the hub does not run; every BullMQ user in the survey ships Redis as a required service. Out of proportion for one job.
- Whatever the shape, the job should be an idempotent reconciliation (Vercel's guidance; ZTNet's deactivation is idempotent by its `isActive: true` filter) and take a MySQL claim (Q4). Of the claims, `GET_LOCK` needs a pinned connection (`getConnection()`); the lease row or the slot key work through the pool and double as the run history the admin UI could show.
- Memory on the ~5 GB dev box and the 512 MB–1 GB hub limit in production: A and B add no process; C adds a second Node process (not measured; Homarr's PR is the only figure found, for three processes vs one).
- The on-request check (Q6) is independent of the choice and is what actually ends a removed person's sessions.

---

## Not confirmed

- Whether importing a `server-only` module from `instrumentation.ts` compiles under Turbopack in Next 16.3.4 (the webpack alias applies to server compilers; not tested, no build run).
- Whether `register()` runs again in `next dev` after edits to `instrumentation.ts` (dev restarts, HMR); not documented, not tested.
- How a scheduler started in `register()` behaves on SIGTERM in the standalone `server.js` (whether Next waits for or kills timers); the docs cover only in-flight requests and `after()` callbacks.
- The memory cost of a second Node process running tsx plus `ldapts` and mysql2 (not measured on this box).
- Which Dockerfile step puts `/app/tmp` into the image (the `pnpm deploy` output or the standalone copy) was not traced; the folder is there today and `.dockerignore` lacks `tmp/`.
- Q2 items marked "not confirmed" in the two survey files, notably: whether Langfuse's web container also upserts schedulers; whether two Homarr containers on one database run each task twice (likely from the code, undocumented); how Rallly's self-hosted image runs its non-email house-keeping jobs; the Formbricks release that first shipped the BullMQ runtime; the date Documenso left Next.js.
- GitHub code search is capped; other well-known projects may start schedulers from files not named `instrumentation.ts`.

## Pinned sources

- Next.js 16.3.4 bundled docs: `node_modules/next/dist/docs/01-app/02-guides/{instrumentation,self-hosting,backend-for-frontend,custom-server,data-security,production-checklist}.md`, `03-api-reference/03-file-conventions/{instrumentation,proxy}.md`, `03-api-reference/04-functions/after.md`, `03-api-reference/05-config/01-next-config-js/{serverExternalPackages,output}.md`, `03-api-reference/07-adapters/{04-testing-adapters,07-runtime-integration}.md`.
- Next.js 16.3.4 source: `node_modules/next/dist/esm/server/lib/router-utils/instrumentation-globals.external.js:21-55`, `esm/server/next-server.js:504-510`, `esm/server/dev/next-dev-server.js:485`, `dist/build/create-compiler-aliases.js:218-229`, `dist/compiled/server-only/{package.json,index.js,empty.js}`.
- Node.js 22 docs: https://nodejs.org/docs/latest-v22.x/api/typescript.html, https://nodejs.org/docs/latest-v22.x/api/packages.html#resolving-user-conditions, https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptotimingsafeequala-b (crawled 2026-10-09; copies in this folder).
- tsx: `privatenumber/tsx@4473971f4b3261de253209b148d8fdc43269fcc4` `docs/{faq,typescript,node-enhancement}.md` (tsx.is is blocked from this machine).
- server-only on npm: https://unpkg.com/server-only@0.0.1/package.json and `/index.js`.
- MySQL 8.4: https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html, …/innodb-locking-reads.html, …/innodb-locks-set.html, …/innodb-consistent-read.html, …/information-functions.html, https://dev.mysql.com/doc/c-api/8.4/en/mysql-reset-connection.html.
- mysql2: https://sidorares.github.io/node-mysql2/docs (Context7 `/websites/sidorares_github_io_node-mysql2`), https://sidorares.github.io/node-mysql2/docs/documentation/reset-connection; installed source `node_modules/mysql2/lib/{pool_config,connection_config}.js`, `lib/base/pool.js`.
- Drizzle 1.0.0-rc.3 installed source: `node_modules/drizzle-orm/mysql2/{driver,session,migrator}.js`, `mysql-core/dialect.js:34-67`.
- next-auth v4: https://next-auth.js.org/configuration/callbacks, https://next-auth.js.org/configuration/options#jwt-helper.
- Docker: `docker/docs@858251609b8884594fd1de29c51155bc3024b260` (`content/manuals/engine/containers/multi-service_container.md`, `content/reference/compose-file/services.md`, `content/manuals/engine/security/_index.md`), `docker/compose@4e1cd3f4e1b25924a4d1f5a43aefe4c994cb90a2` (`docs/reference/compose_run.md`, `compose_exec.md`).
- Community schedulers: `mcuadros/ofelia@a573727aee28af0bf049c9b3a16d79a0523d9914`, `aptible/supercronic@8e0a4a40090de8a22942c9fa573e27885ce18311`.
- Dify 1.17.1: `langgenius/dify@8387590ace4a094de812b7847fc6a4c3a27cd52b` (`docker/docker-compose.yaml`, `api/docker/entrypoint.sh`, `api/commands/system.py`, `docker/envs/core-services/shared.env.example`).
- Celery periodic tasks: https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html. Vercel cron: https://vercel.com/docs/cron-jobs/manage-cron-jobs.
- Q2 projects: pinned in the Q2 table; full citations in `q2-worker-projects.md` and `q2-cron-projects.md` (excerpts under `q2/` and `docs/` in this folder). Also `homarr-labs/homarr` tags `v1.77.2` (`18dafb1276d8ff66d1be1b149c74f80dbf94f78d`) and `v1.61.0` (`4635c51fe1b47d1112ed4fdc64f526609dab8124`), `karakeep-app/liteque@8ce63c873f83b759efcf05a6db0cf97695628670`, `lobehub/lobehub@d28985a7664271ec5258a222d38f5bb6e776a59d` (seen only).
- BullMQ job schedulers: https://docs.bullmq.io/guide/job-schedulers. GitHub Actions schedule: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule. MySQL 8.4 UPDATE and CREATE INDEX: https://dev.mysql.com/doc/refman/8.4/en/update.html, …/create-index.html.

## Housekeeping notes for the caller

- `tmp/b3-research/src/` holds other sessions' clones with about 2,400 `.ts` files today (`ldap-librechat` 2,006, `ldap-rocketchat` 382). The root `tsconfig.json` includes `**/*.ts` and excludes only `node_modules`, so `pnpm exec tsc --noEmit` will likely pick them up; and `.dockerignore` lacks `tmp/`, so the next Docker build would send them in the build context. Not touched here (not this session's files).
- This research added only `.md`, `.txt` and `.yaml` files under `tmp/b3-research/` (no `.ts`).
