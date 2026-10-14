// Client-safe: the two type imports below are erased (TypeScript `import type`), so neither server module reaches the
// bundle. The browser's way to the shared chat's read and stop routes (Part 2 spec §4.2): every method resolves the
// typed body and rejects with RequestError (lib/http/browser.ts) on a non-OK answer, as the Dify browser client does
// (lib/providers/dify/browser.ts).
import type { HistoryTurn } from '@/lib/chat/turn'
import type { ConversationListItem } from '@/lib/data/conversations'
import { readRequestError } from '@/lib/http/browser'

/** GET /api/apps/[appId]/conversations (spec §4.2; plan call P8). */
export interface ConversationsPage {
	items: ConversationListItem[]
	nextCursor: string | null
}

/** GET /api/apps/[appId]/conversations/[conversationId]: the latest turns, or those before `cursor` (plan call P8). */
export interface ConversationPage {
	id: string
	title: string
	state: unknown
	turns: HistoryTurn[]
	cursor: string | null
}

const segment = (value: string) => encodeURIComponent(value)

export const createSharedChatApi = (appId: string) => {
	const base = `/api/apps/${segment(appId)}`
	const request = async (path: string, init?: RequestInit): Promise<Response> => {
		const response = await fetch(`${base}${path}`, init)
		if (!response.ok) throw await readRequestError(response)
		return response
	}
	return {
		listConversations: () =>
			request('/conversations').then(response => response.json() as Promise<ConversationsPage>),
		getConversation: (conversationId: string, before?: string) =>
			request(
				`/conversations/${segment(conversationId)}${before ? `?before=${segment(before)}` : ''}`,
			).then(response => response.json() as Promise<ConversationPage>),
		/** Spec §4.5: the route answers 204, also for a run that has already ended. */
		stopRun: async (conversationId: string, runId: string): Promise<void> => {
			await request(`/conversations/${segment(conversationId)}/runs/${segment(runId)}/stop`, {
				method: 'POST',
			})
		},
	}
}

export type SharedChatApi = ReturnType<typeof createSharedChatApi>
