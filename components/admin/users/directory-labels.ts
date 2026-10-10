import type { SyncErrorCode, SyncOutcome, SyncTrigger } from '@/lib/directory-status'

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

export const SYNC_ERROR_LABEL_KEYS = {
	directory_unreachable: 'admin_users.sync_error_directory_unreachable',
	bind_refused: 'admin_users.sync_error_bind_refused',
	search_failed: 'admin_users.sync_error_search_failed',
	internal_error: 'admin_users.sync_error_internal_error',
} as const satisfies Record<SyncErrorCode, string>

/** A run's fixed error code as its text; a string the database holds that is no listed code reads as the internal one (spec §7.3). */
export const syncErrorKey = (code: string): (typeof SYNC_ERROR_LABEL_KEYS)[SyncErrorCode] =>
	(
		SYNC_ERROR_LABEL_KEYS as Record<
			string,
			(typeof SYNC_ERROR_LABEL_KEYS)[SyncErrorCode] | undefined
		>
	)[code] ?? SYNC_ERROR_LABEL_KEYS.internal_error

/**
 * Only the three directory codes fail inside `withDirectory`, before the run's first write, so only they can say that
 * nothing was changed; an internal error may come after some writes (`lib/directory/sync.ts` `reconcile`).
 */
export const syncFailedKey = (code: string | null) =>
	code === 'directory_unreachable' || code === 'bind_refused' || code === 'search_failed'
		? ('admin_users.sync_failed' as const)
		: ('admin_users.sync_failed_partial' as const)
