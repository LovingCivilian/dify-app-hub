import { describe, expect, it, vi } from 'vitest'

import {
	historyIds,
	mapHistoryPage,
	type HistoryFile,
	type HistoryMessage,
	type HistoryThought,
} from '@/components/chat/provider/history'
import type { WorkflowState } from '@/components/chat/provider/message'

// Fixtures follow the Dify OpenAPI document (ConversationMessageItem, MessageFileItem, AgentThoughtItem).
const item = (overrides: Partial<HistoryMessage> = {}): HistoryMessage => ({
	id: 'm1',
	conversation_id: 'c1',
	inputs: { topic: 'tea' },
	query: 'How is tea brewed?',
	answer: 'At 80 °C.',
	message_files: [],
	feedback: null,
	status: 'normal',
	error: null,
	agent_thoughts: [],
	retriever_resources: [],
	created_at: 1_700_000_000,
	...overrides,
})
const file = (overrides: Partial<HistoryFile> = {}): HistoryFile => ({
	id: 'f1',
	filename: 'a.png',
	type: 'image',
	url: '/a.png',
	mime_type: 'image/png',
	size: 1,
	transfer_method: 'local_file',
	belongs_to: 'user',
	upload_file_id: 'u1',
	...overrides,
})
const thought = (overrides: Partial<HistoryThought> = {}): HistoryThought => ({
	id: 't1',
	message_id: 'm1',
	position: 1,
	thought: 'I should look it up.',
	tool: 'search',
	tool_input: '{"q":"tea"}',
	tool_labels: { search: { en_US: 'Search' } },
	observation: 'Tea is brewed at 80 °C.',
	files: ['f9'],
	chain_id: null,
	created_at: 1_700_000_000,
	...overrides,
})
const ctx = { loadWorkflow: async () => undefined }

describe('mapHistoryPage', () => {
	it('keeps Dify’s oldest-first page order: one user and one assistant message per Dify message', async () => {
		// GET /messages answers each page oldest first (Dify MessageService.pagination_by_first_id, order "asc").
		const page = await mapHistoryPage([item(), item({ id: 'm2', created_at: 1_700_000_100 })], ctx)
		expect(page.map(m => m.id)).toEqual(['m1:q', 'm1:a', 'm2:q', 'm2:a'])
		expect(page[0]).toMatchObject({
			status: 'success',
			message: {
				role: 'user',
				content: 'How is tea brewed?',
				inputs: { topic: 'tea' },
				ids: { messageId: 'm1', conversationId: 'c1' },
				createdAt: 1_700_000_000,
			},
		})
		expect(page[1]).toMatchObject({
			status: 'success',
			message: {
				role: 'assistant',
				content: 'At 80 °C.',
				ids: { messageId: 'm1', conversationId: 'c1' },
				createdAt: 1_700_000_000,
			},
		})
		expect(page[1].message.error).toBeUndefined()
	})

	it('does not reorder or reverse a page, also for messages created in the same second', async () => {
		const page = await mapHistoryPage(
			[item({ id: 'mb' }), item({ id: 'ma' }), item({ id: 'mc', created_at: 1_699_999_000 })],
			ctx,
		)
		expect(page.filter(m => m.message.role === 'user').map(m => m.message.ids.messageId)).toEqual([
			'mb',
			'ma',
			'mc',
		])
	})

	it('maps an empty page to an empty list', async () => {
		expect(await mapHistoryPage([], ctx)).toEqual([])
	})

	it('splits files by owner and maps the nullable fields', async () => {
		const [user, assistant] = await mapHistoryPage(
			[
				item({
					message_files: [
						file(),
						file({
							id: 'f2',
							filename: 'b.png',
							url: null,
							mime_type: null,
							size: null,
							transfer_method: 'tool_file',
							belongs_to: 'assistant',
							upload_file_id: null,
						}),
					],
				}),
			],
			ctx,
		)
		expect(user.message.files).toEqual([
			{
				id: 'f1',
				type: 'image',
				url: '/a.png',
				belongsTo: 'user',
				filename: 'a.png',
				size: 1,
				mimeType: 'image/png',
				uploadFileId: 'u1',
			},
		])
		expect(assistant.message.files).toEqual([
			{ id: 'f2', type: 'image', url: '', belongsTo: 'assistant', filename: 'b.png' },
		])
	})

	it('shows a file without an owner on the assistant, like the message_file stream event', async () => {
		const [user, assistant] = await mapHistoryPage(
			[item({ message_files: [file({ belongs_to: null })] })],
			ctx,
		)
		expect(user.message.files).toEqual([])
		expect(assistant.message.files?.map(f => f.id)).toEqual(['f1'])
	})

	it.each([
		[{ rating: 'like' }, 'like'],
		[{ rating: 'dislike' }, 'dislike'],
		[{ rating: 'unexpected' }, null],
		[null, null],
		[undefined, null],
	] as const)('maps the feedback %j to %j', async (feedback, expected) => {
		const [, assistant] = await mapHistoryPage([item({ feedback })], ctx)
		expect(assistant.message.feedback).toBe(expected)
	})

	it('maps agent thoughts to the live thought shape and keeps citations', async () => {
		const [, assistant] = await mapHistoryPage(
			[item({ agent_thoughts: [thought()], retriever_resources: [{ id: 'rr1' } as never] })],
			ctx,
		)
		expect(assistant.message.thoughts).toEqual([
			expect.objectContaining({
				id: 't1',
				message_id: 'm1',
				conversation_id: 'c1',
				position: 1,
				thought: 'I should look it up.',
				tool: 'search',
				tool_input: '{"q":"tea"}',
				observation: 'Tea is brewed at 80 °C.',
				message_files: ['f9'],
				created_at: 1_700_000_000,
			}),
		])
		expect(assistant.message.citations).toEqual([{ id: 'rr1' }])
	})

	it('treats absent file, thought and citation lists as empty', async () => {
		const [user, assistant] = await mapHistoryPage(
			[
				item({
					message_files: undefined,
					agent_thoughts: undefined,
					retriever_resources: undefined,
				}),
			],
			ctx,
		)
		expect(user.message.files).toEqual([])
		expect(assistant.message).toMatchObject({ files: [], thoughts: [], citations: [] })
	})

	// Review Focus 3: a failed history turn is an error bubble, never the "empty answer" state.
	it('maps an errored message to an error on the assistant bubble and keeps the user turn', async () => {
		const [user, assistant] = await mapHistoryPage(
			[item({ answer: '', status: 'error', error: 'Rate limited' })],
			ctx,
		)
		expect(user).toMatchObject({
			status: 'success',
			message: { role: 'user', content: 'How is tea brewed?' },
		})
		expect(assistant).toMatchObject({
			status: 'success',
			message: { role: 'assistant', content: '' },
		})
		expect(assistant.message.error).toEqual({ message: 'Rate limited' })
	})

	it('still marks the assistant bubble as failed when Dify gave no error text', async () => {
		// Same as the live `error` event: an empty message is mapped to an i18n key by the UI.
		const [, assistant] = await mapHistoryPage(
			[item({ answer: '', status: 'error', error: null })],
			ctx,
		)
		expect(assistant.message.error).toEqual({ message: '' })
	})

	it('attaches persisted workflow nodes to the assistant message only', async () => {
		const workflow: WorkflowState = {
			status: 'finished',
			nodes: [{ id: 'n1', nodeId: 'a', type: 'llm', title: 'Answer', status: 'success' }],
		}
		const loadWorkflow = vi.fn(async (id: string) => (id === 'm1' ? workflow : undefined))
		const page = await mapHistoryPage([item(), item({ id: 'm2' })], { loadWorkflow })
		expect(page[0].message.workflow).toBeUndefined()
		expect(page[1].message.workflow).toEqual(workflow)
		expect(page[3].message.workflow).toBeUndefined()
		expect(loadWorkflow.mock.calls.map(call => call[0])).toEqual(['m1', 'm2'])
	})

	it('maps the page without workflow nodes when the loader rejects for one message', async () => {
		const workflow: WorkflowState = { status: 'finished', nodes: [] }
		const loadWorkflow = vi.fn(async (id: string) => {
			if (id === 'm2') throw new Error('IndexedDB is blocked')
			return workflow
		})
		const page = await mapHistoryPage([item(), item({ id: 'm2' }), item({ id: 'm3' })], {
			loadWorkflow,
		})
		expect(page.map(m => m.id)).toEqual(['m1:q', 'm1:a', 'm2:q', 'm2:a', 'm3:q', 'm3:a'])
		expect(page[1].message.workflow).toEqual(workflow)
		expect(page[3].message.workflow).toBeUndefined()
		expect(page[3].message.content).toBe('At 80 °C.')
		expect(page[5].message.workflow).toEqual(workflow)
	})

	it('also tolerates a loader that throws before returning a promise', async () => {
		const loadWorkflow = () => {
			throw new Error('store unavailable')
		}
		const page = await mapHistoryPage([item()], { loadWorkflow })
		expect(page.map(m => m.id)).toEqual(['m1:q', 'm1:a'])
		expect(page[1].message.workflow).toBeUndefined()
	})

	it('derives stable ids', () => {
		expect(historyIds('m9')).toEqual({ user: 'm9:q', assistant: 'm9:a' })
	})
})
