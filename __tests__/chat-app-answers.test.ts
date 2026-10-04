import { describe, expect, it } from 'vitest'

import { toAppParameters, toSiteSetting } from '@/components/chat/app-answers'
import { DifyRequestError } from '@/components/chat/provider/dify-fetch'
import { DEFAULT_APP_SITE_SETTING } from '@/lib/core'

// DifyApi resolves every answer but a 401 with its JSON body (BaseRequest), so Dify's error bodies arrive
// as values. The documented ones (Dify OpenAPI): GET /parameters 400 `app_unavailable`, GET /site 403
// `forbidden`; the proxy answers `{ error }` when the app is not configured.
describe('toAppParameters', () => {
	it('passes a parameters answer through', () => {
		const parameters = { user_input_form: [], suggested_questions_after_answer: { enabled: false } }
		expect(toAppParameters(parameters)).toBe(parameters)
	})
	it("throws Dify's error body as { status, code, message }", () => {
		const body = {
			code: 'app_unavailable',
			message: 'App unavailable, please check your app configurations.',
			status: 400,
		}
		expect(() => toAppParameters(body)).toThrow(DifyRequestError)
		try {
			toAppParameters(body)
		} catch (error) {
			expect(error).toMatchObject(body)
		}
	})
	it('throws with an empty message for the proxy error and for nothing at all', () => {
		for (const answer of [{ error: 'App not found' }, undefined, null, 'oops']) {
			expect(() => toAppParameters(answer)).toThrow(DifyRequestError)
			try {
				toAppParameters(answer)
			} catch (error) {
				expect((error as DifyRequestError).message).toBe('')
			}
		}
	})
})

describe('toSiteSetting', () => {
	it('passes the site settings through', () => {
		const site = { ...DEFAULT_APP_SITE_SETTING, title: 'Stub app' }
		expect(toSiteSetting(site)).toBe(site)
	})
	it("falls back to the defaults for Dify's error body or a missing answer", () => {
		const forbidden = { code: 'forbidden', message: 'Site not found', status: 403 }
		for (const answer of [forbidden, undefined, null]) {
			expect(toSiteSetting(answer)).toBe(DEFAULT_APP_SITE_SETTING)
		}
	})
})
