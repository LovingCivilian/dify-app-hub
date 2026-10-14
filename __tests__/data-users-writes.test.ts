import { DrizzleQueryError, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { insertValues, emailLookups } = vi.hoisted(() => ({
	insertValues: vi.fn(),
	/** The condition each email check passed to where(), rendered on drizzle.mock() below. */
	emailLookups: [] as unknown[],
}))
vi.mock('@/db', () => ({
	getDb: () => ({
		// The pre-check finds no account with the email, so the insert is what meets the unique index.
		select: () => ({
			from: () => ({
				where: (condition: unknown) => {
					emailLookups.push(condition)
					return { limit: () => Promise.resolve([]) }
				},
			}),
		}),
		insert: () => ({ values: insertValues }),
	}),
}))
vi.mock('@/lib/auth/password', () => ({
	hashPassword: (password: string) => Promise.resolve(`hash:${password}`),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { users } from '@/db/schema'
import { createUser } from '@/lib/data/users'

const admin = {
	id: 'a1',
	email: 'admin@example.com',
	name: null,
	role: 'admin' as const,
	source: 'local' as const,
}
const input = {
	name: 'Jane',
	email: 'jane@example.com',
	role: 'user' as const,
	password: 'password-1',
}

beforeEach(() => {
	insertValues.mockReset()
	emailLookups.length = 0
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

	// Spec §3.4, Review Focus 5: the check before the insert finds an account whose email differs only in case, as the
	// unique index users_email_key would refuse it.
	it('checks the email without case before the insert', async () => {
		insertValues.mockResolvedValue({ rowCount: 1 })
		await createUser(admin, { ...input, email: 'Jane@Example.com' })
		expect(emailLookups).toHaveLength(1)
		const { sql, params } = drizzle
			.mock()
			.select({ id: users.id })
			.from(users)
			.where(emailLookups[0] as SQL)
			.toSQL()
		expect(sql).toBe('select "id" from "users" where lower("users"."email") = lower($1)')
		expect(params).toEqual(['Jane@Example.com'])
	})
})
