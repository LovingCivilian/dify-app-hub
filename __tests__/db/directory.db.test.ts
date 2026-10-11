import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The DAL's getDb() answers the live test database (__tests__/db/database.ts), as the unit tests mock it.
vi.mock('@/db', async () => {
	const { testDb } = await import('./database')
	return { getDb: () => testDb }
})

import { directorySyncRuns, userGroupMembers, userGroups, users } from '@/db/schema'
import {
	applyMembershipChanges,
	claimSyncRun,
	deactivateDirectoryAccounts,
	refreshDirectoryAccount,
} from '@/lib/data/directory'

import { pool, resetTables, testDb } from './database'

beforeEach(resetTables)
afterAll(() => pool.end())

/** A directory account as a first sign-in writes it: no password, a key and its attribute (the CHECK holds). */
const seedDirectoryAccount = async (
	username: string,
	directoryDeactivatedAt: Date | null = null,
) => {
	const id = crypto.randomUUID()
	await testDb.insert(users).values({
		id,
		name: username,
		email: `${username}@example.com`,
		password: null,
		source: 'ldap',
		directoryId: crypto.randomUUID(),
		directoryIdAttribute: 'objectGUID',
		directoryUsername: username,
		directoryDeactivatedAt,
	})
	return id
}

const seedGroup = async (name: string) => {
	const id = crypto.randomUUID()
	await testDb.insert(userGroups).values({ id, name })
	return id
}

const membersOf = (groupId: string) =>
	testDb
		.select({ userId: userGroupMembers.userId, source: userGroupMembers.source })
		.from(userGroupMembers)
		.where(eq(userGroupMembers.groupId, groupId))

describe('claimSyncRun on PostgreSQL (spec §6.4 "Claim", DV 6)', () => {
	const run = {
		slot: 'schedule:2026-10-11T10:00Z',
		trigger: 'schedule' as const,
		startedAt: new Date('2026-10-11T10:00:00Z'),
	}

	it('claims a slot once: the second claim answers false and writes no row', async () => {
		expect(await claimSyncRun({ ...run, id: crypto.randomUUID() })).toBe(true)
		expect(await claimSyncRun({ ...run, id: crypto.randomUUID() })).toBe(false)
		const rows = await testDb
			.select({ id: directorySyncRuns.id })
			.from(directorySyncRuns)
			.where(eq(directorySyncRuns.slot, run.slot))
		expect(rows).toHaveLength(1)
	})

	// Two containers whose schedules fire at once: the second insert waits for the first on the slot's index, then
	// skips (PostgreSQL 18 "INSERT", ON CONFLICT DO NOTHING).
	it('gives a slot to exactly one of two concurrent claims', async () => {
		const claims = await Promise.all([
			claimSyncRun({ ...run, id: crypto.randomUUID() }),
			claimSyncRun({ ...run, id: crypto.randomUUID() }),
		])
		expect(claims.sort()).toEqual([false, true])
	})
})

describe('applyMembershipChanges on PostgreSQL (spec §2 #8, §6.4 step 4)', () => {
	it('skips a row that is there already and counts only the row it inserted', async () => {
		const groupId = await seedGroup('Engineering')
		const alice = await seedDirectoryAccount('alice')
		const bob = await seedDirectoryAccount('bob')
		await testDb.insert(userGroupMembers).values({ groupId, userId: alice, source: 'directory' })
		expect(
			await applyMembershipChanges({
				add: [
					{ groupId, userId: alice },
					{ groupId, userId: bob },
				],
				remove: [],
			}),
		).toEqual({ added: 1, removed: 0, groupErrors: 0 })
		expect((await membersOf(groupId)).map(row => row.userId).sort()).toEqual([alice, bob].sort())
	})

	it('counts a group deleted before the insert once, and still adds the other group', async () => {
		const kept = await seedGroup('Kept')
		const gone = await seedGroup('Gone')
		const alice = await seedDirectoryAccount('alice')
		const bob = await seedDirectoryAccount('bob')
		await testDb.delete(userGroups).where(eq(userGroups.id, gone))
		expect(
			await applyMembershipChanges({
				add: [
					{ groupId: gone, userId: alice },
					{ groupId: gone, userId: bob },
					{ groupId: kept, userId: alice },
				],
				remove: [],
			}),
		).toEqual({ added: 1, removed: 0, groupErrors: 1 })
		expect(await membersOf(kept)).toEqual([{ userId: alice, source: 'directory' }])
	})

	it('removes only directory rows and counts them; a manual row of the same person stays', async () => {
		const groupId = await seedGroup('Engineering')
		const alice = await seedDirectoryAccount('alice')
		const bob = await seedDirectoryAccount('bob')
		await testDb.insert(userGroupMembers).values([
			{ groupId, userId: alice, source: 'directory' },
			{ groupId, userId: alice, source: 'manual' },
			{ groupId, userId: bob, source: 'directory' },
		])
		expect(
			await applyMembershipChanges({
				add: [],
				remove: [
					{ groupId, userId: alice },
					{ groupId, userId: bob },
				],
			}),
		).toEqual({ added: 0, removed: 2, groupErrors: 0 })
		expect(await membersOf(groupId)).toEqual([{ userId: alice, source: 'manual' }])
	})
})

// PostgreSQL 18 "UPDATE", Outputs: "The count is the number of rows updated, including matched rows whose values did
// not change"; node-postgres hands it over as `rowCount` (DV 5c).
describe('the account writes count the rows their WHERE matches', () => {
	it('deactivates only the accounts not marked yet, counts those, and bumps their sessionVersion', async () => {
		const alice = await seedDirectoryAccount('alice')
		const bob = await seedDirectoryAccount('bob', new Date('2026-10-01T00:00:00Z'))
		const at = new Date('2026-10-11T10:00:00Z')
		expect(await deactivateDirectoryAccounts([alice, bob], at)).toBe(1)
		expect(await deactivateDirectoryAccounts([alice, bob], at)).toBe(0)
		const [row] = await testDb
			.select({
				sessionVersion: users.sessionVersion,
				directoryDeactivatedAt: users.directoryDeactivatedAt,
			})
			.from(users)
			.where(eq(users.id, alice))
		expect(row).toEqual({ sessionVersion: 1, directoryDeactivatedAt: at })
	})

	it('answers updated for a refresh that writes the values the row already has, and not for an unknown id', async () => {
		const alice = await seedDirectoryAccount('alice')
		const unchanged = {
			id: alice,
			name: 'alice',
			directoryUsername: 'alice',
			email: 'alice@example.com',
		}
		expect(await refreshDirectoryAccount(unchanged)).toEqual({ updated: true, conflict: false })
		expect(await refreshDirectoryAccount({ ...unchanged, id: crypto.randomUUID() })).toEqual({
			updated: false,
			conflict: false,
		})
	})
})
