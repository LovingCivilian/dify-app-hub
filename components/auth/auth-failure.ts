/** Spec §3.6: the auth routes answer in Chinese; the client maps the status. */
export const resetFailureKey = (status: number) =>
	status === 400 ? ('auth.reset_link_expired' as const) : ('auth.reset_failed_retry' as const)

export const initFailureKey = (status: number) =>
	status === 400 ? ('init.already_initialized' as const) : ('init.failed' as const)
