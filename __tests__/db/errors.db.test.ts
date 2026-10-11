// __tests__/db/errors.db.test.ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { userGroupMembers, users } from '@/db/schema'
import {
	isForeignKeyViolation,
	isInvalidTextRepresentation,
	isUniqueViolation,
} from '@/lib/data/db-errors'
import { describeError } from '@/lib/error-log'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

const OWNER_ID = '6a3f0c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b'

const seedOwner = () =>
	testDb
		.insert(users)
		.values({ id: OWNER_ID, email: 'jane@example.com', password: 'hash', role: 'owner' })

/** What a query that must fail rejects with (a Drizzle query is a thenable; it runs when awaited). */
const refusal = (query: PromiseLike<unknown>): Promise<unknown> =>
	Promise.resolve(query).then(
		() => {
			throw new Error('the query was expected to fail')
		},
		(error: unknown) => error,
	)

/**
 * What the log keeps of a refusal (decision g): the name and the SQLSTATE, never the refused value that the driver's
 * `detail` and some messages carry, nor the SQL and parameters Drizzle's message carries.
 */
const expectLoggedAsCode = (error: unknown, code: string) => {
	expect(describeError(error)).toEqual({ name: 'DrizzleQueryError', code })
	const logged = JSON.stringify(describeError(error))
	for (const value of [
		'jane@example.com',
		'JANE@example.com',
		OWNER_ID,
		'"abc"',
		'Key (',
		'insert',
	])
		expect(logged).not.toContain(value)
}

describe('the database refusals as the DAL reads them (live PostgreSQL)', () => {
	it('a case variant of a taken email: 23505 on users_email_key, not on the one-owner index', async () => {
		await seedOwner()
		const error = await refusal(
			testDb.insert(users).values({
				id: '7b4f1d2e-3c5e-4f60-9b0c-1d2e3f4a5b6c',
				email: 'JANE@example.com',
				password: 'hash',
			}),
		)
		expect(isUniqueViolation(error)).toBe(true)
		expect(isUniqueViolation(error, 'users_email_key')).toBe(true)
		expect(isUniqueViolation(error, 'users_one_owner')).toBe(false)
		expectLoggedAsCode(error, '23505')
	})

	it('a second owner: 23505 on users_one_owner', async () => {
		await seedOwner()
		const error = await refusal(
			testDb.insert(users).values({
				id: '8c5a2e3f-4d6f-4a71-8c1d-2e3f4a5b6c7d',
				email: 'other@example.com',
				password: 'hash',
				role: 'owner',
			}),
		)
		expect(isUniqueViolation(error, 'users_one_owner')).toBe(true)
		expect(isUniqueViolation(error, 'users_email_key')).toBe(false)
		expectLoggedAsCode(error, '23505')
	})

	it('a membership of a group that does not exist: 23503', async () => {
		await seedOwner()
		const error = await refusal(
			testDb.insert(userGroupMembers).values({
				groupId: '9d6b3f4a-5e7a-4b82-9d2e-3f4a5b6c7d8e',
				userId: OWNER_ID,
				source: 'manual',
			}),
		)
		expect(isForeignKeyViolation(error)).toBe(true)
		expect(isUniqueViolation(error)).toBe(false)
		expectLoggedAsCode(error, '23503')
	})

	// Spec §3.2: what the id checks keep from reaching a query, and the safety net reads.
	it('a malformed id: 22P02', async () => {
		const error = await refusal(
			testDb.select({ id: users.id }).from(users).where(eq(users.id, 'abc')),
		)
		expect(isInvalidTextRepresentation(error)).toBe(true)
		expectLoggedAsCode(error, '22P02')
	})
})
