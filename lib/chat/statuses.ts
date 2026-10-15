/*
 * The conversation store's value sets (Part 2 spec §3.1), client-safe: the schema builds its CHECKs from them
 * (db/schema/conversations.ts), the data layer types its rows with them (lib/data/conversations.ts), and the turn
 * reducer reads a run's status with them (lib/chat/turn.ts). Text columns with a CHECK rather than PostgreSQL enums,
 * for the reason db/schema/apps.ts gives for `provider`: a value added to an enum "cannot be used until after the
 * transaction has been committed" (PostgreSQL 18 "ALTER TYPE", Notes) while the migrator applies every pending
 * migration in one transaction.
 */

/** A run's state (spec §3.1): `running` until the run ends one of the other five ways (spec §3.2, §4.5). */
export const RUN_STATUSES = [
	'running',
	'succeeded',
	'interrupted',
	'cancelled',
	'failed',
	'truncated',
] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

/** A stored message's state (spec §3.1): open while it streams, then complete, or incomplete when the run was cut short. */
export const MESSAGE_STATUSES = ['streaming', 'complete', 'incomplete'] as const

export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

/** The seven AG-UI message roles (AG-UI 1.0 "Messages"; `@ag-ui/core` 1.0.2 `Message`). */
export const MESSAGE_ROLES = [
	'developer',
	'system',
	'assistant',
	'user',
	'tool',
	'activity',
	'reasoning',
] as const

export type MessageRole = (typeof MESSAGE_ROLES)[number]

/** Spec §3.1: the first user message, trimmed to 80 characters (code points), until renamed. */
export const TITLE_MAX_LENGTH = 80

/** Spec §3.4: a deleted conversation is purged after 30 days. */
export const PURGE_AFTER_DAYS = 30

/*
 * The tool messages the hub writes itself (lib/chat/thread.ts builds them; the turn reducer reads their `error`). Here,
 * not in thread.ts, because thread.ts is server-only and the browser's reducer (lib/chat/turn.ts) needs the first one.
 */

/** Spec §3.2 step 4: the error of a call the run never answered because it was stopped, failed or cut off. */
export const STOPPED_TOOL_ERROR = 'stopped'
export const STOPPED_TOOL_CONTENT = 'The run was stopped before this tool returned a result.'
/** Spec §6.2's last bullet (plan call P4): a call to a tool the hub never advertised. */
export const UNAVAILABLE_TOOL_ERROR = 'not_available'
export const UNAVAILABLE_TOOL_CONTENT = 'This tool is not available here.'
/** 2b's plan call P3: an ask_user call whose arguments failed the schema, which the hub answers on Dismiss. */
export const INVALID_QUESTION_ERROR = 'invalid_arguments'
export const INVALID_QUESTION_CONTENT =
	'The questions did not match the parameters of the ask_user tool, so the user could not answer them.'
