import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { HttpAgent, type Message } from '@ag-ui/client'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { e2eEnv } from '@/e2e/fixtures/env'
import { handle } from '@/e2e/fixtures/stub/router'

let server: Server
let base: string

// The same ephemeral-port harness as __tests__/stub-router.test.ts.
beforeAll(async () => {
	server = createServer((req, res) => {
		handle(req, res, (server.address() as AddressInfo).port).catch(() => res.end())
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

/** A token as the hub mints it (Part 2 spec §2.3), with one claim or option changed per case. */
const token = async (
	over: {
		secret?: string
		audience?: string
		expiresAt?: number
		claims?: Record<string, unknown>
	} = {},
) => {
	const now = Math.floor(Date.now() / 1000)
	return new SignJWT({ auth_source: 'local', roles: ['owner'], ...over.claims })
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject('e2e00000-0000-4000-8000-00000000beef')
		.setIssuer('nextjs-bff')
		.setAudience(over.audience ?? 'assistant')
		.setIssuedAt(now)
		.setExpirationTime(over.expiresAt ?? now + 60)
		.sign(new TextEncoder().encode(over.secret ?? e2eEnv.E2E_AGUI_JWT_SECRET))
}

const input = (text: string) => ({
	threadId: 'thread-1',
	runId: 'run-1',
	state: {},
	messages: [{ id: 'user-1', role: 'user', content: text }],
	tools: [],
	context: [],
	forwardedProps: {},
})

const post = (
	path: string,
	{ auth, body, contentType }: { auth?: string; body?: unknown; contentType?: string } = {},
) =>
	fetch(`${base}${path}`, {
		method: 'POST',
		headers: {
			'content-type': contentType ?? 'application/json',
			accept: 'text/event-stream',
			...(auth ? { authorization: `Bearer ${auth}` } : {}),
		},
		body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
	})

type Frame = { type: string; [key: string]: unknown }
const framesOf = async (response: Response): Promise<Frame[]> =>
	(await response.text())
		.split('\n\n')
		.filter(frame => frame.startsWith('data: '))
		.map(frame => JSON.parse(frame.slice(6)) as Frame)
/** The event types with repeats folded, so a streamed text reads as one CONTENT. */
const typesOf = (frames: Frame[]) =>
	frames.map(frame => frame.type).filter((type, index, all) => type !== all[index - 1])

const AGENT = '/agui/agents/assistant'

describe('the AG-UI stub agent (Part 2 spec §10)', () => {
	it('refuses a request without a valid token with 401, before anything else', async () => {
		const now = Math.floor(Date.now() / 1000)
		const refused = [
			undefined,
			await token({ secret: 'another-secret-another-secret-0000000000' }),
			await token({ expiresAt: now - 60 }),
			await token({ audience: 'someone-else' }),
			await token({ claims: { auth_source: undefined } }),
		]
		for (const auth of refused) {
			const response = await post(AGENT, { auth, body: input('hello') })
			expect(response.status).toBe(401)
			expect(response.headers.get('content-type')).toBe('application/json')
		}
		// The token first: an unknown agent without one is a 401 too.
		expect((await post('/agui/agents/missing', { body: input('hello') })).status).toBe(401)
	})

	it('answers 404 for an unknown agent and 415 for a body that is not JSON', async () => {
		const auth = await token()
		expect((await post('/agui/agents/missing', { auth, body: input('hello') })).status).toBe(404)
		expect((await post(AGENT, { auth, body: 'hello', contentType: 'text/plain' })).status).toBe(415)
	})

	it('answers 422 for Test connection’s {} and for the invalid scenario, before any stream', async () => {
		const auth = await token()
		const empty = await post(AGENT, { auth, body: {} })
		expect(empty.status).toBe(422)
		expect(empty.headers.get('content-type')).toBe('application/json')
		expect((await post(AGENT, { auth, body: input('please answer invalid') })).status).toBe(422)
	})

	it('streams the default scenario as a 1.0 run and records the caller', async () => {
		const response = await post(AGENT, { auth: await token(), body: input('hello') })
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		const frames = await framesOf(response)
		expect(typesOf(frames)).toEqual([
			'RUN_STARTED',
			'REASONING_START',
			'REASONING_MESSAGE_START',
			'REASONING_MESSAGE_CONTENT',
			'REASONING_MESSAGE_END',
			'REASONING_END',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'RUN_FINISHED',
		])
		expect(frames[0]).toMatchObject({
			threadId: 'thread-1',
			runId: 'run-1',
			protocolVersion: '1.0',
		})
		expect(frames.every(frame => typeof frame.timestamp === 'number')).toBe(true)
		const caller = await (await fetch(`${base}/agui/_caller`)).json()
		expect(caller).toEqual({
			sub: 'e2e00000-0000-4000-8000-00000000beef',
			auth_source: 'local',
			roles: ['owner'],
		})
	})

	it('is read by @ag-ui/client without a protocol error, scenario by scenario', async () => {
		const auth = await token()
		const runText = async (text: string) => {
			const seen: { errorCode?: string; custom?: { name: string; value: unknown } } = {}
			const agent = new HttpAgent({
				url: `${base}${AGENT}`,
				headers: { Authorization: `Bearer ${auth}` },
				threadId: `thread-${text}`,
				initialMessages: [{ id: `user-${text}`, role: 'user', content: text }],
			})
			const { newMessages } = await agent.runAgent(
				{ runId: `run-${text}` },
				{
					onRunErrorEvent: ({ event }) => {
						seen.errorCode = event.code
					},
					onCustomEvent: ({ event }) => {
						seen.custom = { name: event.name, value: event.value }
					},
				},
			)
			return { roles: newMessages.map((message: Message) => message.role), newMessages, seen }
		}
		expect((await runText('hello')).roles).toEqual(['reasoning', 'assistant'])
		const tool = await runText('use a tool')
		expect(tool.roles).toEqual(['assistant', 'tool', 'assistant'])
		const caller = tool.newMessages[0] as Extract<Message, { role: 'assistant' }>
		expect(caller.toolCalls?.[0]?.function.name).toBe('get_weather')
		// Any of the hub's five RUN_ERROR codes (Task 17 loops over them).
		for (const code of ['usage_limit', 'rate_limited', 'busy', 'model_unavailable', 'agent_error'])
			expect((await runText(`error ${code}`)).seen.errorCode).toBe(code)
		expect((await runText('timeout')).seen.custom).toEqual({
			name: 'run_cancelled',
			value: { reason: 'run_timeout' },
		})
	})

	it('records that a slow stream was closed early', async () => {
		const response = await post(AGENT, { auth: await token(), body: input('slow') })
		const reader = response.body!.getReader()
		const decoder = new TextDecoder()
		let read = ''
		while ((read.match(/TEXT_MESSAGE_CONTENT/g) ?? []).length < 3) {
			const chunk = await reader.read()
			if (chunk.done) break
			read += decoder.decode(chunk.value, { stream: true })
		}
		await reader.cancel()
		// The server sees the socket close on its next tick; one word interval is enough.
		await new Promise(resolve => setTimeout(resolve, 300))
		const slow = await (await fetch(`${base}/agui/_slow`)).json()
		expect(slow.closedEarly).toBe(true)
		expect(slow.words).toBeGreaterThanOrEqual(3)
		expect(slow.words).toBeLessThan(200)
	})

	it('leaves the Dify routes as they were', async () => {
		expect((await fetch(`${base}/v1/parameters`)).status).toBe(200)
	})
})
