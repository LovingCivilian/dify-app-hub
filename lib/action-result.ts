/** The codes a Server Action can answer with; the client maps each to a translation key (charter §4.5). */
export type ActionErrorCode =
	| 'unauthorized'
	| 'forbidden'
	| 'invalid_input'
	| 'email_in_use'
	| 'name_in_use'
	| 'cannot_delete_self'
	| 'not_found'
	| 'dify_unreachable'
	| 'operation_failed'

export interface ActionFailure {
	ok: false
	code: ActionErrorCode
	/** `invalid_input` only: zod's flattened field errors, keyed by field path. */
	fieldErrors?: Record<string, string[]>
}

export type ActionResult<T = undefined> = { ok: true; data: T } | ActionFailure

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data })

export const fail = (
	code: ActionErrorCode,
	fieldErrors?: Record<string, string[]>,
): ActionFailure => (fieldErrors ? { ok: false, code, fieldErrors } : { ok: false, code })
