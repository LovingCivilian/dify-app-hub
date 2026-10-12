import 'server-only'

/*
 * The database refusals the Data Access Layer answers itself, by SQLSTATE (PostgreSQL 18 Appendix A, "PostgreSQL Error
 * Codes": "Applications that need to know which error condition has occurred should usually test the error code,
 * rather than looking at the textual error message"). node-postgres reports a server error as a `DatabaseError` with the
 * SQLSTATE in `code` and the refusing constraint's name in `constraint` (brianc/node-postgres
 * `packages/pg-protocol/src/messages.ts`); a unique index names itself there. Drizzle passes the driver's error on as
 * the `cause` of its DrizzleQueryError (node_modules/drizzle-orm/errors.js), so both places are read, by their fields.
 */

const codeOf = (value: unknown) =>
	typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined

const constraintOf = (value: unknown) =>
	typeof value === 'object' && value !== null && 'constraint' in value
		? value.constraint
		: undefined

const matches = (value: unknown, code: string, constraint: string | undefined): boolean =>
	codeOf(value) === code && (constraint === undefined || constraintOf(value) === constraint)

/** The SQLSTATE, and the constraint when one is named, on the error itself or on its cause. */
const hasCode = (error: unknown, code: string, constraint?: string): boolean =>
	matches(error, code, constraint) ||
	(error instanceof Error && matches(error.cause, code, constraint))

/**
 * 23505 unique_violation: a unique index refused a write that raced the check before it. With `constraint`, only that
 * index counts: `users` has three (`users_email_key`, `users_directory_id_key`, `users_one_owner`), and the error says
 * which one refused (Appendix A: the name is "supplied in separate fields of the error report message so that
 * applications need not try to extract them from the possibly-localized human-readable text").
 */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean =>
	hasCode(error, '23505', constraint)

/**
 * 23503 foreign_key_violation: a foreign key refused an id that no longer exists, such as an account or a group deleted
 * while the admin's form was open (plan deviation 3).
 */
export const isForeignKeyViolation = (error: unknown): boolean => hasCode(error, '23503')

/**
 * 40P01 deadlock_detected: PostgreSQL broke a deadlock by aborting this transaction, which may be run again (PostgreSQL
 * 18 "Explicit Locking", 13.3.4 "Deadlocks": "deadlocks can be handled on-the-fly by retrying transactions that abort
 * due to deadlocks").
 */
export const isDeadlock = (error: unknown): boolean => hasCode(error, '40P01')

/**
 * 22P02 invalid_text_representation: a value its column's type cannot read, such as a malformed id for a `uuid` column
 * (PostgreSQL 18 "UUID Type"). Every id from outside is checked before a query (spec §3.2); this is the safety net that
 * lets a missed spot answer as an unknown id instead of a 500 (lib/action-failure.ts, lib/dify/errors.ts).
 */
export const isInvalidTextRepresentation = (error: unknown): boolean => hasCode(error, '22P02')
