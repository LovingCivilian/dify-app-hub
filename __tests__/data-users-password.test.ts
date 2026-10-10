import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A getDb stub whose rows the tests control. The unlocked read goes through the db (its limit() is awaited); the
// transaction's read must end in for('update') on the tx, and any other strength is refused (MySQL "Locking Reads":
// under FOR SHARE two writers could read the same old hash). The db has no update(): the write must run on the tx.
// where() conditions and set() values are kept, so a test can render them on drizzle.mock() (no connection).
const mocks = vi.hoisted(() => {
	const rows = { read: [] as unknown[], locked: [] as unknown[] }
	const conditions: unknown[] = []
	const strengths: string[] = []
	const updates: { values: Record<string, unknown>; condition: unknown }[] = []
	const chain = (end: () => unknown) => {
		const query = {
			from: () => query,
			where: (condition: unknown) => {
				conditions.push(condition)
				return query
			},
			limit: end,
		}
		return query
	}
	const tx = {
		select: () =>
			chain(() => ({
				for: (strength: string) => {
					strengths.push(strength)
					return strength === 'update'
						? Promise.resolve(rows.locked)
						: Promise.reject(new Error(`lock ${strength}`))
				},
			})),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: (condition: unknown) => {
					updates.push({ values, condition })
					return Promise.resolve([{ affectedRows: 1 }])
				},
			}),
		}),
	}
	const db = {
		select: () => chain(() => Promise.resolve(rows.read)),
		transaction: (work: (t: typeof tx) => Promise<unknown>) => work(tx),
	}
	return { rows, conditions, strengths, updates, db }
})
vi.mock('@/db', () => ({ getDb: () => mocks.db }))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
	verifyPassword: (password: string, hash: string) => Promise.resolve(hash === `hash:${password}`),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { users } from '@/db/schema'
import { changeOwnPassword } from '@/lib/data/users'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user' as const }
const input = { currentPassword: 'old-password-1', newPassword: 'new-password-1' }
const wrongCurrent = {
	ok: false,
	code: 'invalid_input',
	fieldErrors: { currentPassword: ['incorrect'] },
}

/** The update the code built, rendered on drizzle.mock() from the values and the condition it passed. */
const renderUpdate = ({ values, condition }: (typeof mocks.updates)[number]) =>
	drizzle
		.mock()
		.update(users)
		.set(values)
		.where(condition as SQL)
		.toSQL()

/** A condition the code passed to where(), rendered on a select from users. */
const renderWhere = (condition: unknown) =>
	drizzle
		.mock()
		.select({ id: users.id })
		.from(users)
		.where(condition as SQL)
		.toSQL()

beforeEach(() => {
	mocks.rows.read = [{ password: 'hash:old-password-1' }]
	mocks.rows.locked = [{ password: 'hash:old-password-1' }]
	mocks.conditions.length = 0
	mocks.strengths.length = 0
	mocks.updates.length = 0
})

describe('changeOwnPassword (charter §4.2, decision d)', () => {
	it('refuses a wrong current password on its field and writes nothing', async () => {
		expect(await changeOwnPassword(actor, { ...input, currentPassword: 'wrong-password' })).toEqual(
			wrongCurrent,
		)
		expect(mocks.strengths).toEqual([])
		expect(mocks.updates).toEqual([])
	})

	it('stores the new hash and bumps sessionVersion on the actor row, under a FOR UPDATE read', async () => {
		expect(await changeOwnPassword(actor, input)).toEqual({ ok: true, data: undefined })
		expect(mocks.strengths).toEqual(['update'])
		// Both reads, the check and the lock, are of the actor's own row by its primary key; no id comes from the client.
		expect(mocks.conditions).toHaveLength(2)
		for (const condition of mocks.conditions) {
			const read = renderWhere(condition)
			expect(read.sql).toMatch(/ where `users`\.`id` = \?$/)
			expect(read.params).toEqual(['u1'])
		}
		expect(mocks.updates).toHaveLength(1)
		const update = renderUpdate(mocks.updates[0])
		expect(update.sql).toMatch(/^update `users` set `password` = \?, /)
		// sessionVersion + 1 revokes every session of the account, this one included (lib/auth/options.ts jwt).
		expect(update.sql).toContain('`session_version` = `users`.`session_version` + 1')
		expect(update.sql).toMatch(/ where `users`\.`id` = \?$/)
		expect(update.params[0]).toBe('hash:new-password-1')
		expect(update.params.at(-1)).toBe('u1')
	})

	it('refuses when the locked row no longer holds the hash it verified, and writes nothing', async () => {
		// The owner or an admin set this account's password between the check and the lock (MySQL "Locking Reads":
		// a regular SELECT does not keep another transaction from updating the row just read).
		mocks.rows.locked = [{ password: 'hash:set-by-an-admin' }]
		expect(await changeOwnPassword(actor, input)).toEqual(wrongCurrent)
		expect(mocks.strengths).toEqual(['update'])
		expect(mocks.updates).toEqual([])
	})

	it('answers unauthorized when the account is gone before the check', async () => {
		mocks.rows.read = []
		expect(await changeOwnPassword(actor, input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(mocks.updates).toEqual([])
	})

	// One cause, one code: an account deleted under its own session has no live session (charter §4.5), whichever read
	// finds it gone; the jwt callback signs that session out on its next request.
	it('answers unauthorized when the account is deleted before the lock, and writes nothing', async () => {
		mocks.rows.locked = []
		expect(await changeOwnPassword(actor, input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(mocks.updates).toEqual([])
	})

	it('refuses a directory account, which has no hub password, before any check or write', async () => {
		mocks.rows.read = [{ password: null }]
		expect(await changeOwnPassword(actor, input)).toEqual({ ok: false, code: 'forbidden' })
		expect(mocks.strengths).toEqual([])
		expect(mocks.updates).toEqual([])
	})
})
