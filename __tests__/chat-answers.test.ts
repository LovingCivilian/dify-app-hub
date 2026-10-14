import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { checkAnswers, openItemsOf } from '@/lib/chat/answers'
import type { RunStatus } from '@/lib/chat/statuses'

const NOW = new Date('2026-10-14T12:00:00Z')
const approval: Interrupt = { id: 'int-1', reason: 'tool_call', toolCallId: 'call-1' }
const question: Interrupt = { id: 'int-2', reason: 'input_required', message: 'Which region?' }
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

// Spec §3.3, §4.3 step 1: the open items are the last run's open interrupts (2b adds the hub's own pending tool calls).
describe('openItemsOf', () => {
	it('reads the interrupts of an interrupted last run', () => {
		expect(
			openItemsOf(run('interrupted', { type: 'interrupt', interrupts: [approval, question] })),
		).toEqual({ interrupts: [approval, question] })
	})
	it('has nothing open without a run, after any other end, or for an outcome it cannot read', () => {
		expect(openItemsOf(null)).toEqual({ interrupts: [] })
		expect(openItemsOf(run('succeeded', { type: 'success' }))).toEqual({ interrupts: [] })
		expect(openItemsOf(run('interrupted', null))).toEqual({ interrupts: [] })
		expect(openItemsOf(run('interrupted', { type: 'interrupt', interrupts: 'no' }))).toEqual({
			interrupts: [],
		})
	})
	// @ag-ui/core's own InterruptSchema reads each stored interrupt; one it refuses is left out.
	it('leaves out a stored interrupt the protocol schema refuses', () => {
		expect(
			openItemsOf(run('interrupted', { type: 'interrupt', interrupts: [{ id: 7 }, approval] })),
		).toEqual({ interrupts: [approval] })
	})
})

describe('checkAnswers', () => {
	const open = { interrupts: [approval, question] }

	it('builds one resume entry per open interrupt, in the interrupts’ order', () => {
		expect(
			checkAnswers(
				open,
				{
					resume: [
						{ interruptId: 'int-2', status: 'cancelled', payload: { ignored: true } },
						{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
					],
				},
				NOW,
			),
		).toEqual({
			ok: true,
			// buildResumeArray drops a cancelled entry's payload (@ag-ui/client src/interrupts/index.ts).
			resume: [
				{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'cancelled' },
			],
			toolMessages: [],
		})
	})

	it.each([
		['an open interrupt left unanswered', [{ interruptId: 'int-1', status: 'resolved' }]],
		[
			'an interrupt that is not open',
			[
				{ interruptId: 'int-1', status: 'resolved' },
				{ interruptId: 'int-2', status: 'resolved' },
				{ interruptId: 'int-9', status: 'cancelled' },
			],
		],
		[
			'one interrupt answered twice',
			[
				{ interruptId: 'int-1', status: 'resolved' },
				{ interruptId: 'int-1', status: 'cancelled' },
				{ interruptId: 'int-2', status: 'resolved' },
			],
		],
	] as const)('refuses %s', (_case, resume) => {
		expect(checkAnswers(open, { resume: [...resume] }, NOW)).toEqual({ ok: false })
	})

	// "An interrupt past its expiresAt … answers it cancelled" (spec §6.1); @ag-ui/client refuses the same.
	it('takes an expired interrupt only as cancelled', () => {
		const withExpired = { interrupts: [expired] }
		expect(
			checkAnswers(withExpired, { resume: [{ interruptId: 'int-3', status: 'resolved' }] }, NOW),
		).toEqual({ ok: false })
		expect(
			checkAnswers(withExpired, { resume: [{ interruptId: 'int-3', status: 'cancelled' }] }, NOW),
		).toEqual({
			ok: true,
			resume: [{ interruptId: 'int-3', status: 'cancelled' }],
			toolMessages: [],
		})
	})

	// Plan call P4: 2a advertises no tool, so no tool call is open and any tool result names an unknown call.
	it('refuses tool results, and answers to a conversation with nothing open', () => {
		expect(
			checkAnswers(
				open,
				{
					resume: [
						{ interruptId: 'int-1', status: 'resolved' },
						{ interruptId: 'int-2', status: 'resolved' },
					],
					toolResults: [{ toolCallId: 'call-1', content: 'done' }],
				},
				NOW,
			),
		).toEqual({ ok: false })
		expect(checkAnswers({ interrupts: [] }, { resume: [] }, NOW)).toEqual({ ok: false })
		expect(checkAnswers({ interrupts: [] }, {}, NOW)).toEqual({ ok: false })
	})
})
