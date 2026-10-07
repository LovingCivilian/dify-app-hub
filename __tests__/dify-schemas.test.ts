import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import {
	annotationBody,
	annotationsQuery,
	chatMessagesBody,
	completionBody,
	conversationsQuery,
	feedbackBody,
	filePreviewQuery,
	humanInputBody,
	messagesQuery,
	parseFilePart,
	parseJsonBody,
	parseQuery,
	renameConversationBody,
	textToAudioBody,
	workflowEventsQuery,
	workflowRunBody,
} from '@/lib/dify/schemas'

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const jsonRequest = (body: unknown) =>
	new Request('http://app/x', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
const query = (text: string) => new URLSearchParams(text)

describe('parseJsonBody with chatMessagesBody', () => {
	it('keeps the documented fields and strips the rest (user, trace ids, workflow_id)', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({
				query: 'hi',
				inputs: { a: 1 },
				response_mode: 'streaming',
				user: 'evil',
				trace_id: 'x',
				workflow_id: UUID,
				auto_generate_name: false,
			}),
			chatMessagesBody,
		)
		expect(parsed).toEqual({
			ok: true,
			data: {
				query: 'hi',
				inputs: { a: 1 },
				response_mode: 'streaming',
				auto_generate_name: false,
			},
		})
	})
	it('accepts files in both transfer methods and an empty conversation_id', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({
				query: 'q',
				inputs: {},
				conversation_id: '',
				files: [
					{ type: 'document', transfer_method: 'local_file', upload_file_id: UUID },
					{ type: 'image', transfer_method: 'remote_url', url: 'https://x.example/a.png' },
				],
			}),
			chatMessagesBody,
		)
		expect(parsed.ok).toBe(true)
	})
	it('answers 400 invalid_param naming the fields for a bad body', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({ inputs: 'nope', files: [{ type: 'pdf' }] }),
			chatMessagesBody,
		)
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.response.status).toBe(400)
		const body = await parsed.response.json()
		expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
		expect(body.message).toContain('query')
		expect(body.message).toContain('inputs')
		expect(body.message).toContain('files')
	})
	it('answers 400 invalid_param for a body that is not JSON', async () => {
		const parsed = await parseJsonBody(
			new Request('http://app/x', { method: 'POST', body: '{nope' }),
			chatMessagesBody,
		)
		expect(parsed.ok).toBe(false)
		if (!parsed.ok)
			await expect(parsed.response.json()).resolves.toMatchObject({ code: 'invalid_param' })
	})
})

// Review Focus 3
describe('query schemas', () => {
	it('messagesQuery needs a UUID conversation_id and bounds limit to 1..100', () => {
		expect(parseQuery(query(`conversation_id=${UUID}&limit=20`), messagesQuery)).toEqual({
			ok: true,
			data: { conversation_id: UUID, limit: 20 },
		})
		expect(parseQuery(query(`conversation_id=${UUID}`), messagesQuery).ok).toBe(true)
		expect(parseQuery(query('conversation_id=abc'), messagesQuery).ok).toBe(false)
		expect(parseQuery(query(`conversation_id=${UUID}&limit=0`), messagesQuery).ok).toBe(false)
		expect(parseQuery(query(`conversation_id=${UUID}&limit=101`), messagesQuery).ok).toBe(false)
		expect(parseQuery(query(`conversation_id=${UUID}&first_id=nope`), messagesQuery).ok).toBe(false)
	})
	it('conversationsQuery takes the four sort orders only, and names the parameter', async () => {
		expect(parseQuery(query('limit=100&sort_by=-updated_at'), conversationsQuery).ok).toBe(true)
		const bad = parseQuery(query('sort_by=name'), conversationsQuery)
		expect(bad.ok).toBe(false)
		if (!bad.ok) expect((await bad.response.json()).message).toContain('sort_by')
	})
	it('workflowEventsQuery turns the flags into booleans', () => {
		expect(parseQuery(query('continue_on_pause=true'), workflowEventsQuery)).toEqual({
			ok: true,
			data: { continue_on_pause: true },
		})
		expect(parseQuery(query('include_state_snapshot=yes'), workflowEventsQuery).ok).toBe(false)
	})
	it('annotationsQuery: page ≥ 1, limit 1..100, keyword free text', () => {
		expect(parseQuery(query('page=2&limit=10&keyword=tea'), annotationsQuery)).toEqual({
			ok: true,
			data: { page: 2, limit: 10, keyword: 'tea' },
		})
		expect(parseQuery(query('page=0'), annotationsQuery).ok).toBe(false)
	})
	it('filePreviewQuery takes true or false for as_attachment, nothing else', () => {
		expect(parseQuery(query('as_attachment=true'), filePreviewQuery)).toEqual({
			ok: true,
			data: { as_attachment: true },
		})
		expect(parseQuery(query(''), filePreviewQuery)).toEqual({ ok: true, data: {} })
		expect(parseQuery(query('as_attachment=yes'), filePreviewQuery).ok).toBe(false)
	})
})

describe('body schemas', () => {
	it('renameConversationBody needs a name or auto_generate', async () => {
		expect(await parseJsonBody(jsonRequest({ name: ' Tea ' }), renameConversationBody)).toEqual({
			ok: true,
			data: { name: 'Tea' },
		})
		expect(
			(await parseJsonBody(jsonRequest({ auto_generate: true }), renameConversationBody)).ok,
		).toBe(true)
		expect((await parseJsonBody(jsonRequest({}), renameConversationBody)).ok).toBe(false)
		expect((await parseJsonBody(jsonRequest({ name: '   ' }), renameConversationBody)).ok).toBe(
			false,
		)
	})
	it('feedbackBody takes like, dislike or null', async () => {
		expect((await parseJsonBody(jsonRequest({ rating: null, content: '' }), feedbackBody)).ok).toBe(
			true,
		)
		expect((await parseJsonBody(jsonRequest({ rating: 'meh' }), feedbackBody)).ok).toBe(false)
	})
	it('humanInputBody takes strings and file mappings, and strips user', async () => {
		const parsed = await parseJsonBody(
			jsonRequest({
				inputs: {
					feedback: 'ok',
					doc: { transfer_method: 'local_file', upload_file_id: UUID, type: 'document' },
					docs: [],
				},
				action: 'approve',
				user: 'evil',
			}),
			humanInputBody,
		)
		expect(parsed).toEqual({
			ok: true,
			data: {
				inputs: {
					feedback: 'ok',
					doc: { transfer_method: 'local_file', upload_file_id: UUID, type: 'document' },
					docs: [],
				},
				action: 'approve',
			},
		})
		expect((await parseJsonBody(jsonRequest({ inputs: {}, action: '' }), humanInputBody)).ok).toBe(
			false,
		)
	})
	it('strips user and the tracing fields from every other body', async () => {
		const smuggled = { user: 'evil', trace_id: 'x', trace_session_id: 'y' }
		const cases = [
			[feedbackBody, { rating: 'like' }],
			[completionBody, { inputs: {} }],
			[workflowRunBody, { inputs: {} }],
			[annotationBody, { question: 'q', answer: 'a' }],
			[textToAudioBody, { text: 'hello' }],
		] as const
		for (const [schema, body] of cases) {
			expect(await parseJsonBody(jsonRequest({ ...body, ...smuggled }), schema)).toEqual({
				ok: true,
				data: body,
			})
		}
	})
	it('textToAudioBody needs message_id or text', async () => {
		expect((await parseJsonBody(jsonRequest({ text: 'hello' }), textToAudioBody)).ok).toBe(true)
		expect((await parseJsonBody(jsonRequest({ message_id: UUID }), textToAudioBody)).ok).toBe(true)
		expect((await parseJsonBody(jsonRequest({ voice: 'x' }), textToAudioBody)).ok).toBe(false)
	})
})

// Review Focus 2
describe('parseFilePart', () => {
	const multipart = (parts: Array<[string, File | string]>) => {
		const form = new FormData()
		for (const [name, value] of parts) form.append(name, value)
		return new Request('http://app/x', { method: 'POST', body: form })
	}
	it('returns the one file part', async () => {
		const parsed = await parseFilePart(
			multipart([
				['file', new File(['x'], 'a.txt', { type: 'text/plain' })],
				['user', 'evil'],
			]),
		)
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	// FormData cannot build these (it names a Blob "blob"), so the body is written out with a fixed boundary.
	const rawMultipart = (disposition: string) =>
		new Request('http://app/x', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=testboundary' },
			body: [
				'--testboundary',
				`Content-Disposition: ${disposition}`,
				'',
				'content',
				'--testboundary--',
				'',
			].join('\r\n'),
		})
	it.each([
		['a part without a filename attribute', 'form-data; name="file"'],
		['a part with an empty filename', 'form-data; name="file"; filename=""'],
	])('refuses %s with 400 invalid_param naming the file part', async (_label, disposition) => {
		const parsed = await parseFilePart(rawMultipart(disposition))
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.response.status).toBe(400)
		const body = await parsed.response.json()
		expect(body).toMatchObject({ code: 'invalid_param', status: 400 })
		expect(body.message).toContain('file part named file')
	})
	it('accepts the same raw body when the part carries a filename (the helper builds a valid request)', async () => {
		const parsed = await parseFilePart(rawMultipart('form-data; name="file"; filename="a.txt"'))
		expect(parsed.ok).toBe(true)
		if (parsed.ok) expect(parsed.data.name).toBe('a.txt')
	})
	it('refuses no file part, an empty file, a second file part, or a non-multipart body', async () => {
		for (const request of [
			multipart([['user', 'x']]),
			multipart([['file', new File([], 'empty.txt')]]),
			multipart([
				['file', new File(['a'], 'a.txt')],
				['file', new File(['b'], 'b.txt')],
			]),
			new Request('http://app/x', { method: 'POST', body: 'plain' }),
		]) {
			const parsed = await parseFilePart(request)
			expect(parsed.ok).toBe(false)
			if (!parsed.ok) {
				expect(parsed.response.status).toBe(400)
				await expect(parsed.response.json()).resolves.toMatchObject({ code: 'invalid_param' })
			}
		}
	})
})
