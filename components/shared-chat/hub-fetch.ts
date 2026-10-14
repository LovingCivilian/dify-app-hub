import type { SSEOutput, XRequestOptions } from '@ant-design/x-sdk'

import type { Turn } from '@/lib/chat/turn'
import { readRequestError } from '@/lib/http/browser'

import type { SharedChatInput } from './provider/ag-ui-chat-provider'

/** POST /api/apps/[appId]/runs (spec §4.2): the turn's event stream. */
export const runsUrl = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/runs`

/**
 * The documented XRequest `fetch` option ("Custom fetch", x-request skill and XRequestOptions), as the Dify chat's
 * createDifyFetch: XRequest hands over its RequestInit (the JSON body transformParams built, the abort signal), and a
 * non-OK answer becomes the hub envelope's RequestError, because XRequest's own fetch throws "Fetch failed with status
 * N" and drops the body (x-sdk 2.9.0 `es/x-request/x-fetch.js`; part2-x-mapping.md §1.6). The run route answers
 * `text/event-stream` (spec §4.4), which XRequest's SSE handler reads as it is.
 */
export const createHubFetch =
	(appId: string): NonNullable<XRequestOptions<SharedChatInput, SSEOutput, Turn>['fetch']> =>
	async (_baseURL, options) => {
		const init = (options ?? {}) as RequestInit
		const response = await fetch(runsUrl(appId), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: init.body,
			signal: init.signal ?? undefined,
		})
		if (!response.ok) throw await readRequestError(response)
		return response
	}
