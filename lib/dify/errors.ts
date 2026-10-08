import 'server-only'

import { AuthError } from '@/lib/auth/session'

import { difyJson } from './response'

/** Dify's error envelope (endpoint map §4), also the app's own refusal shape (charter §4.1). */
export interface DifyErrorBody {
	code: string
	message: string
	status: number
}

export class DifyError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message)
		this.name = 'DifyError'
	}

	toBody(): DifyErrorBody {
		return { code: this.code, message: this.message, status: this.status }
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const isDifyErrorBody = (value: unknown): value is DifyErrorBody =>
	isRecord(value) &&
	typeof value.code === 'string' &&
	typeof value.message === 'string' &&
	typeof value.status === 'number'

/** The app's own refusal in Dify's envelope (no-store, like every JSON answer of the Dify routes). */
export const difyErrorResponse = (code: string, message: string, status: number): Response =>
	difyJson({ code, message, status } satisfies DifyErrorBody, { status })

/**
 * The app's refusal of a signed-in caller whose role does not allow the operation (charter §4.2): the one
 * definition, which a route's own role check and errorResponseFrom's AuthError('forbidden') both answer.
 */
export const forbiddenResponse = (): Response => difyErrorResponse('forbidden', 'Not allowed.', 403)

/**
 * A non-OK upstream answer as a DifyError: Dify's code and message when the body is its envelope (the HTTP
 * status is authoritative), `upstream_error` with the status otherwise — an HTML page from a reverse proxy, an
 * empty body, a JSON body of another shape (Review Focus 1).
 */
export const difyErrorFromResponse = async (response: Response): Promise<DifyError> => {
	let body: unknown = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	if (isDifyErrorBody(body)) return new DifyError(response.status, body.code, body.message)
	const message =
		isRecord(body) && typeof body.message === 'string'
			? body.message
			: `Dify answered ${response.status}`
	return new DifyError(response.status, 'upstream_error', message)
}

/**
 * What a route answers for an exception: a DifyError's envelope (Dify's, or the client's upstream_unreachable),
 * an AuthError's 401/403, else a logged 500 whose body carries no detail (Backend for Frontend guide: no
 * sensitive information in error messages).
 */
export const errorResponseFrom = (error: unknown, context: string): Response => {
	if (error instanceof DifyError) return difyErrorResponse(error.code, error.message, error.status)
	if (error instanceof AuthError) {
		return error.code === 'forbidden'
			? forbiddenResponse()
			: difyErrorResponse('unauthorized', 'Sign in required.', 401)
	}
	console.error(`${context}:`, error)
	return difyErrorResponse('internal_error', 'Internal Server Error', 500)
}
