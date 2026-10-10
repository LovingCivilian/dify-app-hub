import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const jobs: { pattern: string; options: Record<string, unknown>; run: () => Promise<void> }[] = []
	const lastDue = { value: new Date('2026-10-10T09:00:00Z') as Date | undefined }
	class Cron {
		constructor(pattern: string, options: Record<string, unknown>, run: () => Promise<void>) {
			jobs.push({ pattern, options, run })
		}
		previousRuns() {
			return lastDue.value ? [lastDue.value] : []
		}
		stop() {}
	}
	return {
		jobs,
		Cron,
		lastDue,
		directoryConfig: vi.fn(),
		runSync: vi.fn(),
		lastSucceededSyncRun: vi.fn(),
	}
})
vi.mock('croner', () => ({ Cron: mocks.Cron }))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/sync', () => ({
	runSync: mocks.runSync,
	scheduleSlot: (at: Date) => `schedule:${at.toISOString().slice(0, 16)}Z`,
	startupSlot: (at: Date) => `startup:${at.toISOString().slice(0, 16)}Z`,
}))
vi.mock('@/lib/data/directory', () => ({ lastSucceededSyncRun: mocks.lastSucceededSyncRun }))

import { missedRun, startDirectorySchedule } from '@/lib/directory/schedule'

const config = {
	url: 'ldaps://dc.corp.example',
	encryption: 'ldaps',
	syncSchedule: '0 * * * *',
	syncTimezone: 'Asia/Riyadh',
}

const reset = () => {
	delete (globalThis as { difyAppHubDirectorySchedule?: unknown }).difyAppHubDirectorySchedule
}

beforeEach(() => {
	reset()
	mocks.jobs.length = 0
	mocks.directoryConfig.mockReset()
	mocks.runSync.mockReset()
	mocks.runSync.mockResolvedValue({ status: 'finished', outcome: 'succeeded' })
	mocks.lastSucceededSyncRun.mockReset()
	mocks.lastSucceededSyncRun.mockResolvedValue({ startedAt: new Date('2026-10-10T09:00:05Z') })
	mocks.lastDue.value = new Date('2026-10-10T09:00:00Z')
})
afterEach(reset)

describe('missedRun (spec §6.4 "Missed run")', () => {
	it('is true when the last due time is after the last succeeded run, or nothing ever succeeded', () => {
		const due = new Date('2026-10-10T09:00:00Z')
		expect(missedRun(due, new Date('2026-10-10T08:00:03Z'))).toBe(true)
		expect(missedRun(due, null)).toBe(true)
		expect(missedRun(due, new Date('2026-10-10T09:00:01Z'))).toBe(false)
		expect(missedRun(undefined, null)).toBe(false)
	})
})

describe('croner and the environment check agree on the zone and the mode', () => {
	// The environment stores any zone Intl accepts, canonical (offsets included); croner builds on Intl too.
	it.each([
		['Asia/Riyadh', '2026-10-11T06:00:00.000Z'],
		['+01:00', '2026-10-11T08:00:00.000Z'],
	])('schedules 09:00 in %s', async (timezone, expected) => {
		const { Cron } = await vi.importActual<typeof import('croner')>('croner')
		const job = new Cron('0 9 * * *', { mode: '5-part', timezone })
		expect(job.nextRun(new Date('2026-10-10T12:00:00Z'))?.toISOString()).toBe(expected)
		job.stop()
	})
})

describe('startDirectorySchedule', () => {
	it('starts nothing while the directory is off or the schedule is off', () => {
		mocks.directoryConfig.mockReturnValue(null)
		startDirectorySchedule()
		mocks.directoryConfig.mockReturnValue({ ...config, syncSchedule: null })
		reset()
		startDirectorySchedule()
		expect(mocks.jobs).toEqual([])
	})

	it('logs a bad LDAP block instead of throwing (decision ai)', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockImplementation(() => {
				throw Object.assign(new Error('Missing or invalid environment variables: LDAP_URL'), {
					name: 'EnvError',
				})
			})
			expect(() => startDirectorySchedule()).not.toThrow()
			expect(error).toHaveBeenCalled()
			expect(mocks.jobs).toEqual([])
		} finally {
			error.mockRestore()
		}
	})

	it('starts one protected, unref’d job in the zone, once per process (decision aj)', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		startDirectorySchedule()
		startDirectorySchedule()
		expect(mocks.jobs).toHaveLength(1)
		const [job] = mocks.jobs
		expect(job.pattern).toBe('0 * * * *')
		expect(job.options).toMatchObject({
			timezone: 'Asia/Riyadh',
			mode: '5-part',
			protect: true,
			unref: true,
		})
		expect(job.options.catch).toBeTypeOf('function')
		// The callback returns the run's promise, so `protect` holds while it runs.
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-10-10T10:00:00.120Z'))
		try {
			await job.run()
		} finally {
			vi.useRealTimers()
		}
		expect(mocks.runSync).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'schedule', slot: 'schedule:2026-10-10T10:00Z' }),
		)
	})

	// Review Focus 5: a development reload evaluates the module again; the guard lives on globalThis, so the new
	// module instance starts no second job (Vitest "vi.resetModules": the mocks registry is kept).
	it('keeps one job when a development reload evaluates the module again', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		startDirectorySchedule()
		vi.resetModules()
		const reloaded = await import('@/lib/directory/schedule')
		expect(reloaded.startDirectorySchedule).not.toBe(startDirectorySchedule)
		reloaded.startDirectorySchedule()
		expect(mocks.jobs).toHaveLength(1)
	})

	it('runs a startup catch-up for a missed slot, under that slot (decision ak)', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		mocks.lastSucceededSyncRun.mockResolvedValue({ startedAt: new Date('2026-10-10T08:00:02Z') })
		startDirectorySchedule()
		await vi.waitFor(() => expect(mocks.runSync).toHaveBeenCalledTimes(1))
		expect(mocks.runSync).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'startup', slot: 'startup:2026-10-10T09:00Z' }),
		)
	})

	it('runs no catch-up when the last due slot already succeeded', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		startDirectorySchedule()
		await vi.waitFor(() => expect(mocks.lastSucceededSyncRun).toHaveBeenCalled())
		expect(mocks.runSync).not.toHaveBeenCalled()
	})

	it('warns once at start that passwords travel in clear with LDAP_ENCRYPTION=none (spec §6.2)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockReturnValue({
				...config,
				url: 'ldap://10.0.0.5',
				encryption: 'none',
				syncSchedule: null,
			})
			startDirectorySchedule()
			startDirectorySchedule()
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0][0])).toMatch(/LDAP_ENCRYPTION=none/)
		} finally {
			warn.mockRestore()
		}
	})
})
