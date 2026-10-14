// Client-safe: no server-only import. The browser's reading of a refusal from any of the hub's routes (charter §4.5):
// the provider clients and the admin pages reject with RequestError, so every caller keeps one parser.

/** The envelope (`{ code, message, status }`) as a thrown error; `code` is undefined for a body of another shape. */
export class RequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | undefined,
		message: string,
	) {
		super(message)
		this.name = 'RequestError'
	}
}

/**
 * Reads a non-OK answer. An empty or non-JSON body (a proxy page, Next's empty 500) keeps no message, never the
 * status text: nothing user-facing is English from the wire, the view shows its own i18n text (charter §4.5).
 */
export const readRequestError = async (response: Response): Promise<RequestError> => {
	let body: { code?: unknown; message?: unknown } | null = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return new RequestError(
		response.status,
		typeof body?.code === 'string' ? body.code : undefined,
		typeof body?.message === 'string' ? body.message : '',
	)
}
