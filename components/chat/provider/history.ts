import type { DefaultMessageInfo } from '@ant-design/x-sdk'

import type { IAgentThought, IRetrieverResource } from '@/lib/api'

import { humanInputPhase } from '../message/human-input-phase'
import type {
	DifyChatMessage,
	HumanInputAction,
	HumanInputField,
	HumanInputState,
	MessageFile,
	WorkflowState,
} from './message'

/** A `message_files` item of GET /messages (Dify OpenAPI: MessageFileItem; the nullable fields are the document's). */
export interface HistoryFile {
	id: string
	filename: string
	type: string
	url: string | null
	mime_type: string | null
	size: number | null
	transfer_method: string
	belongs_to: string | null
	upload_file_id: string | null
}

/** An `agent_thoughts` item of GET /messages (Dify OpenAPI: AgentThoughtItem). */
export interface HistoryThought {
	id: string
	message_id: string
	position: number
	thought: string
	tool: string
	tool_input: string
	tool_labels?: Record<string, unknown> | null
	observation: string
	/** file ids related to this thought */
	files?: string[]
	chain_id?: string | null
	created_at: number
}

/** `form_definition` of a human input content (OpenAPI: HumanInputFormDefinition). */
export interface HistoryFormDefinition {
	form_id?: string
	node_id?: string
	node_title?: string
	form_content?: string
	inputs?: HumanInputField[]
	actions?: HumanInputAction[]
	display_in_ui?: boolean
	/** null (or left out) for a form that cannot be answered through the Service API, and once submitted */
	form_token?: string | null
	resolved_default_values?: Record<string, string>
	/** unix seconds */
	expiration_time?: number
}

/** `form_submission_data` of a human input content (OpenAPI: HumanInputFormSubmissionData). */
export interface HistoryFormSubmission {
	node_id?: string
	node_title?: string
	rendered_content?: string
	action_id?: string
	action_text?: string
}

/**
 * An `extra_contents` item of GET /messages (OpenAPI: HumanInputContent): a Human Input node's form.
 * `form_definition` is "`null` when the content represents a submission response";
 * `form_submission_data` is "`null` when the form has not been submitted yet".
 */
export interface HistoryHumanInputContent {
	/** `human_input` for human input content */
	type: string
	workflow_run_id?: string
	submitted?: boolean
	form_definition?: HistoryFormDefinition | null
	form_submission_data?: HistoryFormSubmission | null
}

/**
 * One item of Dify's GET /messages (OpenAPI: ConversationMessageItem). `extra_contents` maps to the
 * message's human input form; the token and price fields are not mapped.
 */
export interface HistoryMessage {
	id: string
	conversation_id: string
	inputs: Record<string, unknown>
	query: string
	answer: string
	message_files?: HistoryFile[]
	feedback?: { rating: string } | null
	/** `normal`, or `error` when generation failed */
	status: string
	error?: string | null
	agent_thoughts?: HistoryThought[]
	retriever_resources?: IRetrieverResource[]
	extra_contents?: HistoryHumanInputContent[]
	/** unix seconds */
	created_at: number
}

export interface HistoryContext {
	/** Workflow nodes are not part of GET /messages; they come from the IndexedDB store (spec §4.10). */
	loadWorkflow: (messageId: string) => Promise<WorkflowState | undefined>
	/** The clock in unix seconds, for a pending form that expired meanwhile (default: the system clock). */
	now?: () => number
}

export const historyIds = (messageId: string) => ({
	user: `${messageId}:q`,
	assistant: `${messageId}:a`,
})

// Same rule as the live `message_file` event (applyEvent): anything not owned by the user is the assistant's.
const toFile = (file: HistoryFile): MessageFile => ({
	id: file.id,
	type: file.type,
	url: file.url ?? '',
	belongsTo: file.belongs_to === 'user' ? 'user' : 'assistant',
	filename: file.filename,
	size: file.size ?? undefined,
	mimeType: file.mime_type ?? undefined,
	uploadFileId: file.upload_file_id ?? undefined,
})

// The live thought type is the stream event's. AgentThoughtItem names the file ids `files` and carries
// neither the task id nor `file_id`; nothing reads those two, so they stay empty.
const toThought = (thought: HistoryThought, conversationId: string): IAgentThought => ({
	id: thought.id,
	message_id: thought.message_id,
	position: thought.position,
	thought: thought.thought,
	tool: thought.tool,
	tool_input: thought.tool_input,
	observation: thought.observation,
	created_at: thought.created_at,
	message_files: thought.files ?? [],
	conversation_id: conversationId,
	task_id: '',
	file_id: '',
})

const toRating = (feedback: HistoryMessage['feedback']): DifyChatMessage['feedback'] =>
	feedback?.rating === 'like' || feedback?.rating === 'dislike' ? feedback.rating : null

/**
 * The message's form, from `extra_contents`. A message holds one form, as in the live stream where a
 * later `human_input_required` replaces the earlier form; Dify lists a message's contents oldest first
 * (`order_by(created_at.asc())`, langgenius/dify `sqlalchemy_execution_extra_content_repository.py`),
 * so the last one is the current one. A pending form opens with its token and expiry from the
 * definition (an empty token when there is none: the form then says it cannot be answered here) and
 * is expired once its `expiration_time` has passed; a submitted one is its summary.
 */
const toHumanInput = (
	contents: HistoryHumanInputContent[] | undefined,
	nowSeconds: number,
): HumanInputState | undefined => {
	const content = contents?.findLast(c => c.type === 'human_input')
	if (!content) return undefined
	const definition = content.form_definition ?? undefined
	const submission = content.form_submission_data ?? undefined
	const form: HumanInputState = {
		state: 'pending',
		formToken: definition?.form_token ?? '',
		formContent: definition?.form_content ?? '',
		inputs: definition?.inputs ?? [],
		actions: definition?.actions ?? [],
		defaults: definition?.resolved_default_values ?? {},
		expiresAt: definition?.expiration_time ?? 0,
		workflowRunId: content.workflow_run_id ?? '',
		nodeId: submission?.node_id ?? definition?.node_id,
	}
	if (content.submitted || submission) {
		return {
			...form,
			state: 'filled',
			renderedContent: submission?.rendered_content,
			actionText: submission?.action_text,
		}
	}
	return { ...form, state: humanInputPhase(form, nowSeconds) }
}

// Workflow nodes are optional enrichment: one failing store read (IndexedDB blocked or full) must not fail the page.
const loadWorkflowSafely = async (ctx: HistoryContext, messageId: string) => {
	try {
		return await ctx.loadWorkflow(messageId)
	} catch {
		return undefined
	}
}

const mapMessage = async (
	item: HistoryMessage,
	ctx: HistoryContext,
): Promise<DefaultMessageInfo<DifyChatMessage>[]> => {
	const ids = historyIds(item.id)
	const files = (item.message_files ?? []).map(toFile)
	const common = {
		ids: { messageId: item.id, conversationId: item.conversation_id },
		createdAt: item.created_at,
	}
	return [
		{
			id: ids.user,
			status: 'success',
			message: {
				role: 'user',
				content: item.query,
				inputs: item.inputs,
				files: files.filter(f => f.belongsTo === 'user'),
				...common,
			},
		},
		{
			id: ids.assistant,
			status: 'success',
			message: {
				role: 'assistant',
				content: item.answer,
				files: files.filter(f => f.belongsTo === 'assistant'),
				feedback: toRating(item.feedback),
				thoughts: (item.agent_thoughts ?? []).map(t => toThought(t, item.conversation_id)),
				citations: item.retriever_resources ?? [],
				workflow: await loadWorkflowSafely(ctx, item.id),
				humanInput: toHumanInput(item.extra_contents, ctx.now?.() ?? Math.floor(Date.now() / 1000)),
				// A failed turn stays `success` for the SDK and carries its error, like a live `error` event
				// (spec §4.5); `message` is empty without Dify's text and the UI supplies the i18n fallback.
				error: item.status === 'error' ? { message: item.error ?? '' } : undefined,
				...common,
			},
		},
	]
}

/**
 * Dify answers each GET /messages page oldest first (MessageService.pagination_by_first_id, order
 * "asc"), so the page keeps its order: two bubbles per Dify message, each already `success`
 * (DefaultMessageInfo, use-x-chat skill "Async Default Messages").
 */
export const mapHistoryPage = async (
	items: HistoryMessage[],
	ctx: HistoryContext,
): Promise<DefaultMessageInfo<DifyChatMessage>[]> =>
	(await Promise.all(items.map(item => mapMessage(item, ctx)))).flat()
