import 'server-only'

import { DrizzleQueryError } from 'drizzle-orm'

/*
 * Server error logging without secrets (decision g). A leaf module: it imports drizzle-orm only, so the auth options
 * can log a sign-in failure without importing lib/action-failure.ts, whose AuthError import from lib/auth/session.ts
 * would close a cycle back to lib/auth/options.ts (MDN "JavaScript modules", "Cyclic imports": "You should usually
 * avoid cyclic imports"; "Move the shared code into a third module").
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
 * What the server log may carry for an error (decision g). Drizzle's DrizzleQueryError puts the query's
 * parameters in its message (node_modules/drizzle-orm/errors.js), and mysql2's error carries the SQL and the
 * duplicate value: a users write would log the bcrypt hash, an apps write the API key. A DrizzleQueryError is
 * logged by its name and its cause's code and errno, a bare driver error (one with an errno, mysql2's server
 * errors) by name, code and errno; any other error as it is.
 */
export const describeError = (error: unknown): unknown => {
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
 * A refused sign-in, logged once with a fixed reason code and a subject that names the account without a secret
 * (B3 spec §7.3: the login form shows a generic message, as OWASP's "Authentication Responses" asks, so the reason
 * lives in the server log). Pass an account id or a directory username, never a password, a hash or an email
 * (OWASP Logging Cheat Sheet, "Data to exclude").
 */
export const logSignInRefusal = (
	context: string,
	reason: string,
	subject: Record<string, string>,
): void => {
	console.warn(`${context}: sign-in refused`, { reason, ...subject })
}
