import type { ActionErrorCode } from '@/lib/action-result'

/** A users action's failure code as the message the admin reads (charter §4.5: codes, never a route's text). */
export const userErrorKey = (code: ActionErrorCode) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'not_found':
			return 'admin_users.not_found' as const
		case 'email_in_use':
			return 'admin_users.email_in_use' as const
		case 'cannot_delete_self':
			return 'admin_users.cannot_delete_self' as const
		case 'cannot_deactivate_self':
			return 'admin_users.cannot_deactivate_self' as const
		case 'sync_running':
			return 'admin_users.sync_running' as const
		case 'invalid_input':
			return 'admin_users.invalid_input' as const
		default:
			return 'common.operation_failed' as const
	}
}
