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

/** The upstream headers a passthrough answer keeps (charter §4.1); everything else (cookies, X-Version) stays behind. */
const PASSTHROUGH_HEADERS = [
	'content-type',
	'content-disposition',
	'content-length',
	'accept-ranges',
	'cache-control',
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
 * The upstream Response as the route answers it: Dify's status, the body as it is (a stream stays a stream),
 * and the headers that carry meaning. No re-pumping through a hand-written ReadableStream (Backend for
 * Frontend guide, "Proxying to a backend").
 */
export const passthrough = (upstream: Response): Response => {
	const headers = new Headers()
	for (const name of PASSTHROUGH_HEADERS) {
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}
	return new Response(upstream.body, { status: upstream.status, headers })
}

export const difyClient = (credentials: DifyCredentials) => {
	const base = credentials.apiBase.replace(/\/+$/, '')

	/** One upstream call: the bearer header, a network failure as upstream_unreachable, a non-OK answer as DifyError. */
	const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
		let response: Response
		try {
			response = await fetch(url, {
				...init,
				headers: {
					...(init.headers as Record<string, string> | undefined),
					Authorization: `Bearer ${credentials.apiKey}`,
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

	/** A JSON body, or upstream_error when an OK answer is not JSON (Review Focus 1). */
	const json = async <T>(response: Response): Promise<T> => {
		try {
			return (await response.json()) as T
		} catch {
			throw new DifyError(
				response.status,
				'upstream_error',
				'Dify answered a body that is not JSON',
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
			send(`/workflow/${segment(workflowRunId)}/events${queryString({ user, ...query })}`, {
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
		/** A file link Dify handed out (message files, generated images, icons): the route checks the origin first. */
		fetchRemoteFile: (url: URL) => request(url.toString()),
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
