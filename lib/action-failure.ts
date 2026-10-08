import 'server-only'

import * as z from 'zod'

import { fail, type ActionFailure } from '@/lib/action-result'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'
import { logActionError } from '@/lib/error-log'

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
