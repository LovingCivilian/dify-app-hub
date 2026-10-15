import { describe, expect, it } from 'vitest'

import {
	DIFY_DEFAULT_SECRETS,
	DIFY_DEFAULT_SETTINGS,
	difySecretsSchema,
	difySecretsUpdateSchema,
	difySettingsSchema,
} from '@/lib/providers/dify/schema'
import { isProviderId, PROVIDER_IDS } from '@/lib/providers/ids'
import {
	checkDocuments,
	checkSettings,
	mergeSecrets,
	PROVIDER_SCHEMAS,
} from '@/lib/providers/schemas'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat',
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'always',
}

describe('the provider ids (spec §3; decision 24)', () => {
	it('are Dify and, since Part 2, AG-UI agents (Part 2 spec §2.1)', () => {
		expect(PROVIDER_IDS).toEqual(['dify', 'agui'])
		expect(isProviderId('dify')).toBe(true)
		expect(isProviderId('agui')).toBe(true)
		expect(isProviderId('openai')).toBe(false)
		expect(isProviderId(undefined)).toBe(false)
	})
	it('each have their schemas (DV 11: the map is exhaustive)', () => {
		expect(Object.keys(PROVIDER_SCHEMAS).sort()).toEqual([...PROVIDER_IDS].sort())
	})
})

describe("Dify's settings (spec §2.2)", () => {
	it('reads a valid document and drops keys it does not know', () => {
		expect(difySettingsSchema.parse({ ...settings, unknownKey: true })).toEqual(settings)
	})
	it('takes a Docker service name as the API base', () => {
		expect(
			difySettingsSchema.safeParse({ ...settings, apiBase: 'http://api:5001/v1' }).success,
		).toBe(true)
	})
	it.each([
		['an unknown app type', { appType: 'rag-pipeline' }],
		['no app type', { appType: null }],
		['an ftp base', { apiBase: 'ftp://dify.example/v1' }],
		['a base without a scheme', { apiBase: 'dify.example/v1' }],
		['a base over 500 characters', { apiBase: `https://dify.example/${'a'.repeat(480)}` }],
		[
			'a submit text over 255 characters',
			{ answerForm: { enabled: true, feedbackText: 'a'.repeat(256) } },
		],
		['an unknown opener display', { openingStatementDisplayMode: 'sometimes' }],
	])('refuses %s', (_label, change) => {
		expect(difySettingsSchema.safeParse({ ...settings, ...change }).success).toBe(false)
	})
	it('starts a new app as a chatbot with the switches off and no key', () => {
		expect(DIFY_DEFAULT_SETTINGS).toEqual({
			apiBase: '',
			appType: 'chat',
			answerForm: { enabled: false, feedbackText: '' },
			enableUpdateAfterConversationStarts: false,
			openingStatementDisplayMode: 'default',
		})
		expect(DIFY_DEFAULT_SECRETS).toEqual({ apiKey: '' })
	})
})

describe("Dify's secrets (spec §2.2)", () => {
	it('takes a key of 1–255 characters, trimmed', () => {
		expect(difySecretsSchema.parse({ apiKey: '  app-abc  ' })).toEqual({ apiKey: 'app-abc' })
		expect(difySecretsSchema.safeParse({ apiKey: 'a'.repeat(255) }).success).toBe(true)
	})
	it.each([
		['an empty key', ''],
		['a blank key', '   '],
		['a key over 255 characters', 'a'.repeat(256)],
	])('refuses %s', (_label, apiKey) => {
		expect(difySecretsSchema.safeParse({ apiKey }).success).toBe(false)
	})
	// Spec §2.3: on an edit a blank secret field keeps the stored value, so the form's blank becomes "not given".
	it('reads a blank key on an edit as not given', () => {
		expect(difySecretsUpdateSchema.parse({ apiKey: '' })).toEqual({ apiKey: undefined })
		expect(difySecretsUpdateSchema.parse({ apiKey: '   ' })).toEqual({ apiKey: undefined })
		expect(difySecretsUpdateSchema.parse({})).toEqual({ apiKey: undefined })
		expect(difySecretsUpdateSchema.parse({ apiKey: ' app-new ' })).toEqual({ apiKey: 'app-new' })
		expect(difySecretsUpdateSchema.safeParse({ apiKey: 'a'.repeat(256) }).success).toBe(false)
	})
})

describe('checkDocuments (spec §2.3)', () => {
	it('reads both documents with the provider’s schemas', () => {
		expect(checkDocuments('dify', settings, { apiKey: 'app-k' })).toEqual({
			ok: true,
			documents: { provider: 'dify', settings, secrets: { apiKey: 'app-k' } },
		})
	})
	// DV 11: an id the hub does not know fails closed.
	it('refuses an unknown provider', () => {
		expect(checkDocuments('openai', settings, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'unknown_provider',
		})
	})
	// Part 2 spec §2.2: an AG-UI app's documents go through the same reads.
	it('reads an AG-UI app’s documents with its own schemas', () => {
		const agui = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
		const jwtSecret = 'k'.repeat(32)
		expect(checkDocuments('agui', agui, { jwtSecret })).toEqual({
			ok: true,
			documents: {
				provider: 'agui',
				settings: { ...agui, askUser: false },
				secrets: { jwtSecret },
			},
		})
		expect(checkDocuments('agui', settings, { jwtSecret })).toEqual({
			ok: false,
			code: 'invalid_settings',
		})
		expect(checkDocuments('agui', agui, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'invalid_secrets',
		})
	})
	it('says which document failed', () => {
		expect(checkDocuments('dify', { ...settings, appType: null }, { apiKey: 'app-k' })).toEqual({
			ok: false,
			code: 'invalid_settings',
		})
		expect(checkDocuments('dify', settings, { apiKey: '' })).toEqual({
			ok: false,
			code: 'invalid_secrets',
		})
		expect(checkDocuments('dify', settings, null)).toEqual({ ok: false, code: 'invalid_secrets' })
	})
})

// Plan decision ab: the reads that build a user's DTO never select the secrets, so they check the settings alone.
describe('checkSettings', () => {
	it('reads the settings with the provider’s schema', () => {
		expect(checkSettings('dify', settings)).toEqual({
			ok: true,
			documents: { provider: 'dify', settings },
		})
	})
	it('refuses an unknown provider and broken settings', () => {
		expect(checkSettings('openai', settings)).toEqual({ ok: false, code: 'unknown_provider' })
		expect(checkSettings('dify', { ...settings, apiBase: 'nope' })).toEqual({
			ok: false,
			code: 'invalid_settings',
		})
	})
})

describe('mergeSecrets (spec §2.3: a blank secret keeps the stored one)', () => {
	it('keeps the stored fields the update leaves out and replaces the ones it gives', () => {
		expect(mergeSecrets({ apiKey: 'app-old' }, { apiKey: undefined })).toEqual({
			apiKey: 'app-old',
		})
		expect(mergeSecrets({ apiKey: 'app-old' }, { apiKey: 'app-new' })).toEqual({
			apiKey: 'app-new',
		})
	})
	it('starts from nothing when the stored document is not an object', () => {
		expect(mergeSecrets(null, { apiKey: undefined })).toEqual({})
		expect(mergeSecrets('x', { apiKey: 'app-new' })).toEqual({ apiKey: 'app-new' })
	})
})
