import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifySession, getAppIcon } = vi.hoisted(() => ({
	verifySession: vi.fn(),
	getAppIcon: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({
	verifySession,
	AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/data/apps', () => ({ getAppIcon }))

import { GET } from '@/app/api/apps/[appId]/icon/route'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const ctx = { params: Promise.resolve({ appId: 'app-1' }) }
const get = (headers: Record<string, string> = {}) =>
	new NextRequest('http://app/api/apps/app-1/icon', { headers })

beforeEach(() => {
	verifySession.mockReset()
	getAppIcon.mockReset()
})

describe('GET /api/apps/[appId]/icon', () => {
	it('refuses without a session', async () => {
		verifySession.mockResolvedValue(null)
		expect((await GET(get(), ctx)).status).toBe(401)
	})
	it('answers 404 when the app has no stored image', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue(null)
		expect((await GET(get(), ctx)).status).toBe(404)
	})
	it('serves the bytes with their type, an ETag and a private cache header, and 304 on a matching ETag', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), mime: 'image/png' })
		const response = await GET(get(), ctx)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
		const etag = response.headers.get('etag')
		expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
		const cached = await GET(get({ 'if-none-match': etag! }), ctx)
		expect(cached.status).toBe(304)
		expect(cached.headers.get('etag')).toBe(etag)
	})
})
