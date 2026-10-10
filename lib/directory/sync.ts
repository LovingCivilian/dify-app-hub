import 'server-only'

import { randomUUID } from 'node:crypto'

import { ResultCodeError, type Client } from 'ldapts'

import {
	applyMembershipChanges,
	claimSyncRun,
	deactivateDirectoryAccounts,
	EMPTY_COUNTS,
	finishSyncRun,
	hasUnfinishedRunSince,
	listDirectoryAccounts,
	listDirectoryMemberships,
	listGroupLinks,
	pruneSyncRuns,
	reactivateDirectoryAccounts,
	refreshDirectoryAccount,
	refreshGroupLinks,
	type GroupLink,
	type SyncRunCounts,
} from '@/lib/data/directory'
import type { SyncErrorCode, SyncOutcome, SyncTrigger } from '@/lib/directory-status'
import { logActionError } from '@/lib/error-log'
import type { LdapConfig } from '@/lib/env'

import { withDirectory } from './connection'
import { readEntry, type DirectoryEntry } from './entry'
import { DirectoryRefusedError, DirectoryUnavailableError } from './errors'
import { findGroupByKey, listMemberKeys, listUserEntries } from './operations'
import { planAccountChanges, planDirectoryMemberships, type LinkLookup } from './plan'

/*
 * One directory sync run (B3 spec §6.4, ADR-0029): claim the slot, read the directory, stop on a safety stop, apply
 * the plan, finish the row, prune old rows, log one summary line. Called by the schedule (lib/directory/schedule.ts)
 * and by Sync now (lib/directory/admin.ts).
 */

/**
 * Spec §6.4: no run starts while a run that started less than 30 minutes ago has no finished_at (decision ag: every
 * trigger, not only Sync now). A run older than that is taken to have died with its container.
 */
export const RUNNING_GUARD_MS = 30 * 60 * 1000

/** Spec §3.2: runs older than 90 days are deleted by the run itself. */
export const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

const minute = (at: Date) => `${at.toISOString().slice(0, 16)}Z`

/** Decision ak: a scheduled run's slot is the minute it fires (`schedule:2026-10-09T13:00Z`). */
export const scheduleSlot = (at: Date): string => `schedule:${minute(at)}`

/** Decision ak: a startup catch-up's slot is the missed due minute, so two starting containers claim it once. */
export const startupSlot = (due: Date): string => `startup:${minute(due)}`

export type SyncAttempt =
	| { status: 'skipped' }
	| { status: 'running' }
	| {
			status: 'finished'
			outcome: Exclude<SyncOutcome, 'running'>
			counts: SyncRunCounts
			errorCode: SyncErrorCode | null
	  }

/** The fixed code a failed run records (spec §3.2: never a message). */
const errorCodeOf = (error: unknown): SyncErrorCode => {
	if (error instanceof DirectoryUnavailableError) return 'directory_unreachable'
	if (error instanceof DirectoryRefusedError) return 'bind_refused'
	if (error instanceof ResultCodeError) return 'search_failed'
	return 'internal_error'
}

/**
 * `directory_group_name` is varchar(255), and MySQL's strict mode refuses a longer value ("values that exceed the
 * column length are not stored, and an error results", MySQL 8.4 "The CHAR and VARCHAR Types"), which would fail the
 * run. findGroupByKey falls back to the DN for a group without a name, so the name is cut here, by code points as
 * readEntry cuts an entry's texts (MDN `Array.from()`: a string's iterator yields code points).
 */
const GROUP_NAME_MAX = 255
const groupNameForColumn = (name: string): string =>
	Array.from(name).slice(0, GROUP_NAME_MAX).join('')

interface DirectorySnapshot {
	entries: DirectoryEntry[]
	lookups: LinkLookup[]
}

/**
 * Decision af: every linked directory group, by key, then its members' keys. A result-code error for one group is that
 * group's error (the directory answered, spec §6.4 step 4); anything else, a lost connection above all, fails the run.
 */
async function lookUpLinks(
	client: Client,
	config: LdapConfig,
	links: readonly GroupLink[],
): Promise<LinkLookup[]> {
	const byKey = new Map<string, LinkLookup['result']>()
	for (const key of new Set(links.map(link => link.directoryGroupId))) {
		try {
			const group = await findGroupByKey(client, config, key)
			byKey.set(
				key,
				group
					? {
							status: 'found',
							name: groupNameForColumn(group.name),
							memberKeys: await listMemberKeys(client, config, group.dn),
						}
					: { status: 'missing' },
			)
		} catch (error) {
			if (!(error instanceof ResultCodeError)) throw error
			logActionError(error, 'directorySync')
			byKey.set(key, { status: 'error' })
		}
	}
	return links.map(link => ({
		groupId: link.groupId,
		directoryGroupId: link.directoryGroupId,
		result: byKey.get(link.directoryGroupId)!,
	}))
}

async function reconcile(
	config: LdapConfig,
	counts: SyncRunCounts,
): Promise<Exclude<SyncOutcome, 'running' | 'failed'>> {
	const links = await listGroupLinks()
	// Read before the directory: an account that a sign-in creates or reactivates while the directory is read is not
	// judged against an answer older than its change (decision af).
	const accounts = await listDirectoryAccounts()
	const snapshot: DirectorySnapshot = await withDirectory(config, async client => ({
		entries: (await listUserEntries(client, config))
			.map(entry => readEntry(entry, config))
			.filter((entry): entry is DirectoryEntry => entry !== null),
		lookups: await lookUpLinks(client, config, links),
	}))
	counts.entriesSeen = snapshot.entries.length
	const plan = planAccountChanges(accounts, snapshot.entries, config.idAttribute)
	if (plan.stop !== null) return plan.stop
	const at = new Date()
	counts.deactivated = await deactivateDirectoryAccounts(plan.deactivate, at)
	counts.reactivated = await reactivateDirectoryAccounts(plan.reactivate)
	for (const update of plan.updates) {
		// Task 9: `updated` says the write matched the account (one deleted during the run matches nothing).
		const { updated, conflict } = await refreshDirectoryAccount(update)
		if (updated) counts.updated += 1
		if (conflict) counts.conflicts += 1
	}
	const memberships = planDirectoryMemberships(
		snapshot.lookups,
		plan.accountIdByKey,
		await listDirectoryMemberships(),
	)
	counts.groupErrors = memberships.groupErrors
	await refreshGroupLinks(memberships.linkRefreshes, at)
	const applied = await applyMembershipChanges(memberships)
	counts.membershipsAdded = applied.added
	counts.membershipsRemoved = applied.removed
	// The failed lookups, then the hub groups whose rows were refused (a group or account deleted during the run).
	counts.groupErrors += applied.groupErrors
	return 'succeeded'
}

/**
 * Runs one sync for a slot (spec §6.4). The slot's unique key decides which caller runs it: a refused claim skips. The
 * run's failure is caught, logged by name and code (lib/error-log.ts) and recorded with a fixed code; the summary line
 * carries the outcome and the counts, never a name or an email (OWASP Logging Cheat Sheet, "Data to exclude").
 */
export async function runSync(run: {
	config: LdapConfig
	id: string
	trigger: SyncTrigger
	slot: string
}): Promise<SyncAttempt> {
	// Decision ag: Keycloak's one sync key for every trigger; the slot claim below then stops a second container.
	if (await hasUnfinishedRunSince(new Date(Date.now() - RUNNING_GUARD_MS))) {
		console.info('directorySync: a run is going, this one is skipped', { trigger: run.trigger })
		return { status: 'running' }
	}
	if (
		!(await claimSyncRun({
			id: run.id,
			slot: run.slot,
			trigger: run.trigger,
			startedAt: new Date(),
		}))
	)
		return { status: 'skipped' }
	const counts: SyncRunCounts = { ...EMPTY_COUNTS }
	let outcome: Exclude<SyncOutcome, 'running'>
	let errorCode: SyncErrorCode | null = null
	try {
		outcome = await reconcile(run.config, counts)
	} catch (error) {
		logActionError(error, 'directorySync')
		outcome = 'failed'
		errorCode = errorCodeOf(error)
	}
	await finishSyncRun(run.id, outcome, counts, errorCode, new Date())
	await pruneSyncRuns(new Date(Date.now() - RUN_RETENTION_MS))
	console.info('directorySync: run finished', {
		trigger: run.trigger,
		outcome,
		errorCode,
		...counts,
	})
	return { status: 'finished', outcome, counts, errorCode }
}

/** Sync now (spec §6.6): its slot is `manual:<run id>`; refused while another run is going, as every run is. */
export async function runManualSync(config: LdapConfig): Promise<SyncAttempt> {
	const id = randomUUID()
	return runSync({ config, id, trigger: 'manual', slot: `manual:${id}` })
}
