import type { ActionErrorCode } from '@/lib/action-result'

/** The reset handler's HTTP status as a translation key (the reset flow stays on its Route Handler, ADR-0024). */
export const resetFailureKey = (status: number) =>
	status === 400 ? ('auth.reset_link_expired' as const) : ('auth.reset_failed_retry' as const)

/**
 * The first-run action's failure code as a translation key (charter §4.5): forbidden once any account exists
 * (another tab finished first); anything else, try again.
 */
export const initFailureKey = (code: ActionErrorCode) =>
	code === 'forbidden' ? ('init.already_initialized' as const) : ('init.failed' as const)
