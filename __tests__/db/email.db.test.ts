import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The DAL's getDb() answers the live test database (__tests__/db/database.ts), as the unit tests mock it.
vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})
// The directory provider's check is tested in __tests__/auth-directory-provider.test.ts; here it stands in, so this file
// does not load the LDAP client (as __tests__/auth-options.test.ts does). lib/auth/options.ts itself is under test.
vi.mock('@/lib/auth/directory-provider', () => ({ authorizeDirectory: vi.fn() }))

import { users } from '@/db/schema'
import { authorizeCredentials } from '@/lib/auth/options'
import { hashPassword } from '@/lib/auth/password'
import { recordDirectorySignIn } from '@/lib/data/directory'
import { createUser } from '@/lib/data/users'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

const PASSWORD = 'right-password-1'
/** The actor of createUser: the DAL checks its role, not a row. */
const owner = {
	id: crypto.randomUUID(),
	email: 'owner@example.com',
	name: null,
	role: 'owner' as const,
}

/** A local account with a real bcrypt hash, as createUser leaves one. */
const seedLocal = async (email: string): Promise<string> => {
	const id = crypto.randomUUID()
	await testDb
		.insert(users)
		.values({ id, email, password: await hashPassword(PASSWORD), role: 'user' })
	return id
}

describe('an email matches whatever its case (spec §3.4)', () => {
	// Review Focus 1.
	it('signs a local account in with its email typed in another case', async () => {
		const id = await seedLocal('jane@example.com')
		expect(
			await authorizeCredentials({ email: 'JANE@Example.com', password: PASSWORD }),
		).toMatchObject({ id, email: 'jane@example.com', source: 'local' })
	})

	// Review Focus 5.
	it('refuses a second account whose email differs only in case', async () => {
		await seedLocal('jane@example.com')
		expect(
			await createUser(owner, {
				name: 'Jane Two',
				email: 'Jane@Example.COM',
				role: 'user',
				password: PASSWORD,
			}),
		).toEqual({ ok: false, code: 'email_in_use' })
		expect(await testDb.select({ id: users.id }).from(users)).toHaveLength(1)
	})

	// Review Focus 1 (directory side), spec §2 #10: nothing links by email, and no account is created.
	it("refuses a directory entry's first sign-in when a local account has its email in another case", async () => {
		await seedLocal('frank@example.com')
		expect(
			await recordDirectorySignIn(
				{
					key: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
					idAttribute: 'objectGUID',
					username: 'frank',
					email: 'Frank@Example.com',
					name: 'Frank Smith',
				},
				[],
			),
		).toEqual({ ok: false, reason: 'email_in_use' })
		expect(
			await testDb.select({ id: users.id }).from(users).where(eq(users.source, 'ldap')),
		).toEqual([])
	})
})

// ADR-0031, the recorded change: lower() folds case only, where MySQL's utf8mb4_0900_ai_ci also ignored accents.
describe('accents still count', () => {
	it('keeps jose@ and josé@ as two accounts, and signs each in as itself', async () => {
		const jose = await seedLocal('jose@example.com')
		expect(
			await createUser(owner, {
				name: 'José',
				email: 'josé@example.com',
				role: 'user',
				password: PASSWORD,
			}),
		).toMatchObject({ ok: true })
		expect(
			await authorizeCredentials({ email: 'JOSE@example.com', password: PASSWORD }),
		).toMatchObject({ id: jose, email: 'jose@example.com' })
		expect(
			await authorizeCredentials({ email: 'JOSÉ@example.com', password: PASSWORD }),
		).toMatchObject({ email: 'josé@example.com' })
	})
})
