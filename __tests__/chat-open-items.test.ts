import type { BaseEvent, Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { hasOpenItems, NO_OPEN_ITEMS, openItemsOfTurn } from '@/lib/chat/open-items'
import {
	applyAgUiEvent,
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	turnsFromMessages,
	userTurn,
	type ToolPart,
	type Turn,
	type TurnMessageRow,
	type TurnRunRow,
} from '@/lib/chat/turn'

/** An AG-UI event as the wire carries it (the reducer reads `type` as a string). */
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const hubRun = (runId: string) =>
	ev('CUSTOM', { name: HUB_RUN_EVENT, value: { conversationId: 'c-1', runId, title: 'Hi' } })
const call = (toolCallId: string, name: string, args = '{}') => [
	ev('TOOL_CALL_START', { toolCallId, toolCallName: name }),
	ev('TOOL_CALL_ARGS', { toolCallId, delta: args }),
	ev('TOOL_CALL_END', { toolCallId }),
]
const finished = (outcome: Record<string, unknown>) =>
	ev('RUN_FINISHED', { threadId: 'c-1', runId: 'run-1', outcome })
const live = (events: BaseEvent[], from: Turn = emptyAssistantTurn()): Turn =>
	[hubRun('run-1'), ...events].reduce(applyAgUiEvent, from)

const QUESTION_ARGS = '{"questions":[{"question":"Which city?"}]}'
const approval = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-9' }
const toolPart = (over: Partial<ToolPart> = {}): ToolPart => ({
	kind: 'tool',
	toolCallId: 'call-1',
	name: ASK_USER_TOOL_NAME,
	args: QUESTION_ARGS,
	status: 'waiting',
	...over,
})
const turnWith = (parts: Turn['parts'], interrupts: Turn['interrupts'] = []): Turn => ({
	...emptyAssistantTurn(),
	parts,
	interrupts,
})

describe('openItemsOfTurn (spec §3.3, §6; decision 62)', () => {
	it('answers nothing for no turn or a user turn, as the one NO_OPEN_ITEMS', () => {
		expect(openItemsOfTurn(undefined, true)).toBe(NO_OPEN_ITEMS)
		expect(openItemsOfTurn(userTurn('u-1', 'Hi'), true)).toBe(NO_OPEN_ITEMS)
		expect(openItemsOfTurn(emptyAssistantTurn(), true)).toBe(NO_OPEN_ITEMS)
	})

	it('answers the turn’s interrupts, whatever the switch', () => {
		const turn = turnWith([toolPart({ toolCallId: 'call-9', name: 'delete_file' })], [approval])
		for (const askUser of [true, false])
			expect(openItemsOfTurn(turn, askUser)).toEqual({ interrupts: [approval], questions: [] })
	})

	it('answers the waiting ask_user calls in call order while the switch is on, none while it is off', () => {
		const first = toolPart({ toolCallId: 'call-1' })
		const second = toolPart({ toolCallId: 'call-2' })
		const turn = turnWith([
			first,
			{ kind: 'text', messageId: 'm-1', text: 'Two questions.' },
			second,
		])
		expect(openItemsOfTurn(turn, true)).toEqual({ interrupts: [], questions: [first, second] })
		expect(openItemsOfTurn(turn, false)).toBe(NO_OPEN_ITEMS)
	})

	it('leaves out an ask_user call that runs, has an answer, failed or stopped, and another tool’s waiting call', () => {
		const turn = turnWith([
			toolPart({ toolCallId: 'running', status: 'running' }),
			toolPart({ toolCallId: 'done', status: 'done', result: 'Q: Which city?\nA: Paris' }),
			toolPart({ toolCallId: 'error', status: 'error', error: 'invalid_arguments' }),
			toolPart({ toolCallId: 'stopped', status: 'stopped' }),
			toolPart({ toolCallId: 'other', name: 'ask_user_question' }),
		])
		expect(openItemsOfTurn(turn, true)).toBe(NO_OPEN_ITEMS)
	})

	it('answers both kinds when an interrupted run also left an ask_user call', () => {
		const question = toolPart()
		const turn = turnWith(
			[question, toolPart({ toolCallId: 'call-9', name: 'delete_file' })],
			[approval],
		)
		expect(openItemsOfTurn(turn, true)).toEqual({ interrupts: [approval], questions: [question] })
	})
})

describe('open items of the live turn (plan call P9)', () => {
	it('opens an ask_user call the run ended without an answer, and closes it when the call has its result', () => {
		const turn = live([
			...call('call-1', ASK_USER_TOOL_NAME, QUESTION_ARGS),
			finished({ type: 'success' }),
		])
		expect(openItemsOfTurn(turn, true).questions.map(part => part.toolCallId)).toEqual(['call-1'])
		const answered = applyAgUiEvent(
			turn,
			ev('TOOL_CALL_RESULT', {
				messageId: 'r-1',
				toolCallId: 'call-1',
				content: 'Q: Which city?\nA: Paris',
			}),
		)
		expect(openItemsOfTurn(answered, true)).toBe(NO_OPEN_ITEMS)
	})

	it('opens nothing while the run runs, nor once a cancel stopped the call', () => {
		const running = live(call('call-1', ASK_USER_TOOL_NAME, QUESTION_ARGS))
		expect(openItemsOfTurn(running, true)).toBe(NO_OPEN_ITEMS)
		expect(openItemsOfTurn(applyAgUiEvent(running, finished({ type: 'cancelled' })), true)).toBe(
			NO_OPEN_ITEMS,
		)
	})

	it('answers an interrupted run’s interrupts, and nothing once the answering run starts', () => {
		const interrupted = live([
			...call('call-9', 'delete_file'),
			finished({ type: 'interrupt', interrupts: [approval] }),
		])
		expect(openItemsOfTurn(interrupted, false)).toEqual({ interrupts: [approval], questions: [] })
		expect(openItemsOfTurn(applyAgUiEvent(interrupted, hubRun('run-2')), false)).toBe(NO_OPEN_ITEMS)
	})
})

describe('open items of a reloaded turn (plan call P10)', () => {
	const user: TurnMessageRow = {
		messageId: 'u-1',
		runId: 'r-1',
		role: 'user',
		body: { id: 'u-1', role: 'user', content: 'Plan my trip' },
		status: 'complete',
	}
	const asking: Message = {
		id: 'a-1',
		role: 'assistant',
		toolCalls: [
			{
				id: 'call-1',
				type: 'function',
				function: { name: ASK_USER_TOOL_NAME, arguments: QUESTION_ARGS },
			},
		],
	}
	const rows: TurnMessageRow[] = [
		user,
		{ messageId: 'a-1', runId: 'r-1', role: 'assistant', body: asking, status: 'complete' },
	]
	const run = (over: Partial<TurnRunRow>): TurnRunRow => ({
		id: 'r-1',
		status: 'succeeded',
		outcome: { type: 'success' },
		error: null,
		custom: [],
		startedAt: new Date('2026-10-14T10:00:00Z'),
		...over,
	})
	const lastTurn = (runs: TurnRunRow[]) => turnsFromMessages(rows, runs).at(-1)?.turn

	it('keeps the question open after an answering run the agent refused before its stream', () => {
		const refused = run({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: {
				code: 'provider_unreachable',
				message: 'The agent is restarting, try again.',
				beforeStream: true,
			},
			startedAt: new Date('2026-10-14T10:05:00Z'),
		})
		const open = openItemsOfTurn(lastTurn([run({}), refused]), true)
		expect(hasOpenItems(open)).toBe(true)
		expect(open.questions.map(part => part.toolCallId)).toEqual(['call-1'])
	})

	it('closes it once a run the agent started failed after it', () => {
		const failed = run({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: { code: 'agent_error', message: 'Boom.' },
			startedAt: new Date('2026-10-14T10:05:00Z'),
		})
		expect(openItemsOfTurn(lastTurn([run({}), failed]), true)).toBe(NO_OPEN_ITEMS)
	})
})

describe('hasOpenItems', () => {
	it('is true when an interrupt or a question is open', () => {
		expect(hasOpenItems(NO_OPEN_ITEMS)).toBe(false)
		expect(hasOpenItems({ interrupts: [approval], questions: [] })).toBe(true)
		expect(hasOpenItems({ interrupts: [], questions: [toolPart()] })).toBe(true)
	})
})
