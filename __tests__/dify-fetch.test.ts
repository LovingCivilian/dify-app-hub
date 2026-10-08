import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDifyFetch, DifyRequestError } from '@/components/chat/provider/dify-fetch'

const APP = 'app-1'
const jsonResponse = (status: number, body: unknown, type = 'application/json') =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })

describe('createDifyFetch', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('posts chat requests to the chat-messages route with the body and the abort signal', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}, 'text/event-stream'))
		vi.stubGlobal('fetch', fetchMock)
		const controller = new AbortController()
		const body = JSON.stringify({ query: 'hi', inputs: {}, files: [], response_mode: 'streaming' })
		await createDifyFetch(APP)('ignored', { body, signal: controller.signal } as never)
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/dify/${APP}/chat-messages`,
			expect.objectContaining({
				method: 'POST',
				body,
				signal: controller.signal,
				headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
			}),
		)
	})

	it('routes a resume request to the workflow events route as a GET without the resume payload', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}, 'text/event-stream'))
		vi.stubGlobal('fetch', fetchMock)
		const body = JSON.stringify({
			resume: { workflowRunId: 'run-9', message: { role: 'assistant', content: 'x', ids: {} } },
		})
		await createDifyFetch(APP)('ignored', { body } as never)
		// Opened before the form is answered: Dify's replay of the run, and one stream across its pauses.
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/dify/${APP}/workflow/run-9/events?include_state_snapshot=true&continue_on_pause=true`,
			expect.objectContaining({ method: 'GET' }),
		)
		expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body')
	})

	it('throws a DifyRequestError carrying Dify code, message and status on a non-OK response', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					jsonResponse(400, { code: 'invalid_param', message: 'query is required', status: 400 }),
				),
		)
		const error = await createDifyFetch(APP)('ignored', { body: '{}' } as never).catch(e => e)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({
			name: 'DifyRequestError',
			status: 400,
			code: 'invalid_param',
			message: 'query is required',
		})
	})

	it('keeps no message, not the status text, when the error body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('boom', { status: 502, statusText: 'Bad Gateway' })),
		)
		const error = await createDifyFetch(APP)('ignored', { body: '{}' } as never).catch(e => e)
		expect(error).toMatchObject({ status: 502, message: '' })
	})

	it('keeps no message, not the status text, when the body is not the envelope', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response('{"error":"x"}', {
					status: 404,
					statusText: 'Not Found',
					headers: { 'content-type': 'application/json' },
				}),
			),
		)
		const error = await createDifyFetch(APP)('ignored', { body: '{}' } as never).catch(e => e)
		expect(error).toMatchObject({ status: 404, code: undefined, message: '' })
	})

	it('returns the response untouched when it is OK', async () => {
		const response = jsonResponse(200, {}, 'text/event-stream')
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
		await expect(createDifyFetch(APP)('ignored', { body: '{}' } as never)).resolves.toBe(response)
	})
})
