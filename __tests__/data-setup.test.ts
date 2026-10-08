import { DrizzleQueryError } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A getDb stub whose rows the tests control: the pre-check's select chain ends in limit(), the transaction's locking
// read in for('update'), and the insert in values(). The transaction runs its callback on the fake tx and records
// the config it was given (Drizzle MySqlTransactionConfig).
const mocks = vi.hoisted(() => {
	const preCheck = vi.fn()
	const lockedRead = vi.fn()
	const values = vi.fn()
	const insert = vi.fn(() => ({ values }))
	const tx = {
		select: () => ({ from: () => ({ limit: () => ({ for: lockedRead }) }) }),
		insert,
	}
	const transaction = vi.fn((callback: (t: typeof tx) => Promise<unknown>, _config?: unknown) =>
		callback(tx),
	)
	const db = { select: () => ({ from: () => ({ limit: preCheck }) }), transaction }
	return { preCheck, lockedRead, values, insert, transaction, db, hashPassword: vi.fn() }
})
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({ getDb: () => mocks.db }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: mocks.hashPassword }))

import { users } from '@/db/schema'
import { createOwner, lockAnyAccount } from '@/lib/data/setup'

const input = { name: 'Owner', email: 'owner@example.com', password: 'password-1' }
const owner = [{ id: 'o1' }]

/** A failed insert as Drizzle reports it: the mysql2 error is the cause (node_modules/drizzle-orm/errors.js). */
const queryError = (code: string, errno: number) =>
	new DrizzleQueryError(
		'insert into `users` …',
		['id', 'Owner', 'owner@example.com', 'hash', 'owner'],
		Object.assign(new Error(code), { code, errno }),
	)

describe('lockAnyAccount (decision d)', () => {
	it('is a locking read of any one account, so only an empty table lets first run through', () => {
		const query = lockAnyAccount(drizzle.mock()).toSQL()
		expect(query.sql).toBe('select `id` from `users` limit ? for update')
		expect(query.params).toEqual([1])
	})
})

describe('createOwner (charter §4.2, decision d: setup is open only while no account exists)', () => {
	beforeEach(() => {
		for (const mock of [mocks.preCheck, mocks.lockedRead, mocks.values, mocks.hashPassword]) {
			mock.mockReset()
		}
		mocks.insert.mockClear()
		mocks.transaction.mockClear()
		mocks.preCheck.mockResolvedValue([])
		mocks.lockedRead.mockResolvedValue([])
		mocks.values.mockResolvedValue(undefined)
		mocks.hashPassword.mockResolvedValue('hash')
	})

	it('answers forbidden once any account exists, before hashing or opening a transaction', async () => {
		mocks.preCheck.mockResolvedValue(owner)
		expect(await createOwner(input)).toEqual({ ok: false, code: 'forbidden' })
		expect(mocks.hashPassword).not.toHaveBeenCalled()
		expect(mocks.transaction).not.toHaveBeenCalled()
	})

	it('answers forbidden when the locking read finds an account another first run wrote, and inserts nothing', async () => {
		mocks.lockedRead.mockResolvedValue(owner)
		expect(await createOwner(input)).toEqual({ ok: false, code: 'forbidden' })
		expect(mocks.lockedRead).toHaveBeenCalledWith('update')
		expect(mocks.insert).not.toHaveBeenCalled()
		expect(mocks.values).not.toHaveBeenCalled()
	})

	it('creates the owner on an empty table inside a REPEATABLE READ transaction', async () => {
		expect(await createOwner(input)).toEqual({ ok: true, data: undefined })
		// The gap lock that serialises two first runs exists only under REPEATABLE READ (MySQL 8.4, "Transaction
		// Isolation Levels"), so the transaction asks for it rather than rely on the server's default.
		expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: 'repeatable read',
		})
		expect(mocks.lockedRead).toHaveBeenCalledWith('update')
		expect(mocks.hashPassword).toHaveBeenCalledWith('password-1')
		expect(mocks.insert).toHaveBeenCalledWith(users)
		expect(mocks.values).toHaveBeenCalledWith({
			id: expect.any(String),
			name: 'Owner',
			email: 'owner@example.com',
			password: 'hash',
			role: 'owner',
		})
	})

	it('answers forbidden when the unique email index refuses the insert (another first run wrote first)', async () => {
		mocks.values.mockRejectedValue(queryError('ER_DUP_ENTRY', 1062))
		expect(await createOwner(input)).toEqual({ ok: false, code: 'forbidden' })
	})

	it('rethrows any other failure, such as a deadlock victim, for the action to log', async () => {
		const deadlock = queryError('ER_LOCK_DEADLOCK', 1213)
		mocks.values.mockRejectedValue(deadlock)
		await expect(createOwner(input)).rejects.toBe(deadlock)
	})
})
