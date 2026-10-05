import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
	envelopeError,
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
