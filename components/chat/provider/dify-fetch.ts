import type { SSEOutput, XRequestOptions } from '@ant-design/x-sdk'

import type { DifyChatInput, DifyChatMessage } from './message'

/** Dify's error body ({ code, message, status }) as a thrown error, so XRequest's catch → onError → requestFallback. */
export class DifyRequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | undefined,
		message: string,
	) {
		super(message)
		this.name = 'DifyRequestError'
	}
}

export const readDifyError = async (response: Response): Promise<DifyRequestError> => {
	let body: { code?: string; message?: string; error?: string } | null = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return new DifyRequestError(
		response.status,
		body?.code,
		body?.message ?? body?.error ?? response.statusText,
	)
}

/**
 * The documented XRequest `fetch` option (x-request skill). XRequest hands us its RequestInit
 * (JSON body, abort signal); we route by payload: a `resume` request reads the workflow events
 * endpoint (HITL continuation, spec §4.6), everything else posts to chat-messages. Non-OK answers
 * become DifyRequestError because XRequest's own JSON handler only recognises `success === false`.
 */
export const createDifyFetch =
	(
		appId: string,
	): NonNullable<XRequestOptions<DifyChatInput, SSEOutput, DifyChatMessage>['fetch']> =>
	async (_baseURL, options) => {
		const init = (options ?? {}) as RequestInit & { body?: string }
		const body = init.body ? (JSON.parse(init.body) as DifyChatInput) : ({} as DifyChatInput)
		const response = body.resume
			? await fetch(
					`/api/client/dify/${appId}/workflow/${encodeURIComponent(body.resume.workflowRunId)}/events`,
					{
						method: 'GET',
						signal: init.signal ?? undefined,
					},
				)
			: await fetch(`/api/client/dify/${appId}/chat-messages`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: init.body,
					signal: init.signal ?? undefined,
				})
		if (!response.ok) throw await readDifyError(response)
		return response
	}
