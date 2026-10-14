import type { FileInput } from './files'
import type { HumanInputContent } from './human-input'

export type ResponseMode = 'streaming' | 'blocking'

/** POST /chat-messages body without `user` (endpoint map §1.2). */
export interface ChatMessageRequest {
	query: string
	inputs: Record<string, unknown>
	files?: FileInput[]
	response_mode?: ResponseMode
	conversation_id?: string
	auto_generate_name?: boolean
	/** advanced-chat only: run a published version */
	workflow_id?: string
}

export interface RetrieverResource {
	id?: string
	message_id?: string
	position: number
	dataset_id: string
	dataset_name: string
	document_id: string
	document_name: string
	data_source_type?: string
	segment_id: string
	score: number
	hit_count?: number
	word_count?: number
	segment_position?: number
	index_node_hash?: string
	content: string
	created_at?: number
}

/** An `agent_thought` event payload, and an `agent_thoughts[]` item of GET /messages (the history adds chain_id and files). */
export interface AgentThought {
	id: string
	message_id: string
	task_id?: string
	conversation_id?: string
	position: number
	thought: string
	tool: string
	tool_labels?: Record<string, unknown> | null
	tool_input: string
	observation: string
	message_files?: string[]
	files?: string[]
	chain_id?: string | null
	created_at: number
}

export interface ConversationItem {
	id: string
	name: string
	inputs: Record<string, unknown>
	status: string
	introduction: string
	created_at: number
	updated_at: number
}

export interface ConversationsQuery {
	last_id?: string
	limit?: number
	sort_by?: 'created_at' | '-created_at' | 'updated_at' | '-updated_at'
}

export interface ConversationsPage {
	limit: number
	has_more: boolean
	data: ConversationItem[]
}

export interface RenameConversationRequest {
	name?: string
	auto_generate?: boolean
}

export interface MessagesQuery {
	conversation_id: string
	first_id?: string
	limit?: number
}

/** A `message_files[]` item of GET /messages (OpenAPI MessageFileItem). */
export interface MessageFileItem {
	id: string
	type: string
	url: string | null
	belongs_to: string | null
	filename: string
	mime_type: string | null
	size: number | null
	transfer_method: string
	upload_file_id: string | null
}

/** One item of GET /messages (endpoint map §1.2). */
export interface MessageListItem {
	id: string
	conversation_id: string
	parent_message_id?: string | null
	inputs: Record<string, unknown>
	query: string
	answer: string
	feedback?: { rating: 'like' | 'dislike' } | null
	retriever_resources?: RetrieverResource[]
	created_at: number
	agent_thoughts?: AgentThought[]
	message_files?: MessageFileItem[]
	message_tokens?: number
	answer_tokens?: number
	total_tokens?: number
	provider_response_latency?: number
	total_price?: string
	currency?: string
	/** `normal`, or `error` when generation failed */
	status: string
	error?: string | null
	extra_contents?: HumanInputContent[]
}

export interface MessagesPage {
	limit: number
	has_more: boolean
	data: MessageListItem[]
}

export interface SuggestedQuestionsResponse {
	result: 'success'
	data: string[]
}

export type FeedbackRating = 'like' | 'dislike' | null

export interface FeedbackRequest {
	rating: FeedbackRating
	content?: string
}

/** The three stop endpoints and message feedback answer this (endpoint map §1.2, §6). */
export interface StopResponse {
	result: 'success'
}
