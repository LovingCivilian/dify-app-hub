import { describe, expect, it } from 'vitest'

import { toBubbleItems } from '@/components/chat/hooks/bubble-items'
import { emptyAssistant } from '@/components/chat/provider/message'

describe('toBubbleItems', () => {
	it('maps SDK message infos to Bubble.List items with streaming and loading flags', () => {
		const items = toBubbleItems([
			{ id: 'u1', status: 'local', message: { role: 'user', content: 'hi', ids: {} } },
			{ id: 'a1', status: 'loading', message: emptyAssistant() },
			{ id: 'a2', status: 'updating', message: { ...emptyAssistant(), content: 'He' } },
			{ id: 'a3', status: 'success', message: { ...emptyAssistant(), content: 'Hello' } },
		])
		expect(items.map(i => [i.key, i.role, i.loading, i.streaming])).toEqual([
			['u1', 'user', false, false],
			['a1', 'assistant', true, false],
			['a2', 'assistant', false, true],
			['a3', 'assistant', false, false],
		])
		expect(items[3].content).toMatchObject({ content: 'Hello' })
	})

	it('keeps a resumed HITL message visible while the continuation connects', () => {
		// onReload marks the paused message `loading` with the requestPlaceholder, which is the message itself.
		const paused = {
			...emptyAssistant(),
			workflow: { runId: 'run-1', status: 'paused' as const, nodes: [] },
			humanInput: {
				state: 'pending' as const,
				formToken: 'form-1',
				formContent: 'Approve?',
				inputs: [],
				actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
				defaults: {},
				expiresAt: 0,
				workflowRunId: 'run-1',
			},
		}
		const [resumed, placeholder] = toBubbleItems([
			{ id: 'a1', status: 'loading', message: paused },
			{ id: 'a2', status: 'loading', message: emptyAssistant() },
		])
		expect(resumed.loading).toBe(false)
		expect(placeholder.loading).toBe(true)
	})
})
