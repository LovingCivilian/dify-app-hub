import 'server-only'

import { Cron } from 'croner'

import { assertAdmin, type SessionUser } from '@/lib/auth/session'
import { latestSyncRun, type SyncRunCounts, type SyncRunRecord } from '@/lib/data/directory'
import type { LdapEncryption, SyncOutcome, SyncTrigger } from '@/lib/directory-status'

import { directoryConfig } from './config'
import { withDirectory } from './connection'
import { cutToColumn } from './entry'
import { searchGroups } from './operations'
import { RUNNING_GUARD_MS, runManualSync, type SyncAttempt } from './sync'

/*
 * The directory as the admin surface uses it (B3 spec §6.5, §6.6): each function takes the verified actor first and
 * checks admin rights itself, the Data Access Layer's pattern (ADR-0024), before it reaches the directory.
 */

export interface DirectoryGroupOption {
	key: string
	name: string
}

/**
 * Spec §6.5 "Linking": up to twenty directory groups whose name contains the text, or null while LDAP is off (the
 * route answers 409, decision al). Read by GET /api/directory/groups.
 */
export async function searchDirectoryGroups(
	actor: SessionUser,
	text: string,
): Promise<DirectoryGroupOption[] | null> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return null
	const groups = await withDirectory(config, client => searchGroups(client, config, text))
	// The name a picked group's link stores is varchar(255): searchGroups falls back to the DN for a group without a
	// name, so it is cut here (cutToColumn), before the browser shows it and the save's zod `max(255)` checks it.
	return groups.map(group => ({ key: group.key, name: cutToColumn(group.name) }))
}

export interface DirectoryRunDto {
	trigger: SyncTrigger
	startedAt: string
	finishedAt: string | null
	/** `interrupted`: still `running` after the guard, so its container stopped mid-run (decision ap). */
	outcome: SyncOutcome | 'interrupted'
	errorCode: string | null
	counts: SyncRunCounts
}

/** What the panel shows (spec §6.6), and nothing more (Global Constraints: DTOs carry only what the screen needs). */
export interface DirectoryStatusDto {
	encryption: LdapEncryption
	nextRun: string | null
	lastRun: DirectoryRunDto | null
}

const toRunDto = (run: SyncRunRecord, now: number): DirectoryRunDto => ({
	trigger: run.trigger,
	startedAt: run.startedAt.toISOString(),
	finishedAt: run.finishedAt?.toISOString() ?? null,
	outcome:
		run.outcome === 'running' && now - run.startedAt.getTime() > RUNNING_GUARD_MS
			? 'interrupted'
			: run.outcome,
	errorCode: run.errorCode,
	counts: run.counts,
})

/**
 * Spec §6.6: the directory's state for the users page, or null while LDAP is off. The next run is croner's `nextRun()`
 * on a job without a function, which schedules nothing (croner `src/croner.ts:215-219`).
 */
export async function getDirectoryStatus(actor: SessionUser): Promise<DirectoryStatusDto | null> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return null
	const nextRun = config.syncSchedule
		? new Cron(config.syncSchedule, { timezone: config.syncTimezone ?? undefined }).nextRun()
		: null
	const run = await latestSyncRun()
	return {
		encryption: config.encryption,
		nextRun: nextRun?.toISOString() ?? null,
		lastRun: run ? toRunDto(run, Date.now()) : null,
	}
}

/** Sync now (spec §6.6, decision aq): one manual run, waited for; null while LDAP is off. */
export async function syncDirectoryNow(actor: SessionUser): Promise<SyncAttempt | null> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return null
	return runManualSync(config)
}
