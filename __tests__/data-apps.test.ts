import { drizzle } from 'drizzle-orm/node-postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the pure tests')
	},
}))

import { apps } from '@/db/schema'
import {
	appOfProvider,
	createApp,
	deleteApp,
	getStoredSecrets,
	grantRowsFor,
	listAdminApps,
	lockApp,
	parseTags,
	readDocuments,
	readSettings,
	toAdminAppDto,
	toAdminAppDtos,
	toAppSummary,
	toChatAppDto,
	updateApp,
} from '@/lib/data/apps'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat' as const,
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'always' as const,
}

afterEach(() => {
	vi.restoreAllMocks()
})

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

// Spec §2.3: a row whose documents fail is logged by its id and the failing document, never its values.
describe('readDocuments and readSettings', () => {
	it('read valid documents without a log line', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(readDocuments('a1', 'dify', settings, { apiKey: 'app-secret' })).toEqual({
			provider: 'dify',
			settings,
			secrets: { apiKey: 'app-secret' },
		})
		expect(readSettings('a1', 'dify', settings)).toEqual({ provider: 'dify', settings })
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
		'answer null for %s and log the app id and the code only',
		(_label, provider, stored, secrets, code) => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
			expect(readDocuments('a1', provider, stored, secrets)).toBeNull()
			expect(spy).toHaveBeenCalledWith('Stored app documents refused:', { appId: 'a1', code })
			expect(JSON.stringify(spy.mock.calls)).not.toContain('app-secret')
			expect(JSON.stringify(spy.mock.calls)).not.toContain('dify.example')
		},
	)
})

describe('the user DTOs (spec §2.3)', () => {
	const record = {
		id: 'a1',
		provider: 'dify' as const,
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		enabled: true,
		hasIcon: true,
		settings,
	}
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
		expect(toAppSummary(record)).toEqual({
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

describe('the admin DTO (spec §2.3)', () => {
	const row = {
		id: 'a1',
		createdAt: new Date('2026-10-07T10:00:00Z'),
		updatedAt: new Date('2026-10-07T11:00:00Z'),
		provider: 'dify',
		name: 'Tea',
		description: 'desc',
		tags: ['a', 'b'],
		isEnabled: true,
		accessMode: 'restricted' as const,
		hasIcon: false,
		settings,
		secrets: { apiKey: 'app-secret' },
	}
	it('carries the settings and which secrets are set, never their values, and only this app’s grants', () => {
		const dto = toAdminAppDto(
			row,
			[
				{ appId: 'a1', groupId: 'g1' },
				{ appId: 'other', groupId: 'g2' },
			],
			[{ appId: 'a1', userId: 'u1' }],
		)
		expect(dto).toEqual({
			id: 'a1',
			provider: 'dify',
			name: 'Tea',
			description: 'desc',
			tags: ['a', 'b'],
			enabled: true,
			hasIcon: false,
			access: { mode: 'restricted', groupIds: ['g1'], userIds: ['u1'] },
			createdAt: '2026-10-07T10:00:00.000Z',
			updatedAt: '2026-10-07T11:00:00.000Z',
			invalid: false,
			settings,
			secretsSet: { apiKey: true },
		})
		expect(JSON.stringify(dto)).not.toContain('app-secret')
	})
	it('marks a row whose documents fail invalid, with no settings and no secrets flags', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const dto = toAdminAppDto({ ...row, secrets: { apiKey: '' } }, [], [])
		expect(dto).toMatchObject({ id: 'a1', provider: 'dify', invalid: true })
		expect(dto).not.toHaveProperty('settings')
		expect(dto).not.toHaveProperty('secretsSet')
	})
	// DV 11: the CHECK allows no other provider; a row that has one anyway is left out of the list, logged.
	it('leaves out a row whose provider the hub does not know', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		expect(toAdminAppDto({ ...row, provider: 'agui' }, [], [])).toBeNull()
		expect(spy).toHaveBeenCalledWith('Stored app documents refused:', {
			appId: 'a1',
			code: 'unknown_provider',
		})
	})
	it('gives each app only its own grants, grouped once, and keeps the apps’ order', () => {
		const dtos = toAdminAppDtos(
			[
				{ ...row, id: 'a1' },
				{ ...row, id: 'a2' },
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

describe('grantRowsFor (B3 spec §4.4, deviation 4)', () => {
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

// Ruling M11 of B3a: the update locks the app row before it writes the grants, so a delete in between reads as not_found.
describe('lockApp (ADR-0024 decision d)', () => {
	it('is a locking read of one app by its primary key, with its provider and stored secrets', () => {
		const query = lockApp(drizzle.mock(), 'a1').toSQL()
		expect(query.sql).toMatch(
			/^select "id", "provider", "secrets" from "apps" where "apps"\."id" = \$1 limit \$2 for update$/,
		)
		expect(query.params).toEqual(['a1', 1])
	})
})

// Spec §2.3: the provider never changes; the update and the secrets read name the stored one.
describe('appOfProvider', () => {
	it('is this app of this provider', () => {
		const query = drizzle
			.mock()
			.select({ id: apps.id })
			.from(apps)
			.where(appOfProvider('a1', 'dify'))
			.toSQL()
		// Drizzle 1.0.0-rc.4 parenthesises each and() operand and the whole condition (measured while planning).
		expect(query.sql).toMatch(/where \(\("apps"\."id" = \$1\) and \("apps"\."provider" = \$2\)\)$/)
		expect(query.params).toEqual(['a1', 'dify'])
	})
})

const member = {
	id: 'u2',
	email: 'joe@example.com',
	name: null,
	role: 'user' as const,
	source: 'local' as const,
}

// The role check comes before the database (the @/db mock throws on any query).
describe('the apps DAL refuses a non-admin actor before anything else', () => {
	it.each([
		['listAdminApps', () => listAdminApps(member)],
		[
			'createApp',
			() =>
				createApp(member, {
					provider: 'dify',
					common: { name: 'x', description: '', tags: [], enabled: true },
					access: { mode: 'everyone', groupIds: [], userIds: [] },
					settings,
					secrets: { apiKey: 'k' },
					icon: { intent: 'keep' },
				}),
		],
		[
			'updateApp',
			() =>
				updateApp(member, 'a1', {
					common: { name: 'x', description: '', tags: [], enabled: true },
					access: { mode: 'everyone', groupIds: [], userIds: [] },
					settings,
					secrets: {},
					icon: { intent: 'keep' },
				}),
		],
		['deleteApp', () => deleteApp(member, 'a1')],
		['getStoredSecrets', () => getStoredSecrets(member, 'a1', 'dify')],
	] as const)('%s', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
	})
})
