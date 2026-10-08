import 'server-only'

import { DrizzleQueryError } from 'drizzle-orm'
import * as z from 'zod'

import { fail, type ActionFailure } from '@/lib/action-result'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

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

/** Logs an action's unexpected failure with its context (charter §4.5: the failure itself is never shown). */
export const logActionError = (error: unknown, context: string): void => {
	console.error(`${context}:`, describeError(error))
}

/** A zod refusal as the action result (charter §4.5: fieldErrors keyed by field path). */
export const invalidInput = (error: z.ZodError): ActionFailure =>
	fail('invalid_input', z.flattenError(error).fieldErrors as Record<string, string[]>)

/**
 * An exception inside an action as its failure result (charter §4.5: two vocabularies on purpose; a DifyError
 * becomes dify_unreachable, never a raw envelope). A DifyError and an unexpected error are logged with their
 * context first, so a wrong key or a failing Dify leaves a trace on the server; the message of a DifyError never
 * carries the API key. An AuthError is an expected outcome and is not logged.
 */
export const toActionFailure = (error: unknown, context: string): ActionFailure => {
	if (error instanceof AuthError) return fail(error.code)
	if (error instanceof DifyError) {
		console.error(`${context}:`, { status: error.status, code: error.code, message: error.message })
		return fail('dify_unreachable')
	}
	logActionError(error, context)
	return fail('operation_failed')
}
