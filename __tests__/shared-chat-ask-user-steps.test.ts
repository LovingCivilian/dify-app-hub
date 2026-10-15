import { describe, expect, it } from 'vitest'

import {
	answerStep,
	canGoBack,
	canGoForward,
	dismissSteps,
	finishedCalls,
	optionIndexOfKey,
	questionSteps,
	SKIPPED,
	stepChoice,
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
		const one = answerStep([first, second], [], 0, picked('Rome'))
		expect(one).toEqual({ answers: [picked('Rome')], complete: null, next: 1 })
		const two = answerStep([first, second], one.answers, 1, picked('June'))
		expect(two.complete).toBeNull()
		const three = answerStep([first, second], two.answers, 2, SKIPPED)
		expect(three.complete).toEqual(finishedCalls([first, second], three.answers))
		expect(three.complete?.map(answer => answer.toolCallId)).toEqual(['c1', 'c2'])
	})
	it('replaces the answer of an earlier step and moves on to the first step without one', () => {
		const result = answerStep([first, second], [picked('Paris'), picked('May')], 0, picked('Rome'))
		expect(result).toEqual({ answers: [picked('Rome'), picked('May')], complete: null, next: 2 })
		// Skip replaces an answer too.
		expect(
			answerStep([first, second], [picked('Paris'), picked('May')], 1, SKIPPED).answers,
		).toEqual([picked('Paris'), SKIPPED])
	})
	it('refuses a step after the first one without an answer (answers stay a prefix)', () => {
		expect(() => answerStep([first, second], [picked('Paris')], 2, picked('Low'))).toThrow(
			RangeError,
		)
		expect(() => answerStep([first, second], [], -1, picked('Low'))).toThrow(RangeError)
	})
	it('skips the current step and every one after it on Dismiss, and hands every call over', () => {
		const result = dismissSteps([first, second], [picked('Paris')])
		expect(result.answers).toEqual([picked('Paris'), SKIPPED, SKIPPED])
		expect(result.next).toBe(3)
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

describe('canGoBack and canGoForward (going back to change an answer)', () => {
	it('goes back from every step but the first', () => {
		expect(canGoBack(0)).toBe(false)
		expect(canGoBack(1)).toBe(true)
		expect(canGoBack(2)).toBe(true)
	})
	it('goes forward only from a step that has an answer', () => {
		expect(canGoForward(0, [])).toBe(false)
		expect(canGoForward(0, [picked('Paris')])).toBe(true)
		expect(canGoForward(1, [picked('Paris')])).toBe(false)
		expect(canGoForward(0, [SKIPPED, picked('May')])).toBe(true)
		expect(canGoForward(1, [SKIPPED, picked('May')])).toBe(true)
	})
})

describe('stepChoice (what an answered step shows when the card returns to it)', () => {
	const city = questionsOf(first)[0]!
	const when = questionsOf(first)[1]!
	it('shows the option whose text is the answer', () => {
		expect(stepChoice(city, picked('Rome'))).toEqual({ option: 1, text: '' })
		expect(stepChoice(city, picked('Paris'))).toEqual({ option: 0, text: '' })
	})
	it('shows any other answer as free text (an exact match only picks an option)', () => {
		expect(stepChoice(when, picked('May'))).toEqual({ option: null, text: 'May' })
		expect(stepChoice(city, picked('paris'))).toEqual({ option: null, text: 'paris' })
	})
	it('shows nothing for a skipped step or one without an answer', () => {
		expect(stepChoice(city, SKIPPED)).toEqual({ option: null, text: '' })
		expect(stepChoice(city, undefined)).toEqual({ option: null, text: '' })
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
