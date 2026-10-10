import { describe, expect, it } from 'vitest'

import { DEFAULT_APP_FORM_VALUES, toAppFormValues } from '@/components/admin/apps/app-form-values'
import type { AdminAppDto } from '@/lib/data/apps'

const settings = {
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: true,
	openingStatementDisplayMode: 'always' as const,
	annotationEnabled: true,
}
const access = { mode: 'restricted' as const, groupIds: ['g1'], userIds: ['u1'] }
const app: AdminAppDto = {
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
	access,
}

describe('toAppFormValues', () => {
	it('fills the form from a saved app, with the key left blank (blank keeps it) and its access', () => {
		expect(toAppFormValues(app)).toEqual({
			apiBase: 'https://dify.example/v1',
			apiKey: '',
			mode: 'advanced-chat',
			enabled: false,
			settings,
			access,
		})
	})
	it('falls back to chat for an app without a known mode', () => {
		expect(toAppFormValues({ ...app, mode: null }).mode).toBe('chat')
	})
	// Spec §2 #9: a new app is closed until the admin opens it, restricted with no grant (admins only).
	it('starts a new app enabled, as a chatbot, with every setting off and closed to users', () => {
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
			access: { mode: 'restricted', groupIds: [], userIds: [] },
		})
	})
})
