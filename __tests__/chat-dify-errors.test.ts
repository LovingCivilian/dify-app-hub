import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import {
	ContinuationLostError,
	failureText,
	FormNotWaitingError,
	humanInputFailureText,
	toDifyError,
} from '@/components/chat/hooks/dify-errors'
import { RequestError } from '@/components/chat/provider/dify-fetch'

const t = ((key: string, options?: Record<string, unknown>) =>
	options?.error ? `${key}:${String(options.error)}` : key) as unknown as TFunction

describe('toDifyError', () => {
	it('passes a RequestError through', () => {
		const error = new RequestError(412, 'human_input_form_expired', 'Expired.')
		expect(toDifyError(error)).toBe(error)
	})
	it('turns any other failure into an empty-message RequestError that keeps the cause', () => {
		const cause = new TypeError('fetch failed')
		const error = toDifyError(cause)
		expect(error).toBeInstanceOf(RequestError)
		expect(error).toMatchObject({ status: 0, code: undefined, message: '' })
		expect(error.cause).toBe(cause)
	})
})

describe('failureText', () => {
	// The app's own refusals (charter §4.5) carry English messages; the user sees the translated key.
	it.each([
		['unauthorized', 401, 'chat.error_unauthorized'],
		['app_not_found', 404, 'chat.error_app_not_found'],
		['app_disabled', 403, 'chat.error_app_disabled'],
		['upstream_error', 502, 'chat.error_upstream_error'],
		['upstream_unreachable', 502, 'chat.error_upstream_unreachable'],
	])('gives the key of the app code %s, not its message', (code, status, key) => {
		expect(failureText(new RequestError(status, code, 'English text.'), t, 'generic')).toBe(key)
	})
	it("keeps Dify's own message for Dify's own code (ADR-0017)", () => {
		const error = new RequestError(415, 'unsupported_file_type', 'File type not allowed.')
		expect(failureText(error, t, 'generic')).toBe('File type not allowed.')
	})
	// Dify refuses a missing or bad field with the same code (endpoint map: legend, §4); the route passes it through.
	it("keeps Dify's message for invalid_param", () => {
		const error = new RequestError(400, 'invalid_param', 'topic is not valid.')
		expect(failureText(error, t, 'generic')).toBe('topic is not valid.')
	})
	it('gives the fallback for internal_error, an empty message or a failure that is not an answer', () => {
		expect(
			failureText(new RequestError(500, 'internal_error', 'Internal Server Error'), t, 'generic'),
		).toBe('generic')
		expect(failureText(new RequestError(502, undefined, ''), t, 'generic')).toBe('generic')
		expect(failureText(new TypeError('fetch failed'), t, 'generic')).toBe('generic')
	})
	it('maps forbidden and icon_not_found to their keys (B2)', () => {
		expect(failureText(new RequestError(403, 'forbidden', 'Not allowed.'), t)).toBe(
			'chat.error_forbidden',
		)
		expect(failureText(new RequestError(404, 'icon_not_found', 'x'), t)).toBe(
			'chat.error_icon_not_found',
		)
	})
	it('gives an empty text without a fallback', () => {
		expect(failureText(new RequestError(500, 'internal_error', 'x'), t)).toBe('')
	})
})

describe('humanInputFailureText', () => {
	it("gives Dify's reason for a refused form, or the generic text without one", () => {
		expect(humanInputFailureText(new RequestError(400, 'x', 'Invalid.'), t)).toBe(
			'hitl.submit_failed_reason:Invalid.',
		)
		expect(humanInputFailureText(new TypeError('net'), t)).toBe('hitl.submit_failed')
	})
	it("gives the app's own refusal as the translated reason", () => {
		expect(
			humanInputFailureText(new RequestError(403, 'app_disabled', 'This app is disabled.'), t),
		).toBe('hitl.submit_failed_reason:chat.error_app_disabled')
	})
	it('says the run no longer waits when the stream found no pause to answer', () => {
		expect(humanInputFailureText(new FormNotWaitingError(), t)).toBe('hitl.not_waiting')
	})
	it('says the answer was sent when its continuation cannot be shown here', () => {
		expect(humanInputFailureText(new ContinuationLostError(), t)).toBe('hitl.resume_failed')
	})
	it("says nothing for the user's own stop", () => {
		const stopped = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
		expect(humanInputFailureText(stopped, t)).toBe('')
	})
})
