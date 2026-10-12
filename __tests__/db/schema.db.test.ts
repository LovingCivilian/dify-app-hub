import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { difyApps, userGroupMembers, userGroups, users } from '@/db/schema'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

/**
 * A query's refusal as the driver reported it: Drizzle rejects with a DrizzleQueryError whose `cause` is node-postgres's
 * DatabaseError, which carries the SQLSTATE and, for a constraint, its name (DV 5a, 5b).
 */
const refusal = async (query: PromiseLike<unknown>) => {
	const error: unknown = await query.then(
		() => null,
		(caught: unknown) => caught,
	)
	const cause =
		error instanceof Error
			? (error.cause as { code?: string; constraint?: string } | undefined)
			: undefined
	return { code: cause?.code, constraint: cause?.constraint }
}

const account = (email: string, role: 'owner' | 'admin' | 'user' = 'user') => ({
	id: crypto.randomUUID(),
	email,
	password: 'hash',
	role,
})

describe('the baseline on a live PostgreSQL (Part 0 spec §3)', () => {
	it('was applied once, through the log the runtime migrator shares with drizzle-kit (DV 1c)', async () => {
		const { rows } = await pool.query<{ name: string }>(
			'SELECT name FROM drizzle.__drizzle_migrations',
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.name).toMatch(/^\d{14}_baseline$/)
	})

	it('refuses a second account whose email differs only in case', async () => {
		await testDb.insert(users).values(account('jane@example.com'))
		expect(await refusal(testDb.insert(users).values(account('JANE@Example.com')))).toEqual({
			code: '23505',
			constraint: 'users_email_key',
		})
	})

	// B3a deviation 2, which e2e/admin-groups.spec.ts pins in the browser: MySQL's collation compared group names
	// without case, and the lower(name) index keeps that (Plan decision e).
	it('refuses a second group whose name differs only in case', async () => {
		await testDb.insert(userGroups).values({ id: crypto.randomUUID(), name: 'Finance' })
		expect(
			await refusal(testDb.insert(userGroups).values({ id: crypto.randomUUID(), name: 'finance' })),
		).toEqual({ code: '23505', constraint: 'user_groups_name_key' })
	})

	it('holds one owner and any number of admins', async () => {
		await testDb.insert(users).values(account('owner@example.com', 'owner'))
		await testDb
			.insert(users)
			.values([account('a1@example.com', 'admin'), account('a2@example.com', 'admin')])
		expect(
			await refusal(testDb.insert(users).values(account('second@example.com', 'owner'))),
		).toEqual({ code: '23505', constraint: 'users_one_owner' })
	})

	// Spec §3.2: the reason every id from outside is checked with z.uuid() first (Task 9).
	it('raises 22P02 for a malformed uuid instead of matching nothing', async () => {
		expect(
			await refusal(testDb.select({ id: users.id }).from(users).where(eq(users.id, 'abc'))),
		).toEqual({ code: '22P02', constraint: undefined })
	})

	// ADR-0029: the users CHECK ties the credentials to the source (PostgreSQL 18 "Check Constraints"; 23514 is
	// check_violation, Appendix A). A directory account with its key and attribute and no password is accepted.
	it('refuses a directory account with a password and a local account without one', async () => {
		const directoryAccount = () => ({
			id: crypto.randomUUID(),
			email: `${crypto.randomUUID()}@example.com`,
			source: 'ldap' as const,
			directoryId: crypto.randomUUID(),
			directoryIdAttribute: 'objectGUID',
		})
		await testDb.insert(users).values(directoryAccount())
		const refused = { code: '23514', constraint: 'users_source_credentials' }
		expect(
			await refusal(testDb.insert(users).values({ ...directoryAccount(), password: 'hash' })),
		).toEqual(refused)
		expect(
			await refusal(
				testDb.insert(users).values({ ...account('local@example.com'), password: null }),
			),
		).toEqual(refused)
	})

	it('refuses a membership whose group does not exist', async () => {
		const member = account('member@example.com')
		await testDb.insert(users).values(member)
		expect(
			await refusal(
				testDb
					.insert(userGroupMembers)
					.values({ groupId: crypto.randomUUID(), userId: member.id, source: 'manual' }),
			),
		).toEqual({ code: '23503', constraint: 'user_group_members_group_id_user_groups_id_fkey' })
	})

	it('indexes the three referencing columns no primary key leads with (spec §3.2)', async () => {
		const { rows } = await pool.query<{ indexname: string }>(
			'SELECT indexname FROM pg_indexes WHERE indexname = ANY($1) ORDER BY indexname',
			[
				[
					'app_group_grants_group_id_idx',
					'app_user_grants_user_id_idx',
					'user_group_members_user_id_idx',
				],
			],
		)
		expect(rows.map(row => row.indexname)).toEqual([
			'app_group_grants_group_id_idx',
			'app_user_grants_user_id_idx',
			'user_group_members_user_id_idx',
		])
	})

	it('stores times with their zone and reads them as Dates', async () => {
		const [row] = await testDb
			.insert(users)
			.values(account('time@example.com'))
			.returning({ createdAt: users.createdAt })
		expect(row!.createdAt).toBeInstanceOf(Date)
		const { rows } = await pool.query<{ data_type: string }>(
			"SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'created_at'",
		)
		expect(rows[0]!.data_type).toBe('timestamp with time zone')
	})

	it('reads the tags back as the jsonb array they were written as', async () => {
		const id = crypto.randomUUID()
		await testDb.insert(difyApps).values({
			id,
			name: 'Tea',
			apiBase: 'http://dify.test/v1',
			apiKey: 'app-key',
			tags: ['a', 'b'],
		})
		const [row] = await testDb
			.select({ tags: difyApps.tags })
			.from(difyApps)
			.where(eq(difyApps.id, id))
		expect(row!.tags).toEqual(['a', 'b'])
	})

	// DV 5c: "the number of rows updated, including matched rows whose values did not change" (PostgreSQL 18 "UPDATE",
	// Outputs), which the directory sync's refresh reads as "the account is still there".
	it('counts a matched row whose values did not change', async () => {
		const same = account('same@example.com')
		await testDb.insert(users).values(same)
		const result = await pool.query('UPDATE users SET name = name WHERE id = $1', [same.id])
		expect(result.rowCount).toBe(1)
	})
})
