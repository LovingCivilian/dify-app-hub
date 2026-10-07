import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Review Focus 4 through syncApp: the real client and readIconBytes over a stubbed fetch, a fake Drizzle chain
// that records what the update sets. vi.mock factories are hoisted above imports, so the fake comes from vi.hoisted.
const { db } = vi.hoisted(() => {
	const db = {
		row: undefined as Record<string, unknown> | undefined,
		set: undefined as Record<string, unknown> | undefined,
		select: () => ({
			from: () => ({ where: () => ({ limit: async () => (db.row ? [db.row] : []) }) }),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				db.set = values
				return { where: async () => [{ affectedRows: 1 }] }
			},
		}),
	}
	return { db }
})
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({ getDb: () => db }))

import { ICON_MAX_BYTES, syncApp } from '@/lib/data/apps'

const actor = { id: 'u1', email: 'jane@example.com', name: null }
const ICON_URL = 'https://dify.example/files/x?sign=1'
const stored = {
	id: 'a1',
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
	iconType: 'image',
	icon: 'old-file',
	iconImage: Buffer.from([9]),
	iconMime: 'image/png',
}
const json = (body: unknown) =>
	new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
/** Dify's info and an image site; the icon url answers with `icon()`. */
const dify = (icon: () => Promise<Response>) =>
	fetchMock.mockImplementation(async (url: string) => {
		if (url === 'https://dify.example/v1/info')
			return json({ name: 'Tea 2', mode: 'chat', description: 'new', tags: ['x'] })
		if (url === 'https://dify.example/v1/site')
			return json({ title: 'T', icon_type: 'image', icon: 'new-file', icon_url: ICON_URL })
		if (url === ICON_URL) return icon()
		throw new Error(`unexpected fetch ${url}`)
	})

beforeEach(() => {
	db.row = { ...stored }
	db.set = undefined
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const infoColumns = { name: 'Tea 2', mode: 'chat', description: 'new', tags: '["x"]' }

describe('syncApp and the icon (Review Focus 4)', () => {
	it('stores the info and the fetched icon', async () => {
		dify(async () => new Response(new Uint8Array(4), { headers: { 'content-type': 'image/png' } }))
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: false })
		expect(db.set).toStrictEqual({
			...infoColumns,
			iconType: 'image',
			icon: 'new-file',
			iconBackground: null,
			iconImage: Buffer.alloc(4),
			iconMime: 'image/png',
		})
		const [, init] = fetchMock.mock.calls.find(([url]) => url === ICON_URL) as [string, RequestInit]
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer app-secret')
	})

	it.each([
		[
			'a 3 MB PNG',
			async () =>
				new Response(new Uint8Array(3 * ICON_MAX_BYTES), {
					headers: { 'content-type': 'image/png' },
				}),
		],
		[
			'an HTML error page at the signed url',
			async () =>
				new Response('<html>expired</html>', { headers: { 'content-type': 'text/html' } }),
		],
		[
			'a network failure',
			async () => {
				throw new TypeError('fetch failed')
			},
		],
	])('keeps the stored icon and the rest of the sync on %s', async (_case, icon) => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		dify(icon)
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: true })
		// The info is stored; no icon column is written, so the row keeps its previous icon.
		expect(db.set).toStrictEqual(infoColumns)
	})

	it('answers null for an app that is gone, without calling Dify', async () => {
		db.row = undefined
		await expect(syncApp(actor, 'a1')).resolves.toBeNull()
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
