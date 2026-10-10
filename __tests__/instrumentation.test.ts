import { afterEach, describe, expect, it, vi } from 'vitest'

const { startDirectorySchedule } = vi.hoisted(() => ({ startDirectorySchedule: vi.fn() }))
vi.mock('@/lib/directory/schedule', () => ({ startDirectorySchedule }))

import { register } from '@/instrumentation'

afterEach(() => {
	vi.unstubAllEnvs()
	startDirectorySchedule.mockReset()
})

describe('register (Next instrumentation)', () => {
	it('starts the directory schedule in the Node runtime only', async () => {
		vi.stubEnv('NEXT_RUNTIME', 'edge')
		await register()
		expect(startDirectorySchedule).not.toHaveBeenCalled()
		vi.stubEnv('NEXT_RUNTIME', 'nodejs')
		await register()
		expect(startDirectorySchedule).toHaveBeenCalledTimes(1)
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
})
