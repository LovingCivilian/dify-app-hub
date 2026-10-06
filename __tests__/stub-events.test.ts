import { describe, expect, it } from 'vitest'

import { APP_ID } from '@/e2e/fixtures/constants'
import { MARKDOWN_SAMPLES } from '@/e2e/fixtures/markdown-samples'
import { APP_IDS, modeFromPath, STUB_APPS } from '@/e2e/fixtures/stub/apps'
import * as ev from '@/e2e/fixtures/stub/events'
import {
	chatScenario,
	parametersFor,
	resumeScenario,
	REVIEW_NODE,
	runDelay,
	runScenario,
	streamDelay,
} from '@/e2e/fixtures/stub/scenarios'

const ctx = {
	base: { task_id: 't1', message_id: 'm1', conversation_id: 'c1', created_at: 1_700_000_000 },
	runId: 'run-1',
	formToken: 'ft-1',
	fileUrl: 'http://127.0.0.1:5399/files/stub-image.png',
}

describe('modeFromPath', () => {
	it('maps the unprefixed /v1 to the chat app and the four prefixes to their modes', () => {
		expect(modeFromPath('/v1/parameters')).toEqual({ mode: 'chat', path: '/parameters' })
		expect(modeFromPath('/v1/agent/chat-messages')).toEqual({
			mode: 'agent-chat',
			path: '/chat-messages',
		})
		expect(modeFromPath('/v1/chatflow/messages')).toEqual({
			mode: 'advanced-chat',
			path: '/messages',
		})
		expect(modeFromPath('/v1/workflow/workflows/run')).toEqual({
			mode: 'workflow',
			path: '/workflows/run',
		})
		expect(modeFromPath('/v1/completion/completion-messages')).toEqual({
			mode: 'completion',
			path: '/completion-messages',
		})
	})
	it('keeps the resume route /workflow/<id>/events under the prefix of its app', () => {
		expect(modeFromPath('/v1/chatflow/workflow/run-1/events')).toEqual({
			mode: 'advanced-chat',
			path: '/workflow/run-1/events',
		})
		expect(modeFromPath('/v1/workflow/workflow/run-1/events')).toEqual({
			mode: 'workflow',
			path: '/workflow/run-1/events',
		})
	})
	it('keeps the seeded chat app id and name', () => {
		expect(STUB_APPS[0]).toMatchObject({ id: APP_ID, name: 'Stub app', mode: 'chat', prefix: '' })
		expect(STUB_APPS).toHaveLength(5)
	})
	it('seeds the chatflow app with the always-on opening statement and the others with the default', () => {
		expect(
			Object.fromEntries(STUB_APPS.map(app => [app.mode, app.openingStatementDisplayMode])),
		).toEqual({
			chat: 'default',
			'agent-chat': 'default',
			'advanced-chat': 'always',
			workflow: 'default',
			completion: 'default',
		})
	})
	it('seeds annotation on the chatflow app only (no stub parameters enable annotation_reply)', () => {
		expect(STUB_APPS.filter(app => app.enableAnnotation).map(app => app.mode)).toEqual([
			'advanced-chat',
		])
	})
	it('exposes the app id of every mode', () => {
		expect(APP_IDS.chat).toBe(APP_ID)
		expect(Object.keys(APP_IDS).sort()).toEqual(
			['advanced-chat', 'agent-chat', 'chat', 'completion', 'workflow'].sort(),
		)
		expect(new Set(STUB_APPS.map(app => app.id)).size).toBe(5)
	})
})

describe('chatScenario', () => {
	it('gives every event the StreamEventBase fields', () => {
		for (const mode of ['chat', 'agent-chat', 'advanced-chat'] as const) {
			for (const event of chatScenario(mode, 'hello', ctx)) {
				expect(event).toMatchObject({
					task_id: 't1',
					message_id: 'm1',
					conversation_id: 'c1',
					created_at: 1_700_000_000,
				})
				expect(typeof event.event).toBe('string')
			}
		}
	})
	it('echoes the query in a plain chat and ends with message_end', () => {
		const events = chatScenario('chat', 'hello', ctx)
		expect(events.map(e => e.event)).toEqual(['message', 'message', 'message_end'])
		expect(events.map(e => (e as { answer?: string }).answer ?? '').join('')).toBe('Echo: hello')
	})
	it('streams agent thoughts (one with a tool) and agent messages for agent apps', () => {
		const types = chatScenario('agent-chat', 'hello', ctx).map(e => e.event)
		expect(types.filter(t => t === 'agent_thought')).toHaveLength(2)
		expect(types).toContain('agent_message')
		expect(types.at(-1)).toBe('message_end')
	})
	it('streams a chatflow run: workflow_started, nodes, reasoning with is_final, text, message_end, workflow_finished', () => {
		const events = chatScenario('advanced-chat', 'hello', ctx)
		const types = events.map(e => e.event)
		expect(types[0]).toBe('workflow_started')
		expect(types).toEqual(
			expect.arrayContaining([
				'node_started',
				'node_finished',
				'reasoning_chunk',
				'message',
				'message_end',
			]),
		)
		expect(types.at(-1)).toBe('workflow_finished')
		const finals = events
			.filter(e => e.event === 'reasoning_chunk')
			.map(e => (e as unknown as { data: { is_final: boolean } }).data.is_final)
		// Several chunks, so the reasoning streams across several events (the e2e sees it open).
		expect(finals.length).toBeGreaterThanOrEqual(4)
		expect(finals.at(-1)).toBe(true)
		expect(finals.slice(0, -1).every(final => !final)).toBe(true)
	})
	it('fails a chatflow run on the nodefail query: workflow_finished failed, then error, no message_end', () => {
		const events = chatScenario('advanced-chat', 'nodefail please', ctx)
		const types = events.map(e => e.event)
		expect(types[0]).toBe('workflow_started')
		expect(types.slice(-3)).toEqual(['node_finished', 'workflow_finished', 'error'])
		expect(types).not.toContain('message_end')
		const [node, run] = events.slice(-3) as unknown as { data: { status: string; error: string } }[]
		expect(node.data).toMatchObject({ status: 'failed', error: 'The model is unavailable.' })
		expect(run.data).toMatchObject({ status: 'failed', error: 'The model is unavailable.' })
		// Elsewhere the marker is plain text: the echo.
		expect(chatScenario('chat', 'nodefail please', ctx).map(e => e.event)).toEqual([
			'message',
			'message',
			'message_end',
		])
	})
	it('pauses for human input on the hitl query and ends the stream', () => {
		const types = chatScenario('advanced-chat', 'please hitl this', ctx).map(e => e.event)
		expect(types.slice(-2)).toEqual(['human_input_required', 'workflow_paused'])
	})
	it('sends a form already past its expiry on `expired` and one without a token on `email`', () => {
		const formOf = (query: string) =>
			(
				chatScenario('advanced-chat', query, ctx).find(
					e => e.event === 'human_input_required',
				) as unknown as { data: { form_token: string | null; expiration_time: number } }
			).data
		expect(formOf('please hitl')).toMatchObject({
			form_token: 'ft-1',
			expiration_time: ctx.base.created_at + 3600,
		})
		expect(formOf('please hitl expired').expiration_time).toBe(ctx.base.created_at - 60)
		expect(formOf('please hitl by email').form_token).toBeNull()
	})
	it('emits an error event on the error query and a message_file on the files query', () => {
		expect(chatScenario('chat', 'cause an error', ctx).map(e => e.event)).toEqual([
			'message',
			'error',
		])
		expect(chatScenario('chat', 'send files', ctx).map(e => e.event)).toContain('message_file')
	})
	it('retries a node on the retry query', () => {
		expect(chatScenario('advanced-chat', 'retry once', ctx).map(e => e.event)).toContain(
			'node_retry',
		)
	})
	it('streams 40 numbered chunks on the slow query', () => {
		const events = chatScenario('chat', 'go slow', ctx)
		expect(events.filter(e => e.event === 'message')).toHaveLength(40)
		expect(events.at(-1)?.event).toBe('message_end')
	})
	it('matches slow as a whole word: slowhistory (the race marker) echoes instead of streaming 40 chunks', () => {
		const marker = chatScenario('chat', 'slowhistory x', ctx)
		expect(marker.map(e => e.event)).toEqual(['message', 'message', 'message_end'])
		expect(marker.map(e => (e as { answer?: string }).answer ?? '').join('')).toBe(
			'Echo: slowhistory x',
		)
		expect(chatScenario('chat', 'slow x', ctx).filter(e => e.event === 'message')).toHaveLength(40)
		expect(
			chatScenario('chat', 'Slow, please', ctx).filter(e => e.event === 'message'),
		).toHaveLength(40)
	})
	it('ends with two retriever_resources in message_end on the cite query', () => {
		const end = chatScenario('chat', 'cite it', ctx).at(-1) as unknown as {
			event: string
			metadata: { retriever_resources: { position: number }[] }
		}
		expect(end.event).toBe('message_end')
		expect(end.metadata.retriever_resources.map(r => r.position)).toEqual([1, 2])
	})
})

describe('streamDelay', () => {
	const delayOf = (mode: Parameters<typeof chatScenario>[0], query: string) =>
		streamDelay(query, chatScenario(mode, query, ctx))

	it('paces the slow stream and the streams that carry reasoning at 100 ms, the rest at 20 ms', () => {
		expect(delayOf('chat', 'go slow')).toBe(100)
		// reasoning_chunk events (chatflow) and a <think> block in the answer (md:think).
		expect(delayOf('advanced-chat', 'hello')).toBe(100)
		expect(delayOf('chat', 'md:think')).toBe(100)
		expect(delayOf('chat', 'hello')).toBe(20)
		expect(delayOf('chat', 'md:code')).toBe(20)
		expect(delayOf('advanced-chat', 'nodefail')).toBe(20)
	})
})

describe('chatScenario markdown samples', () => {
	const answerOf = (query: string) =>
		chatScenario('chat', query, ctx)
			.map(e => (e as { answer?: string }).answer ?? '')
			.join('')

	it('streams the streaming sample in chunks on the markdown query', () => {
		const events = chatScenario('chat', 'show markdown', ctx)
		expect(events.filter(e => e.event === 'message').length).toBeGreaterThan(1)
		expect(events.at(-1)?.event).toBe('message_end')
		expect(answerOf('show markdown')).toBe(MARKDOWN_SAMPLES.streaming)
	})
	it.each(Object.keys(MARKDOWN_SAMPLES))('streams the %s sample on md:%s', name => {
		const events = chatScenario('chat', `md:${name}`, ctx)
		expect(events.filter(e => e.event === 'message').length).toBeGreaterThan(1)
		expect(events.at(-1)?.event).toBe('message_end')
		expect(answerOf(`md:${name}`)).toBe(MARKDOWN_SAMPLES[name as keyof typeof MARKDOWN_SAMPLES])
	})
	it('falls through to the echo for an unknown sample name', () => {
		expect(answerOf('md:nope')).toBe('Echo: md:nope')
		expect(chatScenario('chat', 'md:nope', ctx).map(e => e.event)).toEqual([
			'message',
			'message',
			'message_end',
		])
	})
})

describe('event builders follow the OpenAPI schemas', () => {
	const { base } = ctx

	it('message, agent_message and message_replace carry answer (StreamEventChatMessage, StreamEventChatAgentMessage, StreamEventChatMessageReplace)', () => {
		expect(ev.message(base, 'a')).toEqual({ event: 'message', ...base, answer: 'a' })
		expect(ev.agentMessage(base, 'a')).toEqual({ event: 'agent_message', ...base, answer: 'a' })
		expect(ev.messageReplace(base, 'a')).toEqual({ event: 'message_replace', ...base, answer: 'a' })
	})
	it('message_end carries id and metadata.usage / retriever_resources (StreamEventChatMessageEnd)', () => {
		const end = ev.messageEnd(base, [ev.retrieverResource(base, 1, 'Tea.')])
		expect(end).toMatchObject({ event: 'message_end', id: 'm1', ...base })
		const metadata = end.metadata as {
			usage: Record<string, unknown>
			retriever_resources: Record<string, unknown>[]
		}
		expect(metadata.usage).toMatchObject({
			prompt_tokens: expect.any(Number),
			completion_tokens: expect.any(Number),
			total_tokens: expect.any(Number),
			total_price: expect.any(String),
			currency: 'USD',
			latency: expect.any(Number),
		})
		// The streamed item has no `id` (OpenAPI POST /chat-messages streaming example); the stored one has.
		expect(metadata.retriever_resources[0]).not.toHaveProperty('id')
		expect(metadata.retriever_resources[0]).toMatchObject({
			message_id: 'm1',
			position: 1,
			dataset_id: expect.any(String),
			dataset_name: expect.any(String),
			document_id: expect.any(String),
			document_name: expect.any(String),
			data_source_type: expect.any(String),
			segment_id: expect.any(String),
			score: expect.any(Number),
			hit_count: expect.any(Number),
			word_count: 4,
			segment_position: 1,
			index_node_hash: expect.any(String),
			content: 'Tea.',
			created_at: base.created_at,
		})
	})
	it('message_file carries id, type, belongs_to and url (StreamEventChatMessageFile)', () => {
		expect(ev.messageFile(base, 'http://x/y.png')).toMatchObject({
			event: 'message_file',
			id: expect.any(String),
			type: 'image',
			belongs_to: 'assistant',
			url: 'http://x/y.png',
		})
	})
	it('error carries code, message and status (StreamEventChatError)', () => {
		expect(ev.errorEvent(base, 'completion_request_error', 'down', 500)).toEqual({
			event: 'error',
			...base,
			code: 'completion_request_error',
			message: 'down',
			status: 500,
		})
	})
	it('agent_thought carries id, position, thought, tool, tool_input, observation, message_files (StreamEventChatAgentThought)', () => {
		expect(
			ev.agentThought(base, 2, {
				thought: '',
				tool: 'web_search',
				tool_input: '{}',
				observation: 'x',
			}),
		).toMatchObject({
			event: 'agent_thought',
			id: expect.any(String),
			position: 2,
			thought: '',
			tool: 'web_search',
			tool_input: '{}',
			observation: 'x',
			message_files: [],
		})
	})
	it('reasoning_chunk carries data.reasoning, is_final, message_id and node_id (StreamEventChatReasoningChunk)', () => {
		expect(ev.reasoningChunk(base, 'hm', true)).toMatchObject({
			event: 'reasoning_chunk',
			data: { reasoning: 'hm', is_final: true, message_id: 'm1', node_id: expect.any(String) },
		})
		expect((ev.reasoningChunk(base, 'hm').data as { is_final: boolean }).is_final).toBe(false)
	})
	it('workflow_started carries workflow_run_id and data.reason initial | resumption (StreamEventWorkflowStarted)', () => {
		expect(ev.workflowStarted(base, 'run-1')).toMatchObject({
			event: 'workflow_started',
			workflow_run_id: 'run-1',
			data: { id: 'run-1', workflow_id: expect.any(String), inputs: {}, reason: 'initial' },
		})
		expect(
			(ev.workflowStarted(base, 'run-1', 'resumption').data as { reason: string }).reason,
		).toBe('resumption')
	})
	it('node_started, node_finished and node_retry carry the node fields (StreamEventNodeStarted, StreamEventNodeFinished, StreamEventNodeRetry)', () => {
		const node = REVIEW_NODE
		const common = {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
		}
		expect(ev.nodeStarted(base, 'run-1', node)).toMatchObject({
			event: 'node_started',
			workflow_run_id: 'run-1',
			data: { ...common, inputs: null, extras: {}, iteration_id: null, loop_id: null },
		})
		expect(ev.nodeFinished(base, 'run-1', node, { text: 'x' })).toMatchObject({
			event: 'node_finished',
			workflow_run_id: 'run-1',
			data: {
				...common,
				status: 'succeeded',
				outputs: { text: 'x' },
				elapsed_time: expect.any(Number),
				error: null,
				finished_at: base.created_at + 1,
			},
		})
		expect(ev.nodeFinished(base, 'run-1', node, {}, 'failed', 'boom')).toMatchObject({
			data: { status: 'failed', error: 'boom' },
		})
		expect(ev.nodeRetry(base, 'run-1', node, 1)).toMatchObject({
			event: 'node_retry',
			data: { ...common, retry_index: 1, status: 'retry', error: expect.any(String) },
		})
	})
	it('workflow_finished carries status, outputs, files and the step totals (StreamEventWorkflowFinished)', () => {
		expect(ev.workflowFinished(base, 'run-1', { answer: 'a' })).toMatchObject({
			event: 'workflow_finished',
			workflow_run_id: 'run-1',
			data: {
				id: 'run-1',
				workflow_id: expect.any(String),
				status: 'succeeded',
				outputs: { answer: 'a' },
				error: null,
				files: null,
				elapsed_time: expect.any(Number),
				total_tokens: expect.any(Number),
				total_steps: expect.any(Number),
				exceptions_count: 0,
				created_at: base.created_at,
				finished_at: base.created_at + 1,
			},
		})
		expect(ev.workflowFinished(base, 'run-1', null, null, 'boom')).toMatchObject({
			data: { status: 'failed', error: 'boom', outputs: null },
		})
	})
	it('workflow_paused carries paused_nodes and reasons (StreamEventWorkflowPaused)', () => {
		expect(
			ev.workflowPaused(base, 'run-1', ['review'], [{ TYPE: 'human_input_required' }]),
		).toMatchObject({
			event: 'workflow_paused',
			workflow_run_id: 'run-1',
			data: {
				workflow_run_id: 'run-1',
				status: 'paused',
				paused_nodes: ['review'],
				reasons: [{ TYPE: 'human_input_required' }],
				outputs: {},
				elapsed_time: expect.any(Number),
				total_tokens: expect.any(Number),
				total_steps: expect.any(Number),
			},
		})
	})
	it('human_input_required carries the form (StreamEventHumanInputRequired, GET /form/human_input response)', () => {
		const required = ev.humanInputRequired(base, 'run-1', 'ft-1', 'review', base.created_at + 3600)
		expect(required).toMatchObject({ event: 'human_input_required', workflow_run_id: 'run-1' })
		const data = required.data as {
			inputs: {
				type: string
				output_variable_name: string
				default?: unknown
				option_source?: unknown
			}[]
			actions: { id: string; title: string; button_style: string }[]
			resolved_default_values: Record<string, string>
			[key: string]: unknown
		}
		expect(data).toMatchObject({
			form_id: expect.any(String),
			form_token: 'ft-1',
			form_content: expect.any(String),
			expiration_time: base.created_at + 3600,
			display_in_ui: true,
			node_id: 'review',
			node_title: 'Review',
		})
		expect(data.inputs.map(i => [i.type, i.output_variable_name])).toEqual([
			['paragraph', 'feedback'],
			['select', 'priority'],
		])
		// A paragraph input has a constant default; a select input has option_source and no default
		// (the GET form response documents `default` for paragraph inputs only).
		expect(data.inputs[0].default).toEqual({ type: 'constant', value: '', selector: [] })
		expect(data.inputs[1]).not.toHaveProperty('default')
		expect(data.inputs[1].option_source).toEqual({
			type: 'constant',
			value: ['low', 'medium', 'high'],
			selector: [],
		})
		expect(data.actions.map(a => a.id)).toEqual(['approve', 'reject'])
		expect(
			data.actions.every(a => /^[A-Za-z_][A-Za-z0-9_]*$/.test(a.id) && a.id.length <= 20),
		).toBe(true)
		expect(data.resolved_default_values).toEqual({ feedback: '' })
	})
	it('human_input_form_filled and human_input_form_timeout carry the node and the outcome', () => {
		expect(
			ev.humanInputFormFilled(base, 'run-1', 'review', 'approve', {
				feedback: 'ok',
				priority: 'low',
			}),
		).toMatchObject({
			event: 'human_input_form_filled',
			workflow_run_id: 'run-1',
			data: {
				node_id: 'review',
				node_title: 'Review',
				action_id: 'approve',
				action_text: 'Approve',
				rendered_content: expect.stringContaining('ok'),
				submitted_data: { feedback: 'ok', priority: 'low' },
			},
		})
		expect(ev.humanInputFormTimeout(base, 'run-1', 'review', 5)).toMatchObject({
			event: 'human_input_form_timeout',
			data: { node_id: 'review', node_title: 'Review', expiration_time: 5 },
		})
	})
	it('text_chunk and the ping frame (StreamEventChatTextChunk, StreamEventChatPing)', () => {
		expect(ev.textChunk(base, 'run-1', 'hi')).toMatchObject({
			event: 'text_chunk',
			workflow_run_id: 'run-1',
			data: { text: 'hi', from_variable_selector: null },
		})
		// StreamEventChatPing is the bare `event: ping` line, with no data payload.
		expect(ev.PING_FRAME).toBe('event: ping\n\n')
		expect(ev.PING_FRAME).not.toContain('data:')
	})
	it('maps stream events to the GET /messages history items (ConversationMessageItem: AgentThoughtItem, MessageFileItem)', () => {
		const thought = ev.agentThought(base, 2, {
			thought: 't',
			tool: 'web_search',
			tool_input: '{}',
			observation: 'o',
		})
		expect(ev.toHistoryThought(thought)).toEqual({
			id: thought.id,
			message_id: 'm1',
			position: 2,
			thought: 't',
			tool: 'web_search',
			tool_input: '{}',
			tool_labels: {},
			observation: 'o',
			files: [],
			chain_id: null,
			created_at: base.created_at,
		})
		expect(ev.toHistoryResource(ev.retrieverResource(base, 1, 'Tea.'))).toMatchObject({
			id: expect.any(String),
			message_id: 'm1',
			position: 1,
			segment_id: expect.any(String),
			content: 'Tea.',
		})
		expect(ev.toHistoryFile(ev.messageFile(base, 'http://x/y.png'))).toMatchObject({
			type: 'image',
			belongs_to: 'assistant',
			url: 'http://x/y.png',
			filename: 'stub-image.png',
			mime_type: 'image/png',
			transfer_method: 'tool_file',
			upload_file_id: null,
		})
	})
})

describe('hitl scenario', () => {
	it('puts the same form in the pause reason as in human_input_required (WorkflowPaused reasons example)', () => {
		const events = chatScenario('advanced-chat', 'hitl', ctx)
		const required = events.find(e => e.event === 'human_input_required') as unknown as {
			data: Record<string, unknown>
		}
		const paused = events.find(e => e.event === 'workflow_paused') as unknown as {
			data: { paused_nodes: string[]; reasons: Record<string, unknown>[] }
		}
		expect(paused.data.paused_nodes).toEqual([REVIEW_NODE.nodeId])
		expect(paused.data.reasons).toHaveLength(1)
		expect(paused.data.reasons[0]).toMatchObject({
			TYPE: 'human_input_required',
			form_token: 'ft-1',
			form_id: required.data.form_id,
			node_id: REVIEW_NODE.nodeId,
			actions: required.data.actions,
			inputs: required.data.inputs,
			expiration_time: required.data.expiration_time,
		})
	})
})

describe('resumeScenario', () => {
	it('resumes the run: workflow_started (resumption), form filled, answer chunks, message_end, workflow_finished', () => {
		const events = resumeScenario(ctx, 'approve', { feedback: 'looks good', priority: 'high' })
		const types = events.map(e => e.event)
		expect(types[0]).toBe('workflow_started')
		expect((events[0].data as { reason: string }).reason).toBe('resumption')
		expect(types[1]).toBe('human_input_form_filled')
		expect(types.slice(-2)).toEqual(['message_end', 'workflow_finished'])
		const text = events
			.filter(e => e.event === 'message')
			.map(e => (e as { answer?: string }).answer)
		expect(text.join('')).toBe('Approved: looks good')
		for (const event of events) expect(event).toMatchObject(ctx.base)
	})
	it('answers differently when changes are requested', () => {
		const events = resumeScenario(ctx, 'reject', { feedback: 'shorter' })
		const text = events
			.filter(e => e.event === 'message')
			.map(e => (e as { answer?: string }).answer)
		expect(text.join('')).toBe('Changes requested: shorter')
	})
})

describe('runScenario', () => {
	it('streams text chunks and finishes with outputs for workflow apps', () => {
		const events = runScenario('workflow', { topic: 'tea' }, ctx)
		expect(events.map(e => e.event)[0]).toBe('workflow_started')
		expect(events.map(e => e.event)).toContain('text_chunk')
		const finished = events.at(-1) as unknown as {
			event: string
			data: { outputs: Record<string, unknown> }
		}
		expect(finished.event).toBe('workflow_finished')
		expect(finished.data.outputs).toMatchObject({ text: expect.stringContaining('tea') })
	})
	it('streams message chunks and message_end for completion apps', () => {
		expect(runScenario('completion', { topic: 'tea' }, ctx).map(e => e.event)).toEqual([
			'message',
			'message',
			'message_end',
		])
	})
	it('gives workflow events only task_id and workflow_run_id at the top level (ChunkWorkflowEvent)', () => {
		for (const event of runScenario('workflow', { topic: 'tea' }, ctx)) {
			expect(Object.keys(event).sort()).toEqual(['data', 'event', 'task_id', 'workflow_run_id'])
			expect(event).toMatchObject({ task_id: 't1', workflow_run_id: 'run-1' })
		}
	})
	it('attaches the generated file to workflow_finished (WorkflowFinishedData.files)', () => {
		const finished = runScenario('workflow', { topic: 'tea' }, ctx).at(-1) as unknown as {
			data: { files: Record<string, unknown>[] }
		}
		expect(finished.data.files).toHaveLength(1)
		expect(finished.data.files[0]).toMatchObject({
			type: 'image',
			transfer_method: 'tool_file',
			url: ctx.fileUrl,
			filename: 'stub-image.png',
			mime_type: 'image/png',
			extension: '.png',
		})
	})
	it('gives completion events task_id, message_id and created_at, but no conversation_id (ChunkCompletionEvent)', () => {
		for (const event of runScenario('completion', { topic: 'tea' }, ctx)) {
			expect(event).toMatchObject({ task_id: 't1', message_id: 'm1', created_at: 1_700_000_000 })
			expect(event).not.toHaveProperty('conversation_id')
		}
		expect(runScenario('completion', { topic: 'tea' }, ctx).at(-1)).toHaveProperty('id', 'm1')
	})
	it('streams 40 numbered chunks for a `slow` topic, paced at 100 ms (the stop tests), others at 20 ms', () => {
		const workflow = runScenario('workflow', { topic: 'slow tea' }, ctx)
		const chunks = workflow.filter(e => e.event === 'text_chunk') as unknown as {
			data: { text: string }
		}[]
		expect(chunks.map(c => c.data.text)).toStrictEqual(
			Array.from({ length: 40 }, (_, i) => `${i} `),
		)
		expect(workflow.at(-1)?.event).toBe('workflow_finished')
		const completion = runScenario('completion', { topic: 'slow tea' }, ctx)
		expect(completion.filter(e => e.event === 'message')).toHaveLength(40)
		expect(completion.at(-1)?.event).toBe('message_end')
		expect(runDelay({ topic: 'slow tea' })).toBe(100)
		expect(runDelay({ topic: 'tea' })).toBe(20)
		expect(runDelay({ topic: 'slowly' })).toBe(20)
		expect(runDelay({})).toBe(20)
	})
	it('fails an `error` topic as Dify does: workflow_finished failed (the stream ends there) or an error event', () => {
		const workflow = runScenario('workflow', { topic: 'error' }, ctx)
		expect(workflow.map(e => e.event)).toStrictEqual([
			'workflow_started',
			'node_started',
			'node_finished',
			'node_started',
			'node_finished',
			'workflow_finished',
		])
		expect(workflow.at(-1)).toMatchObject({
			data: { status: 'failed', error: 'The model is unavailable.', outputs: null },
		})
		expect(workflow.at(-2)).toMatchObject({ data: { status: 'failed' } })
		const completion = runScenario('completion', { topic: 'error' }, ctx)
		expect(completion.map(e => e.event)).toStrictEqual(['message', 'error'])
		expect(completion.at(-1)).toMatchObject({
			code: 'completion_request_error',
			message: 'The model is unavailable.',
			status: 500,
		})
	})
})

describe('parametersFor', () => {
	it('turns the optional features on for the agent and chatflow apps only', () => {
		for (const mode of ['agent-chat', 'advanced-chat'] as const) {
			const p = parametersFor(mode)
			expect(p.suggested_questions_after_answer.enabled).toBe(true)
			expect(p.file_upload.enabled).toBe(true)
			expect(p.retriever_resource.enabled).toBe(true)
		}
		for (const mode of ['chat', 'workflow', 'completion'] as const) {
			const p = parametersFor(mode)
			expect(p.suggested_questions_after_answer.enabled).toBe(false)
			expect(p.file_upload.enabled).toBe(false)
		}
	})
	it('asks for a required topic in the workflow, completion and agent apps', () => {
		for (const mode of ['workflow', 'completion', 'agent-chat'] as const) {
			expect(parametersFor(mode).user_input_form).toEqual([
				{
					'text-input': {
						label: 'Topic',
						variable: 'topic',
						required: true,
						default: '',
						max_length: 48,
					},
				},
			])
		}
		for (const mode of ['chat', 'advanced-chat'] as const) {
			expect(parametersFor(mode).user_input_form).toEqual([])
		}
	})
})
