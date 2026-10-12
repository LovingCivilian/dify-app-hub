import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// DifyError extends lib/http's ProviderError, whose module reaches lib/auth/session (as the other Dify tests mock it).
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))

import {
	CONNECTION_TEST_TIMEOUT_MS,
	testDifyConnection,
} from '@/lib/providers/dify/test-connection'

const settings = {
	apiBase: 'https://dify.example/v1',
	appType: 'advanced-chat' as const,
	answerForm: { enabled: false, feedbackText: '' },
	enableUpdateAfterConversationStarts: false,
	openingStatementDisplayMode: 'default' as const,
}
const secrets = { apiKey: 'app-key' }
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const info = (mode: string) =>
	json(200, { name: 'Tea', description: '', tags: [], mode, author_name: 'x' })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
	// The client logs a network failure with its cause; the cases below assert outcomes, not that line.
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// Part 1 spec §4.2 (decision 18): GET /info with the key; the test copies and saves nothing.
describe('testDifyConnection', () => {
	it('calls GET <base>/info with the key as a bearer', async () => {
		fetchMock.mockResolvedValue(info('advanced-chat'))
		await testDifyConnection(settings, secrets)
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://dify.example/v1/info')
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer app-key')
		expect(init.method ?? 'GET').toBe('GET')
	})
	it('is reachable when Dify answers with the chosen type', async () => {
		fetchMock.mockResolvedValue(info('advanced-chat'))
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: true })
	})
	it('warns, still reachable, when Dify reports another type', async () => {
		fetchMock.mockResolvedValue(info('workflow'))
		expect(await testDifyConnection(settings, secrets)).toEqual({
			ok: true,
			warning: { code: 'type_mismatch', reported: 'workflow' },
		})
	})
	it("answers key_refused on Dify's 401", async () => {
		fetchMock.mockResolvedValue(
			json(401, { code: 'unauthorized', message: 'Access token is invalid', status: 401 }),
		)
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'key_refused' })
	})
	it('answers unreachable on a network failure', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'))
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'unreachable' })
	})
	it.each([
		['a 502 page from a proxy', () => new Response('<html>Bad Gateway</html>', { status: 502 })],
		[
			"Dify's own 500",
			() => json(500, { code: 'internal_server_error', message: 'x', status: 500 }),
		],
		['a 503 with no body', () => new Response(null, { status: 503 })],
	])('answers unreachable on %s', async (_label, answer) => {
		fetchMock.mockImplementation(async () => answer())
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'unreachable' })
	})
	// Plan decision f: the test gives up after 10 s (MDN AbortSignal.timeout()).
	it('answers unreachable when Dify does not answer within 10 s', async () => {
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockReturnValue(
				AbortSignal.abort(
					new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
				),
			)
		fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
			throw init.signal?.reason
		})
		expect(await testDifyConnection(settings, secrets)).toEqual({ ok: false, code: 'unreachable' })
		expect(timeout).toHaveBeenCalledWith(CONNECTION_TEST_TIMEOUT_MS)
		expect(CONNECTION_TEST_TIMEOUT_MS).toBe(10_000)
	})
	it.each([
		[
			"Dify's 403 for a disabled app",
			() => json(403, { code: 'forbidden', message: 'x', status: 403 }),
		],
		['a 404 for a wrong path', () => json(404, { code: 'not_found', message: 'x', status: 404 })],
		// Review Focus 3: a base without /v1 reaches the console, which answers its HTML page with 200.
		['an OK answer that is not JSON', () => new Response('<html>Dify</html>', { status: 200 })],
		['an OK JSON answer without a mode', () => json(200, { name: 'Tea' })],
	])('answers upstream_error on %s', async (_label, answer) => {
		fetchMock.mockImplementation(async () => answer())
		expect(await testDifyConnection(settings, secrets)).toEqual({
			ok: false,
			code: 'upstream_error',
		})
	})
})
