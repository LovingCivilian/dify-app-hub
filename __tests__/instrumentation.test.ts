import { DatabaseError } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { startDirectorySchedule, startPurgeSchedule } = vi.hoisted(() => ({
	startDirectorySchedule: vi.fn(),
	startPurgeSchedule: vi.fn(),
}))
vi.mock('@/lib/directory/schedule', () => ({ startDirectorySchedule }))
vi.mock('@/lib/chat/purge', () => ({ startPurgeSchedule }))

import { register } from '@/instrumentation'

afterEach(() => {
	vi.unstubAllEnvs()
	startDirectorySchedule.mockReset()
	startPurgeSchedule.mockReset()
})

describe('register (Next instrumentation)', () => {
	it('starts the directory schedule and the conversation purge in the Node runtime only', async () => {
		vi.stubEnv('NEXT_RUNTIME', 'edge')
		await register()
		expect(startDirectorySchedule).not.toHaveBeenCalled()
		expect(startPurgeSchedule).not.toHaveBeenCalled()
		vi.stubEnv('NEXT_RUNTIME', 'nodejs')
		await register()
		expect(startDirectorySchedule).toHaveBeenCalledTimes(1)
		expect(startPurgeSchedule).toHaveBeenCalledTimes(1)
	})

	it('never throws, so a failure cannot stop the server from starting (decision ai)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			startDirectorySchedule.mockImplementation(() => {
				throw new Error('boom')
			})
			await expect(register()).resolves.toBeUndefined()
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
	})

	// Part 2 spec §3.4: the purge is a job of its own; a failing directory schedule does not keep it from starting.
	it('starts each job on its own and logs a failure under the job’s name', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			const bug = new Error('directory')
			startDirectorySchedule.mockImplementationOnce(() => {
				throw bug
			})
			await register()
			expect(startPurgeSchedule).toHaveBeenCalledTimes(1)
			expect(error).toHaveBeenCalledWith(
				'instrumentation: the directory schedule did not start:',
				bug,
			)
			const purgeBug = new Error('purge')
			startPurgeSchedule.mockImplementationOnce(() => {
				throw purgeBug
			})
			await register()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the conversation purge did not start:',
				purgeBug,
			)
		} finally {
			error.mockRestore()
		}
	})

	// Final review M9: the throw is logged through describeError (lib/error-log.ts), so a hub error keeps its message
	// and a database error is reduced to its name and SQLSTATE, not to its name alone.
	it('logs the throw through describeError, not by its name only', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			const bug = new TypeError("Cannot read properties of undefined (reading 'syncSchedule')")
			startDirectorySchedule.mockImplementationOnce(() => {
				throw bug
			})
			await register()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the directory schedule did not start:',
				bug,
			)
			startDirectorySchedule.mockImplementationOnce(() => {
				throw Object.assign(
					new DatabaseError('duplicate key value violates unique constraint "x"', 0, 'error'),
					{ code: '23505', detail: 'Key (slot)=(secret) already exists.' },
				)
			})
			await register()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the directory schedule did not start:',
				{
					name: 'error',
					code: '23505',
				},
			)
		} finally {
			error.mockRestore()
		}
	})

	it('falls back to the name when the log module cannot load either, and still never throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.resetModules()
		vi.doMock('@/lib/error-log', () => {
			throw new Error('cannot load')
		})
		try {
			vi.stubEnv('NEXT_RUNTIME', 'nodejs')
			startDirectorySchedule.mockImplementationOnce(() => {
				throw new RangeError('bad')
			})
			const { register: fresh } = await import('@/instrumentation')
			await expect(fresh()).resolves.toBeUndefined()
			expect(error).toHaveBeenLastCalledWith(
				'instrumentation: the directory schedule did not start:',
				'RangeError',
			)
		} finally {
			vi.doUnmock('@/lib/error-log')
			vi.resetModules()
			error.mockRestore()
		}
	})
})
