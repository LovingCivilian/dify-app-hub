import { describe, expect, it } from 'vitest'

import { toAppSummaries } from '@/components/apps/app-summary'
import type { AppDto } from '@/lib/data/apps'

const settings = {
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default' as const,
	annotationEnabled: false,
}
const app = (over: Partial<AppDto> = {}): AppDto => ({
	id: 'a1',
	name: 'Alpha',
	mode: 'chat',
	description: 'First app',
	tags: ['support'],
	enabled: true,
	icon: { kind: 'emoji', emoji: '🍵', background: null },
	settings,
	apiBase: 'https://dify.example/v1',
	createdAt: '2026-10-07T00:00:00.000Z',
	updatedAt: '2026-10-07T00:00:00.000Z',
	...over,
})

describe('toAppSummaries', () => {
	it('keeps enabled apps and drops disabled ones, as /chat does', () => {
		expect(toAppSummaries([app(), app({ id: 'a2', enabled: false })]).map(a => a.id)).toEqual([
			'a1',
		])
	})
	it('trims each app to what a card shows, the icon included, the base left out', () => {
		expect(toAppSummaries([app()])).toEqual([
			{
				id: 'a1',
				name: 'Alpha',
				description: 'First app',
				mode: 'chat',
				tags: ['support'],
				icon: { kind: 'emoji', emoji: '🍵', background: null },
			},
		])
		expect(JSON.stringify(toAppSummaries([app()]))).not.toContain('dify.example')
	})
})
