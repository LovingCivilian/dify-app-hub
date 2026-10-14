import { describe, expect, it } from 'vitest'

import {
	answerStep,
	dismissSteps,
	finishedCalls,
	optionIndexOfKey,
	questionSteps,
	SKIPPED,
} from '@/components/shared-chat/ask-user-steps'
import { askUserTranscript, type AskUserAnswer } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

const call = (toolCallId: string, args: unknown): ToolPart => ({
	kind: 'tool',
	toolCallId,
	name: 'ask_user',
	args: typeof args === 'string' ? args : JSON.stringify(args),
	status: 'waiting',
})

const CITY = { question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: false }
const WHEN = { question: 'When?' }
const BUDGET = { question: 'What budget?', options: ['Low', 'High'] }
const first = call('c1', { questions: [CITY, WHEN] })
const second = call('c2', { questions: [BUDGET] })
const invalid = call('c3', '{"questions": []}')

const picked = (answer: string): AskUserAnswer => ({ answer, skipped: false })
/** A call's questions as its steps hold them (with the schema's defaults). */
const questionsOf = (part: ToolPart) => questionSteps([part]).map(step => step.question!)

describe('questionSteps (plan call P4)', () => {
	it("steps through every call's questions in call order, with the schema's defaults", () => {
		expect(questionSteps([first, second])).toEqual([
			{ toolCallId: 'c1', question: CITY },
			{ toolCallId: 'c1', question: { ...WHEN, options: [], allow_custom: true } },
			{ toolCallId: 'c2', question: { ...BUDGET, allow_custom: true } },
		])
	})
	it('gives a call with invalid arguments one step of its own (plan call P3)', () => {
		expect(questionSteps([invalid, second]).map(step => step.toolCallId)).toEqual(['c3', 'c2'])
		expect(questionSteps([invalid])).toEqual([{ toolCallId: 'c3', question: null }])
	})
})

describe('finishedCalls (plan call P3)', () => {
	it('answers a call only once every one of its questions has an answer', () => {
		expect(finishedCalls([first, second], [])).toEqual([])
		expect(finishedCalls([first, second], [picked('Paris')])).toEqual([])
		expect(finishedCalls([first, second], [picked('Paris'), SKIPPED])).toEqual([
			{
				toolCallId: 'c1',
				content: askUserTranscript(questionsOf(first), [picked('Paris'), SKIPPED]),
			},
		])
	})
	it("gives each call its own transcript, from that call's answers", () => {
		expect(finishedCalls([first, second], [picked('Paris'), picked('May'), picked('Low')])).toEqual(
			[
				{
					toolCallId: 'c1',
					content: askUserTranscript(questionsOf(first), [picked('Paris'), picked('May')]),
				},
				{ toolCallId: 'c2', content: askUserTranscript(questionsOf(second), [picked('Low')]) },
			],
		)
	})
	it('answers an invalid call with an empty content (the server writes its error)', () => {
		expect(finishedCalls([invalid, second], [SKIPPED])).toEqual([{ toolCallId: 'c3', content: '' }])
	})
})

describe('answerStep and dismissSteps (the template: every call is handed over at once)', () => {
	it('hands nothing over until the last step has an answer, then every call', () => {
		const one = answerStep([first, second], [], picked('Rome'))
		expect(one).toEqual({ answers: [picked('Rome')], complete: null })
		const two = answerStep([first, second], one.answers, picked('June'))
		expect(two.complete).toBeNull()
		const three = answerStep([first, second], two.answers, SKIPPED)
		expect(three.complete).toEqual(finishedCalls([first, second], three.answers))
		expect(three.complete?.map(answer => answer.toolCallId)).toEqual(['c1', 'c2'])
	})
	it('skips the current step and every one after it on Dismiss, and hands every call over', () => {
		const result = dismissSteps([first, second], [picked('Paris')])
		expect(result.answers).toEqual([picked('Paris'), SKIPPED, SKIPPED])
		expect(result.complete).toEqual([
			{
				toolCallId: 'c1',
				content: askUserTranscript(questionsOf(first), [picked('Paris'), SKIPPED]),
			},
			{ toolCallId: 'c2', content: askUserTranscript(questionsOf(second), [SKIPPED]) },
		])
		expect(result.complete?.[0]?.content).toContain('A: (skipped)')
	})
	it('dismisses an invalid call with the rest', () => {
		expect(dismissSteps([invalid, second], []).complete).toEqual([
			{ toolCallId: 'c3', content: '' },
			{ toolCallId: 'c2', content: askUserTranscript(questionsOf(second), [SKIPPED]) },
		])
	})
})

describe('optionIndexOfKey (the template: digit keys pick an option)', () => {
	it('picks the option under keys 1 to 9', () => {
		expect(optionIndexOfKey('1', 2)).toBe(0)
		expect(optionIndexOfKey('2', 2)).toBe(1)
		expect(optionIndexOfKey('9', 10)).toBe(8)
	})
	it('ignores another key, or a digit with no option under it', () => {
		for (const key of ['0', '3', 'a', 'Enter', ' ']) expect(optionIndexOfKey(key, 2)).toBeNull()
	})
})
