import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess, difyClient } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
	difyClient: vi.fn(() => ({ marker: 'client' })),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))
vi.mock('@/lib/providers/dify/client', () => ({ difyClient }))

import { resolveDifyRoute } from '@/lib/providers/dify/route'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = { id: 'u1', email: 'jane@example.com', name: null }
const params = Promise.resolve({ appId: APP_ID })

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	difyClient.mockClear()
})

// The shared guard's own cases are in __tests__/provider-route.test.ts; these are the Dify half (Part 1 spec §3).
describe('resolveDifyRoute', () => {
	it("answers the guard's refusal as it is and builds no Dify client", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok ? null : resolved.response.status).toBe(404)
		// A missing app and one the actor may not use reach no Dify client, so no request goes to Dify.
		expect(difyClient).not.toHaveBeenCalled()
	})
	it('builds the context with the account id as the Dify user, never the email, and a client from the documents', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({
			id: APP_ID,
			enabled: true,
			provider: 'dify',
			settings: { apiBase: 'http://d/v1' },
			secrets: { apiKey: 'k' },
		})
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(true)
		if (!resolved.ok) return
		expect(resolved.ctx).toEqual({
			user: 'u1',
			actor,
			appId: APP_ID,
			apiBase: 'http://d/v1',
			dify: { marker: 'client' },
		})
		// The context's `actor` keeps the email for the routes' own checks; the Dify end user is the id (ADR-0026).
		expect(resolved.ctx.user).not.toContain('@')
		expect(difyClient).toHaveBeenCalledWith({ apiBase: 'http://d/v1', apiKey: 'k' })
	})
})
