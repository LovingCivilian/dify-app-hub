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
const ctx = { params: Promise.resolve({ appId: '3b241101-e2bb-4255-8caf-4136c566a962' }) }
const get = (headers: Record<string, string> = {}) =>
	new NextRequest('http://app/api/apps/3b241101-e2bb-4255-8caf-4136c566a962/icon', { headers })

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
	// After a grant is removed, the browser revalidates its stored icon with the old ETag (RFC 9111 §4.3, RFC 9110
	// §13.1.2 If-None-Match). The access rule answers first, so the caller gets the missing-icon 404, never a 304.
	it('answers 404, not 304, for an app the caller may not use, whatever ETag it sends', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue(null)
		const response = await GET(get({ 'if-none-match': `"${'0'.repeat(32)}"` }), ctx)
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toMatchObject({ code: 'icon_not_found', status: 404 })
		expect(response.headers.get('etag')).toBeNull()
	})
	// The browser revalidates every use (RFC 9111 §5.2.2.4 no-cache), so a removed grant applies at the next request
	// (B3 spec §4.5) and an unchanged icon still costs only a 304.
	it('serves the bytes with their type, an ETag and a revalidated private cache header, and 304 on a matching ETag', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), mime: 'image/png' })
		const response = await GET(get(), ctx)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('cache-control')).toBe('private, no-cache')
		const etag = response.headers.get('etag')
		expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
		const cached = await GET(get({ 'if-none-match': etag! }), ctx)
		expect(cached.status).toBe(304)
		expect(cached.headers.get('etag')).toBe(etag)
	})
	// A stored SVG icon opened top-level must not run scripts on the hub's origin (GitHub raw's pattern); an <img>
	// is unaffected by either header.
	it('sends nosniff and a sandboxing CSP on 200 and on 304', async () => {
		verifySession.mockResolvedValue(actor)
		getAppIcon.mockResolvedValue({ bytes: Buffer.from('<svg/>'), mime: 'image/svg+xml' })
		const response = await GET(get(), ctx)
		const cached = await GET(get({ 'if-none-match': response.headers.get('etag')! }), ctx)
		expect(cached.status).toBe(304)
		for (const answer of [response, cached]) {
			expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
			expect(answer.headers.get('content-security-policy')).toBe(
				"default-src 'none'; style-src 'unsafe-inline'; sandbox",
			)
		}
	})
	// Spec §3.2: a malformed id is an app without an icon, answered before any query (22P02); the session comes first.
	it('answers 404 icon_not_found for a malformed id without reading the app, and 401 signed out', async () => {
		const malformed = { params: Promise.resolve({ appId: 'not-a-uuid' }) }
		const request = new NextRequest('http://app/api/apps/not-a-uuid/icon')
		verifySession.mockResolvedValue(null)
		expect((await GET(request, malformed)).status).toBe(401)
		verifySession.mockResolvedValue(actor)
		const response = await GET(request, malformed)
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toMatchObject({ code: 'icon_not_found', status: 404 })
		expect(getAppIcon).not.toHaveBeenCalled()
	})
})
