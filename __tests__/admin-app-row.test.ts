import { describe, expect, it } from 'vitest'

import { supportsAnnotations, toAdminAppRows } from '@/components/admin/apps/admin-app-row'
import { AppModeEnums, EIsEnabled } from '@/lib/core'

describe('toAdminAppRows', () => {
	it('trims each app to the table columns and keeps its status', () => {
		const rows = toAdminAppRows([
			{
				id: 'a1',
				info: { name: 'Alpha', mode: AppModeEnums.WORKFLOW, description: 'Runs', tags: ['ops'] },
				isEnabled: EIsEnabled.disabled,
				requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-***' },
			} as never,
		])
		expect(rows).toEqual([
			{
				id: 'a1',
				name: 'Alpha',
				mode: AppModeEnums.WORKFLOW,
				description: 'Runs',
				tags: ['ops'],
				isEnabled: EIsEnabled.disabled,
			},
		])
	})

	it('gives a row without info empty fields', () => {
		expect(
			toAdminAppRows([{ id: 'a2', info: undefined as never, isEnabled: EIsEnabled.enabled }]),
		).toEqual([{ id: 'a2', name: '', mode: undefined, description: '', tags: [], isEnabled: 1 }])
	})
})

describe('supportsAnnotations', () => {
	it('is true for the modes Dify documents annotations for', () => {
		expect(supportsAnnotations(AppModeEnums.CHATBOT)).toBe(true)
		expect(supportsAnnotations(AppModeEnums.CHATFLOW)).toBe(true)
		expect(supportsAnnotations(AppModeEnums.AGENT)).toBe(true)
	})

	it('is false for workflow, completion and an unknown mode', () => {
		expect(supportsAnnotations(AppModeEnums.WORKFLOW)).toBe(false)
		expect(supportsAnnotations(AppModeEnums.TEXT_GENERATOR)).toBe(false)
		expect(supportsAnnotations(undefined)).toBe(false)
	})
})
