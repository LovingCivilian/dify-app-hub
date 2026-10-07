import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real client behind the handlers, with fetch stubbed: Review Focus 1, the route half (the client half is in
// dify-client.test.ts). Dify answers something that is not JSON; the route answers the envelope, never a 500.
const { verifySession, getAppAccess } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppAccess: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppAccess }))

import { GET as info } from '@/app/api/dify/[appId]/info/route'
import { GET as meta } from '@/app/api/dify/[appId]/meta/route'
import { GET as parameters } from '@/app/api/dify/[appId]/parameters/route'
import { GET as site } from '@/app/api/dify/[appId]/site/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const access = { id: 'app-1', enabled: true, credentials: { apiBase: 'http://d/v1', apiKey: 'k' } }
const ctx = { params: Promise.resolve({ appId: 'app-1' }) }

const routes = [
	['info', info],
	['parameters', parameters],
	['site', site],
	['meta', meta],
] as const

let fetchMock: ReturnType<typeof vi.fn>
const upstream = (make: () => Response) => fetchMock.mockImplementation(async () => make())

beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
	verifySession.mockReset().mockResolvedValue(actor)
	getAppAccess.mockReset().mockResolvedValue(access)
})
afterEach(() => vi.unstubAllGlobals())

describe.each(routes)('GET /api/dify/[appId]/%s with a non-JSON upstream', (path, handler) => {
	const call = () => handler(new NextRequest(`http://app/api/dify/app-1/${path}`), ctx)

	it('answers 502 upstream_error for an OK answer that is an HTML page', async () => {
		upstream(() => new Response('<html>welcome</html>', { status: 200 }))
		const response = await call()
		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toMatchObject({ code: 'upstream_error', status: 502 })
	})
	it('answers 502 upstream_error for an OK answer with an empty body', async () => {
		upstream(() => new Response('', { status: 200 }))
		const response = await call()
		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toMatchObject({ code: 'upstream_error', status: 502 })
	})
	it('answers 502 upstream_error for an OK answer cut off mid-JSON', async () => {
		upstream(() => new Response('{"name": "A", "mo', { status: 200 }))
		const response = await call()
		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toMatchObject({ code: 'upstream_error', status: 502 })
	})
	it("keeps Dify's status for a reverse proxy's HTML error page", async () => {
		upstream(() => new Response('<html>504 Gateway Time-out</html>', { status: 504 }))
		const response = await call()
		expect(response.status).toBe(504)
		await expect(response.json()).resolves.toMatchObject({ code: 'upstream_error', status: 504 })
	})
	it('answers 502 upstream_unreachable when Dify cannot be reached, without the cause', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		fetchMock.mockRejectedValue(
			new TypeError('fetch failed: http://d/v1/info?user=jane@example.com'),
		)
		const response = await call()
		expect(response.status).toBe(502)
		const body = await response.json()
		expect(body).toEqual({
			code: 'upstream_unreachable',
			message: 'Dify is unreachable.',
			status: 502,
		})
		expect(JSON.stringify(body)).not.toContain('jane@example.com')
		log.mockRestore()
	})
})
