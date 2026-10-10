import 'server-only'

import { and, eq, notInArray } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { userGroupDirectoryLinks, userGroupMembers, users } from '@/db/schema'
import type { Role } from '@/lib/auth/roles'

import { isDeadlock, isDuplicateEntry } from './db-errors'

/*
 * The directory Data Access Layer (B3 spec §6.1, ADR-0029). It takes no actor: its callers are the `ldap` provider,
 * before any session exists, and the directory sync, which acts for no person. It is the second actor-less module after
 * lib/data/setup.ts (ADR-0024 deviation 2), and its guard is its input: every function takes values read from a
 * successful directory bind or from a complete, error-free directory search, never raw form input. It writes only what
 * the directory owns (ADR-0027): `directory_deactivated_at`, the directory fields of `ldap` accounts, and `directory`
 * memberships; never the admin marker, a role, a password or a `manual` membership.
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
 * runs once more and finds the account (decision e). No gap lock is needed for that.
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
 * After a duplicate key (1062) or a deadlock (1213) the transaction runs once more (decision e). Any other failure
 * propagates to the provider, which logs it and answers its generic error.
 */
export async function recordDirectorySignIn(
	identity: DirectoryIdentity,
	groupIds: readonly string[],
): Promise<DirectorySignInResult> {
	const attempt = () =>
		getDb().transaction(tx => signInWithin(tx, identity, groupIds), {
			isolationLevel: 'read committed',
		})
	try {
		return await attempt()
	} catch (error) {
		if (isDuplicateEntry(error) || isDeadlock(error)) return attempt()
		throw error
	}
}
