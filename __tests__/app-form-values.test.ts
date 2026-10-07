import { describe, expect, it } from 'vitest'

import { DEFAULT_APP_FORM_VALUES, toAppFormValues } from '@/components/admin/apps/app-form-values'
import type { AppDto } from '@/lib/data/apps'

const settings = {
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: true,
	openingStatementDisplayMode: 'always' as const,
	annotationEnabled: true,
}
const app: AppDto = {
	id: 'a1',
	name: 'Alpha',
	mode: 'advanced-chat',
	description: '',
	tags: [],
	enabled: false,
	icon: null,
	settings,
	apiBase: 'https://dify.example/v1',
	createdAt: '',
	updatedAt: '',
}

describe('toAppFormValues', () => {
	it('fills the form from a saved app, with the key left blank (blank keeps it)', () => {
		expect(toAppFormValues(app)).toEqual({
			apiBase: 'https://dify.example/v1',
			apiKey: '',
			mode: 'advanced-chat',
			enabled: false,
			settings,
		})
	})
	it('falls back to chat for an app without a known mode', () => {
		expect(toAppFormValues({ ...app, mode: null }).mode).toBe('chat')
	})
	it('starts a new app enabled, as a chatbot, with every setting off', () => {
		expect(DEFAULT_APP_FORM_VALUES).toEqual({
			apiBase: '',
			apiKey: '',
			mode: 'chat',
			enabled: true,
			settings: {
				answerForm: { enabled: false, feedbackText: '' },
				enableUpdateAfterConversationStarts: false,
				openingStatementDisplayMode: 'default',
				annotationEnabled: false,
			},
		})
	})
})
