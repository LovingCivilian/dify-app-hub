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
vi.mock('@/lib/dify/client', () => ({ difyClient }))

import { resolveDifyRoute } from '@/lib/dify/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const params = Promise.resolve({ appId: 'app-1' })

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
	difyClient.mockClear()
})

describe('resolveDifyRoute', () => {
	it('answers 401 in the envelope before looking at the app', async () => {
		verifySession.mockResolvedValue(null)
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(false)
		if (resolved.ok) return
		expect(resolved.response.status).toBe(401)
		await expect(resolved.response.json()).resolves.toEqual({
			code: 'unauthorized',
			message: 'Sign in required.',
			status: 401,
		})
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	it('answers 404 app_not_found and 403 app_disabled', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		const missing = await resolveDifyRoute(params)
		expect(missing.ok ? null : missing.response.status).toBe(404)
		getAppAccess.mockResolvedValue({
			id: 'app-1',
			enabled: false,
			credentials: { apiBase: 'http://d/v1', apiKey: 'k' },
		})
		const disabled = await resolveDifyRoute(params)
		expect(disabled.ok ? null : disabled.response.status).toBe(403)
		if (!disabled.ok)
			await expect(disabled.response.json()).resolves.toMatchObject({ code: 'app_disabled' })
	})
	it('builds the context with the session email as the Dify user and a client for the app', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({
			id: 'app-1',
			enabled: true,
			credentials: { apiBase: 'http://d/v1', apiKey: 'k' },
		})
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(true)
		if (!resolved.ok) return
		expect(resolved.ctx).toMatchObject({
			user: 'jane@example.com',
			appId: 'app-1',
			apiBase: 'http://d/v1',
			dify: { marker: 'client' },
		})
		expect(getAppAccess).toHaveBeenCalledWith(actor, 'app-1')
		expect(difyClient).toHaveBeenCalledWith({ apiBase: 'http://d/v1', apiKey: 'k' })
	})
})
