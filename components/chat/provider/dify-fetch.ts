import type { SSEOutput, XRequestOptions } from '@ant-design/x-sdk'

import { createDifyApi, readDifyError } from '@/lib/dify/browser'

import type { DifyChatInput, DifyChatMessage } from './message'

// The chat's importers keep these names; the classes live with the browser client (lib/dify/browser.ts).
export { DifyRequestError, readDifyError } from '@/lib/dify/browser'

/**
 * The documented XRequest `fetch` option (x-request skill). XRequest hands us its RequestInit
 * (JSON body, abort signal); we route by payload: a `resume` request reads the workflow events
 * route (HITL continuation, ADR-0017), everything else posts to chat-messages. Non-OK answers
 * become DifyRequestError because XRequest's own JSON handler only recognises `success === false`.
 */
export const createDifyFetch =
	(
		appId: string,
	): NonNullable<XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>['fetch']> =>
	async (_baseURL, options) => {
		const api = createDifyApi(appId)
		const init = (options ?? {}) as RequestInit & { body?: string }
		const body = init.body ? (JSON.parse(init.body) as DifyChatInput) : ({} as DifyChatInput)
		const response = body.resume
			? await fetch(api.workflowEventsUrl(body.resume.workflowRunId), {
					method: 'GET',
					signal: init.signal ?? undefined,
				})
			: await fetch(api.chatMessagesUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: init.body,
					signal: init.signal ?? undefined,
				})
		if (!response.ok) throw await readDifyError(response)
		return response
	}
