import { MARKDOWN_SAMPLES } from '../markdown-samples'
import type { StubMode } from './apps'
import { STUB_PNG } from './assets'
import * as ev from './events'
import type { StreamBase, StreamEvent, StubNode } from './events'

export interface ScenarioContext {
	base: StreamBase
	runId: string
	formToken: string
	fileUrl: string
}

const NODES: StubNode[] = [
	{ id: 'exec-start', nodeId: 'start', type: 'start', title: 'Start', index: 1 },
	{ id: 'exec-llm', nodeId: 'llm-1', type: 'llm', title: 'Answer', index: 2 },
]
export const REVIEW_NODE: StubNode = {
	id: 'exec-review',
	nodeId: 'review',
	type: 'human-input',
	title: 'Review',
	index: 2,
}

export const answerFor = (query: string) => `Echo: ${query}`
export const has = (query: string, word: string) => query.toLowerCase().includes(word)
/** Whole-word match, so the `slowhistory` marker of the race spec does not trigger the `slow` stream. */
export const hasWord = (query: string, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(query)

const chunks = (text: string, size = 24) => {
	const out: string[] = []
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
	return out.length ? out : ['']
}

/** `md:<sample name>` (a key of MARKDOWN_SAMPLES) streams that sample; any other query is not a sample. */
const markdownSample = (query: string) => {
	const name = /^md:(\w+)$/.exec(query.trim())?.[1]
	return name && Object.hasOwn(MARKDOWN_SAMPLES, name)
		? MARKDOWN_SAMPLES[name as keyof typeof MARKDOWN_SAMPLES]
		: undefined
}

/**
 * Chat-like apps: the stream for POST /chat-messages, chosen by the query text. The first query of a
 * conversation is its name, so a conversation named `slowhistory…` makes the router delay its history.
 */
export const chatScenario = (
	mode: StubMode,
	query: string,
	ctx: ScenarioContext,
): StreamEvent[] => {
	const { base, runId, formToken, fileUrl } = ctx
	const answer = answerFor(query)
	const sample = markdownSample(query)
	if (sample !== undefined) {
		return [...chunks(sample, 40).map(c => ev.message(base, c)), ev.messageEnd(base)]
	}
	if (has(query, 'error')) {
		return [
			ev.message(base, 'Echo: '),
			ev.errorEvent(base, 'completion_request_error', 'The model is unavailable.', 500),
		]
	}
	if (has(query, 'markdown')) {
		return [
			...chunks(MARKDOWN_SAMPLES.streaming, 40).map(c => ev.message(base, c)),
			ev.messageEnd(base),
		]
	}
	if (hasWord(query, 'slow')) {
		return [...Array.from({ length: 40 }, (_, i) => ev.message(base, `${i} `)), ev.messageEnd(base)]
	}
	if (has(query, 'files'))
		return [ev.message(base, answer), ev.messageFile(base, fileUrl), ev.messageEnd(base)]
	if (has(query, 'cite')) {
		return [
			ev.message(base, answer),
			ev.messageEnd(base, [
				ev.retrieverResource(base, 1, 'Tea is brewed at 80 °C.'),
				ev.retrieverResource(base, 2, 'Steep for three minutes.'),
			]),
		]
	}
	if (mode === 'agent-chat') {
		return [
			ev.agentThought(base, 1, { thought: 'I should look this up.' }),
			ev.agentThought(base, 2, {
				thought: '',
				tool: 'web_search',
				tool_input: '{"q":"hello"}',
				observation: '{"results":["one","two"]}',
			}),
			ev.agentMessage(base, 'Echo: '),
			ev.agentMessage(base, query),
			ev.messageEnd(base),
		]
	}
	if (mode === 'advanced-chat') {
		if (has(query, 'hitl')) {
			const required = ev.humanInputRequired(
				base,
				runId,
				formToken,
				REVIEW_NODE.nodeId,
				base.created_at + 3600,
			)
			return [
				ev.workflowStarted(base, runId),
				ev.nodeStarted(base, runId, NODES[0]),
				ev.nodeFinished(base, runId, NODES[0], { query }),
				ev.nodeStarted(base, runId, REVIEW_NODE),
				required,
				ev.workflowPaused(base, runId, [REVIEW_NODE.nodeId], [ev.pauseReason(required)]),
			]
		}
		const retry = has(query, 'retry') ? [ev.nodeRetry(base, runId, NODES[1], 1)] : []
		return [
			ev.workflowStarted(base, runId),
			ev.nodeStarted(base, runId, NODES[0]),
			ev.nodeFinished(base, runId, NODES[0], { query }),
			ev.nodeStarted(base, runId, NODES[1]),
			...retry,
			ev.reasoningChunk(base, 'The user greets me. '),
			ev.reasoningChunk(base, 'A short reply is enough.', true),
			ev.message(base, 'Echo: '),
			ev.message(base, query),
			ev.nodeFinished(base, runId, NODES[1], { text: answer }),
			ev.messageEnd(base),
			ev.workflowFinished(base, runId, { answer }),
		]
	}
	return [ev.message(base, 'Echo: '), ev.message(base, query), ev.messageEnd(base)]
}

/** The resumed stream for GET /workflow/{run_id}/events after a HITL submission. */
export const resumeScenario = (
	ctx: ScenarioContext,
	action: string,
	inputs: Record<string, string>,
): StreamEvent[] => {
	const { base, runId } = ctx
	const text =
		action === 'approve'
			? `Approved: ${inputs.feedback ?? ''}`.trim()
			: `Changes requested: ${inputs.feedback ?? ''}`.trim()
	return [
		ev.workflowStarted(base, runId, 'resumption'),
		ev.humanInputFormFilled(base, runId, REVIEW_NODE.nodeId, action, inputs),
		ev.nodeFinished(base, runId, REVIEW_NODE, inputs),
		ev.nodeStarted(base, runId, NODES[1]),
		...chunks(text, 12).map(c => ev.message(base, c)),
		ev.nodeFinished(base, runId, NODES[1], { text }),
		ev.messageEnd(base),
		ev.workflowFinished(base, runId, { answer: text }),
	]
}

const without = (event: StreamEvent, keys: string[]): StreamEvent =>
	Object.fromEntries(Object.entries(event).filter(([key]) => !keys.includes(key))) as StreamEvent

/**
 * The top-level fields a mode's events carry in the OpenAPI document: ChunkWorkflowEvent has only `task_id`
 * and `workflow_run_id` (WorkflowStreamEventBase); ChunkCompletionEvent has `task_id`, `message_id` and
 * `created_at` (CompletionStreamEventBase); ChunkChatEvent has all four base fields.
 */
const shapeFor = (mode: StubMode, events: StreamEvent[]): StreamEvent[] => {
	if (mode === 'workflow') {
		return events.map(e => without(e, ['message_id', 'conversation_id', 'created_at']))
	}
	if (mode === 'completion') return events.map(e => without(e, ['conversation_id']))
	return events
}

/** Workflow and completion apps: the stream for POST /workflows/run and POST /completion-messages. */
export const runScenario = (
	mode: StubMode,
	inputs: Record<string, unknown>,
	ctx: ScenarioContext,
): StreamEvent[] => {
	const { base, runId, fileUrl } = ctx
	const topic = String(inputs.topic ?? Object.values(inputs)[0] ?? 'nothing')
	const text = `A short note about ${topic}.`
	if (mode === 'completion') {
		return shapeFor(mode, [
			ev.message(base, 'A short note '),
			ev.message(base, `about ${topic}.`),
			ev.messageEnd(base),
		])
	}
	// WorkflowFinishedData.files items are free-form objects; this one follows the documented message_end `files` item.
	const file = {
		type: 'image',
		transfer_method: 'tool_file',
		url: fileUrl,
		filename: 'stub-image.png',
		mime_type: 'image/png',
		extension: '.png',
		size: STUB_PNG.length,
		related_id: `file-${base.message_id}`,
		remote_url: '',
	}
	return shapeFor(mode, [
		ev.workflowStarted(base, runId),
		ev.nodeStarted(base, runId, NODES[0]),
		ev.nodeFinished(base, runId, NODES[0], inputs),
		ev.nodeStarted(base, runId, NODES[1]),
		...chunks(text, 10).map(c => ev.textChunk(base, runId, c)),
		ev.nodeFinished(base, runId, NODES[1], { text }),
		ev.workflowFinished(base, runId, { text }, [file]),
	])
}

/** Parameters per mode (GET /parameters). The agent and chatflow apps turn the optional features on. */
export const parametersFor = (mode: StubMode) => {
	const rich = mode === 'agent-chat' || mode === 'advanced-chat'
	return {
		opening_statement: mode === 'chat' ? 'Hello from the stub' : `Hello from the stub ${mode}`,
		suggested_questions: ['What can you do?', 'Tell me a joke'],
		suggested_questions_after_answer: { enabled: rich },
		speech_to_text: { enabled: rich },
		text_to_speech: { enabled: rich, autoPlay: 'disabled', language: 'en-US', voice: 'alloy' },
		retriever_resource: { enabled: rich },
		annotation_reply: { enabled: false },
		user_input_form:
			mode === 'workflow' || mode === 'completion'
				? [
						{
							'text-input': {
								label: 'Topic',
								variable: 'topic',
								required: true,
								default: '',
								max_length: 48,
							},
						},
					]
				: [],
		file_upload: {
			enabled: rich,
			allowed_file_types: ['image', 'document'],
			allowed_file_extensions: ['.png', '.jpg', '.pdf', '.txt'],
			allowed_file_upload_methods: ['local_file'],
			number_limits: 3,
			fileUploadConfig: {
				file_size_limit: 15,
				batch_count_limit: 5,
				image_file_size_limit: 10,
				video_file_size_limit: 100,
				audio_file_size_limit: 50,
				workflow_file_upload_limit: 10,
			},
			image: { enabled: rich, number_limits: 3, transfer_methods: ['local_file'] },
		},
		system_parameters: {
			file_size_limit: 15,
			image_file_size_limit: 10,
			audio_file_size_limit: 50,
			video_file_size_limit: 100,
		},
	}
}
