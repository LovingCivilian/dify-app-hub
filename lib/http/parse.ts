import 'server-only'

import * as z from 'zod'

import { errorResponse } from './errors'

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }

/** `400 invalid_param` naming the paths that failed (charter §4.5), in the hub's envelope. */
const invalid = (issues: z.core.$ZodIssue[]): Parsed<never> => {
	const paths = [...new Set(issues.map(issue => issue.path.map(String).join('.') || 'body'))]
	return {
		ok: false,
		response: errorResponse('invalid_param', `Invalid request: ${paths.join(', ')}`, 400),
	}
}

/**
 * A dynamic path segment forwarded to a provider (task id, message id, conversation id, file id, form token): RFC 3986
 * unreserved characters, 1-256 long, never a bare `.` or `..` (fetch's URL parser collapses those, so encoding the
 * segment cannot stop `..` from rewriting the upstream path). Not UUID-strict on purpose: the e2e stub's
 * message-file ids (`file-<uuid>`) and form tokens (`ft-<uuid>`) are not UUIDs, and the map does not define the
 * form-token format.
 */
export const pathSegment = z.string().regex(/^(?!\.{1,2}$)[A-Za-z0-9._~-]{1,256}$/)

/** The JSON body against a schema; a body that is not JSON is `invalid_param` too. */
export const parseJsonBody = async <S extends z.ZodType>(
	request: Request,
	schema: S,
): Promise<Parsed<z.infer<S>>> => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return {
			ok: false,
			response: errorResponse('invalid_param', 'Request body is not valid JSON.', 400),
		}
	}
	const result = schema.safeParse(raw)
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
}

/**
 * A route's extra dynamic segments (everything but `appId`, which the route guard has checked) against `pathSegment`.
 * Run it right after the guard, before the body or any client call. Answers `400 invalid_param` naming each param that
 * failed; on success `data` carries just the named params:
 * `const segments = await parsePathParams(ctx.params, 'taskId')`.
 */
export const parsePathParams = async <P extends Record<string, string>, K extends keyof P & string>(
	params: Promise<P>,
	...names: K[]
): Promise<Parsed<Pick<P, K>>> => {
	const schema = z.object(Object.fromEntries(names.map(name => [name, pathSegment])))
	const result = schema.safeParse(await params)
	return result.success
		? { ok: true, data: result.data as Pick<P, K> }
		: invalid(result.error.issues)
}

/** The query string against a schema (every value arrives as a string; the schemas coerce). */
export const parseQuery = <S extends z.ZodType>(
	searchParams: URLSearchParams,
	schema: S,
): Parsed<z.infer<S>> => {
	const result = schema.safeParse(Object.fromEntries(searchParams))
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
}

/**
 * Exactly one non-empty `file` part with a name (Dify: one part, filename required; Review Focus 2 of the B1 plan).
 * Other parts (a client-sent `user`) are dropped: the route builds its own form for the provider.
 */
export const parseFilePart = async (request: Request): Promise<Parsed<File>> => {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected a multipart body with one file part.',
				400,
			),
		}
	}
	const files = form.getAll('file')
	const file = files[0]
	if (files.length !== 1 || !(file instanceof File) || !file.name || file.size === 0) {
		return {
			ok: false,
			response: errorResponse(
				'invalid_param',
				'Expected exactly one non-empty file part named file.',
				400,
			),
		}
	}
	return { ok: true, data: file }
}
