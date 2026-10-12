import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The DAL's getDb() answers the live test database (__tests__/db/database.ts), as the unit tests mock it.
vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})

import { users } from '@/db/schema'
import { createOwner } from '@/lib/data/setup'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

const owners = () => testDb.select({ id: users.id }).from(users).where(eq(users.role, 'owner'))

describe('first run creates exactly one owner (spec §3.4, ADR-0024 decision d)', () => {
	// Both calls find the table empty before their bcrypt round, so their transactions overlap. Several rounds, because
	// the loser meets either the committed owner in its locking read or the index at its insert, by timing.
	it('lets one of two simultaneous first runs through and answers the other forbidden', async () => {
		for (let round = 0; round < 5; round += 1) {
			await resetTables()
			const results = await Promise.all([
				createOwner({ name: 'Owner A', email: `a${round}@example.com`, password: 'password-1' }),
				createOwner({ name: 'Owner B', email: `b${round}@example.com`, password: 'password-1' }),
			])
			expect(results).toContainEqual({ ok: true, data: undefined })
			expect(results).toContainEqual({ ok: false, code: 'forbidden' })
			expect(await owners()).toHaveLength(1)
		}
	})

	// The same person submitting twice, the second time with the email in another case: users_email_key or
	// users_one_owner refuses the second insert, whichever PostgreSQL checks first; both answer forbidden.
	it('answers forbidden to a simultaneous first run with the same email in another case', async () => {
		const results = await Promise.all([
			createOwner({ name: 'Owner', email: 'owner@example.com', password: 'password-1' }),
			createOwner({ name: 'Owner', email: 'Owner@Example.com', password: 'password-1' }),
		])
		expect(results).toContainEqual({ ok: true, data: undefined })
		expect(results).toContainEqual({ ok: false, code: 'forbidden' })
		expect(await owners()).toHaveLength(1)
	})
})
