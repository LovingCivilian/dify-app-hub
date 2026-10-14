import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppAccess } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))

import { resolveAppRoute } from '@/lib/providers/route'

const APP_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'user' }
const params = (appId = APP_ID) => Promise.resolve({ appId })
const app = {
	id: APP_ID,
	enabled: true,
	provider: 'dify',
	settings: { apiBase: 'http://d/v1' },
	secrets: { apiKey: 'k' },
}
const refusal = async (resolved: Awaited<ReturnType<typeof resolveAppRoute>>) => {
	expect(resolved.ok).toBe(false)
	return resolved.ok
		? null
		: { status: resolved.response.status, body: await resolved.response.json() }
}
const notFound = {
	status: 404,
	body: { code: 'app_not_found', message: 'No such app.', status: 404 },
}

beforeEach(() => {
	verifySession.mockReset()
	getAppAccess.mockReset()
})

// Part 1 spec §3: session → z.uuid() on the id → getAppAccess (visibility) → enabled → provider match.
describe('resolveAppRoute', () => {
	it('answers 401 before it looks at the id or the app', async () => {
		verifySession.mockResolvedValue(null)
		for (const appId of [APP_ID, 'not-a-uuid'])
			expect(await refusal(await resolveAppRoute(params(appId), 'dify'))).toEqual({
				status: 401,
				body: { code: 'unauthorized', message: 'Sign in required.', status: 401 },
			})
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	// Part 0 spec §3.2: PostgreSQL refuses a malformed uuid with 22P02, so it never reaches the read.
	it('answers a malformed id as an unknown app without reading it', async () => {
		verifySession.mockResolvedValue(actor)
		expect(await refusal(await resolveAppRoute(params('not-a-uuid'), 'dify'))).toEqual(notFound)
		expect(getAppAccess).not.toHaveBeenCalled()
	})
	// B3 spec §4.2: getAppAccess answers null for a missing app, one the actor may not see, and one whose documents fail.
	it('answers an app the read does not return as unknown', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(null)
		expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual(notFound)
		expect(getAppAccess).toHaveBeenCalledWith(actor, APP_ID)
	})
	it('answers 403 app_disabled for a disabled app, before the provider check', async () => {
		verifySession.mockResolvedValue(actor)
		for (const provider of ['dify', 'agui']) {
			getAppAccess.mockResolvedValue({ ...app, enabled: false, provider })
			expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual({
				status: 403,
				body: { code: 'app_disabled', message: 'This app is disabled.', status: 403 },
			})
		}
	})
	it("answers another provider's app as unknown", async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue({ ...app, provider: 'agui' })
		expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual(notFound)
	})
	it('hands back the actor and the app of this provider', async () => {
		verifySession.mockResolvedValue(actor)
		getAppAccess.mockResolvedValue(app)
		expect(await resolveAppRoute(params(), 'dify')).toEqual({ ok: true, actor, app })
	})
	// A database or environment failure answers the envelope, not Next's empty 500.
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
		expect(await refusal(await resolveAppRoute(params(), 'dify'))).toEqual({
			status: 500,
			body: { code: 'internal_error', message: 'Internal Server Error', status: 500 },
		})
		expect(errorSpy).toHaveBeenCalledWith('resolveAppRoute:', expect.any(Error))
		errorSpy.mockRestore()
	})
})
