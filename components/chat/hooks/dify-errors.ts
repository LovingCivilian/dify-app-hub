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

/** The app's own refusal codes (charter §4.5): their English messages are never shown, these keys are. */
const APP_CODE_KEYS = {
	unauthorized: 'chat.error_unauthorized',
	app_not_found: 'chat.error_app_not_found',
	app_disabled: 'chat.error_app_disabled',
	invalid_param: 'chat.error_invalid_param',
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
 * The toast for a human input form that could not go on (ADR-0017). Once Dify has accepted the form only the
 * continuation failed (x-sdk's onReload throws for a message the store does not hold) and a second submission
 * would be refused (412), so the text says the answer was sent; otherwise the reason (failureText), or the
 * generic text.
 */
export const humanInputFailureText = (error: unknown, accepted: boolean, t: TFunction): string => {
	if (accepted) return t('hitl.resume_failed')
	const reason = failureText(error, t)
	return reason ? t('hitl.submit_failed_reason', { error: reason }) : t('hitl.submit_failed')
}
