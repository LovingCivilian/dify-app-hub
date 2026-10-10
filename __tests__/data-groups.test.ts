import { drizzle } from 'drizzle-orm/mysql2'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import {
	createGroup,
	deleteGroup,
	listGroupOptions,
	listGroups,
	lockGroup,
	manualMemberChanges,
	manualMembersOf,
	removeManualMembers,
	toGroupDto,
	toGroupDtos,
	updateGroup,
} from '@/lib/data/groups'

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }

describe('manualMemberChanges (spec §2 #8: an admin changes manual rows only)', () => {
	it('adds the new ids and removes the dropped ones, each once', () => {
		expect(manualMemberChanges(['a', 'b'], ['b', 'c', 'c'])).toEqual({ add: ['c'], remove: ['a'] })
		expect(manualMemberChanges([], ['a'])).toEqual({ add: ['a'], remove: [] })
		expect(manualMemberChanges(['a'], [])).toEqual({ add: [], remove: ['a'] })
		expect(manualMemberChanges(['a'], ['a'])).toEqual({ add: [], remove: [] })
	})
})

describe('toGroupDto', () => {
	it('passes dates as ISO strings and nothing but the DTO fields', () => {
		const at = new Date('2026-10-09T09:05:00.000Z')
		expect(
			toGroupDto(
				{ id: 'g1', name: 'Finance', description: null, createdAt: at, updatedAt: at },
				[{ userId: 'u1', source: 'manual' }],
				2,
			),
		).toEqual({
			id: 'g1',
			name: 'Finance',
			description: null,
			members: [{ userId: 'u1', source: 'manual' }],
			appCount: 2,
			createdAt: '2026-10-09T09:05:00.000Z',
			updatedAt: '2026-10-09T09:05:00.000Z',
		})
	})
})

describe('toGroupDtos', () => {
	it('gives each group its own members and app count, and a group without either none', () => {
		const at = new Date('2026-10-09T09:05:00.000Z')
		const row = (id: string) => ({ id, name: id, description: null, createdAt: at, updatedAt: at })
		const dtos = toGroupDtos(
			[row('g1'), row('g2'), row('g3')],
			[
				{ groupId: 'g1', userId: 'u1', source: 'manual' },
				{ groupId: 'g2', userId: 'u2', source: 'directory' },
				{ groupId: 'g1', userId: 'u2', source: 'manual' },
			],
			[{ groupId: 'g2', apps: 3 }],
		)
		expect(dtos.map(({ id, members, appCount }) => ({ id, members, appCount }))).toEqual([
			{
				id: 'g1',
				members: [
					{ userId: 'u1', source: 'manual' },
					{ userId: 'u2', source: 'manual' },
				],
				appCount: 0,
			},
			{ id: 'g2', members: [{ userId: 'u2', source: 'directory' }], appCount: 3 },
			{ id: 'g3', members: [], appCount: 0 },
		])
	})
})

// Spec §2 #8: an admin's save reads and deletes `manual` rows only; the directory sync (B3b) owns the others.
describe('the manual-member queries (spec §2 #8)', () => {
	it("reads the group's manual members with a locking read", () => {
		const query = manualMembersOf(drizzle.mock(), 'g1').toSQL()
		expect(query.sql).toMatch(
			/^select `user_id` from `user_group_members` where .*`user_group_members`\.`group_id` = \?.* and .*`user_group_members`\.`source` = \?.* for update$/,
		)
		expect(query.params).toEqual(['g1', 'manual'])
	})

	it('deletes only the named manual memberships of the group', () => {
		const query = removeManualMembers(drizzle.mock(), 'g1', ['u1', 'u2']).toSQL()
		expect(query.sql).toMatch(
			/^delete from `user_group_members` where .*`user_group_members`\.`group_id` = \?.* and .*`user_group_members`\.`source` = \?.* and .*`user_group_members`\.`user_id` in \(\?, \?\)/,
		)
		expect(query.params).toEqual(['g1', 'manual', 'u1', 'u2'])
	})
})

describe('lockGroup (ADR-0024 decision d)', () => {
	it('is a locking read of one group by its primary key', () => {
		const query = lockGroup(drizzle.mock(), 'g1').toSQL()
		expect(query.sql).toMatch(
			/^select .* from `user_groups` where `user_groups`\.`id` = \? limit \? for update$/,
		)
		expect(query.params).toEqual(['g1', 1])
	})
})

describe('the groups DAL refuses a non-admin actor before any query', () => {
	it.each([
		['listGroups', () => listGroups(member)],
		['listGroupOptions', () => listGroupOptions(member)],
		['createGroup', () => createGroup(member, { name: 'N', description: '', memberIds: [] })],
		['updateGroup', () => updateGroup(member, 'g1', { name: 'N', description: '', memberIds: [] })],
		['deleteGroup', () => deleteGroup(member, 'g1')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
