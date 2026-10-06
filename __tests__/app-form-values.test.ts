import { describe, expect, it } from 'vitest'

import {
	DEFAULT_APP_FORM_VALUES,
	fromAppFormValues,
	statusSwitchProps,
	toAppFormValues,
} from '@/components/admin/apps/app-form-values'
import { AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

const saved: IDifyAppItem = {
	id: 'a1',
	info: { name: 'Alpha', mode: AppModeEnums.CHATFLOW, description: 'd', tags: ['t'] },
	isEnabled: EIsEnabled.disabled,
	requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-real' },
	answerForm: { enabled: true, feedbackText: 'Thanks' },
	inputParams: { enableUpdateAfterCvstStarts: true },
	extConfig: {
		conversation: { openingStatement: { displayMode: 'always' } },
		annotation: { enabled: true },
	},
}

describe('toAppFormValues', () => {
	it('fills the form from a saved app', () => {
		expect(toAppFormValues(saved)).toEqual({
			requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-real' },
			info: { mode: AppModeEnums.CHATFLOW },
			isEnabled: EIsEnabled.disabled,
			inputParams: { enableUpdateAfterCvstStarts: true },
			extConfig: {
				conversation: { openingStatement: { displayMode: 'always' } },
				annotation: { enabled: true },
			},
			answerForm: { enabled: true, feedbackText: 'Thanks' },
		})
	})

	it('fills missing settings with the create defaults', () => {
		const bare = {
			id: 'a2',
			info: { name: 'Bare', description: '', tags: [] },
			isEnabled: EIsEnabled.enabled,
			requestConfig: { apiBase: 'https://b/v1', apiKey: 'app-b' },
		} as IDifyAppItem
		expect(toAppFormValues(bare)).toEqual({
			...DEFAULT_APP_FORM_VALUES,
			requestConfig: { apiBase: 'https://b/v1', apiKey: 'app-b' },
		})
	})
})

describe('fromAppFormValues', () => {
	const info = { name: 'From Dify', description: 'desc', tags: ['x'], mode: AppModeEnums.AGENT }

	it("builds the item from the form and Dify's app info, keeping Dify's mode", () => {
		expect(fromAppFormValues(toAppFormValues(saved), info)).toEqual({
			info,
			isEnabled: EIsEnabled.disabled,
			requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-real' },
			answerForm: { enabled: true, feedbackText: 'Thanks' },
			inputParams: { enableUpdateAfterCvstStarts: true },
			extConfig: {
				conversation: { openingStatement: { displayMode: 'always' } },
				annotation: { enabled: true },
			},
		})
	})

	it("falls back to the form's mode when Dify reports none", () => {
		const withoutMode = { name: info.name, description: info.description, tags: info.tags }
		expect(fromAppFormValues(toAppFormValues(saved), withoutMode).info.mode).toBe(
			AppModeEnums.CHATFLOW,
		)
	})

	it('keeps an empty feedback text when the form reply field is not rendered', () => {
		const values = { ...DEFAULT_APP_FORM_VALUES, answerForm: { enabled: false } }
		expect(fromAppFormValues(values, info).answerForm).toEqual({ enabled: false, feedbackText: '' })
	})
})

describe('statusSwitchProps', () => {
	it('shows enabled and a missing status as on, disabled as off', () => {
		expect(statusSwitchProps.getValueProps(EIsEnabled.enabled)).toEqual({ checked: true })
		expect(statusSwitchProps.getValueProps(undefined)).toEqual({ checked: true })
		expect(statusSwitchProps.getValueProps(EIsEnabled.disabled)).toEqual({ checked: false })
	})

	it('stores on as 1 and off as 2', () => {
		expect(statusSwitchProps.normalize(true)).toBe(EIsEnabled.enabled)
		expect(statusSwitchProps.normalize(false)).toBe(EIsEnabled.disabled)
	})
})
