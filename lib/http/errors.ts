import 'server-only'

import { AuthError } from '@/lib/auth/session'
import { isInvalidTextRepresentation } from '@/lib/data/db-errors'
import { logActionError } from '@/lib/error-log'

import { jsonNoStore } from './response'

/** The hub's error envelope: Dify's own shape (endpoint map §4), which every route of the hub answers (ADR-0023). */
export interface ErrorBody {
	code: string
	message: string
	status: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const isErrorBody = (value: unknown): value is ErrorBody =>
	isRecord(value) &&
	typeof value.code === 'string' &&
	typeof value.message === 'string' &&
	typeof value.status === 'number'

/**
 * A provider's refusal or failure as the envelope a route answers (Part 1 spec §3): each provider's server client throws
 * its own subclass (DifyError), and the neutral answers here and in lib/action-failure.ts read any of them without
 * importing the provider (spec §11).
 */
export class ProviderError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message)
		this.name = 'ProviderError'
	}
}

/** The hub's own refusal in the envelope (no-store, like every JSON answer of its routes). */
export const errorResponse = (code: string, message: string, status: number): Response =>
	jsonNoStore({ code, message, status } satisfies ErrorBody, { status })

/**
 * The refusal of a signed-in caller whose role does not allow the operation (charter §4.2): the one definition, which a
 * route's own role check and errorResponseFrom's AuthError('forbidden') both answer.
 */
export const forbiddenResponse = (): Response => errorResponse('forbidden', 'Not allowed.', 403)

/**
 * What a route answers for an exception: a ProviderError's envelope (the provider's, or its client's
 * upstream_unreachable), an AuthError's 401/403, a value its column's type cannot read (22P02), in practice a malformed
 * id that reached a `uuid` column unchecked, as an unknown app (Part 0 spec §3.2's safety net: a 404, never a 500; logged
 * by its code, lib/error-log.ts, since the message quotes the id), else a logged 500 whose body carries no detail
 * (Backend for Frontend guide: no sensitive information in error messages).
 */
export const errorResponseFrom = (error: unknown, context: string): Response => {
	if (error instanceof ProviderError) return errorResponse(error.code, error.message, error.status)
	if (error instanceof AuthError) {
		return error.code === 'forbidden'
			? forbiddenResponse()
			: errorResponse('unauthorized', 'Sign in required.', 401)
	}
	if (isInvalidTextRepresentation(error)) {
		logActionError(error, context)
		return errorResponse('app_not_found', 'No such app.', 404)
	}
	logActionError(error, context)
	return errorResponse('internal_error', 'Internal Server Error', 500)
}
