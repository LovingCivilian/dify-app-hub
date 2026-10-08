import { describe, expect, it } from 'vitest'

import { appInputSchema, createAppInputSchema } from '@/app/(admin)/app-management/schemas'

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
	it('accepts every Dify mode, the new agent app included', () => {
		for (const mode of ['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion', 'agent']) {
			expect(appInputSchema.safeParse({ ...valid, mode }).success).toBe(true)
		}
	})
})
