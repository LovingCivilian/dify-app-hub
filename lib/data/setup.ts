import 'server-only'

import { getDb, type Db } from '@/db'
import { users } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import { hashPassword } from '@/lib/auth/password'

import { isUniqueViolation } from './db-errors'

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
 * A locking read of any one account (decision d). On a table with rows it finds one, so a first run that lost the race
 * answers `forbidden` without an insert. On an empty table it locks nothing: FOR UPDATE "causes the rows retrieved by
 * the SELECT statement to be locked as though for update" (PostgreSQL 18 "Explicit Locking", Row-Level Locks), and an
 * empty table retrieves none, so two first runs can both pass it. The guarantee is the partial unique index
 * `users_one_owner` (db/schema/users.ts), which createOwner relies on.
 */
export const lockAnyAccount = (tx: Pick<Tx, 'select'>) =>
	tx.select({ id: users.id }).from(users).limit(1).for('update')

/**
 * Creates the owner, or answers `forbidden` once any account exists (a stale tab, a replayed request). A cheap
 * check runs first, so a request anyone can send costs no bcrypt round. Two submissions at once may both find the
 * table empty; the second insert then waits for the first transaction and is refused by a unique index (PostgreSQL 18
 * "Index Uniqueness Checks": the would-be inserter "must wait to see if that transaction commits"):
 * `users_one_owner`, which allows one `owner` row (PostgreSQL 18 "Partial Indexes", Example 11.3), or
 * `users_email_key` when both typed the same email. Either way at most one owner is created, and the loser answers
 * `forbidden` like a stale tab. The transaction runs at the server's default, Read Committed ("Read Committed is the
 * default isolation level in PostgreSQL", "Transaction Isolation"): the index is the guarantee, and Repeatable Read
 * would only add failures that "applications using this level must be prepared to retry".
 */
export async function createOwner(input: OwnerInput): Promise<ActionResult> {
	if (await hasAccounts()) return fail('forbidden')
	const password = await hashPassword(input.password)
	try {
		return await getDb().transaction(async tx => {
			if ((await lockAnyAccount(tx)).length > 0) return fail('forbidden')
			await tx.insert(users).values({
				id: crypto.randomUUID(),
				name: input.name,
				email: input.email,
				password,
				role: 'owner',
			})
			return ok(undefined)
		})
	} catch (error) {
		// A unique index refused the insert (users_one_owner, or users_email_key for the same email): another first run
		// wrote its owner first, so setup is done.
		if (isUniqueViolation(error)) return fail('forbidden')
		throw error
	}
}
