import { AbstractChatProvider } from '@ant-design/x-sdk'
import type {
	ChatProviderConfig,
	SSEOutput,
	TransformMessage,
	XRequestOptions,
} from '@ant-design/x-sdk'

import type { AgentThought, RetrieverResource } from '@/lib/dify/types'

import {
	emptyAssistant,
	type DifyChatInput,
	type DifyChatMessage,
	type DifyStreamEvent,
	type HumanInputAction,
	type HumanInputField,
	type WorkflowNode,
	type WorkflowState,
} from './message'

type NodeData = {
	id: string
	node_id?: string
	node_type?: string
	title?: string
	index?: number
	status?: string
	inputs?: Record<string, unknown> | null
	outputs?: Record<string, unknown> | null
	process_data?: Record<string, unknown> | null
	elapsed_time?: number
	execution_metadata?: { total_tokens?: number } | null
	error?: string | null
	retry_index?: number
}

const WORKFLOW_EVENTS = new Set([
	'workflow_started',
	'node_started',
	'node_finished',
	'node_retry',
	'workflow_finished',
	'workflow_paused',
])

/** StreamEventBase: every event refreshes the ids and the creation time it carries (`error` has no task_id). */
const withIds = (message: DifyChatMessage, event: DifyStreamEvent): DifyChatMessage => ({
	...message,
	ids: {
		messageId: event.message_id ?? message.ids.messageId,
		conversationId: event.conversation_id ?? message.ids.conversationId,
		taskId: event.task_id ?? message.ids.taskId,
	},
	createdAt: event.created_at ?? message.createdAt,
})

const nodeFrom = (data: NodeData, status: WorkflowNode['status']): WorkflowNode => ({
	id: data.id,
	nodeId: data.node_id ?? data.id,
	type: data.node_type ?? 'unknown',
	title: data.title ?? data.node_id ?? data.id,
	index: data.index,
	status,
})

/**
 * A finished node's status. Dify's replay also lists the nodes that have not finished: a Human Input node waiting
 * on its form is stored `paused` (graphon 0.7.0 `WorkflowNodeExecutionStatus`, Dify 1.17.1's pin), and it is
 * still running for the chat. `failed`, `exception` and `stopped` are errors.
 */
const nodeStatus = (status: string | undefined): WorkflowNode['status'] => {
	if (status === 'succeeded') return 'success'
	if (status === 'paused' || status === 'running' || status === 'pending') return 'running'
	return 'error'
}

const workflowOf = (message: DifyChatMessage): WorkflowState =>
	message.workflow ?? { status: 'running', nodes: [] }

const updateNode = (
	workflow: WorkflowState,
	data: NodeData,
	patch: (node: WorkflowNode) => WorkflowNode,
): WorkflowState => {
	const exists = workflow.nodes.some(n => n.id === data.id)
	const nodes = exists
		? workflow.nodes.map(n => (n.id === data.id ? patch(n) : n))
		: [...workflow.nodes, patch(nodeFrom(data, 'running'))]
	return { ...workflow, nodes }
}

/**
 * Folds one Dify stream event into the message (spec §4.2 table, OpenAPI ChunkChatEvent). Pure: the
 * provider and the unit tests both call it. Unknown and ignored events return the input unchanged
 * (ids refreshed).
 */
export const applyEvent = (origin: DifyChatMessage, event: DifyStreamEvent): DifyChatMessage => {
	const message = withIds(origin, event)
	const data = (event.data ?? {}) as Record<string, unknown>
	switch (event.event) {
		case 'message': {
			// Agent apps close their agent_message chunks with one `message` holding the complete answer
			// ("treat it as the final answer, not extra text to append" — OpenAPI, POST /chat-messages).
			if (message.agentAnswer) {
				const { agentAnswer: _agentAnswer, ...rest } = message
				return { ...rest, content: event.answer ?? message.content }
			}
			return { ...message, content: message.content + (event.answer ?? '') }
		}
		case 'agent_message':
			return { ...message, content: message.content + (event.answer ?? ''), agentAnswer: true }
		case 'message_replace':
			return { ...message, content: event.answer ?? '' }
		case 'reasoning_chunk':
			return {
				...message,
				reasoning: (message.reasoning ?? '') + String(data.reasoning ?? ''),
				reasoningDone: Boolean(data.is_final),
			}
		case 'agent_thought': {
			const { event: _event, ...fields } = event
			const thought = fields as unknown as AgentThought
			const thoughts = [...(message.thoughts ?? [])]
			const index = thoughts.findIndex(t => t.position === thought.position)
			if (index === -1) thoughts.push(thought)
			else thoughts[index] = thought
			return { ...message, thoughts }
		}
		case 'message_file':
			return {
				...message,
				files: [
					...(message.files ?? []),
					{
						id: String(event.id),
						type: String(event.type ?? 'custom'),
						url: String(event.url ?? ''),
						belongsTo: event.belongs_to === 'user' ? 'user' : 'assistant',
					},
				],
			}
		case 'message_end': {
			// The answer is complete: agentAnswer is stream bookkeeping and never stays on a finished
			// message (Legacy Agent apps send no closing `message` that would clear it).
			const { agentAnswer: _agentAnswer, ...ended } = message
			const metadata = (event.metadata ?? {}) as { retriever_resources?: RetrieverResource[] }
			return metadata.retriever_resources?.length
				? { ...ended, citations: metadata.retriever_resources }
				: ended
		}
		case 'workflow_started': {
			const workflow = workflowOf(message)
			const runId = event.workflow_run_id ?? String(data.id ?? workflow.runId ?? '')
			// A resumed run goes on with its nodes, and so does the run Dify replays for a resume stream
			// (`include_state_snapshot`: a `workflow_started` with reason `initial` for the run the message shows).
			const known =
				data.reason === 'resumption' || (workflow.runId !== undefined && workflow.runId === runId)
			return {
				...message,
				workflow: { runId, status: 'running', nodes: known ? workflow.nodes : [] },
			}
		}
		case 'node_started':
			// A node execution starts once (the id is the execution's): a new one runs, and one the message already
			// shows (retrying, or finished in Dify's replay) stays as it is.
			return {
				...message,
				workflow: updateNode(workflowOf(message), data as NodeData, node => node),
			}
		case 'node_finished': {
			// Dify's replay for a resume stream sends the run's nodes without their details (the snapshot's
			// `to_ignore_detail_dict`): what the message already shows of a node stays.
			const d = data as NodeData
			return {
				...message,
				workflow: updateNode(workflowOf(message), d, node => {
					const status = nodeStatus(d.status)
					// A replayed node that has not finished (a Human Input node waiting on its form) has nothing to add.
					if (status === 'running') return { ...node, status }
					return {
						...node,
						status,
						inputs: d.inputs ?? node.inputs ?? null,
						outputs: d.outputs ?? node.outputs ?? null,
						processData: d.process_data ?? node.processData ?? null,
						elapsedTime: d.elapsed_time ?? node.elapsedTime,
						totalTokens: d.execution_metadata?.total_tokens ?? node.totalTokens,
						error: d.error ?? (status === 'error' ? (node.error ?? null) : null),
					}
				}),
			}
		}
		case 'node_retry': {
			// OpenAPI: retry_index starts at 0, so the attempts are counted from the events themselves.
			const d = data as NodeData
			return {
				...message,
				workflow: updateNode(workflowOf(message), d, node => ({
					...node,
					status: 'retrying',
					retries: (node.retries ?? 0) + 1,
					error: d.error ?? null,
				})),
			}
		}
		case 'workflow_finished':
			return {
				...message,
				workflow: {
					...workflowOf(message),
					status: data.error || data.status === 'failed' ? 'failed' : 'finished',
				},
			}
		case 'workflow_paused':
			return { ...message, workflow: { ...workflowOf(message), status: 'paused' } }
		case 'human_input_required':
			return {
				...message,
				humanInput: {
					state: 'pending',
					// null for Email or Console delivery (OpenAPI); the Service API cannot submit those forms.
					formToken: String(data.form_token ?? ''),
					formContent: String(data.form_content ?? ''),
					inputs: (data.inputs as HumanInputField[]) ?? [],
					actions: (data.actions as HumanInputAction[]) ?? [],
					defaults: (data.resolved_default_values as Record<string, string>) ?? {},
					expiresAt: Number(data.expiration_time ?? 0),
					workflowRunId: event.workflow_run_id ?? '',
					nodeId: data.node_id as string | undefined,
				},
			}
		case 'human_input_form_filled':
			return message.humanInput
				? {
						...message,
						humanInput: {
							...message.humanInput,
							state: 'filled',
							renderedContent: data.rendered_content as string | undefined,
							actionText: data.action_text as string | undefined,
						},
					}
				: message
		case 'human_input_form_timeout':
			return message.humanInput
				? { ...message, humanInput: { ...message.humanInput, state: 'expired' } }
				: message
		case 'error':
			// No fallback text here: an empty message is mapped to an i18n key by the UI.
			return {
				...message,
				error: {
					code: event.code as string | undefined,
					message: typeof event.message === 'string' ? event.message : '',
					status: event.status as number | undefined,
				},
			}
		default:
			// ping, tts_message*, agent_log, iteration_*, loop_*, text_chunk: nothing to show in a chat bubble.
			return message
	}
}

/**
 * A `data:` payload that parses to a Dify event; `[DONE]`, keep-alives without data and junk give null. The
 * workflow and completion runner (useWorkflowRun) reads its stream through it as well.
 */
export const parseEvent = (data: unknown): DifyStreamEvent | null => {
	if (typeof data !== 'string' || !data.trim() || data.trim() === '[DONE]') return null
	let parsed: unknown
	try {
		parsed = JSON.parse(data)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	return typeof (parsed as DifyStreamEvent).event === 'string' ? (parsed as DifyStreamEvent) : null
}

export interface DifyChatProviderOptions {
	request: ChatProviderConfig<DifyChatInput, SSEOutput, DifyChatMessage>['request']
	/** The server conversation id of this provider's conversation, if it has one yet (spec §4.3). */
	getDifyConversationId: () => string | undefined
	/** Called after every workflow event so the hook can persist node data (GET /messages has none). */
	onWorkflowUpdate?: (message: DifyChatMessage) => void
	/**
	 * Called once per reply, when the stream first names the server conversation: a new chat learns its
	 * Dify id here (spec §4.4), whether or not its conversation is the one on screen.
	 */
	onConversationId?: (difyId: string) => void
}

/** How a resume stream's wait for its pause ended (DifyChatProvider.waitForPause). */
export type PauseWait = { paused: true } | { paused: false; error?: Error }

// ADR-0017: the one Dify provider; only the three AbstractChatProvider transforms — docs/decisions/0017-build-the-chat-on-ant-design-x.md
export class DifyChatProvider extends AbstractChatProvider<
	DifyChatMessage,
	DifyChatInput,
	SSEOutput
> {
	private resumeBase: DifyChatMessage | null = null
	/**
	 * Where the resume stream of a human input form is (spec §4.6, ADR-0017 note of 2026-10-08): `opening` until
	 * Dify's replay reaches the pause, `paused` while the run waits on the form, `running` once the run goes on.
	 */
	private resumeStage: 'opening' | 'paused' | 'running' | null = null
	private resumeRunId = ''
	/** The form the replayed pause waits on (its `human_input_required`). */
	private pausedToken = ''
	/** The resume stream carried the run on after its pause. */
	private wentOn = false
	private pauseWaiter: ((result: PauseWait) => void) | null = null
	/**
	 * The form answered on the current resume stream (accepted by Dify, or the one the run went on from): it no
	 * longer waits, even before its human_input_form_filled.
	 */
	answeredToken: string | undefined
	private readonly getDifyConversationId: () => string | undefined
	private readonly onWorkflowUpdate?: (message: DifyChatMessage) => void
	private readonly onConversationId?: (difyId: string) => void

	constructor({
		request,
		getDifyConversationId,
		onWorkflowUpdate,
		onConversationId,
	}: DifyChatProviderOptions) {
		super({ request })
		this.getDifyConversationId = getDifyConversationId
		this.onWorkflowUpdate = onWorkflowUpdate
		this.onConversationId = onConversationId
	}

	/**
	 * Resolves once the resume stream that the next request starts has replayed its pause. Dify builds that replay
	 * after it subscribed to the run's events (1.17.1, services/workflow_event_snapshot_service.py), and it sends a
	 * resumed run's events only to the listeners it has (Redis pub/sub), so a form answered from then on loses no
	 * event; Dify's own chat waits for this pause before it submits a form. Resolves `paused: false` when the stream
	 * ends first (a finished run answers one `workflow_finished`) or another request starts.
	 */
	waitForPause(): Promise<PauseWait> {
		this.settlePause({ paused: false })
		return new Promise(resolve => {
			this.pauseWaiter = resolve
		})
	}

	/**
	 * The resume stream is open and its run waits on the form `formToken` (Dify keeps the run paused after a refused
	 * answer). A run answered elsewhere may wait on its next form already: the replay names it.
	 */
	isPausedOn(workflowRunId: string, formToken?: string): boolean {
		return (
			this.resumeStage === 'paused' &&
			this.resumeRunId === workflowRunId &&
			(formToken === undefined || this.pausedToken === formToken)
		)
	}

	/** The resume stream ended with its run still at the pause: an answer Dify accepted then has no continuation here. */
	continuationLost(): boolean {
		return this.resumeStage === null && !this.wentOn
	}

	/** Dify accepted the answer to `formToken` on the current resume stream. */
	markAnswered(formToken: string) {
		this.answeredToken = formToken
	}

	/** The request ended (XRequest's onSuccess or onError callback): a wait for its pause ends without one. */
	endResume(error?: Error) {
		this.resumeStage = null
		this.settlePause(error ? { paused: false, error } : { paused: false })
	}

	private settlePause(result: PauseWait) {
		const resolve = this.pauseWaiter
		this.pauseWaiter = null
		resolve?.(result)
	}

	/**
	 * A `workflow_paused` on the resume stream: the replayed one opens the way for the answer. A later one is the run
	 * waiting on its next form; the stream stops there, as a stream without `continue_on_pause` would, so the chat is
	 * idle while that form waits and its answer opens a stream of its own (XRequest's documented `abort`).
	 */
	private onResumePaused() {
		if (this.resumeStage === 'opening') {
			this.resumeStage = 'paused'
			this.settlePause({ paused: true })
		} else if (this.resumeStage === 'running') {
			this.resumeStage = null
			this.request.abort()
		}
	}

	transformParams(
		requestParams: Partial<DifyChatInput>,
		options: XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>,
	): DifyChatInput {
		const base = { ...options?.params } as Partial<DifyChatInput>
		const user = requestParams.user ?? base.user
		if (requestParams.resume) {
			// The SDK passes no originMessage on a reload's first chunk; keep the paused message to extend it.
			this.resumeBase = requestParams.resume.message
			this.resumeRunId = requestParams.resume.workflowRunId
			this.resumeStage = 'opening'
			this.pausedToken = ''
			this.wentOn = false
			this.answeredToken = undefined
			return {
				...base,
				user,
				query: '',
				inputs: {},
				files: [],
				response_mode: 'streaming',
				resume: requestParams.resume,
			} as DifyChatInput
		}
		this.resumeBase = null
		this.endResume()
		return {
			...base,
			user,
			query: requestParams.query ?? '',
			inputs: requestParams.inputs ?? {},
			// Dify's file objects only: the names are for the local bubble.
			files: (requestParams.files ?? []).map(({ filename: _name, ...file }) => file),
			response_mode: 'streaming',
			// Dify would name a new conversation in a background thread it never awaits (1.17.1,
			// MessageCycleManager.generate_conversation_name); the app asks for the name itself with the
			// rename API once the conversation exists, the client pattern Dify documents for this flag.
			auto_generate_name: false,
			conversation_id: this.getDifyConversationId() ?? '',
		} as DifyChatInput
	}

	transformLocalMessage(
		requestParams: Partial<DifyChatInput>,
	): DifyChatMessage | DifyChatMessage[] {
		if (requestParams.resume) return []
		return {
			role: 'user',
			content: requestParams.query ?? '',
			files: (requestParams.files ?? []).map((file, index) => ({
				id: ('upload_file_id' in file && file.upload_file_id) || `local-${index}`,
				type: file.type,
				url: ('url' in file && file.url) || '',
				belongsTo: 'user' as const,
				filename: file.filename,
				uploadFileId: 'upload_file_id' in file ? file.upload_file_id : undefined,
			})),
			inputs: requestParams.inputs,
			ids: {},
		}
	}

	transformMessage(info: TransformMessage<DifyChatMessage, SSEOutput>): DifyChatMessage {
		const origin = info.originMessage ?? this.resumeBase ?? emptyAssistant()
		const event = parseEvent(info.chunk?.data)
		if (!event) return origin
		const next = applyEvent(origin, event)
		if (this.resumeStage === 'opening' && event.event === 'human_input_required') {
			this.pausedToken = String(
				(event.data as { form_token?: unknown } | undefined)?.form_token ?? '',
			)
		}
		if (this.resumeStage && event.event === 'workflow_paused') this.onResumePaused()
		else if (this.resumeStage === 'paused') {
			// The run went on from the form it waited on: that form is answered, here or elsewhere, even before the
			// submission's own answer is read.
			this.resumeStage = 'running'
			this.wentOn = true
			this.answeredToken ??= this.pausedToken
		}
		const difyId = next.ids.conversationId
		if (difyId && !origin.ids.conversationId) {
			try {
				this.onConversationId?.(difyId)
			} catch {
				// Same rule as below: bookkeeping outside the message must not end the stream.
			}
		}
		if (WORKFLOW_EVENTS.has(event.event)) {
			try {
				this.onWorkflowUpdate?.(next)
			} catch {
				// Persistence is best effort: a failing store must not end the stream, or XRequest's
				// catch would replace the streaming bubble with an error.
			}
		}
		return next
	}
}
