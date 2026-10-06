import { describe, expect, it, vi } from 'vitest'

import { applyEvent, DifyChatProvider } from '@/components/chat/provider/dify-chat-provider'
import {
	emptyAssistant,
	type DifyChatMessage,
	type DifyStreamEvent,
} from '@/components/chat/provider/message'

const base = {
	task_id: 'task-1',
	message_id: 'msg-1',
	conversation_id: 'conv-1',
	created_at: 1_700_000_000,
}
const ev = (event: string, extra: Record<string, unknown> = {}): DifyStreamEvent => ({
	event,
	...base,
	...extra,
})
const chunk = (event: DifyStreamEvent) => ({ data: JSON.stringify(event) })

const feed = (provider: DifyChatProvider, events: DifyStreamEvent[], origin?: DifyChatMessage) => {
	let message = origin
	for (const event of events) {
		message = provider.transformMessage({
			originMessage: message,
			chunk: chunk(event),
			chunks: [],
			status: 'updating',
			responseHeaders: new Headers(),
		})
	}
	return message!
}

const makeProvider = (overrides: Partial<ConstructorParameters<typeof DifyChatProvider>[0]> = {}) =>
	new DifyChatProvider({
		// AbstractChatProvider only checks `manual`; no network is involved in these tests.
		request: { manual: true, options: { params: {} } } as never,
		getDifyConversationId: () => 'conv-1',
		...overrides,
	})

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === 'object') {
		for (const inner of Object.values(value)) deepFreeze(inner)
		Object.freeze(value)
	}
	return value
}

describe('applyEvent', () => {
	it('accumulates answer text and records the ids and creation time', () => {
		const m = applyEvent(
			applyEvent(emptyAssistant(), ev('message', { answer: 'Hel' })),
			ev('message', { answer: 'lo' }),
		)
		expect(m.content).toBe('Hello')
		expect(m.ids).toEqual({ messageId: 'msg-1', conversationId: 'conv-1', taskId: 'task-1' })
		expect(m.createdAt).toBe(1_700_000_000)
	})
	it('treats agent_message like message and replaces on message_replace', () => {
		const m = applyEvent(
			applyEvent(emptyAssistant(), ev('agent_message', { answer: 'draft' })),
			ev('message_replace', { answer: 'final' }),
		)
		expect(m.content).toBe('final')
	})
	it('joins reasoning chunks and marks the final one', () => {
		const m = applyEvent(
			applyEvent(
				emptyAssistant(),
				ev('reasoning_chunk', { data: { reasoning: 'Think ', is_final: false } }),
			),
			ev('reasoning_chunk', { data: { reasoning: 'done.', is_final: true } }),
		)
		expect(m.reasoning).toBe('Think done.')
		expect(m.reasoningDone).toBe(true)
	})
	it('reopens the reasoning when a later LLM node streams more of it', () => {
		// Spec §4.2: reasoningDone = data.is_final; each LLM node closes its own reasoning.
		const closed = applyEvent(
			emptyAssistant(),
			ev('reasoning_chunk', { data: { reasoning: 'First. ', is_final: true } }),
		)
		const reopened = applyEvent(
			closed,
			ev('reasoning_chunk', { data: { reasoning: 'Second', is_final: false, node_id: 'llm-2' } }),
		)
		expect(reopened.reasoning).toBe('First. Second')
		expect(reopened.reasoningDone).toBe(false)
	})
	it('upserts agent thoughts by position', () => {
		const first = ev('agent_thought', {
			id: 't1',
			position: 1,
			thought: 'a',
			tool: '',
			tool_input: '',
			observation: '',
			message_files: [],
		})
		const update = ev('agent_thought', {
			id: 't1',
			position: 1,
			thought: 'a',
			tool: 'search',
			tool_input: '{}',
			observation: 'ok',
			message_files: [],
		})
		const m = applyEvent(applyEvent(emptyAssistant(), first), update)
		expect(m.thoughts).toHaveLength(1)
		expect(m.thoughts?.[0]).toMatchObject({ tool: 'search', observation: 'ok' })
	})
	it('builds the workflow state from started, node and finished events', () => {
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		const m = applyEvent(
			applyEvent(
				applyEvent(
					emptyAssistant(),
					ev('workflow_started', {
						workflow_run_id: 'run-1',
						data: { id: 'run-1', reason: 'initial' },
					}),
				),
				ev('node_started', { workflow_run_id: 'run-1', data: node }),
			),
			ev('node_finished', {
				workflow_run_id: 'run-1',
				data: {
					...node,
					status: 'succeeded',
					outputs: { text: 'x' },
					inputs: { q: 1 },
					process_data: { prompt: 'system' },
					elapsed_time: 0.5,
					execution_metadata: { total_tokens: 7 },
					error: null,
				},
			}),
		)
		expect(m.workflow).toEqual({
			runId: 'run-1',
			status: 'running',
			nodes: [
				{
					id: 'exec-1',
					nodeId: 'llm',
					type: 'llm',
					title: 'Answer',
					index: 1,
					status: 'success',
					inputs: { q: 1 },
					outputs: { text: 'x' },
					processData: { prompt: 'system' },
					elapsedTime: 0.5,
					totalTokens: 7,
					error: null,
				},
			],
		})
		const done = applyEvent(
			m,
			ev('workflow_finished', {
				workflow_run_id: 'run-1',
				data: { id: 'run-1', status: 'succeeded', outputs: {}, error: null },
			}),
		)
		expect(done.workflow?.status).toBe('finished')
	})
	it('keeps the nodes when a workflow resumes after a pause and marks retries', () => {
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		let m = applyEvent(
			applyEvent(
				emptyAssistant(),
				ev('workflow_started', {
					workflow_run_id: 'run-1',
					data: { id: 'run-1', reason: 'initial' },
				}),
			),
			ev('node_started', { workflow_run_id: 'run-1', data: node }),
		)
		m = applyEvent(
			m,
			ev('node_retry', {
				workflow_run_id: 'run-1',
				data: { ...node, retry_index: 1, error: 'timeout' },
			}),
		)
		expect(m.workflow?.nodes[0]).toMatchObject({ status: 'retrying', retries: 1, error: 'timeout' })
		m = applyEvent(
			m,
			ev('workflow_paused', { workflow_run_id: 'run-1', data: { status: 'paused' } }),
		)
		expect(m.workflow?.status).toBe('paused')
		m = applyEvent(
			m,
			ev('workflow_started', {
				workflow_run_id: 'run-1',
				data: { id: 'run-1', reason: 'resumption' },
			}),
		)
		expect(m.workflow?.nodes).toHaveLength(1)
		expect(m.workflow?.status).toBe('running')
	})
	it('collects files and citations', () => {
		const m = applyEvent(
			applyEvent(
				emptyAssistant(),
				ev('message_file', {
					id: 'f1',
					type: 'image',
					belongs_to: 'assistant',
					url: 'http://x/f.png',
				}),
			),
			ev('message_end', {
				metadata: { retriever_resources: [{ id: 'rr1', document_name: 'doc', content: 'c' }] },
			}),
		)
		expect(m.files).toEqual([
			{ id: 'f1', type: 'image', url: 'http://x/f.png', belongsTo: 'assistant' },
		])
		expect(m.citations).toHaveLength(1)
	})
	it('stores a stream error on the message', () => {
		const m = applyEvent(
			emptyAssistant(),
			ev('error', {
				code: 'completion_request_error',
				message: 'The model is unavailable.',
				status: 500,
			}),
		)
		expect(m.error).toEqual({
			code: 'completion_request_error',
			message: 'The model is unavailable.',
			status: 500,
		})
	})
	it('records a human input request, then its filled and expired states', () => {
		const inputs = [
			{
				type: 'paragraph',
				output_variable_name: 'feedback',
				default: { type: 'constant', value: 'Looks good', selector: [] },
			},
			{
				type: 'select',
				output_variable_name: 'priority',
				option_source: { type: 'constant', value: ['low', 'high'], selector: [] },
			},
		]
		const actions = [
			{ id: 'approve', title: 'Approve', button_style: 'primary' },
			{ id: 'reject', title: 'Request changes', button_style: 'default' },
		]
		const data = {
			form_id: 'form-1',
			form_token: 'ft',
			form_content: 'Review',
			inputs,
			actions,
			resolved_default_values: { feedback: 'Looks good' },
			expiration_time: 1_700_003_600,
			display_in_ui: true,
			node_id: 'review',
			node_title: 'Review',
		}
		let m = applyEvent(
			emptyAssistant(),
			ev('human_input_required', { workflow_run_id: 'run-1', data }),
		)
		expect(m.humanInput).toEqual({
			state: 'pending',
			formToken: 'ft',
			formContent: 'Review',
			inputs,
			actions,
			defaults: { feedback: 'Looks good' },
			workflowRunId: 'run-1',
			expiresAt: 1_700_003_600,
			nodeId: 'review',
		})
		m = applyEvent(
			m,
			ev('human_input_form_filled', {
				workflow_run_id: 'run-1',
				data: {
					node_id: 'review',
					action_id: 'approve',
					action_text: 'Approve',
					rendered_content: 'Review: ok',
				},
			}),
		)
		expect(m.humanInput).toMatchObject({
			state: 'filled',
			actionText: 'Approve',
			renderedContent: 'Review: ok',
		})
		const expired = applyEvent(
			applyEvent(emptyAssistant(), ev('human_input_required', { workflow_run_id: 'run-1', data })),
			ev('human_input_form_timeout', { workflow_run_id: 'run-1', data: { node_id: 'review' } }),
		)
		expect(expired.humanInput?.state).toBe('expired')
	})
	it('ignores ping, tts and iteration events', () => {
		const m = emptyAssistant()
		for (const name of [
			'ping',
			'tts_message',
			'tts_message_end',
			'iteration_started',
			'loop_next',
			'agent_log',
			'text_chunk',
		]) {
			expect(applyEvent(m, ev(name, { data: {} }))).toEqual(
				expect.objectContaining({ content: '' }),
			)
		}
	})

	// Additions beyond the brief's list.
	it('leaves everything but the ids and creation time alone for ignored events', () => {
		const m: DifyChatMessage = { ...emptyAssistant(), content: 'kept', reasoning: 'r' }
		for (const name of [
			'ping',
			'tts_message',
			'tts_message_end',
			'iteration_started',
			'iteration_next',
			'iteration_completed',
			'loop_started',
			'loop_next',
			'loop_completed',
			'agent_log',
			'text_chunk',
			'some_future_event',
		]) {
			expect(applyEvent(m, ev(name, { data: { text: 'ignored' }, audio: 'AAAA' }))).toEqual({
				...m,
				ids: { messageId: 'msg-1', conversationId: 'conv-1', taskId: 'task-1' },
				createdAt: 1_700_000_000,
			})
		}
	})
	it('refreshes the ids and creation time from every event that carries them, and keeps them when absent', () => {
		let m = applyEvent(emptyAssistant(), ev('message', { answer: 'a' }))
		m = applyEvent(m, {
			event: 'message',
			task_id: 'task-2',
			message_id: 'msg-2',
			conversation_id: 'conv-2',
			created_at: 1_700_000_100,
			answer: 'b',
		})
		expect(m.ids).toEqual({ messageId: 'msg-2', conversationId: 'conv-2', taskId: 'task-2' })
		expect(m.createdAt).toBe(1_700_000_100)
		// OpenAPI: the `error` event carries no task_id; the earlier one stays.
		m = applyEvent(m, {
			event: 'error',
			message_id: 'msg-2',
			conversation_id: 'conv-2',
			created_at: 1_700_000_100,
			code: 'x',
			message: 'y',
			status: 400,
		})
		expect(m.ids.taskId).toBe('task-2')
	})
	it("replaces the agent answer with an Agent app's closing message instead of appending it", () => {
		// OpenAPI POST /chat-messages: Agent apps stream agent_message chunks, then one `message` with the complete answer.
		let m = applyEvent(
			applyEvent(emptyAssistant(), ev('agent_message', { answer: 'Echo: ' })),
			ev('agent_message', { answer: 'hi' }),
		)
		expect(m.content).toBe('Echo: hi')
		expect(m.agentAnswer).toBe(true)
		// A closing answer that differs from the streamed text: dropping the event or appending it both fail.
		m = applyEvent(m, ev('message', { answer: 'Echo: hi!' }))
		expect(m.content).toBe('Echo: hi!')
		expect(m).not.toHaveProperty('agentAnswer')
		m = applyEvent(m, ev('message_end', { id: 'msg-1', metadata: {} }))
		expect(m.content).toBe('Echo: hi!')
		expect(m).not.toHaveProperty('agentAnswer')
	})
	it('clears the agent bookkeeping at message_end when no closing message arrives (Legacy Agent)', () => {
		// OpenAPI POST /chat-messages: Legacy Agent streams agent_message chunks → message_end, no closing `message`.
		const streamed = applyEvent(
			applyEvent(emptyAssistant(), ev('agent_message', { answer: 'Echo: ' })),
			ev('agent_message', { answer: 'hi' }),
		)
		const ended = applyEvent(
			streamed,
			ev('message_end', {
				id: 'msg-1',
				metadata: { retriever_resources: [{ id: 'rr1', document_name: 'doc', content: 'c' }] },
			}),
		)
		expect(ended).not.toHaveProperty('agentAnswer')
		expect(ended.content).toBe('Echo: hi')
		expect(ended.citations).toHaveLength(1)
		const endedWithoutCitations = applyEvent(
			streamed,
			ev('message_end', { id: 'msg-1', metadata: {} }),
		)
		expect(endedWithoutCitations).not.toHaveProperty('agentAnswer')
		expect(endedWithoutCitations.citations).toBeUndefined()
	})
	it('keeps the answer streamed before an error and adds no text of its own when Dify sends none', () => {
		const m = applyEvent(
			applyEvent(emptyAssistant(), ev('message', { answer: 'Echo: ' })),
			ev('error', { code: 'internal_server_error' }),
		)
		expect(m.content).toBe('Echo: ')
		expect(m.error).toEqual({ code: 'internal_server_error', message: '', status: undefined })
	})
	it('records a message_end without citations and keeps the answer', () => {
		const m = applyEvent(
			applyEvent(emptyAssistant(), ev('message', { answer: 'x' })),
			ev('message_end', {
				id: 'msg-1',
				metadata: { usage: { total_tokens: 3 }, retriever_resources: [] },
			}),
		)
		expect(m).toEqual({
			role: 'assistant',
			content: 'x',
			ids: { messageId: 'msg-1', conversationId: 'conv-1', taskId: 'task-1' },
			createdAt: 1_700_000_000,
		})
	})
	it('stores the agent thought without the event name and appends a new position', () => {
		const m = applyEvent(
			applyEvent(emptyAssistant(), ev('agent_thought', { id: 't1', position: 1, thought: 'a' })),
			ev('agent_thought', { id: 't2', position: 2, thought: 'b' }),
		)
		expect(m.thoughts?.map(t => t.position)).toEqual([1, 2])
		expect(m.thoughts?.[0]).not.toHaveProperty('event')
		expect(m.thoughts?.[0]).toMatchObject({ id: 't1', thought: 'a', message_id: 'msg-1' })
	})
	it('records a user file from message_file', () => {
		const m = applyEvent(
			emptyAssistant(),
			ev('message_file', { id: 'f2', type: 'document', belongs_to: 'user', url: '/f.pdf' }),
		)
		expect(m.files).toEqual([{ id: 'f2', type: 'document', url: '/f.pdf', belongsTo: 'user' }])
	})
	it('adds a node it has not seen started, maps a failed node to error and counts every retry', () => {
		const node = { id: 'exec-2', node_id: 'tool', node_type: 'tool', title: 'Tool', index: 2 }
		let m = applyEvent(
			emptyAssistant(),
			ev('workflow_started', {
				workflow_run_id: 'run-1',
				data: { id: 'run-1', reason: 'initial' },
			}),
		)
		// OpenAPI: retry_index starts at 0, so the count comes from the events, not from the index.
		m = applyEvent(
			m,
			ev('node_retry', {
				workflow_run_id: 'run-1',
				data: { ...node, retry_index: 0, error: 'first' },
			}),
		)
		m = applyEvent(
			m,
			ev('node_retry', {
				workflow_run_id: 'run-1',
				data: { ...node, retry_index: 1, error: 'second' },
			}),
		)
		expect(m.workflow?.nodes).toEqual([
			{
				id: 'exec-2',
				nodeId: 'tool',
				type: 'tool',
				title: 'Tool',
				index: 2,
				status: 'retrying',
				retries: 2,
				error: 'second',
			},
		])
		m = applyEvent(m, ev('node_started', { workflow_run_id: 'run-1', data: node }))
		expect(m.workflow?.nodes[0].status).toBe('retrying')
		m = applyEvent(
			m,
			ev('node_finished', {
				workflow_run_id: 'run-1',
				data: {
					...node,
					status: 'failed',
					error: 'boom',
					inputs: null,
					outputs: null,
					process_data: null,
					elapsed_time: 1,
					execution_metadata: null,
				},
			}),
		)
		expect(m.workflow?.nodes[0]).toMatchObject({
			status: 'error',
			error: 'boom',
			retries: 2,
			totalTokens: undefined,
		})
	})
	it('starts a fresh node list for a new initial run', () => {
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		let m = applyEvent(
			emptyAssistant(),
			ev('node_started', { workflow_run_id: 'run-1', data: node }),
		)
		m = applyEvent(
			m,
			ev('workflow_started', {
				workflow_run_id: 'run-2',
				data: { id: 'run-2', reason: 'initial' },
			}),
		)
		expect(m.workflow).toEqual({ runId: 'run-2', status: 'running', nodes: [] })
	})
	it('marks a failed workflow from its error or its status', () => {
		const started = applyEvent(
			emptyAssistant(),
			ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1' } }),
		)
		expect(
			applyEvent(
				started,
				ev('workflow_finished', {
					workflow_run_id: 'run-1',
					data: { status: 'failed', error: 'Node LLM failed' },
				}),
			).workflow?.status,
		).toBe('failed')
		expect(
			applyEvent(
				started,
				ev('workflow_finished', {
					workflow_run_id: 'run-1',
					data: { status: 'failed', error: null },
				}),
			).workflow?.status,
		).toBe('failed')
		expect(
			applyEvent(
				started,
				ev('workflow_finished', {
					workflow_run_id: 'run-1',
					data: { status: 'partial-succeeded', error: null },
				}),
			).workflow?.status,
		).toBe('finished')
	})
	it('keeps a null form token as an empty string and ignores filled/timeout events without a form', () => {
		// OpenAPI: form_token is null for Email or Console delivery.
		const m = applyEvent(
			emptyAssistant(),
			ev('human_input_required', {
				workflow_run_id: 'run-1',
				data: {
					form_token: null,
					form_content: 'c',
					inputs: [],
					actions: [],
					resolved_default_values: {},
					expiration_time: 1,
				},
			}),
		)
		expect(m.humanInput).toMatchObject({
			formToken: '',
			defaults: {},
			expiresAt: 1,
			nodeId: undefined,
		})
		const plain = { ...emptyAssistant(), content: 'x' }
		expect(
			applyEvent(plain, ev('human_input_form_filled', { data: { action_text: 'A' } })).humanInput,
		).toBeUndefined()
		expect(
			applyEvent(plain, ev('human_input_form_timeout', { data: {} })).humanInput,
		).toBeUndefined()
	})
	it('never mutates the message it is given', () => {
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		const origin = deepFreeze<DifyChatMessage>({
			...emptyAssistant(),
			content: 'a',
			reasoning: 'r',
			thoughts: [{ id: 't1', position: 1 } as never],
			files: [{ id: 'f', type: 'image', url: 'u', belongsTo: 'assistant' }],
			workflow: {
				runId: 'run-1',
				status: 'running',
				nodes: [{ id: 'exec-1', nodeId: 'llm', type: 'llm', title: 'Answer', status: 'running' }],
			},
			humanInput: {
				state: 'pending',
				formToken: 'ft',
				formContent: '',
				inputs: [],
				actions: [],
				defaults: {},
				expiresAt: 1,
				workflowRunId: 'run-1',
			},
		})
		const events = [
			ev('message', { answer: 'b' }),
			ev('agent_message', { answer: 'b' }),
			ev('message_replace', { answer: 'b' }),
			ev('reasoning_chunk', { data: { reasoning: 'x', is_final: true } }),
			ev('agent_thought', { id: 't1', position: 1, thought: 'z' }),
			ev('message_file', { id: 'f2', type: 'image', url: 'u2', belongs_to: 'assistant' }),
			ev('message_end', { metadata: { retriever_resources: [{ id: 'rr' }] } }),
			ev('workflow_started', { workflow_run_id: 'run-1', data: { reason: 'resumption' } }),
			ev('node_started', { workflow_run_id: 'run-1', data: node }),
			ev('node_retry', { workflow_run_id: 'run-1', data: { ...node, error: 'e' } }),
			ev('node_finished', { workflow_run_id: 'run-1', data: { ...node, status: 'succeeded' } }),
			ev('workflow_paused', { data: {} }),
			ev('workflow_finished', { data: { status: 'succeeded' } }),
			ev('human_input_form_filled', { data: { action_text: 'A' } }),
			ev('human_input_form_timeout', { data: {} }),
			ev('error', { message: 'm' }),
		]
		for (const event of events) expect(() => applyEvent(origin, event)).not.toThrow()
		expect(origin.content).toBe('a')
		expect(origin.workflow?.nodes[0].status).toBe('running')
	})
})

describe('DifyChatProvider', () => {
	// Review Focus 1: junk chunks never throw or blank the message.
	it('returns the origin unchanged for [DONE], empty and non-JSON chunks', () => {
		const provider = makeProvider()
		const origin = { ...emptyAssistant(), content: 'kept' }
		for (const data of ['[DONE]', '', 'not json {']) {
			expect(
				provider.transformMessage({
					originMessage: origin,
					chunk: { data },
					chunks: [],
					status: 'updating',
					responseHeaders: new Headers(),
				}),
			).toBe(origin)
		}
	})
	it('sends the conversation id from the getter and the streaming defaults', () => {
		const provider = makeProvider()
		const params = provider.transformParams({ query: 'hi', inputs: { a: 1 }, files: [] }, {
			params: { user: 'jane@example.com' },
		} as never)
		expect(params).toEqual({
			user: 'jane@example.com',
			query: 'hi',
			inputs: { a: 1 },
			files: [],
			response_mode: 'streaming',
			conversation_id: 'conv-1',
		})
	})
	it("sends the attachments as Dify's file objects, without the names kept for the bubble", () => {
		const provider = makeProvider()
		const params = provider.transformParams(
			{
				query: 'hi',
				files: [
					{
						type: 'document',
						transfer_method: 'local_file',
						upload_file_id: 'up-1',
						filename: 'note.txt',
					},
					{ type: 'image', transfer_method: 'remote_url', url: 'https://example.com/a.png' },
				],
			},
			{ params: {} } as never,
		)
		// OpenAPI ChatRequest.files: `type`, `transfer_method`, and `upload_file_id` or `url`.
		expect(params.files).toStrictEqual([
			{ type: 'document', transfer_method: 'local_file', upload_file_id: 'up-1' },
			{ type: 'image', transfer_method: 'remote_url', url: 'https://example.com/a.png' },
		])
	})
	it('omits the conversation id for a new chat', () => {
		const provider = makeProvider({ getDifyConversationId: () => undefined })
		expect(provider.transformParams({ query: 'hi' }, { params: {} } as never).conversation_id).toBe(
			'',
		)
	})
	it('renders the local user bubble from the query and files, and none for a resume', () => {
		const provider = makeProvider()
		expect(
			provider.transformLocalMessage({ query: 'hi', files: [], inputs: { a: 1 } }),
		).toMatchObject({ role: 'user', content: 'hi', inputs: { a: 1 } })
		// An attachment keeps the name it was picked with (Dify's file object carries none).
		expect(
			provider.transformLocalMessage({
				query: 'with a file',
				files: [
					{
						type: 'document',
						transfer_method: 'local_file',
						upload_file_id: 'up-1',
						filename: 'note.txt',
					},
				],
			}),
		).toMatchObject({
			files: [{ id: 'up-1', type: 'document', filename: 'note.txt', uploadFileId: 'up-1' }],
		})
		expect(
			provider.transformLocalMessage({
				resume: { workflowRunId: 'run-1', message: emptyAssistant() },
			}),
		).toEqual([])
	})
	it('continues the paused message on a resume even though the SDK passes no originMessage on the first chunk', () => {
		const provider = makeProvider()
		const paused: DifyChatMessage = {
			...emptyAssistant(),
			content: 'Before the pause. ',
			workflow: {
				runId: 'run-1',
				status: 'paused',
				nodes: [{ id: 'n1', nodeId: 'a', type: 'start', title: 'Start', status: 'success' }],
			},
		}
		provider.transformParams({ resume: { workflowRunId: 'run-1', message: paused } }, {
			params: {},
		} as never)
		const m = feed(provider, [
			ev('workflow_started', {
				workflow_run_id: 'run-1',
				data: { id: 'run-1', reason: 'resumption' },
			}),
			ev('message', { answer: 'After.' }),
		])
		expect(m.content).toBe('Before the pause. After.')
		expect(m.workflow?.nodes).toHaveLength(1)
	})
	it('forgets the resume base on the next normal send', () => {
		const provider = makeProvider()
		provider.transformParams(
			{ resume: { workflowRunId: 'run-1', message: { ...emptyAssistant(), content: 'old' } } },
			{ params: {} } as never,
		)
		provider.transformParams({ query: 'new' }, { params: {} } as never)
		expect(feed(provider, [ev('message', { answer: 'fresh' })]).content).toBe('fresh')
	})
	it('reports workflow updates so the hook can persist node data', () => {
		const onWorkflowUpdate = vi.fn()
		const provider = makeProvider({ onWorkflowUpdate })
		feed(provider, [
			ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1' } }),
			ev('message', { answer: 'x' }),
		])
		expect(onWorkflowUpdate).toHaveBeenCalledTimes(1)
	})
	it('reports the conversation id once, from the first event that names it, and never breaks the stream', () => {
		const onConversationId = vi.fn(() => {
			throw new Error('list store failed')
		})
		const provider = makeProvider({ onConversationId })
		const message = feed(provider, [
			ev('message', { answer: 'a' }),
			ev('message', { answer: 'b' }),
			ev('message_end'),
		])
		expect(message.content).toBe('ab')
		expect(onConversationId).toHaveBeenCalledTimes(1)
		expect(onConversationId).toHaveBeenCalledWith('conv-1')
		// A message that already carries the id (a resumed or continued one) reports nothing.
		onConversationId.mockClear()
		feed(provider, [ev('message', { answer: 'c' })], message)
		expect(onConversationId).not.toHaveBeenCalled()
	})

	// Additions beyond the brief's list.
	const info = (originMessage: DifyChatMessage | undefined, chunk: unknown) =>
		({
			originMessage,
			chunk,
			chunks: [],
			status: 'updating',
			responseHeaders: new Headers(),
		}) as never

	it('returns the origin for the bare ping frame, a missing chunk and JSON that is not an event', () => {
		const provider = makeProvider()
		const origin = { ...emptyAssistant(), content: 'kept' }
		// `event: ping` without `data:` (chatflow and resumed streams open with it); onSuccess passes no chunk.
		for (const junk of [
			{ event: 'ping' },
			undefined,
			{},
			{ data: 'null' },
			{ data: '42' },
			{ data: '"text"' },
			{ data: '[]' },
			{ data: '{"answer":"no event"}' },
			{ data: '  [DONE]  ' },
		]) {
			expect(provider.transformMessage(info(origin, junk))).toBe(origin)
		}
	})
	it('starts an empty assistant message when the first chunk is a ping', () => {
		const provider = makeProvider()
		provider.transformParams({ query: 'hi' }, { params: {} } as never)
		expect(provider.transformMessage(info(undefined, { event: 'ping' }))).toEqual(emptyAssistant())
	})
	it('keeps the paused message when a resumed stream opens with a ping', () => {
		const provider = makeProvider()
		const paused: DifyChatMessage = { ...emptyAssistant(), content: 'Before. ' }
		provider.transformParams({ resume: { workflowRunId: 'run-1', message: paused } }, {
			params: {},
		} as never)
		expect(provider.transformMessage(info(undefined, { event: 'ping' }))).toBe(paused)
	})
	it('keeps an answer that merely contains the [DONE] marker', () => {
		const provider = makeProvider()
		expect(feed(provider, [ev('message', { answer: 'Status: [DONE]' })]).content).toBe(
			'Status: [DONE]',
		)
	})
	it('passes a resume through for the fetch router and takes the user from the request over the defaults', () => {
		const provider = makeProvider()
		const resume = { workflowRunId: 'run-1', message: emptyAssistant() }
		expect(
			provider.transformParams({ resume }, { params: { user: 'jane@example.com' } } as never),
		).toMatchObject({ resume, response_mode: 'streaming', user: 'jane@example.com' })
		expect(
			provider.transformParams({ query: 'q', user: 'other@example.com' }, {
				params: { user: 'jane@example.com' },
			} as never).user,
		).toBe('other@example.com')
	})
	it('maps uploaded and remote files onto the local user bubble', () => {
		const provider = makeProvider()
		const local = provider.transformLocalMessage({
			query: 'see files',
			files: [
				{ type: 'image', transfer_method: 'local_file', upload_file_id: 'up-1' },
				{ type: 'document', transfer_method: 'remote_url', url: 'https://example.com/a.pdf' },
			],
		})
		expect(local).toEqual({
			role: 'user',
			content: 'see files',
			inputs: undefined,
			ids: {},
			files: [
				{ id: 'up-1', type: 'image', url: '', belongsTo: 'user', uploadFileId: 'up-1' },
				{
					id: 'local-1',
					type: 'document',
					url: 'https://example.com/a.pdf',
					belongsTo: 'user',
					uploadFileId: undefined,
				},
			],
		})
	})
	it('reports every workflow event, with the updated message, and nothing else', () => {
		const onWorkflowUpdate = vi.fn()
		const provider = makeProvider({ onWorkflowUpdate })
		const node = { id: 'exec-1', node_id: 'llm', node_type: 'llm', title: 'Answer', index: 1 }
		const m = feed(provider, [
			ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1' } }),
			ev('node_started', { workflow_run_id: 'run-1', data: node }),
			ev('node_retry', { workflow_run_id: 'run-1', data: node }),
			ev('message', { answer: 'x' }),
			ev('node_finished', { workflow_run_id: 'run-1', data: { ...node, status: 'succeeded' } }),
			ev('message_end', {}),
			ev('workflow_finished', { workflow_run_id: 'run-1', data: { status: 'succeeded' } }),
		])
		expect(onWorkflowUpdate).toHaveBeenCalledTimes(5)
		expect(onWorkflowUpdate).toHaveBeenLastCalledWith(m)
		expect(onWorkflowUpdate.mock.calls[3][0].workflow.nodes[0].status).toBe('success')
		// workflow_paused is a workflow event too.
		feed(provider, [ev('workflow_paused', { data: {} })], m)
		expect(onWorkflowUpdate).toHaveBeenCalledTimes(6)
	})
	it('keeps streaming when the workflow persistence callback throws', () => {
		const onWorkflowUpdate = vi.fn(() => {
			throw new Error('IndexedDB is unavailable')
		})
		const provider = makeProvider({ onWorkflowUpdate })
		const origin = { ...emptyAssistant(), content: 'Echo: ' }
		let m: DifyChatMessage | undefined
		expect(() => {
			m = feed(
				provider,
				[
					ev('workflow_started', { workflow_run_id: 'run-1', data: { id: 'run-1' } }),
					ev('message', { answer: 'hi' }),
				],
				origin,
			)
		}).not.toThrow()
		expect(onWorkflowUpdate).toHaveBeenCalledTimes(1)
		expect(m).toEqual({
			...origin,
			content: 'Echo: hi',
			workflow: { runId: 'run-1', status: 'running', nodes: [] },
			ids: { messageId: 'msg-1', conversationId: 'conv-1', taskId: 'task-1' },
			createdAt: 1_700_000_000,
		})
	})
})
