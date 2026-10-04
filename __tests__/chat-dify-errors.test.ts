import { describe, expect, it } from 'vitest'

import { envelopeError, toDifyError } from '@/components/chat/hooks/dify-errors'
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
