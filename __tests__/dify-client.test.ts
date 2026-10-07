import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import { DifyError } from '@/lib/dify/errors'
import { difyClient, filePassthrough, passthrough, type DifyClient } from '@/lib/dify/client'
import type { ChatMessageRequest, MessagesQuery, WorkflowEventsQuery } from '@/lib/dify/types'

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

	it('the session user wins over a `user` the caller supplied, in the body and in the query', async () => {
		const client = difyClient(credentials)
		reply(() => jsonResponse(200, {}, { 'content-type': 'text/event-stream' }))
		await client.chatMessages({ query: 'hi', inputs: {}, user: 'x' } as ChatMessageRequest, USER)
		expect(JSON.parse(String(lastCall().init.body)).user).toBe(USER)
		await client.workflowEvents('run-1', USER, { user: 'x' } as WorkflowEventsQuery)
		expect(new URL(lastCall().url).searchParams.getAll('user')).toEqual([USER])
		reply(() => jsonResponse(200, { data: [], has_more: false, limit: 20 }))
		await client.listMessages({ conversation_id: 'c1', user: 'x' } as MessagesQuery, USER)
		expect(new URL(lastCall().url).searchParams.getAll('user')).toEqual([USER])
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
	// Review Focus 1: a 2xx must never leave the route as a 2xx envelope, so every unreadable OK answer is a 502.
	describe('an OK answer that is not JSON on a JSON operation', () => {
		const unreadable: Array<[string, () => Response]> = [
			[
				'an HTML page',
				() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
			],
			['an empty body', () => new Response('', { status: 200 })],
			[
				'truncated JSON',
				() =>
					new Response('{"data": [{"id"', {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
			],
			[
				'a body that fails while it is read',
				() =>
					new Response(
						new ReadableStream({
							start: controller => controller.error(new Error('terminated')),
						}),
						{ status: 200 },
					),
			],
		]
		it.each(unreadable)('%s: 502 upstream_error with a fixed message', async (_name, make) => {
			reply(make)
			const error = await difyClient(credentials)
				.getInfo()
				.catch(e => e)
			expect(error).toBeInstanceOf(DifyError)
			expect(error).toMatchObject({
				status: 502,
				code: 'upstream_error',
				message: 'Dify answered 200 with an unreadable body.',
			})
		})
		it("keeps Dify's own status on a non-OK answer that is not its envelope (a proxy's HTML 502)", async () => {
			reply(
				() =>
					new Response('<html>Bad Gateway</html>', {
						status: 502,
						headers: { 'content-type': 'text/html' },
					}),
			)
			await expect(difyClient(credentials).getInfo()).rejects.toMatchObject({
				status: 502,
				code: 'upstream_error',
			})
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
	it('keeps exactly the four charter headers of a file answer', async () => {
		const upstream = new Response(new Uint8Array([1, 2, 3]), {
			status: 200,
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': "attachment; filename*=UTF-8''a.txt",
				'content-length': '3',
				'accept-ranges': 'bytes',
				'cache-control': 'public, max-age=3600',
			},
		})
		const out = passthrough(upstream)
		expect(Object.fromEntries(out.headers)).toEqual({
			'content-type': 'application/octet-stream',
			'content-disposition': "attachment; filename*=UTF-8''a.txt",
			'content-length': '3',
			'accept-ranges': 'bytes',
		})
		expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
	})
	// Node's fetch decodes a gzip/br body but keeps the upstream headers, so the length no longer fits the body.
	it('drops content-length when the upstream body was content-encoded', () => {
		const encoded = new Response(new Uint8Array(5000), {
			status: 200,
			headers: {
				'content-type': 'image/png',
				'content-encoding': 'gzip',
				'content-length': '40',
			},
		})
		const out = passthrough(encoded)
		expect(out.headers.get('content-length')).toBeNull()
		expect(out.headers.get('content-encoding')).toBeNull()
		expect(out.headers.get('content-type')).toBe('image/png')
	})
	it('keeps content-length when the upstream body was not content-encoded', () => {
		const plain = new Response(new Uint8Array(5000), {
			status: 200,
			headers: { 'content-type': 'image/png', 'content-length': '5000' },
		})
		expect(passthrough(plain).headers.get('content-length')).toBe('5000')
	})
	// The preview route is session-gated: a shared cache must not store one user's file for others.
	it("does not pass on Dify's cache-control", () => {
		const upstream = new Response('x', {
			status: 200,
			headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' },
		})
		expect(passthrough(upstream).headers.get('cache-control')).toBeNull()
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
	// A redirect from a /files/ answer must never make the route serve (or send the key to) another origin.
	it('fetches a remote file with redirects refused', async () => {
		reply(() => new Response(new Uint8Array([1]), { status: 200 }))
		await difyClient(credentials).fetchRemoteFile(new URL('http://dify.local/files/x.png'))
		expect(lastCall().init.redirect).toBe('error')
	})
	it('answers a refused redirect on a remote file as upstream_unreachable', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		// What undici throws for `redirect: 'error'` on a 3xx.
		fetchMock.mockRejectedValue(
			new TypeError('fetch failed', { cause: new Error('unexpected redirect') }),
		)
		await expect(
			difyClient(credentials).fetchRemoteFile(new URL('http://dify.local/files/x.png')),
		).rejects.toMatchObject({ status: 502, code: 'upstream_unreachable' })
		expect(errorSpy).toHaveBeenCalledOnce()
		errorSpy.mockRestore()
	})
})

// Charter §4.6: one case per operation checks the URL, the verb, the bearer header and where `user` lands, plus the
// error mapping and that a stream or binary answer is handed back untouched.
type UserPlace = 'body' | 'query' | 'form' | 'none'
/** json: the typed body; empty: a 204; stream/binary: the upstream Response itself. */
type Result = 'json' | 'empty' | 'stream' | 'binary'
interface OperationCase {
	name: keyof DifyClient
	call: (client: DifyClient) => Promise<unknown>
	method: 'GET' | 'POST' | 'PUT' | 'DELETE'
	url: string
	user: UserPlace
	result: Result
}

const V1 = 'http://dify.local/v1'
const AS_USER = '?user=jane%40example.com'
const file = () => new File(['x'], 'a.txt', { type: 'text/plain' })

const operations: OperationCase[] = [
	{
		name: 'getInfo',
		call: c => c.getInfo(),
		method: 'GET',
		url: `${V1}/info`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'getParameters',
		call: c => c.getParameters(),
		method: 'GET',
		url: `${V1}/parameters`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'getSite',
		call: c => c.getSite(),
		method: 'GET',
		url: `${V1}/site`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'getMeta',
		call: c => c.getMeta(),
		method: 'GET',
		url: `${V1}/meta`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'chatMessages',
		call: c => c.chatMessages({ query: 'hi', inputs: {} }, USER),
		method: 'POST',
		url: `${V1}/chat-messages`,
		user: 'body',
		result: 'stream',
	},
	{
		name: 'stopChat',
		call: c => c.stopChat('t1', USER),
		method: 'POST',
		url: `${V1}/chat-messages/t1/stop`,
		user: 'body',
		result: 'json',
	},
	{
		name: 'listMessages',
		call: c => c.listMessages({ conversation_id: 'c1' }, USER),
		method: 'GET',
		url: `${V1}/messages?conversation_id=c1&user=jane%40example.com`,
		user: 'query',
		result: 'json',
	},
	{
		name: 'getSuggested',
		call: c => c.getSuggested('m1', USER),
		method: 'GET',
		url: `${V1}/messages/m1/suggested${AS_USER}`,
		user: 'query',
		result: 'json',
	},
	{
		name: 'createFeedback',
		call: c => c.createFeedback('m1', { rating: 'like' }, USER),
		method: 'POST',
		url: `${V1}/messages/m1/feedbacks`,
		user: 'body',
		result: 'json',
	},
	{
		name: 'listConversations',
		call: c => c.listConversations({}, USER),
		method: 'GET',
		url: `${V1}/conversations${AS_USER}`,
		user: 'query',
		result: 'json',
	},
	{
		name: 'deleteConversation',
		call: c => c.deleteConversation('c1', USER),
		method: 'DELETE',
		url: `${V1}/conversations/c1`,
		user: 'body',
		result: 'empty',
	},
	{
		name: 'renameConversation',
		call: c => c.renameConversation('c1', { name: 'N' }, USER),
		method: 'POST',
		url: `${V1}/conversations/c1/name`,
		user: 'body',
		result: 'json',
	},
	{
		name: 'completionMessages',
		call: c => c.completionMessages({ inputs: { query: 'hi' } }, USER),
		method: 'POST',
		url: `${V1}/completion-messages`,
		user: 'body',
		result: 'stream',
	},
	{
		name: 'stopCompletion',
		call: c => c.stopCompletion('t2', USER),
		method: 'POST',
		url: `${V1}/completion-messages/t2/stop`,
		user: 'body',
		result: 'json',
	},
	{
		name: 'runWorkflow',
		call: c => c.runWorkflow({ inputs: {} }, USER),
		method: 'POST',
		url: `${V1}/workflows/run`,
		user: 'body',
		result: 'stream',
	},
	{
		name: 'stopWorkflow',
		call: c => c.stopWorkflow('t3', USER),
		method: 'POST',
		url: `${V1}/workflows/tasks/t3/stop`,
		user: 'body',
		result: 'json',
	},
	{
		name: 'workflowEvents',
		call: c => c.workflowEvents('run-1', USER, { include_state_snapshot: true }),
		method: 'GET',
		url: `${V1}/workflow/run-1/events?include_state_snapshot=true&user=jane%40example.com`,
		user: 'query',
		result: 'stream',
	},
	{
		name: 'getHumanInputForm',
		call: c => c.getHumanInputForm('tok'),
		method: 'GET',
		url: `${V1}/form/human_input/tok`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'submitHumanInput',
		call: c => c.submitHumanInput('tok', { inputs: {}, action: 'approve' }, USER),
		method: 'POST',
		url: `${V1}/form/human_input/tok`,
		user: 'body',
		result: 'json',
	},
	{
		name: 'uploadFile',
		call: c => c.uploadFile(file(), USER),
		method: 'POST',
		url: `${V1}/files/upload`,
		user: 'form',
		result: 'json',
	},
	{
		name: 'filePreview',
		call: c => c.filePreview('f1', false, USER),
		method: 'GET',
		url: `${V1}/files/f1/preview${AS_USER}`,
		user: 'query',
		result: 'binary',
	},
	{
		name: 'fetchRemoteFile',
		call: c => c.fetchRemoteFile(new URL('http://dify.local/files/tools/x.png?sign=1')),
		method: 'GET',
		url: 'http://dify.local/files/tools/x.png?sign=1',
		user: 'none',
		result: 'binary',
	},
	{
		name: 'audioToText',
		call: c => c.audioToText(file(), USER),
		method: 'POST',
		url: `${V1}/audio-to-text`,
		user: 'form',
		result: 'json',
	},
	{
		name: 'textToAudio',
		call: c => c.textToAudio({ text: 'hello' }, USER),
		method: 'POST',
		url: `${V1}/text-to-audio`,
		user: 'body',
		result: 'binary',
	},
	{
		name: 'listAnnotations',
		call: c => c.listAnnotations({ page: 1 }),
		method: 'GET',
		url: `${V1}/apps/annotations?page=1`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'createAnnotation',
		call: c => c.createAnnotation({ question: 'q', answer: 'a' }),
		method: 'POST',
		url: `${V1}/apps/annotations`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'updateAnnotation',
		call: c => c.updateAnnotation('a1', { question: 'q', answer: 'b' }),
		method: 'PUT',
		url: `${V1}/apps/annotations/a1`,
		user: 'none',
		result: 'json',
	},
	{
		name: 'deleteAnnotation',
		call: c => c.deleteAnnotation('a1'),
		method: 'DELETE',
		url: `${V1}/apps/annotations/a1`,
		user: 'none',
		result: 'empty',
	},
]

const answers: Record<Result, () => Response> = {
	json: () => jsonResponse(200, { ok: true }),
	empty: () => new Response(null, { status: 204 }),
	stream: () =>
		new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
	binary: () =>
		new Response(new Uint8Array([1, 2, 3]), {
			status: 200,
			headers: { 'content-type': 'image/png' },
		}),
}

describe('difyClient: one case per operation', () => {
	it('covers every method of the client', () => {
		expect(operations.map(o => o.name).sort()).toEqual(Object.keys(difyClient(credentials)).sort())
	})

	describe.each(operations)('$name', operation => {
		const { call, method, url, user, result } = operation
		const run = () => call(difyClient(credentials))

		it(`sends ${method} ${url.replace(V1, '')} with the bearer, \`user\` in the ${user === 'none' ? 'nowhere (no end-user context)' : user}`, async () => {
			reply(answers[result])
			await run()
			expect(fetchMock).toHaveBeenCalledTimes(1)
			const sent = lastCall()
			expect(sent.url).toBe(url)
			expect(sent.init.method ?? 'GET').toBe(method)
			expect(sent.headers.get('authorization')).toBe('Bearer app-key')
			const body = sent.init.body
			if (user === 'body') {
				expect(sent.headers.get('content-type')).toBe('application/json')
				expect(JSON.parse(String(body)).user).toBe(USER)
				expect(new URL(sent.url).searchParams.has('user')).toBe(false)
			} else if (user === 'query') {
				expect(new URL(sent.url).searchParams.get('user')).toBe(USER)
				expect(body).toBeUndefined()
			} else if (user === 'form') {
				expect(body).toBeInstanceOf(FormData)
				expect((body as FormData).get('user')).toBe(USER)
				expect(sent.headers.get('content-type')).toBeNull()
				expect(new URL(sent.url).searchParams.has('user')).toBe(false)
			} else {
				expect(new URL(sent.url).searchParams.has('user')).toBe(false)
				if (typeof body === 'string') expect(JSON.parse(body)).not.toHaveProperty('user')
			}
		})

		if (result === 'json') {
			it('resolves the typed JSON body', async () => {
				reply(answers.json)
				await expect(run()).resolves.toEqual({ ok: true })
			})
			it('answers 502 upstream_error when an OK answer is not JSON', async () => {
				reply(
					() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
				)
				await expect(run()).rejects.toMatchObject({ status: 502, code: 'upstream_error' })
			})
		}
		if (result === 'empty') {
			it('resolves nothing on a 204', async () => {
				reply(answers.empty)
				await expect(run()).resolves.toBeUndefined()
			})
		}
		if (result === 'stream' || result === 'binary') {
			it('hands the upstream Response back untouched, its body unread', async () => {
				const upstream = answers[result]()
				fetchMock.mockResolvedValue(upstream)
				const out = await run()
				expect(out).toBe(upstream)
				expect((out as Response).status).toBe(200)
				expect((out as Response).bodyUsed).toBe(false)
			})
		}

		it("rejects with Dify's envelope on a non-OK answer", async () => {
			reply(() =>
				jsonResponse(400, {
					code: 'invalid_param',
					message: 'Arg user must be provided.',
					status: 400,
				}),
			)
			const error = await run().catch(e => e)
			expect(error).toBeInstanceOf(DifyError)
			expect(error).toMatchObject({
				status: 400,
				code: 'invalid_param',
				message: 'Arg user must be provided.',
			})
		})
		it("answers a proxy's HTML 502 as upstream_error with that status", async () => {
			reply(
				() =>
					new Response('<html>Bad Gateway</html>', {
						status: 502,
						headers: { 'content-type': 'text/html' },
					}),
			)
			await expect(run()).rejects.toMatchObject({ status: 502, code: 'upstream_error' })
		})
	})

	// A route hands a file or audio answer on through passthrough: status, body and the file headers survive.
	it.each([
		['filePreview', (c: DifyClient) => c.filePreview('f1', true, USER)],
		['textToAudio', (c: DifyClient) => c.textToAudio({ text: 'hello' }, USER)],
	] as const)('%s: the file headers survive passthrough', async (_name, call) => {
		reply(
			() =>
				new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					headers: {
						'content-type': 'audio/mpeg',
						'content-disposition': "attachment; filename*=UTF-8''a.mp3",
						'content-length': '3',
						'accept-ranges': 'bytes',
					},
				}),
		)
		const out = passthrough(await call(difyClient(credentials)))
		expect(out.status).toBe(200)
		expect(out.headers.get('content-type')).toBe('audio/mpeg')
		expect(out.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''a.mp3")
		expect(out.headers.get('content-length')).toBe('3')
		expect(out.headers.get('accept-ranges')).toBe('bytes')
		expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
	})
})

// I-2: a file answer is served on the hub's own origin, so a type that can carry script (SVG, XML, HTML) downloads on
// navigation instead of rendering, and nothing is sniffed; an <img> or <audio> still renders it (Content-Disposition
// does not apply to subresources).
describe('filePassthrough', () => {
	const file = (headers: Record<string, string>) =>
		new Response(new Uint8Array([1, 2, 3]), { status: 200, headers })

	it.each([
		'image/svg+xml',
		'application/xml',
		'text/html; charset=utf-8',
		'application/xhtml+xml',
		// A browser extracts the MIME type from a comma list and keeps the last valid one (Fetch Standard), so
		// these render as HTML and SVG; a single media type has no unquoted comma.
		'text/plain; charset=utf-8, text/html',
		'image/png;a=b, image/svg+xml',
	])('%s downloads as an attachment, with nosniff', type => {
		const out = filePassthrough(file({ 'content-type': type }))
		expect(out.headers.get('content-type')).toBe(type)
		expect(out.headers.get('content-disposition')).toBe('attachment')
		expect(out.headers.get('x-content-type-options')).toBe('nosniff')
	})
	it("keeps Dify's filename when it forces the download", () => {
		const inline = filePassthrough(
			file({ 'content-type': 'image/svg+xml', 'content-disposition': 'inline; filename="a.svg"' }),
		)
		expect(inline.headers.get('content-disposition')).toBe('attachment; filename="a.svg"')
		const encoded = filePassthrough(
			file({
				'content-type': 'application/xml',
				'content-disposition': "attachment; filename*=UTF-8''a.xml",
			}),
		)
		expect(encoded.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''a.xml")
	})
	it('downloads an answer without a type', () => {
		const out = filePassthrough(new Response(new Uint8Array([1]), { status: 200, headers: {} }))
		expect(out.headers.get('content-disposition')).toBe('attachment')
	})
	it.each([
		'image/png',
		'image/jpeg',
		'image/gif',
		'image/webp',
		'audio/mpeg',
		'video/mp4',
		'application/pdf',
		'text/plain; charset=utf-8',
		'IMAGE/PNG',
	])('%s stays inline, with nosniff', type => {
		const out = filePassthrough(file({ 'content-type': type }))
		expect(out.headers.get('content-disposition')).toBeNull()
		expect(out.headers.get('x-content-type-options')).toBe('nosniff')
	})
	it("leaves an allowed type's own disposition as Dify sent it", () => {
		const out = filePassthrough(
			file({
				'content-type': 'application/pdf',
				'content-disposition': 'attachment; filename="a.pdf"',
			}),
		)
		expect(out.headers.get('content-disposition')).toBe('attachment; filename="a.pdf"')
	})
	it('keeps the four charter headers, the status and the body, and adds nothing else', async () => {
		const out = filePassthrough(
			file({
				'content-type': 'audio/mpeg',
				'content-disposition': "attachment; filename*=UTF-8''a.mp3",
				'content-length': '3',
				'accept-ranges': 'bytes',
				'cache-control': 'public, max-age=3600',
				'x-version': '1.17.1',
			}),
		)
		expect(out.status).toBe(200)
		expect(Object.fromEntries(out.headers)).toEqual({
			'content-type': 'audio/mpeg',
			'content-disposition': "attachment; filename*=UTF-8''a.mp3",
			'content-length': '3',
			'accept-ranges': 'bytes',
			'x-content-type-options': 'nosniff',
		})
		expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
	})
})
