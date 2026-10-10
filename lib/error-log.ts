import 'server-only'

import { DrizzleQueryError } from 'drizzle-orm'
import { ResultCodeError } from 'ldapts'

import {
	DirectoryConfigError,
	DirectoryRefusedError,
	DirectoryUnavailableError,
} from '@/lib/directory/errors'

/*
 * Server error logging without secrets (decision g). A leaf module: it imports drizzle-orm, ldapts and the directory's
 * error classes only (lib/directory/errors.ts imports nothing of the hub's), so the auth options can log a sign-in
 * failure without importing lib/action-failure.ts, whose AuthError import from lib/auth/session.ts would close a cycle
 * back to lib/auth/options.ts (MDN "JavaScript modules", "Cyclic imports": "You should usually avoid cyclic imports";
 * "Move the shared code into a third module").
 */

const driverFields = (value: unknown) =>
	typeof value === 'object' && value !== null && 'errno' in value
		? {
				code: 'code' in value ? value.code : undefined,
				errno: value.errno,
			}
		: null

/**
 * The driver error under a DrizzleQueryError, by its code and errno, each kept only with its documented type: a
 * string label (mysql2's QueryError.code, e.g. 'ER_DUP_ENTRY' or 'PROTOCOL_CONNECTION_LOST'; Node: "error.code
 * is the most stable way to identify an error") and a number. mysql2's lost connection, connect timeout and
 * protocol errors carry a code and no errno (node_modules/mysql2/lib/base/connection.js).
 */
const causeFields = (cause: unknown) => {
	const fields = typeof cause === 'object' && cause !== null ? cause : {}
	return {
		code: 'code' in fields && typeof fields.code === 'string' ? fields.code : undefined,
		errno: 'errno' in fields && typeof fields.errno === 'number' ? fields.errno : undefined,
	}
}

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
 * What the server log may carry for an error (decision g). Drizzle's DrizzleQueryError puts the query's
 * parameters in its message (node_modules/drizzle-orm/errors.js), and mysql2's error carries the SQL and the
 * duplicate value: a users write would log the bcrypt hash, an apps write the API key. A DrizzleQueryError is
 * logged by its name and its cause's code and errno, a bare driver error (one with an errno, mysql2's server
 * errors) by name, code and errno; any other error as it is.
 */
export const describeError = (error: unknown): unknown => {
	// Spec §7.3: an ldapts result error by its class and LDAP result code (its message carries the server's diagnostic
	// text); a directory error by its name and its cause, reduced (directoryCause).
	if (error instanceof ResultCodeError) return { name: error.name, code: error.code }
	if (error instanceof DirectoryUnavailableError || error instanceof DirectoryRefusedError)
		return { name: error.name, cause: directoryCause(error.cause) }
	// A setting the hub cannot use (final review I1): its name, and the cause's string code only (Node: "error.code is
	// the most stable way to identify an error"), since a file error's `path` and message carry the path.
	if (error instanceof DirectoryConfigError) {
		const { code } = causeFields(error.cause)
		return { name: error.name, setting: error.setting, cause: code === undefined ? {} : { code } }
	}
	if (error instanceof DrizzleQueryError) return { name: error.name, ...causeFields(error.cause) }
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
