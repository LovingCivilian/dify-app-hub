import type { TFunction } from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContinuationLostError, FormNotWaitingError } from '@/components/chat/hooks/dify-errors'
import {
	answerInOrder,
	fallbackMessage,
	sendDecision,
	taskToStop,
	waitForHydration,
	type AnswerDeps,
} from '@/components/chat/hooks/use-dify-chat'
import type { PauseWait } from '@/components/chat/provider/dify-chat-provider'
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
/** A message whose run waits on the form `formToken`. */
const waiting = (formToken: string): DifyChatMessage => ({
	...emptyAssistant(),
	ids: { messageId: 'm1', conversationId: 'c1', taskId: 'task-1' },
	workflow: { runId: 'run-1', status: 'paused', nodes: [] },
	humanInput: {
		state: 'pending',
		formToken,
		formContent: '',
		inputs: [],
		actions: [],
		defaults: {},
		expiresAt: 0,
		workflowRunId: 'run-1',
	},
})

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
		const resume = { answeredToken: 'ft-1' }
		expect(fallbackMessage(new TypeError('network error'), streamed, t, resume).error).toEqual({
			message: 't:hitl.resume_failed',
		})
		expect(
			fallbackMessage(new DifyRequestError(502, undefined, ''), streamed, t, resume).error,
		).toEqual({ code: undefined, message: 't:hitl.resume_failed', status: 502 })
		// Dify's own reason still wins, and a stop is still a stop.
		expect(
			fallbackMessage(
				new DifyRequestError(404, 'not_found', 'Workflow run not found'),
				streamed,
				t,
				resume,
			).error?.message,
		).toBe('Workflow run not found')
		expect(fallbackMessage(abortError(), streamed, t, resume)).toMatchObject({ aborted: true })
		expect(fallbackMessage(abortError(), streamed, t, resume).error).toBeUndefined()
		// The form answered on the stream is no longer waiting, even before its human_input_form_filled.
		expect(fallbackMessage(abortError(), waiting('ft-1'), t, resume)).toMatchObject({
			aborted: true,
		})
	})
	// The run still waits on a form nobody answered on this stream: before the answer went out, after Dify
	// refused it, or at the next form. Nothing failed and the form is still open.
	it('leaves a resumed message that waits on an unanswered form as it is', () => {
		const paused = waiting('ft-2')
		for (const error of [abortError(), new TypeError('network error')]) {
			expect(fallbackMessage(error, paused, t, {})).toEqual(paused)
			expect(fallbackMessage(error, paused, t, { answeredToken: 'ft-1' })).toEqual(paused)
		}
		// Not a resume: an ordinary reply keeps its error and stop marks.
		expect(fallbackMessage(abortError(), paused, t)).toMatchObject({ aborted: true })
	})
	it('keeps what the reply already showed (a streamed part, a paused HITL message) next to the error', () => {
		const message = fallbackMessage(new TypeError('network error'), streamed, t)
		expect(message).toMatchObject({ content: 'Half an ans', ids: streamed.ids })
		expect(message.agentAnswer).toBeUndefined()
		expect(message.aborted).toBeUndefined()
	})
})

// Dify's own order (web/app/components/base/chat/chat/hooks.ts, 1.17.1): listen with the replay, wait for its pause,
// then submit. The fakes log every step so the order itself is what the tests check.
describe('answerInOrder', () => {
	const form = waiting('ft-1')
	const answer = { inputs: { feedback: 'ok' }, action: 'approve' }
	const fakes = (overrides: { pausedOn?: boolean; wait?: PauseWait; lost?: boolean } = {}) => {
		const log: string[] = []
		let pausedOn = overrides.pausedOn ?? false
		const deps: AnswerDeps = {
			isRequesting: false,
			reload: (id, resume) => log.push(`reload ${id} ${resume.workflowRunId}`),
			submit: async (token, body) => {
				log.push(`submit ${token} ${body.action}`)
				return {}
			},
			provider: {
				isPausedOn: (runId, token) => pausedOn && runId === 'run-1' && token === 'ft-1',
				waitForPause: () => {
					log.push('wait')
					return Promise.resolve(overrides.wait ?? { paused: true }).then(result => {
						log.push('paused')
						pausedOn = result.paused
						return result
					})
				},
				endResume: () => log.push('end'),
				markAnswered: token => log.push(`answered ${token}`),
				continuationLost: () => overrides.lost ?? false,
			},
		}
		return { deps, log }
	}

	it('opens the stream, waits for the replayed pause, and only then submits', async () => {
		const { deps, log } = fakes()
		await expect(answerInOrder(deps, 'a1', form, answer)).resolves.toBe(true)
		expect(log).toEqual([
			'wait',
			'reload a1 run-1',
			'paused',
			'submit ft-1 approve',
			'answered ft-1',
		])
	})
	it('answers on the open stream when the run already waits there (a refused answer before)', async () => {
		const { deps, log } = fakes({ pausedOn: true })
		await answerInOrder(deps, 'a1', form, answer)
		expect(log).toEqual(['submit ft-1 approve', 'answered ft-1'])
	})
	it('sends nothing when the stream ends without a pause, or fails before it', async () => {
		const finished = fakes({ wait: { paused: false } })
		await expect(answerInOrder(finished.deps, 'a1', form, answer)).rejects.toBeInstanceOf(
			FormNotWaitingError,
		)
		const error = new TypeError('network error')
		const failed = fakes({ wait: { paused: false, error } })
		await expect(answerInOrder(failed.deps, 'a1', form, answer)).rejects.toBe(error)
		for (const { log } of [finished, failed])
			expect(log.some(l => l.startsWith('submit'))).toBe(false)
	})
	it('sends nothing when the replay shows the run waiting on another form', async () => {
		const { deps, log } = fakes()
		deps.provider.isPausedOn = (runId, token) => runId === 'run-1' && token === 'ft-other'
		await expect(answerInOrder(deps, 'a1', form, answer)).rejects.toBeInstanceOf(
			FormNotWaitingError,
		)
		expect(log.some(l => l.startsWith('submit'))).toBe(false)
	})
	it('sends nothing while another reply of the conversation streams, and nothing without a token', async () => {
		const busy = fakes()
		await expect(
			answerInOrder({ ...busy.deps, isRequesting: true }, 'a1', form, answer),
		).resolves.toBe(false)
		const noToken = fakes()
		const delivered = { ...form, humanInput: { ...form.humanInput!, formToken: '' } }
		await expect(answerInOrder(noToken.deps, 'a1', delivered, answer)).resolves.toBe(false)
		expect([...busy.log, ...noToken.log]).toEqual([])
	})
	it('ends the wait when the message is gone from the store', async () => {
		const { deps, log } = fakes()
		deps.reload = () => {
			throw new Error('message [a1] is not found')
		}
		await expect(answerInOrder(deps, 'a1', form, answer)).rejects.toThrow('not found')
		expect(log.slice(0, 2)).toEqual(['wait', 'end'])
		expect(log.some(l => l.startsWith('submit'))).toBe(false)
	})
	// The stream closed (Stop during the POST, a dropped connection, Dify's idle close) before the run went on.
	it('reports an answer Dify accepted whose continuation this page will not see', async () => {
		const { deps, log } = fakes({ lost: true })
		await expect(answerInOrder(deps, 'a1', form, answer)).rejects.toBeInstanceOf(
			ContinuationLostError,
		)
		expect(log.at(-1)).toBe('answered ft-1')
	})
})

describe('taskToStop', () => {
	it("stops a running reply's task on Dify", () => {
		expect(taskToStop(streamed)).toBe('task-1')
		expect(
			taskToStop({ ...streamed, workflow: { runId: 'run-1', status: 'running', nodes: [] } }),
		).toBe('task-1')
	})
	// Dify's chat posts no stop while the run is paused (handleStop: `!pausedStateRef.current`): nothing runs, and a
	// stop flag could end the run once its form is answered.
	it('only closes the stream of a run that waits on a form', () => {
		expect(taskToStop(waiting('ft-1'))).toBeUndefined()
		expect(taskToStop(undefined)).toBeUndefined()
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
