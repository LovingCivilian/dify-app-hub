import type { SyncOutcome, SyncTrigger } from '@/lib/directory-status'

/** Each run outcome's label key (spec §6.6; decision ap adds `interrupted`). */
export const OUTCOME_LABEL_KEYS = {
	running: 'admin_users.sync_outcome_running',
	succeeded: 'admin_users.sync_outcome_succeeded',
	failed: 'admin_users.sync_outcome_failed',
	empty: 'admin_users.sync_outcome_empty',
	id_attribute_changed: 'admin_users.sync_outcome_id_attribute_changed',
	interrupted: 'admin_users.sync_outcome_interrupted',
} as const satisfies Record<SyncOutcome | 'interrupted', string>

export const OUTCOME_COLORS = {
	running: 'processing',
	succeeded: 'success',
	failed: 'error',
	empty: 'warning',
	id_attribute_changed: 'warning',
	interrupted: 'default',
} as const satisfies Record<SyncOutcome | 'interrupted', string>

export const TRIGGER_LABEL_KEYS = {
	schedule: 'admin_users.sync_trigger_schedule',
	startup: 'admin_users.sync_trigger_startup',
	manual: 'admin_users.sync_trigger_manual',
} as const satisfies Record<SyncTrigger, string>

/** A run's fixed error code as its text; an unknown code reads as the internal one (spec §7.3). */
export const syncErrorKey = (code: string) => {
	switch (code) {
		case 'directory_unreachable':
			return 'admin_users.sync_error_directory_unreachable' as const
		case 'bind_refused':
			return 'admin_users.sync_error_bind_refused' as const
		case 'search_failed':
			return 'admin_users.sync_error_search_failed' as const
		default:
			return 'admin_users.sync_error_internal_error' as const
	}
}
