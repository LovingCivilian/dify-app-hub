import { describe, expect, it } from 'vitest'

import {
	accessSchema,
	APP_DESCRIPTION_MAX,
	APP_NAME_MAX,
	APP_TAG_MAX,
	APP_TAGS_MAX,
	connectionTestSchema,
	createAppFormSchema,
	formFieldErrors,
	updateAppFormSchema,
} from '@/app/(admin)/app-management/schemas'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'chat',
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default',
}
const values = {
	provider: 'dify',
	name: 'Tea',
	description: 'Brews tea',
	tags: ['a'],
	enabled: true,
	access: { mode: 'restricted', groupIds: [], userIds: [] },
	settings,
	secrets: { apiKey: 'app-k' },
}
/** The create form's entries as Object.fromEntries(formData) hands them to the schema. */
const form = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
	values: JSON.stringify({ ...values, ...over }),
	iconIntent: 'keep',
	...extra,
})
const icon = new File([new Uint8Array([1])], 'icon.png', { type: 'image/png' })

// Spec §2.1: the limits of the admin-owned fields, pinned.
describe('the limits', () => {
	it('are a 255-character name, a 2,000-character description and 10 tags of 32 characters', () => {
		expect([APP_NAME_MAX, APP_DESCRIPTION_MAX, APP_TAGS_MAX, APP_TAG_MAX]).toEqual([
			255, 2000, 10, 32,
		])
	})
})

describe('createAppFormSchema (spec §4.3)', () => {
	it('reads the JSON values and the icon intent into the data layer’s input', () => {
		expect(createAppFormSchema.parse(form())).toEqual({
			provider: 'dify',
			common: { name: 'Tea', description: 'Brews tea', tags: ['a'], enabled: true },
			access: { mode: 'restricted', groupIds: [], userIds: [] },
			settings,
			secrets: { apiKey: 'app-k' },
			icon: { intent: 'keep' },
		})
	})
	// Three tags given, one a duplicate once trimmed, and eight more: ten distinct, the limit.
	it('trims the name, the description and the tags, drops duplicate tags, then counts them', () => {
		const parsed = createAppFormSchema.parse(
			form({
				name: '  Tea  ',
				description: ' Brews ',
				tags: [' a', 'a', 'b ', ...Array.from({ length: 8 }, (_, index) => `t${index}`)],
			}),
		)
		expect(parsed.common).toMatchObject({ name: 'Tea', description: 'Brews' })
		expect(parsed.common.tags).toEqual(['a', 'b', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
	})
	it.each([
		['an empty name', { name: '   ' }],
		['a 256-character name', { name: 'a'.repeat(256) }],
		['a 2,001-character description', { description: 'a'.repeat(2001) }],
		['an empty tag', { tags: [' '] }],
		['a 33-character tag', { tags: ['a'.repeat(33)] }],
		['11 different tags', { tags: Array.from({ length: 11 }, (_, index) => `t${index}`) }],
		['an unknown provider', { provider: 'openai' }],
		['Dify settings under the AG-UI provider', { provider: 'agui' }],
		['settings Dify refuses', { settings: { ...settings, appType: 'rag-pipeline' } }],
		['no key on a new app', { secrets: { apiKey: '' } }],
	])('refuses %s', (_label, over) => {
		expect(createAppFormSchema.safeParse(form(over)).success).toBe(false)
	})
	it('refuses values that are not JSON, or missing', () => {
		expect(createAppFormSchema.safeParse({ values: '{', iconIntent: 'keep' }).success).toBe(false)
		expect(createAppFormSchema.safeParse({ iconIntent: 'keep' }).success).toBe(false)
	})
	it('takes a replacement icon with its file, refuses a replacement without one, and reads remove', () => {
		expect(createAppFormSchema.parse(form({}, { iconIntent: 'replace', icon })).icon).toEqual({
			intent: 'replace',
			file: icon,
		})
		expect(createAppFormSchema.safeParse(form({}, { iconIntent: 'replace' })).success).toBe(false)
		expect(createAppFormSchema.parse(form({}, { iconIntent: 'remove' })).icon).toEqual({
			intent: 'remove',
		})
	})
})

describe('updateAppFormSchema (spec §2.3)', () => {
	it('reads a blank key as not given, so the stored one stays', () => {
		expect(updateAppFormSchema.parse(form({ secrets: { apiKey: '' } })).secrets).toEqual({
			apiKey: undefined,
		})
		expect(updateAppFormSchema.parse(form({ secrets: { apiKey: 'app-new' } })).secrets).toEqual({
			apiKey: 'app-new',
		})
	})
})

describe('connectionTestSchema (spec §4.2)', () => {
	const test = { provider: 'dify', settings, secrets: { apiKey: '' } }
	it('takes the provider, its settings, its secrets as the form holds them, and the app when it exists', () => {
		expect(connectionTestSchema.parse(test)).toEqual({ ...test, secrets: { apiKey: undefined } })
		const appId = '3b241101-e2bb-4255-8caf-4136c566a962'
		expect(connectionTestSchema.parse({ ...test, appId }).appId).toBe(appId)
	})
	// Part 0 spec §3.2: an id from outside passes z.uuid() before it reaches a query.
	it('refuses an app id that is not a UUID', () => {
		expect(connectionTestSchema.safeParse({ ...test, appId: 'a1' }).success).toBe(false)
	})
})

// Part 2 spec §2.2: an AG-UI app is read by AG-UI's schemas, its secret write-only like Dify's key.
describe('the AG-UI variants', () => {
	const agui = {
		...values,
		provider: 'agui',
		settings: { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' },
		secrets: { jwtSecret: 'k'.repeat(32) },
	}
	const aguiForm = (over: Record<string, unknown> = {}) => ({
		values: JSON.stringify({ ...agui, ...over }),
		iconIntent: 'keep',
	})
	it('create an AG-UI app with its settings and secret', () => {
		const parsed = createAppFormSchema.parse(aguiForm())
		expect(parsed.provider).toBe('agui')
		expect(parsed.settings).toEqual(agui.settings)
		expect(parsed.secrets).toEqual(agui.secrets)
	})
	it('refuse a new AG-UI app without a 32-character secret', () => {
		expect(
			createAppFormSchema.safeParse(aguiForm({ secrets: { jwtSecret: 'short' } })).success,
		).toBe(false)
	})
	it('read a blank secret on an edit, and on a test, as not given', () => {
		expect(updateAppFormSchema.parse(aguiForm({ secrets: { jwtSecret: '' } })).secrets).toEqual({
			jwtSecret: undefined,
		})
		expect(
			connectionTestSchema.parse({
				provider: 'agui',
				settings: agui.settings,
				secrets: { jwtSecret: '' },
			}),
		).toEqual({ provider: 'agui', settings: agui.settings, secrets: { jwtSecret: undefined } })
	})
})

// The drawer marks a refused field by its path; codes only, since a zod message can echo the input (review B7).
describe('formFieldErrors', () => {
	it('keys an issue inside the JSON values by its own path, with its code', () => {
		const parsed = createAppFormSchema.safeParse(
			form({ name: '', settings: { ...settings, apiBase: 'ftp://x' } }),
		)
		expect(parsed.success).toBe(false)
		expect(formFieldErrors(parsed.error!)).toEqual({
			name: ['too_small'],
			'settings.apiBase': ['invalid_format'],
		})
	})
	it('keys a body that is not JSON as values, with a fixed message instead of the parser’s', () => {
		const parsed = createAppFormSchema.safeParse({
			values: '{"secrets": {"apiKey": "app-sec',
			iconIntent: 'keep',
		})
		expect(parsed.error?.issues).toEqual([
			expect.objectContaining({
				path: ['values'],
				code: 'invalid_format',
				message: 'Invalid JSON',
			}),
		])
		expect(formFieldErrors(parsed.error!)).toEqual({ values: ['invalid_format'] })
	})
})

describe('accessSchema (B3 spec §4.4)', () => {
	const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'
	const accountId = '3d1a6f4b-8e5a-4192-ad0e-4f5a6b7c8d93'

	it('defaults the grant lists and takes the two modes only', () => {
		expect(accessSchema.parse({ mode: 'restricted' })).toEqual({
			mode: 'restricted',
			groupIds: [],
			userIds: [],
		})
		expect(accessSchema.safeParse({ mode: 'public' }).success).toBe(false)
	})

	it('takes UUIDs as group and account ids (ADR-0031)', () => {
		const access = (lists: { groupIds?: string[]; userIds?: string[] }) =>
			accessSchema.safeParse({ mode: 'restricted', ...lists }).success
		expect(access({ groupIds: [groupId], userIds: [accountId] })).toBe(true)
		expect(access({ groupIds: ['g1'] })).toBe(false)
		expect(access({ userIds: ['legacy-1'] })).toBe(false)
		expect(access({ userIds: [''] })).toBe(false)
	})

	it('bounds the grant lists at 1,000 groups and 10,000 accounts', () => {
		const ids = (count: number, id: string) => Array.from({ length: count }, () => id)
		const access = (lists: { groupIds?: string[]; userIds?: string[] }) =>
			accessSchema.safeParse({ mode: 'restricted', ...lists }).success
		expect(access({ groupIds: ids(1000, groupId) })).toBe(true)
		expect(access({ groupIds: ids(1001, groupId) })).toBe(false)
		expect(access({ userIds: ids(10_000, accountId) })).toBe(true)
		expect(access({ userIds: ids(10_001, accountId) })).toBe(false)
	})
})
