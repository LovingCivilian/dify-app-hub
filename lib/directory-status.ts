/**
 * The directory's vocabulary as the admin surface shows it (B3 spec §3.2, §6.4, §6.6, §7.1). Client-safe: the schema,
 * the sync and the users page's status panel read it.
 */

/** How a sync run started. */
export const SYNC_TRIGGERS = ['schedule', 'startup', 'manual'] as const
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number]

/** A run's outcome: `running` until it ends; `empty` and `id_attribute_changed` are safety stops that change no account (spec §6.4 step 2). */
export const SYNC_OUTCOMES = [
	'running',
	'succeeded',
	'failed',
	'empty',
	'id_attribute_changed',
] as const
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number]

/**
 * The fixed error code a failed run records (spec §3.2: "a fixed code, never a message with secrets"): the directory
 * did not answer (connection, TLS, timeout), refused the service account's bind, or refused a search; anything else.
 */
export const SYNC_ERROR_CODES = [
	'directory_unreachable',
	'bind_refused',
	'search_failed',
	'internal_error',
] as const
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number]

/**
 * A directory key in canonical text (spec §3.2): a lowercase 8-4-4-4-12 UUID (RFC 9562 §4). Client-safe, because the
 * groups form validates the keys it sends with it (Task 12).
 */
export const DIRECTORY_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Spec §6.5 "Linking": the most directory groups one search of the groups page shows. */
export const DIRECTORY_GROUP_SEARCH_LIMIT = 20

/** `LDAP_ENCRYPTION` (spec §7.1, §2 #18): chosen explicitly, no default. */
export const LDAP_ENCRYPTIONS = ['ldaps', 'starttls', 'none'] as const
export type LdapEncryption = (typeof LDAP_ENCRYPTIONS)[number]
