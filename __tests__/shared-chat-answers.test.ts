import type { Interrupt } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import {
	answersBody,
	decide,
	draftCovers,
	EMPTY_DRAFT,
	nextExpiry,
	withAnswer,
	withoutAnswer,
	withToolAnswers,
	type AnswerDraft,
	type ItemAnswer,
} from '@/components/shared-chat/answers'
import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import { NO_OPEN_ITEMS, type TurnOpenItems } from '@/lib/chat/open-items'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
import { emptyAssistantTurn, type ToolPart, type Turn } from '@/lib/chat/turn'

const approval: Interrupt = { id: 'int-1', reason: 'tool_call', toolCallId: 'c1' }
const form: Interrupt = { id: 'int-2', reason: 'input_required', message: 'Which region?' }
const question = (
	toolCallId: string,
	args = JSON.stringify({ questions: [{ question: 'Which city?' }] }),
): ToolPart => ({ kind: 'tool', toolCallId, name: ASK_USER_TOOL_NAME, args, status: 'waiting' })

/** Two interrupts and one question: the open items of one turn, in their order. */
const open: TurnOpenItems = { interrupts: [approval, form], questions: [question('q1')] }

const approve: ItemAnswer = {
	kind: 'resume',
	interruptId: 'int-1',
	status: 'resolved',
	payload: { approved: true },
}
const region: ItemAnswer = {
	kind: 'resume',
	interruptId: 'int-2',
	status: 'resolved',
	payload: { region: 'eu' },
}
const city: ItemAnswer = { kind: 'tool', toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' }

/** The draft after these decisions, in order. */
const draftOf = (...answers: ItemAnswer[]): AnswerDraft => answers.reduce(withAnswer, EMPTY_DRAFT)

/** The time the decisions are judged at (P14), and an approval that expired a minute before it. */
const NOW = new Date('2026-10-14T12:00:00Z')
const expired: Interrupt = { ...approval, expiresAt: '2026-10-14T11:59:00Z' }
const dismiss: ItemAnswer = { kind: 'resume', interruptId: 'int-1', status: 'cancelled' }

describe('the draft (plan call P13)', () => {
	it('keeps each decision under its item id, without its kind', () => {
		expect(draftOf(approve, city)).toEqual({
			resume: {
				'int-1': { interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
			},
			tools: { q1: { toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' } },
		})
	})
	it('replaces a decision for the same item, and leaves the draft it was given as it was', () => {
		const first = draftOf(approve)
		const changed = withAnswer(first, { kind: 'resume', interruptId: 'int-1', status: 'cancelled' })
		expect(changed.resume['int-1']).toEqual({ interruptId: 'int-1', status: 'cancelled' })
		expect(first.resume['int-1']?.status).toBe('resolved')
		expect(EMPTY_DRAFT).toEqual({ resume: {}, tools: {} })
	})
	it('forgets the decision for an interrupt id or a tool-call id ("Change")', () => {
		const full = draftOf(approve, region, city)
		expect(Object.keys(withoutAnswer(full, 'int-1').resume)).toEqual(['int-2'])
		expect(withoutAnswer(full, 'q1').tools).toEqual({})
		expect(withoutAnswer(full, 'unknown')).toEqual(full)
	})
})

describe('draftCovers and answersBody', () => {
	it('covers the open items only once each has a decision', () => {
		expect(draftCovers(open, draftOf(approve, city))).toBe(false)
		expect(draftCovers(open, draftOf(approve, region, city))).toBe(true)
		expect(draftCovers(NO_OPEN_ITEMS, draftOf(approve))).toBe(false)
	})
	it('does not take a key every object has for a decision', () => {
		const odd: TurnOpenItems = {
			interrupts: [{ id: 'toString', reason: 'confirmation' }],
			questions: [],
		}
		expect(draftCovers(odd, EMPTY_DRAFT)).toBe(false)
		expect(answersBody(odd, EMPTY_DRAFT)).toEqual({})
	})
	it('counts a resolved decision for an interrupt expired at now as missing, a cancelled one as given (P14)', () => {
		const late: TurnOpenItems = { interrupts: [expired, form], questions: [] }
		expect(draftCovers(late, draftOf(approve, region), NOW)).toBe(false)
		expect(answersBody(late, draftOf(approve, region), NOW)).toEqual({
			resume: [{ interruptId: 'int-2', status: 'resolved', payload: { region: 'eu' } }],
		})
		expect(draftCovers(late, draftOf(dismiss, region), NOW)).toBe(true)
		// Without a time, the decision stands as it was recorded.
		expect(draftCovers(late, draftOf(approve, region))).toBe(true)
	})
	it("builds the body in the open items' order, for open items only, without an empty list", () => {
		const stale: ItemAnswer = { kind: 'resume', interruptId: 'int-0', status: 'cancelled' }
		expect(answersBody(open, draftOf(city, region, stale, approve))).toEqual({
			resume: [
				{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } },
				{ interruptId: 'int-2', status: 'resolved', payload: { region: 'eu' } },
			],
			toolResults: [{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' }],
		})
		const onlyQuestions: TurnOpenItems = { interrupts: [], questions: [question('q1')] }
		expect(answersBody(onlyQuestions, draftOf(city))).toEqual({
			toolResults: [{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' }],
		})
	})
})

describe('decide (decision 62: the answers go when the last open item has one)', () => {
	it('keeps a decision while another item is open', () => {
		expect(
			decide({ open, draft: EMPTY_DRAFT, answer: approve, isRequesting: false, now: NOW }),
		).toEqual({
			action: 'keep',
			draft: draftOf(approve),
		})
	})
	it('sends everything with the last decision', () => {
		expect(
			decide({
				open,
				draft: draftOf(approve, city),
				answer: region,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({ action: 'send', body: answersBody(open, draftOf(approve, city, region)) })
	})
	it('sends at once when one item is open', () => {
		const one: TurnOpenItems = { interrupts: [approval], questions: [] }
		expect(
			decide({ open: one, draft: EMPTY_DRAFT, answer: approve, isRequesting: false, now: NOW }),
		).toEqual({
			action: 'send',
			body: {
				resume: [{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } }],
			},
		})
	})
	it('ignores a second call while the first one is requesting, so one decision never sends twice', () => {
		const one: TurnOpenItems = { interrupts: [approval], questions: [] }
		// The hook empties the draft before onReload; the request then runs.
		expect(
			decide({ open: one, draft: EMPTY_DRAFT, answer: approve, isRequesting: true, now: NOW }),
		).toEqual({
			action: 'ignore',
		})
	})
	it('keeps the last decision when a resolved one expired before it, and sends once that one is dismissed (P14)', () => {
		const late: TurnOpenItems = { interrupts: [expired, form], questions: [] }
		// Approved while it was open; the form's answer comes after the approval's expiry.
		expect(
			decide({
				open: late,
				draft: draftOf(approve),
				answer: region,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({ action: 'keep', draft: draftOf(approve, region) })
		// The card then offers only Dismiss, which answers it cancelled.
		expect(
			decide({
				open: late,
				draft: draftOf(approve, region),
				answer: dismiss,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({
			action: 'send',
			body: {
				resume: [
					{ interruptId: 'int-1', status: 'cancelled' },
					{ interruptId: 'int-2', status: 'resolved', payload: { region: 'eu' } },
				],
			},
		})
	})
	it('ignores a decision for an item that is not open', () => {
		const other: ItemAnswer = { kind: 'tool', toolCallId: 'q9', content: 'Q: x\nA: y' }
		expect(
			decide({ open, draft: EMPTY_DRAFT, answer: other, isRequesting: false, now: NOW }),
		).toEqual({
			action: 'ignore',
		})
		expect(
			decide({
				open: NO_OPEN_ITEMS,
				draft: EMPTY_DRAFT,
				answer: approve,
				isRequesting: false,
				now: NOW,
			}),
		).toEqual({ action: 'ignore' })
	})
})

describe('withToolAnswers (spec §6.2; plan calls P3, P11)', () => {
	const asked: Turn = {
		...emptyAssistantTurn(),
		parts: [
			{ kind: 'text', messageId: 'm1', text: 'One question first.' },
			question('q1'),
			question('q2', '{"questions":[]}'),
			question('q3'),
		],
		runs: [{ runId: 'r1', outcome: 'success' }],
	}
	it('marks an answered call done with its transcript, and a call with invalid arguments an error', () => {
		const merged = withToolAnswers(asked, [
			{ toolCallId: 'q1', content: 'Q: Which city?\nA: Paris' },
			{ toolCallId: 'q2', content: '' },
		])
		expect(merged.parts).toEqual([
			asked.parts[0],
			{ ...question('q1'), status: 'done', result: 'Q: Which city?\nA: Paris' },
			{ ...question('q2', '{"questions":[]}'), status: 'error', error: INVALID_QUESTION_CONTENT },
			question('q3'),
		])
		expect(merged.runs).toBe(asked.runs)
		expect(asked.parts[1]).toEqual(question('q1'))
	})
	it('gives back the same turn when there is nothing to merge', () => {
		expect(withToolAnswers(asked, [])).toBe(asked)
	})
})

describe('nextExpiry (plan call P14)', () => {
	const now = new Date('2026-10-14T12:00:00Z')
	const expiring = (id: string, expiresAt?: string): Interrupt => ({
		id,
		reason: 'confirmation',
		...(expiresAt === undefined ? {} : { expiresAt }),
	})
	it('answers the earliest expiry still ahead', () => {
		expect(
			nextExpiry(
				[
					expiring('a', '2026-10-14T12:05:00Z'),
					expiring('b', '2026-10-14T12:01:00Z'),
					expiring('c'),
				],
				now,
			),
		).toBe(Date.parse('2026-10-14T12:01:00Z'))
	})
	it('skips one that has expired (at or before now) and one that is not a date', () => {
		expect(
			nextExpiry(
				[
					expiring('a', '2026-10-14T11:00:00Z'),
					expiring('b', '2026-10-14T12:00:00Z'),
					expiring('c', 'tomorrow'),
				],
				now,
			),
		).toBeNull()
		expect(nextExpiry([], now)).toBeNull()
	})
})
