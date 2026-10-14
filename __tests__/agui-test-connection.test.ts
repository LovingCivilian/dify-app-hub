import { jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))

import { AGUI_TEST_TIMEOUT_MS, testAguiConnection } from '@/lib/providers/agui/test-connection'

const settings = { agentUrl: 'http://agents:8000/agents/assistant', audience: 'assistant' }
const secrets = { jwtSecret: 'an-app-secret-of-at-least-32-chars!' }
const admin = {
	id: 'b6f1c2d4-0000-4000-8000-000000000002',
	source: 'local' as const,
	role: 'admin' as const,
}

/** A body whose cancel is recorded, so a test can see the agent's answer was let go unread (spec §2.4). */
const answer = (status: number, contentType = 'application/json') => {
	const cancel = vi.fn()
	const body = new ReadableStream({ cancel })
	return {
		response: new Response(body, { status, headers: { 'content-type': contentType } }),
		cancel,
	}
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
})

const sent = () => fetchMock.mock.calls[0] as [string, RequestInit]

describe('testAguiConnection (Part 2 spec §2.4)', () => {
	it('POSTs {} to the agent URL with a fresh JWT for the admin as the only auth header', async () => {
		fetchMock.mockResolvedValue(answer(422).response)
		await testAguiConnection(settings, secrets, admin)
		const [url, init] = sent()
		expect(url).toBe(settings.agentUrl)
		expect(init.method).toBe('POST')
		expect(init.body).toBe('{}')
		expect(init.signal).toBeInstanceOf(AbortSignal)
		const headers = init.headers as Record<string, string>
		expect(Object.keys(headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type'])
		expect(headers['Content-Type']).toBe('application/json')
		expect(headers.Accept).toBe('text/event-stream')
		const token = headers.Authorization.replace(/^Bearer /, '')
		const { payload } = await jwtVerify(token, new TextEncoder().encode(secrets.jwtSecret), {
			algorithms: ['HS256'],
			issuer: 'nextjs-bff',
			audience: 'assistant',
		})
		expect(payload).toMatchObject({ sub: admin.id, auth_source: 'local', roles: ['admin'] })
		expect(AGUI_TEST_TIMEOUT_MS).toBe(10_000)
	})
	it.each([
		[422, { ok: true }],
		[400, { ok: true }],
		[401, { ok: false, code: 'key_refused' }],
		[403, { ok: false, code: 'key_refused' }],
		[404, { ok: false, code: 'agent_not_found' }],
		[415, { ok: false, code: 'upstream_error' }],
		[409, { ok: false, code: 'upstream_error' }],
		[500, { ok: false, code: 'unreachable' }],
		[503, { ok: false, code: 'unreachable' }],
	])('answers %i as %o and lets the body go unread', async (status, result) => {
		const { response, cancel } = answer(status)
		fetchMock.mockResolvedValue(response)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual(result)
		expect(cancel).toHaveBeenCalled()
	})
	it('cancels a 2xx event stream at once and warns that the agent ran on invalid input', async () => {
		const { response, cancel } = answer(200, 'text/event-stream; charset=utf-8')
		fetchMock.mockResolvedValue(response)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual({
			ok: true,
			warning: { code: 'ran_on_invalid_input' },
		})
		expect(cancel).toHaveBeenCalled()
	})
	it('answers a 2xx that is not an event stream as an upstream error', async () => {
		fetchMock.mockResolvedValue(answer(200).response)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual({
			ok: false,
			code: 'upstream_error',
		})
	})
	it.each([
		['a refused connection', new TypeError('fetch failed')],
		['the timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
	])('answers %s as unreachable', async (_label, error) => {
		fetchMock.mockRejectedValue(error)
		expect(await testAguiConnection(settings, secrets, admin)).toEqual({
			ok: false,
			code: 'unreachable',
		})
	})
})
