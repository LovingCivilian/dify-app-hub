import type { ActionErrorCode } from '@/lib/action-result'

/** A groups action's failure code as the message the admin reads (charter §4.5: codes, never a server message). */
export const groupErrorKey = (code: ActionErrorCode) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'not_found':
			return 'admin_groups.not_found' as const
		case 'name_in_use':
			return 'admin_groups.name_in_use' as const
		case 'invalid_input':
			return 'admin_groups.invalid_input' as const
		default:
			return 'common.operation_failed' as const
	}
}
