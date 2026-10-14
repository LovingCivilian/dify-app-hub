import { describe, expect, it } from 'vitest'

import {
	DEFAULT_APP_FORM_VALUES,
	providerDefaults,
	toAppFormData,
	toAppFormValues,
} from '@/components/admin/apps/app-form-values'
import type { AdminAppDto } from '@/lib/data/apps'
import { PROVIDER_SCHEMAS } from '@/lib/providers/schemas'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat' as const,
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	enableUpdateAfterConversationStarts: true,
	openingStatementDisplayMode: 'always' as const,
}
const access = { mode: 'restricted' as const, groupIds: ['g1'], userIds: ['u1'] }
const common = {
	id: 'a1',
	provider: 'dify' as const,
	name: 'Alpha',
	description: 'An app',
	tags: ['t'],
	enabled: false,
	hasIcon: false,
	access,
	createdAt: '',
	updatedAt: '',
}
const app: AdminAppDto = { ...common, invalid: false, settings, secretsSet: { apiKey: true } }

describe('the drawer’s values (spec §4.1)', () => {
	it('start a new app with no provider and closed (B3 spec §2 #9)', () => {
		expect(DEFAULT_APP_FORM_VALUES).toEqual({
			name: '',
			description: '',
			tags: [],
			enabled: true,
			access: { mode: 'restricted', groupIds: [], userIds: [] },
		})
	})
	it('give a picked provider its defaults, as a copy', () => {
		const defaults = providerDefaults('dify')
		expect(defaults).toEqual({
			settings: PROVIDER_SCHEMAS.dify.defaultSettings,
			secrets: { apiKey: '' },
		})
		expect(defaults.settings).not.toBe(PROVIDER_SCHEMAS.dify.defaultSettings)
	})
	it('fill the form from a saved app, with the key left blank (a blank keeps it)', () => {
		expect(toAppFormValues(app)).toEqual({
			provider: 'dify',
			name: 'Alpha',
			description: 'An app',
			tags: ['t'],
			enabled: false,
			access,
			settings,
			secrets: { apiKey: '' },
		})
	})
	// Spec §2.3: an invalid row opens on its provider's defaults, so the admin can repair it.
	it('open an invalid app on its provider’s defaults', () => {
		expect(toAppFormValues({ ...common, invalid: true }).settings).toEqual(
			PROVIDER_SCHEMAS.dify.defaultSettings,
		)
	})
	// Part 2 spec §2.5 (issue #62's M5): an invalid app whose settings still read opens on them, the secret blank.
	it('open an invalid app on its stored settings when they still read', () => {
		expect(toAppFormValues({ ...common, invalid: true, settings })).toMatchObject({
			settings,
			secrets: { apiKey: '' },
		})
	})
	it('travel to the action as JSON with the icon intent, and the file only when it is replaced', () => {
		const keep = toAppFormData(toAppFormValues(app), { intent: 'keep' })
		expect(JSON.parse(String(keep.get('values')))).toMatchObject({
			provider: 'dify',
			name: 'Alpha',
		})
		expect(keep.get('iconIntent')).toBe('keep')
		expect(keep.has('icon')).toBe(false)
		const file = new File([new Uint8Array([1])], 'icon.png', { type: 'image/png' })
		const replace = toAppFormData(toAppFormValues(app), { intent: 'replace', file, url: 'blob:x' })
		expect(replace.get('iconIntent')).toBe('replace')
		expect((replace.get('icon') as File).name).toBe('icon.png')
	})
})
