import type { TFunction } from 'i18next'

import { DifyRequestError } from '../provider/dify-fetch'

/**
 * Any failure as the error the chat hooks report: the browser client's DifyRequestError as it is (Dify's code
 * and message, or the status text); a network failure or the like keeps no text (the view then shows its
 * i18n text) and is kept as `cause`. Hooks never make up English text of their own.
 */
export const toDifyError = (error: unknown): DifyRequestError => {
	if (error instanceof DifyRequestError) return error
	const wrapped = new DifyRequestError(0, undefined, '')
	wrapped.cause = error
	return wrapped
}

/**
 * The toast for a human input form that could not go on (ADR-0017). Once Dify has accepted the form only the
 * continuation failed (x-sdk's onReload throws for a message the store does not hold) and a second submission
 * would be refused (412), so the text says the answer was sent; otherwise Dify's reason, or the generic text.
 */
export const humanInputFailureText = (error: unknown, accepted: boolean, t: TFunction): string => {
	if (accepted) return t('hitl.resume_failed')
	const { message } = toDifyError(error)
	return message ? t('hitl.submit_failed_reason', { error: message }) : t('hitl.submit_failed')
}
