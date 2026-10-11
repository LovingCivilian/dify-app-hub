import { DrizzleQueryError } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertValues } = vi.hoisted(() => ({ insertValues: vi.fn() }))
vi.mock('@/db', () => ({
	getDb: () => ({
		// The pre-check finds no account with the email, so the insert is what meets the unique index.
		select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
		insert: () => ({ values: insertValues }),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { createUser } from '@/lib/data/users'

const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const input = {
	name: 'Jane',
	email: 'jane@example.com',
	role: 'user' as const,
	password: 'password-1',
}

beforeEach(() => {
	insertValues.mockReset()
})

describe('createUser and the unique email index', () => {
	it('answers email_in_use when the insert loses a race to the email index (23505 on users_email_key)', async () => {
		const taken = Object.assign(
			new Error('duplicate key value violates unique constraint "users_email_key"'),
			{ code: '23505', constraint: 'users_email_key' },
		)
		insertValues.mockRejectedValue(new DrizzleQueryError('insert into "users" …', [], taken))
		expect(await createUser(admin, input)).toEqual({ ok: false, code: 'email_in_use' })
	})

	// users has two more unique indexes; the error names the one that refused (Appendix A), and only the email's is
	// an email in use.
	it('rethrows a refusal by another unique index for the action to log', async () => {
		const other = new DrizzleQueryError(
			'insert into "users" …',
			[],
			Object.assign(
				new Error('duplicate key value violates unique constraint "users_directory_id_key"'),
				{ code: '23505', constraint: 'users_directory_id_key' },
			),
		)
		insertValues.mockRejectedValue(other)
		await expect(createUser(admin, input)).rejects.toBe(other)
	})

	it('rethrows any other database error for the action to log', async () => {
		insertValues.mockRejectedValue(new Error('connection lost'))
		await expect(createUser(admin, input)).rejects.toThrow('connection lost')
	})

	it('refuses a role the actor may not give before any query (ADR-0024)', async () => {
		expect(await createUser(admin, { ...input, role: 'admin' })).toEqual({
			ok: false,
			code: 'forbidden',
		})
		expect(insertValues).not.toHaveBeenCalled()
	})

	it('stores the hash with the role, never the password, and answers the new id', async () => {
		insertValues.mockResolvedValue({ rowCount: 1 })
		expect(await createUser(admin, input)).toMatchObject({
			ok: true,
			data: { id: expect.any(String) },
		})
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'jane@example.com',
				password: 'hash:password-1',
				role: 'user',
			}),
		)
	})
})
