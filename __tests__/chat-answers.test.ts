import type { Interrupt, Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { anyOpen, checkAnswers, openItemsOf, type OpenItems } from '@/lib/chat/answers'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { REJECTED_REASON } from '@/lib/chat/interrupt-answers'
import {
	INVALID_QUESTION_CONTENT,
	INVALID_QUESTION_ERROR,
	type RunStatus,
} from '@/lib/chat/statuses'

const NOW = new Date('2026-10-14T12:00:00Z')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Pydantic AI 2.56's approval, as the spike recorded it (agui-spike.md, Findings › Agent side; `_interrupt.py`). */
const approval: Interrupt = {
	id: 'int-call-1',
	reason: 'tool_call',
	toolCallId: 'call-1',
	message: 'Approve delete_file({"path":"/tmp/report.txt"})?',
	responseSchema: {
		type: 'object',
		properties: {
			approved: { type: 'boolean' },
			editedArgs: { type: 'object' },
			reason: { type: 'string' },
		},
		required: ['approved'],
	},
}
/** No responseSchema on a reason that is not a confirmation: Cancel is the only answer (P8). */
const freeText: Interrupt = { id: 'int-2', reason: 'input_required', message: 'Which region?' }
/** A confirmation without a schema: Yes and No send a bare boolean (P6). */
const confirm: Interrupt = { id: 'int-4', reason: 'confirmation', message: 'Send it now?' }
/** AG-UI Concepts › Interrupts, the quarterly filing example (a flat schema, P7). */
const filing: Interrupt = {
	id: 'int-form',
	reason: 'input_required',
	message: 'Please provide the quarterly filing details.',
	responseSchema: {
		type: 'object',
		properties: {
			quarter: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
			year: { type: 'integer', minimum: 2000 },
			revenue: { type: 'number' },
		},
		required: ['quarter', 'year', 'revenue'],
	},
	expiresAt: '2026-10-20T17:00:00Z',
}
const expired: Interrupt = {
	id: 'int-3',
	reason: 'confirmation',
	expiresAt: '2026-10-14T11:00:00Z',
}
const run = (status: RunStatus, outcome: unknown) => ({
	id: 'r1',
	status,
	outcome,
	error: null,
	custom: [],
	startedAt: NOW,
	finishedAt: NOW,
})

const user: Message = { id: 'u1', role: 'user', content: 'Plan my trip' }
const callTo = (id: string, name: string, args: string): Message => ({
	id: `a-${id}`,
	role: 'assistant',
	toolCalls: [{ id, type: 'function', function: { name, arguments: args } }],
})
const answer = (toolCallId: string): Message => ({
	id: `t-${toolCallId}`,
	role: 'tool',
	toolCallId,
	content: 'Q: Which city?\nA: Paris',
})
const CITY = JSON.stringify({
	questions: [{ question: 'Which city?', options: ['Paris', 'Rome'] }],
})
const DATES = JSON.stringify({ questions: [{ question: 'Which dates?', allow_custom: true }] })
const NOTHING: OpenItems = { interrupts: [], questions: [] }

// Spec §3.3, §4.3 step 1, decision 62: the continued run's open interrupts, and the open ask_user calls.
describe('openItemsOf', () => {
	it('reads the interrupts of an interrupted continued run', () => {
		expect(
			openItemsOf(
				run('interrupted', { type: 'interrupt', interrupts: [approval, freeText] }),
				[],
				[],
			),
		).toEqual({ interrupts: [approval, freeText], questions: [] })
	})
	it('has nothing open without a run, after any other end, or for an outcome it cannot read', () => {
		expect(openItemsOf(null, [], [])).toEqual(NOTHING)
		expect(openItemsOf(run('succeeded', { type: 'success' }), [], [])).toEqual(NOTHING)
		expect(openItemsOf(run('interrupted', null), [], [])).toEqual(NOTHING)
		expect(
			openItemsOf(run('interrupted', { type: 'interrupt', interrupts: 'no' }), [], []),
		).toEqual(NOTHING)
	})
	// @ag-ui/core's own InterruptSchema reads each stored interrupt; one it refuses is left out.
	it('leaves out a stored interrupt the protocol schema refuses', () => {
		expect(
			openItemsOf(
				run('interrupted', { type: 'interrupt', interrupts: [{ id: 7 }, approval] }),
				[],
				[],
			),
		).toEqual({ interrupts: [approval], questions: [] })
	})

	// AG-UI "Tool calls" › Frontend tools: the consumer derives the pending calls, "every tool call the run started that
	// received no result".
	it('lists the unanswered ask_user calls while the tool is advertised, in order, with their arguments read', () => {
		const thread = [
			user,
			callTo('q0', ASK_USER_TOOL_NAME, CITY),
			answer('q0'),
			callTo('q1', ASK_USER_TOOL_NAME, CITY),
			callTo('c1', 'search', '{}'),
			callTo('q2', ASK_USER_TOOL_NAME, DATES),
		]
		expect(openItemsOf(run('succeeded', { type: 'success' }), thread, ['ask_user'])).toEqual({
			interrupts: [],
			questions: [
				{
					toolCallId: 'q1',
					args: {
						questions: [
							{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: true },
						],
					},
				},
				{
					toolCallId: 'q2',
					args: { questions: [{ question: 'Which dates?', options: [], allow_custom: true }] },
				},
			],
		})
	})

	// Plan call P3: the arguments are untrusted; a call that fails the schema stays open, with nothing to ask.
	it('keeps a call whose arguments fail the schema open, without arguments', () => {
		const thread = [
			callTo('q1', ASK_USER_TOOL_NAME, '{"questions":[]}'),
			callTo('q2', ASK_USER_TOOL_NAME, '{"questions":'),
		]
		expect(openItemsOf(null, thread, ['ask_user']).questions).toEqual([
			{ toolCallId: 'q1', args: null },
			{ toolCallId: 'q2', args: null },
		])
	})

	// Decision 62's fourth answer: a pending call follows the app's switch now.
	it('opens no question while the app does not advertise ask_user', () => {
		expect(openItemsOf(null, [callTo('q1', ASK_USER_TOOL_NAME, CITY)], [])).toEqual(NOTHING)
	})

	it('reads an approval and a question that one run left open together', () => {
		const open = openItemsOf(
			run('interrupted', { type: 'interrupt', interrupts: [approval] }),
			[user, callTo('call-1', 'delete_file', '{}'), callTo('q1', ASK_USER_TOOL_NAME, CITY)],
			['ask_user'],
		)
		expect(open.interrupts).toEqual([approval])
		expect(open.questions.map(question => question.toolCallId)).toEqual(['q1'])
		expect(anyOpen(open)).toBe(true)
	})
})

describe('anyOpen', () => {
	it('is true while an interrupt or a question is open', () => {
		expect(anyOpen(NOTHING)).toBe(false)
		expect(anyOpen({ interrupts: [confirm], questions: [] })).toBe(true)
		expect(anyOpen({ interrupts: [], questions: [{ toolCallId: 'q1', args: null }] })).toBe(true)
	})
})

describe('checkAnswers: interrupts', () => {
	const open: OpenItems = { interrupts: [approval, freeText], questions: [] }

	it('builds one resume entry per open interrupt, in the interrupts’ order', () => {
		expect(
			checkAnswers(
				open,
				{
					resume: [
						{ interruptId: 'int-2', status: 'cancelled', payload: { ignored: true } },
						{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
					],
				},
				NOW,
			),
		).toEqual({
			ok: true,
			// buildResumeArray drops a cancelled entry's payload (@ag-ui/client src/interrupts/index.ts).
			resume: [
				{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'cancelled' },
			],
			toolMessages: [],
		})
	})

	it.each([
		['an open interrupt left unanswered', [{ interruptId: 'int-call-1', status: 'cancelled' }]],
		[
			'an interrupt that is not open',
			[
				{ interruptId: 'int-call-1', status: 'cancelled' },
				{ interruptId: 'int-2', status: 'cancelled' },
				{ interruptId: 'int-9', status: 'cancelled' },
			],
		],
		[
			'one interrupt answered twice',
			[
				{ interruptId: 'int-call-1', status: 'cancelled' },
				{ interruptId: 'int-call-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'cancelled' },
			],
		],
	] as const)('refuses %s', (_case, resume) => {
		expect(checkAnswers(open, { resume: [...resume] }, NOW)).toEqual({ ok: false })
	})

	// "An interrupt past its expiresAt … answers it cancelled" (spec §6.1); AG-UI: it "can no longer be answered".
	it('takes an expired interrupt only as cancelled', () => {
		const withExpired: OpenItems = { interrupts: [expired], questions: [] }
		expect(
			checkAnswers(
				withExpired,
				{ resume: [{ interruptId: 'int-3', status: 'resolved', payload: true }] },
				NOW,
			),
		).toEqual({ ok: false })
		expect(
			checkAnswers(withExpired, { resume: [{ interruptId: 'int-3', status: 'cancelled' }] }, NOW),
		).toEqual({
			ok: true,
			resume: [{ interruptId: 'int-3', status: 'cancelled' }],
			toolMessages: [],
		})
	})

	it('refuses answers to a conversation with nothing open', () => {
		expect(checkAnswers(NOTHING, { resume: [] }, NOW)).toEqual({ ok: false })
		expect(checkAnswers(NOTHING, {}, NOW)).toEqual({ ok: false })
		expect(
			checkAnswers(NOTHING, { toolResults: [{ toolCallId: 'q1', content: 'Q: x\nA: y' }] }, NOW),
		).toEqual({ ok: false })
	})
})

// Plan calls P5–P8: a resolved payload must be one the hub's cards build ("Clients should validate before submitting",
// AG-UI Concepts › Interrupts, contract rule 6).
describe('checkAnswers: payloads', () => {
	const resolved = (interrupt: Interrupt, payload?: Record<string, unknown> | boolean) =>
		checkAnswers(
			{ interrupts: [interrupt], questions: [] },
			{ resume: [{ interruptId: interrupt.id, status: 'resolved', payload }] },
			NOW,
		).ok

	it.each([
		['Approve, in the schema’s own terms', approval, { approved: true }],
		[
			'Reject, with the reason the schema declares',
			approval,
			{ approved: false, reason: REJECTED_REASON },
		],
		['Yes to a confirmation', confirm, true],
		['No to a confirmation', confirm, false],
		['a filled flat form', filing, { quarter: 'Q1', year: 2026, revenue: 4_200_000 }],
	] as const)('takes %s', (_case, interrupt, payload) => {
		expect(resolved(interrupt, payload)).toBe(true)
	})

	it.each([
		['an approval without a payload', approval, undefined],
		['an approval whose value is not a boolean', approval, { approved: 'yes' }],
		['an approval with edited arguments', approval, { approved: true, editedArgs: { path: '/' } }],
		['a rejection without the reason the schema declares', approval, { approved: false }],
		['a confirmation answered with an object', confirm, { approved: true }],
		['a confirmation without a payload', confirm, undefined],
		['a form without a required field', filing, { quarter: 'Q1', year: 2026 }],
		['a form value outside its enum', filing, { quarter: 'Q5', year: 2026, revenue: 1 }],
		['a form value below its minimum', filing, { quarter: 'Q1', year: 1999, revenue: 1 }],
		[
			'a form key the schema does not declare',
			filing,
			{ quarter: 'Q1', year: 2026, revenue: 1, x: 1 },
		],
		['an answer to an interrupt that only Cancel answers', freeText, { region: 'eu' }],
	] as const)('refuses %s', (_case, interrupt, payload) => {
		expect(resolved(interrupt, payload)).toBe(false)
	})

	it('takes any interrupt as cancelled', () => {
		const open: OpenItems = { interrupts: [approval, freeText, confirm, filing], questions: [] }
		const result = checkAnswers(
			open,
			{
				resume: open.interrupts.map(({ id }) => ({
					interruptId: id,
					status: 'cancelled' as const,
				})),
			},
			NOW,
		)
		expect(result.ok).toBe(true)
	})
})

// Spec §6.2, plan call P3: the answers to the open ask_user calls become tool messages.
describe('checkAnswers: questions', () => {
	const city = { questions: [{ question: 'Which city?', options: ['Paris'], allow_custom: true }] }
	const open: OpenItems = {
		interrupts: [],
		questions: [
			{ toolCallId: 'q1', args: city },
			{ toolCallId: 'q2', args: null },
		],
	}

	it('answers each open question in the questions’ order; an invalid one with the hub’s error', () => {
		expect(
			checkAnswers(
				open,
				{
					toolResults: [
						{ toolCallId: 'q2', content: 'anything' },
						{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' },
					],
				},
				NOW,
			),
		).toEqual({
			ok: true,
			resume: [],
			toolMessages: [
				{
					id: expect.stringMatching(UUID),
					role: 'tool',
					toolCallId: 'q1',
					content: 'Q: Which city?\nA: Paris',
				},
				{
					id: expect.stringMatching(UUID),
					role: 'tool',
					toolCallId: 'q2',
					content: INVALID_QUESTION_CONTENT,
					error: INVALID_QUESTION_ERROR,
				},
			],
		})
	})

	it.each([
		['an open question left unanswered', { toolResults: [{ toolCallId: 'q1', content: 'A' }] }],
		[
			'a call that is not open',
			{
				toolResults: [
					{ toolCallId: 'q1', content: 'A' },
					{ toolCallId: 'q2', content: '' },
					{ toolCallId: 'q9', content: 'A' },
				],
			},
		],
		[
			'one call answered twice',
			{
				toolResults: [
					{ toolCallId: 'q1', content: 'A' },
					{ toolCallId: 'q1', content: 'B' },
				],
			},
		],
		[
			'a resume entry while no interrupt is open',
			{
				resume: [{ interruptId: 'int-1', status: 'cancelled' as const }],
				toolResults: [
					{ toolCallId: 'q1', content: 'A' },
					{ toolCallId: 'q2', content: '' },
				],
			},
		],
	])('refuses %s', (_case, answers) => {
		expect(checkAnswers(open, answers, NOW)).toEqual({ ok: false })
	})
})

// Spec §6: one run can stop on an approval and leave a question; one answer body covers both.
describe('checkAnswers: an approval and a question together', () => {
	const open: OpenItems = {
		interrupts: [approval],
		questions: [{ toolCallId: 'q1', args: null }],
	}
	const approve = {
		interruptId: 'int-call-1',
		status: 'resolved' as const,
		payload: { approved: true },
	}
	const dismiss = { toolCallId: 'q1', content: '' }

	it('takes both answers at once', () => {
		const result = checkAnswers(open, { resume: [approve], toolResults: [dismiss] }, NOW)
		expect(result).toMatchObject({
			ok: true,
			resume: [approve],
			toolMessages: [{ role: 'tool', toolCallId: 'q1', error: INVALID_QUESTION_ERROR }],
		})
	})

	it('refuses either answer alone', () => {
		expect(checkAnswers(open, { resume: [approve] }, NOW)).toEqual({ ok: false })
		expect(checkAnswers(open, { toolResults: [dismiss] }, NOW)).toEqual({ ok: false })
	})
})
