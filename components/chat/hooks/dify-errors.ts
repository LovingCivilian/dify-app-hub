import type { TFunction } from 'i18next'

import { DifyRequestError } from '../provider/dify-fetch'

/**
 * Any failure as the error the chat hooks report: the browser client's DifyRequestError as it is (the code and
 * message of the answer's envelope, or no message); a network failure or the like keeps no text and is kept as
 * `cause`. What the user reads comes from `failureText`; hooks never make up English text of their own.
 */
export const toDifyError = (error: unknown): DifyRequestError => {
	if (error instanceof DifyRequestError) return error
	const wrapped = new DifyRequestError(0, undefined, '')
	wrapped.cause = error
	return wrapped
}

/**
 * The app's own refusal codes (charter §4.5): their English messages are never shown, these keys are. Not
 * `invalid_param`: Dify refuses a missing or bad field with it too, and its message is the reason (endpoint map: legend, §4).
 */
const APP_CODE_KEYS = {
	unauthorized: 'chat.error_unauthorized',
	app_not_found: 'chat.error_app_not_found',
	app_disabled: 'chat.error_app_disabled',
	upstream_error: 'chat.error_upstream_error',
	upstream_unreachable: 'chat.error_upstream_unreachable',
} as const

const isAppCode = (code: string | undefined): code is keyof typeof APP_CODE_KEYS =>
	code !== undefined && Object.hasOwn(APP_CODE_KEYS, code)

/**
 * The text a user reads for a failure: an app code through its i18n key; Dify's own code with Dify's message
 * (ADR-0017); `fallback` (the consumer's generic text) for `internal_error`, an answer without a message, or a
 * failure that is not an answer at all.
 */
export const failureText = (error: unknown, t: TFunction, fallback = ''): string => {
	const { code, message } = toDifyError(error)
	if (isAppCode(code)) return t(APP_CODE_KEYS[code])
	if (code === 'internal_error') return fallback
	return message || fallback
}

/**
 * The resume stream ended without the pause it opened for: the run no longer waits on the form (it was answered
 * elsewhere, or it expired and the run went on), so the answer is not sent.
 */
export class FormNotWaitingError extends Error {
	constructor() {
		super('The run no longer waits on this form.')
		this.name = 'FormNotWaitingError'
	}
}

/**
 * Dify accepted the answer, but the resume stream had already closed with the run at its pause (Stop during the
 * submission, a dropped connection, Dify's idle close): the continuation goes on in Dify without this page.
 */
export class ContinuationLostError extends Error {
	constructor() {
		super('The answer was accepted after the run stream closed.')
		this.name = 'ContinuationLostError'
	}
}

/**
 * The toast for a human input answer that did not go out, or whose continuation cannot be shown (ADR-0017): nothing
 * for the user's own stop; `hitl.not_waiting` for a run that no longer waits; `hitl.resume_failed` for an answer
 * Dify accepted after the stream closed; otherwise the reason (failureText), or the generic text. A continuation
 * that fails after it started is shown on the message (`hitl.resume_failed` too).
 */
export const humanInputFailureText = (error: unknown, t: TFunction): string => {
	if (error instanceof Error && error.name === 'AbortError') return ''
	if (error instanceof FormNotWaitingError) return t('hitl.not_waiting')
	if (error instanceof ContinuationLostError) return t('hitl.resume_failed')
	const reason = failureText(error, t)
	return reason ? t('hitl.submit_failed_reason', { error: reason }) : t('hitl.submit_failed')
}
