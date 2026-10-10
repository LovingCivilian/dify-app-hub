import type { SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A database fake that records each write's table, values and condition, and each read's table and condition, so a
// test renders it on drizzle.mock().
const mocks = vi.hoisted(() => {
	type Write = {
		op: 'insert' | 'update' | 'delete'
		table: unknown
		values?: unknown
		condition?: unknown
	}
	const state = {
		writes: [] as Write[],
		reads: [] as { table: unknown; condition: unknown }[],
		rows: [] as unknown[],
		affectedRows: 1,
		failures: [] as unknown[],
	}
	const result = () => {
		const failure = state.failures.shift()
		return failure
			? Promise.reject(failure)
			: Promise.resolve([{ affectedRows: state.affectedRows }])
	}
	const db = {
		select: () => ({
			from: (table: unknown) => ({
				where: (condition: unknown) => {
					state.reads.push({ table, condition })
					const rows = Promise.resolve(state.rows)
					return Object.assign(rows, { limit: () => rows })
				},
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: unknown) => {
				state.writes.push({ op: 'insert', table, values })
				return result()
			},
		}),
		update: (table: unknown) => ({
			set: (values: unknown) => ({
				where: (condition: unknown) => {
					state.writes.push({ op: 'update', table, values, condition })
					return result()
				},
			}),
		}),
		delete: (table: unknown) => ({
			where: (condition: unknown) => {
				state.writes.push({ op: 'delete', table, condition })
				return result()
			},
		}),
	}
	return { state, db }
})
vi.mock('@/db', () => ({ getDb: () => mocks.db }))

import { directorySyncRuns, userGroupDirectoryLinks, userGroupMembers, users } from '@/db/schema'
import {
	applyMembershipChanges,
	claimSyncRun,
	deactivateDirectoryAccounts,
	EMPTY_COUNTS,
	finishSyncRun,
	hasUnfinishedRunSince,
	listDirectoryAccounts,
	pruneSyncRuns,
	reactivateDirectoryAccounts,
	refreshDirectoryAccount,
	refreshGroupLinks,
} from '@/lib/data/directory'

const render = (write: (typeof mocks.state.writes)[number]) => {
	const mock = drizzle.mock()
	if (write.op === 'update')
		return mock
			.update(write.table as typeof users)
			.set(write.values as Record<string, unknown>)
			.where(write.condition as SQL)
			.toSQL()
	return mock
		.delete(write.table as typeof users)
		.where(write.condition as SQL)
		.toSQL()
}
const duplicate = () => Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 })
const missing = () =>
	Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 })

const renderRead = (read: (typeof mocks.state.reads)[number]) =>
	drizzle
		.mock()
		.select()
		.from(read.table as typeof users)
		.where(read.condition as SQL)
		.toSQL()

beforeEach(() => {
	mocks.state.writes = []
	mocks.state.reads = []
	mocks.state.rows = []
	mocks.state.affectedRows = 1
	mocks.state.failures = []
})

describe('deactivateDirectoryAccounts (spec §6.4 step 3, ADR-0027)', () => {
	it('sets the directory marker and bumps sessionVersion, on ldap accounts not yet marked, never the admin marker', async () => {
		mocks.state.affectedRows = 2
		expect(await deactivateDirectoryAccounts(['a', 'b'], new Date('2026-10-10T10:00:00Z'))).toBe(2)
		const { sql, params } = render(mocks.state.writes[0])
		expect(sql).toContain('`session_version` = `users`.`session_version` + 1')
		expect(sql).toContain('`directory_deactivated_at` = ?')
		expect(sql).toMatch(
			/where \(\(`users`\.`source` = \?\) and \(`users`\.`id` in \(\?, \?\)\) and \(\(`users`\.`directory_deactivated_at` is null\)\)\)$/,
		)
		expect(sql).not.toContain('admin_deactivated')
		expect(params).toContain('ldap')
	})

	it('writes in batches of 1,000 ids (decision ae) and sums the counts', async () => {
		const ids = Array.from({ length: 2_500 }, (_, index) => `u${index}`)
		mocks.state.affectedRows = 10
		expect(await deactivateDirectoryAccounts(ids, new Date())).toBe(30)
		expect(mocks.state.writes).toHaveLength(3)
	})

	it('writes nothing for no ids', async () => {
		expect(await deactivateDirectoryAccounts([], new Date())).toBe(0)
		expect(mocks.state.writes).toEqual([])
	})
})

describe('reactivateDirectoryAccounts', () => {
	it('clears the directory marker only where it is set, and bumps nothing', async () => {
		await reactivateDirectoryAccounts(['a'])
		const { sql } = render(mocks.state.writes[0])
		expect(sql).toContain('`directory_deactivated_at` = ?')
		expect(sql).toMatch(/and \(\(`users`\.`directory_deactivated_at` is not null\)\)\)$/)
		expect(sql).not.toMatch(/session_version|admin_deactivated/)
	})
})

describe('refreshDirectoryAccount (decision ac)', () => {
	const update = { id: 'a', name: 'Alice', directoryUsername: 'alice', email: 'new@example.com' }

	it('writes the new email with the other fields when the index takes it', async () => {
		expect(await refreshDirectoryAccount(update)).toEqual({ conflict: false })
		expect(mocks.state.writes[0].values).toEqual({
			name: 'Alice',
			directoryUsername: 'alice',
			email: 'new@example.com',
		})
		expect(render(mocks.state.writes[0]).sql).toMatch(
			/where \(\(`users`\.`id` = \?\) and \(`users`\.`source` = \?\)\)$/,
		)
	})

	it('keeps the old email when another account has it (1062), and says so', async () => {
		mocks.state.failures = [duplicate()]
		expect(await refreshDirectoryAccount(update)).toEqual({ conflict: true })
		expect(mocks.state.writes.map(write => write.values)).toEqual([
			{ name: 'Alice', directoryUsername: 'alice', email: 'new@example.com' },
			{ name: 'Alice', directoryUsername: 'alice' },
		])
	})

	it('writes no email when the plan keeps it, and a null username is not written', async () => {
		await refreshDirectoryAccount({ ...update, email: null, directoryUsername: null })
		expect(mocks.state.writes[0].values).toEqual({ name: 'Alice' })
	})
})

describe('applyMembershipChanges (spec §2 #8: directory rows only)', () => {
	it('deletes and inserts directory rows per group', async () => {
		mocks.state.affectedRows = 1
		const result = await applyMembershipChanges({
			add: [{ groupId: 'g1', userId: 'b' }],
			remove: [{ groupId: 'g1', userId: 'c' }],
		})
		expect(result).toEqual({ added: 1, removed: 1, groupErrors: 0 })
		const deleted = mocks.state.writes.find(write => write.op === 'delete')!
		const { sql, params } = render(deleted)
		expect(sql).toMatch(
			/where \(\(`user_group_members`\.`group_id` = \?\) and \(`user_group_members`\.`source` = \?\) and \(`user_group_members`\.`user_id` in \(\?\)\)\)$/,
		)
		expect(params).toEqual(['g1', 'directory', 'c'])
		const inserted = mocks.state.writes.find(write => write.op === 'insert')!
		expect(inserted.table).toBe(userGroupMembers)
		expect(inserted.values).toEqual([{ groupId: 'g1', userId: 'b', source: 'directory' }])
	})

	// A sign-in added the row meanwhile (1062), or the group or the account was deleted during the run (1452):
	// row by row, a duplicate is already there and a missing reference counts as a group error.
	it('falls back to rows one by one on a duplicate or a missing reference', async () => {
		mocks.state.failures = [duplicate(), duplicate(), missing()]
		const result = await applyMembershipChanges({
			add: [
				{ groupId: 'g1', userId: 'a' },
				{ groupId: 'g1', userId: 'b' },
			],
			remove: [],
		})
		expect(result).toEqual({ added: 0, removed: 0, groupErrors: 1 })
		expect(mocks.state.writes.filter(write => write.op === 'insert')).toHaveLength(3)
	})
})

describe('refreshGroupLinks', () => {
	it('refreshes a found group and marks a missing one once', async () => {
		const at = new Date('2026-10-10T10:00:00Z')
		await refreshGroupLinks(
			[
				{ groupId: 'g1', directoryGroupId: 'd1', name: 'Engineering' },
				{ groupId: 'g1', directoryGroupId: 'd2', name: null },
			],
			at,
		)
		const [found, gone] = mocks.state.writes
		expect(found.table).toBe(userGroupDirectoryLinks)
		expect(found.values).toEqual({ directoryGroupName: 'Engineering', missingSince: null })
		expect(gone.values).toEqual({ missingSince: at })
		expect(render(gone).sql).toMatch(
			/and \(\(`user_group_directory_links`\.`missing_since` is null\)\)\)$/,
		)
	})
})

describe('claimSyncRun (spec §6.4 "Claim")', () => {
	it('claims a slot once; the unique key refuses a second container', async () => {
		const run = {
			id: 'r1',
			slot: 'schedule:2026-10-10T10:00Z',
			trigger: 'schedule' as const,
			startedAt: new Date(),
		}
		expect(await claimSyncRun(run)).toBe(true)
		expect(mocks.state.writes[0]).toMatchObject({
			op: 'insert',
			table: directorySyncRuns,
			values: {
				id: 'r1',
				slot: run.slot,
				runTrigger: 'schedule',
				startedAt: run.startedAt,
				outcome: 'running',
			},
		})
		mocks.state.failures = [duplicate()]
		expect(await claimSyncRun({ ...run, id: 'r2' })).toBe(false)
	})
})

// Review Focus 5: the running guard reads an unfinished run that started after `since` (spec §6.4 "Claim", decision
// ag); the prune deletes only rows started before the retention cut (spec §3.2); a run is finished by its own id.
describe('the run rows (spec §6.4 "Claim", §3.2)', () => {
	it('finds a run that started after `since` and has not finished', async () => {
		mocks.state.rows = [{ id: 'r1' }]
		expect(await hasUnfinishedRunSince(new Date('2026-10-10T09:30:00Z'))).toBe(true)
		expect(renderRead(mocks.state.reads[0]).sql).toMatch(
			/where \(\(\(`directory_sync_runs`\.`finished_at` is null\)\) and \(`directory_sync_runs`\.`started_at` > \?\)\)$/,
		)
		mocks.state.rows = []
		expect(await hasUnfinishedRunSince(new Date('2026-10-10T09:30:00Z'))).toBe(false)
	})

	it('prunes only the runs started before the cut', async () => {
		await pruneSyncRuns(new Date('2026-07-12T10:00:00Z'))
		expect(render(mocks.state.writes[0]).sql).toMatch(
			/^delete from `directory_sync_runs` where `directory_sync_runs`\.`started_at` < \?$/,
		)
	})

	it('finishes the run by its id with the counts, the outcome and the code', async () => {
		const at = new Date('2026-10-10T10:01:00Z')
		await finishSyncRun('r1', 'failed', { ...EMPTY_COUNTS, deactivated: 2 }, 'search_failed', at)
		expect(mocks.state.writes[0]).toMatchObject({
			table: directorySyncRuns,
			values: {
				...EMPTY_COUNTS,
				deactivated: 2,
				outcome: 'failed',
				errorCode: 'search_failed',
				finishedAt: at,
			},
		})
		expect(render(mocks.state.writes[0])).toMatchObject({
			sql: expect.stringMatching(/where `directory_sync_runs`\.`id` = \?$/),
			params: expect.arrayContaining(['r1']),
		})
	})

	it('reads only ldap accounts (spec §6.4 step 3)', async () => {
		await listDirectoryAccounts()
		const { sql, params } = renderRead(mocks.state.reads[0])
		expect(sql).toMatch(/from `users` where `users`\.`source` = \?$/)
		expect(params).toEqual(['ldap'])
	})
})
