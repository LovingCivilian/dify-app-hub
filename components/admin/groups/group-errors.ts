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

/**
 * The directory group search's refusal (GET /api/directory/groups, decision al) as the message the admin reads: the
 * code of the route's envelope (ADR-0023), never its English message (charter §4.5). Anything else, a network
 * failure or a 500 among them, is the generic failure.
 */
export const directorySearchErrorKey = (code: string | undefined) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'invalid_param':
			return 'admin_groups.invalid_input' as const
		case 'directory_unavailable':
			return 'admin_groups.directory_unavailable' as const
		default:
			return 'common.operation_failed' as const
	}
}
