import 'server-only'

import { getDb, type Db } from '@/db'
import { users } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { hashPassword } from '@/lib/auth/password'

import { isDuplicateEntry } from './users'

/*
 * First run (charter §4.2, ADR-0024): it creates the owner. No actor: nobody can be signed in before the
 * first account exists (ADR-0024). The guard is the state itself: setup is open only while the users table is
 * empty, checked again under a locking read when the owner is written. Even if an owner row were ever removed by
 * hand, /init stays closed while any account exists.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface OwnerInput {
	name: string
	email: string
	password: string
}

/** Whether setup is done: any account exists. The login layout sends a fresh install to /init, and /init sends a set-up one to /login. */
export async function hasAccounts(): Promise<boolean> {
	const [row] = await getDb().select({ id: users.id }).from(users).limit(1)
	return row !== undefined
}

/**
 * A locking read of any one account (decision d; MySQL "Locking Reads"). On a table with rows it finds one; on an
 * empty table it locks the gap, so a second first run waits, or is rolled back as a deadlock victim, instead of
 * creating a second owner.
 */
export const lockAnyAccount = (tx: Pick<Tx, 'select'>) =>
	tx.select({ id: users.id }).from(users).limit(1).for('update')

/**
 * Creates the owner, or answers `forbidden` once any account exists (a stale tab, a replayed request). A cheap
 * check runs first, so a request anyone can send costs no bcrypt round. Two submissions at once: the locking read
 * serialises them, or InnoDB rolls one back as a deadlock victim (two gap locks on an empty table), which reaches
 * the form as operation_failed. Either way at most one owner is created. The gap lock exists only under REPEATABLE
 * READ, so the transaction asks for it rather than rely on the server's default (decision d).
 */
export async function createOwner(input: OwnerInput): Promise<ActionResult> {
	if (await hasAccounts()) return fail('forbidden')
	const password = await hashPassword(input.password)
	try {
		return await getDb().transaction(
			async tx => {
				if ((await lockAnyAccount(tx)).length > 0) return fail('forbidden')
				await tx.insert(users).values({
					id: crypto.randomUUID(),
					name: input.name,
					email: input.email,
					password,
					role: 'owner',
				})
				return ok(undefined)
			},
			{ isolationLevel: 'repeatable read' },
		)
	} catch (error) {
		// The unique email index refused the insert: another first run wrote its owner first, so setup is done.
		if (isDuplicateEntry(error)) return fail('forbidden')
		throw error
	}
}
