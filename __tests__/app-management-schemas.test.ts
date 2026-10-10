import { describe, expect, it } from 'vitest'

import {
	accessSchema,
	appInputSchema,
	createAppInputSchema,
} from '@/app/(admin)/app-management/schemas'

const valid = {
	apiBase: 'https://dify.example/v1',
	apiKey: 'app-abc',
	mode: 'chat',
	enabled: true,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	},
	access: { mode: 'restricted', groupIds: [], userIds: [] },
}

describe('app input schemas', () => {
	it('accepts a full input and strips unknown keys', () => {
		const parsed = createAppInputSchema.safeParse({ ...valid, extra: 'x' })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data).toEqual(valid)
	})
	it('requires the key on create and lets it be blank on update', () => {
		expect(createAppInputSchema.safeParse({ ...valid, apiKey: '' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, apiKey: '' }).success).toBe(true)
		expect(appInputSchema.safeParse({ ...valid, apiKey: undefined }).success).toBe(true)
	})
	it('refuses a non-http base, an unknown mode and a bad display mode', () => {
		expect(appInputSchema.safeParse({ ...valid, apiBase: 'ftp://x/v1' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, apiBase: 'not a url' }).success).toBe(false)
		expect(appInputSchema.safeParse({ ...valid, mode: 'rag-pipeline' }).success).toBe(false)
		expect(
			appInputSchema.safeParse({
				...valid,
				settings: { ...valid.settings, openingStatementDisplayMode: 'never' },
			}).success,
		).toBe(false)
	})
	// Spec §2 #9: closed by default, so the form always says who may use the app.
	it('refuses an input without its access settings', () => {
		expect(appInputSchema.safeParse({ ...valid, access: undefined }).success).toBe(false)
		expect(createAppInputSchema.safeParse({ ...valid, access: undefined }).success).toBe(false)
	})
	it('accepts every Dify mode, the new agent app included', () => {
		for (const mode of ['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion', 'agent']) {
			expect(appInputSchema.safeParse({ ...valid, mode }).success).toBe(true)
		}
	})
})

describe('accessSchema (B3 spec §4.4)', () => {
	const groupId = '6f1c2a9e-1b2c-4d3e-8f40-5a6b7c8d9e0f'

	it('defaults the grant lists and takes the two modes only', () => {
		expect(accessSchema.parse({ mode: 'restricted' })).toEqual({
			mode: 'restricted',
			groupIds: [],
			userIds: [],
		})
		expect(accessSchema.safeParse({ mode: 'public' }).success).toBe(false)
	})

	it('takes UUID group ids and account ids by B2 decision h', () => {
		expect(
			accessSchema.safeParse({ mode: 'restricted', groupIds: [groupId], userIds: ['legacy-1'] })
				.success,
		).toBe(true)
		expect(accessSchema.safeParse({ mode: 'restricted', groupIds: ['g1'] }).success).toBe(false)
		expect(accessSchema.safeParse({ mode: 'restricted', userIds: [''] }).success).toBe(false)
	})
})
