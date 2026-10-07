import 'server-only'

import { DifyError, difyErrorFromResponse } from './errors'
import type {
	AnnotationInput,
	AnnotationItem,
	AnnotationsPage,
	AnnotationsQuery,
	AppInfo,
	AppMeta,
	AppParameters,
	ChatMessageRequest,
	CompletionRequest,
	ConversationItem,
	ConversationsPage,
	ConversationsQuery,
	FeedbackRequest,
	FileUploadResponse,
	HumanInputForm,
	HumanInputSubmission,
	MessagesPage,
	MessagesQuery,
	RenameConversationRequest,
	SiteSettings,
	StopResponse,
	SuggestedQuestionsResponse,
	TextToAudioRequest,
	WorkflowEventsQuery,
	WorkflowRunRequest,
} from './types'

export interface DifyCredentials {
	/** The app's API base as Dify shows it, e.g. `https://host/v1`. */
	apiBase: string
	apiKey: string
}

/**
 * The upstream headers a passthrough answer keeps (charter §4.1: Content-Type, Content-Disposition, Content-Length,
 * Accept-Ranges); everything else (cookies, X-Version) stays behind. Dify's Cache-Control stays behind too: it marks
 * a file preview `public, max-age=3600`, and the route that serves it is session-gated, so a shared cache could hand
 * one user's file to others; each answer sets its own (`passthrough`, `filePassthrough`).
 */
const PASSTHROUGH_HEADERS = [
	'content-type',
	'content-disposition',
	'content-length',
	'accept-ranges',
] as const

type QueryValue = string | number | boolean | undefined

const queryString = (params: Record<string, QueryValue>) => {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) search.set(key, String(value))
	}
	const text = search.toString()
	return text ? `?${text}` : ''
}

const segment = (value: string) => encodeURIComponent(value)

const jsonInit = (method: 'POST' | 'PUT' | 'DELETE', body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
})

/**
 * The headers that carry meaning. Node's fetch decodes a gzip/br body but keeps the upstream headers, so a
 * Content-Length next to a Content-Encoding no longer fits the body and is dropped (it would truncate it).
 */
const forwardedHeaders = (upstream: Response): Headers => {
	const encoded = upstream.headers.has('content-encoding')
	const headers = new Headers()
	for (const name of PASSTHROUGH_HEADERS) {
		if (encoded && name === 'content-length') continue
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}
	return headers
}

/**
 * The upstream Response as the route answers it: Dify's status, the body as it is (a stream stays a stream),
 * and the headers that carry meaning. No re-pumping through a hand-written ReadableStream (Backend for
 * Frontend guide, "Proxying to a backend"). `Cache-Control: no-store`: a stream is one user's run, and Next adds no
 * Cache-Control to a dynamic Route Handler's answer (ADR-0023), so no cache of any kind may keep it (MDN
 * Cache-Control, `no-store`).
 */
export const passthrough = (upstream: Response): Response => {
	const headers = forwardedHeaders(upstream)
	headers.set('cache-control', 'no-store')
	return new Response(upstream.body, { status: upstream.status, headers })
}

/**
 * Media types a file answer may render inline when opened on its own; they cannot run script on the hub's
 * origin. `audio/*` and `video/*` are matched by their top-level type.
 */
const INLINE_FILE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'application/pdf',
	'text/plain',
])

/**
 * A file answer (preview, remote file, text-to-audio) as the route answers it: the headers `passthrough` keeps, plus
 * `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` (Dify's filename kept) for any type
 * outside the inline list. The bytes are served on the hub's own origin with the uploader's type, so an SVG or XML
 * file opened on its own would run its scripts there; as an attachment it downloads, while an `<img>` or `<audio>`
 * still renders it (Content-Disposition does not apply to subresources). Every answer is also `Cache-Control:
 * private` (the user's file behind the session cookie: the browser may keep it, a shared cache may not; MDN
 * Cache-Control) and, except a PDF, `Content-Security-Policy: sandbox` (a document opened on its own runs no script
 * on the hub's origin; Chrome's PDF viewer does not render under a sandbox, so a PDF goes without, as Outline does).
 * A CSP on a subresource answer does not affect the `<img>`, `<audio>` or `<video>` that loads it. Streams (SSE) stay
 * on `passthrough`.
 */
export const filePassthrough = (upstream: Response): Response => {
	const headers = forwardedHeaders(upstream)
	headers.set('x-content-type-options', 'nosniff')
	headers.set('cache-control', 'private')
	const contentType = headers.get('content-type') ?? ''
	const mediaType = contentType.split(';')[0].trim().toLowerCase()
	// A browser reads a comma list (or two joined upstream headers) as several types and keeps the last valid one
	// (Fetch Standard, "extract a MIME type"), so `text/plain, text/html` renders as HTML: a single media type has
	// no unquoted comma, and a list is never inline nor exempt from the sandbox.
	const single = !contentType.includes(',')
	if (!(single && mediaType === 'application/pdf'))
		headers.set('content-security-policy', 'sandbox')
	const inline =
		single &&
		(INLINE_FILE_TYPES.has(mediaType) ||
			mediaType.startsWith('audio/') ||
			mediaType.startsWith('video/'))
	if (!inline) {
		// The disposition type is the token before the first `;`; the parameters (the filename) follow it.
		const disposition = headers.get('content-disposition') ?? ''
		const separator = disposition.indexOf(';')
		headers.set(
			'content-disposition',
			`attachment${separator === -1 ? '' : disposition.slice(separator)}`,
		)
	}
	return new Response(upstream.body, { status: upstream.status, headers })
}

export const difyClient = (credentials: DifyCredentials) => {
	const base = credentials.apiBase.replace(/\/+$/, '')

	/**
	 * One upstream call: the bearer header (unless `bearer` is false: a signed link authenticates itself), a network
	 * failure as upstream_unreachable, a non-OK answer as DifyError.
	 */
	const request = async (url: string, init: RequestInit = {}, bearer = true): Promise<Response> => {
		let response: Response
		try {
			response = await fetch(url, {
				...init,
				headers: {
					...(init.headers as Record<string, string> | undefined),
					...(bearer && { Authorization: `Bearer ${credentials.apiKey}` }),
				},
			})
		} catch (error) {
			// The cause stays in the server log: Node's fetch puts the full URL (the Dify host, the user's email in a
			// query string) in its message, and errorResponseFrom sends a DifyError's message to the browser.
			console.error('Dify request failed:', error)
			throw new DifyError(502, 'upstream_unreachable', 'Dify is unreachable.')
		}
		if (!response.ok) throw await difyErrorFromResponse(response)
		return response
	}

	const send = (path: string, init?: RequestInit) => request(`${base}${path}`, init)

	/**
	 * A JSON body, or a 502 upstream_error when an OK answer cannot be read as JSON (an HTML page, an empty or
	 * truncated body, a read that fails mid-answer; Review Focus 1). The status is 502, not Dify's 2xx: the route
	 * answers with it, and a 2xx carrying an error envelope would be taken as data by the browser client.
	 */
	const json = async <T>(response: Response): Promise<T> => {
		try {
			return (await response.json()) as T
		} catch {
			throw new DifyError(
				502,
				'upstream_error',
				`Dify answered ${response.status} with an unreadable body.`,
			)
		}
	}

	const multipart = (file: File, user: string) => {
		const form = new FormData()
		form.append('file', file, file.name)
		form.append('user', user)
		// No Content-Type header: fetch sets the multipart boundary itself.
		return { method: 'POST', body: form } satisfies RequestInit
	}

	return {
		// Application metadata (endpoint map §1.1): no end-user context.
		getInfo: () => send('/info').then(json<AppInfo>),
		getParameters: () => send('/parameters').then(json<AppParameters>),
		getSite: () => send('/site').then(json<SiteSettings>),
		getMeta: () => send('/meta').then(json<AppMeta>),

		// Chat family (§1.2): `user` in the JSON body, or the query string on GETs.
		chatMessages: (body: ChatMessageRequest, user: string, signal?: AbortSignal) =>
			send('/chat-messages', { ...jsonInit('POST', { ...body, user }), signal }),
		stopChat: (taskId: string, user: string) =>
			send(`/chat-messages/${segment(taskId)}/stop`, jsonInit('POST', { user })).then(
				json<StopResponse>,
			),
		listMessages: (query: MessagesQuery, user: string) =>
			send(`/messages${queryString({ ...query, user })}`).then(json<MessagesPage>),
		getSuggested: (messageId: string, user: string) =>
			send(`/messages/${segment(messageId)}/suggested${queryString({ user })}`).then(
				json<SuggestedQuestionsResponse>,
			),
		createFeedback: (messageId: string, body: FeedbackRequest, user: string) =>
			send(`/messages/${segment(messageId)}/feedbacks`, jsonInit('POST', { ...body, user })).then(
				json<StopResponse>,
			),
		listConversations: (query: ConversationsQuery, user: string) =>
			send(`/conversations${queryString({ ...query, user })}`).then(json<ConversationsPage>),
		/** 204: resolves with nothing. */
		deleteConversation: async (conversationId: string, user: string): Promise<void> => {
			await send(`/conversations/${segment(conversationId)}`, jsonInit('DELETE', { user }))
		},
		renameConversation: (conversationId: string, body: RenameConversationRequest, user: string) =>
			send(
				`/conversations/${segment(conversationId)}/name`,
				jsonInit('POST', { ...body, user }),
			).then(json<ConversationItem>),

		// Completion and workflow (§1.3, §1.4): streams pass through.
		completionMessages: (body: CompletionRequest, user: string, signal?: AbortSignal) =>
			send('/completion-messages', { ...jsonInit('POST', { ...body, user }), signal }),
		stopCompletion: (taskId: string, user: string) =>
			send(`/completion-messages/${segment(taskId)}/stop`, jsonInit('POST', { user })).then(
				json<StopResponse>,
			),
		runWorkflow: (body: WorkflowRunRequest, user: string, signal?: AbortSignal) =>
			send('/workflows/run', { ...jsonInit('POST', { ...body, user }), signal }),
		stopWorkflow: (taskId: string, user: string) =>
			send(`/workflows/tasks/${segment(taskId)}/stop`, jsonInit('POST', { user })).then(
				json<StopResponse>,
			),
		/** Dify's singular `workflow` path; `user` must equal the run's creator (404 otherwise). */
		workflowEvents: (
			workflowRunId: string,
			user: string,
			query: WorkflowEventsQuery,
			signal?: AbortSignal,
		) =>
			send(`/workflow/${segment(workflowRunId)}/events${queryString({ ...query, user })}`, {
				signal,
			}),

		// Human input (§1.5).
		getHumanInputForm: (formToken: string) =>
			send(`/form/human_input/${segment(formToken)}`).then(json<HumanInputForm>),
		submitHumanInput: (formToken: string, body: HumanInputSubmission, user: string) =>
			send(`/form/human_input/${segment(formToken)}`, jsonInit('POST', { ...body, user })).then(
				json<Record<string, never>>,
			),

		// Files and audio (§1.6).
		uploadFile: (file: File, user: string) =>
			send('/files/upload', multipart(file, user)).then(json<FileUploadResponse>),
		filePreview: (fileId: string, asAttachment: boolean, user: string) =>
			send(
				`/files/${segment(fileId)}/preview${queryString({ as_attachment: asAttachment || undefined, user })}`,
			),
		/**
		 * A file link Dify handed out (message files, generated images), for the remote-file route, which checks the
		 * link first (`resolveRemoteFileUrl`). This guard is its own: a link on another origin than the API base's is
		 * refused before any fetch. The app key goes only to links under the API base path (`<base>/files/…`, the
		 * Service API preview, which needs it); Dify's root `/files/…` links are signed (timestamp, nonce, sign) and
		 * checked by their signature, so they get no bearer. A redirect is refused (it fails as
		 * upstream_unreachable), so a `/files/` answer can never lead the route to serve another origin.
		 */
		fetchRemoteFile: async (url: URL) => {
			const api = new URL(base)
			if (url.origin !== api.origin) {
				throw new DifyError(
					400,
					'invalid_param',
					'url must be a file link on the app’s Dify server.',
				)
			}
			const underApi = url.pathname.startsWith(`${api.pathname.replace(/\/+$/, '')}/files/`)
			return request(url.toString(), { redirect: 'error' }, underApi)
		},
		/**
		 * A signed link from Dify's own answer (`/site`'s `icon_url`), for the icon sync: no bearer (the signature
		 * authenticates it) and no origin check (Dify builds it from FILES_URL, which may be another origin than the
		 * API's); a redirect is refused.
		 */
		fetchSignedFile: (url: URL) => request(url.toString(), { redirect: 'error' }, false),
		audioToText: (file: File, user: string) =>
			send('/audio-to-text', multipart(file, user)).then(json<{ text: string }>),
		textToAudio: (body: TextToAudioRequest, user: string) =>
			send('/text-to-audio', jsonInit('POST', { ...body, user })),

		// Annotations (§1.7): no end-user context.
		listAnnotations: (query: AnnotationsQuery) =>
			send(`/apps/annotations${queryString({ ...query })}`).then(json<AnnotationsPage>),
		createAnnotation: (body: AnnotationInput) =>
			send('/apps/annotations', jsonInit('POST', body)).then(json<AnnotationItem>),
		updateAnnotation: (annotationId: string, body: AnnotationInput) =>
			send(`/apps/annotations/${segment(annotationId)}`, jsonInit('PUT', body)).then(
				json<AnnotationItem>,
			),
		/** 204: resolves with nothing. */
		deleteAnnotation: async (annotationId: string): Promise<void> => {
			await send(`/apps/annotations/${segment(annotationId)}`, { method: 'DELETE' })
		},
	}
}

export type DifyClient = ReturnType<typeof difyClient>
