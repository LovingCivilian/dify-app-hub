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
	it('answers email_in_use when the insert loses a race to the index', async () => {
		const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })
		insertValues.mockRejectedValue(new DrizzleQueryError('insert into `users` …', [], dup))
		expect(await createUser(admin, input)).toEqual({ ok: false, code: 'email_in_use' })
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
		insertValues.mockResolvedValue([{ affectedRows: 1 }])
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
