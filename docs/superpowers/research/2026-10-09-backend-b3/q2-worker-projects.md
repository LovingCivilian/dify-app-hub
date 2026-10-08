# Q2: How well-known self-hosted Next.js-adjacent projects run periodic jobs

Research date: 2026-10-09. Read-only. Clones (blobless, sparse, never built or run) under `tmp/b3-research/src/{langfuse,twenty,homarr,homarr-v1,karakeep}`; fetched doc pages under `tmp/b3-research/docs/`.

Citation format: `owner/repo@<full sha>:<path>:<lines>` followed by an exact excerpt, or a URL plus an exact excerpt.

## Pinned commits

| Project | Default branch | Pinned sha |
| --- | --- | --- |
| langfuse/langfuse | `main` | `c106bb3d945323688e6f6079f65fb0ab28203b53` |
| twentyhq/twenty | `main` | `c168183b17e89fbc8747f8ed333d90466ebf85f4` |
| homarr-labs/homarr | `dev` (now v2.x) | `ad15cfc3bf391f7152035d263926265c28f6631c` |
| homarr-labs/homarr, tag `v1.77.2` (last v1) | n/a | `18dafb1276d8ff66d1be1b149c74f80dbf94f78d` |
| homarr-labs/homarr, tag `v1.61.0` (last version with a separate tasks process) | n/a | `4635c51fe1b47d1112ed4fdc64f526609dab8124` |
| karakeep-app/karakeep | `main` | `75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea` |
| karakeep-app/liteque (Karakeep's queue library) | `main` | `8ce63c873f83b759efcf05a6db0cf97695628670` |

## Summary table

|  | Langfuse | Twenty | Homarr | Karakeep |
| --- | --- | --- | --- | --- |
| Where periodic jobs run | Separate **worker container** (Express + BullMQ consumers) | Separate **worker container** (NestJS app context, BullMQ consumers) | **Inside the Next.js server process** since v1.62 (via `instrumentation.ts` `register()`), with `croner`; before that a separate node process in the same container | Separate **workers process**, started by s6-overlay in the same (all-in-one) container; `node-cron` schedules, a SQLite queue (liteque) runs jobs |
| Scheduler | BullMQ job schedulers (`upsertJobScheduler`) on Redis | BullMQ job schedulers (`upsertJobScheduler`) on Redis, registered by a CLI command `cron:register:all` | `croner` `Cron` objects in memory | `node-cron` `cron.schedule(...)` enqueuing into liteque (SQLite) |
| Duplicate prevention across replicas | Redis: one scheduler per id (upsert is idempotent); a job is locked by one worker. Plus Postgres row locks for background migrations (`workerId` + `lockedAt` heartbeat) and a CAS-style lease row (`cron_jobs`) for one cloud-only job | Redis: one scheduler per id; registration only in the `server` container (`DISABLE_CRON_JOBS_REGISTRATION: "true"` on the worker). Plus a Postgres advisory lock (`pg_try_advisory_lock`) inside at least one cron job | None found in code (single container, in-process; `global.cronJobs ??=` guards double registration within one process only) | Unique index `(queue, idempotencyKey)` + `ON CONFLICT DO NOTHING` on enqueue; compare-and-swap on `allocationId` on dequeue |
| Docker shipping | Two images (`langfuse/langfuse`, `langfuse/langfuse-worker`), two compose services | One image (`twentycrm/twenty`), two compose services; worker overrides the command with `yarn worker:prod` | One image, one container; `run.sh` starts nginx, Redis (optional) and the Next.js server | One "aio" image with s6-overlay running `svc-web` and `svc-workers`; legacy separate `web`/`workers` images still built |

---

## 1. Langfuse (langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53)

### Mechanism: a separate worker container consuming BullMQ queues; recurring jobs are BullMQ job schedulers

Two images, two compose services:

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:docker-compose.yml:7-8`

```yaml
langfuse-worker:
  image: docker.langfuse.com/langfuse/langfuse-worker:4
```

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:docker-compose.yml:110-111`

```yaml
langfuse-web:
  image: docker.langfuse.com/langfuse/langfuse:4
```

The web service reuses the worker's environment block (`docker-compose.yml:116-117`: `environment:` / `<<: *langfuse-worker-env`).

Each image has its own Dockerfile and command:

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:worker/Dockerfile:214-217`

```dockerfile
ENTRYPOINT ["dumb-init", "--", "./worker/entrypoint.sh"]
...
CMD ["node", "worker/dist/index.js"]
```

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:web/Dockerfile:295-302`

```dockerfile
ENTRYPOINT ["dumb-init", "--", "./web/entrypoint.sh"]
...
    node ./web/server.js --keepAliveTimeout 110000; \
```

Recurring jobs are registered with BullMQ's job-scheduler API through one helper:

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:packages/shared/src/server/redis/scheduleRecurringJob.ts:13-24`

```ts
 * Registers a recurring cron job on a queue via a BullMQ job scheduler.
 *
 * Job schedulers replace the deprecated `Queue.add(name, data, { repeat })`
 * API. The legacy path replaced the pending next iteration in two separate
 * Redis round trips on every boot (delete the delayed job, then re-create
 * it), so a producer failing between the two - e.g. a container killed
 * mid-boot during a fleet-wide deploy - silently ended the schedule until
 * the next boot re-registered it. `upsertJobScheduler` performs the same
 * replacement in a single atomic Lua script, so concurrent boots and
 * mid-boot crashes cannot lose the chain. BullMQ v6 removes the legacy API
 * entirely.
```

`...scheduleRecurringJob.ts:102-107`

```ts
await queue.upsertJobScheduler(jobName, { pattern }, { name: jobName, data: data ?? {} })
```

Examples of schedules (the queue singleton schedules itself on first `getInstance()`):

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:packages/shared/src/server/redis/dataRetentionQueue.ts:37-43`

```ts
if (DataRetentionQueue.instance) {
	logger.debug('Scheduling jobs for DataRetentionQueue')
	scheduleRecurringJob(DataRetentionQueue.instance, {
		jobName: QueueJobs.DataRetentionJob,
		pattern: '15 3 * * *', // every day at 3:15am
	})
}
```

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:packages/shared/src/server/redis/blobStorageIntegrationQueue.ts:39-43`

```ts
scheduleRecurringJob(BlobStorageIntegrationQueue.instance, {
	jobName: QueueJobs.BlobStorageIntegrationJob,
	pattern: '*/20 * * * *', // every 20 minutes
	previousPatterns: ['20 * * * *'], // old hourly schedule
})
```

The worker both instantiates the queue (which upserts the scheduler) and consumes it, behind an env switch that defaults to on:

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:worker/src/app.ts:682-688`

```ts
if (env.QUEUE_CONSUMER_DATA_RETENTION_QUEUE_IS_ENABLED === "true") {
  // Instantiate the queue to trigger scheduled jobs
  DataRetentionQueue.getInstance();

  WorkerManager.register(QueueName.DataRetentionQueue, dataRetentionProcessor, {
    concurrency: 1,
  });
```

`langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:worker/src/env.ts:442-444`

```ts
  QUEUE_CONSUMER_DATA_RETENTION_QUEUE_IS_ENABLED: z
    .enum(["true", "false"])
    .default("true"),
```

### Duplicate prevention across replicas

1. **Redis / BullMQ job scheduler.** Every worker replica calls `upsertJobScheduler` with the same id (the job name), so there is one scheduler, not one per replica. BullMQ docs, https://docs.bullmq.io/guide/job-schedulers:

   > "**Upsert vs. Add:** the 'upsert' is used instead of 'add' to simplify management of recurring jobs, especially in production deployments. It ensures the scheduler is updated or created without duplications." "**Job Status:** As long as a Job Scheduler is producing jobs, there will be always one job associated to the scheduler in the "Delayed" status." "**Job Production Rate:** The scheduler will only generate new jobs when the last job begins processing."

   A produced job is processed by one worker under a lock. BullMQ docs, https://docs.bullmq.io/guide/workers:

   > "When a job reaches a worker and starts to be processed, BullMQ will place a lock on this job to protect the job from being modified by any other client or worker."

   Langfuse's helper exists precisely because legacy repeat keys produced duplicate triggers: `...scheduleRecurringJob.ts:4-8`

   ```ts
   // DO NOT REMOVE THIS FILE AND BEHAVIOUR WITHIN A MINOR LANGFUSE VERSION.
   // THE CLEANUP BELOW DELETES THE OLD md5-KEYED REPEAT SCHEDULES; WITHOUT IT,
   // SELF-HOSTERS UPGRADING FROM A LEGACY-SCHEDULING VERSION GET DUPLICATE CRON
   // TRIGGERS FOREVER (bullmq v6 workers keep iterating stranded md5-keyed
   // chains; only manual Redis cleanup stops them).
   ```

2. **Postgres lock row for background migrations** (long-running, started on worker boot, not cron, but the closest thing to a DB-held "only one worker runs this" lock). A random per-process `workerId`, a `lockedAt` timestamp refreshed by a heartbeat, a 60 s staleness rule, inside a `Serializable` transaction:

   `langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:worker/src/backgroundMigrations/backgroundMigrationManager.ts:10`

   ```ts
     private static workerId = randomUUID();
   ```

   `...backgroundMigrationManager.ts:78-106`

   ```ts
            // Abort if there is no migration to run or migration was locked less than 60s ago
            ...
            if (
              !migration ||
              (migration.lockedAt &&
                migration.lockedAt > new Date(Date.now() - 60 * 1000))
            ) {
            ...
            // Acquire lock
            await tx.backgroundMigration.update({
              where: {
                id: migration.id,
              },
              data: {
                workerId: BackgroundMigrationManager.workerId,
                lockedAt: new Date(),
              },
            });
   ```

   `...backgroundMigrationManager.ts:117-120`

   ```ts
          {
            maxWait: 5000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
   ```

   `...backgroundMigrationManager.ts:25-38` (heartbeat)

   ```ts
    await prisma.backgroundMigration.updateMany({
      where: {
        id: BackgroundMigrationManager.activeMigration.id,
        workerId: BackgroundMigrationManager.workerId,
   ...
      data: {
        lockedAt: new Date(),
      },
    });

    // Schedule next heartbeat in 15s
    setTimeout(BackgroundMigrationManager.heartBeat, 15 * 1000);
   ```

   `langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:worker/src/backgroundMigrations/README.md:35-38`

   > "The worker will load all background migrations that must run and check whether one of them is pending. In that case, it will try to acquire a lock and start the execution. If it completes, it marks the migration as done and proceeds with the next one until all are complete. If the worker is killed for any reason, another worker will pick up the migration and continue where it left off after the lock expired."

   Started from the worker on boot, on by default: `worker/src/app.ts:133-138`

   ```ts
   if (env.LANGFUSE_ENABLE_BACKGROUND_MIGRATIONS === "true") {
     // Will start background migrations without blocking the queue workers
     BackgroundMigrationManager.run().catch((err) => {
   ```

   Docs, https://langfuse.com/self-hosting/upgrade/background-migrations:

   > "Background migrations are executed on startup of the worker container and run in the background until completion or failure."

3. **Postgres `cron_jobs` lease row (one cloud-only job).** The hourly cloud usage metering job (only when `STRIPE_SECRET_KEY` is set, `worker/src/app.ts:437-442`) adds a DB lease on top of BullMQ: a `cron_jobs` row with `state`, `last_run`, `job_started_at`, claimed with a conditional update (compare-and-set on the previous `state` and `jobStartedAt`), and a 20-minute stale takeover.

   `langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:packages/shared/prisma/migrations/20230907204921_add_cron_jobs_table/migration.sql`

   ```sql
   CREATE TABLE "cron_jobs" (
       "name" TEXT NOT NULL,
       "last_run" TIMESTAMP(3),
   ```

   `langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53:worker/src/ee/cloudUsageMetering/handleCloudUsageMeteringJob.ts:129-164`

   ```ts
   if (cron.state === CloudUsageMeteringDbCronJobStates.Processing) {
    if (
      cron.jobStartedAt &&
      cron.jobStartedAt < new Date(Date.now() - 1200000)
    ) {
      ...
    } else {
      logger.warn("[CLOUD USAGE METERING] Job already in progress");
      return;
    }
   }
   ```

const jobStartedAt = new Date(); try { await prisma.cronJobs.update({ where: { name: cloudUsageMeteringDbCronJobName, state: cron.state, jobStartedAt: cron.jobStartedAt, }, data: { state: CloudUsageMeteringDbCronJobStates.Processing, jobStartedAt, }, }); } catch (e) { logger.warn( "[CLOUD USAGE METERING] Failed to update cron job state, potential race condition, exiting",

````
`...handleCloudUsageMeteringJob.ts:392-408`
```ts
// Advance the cron job only while still holding the lease claimed above. The
// stale-job takeover can hand this interval to another run mid-flight; without
// the predicate a superseded run would still move lastRun forward and mask the
// fact that another run owns the interval.
````

### Docker shipping and scaling (docs)

https://langfuse.com/self-hosting (architecture):

> "Web connects to PostgreSQL, Redis or Valkey, ClickHouse, and S3 or blob storage. Redis queues jobs for Langfuse Worker, which connects to PostgreSQL, ClickHouse, and S3." "Langfuse Worker: A worker that asynchronously processes events."

https://langfuse.com/self-hosting/deployment/infrastructure/containers:

> "**Langfuse Worker** : The worker that handles background tasks such as sending emails or processing events." "The images are published to Docker Hub as `langfuse/langfuse` and `langfuse/langfuse-worker`."

https://langfuse.com/self-hosting/configuration/scaling ("Scaling the worker containers"):

> "A load above 50% for a 2 CPU container is an indicator that the instance is saturated and that the throughput should increase by adding more containers."

### Not confirmed (Langfuse)

- Whether the web container ever calls `getInstance()` on a scheduled queue (which would also upsert schedulers). Not found in `web/src/server` (the only web path checked); the rest of `web/src` was not searched.
- Any Langfuse docs page that explicitly states "recurring jobs are safe with N worker replicas"; the safety argument above rests on BullMQ's docs, not a Langfuse statement.
- Langfuse docs describing the `cron_jobs` table (only code found; it is EE/cloud-gated).

---

## 2. Twenty (twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4)

### Mechanism: same image, separate `worker` service with a different command; cron jobs are BullMQ job schedulers registered by a CLI command at server start

`twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-docker/docker-compose.yml:4-5`

```yaml
server:
  image: twentycrm/twenty:${TAG:-latest}
```

`...docker-compose.yml:65-69`

```yaml
worker:
  image: twentycrm/twenty:${TAG:-latest}
  volumes:
    - server-local-data:/app/packages/twenty-server/.local-storage
  command: ['yarn', 'worker:prod']
```

`...docker-compose.yml:75-76`

```yaml
DISABLE_DB_MIGRATIONS: 'true' # it already runs on the server
DISABLE_CRON_JOBS_REGISTRATION: 'true' # it already runs on the server
```

(the server service passes `DISABLE_CRON_JOBS_REGISTRATION: ${DISABLE_CRON_JOBS_REGISTRATION}` through, `docker-compose.yml:17`, i.e. unset by default.)

The image's default command and entrypoint: `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-docker/twenty/Dockerfile:164-165`

```dockerfile
CMD ["node", "dist/main"]
ENTRYPOINT ["/app/entrypoint.sh"]
```

`twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/package.json:9-11`

```json
    "start:prod": "node dist/main",
    "command:prod": "node dist/command/command",
    "worker:prod": "node dist/queue-worker/queue-worker",
```

The entrypoint (run by both services, since compose only overrides `command`) migrates, then registers cron jobs unless disabled, then execs the command: `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-docker/twenty/entrypoint.sh:34-52`

```sh
register_background_jobs() {
    if [ "${DISABLE_CRON_JOBS_REGISTRATION}" = "true" ]; then
        echo "Cron job registration is disabled, skipping..."
        return
    fi

    echo "Registering background sync jobs..."
    if yarn command:prod cron:register:all; then
        echo "Successfully registered all background sync jobs!"
    else
        echo "Warning: Failed to register background jobs, but continuing startup..."
    fi
}

setup_and_migrate_db
register_background_jobs

# Continue with the original Docker command
exec "$@"
```

The registration command runs each per-job registration command: `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/src/database/commands/cron-register-all.command.ts:43-46`

```ts
@Command({
  name: 'cron:register:all',
  description: 'Register all background sync cron jobs',
})
```

`...cron-register-all.command.ts:262-272`

```ts
    for (const { name, command, isEnabled = true } of allCommands) {
      if (!isEnabled) {
        this.logger.log(`Skipping ${name} cron job (disabled by config)`);
        skipped.push(name);
        continue;
      }

      try {
        this.logger.log(`Registering ${name} cron job...`);
        await command.run();
```

A per-job registration command (example) puts a repeat pattern on the `cronQueue`: `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/src/engine/core-modules/user-session/crons/commands/user-session-cleanup.cron.command.ts:9-31`

```ts
@Command({
  name: 'cron:user-session:cleanup',
  ...
  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: UserSessionCleanupCronJob.name,
      data: undefined,
      options: {
        repeat: {
          pattern: USER_SESSION_CLEANUP_CRON_PATTERN,
        },
      },
    });
```

The handler lives in the worker as a queue processor: `...user-session/crons/jobs/user-session-cleanup.cron.job.ts:19-36`

```ts
@Injectable()
@Processor(MessageQueue.cronQueue)
export class UserSessionCleanupCronJob {
  ...
  @Process(UserSessionCleanupCronJob.name)
  @SentryCronMonitor(
```

`addCron` maps to BullMQ's `upsertJobScheduler` with a deterministic key: `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/src/engine/core-modules/message-queue/drivers/bullmq.driver.ts:377-385`

```ts
await this.queueMap[queueName].upsertJobScheduler(getJobKey({ jobName, jobId }), options?.repeat, {
	name: jobName,
	data,
	opts: queueOptions,
})
```

The worker is a NestJS application context (no HTTP server): `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/src/queue-worker/queue-worker.ts:17-19`

```ts
const app = await NestFactory.createApplicationContext(QueueWorkerModule, {
	bufferLogs: process.env.LOGGER_IS_BUFFER_ENABLED === 'true',
})
```

### Duplicate prevention across replicas

1. **Registration happens once per server start, only in `server`** (worker has `DISABLE_CRON_JOBS_REGISTRATION: "true"`, quoted above), and it is an upsert by a deterministic scheduler id, so re-registration on every start or from several server replicas does not multiply schedules (BullMQ docs quote in section 1: "It ensures the scheduler is updated or created without duplications.").
2. **One job per tick, one worker per job**: BullMQ job schedulers and job locks (BullMQ docs quotes in section 1).
3. **Postgres advisory lock inside a cron job** (belt and braces for at least one job): `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/src/database/typeorm/postgres-advisory-lock.service.ts:149-151`
   ```ts
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS "acquired"`,
      [this.lockName],
   ```
   `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-server/src/engine/workspace-manager/workspace-cleaner/crons/clean-suspended-workspaces.job.ts:19`, `:39-43`, `:93-97`
   ```ts
   const CLEAN_SUSPENDED_WORKSPACES_LOCK_NAME = 'clean-suspended-workspaces-job';
   ...
   async handle(): Promise<void> {
    const advisoryLockResult =
      await this.postgresAdvisoryLockService.tryWithLock(
        CLEAN_SUSPENDED_WORKSPACES_LOCK_NAME,
        async () => {
   ...
    if (!advisoryLockResult.acquired) {
      this.logger.log(
        'Skipping suspended workspace cleanup because another execution is running',
      );
    }
   ```
   (`gh search code` found `PostgresAdvisoryLockService` used in this cron job and in `workspace-deletion-application-uninstall.job.ts`, `workspace.service.ts`, `application-tarball.service.ts`; not in every cron job.)

### Docs

https://docs.twenty.com/developers/self-host/capabilities/setup (source: `packages/twenty-docs/developers/self-host/capabilities/setup.mdx:250-257`):

> "After configuring Gmail, Google Calendar, or Microsoft 365 integrations, you need to start the background jobs that sync data. Register the following recurring jobs in your worker container:"
>
> ```
> # from your worker container
> yarn command:prod cron:messaging:messages-import
> ```

Same page:

> "**Multi-Container Deployments:** When using database configuration (`IS_CONFIG_VARIABLES_IN_DB_ENABLED=true`), both server and worker containers read from the same database."

https://docs.twenty.com/developers/self-host/capabilities/docker-compose:

> "All environment variables must be declared in the `docker-compose.yml` file at the server and/or worker level, depending on the variable."

Helm defaults one worker replica with the same command: `twentyhq/twenty@c168183b17e89fbc8747f8ed333d90466ebf85f4:packages/twenty-docker/helm/twenty/values.yaml:142-147`

```yaml
# Worker deployment
worker:
  enabled: true
  replicaCount: 1
  image: {}
  command: ['yarn', 'worker:prod']
```

Side note: Twenty also builds an all-in-one **development** image with s6-overlay (`Dockerfile:322-324`: `LABEL org.opencontainers.image.description="All-in-one Twenty image for local development and SDK usage. Includes PostgreSQL, Redis, ClickHouse, server, and worker."` / `ENTRYPOINT ["/init"]`); production compose uses the two-service layout above.

### Not confirmed (Twenty)

- Docs text that mentions `DISABLE_CRON_JOBS_REGISTRATION` (not found in the self-host docs folder; only in compose and entrypoint).
- Whether the docs' "Register ... in your worker container" instruction is still needed now that `cron:register:all` runs from the entrypoint; the docs and the entrypoint describe different places, and no doc reconciles them.
- Whether every cron job body is protected by a DB lock (only the ones listed above were found).

---

## 3. Homarr (homarr-labs/homarr)

Homarr changed design during v1. Three pins are cited: `v1.61.0` (separate tasks process), `v1.77.2` (last v1, embedded), `dev` (v2, embedded).

### Mechanism today (v1.62+ and v2): in-process scheduler started from Next.js `instrumentation.ts`

`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:apps/nextjs/src/instrumentation.ts:1-7`

```ts
export async function register() {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return
	if (process.env.NODE_ENV !== 'production') return

	const { registerNodeInstrumentation } = await import('./instrumentation-node')
	await registerNodeInstrumentation()
}
```

`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:apps/nextjs/src/instrumentation-node.ts:5-13`

```ts
  const startTasksAsync = async () => {
    try {
      const tasks = await import("@homarr/tasks");
      // Cron run-on-start hooks can perform slow external work. Keep dashboard
      // readiness independent, but never leave the process permanently degraded.
      void tasks.startupPromise.catch((cause: unknown) => {
        logger.error(new Error("Failed to start embedded tasks service", { cause }));
        process.exit(1);
      });
```

(`v1.77.2` has the same code inline in `apps/nextjs/src/instrumentation.ts:1-38`, `homarr-labs/homarr@18dafb1276d8ff66d1be1b149c74f80dbf94f78d`.)

`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:apps/tasks/src/main.ts:8-12`

```ts
export const startupPromise = (async () => {
	await onStartAsync()
	await jobGroup.initializeAsync()
	await jobGroup.startAllAsync()
})()
```

Scheduling is in-memory `croner`, with the interval overridable from a DB table: `homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:packages/cron-jobs-core/src/creator.ts:79-95`

```ts
const configuration = await db.query.cronJobConfigurations.findFirst({
	where: (cronJobConfigurations, { eq }) => eq(cronJobConfigurations.name, name),
})

const cronExpression = options.preventCustomInterval
	? defaultCronExpression
	: (configuration?.cronExpression ?? defaultCronExpression)

const scheduledTask = new Cron(
	cronExpression,
	{
		name,
		timezone: creatorOptions.timezone,
		paused: true,
	},
	() => void catchingCallbackAsync(),
)
```

(`creator.ts:1`: `import { Cron } from "croner";`)

Next.js 16 bundled docs (this repo's `node_modules/next` 16.3.4, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md:18`):

> "The file exports a `register` function that is called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests."

Homarr docs, https://homarr.dev/docs/advanced/development/getting-started (source `apps/docs/docs/advanced/development/getting-started.mdx:64-76`):

> "`bun run dev` starts only Next.js. When your work needs scheduled tasks or live subscriptions, run the relevant service in a separate terminal alongside it" "The WebSocket service listens on port 3001. Production startup embeds both services, so these extra commands are only needed for development."

https://homarr.dev/docs/management/tasks:

> "The tasks page controls scheduled background jobs used by integrations and widgets. It is available to administrators under **Management → Tools → Tasks**."

### Earlier v1 mechanism (up to v1.61.0): several node processes in one container started by `run.sh`

`homarr-labs/homarr@4635c51fe1b47d1112ed4fdc64f526609dab8124:scripts/run.sh:19-20`

```sh
# Cron job API key is generated every time the container starts as it is required for communication between nextjs-api and tasks-api
export CRON_JOB_API_KEY=$(openssl rand -base64 32)
```

`...scripts/run.sh:43-50`

```sh
node apps/tasks/tasks.cjs &
TASKS_PID=$!

node apps/websocket/wssServer.cjs &
WSS_PID=$!

node apps/nextjs/server.js &
NEXTJS_PID=$!
```

`homarr-labs/homarr@4635c51fe1b47d1112ed4fdc64f526609dab8124:Dockerfile:46-47`, `:70-71`

```dockerfile
COPY --from=builder /app/apps/tasks/tasks.cjs ./apps/tasks/tasks.cjs
COPY --from=builder /app/apps/websocket/wssServer.cjs ./apps/websocket/wssServer.cjs
...
ENTRYPOINT [ "/app/entrypoint.sh" ]
CMD ["sh", "run.sh"]
```

No supervisord or s6: a bash script backgrounds the processes and traps SIGTERM (`run.sh:52-67`).

The change: commit `a1aa5505a365688b456090a882770e561479833e` "perf(memory): combine 3 node processes into one (#5600)", https://github.com/homarr-labs/homarr/pull/5600 (merged 2026-05-01), first released in v1.62.0. PR body:

> "- During idle between 200 and 300MB
>
> - During actual usage (with some integrations etc.) max 500MB
>
> Usage before: 600MB - 1GB"

### Docker shipping today

`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:Dockerfile:49-50`, `:61-62`

```dockerfile
COPY --from=builder /app/apps/nextjs/.output/standalone ./
COPY scripts/run.sh ./run.sh
...
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["sh", "run.sh"]
```

`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:scripts/run.sh:81-98`

```sh
nginx -g 'daemon off;' &
NGINX_PID=$!

if [ "$REDIS_IS_EXTERNAL" = "true" ]; then
    ...
else
    echo "Starting internal Redis server"
    redis-server /app/redis.conf &
    REDIS_PID=$!
fi
...
node apps/nextjs/server.js &
NEXTJS_PID=$!
```

### Duplicate prevention

- **Across replicas: none found.** No lock, leader election or Redis coordination in `packages/cron-jobs-core/src` or `packages/cron-jobs/src` (`grep -i "lock|mutex|leader"` returned nothing). Each Next.js process that runs `register()` starts its own `croner` schedules.
- **Within one process:** a global singleton so the job group is created once even if the module is evaluated more than once: `homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c:packages/cron-jobs/src/index.ts:14-20`
  ```ts
  declare global {
  	var cronJobs: ReturnType<typeof getJobGroup> | undefined
  }
  ```

global.cronJobs ??= getJobGroup();

export const jobGroup = global.cronJobs;

````
- v2 rejects MySQL and defaults to SQLite on the container volume (`scripts/run.sh:31-41` "MySQL is no longer supported in v2"; `Dockerfile:54-56` `ENV DB_URL='/appdata/db/db.sqlite'`), which implies one instance per data volume (inference, not a documented statement).

### Not confirmed (Homarr)
- Any Homarr docs statement that multiple replicas are unsupported or supported (the Helm docs list `replicaCount` default `1` and `autoscaling.maxReplicas` `100`, `apps/docs/docs/getting-started/installation/helm.md:388-389,479`, with no statement on cron duplication).
- Whether running two Homarr containers against one database would run each task twice (very likely from the code, but not tested or documented).

---

## 4. Karakeep (karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea)

### Mechanism: a separate workers process (`apps/workers`) in the same container, supervised by s6-overlay; `node-cron` enqueues into a SQLite job queue (liteque)

Image targets (one "aio" image runs both; legacy split images still built):
`karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea:docker/Dockerfile:192-200`
```dockerfile
ENTRYPOINT ["/init"]

################# The AIO ##############

FROM aio_builder AS aio

RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/init-db-migration \
  /etc/s6-overlay/s6-rc.d/user/contents.d/svc-web \
  /etc/s6-overlay/s6-rc.d/user/contents.d/svc-workers
````

`...docker/Dockerfile:216-222`

```dockerfile
FROM aio_builder AS workers

# In the current implemtation, the workers assume the migration
# is done for them.
RUN rm /etc/s6-overlay/s6-rc.d/svc-workers/dependencies.d/init-db-migration \
    && touch /etc/s6-overlay/s6-rc.d/user/contents.d/svc-workers
ENV USING_LEGACY_SEPARATE_CONTAINERS=true
```

s6 service scripts: `docker/root/etc/s6-overlay/s6-rc.d/svc-web/run:4-5` → `cd /app/apps/web;` / `exec node server.js;` `docker/root/etc/s6-overlay/s6-rc.d/svc-workers/run:4-5` → `cd /app/apps/workers;` / `exec node dist/index.js` `docker/root/etc/s6-overlay/s6-rc.d/svc-workers/dependencies.d/init-db-migration` (file exists: workers start after the one-shot migration).

Compose ships one app service (plus chrome and meilisearch): `karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea:docker/docker-compose.yml:2-3`

```yaml
web:
  image: ghcr.io/karakeep-app/karakeep:${KARAKEEP_VERSION:-release}
```

Docs, https://docs.karakeep.app/administration/legacy-container-upgrade (source `docs/docs/06-administration/07-legacy-container-upgrade.md:3`):

> "Karakeep's 0.16 release consolidated the web and worker containers into a single container and also dropped the need for the redis container."

https://docs.karakeep.app/development/architecture (source `docs/docs/08-development/04-architecture.md:5-6`):

> "Webapp: NextJS based using sqlite for data storage." "Workers: Consume the jobs from sqlite based job queue and executes them"

The periodic part: an hourly `node-cron` schedule that enqueues one job per feed, with an idempotency key per feed per hour: `karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea:apps/workers/workers/feedWorker.ts:60-62`, `:73-80`, `:94-103`, `:109-112`

```ts
export const FeedRefreshingWorker = cron.schedule(
  "0 * * * *",
  async () => {
...
      const currentHour = new Date();
      currentHour.setMinutes(0, 0, 0);
      const hourlyWindow = currentHour.toISOString();
...
        const idempotencyKey = `${feed.id}-${hourlyWindow}`;
...
        await FeedQueue.enqueue(
          {
            feedId: feed.id,
          },
          {
            idempotencyKey,
            groupId: feed.userId,
            delayMs,
          },
        );
...
  {
    runOnInit: false,
    scheduled: false,
  },
```

Started only when the feed worker is enabled: `karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea:apps/workers/index.ts:147-153`

```ts
if (workers.some(w => w.name === 'feed')) {
	feedRefreshingWorker?.start()
}

if (workers.some(w => w.name === 'backup')) {
	backupSchedulingWorker?.start()
}
```

Workers are switchable by env (`apps/workers/index.ts:114-125`; docs https://docs.karakeep.app/configuration/environment-variables, source `docs/docs/03-configuration/01-environment-variables.md:10`: "`WORKERS_ENABLED_WORKERS` ... Comma separated list of worker names to enable. If set, only these workers will run.").

Queue on SQLite in the data directory: `karakeep-app/karakeep@75aeaaa4eb71b1d3143d7bdc6b88c66fbcfb5fea:packages/plugins/queue-liteque/src/index.ts:65-68`

```ts
class LitequeQueueClient implements QueueClient {
  private db = buildDBClient(path.join(serverConfig.dataDir, "queue.db"), {
    walEnabled: serverConfig.database.walMode,
  });
```

Dependencies: `apps/workers/package.json:33` `"liteque": "^0.9.1",` and `:49` `"node-cron": "^3.0.3",`.

### Duplicate prevention

1. **Idempotent enqueue**: liteque has a unique index on `(queue, idempotencyKey)` and inserts with `ON CONFLICT DO NOTHING`, so a second enqueue of the same feed in the same hour is dropped. `karakeep-app/liteque@8ce63c873f83b759efcf05a6db0cf97695628670:src/drizzle/0001_wandering_giant_man.sql`
   ```sql
   ALTER TABLE `tasks` ADD `idempotencyKey` text;--> statement-breakpoint
   CREATE UNIQUE INDEX `tasks_queue_idempotencyKey_unique` ON `tasks` (`queue`,`idempotencyKey`);
   ```
   `karakeep-app/liteque@8ce63c873f83b759efcf05a6db0cf97695628670:src/queue.ts:45-60`
   ```ts
    const [job] = await this.db
      .insert(tasksTable)
      .values({
        ...
        idempotencyKey: opts.idempotencyKey,
        ...
      })
      .onConflictDoNothing({
        target: [tasksTable.queue, tasksTable.idempotencyKey],
      })
      .returning();
   ```
2. **Single consumer per job**: dequeue claims a row with a compare-and-swap on a random `allocationId`, and a running job gets an `expireAt` lease after which another runner may retake it. `karakeep-app/liteque@8ce63c873f83b759efcf05a6db0cf97695628670:src/queue.ts:155-172`

   ```ts
   const result = txn
   	.update(tasksTable)
   	.set({
   		status: 'running',
   		numRunsLeft: job.numRunsLeft - 1,
   		allocationId: generateAllocationId(),
   		expireAt: new Date(new Date().getTime() + options.timeoutSecs * 1000),
   	})
   	.where(
   		and(
   			eq(tasksTable.id, job.id),

   			// The compare and swap is necessary to avoid race conditions
   			eq(tasksTable.allocationId, job.allocationId),
   		),
   	)
   ```

   `...src/queue.ts:106-110` (expired running jobs are re-claimable): `// Expired and still has attempts left` / `eq(tasksTable.status, "running"),` / `lt(tasksTable.expireAt, new Date()),`

### Not confirmed (Karakeep)

- Whether the idempotency key was designed for several worker processes, or only for restarts within the hour (no comment or doc says which).
- Whether multiple Karakeep containers are supported at all with the SQLite queue on a shared volume (no doc found). The repo also contains a `packages/plugins/queue-restate` queue backend; its purpose and documentation were not checked (no mention found in `docs/docs`).
- How the `backup` scheduling worker deduplicates (not read).

---

## Patterns that transfer to a Next.js 16 + MySQL hub without Redis (inference, labelled as such)

These are observations from the code above, not recommendations from any of the projects' docs.

- **Process shape.** Three shapes are in use: a separate worker container from a separate image (Langfuse), the same image with a different command (Twenty; Karakeep's legacy split), and in-process in the Next.js server via `instrumentation.ts` `register()` (Homarr since v1.62, PR #5600, chosen for memory). Karakeep and older Homarr show the middle ground of a second process in the same container (s6-overlay, or a bash `run.sh`).
- **Duplicate prevention without Redis** is done in the database by two projects, with patterns that map to MySQL:
  - a lease row claimed with a conditional `UPDATE ... WHERE state = ? AND job_started_at = ?` plus a stale-lease takeover (Langfuse `cron_jobs`, Langfuse `background_migrations` with `workerId` + `lockedAt` heartbeat);
  - a unique key on `(job, time window)` with an insert that ignores conflicts, so each window runs once (Karakeep/liteque idempotency key);
  - a session-level advisory lock around the job body (Twenty `pg_try_advisory_lock`; MySQL's counterpart would be `GET_LOCK(name, 0)`, not verified here against MySQL docs).
- **With Redis**, both BullMQ users rely on `upsertJobScheduler` with a fixed scheduler id so every replica can (re)register on boot without creating duplicates; Twenty additionally registers from the server container only.
- The in-process approach (Homarr) has no cross-replica guard in its code; adding replicas would need one of the DB patterns above.
