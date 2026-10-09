import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The DAL's Dify reads and its writes: the real client and readIconBytes over a stubbed fetch, a fake Drizzle chain
// that records the selection, the inserted values and what the update sets. vi.mock factories are hoisted above
// imports, so the fake comes from vi.hoisted.
const { db } = vi.hoisted(() => {
	const db = {
		row: undefined as Record<string, unknown> | undefined,
		fields: undefined as Record<string, unknown> | undefined,
		values: undefined as Record<string, unknown> | undefined,
		set: undefined as Record<string, unknown> | undefined,
		select: (fields?: Record<string, unknown>) => {
			db.fields = fields
			const rows = async () => (db.row ? [db.row] : [])
			return { from: () => ({ where: () => ({ limit: rows, orderBy: rows }), orderBy: rows }) }
		},
		insert: () => ({
			values: async (values: Record<string, unknown>) => {
				db.values = values
			},
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

import {
	createApp,
	getChatApp,
	ICON_MAX_BYTES,
	listApps,
	syncApp,
	type AppSettings,
} from '@/lib/data/apps'

const actor = { id: 'u1', email: 'jane@example.com', name: null, role: 'admin' as const }
const ICON_URL = 'https://dify.example/files/x?sign=1'
// What the narrow access read returns (the fake ignores the selection; the selection test checks it).
const stored = {
	id: 'a1',
	isEnabled: true,
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
}
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const png = (bytes: number) =>
	new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } })

const INFO = { name: 'Tea 2', mode: 'chat', description: 'new', tags: ['x'] }
const IMAGE_SITE = { title: 'T', icon_type: 'image', icon: 'new-file', icon_url: ICON_URL }

let fetchMock: ReturnType<typeof vi.fn>
/** Dify's /info, /site and the signed icon url, each overridable. */
const dify = ({
	info = INFO,
	site = async () => json(IMAGE_SITE),
	icon = async () => png(4),
}: {
	info?: Record<string, unknown>
	site?: () => Promise<Response>
	icon?: () => Promise<Response>
} = {}) =>
	fetchMock.mockImplementation(async (url: string) => {
		if (url === 'https://dify.example/v1/info') return json(info)
		if (url === 'https://dify.example/v1/site') return site()
		if (url === ICON_URL) return icon()
		throw new Error(`unexpected fetch ${url}`)
	})

beforeEach(() => {
	db.row = { ...stored }
	db.fields = undefined
	db.values = undefined
	db.set = undefined
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const infoColumns = { name: 'Tea 2', mode: 'chat', description: 'new', tags: '["x"]' }
const storedIcon = {
	iconType: 'image',
	icon: 'new-file',
	iconBackground: null,
	iconImage: Buffer.alloc(4),
	iconMime: 'image/png',
}
const clearedIcon = {
	iconType: null,
	icon: null,
	iconBackground: null,
	iconImage: null,
	iconMime: null,
}

describe('syncApp and the icon (Review Focus 4)', () => {
	it('stores the info and the fetched icon', async () => {
		dify()
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: false })
		expect(db.set).toStrictEqual({ ...infoColumns, ...storedIcon })
		// The signed icon_url authenticates itself: the app key never goes with it (it may be on FILES_URL's origin).
		const [, init] = fetchMock.mock.calls.find(([url]) => url === ICON_URL) as [string, RequestInit]
		expect(new Headers(init.headers).has('authorization')).toBe(false)
		expect(init.redirect).toBe('error')
	})

	it.each([
		['a 3 MB PNG', async () => png(3 * ICON_MAX_BYTES)],
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
		dify({ icon })
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: true })
		// The info is stored; no icon column is written, so the row keeps its previous icon.
		expect(db.set).toStrictEqual(infoColumns)
	})

	// Dify builds icon_url from FILES_URL: empty on a default self-hosted install, so the link is relative and resolves
	// against the API base's origin (as the remote-file route resolves relative links); set, it may name another origin
	// than the API's (Dify Cloud: upload.dify.ai), and the link is fetched as given.
	const SIGNED = '?timestamp=1&nonce=n&sign=s'
	it.each([
		[
			'a relative icon_url at the API base origin',
			`/files/f1/file-preview${SIGNED}`,
			`https://dify.example/files/f1/file-preview${SIGNED}`,
		],
		[
			'an absolute icon_url on another origin as given',
			`https://files.dify.example/files/f1/file-preview${SIGNED}`,
			`https://files.dify.example/files/f1/file-preview${SIGNED}`,
		],
	])('fetches %s, without the bearer', async (_case, iconUrl, fetched) => {
		fetchMock.mockImplementation(async (url: string) => {
			if (url === 'https://dify.example/v1/info') return json(INFO)
			if (url === 'https://dify.example/v1/site') return json({ ...IMAGE_SITE, icon_url: iconUrl })
			if (url === fetched) return png(4)
			throw new Error(`unexpected fetch ${url}`)
		})
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: false })
		expect(db.set).toStrictEqual({ ...infoColumns, ...storedIcon })
		const [, init] = fetchMock.mock.calls.find(([url]) => url === fetched) as [string, RequestInit]
		expect(new Headers(init.headers).has('authorization')).toBe(false)
		expect(init.redirect).toBe('error')
	})

	it('keeps the stored icon when icon_url is not a URL', async () => {
		dify({ site: async () => json({ ...IMAGE_SITE, icon_url: 'http://[bad' }) })
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: true })
		expect(db.set).toStrictEqual(infoColumns)
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			'https://dify.example/v1/info',
			'https://dify.example/v1/site',
		])
	})

	it('keeps the stored icon when /site fails (a 500 says nothing about the icon)', async () => {
		dify({
			site: async () => json({ code: 'internal_server_error', message: 'boom', status: 500 }, 500),
		})
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: true })
		expect(db.set).toStrictEqual(infoColumns)
		expect(fetchMock).not.toHaveBeenCalledWith(ICON_URL, expect.anything())
	})

	it('clears the icon when /site answers 403 (the app has no site)', async () => {
		dify({ site: async () => json({ code: 'forbidden', message: 'Forbidden', status: 403 }, 403) })
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: false })
		expect(db.set).toStrictEqual({ ...infoColumns, ...clearedIcon })
	})

	it('answers null for an app that is gone, without calling Dify', async () => {
		db.row = undefined
		await expect(syncApp(actor, 'a1')).resolves.toBeNull()
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('the mode written to the row (charter §4.4: only the six known modes)', () => {
	const settings: AppSettings = {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	}
	const input = {
		apiBase: 'https://dify.example/v1',
		apiKey: 'app-secret',
		mode: 'workflow' as const,
		enabled: true,
		settings,
	}

	it.each([
		['a known mode from Dify wins', 'chat', 'chat'],
		["an unknown mode from Dify falls back to the form's choice", 'rag-pipeline', 'workflow'],
	])('create: %s', async (_case, difyMode, expected) => {
		dify({ info: { ...INFO, mode: difyMode } })
		await createApp(actor, input)
		expect(db.values).toMatchObject({ name: 'Tea 2', mode: expected })
	})

	it('sync: an unknown mode from Dify leaves the stored mode alone', async () => {
		dify({ info: { ...INFO, mode: 'rag-pipeline' } })
		await expect(syncApp(actor, 'a1')).resolves.toEqual({ id: 'a1', partial: false })
		expect(db.set).toStrictEqual({
			name: 'Tea 2',
			description: 'new',
			tags: '["x"]',
			...storedIcon,
		})
	})
})

describe('reads select explicit columns (charter §4.2)', () => {
	const dtoRow = {
		id: 'a1',
		createdAt: new Date('2026-10-07T10:00:00Z'),
		updatedAt: new Date('2026-10-07T11:00:00Z'),
		name: 'Tea',
		mode: 'chat',
		description: null,
		tags: null,
		isEnabled: true,
		apiBase: 'https://dify.example/v1',
		enableAnswerForm: false,
		answerFormFeedbackText: null,
		enableUpdateInputAfterStarts: false,
		openingStatementDisplayMode: null,
		enableAnnotation: false,
		iconType: 'image',
		icon: 'file-id',
		iconBackground: null,
		hasIconImage: true,
	}

	it.each([
		['listApps', () => listApps(actor)],
		['getChatApp', () => getChatApp(actor, 'a1')],
	])('%s reads neither the key nor the icon bytes', async (_name, read) => {
		db.row = dtoRow
		const result = await read()
		const fields = Object.keys(db.fields ?? {})
		expect(fields).toContain('hasIconImage')
		expect(fields).not.toContain('apiKey')
		expect(fields).not.toContain('iconImage')
		expect(fields).not.toContain('iconMime')
		expect(Array.isArray(result) ? result[0] : result).toMatchObject({ icon: { kind: 'image' } })
	})

	it('syncApp reads only the access columns', async () => {
		dify()
		await syncApp(actor, 'a1')
		expect(Object.keys(db.fields ?? {}).sort()).toEqual([
			'apiBase',
			'apiKey',
			'enableAnnotation',
			'id',
			'isEnabled',
		])
	})
})
