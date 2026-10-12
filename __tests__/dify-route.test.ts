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
const params = Promise.resolve({ appId: '3b241101-e2bb-4255-8caf-4136c566a962' })

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
		if (!missing.ok)
			await expect(missing.response.json()).resolves.toEqual({
				code: 'app_not_found',
				message: 'No such app.',
				status: 404,
			})
		// A missing app and one the actor may not use (getAppAccess answers null for both, B3 spec §4.2) reach no
		// Dify client, so no request goes to Dify (Review Focus 1).
		expect(difyClient).not.toHaveBeenCalled()
		getAppAccess.mockResolvedValue({
			id: '3b241101-e2bb-4255-8caf-4136c566a962',
			enabled: false,
			credentials: { apiBase: 'http://d/v1', apiKey: 'k' },
		})
		const disabled = await resolveDifyRoute(params)
		expect(disabled.ok ? null : disabled.response.status).toBe(403)
		if (!disabled.ok)
			await expect(disabled.response.json()).resolves.toMatchObject({ code: 'app_disabled' })
	})
	// Spec §3.2: PostgreSQL refuses a malformed uuid (22P02), so the guard answers it as an unknown app before any query.
	it('answers 404 app_not_found for a malformed id without reading the app', async () => {
		verifySession.mockResolvedValue(actor)
		const resolved = await resolveDifyRoute(Promise.resolve({ appId: 'not-a-uuid' }))
		expect(resolved.ok).toBe(false)
		if (resolved.ok) return
		expect(resolved.response.status).toBe(404)
		await expect(resolved.response.json()).resolves.toEqual({
			code: 'app_not_found',
			message: 'No such app.',
			status: 404,
		})
		expect(getAppAccess).not.toHaveBeenCalled()
		expect(difyClient).not.toHaveBeenCalled()
	})
	it('answers 401 for a malformed id when signed out: the session comes first', async () => {
		verifySession.mockResolvedValue(null)
		const resolved = await resolveDifyRoute(Promise.resolve({ appId: 'not-a-uuid' }))
		expect(resolved.ok ? null : resolved.response.status).toBe(401)
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	// A database or environment failure (EnvError, a lost database connection) answers the envelope, not Next's empty 500.
	it.each([
		['the session read', () => verifySession.mockRejectedValue(new Error('db down'))],
		[
			'the app read',
			() => {
				verifySession.mockResolvedValue(actor)
				getAppAccess.mockRejectedValue(new Error('db down'))
			},
		],
	])('answers a logged 500 envelope when %s throws', async (_case, arrange) => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		arrange()
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(false)
		if (resolved.ok) return
		expect(resolved.response.status).toBe(500)
		await expect(resolved.response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(errorSpy).toHaveBeenCalledWith('resolveDifyRoute:', expect.any(Error))
		expect(difyClient).not.toHaveBeenCalled()
		errorSpy.mockRestore()
	})
	it('builds the context with the account id as the Dify user, never the email, and a client for the app', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({
			id: '3b241101-e2bb-4255-8caf-4136c566a962',
			enabled: true,
			credentials: { apiBase: 'http://d/v1', apiKey: 'k' },
		})
		const resolved = await resolveDifyRoute(params)
		expect(resolved.ok).toBe(true)
		if (!resolved.ok) return
		expect(resolved.ctx).toMatchObject({
			user: 'u1',
			appId: '3b241101-e2bb-4255-8caf-4136c566a962',
			apiBase: 'http://d/v1',
			dify: { marker: 'client' },
		})
		expect(getAppAccess).toHaveBeenCalledWith(actor, '3b241101-e2bb-4255-8caf-4136c566a962')
		expect(difyClient).toHaveBeenCalledWith({ apiBase: 'http://d/v1', apiKey: 'k' })
	})
})
