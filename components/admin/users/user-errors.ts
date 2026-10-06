export type UserAction = 'create' | 'update' | 'delete'

/**
 * Spec §3.6: /api/users answers 400 for a taken email (create, update) or a self-delete, 404 for a missing user,
 * 401 without a live session. The form already guarantees the required fields, so 400 has one meaning per action.
 */
export const userErrorKey = (status: number, action: UserAction) => {
	if (status === 401) return 'common.session_expired' as const
	if (status === 404) return 'admin_users.not_found' as const
	if (status === 400) {
		return action === 'delete'
			? ('admin_users.cannot_delete_self' as const)
			: ('admin_users.email_in_use' as const)
	}
	return 'common.operation_failed' as const
}
