import { drizzle } from 'drizzle-orm/node-postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import {
	createApp,
	deleteApp,
	grantRowsFor,
	ICON_MAX_BYTES,
	iconColumnsFrom,
	listAdminApps,
	lockApp,
	parseTags,
	readDocuments,
	readIconBytes,
	readSettings,
	settingsOf,
	syncApp,
	toAdminAppDto,
	toAdminAppDtos,
	toAppDto,
	toAppSummary,
	toChatAppDto,
	updateApp,
} from '@/lib/data/apps'

const row = {
	id: 'a1',
	createdAt: new Date('2026-10-07T10:00:00Z'),
	updatedAt: new Date('2026-10-07T11:00:00Z'),
	name: 'Tea',
	mode: 'advanced-chat',
	description: 'desc',
	tags: ['a', 'b'],
	isEnabled: true,
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-secret',
	enableAnswerForm: true,
	answerFormFeedbackText: 'Thanks',
	enableUpdateInputAfterStarts: false,
	openingStatementDisplayMode: 'always',
	hasIcon: false,
}

describe('parseTags', () => {
	// The jsonb column's value as the driver parsed it (PostgreSQL 18 "JSON Types"): only its strings are tags.
	it('reads an array of strings from the jsonb value and tolerates anything else', () => {
		expect(parseTags(['a', 'b'])).toEqual(['a', 'b'])
		expect(parseTags(['a', 1])).toEqual(['a'])
		expect(parseTags('["a"]')).toEqual([])
		expect(parseTags({ tags: ['a'] })).toEqual([])
		expect(parseTags(null)).toEqual([])
	})
})

describe('settingsOf', () => {
	it('maps the settings with defaults for missing values', () => {
		expect(settingsOf(row)).toEqual({
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'always',
		})
		expect(
			settingsOf({ ...row, answerFormFeedbackText: null, openingStatementDisplayMode: null }),
		).toMatchObject({
			answerForm: { enabled: true, feedbackText: '' },
			openingStatementDisplayMode: 'default',
		})
	})
})

// Spec §2.3: what each DTO carries; never the key, and outside the admin's never the API base.
describe('DTOs', () => {
	const record = {
		id: 'a1',
		provider: 'dify' as const,
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		enabled: true,
		hasIcon: true,
		settings: {
			apiBase: 'https://dify.example/v1',
			appType: 'advanced-chat' as const,
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'always' as const,
		},
	}
	it('the admin DTO carries the provider, whether an image is stored, and the base; never the key', () => {
		const dto = toAppDto(row)
		expect(dto).toMatchObject({ id: 'a1', provider: 'dify', hasIcon: false, mode: 'advanced-chat' })
		expect(dto).not.toHaveProperty('icon')
		expect(JSON.stringify(dto)).not.toContain('app-secret')
		expect(toAppDto({ ...row, mode: 'rag-pipeline' }).mode).toBeNull()
	})
	it('the chat DTO carries the type and the chat switches, never the base', () => {
		const dto = toChatAppDto(record)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			enabled: true,
			hasIcon: true,
			appType: 'advanced-chat',
			settings: {
				answerForm: { enabled: true, feedbackText: 'Thanks' },
				enableUpdateAfterConversationStarts: false,
				openingStatementDisplayMode: 'always',
			},
		})
		expect(JSON.stringify(dto)).not.toContain('dify.example')
	})
	it('the gallery card carries the provider and the type, never the base or the switches', () => {
		const summary = toAppSummary(record)
		expect(summary).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			tags: ['a', 'b'],
			hasIcon: true,
			appType: 'advanced-chat',
		})
	})
})

describe('grantRowsFor (spec §4.4, deviation 4)', () => {
	it('stores no grant for an app open to everyone', () => {
		expect(grantRowsFor('a1', { mode: 'everyone', groupIds: ['g1'], userIds: ['u1'] })).toEqual({
			groups: [],
			users: [],
		})
	})

	it('stores each restricted grant once', () => {
		expect(
			grantRowsFor('a1', { mode: 'restricted', groupIds: ['g1', 'g1'], userIds: ['u1', 'u2'] }),
		).toEqual({
			groups: [{ appId: 'a1', groupId: 'g1' }],
			users: [
				{ appId: 'a1', userId: 'u1' },
				{ appId: 'a1', userId: 'u2' },
			],
		})
	})
})

describe('toAdminAppDto', () => {
	it('adds the mode and only this app’s grants to the DTO', () => {
		const dto = toAdminAppDto(
			{ ...row, accessMode: 'restricted' },
			[
				{ appId: 'a1', groupId: 'g1' },
				{ appId: 'other', groupId: 'g2' },
			],
			[{ appId: 'a1', userId: 'u1' }],
		)
		expect(dto.access).toEqual({ mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] })
		expect(dto).not.toHaveProperty('apiKey')
	})
})

describe('toAdminAppDtos (listAdminApps)', () => {
	it('gives each app only its own grants, grouped once, and keeps the apps’ order', () => {
		const dtos = toAdminAppDtos(
			[
				{ ...row, id: 'a1', accessMode: 'restricted' },
				{ ...row, id: 'a2', accessMode: 'restricted' },
				{ ...row, id: 'a3', accessMode: 'everyone' },
			],
			[
				{ appId: 'a2', groupId: 'g2' },
				{ appId: 'a1', groupId: 'g1' },
				{ appId: 'a2', groupId: 'g3' },
			],
			[{ appId: 'a1', userId: 'u1' }],
		)
		expect(dtos.map(dto => [dto.id, dto.access])).toEqual([
			['a1', { mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] }],
			['a2', { mode: 'restricted', groupIds: ['g2', 'g3'], userIds: [] }],
			['a3', { mode: 'everyone', groupIds: [], userIds: [] }],
		])
	})
})

// Ruling M11: the update locks the app row before it writes the grants, so a delete in between reads as not_found.
describe('lockApp (ADR-0024 decision d)', () => {
	it('is a locking read of one app by its primary key', () => {
		const query = lockApp(drizzle.mock(), 'a1').toSQL()
		expect(query.sql).toMatch(
			/^select .* from "dify_apps" where "dify_apps"\."id" = \$1 limit \$2 for update$/,
		)
		expect(query.params).toEqual(['a1', 1])
	})
})

// Review Focus 4
describe('readIconBytes', () => {
	const image = (bytes: number, type = 'image/png', length?: string) =>
		new Response(new Uint8Array(bytes), {
			status: 200,
			headers: { 'content-type': type, ...(length !== undefined && { 'content-length': length }) },
		})
	it('reads an image within the cap', async () => {
		const result = await readIconBytes(image(10, 'image/png; charset=binary'), 100)
		expect(result).toEqual({ bytes: Buffer.alloc(10), mime: 'image/png' })
	})
	it('refuses a non-image, a declared size over the cap, and an actual size over the cap', async () => {
		expect(await readIconBytes(image(10, 'text/html'), 100)).toBeNull()
		expect(await readIconBytes(image(10, 'image/png', '200'), 100)).toBeNull()
		expect(await readIconBytes(image(150, 'image/png'), 100)).toBeNull()
		expect(ICON_MAX_BYTES).toBe(1024 * 1024)
	})
})

describe('iconColumnsFrom', () => {
	const site = {
		title: 'T',
		icon_type: 'image' as const,
		icon: 'file-id',
		icon_background: null,
		icon_url: 'https://dify.example/files/x?sign=1',
	}
	it('stores an emoji icon without fetching', async () => {
		const fetchImage = vi.fn()
		await expect(
			iconColumnsFrom(
				{ title: 'T', icon_type: 'emoji', icon: '🍵', icon_background: '#FFF' },
				fetchImage,
			),
		).resolves.toEqual({
			columns: {
				iconType: 'emoji',
				icon: '🍵',
				iconBackground: '#FFF',
				iconImage: null,
				iconMime: null,
			},
			partial: false,
		})
		expect(fetchImage).not.toHaveBeenCalled()
	})
	it('stores the fetched bytes of an image icon', async () => {
		const fetchImage = vi.fn().mockResolvedValue({ bytes: Buffer.from([1, 2]), mime: 'image/png' })
		await expect(iconColumnsFrom(site, fetchImage)).resolves.toEqual({
			columns: {
				iconType: 'image',
				icon: 'file-id',
				iconBackground: null,
				iconImage: Buffer.from([1, 2]),
				iconMime: 'image/png',
			},
			partial: false,
		})
		expect(fetchImage).toHaveBeenCalledWith('https://dify.example/files/x?sign=1')
	})
	it('keeps the previous icon (no columns) and reports partial when the image cannot be stored', async () => {
		await expect(iconColumnsFrom(site, vi.fn().mockResolvedValue(null))).resolves.toEqual({
			columns: undefined,
			partial: true,
		})
		await expect(
			iconColumnsFrom(site, vi.fn().mockRejectedValue(new Error('net'))),
		).resolves.toEqual({ columns: undefined, partial: true })
	})
	it('clears the icon when the site has none', async () => {
		await expect(iconColumnsFrom(null, vi.fn())).resolves.toEqual({
			columns: {
				iconType: null,
				icon: null,
				iconBackground: null,
				iconImage: null,
				iconMime: null,
			},
			partial: false,
		})
	})
})

const member = { id: 'u2', email: 'joe@example.com', name: null, role: 'user' as const }
const appInput = {
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-k',
	mode: 'chat',
	enabled: true,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	},
	access: { mode: 'restricted', groupIds: [] as string[], userIds: [] as string[] },
} as const

// Review Focus 1: the role check comes before Dify and the database (the @/db mock throws on any query). fetch
// is stubbed (Vitest "Mocking globals"), so a gate placed after the Dify call fails here without reaching the network.
describe('the apps DAL refuses a non-admin actor before anything else', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it.each([
		['listAdminApps', () => listAdminApps(member)],
		['createApp', () => createApp(member, appInput)],
		['updateApp', () => updateApp(member, 'a1', appInput)],
		['deleteApp', () => deleteApp(member, 'a1')],
		['syncApp', () => syncApp(member, 'a1')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
		expect(fetch).not.toHaveBeenCalled()
	})
})

// Spec §2.3: a row whose documents fail is logged by its id and the failing document, never its values, and is never
// returned half-typed.
describe('readDocuments', () => {
	const settings = {
		apiBase: 'https://dify.example/v1',
		appType: 'chat',
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	}
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads valid documents without a log line', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(readDocuments('a1', 'dify', settings, { apiKey: 'app-secret' })).toEqual({
			provider: 'dify',
			settings,
			secrets: { apiKey: 'app-secret' },
		})
		expect(spy).not.toHaveBeenCalled()
	})
	it.each([
		['an unknown provider', 'agui', settings, { apiKey: 'app-secret' }, 'unknown_provider'],
		[
			'broken settings',
			'dify',
			{ ...settings, appType: null },
			{ apiKey: 'app-secret' },
			'invalid_settings',
		],
		['broken secrets', 'dify', settings, { apiKey: '' }, 'invalid_secrets'],
	])(
		'answers null for %s and logs the app id and the code only',
		(_label, provider, stored, secrets, code) => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
			expect(readDocuments('a1', provider, stored, secrets)).toBeNull()
			expect(spy).toHaveBeenCalledWith('Stored app documents refused:', { appId: 'a1', code })
			expect(JSON.stringify(spy.mock.calls)).not.toContain('app-secret')
			expect(JSON.stringify(spy.mock.calls)).not.toContain('dify.example')
		},
	)
	it('reads the settings alone for the DTO reads, with the same log line on a refusal', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(readSettings('a1', 'dify', settings)).toEqual({ provider: 'dify', settings })
		expect(readSettings('a1', 'dify', { ...settings, apiBase: 'nope' })).toBeNull()
		expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
			appId: 'a1',
			code: 'invalid_settings',
		})
	})
})
