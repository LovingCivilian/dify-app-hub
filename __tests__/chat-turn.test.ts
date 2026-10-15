import { HttpAgent } from '@ag-ui/client'
import type { BaseEvent, Message } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { describe, expect, it } from 'vitest'

import { withSentAnswers, type SentAnswer } from '@/lib/chat/sent-answers'
import { STOPPED_TOOL_CONTENT, STOPPED_TOOL_ERROR } from '@/lib/chat/statuses'

import {
	applyAgUiEvent,
	contentText,
	emptyAssistantTurn,
	HUB_RUN_EVENT,
	runOutcomeOf,
	turnsFromMessages,
	turnText,
	userTurn,
	type Turn,
	type TurnMessageRow,
	type TurnRunRow,
} from '@/lib/chat/turn'

const RUN = 'run-1'
const THREAD = 'conversation-1'

/** An AG-UI event as the wire carries it: the reducer reads `type` as a string (no EventType at run time). */
const ev = (type: string, fields: Record<string, unknown> = {}) =>
	({ type, ...fields }) as unknown as BaseEvent
const hubRun = (runId = RUN) =>
	ev('CUSTOM', { name: HUB_RUN_EVENT, value: { conversationId: THREAD, runId, title: 'Hi' } })
const text = (messageId: string, ...deltas: string[]) => [
	ev('TEXT_MESSAGE_START', { messageId, role: 'assistant' }),
	...deltas.map(delta => ev('TEXT_MESSAGE_CONTENT', { messageId, delta })),
	ev('TEXT_MESSAGE_END', { messageId }),
]
const reasoning = (messageId: string, delta: string) => [
	ev('REASONING_START', { messageId }),
	ev('REASONING_MESSAGE_START', { messageId, role: 'reasoning' }),
	ev('REASONING_MESSAGE_CONTENT', { messageId, delta }),
	ev('REASONING_MESSAGE_END', { messageId }),
	ev('REASONING_END', { messageId }),
]
const started = ev('RUN_STARTED', { threadId: THREAD, runId: RUN })
const finished = (outcome?: Record<string, unknown>) =>
	ev('RUN_FINISHED', { threadId: THREAD, runId: RUN, ...(outcome ? { outcome } : {}) })

/** The live turn: what the browser's provider folds (spec §5.2). */
const live = (events: BaseEvent[], from: Turn = emptyAssistantTurn()): Turn =>
	[hubRun(), ...events].reduce(applyAgUiEvent, from)

const encoder = new EventEncoder()
/**
 * The messages @ag-ui/client 1.0.2 folds the same events into: the list the run session stores (spec §3.2: the rows come
 * from the agent's message list). The stub fetch answers the events as an SSE stream (HttpAgentConfig.fetch).
 */
const storedMessages = async (events: BaseEvent[]): Promise<Message[]> => {
	const agent = new HttpAgent({
		url: 'http://agent.test/agents/assistant',
		threadId: THREAD,
		initialMessages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
		fetch: async () =>
			new Response(events.map(event => encoder.encodeSSE(event)).join(''), {
				headers: { 'content-type': 'text/event-stream' },
			}),
	})
	await agent.runAgent({ runId: RUN })
	return agent.messages
}
const rowsOf = (messages: Message[]): TurnMessageRow[] =>
	messages.map(message => ({
		messageId: message.id,
		runId: RUN,
		role: message.role,
		body: message,
		status: 'complete',
	}))
const runRow = (over: Partial<TurnRunRow> = {}): TurnRunRow => ({
	id: RUN,
	status: 'succeeded',
	outcome: { type: 'success' },
	error: null,
	custom: [],
	startedAt: new Date('2026-10-14T10:00:00Z'),
	resume: null,
	...over,
})
/** A run started `minutes` after the first one. */
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 14, 10, minutes))
/** An approval (spec §6.1): a tool_call interrupt naming its call. */
const APPROVAL = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }
/** Pydantic AI's approval schema (spec §6.1). */
const APPROVAL_SCHEMA = {
	type: 'object',
	properties: { approved: { type: 'boolean' } },
	required: ['approved'],
}
/** A flat form (plan call P7), a confirmation (P6) and an approval for a call no turn holds (P8). */
const FORM = {
	id: 'int-f',
	reason: 'input_required',
	message: 'Which region?',
	responseSchema: {
		type: 'object',
		properties: { region: { type: 'string' } },
		required: ['region'],
	},
}
const CONFIRM = { id: 'int-c', reason: 'confirmation', message: 'Proceed?' }
const UNBOUND = { id: 'int-u', reason: 'tool_call', toolCallId: 'call-elsewhere' }

/* Scenarios modelled on the e2e stub's (Task 13) and the spike's multi-message run, with the run each one stores. */
const SCENARIOS: [string, BaseEvent[], Partial<TurnRunRow>][] = [
	[
		'hello: reasoning, then text',
		[
			started,
			...reasoning('rs-1', 'Thinking.'),
			...text('m-1', 'Hello ', 'there.'),
			finished({ type: 'success' }),
		],
		{},
	],
	[
		'tool: a call, its result, then text',
		[
			started,
			ev('TEXT_MESSAGE_START', { messageId: 'm-0', role: 'assistant' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-0' }),
			ev('TOOL_CALL_START', {
				toolCallId: 'call-1',
				toolCallName: 'get_weather',
				parentMessageId: 'm-0',
			}),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"city":"Paris"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			ev('TOOL_CALL_RESULT', {
				messageId: 'result-1',
				toolCallId: 'call-1',
				content: '{"temperature_c":18}',
			}),
			...text('m-1', 'It is 18 °C.'),
			finished(),
		],
		{},
	],
	[
		'error: a RUN_ERROR after some text',
		[
			started,
			...text('m-1', 'Partial'),
			ev('RUN_ERROR', { code: 'rate_limited', message: 'Slow down.' }),
		],
		{ status: 'failed', outcome: null, error: { code: 'rate_limited', message: 'Slow down.' } },
	],
	[
		'timeout: CUSTOM run_cancelled, then RUN_FINISHED',
		[
			started,
			...text('m-1', 'Part '),
			ev('CUSTOM', { name: 'run_cancelled', value: { reason: 'run_timeout' } }),
			finished(),
		],
		{ status: 'cancelled', custom: [{ name: 'run_cancelled', value: { reason: 'run_timeout' } }] },
	],
	[
		'multi: reasoning, two messages and a step (spike)',
		[
			started,
			...reasoning('rs-1', 'Two parts coming.'),
			ev('STEP_STARTED', { stepName: 'draft' }),
			...text('m-1', 'First.'),
			ev('STEP_FINISHED', { stepName: 'draft' }),
			...text('m-2', 'Second.'),
			finished({ type: 'success' }),
		],
		{},
	],
	[
		'approval: a gated call, then the interrupt (plan call P9)',
		[
			started,
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"path":"notes.txt"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			finished({ type: 'interrupt', interrupts: [APPROVAL] }),
		],
		{ status: 'interrupted', outcome: { type: 'interrupt', interrupts: [APPROVAL] } },
	],
	[
		'frontend: an ask_user call the run leaves unanswered (plan call P9)',
		[
			started,
			ev('TOOL_CALL_START', { toolCallId: 'call-2', toolCallName: 'ask_user' }),
			ev('TOOL_CALL_ARGS', {
				toolCallId: 'call-2',
				delta: '{"questions":[{"question":"Which city?"}]}',
			}),
			ev('TOOL_CALL_END', { toolCallId: 'call-2' }),
			finished({ type: 'success' }),
		],
		{},
	],
]

describe('applyAgUiEvent', () => {
	it('keeps a call’s recorded decision when a resumed run starts the same call again', () => {
		const decided: Turn = {
			...emptyAssistantTurn(),
			parts: [
				{
					kind: 'tool',
					toolCallId: 'call-1',
					name: 'delete_file',
					args: '{"path":"a.txt"}',
					status: 'waiting',
					decision: 'approved',
				},
			],
		}
		const turn = applyAgUiEvent(
			decided,
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
		)
		expect(turn.parts).toEqual([
			{
				kind: 'tool',
				toolCallId: 'call-1',
				name: 'delete_file',
				args: '',
				status: 'running',
				decision: 'approved',
			},
		])
	})
	it('opens a run on hub:run, once, and leaves RUN_STARTED of that run alone', () => {
		const turn = [hubRun(), hubRun(), started].reduce(applyAgUiEvent, emptyAssistantTurn())
		expect(turn.runs).toEqual([{ runId: RUN, outcome: 'running' }])
	})
	it('opens a run on RUN_STARTED when no hub:run came', () => {
		expect(applyAgUiEvent(emptyAssistantTurn(), started).runs).toEqual([
			{ runId: RUN, outcome: 'running' },
		])
	})
	it('starts a resumed run in the same turn and clears the answered interrupts', () => {
		const interrupted = live([
			started,
			finished({ type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'tool_call' }] }),
		])
		expect(interrupted.interrupts).toEqual([{ id: 'int-1', reason: 'tool_call' }])
		const resumed = applyAgUiEvent(interrupted, hubRun('run-2'))
		expect(resumed.runs.map(run => [run.runId, run.outcome])).toEqual([
			[RUN, 'interrupt'],
			['run-2', 'running'],
		])
		expect(resumed.interrupts).toEqual([])
	})
	it('folds assistant text by message id and ignores text of other roles', () => {
		const turn = live([
			...text('m-1', 'Hello ', 'there.'),
			ev('TEXT_MESSAGE_START', { messageId: 'dev-1', role: 'developer' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'dev-1', delta: 'hidden' }),
		])
		expect(turn.parts).toEqual([{ kind: 'text', messageId: 'm-1', text: 'Hello there.' }])
	})
	it('folds reasoning by message id', () => {
		expect(live(reasoning('rs-1', 'Thinking.')).parts).toEqual([
			{ kind: 'reasoning', messageId: 'rs-1', text: 'Thinking.' },
		])
	})
	it('builds a tool part from its start and arguments, and merges its result', () => {
		const turn = live([
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'search' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"q":' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '"tea"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
		])
		expect(turn.parts).toEqual([
			{
				kind: 'tool',
				toolCallId: 'call-1',
				name: 'search',
				args: '{"q":"tea"}',
				status: 'running',
			},
		])
		const answered = applyAgUiEvent(
			turn,
			ev('TOOL_CALL_RESULT', {
				messageId: 'r-1',
				toolCallId: 'call-1',
				content: [
					{ type: 'text', text: 'Green ' },
					{ type: 'text', text: 'tea' },
				],
			}),
		)
		expect(answered.parts[0]).toMatchObject({ status: 'done', result: 'Green tea' })
	})
	it('replaces an activity snapshot in place', () => {
		const turn = live([
			ev('ACTIVITY_SNAPSHOT', { messageId: 'a-1', activityType: 'progress', content: { done: 0 } }),
			...text('m-1', 'Working.'),
			ev('ACTIVITY_SNAPSHOT', { messageId: 'a-1', activityType: 'progress', content: { done: 1 } }),
		])
		expect(turn.parts.map(part => part.kind)).toEqual(['activity', 'text'])
		expect(turn.parts[0]).toEqual({
			kind: 'activity',
			messageId: 'a-1',
			activityType: 'progress',
			content: { done: 1 },
		})
	})
	it('ends a run with its outcome, settles running tools and drops empty text (plan call P9)', () => {
		const toolRun = [
			ev('TEXT_MESSAGE_START', { messageId: 'm-0', role: 'assistant' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-0' }),
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'ask_user' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
		]
		const success = live([...toolRun, finished()])
		expect(success.runs[0].outcome).toBe('success')
		expect(success.parts).toEqual([
			{ kind: 'tool', toolCallId: 'call-1', name: 'ask_user', args: '', status: 'waiting' },
		])
		const interrupt = live([
			...toolRun,
			finished({
				type: 'interrupt',
				interrupts: [{ id: 'i-1', reason: 'tool_call', toolCallId: 'call-1' }],
			}),
		])
		expect(interrupt.runs[0].outcome).toBe('interrupt')
		expect(interrupt.interrupts).toEqual([{ id: 'i-1', reason: 'tool_call', toolCallId: 'call-1' }])
		expect(interrupt.parts[0]).toMatchObject({ status: 'waiting' })
		const cancelled = live([...toolRun, finished({ type: 'cancelled' })])
		expect(cancelled.runs[0].outcome).toBe('cancelled')
		expect(cancelled.parts[0]).toMatchObject({ status: 'stopped' })
	})
	it('reads an agent time limit as a cancelled run with its reason (spec §2.3)', () => {
		const turn = live([
			...text('m-1', 'Part'),
			ev('CUSTOM', { name: 'run_cancelled', value: { reason: 'run_timeout' } }),
			finished(),
		])
		expect(turn.runs).toEqual([
			{ runId: RUN, outcome: 'cancelled', cancelledReason: 'run_timeout' },
		])
	})
	it('keeps a run error with its code and message, and stops running tools', () => {
		const turn = live([
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'search' }),
			ev('RUN_ERROR', { code: 'model_unavailable', message: 'The model is down.' }),
		])
		expect(turn.runs).toEqual([
			{
				runId: RUN,
				outcome: 'error',
				error: { code: 'model_unavailable', message: 'The model is down.' },
			},
		])
		expect(turn.parts[0]).toMatchObject({ status: 'stopped' })
	})
	it('lets the turn’s last run settle a call an earlier run left waiting (plan call P9)', () => {
		const interrupted = live([
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			finished({ type: 'interrupt', interrupts: [APPROVAL] }),
		])
		const resumed = applyAgUiEvent(interrupted, hubRun('run-2'))
		expect(resumed.parts[0]).toMatchObject({ status: 'waiting' })
		const end = (event: BaseEvent) => applyAgUiEvent(resumed, event).parts[0]
		expect(end(finished({ type: 'success' }))).toMatchObject({ status: 'waiting' })
		expect(end(finished({ type: 'cancelled' }))).toMatchObject({ status: 'stopped' })
		expect(end(ev('RUN_ERROR', { code: 'agent_error', message: 'Boom.' }))).toMatchObject({
			status: 'stopped',
		})
		expect(
			end(ev('TOOL_CALL_RESULT', { messageId: 'r-1', toolCallId: 'call-1', content: 'Deleted' })),
		).toMatchObject({ status: 'done', result: 'Deleted' })
	})
	it('returns the same turn for events it does not render', () => {
		const turn = live(text('m-1', 'Hi'))
		for (const type of [
			'STEP_STARTED',
			'STATE_SNAPSHOT',
			'RAW',
			'TEXT_MESSAGE_END',
			'REASONING_END',
		])
			expect(
				applyAgUiEvent(turn, ev(type, { messageId: 'm-1', stepName: 'x', snapshot: {} })),
			).toBe(turn)
	})
})

describe('runOutcomeOf', () => {
	it('names each stored status as the turn reads it', () => {
		expect(
			(['running', 'succeeded', 'interrupted', 'cancelled', 'failed', 'truncated'] as const).map(
				runOutcomeOf,
			),
		).toEqual(['running', 'success', 'interrupt', 'cancelled', 'error', 'truncated'])
	})
})

// Spec §3.3: a reload shows what the live view showed. The two agree for every stub scenario (spec §5.2).
describe('turnsFromMessages agrees with the live reducer', () => {
	it.each(SCENARIOS)('%s', async (_name, events, run) => {
		const history = turnsFromMessages(rowsOf(await storedMessages(events)), [runRow(run)])
		expect(history).toEqual([
			{ id: 'user-1', turn: userTurn('user-1', 'Hi') },
			{ id: `turn-${RUN}`, turn: live(events) },
		])
	})
	it('for a stopped run: the hub closes the browser side, the store answers the cut-off call', async () => {
		const agentEvents = [
			started,
			ev('TEXT_MESSAGE_START', { messageId: 'm-1', role: 'assistant' }),
			ev('TEXT_MESSAGE_CONTENT', { messageId: 'm-1', delta: 'Partial' }),
			ev('TOOL_CALL_START', {
				toolCallId: 'call-9',
				toolCallName: 'search',
				parentMessageId: 'm-1',
			}),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-9', delta: '{"q":' }),
		]
		// What the run session sends the browser after the hub's own Stop (spec §4.5; Task 10).
		const closings = [
			ev('TOOL_CALL_END', { toolCallId: 'call-9' }),
			ev('TEXT_MESSAGE_END', { messageId: 'm-1' }),
			finished({ type: 'cancelled' }),
		]
		// What it stores: the partial rows, and a tool message that answers the cut-off call (spec §3.2 step 4).
		const stored: Message[] = [
			...(await storedMessages(agentEvents)),
			{
				id: 'stop-1',
				role: 'tool',
				toolCallId: 'call-9',
				content: STOPPED_TOOL_CONTENT,
				error: STOPPED_TOOL_ERROR,
			},
		]
		const history = turnsFromMessages(rowsOf(stored), [
			runRow({ status: 'cancelled', outcome: { type: 'cancelled' } }),
		])
		expect(history[1].turn).toEqual(live([...agentEvents, ...closings]))
		expect(history[1].turn.parts[1]).toMatchObject({ kind: 'tool', status: 'stopped' })
	})
	// The owner, 2026-10-15: "record everything that happens in the chat, so even with other browsers or devices, it will
	// still have all the data". The browser records the answers when they go (the provider's transformParams merge); the
	// store reads them back from each answering run's `resume`.
	it('for the answers that went: the live merge and the stored runs record the same decisions', async () => {
		const gate = { ...APPROVAL, message: 'Delete notes.txt?', responseSchema: APPROVAL_SCHEMA }
		const run1 = [
			started,
			ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
			ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{"path":"notes.txt"}' }),
			ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
			finished({ type: 'interrupt', interrupts: [gate, FORM] }),
		]
		const resume1: SentAnswer[] = [
			{ interruptId: gate.id, status: 'resolved', payload: { approved: true } },
			{ interruptId: FORM.id, status: 'resolved', payload: { region: 'EU' } },
		]
		const run2 = [
			ev('TOOL_CALL_RESULT', { messageId: 'result-1', toolCallId: 'call-1', content: 'Deleted' }),
			ev('RUN_FINISHED', {
				threadId: THREAD,
				runId: 'run-2',
				outcome: { type: 'interrupt', interrupts: [CONFIRM, UNBOUND] },
			}),
		]
		const resume2: SentAnswer[] = [
			{ interruptId: CONFIRM.id, status: 'resolved', payload: false },
			{ interruptId: UNBOUND.id, status: 'cancelled' },
		]
		const run3 = [
			...text('m-3', 'Done.'),
			ev('RUN_FINISHED', { threadId: THREAD, runId: 'run-3', outcome: { type: 'success' } }),
		]
		// Live: each answering request merges its answers into the turn it continues, over that turn's open interrupts.
		const afterRun1 = live(run1)
		const afterRun2 = [hubRun('run-2'), ...run2].reduce(
			applyAgUiEvent,
			withSentAnswers(afterRun1, afterRun1.interrupts, resume1),
		)
		const liveTurn = [hubRun('run-3'), ...run3].reduce(
			applyAgUiEvent,
			withSentAnswers(afterRun2, afterRun2.interrupts, resume2),
		)
		// History: the rows and runs the store holds, each answering run with the answers it was started with.
		const rows: TurnMessageRow[] = [
			...rowsOf(await storedMessages(run1)),
			{
				messageId: 'result-1',
				runId: 'run-2',
				role: 'tool',
				body: { id: 'result-1', role: 'tool', toolCallId: 'call-1', content: 'Deleted' },
				status: 'complete',
			},
			{
				messageId: 'm-3',
				runId: 'run-3',
				role: 'assistant',
				body: { id: 'm-3', role: 'assistant', content: 'Done.' },
				status: 'complete',
			},
		]
		const history = turnsFromMessages(rows, [
			runRow({
				status: 'interrupted',
				outcome: { type: 'interrupt', interrupts: [gate, FORM] },
				startedAt: at(0),
			}),
			runRow({
				id: 'run-2',
				status: 'interrupted',
				outcome: { type: 'interrupt', interrupts: [CONFIRM, UNBOUND] },
				startedAt: at(1),
				resume: resume1,
			}),
			runRow({ id: 'run-3', startedAt: at(2), resume: resume2 }),
		])
		expect(history[1].turn).toEqual(liveTurn)
		expect(liveTurn.parts[0]).toMatchObject({ toolCallId: 'call-1', decision: 'approved' })
		expect(liveTurn.answered).toEqual([
			{ interrupt: FORM, status: 'resolved', payload: { region: 'EU' } },
			{ interrupt: CONFIRM, status: 'resolved', payload: false },
			{ interrupt: UNBOUND, status: 'cancelled' },
		])
	})
})

describe('turnsFromMessages', () => {
	const user = (id: string, runId: string, content: string): TurnMessageRow => ({
		messageId: id,
		runId,
		role: 'user',
		body: { id, role: 'user', content },
		status: 'complete',
	})
	const assistant = (id: string, runId: string, body: Partial<Message> = {}): TurnMessageRow => ({
		messageId: id,
		runId,
		role: 'assistant',
		body: { id, role: 'assistant', ...body } as Message,
		status: 'complete',
	})
	it('gives each user message a turn and groups what follows into one assistant turn (plan call P9)', () => {
		const turns = turnsFromMessages(
			[
				user('u-1', 'r-1', 'One'),
				assistant('a-1', 'r-1', { content: 'First answer' }),
				user('u-2', 'r-2', 'Two'),
				assistant('a-2', 'r-2', { content: 'Second answer' }),
			],
			[runRow({ id: 'r-1', startedAt: at(0) }), runRow({ id: 'r-2', startedAt: at(1) })],
		)
		expect(turns.map(({ id, turn }) => [id, turn.role, turnText(turn)])).toEqual([
			['u-1', 'user', 'One'],
			['turn-r-1', 'assistant', 'First answer'],
			['u-2', 'user', 'Two'],
			['turn-r-2', 'assistant', 'Second answer'],
		])
	})
	it('keeps the runs that resumed a turn in it, in order', () => {
		const turns = turnsFromMessages(
			[
				user('u-1', 'r-1', 'Delete it'),
				assistant('a-1', 'r-1', {
					toolCalls: [
						{ id: 'c-1', type: 'function', function: { name: 'delete_file', arguments: '{}' } },
					],
				}),
				{
					messageId: 't-1',
					runId: 'r-2',
					role: 'tool',
					body: { id: 't-1', role: 'tool', toolCallId: 'c-1', content: 'Deleted' },
					status: 'complete',
				},
				assistant('a-2', 'r-2', { content: 'Done.' }),
			],
			[
				runRow({
					id: 'r-1',
					status: 'interrupted',
					outcome: { type: 'interrupt', interrupts: [] },
					startedAt: at(0),
				}),
				runRow({ id: 'r-2', startedAt: at(1) }),
			],
		)
		expect(turns).toHaveLength(2)
		expect(turns[1].turn.runs.map(run => [run.runId, run.outcome])).toEqual([
			['r-1', 'interrupt'],
			['r-2', 'success'],
		])
		expect(turns[1].turn.parts).toEqual([
			{
				kind: 'tool',
				toolCallId: 'c-1',
				name: 'delete_file',
				args: '{}',
				status: 'done',
				result: 'Deleted',
			},
			{ kind: 'text', messageId: 'a-2', text: 'Done.' },
		])
	})
	it('shows a run that failed before any message as an assistant turn with its error', () => {
		const turns = turnsFromMessages(
			[user('u-1', 'r-1', 'Hi')],
			[
				runRow({
					id: 'r-1',
					status: 'failed',
					outcome: null,
					error: { code: 'agent_not_found', message: '' },
				}),
			],
		)
		expect(turns[1]).toEqual({
			id: 'turn-r-1',
			turn: {
				role: 'assistant',
				parts: [],
				runs: [{ runId: 'r-1', outcome: 'error', error: { code: 'agent_not_found', message: '' } }],
				interrupts: [],
				answered: [],
			},
		})
	})
	it('carries the open interrupts on the last turn only, while its last run is interrupted (spec §3.3)', () => {
		const interrupts = [{ id: 'int-1', reason: 'input_required', message: 'Which region?' }]
		const rows = [
			user('u-1', 'r-1', 'Report'),
			assistant('a-1', 'r-1', { content: 'One detail first.' }),
		]
		const open = turnsFromMessages(rows, [
			runRow({ id: 'r-1', status: 'interrupted', outcome: { type: 'interrupt', interrupts } }),
		])
		expect(open[1].turn.interrupts).toEqual(interrupts)
		const answered = turnsFromMessages(rows, [runRow({ id: 'r-1' })])
		expect(answered[1].turn.interrupts).toEqual([])
	})
	it('shows a tool message with an error as an error, its text kept, and skips developer and system rows', () => {
		const turns = turnsFromMessages(
			[
				{
					messageId: 's-1',
					runId: 'r-1',
					role: 'system',
					body: { id: 's-1', role: 'system', content: 'Be brief.' },
					status: 'complete',
				},
				user('u-1', 'r-1', 'Ask me'),
				assistant('a-1', 'r-1', {
					toolCalls: [
						{
							id: 'c-1',
							type: 'function',
							function: { name: 'ask_user_question', arguments: '{}' },
						},
					],
				}),
				{
					messageId: 't-1',
					runId: 'r-2',
					role: 'tool',
					body: {
						id: 't-1',
						role: 'tool',
						toolCallId: 'c-1',
						content: 'This tool is not available here.',
						error: 'unavailable',
					},
					status: 'complete',
				},
			],
			[runRow({ id: 'r-1', startedAt: at(0) }), runRow({ id: 'r-2', startedAt: at(1) })],
		)
		expect(turns.map(({ turn }) => turn.role)).toEqual(['user', 'assistant'])
		expect(turns[1].turn.parts[0]).toMatchObject({
			status: 'error',
			error: 'This tool is not available here.',
		})
	})
	it('puts a run no row names under the latest user message started before it, so its error shows', () => {
		const answersRun = runRow({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: { code: 'agent_rejected_input', message: '' },
			startedAt: at(5),
		})
		// The answers run of an interrupted turn, refused before its stream: it wrote no message (Task 7's readThreadPage).
		const withRows = turnsFromMessages(
			[user('u-1', 'r-1', 'Delete it'), assistant('a-1', 'r-1', { content: 'May I?' })],
			[
				runRow({
					id: 'r-1',
					status: 'interrupted',
					outcome: { type: 'interrupt', interrupts: [] },
					startedAt: at(0),
				}),
				answersRun,
			],
		)
		expect(withRows[1].id).toBe('turn-r-1')
		expect(withRows[1].turn.runs.map(run => [run.runId, run.outcome])).toEqual([
			['r-1', 'interrupt'],
			['r-2', 'error'],
		])
		// A user message whose own run wrote nothing yet gets the assistant turn made for it.
		const withoutRows = turnsFromMessages(
			[user('u-1', 'r-1', 'Hi'), user('u-2', 'r-3', 'Again')],
			[
				runRow({ id: 'r-1', startedAt: at(0) }),
				runRow({ id: 'r-3', status: 'running', outcome: null, startedAt: at(9) }),
				answersRun,
			],
		)
		expect(withoutRows.map(({ id }) => id)).toEqual(['u-1', 'turn-r-1', 'u-2', 'turn-r-3'])
		expect(withoutRows[1].turn.runs.map(run => run.runId)).toEqual(['r-1', 'r-2'])
	})
	it('does not let a tool row name its run: a not_available answer stored under the next run stays in its turn', () => {
		const turns = turnsFromMessages(
			[
				user('u-1', 'r-1', 'Ask me'),
				assistant('a-1', 'r-1', {
					toolCalls: [
						{
							id: 'c-1',
							type: 'function',
							function: { name: 'ask_user_question', arguments: '{}' },
						},
					],
				}),
				// P4: stored under the new run's id and seq, before that run's user message.
				{
					messageId: 't-1',
					runId: 'r-2',
					role: 'tool',
					body: {
						id: 't-1',
						role: 'tool',
						toolCallId: 'c-1',
						content: 'This tool is not available here.',
						error: 'unavailable',
					},
					status: 'complete',
				},
				user('u-2', 'r-2', 'Again'),
				assistant('a-2', 'r-2', { content: 'Sure.' }),
			],
			[runRow({ id: 'r-1', startedAt: at(0) }), runRow({ id: 'r-2', startedAt: at(1) })],
		)
		expect(turns.map(({ id }) => id)).toEqual(['u-1', 'turn-r-1', 'u-2', 'turn-r-2'])
		expect(turns[1].turn.runs.map(run => run.runId)).toEqual(['r-1'])
		expect(turns[1].turn.parts[0]).toMatchObject({ kind: 'tool', status: 'error' })
		expect(turns[3].turn.runs.map(run => run.runId)).toEqual(['r-2'])
	})
	it('marks a call without a result by how its last run ended', () => {
		const rows = [
			user('u-1', 'r-1', 'Go'),
			assistant('a-1', 'r-1', {
				toolCalls: [{ id: 'c-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
			}),
		]
		const status = (over: Partial<TurnRunRow>) =>
			turnsFromMessages(rows, [runRow({ id: 'r-1', ...over })])[1].turn.parts[0]
		expect(status({})).toMatchObject({ status: 'waiting' })
		expect(
			status({ status: 'interrupted', outcome: { type: 'interrupt', interrupts: [] } }),
		).toMatchObject({ status: 'waiting' })
		expect(status({ status: 'running' })).toMatchObject({ status: 'running' })
		expect(status({ status: 'cancelled' })).toMatchObject({ status: 'stopped' })
		expect(status({ status: 'failed', error: { message: 'Boom.' } })).toMatchObject({
			status: 'stopped',
		})
		expect(status({ status: 'truncated' })).toMatchObject({ status: 'stopped' })
	})

	// Plan call P10 (decision 62): a run the agent never started continues nothing; its error still shows.
	describe('a run refused before its stream', () => {
		const rows = [
			user('u-1', 'r-1', 'Delete it'),
			assistant('a-1', 'r-1', {
				toolCalls: [
					{ id: 'call-1', type: 'function', function: { name: 'delete_file', arguments: '{}' } },
				],
			}),
		]
		const interruptedRun = runRow({
			id: 'r-1',
			status: 'interrupted',
			outcome: { type: 'interrupt', interrupts: [APPROVAL] },
			startedAt: at(0),
		})
		const refused = runRow({
			id: 'r-2',
			status: 'failed',
			outcome: null,
			error: {
				code: 'provider_unreachable',
				message: 'The agent is restarting, try again.',
				beforeStream: true,
			},
			startedAt: at(5),
		})

		it('leaves the turn’s interrupts and its waiting calls as the run before it left them', () => {
			const [, turn] = turnsFromMessages(rows, [interruptedRun, refused])
			expect(turn.turn.interrupts).toEqual([APPROVAL])
			expect(turn.turn.parts).toEqual([
				{ kind: 'tool', toolCallId: 'call-1', name: 'delete_file', args: '{}', status: 'waiting' },
			])
		})

		it('still shows the refused run in the turn’s runs, with its error and without the store’s flag', () => {
			const [, turn] = turnsFromMessages(rows, [interruptedRun, refused])
			expect(turn.turn.runs).toEqual([
				{ runId: 'r-1', outcome: 'interrupt' },
				{
					runId: 'r-2',
					outcome: 'error',
					error: { code: 'provider_unreachable', message: 'The agent is restarting, try again.' },
				},
			])
		})

		it('ends the turn when the run failed in its stream instead: no interrupt, the call stopped', () => {
			const inStream = runRow({
				...refused,
				error: { code: 'agent_error', message: 'Boom.' },
			})
			const [, turn] = turnsFromMessages(rows, [interruptedRun, inStream])
			expect(turn.turn.interrupts).toEqual([])
			expect(turn.turn.parts[0]).toMatchObject({ status: 'stopped' })
		})

		it('stops the calls when the last run the agent started was cancelled, as the live turn does', () => {
			const cancelled = runRow({
				id: 'r-2',
				status: 'cancelled',
				outcome: { type: 'cancelled' },
				startedAt: at(3),
			})
			const later = runRow({ ...refused, id: 'r-3', startedAt: at(6) })
			const [, turn] = turnsFromMessages(rows, [interruptedRun, cancelled, later])
			expect(turn.turn.interrupts).toEqual([])
			expect(turn.turn.parts[0]).toMatchObject({ status: 'stopped' })
			const resumedLive = [
				hubRun('run-2'),
				ev('RUN_FINISHED', { threadId: THREAD, runId: 'run-2', outcome: { type: 'cancelled' } }),
			].reduce(
				applyAgUiEvent,
				live([
					ev('TOOL_CALL_START', { toolCallId: 'call-1', toolCallName: 'delete_file' }),
					ev('TOOL_CALL_ARGS', { toolCallId: 'call-1', delta: '{}' }),
					ev('TOOL_CALL_END', { toolCallId: 'call-1' }),
					finished({ type: 'interrupt', interrupts: [APPROVAL] }),
				]),
			)
			expect(resumedLive.parts).toEqual(turn.turn.parts)
			expect(resumedLive.interrupts).toEqual([])
		})

		it('carries no interrupts on a turn whose only runs were refused', () => {
			const turns = turnsFromMessages(
				[user('u-1', 'r-1', 'Hi')],
				[runRow({ ...refused, id: 'r-1', startedAt: at(0) })],
			)
			expect(turns[1].turn).toMatchObject({
				interrupts: [],
				runs: [{ runId: 'r-1', outcome: 'error' }],
			})
		})
	})

	// The owner, 2026-10-15 ("record everything that happens in the chat"): each answering run's `resume` (decision 62),
	// read over the interrupts of the run it continued (plan call P10).
	describe('the answers its runs sent', () => {
		const gate = { ...APPROVAL, responseSchema: APPROVAL_SCHEMA }
		const rows = [
			user('u-1', 'r-1', 'Delete it'),
			assistant('a-1', 'r-1', {
				toolCalls: [
					{ id: 'call-1', type: 'function', function: { name: 'delete_file', arguments: '{}' } },
				],
			}),
		]
		const interrupted = (interrupts: unknown[]) =>
			runRow({
				id: 'r-1',
				status: 'interrupted',
				outcome: { type: 'interrupt', interrupts },
				startedAt: at(0),
			})
		const answering = (resume: unknown, over: Partial<TurnRunRow> = {}) =>
			runRow({ id: 'r-2', startedAt: at(1), resume, ...over })
		const turnOf = (runs: TurnRunRow[], messages: TurnMessageRow[] = rows) =>
			turnsFromMessages(messages, runs)[1].turn
		const approved = { interruptId: gate.id, status: 'resolved', payload: { approved: true } }

		it('puts an approval’s decision on its call: approved, rejected or cancelled', () => {
			const decided = (entry: unknown) => turnOf([interrupted([gate]), answering([entry])])
			expect(decided(approved).parts[0]).toMatchObject({ decision: 'approved' })
			expect(
				decided({ interruptId: gate.id, status: 'resolved', payload: { approved: false } })
					.parts[0],
			).toMatchObject({ decision: 'rejected' })
			const dismissed = decided({ interruptId: gate.id, status: 'cancelled' })
			expect(dismissed.parts[0]).toMatchObject({ decision: 'cancelled' })
			expect(dismissed.answered).toEqual([])
		})

		it('records a form, a confirmation and an approval of a call the turn does not hold, in the order sent', () => {
			const turn = turnOf([
				interrupted([FORM, CONFIRM, UNBOUND]),
				answering([
					{ interruptId: FORM.id, status: 'resolved', payload: { region: 'EU' } },
					{ interruptId: CONFIRM.id, status: 'resolved', payload: true },
					{ interruptId: UNBOUND.id, status: 'resolved', payload: { approved: true } },
				]),
			])
			expect(turn.answered).toEqual([
				{ interrupt: FORM, status: 'resolved', payload: { region: 'EU' } },
				{ interrupt: CONFIRM, status: 'resolved', payload: true },
				{ interrupt: UNBOUND, status: 'resolved', payload: { approved: true } },
			])
			expect(turn.parts[0]).not.toHaveProperty('decision')
		})

		it('records nothing for a run refused before its stream, and the next run answers what it left open', () => {
			const refused = answering([approved], {
				status: 'failed',
				outcome: null,
				error: { code: 'provider_unreachable', message: '', beforeStream: true },
			})
			const left = turnOf([interrupted([gate, FORM]), refused])
			expect(left.parts[0]).not.toHaveProperty('decision')
			expect(left.answered).toEqual([])
			expect(left.interrupts).toEqual([gate, FORM])
			const retried = turnOf([
				interrupted([gate]),
				refused,
				runRow({
					id: 'r-3',
					startedAt: at(2),
					resume: [{ interruptId: gate.id, status: 'resolved', payload: { approved: false } }],
				}),
			])
			expect(retried.parts[0]).toMatchObject({ decision: 'rejected' })
		})

		it('ignores an answer to an interrupt the continued run does not hold, and a resume that is no list', () => {
			const turn = turnOf([
				interrupted([gate]),
				answering([
					{ interruptId: 'int-gone', status: 'cancelled' },
					{ interruptId: gate.id, status: 'cancelled' },
				]),
			])
			expect(turn.answered).toEqual([])
			expect(turn.parts[0]).toMatchObject({ decision: 'cancelled' })
			const unread = turnOf([interrupted([gate]), answering({ interruptId: gate.id })])
			expect(unread.parts[0]).not.toHaveProperty('decision')
			// Answers after a run that did not end on an interrupt answered nothing.
			const after = turnOf([runRow({ id: 'r-1', startedAt: at(0) }), answering([approved])])
			expect(after.parts[0]).not.toHaveProperty('decision')
		})

		it('reads each answering run against the run it continued: two in one turn', () => {
			const second = { ...gate, id: 'int-2', toolCallId: 'call-2' }
			const turn = turnOf(
				[
					interrupted([gate, FORM]),
					answering(
						[approved, { interruptId: FORM.id, status: 'resolved', payload: { region: 'EU' } }],
						{
							status: 'interrupted',
							outcome: { type: 'interrupt', interrupts: [second, CONFIRM] },
						},
					),
					runRow({
						id: 'r-3',
						startedAt: at(2),
						resume: [
							{ interruptId: second.id, status: 'cancelled' },
							{ interruptId: CONFIRM.id, status: 'resolved', payload: false },
						],
					}),
				],
				[
					...rows,
					assistant('a-2', 'r-2', {
						toolCalls: [
							{
								id: 'call-2',
								type: 'function',
								function: { name: 'delete_file', arguments: '{}' },
							},
						],
					}),
				],
			)
			expect(turn.parts.map(part => (part.kind === 'tool' ? part.decision : part.kind))).toEqual([
				'approved',
				'cancelled',
			])
			expect(turn.answered).toEqual([
				{ interrupt: FORM, status: 'resolved', payload: { region: 'EU' } },
				{ interrupt: CONFIRM, status: 'resolved', payload: false },
			])
			expect(turn.interrupts).toEqual([])
		})
	})
})

describe('contentText and turnText', () => {
	it('read a string or the text parts of a content list', () => {
		expect(contentText('plain')).toBe('plain')
		expect(
			contentText([
				{ type: 'text', text: 'a' },
				{ type: 'image', source: { type: 'url', value: 'https://x/y.png' } },
				{ type: 'text', text: 'b' },
			] as never),
		).toBe('ab')
		expect(contentText(undefined)).toBe('')
	})
	it('joins a turn’s non-empty text parts with a blank line', () => {
		const turn = live([
			...reasoning('rs-1', 'Hidden'),
			...text('m-1', 'One'),
			...text('m-2', 'Two'),
		])
		expect(turnText(turn)).toBe('One\n\nTwo')
	})
})
