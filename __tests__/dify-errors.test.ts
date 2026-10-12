import { describe, expect, it, vi } from 'vitest'

import { DifyError, difyErrorFromResponse } from '@/lib/dify/errors'
import { ProviderError } from '@/lib/http/errors'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Part 1 spec §11: errorResponseFrom and toActionFailure answer a DifyError as the ProviderError it is.
describe('DifyError', () => {
	it('is a ProviderError named DifyError', () => {
		const error = new DifyError(401, 'unauthorized', 'bad key')
		expect(error).toBeInstanceOf(ProviderError)
		expect(error).toMatchObject({ name: 'DifyError', status: 401, code: 'unauthorized' })
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
