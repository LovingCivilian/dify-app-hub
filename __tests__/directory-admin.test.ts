import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	directoryConfig: vi.fn(),
	latestSyncRun: vi.fn(),
	runManualSync: vi.fn(),
	searchGroups: vi.fn(),
	withDirectory: vi.fn(),
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/operations', () => ({ searchGroups: mocks.searchGroups }))
vi.mock('@/lib/data/directory', () => ({ latestSyncRun: mocks.latestSyncRun }))
// The constant goes in the factory, not in `mocks`, whose values beforeEach resets with mockReset().
vi.mock('@/lib/directory/sync', () => ({
	runManualSync: mocks.runManualSync,
	RUNNING_GUARD_MS: 30 * 60 * 1000,
}))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))

import { getDirectoryStatus, searchDirectoryGroups, syncDirectoryNow } from '@/lib/directory/admin'

const admin = { id: 'a1', email: 'a@x', name: null, role: 'admin' as const }
const user = { ...admin, role: 'user' as const }

beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work('client'),
	)
})

describe('searchDirectoryGroups (spec §6.5)', () => {
	it('refuses a non-admin actor before the directory', async () => {
		await expect(searchDirectoryGroups(user, 'eng')).rejects.toMatchObject({ code: 'forbidden' })
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it('answers null while LDAP is off', async () => {
		mocks.directoryConfig.mockReturnValue(null)
		expect(await searchDirectoryGroups(admin, 'eng')).toBeNull()
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it('searches through one service-bound client', async () => {
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		mocks.searchGroups.mockResolvedValue([{ key: 'k1', name: 'Engineering' }])
		expect(await searchDirectoryGroups(admin, 'eng')).toEqual([{ key: 'k1', name: 'Engineering' }])
		expect(mocks.searchGroups).toHaveBeenCalledWith('client', { url: 'ldaps://dc' }, 'eng')
	})

	// Carry (Task 10 note): searchGroups falls back to the DN for a group without a name, uncut; the link's name column is
	// varchar(255), so the name the admin picks, and the route answers, is cut to 255 code points (MDN `Array.from()`).
	it('cuts a name longer than the link column to 255 code points, surrogate pairs whole', async () => {
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		const dn = `CN=${'😀'.repeat(300)},OU=Groups,DC=corp,DC=example`
		mocks.searchGroups.mockResolvedValue([{ key: 'k1', name: dn }])
		const [group] = (await searchDirectoryGroups(admin, 'eng'))!
		expect(Array.from(group.name)).toHaveLength(255)
		expect(group.name).toBe(Array.from(dn).slice(0, 255).join(''))
	})
})

describe('getDirectoryStatus (spec §6.6)', () => {
	const config = {
		url: 'ldap://10.0.0.5',
		encryption: 'none',
		syncSchedule: '0 * * * *',
		syncTimezone: 'UTC',
	}

	it('refuses a non-admin actor, and answers null while LDAP is off', async () => {
		await expect(getDirectoryStatus(user)).rejects.toMatchObject({ code: 'forbidden' })
		mocks.directoryConfig.mockReturnValue(null)
		expect(await getDirectoryStatus(admin)).toBeNull()
	})

	it('shows the mode, the next run from the cron expression, and the last run', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		const startedAt = new Date(Date.now() - 60_000)
		mocks.latestSyncRun.mockResolvedValue({
			id: 'r1',
			trigger: 'schedule',
			startedAt,
			finishedAt: new Date(),
			outcome: 'succeeded',
			errorCode: null,
			counts: {
				entriesSeen: 3,
				deactivated: 1,
				reactivated: 0,
				updated: 0,
				conflicts: 0,
				groupErrors: 0,
				membershipsAdded: 0,
				membershipsRemoved: 0,
			},
		})
		const status = await getDirectoryStatus(admin)
		// The panel's three items only (Global Constraints: DTOs carry only what the screen needs).
		expect(Object.keys(status!).sort()).toEqual(['encryption', 'lastRun', 'nextRun'])
		expect(status).toMatchObject({
			encryption: 'none',
			lastRun: {
				trigger: 'schedule',
				outcome: 'succeeded',
				startedAt: startedAt.toISOString(),
				counts: { deactivated: 1 },
			},
		})
		// croner's nextRun(): the next full hour.
		expect(new Date(status!.nextRun!).getUTCMinutes()).toBe(0)
		expect(new Date(status!.nextRun!).getTime()).toBeGreaterThan(Date.now())
	})

	it('reads the schedule in the configured time zone, five-part mode', async () => {
		// 09:00 in Asia/Riyadh (UTC+3, no daylight saving) is 06:00 UTC.
		mocks.directoryConfig.mockReturnValue({
			...config,
			syncSchedule: '0 9 * * *',
			syncTimezone: 'Asia/Riyadh',
		})
		mocks.latestSyncRun.mockResolvedValue(null)
		const status = await getDirectoryStatus(admin)
		expect(new Date(status!.nextRun!).getUTCHours()).toBe(6)
		expect(new Date(status!.nextRun!).getUTCMinutes()).toBe(0)
	})

	it('answers no next run with the schedule off, and "interrupted" for a run that outlived the guard (decision ap)', async () => {
		mocks.directoryConfig.mockReturnValue({ ...config, syncSchedule: null })
		mocks.latestSyncRun.mockResolvedValue({
			id: 'r1',
			trigger: 'manual',
			startedAt: new Date(Date.now() - 31 * 60 * 1000),
			finishedAt: null,
			outcome: 'running',
			errorCode: null,
			counts: {
				entriesSeen: 0,
				deactivated: 0,
				reactivated: 0,
				updated: 0,
				conflicts: 0,
				groupErrors: 0,
				membershipsAdded: 0,
				membershipsRemoved: 0,
			},
		})
		expect(await getDirectoryStatus(admin)).toMatchObject({
			nextRun: null,
			lastRun: { outcome: 'interrupted' },
		})
	})

	it('keeps "running" for a run inside the guard, and answers no last run before the first', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		mocks.latestSyncRun.mockResolvedValue({
			id: 'r1',
			trigger: 'manual',
			startedAt: new Date(Date.now() - 60_000),
			finishedAt: null,
			outcome: 'running',
			errorCode: null,
			counts: {
				entriesSeen: 0,
				deactivated: 0,
				reactivated: 0,
				updated: 0,
				conflicts: 0,
				groupErrors: 0,
				membershipsAdded: 0,
				membershipsRemoved: 0,
			},
		})
		expect(await getDirectoryStatus(admin)).toMatchObject({ lastRun: { outcome: 'running' } })
		mocks.latestSyncRun.mockResolvedValue(null)
		expect(await getDirectoryStatus(admin)).toMatchObject({ lastRun: null })
	})
})

describe('syncDirectoryNow', () => {
	it('refuses a non-admin actor before any run, answers null while LDAP is off, and runs a manual sync', async () => {
		await expect(syncDirectoryNow(user)).rejects.toMatchObject({ code: 'forbidden' })
		expect(mocks.runManualSync).not.toHaveBeenCalled()
		mocks.directoryConfig.mockReturnValue(null)
		expect(await syncDirectoryNow(admin)).toBeNull()
		mocks.directoryConfig.mockReturnValue({ url: 'ldaps://dc' })
		mocks.runManualSync.mockResolvedValue({ status: 'running' })
		expect(await syncDirectoryNow(admin)).toEqual({ status: 'running' })
		expect(mocks.runManualSync).toHaveBeenCalledWith({ url: 'ldaps://dc' })
	})
})
