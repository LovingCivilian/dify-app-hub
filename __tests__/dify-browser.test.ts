import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDifyApi, DifyRequestError } from '@/lib/dify/browser'

const jsonResponse = (status: number, body: unknown, type = 'application/json') =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined]
	return { url, init: init ?? {}, headers: new Headers(init?.headers) }
}
const api = createDifyApi('app 1')

describe('createDifyApi: paths on the app route tree, Dify’s verbs', () => {
	it('GETs the metadata and the lists with their queries', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { user_input_form: [] }))
		await expect(api.getParameters()).resolves.toEqual({ user_input_form: [] })
		expect(lastCall().url).toBe('/api/dify/app%201/parameters')
		// A Response body is read once: a stub serving several calls builds a fresh one each time.
		fetchMock.mockImplementation(() => jsonResponse(200, { data: [], has_more: false, limit: 100 }))
		await api.listConversations({ limit: 100, sort_by: '-updated_at' })
		expect(lastCall().url).toBe('/api/dify/app%201/conversations?limit=100&sort_by=-updated_at')
		await api.listMessages({ conversation_id: 'c1', first_id: 'm0', limit: 20 })
		expect(lastCall().url).toBe(
			'/api/dify/app%201/messages?conversation_id=c1&first_id=m0&limit=20',
		)
		await api.listAnnotations({ page: 1, limit: 10, keyword: '' })
		expect(lastCall().url).toBe('/api/dify/app%201/apps/annotations?page=1&limit=10&keyword=')
	})
	it('POSTs JSON bodies, never a user', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { id: 'c1', name: 'Tea' }))
		await api.renameConversation('c1', { name: 'Tea' })
		expect(lastCall().url).toBe('/api/dify/app%201/conversations/c1/name')
		expect(lastCall().init.method).toBe('POST')
		expect(lastCall().headers.get('content-type')).toBe('application/json')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ name: 'Tea' })
		fetchMock.mockImplementation(() => jsonResponse(200, { result: 'success' }))
		await api.createFeedback('m1', { rating: null, content: '' })
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ rating: null, content: '' })
		await api.stopChat('t1')
		expect(lastCall().url).toBe('/api/dify/app%201/chat-messages/t1/stop')
		await api.stopCompletion('t2')
		expect(lastCall().url).toBe('/api/dify/app%201/completion-messages/t2/stop')
		await api.stopWorkflow('t3')
		expect(lastCall().url).toBe('/api/dify/app%201/workflows/tasks/t3/stop')
		fetchMock.mockResolvedValue(jsonResponse(200, {}))
		await expect(
			api.submitHumanInput('tok', { inputs: { a: 'b' }, action: 'approve' }),
		).resolves.toEqual({})
		expect(lastCall().url).toBe('/api/dify/app%201/form/human_input/tok')
	})
	it('DELETEs resolve on 204', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
		await expect(api.deleteConversation('c1')).resolves.toBeUndefined()
		expect(lastCall().init.method).toBe('DELETE')
		await expect(api.deleteAnnotation('a1')).resolves.toBeUndefined()
		expect(lastCall().url).toBe('/api/dify/app%201/apps/annotations/a1')
	})
	it('uploads and transcribes with one file part', async () => {
		fetchMock.mockResolvedValue(jsonResponse(201, { id: 'f1' }))
		await expect(api.uploadFile(new File(['x'], 'a.txt'))).resolves.toEqual({ id: 'f1' })
		expect((lastCall().init.body as FormData).get('file')).toBeInstanceOf(File)
		expect((lastCall().init.body as FormData).has('user')).toBe(false)
		fetchMock.mockResolvedValue(jsonResponse(200, { text: 'hi' }))
		await expect(api.audioToText(new File(['x'], 'speech.webm'))).resolves.toEqual({ text: 'hi' })
		expect(lastCall().url).toBe('/api/dify/app%201/audio-to-text')
	})
	it('hands streams and binaries back as the Response', async () => {
		const stream = jsonResponse(200, {}, 'text/event-stream')
		fetchMock.mockResolvedValue(stream)
		const controller = new AbortController()
		await expect(
			api.runWorkflow({ inputs: {}, response_mode: 'streaming' }, controller.signal),
		).resolves.toBe(stream)
		expect(lastCall().init.signal).toBe(controller.signal)
		await expect(api.completion({ inputs: {}, response_mode: 'streaming' })).resolves.toBe(stream)
		expect(lastCall().url).toBe('/api/dify/app%201/completion-messages')
		const audio = new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } })
		fetchMock.mockResolvedValue(audio)
		await expect(api.textToAudio({ text: 'hi' })).resolves.toBe(audio)
		await expect(api.filePreview('f1', { asAttachment: true })).resolves.toBe(audio)
		expect(lastCall().url).toBe('/api/dify/app%201/files/f1/preview?as_attachment=true')
	})
	it('builds the remote-file, chat and events URLs', () => {
		expect(api.remoteFileUrl('https://dify.example/files/x.png?sign=1')).toBe(
			'/api/dify/app%201/files/remote?url=https%3A%2F%2Fdify.example%2Ffiles%2Fx.png%3Fsign%3D1',
		)
		expect(api.chatMessagesUrl).toBe('/api/dify/app%201/chat-messages')
		// Dify's replay and one stream across pauses, as its own chat opens it (API guide "Human Input Flow", step 5).
		expect(api.workflowEventsUrl('run/1')).toBe(
			'/api/dify/app%201/workflow/run%2F1/events?include_state_snapshot=true&continue_on_pause=true',
		)
	})
})

describe('createDifyApi: errors', () => {
	it("rejects with DifyRequestError carrying Dify's code and message", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(412, { code: 'human_input_form_expired', message: 'Expired.', status: 412 }),
		)
		const error = await api.submitHumanInput('tok', { inputs: {}, action: 'a' }).catch(e => e)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({
			status: 412,
			code: 'human_input_form_expired',
			message: 'Expired.',
		})
	})
	// No English reaches the user: without Dify's text the view shows its own i18n text (charter §4.5).
	it('keeps no message, not the status text, for a body that is not the envelope', async () => {
		fetchMock.mockResolvedValue(new Response('boom', { status: 502, statusText: 'Bad Gateway' }))
		await expect(api.getParameters()).rejects.toMatchObject({
			status: 502,
			code: undefined,
			message: '',
		})
	})
	// Next answers a failure before a route's `try` (a database error) with an empty 500.
	it('keeps no message, not the status text, for an empty body', async () => {
		fetchMock.mockResolvedValue(
			new Response(null, { status: 500, statusText: 'Internal Server Error' }),
		)
		await expect(api.getSite()).rejects.toMatchObject({
			status: 500,
			code: undefined,
			message: '',
		})
	})
	it('rejects every method alike, a stream or binary one included', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(403, { code: 'app_disabled', message: 'Disabled.', status: 403 }),
		)
		await expect(api.runWorkflow({ inputs: {} })).rejects.toMatchObject({
			status: 403,
			code: 'app_disabled',
		})
		await expect(api.filePreview('f1')).rejects.toBeInstanceOf(DifyRequestError)
		await expect(api.deleteConversation('c1')).rejects.toBeInstanceOf(DifyRequestError)
	})
})
