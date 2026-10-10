import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const jobs: { pattern: string; options: Record<string, unknown>; run: () => Promise<void> }[] = []
	const lastDue = { value: new Date('2026-10-10T09:00:00Z') as Date | undefined }
	const matches = { value: false }
	class Cron {
		constructor(pattern: string, options: Record<string, unknown>, run: () => Promise<void>) {
			jobs.push({ pattern, options, run })
		}
		previousRuns() {
			return lastDue.value ? [lastDue.value] : []
		}
		match() {
			return matches.value
		}
		stop() {}
	}
	return {
		jobs,
		Cron,
		lastDue,
		matches,
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
// The startup check reads LDAP_CA_FILE through lib/directory/connection.ts, which stays real; only the file system is
// faked, as in the connection test.
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile }))

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
	mocks.matches.value = false
	readFile.mockReset()
	readFile.mockResolvedValue(Buffer.from('PEM'))
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
	// The environment takes IANA names only (spec §2 #14); croner's README documents `timezone` as an IANA name.
	it.each([
		['Asia/Riyadh', '2026-10-11T06:00:00.000Z'],
		['Etc/GMT-1', '2026-10-11T08:00:00.000Z'],
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
		// Let the catch-up's own continuation settle (a macrotask drains every queued microtask) before asserting.
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(mocks.runSync).not.toHaveBeenCalled()
	})

	it('runs the slot whose second the process starts in (croner match)', async () => {
		mocks.directoryConfig.mockReturnValue(config)
		mocks.matches.value = true
		mocks.lastDue.value = new Date('2026-10-10T08:00:00Z')
		mocks.lastSucceededSyncRun.mockResolvedValue({ startedAt: new Date('2026-10-10T08:00:02Z') })
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(new Date('2026-10-10T09:00:00.500Z'))
		try {
			startDirectorySchedule()
			await vi.waitFor(() => expect(mocks.runSync).toHaveBeenCalledTimes(1))
		} finally {
			vi.useRealTimers()
		}
		expect(mocks.runSync).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: 'startup', slot: 'startup:2026-10-10T09:00Z' }),
		)
	})

	it('logs a failing catch-up read or run instead of leaking a rejection', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockReturnValue(config)
			mocks.lastSucceededSyncRun.mockRejectedValue(new Error('db down'))
			startDirectorySchedule()
			await vi.waitFor(() => expect(error).toHaveBeenCalled())
			error.mockClear()
			reset()
			mocks.lastSucceededSyncRun.mockResolvedValue(null)
			mocks.runSync.mockRejectedValue(new Error('claim failed'))
			startDirectorySchedule()
			await vi.waitFor(() => expect(error).toHaveBeenCalled())
		} finally {
			error.mockRestore()
		}
	})

	it('routes a failing scheduled run through the catch option to the log', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockReturnValue(config)
			startDirectorySchedule()
			const handler = mocks.jobs[0].options.catch as (error: unknown) => void
			expect(() => handler(new Error('db'))).not.toThrow()
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
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

// Final review I1: a CA file the hub cannot read refuses every directory sign-in and sync, so the start names it once,
// whether the schedule is on or off, by the setting and the error's code (Node "Class: SystemError": `code`), never the
// path, which Node's error carries in `path` and in its message (OWASP Logging Cheat Sheet: file paths are data to treat
// with care before logging).
describe('the LDAP_CA_FILE check at start', () => {
	const caFile = '/run/secrets/corp-root-ca.pem'
	const missing = () =>
		Object.assign(new Error(`ENOENT: no such file or directory, open '${caFile}'`), {
			code: 'ENOENT',
			errno: -2,
			syscall: 'open',
			path: caFile,
		})
	// Lets the check's read and its log settle (a macrotask drains every queued microtask).
	const settle = () => new Promise(resolve => setTimeout(resolve, 0))

	it('names an unreadable file once, with the schedule off, by the setting and the code only', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			readFile.mockRejectedValue(missing())
			mocks.directoryConfig.mockReturnValue({ ...config, caFile, syncSchedule: null })
			startDirectorySchedule()
			startDirectorySchedule()
			await vi.waitFor(() => expect(error).toHaveBeenCalled())
			await settle()
			expect(readFile).toHaveBeenCalledTimes(1)
			expect(readFile).toHaveBeenCalledWith(caFile)
			expect(error).toHaveBeenCalledTimes(1)
			expect(error).toHaveBeenCalledWith('directorySchedule:', {
				name: 'DirectoryConfigError',
				setting: 'LDAP_CA_FILE',
				cause: { code: 'ENOENT' },
			})
			expect(JSON.stringify(error.mock.calls)).not.toContain('corp-root-ca')
			expect(mocks.jobs).toEqual([])
		} finally {
			error.mockRestore()
		}
	})

	it('checks the file with the schedule on too, beside the job', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			readFile.mockRejectedValue(missing())
			mocks.directoryConfig.mockReturnValue({ ...config, caFile })
			startDirectorySchedule()
			await vi.waitFor(() =>
				expect(error).toHaveBeenCalledWith('directorySchedule:', {
					name: 'DirectoryConfigError',
					setting: 'LDAP_CA_FILE',
					cause: { code: 'ENOENT' },
				}),
			)
			expect(mocks.jobs).toHaveLength(1)
		} finally {
			error.mockRestore()
		}
	})

	it('logs nothing for a readable file, and reads none without a file or with LDAP_ENCRYPTION=none', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			mocks.directoryConfig.mockReturnValue({ ...config, caFile, syncSchedule: null })
			startDirectorySchedule()
			await vi.waitFor(() => expect(readFile).toHaveBeenCalledWith(caFile))
			await settle()
			expect(error).not.toHaveBeenCalled()

			readFile.mockClear()
			reset()
			mocks.directoryConfig.mockReturnValue({ ...config, caFile: null, syncSchedule: null })
			startDirectorySchedule()
			reset()
			// The connection reads the file only for TLS (lib/directory/connection.ts), so the check does too.
			mocks.directoryConfig.mockReturnValue({
				...config,
				url: 'ldap://10.0.0.5',
				encryption: 'none',
				caFile,
				syncSchedule: null,
			})
			startDirectorySchedule()
			await settle()
			expect(readFile).not.toHaveBeenCalled()
			expect(error).not.toHaveBeenCalled()
		} finally {
			error.mockRestore()
			warn.mockRestore()
		}
	})
})
