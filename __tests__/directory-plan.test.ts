import { describe, expect, it } from 'vitest'

import {
	planAccountChanges,
	planDirectoryMemberships,
	type SyncAccount,
} from '@/lib/directory/plan'

const account = (
	overrides: Partial<SyncAccount> & { id: string; directoryId: string },
): SyncAccount => ({
	directoryIdAttribute: 'objectGUID',
	email: `${overrides.id}@example.com`,
	name: overrides.id,
	directoryUsername: overrides.id,
	directoryDeactivatedAt: null,
	...overrides,
})
const entry = (
	key: string,
	overrides: Partial<{ username: string | null; email: string | null; name: string | null }> = {},
) => ({
	key,
	username: key.replace('key-', ''),
	email: `${key.replace('key-', '')}@example.com`,
	name: key.replace('key-', ''),
	...overrides,
})

describe('planAccountChanges (spec §6.4 steps 2–3)', () => {
	// Safety stops: no account changes.
	it('stops on zero entries', () => {
		expect(
			planAccountChanges([account({ id: 'a', directoryId: 'key-a' })], [], 'objectGUID'),
		).toEqual({
			stop: 'empty',
		})
	})

	it('stops when any account was keyed by another attribute', () => {
		const accounts = [
			account({ id: 'a', directoryId: 'key-a' }),
			account({ id: 'b', directoryId: 'key-b', directoryIdAttribute: 'entryUUID' }),
		]
		expect(planAccountChanges(accounts, [entry('key-a')], 'objectGUID')).toEqual({
			stop: 'id_attribute_changed',
		})
		// Attribute names compare without case (RFC 4512 §2.5: "attribute type names … are case insensitive").
		expect(
			planAccountChanges(
				[account({ id: 'a', directoryId: 'key-a' })],
				[entry('key-a')],
				'OBJECTGUID',
			).stop,
		).toBeNull()
	})

	it('deactivates the absent, reactivates the returned, and leaves the rest', () => {
		const accounts = [
			account({ id: 'present', directoryId: 'key-present' }),
			account({ id: 'gone', directoryId: 'key-gone' }),
			account({
				id: 'already-gone',
				directoryId: 'key-already-gone',
				directoryDeactivatedAt: new Date(),
			}),
			account({ id: 'back', directoryId: 'key-back', directoryDeactivatedAt: new Date() }),
		]
		const plan = planAccountChanges(
			accounts,
			[entry('key-present'), entry('key-back'), entry('key-stranger')],
			'objectGUID',
		)
		expect(plan).toMatchObject({
			stop: null,
			deactivate: ['gone'],
			reactivate: ['back'],
			updates: [],
		})
		// Entries without a hub account are ignored: accounts are created at first sign-in only (spec §6.4 step 3).
		if (plan.stop === null)
			expect([...plan.accountIdByKey.keys()].sort()).toEqual([
				'key-already-gone',
				'key-back',
				'key-gone',
				'key-present',
			])
	})

	it('refreshes name, username and email; an entry without an email or username keeps the stored one', () => {
		const accounts = [
			account({ id: 'renamed', directoryId: 'key-renamed' }),
			account({ id: 'moved', directoryId: 'key-moved' }),
			account({ id: 'bare', directoryId: 'key-bare' }),
		]
		const plan = planAccountChanges(
			accounts,
			[
				entry('key-renamed', { name: 'Renamed Person' }),
				entry('key-moved', { email: 'new@example.com' }),
				entry('key-bare', { email: null, username: null }),
			],
			'objectGUID',
		)
		expect(plan.stop === null && plan.updates).toEqual([
			{ id: 'renamed', name: 'Renamed Person', directoryUsername: 'renamed', email: null },
			{ id: 'moved', name: 'moved', directoryUsername: 'moved', email: 'new@example.com' },
		])
	})
})

describe('planDirectoryMemberships (spec §6.4 step 4, §6.5)', () => {
	const ids = new Map([
		['key-a', 'a'],
		['key-b', 'b'],
		['key-c', 'c'],
	])

	it('makes each group the union of its links, adding and removing directory rows only', () => {
		const plan = planDirectoryMemberships(
			[
				{
					groupId: 'g1',
					directoryGroupId: 'd1',
					result: { status: 'found', name: 'Engineering', memberKeys: new Set(['key-a', 'key-x']) },
				},
				{
					groupId: 'g1',
					directoryGroupId: 'd2',
					result: { status: 'found', name: 'Backend', memberKeys: new Set(['key-b']) },
				},
			],
			ids,
			[
				{ groupId: 'g1', userId: 'a' },
				{ groupId: 'g1', userId: 'c' },
			],
		)
		expect(plan.add).toEqual([{ groupId: 'g1', userId: 'b' }])
		expect(plan.remove).toEqual([{ groupId: 'g1', userId: 'c' }])
		expect(plan.groupErrors).toBe(0)
		expect(plan.linkRefreshes).toEqual([
			{ groupId: 'g1', directoryGroupId: 'd1', name: 'Engineering' },
			{ groupId: 'g1', directoryGroupId: 'd2', name: 'Backend' },
		])
	})

	it('treats a missing directory group as empty, and records it missing', () => {
		const plan = planDirectoryMemberships(
			[{ groupId: 'g1', directoryGroupId: 'd1', result: { status: 'missing' } }],
			ids,
			[{ groupId: 'g1', userId: 'a' }],
		)
		expect(plan.remove).toEqual([{ groupId: 'g1', userId: 'a' }])
		expect(plan.linkRefreshes).toEqual([{ groupId: 'g1', directoryGroupId: 'd1', name: null }])
	})

	// Decision ad: one failed link leaves its whole hub group untouched, and counts the error.
	it('leaves a group with a failed lookup untouched', () => {
		const plan = planDirectoryMemberships(
			[
				{ groupId: 'g1', directoryGroupId: 'd1', result: { status: 'error' } },
				{
					groupId: 'g1',
					directoryGroupId: 'd2',
					result: { status: 'found', name: 'Backend', memberKeys: new Set(['key-b']) },
				},
			],
			ids,
			[{ groupId: 'g1', userId: 'a' }],
		)
		expect(plan).toMatchObject({ add: [], remove: [], groupErrors: 1 })
		expect(plan.linkRefreshes).toEqual([{ groupId: 'g1', directoryGroupId: 'd2', name: 'Backend' }])
	})

	// Decision f: a group whose last link was removed keeps no directory member.
	it('removes the directory rows of a group with no link left', () => {
		const plan = planDirectoryMemberships([], ids, [{ groupId: 'g9', userId: 'a' }])
		expect(plan.remove).toEqual([{ groupId: 'g9', userId: 'a' }])
	})
})
