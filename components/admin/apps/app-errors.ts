import type { ActionErrorCode } from '@/lib/action-result'

export type AppAction = 'save' | 'sync' | 'delete'

/** An action's failure code as the message the admin reads (charter §4.5: codes, never a route's text). */
export const appErrorKey = (code: ActionErrorCode, action: AppAction) => {
	switch (code) {
		case 'unauthorized':
		case 'forbidden':
			return 'common.session_expired' as const
		case 'not_found':
			return 'admin_apps.not_found' as const
		case 'dify_unreachable':
			return 'admin_apps.dify_unreachable' as const
		case 'invalid_input':
			return 'admin_apps.invalid_input' as const
		default:
			return action === 'sync'
				? ('admin_apps.sync_failed' as const)
				: action === 'delete'
					? ('common.delete_failed' as const)
					: ('admin_apps.save_failed' as const)
	}
}
