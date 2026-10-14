import 'server-only'

import { isErrorBody, ProviderError } from '@/lib/http/errors'

/** Dify's refusal in the hub's envelope (endpoint map §4); errorResponseFrom answers it as any ProviderError. */
export class DifyError extends ProviderError {
	constructor(status: number, code: string, message: string) {
		super(status, code, message)
		this.name = 'DifyError'
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A non-OK upstream answer as a DifyError: Dify's code and message when the body is its envelope (the HTTP
 * status is authoritative), `upstream_error` with the status otherwise — an HTML page from a reverse proxy, an
 * empty body, a JSON body of another shape (Review Focus 1 of the B1 plan).
 */
export const difyErrorFromResponse = async (response: Response): Promise<DifyError> => {
	let body: unknown = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	if (isErrorBody(body)) return new DifyError(response.status, body.code, body.message)
	const message =
		isRecord(body) && typeof body.message === 'string'
			? body.message
			: `Dify answered ${response.status}`
	return new DifyError(response.status, 'upstream_error', message)
}
