import { DifyRequestError } from '../provider/dify-fetch'

/**
 * `DifyApi` (lib/dify-client.ts on BaseRequest) resolves an HTTP error with Dify's error body
 * (`{ code, message, status }`) instead of rejecting. This turns such a body into the error the chat
 * hooks report: `{ status, code?, message }`, where `message` is Dify's text or '' (the view then shows
 * its i18n text). Hooks never make up English text of their own.
 */
export const envelopeError = (answer: unknown, fallbackStatus = 0): DifyRequestError => {
	const body = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
	return new DifyRequestError(
		typeof body.status === 'number' ? body.status : fallbackStatus,
		typeof body.code === 'string' ? body.code : undefined,
		typeof body.message === 'string' ? body.message : '',
	)
}

/** Any failure in that same shape: a network error or the like keeps no text and is kept as `cause`. */
export const toDifyError = (error: unknown): DifyRequestError => {
	if (error instanceof DifyRequestError) return error
	const wrapped = new DifyRequestError(0, undefined, '')
	wrapped.cause = error
	return wrapped
}
