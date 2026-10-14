import 'server-only'

import type { BaseEvent } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'

/** Spec §4.4: a comment after 15 s of silence keeps proxies from closing an idle stream (CopilotKit's default). */
export const KEEP_ALIVE_MS = 15_000

/**
 * Spec §4.4: the stream's headers. `no-transform` keeps intermediaries from compressing it; `X-Accel-Buffering: no` turns
 * nginx's buffering off (Next bundled docs, 02-guides/streaming.md "What can affect streaming").
 */
export const SSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache, no-transform',
	'X-Accel-Buffering': 'no',
}

/** AG-UI's HTTP + SSE binding: consumers "MUST tolerate SSE comment lines (`: keep-alive`)" (docs.ag-ui.com, http-sse). */
const KEEP_ALIVE = new TextEncoder().encode(': keep-alive\n\n')

/**
 * A Route Handler body that streams AG-UI events (Next bundled docs, 02-guides/streaming.md "Streaming in Route
 * Handlers": `new Response(new ReadableStream({ start(controller) { … } }))`). Each event is one SSE `data:` line from
 * `@ag-ui/encoder`'s `EventEncoder.encodeSSE` (the binding's framing; CopilotKit's runtime encodes the same way). Writes
 * after the browser went away (the stream was cancelled) or after `close()` are dropped: the run goes on being stored.
 */
export const createEventStream = () => {
	const encoder = new EventEncoder()
	const text = new TextEncoder()
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	let closed = false

	const schedule = () => {
		clearTimeout(timer)
		if (!closed) timer = setTimeout(() => enqueue(KEEP_ALIVE), KEEP_ALIVE_MS)
	}
	const enqueue = (chunk: Uint8Array) => {
		if (closed || !controller) return
		try {
			controller.enqueue(chunk)
		} catch {
			// MDN ReadableStreamDefaultController.enqueue(): a TypeError once the stream is closed or errored.
			closed = true
		}
		schedule()
	}

	const stream = new ReadableStream<Uint8Array>({
		// MDN ReadableStream(): `start` "is called immediately when the object is constructed".
		start(c) {
			controller = c
			schedule()
		},
		cancel() {
			closed = true
			clearTimeout(timer)
		},
	})

	return {
		stream,
		write(event: BaseEvent): void {
			enqueue(text.encode(encoder.encodeSSE(event)))
		},
		close(): void {
			if (closed) return
			closed = true
			clearTimeout(timer)
			controller?.close()
		},
	}
}
