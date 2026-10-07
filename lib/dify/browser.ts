// Client-safe: no server-only import. The browser's one way to the Dify routes (charter §4.1): every JSON
// method resolves the typed body and rejects with DifyRequestError on a non-OK answer, so the chat keeps one parser.
import type {
	AnnotationInput,
	AnnotationItem,
	AnnotationsPage,
	AnnotationsQuery,
	AppParameters,
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
	WorkflowRunRequest,
} from './types'

/** Dify's error body (`{ code, message, status }`) as a thrown error; `code` is undefined for a body of another shape. */
export class DifyRequestError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | undefined,
		message: string,
	) {
		super(message)
		this.name = 'DifyRequestError'
	}
}

/**
 * Reads a non-OK answer. An empty or non-JSON body (a proxy page, Next's empty 500) keeps no message, never the
 * status text: nothing user-facing is English from the wire, the view shows its own i18n text (charter §4.5).
 */
export const readDifyError = async (response: Response): Promise<DifyRequestError> => {
	let body: { code?: unknown; message?: unknown } | null = null
	try {
		body = await response.json()
	} catch {
		body = null
	}
	return new DifyRequestError(
		response.status,
		typeof body?.code === 'string' ? body.code : undefined,
		typeof body?.message === 'string' ? body.message : '',
	)
}

type QueryValue = string | number | boolean | undefined
const queryString = (params: object) => {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params) as [string, QueryValue][])
		if (value !== undefined) search.set(key, String(value))
	const text = search.toString()
	return text ? `?${text}` : ''
}
const segment = (value: string) => encodeURIComponent(value)
const jsonInit = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
})
const filePart = (file: File): RequestInit => {
	const form = new FormData()
	form.append('file', file, file.name)
	return { method: 'POST', body: form }
}

export const createDifyApi = (appId: string) => {
	const base = `/api/dify/${segment(appId)}`
	const request = async (path: string, init?: RequestInit): Promise<Response> => {
		const response = await fetch(`${base}${path}`, init)
		if (!response.ok) throw await readDifyError(response)
		return response
	}
	const json = <T>(response: Response) => response.json() as Promise<T>

	return {
		getParameters: () => request('/parameters').then(json<AppParameters>),
		getSite: () => request('/site').then(json<SiteSettings>),

		listConversations: (query: ConversationsQuery) =>
			request(`/conversations${queryString(query)}`).then(json<ConversationsPage>),
		renameConversation: (conversationId: string, body: RenameConversationRequest) =>
			request(`/conversations/${segment(conversationId)}/name`, jsonInit('POST', body)).then(
				json<ConversationItem>,
			),
		deleteConversation: async (conversationId: string): Promise<void> => {
			await request(`/conversations/${segment(conversationId)}`, { method: 'DELETE' })
		},
		listMessages: (query: MessagesQuery) =>
			request(`/messages${queryString(query)}`).then(json<MessagesPage>),
		getSuggested: (messageId: string) =>
			request(`/messages/${segment(messageId)}/suggested`).then(json<SuggestedQuestionsResponse>),
		createFeedback: (messageId: string, body: FeedbackRequest) =>
			request(`/messages/${segment(messageId)}/feedbacks`, jsonInit('POST', body)).then(
				json<StopResponse>,
			),
		stopChat: (taskId: string) =>
			request(`/chat-messages/${segment(taskId)}/stop`, { method: 'POST' }).then(
				json<StopResponse>,
			),
		stopCompletion: (taskId: string) =>
			request(`/completion-messages/${segment(taskId)}/stop`, { method: 'POST' }).then(
				json<StopResponse>,
			),
		stopWorkflow: (taskId: string) =>
			request(`/workflows/tasks/${segment(taskId)}/stop`, { method: 'POST' }).then(
				json<StopResponse>,
			),

		/** The run's Response (a stream, or JSON when blocking); the caller reads it. */
		completion: (body: CompletionRequest, signal?: AbortSignal) =>
			request('/completion-messages', { ...jsonInit('POST', body), signal }),
		runWorkflow: (body: WorkflowRunRequest, signal?: AbortSignal) =>
			request('/workflows/run', { ...jsonInit('POST', body), signal }),

		getHumanInputForm: (formToken: string) =>
			request(`/form/human_input/${segment(formToken)}`).then(json<HumanInputForm>),
		submitHumanInput: (formToken: string, body: HumanInputSubmission) =>
			request(`/form/human_input/${segment(formToken)}`, jsonInit('POST', body)).then(
				json<Record<string, never>>,
			),

		uploadFile: (file: File) =>
			request('/files/upload', filePart(file)).then(json<FileUploadResponse>),
		/** The file's Response (binary with its disposition); the caller reads it. */
		filePreview: (fileId: string, options: { asAttachment?: boolean } = {}) =>
			request(
				`/files/${segment(fileId)}/preview${queryString({ as_attachment: options.asAttachment || undefined })}`,
			),
		audioToText: (file: File) =>
			request('/audio-to-text', filePart(file)).then(json<{ text: string }>),
		/** The audio's Response; the caller reads it. */
		textToAudio: (body: TextToAudioRequest) => request('/text-to-audio', jsonInit('POST', body)),

		listAnnotations: (query: AnnotationsQuery) =>
			request(`/apps/annotations${queryString(query)}`).then(json<AnnotationsPage>),
		createAnnotation: (body: AnnotationInput) =>
			request('/apps/annotations', jsonInit('POST', body)).then(json<AnnotationItem>),
		updateAnnotation: (annotationId: string, body: AnnotationInput) =>
			request(`/apps/annotations/${segment(annotationId)}`, jsonInit('PUT', body)).then(
				json<AnnotationItem>,
			),
		deleteAnnotation: async (annotationId: string): Promise<void> => {
			await request(`/apps/annotations/${segment(annotationId)}`, { method: 'DELETE' })
		},

		/** The app's URL for a file link Dify handed out (message files, generated images), fetched by the server. */
		remoteFileUrl: (url: string) => `${base}/files/remote?url=${encodeURIComponent(url)}`,
		/** For x-sdk's XRequest (components/chat/provider/dify-fetch.ts). */
		chatMessagesUrl: `${base}/chat-messages`,
		workflowEventsUrl: (workflowRunId: string) =>
			`${base}/workflow/${segment(workflowRunId)}/events`,
	}
}

export type DifyApi = ReturnType<typeof createDifyApi>
