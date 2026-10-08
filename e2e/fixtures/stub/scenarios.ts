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

/** The `chain` scenario's second Human Input node: answering the first form pauses the run here. */
export const SECOND_REVIEW_NODE: StubNode = {
	id: 'exec-review-2',
	nodeId: 'review-2',
	type: 'human-input',
	title: 'Second review',
	index: 3,
}

/** The chatflow's reasoning, one `reasoning_chunk` each (the last is final). */
export const REASONING = [
	'The user greets me. ',
	'A greeting needs no lookup, ',
	'and nothing in the inputs asks for more, ',
	'so a short reply is enough.',
]

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
			// `expired`: the form arrives already past its expiration_time (Review Focus 5). `email`: the node
			// delivers the form elsewhere, so the stream carries no token (OpenAPI: `form_token` null).
			const required = ev.humanInputRequired(
				base,
				runId,
				hasWord(query, 'email') ? null : formToken,
				REVIEW_NODE.nodeId,
				base.created_at + (hasWord(query, 'expired') ? -60 : 3600),
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
		if (has(query, 'nodefail')) {
			// OpenAPI, POST /chat-messages, Chatflow failure: workflow_finished with status failed, then
			// error; no message_end.
			const failure = 'The model is unavailable.'
			return [
				ev.workflowStarted(base, runId),
				ev.nodeStarted(base, runId, NODES[0]),
				ev.nodeFinished(base, runId, NODES[0], { query }),
				ev.nodeStarted(base, runId, NODES[1]),
				ev.nodeFinished(base, runId, NODES[1], {}, 'failed', failure),
				ev.workflowFinished(base, runId, null, null, failure),
				ev.errorEvent(base, 'completion_request_error', failure, 500),
			]
		}
		const retry = has(query, 'retry') ? [ev.nodeRetry(base, runId, NODES[1], 1)] : []
		return [
			ev.workflowStarted(base, runId),
			ev.nodeStarted(base, runId, NODES[0]),
			ev.nodeFinished(base, runId, NODES[0], { query }),
			ev.nodeStarted(base, runId, NODES[1]),
			...retry,
			...REASONING.map((text, i) => ev.reasoningChunk(base, text, i === REASONING.length - 1)),
			ev.message(base, 'Echo: '),
			ev.message(base, query),
			ev.nodeFinished(base, runId, NODES[1], { text: answer }),
			ev.messageEnd(base),
			ev.workflowFinished(base, runId, { answer }),
		]
	}
	return [ev.message(base, 'Echo: '), ev.message(base, query), ev.messageEnd(base)]
}

/**
 * Milliseconds between the events of a chat stream. The slow stream (stop tests) and the streams that
 * carry reasoning (`reasoning_chunk` events, or a `<think>` block in the answer) are paced at 100 ms, so
 * the browser renders the reasoning while it is still open: events that arrive together on a busy page
 * are rendered at once. Everything else streams at 20 ms.
 */
export const streamDelay = (query: string, events: StreamEvent[]) =>
	hasWord(query, 'slow') ||
	events.some(
		e =>
			e.event === 'reasoning_chunk' ||
			(e.event === 'message' &&
				String((e as { answer?: string }).answer ?? '').includes('<think>')),
	)
		? 100
		: 20

/**
 * The resumed run after a HITL submission, as Dify publishes it to the run's listeners (GET
 * /workflow/{run_id}/events). `node` is the answered form's node; with `next` (the `chain` scenario) the run
 * pauses again at SECOND_REVIEW_NODE on that form instead of answering.
 */
export const resumeScenario = (
	ctx: ScenarioContext,
	action: string,
	inputs: Record<string, string>,
	options: { node?: StubNode; next?: { formToken: string; expiresAt: number } } = {},
): StreamEvent[] => {
	const { base, runId } = ctx
	const node = options.node ?? REVIEW_NODE
	const opening = [
		ev.workflowStarted(base, runId, 'resumption'),
		ev.humanInputFormFilled(base, runId, node.nodeId, action, inputs),
		ev.nodeFinished(base, runId, node, inputs),
	]
	if (options.next) {
		const required = ev.humanInputRequired(
			base,
			runId,
			options.next.formToken,
			SECOND_REVIEW_NODE.nodeId,
			options.next.expiresAt,
		)
		return [
			...opening,
			ev.nodeStarted(base, runId, SECOND_REVIEW_NODE),
			required,
			ev.workflowPaused(base, runId, [SECOND_REVIEW_NODE.nodeId], [ev.pauseReason(required)]),
		]
	}
	const text =
		action === 'approve'
			? `Approved: ${inputs.feedback ?? ''}`.trim()
			: `Changes requested: ${inputs.feedback ?? ''}`.trim()
	return [
		...opening,
		ev.nodeStarted(base, runId, NODES[1]),
		...chunks(text, 12).map(c => ev.message(base, c)),
		ev.nodeFinished(base, runId, NODES[1], { text }),
		ev.messageEnd(base),
		ev.workflowFinished(base, runId, { answer: text }),
	]
}

/**
 * Dify's replay of a chatflow run for `include_state_snapshot=true` (1.17.1,
 * services/workflow_event_snapshot_service.py `_build_snapshot_events`): workflow_started with reason `initial`,
 * message_replace with the stored answer, each stored node's started and finished events without details, and for a
 * paused run the form's human_input_required and workflow_paused. `paused` is the form the run waits on (its node is
 * stored `paused`); without it the run goes on and the replay stops at the nodes.
 */
export const snapshotScenario = (
	ctx: ScenarioContext,
	answer: string,
	passed: StubNode[],
	paused?: { node: StubNode; formToken: string; expiresAt: number },
): StreamEvent[] => {
	const { base, runId } = ctx
	const nodes = [NODES[0], ...passed].flatMap(node => [
		ev.nodeStarted(base, runId, node),
		ev.replayedNodeFinished(base, runId, node, 'succeeded'),
	])
	const replay = [ev.workflowStarted(base, runId), ev.messageReplace(base, answer), ...nodes]
	if (!paused) return replay
	const required = ev.humanInputRequired(
		base,
		runId,
		paused.formToken,
		paused.node.nodeId,
		paused.expiresAt,
	)
	return [
		...replay,
		ev.nodeStarted(base, runId, paused.node),
		ev.replayedNodeFinished(base, runId, paused.node, 'paused'),
		required,
		ev.workflowPaused(base, runId, [paused.node.nodeId], [ev.pauseReason(required)]),
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

const topicOf = (inputs: Record<string, unknown>) =>
	String(inputs.topic ?? Object.values(inputs)[0] ?? 'nothing')

/** Milliseconds between the events of a run: a `slow` topic (the stop tests) is paced at 100 ms, the rest at 20 ms. */
export const runDelay = (inputs: Record<string, unknown>) =>
	hasWord(topicOf(inputs), 'slow') ? 100 : 20

/**
 * Workflow and completion apps: the stream for POST /workflows/run and POST /completion-messages, chosen
 * by the topic. `slow` streams 40 numbered chunks (paced by runDelay); `error` fails the run as Dify does
 * (OpenAPI "Stream lifecycle": a workflow stream closes after `workflow_finished`, here with status
 * `failed`; a completion stream ends early with an `error` event). The router refuses an `invalid` topic.
 */
export const runScenario = (
	mode: StubMode,
	inputs: Record<string, unknown>,
	ctx: ScenarioContext,
): StreamEvent[] => {
	const { base, runId, fileUrl } = ctx
	const topic = topicOf(inputs)
	const text = `A short note about ${topic}.`
	const slow = hasWord(topic, 'slow')
	const failure = hasWord(topic, 'error') ? 'The model is unavailable.' : undefined
	const numbered = Array.from({ length: 40 }, (_, i) => `${i} `)
	if (mode === 'completion') {
		if (failure) {
			return shapeFor(mode, [
				ev.message(base, 'A short note '),
				ev.errorEvent(base, 'completion_request_error', failure, 500),
			])
		}
		if (slow) {
			return shapeFor(mode, [...numbered.map(c => ev.message(base, c)), ev.messageEnd(base)])
		}
		return shapeFor(mode, [
			ev.message(base, 'A short note '),
			ev.message(base, `about ${topic}.`),
			ev.messageEnd(base),
		])
	}
	if (failure) {
		return shapeFor(mode, [
			ev.workflowStarted(base, runId),
			ev.nodeStarted(base, runId, NODES[0]),
			ev.nodeFinished(base, runId, NODES[0], inputs),
			ev.nodeStarted(base, runId, NODES[1]),
			ev.nodeFinished(base, runId, NODES[1], {}, 'failed', failure),
			ev.workflowFinished(base, runId, null, null, failure),
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
		...(slow ? numbered : chunks(text, 10)).map(c => ev.textChunk(base, runId, c)),
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
			mode === 'workflow' || mode === 'completion' || mode === 'agent-chat'
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
