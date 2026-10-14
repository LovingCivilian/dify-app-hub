import type { BaseEvent } from '@ag-ui/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEventStream, KEEP_ALIVE_MS, SSE_HEADERS } from '@/lib/chat/stream'

const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent

/** Everything the stream has queued so far, as text (the reader is released, so the stream stays readable). */
const drain = async (stream: ReadableStream<Uint8Array>, chunks: number) => {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	let text = ''
	for (let i = 0; i < chunks; i++) {
		const { value, done } = await reader.read()
		if (done) break
		text += decoder.decode(value)
	}
	reader.releaseLock()
	return text
}

afterEach(() => {
	vi.useRealTimers()
})

describe('createEventStream', () => {
	// AG-UI HTTP + SSE binding: one event per `data:` line, LF framing (@ag-ui/encoder encodeSSE).
	it('writes each event as one SSE data line', async () => {
		const out = createEventStream()
		out.write(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Hi' }))
		out.write(ev('RUN_FINISHED', { threadId: 't', runId: 'r' }))
		expect(await drain(out.stream, 2)).toBe(
			'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m-1","delta":"Hi"}\n\n' +
				'data: {"type":"RUN_FINISHED","threadId":"t","runId":"r"}\n\n',
		)
	})

	// Spec §4.4: a keep-alive comment after 15 s of silence, the timer restarted by every write.
	it('sends a keep-alive comment after 15 s without an event', async () => {
		vi.useFakeTimers()
		const out = createEventStream()
		vi.advanceTimersByTime(KEEP_ALIVE_MS - 1)
		out.write(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'a' }))
		vi.advanceTimersByTime(KEEP_ALIVE_MS - 1)
		const reader = out.stream.getReader()
		const first = await reader.read()
		expect(new TextDecoder().decode(first.value)).toContain('"delta":"a"')
		vi.advanceTimersByTime(1)
		const second = await reader.read()
		expect(new TextDecoder().decode(second.value)).toBe(': keep-alive\n\n')
	})

	it('closes once, and drops writes after it is closed or cancelled', async () => {
		vi.useFakeTimers()
		const out = createEventStream()
		out.write(ev('RUN_STARTED', { threadId: 't', runId: 'r' }))
		out.close()
		out.close()
		out.write(ev('RUN_FINISHED', { threadId: 't', runId: 'r' }))
		const reader = out.stream.getReader()
		expect((await reader.read()).done).toBe(false)
		expect((await reader.read()).done).toBe(true)
		expect(vi.getTimerCount()).toBe(0)

		const cancelled = createEventStream()
		await cancelled.stream.cancel()
		expect(() => cancelled.write(ev('RUN_STARTED', { threadId: 't', runId: 'r' }))).not.toThrow()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('names the stream headers of spec §4.4', () => {
		expect(SSE_HEADERS).toEqual({
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no',
		})
	})
})
