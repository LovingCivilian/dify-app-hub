import 'server-only'

import { randomUUID } from 'node:crypto'

import { Cron } from 'croner'

import { lastSucceededSyncRun } from '@/lib/data/directory'
import { logActionError } from '@/lib/error-log'
import type { LdapConfig } from '@/lib/env'

import { directoryConfig } from './config'
import { readCaFile } from './connection'
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
	// A start inside a due second runs that slot: previousRuns(1) steps back from the current whole second, so
	// `match` (README "Status") takes the second itself (spec §13: runs are idempotent).
	const now = new Date()
	const second = new Date(Math.floor(now.getTime() / 1000) * 1000)
	const lastDue = job.match(now) ? second : job.previousRuns(1, now)[0]
	const lastSucceeded = await lastSucceededSyncRun()
	if (!missedRun(lastDue, lastSucceeded?.startedAt ?? null)) return
	await runSync({ config, id: randomUUID(), trigger: 'startup', slot: startupSlot(lastDue!) })
}

/**
 * A CA file that cannot be read refuses every directory sign-in and sync, so the start reads it once, as the connection
 * does (readCaFile), and logs the DirectoryConfigError, which names `LDAP_CA_FILE` and the error's code, never the path
 * (final review I1). Logged, not thrown (decision ai): local sign-ins keep working. Authelia and Keycloak load their
 * trusted certificates at start and report a file they cannot read there, and Grafana returns the read's error from
 * each connection; all three messages carry the path, which the hub's log leaves out:
 * `authelia@2ed18389:internal/utils/crypto.go:373-374,389-390` with `internal/commands/root.go:85-98`,
 * `keycloak@c7de391a:quarkus/runtime/src/main/java/org/keycloak/quarkus/runtime/KeycloakRecorder.java:190-214` with
 * `services/src/main/java/org/keycloak/truststore/TruststoreBuilder.java:269-300`, and
 * `grafana@7b702d79:pkg/services/ldap/ldap.go:100-104,304-316`.
 */
const checkCaFile = (caFile: string): Promise<void> =>
	readCaFile(caFile).then(
		() => undefined,
		(error: unknown) => logActionError(error, 'directorySchedule'),
	)

/**
 * Starts the schedule once per process (a development reload re-evaluates modules, so the state lives on globalThis,
 * Rallly's guard): nothing while LDAP is off; a warning for `none` (spec §6.2) and the CA file's check, with the
 * schedule on or off; then, unless LDAP_SYNC_SCHEDULE is `off`, one croner job (decision aj) and a startup catch-up. A
 * bad LDAP block is logged and left to the first request (decision ai).
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
	// The connection reads the CA file only for TLS (connection.ts), so the check does too.
	else if (config.caFile) void checkCaFile(config.caFile)
	if (config.syncSchedule === null) return
	const job = new Cron(
		config.syncSchedule,
		{
			timezone: config.syncTimezone ?? undefined,
			mode: '5-part',
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
