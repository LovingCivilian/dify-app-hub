import { displayWorkflow } from '../message/display-workflow'
import { applyEvent } from '../provider/dify-chat-provider'
import {
	emptyAssistant,
	type DifyStreamEvent,
	type MessageFile,
	type WorkflowState,
} from '../provider/message'

export interface RunState {
	status: 'idle' | 'running' | 'finished' | 'failed' | 'stopped'
	runId?: string
	taskId?: string
	workflow?: WorkflowState
	text: string
	outputs?: Record<string, unknown>
	files?: MessageFile[]
	/** Dify's error text, or '' when it gave none (the view then shows its generic text). */
	error?: string
}

export const initialRunState: RunState = { status: 'idle', text: '' }

/** Workflow events: the node bookkeeping is the chat's (applyEvent), on a scratch message. */
const WORKFLOW_EVENTS = new Set([
	'workflow_started',
	'node_started',
	'node_finished',
	'node_retry',
	'workflow_paused',
])
/** Completion events that change the text or the files, folded by applyEvent as in a chat bubble. */
const MESSAGE_EVENTS = new Set(['message', 'message_replace', 'message_file'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')
const stringOf = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/**
 * A `workflow_finished` file (WorkflowFinishedData.files: free-form objects; Dify sends its file mapping,
 * the shape of a message_end file) as the message files the result shows.
 */
const toRunFile = (file: Record<string, unknown>, index: number): MessageFile => {
	const filename = stringOf(file.filename)
	const mimeType = stringOf(file.mime_type)
	return {
		id: stringOf(file.id) ?? stringOf(file.related_id) ?? String(index),
		type: stringOf(file.type) ?? 'custom',
		url: stringOf(file.url) ?? stringOf(file.remote_url) ?? '',
		belongsTo: 'assistant',
		...(filename && { filename }),
		...(typeof file.size === 'number' && { size: file.size }),
		...(mimeType && { mimeType }),
	}
}

const workflowAfter = (state: RunState, event: DifyStreamEvent) =>
	applyEvent({ ...emptyAssistant(), workflow: state.workflow }, event).workflow

/**
 * ChunkWorkflowEvent and ChunkCompletionEvent → one run state (spec §4.8). Pure. `text_chunk` appends its
 * text; a single string output is the result (it is final, the chunks may be partial); completion apps use
 * `message`/`message_end`. A stopped run takes no further event, and a finished or failed run stays so.
 */
export const reduceRunEvent = (state: RunState, event: DifyStreamEvent): RunState => {
	if (state.status === 'stopped') return state
	const data = isRecord(event.data) ? event.data : {}
	const live = {
		status: state.status === 'idle' ? ('running' as const) : state.status,
		taskId: event.task_id ?? state.taskId,
		runId: event.workflow_run_id ?? state.runId,
	}
	if (WORKFLOW_EVENTS.has(event.event)) {
		return { ...state, ...live, workflow: workflowAfter(state, event) }
	}
	if (MESSAGE_EVENTS.has(event.event)) {
		const message = applyEvent(
			{ ...emptyAssistant(), content: state.text, files: state.files },
			event,
		)
		return { ...state, ...live, text: message.content, files: message.files }
	}
	switch (event.event) {
		case 'text_chunk':
			return { ...state, ...live, text: state.text + textOf(data.text) }
		case 'message_end':
			return { ...state, ...live, status: live.status === 'running' ? 'finished' : live.status }
		case 'workflow_finished': {
			const outputs = isRecord(data.outputs) ? data.outputs : undefined
			const values = outputs ? Object.values(outputs) : []
			const single = values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined
			const failed = data.status === 'failed' || Boolean(data.error)
			return {
				...state,
				...live,
				status: failed ? 'failed' : data.status === 'stopped' ? 'stopped' : 'finished',
				workflow: workflowAfter(state, event),
				outputs,
				files: Array.isArray(data.files) ? data.files.filter(isRecord).map(toRunFile) : [],
				error: failed ? textOf(data.error) : state.error,
				text: single ?? state.text,
			}
		}
		case 'error':
			// Dify's text, else one an earlier event gave (a failed workflow_finished), else ''.
			return {
				...state,
				...live,
				status: 'failed',
				error: textOf(event.message) || state.error || '',
			}
		default:
			// ping, tts_message*, iteration_*, loop_*, agent_log, reasoning_chunk: nothing the run view shows.
			return state
	}
}

/**
 * The run's workflow as WorkflowLogs shows it: a run that ended without `workflow_finished` (stopped, a
 * stream error, a stream that closed early) would keep spinning, so the chat's displayWorkflow shows it
 * failed with its unfinished nodes as errors; the stopped caption comes from the view.
 */
export const displayRunWorkflow = (state: RunState): WorkflowState | undefined =>
	displayWorkflow({
		workflow: state.workflow,
		aborted: state.status !== 'running' && state.status !== 'idle',
	})
