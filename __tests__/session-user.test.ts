import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getServerSession, redirect } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	redirect: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: { marker: true } }))

import { getSessionUserId, redirectSignedInUser, unauthorizedResponse } from '@/lib/session-user'

describe('getSessionUserId', () => {
	beforeEach(() => getServerSession.mockReset())

	it('returns the signed-in account email', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await expect(getSessionUserId()).resolves.toBe('jane@example.com')
		expect(getServerSession).toHaveBeenCalledWith({ marker: true })
	})

	// A revoked JWT (sessionVersion mismatch) still yields a session from
	// getServerSession, but the session callback leaves out user.id.
	it('returns null for a revoked session without user.id', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await expect(getSessionUserId()).resolves.toBeNull()
	})

	it('returns null without a session', async () => {
		getServerSession.mockResolvedValue(null)
		await expect(getSessionUserId()).resolves.toBeNull()
	})

	it('returns null when the session has no email', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1' } })
		await expect(getSessionUserId()).resolves.toBeNull()
	})
})

describe('redirectSignedInUser', () => {
	beforeEach(() => {
		getServerSession.mockReset()
		redirect.mockReset()
	})

	it('sends a signed-in visitor to /apps', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await redirectSignedInUser()
		expect(redirect).toHaveBeenCalledWith('/apps')
	})

	it('accepts another destination', async () => {
		getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'jane@example.com' } })
		await redirectSignedInUser('/app-management')
		expect(redirect).toHaveBeenCalledWith('/app-management')
	})

	it('leaves a visitor without a session on the page', async () => {
		getServerSession.mockResolvedValue(null)
		await redirectSignedInUser()
		expect(redirect).not.toHaveBeenCalled()
	})

	// Same rule as getSessionUserId: a revoked JWT yields a session without
	// user.id, and that visitor needs the login page, not a bounce to /apps.
	it('leaves a visitor with a revoked session on the page', async () => {
		getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
		await redirectSignedInUser()
		expect(redirect).not.toHaveBeenCalled()
	})
})

describe('unauthorizedResponse', () => {
	it('is a 401 JSON error', async () => {
		const response = unauthorizedResponse()
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
	})
})
