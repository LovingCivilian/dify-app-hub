# B3b plan research: the library APIs the plan relies on

Date: 2026-10-10. Branch `feat/backend-b3b-directory` at `4eb07c21`. Scope: confirm against the current docs and sources the APIs that the B3b plan (directory sign-in and sync, spec §6–§8) will use, and fill the gaps the 2026-10-09 reports (`../ldap-client.md`, `../periodic-jobs.md`, `../nextauth-drizzle-antd.md`) left. Installed: Next.js 16.3.4, next-auth 4.24.15, drizzle-orm and drizzle-kit 1.0.0-rc.3, zod 4.6.5, vitest 4.1.7, TypeScript 5.9.

Method: npm registry (`npm view`); the package tarballs of `ldapts@9.2.0` and `croner@10.0.1`, unpacked under `tmp/b3b-plan-research/pkg-*` and only read, never run; GitHub raw files at pinned commits; Context7 (`/hexagon/croner`, `/vitest-dev/vitest/v4.1.6`, `/colinhacks/zod/v4.6.5`); the docs bundled in `node_modules/next/dist/docs/`; the installed `node_modules` sources; MySQL 8.4 manual pages crawled with crawl4ai. One live check was run on a throwaway `mysql:8.4` container (8.4.11, tmpfs, no published port, removed afterwards; the owner's stack was not touched). Working copies are in `tmp/b3b-plan-research/` (git-ignored).

## Headline: what contradicts or sharpens the spec and the 2026-10-09 research

1. **MySQL 8.4 accepts drizzle-kit's table-qualified CHECK columns.** Live on 8.4.11: `ALTER TABLE … ADD CONSTRAINT … CHECK ((`users`.`source` = 'local' AND …))` and an inline `CHECK(`t2`.`a` > 0)` are both accepted and stored unqualified; violations raise `ERROR 3819 (HY000): Check constraint '…' is violated.` This closes the spec §14 item. (§4)
2. **A non-violating `MODIFY COLUMN` on a CHECK-referenced column succeeded** (varchar(255) → varchar(300) on `users.password`, 8.4.11). `nextauth-drizzle-antd.md` §D "Consequence 2" says any later drizzle-kit `MODIFY COLUMN` on these columns fails; the manual's sentence sits under "If a table alteration causes a violation of an enforced `CHECK` constraint". Treat that consequence as not established; renames and type changes were not probed. (§4)
3. **drizzle-kit writes MySQL CHECK SQL without inlining parameters** (`dialect.sqlToQuery(value).sql`, unlike its Postgres path, which calls `inlineParams()`). A value interpolated as `${'local'}` would reach the migration as `?`. Write literals inside the `sql` template. (§4)
4. **croner's DST claim and its own test differ.** The README says "Jobs scheduled during DST gaps are skipped; jobs in DST overlaps run once at first occurrence." Its test for OCPS 1.4 asserts that a 02:30 job on a spring-forward day runs at 03:30 EDT, which is moved, not skipped. OCPS 1.4 recommends skipping. For the default `0 * * * *`, the missing hour's slot falls on the same instant as the next slot. The container's default zone is UTC, which has no DST. (§2)
5. **croner details the plan must design around** (§2):
   - An invalid `timezone` is not caught by the constructor. It throws only at `nextRun()` or `schedule()`.
   - `'off'` throws, as wanted.
   - The default `auto` mode also accepts 6- and 7-field patterns, where the first field is seconds.
   - A duplicate `name` throws.
   - `protect` only holds while the callback's returned promise is pending.
   - Without `catch`, a failing run becomes an unhandled rejection.
6. **`previousRuns(1)`** returns the latest scheduled time strictly before the reference's whole second. When the reference falls exactly on a slot, it returns the slot before. The function lists pattern times, not run history. (§2)
7. **A `register()` that throws aborts the server's start** ("An error occurred while loading instrumentation hook"). To keep spec §7.1's rule (a bad `LDAP_*` block fails the first request, not the start), the schedule start must catch its own configuration errors. The App Router has no documented shutdown hook, so a run is cut on SIGTERM. (§5)
8. **ldapts accepts `sizeLimitExceeded` silently whenever `sizeLimit` is set, paged or not.** The sync search must never set `sizeLimit`, or a server-side cap gives a partial result that looks complete. The server-side `timeLimit` defaults to 10 s per request. (§1)
9. **Vitest documents `--project=!pattern`.** Homarr uses it exactly so (`"test": "vitest run --project \"!integration\" …"`, `"test:integration": "vitest run --project integration --maxWorkers 2"`). Directus gives the integration project its own `globalSetup` (Docker Compose `up -d --wait` / `down -v`), `hookTimeout` and `testTimeout`. (§3)
10. **`z.url({ protocol: /^ldaps?$/ })` is documented, but the protocol check alone accepts `ldap:host` (no `//`, empty hostname).** zod's `://` guard applies only to its HTTP regex. Add a `hostname` regex or a refine. (§8)
11. **`FilterParser.parseString` is a public root export and is the parser `search()` itself uses** (`Client.ts:642`). It is not mentioned in the README. It throws a plain `Error`. (§7)

---

## 1. ldapts

**Verdict: pin `ldapts@9.2.0`; it is still `latest`, and nothing after it changes the API.**

### Registry and repository

- npm, read 2026-10-10: `latest` is 9.2.0, published 2026-09-15T21:05:17Z. 9.1.0 came out the same day and 9.0.0 on 2026-07-11. `gitHead` is `b38cfc3ecfa71ebd59ddfcf2f7d49887ae84fad2`.
- GitHub: no release after v9.2.0. The commits since 2026-10-08 are Renovate chores only (`d43d22a7` on 2026-10-09: "chore(deps): update pnpm to v12.10.1").
- The only breaking release in the 9.x line is 9.0.0. CHANGELOG at b38cfc3: "Node.js >= 22 is now required." and "The deprecated `Filter#escape` instance method has been removed. Use the static `Filter.escape()` instead."
- Package: `"type": "module"`, `engines.node >=22`, one dependency (`strict-event-emitter-types` 2.0.0). The `exports` map is:

  `{ ".": { "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" }, "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" } } }`

- Runtime imports are Node built-ins only: `node:assert`, `node:util`, `node:crypto`, `node:net`, `node:tls`, `node:events`.

### Types at v9.2.0 (`dist/index.d.mts`, same content as `src/` in the tarball)

**`ClientOptions`** (d.ts:1107-1152):

- `url: string`: "A valid LDAP URL (proto/host/port only)".
- `timeout?: number`: "Milliseconds client should let operations live for before timing out (Default: no timeout)".
- `connectTimeout?: number`.
- `tlsOptions?: tls.ConnectionOptions`: "Additional options passed to TLS connection layer when connecting via ldaps://".
- `strictDN?: boolean`: "(Default: true)".
- `createConnection?: typeof net.connect`.
- `createSecureConnection?: typeof tls.connect`.
- `autoRebind?: boolean`.

Source: the constructor sets `timeout ??= 0` and `connectTimeout ??= 0` (`src/Client.ts:200-201`). It sets `secure = isSecureProtocol || hasTlsOptions` (`:219-221`): any defined `tlsOptions` value means direct TLS, even for `ldap://`, as `ldap-client.md` §3.1 found. **`strictDN` is only normalised (`:203`); nothing else in `src/` reads it.**

**`Client` methods** (d.ts:1210-1325):

- `startTLS(options?: tls.ConnectionOptions, controls?: Control | Control[]): Promise<void>`.
- `bind(dnOrSaslMechanism: DN | SaslMechanism | string, password?: string, controls?): Promise<void>`.
- `search(baseDN: DN | string, options?: SearchOptions, controls?): Promise<SearchResult>`.
- `searchPaginated(baseDN, options?, controls?): AsyncGenerator<SearchResult>`.
- `unbind(): Promise<void>`.
- `[Symbol.asyncDispose]()`.
- The getters `isConnected` and `isBound` (see §7).

**`SearchOptions`** (d.ts:1160-1205):

- `scope?: "base" | "children" | "one" | "sub" | "subordinates"`.
- `derefAliases?`, `returnAttributeValues?`.
- `sizeLimit?: number`: "A value of zero indicates no limit … the smaller of the client-requested and server-imposed size limits will be enforced".
- `timeLimit?: number`: "in seconds … A value of zero indicates no limit".
- `paged?: SearchPageOptions | boolean`.
- `filter?: Filter | string`.
- `attributes?: string[]`.
- `explicitBufferAttributes?: string[]`: "List of attributes to explicitly return as buffers".

Defaults in `src/messages/SearchRequest.ts:41-47`: `scope ?? 'sub'`, `derefAliases ?? 'never'`, `sizeLimit ?? 0`, **`timeLimit ?? 10`**, `attributes ?? []`.

**`SearchResult`** (d.ts:1206-1209): `{ searchEntries: Entry[]; searchReferences: string[] }`.

**`Entry`** (d.ts:1082-1085): `{ dn: string; [index: string]: Buffer | Buffer[] | string[] | string }`. The value shapes, and the case-sensitive `explicitBufferAttributes` match, are as in `ldap-client.md` §3.5 and §3.7.

**Filters:**

- `escapeFilter(strings: TemplateStringsArray, ...values: (Buffer | boolean | number | string)[]): string` (d.ts:702). Its doc comment: "Every interpolated value is escaped with {@link Filter.escape} (RFC 2254 / RFC 4515)".
- `static Filter.escape(input: Buffer | string): string` (d.ts:684).
- `new EqualityFilter({ attribute?: string; value?: Buffer | string })` (d.ts:734-747).
- `new AndFilter({ filters: Filter[] })` (d.ts:705-715).

README "Filter Strings" (README.md:551-575 at v9.2.0): "The easiest way to do that is the `escapeFilter` tagged template literal, which escapes every interpolated value while leaving the filter syntax itself alone … Interpolated strings and Buffers are escaped; numbers and booleans are stringified."

**Errors:**

- `abstract class ResultCodeError extends Error { code: number }` (d.ts:379-382). The source sets `this.name = 'ResultCodeError'` and the message `` `${message} Code: 0x${code.toString(16)}` `` (`src/errors/resultCodeErrors/ResultCodeError.ts:1-12`).
- Each subclass sets its own `name` and calls `Object.setPrototypeOf(this, <Class>.prototype)`, so `instanceof` works per class. Codes from the sources:

  | Class                          | Code |
  | ------------------------------ | ---- |
  | `InvalidCredentialsError`      | 49   |
  | `NoSuchObjectError`            | 32   |
  | `SizeLimitExceededError`       | 4    |
  | `UnavailableError`             | 52   |
  | `BusyError`                    | 51   |
  | `StrongAuthRequiredError`      | 8    |
  | `ConfidentialityRequiredError` | 13   |
  | `TimeLimitExceededError`       | 3    |

- All are exported from the package root: `src/index.ts:4` is `export * from './errors/index.js'`.

### `paged` together with `sizeLimit` (source, `src/Client.ts:618-626, 795`)

The page size:

```ts
let pageSize = 100
if (typeof options.paged === 'object' && options.paged.pageSize) {
	pageSize = options.paged.pageSize
} else if (options.sizeLimit && options.sizeLimit > 1) {
	pageSize = options.sizeLimit - 1
}
```

The paging control is sent only when `paged` is truthy (`:629-637`). The result check:

```ts
if (
	result?.status !== MessageResponseStatus.Success &&
	!(result?.status === MessageResponseStatus.SizeLimitExceeded && searchRequest.sizeLimit)
)
	throw StatusCodeParser.parse(result)
```

`SearchPageOptions.pageSize` (d.ts:1153-1159): "If the page size is greater than or equal to the sizeLimit value, the server should ignore the control as the request can be satisfied in a single page."

Consequences:

- **Sign-in:** `sizeLimit: 2` without `paged` returns at most two entries, and a size-limit result is accepted.
- **Sync:** `paged: { pageSize: 500 }` and **no `sizeLimit`**. A server-side size cap then raises `SizeLimitExceededError`, which is the `failed` safety stop. With any `sizeLimit` set, the same cap would silently cut the result short.
- Each page is its own request carrying the default `timeLimit` of 10 s. A slow server gives `TimeLimitExceededError` (code 3).

README `paged` row (README.md:472): "Note that even with paged options the result will contain all of the search results. If you need to paginate over results have a look at to searchPaginated". `searchPaginated` (README.md:488-513) yields one `SearchResult` per page.

### Next 16 bundling

- `serverExternalPackages.md` (bundled docs) and its list `node_modules/next/dist/lib/server-external-packages.jsonc` do **not** name `ldapts` or `croner`. Their only scheduler entry is `node-cron` (`serverExternalPackages.md:70`, jsonc line 62).
- The doc: "Dependencies used inside Server Components and Route Handlers will automatically be bundled by Next.js. If a dependency is using Node.js specific features, you can choose to opt-out specific dependencies from the Server Components bundling and use native Node.js `require`." So ldapts is bundled by default, and `serverExternalPackages: ['ldapts']` is the documented fallback.

**Not confirmed:**

- That ldapts bundles cleanly under Turbopack for `next build` (not built).
- Whether a server can send an empty last page with a cookie. The paging recursion stops when a page has no entries and no references (`Client.ts:808`).

**Sources:** npm `ldapts` (2026-10-10); `ldapts/ldapts@b38cfc3ecfa71ebd59ddfcf2f7d49887ae84fad2` (README.md, CHANGELOG.md, src/Client.ts, src/messages/SearchRequest.ts, src/errors/resultCodeErrors/\*.ts, src/index.ts; tarball copy `tmp/b3b-plan-research/pkg-ldapts/package/`); GitHub commits list read 2026-10-10; `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`.

---

## 2. croner

**Verdict: pin `croner@10.0.1`, latest since 2026-02-01.**

- 11.0.0 exists only as `dev` prereleases (11.0.0-dev.3 on 2026-10-08).
- The npm `gitHead` is `adc86215e92e4f7cceaf8127dfcd1b514ef7bafc` ("Fix dist structure and bump to 10.0.1 (#342)").
- MIT, zero dependencies and zero imports, `engines.node >=18.0`.
- `exports`: `import` (`dist/croner.js`, `.d.ts`), `require` (`dist/croner.cjs`, `.d.cts`), `browser` (UMD).
- Homarr pins the same version (`homarr-labs/homarr@ad15cfc3:package.json` catalog `"croner": "10.0.1"`).

### API (`dist/croner.d.ts`; README.md at adc86215)

- **Constructor.** `new Cron<T>(pattern: string | Date, fnOrOptions1?: CronOptions<T> | CronCallback<T>, fnOrOptions2?)`. `CronCallback<T> = (self, context: T) => void | Promise<void>`.
- **`CronOptions`:**
  - `name?`: "the job will be added to the `scheduledJobs` array".
  - `paused?` (default false).
  - `catch?: boolean | ((e: unknown, job: Cron) => void)`.
  - `protect?: boolean | ((job: Cron) => void)`.
  - `timezone?: string`: README "Timezone in Europe/Stockholm format".
  - `utcOffset?`: README "This does not take care of daylight savings time, you probably want to use option `timezone` instead".
  - `unref?`, `maxRuns?`, `interval?`, `startAt?`, `stopAt?`, `domAndDow?`.
  - `mode?: "auto" | "5-part" | "6-part" | "7-part" | "5-or-6-parts" | "6-or-7-parts"`. The d.ts says `"5-part"` is "Traditional 5-field cron (minute-level precision, seconds forced to 0, years wildcarded)". **`mode` is in the d.ts only, not in the README options table or the docs site's configuration page.**
  - `context?`, `alternativeWeekdays?`, `sloppyRanges?`.
- **Methods:**
  - `nextRun(prev?): Date | null`.
  - `nextRuns(n, previous?): Date[]`.
  - `previousRuns(n: number, reference?: Date | string): Date[]`. d.ts: "Find previous n runs, based on supplied date … reference - Date to start from (defaults to now) … Previous n run times in reverse chronological order (most recent first)". README: "Get an array of Dates, containing previous n scheduled runs."
  - `stop()`: "Running this will forcefully stop the job, and prevent furter exection. `.resume()` will not work after stopping. It will also be removed from the scheduledJobs array if it were named."
  - `pause()`, `resume()`, `trigger()`, `isBusy()`, `previousRun()`, `currentRun()`, `match()`.
- README: "The job will be sceduled to run at next matching time unless you supply option `{ paused: true }`."

### Semantics read from the source (`src/croner.ts`, `src/date.ts`, `src/pattern.ts` at adc86215)

- **No timer without a function.** The constructor calls `this.schedule()` only when a callback is given (`croner.ts:215-219`, "Allow shorthand scheduling"). So `new Cron(pattern, { timezone })` with no function parses the pattern and starts nothing. That is the way to validate a pattern and to compute `nextRun()` or `previousRuns()` for the status panel. Pass no `name` there: a named instance is pushed to `scheduledJobs`, and a second instance with the same name throws "Cron: Tried to initialize new named job '…', but name already taken." (`croner.ts:208`). Homarr calls `.stop()` before it builds a replacement named job (`packages/cron-jobs/src/job-manager.ts:35-46`).
- **Pattern validation happens in the constructor.**
  - `CronPattern.parse()` throws `TypeError("CronPattern: invalid configuration format ('" + pattern + "'), exactly five, six, or seven space separated parts are required.")` (`pattern.ts:121`). So **`'off'` throws**, and the app maps `off` itself.
  - In the default `auto` mode, 6 fields mean "SECOND MINUTE HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK" and 7 add a year (README "Pattern"). The README table says "Seconds | Optional … defaults to 0".
  - So `0 0 * * * *` parses as hourly with seconds. To accept only 5 fields, use the d.ts-only `mode: '5-part'`, or count the fields in zod.
  - Nicknames such as `@hourly` are accepted. `@reboot` throws.
- **An invalid timezone is not checked by the constructor.** Option validation (`R()` in `dist/croner.js`, `src/options.ts`) touches `timezone` only through `startAt` and `stopAt`.
  - It fails when a date is converted: `CronDate.fromDate` throws `TypeError("CronDate: Failed to convert date to timezone '<tz>'. This may happen with invalid timezone names or dates. Original error: toTZ: Invalid timezone …")` (`date.ts:277`). The inner error is the `RangeError` thrown by `Intl.DateTimeFormat`.
  - `nextRun()` and `previousRuns()` throw it. A constructor with a callback throws it too, through `schedule()` → `msToNext()`.
  - **Validate as `new Cron(pattern, { timezone }).nextRun()` inside try/catch.**
- **`protect`.** `_trigger` sets `blocking = true`, runs `await this.fn(...)`, and clears `blocking` in `finally` (`croner.ts:518-552`). `_checkTrigger` skips a due run while `blocking && protect` (`:576-596`). **The callback must return the run's promise** (`async () => { await runSync(...) }`). Homarr's `() => void catchingCallbackAsync()` (`packages/cron-jobs-core/src/creator.ts:94`) returns `undefined`, so `protect` would not hold for it. Homarr does not pass `protect`.
- **`catch`.** With `catch` set, an error goes to the callback (`croner.ts:527-540`). Without it, `_trigger()` rejects, and `_checkTrigger` calls it without awaiting ("We do not await this", `:586-587`), so the error becomes an unhandled rejection. Next 16.3.4 logs those instead of exiting (`node_modules/next/dist/server/node-environment-extensions/process-error-handlers.js:75-99`; source, not docs). Use croner's documented `catch` to route errors through `lib/error-log.ts`.
- **`previousRuns(1)`.** `_previous` builds a `CronDate` at the reference time (default now), and `decrement()` first steps one second back ("Move to previous second", `date.ts:653-662`, ms reset to 0), then searches backwards. The result is **the latest pattern time strictly before the reference's whole second.** A reference exactly on a slot gives the slot before. It enumerates pattern times. The instance's own last trigger is `previousRun()`, a different thing.
- The timer is capped at 30 s and re-armed (`W = 30*1e3` in `dist/croner.js`). That only affects how often croner wakes.

### Daylight saving time

- README "Pattern" (also `docs/src/usage/pattern.md:38`): "Proper DST handling: Jobs scheduled during DST gaps are skipped; jobs in DST overlaps run once at first occurrence."
- croner's own test, `test/ocps-1.4.test.ts:99-142`, titled "OCPS 1.4: DST Gap (Spring Forward) - job should be skipped", schedules `"0 30 2 12 3 *"` in `America/New_York` and asserts `run.toISOString() === "2023-03-12T07:30:00.000Z"`, "Should be adjusted to 3:30 AM EDT". The overlap test asserts "Should not run twice on the same day".
- The mechanism is `fromTZ()` in `src/helpers/timezone.ts`: "Neither guess matches exactly - we're in a DST gap (spring forward) / Return the time after the gap (the later of the two)", and "If the earlier time also produces the same local time, we're in a DST overlap" (it returns the earlier instant).
- OCPS 1.4 §4.3.1 (`open-source-cron/ocps@df6f4c38:increments/OCPS-increment-1.4.md:62-67`): "DST Gap (Spring Forward): When a scheduled time falls into a DST gap (an hour that does not exist), the job **SHOULD be skipped**. It should not run earlier or be delayed until after the transition." and "DST Overlap (Fall Back): … the job **SHOULD run only once**, at the first occurrence."

**Reading for the hub:**

- A time-of-day slot inside the gap (for example `30 2 * * *`) runs once, after the gap (03:30), not "skipped".
- For `0 * * * *`, the nonexistent 02:00 resolves to the 03:00 instant. `_checkTrigger` reschedules from the trigger time, so one run happens at 03:00.
- In the fall-back hour, only the first 01:00 runs.
- The run claim keys on the scheduled instant (`schedule:<time>`), so a gap slot that lands on the same instant as the next slot cannot make two rows.
- Without `LDAP_SYNC_TIMEZONE` the zone is the process's (UTC in the image), which has no DST.

### Homarr precedent (`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c`)

- `packages/cron-jobs-core/src/creator.ts:87-95` passes `new Cron(cronExpression, { name, timezone: creatorOptions.timezone, paused: true }, () => void catchingCallbackAsync())`. The callback wraps its own try/catch (`:36-72`); there is no `protect` and no `catch`.
- Jobs start through `.resume()` and stop through `.pause()` (`packages/cron-jobs-core/src/group.ts:65,77,99,106`).
- Patterns are typed by a template-literal type, not checked at runtime (`packages/cron-jobs-core/src/validation.ts:22-25`, "It allows cron expressions with 5 or 6 parts").

**Not confirmed:**

- The 03:00 collapse for an hourly schedule in a DST zone was read from the source, not run.
- Whether croner's `nextRun()` equals `previousRuns(1)` plus one period across a DST change was not run.
- Validating the timezone with `Intl.supportedValuesOf('timeZone')` (MDN) is an alternative that was not checked against Node 22 Alpine's ICU data.

**Sources:** npm `croner` (2026-10-10); `hexagon/croner@adc86215e92e4f7cceaf8127dfcd1b514ef7bafc` (README.md, docs/src/usage/{pattern,configuration}.md, src/{croner,date,pattern,options}.ts, src/helpers/timezone.ts, test/ocps-1.4.test.ts); tarball `tmp/b3b-plan-research/pkg-croner/package/dist/`; Context7 `/hexagon/croner`; OCPS `open-source-cron/ocps@df6f4c382182152b1809d38c86ab2935dfbdebf0`; Homarr pin above.

---

## 3. Vitest 4: a separate `pnpm test:ldap` suite

**Verdict: use one `vitest.config.ts` with two inline projects (`extends: true`). Point the package scripts at them with the documented `--project` filter: `pnpm test` runs `vitest run --project unit` (or `--project=!ldap`), and `pnpm test:ldap` runs `vitest run --project ldap --no-file-parallelism`.** No config flag marks a project as opt-in. The CLI filter is the documented way to leave one out. A separate file (`vitest run --config vitest.ldap.config.ts`) is the documented alternative.

### Docs (`vitest-dev/vitest@a09d47236e19fd3151351080c667036ca6164dc4`, tag v4.1.7, the installed version)

- **`docs/guide/projects.md`.**
  - "Vitest provides a way to define multiple project configurations within a single Vitest process … can also be used to run tests with different configurations".
  - The inline example has `{ extends: true, test: { include: [...], name: 'happy-dom', environment: 'happy-dom' } }` with "add "extends: true" to inherit the options from the root config" and "it is recommended to define a name when using inline configs".
  - "All projects must have unique names".
  - "If you need to run tests only inside a single project, use the `--project` CLI option … `pnpm run test --project e2e`".
  - "None of the configuration options are inherited from the root-level config file … you can use the `extends` option to inherit from your root-level configuration. All options will be merged."
  - Unsupported in a project: `coverage`, `reporters`, `resolveSnapshotPath`. The workspace was "deprecated since 3.2 and replaced with the `projects` configuration".
- **`docs/guide/cli-generated.md:780-784`:** "`--project <name>` The name of the project to run if you are using Vitest workspace feature. This can be repeated for multiple projects: `--project=1 --project=2`. You can also filter projects using wildcards like `--project=packages*`, and exclude projects with `--project=!pattern`."
- **The same file:** "`-c, --config <path>` Path to config file". The projects guide's naming rule for config files referenced _as projects_: "starts with `vitest.config` or `vite.config` … or matches `vitest.<name>.config.*`".
- **`docs/config/testtimeout.md`:** default `5_000` in Node.js. **`hooktimeout.md`:** default `10_000`. Neither is marked root-only.
- **`teardownTimeout` is `<CRoot />`** (root only).
- **`docs/config/globalsetup.md`:** "Path to global setup files relative to project root" … "The global setup is called before the test workers are created and only if there is at least one test queued, and teardown is called after all test files have finished running." Data reaches the tests through `project.provide(...)` and `inject(...)`.
- **`docs/config/fileparallelism.md`:** "Should all test files run in parallel. Setting this to `false` will override `maxWorkers` option to `1`." CLI `--no-file-parallelism`.
- **`docs/config/sequence.md`, `groupOrder`:** "If you don't set this option, all projects run in parallel."
- **Installed types (`node_modules/vitest/dist/chunks/reporters.d.CtLUhkkA.d.ts:3571, 3596`):** `ProjectConfig = Omit<InlineConfig, NonProjectOptions | "sequencer" | "deps">`. `NonProjectOptions` includes `teardownTimeout`, `reporters`, `coverage`, `passWithNoTests` and others, but not `testTimeout`, `hookTimeout`, `globalSetup`, `fileParallelism` or `maxWorkers`. So those last five are typed as allowed per project.
- Tags (`docs/config/tags.md`, "tags <Version>4.1.0</Version>", and `--tags-filter="!slow"`) are a per-test alternative, not needed here.

### Reference projects

- **Homarr** (`homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c`), Next.js with Vitest 4.1.10.
  - `package.json:302`: `"test": "cross-env NODE_ENV=development CI=true vitest run --project \"!e2e\" --project \"!integration\" --project \"!docs-screenshots\""`.
  - `:304`: `"test:integration": "cross-env NODE_ENV=development CI=true vitest run --project integration --maxWorkers 2"`.
  - `vitest.config.mts:5-16, 32-134`: "Docker-backed suites are opt-in through pnpm test:integration". Inline projects use `extends: true`, `name`, `environment: "node"`, `include` and `exclude`, and the `dom` project excludes the integration globs. It also has an `auth-ldap-node` unit project, `include: ["packages/auth/providers/test/ldap-*.spec.ts"]`.
- **Directus** (`directus/directus@8e140f94250834cea0a0fb6eb822cac39ed9faec`; the config was last changed at `9f2d2e48`, 2026-09-30).
  - `packages/memory/package.json:26-28`: `"test": "vitest run --project unit"`, `"test:integration": "vitest run --project integration"`.
  - `packages/memory/vitest.config.ts:10-33` declares a `unit` project and an `integration` project. The integration project carries the comment "Needs Docker, so it's only run when selected with `--project integration`" and sets `globalSetup: './test/global-setup.ts'`, `hookTimeout: 120000`, `testTimeout: 30000`. At the root it sets `teardownTimeout: 60000`, with the comment "Only takes effect at the root".
  - `test/global-setup.ts:19-51`: `docker compose -p <project> -f <file> up -d --wait`, `project.provide('redisPort', port)`, and `down -v` in teardown.
- **Cal.com**, the counter-example (`calcom/cal.diy@54343aa685ae8f33159d2f485ec4a57bad5c574a`). It picks the suite with an environment variable inside the config (`vitest.workspace.ts:3-41`, `vitest.config.mts:13-40`: `VITEST_MODE === "integration"` → include `**/*.integration-test.ts`), and runs it with `VITEST_MODE=integration yarn test` (`.github/workflows/integration-tests.yml:89`). It works, but it is a config-level switch, not Vitest's documented filter.
- drizzle-orm keeps its integration tests as a separate package with its own `vitest.config.ts` (`drizzle-team/drizzle-orm@eab8bedb:integration-tests/vitest.config.ts`, `package.json:8-9`). That is the separate-config shape, but on Vitest 3.

### Recommended shape (a sketch, not code to paste)

```ts
// vitest.config.ts: root keeps resolve.alias (@, server-only) and the node environment
test: {
  environment: 'node', globals: true,
  exclude: [...configDefaults.exclude, 'e2e/**', 'tmp/**'],
  projects: [
    { extends: true, test: { name: 'unit', exclude: [...configDefaults.exclude, 'e2e/**', 'tmp/**', '**/*.ldap.test.ts'] } },
    { extends: true, test: { name: 'ldap', include: ['lib/directory/**/*.ldap.test.ts'],
        globalSetup: ['./lib/directory/testing/ldap-global-setup.ts'], hookTimeout: 120_000, testTimeout: 30_000 } },
  ],
},
// package.json: "test": "vitest run --project unit", "test:watch": "vitest --project unit",
//               "test:ldap": "vitest run --project ldap --no-file-parallelism"
```

`--no-file-parallelism` goes on the CLI because the test files share the directory servers. The CLI form is documented without ambiguity, and it applies only to the selected project.

**Not confirmed:**

- How `extends: true` merges arrays such as `exclude` (the docs say "All options will be merged"; Vite's `mergeConfig` concatenates arrays). Homarr and the sketch repeat `configDefaults.exclude` in each project to be safe.
- Whether `fileParallelism: false` set inside a project (instead of on the CLI) is honoured per project at run time. It is typed as allowed; the effect was not run.
- That a filtered-out project's `globalSetup` never runs. The docs say "only if there is at least one test queued", and Directus relies on it.

**Sources:** the Vitest docs at the commit above (`docs/guide/projects.md`, `docs/guide/cli-generated.md`, `docs/config/{projects,globalsetup,testtimeout,hooktimeout,teardowntimeout,fileparallelism,maxworkers,sequence,passwithnotests,tags}.md`); Context7 `/vitest-dev/vitest/v4.1.6`; `node_modules/vitest` 4.1.7 types; the reference files above (copies in `tmp/b3b-plan-research/`).

---

## 4. Drizzle 1.0.0-rc.3 and MySQL 8.4

**Verdict: `check()`, `getTableConfig().checks`, nullable typing and `mysqlEnum(...).default('local').notNull()` behave as the plan needs. MySQL 8.4 accepts the table-qualified CHECK, as the live probe showed.**

### Installed Drizzle (`node_modules/drizzle-orm`, version 1.0.0-rc.3)

- **`check`** (`mysql-core/checks.d.ts:20`): `declare function check(name: string, value: SQL): CheckBuilder`. The built object is `class Check { table: MySqlTable; readonly name: string; readonly value: SQL }` (`checks.d.ts:13-19`; `checks.js:16-25` copies `name` and `value` from the builder).
- **`getTableConfig`** (`mysql-core/utils.d.ts:19-29`) returns `{ columns, indexes, foreignKeys, checks: Check[], primaryKeys, uniqueConstraints, name, schema, baseName }`. `utils.js:21-50` runs the table's extra-config builder and pushes every `CheckBuilder` result as `builder.build(table)`. A unit test can therefore read `getTableConfig(users).checks[0].name`.
- **The SQL text**, rendered the way drizzle-kit renders it: `new MySqlDialect().sqlToQuery(check.value).sql`. `MySqlDialect` is exported from `drizzle-orm/mysql-core` (`index.d.ts:40`). `sqlToQuery(sql, invokeSource?)` is at `dialect.d.ts:113` and `dialect.js:324-331`. drizzle-kit's MySQL serializer does exactly this: `value: dialect.sqlToQuery(value).sql` (`node_modules/drizzle-kit/bin.cjs:90660-90668`, region `src/dialects/mysql/drizzle.ts`). The Postgres path instead uses `check.value.inlineParams()` (`bin.cjs:89448`).
  - **So a MySQL CHECK must carry its literals in the template text** (`sql\`${t.source} = 'ldap'\``). An interpolated value becomes a `?` parameter.
  - drizzle-kit writes the result as `CONSTRAINT \`<name>\` CHECK(<value>)`in`CREATE TABLE` (`bin.cjs:80243`) or `ALTER TABLE … ADD CONSTRAINT \`<name>\` CHECK (<value>);` (`:80313`).
- **Nullable typing.** `column.d.ts:56`: `type GetColumnData<TColumn, TInferMode> = … TColumn['_']['notNull'] extends true ? TColumn['_']['data'] : TColumn['_']['data'] | null`. `$inferSelect` uses it (`table.d.ts:49-58, 67-68`). So `varchar('directory_id', { length: 64 })` without `.notNull()` is `string | null` on `$inferSelect`, and optional on `$inferInsert`.
- **Default versus NOT NULL.** `column-builder.js:50-65`: `notNull() { this.config.notNull = true }` and `default(value) { this.config.default = value; this.config.hasDefault = true }`. Only `.notNull()` and `.primaryKey()` (`:102-106`) set NOT NULL, so `.default('local')` alone leaves the column nullable.
- With `.default('local').notNull()`, drizzle-kit 1.0.0-rc.3 generated ``ALTER TABLE `users` ADD `source` enum('local','ldap') DEFAULT 'local' NOT NULL;`` and, in `CREATE TABLE`, `` `source` enum('local','ldap') NOT NULL DEFAULT 'local' `` (the 2026-10-09 probe, `tmp/b3-research/probe/out-alter/…/migration.sql:2`, `probe/out/…/migration.sql:4`; schema `probe/schema-step1.mjs:9`).
- The spec's CHECK depends on `source` being NOT NULL (MySQL: NULL evaluates to UNKNOWN, which passes; see below).

### MySQL 8.4 manual (crawled 2026-10-10)

- **"CHECK Constraints"** (https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html):
  - "_`expr`_ specifies the constraint condition as a boolean expression that must evaluate to `TRUE` or `UNKNOWN` (for `NULL` values) for each row of the table. If the condition evaluates to `FALSE`, it fails and a constraint violation occurs."
  - "Nongenerated and generated columns are permitted, except columns with the `AUTO_INCREMENT` attribute and columns in other tables."
  - "Foreign key referential actions (`ON UPDATE`, `ON DELETE`) are prohibited on columns used in `CHECK` constraints."
  - The page says nothing about qualifier syntax inside the expression.
- **"Identifier Qualifiers"** (https://dev.mysql.com/doc/refman/8.4/en/identifier-qualifiers.html):
  - "`tbl_name.col_name` | Column `col_name` from table `tbl_name` of the default database".
  - "In other words, a column name may be given a table-name qualifier, which itself may be given a database-name qualifier."
  - "You need not specify a qualifier for an object reference in a statement unless the unqualified reference is ambiguous."
- **"ALTER TABLE Statement"** (https://dev.mysql.com/doc/refman/8.4/en/alter-table.html): "If a table alteration causes a violation of an enforced `CHECK` constraint, an error occurs and the table is not modified. Examples of operations for which an error occurs: … Attempts to add an enforced `CHECK` constraint … for which existing rows violate the constraint condition. Attempts to modify, rename, or drop a column that is used in a `CHECK` constraint, unless that constraint is also dropped in the same statement."
- **Server Error Message Reference** (https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html):
  - "Error number: `3819`; Symbol: `ER_CHECK_CONSTRAINT_VIOLATED`; SQLSTATE: `HY000` Message: Check constraint '%s' is violated."
  - Related: 3820 `ER_CHECK_CONSTRAINT_REFERS_UNKNOWN_COLUMN`, 3823 `ER_CHECK_CONSTRAINT_CLAUSE_USING_FK_REFER_ACTION_COLUMN`.

### Live probe (MySQL 8.4.11, throwaway container, `tmp/b3b-plan-research/mysql84/probe.sql`)

1. `CREATE TABLE users (id varchar(36) PK, password varchar(255) NOT NULL)`, then one row, then `MODIFY COLUMN password varchar(255)` and `ADD source enum('local','ldap') DEFAULT 'local' NOT NULL`. The existing row became `local`.
2. drizzle-kit's exact statement ``ALTER TABLE `users` ADD CONSTRAINT `users_password_by_source` CHECK ((`users`.`source` = 'local' AND `users`.`password` IS NOT NULL) OR (`users`.`source` = 'ldap' AND `users`.`password` IS NULL));`` was **accepted**. `information_schema.CHECK_CONSTRAINTS` stores it unqualified: ``(((`source` = _latin1\'local\') and (`password` is not null)) or …)``. The `_latin1` introducer comes from the `mysql` CLI's `character_set_client=latin1` in the container.
3. An inline ``CREATE TABLE `t2` (`a` int NOT NULL, CONSTRAINT `t2_a_chk` CHECK(`t2`.`a` > 0))`` (drizzle-kit's `CREATE TABLE` form) was **accepted**.
4. An `ldap` row with no password was inserted. Then `('c', NULL, 'local')` → `ERROR 3819 (HY000): Check constraint 'users_password_by_source' is violated.` The same happened for `('d','x','ldap')`, and for `t2` with 0.
5. `ALTER TABLE users MODIFY COLUMN password varchar(300)` **succeeded** with the CHECK in place.

**Not confirmed:**

- Which other `MODIFY`, `RENAME` or `DROP` forms on CHECK columns fail (only one widening `MODIFY` was run).
- The introducer drizzle-kit's `migrate` produces under mysql2's connection charset (harmless either way).

**Sources:** the installed files above; MySQL 8.4 pages above (copies in `tmp/b3b-plan-research/mysql84/`); the probe.

---

## 5. Next.js 16.3.4 bundled docs: `instrumentation` and shutdown

**Verdict: `instrumentation.ts` at the project root (the repo has no `src/`), with `register()` and a `NEXT_RUNTIME === 'nodejs'` guard around a dynamic import, is the documented shape. It runs under `next dev`, `next start` and the standalone `server.js`; that is source-confirmed, while the docs say only "a new Next.js server instance". Nothing documented stops a timer started in `register()` on SIGTERM in the App Router.**

### Quotes

- **`01-app/02-guides/instrumentation.md`:**
  - `:4` (description): "Learn how to use instrumentation to run code at server startup in your Next.js app".
  - `:17`: "To set up instrumentation, create `instrumentation.ts|js` file in the **root directory** of your project (or inside the `src` folder if using one)."
  - `:19`: "Then, export a `register` function in the file. This function will be called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests."
  - `:43`: "The `instrumentation` file should be in the root of your project and not inside the `app` or `pages` directory."
  - `:52`: "We recommend importing files using JavaScript `import` syntax within your `register` function", with the example `export async function register() { await import('package-with-side-effect') }`.
  - `:72-83`: "Next.js calls `register` in all environments, so it's important to conditionally import any code that doesn't support specific runtimes (e.g. Edge or Node.js). You can use the `NEXT_RUNTIME` environment variable to get the current environment: `if (process.env.NEXT_RUNTIME === 'nodejs') { await import('./instrumentation-node') }`".
- **`01-app/03-api-reference/03-file-conventions/instrumentation.md`:**
  - `:12`: "place the file in the **root** of your application or inside a `src` folder if using one."
  - `:18`: "… `register` can be an async function."
  - `:127`: "The `instrumentation.js` file works in both the Node.js and Edge runtime, however, you can use `process.env.NEXT_RUNTIME` to target a specific runtime."
  - Version table: "`v15.0.0` | … `instrumentation` stable".
- **`01-app/01-getting-started/02-project-structure.md:39`:** "`instrumentation.ts` | OpenTelemetry and Instrumentation file" (a top-level file).
- **`01-app/02-guides/building.md:28`:** "Route discovery … detects root-level convention files like `proxy` and `instrumentation`."
- **`01-app/02-guides/self-hosting.md`:**
  - `:83`: "You can run code on server startup using the `register` function." (the same line is in `environment-variables.md:242`).
  - `:299`: "When stopping the server, ensure a graceful shutdown by sending `SIGINT` or `SIGTERM` signals and waiting. The Next.js server will finish in-flight requests and execute any pending `after()` callbacks before exiting."
  - `:305-335` "Manual Graceful Shutdowns" (`NEXT_MANUAL_SIG_HANDLE=true` plus `process.on('SIGTERM', …)` "inside your `_document.js` file") is wrapped in `<PagesOnly>`, with "Manual signal handling is not available in `next dev`". **No App Router equivalent is documented.**

### Source (not a documented contract)

- `next start` and standalone: `server/next-server.js:573-579`, `prepareImpl() { await super.prepareImpl(); await this.runInstrumentationHookIfAvailable(); }` → `ensureInstrumentationRegistered(...)`.
- `next dev`: `server/dev/next-dev-server.js:540-542`, the same call.
- The standalone `server.js` template uses `const { startServer } = require('next/dist/server/lib/start-server')` (`build/utils.js:1133`), which builds the same server.
- `esm/server/lib/router-utils/instrumentation-globals.external.js`:
  - `register` is skipped when `NEXT_PHASE === 'phase-production-build'`.
  - It is memoised once per process (`ensureInstrumentationRegistered`).
  - **On a throw, it rethrows with "An error occurred while loading instrumentation hook: …"**, and `prepareImpl` awaits that, so the server does not start.

**Consequence for the plan:**

- `register()` must catch its own failures: an invalid `LDAP_*` block or schedule should be logged, and the schedule left unstarted. That keeps spec §7.1's "the first request fails with the variables' names".
- On SIGTERM a running sync is cut. The reconciliation is idempotent, and the run row stays without `finished_at`; the spec's 30-minute "running" window then expires it.

**Not confirmed:**

- Whether `register()` runs again in `next dev` after `instrumentation.ts` or its imports change (the `globalThis` guard covers it either way).
- How Next's exit on SIGTERM treats a pending croner timer (croner's `unref` option exists; the default keeps the timer referenced).

---

## 6. next-auth 4.24.15: the `ldap` Credentials provider

**Verdict: confirmed in the installed source.**

- **`authorize(credentials, req)`.** `node_modules/next-auth/src/core/routes/callback.ts:327-337` (compiled `core/routes/callback.js:323-333`):

  ```ts
  } else if (provider.type === "credentials" && method === "POST") {
    const credentials = body
    …
    user = await provider.authorize(credentials, { query, body, headers, method })
  ```

  The type is `providers/credentials.d.ts:13`: `authorize: (credentials: Record<keyof C, string> | undefined, req: Pick<RequestInternal, "body" | "query" | "headers" | "method">) => Awaitable<User | null>`. The provider is chosen by `id` (`core/lib/providers.js:29-40`, `nextauth-drizzle-antd.md` §A), so `id: 'ldap'` gives `/api/auth/callback/ldap`.

- **A thrown `Error('DirectoryUnavailable')` reaches `result.error`.**
  1. `callback.ts:348-355` (compiled `callback.js:343-349`): `catch (error) { return { status: 401, redirect: \`${url}/error?error=${encodeURIComponent((error as Error).message)}\`, cookies } }`.
  2. The App Router handler: `next/index.js:72-80`, `if (body?.json === "true" && redirect) { … return new Response(JSON.stringify({ url: redirect }), { status: internalResponse.status, … }) }`. `signIn` always sends `json: "true"`.
  3. The client: `react/index.js:219-222` picks `/callback/<id>` for `type === "credentials"`; `:267` does `error = new URL(data.url).searchParams.get("error")`; `:278-283` returns `{ error, status: res.status, ok: res.ok, url: error ? null : data.url }`.

  So `signIn('ldap', { redirect: false, … })` resolves to `{ error: 'DirectoryUnavailable', status: 401, ok: false, url: null }`. A `null` from `authorize` gives `error: 'CredentialsSignin'` (`callback.ts:338-347`).

- **`account.provider` at sign-in.** `callback.ts:358-363` builds `const account = { providerAccountId: user.id, type: "credentials", provider: provider.id }`. `:397-403` calls `callbacks.jwt({ token: defaultToken, user, account, isNewUser: false, trigger: "signIn" })` (compiled `callback.js:350-354, 386-392`). The `jwt` callback therefore sees `account.provider === 'ldap'` on the sign-in call only. Today's callback destructures only `{ token, user }` (`lib/auth/options.ts:97`).

**Not confirmed:** nothing new; the 2026-10-09 caveats stand (the v4 docs do not say in words that the thrown message is what `signIn` returns).

---

## 7. ldapts: validating configured filters; `createConnection` and `isConnected`

**Verdict:**

- **`FilterParser.parseString(filter)` is public and exported from the package root**, and it is the very parser `search()` applies to a string filter. Using it in `lib/env.ts` validates a configured filter exactly as the search will read it. It is **not documented in the README** (types and tests only), which puts it a step below the README-documented API under ADR-0002.
- **`createConnection` is documented**, including that it may be called more than once. **`isBound` is documented.** `isConnected` appears in a README example and in the types.

### FilterParser

- Export: `src/index.ts:12` `export * from './FilterParser.js'`; d.ts:1411-1413 `export declare class FilterParser { static parseString(filterString: string): Filter; static parse(reader: BerReader): Filter; … }`.
- Use by `search`: `src/Client.ts:640-646` `if (typeof options.filter === 'string') { filter = FilterParser.parseString(options.filter); }` (and `:714` in `searchPaginated`).
- It throws a plain `Error` (`src/FilterParser.ts`):

  | Line | Message |
  | --- | --- |
  | `:33` | `'Filter cannot be empty'` |
  | `:44` | `` `Unbalanced parens in filter string: ${filterString}` `` |
  | `:154` | `` `Missing paren: …` `` |
  | `:205` | `` `Unbalanced parens: …` `` |
  | `:233` | `` `Invalid attribute name: ${filterString}` `` |
  | `:286` | `` `Invalid expression: …` `` |
  | `:295`, `:311` | `` `Invalid extensible filter: …` ``, `` `Missing := in extensible filter: …` `` |
  | `:344`, `:348` | `` `Illegal unescaped character: ( in value: …` ``, `` `Invalid escaped hex character: …` `` |

- Pinned by `tests/FilterParser.test.ts:19-55` at b38cfc3: `toThrow('Filter cannot be empty')`, `'Unbalanced parens'`, `'Invalid expression: foo>bar'`, `'Invalid attribute name:'`.
- **Lenient on outer parentheses.** `:36-39` "Wrap input in parens if it wasn't already", and the test "should handle non-wrapped filters" accepts `cn=foo`. The README nevertheless says "ldapts requires all filters to be surrounded by '()' blocks" (README.md:530). If the app wants the parentheses, it should require `^\(` itself.
- The messages echo the filter. That is fine for configuration values (no secrets), but they should not be logged when user input is involved.
- For `LDAP_GROUP_MEMBER_FILTER`: replace `{group_dn}` with a sample DN passed through `escapeFilter` (as the run time will), then parse. The AD in-chain and bit-AND matching-rule filters parse into an `ExtensibleFilter` (`tests/FilterParser.test.ts:1300-1301, 1433-1470`).

### `createConnection` (README "Custom connection factories", README.md:75-96)

- Options table, `:70-71`: "`createConnection` | Custom connection factory for `ldap://` URLs. Called with the parsed port and host (Default: `net.connect`)". And "`createSecureConnection` | Custom connection factory for `ldaps://` URLs and `startTLS()` upgrades (Default: `tls.connect`)".
- `:94-96`: "Note that the client transparently reconnects when it is used after being unbound or after the server closes the connection, so the factory may be invoked more than once and should generally create a fresh connection per call."
- d.ts:1129-1134: "Called with the parsed port and host from the url. Defaults to `net.connect`."
- Source: `_connect()` (`src/Client.ts:889-935`) calls `createConnection(this.port, this.host)` inside the Promise executor on every connect while not connected. A factory that throws therefore rejects the operation that triggered the reconnect (`bind`, `search` or `startTLS`).
- `startTLS()` (`:273-315`) runs `_connect()` first if needed (which uses `createConnection` for `ldap://`), then `createSecureConnection(options)` with `options.socket = originalSocket`.
- A factory that allows exactly one call per `Client` is a documented-API way to make any reconnect after StartTLS fail loudly instead of continuing in plain text. With one client per sign-in or sync (spec §6.2), a legitimate second connection never happens.

### `isConnected` and `isBound`

- README "Automatic rebind", `:98-132`: the example `if (!client.isConnected) { await client.bind(bindDN, password); }`, and "You can also check the current authentication state with `client.isBound`, which becomes `false` whenever the connection is closed or re-established."
- d.ts:1225-1232 and `src/Client.ts:259-271`: `get isConnected() { return !!this.socket && this.connected }`, and `get isBound() { return this.isConnected && this.bound }` ("makes it possible to detect a connection that was transparently reconnected but is no longer authenticated").
- `bind()` → `_sendBind()` checks `isConnected` and reconnects (`:773-775`) before its first `await`, so the guard `if (!client.isConnected) throw …; await client.bind(dn, pw)` runs in the same synchronous step. That reading is from the source; the factory approach is the documented one.

**Not confirmed:** neither approach was run against a server that drops the socket between StartTLS and the user bind.

---

## 8. zod 4: the URL protocol, and a blank variable as absent

**Verdict:**

- `z.url({ protocol: /^ldaps?$/ })` is documented, and it compares the protocol **without** its trailing colon. Add `hostname: /.+/` (or a refine) so that `ldap:host` and `ldap:///x` are refused.
- A blank variable counts as absent with `z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner.default(x))`. The repo already does this in `flag()` (`lib/env.ts:6-15`, tested in `__tests__/env.test.ts`). It is built from two documented pieces; zod's docs have no environment-variable recipe.

### Docs (`colinhacks/zod@59bbc03e10c636b9eb3c393dfeb552819774ec21`, tag v4.6.5 = installed; `packages/docs/content/api.mdx`)

- **"URLs"** (`:350-404`):
  - "To validate any WHATWG-compatible URL: `const schema = z.url();` … As you can see this is quite permissive. Internally this uses the `new URL()` constructor to validate inputs".
  - "To validate the hostname against a specific regex: `z.url({ hostname: /^example\.com$/ })`".
  - "To validate the protocol against a specific regex, use the `protocol` param. `const schema = z.url({ protocol: /^https$/ }); schema.parse("https://example.com"); // ✅ schema.parse("http://example.com"); // ❌`".
  - `z.httpUrl()` is "equivalent to `z.url({ protocol: /^https?$/, hostname: z.regexes.domain })`". `normalize` "will overwrite the input value with the normalized URL".
- **"`.preprocess()`"** (`:3125-3150`): "Piping a transform into another schema is another common pattern, so Zod provides a convenience `z.preprocess()` function", with the example `z.preprocess((val) => { if (typeof val === "string") { return Number.parseInt(val); } return val; }, z.int())`.
- **"Defaults"** (`:3152-3160`): "`z.string().default("tuna"); defaultTuna.parse(undefined); // => "tuna"`". **"Prefaults"**: "If the input is `undefined`, the default value is eagerly returned."
- Installed source (`node_modules/zod/v4/core/schemas.js`):
  - `:259-262` `urlProtocolOk` tests `url.protocol` with the colon stripped.
  - `:255-258` `urlHostnameOk` tests `url.hostname`.
  - `:263-292` the check trims the input (`payload.value.trim()`), and the output is the trimmed value.
  - `:232-236` the "require :// for http/https URLs" guard applies only when the protocol regex is zod's own `httpProtocol`. So `ldap:host` parses with protocol `ldap` and an empty hostname.
- ldapts parses the same string with `new URL()` too (`src/Client.ts:207-217`) and takes `hostname` (default `localhost` when empty, `:231`) and `port`. A zod hostname rule keeps a malformed value from silently becoming `localhost`.
- For secrets (`LDAP_BIND_PASSWORD`), the preprocessor should only turn a blank value into `undefined` and pass any other value through untrimmed. The existing `flag()` trims and lowercases, which is right for flags only.

**Not confirmed:** `new URL('ldap://[::1]:389')` and IPv6 hosts under the zod hostname rule were not run (ldapts strips the brackets itself, `Client.ts:227-229`).

---

## Pinned sources (all read 2026-10-10)

- npm registry: `ldapts`, `croner` (`npm view … version dist-tags time exports …`).
- `ldapts/ldapts@b38cfc3ecfa71ebd59ddfcf2f7d49887ae84fad2` (v9.2.0): README.md, CHANGELOG.md, src/\*\*, tests/FilterParser.test.ts; tarball `ldapts-9.2.0.tgz` (dist/index.d.mts, src/).
- `hexagon/croner@adc86215e92e4f7cceaf8127dfcd1b514ef7bafc` (v10.0.1): README.md, docs/src/usage/{pattern,configuration,examples}.md, src/{croner,date,pattern,options}.ts, src/helpers/timezone.ts, test/ocps-1.4.test.ts; tarball `croner-10.0.1.tgz`. `open-source-cron/ocps@df6f4c382182152b1809d38c86ab2935dfbdebf0`: increments/OCPS-increment-1.4.md.
- `homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c`: package.json, vitest.config.mts, packages/cron-jobs-core/src/{creator,group,validation}.ts, packages/cron-jobs/src/job-manager.ts.
- `directus/directus@8e140f94250834cea0a0fb6eb822cac39ed9faec`: packages/memory/{package.json,vitest.config.ts,test/global-setup.ts}.
- `calcom/cal.diy@54343aa685ae8f33159d2f485ec4a57bad5c574a`: vitest.workspace.ts, vitest.config.mts, package.json, .github/workflows/integration-tests.yml, agents/commands.md.
- `drizzle-team/drizzle-orm@eab8bedbb65d5429c54e612ddbd88aa23091d398`: integration-tests/{vitest.config.ts,package.json}.
- `vitest-dev/vitest@a09d47236e19fd3151351080c667036ca6164dc4` (v4.1.7): docs/guide/{projects,cli-generated}.md, docs/config/\*.md as listed in §3.
- `colinhacks/zod@59bbc03e10c636b9eb3c393dfeb552819774ec21` (v4.6.5): packages/docs/content/api.mdx.
- Context7: `/hexagon/croner`, `/vitest-dev/vitest/v4.1.6`, `/colinhacks/zod/v4.6.5`.
- MySQL 8.4 Reference Manual: create-table-check-constraints.html, identifier-qualifiers.html, alter-table.html; MySQL 8.4 Error Reference: server-error-reference.html.
- Installed: `node_modules/next` 16.3.4 (dist/docs/01-app/…, dist/server/next-server.js, dist/server/dev/next-dev-server.js, dist/esm/server/lib/router-utils/instrumentation-globals.external.js, dist/build/utils.js, dist/lib/server-external-packages.jsonc, dist/server/node-environment-extensions/process-error-handlers.js); `node_modules/next-auth` 4.24.15; `node_modules/drizzle-orm` and `drizzle-kit` 1.0.0-rc.3; `node_modules/vitest` 4.1.7; `node_modules/zod` 4.6.5.
