import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, refresh, writes, locked, manual, links, linkReads } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	refresh: vi.fn(),
	writes: { insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
	/** The group the locking read finds (lockGroup). */
	locked: { value: undefined as { id: string } | undefined },
	/** The group's manual members the locking read finds (manualMembersOf). */
	manual: { value: [] as { userId: string }[] },
	/** The group's directory links the locking read finds (linksOf reads their keys only). */
	links: { value: [] as { directoryGroupId: string }[] },
	/** Called on each locking read of the links table (linksOf). */
	linkReads: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', async () => {
	// A factory may return a promise (Vitest `vi.mock`), so it imports the table the fake tells apart.
	const { userGroupDirectoryLinks } = await import('@/db/schema')
	// Every read is a locking read: lockGroup ends in .limit(1).for('update'), manualMembersOf and linksOf in
	// .where().for('update').
	const forUpdate = (rows: () => unknown[]) => (strength: string) =>
		strength === 'update' ? Promise.resolve(rows()) : Promise.reject(new Error(`lock ${strength}`))
	// The fake answers by table: the group's lock (limit().for()), its manual members or its links (where().for()).
	const queryOn = (table: unknown) => ({
		where: () => ({
			limit: () => ({ for: forUpdate(() => (locked.value ? [locked.value] : [])) }),
			for: forUpdate(() => {
				if (table !== userGroupDirectoryLinks) return manual.value
				linkReads()
				return links.value
			}),
		}),
	})
	const db = {
		select: () => ({ from: queryOn }),
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
	manual.value = []
	links.value = []
	linkReads.mockReset()
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
	it.each([
		['createGroupAction', () => createGroupAction(input)],
		['updateGroupAction', () => updateGroupAction(groupId, input)],
		['deleteGroupAction', () => deleteGroupAction(groupId)],
	] as const)('%s answers unauthorized and writes nothing', async (_name, call) => {
		getServerSession.mockResolvedValue(null)
		expect(await call()).toEqual({ ok: false, code: 'unauthorized' })
		expect(anyWrite()).toBe(false)
		for (const fn of dal) expect(fn).not.toHaveBeenCalled()
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
		expect(writes.insert.mock.calls[0]![0]).toEqual([{ groupId, userId: 'u2', source: 'manual' }])
		expect(writes.delete).not.toHaveBeenCalled()
		expect(refresh).toHaveBeenCalledTimes(1)
	})

	// Spec §2 #8: the save diffs against the manual members only (the SQL is pinned in data-groups.test.ts).
	it('replaces the manual members: deletes the dropped one and inserts the new one as manual', async () => {
		manual.value = [{ userId: 'u2' }, { userId: 'u3' }]
		const next = { ...input, memberIds: ['u2', 'u4'] }
		expect(await updateGroupAction(groupId, next)).toEqual({ ok: true, data: undefined })
		expect(writes.delete).toHaveBeenCalledTimes(1)
		expect(writes.insert).toHaveBeenCalledTimes(1)
		expect(writes.insert.mock.calls[0]![0]).toEqual([{ groupId, userId: 'u4', source: 'manual' }])
	})

	// Decision c and deviation 2, on a rename.
	it('answers name_in_use when a rename hits the unique index', async () => {
		writes.update.mockRejectedValueOnce(
			new Error('Failed query', { cause: mysqlError('ER_DUP_ENTRY', 1062) }),
		)
		expect(await updateGroupAction(groupId, input)).toEqual({ ok: false, code: 'name_in_use' })
		expect(refresh).not.toHaveBeenCalled()
	})

	// Review Focus 3: a member picked in the edit drawer deleted before the save.
	it('answers invalid_input on the members when an account picked for the update is gone', async () => {
		writes.insert.mockRejectedValueOnce(
			new Error('Failed query', { cause: mysqlError('ER_NO_REFERENCED_ROW_2', 1452) }),
		)
		expect(await updateGroupAction(groupId, input)).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { memberIds: ['unknown'] },
		})
		expect(refresh).not.toHaveBeenCalled()
	})

	it('deletes a group, and answers not_found when nothing was deleted', async () => {
		expect(await deleteGroupAction(groupId)).toEqual({ ok: true, data: undefined })
		writes.delete.mockResolvedValueOnce([{ affectedRows: 0 }])
		expect(await deleteGroupAction(groupId)).toEqual({ ok: false, code: 'not_found' })
		expect(await deleteGroupAction('nope')).toEqual({ ok: false, code: 'not_found' })
	})

	it('saves the directory links with the group, and drops the directory members when no link is left (decision am)', async () => {
		const key = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'
		expect(
			await updateGroupAction(groupId, {
				...input,
				directoryGroups: [{ id: key, name: 'Engineering' }],
			}),
		).toEqual({
			ok: true,
			data: undefined,
		})
		expect(writes.insert.mock.calls.some(([rows]) => JSON.stringify(rows).includes(key))).toBe(true)

		for (const fn of Object.values(writes)) fn.mockClear()
		links.value = [{ directoryGroupId: key }]
		expect(await updateGroupAction(groupId, { ...input, directoryGroups: [] })).toEqual({
			ok: true,
			data: undefined,
		})
		// The link, then the group's directory memberships (SQL pinned in data-groups.test.ts).
		expect(writes.delete).toHaveBeenCalledTimes(2)
	})

	it('refuses a key that is not canonical, before any write', async () => {
		expect(
			await updateGroupAction(groupId, {
				...input,
				directoryGroups: [{ id: 'CN=Engineering', name: 'Engineering' }],
			}),
		).toMatchObject({ ok: false, code: 'invalid_input' })
		expect(anyWrite()).toBe(false)
	})

	// Task 12 review I1: an absent field is "no change" (RFC 7386: a member absent from the patch is left as it is), so a
	// form that does not show the field cannot delete the links or the directory members.
	it('an input without directoryGroups reads no links and deletes nothing', async () => {
		links.value = [{ directoryGroupId: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99' }]
		manual.value = [{ userId: 'u2' }]
		expect(await updateGroupAction(groupId, input)).toEqual({ ok: true, data: undefined })
		expect(linkReads).not.toHaveBeenCalled()
		expect(writes.insert).not.toHaveBeenCalled()
		expect(writes.delete).not.toHaveBeenCalled()
		// The group's own row only (its name and description).
		expect(writes.update).toHaveBeenCalledTimes(1)
	})

	// Task 12 review M1: the directory owns a link's name (the sync refreshes it), so a kept link is no write, whatever
	// name the drawer loaded for it.
	it('writes nothing for a kept link, whatever name the input carries', async () => {
		links.value = [{ directoryGroupId: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99' }]
		manual.value = [{ userId: 'u2' }]
		expect(
			await updateGroupAction(groupId, {
				...input,
				directoryGroups: [{ id: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99', name: 'A stale name' }],
			}),
		).toEqual({ ok: true, data: undefined })
		expect(linkReads).toHaveBeenCalledTimes(1)
		expect(writes.insert).not.toHaveBeenCalled()
		expect(writes.delete).not.toHaveBeenCalled()
		// The group's own row only, never the link's name.
		expect(writes.update).toHaveBeenCalledTimes(1)
	})

	// Task 12 review M7: a key sent twice is inserted once, with the last name sent.
	it('creates a group with each directory group once, the last name kept', async () => {
		const key = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'
		expect(
			await createGroupAction({
				...input,
				directoryGroups: [
					{ id: key, name: 'First' },
					{ id: key, name: 'Last' },
				],
			}),
		).toMatchObject({ ok: true })
		expect(writes.insert).toHaveBeenCalledTimes(3)
		expect(writes.insert.mock.calls[2]![0]).toEqual([
			{ groupId: expect.any(String), directoryGroupId: key, directoryGroupName: 'Last' },
		])
	})
})
