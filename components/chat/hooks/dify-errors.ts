import type { TFunction } from 'i18next'

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

/**
 * The answer of POST /api/client/dify/<app>/form/human_input/<token> (DifyApi.submitHumanInput resolves
 * it whatever the status): the proxy route wraps Dify's answer as `{ code: <HTTP status>, data }`
 * (createDifyApiResponse), with Dify's `{}` on success (OpenAPI: "The response body is an empty object")
 * and `{ error: <Dify's error body as text> }` otherwise; its own failures (session, server) answer
 * `{ error }`. Undefined when the form was accepted, else the error with Dify's message or ''.
 */
export const humanInputSubmitError = (answer: unknown): DifyRequestError | undefined => {
	const body = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
	const status = typeof body.code === 'number' ? body.code : 0
	const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<
		string,
		unknown
	>
	if (status >= 200 && status < 300 && data.error === undefined && body.error === undefined) return
	let difyBody: unknown = null
	if (typeof data.error === 'string') {
		try {
			difyBody = JSON.parse(data.error)
		} catch {
			difyBody = null
		}
	}
	return envelopeError(difyBody, status)
}

/**
 * The toast for a human input form that could not go on (spec §4.6). Once Dify has accepted the form
 * only the continuation failed (x-sdk's onReload throws for a message the store does not hold) and a
 * second submission would be refused (412), so the text says the answer was sent; otherwise Dify's
 * reason, or the generic text.
 */
export const humanInputFailureText = (error: unknown, accepted: boolean, t: TFunction): string => {
	if (accepted) return t('hitl.resume_failed')
	const { message } = toDifyError(error)
	return message ? t('hitl.submit_failed_reason', { error: message }) : t('hitl.submit_failed')
}

const recordOf = (value: unknown) =>
	(value && typeof value === 'object' ? value : {}) as Record<string, unknown>

const parseJsonText = (text: unknown): unknown => {
	if (typeof text !== 'string') return null
	try {
		return JSON.parse(text)
	} catch {
		return null
	}
}

/**
 * The answer of POST /api/client/dify/<app>/messages/<id>/feedbacks (DifyApi.createMessageFeedback
 * resolves it whatever the status): `{ code: <HTTP status>, data }` (createDifyApiResponse) with Dify's
 * `{ result: 'success' }`; on a Dify error `data` is `{ error, detail }`, `detail` being Dify's error body
 * as text (cut at 200 characters); the proxy's own failures answer `{ error }`. Undefined when Dify took
 * the rating, else the error with Dify's message or ''.
 */
export const feedbackError = (answer: unknown): DifyRequestError | undefined => {
	const body = recordOf(answer)
	const status = typeof body.code === 'number' ? body.code : 0
	const data = recordOf(body.data)
	if (status >= 200 && status < 300 && data.result === 'success') return
	return envelopeError(parseJsonText(data.detail), status)
}

/**
 * The answer of POST /api/client/dify/<app>/annotations (DifyApi.createAnnotation resolves it whatever the
 * status): `{ code: <HTTP status>, data }` with Dify's body as `data`, the new annotation (its `id`) or
 * Dify's error body; the proxy's own failures answer `{ error }`.
 */
export const annotationError = (answer: unknown): DifyRequestError | undefined => {
	const body = recordOf(answer)
	const status = typeof body.code === 'number' ? body.code : 0
	const data = recordOf(body.data)
	if (status >= 200 && status < 300 && typeof data.id === 'string') return
	return envelopeError(data, status)
}

/**
 * The answer of POST /api/client/dify/<app>/text2audio (DifyApi.text2Audio resolves the Response): the
 * proxy passes Dify's answer through (createDifyResponseProxy), audio when it worked, Dify's JSON error
 * body otherwise; its own failures answer `{ error }`. A JSON answer is never audio, whatever its status.
 */
export const audioAnswerError = async (
	response: Response,
): Promise<DifyRequestError | undefined> => {
	if (response.ok && !(response.headers.get('content-type') ?? '').includes('json')) return
	return envelopeError(await response.json().catch(() => null), response.status)
}
