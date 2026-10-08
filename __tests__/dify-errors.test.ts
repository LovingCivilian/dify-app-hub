import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '@/lib/auth/session'
import {
	DifyError,
	difyErrorFromResponse,
	difyErrorResponse,
	errorResponseFrom,
	forbiddenResponse,
	isDifyErrorBody,
} from '@/lib/dify/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('isDifyErrorBody', () => {
	it('accepts Dify’s envelope and nothing else', () => {
		expect(isDifyErrorBody({ code: 'not_found', message: 'Nope', status: 404 })).toBe(true)
		expect(isDifyErrorBody({ code: 'not_found', message: 'Nope' })).toBe(false)
		expect(isDifyErrorBody({ error: 'x' })).toBe(false)
		expect(isDifyErrorBody('nope')).toBe(false)
		expect(isDifyErrorBody(null)).toBe(false)
	})
})

describe('difyErrorFromResponse', () => {
	it("keeps Dify's code and message, with the HTTP status", async () => {
		const error = await difyErrorFromResponse(
			jsonResponse(412, { code: 'human_input_form_expired', message: 'Expired.', status: 412 }),
		)
		expect(error).toBeInstanceOf(DifyError)
		expect(error).toMatchObject({
			status: 412,
			code: 'human_input_form_expired',
			message: 'Expired.',
		})
	})
	// Review Focus 1: a reverse proxy's HTML page, an empty body, a JSON body that is not the envelope.
	it('maps a non-JSON or non-envelope body to upstream_error with the status', async () => {
		const html = await difyErrorFromResponse(
			new Response('<html>Bad Gateway</html>', {
				status: 502,
				headers: { 'content-type': 'text/html' },
			}),
		)
		expect(html).toMatchObject({
			status: 502,
			code: 'upstream_error',
			message: 'Dify answered 502',
		})
		const empty = await difyErrorFromResponse(new Response(null, { status: 500 }))
		expect(empty).toMatchObject({ status: 500, code: 'upstream_error' })
		const other = await difyErrorFromResponse(jsonResponse(400, { message: 'Just text' }))
		expect(other).toMatchObject({ status: 400, code: 'upstream_error', message: 'Just text' })
	})
})

describe('difyErrorResponse and errorResponseFrom', () => {
	it('answers the envelope with the status', async () => {
		const response = difyErrorResponse('app_not_found', 'No such app.', 404)
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toEqual({
			code: 'app_not_found',
			message: 'No such app.',
			status: 404,
		})
	})
	it('turns a DifyError into its envelope', async () => {
		const response = errorResponseFrom(new DifyError(429, 'too_many_requests', 'Slow down'), 'test')
		expect(response.status).toBe(429)
		await expect(response.json()).resolves.toEqual({
			code: 'too_many_requests',
			message: 'Slow down',
			status: 429,
		})
	})
	it('turns an AuthError into 401 or 403', async () => {
		expect(errorResponseFrom(new AuthError('unauthorized'), 'test').status).toBe(401)
		expect(errorResponseFrom(new AuthError('forbidden'), 'test').status).toBe(403)
	})
	// One definition of the role refusal (charter §4.2): the routes' own check and a thrown AuthError answer alike.
	it("answers an AuthError('forbidden') exactly as forbiddenResponse()", async () => {
		const thrown = errorResponseFrom(new AuthError('forbidden'), 'test')
		const direct = forbiddenResponse()
		expect(thrown.status).toBe(direct.status)
		expect(await thrown.json()).toEqual(await direct.json())
	})
	it('logs anything else and answers 500 internal_error without the message', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const response = errorResponseFrom(new Error('secret detail'), 'POST chat')
		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			code: 'internal_error',
			message: 'Internal Server Error',
			status: 500,
		})
		expect(spy).toHaveBeenCalledWith('POST chat:', expect.any(Error))
		spy.mockRestore()
	})
})
