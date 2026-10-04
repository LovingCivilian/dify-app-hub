import type { IAgentThought, IFile, IRetrieverResource } from '@/lib/api'

export type DifyRole = 'user' | 'assistant'

export interface WorkflowNode {
	/** node execution id (data.id) */
	id: string
	nodeId: string
	type: string
	title: string
	index?: number
	status: 'running' | 'retrying' | 'success' | 'error'
	inputs?: Record<string, unknown> | null
	outputs?: Record<string, unknown> | null
	processData?: Record<string, unknown> | null
	elapsedTime?: number
	totalTokens?: number
	error?: string | null
	retries?: number
}

export interface WorkflowState {
	runId?: string
	status: 'running' | 'paused' | 'finished' | 'failed'
	nodes: WorkflowNode[]
}

export interface MessageFile {
	id: string
	type: string
	url: string
	belongsTo: 'user' | 'assistant'
	filename?: string
	size?: number
	mimeType?: string
	uploadFileId?: string
}

export interface HumanInputField {
	type: 'paragraph' | 'select' | 'file' | 'file-list' | string
	output_variable_name: string
	default?: { type: string; value?: string; selector?: string[] } | null
	option_source?: { type: string; value?: string[]; selector?: string[] }
}

export interface HumanInputAction {
	id: string
	title: string
	button_style: 'primary' | 'default' | 'accent' | 'ghost' | string
}

export interface HumanInputState {
	state: 'pending' | 'filled' | 'expired'
	formToken: string
	formContent: string
	inputs: HumanInputField[]
	actions: HumanInputAction[]
	defaults: Record<string, string>
	/** unix seconds */
	expiresAt: number
	workflowRunId: string
	nodeId?: string
	renderedContent?: string
	actionText?: string
}

export interface MessageError {
	code?: string
	message: string
	status?: number
}

/** One bubble's worth of state, built by applyEvent() from Dify's stream or by the history mapper. */
export interface DifyChatMessage {
	role: DifyRole
	content: string
	reasoning?: string
	reasoningDone?: boolean
	thoughts?: IAgentThought[]
	workflow?: WorkflowState
	files?: MessageFile[]
	citations?: IRetrieverResource[]
	humanInput?: HumanInputState
	error?: MessageError
	ids: { messageId?: string; conversationId?: string; taskId?: string }
	/** unix seconds, from StreamEventBase.created_at or the history record */
	createdAt?: number
	feedback?: 'like' | 'dislike' | null
	/** user message: the inputs it was sent with */
	inputs?: Record<string, unknown>
	/** set by requestFallback when the user stopped the reply */
	aborted?: boolean
	/**
	 * Live stream only: the answer so far came from `agent_message` chunks. Dify's Agent apps close
	 * with one `message` carrying the complete answer, which then replaces the text instead of
	 * being appended (OpenAPI, POST /chat-messages, "Events by app type").
	 */
	agentAnswer?: boolean
}

/** onRequest params. `resume` turns the request into a HITL continuation (spec §4.6). */
export interface DifyChatInput {
	query: string
	inputs: Record<string, unknown>
	files: IFile[]
	conversation_id?: string
	user?: string
	response_mode: 'streaming'
	resume?: { workflowRunId: string; message: DifyChatMessage }
}

/** A parsed SSE `data:` payload. Dify's events share StreamEventBase; the rest is per event. */
export interface DifyStreamEvent {
	event: string
	task_id?: string
	message_id?: string
	conversation_id?: string
	created_at?: number
	workflow_run_id?: string
	answer?: string
	[key: string]: unknown
}

export const emptyAssistant = (): DifyChatMessage => ({ role: 'assistant', content: '', ids: {} })
