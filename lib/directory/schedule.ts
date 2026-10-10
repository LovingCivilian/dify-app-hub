import 'server-only'

import { randomUUID } from 'node:crypto'

import { Cron } from 'croner'

import { lastSucceededSyncRun } from '@/lib/data/directory'
import { logActionError } from '@/lib/error-log'
import type { LdapConfig } from '@/lib/env'

import { directoryConfig } from './config'
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
 * Starts the schedule once per process (a development reload re-evaluates modules, so the state lives on globalThis,
 * Rallly's guard): nothing while LDAP is off or LDAP_SYNC_SCHEDULE is `off`; a warning for `none` (spec §6.2); one
 * croner job (decision aj) and a startup catch-up. A bad LDAP block is logged and left to the first request (decision ai).
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
