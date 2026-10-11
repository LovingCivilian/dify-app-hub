import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readBrandImage, readBrandImageVersion } = vi.hoisted(() => ({
	readBrandImage: vi.fn(),
	readBrandImageVersion: vi.fn(),
}))
vi.mock('@/lib/settings/branding', () => ({ readBrandImage, readBrandImageVersion }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { GET as getFavicon } from '@/app/api/branding/favicon/route'
import { GET as getLogo } from '@/app/api/branding/logo/route'

const get = (path: string, headers: Record<string, string> = {}) =>
	new NextRequest(`http://app${path}`, { headers })
const sha256 = 'a'.repeat(64)
const image = { bytes: Buffer.from([1, 2, 3]), sha256 }
const etag = `"${'a'.repeat(32)}"`

beforeEach(() => {
	readBrandImage.mockReset()
	readBrandImageVersion.mockReset()
})

describe('GET /api/branding/logo (settings spec §4.5)', () => {
	it('answers the 404 envelope without a custom logo, with no session asked and no bytes read', async () => {
		readBrandImageVersion.mockResolvedValue(null)
		const response = await getLogo(get('/api/branding/logo'))
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toMatchObject({ code: 'not_found', status: 404 })
		expect(response.headers.get('etag')).toBeNull()
		expect(readBrandImage).not.toHaveBeenCalled()
	})

	it('serves the PNG publicly, revalidated on every use, with nosniff and the sandbox CSP', async () => {
		readBrandImageVersion.mockResolvedValue(sha256)
		readBrandImage.mockResolvedValue(image)
		const response = await getLogo(get('/api/branding/logo?v=aaaaaaaaaaaaaaaa'))
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('cache-control')).toBe('public, no-cache')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(response.headers.get('content-security-policy')).toBe(
			"default-src 'none'; style-src 'unsafe-inline'; sandbox",
		)
		expect(response.headers.get('etag')).toBe(etag)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
	})

	it('answers 304 on a matching ETag without reading the bytes', async () => {
		readBrandImageVersion.mockResolvedValue(sha256)
		const cached = await getLogo(get('/api/branding/logo', { 'if-none-match': etag }))
		expect(cached.status).toBe(304)
		expect(cached.headers.get('etag')).toBe(etag)
		expect(readBrandImage).not.toHaveBeenCalled()
	})

	it('takes the ETag of the bytes it read when a save landed after the version read', async () => {
		readBrandImageVersion.mockResolvedValue('b'.repeat(64))
		readBrandImage.mockResolvedValue(image)
		const response = await getLogo(get('/api/branding/logo'))
		expect(response.status).toBe(200)
		expect(response.headers.get('etag')).toBe(etag)
	})

	it('answers 404 when the bytes vanished after the version read', async () => {
		readBrandImageVersion.mockResolvedValue(sha256)
		readBrandImage.mockResolvedValue(null)
		expect((await getLogo(get('/api/branding/logo'))).status).toBe(404)
	})

	it('answers an unexpected failure with the 500 envelope', async () => {
		readBrandImageVersion.mockRejectedValue(new Error('boom'))
		expect((await getLogo(get('/api/branding/logo'))).status).toBe(500)
	})
})

describe('GET /api/branding/favicon', () => {
	it('serves the favicon when there is one', async () => {
		readBrandImageVersion.mockImplementation(async (kind: string) =>
			kind === 'favicon' ? sha256 : null,
		)
		readBrandImage.mockResolvedValue(image)
		const response = await getFavicon(get('/api/branding/favicon'))
		expect(response.status).toBe(200)
		expect(readBrandImage.mock.calls.map(([kind]) => kind)).toEqual(['favicon'])
	})

	it('falls back to the logo, version and bytes', async () => {
		readBrandImageVersion.mockImplementation(async (kind: string) =>
			kind === 'logo' ? sha256 : null,
		)
		readBrandImage.mockResolvedValue(image)
		const response = await getFavicon(get('/api/branding/favicon'))
		expect(response.status).toBe(200)
		expect(readBrandImage.mock.calls.map(([kind]) => kind)).toEqual(['logo'])
		const cached = await getFavicon(get('/api/branding/favicon', { 'if-none-match': etag }))
		expect(cached.status).toBe(304)
		expect(readBrandImage).toHaveBeenCalledTimes(1)
	})

	it('answers 404 with neither', async () => {
		readBrandImageVersion.mockResolvedValue(null)
		expect((await getFavicon(get('/api/branding/favicon'))).status).toBe(404)
	})
})
