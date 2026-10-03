import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: { marker: true } }))

import { getSessionUserId, unauthorizedResponse } from '@/lib/session-user'

describe('getSessionUserId', () => {
	beforeEach(() => getServerSession.mockReset())

	it('returns the signed-in account email', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await expect(getSessionUserId()).resolves.toBe('jane@example.com')
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})

	it('returns null without a session', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(getSessionUserId()).resolves.toBeNull()
	})

	it('returns null when the session has no email', async () => {
		getServerSession.mockResolvedValue({ user: {} })
		await expect(getSessionUserId()).resolves.toBeNull()
	})
})

describe('unauthorizedResponse', () => {
	it('is a 401 JSON error', async () => {
		const response = unauthorizedResponse()
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
	})
})
