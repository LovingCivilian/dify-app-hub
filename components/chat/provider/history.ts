import type { DefaultMessageInfo } from '@ant-design/x-sdk'

import type { IAgentThought, IRetrieverResource } from '@/lib/api'

import type { DifyChatMessage, MessageFile, WorkflowState } from './message'

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

/**
 * One item of Dify's GET /messages (OpenAPI: ConversationMessageItem). `extra_contents` (human input
 * forms) and the token and price fields are not mapped.
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
	/** unix seconds */
	created_at: number
}

export interface HistoryContext {
	/** Workflow nodes are not part of GET /messages; they come from the IndexedDB store (spec §4.10). */
	loadWorkflow: (messageId: string) => Promise<WorkflowState | undefined>
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
