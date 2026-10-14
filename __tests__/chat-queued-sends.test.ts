import { describe, expect, it, vi } from 'vitest'

import { createQueuedSends } from '@/components/chat/hooks/queued-sends'
import { sendDecision } from '@/components/chat/hooks/send-decision'

describe('createQueuedSends', () => {
	it('answers has at once after add, and forgets the key on clear', () => {
		const queued = createQueuedSends(() => {})
		expect(queued.has('a')).toBe(false)
		queued.add('a')
		expect(queued.has('a')).toBe(true)
		expect(queued.has('b')).toBe(false)
		queued.clear('a')
		expect(queued.has('a')).toBe(false)
	})
	it('hands onChange a new Set on each change, never its own', () => {
		const onChange = vi.fn<(keys: ReadonlySet<string>) => void>()
		const queued = createQueuedSends(onChange)
		queued.add('a')
		queued.add('b')
		queued.clear('a')
		expect(onChange.mock.calls.map(([keys]) => [...keys])).toEqual([['a'], ['a', 'b'], ['b']])
		const [first, second, third] = onChange.mock.calls.map(([keys]) => keys)
		expect(first).not.toBe(second)
		expect(second).not.toBe(third)
		// A later change does not alter a Set already handed out (React state compared with Object.is).
		expect([...first!]).toEqual(['a'])
	})
	it('does not notify for a key already queued, or for clearing a key that is not', () => {
		const onChange = vi.fn()
		const queued = createQueuedSends(onChange)
		queued.clear('a')
		queued.add('a')
		queued.add('a')
		queued.clear('a')
		queued.clear('a')
		expect(onChange).toHaveBeenCalledTimes(2)
	})
})

describe("a queued send's reply that ends unseen (#68)", () => {
	// The hook's calls, in order: its send (sendDecision), its effect (clears the key on screen in a render that shows it
	// requesting) and the per-key provider's XRequest callbacks (clear the key whose reply ended, wherever the user is).
	it('lets the conversation send again', () => {
		const queued = createQueuedSends(() => {})
		// A send while a's history loads waits in the SDK's queue.
		expect(
			sendDecision({
				isRequesting: false,
				isDefaultMessagesRequesting: true,
				queued: queued.has('a'),
			}),
		).toBe('queue')
		queued.add('a')
		// A second send before the reply starts is ignored (one reply at a time per conversation).
		expect(
			sendDecision({
				isRequesting: false,
				isDefaultMessagesRequesting: false,
				queued: queued.has('a'),
			}),
		).toBe('ignore')
		// a's reply starts and ends with no render showing a requesting: it was refused at once, or the user had moved to
		// another conversation. The effect never ran for it, so a is still marked; alone (2a's code), that ignored every
		// later send to a and kept the list locked.
		expect(queued.has('a')).toBe(true)
		// a's provider calls onSuccess (or onError) at the reply's end, which clears a.
		queued.clear('a')
		// On a, nothing runs and nothing waits: the next send goes.
		expect(
			sendDecision({
				isRequesting: false,
				isDefaultMessagesRequesting: false,
				queued: queued.has('a'),
			}),
		).toBe('send')
	})
})
