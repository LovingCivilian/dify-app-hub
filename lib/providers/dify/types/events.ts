/** The 29 stream event names of Dify 1.17.1 (`StreamEvent` enum; endpoint map §3). */
export const STREAM_EVENTS = [
	'ping',
	'error',
	'message',
	'message_end',
	'tts_message',
	'tts_message_end',
	'message_file',
	'message_replace',
	'agent_thought',
	'agent_message',
	'workflow_started',
	'workflow_paused',
	'workflow_finished',
	'node_started',
	'node_finished',
	'node_retry',
	'iteration_started',
	'iteration_next',
	'iteration_completed',
	'loop_started',
	'loop_next',
	'loop_completed',
	'text_chunk',
	'text_replace',
	'reasoning_chunk',
	'agent_log',
	'human_input_required',
	'human_input_form_filled',
	'human_input_form_timeout',
] as const
export type StreamEventName = (typeof STREAM_EVENTS)[number]

/** Fields every `data:` payload may carry; the rest is per event (the chat's DifyStreamEvent widens this). */
export interface StreamEventBase {
	event: StreamEventName | string
	task_id?: string
	message_id?: string
	conversation_id?: string
	created_at?: number
	workflow_run_id?: string
}

/** A mid-stream failure; the HTTP status stays 200 (endpoint map §4). */
export interface StreamErrorEvent extends StreamEventBase {
	event: 'error'
	status: number
	code: string
	message: string
}
