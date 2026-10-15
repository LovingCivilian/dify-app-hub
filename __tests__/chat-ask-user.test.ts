import { describe, expect, it } from 'vitest'

import {
	ASK_USER_ANSWER_MAX,
	ASK_USER_MAX_OPTIONS,
	ASK_USER_MAX_QUESTIONS,
	ASK_USER_OPTION_MAX,
	ASK_USER_QUESTION_MAX,
	ASK_USER_TOOL_NAME,
	askUserAnswersOf,
	askUserArgsSchema,
	askUserTranscript,
	NO_ANSWER,
	parseAskUserArgs,
	SKIPPED_ANSWER,
	type AskUserQuestion,
} from '@/lib/chat/ask-user'
import { ASK_USER_TOOL, hubToolDefinitions } from '@/lib/chat/hub-tools'
import { MESSAGE_TEXT_MAX } from '@/lib/chat/schemas'
import { INVALID_QUESTION_CONTENT, INVALID_QUESTION_ERROR } from '@/lib/chat/statuses'

const args = (value: unknown) => JSON.stringify(value)
const one = (question: Record<string, unknown>) => args({ questions: [question] })
const questions = (count: number) =>
	Array.from({ length: count }, (_, index) => ({ question: `Question ${index + 1}?` }))
const options = (count: number) =>
	Array.from({ length: count }, (_, index) => `Option ${index + 1}`)

// 2b's plan call P2: the template's names and limit, and the hub's bounds.
describe('the limits', () => {
	it('are 10 questions of 500 characters, 10 options of 200, and a free answer of 2,000', () => {
		expect(ASK_USER_TOOL_NAME).toBe('ask_user')
		expect([
			ASK_USER_MAX_QUESTIONS,
			ASK_USER_QUESTION_MAX,
			ASK_USER_MAX_OPTIONS,
			ASK_USER_OPTION_MAX,
			ASK_USER_ANSWER_MAX,
		]).toEqual([10, 500, 10, 200, 2000])
	})
})

describe('parseAskUserArgs (spec §6.2, P2)', () => {
	it('reads one question, with the template’s defaults: no options, a free answer allowed', () => {
		expect(parseAskUserArgs(one({ question: 'Which city?' }))).toEqual({
			questions: [{ question: 'Which city?', options: [], allow_custom: true }],
		})
	})
	it('trims the question and the options and keeps what is given', () => {
		expect(
			parseAskUserArgs(
				one({ question: '  Which city? ', options: [' Paris', 'Rome '], allow_custom: false }),
			),
		).toEqual({
			questions: [{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: false }],
		})
	})
	it('drops keys it does not know, at both levels', () => {
		expect(
			parseAskUserArgs(
				args({
					questions: [{ question: 'Which city?', header: 'City', multi_select: true }],
					note: 1,
				}),
			),
		).toEqual({ questions: [{ question: 'Which city?', options: [], allow_custom: true }] })
	})
	it('takes 10 questions and refuses 11, and refuses none', () => {
		expect(parseAskUserArgs(args({ questions: questions(10) }))?.questions).toHaveLength(10)
		expect(parseAskUserArgs(args({ questions: questions(11) }))).toBeNull()
		expect(parseAskUserArgs(args({ questions: [] }))).toBeNull()
	})
	// zod 4.6.5 counts code points, as JSON Schema's maxLength does: 500 emoji are 1,000 UTF-16 units.
	it('takes a question of 500 characters, counted as code points, and refuses 501', () => {
		expect(parseAskUserArgs(one({ question: 'q'.repeat(500) }))).not.toBeNull()
		expect(parseAskUserArgs(one({ question: '😀'.repeat(500) }))).not.toBeNull()
		expect(parseAskUserArgs(one({ question: 'q'.repeat(501) }))).toBeNull()
	})
	it('takes 10 options of 200 characters and refuses 11 options or 201 characters', () => {
		expect(
			parseAskUserArgs(one({ question: 'Q?', options: options(10) }))?.questions[0]?.options,
		).toHaveLength(10)
		expect(parseAskUserArgs(one({ question: 'Q?', options: ['o'.repeat(200)] }))).not.toBeNull()
		expect(parseAskUserArgs(one({ question: 'Q?', options: options(11) }))).toBeNull()
		expect(parseAskUserArgs(one({ question: 'Q?', options: ['o'.repeat(201)] }))).toBeNull()
	})
	it.each([
		['a blank question', { question: '   ' }],
		['a blank option', { question: 'Q?', options: ['Yes', '  '] }],
		['a question that is not a string', { question: 42 }],
		['options that are not strings', { question: 'Q?', options: [1, 2] }],
		['allow_custom that is not a boolean', { question: 'Q?', allow_custom: 'yes' }],
	])('refuses %s', (_label, question) => {
		expect(parseAskUserArgs(one(question))).toBeNull()
	})
	it.each([
		['text that is not JSON', '{"questions": ['],
		['an empty string', ''],
		['an array', '[]'],
		['a string', '"Which city?"'],
		['null', 'null'],
		['a number', '1'],
		['an object without questions', '{}'],
	])('answers null for %s', (_label, text) => {
		expect(parseAskUserArgs(text)).toBeNull()
	})
})

// 2b's plan call P3: the template's format_answers, character for character.
describe('askUserTranscript', () => {
	const asked: AskUserQuestion[] = [
		{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: true },
		{ question: 'How many nights?', options: [], allow_custom: true },
		{ question: 'Any wishes?', options: [], allow_custom: true },
	]

	it('writes each question and its answer, trimmed, joined by a blank line', () => {
		expect(
			askUserTranscript(asked, [
				{ answer: 'Paris', skipped: false },
				{ answer: ' 3 ', skipped: false },
				{ answer: 'A view', skipped: false },
			]),
		).toBe('Q: Which city?\nA: Paris\n\nQ: How many nights?\nA: 3\n\nQ: Any wishes?\nA: A view')
	})
	it('marks a skipped question, and a blank answer as no answer', () => {
		expect(
			askUserTranscript(asked, [
				{ answer: '', skipped: true },
				{ answer: '   ', skipped: false },
				{ answer: 'Ignored', skipped: true },
			]),
		).toBe(
			`Q: Which city?\nA: ${SKIPPED_ANSWER}\n\nQ: How many nights?\nA: ${NO_ANSWER}\n\nQ: Any wishes?\nA: ${SKIPPED_ANSWER}`,
		)
		expect([SKIPPED_ANSWER, NO_ANSWER]).toEqual(['(skipped)', '(no answer)'])
	})
	// The template's `answers[i] if i < len(answers) else {}`: a missing answer is not skipped, and blank.
	it('reads a question without an answer as no answer', () => {
		expect(askUserTranscript(asked, [{ answer: 'Rome', skipped: false }])).toBe(
			'Q: Which city?\nA: Rome\n\nQ: How many nights?\nA: (no answer)\n\nQ: Any wishes?\nA: (no answer)',
		)
	})
	// Spec §6.2: Dismiss skips the rest.
	it('writes a Dismiss as the questions after the answered ones skipped', () => {
		expect(
			askUserTranscript(asked, [
				{ answer: 'Rome', skipped: false },
				{ answer: '', skipped: true },
				{ answer: '', skipped: true },
			]),
		).toBe(
			'Q: Which city?\nA: Rome\n\nQ: How many nights?\nA: (skipped)\n\nQ: Any wishes?\nA: (skipped)',
		)
	})
	// P3: ten questions at their limit with ten free answers at theirs fit a tool result (spec §4.2: 32,000 characters).
	it('stays within a tool result’s limit at the longest', () => {
		const longest = Array.from({ length: ASK_USER_MAX_QUESTIONS }, () => ({
			question: 'q'.repeat(ASK_USER_QUESTION_MAX),
			options: [],
			allow_custom: true,
		}))
		const answers = longest.map(() => ({ answer: 'a'.repeat(ASK_USER_ANSWER_MAX), skipped: false }))
		expect(askUserTranscript(longest, answers).length).toBeLessThanOrEqual(MESSAGE_TEXT_MAX)
	})
})

// The card in the turn shows each question with its answer (the owner, 2026-10-15: the box holds your choice).
describe('askUserAnswersOf', () => {
	const asked: AskUserQuestion[] = [
		{ question: 'Which city?', options: ['Paris', 'Rome'], allow_custom: true },
		{ question: 'How many nights?', options: [], allow_custom: true },
		{ question: 'Any wishes?', options: [], allow_custom: true },
	]

	it('reads the transcript of these questions back into their answers: given, skipped and blank', () => {
		const answers = [
			{ answer: 'Paris', skipped: false },
			{ answer: '', skipped: true },
			{ answer: '', skipped: false },
		]
		expect(askUserAnswersOf(asked, askUserTranscript(asked, answers))).toEqual(answers)
	})
	it('reads a question that holds line breaks and the transcript’s own words', () => {
		const tricky: AskUserQuestion[] = [
			{ question: 'First line\n\nQ: second line?', options: [], allow_custom: true },
			{ question: 'A: really?', options: [], allow_custom: true },
		]
		const answers = [
			{ answer: 'Q: yes', skipped: false },
			{ answer: 'A: no', skipped: false },
		]
		expect(askUserAnswersOf(tricky, askUserTranscript(tricky, answers))).toEqual(answers)
	})
	it('reads an option with a line break, as the agent wrote it', () => {
		const multiline: AskUserQuestion[] = [
			{ question: 'Which plan?', options: ['Basic\nmonthly', 'Pro'], allow_custom: true },
			{ question: 'Anything else?', options: [], allow_custom: true },
		]
		const answers = [
			{ answer: 'Basic\nmonthly', skipped: false },
			{ answer: 'No', skipped: false },
		]
		expect(askUserAnswersOf(multiline, askUserTranscript(multiline, answers))).toEqual(answers)
	})
	it('reads nothing from a text that is not the transcript of these questions', () => {
		expect(askUserAnswersOf(asked, 'ok')).toBeNull()
		expect(askUserAnswersOf(asked, '')).toBeNull()
		// Another question set, one question short, and text after the last answer.
		expect(askUserAnswersOf(asked, 'Q: Which town?\nA: Paris')).toBeNull()
		expect(
			askUserAnswersOf(asked, 'Q: Which city?\nA: Paris\n\nQ: How many nights?\nA: 3'),
		).toBeNull()
		const full = askUserTranscript(asked, [{ answer: 'Rome', skipped: false }])
		expect(askUserAnswersOf(asked, `${full}\n\nQ: More?\nA: x`)).toBeNull()
		expect(askUserAnswersOf(asked, ` ${full}`)).toBeNull()
	})
	it('reads an answer that was trimmed when it was written as the text that went', () => {
		const text = askUserTranscript(asked, [{ answer: ' 3 nights ', skipped: false }])
		expect(askUserAnswersOf(asked, text)?.[0]).toEqual({ answer: '3 nights', skipped: false })
	})
})

describe('the tool’s definition (spec §6.2, P2)', () => {
	it('is advertised under the template’s name, and says the answers come back in the next turn', () => {
		expect(ASK_USER_TOOL.name).toBe('ask_user')
		expect(ASK_USER_TOOL.description).toMatch(
			/^Ask the user one or more questions and get their answers\.\n\n/,
		)
		expect(ASK_USER_TOOL.description).toContain('Calling this tool ends your turn.')
		expect(ASK_USER_TOOL.description).toContain('in the next turn')
	})
	// The JSON Schema the agent sees: the hub's limits, the template's descriptions, the template's defaults.
	it('states the schema’s limits and the template’s descriptions as JSON Schema', () => {
		expect(ASK_USER_TOOL.parameters).toEqual({
			type: 'object',
			properties: {
				questions: {
					description:
						'The questions to ask. Each has the question text, optional suggested `options`, and `allow_custom` (whether a free-form answer is allowed, default true).',
					minItems: 1,
					maxItems: 10,
					type: 'array',
					items: {
						type: 'object',
						description: 'One question to put to the user.',
						properties: {
							question: {
								type: 'string',
								minLength: 1,
								maxLength: 500,
								description: 'The question text.',
							},
							options: {
								type: 'array',
								items: { type: 'string', minLength: 1, maxLength: 200 },
								maxItems: 10,
								default: [],
								description: 'Optional suggested answers, shown as numbered choices.',
							},
							allow_custom: {
								type: 'boolean',
								default: true,
								description:
									'Whether the user may type a free-form answer instead of picking an option.',
							},
						},
						required: ['question'],
					},
				},
			},
			required: ['questions'],
		})
	})
	it('describes arguments the schema reads: the fewest and the most it allows', () => {
		const fewest = { questions: [{ question: 'Q?' }] }
		const most = {
			questions: Array.from({ length: ASK_USER_MAX_QUESTIONS }, () => ({
				question: 'q'.repeat(ASK_USER_QUESTION_MAX),
				options: Array.from({ length: ASK_USER_MAX_OPTIONS }, () =>
					'o'.repeat(ASK_USER_OPTION_MAX),
				),
				allow_custom: false,
			})),
		}
		expect(askUserArgsSchema.safeParse(fewest).success).toBe(true)
		expect(askUserArgsSchema.safeParse(most).success).toBe(true)
	})
})

describe('hubToolDefinitions (P1)', () => {
	it('gives the named tools’ definitions, and none for no name', () => {
		expect(hubToolDefinitions(['ask_user'])).toEqual([ASK_USER_TOOL])
		expect(hubToolDefinitions([])).toEqual([])
	})
})

// P3: the hub's answer to an invalid call, beside 2a's stopped and not-available answers.
describe('the invalid question’s answer', () => {
	it('is an error tool message the agent can read', () => {
		expect(INVALID_QUESTION_ERROR).toBe('invalid_arguments')
		expect(INVALID_QUESTION_CONTENT).toBe(
			'The questions did not match the parameters of the ask_user tool, so the user could not answer them.',
		)
	})
})
