import { InvalidCredentialsError, NoSuchObjectError, UnwillingToPerformError } from 'ldapts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	claimSyncRun: vi.fn(),
	finishSyncRun: vi.fn(),
	pruneSyncRuns: vi.fn(),
	hasUnfinishedRunSince: vi.fn(),
	listGroupLinks: vi.fn(),
	listDirectoryAccounts: vi.fn(),
	listDirectoryMemberships: vi.fn(),
	deactivateDirectoryAccounts: vi.fn(),
	reactivateDirectoryAccounts: vi.fn(),
	refreshDirectoryAccount: vi.fn(),
	refreshGroupLinks: vi.fn(),
	applyMembershipChanges: vi.fn(),
	listUserEntries: vi.fn(),
	findGroupByKey: vi.fn(),
	listMemberKeys: vi.fn(),
	withDirectory: vi.fn(),
}))
vi.mock('@/lib/data/directory', async importOriginal => ({
	...(await importOriginal<typeof import('@/lib/data/directory')>()),
	claimSyncRun: mocks.claimSyncRun,
	finishSyncRun: mocks.finishSyncRun,
	pruneSyncRuns: mocks.pruneSyncRuns,
	hasUnfinishedRunSince: mocks.hasUnfinishedRunSince,
	listGroupLinks: mocks.listGroupLinks,
	listDirectoryAccounts: mocks.listDirectoryAccounts,
	listDirectoryMemberships: mocks.listDirectoryMemberships,
	deactivateDirectoryAccounts: mocks.deactivateDirectoryAccounts,
	reactivateDirectoryAccounts: mocks.reactivateDirectoryAccounts,
	refreshDirectoryAccount: mocks.refreshDirectoryAccount,
	refreshGroupLinks: mocks.refreshGroupLinks,
	applyMembershipChanges: mocks.applyMembershipChanges,
}))
vi.mock('@/db', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/directory/operations', () => ({
	listUserEntries: mocks.listUserEntries,
	findGroupByKey: mocks.findGroupByKey,
	listMemberKeys: mocks.listMemberKeys,
}))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))

import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'
import { runManualSync, runSync, scheduleSlot, startupSlot } from '@/lib/directory/sync'

const config = {
	idAttribute: 'objectGUID',
	loginAttribute: 'sAMAccountName',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
} as never
const guid = (n: number) =>
	Buffer.from(`${n.toString(16).padStart(2, '0')}395fb99ab51b4a9e9686c66cb18d99`, 'hex')
const entry = (n: number, name: string) => ({
	dn: `CN=${name},DC=x`,
	objectGUID: guid(n),
	sAMAccountName: name,
	mail: `${name}@x.example`,
	displayName: name,
})
const run = { config, id: 'r1', trigger: 'schedule' as const, slot: 'schedule:2026-10-10T10:00Z' }

beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.claimSyncRun.mockResolvedValue(true)
	mocks.hasUnfinishedRunSince.mockResolvedValue(false)
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work({}),
	)
	mocks.listGroupLinks.mockResolvedValue([])
	mocks.listDirectoryAccounts.mockResolvedValue([])
	mocks.listDirectoryMemberships.mockResolvedValue([])
	mocks.deactivateDirectoryAccounts.mockResolvedValue(0)
	mocks.reactivateDirectoryAccounts.mockResolvedValue(0)
	mocks.applyMembershipChanges.mockResolvedValue({ added: 0, removed: 0, groupErrors: 0 })
	mocks.listUserEntries.mockResolvedValue([entry(0x90, 'alice')])
	// Every run logs its summary line; the test that pins it reads this same spy (vi.spyOn returns an existing spy).
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	return () => info.mockRestore()
})

describe('the slots (decision ak)', () => {
	it('name a minute', () => {
		expect(scheduleSlot(new Date('2026-10-09T13:00:42.120Z'))).toBe('schedule:2026-10-09T13:00Z')
		expect(startupSlot(new Date('2026-10-09T13:00:00Z'))).toBe('startup:2026-10-09T13:00Z')
	})
})

describe('runSync (spec §6.4)', () => {
	it('skips a slot another container claimed, and reads nothing', async () => {
		mocks.claimSyncRun.mockResolvedValue(false)
		expect(await runSync(run)).toEqual({ status: 'skipped' })
		expect(mocks.withDirectory).not.toHaveBeenCalled()
		expect(mocks.finishSyncRun).not.toHaveBeenCalled()
	})

	it('deactivates an absent account, finishes the row and prunes old runs', async () => {
		mocks.listDirectoryAccounts.mockResolvedValue([
			{
				id: 'gone',
				directoryId: '00000000-0000-4000-8000-000000000000',
				directoryIdAttribute: 'objectGUID',
				email: 'g@x.example',
				name: 'g',
				directoryUsername: 'g',
				directoryDeactivatedAt: null,
			},
		])
		mocks.deactivateDirectoryAccounts.mockResolvedValue(1)
		const result = await runSync(run)
		expect(result).toMatchObject({
			status: 'finished',
			outcome: 'succeeded',
			errorCode: null,
			counts: { entriesSeen: 1, deactivated: 1 },
		})
		expect(mocks.deactivateDirectoryAccounts).toHaveBeenCalledWith(['gone'], expect.any(Date))
		expect(mocks.finishSyncRun).toHaveBeenCalledWith(
			'r1',
			'succeeded',
			expect.objectContaining({ deactivated: 1 }),
			null,
			expect.any(Date),
		)
		const [before] = mocks.pruneSyncRuns.mock.calls[0]
		expect(Date.now() - (before as Date).getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000)
	})

	it.each([
		['the empty stop', () => mocks.listUserEntries.mockResolvedValue([]), 'empty'],
		[
			'the id attribute stop',
			() =>
				mocks.listDirectoryAccounts.mockResolvedValue([
					{
						id: 'a',
						directoryId: 'k',
						directoryIdAttribute: 'entryUUID',
						email: 'a@x',
						name: null,
						directoryUsername: null,
						directoryDeactivatedAt: null,
					},
				]),
			'id_attribute_changed',
		],
	])('changes no account at %s', async (_name, arrange, outcome) => {
		arrange()
		expect(await runSync(run)).toMatchObject({ status: 'finished', outcome, errorCode: null })
		for (const write of [
			mocks.deactivateDirectoryAccounts,
			mocks.reactivateDirectoryAccounts,
			mocks.refreshDirectoryAccount,
			mocks.applyMembershipChanges,
		])
			expect(write).not.toHaveBeenCalled()
	})

	it.each([
		[
			'an unreachable directory',
			new DirectoryUnavailableError({ cause: new Error('ECONNREFUSED') }),
			'directory_unreachable',
		],
		[
			'a refused service account',
			new DirectoryRefusedError({ cause: new InvalidCredentialsError('refused') }),
			'bind_refused',
		],
		['a refused search', new NoSuchObjectError('no such base'), 'search_failed'],
		// Task 6 review: ldapts rethrows a page's result code as the error it is, and withDirectory names a connection
		// that dropped between pages unreachable; either ends the run before any write.
		['a page the directory refuses partway', new UnwillingToPerformError('page'), 'search_failed'],
		[
			'a connection dropped partway',
			new DirectoryUnavailableError({
				cause: new Error('Socket error. Message type: SearchRequest (0x63)'),
			}),
			'directory_unreachable',
		],
		['anything else', new TypeError('bug'), 'internal_error'],
	])('fails with a fixed code on %s, and writes no account', async (_name, error, code) => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.listUserEntries.mockRejectedValue(error)
			expect(await runSync(run)).toMatchObject({
				status: 'finished',
				outcome: 'failed',
				errorCode: code,
			})
			for (const write of [
				mocks.deactivateDirectoryAccounts,
				mocks.reactivateDirectoryAccounts,
				mocks.refreshDirectoryAccount,
				mocks.refreshGroupLinks,
				mocks.applyMembershipChanges,
			])
				expect(write).not.toHaveBeenCalled()
			expect(mocks.finishSyncRun).toHaveBeenCalledWith(
				'r1',
				'failed',
				expect.anything(),
				code,
				expect.any(Date),
			)
		} finally {
			log.mockRestore()
		}
	})

	it('reads every linked group before any write, and counts a group the directory refused as an error (decision af)', async () => {
		mocks.listGroupLinks.mockResolvedValue([
			{ groupId: 'g1', directoryGroupId: 'd1', directoryGroupName: 'Eng', missingSince: null },
			{ groupId: 'g2', directoryGroupId: 'd2', directoryGroupName: 'Ops', missingSince: null },
			{ groupId: 'g3', directoryGroupId: 'd3', directoryGroupName: 'Gone', missingSince: null },
		])
		mocks.findGroupByKey.mockImplementation((_client: unknown, _config: unknown, key: string) =>
			key === 'd2'
				? Promise.reject(new InvalidCredentialsError('refused'))
				: key === 'd3'
					? Promise.resolve(null)
					: Promise.resolve({ dn: 'CN=Eng', name: 'Engineering' }),
		)
		mocks.listMemberKeys.mockResolvedValue(new Set())
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		const result = await runSync(run)
		log.mockRestore()
		expect(result).toMatchObject({ outcome: 'succeeded', counts: { groupErrors: 1 } })
		expect(mocks.refreshGroupLinks).toHaveBeenCalledWith(
			[
				{ groupId: 'g1', directoryGroupId: 'd1', name: 'Engineering' },
				{ groupId: 'g3', directoryGroupId: 'd3', name: null },
			],
			expect.any(Date),
		)
		// All the directory's answers came before the first write (one connection, decision af).
		expect(mocks.withDirectory).toHaveBeenCalledTimes(1)
		expect(mocks.findGroupByKey.mock.invocationCallOrder.at(-1)!).toBeLessThan(
			mocks.deactivateDirectoryAccounts.mock.invocationCallOrder[0],
		)
		// The hub's accounts are read before the directory (decision af), so an account a sign-in changes while the
		// directory is read is never judged against an older answer.
		expect(mocks.listDirectoryAccounts.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.withDirectory.mock.invocationCallOrder[0],
		)
	})

	// Task 9 review: `directory_group_name` is varchar(255); a longer name (a DN taken for a group without one) would be
	// refused (1406) and fail the run, so it is cut by code points, as readEntry cuts an entry's texts.
	it("cuts a found group's name to its column's 255 characters", async () => {
		mocks.listGroupLinks.mockResolvedValue([
			{ groupId: 'g1', directoryGroupId: 'd1', directoryGroupName: 'Eng', missingSince: null },
		])
		mocks.findGroupByKey.mockResolvedValue({ dn: 'CN=Eng', name: '😀'.repeat(300) })
		mocks.listMemberKeys.mockResolvedValue(new Set())
		await runSync(run)
		const [[refreshes]] = mocks.refreshGroupLinks.mock.calls as [[{ name: string }[]]]
		expect(refreshes[0]!.name).toBe('😀'.repeat(255))
	})

	it('fails the whole run when a group lookup loses the directory', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.listGroupLinks.mockResolvedValue([
				{ groupId: 'g1', directoryGroupId: 'd1', directoryGroupName: 'Eng', missingSince: null },
			])
			mocks.findGroupByKey.mockRejectedValue(
				new DirectoryUnavailableError({ cause: new Error('timeout') }),
			)
			expect(await runSync(run)).toMatchObject({
				outcome: 'failed',
				errorCode: 'directory_unreachable',
			})
			expect(mocks.deactivateDirectoryAccounts).not.toHaveBeenCalled()
		} finally {
			log.mockRestore()
		}
	})

	// Review Focus 2 and spec §6.4 step 3: an email another account has is kept, and the run counts the conflict.
	it('counts a refresh whose new email another account has as a conflict', async () => {
		mocks.listDirectoryAccounts.mockResolvedValue([
			{
				id: 'alice',
				directoryId: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
				directoryIdAttribute: 'objectGUID',
				email: 'old@x.example',
				name: 'alice',
				directoryUsername: 'alice',
				directoryDeactivatedAt: null,
			},
		])
		mocks.refreshDirectoryAccount.mockResolvedValue({ updated: true, conflict: true })
		expect(await runSync(run)).toMatchObject({
			outcome: 'succeeded',
			counts: { updated: 1, conflicts: 1, deactivated: 0 },
		})
		expect(mocks.refreshDirectoryAccount).toHaveBeenCalledWith({
			id: 'alice',
			name: 'alice',
			directoryUsername: 'alice',
			email: 'alice@x.example',
		})
	})

	// Task 9's interface: a refresh that matched no row (the account was deleted during the run) is not counted.
	it('does not count a refresh that matched no account', async () => {
		mocks.listDirectoryAccounts.mockResolvedValue([
			{
				id: 'alice',
				directoryId: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
				directoryIdAttribute: 'objectGUID',
				email: 'old@x.example',
				name: 'alice',
				directoryUsername: 'alice',
				directoryDeactivatedAt: null,
			},
		])
		mocks.refreshDirectoryAccount.mockResolvedValue({ updated: false, conflict: false })
		expect(await runSync(run)).toMatchObject({
			outcome: 'succeeded',
			counts: { updated: 0, conflicts: 0 },
		})
	})

	it('records the counts a failed write phase reached (decision ah)', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.listDirectoryAccounts.mockResolvedValue([
				{
					id: 'gone',
					directoryId: '00000000-0000-4000-8000-000000000000',
					directoryIdAttribute: 'objectGUID',
					email: 'g@x',
					name: 'g',
					directoryUsername: 'g',
					directoryDeactivatedAt: null,
				},
			])
			mocks.deactivateDirectoryAccounts.mockResolvedValue(1)
			mocks.applyMembershipChanges.mockRejectedValue(
				Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' }),
			)
			expect(await runSync(run)).toMatchObject({
				outcome: 'failed',
				errorCode: 'internal_error',
				counts: { deactivated: 1 },
			})
		} finally {
			log.mockRestore()
		}
	})

	it('logs one summary line with the counts and no names', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		try {
			await runSync(run)
			expect(info).toHaveBeenCalledTimes(1)
			expect(JSON.stringify(info.mock.calls)).not.toMatch(/alice/)
		} finally {
			info.mockRestore()
		}
	})
})

describe('the running guard (decision ag)', () => {
	it.each(['schedule', 'startup', 'manual'] as const)(
		'refuses a %s run while a run started in the last 30 minutes has not finished',
		async trigger => {
			mocks.hasUnfinishedRunSince.mockResolvedValue(true)
			expect(await runSync({ ...run, trigger })).toEqual({ status: 'running' })
			expect(mocks.claimSyncRun).not.toHaveBeenCalled()
			const [since] = mocks.hasUnfinishedRunSince.mock.calls[0]
			expect(Math.round((Date.now() - (since as Date).getTime()) / 60_000)).toBe(30)
		},
	)
})

describe('runManualSync (spec §6.4 "Claim")', () => {
	it('is refused like every run while another is going', async () => {
		mocks.hasUnfinishedRunSince.mockResolvedValue(true)
		expect(await runManualSync(config)).toEqual({ status: 'running' })
	})

	it('claims a manual slot named after its run id', async () => {
		mocks.hasUnfinishedRunSince.mockResolvedValue(false)
		expect(await runManualSync(config)).toMatchObject({ status: 'finished' })
		const [claimed] = mocks.claimSyncRun.mock.calls[0]
		expect(claimed).toMatchObject({
			trigger: 'manual',
			slot: `manual:${(claimed as { id: string }).id}`,
		})
	})
})
