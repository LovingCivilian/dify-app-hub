import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { humanInputFailureText, toDifyError } from '@/components/chat/hooks/dify-errors'
import { DifyRequestError } from '@/components/chat/provider/dify-fetch'

const t = ((key: string, options?: Record<string, unknown>) =>
	options?.error ? `${key}:${String(options.error)}` : key) as unknown as TFunction

describe('toDifyError', () => {
	it('passes a DifyRequestError through', () => {
		const error = new DifyRequestError(412, 'human_input_form_expired', 'Expired.')
		expect(toDifyError(error)).toBe(error)
	})
	it('turns any other failure into an empty-message DifyRequestError that keeps the cause', () => {
		const cause = new TypeError('fetch failed')
		const error = toDifyError(cause)
		expect(error).toBeInstanceOf(DifyRequestError)
		expect(error).toMatchObject({ status: 0, code: undefined, message: '' })
		expect(error.cause).toBe(cause)
	})
})

describe('humanInputFailureText', () => {
	it("gives Dify's reason for a refused form, or the generic text without one", () => {
		expect(humanInputFailureText(new DifyRequestError(412, 'x', 'Expired.'), false, t)).toBe(
			'hitl.submit_failed_reason:Expired.',
		)
		expect(humanInputFailureText(new TypeError('net'), false, t)).toBe('hitl.submit_failed')
	})
	it('says the answer was sent when only the continuation failed', () => {
		expect(humanInputFailureText(new Error('x'), true, t)).toBe('hitl.resume_failed')
	})
})
