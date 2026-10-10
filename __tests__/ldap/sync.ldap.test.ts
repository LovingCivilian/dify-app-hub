import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MembershipRow, SyncAccount } from '@/lib/directory/plan'

const store = vi.hoisted(() => ({
	accounts: [] as SyncAccount[],
	memberships: [] as MembershipRow[],
	links: [] as {
		groupId: string
		directoryGroupId: string
		directoryGroupName: string
		missingSince: Date | null
	}[],
	deactivated: [] as string[],
	reactivated: [] as string[],
	updates: [] as unknown[],
	added: [] as MembershipRow[],
	removed: [] as MembershipRow[],
}))
vi.mock('@/db', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/data/directory', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/data/directory')>()),
	claimSyncRun: async () => true,
	hasUnfinishedRunSince: async () => false,
	finishSyncRun: async () => undefined,
	pruneSyncRuns: async () => undefined,
	listGroupLinks: async () => store.links,
	listDirectoryAccounts: async () => store.accounts,
	listDirectoryMemberships: async () => store.memberships,
	deactivateDirectoryAccounts: async (ids: string[]) => (
		store.deactivated.push(...ids), ids.length
	),
	reactivateDirectoryAccounts: async (ids: string[]) => (
		store.reactivated.push(...ids), ids.length
	),
	refreshDirectoryAccount: async (update: unknown) => (
		store.updates.push(update), { updated: true, conflict: false }
	),
	refreshGroupLinks: async () => undefined,
	applyMembershipChanges: async (plan: { add: MembershipRow[]; remove: MembershipRow[] }) => {
		store.added.push(...plan.add)
		store.removed.push(...plan.remove)
		return { added: plan.add.length, removed: plan.remove.length, groupErrors: 0 }
	},
}))

import { withDirectory } from '@/lib/directory/connection'
import { readEntry } from '@/lib/directory/entry'
import { findLoginEntries, searchGroups } from '@/lib/directory/operations'
import { runSync } from '@/lib/directory/sync'

import { TEST_DIRECTORIES } from './servers'

beforeEach(() => {
	for (const list of Object.values(store)) list.length = 0
	// Every run logs its summary line (spec §7.3); the unit suite pins it, so it stays out of this suite's output.
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	return () => info.mockRestore()
})

describe.each(TEST_DIRECTORIES)(
	'runSync against $name (spec §6.4)',
	({ config, people, groups, emailDomain, emptyBaseDn }) => {
		const keyOf = (login: string) =>
			withDirectory(
				config,
				async client => readEntry((await findLoginEntries(client, config, login))[0]!, config)!.key,
			)
		const account = (id: string, key: string, deactivated = false): SyncAccount => ({
			id,
			directoryId: key,
			directoryIdAttribute: config.idAttribute,
			email: `${id}@old.example`,
			name: 'Old Name',
			directoryUsername: id,
			directoryDeactivatedAt: deactivated ? new Date() : null,
		})
		const run = (overrides: Partial<typeof config> = {}) =>
			runSync({
				config: { ...config, ...overrides },
				id: 'r1',
				trigger: 'manual',
				slot: 'manual:r1',
			})

		it('deactivates the absent, reactivates the returned, refreshes the present', async () => {
			store.accounts = [
				account('alice', await keyOf(people.alice)),
				account('bob', await keyOf(people.bob), true),
				account('ghost', '00000000-0000-4000-8000-000000000000'),
			]
			expect(await run()).toMatchObject({
				status: 'finished',
				outcome: 'succeeded',
				errorCode: null,
			})
			expect(store.deactivated).toEqual(['ghost'])
			expect(store.reactivated).toEqual(['bob'])
			expect(store.updates).toContainEqual({
				id: 'alice',
				name: 'Alice Admin',
				directoryUsername: people.alice,
				email: `alice@${emailDomain}`,
			})
		})

		it('fills a linked group with its nested members (spec §6.5)', async () => {
			store.accounts = [
				account('bob', await keyOf(people.bob)),
				account('alice', await keyOf(people.alice)),
			]
			const [engineering] = await withDirectory(config, client =>
				searchGroups(client, config, groups.engineering),
			)
			store.links = [
				{
					groupId: 'hub-eng',
					directoryGroupId: engineering!.key,
					directoryGroupName: 'old',
					missingSince: null,
				},
			]
			store.memberships = [{ groupId: 'hub-eng', userId: 'alice' }]
			await run()
			expect(store.added).toEqual([{ groupId: 'hub-eng', userId: 'bob' }])
			expect(store.removed).toEqual([{ groupId: 'hub-eng', userId: 'alice' }])
		})

		it('stops on an empty answer and changes nothing', async () => {
			store.accounts = [account('alice', await keyOf(people.alice))]
			expect(await run({ userBaseDn: emptyBaseDn })).toMatchObject({
				outcome: 'empty',
				errorCode: null,
			})
			expect(store.deactivated).toEqual([])
		})

		// Review Focus 3: a service account the directory refuses fails the run with its own code, and nothing changes.
		it('fails without a write when the directory refuses the service account', async () => {
			store.accounts = [account('alice', await keyOf(people.alice))]
			const log = vi.spyOn(console, 'error').mockImplementation(() => {})
			try {
				expect(await run({ bindPassword: 'Not-the-Passw0rd' })).toMatchObject({
					outcome: 'failed',
					errorCode: 'bind_refused',
				})
				expect(store.deactivated).toEqual([])
				expect(store.updates).toEqual([])
			} finally {
				log.mockRestore()
			}
		})

		it('fails without a write when the directory is unreachable', async () => {
			store.accounts = [account('alice', await keyOf(people.alice))]
			const log = vi.spyOn(console, 'error').mockImplementation(() => {})
			try {
				expect(await run({ url: config.url.replace(/:\d+$/, ':1') })).toMatchObject({
					outcome: 'failed',
					errorCode: 'directory_unreachable',
				})
				expect(store.deactivated).toEqual([])
			} finally {
				log.mockRestore()
			}
		})
	},
)
