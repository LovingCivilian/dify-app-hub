import type { MessageInfo } from '@ant-design/x-sdk'
import { describe, expect, it } from 'vitest'

import {
	fallbackTurn,
	openItemsOf,
	prependLatestTurns,
	sendDecision,
	toMessageInfo,
	toRequestError,
} from '@/components/shared-chat/hooks/chat-helpers'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { hasOpenItems, NO_OPEN_ITEMS } from '@/lib/chat/open-items'
import { emptyAssistantTurn, userTurn, type ToolPart, type Turn } from '@/lib/chat/turn'
import { RequestError } from '@/lib/http/browser'

// fetch rejects with a DOMException named AbortError; the SDK and the fallback only read `name`.
const abortError = () =>
	Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })

const streaming: Turn = {
	...emptyAssistantTurn(),
	parts: [
		{ kind: 'text', messageId: 'm1', text: 'Half an ans' },
		{ kind: 'tool', toolCallId: 'c1', name: 'search', args: '{"q":', status: 'running' },
	],
	runs: [{ runId: 'r1', outcome: 'running' }],
}

/** A question to the user that the run ended on (plan call P9), and a gated call waiting for its approval. */
const asking: ToolPart = {
	kind: 'tool',
	toolCallId: 'q1',
	name: ASK_USER_TOOL_NAME,
	args: '{"questions":[{"question":"Which city?"}]}',
	status: 'waiting',
}
const gated: ToolPart = {
	kind: 'tool',
	toolCallId: 'c1',
	name: 'delete_file',
	args: '{"path":"a.txt"}',
	status: 'waiting',
}
/** A turn that waits: its run ended on an interrupt and a question (spec §6). */
const waitingTurn: Turn = {
	...emptyAssistantTurn(),
	parts: [{ kind: 'text', messageId: 'm1', text: 'Before I go on:' }, gated, asking],
	runs: [{ runId: 'r1', outcome: 'interrupt' }],
	interrupts: [{ id: 'int-1', reason: 'tool_call', toolCallId: 'c1' }],
}

describe('sendDecision (one reply at a time per conversation, as useDifyChat)', () => {
	it.each([
		[{ isRequesting: false, isDefaultMessagesRequesting: false, queued: false }, 'send'],
		[{ isRequesting: false, isDefaultMessagesRequesting: true, queued: false }, 'queue'],
		[{ isRequesting: true, isDefaultMessagesRequesting: false, queued: false }, 'ignore'],
		[{ isRequesting: false, isDefaultMessagesRequesting: true, queued: true }, 'ignore'],
	] as const)('%o → %s', (state, expected) => {
		expect(sendDecision(state)).toBe(expected)
	})
})

describe('fallbackTurn (useXChat requestFallback)', () => {
	it('closes the running run as cancelled on an abort and stops its running tools', () => {
		const turn = fallbackTurn(abortError(), streaming)
		expect(turn.runs).toEqual([{ runId: 'r1', outcome: 'cancelled' }])
		expect(turn.parts[0]).toEqual(streaming.parts[0])
		expect(turn.parts[1]).toMatchObject({ kind: 'tool', status: 'stopped' })
	})
	it('marks an abort before any run as a stopped request', () => {
		expect(fallbackTurn(abortError(), undefined).runs).toEqual([
			{ runId: '', outcome: 'cancelled' },
		])
	})
	it('records the envelope code of a refused request, never its English message', () => {
		const turn = fallbackTurn(
			new RequestError(502, 'agent_not_found', 'The agent was not found.'),
			undefined,
		)
		expect(turn.runs).toEqual([
			{ runId: '', outcome: 'error', error: { code: 'agent_not_found', message: '' } },
		])
	})
	it('closes a running run with the failure when the stream breaks', () => {
		const turn = fallbackTurn(new TypeError('network error'), streaming)
		expect(turn.runs).toEqual([
			{ runId: 'r1', outcome: 'error', error: { code: undefined, message: '' } },
		])
	})
	it('stops the calls a cut-off run leaves without a result, waiting ones too (plan call P9)', () => {
		const resumed: Turn = {
			...waitingTurn,
			runs: [...waitingTurn.runs, { runId: 'r2', outcome: 'running' }],
			interrupts: [],
		}
		const turn = fallbackTurn(new TypeError('network error'), resumed)
		expect(turn.parts.slice(1)).toEqual([
			{ ...gated, status: 'stopped' },
			{ ...asking, status: 'stopped' },
		])
	})
	it('appends the failure of a request that continued an ended run, and keeps what it waits for (#67)', () => {
		const turn = fallbackTurn(
			new RequestError(503, 'provider_unreachable', 'The agent is restarting.'),
			waitingTurn,
		)
		expect(turn.runs).toEqual([
			{ runId: 'r1', outcome: 'interrupt' },
			{ runId: '', outcome: 'error', error: { code: 'provider_unreachable', message: '' } },
		])
		expect(turn.parts).toEqual(waitingTurn.parts)
		expect(turn.interrupts).toEqual(waitingTurn.interrupts)
		expect(fallbackTurn(new TypeError('Failed to fetch'), waitingTurn).runs.at(-1)).toEqual({
			runId: '',
			outcome: 'error',
			error: { code: undefined, message: '' },
		})
	})
	it('leaves a turn whose run had already ended as it was when that request is aborted', () => {
		const ended: Turn = { ...streaming, runs: [{ runId: 'r1', outcome: 'success' }] }
		expect(fallbackTurn(abortError(), ended)).toEqual(ended)
		expect(fallbackTurn(abortError(), waitingTurn)).toBe(waitingTurn)
	})
})

describe('toRequestError', () => {
	it('keeps a RequestError and wraps anything else without its text', () => {
		const refused = new RequestError(404, 'conversation_not_found', 'x')
		expect(toRequestError(refused)).toBe(refused)
		const wrapped = toRequestError(new TypeError('Failed to fetch'))
		expect(wrapped).toBeInstanceOf(RequestError)
		expect(wrapped.code).toBeUndefined()
		expect(wrapped.message).toBe('')
	})
})

const info = (
	id: string,
	message: Turn,
	status: MessageInfo<Turn>['status'] = 'success',
): MessageInfo<Turn> => ({
	id,
	message,
	status,
})
const answer = (runId: string): Turn => ({
	...emptyAssistantTurn(),
	runs: [{ runId, outcome: 'success' }],
})

describe('prependLatestTurns (a retried first page)', () => {
	it('puts the page above what was sent since, without the turns already on screen', () => {
		const current = [info('msg_1', userTurn('local', 'again')), info('msg_2', answer('r2'))]
		const page = [
			info('u1', userTurn('u1', 'first')),
			info('turn-r1', answer('r1')),
			info('u2', userTurn('u2', 'again')),
			info('turn-r2', answer('r2')),
		]
		expect(prependLatestTurns(current, page).map(m => m.id)).toEqual([
			'u1',
			'turn-r1',
			'msg_1',
			'msg_2',
		])
	})
})

describe('toMessageInfo and openItemsOf', () => {
	it('shows a history turn as a finished message under its id (plan call P9)', () => {
		const turn = answer('r1')
		expect(toMessageInfo({ id: 'turn-r1', turn })).toEqual({
			id: 'turn-r1',
			message: turn,
			status: 'success',
		})
	})
	it("reads what the last turn waits for, its questions while the app's switch is on (spec §3.3, §6)", () => {
		expect(openItemsOf([info('a', waitingTurn)], true)).toEqual({
			interrupts: waitingTurn.interrupts,
			questions: [asking],
		})
		expect(openItemsOf([info('a', waitingTurn)], false)).toEqual({
			interrupts: waitingTurn.interrupts,
			questions: [],
		})
		expect(openItemsOf([info('a', waitingTurn), info('b', userTurn('b', 'x'))], true)).toEqual(
			NO_OPEN_ITEMS,
		)
		expect(openItemsOf([], true)).toEqual(NO_OPEN_ITEMS)
	})
	it('keeps the items open after a failed answer, so the cards can answer again (#67)', () => {
		const failed = fallbackTurn(new RequestError(400, 'answers_invalid', 'x'), waitingTurn)
		expect(openItemsOf([info('a', failed, 'error')], true)).toEqual({
			interrupts: waitingTurn.interrupts,
			questions: [asking],
		})
		expect(hasOpenItems(openItemsOf([info('a', failed, 'error')], true))).toBe(true)
	})
})
