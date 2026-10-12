import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IAgentMessage } from '@/lib/api'
import { CustomProvider } from '@/hooks/useX/x-provider'

// The provider persists workflow progress to IndexedDB, which does not exist in the node test environment.
vi.mock('@/hooks/useX/workflow-data-storage', () => ({
	default: { set: vi.fn(), get: vi.fn() },
}))

// Every Dify stream event carries message_id and created_at (StreamEventBase in Dify's OpenAPI spec).
const streamEvent = (event: string, extra: Record<string, unknown> = {}) => ({
	data: JSON.stringify({
		event,
		conversation_id: 'conversation-1',
		message_id: 'message-1',
		task_id: 'task-1',
		created_at: 1760000000,
		data: { id: 'node-1', node_type: 'llm', title: 'LLM' },
		...extra,
	}),
})

describe('CustomProvider message identity', () => {
	let provider: CustomProvider

	const feed = (...chunks: { data: string }[]) => {
		let originMessage: unknown
		for (const chunk of chunks) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			originMessage = provider.transformMessage({ originMessage, chunk } as any)
		}
		return originMessage as IAgentMessage
	}

	beforeEach(() => {
		vi.stubGlobal('window', { location: { pathname: '/chat/app-1' } })
		provider = new CustomProvider({ request: { manual: true, options: {} } })
	})

	it('keeps the Dify message id and creation time from a message event', () => {
		const message = feed(streamEvent('message', { answer: 'Hello' }))

		expect(message.id).toBe('message-1')
		expect(message.createdAt).toBe(1760000000)
	})

	it('keeps them across the rest of the stream, including message_end', () => {
		const message = feed(
			streamEvent('message', { answer: 'Hello' }),
			streamEvent('message', { answer: ' there' }),
			streamEvent('message_end', { metadata: { usage: { latency: 1.2 } } }),
		)

		expect(message.id).toBe('message-1')
		expect(message.createdAt).toBe(1760000000)
		expect(message.content).toBe('Hello there')
	})

	it('keeps them for an agent app, whose text arrives as agent_message events', () => {
		const message = feed(
			streamEvent('agent_thought', { id: 'thought-1', position: 1, thought: '' }),
			streamEvent('agent_message', { answer: 'Hi' }),
		)

		expect(message.id).toBe('message-1')
		expect(message.createdAt).toBe(1760000000)
	})

	it('keeps them for a chatflow, where workflow events arrive before the first message event', () => {
		const message = feed(
			streamEvent('workflow_started'),
			streamEvent('node_started'),
			streamEvent('message', { answer: 'Hello' }),
			streamEvent('workflow_finished'),
		)

		expect(message.id).toBe('message-1')
		expect(message.createdAt).toBe(1760000000)
	})
})
