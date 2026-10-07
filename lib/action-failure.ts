import 'server-only'

import { fail, type ActionFailure } from '@/lib/action-result'
import { AuthError } from '@/lib/auth/session'
import { DifyError } from '@/lib/dify/errors'

/**
 * An exception inside an action as its failure result (charter §4.5: two vocabularies on purpose — a DifyError
 * becomes dify_unreachable, never a raw envelope). Unexpected errors are logged with their context.
 */
export const toActionFailure = (error: unknown, context: string): ActionFailure => {
	if (error instanceof AuthError) return fail(error.code)
	if (error instanceof DifyError) return fail('dify_unreachable')
	console.error(`${context}:`, error)
	return fail('operation_failed')
}
