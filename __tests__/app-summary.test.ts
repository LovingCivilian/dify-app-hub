import { describe, expect, it } from 'vitest'

import { toAppSummaries } from '@/components/apps/app-summary'
import { AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

const item = (over: Partial<IDifyAppItem> = {}): IDifyAppItem => ({
	id: 'a1',
	info: { name: 'Alpha', mode: AppModeEnums.CHATBOT, description: 'First app', tags: ['support'] },
	isEnabled: EIsEnabled.enabled,
	requestConfig: { apiBase: 'https://dify.example/v1', apiKey: 'app-secret' },
	...over,
})

describe('toAppSummaries', () => {
	it('keeps enabled apps and drops disabled ones, as /chat does', () => {
		const result = toAppSummaries([item(), item({ id: 'a2', isEnabled: EIsEnabled.disabled })])
		expect(result.map(app => app.id)).toEqual(['a1'])
	})

	it('trims each app to what a card shows', () => {
		expect(toAppSummaries([item()])).toEqual([
			{
				id: 'a1',
				missingInfo: false,
				name: 'Alpha',
				description: 'First app',
				mode: AppModeEnums.CHATBOT,
				tags: ['support'],
			},
		])
		expect(JSON.stringify(toAppSummaries([item()]))).not.toMatch(/app-secret|dify\.example/)
	})

	it('marks a row without info and defaults a missing description and tags', () => {
		expect(toAppSummaries([item({ info: undefined as unknown as IDifyAppItem['info'] })])).toEqual([
			{ id: 'a1', missingInfo: true },
		])
		const bare = item({
			info: { name: 'Bare' } as unknown as IDifyAppItem['info'],
		})
		expect(toAppSummaries([bare])[0]).toMatchObject({ description: '', tags: [] })
	})
})
