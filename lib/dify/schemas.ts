import 'server-only'

import * as z from 'zod'

import { difyErrorResponse } from './errors'

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }

/** `400 invalid_param` naming the paths that failed (charter §4.5), in Dify's own code and envelope. */
const invalid = (issues: z.core.$ZodIssue[]): Parsed<never> => {
	const paths = [...new Set(issues.map(issue => issue.path.map(String).join('.') || 'body'))]
	return {
		ok: false,
		response: difyErrorResponse('invalid_param', `Invalid request: ${paths.join(', ')}`, 400),
	}
}

const uuid = z.uuid()
const limit = z.coerce.number().int().min(1).max(100)
/** A query flag: Dify's booleans arrive as the strings true/false. */
const flag = z.enum(['true', 'false']).transform(value => value === 'true')
const inputs = z.record(z.string(), z.unknown())
const fileType = z.enum(['document', 'image', 'audio', 'video', 'custom'])
const responseMode = z.enum(['streaming', 'blocking'])

/** A `files[]` item (endpoint map §2.2): type required, local files by id, remote ones by URL. */
const fileInput = z.discriminatedUnion('transfer_method', [
	z.object({
		type: fileType,
		transfer_method: z.literal('local_file'),
		upload_file_id: z.string().min(1),
	}),
	z.object({
		type: fileType,
		transfer_method: z.literal('remote_url'),
		url: z.url().optional(),
		remote_url: z.url().optional(),
		upload_file_id: z.string().min(1).optional(),
	}),
])

/** A human-input file mapping (endpoint map §1.5): `type` is optional there. */
const fileMapping = z.discriminatedUnion('transfer_method', [
	z.object({
		transfer_method: z.literal('local_file'),
		upload_file_id: z.string().min(1),
		type: fileType.optional(),
	}),
	z.object({
		transfer_method: z.literal('remote_url'),
		url: z.url().optional(),
		remote_url: z.url().optional(),
		type: fileType.optional(),
	}),
])

// z.object strips unknown keys (zod 4), which is what keeps `user` and the tracing fields out.

export const chatMessagesBody = z.object({
	query: z.string(),
	inputs,
	files: z.array(fileInput).optional(),
	response_mode: responseMode.optional(),
	conversation_id: z.union([uuid, z.literal('')]).optional(),
	auto_generate_name: z.boolean().optional(),
	workflow_id: uuid.optional(),
})

export const messagesQuery = z.object({
	conversation_id: uuid,
	first_id: uuid.optional(),
	limit: limit.optional(),
})

export const conversationsQuery = z.object({
	last_id: uuid.optional(),
	limit: limit.optional(),
	sort_by: z.enum(['created_at', '-created_at', 'updated_at', '-updated_at']).optional(),
})

export const renameConversationBody = z
	.object({ name: z.string().trim().min(1).optional(), auto_generate: z.boolean().optional() })
	.refine(body => body.name !== undefined || body.auto_generate === true, {
		error: 'name or auto_generate is required',
		path: ['name'],
	})

export const feedbackBody = z.object({
	rating: z.enum(['like', 'dislike']).nullable(),
	content: z.string().optional(),
})

export const completionBody = z.object({
	inputs,
	query: z.string().optional(),
	files: z.array(fileInput).optional(),
	response_mode: responseMode.optional(),
})

export const workflowRunBody = z.object({
	inputs,
	files: z.array(fileInput).optional(),
	response_mode: responseMode.optional(),
})

export const workflowEventsQuery = z.object({
	include_state_snapshot: flag.optional(),
	continue_on_pause: flag.optional(),
})

export const humanInputBody = z.object({
	inputs: z.record(z.string(), z.union([z.string(), fileMapping, z.array(fileMapping)])),
	action: z.string().min(1),
})

export const filePreviewQuery = z.object({ as_attachment: flag.optional() })

export const textToAudioBody = z
	.object({
		message_id: uuid.optional(),
		text: z.string().optional(),
		voice: z.string().optional(),
	})
	.refine(body => Boolean(body.message_id || body.text), {
		error: 'message_id or text is required',
		path: ['text'],
	})

export const annotationsQuery = z.object({
	page: z.coerce.number().int().min(1).optional(),
	limit: limit.optional(),
	keyword: z.string().optional(),
})

export const annotationBody = z.object({
	question: z.string().trim().min(1),
	answer: z.string().trim().min(1),
})

export const remoteFileQuery = z.object({ url: z.string().min(1) })

export type ChatMessagesBody = z.infer<typeof chatMessagesBody>
export type MessagesQueryInput = z.infer<typeof messagesQuery>
export type ConversationsQueryInput = z.infer<typeof conversationsQuery>
export type RenameConversationBody = z.infer<typeof renameConversationBody>
export type FeedbackBody = z.infer<typeof feedbackBody>
export type CompletionBody = z.infer<typeof completionBody>
export type WorkflowRunBody = z.infer<typeof workflowRunBody>
export type WorkflowEventsQueryInput = z.infer<typeof workflowEventsQuery>
export type HumanInputBody = z.infer<typeof humanInputBody>
export type TextToAudioBody = z.infer<typeof textToAudioBody>
export type AnnotationsQueryInput = z.infer<typeof annotationsQuery>
export type AnnotationBody = z.infer<typeof annotationBody>

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
			response: difyErrorResponse('invalid_param', 'Request body is not valid JSON.', 400),
		}
	}
	const result = schema.safeParse(raw)
	return result.success ? { ok: true, data: result.data } : invalid(result.error.issues)
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
 * Exactly one non-empty `file` part with a name (Dify: one part, filename required; Review Focus 2). Other
 * parts (a client-sent `user`) are dropped: the route builds its own form for Dify.
 */
export const parseFilePart = async (request: Request): Promise<Parsed<File>> => {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return {
			ok: false,
			response: difyErrorResponse(
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
			response: difyErrorResponse(
				'invalid_param',
				'Expected exactly one non-empty file part named file.',
				400,
			),
		}
	}
	return { ok: true, data: file }
}
