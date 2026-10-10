import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A transaction fake that records every call. Reads answer from a queue in call order (`reads`); writes are kept with
 * their table, values and condition, so a test renders them on drizzle.mock() (no connection). A read's result is a
 * thenable (MDN "Thenables") so the code may await `limit()` directly or call `for('update')` on it.
 */
const mocks = vi.hoisted(() => {
	type Write = {
		op: 'insert' | 'update' | 'delete'
		table: unknown
		values?: unknown
		condition?: unknown
	}
	const state = {
		reads: [] as unknown[][],
		strengths: [] as string[],
		conditions: [] as unknown[],
		writes: [] as Write[],
		failures: [] as unknown[],
		transactions: 0,
	}
	const read = () => {
		const result = () => Promise.resolve(state.reads.shift() ?? [])
		const query = {
			from: () => query,
			where: (condition: unknown) => {
				state.conditions.push(condition)
				return query
			},
			limit: () => query,
			for: (strength: string) => {
				state.strengths.push(strength)
				return result()
			},
			// Drizzle's query builders are thenables (MDN "Thenables"), and so is this fake of one.
			// oxlint-disable-next-line unicorn/no-thenable
			then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
				result().then(resolve, reject),
		}
		return query
	}
	const tx = {
		select: () => read(),
		insert: (table: unknown) => ({
			values: (values: unknown) => {
				state.writes.push({ op: 'insert', table, values })
				return Promise.resolve([{ affectedRows: 1 }])
			},
		}),
		update: (table: unknown) => ({
			set: (values: unknown) => ({
				where: (condition: unknown) => {
					state.writes.push({ op: 'update', table, values, condition })
					return Promise.resolve([{ affectedRows: 1 }])
				},
			}),
		}),
		delete: (table: unknown) => ({
			where: (condition: unknown) => {
				state.writes.push({ op: 'delete', table, condition })
				return Promise.resolve([{ affectedRows: 0 }])
			},
		}),
	}
	const db = {
		select: () => read(),
		transaction: async (work: (t: typeof tx) => Promise<unknown>) => {
			state.transactions += 1
			const failure = state.failures.shift()
			if (failure) throw failure
			return work(tx)
		},
	}
	return { state, db, tx }
})
vi.mock('@/db', () => ({ getDb: () => mocks.db }))

import { userGroupMembers, users } from '@/db/schema'
import {
	lockDirectoryAccount,
	recordDirectorySignIn,
	replaceDirectoryMemberships,
} from '@/lib/data/directory'

const identity = {
	key: '90395fb9-9ab5-1b4a-9e96-86c66cb18d99',
	idAttribute: 'objectGUID',
	username: 'alice',
	email: 'alice@example.com',
	name: 'Alice Admin',
}
const known = {
	id: 'u1',
	email: 'alice@example.com',
	role: 'admin' as const,
	sessionVersion: 4,
	adminDeactivatedAt: null as Date | null,
}

const renderUpdate = (values: unknown, condition: unknown) =>
	drizzle
		.mock()
		.update(users)
		.set(values as Record<string, unknown>)
		.where(condition as SQL)
		.toSQL()
const renderDelete = (condition: unknown) =>
	drizzle
		.mock()
		.delete(userGroupMembers)
		.where(condition as SQL)
		.toSQL()
const renderSelect = (condition: unknown) =>
	drizzle
		.mock()
		.select({ id: users.id })
		.from(users)
		.where(condition as SQL)
		.toSQL()

beforeEach(() => {
	Object.assign(mocks.state, {
		reads: [],
		strengths: [],
		conditions: [],
		writes: [],
		failures: [],
		transactions: 0,
	})
})

describe('lockDirectoryAccount (decision e; ADR-0024 decision d)', () => {
	it('is a locking read of the ldap account by its directory key', () => {
		const query = lockDirectoryAccount(drizzle.mock(), identity.key).toSQL()
		expect(query.sql).toMatch(
			/ from `users` where \(\(`users`\.`source` = \?\) and \(`users`\.`directory_id` = \?\)\) limit \? for update$/,
		)
		expect(query.params).toEqual(['ldap', identity.key, 1])
		// The admin marker is read under the lock: the directory never lifts it (ADR-0027).
		expect(query.sql).toContain('`admin_deactivated_at`')
	})
})

describe('replaceDirectoryMemberships (decision f, spec §2 #8)', () => {
	it('deletes the directory rows outside the found groups, then adds the missing ones; manual rows untouched', async () => {
		mocks.state.reads = [[{ groupId: 'g1' }]]
		await replaceDirectoryMemberships(mocks.tx as never, 'u1', ['g1', 'g2', 'g2'])
		const [deleted, inserted] = mocks.state.writes
		const { sql, params } = renderDelete(deleted.condition)
		expect(sql).toMatch(
			/where \(\(`user_group_members`\.`user_id` = \?\) and \(`user_group_members`\.`source` = \?\) and \(`user_group_members`\.`group_id` not in \(\?, \?\)\)\)$/,
		)
		expect(params).toEqual(['u1', 'directory', 'g1', 'g2'])
		expect(mocks.state.strengths).toEqual(['update'])
		expect(inserted).toMatchObject({
			op: 'insert',
			values: [{ groupId: 'g2', userId: 'u1', source: 'directory' }],
		})
	})

	it('deletes every directory row of the account when it was found in no linked group', async () => {
		await replaceDirectoryMemberships(mocks.tx as never, 'u1', [])
		const { sql, params } = renderDelete(mocks.state.writes[0].condition)
		expect(sql).toMatch(
			/where \(\(`user_group_members`\.`user_id` = \?\) and \(`user_group_members`\.`source` = \?\)\)$/,
		)
		expect(params).toEqual(['u1', 'directory'])
		expect(mocks.state.writes).toHaveLength(1)
	})
})

describe('recordDirectorySignIn (spec §6.3 step 7)', () => {
	it('refreshes a known account, clears the directory marker and answers its role and session version', async () => {
		// The lock finds the account; the email differs only by case, so the email check finds the account itself
		// (the collation compares without case) and there is no conflict; then the membership read under the lock.
		mocks.state.reads = [[known], [{ id: 'u1' }], []]
		const result = await recordDirectorySignIn({ ...identity, email: 'Alice@Example.com' }, ['g1'])
		expect(result).toEqual({
			ok: true,
			account: {
				id: 'u1',
				email: 'Alice@Example.com',
				name: 'Alice Admin',
				role: 'admin',
				sessionVersion: 4,
			},
			emailConflict: false,
		})
		const update = mocks.state.writes.find(write => write.op === 'update')!
		expect(update.values).toEqual({
			name: 'Alice Admin',
			email: 'Alice@Example.com',
			directoryUsername: 'alice',
			directoryDeactivatedAt: null,
		})
		const { sql, params } = renderUpdate(update.values, update.condition)
		expect(sql).toMatch(/ where `users`\.`id` = \?$/)
		expect(params.at(-1)).toBe('u1')
		// Never the admin marker, the role, the password or the session version (ADR-0027).
		expect(sql).not.toMatch(/admin_deactivated|`role`|`password`|session_version/)
	})

	it('refuses an account an admin deactivated, and writes nothing', async () => {
		mocks.state.reads = [[{ ...known, adminDeactivatedAt: new Date() }]]
		expect(await recordDirectorySignIn(identity, ['g1'])).toEqual({
			ok: false,
			reason: 'account_inactive',
		})
		expect(mocks.state.writes).toEqual([])
	})

	it('keeps the old email when another account uses the new one, and reports the conflict', async () => {
		mocks.state.reads = [[known], [{ id: 'u7' }], []]
		const result = await recordDirectorySignIn({ ...identity, email: 'taken@example.com' }, [])
		expect(result).toMatchObject({ ok: true, emailConflict: true, account: { email: known.email } })
		const update = mocks.state.writes.find(write => write.op === 'update')!
		expect(update.values).toMatchObject({ email: known.email })
	})

	it('keeps the old email when the entry has none', async () => {
		mocks.state.reads = [[known], []]
		const result = await recordDirectorySignIn({ ...identity, email: null }, [])
		expect(result).toMatchObject({
			ok: true,
			emailConflict: false,
			account: { email: known.email },
		})
	})

	it('creates a new ldap account with no password, the user role, the key and its attribute', async () => {
		mocks.state.reads = [[], [], []]
		const result = await recordDirectorySignIn(identity, ['g1'])
		expect(result).toMatchObject({
			ok: true,
			account: { email: identity.email, name: identity.name, role: 'user', sessionVersion: 0 },
		})
		const insert = mocks.state.writes.find(write => write.op === 'insert' && write.table === users)!
		expect(insert.values).toEqual({
			id: expect.any(String),
			name: identity.name,
			email: identity.email,
			password: null,
			source: 'ldap',
			role: 'user',
			directoryId: identity.key,
			directoryIdAttribute: 'objectGUID',
			directoryUsername: 'alice',
		})
		expect(result.ok && result.account.id).toBe((insert.values as { id: string }).id)
		expect(mocks.state.writes.some(write => write.table === userGroupMembers)).toBe(true)
	})

	it('refuses a new entry without an email, and one whose email any account uses (spec §2 #10, #11)', async () => {
		mocks.state.reads = [[]]
		expect(await recordDirectorySignIn({ ...identity, email: null }, [])).toEqual({
			ok: false,
			reason: 'entry_without_email',
		})
		mocks.state.reads = [[], [{ id: 'local-1' }]]
		expect(await recordDirectorySignIn(identity, [])).toEqual({
			ok: false,
			reason: 'email_in_use',
		})
		expect(mocks.state.writes).toEqual([])
		// The email check compares as the unique index does: by the column's collation, in SQL.
		const { sql, params } = renderSelect(mocks.state.conditions.at(-1))
		expect(sql).toMatch(/ where `users`\.`email` = \?$/)
		expect(params).toEqual([identity.email])
	})

	it('runs the transaction once more after a duplicate key or a deadlock (decision e), not a third time', async () => {
		const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 })
		const deadlock = Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 })
		mocks.state.failures = [duplicate]
		mocks.state.reads = [[known], []]
		expect(await recordDirectorySignIn({ ...identity, email: known.email }, [])).toMatchObject({
			ok: true,
		})
		expect(mocks.state.transactions).toBe(2)

		mocks.state.transactions = 0
		mocks.state.failures = [deadlock, deadlock]
		await expect(recordDirectorySignIn(identity, [])).rejects.toBe(deadlock)
		expect(mocks.state.transactions).toBe(2)
	})

	it('propagates any other failure without a retry', async () => {
		const other = Object.assign(new Error('gone'), { code: 'PROTOCOL_CONNECTION_LOST' })
		mocks.state.failures = [other]
		await expect(recordDirectorySignIn(identity, [])).rejects.toBe(other)
		expect(mocks.state.transactions).toBe(1)
	})
})
