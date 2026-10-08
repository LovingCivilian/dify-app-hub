import type { StubMode } from './apps'
import type { StubNode } from './events'

/** One item of GET /messages (OpenAPI: ConversationMessageItem), as the stub stores it. */
export interface StoredMessage {
	id: string
	conversation_id: string
	query: string
	answer: string
	created_at: number
	feedback: { rating: 'like' | 'dislike' } | null
	inputs: Record<string, unknown>
	message_files: unknown[]
	agent_thoughts: unknown[]
	retriever_resources: unknown[]
	extra_contents: unknown[]
	status: 'normal' | 'error'
	error: string | null
}

export interface StoredConversation {
	id: string
	name: string
	created_at: number
	updated_at: number
	inputs: Record<string, unknown>
}

export interface PendingForm {
	formToken: string
	workflowRunId: string
	user: string
	conversationId: string
	messageId: string
	taskId: string
	expiresAt: number
	/** The Human Input node of the form (scenarios.ts REVIEW_NODE, or SECOND_REVIEW_NODE in the `chain` scenario). */
	node: StubNode
	/** The run's query words: `fast` runs the continuation before the submission is answered, `chain` pauses again. */
	fast?: boolean
	chain?: boolean
	/** Set once the resumed run has finished: a new /events call answers workflow_finished. */
	finished?: boolean
	submitted?: { inputs: Record<string, string>; action: string }
}

class UserStore {
	conversations = new Map<string, StoredConversation>()
	messages: StoredMessage[] = []
	/** Conversations whose first history load already failed (the `brokenhistory` marker). */
	failedHistory = new Set<string>()
}

const users = new Map<string, UserStore>()
/**
 * Conversations and messages are scoped per Dify end-user id (the proxy sets it from the session) and per
 * app: Dify end-user ids are "unique within" an app, and the stub tells its five apps apart by mode.
 */
export const forUser = (user: string, mode: StubMode): UserStore => {
	const key = `${mode}\u0000${user}`
	let store = users.get(key)
	if (!store) {
		store = new UserStore()
		users.set(key, store)
	}
	return store
}

export const pendingForms = new Map<string, PendingForm>()

export const now = () => Math.floor(Date.now() / 1000)

/** One item of GET /apps/annotations (OpenAPI: AnnotationItem), as the stub stores it. */
export interface StoredAnnotation {
	id: string
	question: string
	answer: string
	hit_count: number
	created_at: number
}

const annotations = new Map<string, StoredAnnotation[]>()
/** Dify keeps annotations per app; the stub keys them by the stub app's id. Newest first. */
export const annotationsFor = (appId: string): StoredAnnotation[] => {
	let list = annotations.get(appId)
	if (!list) {
		list = []
		annotations.set(appId, list)
	}
	return list
}
