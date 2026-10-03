import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomProvider } from '@/hooks/useX/x-provider'

// The provider persists workflow progress to IndexedDB, which does not exist in the node test environment.
vi.mock('@/hooks/useX/workflow-data-storage', () => ({
	default: { set: vi.fn(), get: vi.fn() },
}))

const streamEvent = (
	event: string,
	conversationId: string,
	extra: Record<string, unknown> = {},
) => ({
	data: JSON.stringify({
		event,
		conversation_id: conversationId,
		message_id: 'message-1',
		task_id: 'task-1',
		data: { id: 'node-1', node_type: 'agent', title: 'Agent' },
		...extra,
	}),
})

describe('CustomProvider conversation id reporting', () => {
	let onConversationIdChange = vi.fn<(conversationId: string) => void>()
	let provider: CustomProvider

	const feed = (...chunks: { data: string }[]) => {
		let originMessage: unknown
		for (const chunk of chunks) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			originMessage = provider.transformMessage({ originMessage, chunk } as any)
		}
	}

	beforeEach(() => {
		vi.stubGlobal('window', { location: { pathname: '/chat/app-1' } })
		onConversationIdChange = vi.fn<(conversationId: string) => void>()
		// The base class only requires a manual request object; no network call is made in these tests.
		provider = new CustomProvider({
			onConversationIdChange,
			request: { manual: true, options: {} },
		})
	})

	it('reports the conversation id for a chatflow, where workflow events arrive before the first message event', () => {
		feed(
			streamEvent('workflow_started', 'conversation-1'),
			streamEvent('node_started', 'conversation-1'),
			streamEvent('message', 'conversation-1', { answer: 'Hello' }),
		)

		expect(onConversationIdChange).toHaveBeenCalledTimes(1)
		expect(onConversationIdChange).toHaveBeenCalledWith('conversation-1')
	})

	it('reports the conversation id for a plain chat app, where the message event comes first', () => {
		feed(streamEvent('message', 'conversation-1', { answer: 'Hello' }))

		expect(onConversationIdChange).toHaveBeenCalledTimes(1)
		expect(onConversationIdChange).toHaveBeenCalledWith('conversation-1')
	})

	it('does not report on workflow events alone', () => {
		feed(
			streamEvent('workflow_started', 'conversation-1'),
			streamEvent('node_started', 'conversation-1'),
		)

		expect(onConversationIdChange).not.toHaveBeenCalled()
	})

	it('reports once per conversation, not once per message', () => {
		feed(
			streamEvent('workflow_started', 'conversation-1'),
			streamEvent('message', 'conversation-1', { answer: 'Hello' }),
			streamEvent('message', 'conversation-1', { answer: ' there' }),
			streamEvent('workflow_started', 'conversation-1'),
			streamEvent('message', 'conversation-1', { answer: 'Second reply' }),
		)

		expect(onConversationIdChange).toHaveBeenCalledTimes(1)
	})

	it('reports again when a later chatflow reply belongs to a different conversation', () => {
		feed(
			streamEvent('workflow_started', 'conversation-1'),
			streamEvent('message', 'conversation-1', { answer: 'Hello' }),
			streamEvent('workflow_started', 'conversation-2'),
			streamEvent('message', 'conversation-2', { answer: 'Hi' }),
		)

		expect(onConversationIdChange).toHaveBeenCalledTimes(2)
		expect(onConversationIdChange).toHaveBeenLastCalledWith('conversation-2')
	})
})
