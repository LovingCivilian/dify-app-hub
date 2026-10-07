import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { DifyError } from '@/lib/dify/errors'
import { difyClient, passthrough } from '@/lib/dify/client'

const credentials = { apiBase: 'http://dify.local/v1/', apiKey: 'app-key' }
const USER = 'jane@example.com'
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	})

let fetchMock: ReturnType<typeof vi.fn>
// A fresh Response per call: a body can be read once, and a test calls several operations on one stub.
const reply = (make: () => Response) => fetchMock.mockImplementation(async () => make())
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
	return { url, init, headers: new Headers(init?.headers) }
}

describe('difyClient: addressing and authentication', () => {
	it('trims the base slash, appends the path and sends the bearer header', async () => {
		reply(() => jsonResponse(200, { name: 'A', mode: 'chat', description: '', tags: [] }))
		await expect(difyClient(credentials).getInfo()).resolves.toMatchObject({ name: 'A' })
		const { url, headers } = lastCall()
		expect(url).toBe('http://dify.local/v1/info')
		expect(headers.get('authorization')).toBe('Bearer app-key')
	})
})

describe('difyClient: where `user` goes (endpoint map §1, the `user` column)', () => {
	it('JSON body: chat, stops, feedback, rename, delete, human input, text-to-audio', async () => {
		const client = difyClient(credentials)
		reply(() => jsonResponse(200, {}, { 'content-type': 'text/event-stream' }))
		await client.chatMessages({ query: 'hi', inputs: {}, response_mode: 'streaming' }, USER)
		expect(JSON.parse(String(lastCall().init.body))).toEqual({
			query: 'hi',
			inputs: {},
			response_mode: 'streaming',
			user: USER,
		})
		expect(lastCall().headers.get('content-type')).toBe('application/json')

		reply(() => jsonResponse(200, { result: 'success' }))
		await client.stopChat('task-1', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/chat-messages/task-1/stop')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ user: USER })
		await client.stopCompletion('task-2', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/completion-messages/task-2/stop')
		await client.stopWorkflow('task-3', USER)
		expect(lastCall().url).toBe('http://dify.local/v1/workflows/tasks/task-3/stop')
		await client.createFeedback('m1', { rating: 'like', content: '' }, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/messages/m1/feedbacks')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({
			rating: 'like',
			content: '',
			user: USER,
		})

		reply(() => jsonResponse(200, { id: 'c1', name: 'New' }))
		await client.renameConversation('c1', { auto_generate: true }, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/conversations/c1/name')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ auto_generate: true, user: USER })

		reply(() => new Response(null, { status: 204 }))
		await expect(client.deleteConversation('c1', USER)).resolves.toBeUndefined()
		expect(lastCall().init.method).toBe('DELETE')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ user: USER })

		reply(() => jsonResponse(200, {}))
		await expect(
			client.submitHumanInput('tok', { inputs: { feedback: 'ok' }, action: 'approve' }, USER),
		).resolves.toEqual({})
		expect(lastCall().url).toBe('http://dify.local/v1/form/human_input/tok')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({
			inputs: { feedback: 'ok' },
			action: 'approve',
			user: USER,
		})

		reply(
			() =>
				new Response(new Uint8Array([1]), {
					status: 200,
					headers: { 'content-type': 'audio/wav' },
				}),
		)
		await client.textToAudio({ text: 'hello' }, USER)
		expect(lastCall().url).toBe('http://dify.local/v1/text-to-audio')
		expect(JSON.parse(String(lastCall().init.body))).toEqual({ text: 'hello', user: USER })
	})

	it('query string: messages, suggested, conversations, workflow events, file preview', async () => {
		const client = difyClient(credentials)
		reply(() => jsonResponse(200, { data: [], has_more: false, limit: 20 }))
		await client.listMessages({ conversation_id: 'c1', first_id: 'm0', limit: 20 }, USER)
		expect(lastCall().url).toBe(
			'http://dify.local/v1/messages?conversation_id=c1&first_id=m0&limit=20&user=jane%40example.com',
		)
		expect(lastCall().init.method ?? 'GET').toBe('GET')
		await client.listConversations({ limit: 100, sort_by: '-updated_at' }, USER)
		expect(lastCall().url).toBe(
			'http://dify.local/v1/conversations?limit=100&sort_by=-updated_at&user=jane%40example.com',
		)
		reply(() => jsonResponse(200, { result: 'success', data: ['a'] }))
		await client.getSuggested('m1', USER)
		expect(lastCall().url).toBe(
			'http://dify.local/v1/messages/m1/suggested?user=jane%40example.com',
		)
		reply(() => jsonResponse(200, {}, { 'content-type': 'text/event-stream' }))
		await client.workflowEvents('run-1', USER, {})
		expect(lastCall().url).toBe(
			'http://dify.local/v1/workflow/run-1/events?user=jane%40example.com',
		)
		reply(
			() =>
				new Response(new Uint8Array([1]), {
					status: 200,
					headers: { 'content-type': 'image/png' },
				}),
		)
		await client.filePreview('f1', true, USER)
		expect(lastCall().url).toBe(
			'http://dify.local/v1/files/f1/preview?as_attachment=true&user=jane%40example.com',
		)
	})

	it('multipart: upload and audio-to-text carry `file` and `user` parts', async () => {
		const client = difyClient(credentials)
		reply(() => jsonResponse(201, { id: 'f1', name: 'a.txt' }))
		const file = new File(['hello'], 'a.txt', { type: 'text/plain' })
		await expect(client.uploadFile(file, USER)).resolves.toMatchObject({ id: 'f1' })
		const form = lastCall().init.body as FormData
		expect(form).toBeInstanceOf(FormData)
		expect((form.get('file') as File).name).toBe('a.txt')
		expect(form.get('user')).toBe(USER)
		expect(lastCall().headers.get('content-type')).toBeNull()
		reply(() => jsonResponse(200, { text: 'hi' }))
		await expect(
			client.audioToText(new File(['x'], 'speech.webm', { type: 'audio/webm' }), USER),
		).resolves.toEqual({ text: 'hi' })
		expect(lastCall().url).toBe('http://dify.local/v1/audio-to-text')
	})

	it('no user: info, parameters, site, meta, human-input form, annotations', async () => {
		const client = difyClient(credentials)
		reply(() => jsonResponse(200, { user_input_form: [] }))
		await client.getParameters()
		expect(lastCall().url).toBe('http://dify.local/v1/parameters')
		reply(() =>
			jsonResponse(200, {
				form_content: '',
				inputs: [],
				user_actions: [],
				resolved_default_values: {},
				expiration_time: 0,
			}),
		)
		await client.getHumanInputForm('tok')
		expect(lastCall().url).toBe('http://dify.local/v1/form/human_input/tok')
		reply(() => jsonResponse(200, { data: [], has_more: false, limit: 10, total: 0, page: 1 }))
		await client.listAnnotations({ page: 2, limit: 10, keyword: 'tea' })
		expect(lastCall().url).toBe('http://dify.local/v1/apps/annotations?page=2&limit=10&keyword=tea')
		reply(() => jsonResponse(201, { id: 'a1' }))
		await client.createAnnotation({ question: 'q', answer: 'a' })
		expect(lastCall().init.method).toBe('POST')
		await client.updateAnnotation('a1', { question: 'q', answer: 'b' })
		expect(lastCall().url).toBe('http://dify.local/v1/apps/annotations/a1')
		expect(lastCall().init.method).toBe('PUT')
		reply(() => new Response(null, { status: 204 }))
		await expect(client.deleteAnnotation('a1')).resolves.toBeUndefined()
	})
})

describe('difyClient: errors', () => {
	it("rejects with Dify's envelope on a non-OK answer", async () => {
		reply(() =>
			jsonResponse(404, { code: 'not_found', message: 'Conversation Not Exists.', status: 404 }),
		)
		const error = await difyClient(credentials)
			.listMessages({ conversation_id: 'x' }, USER)
			.catch(e => e)
		expect(error).toBeInstanceOf(DifyError)
		expect(error).toMatchObject({
			status: 404,
			code: 'not_found',
			message: 'Conversation Not Exists.',
		})
	})
	// Review Focus 1
	it('rejects with upstream_error when an OK answer is not JSON on a JSON operation', async () => {
		reply(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
		await expect(difyClient(credentials).getInfo()).rejects.toMatchObject({
			status: 200,
			code: 'upstream_error',
		})
	})

	describe('when fetch fails', () => {
		let errorSpy: ReturnType<typeof vi.spyOn>
		beforeEach(() => {
			errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		})
		afterEach(() => {
			errorSpy.mockRestore()
		})

		it('rejects with upstream_unreachable (502) when fetch fails', async () => {
			fetchMock.mockRejectedValue(new TypeError('fetch failed'))
			await expect(difyClient(credentials).getInfo()).rejects.toMatchObject({
				status: 502,
				code: 'upstream_unreachable',
			})
		})
		// Controller ruling: the message goes to the browser through errorResponseFrom, so it is fixed and
		// carries neither the Dify host nor the end user's email; the cause is logged on the server.
		it('answers a fixed message that leaks neither the Dify host nor the user, and logs the cause', async () => {
			const cause = new TypeError(
				'Failed to parse URL from http://dify.internal:5001/v1/info?user=a@b.c',
			)
			fetchMock.mockRejectedValue(cause)
			const error = await difyClient(credentials)
				.getInfo()
				.catch(e => e)
			expect(error).toBeInstanceOf(DifyError)
			expect(error.message).toBe('Dify is unreachable.')
			expect(error.message).not.toContain('dify.internal')
			expect(error.message).not.toContain('a@b.c')
			expect(errorSpy).toHaveBeenCalledWith('Dify request failed:', cause)
		})
	})

	it('passes a stream through with its status and meaningful headers only', async () => {
		const upstream = new Response('data: {}\n\n', {
			status: 200,
			headers: { 'content-type': 'text/event-stream', 'x-version': '1.17.1', 'set-cookie': 'a=b' },
		})
		const out = passthrough(upstream)
		expect(out.status).toBe(200)
		expect(out.headers.get('content-type')).toBe('text/event-stream')
		expect(out.headers.get('x-version')).toBeNull()
		expect(out.headers.get('set-cookie')).toBeNull()
		await expect(out.text()).resolves.toBe('data: {}\n\n')
	})
	it('fetches a remote file on the given URL with the bearer', async () => {
		reply(
			() =>
				new Response(new Uint8Array([1]), {
					status: 200,
					headers: { 'content-type': 'image/png', 'content-length': '1' },
				}),
		)
		const response = await difyClient(credentials).fetchRemoteFile(
			new URL('http://dify.local/files/tools/x.png?sign=1'),
		)
		expect(lastCall().url).toBe('http://dify.local/files/tools/x.png?sign=1')
		expect(lastCall().headers.get('authorization')).toBe('Bearer app-key')
		expect(response.headers.get('content-type')).toBe('image/png')
	})
})
