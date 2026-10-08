import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken }))

import { proxy } from '@/proxy'

const ORIGIN = 'http://localhost:5300'
const fetchMock = vi.fn()
const request = (path: string) => new NextRequest(new URL(path, ORIGIN))
const isNext = (response: Response) => response.headers.get('x-middleware-next') === '1'
const unauthorized = { code: 'unauthorized', message: 'Sign in required.', status: 401 }

describe('proxy', () => {
	beforeEach(() => {
		getToken.mockReset()
		getToken.mockResolvedValue(null)
		fetchMock.mockReset()
		vi.stubGlobal('fetch', fetchMock)
	})

	afterEach(() => {
		// Charter §4.2: the proxy makes no request of its own (the /api/init/status self-fetch is gone).
		expect(fetchMock).not.toHaveBeenCalled()
		vi.unstubAllGlobals()
	})

	it('answers /api/dify without a session with the 401 envelope', async () => {
		const response = await proxy(request('/api/dify/app-1/parameters'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual(unauthorized)
	})

	it('redirects a page without a session to the login page with a callbackUrl', async () => {
		const response = await proxy(request('/chat/abc?x=1'))
		expect(response.status).toBe(307)
		const location = response.headers.get('location')
		expect(location).toBe(`${ORIGIN}/login?callbackUrl=%2Fchat%2Fabc%3Fx%3D1`)
		expect(new URL(location!).searchParams.get('callbackUrl')).toBe('/chat/abc?x=1')
	})

	it.each(['/api/users', '/api/init', '/api/init/status', '/api/authx'])(
		'denies %s without a session by default',
		async path => {
			const response = await proxy(request(path))
			expect(response.status).toBe(401)
			await expect(response.json()).resolves.toEqual(unauthorized)
		},
	)

	// ADR-0018: on a sessionVersion mismatch the jwt callback strips id from the token; the cookie still decodes.
	describe('with a revoked token (no id)', () => {
		const revoked = { email: 'jane@example.com', name: 'Jane' }

		it('answers an API path with the 401 envelope', async () => {
			getToken.mockResolvedValue(revoked)
			const response = await proxy(request('/api/dify/app-1/parameters'))
			expect(response.status).toBe(401)
			await expect(response.json()).resolves.toEqual(unauthorized)
		})

		it('redirects a page to the login page with a callbackUrl', async () => {
			getToken.mockResolvedValue(revoked)
			const response = await proxy(request('/apps'))
			expect(response.status).toBe(307)
			expect(response.headers.get('location')).toBe(`${ORIGIN}/login?callbackUrl=%2Fapps`)
		})
	})

	it.each([
		'/login',
		'/forgot-password',
		'/reset-password',
		'/init',
		'/api/auth/session',
		'/api/health',
	])('lets %s through without reading the token', async path => {
		const response = await proxy(request(path))
		expect(isNext(response)).toBe(true)
		expect(response.headers.get('location')).toBeNull()
		expect(getToken).not.toHaveBeenCalled()
	})

	it('lets a signed-in page and API request through', async () => {
		getToken.mockResolvedValue({ id: 'u1', email: 'jane@example.com' })
		for (const path of ['/apps', '/api/dify/app-1/parameters']) {
			expect(isNext(await proxy(request(path)))).toBe(true)
		}
	})

	it('classifies the decoded pathname, so an encoded /api/dify still needs a session', async () => {
		const response = await proxy(request('/api/%64ify/app-1/parameters'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual(unauthorized)
	})

	it('rejects a pathname that does not decode with a 400', async () => {
		const response = await proxy(request('/api/dify/%E0%A4%A'))
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({
			code: 'invalid_param',
			message: 'Bad request.',
			status: 400,
		})
		expect(getToken).not.toHaveBeenCalled()
	})
})
