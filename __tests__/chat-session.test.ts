import type { BaseEvent, Message } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { saveMessages, saveState, finishRun } = vi.hoisted(() => ({
	saveMessages: vi.fn(),
	saveState: vi.fn(),
	finishRun: vi.fn(),
}))
vi.mock('@/lib/data/conversations', () => ({ saveMessages, saveState, finishRun }))
vi.mock('@/lib/env', () => ({ env: () => ({ agentJwtIssuer: 'nextjs-bff' }) }))

import { BROKEN_STREAM_TEXT, RunSession, SAVE_INTERVAL_MS } from '@/lib/chat/session'
import { STOPPED_TOOL_CONTENT, STOPPED_TOOL_ERROR } from '@/lib/chat/thread'
import { aguiChat } from '@/lib/providers/agui/chat'

const KEY = { conversationId: 'conversation-1', runId: 'run-1' }
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const USER: Message = { id: 'user-1', role: 'user', content: 'Hi' }
const assistant = (
	content: string,
	toolCalls?: { id: string; name: string; args: string }[],
): Message => ({
	id: 'm-1',
	role: 'assistant',
	content,
	...(toolCalls
		? {
				toolCalls: toolCalls.map(call => ({
					id: call.id,
					type: 'function',
					function: { name: call.name, arguments: call.args },
				})),
			}
		: {}),
})

let clock = 0
const setup = () => {
	const out: BaseEvent[] = []
	const session = new RunSession({
		key: KEY,
		appId: 'app-1',
		title: 'Hi',
		history: [USER],
		out: { write: event => void out.push(event) },
		now: () => clock,
	})
	return { out, session, types: () => out.map(event => event.type) }
}
/** All rows written so far, by message id: the last status and body each id was written with. */
const writtenRows = () =>
	Object.fromEntries(
		saveMessages.mock.calls.flatMap(([, rows]) =>
			(rows as { message: Message; status: string }[]).map(row => [row.message.id, row]),
		),
	)

beforeEach(() => {
	clock = 1_000_000
	saveMessages.mockReset().mockResolvedValue(undefined)
	saveState.mockReset().mockResolvedValue(undefined)
	finishRun.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('RunSession toward the browser (spec §4.4)', () => {
	it('names the run first, in hub:run', () => {
		const { out, session } = setup()
		session.start()
		expect(out).toEqual([
			{
				type: 'CUSTOM',
				name: 'hub:run',
				value: { conversationId: 'conversation-1', runId: 'run-1', title: 'Hi' },
			},
		])
	})

	it('passes the rendered events on, without their raw provider event', () => {
		const { out, session } = setup()
		session.event(
			ev('TEXT_MESSAGE_START', {
				messageId: 'm-1',
				role: 'assistant',
				rawEvent: { provider: 'x' },
			}),
		)
		session.event(ev('RUN_ERROR', { code: 'busy', message: 'Try again soon.' }))
		expect(out).toEqual([
			{ type: 'TEXT_MESSAGE_START', messageId: 'm-1', role: 'assistant' },
			{ type: 'RUN_ERROR', code: 'busy', message: 'Try again soon.' },
		])
	})

	it('keeps raw, encrypted, snapshot and delta events, the hub’s own names and the client’s abort error on the server', () => {
		const { out, session } = setup()
		for (const event of [
			ev('RAW', { event: {} }),
			ev('REASONING_ENCRYPTED_VALUE', {
				subtype: 'message',
				entityId: 'r-1',
				encryptedValue: 'opaque',
			}),
			ev('MESSAGES_SNAPSHOT', { messages: [] }),
			ev('STATE_SNAPSHOT', { snapshot: {} }),
			ev('STATE_DELTA', { delta: [] }),
			ev('ACTIVITY_DELTA', { messageId: 'a-1', activityType: 'progress', patch: [] }),
			ev('CUSTOM', { name: 'hub:run', value: { runId: 'spoofed' } }),
			ev('RUN_ERROR', { code: 'abort', message: 'This operation was aborted' }),
		])
			session.event(event)
		expect(out).toEqual([])
	})

	it('sends the applied state as a snapshot and stores it', async () => {
		const { out, session } = setup()
		session.event(ev('STATE_DELTA', { delta: [{ op: 'add', path: '/done', value: true }] }))
		session.state({ done: true })
		expect(out).toEqual([{ type: 'STATE_SNAPSHOT', snapshot: { done: true } }])
		await session.finish({ failed: false })
		expect(saveState).toHaveBeenCalledWith(KEY, { done: true })
	})

	it('sends an activity a delta changed as a snapshot of the patched message', () => {
		const { out, session } = setup()
		session.event(
			ev('ACTIVITY_DELTA', {
				messageId: 'a-1',
				activityType: 'progress',
				patch: [{ op: 'replace', path: '/done', value: 2 }],
			}),
		)
		session.messages([
			USER,
			{ id: 'a-1', role: 'activity', activityType: 'progress', content: { done: 2 } },
		])
		expect(out).toEqual([
			{
				type: 'ACTIVITY_SNAPSHOT',
				messageId: 'a-1',
				activityType: 'progress',
				content: { done: 2 },
				replace: true,
			},
		])
	})
})

// Spec §3.2 step 2: rows by message id when a message starts, ends, its tool result arrives, and every 2 s of text.
describe('RunSession storing the rows (spec §3.2)', () => {
	it('writes a message when it starts and ends, and its text at most every 2 s between', async () => {
		const { session } = setup()
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		// A delta every second: the first comes 1 s after the start's write, the second 2 s after it.
		for (const [i, delta] of ['a', 'b', 'c'].entries()) {
			clock += SAVE_INTERVAL_MS / 2
			session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta }))
			session.messages([USER, assistant('abc'.slice(0, i + 1))])
		}
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		await session.finish({ failed: false })
		const calls = saveMessages.mock.calls.map(([, rows]) =>
			(rows as { message: Message; status: string }[]).map(row => [
				row.message.id,
				row.status,
				(row.message as { content?: string }).content,
			]),
		)
		expect(calls).toEqual([
			[['m-1', 'streaming', '']],
			[['m-1', 'streaming', 'ab']],
			[['m-1', 'complete', 'abc']],
		])
	})

	it('never writes back a row of the thread it was given', async () => {
		const { session } = setup()
		session.event(ev('TOOL_CALL_RESULT', { messageId: 't-1', toolCallId: 'call-1', content: 'ok' }))
		session.messages([USER, { id: 't-1', role: 'tool', toolCallId: 'call-1', content: 'ok' }])
		await session.finish({ failed: false })
		expect(Object.keys(writtenRows())).toEqual(['t-1'])
	})

	it('writes the rows one after another', async () => {
		const order: string[] = []
		let release: () => void = () => undefined
		saveMessages.mockImplementationOnce(
			() => new Promise<void>(resolve => (release = () => (order.push('first'), resolve()))),
		)
		saveMessages.mockImplementation(async () => void order.push('second'))
		const { session } = setup()
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'done' }))
		session.messages([USER, assistant('done')])
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		const finished = session.finish({ failed: false })
		await Promise.resolve()
		expect(order).toEqual([])
		release()
		await finished
		expect(order).toEqual(['first', 'second'])
	})

	// saveMessages upserts unconditionally (Task 6): a row written after finishRun marked it incomplete would reopen it.
	it('ignores what the adapter reports once the run is finishing, so its end is the last write', async () => {
		const order: string[] = []
		saveMessages.mockImplementation(async () => void order.push('saveMessages'))
		saveState.mockImplementation(async () => void order.push('saveState'))
		finishRun.mockImplementation(async () => void order.push('finishRun'))
		const { out, session } = setup()
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		const finished = session.finish({ failed: false, stopReason: 'stop' })
		const sent = out.length
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-2', role: 'assistant' }))
		session.messages([USER, assistant(''), { id: 'm-2', role: 'assistant', content: 'late' }])
		session.state({ late: true })
		await finished
		expect(order).toEqual(['saveMessages', 'finishRun'])
		expect(out.length).toBe(sent)
	})
})

describe('RunSession.finish (spec §3.2 steps 3–4, §4.5; plan call P6)', () => {
	const streamText = (session: RunSession) => {
		session.event(ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }))
		session.event(ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }))
		session.messages([USER, assistant('')])
		session.event(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Part' }))
		session.messages([USER, assistant('Part')])
	}

	it('stores a finished run as succeeded with its outcome and usage', async () => {
		const { session } = setup()
		streamText(session)
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		session.event(
			ev('RUN_FINISHED', {
				threadId: 'conversation-1',
				runId: 'run-1',
				outcome: { type: 'success' },
				usage: [{ inputTokens: 3, outputTokens: 5 }],
			}),
		)
		const end = await session.finish({ failed: false })
		expect(end).toEqual({
			status: 'succeeded',
			outcome: { type: 'success' },
			usage: [{ inputTokens: 3, outputTokens: 5 }],
			custom: [],
		})
		expect(finishRun).toHaveBeenCalledWith(KEY, end)
	})

	it('stores an interrupted run with its interrupts', async () => {
		const { session } = setup()
		const outcome = {
			type: 'interrupt',
			interrupts: [{ id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }],
		}
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1', outcome }))
		expect(await session.finish({ failed: false })).toMatchObject({
			status: 'interrupted',
			outcome,
		})
	})

	// Spec §2.3: the agent's time limit is CUSTOM run_cancelled, then RUN_FINISHED.
	it('stores an agent’s time limit as cancelled, with the custom event', async () => {
		const { out, session } = setup()
		streamText(session)
		session.event(ev('TEXT_MESSAGE_END', { messageId: 'm-1' }))
		session.event(ev('CUSTOM', { name: 'run_cancelled', value: { reason: 'run_timeout' } }))
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }))
		const end = await session.finish({ failed: false })
		// Spec §3.1: the outcome as received; this RUN_FINISHED carried none.
		expect(end).toMatchObject({
			status: 'cancelled',
			outcome: null,
			custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }],
		})
		expect(out.at(-1)).toMatchObject({ type: 'RUN_FINISHED' })
	})

	it('stores a RUN_ERROR as failed with the agent’s code, closing what was open', async () => {
		const { session } = setup()
		streamText(session)
		session.event(
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
		)
		session.messages([USER, assistant('Part', [{ id: 'call-1', name: 'search', args: '' }])])
		session.event(ev('RUN_ERROR', { code: 'model_unavailable', message: 'The model is down.' }))
		const end = await session.finish({ failed: false })
		expect(end).toMatchObject({
			status: 'failed',
			error: { code: 'model_unavailable', message: 'The model is down.' },
		})
		expect(end.close?.messageIds).toEqual(['m-1'])
		expect(end.close?.toolMessages).toEqual([
			{
				id: expect.any(String),
				role: 'tool',
				toolCallId: 'call-1',
				content: STOPPED_TOOL_CONTENT,
				error: STOPPED_TOOL_ERROR,
			},
		])
		expect(console.error).toHaveBeenCalledWith('Chat run failed:', {
			appId: 'app-1',
			runId: 'run-1',
			code: 'model_unavailable',
		})
	})

	// Spec §4.5: the hub's Stop. The client's abort error is dropped; the hub closes the run in order as cancelled.
	it('closes a stopped run toward the browser and stores it cancelled', async () => {
		const { out, session } = setup()
		streamText(session)
		session.event(ev('REASONING_START', { messageId: 'r-1' }))
		session.event(
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
		)
		session.messages([USER, assistant('Part', [{ id: 'call-1', name: 'search', args: '' }])])
		session.event(ev('RUN_ERROR', { code: 'abort', message: 'This operation was aborted' }))
		const before = out.length
		const end = await session.finish({ failed: false, stopReason: 'stop' })
		expect(out.slice(before)).toEqual([
			{ type: 'TOOL_CALL_END', toolCallId: 'call-1' },
			{ type: 'TEXT_MESSAGE_END', messageId: 'm-1' },
			{ type: 'REASONING_END', messageId: 'r-1' },
			{
				type: 'RUN_FINISHED',
				threadId: 'conversation-1',
				runId: 'run-1',
				outcome: { type: 'cancelled' },
			},
		])
		expect(end).toMatchObject({
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			close: { messageIds: ['m-1'] },
		})
		expect(end.close?.toolMessages).toHaveLength(1)
	})

	it('stores a run the browser left as truncated, and sends nothing more', async () => {
		const { out, session } = setup()
		streamText(session)
		const before = out.length
		const end = await session.finish({ failed: false, stopReason: 'disconnect' })
		expect(end).toMatchObject({
			status: 'truncated',
			close: { messageIds: ['m-1'], toolMessages: [] },
		})
		expect(out.length).toBe(before)
	})

	// The stored error is upstream_error either way; the log line tells a broken stream from one that just ended.
	it.each([
		['broke off', true, 'stream_broken'],
		['ended without a terminal event', false, 'stream_ended'],
	])('fails a stream that %s, telling the browser (plan call P6)', async (_case, failed, code) => {
		const { out, session } = setup()
		streamText(session)
		const end = await session.finish({ failed })
		expect(end).toMatchObject({
			status: 'failed',
			error: { code: 'upstream_error' },
			close: { messageIds: ['m-1'] },
		})
		expect(out.at(-1)).toEqual({
			type: 'RUN_ERROR',
			code: 'upstream_error',
			message: BROKEN_STREAM_TEXT,
		})
		expect(console.error).toHaveBeenCalledWith('Chat run failed:', {
			appId: 'app-1',
			runId: 'run-1',
			code,
		})
	})

	// The run route ends a run the agent never answered when a stop reason was set before it did (Task 11).
	it('closes a run that saw no event: stopped as cancelled, left as truncated, never failed', async () => {
		const stopped = setup()
		expect(await stopped.session.finish({ failed: false, stopReason: 'stop' })).toEqual({
			status: 'cancelled',
			outcome: { type: 'cancelled' },
			custom: [],
			close: { messageIds: [], toolMessages: [] },
		})
		expect(stopped.out).toEqual([
			{
				type: 'RUN_FINISHED',
				threadId: 'conversation-1',
				runId: 'run-1',
				outcome: { type: 'cancelled' },
			},
		])
		const left = setup()
		expect(await left.session.finish({ failed: true, stopReason: 'disconnect' })).toMatchObject({
			status: 'truncated',
		})
		expect(left.out).toEqual([])
		expect(saveMessages).not.toHaveBeenCalled()
	})

	it('lets the terminal event win over a stop that came after it', async () => {
		const { session } = setup()
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }))
		expect(await session.finish({ failed: false, stopReason: 'stop' })).toMatchObject({
			status: 'succeeded',
		})
	})

	it('logs a failed final write and still answers the end', async () => {
		finishRun.mockRejectedValue(
			Object.assign(new Error('connection lost'), { name: 'DatabaseError' }),
		)
		const { session } = setup()
		session.event(ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }))
		await expect(session.finish({ failed: false })).resolves.toMatchObject({ status: 'succeeded' })
		expect(console.error).toHaveBeenCalled()
	})
})

// The hook order the session relies on, through the real client (Task 9's adapter on a stubbed fetch).
describe('RunSession behind aguiChat', () => {
	it('stores the client’s message list and forwards the stream as the browser reads it', async () => {
		const encoder = new EventEncoder()
		const events = [
			ev('RUN_STARTED', { threadId: 'conversation-1', runId: 'run-1' }),
			ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hello' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-1' }),
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			ev('TOOL_CALL_RESULT', { messageId: 't-1', toolCallId: 'call-1', content: 'found' }),
			ev('STATE_SNAPSHOT', { snapshot: { n: 1 } }),
			ev('RUN_FINISHED', { threadId: 'conversation-1', runId: 'run-1' }),
		]
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(events.map(event => encoder.encodeSSE(event)).join(''), {
						headers: { 'content-type': 'text/event-stream' },
					}),
			),
		)
		const { out, session, types } = setup()
		session.start()
		const handle = aguiChat.runTurn(
			{
				settings: { agentUrl: 'http://agents.test/agents/assistant', audience: 'assistant' },
				secrets: { jwtSecret: 'a-test-secret-of-at-least-32-characters' },
			},
			{
				threadId: 'conversation-1',
				runId: 'run-1',
				messages: [USER],
				state: {},
				tools: [],
				caller: { id: 'account-1', source: 'local', role: 'user' },
				abortController: new AbortController(),
			},
			session,
		)
		const { failed } = await handle.finished
		const end = await session.finish({ failed })
		expect(end.status).toBe('succeeded')
		expect(types()).toEqual([
			'CUSTOM',
			'RUN_STARTED',
			'TEXT_MESSAGE_START',
			'TEXT_MESSAGE_CONTENT',
			'TEXT_MESSAGE_END',
			'TOOL_CALL_START',
			'TOOL_CALL_ARGS',
			'TOOL_CALL_END',
			'TOOL_CALL_RESULT',
			'STATE_SNAPSHOT',
			'RUN_FINISHED',
		])
		expect(out.find(event => event.type === 'STATE_SNAPSHOT')).toEqual({
			type: 'STATE_SNAPSHOT',
			snapshot: { n: 1 },
		})
		const rows = writtenRows()
		expect(Object.keys(rows).sort()).toEqual(['m-1', 't-1'])
		expect(rows['m-1']).toEqual({
			message: {
				id: 'm-1',
				role: 'assistant',
				content: 'Hello',
				toolCalls: [
					{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
				],
			},
			status: 'complete',
		})
		expect(rows['t-1']).toEqual({
			message: { id: 't-1', role: 'tool', toolCallId: 'call-1', content: 'found' },
			status: 'complete',
		})
	})
})
