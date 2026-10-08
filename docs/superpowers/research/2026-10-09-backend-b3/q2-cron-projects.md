# Q2 — How well-known self-hosted Next.js projects run periodic jobs

Research date: 2026-10-09. Read-only: repositories were read via the GitHub API and `raw.githubusercontent.com` at pinned commits; nothing was cloned, installed or run. Excerpts are saved as `.txt` under `tmp/b3-research/q2/` (`calcom/`, `documenso/`, `formbricks/`, `dub/`, `papermark/`, `instr/`, `docs/`).

Context: a self-hosted Next.js 16 app (Docker, MySQL, one server now, maybe several replicas later) needs a job every N minutes (sync users from LDAP, deactivate accounts that are gone).

Citation format: `owner/repo@<full sha>:<path>:<lines>` plus a short exact quote, or a URL plus an exact quote.

## Summary

| Project | Framework now | Mechanism | Duplicate runs across replicas | What the Docker setup ships |
| --- | --- | --- | --- | --- |
| Cal.com (repo now `calcom/cal.diy`) | Next.js | External cron calls secret-protected routes (`/api/cron/*`, `/api/tasks/cron`); Cal.com's own cloud triggers them from GitHub Actions and Vercel Cron. A DB `Task` table is drained by `/api/tasks/cron`. | Nothing beyond a single trigger: the task batch is a plain `findMany` with no claim or lock; some routes check "already sent" rows. | No scheduler. Compose has database, redis, calcom, calcom-api, studio. The docs tell self-hosters to set up cron "according to the hosting platform you are using". |
| Documenso | React Router 7 on Hono (no longer Next.js) | Job provider chosen by env: `local` (default; PostgreSQL `BackgroundJob` table, an in-process 30 s poller for cron jobs, an HTTP self-call to `/api/jobs/...` signed with an encrypted hash of the payload), `bullmq` (Redis job schedulers) or `inngest` (hosted). | `local`: deterministic primary key per cron slot, so a second replica's insert fails with P2002; then a guarded `PENDING → PROCESSING` update. `bullmq`: `upsertJobScheduler` keyed by job id. | One image, one container; the poller starts at server boot. Compose has only `database` and `documenso`; the docs offer a Redis service for BullMQ. |
| Formbricks | Next.js | Since Sept 2025: BullMQ (Redis) job schedulers registered, and workers started, from `instrumentation.ts` `register()`. Before that: supercronic inside the image ran curl against `/api/cron/*` with an `x-api-key: $CRON_SECRET` header. | Redis-held schedulers (`upsertJobScheduler` with a stable id); BullMQ hands each job to one worker; handlers must still be "idempotent and safe to overlap". | Redis/Valkey is a required compose service; the worker runs inside the web container by default. |
| Dub | Next.js | Vercel Cron (25 paths in `vercel.json`) plus Upstash QStash. | Hosted schedulers; none in-app. | The self-hosting guide deploys to Vercel and says to delete `vercel.json` "since cron jobs are not required for the self-hosted version". |
| Papermark | Next.js | Trigger.dev for background tasks; cron routes verify Upstash QStash signatures. | Hosted schedulers. | Not checked. |
| Rallly (instrumentation hit, 5.3k stars) | Next.js | Vercel: Vercel Cron calls `/api/house-keeping/*` (Bearer `CRON_SECRET`). Self-hosted image: `instrumentation.ts` starts a 60 s `setInterval` that runs the same email-queue drain. | `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` claims rows, so overlapping runs take disjoint batches; an in-process "running" flag skips overlapping ticks. | Nothing extra: the scheduler lives in the web process. |
| ZTNet (instrumentation hit, 1.25k stars) | Next.js | `instrumentation.ts` starts `cron` package `CronJob`s, including a daily "check expired users and deactivate them". | None found: no lock; the query only selects `isActive: true` users. | Nothing extra: the scheduler lives in the web process. |

Docs that bear on these patterns (quoted in the last section): Next.js calls `register` "**once** when a new Next.js server instance is initiated", so N replicas start N in-process schedulers. Vercel says cron delivery "can also occasionally invoke the same scheduled run more than once". GitHub Actions `schedule` runs "can be delayed" and "some queued jobs may be dropped". BullMQ's `upsertJobScheduler` "ensures the scheduler is updated or created without duplications". MySQL 8.4 supports `FOR UPDATE SKIP LOCKED` and `GET_LOCK()`.

---

## 1. Cal.com

- Pinned: `calcom/cal.com@54343aa685ae8f33159d2f485ec4a57bad5c574a` (default branch `main`, 48,919 stars). `gh api repos/calcom/cal.com` now answers with `"full_name":"calcom/cal.diy"`: the repository was renamed and the old name redirects. Paths below are in that repository.
- `calcom/docker@4d6a0c425e958e9255c33d872c4975975fe4b074` is archived (`"archived":true`).

### Mechanism: an external cron calls secret-protected routes

**Route authentication. There are two schemes.**

- Legacy `CRON_API_KEY`, sent raw in the `authorization` header or as an `apiKey` query parameter:
  - `calcom/cal.com@54343aa685ae8f33159d2f485ec4a57bad5c574a:apps/web/app/api/cron/bookingReminder/route.ts:17-21`: `const apiKey = request.headers.get("authorization") || request.nextUrl.searchParams.get("apiKey");` … `if (process.env.CRON_API_KEY !== apiKey) {` … `{ status: 401 }`
  - The same check is in `apps/web/app/api/cron/webhookTriggers/route.ts:9-13`.
- Vercel-style `Bearer ${CRON_SECRET}`:
  - `…:packages/features/tasker/api/cron.ts:7-10`: `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`) {` `return new Response("Unauthorized", { status: 401 });`
- Some routes accept either one: `…:apps/web/app/api/cron/calendar-subscriptions/route.ts:25-27`: `if (![process.env.CRON_API_KEY, \`Bearer ${process.env.CRON_SECRET}\`].includes(\`${apiKey}\`)) {`. `apps/web/app/api/cron/selected-calendars/route.ts:29-31` does the same.
- `.env.example:66-67` documents `# ApiKey for cronjobs` / `CRON_API_KEY=…` (the sample value is not reproduced here). No `CRON_SECRET` line was found in `.env.example`.

**Triggers.**

- GitHub Actions. There are 11 `.github/workflows/cron-*.yml` files. One of them is `.github/workflows/cron-bookingReminder.yml:6-8`: `schedule:` / `# Runs "At every 15th minute."` / `- cron: "*/15 * * * *"`. At `:18-23` it runs `curl ${{ secrets.APP_URL }}/api/cron/bookingReminder \` `-X POST \` … `-H 'authorization: ${{ secrets.CRON_API_KEY }}' \` `-sSf`.
- The webhook trigger workflow asks for every minute. `.github/workflows/cron-webhooks-triggers.yml:8`: `- cron: "* * * * *"`. GitHub's documentation says "The shortest interval you can run scheduled workflows is once every 5 minutes" (see the docs section below). How GitHub actually treats this workflow is not confirmed.
- Vercel Cron. `apps/web/vercel.json:2-31` lists 7 crons, including `"path": "/api/tasks/cron", "schedule": "* * * * *"` (`:15-18`) and `"/api/cron/calendar-subscriptions", "schedule": "*/5 * * * *"` (`:3-6`).
- A dev-only local trigger. `apps/web/cron-tester.ts:21-29` runs `new CronJob(` `// Each 5 seconds` `"*/5 * * * * *",` and calls `fetchCron("/cron/calendar-subscriptions")` and `fetchCron("/tasks/cron")` on `http://localhost:3000`. It is wired as `apps/web/package.json:12` `"dev:cron": "npx tsx cron-tester.ts"`.

**DB-backed task queue (the "InternalTasker").**

- `…:packages/features/tasker/README.md:11`: "a base `InternalTasker` which doesn't require third party dependencies and should work out of the box (by configuring a proper cron)."
- `README.md:58-60`: "By default, the cron will run each minute and will pick the next 100 tasks to be executed." / "If the tasks succeeds, it will be marked as `suceededAt: new Date()`. If if fails, the `attempts` prop will increase by 1 and will be retried on the next cron run."
- `…:packages/features/tasker/tasker-factory.ts:16-19`: `// For now, we only have the InternalTasker.` … `return new InternalTasker();`
- The repository also has an agent rule saying "Trigger.dev is the async task runner used in both `apps/web` and `apps/api/v2`" (`agents/rules/patterns-trigger-dev.md:10`). That is a separate, hosted path that `ENABLE_ASYNC_TASKER` controls; it was not analysed further.

### Duplicate prevention

- There is no claim or lock when a batch is picked. `…:packages/features/tasker/repository.ts:65-74`: `async getNextBatch() {` … `return this.deps.prismaClient.task.findMany({` `where: makeWhereUpcomingTasks(),` `orderBy: { scheduledAt: "asc" },` `take: 1000,`. The processor marks success or retry only after running the task (`packages/features/tasker/task-processor.ts:23-35`). Two overlapping calls to `/api/tasks/cron` could therefore pick the same rows. The code has no guard for that; it relies on a single trigger.
- Per-route "already done" records. The booking reminder reads earlier `reminderMail` rows and skips bookings that already have one (`apps/web/app/api/cron/bookingReminder/route.ts:83-95`: `prisma.reminderMail.findMany({` … `.filter((b) => !reminders.some((r) => r.referenceId == b.id))`). It writes a row after sending (`:146-152`: `await prisma.reminderMail.create({`). The read and the write are separate statements, not an atomic claim.

### Docker shipping and self-hosting docs

- The image starts only the app. `Dockerfile:94` `CMD ["/calcom/scripts/start.sh"]`. `scripts/start.sh:8-11` waits for the DB, runs `npx prisma migrate deploy …`, seeds the app store, then `yarn start`. No cron process is started.
- `docker-compose.yml` services: `database` (:13), `redis` (:26), `calcom` (:37), `calcom-api` (:68), `studio` (:121). There is no cron or worker service.
- Self-hosting docs, `apps/docs/content/installation.mdx:72-80`: "## Cron Jobs" / "There are a few features which require cron job setup. When self-hosting, you would probably need to set up cron jobs according to the hosting platform you are using. For instance, if you are hosting on Vercel, you would need to set up cron jobs by following [this document](https://vercel.com/guides/how-to-setup-cron-jobs)." / "At cal.diy, the cron jobs are found in the following directory:" / `/apps/web/app/api/cron`. The published page is https://www.cal.diy/installation (redirected from https://cal.com/docs/self-hosting/installation). It carries the same "Cron Jobs" paragraph (fetched 2026-10-09).
- `apps/docs/content/docker.mdx` has no "cron" mention (grep, 0 matches).
- The archived docker repo says Docker moved into the monorepo: `calcom/docker@4d6a0c425e958e9255c33d872c4975975fe4b074:README.md:28-30`: "# 🚨 REPOSITORY ARCHIVED" … "Docker resources for Cal.com have been moved into the main monorepo at [calcom/cal.com]". Its README has no "cron" mention.

### Not confirmed (Cal.com)

- How Cal.com's own production schedules `/api/tasks/cron` beyond `vercel.json`.
- Whether GitHub honours the every-minute schedule in `cron-webhooks-triggers.yml` (the docs give 5 minutes as the minimum).
- Whether any Cal.com doc tells Docker self-hosters which endpoints to call and how often. Only the general "Cron Jobs" paragraph was found.

---

## 2. Documenso

- Pinned: `documenso/documenso@38ecb217effcc53a7164d7123c51336f636bd3b2` (default branch `main`, 15,366 stars).
- **The framework is no longer Next.js.** The apps are `apps/docs`, `apps/openpage-api` and `apps/remix`, with no Next.js web app. `apps/remix/package.json:29,39,40,48,68` lists `"@hono/node-server"`, `"@react-router/node": "^7.18.1"`, `"@react-router/serve"`, `"hono": "^4.12.14"`, `"react-router": "^7.12.0"`; no `"next"` dependency was found. `apps/remix/server/main.js:1-2`: "This is the main entry point for the server which will launch the RR7 application". `:49`: `serve({ fetch: handler.fetch, port });` (Hono node server). When the migration happened was not confirmed.

### Mechanism: a provider-agnostic job client (`packages/lib/jobs/**`)

- Provider selection. `…:packages/lib/jobs/client/client.ts:14-17`: `match(env('NEXT_PRIVATE_JOBS_PROVIDER'))` `.with('inngest', …)` `.with('bullmq', …)` `.otherwise(() => LocalJobProvider.getInstance());`. `:32-41`: `startCron()`: "Call this once at application startup … No-op for providers that handle cron externally (e.g. Inngest)."
- Jobs declare cron in their definition. `…:packages/lib/jobs/definitions/internal/expire-recipients-sweep.ts:15-19`: `trigger: {` … `cron: '*/15 * * * *', // Every 15 minutes.`. `cleanup-rate-limits.ts` has the same 15-minute cron.
- The cron starts at server boot. `…:apps/remix/server/router.ts:138`: `app.use('/api/jobs/*', jobsClient.getApiHandler());`. `:172-174`: `// Start cron scheduler for background jobs (e.g. envelope expiration sweep).` `// No-op for Inngest provider which handles cron externally.` `jobsClient.startCron();`. `:101` notes that `/api/jobs` uses "(signature auth)" and gets no CSRF middleware.

**`local` provider (the default): PostgreSQL table, in-process poller, signed HTTP self-call**

- Poller. `…:packages/lib/jobs/client/local.ts:37-38`: `const CRON_POLL_INTERVAL_MS = 30_000;` `const CRON_POLL_JITTER_MS = 5_000;`. `:83-94` (doc comment): "The poller runs every 30 seconds (+ random jitter to avoid thundering herd across instances) … For each due slot it creates a BackgroundJob row with a deterministic ID. If the insert succeeds the job is dispatched; if it fails with a unique constraint violation (P2002) another instance already claimed that slot." `:104-110` uses a self-rescheduling `setTimeout` (`void this.processCronTick().finally(tick);`).
- Due slots are computed with `cron-parser` from the last tick (`:175-191`). "Only take the latest slot — sweep-style jobs don't need to catch up every missed slot after downtime" (`:128-130`).
- Storage. `…:packages/prisma/schema.prisma:1131-1156`: `enum BackgroundJobStatus { PENDING PROCESSING COMPLETED FAILED }` and `model BackgroundJob { id String @id @default(cuid()) status … retried Int @default(0) maxRetries Int @default(3) jobId … submittedAt … completedAt … }`.
- Execution is an HTTP call to itself. `local.ts:357-389`: `const endpoint = \`${NEXT_PRIVATE_INTERNAL_WEBAPP_URL()}/api/jobs/${jobDefinitionId}/${jobId}\`;` `const signature = sign(data);`with headers`'X-Job-Id'`and`'X-Job-Signature'`. The `fetch` is raced against a 150 ms timeout (`setTimeout(resolve, 150)`), so the caller does not wait for the job.
  - The signature is an encrypted hash of the JSON payload. `packages/lib/server-only/crypto/sign.ts:4-12`: `const hashed = hashString(stringified);` `const signature = encryptSecondaryData({ data: hashed });`. `verify.ts:4-11`: `return decrypted === hashed;`.
- The handler checks the signature, then claims the row. `local.ts:259-261`: `if (!signature || !verify(options, signature)) {` `return c.text('Unauthorized', 401);`. `:277-295`: `prisma.backgroundJob.update({ where: { id: jobId, status: BackgroundJobStatus.PENDING }, data: { status: BackgroundJobStatus.PROCESSING, … } }).catch(() => null);` `if (!backgroundJob) { return c.text('Job not found', 404); }`.
- Retries. On error the row goes back to `PENDING` and is resubmitted with `X-Job-Retry` (`:335-350`). Steps inside a job are memoised in `BackgroundJobTask` by a hashed cache key (`:391-457`).

**`bullmq` provider**

- `…:packages/lib/jobs/client/bullmq.ts:41-45` requires `NEXT_PRIVATE_REDIS_URL`. `:105-131`: `void this._queue.upsertJobScheduler(definition.id, { pattern: definition.trigger.cron }, { name: definition.id, … })`. The Worker runs in the same process (`:60-70`).

**`inngest` provider**

- `…:packages/lib/jobs/client/inngest.ts:37-38`: `job.trigger.cron ? { cron: job.trigger.cron }`. Inngest (hosted) runs the schedule. `base.ts:20-28`: `startCron()` is a "No-op by default".

### Duplicate prevention

- `local`: a deterministic primary key per (job, slot). `local.ts:19-29`: "Build a deterministic BackgroundJob ID for a cron run so that multiple instances of the local provider racing to enqueue the same slot will collide on the primary key instead of creating duplicates." The function is `createCronRunId = (jobId, scheduledFor) => … sha256(\`cron:${jobId}:${scheduledFor.toISOString()}\`)`. The insert catches `P2002` and skips (`:133-154`). The conditional update `PENDING → PROCESSING` (`:277-295`) also stops a second delivery of the same job id from running it again.
- `bullmq`: the scheduler is keyed by `definition.id` (upsert), and BullMQ runs each produced job once.
- `inngest`: handled by the hosted service.

### Docker shipping and docs

- One container. `docker/Dockerfile:150,154`: `COPY … ./docker/start.sh /app/apps/remix/start.sh`, `CMD ["sh", "start.sh"]`. `docker/start.sh:30-34`: `npx prisma migrate deploy …` then `HOSTNAME=0.0.0.0 node build/server/main.js`.
- `docker/production/compose.yml` services: `database` (`image: postgres:15`, :4-5) and `documenso` (`image: documenso/documenso:latest`, :18-19). There is no Redis or worker service, and the compose `environment:` blocks contain no `NEXT_PRIVATE_JOBS_PROVIDER`, so unless an operator adds it, the default `local` provider applies.
- Docs: `apps/docs/content/docs/self-hosting/configuration/background-jobs.mdx`, published at https://docs.documenso.com/docs/self-hosting/configuration/background-jobs (HTTP 200 on 2026-10-09):
  - `:13-17` (table): "Inngest | Managed | Production with zero ops overhead"; "BullMQ | Redis | Self-hosted production with full control"; "Local | PostgreSQL | Development and small self-hosted deployments".
  - `:26`: "The default provider is `local`. It requires no additional infrastructure and works well for development and small deployments, but is not recommended for production workloads."
  - `:69`: "BullMQ is a Redis-backed job queue that runs inside the Documenso process."
  - `:127`: "The local provider uses your PostgreSQL database as a job queue. Jobs are stored in the `BackgroundJob` table and processed via internal HTTP requests that Documenso sends to itself."
  - `:140-146`: `NEXT_PRIVATE_INTERNAL_WEBAPP_URL=http://localhost:3000`, "to use the internal address instead of `NEXT_PUBLIC_WEBAPP_URL` for self-requests."
  - `:152-157` (Limitations): "No concurrency control - jobs are processed one at a time per request cycle"; "Depends on the application being able to reach itself over HTTP".
  - `:169-172`: "Self-hosted production" → "Use **BullMQ**. Add a Redis instance to your infrastructure …"
  - `:98-113` gives a compose snippet that adds a `redis` service (`image: redis:8-alpine`).

### Not confirmed (Documenso)

- Which commit added the cron poller to `local.ts`. The latest commits touching the file include `006b1d0a579e36448983b0a4d624805d7230ef4e` (2026-02-20, "feat: per-recipient envelope expiration (#2519)"); the diff was not read.
- With several replicas behind a load balancer, which replica receives the self-call. That depends on `NEXT_PRIVATE_INTERNAL_WEBAPP_URL`; the docs do not discuss replicas.
- The date of the Next.js → React Router migration.

---

## 3. Formbricks

- Pinned: `formbricks/formbricks@27ca48e29e45150e4582470e468a0e37a7c42d57` (default branch `main`, 13,076 stars).
- Historical state read at `0188aad97b6d9e68542e1437d131626f1902d0a7`, the parent of `dd394f1d2c2e42376d85fc035dd04d185282c9eb` (PR #6505 "chore: remove cron jobs and survey scheduling functionality", merged 2025-09-11T07:17:41Z).

### Before Sept 2025: supercronic in the image, curl to secret-protected routes

- Crontab, `formbricks/formbricks@0188aad97b6d9e68542e1437d131626f1902d0a7:docker/cronjobs:1-3`: `0 0 * * * curl $WEBAPP_URL/api/cron/survey-status -X POST -H 'content-type: application/json' -H 'x-api-key: '"$CRON_SECRET"''` (and `0 9 * * *` for `/api/cron/ping`).
- Started by the container entrypoint. `…@0188aad9…:apps/web/scripts/docker/next-start.sh:49-55`: `if [ "${DOCKER_CRON_ENABLED:-1}" = "1" ]; then` `supercronic -quiet /app/docker/cronjobs &`. It then runs migrations and `exec node apps/web/server.js` (`:57-65`).
- Route authentication. `…@0188aad9…:apps/web/app/api/cron/survey-status/route.ts:6-12`: `const apiKey = headersList.get("x-api-key");` `if (!apiKey || apiKey !== CRON_SECRET) {` `return responses.notAuthenticatedResponse();`.
- Kubernetes used a Helm `CronJob` (`…@0188aad9…:helm-chart/templates/cronjob.yaml:1-9`: `{{- if (.Values.cronJob).enabled }}` … `kind: CronJob`).
- Earlier, GitHub Actions cron workflows were removed in `c70008d1bedf38d689ef216bf3ba3db61aaa485d` (2025-03-28, "chore: remove unused cron github actions (#5151)").
- PR #6505's test plan: "Verify that the cron endpoints are removed and, Docker, Kubernetes, and Helm charts do not have the CRON configuration." / "Ensure that the `DOCKER_CRON_ENABLED` environment variable is removed." (PR body, via `gh api repos/formbricks/formbricks/pulls/6505`).

### Now: BullMQ job schedulers and workers started from `instrumentation.ts`

- `…@27ca48e2…:apps/web/instrumentation.ts:38-67`: `export const register = async () => {` `if (process.env.NEXT_RUNTIME === "nodejs") {` … `// Skip runtime-only BullMQ bootstrapping during production builds.` `if (process.env.NEXT_PHASE !== "phase-production-build") {` `const { registerJobsWorker, registerRecurringJobs } = await import("./instrumentation-jobs");` `void registerRecurringJobs().catch(…)` `void registerJobsWorker().catch(…)`.
- Registration is guarded on `globalThis` and retried after 30 s. `apps/web/instrumentation-jobs.ts:6` `WORKER_STARTUP_RETRY_DELAY_MS = 30_000`. `:94-126` `registerRecurringJobs` returns early if `globalForJobsRuntime.formbricksJobsRecurringRegistered`. `:128-172` `registerJobsWorker` does the same for the worker.
- Upsert only, never remove first. `instrumentation-jobs.ts:19-25`: "Upsert only — never remove first. `upsertJobScheduler` updates an existing scheduler's repeat options in place … Removing and re-upserting in close succession can leave the scheduler with **no** delayed job at all (bullmq#3063)".
- Scheduler id and upsert. `packages/jobs/src/schedules.ts:107-115`: `return \`${parsedJobName}:${parsedIdentity.scope}:${parsedIdentity.scheduleId}\`;`. `packages/jobs/src/queue.ts:189-197`: `return await queue.upsertJobScheduler(getRecurringJobSchedulerId(definition.name, identity), toBullMQRepeatOptions(schedule), {…})`.
- Schedules: both `every` and `cron` kinds. `apps/web/lib/jobs/recurring-registrations.ts:73-80`: `authzedProjectionDelivery: { … schedule: { everyMs: 5_000, kind: "every" } }`. `:107-115`: `surveyScheduling: { … schedule: { cronPattern: SURVEY_SCHEDULING_DAILY_CRON_PATTERN, kind: "cron", timeZone: … } }`.
- Worker in the web process. `packages/jobs/src/runtime.ts:166-176`: `const worker = new Worker(JOBS_QUEUE_NAME, async (job: Job) => { await processJob(job, jobHandlerOverrides); }, { connection: workerConnection, concurrency: resolvedConcurrency, prefix })`. It is on by default: `apps/web/lib/jobs/config.ts:21-27`: `if (env.BULLMQ_WORKER_ENABLED !== undefined) { return env.BULLMQ_WORKER_ENABLED === "1"; }` `return env.NODE_ENV !== "test";`.
- `packages/jobs/package.json:29-30`: `"bullmq": "5.61.0"`, `"ioredis": "5.8.1"`.

### Duplicate prevention

- Redis holds one scheduler per stable id (upsert), and BullMQ gives each produced job to one worker. Docs, `docs/self-hosting/configuration/job-runner.mdx:87-94` (published at https://formbricks.com/docs/self-hosting/configuration/job-runner, HTTP 200): "Each web replica starts its own in-process workers and connects to the same queue. BullMQ coordinates job claims so one available worker ordinarily processes a queued job." `:63`: "All replicas must use the same Redis instance so they share the BullMQ queue and recurring schedules."
- The code still demands idempotency. `packages/jobs/src/recurring.ts:37-40`: "Handlers must be **idempotent and safe to overlap**: `BULLMQ_WORKER_CONCURRENCY` and `BULLMQ_WORKER_COUNT` are operator-configurable and there may be several app replicas, so two ticks of the same job can run at once."

### Docker shipping and docs

- `docker/docker-compose.yml:335-337`: `redis:` / `image: valkey/valkey@sha256:…`. `:46`: `REDIS_URL: redis://redis:6379`. `:365-367`: `formbricks:` / `image: ghcr.io/formbricks/formbricks:latest`. There is no separate job worker for the web app; the `hub-worker` service (`:483-485`, `image: ghcr.io/formbricks/hub${HUB_IMAGE_REF:-:latest}`) belongs to Formbricks Hub, which `docs/self-hosting/setup/docker.mdx:8` lists as a separate part of the "baseline Formbricks stack".
- `job-runner.mdx:7-9`: "Formbricks starts the worker inside the web application by default, so a standard self-hosted deployment does not need a separate worker container." `:22`: "Worker startup: Next.js server instrumentation".
- `docs/self-hosting/configuration/environment-variables.mdx:130`: `REDIS_URL` — "… and the shared BullMQ background-job queue. All web and worker replicas must share this Redis instance. Application will not start without this."
- `CRON_SECRET` is still listed as "required" (`environment-variables.mdx:30`, "API Secret for running cron jobs.") and in compose (`docker/docker-compose.yml:40-42`). It is declared in `apps/web/lib/env.ts:571` and `apps/web/lib/constants.ts:21`, but no `app/api/cron` route exists in the tree.

### Not confirmed (Formbricks)

- Whether anything in the current code consumes `CRON_SECRET`. `gh search code CRON_SECRET --repo formbricks/formbricks` returned only declarations, docs, charts and scripts; code search is not exhaustive.
- The exact Formbricks release that first shipped the BullMQ runtime.

---

## 4. Dub and Papermark (hosted schedulers)

### Dub — `dubinc/dub@d1e47554a755b2e902dffb1efef4fbc33cd04913` (24,870 stars)

- Vercel Cron: `apps/web/vercel.json:2-6`: `"crons": [ { "path": "/api/cron/domains/verify", "schedule": "0 * * * *" }`. There are 25 `"path"` entries in total.
- Routes are wrapped by `withCron`. `apps/web/lib/cron/with-cron.ts:39-46`: `if (req.method === "GET") { // GET requests are typically from Vercel Cron` `await verifyVercelSignature(req);` `} else if (req.method === "POST") { // POST requests are typically from QStash` … `await verifyQstashSignature({ req, rawBody });`.
- Verification is skipped off Vercel. `apps/web/lib/cron/verify-vercel.ts:6-9`: `// skip verification in local development` `if (process.env.VERCEL !== "1") { return; }`; it then requires `` `Bearer ${cronSecret}` `` (`:27`). `verify-qstash.ts:14-17` has the same `VERCEL !== "1"` early return.
- Self-hosting guide, https://dub.co/docs/self-hosting (fetched as `.md`): prerequisites include "An [Upstash](https://upstash.com/) account" and "A [Vercel](https://vercel.com/) account". Step 1 says: "Delete the `apps/web/vercel.json` file since cron jobs are not required for the self-hosted version". The guide ends with "Step 9: Deploy to Vercel". **Dub is self-hostable only in the sense of your own Vercel and Upstash accounts; there is no Docker scheduler.**

### Papermark — `mfts/papermark@ed19717ec02a1ac79aecf5569159aa9d2d869312` (9,242 stars)

- Background tasks run on Trigger.dev (hosted). `trigger.config.ts:4-8`: `import { defineConfig, timeout } from "@trigger.dev/sdk";` `export default defineConfig({ project: "proj_…", dirs: ["./lib/trigger", "./ee/**/lib/trigger"],`.
- Cron routes verify Upstash QStash signatures, and only on Vercel. `lib/cron/index.ts:11-15`: `// we're using Upstash's Receiver to verify the request signature` `export const receiver = new Receiver({`. `app/api/cron/domains/route.ts:26-32`: `if (process.env.VERCEL === "1") { const isValid = await receiver.verify({ signature: req.headers.get("Upstash-Signature") || "", …` `return new Response("Unauthorized", { status: 401 });`.
- `vercel.json:1-10` has only `functions` memory settings and no `crons`. Where the QStash schedules are defined is not confirmed: they are not in the repository.
- The README claims "Self-hosted, Open-source: Host it yourself" (`README.md:30`); self-hosting docs were not checked.

---

## 5. GitHub search: schedulers started in `instrumentation.ts` `register()`

Queries run with `gh search code "<q>" --filename instrumentation.ts`: `node-cron`, `croner`, `setInterval`, `node-schedule`, `toad-scheduler` (0 hits), `bullmq`, `pg-boss` (0), `graphile-worker` (0), `cron`, `schedule`. GitHub code search returns a capped, non-exhaustive sample. Most hits are small personal projects (under 400 stars). Among the 148 unique repositories from the `cron`/`schedule`/`pg-boss`/`graphile-worker` queries, those with 500+ stars were checked. The two most relevant are below. Formbricks (section 3) is also a hit (`bullmq` query, `apps/web/instrumentation.ts`).

### Hit 1 — Rallly (`lukevella/rallly`, 5,295 stars), self-hosted scheduling polls

- Pinned `lukevella/rallly@ac224fe84821b332a7fab1e31537a3989b53feb2`.
- `apps/web/src/instrumentation.ts:15-24`: "// On Vercel the house-keeping cron runs the email queue; everywhere else // (dev, the self-hosted image) a long-lived server runs it itself. Never // during a build, which must not touch the database." `if (!process.env.VERCEL && process.env.NEXT_PHASE !== "phase-production-build") {` `const { startQueuedEmailScheduler } = await import("@/emails/queue");` `startQueuedEmailScheduler();`.
- `apps/web/src/emails/queue.ts:77-84`: "Runs the queue every minute inside this server process, the same run the house-keeping cron triggers on Vercel. For long-lived servers only: `next dev` and the self-hosted image. A tick that finds the previous run still going is skipped, and the timer is kept on `globalThis` so a dev reload cannot start a second one. Several processes can each run one; claims do not overlap."
  - `:85-116`: an `EMAIL_QUEUE_SCHEDULER_ENABLED === "false"` opt-out and a `globalThis` guard; `let running = false;` with `if (running) { return; }`; `setInterval(…, SCHEDULER_INTERVAL_MS)` where `SCHEDULER_INTERVAL_MS = 60_000` (`:71`); `timer.unref();`.
- Duplicate prevention across processes, `apps/web/src/features/email-queue/mutations.ts:120-158`: "Claims a batch of pending emails in one statement. SKIP LOCKED lets overlapping runs claim disjoint batches instead of queueing behind each other". The statement is `UPDATE queued_emails SET claimed_at = ${now}, attempts = attempts + 1 … WHERE id IN ( SELECT id FROM queued_emails WHERE status = 'pending' … AND (claimed_at IS NULL OR claimed_at < ${staleBefore}) … LIMIT ${limit} FOR UPDATE SKIP LOCKED ) RETURNING id`. This is PostgreSQL syntax: `kind::text`, `RETURNING`.
- The same work is exposed as a route for Vercel. `apps/web/src/app/api/house-keeping/[...method]/route.ts:35-48`: `if (process.env.CRON_SECRET) { return bearerAuth({ token: process.env.CRON_SECRET })(c, next); }`; otherwise a 500 with "CRON_SECRET is not set in environment variables". `:235-238`: `app.get("/send-queued-emails", …) const summary = await runQueuedEmailDelivery({});`. `apps/web/vercel.json:9-38` lists 7 house-keeping crons, `send-queued-emails` and `deliver-webhooks` at `"* * * * *"`.
- Docker: nothing extra; the scheduler lives in the web process.
- Not confirmed: how the self-hosted image runs the other house-keeping jobs (`auto-close-polls`, `delete-inactive-polls`, `remove-deleted-users`, …). Only the email queue starts from `instrumentation.ts`, and `apps/docs/self-hosting/{configuration,installation/docker,management}.mdx` contain no "cron", "house-keeping" or "EMAIL_QUEUE" matches.

### Hit 2 — ZTNet (`sinamics/ztnet`, 1,250 stars), self-hosted ZeroTier controller UI; includes a user-deactivation job

- Pinned `sinamics/ztnet@816c9e2b2ea2f5e7ec8c478edd2cfdfe78972514`.
- `src/instrumentation.ts:1-13`: `export async function register() {` `if (process.env.NEXT_RUNTIME === "nodejs") {` `const cronTasksModule = await import("./cronTasks");` `if (cronTasksModule.CheckExpiredUsers) { cronTasksModule.CheckExpiredUsers(); }` … `cronTasksModule.updatePeers();`.
- `src/cronTasks.ts:1`: `import * as cron from "cron";`. `:15-20`: "Checks for expired users and deactivates them. … Returns the number of users that were deactivated." `:144-158`: `new cron.CronJob(` `"0 0 0 * * *", // 12:00:00 AM (midnight) every day` … `await checkAndDeactivateExpiredUsers();` … `"America/Los_Angeles",`. `:169-175`: a second `CronJob` with `"*/10 * * * *", // every 10min`.
- Duplicate prevention: none found in `cronTasks.ts` (no lock or leader election). Repeat runs are harmless because the query only selects `isActive: true` users (`:22-31`) and sets `isActive: false` (`:130-138`).
- Docker: nothing extra; the scheduler lives in the web process.

Also seen, not analysed: `lobehub/lobehub@d28985a7664271ec5258a222d38f5bb6e776a59d:src/instrumentation.ts:7-9`: "Auto-start GatewayManager on server start for non-Vercel environments (Docker, local). … On Vercel, the cron job at /api/agent/gateway handles this reliably instead." This is the same Vercel-cron-or-in-process split as Rallly.

---

## Documentation quoted (for the patterns above)

- **Next.js `register`** (bundled with Next 16.3.4 in this repo): `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md:18`: "The file exports a `register` function that is called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests." Online: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation. Implication: each replica runs its own copy of anything started there. `02-guides/self-hosting.md:299`: "When stopping the server, ensure a graceful shutdown by sending `SIGINT` or `SIGTERM` signals and waiting." The self-hosting guide has no section on cron or background jobs (grep for cron, background, scheduled and setInterval: only this shutdown line).
- **Vercel Cron**, https://vercel.com/docs/cron-jobs/manage-cron-jobs:
  - "The value of the variable will be automatically sent as an `Authorization` header when Vercel invokes your cron job."
  - "The `authorization` header will have the `Bearer` prefix for the value."
  - "If your cron job runs longer than the interval between invocations, Vercel can trigger a second instance while the first is still running."
  - "Cron delivery can also occasionally invoke the same scheduled run more than once. Because of this, cron jobs should be resilient to both missed runs and duplicate runs."
  - "Design your operations to be **idempotent** and reconciliation-based".
- **GitHub Actions `schedule`**, https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule:
  - "The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped."
  - "The shortest interval you can run scheduled workflows is once every 5 minutes."
- **BullMQ job schedulers**, https://docs.bullmq.io/guide/job-schedulers: "the 'upsert' is used instead of 'add' to simplify management of recurring jobs, especially in production deployments. It ensures the scheduler is updated or created without duplications." Also on Context7 `/websites/bullmq_io`.
- **MySQL 8.4** (the target app uses MySQL, not PostgreSQL):
  - https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html: "A locking read that uses SKIP LOCKED never waits to acquire a row lock. The query executes immediately, removing locked rows from the result set." / "SKIP LOCKED is therefore not suitable for general transactional work." / "Statements that use NOWAIT or SKIP LOCKED are unsafe for statement based replication."
  - https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html, `GET_LOCK()`: "The lock is exclusive. While held by one session, other sessions cannot obtain a lock of the same name." / "A lock obtained with GET_LOCK() is released explicitly by executing RELEASE_LOCK() or implicitly when your session terminates (either normally or abnormally)."
  - https://dev.mysql.com/doc/refman/8.4/en/update.html: "You cannot update a table and select directly from the same table in a subquery." Rallly's single-statement `UPDATE … WHERE id IN (SELECT … FROM same_table … FOR UPDATE SKIP LOCKED)` therefore does not carry over to MySQL as written. A MySQL port would need a different shape, for example `SELECT … FOR UPDATE SKIP LOCKED` in a transaction followed by an `UPDATE`; that shape was not verified here.

## Overall "not confirmed" list

1. Cal.com: how its production triggers `/api/tasks/cron` beyond `vercel.json`. Whether the every-minute GitHub workflow really runs every minute. Any Docker-specific cron guidance beyond the generic "Cron Jobs" paragraph.
2. Documenso: the commit that added the `local` cron poller. Which replica serves the signed self-call behind a load balancer. The date of the Next.js → React Router migration.
3. Formbricks: whether `CRON_SECRET` is still consumed anywhere (only declarations found). The first release with the BullMQ runtime.
4. Papermark: where its QStash schedules are configured; its self-hosting docs.
5. Rallly: how self-hosted instances run the non-email house-keeping jobs.
6. The instrumentation search samples GitHub code search, which is capped; other well-known projects may start schedulers in files with other names (for example `instrumentation.node.ts`), and those were not searched.
