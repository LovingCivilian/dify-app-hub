import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { approvalPayload } from '@/lib/chat/interrupt-answers'
import {
	approvalDecisionOf,
	readResume,
	withSentAnswers,
	type SentAnswer,
} from '@/lib/chat/sent-answers'
import { emptyAssistantTurn, type ToolPart, type Turn } from '@/lib/chat/turn'

// Microsoft Agent Framework's field (spec §6.1): the interrupt's own schema names the approval's property.
const SCHEMA = {
	type: 'object',
	properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
	required: ['accepted'],
}
const approval: Interrupt = {
	id: 'int-1',
	reason: 'tool_call',
	toolCallId: 'call-1',
	responseSchema: SCHEMA,
}
/** An approval for a call the turn does not hold (plan call P8). */
const unbound: Interrupt = { id: 'int-2', reason: 'tool_call', toolCallId: 'call-x' }
const form: Interrupt = {
	id: 'int-3',
	reason: 'input_required',
	message: 'Which region?',
	responseSchema: {
		type: 'object',
		properties: { region: { type: 'string' } },
		required: ['region'],
	},
}
const confirm: Interrupt = { id: 'int-4', reason: 'confirmation', message: 'Proceed?' }

const call = (toolCallId: string): ToolPart => ({
	kind: 'tool',
	toolCallId,
	name: 'delete_file',
	args: '{"path":"a.txt"}',
	status: 'waiting',
})
/** The turn as the browser holds it when its run ended on four interrupts. */
const waiting: Turn = {
	...emptyAssistantTurn(),
	parts: [{ kind: 'text', messageId: 'm-1', text: 'May I?' }, call('call-1')],
	runs: [{ runId: 'r-1', outcome: 'interrupt' }],
	interrupts: [approval, unbound, form, confirm],
}

describe('readResume (a stored run’s `resume`, read with the tolerance of its outcome)', () => {
	it('reads the list the server stored, payloads as they were', () => {
		const stored = [
			{ interruptId: 'int-1', status: 'resolved', payload: { accepted: true } },
			{ interruptId: 'int-2', status: 'cancelled' },
			{ interruptId: 'int-4', status: 'resolved', payload: false },
		]
		expect(readResume(stored)).toEqual(stored)
	})

	it('reads anything that is not such a list as no answers', () => {
		const good = { interruptId: 'int-1', status: 'cancelled' }
		for (const value of [
			null,
			undefined,
			'resume',
			{ interruptId: 'int-1', status: 'cancelled' },
			[{ interruptId: 1, status: 'resolved' }],
			[{ interruptId: 'int-1', status: 'answered' }],
			[{ interruptId: 'int-1', status: 'resolved', payload: 'yes' }],
			[{ interruptId: 'int-1', status: 'resolved', payload: [true] }],
			[good, null],
		])
			expect(readResume(value)).toEqual([])
	})
})

describe('approvalDecisionOf (spec §6.1, plan call P5)', () => {
	it('reads the payload Approve built by the interrupt’s own schema key, anything else as a rejection', () => {
		const resolved = (payload: SentAnswer['payload']): SentAnswer => ({
			interruptId: approval.id,
			status: 'resolved',
			payload,
		})
		expect(
			approvalDecisionOf(approval, resolved(approvalPayload(approval.responseSchema, true))),
		).toBe('approved')
		expect(
			approvalDecisionOf(approval, resolved(approvalPayload(approval.responseSchema, false))),
		).toBe('rejected')
		// `approved` is not this schema's key, and a bare boolean is no approval payload.
		expect(approvalDecisionOf(approval, resolved({ approved: true }))).toBe('rejected')
		expect(approvalDecisionOf(approval, resolved(true))).toBe('rejected')
		// Without a schema the key is the spec's `approved`.
		expect(approvalDecisionOf(unbound, resolved({ approved: true }))).toBe('approved')
	})

	it('reads a cancelled entry as cancelled', () => {
		expect(approvalDecisionOf(approval, { status: 'cancelled' })).toBe('cancelled')
	})
})

describe('withSentAnswers (the answers that went, recorded in the turn they continue)', () => {
	const resume: SentAnswer[] = [
		{ interruptId: 'int-1', status: 'resolved', payload: { accepted: true } },
		{ interruptId: 'int-2', status: 'resolved', payload: { approved: false } },
		{ interruptId: 'int-3', status: 'resolved', payload: { region: 'EU' } },
		{ interruptId: 'int-4', status: 'cancelled' },
	]

	it('puts an approval’s decision on its call, and records every other answer in the order sent', () => {
		const turn = withSentAnswers(waiting, waiting.interrupts, resume)
		expect(turn.parts).toEqual([waiting.parts[0], { ...call('call-1'), decision: 'approved' }])
		expect(turn.answered).toEqual([
			{ interrupt: unbound, status: 'resolved', payload: { approved: false } },
			{ interrupt: form, status: 'resolved', payload: { region: 'EU' } },
			{ interrupt: confirm, status: 'cancelled' },
		])
		// The open items and the runs are not this function's.
		expect(turn.interrupts).toBe(waiting.interrupts)
		expect(turn.runs).toBe(waiting.runs)
	})

	it('reads a rejection and a dismissal of a bound approval', () => {
		const rejected = withSentAnswers(
			waiting,
			[approval],
			[{ interruptId: 'int-1', status: 'resolved', payload: { accepted: false, reason: 'No' } }],
		)
		expect(rejected.parts[1]).toMatchObject({ decision: 'rejected' })
		expect(rejected.answered).toEqual([])
		const dismissed = withSentAnswers(
			waiting,
			[approval],
			[{ interruptId: 'int-1', status: 'cancelled' }],
		)
		expect(dismissed.parts[1]).toMatchObject({ decision: 'cancelled' })
	})

	it('keeps what an earlier answer recorded and adds to it', () => {
		const first = withSentAnswers(waiting, [form], [resume[2]!])
		const second = withSentAnswers(first, [confirm], [resume[3]!])
		expect(second.answered.map(({ interrupt }) => interrupt.id)).toEqual(['int-3', 'int-4'])
	})

	it('ignores an answer to an interrupt that was not open, and an id like "toString"', () => {
		const turn = withSentAnswers(
			waiting,
			[approval],
			[
				{ interruptId: 'int-3', status: 'cancelled' },
				{ interruptId: 'toString', status: 'cancelled' },
			],
		)
		expect(turn.parts).toEqual(waiting.parts)
		expect(turn.answered).toEqual([])
	})

	it('answers the same turn when nothing was sent', () => {
		expect(withSentAnswers(waiting, waiting.interrupts, [])).toBe(waiting)
	})
})
