import type { BaseEvent, Message } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { jwtVerify } from 'jose'
import util from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))

import type { ChatTurnInput } from '@/lib/chat/adapter'
import { aguiChat, upstreamCodeFor } from '@/lib/providers/agui/chat'

const SECRET = 'a-test-secret-of-at-least-32-characters'
const app = {
	settings: { agentUrl: 'http://agents.test:8000/agents/assistant', audience: 'assistant' },
	secrets: { jwtSecret: SECRET },
}
const encoder = new EventEncoder()
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const sse = (events: BaseEvent[]) =>
	new Response(events.map(event => encoder.encodeSSE(event)).join(''), {
		headers: { 'content-type': 'text/event-stream' },
	})

const input = (over: Partial<ChatTurnInput> = {}): ChatTurnInput => ({
	threadId: 'conversation-1',
	runId: 'run-1',
	messages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
	state: { steps: [] },
	tools: [],
	caller: { id: 'account-1', source: 'ldap', role: 'user' },
	abortController: new AbortController(),
	...over,
})
const recordingSink = () => {
	const events: BaseEvent[] = []
	const lists: (readonly Message[])[] = []
	const states: unknown[] = []
	return {
		events,
		lists,
		states,
		sink: {
			event: (event: BaseEvent) => void events.push(event),
			messages: (messages: readonly Message[]) => void lists.push(messages),
			state: (state: unknown) => void states.push(state),
		},
	}
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)
	// @ag-ui/client logs a failed run itself ("Agent execution failed:"); the cases below assert what it logs.
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// Spec §4.3 step 4 and plan call P5.
describe('upstreamCodeFor', () => {
	it.each([
		[401, 'agent_auth_failed'],
		[403, 'agent_auth_failed'],
		[404, 'agent_not_found'],
		[415, 'agent_rejected_input'],
		[422, 'agent_rejected_input'],
		[400, 'upstream_error'],
		[429, 'upstream_error'],
		[500, 'upstream_error'],
		[503, 'upstream_error'],
	])('reads %i as %s', (status, code) => {
		expect(upstreamCodeFor(status)).toBe(code)
	})
})

describe('aguiChat.runTurn', () => {
	const finishedRun = [
		ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
		ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
		ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hello' }),
		ev('TEXT_MESSAGE_END', { messageId: 'm-1' }),
		ev('STATE_DELTA', {
			delta: [{ op: 'add', path: '/steps/-', value: { description: 'Read', status: 'pending' } }],
		}),
		ev('RUN_FINISHED', {
			threadId: 'conversation-1',
			runId: 'run-1',
			outcome: { type: 'success' },
		}),
	]

	// Spec §2.3: the request, its one auth header and its JWT.
	it('posts the RunAgentInput to the agent URL with one bearer JWT and the stream headers', async () => {
		fetchMock.mockResolvedValue(sse(finishedRun))
		const { sink } = recordingSink()
		const handle = aguiChat.runTurn(
			app,
			input({ resume: [{ interruptId: 'int-1', status: 'cancelled' }] }),
			sink,
		)
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: false })

		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://agents.test:8000/agents/assistant')
		expect(init.method).toBe('POST')
		const headers = init.headers as Record<string, string>
		expect(Object.keys(headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type'])
		expect(headers['Content-Type']).toBe('application/json')
		expect(headers.Accept).toBe('text/event-stream')

		const token = headers.Authorization.replace(/^Bearer /, '')
		const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
			issuer: 'nextjs-bff',
			audience: 'assistant',
		})
		expect(protectedHeader).toEqual({ alg: 'HS256', typ: 'JWT' })
		expect(payload).toMatchObject({ sub: 'account-1', auth_source: 'ldap', roles: ['user'] })
		expect(payload.exp! - payload.iat!).toBe(60)
		expect(payload).not.toHaveProperty('email')
		expect(payload).not.toHaveProperty('name')

		const body = JSON.parse(String(init.body))
		expect(body).toMatchObject({
			threadId: 'conversation-1',
			runId: 'run-1',
			messages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
			state: { steps: [] },
			tools: [],
			context: [],
			forwardedProps: {},
			resume: [{ interruptId: 'int-1', status: 'cancelled' }],
		})
	})

	// Spec §2.3: a token minted for each request.
	it('mints a fresh token for every run, valid for 60 s from that run', async () => {
		// Only Date is faked (Vitest `vi.useFakeTimers({ toFake })`): the stream's own timers keep running.
		vi.useFakeTimers({ toFake: ['Date'] })
		fetchMock.mockImplementation(async () => sse(finishedRun))
		const issuedAt: number[] = []
		for (const [runId, time] of [
			['run-1', '2026-10-14T10:00:00Z'],
			['run-2', '2026-10-14T10:05:00Z'],
		]) {
			vi.setSystemTime(new Date(time))
			await aguiChat.runTurn(app, input({ runId }), recordingSink().sink).finished
			const init = fetchMock.mock.calls.at(-1)![1] as RequestInit
			const token = (init.headers as Record<string, string>).Authorization.replace(/^Bearer /, '')
			const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
				issuer: 'nextjs-bff',
				audience: 'assistant',
				currentDate: new Date(time),
			})
			issuedAt.push(payload.iat!)
		}
		vi.useRealTimers()
		expect(issuedAt[1] - issuedAt[0]).toBe(300)
	})

	// Spec §3.2 step 2: the session reads the client's own message list and the applied state.
	it('reports each event before it is applied, then the message list and the state after it', async () => {
		fetchMock.mockResolvedValue(sse(finishedRun))
		const { events, lists, states, sink } = recordingSink()
		await aguiChat.runTurn(app, input(), sink).finished
		expect(events.map(event => event.type)).toEqual([
			'RUN_STARTED',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'STATE_DELTA',
			'RUN_FINISHED',
		])
		expect(lists.at(-1)).toEqual([
			{ id: 'user-1', role: 'user', content: 'Hi' },
			{ id: 'm-1', role: 'assistant', content: 'Hello' },
		])
		expect(states).toEqual([{ steps: [{ description: 'Read', status: 'pending' }] }])
	})

	// Spec §4.3 step 4 and §2.4: a refusal before the stream; the agent's error text is neither read nor logged.
	it.each([
		[401, 'agent_auth_failed'],
		[404, 'agent_not_found'],
		[422, 'agent_rejected_input'],
		[500, 'upstream_error'],
	])('settles opened with the code of a %i and never reads its body', async (status, code) => {
		const pull = vi.fn()
		const cancel = vi.fn()
		// highWaterMark 0: nothing is pulled until someone reads (MDN ReadableStream(), queuingStrategy).
		const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 })
		fetchMock.mockResolvedValue(
			new Response(body, { status, headers: { 'content-type': 'application/json' } }),
		)
		const { events, sink } = recordingSink()
		const handle = aguiChat.runTurn(app, input(), sink)
		await expect(handle.opened).resolves.toEqual({ ok: false, code })
		await expect(handle.finished).resolves.toEqual({ failed: true })
		expect(pull).not.toHaveBeenCalled()
		expect(cancel).toHaveBeenCalledOnce()
		expect(events).toEqual([])
	})

	it('reads a refused connection as provider_unreachable', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'))
		const handle = aguiChat.runTurn(app, input(), recordingSink().sink)
		await expect(handle.opened).resolves.toEqual({ ok: false, code: 'provider_unreachable' })
		await expect(handle.finished).resolves.toEqual({ failed: true })
	})

	// Spec §2.4: the agent's address reaches no log line, and the client logs what its fetch throws.
	it('logs nothing that names the agent host or port when the connection is refused', async () => {
		const cause = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:8000'), {
			code: 'ECONNREFUSED',
			address: '10.1.2.3',
			port: 8000,
			hostname: 'agents.test',
		})
		fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause }))
		const logged = vi.mocked(console.error)
		const handle = aguiChat.runTurn(app, input(), recordingSink().sink)
		await handle.finished
		const text = logged.mock.calls
			.map(args => args.map(a => util.inspect(a, { depth: 10 })).join(' '))
			.join('\n')
		expect(text).toContain('Agent execution failed')
		for (const secret of ['agents.test', '8000', '10.1.2.3']) expect(text).not.toContain(secret)
	})

	// Spec §4.5: the hub's abort mid-stream; the client's own RUN_ERROR reaches the sink, which drops it (Task 10).
	it('ends without a failure when the hub aborts mid-stream', async () => {
		const opening = [
			ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
			ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hel' }),
		]
		fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const event of opening)
						controller.enqueue(new TextEncoder().encode(encoder.encodeSSE(event)))
					// What fetch does to a body whose request is aborted (MDN AbortController: the body's read rejects).
					init.signal!.addEventListener('abort', () =>
						controller.error(new DOMException('This operation was aborted', 'AbortError')),
					)
				},
			})
			return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
		})
		const turn = input()
		const { events, sink } = recordingSink()
		const handle = aguiChat.runTurn(app, turn, {
			...sink,
			event: event => {
				sink.event(event)
				if (event.type === 'TEXT_MESSAGE_CONTENT') turn.abortController.abort()
			},
		})
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: false })
		expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'abort' })
	})

	it('opens a run the hub aborted before the agent answered, with nothing streamed', async () => {
		// What fetch does with an aborted signal: it rejects with an AbortError, at once if the signal is already aborted
		// (MDN fetch(): "AbortError … The request was aborted due to a call to the AbortController abort() method").
		fetchMock.mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					const abort = () => reject(new DOMException('This operation was aborted', 'AbortError'))
					if (init.signal!.aborted) abort()
					else init.signal!.addEventListener('abort', abort)
				}),
		)
		const turn = input()
		const { events, sink } = recordingSink()
		const handle = aguiChat.runTurn(app, turn, sink)
		turn.abortController.abort()
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: false })
		expect(events).toEqual([])
	})

	it('fails a stream that breaks the protocol', async () => {
		// verifyEvents: content for a message that never started is fatal (src/verify/verify.ts).
		fetchMock.mockResolvedValue(
			sse([
				ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
				ev('TEXT_MESSAGE_CONTENT', { messageId: 'nowhere', delta: 'x' }),
			]),
		)
		const handle = aguiChat.runTurn(app, input(), recordingSink().sink)
		await expect(handle.opened).resolves.toEqual({ ok: true })
		await expect(handle.finished).resolves.toEqual({ failed: true })
	})
})
