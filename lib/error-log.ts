import 'server-only'

import { DrizzleQueryError } from 'drizzle-orm'
import { ResultCodeError } from 'ldapts'
import { DatabaseError } from 'pg'

import {
	DirectoryConfigError,
	DirectoryRefusedError,
	DirectoryUnavailableError,
} from '@/lib/directory/errors'

/*
 * Server error logging without secrets (decision g). A leaf module: it imports drizzle-orm, ldapts, pg and the
 * directory's error classes only (lib/directory/errors.ts imports nothing of the hub's), so the auth options can log a
 * sign-in failure without importing lib/action-failure.ts, whose AuthError import from lib/auth/session.ts would close a
 * cycle back to lib/auth/options.ts (MDN "JavaScript modules", "Cyclic imports": "You should usually avoid cyclic
 * imports"; "Move the shared code into a third module").
 */

/**
 * A Node system error by its code and errno (Node "Class: SystemError": `code`, "the string error code", and `errno`,
 * "the system-provided error number"): a socket error such as a refused connection, to the database or to the
 * directory. Both are labels; its message (an address and a port) is left out.
 */
const driverFields = (value: unknown) =>
	typeof value === 'object' && value !== null && 'errno' in value
		? {
				code: 'code' in value ? value.code : undefined,
				errno: value.errno,
			}
		: null

/**
 * The code of the error under a DrizzleQueryError, kept only as a string: PostgreSQL's SQLSTATE (node-postgres
 * `DatabaseError.code`, e.g. '23505'; PostgreSQL 18 Appendix A) or Node's code for a connection that failed
 * ('ECONNREFUSED'; Node: "error.code is the most stable way to identify an error"). Nothing else of it is kept: its
 * `detail` names the refused value ("Key (lower(email))=(…) already exists."), its message can quote it ("invalid input
 * syntax for type uuid: …"), and pg's lost connection ("Connection terminated unexpectedly") has no code at all.
 */
const causeCode = (cause: unknown): string | undefined =>
	typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
		? cause.code
		: undefined

/**
 * A directory error's cause: a result error, a directory error or a socket error with an errno as describeError reduces
 * it; any other error by its name, its string code and Node's own message, so a TLS error's `cert` (the peer's whole
 * certificate) and `host` never reach the log (OWASP Logging Cheat Sheet, "Data to exclude").
 */
const directoryCause = (cause: unknown): unknown => {
	// A directory error inside another, such as a refusal the person's bind met while the socket died (connection.ts wraps
	// it as unreachable), keeps its own reduced cause, so the log still names the result code (decision u).
	if (
		cause instanceof ResultCodeError ||
		cause instanceof DirectoryUnavailableError ||
		cause instanceof DirectoryRefusedError ||
		driverFields(cause)
	)
		return describeError(cause)
	if (!(cause instanceof Error)) return cause
	const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
	return code === undefined
		? { name: cause.name, message: cause.message }
		: { name: cause.name, code, message: cause.message }
}

/**
 * What the server log may carry for an error (decision g). Drizzle's DrizzleQueryError puts the query's parameters in
 * its message (node_modules/drizzle-orm/errors.js), and node-postgres's DatabaseError carries the refused value in its
 * `detail` and, for some codes, in its message: a users write would log an email or the bcrypt hash, an apps write the
 * API key. A DrizzleQueryError is logged by its name and its cause's code, a bare DatabaseError (an idle pool client's,
 * or a failure outside a query) by its name and SQLSTATE, a Node system error by name, code and errno; any other error
 * as it is.
 */
export const describeError = (error: unknown): unknown => {
	// Spec §7.3: an ldapts result error by its class and LDAP result code (its message carries the server's diagnostic
	// text); a directory error by its name and its cause, reduced (directoryCause).
	if (error instanceof ResultCodeError) return { name: error.name, code: error.code }
	if (error instanceof DirectoryUnavailableError || error instanceof DirectoryRefusedError)
		return { name: error.name, cause: directoryCause(error.cause) }
	// A setting the hub cannot use (final review I1): its name, and the cause's string code only (Node: "error.code is the
	// most stable way to identify an error"), since a file error's `path` and message carry the path.
	if (error instanceof DirectoryConfigError) {
		const code = causeCode(error.cause)
		return { name: error.name, setting: error.setting, cause: code === undefined ? {} : { code } }
	}
	if (error instanceof DrizzleQueryError) return { name: error.name, code: causeCode(error.cause) }
	if (error instanceof DatabaseError) return { name: error.name, code: error.code }
	const driver = driverFields(error)
	if (driver && error instanceof Error) return { name: error.name, ...driver }
	return error
}

/** Logs an unexpected failure with its context (charter §4.5: the failure itself is never shown). */
export const logActionError = (error: unknown, context: string): void => {
	console.error(`${context}:`, describeError(error))
}

/**
 * The fixed reason codes of a refused sign-in (B3 spec §7.3). Both providers: `invalid_input`, a body their input check
 * refuses, logged without a subject (OWASP Logging Cheat Sheet, "Which events to log": "Input validation failures").
 * Local: `account_inactive`, `directory_account`. Directory: `directory_off`, the check's `unknown_user`,
 * `ambiguous_user`, `invalid_entry`, `wrong_password`, and the DAL's `account_inactive`, `entry_without_email`,
 * `email_in_use` (ADR-0029).
 */
export type SignInRefusalReason =
	| 'invalid_input'
	| 'account_inactive'
	| 'directory_account'
	| 'directory_off'
	| 'unknown_user'
	| 'ambiguous_user'
	| 'invalid_entry'
	| 'wrong_password'
	| 'entry_without_email'
	| 'email_in_use'

/**
 * A refused sign-in, logged once with a fixed reason code and a subject that names the account without a secret
 * (B3 spec §7.3: the login form shows a generic message, as OWASP's "Authentication Responses" asks, so the reason
 * lives in the server log). Pass an account id or a directory username, never a password, a hash or an email
 * (OWASP Logging Cheat Sheet, "Data to exclude"). The reason is written after the subject, so a subject key cannot
 * replace it.
 */
export const logSignInRefusal = (
	context: string,
	reason: SignInRefusalReason,
	subject: Record<string, string>,
): void => {
	console.warn(`${context}: sign-in refused`, { ...subject, reason })
}

/** A directory sign-in or refresh kept the stored email because another account has the entry's (spec §2 #11). */
export const logDirectoryEmailConflict = (context: string, subject: { userId: string }): void => {
	console.warn(`${context}: directory email kept`, { ...subject, reason: 'email_conflict' })
}

/**
 * A setting the hub could not use (settings spec §4.2, §7): the variable or record and a code, never a path or a value,
 * as LDAP_CA_FILE is logged (lib/directory/schedule.ts).
 */
export const logSettingsError = (setting: string, code: string): void => {
	console.error(`${setting} could not be used:`, { code })
}
