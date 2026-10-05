import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
	annotationError,
	audioAnswerError,
	envelopeError,
	feedbackError,
	humanInputFailureText,
	humanInputSubmitError,
	toDifyError,
} from '@/components/chat/hooks/dify-errors'
import { DifyRequestError } from '@/components/chat/provider/dify-fetch'

// DifyApi resolves an HTTP error with Dify's body instead of rejecting; the hooks report
// { code?, message } where `message` is Dify's text or '' (the view then shows its i18n text).
describe('envelopeError', () => {
	it("reads Dify's error body { code, message, status }", () => {
		const error = envelopeError({
			code: 'not_found',
			message: 'Conversation Not Exists.',
			status: 404,
		})
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({
			code: 'not_found',
			message: 'Conversation Not Exists.',
			status: 404,
		})
	})
	it('leaves the message empty when the body has no Dify text', () => {
		expect(envelopeError({ error: 'App not found' })).toMatchObject({
			code: undefined,
			message: '',
			status: 0,
		})
		expect(envelopeError(undefined)).toMatchObject({ message: '' })
		expect(envelopeError(null, 502)).toMatchObject({ message: '', status: 502 })
	})
})

describe('toDifyError', () => {
	it('passes a DifyRequestError through', () => {
		const error = new DifyRequestError(400, 'invalid_param', 'Bad name')
		expect(toDifyError(error)).toBe(error)
	})
	it('turns any other failure into an empty-message DifyRequestError that keeps the cause', () => {
		const network = new TypeError('Failed to fetch')
		const error = toDifyError(network)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error.message).toBe('')
		expect(error.cause).toBe(network)
	})
})

// The proxy route for POST /form/human_input answers { code: <HTTP status>, data } (createDifyApiResponse):
// Dify's `{}` on success, `{ error: <Dify's error body as text> }` on a Dify error.
describe('humanInputSubmitError', () => {
	it('is undefined for an accepted submission', () => {
		expect(humanInputSubmitError({ code: 200, data: {} })).toBeUndefined()
	})
	it("reads Dify's error body out of the proxy's answer", () => {
		const error = humanInputSubmitError({
			code: 412,
			data: {
				error: JSON.stringify({
					code: 'human_input_form_submitted',
					message: 'This form has already been submitted by another user, form_id=form-1',
					status: 412,
				}),
			},
		})
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({
			status: 412,
			code: 'human_input_form_submitted',
			message: 'This form has already been submitted by another user, form_id=form-1',
		})
	})
	it("leaves the message empty for the proxy's own text, a non-JSON body and other answers", () => {
		expect(humanInputSubmitError({ code: 404, data: { error: 'App not found' } })).toMatchObject({
			status: 404,
			message: '',
		})
		expect(
			humanInputSubmitError({ code: 502, data: { error: '<html>Bad Gateway</html>' } }),
		).toMatchObject({ status: 502, message: '' })
		expect(humanInputSubmitError({ error: 'Unauthorized' })).toMatchObject({ message: '' })
		expect(humanInputSubmitError({ code: 200, data: { error: 'odd' } })).toMatchObject({
			message: '',
		})
		expect(humanInputSubmitError(undefined)).toMatchObject({ message: '' })
	})
})

describe('humanInputFailureText', () => {
	const t = ((key: string, options?: Record<string, unknown>) =>
		options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction
	it("gives Dify's reason for a refused form, or the generic text without one", () => {
		const refused = new DifyRequestError(412, 'human_input_form_expired', 'This form has expired.')
		expect(humanInputFailureText(refused, false, t)).toBe(
			'hitl.submit_failed_reason {"error":"This form has expired."}',
		)
		expect(humanInputFailureText(new TypeError('Failed to fetch'), false, t)).toBe(
			'hitl.submit_failed',
		)
	})
	it('says the answer was sent when only the continuation failed (a resubmit would get 412)', () => {
		// x-sdk's onReload throws `message [id] is not found` for a message the store does not hold.
		expect(humanInputFailureText(new Error('message [m1:a] is not found'), true, t)).toBe(
			'hitl.resume_failed',
		)
	})
})

// The feedback route answers { code: <HTTP status>, data } (createDifyApiResponse): Dify's
// `{ result: 'success' }`, or `{ error, detail }` with Dify's error body as text in `detail`.
describe('feedbackError', () => {
	it('is undefined when Dify took the rating', () => {
		expect(feedbackError({ code: 200, data: { result: 'success' } })).toBeUndefined()
	})
	it("reads Dify's error body out of the route's `detail`", () => {
		const error = feedbackError({
			code: 404,
			data: {
				error: 'Upstream error: 404',
				detail: JSON.stringify({ code: 'not_found', message: 'Message Not Exists.', status: 404 }),
			},
		})
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Message Not Exists.' })
	})
	it("leaves the message empty for a cut or non-JSON detail and the proxy's own answers", () => {
		expect(
			feedbackError({ code: 502, data: { error: 'Upstream error: 502', detail: '<html>' } }),
		).toMatchObject({ status: 502, message: '' })
		expect(feedbackError({ error: 'Unauthorized' })).toMatchObject({ message: '' })
		expect(feedbackError({ code: 404, data: { error: 'App not found' } })).toMatchObject({
			status: 404,
			message: '',
		})
		expect(feedbackError(undefined)).toMatchObject({ message: '' })
	})
})

// The annotations route answers { code: <HTTP status>, data } with Dify's body as `data`: the new
// annotation (`id`, `question`, `answer`, …) or Dify's error body.
describe('annotationError', () => {
	it('is undefined when Dify created the annotation', () => {
		expect(
			annotationError({
				code: 200,
				data: { id: 'an-1', question: 'q', answer: 'a', hit_count: 0 },
			}),
		).toBeUndefined()
	})
	it("reads Dify's error body", () => {
		expect(
			annotationError({
				code: 400,
				data: { code: 'invalid_param', message: 'question is required', status: 400 },
			}),
		).toMatchObject({ status: 400, code: 'invalid_param', message: 'question is required' })
	})
	it("leaves the message empty for the proxy's own answers", () => {
		expect(annotationError({ error: 'Unauthorized' })).toMatchObject({ message: '' })
		expect(annotationError({ code: 404, data: { error: 'App not found' } })).toMatchObject({
			status: 404,
			message: '',
		})
	})
})

// The text-to-speech route passes Dify's answer through (createDifyResponseProxy): audio when it worked,
// Dify's JSON error body (or the proxy's `{ error }`) otherwise.
describe('audioAnswerError', () => {
	it('is undefined for audio', async () => {
		const response = new Response(new Uint8Array([82, 73, 70, 70]), {
			status: 200,
			headers: { 'content-type': 'audio/wav' },
		})
		await expect(audioAnswerError(response)).resolves.toBeUndefined()
	})
	it("reads Dify's error body", async () => {
		const response = Response.json(
			{ code: 'provider_not_initialize', message: 'No valid model provider.', status: 400 },
			{ status: 400 },
		)
		await expect(audioAnswerError(response)).resolves.toMatchObject({
			status: 400,
			code: 'provider_not_initialize',
			message: 'No valid model provider.',
		})
	})
	it("leaves the message empty for the proxy's own answers and unreadable bodies", async () => {
		await expect(
			audioAnswerError(Response.json({ error: 'Unauthorized' }, { status: 401 })),
		).resolves.toMatchObject({ status: 401, message: '' })
		await expect(audioAnswerError(new Response('<html>', { status: 502 }))).resolves.toMatchObject({
			status: 502,
			message: '',
		})
		// A JSON answer is never audio, whatever its status.
		await expect(audioAnswerError(Response.json({}, { status: 200 }))).resolves.toMatchObject({
			message: '',
		})
	})
})
