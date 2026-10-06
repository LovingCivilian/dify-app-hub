import type { TFunction } from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	fallbackMessage,
	sendDecision,
	waitForHydration,
} from '@/components/chat/hooks/use-dify-chat'
import { DifyRequestError } from '@/components/chat/provider/dify-fetch'
import { emptyAssistant, type DifyChatMessage } from '@/components/chat/provider/message'

const t = ((key: string) => `t:${key}`) as unknown as TFunction
// fetch rejects with a DOMException named AbortError; the SDK and the fallback only read `name`.
const abortError = () =>
	Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
const streamed: DifyChatMessage = {
	...emptyAssistant(),
	content: 'Half an ans',
	ids: { messageId: 'm1', conversationId: 'c1', taskId: 'task-1' },
	agentAnswer: true,
}

describe('fallbackMessage (useXChat requestFallback)', () => {
	it('keeps a stopped reply, marks it aborted and drops the stream bookkeeping', () => {
		const { agentAnswer: _agentAnswer, ...expected } = streamed
		expect(fallbackMessage(abortError(), streamed, t)).toEqual({ ...expected, aborted: true })
	})
	it('marks the empty placeholder aborted when nothing had streamed yet', () => {
		expect(fallbackMessage(abortError(), undefined, t)).toEqual({
			...emptyAssistant(),
			aborted: true,
		})
	})
	it("shows Dify's error with its code and status", () => {
		const error = new DifyRequestError(400, 'app_unavailable', 'App unavailable')
		expect(fallbackMessage(error, emptyAssistant(), t).error).toEqual({
			code: 'app_unavailable',
			message: 'App unavailable',
			status: 400,
		})
	})
	it('uses the generic text when Dify sent no message (HTTP/2 has no statusText)', () => {
		const error = new DifyRequestError(502, undefined, '')
		expect(fallbackMessage(error, emptyAssistant(), t).error).toEqual({
			code: undefined,
			message: 't:common.request_failed_retry',
			status: 502,
		})
	})
	it('uses the generic text for network and other errors', () => {
		expect(fallbackMessage(new TypeError('Failed to fetch'), emptyAssistant(), t).error).toEqual({
			message: 't:common.request_failed_retry',
		})
	})
	// A failed HITL continuation: Dify already accepted the form, so the text must not invite a resubmit.
	it('names a failed continuation of a submitted form instead of the generic text', () => {
		expect(fallbackMessage(new TypeError('network error'), streamed, t, true).error).toEqual({
			message: 't:hitl.resume_failed',
		})
		expect(
			fallbackMessage(new DifyRequestError(502, undefined, ''), streamed, t, true).error,
		).toEqual({ code: undefined, message: 't:hitl.resume_failed', status: 502 })
		// Dify's own reason still wins, and a stop is still a stop.
		expect(
			fallbackMessage(
				new DifyRequestError(404, 'not_found', 'Workflow run not found'),
				streamed,
				t,
				true,
			).error?.message,
		).toBe('Workflow run not found')
		expect(fallbackMessage(abortError(), streamed, t, true)).toMatchObject({ aborted: true })
		expect(fallbackMessage(abortError(), streamed, t, true).error).toBeUndefined()
	})
	it('keeps what the reply already showed (a streamed part, a paused HITL message) next to the error', () => {
		const message = fallbackMessage(new TypeError('network error'), streamed, t)
		expect(message).toMatchObject({ content: 'Half an ans', ids: streamed.ids })
		expect(message.agentAnswer).toBeUndefined()
		expect(message.aborted).toBeUndefined()
	})
})

describe('sendDecision', () => {
	const state = (over: Partial<Parameters<typeof sendDecision>[0]> = {}) => ({
		isRequesting: false,
		isDefaultMessagesRequesting: false,
		queued: false,
		...over,
	})

	it('sends when the conversation is idle and its history has landed', () => {
		expect(sendDecision(state())).toBe('send')
	})
	it('ignores a send while this conversation has a reply running (Prompts and regenerate bypass the Sender)', () => {
		expect(sendDecision(state({ isRequesting: true }))).toBe('ignore')
		expect(sendDecision(state({ isRequesting: true, isDefaultMessagesRequesting: true }))).toBe(
			'ignore',
		)
	})
	it('queues one send while the history loads and ignores more: the SDK flushes its queue at once', () => {
		expect(sendDecision(state({ isDefaultMessagesRequesting: true }))).toBe('queue')
		expect(sendDecision(state({ isDefaultMessagesRequesting: true, queued: true }))).toBe('ignore')
	})
	// The SDK flushes its queue in a setTimeout after the history lands: until the queued reply has started,
	// the conversation is neither loading nor requesting, and a second send would run a concurrent stream.
	it('ignores a send while a queued one waits for the SDK to flush it after the history landed', () => {
		expect(sendDecision(state({ queued: true }))).toBe('ignore')
	})
})

describe('waitForHydration', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	// The zustand persist API surface the loader uses: hasHydrated() and onFinishHydration(listener).
	const fakePersist = (hydrated: boolean) => {
		const listeners = new Set<() => void>()
		return {
			listeners,
			hasHydrated: () => hydrated,
			onFinishHydration: (listener: () => void) => {
				listeners.add(listener)
				return () => {
					listeners.delete(listener)
				}
			},
			finish: () => {
				hydrated = true
				for (const listener of listeners) listener()
			},
		}
	}

	it('resolves at once when the store has hydrated', async () => {
		const persist = fakePersist(true)
		await waitForHydration(persist, 1000)
		expect(persist.listeners.size).toBe(0)
	})
	it('waits for the end of hydration, then unsubscribes', async () => {
		vi.useFakeTimers()
		const persist = fakePersist(false)
		let done = false
		void waitForHydration(persist, 1000).then(() => {
			done = true
		})
		await vi.advanceTimersByTimeAsync(10)
		expect(done).toBe(false)
		persist.finish()
		await vi.advanceTimersByTimeAsync(0)
		expect(done).toBe(true)
		expect(persist.listeners.size).toBe(0)
		expect(vi.getTimerCount()).toBe(0)
	})
	it('stops waiting at the bound: zustand calls no listener when hydration fails', async () => {
		vi.useFakeTimers()
		const persist = fakePersist(false)
		let done = false
		void waitForHydration(persist, 1000).then(() => {
			done = true
		})
		await vi.advanceTimersByTimeAsync(999)
		expect(done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(done).toBe(true)
		expect(persist.listeners.size).toBe(0)
	})
})
