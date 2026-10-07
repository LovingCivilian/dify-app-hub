import { AbstractChatProvider } from '@ant-design/x-sdk'
import type {
	ChatProviderConfig,
	SSEOutput,
	TransformMessage,
	XRequestOptions,
} from '@ant-design/x-sdk'

import type { IAgentThought, IRetrieverResource } from '@/lib/api'

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
			const thought = fields as unknown as IAgentThought
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
			const metadata = (event.metadata ?? {}) as { retriever_resources?: IRetrieverResource[] }
			return metadata.retriever_resources?.length
				? { ...ended, citations: metadata.retriever_resources }
				: ended
		}
		case 'workflow_started': {
			const workflow = workflowOf(message)
			const resumption = data.reason === 'resumption'
			return {
				...message,
				workflow: {
					runId: event.workflow_run_id ?? String(data.id ?? workflow.runId ?? ''),
					status: 'running',
					nodes: resumption ? workflow.nodes : [],
				},
			}
		}
		case 'node_started':
			return {
				...message,
				workflow: updateNode(workflowOf(message), data as NodeData, node => ({
					...node,
					status: node.status === 'retrying' ? 'retrying' : 'running',
				})),
			}
		case 'node_finished': {
			const d = data as NodeData
			return {
				...message,
				workflow: updateNode(workflowOf(message), d, node => ({
					...node,
					status: d.status === 'succeeded' ? 'success' : 'error',
					inputs: d.inputs ?? null,
					outputs: d.outputs ?? null,
					processData: d.process_data ?? null,
					elapsedTime: d.elapsed_time,
					totalTokens: d.execution_metadata?.total_tokens,
					error: d.error ?? null,
				})),
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

// ADR-0017: the one Dify provider; only the three AbstractChatProvider transforms — docs/decisions/0017-build-the-chat-on-ant-design-x.md
export class DifyChatProvider extends AbstractChatProvider<
	DifyChatMessage,
	DifyChatInput,
	SSEOutput
> {
	private resumeBase: DifyChatMessage | null = null
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

	transformParams(
		requestParams: Partial<DifyChatInput>,
		options: XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>,
	): DifyChatInput {
		const base = { ...options?.params } as Partial<DifyChatInput>
		const user = requestParams.user ?? base.user
		if (requestParams.resume) {
			// The SDK passes no originMessage on a reload's first chunk; keep the paused message to extend it.
			this.resumeBase = requestParams.resume.message
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
