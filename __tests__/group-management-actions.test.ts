import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, refresh, writes, locked } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	refresh: vi.fn(),
	writes: { insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	/** The group the locking read finds (lockGroup). */
	locked: { value: undefined as { id: string } | undefined },
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => {
	// select().from().where() is awaited for the current manual members ([]), or ends in .limit().for('update').
	const query = {
		from: () => query,
		where: () => Object.assign(Promise.resolve([]), query),
		limit: () => ({
			for: (strength: string) =>
				strength === 'update'
					? Promise.resolve(locked.value ? [locked.value] : [])
					: Promise.reject(new Error(`lock ${strength}`)),
		}),
	}
	const db = {
		select: () => query,
		insert: () => ({ values: writes.insert }),
		update: () => ({ set: () => ({ where: writes.update }) }),
		delete: () => ({ where: writes.delete }),
		transaction: (work: (tx: unknown) => unknown) => work(db),
	}
	return { getDb: () => db }
})
// The real DAL behind spies (Vitest `vi.mock` with `spy: true`), so the refusals below show the action's own gate
// stopped the call before the DAL's assertAdmin could.
vi.mock('@/lib/data/groups', { spy: true })

import {
	createGroupAction,
	deleteGroupAction,
	updateGroupAction,
} from '@/app/(admin)/group-management/actions'
import { createGroup, deleteGroup, updateGroup } from '@/lib/data/groups'

const owner = { id: 'o1', email: 'owner@example.com', name: 'Owner', role: 'owner' }
const user = { id: 'u1', email: 'user@example.com', name: 'User', role: 'user' }
const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
const input = { name: 'Finance', description: '', memberIds: ['u2'] }
const mysqlError = (code: string, errno: number) => Object.assign(new Error(code), { code, errno })
const anyWrite = () => Object.values(writes).some(fn => fn.mock.calls.length > 0)
const dal = [createGroup, updateGroup, deleteGroup].map(fn => vi.mocked(fn))

beforeEach(() => {
	getServerSession.mockReset()
	refresh.mockReset()
	for (const fn of Object.values(writes)) {
		fn.mockReset()
		fn.mockResolvedValue([{ affectedRows: 1 }])
	}
	locked.value = { id: groupId }
	for (const fn of dal) fn.mockClear()
})

// ADR-0024 deviation 3: the real session chain, so an action that checked only the session would fail here.
describe('a user-role session', () => {
	beforeEach(() => getServerSession.mockResolvedValue({ user }))

	it.each([
		['createGroupAction', () => createGroupAction(input)],
		['updateGroupAction', () => updateGroupAction(groupId, input)],
		['deleteGroupAction', () => deleteGroupAction(groupId)],
	] as const)('%s is forbidden and writes nothing', async (_name, call) => {
		expect(await call()).toEqual({ ok: false, code: 'forbidden' })
		expect(anyWrite()).toBe(false)
		for (const fn of dal) expect(fn).not.toHaveBeenCalled()
	})
})

describe('no session', () => {
	it('answers unauthorized', async () => {
		getServerSession.mockResolvedValue(null)
		expect(await createGroupAction(input)).toEqual({ ok: false, code: 'unauthorized' })
		expect(createGroup).not.toHaveBeenCalled()
	})
})

describe('the owner', () => {
	beforeEach(() => getServerSession.mockResolvedValue({ user: owner }))

	it('creates a group with its manual members and refreshes the page', async () => {
		const result = await createGroupAction(input)
		expect(result).toMatchObject({ ok: true })
		expect(writes.insert).toHaveBeenCalledTimes(2)
		expect(writes.insert.mock.calls[1]![0]).toEqual([
			{ groupId: expect.any(String), userId: 'u2', source: 'manual' },
		])
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('refuses invalid input on its field, before any write', async () => {
		expect(await createGroupAction({ name: '  ' })).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { name: expect.any(Array) },
		})
		expect(anyWrite()).toBe(false)
	})

	// Decision c and deviation 2: the unique index compares names without case.
	it('answers name_in_use for a name the unique index refuses', async () => {
		writes.insert.mockRejectedValueOnce(
			new Error('Failed query', { cause: mysqlError('ER_DUP_ENTRY', 1062) }),
		)
		expect(await createGroupAction(input)).toEqual({ ok: false, code: 'name_in_use' })
		expect(refresh).not.toHaveBeenCalled()
	})

	// Review Focus 3: a member deleted while the drawer was open.
	it('answers invalid_input on the members when a picked account is gone', async () => {
		writes.insert
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockRejectedValueOnce(
				new Error('Failed query', { cause: mysqlError('ER_NO_REFERENCED_ROW_2', 1452) }),
			)
		expect(await createGroupAction(input)).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { memberIds: ['unknown'] },
		})
	})

	it('updates a group: answers not_found for a malformed or missing id, without a write', async () => {
		expect(await updateGroupAction('g1', input)).toEqual({ ok: false, code: 'not_found' })
		locked.value = undefined
		expect(await updateGroupAction(groupId, input)).toEqual({ ok: false, code: 'not_found' })
		expect(anyWrite()).toBe(false)
	})

	it('updates the name and adds the new manual member', async () => {
		expect(await updateGroupAction(groupId, input)).toEqual({ ok: true, data: undefined })
		expect(writes.update).toHaveBeenCalledTimes(1)
		expect(writes.insert).toHaveBeenCalledTimes(1)
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	it('deletes a group, and answers not_found when nothing was deleted', async () => {
		expect(await deleteGroupAction(groupId)).toEqual({ ok: true, data: undefined })
		writes.delete.mockResolvedValueOnce([{ affectedRows: 0 }])
		expect(await deleteGroupAction(groupId)).toEqual({ ok: false, code: 'not_found' })
		expect(await deleteGroupAction('nope')).toEqual({ ok: false, code: 'not_found' })
	})
})
