import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories are hoisted above imports, so the mock must be created with vi.hoisted.
const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken }))

import { proxy } from '@/proxy'

const ORIGIN = 'http://localhost:5300'
const fetchMock = vi.fn()

const request = (path: string) => new NextRequest(new URL(path, ORIGIN))
const initStatus = (initialized: boolean) =>
	fetchMock.mockResolvedValue({ json: async () => ({ initialized }) })
const isNext = (response: Response) => response.headers.get('x-middleware-next') === '1'

describe('proxy', () => {
	beforeEach(() => {
		getToken.mockReset()
		getToken.mockResolvedValue(null)
		fetchMock.mockReset()
		initStatus(true)
		vi.stubGlobal('fetch', fetchMock)
	})

	afterEach(() => vi.unstubAllGlobals())

	it('answers /api/dify without a session with a 401 JSON error', async () => {
		const response = await proxy(request('/api/dify/app-1/parameters'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual({
			code: 'unauthorized',
			message: 'Sign in required.',
			status: 401,
		})
	})

	it('redirects a page without a session to the login page with a callbackUrl', async () => {
		const response = await proxy(request('/chat/abc?x=1'))
		expect(response.status).toBe(307)
		const location = response.headers.get('location')
		expect(location).toBe(`${ORIGIN}/login?callbackUrl=%2Fchat%2Fabc%3Fx%3D1`)
		expect(new URL(location!).searchParams.get('callbackUrl')).toBe('/chat/abc?x=1')
	})

	it('denies other /api paths without a session by default', async () => {
		const response = await proxy(request('/api/users'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual({
			code: 'unauthorized',
			message: 'Sign in required.',
			status: 401,
		})
	})

	// ADR-0018: on a sessionVersion mismatch the jwt callback strips id from the token; the cookie still decodes.
	describe('with a revoked token (no id)', () => {
		const revoked = { email: 'jane@example.com', name: 'Jane' }

		it('answers an API path with the 401 envelope', async () => {
			getToken.mockResolvedValue(revoked)
			const response = await proxy(request('/api/users'))
			expect(response.status).toBe(401)
			await expect(response.json()).resolves.toEqual({
				code: 'unauthorized',
				message: 'Sign in required.',
				status: 401,
			})
		})

		it('redirects a page to the login page with a callbackUrl', async () => {
			getToken.mockResolvedValue(revoked)
			const response = await proxy(request('/apps'))
			expect(response.status).toBe(307)
			expect(response.headers.get('location')).toBe(`${ORIGIN}/login?callbackUrl=%2Fapps`)
		})

		it('still lets /login and the ungated paths through, so the redirect does not loop', async () => {
			getToken.mockResolvedValue(revoked)
			for (const path of ['/login', '/forgot-password', '/api/auth/session', '/init']) {
				const response = await proxy(request(path))
				expect(isNext(response)).toBe(true)
				expect(response.headers.get('location')).toBeNull()
			}
		})
	})

	it('lets /login through without a session and still checks the init status', async () => {
		const response = await proxy(request('/login'))
		expect(isNext(response)).toBe(true)
		expect(response.headers.get('location')).toBeNull()
		expect(getToken).not.toHaveBeenCalled()
		expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/init/status`, { cache: 'no-store' })
	})

	it('lets /api/dify through with a session without checking the init status', async () => {
		getToken.mockResolvedValue({ id: 'u1', email: 'jane@example.com' })
		const response = await proxy(request('/api/dify/app-1/parameters'))
		expect(isNext(response)).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('classifies the decoded pathname, so an encoded /api/dify still needs a session', async () => {
		const response = await proxy(request('/api/%64ify/app-1/parameters'))
		expect(response.status).toBe(401)
		await expect(response.json()).resolves.toEqual({
			code: 'unauthorized',
			message: 'Sign in required.',
			status: 401,
		})
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

	it('redirects a signed-in page request to /init until the system is set up', async () => {
		getToken.mockResolvedValue({ id: 'u1', email: 'jane@example.com' })
		initStatus(false)
		const response = await proxy(request('/apps'))
		expect(response.status).toBe(307)
		expect(response.headers.get('location')).toBe(`${ORIGIN}/init`)
	})

	it('lets /api/auth through without a session and without reading the token', async () => {
		const response = await proxy(request('/api/auth/session'))
		expect(isNext(response)).toBe(true)
		expect(getToken).not.toHaveBeenCalled()
	})
})
