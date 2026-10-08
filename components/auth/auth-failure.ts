import type { ActionErrorCode } from '@/lib/action-result'

/** The reset handler's HTTP status as a translation key (the reset flow stays on its Route Handler, ADR-0024). */
export const resetFailureKey = (status: number) =>
	status === 400 ? ('auth.reset_link_expired' as const) : ('auth.reset_failed_retry' as const)

/**
 * next-auth's sign-in error as a translation key. `CredentialsSignin` is its code for an authorize() that returned
 * null, a wrong email or password (next-auth Pages, "Error codes"); any other code is a failure the user cannot fix
 * by retyping, such as the `Default` that `authorizeCredentials` throws when the database fails.
 */
export const loginFailureKey = (error: string) =>
	error === 'CredentialsSignin' ? ('auth.login_failed' as const) : ('auth.login_error' as const)

/**
 * The first-run action's failure code as a translation key (charter §4.5): forbidden once any account exists
 * (another tab finished first); anything else, try again.
 */
export const initFailureKey = (code: ActionErrorCode) =>
	code === 'forbidden' ? ('init.already_initialized' as const) : ('init.failed' as const)
