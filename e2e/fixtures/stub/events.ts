import { STUB_PNG } from './assets'

/**
 * Stream events shaped after Dify's OpenAPI document (langgenius/dify-docs → en/api-reference/openapi_service.json):
 * ChunkChatEvent / ChunkWorkflowEvent / ChunkCompletionEvent unions, StreamEventBase (task_id, message_id,
 * conversation_id, created_at). The schema each builder follows is named above it.
 */
export interface StreamBase {
	task_id: string
	message_id: string
	conversation_id: string
	created_at: number
}

/** `task_id` is on every event; the other base fields depend on the app (see `shapeFor` in scenarios.ts). */
export type StreamEvent = { event: string; task_id: string } & Partial<
	Omit<StreamBase, 'task_id'>
> &
	Record<string, unknown>

export interface StubNode {
	id: string
	nodeId: string
	type: string
	title: string
	index: number
}

const withBase = (
	base: StreamBase,
	event: string,
	fields: Record<string, unknown>,
): StreamEvent => ({
	event,
	...base,
	...fields,
})

/** StreamEventChatMessage (chat, chatflow) and StreamEventMessage (completion). */
export const message = (base: StreamBase, answer: string) => withBase(base, 'message', { answer })
/** StreamEventChatAgentMessage. */
export const agentMessage = (base: StreamBase, answer: string) =>
	withBase(base, 'agent_message', { answer })
/** StreamEventChatMessageReplace. */
export const messageReplace = (base: StreamBase, answer: string) =>
	withBase(base, 'message_replace', { answer })
/** StreamEventChatMessageEnd (completion: StreamEventMessageEnd). */
export const messageEnd = (base: StreamBase, retrieverResources: unknown[] = []) =>
	withBase(base, 'message_end', {
		id: base.message_id,
		metadata: {
			usage: {
				prompt_tokens: 10,
				completion_tokens: 20,
				total_tokens: 30,
				total_price: '0.0001',
				currency: 'USD',
				latency: 0.42,
			},
			retriever_resources: retrieverResources,
		},
	})
/** StreamEventChatMessageFile. */
export const messageFile = (base: StreamBase, url: string) =>
	withBase(base, 'message_file', {
		id: `file-${base.message_id}`,
		type: 'image',
		belongs_to: 'assistant',
		url,
	})
/** StreamEventChatError. */
export const errorEvent = (base: StreamBase, code: string, text: string, status: number) =>
	withBase(base, 'error', { code, message: text, status })
/** StreamEventChatAgentThought. */
export const agentThought = (
	base: StreamBase,
	position: number,
	fields: { thought: string; tool?: string; tool_input?: string; observation?: string },
) =>
	withBase(base, 'agent_thought', {
		id: `thought-${base.message_id}-${position}`,
		position,
		thought: fields.thought,
		tool: fields.tool ?? '',
		tool_input: fields.tool_input ?? '',
		observation: fields.observation ?? '',
		message_files: [],
	})
/** StreamEventChatReasoningChunk (`data.is_final` closes the reasoning). */
export const reasoningChunk = (base: StreamBase, reasoning: string, isFinal = false) =>
	withBase(base, 'reasoning_chunk', {
		data: { reasoning, is_final: isFinal, message_id: base.message_id, node_id: 'llm-1' },
	})
/** StreamEventWorkflowStarted (`data.reason`: initial | resumption). */
export const workflowStarted = (
	base: StreamBase,
	runId: string,
	reason: 'initial' | 'resumption' = 'initial',
) =>
	withBase(base, 'workflow_started', {
		workflow_run_id: runId,
		data: { id: runId, workflow_id: 'wf-1', inputs: {}, created_at: base.created_at, reason },
	})
/** StreamEventNodeStarted. */
export const nodeStarted = (base: StreamBase, runId: string, node: StubNode) =>
	withBase(base, 'node_started', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			inputs: null,
			created_at: base.created_at,
			extras: {},
			iteration_id: null,
			loop_id: null,
		},
	})
/** StreamEventNodeFinished. */
export const nodeFinished = (
	base: StreamBase,
	runId: string,
	node: StubNode,
	outputs: Record<string, unknown>,
	status: 'succeeded' | 'failed' = 'succeeded',
	error: string | null = null,
) =>
	withBase(base, 'node_finished', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			status,
			inputs: { query: 'hello' },
			process_data: { prompt: 'system' },
			outputs,
			elapsed_time: 0.42,
			execution_metadata: { total_tokens: 12, total_price: 0.0001, currency: 'USD' },
			error,
			files: null,
			created_at: base.created_at,
			finished_at: base.created_at + 1,
		},
	})
/**
 * A node as Dify's replay for `include_state_snapshot` restates it (1.17.1, services/workflow_event_snapshot_service.py
 * `_build_node_finished_event`): the stored status and timing, every detail null (`to_ignore_detail_dict`). A Human
 * Input node waiting on its form is stored `paused`.
 */
export const replayedNodeFinished = (
	base: StreamBase,
	runId: string,
	node: StubNode,
	status: 'succeeded' | 'paused',
) =>
	withBase(base, 'node_finished', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			predecessor_node_id: null,
			inputs: null,
			process_data: null,
			outputs: null,
			status,
			error: null,
			elapsed_time: 0.42,
			execution_metadata: null,
			created_at: base.created_at,
			finished_at: base.created_at + 1,
			files: [],
			iteration_id: null,
			loop_id: null,
		},
	})
/** StreamEventNodeRetry. */
export const nodeRetry = (base: StreamBase, runId: string, node: StubNode, attempt: number) =>
	withBase(base, 'node_retry', {
		workflow_run_id: runId,
		data: {
			id: node.id,
			node_id: node.nodeId,
			node_type: node.type,
			title: node.title,
			index: node.index,
			retry_index: attempt,
			status: 'retry',
			error: 'upstream timeout',
			elapsed_time: 0.2,
			execution_metadata: null,
			files: null,
			inputs: null,
			created_at: base.created_at,
			finished_at: base.created_at,
		},
	})
/** StreamEventWorkflowFinished. */
export const workflowFinished = (
	base: StreamBase,
	runId: string,
	outputs: Record<string, unknown> | null,
	files: unknown[] | null = null,
	error: string | null = null,
) =>
	withBase(base, 'workflow_finished', {
		workflow_run_id: runId,
		data: {
			id: runId,
			workflow_id: 'wf-1',
			status: error ? 'failed' : 'succeeded',
			outputs,
			error,
			elapsed_time: 1.2,
			total_tokens: 30,
			total_steps: 2,
			exceptions_count: 0,
			files,
			created_at: base.created_at,
			finished_at: base.created_at + 1,
		},
	})
/** StreamEventWorkflowPaused (WorkflowStreamEventWorkflowPaused adds `workflow_run_id` at the top level). */
export const workflowPaused = (
	base: StreamBase,
	runId: string,
	pausedNodes: string[],
	reasons: Record<string, unknown>[] = [],
) =>
	withBase(base, 'workflow_paused', {
		workflow_run_id: runId,
		data: {
			workflow_run_id: runId,
			status: 'paused',
			paused_nodes: pausedNodes,
			reasons,
			outputs: {},
			elapsed_time: 0.8,
			total_tokens: 12,
			total_steps: 1,
			created_at: base.created_at,
		},
	})
/**
 * StreamEventHumanInputRequired. The stream schema documents only `default`, `output_variable_name` and `type` per
 * input. The select input also carries `option_source`, which the document lists only on GET
 * /form/human_input. langgenius/dify sends it in the stream as well (`HumanInputRequiredResponse.Data.inputs` is
 * the node's full `FormInputConfig`), and the chat form reads it from here (ADR-0017 note, 2026-10-05).
 * `form_token` is null "when the Human Input node uses Email or Console delivery".
 */
export const humanInputRequired = (
	base: StreamBase,
	runId: string,
	formToken: string | null,
	nodeId: string,
	expiresAt: number,
) =>
	withBase(base, 'human_input_required', {
		workflow_run_id: runId,
		data: {
			form_id: `form-${formToken ?? runId}`,
			form_token: formToken,
			form_content: 'Please review the draft and approve it or request changes.',
			inputs: [
				{
					type: 'paragraph',
					output_variable_name: 'feedback',
					default: { type: 'constant', value: '', selector: [] },
				},
				{
					type: 'select',
					output_variable_name: 'priority',
					option_source: { type: 'constant', value: ['low', 'medium', 'high'], selector: [] },
				},
			],
			actions: [
				{ id: 'approve', title: 'Approve', button_style: 'primary' },
				{ id: 'reject', title: 'Request changes', button_style: 'default' },
			],
			resolved_default_values: { feedback: '' },
			expiration_time: expiresAt,
			display_in_ui: true,
			node_id: nodeId,
			node_title: 'Review',
		},
	})
/** The `reasons[]` item of workflow_paused for a human-input pause (the form without `display_in_ui`, plus `TYPE`). */
export const pauseReason = (required: StreamEvent): Record<string, unknown> => {
	const { display_in_ui: _displayInUi, ...form } = required.data as Record<string, unknown>
	return { TYPE: 'human_input_required', ...form }
}
/** StreamEventHumanInputFormFilled. */
export const humanInputFormFilled = (
	base: StreamBase,
	runId: string,
	nodeId: string,
	action: string,
	inputs: Record<string, string>,
) =>
	withBase(base, 'human_input_form_filled', {
		workflow_run_id: runId,
		data: {
			node_id: nodeId,
			node_title: 'Review',
			action_id: action,
			action_text: action === 'approve' ? 'Approve' : 'Request changes',
			rendered_content: `Review: ${inputs.feedback ?? ''} (${inputs.priority ?? ''})`,
			submitted_data: inputs,
		},
	})
/**
 * An `extra_contents` item of GET /messages (HumanInputContent) for a form still waiting: the definition is the
 * human_input_required payload (HumanInputFormDefinition has the same fields), and nothing is submitted yet.
 */
export const pendingHumanInputContent = (required: StreamEvent) => ({
	type: 'human_input',
	workflow_run_id: required.workflow_run_id,
	submitted: false,
	form_definition: required.data,
	form_submission_data: null,
})
/**
 * The same item once the form is submitted. HumanInputContent: `form_definition` is "`null` when the content
 * represents a submission response"; HumanInputFormSubmissionData holds what human_input_form_filled carries,
 * without `submitted_data`.
 */
export const submittedHumanInputContent = (
	runId: string,
	nodeId: string,
	action: string,
	inputs: Record<string, string>,
) => {
	const filled = humanInputFormFilled(
		{ task_id: '', message_id: '', conversation_id: '', created_at: 0 },
		runId,
		nodeId,
		action,
		inputs,
	)
	const { submitted_data: _submittedData, ...submission } = filled.data as Record<string, unknown>
	return {
		type: 'human_input',
		workflow_run_id: runId,
		submitted: true,
		form_definition: null,
		form_submission_data: submission,
	}
}
/** StreamEventHumanInputFormTimeout. */
export const humanInputFormTimeout = (
	base: StreamBase,
	runId: string,
	nodeId: string,
	expiresAt: number,
) =>
	withBase(base, 'human_input_form_timeout', {
		workflow_run_id: runId,
		data: { node_id: nodeId, node_title: 'Review', expiration_time: expiresAt },
	})
/** StreamEventChatTextChunk (workflow: StreamEventTextChunk). */
export const textChunk = (base: StreamBase, runId: string, text: string) =>
	withBase(base, 'text_chunk', {
		workflow_run_id: runId,
		data: { text, from_variable_selector: null },
	})
/**
 * StreamEventChatPing is the bare keep-alive line `event: ping` (no `data:`); the OpenAPI `text/event-stream`
 * examples open the streams of workflow-based apps with it. `sse` in router.ts writes it.
 */
export const PING_FRAME = 'event: ping\n\n'

/**
 * One `metadata.retriever_resources` item of message_end, as streamed: the OpenAPI streaming example's
 * items carry no `id` (that is the stored row's, see toHistoryResource).
 */
export const retrieverResource = (base: StreamBase, position: number, content: string) => ({
	message_id: base.message_id,
	position,
	dataset_id: 'ds-1',
	dataset_name: 'Handbook',
	document_id: `doc-${position}`,
	document_name: `handbook-${position}.md`,
	data_source_type: 'upload_file',
	segment_id: `seg-${position}`,
	score: 0.9 - position / 10,
	hit_count: 3,
	word_count: content.length,
	segment_position: position,
	index_node_hash: 'abcdef1234567890',
	content,
	created_at: base.created_at,
})

/** A `retriever_resources` item of GET /messages (RetrieverResource): the streamed item with its row id. */
export const toHistoryResource = (resource: ReturnType<typeof retrieverResource>) => ({
	id: `rr-${resource.message_id}-${resource.position}`,
	...resource,
})

/** An `agent_thoughts` item of GET /messages (OpenAPI: AgentThoughtItem) from the agent_thought stream event. */
export const toHistoryThought = (event: StreamEvent) => ({
	id: event.id,
	message_id: event.message_id,
	position: event.position,
	thought: event.thought,
	tool: event.tool,
	tool_input: event.tool_input,
	tool_labels: {},
	observation: event.observation,
	files: event.message_files,
	chain_id: null,
	created_at: event.created_at,
})

/** A `message_files` item of GET /messages (OpenAPI: MessageFileItem) from the message_file stream event. */
export const toHistoryFile = (event: StreamEvent) => ({
	id: event.id,
	type: event.type,
	belongs_to: event.belongs_to,
	url: event.url,
	filename: 'stub-image.png',
	mime_type: 'image/png',
	size: STUB_PNG.length,
	transfer_method: 'tool_file',
	upload_file_id: null,
})
