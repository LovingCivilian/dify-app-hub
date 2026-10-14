import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	const jobs: {
		pattern: string
		options: Record<string, unknown>
		run: (...args: unknown[]) => unknown
	}[] = []
	class Cron {
		constructor(
			pattern: string,
			options: Record<string, unknown>,
			run: (...args: unknown[]) => unknown,
		) {
			jobs.push({ pattern, options, run })
		}
		stop() {}
	}
	return { jobs, Cron, purgeDeletedConversations: vi.fn() }
})
vi.mock('croner', () => ({ Cron: mocks.Cron }))
vi.mock('@/lib/data/conversations', () => ({
	purgeDeletedConversations: mocks.purgeDeletedConversations,
}))

import { PURGE_SCHEDULE, startPurgeSchedule } from '@/lib/chat/purge'

const reset = () => {
	delete (globalThis as { aiAppHubConversationPurge?: unknown }).aiAppHubConversationPurge
}

beforeEach(() => {
	reset()
	mocks.jobs.length = 0
	mocks.purgeDeletedConversations.mockReset()
})
afterEach(reset)

describe('startPurgeSchedule (spec §3.4; plan call P13)', () => {
	it('starts one protected, unref’d five-field job at 03:00, once per process', () => {
		startPurgeSchedule()
		startPurgeSchedule()
		expect(mocks.jobs).toHaveLength(1)
		expect(mocks.jobs[0].pattern).toBe('0 3 * * *')
		expect(mocks.jobs[0].options).toMatchObject({ mode: '5-part', protect: true, unref: true })
		expect(mocks.jobs[0].options.catch).toEqual(expect.any(Function))
	})

	// croner calls the job with itself and its context: the purge must not read them as its clock.
	it('purges with the current time and logs the count', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {})
		mocks.purgeDeletedConversations.mockResolvedValue(3)
		startPurgeSchedule()
		await mocks.jobs[0].run({ croner: 'job' }, 'context')
		expect(mocks.purgeDeletedConversations).toHaveBeenCalledWith()
		expect(info).toHaveBeenCalledWith('conversationPurge:', { purged: 3 })
		info.mockRestore()
	})

	it('routes a failing run through the catch option to the log', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		startPurgeSchedule()
		const boom = new Error('db down')
		;(mocks.jobs[0].options.catch as (e: unknown) => void)(boom)
		expect(error).toHaveBeenCalledWith('conversationPurge:', boom)
		error.mockRestore()
	})

	it('is a pattern croner runs daily at 03:00', async () => {
		const { Cron } = await vi.importActual<typeof import('croner')>('croner')
		const job = new Cron(PURGE_SCHEDULE, { mode: '5-part', timezone: 'UTC' })
		expect(job.nextRun(new Date('2026-10-14T12:00:00Z'))?.toISOString()).toBe(
			'2026-10-15T03:00:00.000Z',
		)
		job.stop()
	})
})
