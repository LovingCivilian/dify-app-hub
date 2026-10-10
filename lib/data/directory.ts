import 'server-only'

import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { directorySyncRuns, userGroupDirectoryLinks, userGroupMembers, users } from '@/db/schema'
import type { Role } from '@/lib/auth/roles'
import type {
	AccountUpdate,
	LinkRefresh,
	MembershipPlan,
	MembershipRow,
	SyncAccount,
} from '@/lib/directory/plan'
import type { SyncErrorCode, SyncOutcome, SyncTrigger } from '@/lib/directory-status'

import { isDeadlock, isDuplicateEntry, isMissingReference } from './db-errors'

/*
 * The directory Data Access Layer (B3 spec §6.1, ADR-0029). It takes no actor: its callers are the `ldap` provider,
 * before any session exists, and the directory sync, which acts for no person. It is the second actor-less module after
 * lib/data/setup.ts (ADR-0024 deviation 2), and its guard is its input: every function takes values read from a
 * successful directory bind or from a complete, error-free directory search, never raw form input. It writes only what
 * the directory owns (ADR-0027): `directory_deactivated_at` (with a `sessionVersion` bump), the directory fields of
 * `ldap` accounts, and `directory` memberships, the links' names and `missing_since`, and the sync's run rows; never
 * the admin marker, a role, a password or a `manual` membership.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** A directory entry as the sign-in read it once the person's own bind succeeded (spec §6.3 steps 3–6). */
export interface DirectoryIdentity {
	/** The canonical key (lib/directory/keys.ts): the account's only link to the entry (ADR-0026). */
	key: string
	/** The attribute that produced the key (LDAP_ID_ATTRIBUTE). */
	idAttribute: string
	/** The login attribute's value. */
	username: string
	email: string | null
	name: string | null
}

/** The account the `ldap` provider hands next-auth, as the local provider does (spec §6.3 step 8). */
export interface DirectorySignInAccount {
	id: string
	email: string
	name: string | null
	role: Role
	sessionVersion: number
}

export type DirectorySignInRefusal = 'account_inactive' | 'entry_without_email' | 'email_in_use'

export type DirectorySignInResult =
	| { ok: true; account: DirectorySignInAccount; emailConflict: boolean }
	| { ok: false; reason: DirectorySignInRefusal }

export interface GroupLink {
	groupId: string
	directoryGroupId: string
	directoryGroupName: string
	missingSince: Date | null
}

/** Every hub group's directory links (spec §6.5): the sign-in checks the person against each. */
export const listGroupLinks = (): Promise<GroupLink[]> =>
	getDb()
		.select({
			groupId: userGroupDirectoryLinks.groupId,
			directoryGroupId: userGroupDirectoryLinks.directoryGroupId,
			directoryGroupName: userGroupDirectoryLinks.directoryGroupName,
			missingSince: userGroupDirectoryLinks.missingSince,
		})
		.from(userGroupDirectoryLinks)

/**
 * A locking read of the directory account with this key (ADR-0024 decision d; MySQL 8.4 "Locking Reads"). The sign-in
 * runs at READ COMMITTED (decision e), where a locking read "locks only index records, not the gaps before them" (MySQL
 * 8.4 "Transaction Isolation Levels"): a found row is locked, so one person's sign-ins run one after another, and a
 * missing key locks nothing. Two first sign-ins of one person still make one account: the unique index
 * `users_directory_id_key` refuses the second insert (1062), or InnoDB rolls one transaction back (1213), and either
 * runs again and finds the account (decision e). No gap lock is needed for that.
 */
export const lockDirectoryAccount = (tx: Pick<Tx, 'select'>, key: string) =>
	tx
		.select({
			id: users.id,
			email: users.email,
			role: users.role,
			sessionVersion: users.sessionVersion,
			adminDeactivatedAt: users.adminDeactivatedAt,
		})
		.from(users)
		.where(and(eq(users.source, 'ldap'), eq(users.directoryId, key)))
		.limit(1)
		.for('update')

/** The account using this email, compared in SQL as the unique index compares it (the column's collation). */
const emailTakenBy = (tx: Pick<Tx, 'select'>, email: string) =>
	tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

/**
 * Sets the account's directory memberships to exactly these hub groups (decision f; spec §6.3 step 7). Its directory
 * rows anywhere else go, including a group whose links were removed; manual rows are never read or written (spec §2
 * #8). The rows that remain are read with a locking read (MySQL 8.4 "Locking Reads"), which sees the latest committed
 * rows, so the insert adds only the missing ones. At the sign-in's READ COMMITTED, the delete and that read lock only
 * this account's rows, not the gaps between them, so another person's membership insert never waits on them
 * ("Transaction Isolation Levels"). The lock on the account row already serialises this person's own sign-ins.
 */
export async function replaceDirectoryMemberships(
	tx: Pick<Tx, 'select' | 'insert' | 'delete'>,
	userId: string,
	groupIds: readonly string[],
): Promise<void> {
	const wanted = [...new Set(groupIds)]
	const ofThisAccount = and(
		eq(userGroupMembers.userId, userId),
		eq(userGroupMembers.source, 'directory'),
	)
	await tx
		.delete(userGroupMembers)
		.where(
			and(
				eq(userGroupMembers.userId, userId),
				eq(userGroupMembers.source, 'directory'),
				wanted.length ? notInArray(userGroupMembers.groupId, wanted) : undefined,
			),
		)
	if (!wanted.length) return
	const kept = await tx
		.select({ groupId: userGroupMembers.groupId })
		.from(userGroupMembers)
		.where(ofThisAccount)
		.for('update')
	const have = new Set(kept.map(row => row.groupId))
	const add = wanted.filter(groupId => !have.has(groupId))
	if (add.length)
		await tx
			.insert(userGroupMembers)
			.values(add.map(groupId => ({ groupId, userId, source: 'directory' as const })))
}

async function signInWithin(
	tx: Tx,
	identity: DirectoryIdentity,
	groupIds: readonly string[],
): Promise<DirectorySignInResult> {
	const [known] = await lockDirectoryAccount(tx, identity.key)
	if (known) {
		// ADR-0027: the admin's marker is the admin's to clear; the directory never lifts it.
		if (known.adminDeactivatedAt !== null) return { ok: false, reason: 'account_inactive' }
		const [taken] =
			identity.email && identity.email !== known.email ? await emailTakenBy(tx, identity.email) : []
		const emailConflict = taken !== undefined && taken.id !== known.id
		const email = identity.email && !emailConflict ? identity.email : known.email
		await tx
			.update(users)
			.set({
				name: identity.name,
				email,
				directoryUsername: identity.username,
				// The entry matched the user filter at this sign-in: the directory's own marker lifts (spec §2 #12).
				directoryDeactivatedAt: null,
			})
			.where(eq(users.id, known.id))
		await replaceDirectoryMemberships(tx, known.id, groupIds)
		return {
			ok: true,
			account: {
				id: known.id,
				email,
				name: identity.name,
				role: known.role,
				sessionVersion: known.sessionVersion,
			},
			emailConflict,
		}
	}
	if (!identity.email) return { ok: false, reason: 'entry_without_email' }
	// Spec §2 #10, §7.2: an email any account uses refuses the first sign-in; nothing links by email.
	const [taken] = await emailTakenBy(tx, identity.email)
	if (taken) return { ok: false, reason: 'email_in_use' }
	const id = crypto.randomUUID()
	await tx.insert(users).values({
		id,
		name: identity.name,
		email: identity.email,
		password: null,
		source: 'ldap',
		role: 'user',
		directoryId: identity.key,
		directoryIdAttribute: identity.idAttribute,
		directoryUsername: identity.username,
	})
	await replaceDirectoryMemberships(tx, id, groupIds)
	return {
		ok: true,
		account: { id, email: identity.email, name: identity.name, role: 'user', sessionVersion: 0 },
		emailConflict: false,
	}
}

/**
 * A deadlocked sync statement or sign-in makes up to three attempts in all, then throws the last error (final review
 * M1), as Prisma's documented helper does, `withRetry(run, attempts = 3)`
 * (`prisma/docs@c05758d0:apps/docs/content/docs/orm/fundamentals/transactions.mdx:90-104`), and as Ghost retries a
 * deadlocked install write, `attempt < 2`
 * (`TryGhost/Ghost@25b7dfad:ghost/core/server/services/app-installations/service.ts:374`); Directus makes four attempts
 * with a growing delay (`directus@8e140f94:api/src/utils/transaction.ts:29-50`). No delay: Prisma's and Ghost's run
 * again at once, and MySQL's guidance names none ("Deadlocks are not dangerous. Just try again.").
 */
const DEADLOCK_ATTEMPTS = 3

/**
 * The sign-in's write (spec §6.3 step 7), in one transaction with a locking read of the account by its key. A known
 * account is refreshed, or refused while an admin has deactivated it. A new one is created as a `user` with no
 * password, unless the entry has no email or any account uses it.
 *
 * The transaction sets READ COMMITTED itself (decision e). MySQL 8.4 "How to Minimize and Handle Deadlocks" says: "If
 * you use locking reads (SELECT ... FOR UPDATE or SELECT ... FOR SHARE), try using a lower isolation level such as READ
 * COMMITTED". At the default REPEATABLE READ, a locking read of a missing key takes a gap lock, and gap locks "can
 * co-exist" (§17.7.1 "InnoDB Locking"). So two different people's first sign-ins in one gap of the key index would
 * block each other's insert and deadlock. At READ COMMITTED, gap locking "is only used for foreign-key constraint
 * checking and duplicate-key checking", and each consistent read takes "its own fresh snapshot", so the email check
 * sees the latest committed accounts. The level applies to this one transaction only (MySQL 8.4 "SET TRANSACTION Statement").
 * `createOwner` keeps REPEATABLE READ, because its guarantee is the gap lock (ADR-0024 decision d).
 *
 * The transaction runs again after a deadlock (1213), within the sync statements' bound of DEADLOCK_ATTEMPTS in all,
 * and after a duplicate key (1062) once: the retry then finds the account the other sign-in wrote, or the email taken
 * (decision e). Any other failure, or one past the bound, propagates to the provider, which logs it and answers its
 * generic error.
 */
export async function recordDirectorySignIn(
	identity: DirectoryIdentity,
	groupIds: readonly string[],
): Promise<DirectorySignInResult> {
	let duplicateRetried = false
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await getDb().transaction(tx => signInWithin(tx, identity, groupIds), {
				isolationLevel: 'read committed',
			})
		} catch (error) {
			const duplicate = isDuplicateEntry(error)
			const again = isDeadlock(error) || (duplicate && !duplicateRetried)
			if (!again || attempt === DEADLOCK_ATTEMPTS) throw error
			duplicateRetried ||= duplicate
		}
	}
}

/**
 * Decision ae: at most 1,000 ids per statement, each its own statement. Drizzle's mysql2 session sends a query through
 * mysql2's `query`, which fills the values in on the client (mysql2 docs; not a prepared `execute`), so a statement is
 * bounded by `max_allowed_packet` (64 MB by default, MySQL 8.4 "Packet Too Large"); 1,000 ids also stay under the
 * 65,535 placeholders of a prepared statement (ER_PS_MANY_PARAM, 1390).
 */
const BATCH = 1_000
const batches = <T>(items: readonly T[]): T[][] =>
	Array.from({ length: Math.ceil(items.length / BATCH) }, (_, index) =>
		items.slice(index * BATCH, (index + 1) * BATCH),
	)

/**
 * Runs one of the sync's statements, and again when InnoDB rolled it back as a deadlock's victim (1213), up to
 * DEADLOCK_ATTEMPTS attempts in all. Under autocommit each statement "forms a single transaction on its own" (MySQL 8.4
 * "autocommit, Commit, and Rollback"), and a deadlock rolls the whole transaction back ("InnoDB Error Handling"), so
 * the statement runs again from a clean state: "Always be prepared to re-issue a transaction if it fails due to
 * deadlock" ("How to Minimize and Handle Deadlocks"). The last attempt's deadlock propagates: the run fails, and the
 * next run completes the reconciliation, which is idempotent (spec §6.4 "Claim"). Any other error is not re-issued.
 */
async function reissueOnDeadlock<T>(statement: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await statement()
		} catch (error) {
			if (!isDeadlock(error) || attempt === DEADLOCK_ATTEMPTS) throw error
		}
	}
}

/** Every hub `ldap` account, active or not (spec §6.4 step 3). */
export const listDirectoryAccounts = (): Promise<SyncAccount[]> =>
	getDb()
		.select({
			id: users.id,
			directoryId: users.directoryId,
			directoryIdAttribute: users.directoryIdAttribute,
			email: users.email,
			name: users.name,
			directoryUsername: users.directoryUsername,
			directoryDeactivatedAt: users.directoryDeactivatedAt,
		})
		.from(users)
		.where(eq(users.source, 'ldap'))

/** Every `directory` membership (spec §2 #8: the sync's own rows). */
export const listDirectoryMemberships = (): Promise<MembershipRow[]> =>
	getDb()
		.select({ groupId: userGroupMembers.groupId, userId: userGroupMembers.userId })
		.from(userGroupMembers)
		.where(eq(userGroupMembers.source, 'directory'))

/**
 * Directory deactivation (spec §6.4 step 3, ADR-0027): the directory marker and a sessionVersion bump in one write, so
 * every token in use loses its id at its next request (ADR-0018's rule); only on `ldap` accounts the directory has not
 * marked yet, never the admin marker. The count is the rows changed: the WHERE excludes marked rows, so mysql2's
 * found-rows count (its default `FOUND_ROWS` flag) equals the changed rows.
 */
export async function deactivateDirectoryAccounts(
	ids: readonly string[],
	at: Date,
): Promise<number> {
	let changed = 0
	for (const part of batches(ids)) {
		const [result] = await reissueOnDeadlock(() =>
			getDb()
				.update(users)
				.set({ directoryDeactivatedAt: at, sessionVersion: sql`${users.sessionVersion} + 1` })
				.where(
					and(
						eq(users.source, 'ldap'),
						inArray(users.id, part),
						isNull(users.directoryDeactivatedAt),
					),
				),
		)
		changed += result.affectedRows
	}
	return changed
}

/** The entry matches again: the directory's marker lifts (spec §2 #12); old tokens stay revoked (sessionVersion). */
export async function reactivateDirectoryAccounts(ids: readonly string[]): Promise<number> {
	let changed = 0
	for (const part of batches(ids)) {
		const [result] = await reissueOnDeadlock(() =>
			getDb()
				.update(users)
				.set({ directoryDeactivatedAt: null })
				.where(
					and(
						eq(users.source, 'ldap'),
						inArray(users.id, part),
						isNotNull(users.directoryDeactivatedAt),
					),
				),
		)
		changed += result.affectedRows
	}
	return changed
}

/**
 * One account's refreshed directory fields (spec §6.4 step 3). A new email the unique index refuses (1062: another
 * account has it) is dropped and the other fields written: the row keeps its old email and the run counts a conflict
 * (spec §2 #11, decision ac). `updated` says the write matched the account: mysql2 connects with `FOUND_ROWS` by
 * default, so `affectedRows` is the rows the WHERE matched, not only those it changed (MySQL 8.4 C API
 * "mysql_affected_rows()": with CLIENT_FOUND_ROWS "the affected-rows value is the number of rows 'found'"). An account
 * deleted during the run matches nothing, and is counted neither updated nor in conflict.
 */
export async function refreshDirectoryAccount(
	update: AccountUpdate,
): Promise<{ updated: boolean; conflict: boolean }> {
	const fields = {
		name: update.name,
		...(update.directoryUsername !== null ? { directoryUsername: update.directoryUsername } : {}),
	}
	const where = and(eq(users.id, update.id), eq(users.source, 'ldap'))
	const write = async (values: typeof fields & { email?: string }) => {
		const [result] = await reissueOnDeadlock(() => getDb().update(users).set(values).where(where))
		return result.affectedRows > 0
	}
	if (update.email !== null) {
		try {
			return { updated: await write({ ...fields, email: update.email }), conflict: false }
		} catch (error) {
			if (!isDuplicateEntry(error)) throw error
		}
		const updated = await write(fields)
		return { updated, conflict: updated }
	}
	return { updated: await write(fields), conflict: false }
}

const directoryRows = (groupId: string, userIds: readonly string[]) =>
	userIds.map(userId => ({ groupId, userId, source: 'directory' as const }))

/**
 * Applies the planned `directory` memberships per hub group (spec §2 #8: manual rows untouched). An insert refused as a
 * duplicate (a sign-in added the row meanwhile) or a missing reference (the group or the account was deleted during
 * the run) is retried row by row: a duplicate is already there; a missing reference marks its hub group, and
 * `groupErrors` counts the hub groups so marked, once each (spec §6.4 step 4 counts an error per group).
 */
export async function applyMembershipChanges(
	plan: Pick<MembershipPlan, 'add' | 'remove'>,
): Promise<{ added: number; removed: number; groupErrors: number }> {
	const db = getDb()
	let added = 0
	let removed = 0
	const failedGroups = new Set<string>()
	for (const [groupId, rows] of Map.groupBy(plan.remove, row => row.groupId))
		for (const part of batches(rows.map(row => row.userId))) {
			const [result] = await reissueOnDeadlock(() =>
				db
					.delete(userGroupMembers)
					.where(
						and(
							eq(userGroupMembers.groupId, groupId),
							eq(userGroupMembers.source, 'directory'),
							inArray(userGroupMembers.userId, part),
						),
					),
			)
			removed += result.affectedRows
		}
	const insert = (groupId: string, userIds: readonly string[]) =>
		reissueOnDeadlock(() => db.insert(userGroupMembers).values(directoryRows(groupId, userIds)))
	for (const [groupId, rows] of Map.groupBy(plan.add, row => row.groupId))
		for (const part of batches(rows.map(row => row.userId))) {
			try {
				await insert(groupId, part)
				added += part.length
			} catch (error) {
				if (!isDuplicateEntry(error) && !isMissingReference(error)) throw error
				for (const userId of part) {
					try {
						await insert(groupId, [userId])
						added += 1
					} catch (rowError) {
						if (isMissingReference(rowError)) failedGroups.add(groupId)
						else if (!isDuplicateEntry(rowError)) throw rowError
					}
				}
			}
		}
	return { added, removed, groupErrors: failedGroups.size }
}

/** A found link's name is refreshed and its `missing_since` cleared; a missing one is stamped once (spec §3.2). */
export async function refreshGroupLinks(
	refreshes: readonly LinkRefresh[],
	at: Date,
): Promise<void> {
	const db = getDb()
	for (const refresh of refreshes) {
		const link = and(
			eq(userGroupDirectoryLinks.groupId, refresh.groupId),
			eq(userGroupDirectoryLinks.directoryGroupId, refresh.directoryGroupId),
		)
		const name = refresh.name
		if (name !== null)
			await reissueOnDeadlock(() =>
				db
					.update(userGroupDirectoryLinks)
					.set({ directoryGroupName: name, missingSince: null })
					.where(link),
			)
		else
			await reissueOnDeadlock(() =>
				db
					.update(userGroupDirectoryLinks)
					.set({ missingSince: at })
					.where(and(link, isNull(userGroupDirectoryLinks.missingSince))),
			)
	}
}

export interface SyncRunCounts {
	entriesSeen: number
	deactivated: number
	reactivated: number
	updated: number
	conflicts: number
	groupErrors: number
	membershipsAdded: number
	membershipsRemoved: number
}

export const EMPTY_COUNTS: SyncRunCounts = {
	entriesSeen: 0,
	deactivated: 0,
	reactivated: 0,
	updated: 0,
	conflicts: 0,
	groupErrors: 0,
	membershipsAdded: 0,
	membershipsRemoved: 0,
}

/**
 * Claims a run's slot (spec §6.4 "Claim"): the unique key refuses a second insert for the same slot (1062), and that
 * caller skips. Documenso builds a deterministic id per cron slot so that racing instances "collide on the primary key
 * instead of creating duplicates" (`documenso@38ecb217:packages/lib/jobs/client/local.ts:19-22`); GoodJob and Solid
 * Queue keep a unique index per scheduled time (`ad-and-reference-projects.md` B.9).
 */
export async function claimSyncRun(run: {
	id: string
	slot: string
	trigger: SyncTrigger
	startedAt: Date
}): Promise<boolean> {
	try {
		await reissueOnDeadlock(() =>
			getDb().insert(directorySyncRuns).values({
				id: run.id,
				slot: run.slot,
				runTrigger: run.trigger,
				startedAt: run.startedAt,
				outcome: 'running',
			}),
		)
		return true
	} catch (error) {
		if (isDuplicateEntry(error)) return false
		throw error
	}
}

/** A run started after `since` that has not finished (spec §6.4: no second run while one is going). */
export async function hasUnfinishedRunSince(since: Date): Promise<boolean> {
	const [row] = await getDb()
		.select({ id: directorySyncRuns.id })
		.from(directorySyncRuns)
		.where(and(isNull(directorySyncRuns.finishedAt), gt(directorySyncRuns.startedAt, since)))
		.limit(1)
	return row !== undefined
}

export async function finishSyncRun(
	id: string,
	outcome: Exclude<SyncOutcome, 'running'>,
	counts: SyncRunCounts,
	errorCode: SyncErrorCode | null,
	at: Date,
): Promise<void> {
	await reissueOnDeadlock(() =>
		getDb()
			.update(directorySyncRuns)
			.set({ ...counts, outcome, errorCode, finishedAt: at })
			.where(eq(directorySyncRuns.id, id)),
	)
}

/** Spec §3.2: runs older than 90 days are deleted by the run itself. */
export async function pruneSyncRuns(before: Date): Promise<void> {
	await reissueOnDeadlock(() =>
		getDb().delete(directorySyncRuns).where(lt(directorySyncRuns.startedAt, before)),
	)
}

export interface SyncRunRecord {
	id: string
	trigger: SyncTrigger
	startedAt: Date
	finishedAt: Date | null
	outcome: SyncOutcome
	errorCode: string | null
	counts: SyncRunCounts
}

const runColumns = {
	id: directorySyncRuns.id,
	trigger: directorySyncRuns.runTrigger,
	startedAt: directorySyncRuns.startedAt,
	finishedAt: directorySyncRuns.finishedAt,
	outcome: directorySyncRuns.outcome,
	errorCode: directorySyncRuns.errorCode,
	entriesSeen: directorySyncRuns.entriesSeen,
	deactivated: directorySyncRuns.deactivated,
	reactivated: directorySyncRuns.reactivated,
	updated: directorySyncRuns.updated,
	conflicts: directorySyncRuns.conflicts,
	groupErrors: directorySyncRuns.groupErrors,
	membershipsAdded: directorySyncRuns.membershipsAdded,
	membershipsRemoved: directorySyncRuns.membershipsRemoved,
}

const toRunRecord = ({
	id,
	trigger,
	startedAt,
	finishedAt,
	outcome,
	errorCode,
	...counts
}: {
	id: string
	trigger: SyncTrigger
	startedAt: Date
	finishedAt: Date | null
	outcome: SyncOutcome
	errorCode: string | null
} & SyncRunCounts): SyncRunRecord => ({
	id,
	trigger,
	startedAt,
	finishedAt,
	outcome,
	errorCode,
	counts,
})

/** The newest run, for the status panel (spec §6.6). */
export async function latestSyncRun(): Promise<SyncRunRecord | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(directorySyncRuns)
		.orderBy(desc(directorySyncRuns.startedAt))
		.limit(1)
	return row ? toRunRecord(row) : null
}

/** The newest succeeded run, for the startup catch-up (spec §6.4 "Missed run"). */
export async function lastSucceededSyncRun(): Promise<SyncRunRecord | null> {
	const [row] = await getDb()
		.select(runColumns)
		.from(directorySyncRuns)
		.where(eq(directorySyncRuns.outcome, 'succeeded'))
		.orderBy(desc(directorySyncRuns.startedAt))
		.limit(1)
	return row ? toRunRecord(row) : null
}
