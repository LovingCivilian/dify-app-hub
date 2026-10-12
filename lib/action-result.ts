/** The codes a Server Action can answer with; the client maps each to a translation key (charter §4.5). */
export type ActionErrorCode =
	| 'unauthorized'
	| 'forbidden'
	| 'invalid_input'
	| 'email_in_use'
	| 'name_in_use'
	| 'cannot_delete_self'
	| 'cannot_deactivate_self'
	| 'not_found'
	| 'provider_unreachable'
	| 'sync_running'
	| 'settings_not_editable'
	| 'invalid_image'
	| 'operation_failed'

export interface ActionFailure {
	ok: false
	code: ActionErrorCode
	/**
	 * `invalid_input` and `invalid_image` only, keyed by field path: zod's flattened field errors, or a rule the server
	 * checks itself (`showName: ['logo_required']`); for `invalid_image`, each refused image's refusal code by its kind
	 * (`logo: ['too_large']`, lib/settings/branding.ts).
	 */
	fieldErrors?: Record<string, string[]>
}

export type ActionResult<T = undefined> = { ok: true; data: T } | ActionFailure

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data })

export const fail = (
	code: ActionErrorCode,
	fieldErrors?: Record<string, string[]>,
): ActionFailure => (fieldErrors ? { ok: false, code, fieldErrors } : { ok: false, code })
